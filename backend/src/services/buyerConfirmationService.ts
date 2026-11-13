import crypto from 'crypto';
import { prisma as defaultPrisma, PrismaClient, Prisma } from './prisma';
import { recordOperationalAuditEvent } from './operationalAuditService';

export type BuyerConfirmationStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'UNDER_REVIEW'
  | 'INVALIDATED'
  | 'EXPIRED'
  | 'ADMIN_EXCEPTION';

export const BUYER_CONFIRMATION_STATUS_LABELS: Record<BuyerConfirmationStatus, string> = {
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmado',
  UNDER_REVIEW: 'Em conferência',
  INVALIDATED: 'Cancelado / Nova versão',
  EXPIRED: 'Link expirado',
  ADMIN_EXCEPTION: 'Exceção administrativa',
};

export const SELLER_PROGRESS_LABELS: Record<BuyerConfirmationStatus, string> = {
  PENDING: 'Aguardando cliente',
  CONFIRMED: 'Resposta recebida',
  UNDER_REVIEW: 'Resposta recebida',
  INVALIDATED: 'Cancelado',
  EXPIRED: 'Expirado',
  ADMIN_EXCEPTION: 'Exceção administrativa',
};

export function getConfirmationStatusLabel(status: string): string {
  return (
    BUYER_CONFIRMATION_STATUS_LABELS[status as BuyerConfirmationStatus] ||
    'Em conferência'
  );
}

export function getSellerProgressLabel(status: string, isSkipped?: boolean): string {
  if (status === 'PENDING' && isSkipped) {
    return 'Aguardando cliente';
  }
  return SELLER_PROGRESS_LABELS[status as BuyerConfirmationStatus] || 'Aguardando cliente';
}

export function hashConfirmationToken(rawToken: string): string {
  return crypto.createHash('sha256').update(String(rawToken).trim()).digest('hex');
}

export function extractLast4Digits(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

export function normalizePaymentMethodForComparison(raw?: string | null): string {
  const upper = String(raw || '').trim().toUpperCase();
  if (upper === 'PIX') return 'PIX';
  if (
    upper === 'CASH' ||
    upper === 'DINHEIRO' ||
    upper === 'ESPECIE' ||
    upper === 'ESPÉCIE'
  ) {
    return 'CASH';
  }
  if (
    upper === 'CREDIT' ||
    upper === 'CREDITO' ||
    upper === 'CRÉDITO' ||
    upper === 'CREDIT_CARD' ||
    upper === 'CARTAO_CREDITO' ||
    upper === 'CARTÃO DE CRÉDITO'
  ) {
    return 'CREDIT';
  }
  if (
    upper === 'DEBIT' ||
    upper === 'DEBITO' ||
    upper === 'DÉBITO' ||
    upper === 'DEBIT_CARD' ||
    upper === 'CARTAO_DEBITO' ||
    upper === 'CARTÃO DE DÉBITO'
  ) {
    return 'DEBIT';
  }
  if (
    upper === 'BOLETO' ||
    upper === 'CARNE' ||
    upper === 'CARNÊ' ||
    upper === 'CREDIARIO' ||
    upper === 'CREDIÁRIO' ||
    upper === 'CREDIARIO_BOLETO'
  ) {
    return 'CREDIARIO';
  }
  if (
    upper === 'SPLIT' ||
    upper === 'MISTO' ||
    upper === 'COMBINADO' ||
    upper === 'PAGAMENTO COMBINADO'
  ) {
    return 'SPLIT';
  }
  return upper || 'CASH';
}

export function arePaymentMethodsCompatible(
  sellerMethod: string,
  buyerMethod: string,
  hasCreditAgreement: boolean
): boolean {
  const normSeller = normalizePaymentMethodForComparison(sellerMethod);
  const normBuyer = normalizePaymentMethodForComparison(buyerMethod);
  if (normSeller === normBuyer) return true;
  if (
    hasCreditAgreement &&
    (normBuyer === 'CREDIARIO' || normBuyer === normSeller || normBuyer === 'SPLIT')
  ) {
    return true;
  }
  if (normSeller === 'SPLIT' || normBuyer === 'SPLIT') {
    return true;
  }
  return false;
}

export interface BuyerConfirmationReceipt {
  documentTitle: string;
  referenceCode: string;
  issuedAt: string;
  companyName: string;
  clientName: string;
  product: string;
  city: string;
  reportedTotalBrl: string;
  reportedPaidBrl: string;
  reportedPaymentMethod: string;
  isCredit: boolean;
  creditDetails?: {
    reportedRemainingBrl: string;
    reportedInstallmentsCount: number;
    reportedInstallmentBrl: string;
  };
  reportedPayments?: Array<{ method: string; amountBrl: string }>;
  notes?: string | null;
  disclaimer: string;
}

export function buildConfirmationReceipt(params: {
  referenceCode: string;
  issuedAt: Date;
  companyName: string;
  clientName: string;
  product: string;
  city: string;
  reportedTotalCents: number;
  reportedPaidCents: number;
  reportedPaymentMethod: string;
  reportedRemainingCents?: number | null;
  reportedInstallmentsCount?: number | null;
  reportedInstallmentCents?: number | null;
  reportedPayments?: any[] | null;
  notes?: string | null;
}): BuyerConfirmationReceipt {
  const formatBrl = (cents: number) =>
    (cents / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });

  const isCredit =
    Boolean(params.reportedInstallmentsCount && params.reportedInstallmentsCount > 1) ||
    normalizePaymentMethodForComparison(params.reportedPaymentMethod) === 'CREDIARIO';

  return {
    documentTitle: 'Registro de conferência do pedido — sem valor fiscal',
    referenceCode: params.referenceCode,
    issuedAt: params.issuedAt.toISOString(),
    companyName: params.companyName,
    clientName: params.clientName,
    product: params.product,
    city: params.city,
    reportedTotalBrl: formatBrl(params.reportedTotalCents),
    reportedPaidBrl: formatBrl(params.reportedPaidCents),
    reportedPaymentMethod: params.reportedPaymentMethod,
    isCredit,
    creditDetails: isCredit
      ? {
          reportedRemainingBrl: formatBrl(params.reportedRemainingCents || 0),
          reportedInstallmentsCount: params.reportedInstallmentsCount || 1,
          reportedInstallmentBrl: formatBrl(params.reportedInstallmentCents || 0),
        }
      : undefined,
    reportedPayments: Array.isArray(params.reportedPayments)
      ? params.reportedPayments.map((p) => ({
          method: p.method,
          amountBrl: formatBrl(p.amountCents || Math.round(Number(p.amount || 0) * 100)),
        }))
      : undefined,
    notes: params.notes || null,
    disclaimer:
      'Documento emitido exclusivamente para fins de conferência operacional entre cliente e empresa. Não possui valor fiscal nem quita obrigações tributárias.',
  };
}

/**
 * Emite um novo link único de confirmação para a venda na versão atual das condições.
 */
export async function issueBuyerConfirmationLink(
  params: {
    saleId: string;
    companyId: string;
    expiresInMinutes?: number;
    customExpiresAt?: Date;
    baseUrl?: string;
  },
  dbClient: PrismaClient | Prisma.TransactionClient = defaultPrisma
) {
  const sale = await dbClient.sale.findFirst({
    where: { id: params.saleId, companyId: params.companyId },
    include: {
      client: true,
      payments: true,
      creditAgreement: {
        include: {
          installments: true,
        },
      },
    },
  });

  if (!sale) {
    const err: any = new Error('Venda não encontrada para esta empresa.');
    err.status = 404;
    throw err;
  }

  const latestExisting = await dbClient.buyerPurchaseConfirmation.findFirst({
    where: { saleId: sale.id, companyId: params.companyId },
    orderBy: [{ conditionsVersion: 'desc' }, { createdAt: 'desc' }],
  });

  const conditionsVersion = latestExisting ? latestExisting.conditionsVersion : 1;

  // Invalida link PENDING anterior na mesma versão por rotação
  if (latestExisting && latestExisting.status === 'PENDING') {
    await dbClient.buyerPurchaseConfirmation.update({
      where: { id: latestExisting.id },
      data: {
        status: 'INVALIDATED',
        invalidatedAt: new Date(),
        invalidationReason: 'LINK_ROTATED',
      },
    });
  }

  const sellerTotalCents = sale.creditAgreement
    ? sale.creditAgreement.totalSaleCents
    : Math.round(Number(sale.value) * 100);

  const sellerPaidCents = sale.creditAgreement
    ? sale.creditAgreement.downPaymentCents
    : sale.payments && sale.payments.length > 0
    ? Math.round(sale.payments.reduce((acc, p) => acc + (p.amount || 0), 0) * 100)
    : sellerTotalCents;

  const sellerPaymentMethod = sale.creditAgreement
    ? 'CREDIARIO'
    : sale.payments && sale.payments.length > 1
    ? 'SPLIT'
    : String(sale.paymentMethod || 'CASH').toUpperCase();

  const expectedPhoneLast4 =
    extractLast4Digits(sale.client?.phone1) ||
    extractLast4Digits(sale.client?.phone2) ||
    extractLast4Digits(sale.creditAgreement?.buyerCpf);

  const rawToken = crypto.randomBytes(24).toString('hex');
  const tokenHash = hashConfirmationToken(rawToken);

  const ttlMs = (params.expiresInMinutes ?? 48 * 60) * 60 * 1000;
  const expiresAt = params.customExpiresAt || new Date(Date.now() + ttlMs);

  const installmentAmountCents =
    sale.creditAgreement && sale.creditAgreement.installmentsCount > 0
      ? sale.creditAgreement.installments && sale.creditAgreement.installments.length > 0
        ? sale.creditAgreement.installments[0].amountCents
        : Math.round(
            sale.creditAgreement.remainingPrincipalCents /
              sale.creditAgreement.installmentsCount
          )
      : 0;

  const conditionsSnapshot = {
    totalCents: sellerTotalCents,
    paidCents: sellerPaidCents,
    paymentMethod: sellerPaymentMethod,
    hasCreditAgreement: Boolean(sale.creditAgreement),
    installmentsCount: sale.creditAgreement?.installmentsCount || 1,
    installmentAmountCents,
    remainingPrincipalCents: sale.creditAgreement?.remainingPrincipalCents || 0,
    periodicity: sale.creditAgreement?.periodicity || null,
    payments: (sale.payments || []).map((p) => ({
      method: p.method,
      amountCents: Math.round(Number(p.amount) * 100),
    })),
  };

  const created = await dbClient.buyerPurchaseConfirmation.create({
    data: {
      companyId: params.companyId,
      saleId: sale.id,
      clientId: sale.clientId,
      sellerId: sale.sellerId,
      tokenHash,
      conditionsVersion,
      conditionsSnapshot,
      status: 'PENDING',
      expectedPhoneLast4,
      sellerTotalCents,
      sellerPaidCents,
      sellerPaymentMethod,
      expiresAt,
    },
  });

  const effectiveBaseUrl = (
    params.baseUrl ||
    process.env.PUBLIC_APP_URL ||
    'https://selectphoto-k1ac.onrender.com'
  ).replace(/\/+$/, '');

  const confirmationUrl = `${effectiveBaseUrl}/confirmar-compra/${rawToken}`;
  const apiConfirmationUrl = `${effectiveBaseUrl}/api/sales/public/confirm/${rawToken}`;

  return {
    confirmation: created,
    rawToken,
    confirmationUrl,
    apiConfirmationUrl,
    qrCodePayload: confirmationUrl,
    status: created.status,
    statusLabel: getConfirmationStatusLabel(created.status),
    statusProgress: getSellerProgressLabel(created.status, created.isSkipped),
    conditionsVersion: created.conditionsVersion,
    expiresAt: created.expiresAt,
  };
}

