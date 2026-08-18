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
const prisma = new client_1.PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
// Submit a new cost (via Mobile App)
router.post('/', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { amount, category, subcategory, carId, description, paymentMethod, receiptUrl, nextOilChangeKm } = req.body;
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            res.status(400).json({ error: 'O valor do custo deve ser um número positivo maior que zero.' });
            return;
        }
        if (!category || typeof category !== 'string') {
            res.status(400).json({ error: 'A categoria do custo é obrigatória.' });
            return;
        }
        // Validate carId format (UUID) - if it's mock, ignore it
        let validCarId = carId;
        if (carId && carId.startsWith('car_'))
            validCarId = null;
        const userCompanyId = req.user?.companyId;
        const cost = await prisma.cost.create({
            data: {
                userId: req.user.id,
                teamId: req.user.teamId || null,
                amount: parsedAmount,
                category: String(category).slice(0, 100),
                subcategory: subcategory ? String(subcategory).slice(0, 100) : null,
                carId: validCarId || null,
                description: description ? String(description).slice(0, 500) : '',
                paymentMethod: paymentMethod ? String(paymentMethod).slice(0, 50) : 'CASH',
                receiptUrl: receiptUrl ? String(receiptUrl).slice(0, 500) : null,
                status: 'PENDING',
                companyId: userCompanyId || 'c1',
            }
        });
        const admins = await prisma.user.findMany({
            where: {
                role: { in: ['ADMIN', 'SUPERADMIN', 'COMPANY_ADMIN', 'SUPERVISOR'] },
                ...(userCompanyId ? { companyId: userCompanyId } : {}),
            }
        });
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        const adminTokens = admins.map(a => a.fcmToken).filter(t => t != null);
        for (const admin of admins) {
            const actionData = { costId: cost.id };
            if (nextOilChangeKm) {
                actionData.nextOilChangeKm = Number(nextOilChangeKm);
                actionData.carId = validCarId;
            }
            await prisma.notification.create({
                data: {
                    title: 'Aprovação de Custo',
                    message: `${user?.name || 'Funcionário'} solicitou aprovação para ${category} (R$ ${parsedAmount.toFixed(2)}).`,
                    type: 'COST_APPROVAL',
                    status: 'UNREAD',
                    actionData: actionData,
                    senderId: req.user.id,
                    recipientId: admin.id,
                    companyId: req.user.companyId,
                }
            });
        }
        if (adminTokens.length > 0) {
            await (0, firebaseConfig_1.sendPushNotification)(adminTokens, 'Novo Custo para Aprovar', `${user?.name || 'Funcionário'} lançou R$ ${parsedAmount.toFixed(2)} de ${category}.`, { type: 'COST_APPROVAL', costId: cost.id });
        }
        res.status(201).json(cost);
    }
    catch (error) {
        console.error('Error saving cost:', error);
        res.status(500).json({ error: 'Failed to save cost' });
    }
});
// Edit a cost (Creator if PENDING, or Admin/Supervisor in the same company)
router.put('/:id', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const id = req.params.id;
        const { amount, category, description, paymentMethod } = req.body;
        const userCompanyId = req.user?.companyId;
        const userId = req.user?.id;
        const isAdminOrSupervisor = ['ADMIN', 'SUPERVISOR', 'COMPANY_ADMIN', 'SUPER_ADMIN'].includes(req.user?.role);
        // Check if cost belongs to company
        const existing = await prisma.cost.findFirst({
            where: {
                id,
                ...(userCompanyId ? { companyId: userCompanyId } : {}),
            },
        });
        if (!existing) {
            res.status(404).json({ error: 'Cost not found' });
            return;
        }
        // If not admin, user can only edit their own cost if it's still PENDING
        if (!isAdminOrSupervisor) {
            if (existing.userId !== userId) {
                res.status(403).json({ error: 'Forbidden: Sem permissão para alterar custo de outro usuário' });
                return;
            }
            if (existing.status !== 'PENDING') {
                res.status(400).json({ error: 'Custos já aprovados ou rejeitados não podem ser alterados' });
                return;
            }
        }
        let parsedAmount = undefined;
        if (amount !== undefined) {
            parsedAmount = parseFloat(amount);
            if (isNaN(parsedAmount) || parsedAmount <= 0) {
                res.status(400).json({ error: 'O valor do custo deve ser um número positivo maior que zero.' });
                return;
            }
        }
        const updated = await prisma.cost.update({
            where: { id },
            data: {
                ...(parsedAmount !== undefined && { amount: parsedAmount }),
                ...(category !== undefined && { category: String(category).slice(0, 100) }),
                ...(description !== undefined && { description: String(description).slice(0, 500) }),
                ...(paymentMethod !== undefined && { paymentMethod: String(paymentMethod).slice(0, 50) }),
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
