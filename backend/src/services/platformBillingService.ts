import { PrismaClient, Prisma } from '@prisma/client';
import { getCompetenceRange, getCompetenceForDate } from './monthlyCreditClosingService';
import { isTestOrSimulationMarker, recordOperationalAuditEvent } from './operationalAuditService';

const defaultPrisma = new PrismaClient();

export const ROUNDING_POLICY_ITEM_HALF_UP_SUM = 'ITEM_HALF_UP_SUM';

export interface VigenciaBucketSummary {
  rateId: string;
  version: number;
  ratePercentage: string;
  rateMilliPercent: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  salesCount: number;
  baseCents: number;
  feeCents: number;
  theoreticalAggregateFeeCents: number;
}

export const STORE_BILLING_POLICY_METADATA = {
  settlementMode: 'OUTSIDE_APP_B2B_CONTRACT',
  inAppCheckoutEnabled: false,
  externalPaymentLinksExposedInApp: false,
  automaticBankChargeEmissionEnabled: false,
  automaticPaymentSplitEnabled: false,
  automaticSuspensionOnOverdueEnabled: false,
  physicalProductVsDigitalAccessSeparation:
    'Pagamentos operacionais de álbuns/produtos físicos fotográficos pertencem integralmente à empresa cliente; a remuneração B2B do software Lumora é apurada em demonstrativo informativo e liquidada exclusivamente fora do aplicativo.',
} as const;

/**
 * Converte percentual Decimal/string/number (até 3 casas decimais) em milipercentuais inteiros.
 * Exemplo: "2.500" -> 2500 | "3" -> 3000 | "0.000" -> 0 | "1.235" -> 1235
 * Elimina 100% de imprecisão de ponto flutuante IEEE-754.
 */
export function parsePercentageToMilliPercent(value: Prisma.Decimal | string | number): number {
  const str =
    typeof value === 'object' && value !== null && 'toFixed' in value
      ? value.toFixed(3)
      : typeof value === 'number'
      ? value.toFixed(3)
      : String(value).trim();

  const normalized = str.replace(',', '.');
  const match = normalized.match(/^(\d{1,3})(?:\.(\d{1,3}))?$/);
  if (!match) {
    throw new Error(`Percentual inválido para conversão exata: "${str}"`);
  }
  const whole = parseInt(match[1], 10);
  const fracStr = (match[2] || '').padEnd(3, '0');
  const frac = parseInt(fracStr, 10);
  const totalMilli = whole * 1000 + frac;
  if (totalMilli < 0 || totalMilli > 100_000) {
    throw new Error(`Percentual fora do intervalo [0%, 100%]: "${str}"`);
  }
  return totalMilli;
}

export function formatMilliPercentToDecimalString(rateMilliPercent: number): string {
  const whole = Math.floor(rateMilliPercent / 1000);
  const frac = Math.abs(rateMilliPercent % 1000)
    .toString()
    .padStart(3, '0');
  return `${whole}.${frac}`;
}

/**
 * Arredondamento monetário Half-Up exato em BigInt:
 * feeCents = round_half_up(baseCents * rateMilliPercent / 100_000)
 * Onde 100% = 100_000 milipercentuais (ex.: 2,5% = 2500).
 */
export function calculateFeeCentsHalfUp(baseCents: number, rateMilliPercent: number): number {
  if (!Number.isInteger(baseCents) || baseCents < 0) {
    throw new Error(`Base monetária em centavos inválida: ${baseCents}`);
  }
  if (!Number.isInteger(rateMilliPercent) || rateMilliPercent < 0 || rateMilliPercent > 100_000) {
    throw new Error(`Taxa em milipercentuais inválida: ${rateMilliPercent}`);
  }
  if (baseCents === 0 || rateMilliPercent === 0) return 0;

  const numerator = BigInt(baseCents) * BigInt(rateMilliPercent);
  const fee = (numerator + 50_000n) / 100_000n;
  return Number(fee);
}

