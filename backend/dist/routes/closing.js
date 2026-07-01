"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
// Get Daily Closing for a Seller
router.get('/daily/:sellerId', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { sellerId } = req.params;
        const dateParam = req.query.date; // Optional specific date
        let startDate = new Date();
        let endDate = new Date();
        if (dateParam) {
            startDate = new Date(dateParam);
            endDate = new Date(dateParam);
        }
        // Rule: 23:00 previous day to 22:59 current day
        // For simplicity, we assume the 'date' refers to the day it ends
        startDate.setDate(startDate.getDate() - 1);
        startDate.setHours(23, 0, 0, 0);
        endDate.setHours(22, 59, 59, 999);
        // Fetch sales
        const sales = await prisma.sale.findMany({
            where: {
                sellerId: sellerId,
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
        res.status(500).json({ error: error.message });
    }
});
// Admin saves/generates the repasse debt permanently for a day
router.post('/daily', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { sellerId, totalSalesValue, cashValue, pixValue, debitValue, creditValue, commission, repasseDebt } = req.body;
        const closing = await prisma.dailyClosing.create({
            data: {
                sellerId,
                totalSalesValue: parseFloat(totalSalesValue),
                cashValue: parseFloat(cashValue),
                pixValue: parseFloat(pixValue),
                debitValue: parseFloat(debitValue),
                creditValue: parseFloat(creditValue),
                commission: parseFloat(commission),
                repasseDebt: parseFloat(repasseDebt)
            }
        });
        res.status(201).json(closing);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Pay/Clear repasse
router.post('/pay-repasse', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { sellerId, amount } = req.body;
        // Negative repasseDebt represents a payment reducing the total debt
        const closing = await prisma.dailyClosing.create({
            data: {
                sellerId,
                totalSalesValue: 0,
                cashValue: 0,
                pixValue: 0,
                debitValue: 0,
                creditValue: 0,
                commission: 0,
                repasseDebt: -parseFloat(amount) // Deducts from total debt
            }
        });
        res.status(201).json(closing);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Photographer Closing
router.get('/photographer/:photographerId', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { photographerId } = req.params;
        const dateParam = req.query.date;
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
                date: {
                    gte: startDate,
                    lte: endDate
                }
            }
        });
        // Sum photos taken in those books (if books have quantities) or just count books
        res.json({
            booksCount: books.length,
            books
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// City Closing
router.get('/city/:city', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { city } = req.params;
        const sellerId = req.query.sellerId;
        let whereSale = { city };
        let whereNonSale = { client: { city } };
        if (sellerId) {
            whereSale.sellerId = sellerId;
            whereNonSale.sellerId = sellerId;
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
        res.status(500).json({ error: error.message });
    }
});
exports.default = router;
