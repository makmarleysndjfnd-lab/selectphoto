import { NextFunction, Response, Router } from 'express';
import { prisma, Prisma } from '../services/prisma';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { upload, safeUpload, getUploadedFileUrl, removeUploadedFile } from '../middleware/upload';
import { validateCpf, calculateCreditSchedule, validateCreditSaleRequirements } from '../services/creditService';
import {
  resolveNewSaleCommission,
  resolveNewCreditInstallmentCommission,
  resolveHistoricalSaleCommissionRate,
} from '../utils/commission';
import {
  evaluateSalePricePolicy,
  getCompanyOperationalConfig,
} from '../services/companyOperationalConfigService';
import { recordOperationalAuditEvent } from '../services/operationalAuditService';
import { getSaleNetCents, isSaleCancelled } from '../utils/saleNetHelper';
import { createDebitAdvance } from '../services/staffAdvanceService';
import { recordStatementAdjustmentOrReturnCredit } from '../services/platformBillingService';
import {
  resolveSaleHasCover,
  deductCoverForSellerSale,
  restoreCoverForCanceledSale,
} from '../services/coverStockService';
import {
  issueBuyerConfirmationLink,
  recordBuyerConfirmationSkipped,
  invalidateAndReissueConfirmationOnSaleChange,
  getPublicBuyerConfirmationPrompt,
  submitPublicBuyerConfirmation,
  resolveBuyerConfirmationReview,
  formatBuyerConfirmationForRole,
  sanitizePublicBuyerConfirmationError,
} from '../services/buyerConfirmationService';

const router = Router();


const SALE_MANAGER_ROLES = ['COMPANY_ADMIN', 'ADMIN', 'SUPERVISOR', 'SELLER_MANAGER', 'SUPER_ADMIN'];

async function emitSaleCreationOperationalAudit(req: AuthRequest, sale: any, rawBody: any) {
  try {
    const companyId = req.user?.companyId || sale.companyId;
    const ref = sale.fichaNumber || `VND-${String(sale.id).slice(0, 8).toUpperCase()}`;
    const authorName = req.user?.name || 'Operador';
    const authorRole = req.user?.role || null;
    const ipAddress = (req.ip || req.socket?.remoteAddress || null) as string | null;

    if (sale.status === 'PRONTO') {
      await recordOperationalAuditEvent({
        companyId,
        category: 'PAYMENT',
        action: 'SALE_CONFIRMED_PAYMENT',
        entityType: 'SALE',
        entityReference: ref,
        entityId: sale.id,
        previousValues: null,
        newValues: {
          value: sale.value,
          paymentMethod: sale.paymentMethod,
          paymentStatus: sale.paymentStatus,
          city: sale.city,
        },
        reason: 'Confirmação de venda comercial',
        authorUserId: req.user?.id || sale.sellerId,
        authorName,
        authorRole,
        ipAddress,
      });
    }

    const discountAmount = Number(rawBody?.discountAmount || 0);
    const discountPct = Number(rawBody?.discountPercentage || 0);
    if (discountAmount > 0 || discountPct > 0) {
      const listVal = Number(rawBody?.originalValue || Number(sale.value) + discountAmount);
      const effectivePct =
        discountPct > 0
          ? discountPct
          : listVal > 0
          ? Number(((discountAmount / listVal) * 100).toFixed(2))
          : 0;
      await recordOperationalAuditEvent({
        companyId,
        category: 'DISCOUNT',
        action: 'SALE_DISCOUNT_DECLARED',
        entityType: 'SALE',
        entityReference: ref,
        entityId: sale.id,
        previousValues: { listValue: listVal },
        newValues: {
          finalValue: sale.value,
          discountAmount: discountAmount || null,
          discountPercentage: effectivePct,
        },
        reason: rawBody?.discountReason || rawBody?.reason || 'Desconto comercial informado na venda',
        authorUserId: req.user?.id || sale.sellerId,
        authorName,
        authorRole,
        ipAddress,
        reviewAlert:
          effectivePct >= 15
            ? {
                alertType: 'DECLARED_DISCOUNT_REVIEW',
                severity: 'ATTENTION',
                summary:
                  'Desconto comercial igual ou superior a 15% registrado para conferência administrativa.',
                details: { finalValue: sale.value, discountPercentage: effectivePct },
              }
            : null,
      });
    }

    if (sale.priceDivergenceAlert) {
      await recordOperationalAuditEvent({
        companyId,
        category: 'DISCOUNT',
        action: 'SALE_PRICE_DIVERGENCE_ALERT',
        entityType: 'SALE',
        entityReference: ref,
        entityId: sale.id,
        previousValues: null,
        newValues: {
          value: sale.value,
          detail: sale.priceDivergenceDetail || null,
        },
        reason: sale.priceDivergenceDetail || 'Desconto excedeu o teto configurado em modo auditoria silenciosa',
        authorUserId: req.user?.id || sale.sellerId,
        authorName,
        authorRole,
        ipAddress,
        reviewAlert: {
          alertType: 'PRICE_DIVERGENCE_REVIEW',
          severity: 'ATTENTION',
          summary: sale.priceDivergenceDetail || 'Venda registrada abaixo do preço mínimo autorizado.',
          details: { finalValue: sale.value, detail: sale.priceDivergenceDetail || null },
        },
      });
    }

    const rawCred = rawBody?.credit || rawBody?.creditAgreement;
    if (rawCred) {
      const credObj = typeof rawCred === 'string' ? JSON.parse(rawCred) : rawCred;
      await recordOperationalAuditEvent({
        companyId,
        category: 'CONTRACT',
        action: 'CREDIT_AGREEMENT_OPENED',
        entityType: 'CREDIT_AGREEMENT',
        entityReference: ref,
        entityId: sale.id,
        previousValues: null,
        newValues: {
          totalValue: sale.value,
          installmentsCount: credObj?.installmentsCount || credObj?.installments,
          periodicity: credObj?.periodicity || 'MONTHLY',
          buyerCpf: credObj?.buyerCpf || null,
        },
        reason: 'Abertura de contrato de crediário em venda confirmada',
        authorUserId: req.user?.id || sale.sellerId,
        authorName,
        authorRole,
        ipAddress,
      });
    }
  } catch (auditErr) {
    console.warn('[OperationalAudit] Falha não-bloqueante ao registrar auditoria de venda:', auditErr);
  }
}

function parseSaleInput(body: any) {
  const {
    clientId,
    value,
    city,
    product,
    fichaNumber,
    paymentMethod,
    payments,
    reportNotes,
    notes,
    sellerRating,
    photographerRating,
    contactRating,
    credit,
    creditAgreement,
    receiptUrl,
  } = body;
  const parsedValue = Number(value);

  if (!clientId || value === undefined || !city) {
    throw { status: 400, message: 'Cliente, valor e cidade são obrigatórios' };
  }
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw { status: 400, message: 'O valor da venda deve ser maior que zero' };
  }

  // Tratamento monetário seguro em centavos
  const totalCents = Math.round(parsedValue * 100);

  let parsedPayments: Array<{ method: string; amount: number; receiptUrl?: string | null }> = [];
  let rawPayments = payments;
  if (typeof rawPayments === 'string') {
    try {
      rawPayments = JSON.parse(rawPayments);
    } catch (_) {
      rawPayments = null;
    }
  }

  let sumCents = 0;
  if (Array.isArray(rawPayments) && rawPayments.length > 0) {
    for (const p of rawPayments) {
      const pAmount = Number(p.amount ?? p.value);
      if (!Number.isFinite(pAmount) || pAmount <= 0) {
        throw { status: 400, message: 'Cada forma de pagamento selecionada deve ter um valor maior que zero' };
      }
      const rawMethod = String(p.method || p.paymentMethod || '').trim().toUpperCase();
      let normalizedMethod = 'CASH';
      if (rawMethod === 'PIX') normalizedMethod = 'PIX';
      else if (rawMethod === 'DEBIT' || rawMethod === 'DEBITO' || rawMethod === 'DEBIT_CARD') normalizedMethod = 'DEBIT';
      else if (rawMethod === 'CREDIT' || rawMethod === 'CREDITO' || rawMethod === 'CREDIT_CARD') normalizedMethod = 'CREDIT';
      else if (rawMethod === 'CASH' || rawMethod === 'DINHEIRO') normalizedMethod = 'CASH';
      else {
        throw { status: 400, message: `Forma de pagamento inválida: ${rawMethod}` };
      }

      const pCents = Math.round(pAmount * 100);
      sumCents += pCents;

      parsedPayments.push({
        method: normalizedMethod,
        amount: Number((pCents / 100).toFixed(2)),
        receiptUrl: p.receiptUrl ? String(p.receiptUrl).trim() : null,
      });
    }
  }

  let rawCredit = credit || creditAgreement;
  if (typeof rawCredit === 'string') {
    try {
      rawCredit = JSON.parse(rawCredit);
    } catch (_) {
      rawCredit = null;
    }
  }

  let parsedCredit: any = null;
  if (rawCredit && typeof rawCredit === 'object') {
    const rawCpf = String(rawCredit.buyerCpf || '').replace(/\D/g, '');
    if (!validateCpf(rawCpf)) {
      throw { status: 400, message: 'CPF do comprador inválido ou com dígitos verificadores incorretos' };
    }

    const installmentsCount = Math.round(Number(rawCredit.installmentsCount || rawCredit.installments || 1));
    if (installmentsCount < 1 || installmentsCount > 48) {
      throw { status: 400, message: 'Número de parcelas deve ser entre 1 e 48' };
    }

    let downPaymentCents = sumCents;
    if (parsedPayments.length === 0 || downPaymentCents === 0) {
      const dpNum = Number(rawCredit.downPayment || body.downPayment);
      if (Number.isFinite(dpNum) && dpNum > 0) {
        downPaymentCents = Math.round(dpNum * 100);
        const singleMethod = paymentMethod ? String(paymentMethod).trim().toUpperCase() : 'CASH';
        let normalized = 'CASH';
        if (singleMethod === 'PIX') normalized = 'PIX';
        else if (singleMethod.includes('DEBIT')) normalized = 'DEBIT';
        else if (singleMethod.includes('CREDIT')) normalized = 'CREDIT';
        parsedPayments.push({
          method: normalized,
          amount: Number((downPaymentCents / 100).toFixed(2)),
          receiptUrl: null,
        });
      }
    }

    if (downPaymentCents < 15000) {
      throw {
        status: 400,
        message: 'Toda nova venda com crediário exige entrada efetivamente paga de pelo menos R$ 150,00',
      };
    }

    if (downPaymentCents >= totalCents) {
      throw {
        status: 400,
        message: 'A entrada não pode ser igual ou superior ao valor total na venda a crediário. Se o pagamento for total, desative o parcelamento.',
      };
    }

    const financedPrincipalCents = totalCents - downPaymentCents;
    const rawPeriodicity = String(rawCredit.periodicity || 'MONTHLY').trim().toUpperCase();
    const periodicity = (rawPeriodicity === 'BIWEEKLY' || rawPeriodicity === 'QUINZENAL') ? 'BIWEEKLY' : 'MONTHLY';

    let firstDueDate: Date | undefined;
    if (rawCredit.firstDueDate) {
      const parsedD = new Date(rawCredit.firstDueDate);
      if (!isNaN(parsedD.getTime())) {
        firstDueDate = parsedD;
      }
    }
    if (!firstDueDate) {
      firstDueDate = new Date();
      firstDueDate.setUTCDate(firstDueDate.getUTCDate() + (periodicity === 'BIWEEKLY' ? 15 : 30));
    }

    parsedCredit = {
      buyerName: rawCredit.buyerName ? String(rawCredit.buyerName).trim() : null,
      buyerCpf: rawCpf,
      buyerRg: rawCredit.buyerRg ? String(rawCredit.buyerRg).trim() : null,
      installmentsCount,
      periodicity,
      firstDueDate,
      signedAgreementUrl: rawCredit.signedAgreementUrl ? String(rawCredit.signedAgreementUrl).trim() : null,
      notes: rawCredit.notes ? String(rawCredit.notes).trim() : null,
      street: rawCredit.street ? String(rawCredit.street).trim() : null,
      number: rawCredit.number ? String(rawCredit.number).trim() : null,
      neighborhood: rawCredit.neighborhood ? String(rawCredit.neighborhood).trim() : null,
      city: rawCredit.city ? String(rawCredit.city).trim() : null,
      state: rawCredit.state ? String(rawCredit.state).trim() : null,
      cep: rawCredit.cep ? String(rawCredit.cep).trim() : null,
      referencePoint: rawCredit.referencePoint ? String(rawCredit.referencePoint).trim() : null,
      downPaymentCents,
      financedPrincipalCents,
      calculationMode: rawCredit.calculationMode || rawCredit.installmentCalculationMode || 'BY_COUNT',
      desiredInstallmentAmountCents: rawCredit.desiredInstallmentAmountCents ? Math.round(Number(rawCredit.desiredInstallmentAmountCents)) : undefined,
      customInstallments: Array.isArray(rawCredit.installments) ? rawCredit.installments : undefined,
    };
  } else {
    // Venda tradicional à vista ou cartão sem crediário interno
    if (parsedPayments.length === 0) {
      const singleMethod = paymentMethod ? String(paymentMethod).trim().toUpperCase() : 'CASH';
      let normalized = 'CASH';
      if (singleMethod === 'PIX') normalized = 'PIX';
      else if (singleMethod.includes('DEBIT')) normalized = 'DEBIT';
      else if (singleMethod.includes('CREDIT')) normalized = 'CREDIT';
      else normalized = 'CASH';

      parsedPayments.push({
        method: normalized,
        amount: parsedValue,
        receiptUrl: null,
      });
      sumCents = totalCents;
    }

    if (sumCents !== totalCents) {
      const diff = Number(((sumCents - totalCents) / 100).toFixed(2));
      throw {
        status: 400,
        message: `A soma das formas de pagamento (R$ ${(sumCents / 100).toFixed(2)}) deve corresponder exatamente ao valor da venda (R$ ${parsedValue.toFixed(2)}). Diferença: R$ ${diff.toFixed(2)}`,
      };
    }
  }

  const effectivePaymentMethod = parsedPayments.length > 1 ? 'SPLIT' : (parsedPayments[0]?.method || 'CASH');

  const parseRating = (val: any) => {
    if (val === undefined || val === null || val === '') return null;
    const num = Number(val);
    return Number.isFinite(num) ? Math.round(num) : null;
  };

  const effectiveProduct = product ? String(product).trim() : 'Mídias fotográficas';
  const effectiveHasCover = resolveSaleHasCover(body.hasCover, effectiveProduct);

  return {
    clientId: String(clientId),
    value: parsedValue,
    city: String(city).trim(),
    product: effectiveProduct,
    hasCover: effectiveHasCover,
    fichaNumber: fichaNumber ? String(fichaNumber).trim() : null,
    paymentMethod: effectivePaymentMethod,
    payments: parsedPayments,
    reportNotes: reportNotes ? String(reportNotes).trim() : (notes ? String(notes).trim() : null),
    sellerRating: parseRating(sellerRating),
    photographerRating: parseRating(photographerRating),
    contactRating: parseRating(contactRating),
    receiptUrl: receiptUrl ? String(receiptUrl).trim() : null,
    credit: parsedCredit,
  };
}

