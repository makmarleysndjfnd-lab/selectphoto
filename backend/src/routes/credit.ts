import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest, requireAdminOrSupervisor } from '../middleware/authMiddleware';
import { calculateCreditSchedule, validateCpf } from '../services/creditService';
import {
  getCompanyAsaasConfig,
  syncAsaasCustomer,
  createAsaasChargeForInstallment,
  notifyAsaasReceiveInCash,
  updateAsaasPayment,
  cancelAsaasPayment,
  refundAsaasPayment,
} from '../services/asaasService';
import {
  getCompetenceRange,
  getCompetenceForDate,
  isCompetenceEnded,
  getRelevantCompetences,
  calculateSellerMonthlyCreditClosing,
  processMonthlyCreditClosing,
  recordMonthlyCreditPayout,
  handleCreditPaymentReversalCommission,
  getSellerFourCommissionStates,
} from '../services/monthlyCreditClosingService';

const router = Router();
const prisma = new PrismaClient();

/**
 * Middleware para bloquear acesso de perfis sem permissão ao crediário (ex: PHOTOGRAPHER).
 */
function requireCreditAccess(req: AuthRequest, res: Response, next: any) {
  if (req.user?.role === 'PHOTOGRAPHER') {
    return res.status(403).json({ error: 'Acesso negado: fotógrafos não têm acesso ao módulo de crediário.' });
  }
  next();
}

/**
 * Verifica se o usuário tem privilégios administrativos/gerenciais
 */
function isUserAdmin(req: AuthRequest): boolean {
  const role = req.user?.role || '';
  return ['COMPANY_ADMIN', 'ADMIN', 'SUPER_ADMIN', 'SUPERVISOR', 'SELLER_MANAGER'].includes(role);
}

/**
 * GET /api/credit/overview
 * Visão consolidada para o Painel Administrativo de Crediário e Cobranças
 * Restrito: Vendedor só enxerga métricas de sua própria carteira
 */
router.get('/overview', authenticateToken, requireCreditAccess, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }

    const isAdmin = isUserAdmin(req);
    const { sellerId: querySellerId, startDate, endDate } = req.query as {
      sellerId?: string;
      startDate?: string;
      endDate?: string;
    };

    // Vendedor comum só vê a própria carteira
    if (!isAdmin && querySellerId && querySellerId !== req.user?.id) {
      res.status(403).json({ error: 'Acesso negado: você só pode consultar dados da sua própria carteira' });
      return;
    }

    const effectiveSellerId = isAdmin ? (querySellerId || undefined) : req.user?.id;

    const whereAgreement: any = {
      ...(companyId ? { companyId } : {}),
      ...(effectiveSellerId ? { sellerId: effectiveSellerId } : {}),
    };

    const now = new Date();

    // 1. Saldo total a receber em contratos ativos
    const activeAgreements = await prisma.creditAgreement.findMany({
      where: {
        ...whereAgreement,
        status: { in: ['ACTIVE', 'RENEGOTIATED'] },
      },
      select: {
        remainingPrincipalCents: true,
        installments: {
          where: {
            status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
          },
          select: {
            dueDate: true,
            amountCents: true,
            paidCents: true,
          },
        },
      },
    });

    const totalRemainingCents = activeAgreements.reduce((sum, a) => sum + a.remainingPrincipalCents, 0);

    // 2. Principal vencido (parcelas com dueDate < now e não totalmente pagas)
    let totalOverdueCents = 0;
    let overdueInstallmentsCount = 0;

    for (const a of activeAgreements) {
      for (const inst of a.installments) {
        if (new Date(inst.dueDate) < now) {
          const unpaid = inst.amountCents - inst.paidCents;
          if (unpaid > 0) {
            totalOverdueCents += unpaid;
            overdueInstallmentsCount++;
          }
        }
      }
    }

    // 3. Recebimentos do período
    const wherePayments: any = {
      ...(companyId ? { companyId } : {}),
      isReversed: false,
    };
    if (effectiveSellerId) {
      wherePayments.agreement = { sellerId: effectiveSellerId };
    }
    if (startDate || endDate) {
      wherePayments.paidAt = {};
      if (startDate) wherePayments.paidAt.gte = new Date(startDate);
      if (endDate) wherePayments.paidAt.lte = new Date(endDate);
    }

    const periodPayments = await prisma.creditPayment.findMany({
      where: wherePayments,
      select: { amountCents: true },
    });
    const periodReceivedCents = periodPayments.reduce((sum, p) => sum + p.amountCents, 0);

    // 4. Comissões liberadas ainda não pagas
    const whereCommissions: any = {
      ...(companyId ? { companyId } : {}),
      status: 'RELEASED',
      isReversed: false,
      ...(effectiveSellerId ? { sellerId: effectiveSellerId } : {}),
    };
    const releasedCommissions = await prisma.creditCommission.findMany({
      where: whereCommissions,
      select: { amountCents: true },
    });
    const pendingCommissionCents = releasedCommissions.reduce((sum, c) => sum + c.amountCents, 0);

    // 5. Inadimplência calculada com fórmula explícita
    const delinquencyRate = totalRemainingCents > 0
      ? Number(((totalOverdueCents / totalRemainingCents) * 100).toFixed(2))
      : 0;

    res.json({
      totalRemainingPrincipal: Number((totalRemainingCents / 100).toFixed(2)),
      totalOverduePrincipal: Number((totalOverdueCents / 100).toFixed(2)),
      overdueInstallmentsCount,
      periodReceived: Number((periodReceivedCents / 100).toFixed(2)),
      pendingCommissions: Number((pendingCommissionCents / 100).toFixed(2)),
      delinquencyRate,
      delinquencyFormula: 'Taxa de Inadimplência = (Principal Vencido Não Pago / Saldo Total a Receber) * 100. Considera apenas parcelas com vencimento estritamente expirado.',
    });
  } catch (error: any) {
    console.error('Error fetching credit overview:', error);
    res.status(500).json({ error: error.message || 'Erro ao carregar visão geral do crediário' });
  }
});

/**
 * GET /api/credit/sellers-summary
 * Lista resumo de todos os vendedores que possuem contratos de crediário (para os Cards do Admin)
 * Inclui vendedores inativos que possuem carteira histórica
 */
router.get('/sellers-summary', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }

    const now = new Date();

    // Buscar todos os vendedores com contratos na empresa
    const sellers = await prisma.user.findMany({
      where: {
        companyId,
        creditAgreementsSeller: { some: {} },
      },
      select: {
        id: true,
        name: true,
        active: true,
        creditAgreementsSeller: {
          select: {
            id: true,
            status: true,
            remainingPrincipalCents: true,
            installments: {
              where: {
                status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
              },
              select: {
                dueDate: true,
                amountCents: true,
                paidCents: true,
              },
            },
          },
        },
        creditCommissions: {
          where: {
            status: 'RELEASED',
            isReversed: false,
          },
          select: { amountCents: true },
        },
        creditCommissionAdjustments: {
          where: {
            status: 'PENDING',
          },
          select: { amountCents: true },
        },
      },
    });

    const summary = sellers.map((s) => {
      let saldoAReceberCents = 0;
      let valorVencidoCents = 0;

      for (const a of s.creditAgreementsSeller) {
        if (a.status === 'ACTIVE' || a.status === 'RENEGOTIATED') {
          saldoAReceberCents += a.remainingPrincipalCents;
          for (const inst of a.installments) {
            if (new Date(inst.dueDate) < now) {
              const unpaid = inst.amountCents - inst.paidCents;
              if (unpaid > 0) valorVencidoCents += unpaid;
            }
          }
        }
      }

      const comissaoLiberadaCents = s.creditCommissions.reduce((sum, c) => sum + c.amountCents, 0);
      const comissaoPendenteAjustesCents = s.creditCommissionAdjustments.reduce((sum, adj) => sum + adj.amountCents, 0);
      const comissaoLiquidaPagarCents = Math.max(0, comissaoLiberadaCents - comissaoPendenteAjustesCents);

      const totalRemainingPrincipal = Number((saldoAReceberCents / 100).toFixed(2));
      const totalOverduePrincipal = Number((valorVencidoCents / 100).toFixed(2));
      const netCommissionPayable = Number((comissaoLiquidaPagarCents / 100).toFixed(2));

      return {
        sellerId: s.id,
        sellerName: s.name,
        active: s.active,
        isActive: s.active,
        totalAgreements: s.creditAgreementsSeller.length,
        saldoAReceberCents,
        valorVencidoCents,
        comissaoLiberadaCents,
        comissaoPendenteAjustesCents,
        comissaoLiquidaPagarCents,
        totalRemainingPrincipal,
        totalOverduePrincipal,
        netCommissionPayable,
      };
    });

    res.json(summary);
  } catch (error: any) {
    console.error('Error fetching sellers summary:', error);
    res.status(500).json({ error: error.message || 'Erro ao carregar resumo de vendedores' });
  }
});

/**
 * GET /api/credit/agreements
 * Listagem de contratos com filtros e restrição estrita por carteira
 */
