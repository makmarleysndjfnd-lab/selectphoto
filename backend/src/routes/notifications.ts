import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';

const router = Router();
const prisma = new PrismaClient();

// Lista as notificações do usuário logado
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
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
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Marca uma notificação específica como lida
router.patch('/:id/read', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const notification = await prisma.notification.update({
      where: { id },
      data: { status: 'READ' }
    });
    res.json(notification);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Executa a ação da notificação e marca como resolvida
router.post('/:id/action', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
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

    const actionData = notification.actionData as any;

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
            } else {
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
        // Outros casos (STOCK_TRANSFER_BOOK, etc)
      }
    } else if (actionType === 'REJECT') {
       if (notification.type === 'COST_APPROVAL') {
          if (actionData && actionData.costId) {
            await prisma.cost.update({
              where: { id: actionData.costId },
              data: { status: 'REJECTED' }
            });
          }
       }
    }

    const updatedNotification = await prisma.notification.update({
      where: { id },
      data: { status: 'RESOLVED' }
    });
    
    res.json({ success: true, message: 'Action performed', notification: updatedNotification });
  } catch (error) {
    console.error('Error actioning notification:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
