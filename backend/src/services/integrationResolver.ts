import { CompanyIntegration, CompanyApiTariff } from '@prisma/client';
import { prisma } from './prisma';
import {
  decryptSecret,
  isAllowedEnvVarReference,
  isAllowedEnvVarForIntegration,
} from './vaultService';
import { formatCurrencyAmount, calculateRecordsSpentInBudgetCurrency } from './apiQuotaService';



export interface ResolvedIntegration {
  integration: CompanyIntegration | null;
  secret: string | null;
  isShared: boolean;
  provider: string;
  scope: string;
  status: string;
  environment: string;
}

// Cache em memória para consulta de CEP com expiração (TTL: 24h)
const cepCache = new Map<string, { data: any; expiresAt: number }>();

export function clearCepCache(cep?: string): void {
  if (cep) {
    const cleanCep = (cep || '').replace(/\D/g, '');
    cepCache.delete(cleanCep);
  } else {
    cepCache.clear();
  }
}

/**
 * Resolve em tempo de execução a credencial e configuração de uma integração para uma empresa.
 * Segue estritamente as regras de isolamento:
 * - Bancos/Asaas e WhatsApp: NUNCA compartilham silenciosamente nem fazem fallback para outra empresa ou para a conta geral.
 * - IA de Pesquisa: Usa chave exclusiva da empresa se configurada; fallback para pool compartilhado APENAS se explicitamente
 *   autorizado/contratado pela empresa (ex: flag em configMetadata ou contrato da empresa). Sem autorização, retorna DISABLED.
 * - CEP: Compartilhado da plataforma com cache em memória e rate limiting.
 */
export async function resolveCompanyIntegration(
  companyId: string,
  category: string,
  environment: string = 'PRODUCTION'
): Promise<ResolvedIntegration> {
  // 1. Busca integração cadastrada para a empresa
  const config = await prisma.companyIntegration.findUnique({
    where: {
      companyId_category_environment: {
        companyId,
        category,
        environment,
      },
    },
  });

  // Se a empresa possui cadastro e ele NÃO está ativo (ex: DISABLED, REVOKED, TESTING),
  // INTERROMPE IMEDIATAMENTE. Proibido qualquer fallback ou compartilhamento!
  if (config && config.status !== 'ACTIVE') {
    return {
      integration: config,
      secret: null,
      isShared: false,
      provider: config.provider,
      scope: config.scope,
      status: config.status,
      environment: config.environment,
    };
  }

  if (config && config.status === 'ACTIVE') {
    let resolvedSecret: string | null = null;

    if (config.credentialSource === 'VAULT_ENCRYPTED') {
      if (config.encryptedSecret && config.secretIv && config.secretTag) {
        try {
          resolvedSecret = decryptSecret(
            config.encryptedSecret,
            config.secretIv,
            config.secretTag
          );
        } catch (decryptErr) {
          console.error(
            `[IntegrationResolver] Erro ao descriptografar segredo para empresa ${companyId}, cat ${category}:`,
            decryptErr
          );
          resolvedSecret = null;
        }
      }
    } else if (config.credentialSource === 'ENV_REFERENCE' && config.envVarName) {
      const checkEnv = isAllowedEnvVarForIntegration({
        varName: config.envVarName,
        category,
        provider: config.provider,
        environment: config.environment,
      });

      const hasRequiredAccountBinding =
        (config.scope !== 'COMPANY_EXCLUSIVE' && config.scope !== 'EXCLUSIVE_OWN_KEY') ||
        Boolean(config.accountName && config.accountName.trim());

      if (checkEnv.allowed && hasRequiredAccountBinding) {
        resolvedSecret = process.env[config.envVarName] || null;
      } else {
        console.error(
          `[IntegrationResolver] Referência de env '${config.envVarName}' inválida/sem vínculo para empresa ${companyId} (${checkEnv.reason || 'accountName ausente'}).`
        );
        resolvedSecret = null;
      }
    }

    // Se possui chave exclusiva válida, retorna
    if (resolvedSecret) {
      return {
        integration: config,
        secret: resolvedSecret,
        isShared: false,
        provider: config.provider,
        scope: config.scope,
        status: config.status,
        environment: config.environment,
      };
    }

    // Se é PLATFORM_SHARED ativo para AI_RESEARCH com contratação explícita gravada
    if (
      category === 'AI_RESEARCH' &&
      config.scope === 'PLATFORM_SHARED' &&
      (config.configMetadata as any)?.allowSharedPool === true
    ) {
      const globalKey =
        config.provider === 'GROK'
          ? process.env.GROK_API_KEY || null
          : process.env.GEMINI_API_KEY || null;

      return {
        integration: config,
        secret: globalKey,
        isShared: true,
        provider: config.provider,
        scope: 'PLATFORM_SHARED',
        status: globalKey ? 'ACTIVE' : 'DISABLED',
        environment,
      };
    }

    // Possui cadastro ACTIVE mas sem segredo decifrável ou sem compartilhamento contratado
    return {
      integration: config,
      secret: null,
      isShared: false,
      provider: config.provider,
      scope: config.scope,
      status: 'DISABLED',
      environment: config.environment,
    };
  }

  // 2. Tratamento para gateways bancários e WhatsApp: Proibido fallback silencioso!
  if (category === 'PAYMENT_GATEWAY' || category === 'MESSAGING') {
    return {
      integration: null,
      secret: null,
      isShared: false,
      provider: category === 'PAYMENT_GATEWAY' ? 'ASAAS' : 'META_WHATSAPP',
      scope: 'COMPANY_EXCLUSIVE',
      status: 'DISABLED',
      environment,
    };
  }

  // 3. Para IA de Pesquisa (AI_RESEARCH):
  // Sem cadastro ativo prévio com contratação explícita de compartilhamento, NUNCA usa chave global!
  if (category === 'AI_RESEARCH') {
    return {
      integration: null,
      secret: null,
      isShared: false,
      provider: 'GEMINI',
      scope: 'EXCLUSIVE_OWN_KEY',
      status: 'DISABLED',
      environment,
    };
  }

  // 4. Para GEO_LOCATION / ViaCEP: Compartilhado da plataforma
  if (category === 'GEO_LOCATION') {
    return {
      integration: null,
      secret: null,
      isShared: true,
      provider: 'VIACEP',
      scope: 'PLATFORM_SHARED',
      status: 'ACTIVE',
      environment,
    };
  }

  return {
    integration: null,
    secret: null,
    isShared: false,
    provider: 'UNKNOWN',
    scope: 'EXCLUSIVE_OWN_KEY',
    status: 'DISABLED',
    environment,
  };
}

