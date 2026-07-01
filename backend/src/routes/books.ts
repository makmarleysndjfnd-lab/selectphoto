import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken as authMiddleware, AuthRequest } from '../middleware/authMiddleware';

const router = express.Router();
const prisma = new PrismaClient();

// Add book batch (Photographer)
router.post('/batch', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { name } = req.body;
        const photographerId = req.user?.id;
        
        if (!photographerId) return res.status(401).json({ error: 'Unauthorized' });

        const batch = await prisma.bookBatch.create({
            data: {
                name,
                photographerId,
                companyId: req.user?.companyId,
            }
        });

        res.status(201).json(batch);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// List book batches
router.get('/batch', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const companyId = req.user?.companyId;
        const batches = await prisma.bookBatch.findMany({
            where: companyId ? { companyId } : undefined,
            include: { photographer: true },
            orderBy: { date: 'desc' }
        });

        res.json(batches);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Update book batch status (Admin ramifications)
router.put('/batch/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const batch = await prisma.bookBatch.update({
            where: { id: id as string },
            data: { status }
        });

        res.json(batch);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