/**
 * Executa uma transação no PostgreSQL com nível de isolamento Serializable.
 * Caso ocorra erro de concorrência/serialização (P2034 / 40001), retenta de forma controlada.
 */
async function runSerializableTransaction<T>(
  action: (tx: Prisma.TransactionClient) => Promise<T>,
  maxRetries = 8
): Promise<T> {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      return await prisma.$transaction(action, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (err: any) {
      const isSerializationConflict =
        err?.code === 'P2034' ||
        err?.code === '40001' ||
        (typeof err?.message === 'string' &&
          (err.message.includes('could not serialize access') ||
            err.message.includes('serialization_failure') ||
            err.message.includes('deadlock detected') ||
            err.message.includes('Transaction failed due to a write conflict')));

      if (isSerializationConflict) {
        if (attempt <= maxRetries) {
          const baseDelay = 60 * Math.pow(1.5, attempt - 1);
          const jitter = Math.floor(Math.random() * 80);
          const delayMs = Math.round(baseDelay + jitter);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw {
          status: 409,
          code: 'CONCURRENCY_CONFLICT',
          message: 'Conflito de concorrência temporário no processamento da transação. Por favor, tente novamente.',
          cause: err,
        };
      }
      throw err;
    }
  }
}

/**
 * Verifica se os dados comerciais de uma venda existente coincidem estritamente com os dados recebidos.
 */
function areCommercialFieldsIdentical(
  existing: any,
  input: {
    clientId: string;
    value: number;
    city: string;
    product: string;
    fichaNumber: string | null;
    paymentMethod: string;
  },
  clientSequenceNumber?: string
): boolean {
  const valueMatches = Math.abs(Number(existing.value) - Number(input.value)) < 0.001;
  const cityMatches =
    (existing.city || '').trim().toLowerCase() === input.city.trim().toLowerCase();
  const productMatches =
    (existing.product || '').trim().toLowerCase() === input.product.trim().toLowerCase();
  const paymentMatches =
    (existing.paymentMethod || '').trim().toUpperCase() === input.paymentMethod.trim().toUpperCase();

  const existingFicha = (existing.fichaNumber || clientSequenceNumber || '').trim();
  const inputFicha = (input.fichaNumber || clientSequenceNumber || '').trim();
  const fichaMatches = !inputFicha || !existingFicha || inputFicha === existingFicha;

  return valueMatches && cityMatches && productMatches && paymentMatches && fichaMatches;
}

async function finalizeSaleWithReceipt(params: {
  body: any;
  sellerId: string;
  companyId: string;
  receiptUrl: string;
  sheetPhotoUrl?: string | null;
  correlationId?: string;
  callerRole?: string;
}): Promise<{ sale: any; created: boolean }> {
  const input = parseSaleInput(params.body);

  return runSerializableTransaction(async (tx) => {
    const sellerUser = await tx.user.findUnique({
      where: { id: params.sellerId },
      select: {
        sellerBlocked: true,
        sellerBlockedReason: true,
        usesOwnCar: true,
        sellerVehicleType: true,
        sellerBookProfile: true,
        salesType: true,
        customVirginCommissionPercent: true,
        customReboloCommissionPercent: true,
        customCreditInstallmentCommissionPercent: true,
      },
    });
    if (sellerUser?.sellerBlocked) {
      throw {
        status: 403,
        code: 'SELLER_PREVENTIVELY_BLOCKED',
        message: `Vendedor bloqueado preventivamente para novos lotes e vendas (${
          sellerUser.sellerBlockedReason || 'bloqueio administrativo ativo'
        }).`,
      };
    }

    const client = await tx.client.findFirst({
      where: { id: input.clientId, companyId: params.companyId },
    });
    if (!client) throw { status: 404, message: 'Ficha não encontrada na sua empresa' };
    if (
      !SALE_MANAGER_ROLES.includes(params.callerRole || '') &&
      client.assignedSellerId &&
      client.assignedSellerId !== params.sellerId
    ) {
      throw {
        status: 403,
        code: 'WALLET_ACCESS_DENIED',
        message: 'Acesso negado: esta ficha pertence à carteira de outro vendedor.',
      };
    }
    if (client.cityClosedAt) throw { status: 409, message: 'Cidade já foi fechada para esta ficha' };

    // Buscar todas as vendas existentes para esta ficha na empresa
    const allSalesForClient = await tx.sale.findMany({
      where: {
        clientId: input.clientId,
        companyId: params.companyId,
      },
      orderBy: { date: 'asc' },
    });

    // Cenário 5: Venda válida com comprovante já existente
    const existingWithReceipt = allSalesForClient.find((s) => Boolean(s.receiptUrl));
    if (existingWithReceipt) {
      if (existingWithReceipt.sellerId !== params.sellerId) {
        throw {
          status: 409,
          code: 'SALE_ALREADY_EXISTS',
          message: 'Venda com comprovante já registrada para esta ficha por outro vendedor',
        };
      }

      // Venda pertence ao mesmo vendedor: verificar coincidência estrita dos dados comerciais
      const isIdentical = areCommercialFieldsIdentical(existingWithReceipt, input, client.sequenceNumber);
      if (isIdentical) {
        return { sale: existingWithReceipt, created: false };
      }

      throw {
        status: 409,
        code: 'SALE_ALREADY_EXISTS',
        message: 'Venda já registrada para esta ficha com dados comerciais divergentes',
      };
    }

    // Cenário 4: Mais de uma venda incompleta (sem comprovante) para a mesma ficha
    if (allSalesForClient.length > 1) {
      throw {
        status: 409,
        code: 'LEGACY_SALE_REQUIRES_RECONCILIATION',
        message: 'Ficha possui múltiplos registros antigos sem comprovante e requer reconciliação manual',
      };
    }

    // Cenário 3: Exatamente uma venda incompleta antiga
    if (allSalesForClient.length === 1) {
      const existingSingle = allSalesForClient[0];
      if (existingSingle.sellerId !== params.sellerId) {
        throw {
          status: 403,
          code: 'SELLER_MISMATCH',
          message: 'Acesso negado: a ficha possui registro vinculado a outro vendedor',
        };
      }

      // Comparar os dados da venda incompleta com a nova tentativa
      const isIdentical = areCommercialFieldsIdentical(existingSingle, input, client.sequenceNumber);
      if (!isIdentical) {
        throw {
          status: 409,
          code: 'LEGACY_SALE_DATA_MISMATCH',
          message:
            'Dados comerciais da venda diferem da venda incompleta anterior. Regularização requer reconciliação administrativa.',
        };
      }

      // Pertence ao mesmo vendedor e dados são equivalentes: anexar o comprovante à venda existente de forma atômica
      const scenario0OpCfg = await getCompanyOperationalConfig(params.companyId, tx as any);
      const scenario0PricePolicy = evaluateSalePricePolicy({
        saleValueReais: input.value,
        operationalConfig: scenario0OpCfg,
      });
      if (scenario0PricePolicy.shouldBlock) {
        throw {
          status: 400,
          code: 'DISCOUNT_LIMIT_EXCEEDED',
          message:
            scenario0PricePolicy.priceDivergenceDetail ||
            'Desconto acima do máximo permitido pela empresa.',
        };
      }
      const scenario0Comm = resolveNewSaleCommission({
        bookStatus: client.bookStatus,
        operationalConfig: scenario0OpCfg,
        sellerOverrides: sellerUser,
      });
      let updatedSale = await tx.sale.update({
        where: { id: existingSingle.id },
        data: {
          paymentStatus: 'PAID',
          status: 'PRONTO',
          hasCover: input.hasCover,
          receiptUrl: params.receiptUrl,
          priceDivergenceAlert: existingSingle.priceDivergenceAlert || scenario0PricePolicy.priceDivergenceAlert,
          priceDivergenceDetail:
            existingSingle.priceDivergenceDetail || scenario0PricePolicy.priceDivergenceDetail,
          ...(existingSingle.appliedCommissionPercent == null
            ? { appliedCommissionPercent: scenario0Comm.percent }
            : {}),
          ...(params.sheetPhotoUrl ? { sheetPhotoUrl: params.sheetPhotoUrl } : {}),
          ...(input.reportNotes ? { reportNotes: input.reportNotes } : {}),
          ...(input.sellerRating !== null ? { sellerRating: input.sellerRating } : {}),
          ...(input.photographerRating !== null ? { photographerRating: input.photographerRating } : {}),
          ...(input.contactRating !== null ? { contactRating: input.contactRating } : {}),
        },
      });

      if (!existingSingle.coverDeducted && updatedSale.hasCover) {
        const deducted = await deductCoverForSellerSale(tx, {
          saleId: updatedSale.id,
          sellerId: params.sellerId,
          hasCover: updatedSale.hasCover,
        });
        if (deducted) {
          updatedSale = { ...updatedSale, coverDeducted: true };
        }
      }

      if (client.outcomeStatus === 'NON_SALE') {
        await tx.nonSale.updateMany({
          where: {
            clientId: input.clientId,
            companyId: params.companyId,
            supersededAt: null,
          },
          data: { supersededAt: updatedSale.date, supersededBySaleId: updatedSale.id },
        });
      }

      const nextBookStatus =
        client.bookStatus === 'DISTRIBUTED_REBOLO' || client.bookStatus === 'IN_STOCK_REBOLO'
          ? 'REBOLO_SOLD'
          : 'SOLD';

      await tx.client.update({
        where: { id: input.clientId },
        data: {
          outcomeStatus: 'SOLD',
          outcomeUpdatedAt: updatedSale.date,
          bookStatus: nextBookStatus,
        },
      });

      await tx.clientTimeline.create({
        data: {
          clientId: input.clientId,
          cycle: client.commercialCycle || 1,
          previousStatus: client.bookStatus,
          newStatus: nextBookStatus,
          previousSellerId: client.assignedSellerId,
          newSellerId: client.assignedSellerId,
          authorId: params.sellerId,
          authorRole: 'SELLER',
          action: 'SALE',
          reason: `Venda regularizada com anexos de comprovante no valor de R$ ${input.value}`,
        },
      });

      return { sale: updatedSale, created: true };
    }

    // Cenário 1: Ficha limpa + comprovante (zero vendas existentes)
    if (client.outcomeStatus === 'SOLD') {
      throw {
        status: 409,
        code: 'CLIENT_ALREADY_SOLD',
        message: 'Ficha já está marcada como vendida no sistema',
      };
    }

      const { payments: paymentsList, credit: creditInput, ...saleData } = input;
      const scenario1OpCfg = await getCompanyOperationalConfig(params.companyId, tx as any);
      const scenario1PricePolicy = evaluateSalePricePolicy({
        saleValueReais: input.value,
        operationalConfig: scenario1OpCfg,
      });
      if (scenario1PricePolicy.shouldBlock) {
        throw {
          status: 400,
          code: 'DISCOUNT_LIMIT_EXCEEDED',
          message:
            scenario1PricePolicy.priceDivergenceDetail ||
            'Desconto acima do máximo permitido pela empresa.',
        };
      }
      if (creditInput && !scenario1OpCfg.isDefault) {
        if (creditInput.installmentsCount > scenario1OpCfg.creditMaxInstallments) {
          throw {
            status: 400,
            code: 'CREDIT_MAX_INSTALLMENTS_EXCEEDED',
            message: `Número máximo de parcelas permitido pela empresa é ${scenario1OpCfg.creditMaxInstallments}x.`,
          };
        }
        const totalSaleCents = Math.round(input.value * 100);
        const minDownCents = Math.max(
          15000,
          Math.round(totalSaleCents * (scenario1OpCfg.creditMinDownPaymentPercent / 100))
        );
        if (creditInput.downPaymentCents < minDownCents) {
          throw {
            status: 400,
            code: 'CREDIT_MIN_DOWN_PAYMENT_NOT_MET',
            message: `Entrada mínima configurada pela empresa é ${scenario1OpCfg.creditMinDownPaymentPercent}% (R$ ${(minDownCents / 100).toFixed(2)}).`,
          };
        }
      }
      const scenario1Comm = resolveNewSaleCommission({
        bookStatus: client.bookStatus,
        operationalConfig: scenario1OpCfg,
        sellerOverrides: sellerUser,
      });
      let sale = await tx.sale.create({
        data: {
          ...saleData,
          sellerId: params.sellerId,
          companyId: params.companyId,
          paymentStatus: creditInput ? 'PARTIALLY_PAID' : 'PAID',
          status: 'PRONTO',
          receiptUrl: params.receiptUrl,
          sheetPhotoUrl: params.sheetPhotoUrl || null,
          reportNotes: input.reportNotes || null,
          sellerRating: input.sellerRating,
          photographerRating: input.photographerRating,
          contactRating: input.contactRating,
          appliedCommissionPercent: scenario1Comm.percent,
          priceDivergenceAlert: scenario1PricePolicy.priceDivergenceAlert,
          priceDivergenceDetail: scenario1PricePolicy.priceDivergenceDetail,
          isLegacy: false,
        },
      });

      if (sale.hasCover) {
        const deducted = await deductCoverForSellerSale(tx, {
          saleId: sale.id,
          sellerId: params.sellerId,
          hasCover: sale.hasCover,
        });
        if (deducted) {
          sale = { ...sale, coverDeducted: true };
        }
      }

      if (paymentsList && paymentsList.length > 0) {
        await tx.salePayment.createMany({
          data: paymentsList.map((p) => ({
            saleId: sale.id,
            method: p.method,
            amount: p.amount,
            receiptUrl: p.receiptUrl || params.receiptUrl,
          })),
        });
      }

      if (creditInput) {
        const street = creditInput.street || client.street;
        const number = creditInput.number || client.number;
        const neighborhood = creditInput.neighborhood || client.neighborhood;
        const city = creditInput.city || client.city;
        const state = creditInput.state || (client as any).state || (client as any).uf || 'SP';
        const cep = creditInput.cep || client.cep;
        const referencePoint = creditInput.referencePoint || client.referencePoint;
        const buyerName = creditInput.buyerName || client.name;

        const validation = validateCreditSaleRequirements({
          totalSaleCents: Math.round(input.value * 100),
          downPaymentCents: creditInput.downPaymentCents,
          buyerCpf: creditInput.buyerCpf,
          street,
          number,
          neighborhood,
          city,
        });
        if (!validation.valid) {
          throw { status: 400, message: validation.error };
        }

        const schedule = calculateCreditSchedule({
          totalSaleCents: Math.round(input.value * 100),
          downPaymentCents: creditInput.downPaymentCents,
          installmentsCount: creditInput.installmentsCount,
          periodicity: creditInput.periodicity,
          firstDueDate: creditInput.firstDueDate,
          calculationMode: creditInput.calculationMode,
          desiredInstallmentAmountCents: creditInput.desiredInstallmentAmountCents,
          customInstallments: creditInput.customInstallments,
        });

        const initialCommissionRate = scenario1Comm.rate;
        const installmentCommissionRate = resolveNewCreditInstallmentCommission({
          operationalConfig: scenario1OpCfg,
          sellerOverrides: sellerUser,
        }).rate;

        const agreement = await tx.creditAgreement.create({
          data: {
            saleId: sale.id,
            clientId: input.clientId,
            sellerId: params.sellerId,
            companyId: params.companyId,
            buyerName,
            buyerCpf: creditInput.buyerCpf,
            buyerRg: creditInput.buyerRg || null,
            street,
            number,
            neighborhood,
            city,
            state,
            cep: cep || null,
            referencePoint: referencePoint || null,
            product: input.product,
            totalSaleCents: Math.round(input.value * 100),
            downPaymentCents: creditInput.downPaymentCents,
            financedPrincipalCents: creditInput.financedPrincipalCents,
            remainingPrincipalCents: creditInput.financedPrincipalCents,
            paidPrincipalCents: 0,
            installmentsCount: schedule.length,
            periodicity: creditInput.periodicity,
            firstDueDate: schedule[0].dueDate,
            status: 'ACTIVE',
            initialCommissionRate,
            installmentCommissionRate,
            signedAgreementUrl: creditInput.signedAgreementUrl || null,
            notes: creditInput.notes || null,
          },
        });

        await tx.creditInstallment.createMany({
          data: schedule.map((inst) => ({
            agreementId: agreement.id,
            installmentNumber: inst.installmentNumber,
            dueDate: inst.dueDate,
            amountCents: inst.amountCents,
            paidCents: 0,
            status: 'PENDING',
          })),
        });

        const downPaymentCommissionCents = Math.round(creditInput.downPaymentCents * initialCommissionRate);
        await tx.creditCommission.create({
          data: {
            agreementId: agreement.id,
            paymentId: null,
            sellerId: params.sellerId,
            companyId: params.companyId,
            amountCents: downPaymentCommissionCents,
            status: 'RELEASED',
            type: 'DOWN_PAYMENT',
          },
        });
      }

    if (client.outcomeStatus === 'NON_SALE') {
      await tx.nonSale.updateMany({
        where: {
          clientId: input.clientId,
          companyId: params.companyId,
          supersededAt: null,
        },
        data: { supersededAt: sale.date, supersededBySaleId: sale.id },
      });
    }

    const nextBookStatus =
      client.bookStatus === 'DISTRIBUTED_REBOLO' || client.bookStatus === 'IN_STOCK_REBOLO'
        ? 'REBOLO_SOLD'
        : 'SOLD';

    await tx.client.update({
      where: { id: input.clientId },
      data: {
        outcomeStatus: 'SOLD',
        outcomeUpdatedAt: sale.date,
        bookStatus: nextBookStatus,
      },
    });

    const timelineReason = creditInput
      ? `Venda a prazo concluída no valor de R$ ${input.value} com entrada de R$ ${(creditInput.downPaymentCents / 100).toFixed(2)} e saldo de R$ ${(creditInput.financedPrincipalCents / 100).toFixed(2)} financiado em ${creditInput.installmentsCount}x no Crediário / Parcelado`
      : `Venda concluída no valor de R$ ${input.value} (${input.paymentMethod}) com anexos completos`;

    await tx.clientTimeline.create({
      data: {
        clientId: input.clientId,
        cycle: client.commercialCycle || 1,
        previousStatus: client.bookStatus,
        newStatus: nextBookStatus,
        previousSellerId: client.assignedSellerId,
        newSellerId: client.assignedSellerId,
        authorId: params.sellerId,
        authorRole: 'SELLER',
        action: 'SALE',
        reason: timelineReason,
      },
    });

    return { sale, created: true };
  });
}

// Register a Sale
router.post('/', authenticateToken, async (req: AuthRequest, res: any) => {
  const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4().substring(0, 8);
  try {
    const sellerId = req.user?.id;
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    if (!sellerId) return res.status(401).json({ error: 'Usuário não identificado' });

    const sellerUser = await prisma.user.findUnique({
      where: { id: sellerId },
      select: {
        sellerBlocked: true,
        sellerBlockedReason: true,
        usesOwnCar: true,
        sellerVehicleType: true,
        sellerBookProfile: true,
        salesType: true,
        customVirginCommissionPercent: true,
        customReboloCommissionPercent: true,
        customCreditInstallmentCommissionPercent: true,
      },
    });
    if (sellerUser?.sellerBlocked) {
      return res.status(403).json({
        error: `Vendedor bloqueado preventivamente para novos lotes e vendas (${
          sellerUser.sellerBlockedReason || 'bloqueio administrativo ativo'
        }).`,
        code: 'SELLER_PREVENTIVELY_BLOCKED',
      });
    }

    const input = parseSaleInput(req.body);

    const result = await runSerializableTransaction(async (tx) => {
      // 1. Confirmar ficha e empresa
      const client = await tx.client.findFirst({
        where: {
          id: input.clientId,
          companyId,
        },
      });

      if (!client) {
        throw { status: 404, message: 'Client not found in your company' };
      }

      if (
        !SALE_MANAGER_ROLES.includes(req.user?.role || '') &&
        client.assignedSellerId &&
        client.assignedSellerId !== sellerId
      ) {
        throw {
          status: 403,
          code: 'WALLET_ACCESS_DENIED',
          message: 'Acesso negado: esta ficha pertence à carteira de outro vendedor.',
        };
      }

      // 2. Confirmar que a cidade não está fechada
      if (client.cityClosedAt) {
        throw { status: 409, message: 'Cidade já foi fechada para esta ficha' };
      }

      // 3. Buscar todas as vendas da ficha na empresa
      const allSales = await tx.sale.findMany({
        where: { clientId: input.clientId, companyId },
        orderBy: { date: 'asc' },
      });

      const existingWithReceipt = allSales.find((s) => Boolean(s.receiptUrl));
      if (existingWithReceipt) {
        if (existingWithReceipt.sellerId !== sellerId) {
          throw { status: 409, message: 'Venda já registrada para esta ficha por outro vendedor' };
        }
        const isIdentical = areCommercialFieldsIdentical(existingWithReceipt, input, client.sequenceNumber);
        if (isIdentical) {
          return { sale: existingWithReceipt, created: false };
        }
        throw {
          status: 409,
          code: 'SALE_ALREADY_EXISTS',
          message: 'Venda já registrada para esta ficha com dados comerciais divergentes',
        };
      }

      if (allSales.length > 1) {
        throw {
          status: 409,
          code: 'LEGACY_SALE_REQUIRES_RECONCILIATION',
          message: 'Ficha possui múltiplos registros antigos sem comprovante e requer reconciliação manual',
        };
      }

      if (allSales.length === 1) {
        const single = allSales[0];
        if (single.sellerId !== sellerId) {
          throw { status: 403, message: 'Acesso negado: a ficha possui registro vinculado a outro vendedor' };
        }
        const isIdentical = areCommercialFieldsIdentical(single, input, client.sequenceNumber);
        if (isIdentical) {
          return { sale: single, created: false };
        }
        throw {
          status: 409,
          code: 'SALE_ALREADY_EXISTS',
          message: 'Venda já registrada para esta ficha com dados comerciais divergentes',
        };
      }

      if (client.outcomeStatus === 'SOLD') {
        throw { status: 409, message: 'Venda já registrada para esta ficha por outro fluxo' };
      }

      // 4. Criar a venda (com comprovante se fornecido, ou pendente)
      const { payments: postPayments, credit: postCredit, ...postSaleData } = input;
      const hasReceipt = Boolean(postSaleData.receiptUrl);
      const isConfirmedSale = hasReceipt || Boolean(postCredit);
      const postOpCfg = await getCompanyOperationalConfig(companyId, tx as any);
      const postPricePolicy = evaluateSalePricePolicy({
        saleValueReais: input.value,
        operationalConfig: postOpCfg,
      });
      if (postPricePolicy.shouldBlock) {
        throw {
          status: 400,
          code: 'DISCOUNT_LIMIT_EXCEEDED',
          message:
            postPricePolicy.priceDivergenceDetail ||
            'Desconto acima do máximo permitido pela empresa.',
        };
      }
      if (postCredit && !postOpCfg.isDefault) {
        if (postCredit.installmentsCount > postOpCfg.creditMaxInstallments) {
          throw {
            status: 400,
            code: 'CREDIT_MAX_INSTALLMENTS_EXCEEDED',
            message: `Número máximo de parcelas permitido pela empresa é ${postOpCfg.creditMaxInstallments}x.`,
          };
        }
        const totalSaleCents = Math.round(input.value * 100);
        const minDownCents = Math.max(
          15000,
          Math.round(totalSaleCents * (postOpCfg.creditMinDownPaymentPercent / 100))
        );
        if (postCredit.downPaymentCents < minDownCents) {
          throw {
            status: 400,
            code: 'CREDIT_MIN_DOWN_PAYMENT_NOT_MET',
            message: `Entrada mínima configurada pela empresa é ${postOpCfg.creditMinDownPaymentPercent}% (R$ ${(minDownCents / 100).toFixed(2)}).`,
          };
        }
      }
      const postSaleComm = resolveNewSaleCommission({
        bookStatus: client.bookStatus,
        operationalConfig: postOpCfg,
        sellerOverrides: sellerUser,
      });
      let sale = await tx.sale.create({
        data: {
          ...postSaleData,
          sellerId,
          status: isConfirmedSale ? 'PRONTO' : 'PENDING_RECEIPT',
          paymentStatus: postCredit ? 'PARTIALLY_PAID' : (hasReceipt ? 'PAID' : 'PENDING_RECEIPT'),
          appliedCommissionPercent: postSaleComm.percent,
          priceDivergenceAlert: postPricePolicy.priceDivergenceAlert,
          priceDivergenceDetail: postPricePolicy.priceDivergenceDetail,
          companyId,
        },
      });

      if (isConfirmedSale && sale.hasCover) {
        const deducted = await deductCoverForSellerSale(tx, {
          saleId: sale.id,
          sellerId,
          hasCover: sale.hasCover,
        });
        if (deducted) {
          sale = { ...sale, coverDeducted: true };
        }
      }

      if (postPayments && postPayments.length > 0) {
        await tx.salePayment.createMany({
          data: postPayments.map((p) => ({
            saleId: sale.id,
            method: p.method,
            amount: p.amount,
            receiptUrl: p.receiptUrl || postSaleData.receiptUrl || null,
          })),
        });
      }

      if (hasReceipt || postCredit) {
        const nextBookStatus =
          client.bookStatus === 'DISTRIBUTED_REBOLO' || client.bookStatus === 'IN_STOCK_REBOLO'
            ? 'REBOLO_SOLD'
            : 'SOLD';

        await tx.client.update({
          where: { id: input.clientId },
          data: {
            status: 'PRONTO',
            outcomeStatus: 'SOLD',
            outcomeUpdatedAt: sale.date,
            bookStatus: nextBookStatus,
          },
        });

        await tx.clientTimeline.create({
          data: {
            clientId: input.clientId,
            cycle: client.commercialCycle || 1,
            previousStatus: client.bookStatus,
            newStatus: nextBookStatus,
            previousSellerId: client.assignedSellerId,
            newSellerId: client.assignedSellerId,
            authorId: sellerId,
            authorRole: 'SELLER',
            action: 'SALE',
            reason: postCredit
              ? `Venda a prazo concluída no valor de R$ ${input.value} com entrada de R$ ${(postCredit.downPaymentCents / 100).toFixed(2)} financiado em ${postCredit.installmentsCount}x`
              : `Venda concluída no valor de R$ ${input.value} (${input.paymentMethod}) com anexos`,
          },
        });
      }

      if (postCredit) {
        const street = postCredit.street || client.street;
        const number = postCredit.number || client.number;
        const neighborhood = postCredit.neighborhood || client.neighborhood;
        const city = postCredit.city || client.city;
        const state = postCredit.state || (client as any).state || (client as any).uf || 'SP';
        const cep = postCredit.cep || client.cep;
        const referencePoint = postCredit.referencePoint || client.referencePoint;
        const buyerName = postCredit.buyerName || client.name;

        const validation = validateCreditSaleRequirements({
          totalSaleCents: Math.round(input.value * 100),
          downPaymentCents: postCredit.downPaymentCents,
          buyerCpf: postCredit.buyerCpf,
          street,
          number,
          neighborhood,
          city,
        });
        if (!validation.valid) {
          throw { status: 400, message: validation.error };
        }

        const schedule = calculateCreditSchedule({
          totalSaleCents: Math.round(input.value * 100),
          downPaymentCents: postCredit.downPaymentCents,
          installmentsCount: postCredit.installmentsCount,
          periodicity: postCredit.periodicity,
          firstDueDate: postCredit.firstDueDate,
          calculationMode: postCredit.calculationMode,
          desiredInstallmentAmountCents: postCredit.desiredInstallmentAmountCents,
          customInstallments: postCredit.customInstallments,
        });

        const initialCommissionRate = postSaleComm.rate;
        const installmentCommissionRate = resolveNewCreditInstallmentCommission({
          operationalConfig: postOpCfg,
          sellerOverrides: sellerUser,
        }).rate;

        const agreement = await tx.creditAgreement.create({
          data: {
            saleId: sale.id,
            clientId: input.clientId,
            sellerId,
            companyId,
            buyerName,
            buyerCpf: postCredit.buyerCpf,
            buyerRg: postCredit.buyerRg || null,
            street,
            number,
            neighborhood,
            city,
            state,
            cep: cep || null,
            referencePoint: referencePoint || null,
            product: input.product,
            totalSaleCents: Math.round(input.value * 100),
            downPaymentCents: postCredit.downPaymentCents,
            financedPrincipalCents: postCredit.financedPrincipalCents,
            remainingPrincipalCents: postCredit.financedPrincipalCents,
            paidPrincipalCents: 0,
            installmentsCount: schedule.length,
            periodicity: postCredit.periodicity,
            firstDueDate: schedule[0].dueDate,
            status: 'ACTIVE',
            initialCommissionRate,
            installmentCommissionRate,
            signedAgreementUrl: postCredit.signedAgreementUrl || null,
            notes: postCredit.notes || null,
          },
        });

        await tx.creditInstallment.createMany({
          data: schedule.map((inst) => ({
            agreementId: agreement.id,
            installmentNumber: inst.installmentNumber,
            dueDate: inst.dueDate,
            amountCents: inst.amountCents,
            paidCents: 0,
            status: 'PENDING',
          })),
        });

        const downPaymentCommissionCents = Math.round(postCredit.downPaymentCents * initialCommissionRate);
        await tx.creditCommission.create({
          data: {
            agreementId: agreement.id,
            paymentId: null,
            sellerId,
            companyId,
            amountCents: downPaymentCommissionCents,
            status: 'RELEASED',
            type: 'DOWN_PAYMENT',
          },
        });
      }

      return { sale, created: true };
    });

    console.info('[SALES] Venda processada via POST /sales:', {
      correlationId,
      saleId: result.sale.id,
      created: result.created,
    });
    if (result.created) {
      await emitSaleCreationOperationalAudit(req, result.sale, req.body);
    }
    let buyerConfirmationInfo: any = null;
    try {
      const issued = await issueBuyerConfirmationLink({
        saleId: result.sale.id,
        companyId,
      });
      buyerConfirmationInfo = {
        id: issued.confirmation.id,
        confirmationUrl: issued.confirmationUrl,
        qrCodePayload: issued.qrCodePayload,
        status: issued.status,
        statusProgress: issued.statusProgress,
        conditionsVersion: issued.conditionsVersion,
        expiresAt: issued.expiresAt,
        alreadyResponded: Boolean((issued as any).alreadyResponded),
      };
    } catch (confErr) {
      console.warn('[SALES] Falha não-bloqueante ao emitir link de confirmação do comprador:', confErr);
    }
    res.status(result.created ? 201 : 200).json({
      ...result.sale,
      ...(buyerConfirmationInfo ? { buyerConfirmation: buyerConfirmationInfo } : {}),
    });
  } catch (error: any) {
    if (error && error.status && error.message) {
      return res.status(error.status).json({
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
      });
    }
    console.error('[SALES] Erro ao registrar venda:', {
      correlationId,
      name: error?.name,
      code: error?.code,
      message: error?.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Fluxo atômico recomendado: comprovante obrigatório, foto da ficha e venda concluída em uma
// única chamada lógica. Documentação completa e persistida.
router.post(
  '/with-receipt',
  authenticateToken,
  safeUpload(upload.fields([
    { name: 'receipt', maxCount: 1 },
    { name: 'sheetPhoto', maxCount: 1 },
  ])),
  async (req: AuthRequest, res: any) => {
    const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4().substring(0, 8);
    const companyId = req.user?.companyId;
    const sellerId = req.user?.id;

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const receiptFile = files?.['receipt']?.[0] || (req.file as Express.Multer.File | undefined);
    const sheetPhotoFile = files?.['sheetPhoto']?.[0];

    try {
      if (!companyId) return res.status(403).json({ error: 'Empresa não identificada' });
      if (!sellerId) return res.status(401).json({ error: 'Usuário não identificado' });

      const sellerUser = await prisma.user.findUnique({
        where: { id: sellerId },
        select: { sellerBlocked: true, sellerBlockedReason: true },
      });
      if (sellerUser?.sellerBlocked) {
        return res.status(403).json({
          error: `Vendedor bloqueado preventivamente para novos lotes e vendas (${
            sellerUser.sellerBlockedReason || 'bloqueio administrativo ativo'
          }).`,
          code: 'SELLER_PREVENTIVELY_BLOCKED',
        });
      }

      if (!receiptFile) {
        return res.status(400).json({ error: 'O comprovante é obrigatório para concluir a venda' });
      }

      const receiptUrl = getUploadedFileUrl(receiptFile);
      if (!receiptUrl) throw { status: 503, message: 'Não foi possível confirmar o armazenamento do comprovante' };

      const sheetPhotoUrl = sheetPhotoFile ? getUploadedFileUrl(sheetPhotoFile) : undefined;

      const result = await finalizeSaleWithReceipt({
        body: req.body,
        sellerId,
        companyId,
        receiptUrl,
        sheetPhotoUrl,
        correlationId,
        callerRole: req.user?.role,
      });

      // Se a venda for reutilizada (repetição idêntica) ou não foi criada agora,
      // remove os novos arquivos recém-enviados para não deixar objetos órfãos.
      if (!result.created || result.sale.receiptUrl !== receiptUrl) {
        await removeUploadedFile(req, receiptFile).catch(() => undefined);
        if (sheetPhotoFile) await removeUploadedFile(req, sheetPhotoFile).catch(() => undefined);
      }

      console.info('[SALES] Venda com comprovante finalizada com sucesso:', {
        correlationId,
        saleId: result.sale.id,
        created: result.created,
      });
      if (result.created) {
        await emitSaleCreationOperationalAudit(req, result.sale, req.body);
      }
      let buyerConfirmationInfo: any = null;
      try {
        const issued = await issueBuyerConfirmationLink({
          saleId: result.sale.id,
          companyId,
        });
        buyerConfirmationInfo = {
          id: issued.confirmation.id,
          confirmationUrl: issued.confirmationUrl,
          qrCodePayload: issued.qrCodePayload,
          status: issued.status,
          statusProgress: issued.statusProgress,
          conditionsVersion: issued.conditionsVersion,
          expiresAt: issued.expiresAt,
          alreadyResponded: Boolean((issued as any).alreadyResponded),
        };
      } catch (confErr) {
        console.warn('[SALES] Falha não-bloqueante ao emitir link de confirmação do comprador:', confErr);
      }
      return res.status(result.created ? 201 : 200).json({
        ...result.sale,
        ...(buyerConfirmationInfo ? { buyerConfirmation: buyerConfirmationInfo } : {}),
      });
    } catch (error: any) {
      if (receiptFile) await removeUploadedFile(req, receiptFile).catch(() => undefined);
      if (sheetPhotoFile) await removeUploadedFile(req, sheetPhotoFile).catch(() => undefined);
      if (error?.status && error?.message) {
        return res.status(error.status).json({
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
        });
      }
      console.error('[SALES] Falha ao concluir venda com comprovante:', {
        correlationId,
        name: error?.name,
        code: error?.code,
        message: error?.message,
        meta: error?.meta,
      });
      return res.status(500).json({ error: 'Não foi possível concluir a venda' });
    }
  }
);

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

    const nextHasCover =
      req.body.hasCover !== undefined || product !== undefined
        ? resolveSaleHasCover(req.body.hasCover ?? existing.hasCover, product !== undefined ? String(product).trim() : existing.product)
        : undefined;

    let updated = await prisma.sale.update({
      where: { id },
      data: {
        ...(parsedValue !== undefined && { value: parsedValue }),
        ...(product !== undefined && { product: String(product).trim() }),
        ...(nextHasCover !== undefined && { hasCover: nextHasCover }),
        ...(status !== undefined && { status: status as string }),
        ...(paymentStatus !== undefined && { paymentStatus: paymentStatus as string }),
        ...(fichaNumber !== undefined && { fichaNumber: String(fichaNumber).trim() }),
        ...(paymentMethod !== undefined && { paymentMethod: paymentMethod as string }),
      }
    });

    try {
      const ref =
        updated.fichaNumber ||
        existing.fichaNumber ||
        `VND-${String(updated.id).slice(0, 8).toUpperCase()}`;
      const editReason =
        req.body.reason || req.body.justification || 'Atualização administrativa de venda';
      const authorName = req.user?.name || 'Operador';
      const authorRole = req.user?.role || null;
      const ipAddress = (req.ip || req.socket?.remoteAddress || null) as string | null;

      if (parsedValue !== undefined && Math.abs(parsedValue - existing.value) >= 0.005) {
        const isReductionAfterConfirm =
          parsedValue < existing.value && existing.status !== 'PENDING_RECEIPT';
        await recordOperationalAuditEvent({
          companyId,
          category: 'PRICE',
          action: 'SALE_VALUE_UPDATED',
          entityType: 'SALE',
          entityReference: ref,
          entityId: updated.id,
          previousValues: { value: existing.value, status: existing.status },
          newValues: { value: updated.value, status: updated.status },
          reason: editReason,
          authorUserId: req.user?.id || null,
          authorName,
          authorRole,
          ipAddress,
          reviewAlert: isReductionAfterConfirm
            ? {
                alertType: 'POST_SALE_VALUE_REDUCTION',
                severity: 'ATTENTION',
                summary:
                  'Redução de valor comercial após registro encaminhada para conferência administrativa.',
                details: {
                  previousValue: existing.value,
                  newValue: updated.value,
                },
              }
            : null,
        });
      }

      if (req.body.discountAmount !== undefined || req.body.discountPercentage !== undefined) {
        const dAmt = Number(req.body.discountAmount || 0);
        const dPct = Number(req.body.discountPercentage || 0);
        await recordOperationalAuditEvent({
          companyId,
          category: 'DISCOUNT',
          action: 'SALE_DISCOUNT_UPDATED',
          entityType: 'SALE',
          entityReference: ref,
          entityId: updated.id,
          previousValues: { value: existing.value },
          newValues: {
            value: updated.value,
            discountAmount: dAmt,
            discountPercentage: dPct,
          },
          reason: editReason,
          authorUserId: req.user?.id || null,
          authorName,
          authorRole,
          ipAddress,
          reviewAlert:
            dPct >= 15 || (existing.value > 0 && dAmt / existing.value >= 0.15)
              ? {
                  alertType: 'DECLARED_DISCOUNT_REVIEW',
                  severity: 'ATTENTION',
                  summary:
                    'Desconto comercial pós-registro encaminhado para conferência administrativa.',
                  details: { discountAmount: dAmt, discountPercentage: dPct },
                }
              : null,
        });
      }

      if (paymentMethod !== undefined && paymentMethod !== existing.paymentMethod) {
        await recordOperationalAuditEvent({
          companyId,
          category: 'CONDITIONS',
          action: 'SALE_PAYMENT_CONDITION_UPDATED',
          entityType: 'SALE',
          entityReference: ref,
          entityId: updated.id,
          previousValues: { paymentMethod: existing.paymentMethod },
          newValues: { paymentMethod: updated.paymentMethod },
          reason: editReason,
          authorUserId: req.user?.id || null,
          authorName,
          authorRole,
          ipAddress,
        });
      }

      const valueChanged = parsedValue !== undefined && parsedValue !== existing.value;
      const methodChanged = paymentMethod !== undefined && paymentMethod !== existing.paymentMethod;
      if (valueChanged || methodChanged) {
        await invalidateAndReissueConfirmationOnSaleChange({
          saleId: updated.id,
          companyId,
          reason: editReason || 'Condições comerciais ou valor da venda alterados no sistema.',
          authorUserId: req.user?.id || null,
          authorName,
          authorRole,
          ipAddress,
        }).catch((err) =>
          console.warn('[SALES] Falha ao rotacionar confirmação pós-edição:', err)
        );
      }

      const canceledStates = new Set([
        'CANCELED',
        'CANCELLED',
        'RETURNED',
        'VOIDED',
        'ESTORNADA',
        'CANCELADA',
      ]);
      const becameCanceled =
        (status &&
          canceledStates.has(String(status).toUpperCase()) &&
          !canceledStates.has(String(existing.status).toUpperCase())) ||
        (paymentStatus &&
          canceledStates.has(String(paymentStatus).toUpperCase()) &&
          !canceledStates.has(String(existing.paymentStatus).toUpperCase()));

      if (becameCanceled) {
        if (existing.coverDeducted) {
          await prisma.$transaction(async (tx) => {
            await restoreCoverForCanceledSale(tx, {
              saleId: updated.id,
              sellerId: existing.sellerId,
              wasDeducted: existing.coverDeducted,
            });
          });
          updated = { ...updated, coverDeducted: false };
        }

        await recordOperationalAuditEvent({
          companyId,
          category: 'REVERSAL',
          action: 'SALE_CANCELED_OR_RETURNED',
          entityType: 'SALE',
          entityReference: ref,
          entityId: updated.id,
          previousValues: {
            status: existing.status,
            paymentStatus: existing.paymentStatus,
            value: existing.value,
          },
          newValues: {
            status: updated.status,
            paymentStatus: updated.paymentStatus,
            value: updated.value,
          },
          reason: editReason,
          authorUserId: req.user?.id || null,
          authorName,
          authorRole,
          ipAddress,
          reviewAlert: {
            alertType: 'SALE_CANCELLATION_REVIEW',
            severity: 'ATTENTION',
            summary:
              'Cancelamento ou devolução de venda registrado para conferência administrativa.',
            details: { previousStatus: existing.status, newStatus: updated.status, value: existing.value },
          },
        });
      }
    } catch (auditErr) {
      console.warn('[OperationalAudit] Falha não-bloqueante ao auditar atualização de venda:', auditErr);
    }

    res.json(updated);
  } catch (error) {
    console.error('Error updating sale:', error);
    res.status(500).json({ error: 'Failed to update sale' });
  }
});

async function validateSaleReceiptAccess(req: AuthRequest, res: Response, next: NextFunction) {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ error: 'Empresa não identificada' });

  const sale = await prisma.sale.findFirst({
    where: { id: req.params.id as string, companyId },
  });
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  if (sale.sellerId !== req.user?.id && !SALE_MANAGER_ROLES.includes(req.user?.role || '')) {
    return res.status(403).json({ error: 'Access denied to this sale' });
  }
  // Retentativa segura: não recebe outro arquivo se o comprovante já existe.
  if (sale.receiptUrl) return res.json(sale);
  (req as any).validatedSale = sale;
  return next();
}

// Compatibilidade com APKs anteriores: valida a venda antes de enviar ao B2 e
// só então conclui a ficha como vendida.
router.post('/:id/receipt', authenticateToken, validateSaleReceiptAccess, safeUpload(upload.single('receipt')), async (req: AuthRequest, res: any) => {
  try {
    const id = req.params.id as string;
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Receipt photo is required' });
    }

    const receiptUrl = getUploadedFileUrl(req.file);
    const sale = (req as any).validatedSale;
    const updatedSale = await prisma.$transaction(async (tx) => {
      const client = await tx.client.findUnique({ where: { id: sale.clientId } });
      const nextBookStatus =
        client?.bookStatus === 'DISTRIBUTED_REBOLO' || client?.bookStatus === 'IN_STOCK_REBOLO'
          ? 'REBOLO_SOLD'
          : 'SOLD';

      const [receiptOpCfg, receiptSeller] = await Promise.all([
        getCompanyOperationalConfig(companyId, tx as any),
        tx.user.findUnique({
          where: { id: sale.sellerId },
          select: {
            usesOwnCar: true,
            sellerVehicleType: true,
            sellerBookProfile: true,
            salesType: true,
            customVirginCommissionPercent: true,
            customReboloCommissionPercent: true,
            customCreditInstallmentCommissionPercent: true,
          },
        }),
      ]);
      const receiptComm = resolveNewSaleCommission({
        bookStatus: client?.bookStatus,
        operationalConfig: receiptOpCfg,
        sellerOverrides: receiptSeller,
      });
      let updated = await tx.sale.update({
        where: { id },
        data: {
          receiptUrl,
          status: 'PRONTO',
          paymentStatus: 'PAID',
          ...(sale.appliedCommissionPercent == null
            ? { appliedCommissionPercent: receiptComm.percent }
            : {}),
        },
      });
      if (!sale.coverDeducted && updated.hasCover) {
        const deducted = await deductCoverForSellerSale(tx, {
          saleId: updated.id,
          sellerId: sale.sellerId,
          hasCover: updated.hasCover,
        });
        if (deducted) {
          updated = { ...updated, coverDeducted: true };
        }
      }
      await tx.client.update({
        where: { id: sale.clientId },
        data: {
          outcomeStatus: 'SOLD',
          outcomeUpdatedAt: updated.date,
          bookStatus: nextBookStatus,
        },
      });
      return updated;
    });

    res.json(updatedSale);
  } catch (error: any) {
    await removeUploadedFile(req, req.file).catch(() => undefined);
    console.error('Upload receipt error:', { name: error?.name, code: error?.code });
    res.status(500).json({ error: 'Internal server error' });
  }
});

