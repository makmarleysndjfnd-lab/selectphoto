import express, { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest, requireAdminOrSupervisor } from '../middleware/authMiddleware';

const router = express.Router();
const prisma = new PrismaClient();

// Get financial overview global (Admin or Supervisor)
router.get('/overview', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }

    // Agregação total de vendas (entradas) de toda a empresa
    const salesAggregate = await prisma.sale.aggregate({
      where: { companyId: userCompanyId, receiptUrl: { not: null } },
      _sum: { value: true }
    });

    // Agregação total de custos aprovados (saídas) de toda a empresa
    const costsAggregate = await prisma.cost.aggregate({
      where: { status: 'APPROVED', companyId: userCompanyId },
      _sum: { amount: true }
    });

    // Agregação total de receita prevista futura de toda a empresa
    const prospectsAggregate = await prisma.commercialEvent.aggregate({
      where: { isProspect: true, expectedRevenue: { gt: 0 }, companyId: userCompanyId },
      _sum: { expectedRevenue: true }
    });

    // Listas recentes limitadas a 50 itens apenas para exibição visual
    const recentSales = await prisma.sale.findMany({
      where: { companyId: userCompanyId, receiptUrl: { not: null } },
      orderBy: { date: 'desc' },
      take: 50,
      include: {
        seller: { select: { name: true } },
        client: { select: { name: true } }
      }
    });

    const recentCosts = await prisma.cost.findMany({
      where: { status: 'APPROVED', companyId: userCompanyId },
      orderBy: { date: 'desc' },
      take: 50,
      include: {
        user: { select: { name: true } }
      }
    });

    const recentProspects = await prisma.commercialEvent.findMany({
      where: { isProspect: true, expectedRevenue: { gt: 0 }, companyId: userCompanyId },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    const totalEntradas = salesAggregate._sum.value || 0;
    const totalSaidas = costsAggregate._sum.amount || 0;
    const totalFuturo = prospectsAggregate._sum.expectedRevenue || 0;
    const saldo = totalEntradas - totalSaidas;

    res.json({
      totalEntradas,
      totalSaidas,
      saldo,
      recentSales: recentSales.map(s => ({
        id: s.id,
        desc: `Venda - ${s.client?.name || 'Cliente'}`,
        user: s.seller?.name || 'Vendedor',
        amount: s.value,
        date: s.date,
        method: s.paymentMethod
      })),
      recentCosts: recentCosts.map(c => ({
        id: c.id,
        desc: `Custo - ${c.category}`,
        user: c.user?.name || 'Usuário',
        amount: c.amount,
        date: c.date,
        method: c.paymentMethod
      })),
      futureEntries: recentProspects.map(p => ({
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

// Get pending costs for audit (Admin or Supervisor)
router.get('/pending-costs', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }

    const pendingCosts = await prisma.cost.findMany({
      where: { status: 'PENDING', companyId: userCompanyId },
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

// Approve or Reject a cost (Admin or Supervisor)
router.put('/costs/:id/status', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { status } = req.body;
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }
    
    if (!['APPROVED', 'REJECTED'].includes(status)) {
      res.status(400).json({ error: 'Status inválido. Permitido apenas APPROVED ou REJECTED' });
      return;
    }

    const existing = await prisma.cost.findFirst({
      where: {
        id,
        companyId: userCompanyId,
      },
    });

    if (!existing) {
      res.status(404).json({ error: 'Cost not found' });
      return;
    }

    const updated = await prisma.cost.update({
      where: { id },
      data: { status }
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update cost status' });
  }
});

// Health Dashboard (Admin or Supervisor)
router.get('/health', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }

    const sales = await prisma.sale.findMany({
      where: { companyId: userCompanyId, receiptUrl: { not: null } },
      include: {
        seller: { select: { name: true } }
      }
    });

    const costs = await prisma.cost.findMany({
      where: { status: { not: 'REJECTED' }, companyId: userCompanyId },
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
    const costsByCategory = costs.reduce((acc: any, c) => {
      acc[c.category] = (acc[c.category] || 0) + c.amount;
      return acc;
    }, {});

    const costsByCar = costs.filter(c => c.car).reduce((acc: any, c) => {
      const plate = c.car?.plate || 'Desconhecido';
      acc[plate] = (acc[plate] || 0) + c.amount;
      return acc;
    }, {});

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

// Edit a cost (Admin or Supervisor)
router.put('/costs/:id', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { amount, category, description, paymentMethod, status } = req.body;
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }
    
    if (amount !== undefined && (typeof amount !== 'number' || amount < 0)) {
      res.status(400).json({ error: 'Valor do custo deve ser um número positivo.' });
      return;
    }

    if (status !== undefined && !['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
      res.status(400).json({ error: 'Status inválido.' });
      return;
    }

    const existing = await prisma.cost.findFirst({
      where: {
        id,
        companyId: userCompanyId,
      },
    });

    if (!existing) {
      res.status(404).json({ error: 'Cost not found' });
      return;
    }

    const updated = await prisma.cost.update({
      where: { id },
      data: {
        amount: amount !== undefined ? Number(amount) : undefined,
        category: category ? String(category) : undefined,
        description: description !== undefined ? String(description) : undefined,
        paymentMethod: paymentMethod ? String(paymentMethod) : undefined,
        status: status ? String(status) : undefined,
      }
    });
    res.json(updated);
  } catch (error) {
    console.error('Error editing cost:', error);
    res.status(500).json({ error: 'Failed to edit cost' });
  }
});

// Edit a sale (limited fields for finance view - Admin or Supervisor)
router.put('/sales/:id', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { value, paymentMethod, paymentStatus } = req.body;
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }
    
    if (value !== undefined && (typeof value !== 'number' || value < 0)) {
      res.status(400).json({ error: 'Valor da venda deve ser um número positivo.' });
      return;
    }

    const existing = await prisma.sale.findFirst({
      where: {
        id,
        companyId: userCompanyId,
      },
    });

    if (!existing) {
      res.status(404).json({ error: 'Sale not found' });
      return;
    }

    const updated = await prisma.sale.update({
      where: { id },
      data: {
        value: value !== undefined ? Number(value) : undefined,
        paymentMethod: paymentMethod ? String(paymentMethod) : undefined,
        paymentStatus: paymentStatus ? String(paymentStatus) : undefined,
      }
    });
    res.json(updated);
  } catch (error) {
    console.error('Error editing sale:', error);
    res.status(500).json({ error: 'Failed to edit sale' });
  }
});

export default router;
