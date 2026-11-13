import express, { Response } from 'express';
import { prisma } from '../services/prisma';
import { authenticateToken, AuthRequest, requireAdminOrSupervisor } from '../middleware/authMiddleware';
import { resolveSellerCommissionRate } from '../utils/commission';

const router = express.Router();

function centsToBrl(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

function brlToCents(value: number | null | undefined): number {
  return Math.round(Number(value || 0) * 100);
}

function parseFinanceDateBound(raw: string | undefined, boundary: 'start' | 'end'): Date | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const parsed = isDateOnly
    ? new Date(`${trimmed}T${boundary === 'start' ? '00:00:00.000' : '23:59:59.999'}-03:00`)
    : new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw { status: 400, message: `Data inválida: ${trimmed}` };
  }
  return parsed;
}


// Get financial overview global (Admin or Supervisor)
router.get('/overview', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }

    const { startDate, endDate, sellerId } = req.query as {
      startDate?: string;
      endDate?: string;
      sellerId?: string;
    };

    const startBound = parseFinanceDateBound(startDate, 'start');
    const endBound = parseFinanceDateBound(endDate, 'end');
    const dateRangeFilter =
      startBound || endBound
        ? {
            ...(startBound ? { gte: startBound } : {}),
            ...(endBound ? { lte: endBound } : {}),
          }
        : undefined;

    const cleanSellerId = typeof sellerId === 'string' && sellerId.trim() ? sellerId.trim() : undefined;

    const salesFilter: any = {
      ...(userCompanyId ? { companyId: userCompanyId } : {}),
      ...(cleanSellerId ? { sellerId: cleanSellerId } : {}),
      ...(dateRangeFilter ? { date: dateRangeFilter } : {}),
    };

    // 1. Vendas do período: separa Faturamento Contratado vs Entradas À Vista e Entradas de Crediário em centavos
    const salesInPeriod = await prisma.sale.findMany({
      where: salesFilter,
      orderBy: { date: 'desc' },
      select: {
        id: true,
        value: true,
        date: true,
        sellerId: true,
        paymentMethod: true,
        seller: { select: { name: true, usesOwnCar: true } },
        client: { select: { name: true } },
        creditAgreement: {
          select: {
            id: true,
            status: true,
            totalSaleCents: true,
            downPaymentCents: true,
          },
        },
      },
    });

    let contractedRevenueCents = 0;
    let cashSalesContractedCents = 0;
    let creditSalesContractedCents = 0;
    let cashSalesReceivedCents = 0;
    let downPaymentsReceivedCents = 0;
    let cashSalesCommissionsCents = 0;

    for (const s of salesInPeriod) {
      const saleNominalCents = brlToCents(s.value);
      if (s.creditAgreement) {
        if (s.creditAgreement.status !== 'CANCELLED') {
          const agreementTotalCents = s.creditAgreement.totalSaleCents || saleNominalCents;
          contractedRevenueCents += agreementTotalCents;
          creditSalesContractedCents += agreementTotalCents;
          downPaymentsReceivedCents += s.creditAgreement.downPaymentCents || 0;
        }
      } else {
        contractedRevenueCents += saleNominalCents;
        cashSalesContractedCents += saleNominalCents;
        cashSalesReceivedCents += saleNominalCents;
        const rate = resolveSellerCommissionRate(s.seller);
        cashSalesCommissionsCents += Math.round(saleNominalCents * rate);
      }
    }

    // Saldo aberto de crediário (carteira ativa na empresa / vendedor)
    const openReceivableAggregate = await prisma.creditAgreement.aggregate({
      where: {
        ...(userCompanyId ? { companyId: userCompanyId } : {}),
        ...(cleanSellerId ? { sellerId: cleanSellerId } : {}),
        status: { not: 'CANCELLED' },
      },
      _sum: { remainingPrincipalCents: true },
    });
    const receivableBalanceCents = openReceivableAggregate._sum.remainingPrincipalCents || 0;

    // 2. Recebimentos Efetivos de parcelas de Crediário (CreditPayment não estornados) no período
    const creditPayments = await prisma.creditPayment.findMany({
      where: {
        ...(userCompanyId ? { companyId: userCompanyId } : {}),
        ...(cleanSellerId ? { agreement: { sellerId: cleanSellerId } } : {}),
        ...(dateRangeFilter ? { paidAt: dateRangeFilter } : {}),
        isReversed: false,
      },
      include: {
        agreement: {
          select: { sellerId: true },
        },
      },
    });

    let installmentsReceivedCents = 0;
    let bankFeesCents = 0;
    let asaasConfirmedCents = 0;
    let asaasAvailableCents = 0;

    // Rastrear recebimentos e custódia real por vendedor em centavos
    const sellerReceiptsCents: Record<string, number> = {};

    for (const cp of creditPayments) {
      const amtCents = cp.amountCents || 0;
      const feeCents = cp.bankFeeCents || 0;
      installmentsReceivedCents += amtCents;
      bankFeesCents += feeCents;

      const netAmountCents = Math.max(0, amtCents - feeCents);

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
          asaasAvailableCents += netAmountCents;
        } else {
          asaasConfirmedCents += netAmountCents;
        }
      } else if (isSellerCustody) {
        const sid = cp.receiverUserId || cp.agreement?.sellerId || 'unknown';
        sellerReceiptsCents[sid] = (sellerReceiptsCents[sid] || 0) + amtCents;
      }
    }

    // Buscar acertos e repasses efetivamente realizados pelos vendedores à empresa
    const closings = await prisma.dailyClosing.findMany({
      where: {
        ...(userCompanyId ? { seller: { companyId: userCompanyId } } : {}),
        ...(cleanSellerId ? { sellerId: cleanSellerId } : {}),
        ...(dateRangeFilter ? { date: dateRangeFilter } : {}),
      },
      select: { sellerId: true, repasseDebt: true, closingType: true, totalSalesValue: true, commission: true },
    });

    const sellerSettlementsCents: Record<string, number> = {};
    for (const cl of closings) {
      // Somente acertos de repasse efetivos (não confundir com fechamento onde a empresa deve comissão ao vendedor)
      const isRepasseSettlement =
        cl.closingType === 'REPASSE_SETTLEMENT' ||
        (cl.totalSalesValue === 0 && cl.commission === 0 && cl.repasseDebt < 0);

      if (isRepasseSettlement) {
        sellerSettlementsCents[cl.sellerId] =
          (sellerSettlementsCents[cl.sellerId] || 0) + brlToCents(Math.abs(cl.repasseDebt));
      }
    }

    // Calcular valores em poder do vendedor por carteira individual para não compensar vendedores distintos
    const allSellerIds = Array.from(
      new Set([...Object.keys(sellerReceiptsCents), ...Object.keys(sellerSettlementsCents)])
    );
    let sellerAccumulatedReceiptsCents = 0;
    let sellerSettlementsTotalCents = 0;
    let sellerHeldFundsCents = 0;

    for (const sid of allSellerIds) {
      const rec = sellerReceiptsCents[sid] || 0;
      const acet = sellerSettlementsCents[sid] || 0;
      sellerAccumulatedReceiptsCents += rec;
      sellerSettlementsTotalCents += acet;
      sellerHeldFundsCents += Math.max(0, rec - acet);
    }

    // 3. Caixa Real Recebido (Entradas de Caixa Reais: vendas à vista + entrada do crediário + baixas de parcelas)
    const realCashReceivedCents =
      cashSalesReceivedCents + downPaymentsReceivedCents + installmentsReceivedCents;

    // 4. Comissões Brutas, Abatimentos de Auditoria (Etapa 2 + Estornos) e Comissão Líquida
    const creditCommissions = await prisma.creditCommission.findMany({
      where: {
        ...(userCompanyId ? { companyId: userCompanyId } : {}),
        ...(cleanSellerId ? { sellerId: cleanSellerId } : {}),
        ...(dateRangeFilter ? { createdAt: dateRangeFilter } : {}),
        isReversed: false,
      },
      select: {
        amountCents: true,
        type: true,
        status: true,
      },
    });

    let downPaymentCommissionsCents = 0;
    let installmentCommissionsCents = 0;
    let creditCommissionsReleasedCents = 0;
    let creditCommissionsPaidCents = 0;
    let creditCommissionsPendingCents = 0;

    for (const cc of creditCommissions) {
      const amt = cc.amountCents || 0;
      if (cc.type === 'DOWN_PAYMENT') downPaymentCommissionsCents += amt;
      else if (cc.type === 'INSTALLMENT') installmentCommissionsCents += amt;

      if (cc.status === 'RELEASED') creditCommissionsReleasedCents += amt;
      else if (cc.status === 'PAID') creditCommissionsPaidCents += amt;
      else creditCommissionsPendingCents += amt;
    }

    const creditCommissionsCents = downPaymentCommissionsCents + installmentCommissionsCents;
    const grossCommissionsCents = cashSalesCommissionsCents + creditCommissionsCents;

    const [batchAuditAdjustments, creditCommissionAdjustments] = await Promise.all([
      prisma.batchCommissionAdjustment.findMany({
        where: {
          ...(userCompanyId ? { companyId: userCompanyId } : {}),
          ...(cleanSellerId ? { sellerId: cleanSellerId } : {}),
          ...(dateRangeFilter ? { createdAt: dateRangeFilter } : {}),
        },
        select: { deductionCents: true },
      }),
      prisma.creditCommissionAdjustment.findMany({
        where: {
          ...(userCompanyId ? { companyId: userCompanyId } : {}),
          ...(cleanSellerId ? { sellerId: cleanSellerId } : {}),
          ...(dateRangeFilter ? { createdAt: dateRangeFilter } : {}),
          status: { in: ['PENDING', 'APPLIED'] },
        },
        select: { amountCents: true },
      }),
    ]);

    const batchAuditDeductionsCents = batchAuditAdjustments.reduce(
      (sum, item) => sum + (item.deductionCents || 0),
      0
    );
    const creditAdjustmentsCents = creditCommissionAdjustments.reduce(
      (sum, item) => sum + (item.amountCents || 0),
      0
    );
    const auditDeductionsCents = batchAuditDeductionsCents + creditAdjustmentsCents;
    const netCommissionsCents = grossCommissionsCents - auditDeductionsCents;

    // 5. Saídas / Custos aprovados e Receita prevista
    const costsFilter: any = {
      status: 'APPROVED',
      ...(userCompanyId ? { companyId: userCompanyId } : {}),
      ...(cleanSellerId ? { userId: cleanSellerId } : {}),
      ...(dateRangeFilter ? { date: dateRangeFilter } : {}),
    };

    const [costsAggregate, prospectsAggregate, recentCosts, recentProspects] = await Promise.all([
      prisma.cost.aggregate({
        where: costsFilter,
        _sum: { amount: true },
      }),
      prisma.commercialEvent.aggregate({
        where: {
          isProspect: true,
          expectedRevenue: { gt: 0 },
          ...(userCompanyId ? { companyId: userCompanyId } : {}),
        },
        _sum: { expectedRevenue: true },
      }),
      prisma.cost.findMany({
        where: costsFilter,
        orderBy: { date: 'desc' },
        take: 50,
        include: { user: { select: { name: true } } },
      }),
      prisma.commercialEvent.findMany({
        where: {
          isProspect: true,
          expectedRevenue: { gt: 0 },
          ...(userCompanyId ? { companyId: userCompanyId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    const totalOutflowsCents = brlToCents(costsAggregate._sum.amount);
    const saldoCents = realCashReceivedCents - totalOutflowsCents;
    const totalFuturo = prospectsAggregate._sum.expectedRevenue || 0;
    const recentSales = salesInPeriod.slice(0, 50);

    const totalEntradas = centsToBrl(realCashReceivedCents);
    const totalSaidas = centsToBrl(totalOutflowsCents);
    const saldo = centsToBrl(saldoCents);
    const faturamentoBruto = centsToBrl(contractedRevenueCents);
    const recebimentosEfetivos = totalEntradas;
    const principalRecebido = totalEntradas;

    res.json({
      // Métricas legadas em BRL (mantidas para compatibilidade integral com o frontend/mobile)
      totalEntradas,
      totalSaidas,
      saldo,
      totalFuturo,
      faturamentoBruto,
      recebimentosEfetivos,
      principalRecebido,
      entradasAVista: centsToBrl(cashSalesReceivedCents),
      entradasCrediarioAto: centsToBrl(downPaymentsReceivedCents),
      baixasParcelasCrediario: centsToBrl(installmentsReceivedCents),
      tarifasBancarias: centsToBrl(bankFeesCents),
      saldoConfirmadoAsaas: centsToBrl(asaasConfirmedCents),
      saldoDisponivelAsaas: centsToBrl(asaasAvailableCents),
      recebimentosAcumuladosVendedor: centsToBrl(sellerAccumulatedReceiptsCents),
      acertosRealizadosVendedor: centsToBrl(sellerSettlementsTotalCents),
      valoresNaoRepassadosVendedor: centsToBrl(sellerHeldFundsCents),
      valoresEmPoderDoVendedor: centsToBrl(sellerHeldFundsCents),
      saldoAReceber: centsToBrl(receivableBalanceCents),

      // Métricas blindadas Etapa 3 em centavos exatos e BRL
      contractedRevenueCents,
      faturamentoContratadoCents: contractedRevenueCents,
      faturamentoContratado: centsToBrl(contractedRevenueCents),
      cashSalesContractedCents,
      creditSalesContractedCents,

      realCashReceivedCents,
      recebimentosEfetivosCents: realCashReceivedCents,
      cashSalesReceivedCents,
      downPaymentsReceivedCents,
      installmentsReceivedCents,
      receivableBalanceCents,
      saldoAReceberCents: receivableBalanceCents,

      grossCommissionsCents,
      comissoesBrutasCents: grossCommissionsCents,
      comissoesBrutas: centsToBrl(grossCommissionsCents),
      cashSalesCommissionsCents,
      downPaymentCommissionsCents,
      installmentCommissionsCents,
      creditCommissionsCents,
      creditCommissionsReleasedCents,
      creditCommissionsPaidCents,
      creditCommissionsPendingCents,

      auditDeductionsCents,
      batchAuditDeductionsCents,
      creditAdjustmentsCents,
      abatimentosAuditoriaCents: auditDeductionsCents,
      abatimentosAuditoria: centsToBrl(auditDeductionsCents),

      netCommissionsCents,
      comissaoLiquidaCents: netCommissionsCents,
      comissaoLiquida: centsToBrl(netCommissionsCents),

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
  } catch (error: any) {
    if (error?.status && error?.message) {
      res.status(error.status).json({ error: error.message });
      return;
    }
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