function isTravelNonSaleReason(reason?: string | null): boolean {
  const normalized = String(reason || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  return normalized === 'EM VIAGEM' || normalized === 'EM_VIAGEM';
}

function buildSaoPauloAppointmentDate(dateInput: string, timeInput?: string | null): Date {
  const rawDate = String(dateInput || '').trim();
  const cleanTime = String(timeInput || '').trim();
  const timeMatch = cleanTime.match(/^(\d{1,2}):(\d{2})/);
  const hh = timeMatch ? timeMatch[1].padStart(2, '0') : '08';
  const mm = timeMatch ? timeMatch[2] : '00';

  const dateMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateMatch) {
    const ymd = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    const candidate = new Date(`${ymd}T${hh}:${mm}:00.000-03:00`);
    if (!isNaN(candidate.getTime())) return candidate;
  }

  const parsed = new Date(rawDate);
  if (!isNaN(parsed.getTime())) {
    const br = new Date(parsed.getTime() - 3 * 60 * 60 * 1000);
    const y = br.getUTCFullYear();
    const m = String(br.getUTCMonth() + 1).padStart(2, '0');
    const d = String(br.getUTCDate()).padStart(2, '0');
    return new Date(`${y}-${m}-${d}T${hh}:${mm}:00.000-03:00`);
  }
  return new Date();
}

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

    // Validação estrita: rejeitar terminantemente assinaturas fictícias
    if (
      signatureBase64 === 'fictitious_signature' ||
      (typeof signatureUrl === 'string' && signatureUrl.includes('fictitious_signature'))
    ) {
      return res.status(400).json({
        error: 'Assinatura fictícia rejeitada. A captura da imagem real da assinatura na tela é obrigatória.',
      });
    }

    let finalSigUrl = signatureUrl;
    if (signatureBase64) {
      finalSigUrl = signatureBase64.startsWith('data:')
        ? signatureBase64
        : `data:image/png;base64,${signatureBase64}`;
    }

    // Transação atômica criando a Não-Venda e atualizando o status da ficha
    const result = await prisma.$transaction(async (tx) => {
      // 1. Confirmar cliente e empresa
      const client = await tx.client.findFirst({
        where: {
          id: clientId,
          companyId,
        },
      });

      if (!client) {
        throw { status: 404, message: 'Client not found in your company' };
      }

      if (
        !SALE_MANAGER_ROLES.includes(req.user?.role || '') &&
        client.assignedSellerId &&
        client.assignedSellerId !== sellerId
      ) {
        throw {
          status: 403,
          code: 'WALLET_ACCESS_DENIED',
          message: 'Acesso negado: esta ficha pertence à carteira de outro vendedor.',
        };
      }

      // 2. Confirmar que a cidade não está fechada
      if (client.cityClosedAt) {
        throw { status: 409, message: 'Cidade já foi fechada para esta ficha' };
      }

      // 3. Rejeitar se já estiver vendida
      if (client.outcomeStatus === 'SOLD') {
        throw { status: 409, message: 'Não é possível registrar não-venda para ficha já vendida' };
      }

      const isTravelReason = isTravelNonSaleReason(reason);

      // 4. Idempotência: se já é não-venda aguardando devolução física neste ciclo para o mesmo vendedor
      if (client.outcomeStatus === 'NON_SALE' && client.bookStatus === 'AWAITING_RETURN') {
        const activeNonSale = await tx.nonSale.findFirst({
          where: {
            clientId,
            companyId,
            supersededAt: null,
          },
          orderBy: { date: 'desc' },
        });

        if (activeNonSale && activeNonSale.sellerId === sellerId) {
          return { nonSale: activeNonSale, client, created: false };
        }
      }

      // 5. Superar não-vendas anteriores ativas para esta ficha (evitar duplicidade ativa entre ciclos)
      await tx.nonSale.updateMany({
        where: {
          clientId,
          companyId,
          supersededAt: null,
        },
        data: {
          supersededAt: new Date(),
        },
      });

      // 6. Criar a nova Não-Venda
      const nonSale = await tx.nonSale.create({
        data: {
          clientId,
          sellerId: sellerId as string,
          reason: String(reason).trim(),
          signatureUrl: finalSigUrl,
          cycle: client.commercialCycle || 1,
          companyId,
          sellerRating: req.body.sellerRating !== undefined ? Number(req.body.sellerRating) : null,
          photographerRating: req.body.photographerRating !== undefined ? Number(req.body.photographerRating) : null,
          contactRating: req.body.contactRating !== undefined ? Number(req.body.contactRating) : null,
        },
      });

      // Etapa 21: Tanto não-venda comum quanto "Em Viagem" permanecem com pendência física aberta (AWAITING_RETURN)
      // até serem bipados por QR Code na base (receive-return), evitando baixa antecipada em estoque.
      const targetBookStatus = 'AWAITING_RETURN';

      // 7. Atualizar Client
      const updatedClient = await tx.client.update({
        where: { id: clientId },
        data: {
          outcomeStatus: 'NON_SALE',
          outcomeUpdatedAt: nonSale.date,
          bookStatus: targetBookStatus,
        },
      });

      // 8. Gravar histórico auditável na linha do tempo
      await tx.clientTimeline.create({
        data: {
          clientId,
          cycle: client.commercialCycle || 1,
          previousStatus: client.bookStatus,
          newStatus: targetBookStatus,
          previousSellerId: client.assignedSellerId,
          newSellerId: client.assignedSellerId,
          authorId: sellerId,
          authorRole: req.user?.role,
          action: isTravelReason ? 'NON_SALE_TRAVEL_PENDING_RETURN' : 'NON_SALE',
          reason: isTravelReason
            ? 'Em Viagem — aguardando devolução física na base (sem envio para Rebolo)'
            : String(reason).trim(),
        },
      });

      return { nonSale, client: updatedClient, created: true };
    });

    res.status(result.created ? 201 : 200).json({
      ...result.nonSale,
      bookStatus: result.client.bookStatus,
    });
  } catch (error: any) {
    if (error && error.status && error.message) {
      return res.status(error.status).json({ error: error.message });
    }
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
      where: { companyId, receiptUrl: { not: null } },
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

// Admin Sales History: List sold fichas with client, batch, seller, attachments, ratings
router.get('/history', authenticateToken, async (req: AuthRequest, res: any) => {
  try {
    if (!SALE_MANAGER_ROLES.includes(req.user?.role || '')) {
      return res.status(403).json({ error: 'Acesso restrito a administradores e supervisores' });
    }

    const companyId = req.user?.companyId;
    if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    const { startDate, endDate, search, sellerId, city, batchId, paymentMethod } = req.query as {
      startDate?: string;
      endDate?: string;
      search?: string;
      sellerId?: string;
      city?: string;
      batchId?: string;
      paymentMethod?: string;
    };

    const where: any = {
      ...(companyId ? { companyId } : {}),
    };

    // Filtro de vendedor
    if (sellerId && typeof sellerId === 'string' && sellerId.trim()) {
      where.sellerId = sellerId.trim();
    }

    // Filtro de cidade (na venda ou no cliente)
    if (city && typeof city === 'string' && city.trim()) {
      const cityQuery = city.trim();
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { city: { contains: cityQuery, mode: 'insensitive' } },
            { client: { city: { contains: cityQuery, mode: 'insensitive' } } },
          ],
        },
      ];
    }

    // Filtro de lote
    if (batchId && typeof batchId === 'string' && batchId.trim()) {
      where.client = {
        ...(where.client || {}),
        batchId: batchId.trim(),
      };
    }

    // Filtro de forma de pagamento
    if (paymentMethod && typeof paymentMethod === 'string' && paymentMethod.trim()) {
      const pm = paymentMethod.trim();
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { method: { equals: pm, mode: 'insensitive' } },
            { payments: { some: { method: { equals: pm, mode: 'insensitive' } } } },
          ],
        },
      ];
    }

    // Filtro de busca geral (código da ficha, responsável, criança)
    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim();
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { fichaNumber: { contains: q, mode: 'insensitive' } },
            { client: { name: { contains: q, mode: 'insensitive' } } },
            { client: { sequenceNumber: { contains: q, mode: 'insensitive' } } },
            { client: { visibleCode: { contains: q, mode: 'insensitive' } } },
            { client: { children: { some: { name: { contains: q, mode: 'insensitive' } } } } },
          ],
        },
      ];
    }

    // Validação de período com cobertura até 23:59:59.999 do dia útil no fuso da operação
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (startDate) {
      const match = String(startDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        dateFilter.gte = new Date(`${String(startDate).slice(0, 10)}T00:00:00.000-03:00`);
      } else {
        const dStart = new Date(startDate);
        if (!isNaN(dStart.getTime())) {
          dStart.setHours(0, 0, 0, 0);
          dateFilter.gte = dStart;
        }
      }
    }
    if (endDate) {
      const match = String(endDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        dateFilter.lte = new Date(`${String(endDate).slice(0, 10)}T23:59:59.999-03:00`);
      } else {
        const dEnd = new Date(endDate);
        if (!isNaN(dEnd.getTime())) {
          dEnd.setHours(23, 59, 59, 999);
          dateFilter.lte = dEnd;
        }
      }
    }
    if (Object.keys(dateFilter).length > 0) {
      where.date = dateFilter;
    }

    const sales = await prisma.sale.findMany({
      where,
      include: {
        client: {
          include: {
            batch: { select: { id: true, name: true } },
            photographer: { select: { id: true, name: true } },
            assignedSeller: { select: { id: true, name: true } },
            timeline: { orderBy: { timestamp: 'asc' } },
            appointments: true,
            children: true,
          },
        },
        seller: {
          select: { id: true, name: true },
        },
        payments: true,
        adjustments: {
          orderBy: { createdAt: 'desc' },
        },
        creditAgreement: {
          include: {
            installments: {
              orderBy: { installmentNumber: 'asc' },
            },
          },
        },
      },
      orderBy: { date: 'desc' },
    });

    const enrichedSales = sales.map((s) => ({
      ...s,
      netValue: Number((getSaleNetCents(s) / 100).toFixed(2)),
    }));

    res.json(enrichedSales);
  } catch (error) {
    console.error('Get sales history error:', error);
    res.status(500).json({ error: 'Erro ao carregar histórico de vendas' });
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

    const cleanTime = String(time).trim();
    const resolvedDate = buildSaoPauloAppointmentDate(String(date), cleanTime);

    const appointment = await prisma.appointment.create({
      data: {
        clientId,
        responsibleId,
        date: resolvedDate,
        time: cleanTime,
        observation: observation ? String(observation).trim() : null,
      },
    });

    const brClock = new Date(resolvedDate.getTime() - 3 * 60 * 60 * 1000);
    const brDate = `${brClock.getUTCFullYear()}-${String(brClock.getUTCMonth() + 1).padStart(2, '0')}-${String(
      brClock.getUTCDate()
    ).padStart(2, '0')}`;

    res.status(201).json({
      ...appointment,
      brDate,
      brTime: cleanTime,
      dateTime: resolvedDate.toISOString(),
    });
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

// =======================================================================
// CONFERÊNCIA INDEPENDENTE DE COMPRA PELO CLIENTE (QR CODE / LINK PÚBLICO)
// =======================================================================

// Obter dados mínimos públicos para preenchimento no celular do comprador (sem valores do vendedor)
router.get('/public/prompt/:token', async (req, res: any) => {
  try {
    const prompt = await getPublicBuyerConfirmationPrompt(req.params.token);
    res.json(prompt);
  } catch (err: any) {
    const safeErr = sanitizePublicBuyerConfirmationError(err);
    res.status(safeErr.status).json({
      error: safeErr.message,
      code: safeErr.code,
    });
  }
});

// Envio da resposta de conferência pelo cliente
router.post('/public/confirm/:token', async (req, res: any) => {
  try {
    const result = await submitPublicBuyerConfirmation({
      rawToken: req.params.token,
      ...req.body,
      deviceFingerprint: req.body.deviceFingerprint || req.body.fingerprint,
      ipAddress: (req.ip || req.socket?.remoteAddress || null) as string | null,
      userAgent: req.get('user-agent') || null,
      acceptLanguage: req.get('accept-language') || null,
    });
    res.json(result);
  } catch (err: any) {
    const safeErr = sanitizePublicBuyerConfirmationError(err);
    res.status(safeErr.status).json({
      error: safeErr.message,
      code: safeErr.code,
    });
  }
});

// Listagem e revisão de conferências para o Admin da própria empresa (com agrupamento por vendedor ou lote)
router.get('/buyer-confirmations/review', authenticateToken, async (req: AuthRequest, res: any) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ error: 'Empresa não identificada' });

  const isManager = SALE_MANAGER_ROLES.includes(req.user?.role || '');
  if (!isManager) {
    return res.status(403).json({ error: 'Acesso restrito à administração da empresa' });
  }

  const { status, batchId, sellerId, hasDivergence, isSkipped, groupBy, todayOnly, date } = req.query as Record<string, string | undefined>;

  try {
    const andConditions: Prisma.BuyerPurchaseConfirmationWhereInput[] = [{ companyId }];
    const whereClause: Prisma.BuyerPurchaseConfirmationWhereInput = {
      AND: andConditions,
    };

    if (todayOnly === 'true' || (date && date.trim())) {
      let brYmd: string;
      const m = String(date || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) {
        brYmd = `${m[1]}-${m[2]}-${m[3]}`;
      } else {
        const brNow = new Date(Date.now() - 3 * 60 * 60 * 1000);
        brYmd = `${brNow.getUTCFullYear()}-${String(brNow.getUTCMonth() + 1).padStart(2, '0')}-${String(brNow.getUTCDate()).padStart(2, '0')}`;
      }
      const dayStart = new Date(`${brYmd}T00:00:00.000-03:00`);
      const dayEnd = new Date(`${brYmd}T23:59:59.999-03:00`);
      andConditions.push({
        OR: [
          { usedAt: { gte: dayStart, lte: dayEnd } },
          { createdAt: { gte: dayStart, lte: dayEnd } },
        ],
      });
    }

    if (status) {
      const upperStatus = String(status).trim().toUpperCase();
      if (upperStatus === 'DIVERGENT') {
        whereClause.hasDivergence = true;
      } else {
        whereClause.status = upperStatus;
      }
    }
    if (hasDivergence !== undefined) {
      whereClause.hasDivergence = hasDivergence === 'true';
    }
    if (isSkipped !== undefined) {
      whereClause.isSkipped = isSkipped === 'true';
    }
    if (sellerId) {
      whereClause.sellerId = sellerId;
    }
    if (batchId) {
      andConditions.push({
        OR: [
          { operationalBatchId: batchId },
          { sale: { client: { batchId } } },
        ],
      });
    }

    const records = await prisma.buyerPurchaseConfirmation.findMany({
      where: whereClause,
      include: {
        sale: {
          include: {
            client: {
              include: {
                photographer: {
                  select: { id: true, name: true },
                },
                batch: {
                  include: {
                    photographer: {
                      select: { id: true, name: true },
                    },
                  },
                },
              },
            },
            seller: {
              select: { id: true, name: true, sellerBlocked: true, sellerBlockedReason: true },
            },
          },
        },
      },
      orderBy: [{ conditionsVersion: 'desc' }, { createdAt: 'desc' }],
    });

    // Priorizar por saleId: resposta do comprador (UNDER_REVIEW / CONFIRMED) ou divergência
    // nunca pode ser ocultada por duplicata PENDING/INVALIDATED mais recente do mesmo saleId.
    const statusPriority = (rec: any): number => {
      if (rec.hasDivergence && (rec.status === 'UNDER_REVIEW' || rec.usedAt)) return 5;
      if (rec.hasDivergence) return 4;
      if (rec.status === 'CONFIRMED' || rec.status === 'UNDER_REVIEW') return 3;
      if (rec.status === 'PENDING') return 2;
      if (rec.status === 'EXPIRED') return 1;
      return 0;
    };

    const dedupBySale = new Map<string, (typeof records)[0]>();
    for (const rec of records) {
      const prev = dedupBySale.get(rec.saleId);
      if (!prev) {
        dedupBySale.set(rec.saleId, rec);
        continue;
      }
      const prevScore = statusPriority(prev);
      const currScore = statusPriority(rec);
      if (currScore > prevScore) {
        dedupBySale.set(rec.saleId, rec);
      }
    }
    const effectiveRecords = Array.from(dedupBySale.values()).sort((a, b) => {
      const aDiv = a.hasDivergence ? 1 : 0;
      const bDiv = b.hasDivergence ? 1 : 0;
      if (aDiv !== bDiv) return bDiv - aDiv;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const formattedList = effectiveRecords.map((rec) =>
      formatBuyerConfirmationForRole(
        rec,
        true,
        undefined,
        rec.sale?.client?.batch
      )
    );

    const ratingsAll = formattedList
      .map((i: any) => i.serviceRating)
      .filter((r: any) => typeof r === 'number' && r >= 1 && r <= 5) as number[];
    const contactRatingsAll = formattedList
      .map((i: any) => i.contactRating)
      .filter((r: any) => typeof r === 'number' && r >= 1 && r <= 5) as number[];
    const photographerRatingsAll = formattedList
      .map((i: any) => i.photographerRating)
      .filter((r: any) => typeof r === 'number' && r >= 1 && r <= 5) as number[];
    const avgOf = (arr: number[]) =>
      arr.length > 0 ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)) : null;

    const overallSummary = {
      total: formattedList.length,
      divergentCount: formattedList.filter((i: any) => i.hasDivergence === true).length,
      confirmedCount: formattedList.filter((i: any) => i.status === 'CONFIRMED').length,
      pendingCount: formattedList.filter((i: any) => i.status === 'PENDING').length,
      skippedCount: formattedList.filter((i: any) => i.isSkipped === true).length,
      ratedCount: ratingsAll.length,
      averageRating: avgOf(ratingsAll),
      contactRatedCount: contactRatingsAll.length,
      contactAverageRating: avgOf(contactRatingsAll),
      photographerRatedCount: photographerRatingsAll.length,
      photographerAverageRating: avgOf(photographerRatingsAll),
    };

    if (groupBy === 'seller') {
      const sellerMap: Record<
        string,
        {
          seller: {
            sellerId: string;
            sellerName: string;
            sellerBlocked: boolean;
            sellerBlockedReason: string | null;
            totalCount: number;
            divergentCount: number;
            confirmedCount: number;
            pendingCount: number;
            skippedCount: number;
            ratedCount: number;
            averageRating: number | null;
          };
          confirmations: any[];
          _ratings: number[];
        }
      > = {};

      for (const item of formattedList as any[]) {
        const sId = String(item.sellerId || 'SEM_VENDEDOR');
        if (!sellerMap[sId]) {
          sellerMap[sId] = {
            seller: {
              sellerId: sId,
              sellerName: item.sellerName || 'Vendedor não identificado',
              sellerBlocked: Boolean(item.sellerBlocked),
              sellerBlockedReason: item.sellerBlockedReason || null,
              totalCount: 0,
              divergentCount: 0,
              confirmedCount: 0,
              pendingCount: 0,
              skippedCount: 0,
              ratedCount: 0,
              averageRating: null,
            },
            confirmations: [],
            _ratings: [],
          };
        }
        const entry = sellerMap[sId];
        entry.confirmations.push(item);
        entry.seller.totalCount += 1;
        if (item.hasDivergence === true) entry.seller.divergentCount += 1;
        if (item.status === 'CONFIRMED') entry.seller.confirmedCount += 1;
        if (item.status === 'PENDING') entry.seller.pendingCount += 1;
        if (item.isSkipped === true) entry.seller.skippedCount += 1;
        if (typeof item.serviceRating === 'number' && item.serviceRating >= 1 && item.serviceRating <= 5) {
          entry._ratings.push(item.serviceRating);
        }
      }

      const sellerGroups = Object.values(sellerMap)
        .map(({ seller, confirmations, _ratings }) => {
          seller.ratedCount = _ratings.length;
          seller.averageRating =
            _ratings.length > 0
              ? Number((_ratings.reduce((a, b) => a + b, 0) / _ratings.length).toFixed(1))
              : null;
          return { seller, confirmations };
        })
        .sort((a, b) => {
          if (b.seller.divergentCount !== a.seller.divergentCount) {
            return b.seller.divergentCount - a.seller.divergentCount;
          }
          return a.seller.sellerName.localeCompare(b.seller.sellerName);
        });

      return res.json({
        total: formattedList.length,
        summary: overallSummary,
        sellerGroups,
        groups: sellerGroups,
      });
    }

    if (groupBy === 'batch') {
      const groupsMap: Record<string, { batch: any; confirmations: any[] }> = {};
      for (const item of formattedList) {
        const opBatch = (item as any).operationalBatch;
        const bId = opBatch?.batchId || 'SEM_LOTE';
        if (!groupsMap[bId]) {
          groupsMap[bId] = {
            batch: opBatch || {
              batchId: null,
              batchName: 'Sem lote associado',
              city: null,
            },
            confirmations: [],
          };
        }
        groupsMap[bId].confirmations.push(item);
      }
      return res.json({
        total: formattedList.length,
        summary: overallSummary,
        groups: Object.values(groupsMap),
      });
    }

    res.json({
      total: formattedList.length,
      summary: overallSummary,
      confirmations: formattedList,
    });
  } catch (error: any) {
    console.error('[SALES] Erro ao listar revisões de conferência:', error);
    res.status(500).json({ error: 'Erro ao listar conferências' });
  }
});

