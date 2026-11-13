import { prisma, Prisma } from './prisma';
import {
  assertSerasaSandboxEnvironment,
  checkAsaasChargesBalanceForAgreement,
  sendAsaasSerasaNegativationRequest,
  sendAsaasSerasaNegativationRemoval,
  AsaasDualBalanceResult,
} from './asaasService';
import { recordOperationalAuditEvent } from './operationalAuditService';

export const SERASA_STATES = [
  'ELEGIVEL',
  'SOLICITACAO_ENVIADA',
  'EM_ANDAMENTO',
  'NEGATIVACAO_CONFIRMADA',
  'RECUSA',
  'CANCELAMENTO',
  'PAGAMENTO_REGISTRADO_COMUNICACAO_PENDENTE',
] as const;

export type SerasaStatus = (typeof SERASA_STATES)[number];

export const ACTIVE_IN_FLIGHT_SERASA_STATES: SerasaStatus[] = [
  'SOLICITACAO_ENVIADA',
  'EM_ANDAMENTO',
  'NEGATIVACAO_CONFIRMADA',
  'PAGAMENTO_REGISTRADO_COMUNICACAO_PENDENTE',
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const BRT_OFFSET_MS = -3 * 60 * 60 * 1000;
const MIN_OVERDUE_DAYS_FOR_SERASA = 30;
const SUMULA_548_BUSINESS_DAYS = 5;
const SUMULA_359_PRIOR_NOTICE_BUSINESS_DAYS = 10;

export const SUMULA_359_NOTE =
  'Súmula 359 STJ: a notificação prévia ao consumidor antes da efetiva inscrição é obrigação do órgão mantenedor do cadastro (Serasa).';
export const SUMULA_548_NOTE =
  'Súmula 548 STJ: após quitação integral ou renegociação válida, incumbe ao credor solicitar a exclusão em até 5 dias úteis.';

export function getSerasaStatusLabel(status: string): string {
  switch (status) {
    case 'ELEGIVEL':
      return 'Elegível para envio (30d+)';
    case 'SOLICITACAO_ENVIADA':
      return 'Solicitação enviada (Sandbox)';
    case 'EM_ANDAMENTO':
      return 'Em andamento (Súmula 359 STJ)';
    case 'NEGATIVACAO_CONFIRMADA':
      return 'Negativação confirmada';
    case 'RECUSA':
      return 'Recusada pelo birô / pré-validação';
    case 'CANCELAMENTO':
      return 'Baixada / Cancelada (Súmula 548 STJ)';
    case 'PAGAMENTO_REGISTRADO_COMUNICACAO_PENDENTE':
      return 'Pagamento registrado — comunicação pendente';
    default:
      return 'Inelegível / Fora do critério';
  }
}

/**
 * Normaliza uma data para o início do dia no fuso de Brasília (UTC-03:00),
 * garantindo contagem exata de dias corridos sem deriva de horário.
 */
function toBrtDayMs(date: Date): number {
  const shifted = new Date(date.getTime() + BRT_OFFSET_MS);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

/**
 * Soma N dias úteis (segunda a sexta) preservando a conformidade da Súmula 548 STJ (5 dias úteis).
 */
export function addBusinessDays(startDate: Date, businessDays: number): Date {
  const result = new Date(startDate.getTime());
  let added = 0;
  while (added < businessDays) {
    result.setUTCDate(result.getUTCDate() + 1);
    const utcDay = new Date(result.getTime() + BRT_OFFSET_MS).getUTCDay();
    if (utcDay !== 0 && utcDay !== 6) {
      added++;
    }
  }
  return result;
}

function isConcurrencyError(err: any): boolean {
  const code = err?.code;
  const msg = String(err?.message || '').toLowerCase();
  return (
    code === 'P2034' ||
    msg.includes('could not serialize') ||
    msg.includes('deadlock detected') ||
    msg.includes('write conflict')
  );
}

export interface SerasaEligibilityReport {
  eligible: boolean;
  derivedStatus: 'ELEGIVEL' | 'INELEGIVEL';
  reasons: string[];
  blockCodes: string[];
  maxOverdueDays: number;
  overdue30PlusInstallmentsCount: number;
  overdue30PlusAmountCents: number;
  earliestOverdue30PlusInstallmentId: string | null;
  lumoraLedgerBalanceCents: number;
  lumoraStoredBalanceCents: number;
  installmentsOpenTotalCents: number;
  validPaymentsTotalCents: number;
  hasSignedProof: boolean;
  qrConfirmationStatus: string | null;
  hasPendingQrDivergence: boolean;
  isContractedSale: boolean;
  hasActiveNegativation: boolean;
}

const AGREEMENT_SERASA_INCLUDE = {
  client: {
    select: {
      id: true,
      name: true,
      phone1: true,
      outcomeStatus: true,
      visibleCode: true,
      sequenceNumber: true,
    },
  },
  seller: {
    select: {
      id: true,
      name: true,
      sellerBlocked: true,
    },
  },
  sale: {
    select: {
      id: true,
      value: true,
      status: true,
      paymentStatus: true,
      receiptUrl: true,
      sheetPhotoUrl: true,
      buyerConfirmations: {
        orderBy: { conditionsVersion: 'desc' as const },
        take: 5,
      },
    },
  },
  installments: {
    orderBy: { installmentNumber: 'asc' as const },
    include: {
      asaasCharge: {
        select: {
          id: true,
          externalId: true,
          status: true,
          nominalValueCents: true,
        },
      },
    },
  },
  payments: {
    where: { isReversed: false },
    select: {
      id: true,
      amountCents: true,
      principalPaidCents: true,
      chargesPaidCents: true,
      paymentMethod: true,
      paidAt: true,
    },
  },
  negativationRecords: {
    orderBy: { createdAt: 'desc' as const },
  },
} satisfies Prisma.CreditAgreementInclude;

export type LoadedAgreementForSerasa = Prisma.CreditAgreementGetPayload<{
  include: typeof AGREEMENT_SERASA_INCLUDE;
}>;

/**
 * Avalia estritamente os critérios jurídicos e contábeis do Lumora para negativação no Serasa:
 * 1. Contrato ativo/renegociado (jamais SETTLED ou CANCELLED) com saldo > 0.
 * 2. Venda efetivamente contratada (outcomeStatus === 'SOLD', jamais autorização de foto/book/não-venda).
 * 3. Comprovante válido ou confirmação QR sem divergência pendente de resolução administrativa.
 * 4. Pelo menos uma parcela em aberto vencida há >= 30 dias corridos.
 * 5. Consistência integral do livro-razão (pagamentos diretos/"por fora" e renegociações descontados).
 */
export function evaluateAgreementSerasaEligibility(
  agreement: LoadedAgreementForSerasa,
  referenceNow: Date = new Date()
): SerasaEligibilityReport {
  const reasons: string[] = [];
  const blockCodes: string[] = [];

  const isContractedSale = agreement.client?.outcomeStatus === 'SOLD' && Boolean(agreement.sale);
  if (!isContractedSale) {
    blockCodes.push('NOT_A_CONTRACTED_SALE');
    reasons.push(
      `Somente vendas efetivamente contratadas (outcomeStatus=SOLD) podem ser negativadas (atual: ${agreement.client?.outcomeStatus || 'INDEFINIDO'}). Autorização de foto, apresentação de book ou não-venda não geram elegibilidade.`
    );
  }

  if (agreement.status === 'SETTLED' || agreement.status === 'CANCELLED') {
    blockCodes.push('CONTRACT_ALREADY_SETTLED_OR_CANCELLED');
    reasons.push(`Contrato encontra-se ${agreement.status}, sem débito passível de negativação.`);
  }

  if (
    agreement.sale &&
    (agreement.sale.status === 'CANCELLED' || agreement.sale.paymentStatus === 'CANCELLED')
  ) {
    blockCodes.push('SALE_CANCELLED');
    reasons.push('A venda vinculada ao contrato está cancelada.');
  }

  // Verificar comprovante / confirmação QR e bloqueio de divergência pendente
  const confirmations = agreement.sale?.buyerConfirmations || [];
  const latestRelevantConfirmation =
    confirmations.find((c) => c.status !== 'INVALIDATED') || confirmations[0] || null;

  const hasPendingQrDivergence = Boolean(
    latestRelevantConfirmation &&
      (latestRelevantConfirmation.status === 'UNDER_REVIEW' ||
        (latestRelevantConfirmation.hasDivergence && !latestRelevantConfirmation.reviewResolvedAt) ||
        (latestRelevantConfirmation.suspectedSelfScan && !latestRelevantConfirmation.reviewResolvedAt))
  );

  if (hasPendingQrDivergence) {
    blockCodes.push('PENDING_QR_DIVERGENCE_RESOLUTION');
    reasons.push(
      'Venda com divergência ou alerta de conferência por QR pendente de conclusão administrativa.'
    );
  }

  if (latestRelevantConfirmation?.reviewResolutionAction === 'SALE_CANCELLED') {
    blockCodes.push('QR_ADMIN_REVIEW_CANCELLED_SALE');
    reasons.push('A conferência administrativa de QR cancelou ou invalidou a venda.');
  }

  const hasSignedProof = Boolean(
    agreement.signedAgreementUrl ||
      agreement.sale?.receiptUrl ||
      agreement.sale?.sheetPhotoUrl
  );

  const hasValidQrConfirmation = Boolean(
    latestRelevantConfirmation &&
      (latestRelevantConfirmation.status === 'CONFIRMED' ||
        latestRelevantConfirmation.status === 'ADMIN_EXCEPTION' ||
        Boolean(latestRelevantConfirmation.reviewResolvedAt))
  );

  if (!hasSignedProof && !hasValidQrConfirmation) {
    blockCodes.push('MISSING_PURCHASE_PROOF_OR_CONFIRMATION');
    reasons.push(
      'Contrato não possui comprovante de compra/contrato assinado nem confirmação válida do comprador.'
    );
  }

  // Cálculo em centavos no livro-razão do Lumora (descontando pagamentos diretos/"por fora" e renegociações)
  const expectedAgreementTotalCents =
    agreement.financedPrincipalCents + (agreement.renegotiationChargesCents || 0);
  const validPaymentsTotalCents = (agreement.payments || []).reduce(
    (acc, p) => acc + Math.max(0, p.amountCents || 0),
    0
  );
  const lumoraLedgerBalanceCents = Math.max(0, expectedAgreementTotalCents - validPaymentsTotalCents);
  const lumoraStoredBalanceCents = Math.max(
    0,
    (agreement.remainingPrincipalCents || 0) + (agreement.remainingChargesCents || 0)
  );

  const openInstallments = (agreement.installments || []).filter(
    (i) => i.status !== 'PAID' && i.status !== 'RENEGOTIATED' && Math.max(0, i.amountCents - i.paidCents) > 0
  );

  const installmentsOpenTotalCents = openInstallments.reduce(
    (acc, i) => acc + Math.max(0, i.amountCents - i.paidCents),
    0
  );

  if (lumoraLedgerBalanceCents <= 0 || lumoraStoredBalanceCents <= 0 || installmentsOpenTotalCents <= 0) {
    blockCodes.push('DEBT_ALREADY_PAID_IN_LUMORA_LEDGER');
    reasons.push('Saldo devedor zerado no livro-razão do Lumora (incluindo pagamentos diretos/por fora).');
  } else if (
    lumoraLedgerBalanceCents !== lumoraStoredBalanceCents ||
    lumoraLedgerBalanceCents !== installmentsOpenTotalCents
  ) {
    blockCodes.push('LUMORA_LEDGER_INCONSISTENCY');
    reasons.push(
      `Divergência interna de saldo no Lumora (razão=${lumoraLedgerBalanceCents}c, contrato=${lumoraStoredBalanceCents}c, parcelas=${installmentsOpenTotalCents}c).`
    );
  }

  // Regra estrita dos >= 30 dias corridos de atraso
  const todayDayMs = toBrtDayMs(referenceNow);
  let maxOverdueDays = 0;
  let overdue30PlusInstallmentsCount = 0;
  let overdue30PlusAmountCents = 0;
  let earliestOverdue30PlusInstallmentId: string | null = null;

  for (const inst of openInstallments) {
    const dueDayMs = toBrtDayMs(new Date(inst.dueDate));
    const daysPastDue = Math.floor((todayDayMs - dueDayMs) / MS_PER_DAY);
    if (daysPastDue > maxOverdueDays) {
      maxOverdueDays = daysPastDue;
    }
    if (daysPastDue >= MIN_OVERDUE_DAYS_FOR_SERASA) {
      overdue30PlusInstallmentsCount++;
      overdue30PlusAmountCents += Math.max(0, inst.amountCents - inst.paidCents);
      if (!earliestOverdue30PlusInstallmentId) {
        earliestOverdue30PlusInstallmentId = inst.id;
      }
    }
  }

  if (overdue30PlusInstallmentsCount === 0 || overdue30PlusAmountCents <= 0) {
    blockCodes.push('MIN_30_DAYS_OVERDUE_NOT_MET');
    reasons.push(
      `A negativação exige ao menos 30 dias corridos de atraso no vencimento (atraso máximo atual: ${Math.max(0, maxOverdueDays)} dia(s)).`
    );
  }

  const activeRecord = (agreement.negativationRecords || []).find((r) =>
    ACTIVE_IN_FLIGHT_SERASA_STATES.includes(r.status as SerasaStatus)
  );
  const hasActiveNegativation = Boolean(activeRecord);

  const eligible = blockCodes.length === 0;

  return {
    eligible,
    derivedStatus: eligible ? 'ELEGIVEL' : 'INELEGIVEL',
    reasons,
    blockCodes,
    maxOverdueDays: Math.max(0, maxOverdueDays),
    overdue30PlusInstallmentsCount,
    overdue30PlusAmountCents,
    earliestOverdue30PlusInstallmentId,
    lumoraLedgerBalanceCents,
    lumoraStoredBalanceCents,
    installmentsOpenTotalCents,
    validPaymentsTotalCents,
    hasSignedProof,
    qrConfirmationStatus: latestRelevantConfirmation?.status || null,
    hasPendingQrDivergence,
    isContractedSale,
    hasActiveNegativation,
  };
}

/**
 * Executa dupla conferência automática de saldo:
 * (a) livro-razão Lumora + (b) cobranças Asaas em Sandbox (nunca LIVE).
 */
export async function performDualBalanceVerification(
  companyId: string,
  agreement: LoadedAgreementForSerasa,
  eligibility: SerasaEligibilityReport
): Promise<{
  passed: boolean;
  blockCode: string | null;
  blockMessage: string | null;
  lumoraBalanceCents: number;
  asaas: AsaasDualBalanceResult;
}> {
  const asaas = await checkAsaasChargesBalanceForAgreement(companyId, {
    agreementId: agreement.id,
    lumoraRemainingTotalCents: eligibility.lumoraLedgerBalanceCents,
    installments: agreement.installments,
  });

  if (!asaas.dualCheckPassed) {
    return {
      passed: false,
      blockCode: asaas.blockCode || 'ASAAS_DUAL_CHECK_FAILED',
      blockMessage: asaas.blockMessage || 'Falha na dupla conferência com o Asaas Sandbox.',
      lumoraBalanceCents: eligibility.lumoraLedgerBalanceCents,
      asaas,
    };
  }

  if (eligibility.lumoraLedgerBalanceCents <= 0) {
    return {
      passed: false,
      blockCode: 'DEBT_ALREADY_PAID_IN_LUMORA_LEDGER',
      blockMessage: 'Débito já quitado no livro-razão do Lumora.',
      lumoraBalanceCents: 0,
      asaas,
    };
  }

  return {
    passed: true,
    blockCode: null,
    blockMessage: null,
    lumoraBalanceCents: eligibility.lumoraLedgerBalanceCents,
    asaas,
  };
}

function serializeAgreementSummary(
  agreement: LoadedAgreementForSerasa,
  eligibility: SerasaEligibilityReport
) {
  const latestRecord = agreement.negativationRecords[0] || null;
  const effectiveStatus = latestRecord
    ? latestRecord.status
    : eligibility.eligible
    ? 'ELEGIVEL'
    : 'INELEGIVEL';

  return {
    agreementId: agreement.id,
    saleId: agreement.saleId,
    clientId: agreement.clientId,
    buyerName: agreement.buyerName,
    buyerCpf: agreement.buyerCpf,
    sellerId: agreement.sellerId,
    sellerName: agreement.seller?.name || null,
    fichaCode: agreement.client?.visibleCode || agreement.client?.sequenceNumber || null,
    agreementStatus: agreement.status,
    effectiveSerasaStatus: effectiveStatus,
    effectiveSerasaStatusLabel: getSerasaStatusLabel(effectiveStatus),
    productionLocked: true,
    environment: 'SANDBOX',
    eligibility,
    latestRecord: latestRecord ? serializeNegativationRecord(latestRecord) : null,
    sumula359Note: SUMULA_359_NOTE,
    sumula548Note: SUMULA_548_NOTE,
  };
}

export function serializeNegativationRecord(record: any) {
  return {
    id: record.id,
    companyId: record.companyId,
    agreementId: record.agreementId,
    installmentId: record.installmentId,
    environment: record.environment,
    bureau: record.bureau,
    status: record.status,
    statusLabel: getSerasaStatusLabel(record.status),
    overdueAmountCents: record.overdueAmountCents,
    lumoraVerifiedBalanceCents: record.lumoraVerifiedBalanceCents,
    asaasVerifiedBalanceCents: record.asaasVerifiedBalanceCents,
    protocolNumber: record.protocolNumber,
    externalNegativationId: record.externalNegativationId,
    requestReason: record.requestReason,
    requestedByUserId: record.requestedByUserId,
    requestedByName: record.requestedByName,
    requestedAt: record.requestedAt,
    priorNotificationResponsible: record.priorNotificationResponsible,
    priorNotificationExpectedBy: record.priorNotificationExpectedBy,
    priorNotificationConfirmedAt: record.priorNotificationConfirmedAt,
    emAndamentoAt: record.emAndamentoAt,
    confirmedAt: record.confirmedAt,
    confirmedBySource: record.confirmedBySource,
    refusalReason: record.refusalReason,
    refusedAt: record.refusedAt,
    removalReason: record.removalReason,
    removalRequestedByUserId: record.removalRequestedByUserId,
    removalRequestedAt: record.removalRequestedAt,
    legalRemovalDeadlineAt: record.legalRemovalDeadlineAt,
    removalConfirmedAt: record.removalConfirmedAt,
    removalProtocolNumber: record.removalProtocolNumber,
    communicationAttempts: record.communicationAttempts,
    lastCommunicationError: record.lastCommunicationError,
    lastCommunicationAttemptAt: record.lastCommunicationAttemptAt,
    notes: record.notes,
    eligibilitySnapshot: record.eligibilitySnapshot,
    balanceCheckSnapshot: record.balanceCheckSnapshot,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Lista contratos da empresa para o painel Serasa com filtro opcional pelos 7 estados.
 */
export async function listSerasaAgreements(
  companyId: string,
  options?: { status?: string; search?: string }
) {
  const agreements = await prisma.creditAgreement.findMany({
    where: { companyId },
    include: AGREEMENT_SERASA_INCLUDE,
    orderBy: { updatedAt: 'desc' },
    take: 250,
  });

  const now = new Date();
  const counts: Record<string, number> = {
    ELEGIVEL: 0,
    SOLICITACAO_ENVIADA: 0,
    EM_ANDAMENTO: 0,
    NEGATIVACAO_CONFIRMADA: 0,
    RECUSA: 0,
    CANCELAMENTO: 0,
    PAGAMENTO_REGISTRADO_COMUNICACAO_PENDENTE: 0,
    INELEGIVEL: 0,
  };

  const summaries = agreements.map((ag) => {
    const eligibility = evaluateAgreementSerasaEligibility(ag, now);
    const item = serializeAgreementSummary(ag, eligibility);
    counts[item.effectiveSerasaStatus] = (counts[item.effectiveSerasaStatus] || 0) + 1;
    return item;
  });

  const statusFilter = options?.status ? String(options.status).trim().toUpperCase() : '';
  const searchFilter = options?.search ? String(options.search).trim().toLowerCase() : '';

  const filtered = summaries.filter((item) => {
    if (statusFilter && statusFilter !== 'ALL' && item.effectiveSerasaStatus !== statusFilter) {
      return false;
    }
    if (searchFilter) {
      const hay = `${item.buyerName} ${item.buyerCpf} ${item.fichaCode || ''}`.toLowerCase();
      if (!hay.includes(searchFilter)) return false;
    }
    return true;
  });

  return {
    environment: 'SANDBOX',
    productionLocked: true,
    counts,
    total: filtered.length,
    sumula359Note: SUMULA_359_NOTE,
    sumula548Note: SUMULA_548_NOTE,
    items: filtered,
  };
}

/**
 * Retorna diagnóstico completo de elegibilidade, dupla conferência e histórico Serasa de um contrato.
 */
export async function getAgreementSerasaDetails(companyId: string, agreementId: string) {
  const agreement = await prisma.creditAgreement.findFirst({
    where: { id: agreementId, companyId },
    include: AGREEMENT_SERASA_INCLUDE,
  });
  if (!agreement) {
    const err: any = new Error('Contrato de crediário não encontrado para esta empresa.');
    err.status = 404;
    err.code = 'AGREEMENT_NOT_FOUND';
    throw err;
  }

  const eligibility = evaluateAgreementSerasaEligibility(agreement, new Date());
  const dualBalance = await performDualBalanceVerification(companyId, agreement, eligibility);

  return {
    ...serializeAgreementSummary(agreement, eligibility),
    dualBalance,
    records: agreement.negativationRecords.map(serializeNegativationRecord),
  };
}

/**
 * Cria e envia solicitação auditada de negativação Serasa (exclusivamente Sandbox).
 * Exige idempotencyKey, transação Serializable + FOR UPDATE, elegibilidade >= 30d + venda contratada + dupla conferência.
 */
export async function requestSerasaNegativation(params: {
  companyId: string;
  agreementId: string;
  requestedEnvironment?: string | null;
  requestedByUserId: string;
  requestedByName: string;
  requestedByRole?: string | null;
  reason: string;
  idempotencyKey: string;
  notes?: string | null;
  ipAddress?: string | null;
}) {
  assertSerasaSandboxEnvironment(params.requestedEnvironment);

  const normalizedKey = String(params.idempotencyKey || '').trim();
  if (!normalizedKey) {
    const err: any = new Error('Chave de idempotência (idempotencyKey) é obrigatória para solicitar negativação.');
    err.status = 400;
    err.code = 'IDEMPOTENCY_KEY_REQUIRED';
    throw err;
  }

  const trimmedReason = String(params.reason || '').trim();
  if (trimmedReason.length < 5) {
    const err: any = new Error('Justificativa auditada (reason, mínimo 5 caracteres) é obrigatória.');
    err.status = 400;
    err.code = 'REASON_REQUIRED';
    throw err;
  }

  // 1. Pre-check idempotente
  const existingPre = await prisma.creditNegativationRecord.findUnique({
    where: { idempotencyKey: normalizedKey },
  });
  if (existingPre) {
    if (existingPre.companyId !== params.companyId || existingPre.agreementId !== params.agreementId) {
      const err: any = new Error('Chave de idempotência já utilizada em outro contrato ou empresa.');
      err.status = 409;
      err.code = 'IDEMPOTENCY_KEY_CONFLICT';
      throw err;
    }
    return {
      statusCode: 200,
      idempotentReplay: true,
      record: serializeNegativationRecord(existingPre),
    };
  }

  // 2. Carregar contrato e validar elegibilidade + dupla conferência externa em Sandbox antes da reserva serializável
  const preAgreement = await prisma.creditAgreement.findFirst({
    where: { id: params.agreementId, companyId: params.companyId },
    include: AGREEMENT_SERASA_INCLUDE,
  });
  if (!preAgreement) {
    const err: any = new Error('Contrato de crediário não encontrado.');
    err.status = 404;
    err.code = 'AGREEMENT_NOT_FOUND';
    throw err;
  }

  const preEligibility = evaluateAgreementSerasaEligibility(preAgreement, new Date());
  if (preEligibility.hasActiveNegativation) {
    const err: any = new Error(
      'Já existe uma solicitação ou negativação ativa/pendente para este contrato.'
    );
    err.status = 409;
    err.code = 'NEGATIVATION_ALREADY_ACTIVE_OR_PENDING';
    throw err;
  }

  if (!preEligibility.eligible) {
    const err: any = new Error(preEligibility.reasons[0] || 'Contrato inelegível para negativação Serasa.');
    err.status = 400;
    err.code = preEligibility.blockCodes[0] || 'SERASA_INELIGIBLE';
    err.details = preEligibility;
    throw err;
  }

  const dualBalance = await performDualBalanceVerification(params.companyId, preAgreement, preEligibility);
  if (!dualBalance.passed) {
    const err: any = new Error(dualBalance.blockMessage || 'Dupla conferência bloqueou o envio ao Serasa.');
    err.status = 409;
    err.code = dualBalance.blockCode || 'DUAL_BALANCE_BLOCKED';
    err.details = dualBalance;
    throw err;
  }

  // 3. Reserva e persistência sob transação Serializable + bloqueio pessimista (FOR UPDATE)
  let createdRecord: any;
  try {
    const txOutcome = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "CreditAgreement" WHERE id = ${params.agreementId} AND "companyId" = ${params.companyId} FOR UPDATE`;

        const existingInTx = await tx.creditNegativationRecord.findUnique({
          where: { idempotencyKey: normalizedKey },
        });
        if (existingInTx) {
          if (existingInTx.companyId !== params.companyId || existingInTx.agreementId !== params.agreementId) {
            const err: any = new Error('Chave de idempotência em conflito com outro contrato.');
            err.status = 409;
            err.code = 'IDEMPOTENCY_KEY_CONFLICT';
            throw err;
          }
          return { replay: true as const, record: existingInTx };
        }

        const freshAgreement = await tx.creditAgreement.findFirst({
          where: { id: params.agreementId, companyId: params.companyId },
          include: AGREEMENT_SERASA_INCLUDE,
        });
        if (!freshAgreement) {
          const err: any = new Error('Contrato não encontrado.');
          err.status = 404;
          err.code = 'AGREEMENT_NOT_FOUND';
          throw err;
        }

        const freshEligibility = evaluateAgreementSerasaEligibility(freshAgreement, new Date());
        if (freshEligibility.hasActiveNegativation) {
          const err: any = new Error(
            'Solicitação concorrente detectada: este contrato já possui negativação em curso.'
          );
          err.status = 409;
          err.code = 'NEGATIVATION_ALREADY_ACTIVE_OR_PENDING';
          throw err;
        }
        if (!freshEligibility.eligible) {
          const err: any = new Error(
            freshEligibility.reasons[0] || 'Contrato deixou de ser elegível durante a transação.'
          );
          err.status = 400;
          err.code = freshEligibility.blockCodes[0] || 'SERASA_INELIGIBLE';
          throw err;
        }

        const firstOverdueCharge =
          freshAgreement.installments.find(
            (i) => i.id === freshEligibility.earliestOverdue30PlusInstallmentId
          )?.asaasCharge?.externalId || null;

        // Chamada ao adaptador Sandbox (nunca LIVE)
        const bureauResp = await sendAsaasSerasaNegativationRequest(params.companyId, {
          agreementId: freshAgreement.id,
          buyerCpf: freshAgreement.buyerCpf,
          buyerName: freshAgreement.buyerName,
          overdueAmountCents: freshEligibility.overdue30PlusAmountCents,
          externalChargeId: firstOverdueCharge,
          idempotencyKey: normalizedKey,
          requestedEnvironment: 'SANDBOX',
        });

        const now = new Date();
        const initialStatus: SerasaStatus = bureauResp.refused ? 'RECUSA' : 'SOLICITACAO_ENVIADA';

        const created = await tx.creditNegativationRecord.create({
          data: {
            companyId: params.companyId,
            agreementId: freshAgreement.id,
            installmentId: freshEligibility.earliestOverdue30PlusInstallmentId,
            environment: 'SANDBOX',
            bureau: 'SERASA',
            status: initialStatus,
            overdueAmountCents: freshEligibility.overdue30PlusAmountCents,
            lumoraVerifiedBalanceCents: freshEligibility.lumoraLedgerBalanceCents,
            asaasVerifiedBalanceCents: dualBalance.asaas.asaasVerifiedBalanceCents,
            eligibilitySnapshot: freshEligibility as any,
            balanceCheckSnapshot: dualBalance as any,
            protocolNumber: bureauResp.protocolNumber,
            externalNegativationId: bureauResp.externalNegativationId,
            requestReason: trimmedReason,
            requestedByUserId: params.requestedByUserId,
            requestedByName: params.requestedByName,
            requestedAt: now,
            priorNotificationResponsible: 'BUREAU_MANTENEDOR',
            priorNotificationExpectedBy: bureauResp.refused
              ? null
              : addBusinessDays(now, SUMULA_359_PRIOR_NOTICE_BUSINESS_DAYS),
            refusalReason: bureauResp.refused ? bureauResp.refusalReason : null,
            refusedAt: bureauResp.refused ? now : null,
            notes: params.notes ? String(params.notes).trim() : null,
            transitionHistory: [
              {
                status: initialStatus,
                at: now.toISOString(),
                actorUserId: params.requestedByUserId,
                actorName: params.requestedByName,
                reason: trimmedReason,
                idempotencyKey: normalizedKey,
              },
            ],
            idempotencyKey: normalizedKey,
          },
        });

        return { replay: false as const, record: created, freshAgreement };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 20000,
        maxWait: 10000,
      }
    );

    if (txOutcome.replay) {
      return {
        statusCode: 200,
        idempotentReplay: true,
        record: serializeNegativationRecord(txOutcome.record),
      };
    }

    createdRecord = txOutcome.record;

    await recordOperationalAuditEvent({
      companyId: params.companyId,
      category: 'CONTRACT',
      action:
        createdRecord.status === 'RECUSA'
          ? 'SERASA_NEGATIVATION_REFUSED'
          : 'SERASA_NEGATIVATION_REQUESTED',
      entityType: 'CREDIT_AGREEMENT',
      entityReference:
        txOutcome.freshAgreement.client?.visibleCode ||
        `CRD-${params.agreementId.slice(0, 8).toUpperCase()}`,
      entityId: params.agreementId,
      previousValues: null,
      newValues: {
        recordId: createdRecord.id,
        status: createdRecord.status,
        environment: 'SANDBOX',
        overdueAmountCents: createdRecord.overdueAmountCents,
        lumoraVerifiedBalanceCents: createdRecord.lumoraVerifiedBalanceCents,
        asaasVerifiedBalanceCents: createdRecord.asaasVerifiedBalanceCents,
        protocolNumber: createdRecord.protocolNumber,
      },
      reason: trimmedReason,
      authorUserId: params.requestedByUserId,
      authorName: params.requestedByName,
      authorRole: params.requestedByRole || 'COMPANY_ADMIN',
      ipAddress: params.ipAddress || null,
    });

    return {
      statusCode: 201,
      idempotentReplay: false,
      record: serializeNegativationRecord(createdRecord),
    };
  } catch (error: any) {
    if (error?.status) throw error;

    const isP2002 =
      error?.code === 'P2002' &&
      String(error?.message || '').includes('idempotencyKey');

    if (isP2002 || isConcurrencyError(error)) {
      const existing = await prisma.creditNegativationRecord.findUnique({
        where: { idempotencyKey: normalizedKey },
      });
      if (existing) {
        if (existing.companyId !== params.companyId || existing.agreementId !== params.agreementId) {
          const err: any = new Error('Chave de idempotência já utilizada em outro contrato.');
          err.status = 409;
          err.code = 'IDEMPOTENCY_KEY_CONFLICT';
          throw err;
        }
        return {
          statusCode: 200,
          idempotentReplay: true,
          record: serializeNegativationRecord(existing),
        };
      }
      const err: any = new Error(
        'Conflito de concorrência detectado ao solicitar negativação Serasa. Reenvie com a mesma idempotencyKey.'
      );
      err.status = 409;
      err.code = 'CONCURRENCY_CONFLICT';
      throw err;
    }

    throw error;
  }
}

const ALLOWED_SERASA_TRANSITIONS: Record<string, SerasaStatus[]> = {
  SOLICITACAO_ENVIADA: ['EM_ANDAMENTO', 'NEGATIVACAO_CONFIRMADA', 'RECUSA', 'CANCELAMENTO'],
  EM_ANDAMENTO: ['NEGATIVACAO_CONFIRMADA', 'RECUSA', 'CANCELAMENTO'],
  NEGATIVACAO_CONFIRMADA: ['CANCELAMENTO'],
  PAGAMENTO_REGISTRADO_COMUNICACAO_PENDENTE: ['CANCELAMENTO'],
};

/**
 * Executa transição auditada de estado de um registro Serasa:
 * EM_ANDAMENTO, NEGATIVACAO_CONFIRMADA, RECUSA, CANCELAMENTO (e reprocessamento de PAGAMENTO_REGISTRADO_COMUNICACAO_PENDENTE).
 */
export async function transitionSerasaNegativationRecord(params: {
  companyId: string;
  agreementId: string;
  recordId: string;
  targetStatus: Exclude<SerasaStatus, 'ELEGIVEL' | 'SOLICITACAO_ENVIADA' | 'PAGAMENTO_REGISTRADO_COMUNICACAO_PENDENTE'>;
  actorUserId: string;
  actorName: string;
  actorRole?: string | null;
  reason: string;
  idempotencyKey: string;
  priorNotificationConfirmedAt?: string | null;
  confirmedBySource?: string | null;
  ipAddress?: string | null;
}) {
  assertSerasaSandboxEnvironment('SANDBOX');

  const normalizedKey = String(params.idempotencyKey || '').trim();
  if (!normalizedKey) {
    const err: any = new Error('Chave de idempotência (idempotencyKey) é obrigatória para transição de estado Serasa.');
    err.status = 400;
    err.code = 'IDEMPOTENCY_KEY_REQUIRED';
    throw err;
  }

  const trimmedReason = String(params.reason || '').trim();
  if (trimmedReason.length < 3) {
    const err: any = new Error('Justificativa auditada (reason) é obrigatória.');
    err.status = 400;
    err.code = 'REASON_REQUIRED';
    throw err;
  }

  try {
    const txRes = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "CreditNegativationRecord" WHERE id = ${params.recordId} AND "companyId" = ${params.companyId} FOR UPDATE`;

        const record = await tx.creditNegativationRecord.findFirst({
          where: {
            id: params.recordId,
            agreementId: params.agreementId,
            companyId: params.companyId,
          },
        });
        if (!record) {
          const err: any = new Error('Registro de negativação não encontrado para esta empresa/contrato.');
          err.status = 404;
          err.code = 'NEGATIVATION_RECORD_NOT_FOUND';
          throw err;
        }

        const history: any[] = Array.isArray(record.transitionHistory)
          ? [...(record.transitionHistory as any[])]
          : [];

        const matchingTransition = history.find((h) => h?.idempotencyKey === normalizedKey);
        if (matchingTransition) {
          if (matchingTransition.targetStatus && matchingTransition.targetStatus !== params.targetStatus) {
            const err: any = new Error(
              'Chave de idempotência já utilizada para outra transição neste registro.'
            );
            err.status = 409;
            err.code = 'IDEMPOTENCY_KEY_CONFLICT';
            throw err;
          }
          return { replay: true as const, record, communicationPending: record.status === 'PAGAMENTO_REGISTRADO_COMUNICACAO_PENDENTE' };
        }

        const allowed = ALLOWED_SERASA_TRANSITIONS[record.status] || [];
        if (!allowed.includes(params.targetStatus)) {
          const err: any = new Error(
            `Transição inválida de '${record.status}' para '${params.targetStatus}'.`
          );
          err.status = 400;
          err.code = 'INVALID_SERASA_TRANSITION';
          throw err;
        }

        const now = new Date();
        const updateData: any = {};
        let communicationPending = false;

        if (params.targetStatus === 'EM_ANDAMENTO') {
          updateData.status = 'EM_ANDAMENTO';
          updateData.emAndamentoAt = now;
        } else if (params.targetStatus === 'NEGATIVACAO_CONFIRMADA') {
          updateData.status = 'NEGATIVACAO_CONFIRMADA';
          updateData.confirmedAt = now;
          updateData.confirmedBySource = params.confirmedBySource || 'ASAAS_SANDBOX_ADMIN';
          updateData.priorNotificationConfirmedAt = params.priorNotificationConfirmedAt
            ? new Date(params.priorNotificationConfirmedAt)
            : record.priorNotificationConfirmedAt || now;
        } else if (params.targetStatus === 'RECUSA') {
          updateData.status = 'RECUSA';
          updateData.refusedAt = now;
          updateData.refusalReason = trimmedReason;
        } else if (params.targetStatus === 'CANCELAMENTO') {
          const deadline = record.legalRemovalDeadlineAt || addBusinessDays(now, SUMULA_548_BUSINESS_DAYS);
          updateData.legalRemovalDeadlineAt = deadline;
          updateData.removalReason = trimmedReason;
          updateData.removalRequestedByUserId = params.actorUserId;
          updateData.removalRequestedAt = record.removalRequestedAt || now;
          updateData.communicationAttempts = (record.communicationAttempts || 0) + 1;
          updateData.lastCommunicationAttemptAt = now;

          try {
            const removalResp = await sendAsaasSerasaNegativationRemoval(params.companyId, {
              recordId: record.id,
              agreementId: record.agreementId,
              externalNegativationId: record.externalNegativationId,
              reason: trimmedReason,
              idempotencyKey: normalizedKey,
            });
            updateData.status = 'CANCELAMENTO';
            updateData.removalConfirmedAt = now;
            updateData.removalProtocolNumber = removalResp.removalProtocolNumber;
            updateData.lastCommunicationError = null;
          } catch (commErr: any) {
            communicationPending = true;
            updateData.status = 'PAGAMENTO_REGISTRADO_COMUNICACAO_PENDENTE';
            updateData.lastCommunicationError = commErr?.message || 'Falha de comunicação na exclusão Serasa.';
          }
        }

        history.push({
          fromStatus: record.status,
          status: updateData.status,
          targetStatus: params.targetStatus,
          at: now.toISOString(),
          actorUserId: params.actorUserId,
          actorName: params.actorName,
          reason: trimmedReason,
          idempotencyKey: normalizedKey,
          communicationPending,
        });
        updateData.transitionHistory = history;

        const updated = await tx.creditNegativationRecord.update({
          where: { id: record.id },
          data: updateData,
        });

        return {
          replay: false as const,
          previousStatus: record.status,
          record: updated,
          communicationPending,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 20000,
        maxWait: 10000,
      }
    );

    if (!txRes.replay) {
      await recordOperationalAuditEvent({
        companyId: params.companyId,
        category: 'CONTRACT',
        action: `SERASA_TRANSITION_${txRes.record.status}`,
        entityType: 'CREDIT_AGREEMENT',
        entityReference: `CRD-${params.agreementId.slice(0, 8).toUpperCase()}`,
        entityId: params.agreementId,
        previousValues: { status: txRes.previousStatus, recordId: params.recordId },
        newValues: {
          status: txRes.record.status,
          recordId: txRes.record.id,
          communicationPending: txRes.communicationPending,
          legalRemovalDeadlineAt: txRes.record.legalRemovalDeadlineAt,
          removalProtocolNumber: txRes.record.removalProtocolNumber,
        },
        reason: trimmedReason,
        authorUserId: params.actorUserId,
        authorName: params.actorName,
        authorRole: params.actorRole || 'COMPANY_ADMIN',
        ipAddress: params.ipAddress || null,
      });
    }

    return {
      statusCode: 200,
      idempotentReplay: txRes.replay,
      communicationPending: txRes.communicationPending,
      record: serializeNegativationRecord(txRes.record),
    };
  } catch (error: any) {
    if (error?.status) throw error;
    if (isConcurrencyError(error)) {
      const err: any = new Error(
        'Conflito de concorrência detectado na atualização do registro Serasa. Tente novamente com a mesma idempotencyKey.'
      );
      err.status = 409;
      err.code = 'CONCURRENCY_CONFLICT';
      throw err;
    }
    throw error;
  }
}

/**
 * Dispara automaticamente a exclusão/baixa no Serasa dentro do prazo legal de 5 dias úteis (Súmula 548 STJ)
 * após quitação integral do contrato ou renegociação de dívida (Etapa 4).
 * Caso a comunicação externa falhe, preserva o registro em PAGAMENTO_REGISTRADO_COMUNICACAO_PENDENTE.
 */
export async function triggerAutoSerasaRemovalOnDebtChange(params: {
  companyId: string;
  agreementId: string;
  triggerType: 'SETTLEMENT' | 'RENEGOTIATION';
  actorUserId: string;
  actorName: string;
  reason: string;
  ipAddress?: string | null;
}) {
  const candidates = await prisma.creditNegativationRecord.findMany({
    where: {
      companyId: params.companyId,
      agreementId: params.agreementId,
      status: { in: ACTIVE_IN_FLIGHT_SERASA_STATES },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (candidates.length === 0) {
    return { triggeredCount: 0, records: [] as any[] };
  }

  const results: any[] = [];
  for (const rec of candidates) {
    const now = new Date();
    const deadline = rec.legalRemovalDeadlineAt || addBusinessDays(now, SUMULA_548_BUSINESS_DAYS);
    const autoKey = `auto_${params.triggerType.toLowerCase()}_${rec.id}_${rec.communicationAttempts}`;

    const out = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "CreditNegativationRecord" WHERE id = ${rec.id} FOR UPDATE`;
        const fresh = await tx.creditNegativationRecord.findUnique({ where: { id: rec.id } });
        if (!fresh || !ACTIVE_IN_FLIGHT_SERASA_STATES.includes(fresh.status as SerasaStatus)) {
          return fresh ? { skipped: true as const, record: fresh } : null;
        }

        let newStatus: SerasaStatus = 'CANCELAMENTO';
        let removalProtocolNumber: string | null = null;
        let removalConfirmedAt: Date | null = now;
        let lastError: string | null = null;

        try {
          const resp = await sendAsaasSerasaNegativationRemoval(params.companyId, {
            recordId: fresh.id,
            agreementId: fresh.agreementId,
            externalNegativationId: fresh.externalNegativationId,
            reason: params.reason,
            idempotencyKey: autoKey,
          });
          removalProtocolNumber = resp.removalProtocolNumber;
        } catch (err: any) {
          newStatus = 'PAGAMENTO_REGISTRADO_COMUNICACAO_PENDENTE';
          removalConfirmedAt = null;
          lastError = err?.message || 'Falha na comunicação automática de exclusão Serasa.';
        }

        const history: any[] = Array.isArray(fresh.transitionHistory)
          ? [...(fresh.transitionHistory as any[])]
          : [];
        history.push({
          fromStatus: fresh.status,
          status: newStatus,
          triggerType: params.triggerType,
          at: now.toISOString(),
          actorUserId: params.actorUserId,
          actorName: params.actorName,
          reason: params.reason,
          legalRemovalDeadlineAt: deadline.toISOString(),
          lastError,
        });

        const updated = await tx.creditNegativationRecord.update({
          where: { id: fresh.id },
          data: {
            status: newStatus,
            removalReason: params.reason,
            removalRequestedByUserId: params.actorUserId,
            removalRequestedAt: fresh.removalRequestedAt || now,
            legalRemovalDeadlineAt: deadline,
            removalConfirmedAt,
            removalProtocolNumber,
            communicationAttempts: (fresh.communicationAttempts || 0) + 1,
            lastCommunicationError: lastError,
            lastCommunicationAttemptAt: now,
            transitionHistory: history,
          },
        });

        return { skipped: false as const, previousStatus: fresh.status, record: updated };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 20000,
        maxWait: 10000,
      }
    );

    if (out && !out.skipped) {
      await recordOperationalAuditEvent({
        companyId: params.companyId,
        category: 'CONTRACT',
        action:
          out.record.status === 'CANCELAMENTO'
            ? `SERASA_AUTO_REMOVAL_${params.triggerType}`
            : `SERASA_AUTO_REMOVAL_COMM_PENDING_${params.triggerType}`,
        entityType: 'CREDIT_AGREEMENT',
        entityReference: `CRD-${params.agreementId.slice(0, 8).toUpperCase()}`,
        entityId: params.agreementId,
        previousValues: { status: out.previousStatus, recordId: out.record.id },
        newValues: {
          status: out.record.status,
          legalRemovalDeadlineAt: out.record.legalRemovalDeadlineAt,
          removalProtocolNumber: out.record.removalProtocolNumber,
          lastCommunicationError: out.record.lastCommunicationError,
        },
        reason: params.reason,
        authorUserId: params.actorUserId,
        authorName: params.actorName,
        authorRole: 'SYSTEM',
        ipAddress: params.ipAddress || null,
      });
      results.push(serializeNegativationRecord(out.record));
    }
  }

  return { triggeredCount: results.length, records: results };
}