router.get('/agreements', authenticateToken, requireCreditAccess, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }

    const isAdmin = isUserAdmin(req);
    const { search, status, sellerId, dateFilterType, startDate, endDate } = req.query as {
      search?: string;
      status?: string;
      sellerId?: string;
      dateFilterType?: 'DUE_DATE' | 'PAYMENT_DATE' | 'COMMISSION_DATE';
      startDate?: string;
      endDate?: string;
    };

    // Vendedor comum só vê a própria carteira
    if (!isAdmin && sellerId && sellerId !== req.user?.id) {
      res.status(403).json({ error: 'Acesso negado: você só pode consultar contratos da sua própria carteira' });
      return;
    }

    const effectiveSellerId = isAdmin ? (sellerId || undefined) : req.user?.id;

    const where: any = {
      ...(companyId ? { companyId } : {}),
      ...(effectiveSellerId ? { sellerId: effectiveSellerId } : {}),
    };

    if (status && status !== 'ALL') {
      if (status === 'OVERDUE') {
        where.status = { in: ['ACTIVE', 'RENEGOTIATED'] };
        where.installments = {
          some: {
            dueDate: { lt: new Date() },
            status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
          },
        };
      } else if (status === 'DUE_TODAY') {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        where.status = { in: ['ACTIVE', 'RENEGOTIATED'] };
        where.installments = {
          some: {
            dueDate: { gte: todayStart, lte: todayEnd },
            status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
          },
        };
      } else {
        where.status = status;
      }
    }

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { buyerName: { contains: q, mode: 'insensitive' } },
        { buyerCpf: { contains: q } },
        { city: { contains: q, mode: 'insensitive' } },
        { client: { sequenceNumber: { contains: q, mode: 'insensitive' } } },
        { client: { visibleCode: { contains: q, mode: 'insensitive' } } },
        { seller: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }

    // Filtros de período refinados
    if (dateFilterType && (startDate || endDate)) {
      const start = startDate ? new Date(startDate) : undefined;
      const end = endDate ? new Date(endDate) : undefined;

      if (dateFilterType === 'DUE_DATE') {
        where.installments = {
          some: {
            dueDate: {
              ...(start ? { gte: start } : {}),
              ...(end ? { lte: end } : {}),
            },
          },
        };
      } else if (dateFilterType === 'PAYMENT_DATE') {
        where.payments = {
          some: {
            paidAt: {
              ...(start ? { gte: start } : {}),
              ...(end ? { lte: end } : {}),
            },
            isReversed: false,
          },
        };
      } else if (dateFilterType === 'COMMISSION_DATE') {
        where.commissions = {
          some: {
            paidAt: {
              ...(start ? { gte: start } : {}),
              ...(end ? { lte: end } : {}),
            },
          },
        };
      }
    }

    const agreements = await prisma.creditAgreement.findMany({
      where,
      include: {
        client: {
          select: {
            id: true,
            name: true,
            sequenceNumber: true,
            visibleCode: true,
            city: true,
            phone1: true,
            phone2: true,
          },
        },
        seller: {
          select: { id: true, name: true },
        },
        installments: {
          orderBy: { installmentNumber: 'asc' },
          include: {
            asaasCharge: true,
          },
        },
        payments: {
          where: { isReversed: false },
          orderBy: { paidAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();

    const formatted = agreements.map((a) => {
      const pendingInsts = a.installments.filter((i) => i.status === 'PENDING' || i.status === 'PARTIALLY_PAID' || i.status === 'OVERDUE');
      const nextPending = pendingInsts[0];

      let overdueCount = 0;
      let oldestOverdueDate: Date | null = null;
      for (const inst of pendingInsts) {
        if (new Date(inst.dueDate) < now) {
          overdueCount++;
          if (!oldestOverdueDate || new Date(inst.dueDate) < oldestOverdueDate) {
            oldestOverdueDate = new Date(inst.dueDate);
          }
        }
      }

      const daysOverdue = oldestOverdueDate
        ? Math.floor((now.getTime() - oldestOverdueDate.getTime()) / (1000 * 3600 * 24))
        : 0;

      const daysUntilNext = nextPending
        ? Math.ceil((new Date(nextPending.dueDate).getTime() - now.getTime()) / (1000 * 3600 * 24))
        : null;

      return {
        id: a.id,
        saleId: a.saleId,
        buyerName: a.buyerName,
        buyerCpf: a.buyerCpf,
        city: a.city,
        state: a.state,
        clientCode: a.client?.visibleCode || a.client?.sequenceNumber || '---',
        sellerId: a.sellerId,
        sellerName: a.seller?.name || 'Vendedor',
        totalSale: Number((a.totalSaleCents / 100).toFixed(2)),
        downPayment: Number((a.downPaymentCents / 100).toFixed(2)),
        financedPrincipal: Number((a.financedPrincipalCents / 100).toFixed(2)),
        remainingPrincipal: Number((a.remainingPrincipalCents / 100).toFixed(2)),
        paidPrincipal: Number((a.paidPrincipalCents / 100).toFixed(2)),
        installmentsCount: a.installmentsCount,
        periodicity: a.periodicity,
        firstDueDate: a.firstDueDate,
        status: a.status,
        signedAgreementUrl: a.signedAgreementUrl,
        nextDueDate: nextPending?.dueDate || null,
        nextInstallmentAmount: nextPending ? Number(((nextPending.amountCents - nextPending.paidCents) / 100).toFixed(2)) : 0,
        lastPaymentDate: a.payments[0]?.paidAt || null,
        overdueCount,
        daysOverdue,
        daysUntilNext,
        installments: a.installments.map((inst) => ({
          id: inst.id,
          installmentNumber: inst.installmentNumber,
          dueDate: inst.dueDate,
          amount: Number((inst.amountCents / 100).toFixed(2)),
          paid: Number((inst.paidCents / 100).toFixed(2)),
          remaining: Number(((inst.amountCents - inst.paidCents) / 100).toFixed(2)),
          status: inst.status,
          paidAt: inst.paidAt,
          isOverdue: (inst.status !== 'PAID' && inst.status !== 'RENEGOTIATED') && new Date(inst.dueDate) < now,
          asaasCharge: inst.asaasCharge ? {
            externalId: inst.asaasCharge.externalId,
            status: inst.asaasCharge.status,
            identificationField: inst.asaasCharge.identificationField,
            bankSlipUrl: inst.asaasCharge.bankSlipUrl,
            pixQrCodeUrl: inst.asaasCharge.pixQrCodeUrl,
            pixPayload: inst.asaasCharge.pixPayload,
            settledAt: inst.asaasCharge.settledAt,
          } : null,
        })),
      };
    });

    res.json(formatted);
  } catch (error: any) {
    console.error('Error listing credit agreements:', error);
    res.status(500).json({ error: error.message || 'Erro ao listar contratos de crediário' });
  }
});

/**
 * GET /api/credit/agreements/:id
 * Detalhes de um contrato específico (com autorização estrita por perfil)
 */
router.get('/agreements/:id', authenticateToken, requireCreditAccess, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const companyId = req.user?.companyId;
    const isAdmin = isUserAdmin(req);
    const existing = await prisma.creditAgreement.findFirst({
      where: {
        id,
        ...(companyId ? { companyId } : {}),
      },
      include: {
        client: true,
        seller: { select: { id: true, name: true, phone: true } },
        installments: {
          orderBy: { installmentNumber: 'asc' },
          include: { asaasCharge: true },
        },
        payments: {
          orderBy: { paidAt: 'desc' },
          include: {
            receiver: { select: { id: true, name: true } },
            reversedBy: { select: { id: true, name: true } },
            allocations: {
              include: { installment: true },
            },
          },
        },
        commissions: {
          orderBy: { createdAt: 'desc' },
          include: { seller: { select: { id: true, name: true } } },
        },
        commissionAdjustments: {
          orderBy: { createdAt: 'desc' },
        },
        renegotiations: {
          orderBy: { createdAt: 'desc' },
          include: { author: { select: { id: true, name: true } } },
        },
      },
    });

    if (!existing) {
      res.status(404).json({ error: 'Contrato de crediário não encontrado' });
      return;
    }

    if (!isAdmin && existing.sellerId !== req.user?.id) {
      res.status(403).json({ error: 'Acesso negado: você só pode acessar contratos da sua própria carteira' });
      return;
    }

    res.json(existing);
  } catch (error: any) {
    console.error('Error getting credit agreement details:', error);
    res.status(500).json({ error: error.message || 'Erro ao buscar detalhes do contrato' });
  }
});

/**
 * POST /api/credit/agreements/:id/payments
 * Registrar recebimento / baixa parcial ou total do principal financiado
 * Com idempotência persistente, bloqueio pessimista e sincronização manual Asaas
 */