// Consulta do status da conferência de uma venda específica
// (Vendedor vê apenas progressão: "Aguardando cliente", "Resposta recebida"; Admin vê tudo)
router.get('/:id/buyer-confirmation', authenticateToken, async (req: AuthRequest, res: any) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ error: 'Empresa não identificada' });

  const saleId = req.params.id as string;
  try {
    const sale = await prisma.sale.findFirst({
      where: { id: saleId, companyId },
      include: {
        seller: {
          select: { id: true, name: true, sellerBlocked: true, sellerBlockedReason: true },
        },
        client: {
          include: {
            batch: {
              include: {
                photographer: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!sale) {
      return res.status(404).json({ error: 'Venda não encontrada' });
    }

    const isManager = SALE_MANAGER_ROLES.includes(req.user?.role || '');
    if (!isManager && sale.sellerId !== req.user?.id) {
      return res.status(403).json({ error: 'Acesso negado a esta venda' });
    }

    const records = await prisma.buyerPurchaseConfirmation.findMany({
      where: { saleId: sale.id, companyId },
      include: {
        sale: {
          include: {
            seller: {
              select: { id: true, name: true, sellerBlocked: true, sellerBlockedReason: true },
            },
            client: {
              select: { id: true, name: true, visibleCode: true, sequenceNumber: true },
            },
          },
        },
      },
      orderBy: [{ conditionsVersion: 'desc' }, { createdAt: 'desc' }],
    });

    if (records.length === 0) {
      return res.status(404).json({ error: 'Nenhuma conferência encontrada para esta venda' });
    }

    const prioritized = [...records].sort((a, b) => {
      const rank = (r: any) =>
        r.hasDivergence && (r.status === 'UNDER_REVIEW' || r.usedAt)
          ? 5
          : r.hasDivergence
          ? 4
          : r.status === 'CONFIRMED' || r.status === 'UNDER_REVIEW'
          ? 3
          : r.status === 'PENDING'
          ? 2
          : 1;
      const diff = rank(b) - rank(a);
      if (diff !== 0) return diff;
      if (b.conditionsVersion !== a.conditionsVersion) {
        return b.conditionsVersion - a.conditionsVersion;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const latest = prioritized[0];
    const formatted = formatBuyerConfirmationForRole(
      latest,
      isManager,
      isManager ? prioritized.slice(1) : undefined,
      isManager ? sale.client?.batch : undefined
    );

    res.json(formatted);
  } catch (error: any) {
    console.error('[SALES] Erro ao buscar conferência da venda:', error);
    res.status(500).json({ error: 'Erro ao buscar conferência' });
  }
});

// Vendedor ou Admin gera/reabre QR Code de conferência para venda ainda não respondida pelo cliente
router.post('/:id/buyer-confirmation/reissue', authenticateToken, async (req: AuthRequest, res: any) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ error: 'Empresa não identificada' });

  const saleId = req.params.id as string;
  try {
    const sale = await prisma.sale.findFirst({
      where: { id: saleId, companyId },
    });

    if (!sale) {
      return res.status(404).json({ error: 'Venda não encontrada' });
    }

    const isManager = SALE_MANAGER_ROLES.includes(req.user?.role || '');
    if (!isManager && sale.sellerId !== req.user?.id) {
      return res.status(403).json({ error: 'Acesso negado a esta venda' });
    }

    const issued = await issueBuyerConfirmationLink({
      saleId: sale.id,
      companyId,
    });

    if ((issued as any).alreadyResponded) {
      return res.json({
        alreadyResponded: true,
        id: issued.confirmation.id,
        status: issued.status,
        statusLabel: issued.statusLabel,
        statusProgress: issued.statusProgress,
        conditionsVersion: issued.conditionsVersion,
        message: 'Esta venda já possui confirmação respondida pelo cliente.',
      });
    }

    return res.json({
      alreadyResponded: false,
      id: issued.confirmation.id,
      confirmationUrl: issued.confirmationUrl,
      qrCodePayload: issued.qrCodePayload,
      status: issued.status,
      statusLabel: issued.statusLabel,
      statusProgress: issued.statusProgress,
      conditionsVersion: issued.conditionsVersion,
      expiresAt: issued.expiresAt,
    });
  } catch (error: any) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('[SALES] Erro ao gerar/reabrir QR de conferência:', error);
    return res.status(500).json({ error: 'Erro ao gerar QR Code de conferência' });
  }
});

// Vendedor pula a apresentação do QR code no momento da venda (cliente recusou / sem sinal)
router.post('/:id/buyer-confirmation/skip', authenticateToken, async (req: AuthRequest, res: any) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ error: 'Empresa não identificada' });

  const saleId = req.params.id as string;
  try {
    const sale = await prisma.sale.findFirst({
      where: { id: saleId, companyId },
    });

    if (!sale) {
      return res.status(404).json({ error: 'Venda não encontrada' });
    }

    const isManager = SALE_MANAGER_ROLES.includes(req.user?.role || '');
    if (!isManager && sale.sellerId !== req.user?.id) {
      return res.status(403).json({ error: 'Acesso negado a esta venda' });
    }

    const result = await recordBuyerConfirmationSkipped({
      saleId: sale.id,
      companyId,
      reason: req.body.reason || 'CLIENT_REFUSED',
      notes: req.body.notes,
      sellerUserId: req.user?.id || sale.sellerId,
      sellerName: req.user?.name || 'Vendedor',
      ipAddress: (req.ip || req.socket?.remoteAddress || null) as string | null,
    });

    res.json(result);
  } catch (error: any) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('[SALES] Erro ao registrar pulo de convite:', error);
    res.status(500).json({ error: 'Erro ao registrar convite pulado' });
  }
});

