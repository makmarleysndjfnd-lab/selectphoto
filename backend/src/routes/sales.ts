import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { upload, getUploadedFileUrl } from '../middleware/upload';

const router = Router();
const prisma = new PrismaClient();

// Register a Sale
router.post('/', authenticateToken, async (req: AuthRequest, res: any) => {
  try {
    const { clientId, value, city, product, status, paymentStatus, fichaNumber, paymentMethod } = req.body;
    const sellerId = req.user?.id;
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    if (!clientId || value === undefined || !city) {
      return res.status(400).json({ error: 'Client ID, Value, and City are required' });
    }

    const parsedValue = Number(value);
    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
      return res.status(400).json({ error: 'Invalid sale value: must be a positive finite number' });
    }

    // Verificar se o cliente pertence à empresa do usuário
    const client = await prisma.client.findFirst({
      where: {
        id: clientId,
        companyId,
      },
    });

    if (!client) {
      return res.status(404).json({ error: 'Client not found in your company' });
    }

    const sale = await prisma.sale.create({
      data: {
        clientId,
        sellerId: sellerId as string,
        value: parsedValue,
        city: String(city).trim(),
        product: product ? String(product).trim() : "Mídias fotográficas",
        status: status || "PRONTO",
        paymentStatus: paymentStatus || "PAID",
        fichaNumber: fichaNumber ? String(fichaNumber).trim() : null,
        paymentMethod: paymentMethod || "CASH",
        companyId,
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
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }
    
    // Check if it belongs to company
    const existing = await prisma.sale.findFirst({
      where: {
        id,
        companyId,
      }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    // Vendedor altera apenas a própria venda; admin/supervisor/gerente pode alterar
    const isSeller = ['SELLER', 'PHOTOGRAPHER', 'OPERATOR'].includes(req.user?.role || '');
    const isManager = ['ADMIN', 'SUPERVISOR', 'SELLER_MANAGER', 'COMPANY_ADMIN', 'SUPER_ADMIN'].includes(req.user?.role || '');

    if (isSeller && existing.sellerId !== req.user?.id) {
      return res.status(403).json({ error: 'Forbidden: Vendedor só pode alterar a própria venda' });
    }

    if (!isSeller && !isManager) {
      return res.status(403).json({ error: 'Forbidden: Sem permissão para alterar venda' });
    }

    let parsedValue: number | undefined;
    if (value !== undefined) {
      parsedValue = Number(value);
      if (!Number.isFinite(parsedValue) || parsedValue < 0) {
        return res.status(400).json({ error: 'Invalid sale value' });
      }
    }

    const updated = await prisma.sale.update({
      where: { id },
      data: {
        ...(parsedValue !== undefined && { value: parsedValue }),
        ...(product !== undefined && { product: String(product).trim() }),
        ...(status !== undefined && { status: status as string }),
        ...(paymentStatus !== undefined && { paymentStatus: paymentStatus as string }),
        ...(fichaNumber !== undefined && { fichaNumber: String(fichaNumber).trim() }),
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
    const sellerId = req.user?.id;
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Receipt photo is required' });
    }

    const sale = await prisma.sale.findFirst({
      where: {
        id,
        companyId,
      }
    });

    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    if (sale.sellerId !== sellerId && !['COMPANY_ADMIN', 'ADMIN', 'SUPERVISOR', 'SELLER_MANAGER', 'SUPER_ADMIN'].includes(req.user?.role || '')) {
      return res.status(403).json({ error: 'Access denied to this sale' });
    }

    const receiptUrl = getUploadedFileUrl(req.file);

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
    const { clientId, reason, signatureBase64, signatureUrl } = req.body;
    const sellerId = req.user?.id;
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    if (!clientId || !reason || (!signatureBase64 && !signatureUrl)) {
      return res.status(400).json({ error: 'Client ID, Reason, and Signature are required' });
    }

    // Verificar se o cliente pertence à mesma empresa
    const client = await prisma.client.findFirst({
      where: {
        id: clientId,
        companyId,
      },
    });

    if (!client) {
      return res.status(404).json({ error: 'Client not found in your company' });
    }

    let finalSigUrl = signatureUrl;
    if (signatureBase64) {
      finalSigUrl = signatureBase64.startsWith('data:')
        ? signatureBase64
        : `data:image/png;base64,${signatureBase64}`;
    }

    // Transação atômica criando a Não-Venda e atualizando o status da ficha
    const result = await prisma.$transaction(async (tx) => {
      const nonSale = await tx.nonSale.create({
        data: {
          clientId,
          sellerId: sellerId as string,
          reason: String(reason).trim(),
          signatureUrl: finalSigUrl,
          companyId,
        },
      });

      await tx.client.update({
        where: { id: clientId },
        data: { bookStatus: 'AWAITING_RETURN' },
      });

      return nonSale;
    });

    res.status(201).json(result);
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

    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: 'Empresa não identificada' });

    const sales = await prisma.sale.findMany({
      where: { companyId },
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
    const responsibleId = req.user?.id;
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    if (!clientId || !date || !time) {
      return res.status(400).json({ error: 'Client ID, Date, and Time are required' });
    }

    // Verificar se o cliente pertence à empresa do usuário
    const client = await prisma.client.findFirst({
      where: {
        id: clientId,
        companyId,
      }
    });

    if (!client) {
      return res.status(404).json({ error: 'Client not found in your company' });
    }

    const appointment = await prisma.appointment.create({
      data: {
        clientId,
        responsibleId,
        date: new Date(date),
        time: String(time).trim(),
        observation: observation ? String(observation).trim() : null,
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
    const sellerId = req.user?.id;
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    if (!clientId || !photoBase64) {
      return res.status(400).json({ error: 'Client ID and Photo are required' });
    }

    // Verificar se o cliente pertence à empresa do usuário
    const client = await prisma.client.findFirst({
      where: {
        id: clientId,
        companyId,
      }
    });

    if (!client) {
      return res.status(404).json({ error: 'Client not found in your company' });
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 10);

    const photo = await prisma.sellerPhoto.create({
      data: {
        clientId,
        sellerId: sellerId as string,
        photoPath: photoBase64,
        expiresAt,
        companyId,
      },
    });

    res.status(201).json({ id: photo.id, expiresAt: photo.expiresAt });
  } catch (error) {
    console.error('Upload photo error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
