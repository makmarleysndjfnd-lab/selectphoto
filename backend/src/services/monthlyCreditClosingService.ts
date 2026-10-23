import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

export interface CompetenceRange {
  competence: string;
  startDate: Date;
  endDate: Date;
}

/**
 * Retorna os limites temporais estritos de uma competência "YYYY-MM" no fuso America/Sao_Paulo (UTC-3).
 * Início: dia 01 às 00:00:00.000 BRT (inclusive) = 03:00:00.000 UTC
 * Fim: dia 01 do mês subsequente às 00:00:00.000 BRT (exclusive) = 03:00:00.000 UTC
 * Lida perfeitamente com meses de 31 dias, 30 dias, fevereiro bissexto (29 dias) e não bissexto (28 dias).
 */
export function getCompetenceRange(competence: string): CompetenceRange {
  const match = String(competence).trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    throw new Error(`Formato de competência inválido: "${competence}". Esperado YYYY-MM.`);
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10); // 1 a 12

  if (month < 1 || month > 12) {
    throw new Error(`Mês inválido na competência: ${month}. Esperado entre 01 e 12.`);
  }

  // Fuso horário operacional America/Sao_Paulo (UTC-3 fixo sem horário de verão)
  const BRT_OFFSET_HOURS = 3;

  // Início: dia 1 do mês às 00:00:00 BRT
  const startDate = new Date(Date.UTC(year, month - 1, 1, BRT_OFFSET_HOURS, 0, 0, 0));

  // Fim exclusivo: dia 1 do mês seguinte às 00:00:00 BRT
  const endDate = new Date(Date.UTC(year, month, 1, BRT_OFFSET_HOURS, 0, 0, 0));

  return { competence, startDate, endDate };
}

/**
 * Converte uma data qualquer para a string de competência correspondente no fuso America/Sao_Paulo.
 */
export function getCompetenceForDate(date: Date): string {
  // Converte para string no fuso de São Paulo
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  });
  return formatter.format(date); // Ex: "2026-10"
}

/**
 * Verifica se a competência já encerrou (now >= endDate).
 */
export function isCompetenceEnded(competence: string, now: Date = new Date()): boolean {
  const { endDate } = getCompetenceRange(competence);
  return now.getTime() >= endDate.getTime();
}

/**
 * Retorna a competência do mês corrente e a última competência encerrada.
 */
export function getRelevantCompetences(now: Date = new Date()): { currentOpen: string; lastClosed: string } {
  const currentOpen = getCompetenceForDate(now);
  const match = currentOpen.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return { currentOpen: '2026-10', lastClosed: '2026-09' };
  }
  let year = parseInt(match[1], 10);
  let month = parseInt(match[2], 10) - 1;
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  const lastClosed = `${year}-${String(month).padStart(2, '0')}`;
  return { currentOpen, lastClosed };
}

/**
 * Calcula a apuração de comissão mensal dos 10% de parcelas posteriores de um vendedor.
 */
