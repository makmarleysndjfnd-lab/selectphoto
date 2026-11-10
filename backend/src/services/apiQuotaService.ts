import { prisma } from './prisma';
import { getEffectiveOperationCostCents, formatPricingSource, findEffectiveTariff } from './integrationResolver';
import { convertOriginalToBrlCents } from './platformCostsService';

export interface QuotaAlertNotification {
  id: string;
  companyId: string;
  integrationId?: string | null;
  category: string;
  environment: string;
  periodKey: string; // "YYYY-MM"
  limitType: 'UNITS' | 'BUDGET';
  threshold: 80 | 100;
  currentValue: number;
  limitValue: number;
  currency: string;
  message: string;
  channel: string;
  timestamp: Date;
}

// Canal simulado em memória para testes e auditoria de alertas
const simulatedAlerts: QuotaAlertNotification[] = [];

export function getSimulatedAlerts(): QuotaAlertNotification[] {
  return [...simulatedAlerts];
}

export function clearSimulatedAlerts(): void {
  simulatedAlerts.length = 0;
}

export function getPeriodKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function formatCurrencyAmount(cents: number, currency: string = 'BRL'): string {
  const val = (cents / 100).toFixed(2);
  switch ((currency || 'BRL').toUpperCase()) {
    case 'USD':
      return `US$ ${val}`;
    case 'EUR':
      return `€ ${val}`;
    case 'BRL':
    default:
      return `R$ ${val.replace('.', ',')}`;
  }
}

/**
 * Converte centavos entre moedas com precisão exata e arredondamento padrão.
 * Retorna se a conversão foi confirmada ou se não há paridade cambial válida cadastrada.
 */
export function convertCurrencyCents(
  amountCents: number,
  fromCurrency: string,
  toCurrency: string,
  exchangeRateMilli?: number | null
): { convertedCents: number; confirmed: boolean } {
  const from = (fromCurrency || 'BRL').toUpperCase();
  const to = (toCurrency || 'BRL').toUpperCase();

  if (from === to) {
    return { convertedCents: amountCents, confirmed: true };
  }

  if (
    exchangeRateMilli === undefined ||
    exchangeRateMilli === null ||
    exchangeRateMilli <= 0
  ) {
    return { convertedCents: amountCents, confirmed: false };
  }

  if (from === 'USD' && to === 'BRL') {
    // 1 USD = (exchangeRateMilli / 1000) BRL
    const num = BigInt(amountCents) * BigInt(exchangeRateMilli);
    const converted = Number((num + 500n) / 1000n);
    return { convertedCents: converted, confirmed: true };
  }

  if (from === 'BRL' && to === 'USD') {
    // 1 BRL = 1000 / exchangeRateMilli USD
    const num = BigInt(amountCents) * 1000n;
    const rate = BigInt(exchangeRateMilli);
    const converted = Number((num + rate / 2n) / rate);
    return { convertedCents: converted, confirmed: true };
  }

  return { convertedCents: amountCents, confirmed: false };
}

/**
 * Base de cálculo financeira unificada para bloqueio, alertas e painel.
 * Exclui rigorosamente registros cancelados e operações de cache.
 * Converte para a moeda do orçamento usando a taxa de câmbio confirmada.
 */
export function calculateRecordsSpentInBudgetCurrency(
  records: Array<{
    operation: string;
    status: string;
    estimatedCostCents?: number | null;
    measuredCostCents?: number | null;
    currency?: string | null;
  }>,
  budgetCurrency: string = 'BRL',
  exchangeRateMilli?: number | null
): {
  totalSpentInBudgetCurrency: number;
  unconvertedSpentByCurrency: Record<string, number>;
  unconvertedRecordsCount: number;
  conversionConfirmed: boolean;
  hasUnconvertedRecords: boolean;
} {
  let totalSpent = 0;
  let hasUnconvertedRecords = false;
  let unconvertedRecordsCount = 0;
  const unconvertedSpentByCurrency: Record<string, number> = {};

  for (const r of records) {
    if (r.status === 'CANCELLED') continue;
    if (r.operation.endsWith('_CACHE')) continue;

    const cost = getEffectiveOperationCostCents(r);
    const recCurrency = (r.currency || 'BRL').toUpperCase();
    const targetCurrency = (budgetCurrency || 'BRL').toUpperCase();

    if (recCurrency === targetCurrency) {
      totalSpent += cost;
    } else {
      const conv = convertCurrencyCents(cost, recCurrency, targetCurrency, exchangeRateMilli);
      if (conv.confirmed) {
        totalSpent += conv.convertedCents;
      } else {
        // Regra de Segurança: Separa valores sem câmbio confirmado do total na moeda do orçamento
        hasUnconvertedRecords = true;
        unconvertedRecordsCount++;
        unconvertedSpentByCurrency[recCurrency] = (unconvertedSpentByCurrency[recCurrency] || 0) + cost;
      }
    }
  }

  return {
    totalSpentInBudgetCurrency: totalSpent,
    unconvertedSpentByCurrency,
    unconvertedRecordsCount,
    conversionConfirmed: !hasUnconvertedRecords,
    hasUnconvertedRecords,
  };
}