// Conclusão e justificativa da revisão pelo Admin da própria empresa
router.post('/:id/buyer-confirmation/resolve', authenticateToken, async (req: AuthRequest, res: any) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ error: 'Empresa não identificada' });

  const isManager = SALE_MANAGER_ROLES.includes(req.user?.role || '');
  if (!isManager) {
    return res.status(403).json({ error: 'Acesso restrito à administração da empresa' });
  }

  const saleId = req.params.id as string;
  const resolutionNotes = req.body.resolutionNotes || req.body.justification;

  try {
    const sale = await prisma.sale.findFirst({
      where: { id: saleId, companyId },
    });

    if (!sale) {
      return res.status(404).json({ error: 'Venda não encontrada' });
    }

    const updated = await resolveBuyerConfirmationReview({
      saleId: sale.id,
      companyId,
      adminUserId: req.user?.id!,
      adminUserName: req.user?.name || 'Administrador',
      adminRole: req.user?.role || 'ADMIN',
      resolutionNotes,
      action: req.body.action,
      divergenceDeductionCents: req.body.divergenceDeductionCents,
      sellerBlocked: req.body.sellerBlocked,
      sellerBlockedReason: req.body.sellerBlockedReason,
      ipAddress: (req.ip || req.socket?.remoteAddress || null) as string | null,
    });

    res.json({
      success: true,
      message: 'Revisão concluída com sucesso',
      confirmation: updated,
      ...updated,
      commissionDeductedBrl: updated.commissionDeductedCents
        ? updated.commissionDeductedCents / 100
        : null,
      auditedReferenceBrl: updated.auditedReferenceCents
        ? updated.auditedReferenceCents / 100
        : null,
    });
  } catch (error: any) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('[SALES] Erro ao concluir revisão da conferência:', error);
    res.status(500).json({ error: 'Erro ao concluir revisão' });
  }
});

