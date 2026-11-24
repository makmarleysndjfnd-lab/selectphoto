import { prisma } from './prisma';

export type TrackedApiProvider = 'GEMINI' | 'ASAAS';
export type TrackedApiStatus = 'SUCCESS' | 'ERROR' | 'RATE_LIMITED';

export function getCurrentYearMonthBrt(date: Date = new Date()): string {
  // Horário de Brasília (-03:00)
  const brt = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  const year = brt.getUTCFullYear();
  const month = String(brt.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function normalizeYearMonth(raw?: string | null): string {
  if (typeof raw === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw.trim())) {
    return raw.trim();
  }
  return getCurrentYearMonthBrt();
}

export async function recordCompanyApiUsageLog(params: {
  companyId?: string | null;
  provider: TrackedApiProvider;
  operation: string;
  status: TrackedApiStatus;
  promptTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  httpStatus?: number | null;
  createdAt?: Date;
}): Promise<void> {
  try {
    if (!params.companyId || !params.companyId.trim()) return;
    const timestamp = params.createdAt || new Date();
    const yearMonth = getCurrentYearMonthBrt(timestamp);

    const promptTokens = Math.max(0, Math.trunc(Number(params.promptTokens || 0)));
    const outputTokens = Math.max(0, Math.trunc(Number(params.outputTokens || 0)));
    const computedTotal = promptTokens + outputTokens;
    const totalTokens = Math.max(
      0,
      Math.trunc(Number(params.totalTokens ?? computedTotal))
    );

    await prisma.apiUsageLog.create({
      data: {
        companyId: params.companyId.trim(),
        provider: params.provider,
        operation: String(params.operation || 'UNKNOWN').slice(0, 80),
        yearMonth,
        status: params.status,
        promptTokens,
        outputTokens,
        totalTokens,
        httpStatus:
          typeof params.httpStatus === 'number' && Number.isFinite(params.httpStatus)
            ? Math.trunc(params.httpStatus)
            : null,
        createdAt: timestamp,
      },
    });
  } catch (err) {
    // Non-blocking by design: falha ao gravar telemetria de uso jamais interrompe fluxo principal
    console.warn('[ApiUsageService] Falha não bloqueante ao gravar ApiUsageLog:', (err as any)?.message || err);
  }
}

export interface ProviderUsageSummary {
  provider: TrackedApiProvider;
  label: string;
  usedCalls: number;
  limitCalls: number;
  usagePercent: number;
  successCalls: number;
  errorCalls: number;
  rateLimitedCalls: number;
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastUsedAt: string | null;
  byOperation: Array<{
    operation: string;
    totalCalls: number;
    successCalls: number;
    errorCalls: number;
    rateLimitedCalls: number;
    totalTokens: number;
  }>;
}

export async function getCompanyMonthlyApiUsageSummary(
  companyId: string,
  requestedYearMonth?: string | null
) {
  const yearMonth = normalizeYearMonth(requestedYearMonth);
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      tradeName: true,
      geminiMonthlyLimitCalls: true,
      asaasMonthlyLimitCalls: true,
    },
  });

  if (!company) {
    const err: any = new Error('Empresa não encontrada.');
    err.status = 404;
    throw err;
  }

  const logs = await prisma.apiUsageLog.findMany({
    where: {
      companyId,
      yearMonth,
    },
    orderBy: { createdAt: 'desc' },
  });

  const buildProviderSummary = (
    provider: TrackedApiProvider,
    label: string,
    limitCalls: number
  ): ProviderUsageSummary => {
    const filtered = logs.filter((l) => l.provider === provider);
    const usedCalls = filtered.length;
    const safeLimit = Math.max(1, limitCalls || (provider === 'GEMINI' ? 200 : 500));
    const usagePercent = Number(((usedCalls / safeLimit) * 100).toFixed(1));

    let successCalls = 0;
    let errorCalls = 0;
    let rateLimitedCalls = 0;
    let promptTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;

    const opMap = new Map<
      string,
      {
        operation: string;
        totalCalls: number;
        successCalls: number;
        errorCalls: number;
        rateLimitedCalls: number;
        totalTokens: number;
      }
    >();

    for (const row of filtered) {
      if (row.status === 'SUCCESS') successCalls += 1;
      else if (row.status === 'RATE_LIMITED') rateLimitedCalls += 1;
      else errorCalls += 1;

      promptTokens += row.promptTokens || 0;
      outputTokens += row.outputTokens || 0;
      totalTokens += row.totalTokens || 0;

      const existingOp = opMap.get(row.operation) || {
        operation: row.operation,
        totalCalls: 0,
        successCalls: 0,
        errorCalls: 0,
        rateLimitedCalls: 0,
        totalTokens: 0,
      };
      existingOp.totalCalls += 1;
      if (row.status === 'SUCCESS') existingOp.successCalls += 1;
      else if (row.status === 'RATE_LIMITED') existingOp.rateLimitedCalls += 1;
      else existingOp.errorCalls += 1;
      existingOp.totalTokens += row.totalTokens || 0;
      opMap.set(row.operation, existingOp);
    }

    const lastUsedAt = filtered.length > 0 ? filtered[0].createdAt.toISOString() : null;

    return {
      provider,
      label,
      usedCalls,
      limitCalls: safeLimit,
      usagePercent,
      successCalls,
      errorCalls,
      rateLimitedCalls,
      promptTokens,
      outputTokens,
      totalTokens,
      lastUsedAt,
      byOperation: Array.from(opMap.values()).sort((a, b) => b.totalCalls - a.totalCalls),
    };
  };

  const geminiSummary = buildProviderSummary(
    'GEMINI',
    'Google Gemini (Eventos IA)',
    company.geminiMonthlyLimitCalls ?? 200
  );
  const asaasSummary = buildProviderSummary(
    'ASAAS',
    'Asaas / Serasa',
    company.asaasMonthlyLimitCalls ?? 500
  );

  return {
    companyId: company.id,
    companyName: company.tradeName || company.name,
    yearMonth,
    geminiMonthlyLimitCalls: geminiSummary.limitCalls,
    asaasMonthlyLimitCalls: asaasSummary.limitCalls,
    providers: {
      GEMINI: geminiSummary,
      ASAAS: asaasSummary,
    },
    gemini: geminiSummary,
    asaas: asaasSummary,
  };
}

