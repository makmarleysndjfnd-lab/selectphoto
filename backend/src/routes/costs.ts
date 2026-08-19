import express, { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { sendPushNotification } from '../utils/firebaseConfig';

const router = express.Router();
const prisma = new PrismaClient();

// Submit a new cost (via Mobile App)
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    const { 
      amount,
      category, 
      subcategory,
      carId,
      description, 
      paymentMethod, 
      receiptUrl,
      nextOilChangeKm
    } = req.body;
    
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      res.status(400).json({ error: 'O valor do custo deve ser um número positivo maior que zero.' });
      return;
    }

    if (!category || typeof category !== 'string') {
      res.status(400).json({ error: 'A categoria do custo é obrigatória.' });
      return;
    }

    const userCompanyId = req.user?.companyId;
    if (!userCompanyId) {
      res.status(400).json({ error: 'Empresa obrigatória para lançar custo' });
      return;
    }

    // Validate carId if provided
    let validCarId: string | null = null;
    if (carId && typeof carId === 'string' && !carId.startsWith('car_')) {
      const car = await prisma.car.findFirst({
        where: { id: carId, companyId: userCompanyId }
      });
      if (car) validCarId = car.id;
    }

    const cost = await prisma.cost.create({
      data: {
        userId: req.user.id,
        teamId: req.user.teamId || null,
        amount: parsedAmount,
        category: String(category).slice(0, 100),
        subcategory: subcategory ? String(subcategory).slice(0, 100) : null,
        carId: validCarId,
        description: description ? String(description).slice(0, 500) : '',
        paymentMethod: paymentMethod ? String(paymentMethod).slice(0, 50) : 'CASH',
        receiptUrl: receiptUrl ? String(receiptUrl).slice(0, 500) : null,
        status: 'PENDING',
        companyId: userCompanyId,
      }
    });



    const admins = await prisma.user.findMany({
      where: { 
        role: { in: ['ADMIN', 'SUPERADMIN', 'COMPANY_ADMIN', 'SUPERVISOR'] },
        ...(userCompanyId ? { companyId: userCompanyId } : {}),
      }
    });

    
    const user = await prisma.user.findUnique({ where: { id: req.user.id }});

    const adminTokens = admins.map(a => a.fcmToken).filter(t => t != null) as string[];

    for (const admin of admins) {
      const actionData: any = { costId: cost.id };
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
      await sendPushNotification(
        adminTokens,
        'Novo Custo para Aprovar',
        `${user?.name || 'Funcionário'} lançou R$ ${parsedAmount.toFixed(2)} de ${category}.`,
        { type: 'COST_APPROVAL', costId: cost.id }
      );
    }

    res.status(201).json(cost);
  } catch (error) {
    console.error('Error saving cost:', error);
    res.status(500).json({ error: 'Failed to save cost' });
  }
});

// Edit a cost (Creator if PENDING, or Admin/Supervisor in the same company)
router.put('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { amount, category, description, paymentMethod } = req.body;
    const userCompanyId = req.user?.companyId;
    const userId = req.user?.id;
    const userRole = req.user?.role || '';
    const isAdminOrSupervisor = ['ADMIN', 'SUPERVISOR', 'COMPANY_ADMIN', 'SUPER_ADMIN'].includes(userRole);
    
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

    let parsedAmount: number | undefined = undefined;
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
  } catch (error) {
    console.error('Error updating cost:', error);
    res.status(500).json({ error: 'Failed to update cost' });
  }
});

export default router;