export function getEffectiveOperationCostCents(record: {
  measuredCostCents?: number | null;
  estimatedCostCents?: number | null;
}): number {
  if (record.measuredCostCents !== null && record.measuredCostCents !== undefined) {
    return record.measuredCostCents;
  }
  return record.estimatedCostCents ?? 0;
}

export function formatPricingSource(source: string): string {
  switch (source) {
    case 'TABELA_OFICIAL':
      return 'Tabela Oficial do Provedor';
    case 'CONTRATO_CUSTOMIZADO':
      return 'Contrato Customizado';
    case 'TABELA_GOOGLE_AI':
      return 'Tabela Oficial Google Cloud';
    case 'TABELA_ASAAS':
      return 'Tabela Homologada Asaas';
    case 'MANUAL':
      return 'Preço Negociado Manualmente';
    default:
      return source || 'Tabela Padrão';
  }
}

export function formatDateBr(date: Date | string | null): string {
  if (!date) return '-';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Seleciona a tarifa vigente na data da operação, respeitando:
 * 1. Vigência cronológica: effectiveFrom <= operationDate e (effectiveTo is null ou effectiveTo > operationDate)
 *    Tarifas futuras em outra moeda são estritamente descartadas até a data de vigência.
 * 2. Preferência da tarifa específica do ambiente (ex: PRODUCTION ou SANDBOX) sobre a geral (ALL).
 * 3. Preferência de vínculo específico a uma companyIntegrationId sobre vínculo genérico.
 * 4. Preservação estrita da moeda original (BRL, USD, EUR, etc.).
 */
export function findEffectiveTariff(
  tariffs: CompanyApiTariff[],
  criteria: {
    category: string;
    provider: string;
    environment: string;
    companyIntegrationId?: string | null;
    operationDate?: Date;
  }
): CompanyApiTariff | null {
  const targetDate = criteria.operationDate || new Date();
  const targetTime = targetDate.getTime();

  const validTariffs = tariffs.filter((t) => {
    if (t.category !== criteria.category || t.provider !== criteria.provider) {
      return false;
    }
    const fromTime = new Date(t.effectiveFrom).getTime();
    if (fromTime > targetTime) {
      return false; // Tarifa futura (ainda não em vigor)
    }
    if (t.effectiveTo) {
      const toTime = new Date(t.effectiveTo).getTime();
      if (toTime <= targetTime) {
        return false; // Tarifa encerrada
      }
    }
    return true;
  });

  if (validTariffs.length === 0) return null;

  // Pontuação de precedência
  const scored = validTariffs.map((t) => {
    let score = 0;
    if (criteria.companyIntegrationId && t.companyIntegrationId === criteria.companyIntegrationId) {
      score += 100;
    }
    if (t.environment === criteria.environment) {
      score += 10;
    } else if (t.environment === 'ALL') {
      score += 1;
    } else {
      return { tariff: t, score: -1 }; // Mismatch de ambiente específico
    }
    return { tariff: t, score };
  });

  const matching = scored.filter((s) => s.score > 0);
  if (matching.length === 0) return null;

  matching.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(b.tariff.effectiveFrom).getTime() - new Date(a.tariff.effectiveFrom).getTime();
  });

  return matching[0].tariff;
}

/**
 * Registra o consumo de API no histórico de uso sem gravar dados pessoais dos prompts.
 * Distingue estimativa de custo de referência de custo medido pelo provedor.
 * Mantém isolamento estrito por ambiente (PRODUCTION vs SANDBOX).
 */
