import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { sendPushNotification } from '../utils/firebaseConfig';
const router = express.Router();
const prisma = new PrismaClient();

// Submit a new cost (via Mobile App)
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { 
      amount,
      category, 
      subcategory,
      carId,
      description, 
      paymentMethod, 
      receiptUrl 
    } = req.body;
    
    // Validate carId format (UUID) - if it's mock, ignore it
    let validCarId = carId;
    if (carId && carId.startsWith('car_')) validCarId = null;

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

    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', companyId: req.user.companyId }
    });
    
    const user = await prisma.user.findUnique({ where: { id: req.user.id }});

    const adminTokens = admins.map(a => a.fcmToken).filter(t => t != null) as string[];

    for (const admin of admins) {
      // Don't send notification to the same admin who launched it (unless they are the only one)
      // Actually, let's send it to all admins including the creator so they see it in the panel!
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

    await sendPushNotification(
      adminTokens,
      'Novo Custo para Aprovar',
      `${user?.name || 'Funcionário'} lançou R$ ${amount} de ${category}.`,
      { type: 'COST_APPROVAL', costId: cost.id }
    );

    res.status(201).json(cost);
  } catch (error) {
    console.error('Error saving cost:', error);
    res.status(500).json({ error: 'Failed to save cost' });
  }
});

// Edit a cost
router.put('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { amount, category, description, paymentMethod } = req.body;
    
    // Check if it belongs to company
    const existing = await prisma.cost.findUnique({ where: { id } });
    if (!existing || existing.companyId !== req.user.companyId) {
      return res.status(404).json({ error: 'Cost not found' });
    }

    const updated = await prisma.cost.update({
      where: { id },
      data: {
        ...(amount !== undefined && { amount: parseFloat(amount as string) }),
        ...(category !== undefined && { category: category as string }),
        ...(description !== undefined && { description: description as string }),
        ...(paymentMethod !== undefined && { paymentMethod: paymentMethod as string }),
      }
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating cost:', error);
    res.status(500).json({ error: 'Failed to update cost' });
  }
});

export default router;
