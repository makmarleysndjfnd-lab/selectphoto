import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { upload } from '../middleware/upload';

const router = Router();
const prisma = new PrismaClient();

// Register a Sale
router.post('/', authenticateToken, async (req: AuthRequest, res: any) => {
  try {
    const { clientId, value, city, product, status, paymentStatus, fichaNumber, paymentMethod } = req.body;
    const sellerId = req.user.id;

    if (!clientId || !value || !city) {
      return res.status(400).json({ error: 'Client ID, Value, and City are required' });
    }

    const sale = await prisma.sale.create({
      data: {
        clientId,
        sellerId,
        value: parseFloat(value),
        city,
        product: product || "Mídias fotográficas",
        status: status || "PRONTO",
        paymentStatus: paymentStatus || "PAID",
        fichaNumber: fichaNumber || null,
        paymentMethod: paymentMethod || "CASH",
        companyId: req.user?.companyId
      },
    });

    res.status(201).json(sale);
  } catch (error) {
    console.error('Create sale error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Edit a Sale
router.put('/:id', authenticateToken, async (req: AuthRequest, res: any) => {
  try {
    const id = req.params.id as string;
    const { value, product, status, paymentStatus, fichaNumber, paymentMethod } = req.body;
    
    // Check if it belongs to company
    const existing = await prisma.sale.findUnique({ where: { id } });
    if (!existing || existing.companyId !== req.user.companyId) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    const updated = await prisma.sale.update({
      where: { id },
      data: {
        ...(value !== undefined && { value: parseFloat(value as string) }),
        ...(product !== undefined && { product: product as string }),
        ...(status !== undefined && { status: status as string }),
        ...(paymentStatus !== undefined && { paymentStatus: paymentStatus as string }),
        ...(fichaNumber !== undefined && { fichaNumber: fichaNumber as string }),
        ...(paymentMethod !== undefined && { paymentMethod: paymentMethod as string }),
      }
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating sale:', error);
    res.status(500).json({ error: 'Failed to update sale' });
  }
});

// Upload a receipt for a Sale
router.post('/:id/receipt', authenticateToken, upload.single('receipt'), async (req: AuthRequest, res: any) => {
  try {
    const id = req.params.id as string;
    const sellerId = req.user.id;

    if (!req.file) {
      return res.status(400).json({ error: 'Receipt photo is required' });
    }

    const sale = await prisma.sale.findUnique({ where: { id } });
    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    if (sale.sellerId !== sellerId && req.user.role !== 'COMPANY_ADMIN' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied to this sale' });
    }

    // A URL pública é retornada pelo multer-s3 no atributo 'location'
    const receiptUrl = (req.file as any).location;

    const updatedSale = await prisma.sale.update({
      where: { id },
      data: { receiptUrl }
    });

    res.json(updatedSale);
  } catch (error) {
    console.error('Upload receipt error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Register a Non-Sale
router.post('/non-sale', authenticateToken, async (req: AuthRequest, res: any) => {
  try {
    const { clientId, reason, signatureBase64 } = req.body;
    const sellerId = req.user.id;

    if (!clientId || !reason || !signatureBase64) {
      return res.status(400).json({ error: 'Client ID, Reason, and Signature are required' });
    }

    const nonSale = await prisma.nonSale.create({
      data: {
        clientId,
        sellerId,
        reason,
        signatureBase64,
        companyId: req.user?.companyId
      },
    });

    // Update client bookStatus
    await prisma.client.update({
      where: { id: clientId },
      data: { bookStatus: 'AWAITING_RETURN' },
    });

    res.status(201).json(nonSale);
  } catch (error) {
    console.error('Create non-sale error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin Metrics: Get Average Sales per City per Seller
router.get('/metrics', authenticateToken, async (req: AuthRequest, res: any) => {
  try {
    if (req.user?.role !== 'COMPANY_ADMIN' && req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const sales = await prisma.sale.findMany({
      where: { companyId: req.user?.companyId },
      include: {
        seller: {
          select: { name: true }
        }
      }
    });

    // Grouping logic
    const citySellerTotals: Record<string, Record<string, { totalValue: number, count: number }>> = {};

    for (const sale of sales) {
      if (!citySellerTotals[sale.city]) {
        citySellerTotals[sale.city] = {};
      }
      if (!citySellerTotals[sale.city][sale.seller.name]) {
        citySellerTotals[sale.city][sale.seller.name] = { totalValue: 0, count: 0 };
      }
      citySellerTotals[sale.city][sale.seller.name].totalValue += sale.value;
      citySellerTotals[sale.city][sale.seller.name].count += 1;
    }

    const metrics = [];
    for (const city in citySellerTotals) {
      for (const seller in citySellerTotals[city]) {
        const data = citySellerTotals[city][seller];
        metrics.push({
          city,
          seller,
          averageValue: data.totalValue / data.count,
          totalValue: data.totalValue,
          salesCount: data.count
        });
      }
    }

    res.json(metrics);
  } catch (error) {
    console.error('Get metrics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Register an Appointment
router.post('/appointments', authenticateToken, async (req: AuthRequest, res: any) => {
  try {
    const { clientId, date, time, observation } = req.body;
    const responsibleId = req.user.id;

    if (!clientId || !date || !time) {
      return res.status(400).json({ error: 'Client ID, Date, and Time are required' });
    }

    const appointment = await prisma.appointment.create({
      data: {
        clientId,
        responsibleId,
        date: new Date(date),
        time,
        observation,
        companyId: req.user?.companyId
      },
    });

    res.status(201).json(appointment);
  } catch (error) {
    console.error('Create appointment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Register a Photo
router.post('/photos', authenticateToken, async (req: AuthRequest, res: any) => {
  try {
    const { clientId, photoBase64 } = req.body;
    const sellerId = req.user.id;

    if (!clientId || !photoBase64) {
      return res.status(400).json({ error: 'Client ID and Photo are required' });
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 10); // Expiration in 10 days

    const photo = await prisma.sellerPhoto.create({
      data: {
        clientId,
        sellerId,
        photoPath: photoBase64, // In a real app this would save to S3 and save the URL, for now using base64 column
        expiresAt,
        companyId: req.user?.companyId
      },
    });

    res.status(201).json({ id: photo.id, expiresAt: photo.expiresAt });
  } catch (error) {
    console.error('Upload photo error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
