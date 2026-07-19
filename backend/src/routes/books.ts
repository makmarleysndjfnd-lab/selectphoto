import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken as authMiddleware, AuthRequest } from '../middleware/authMiddleware';

const router = express.Router();
const prisma = new PrismaClient();

// Close Event Batch (Photographer)
router.post('/close-event', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { eventName } = req.body;
        const photographerId = req.user?.id;
        const companyId = req.user?.companyId;

        if (!photographerId || !eventName) return res.status(400).json({ error: 'Missing photographer or event' });

        // Find all CREATED clients for this event
        const clients = await prisma.client.findMany({
            where: {
                photographerId,
                event: eventName,
                bookStatus: 'CREATED',
                companyId
            }
        });

        if (clients.length === 0) {
            return res.status(404).json({ error: 'Nenhuma ficha CREATED encontrada para este evento.' });
        }

        // Create the batch
        const batch = await prisma.bookBatch.create({
            data: {
                name: `Lote - ${eventName}`,
                photographerId,
                companyId,
                status: 'AWAITING_RELEASE'
            }
        });

        // Update all clients to AWAITING_RELEASE
        await prisma.client.updateMany({
            where: { id: { in: clients.map(c => c.id) } },
            data: { 
                bookStatus: 'AWAITING_RELEASE',
                batchId: batch.id 
            }
        });

        res.status(201).json({ message: `${clients.length} fichas enviadas para a gráfica.`, batch });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Release batch to stock (Admin)
router.put('/batch/:id/release', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId;

        const batch = await prisma.bookBatch.update({
            where: { id: id as string, companyId },
            data: { status: 'IN_STOCK' }
        });

        await prisma.client.updateMany({
            where: { batchId: id as string, companyId },
            data: { bookStatus: 'IN_STOCK' }
        });

        res.json({ message: 'Lote liberado para estoque', batch });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Receive returned book (Admin)
router.post('/receive-return', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { sequenceNumber } = req.body;
        const companyId = req.user?.companyId;

        const client = await prisma.client.findUnique({
            where: { sequenceNumber }
        });

        if (!client || client.companyId !== companyId) return res.status(404).json({ error: 'Book not found' });
        if (client.bookStatus !== 'AWAITING_RETURN') return res.status(400).json({ error: 'Book is not awaiting return' });

        const updated = await prisma.client.update({
            where: { id: client.id },
            data: { bookStatus: 'IN_STOCK_REBOLO', assignedSellerId: null }
        });

        res.json(updated);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Search book (Seller)
router.get('/search', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { q } = req.query;
        const companyId = req.user?.companyId;

        if (!q) return res.json([]);

        const clients = await prisma.client.findMany({
            where: {
                companyId,
                OR: [
                    { sequenceNumber: { contains: q as string, mode: 'insensitive' } },
                    { name: { contains: q as string, mode: 'insensitive' } }
                ]
            },
            select: {
                id: true,
                sequenceNumber: true,
                name: true,
                bookStatus: true,
                assignedSeller: {
                    select: { name: true }
                }
            },
            take: 10
        });

        res.json(clients);
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

export default router;
