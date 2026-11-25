import { prisma } from './prisma';
import {
  encryptSecret,
  decryptSecret,
  isVaultConfigurationError,
  validateExternalUrl,
  ASAAS_SANDBOX_BASE_URL,
  ASAAS_PRODUCTION_BASE_URL,
} from './vaultService';
import { GoogleGenAI } from '@google/genai';
import { recordOperationalAuditEvent } from './operationalAuditService';
import { isExternalServicesDisabled } from '../utils/externalServices';
import { getCompanyAsaasConfig } from './asaasService';
import { recordCompanyApiUsageLog } from './apiUsageService';

export function formatTailMask(secret: string | null | undefined): string | null {
  if (!secret || typeof secret !== 'string') return null;
  const trimmed = secret.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 4) return '••••';
  return `••••${trimmed.slice(-4)}`;
}

export async function resolveExclusiveCompanyGeminiKey(
  companyId: string,
  options?: { rethrowVaultError?: boolean }
): Promise<{
  configured: boolean;
  key: string | null;
  maskedKey: string | null;
  source: 'COMPANY_VAULT' | 'COMPANY_INTEGRATION' | 'NONE';
}> {
  if (!companyId) {
    return { configured: false, key: null, maskedKey: null, source: 'NONE' };
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      geminiApiKeyEncrypted: true,
      geminiApiKeyIv: true,
      geminiApiKeyTag: true,
      geminiApiKeyMasked: true,
    },
  });

  if (
    company?.geminiApiKeyEncrypted &&
    company.geminiApiKeyIv &&
    company.geminiApiKeyTag
  ) {
    try {
      const plain = decryptSecret(
        company.geminiApiKeyEncrypted,
        company.geminiApiKeyIv,
        company.geminiApiKeyTag
      );
      if (plain && plain.trim()) {
        return {
          configured: true,
          key: plain.trim(),
          maskedKey: company.geminiApiKeyMasked || formatTailMask(plain),
          source: 'COMPANY_VAULT',
        };
      }
    } catch (err) {
      if (options?.rethrowVaultError && isVaultConfigurationError(err)) {
        throw err;
      }
      console.error(`[CompanyApiKey] Erro ao descriptografar chave Gemini da empresa ${companyId}:`, err);
    }
  }

  // Também aceita CompanyIntegration exclusiva (AI_RESEARCH + GEMINI, nunca PLATFORM_SHARED)
  const ownInteg = await prisma.companyIntegration.findFirst({
    where: {
      companyId,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      status: 'ACTIVE',
      scope: { not: 'PLATFORM_SHARED' },
    },
    orderBy: { updatedAt: 'desc' },
  });

  if (
    ownInteg &&
    ownInteg.credentialSource === 'VAULT_ENCRYPTED' &&
    ownInteg.encryptedSecret &&
    ownInteg.secretIv &&
    ownInteg.secretTag
  ) {
    try {
      const plain = decryptSecret(
        ownInteg.encryptedSecret,
        ownInteg.secretIv,
        ownInteg.secretTag
      );
      if (plain && plain.trim()) {
        return {
          configured: true,
          key: plain.trim(),
          maskedKey: ownInteg.secretMasked || formatTailMask(plain),
          source: 'COMPANY_INTEGRATION',
        };
      }
    } catch (err) {
      if (options?.rethrowVaultError && isVaultConfigurationError(err)) {
        throw err;
      }
      console.error(`[CompanyApiKey] Erro ao descriptografar CompanyIntegration Gemini (${companyId}):`, err);
    }
  }

  return { configured: false, key: null, maskedKey: null, source: 'NONE' };
}