export function centsToBrlNumber(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

const CANCELED_OR_UNCONFIRMED_SALE_STATUSES = new Set([
  'PENDING_RECEIPT',
  'CANCELED',
  'CANCELLED',
  'VOIDED',
  'RETURNED',
  'ESTORNADA',
  'CANCELADA',
]);

export function isSaleConfirmedAndReal(sale: {
  id: string;
  value: number;
  status: string;
  paymentStatus: string;
  fichaNumber?: string | null;
  reportNotes?: string | null;
  client?: {
    sequenceNumber?: string | null;
    name?: string | null;
    visibleCode?: string | null;
  } | null;
}): { eligible: boolean; reason?: string } {
  const statusUpper = String(sale.status || '').toUpperCase();
  const paymentStatusUpper = String(sale.paymentStatus || '').toUpperCase();

  if (CANCELED_OR_UNCONFIRMED_SALE_STATUSES.has(statusUpper)) {
    return { eligible: false, reason: `SALE_STATUS_${statusUpper}` };
  }
  if (CANCELED_OR_UNCONFIRMED_SALE_STATUSES.has(paymentStatusUpper)) {
    return { eligible: false, reason: `PAYMENT_STATUS_${paymentStatusUpper}` };
  }

  if (
    isTestOrSimulationMarker(sale.fichaNumber) ||
    isTestOrSimulationMarker(sale.reportNotes) ||
    isTestOrSimulationMarker(sale.client?.sequenceNumber) ||
    isTestOrSimulationMarker(sale.client?.name)
  ) {
    return { eligible: false, reason: 'SANDBOX_OR_SIMULATION_FIXTURE' };
  }

  const cents = Math.round(Number(sale.value || 0) * 100);
  if (cents <= 0) {
    return { eligible: false, reason: 'NON_POSITIVE_SALE_VALUE' };
  }

  return { eligible: true };
}

export function buildSafeSaleReference(sale: {
  id: string;
  fichaNumber?: string | null;
  client?: { visibleCode?: string | null; sequenceNumber?: string | null } | null;
}): string {
  const candidate =
    (sale.fichaNumber && sale.fichaNumber.trim()) ||
    (sale.client?.visibleCode && sale.client.visibleCode.trim()) ||
    (sale.client?.sequenceNumber && sale.client.sequenceNumber.trim()) ||
    `VND-${sale.id.slice(0, 8).toUpperCase()}`;
  return candidate;
}

export function resolveRateForSaleDate<
  T extends {
    id: string;
    version: number;
    ratePercentage: Prisma.Decimal;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  }
>(ratesDescByVersion: T[], saleDate: Date): T | null {
  const ts = saleDate.getTime();
  for (const r of ratesDescByVersion) {
    const fromTs = new Date(r.effectiveFrom).getTime();
    const toTs = r.effectiveTo ? new Date(r.effectiveTo).getTime() : null;
    if (ts >= fromTs && (toTs === null || ts < toTs)) {
      return r;
    }
  }
  return null;
}

async function computeFinancialBucketsAndPreviewData(
  companyId: string,
  competence: string,
  db: Prisma.TransactionClient | PrismaClient
) {
  const { startDate, endDate } = getCompetenceRange(competence);

  const company = await db.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      legalName: true,
      tradeName: true,
      cnpj: true,
      status: true,
    },
  });
  if (!company) {
    const err: any = new Error('Empresa não encontrada.');
    err.status = 404;
    throw err;
  }

  const rates = await db.companyPlatformRate.findMany({
    where: { companyId },
    orderBy: [{ version: 'desc' }],
  });

  // Vendas registradas na competência comercial
  const rawSales = await db.sale.findMany({
    where: {
      companyId,
      date: {
        gte: startDate,
        lt: endDate,
      },
    },
    include: {
      client: {
        select: {
          sequenceNumber: true,
          visibleCode: true,
          name: true,
        },
      },
      seller: {
        select: {
          usesOwnCar: true,
        },
      },
      creditAgreement: {
        select: {
          id: true,
          totalSaleCents: true,
          downPaymentCents: true,
          initialCommissionRate: true,
        },
      },
      platformStatementItem: {
        select: {
          id: true,
          statementId: true,
          competence: true,
        },
      },
    },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });

  // Recebimentos de parcelas de crediário no período (Bucket 2 & 4 — NUNCA geram nova taxa Lumora!)
  const creditPaymentsInPeriod = await db.creditPayment.findMany({
    where: {
      companyId,
      isReversed: false,
      paidAt: {
        gte: startDate,
        lt: endDate,
      },
    },
    include: {
      agreement: {
        select: {
          client: {
            select: { sequenceNumber: true, name: true },
          },
        },
      },
    },
  });

  // Comissões de 10% sobre principal das parcelas do crediário geradas no período (Bucket 3)
  const installmentCommissionsInPeriod = await db.creditCommission.findMany({
    where: {
      companyId,
      isReversed: false,
      type: 'INSTALLMENT',
      createdAt: {
        gte: startDate,
        lt: endDate,
      },
    },
    include: {
      agreement: {
        select: {
          client: {
            select: { sequenceNumber: true, name: true },
          },
        },
      },
    },
  });

  let companyCreditReceivedPrincipalCents = 0;
  let providerFeesCents = 0;
  for (const cp of creditPaymentsInPeriod) {
    if (
      isTestOrSimulationMarker(cp.externalPaymentId) ||
      isTestOrSimulationMarker(cp.notes) ||
      isTestOrSimulationMarker(cp.agreement?.client?.sequenceNumber) ||
      isTestOrSimulationMarker(cp.agreement?.client?.name)
    ) {
      continue;
    }
    companyCreditReceivedPrincipalCents += cp.amountCents;
    providerFeesCents += cp.bankFeeCents || 0;
  }

  let sellerInstallmentCommissionsCents = 0;
  for (const cc of installmentCommissionsInPeriod) {
    if (
      isTestOrSimulationMarker(cc.agreement?.client?.sequenceNumber) ||
      isTestOrSimulationMarker(cc.agreement?.client?.name)
    ) {
      continue;
    }
    sellerInstallmentCommissionsCents += cc.amountCents;
  }

  // Ajustes pendentes (sem statement aplicado) endereçados a esta competência
  const pendingAdjustments = await db.platformStatementAdjustment.findMany({
    where: {
      companyId,
      appliedCompetence: competence,
      appliedStatementId: null,
    },
    orderBy: { createdAt: 'asc' },
  });

  if (rates.length === 0) {
    // Sem contrato/taxa aprovada: mostrar NÃO CONFIGURADO, sem cobrar automaticamente
    let confirmedSalesBaseWithoutContractCents = 0;
    let confirmedSalesCountWithoutContract = 0;
    let excludedTestOrUnconfirmedCount = 0;
    let sellerInitialCommissionsCents = 0;

    for (const s of rawSales) {
      const check = isSaleConfirmedAndReal(s);
      if (!check.eligible) {
        excludedTestOrUnconfirmedCount += 1;
        continue;
      }
      const saleCents = s.creditAgreement
        ? s.creditAgreement.totalSaleCents
        : Math.round(Number(s.value) * 100);
      confirmedSalesBaseWithoutContractCents += saleCents;
      confirmedSalesCountWithoutContract += 1;

      if (s.creditAgreement) {
        sellerInitialCommissionsCents += Math.round(
          s.creditAgreement.downPaymentCents * s.creditAgreement.initialCommissionRate
        );
      } else {
        const rate = s.seller?.usesOwnCar ? 25 : 20;
        sellerInitialCommissionsCents += Math.round((saleCents * rate) / 100);
      }
    }

    return {
      company,
      competence,
      startDate,
      endDate,
      contractStatus: 'NOT_CONFIGURED' as const,
      isGratuitousZero: false,
      eligibleItems: [],
      vigenciaBreakdown: [] as VigenciaBucketSummary[],
      eligibleSalesCount: 0,
      eligibleSalesBaseCents: 0,
      grossPlatformFeeCents: 0,
      pendingAdjustments,
      adjustmentsCents: pendingAdjustments.reduce((acc, a) => acc + a.amountCents, 0),
      companyConfirmedSalesCents: confirmedSalesBaseWithoutContractCents,
      confirmedSalesCountWithoutContract,
      companyCreditReceivedPrincipalCents,
      sellerInitialCommissionsCents,
      sellerInstallmentCommissionsCents,
      providerFeesCents,
      excludedPreContractCount: 0,
      excludedPreContractBaseCents: 0,
      excludedTestOrUnconfirmedCount,
    };
  }

  let excludedPreContractCount = 0;
  let excludedPreContractBaseCents = 0;
  let excludedTestOrUnconfirmedCount = 0;
  let companyConfirmedSalesCents = 0;
  let sellerInitialCommissionsCents = 0;

  const eligibleItems: Array<{
    saleId: string;
    saleReference: string;
    saleDate: Date;
    city: string;
    product: string;
    paymentModality: string;
    saleBaseCents: number;
    rateId: string;
    rateVersion: number;
    ratePercentage: Prisma.Decimal;
    rateMilliPercent: number;
    calculatedFeeCents: number;
  }> = [];

  const vigenciaMap = new Map<string, VigenciaBucketSummary>();

  for (const s of rawSales) {
    const check = isSaleConfirmedAndReal(s);
    if (!check.eligible) {
      excludedTestOrUnconfirmedCount += 1;
      continue;
    }

    // Se a venda já constar em algum demonstrativo anterior (garantia de incidência única por venda), ignorar nova cobrança
    if (s.platformStatementItem) {
      continue;
    }

    const saleBaseCents = s.creditAgreement
      ? s.creditAgreement.totalSaleCents
      : Math.round(Number(s.value) * 100);

    companyConfirmedSalesCents += saleBaseCents;

    if (s.creditAgreement) {
      sellerInitialCommissionsCents += Math.round(
        s.creditAgreement.downPaymentCents * s.creditAgreement.initialCommissionRate
      );
    } else {
      const sellerPct = s.seller?.usesOwnCar ? 25 : 20;
      sellerInitialCommissionsCents += Math.round((saleBaseCents * sellerPct) / 100);
    }

    const matchingRate = resolveRateForSaleDate(rates, new Date(s.date));
    if (!matchingRate) {
      // Venda ocorrida antes do início contratado (effectiveFrom): nunca aplicar taxa retroativamente
      excludedPreContractCount += 1;
      excludedPreContractBaseCents += saleBaseCents;
      continue;
    }

    const rateMilliPercent = parsePercentageToMilliPercent(matchingRate.ratePercentage);
    const calculatedFeeCents = calculateFeeCentsHalfUp(saleBaseCents, rateMilliPercent);
    const paymentModality = s.creditAgreement
      ? 'CREDIARIO'
      : String(s.paymentMethod || 'CASH').toUpperCase();

    eligibleItems.push({
      saleId: s.id,
      saleReference: buildSafeSaleReference(s),
      saleDate: new Date(s.date),
      city: s.city,
      product: s.product || 'Books',
      paymentModality,
      saleBaseCents,
      rateId: matchingRate.id,
      rateVersion: matchingRate.version,
      ratePercentage: matchingRate.ratePercentage,
      rateMilliPercent,
      calculatedFeeCents,
    });

    const existingBucket = vigenciaMap.get(matchingRate.id);
    if (existingBucket) {
      existingBucket.salesCount += 1;
      existingBucket.baseCents += saleBaseCents;
      existingBucket.feeCents += calculatedFeeCents;
      existingBucket.theoreticalAggregateFeeCents = calculateFeeCentsHalfUp(
        existingBucket.baseCents,
        existingBucket.rateMilliPercent
      );
    } else {
      vigenciaMap.set(matchingRate.id, {
        rateId: matchingRate.id,
        version: matchingRate.version,
        ratePercentage: formatMilliPercentToDecimalString(rateMilliPercent),
        rateMilliPercent,
        effectiveFrom: new Date(matchingRate.effectiveFrom).toISOString(),
        effectiveTo: matchingRate.effectiveTo
          ? new Date(matchingRate.effectiveTo).toISOString()
          : null,
        salesCount: 1,
        baseCents: saleBaseCents,
        feeCents: calculatedFeeCents,
        theoreticalAggregateFeeCents: calculateFeeCentsHalfUp(saleBaseCents, rateMilliPercent),
      });
    }
  }

  const vigenciaBreakdown = Array.from(vigenciaMap.values()).sort(
    (a, b) => a.version - b.version
  );

  // Caso não haja vendas no período mas haja taxa vigente no período, identificar se todas as taxas vigentes no mês são 0%
  const activeRatesInMonth = rates.filter((r) => {
    const rFrom = new Date(r.effectiveFrom).getTime();
    const rTo = r.effectiveTo ? new Date(r.effectiveTo).getTime() : null;
    return rFrom < endDate.getTime() && (rTo === null || rTo > startDate.getTime());
  });

  if (activeRatesInMonth.length === 0) {
    return {
      company,
      competence,
      startDate,
      endDate,
      contractStatus: 'NOT_EFFECTIVE_IN_PERIOD' as const,
      isGratuitousZero: false,
      eligibleItems: [],
      vigenciaBreakdown: [] as VigenciaBucketSummary[],
      eligibleSalesCount: 0,
      eligibleSalesBaseCents: 0,
      grossPlatformFeeCents: 0,
      pendingAdjustments,
      adjustmentsCents: pendingAdjustments.reduce((acc, a) => acc + a.amountCents, 0),
      companyConfirmedSalesCents,
      confirmedSalesCountWithoutContract: 0,
      companyCreditReceivedPrincipalCents,
      sellerInitialCommissionsCents,
      sellerInstallmentCommissionsCents,
      providerFeesCents,
      excludedPreContractCount,
      excludedPreContractBaseCents,
      excludedTestOrUnconfirmedCount,
    };
  }

  const allZeroInMonth = activeRatesInMonth.every(
    (r) => parsePercentageToMilliPercent(r.ratePercentage) === 0
  );

  // Se não houve vendas elegíveis na vigência, ainda assim expor as faixas vigentes da competência com zero vendas
  if (vigenciaBreakdown.length === 0) {
    for (const r of [...activeRatesInMonth].sort((a, b) => a.version - b.version)) {
      const mp = parsePercentageToMilliPercent(r.ratePercentage);
      vigenciaBreakdown.push({
        rateId: r.id,
        version: r.version,
        ratePercentage: formatMilliPercentToDecimalString(mp),
        rateMilliPercent: mp,
        effectiveFrom: new Date(r.effectiveFrom).toISOString(),
        effectiveTo: r.effectiveTo ? new Date(r.effectiveTo).toISOString() : null,
        salesCount: 0,
        baseCents: 0,
        feeCents: 0,
        theoreticalAggregateFeeCents: 0,
      });
    }
  }

  const eligibleSalesCount = eligibleItems.length;
  const eligibleSalesBaseCents = eligibleItems.reduce((acc, i) => acc + i.saleBaseCents, 0);
  const grossPlatformFeeCents = eligibleItems.reduce((acc, i) => acc + i.calculatedFeeCents, 0);
  const adjustmentsCents = pendingAdjustments.reduce((acc, a) => acc + a.amountCents, 0);

  return {
    company,
    competence,
    startDate,
    endDate,
    contractStatus: allZeroInMonth ? ('GRATUITOUS_ZERO' as const) : ('CONFIGURED' as const),
    isGratuitousZero: allZeroInMonth,
    eligibleItems,
    vigenciaBreakdown,
    eligibleSalesCount,
    eligibleSalesBaseCents,
    grossPlatformFeeCents,
    pendingAdjustments,
    adjustmentsCents,
    companyConfirmedSalesCents,
    confirmedSalesCountWithoutContract: 0,
    companyCreditReceivedPrincipalCents,
    sellerInitialCommissionsCents,
    sellerInstallmentCommissionsCents,
    providerFeesCents,
    excludedPreContractCount,
    excludedPreContractBaseCents,
    excludedTestOrUnconfirmedCount,
  };
}