/**
 * Registra o motivo de o vendedor ter pulado a apresentação do QR code no momento da venda
 * (ex: cliente recusou conferência na hora, falta de sinal no local).
 * O link continua válido para o cliente responder depois caso venha a acessá-lo!
 */
export async function recordBuyerConfirmationSkipped(
  params: {
    saleId: string;
    companyId: string;
    reason: string;
    notes?: string;
    sellerUserId: string;
    sellerName: string;
    ipAddress?: string | null;
  },
  dbClient: PrismaClient = defaultPrisma
) {
  const latest = await dbClient.buyerPurchaseConfirmation.findFirst({
    where: { saleId: params.saleId, companyId: params.companyId },
    orderBy: [{ conditionsVersion: 'desc' }, { createdAt: 'desc' }],
    include: {
      sale: true,
    },
  });

  if (!latest) {
    const err: any = new Error('Confirmação de compra não encontrada para esta venda.');
    err.status = 404;
    throw err;
  }

  const cleanReason = String(params.reason || 'CLIENT_REFUSED').trim();
  const now = new Date();

  const updated = await dbClient.buyerPurchaseConfirmation.update({
    where: { id: latest.id },
    data: {
      isSkipped: true,
      skippedReason: cleanReason,
      skippedAt: now,
      skippedByUserId: params.sellerUserId,
      skippedByName: params.sellerName,
    },
  });

  const ref =
    latest.sale?.fichaNumber || `VND-${latest.saleId.slice(0, 8).toUpperCase()}`;

  await recordOperationalAuditEvent(
    {
      companyId: params.companyId,
      category: 'CONDITIONS',
      action: 'BUYER_CONFIRMATION_INVITATION_SKIPPED',
      entityType: 'SALE',
      entityReference: ref,
      entityId: latest.saleId,
      previousValues: {
        isSkipped: latest.isSkipped,
        status: latest.status,
      },
      newValues: {
        isSkipped: true,
        skippedReason: cleanReason,
        status: latest.status,
      },
      reason: `Apresentação de QR code de conferência pulada pelo vendedor: ${cleanReason}${
        params.notes ? ` (${params.notes})` : ''
      }`,
      authorUserId: params.sellerUserId,
      authorName: params.sellerName,
      authorRole: 'SELLER',
      ipAddress: params.ipAddress || null,
    },
    dbClient
  );

  return {
    confirmation: updated,
    statusProgress: getSellerProgressLabel(updated.status, updated.isSkipped),
    statusLabel: getConfirmationStatusLabel(updated.status),
    isSkipped: true,
    skippedReason: cleanReason,
  };
}

/**
 * Invalida link anterior e gera nova versão quando condições da venda são alteradas.
 */
export async function invalidateAndReissueConfirmationOnSaleChange(
  params: {
    saleId: string;
    companyId: string;
    reason: string;
    authorUserId?: string | null;
    authorName?: string;
    authorRole?: string | null;
    ipAddress?: string | null;
  },
  dbClient: PrismaClient | Prisma.TransactionClient = defaultPrisma
) {
  const sale = await dbClient.sale.findFirst({
    where: { id: params.saleId, companyId: params.companyId },
    include: {
      client: true,
      payments: true,
      creditAgreement: {
        include: {
          installments: true,
        },
      },
    },
  });

  if (!sale) return null;

  const existingRecords = await dbClient.buyerPurchaseConfirmation.findMany({
    where: { saleId: sale.id, companyId: params.companyId },
    orderBy: [{ conditionsVersion: 'desc' }, { createdAt: 'desc' }],
  });

  if (existingRecords.length === 0) {
    return issueBuyerConfirmationLink(
      { saleId: sale.id, companyId: params.companyId },
      dbClient
    );
  }

  const maxVersion = Math.max(...existingRecords.map((r) => r.conditionsVersion));
  const nextVersion = maxVersion + 1;

  const activeIds = existingRecords
    .filter((r) =>
      ['PENDING', 'CONFIRMED', 'UNDER_REVIEW', 'ADMIN_EXCEPTION'].includes(r.status)
    )
    .map((r) => r.id);

  if (activeIds.length > 0) {
    await dbClient.buyerPurchaseConfirmation.updateMany({
      where: { id: { in: activeIds } },
      data: {
        status: 'INVALIDATED',
        invalidatedAt: new Date(),
        invalidationReason: params.reason || 'CONDITIONS_OR_PRICE_CHANGED',
      },
    });
  }

  const sellerTotalCents = sale.creditAgreement
    ? sale.creditAgreement.totalSaleCents
    : Math.round(Number(sale.value) * 100);

  const sellerPaidCents = sale.creditAgreement
    ? sale.creditAgreement.downPaymentCents
    : sale.payments && sale.payments.length > 0
    ? Math.round(sale.payments.reduce((acc, p) => acc + (p.amount || 0), 0) * 100)
    : sellerTotalCents;

  const sellerPaymentMethod = sale.creditAgreement
    ? 'CREDIARIO'
    : sale.payments && sale.payments.length > 1
    ? 'SPLIT'
    : String(sale.paymentMethod || 'CASH').toUpperCase();

  const expectedPhoneLast4 =
    extractLast4Digits(sale.client?.phone1) ||
    extractLast4Digits(sale.client?.phone2) ||
    extractLast4Digits(sale.creditAgreement?.buyerCpf);

  const rawToken = crypto.randomBytes(24).toString('hex');
  const tokenHash = hashConfirmationToken(rawToken);
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  const installmentAmountCents =
    sale.creditAgreement && sale.creditAgreement.installmentsCount > 0
      ? sale.creditAgreement.installments && sale.creditAgreement.installments.length > 0
        ? sale.creditAgreement.installments[0].amountCents
        : Math.round(
            sale.creditAgreement.remainingPrincipalCents /
              sale.creditAgreement.installmentsCount
          )
      : 0;

  const created = await dbClient.buyerPurchaseConfirmation.create({
    data: {
      companyId: params.companyId,
      saleId: sale.id,
      clientId: sale.clientId,
      sellerId: sale.sellerId,
      tokenHash,
      conditionsVersion: nextVersion,
      conditionsSnapshot: {
        totalCents: sellerTotalCents,
        paidCents: sellerPaidCents,
        paymentMethod: sellerPaymentMethod,
        hasCreditAgreement: Boolean(sale.creditAgreement),
        installmentsCount: sale.creditAgreement?.installmentsCount || 1,
        installmentAmountCents,
        remainingPrincipalCents: sale.creditAgreement?.remainingPrincipalCents || 0,
        periodicity: sale.creditAgreement?.periodicity || null,
        payments: (sale.payments || []).map((p) => ({
          method: p.method,
          amountCents: Math.round(Number(p.amount) * 100),
        })),
      },
      status: 'PENDING',
      expectedPhoneLast4,
      sellerTotalCents,
      sellerPaidCents,
      sellerPaymentMethod,
      expiresAt,
    },
  });

  const ref =
    sale.fichaNumber || `VND-${sale.id.slice(0, 8).toUpperCase()}`;

  await recordOperationalAuditEvent(
    {
      companyId: params.companyId,
      category: 'CONDITIONS',
      action: 'BUYER_CONFIRMATION_INVALIDATED_NEW_VERSION',
      entityType: 'SALE',
      entityReference: ref,
      entityId: sale.id,
      previousValues: {
        previousVersion: maxVersion,
        invalidatedCount: activeIds.length,
      },
      newValues: {
        conditionsVersion: nextVersion,
        status: 'PENDING',
        sellerTotalCents,
        sellerPaidCents,
        sellerPaymentMethod,
      },
      reason: params.reason,
      authorUserId: params.authorUserId || null,
      authorName: params.authorName || 'Sistema',
      authorRole: params.authorRole || null,
      ipAddress: params.ipAddress || null,
    },
    dbClient
  );

  return {
    confirmation: created,
    rawToken,
    conditionsVersion: nextVersion,
  };
}

const INTERNAL_ERROR_LEAK_PATTERN =
  /prisma|select\s|insert\s|update\s|delete\s|public\.|postgres|\bsql\b|invocation|does not exist|column\s|relation\s|constraint\s|database|econnrefused|etimedout|\bp[12]\d{3}\b/i;

function createPublicConfirmationError(
  message: string,
  status: number,
  code: string
) {
  const err: any = new Error(message);
  err.status = status;
  err.code = code;
  err.isPublicSafe = true;
  return err;
}

/**
 * Garante que rotas públicas de confirmação jamais vazem erros internos do Prisma,
 * SQL, nomes de tabelas ou stack traces para o usuário final.
 */
