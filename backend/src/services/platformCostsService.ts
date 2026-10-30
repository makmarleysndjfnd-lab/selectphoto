import { PrismaClient, Prisma } from '@prisma/client';
import { getCompetenceRange } from './monthlyCreditClosingService';
import { centsToBrlNumber, previewOrGetCompanyStatement } from './platformBillingService';
import { isTestOrSimulationMarker, recordOperationalAuditEvent } from './operationalAuditService';

const defaultPrisma = new PrismaClient();

export const VALID_COST_CATEGORIES = [
  'INFRASTRUCTURE',
  'TOOLS',
  'APIS',
  'MESSAGING',
] as const;

export const VALID_COST_MEASUREMENT_TYPES = [
  'MEASURED',
  'ESTIMATED',
  'MANUAL',
] as const;

export const VALID_COST_CURRENCIES = ['BRL', 'USD'] as const;

export const VALID_COST_PAYERS = ['PLATFORM', 'COMPANY'] as const;

export const VALID_ALLOCATION_RULES = [
  'DIRECT_COMPANY',
  'PROPORTIONAL_ELIGIBLE_SALES',
  'EQUAL_ACTIVE_COMPANIES',
  'USAGE_UNITS',
  'UNALLOCATED_PLATFORM_OVERHEAD',
] as const;

export const PROVIDER_BILLING_CAPABILITIES = {
  RENDER: {
    provider: 'RENDER',
    category: 'INFRASTRUCTURE',
    automatedInvoiceApiIntegrated: false,
    internalTelemetryAvailable: false,
    supportedModes: ['MANUAL', 'ESTIMATED'],
    note: 'Sem API de faturamento integrada no Lumora; registrar fatura mensal consolidada manualmente informando moeda/câmbio.',
  },
  BACKBLAZE_B2: {
    provider: 'BACKBLAZE_B2',
    category: 'INFRASTRUCTURE',
    automatedInvoiceApiIntegrated: false,
    internalTelemetryAvailable: false,
    supportedModes: ['MANUAL', 'ESTIMATED'],
    note: 'Sem leitura automática de fatura integrada; lançar consumo/fatura verificada manualmente.',
  },
  GEMINI: {
    provider: 'GEMINI',
    category: 'APIS',
    automatedInvoiceApiIntegrated: false,
    internalTelemetryAvailable: true,
    supportedModes: ['ESTIMATED', 'MEASURED', 'MANUAL'],
    note: 'Telemetria interna de chamadas (ApiUsageRecord) ativa; fatura oficial pode substituir estimativas com replacesTelemetryUsage=true.',
  },
  GROK: {
    provider: 'GROK',
    category: 'APIS',
    automatedInvoiceApiIntegrated: false,
    internalTelemetryAvailable: true,
    supportedModes: ['ESTIMATED', 'MEASURED', 'MANUAL'],
    note: 'Telemetria interna de chamadas ativa; fatura oficial pode substituir estimativas com replacesTelemetryUsage=true.',
  },
  META_WHATSAPP: {
    provider: 'META_WHATSAPP',
    category: 'MESSAGING',
    automatedInvoiceApiIntegrated: false,
    internalTelemetryAvailable: true,
    supportedModes: ['MANUAL', 'ESTIMATED'],
    note: 'Sem API de faturamento Meta contratada/ativa; lançamentos manuais ou telemetria quando habilitada.',
  },
  ASAAS: {
    provider: 'ASAAS',
    category: 'TOOLS',
    automatedInvoiceApiIntegrated: false,
    internalTelemetryAvailable: true,
    supportedModes: ['MEASURED', 'MANUAL'],
    note: 'Tarifas por boleto/PIX liquidado pertencem à conta emissora da empresa cliente (costPayer=COMPANY), exceto eventual conta própria futura da plataforma; Sandbox excluído.',
  },
  GOOGLE_PLAY: {
    provider: 'GOOGLE_PLAY',
    category: 'TOOLS',
    automatedInvoiceApiIntegrated: false,
    internalTelemetryAvailable: false,
    supportedModes: ['MANUAL'],
    note: 'Taxa de conta de desenvolvedor Google Play lançada manualmente quando contratada.',
  },
  APPLE_DEVELOPER: {
    provider: 'APPLE_DEVELOPER',
    category: 'TOOLS',
    automatedInvoiceApiIntegrated: false,
    internalTelemetryAvailable: false,
    supportedModes: ['MANUAL'],
    note: 'Assinatura anual Apple Developer Program lançada manualmente quando contratada.',
  },
} as const;