export function formatStatementResponse(
  statement: any,
  options?: { forCompanySelfService?: boolean }
) {
  const isSelfService = Boolean(options?.forCompanySelfService);
  const items = Array.isArray(statement.items)
    ? statement.items.map((item: any) => ({
        id: item.id,
        saleReference: item.saleReference,
        saleDate: item.saleDate,
        city: item.city,
        product: item.product,
        paymentModality: item.paymentModality,
        saleBaseCents: item.saleBaseCents,
        saleBaseBrl: centsToBrlNumber(item.saleBaseCents),
        rateVersion: item.rateVersion,
        ratePercentage: Number(item.ratePercentage),
        ratePercentageFormatted: `${Number(item.ratePercentage).toFixed(3)}%`,
        calculatedFeeCents: item.calculatedFeeCents,
        calculatedFeeBrl: centsToBrlNumber(item.calculatedFeeCents),
        creditedBaseCents: item.creditedBaseCents,
        creditedFeeCents: item.creditedFeeCents,
      }))
    : undefined;

  const appliedAdjustments = Array.isArray(statement.appliedAdjustments)
    ? statement.appliedAdjustments.map((adj: any) => ({
        id: adj.id,
        type: adj.type,
        appliedCompetence: adj.appliedCompetence,
        originSaleReference: adj.originSaleReference,
        returnedBaseCents: adj.returnedBaseCents,
        returnedBaseBrl: centsToBrlNumber(adj.returnedBaseCents || 0),
        originalRateVersion: adj.originalRateVersion,
        originalRatePercentage:
          adj.originalRatePercentage !== null && adj.originalRatePercentage !== undefined
            ? Number(adj.originalRatePercentage)
            : null,
        amountCents: adj.amountCents,
        amountBrl: centsToBrlNumber(adj.amountCents),
        reason: adj.reason,
        createdAt: adj.createdAt,
        ...(isSelfService ? {} : { createdByName: adj.createdByName }),
      }))
    : undefined;

  const payments = Array.isArray(statement.payments)
    ? statement.payments.map((pay: any) => ({
        id: pay.id,
        amountCents: pay.amountCents,
        amountBrl: centsToBrlNumber(pay.amountCents),
        paymentMethod: pay.paymentMethod,
        paidAt: pay.paidAt,
        externalReference: pay.externalReference,
        notes: pay.notes,
        createdAt: pay.createdAt,
        ...(isSelfService ? {} : { recordedByName: pay.recordedByName }),
      }))
    : undefined;

  return {
    id: statement.id,
    companyId: statement.companyId,
    company: statement.company
      ? {
          id: statement.company.id,
          name: statement.company.name,
          tradeName: statement.company.tradeName,
          ...(isSelfService ? {} : { cnpj: statement.company.cnpj, status: statement.company.status }),
        }
      : undefined,
    competence: statement.competence,
    startDate: statement.startDate,
    endDate: statement.endDate,
    status: statement.status,
    contractStatus: statement.isGratuitousZero ? 'GRATUITOUS_ZERO' : 'CONFIGURED',
    isGratuitousZero: statement.isGratuitousZero,
    roundingPolicy: statement.roundingPolicy,
    eligibleSalesCount: statement.eligibleSalesCount,
    eligibleSalesBaseCents: statement.eligibleSalesBaseCents,
    eligibleSalesBaseBrl: centsToBrlNumber(statement.eligibleSalesBaseCents),
    grossPlatformFeeCents: statement.grossPlatformFeeCents,
    grossPlatformFeeBrl: centsToBrlNumber(statement.grossPlatformFeeCents),
    adjustmentsCents: statement.adjustmentsCents,
    adjustmentsBrl: centsToBrlNumber(statement.adjustmentsCents),
    netDueCents: statement.netDueCents,
    netDueBrl: centsToBrlNumber(statement.netDueCents),
    paidAmountCents: statement.paidAmountCents,
    paidAmountBrl: centsToBrlNumber(statement.paidAmountCents),
    remainingBalanceCents: statement.remainingBalanceCents,
    remainingBalanceBrl: centsToBrlNumber(statement.remainingBalanceCents),
    carryForwardCreditCents: statement.carryForwardCreditCents,
    carryForwardCreditBrl: centsToBrlNumber(statement.carryForwardCreditCents),
    excludedPreContractCount: statement.excludedPreContractCount,
    excludedPreContractBaseCents: statement.excludedPreContractBaseCents,
    vigenciaBreakdown: statement.vigenciaBreakdown,
    financialSeparation: {
      lumoraPlatformRevenueDueCents: statement.netDueCents,
      lumoraPlatformRevenuePaidCents: statement.paidAmountCents,
      companyConfirmedSalesCents: statement.companyConfirmedSalesCents,
      companyCreditReceivedPrincipalCents: statement.companyCreditReceivedPrincipalCents,
      lumoraFeeOnCreditInstallmentsCents: 0,
      sellerInitialCommissions20Or25Cents: statement.sellerInitialCommissionsCents,
      sellerInstallmentCommissions10Cents: statement.sellerInstallmentCommissionsCents,
      paymentProviderFeesCents: statement.providerFeesCents,
    },
    storeBillingPolicy: STORE_BILLING_POLICY_METADATA,
    closedAt: statement.closedAt,
    ...(isSelfService ? {} : { closedByName: statement.closedByName, notes: statement.notes }),
    ...(items !== undefined ? { items } : {}),
    ...(appliedAdjustments !== undefined ? { appliedAdjustments } : {}),
    ...(payments !== undefined ? { payments } : {}),
  };
}