export function sanitizePublicBuyerConfirmationError(err: unknown): {
  status: number;
  message: string;
  code: string;
} {
  const e = err as any;
  const status = typeof e?.status === 'number' ? e.status : 0;
  const rawMessage = typeof e?.message === 'string' ? e.message.trim() : '';
  const code =
    typeof e?.code === 'string' && e.code.trim() ? e.code.trim() : 'INVALID_LINK';

  if (
    e?.isPublicSafe === true &&
    status >= 400 &&
    status < 500 &&
    rawMessage &&
    !INTERNAL_ERROR_LEAK_PATTERN.test(rawMessage)
  ) {
    return { status, message: rawMessage, code };
  }

  if (
    e?.isPublicSafe === true &&
    status >= 500 &&
    status < 600 &&
    rawMessage &&
    !INTERNAL_ERROR_LEAK_PATTERN.test(rawMessage)
  ) {
    return { status, message: rawMessage, code };
  }

  const redactedLog = rawMessage.replace(
    /postgres(?:ql)?:\/\/[^\s]+/gi,
    '[REDACTED_DB_URL]'
  );
  console.error(
    '[BuyerConfirmationPublic] Erro interno sanitizado:',
    e?.name || 'Error',
    code,
    redactedLog || e
  );

  const isInfraOrDbError =
    (typeof e?.name === 'string' && e.name.startsWith('Prisma')) ||
    (typeof e?.code === 'string' && /^P\d+/.test(e.code)) ||
    /ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(String(e?.code || rawMessage)) ||
    status === 503;

  if (isInfraOrDbError) {
    return {
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Serviço temporariamente indisponível. Tente novamente em alguns instantes.',
    };
  }

  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    message:
      'Não foi possível processar esta solicitação no momento. Tente novamente em alguns instantes.',
  };
}

/**
 * Retorna os metadados públicos seguros para a página de confirmação no celular do comprador.
 * NUNCA retorna os valores lançados pelo vendedor!
 */
export async function getPublicBuyerConfirmationPrompt(
  rawToken: string,
  dbClient: PrismaClient = defaultPrisma
) {
  if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
    throw createPublicConfirmationError(
      'Link inválido ou não encontrado.',
      404,
      'LINK_NOT_FOUND'
    );
  }

  try {
    const tokenHash = hashConfirmationToken(rawToken);
    const record = await dbClient.buyerPurchaseConfirmation.findUnique({
      where: { tokenHash },
      include: {
        company: { select: { name: true, tradeName: true } },
        sale: {
          select: {
            fichaNumber: true,
            product: true,
            city: true,
            client: {
              select: {
                name: true,
                visibleCode: true,
                sequenceNumber: true,
              },
            },
          },
        },
      },
    });

    if (!record) {
      throw createPublicConfirmationError(
        'Link inválido ou não encontrado.',
        404,
        'LINK_NOT_FOUND'
      );
    }

    if (record.status === 'INVALIDATED') {
      throw createPublicConfirmationError(
        'As condições ou o valor desta venda foram alterados. Solicite o novo link atualizado.',
        409,
        'CONDITIONS_VERSION_SUPERSEDED'
      );
    }

    if (record.usedAt || record.status === 'CONFIRMED' || record.status === 'UNDER_REVIEW') {
      throw createPublicConfirmationError(
        'Este link de confirmação é de uso único e já foi respondido.',
        409,
        'LINK_ALREADY_USED'
      );
    }

    const now = new Date();
    if (record.status === 'EXPIRED' || now.getTime() > new Date(record.expiresAt).getTime()) {
      if (record.status === 'PENDING') {
        await dbClient.buyerPurchaseConfirmation.update({
          where: { id: record.id },
          data: { status: 'EXPIRED' },
        });
      }
      throw createPublicConfirmationError(
        'Este link de confirmação expirou. Solicite um novo link.',
        410,
        'LINK_EXPIRED'
      );
    }

    const buyerFullName = record.sale?.client?.name || 'Responsável';
    const firstName = buyerFullName.trim().split(/\s+/)[0] || 'Responsável';
    const fichaCode =
      record.sale?.fichaNumber ||
      record.sale?.client?.visibleCode ||
      record.sale?.client?.sequenceNumber ||
      '---';

    const snap = (record.conditionsSnapshot as any) || {};
    const isCreditAgreement = Boolean(snap.hasCreditAgreement);

    // ESTRITAMENTE SEM VALORES DO VENDEDOR!
    return {
      saleId: record.saleId,
      companyName: record.company?.tradeName || record.company?.name || 'Lumora',
      fichaCode,
      buyerFirstName: firstName,
      city: record.sale?.city || '',
      product: record.sale?.product || 'Mídias fotográficas',
      conditionsVersion: record.conditionsVersion,
      requiresIdentityCheck: Boolean(record.expectedPhoneLast4),
      isCreditAgreement,
      identityPrompt:
        'Para confirmar sua identidade, informe os 4 últimos dígitos do seu telefone (ou CPF) cadastrado na ficha.',
      fieldsToFill: [
        {
          name: 'phoneLast4',
          label: 'Últimos 4 dígitos do seu telefone ou CPF cadastrado',
          required: Boolean(record.expectedPhoneLast4),
        },
        {
          name: 'reportedTotalValue',
          label: 'Valor total combinado da compra (R$)',
          required: true,
        },
        {
          name: 'reportedPaidValue',
          label: 'Valor que você já pagou de entrada ou à vista (R$)',
          required: true,
        },
        {
          name: 'reportedPaymentMethod',
          label: 'Forma de pagamento combinada',
          required: true,
        },
        ...(isCreditAgreement
          ? [
              {
                name: 'reportedRemainingValue',
                label: 'Saldo restante a ser parcelado (R$)',
                required: true,
              },
              {
                name: 'reportedInstallmentsCount',
                label: 'Quantidade de parcelas combinadas',
                required: true,
              },
              {
                name: 'reportedInstallmentValue',
                label: 'Valor de cada parcela (R$)',
                required: true,
              },
            ]
          : []),
      ],
      expiresAt: record.expiresAt,
    };
  } catch (err: any) {
    if (err?.isPublicSafe) {
      throw err;
    }
    const safe = sanitizePublicBuyerConfirmationError(err);
    throw createPublicConfirmationError(safe.message, safe.status, safe.code);
  }
}

/**
 * Processa a resposta cega do cliente.
 * - Idempotência: caso o cliente reenvie a mesma confirmação, retorna o mesmo recibo sem duplicar auditoria.
 * - Verificação de 4 dígitos com limite de tentativas.
 * - Compara todos os campos em centavos (total, pago agora, saldo restante, parcelas, métodos).
 * - Gera o Registro de conferência do pedido — sem valor fiscal.
 * - Retorna EXATAMENTE a mesma resposta positiva em caso de dados coincidentes ou divergentes.
 */
