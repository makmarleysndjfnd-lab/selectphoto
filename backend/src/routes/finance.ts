import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';

const router = express.Router();
const prisma = new PrismaClient();

// Get financial overview global
router.get('/overview', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const sales = await prisma.sale.findMany({
      where: { companyId: req.user?.companyId },
      orderBy: { date: 'desc' },
      take: 50,
      include: {
        seller: { select: { name: true } },
        client: { select: { name: true } }
      }
    });

    const costs = await prisma.cost.findMany({
      where: { status: 'APPROVED', companyId: req.user?.companyId },
      orderBy: { date: 'desc' },
      take: 50,
      include: {
        user: { select: { name: true } }
      }
    });

    const prospects = await prisma.commercialEvent.findMany({
      where: { isProspect: true, expectedRevenue: { gt: 0 }, companyId: req.user?.companyId },
      orderBy: { createdAt: 'desc' }
    });

    const totalEntradas = sales.reduce((acc, sale) => acc + sale.value, 0);
    const totalSaidas = costs.reduce((acc, cost) => acc + cost.amount, 0);
    const totalFuturo = prospects.reduce((acc, p) => acc + (p.expectedRevenue || 0), 0);
    const saldo = totalEntradas - totalSaidas;

    res.json({
      totalEntradas,
      totalSaidas,
      saldo,
      recentSales: sales.map(s => ({
        id: s.id,
        desc: `Venda - ${s.client?.name || 'Cliente'}`,
        user: s.seller?.name || 'Vendedor',
        amount: s.value,
        date: s.date,
        method: s.paymentMethod
      })),
      recentCosts: costs.map(c => ({
        id: c.id,
        desc: `Custo - ${c.category}`,
        user: c.user?.name || 'Usuário',
        amount: c.amount,
        date: c.date,
        method: c.paymentMethod
      })),
      futureEntries: prospects.map(p => ({
        id: p.id,
        desc: `Receita Prevista - ${p.name}`,
        user: p.city,
        amount: p.expectedRevenue,
        date: p.startDate || p.createdAt,
        method: 'PROSPECT'
      }))
    });
  } catch (error) {
    console.error('Error calculating finance overview:', error);
    res.status(500).json({ error: 'Failed to calculate finance overview' });
  }
});

// Get pending costs for audit
router.get('/pending-costs', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const pendingCosts = await prisma.cost.findMany({
      where: { status: 'PENDING', companyId: req.user?.companyId },
      include: {
        user: { select: { name: true, role: true } },
        team: { select: { prefix: true } }
      },
      orderBy: { date: 'desc' }
    });
    res.json(pendingCosts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch pending costs' });
  }
});

// Approve or Reject a cost
router.put('/costs/:id/status', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // APPROVED or REJECTED
    
    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const existing = await prisma.cost.findUnique({ where: { id: id as string } });
    if (!existing || existing.companyId !== req.user?.companyId) {
      return res.status(404).json({ error: 'Cost not found' });
    }

    const updated = await prisma.cost.update({
      where: { id: id as string },
      data: { status }
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update cost status' });
  }
});

// Health Dashboard
router.get('/health', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const sales = await prisma.sale.findMany({
      where: { companyId: req.user?.companyId },
      include: {
        seller: { select: { name: true } }
      }
    });

    const costs = await prisma.cost.findMany({
      where: { status: { not: 'REJECTED' }, companyId: req.user?.companyId },
      include: {
        user: { select: { name: true } },
        car: { select: { plate: true, model: true } }
      }
    });

    // KPI Calculations
    const receita = sales.filter(s => s.paymentStatus === 'PAID').reduce((acc, s) => acc + s.value, 0);
    const custosTotais = costs.reduce((acc, c) => acc + c.amount, 0);
    const lucro = receita - custosTotais;
    const inadimplencia = sales.filter(s => s.paymentStatus !== 'PAID').reduce((acc, s) => acc + s.value, 0);
    const frota = costs.filter(c => c.category === 'FLEET').reduce((acc, c) => acc + c.amount, 0);

    // Cash (Caixa)
    const salesCash = sales.filter(s => s.paymentMethod === 'CASH' && s.paymentStatus === 'PAID').reduce((acc, s) => acc + s.value, 0);
    const costsCash = costs.filter(c => c.paymentMethod === 'CASH' && c.status === 'APPROVED').reduce((acc, c) => acc + c.amount, 0);
    const caixa = salesCash - costsCash;

    // Charts Data
    // Custos por categoria
    const costsByCategory = costs.reduce((acc: any, c) => {
      acc[c.category] = (acc[c.category] || 0) + c.amount;
      return acc;
    }, {});

    // Custos por Veículo
    const costsByCar = costs.filter(c => c.car).reduce((acc: any, c) => {
      const plate = c.car?.plate || 'Desconhecido';
      acc[plate] = (acc[plate] || 0) + c.amount;
      return acc;
    }, {});

    // Custos por Vendedor/Usuário
    const costsByUser = costs.reduce((acc: any, c) => {
      const name = c.user?.name || 'Desconhecido';
      acc[name] = (acc[name] || 0) + c.amount;
      return acc;
    }, {});

    res.json({
      kpis: {
        caixa,
        receita,
        custos: custosTotais,
        lucro,
        inadimplencia,
        frota
      },
      charts: {
        costsByCategory,
        costsByCar,
        costsByUser
      }
    });

  } catch (error) {
    console.error('Error fetching health dashboard:', error);
    res.status(500).json({ error: 'Failed to fetch health data' });
  }
});

// Edit a cost
router.put('/costs/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { amount, category, description, paymentMethod, status } = req.body;
    
    const existing = await prisma.cost.findUnique({ where: { id } });
    if (!existing || existing.companyId !== req.user?.companyId) {
      return res.status(404).json({ error: 'Cost not found' });
    }

    const updated = await prisma.cost.update({
      where: { id },
      data: {
        amount: amount !== undefined ? Number(amount) : undefined,
        category,
        description,
        paymentMethod,
        status
      }
    });
    res.json(updated);
  } catch (error) {
    console.error('Error editing cost:', error);
    res.status(500).json({ error: 'Failed to edit cost' });
  }
});

// Edit a sale (limited fields for finance view)
router.put('/sales/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { value, paymentMethod, paymentStatus } = req.body;
    
    const existing = await prisma.sale.findUnique({ where: { id } });
    if (!existing || existing.companyId !== req.user?.companyId) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    const updated = await prisma.sale.update({
      where: { id },
      data: {
        value: value !== undefined ? Number(value) : undefined,
        paymentMethod,
        paymentStatus
      }
    });
    res.json(updated);
  } catch (error) {
    console.error('Error editing sale:', error);
    res.status(500).json({ error: 'Failed to edit sale' });
  }
});

export default router;
