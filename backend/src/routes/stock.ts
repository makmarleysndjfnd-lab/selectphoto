import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken as authMiddleware, AuthRequest } from '../middleware/authMiddleware';
import { sendPushNotification } from '../utils/firebaseConfig';
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

// Seller requests to return covers to Admin
router.post('/return-cover', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { quantity } = req.body;
        const sellerId = req.user?.id;
        const companyId = req.user?.companyId;

        if (!sellerId) return res.status(401).json({ error: 'Unauthorized' });

        const seller = await prisma.user.findUnique({ where: { id: sellerId } });

        const admins = await prisma.user.findMany({
            where: { role: 'ADMIN', companyId }
        });

        const adminTokens = admins.map(a => a.fcmToken).filter(t => t != null) as string[];

        for (const admin of admins) {
            await prisma.notification.create({
                data: {
                    title: 'Devolução de Capas',
                    message: `${seller?.name || 'Vendedor'} deseja devolver ${quantity} capas.`,
                    type: 'STOCK_RETURN_COVER',
                    status: 'UNREAD',
                    actionData: { quantity },
                    senderId: sellerId,
                    recipientId: admin.id,
                    companyId
                }
            });
        }

        await sendPushNotification(
          adminTokens,
          'Devolução de Capas',
          `${seller?.name || 'Vendedor'} deseja devolver ${quantity} capas.`,
          { type: 'STOCK_RETURN_COVER', quantity }
        );

        res.status(201).json({ success: true, message: 'Return request sent' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// User (Seller/Photographer) requests covers/books from another user or Admin
router.post('/request-transfer', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { recipientId, quantity, itemType } = req.body; // itemType: 'COVER' or 'BOOK'
        const senderId = req.user?.id;
        const companyId = req.user?.companyId;

        if (!senderId || !recipientId) return res.status(400).json({ error: 'Missing parameters' });

        const sender = await prisma.user.findUnique({ where: { id: senderId } });
        const recipient = await prisma.user.findUnique({ where: { id: recipientId } });

        if (!sender || !recipient) return res.status(404).json({ error: 'User not found' });

        const notifType = itemType === 'BOOK' ? 'STOCK_TRANSFER_BOOK' : 'STOCK_TRANSFER_COVER';
        const itemName = itemType === 'BOOK' ? 'Books' : 'Capas';

        // Notify the recipient (they must accept to give the items)
        await prisma.notification.create({
            data: {
                title: `Solicitação de ${itemName}`,
                message: `${sender.name} está solicitando ${quantity} ${itemName}.`,
                type: notifType,
                status: 'UNREAD',
                actionData: { quantity, itemType },
                senderId: senderId,
                recipientId: recipientId,
                companyId
            }
        });

        if (recipient.fcmToken) {
            await sendPushNotification(
                [recipient.fcmToken],
                `Solicitação de ${itemName}`,
                `${sender.name} está solicitando ${quantity} ${itemName}.`,
                { type: notifType, quantity }
            );
        }

        // Notify Admin as well (just for visibility/INFO)
        const admins = await prisma.user.findMany({
            where: { role: 'ADMIN', companyId }
        });
        const adminTokens = admins.filter(a => a.fcmToken != null && a.id !== recipientId).map(a => a.fcmToken as string);

        for (const admin of admins) {
            if (admin.id === recipientId) continue; // already notified above
            await prisma.notification.create({
                data: {
                    title: `Nova Solicitação de ${itemName}`,
                    message: `${sender.name} solicitou ${quantity} ${itemName} para ${recipient.name}.`,
                    type: 'INFO',
                    status: 'UNREAD',
                    senderId: senderId,
                    recipientId: admin.id,
                    companyId
                }
            });
        }

        if (adminTokens.length > 0) {
            await sendPushNotification(
                adminTokens,
                `Nova Solicitação de ${itemName}`,
                `${sender.name} solicitou ${quantity} ${itemName} para ${recipient.name}.`,
                { type: 'INFO' }
            );
        }

        res.status(201).json({ success: true, message: 'Transfer request sent' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