/**
 * Dispara alertas aos 80% e aos 100%, rigorosamente UMA vez por limite e por período.
 * Protegido contra duplicidades via chave única em banco e canal simulado.
 */
export async function triggerQuotaAlertsIfNeeded(params: {
  companyId: string;
  integrationId?: string | null;
  category: string;
  environment: string;
  periodKey: string;
  limitType: 'UNITS' | 'BUDGET';
  currentValue: number;
  limitValue: number;
  currency?: string;
}): Promise<void> {
  const { companyId, integrationId, category, environment, periodKey, limitType, currentValue, limitValue } = params;
  const currency = params.currency || 'BRL';

  if (limitValue <= 0) return;

  const percent = (currentValue / limitValue) * 100;
  const thresholdsToCheck: (80 | 100)[] = [];

  if (percent >= 100) {
    thresholdsToCheck.push(80, 100);
  } else if (percent >= 80) {
    thresholdsToCheck.push(80);
  }

  for (const threshold of thresholdsToCheck) {
    // 1. Verificação prévia para evitar violação de unicidade e log de erro desnecessário
    try {
      const existing = await prisma.apiQuotaAlert.findUnique({
        where: {
          companyId_category_environment_periodKey_limitType_threshold: {
            companyId,
            category,
            environment,
            periodKey,
            limitType,
            threshold,
          },
        },
      });
      if (existing) continue;
    } catch (_) {
      // Ignora erro de leitura e prossegue para tentativa de criação segura
    }

    let alertMessage = '';
    if (limitType === 'UNITS') {
      alertMessage =
        threshold === 100
          ? `Alerta 100%: Limite mensal de requisições de ${category} (${environment}) atingido (${currentValue} de ${limitValue} un.).`
          : `Alerta 80%: Consumo de ${category} (${environment}) atingiu ${Math.round(percent)}% da cota mensal (${currentValue} de ${limitValue} un.).`;
    } else {
      alertMessage =
        threshold === 100
          ? `Alerta 100%: Orçamento financeiro mensal de ${category} (${environment}) atingido (${formatCurrencyAmount(currentValue, currency)} de ${formatCurrencyAmount(limitValue, currency)}).`
          : `Alerta 80%: Consumo financeiro de ${category} (${environment}) atingiu ${Math.round(percent)}% do teto (${formatCurrencyAmount(currentValue, currency)} de ${formatCurrencyAmount(limitValue, currency)}).`;
    }

    try {
      const created = await prisma.apiQuotaAlert.create({
        data: {
          companyId,
          integrationId: integrationId || null,
          category,
          environment,
          periodKey,
          limitType,
          threshold,
          currentValue,
          limitValue,
          currency,
          message: alertMessage,
          channel: 'SIMULATED_CHANNEL',
        },
      });

      simulatedAlerts.push({
        id: created.id,
        companyId,
        integrationId: integrationId || null,
        category,
        environment,
        periodKey,
        limitType,
        threshold,
        currentValue,
        limitValue,
        currency,
        message: alertMessage,
        channel: 'SIMULATED_CHANNEL',
        timestamp: created.createdAt,
      });

      console.log(`[API-QUOTA-ALERT] ${alertMessage}`);
    } catch (err: any) {
      // P2002: Violação de unicidade (já foi alertado neste período para este limite e threshold)
      if (err.code !== 'P2002') {
        console.error('[API-QUOTA-ALERT] Falha ao registrar alerta de cota:', err);
      }
    }
  }
}

export interface QuotaReservationParams {
  companyId: string;
  category: string;
  provider: string;
  environment?: string;
  integrationId?: string;
  operation: string;
  unitsRequested?: number;
  estimatedCostCents?: number;
  date?: Date;
}

export interface QuotaReservationResult {
  allowed: boolean;
  reservationId?: string;
  limitType?: 'UNITS' | 'BUDGET';
  message?: string;
  currentUnits?: number;
  unitsLimit?: number | null;
  currentSpentCents?: number;
  budgetLimitCents?: number | null;
  currency?: string;
}

/**
 * Reserva a cota de forma atômica no banco de dados ANTES de chamar o provedor externo.
 * Garante que duas buscas simultâneas respeitem o mesmo teto sem corrida (race condition).
 * Exclui rigorosamente registros desvinculados (sem vínculo seguro) do cálculo do limite.
 */
