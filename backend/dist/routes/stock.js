"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const authMiddleware_1 = require("../middleware/authMiddleware");
const firebaseConfig_1 = require("../utils/firebaseConfig");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
// Add stock batch
router.post('/batch', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { quantity, companyId } = req.body;
        // Fallback to user company if not provided
        const userCompanyId = req.user?.companyId;
        const finalCompanyId = companyId || userCompanyId;
        const batch = await prisma.coverStockBatch.create({
            data: {
                quantity: parseInt(quantity),
                companyId: finalCompanyId,
            },
        });
        res.status(201).json(batch);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// List stock batches
router.get('/batch', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        const batches = await prisma.coverStockBatch.findMany({
            where: companyId ? { companyId } : undefined,
            orderBy: { entryDate: 'asc' },
        });
        res.json(batches);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Get total stock info (Admin hand vs Seller hand)
router.get('/info', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        // Sum all current valid stock from admin batches
        const adminBatches = await prisma.coverStockBatch.aggregate({
            where: companyId ? { companyId } : undefined,
            _sum: { quantity: true }
        });
        // Sum all covers transferred to sellers
        const sellerTransfers = await prisma.sellerCoverTransfer.aggregate({
            where: companyId ? { companyId } : undefined,
            _sum: { quantity: true }
        });
        const totalInAdmin = (adminBatches._sum.quantity || 0) - (sellerTransfers._sum.quantity || 0);
        // Get total currently in sellers hands 
        const sellersBalance = await prisma.sellerCoverBalance.findMany({
            where: companyId ? { seller: { companyId } } : undefined,
            include: { seller: true }
        });
        const totalWithSellers = sellersBalance.reduce((acc, curr) => acc + curr.balance, 0);
        res.json({
            totalInAdmin,
            totalWithSellers,
            sellers: sellersBalance
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Transfer covers to seller (Add, Edit, Delete)
router.post('/transfer', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { sellerId, quantity, companyId } = req.body;
        const adminId = req.user?.id;
        if (!adminId)
            return res.status(401).json({ error: 'Unauthorized' });
        const transfer = await prisma.$transaction(async (tx) => {
            const newTransfer = await tx.sellerCoverTransfer.create({
                data: {
                    sellerId,
                    adminId,
                    quantity: parseInt(quantity),
                    companyId: companyId || req.user?.companyId,
                }
            });
            // Update balance
            const balance = await tx.sellerCoverBalance.upsert({
                where: { sellerId },
                update: { balance: { increment: parseInt(quantity) } },
                create: { sellerId, balance: parseInt(quantity) }
            });
            return { transfer: newTransfer, balance };
        });
        res.status(201).json(transfer);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Seller requests to return covers to Admin
router.post('/return-cover', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { quantity } = req.body;
        const sellerId = req.user?.id;
        const companyId = req.user?.companyId;
        if (!sellerId)
            return res.status(401).json({ error: 'Unauthorized' });
        const seller = await prisma.user.findUnique({ where: { id: sellerId } });
        const admins = await prisma.user.findMany({
            where: { role: 'ADMIN', companyId }
        });
        const adminTokens = admins.map(a => a.fcmToken).filter(t => t != null);
        for (const admin of admins) {
            await prisma.notification.create({
                data: {
                    title: 'Devolução de Capas',
                    message: `${seller?.name || 'Vendedor'} deseja devolver ${quantity} capas.`,
                    type: 'STOCK_RETURN_COVER',
                    status: 'UNREAD',
                    actionData: { quantity },
                    senderId: sellerId,
                    recipientId: admin.id,
                    companyId
                }
            });
        }
        await (0, firebaseConfig_1.sendPushNotification)(adminTokens, 'Devolução de Capas', `${seller?.name || 'Vendedor'} deseja devolver ${quantity} capas.`, { type: 'STOCK_RETURN_COVER', quantity });
        res.status(201).json({ success: true, message: 'Return request sent' });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.default = router;
