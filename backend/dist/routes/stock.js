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
        // Get all sellers
        const sellers = await prisma.user.findMany({
            where: {
                role: 'SELLER',
                ...(companyId ? { companyId } : {})
            }
        });
        const sellersBalance = await prisma.sellerCoverBalance.findMany({
            where: companyId ? { seller: { companyId } } : undefined,
        });
        const totalWithSellers = sellersBalance.reduce((acc, curr) => acc + curr.balance, 0);
        // Map sellers to include balance
        const sellersWithBalance = sellers.map(seller => {
            const balanceRecord = sellersBalance.find(b => b.sellerId === seller.id);
            return {
                seller: seller,
                balance: balanceRecord ? balanceRecord.balance : 0
            };
        });
        res.json({
            totalInAdmin,
            totalWithSellers,
            sellers: sellersWithBalance
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
// User (Seller/Photographer) requests covers/books from another user or Admin
router.post('/request-transfer', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { recipientId, quantity, itemType } = req.body; // itemType: 'COVER' or 'BOOK'
        const senderId = req.user?.id;
        const companyId = req.user?.companyId;
        if (!senderId || !recipientId)
            return res.status(400).json({ error: 'Missing parameters' });
        const sender = await prisma.user.findUnique({ where: { id: senderId } });
        const recipient = await prisma.user.findUnique({ where: { id: recipientId } });
        if (!sender || !recipient)
            return res.status(404).json({ error: 'User not found' });
        const notifType = itemType === 'BOOK' ? 'STOCK_TRANSFER_BOOK' : 'STOCK_TRANSFER_COVER';
        const itemName = itemType === 'BOOK' ? 'Books' : 'Capas';
        // Notify the recipient (they must accept to give the items)
        await prisma.notification.create({
            data: {
                title: `Solicitação de ${itemName}`,
                message: `${sender.name} está solicitando ${quantity} ${itemName}.`,
                type: notifType,
                status: 'UNREAD',
                actionData: { quantity, itemType },
                senderId: senderId,
                recipientId: recipientId,
                companyId
            }
        });
        if (recipient.fcmToken) {
            await (0, firebaseConfig_1.sendPushNotification)([recipient.fcmToken], `Solicitação de ${itemName}`, `${sender.name} está solicitando ${quantity} ${itemName}.`, { type: notifType, quantity });
        }
        // Notify Admin as well (just for visibility/INFO)
        const admins = await prisma.user.findMany({
            where: { role: 'ADMIN', companyId }
        });
        const adminTokens = admins.filter(a => a.fcmToken != null && a.id !== recipientId).map(a => a.fcmToken);
        for (const admin of admins) {
            if (admin.id === recipientId)
                continue; // already notified above
            await prisma.notification.create({
                data: {
                    title: `Nova Solicitação de ${itemName}`,
                    message: `${sender.name} solicitou ${quantity} ${itemName} para ${recipient.name}.`,
                    type: 'INFO',
                    status: 'UNREAD',
                    senderId: senderId,
                    recipientId: admin.id,
                    companyId
                }
            });
        }
        if (adminTokens.length > 0) {
            await (0, firebaseConfig_1.sendPushNotification)(adminTokens, `Nova Solicitação de ${itemName}`, `${sender.name} solicitou ${quantity} ${itemName} para ${recipient.name}.`, { type: 'INFO' });
        }
        res.status(201).json({ success: true, message: 'Transfer request sent' });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Transfer covers between sellers
router.post('/transfer-between-sellers', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { recipientId, quantity } = req.body;
        const senderId = req.user?.id;
        const companyId = req.user?.companyId;
        if (!senderId || !recipientId)
            return res.status(400).json({ error: 'Missing parameters' });
        const sender = await prisma.user.findUnique({ where: { id: senderId } });
        const recipient = await prisma.user.findUnique({ where: { id: recipientId } });
        if (!sender || !recipient)
            return res.status(404).json({ error: 'User not found' });
        const senderBalance = await prisma.sellerCoverBalance.findUnique({ where: { sellerId: senderId } });
        if (!senderBalance || senderBalance.balance < quantity) {
            return res.status(400).json({ error: 'Insufficient covers' });
        }
        const admins = await prisma.user.findMany({
            where: { role: 'ADMIN', companyId }
        });
        // Use a unique ID to link both notifications
        const { v4: uuidv4 } = require('uuid');
        const transferId = uuidv4();
        // Notify Recipient
        await prisma.notification.create({
            data: {
                title: 'Transferência de Capas',
                message: `${sender.name} quer transferir ${quantity} capas para você. Confirme para aceitar.`,
                type: 'COVER_TRANSFER_REQUEST',
                status: 'UNREAD',
                actionData: { quantity, senderId, recipientId, transferId, role: 'RECIPIENT' },
                senderId: senderId,
                recipientId: recipientId,
                companyId
            }
        });
        if (recipient.fcmToken) {
            await (0, firebaseConfig_1.sendPushNotification)([recipient.fcmToken], 'Transferência de Capas', `${sender.name} quer transferir ${quantity} capas para você.`, { type: 'COVER_TRANSFER_REQUEST' });
        }
        // Notify Admins
        const adminTokens = admins.map(a => a.fcmToken).filter(t => t != null);
        for (const admin of admins) {
            await prisma.notification.create({
                data: {
                    title: 'Transferência de Capas (Aprovação)',
                    message: `${sender.name} quer transferir ${quantity} capas para ${recipient.name}.`,
                    type: 'COVER_TRANSFER_REQUEST',
                    status: 'UNREAD',
                    actionData: { quantity, senderId, recipientId, transferId, role: 'ADMIN' },
                    senderId: senderId,
                    recipientId: admin.id,
                    companyId
                }
            });
        }
        if (adminTokens.length > 0) {
            await (0, firebaseConfig_1.sendPushNotification)(adminTokens, 'Transferência de Capas (Aprovação)', `${sender.name} quer transferir ${quantity} capas para ${recipient.name}.`, { type: 'COVER_TRANSFER_REQUEST' });
        }
        res.status(201).json({ success: true, message: 'Transfer request sent' });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Defective cover return
router.post('/defective', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { quantity, sellerId } = req.body;
        const adminId = req.user?.id;
        const companyId = req.user?.companyId;
        if (!adminId || !sellerId)
            return res.status(400).json({ error: 'Missing parameters' });
        const seller = await prisma.user.findUnique({ where: { id: sellerId } });
        if (!seller)
            return res.status(404).json({ error: 'User not found' });
        const sellerBalance = await prisma.sellerCoverBalance.findUnique({ where: { sellerId } });
        if (!sellerBalance || sellerBalance.balance < quantity) {
            return res.status(400).json({ error: 'Insufficient covers' });
        }
        // Decrement seller balance
        await prisma.sellerCoverBalance.update({
            where: { sellerId },
            data: { balance: { decrement: parseInt(quantity) } }
        });
        // Add a negative entry to Admin Batches to represent the defective covers thrown away
        await prisma.coverStockBatch.create({
            data: {
                quantity: -parseInt(quantity),
                companyId: companyId,
            },
        });
        res.status(200).json({ success: true, message: 'Defective covers returned and excluded from stock' });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.default = router;