export async function reserveApiQuota(params: QuotaReservationParams): Promise<QuotaReservationResult> {
  const {
    companyId,
    category,
    provider,
    environment = 'PRODUCTION',
    integrationId,
    operation,
    unitsRequested = 1,
    estimatedCostCents = 0,
    date = new Date(),
  } = params;

  const periodKey = getPeriodKey(date);
  const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);

  return await prisma.$transaction(async (tx): Promise<QuotaReservationResult> => {
    // 1. Localiza a integração da empresa
    let integration = null;
    if (integrationId) {
      integration = await tx.companyIntegration.findUnique({
        where: { id: integrationId },
      });
    } else {
      integration = await tx.companyIntegration.findFirst({
        where: {
          companyId,
          category,
          environment,
          status: 'ACTIVE',
        },
      });
      if (!integration) {
        integration = await tx.companyIntegration.findFirst({
          where: {
            companyId,
            category,
            status: 'ACTIVE',
          },
        });
      }
    }

    // 2. Lock pessimista em nível de linha para serializar concorrência estrita na empresa/integração
    if (integration) {
      await tx.$executeRawUnsafe(
        'SELECT id FROM "CompanyIntegration" WHERE id = $1 FOR UPDATE;',
        integration.id
      );
    } else {
      await tx.$executeRawUnsafe(
        'SELECT id FROM "Company" WHERE id = $1 FOR UPDATE;',
        companyId
      );
    }

    const unitsLimit = integration?.monthlyUnitsLimit ?? null;
    const budgetLimitCents = integration?.monthlyBudgetLimitCents ?? null;

    // Bloqueio imediato se limite configurado for 0
    if (unitsLimit === 0) {
      return {
        allowed: false,
        limitType: 'UNITS',
        message: 'Limite mensal de requisições atingido (0 de 0 consumidas no período).',
        currentUnits: 0,
        unitsLimit: 0,
      };
    }
    if (budgetLimitCents === 0) {
      return {
        allowed: false,
        limitType: 'BUDGET',
        message: 'Orçamento mensal financeiro atingido (R$ 0,00 de R$ 0,00 consumidos no período).',
        currentSpentCents: 0,
        budgetLimitCents: 0,
      };
    }

    // 3. Localiza as tarifas cadastradas e seleciona a tarifa válida para a empresa, integração, ambiente e data da operação
    const companyTariffs = await tx.companyApiTariff.findMany({
      where: {
        companyId,
        category,
        provider,
      },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });

    const activeTariff = findEffectiveTariff(companyTariffs, {
      category,
      provider,
      environment,
      companyIntegrationId: integration?.id,
      operationDate: date,
    });

    const budgetCurrency = ((integration?.configMetadata as any)?.currency || 'BRL').toUpperCase();
    const exchangeRateMilli =
      (integration?.configMetadata as any)?.exchangeRateMilli ??
      (activeTariff as any)?.exchangeRateMilli ??
      null;

    // Regra: Para chamadas pagas com orçamento ativo, só autorize a reserva quando houver preço aplicável
    // e valores na mesma moeda ou conversão confirmada. Quando faltar um desses dados, informe o motivo no app.
    if (budgetLimitCents !== null && budgetLimitCents !== undefined && budgetLimitCents > 0) {
      if (!activeTariff) {
        return {
          allowed: false,
          limitType: 'BUDGET',
          message:
            'Tarifa aplicável não cadastrada para validar o orçamento ativo da integração. Cadastre uma tarifa confirmada na Central de Integrações antes de realizar chamadas pagas.',
          currentSpentCents: 0,
          budgetLimitCents,
          currency: budgetCurrency,
        };
      }
    }

    // 4. Calcula consumo acumulado no período ATUAL (apenas chamadas externas que consumiram ou estão retendo cota)
    // REGRA MANDATÓRIA: Registros sem vínculo seguro (integrationId: null) são estritamente EXCLUÍDOS do saldo do limite.
    // Consultas atendidas por CACHE interno não consomem a cota/limite de chamadas do provedor externo.
    // Status PENDING_CONFIRMATION (ex: timeout após envio) retém cota para prevenir estouros.
    const activeRecords = await tx.apiUsageRecord.findMany({
      where: {
        companyId,
        category,
        environment,
        timestamp: { gte: startOfMonth },
        integrationId: integration ? integration.id : { not: null },
        status: { in: ['SUCCESS', 'RESERVED', 'PENDING_CONFIRMATION'] },
        NOT: { operation: { endsWith: '_CACHE' } },
      },
      select: {
        operation: true,
        unitsUsed: true,
        estimatedCostCents: true,
        measuredCostCents: true,
        currency: true,
        status: true,
      },
    });

    const currentUnits = activeRecords.reduce((acc, r) => acc + (r.unitsUsed || 1), 0);

    // 5. Cálculo da tarifa aplicada para a operação
    const includedUnits = activeTariff ? activeTariff.includedUnits : 0;
    const overageUnitPriceCents = activeTariff ? activeTariff.overageUnitPriceCents : 0;
    const tariffCurrency = (activeTariff?.currency || 'BRL').toUpperCase();

    let operationCostCents = 0;
    if (activeTariff) {
      if (currentUnits + unitsRequested <= includedUnits) {
        // Totalmente coberto pela franquia incluída
        operationCostCents = 0;
      } else if (currentUnits >= includedUnits) {
        // Totalmente em excedente tarifado
        operationCostCents = unitsRequested * overageUnitPriceCents;
      } else {
        // Parcialmente em franquia, excedente apenas na fatia que supera
        const overageUnitsPortion = (currentUnits + unitsRequested) - includedUnits;
        operationCostCents = overageUnitsPortion * overageUnitPriceCents;
      }
    } else {
      operationCostCents = params.estimatedCostCents || 0;
    }

    const isPaidCall = operationCostCents > 0 || (currentUnits + unitsRequested > includedUnits);

    // Validação de preço e moeda para chamadas pagas com orçamento ativo
    if (budgetLimitCents !== null && budgetLimitCents !== undefined && budgetLimitCents > 0) {
      if (isPaidCall) {
        if (activeTariff && (activeTariff.overageUnitPriceCents === null || activeTariff.overageUnitPriceCents === undefined)) {
          return {
            allowed: false,
            limitType: 'BUDGET',
            message:
              'Preço unitário aplicável não informado na tarifa cadastrada para validação orçamentária.',
            currentSpentCents: 0,
            budgetLimitCents,
            currency: budgetCurrency,
          };
        }

        if (tariffCurrency !== budgetCurrency) {
          const conv = convertCurrencyCents(operationCostCents, tariffCurrency, budgetCurrency, exchangeRateMilli);
          if (!conv.confirmed) {
            return {
              allowed: false,
              limitType: 'BUDGET',
              message: `Moeda da tarifa (${tariffCurrency}) difere da moeda do orçamento (${budgetCurrency}) sem taxa de conversão confirmada. Configure a taxa de conversão cambial na Central para autorizar a operação.`,
              currentSpentCents: 0,
              budgetLimitCents,
              currency: budgetCurrency,
            };
          }
        }
      }
    }

    // 6. Permite excedente pago SOMENTE com autorização explícita e dentro do teto configurado
    const isRequestingOverage = activeTariff && (currentUnits + unitsRequested > includedUnits);
    if (isRequestingOverage) {
      const isOverageAuthorized = Boolean(
        integration?.allowPaidOverage ||
        (integration?.configMetadata as any)?.allowPaidOverage
      );

      if (!isOverageAuthorized) {
        return {
          allowed: false,
          limitType: 'UNITS',
          message: `Excedente pago não autorizado para esta integração. Franquia de ${includedUnits} un. esgotada. Habilite a autorização de excedente na Central de Integrações.`,
          currentUnits,
          unitsLimit: includedUnits,
        };
      }

      // Se autorizado, valida teto específico de excedente autorizado
      const authorizedOverageUnits =
        integration?.authorizedOverageUnits ??
        (integration?.configMetadata as any)?.authorizedOverageUnits ??
        null;

      if (authorizedOverageUnits !== null) {
        const currentOverageUnits = Math.max(0, currentUnits - includedUnits);
        if (currentOverageUnits + unitsRequested > authorizedOverageUnits) {
          return {
            allowed: false,
            limitType: 'UNITS',
            message: `Limite de excedente autorizado atingido (${currentOverageUnits} de ${authorizedOverageUnits} un. excedentes consumidas no período).`,
            currentUnits,
            unitsLimit: includedUnits + authorizedOverageUnits,
          };
        }
      }
    }

    // 7. Verificação de Limite de Unidades Geral da Integração
    if (unitsLimit !== null && unitsLimit !== undefined) {
      if (currentUnits + unitsRequested > unitsLimit) {
        return {
          allowed: false,
          limitType: 'UNITS',
          message: `Limite mensal de requisições atingido (${currentUnits} de ${unitsLimit} consumidas no período).`,
          currentUnits,
          unitsLimit,
        };
      }
    }

    // 8. Verificação de Limite Financeiro (Orçamento) usando a mesma base unificada de cálculo
    let currentSpentCentsInBudgetCurrency = 0;
    if (budgetLimitCents !== null && budgetLimitCents !== undefined) {
      const usageCalc = calculateRecordsSpentInBudgetCurrency(
        activeRecords,
        budgetCurrency,
        exchangeRateMilli
      );
      currentSpentCentsInBudgetCurrency = usageCalc.totalSpentInBudgetCurrency;

      // Regra de Segurança: Enquanto houver consumo anterior sem conversão necessária para verificar o teto, bloqueia novas chamadas pagas
      if (isPaidCall && usageCalc.hasUnconvertedRecords) {
        return {
          allowed: false,
          limitType: 'BUDGET',
          message: `Existem registros de consumo anteriores em moeda estrangeira pendentes de taxa de conversão confirmada para apuração do teto orçamentário. Defina a taxa de câmbio na Central de Integrações antes de autorizar novas operações pagas.`,
          currentSpentCents: currentSpentCentsInBudgetCurrency,
          budgetLimitCents,
          currency: budgetCurrency,
        };
      }

      const opConv = convertCurrencyCents(
        operationCostCents,
        tariffCurrency,
        budgetCurrency,
        exchangeRateMilli
      );
      const opCostInBudgetCurrency = opConv.convertedCents;

      const remainingBudgetCents = budgetLimitCents - currentSpentCentsInBudgetCurrency;

      // Se a tarifa da operação estiver acima do saldo restante:
      if (currentSpentCentsInBudgetCurrency + opCostInBudgetCurrency > budgetLimitCents) {
        return {
          allowed: false,
          limitType: 'BUDGET',
          message: `Orçamento mensal financeiro insuficiente para a tarifa da operação (${formatCurrencyAmount(opCostInBudgetCurrency, budgetCurrency)} necessários, ${formatCurrencyAmount(Math.max(0, remainingBudgetCents), budgetCurrency)} de saldo restante de um teto de ${formatCurrencyAmount(budgetLimitCents, budgetCurrency)}).`,
          currentSpentCents: currentSpentCentsInBudgetCurrency,
          budgetLimitCents,
          currency: budgetCurrency,
        };
      }
    }

    // 9. Reserva atômica gravada em status RESERVED preservando a tarifa aplicada no histórico
    const reservation = await tx.apiUsageRecord.create({
      data: {
        companyId,
        integrationId: integration?.id || null,
        tariffId: activeTariff?.id || null,
        category,
        provider,
        environment,
        operation,
        unitsUsed: unitsRequested,
        estimatedCostCents: operationCostCents,
        measuredCostCents: null,
        appliedTariffUnitPriceCents: activeTariff?.overageUnitPriceCents || null,
        currency: tariffCurrency,
        status: 'RESERVED',
        timestamp: date,
      },
    });

    const newUnitsTotal = currentUnits + unitsRequested;

    return {
      allowed: true,
      reservationId: reservation.id,
      currentUnits: newUnitsTotal,
      unitsLimit,
      currentSpentCents: currentSpentCentsInBudgetCurrency + operationCostCents,
      budgetLimitCents,
      currency: tariffCurrency,
    };
  }, { timeout: 15000 });
}