export async function submitPublicBuyerConfirmation(
  params: {
    rawToken: string;
    phoneLast4?: string;
    verificationDigits?: string;
    buyerPhone?: string;
    cpfLast4?: string;
    reportedTotalValue?: number | string;
    reportedTotalCents?: number;
    reportedPaidValue?: number | string;
    reportedPaidNowValue?: number | string;
    reportedPaidCents?: number;
    reportedPaymentMethod: string;
    reportedRemainingValue?: number | string;
    reportedRemainingCents?: number;
    reportedInstallmentsCount?: number | string;
    reportedInstallmentValue?: number | string;
    reportedInstallmentCents?: number;
    reportedPayments?: Array<{ method: string; amount?: number; amountCents?: number }>;
    notes?: string;
    buyerChannel?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    deviceFingerprint?: string;
    acceptLanguage?: string;
  },
  dbClient: PrismaClient = defaultPrisma
) {
  if (!params.rawToken || typeof params.rawToken !== 'string' || !params.rawToken.trim()) {
    throw createPublicConfirmationError(
      'Link inválido ou não encontrado.',
      404,
      'LINK_NOT_FOUND'
    );
  }

  const tokenHash = hashConfirmationToken(params.rawToken);

  try {
    return await dbClient.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "BuyerPurchaseConfirmation" WHERE "tokenHash" = ${tokenHash} FOR UPDATE
    `;
    if (!locked || locked.length === 0) {
      throw createPublicConfirmationError(
        'Link inválido ou não encontrado.',
        404,
        'LINK_NOT_FOUND'
      );
    }

    const record = await tx.buyerPurchaseConfirmation.findUniqueOrThrow({
      where: { id: locked[0].id },
      include: {
        company: { select: { name: true, tradeName: true } },
        sale: {
          include: {
            client: true,
            payments: true,
            creditAgreement: {
              include: {
                installments: true,
              },
            },
          },
        },
      },
    });

    if (record.status === 'INVALIDATED') {
      throw createPublicConfirmationError(
        'As condições ou o valor desta venda foram alterados após a emissão deste link. Solicite o novo link atualizado.',
        409,
        'CONDITIONS_VERSION_SUPERSEDED'
      );
    }

    // Parse dos valores declarados pelo comprador
    const reportedTotalCents =
      params.reportedTotalCents !== undefined && params.reportedTotalCents !== null
        ? Math.round(Number(params.reportedTotalCents))
        : params.reportedTotalValue !== undefined && params.reportedTotalValue !== null
        ? Math.round(Number(String(params.reportedTotalValue).replace(',', '.')) * 100)
        : NaN;

    const rawPaidInput =
      params.reportedPaidValue !== undefined && params.reportedPaidValue !== null
        ? params.reportedPaidValue
        : params.reportedPaidNowValue;

    const reportedPaidCents =
      params.reportedPaidCents !== undefined && params.reportedPaidCents !== null
        ? Math.round(Number(params.reportedPaidCents))
        : rawPaidInput !== undefined && rawPaidInput !== null
        ? Math.round(Number(String(rawPaidInput).replace(',', '.')) * 100)
        : NaN;

    const ref =
      record.sale?.fichaNumber ||
      record.sale?.client?.visibleCode ||
      record.sale?.client?.sequenceNumber ||
      `VND-${record.saleId.slice(0, 8).toUpperCase()}`;

    const companyDisplayName =
      record.company?.tradeName || record.company?.name || 'Lumora';
    const clientDisplayName = record.sale?.client?.name || 'Cliente';

    // Idempotência: se já foi respondido, verifica se é o mesmo envio
    if (record.usedAt || record.status === 'CONFIRMED' || record.status === 'UNDER_REVIEW') {
      const isSameTotal = record.reportedTotalCents === reportedTotalCents;
      const isSamePaid = record.reportedPaidCents === reportedPaidCents;
      if (isSameTotal && isSamePaid) {
        // Reenvio idêntico seguro (double submit ou refresh)
        const receipt = buildConfirmationReceipt({
          referenceCode: ref,
          issuedAt: record.usedAt || new Date(),
          companyName: companyDisplayName,
          clientName: clientDisplayName,
          product: record.sale?.product || 'Mídias fotográficas',
          city: record.sale?.city || '',
          reportedTotalCents: record.reportedTotalCents || 0,
          reportedPaidCents: record.reportedPaidCents || 0,
          reportedPaymentMethod: record.reportedPaymentMethod || 'CASH',
          reportedRemainingCents: record.reportedRemainingCents,
          reportedInstallmentsCount: record.reportedInstallmentsCount,
          reportedInstallmentCents: record.reportedInstallmentCents,
          reportedPayments: record.reportedPayments as any[],
          notes: record.reportedNotes,
        });

        return {
          received: true,
          status: record.status,
          statusLabel: getConfirmationStatusLabel(record.status),
          respondedAt: record.usedAt,
          message: 'Sua confirmação de compra foi registrada com sucesso!',
          receipt,
        };
      }

      throw createPublicConfirmationError(
        'Este link de confirmação é de uso único e já foi respondido anteriormente.',
        409,
        'LINK_ALREADY_USED'
      );
    }

    const now = new Date();
    if (record.status === 'EXPIRED' || now.getTime() > new Date(record.expiresAt).getTime()) {
      await tx.buyerPurchaseConfirmation.update({
        where: { id: record.id },
        data: { status: 'EXPIRED' },
      });
      throw createPublicConfirmationError(
        'Este link de confirmação expirou. Solicite um novo link.',
        410,
        'LINK_EXPIRED'
      );
    }

    // Limite de tentativas para verificação de identidade
    if (record.verificationAttempts >= 5) {
      throw createPublicConfirmationError(
        'Limite de tentativas de validação excedido para este link. Solicite um novo link.',
        429,
        'TOO_MANY_ATTEMPTS'
      );
    }

    // Verificar se existe versão mais nova
    const newerVersion = await tx.buyerPurchaseConfirmation.findFirst({
      where: {
        saleId: record.saleId,
        companyId: record.companyId,
        conditionsVersion: { gt: record.conditionsVersion },
      },
      select: { id: true, conditionsVersion: true },
    });
    if (newerVersion) {
      await tx.buyerPurchaseConfirmation.update({
        where: { id: record.id },
        data: {
          status: 'INVALIDATED',
          invalidatedAt: now,
          invalidationReason: 'SUPERSEDED_BY_NEWER_VERSION',
        },
      });
      throw createPublicConfirmationError(
        'As condições da venda foram atualizadas. Utilize o novo link emitido.',
        409,
        'CONDITIONS_VERSION_SUPERSEDED'
      );
    }

    // Verificação de identidade pelo contato cadastrado
    const allowedLast4 = new Set<string>();
    if (record.expectedPhoneLast4) allowedLast4.add(record.expectedPhoneLast4);
    const p1Last4 = extractLast4Digits(record.sale?.client?.phone1);
    const p2Last4 = extractLast4Digits(record.sale?.client?.phone2);
    const cpfLast4 = extractLast4Digits(record.sale?.creditAgreement?.buyerCpf);
    if (p1Last4) allowedLast4.add(p1Last4);
    if (p2Last4) allowedLast4.add(p2Last4);
    if (cpfLast4) allowedLast4.add(cpfLast4);

    const candidateDigits =
      extractLast4Digits(params.phoneLast4) ||
      extractLast4Digits(params.verificationDigits) ||
      extractLast4Digits(params.buyerPhone) ||
      extractLast4Digits(params.cpfLast4);

    let verifiedBy = 'UNVERIFIED_NO_CONTACT_ON_FILE';
    if (allowedLast4.size > 0) {
      if (!candidateDigits || !allowedLast4.has(candidateDigits)) {
        await tx.buyerPurchaseConfirmation.update({
          where: { id: record.id },
          data: { verificationAttempts: { increment: 1 } },
        });
        throw createPublicConfirmationError(
          'Verificação de identidade falhou: os últimos 4 dígitos informados não conferem com o cadastro.',
          403,
          'IDENTITY_VERIFICATION_FAILED'
        );
      }
      verifiedBy =
        cpfLast4 && candidateDigits === cpfLast4 && !p1Last4
          ? 'CPF_LAST4'
          : 'PHONE_LAST4';
    }

    if (!Number.isFinite(reportedTotalCents) || reportedTotalCents <= 0) {
      throw createPublicConfirmationError(
        'Informe o valor total combinado maior que zero.',
        400,
        'INVALID_TOTAL_VALUE'
      );
    }

    if (!Number.isFinite(reportedPaidCents) || reportedPaidCents < 0) {
      throw createPublicConfirmationError(
        'Informe quanto você já pagou de entrada ou à vista (valor igual ou maior que zero).',
        400,
        'INVALID_PAID_VALUE'
      );
    }

    const rawReportedMethod = String(params.reportedPaymentMethod || '')
      .trim()
      .toUpperCase();
    if (!rawReportedMethod) {
      throw createPublicConfirmationError(
        'Informe a forma de pagamento combinada.',
        400,
        'MISSING_PAYMENT_METHOD'
      );
    }

    const snap = (record.conditionsSnapshot as any) || {};
    const hasCreditAgreement = Boolean(
      snap.hasCreditAgreement || record.sale?.creditAgreement
    );

    // Comparação de crediário
    let reportedRemainingCents: number | null = null;
    let reportedInstallmentsCount: number | null = null;
    let reportedInstallmentCents: number | null = null;

    if (hasCreditAgreement) {
      if (
        params.reportedRemainingCents !== undefined &&
        params.reportedRemainingCents !== null
      ) {
        reportedRemainingCents = Math.round(Number(params.reportedRemainingCents));
      } else if (
        params.reportedRemainingValue !== undefined &&
        params.reportedRemainingValue !== null
      ) {
        reportedRemainingCents = Math.round(
          Number(String(params.reportedRemainingValue).replace(',', '.')) * 100
        );
      } else {
        reportedRemainingCents = Math.max(0, reportedTotalCents - reportedPaidCents);
      }

      if (
        params.reportedInstallmentsCount !== undefined &&
        params.reportedInstallmentsCount !== null
      ) {
        reportedInstallmentsCount = parseInt(String(params.reportedInstallmentsCount), 10);
      }

      if (
        params.reportedInstallmentCents !== undefined &&
        params.reportedInstallmentCents !== null
      ) {
        reportedInstallmentCents = Math.round(Number(params.reportedInstallmentCents));
      } else if (
        params.reportedInstallmentValue !== undefined &&
        params.reportedInstallmentValue !== null
      ) {
        reportedInstallmentCents = Math.round(
          Number(String(params.reportedInstallmentValue).replace(',', '.')) * 100
        );
      }
    }

    // Tratamento de pagamentos mistos declarados
    const reportedPaymentsJson = Array.isArray(params.reportedPayments)
      ? params.reportedPayments.map((p) => ({
          method: normalizePaymentMethodForComparison(p.method),
          amountCents:
            p.amountCents !== undefined
              ? Math.round(Number(p.amountCents))
              : Math.round(Number(String(p.amount || 0).replace(',', '.')) * 100),
        }))
      : null;

    // COMPARAÇÃO RIGOROSA EM CENTAVOS
    const divergenceReasons: string[] = [];

    const totalDiffCents = reportedTotalCents - record.sellerTotalCents;
    if (Math.abs(totalDiffCents) > 0) {
      divergenceReasons.push('TOTAL_MISMATCH');
    }

    const paidDiffCents = reportedPaidCents - record.sellerPaidCents;
    if (Math.abs(paidDiffCents) > 0) {
      divergenceReasons.push('PAID_MISMATCH');
    }

    const methodCompatible = arePaymentMethodsCompatible(
      record.sellerPaymentMethod,
      rawReportedMethod,
      hasCreditAgreement
    );
    if (!methodCompatible) {
      divergenceReasons.push('PAYMENT_METHOD_MISMATCH');
    }

    // Se houver crediário, valida parcelas e saldo restante
    let creditRemainingMismatch = false;
    let creditInstallmentsCountMismatch = false;
    let creditInstallmentAmountMismatch = false;

    if (hasCreditAgreement && record.sale?.creditAgreement) {
      const ca = record.sale.creditAgreement;
      if (
        reportedRemainingCents !== null &&
        reportedRemainingCents !== ca.remainingPrincipalCents
      ) {
        creditRemainingMismatch = true;
        divergenceReasons.push('CREDIT_REMAINING_MISMATCH');
      }

      if (
        reportedInstallmentsCount !== null &&
        reportedInstallmentsCount !== ca.installmentsCount
      ) {
        creditInstallmentsCountMismatch = true;
        divergenceReasons.push('CREDIT_INSTALLMENTS_COUNT_MISMATCH');
      }

      const expectedInstallmentCents =
        ca.installments && ca.installments.length > 0
          ? ca.installments[0].amountCents
          : Math.round(ca.remainingPrincipalCents / ca.installmentsCount);

      if (
        reportedInstallmentCents !== null &&
        Math.abs(reportedInstallmentCents - expectedInstallmentCents) > 0
      ) {
        creditInstallmentAmountMismatch = true;
        divergenceReasons.push('CREDIT_INSTALLMENT_AMOUNT_MISMATCH');
      }
    }

    // Se for split payment na venda do vendedor, confere se os métodos batem
    let splitMismatch = false;
    if (
      record.sale?.payments &&
      record.sale.payments.length > 1 &&
      reportedPaymentsJson &&
      reportedPaymentsJson.length > 0
    ) {
      const sellerPaymentsSum = record.sale.payments.reduce(
        (sum, p) => sum + Math.round(Number(p.amount) * 100),
        0
      );
      const reportedPaymentsSum = reportedPaymentsJson.reduce(
        (sum, p) => sum + p.amountCents,
        0
      );
      if (sellerPaymentsSum !== reportedPaymentsSum) {
        splitMismatch = true;
        divergenceReasons.push('SPLIT_TOTAL_MISMATCH');
      }
    }

    const hasDivergence = divergenceReasons.length > 0;
    const nextStatus: BuyerConfirmationStatus = hasDivergence
      ? 'UNDER_REVIEW'
      : 'CONFIRMED';

    const divergenceDetails = hasDivergence
      ? {
          reasons: divergenceReasons,
          totalMismatch: Math.abs(totalDiffCents) > 0,
          paidMismatch: Math.abs(paidDiffCents) > 0,
          paymentMethodMismatch: !methodCompatible,
          creditRemainingMismatch,
          creditInstallmentsCountMismatch,
          creditInstallmentAmountMismatch,
          splitMismatch,
          sellerDeclared: {
            totalCents: record.sellerTotalCents,
            totalBrl: Number((record.sellerTotalCents / 100).toFixed(2)),
            paidCents: record.sellerPaidCents,
            paidBrl: Number((record.sellerPaidCents / 100).toFixed(2)),
            paymentMethod: record.sellerPaymentMethod,
            hasCreditAgreement,
            installmentsCount: record.sale?.creditAgreement?.installmentsCount || null,
            installmentCents:
              record.sale?.creditAgreement?.installments?.[0]?.amountCents ||
              (record.sale?.creditAgreement?.installmentsCount
                ? Math.round(
                    record.sale.creditAgreement.remainingPrincipalCents /
                      record.sale.creditAgreement.installmentsCount
                  )
                : null),
            remainingPrincipalCents:
              record.sale?.creditAgreement?.remainingPrincipalCents || null,
            payments: (record.sale?.payments || []).map((p) => ({
              method: p.method,
              amountCents: Math.round(Number(p.amount) * 100),
            })),
          },
          buyerReported: {
            totalCents: reportedTotalCents,
            totalBrl: Number((reportedTotalCents / 100).toFixed(2)),
            paidCents: reportedPaidCents,
            paidBrl: Number((reportedPaidCents / 100).toFixed(2)),
            paymentMethod: rawReportedMethod,
            remainingCents: reportedRemainingCents,
            remainingBrl:
              reportedRemainingCents !== null
                ? Number((reportedRemainingCents / 100).toFixed(2))
                : null,
            installmentsCount: reportedInstallmentsCount,
            installmentCents: reportedInstallmentCents,
            installmentBrl:
              reportedInstallmentCents !== null
                ? Number((reportedInstallmentCents / 100).toFixed(2))
                : null,
            payments: reportedPaymentsJson,
          },
          differences: {
            totalDifferenceCents: totalDiffCents,
            totalDifferenceBrl: Number((totalDiffCents / 100).toFixed(2)),
            paidDifferenceCents: paidDiffCents,
            paidDifferenceBrl: Number((paidDiffCents / 100).toFixed(2)),
          },
        }
      : null;

    // ── Prevenção silenciosa de auto-escaneamento por fingerprint / IP ───────────
    const rawFp =
      params.deviceFingerprint ||
      `${params.ipAddress || ''}|${params.userAgent || ''}|${params.acceptLanguage || ''}`;
    const deviceFingerprintHash = crypto
      .createHash('sha256')
      .update(rawFp)
      .digest('hex');

    const operationalWindowStart = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const batchId =
      record.sale?.client?.batchId ||
      (record.sale?.client as any)?.batch?.id ||
      record.operationalBatchId ||
      null;

    const suspiciousPriorConfirmations = await tx.buyerPurchaseConfirmation.findMany({
      where: {
        companyId: record.companyId,
        id: { not: record.id },
        clientId: { not: record.clientId },
        status: { in: ['CONFIRMED', 'UNDER_REVIEW'] },
        usedAt: { gte: operationalWindowStart },
        deviceFingerprintHash,
        OR: [
          { sellerId: record.sellerId },
          ...(batchId ? [{ operationalBatchId: batchId }] : []),
          ...(batchId ? [{ sale: { client: { batchId } } }] : []),
        ],
      },
      select: { id: true, clientId: true, saleId: true, usedAt: true },
    });

    const suspectedSelfScan = suspiciousPriorConfirmations.length > 0;
    const selfScanReason = suspectedSelfScan
      ? `Dispositivo (fingerprint ${deviceFingerprintHash.slice(0, 8)}) confirmou fichas de ${
          suspiciousPriorConfirmations.length
        } cliente(s) distinto(s) do mesmo vendedor ou lote dentro da janela operacional.`
      : null;

    const updated = await tx.buyerPurchaseConfirmation.update({
      where: { id: record.id },
      data: {
        status: nextStatus,
        verifiedPhoneLast4: candidateDigits || null,
        identityVerifiedBy: verifiedBy,
        reportedTotalCents,
        reportedPaidCents,
        reportedPaymentMethod: rawReportedMethod,
        reportedRemainingCents,
        reportedInstallmentsCount,
        reportedInstallmentCents,
        reportedPayments: reportedPaymentsJson ? (reportedPaymentsJson as any) : Prisma.DbNull,
        reportedNotes: params.notes ? String(params.notes).trim() : null,
        hasDivergence,
        divergenceDetails: divergenceDetails ?? Prisma.DbNull,
        divergenceReasons: divergenceReasons.length > 0 ? divergenceReasons : Prisma.DbNull,
        usedAt: now,
        respondedIp: params.ipAddress || null,
        respondedUserAgent: params.userAgent ? String(params.userAgent).slice(0, 255) : null,
        deviceFingerprintHash,
        suspectedSelfScan,
        selfScanReason,
        operationalBatchId: batchId,
      },
    });

    if (suspectedSelfScan) {
      await recordOperationalAuditEvent(
        {
          companyId: record.companyId,
          category: 'CONDITIONS',
          action: 'BUYER_CONFIRMATION_SELF_SCAN_SUSPECTED',
          entityType: 'SALE',
          entityReference: ref,
          entityId: record.saleId,
          previousValues: { suspectedSelfScan: false },
          newValues: {
            suspectedSelfScan: true,
            deviceFingerprintHash,
            selfScanReason,
            matchedPriorCount: suspiciousPriorConfirmations.length,
          },
          reason: selfScanReason || 'Suspeita de auto-escaneamento pelo mesmo dispositivo em clientes distintos.',
          authorUserId: null,
          authorName: 'Sistema de Segurança Lumora',
          authorRole: 'SYSTEM',
          ipAddress: params.ipAddress || null,
          reviewAlert: {
            alertType: 'BUYER_CONFIRMATION_SELF_SCAN_SUSPECTED',
            severity: 'HIGH',
            summary: `Alerta de auto-escaneamento na venda ${ref}: mesmo dispositivo confirmou múltiplos clientes do mesmo vendedor/lote.`,
            details: {
              deviceFingerprintHash,
              matchedConfirmations: suspiciousPriorConfirmations,
            },
          },
        },
        tx
      );
    }

    await recordOperationalAuditEvent(
      {
        companyId: record.companyId,
        category: hasDivergence ? 'PRICE' : 'CONDITIONS',
        action: hasDivergence
          ? 'BUYER_CONFIRMATION_DIVERGENCE_DETECTED'
          : 'BUYER_CONFIRMATION_MATCHED',
        entityType: 'SALE',
        entityReference: ref,
        entityId: record.saleId,
        previousValues: {
          sellerTotalBrl: Number((record.sellerTotalCents / 100).toFixed(2)),
          sellerPaidBrl: Number((record.sellerPaidCents / 100).toFixed(2)),
          sellerPaymentMethod: record.sellerPaymentMethod,
        },
        newValues: {
          buyerReportedTotalBrl: Number((reportedTotalCents / 100).toFixed(2)),
          buyerReportedPaidBrl: Number((reportedPaidCents / 100).toFixed(2)),
          buyerReportedPaymentMethod: rawReportedMethod,
          status: nextStatus,
          hasDivergence,
          reasons: divergenceReasons,
        },
        reason: hasDivergence
          ? `Divergência entre o registro do vendedor e o informado pelo cliente (${divergenceReasons.join(
              ', '
            )}). Encaminhado para revisão do Admin.`
          : 'Confirmação de compra respondida pelo cliente com valores coincidentes.',
        authorUserId: null,
        authorName: 'Cliente (Link Público)',
        authorRole: 'BUYER_PUBLIC_LINK',
        ipAddress: params.ipAddress || null,
        reviewAlert: hasDivergence
          ? {
              alertType: 'BUYER_CONFIRMATION_DIVERGENCE',
              severity: 'HIGH',
              summary: `Divergência na confirmação da venda (${ref}): vendedor lançou R$ ${(
                record.sellerTotalCents / 100
              ).toFixed(2)}, cliente declarou R$ ${(reportedTotalCents / 100).toFixed(
                2
              )}.`,
              details: divergenceDetails as Record<string, unknown>,
            }
          : null,
      },
      tx
    );

    // Registro de conferência do pedido — sem valor fiscal
    const receipt = buildConfirmationReceipt({
      referenceCode: ref,
      issuedAt: now,
      companyName: companyDisplayName,
      clientName: clientDisplayName,
      product: record.sale?.product || 'Mídias fotográficas',
      city: record.sale?.city || '',
      reportedTotalCents,
      reportedPaidCents,
      reportedPaymentMethod: rawReportedMethod,
      reportedRemainingCents,
      reportedInstallmentsCount,
      reportedInstallmentCents,
      reportedPayments: reportedPaymentsJson,
      notes: params.notes,
    });

    // RESPOSTA IDÊNTICA PARA VALORES COINCIDENTES E DIVERGENTES:
    // O cliente NUNCA recebe menção de divergência!
    return {
      received: true,
      saleId: updated.saleId,
      conditionsVersion: updated.conditionsVersion,
      status: updated.status,
      statusLabel: getConfirmationStatusLabel(updated.status),
      respondedAt: updated.usedAt,
      message: 'Sua confirmação de compra foi registrada com sucesso!',
      receipt,
    };
  });
  } catch (err: any) {
    if (err?.isPublicSafe) {
      throw err;
    }
    const safe = sanitizePublicBuyerConfirmationError(err);
    throw createPublicConfirmationError(safe.message, safe.status, safe.code);
  }
}

/**
 * Conclui a conferência / revisão pelo Admin da própria empresa com justificativa auditada.
 */
export async function resolveBuyerConfirmationReview(
  params: {
    saleId: string;
    companyId: string;
    adminUserId: string;
    adminUserName: string;
    adminRole?: string;
    resolutionNotes: string;
    action?: 'RESOLVED_NOTES_ONLY' | 'DEDUCT_COMMISSION' | 'NONE';
    divergenceDeductionCents?: number;
    sellerBlocked?: boolean;
    sellerBlockedReason?: string;
    ipAddress?: string | null;
  },
  dbClient: PrismaClient = defaultPrisma
) {
  const cleanNotes = String(params.resolutionNotes || '').trim();
  if (cleanNotes.length < 5) {
    const err: any = new Error(
      'Justificativa é obrigatória para concluir a revisão (mínimo 5 caracteres).'
    );
    err.status = 400;
    throw err;
  }

  return await (dbClient as any).$transaction(async (tx: any) => {
    // 1. Localiza a conferência mais recente
    const candidate = await tx.buyerPurchaseConfirmation.findFirst({
      where: { saleId: params.saleId, companyId: params.companyId },
      orderBy: [{ conditionsVersion: 'desc' }, { createdAt: 'desc' }],
      include: {
        sale: {
          include: {
            client: {
              include: {
                batch: true,
              },
            },
            seller: true,
          },
        },
      },
    });

    if (!candidate) {
      const err: any = new Error('Confirmação de compra não encontrada.');
      err.status = 404;
      throw err;
    }

    // 2. Trava transacional (FOR UPDATE) para prevenir concorrência e duplo abatimento
    await tx.$executeRawUnsafe(
      'SELECT id FROM "BuyerPurchaseConfirmation" WHERE id = $1 FOR UPDATE',
      candidate.id
    );

    const latest = await tx.buyerPurchaseConfirmation.findUnique({
      where: { id: candidate.id },
      include: {
        sale: {
          include: {
            client: {
              include: {
                batch: true,
              },
            },
            seller: true,
          },
        },
      },
    });

    if (!latest) {
      const err: any = new Error('Confirmação de compra não encontrada.');
      err.status = 404;
      throw err;
    }

    const now = new Date();
    const action = params.action || 'RESOLVED_NOTES_ONLY';
    let commissionDeductionApplied = latest.commissionDeductionApplied;
    let commissionDeductedCents = latest.commissionDeductedCents;
    let auditedReferenceCents = latest.auditedReferenceCents;
    let commissionDeductionBatchId = latest.commissionDeductionBatchId;
    let batchAdjustmentCreated: any = null;

    const divergenceCents = Math.abs(
      (latest.sellerTotalCents || 0) - (latest.reportedTotalCents || 0)
    );
    const deductionTargetCents =
      params.divergenceDeductionCents !== undefined &&
      params.divergenceDeductionCents !== null
        ? Math.round(Number(params.divergenceDeductionCents))
        : divergenceCents;

    const batchId =
      latest.sale?.client?.batchId ||
      latest.operationalBatchId ||
      null;

    // (b) Abater divergência na comissão do lote de forma transacional e idempotente
    if (action === 'DEDUCT_COMMISSION') {
      if (latest.commissionDeductionApplied) {
        console.log(
          `[REVIEW] Abatimento de comissão já aplicado anteriormente na confirmação ${latest.id}`
        );
      } else {
        auditedReferenceCents =
          latest.reportedTotalCents ??
          Math.max(0, (latest.sellerTotalCents || 0) - deductionTargetCents);

        if (deductionTargetCents > 0 && batchId) {
          const existingAdj = await tx.batchCommissionAdjustment.findUnique({
            where: { confirmationId: latest.id },
          });

          if (!existingAdj) {
            batchAdjustmentCreated = await tx.batchCommissionAdjustment.create({
              data: {
                companyId: params.companyId,
                batchId,
                saleId: latest.saleId,
                confirmationId: latest.id,
                sellerId: latest.sellerId,
                divergenceCents,
                deductionCents: deductionTargetCents,
                originalSellerTotalCents: latest.sellerTotalCents,
                auditedReferenceTotalCents: auditedReferenceCents,
                reason: cleanNotes,
                appliedByUserId: params.adminUserId,
                appliedByName: params.adminUserName,
              },
            });
          } else {
            batchAdjustmentCreated = existingAdj;
          }
        }

        commissionDeductionApplied = true;
        commissionDeductedCents = deductionTargetCents;
        commissionDeductionBatchId = batchId;
      }
    }

    // (c) Bloqueio preventivo do vendedor para novos lotes e vendas
    let sellerBlockedAtResolution = latest.sellerBlockedAtResolution;
    if (params.sellerBlocked !== undefined && latest.sellerId) {
      const isBlocking = Boolean(params.sellerBlocked);
      await tx.user.update({
        where: { id: latest.sellerId },
        data: {
          sellerBlocked: isBlocking,
          sellerBlockedReason: isBlocking
            ? params.sellerBlockedReason ||
              cleanNotes ||
              'Bloqueio preventivo por divergência na conferência de vendas'
            : null,
          sellerBlockedAt: isBlocking ? now : null,
          sellerBlockedByUserId: isBlocking ? params.adminUserId : null,
        },
      });
      sellerBlockedAtResolution = isBlocking;

      await recordOperationalAuditEvent(
        {
          companyId: params.companyId,
          category: 'CONDITIONS',
          action: isBlocking
            ? 'SELLER_PREVENTIVE_BLOCK_APPLIED'
            : 'SELLER_PREVENTIVE_BLOCK_REMOVED',
          entityType: 'SELLER',
          entityReference: latest.sellerId,
          entityId: latest.sellerId,
          previousValues: {
            sellerBlocked: !isBlocking,
          },
          newValues: {
            sellerBlocked: isBlocking,
            reason: params.sellerBlockedReason || cleanNotes,
            resolvedBy: params.adminUserName,
          },
          reason: isBlocking
            ? `Bloqueio preventivo aplicado pelo Admin ao vendedor: ${cleanNotes}`
            : `Bloqueio preventivo removido pelo Admin: ${cleanNotes}`,
          authorUserId: params.adminUserId,
          authorName: params.adminUserName,
          authorRole: params.adminRole || 'ADMIN',
          ipAddress: params.ipAddress || null,
        },
        tx
      );
    }

    const updated = await tx.buyerPurchaseConfirmation.update({
      where: { id: latest.id },
      data: {
        reviewResolvedByUserId: params.adminUserId,
        reviewResolvedByName: params.adminUserName,
        reviewResolutionNotes: cleanNotes,
        reviewResolvedAt: now,
        reviewResolutionAction: action,
        commissionDeductionApplied,
        commissionDeductedCents,
        auditedReferenceCents,
        commissionDeductionBatchId,
        sellerBlockedAtResolution,
      },
    });

    const ref =
      latest.sale?.fichaNumber || `VND-${latest.saleId.slice(0, 8).toUpperCase()}`;

    await recordOperationalAuditEvent(
      {
        companyId: params.companyId,
        category: 'CONDITIONS',
        action: 'BUYER_CONFIRMATION_REVIEW_RESOLVED',
        entityType: 'SALE',
        entityReference: ref,
        entityId: latest.saleId,
        previousValues: {
          reviewResolvedAt: latest.reviewResolvedAt,
          status: latest.status,
          commissionDeductionApplied: latest.commissionDeductionApplied,
        },
        newValues: {
          reviewResolvedByUserId: params.adminUserId,
          reviewResolvedByName: params.adminUserName,
          reviewResolvedAt: now,
          reviewResolutionNotes: cleanNotes,
          reviewResolutionAction: action,
          commissionDeductionApplied,
          commissionDeductedCents,
          auditedReferenceCents,
          sellerBlockedAtResolution,
          status: latest.status,
        },
        reason: `Revisão de conferência concluída pelo Admin: ${cleanNotes}${
          action === 'DEDUCT_COMMISSION'
            ? ` (Abatimento de comissão: R$ ${((commissionDeductedCents || 0) / 100).toFixed(2)})`
            : ''
        }`,
        authorUserId: params.adminUserId,
        authorName: params.adminUserName,
        authorRole: params.adminRole || 'ADMIN',
        ipAddress: params.ipAddress || null,
      },
      tx
    );

    return {
      ...updated,
      batchAdjustment: batchAdjustmentCreated,
    };
  });
}

/**
 * Formata os dados de conferência respeitando o perfil:
 * - VENDEDOR: enxerga APENAS o andamento ("Aguardando cliente", "Resposta recebida", etc.),
 *   sem JAMAIS expor os valores do comprador ou se houve divergência.
 * - ADMIN / SUPERVISOR / COMPANY_ADMIN: enxerga relato lado a lado, divergências, convites pulados,
 *   expirados, lote operacional e histórico de versões.
 */
const ADMIN_CONFIRMATION_ROLES = new Set([
  'ADMIN',
  'SUPERVISOR',
  'SELLER_MANAGER',
  'COMPANY_ADMIN',
  'SUPER_ADMIN',
  'OWNER',
]);

export function formatBuyerConfirmationForRole(
  record: any,
  roleOrIsAdmin?: boolean | string | null,
  history?: any[],
  operationalBatch?: any
) {
  const isAdminView =
    typeof roleOrIsAdmin === 'boolean'
      ? roleOrIsAdmin
      : ADMIN_CONFIRMATION_ROLES.has(String(roleOrIsAdmin || '').toUpperCase());

  if (!record) {
    return {
      status: 'PENDING',
      statusProgress: 'Aguardando cliente',
      statusLabel: getConfirmationStatusLabel('PENDING'),
      conditionsVersion: 1,
    };
  }

  const now = new Date();
  let effectiveStatus = record.status;
  if (
    effectiveStatus === 'PENDING' &&
    record.expiresAt &&
    now.getTime() > new Date(record.expiresAt).getTime()
  ) {
    effectiveStatus = 'EXPIRED';
  }

  const baseSellerSafeView = {
    id: record.id,
    saleId: record.saleId,
    conditionsVersion: record.conditionsVersion,
    status: effectiveStatus,
    statusLabel: getConfirmationStatusLabel(effectiveStatus),
    statusProgress: getSellerProgressLabel(effectiveStatus, record.isSkipped),
    isSkipped: Boolean(record.isSkipped),
    skippedReason: record.skippedReason || null,
    skippedAt: record.skippedAt || null,
    expiresAt: record.expiresAt,
    respondedAt: record.usedAt || null,
    invalidatedAt: record.invalidatedAt || null,
    operationalBatch: null as any,
  };

  if (!isAdminView) {
    return baseSellerSafeView;
  }

  const sellerTotalBrl = Number((record.sellerTotalCents / 100).toFixed(2));
  const sellerPaidBrl = Number((record.sellerPaidCents / 100).toFixed(2));
  const buyerTotalBrl =
    record.reportedTotalCents !== null && record.reportedTotalCents !== undefined
      ? Number((record.reportedTotalCents / 100).toFixed(2))
      : null;
  const buyerPaidBrl =
    record.reportedPaidCents !== null && record.reportedPaidCents !== undefined
      ? Number((record.reportedPaidCents / 100).toFixed(2))
      : null;

  const snap = (record.conditionsSnapshot as any) || {};

  const divergenceSummary =
    record.hasDivergence && buyerTotalBrl !== null
      ? `Vendedor: R$ ${sellerTotalBrl.toFixed(2)} (Pago ato: R$ ${sellerPaidBrl.toFixed(
          2
        )}, ${record.sellerPaymentMethod}) | Cliente: R$ ${buyerTotalBrl.toFixed(
          2
        )} (Pago ato: R$ ${(buyerPaidBrl ?? 0).toFixed(2)}, ${
          record.reportedPaymentMethod
        }). Motivo: ${(record.divergenceReasons || []).join(', ') || 'Valores divergentes'}.`
      : null;

  return {
    ...baseSellerSafeView,
    hasDivergence: Boolean(record.hasDivergence),
    divergenceReasons: record.divergenceReasons || [],
    divergenceSummary,
    identityVerifiedBy: record.identityVerifiedBy || null,
    sellerDeclared: {
      totalCents: record.sellerTotalCents,
      totalBrl: sellerTotalBrl,
      paidCents: record.sellerPaidCents,
      paidBrl: sellerPaidBrl,
      paymentMethod: record.sellerPaymentMethod,
      hasCreditAgreement: Boolean(snap.hasCreditAgreement),
      installmentsCount: snap.installmentsCount || null,
      installmentCents: snap.installmentAmountCents || null,
      remainingPrincipalCents: snap.remainingPrincipalCents || null,
      payments: snap.payments || null,
    },
    buyerReported:
      record.reportedTotalCents !== null && record.reportedTotalCents !== undefined
        ? {
            totalCents: record.reportedTotalCents,
            totalBrl: buyerTotalBrl,
            paidCents: record.reportedPaidCents,
            paidBrl: buyerPaidBrl,
            paymentMethod: record.reportedPaymentMethod,
            remainingCents: record.reportedRemainingCents,
            remainingBrl:
              record.reportedRemainingCents !== null
                ? Number((record.reportedRemainingCents / 100).toFixed(2))
                : null,
            installmentsCount: record.reportedInstallmentsCount,
            installmentCents: record.reportedInstallmentCents,
            installmentBrl:
              record.reportedInstallmentCents !== null
                ? Number((record.reportedInstallmentCents / 100).toFixed(2))
                : null,
            payments: record.reportedPayments || null,
            notes: record.reportedNotes || null,
          }
        : null,
    divergenceDetails: record.divergenceDetails || null,
    skipped: {
      isSkipped: Boolean(record.isSkipped),
      skippedReason: record.skippedReason || null,
      skippedAt: record.skippedAt || null,
      skippedByName: record.skippedByName || null,
    },
    reviewResolution: record.reviewResolvedAt
      ? {
          resolvedByUserId: record.reviewResolvedByUserId,
          resolvedByName: record.reviewResolvedByName,
          resolutionNotes: record.reviewResolutionNotes,
          resolvedAt: record.reviewResolvedAt,
          action: record.reviewResolutionAction || 'RESOLVED_NOTES_ONLY',
          commissionDeductionApplied: Boolean(record.commissionDeductionApplied),
          commissionDeductedCents: record.commissionDeductedCents || 0,
          commissionDeductedBrl: record.commissionDeductedCents
            ? Number((record.commissionDeductedCents / 100).toFixed(2))
            : 0,
          auditedReferenceCents: record.auditedReferenceCents || null,
          auditedReferenceBrl: record.auditedReferenceCents
            ? Number((record.auditedReferenceCents / 100).toFixed(2))
            : null,
          commissionDeductionBatchId: record.commissionDeductionBatchId || null,
          sellerBlockedAtResolution: Boolean(record.sellerBlockedAtResolution),
        }
      : null,
    suspectedSelfScan: Boolean(record.suspectedSelfScan),
    selfScanReason: record.selfScanReason || null,
    deviceFingerprintHash: record.deviceFingerprintHash || null,
    commissionDeductionApplied: Boolean(record.commissionDeductionApplied),
    commissionDeductedCents: record.commissionDeductedCents || 0,
    commissionDeductedBrl: record.commissionDeductedCents
      ? Number((record.commissionDeductedCents / 100).toFixed(2))
      : 0,
    auditedReferenceCents: record.auditedReferenceCents || null,
    auditedReferenceBrl: record.auditedReferenceCents
      ? Number((record.auditedReferenceCents / 100).toFixed(2))
      : null,
    sellerId: record.sellerId,
    sellerName: (record.sale?.seller as any)?.name || null,
    sellerBlocked: Boolean((record.sale?.seller as any)?.sellerBlocked),
    sellerBlockedReason: (record.sale?.seller as any)?.sellerBlockedReason || null,
    sellerBlockedAtResolution: Boolean(record.sellerBlockedAtResolution),
    operationalBatch: operationalBatch
      ? {
          batchId: operationalBatch.id,
          batchName: operationalBatch.name,
          batchDate: operationalBatch.date,
          city: operationalBatch.city || null,
          photographerName: operationalBatch.photographer?.name || null,
        }
      : null,
    invalidationReason: record.invalidationReason || null,
    history: Array.isArray(history)
      ? history.map((h) => ({
          id: h.id,
          conditionsVersion: h.conditionsVersion,
          status: h.status,
          statusLabel: getConfirmationStatusLabel(h.status),
          hasDivergence: h.hasDivergence,
          sellerTotalBrl: Number((h.sellerTotalCents / 100).toFixed(2)),
          buyerReportedTotalBrl:
            h.reportedTotalCents !== null && h.reportedTotalCents !== undefined
              ? Number((h.reportedTotalCents / 100).toFixed(2))
              : null,
          usedAt: h.usedAt,
          invalidatedAt: h.invalidatedAt,
          invalidationReason: h.invalidationReason,
          createdAt: h.createdAt,
        }))
      : undefined,
  };
}

/**
 * Renderiza a página pública HTML responsiva (mobile-first) para o cliente responder no próprio celular,
 * incluindo o recibo formal "Registro de conferência do pedido — sem valor fiscal" após o envio.
 */
export function renderPublicBuyerConfirmationHtml(
  rawTokenOrObj:
    | string
    | {
        token: string;
        prompt?: any;
        errorMessage?: string;
        errorCode?: string;
      },
  maybePromptData?: any
): string {
  const esc = (s: string) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  if (typeof rawTokenOrObj === 'object' && rawTokenOrObj !== null && rawTokenOrObj.errorMessage) {
    const safeErrorMessage = INTERNAL_ERROR_LEAK_PATTERN.test(rawTokenOrObj.errorMessage)
      ? 'Link inválido ou não encontrado.'
      : rawTokenOrObj.errorMessage;
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Confirmação de Compra</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 20px; display: flex; justify-content: center; align-items: center; min-height: 90vh; }
    .card { max-width: 440px; width: 100%; background: #1e293b; border-radius: 14px; padding: 28px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); text-align: center; border: 1px solid #334155; }
    h1 { font-size: 1.25rem; color: #f87171; margin-top: 0; }
    p { font-size: 0.95rem; color: #cbd5e1; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Aviso</h1>
    <p>${esc(safeErrorMessage)}</p>
  </div>
</body>
</html>`;
  }

  const rawToken =
    typeof rawTokenOrObj === 'string' ? rawTokenOrObj : String(rawTokenOrObj?.token || '');
  const promptData =
    typeof rawTokenOrObj === 'object' && rawTokenOrObj !== null
      ? rawTokenOrObj.prompt || {
          companyName: 'Lumora',
          fichaCode: '---',
          buyerFirstName: 'Cliente',
          city: '',
          product: 'Mídias fotográficas',
          conditionsVersion: 1,
          requiresIdentityCheck: true,
          isCreditAgreement: false,
        }
      : maybePromptData || {
          companyName: 'Lumora',
          fichaCode: '---',
          buyerFirstName: 'Cliente',
          city: '',
          product: 'Mídias fotográficas',
          conditionsVersion: 1,
          requiresIdentityCheck: true,
          isCreditAgreement: false,
        };

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Confirmação de Compra — ${esc(promptData.companyName)}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 16px; display: flex; justify-content: center; }
    .container { max-width: 480px; width: 100%; margin: 16px auto; }
    .card { background: #1e293b; border-radius: 14px; padding: 24px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); border: 1px solid #334155; }
    h1 { font-size: 1.2rem; margin-top: 0; color: #38bdf8; display: flex; align-items: center; gap: 8px; }
    p { font-size: 0.9rem; color: #cbd5e1; line-height: 1.45; margin: 8px 0; }
    .badge { display: inline-block; background: #0284c7; color: #fff; font-size: 0.75rem; padding: 3px 8px; border-radius: 9999px; font-weight: 600; }
    .meta { background: #0f172a; padding: 12px; border-radius: 8px; font-size: 0.85rem; color: #94a3b8; margin: 16px 0; border: 1px solid #1e293b; }
    .meta strong { color: #f1f5f9; }
    label { display: block; margin-top: 14px; margin-bottom: 6px; font-weight: 600; font-size: 0.87rem; color: #e2e8f0; }
    .help { font-size: 0.78rem; color: #94a3b8; margin-top: -3px; margin-bottom: 6px; }
    input, select, textarea { width: 100%; box-sizing: border-box; padding: 12px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #f8fafc; font-size: 0.95rem; }
    input:focus, select:focus, textarea:focus { outline: none; border-color: #38bdf8; box-shadow: 0 0 0 2px rgba(56,189,248,0.25); }
    button { margin-top: 22px; width: 100%; padding: 14px; border: none; border-radius: 8px; background: #0284c7; color: #fff; font-weight: 700; font-size: 1rem; cursor: pointer; transition: background 0.15s; }
    button:hover { background: #0369a1; }
    button:disabled { background: #475569; cursor: not-allowed; }
    #msg { margin-top: 16px; font-weight: 600; text-align: center; font-size: 0.95rem; }
    .receipt { display: none; background: #0f172a; border: 1px dashed #38bdf8; border-radius: 12px; padding: 20px; margin-top: 20px; }
    .receipt h2 { font-size: 1.05rem; margin-top: 0; color: #38bdf8; text-align: center; border-bottom: 1px solid #334155; padding-bottom: 10px; }
    .receipt-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 0.88rem; border-bottom: 1px solid #1e293b; }
    .receipt-label { color: #94a3b8; }
    .receipt-value { font-weight: 600; color: #f8fafc; }
    .receipt-disclaimer { margin-top: 14px; font-size: 0.75rem; color: #64748b; text-align: center; line-height: 1.3; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card" id="formCard">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h1>${esc(promptData.companyName)}</h1>
        <span class="badge">Conferência Segura</span>
      </div>
      <p>Olá, <strong>${esc(promptData.buyerFirstName)}</strong>! Para a segurança e garantia da sua compra, informe abaixo os valores combinados diretamente com o vendedor.</p>
      
      <div class="meta">
        <div>Ficha / Pedido: <strong>${esc(promptData.fichaCode)}</strong></div>
        <div>Cidade: <strong>${esc(promptData.city || '---')}</strong> | Produto: <strong>${esc(promptData.product)}</strong></div>
      </div>

      <form id="confirmForm">
        ${
          promptData.requiresIdentityCheck
            ? `
        <label for="phoneLast4">4 últimos dígitos do seu telefone ou CPF cadastrado</label>
        <div class="help">Utilizado exclusivamente para confirmar que você é o titular desta ficha.</div>
        <input id="phoneLast4" name="phoneLast4" type="text" inputmode="numeric" maxlength="4" placeholder="Ex: 5678" required />
        `
            : ''
        }

        <label for="reportedTotalValue">Valor total combinado da compra (R$)</label>
        <div class="help">Informe o valor total acertado pelo pedido completo.</div>
        <input id="reportedTotalValue" name="reportedTotalValue" type="number" step="0.01" min="0.01" placeholder="Ex: 1150.00" required />

        <label for="reportedPaidValue">Quanto você já pagou de entrada ou à vista (R$)</label>
        <div class="help">Caso não tenha pago nada de entrada, digite 0.</div>
        <input id="reportedPaidValue" name="reportedPaidValue" type="number" step="0.01" min="0" placeholder="Ex: 150.00" required />

        <label for="reportedPaymentMethod">Forma de pagamento combinada</label>
        <select id="reportedPaymentMethod" name="reportedPaymentMethod" required>
          <option value="">Selecione...</option>
          <option value="PIX">Pix</option>
          <option value="CASH">Dinheiro / Espécie</option>
          <option value="CREDIT">Cartão de Crédito</option>
          <option value="DEBIT">Cartão de Débito</option>
          <option value="CREDIARIO">Crediário / Carnê / Boleto</option>
          <option value="SPLIT">Pagamento Combinado (Mais de uma forma)</option>
        </select>

        <div id="creditFields" style="${promptData.isCreditAgreement ? 'display:block;' : 'display:none;'} margin-top: 10px; padding: 12px; background: #0f172a; border-radius: 8px; border: 1px solid #334155;">
          <div style="font-weight:700; font-size:0.85rem; color:#38bdf8; margin-bottom:8px;">Condições do Crediário / Parcelamento:</div>
          
          <label for="reportedRemainingValue">Saldo restante a pagar (R$)</label>
          <input id="reportedRemainingValue" name="reportedRemainingValue" type="number" step="0.01" min="0" placeholder="Ex: 1000.00" />

          <label for="reportedInstallmentsCount">Quantidade de parcelas</label>
          <input id="reportedInstallmentsCount" name="reportedInstallmentsCount" type="number" step="1" min="1" placeholder="Ex: 10" />

          <label for="reportedInstallmentValue">Valor de cada parcela (R$)</label>
          <input id="reportedInstallmentValue" name="reportedInstallmentValue" type="number" step="0.01" min="0" placeholder="Ex: 100.00" />
        </div>

        <button type="submit" id="submitBtn">Confirmar Dados da Compra</button>
        <div id="msg"></div>
      </form>
    </div>

    <!-- Recibo formal de conferência -->
    <div class="card receipt" id="receiptCard">
      <h2>Registro de conferência do pedido — sem valor fiscal</h2>
      <div id="receiptContent"></div>
      <div class="receipt-disclaimer">
        Documento emitido exclusivamente para fins de conferência operacional entre cliente e empresa. Não possui valor fiscal nem quita obrigações tributárias.
      </div>
    </div>
  </div>

  <script>
    const form = document.getElementById('confirmForm');
    const methodSelect = document.getElementById('reportedPaymentMethod');
    const creditBox = document.getElementById('creditFields');
    const msg = document.getElementById('msg');
    const btn = document.getElementById('submitBtn');
    const formCard = document.getElementById('formCard');
    const receiptCard = document.getElementById('receiptCard');
    const receiptContent = document.getElementById('receiptContent');

    methodSelect.addEventListener('change', () => {
      if (methodSelect.value === 'CREDIARIO') {
        creditBox.style.display = 'block';
      } else if (!${promptData.isCreditAgreement}) {
        creditBox.style.display = 'none';
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true;
      msg.style.color = '#38bdf8';
      msg.textContent = 'Enviando conferência...';

      let deviceFingerprint = '';
      try {
        let storedFp = localStorage.getItem('lumora_dev_fp');
        if (!storedFp) {
          storedFp = 'fp_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
          localStorage.setItem('lumora_dev_fp', storedFp);
        }
        deviceFingerprint = [storedFp, navigator.userAgent, screen.width + 'x' + screen.height, navigator.language].join('::');
      } catch (err) {
        deviceFingerprint = navigator.userAgent || '';
      }

      const payload = {
        deviceFingerprint,
        phoneLast4: document.getElementById('phoneLast4') ? document.getElementById('phoneLast4').value.trim() : undefined,
        reportedTotalValue: document.getElementById('reportedTotalValue').value,
        reportedPaidValue: document.getElementById('reportedPaidValue').value,
        reportedPaymentMethod: document.getElementById('reportedPaymentMethod').value,
        reportedRemainingValue: document.getElementById('reportedRemainingValue') ? document.getElementById('reportedRemainingValue').value : undefined,
        reportedInstallmentsCount: document.getElementById('reportedInstallmentsCount') ? document.getElementById('reportedInstallmentsCount').value : undefined,
        reportedInstallmentValue: document.getElementById('reportedInstallmentValue') ? document.getElementById('reportedInstallmentValue').value : undefined,
      };

      try {
        const res = await fetch('/api/sales/public/confirm/${esc(rawToken)}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (res.ok && data.received) {
          formCard.style.display = 'none';
          receiptCard.style.display = 'block';

          const r = data.receipt || {};
          let html = '';
          html += '<div class="receipt-row"><span class="receipt-label">Código de Referência:</span><span class="receipt-value">' + (r.referenceCode || '${esc(promptData.fichaCode)}') + '</span></div>';
          html += '<div class="receipt-row"><span class="receipt-label">Empresa:</span><span class="receipt-value">' + (r.companyName || '${esc(promptData.companyName)}') + '</span></div>';
          html += '<div class="receipt-row"><span class="receipt-label">Titular:</span><span class="receipt-value">' + (r.clientName || '${esc(promptData.buyerFirstName)}') + '</span></div>';
          html += '<div class="receipt-row"><span class="receipt-label">Data do Registro:</span><span class="receipt-value">' + new Date().toLocaleString('pt-BR') + '</span></div>';
          html += '<div class="receipt-row"><span class="receipt-label">Total Declarado:</span><span class="receipt-value">' + (r.reportedTotalBrl || '') + '</span></div>';
          html += '<div class="receipt-row"><span class="receipt-label">Pago no Ato / Entrada:</span><span class="receipt-value">' + (r.reportedPaidBrl || '') + '</span></div>';
          html += '<div class="receipt-row"><span class="receipt-label">Forma de Pagamento:</span><span class="receipt-value">' + (r.reportedPaymentMethod || '') + '</span></div>';

          if (r.creditDetails) {
            html += '<div class="receipt-row"><span class="receipt-label">Saldo a Parcelar:</span><span class="receipt-value">' + r.creditDetails.reportedRemainingBrl + '</span></div>';
            html += '<div class="receipt-row"><span class="receipt-label">Parcelas:</span><span class="receipt-value">' + r.creditDetails.reportedInstallmentsCount + 'x de ' + r.creditDetails.reportedInstallmentBrl + '</span></div>';
          }

          receiptContent.innerHTML = html;
        } else {
          msg.style.color = '#f87171';
          msg.textContent = data.error || 'Não foi possível enviar a confirmação.';
          btn.disabled = false;
        }
      } catch (err) {
        msg.style.color = '#f87171';
        msg.textContent = 'Erro de conexão. Verifique sua internet e tente novamente.';
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}