export async function recordApiUsage(params: {
  companyId: string;
  integrationId?: string;
  category: string;
  provider: string;
  environment?: string;
  operation: string;
  unitsUsed?: number;
  estimatedCostCents?: number;
  measuredCostCents?: number;
  status?: string;
  latencyMs?: number;
  errorMessage?: string;
}) {
  try {
    let effectiveEnvironment = params.environment;
    if (!effectiveEnvironment && params.integrationId) {
      const parent = await prisma.companyIntegration.findUnique({
        where: { id: params.integrationId },
        select: { environment: true },
      });
      effectiveEnvironment = parent?.environment;
    }

    return await prisma.apiUsageRecord.create({
      data: {
        companyId: params.companyId,
        integrationId: params.integrationId || null,
        category: params.category,
        provider: params.provider,
        environment: effectiveEnvironment || 'PRODUCTION',
        operation: params.operation,
        unitsUsed: params.unitsUsed ?? 1,
        estimatedCostCents: params.estimatedCostCents ?? null,
        measuredCostCents: params.measuredCostCents ?? null,
        status: params.status || 'SUCCESS',
        latencyMs: params.latencyMs ?? null,
        errorMessage: params.errorMessage ? params.errorMessage.slice(0, 500) : null,
      },
    });
  } catch (err) {
    console.error('[IntegrationResolver] Falha ao registrar uso de API:', err);
    return null;
  }
}

/**
 * Verifica se a empresa atingiu o orçamento mensal interno de API.
 * Regra inequívoca para limites:
 * - limitCents === 0: Bloqueado imediatamente (orçamento zero = proibido/sem crédito).
 * - limitCents === null | undefined: Ilimitado (sem teto configurado).
 * - limitCents > 0: Bloqueia quando o gasto acumulado no mês corrente atinge ou supera o teto.
 */
export async function checkCompanyApiBudget(
  companyId: string,
  category: string,
  environment?: string
): Promise<{ withinBudget: boolean; currentSpentCents: number; limitCents: number | null }> {
  const candidates = await prisma.companyIntegration.findMany({
    where: {
      companyId,
      category,
      ...(environment ? { environment } : {}),
    },
  });

  const integration =
    candidates.find((c) => c.status === 'ACTIVE') ||
    candidates.find((c) => c.status !== 'REVOKED') ||
    null;

  const limitCents =
    integration && integration.monthlyBudgetLimitCents !== null && integration.monthlyBudgetLimitCents !== undefined
      ? integration.monthlyBudgetLimitCents
      : null;

  // Limite zero explícito = bloqueio total imediato
  if (limitCents === 0) {
    return { withinBudget: false, currentSpentCents: 0, limitCents: 0 };
  }

  // Limite ausente (null) = irrestrito
  if (limitCents === null) {
    return { withinBudget: true, currentSpentCents: 0, limitCents: null };
  }

  // Calcula início do mês corrente
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // REGRA MANDATÓRIA: Registros sem vínculo seguro (integrationId: null) são estritamente EXCLUÍDOS do saldo do limite!
  const budgetCurrency = ((integration?.configMetadata as any)?.currency || 'BRL').toUpperCase();
  const exchangeRateMilli = (integration?.configMetadata as any)?.exchangeRateMilli ?? null;

  const usageRecords = await prisma.apiUsageRecord.findMany({
    where: {
      companyId,
      category,
      ...(environment ? { environment } : {}),
      timestamp: { gte: startOfMonth },
      integrationId: integration ? integration.id : { not: null },
      status: { in: ['SUCCESS', 'RESERVED', 'PENDING_CONFIRMATION'] },
      NOT: { operation: { endsWith: '_CACHE' } },
    },
    select: {
      operation: true,
      status: true,
      estimatedCostCents: true,
      measuredCostCents: true,
      currency: true,
    },
  });

  const usageCalc = calculateRecordsSpentInBudgetCurrency(
    usageRecords,
    budgetCurrency,
    exchangeRateMilli
  );
  const totalSpent = usageCalc.totalSpentInBudgetCurrency;

  return {
    withinBudget: totalSpent < limitCents,
    currentSpentCents: totalSpent,
    limitCents,
  };
}

/**
 * Consulta de CEP via ViaCEP com cache em memória de 24 horas, sanitização e timeout de 5 segundos.
 * Diferencia consultas atendidas por CACHE de chamadas EXTERNAS e reporta tempo de resposta.
 */