/**
 * Prévia de competência (ou retorno do demonstrativo fechado imutável caso já encerrado).
 */
export async function previewOrGetCompanyStatement(
  params: {
    companyId: string;
    competence: string;
    forCompanySelfService?: boolean;
  },
  dbClient: PrismaClient = defaultPrisma
) {
  getCompetenceRange(params.competence); // valida YYYY-MM

  const existingClosed = await dbClient.platformMonthlyStatement.findUnique({
    where: {
      companyId_competence: {
        companyId: params.companyId,
        competence: params.competence,
      },
    },
    include: {
      company: {
        select: { id: true, name: true, tradeName: true, cnpj: true, status: true },
      },
      items: { orderBy: { saleDate: 'asc' } },
      appliedAdjustments: { orderBy: { createdAt: 'asc' } },
      payments: { orderBy: { paidAt: 'asc' } },
    },
  });

  if (existingClosed) {
    return {
      isClosed: true,
      statement: formatStatementResponse(existingClosed, {
        forCompanySelfService: params.forCompanySelfService,
      }),
    };
  }

  const preview = await computeFinancialBucketsAndPreviewData(
    params.companyId,
    params.competence,
    dbClient
  );

  const rawNet = preview.grossPlatformFeeCents + preview.adjustmentsCents;
  const netDueCents = Math.max(0, rawNet);
  const carryForwardCreditCents = rawNet < 0 ? Math.abs(rawNet) : 0;

  return {
    isClosed: false,
    preview: {
      companyId: preview.company.id,
      company: {
        id: preview.company.id,
        name: preview.company.name,
        tradeName: preview.company.tradeName,
        ...(params.forCompanySelfService
          ? {}
          : { cnpj: preview.company.cnpj, status: preview.company.status }),
      },
      competence: preview.competence,
      startDate: preview.startDate,
      endDate: preview.endDate,
      status:
        preview.contractStatus === 'NOT_CONFIGURED' ||
        preview.contractStatus === 'NOT_EFFECTIVE_IN_PERIOD'
          ? 'NOT_CONFIGURED'
          : 'OPEN_PREVIEW',
      contractStatus: preview.contractStatus,
      isGratuitousZero: preview.isGratuitousZero,
      canClose:
        preview.contractStatus === 'CONFIGURED' || preview.contractStatus === 'GRATUITOUS_ZERO',
      roundingPolicy: ROUNDING_POLICY_ITEM_HALF_UP_SUM,
      eligibleSalesCount: preview.eligibleSalesCount,
      eligibleSalesBaseCents: preview.eligibleSalesBaseCents,
      eligibleSalesBaseBrl: centsToBrlNumber(preview.eligibleSalesBaseCents),
      grossPlatformFeeCents: preview.grossPlatformFeeCents,
      grossPlatformFeeBrl: centsToBrlNumber(preview.grossPlatformFeeCents),
      adjustmentsCents: preview.adjustmentsCents,
      adjustmentsBrl: centsToBrlNumber(preview.adjustmentsCents),
      netDueCents,
      netDueBrl: centsToBrlNumber(netDueCents),
      paidAmountCents: 0,
      paidAmountBrl: 0,
      remainingBalanceCents: netDueCents,
      remainingBalanceBrl: centsToBrlNumber(netDueCents),
      carryForwardCreditCents,
      carryForwardCreditBrl: centsToBrlNumber(carryForwardCreditCents),
      excludedPreContractCount: preview.excludedPreContractCount,
      excludedPreContractBaseCents: preview.excludedPreContractBaseCents,
      vigenciaBreakdown: preview.vigenciaBreakdown,
      financialSeparation: {
        lumoraPlatformRevenueDueCents: netDueCents,
        lumoraPlatformRevenuePaidCents: 0,
        companyConfirmedSalesCents: preview.companyConfirmedSalesCents,
        companyCreditReceivedPrincipalCents: preview.companyCreditReceivedPrincipalCents,
        lumoraFeeOnCreditInstallmentsCents: 0,
        sellerInitialCommissions20Or25Cents: preview.sellerInitialCommissionsCents,
        sellerInstallmentCommissions10Cents: preview.sellerInstallmentCommissionsCents,
        paymentProviderFeesCents: preview.providerFeesCents,
      },
      storeBillingPolicy: STORE_BILLING_POLICY_METADATA,
      items: preview.eligibleItems.map((item) => ({
        saleReference: item.saleReference,
        saleDate: item.saleDate,
        city: item.city,
        product: item.product,
        paymentModality: item.paymentModality,
        saleBaseCents: item.saleBaseCents,
        saleBaseBrl: centsToBrlNumber(item.saleBaseCents),
        rateVersion: item.rateVersion,
        ratePercentage: Number(item.ratePercentage),
        ratePercentageFormatted: `${Number(item.ratePercentage).toFixed(3)}%`,
        calculatedFeeCents: item.calculatedFeeCents,
        calculatedFeeBrl: centsToBrlNumber(item.calculatedFeeCents),
      })),
      pendingAdjustments: preview.pendingAdjustments.map((adj) => ({
        id: adj.id,
        type: adj.type,
        originSaleReference: adj.originSaleReference,
        returnedBaseCents: adj.returnedBaseCents,
        originalRatePercentage:
          adj.originalRatePercentage !== null ? Number(adj.originalRatePercentage) : null,
        amountCents: adj.amountCents,
        amountBrl: centsToBrlNumber(adj.amountCents),
        reason: adj.reason,
        createdAt: adj.createdAt,
      })),
    },
  };
}