export async function calculateSellerMonthlyCreditClosing(params: {
  companyId: string;
  sellerId: string;
  competence: string;
  tx?: Prisma.TransactionClient;
}) {
  const { companyId, sellerId, competence } = params;
  const db = params.tx || prisma;
  const { startDate, endDate } = getCompetenceRange(competence);

  // 1. Buscar comissões de parcelas posteriores recebidas nessa competência que ainda não foram liquidadas
  const commissions = await db.creditCommission.findMany({
    where: {
      companyId,
      sellerId,
      type: 'INSTALLMENT',
      isReversed: false,
      status: 'RELEASED',
      monthlyClosingId: null,
      paidAt: null,
      payment: {
        paidAt: {
          gte: startDate,
          lt: endDate,
        },
        isReversed: false,
      },
    },
    include: {
      payment: {
        include: {
          agreement: {
            select: {
              id: true,
              buyerName: true,
              product: true,
              installmentCommissionRate: true,
              client: { select: { id: true, name: true, sequenceNumber: true } },
            },
          },
          allocations: {
            include: {
              installment: { select: { installmentNumber: true, dueDate: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  // 2. Buscar ajustes pendentes (ex: estornos de competências passadas)
  const adjustments = await db.creditCommissionAdjustment.findMany({
    where: {
      companyId,
      sellerId,
      status: 'PENDING',
      monthlyClosingId: null,
      createdAt: {
        lt: endDate,
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const totalPrincipalReceivedCents = commissions.reduce((sum, c) => sum + (c.payment?.amountCents || 0), 0);
  const totalCommissionCents = commissions.reduce((sum, c) => sum + c.amountCents, 0);
  const rawAdjustmentsCents = adjustments.reduce((sum, a) => {
    const val = a.amountCents > 0 ? -a.amountCents : a.amountCents;
    return sum + val;
  }, 0);

  let appliedAdjustmentsCents = rawAdjustmentsCents;
  let unabsorbedDebtCents = 0;
  let netCommissionCents = totalCommissionCents + rawAdjustmentsCents;

  if (netCommissionCents < 0) {
    unabsorbedDebtCents = Math.abs(netCommissionCents);
    appliedAdjustmentsCents = -totalCommissionCents; // absorve apenas até zerar a comissão do mês
    netCommissionCents = 0;
  }

  return {
    competence,
    startDate,
    endDate,
    totalPrincipalReceivedCents,
    totalPrincipalReceived: Number((totalPrincipalReceivedCents / 100).toFixed(2)),
    totalCommissionCents,
    totalCommission: Number((totalCommissionCents / 100).toFixed(2)),
    rawAdjustmentsCents,
    appliedAdjustmentsCents,
    unabsorbedDebtCents,
    adjustmentsCents: appliedAdjustmentsCents,
    adjustmentsAmount: Number((appliedAdjustmentsCents / 100).toFixed(2)),
    netCommissionCents,
    netCommission: Number((netCommissionCents / 100).toFixed(2)),
    itemsCount: commissions.length,
    commissions,
    adjustments,
  };
}

/**
 * Fecha formalmente e persiste a competência mensal de um vendedor.
 * Idempotente: se já estiver fechada, retorna a existente sem duplicar.
 * Protegido: rejeita fechar mês aberto ou futuro.
 */
export async function processMonthlyCreditClosing(params: {
  companyId: string;
  sellerId: string;
  competence: string;
  closedByUserId?: string;
  notes?: string;
}) {
  const { companyId, sellerId, competence, closedByUserId, notes } = params;

  if (!isCompetenceEnded(competence)) {
    throw {
      status: 400,
      code: 'COMPETENCE_NOT_ENDED',
      message: `A competência ${competence} ainda está aberta ou é futura. O fechamento mensal só é permitido após o término do último dia do mês.`,
    };
  }

  const { startDate, endDate } = getCompetenceRange(competence);

  try {
    return await prisma.$transaction(async (tx) => {
      // 1. Verificar se já existe fechamento
      const existing = await tx.monthlyCreditClosing.findUnique({
        where: {
          companyId_sellerId_competence: {
            companyId,
            sellerId,
            competence,
          },
        },
        include: {
          payouts: true,
          commissions: {
            include: {
              payment: {
                include: {
                  agreement: {
                    select: {
                      id: true,
                      buyerName: true,
                      client: { select: { name: true, sequenceNumber: true } },
                    },
                  },
                },
              },
            },
          },
          adjustments: true,
        },
      });

      if (existing) {
        return { closing: existing, created: false };
      }

      // 2. Apurar valores
      const calculation = await calculateSellerMonthlyCreditClosing({
        companyId,
        sellerId,
        competence,
        tx,
      });

      // 3. Persistir o fechamento
      const closing = await tx.monthlyCreditClosing.create({
        data: {
          companyId,
          sellerId,
          competence,
          status: calculation.netCommissionCents === 0 ? 'PAID' : 'CLOSED',
          startDate,
          endDate,
          totalPrincipalReceivedCents: calculation.totalPrincipalReceivedCents,
          totalCommissionCents: calculation.totalCommissionCents,
          adjustmentsCents: calculation.adjustmentsCents,
          netCommissionCents: calculation.netCommissionCents,
          paidAmountCents: 0,
          remainingBalanceCents: calculation.netCommissionCents,
          itemsCount: calculation.itemsCount,
          closedByUserId: closedByUserId || null,
          notes: notes || (calculation.unabsorbedDebtCents > 0 ? `Débito residual de R$ ${(calculation.unabsorbedDebtCents / 100).toFixed(2)} transportado para o próximo ciclo` : null),
        },
      });

      // 4. Vincular as comissões apuradas ao fechamento persistido
      if (calculation.commissions.length > 0) {
        const commissionIds = calculation.commissions.map((c) => c.id);
        await tx.creditCommission.updateMany({
          where: { id: { in: commissionIds } },
          data: { monthlyClosingId: closing.id },
        });
      }

      // 5. Vincular e marcar ajustes aplicados
      if (calculation.adjustments.length > 0) {
        const adjustmentIds = calculation.adjustments.map((a) => a.id);
        await tx.creditCommissionAdjustment.updateMany({
          where: { id: { in: adjustmentIds } },
          data: {
            monthlyClosingId: closing.id,
            status: 'APPLIED',
            appliedAt: new Date(),
          },
        });

        // Se houver saldo devedor residual não compensado, cria um novo ajuste PENDING para o ciclo seguinte
        if (calculation.unabsorbedDebtCents > 0) {
          const firstAdj = calculation.adjustments[0];
          await tx.creditCommissionAdjustment.create({
            data: {
              companyId,
              sellerId,
              agreementId: firstAdj.agreementId,
              paymentId: firstAdj.paymentId,
              commissionId: firstAdj.commissionId,
              amountCents: -calculation.unabsorbedDebtCents,
              reason: `Saldo devedor residual não compensado na competência ${competence} (absorvido R$ ${(Math.abs(calculation.appliedAdjustmentsCents) / 100).toFixed(2)} de R$ ${(Math.abs(calculation.rawAdjustmentsCents) / 100).toFixed(2)})`,
              status: 'PENDING',
              idempotencyKey: `carryover_debt_${closing.id}`,
            },
          });
        }
      }

      const fullClosing = await tx.monthlyCreditClosing.findUnique({
        where: { id: closing.id },
        include: {
          payouts: true,
          commissions: {
            include: {
              payment: {
                include: {
                  agreement: {
                    select: {
                      id: true,
                      buyerName: true,
                      client: { select: { name: true, sequenceNumber: true } },
                    },
                  },
                },
              },
            },
          },
          adjustments: true,
        },
      });

      return { closing: fullClosing!, created: true };
    }, {
      maxWait: 10000,
      timeout: 20000,
    });
  } catch (err: any) {
    // Se outra transação concorrente criou o fechamento no mesmo instante:
    if (err.code === 'P2002' || err.code === 'P2034' || String(err.message).includes('conflict') || String(err.message).includes('deadlock')) {
      const existing = await prisma.monthlyCreditClosing.findUnique({
        where: {
          companyId_sellerId_competence: {
            companyId,
            sellerId,
            competence,
          },
        },
        include: {
          payouts: true,
          commissions: true,
          adjustments: true,
        },
      });
      if (existing) {
        return { closing: existing, created: false };
      }
    }
    throw err;
  }
}

/**
 * Reconcilia comissões legadas de crediário antes da apuração / catch-up:
 * - Se uma comissão do tipo INSTALLMENT já foi paga ou compensada historicamente (paidAt != null, costId != null, payoutId != null),
 *   garante que seu status esteja como 'PAID', evitando que seja incluída novamente como saldo a pagar.
 * - Se o pagamento associado foi estornado, garante que a comissão esteja como isReversed: true e status: 'REVERSED'.
 */
export async function reconcileLegacyInstallmentCommissions(companyId?: string) {
  const whereBase: any = {
    type: 'INSTALLMENT',
    ...(companyId ? { companyId } : {}),
  };

  // 1. Comissões com paidAt ou payoutId/costId que não estejam PAID
  const toMarkPaid = await prisma.creditCommission.findMany({
    where: {
      ...whereBase,
      status: { not: 'PAID' },
      OR: [
        { paidAt: { not: null } },
        { payoutId: { not: null } },
        { costId: { not: null } },
      ],
    },
    select: { id: true },
  });

  if (toMarkPaid.length > 0) {
    await prisma.creditCommission.updateMany({
      where: { id: { in: toMarkPaid.map((c) => c.id) } },
      data: { status: 'PAID' },
    });
  }

  // 2. Comissões cujo pagamento já foi estornado
  const reversedPayments = await prisma.creditPayment.findMany({
    where: {
      isReversed: true,
      ...(companyId ? { companyId } : {}),
    },
    select: { id: true },
  });

  if (reversedPayments.length > 0) {
    const paymentIds = reversedPayments.map((p) => p.id);
    await prisma.creditCommission.updateMany({
      where: {
        paymentId: { in: paymentIds },
        isReversed: false,
      },
      data: {
        isReversed: true,
        status: 'REVERSED',
        reversedAt: new Date(),
      },
    });
  }

  return { reconciledPaidCount: toMarkPaid.length };
}

/**
 * Processa lote de fechamentos mensais de todas as competências encerradas pendentes da empresa.
 * Usado pelo agendador automático (cron) e pelo botão de apuração do Admin.
 */
export async function recoverMissedMonthlyClosings(companyId?: string) {
  // Reconciliação prévia de comissões legadas para proteger histórico
  await reconcileLegacyInstallmentCommissions(companyId);

  const now = new Date();
  const { lastClosed } = getRelevantCompetences(now);

  const companies = await prisma.company.findMany({
    where: {
      ...(companyId ? { id: companyId } : {}),
      isActive: true,
    },
    select: { id: true },
  });

  const results: any[] = [];

  for (const comp of companies) {
    // Buscar todos os vendedores com contratos de crediário ou pagamentos
    const sellers = await prisma.user.findMany({
      where: {
        companyId: comp.id,
        role: 'SELLER',
      },
      select: { id: true, name: true },
    });

    for (const seller of sellers) {
      try {
        const res = await processMonthlyCreditClosing({
          companyId: comp.id,
          sellerId: seller.id,
          competence: lastClosed,
          notes: 'Apuração mensal de competência encerrada (automática/recuperação)',
        });
        if (res.created) {
          results.push({
            companyId: comp.id,
            sellerId: seller.id,
            sellerName: seller.name,
            competence: lastClosed,
            netCommissionCents: res.closing?.netCommissionCents,
          });
        }
      } catch (err: any) {
        // Ignora competência sem movimentação ou já fechada
      }
    }
  }

  return results;
}

/**
 * Registra acerto (total ou parcial) de uma competência mensal fechada.
 * Garante idempotência rigorosa, controle de concorrência e impede exceder o saldo devedor.
 */
export async function recordMonthlyCreditPayout(params: {
  closingId: string;
  companyId: string;
  authorId: string;
  amountCents: number;
  paymentMethod?: string;
  receiptUrl?: string;
  notes?: string;
  idempotencyKey?: string;
}) {
  const { closingId, companyId, authorId, amountCents, paymentMethod = 'PIX', receiptUrl, notes, idempotencyKey } = params;

  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw { status: 400, message: 'O valor do acerto deve ser maior que zero' };
  }

  // 1. Idempotência preventiva
  if (idempotencyKey) {
    const existingPayout = await prisma.monthlyCreditClosingPayout.findUnique({
      where: { idempotencyKey: String(idempotencyKey).trim() },
    });
    if (existingPayout) {
      // Reenvio com a mesma chave e parâmetros diferentes gera conflito
      if (existingPayout.amountCents !== amountCents || existingPayout.closingId !== closingId) {
        throw {
          status: 409,
          code: 'IDEMPOTENCY_CONFLICT',
          message: 'Conflito de idempotência: a chave informada já foi utilizada com parâmetros diferentes.',
        };
      }
      const existingClosing = await prisma.monthlyCreditClosing.findUnique({
        where: { id: closingId },
        include: { payouts: true },
      });
      return { payout: existingPayout, closing: existingClosing, idempotentReplay: true };
    }
  }

  return await prisma.$transaction(async (tx) => {
    // 2. Bloqueio pessimista do fechamento
    await tx.$queryRaw`SELECT id FROM "MonthlyCreditClosing" WHERE id = ${closingId} FOR UPDATE`;

    const closing = await tx.monthlyCreditClosing.findFirst({
      where: { id: closingId, companyId },
    });

    if (!closing) {
      throw { status: 404, message: 'Fechamento mensal não encontrado' };
    }

    if (closing.status === 'PAID' || closing.remainingBalanceCents <= 0) {
      throw { status: 400, message: 'Este fechamento mensal já se encontra totalmente quitado.' };
    }

    if (amountCents > closing.remainingBalanceCents) {
      const maxAvailable = Number((closing.remainingBalanceCents / 100).toFixed(2));
      throw {
        status: 400,
        message: `O valor do pagamento (R$ ${(amountCents / 100).toFixed(2)}) ultrapassa o saldo restante a pagar (R$ ${maxAvailable.toFixed(2)}).`,
      };
    }

    // 3. Criar registro de pagamento / acerto
    const payout = await tx.monthlyCreditClosingPayout.create({
      data: {
        closingId,
        amountCents,
        paymentMethod,
        receiptUrl: receiptUrl || null,
        notes: notes || null,
        authorId,
        idempotencyKey: idempotencyKey ? String(idempotencyKey).trim() : null,
      },
    });

    // 3.1 Criar saída financeira real (Cost) uma única vez para integrar aos agregadores de finanças
    const seller = await tx.user.findUnique({
      where: { id: closing.sellerId },
      select: { name: true },
    });

    const parsedAmount = Number((amountCents / 100).toFixed(2));
    await tx.cost.create({
      data: {
        companyId: closing.companyId,
        userId: closing.sellerId,
        amount: parsedAmount,
        category: 'COMMISSION',
        subcategory: 'MONTHLY_CREDIT',
        description: `Comissão crediário (10% parcelas) comp. ${closing.competence} - ${seller?.name || 'Vendedor'}${notes ? ` (${notes})` : ''}`,
        date: new Date(),
        paymentMethod: (paymentMethod || 'PIX').toUpperCase(),
        status: 'APPROVED',
        receiptUrl: receiptUrl || null,
      },
    });

    // 4. Atualizar saldo do fechamento mensal
    const newPaidAmountCents = closing.paidAmountCents + amountCents;
    const newRemainingBalanceCents = closing.netCommissionCents - newPaidAmountCents;
    const newStatus = newRemainingBalanceCents === 0 ? 'PAID' : 'PARTIALLY_PAID';

    const updatedClosing = await tx.monthlyCreditClosing.update({
      where: { id: closingId },
      data: {
        paidAmountCents: newPaidAmountCents,
        remainingBalanceCents: newRemainingBalanceCents,
        status: newStatus,
      },
      include: {
        payouts: true,
        commissions: true,
        adjustments: true,
      },
    });

    // 5. Se foi quitado ou parcialmente pago, atualizar status dos itens de comissão vinculados
    if (newStatus === 'PAID') {
      await tx.creditCommission.updateMany({
        where: { monthlyClosingId: closingId },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          paidByUserId: authorId,
          paidMethod: paymentMethod,
          paidReceiptUrl: receiptUrl || null,
        },
      });
    }

    return { payout, closing: updatedClosing, idempotentReplay: false };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5000,
    timeout: 10000,
  });
}

/**
 * Trata estorno de pagamento de crediário em relação à comissão:
 * - Se o pagamento pertence a competência ainda aberta: cancela a comissão diretamente.
 * - Se o pagamento pertence a competência já encerrada/fechada/paga:
 *   NUNCA altera o fechamento histórico! Gera CreditCommissionAdjustment negativo
 *   vinculado à origem para abater no próximo ciclo mensal aberto.
 */
export async function handleCreditPaymentReversalCommission(params: {
  paymentId: string;
  companyId: string;
  authorId: string;
  reversalReason: string;
  tx: Prisma.TransactionClient;
}) {
  const { paymentId, companyId, authorId, reversalReason, tx } = params;

  const commission = await tx.creditCommission.findFirst({
    where: { paymentId, companyId },
    include: { monthlyClosing: true },
  });

  if (!commission) return;

  // Se já está vinculado a um fechamento mensal persistido (fechado ou pago):
  if (commission.monthlyClosingId && commission.monthlyClosing) {
    // Gerar ajuste negativo rastreável para a próxima competência
    await tx.creditCommissionAdjustment.create({
      data: {
        companyId,
        sellerId: commission.sellerId,
        agreementId: commission.agreementId,
        paymentId,
        commissionId: commission.id,
        amountCents: -commission.amountCents, // Valor negativo para débito rastreável
        reason: `Estorno tardio de parcela paga na competência ${commission.monthlyClosing.competence}: ${reversalReason}`,
        status: 'PENDING',
      },
    });
  } else {
    // Competência ainda aberta: cancela a comissão diretamente
    await tx.creditCommission.update({
      where: { id: commission.id },
      data: {
        isReversed: true,
        reversedAt: new Date(),
        reversalReason,
        status: 'CANCELLED',
      },
    });
  }
}

/**
 * Obtém os 4 estados visíveis de comissão para a carteira do vendedor:
 * 1. Prevista / Futura: parcelas futuras não pagas * 10%
 * 2. Acumulada no Mês: recebimentos na competência aberta corrente * 10%
 * 3. Mês Fechado — A Pagar: total apurado em meses encerrados menos já pago
 * 4. Parcialmente Paga / Paga: total efetivamente liquidado pelo Admin
 */
export async function getSellerFourCommissionStates(companyId: string, sellerId: string, now: Date = new Date()) {
  const { currentOpen } = getRelevantCompetences(now);
  const { startDate: openStart, endDate: openEnd } = getCompetenceRange(currentOpen);

  // 1. Prevista/futura: parcelas pendentes/parciais futuras de contratos ativos
  const activeAgreements = await prisma.creditAgreement.findMany({
    where: {
      companyId,
      sellerId,
      status: { in: ['ACTIVE', 'RENEGOTIATED'] },
    },
    include: {
      installments: {
        where: { status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] } },
      },
    },
  });

  let futureReceivablePrincipalCents = 0;
  let futureCommissionCents = 0;

  for (const a of activeAgreements) {
    const rate = a.installmentCommissionRate ?? 0.10;
    for (const inst of a.installments) {
      const unpaidPrincipal = Math.max(0, inst.amountCents - inst.paidCents);
      futureReceivablePrincipalCents += unpaidPrincipal;
      futureCommissionCents += Math.round(unpaidPrincipal * rate);
    }
  }

  // 2. Acumulada no mês aberto atual: parcelas recebidas desde o início do mês atual
  const openMonthCalculation = await calculateSellerMonthlyCreditClosing({
    companyId,
    sellerId,
    competence: currentOpen,
  });

  // 3. Meses fechados persistidos: buscar todos os MonthlyCreditClosing
  const closedMonths = await prisma.monthlyCreditClosing.findMany({
    where: { companyId, sellerId },
    orderBy: { competence: 'desc' },
    include: {
      payouts: { orderBy: { paidAt: 'desc' } },
    },
  });

  let closedMonthAwaitingPaymentCents = 0;
  let historicallyPaidCommissionCents = 0;

  for (const m of closedMonths) {
    closedMonthAwaitingPaymentCents += m.remainingBalanceCents;
    historicallyPaidCommissionCents += m.paidAmountCents;
  }

  return {
    sellerId,
    currentOpenCompetence: currentOpen,
    states: {
      // Estado 1: Prevista / Futura
      future: {
        futureReceivablePrincipalCents,
        futureReceivablePrincipal: Number((futureReceivablePrincipalCents / 100).toFixed(2)),
        futureCommissionCents,
        futureCommission: Number((futureCommissionCents / 100).toFixed(2)),
        label: 'Prevista / Futura (depende de pagamento pelo cliente)',
      },
      // Estado 2: Acumulada no Mês Aberto
      accumulatedCurrentMonth: {
        competence: currentOpen,
        principalReceivedCents: openMonthCalculation.totalPrincipalReceivedCents,
        principalReceived: openMonthCalculation.totalPrincipalReceived,
        commissionCents: openMonthCalculation.netCommissionCents,
        commission: openMonthCalculation.netCommission,
        itemsCount: openMonthCalculation.itemsCount,
        label: 'Acumulada no Mês (competência aberta, não quitada)',
      },
      // Estado 3: Mês Fechado — A Pagar
      closedAwaitingPayment: {
        totalAwaitingCents: closedMonthAwaitingPaymentCents,
        totalAwaiting: Number((closedMonthAwaitingPaymentCents / 100).toFixed(2)),
        closedMonthsCount: closedMonths.filter((m) => m.remainingBalanceCents > 0).length,
        label: 'Mês Fechado — A Pagar (apurado e aguardando acerto)',
      },
      // Estado 4: Parcialmente Paga / Paga
      paid: {
        totalPaidCents: historicallyPaidCommissionCents,
        totalPaid: Number((historicallyPaidCommissionCents / 100).toFixed(2)),
        label: 'Comissão Paga (acerto registrado pelo Admin)',
      },
    },
    closedMonths,
  };
}
