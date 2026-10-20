import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest, requireAdminOrSupervisor } from '../middleware/authMiddleware';
import { calculateCreditSchedule, validateCpf } from '../services/creditService';

const router = Router();
const prisma = new PrismaClient();

const SALE_MANAGER_ROLES = ['COMPANY_ADMIN', 'ADMIN', 'SUPERVISOR', 'SELLER_MANAGER', 'SUPER_ADMIN'];

/**
 * GET /api/credit/overview
 * Visão consolidada para o Painel Administrativo de Crediário e Cobranças
 */
router.get('/overview', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }

    const { sellerId, startDate, endDate } = req.query as {
      sellerId?: string;
      startDate?: string;
      endDate?: string;
    };

    const whereAgreement: any = {
      ...(companyId ? { companyId } : {}),
      ...(sellerId ? { sellerId } : {}),
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
            status: { in: ['PENDING', 'PARTIALLY_PAID'] },
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
    if (sellerId) {
      wherePayments.agreement = { sellerId };
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
      ...(sellerId ? { sellerId } : {}),
    };
    const releasedCommissions = await prisma.creditCommission.findMany({
      where: whereCommissions,
      select: { amountCents: true },
    });
    const pendingCommissionCents = releasedCommissions.reduce((sum, c) => sum + c.amountCents, 0);

    // 5. Inadimplência calculada com fórmula explícita
    // Taxa = (Principal Vencido / Total de Principal Financiado Vencível até o momento) * 100
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
 * GET /api/credit/agreements
 * Listagem de contratos com paginação e busca
 */
router.get('/agreements', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }

    const isSeller = ['SELLER', 'PHOTOGRAPHER', 'OPERATOR'].includes(req.user?.role || '');
    const { search, status, sellerId } = req.query as {
      search?: string;
      status?: string;
      sellerId?: string;
    };

    const targetSellerId = isSeller ? req.user?.id : (sellerId || undefined);

    const where: any = {
      ...(companyId ? { companyId } : {}),
      ...(targetSellerId ? { sellerId: targetSellerId } : {}),
    };

    if (status && status !== 'ALL') {
      where.status = status;
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
      // Calcular próxima parcela pendente
      const pendingInstallments = a.installments.filter((i) => i.status !== 'PAID');
      const nextPending = pendingInstallments[0] || null;

      // Calcular quantas parcelas estão vencidas
      const overdueInstallments = pendingInstallments.filter((i) => new Date(i.dueDate) < now);
      const overdueCount = overdueInstallments.length;

      // Dias de atraso do vencimento mais antigo em aberto
      let daysOverdue = 0;
      if (overdueCount > 0) {
        const oldestOverdueDate = new Date(overdueInstallments[0].dueDate);
        daysOverdue = Math.max(0, Math.floor((now.getTime() - oldestOverdueDate.getTime()) / (1000 * 60 * 60 * 24)));
      }

      // Dias restantes para o próximo vencimento
      let daysUntilNext = 0;
      if (nextPending) {
        daysUntilNext = Math.ceil((new Date(nextPending.dueDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      }

      return {
        id: a.id,
        saleId: a.saleId,
        clientId: a.clientId,
        client: a.client,
        seller: a.seller,
        buyerName: a.buyerName,
        buyerCpf: a.buyerCpf,
        city: a.city,
        totalSale: Number((a.totalSaleCents / 100).toFixed(2)),
        downPayment: Number((a.downPaymentCents / 100).toFixed(2)),
        financedPrincipal: Number((a.financedPrincipalCents / 100).toFixed(2)),
        remainingPrincipal: Number((a.remainingPrincipalCents / 100).toFixed(2)),
        paidPrincipal: Number((a.paidPrincipalCents / 100).toFixed(2)),
        installmentsCount: a.installmentsCount,
        periodicity: a.periodicity,
        status: a.status,
        signedAgreementUrl: a.signedAgreementUrl,
        nextDueDate: nextPending?.dueDate || null,
        nextInstallmentAmount: nextPending ? Number((nextPending.amountCents / 100).toFixed(2)) : 0,
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
          isOverdue: inst.status !== 'PAID' && new Date(inst.dueDate) < now,
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
 * Detalhes de um contrato específico
 */
router.get('/agreements/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const companyId = req.user?.companyId;

    const agreement = await prisma.creditAgreement.findFirst({
      where: {
        id,
        ...(companyId ? { companyId } : {}),
      },
      include: {
        client: true,
        seller: { select: { id: true, name: true, phone: true } },
        installments: { orderBy: { installmentNumber: 'asc' } },
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
        renegotiations: {
          orderBy: { createdAt: 'desc' },
          include: { author: { select: { id: true, name: true } } },
        },
      },
    });

    if (!agreement) {
      res.status(404).json({ error: 'Contrato de crediário não encontrado' });
      return;
    }

    res.json(agreement);
  } catch (error: any) {
    console.error('Error getting credit agreement details:', error);
    res.status(500).json({ error: error.message || 'Erro ao buscar detalhes do contrato' });
  }
});

/**
 * POST /api/credit/agreements/:id/payments
 * Registrar recebimento / baixa parcial ou total do principal financiado
 */
router.post('/agreements/:id/payments', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const companyId = req.user?.companyId;
    const currentUserId = req.user?.id;
    const currentUserRole = req.user?.role || 'SELLER';

    if (!companyId || !currentUserId) {
      res.status(401).json({ error: 'Usuário ou empresa não identificado' });
      return;
    }

    const {
      amount,
      paymentMethod = 'CASH',
      destination = 'SELLER_HANDS',
      receiptUrl,
      notes,
    } = req.body;

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      res.status(400).json({ error: 'Valor de pagamento inválido. Deve ser maior que zero' });
      return;
    }

    const paymentAmountCents = Math.round(parsedAmount * 100);

    const result = await prisma.$transaction(async (tx) => {
      // 1. Localizar contrato com trava
      const agreement = await tx.creditAgreement.findFirst({
        where: { id, companyId },
        include: {
          installments: {
            where: { status: { in: ['PENDING', 'PARTIALLY_PAID'] } },
            orderBy: { installmentNumber: 'asc' },
          },
        },
      });

      if (!agreement) {
        throw { status: 404, message: 'Contrato de crediário não encontrado' };
      }

      if (agreement.status === 'SETTLED' || agreement.remainingPrincipalCents <= 0) {
        throw { status: 400, message: 'Este contrato de crediário já está totalmente quitado' };
      }

      if (paymentAmountCents > agreement.remainingPrincipalCents) {
        const maxAllowed = (agreement.remainingPrincipalCents / 100).toFixed(2);
        throw {
          status: 400,
          message: `O valor do pagamento (R$ ${parsedAmount.toFixed(2)}) supera o saldo devedor em aberto (R$ ${maxAllowed}). Pagamento acima do saldo não permitido.`,
        };
      }

      // 2. Alocar o valor nas parcelas abertas em ordem cronológica (FIFO)
      let unallocatedCents = paymentAmountCents;
      const allocationsToCreate: Array<{ installmentId: string; allocatedCents: number }> = [];

      for (const inst of agreement.installments) {
        if (unallocatedCents <= 0) break;

        const unpaidOnInst = inst.amountCents - inst.paidCents;
        const toAllocate = Math.min(unallocatedCents, unpaidOnInst);

        const newPaidCents = inst.paidCents + toAllocate;
        const newStatus = newPaidCents >= inst.amountCents ? 'PAID' : 'PARTIALLY_PAID';

        await tx.creditInstallment.update({
          where: { id: inst.id },
          data: {
            paidCents: newPaidCents,
            status: newStatus,
            paidAt: newStatus === 'PAID' ? new Date() : inst.paidAt,
          },
        });

        allocationsToCreate.push({
          installmentId: inst.id,
          allocatedCents: toAllocate,
        });

        unallocatedCents -= toAllocate;
      }

      // 3. Criar registro de recebimento
      const payment = await tx.creditPayment.create({
        data: {
          agreementId: agreement.id,
          companyId,
          amountCents: paymentAmountCents,
          paymentMethod: String(paymentMethod).trim().toUpperCase(),
          receivedByRole: currentUserRole === 'SELLER' ? 'SELLER' : 'ADMIN',
          receiverUserId: currentUserId,
          destination: String(destination).trim(),
          paidAt: new Date(),
          receiptUrl: receiptUrl ? String(receiptUrl).trim() : null,
          notes: notes ? String(notes).trim() : null,
          allocations: {
            create: allocationsToCreate.map((a) => ({
              installmentId: a.installmentId,
              allocatedCents: a.allocatedCents,
            })),
          },
        },
      });

      // 4. Atualizar saldo do contrato
      const newRemainingCents = agreement.remainingPrincipalCents - paymentAmountCents;
      const newPaidPrincipalCents = agreement.paidPrincipalCents + paymentAmountCents;
      const isNowSettled = newRemainingCents === 0;

      await tx.creditAgreement.update({
        where: { id: agreement.id },
        data: {
          remainingPrincipalCents: newRemainingCents,
          paidPrincipalCents: newPaidPrincipalCents,
          status: isNowSettled ? 'SETTLED' : agreement.status,
        },
      });

      // Se quitou tudo, atualiza a Sale para PAID
      if (isNowSettled) {
        await tx.sale.update({
          where: { id: agreement.saleId },
          data: { paymentStatus: 'PAID' },
        });
      }

      // 5. Liberar comissão de 10% sobre o recebimento do principal para o vendedor do acordo
      // R$ 40 recebidos de R$ 100 liberam R$ 4. R$ 100 recebidos liberam R$ 10.
      const commissionCents = Math.round(paymentAmountCents * agreement.installmentCommissionRate);

      let commission = null;
      if (commissionCents > 0) {
        commission = await tx.creditCommission.create({
          data: {
            agreementId: agreement.id,
            paymentId: payment.id,
            sellerId: agreement.sellerId, // Pertence ao vendedor original registrado na venda
            companyId,
            amountCents: commissionCents,
            status: 'RELEASED',
            type: 'INSTALLMENT',
          },
        });
      }

      // 6. Linha do tempo na ficha
      await tx.clientTimeline.create({
        data: {
          clientId: agreement.clientId,
          cycle: 1,
          newStatus: isNowSettled ? 'SOLD_SETTLED' : 'SOLD_CREDIT_PAYMENT',
          authorId: currentUserId,
          authorRole: currentUserRole,
          action: 'CREDIT_PAYMENT',
          reason: `Recebimento de R$ ${parsedAmount.toFixed(2)} (${paymentMethod}) registrado no crediário. Saldo restante: R$ ${(newRemainingCents / 100).toFixed(2)}`,
        },
      });

      return { payment, commission, remainingPrincipal: (newRemainingCents / 100), remainingPrincipalCents: newRemainingCents };
    });

    res.status(201).json(result);
  } catch (error: any) {
    if (error?.status && error?.message) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error('Error registering credit payment:', error);
    res.status(500).json({ error: 'Erro ao registrar pagamento no crediário' });
  }
});

/**
 * POST /api/credit/payments/:paymentId/reverse
 * Estorno auditável de recebimento (Admin ou Supervisor)
 */
router.post('/payments/:paymentId/reverse', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const paymentId = req.params.paymentId as string;
    const companyId = req.user?.companyId;
    const currentUserId = req.user?.id;
    const { reason } = req.body;

    if (!companyId) {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }
    if (!currentUserId) {
      res.status(401).json({ error: 'Usuário não identificado' });
      return;
    }

    if (!reason || !String(reason).trim()) {
      res.status(400).json({ error: 'Motivo do estorno é obrigatório' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.creditPayment.findFirst({
        where: { id: paymentId, companyId },
        include: {
          allocations: true,
          commissions: true,
          agreement: true,
        },
      });

      if (!payment) {
        throw { status: 404, message: 'Recebimento não encontrado na sua empresa' };
      }

      if (payment.isReversed) {
        throw { status: 400, message: 'Este recebimento já foi estornado anteriormente' };
      }

      const now = new Date();

      // 1. Marcar pagamento como estornado
      await tx.creditPayment.update({
        where: { id: payment.id },
        data: {
          isReversed: true,
          reversedAt: now,
          reversedByUserId: currentUserId,
          reversalReason: String(reason).trim(),
        },
      });

      // 2. Reverter os valores alocados nas parcelas
      for (const alloc of payment.allocations) {
        const inst = await tx.creditInstallment.findUnique({
          where: { id: alloc.installmentId },
        });

        if (inst) {
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
      }

      // 3. Reabrir o saldo no contrato
      const newRemainingCents = payment.agreement.remainingPrincipalCents + payment.amountCents;
      const newPaidPrincipalCents = Math.max(0, payment.agreement.paidPrincipalCents - payment.amountCents);

      await tx.creditAgreement.update({
        where: { id: payment.agreement.id },
        data: {
          remainingPrincipalCents: newRemainingCents,
          paidPrincipalCents: newPaidPrincipalCents,
          status: 'ACTIVE',
        },
      });

      // Se a Sale estava marcada como PAID por causa da quitação anterior, volta para PARTIALLY_PAID
      await tx.sale.update({
        where: { id: payment.agreement.saleId },
        data: { paymentStatus: 'PARTIALLY_PAID' },
      });

      // 4. Estornar as comissões vinculadas a este pagamento
      for (const comm of payment.commissions) {
        await tx.creditCommission.update({
          where: { id: comm.id },
          data: {
            isReversed: true,
            reversedAt: now,
            status: 'REVERSED',
            reversalReason: `Estorno do recebimento: ${reason}`,
          },
        });
      }

      // 5. Linha do tempo na ficha
      await tx.clientTimeline.create({
        data: {
          clientId: payment.agreement.clientId,
          cycle: 1,
          newStatus: 'SOLD_CREDIT_REVERSED',
          authorId: currentUserId,
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
 * Renegociar saldo em aberto substituindo parcelas futuras sem duplicar venda ou comissão
 */
router.post('/agreements/:id/renegotiate', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const companyId = req.user?.companyId;
    const authorId = req.user?.id;

    if (!companyId || !authorId) {
      res.status(401).json({ error: 'Usuário ou empresa não identificado' });
      return;
    }

    const {
      installmentsCount,
      periodicity = 'MONTHLY',
      firstDueDate,
      reason,
    } = req.body;

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
      const agreement = await tx.creditAgreement.findFirst({
        where: { id, companyId },
        include: {
          installments: { orderBy: { installmentNumber: 'asc' } },
        },
      });

      if (!agreement) {
        throw { status: 404, message: 'Contrato de crediário não encontrado' };
      }

      if (agreement.status === 'SETTLED' || agreement.remainingPrincipalCents <= 0) {
        throw { status: 400, message: 'Contrato já quitado não permite renegociação' };
      }

      const previousSchedule = agreement.installments;

      // Deletar apenas parcelas PENDING não pagas (preservar histórico das já quitadas/parciais)
      // Para as parcelas pendentes com paidCents > 0, manter e renegociar apenas o saldo remanescente
      const unpaidInstallments = agreement.installments.filter((i) => i.paidCents === 0 && i.status === 'PENDING');
      await tx.creditInstallment.deleteMany({
        where: { id: { in: unpaidInstallments.map((i) => i.id) } },
      });

      // Calcular novo cronograma para o saldo remanescente exato
      const newScheduleItems = calculateCreditSchedule({
        totalSaleCents: agreement.remainingPrincipalCents,
        downPaymentCents: 0,
        installmentsCount: parsedCount,
        periodicity,
        firstDueDate: new Date(firstDueDate || Date.now() + 30 * 24 * 3600 * 1000),
      });

      // Iniciar a numeração das novas parcelas a partir da última parcela preservada
      const preservedCount = agreement.installments.filter((i) => i.paidCents > 0 || i.status === 'PAID').length;

      const createdInstallments = [];
      for (let i = 0; i < newScheduleItems.length; i++) {
        const item = newScheduleItems[i];
        const inst = await tx.creditInstallment.create({
          data: {
            agreementId: agreement.id,
            installmentNumber: preservedCount + i + 1,
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
          installmentsCount: preservedCount + parsedCount,
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
        },
      });

      return {
        success: true,
        remainingPrincipalCents: agreement.remainingPrincipalCents,
        newInstallments: createdInstallments,
      };
    });

    res.json(result);
  } catch (error: any) {
    if (error?.status && error?.message) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error('Error renegotiating credit agreement:', error);
    res.status(500).json({ error: 'Erro ao renegociar contrato' });
  }
});

/**
 * POST /api/credit/commissions/pay
 * Liquidar comissões de crediário para um vendedor (Admin)
 */
router.post('/commissions/pay', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const adminId = req.user?.id;
    const { commissionIds, sellerId } = req.body;

    if (!companyId || !adminId) {
      res.status(401).json({ error: 'Usuário ou empresa não identificado' });
      return;
    }

    if (!Array.isArray(commissionIds) || commissionIds.length === 0) {
      res.status(400).json({ error: 'Selecione ao menos uma comissão para liquidar' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const commissions = await tx.creditCommission.findMany({
        where: {
          id: { in: commissionIds },
          companyId,
          status: 'RELEASED',
          isReversed: false,
          ...(sellerId ? { sellerId } : {}),
        },
      });

      if (commissions.length === 0) {
        throw { status: 400, message: 'Nenhuma comissão elegível encontrada para liquidação' };
      }

      const now = new Date();
      const totalAmountCents = commissions.reduce((sum, c) => sum + c.amountCents, 0);

      // 1. Criar saída no financeiro (Cost) para evitar duplicação ou saída oculta
      const cost = await tx.cost.create({
        data: {
          companyId,
          userId: sellerId || commissions[0].sellerId,
          amount: Number((totalAmountCents / 100).toFixed(2)),
          category: 'COMMISSION',
          description: `Liquidação de ${commissions.length} comissões de crediário`,
          date: now,
          paymentMethod: 'PIX',
          status: 'APPROVED',
        },
      });

      // 2. Atualizar as comissões para PAID vinculando ao costId
      await tx.creditCommission.updateMany({
        where: { id: { in: commissions.map((c) => c.id) } },
        data: {
          status: 'PAID',
          paidAt: now,
          paidByUserId: adminId,
          costId: cost.id,
        },
      });

      return {
        liquidatedCount: commissions.length,
        totalPaid: Number((totalAmountCents / 100).toFixed(2)),
        costId: cost.id,
      };
    });

    res.json(result);
  } catch (error: any) {
    if (error?.status && error?.message) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error('Error paying credit commissions:', error);
    res.status(500).json({ error: 'Erro ao liquidar comissões de crediário' });
  }
});

/**
 * GET /api/credit/seller/my-portfolio
 * Carteira do próprio vendedor logado
 */
router.get('/seller/my-portfolio', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const sellerId = req.user?.id;
    const companyId = req.user?.companyId;

    if (!sellerId || !companyId) {
      res.status(401).json({ error: 'Vendedor não autenticado' });
      return;
    }

    const agreements = await prisma.creditAgreement.findMany({
      where: { sellerId, companyId },
      include: {
        client: {
          select: {
            id: true,
            name: true,
            sequenceNumber: true,
            visibleCode: true,
            city: true,
            phone1: true,
          },
        },
        installments: {
          orderBy: { installmentNumber: 'asc' },
        },
        commissions: {
          where: { sellerId },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    let totalPendingCommissionCents = 0;
    let totalPaidCommissionCents = 0;

    for (const a of agreements) {
      for (const comm of a.commissions) {
        if (!comm.isReversed) {
          if (comm.status === 'RELEASED') {
            totalPendingCommissionCents += comm.amountCents;
          } else if (comm.status === 'PAID') {
            totalPaidCommissionCents += comm.amountCents;
          }
        }
      }
    }

    res.json({
      agreementsCount: agreements.length,
      totalPendingCommissions: Number((totalPendingCommissionCents / 100).toFixed(2)),
      totalPaidCommissions: Number((totalPaidCommissionCents / 100).toFixed(2)),
      agreements,
    });
  } catch (error: any) {
    console.error('Error fetching seller credit portfolio:', error);
    res.status(500).json({ error: error.message || 'Erro ao carregar carteira de crediário do vendedor' });
  }
});

export default router;