/**
 * Fechamento único e idempotente do demonstrativo mensal da empresa (com trava pessimista na empresa).
 * Sem contrato/taxa aprovada vigente, bloqueia com 422 sem cobrança automática.
 * Uma vez fechado, o snapshot de competência, vigências, bases e itens é imutável.
 */
export async function closeCompanyMonthlyStatement(
  params: {
    companyId: string;
    competence: string;
    closedByUserId: string;
    closedByName: string;
    notes?: string;
    ipAddress?: string;
  },
  dbClient: PrismaClient = defaultPrisma
) {
  getCompetenceRange(params.competence);

  return dbClient.$transaction(
    async (tx) => {
      // Trava pessimista na linha da empresa para impedir duplo fechamento concorrente
      const lockedCompany = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Company" WHERE id = ${params.companyId} FOR UPDATE
      `;
      if (!lockedCompany || lockedCompany.length === 0) {
        const err: any = new Error('Empresa não encontrada.');
        err.status = 404;
        throw err;
      }

      const existing = await tx.platformMonthlyStatement.findUnique({
        where: {
          companyId_competence: {
            companyId: params.companyId,
            competence: params.competence,
          },
        },
        include: {
          company: { select: { id: true, name: true, tradeName: true, cnpj: true, status: true } },
          items: { orderBy: { saleDate: 'asc' } },
          appliedAdjustments: { orderBy: { createdAt: 'asc' } },
          payments: { orderBy: { paidAt: 'asc' } },
        },
      });

      if (existing) {
        return {
          created: false,
          idempotentReplay: true,
          statement: formatStatementResponse(existing),
        };
      }

      const calc = await computeFinancialBucketsAndPreviewData(
        params.companyId,
        params.competence,
        tx
      );

      if (
        calc.contractStatus === 'NOT_CONFIGURED' ||
        calc.contractStatus === 'NOT_EFFECTIVE_IN_PERIOD'
      ) {
        const err: any = new Error(
          calc.contractStatus === 'NOT_CONFIGURED'
            ? 'Empresa sem contrato/taxa da plataforma configurada. Defina a taxa contratual (ou 0% explícito para gratuidade) antes de fechar o demonstrativo.'
            : 'Empresa não possui taxa contratual vigente na competência selecionada.'
        );
        err.status = 422;
        err.code = calc.contractStatus === 'NOT_CONFIGURED' ? 'RATE_NOT_CONFIGURED' : calc.contractStatus;
        throw err;
      }

      const rawNet = calc.grossPlatformFeeCents + calc.adjustmentsCents;
      const netDueCents = Math.max(0, rawNet);
      const carryForwardCreditCents = rawNet < 0 ? Math.abs(rawNet) : 0;
      const initialStatus = netDueCents === 0 ? 'PAID' : 'CLOSED';

      const createdStatement = await tx.platformMonthlyStatement.create({
        data: {
          companyId: params.companyId,
          competence: params.competence,
          startDate: calc.startDate,
          endDate: calc.endDate,
          status: initialStatus,
          isGratuitousZero: calc.isGratuitousZero,
          roundingPolicy: ROUNDING_POLICY_ITEM_HALF_UP_SUM,
          eligibleSalesCount: calc.eligibleSalesCount,
          eligibleSalesBaseCents: calc.eligibleSalesBaseCents,
          grossPlatformFeeCents: calc.grossPlatformFeeCents,
          adjustmentsCents: calc.adjustmentsCents,
          netDueCents,
          paidAmountCents: 0,
          remainingBalanceCents: netDueCents,
          carryForwardCreditCents,
          companyConfirmedSalesCents: calc.companyConfirmedSalesCents,
          companyCreditReceivedPrincipalCents: calc.companyCreditReceivedPrincipalCents,
          sellerInitialCommissionsCents: calc.sellerInitialCommissionsCents,
          sellerInstallmentCommissionsCents: calc.sellerInstallmentCommissionsCents,
          providerFeesCents: calc.providerFeesCents,
          excludedPreContractCount: calc.excludedPreContractCount,
          excludedPreContractBaseCents: calc.excludedPreContractBaseCents,
          excludedTestOrUnconfirmedCount: calc.excludedTestOrUnconfirmedCount,
          vigenciaBreakdown: calc.vigenciaBreakdown as unknown as Prisma.InputJsonValue,
          closedByUserId: params.closedByUserId,
          closedByName: params.closedByName,
          notes: params.notes ? String(params.notes).trim() : null,
        },
      });

      if (calc.eligibleItems.length > 0) {
        await tx.platformStatementItem.createMany({
          data: calc.eligibleItems.map((item) => ({
            statementId: createdStatement.id,
            companyId: params.companyId,
            saleId: item.saleId,
            competence: params.competence,
            saleReference: item.saleReference,
            saleDate: item.saleDate,
            city: item.city,
            product: item.product,
            paymentModality: item.paymentModality,
            saleBaseCents: item.saleBaseCents,
            rateId: item.rateId,
            rateVersion: item.rateVersion,
            ratePercentage: item.ratePercentage,
            rateMilliPercent: item.rateMilliPercent,
            calculatedFeeCents: item.calculatedFeeCents,
          })),
        });
      }

      if (calc.pendingAdjustments.length > 0) {
        await tx.platformStatementAdjustment.updateMany({
          where: {
            id: { in: calc.pendingAdjustments.map((a) => a.id) },
          },
          data: {
            appliedStatementId: createdStatement.id,
          },
        });
      }

      await recordOperationalAuditEvent(
        {
          companyId: params.companyId,
          category: 'CONTRACT',
          action: 'PLATFORM_MONTHLY_STATEMENT_CLOSED',
          entityType: 'PLATFORM_STATEMENT',
          entityReference: `${params.competence}:${calc.company.name}`,
          entityId: createdStatement.id,
          previousValues: { status: 'OPEN' },
          newValues: {
            competence: params.competence,
            status: initialStatus,
            eligibleSalesCount: calc.eligibleSalesCount,
            eligibleSalesBaseCents: calc.eligibleSalesBaseCents,
            grossPlatformFeeCents: calc.grossPlatformFeeCents,
            adjustmentsCents: calc.adjustmentsCents,
            netDueCents,
          },
          reason: params.notes || `Fechamento mensal do demonstrativo Lumora (${params.competence})`,
          authorUserId: params.closedByUserId,
          authorName: params.closedByName,
          authorRole: 'OWNER',
          ipAddress: params.ipAddress || null,
        },
        tx
      );

      const fullStatement = await tx.platformMonthlyStatement.findUniqueOrThrow({
        where: { id: createdStatement.id },
        include: {
          company: { select: { id: true, name: true, tradeName: true, cnpj: true, status: true } },
          items: { orderBy: { saleDate: 'asc' } },
          appliedAdjustments: { orderBy: { createdAt: 'asc' } },
          payments: { orderBy: { paidAt: 'asc' } },
        },
      });

      return {
        created: true,
        idempotentReplay: false,
        statement: formatStatementResponse(fullStatement),
      };
    },
    { timeout: 30000 }
  );
}

/**
 * Recalcula somente os totalizadores de liquidação/ajustes de um demonstrativo existente,
 * preservando 100% imutáveis: grossPlatformFeeCents, eligibleSalesBaseCents, vigenciaBreakdown e itens.
 */
async function syncStatementBalanceTotals(
  statementId: string,
  tx: Prisma.TransactionClient
) {
  await tx.$queryRaw`SELECT id FROM "PlatformMonthlyStatement" WHERE id = ${statementId} FOR UPDATE`;

  const st = await tx.platformMonthlyStatement.findUniqueOrThrow({
    where: { id: statementId },
    include: {
      appliedAdjustments: true,
      payments: true,
    },
  });

  const adjustmentsCents = st.appliedAdjustments.reduce((acc, a) => acc + a.amountCents, 0);
  const paidAmountCents = st.payments.reduce((acc, p) => acc + p.amountCents, 0);
  const rawNet = st.grossPlatformFeeCents + adjustmentsCents;
  const netDueCents = Math.max(0, rawNet);
  const remainingBalanceCents = Math.max(0, netDueCents - paidAmountCents);
  const carryForwardCreditCents =
    paidAmountCents > netDueCents
      ? paidAmountCents - netDueCents + (rawNet < 0 ? Math.abs(rawNet) : 0)
      : rawNet < 0
      ? Math.abs(rawNet)
      : 0;

  let status = 'CLOSED';
  if (netDueCents === 0 || remainingBalanceCents === 0) {
    status = 'PAID';
  } else if (paidAmountCents > 0) {
    status = 'PARTIALLY_PAID';
  }

  return tx.platformMonthlyStatement.update({
    where: { id: statementId },
    data: {
      adjustmentsCents,
      netDueCents,
      paidAmountCents,
      remainingBalanceCents,
      carryForwardCreditCents,
      status,
    },
  });
}

/**
 * Registra crédito proporcional de cancelamento/devolução sobre venda já faturada em demonstrativo,
 * usando SEMPRE a taxa e versão originais do item cobrado (nunca uma taxa nova!) e impedindo repetição.
 * Também suporta ajuste administrativo vinculado a competência com justificativa e chave idempotente.
 */
export async function recordStatementAdjustmentOrReturnCredit(
  params: {
    companyId: string;
    idempotencyKey: string;
    type:
      | 'SALE_CANCELLATION_CREDIT'
      | 'PARTIAL_RETURN_CREDIT'
      | 'MANUAL_CREDIT'
      | 'MANUAL_DEBIT';
    originSaleId?: string;
    returnedBaseCents?: number;
    manualAmountCents?: number;
    appliedCompetence?: string;
    reason: string;
    authorUserId: string;
    authorName: string;
    ipAddress?: string;
  },
  dbClient: PrismaClient = defaultPrisma
) {
  const cleanKey = String(params.idempotencyKey || '').trim();
  if (cleanKey.length < 4) {
    const err: any = new Error('Chave de idempotência (idempotencyKey) é obrigatória.');
    err.status = 400;
    throw err;
  }
  const cleanReason = String(params.reason || '').trim();
  if (cleanReason.length < 5) {
    const err: any = new Error('Justificativa do ajuste/devolução é obrigatória (mínimo 5 caracteres).');
    err.status = 400;
    throw err;
  }

  return dbClient.$transaction(
    async (tx) => {
      const existingAdj = await tx.platformStatementAdjustment.findUnique({
        where: { idempotencyKey: cleanKey },
      });
      if (existingAdj) {
        return {
          created: false,
          idempotentReplay: true,
          adjustment: existingAdj,
        };
      }

      if (
        params.type === 'SALE_CANCELLATION_CREDIT' ||
        params.type === 'PARTIAL_RETURN_CREDIT'
      ) {
        if (!params.originSaleId) {
          const err: any = new Error(
            'originSaleId é obrigatório para crédito de cancelamento ou devolução proporcional.'
          );
          err.status = 400;
          throw err;
        }

        // Trava pessimista no item original do demonstrativo
        const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "PlatformStatementItem"
          WHERE "saleId" = ${params.originSaleId} AND "companyId" = ${params.companyId}
          FOR UPDATE
        `;
        if (!lockedRows || lockedRows.length === 0) {
          const err: any = new Error(
            'Venda informada não possui cobrança original faturada em demonstrativo desta empresa.'
          );
          err.status = 404;
          throw err;
        }

        const originItem = await tx.platformStatementItem.findUniqueOrThrow({
          where: { id: lockedRows[0].id },
          include: { statement: true },
        });

        const remainingReturnableBaseCents =
          originItem.saleBaseCents - originItem.creditedBaseCents;
        if (remainingReturnableBaseCents <= 0) {
          const err: any = new Error(
            'Esta venda já teve 100% da base original creditada anteriormente; crédito repetido bloqueado.'
          );
          err.status = 409;
          err.code = 'ORIGIN_ITEM_ALREADY_FULLY_CREDITED';
          throw err;
        }

        const requestedReturnBaseCents =
          params.type === 'SALE_CANCELLATION_CREDIT' &&
          (params.returnedBaseCents === undefined || params.returnedBaseCents === null)
            ? remainingReturnableBaseCents
            : Number(params.returnedBaseCents);

        if (
          !Number.isInteger(requestedReturnBaseCents) ||
          requestedReturnBaseCents <= 0 ||
          requestedReturnBaseCents > remainingReturnableBaseCents
        ) {
          const err: any = new Error(
            `Valor devolvido inválido (${requestedReturnBaseCents}). Restante elegível para crédito neste item: ${remainingReturnableBaseCents} centavos.`
          );
          err.status = 422;
          err.code = 'RETURN_EXCEEDS_ORIGINAL_SALE_BASE';
          throw err;
        }

        const remainingFeeCents =
          originItem.calculatedFeeCents - originItem.creditedFeeCents;

        // Cálculo proporcional ESTRITAMENTE pela taxa original da cobrança (originItem.rateMilliPercent), NUNCA usando taxa posterior
        let creditFeeCents: number;
        if (requestedReturnBaseCents === remainingReturnableBaseCents) {
          // Quitação integral do saldo da venda devolve exatamente os centavos restantes da taxa original cobrada
          creditFeeCents = remainingFeeCents;
        } else {
          creditFeeCents = Math.min(
            remainingFeeCents,
            calculateFeeCentsHalfUp(requestedReturnBaseCents, originItem.rateMilliPercent)
          );
        }

        // Definir competência de aplicação:
        // Se informada explicitamente, usa ela; senão, se o demonstrativo de origem ainda tiver saldo em aberto, abate nele;
        // se o demonstrativo de origem já estiver PAID, aplica na competência atual para não reabrir demonstrativo quitado.
        let targetCompetence: string;
        if (params.appliedCompetence) {
          getCompetenceRange(params.appliedCompetence);
          targetCompetence = params.appliedCompetence;
        } else if (originItem.statement.status !== 'PAID') {
          targetCompetence = originItem.competence;
        } else {
          targetCompetence = getCompetenceForDate(new Date());
        }

        const targetStatement = await tx.platformMonthlyStatement.findUnique({
          where: {
            companyId_competence: {
              companyId: params.companyId,
              competence: targetCompetence,
            },
          },
        });

        await tx.platformStatementItem.update({
          where: { id: originItem.id },
          data: {
            creditedBaseCents: originItem.creditedBaseCents + requestedReturnBaseCents,
            creditedFeeCents: originItem.creditedFeeCents + creditFeeCents,
          },
        });

        const createdAdj = await tx.platformStatementAdjustment.create({
          data: {
            idempotencyKey: cleanKey,
            companyId: params.companyId,
            appliedStatementId: targetStatement ? targetStatement.id : null,
            appliedCompetence: targetCompetence,
            originStatementId: originItem.statementId,
            originItemId: originItem.id,
            originSaleId: originItem.saleId,
            originSaleReference: originItem.saleReference,
            type: params.type,
            returnedBaseCents: requestedReturnBaseCents,
            originalRateVersion: originItem.rateVersion,
            originalRatePercentage: originItem.ratePercentage,
            originalRateMilliPercent: originItem.rateMilliPercent,
            amountCents: -creditFeeCents,
            reason: cleanReason,
            createdByUserId: params.authorUserId,
            createdByName: params.authorName,
          },
        });

        if (targetStatement) {
          await syncStatementBalanceTotals(targetStatement.id, tx);
        }

        await recordOperationalAuditEvent(
          {
            companyId: params.companyId,
            category: 'REVERSAL',
            action: 'PLATFORM_STATEMENT_PROPORTIONAL_RETURN_CREDIT',
            entityType: 'PLATFORM_STATEMENT',
            entityReference: originItem.saleReference,
            entityId: createdAdj.id,
            previousValues: {
              originCompetence: originItem.competence,
              saleBaseCents: originItem.saleBaseCents,
              originalRateVersion: originItem.rateVersion,
              originalRatePercentage: Number(originItem.ratePercentage),
              previouslyCreditedBaseCents: originItem.creditedBaseCents,
            },
            newValues: {
              appliedCompetence: targetCompetence,
              returnedBaseCents: requestedReturnBaseCents,
              creditFeeCents,
              amountCents: -creditFeeCents,
            },
            reason: cleanReason,
            authorUserId: params.authorUserId,
            authorName: params.authorName,
            authorRole: 'OWNER',
            ipAddress: params.ipAddress || null,
          },
          tx
        );

        return {
          created: true,
          idempotentReplay: false,
          adjustment: createdAdj,
        };
      }

      // Ajuste manual (MANUAL_CREDIT ou MANUAL_DEBIT)
      if (!params.appliedCompetence) {
        const err: any = new Error(
          'appliedCompetence (YYYY-MM) é obrigatório para ajuste manual.'
        );
        err.status = 400;
        throw err;
      }
      getCompetenceRange(params.appliedCompetence);

      const rawManualCents = Number(params.manualAmountCents);
      if (!Number.isInteger(rawManualCents) || rawManualCents <= 0) {
        const err: any = new Error(
          'manualAmountCents deve ser um inteiro positivo em centavos.'
        );
        err.status = 400;
        throw err;
      }

      const signedAmountCents =
        params.type === 'MANUAL_CREDIT' ? -rawManualCents : rawManualCents;

      const targetStatement = await tx.platformMonthlyStatement.findUnique({
        where: {
          companyId_competence: {
            companyId: params.companyId,
            competence: params.appliedCompetence,
          },
        },
      });

      const createdManualAdj = await tx.platformStatementAdjustment.create({
        data: {
          idempotencyKey: cleanKey,
          companyId: params.companyId,
          appliedStatementId: targetStatement ? targetStatement.id : null,
          appliedCompetence: params.appliedCompetence,
          type: params.type,
          returnedBaseCents: 0,
          amountCents: signedAmountCents,
          reason: cleanReason,
          createdByUserId: params.authorUserId,
          createdByName: params.authorName,
        },
      });

      if (targetStatement) {
        await syncStatementBalanceTotals(targetStatement.id, tx);
      }

      await recordOperationalAuditEvent(
        {
          companyId: params.companyId,
          category: 'CONTRACT',
          action: `PLATFORM_STATEMENT_${params.type}`,
          entityType: 'PLATFORM_STATEMENT',
          entityReference: params.appliedCompetence,
          entityId: createdManualAdj.id,
          previousValues: null,
          newValues: {
            appliedCompetence: params.appliedCompetence,
            type: params.type,
            amountCents: signedAmountCents,
          },
          reason: cleanReason,
          authorUserId: params.authorUserId,
          authorName: params.authorName,
          authorRole: 'OWNER',
          ipAddress: params.ipAddress || null,
        },
        tx
      );

      return {
        created: true,
        idempotentReplay: false,
        adjustment: createdManualAdj,
      };
    },
    { timeout: 30000 }
  );
}

