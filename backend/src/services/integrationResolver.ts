import { PrismaClient, CompanyIntegration } from '@prisma/client';
import {
  decryptSecret,
  isAllowedEnvVarReference,
  isAllowedEnvVarForIntegration,
} from './vaultService';

const prisma = new PrismaClient();

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

/**
 * Registra o consumo de API no histórico de uso sem gravar dados pessoais dos prompts.
 * Distingue estimativa de custo de referência de custo medido pelo provedor.
 */
export async function recordApiUsage(params: {
  companyId: string;
  integrationId?: string;
  category: string;
  provider: string;
  operation: string;
  unitsUsed?: number;
  estimatedCostCents?: number;
  measuredCostCents?: number;
  status?: string;
  latencyMs?: number;
  errorMessage?: string;
}) {
  try {
    return await prisma.apiUsageRecord.create({
      data: {
        companyId: params.companyId,
        integrationId: params.integrationId || null,
        category: params.category,
        provider: params.provider,
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

  const usageRecords = await prisma.apiUsageRecord.findMany({
    where: {
      companyId,
      category,
      timestamp: { gte: startOfMonth },
    },
    select: {
      estimatedCostCents: true,
      measuredCostCents: true,
    },
  });

  const totalSpent = usageRecords.reduce((acc, curr) => {
    return acc + (curr.measuredCostCents ?? curr.estimatedCostCents ?? 0);
  }, 0);

  return {
    withinBudget: totalSpent < limitCents,
    currentSpentCents: totalSpent,
    limitCents,
  };
}

/**
 * Consulta de CEP via ViaCEP com cache em memória de 24 horas e sanitização.
 */
export async function lookupViaCep(rawCep: string): Promise<{
  success: boolean;
  data?: any;
  error?: string;
  cached?: boolean;
}> {
  const cleanCep = (rawCep || '').replace(/\D/g, '');
  if (cleanCep.length !== 8) {
    return { success: false, error: 'CEP deve conter exatamente 8 dígitos.' };
  }

  const now = Date.now();
  const cached = cepCache.get(cleanCep);
  if (cached && cached.expiresAt > now) {
    return { success: true, data: cached.data, cached: true };
  }

  try {
    const response = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`, {
      method: 'GET',
      headers: { 'User-Agent': 'LumoraPlatform/2.0 (contato@lumora.com.br)' },
    });

    if (!response.ok) {
      return { success: false, error: `ViaCEP respondeu com status ${response.status}` };
    }

    const data = await response.json();
    if (data.erro) {
      return { success: false, error: 'CEP não encontrado na base dos Correios.' };
    }

    // Armazena no cache por 24 horas
    cepCache.set(cleanCep, {
      data,
      expiresAt: now + 24 * 60 * 60 * 1000,
    });

    return { success: true, data, cached: false };
  } catch (err: any) {
    return { success: false, error: `Falha na requisição ao ViaCEP: ${err.message}` };
  }
}
