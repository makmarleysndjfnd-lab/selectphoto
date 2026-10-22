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

    const salesFilter = {
      ...(userCompanyId ? { companyId: userCompanyId } : {}),
    };

    // 1. Faturamento Total Bruto (Soma nominal de todas as vendas e contratos)
    const salesAggregate = await prisma.sale.aggregate({
      where: salesFilter,
      _sum: { value: true }
    });
    const faturamentoBruto = salesAggregate._sum.value || 0;

    // 2. Vendas À Vista (vendas que NÃO possuem contrato de crediário vinculado, independente do status)
    const cashSalesAggregate = await prisma.sale.aggregate({
      where: {
        ...salesFilter,
        creditAgreement: null,
      },
      _sum: { value: true },
    });
    const entradasAVista = cashSalesAggregate._sum.value || 0;

    // 3. Entradas pagas no ato das vendas em Crediário (downPaymentCents) e Saldo a Receber
    const credAgreementsAggregate = await prisma.creditAgreement.aggregate({
      where: {
        ...(userCompanyId ? { companyId: userCompanyId } : {}),
        status: { not: 'CANCELLED' },
      },
      _sum: { downPaymentCents: true, remainingPrincipalCents: true },
    });
    const entradasCrediarioAto = (credAgreementsAggregate._sum.downPaymentCents || 0) / 100.0;
    const saldoAReceber = (credAgreementsAggregate._sum.remainingPrincipalCents || 0) / 100.0;

    // 4. Recebimentos Efetivos de parcelas de Crediário (CreditPayment não estornados)
    const creditPayments = await prisma.creditPayment.findMany({
      where: {
        ...(userCompanyId ? { companyId: userCompanyId } : {}),
        isReversed: false,
      },
      include: {
        agreement: {
          select: { sellerId: true },
        },
      },
    });

    let baixasParcelasCrediario = 0;
    let tarifasBancarias = 0;
    let saldoConfirmadoAsaas = 0;
    let saldoDisponivelAsaas = 0;

    // Rastrear recebimentos e custódia real por vendedor
    const sellerRecebimentos: Record<string, number> = {};

    for (const cp of creditPayments) {
      const amt = cp.amountCents / 100.0;
      const fee = (cp.bankFeeCents || 0) / 100.0;
      baixasParcelasCrediario += amt;
      tarifasBancarias += fee;

      const netAmount = Math.max(0, amt - fee);

      const isBank =
        ['BANK', 'ASAAS'].includes((cp.receivedByRole || '').toUpperCase()) ||
        Boolean(cp.externalPaymentId);

      const destUpper = (cp.destination || '').toUpperCase();
      const isDirectToCompany = ['COMPANY_ACCOUNT', 'COMPANY_BANK', 'BANK', 'COMPANY'].includes(destUpper);
      const isSellerCustody =
        !isDirectToCompany &&
        !isBank &&
        ['SELLER_HANDS', 'SELLER_RETENTION', 'SELLER'].includes(destUpper);

      if (isBank) {
        if (cp.isAsaasSettled) {
          saldoDisponivelAsaas += netAmount;
        } else {
          saldoConfirmadoAsaas += netAmount;
        }
      } else if (isSellerCustody) {
        const sid = cp.receiverUserId || cp.agreement?.sellerId || 'unknown';
        sellerRecebimentos[sid] = (sellerRecebimentos[sid] || 0) + amt;
      }
    }

    // Buscar acertos e repasses efetivamente realizados pelos vendedores à empresa
    const closings = await prisma.dailyClosing.findMany({
      where: userCompanyId ? { seller: { companyId: userCompanyId } } : {},
      select: { sellerId: true, repasseDebt: true, closingType: true, totalSalesValue: true, commission: true },
    });

    const sellerAcertos: Record<string, number> = {};
    for (const cl of closings) {
      // Somente acertos de repasse efetivos (não confundir com fechamento onde a empresa deve comissão ao vendedor)
      const isRepasseSettlement =
        cl.closingType === 'REPASSE_SETTLEMENT' ||
        (cl.totalSalesValue === 0 && cl.commission === 0 && cl.repasseDebt < 0);

      if (isRepasseSettlement) {
        sellerAcertos[cl.sellerId] = (sellerAcertos[cl.sellerId] || 0) + Math.abs(cl.repasseDebt);
      }
    }

    // Calcular valores em poder do vendedor por carteira individual para não compensar vendedores distintos
    const allSellerIds = Array.from(new Set([...Object.keys(sellerRecebimentos), ...Object.keys(sellerAcertos)]));
    let recebimentosAcumuladosVendedor = 0;
    let acertosRealizadosVendedor = 0;
    let valoresEmPoderDoVendedor = 0;

    for (const sid of allSellerIds) {
      const rec = sellerRecebimentos[sid] || 0;
      const acet = sellerAcertos[sid] || 0;
      recebimentosAcumuladosVendedor += rec;
      acertosRealizadosVendedor += acet;
      valoresEmPoderDoVendedor += Math.max(0, rec - acet);
    }

    const valoresNaoRepassadosVendedor = valoresEmPoderDoVendedor;

    // 5. Total de Recebimentos Efetivos (Entradas de Caixa Reais / Principal Recebido)
    // Transferências internas entre vendedor e empresa não duplicam receita
    const principalRecebido = entradasAVista + entradasCrediarioAto + baixasParcelasCrediario;
    const recebimentosEfetivos = principalRecebido;

    // Agregação total de custos aprovados (saídas) de toda a empresa
    const costsAggregate = await prisma.cost.aggregate({
      where: { status: 'APPROVED', ...(userCompanyId ? { companyId: userCompanyId } : {}) },
      _sum: { amount: true }
    });

    // Agregação total de receita prevista futura de toda a empresa
    const prospectsAggregate = await prisma.commercialEvent.aggregate({
      where: { isProspect: true, expectedRevenue: { gt: 0 }, ...(userCompanyId ? { companyId: userCompanyId } : {}) },
      _sum: { expectedRevenue: true }
    });

    // Listas recentes limitadas a 50 itens apenas para exibição visual
    const recentSales = await prisma.sale.findMany({
      where: salesFilter,
      orderBy: { date: 'desc' },
      take: 50,
      include: {
        seller: { select: { name: true } },
        client: { select: { name: true } }
      }
    });

    const recentCosts = await prisma.cost.findMany({
      where: { status: 'APPROVED', ...(userCompanyId ? { companyId: userCompanyId } : {}) },
      orderBy: { date: 'desc' },
      take: 50,
      include: {
        user: { select: { name: true } }
      }
    });

    const recentProspects = await prisma.commercialEvent.findMany({
      where: { isProspect: true, expectedRevenue: { gt: 0 }, ...(userCompanyId ? { companyId: userCompanyId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    const totalEntradas = recebimentosEfetivos;
    const totalSaidas = costsAggregate._sum.amount || 0;
    const totalFuturo = prospectsAggregate._sum.expectedRevenue || 0;
    const saldo = totalEntradas - totalSaidas;

    res.json({
      totalEntradas,
      totalSaidas,
      saldo,
      faturamentoBruto,
      recebimentosEfetivos,
      principalRecebido,
      entradasAVista,
      entradasCrediarioAto,
      baixasParcelasCrediario,
      tarifasBancarias,
      saldoConfirmadoAsaas,
      saldoDisponivelAsaas,
      recebimentosAcumuladosVendedor,
      acertosRealizadosVendedor,
      valoresNaoRepassadosVendedor,
      valoresEmPoderDoVendedor,
      saldoAReceber,
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
        seller: { select: { name: true } },
        creditAgreement: true,
      }
    });

    const creditPayments = await prisma.creditPayment.findMany({
      where: { ...(userCompanyId ? { companyId: userCompanyId } : {}), isReversed: false },
    });

    const now = new Date();
    const openInstallments = await prisma.creditInstallment.findMany({
      where: {
        status: { in: ['PENDING', 'PARTIALLY_PAID'] },
        agreement: { ...(userCompanyId ? { companyId: userCompanyId } : {}), status: { not: 'CANCELLED' } },
      },
    });

    const costs = await prisma.cost.findMany({
      where: { status: { not: 'REJECTED' }, companyId: userCompanyId },
      include: {
        user: { select: { name: true } },
        car: { select: { plate: true, model: true } }
      }
    });

    // KPI Calculations
    const creditPaymentsSum = creditPayments.reduce((acc, cp) => acc + (cp.amountCents / 100), 0);
    const receita = sales.reduce((acc, s) => {
      if (s.creditAgreement) {
        return acc + (s.creditAgreement.downPaymentCents / 100);
      }
      return s.paymentStatus === 'PAID' ? acc + s.value : acc;
    }, 0) + creditPaymentsSum;

    const crediarioVencido = openInstallments
      .filter(i => new Date(i.dueDate) < now)
      .reduce((acc, i) => acc + ((i.amountCents - i.paidCents) / 100), 0);

    const crediarioAReceber = openInstallments
      .filter(i => new Date(i.dueDate) >= now)
      .reduce((acc, i) => acc + ((i.amountCents - i.paidCents) / 100), 0);

    const custosTotais = costs.reduce((acc, c) => acc + c.amount, 0);
    const lucro = receita - custosTotais;
    const legacyUnpaidSales = sales.filter(s => !s.creditAgreement && s.paymentStatus !== 'PAID').reduce((acc, s) => acc + s.value, 0);
    const inadimplencia = Number((legacyUnpaidSales + crediarioVencido).toFixed(2));
    const frota = costs.filter(c => c.category === 'FLEET').reduce((acc, c) => acc + c.amount, 0);

    // Cash (Caixa)
    const salesCash = sales.filter(s => s.paymentMethod === 'CASH' && s.paymentStatus === 'PAID').reduce((acc, s) => acc + s.value, 0);
    const creditPaymentsCash = creditPayments.filter(cp => cp.paymentMethod === 'CASH' && cp.destination === 'COMPANY_BANK').reduce((acc, cp) => acc + (cp.amountCents / 100), 0);
    const costsCash = costs.filter(c => c.paymentMethod === 'CASH' && c.status === 'APPROVED').reduce((acc, c) => acc + c.amount, 0);
    const caixa = salesCash + creditPaymentsCash - costsCash;

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
        crediarioAReceber,
        crediarioVencido,
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
