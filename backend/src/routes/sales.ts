import { NextFunction, Response, Router } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { upload, safeUpload, getUploadedFileUrl, removeUploadedFile } from '../middleware/upload';
import { validateCpf, calculateCreditSchedule, validateCreditSaleRequirements } from '../services/creditService';
import { resolveSellerCommissionRate } from '../utils/commission';

const router = Router();
const prisma = new PrismaClient();

const SALE_MANAGER_ROLES = ['COMPANY_ADMIN', 'ADMIN', 'SUPERVISOR', 'SELLER_MANAGER', 'SUPER_ADMIN'];

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

  return {
    clientId: String(clientId),
    value: parsedValue,
    city: String(city).trim(),
    product: product ? String(product).trim() : 'Mídias fotográficas',
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
  maxRetries = 3
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

      if (isSerializationConflict && attempt <= maxRetries) {
        const delayMs = 20 * attempt + Math.floor(Math.random() * 30);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
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
}): Promise<{ sale: any; created: boolean }> {
  const input = parseSaleInput(params.body);

  return runSerializableTransaction(async (tx) => {
    const client = await tx.client.findFirst({
      where: { id: input.clientId, companyId: params.companyId },
    });
    if (!client) throw { status: 404, message: 'Ficha não encontrada na sua empresa' };
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
      const updatedSale = await tx.sale.update({
        where: { id: existingSingle.id },
        data: {
          paymentStatus: 'PAID',
          status: 'PRONTO',
          receiptUrl: params.receiptUrl,
          ...(params.sheetPhotoUrl ? { sheetPhotoUrl: params.sheetPhotoUrl } : {}),
          ...(input.reportNotes ? { reportNotes: input.reportNotes } : {}),
          ...(input.sellerRating !== null ? { sellerRating: input.sellerRating } : {}),
          ...(input.photographerRating !== null ? { photographerRating: input.photographerRating } : {}),
          ...(input.contactRating !== null ? { contactRating: input.contactRating } : {}),
        },
      });

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
      const sale = await tx.sale.create({
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
          isLegacy: false,
        },
      });

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

        const sellerUser = await tx.user.findUnique({
          where: { id: params.sellerId },
          select: { usesOwnCar: true },
        });
        const initialCommissionRate = resolveSellerCommissionRate(sellerUser);

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
            installmentCommissionRate: 0.10,
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
      const sale = await tx.sale.create({
        data: {
          ...postSaleData,
          sellerId,
          status: hasReceipt ? 'PRONTO' : 'PENDING_RECEIPT',
          paymentStatus: postCredit ? 'PARTIALLY_PAID' : (hasReceipt ? 'PAID' : 'PENDING_RECEIPT'),
          companyId,
        },
      });

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

        const sellerUser = await tx.user.findUnique({
          where: { id: sellerId },
          select: { usesOwnCar: true },
        });
        const initialCommissionRate = resolveSellerCommissionRate(sellerUser);

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
            installmentCommissionRate: 0.10,
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
    res.status(result.created ? 201 : 200).json(result.sale);
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
      return res.status(result.created ? 201 : 200).json(result.sale);
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

      const updated = await tx.sale.update({
        where: { id },
        data: { receiptUrl, status: 'PRONTO', paymentStatus: 'PAID' },
      });
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

      // 2. Confirmar que a cidade não está fechada
      if (client.cityClosedAt) {
        throw { status: 409, message: 'Cidade já foi fechada para esta ficha' };
      }

      // 3. Rejeitar se já estiver vendida
      if (client.outcomeStatus === 'SOLD') {
        throw { status: 409, message: 'Não é possível registrar não-venda para ficha já vendida' };
      }

      // 4. Idempotência: se já é não-venda aguardando devolução neste ciclo para o mesmo vendedor
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

      // 7. Atualizar Client
      const updatedClient = await tx.client.update({
        where: { id: clientId },
        data: {
          outcomeStatus: 'NON_SALE',
          outcomeUpdatedAt: nonSale.date,
          bookStatus: 'AWAITING_RETURN',
        },
      });

      // 8. Gravar histórico auditável na linha do tempo
      await tx.clientTimeline.create({
        data: {
          clientId,
          cycle: client.commercialCycle || 1,
          previousStatus: client.bookStatus,
          newStatus: 'AWAITING_RETURN',
          previousSellerId: client.assignedSellerId,
          newSellerId: client.assignedSellerId,
          authorId: sellerId,
          authorRole: req.user?.role,
          action: 'NON_SALE',
          reason: String(reason).trim(),
        },
      });

      return { nonSale, client: updatedClient, created: true };
    });

    res.status(result.created ? 201 : 200).json(result.nonSale);
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

    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (startDate) {
      const match = String(startDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        const [, y, m, d] = match.map(Number);
        dateFilter.gte = new Date(y, m - 1, d, 0, 0, 0, 0);
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
        const [, y, m, d] = match.map(Number);
        dateFilter.lte = new Date(y, m - 1, d, 23, 59, 59, 999);
      } else {
        const dEnd = new Date(endDate);
        if (!isNaN(dEnd.getTime())) {
          dEnd.setHours(23, 59, 59, 999);
          dateFilter.lte = dEnd;
        }
      }
    }

    const sales = await prisma.sale.findMany({
      where: {
        ...(companyId ? { companyId } : {}),
        ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
      },
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

    res.json(sales);
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