export async function setExclusiveCompanyGeminiKey(params: {
  companyId: string;
  apiKey: string | null;
  actorUserId: string;
  actorName: string;
  ipAddress?: string | null;
}) {
  const { companyId, apiKey, actorUserId, actorName, ipAddress } = params;
  const trimmed = typeof apiKey === 'string' ? apiKey.trim() : '';

  if (!trimmed) {
    await prisma.company.update({
      where: { id: companyId },
      data: {
        geminiApiKeyEncrypted: null,
        geminiApiKeyIv: null,
        geminiApiKeyTag: null,
        geminiApiKeyMasked: null,
        geminiLastTestedAt: null,
        geminiConnectionStatus: 'UNCONFIGURED',
        geminiConnectionMessage: 'Chave Gemini removida pelo SuperAdmin.',
      },
    });

    await recordOperationalAuditEvent({
      companyId,
      category: 'INTEGRATION',
      action: 'COMPANY_GEMINI_KEY_REMOVED',
      entityType: 'COMPANY_API_KEY',
      entityReference: `GEMINI:${companyId}`,
      entityId: companyId,
      previousValues: { configured: true },
      newValues: { configured: false },
      reason: 'Remoção da chave Gemini exclusiva da empresa pelo SuperAdmin',
      authorUserId: actorUserId,
      authorName: actorName,
      authorRole: 'SUPER_ADMIN',
      ipAddress: ipAddress || null,
    });

    return { configured: false, maskedKey: null, connectionStatus: 'UNCONFIGURED' };
  }

  const cipher = encryptSecret(trimmed);
  const masked = formatTailMask(trimmed)!;

  await prisma.company.update({
    where: { id: companyId },
    data: {
      geminiApiKeyEncrypted: cipher.encryptedSecret,
      geminiApiKeyIv: cipher.secretIv,
      geminiApiKeyTag: cipher.secretTag,
      geminiApiKeyMasked: masked,
      geminiConnectionStatus: 'PENDING',
      geminiConnectionMessage: 'Chave configurada. Execute Testar Conexão para validar.',
    },
  });

  // Sincroniza também em CompanyIntegration exclusiva da empresa (ENVIRONMENT PRODUCTION)
  await prisma.companyIntegration.upsert({
    where: {
      companyId_category_environment: {
        companyId,
        category: 'AI_RESEARCH',
        environment: 'PRODUCTION',
      },
    },
    update: {
      provider: 'GEMINI',
      scope: 'EXCLUSIVE_OWN_KEY',
      status: 'ACTIVE',
      costPayer: 'COMPANY',
      credentialSource: 'VAULT_ENCRYPTED',
      encryptedSecret: cipher.encryptedSecret,
      secretIv: cipher.secretIv,
      secretTag: cipher.secretTag,
      secretMasked: masked,
      updatedByUserId: actorUserId,
    },
    create: {
      companyId,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      scope: 'EXCLUSIVE_OWN_KEY',
      status: 'ACTIVE',
      environment: 'PRODUCTION',
      costPayer: 'COMPANY',
      credentialSource: 'VAULT_ENCRYPTED',
      encryptedSecret: cipher.encryptedSecret,
      secretIv: cipher.secretIv,
      secretTag: cipher.secretTag,
      secretMasked: masked,
      createdByUserId: actorUserId,
    },
  });

  await recordOperationalAuditEvent({
    companyId,
    category: 'INTEGRATION',
    action: 'COMPANY_GEMINI_KEY_CONFIGURED',
    entityType: 'COMPANY_API_KEY',
    entityReference: `GEMINI:${companyId}`,
    entityId: companyId,
    previousValues: null,
    newValues: { configured: true, maskedKey: masked, scope: 'EXCLUSIVE_OWN_KEY' },
    reason: 'Configuração de chave Gemini exclusiva da empresa pelo SuperAdmin',
    authorUserId: actorUserId,
    authorName: actorName,
    authorRole: 'SUPER_ADMIN',
    ipAddress: ipAddress || null,
  });

  return { configured: true, maskedKey: masked, connectionStatus: 'PENDING' };
}

