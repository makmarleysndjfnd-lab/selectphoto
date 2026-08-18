"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const authMiddleware_1 = require("../middleware/authMiddleware");
const firebaseConfig_1 = require("../utils/firebaseConfig");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
// Whitelist of allowed editable fields for Client during EDIT_REQUEST_APPROVAL
const ALLOWED_CLIENT_FIELDS = new Set([
    'name', 'phone1', 'phone2', 'cep', 'street', 'number', 'condo',
    'block', 'apartment', 'neighborhood', 'city', 'state', 'referencePoint',
    'houseColor', 'gateColor', 'gateObservation', 'profession', 'visitTime',
    'clothesColor', 'notes',
]);
function sanitizeProposedData(data) {
    if (!data || typeof data !== 'object')
        return {};
    const sanitized = {};
    for (const key of Object.keys(data)) {
        if (ALLOWED_CLIENT_FIELDS.has(key)) {
            sanitized[key] = data[key];
        }
    }
    return sanitized;
}
// Lista as notificações do usuário logado
router.get('/', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const companyId = req.user?.companyId;
        if (!userId) {
            res.status(401).json({ error: 'User ID is required' });
            return;
        }
        const notifications = await prisma.notification.findMany({
            where: {
                recipientId: userId,
                ...(companyId ? { companyId } : {}),
                status: { not: 'RESOLVED' },
            },
            include: {
                sender: {
                    select: { name: true },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json(notifications);
    }
    catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Marca uma notificação específica como lida (apenas o próprio destinatário)
router.patch('/:id/read', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const id = req.params.id;
        const userId = req.user?.id;
        const companyId = req.user?.companyId;
        const existing = await prisma.notification.findFirst({
            where: {
                id,
                recipientId: userId,
                ...(companyId ? { companyId } : {}),
            },
        });
        if (!existing) {
            res.status(404).json({ error: 'Notification not found' });
            return;
        }
        const notification = await prisma.notification.update({
            where: { id },
            data: { status: 'READ' },
        });
        res.json(notification);
    }
    catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Executa a ação da notificação e marca como resolvida
router.post('/:id/action', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const id = req.params.id;
        const { actionType } = req.body;
        const userId = req.user?.id;
        const userRole = req.user?.role;
        const userCompanyId = req.user?.companyId;
        const notification = await prisma.notification.findFirst({
            where: {
                id,
                recipientId: userId,
                ...(userCompanyId ? { companyId: userCompanyId } : {}),
            },
        });
        if (!notification) {
            res.status(404).json({ error: 'Notification not found' });
            return;
        }
        if (notification.status === 'RESOLVED') {
            res.status(400).json({ error: 'Notification already resolved' });
            return;
        }
        const isAdminOrSupervisor = ['ADMIN', 'SUPERVISOR', 'COMPANY_ADMIN', 'SUPER_ADMIN'].includes(userRole);
        const actionData = notification.actionData;
        if (actionType === 'UPDATE_KM') {
            if (notification.type === 'KM_REQUEST' && actionData && actionData.carId) {
                const { km } = req.body;
                if (typeof km !== 'number') {
                    res.status(400).json({ error: 'O valor do KM é obrigatório e deve ser numérico' });
                    return;
                }
                const car = await prisma.car.findFirst({
                    where: {
                        id: actionData.carId,
                        ...(userCompanyId ? { companyId: userCompanyId } : {}),
                    },
                });
                if (!car) {
                    res.status(404).json({ error: 'Carro não encontrado' });
                    return;
                }
                if (km < car.currentKm) {
                    res.status(400).json({ error: `KM inválido: o valor (${km}) não pode ser menor que o registrado atualmente (${car.currentKm}).`, code: 'KM_LOWER' });
                    return;
                }
                await prisma.car.update({
                    where: { id: car.id },
                    data: { currentKm: km },
                });
            }
            else {
                res.status(400).json({ error: 'Invalid notification type for UPDATE_KM' });
                return;
            }
        }
        else if (actionType === 'ACCEPT') {
            // Administrative approvals require Admin or Supervisor
            const adminActions = ['COST_APPROVAL', 'STOCK_TRANSFER_COVER', 'STOCK_RETURN_COVER', 'EDIT_REQUEST_APPROVAL'];
            if (adminActions.includes(notification.type) && !isAdminOrSupervisor) {
                res.status(403).json({ error: 'Forbidden: Apenas administradores ou supervisores podem aprovar esta solicitação' });
                return;
            }
            switch (notification.type) {
                case 'COST_APPROVAL':
                    if (actionData && actionData.costId) {
                        await prisma.$transaction(async (tx) => {
                            await tx.cost.update({
                                where: { id: actionData.costId },
                                data: { status: 'APPROVED' },
                            });
                            if (actionData.nextOilChangeKm && actionData.carId) {
                                await tx.car.update({
                                    where: { id: actionData.carId },
                                    data: { nextOilChangeKm: Number(actionData.nextOilChangeKm) },
                                });
                            }
                        });
                    }
                    break;
                case 'STOCK_TRANSFER_COVER':
                    if (actionData && actionData.quantity && notification.senderId) {
                        const quantity = Number(actionData.quantity);
                        await prisma.$transaction(async (tx) => {
                            const sellerBalance = await tx.sellerCoverBalance.findUnique({
                                where: { sellerId: notification.senderId },
                            });
                            if (sellerBalance) {
                                await tx.sellerCoverBalance.update({
                                    where: { sellerId: notification.senderId },
                                    data: { balance: sellerBalance.balance + quantity },
                                });
                            }
                            else {
                                await tx.sellerCoverBalance.create({
                                    data: { sellerId: notification.senderId, balance: quantity },
                                });
                            }
                            await tx.sellerCoverTransfer.create({
                                data: {
                                    sellerId: notification.senderId,
                                    adminId: notification.recipientId,
                                    quantity: quantity,
                                    companyId: notification.companyId,
                                },
                            });
                        });
                    }
                    break;
                case 'COVER_TRANSFER_REQUEST':
                    if (actionData && actionData.transferId && actionData.senderId && actionData.recipientId && actionData.quantity) {
                        // First mark this notification as resolved
                        await prisma.notification.update({
                            where: { id: notification.id },
                            data: { status: 'RESOLVED' },
                        });
                        const otherRole = actionData.role === 'ADMIN' ? 'RECIPIENT' : 'ADMIN';
                        const otherNotifications = await prisma.notification.findMany({
                            where: {
                                type: 'COVER_TRANSFER_REQUEST',
                                actionData: {
                                    path: ['transferId'],
                                    equals: actionData.transferId,
                                },
                                status: 'RESOLVED',
                                id: { not: notification.id },
                            },
                        });
                        let otherAccepted = false;
                        for (const notif of otherNotifications) {
                            const data = notif.actionData;
                            if (data && data.role === otherRole) {
                                otherAccepted = true;
                                break;
                            }
                        }
                        if (otherAccepted) {
                            const quantity = Number(actionData.quantity);
                            await prisma.$transaction(async (tx) => {
                                // Decrement sender
                                await tx.sellerCoverBalance.update({
                                    where: { sellerId: actionData.senderId },
                                    data: { balance: { decrement: quantity } },
                                });
                                // Increment recipient
                                await tx.sellerCoverBalance.upsert({
                                    where: { sellerId: actionData.recipientId },
                                    update: { balance: { increment: quantity } },
                                    create: { sellerId: actionData.recipientId, balance: quantity },
                                });
                                // Mark all related notifications as resolved
                                await tx.notification.updateMany({
                                    where: {
                                        type: 'COVER_TRANSFER_REQUEST',
                                        actionData: {
                                            path: ['transferId'],
                                            equals: actionData.transferId,
                                        },
                                        status: 'UNREAD',
                                    },
                                    data: { status: 'RESOLVED' },
                                });
                            });
                        }
                        else {
                            res.json({ success: true, message: 'Aceite registrado. Aguardando a outra parte.' });
                            return;
                        }
                    }
                    break;
                case 'STOCK_RETURN_COVER':
                    if (actionData && actionData.quantity && notification.senderId) {
                        const quantity = Number(actionData.quantity);
                        await prisma.$transaction(async (tx) => {
                            const sellerBalance = await tx.sellerCoverBalance.findUnique({
                                where: { sellerId: notification.senderId },
                            });
                            if (sellerBalance) {
                                await tx.sellerCoverBalance.update({
                                    where: { sellerId: notification.senderId },
                                    data: { balance: Math.max(0, sellerBalance.balance - quantity) },
                                });
                            }
                            await tx.sellerCoverTransfer.create({
                                data: {
                                    sellerId: notification.senderId,
                                    adminId: notification.recipientId,
                                    quantity: -quantity,
                                    companyId: notification.companyId,
                                },
                            });
                        });
                    }
                    break;
                case 'EDIT_REQUEST_APPROVAL':
                    if (actionData && actionData.editRequestId) {
                        const editRequest = await prisma.clientEditRequest.findFirst({
                            where: {
                                id: actionData.editRequestId,
                                ...(userCompanyId ? { companyId: userCompanyId } : {}),
                            },
                        });
                        if (editRequest && editRequest.status === 'PENDING') {
                            const sanitizedData = sanitizeProposedData(editRequest.proposedData);
                            await prisma.$transaction([
                                prisma.client.update({
                                    where: { id: editRequest.clientId },
                                    data: sanitizedData,
                                }),
                                prisma.clientEditRequest.update({
                                    where: { id: actionData.editRequestId },
                                    data: { status: 'APPROVED' },
                                }),
                            ]);
                        }
                    }
                    break;
            }
        }
        else if (actionType === 'REJECT') {
            const adminActions = ['COST_APPROVAL', 'EDIT_REQUEST_APPROVAL'];
            if (adminActions.includes(notification.type) && !isAdminOrSupervisor) {
                res.status(403).json({ error: 'Forbidden: Apenas administradores ou supervisores podem rejeitar esta solicitação' });
                return;
            }
            if (notification.type === 'COST_APPROVAL' && actionData && actionData.costId) {
                await prisma.cost.update({
                    where: { id: actionData.costId },
                    data: { status: 'REJECTED' },
                });
            }
            if (notification.type === 'EDIT_REQUEST_APPROVAL' && actionData && actionData.editRequestId) {
                const editRequest = await prisma.clientEditRequest.findFirst({
                    where: {
                        id: actionData.editRequestId,
                        ...(userCompanyId ? { companyId: userCompanyId } : {}),
                    },
                });
                if (editRequest && editRequest.status === 'PENDING') {
                    await prisma.clientEditRequest.update({
                        where: { id: actionData.editRequestId },
                        data: { status: 'REJECTED' },
                    });
                }
            }
        }
        // CREATE FEEDBACK NOTIFICATION FOR SENDER
        if (notification.type === 'COST_APPROVAL' && notification.senderId) {
            const sender = await prisma.user.findUnique({ where: { id: notification.senderId } });
            const admin = await prisma.user.findUnique({ where: { id: req.user.id } });
            const statusStr = actionType === 'ACCEPT' ? 'APROVADA' : 'REPROVADA';
            const msg = `Sua despesa lançada foi ${statusStr} por ${admin?.name || 'Admin'}.`;
            await prisma.notification.create({
                data: {
                    title: 'Feedback de Despesa',
                    message: msg,
                    type: 'INFO',
                    status: 'UNREAD',
                    senderId: req.user.id,
                    recipientId: notification.senderId,
                    companyId: notification.companyId,
                },
            });
            if (sender?.fcmToken) {
                await (0, firebaseConfig_1.sendPushNotification)([sender.fcmToken], 'Feedback de Despesa', msg, { type: 'INFO' });
            }
        }
        const updatedNotification = await prisma.notification.update({
            where: { id },
            data: { status: 'RESOLVED' },
        });
        res.json({ success: true, message: 'Action performed', notification: updatedNotification });
    }
    catch (error) {
        console.error('Error actioning notification:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