export function convertOriginalToBrlCents(
  originalAmountCents: number,
  currency: 'BRL' | 'USD',
  exchangeRateMilli?: number | null
): number {
  if (!Number.isInteger(originalAmountCents) || originalAmountCents < 0) {
    throw new Error('originalAmountCents deve ser um inteiro não-negativo em centavos.');
  }
  if (currency === 'BRL') {
    return originalAmountCents;
  }
  if (
    exchangeRateMilli === undefined ||
    exchangeRateMilli === null ||
    !Number.isInteger(exchangeRateMilli) ||
    exchangeRateMilli <= 0
  ) {
    throw new Error(
      'exchangeRateMilli (ex.: 5750 para R$ 5,750/US$) é obrigatório para custos em USD.'
    );
  }
  const num = BigInt(originalAmountCents) * BigInt(exchangeRateMilli);
  return Number((num + 500n) / 1000n);
}

/**
 * Distribui centavos proporcionalmente a pesos inteiros positivos preservando soma 100% exata (Largest Remainder Method).
 */
export function allocateCentsProportionally(
  totalCents: number,
  weights: Array<{ companyId: string; weight: number }>
): Map<string, number> {
  const result = new Map<string, number>();
  const positive = weights.filter((w) => w.weight > 0);
  if (totalCents <= 0 || positive.length === 0) {
    return result;
  }

  const totalWeight = positive.reduce((acc, w) => acc + BigInt(w.weight), 0n);
  if (totalWeight <= 0n) return result;

  const floors: Array<{ companyId: string; floor: number; remainder: bigint }> = [];
  let allocatedSum = 0;

  for (const w of positive) {
    const prod = BigInt(totalCents) * BigInt(w.weight);
    const fl = Number(prod / totalWeight);
    const rem = prod % totalWeight;
    floors.push({ companyId: w.companyId, floor: fl, remainder: rem });
    allocatedSum += fl;
  }

  let leftover = totalCents - allocatedSum;
  floors.sort((a, b) => {
    if (b.remainder > a.remainder) return 1;
    if (b.remainder < a.remainder) return -1;
    return a.companyId.localeCompare(b.companyId);
  });

  for (let i = 0; i < floors.length; i++) {
    const extra = i < leftover ? 1 : 0;
    result.set(floors[i].companyId, floors[i].floor + extra);
  }

  return result;
}