const VALID_SETTLEMENT_METHODS = new Set([
  'PIX_OUTSIDE_APP',
  'TED_OUTSIDE_APP',
  'BOLETO_OUTSIDE_APP',
  'BANK_TRANSFER_OUTSIDE_APP',
  'MANUAL_RECONCILIATION',
]);

/**
 * Registra liquidação parcial ou integral do demonstrativo mensal (conciliação manual B2B fora do app).
 * NUNCA emite cobrança bancária nem movimenta fundos.
 */
export async function recordStatementManualPayment(
  params: {
    statementId: string;
    idempotencyKey: string;
    amountCents: number;
    paymentMethod?: string;
    paidAt?: Date;
    externalReference?: string;
    notes?: string;
    recordedByUserId: string;
    recordedByName: string;
    ipAddress?: string;
  },
  dbClient: PrismaClient = defaultPrisma
) {
  const cleanKey = String(params.idempotencyKey || '').trim();
  if (cleanKey.length < 4) {
    const err: any = new Error('Chave de idempotência (idempotencyKey) é obrigatória.');
    err.status = 400;
    throw err;
  }

  const amountCents = Number(params.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    const err: any = new Error('amountCents deve ser um valor inteiro positivo em centavos.');
    err.status = 400;
    throw err;
  }

  const method = String(params.paymentMethod || 'PIX_OUTSIDE_APP').toUpperCase();
  if (!VALID_SETTLEMENT_METHODS.has(method)) {
    const err: any = new Error(
      `Método de conciliação inválido (${method}). Permitidos apenas registros externos ao app.`
    );
    err.status = 400;
    throw err;
  }

  return dbClient.$transaction(
    async (tx) => {
      const existingPay = await tx.platformStatementPayment.findUnique({
        where: { idempotencyKey: cleanKey },
      });
      if (existingPay) {
        const st = await tx.platformMonthlyStatement.findUniqueOrThrow({
          where: { id: existingPay.statementId },
          include: {
            company: { select: { id: true, name: true, tradeName: true, cnpj: true, status: true } },
            items: { orderBy: { saleDate: 'asc' } },
            appliedAdjustments: { orderBy: { createdAt: 'asc' } },
            payments: { orderBy: { paidAt: 'asc' } },
          },
        });
        return {
          created: false,
          idempotentReplay: true,
          payment: existingPay,
          statement: formatStatementResponse(st),
        };
      }

      const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "PlatformMonthlyStatement" WHERE id = ${params.statementId} FOR UPDATE
      `;
      if (!lockedRows || lockedRows.length === 0) {
        const err: any = new Error('Demonstrativo mensal não encontrado.');
        err.status = 404;
        throw err;
      }

      const stBefore = await tx.platformMonthlyStatement.findUniqueOrThrow({
        where: { id: params.statementId },
      });

      if (stBefore.remainingBalanceCents <= 0) {
        const err: any = new Error(
          'Este demonstrativo já se encontra integralmente quitado (saldo restante R$ 0,00).'
        );
        err.status = 409;
        err.code = 'STATEMENT_ALREADY_PAID';
        throw err;
      }

      if (amountCents > stBefore.remainingBalanceCents) {
        const err: any = new Error(
          `Valor informado (${amountCents} centavos) excede o saldo em aberto do demonstrativo (${stBefore.remainingBalanceCents} centavos).`
        );
        err.status = 422;
        err.code = 'PAYMENT_EXCEEDS_REMAINING_BALANCE';
        throw err;
      }

      const createdPay = await tx.platformStatementPayment.create({
        data: {
          idempotencyKey: cleanKey,
          statementId: stBefore.id,
          companyId: stBefore.companyId,
          amountCents,
          paymentMethod: method,
          paidAt: params.paidAt || new Date(),
          externalReference: params.externalReference
            ? String(params.externalReference).trim()
            : null,
          notes: params.notes ? String(params.notes).trim() : null,
          recordedByUserId: params.recordedByUserId,
          recordedByName: params.recordedByName,
        },
      });

      await syncStatementBalanceTotals(stBefore.id, tx);

      const updatedSt = await tx.platformMonthlyStatement.findUniqueOrThrow({
        where: { id: stBefore.id },
        include: {
          company: { select: { id: true, name: true, tradeName: true, cnpj: true, status: true } },
          items: { orderBy: { saleDate: 'asc' } },
          appliedAdjustments: { orderBy: { createdAt: 'asc' } },
          payments: { orderBy: { paidAt: 'asc' } },
        },
      });

      await recordOperationalAuditEvent(
        {
          companyId: stBefore.companyId,
          category: 'PAYMENT',
          action: 'PLATFORM_STATEMENT_SETTLEMENT_RECORDED',
          entityType: 'PLATFORM_STATEMENT',
          entityReference: `${stBefore.competence}:${updatedSt.company.name}`,
          entityId: stBefore.id,
          previousValues: {
            status: stBefore.status,
            paidAmountCents: stBefore.paidAmountCents,
            remainingBalanceCents: stBefore.remainingBalanceCents,
          },
          newValues: {
            status: updatedSt.status,
            paymentAmountCents: amountCents,
            paymentMethod: method,
            paidAmountCents: updatedSt.paidAmountCents,
            remainingBalanceCents: updatedSt.remainingBalanceCents,
          },
          reason:
            params.notes ||
            `Conciliação manual externa B2B (${method}) referente à competência ${stBefore.competence}`,
          authorUserId: params.recordedByUserId,
          authorName: params.recordedByName,
          authorRole: 'OWNER',
          ipAddress: params.ipAddress || null,
        },
        tx
      );

      return {
        created: true,
        idempotentReplay: false,
        payment: createdPay,
        statement: formatStatementResponse(updatedSt),
      };
    },
    { timeout: 30000 }
  );
}

/**
 * Lista demonstrativos fechados (e/ou resumo por competência de todas as empresas para o Proprietário).
 */
export async function listPlatformStatementsOverview(
  params: {
    competence?: string;
    companyId?: string;
    status?: string;
  },
  dbClient: PrismaClient = defaultPrisma
) {
  const where: Prisma.PlatformMonthlyStatementWhereInput = {};
  if (params.competence) {
    getCompetenceRange(params.competence);
    where.competence = params.competence;
  }
  if (params.companyId) where.companyId = params.companyId;
  if (params.status) where.status = params.status;

  const statements = await dbClient.platformMonthlyStatement.findMany({
    where,
    include: {
      company: { select: { id: true, name: true, tradeName: true, cnpj: true, status: true } },
      appliedAdjustments: { orderBy: { createdAt: 'asc' } },
      payments: { orderBy: { paidAt: 'asc' } },
    },
    orderBy: [{ competence: 'desc' }, { closedAt: 'desc' }],
  });

  // Se uma competência específica foi pedida sem filtro de status, também listar o status contratual das empresas ainda abertas
  let unclosedCompaniesPreview: any[] = [];
  if (params.competence && !params.status) {
    const closedCompanyIds = new Set(statements.map((s) => s.companyId));
    const companiesWhere: Prisma.CompanyWhereInput = params.companyId
      ? { id: params.companyId }
      : {};
    const allCompanies = await dbClient.company.findMany({
      where: companiesWhere,
      select: { id: true, name: true, status: true },
      orderBy: { name: 'asc' },
    });

    for (const comp of allCompanies) {
      if (closedCompanyIds.has(comp.id)) continue;
      // Excluir empresas sintéticas de homologação/teste de listagens financeiras reais quando não filtradas explicitamente
      if (!params.companyId && isTestOrSimulationMarker(comp.name)) continue;

      const prev = await previewOrGetCompanyStatement(
        { companyId: comp.id, competence: params.competence },
        dbClient
      );
      if (!prev.isClosed && prev.preview) {
        const { items: _omitItems, ...summaryPreview } = prev.preview;
        unclosedCompaniesPreview.push(summaryPreview);
      }
    }
  }

  const formattedStatements = statements
    .filter((s) => params.companyId || !isTestOrSimulationMarker(s.company?.name))
    .map((s) => formatStatementResponse(s));

  const totals = formattedStatements.reduce(
    (acc, s) => {
      acc.closedCount += 1;
      acc.eligibleSalesBaseCents += s.eligibleSalesBaseCents;
      acc.grossPlatformFeeCents += s.grossPlatformFeeCents;
      acc.adjustmentsCents += s.adjustmentsCents;
      acc.netDueCents += s.netDueCents;
      acc.paidAmountCents += s.paidAmountCents;
      acc.remainingBalanceCents += s.remainingBalanceCents;
      return acc;
    },
    {
      closedCount: 0,
      eligibleSalesBaseCents: 0,
      grossPlatformFeeCents: 0,
      adjustmentsCents: 0,
      netDueCents: 0,
      paidAmountCents: 0,
      remainingBalanceCents: 0,
    }
  );

  return {
    storeBillingPolicy: STORE_BILLING_POLICY_METADATA,
    roundingPolicy: ROUNDING_POLICY_ITEM_HALF_UP_SUM,
    totals: {
      ...totals,
      eligibleSalesBaseBrl: centsToBrlNumber(totals.eligibleSalesBaseCents),
      grossPlatformFeeBrl: centsToBrlNumber(totals.grossPlatformFeeCents),
      adjustmentsBrl: centsToBrlNumber(totals.adjustmentsCents),
      netDueBrl: centsToBrlNumber(totals.netDueCents),
      paidAmountBrl: centsToBrlNumber(totals.paidAmountCents),
      remainingBalanceBrl: centsToBrlNumber(totals.remainingBalanceCents),
    },
    statements: formattedStatements,
    unclosedCompaniesPreview,
  };
}