router.post('/agreements/:id/payments', authenticateToken, requireCreditAccess, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const companyId = req.user?.companyId;
    const currentUserId = req.user?.id;
    const currentUserRole = req.user?.role || 'ADMIN';
    const isAdmin = isUserAdmin(req);

    if (!companyId || !currentUserId) {
      res.status(401).json({ error: 'Usuário ou empresa não identificado' });
      return;
    }

    if (!isAdmin) {
      res.status(403).json({
        error: 'Acesso negado: a carteira do vendedor é estritamente de consulta após a venda. Baixas manuais são restritas a gestores administrativos.',
      });
      return;
    }

    const {
      amount,
      paymentMethod = 'CASH',
      destination = 'SELLER_HANDS',
      receiptUrl,
      notes,
      idempotencyKey,
    } = req.body;

    // 1. Idempotência preventiva
    if (idempotencyKey) {
      const existing = await prisma.creditPayment.findUnique({
        where: { idempotencyKey: String(idempotencyKey).trim() },
        include: { allocations: true },
      });
      if (existing) {
        return res.json({
          success: true,
          idempotentReplay: true,
          paymentId: existing.id,
          amountCents: existing.amountCents,
          allocations: existing.allocations,
        });
      }
    }

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      res.status(400).json({ error: 'Valor de pagamento inválido. Deve ser maior que zero' });
      return;
    }

    const paymentAmountCents = Math.round(parsedAmount * 100);

    // 2. Transação com bloqueio pessimista para evitar concorrência simultânea
    const result = await prisma.$transaction(async (tx) => {
      // Bloqueio pessimista do contrato no PostgreSQL
      await tx.$queryRaw`SELECT id FROM "CreditAgreement" WHERE id = ${id} FOR UPDATE`;

      const existing = await tx.creditAgreement.findFirst({
        where: {
          id,
          ...(companyId ? { companyId } : {}),
        },
        include: {
          installments: {
            where: {
              status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
            },
            orderBy: { installmentNumber: 'asc' },
            include: { asaasCharge: true },
          },
        },
      });

      if (!existing) {
        throw { status: 404, message: 'Contrato não encontrado' };
      }

      if (!isAdmin && existing.sellerId !== currentUserId) {
        throw { status: 403, message: 'Acesso negado: você só pode registrar recebimentos da sua própria carteira' };
      }

      const agreement = existing;

      if (agreement.status === 'SETTLED' || agreement.remainingPrincipalCents <= 0) {
        throw { status: 400, message: 'Este contrato já foi totalmente quitado.' };
      }

      if (paymentAmountCents > agreement.remainingPrincipalCents) {
        throw {
          status: 400,
          message: `Valor informado (R$ ${(paymentAmountCents / 100).toFixed(2)}) excede o saldo devedor remanescente (R$ ${(agreement.remainingPrincipalCents / 100).toFixed(2)}).`,
        };
      }

      // 3. Criar registro do pagamento
      const effectiveReceiverId = destination === 'SELLER_HANDS' ? agreement.sellerId : currentUserId;
      const payment = await tx.creditPayment.create({
        data: {
          agreementId: agreement.id,
          companyId,
          amountCents: paymentAmountCents,
          paymentMethod,
          receivedByRole: destination === 'SELLER_HANDS' ? 'SELLER' : currentUserRole,
          receiverUserId: effectiveReceiverId,
          destination,
          receiptUrl,
          notes,
          idempotencyKey: idempotencyKey ? String(idempotencyKey).trim() : undefined,
        },
      });

      // 4. Alocação: se o usuário especificou uma parcela alvo, prioriza ela, caso contrário FIFO
      const targetInstallmentId = req.body.installmentId;
      const sortedInstallments = [...agreement.installments];
      if (targetInstallmentId) {
        sortedInstallments.sort((a, b) => {
          if (a.id === targetInstallmentId) return -1;
          if (b.id === targetInstallmentId) return 1;
          return a.installmentNumber - b.installmentNumber;
        });
      }

      let remainingToAllocate = paymentAmountCents;
      const allocationsCreated: any[] = [];
      const updatedInstallmentIds: string[] = [];
      const chargesToSyncInCash: { chargeId: string; amountCents: number; residualCents: number }[] = [];

      for (const inst of sortedInstallments) {
        if (remainingToAllocate <= 0) break;

        const installmentUnpaidCents = inst.amountCents - inst.paidCents;
        if (installmentUnpaidCents <= 0) continue;

        const allocatedCents = Math.min(remainingToAllocate, installmentUnpaidCents);
        const newPaidCents = inst.paidCents + allocatedCents;
        const isFullyPaid = newPaidCents >= inst.amountCents;

        const alloc = await tx.creditPaymentAllocation.create({
          data: {
            paymentId: payment.id,
            installmentId: inst.id,
            allocatedCents,
          },
        });
        allocationsCreated.push(alloc);

        await tx.creditInstallment.update({
          where: { id: inst.id },
          data: {
            paidCents: newPaidCents,
            status: isFullyPaid ? 'PAID' : 'PARTIALLY_PAID',
            paidAt: isFullyPaid ? new Date() : undefined,
          },
        });
        updatedInstallmentIds.push(inst.id);

        if (inst.asaasCharge && inst.asaasCharge.status !== 'RECEIVED' && inst.asaasCharge.status !== 'RECEIVED_IN_CASH') {
          chargesToSyncInCash.push({
            chargeId: inst.asaasCharge.externalId,
            amountCents: allocatedCents,
            residualCents: inst.amountCents - newPaidCents,
          });
        }

        remainingToAllocate -= allocatedCents;
      }

      // 5. Atualizar saldo do contrato
      const newRemainingCents = agreement.remainingPrincipalCents - paymentAmountCents;
      const newPaidPrincipalCents = agreement.paidPrincipalCents + paymentAmountCents;
      const isSettled = newRemainingCents <= 0;

      await tx.creditAgreement.update({
        where: { id: agreement.id },
        data: {
          remainingPrincipalCents: newRemainingCents,
          paidPrincipalCents: newPaidPrincipalCents,
          status: isSettled ? 'SETTLED' : agreement.status,
        },
      });

      // 6. Gerar comissão de 10% sobre o principal recebido para o vendedor do contrato
      const commissionCents = Math.round(paymentAmountCents * agreement.installmentCommissionRate);
      let createdCommission: any = null;

      if (commissionCents > 0) {
        createdCommission = await tx.creditCommission.create({
          data: {
            agreementId: agreement.id,
            paymentId: payment.id,
            sellerId: agreement.sellerId,
            companyId,
            amountCents: commissionCents,
            status: 'RELEASED',
            type: 'INSTALLMENT',
          },
        });
      }

      // 7. Auditoria na timeline do cliente
      await tx.clientTimeline.create({
        data: {
          clientId: agreement.clientId,
          previousStatus: 'EM_ABERTO',
          newStatus: isSettled ? 'QUITADO' : 'PARCIALMENTE_PAGO',
          authorId: currentUserId,
          authorRole: currentUserRole,
          action: 'CREDIT_PAYMENT_RECEIVED',
          reason: `Baixa de R$ ${(paymentAmountCents / 100).toFixed(2)} via ${paymentMethod} (${destination}). Saldo restante: R$ ${(newRemainingCents / 100).toFixed(2)}`,
        },
      });

      return {
        payment,
        allocations: allocationsCreated,
        remainingPrincipalCents: newRemainingCents,
        isSettled,
        commission: createdCommission,
        chargesToSyncInCash,
      };
    }, {
      timeout: 20000,
      maxWait: 10000,
    });

    // 8. Sincronização assíncrona não-bloqueante com o Asaas se cobrança bancária existir
    for (const c of result.chargesToSyncInCash) {
      try {
        if (c.residualCents === 0) {
          // Parcela quitada integralmente -> registra recebimento em dinheiro no Asaas
          await notifyAsaasReceiveInCash(
            companyId,
            c.chargeId,
            new Date().toISOString().split('T')[0],
            c.amountCents / 100.0
          );
          await prisma.asaasCharge.update({
            where: { externalId: c.chargeId },
            data: { isManualPaymentSync: true, status: 'RECEIVED_IN_CASH' },
          });
        } else {
          // Parcela com saldo residual: NÃO liquidar a cobrança inteira com receiveInCash!
          // Reduz o valor da cobrança no Asaas para o saldo devedor restante mantendo o boleto/Pix válido
          const remainingValue = c.residualCents / 100.0;
          await updateAsaasPayment(companyId, c.chargeId, { value: remainingValue });
          await prisma.asaasCharge.update({
            where: { externalId: c.chargeId },
            data: {
              nominalValueCents: c.residualCents,
              isManualPaymentSync: true,
            },
          });
        }
      } catch (err) {
        console.warn(`[Asaas Sync] Aviso ao sincronizar parcela ${c.chargeId}:`, err);
      }
    }

    res.status(201).json({
      success: true,
      payment: result.payment,
      paymentId: result.payment.id,
      amount: parsedAmount,
      remainingPrincipalCents: result.remainingPrincipalCents,
      remainingPrincipal: Number((result.remainingPrincipalCents / 100).toFixed(2)),
      isSettled: result.isSettled,
      allocations: result.allocations,
      allocationsCount: result.allocations.length,
      commissionGenerated: result.commission ? Number((result.commission.amountCents / 100).toFixed(2)) : 0,
    });
  } catch (error: any) {
    if (error?.status && error?.message) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error?.code === 'P2002' && (String(error?.message).includes('idempotencyKey') || error?.meta?.target?.includes('idempotencyKey'))) {
      const existing = await prisma.creditPayment.findUnique({
        where: { idempotencyKey: String(req.body.idempotencyKey || '').trim() },
        include: { allocations: true },
      });
      if (existing) {
        res.json({
          success: true,
          idempotentReplay: true,
          paymentId: existing.id,
          amountCents: existing.amountCents,
          allocations: existing.allocations,
        });
        return;
      }
      res.status(409).json({ error: 'Operação já processada com esta chave de idempotência.' });
      return;
    }
    console.error('Error registering credit payment:', error);
    res.status(500).json({ error: error.message || 'Erro ao registrar pagamento de crediário' });
  }
});

/**
 * POST /api/credit/payments/:id/reverse
 * Estornar um recebimento específico com ajuste rastreável de comissão se já tiver sido paga
 */
router.post('/payments/:id/reverse', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const paymentId = req.params.id as string;
    const companyId = req.user?.companyId;
    const authorId = req.user?.id;

    if (!companyId || !authorId) {
      res.status(401).json({ error: 'Usuário ou empresa não identificado' });
      return;
    }

    const { reason, idempotencyKey } = req.body;
    if (!reason || !String(reason).trim()) {
      res.status(400).json({ error: 'Motivo do estorno é obrigatório para fins de auditoria' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.creditPayment.findFirst({
        where: { id: paymentId, companyId },
        include: {
          agreement: true,
          allocations: { include: { installment: true } },
          commissions: true,
        },
      });

      if (!payment) {
        throw { status: 404, message: 'Recebimento não encontrado' };
      }

      if (payment.isReversed) {
        return { success: true, alreadyReversed: true, remainingPrincipal: (payment.agreement.remainingPrincipalCents / 100) };
      }

      // Bloqueio pessimista no contrato
      await tx.$queryRawUnsafe('SELECT id FROM "CreditAgreement" WHERE id = $1 FOR UPDATE', payment.agreementId);

      // Reverter cada alocação nas parcelas
      for (const alloc of payment.allocations) {
        const inst = alloc.installment;
        const newPaidCents = Math.max(0, inst.paidCents - alloc.allocatedCents);
        const newStatus = newPaidCents === 0 ? 'PENDING' : 'PARTIALLY_PAID';

        await tx.creditInstallment.update({
          where: { id: inst.id },
          data: {
            paidCents: newPaidCents,
            status: newStatus,
            paidAt: null,
          },
        });
      }

      // Atualizar saldo do contrato
      const newRemainingCents = payment.agreement.remainingPrincipalCents + payment.amountCents;
      const newPaidPrincipalCents = Math.max(0, payment.agreement.paidPrincipalCents - payment.amountCents);

      await tx.creditAgreement.update({
        where: { id: payment.agreementId },
        data: {
          remainingPrincipalCents: newRemainingCents,
          paidPrincipalCents: newPaidPrincipalCents,
          status: 'ACTIVE',
        },
      });

      // Tratar comissões geradas por este recebimento
      for (const commission of payment.commissions) {
        if (commission.monthlyClosingId || commission.status === 'PAID') {
          // Se já foi incluída em fechamento mensal ou já foi paga, NÃO apaga o histórico!
          // Gera registro de ajuste/débito rastreável para a próxima competência
          await tx.creditCommissionAdjustment.create({
            data: {
              companyId,
              sellerId: commission.sellerId,
              agreementId: payment.agreementId,
              paymentId: payment.id,
              commissionId: commission.id,
              monthlyClosingId: commission.monthlyClosingId || null,
              amountCents: -Math.abs(commission.amountCents),
              reason: `Estorno de recebimento pago/fechado #${payment.id}. Motivo: ${reason}`,
              status: 'PENDING',
              idempotencyKey: idempotencyKey ? `${idempotencyKey}_adj_${commission.id}` : undefined,
            },
          });
          await tx.creditCommission.update({
            where: { id: commission.id },
            data: {
              isReversed: true,
              reversedAt: new Date(),
              reversalReason: String(reason).trim(),
              status: 'REVERSED',
            },
          });
        } else {
          // Se ainda estava liberada em mês aberto (não paga), cancela a comissão diretamente
          await tx.creditCommission.update({
            where: { id: commission.id },
            data: {
              isReversed: true,
              reversedAt: new Date(),
              reversalReason: String(reason).trim(),
              status: 'REVERSED',
            },
          });
        }
      }

      // Marcar pagamento como estornado
      await tx.creditPayment.update({
        where: { id: payment.id },
        data: {
          isReversed: true,
          reversedAt: new Date(),
          reversedByUserId: authorId,
          reversalReason: String(reason).trim(),
        },
      });

      // Auditoria na timeline
      await tx.clientTimeline.create({
        data: {
          clientId: payment.agreement.clientId,
          previousStatus: 'RECEBIMENTO_CONFIRMADO',
          newStatus: 'RECEBIMENTO_ESTORNADO',
          authorId,
          authorRole: req.user?.role,
          action: 'CREDIT_PAYMENT_REVERSED',
          reason: `Estorno de recebimento no valor de R$ ${(payment.amountCents / 100).toFixed(2)}. Motivo: ${reason}`,
        },
      });

      return { success: true, reversed: true, remainingPrincipal: (newRemainingCents / 100) };
    });

    res.json(result);
  } catch (error: any) {
    if (error?.status && error?.message) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error('Error reversing credit payment:', error);
    res.status(500).json({ error: 'Erro ao estornar recebimento' });
  }
});

/**
 * POST /api/credit/agreements/:id/renegotiate
 * Renegociar saldo em aberto marcando parcelas anteriores como RENEGOTIATED sem duplicação de dívida
 */
