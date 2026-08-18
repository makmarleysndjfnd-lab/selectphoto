"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
// Helper to verify user can view a seller's closing
async function canAccessSellerClosing(reqUser, targetSellerId) {
    if (!reqUser)
        return false;
    if (reqUser.id === targetSellerId)
        return true;
    const isAdminOrSupervisor = ['ADMIN', 'SUPERVISOR', 'COMPANY_ADMIN', 'SUPER_ADMIN'].includes(reqUser.role);
    if (isAdminOrSupervisor) {
        if (reqUser.role === 'SUPER_ADMIN')
            return true;
        const seller = await prisma.user.findUnique({
            where: { id: targetSellerId },
            select: { companyId: true },
        });
        return !!seller && seller.companyId === reqUser.companyId;
    }
    return false;
}
// Get Daily Closing for a Seller
router.get('/daily/:sellerId', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const sellerId = req.params.sellerId;
        const userCompanyId = req.user?.companyId;
        const dateParam = req.query.date;
        const hasAccess = await canAccessSellerClosing(req.user, sellerId);
        if (!hasAccess) {
            res.status(403).json({ error: 'Forbidden: Sem permissão para visualizar o fechamento deste vendedor' });
            return;
        }
        let startDate = new Date();
        let endDate = new Date();
        if (dateParam) {
            startDate = new Date(dateParam);
            endDate = new Date(dateParam);
        }
        startDate.setDate(startDate.getDate() - 1);
        startDate.setHours(23, 0, 0, 0);
        endDate.setHours(22, 59, 59, 999);
        // Fetch sales
        const sales = await prisma.sale.findMany({
            where: {
                sellerId: sellerId,
                ...(userCompanyId ? { companyId: userCompanyId } : {}),
                date: {
                    gte: startDate,
                    lte: endDate
                }
            },
            include: { client: true }
        });
        // Fetch non-sales
        const nonSales = await prisma.nonSale.findMany({
            where: {
                sellerId: sellerId,
                ...(userCompanyId ? { companyId: userCompanyId } : {}),
                date: {
                    gte: startDate,
                    lte: endDate
                }
            },
            include: { client: true }
        });
        const totalSalesValue = sales.reduce((acc, curr) => acc + curr.value, 0);
        const cashValue = sales.filter(s => s.paymentMethod === 'CASH').reduce((acc, curr) => acc + curr.value, 0);
        const pixValue = sales.filter(s => s.paymentMethod === 'PIX').reduce((acc, curr) => acc + curr.value, 0);
        const debitValue = sales.filter(s => s.paymentMethod === 'DEBIT').reduce((acc, curr) => acc + curr.value, 0);
        const creditValue = sales.filter(s => s.paymentMethod === 'CREDIT').reduce((acc, curr) => acc + curr.value, 0);
        // Commission
        const seller = await prisma.user.findUnique({ where: { id: sellerId } });
        const commissionPercentage = seller?.usesOwnCar ? 0.25 : 0.20;
        const commission = totalSalesValue * commissionPercentage;
        // Repasse Debt: if cash > commission, seller owes the company
        const repasseDebt = cashValue > commission ? (cashValue - commission) : 0;
        // Also fetch previous unpaid repasses (historical)
        const previousClosings = await prisma.dailyClosing.findMany({
            where: { sellerId: sellerId }
        });
        const totalHistoricalDebt = previousClosings.reduce((acc, curr) => acc + curr.repasseDebt, 0);
        res.json({
            startDate,
            endDate,
            salesCount: sales.length,
            nonSalesCount: nonSales.length,
            totalSalesValue,
            cashValue,
            pixValue,
            debitValue,
            creditValue,
            commission,
            commissionPercentage,
            repasseDebt,
            totalHistoricalDebt,
            sales,
            nonSales
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message || 'Erro ao carregar fechamento diário' });
    }
});
// Admin saves/generates the repasse debt permanently for a day
router.post('/daily', authMiddleware_1.authenticateToken, authMiddleware_1.requireAdminOrSupervisor, async (req, res) => {
    try {
        const { sellerId, totalSalesValue, cashValue, pixValue, debitValue, creditValue, commission, repasseDebt } = req.body;
        const userCompanyId = req.user?.companyId;
        // Verify seller belongs to company
        const seller = await prisma.user.findFirst({
            where: {
                id: sellerId,
                ...(userCompanyId ? { companyId: userCompanyId } : {}),
            },
        });
        if (!seller) {
            res.status(404).json({ error: 'Vendedor não encontrado na sua empresa' });
            return;
        }
        const closing = await prisma.dailyClosing.create({
            data: {
                sellerId,
                totalSalesValue: parseFloat(totalSalesValue) || 0,
                cashValue: parseFloat(cashValue) || 0,
                pixValue: parseFloat(pixValue) || 0,
                debitValue: parseFloat(debitValue) || 0,
                creditValue: parseFloat(creditValue) || 0,
                commission: parseFloat(commission) || 0,
                repasseDebt: parseFloat(repasseDebt) || 0
            }
        });
        res.status(201).json(closing);
    }
    catch (error) {
        res.status(500).json({ error: error.message || 'Erro ao salvar fechamento' });
    }
});
// Pay/Clear repasse (Admin or Supervisor)
router.post('/pay-repasse', authMiddleware_1.authenticateToken, authMiddleware_1.requireAdminOrSupervisor, async (req, res) => {
    try {
        const { sellerId, amount, commissionToLog } = req.body;
        const userCompanyId = req.user?.companyId;
        const seller = await prisma.user.findFirst({
            where: {
                id: sellerId,
                ...(userCompanyId ? { companyId: userCompanyId } : {}),
            },
        });
        if (!seller) {
            res.status(404).json({ error: 'Vendedor não encontrado na sua empresa' });
            return;
        }
        const closing = await prisma.dailyClosing.create({
            data: {
                sellerId,
                totalSalesValue: 0,
                cashValue: 0,
                pixValue: 0,
                debitValue: 0,
                creditValue: 0,
                commission: 0,
                repasseDebt: -parseFloat(amount || 0)
            }
        });
        if (commissionToLog && parseFloat(commissionToLog) > 0) {
            await prisma.cost.create({
                data: {
                    companyId: seller.companyId || userCompanyId || 'c1',
                    userId: sellerId,
                    amount: parseFloat(commissionToLog),
                    category: 'COMMISSION',
                    description: `Comissão fechamento de ${seller.name}`,
                    date: new Date(),
                    paymentMethod: 'PIX',
                    status: 'APPROVED'
                }
            });
        }
        res.status(201).json(closing);
    }
    catch (error) {
        res.status(500).json({ error: error.message || 'Erro ao registrar pagamento de repasse' });
    }
});
// Photographer Closing
router.get('/photographer/:photographerId', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const photographerId = req.params.photographerId;
        const userCompanyId = req.user?.companyId;
        const dateParam = req.query.date;
        const hasAccess = await canAccessSellerClosing(req.user, photographerId);
        if (!hasAccess) {
            res.status(403).json({ error: 'Forbidden: Sem permissão para visualizar o fechamento deste fotógrafo' });
            return;
        }
        let startDate = new Date();
        let endDate = new Date();
        if (dateParam) {
            startDate = new Date(dateParam);
            endDate = new Date(dateParam);
        }
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);
        const books = await prisma.bookBatch.findMany({
            where: {
                photographerId: photographerId,
                ...(userCompanyId ? { companyId: userCompanyId } : {}),
                date: {
                    gte: startDate,
                    lte: endDate
                }
            }
        });
        res.json({
            booksCount: books.length,
            books
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message || 'Erro ao carregar fechamento do fotógrafo' });
    }
});
// Custom Metrics Overview (by Date Range, Sellers, and City)
router.get('/custom', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const sellerIdsStr = req.query.sellerIds;
        const startDateParam = req.query.startDate;
        const endDateParam = req.query.endDate;
        const cityParam = req.query.city;
        const userCompanyId = req.user?.companyId;
        let whereSale = {
            ...(userCompanyId ? { companyId: userCompanyId } : {}),
        };
        let whereNonSale = {
            ...(userCompanyId ? { companyId: userCompanyId } : {}),
        };
        if (sellerIdsStr) {
            const sellerIds = sellerIdsStr.split(',');
            whereSale.sellerId = { in: sellerIds };
            whereNonSale.sellerId = { in: sellerIds };
        }
        if (cityParam && cityParam.trim() !== '') {
            whereSale.client = { city: cityParam.trim() };
            whereNonSale.client = { city: cityParam.trim() };
        }
        if (startDateParam && endDateParam) {
            const startDate = new Date(startDateParam);
            const endDate = new Date(endDateParam);
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
            whereSale.date = { gte: startDate, lte: endDate };
            whereNonSale.date = { gte: startDate, lte: endDate };
        }
        const sales = await prisma.sale.findMany({ where: whereSale });
        const nonSales = await prisma.nonSale.findMany({ where: whereNonSale });
        const totalSalesValue = sales.reduce((acc, curr) => acc + curr.value, 0);
        const totalFichas = sales.length + nonSales.length;
        const averageTicket = totalFichas > 0 ? (totalSalesValue / totalFichas) : 0;
        res.json({
            salesCount: sales.length,
            nonSalesCount: nonSales.length,
            totalFichas,
            totalSalesValue,
            averageTicket
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message || 'Erro ao carregar métricas customizadas' });
    }
});
// City Closing
router.get('/city/:city', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { city } = req.params;
        const sellerIdsStr = req.query.sellerIds;
        const dateParam = req.query.date;
        const userCompanyId = req.user?.companyId;
        let whereSale = {
            city,
            ...(userCompanyId ? { companyId: userCompanyId } : {}),
        };
        let whereNonSale = {
            client: { city },
            ...(userCompanyId ? { companyId: userCompanyId } : {}),
        };
        if (sellerIdsStr) {
            const sellerIds = sellerIdsStr.split(',');
            whereSale.sellerId = { in: sellerIds };
            whereNonSale.sellerId = { in: sellerIds };
        }
        if (dateParam) {
            const startDate = new Date(dateParam);
            const endDate = new Date(dateParam);
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
            whereSale.date = { gte: startDate, lte: endDate };
            whereNonSale.date = { gte: startDate, lte: endDate };
        }
        const sales = await prisma.sale.findMany({ where: whereSale });
        const nonSales = await prisma.nonSale.findMany({ where: whereNonSale });
        const totalSalesValue = sales.reduce((acc, curr) => acc + curr.value, 0);
        const totalFichas = sales.length + nonSales.length;
        const averageTicket = totalFichas > 0 ? (totalSalesValue / totalFichas) : 0;
        res.json({
            city,
            salesCount: sales.length,
            nonSalesCount: nonSales.length,
            totalFichas,
            totalSalesValue,
            averageTicket
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message || 'Erro ao carregar fechamento da cidade' });
    }
});
exports.default = router;