export async function setExclusiveCompanyAsaasKey(params: {
  companyId: string;
  apiKey: string | null;
  environment?: 'SANDBOX' | 'PRODUCTION';
  accountName?: string | null;
  actorUserId: string;
  actorName: string;
  ipAddress?: string | null;
}) {
  const {
    companyId,
    apiKey,
    environment = 'SANDBOX',
    accountName,
    actorUserId,
    actorName,
    ipAddress,
  } = params;

  const envUpper = environment === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX';
  const trimmed = typeof apiKey === 'string' ? apiKey.trim() : '';

  if (!trimmed) {
    await prisma.company.update({
      where: { id: companyId },
      data: {
        asaasConnectionStatus: 'UNCONFIGURED',
        asaasConnectionMessage: 'Chave Asaas removida pelo SuperAdmin.',
        asaasLastTestedAt: null,
      },
    });
    await prisma.companyIntegration.updateMany({
      where: { companyId, category: 'PAYMENT_GATEWAY', environment: envUpper },
      data: { status: 'DISABLED', updatedByUserId: actorUserId },
    });
    return { configured: false, environment: envUpper, maskedKey: null };
  }

  const cipher = encryptSecret(trimmed);
  const masked = formatTailMask(trimmed)!;

  await prisma.companyIntegration.upsert({
    where: {
      companyId_category_environment: {
        companyId,
        category: 'PAYMENT_GATEWAY',
        environment: envUpper,
      },
    },
    update: {
      provider: 'ASAAS',
      scope: 'COMPANY_EXCLUSIVE',
      status: 'ACTIVE',
      accountName: accountName?.trim() || `Conta Asaas ${envUpper}`,
      costPayer: 'COMPANY',
      credentialSource: 'VAULT_ENCRYPTED',
      encryptedSecret: cipher.encryptedSecret,
      secretIv: cipher.secretIv,
      secretTag: cipher.secretTag,
      secretMasked: masked,
      updatedByUserId: actorUserId,
      ...(envUpper === 'SANDBOX'
        ? { configMetadata: { operationalFinancialMode: 'SANDBOX' } }
        : {}),
    },
    create: {
      companyId,
      category: 'PAYMENT_GATEWAY',
      provider: 'ASAAS',
      scope: 'COMPANY_EXCLUSIVE',
      status: 'ACTIVE',
      environment: envUpper,
      accountName: accountName?.trim() || `Conta Asaas ${envUpper}`,
      costPayer: 'COMPANY',
      credentialSource: 'VAULT_ENCRYPTED',
      encryptedSecret: cipher.encryptedSecret,
      secretIv: cipher.secretIv,
      secretTag: cipher.secretTag,
      secretMasked: masked,
      createdByUserId: actorUserId,
      ...(envUpper === 'SANDBOX'
        ? { configMetadata: { operationalFinancialMode: 'SANDBOX' } }
        : {}),
    },
  });

  await prisma.asaasConfig.upsert({
    where: { companyId },
    update: {
      mode: envUpper,
      apiKey: cipher.encryptedSecret,
    },
    create: {
      companyId,
      mode: envUpper,
      apiKey: cipher.encryptedSecret,
    },
  });

  await prisma.company.update({
    where: { id: companyId },
    data: {
      asaasConnectionStatus: 'PENDING',
      asaasConnectionMessage: `Chave Asaas (${envUpper}) configurada. Execute Testar Conexão para validar.`,
    },
  });

  await recordOperationalAuditEvent({
    companyId,
    category: 'INTEGRATION',
    action: 'COMPANY_ASAAS_KEY_CONFIGURED',
    entityType: 'COMPANY_API_KEY',
    entityReference: `ASAAS:${companyId}:${envUpper}`,
    entityId: companyId,
    previousValues: null,
    newValues: { configured: true, environment: envUpper, maskedKey: masked, scope: 'COMPANY_EXCLUSIVE' },
    reason: `Configuração de chave Asaas/Serasa (${envUpper}) exclusiva da empresa pelo SuperAdmin`,
    authorUserId: actorUserId,
    authorName: actorName,
    authorRole: 'SUPER_ADMIN',
    ipAddress: ipAddress || null,
  });

  return { configured: true, environment: envUpper, maskedKey: masked };
}