router.post('/agreements/:id/renegotiate', authenticateToken, requireCreditAccess, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const companyId = req.user?.companyId;
    const authorId = req.user?.id;
    const userRole = req.user?.role || 'ADMIN';

    if (!companyId || !authorId) {
      res.status(401).json({ error: 'Usuário ou empresa não identificado' });
      return;
    }

    if (!isUserAdmin(req)) {
      res.status(403).json({
        error: 'Acesso negado: a carteira do vendedor é estritamente de consulta após a venda. Renegociações são restritas a gestores administrativos.',
      });
      return;
    }

    const installmentsCount = req.body.installmentsCount ?? req.body.numberOfInstallments;
    const periodicity = req.body.periodicity ?? req.body.frequency ?? 'MONTHLY';
    const firstDueDate = req.body.firstDueDate;
    const reason = req.body.reason ?? req.body.notes;
    const idempotencyKey = req.body.idempotencyKey;

    if (!reason || !String(reason).trim()) {
      res.status(400).json({ error: 'Motivo da renegociação é obrigatório' });
      return;
    }

    const parsedCount = parseInt(installmentsCount, 10);
    if (!Number.isFinite(parsedCount) || parsedCount < 1) {
      res.status(400).json({ error: 'Número de parcelas deve ser pelo menos 1' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      // Bloqueio pessimista no contrato
      await tx.$queryRawUnsafe('SELECT id FROM "CreditAgreement" WHERE id = $1 FOR UPDATE', id);

      const agreement = await tx.creditAgreement.findFirst({
        where: { id, companyId },
        include: {
          installments: {
            orderBy: { installmentNumber: 'asc' },
            include: { asaasCharge: true },
          },
        },
      });

      if (!agreement) {
        throw { status: 404, message: 'Contrato de crediário não encontrado' };
      }

      // Regra de autorização estrita: Admin e Supervisor podem renegociar qualquer contrato; Vendedor apenas da sua carteira
      if (userRole !== 'ADMIN' && userRole !== 'SUPERVISOR' && agreement.sellerId !== authorId) {
        throw { status: 403, message: 'Não autorizado a renegociar contratos de outra carteira' };
      }

      if (idempotencyKey) {
        const existingReneg = await tx.creditAgreementRenegotiation.findFirst({
          where: { agreementId: agreement.id, idempotencyKey: String(idempotencyKey).trim() },
        });
        if (existingReneg) {
          return {
            success: true,
            remainingPrincipalCents: existingReneg.newRemainingCents,
            newInstallments: existingReneg.newSchedule as any,
            oldChargesToCancel: [],
          };
        }
      }

      if (agreement.status === 'SETTLED' || agreement.remainingPrincipalCents <= 0) {
        throw { status: 400, message: 'Contrato já quitado não permite renegociação' };
      }

      const previousSchedule = agreement.installments;

      // PROIBIDO dar delete físico ou deixar PARTIAL aberta cobrando em paralelo!
      // Marcar TODAS as parcelas não quitadas como RENEGOTIATED
      const unSettledInstallments = agreement.installments.filter((i) => i.status !== 'PAID');
      for (const inst of unSettledInstallments) {
        await tx.creditInstallment.update({
          where: { id: inst.id },
          data: { status: 'RENEGOTIATED' },
        });
      }

      // Calcular novo cronograma exclusivamente sobre o saldo devedor remanescente real
      const newScheduleItems = calculateCreditSchedule({
        totalSaleCents: agreement.remainingPrincipalCents,
        downPaymentCents: 0,
        installmentsCount: parsedCount,
        periodicity,
        firstDueDate: new Date(firstDueDate || Date.now() + 30 * 24 * 3600 * 1000),
      });

      const maxOldNumber = agreement.installments.reduce((max, i) => Math.max(max, i.installmentNumber), 0);
      const createdInstallments = [];

      for (let i = 0; i < newScheduleItems.length; i++) {
        const item = newScheduleItems[i];
        const inst = await tx.creditInstallment.create({
          data: {
            agreementId: agreement.id,
            installmentNumber: maxOldNumber + i + 1,
            dueDate: item.dueDate,
            amountCents: item.amountCents,
            paidCents: 0,
            status: 'PENDING',
          },
        });
        createdInstallments.push(inst);
      }

      // Atualizar contrato
      await tx.creditAgreement.update({
        where: { id: agreement.id },
        data: {
          installmentsCount: agreement.installments.filter((i) => i.status === 'PAID').length + parsedCount,
          periodicity,
          status: 'RENEGOTIATED',
        },
      });

      // Registrar auditoria da renegociação
      await tx.creditAgreementRenegotiation.create({
        data: {
          agreementId: agreement.id,
          authorId,
          previousRemainingCents: agreement.remainingPrincipalCents,
          newRemainingCents: agreement.remainingPrincipalCents,
          reason: String(reason).trim(),
          previousSchedule: previousSchedule as any,
          newSchedule: createdInstallments as any,
          idempotencyKey: idempotencyKey ? String(idempotencyKey).trim() : undefined,
        },
      });

      return {
        success: true,
        remainingPrincipalCents: agreement.remainingPrincipalCents,
        newInstallments: createdInstallments,
        oldChargesToCancel: unSettledInstallments
          .filter((i) => i.asaasCharge && i.asaasCharge.status !== 'RECEIVED')
          .map((i) => i.asaasCharge!.externalId),
      };
    });

    // Cancelar boletos antigos no Asaas de forma assíncrona
    for (const extId of result.oldChargesToCancel) {
      cancelAsaasPayment(companyId, extId).catch((err) =>
        console.warn(`[Asaas] Aviso ao cancelar cobrança antiga ${extId}:`, err)
      );
    }

    res.json({
      success: true,
      remainingPrincipal: Number((result.remainingPrincipalCents / 100).toFixed(2)),
      newInstallments: result.newInstallments,
    });
  } catch (error: any) {
    if (error?.status && error?.message) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error('Error renegotiating credit agreement:', error);
    res.status(500).json({ error: error.message || 'Erro ao renegociar contrato' });
  }
});

/**
 * GET /api/credit/seller/portfolio & /api/credit/seller/my-portfolio
 * Carteira de crediário do vendedor (suporta sellerId para Admin)
 */