export async function updateCompanyApiUsageLimits(
  companyId: string,
  limits: {
    geminiMonthlyLimitCalls?: number;
    asaasMonthlyLimitCalls?: number;
  }
) {
  const updateData: {
    geminiMonthlyLimitCalls?: number;
    asaasMonthlyLimitCalls?: number;
  } = {};

  if (limits.geminiMonthlyLimitCalls !== undefined) {
    const val = Math.trunc(Number(limits.geminiMonthlyLimitCalls));
    if (!Number.isFinite(val) || val < 1 || val > 1000000) {
      const err: any = new Error('geminiMonthlyLimitCalls deve ser um inteiro entre 1 e 1.000.000.');
      err.status = 400;
      throw err;
    }
    updateData.geminiMonthlyLimitCalls = val;
  }

  if (limits.asaasMonthlyLimitCalls !== undefined) {
    const val = Math.trunc(Number(limits.asaasMonthlyLimitCalls));
    if (!Number.isFinite(val) || val < 1 || val > 1000000) {
      const err: any = new Error('asaasMonthlyLimitCalls deve ser um inteiro entre 1 e 1.000.000.');
      err.status = 400;
      throw err;
    }
    updateData.asaasMonthlyLimitCalls = val;
  }

  if (Object.keys(updateData).length === 0) {
    const err: any = new Error('Informe ao menos uma meta mensal válida (geminiMonthlyLimitCalls ou asaasMonthlyLimitCalls).');
    err.status = 400;
    throw err;
  }

  const updated = await prisma.company.update({
    where: { id: companyId },
    data: updateData,
    select: {
      id: true,
      name: true,
      tradeName: true,
      geminiMonthlyLimitCalls: true,
      asaasMonthlyLimitCalls: true,
    },
  });

  return updated;
}
