import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';

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

    res.status(201).json(cost);
  } catch (error) {
    console.error('Error saving cost:', error);
    res.status(500).json({ error: 'Failed to save cost' });
  }
});

export default router;
