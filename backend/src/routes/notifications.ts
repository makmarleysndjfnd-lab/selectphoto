import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { sendPushNotification } from '../utils/firebaseConfig';

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

    if (actionType === 'UPDATE_KM') {
      if (notification.type === 'KM_REQUEST' && actionData && actionData.carId) {
        const { km } = req.body;
        if (typeof km !== 'number') {
          return res.status(400).json({ error: 'O valor do KM é obrigatório e deve ser numérico' });
        }
        
        const car = await prisma.car.findUnique({ where: { id: actionData.carId } });
        if (!car) {
          return res.status(404).json({ error: 'Carro não encontrado' });
        }
        
        if (km < car.currentKm) {
          return res.status(400).json({ error: `KM inválido: o valor (${km}) não pode ser menor que o registrado atualmente (${car.currentKm}).`, code: 'KM_LOWER' });
        }
        
        await prisma.car.update({
          where: { id: car.id },
          data: { currentKm: km }
        });
      } else {
        return res.status(400).json({ error: 'Invalid notification type for UPDATE_KM' });
      }
    } else if (actionType === 'ACCEPT') {
      switch (notification.type) {
        case 'COST_APPROVAL':
          if (actionData && actionData.costId) {
            await prisma.cost.update({
              where: { id: actionData.costId },
              data: { status: 'APPROVED' }
            });
            if (actionData.nextOilChangeKm && actionData.carId) {
              await prisma.car.update({
                where: { id: actionData.carId },
                data: { nextOilChangeKm: Number(actionData.nextOilChangeKm) }
              });
            }
          }
          break;
        case 'STOCK_TRANSFER_COVER':
          if (actionData && actionData.quantity && notification.senderId) {
            const quantity = Number(actionData.quantity);
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
        case 'COVER_TRANSFER_REQUEST':
          if (actionData && actionData.transferId && actionData.senderId && actionData.recipientId && actionData.quantity) {
            // First mark this notification as resolved
            await prisma.notification.update({
              where: { id: notification.id },
              data: { status: 'RESOLVED' }
            });

            // Check if the other party also accepted (has it been resolved?)
            const otherRole = actionData.role === 'ADMIN' ? 'RECIPIENT' : 'ADMIN';
            
            // Note: Since there could be multiple admins, any admin accepting is enough for the ADMIN role.
            // But if there are multiple admin notifications, we just check if AT LEAST ONE admin has RESOLVED it, 
            // OR if this is the admin, we check if the RECIPIENT has RESOLVED it.
            const otherNotifications = await prisma.notification.findMany({
              where: {
                 type: 'COVER_TRANSFER_REQUEST',
                 actionData: {
                   path: ['transferId'],
                   equals: actionData.transferId
                 },
                 status: 'RESOLVED',
                 id: { not: notification.id } // exclude current one
              }
            });

            // We need to see if the other role has accepted. 
            // The actionData in JSON contains the role.
            let otherAccepted = false;
            for (const notif of otherNotifications) {
                const data = notif.actionData as any;
                if (data && data.role === otherRole) {
                    otherAccepted = true;
                    break;
                }
            }

            if (otherAccepted) {
               // Execute transfer
               const quantity = Number(actionData.quantity);
               
               // Decrement sender
               await prisma.sellerCoverBalance.update({
                  where: { sellerId: actionData.senderId },
                  data: { balance: { decrement: quantity } }
               });

               // Increment recipient
               await prisma.sellerCoverBalance.upsert({
                  where: { sellerId: actionData.recipientId },
                  update: { balance: { increment: quantity } },
                  create: { sellerId: actionData.recipientId, balance: quantity }
               });
               
               // Mark all related notifications as resolved so we don't duplicate
               await prisma.notification.updateMany({
                  where: {
                     type: 'COVER_TRANSFER_REQUEST',
                     actionData: {
                       path: ['transferId'],
                       equals: actionData.transferId
                     },
                     status: 'UNREAD'
                  },
                  data: { status: 'RESOLVED' }
               });
            } else {
               // Just return early since we already marked this one as resolved
               return res.json({ success: true, message: 'Aceite registrado. Aguardando a outra parte.' });
            }
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
              const proposedData = editRequest.proposedData as any;
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
    } else if (actionType === 'REJECT') {
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
        await sendPushNotification(
          [sender.fcmToken],
          'Feedback de Despesa',
          msg,
          { type: 'INFO' }
        );
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
