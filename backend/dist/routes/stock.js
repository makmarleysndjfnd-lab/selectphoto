"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const authMiddleware_1 = require("../middleware/authMiddleware");
const firebaseConfig_1 = require("../utils/firebaseConfig");
const uuid_1 = require("uuid");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
// Add stock batch (Admin or Supervisor only)
router.post('/batch', authMiddleware_1.authenticateToken, authMiddleware_1.requireAdminOrSupervisor, async (req, res) => {
    try {
        const { quantity } = req.body;
        const userCompanyId = req.user?.companyId;
        const parsedQty = parseInt(quantity, 10);
        if (isNaN(parsedQty) || parsedQty <= 0) {
            res.status(400).json({ error: 'A quantidade do lote deve ser um número inteiro positivo.' });
            return;
        }
        const batch = await prisma.coverStockBatch.create({
            data: {
                quantity: parsedQty,
                companyId: userCompanyId,
            },
        });
        res.status(201).json(batch);
    }
    catch (error) {
        res.status(500).json({ error: error.message || 'Erro ao adicionar lote de estoque' });
    }
});
// List stock batches (Scoped by company)
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
        res.status(500).json({ error: error.message || 'Erro ao listar lotes de estoque' });
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
        // Get all sellers in the same company
        const sellers = await prisma.user.findMany({
            where: {
                role: {
                    in: ['SELLER', 'SELLER_MANAGER']
                },
                ...(companyId ? { companyId } : {})
            }
        });
        const sellersBalance = await prisma.sellerCoverBalance.findMany({
            where: companyId ? { seller: { companyId } } : undefined,
        });
        const totalWithSellers = sellersBalance.reduce((acc, curr) => acc + curr.balance, 0);
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
        res.status(500).json({ error: error.message || 'Erro ao carregar informações de estoque' });
    }
});
// Transfer covers to seller (Admin or Supervisor only)
router.post('/transfer', authMiddleware_1.authenticateToken, authMiddleware_1.requireAdminOrSupervisor, async (req, res) => {
    try {
        const { sellerId, quantity } = req.body;
        const adminId = req.user?.id;
        const companyId = req.user?.companyId;
        const parsedQty = parseInt(quantity, 10);
        if (isNaN(parsedQty) || parsedQty <= 0) {
            res.status(400).json({ error: 'A quantidade para transferência deve ser um número inteiro positivo.' });
            return;
        }
        // Verify seller belongs to company
        const seller = await prisma.user.findFirst({
            where: {
                id: sellerId,
                ...(companyId ? { companyId } : {}),
            }
        });
        if (!seller) {
            res.status(404).json({ error: 'Vendedor não encontrado na sua empresa' });
            return;
        }
        const transfer = await prisma.$transaction(async (tx) => {
            const newTransfer = await tx.sellerCoverTransfer.create({
                data: {
                    sellerId,
                    adminId: adminId,
                    quantity: parsedQty,
                    companyId: companyId,
                }
            });
            const balance = await tx.sellerCoverBalance.upsert({
                where: { sellerId },
                update: { balance: { increment: parsedQty } },
                create: { sellerId, balance: parsedQty }
            });
            return { transfer: newTransfer, balance };
        });
        res.status(201).json(transfer);
    }
    catch (error) {
        res.status(500).json({ error: error.message || 'Erro ao transferir capas' });
    }
});
// Seller requests to return covers to Admin
router.post('/return-cover', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { quantity } = req.body;
        const sellerId = req.user?.id;
        const companyId = req.user?.companyId;
        const parsedQty = parseInt(quantity, 10);
        if (isNaN(parsedQty) || parsedQty <= 0) {
            res.status(400).json({ error: 'A quantidade para devolução deve ser um número inteiro positivo.' });
            return;
        }
        const seller = await prisma.user.findUnique({ where: { id: sellerId } });
        if (!seller) {
            res.status(404).json({ error: 'Usuário não encontrado' });
            return;
        }
        const sellerBalance = await prisma.sellerCoverBalance.findUnique({ where: { sellerId } });
        if (!sellerBalance || sellerBalance.balance < parsedQty) {
            res.status(400).json({ error: `Saldo insuficiente. Seu saldo atual é de ${sellerBalance?.balance || 0} capas.` });
            return;
        }
        const admins = await prisma.user.findMany({
            where: {
                role: { in: ['ADMIN', 'SUPERADMIN', 'COMPANY_ADMIN', 'SUPERVISOR'] },
                ...(companyId ? { companyId } : {}),
            }
        });
        const adminTokens = admins.map(a => a.fcmToken).filter(t => t != null);
        for (const admin of admins) {
            await prisma.notification.create({
                data: {
                    title: 'Devolução de Capas',
                    message: `${seller.name} deseja devolver ${parsedQty} capas.`,
                    type: 'STOCK_RETURN_COVER',
                    status: 'UNREAD',
                    actionData: { quantity: parsedQty },
                    senderId: sellerId,
                    recipientId: admin.id,
                    companyId
                }
            });
        }
        if (adminTokens.length > 0) {
            await (0, firebaseConfig_1.sendPushNotification)(adminTokens, 'Devolução de Capas', `${seller.name} deseja devolver ${parsedQty} capas.`, { type: 'STOCK_RETURN_COVER', quantity: parsedQty });
        }
        res.status(201).json({ success: true, message: 'Solicitação de devolução enviada' });
    }
    catch (error) {
        res.status(500).json({ error: error.message || 'Erro ao solicitar devolução de capas' });
    }
});
// User (Seller/Photographer) requests covers/books from another user or Admin
router.post('/request-transfer', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { recipientId, quantity, itemType } = req.body;
        const senderId = req.user?.id;
        const companyId = req.user?.companyId;
        const parsedQty = parseInt(quantity, 10);
        if (isNaN(parsedQty) || parsedQty <= 0) {
            res.status(400).json({ error: 'A quantidade deve ser um número inteiro positivo.' });
            return;
        }
        if (!senderId || !recipientId) {
            res.status(400).json({ error: 'Parâmetros obrigatórios ausentes' });
            return;
        }
        const sender = await prisma.user.findUnique({ where: { id: senderId } });
        const recipient = await prisma.user.findFirst({
            where: {
                id: recipientId,
                ...(companyId ? { companyId } : {}),
            }
        });
        if (!sender || !recipient) {
            res.status(404).json({ error: 'Destinatário não encontrado na sua empresa' });
            return;
        }
        const notifType = itemType === 'BOOK' ? 'STOCK_TRANSFER_BOOK' : 'STOCK_TRANSFER_COVER';
        const itemName = itemType === 'BOOK' ? 'Books' : 'Capas';
        await prisma.notification.create({
            data: {
                title: `Solicitação de ${itemName}`,
                message: `${sender.name} está solicitando ${parsedQty} ${itemName}.`,
                type: notifType,
                status: 'UNREAD',
                actionData: { quantity: parsedQty, itemType },
                senderId: senderId,
                recipientId: recipientId,
                companyId
            }
        });
        if (recipient.fcmToken) {
            await (0, firebaseConfig_1.sendPushNotification)([recipient.fcmToken], `Solicitação de ${itemName}`, `${sender.name} está solicitando ${parsedQty} ${itemName}.`, { type: notifType, quantity: parsedQty });
        }
        res.status(201).json({ success: true, message: 'Transfer request sent' });
    }
    catch (error) {
        res.status(500).json({ error: error.message || 'Erro ao solicitar transferência' });
    }
});
// Transfer covers between sellers
router.post('/transfer-between-sellers', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { recipientId, quantity } = req.body;
        const senderId = req.user?.id;
        const companyId = req.user?.companyId;
        const parsedQty = parseInt(quantity, 10);
        if (isNaN(parsedQty) || parsedQty <= 0) {
            res.status(400).json({ error: 'A quantidade deve ser um número inteiro positivo.' });
            return;
        }
        if (!senderId || !recipientId) {
            res.status(400).json({ error: 'Missing parameters' });
            return;
        }
        const sender = await prisma.user.findUnique({ where: { id: senderId } });
        const recipient = await prisma.user.findFirst({
            where: {
                id: recipientId,
                ...(companyId ? { companyId } : {}),
            }
        });
        if (!sender || !recipient) {
            res.status(404).json({ error: 'Vendedor destinatário não encontrado na sua empresa' });
            return;
        }
        const senderBalance = await prisma.sellerCoverBalance.findUnique({ where: { sellerId: senderId } });
        if (!senderBalance || senderBalance.balance < parsedQty) {
            res.status(400).json({ error: `Saldo insuficiente. Seu saldo atual é de ${senderBalance?.balance || 0} capas.` });
            return;
        }
        const admins = await prisma.user.findMany({
            where: {
                role: { in: ['ADMIN', 'SUPERADMIN', 'COMPANY_ADMIN', 'SUPERVISOR'] },
                ...(companyId ? { companyId } : {}),
            }
        });
        const transferId = (0, uuid_1.v4)();
        // Notify Recipient
        await prisma.notification.create({
            data: {
                title: 'Transferência de Capas',
                message: `${sender.name} quer transferir ${parsedQty} capas para você. Confirme para aceitar.`,
                type: 'COVER_TRANSFER_REQUEST',
                status: 'UNREAD',
                actionData: { quantity: parsedQty, senderId, recipientId, transferId, role: 'RECIPIENT' },
                senderId: senderId,
                recipientId: recipientId,
                companyId
            }
        });
        if (recipient.fcmToken) {
            await (0, firebaseConfig_1.sendPushNotification)([recipient.fcmToken], 'Transferência de Capas', `${sender.name} quer transferir ${parsedQty} capas para você.`, { type: 'COVER_TRANSFER_REQUEST' });
        }
        // Notify Admins
        const adminTokens = admins.map(a => a.fcmToken).filter(t => t != null);
        for (const admin of admins) {
            await prisma.notification.create({
                data: {
                    title: 'Transferência de Capas (Aprovação)',
                    message: `${sender.name} quer transferir ${parsedQty} capas para ${recipient.name}.`,
                    type: 'COVER_TRANSFER_REQUEST',
                    status: 'UNREAD',
                    actionData: { quantity: parsedQty, senderId, recipientId, transferId, role: 'ADMIN' },
                    senderId: senderId,
                    recipientId: admin.id,
                    companyId
                }
            });
        }
        if (adminTokens.length > 0) {
            await (0, firebaseConfig_1.sendPushNotification)(adminTokens, 'Transferência de Capas (Aprovação)', `${sender.name} quer transferir ${parsedQty} capas para ${recipient.name}.`, { type: 'COVER_TRANSFER_REQUEST' });
        }
        res.status(201).json({ success: true, message: 'Transfer request sent' });
    }
    catch (error) {
        res.status(500).json({ error: error.message || 'Erro ao transferir capas entre vendedores' });
    }
});
// Defective cover return (Admin or Supervisor only)
router.post('/defective', authMiddleware_1.authenticateToken, authMiddleware_1.requireAdminOrSupervisor, async (req, res) => {
    try {
        const { quantity, sellerId } = req.body;
        const companyId = req.user?.companyId;
        const parsedQty = parseInt(quantity, 10);
        if (isNaN(parsedQty) || parsedQty <= 0) {
            res.status(400).json({ error: 'A quantidade de capas danificadas deve ser um número inteiro positivo.' });
            return;
        }
        if (!sellerId) {
            res.status(400).json({ error: 'sellerId é obrigatório' });
            return;
        }
        const seller = await prisma.user.findFirst({
            where: {
                id: sellerId,
                ...(companyId ? { companyId } : {}),
            }
        });
        if (!seller) {
            res.status(404).json({ error: 'Vendedor não encontrado na sua empresa' });
            return;
        }
        const sellerBalance = await prisma.sellerCoverBalance.findUnique({ where: { sellerId } });
        if (!sellerBalance || sellerBalance.balance < parsedQty) {
            res.status(400).json({ error: `Saldo insuficiente para descarte. Saldo atual do vendedor: ${sellerBalance?.balance || 0} capas.` });
            return;
        }
        await prisma.$transaction(async (tx) => {
            // Decrement seller balance
            await tx.sellerCoverBalance.update({
                where: { sellerId },
                data: { balance: { decrement: parsedQty } }
            });
            // Add negative entry to Admin Batches to represent discarded stock
            await tx.coverStockBatch.create({
                data: {
                    quantity: -parsedQty,
                    companyId: companyId,
                },
            });
        });
        res.status(200).json({ success: true, message: 'Capas danificadas devolvidas e descartadas do estoque com sucesso.' });
    }
    catch (error) {
        res.status(500).json({ error: error.message || 'Erro ao processar devolução de capas danificadas' });
    }
});
exports.default = router;