/**
 * Dispara alertas de consumo confirmado após confirmação com sucesso da chamada externa.
 */
export async function triggerConfirmedQuotaAlertsForRecord(record: {
  companyId: string;
  integrationId?: string | null;
  category: string;
  environment: string;
  timestamp: Date;
  currency?: string | null;
}): Promise<void> {
  try {
    const date = record.timestamp || new Date();
    const periodKey = getPeriodKey(date);
    const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);

    let integration = null;
    if (record.integrationId) {
      integration = await prisma.companyIntegration.findUnique({
        where: { id: record.integrationId },
      });
    }

    const unitsLimit = integration?.monthlyUnitsLimit ?? null;
    const budgetLimitCents = integration?.monthlyBudgetLimitCents ?? null;

    if (!unitsLimit && !budgetLimitCents) return;

    // Busca apenas consumo CONFIRMADO (SUCCESS) no período corrente
    const confirmedRecords = await prisma.apiUsageRecord.findMany({
      where: {
        companyId: record.companyId,
        category: record.category,
        environment: record.environment,
        timestamp: { gte: startOfMonth },
        integrationId: record.integrationId ? record.integrationId : { not: null },
        status: 'SUCCESS',
        NOT: { operation: { endsWith: '_CACHE' } },
      },
      select: {
        operation: true,
        status: true,
        unitsUsed: true,
        estimatedCostCents: true,
        measuredCostCents: true,
        currency: true,
      },
    });

    const budgetCurrency = ((integration?.configMetadata as any)?.currency || 'BRL').toUpperCase();
    const exchangeRateMilli = (integration?.configMetadata as any)?.exchangeRateMilli ?? null;

    const confirmedUnits = confirmedRecords.reduce((acc, r) => acc + (r.unitsUsed || 1), 0);
    const { totalSpentInBudgetCurrency } = calculateRecordsSpentInBudgetCurrency(
      confirmedRecords,
      budgetCurrency,
      exchangeRateMilli
    );
    const confirmedSpentCents = totalSpentInBudgetCurrency;

    if (unitsLimit !== null && unitsLimit > 0) {
      await triggerQuotaAlertsIfNeeded({
        companyId: record.companyId,
        integrationId: record.integrationId || null,
        category: record.category,
        environment: record.environment,
        periodKey,
        limitType: 'UNITS',
        currentValue: confirmedUnits,
        limitValue: unitsLimit,
      });
    }

    if (budgetLimitCents !== null && budgetLimitCents > 0) {
      await triggerQuotaAlertsIfNeeded({
        companyId: record.companyId,
        integrationId: record.integrationId || null,
        category: record.category,
        environment: record.environment,
        periodKey,
        limitType: 'BUDGET',
        currentValue: confirmedSpentCents,
        limitValue: budgetLimitCents,
        currency: budgetCurrency,
      });
    }
  } catch (err) {
    console.error('[API-QUOTA] Erro ao disparar alertas de consumo confirmado:', err);
  }
}