async function handleSellerPortfolio(req: AuthRequest, res: Response) {
  try {
    const companyId = req.user?.companyId;
    const currentUserId = req.user?.id;
    const isAdmin = isUserAdmin(req);

    if (!companyId || !currentUserId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    // Se não for admin e tentar passar sellerId de outro vendedor, rejeita com 403
    if (!isAdmin && req.query.sellerId && req.query.sellerId !== currentUserId) {
      res.status(403).json({ error: 'Acesso negado: você só pode consultar sua própria carteira' });
      return;
    }

    // Se admin, permite consultar qualquer vendedor via query; senão, estritamente o próprio
    const targetSellerId = (isAdmin && req.query.sellerId) ? String(req.query.sellerId) : currentUserId;

    const seller = await prisma.user.findFirst({
      where: { id: targetSellerId, companyId },
      select: { id: true, name: true, active: true },
    });

    if (!seller) {
      res.status(404).json({ error: 'Vendedor não encontrado' });
      return;
    }

    const agreements = await prisma.creditAgreement.findMany({
      where: { companyId, sellerId: targetSellerId },
      include: {
        client: {
          select: { id: true, name: true, visibleCode: true, sequenceNumber: true, city: true, phone1: true },
        },
        installments: {
          orderBy: { installmentNumber: 'asc' },
          include: { asaasCharge: true },
        },
        payments: {
          where: { isReversed: false },
          orderBy: { paidAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    let totalReceivableCents = 0;
    let overdueCents = 0;

    for (const a of agreements) {
      if (a.status === 'ACTIVE' || a.status === 'RENEGOTIATED') {
        totalReceivableCents += a.remainingPrincipalCents;
        for (const inst of a.installments) {
          if ((inst.status === 'PENDING' || inst.status === 'PARTIALLY_PAID' || inst.status === 'OVERDUE') && new Date(inst.dueDate) < now) {
            overdueCents += (inst.amountCents - inst.paidCents);
          }
        }
      }
    }

    // Comissões
    const commissions = await prisma.creditCommission.findMany({
      where: { companyId, sellerId: targetSellerId },
      orderBy: { createdAt: 'desc' },
      include: {
        agreement: { select: { buyerName: true, client: { select: { name: true } } } },
      },
    });

    const adjustments = await prisma.creditCommissionAdjustment.findMany({
      where: { companyId, sellerId: targetSellerId },
      orderBy: { createdAt: 'desc' },
    });

    const releasedCents = commissions.filter((c) => c.status === 'RELEASED' && !c.isReversed).reduce((sum, c) => sum + c.amountCents, 0);
    const paidCents = commissions.filter((c) => c.status === 'PAID').reduce((sum, c) => sum + c.amountCents, 0);
    const pendingAdjustmentsCents = adjustments.filter((a) => a.status === 'PENDING').reduce((sum, a) => sum + a.amountCents, 0);
    const netCommissionPayableCents = Math.max(0, releasedCents - pendingAdjustmentsCents);

    res.json({
      seller,
      totalReceivableCents,
      totalReceivable: Number((totalReceivableCents / 100).toFixed(2)),
      overdueCents,
      overdueAmount: Number((overdueCents / 100).toFixed(2)),
      releasedCommissionsCents: releasedCents,
      releasedCommissions: Number((releasedCents / 100).toFixed(2)),
      paidCommissionsCents: paidCents,
      paidCommissions: Number((paidCents / 100).toFixed(2)),
      pendingAdjustmentsCents,
      pendingAdjustments: Number((pendingAdjustmentsCents / 100).toFixed(2)),
      netCommissionPayableCents,
      netCommissionPayable: Number((netCommissionPayableCents / 100).toFixed(2)),
      agreements,
      commissions,
      adjustments,
    });
  } catch (error: any) {
    console.error('Error fetching seller portfolio:', error);
    res.status(500).json({ error: error.message || 'Erro ao carregar carteira do vendedor' });
  }
}

router.get('/seller/portfolio', authenticateToken, requireCreditAccess, handleSellerPortfolio);
router.get('/seller/my-portfolio', authenticateToken, requireCreditAccess, handleSellerPortfolio);

/**
 * POST /api/credit/commissions/pay
 * Liquidação de lote de comissões liberadas do vendedor com compensação de ajustes
 */
router.post('/commissions/pay', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const authorId = req.user?.id;

    if (!companyId || !authorId) {
      res.status(401).json({ error: 'Usuário ou empresa não identificado' });
      return;
    }

    const {
      sellerId,
      commissionIds,
      paymentMethod = 'PIX',
      receiptUrl,
      notes,
      idempotencyKey,
    } = req.body;

    if (!sellerId) {
      res.status(400).json({ error: 'sellerId é obrigatório' });
      return;
    }

    const ids: string[] = Array.isArray(commissionIds) ? commissionIds : (req.body.commissionId ? [req.body.commissionId] : []);
    if (ids.length === 0) {
      res.status(400).json({ error: 'Selecione pelo menos uma comissão liberada para liquidar' });
      return;
    }

    const payoutId = `payout_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const result = await prisma.$transaction(async (tx) => {
      // Bloqueio pessimista nas comissões
      const commissions = await tx.creditCommission.findMany({
        where: {
          id: { in: ids },
          companyId,
          sellerId,
        },
      });

      if (commissions.length !== ids.length) {
        throw { status: 400, message: 'Alguma das comissões selecionadas não pertence a este vendedor/empresa' };
      }

      // Comissões dos 10% das parcelas pertencem exclusivamente ao Fechamento Mensal de Crediário
      const installmentCommissions = commissions.filter((c) => c.type === 'INSTALLMENT');
      if (installmentCommissions.length > 0) {
        throw {
          status: 400,
          code: 'INSTALLMENT_COMMISSION_MONTHLY_ONLY',
          message: 'Comissões de parcelas posteriores (10%) devem ser liquidadas exclusivamente pelo Fechamento Mensal de Crediário, não pelo pagamento avulso.',
        };
      }

      const invalid = commissions.filter((c) => c.status !== 'RELEASED' || c.isReversed);
      if (invalid.length > 0) {
        throw { status: 400, message: 'Apenas comissões com status RELEASED podem ser liquidadas' };
      }

      const totalCommissionCents = commissions.reduce((sum, c) => sum + c.amountCents, 0);

      // Buscar ajustes de débito pendentes deste vendedor para compensar no repasse
      const pendingAdjustments = await tx.creditCommissionAdjustment.findMany({
        where: { companyId, sellerId, status: 'PENDING' },
      });

      let remainingCommissionToOffset = totalCommissionCents;
      let totalAdjustedCents = 0;

      for (const adj of pendingAdjustments) {
        if (remainingCommissionToOffset <= 0) break;
        if (remainingCommissionToOffset >= adj.amountCents) {
          await tx.creditCommissionAdjustment.update({
            where: { id: adj.id },
            data: {
              status: 'APPLIED',
              appliedPayoutId: payoutId,
              appliedAt: new Date(),
            },
          });
          remainingCommissionToOffset -= adj.amountCents;
          totalAdjustedCents += adj.amountCents;
        }
      }

      const netPaidCents = Math.max(0, totalCommissionCents - totalAdjustedCents);

      // Atualizar comissões para PAID
      await tx.creditCommission.updateMany({
        where: { id: { in: ids } },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          paidByUserId: authorId,
          payoutId,
          paidMethod: paymentMethod,
          paidReceiptUrl: receiptUrl,
          paidNotes: notes,
        },
      });

      return {
        payoutId,
        grossCents: totalCommissionCents,
        adjustedCents: totalAdjustedCents,
        netPaidCents,
        count: ids.length,
      };
    });

    res.json({
      success: true,
      payoutId: result.payoutId,
      grossAmount: Number((result.grossCents / 100).toFixed(2)),
      adjustedAmount: Number((result.adjustedCents / 100).toFixed(2)),
      netPaidAmount: Number((result.netPaidCents / 100).toFixed(2)),
      commissionsPaidCount: result.count,
    });
  } catch (error: any) {
    if (error?.status && error?.message) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    console.error('Error paying credit commissions:', error);
    res.status(500).json({ error: error.message || 'Erro ao registrar pagamento de comissões' });
  }
});

/**
 * POST /api/credit/commissions/:id/pay
 * Rota compatível com chamada unitária do mobile
 */
router.post('/commissions/:id/pay', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  const commission = await prisma.creditCommission.findUnique({
    where: { id: req.params.id as string },
  });
  if (!commission) {
    res.status(404).json({ error: 'Comissão não encontrada' });
    return;
  }
  req.body.sellerId = commission.sellerId;
  req.body.commissionIds = [commission.id];
  (router as any).handle(req, res, () => {});
});

/**
 * =========================================================================
 * ENDPOINTS DO FECHAMENTO MENSAL DO CREDIÁRIO (10% DAS PARCELAS)
 * =========================================================================
 */

/**
 * GET /api/credit/monthly-closings
 * Lista fechamentos mensais por competência e vendedor
 * Admin vê de todos os vendedores; Vendedor comum só vê os próprios
 */
router.get('/monthly-closings', authenticateToken, requireCreditAccess, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }

    const isAdmin = isUserAdmin(req);
    const { competence, sellerId: querySellerId, status } = req.query as {
      competence?: string;
      sellerId?: string;
      status?: string;
    };

    if (!isAdmin && querySellerId && querySellerId !== req.user?.id) {
      res.status(403).json({ error: 'Acesso negado: você só pode consultar seus próprios fechamentos' });
      return;
    }

    const effectiveSellerId = isAdmin ? (querySellerId || undefined) : req.user?.id;

    const where: any = {
      ...(companyId ? { companyId } : {}),
      ...(effectiveSellerId ? { sellerId: effectiveSellerId } : {}),
      ...(competence ? { competence } : {}),
      ...(status ? { status } : {}),
    };

    const closings = await prisma.monthlyCreditClosing.findMany({
      where,
      orderBy: [{ competence: 'desc' }, { createdAt: 'desc' }],
      include: {
        seller: {
          select: { id: true, name: true, email: true, active: true },
        },
        payouts: {
          orderBy: { paidAt: 'desc' },
        },
      },
    });

    res.json({
      closings: closings.map((c) => ({
        id: c.id,
        competence: c.competence,
        status: c.status,
        sellerId: c.sellerId,
        sellerName: c.seller.name,
        sellerActive: c.seller.active,
        startDate: c.startDate,
        endDate: c.endDate,
        totalPrincipalReceived: Number((c.totalPrincipalReceivedCents / 100).toFixed(2)),
        totalCommission: Number((c.totalCommissionCents / 100).toFixed(2)),
        adjustments: Number((c.adjustmentsCents / 100).toFixed(2)),
        netCommission: Number((c.netCommissionCents / 100).toFixed(2)),
        paidAmount: Number((c.paidAmountCents / 100).toFixed(2)),
        remainingBalance: Number((c.remainingBalanceCents / 100).toFixed(2)),
        itemsCount: c.itemsCount,
        calculatedAt: c.calculatedAt,
        notes: c.notes,
        payoutsCount: c.payouts.length,
      })),
    });
  } catch (error: any) {
    console.error('Error fetching monthly credit closings:', error);
    res.status(500).json({ error: error.message || 'Erro ao listar fechamentos mensais' });
  }
});

/**
 * GET /api/credit/monthly-closings/:id
 * Detalhes de um fechamento mensal com suas comissões, ajustes e pagamentos
 */
router.get('/monthly-closings/:id', authenticateToken, requireCreditAccess, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const closingId = req.params.id as string;

    const closing = await prisma.monthlyCreditClosing.findFirst({
      where: {
        id: closingId,
        ...(companyId ? { companyId } : {}),
      },
      include: {
        seller: { select: { id: true, name: true, email: true } },
        payouts: {
          orderBy: { paidAt: 'desc' },
          include: { author: { select: { id: true, name: true } } },
        },
        commissions: {
          orderBy: { createdAt: 'asc' },
          include: {
            payment: {
              include: {
                agreement: {
                  select: {
                    id: true,
                    buyerName: true,
                    client: { select: { id: true, name: true, sequenceNumber: true } },
                  },
                },
              },
            },
          },
        },
        adjustments: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!closing) {
      res.status(404).json({ error: 'Fechamento mensal não encontrado' });
      return;
    }

    const isAdmin = isUserAdmin(req);
    if (!isAdmin && closing.sellerId !== req.user?.id) {
      res.status(403).json({ error: 'Acesso negado: fechamento pertence a outro vendedor' });
      return;
    }

    res.json({
      closing: {
        id: closing.id,
        competence: closing.competence,
        status: closing.status,
        seller: closing.seller,
        startDate: closing.startDate,
        endDate: closing.endDate,
        totalPrincipalReceived: Number((closing.totalPrincipalReceivedCents / 100).toFixed(2)),
        totalCommission: Number((closing.totalCommissionCents / 100).toFixed(2)),
        adjustmentsAmount: Number((closing.adjustmentsCents / 100).toFixed(2)),
        netCommission: Number((closing.netCommissionCents / 100).toFixed(2)),
        paidAmount: Number((closing.paidAmountCents / 100).toFixed(2)),
        remainingBalance: Number((closing.remainingBalanceCents / 100).toFixed(2)),
        itemsCount: closing.itemsCount,
        calculatedAt: closing.calculatedAt,
        notes: closing.notes,
        payouts: closing.payouts.map((p) => ({
          id: p.id,
          amount: Number((p.amountCents / 100).toFixed(2)),
          paymentMethod: p.paymentMethod,
          receiptUrl: p.receiptUrl,
          notes: p.notes,
          paidAt: p.paidAt,
          authorName: p.author?.name || 'Administrador',
        })),
        commissions: closing.commissions.map((c) => ({
          id: c.id,
          type: c.type,
          amount: Number((c.amountCents / 100).toFixed(2)),
          status: c.status,
          rate: (c as any).rate ?? 0.10,
          createdAt: c.createdAt,
          buyerName: c.payment?.agreement?.buyerName || c.payment?.agreement?.client?.name || 'Cliente',
          agreementId: c.agreementId,
        })),
        adjustments: closing.adjustments.map((a) => ({
          id: a.id,
          amount: Number((a.amountCents / 100).toFixed(2)),
          reason: a.reason,
          status: a.status,
          createdAt: a.createdAt,
        })),
      },
    });
  } catch (error: any) {
    console.error('Error fetching monthly closing detail:', error);
    res.status(500).json({ error: error.message || 'Erro ao obter detalhes do fechamento' });
  }
});

/**
 * POST /api/credit/monthly-closings/process
 * Executa ou recupera a apuração formal de competência encerrada para um vendedor
 * Exclusivo Admin / Supervisor
 */
router.post('/monthly-closings/process', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }

    const { sellerId, competence, notes } = req.body;
    if (!sellerId || !competence) {
      res.status(400).json({ error: 'sellerId e competence (YYYY-MM) são obrigatórios' });
      return;
    }

    const result = await processMonthlyCreditClosing({
      companyId,
      sellerId,
      competence: String(competence).trim(),
      closedByUserId: req.user?.id,
      notes,
    });

    const closing = result.closing!;
    res.json({
      success: true,
      created: result.created,
      closing: {
        id: closing.id,
        competence: closing.competence,
        status: closing.status,
        totalPrincipalReceived: Number((closing.totalPrincipalReceivedCents / 100).toFixed(2)),
        totalCommission: Number((closing.totalCommissionCents / 100).toFixed(2)),
        adjustments: Number((closing.adjustmentsCents / 100).toFixed(2)),
        netCommission: Number((closing.netCommissionCents / 100).toFixed(2)),
        paidAmount: Number((closing.paidAmountCents / 100).toFixed(2)),
        remainingBalance: Number((closing.remainingBalanceCents / 100).toFixed(2)),
        itemsCount: closing.itemsCount,
      },
    });
  } catch (error: any) {
    if (error?.status && error?.message) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    console.error('Error processing monthly credit closing:', error);
    res.status(500).json({ error: error.message || 'Erro ao processar fechamento mensal' });
  }
});

/**
 * POST /api/credit/monthly-closings/:id/payout
 * Registra acerto (parcial ou integral) do fechamento mensal de comissão
 * Exclusivo Admin / Supervisor. Suporta chave de idempotência persistente.
 */
router.post('/monthly-closings/:id/payout', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const authorId = req.user?.id;
    if (!companyId || !authorId) {
      res.status(403).json({ error: 'Empresa ou usuário não identificado' });
      return;
    }

    const closingId = req.params.id as string;
    const { amount, amountCents: bodyAmountCents, paymentMethod = 'PIX', receiptUrl, notes, idempotencyKey } = req.body;

    const amountCents = typeof bodyAmountCents === 'number'
      ? bodyAmountCents
      : (typeof amount === 'number' ? Math.round(amount * 100) : NaN);

    if (isNaN(amountCents) || amountCents <= 0) {
      res.status(400).json({ error: 'Informe um valor de pagamento válido maior que zero' });
      return;
    }

    const result = await recordMonthlyCreditPayout({
      companyId,
      closingId,
      amountCents,
      paymentMethod,
      receiptUrl,
      notes,
      authorId,
      idempotencyKey,
    });

    res.json({
      success: true,
      idempotentReplay: result.idempotentReplay,
      payout: {
        id: result.payout.id,
        amount: Number((result.payout.amountCents / 100).toFixed(2)),
        paymentMethod: result.payout.paymentMethod,
        paidAt: result.payout.paidAt,
      },
      closing: {
        id: result.closing?.id || closingId,
        status: result.closing?.status,
        paidAmount: Number(((result.closing?.paidAmountCents || 0) / 100).toFixed(2)),
        remainingBalance: Number(((result.closing?.remainingBalanceCents || 0) / 100).toFixed(2)),
      },
    });
  } catch (error: any) {
    if (error?.status && error?.message) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    console.error('Error recording monthly closing payout:', error);
    res.status(500).json({ error: error.message || 'Erro ao registrar acerto mensal' });
  }
});

/**
 * GET /api/credit/seller/four-states
 * Retorna os 4 estados visíveis da comissão do crediário:
 * 1. Prevista / Futura
 * 2. Acumulada no Mês Aberto
 * 3. Mês Fechado — A Pagar
 * 4. Parcialmente Paga / Paga
 */
router.get('/seller/four-states', authenticateToken, requireCreditAccess, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId || (req.query.companyId as string);
    if (!companyId) {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }

    const isAdmin = isUserAdmin(req);
    const { sellerId: querySellerId } = req.query as { sellerId?: string };

    if (!isAdmin && querySellerId && querySellerId !== req.user?.id) {
      res.status(403).json({ error: 'Acesso negado: vendedor só pode consultar seus próprios estados de comissão' });
      return;
    }

    const effectiveSellerId = (isAdmin && querySellerId) ? querySellerId : req.user?.id;
    if (!effectiveSellerId) {
      res.status(400).json({ error: 'Vendedor não identificado' });
      return;
    }

    const data = await getSellerFourCommissionStates(companyId, effectiveSellerId);
    res.json(data);
  } catch (error: any) {
    console.error('Error fetching four commission states:', error);
    res.status(500).json({ error: error.message || 'Erro ao consultar estados de comissão' });
  }
});

/**
 * =========================================================================
 * ENDPOINTS DE INTEGRAÇÃO ASAAS
 * =========================================================================
 */

/**
 * GET /api/credit/asaas/config
 * Retorna configuração atual do Asaas (modo, webhook token)
 */
router.get('/asaas/config', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }
    const config = await getCompanyAsaasConfig(companyId);
    res.json({
      mode: config.mode,
      hasApiKey: Boolean(config.apiKey),
      hasWebhookToken: Boolean(config.webhookToken),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/credit/asaas/config
 * Atualiza modo e chaves do Asaas para a empresa
 */
router.post('/asaas/config', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }

    const { mode, apiKey, webhookToken } = req.body;
    if (!['DISABLED', 'SANDBOX', 'PRODUCTION'].includes(mode)) {
      res.status(400).json({ error: 'Modo inválido. Opções: DISABLED, SANDBOX, PRODUCTION' });
      return;
    }

    const updated = await prisma.asaasConfig.upsert({
      where: { companyId },
      create: {
        companyId,
        mode,
        apiKey: apiKey ? String(apiKey).trim() : null,
        webhookToken: webhookToken ? String(webhookToken).trim() : null,
      },
      update: {
        mode,
        ...(apiKey !== undefined ? { apiKey: apiKey ? String(apiKey).trim() : null } : {}),
        ...(webhookToken !== undefined ? { webhookToken: webhookToken ? String(webhookToken).trim() : null } : {}),
      },
    });

    res.json({
      success: true,
      mode: updated.mode,
      hasApiKey: Boolean(updated.apiKey),
      hasWebhookToken: Boolean(updated.webhookToken),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/credit/agreements/:id/emit-asaas
 * Emissão sob demanda de cobranças bancárias no Asaas para um contrato (Admin)
 */
router.post('/agreements/:id/emit-asaas', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const agreementId = req.params.id as string;
    const companyId = req.user?.companyId;
    if (!companyId) {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }

    const config = await getCompanyAsaasConfig(companyId);
    if (config.mode === 'DISABLED') {
      res.status(400).json({ error: 'Integração bancária com Asaas está DESATIVADA nesta empresa. Ative o modo SANDBOX ou PRODUCTION nas configurações.' });
      return;
    }

    const agreement = await prisma.creditAgreement.findFirst({
      where: { id: agreementId, companyId },
      include: {
        installments: {
          where: { status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] } },
          orderBy: { installmentNumber: 'asc' },
          include: { asaasCharge: true },
        },
      },
    });

    if (!agreement) {
      res.status(404).json({ error: 'Contrato não encontrado' });
      return;
    }

    // 1. Sincronizar cliente no Asaas
    const customerExternalId = await syncAsaasCustomer(companyId, {
      name: agreement.buyerName,
      cpfCnpj: agreement.buyerCpf,
      address: agreement.street,
      addressNumber: agreement.number,
      province: agreement.neighborhood,
      city: agreement.city,
      state: agreement.state,
      postalCode: agreement.cep,
      externalReference: agreement.clientId,
    });

    // 2. Criar cobranças para parcelas não pagas que ainda não tenham cobrança externa
    const emittedCharges: any[] = [];

    for (const inst of agreement.installments) {
      if (inst.asaasCharge) {
        emittedCharges.push(inst.asaasCharge);
        continue;
      }

      const unpaidCents = inst.amountCents - inst.paidCents;
      const chargeRes = await createAsaasChargeForInstallment(companyId, {
        customerExternalId,
        billingType: 'UNDEFINED',
        value: unpaidCents / 100.0,
        dueDate: new Date(inst.dueDate).toISOString().split('T')[0],
        description: `Parcela ${inst.installmentNumber}/${agreement.installmentsCount} - Contrato ${agreement.buyerName}`,
        externalReference: inst.id,
      });

      const charge = await prisma.asaasCharge.create({
        data: {
          companyId,
          agreementId: agreement.id,
          installmentId: inst.id,
          externalId: chargeRes.externalId,
          customerExternalId,
          billingType: 'UNDEFINED',
          status: chargeRes.status,
          nominalValueCents: chargeRes.nominalValueCents,
          netValueCents: chargeRes.netValueCents,
          dueDate: inst.dueDate,
          bankSlipUrl: chargeRes.bankSlipUrl,
          invoiceUrl: chargeRes.invoiceUrl,
          identificationField: chargeRes.identificationField,
          pixQrCodeUrl: chargeRes.pixQrCodeUrl,
          pixPayload: chargeRes.pixPayload,
        },
      });

      emittedCharges.push(charge);
    }

    res.json({
      success: true,
      chargesCount: emittedCharges.length,
      charges: emittedCharges,
    });
  } catch (err: any) {
    console.error('Error emitting Asaas charges:', err);
    res.status(500).json({ error: err.message || 'Erro ao emitir cobranças no Asaas' });
  }
});

/**
 * GET /api/credit/asaas/duplicate-alerts
 * Alertas de conciliação / pagamento bancário duplicado após baixa manual
 */
router.get('/asaas/duplicate-alerts', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const alerts = await prisma.asaasDuplicatePaymentAlert.findMany({
      where: { ...(companyId ? { companyId } : {}), status: 'PENDING' },
      include: {
        agreement: { select: { buyerName: true, remainingPrincipalCents: true } },
        installment: { select: { installmentNumber: true, amountCents: true, dueDate: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(alerts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/credit/asaas/duplicate-alerts/:id/resolve
 * Resolução manual pelo Admin: alocar na próxima parcela ou estornar/devolver
 */
router.post('/asaas/duplicate-alerts/:id/resolve', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { action, notes } = req.body; // 'ALLOCATE_NEXT' | 'REFUND'
    const companyId = req.user?.companyId;
    const authorId = req.user?.id;

    if (!companyId || !authorId) {
      res.status(403).json({ error: 'Empresa ou usuário não identificado' });
      return;
    }

    if (!['ALLOCATE_NEXT', 'REFUND'].includes(action)) {
      res.status(400).json({ error: 'Ação inválida. Use ALLOCATE_NEXT ou REFUND.' });
      return;
    }

    const alert = await prisma.asaasDuplicatePaymentAlert.findFirst({
      where: { id, companyId },
      include: {
        agreement: {
          include: {
            installments: {
              where: { status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] } },
              orderBy: { installmentNumber: 'asc' },
            },
          },
        },
        installment: true,
      },
    });

    if (!alert) {
      res.status(404).json({ error: 'Alerta de conciliação não encontrado para esta empresa' });
      return;
    }

    if (action === 'ALLOCATE_NEXT') {
      const result = await prisma.$transaction(async (tx) => {
        // Bloqueio pessimista no próprio alerta para evitar resoluções concorrentes simultâneas
        await tx.$queryRaw`SELECT id FROM "AsaasDuplicatePaymentAlert" WHERE id = ${alert.id} FOR UPDATE`;
        const freshAlert = await tx.asaasDuplicatePaymentAlert.findUniqueOrThrow({ where: { id: alert.id } });

        if (freshAlert.status !== 'PENDING') {
          throw { status: 400, message: `Alerta já se encontra com status ${freshAlert.status}` };
        }

        // Bloqueio pessimista no contrato
        await tx.$queryRaw`SELECT id FROM "CreditAgreement" WHERE id = ${freshAlert.agreementId} FOR UPDATE`;
        const freshAgreement = await tx.creditAgreement.findUniqueOrThrow({
          where: { id: freshAlert.agreementId },
          include: {
            installments: {
              where: { status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] } },
              orderBy: { installmentNumber: 'asc' },
            },
          },
        });

        if (freshAgreement.installments.length === 0) {
          throw { status: 400, message: 'Não há parcelas em aberto no contrato para alocação' };
        }

        // Distribuir o pagamento entre as parcelas elegíveis até esgotar o valor
        let remainingToAllocate = freshAlert.amountCents;
        let totalAmortizedCents = 0;
        const allocationsToCreate: { installmentId: string; amountCents: number }[] = [];

        for (const inst of freshAgreement.installments) {
          if (remainingToAllocate <= 0) break;
          const unpaid = inst.amountCents - inst.paidCents;
          if (unpaid <= 0) continue;

          const allocated = Math.min(remainingToAllocate, unpaid);
          allocationsToCreate.push({ installmentId: inst.id, amountCents: allocated });
          remainingToAllocate -= allocated;
          totalAmortizedCents += allocated;
        }

        if (totalAmortizedCents === 0) {
          throw { status: 400, message: 'Nenhuma parcela disponível para amortização' };
        }

        const creditPayment = await tx.creditPayment.create({
          data: {
            agreementId: freshAgreement.id,
            companyId,
            amountCents: totalAmortizedCents,
            paymentMethod: 'ASAAS_DUPLICATE_ALLOCATION',
            receivedByRole: 'BANK',
            receiverUserId: freshAgreement.sellerId,
            destination: 'COMPANY_ACCOUNT',
            externalPaymentId: `${freshAlert.externalPaymentId}:allocated`,
            isAsaasSettled: true,
            settledAt: new Date(),
            notes: `Alocação de pagamento em duplicidade (${freshAlert.externalPaymentId}). ${notes || ''}`.trim(),
          },
        });

        for (const alloc of allocationsToCreate) {
          const inst = freshAgreement.installments.find((i) => i.id === alloc.installmentId)!;
          const newPaidCents = inst.paidCents + alloc.amountCents;
          const isFullyPaid = newPaidCents >= inst.amountCents;

          await tx.creditPaymentAllocation.create({
            data: {
              paymentId: creditPayment.id,
              installmentId: inst.id,
              allocatedCents: alloc.amountCents,
            },
          });

          await tx.creditInstallment.update({
            where: { id: inst.id },
            data: {
              paidCents: newPaidCents,
              status: isFullyPaid ? 'PAID' : 'PARTIALLY_PAID',
              paidAt: isFullyPaid ? new Date() : undefined,
            },
          });
        }

        // Atualizar saldo do contrato
        const newRemaining = Math.max(0, freshAgreement.remainingPrincipalCents - totalAmortizedCents);
        await tx.creditAgreement.update({
          where: { id: freshAgreement.id },
          data: {
            remainingPrincipalCents: newRemaining,
            paidPrincipalCents: freshAgreement.paidPrincipalCents + totalAmortizedCents,
            status: newRemaining === 0 ? 'SETTLED' : freshAgreement.status,
          },
        });

        // Gerar comissão de 10% sobre o principal efetivamente amortizado, uma única vez
        const commissionCents = Math.round(totalAmortizedCents * 0.10);
        if (commissionCents > 0) {
          await tx.creditCommission.create({
            data: {
              companyId,
              agreementId: freshAgreement.id,
              paymentId: creditPayment.id,
              sellerId: freshAgreement.sellerId,
              amountCents: commissionCents,
              type: 'INSTALLMENT',
              status: 'RELEASED',
            },
          });
        }

        // Qualquer excedente deve permanecer explicitamente registrado para conciliação/devolução
        let surplusAlertId: string | null = null;
        if (remainingToAllocate > 0) {
          const realBankPaymentId =
            freshAlert.bankPaymentId ||
            (freshAlert.externalPaymentId ? freshAlert.externalPaymentId.replace(/:surplus$/, '') : '');

          const surplusAlert = await tx.asaasDuplicatePaymentAlert.create({
            data: {
              companyId,
              agreementId: freshAgreement.id,
              installmentId: freshAlert.installmentId,
              externalPaymentId: `${freshAlert.externalPaymentId}:surplus`,
              bankPaymentId: realBankPaymentId,
              amountCents: remainingToAllocate,
              reason: `Excedente não amortizado de pagamento em duplicidade (${freshAlert.externalPaymentId}). Saldo do contrato esgotado.`,
              status: 'PENDING',
              notes: `Excedente de R$ ${(remainingToAllocate / 100).toFixed(2)} registrado para conciliação/devolução. Cobrança bancária real: ${realBankPaymentId}.`,
            },
          });
          surplusAlertId = surplusAlert.id;

          await tx.asaasDuplicatePaymentAlert.update({
            where: { id: freshAlert.id },
            data: {
              status: 'RESOLVED_ALLOCATED',
              resolvedAt: new Date(),
              resolvedByUserId: authorId,
              notes: `Amortizado R$ ${(totalAmortizedCents / 100).toFixed(2)}. Excedente de R$ ${(remainingToAllocate / 100).toFixed(2)} registrado em alerta residual (${surplusAlert.id}) para devolução/conciliação. ${notes ? notes.trim() : ''}`.trim(),
            },
          });
        } else {
          await tx.asaasDuplicatePaymentAlert.update({
            where: { id: freshAlert.id },
            data: {
              status: 'RESOLVED_ALLOCATED',
              resolvedAt: new Date(),
              resolvedByUserId: authorId,
              notes: notes ? String(notes).trim() : 'Alocado integralmente nas parcelas pendentes com sucesso',
            },
          });
        }

        return {
          totalAmortizedCents,
          surplusCents: remainingToAllocate,
          surplusAlertId,
          commissionCents,
        };
      });

      res.json({
        success: true,
        action: 'ALLOCATE_NEXT',
        status: 'RESOLVED_ALLOCATED',
        ...result,
      });
      return;
    }

    if (action === 'REFUND') {
      const asaasConfig = await getCompanyAsaasConfig(companyId);

      // Trava pessimista e releitura do alerta antes do estorno
      const { freshAlert, realBankPaymentId } = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "AsaasDuplicatePaymentAlert" WHERE id = ${alert.id} FOR UPDATE`;
        const reloaded = await tx.asaasDuplicatePaymentAlert.findUniqueOrThrow({ where: { id: alert.id } });
        if (reloaded.status !== 'PENDING' && reloaded.status !== 'REFUND_REQUESTED') {
          throw { status: 400, message: `Alerta já se encontra com status ${reloaded.status}` };
        }

        // Reconciliar identificador bancário real para alertas novos e legados
        let bankId = reloaded.bankPaymentId;
        if (!bankId) {
          const rawId = reloaded.externalPaymentId.replace(/:surplus$/, '');
          const linkedCharge = await tx.asaasCharge.findFirst({
            where: {
              companyId,
              OR: [
                { externalId: rawId },
                { externalId: reloaded.externalPaymentId },
                { installmentId: reloaded.installmentId },
              ],
            },
          });
          bankId = linkedCharge?.externalId || rawId;
        }

        await tx.asaasDuplicatePaymentAlert.update({
          where: { id: alert.id },
          data: {
            status: 'REFUND_PROCESSING',
            bankPaymentId: bankId,
            resolvedByUserId: authorId,
            notes: notes ? String(notes).trim() : 'Estorno bancário solicitado',
          },
        });

        return { freshAlert: reloaded, realBankPaymentId: bankId };
      });

      let refundStatus = 'REFUND_PROCESSING';
      if (asaasConfig.mode !== 'DISABLED') {
        try {
          const refundRes = await refundAsaasPayment(
            companyId,
            realBankPaymentId,
            freshAlert.amountCents / 100.0,
            notes
          );
          if (refundRes?.status === 'REFUNDED') {
            refundStatus = 'REFUNDED';
            await prisma.asaasDuplicatePaymentAlert.update({
              where: { id: alert.id },
              data: {
                status: 'REFUNDED',
                resolvedAt: new Date(),
              },
            });
          }
        } catch (refundErr: any) {
          console.error('[Asaas Refund] Erro ao solicitar estorno no Asaas:', refundErr);
          res.status(502).json({ error: `Falha ao processar estorno no Asaas: ${refundErr.message}` });
          return;
        }
      }

      res.json({
        success: true,
        action: 'REFUND',
        status: refundStatus,
        bankPaymentId: realBankPaymentId,
        refundAmountCents: freshAlert.amountCents,
      });
      return;
    }
  } catch (err: any) {
    if (err?.status && err?.message) {
      return res.status(err.status).json({ error: err.message });
    }
    res.status(500).json({ error: err.message || 'Erro ao resolver alerta' });
  }
});

/**
 * POST /api/credit/webhooks/asaas
 * Webhook oficial do Asaas com autenticação estrita, trava pessimista,
 * releitura de saldos atualizados dentro da transação e máquina de estados idempotente
 */
router.post('/webhooks/asaas', async (req, res) => {
  // 1. AUTENTICAÇÃO OBRIGATÓRIA ANTES DE QUALQUER MUTAÇÃO
  const tokenHeader = (req.headers['asaas-access-token'] || req.headers['asaas-webhook-token']) as string | undefined;
  if (!tokenHeader || !tokenHeader.trim()) {
    return res.status(401).json({ error: 'Token de autenticação do webhook ausente' });
  }

  const asaasConfig = await prisma.asaasConfig.findFirst({
    where: { webhookToken: tokenHeader.trim() },
    include: { company: true },
  });

  if (!asaasConfig) {
    return res.status(401).json({ error: 'Token de webhook inválido ou não autorizado' });
  }

  // 2. RESPEITO ESTRITO AO MODO OPERACIONAL
  if (asaasConfig.mode === 'DISABLED') {
    return res.status(403).json({ error: 'Integração bancária Asaas está DESATIVADA para esta empresa' });
  }

  const rawPayload = req.body;
  const eventName = rawPayload?.event;
  const paymentData = rawPayload?.payment;
  const externalPaymentId = paymentData?.id;

  if (!eventName || !paymentData || !externalPaymentId) {
    return res.status(400).json({ error: 'Payload de webhook inválido' });
  }

  // 3. Persistência de auditoria apenas após autenticação e validação
  let savedEventId: string | null = null;
  try {
    const saved = await prisma.asaasWebhookEvent.create({
      data: {
        companyId: asaasConfig.companyId,
        eventId: rawPayload?.id ? String(rawPayload.id) : undefined,
        event: eventName,
        externalPaymentId,
        payload: rawPayload as any,
        processed: false,
      },
    });
    savedEventId = saved.id;
  } catch (logErr) {
    console.error('[Asaas Webhook] Erro ao gravar auditoria do webhook:', logErr);
  }

  // 4. Deduplicação idempotente de eventos
  if (rawPayload?.id) {
    const duplicateEvent = await prisma.asaasWebhookEvent.findFirst({
      where: {
        companyId: asaasConfig.companyId,
        eventId: String(rawPayload.id),
        processed: true,
        id: { not: savedEventId || undefined },
      },
    });
    if (duplicateEvent) {
      return res.status(200).json({ received: true, deduplicated: true });
    }
  }

  try {
    // 5. Localizar cobrança pertencente exclusivamente a esta empresa autenticada
    const charge = await prisma.asaasCharge.findFirst({
      where: {
        companyId: asaasConfig.companyId,
        externalId: externalPaymentId,
      },
      include: {
        agreement: true,
        installment: true,
      },
    });

    // Se não encontrou cobrança, verifica se há alerta de duplicidade registrado para esta empresa
    const duplicateAlert = !charge
      ? await prisma.asaasDuplicatePaymentAlert.findFirst({
          where: { externalPaymentId, companyId: asaasConfig.companyId },
        })
      : null;

    // REGRA DE SEGURANÇA: Não aceitar eventos de referências externas não vinculadas à empresa
    if (!charge && !duplicateAlert) {
      console.warn(`[Asaas Webhook] Cobrança/referência externa ${externalPaymentId} não cadastrada localmente para empresa ${asaasConfig.companyId}.`);
      if (savedEventId) {
        await prisma.asaasWebhookEvent.update({
          where: { id: savedEventId },
          data: { processed: true, processedAt: new Date(), processingError: 'Cobrança não vinculada localmente' },
        });
      }
      return res.status(200).json({ received: true, unlinked: true });
    }

    const nominalValueCents = Math.round(Number(paymentData.value) * 100);
    const netValueCents = paymentData.netValue ? Math.round(Number(paymentData.netValue) * 100) : nominalValueCents;
    const feeCents = Math.max(0, nominalValueCents - netValueCents);

    // =========================================================================
    // EVENTO: PAYMENT_CONFIRMED ou PAYMENT_RECEIVED (Máquina de estados bancária)
    // =========================================================================
    if ((eventName === 'PAYMENT_CONFIRMED' || eventName === 'PAYMENT_RECEIVED') && charge) {
      await prisma.$transaction(async (tx) => {
        // Bloqueio pessimista no contrato, na parcela e na cobrança
        await tx.$queryRaw`SELECT id FROM "CreditAgreement" WHERE id = ${charge.agreementId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "CreditInstallment" WHERE id = ${charge.installmentId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "AsaasCharge" WHERE id = ${charge.id} FOR UPDATE`;

        // RELEITURA OBRIGATÓRIA DE SALDOS E ESTADOS ATUALIZADOS SOB A TRAVA
        const freshAgreement = await tx.creditAgreement.findUniqueOrThrow({ where: { id: charge.agreementId } });
        const freshInstallment = await tx.creditInstallment.findUniqueOrThrow({ where: { id: charge.installmentId } });
        const freshCharge = await tx.asaasCharge.findUniqueOrThrow({ where: { id: charge.id } });

        // A. Se a parcela já foi QUITADA anteriormente
        if (freshInstallment.status === 'PAID') {
          // Se foi baixa manual interna (receiveInCash) notificada pelo Asaas
          if (paymentData.billingType === 'RECEIVED_IN_CASH') {
            await tx.asaasCharge.update({
              where: { id: freshCharge.id },
              data: {
                status: eventName === 'PAYMENT_RECEIVED' ? 'RECEIVED' : 'CONFIRMED',
                settledAt: eventName === 'PAYMENT_RECEIVED' ? new Date() : freshCharge.settledAt,
                netValueCents,
                feeCents,
              },
            });
            return;
          }

          // Verificar se este externalPaymentId já foi gravado
          const existingPaymentForCharge = await tx.creditPayment.findFirst({
            where: { externalPaymentId },
          });

          if (existingPaymentForCharge) {
            if (eventName === 'PAYMENT_RECEIVED' && !existingPaymentForCharge.isAsaasSettled) {
              await tx.creditPayment.update({
                where: { id: existingPaymentForCharge.id },
                data: { isAsaasSettled: true, settledAt: new Date() },
              });
              await tx.asaasCharge.update({
                where: { id: freshCharge.id },
                data: { status: 'RECEIVED', settledAt: new Date(), netValueCents, feeCents },
              });
            }
            return;
          }

          // Parcela foi paga por outro meio e agora entra pagamento bancário real -> DUPLICIDADE
          const existingAlert = await tx.asaasDuplicatePaymentAlert.findFirst({
            where: { externalPaymentId },
          });
          if (!existingAlert) {
            await tx.asaasDuplicatePaymentAlert.create({
              data: {
                companyId: asaasConfig.companyId,
                agreementId: freshAgreement.id,
                installmentId: freshInstallment.id,
                externalPaymentId,
                amountCents: nominalValueCents,
                reason: 'Pagamento bancário recebido via Asaas após parcela já ter sido quitada no sistema.',
              },
            });
          }
          return;
        }

        // B. Se a cobrança já foi confirmada anteriormente no Asaas e agora chega PAYMENT_RECEIVED:
        // Apenas atualiza a liquidação do saldo (settledAt) sem duplicar pagamento nem comissão
        if (freshCharge.status === 'CONFIRMED' && eventName === 'PAYMENT_RECEIVED') {
          await tx.asaasCharge.update({
            where: { id: freshCharge.id },
            data: {
              status: 'RECEIVED',
              settledAt: new Date(),
              netValueCents,
              feeCents,
            },
          });
          await tx.creditPayment.updateMany({
            where: { externalPaymentId },
            data: { isAsaasSettled: true, settledAt: new Date() },
          });
          return;
        }

        // C. Se a cobrança já estiver RECEIVED e chega PAYMENT_CONFIRMED fora de ordem: no-op
        if (freshCharge.status === 'RECEIVED' && eventName === 'PAYMENT_CONFIRMED') {
          return;
        }

        // D. Parcela PENDING / PARTIALLY_PAID / OVERDUE -> Realizar baixa legítima
        // Deduplicação de CreditPayment por externalPaymentId
        const existingPayment = await tx.creditPayment.findFirst({
          where: { externalPaymentId },
        });

        if (existingPayment) {
          if (eventName === 'PAYMENT_RECEIVED' && !existingPayment.isAsaasSettled) {
            await tx.creditPayment.update({
              where: { id: existingPayment.id },
              data: { isAsaasSettled: true, settledAt: new Date() },
            });
            await tx.asaasCharge.update({
              where: { id: freshCharge.id },
              data: { status: 'RECEIVED', settledAt: new Date(), netValueCents, feeCents },
            });
          }
          return;
        }

        const creditPayment = await tx.creditPayment.create({
          data: {
            agreementId: freshAgreement.id,
            companyId: asaasConfig.companyId,
            amountCents: nominalValueCents,
            paymentMethod: paymentData.billingType || 'BOLETO',
            receivedByRole: 'BANK',
            receiverUserId: freshAgreement.sellerId,
            destination: 'COMPANY_ACCOUNT',
            bankFeeCents: feeCents,
            externalPaymentId,
            isAsaasSettled: eventName === 'PAYMENT_RECEIVED',
            settledAt: eventName === 'PAYMENT_RECEIVED' ? new Date() : null,
            notes: `Recebimento via Asaas (${paymentData.billingType || 'BOLETO'}). Tarifa bancária: R$ ${(feeCents / 100).toFixed(2)}`,
          },
        });

        const newPaidCents = freshInstallment.paidCents + nominalValueCents;
        const isFullyPaid = newPaidCents >= freshInstallment.amountCents;

        await tx.creditPaymentAllocation.create({
          data: {
            paymentId: creditPayment.id,
            installmentId: freshInstallment.id,
            allocatedCents: nominalValueCents,
          },
        });

        await tx.creditInstallment.update({
          where: { id: freshInstallment.id },
          data: {
            paidCents: newPaidCents,
            status: isFullyPaid ? 'PAID' : 'PARTIALLY_PAID',
            paidAt: isFullyPaid ? new Date() : undefined,
          },
        });

        // Abatimento estrito do valor NOMINAL sobre o saldo relido dentro da trava
        const newRemainingCents = Math.max(0, freshAgreement.remainingPrincipalCents - nominalValueCents);
        const newPaidPrincipalCents = freshAgreement.paidPrincipalCents + nominalValueCents;

        await tx.creditAgreement.update({
          where: { id: freshAgreement.id },
          data: {
            remainingPrincipalCents: newRemainingCents,
            paidPrincipalCents: newPaidPrincipalCents,
            status: newRemainingCents <= 0 ? 'SETTLED' : freshAgreement.status,
          },
        });

        // Comissão sobre o principal nominal
        const commissionCents = Math.round(nominalValueCents * freshAgreement.installmentCommissionRate);
        if (commissionCents > 0) {
          await tx.creditCommission.create({
            data: {
              agreementId: freshAgreement.id,
              paymentId: creditPayment.id,
              sellerId: freshAgreement.sellerId,
              companyId: asaasConfig.companyId,
              amountCents: commissionCents,
              status: 'RELEASED',
              type: 'INSTALLMENT',
            },
          });
        }

        await tx.asaasCharge.update({
          where: { id: freshCharge.id },
          data: {
            status: eventName === 'PAYMENT_RECEIVED' ? 'RECEIVED' : 'CONFIRMED',
            nominalValueCents,
            netValueCents,
            feeCents,
            paymentDate: new Date(),
            clientPaymentDate: paymentData.clientPaymentDate ? new Date(paymentData.clientPaymentDate) : new Date(),
            settledAt: eventName === 'PAYMENT_RECEIVED' ? new Date() : null,
          },
        });
      });
    }

    // =========================================================================
    // EVENTO: PAYMENT_REFUNDED (Estorno bancário / Chargeback)
    // =========================================================================
    else if (eventName === 'PAYMENT_REFUNDED') {
      // 1. Verificar se há alerta de duplicidade em estorno
      const alert = await prisma.asaasDuplicatePaymentAlert.findFirst({
        where: { externalPaymentId, companyId: asaasConfig.companyId },
      });
      if (alert) {
        await prisma.asaasDuplicatePaymentAlert.update({
          where: { id: alert.id },
          data: {
            status: 'REFUNDED',
            resolvedAt: new Date(),
            notes: 'Devolução confirmada via webhook Asaas (PAYMENT_REFUNDED).',
          },
        });
      }

      // 2. Verificar se há pagamento efetivo estornado
      const payment = await prisma.creditPayment.findFirst({
        where: { externalPaymentId, companyId: asaasConfig.companyId, isReversed: false },
        include: { commissions: true },
      });

      if (payment) {
        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "CreditAgreement" WHERE id = ${payment.agreementId} FOR UPDATE`;

          const allocs = await tx.creditPaymentAllocation.findMany({ where: { paymentId: payment.id } });
          for (const a of allocs) {
            await tx.creditInstallment.update({
              where: { id: a.installmentId },
              data: { paidCents: 0, status: 'PENDING', paidAt: null },
            });
          }

          await tx.creditAgreement.update({
            where: { id: payment.agreementId },
            data: {
              remainingPrincipalCents: { increment: payment.amountCents },
              paidPrincipalCents: { decrement: payment.amountCents },
              status: 'ACTIVE',
            },
          });

          for (const c of payment.commissions) {
            if (c.status === 'PAID') {
              await tx.creditCommissionAdjustment.create({
                data: {
                  companyId: asaasConfig.companyId,
                  sellerId: c.sellerId,
                  agreementId: payment.agreementId,
                  paymentId: payment.id,
                  commissionId: c.id,
                  amountCents: c.amountCents,
                  reason: 'Estorno bancário (PAYMENT_REFUNDED no Asaas).',
                  status: 'PENDING',
                },
              });
            } else {
              await tx.creditCommission.update({
                where: { id: c.id },
                data: { isReversed: true, status: 'REVERSED', reversalReason: 'PAYMENT_REFUNDED no Asaas' },
              });
            }
          }

          await tx.creditPayment.update({
            where: { id: payment.id },
            data: { isReversed: true, reversedAt: new Date(), reversalReason: 'Estorno bancário Asaas' },
          });

          if (charge) {
            await tx.asaasCharge.update({
              where: { id: charge.id },
              data: { status: 'REFUNDED' },
            });
          }
        });
      }
    }

    if (savedEventId) {
      await prisma.asaasWebhookEvent.update({
        where: { id: savedEventId },
        data: { processed: true, processedAt: new Date() },
      });
    }

    return res.status(200).json({ received: true, processed: true });
  } catch (procErr: any) {
    console.error('[Asaas Webhook] Erro no processamento do evento:', procErr);
    if (savedEventId) {
      await prisma.asaasWebhookEvent.update({
        where: { id: savedEventId },
        data: { processingError: procErr.message || String(procErr) },
      });
    }
    return res.status(500).json({ error: procErr.message || 'Erro interno no processamento do webhook' });
  }
});

export default router;
