"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const authMiddleware_1 = require("../middleware/authMiddleware");
const firebaseConfig_1 = require("../utils/firebaseConfig");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
// Lista as notificações do usuário logado
router.get('/', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'User ID is required' });
        }
        const notifications = await prisma.notification.findMany({
            where: {
                recipientId: userId,
                status: { not: 'RESOLVED' } // Mostra UNREAD e READ
            },
            include: {
                sender: {
                    select: { name: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(notifications);
    }
    catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Marca uma notificação específica como lida
router.patch('/:id/read', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const id = req.params.id;
        const notification = await prisma.notification.update({
            where: { id },
            data: { status: 'READ' }
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
        const { actionType } = req.body; // 'ACCEPT' ou 'REJECT'
        const notification = await prisma.notification.findUnique({
            where: { id }
        });
        if (!notification) {
            return res.status(404).json({ error: 'Notification not found' });
        }
        if (notification.status === 'RESOLVED') {
            return res.status(400).json({ error: 'Notification already resolved' });
        }
        const actionData = notification.actionData;
        if (actionType === 'ACCEPT') {
            switch (notification.type) {
                case 'COST_APPROVAL':
                    if (actionData && actionData.costId) {
                        await prisma.cost.update({
                            where: { id: actionData.costId },
                            data: { status: 'APPROVED' }
                        });
                    }
                    break;
                case 'STOCK_TRANSFER_COVER':
                    if (actionData && actionData.quantity && notification.senderId) {
                        const quantity = Number(actionData.quantity);
                        // Decrease Admin balance implicitly (or we don't track admin cover balance globally)
                        // Just update SellerCoverBalance
                        const sellerBalance = await prisma.sellerCoverBalance.findUnique({
                            where: { sellerId: notification.senderId }
                        });
                        if (sellerBalance) {
                            await prisma.sellerCoverBalance.update({
                                where: { sellerId: notification.senderId },
                                data: { balance: sellerBalance.balance + quantity }
                            });
                        }
                        else {
                            await prisma.sellerCoverBalance.create({
                                data: { sellerId: notification.senderId, balance: quantity }
                            });
                        }
                        // Record transfer history
                        await prisma.sellerCoverTransfer.create({
                            data: {
                                sellerId: notification.senderId,
                                adminId: notification.recipientId,
                                quantity: quantity,
                                companyId: notification.companyId
                            }
                        });
                    }
                    break;
                case 'STOCK_RETURN_COVER':
                    if (actionData && actionData.quantity && notification.senderId) {
                        const quantity = Number(actionData.quantity);
                        const sellerBalance = await prisma.sellerCoverBalance.findUnique({
                            where: { sellerId: notification.senderId }
                        });
                        if (sellerBalance) {
                            await prisma.sellerCoverBalance.update({
                                where: { sellerId: notification.senderId },
                                // Decrements balance on return
                                data: { balance: Math.max(0, sellerBalance.balance - quantity) }
                            });
                        }
                        // Record transfer history with negative quantity to signify return
                        await prisma.sellerCoverTransfer.create({
                            data: {
                                sellerId: notification.senderId,
                                adminId: notification.recipientId,
                                quantity: -quantity,
                                companyId: notification.companyId
                            }
                        });
                    }
                    break;
                case 'EDIT_REQUEST_APPROVAL':
                    if (actionData && actionData.editRequestId) {
                        const editRequest = await prisma.clientEditRequest.findUnique({
                            where: { id: actionData.editRequestId }
                        });
                        if (editRequest && editRequest.status === 'PENDING') {
                            const proposedData = editRequest.proposedData;
                            await prisma.client.update({
                                where: { id: editRequest.clientId },
                                data: { ...proposedData }
                            });
                            await prisma.clientEditRequest.update({
                                where: { id: actionData.editRequestId },
                                data: { status: 'APPROVED' }
                            });
                        }
                    }
                    break;
            }
        }
        else if (actionType === 'REJECT') {
            if (notification.type === 'COST_APPROVAL' && actionData && actionData.costId) {
                await prisma.cost.update({
                    where: { id: actionData.costId },
                    data: { status: 'REJECTED' }
                });
            }
            if (notification.type === 'EDIT_REQUEST_APPROVAL' && actionData && actionData.editRequestId) {
                const editRequest = await prisma.clientEditRequest.findUnique({
                    where: { id: actionData.editRequestId }
                });
                if (editRequest && editRequest.status === 'PENDING') {
                    await prisma.clientEditRequest.update({
                        where: { id: actionData.editRequestId },
                        data: { status: 'REJECTED' }
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
                    companyId: notification.companyId
                }
            });
            if (sender?.fcmToken) {
                await (0, firebaseConfig_1.sendPushNotification)([sender.fcmToken], 'Feedback de Despesa', msg, { type: 'INFO' });
            }
        }
        const updatedNotification = await prisma.notification.update({
            where: { id },
            data: { status: 'RESOLVED' }
        });
        res.json({ success: true, message: 'Action performed', notification: updatedNotification });
    }
    catch (error) {
        console.error('Error actioning notification:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