/**
 * Confirma a reserva com sucesso após a resposta do provedor externo.
 * Gera os alertas de consumo confirmado após a confirmação.
 */
export async function confirmApiReservation(
  reservationId: string,
  params?: {
    measuredCostCents?: number;
    latencyMs?: number;
    status?: 'SUCCESS' | 'FAILED';
    errorMessage?: string;
  }
): Promise<void> {
  try {
    const updated = await prisma.apiUsageRecord.update({
      where: { id: reservationId },
      data: {
        status: params?.status || 'SUCCESS',
        measuredCostCents: params?.measuredCostCents !== undefined ? params.measuredCostCents : undefined,
        latencyMs: params?.latencyMs !== undefined ? params.latencyMs : undefined,
        errorMessage: params?.errorMessage || null,
      },
    });

    if (updated.status === 'SUCCESS') {
      await triggerConfirmedQuotaAlertsForRecord(updated);
    }
  } catch (err) {
    console.error(`[API-QUOTA] Falha ao confirmar reserva ${reservationId}:`, err);
  }
}

export interface MarkPendingParams {
  latencyMs?: number;
  reason?: string;
  delayMs?: number;
}

/**
 * Grava o timeout de forma condicional, permitindo passar de RESERVED para PENDING_CONFIRMATION
 * apenas enquanto a reserva ainda estiver aberta (status: RESERVED).
 * Preserva qualquer estado final já gravado (SUCCESS ou CANCELLED) ou status já alterado.
 */