export async function lookupViaCep(rawCep: string): Promise<{
  success: boolean;
  data?: any;
  error?: string;
  cached?: boolean;
  source?: 'CACHE' | 'EXTERNAL';
  responseTimeMs?: number;
}> {
  const startTime = Date.now();
  const cleanCep = (rawCep || '').replace(/\D/g, '');
  if (cleanCep.length !== 8) {
    return {
      success: false,
      error: 'CEP deve conter exatamente 8 dígitos.',
      responseTimeMs: Date.now() - startTime,
    };
  }

  const now = Date.now();
  const cached = cepCache.get(cleanCep);
  if (cached && cached.expiresAt > now) {
    return {
      success: true,
      data: cached.data,
      cached: true,
      source: 'CACHE',
      responseTimeMs: Date.now() - startTime,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`, {
      method: 'GET',
      headers: { 'User-Agent': 'LumoraPlatform/2.0 (contato@lumora.com.br)' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        error: `ViaCEP respondeu com status ${response.status}`,
        responseTimeMs: Date.now() - startTime,
      };
    }

    const data = await response.json();
    if (data.erro) {
      return {
        success: false,
        error: 'CEP não encontrado na base dos Correios.',
        responseTimeMs: Date.now() - startTime,
      };
    }

    // Armazena no cache por 24 horas
    cepCache.set(cleanCep, {
      data,
      expiresAt: now + 24 * 60 * 60 * 1000,
    });

    return {
      success: true,
      data,
      cached: false,
      source: 'EXTERNAL',
      responseTimeMs: Date.now() - startTime,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return {
        success: false,
        error: 'Tempo limite esgotado ao consultar o CEP (timeout 5s).',
        responseTimeMs: Date.now() - startTime,
      };
    }
    return {
      success: false,
      error: `Falha na requisição ao ViaCEP: ${err.message}`,
      responseTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Retorna as integrações da empresa enriquecidas com métricas de consumo, situação real
 * de operação comprovada, limites e separação entre limite Lumora e cota do provedor.
 */
export async function getCompanyEnrichedIntegrations(companyId: string) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthNames = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];
  const period = `${monthNames[now.getMonth()]}/${now.getFullYear()}`;

  // 1. Busca integrações cadastradas da empresa
  const integrations = await prisma.companyIntegration.findMany({
    where: { companyId },
    orderBy: [{ category: 'asc' }, { environment: 'asc' }],
  });

  // 2. Registros de uso do mês corrente para esta empresa
  const monthRecords = await prisma.apiUsageRecord.findMany({
    where: {
      companyId,
      timestamp: { gte: startOfMonth },
    },
  });

  // 3. Sucessos históricos para saber se já houve operação comprovada
  const historicalSuccesses = await prisma.apiUsageRecord.findMany({
    where: {
      companyId,
      status: 'SUCCESS',
    },
    select: {
      category: true,
      provider: true,
      environment: true,
      integrationId: true,
    },
  });

  // 4. Tarifas cadastradas para esta empresa (todas as versões para apuração por vigência)
  const allCompanyTariffs = await prisma.companyApiTariff.findMany({
    where: {
      companyId,
    },
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
  });

  // Verifica se a empresa tem webhooks Asaas processados com sucesso
  const asaasWebhooksCount = await prisma.asaasWebhookEvent.count({
    where: {
      companyId,
      processed: true,
    },
  });

  // Helper para enriquecer cada integração cadastrada
  const enrichedIntegrations = integrations.map((i) => {
    // Isolamento estrito por integração e por ambiente (PRODUCTION vs SANDBOX)
    // Registros sem vínculo seguro (integrationId: null) são estritamente separados
    // Registros cancelados são estritamente excluídos da base de cálculo de consumo e orçamento
    const records = monthRecords.filter((r) => {
      if (r.integrationId) {
        return r.integrationId === i.id && r.status !== 'CANCELLED';
      }
      return false;
    });

    const externalRecords = records.filter((r) => !r.operation.endsWith('_CACHE'));
    const cachedRecords = records.filter((r) => r.operation.endsWith('_CACHE'));

    const externalUnitsUsed = externalRecords.reduce((sum, r) => sum + (r.unitsUsed || 1), 0);
    const cachedUnitsUsed = cachedRecords.reduce((sum, r) => sum + (r.unitsUsed || 1), 0);
    const unitsUsed = externalUnitsUsed + cachedUnitsUsed;
    const estimatedCostCents = records.reduce((sum, r) => sum + (r.estimatedCostCents || 0), 0);
    const measuredCostCents = records.reduce((sum, r) => sum + (r.measuredCostCents || 0), 0);

    const budgetCurrency = ((i.configMetadata as any)?.currency || 'BRL').toUpperCase();
    const exchangeRateMilli = (i.configMetadata as any)?.exchangeRateMilli ?? null;

    // Regra: Usa a mesma base unificada de cálculo financeiro no bloqueio, alertas e painel
    const usageCalc = calculateRecordsSpentInBudgetCurrency(
      records,
      budgetCurrency,
      exchangeRateMilli
    );
    const totalSpentCents = usageCalc.totalSpentInBudgetCurrency;

    const hasOperationalProof =
      historicalSuccesses.some((h) => {
        if (h.integrationId) return h.integrationId === i.id;
        return false;
      }) || (i.provider === 'ASAAS' && i.environment === 'PRODUCTION' && asaasWebhooksCount > 0);

    let serviceStatusLevel: 'OPERATIONAL' | 'TESTED' | 'CONFIGURED' | 'NOT_CONFIGURED' | 'FAILED' | 'DISABLED';
    let serviceStatusLabel: string;
    let serviceStatusDescription: string;

    if (i.status === 'DISABLED' || i.status === 'REVOKED') {
      serviceStatusLevel = 'DISABLED';
      serviceStatusLabel = 'Desativado';
      serviceStatusDescription = 'Integração desativada administrativamente.';
    } else if (i.lastValidationStatus === 'FAILED') {
      serviceStatusLevel = 'FAILED';
      serviceStatusLabel = 'Falha na validação';
      serviceStatusDescription = i.lastValidationError || 'O último teste de conectividade falhou.';
    } else if (hasOperationalProof) {
      serviceStatusLevel = 'OPERATIONAL';
      serviceStatusLabel = 'Operação comprovada';
      serviceStatusDescription = 'Serviço ativo com operações reais processadas e comprovadas.';
    } else if (i.lastValidationStatus === 'SUCCESS') {
      serviceStatusLevel = 'TESTED';
      serviceStatusLabel = 'Conexão testada';
      serviceStatusDescription = 'Credencial testada com sucesso junto ao provedor. Aguardando primeira operação real.';
    } else if (i.credentialSource !== 'NONE' && (i.encryptedSecret || i.envVarName)) {
      serviceStatusLevel = 'CONFIGURED';
      serviceStatusLabel = 'Configuração cadastrada';
      serviceStatusDescription = 'Chave cadastrada no cofre seguro. Conexão ainda não testada.';
    } else {
      serviceStatusLevel = 'NOT_CONFIGURED';
      serviceStatusLabel = 'Não configurado';
      serviceStatusDescription = 'Credencial ausente ou incompleta.';
    }

    // Limites de unidades do Lumora
    const unitsLimit = i.monthlyUnitsLimit;
    const hasUnitsLimit = unitsLimit !== null && unitsLimit !== undefined;
    const unitsPercent = hasUnitsLimit
      ? (unitsLimit === 0 ? 100 : Math.min(100, Math.round((unitsUsed / unitsLimit) * 100)))
      : null;
    const unitsLimitLabel = hasUnitsLimit
      ? (unitsLimit === 0 ? '0 un. (Bloqueado)' : `${unitsLimit} un.`)
      : 'Sem limite configurado';

    // Orçamento do Lumora (calculado e formatado na moeda do orçamento)
    const costBudgetCents = i.monthlyBudgetLimitCents;
    const hasBudget = costBudgetCents !== null && costBudgetCents !== undefined;
    const costPercent = hasBudget
      ? (costBudgetCents === 0 ? 100 : Math.min(100, Math.round((totalSpentCents / costBudgetCents) * 100)))
      : null;
    const budgetLabel = hasBudget
      ? (costBudgetCents === 0
          ? `${formatCurrencyAmount(0, budgetCurrency)} (Bloqueado)`
          : formatCurrencyAmount(costBudgetCents, budgetCurrency))
      : 'Sem limite configurado';

    const isEstimatedCost = measuredCostCents === 0 && estimatedCostCents > 0;
    const costTypeLabel = measuredCostCents > 0
      ? 'Medido pelo provedor'
      : (estimatedCostCents > 0 ? 'Valores estimados (referência)' : 'Sem custo apurado');

    const lumoraLimitParts: string[] = [];
    if (hasUnitsLimit) lumoraLimitParts.push(`Limite: ${unitsLimitLabel}`);
    if (hasBudget) lumoraLimitParts.push(`Teto: ${budgetLabel}`);
    const lumoraLimitLabel = lumoraLimitParts.length > 0
      ? lumoraLimitParts.join(' • ')
      : 'Sem limite configurado';

    const providerQuota = (i.configMetadata as any)?.providerQuota || null;
    const providerQuotaLabel = providerQuota ? String(providerQuota) : 'Cota não informada pelo provedor';

    let missingNotice: string | null = null;
    if (usageCalc.hasUnconvertedRecords && hasBudget) {
      missingNotice = `Consumo anterior (${usageCalc.unconvertedRecordsCount} registro(s)) pendente de taxa de câmbio confirmada`;
    } else if (!hasUnitsLimit && !hasBudget) {
      missingNotice = 'Sem limite configurado';
    } else if (!hasUnitsLimit) {
      missingNotice = 'Sem limite de quantidade de requisições';
    } else if (!hasBudget) {
      missingNotice = 'Sem teto de orçamento em reais';
    }

    const hasMeasurement = records.length > 0;
    const consumptionStatusLabel = hasMeasurement ? 'Consumo medido no período' : 'Consumo ainda não medido';

    // ── Resolução da Tarifa Vigente (Data da Operação / Atual, Moeda Original, Prevalência de Ambiente) ──
    const activeTariff = findEffectiveTariff(allCompanyTariffs, {
      category: i.category,
      provider: i.provider,
      environment: i.environment,
      companyIntegrationId: i.id,
      operationDate: now,
    });

    const hasUnconfirmedTariffConversion = Boolean(
      hasBudget &&
        activeTariff &&
        (activeTariff.currency || 'BRL').toUpperCase() !== budgetCurrency &&
        (!exchangeRateMilli || exchangeRateMilli <= 0)
    );
    const isConversionConfirmed = usageCalc.conversionConfirmed && !hasUnconfirmedTariffConversion;

    let tariff: any;
    let usedIncludedUnits = 0;
    let remainingIncludedUnits = 0;
    let overageUnits = 0;
    let estimatedOverageCostCents: number | null = null;
    let overageCurrency = 'BRL';
    let overageCostStatusLabel = 'Custo ainda não pode ser calculado';

    const isOverageAuthorized = Boolean(
      i.allowPaidOverage || (i.configMetadata as any)?.allowPaidOverage
    );

    const authorizedOverageUnits =
      i.authorizedOverageUnits ??
      (i.configMetadata as any)?.authorizedOverageUnits ??
      (i.monthlyUnitsLimit && activeTariff
        ? Math.max(0, i.monthlyUnitsLimit - activeTariff.includedUnits)
        : null);

    const overageAuthorizedLabel = isOverageAuthorized
      ? (authorizedOverageUnits !== null ? `${authorizedOverageUnits} un. autorizadas` : 'Autorizado (conforme teto de orçamento)')
      : 'Não autorizado';

    if (activeTariff) {
      overageCurrency = activeTariff.currency || 'BRL';
      usedIncludedUnits = Math.min(externalUnitsUsed, activeTariff.includedUnits);
      remainingIncludedUnits = Math.max(0, activeTariff.includedUnits - externalUnitsUsed);
      overageUnits = Math.max(0, externalUnitsUsed - activeTariff.includedUnits);
      estimatedOverageCostCents = overageUnits * activeTariff.overageUnitPriceCents;

      const overageFormatted = formatCurrencyAmount(estimatedOverageCostCents, overageCurrency);
      overageCostStatusLabel =
        overageUnits > 0
          ? `Excedente: ${overageUnits} un. (${overageFormatted})`
          : 'Dentro da franquia incluída';

      tariff = {
        hasConfirmedTariff: true,
        tariffId: activeTariff.id,
        includedUnits: activeTariff.includedUnits,
        includedUnitsLabel:
          activeTariff.includedUnits > 0
            ? `${activeTariff.includedUnits} un./mês inclusas`
            : 'Sem franquia incluída',
        monthlyFeeCents: activeTariff.monthlyFeeCents,
        monthlyFeeLabel:
          activeTariff.monthlyFeeCents > 0
            ? `${formatCurrencyAmount(activeTariff.monthlyFeeCents, overageCurrency)}/mês`
            : 'Isento de mensalidade',
        overageUnitPriceCents: activeTariff.overageUnitPriceCents,
        overageUnitType: activeTariff.overageUnitType,
        overagePriceLabel:
          activeTariff.overageUnitPriceCents > 0
            ? `${formatCurrencyAmount(activeTariff.overageUnitPriceCents, overageCurrency)} por ${activeTariff.overageUnitType} excedente`
            : 'Sem custo de excedente',
        currency: overageCurrency,
        costPayer: activeTariff.costPayer,
        costPayerLabel:
          activeTariff.costPayer === 'COMPANY'
            ? 'Empresa'
            : activeTariff.costPayer === 'PLATFORM'
            ? 'Plataforma Lumora'
            : 'Compartilhado',
        pricingSource: activeTariff.pricingSource,
        pricingSourceLabel: formatPricingSource(activeTariff.pricingSource),
        effectiveFrom: activeTariff.effectiveFrom,
        effectiveTo: activeTariff.effectiveTo,
        effectivePeriodLabel: `Vigência: a partir de ${formatDateBr(activeTariff.effectiveFrom)}`,
        notes: activeTariff.notes,
        usedIncludedUnits,
        remainingIncludedUnits,
        overageUnits,
        overageUnitsUsed: overageUnits,
        isOverageAuthorized,
        authorizedOverageUnits,
        overageAuthorizedLabel,
        estimatedOverageCostCents,
        overageCostStatusLabel,
        conversionNotice:
          hasUnconfirmedTariffConversion
            ? `Moeda da tarifa (${activeTariff.currency}) difere da moeda do orçamento (${budgetCurrency}) sem taxa de conversão confirmada.`
            : (usageCalc.hasUnconvertedRecords
                ? `Existem ${usageCalc.unconvertedRecordsCount} registro(s) anterior(es) sem taxa de conversão confirmada. O valor acumulado reflete apenas montantes convertidos.`
                : null),
      };
    } else {
      tariff = {
        hasConfirmedTariff: false,
        statusLabel: 'Tarifa ainda não informada',
        notes: hasBudget
          ? 'Tarifa aplicável não cadastrada para validar o orçamento ativo da integração.'
          : 'Aguardando confirmação de tarifa pelo Super Admin.',
        missingPriceReason: hasBudget
          ? 'Tarifa aplicável não cadastrada para validar o orçamento ativo da integração.'
          : null,
        usedIncludedUnits: 0,
        remainingIncludedUnits: 0,
        overageUnits: 0,
        overageUnitsUsed: 0,
        isOverageAuthorized,
        authorizedOverageUnits,
        overageAuthorizedLabel,
        estimatedOverageCostCents: null,
        overageCostStatusLabel: 'Custo ainda não pode ser calculado',
      };
    }

    return {
      id: i.id,
      companyId: i.companyId,
      category: i.category,
      provider: i.provider,
      scope: i.scope,
      status: i.status,
      environment: i.environment,
      accountName: i.accountName,
      costPayer: i.costPayer,
      costPayerLabel: i.costPayer === 'COMPANY' ? 'Empresa' : (i.costPayer === 'PLATFORM' ? 'Plataforma' : 'Compartilhado'),
      changeApplicability: i.changeApplicability,
      credentialSource: i.credentialSource,
      secretMasked: i.secretMasked,
      configMetadata: i.configMetadata,
      version: i.version,
      monthlyBudgetLimitCents: i.monthlyBudgetLimitCents,
      monthlyUnitsLimit: i.monthlyUnitsLimit,
      lastValidatedAt: i.lastValidatedAt,
      lastValidationStatus: i.lastValidationStatus,
      lastValidationError: i.lastValidationError,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
      allowPaidOverage: i.allowPaidOverage ?? false,
      authorizedOverageUnits: i.authorizedOverageUnits ?? null,
      serviceStatusLevel,
      serviceStatusLabel,
      serviceStatusDescription,
      tariff,
      consumption: {
        period,
        periodStart: startOfMonth.toISOString(),
        unitsUsed,
        externalUnitsUsed,
        cachedUnitsUsed,
        usedIncludedUnits,
        remainingIncludedUnits,
        overageUnits,
        overageUnitsUsed: overageUnits,
        isOverageAuthorized,
        authorizedOverageUnits,
        overageAuthorizedLabel,
        estimatedOverageCostCents,
        overageCurrency,
        overageCostStatusLabel,
        unitsLimit,
        unitsPercent,
        unitsLimitLabel,
        hasUnitsLimit,
        costSpentCents: totalSpentCents,
        costSpentFormatted: formatCurrencyAmount(totalSpentCents, budgetCurrency),
        budgetCurrency,
        conversionConfirmed: isConversionConfirmed,
        hasUnconvertedRecords: usageCalc.hasUnconvertedRecords || hasUnconfirmedTariffConversion,
        unconvertedSpentByCurrency: usageCalc.unconvertedSpentByCurrency,
        unconvertedRecordsCount: usageCalc.unconvertedRecordsCount,
        costBudgetCents,
        costPercent,
        hasBudget,
        budgetLabel,
        isEstimatedCost,
        costTypeLabel,
        lumoraLimitLabel,
        providerQuotaLabel,
        hasMeasurement,
        consumptionStatusLabel,
        missingNotice,
      },
    };
  });

  // Registros antigos sem vínculo seguro (devem aparecer separados)
  const unlinkedRecords = monthRecords.filter((r) => {
    if (r.category === 'GEO_LOCATION' || r.provider === 'VIACEP') return false;
    if (r.integrationId) {
      return !integrations.some((i) => i.id === r.integrationId);
    }
    // Registros sem integrationId são por definição sem vínculo seguro
    return true;
  });

  const unlinkedUnitsUsed = unlinkedRecords.reduce((sum, r) => sum + (r.unitsUsed || 1), 0);
  const unlinkedTotalSpentCents = unlinkedRecords.reduce(
    (sum, r) => sum + getEffectiveOperationCostCents(r),
    0
  );

  const unlinkedUsage = {
    hasUnlinkedRecords: unlinkedRecords.length > 0,
    recordsCount: unlinkedRecords.length,
    unitsUsed: unlinkedUnitsUsed,
    totalSpentCents: unlinkedTotalSpentCents,
    totalSpentFormatted: `R$ ${(unlinkedTotalSpentCents / 100).toFixed(2).replace('.', ',')}`,
    label: 'Registros antigos sem vínculo seguro',
    description:
      'Operações registradas sem vínculo direto a uma credencial ativa configurada no cofre.',
  };

  // Enriquecer serviço compartilhado ViaCEP para a empresa
  const cepRecords = monthRecords.filter((r) => r.category === 'GEO_LOCATION' || r.provider === 'VIACEP');
  const cepExternalUnits = cepRecords.filter((r) => !r.operation.endsWith('_CACHE')).reduce((sum, r) => sum + (r.unitsUsed || 1), 0);
  const cepCachedUnits = cepRecords.filter((r) => r.operation.endsWith('_CACHE')).reduce((sum, r) => sum + (r.unitsUsed || 1), 0);
  const cepUnitsUsed = cepExternalUnits + cepCachedUnits;
  const hasCepHistoricalProof = historicalSuccesses.some((h) => h.category === 'GEO_LOCATION' || h.provider === 'VIACEP');

  const enrichedSharedServices = [
    {
      category: 'GEO_LOCATION',
      provider: 'VIACEP',
      label: 'Consulta de Endereço e CEP (ViaCEP)',
      type: 'PLATFORM_SHARED',
      environment: 'PRODUCTION',
      costPayer: 'PLATFORM',
      costPayerLabel: 'Plataforma',
      status: 'ACTIVE',
      notes: 'Serviço compartilhado fornecido pela plataforma Lumora; não requer chave própria.',
      serviceStatusLevel: hasCepHistoricalProof || cepUnitsUsed > 0 ? 'OPERATIONAL' : 'TESTED',
      serviceStatusLabel: hasCepHistoricalProof || cepUnitsUsed > 0 ? 'Operação comprovada' : 'Disponível (Compartilhado)',
      serviceStatusDescription: hasCepHistoricalProof || cepUnitsUsed > 0
        ? 'Consultas de CEP realizadas com sucesso no mês.'
        : 'Serviço de CEP ativo e pronto para consultas.',
      consumption: {
        period,
        periodStart: startOfMonth.toISOString(),
        unitsUsed: cepUnitsUsed,
        externalUnitsUsed: cepExternalUnits,
        cachedUnitsUsed: cepCachedUnits,
        usedIncludedUnits: 0,
        remainingIncludedUnits: 0,
        overageUnits: 0,
        estimatedOverageCostCents: 0,
        overageCurrency: 'BRL',
        overageCostStatusLabel: 'Incluso na plataforma',
        unitsLimit: null,
        unitsPercent: null,
        unitsLimitLabel: 'Ilimitado (Plataforma)',
        hasUnitsLimit: false,
        costSpentCents: 0,
        costBudgetCents: null,
        costPercent: null,
        hasBudget: false,
        budgetLabel: 'Gratuito (Incluso na plataforma)',
        isEstimatedCost: false,
        costTypeLabel: 'Serviço compartilhado gratuito',
        lumoraLimitLabel: 'Ilimitado pela plataforma Lumora',
        providerQuotaLabel: 'Sem cota externa rígida informada',
        hasMeasurement: true,
        missingNotice: 'Serviço compartilhado da plataforma sem limite configurado',
      },
    },
  ];

  const totalUnitsUsed = enrichedIntegrations.reduce((acc, i) => acc + i.consumption.unitsUsed, 0) + cepUnitsUsed;
  const totalSpentCents = enrichedIntegrations.reduce((acc, i) => acc + i.consumption.costSpentCents, 0);

  return {
    period,
    integrations: enrichedIntegrations,
    sharedServices: enrichedSharedServices,
    unlinkedUsage,
    overview: {
      totalUnitsUsed,
      totalSpentCents,
      totalSpentFormatted: `R$ ${(totalSpentCents / 100).toFixed(2).replace('.', ',')}`,
      activeIntegrationsCount: enrichedIntegrations.filter((i) => i.status === 'ACTIVE').length,
      hasUnlinkedRecords: unlinkedUsage.hasUnlinkedRecords,
    },
  };
}

/**
 * Retorna visão geral consolidada das APIs de todas as empresas para o Super Admin.
 */
export async function getPlatformIntegrationsOverview() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthNames = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];
  const period = `${monthNames[now.getMonth()]}/${now.getFullYear()}`;

  const companies = await prisma.company.findMany({
    select: {
      id: true,
      name: true,
      classification: true,
    },
    orderBy: { name: 'asc' },
  });

  const allIntegrations = await prisma.companyIntegration.findMany();
  const monthRecords = await prisma.apiUsageRecord.findMany({
    where: { timestamp: { gte: startOfMonth } },
  });
  const historicalSuccesses = await prisma.apiUsageRecord.findMany({
    where: { status: 'SUCCESS' },
    select: { companyId: true, category: true, provider: true },
  });

  let totalUnitsUsed = 0;
  let totalSpentCents = 0;

  const companiesSummary = companies.map((c) => {
    const compIntegrations = allIntegrations.filter((i) => i.companyId === c.id);
    const compRecords = monthRecords.filter((r) => r.companyId === c.id);
    const compUnits = compRecords.reduce((sum, r) => sum + (r.unitsUsed || 1), 0);
    const compSpent = compRecords.reduce(
      (sum, r) => sum + getEffectiveOperationCostCents(r),
      0
    );

    totalUnitsUsed += compUnits;
    totalSpentCents += compSpent;

    let compOperational = 0;
    compIntegrations.forEach((i) => {
      const hasProof = historicalSuccesses.some(
        (h) => h.companyId === c.id && h.category === i.category && h.provider === i.provider
      );
      if (hasProof) compOperational++;
    });

    return {
      companyId: c.id,
      companyName: c.name,
      classification: c.classification,
      integrationsCount: compIntegrations.length,
      activeIntegrationsCount: compIntegrations.filter((i) => i.status === 'ACTIVE').length,
      operationalCount: compOperational,
      unitsUsedThisMonth: compUnits,
      spentCentsThisMonth: compSpent,
      spentFormatted: `R$ ${(compSpent / 100).toFixed(2).replace('.', ',')}`,
    };
  });

  return {
    period,
    totalCompanies: companies.length,
    totalIntegrations: allIntegrations.length,
    totalUnitsUsedThisMonth: totalUnitsUsed,
    totalSpentCentsThisMonth: totalSpentCents,
    totalSpentFormatted: `R$ ${(totalSpentCents / 100).toFixed(2).replace('.', ',')}`,
    companies: companiesSummary,
  };
}