export async function resolveCompanyAsaasStatus(
  companyId: string,
  options?: { rethrowVaultError?: boolean }
) {
  const [integs, legacyCfg, company] = await Promise.all([
    prisma.companyIntegration.findMany({
      where: { companyId, category: 'PAYMENT_GATEWAY', provider: 'ASAAS' },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.asaasConfig.findUnique({ where: { companyId } }),
    prisma.company.findUnique({
      where: { id: companyId },
      select: {
        asaasLastTestedAt: true,
        asaasConnectionStatus: true,
        asaasConnectionMessage: true,
      },
    }),
  ]);

  const activeInteg = integs.find((i) => i.status === 'ACTIVE') || integs[0] || null;
  let configured = false;
  let environment: string = 'SANDBOX';
  let maskedKey: string | null = null;
  let secret: string | null = null;

  if (activeInteg && activeInteg.status === 'ACTIVE') {
    environment = activeInteg.environment || 'SANDBOX';
    if (activeInteg.encryptedSecret && activeInteg.secretIv && activeInteg.secretTag) {
      try {
        secret = decryptSecret(
          activeInteg.encryptedSecret,
          activeInteg.secretIv,
          activeInteg.secretTag
        );
        configured = Boolean(secret && secret.trim());
        maskedKey = activeInteg.secretMasked || formatTailMask(secret);
      } catch (err) {
        if (options?.rethrowVaultError && isVaultConfigurationError(err)) {
          throw err;
        }
        configured = false;
      }
    }
  } else if (legacyCfg && legacyCfg.mode !== 'DISABLED' && legacyCfg.apiKey) {
    environment = legacyCfg.mode === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX';
    configured = true;
    // Se estiver cifrado ou texto antigo, apenas exibe últimos 4 caracteres mascarados
    maskedKey = formatTailMask(legacyCfg.apiKey);
    const resolved = await getCompanyAsaasConfig(
      companyId,
      environment === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX'
    );
    secret = resolved.apiKey || null;
  }

  return {
    configured,
    environment,
    maskedKey,
    secret,
    connectionStatus:
      company?.asaasConnectionStatus || (configured ? 'PENDING' : 'UNCONFIGURED'),
    lastTestedAt: company?.asaasLastTestedAt || null,
    connectionMessage: company?.asaasConnectionMessage || null,
  };
}

function sanitizeProviderError(raw: unknown, secretToHide: string): string {
  const rawStr = String(raw || 'Erro desconhecido');
  if (!secretToHide) return rawStr;
  return rawStr.split(secretToHide).join('••••');
}

function extractHttpStatusFromError(err: any): number | null {
  const direct = err?.status ?? err?.statusCode ?? err?.httpStatus ?? err?.response?.status;
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  const msg = String(err?.message || '');
  const match = msg.match(/\b(401|403|429|500|502|503|504)\b/);
  return match ? Number(match[1]) : null;
}

export async function testCompanyGeminiConnection(params: {
  companyId: string;
  actorUserId: string;
  actorName: string;
  ipAddress?: string | null;
}) {
  const { companyId, actorUserId, actorName, ipAddress } = params;
  const resolved = await resolveExclusiveCompanyGeminiKey(companyId, { rethrowVaultError: true });

  if (!resolved.configured || !resolved.key) {
    return {
      success: false,
      configured: false,
      maskedKey: null,
      status: 'UNCONFIGURED',
      message: 'Nenhuma chave Gemini exclusiva configurada para esta empresa.',
    };
  }

  const now = new Date();
  let success = false;
  let message = '';
  let latencyMs = 0;
  let httpStatus: number | null = null;
  let rateLimited = false;
  let promptTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  const started = Date.now();

  if (isExternalServicesDisabled()) {
    const trimmedKey = resolved.key.trim();
    const looksRateLimited = trimmedKey.toLowerCase().includes('ratelimit') || trimmedKey.includes('429');
    const looksInvalid =
      trimmedKey.length < 12 || trimmedKey.toLowerCase().includes('invalid');
    if (looksRateLimited) {
      success = false;
      rateLimited = true;
      httpStatus = 429;
      message = 'Limite ou cota da API Gemini atingido (HTTP 429).';
    } else if (looksInvalid) {
      success = false;
      httpStatus = 401;
      message = 'Formato de chave Gemini inválido para autenticação.';
    } else {
      success = true;
      httpStatus = 200;
      message = 'Chave Gemini da empresa validada com sucesso (modo seguro de teste).';
    }
    latencyMs = Date.now() - started;
  } else {
    let timer: NodeJS.Timeout | null = null;
    try {
      const check = await validateExternalUrl('https://generativelanguage.googleapis.com');
      if (!check.valid) {
        throw new Error(check.error || 'Endpoint Gemini não autorizado.');
      }

      const ai = new GoogleGenAI({ apiKey: resolved.key });
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const timeoutErr: any = new Error('GEMINI_TEST_TIMEOUT');
          timeoutErr.name = 'AbortError';
          reject(timeoutErr);
        }, 8000);
      });

      const response: any = await Promise.race([
        ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: 'Responda apenas OK',
          config: {
            maxOutputTokens: 32,
            temperature: 0,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        timeoutPromise,
      ]);

      latencyMs = Date.now() - started;
      httpStatus = 200;
      success = true;
      message = 'Conexão com Google Gemini autenticada com sucesso.';

      const um = response?.usageMetadata;
      if (um) {
        promptTokens = typeof um.promptTokenCount === 'number' ? um.promptTokenCount : 0;
        outputTokens = typeof um.candidatesTokenCount === 'number' ? um.candidatesTokenCount : 0;
        totalTokens =
          typeof um.totalTokenCount === 'number'
            ? um.totalTokenCount
            : promptTokens + outputTokens;
      }
    } catch (err: any) {
      latencyMs = Date.now() - started;
      const errStatus = extractHttpStatusFromError(err);
      httpStatus = errStatus;
      const safeErr = sanitizeProviderError(err?.message || 'Timeout ou erro de rede', resolved.key);
      success = false;

      if (err?.name === 'AbortError' || safeErr.includes('GEMINI_TEST_TIMEOUT') || err?.code === 'ETIMEDOUT') {
        httpStatus = 504;
        message = 'Timeout após 8s ao conectar ao Google Gemini.';
      } else if (errStatus === 429 || /RESOURCE_EXHAUSTED/i.test(safeErr)) {
        httpStatus = 429;
        rateLimited = true;
        message = 'Limite ou cota da API Gemini atingido (HTTP 429).';
      } else if (errStatus === 401 || errStatus === 403 || /API_KEY_INVALID|PERMISSION_DENIED|UNAUTHENTICATED/i.test(safeErr)) {
        message = `Chave Gemini rejeitada pela API Google (HTTP ${errStatus || '401/403'}).`;
      } else if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|network/i.test(safeErr)) {
        message = `Erro de rede ao conectar ao Google Gemini: ${safeErr}`;
      } else {
        message = `Falha na conexão Gemini: ${safeErr}`;
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  await recordCompanyApiUsageLog({
    companyId,
    provider: 'GEMINI',
    operation: 'CONNECTION_TEST',
    status: success ? 'SUCCESS' : rateLimited ? 'RATE_LIMITED' : 'ERROR',
    promptTokens,
    outputTokens,
    totalTokens,
    httpStatus,
  });

  const statusStr = success ? 'CONNECTED' : 'ERROR';
  await prisma.company.update({
    where: { id: companyId },
    data: {
      geminiLastTestedAt: now,
      geminiConnectionStatus: statusStr,
      geminiConnectionMessage: message,
    },
  });

  await recordOperationalAuditEvent({
    companyId,
    category: 'INTEGRATION',
    action: 'COMPANY_GEMINI_CONNECTION_TESTED',
    entityType: 'COMPANY_API_KEY',
    entityReference: `GEMINI:${companyId}`,
    entityId: companyId,
    previousValues: null,
    newValues: {
      success,
      status: statusStr,
      maskedKey: resolved.maskedKey,
      latencyMs,
      httpStatus,
    },
    reason: message,
    authorUserId: actorUserId,
    authorName: actorName,
    authorRole: 'SUPER_ADMIN',
    ipAddress: ipAddress || null,
  });

  return {
    success,
    configured: true,
    maskedKey: resolved.maskedKey,
    status: statusStr,
    message,
    latencyMs,
    httpStatus,
    lastTestedAt: now,
  };
}

export async function testCompanyAsaasConnection(params: {
  companyId: string;
  actorUserId: string;
  actorName: string;
  requestedEnv?: string;
  ipAddress?: string | null;
}) {
  const { companyId, actorUserId, actorName, requestedEnv, ipAddress } = params;
  const info = await resolveCompanyAsaasStatus(companyId, { rethrowVaultError: true });

  if (!info.configured || !info.secret) {
    return {
      success: false,
      configured: false,
      maskedKey: null,
      environment: info.environment,
      status: 'UNCONFIGURED',
      message: 'Nenhuma chave Asaas exclusiva configurada para esta empresa.',
    };
  }

  const envUpper =
    requestedEnv?.toUpperCase() === 'PRODUCTION'
      ? 'PRODUCTION'
      : requestedEnv?.toUpperCase() === 'SANDBOX'
        ? 'SANDBOX'
        : info.environment;

  const now = new Date();
  let success = false;
  let message = '';
  let latencyMs = 0;
  let httpStatus: number | null = null;
  let rateLimited = false;
  const started = Date.now();

  if (isExternalServicesDisabled()) {
    const trimmedSecret = info.secret.trim();
    const looksRateLimited = trimmedSecret.toLowerCase().includes('ratelimit') || trimmedSecret.includes('429');
    const looksInvalid =
      trimmedSecret.length < 12 || trimmedSecret.toLowerCase().includes('invalid');
    if (looksRateLimited) {
      success = false;
      rateLimited = true;
      httpStatus = 429;
      message = `Limite de requisições Asaas (${envUpper}) atingido (HTTP 429).`;
    } else if (looksInvalid) {
      success = false;
      httpStatus = 401;
      message = `Credencial Asaas (${envUpper}) inválida.`;
    } else {
      success = true;
      httpStatus = 200;
      message = `Conexão Asaas (${envUpper}) validada com sucesso (modo seguro de teste).`;
    }
    latencyMs = Date.now() - started;
  } else {
    try {
      const baseUrl =
        envUpper === 'PRODUCTION' ? ASAAS_PRODUCTION_BASE_URL : ASAAS_SANDBOX_BASE_URL;
      const endpoint = `${baseUrl}/customers?limit=1`;
      const check = await validateExternalUrl(endpoint);
      if (!check.valid) {
        throw new Error(check.error || 'Endpoint Asaas não autorizado.');
      }
      const resp = await fetch(endpoint, {
        method: 'GET',
        headers: {
          access_token: info.secret,
          'User-Agent': 'LumoraPlatform/2.0',
        },
        signal: AbortSignal.timeout(8000),
      });
      latencyMs = Date.now() - started;
      httpStatus = resp.status;
      if (resp.ok) {
        success = true;
        message = `Conexão com Asaas (${envUpper}) autenticada com sucesso.`;
      } else if (resp.status === 429) {
        success = false;
        rateLimited = true;
        message = `Limite de requisições Asaas (${envUpper}) atingido (HTTP 429).`;
      } else if (resp.status === 401 || resp.status === 403) {
        success = false;
        message = `Chave Asaas (${envUpper}) rejeitada (HTTP ${resp.status}).`;
      } else {
        success = false;
        message = `Asaas (${envUpper}) retornou falha HTTP ${resp.status}.`;
      }
    } catch (err: any) {
      latencyMs = Date.now() - started;
      const safeErr = sanitizeProviderError(err?.message || 'Timeout ou erro de rede', info.secret);
      success = false;
      if (err?.name === 'AbortError' || err?.name === 'TimeoutError' || /timeout|ETIMEDOUT/i.test(safeErr)) {
        httpStatus = 504;
        message = `Timeout após 8s ao conectar ao Asaas (${envUpper}).`;
      } else if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|network/i.test(safeErr)) {
        message = `Erro de rede ao conectar ao Asaas (${envUpper}): ${safeErr}`;
      } else {
        message = `Falha na conexão Asaas (${envUpper}): ${safeErr}`;
      }
    }
  }

  await recordCompanyApiUsageLog({
    companyId,
    provider: 'ASAAS',
    operation: 'CONNECTION_TEST',
    status: success ? 'SUCCESS' : rateLimited ? 'RATE_LIMITED' : 'ERROR',
    httpStatus,
  });

  const statusStr = success ? 'CONNECTED' : 'ERROR';
  await prisma.company.update({
    where: { id: companyId },
    data: {
      asaasLastTestedAt: now,
      asaasConnectionStatus: statusStr,
      asaasConnectionMessage: message,
    },
  });

  await recordOperationalAuditEvent({
    companyId,
    category: 'INTEGRATION',
    action: 'COMPANY_ASAAS_CONNECTION_TESTED',
    entityType: 'COMPANY_API_KEY',
    entityReference: `ASAAS:${companyId}:${envUpper}`,
    entityId: companyId,
    previousValues: null,
    newValues: {
      success,
      status: statusStr,
      environment: envUpper,
      maskedKey: info.maskedKey,
      latencyMs,
      httpStatus,
    },
    reason: message,
    authorUserId: actorUserId,
    authorName: actorName,
    authorRole: 'SUPER_ADMIN',
    ipAddress: ipAddress || null,
  });

  return {
    success,
    configured: true,
    maskedKey: info.maskedKey,
    environment: envUpper,
    status: statusStr,
    message,
    latencyMs,
    httpStatus,
    lastTestedAt: now,
  };
}