export async function markReservationPendingConfirmation(
  reservationId: string,
  params?: MarkPendingParams
): Promise<{ updated: boolean; currentStatus?: string }> {
  try {
    if (params?.delayMs && params.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, params.delayMs));
    }

    // Condicional estrita: apenas passa de RESERVED para PENDING_CONFIRMATION se a reserva ainda estiver aberta
    const result = await prisma.apiUsageRecord.updateMany({
      where: {
        id: reservationId,
        status: 'RESERVED',
      },
      data: {
        status: 'PENDING_CONFIRMATION',
        latencyMs: params?.latencyMs !== undefined ? params.latencyMs : undefined,
        errorMessage: params?.reason || 'TIMEOUT_AFTER_DISPATCH',
      },
    });

    if (result.count === 0) {
      const existing = await prisma.apiUsageRecord.findUnique({
        where: { id: reservationId },
        select: { status: true },
      });
      return { updated: false, currentStatus: existing?.status };
    }

    return { updated: true, currentStatus: 'PENDING_CONFIRMATION' };
  } catch (err) {
    console.error(`[API-QUOTA] Falha ao marcar reserva ${reservationId} como pendente de confirmação:`, err);
    return { updated: false };
  }
}

/**
 * Libera a reserva quando estiver comprovado que a operação não consumiu cota.
 * Condicional: apenas se a reserva ainda estiver aberta ou pendente (RESERVED ou PENDING_CONFIRMATION).
 * Preserva o estado SUCCESS caso o provedor já tenha confirmado.
 */
export async function releaseApiReservation(
  reservationId: string,
  params?: {
    reason?: string;
  }
): Promise<void> {
  try {
    await prisma.apiUsageRecord.updateMany({
      where: {
        id: reservationId,
        status: { in: ['RESERVED', 'PENDING_CONFIRMATION'] },
      },
      data: {
        status: 'CANCELLED',
        errorMessage: params?.reason || 'OPERATION_FAILED_NO_QUOTA_CONSUMED',
      },
    });
  } catch (err) {
    console.error(`[API-QUOTA] Falha ao liberar reserva ${reservationId}:`, err);
  }
}

export interface HandleLateProviderResponseParams {
  reservationId: string;
  outcome?: 'CONFIRMED' | 'UNCERTAIN' | 'RELEASED';
  measuredCostCents?: number;
  reason?: string;
  resolvedByUserId?: string;
  resolvedByName?: string;
  delayMs?: number;
}

/**
 * Rotina unificada de confirmação tardia para Scout e Radar.
 * Liga a resposta tardia do provedor à confirmação automática da reserva:
 * - Em caso de 'CONFIRMED': resolve atômica e transacionalmente via resolvePendingReservation.
 * - Em caso de 'UNCERTAIN': mantém em PENDING_CONFIRMATION para revisão.
 * - Em caso de 'RELEASED': libera a reserva registrando auditoria.
 * O estado final é SUCCESS (ou CANCELLED), com uma única confirmação e auditoria, sem chamada administrativa.
 */
export async function handleLateProviderResponse(
  params: HandleLateProviderResponseParams
): Promise<{ success: boolean; status?: string; idempotent?: boolean }> {
  const {
    reservationId,
    outcome = 'CONFIRMED',
    measuredCostCents,
    reason = 'LATE_PROVIDER_RESPONSE_AUTO_CONFIRMED',
    resolvedByUserId = 'SYSTEM_LATE_RESPONSE',
    resolvedByName = 'Provedor Simulado (Retorno Tardio Automático)',
    delayMs = 0,
  } = params;

  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (outcome === 'UNCERTAIN') {
    console.warn(
      `[API-QUOTA] Resposta tardia com consumo incerto para reserva ${reservationId}. Mantendo PENDING_CONFIRMATION para revisão.`
    );
    return { success: true, status: 'PENDING_CONFIRMATION' };
  }

  try {
    const result = await resolvePendingReservation({
      reservationId,
      outcome: outcome === 'RELEASED' ? 'RELEASED' : 'CONFIRMED',
      measuredCostCents: outcome === 'CONFIRMED' ? measuredCostCents : undefined,
      reason,
      resolvedByUserId,
      resolvedByName,
    });

    return {
      success: true,
      status: result.newStatus,
      idempotent: result.idempotent,
    };
  } catch (err: any) {
    console.error(`[API-QUOTA] Erro na rotina unificada de retorno tardio para ${reservationId}:`, err?.message || err);
    return { success: false };
  }
}

