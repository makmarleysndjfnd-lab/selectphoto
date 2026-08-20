import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { sendPushNotification } from '../utils/firebaseConfig';

const router = Router();
const prisma = new PrismaClient();

// Whitelist of allowed editable fields for Client during EDIT_REQUEST_APPROVAL
const ALLOWED_CLIENT_FIELDS = new Set([
  'name', 'phone1', 'phone2', 'cep', 'street', 'number', 'condo',
  'block', 'apartment', 'neighborhood', 'city', 'state', 'referencePoint',
  'houseColor', 'gateColor', 'gateObservation', 'profession', 'visitTime',
  'clothesColor', 'notes',
]);

function sanitizeProposedData(data: any): Record<string, any> {
  if (!data || typeof data !== 'object') return {};
  const sanitized: Record<string, any> = {};
  for (const key of Object.keys(data)) {
    if (ALLOWED_CLIENT_FIELDS.has(key)) {
      sanitized[key] = data[key];
    }
  }
  return sanitized;
}

// Lista as notificações do usuário logado
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const companyId = req.user?.companyId;

    if (!userId) {
      res.status(401).json({ error: 'User ID is required' });
      return;
    }

    if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }

    const notifications = await prisma.notification.findMany({
      where: {
        recipientId: userId,
        companyId: companyId || undefined,
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
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Marca uma notificação específica como lida (apenas o próprio destinatário)
router.patch('/:id/read', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = req.user?.id;
    const companyId = req.user?.companyId;

    if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }

    const existing = await prisma.notification.findFirst({
      where: {
        id,
        recipientId: userId,
        companyId: companyId || undefined,
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
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Executa a ação da notificação e marca como resolvida
router.post('/:id/action', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { actionType } = req.body;
    const userId = req.user?.id;
    const userRole = req.user?.role || '';
    const userCompanyId = req.user?.companyId;

    if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }

    const notification = await prisma.notification.findFirst({
      where: {
        id,
        recipientId: userId,
        companyId: userCompanyId || undefined,
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

    const isAdminOrSupervisor = ['ADMIN', 'SUPERVISOR', 'SELLER_MANAGER', 'COMPANY_ADMIN', 'SUPER_ADMIN'].includes(userRole);
    const actionData = notification.actionData as any;

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
            companyId: userCompanyId || undefined,
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
      } else {
        res.status(400).json({ error: 'Invalid notification type for UPDATE_KM' });
        return;
      }
    } else if (actionType === 'COST_APPROVE' || actionType === 'COST_REJECT') {
      if (!isAdminOrSupervisor) {
        res.status(403).json({ error: 'Apenas Administradores ou Supervisores podem aprovar/rejeitar custos' });
        return;
      }
      if (notification.type === 'COST_APPROVAL' && actionData && actionData.costId) {
        const newStatus = actionType === 'COST_APPROVE' ? 'APPROVED' : 'REJECTED';
        
        const cost = await prisma.cost.findFirst({
          where: {
            id: actionData.costId,
            companyId: userCompanyId || undefined,
          }
        });

        if (!cost) {
          res.status(404).json({ error: 'Custo não encontrado na sua empresa' });
          return;
        }

        await prisma.cost.update({
          where: { id: cost.id },
          data: { status: newStatus }
        });

        if (actionType === 'COST_APPROVE' && actionData.nextOilChangeKm && actionData.carId) {
          await prisma.car.update({
            where: { id: actionData.carId },
            data: { nextOilChangeKm: actionData.nextOilChangeKm }
          });
        }

        if (notification.senderId) {
          const sender = await prisma.user.findUnique({ where: { id: notification.senderId } });
          if (sender && sender.fcmToken) {
            const verb = newStatus === 'APPROVED' ? 'Aprovado' : 'Rejeitado';
            await sendPushNotification(
              [sender.fcmToken],
              `Custo ${verb}`,
              `Seu lançamento de custo de R$ ${cost.amount.toFixed(2)} foi ${verb.toLowerCase()}.`,
              { type: 'COST_STATUS_UPDATE', costId: cost.id, status: newStatus }
            );
          }
        }
      } else {
        res.status(400).json({ error: 'Invalid notification type for COST action' });
        return;
      }
    } else if (actionType === 'EDIT_REQUEST_APPROVE' || actionType === 'EDIT_REQUEST_REJECT') {
      if (!isAdminOrSupervisor) {
        res.status(403).json({ error: 'Apenas Administradores ou Supervisores podem aprovar/rejeitar edições' });
        return;
      }
      if (notification.type === 'EDIT_REQUEST_APPROVAL' && actionData && actionData.editRequestId) {
        const newStatus = actionType === 'EDIT_REQUEST_APPROVE' ? 'APPROVED' : 'REJECTED';
        
        const editRequest = await prisma.clientEditRequest.findFirst({
          where: {
            id: actionData.editRequestId,
            companyId: userCompanyId || undefined,
          }
        });

        if (!editRequest) {
          res.status(404).json({ error: 'Solicitação de edição não encontrada' });
          return;
        }

        if (editRequest.status !== 'PENDING') {
          res.status(400).json({ error: 'Solicitação já processada' });
          return;
        }

        if (newStatus === 'APPROVED') {
          const sanitizedData = sanitizeProposedData(editRequest.proposedData);
          await prisma.$transaction([
            prisma.client.update({
              where: { id: editRequest.clientId },
              data: sanitizedData,
            }),
            prisma.clientEditRequest.update({
              where: { id: editRequest.id },
              data: { status: 'APPROVED' },
            }),
          ]);
        } else {
          await prisma.clientEditRequest.update({
            where: { id: editRequest.id },
            data: { status: 'REJECTED' },
          });
        }
      } else {
        res.status(400).json({ error: 'Invalid notification type for EDIT_REQUEST action' });
        return;
      }
    } else if (actionType === 'DISMISS') {
      // Just mark resolved
    } else {
      res.status(400).json({ error: 'Unknown actionType' });
      return;
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { status: 'RESOLVED' },
    });

    res.json({ message: 'Action executed and notification resolved', notification: updated });
  } catch (error: any) {
    console.error('Error executing notification action:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