// Roles com permissão exclusiva para Cancelamento, Estorno ou Desconto com Devolução (Admin exclusivo; bloqueia vendedor/fotógrafo)
const ADMIN_REFUND_ROLES = new Set(['ADMIN', 'COMPANY_ADMIN', 'SUPER_ADMIN', 'SUPERVISOR']);

function getSaoPauloYmd(date: Date = new Date()): string {
  const br = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  return br.toISOString().slice(0, 10);
}

// GET /api/sales/:id/adjustments — Lista os ajustes/estornos/cancelamentos de uma venda
router.get('/:id/adjustments', authenticateToken, async (req: AuthRequest, res: any) => {
  try {
    const roleUpper = String(req.user?.role || '').toUpperCase();
    if (!ADMIN_REFUND_ROLES.has(roleUpper)) {
      return res.status(403).json({
        error: 'Acesso restrito a administradores para consulta de estornos/cancelamentos.',
      });
    }

    const saleId = String(req.params.id || '').trim();
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId && roleUpper !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    const sale = await prisma.sale.findFirst({
      where: {
        id: saleId,
        ...(roleUpper !== 'SUPER_ADMIN' ? { companyId: userCompanyId } : {}),
      },
      include: {
        adjustments: {
          orderBy: { createdAt: 'desc' },
          include: {
            sellerAdvanceEntry: {
              select: {
                id: true,
                direction: true,
                category: true,
                amountCents: true,
                closingReference: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    if (!sale) {
      return res.status(404).json({ error: 'Venda não encontrada na sua empresa' });
    }

    const originalCents = Math.max(0, Math.round(Number(sale.value || 0) * 100));
    const refundedCents = Math.max(0, sale.refundedAmountCents || 0);
    const netCents = isSaleCancelled(sale) ? 0 : Math.max(0, originalCents - refundedCents);

    return res.json({
      saleId: sale.id,
      saleStatus: sale.saleStatus,
      originalAmountCents: originalCents,
      refundedAmountCents: refundedCents,
      netAmountCents: netCents,
      cancelledAt: sale.cancelledAt,
      cancelReason: sale.cancelReason,
      adjustments: sale.adjustments,
    });
  } catch (error) {
    console.error('[SALES] Erro ao listar ajustes da venda:', error);
    return res.status(500).json({ error: 'Erro ao carregar histórico de estornos da venda' });
  }
});

// POST /api/sales/:id/refund-or-cancel — Cancelamento Total, Estorno ou Desconto com Devolução (Exclusivo Admin)
router.post('/:id/refund-or-cancel', authenticateToken, async (req: AuthRequest, res: any) => {
  try {
    const roleUpper = String(req.user?.role || '').toUpperCase();
    if (!ADMIN_REFUND_ROLES.has(roleUpper)) {
      return res.status(403).json({
        error: 'Ação exclusiva de administradores. Vendedores e fotógrafos não podem estornar ou cancelar vendas.',
      });
    }

    const userCompanyId = req.user?.companyId;
    if (!userCompanyId && roleUpper !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    const saleId = String(req.params.id || '').trim();
    const rawType = String(req.body?.type || '').trim().toUpperCase();
    const normalizedType =
      rawType === 'FULL_CANCELLATION' || rawType === 'FULL' || rawType === 'CANCEL'
        ? 'FULL_CANCELLATION'
        : rawType === 'PARTIAL_REFUND_DISCOUNT' || rawType === 'PARTIAL' || rawType === 'DISCOUNT'
          ? 'PARTIAL_REFUND_DISCOUNT'
          : '';

    if (!normalizedType) {
      return res.status(400).json({
        error: 'Tipo inválido. Use FULL_CANCELLATION ou PARTIAL_REFUND_DISCOUNT.',
      });
    }

    const cleanReason = String(req.body?.reason || '').trim();
    if (cleanReason.length < 3) {
      return res.status(400).json({
        error: 'Informe uma justificativa com pelo menos 3 caracteres.',
      });
    }

    const cleanReceiptUrl =
      typeof req.body?.receiptUrl === 'string' && req.body.receiptUrl.trim()
        ? req.body.receiptUrl.trim()
        : null;

    let requestedAmountCents: number | null = null;
    if (req.body?.amountCents !== undefined && req.body?.amountCents !== null && req.body?.amountCents !== '') {
      const parsedCents = Math.round(Number(req.body.amountCents));
      if (!Number.isFinite(parsedCents) || parsedCents <= 0) {
        return res.status(400).json({ error: 'amountCents deve ser um inteiro positivo em centavos.' });
      }
      requestedAmountCents = parsedCents;
    } else if (req.body?.amount !== undefined && req.body?.amount !== null && req.body?.amount !== '') {
      const parsedBrl = Number(String(req.body.amount).replace(',', '.'));
      if (!Number.isFinite(parsedBrl) || parsedBrl <= 0) {
        return res.status(400).json({ error: 'O valor do estorno/desconto deve ser maior que zero.' });
      }
      requestedAmountCents = Math.round(parsedBrl * 100);
    }

    if (normalizedType === 'PARTIAL_REFUND_DISCOUNT' && (requestedAmountCents === null || requestedAmountCents <= 0)) {
      return res.status(400).json({
        error: 'Informe o valor do desconto/estorno parcial (amount ou amountCents).',
      });
    }

    const actorId = req.user?.id!;
    const actorName = req.user?.name || 'Administrador';
    const ipAddress = (req.ip || req.socket?.remoteAddress || null) as string | null;

    const txResult = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Sale" WHERE "id" = ${saleId} FOR UPDATE`;

        const sale = await tx.sale.findUnique({
          where: { id: saleId },
          include: {
            client: true,
            seller: {
              select: { id: true, name: true, usesOwnCar: true, companyId: true },
            },
            creditAgreement: {
              include: {
                installments: { orderBy: { installmentNumber: 'asc' } },
                commissions: { where: { isReversed: false } },
              },
            },
            platformStatementItem: true,
            adjustments: { orderBy: { createdAt: 'desc' } },
          },
        });

        if (!sale) {
          throw { status: 404, message: 'Venda não encontrada.' };
        }
        if (roleUpper !== 'SUPER_ADMIN' && sale.companyId !== userCompanyId) {
          throw { status: 403, message: 'Venda não pertence à sua empresa.' };
        }

        const effectiveCompanyId = sale.companyId || userCompanyId!;
        if (isSaleCancelled(sale)) {
          throw { status: 409, message: 'Esta venda já se encontra totalmente cancelada.' };
        }

        const originalCents = Math.max(0, Math.round(Number(sale.value || 0) * 100));
        const alreadyRefundedCents = Math.max(0, sale.refundedAmountCents || 0);
        const remainingNetCents = Math.max(0, originalCents - alreadyRefundedCents);

        if (remainingNetCents <= 0) {
          throw { status: 409, message: 'Saldo líquido da venda já é zero.' };
        }

        const effectiveAmountCents =
          normalizedType === 'FULL_CANCELLATION' ? remainingNetCents : requestedAmountCents!;

        if (effectiveAmountCents <= 0) {
          throw { status: 400, message: 'Valor de estorno deve ser maior que zero.' };
        }
        if (effectiveAmountCents > remainingNetCents) {
          throw {
            status: 400,
            message: `Valor de estorno (R$ ${(effectiveAmountCents / 100).toFixed(2)}) excede o saldo líquido restante da venda (R$ ${(remainingNetCents / 100).toFixed(2)}).`,
          };
        }

        const newRefundedAmountCents = alreadyRefundedCents + effectiveAmountCents;
        const newRemainingNetCents = Math.max(0, originalCents - newRefundedAmountCents);
        const becomesFullyCancelled =
          normalizedType === 'FULL_CANCELLATION' || newRemainingNetCents <= 0;
        const newSaleStatus = becomesFullyCancelled ? 'CANCELLED' : 'PARTIALLY_REFUNDED';
        const now = new Date();

        // Cálculo proporcional da comissão do vendedor a estornar (preserva snapshot histórico)
        const refundOpCfg = await getCompanyOperationalConfig(effectiveCompanyId, tx);
        const sellerRate = resolveHistoricalSaleCommissionRate({
          sale,
          operationalConfig: refundOpCfg,
        });
        const installmentRate =
          sale.creditAgreement?.installmentCommissionRate ??
          Number((refundOpCfg.creditInstallmentCommissionPercent / 100).toFixed(4));
        const alreadyDebitedCommCents = (sale.adjustments || []).reduce(
          (acc, adj) => acc + Math.max(0, adj.commissionDebitCents || 0),
          0
        );

        let commissionDebitCents = 0;
        let paidInstallmentRefundCents = 0;

        if (!sale.creditAgreement || sale.creditAgreement.status === 'CANCELLED') {
          const maxTotalCommCents = Math.round(originalCents * sellerRate);
          const remainingCommPool = Math.max(0, maxTotalCommCents - alreadyDebitedCommCents);
          commissionDebitCents = becomesFullyCancelled
            ? remainingCommPool
            : Math.min(remainingCommPool, Math.round(effectiveAmountCents * sellerRate));
        } else {
          const agr = sale.creditAgreement;
          const openInstallments = (agr.installments || []).filter((inst) =>
            ['PENDING', 'PARTIALLY_PAID'].includes(String(inst.status || '').toUpperCase())
          );
          const unpaidInstallmentsCents = openInstallments.reduce(
            (acc, inst) => acc + Math.max(0, inst.amountCents - inst.paidCents),
            0
          );

          // Primeiro abate parcelas futuras não pagas (que não geraram comissão paga).
          const excessOverUnpaidCents = Math.max(0, effectiveAmountCents - unpaidInstallmentsCents);
          const paidInstPrincipalCents = Math.max(0, agr.paidPrincipalCents || 0);
          paidInstallmentRefundCents = Math.min(excessOverUnpaidCents, paidInstPrincipalCents);
          const downPaymentRefundCents = Math.max(0, excessOverUnpaidCents - paidInstallmentRefundCents);

          const rawDebitCents =
            Math.round(paidInstallmentRefundCents * installmentRate) +
            Math.round(downPaymentRefundCents * sellerRate);
          commissionDebitCents = Math.max(0, rawDebitCents);

          if (becomesFullyCancelled) {
            if (openInstallments.length > 0) {
              await tx.creditInstallment.updateMany({
                where: {
                  id: { in: openInstallments.map((i) => i.id) },
                },
                data: { status: 'CANCELLED' },
              });
            }
            const noteLine = `[Cancelamento Admin ${getSaoPauloYmd(now)} por ${actorName}]: ${cleanReason}`;
            await tx.creditAgreement.update({
              where: { id: agr.id },
              data: {
                status: 'CANCELLED',
                remainingPrincipalCents: 0,
                remainingChargesCents: 0,
                notes: agr.notes ? `${agr.notes}\n${noteLine}` : noteLine,
              },
            });
          } else {
            // Desconto/estorno parcial em venda no crediário: abate primeiro das parcelas finais em aberto
            let toReduceCents = Math.min(effectiveAmountCents, unpaidInstallmentsCents);
            const descInstallments = [...openInstallments].sort(
              (a, b) => b.installmentNumber - a.installmentNumber
            );
            for (const inst of descInstallments) {
              if (toReduceCents <= 0) break;
              const unpaidHere = Math.max(0, inst.amountCents - inst.paidCents);
              if (unpaidHere <= 0) continue;
              const cutHere = Math.min(toReduceCents, unpaidHere);
              const nextAmt = Math.max(inst.paidCents, inst.amountCents - cutHere);
              const nextPrincipal =
                inst.principalCents != null
                  ? Math.max(0, inst.principalCents - cutHere)
                  : undefined;
              const nextStatus =
                nextAmt <= inst.paidCents
                  ? inst.paidCents > 0
                    ? 'PAID'
                    : 'CANCELLED'
                  : inst.status;
              await tx.creditInstallment.update({
                where: { id: inst.id },
                data: {
                  amountCents: nextAmt,
                  ...(nextPrincipal !== undefined ? { principalCents: nextPrincipal } : {}),
                  status: nextStatus,
                },
              });
              toReduceCents -= cutHere;
            }
            const nextRemainingPrincipal = Math.max(
              0,
              agr.remainingPrincipalCents - Math.min(agr.remainingPrincipalCents, effectiveAmountCents)
            );
            const noteLine = `[Estorno Parcial Admin R$ ${(effectiveAmountCents / 100).toFixed(2)} por ${actorName}]: ${cleanReason}`;
            await tx.creditAgreement.update({
              where: { id: agr.id },
              data: {
                remainingPrincipalCents: nextRemainingPrincipal,
                notes: agr.notes ? `${agr.notes}\n${noteLine}` : noteLine,
              },
            });
          }
        }

        // Verifica se a comissão já foi contabilizada/fechada para evitar dupla cobrança no fechamento aberto do mesmo dia
        const saleYmd = getSaoPauloYmd(new Date(sale.date));
        const nowYmd = getSaoPauloYmd(now);
        const saleDayStart = new Date(`${saleYmd}T00:00:00.000-03:00`);
        const saleDayEnd = new Date(`${saleYmd}T23:59:59.999-03:00`);

        const closingForSaleDay = await tx.dailyClosing.findFirst({
          where: {
            sellerId: sale.sellerId,
            date: { gte: saleDayStart, lte: saleDayEnd },
          },
          select: { id: true },
        });

        const commissionAlreadyAccounted = Boolean(
          closingForSaleDay ||
            saleYmd < nowYmd ||
            sale.client?.cityClosedAt != null ||
            paidInstallmentRefundCents > 0
        );

        const adjustmentId = uuidv4();
        const ref = sale.fichaNumber || `VND-${String(sale.id).slice(0, 8).toUpperCase()}`;

        let sellerAdvanceEntry: any = null;
        if (commissionAlreadyAccounted && commissionDebitCents > 0) {
          const advRes = await createDebitAdvance({
            companyId: effectiveCompanyId,
            userId: sale.sellerId,
            profileRole: 'SELLER',
            category: 'ADJUSTMENT_DIVERGENCE',
            amountCents: commissionDebitCents,
            notes: `[${becomesFullyCancelled ? 'Cancelamento' : 'Estorno/Desconto'} Venda ${ref}] ${cleanReason}`,
            receiptUrl: cleanReceiptUrl,
            batchId: sale.client?.batchId || null,
            closingReference: `sale_adj_${adjustmentId}`,
            createdById: actorId,
            createdByName: actorName,
            tx,
          });
          sellerAdvanceEntry = advRes.entry;
        }

        const adjustment = await tx.saleAdjustment.create({
          data: {
            id: adjustmentId,
            companyId: effectiveCompanyId,
            saleId: sale.id,
            type: normalizedType,
            amountCents: effectiveAmountCents,
            commissionDebitCents,
            reason: cleanReason,
            receiptUrl: cleanReceiptUrl,
            sellerAdvanceEntryId: sellerAdvanceEntry?.id || null,
            createdById: actorId,
            createdByName: actorName,
          },
        });

        // Restaurar capa do vendedor quando cancelamento total
        let updatedCoverDeducted = sale.coverDeducted;
        if (becomesFullyCancelled && sale.coverDeducted) {
          await restoreCoverForCanceledSale(tx, {
            saleId: sale.id,
            sellerId: sale.sellerId,
            wasDeducted: sale.coverDeducted,
          });
          updatedCoverDeducted = false;
        }

        const updatedSale = await tx.sale.update({
          where: { id: sale.id },
          data: {
            saleStatus: newSaleStatus,
            refundedAmountCents: newRefundedAmountCents,
            coverDeducted: updatedCoverDeducted,
            ...(becomesFullyCancelled
              ? {
                  status: 'CANCELLED',
                  paymentStatus: 'CANCELLED',
                  cancelledAt: now,
                  cancelReason: cleanReason,
                }
              : {}),
          },
          include: {
            adjustments: { orderBy: { createdAt: 'desc' } },
          },
        });

        // Se não restou nenhuma outra venda ativa para a ficha no cancelamento total, atualiza outcomeStatus do cliente
        if (becomesFullyCancelled) {
          const otherActiveSalesCount = await tx.sale.count({
            where: {
              clientId: sale.clientId,
              id: { not: sale.id },
              saleStatus: { not: 'CANCELLED' },
              receiptUrl: { not: null },
            },
          });
          if (otherActiveSalesCount === 0) {
            const activeNonSalesCount = await tx.nonSale.count({
              where: {
                clientId: sale.clientId,
                supersededAt: null,
              },
            });
            await tx.client.update({
              where: { id: sale.clientId },
              data: {
                outcomeStatus: activeNonSalesCount > 0 ? 'NON_SALE' : 'PENDING',
              },
            });
          }
        }

        // Base de Pagamento / Demonstrativo Mensal da Plataforma
        let platformAdjustment: any = null;
        if (sale.platformStatementItem) {
          const item = sale.platformStatementItem;
          const remainingCreditableBase = Math.max(
            0,
            item.saleBaseCents - (item.creditedBaseCents || 0)
          );
          const returnBaseForPlatform = Math.min(effectiveAmountCents, remainingCreditableBase);
          if (returnBaseForPlatform > 0) {
            const platRes = await recordStatementAdjustmentOrReturnCredit(
              {
                companyId: effectiveCompanyId,
                type: becomesFullyCancelled ? 'SALE_CANCELLATION_CREDIT' : 'PARTIAL_RETURN_CREDIT',
                originSaleId: sale.id,
                returnedBaseCents: returnBaseForPlatform,
                reason: `[${becomesFullyCancelled ? 'Cancelamento' : 'Estorno/Desconto'} Venda ${ref}] ${cleanReason}`,
                idempotencyKey: `sale_adj_${adjustmentId}`,
                authorUserId: actorId,
                authorName: actorName,
                ipAddress: ipAddress || undefined,
              },
              tx
            );
            platformAdjustment = platRes.adjustment;
          }
        }

        // Timeline da Ficha
        await tx.clientTimeline.create({
          data: {
            clientId: sale.clientId,
            cycle: sale.client?.commercialCycle || 1,
            action: becomesFullyCancelled ? 'SALE_CANCELLED' : 'SALE_ADJUSTED',
            previousStatus: sale.saleStatus || 'ACTIVE',
            newStatus: newSaleStatus,
            authorId: actorId,
            authorRole: roleUpper,
            metadata: {
              saleId: sale.id,
              adjustmentId: adjustment.id,
              type: normalizedType,
              amountCents: effectiveAmountCents,
              commissionDebitCents,
              commissionAlreadyAccounted,
              reason: cleanReason,
              receiptUrl: cleanReceiptUrl,
            },
          },
        });

        // Trilha imutável de auditoria operacional
        await recordOperationalAuditEvent(
          {
            companyId: effectiveCompanyId,
            category: 'REVERSAL',
            action: becomesFullyCancelled
              ? 'SALE_CANCELLED_BY_ADMIN'
              : 'SALE_PARTIAL_REFUND_BY_ADMIN',
            entityType: 'SALE',
            entityReference: ref,
            entityId: sale.id,
            previousValues: {
              saleStatus: sale.saleStatus,
              refundedAmountCents: alreadyRefundedCents,
              netAmountCents: remainingNetCents,
            },
            newValues: {
              saleStatus: newSaleStatus,
              refundedAmountCents: newRefundedAmountCents,
              netAmountCents: newRemainingNetCents,
              commissionDebitCents,
              commissionAlreadyAccounted,
              sellerAdvanceEntryId: sellerAdvanceEntry?.id || null,
            },
            reason: cleanReason,
            authorUserId: actorId,
            authorName: actorName,
            authorRole: roleUpper,
            ipAddress,
          },
          tx
        );

        return {
          adjustment,
          sale: updatedSale,
          netAmountCents: becomesFullyCancelled ? 0 : newRemainingNetCents,
          commissionDebitCents,
          commissionAlreadyAccounted,
          sellerAdvanceEntry,
          platformAdjustment,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 30000,
      }
    );

    return res.status(201).json({
      success: true,
      ...txResult,
    });
  } catch (error: any) {
    if (error && error.status && error.message) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('[SALES] Erro ao processar estorno/cancelamento:', error);
    return res.status(500).json({ error: 'Erro interno ao processar estorno/cancelamento da venda.' });
  }
});

export default router;