export class ApiQuotaResolutionError extends Error {
  statusCode: number;
  code: string;
  constructor(message: string, statusCode: number = 400, code: string = 'RESOLUTION_ERROR') {
    super(message);
    this.name = 'ApiQuotaResolutionError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface ResolvePendingReservationParams {
  reservationId: string;
  outcome: 'CONFIRMED' | 'RELEASED';
  measuredCostCents?: number;
  evidence?: string;
  reason?: string;
  resolvedByUserId?: string;
  resolvedByName?: string;
  simulateAuditFailure?: boolean;
}

/**
 * Trata resposta tardia para resolver reservas com status pendente (PENDING_CONFIRMATION ou RESERVED).
 * Regras de Segurança e Concorrência:
 * 1. Decisão e gravação de auditoria executadas atomicamente na MESMA transação.
 * 2. Lock pessimista (FOR UPDATE) garante que duas decisões simultâneas tenham um único resultado.
 * 3. Permite alterar apenas reservas pendentes.
 * 4. Preserva rigorosamente os estados finais (SUCCESS e CANCELLED).
 * 5. Repetições da mesma decisão são idempotentes (200 OK sem duplicar efeitos).
 * 6. Decisão contrária ao estado final recebe 409 Conflict.
 * 7. Falha na gravação da auditoria reverte a alteração da reserva (rollback transacional completo).
 */
export async function resolvePendingReservation(
  params: ResolvePendingReservationParams
): Promise<{
  success: boolean;
  reservation: any;
  previousStatus: string;
  newStatus: string;
  message: string;
  idempotent?: boolean;
}> {
  const {
    reservationId,
    outcome,
    measuredCostCents,
    evidence,
    reason,
    resolvedByUserId,
    resolvedByName,
    simulateAuditFailure,
  } = params;

  let recordForAlerts: any = null;

  const result = await prisma.$transaction(
    async (tx) => {
      // 1. Lock pessimista FOR UPDATE na linha da reserva para concorrência estrita
      const lockedRows = await tx.$queryRawUnsafe<any[]>(
        `SELECT id, status, "companyId", "integrationId", "estimatedCostCents", "measuredCostCents", "errorMessage", "resolvedByUserId", "evidence", "category", "environment", "timestamp"
         FROM "ApiUsageRecord"
         WHERE id = $1
         FOR UPDATE`,
        reservationId
      );

      if (!lockedRows || lockedRows.length === 0) {
        throw new ApiQuotaResolutionError(`Reserva ${reservationId} não encontrada.`, 404, 'NOT_FOUND');
      }

      const existing = lockedRows[0];
      const previousStatus = existing.status;

      // 2. Trata repetições da mesma decisão sem duplicar efeitos (Idempotência)
      if (previousStatus === 'SUCCESS' && outcome === 'CONFIRMED') {
        return {
          success: true,
          reservation: existing,
          previousStatus,
          newStatus: 'SUCCESS',
          message: 'Reserva já se encontra confirmada.',
          idempotent: true,
        };
      }

      if (previousStatus === 'CANCELLED' && outcome === 'RELEASED') {
        return {
          success: true,
          reservation: existing,
          previousStatus,
          newStatus: 'CANCELLED',
          message: 'Reserva já se encontra cancelada/liberada.',
          idempotent: true,
        };
      }

      // 3. Preserva os estados finais: Bloqueia tentativa de reverter consumo já confirmado ou confirmar cancelamento
      if (previousStatus === 'SUCCESS' && outcome === 'RELEASED') {
        throw new ApiQuotaResolutionError(
          'Não é permitido cancelar ou reverter um consumo já confirmado pelo provedor.',
          409,
          'FINAL_STATE_PRESERVED'
        );
      }

      if (previousStatus === 'CANCELLED' && outcome === 'CONFIRMED') {
        throw new ApiQuotaResolutionError(
          'Não é permitido confirmar uma reserva que já foi cancelada/liberada.',
          409,
          'FINAL_STATE_PRESERVED'
        );
      }

      // 4. Permite alterar apenas reservas pendentes (PENDING_CONFIRMATION ou RESERVED)
      if (previousStatus !== 'PENDING_CONFIRMATION' && previousStatus !== 'RESERVED') {
        throw new ApiQuotaResolutionError(
          `Apenas reservas com status pendente (PENDING_CONFIRMATION ou RESERVED) podem ser alteradas. Status atual: ${previousStatus}.`,
          400,
          'NOT_PENDING'
        );
      }

      const recordedEvidence = evidence || reason || (outcome === 'CONFIRMED' ? 'LATE_RESPONSE_CONFIRMED' : '');

      if (outcome === 'CONFIRMED') {
        const updated = await tx.apiUsageRecord.update({
          where: { id: reservationId },
          data: {
            status: 'SUCCESS',
            measuredCostCents: measuredCostCents !== undefined ? measuredCostCents : existing.measuredCostCents,
            resolvedByUserId: resolvedByUserId || null,
            evidence: recordedEvidence,
            errorMessage: reason || existing.errorMessage || 'LATE_RESPONSE_CONFIRMED',
          },
        });

        // Teste de falha na gravação da auditoria: força abort da transação se solicitado
        if (simulateAuditFailure || (evidence && evidence.includes('SIMULATE_AUDIT_FAILURE'))) {
          throw new Error('SIMULATED_AUDIT_WRITE_FAILURE');
        }

        if (existing.integrationId) {
          let auditAuthorId = resolvedByUserId;
          if (!auditAuthorId || auditAuthorId.startsWith('SYSTEM')) {
            const fallbackUser = await tx.user.findFirst({
              where: {
                OR: [
                  { id: resolvedByUserId || '' },
                  { companyId: existing.companyId },
                ],
              },
              select: { id: true },
            });
            auditAuthorId = fallbackUser?.id || undefined;
          }

          if (auditAuthorId) {
            await tx.integrationAuditEvent.create({
              data: {
                companyId: existing.companyId,
                integrationId: existing.integrationId,
                action: 'RESERVATION_CONFIRMED',
                authorUserId: auditAuthorId,
                authorName: resolvedByName || 'Administrador',
                details: JSON.stringify({
                  reservationId,
                  outcome: 'CONFIRMED',
                  previousStatus,
                  measuredCostCents: measuredCostCents !== undefined ? measuredCostCents : (existing.measuredCostCents ?? null),
                  estimatedCostCents: existing.estimatedCostCents,
                  reason: recordedEvidence,
                  systemAuthor: resolvedByUserId || null,
                }),
                result: 'SUCCESS',
              },
            });
          }
        }

        recordForAlerts = updated;

        return {
          success: true,
          reservation: updated,
          previousStatus,
          newStatus: 'SUCCESS',
          message: 'Consumo confirmado após resposta tardia do provedor.',
        };
      } else {
        // outcome === 'RELEASED'
        if (!evidence && !reason) {
          throw new ApiQuotaResolutionError(
            'Evidência ou justificativa comprobatória é obrigatória para liberar cota retida.',
            400,
            'MISSING_EVIDENCE'
          );
        }

        const updated = await tx.apiUsageRecord.update({
          where: { id: reservationId },
          data: {
            status: 'CANCELLED',
            resolvedByUserId: resolvedByUserId || null,
            evidence: recordedEvidence,
            errorMessage: `RELEASED_WITH_EVIDENCE: ${recordedEvidence}`,
          },
        });

        // Teste de falha na gravação da auditoria: força abort da transação se solicitado
        if (simulateAuditFailure || (evidence && evidence.includes('SIMULATE_AUDIT_FAILURE'))) {
          throw new Error('SIMULATED_AUDIT_WRITE_FAILURE');
        }

        if (existing.integrationId) {
          let auditAuthorId = resolvedByUserId;
          if (!auditAuthorId || auditAuthorId.startsWith('SYSTEM')) {
            const fallbackUser = await tx.user.findFirst({
              where: {
                OR: [
                  { id: resolvedByUserId || '' },
                  { companyId: existing.companyId },
                ],
              },
              select: { id: true },
            });
            auditAuthorId = fallbackUser?.id || undefined;
          }

          if (auditAuthorId) {
            await tx.integrationAuditEvent.create({
              data: {
                companyId: existing.companyId,
                integrationId: existing.integrationId,
                action: 'RESERVATION_RELEASED',
                authorUserId: auditAuthorId,
                authorName: resolvedByName || 'Administrador',
                details: JSON.stringify({
                  reservationId,
                  outcome: 'RELEASED',
                  previousStatus,
                  evidence: recordedEvidence,
                  systemAuthor: resolvedByUserId || null,
                }),
                result: 'SUCCESS',
              },
            });
          }
        }

        return {
          success: true,
          reservation: updated,
          previousStatus,
          newStatus: 'CANCELLED',
          message: 'Reserva liberada após comprovação de não consumo pelo provedor.',
        };
      }
    },
    { timeout: 15000 }
  );

  if (recordForAlerts && !result.idempotent) {
    try {
      await triggerConfirmedQuotaAlertsForRecord(recordForAlerts);
    } catch (alertErr) {
      console.error('[API-QUOTA] Erro ao disparar alertas pós-resolução:', alertErr);
    }
  }

  return result;
}

