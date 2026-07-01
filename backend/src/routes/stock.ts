import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken as authMiddleware, AuthRequest } from '../middleware/authMiddleware';

const router = express.Router();
const prisma = new PrismaClient();

// Add stock batch
router.post('/batch', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { quantity, companyId } = req.body;
    
    // Fallback to user company if not provided
    const userCompanyId = req.user?.companyId;
    const finalCompanyId = companyId || userCompanyId;

    const batch = await prisma.coverStockBatch.create({
      data: {
        quantity: parseInt(quantity),
        companyId: finalCompanyId,
      },
    });

    res.status(201).json(batch);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// List stock batches
router.get('/batch', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const companyId = req.user?.companyId;
    const batches = await prisma.coverStockBatch.findMany({
      where: companyId ? { companyId } : undefined,
      orderBy: { entryDate: 'asc' },
    });
    res.json(batches);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get total stock info (Admin hand vs Seller hand)
router.get('/info', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const companyId = req.user?.companyId;
        
        // Sum all current valid stock from admin batches
        const adminBatches = await prisma.coverStockBatch.aggregate({
            where: companyId ? { companyId } : undefined,
            _sum: { quantity: true }
        });

        // Sum all covers transferred to sellers
        const sellerTransfers = await prisma.sellerCoverTransfer.aggregate({
            where: companyId ? { companyId } : undefined,
            _sum: { quantity: true }
        });

        const totalInAdmin = (adminBatches._sum.quantity || 0) - (sellerTransfers._sum.quantity || 0);

        // Get total currently in sellers hands 
        const sellersBalance = await prisma.sellerCoverBalance.findMany({
            where: companyId ? { seller: { companyId } } : undefined,
            include: { seller: true }
        });

        const totalWithSellers = sellersBalance.reduce((acc, curr) => acc + curr.balance, 0);

        res.json({
            totalInAdmin,
            totalWithSellers,
            sellers: sellersBalance
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Transfer covers to seller (Add, Edit, Delete)
router.post('/transfer', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { sellerId, quantity, companyId } = req.body;
        const adminId = req.user?.id;

        if (!adminId) return res.status(401).json({ error: 'Unauthorized' });

        const transfer = await prisma.$transaction(async (tx) => {
            const newTransfer = await tx.sellerCoverTransfer.create({
                data: {
                    sellerId,
                    adminId,
                    quantity: parseInt(quantity),
                    companyId: companyId || req.user?.companyId,
                }
            });

            // Update balance
            const balance = await tx.sellerCoverBalance.upsert({
                where: { sellerId },
                update: { balance: { increment: parseInt(quantity) } },
                create: { sellerId, balance: parseInt(quantity) }
            });

            return { transfer: newTransfer, balance };
        });

        res.status(201).json(transfer);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