export async function recordPlatformCostEntry(
  params: {
    idempotencyKey: string;
    companyId?: string | null;
    competence: string;
    periodStart?: string | Date | null;
    periodEnd?: string | Date | null;
    category: string;
    provider: string;
    measurementType: string;
    sourceDocument: string;
    currency?: string;
    originalAmountCents: number;
    exchangeRateMilli?: number | null;
    costPayer?: string;
    allocationRule?: string;
    replacesTelemetryUsage?: boolean;
    isTestOrSimulation?: boolean;
    notes?: string | null;
    createdByUserId: string;
    createdByName: string;
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

  getCompetenceRange(params.competence);

  const category = String(params.category || '').toUpperCase();
  if (!VALID_COST_CATEGORIES.includes(category as any)) {
    const err: any = new Error(
      `Categoria inválida (${category}). Use INFRASTRUCTURE, TOOLS, APIS ou MESSAGING.`
    );
    err.status = 400;
    throw err;
  }

  const measurementType = String(params.measurementType || '').toUpperCase();
  if (!VALID_COST_MEASUREMENT_TYPES.includes(measurementType as any)) {
    const err: any = new Error(
      `Tipo de apuração inválido (${measurementType}). Use MEASURED, ESTIMATED ou MANUAL.`
    );
    err.status = 400;
    throw err;
  }

  const currency = String(params.currency || 'BRL').toUpperCase() as 'BRL' | 'USD';
  if (!VALID_COST_CURRENCIES.includes(currency)) {
    const err: any = new Error(`Moeda inválida (${currency}). Use BRL ou USD.`);
    err.status = 400;
    throw err;
  }

  const costPayer = String(params.costPayer || 'PLATFORM').toUpperCase();
  if (!VALID_COST_PAYERS.includes(costPayer as any)) {
    const err: any = new Error(`Pagador inválido (${costPayer}). Use PLATFORM ou COMPANY.`);
    err.status = 400;
    throw err;
  }

  const defaultRule = params.companyId
    ? 'DIRECT_COMPANY'
    : 'UNALLOCATED_PLATFORM_OVERHEAD';
  const allocationRule = String(params.allocationRule || defaultRule).toUpperCase();
  if (!VALID_ALLOCATION_RULES.includes(allocationRule as any)) {
    const err: any = new Error(`Regra de rateio inválida (${allocationRule}).`);
    err.status = 400;
    throw err;
  }

  if (allocationRule === 'DIRECT_COMPANY' && !params.companyId) {
    const err: any = new Error(
      'Regra DIRECT_COMPANY exige informar companyId da empresa vinculada.'
    );
    err.status = 400;
    throw err;
  }

  if (costPayer === 'COMPANY' && !params.companyId) {
    const err: any = new Error(
      'Custos pagos diretamente pela empresa cliente (costPayer=COMPANY) exigem companyId.'
    );
    err.status = 400;
    throw err;
  }

  const cleanSource = String(params.sourceDocument || '').trim();
  if (cleanSource.length < 4) {
    const err: any = new Error(
      'Origem verificável (sourceDocument) é obrigatória (ex.: número da fatura, recibo ou regra contratual).'
    );
    err.status = 400;
    throw err;
  }

  const provider = String(params.provider || 'OTHER')
    .trim()
    .toUpperCase();

  let amountBrlCents: number;
  try {
    amountBrlCents = convertOriginalToBrlCents(
      Number(params.originalAmountCents),
      currency,
      params.exchangeRateMilli ?? null
    );
  } catch (convErr: any) {
    const err: any = new Error(convErr.message);
    err.status = 400;
    throw err;
  }

  const existing = await dbClient.platformCostEntry.findUnique({
    where: { idempotencyKey: cleanKey },
  });
  if (existing) {
    return {
      created: false,
      idempotentReplay: true,
      entry: existing,
    };
  }

  if (params.companyId) {
    const companyExists = await dbClient.company.findUnique({
      where: { id: params.companyId },
      select: { id: true },
    });
    if (!companyExists) {
      const err: any = new Error('Empresa vinculada ao custo não encontrada.');
      err.status = 404;
      throw err;
    }
  }

  const detectedTest =
    Boolean(params.isTestOrSimulation) ||
    isTestOrSimulationMarker(cleanSource) ||
    isTestOrSimulationMarker(params.notes || '');

  const created = await dbClient.platformCostEntry.create({
    data: {
      idempotencyKey: cleanKey,
      companyId: params.companyId || null,
      competence: params.competence,
      periodStart: params.periodStart ? new Date(params.periodStart) : null,
      periodEnd: params.periodEnd ? new Date(params.periodEnd) : null,
      category,
      provider,
      measurementType,
      sourceDocument: cleanSource,
      currency,
      originalAmountCents: Number(params.originalAmountCents),
      exchangeRateMilli:
        currency === 'USD' ? Number(params.exchangeRateMilli) : null,
      amountBrlCents,
      costPayer,
      allocationRule,
      replacesTelemetryUsage: Boolean(params.replacesTelemetryUsage),
      isTestOrSimulation: detectedTest,
      notes: params.notes ? String(params.notes).trim() : null,
      createdByUserId: params.createdByUserId,
      createdByName: params.createdByName,
    },
  });

  await recordOperationalAuditEvent(
    {
      companyId: params.companyId || null,
      category: 'CONTRACT',
      action: 'PLATFORM_COST_RECORDED',
      entityType: 'PLATFORM_COST',
      entityReference: `${params.competence}:${provider}:${category}`,
      entityId: created.id,
      previousValues: null,
      newValues: {
        competence: params.competence,
        category,
        provider,
        measurementType,
        currency,
        originalAmountCents: created.originalAmountCents,
        amountBrlCents: created.amountBrlCents,
        costPayer,
        allocationRule,
        replacesTelemetryUsage: created.replacesTelemetryUsage,
      },
      reason: cleanSource,
      authorUserId: params.createdByUserId,
      authorName: params.createdByName,
      authorRole: 'OWNER',
      isTestOrSimulation: detectedTest,
      ipAddress: params.ipAddress || null,
    },
    dbClient
  );

  return {
    created: true,
    idempotentReplay: false,
    entry: created,
  };
}

/**
 * Consolida custos da plataforma, telemetria de APIs sem dupla contagem, rateio explícito por empresa,
 * separação estrita contra despesas das empresas clientes e painel de Margem Real vs Estimada.
 */
export async function getPlatformCostsAndMarginPanel(
  params: {
    competence: string;
    includeSimulation?: boolean;
  },
  dbClient: PrismaClient = defaultPrisma
) {
  const { startDate, endDate } = getCompetenceRange(params.competence);

  // 1. Buscar entradas registradas de PlatformCostEntry na competência
  const costEntries = await dbClient.platformCostEntry.findMany({
    where: {
      competence: params.competence,
      ...(params.includeSimulation ? {} : { isTestOrSimulation: false }),
    },
    include: {
      company: { select: { id: true, name: true, tradeName: true } },
    },
    orderBy: [{ createdAt: 'desc' }],
  });

  // Identificar provedores cuja telemetria foi substituída por fatura consolidada (anti-dupla-contagem)
  const globalSupersededProviders = new Set<string>();
  const companySupersededProviderPairs = new Set<string>();
  for (const entry of costEntries) {
    if (entry.replacesTelemetryUsage) {
      const prov = entry.provider.toUpperCase();
      if (!entry.companyId) {
        globalSupersededProviders.add(prov);
      } else {
        companySupersededProviderPairs.add(`${prov}::${entry.companyId}`);
      }
    }
  }

  // 2. Buscar telemetria de uso de APIs no período (excluindo integrações SANDBOX quando includeSimulation=false)
  const usageRecords = await dbClient.apiUsageRecord.findMany({
    where: {
      timestamp: {
        gte: startDate,
        lt: endDate,
      },
    },
    include: {
      company: { select: { id: true, name: true } },
      integration: {
        select: {
          id: true,
          environment: true,
          costPayer: true,
          scope: true,
        },
      },
    },
  });

  let telemetryMeasuredPlatformCents = 0;
  let telemetryEstimatedPlatformCents = 0;
  let telemetryCompanyPaidCents = 0;
  let supersededTelemetryRecordsCount = 0;
  let supersededTelemetryCentsAvoided = 0;
  let excludedSandboxUsageCount = 0;

  // Mapa de unidades de uso por (provider -> companyId -> units) para eventual rateio USAGE_UNITS
  const usageUnitsByProvider = new Map<string, Map<string, number>>();

  for (const u of usageRecords) {
    const isSandboxRecord =
      u.integration?.environment === 'SANDBOX' ||
      isTestOrSimulationMarker(u.company?.name) ||
      isTestOrSimulationMarker(u.operation);

    if (isSandboxRecord && !params.includeSimulation) {
      excludedSandboxUsageCount += 1;
      continue;
    }

    const prov = String(u.provider || 'OTHER').toUpperCase();
    if (!usageUnitsByProvider.has(prov)) {
      usageUnitsByProvider.set(prov, new Map());
    }
    const compUnits = usageUnitsByProvider.get(prov)!;
    compUnits.set(u.companyId, (compUnits.get(u.companyId) || 0) + (u.unitsUsed || 1));

    const isSuperseded =
      globalSupersededProviders.has(prov) ||
      companySupersededProviderPairs.has(`${prov}::${u.companyId}`);

    const recordMeasured = u.measuredCostCents ?? null;
    const recordEstimated = recordMeasured === null ? u.estimatedCostCents ?? 0 : 0;
    const recordEffectiveCents = (recordMeasured ?? 0) + recordEstimated;

    if (isSuperseded) {
      supersededTelemetryRecordsCount += 1;
      supersededTelemetryCentsAvoided += recordEffectiveCents;
      continue;
    }

    const payer = u.integration?.costPayer === 'COMPANY' ? 'COMPANY' : 'PLATFORM';
    if (payer === 'COMPANY') {
      telemetryCompanyPaidCents += recordEffectiveCents;
    } else if (recordMeasured !== null) {
      telemetryMeasuredPlatformCents += recordMeasured;
    } else {
      telemetryEstimatedPlatformCents += recordEstimated;
    }
  }

  // 3. Empresas reais para apuração de receita contratada vs recebida e pesos de rateio
  const companies = await dbClient.company.findMany({
    select: { id: true, name: true, status: true, isActive: true },
    orderBy: { name: 'asc' },
  });

  const realCompanies = companies.filter(
    (c) => params.includeSimulation || !isTestOrSimulationMarker(c.name)
  );
  const activeRealCompanies = realCompanies.filter(
    (c) => c.isActive && c.status === 'ACTIVE'
  );

  let closedContractedRevenueCents = 0;
  let openPreviewContractedRevenueCents = 0;
  let statementReceivedRevenueCents = 0;
  const companyRevenueSummary: Array<{
    companyId: string;
    companyName: string;
    statementStatus: string;
    eligibleSalesBaseCents: number;
    contractedRevenueCents: number;
    receivedRevenueCents: number;
    allocatedPlatformCostCents: number;
    companyOwnPaidApiCostCents: number;
  }> = [];

  const salesWeights: Array<{ companyId: string; weight: number }> = [];

  for (const comp of realCompanies) {
    const stRes = await previewOrGetCompanyStatement(
      { companyId: comp.id, competence: params.competence },
      dbClient
    );

    if (stRes.isClosed && stRes.statement) {
      const st = stRes.statement;
      closedContractedRevenueCents += st.netDueCents;
      statementReceivedRevenueCents += st.paidAmountCents;
      salesWeights.push({ companyId: comp.id, weight: st.eligibleSalesBaseCents });
      companyRevenueSummary.push({
        companyId: comp.id,
        companyName: comp.name,
        statementStatus: st.status,
        eligibleSalesBaseCents: st.eligibleSalesBaseCents,
        contractedRevenueCents: st.netDueCents,
        receivedRevenueCents: st.paidAmountCents,
        allocatedPlatformCostCents: 0,
        companyOwnPaidApiCostCents: 0,
      });
    } else if (stRes.preview) {
      const pv = stRes.preview;
      if (pv.canClose) {
        openPreviewContractedRevenueCents += pv.netDueCents;
      }
      salesWeights.push({ companyId: comp.id, weight: pv.eligibleSalesBaseCents });
      companyRevenueSummary.push({
        companyId: comp.id,
        companyName: comp.name,
        statementStatus: pv.status,
        eligibleSalesBaseCents: pv.eligibleSalesBaseCents,
        contractedRevenueCents: pv.canClose ? pv.netDueCents : 0,
        receivedRevenueCents: 0,
        allocatedPlatformCostCents: 0,
        companyOwnPaidApiCostCents: 0,
      });
    }
  }

  // Pagamentos efetivamente recebidos na janela de caixa da competência (independente do mês de origem)
  const cashPaymentsInMonth = await dbClient.platformStatementPayment.findMany({
    where: {
      paidAt: {
        gte: startDate,
        lt: endDate,
      },
    },
    include: {
      company: { select: { name: true } },
    },
  });
  const cashReceivedInPeriodCents = cashPaymentsInMonth
    .filter((p) => params.includeSimulation || !isTestOrSimulationMarker(p.company?.name))
    .reduce((acc, p) => acc + p.amountCents, 0);

  // 4. Sumarizar PlatformCostEntry por tipo, categoria, pagador e aplicar regras explícitas de rateio
  let entryMeasuredPlatformCents = 0;
  let entryManualPlatformCents = 0;
  let entryEstimatedPlatformCents = 0;
  let entryCompanyPaidCents = 0;
  let unallocatedPlatformOverheadCents = 0;

  const byCategoryPlatformCents: Record<string, number> = {
    INFRASTRUCTURE: 0,
    TOOLS: 0,
    APIS: 0,
    MESSAGING: 0,
  };

  const summaryByCompId = new Map(
    companyRevenueSummary.map((item) => [item.companyId, item])
  );

  for (const entry of costEntries) {
    if (entry.costPayer === 'COMPANY') {
      entryCompanyPaidCents += entry.amountBrlCents;
      if (entry.companyId && summaryByCompId.has(entry.companyId)) {
        summaryByCompId.get(entry.companyId)!.companyOwnPaidApiCostCents +=
          entry.amountBrlCents;
      }
      continue;
    }

    // costPayer === 'PLATFORM'
    if (entry.measurementType === 'MEASURED') {
      entryMeasuredPlatformCents += entry.amountBrlCents;
    } else if (entry.measurementType === 'MANUAL') {
      entryManualPlatformCents += entry.amountBrlCents;
    } else {
      entryEstimatedPlatformCents += entry.amountBrlCents;
    }

    byCategoryPlatformCents[entry.category] =
      (byCategoryPlatformCents[entry.category] || 0) + entry.amountBrlCents;

    // Rateio explícito sem inventar distribuição oculta
    if (entry.allocationRule === 'DIRECT_COMPANY' && entry.companyId) {
      const target = summaryByCompId.get(entry.companyId);
      if (target) {
        target.allocatedPlatformCostCents += entry.amountBrlCents;
      } else {
        unallocatedPlatformOverheadCents += entry.amountBrlCents;
      }
    } else if (entry.allocationRule === 'PROPORTIONAL_ELIGIBLE_SALES') {
      const dist = allocateCentsProportionally(entry.amountBrlCents, salesWeights);
      if (dist.size === 0) {
        unallocatedPlatformOverheadCents += entry.amountBrlCents;
      } else {
        for (const [cid, cents] of dist.entries()) {
          const target = summaryByCompId.get(cid);
          if (target) target.allocatedPlatformCostCents += cents;
        }
      }
    } else if (entry.allocationRule === 'EQUAL_ACTIVE_COMPANIES') {
      const equalWeights = activeRealCompanies.map((c) => ({
        companyId: c.id,
        weight: 1,
      }));
      const dist = allocateCentsProportionally(entry.amountBrlCents, equalWeights);
      if (dist.size === 0) {
        unallocatedPlatformOverheadCents += entry.amountBrlCents;
      } else {
        for (const [cid, cents] of dist.entries()) {
          const target = summaryByCompId.get(cid);
          if (target) target.allocatedPlatformCostCents += cents;
        }
      }
    } else if (entry.allocationRule === 'USAGE_UNITS') {
      const provMap = usageUnitsByProvider.get(entry.provider.toUpperCase());
      const unitWeights = provMap
        ? Array.from(provMap.entries()).map(([companyId, weight]) => ({
            companyId,
            weight,
          }))
        : [];
      const dist = allocateCentsProportionally(entry.amountBrlCents, unitWeights);
      if (dist.size === 0) {
        unallocatedPlatformOverheadCents += entry.amountBrlCents;
      } else {
        for (const [cid, cents] of dist.entries()) {
          const target = summaryByCompId.get(cid);
          if (target) target.allocatedPlatformCostCents += cents;
        }
      }
    } else {
      unallocatedPlatformOverheadCents += entry.amountBrlCents;
    }
  }

  // Somar telemetria não substituída de APIs à categoria APIS
  byCategoryPlatformCents.APIS =
    (byCategoryPlatformCents.APIS || 0) +
    telemetryMeasuredPlatformCents +
    telemetryEstimatedPlatformCents;

  const totalMeasuredPlatformCents =
    entryMeasuredPlatformCents + telemetryMeasuredPlatformCents;
  const totalManualVerifiedPlatformCents = entryManualPlatformCents;
  const totalEstimatedPlatformCents =
    entryEstimatedPlatformCents + telemetryEstimatedPlatformCents;

  const verifiedRealPlatformCostsCents =
    totalMeasuredPlatformCents + totalManualVerifiedPlatformCents;
  const totalPlatformCostsWithEstimatesCents =
    verifiedRealPlatformCostsCents + totalEstimatedPlatformCents;

  const totalContractedRevenueCents =
    closedContractedRevenueCents + openPreviewContractedRevenueCents;

  // Margem Real (Receita Recebida da Competência − Custos Verificados Medidos/Manuais)
  const realMarginCents =
    statementReceivedRevenueCents - verifiedRealPlatformCostsCents;

  // Margem Estimada de Competência (Receita Contratada Total − Custos Totais c/ Estimativas)
  const estimatedMarginCents =
    totalContractedRevenueCents - totalPlatformCostsWithEstimatesCents;

  // Referência de isolamento: despesas operacionais internas das empresas clientes (tabela Cost) NUNCA entram nesta conta
  const clientOperationalCostsAgg = await dbClient.cost.aggregate({
    where: {
      date: {
        gte: startDate,
        lt: endDate,
      },
    },
    _count: { id: true },
    _sum: { amount: true },
  });

  return {
    competence: params.competence,
    startDate,
    endDate,
    separationGuarantee: {
      clientOperationalCostsExcludedFromPlatformLedger: true,
      clientOperationalCostsCountIgnored: clientOperationalCostsAgg._count.id || 0,
      clientOperationalCostsBrlIgnored: Number(
        (clientOperationalCostsAgg._sum.amount || 0).toFixed(2)
      ),
      sandboxAndSimulationExcluded: !params.includeSimulation,
      excludedSandboxUsageRecordsCount: excludedSandboxUsageCount,
      antiDoubleCountingActive: true,
      supersededTelemetryRecordsCount,
      supersededTelemetryCentsAvoided,
    },
    providerBillingCapabilities: PROVIDER_BILLING_CAPABILITIES,
    revenues: {
      closedContractedRevenueCents,
      closedContractedRevenueBrl: centsToBrlNumber(closedContractedRevenueCents),
      openPreviewContractedRevenueCents,
      openPreviewContractedRevenueBrl: centsToBrlNumber(openPreviewContractedRevenueCents),
      totalContractedRevenueCents,
      totalContractedRevenueBrl: centsToBrlNumber(totalContractedRevenueCents),
      statementReceivedRevenueCents,
      statementReceivedRevenueBrl: centsToBrlNumber(statementReceivedRevenueCents),
      cashReceivedInPeriodCents,
      cashReceivedInPeriodBrl: centsToBrlNumber(cashReceivedInPeriodCents),
    },
    platformCosts: {
      measuredBrlCents: totalMeasuredPlatformCents,
      measuredBrl: centsToBrlNumber(totalMeasuredPlatformCents),
      manualVerifiedBrlCents: totalManualVerifiedPlatformCents,
      manualVerifiedBrl: centsToBrlNumber(totalManualVerifiedPlatformCents),
      estimatedBrlCents: totalEstimatedPlatformCents,
      estimatedBrl: centsToBrlNumber(totalEstimatedPlatformCents),
      verifiedRealCostsBrlCents: verifiedRealPlatformCostsCents,
      verifiedRealCostsBrl: centsToBrlNumber(verifiedRealPlatformCostsCents),
      totalWithEstimatesBrlCents: totalPlatformCostsWithEstimatesCents,
      totalWithEstimatesBrl: centsToBrlNumber(totalPlatformCostsWithEstimatesCents),
      unallocatedPlatformOverheadCents,
      unallocatedPlatformOverheadBrl: centsToBrlNumber(unallocatedPlatformOverheadCents),
      byCategoryBrlCents: byCategoryPlatformCents,
    },
    companyDirectPaidCostsSeparated: {
      totalBrlCents: entryCompanyPaidCents + telemetryCompanyPaidCents,
      totalBrl: centsToBrlNumber(entryCompanyPaidCents + telemetryCompanyPaidCents),
      note: 'Custos pagos diretamente pelas empresas clientes (ex.: chaves próprias ou tarifas da conta própria da empresa) não reduzem a margem da plataforma Lumora.',
    },
    margins: {
      realMarginCents,
      realMarginBrl: centsToBrlNumber(realMarginCents),
      realMarginFormula:
        'statementReceivedRevenueCents - (measuredBrlCents + manualVerifiedBrlCents)',
      estimatedMarginCents,
      estimatedMarginBrl: centsToBrlNumber(estimatedMarginCents),
      estimatedMarginFormula:
        'totalContractedRevenueCents - (measuredBrlCents + manualVerifiedBrlCents + estimatedBrlCents)',
    },
    companyBreakdown: companyRevenueSummary.map((c) => ({
      ...c,
      eligibleSalesBaseBrl: centsToBrlNumber(c.eligibleSalesBaseCents),
      contractedRevenueBrl: centsToBrlNumber(c.contractedRevenueCents),
      receivedRevenueBrl: centsToBrlNumber(c.receivedRevenueCents),
      allocatedPlatformCostBrl: centsToBrlNumber(c.allocatedPlatformCostCents),
      companyEstimatedContributionMarginCents:
        c.contractedRevenueCents - c.allocatedPlatformCostCents,
      companyEstimatedContributionMarginBrl: centsToBrlNumber(
        c.contractedRevenueCents - c.allocatedPlatformCostCents
      ),
    })),
    entries: costEntries.map((e) => ({
      id: e.id,
      companyId: e.companyId,
      companyName: e.company?.name || null,
      competence: e.competence,
      category: e.category,
      provider: e.provider,
      measurementType: e.measurementType,
      sourceDocument: e.sourceDocument,
      currency: e.currency,
      originalAmountCents: e.originalAmountCents,
      exchangeRateMilli: e.exchangeRateMilli,
      amountBrlCents: e.amountBrlCents,
      amountBrl: centsToBrlNumber(e.amountBrlCents),
      costPayer: e.costPayer,
      allocationRule: e.allocationRule,
      replacesTelemetryUsage: e.replacesTelemetryUsage,
      notes: e.notes,
      createdByName: e.createdByName,
      createdAt: e.createdAt,
    })),
  };
}

