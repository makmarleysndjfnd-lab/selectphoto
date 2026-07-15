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
// Submit a new cost (via Mobile App)
router.post('/', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { amount, category, subcategory, carId, description, paymentMethod, receiptUrl } = req.body;
        // Validate carId format (UUID) - if it's mock, ignore it
        let validCarId = carId;
        if (carId && carId.startsWith('car_'))
            validCarId = null;
        const cost = await prisma.cost.create({
            data: {
                userId: req.user.id,
                teamId: req.user.teamId || null,
                amount: parseFloat(amount),
                category,
                subcategory: subcategory || null,
                carId: validCarId || null,
                description,
                paymentMethod: paymentMethod || 'CASH',
                receiptUrl,
                status: 'PENDING',
                companyId: req.user.companyId
            }
        });
        if (req.user.role !== 'ADMIN') {
            const admins = await prisma.user.findMany({
                where: { role: 'ADMIN', companyId: req.user.companyId }
            });
            const user = await prisma.user.findUnique({ where: { id: req.user.id } });
            const adminTokens = admins.map(a => a.fcmToken).filter(t => t != null);
            for (const admin of admins) {
                await prisma.notification.create({
                    data: {
                        title: 'Aprovação de Custo',
                        message: `${user?.name || 'Funcionário'} solicitou aprovação para ${category} (R$ ${amount}).`,
                        type: 'COST_APPROVAL',
                        status: 'UNREAD',
                        actionData: { costId: cost.id },
                        senderId: req.user.id,
                        recipientId: admin.id,
                        companyId: req.user.companyId
                    }
                });
            }
            await (0, firebaseConfig_1.sendPushNotification)(adminTokens, 'Novo Custo para Aprovar', `${user?.name || 'Funcionário'} lançou R$ ${amount} de ${category}.`, { type: 'COST_APPROVAL', costId: cost.id });
        }
        res.status(201).json(cost);
    }
    catch (error) {
        console.error('Error saving cost:', error);
        res.status(500).json({ error: 'Failed to save cost' });
    }
});
// Edit a cost
router.put('/:id', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const id = req.params.id;
        const { amount, category, description, paymentMethod } = req.body;
        // Check if it belongs to company
        const existing = await prisma.cost.findUnique({ where: { id } });
        if (!existing || existing.companyId !== req.user.companyId) {
            return res.status(404).json({ error: 'Cost not found' });
        }
        const updated = await prisma.cost.update({
            where: { id },
            data: {
                ...(amount !== undefined && { amount: parseFloat(amount) }),
                ...(category !== undefined && { category: category }),
                ...(description !== undefined && { description: description }),
                ...(paymentMethod !== undefined && { paymentMethod: paymentMethod }),
            }
        });
        res.json(updated);
    }
    catch (error) {
        console.error('Error updating cost:', error);
        res.status(500).json({ error: 'Failed to update cost' });
    }
});
exports.default = router;
