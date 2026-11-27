import { prisma } from './prisma';
import {
  encryptSecret,
  decryptSecret,
  maskSecret,
  isVaultConfigurationError,
  validateExternalUrl,
  ASAAS_SANDBOX_BASE_URL,
  ASAAS_PRODUCTION_BASE_URL,
} from './vaultService';
import {
  DEFAULT_GEMINI_SEARCH_MODEL,
  GeminiModelDescriptor,
  createGoogleGenAiClient,
  extractGeminiHttpStatus,
  getCompanyGeminiMetadata,
  getGeminiClientOverrideForTests,
  hasGeminiBaseUrlOverride,
  isGeminiModelNotFoundError,
  listAvailableGeminiModels,
  normalizeGeminiModelId,
  persistCompanyGeminiModel,
  resolveActiveGeminiModel,
} from './geminiModelService';
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
  apiKey?: string | null;
  geminiModel?: string | null;
  removeKey?: boolean;
  actorUserId: string;
  actorName: string;
  ipAddress?: string | null;
}) {
  const {
    companyId,
    apiKey,
    geminiModel,
    removeKey = false,
    actorUserId,
    actorName,
    ipAddress,
  } = params;
  const trimmed = typeof apiKey === 'string' ? apiKey.trim() : '';
  const hasModelParam = geminiModel !== undefined;
  const normalizedModel =
    typeof geminiModel === 'string' ? normalizeGeminiModelId(geminiModel) : '';

  const existingInteg = await prisma.companyIntegration.findUnique({
    where: {
      companyId_category_environment: {
        companyId,
        category: 'AI_RESEARCH',
        environment: 'PRODUCTION',
      },
    },
  });

  const existingCompany = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      geminiApiKeyEncrypted: true,
      geminiApiKeyIv: true,
      geminiApiKeyTag: true,
      geminiApiKeyMasked: true,
      geminiConnectionStatus: true,
    },
  });

  const hasExistingKey = Boolean(
    (existingCompany?.geminiApiKeyEncrypted &&
      existingCompany.geminiApiKeyIv &&
      existingCompany.geminiApiKeyTag) ||
      (existingInteg?.encryptedSecret &&
        existingInteg.secretIv &&
        existingInteg.secretTag)
  );

  // Remoção explícita da chave (ou chamada legada com apiKey null/vazia sem atualização de modelo)
  const shouldRemove =
    removeKey === true ||
    (!trimmed && (!hasModelParam || !hasExistingKey));

  if (shouldRemove) {
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

    await prisma.companyIntegration.updateMany({
      where: { companyId, category: 'AI_RESEARCH', provider: 'GEMINI' },
      data: { status: 'DISABLED', updatedByUserId: actorUserId },
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

    return {
      configured: false,
      maskedKey: null,
      geminiModel: null,
      connectionStatus: 'UNCONFIGURED',
    };
  }

  // MERGE seguro de configMetadata preservando dados anteriores
  const prevMeta =
    existingInteg?.configMetadata && typeof existingInteg.configMetadata === 'object'
      ? { ...(existingInteg.configMetadata as Record<string, any>) }
      : {};
  const mergedMeta: Record<string, any> = { ...prevMeta };
  if (hasModelParam) {
    if (normalizedModel) {
      mergedMeta.geminiModel = normalizedModel;
    } else {
      delete mergedMeta.geminiModel;
    }
  }

  let cipher: { encryptedSecret: string; secretIv: string; secretTag: string };
  let masked: string;

  if (trimmed) {
    cipher = encryptSecret(trimmed);
    masked = formatTailMask(trimmed)!;
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
  } else {
    cipher = {
      encryptedSecret:
        existingInteg?.encryptedSecret || existingCompany!.geminiApiKeyEncrypted!,
      secretIv: existingInteg?.secretIv || existingCompany!.geminiApiKeyIv!,
      secretTag: existingInteg?.secretTag || existingCompany!.geminiApiKeyTag!,
    };
    masked =
      existingInteg?.secretMasked || existingCompany?.geminiApiKeyMasked || '••••';
  }

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
      configMetadata: mergedMeta,
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
      configMetadata: mergedMeta,
      createdByUserId: actorUserId,
    },
  });

  await recordOperationalAuditEvent({
    companyId,
    category: 'INTEGRATION',
    action: trimmed ? 'COMPANY_GEMINI_KEY_CONFIGURED' : 'COMPANY_GEMINI_MODEL_UPDATED',
    entityType: 'COMPANY_API_KEY',
    entityReference: `GEMINI:${companyId}`,
    entityId: companyId,
    previousValues: { geminiModel: prevMeta.geminiModel || null },
    newValues: {
      configured: true,
      maskedKey: masked,
      geminiModel: mergedMeta.geminiModel || null,
      scope: 'EXCLUSIVE_OWN_KEY',
    },
    reason: trimmed
      ? 'Configuração de chave Gemini exclusiva da empresa pelo SuperAdmin'
      : 'Atualização do modelo Gemini da empresa pelo SuperAdmin',
    authorUserId: actorUserId,
    authorName: actorName,
    authorRole: 'SUPER_ADMIN',
    ipAddress: ipAddress || null,
  });

  return {
    configured: true,
    maskedKey: masked,
    geminiModel: mergedMeta.geminiModel ? String(mergedMeta.geminiModel) : null,
    connectionStatus: trimmed
      ? 'PENDING'
      : existingCompany?.geminiConnectionStatus || 'PENDING',
  };
}

export async function setExclusiveCompanyAsaasKey(params: {
  companyId: string;
  apiKey: string | null;
  environment?: 'SANDBOX' | 'PRODUCTION';
  accountName?: string | null;
  webhookToken?: string | null;
  removeWebhookToken?: boolean;
  actorUserId: string;
  actorName: string;
  ipAddress?: string | null;
}) {
  const {
    companyId,
    apiKey,
    environment = 'SANDBOX',
    accountName,
    webhookToken,
    removeWebhookToken,
    actorUserId,
    actorName,
    ipAddress,
  } = params;

  const envUpper = environment === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX';
  const trimmed = typeof apiKey === 'string' ? apiKey.trim() : '';
  const trimmedWebhook = typeof webhookToken === 'string' ? webhookToken.trim() : '';

  const existing = await prisma.companyIntegration.findUnique({
    where: {
      companyId_category_environment: {
        companyId,
        category: 'PAYMENT_GATEWAY',
        environment: envUpper,
      },
    },
  });

  // Se apiKey não veio (vazia) mas já existe chave criptografada no cofre e veio atualização de webhook/conta
  const keepExistingSecret =
    apiKey !== null &&
    !trimmed &&
    Boolean(existing?.encryptedSecret && existing?.secretIv && existing?.secretTag) &&
    (Boolean(trimmedWebhook) || removeWebhookToken === true || accountName !== undefined);

  if (!trimmed && !keepExistingSecret) {
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
    return {
      configured: false,
      environment: envUpper,
      maskedKey: null,
      hasWebhookToken: false,
      webhookMasked: null,
    };
  }

  const cipher = trimmed
    ? encryptSecret(trimmed)
    : {
        encryptedSecret: existing!.encryptedSecret!,
        secretIv: existing!.secretIv!,
        secretTag: existing!.secretTag!,
      };
  const masked = trimmed ? formatTailMask(trimmed)! : existing!.secretMasked || '••••';

  // MERGE seguro de configMetadata: preserva encryptedWebhookToken, operationalFinancialMode e demais parâmetros
  const prevMeta =
    existing?.configMetadata && typeof existing.configMetadata === 'object'
      ? { ...(existing.configMetadata as Record<string, any>) }
      : {};

  const mergedMetadata: Record<string, any> = {
    ...prevMeta,
  };

  if (envUpper === 'SANDBOX') {
    mergedMetadata.operationalFinancialMode =
      prevMeta.operationalFinancialMode || 'SANDBOX';
  }

  if (removeWebhookToken === true) {
    delete mergedMetadata.encryptedWebhookToken;
    delete mergedMetadata.webhookIv;
    delete mergedMetadata.webhookTag;
    delete mergedMetadata.webhookMasked;
    delete mergedMetadata.webhookToken;
  } else if (trimmedWebhook) {
    const encWh = encryptSecret(trimmedWebhook);
    mergedMetadata.encryptedWebhookToken = encWh.encryptedSecret;
    mergedMetadata.webhookIv = encWh.secretIv;
    mergedMetadata.webhookTag = encWh.secretTag;
    mergedMetadata.webhookMasked = maskSecret(trimmedWebhook);
    delete mergedMetadata.webhookToken;
  }

  const resolvedAccountName =
    accountName !== undefined
      ? (accountName?.trim() || `Conta Asaas ${envUpper}`)
      : existing?.accountName || `Conta Asaas ${envUpper}`;

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
      accountName: resolvedAccountName,
      costPayer: 'COMPANY',
      credentialSource: 'VAULT_ENCRYPTED',
      encryptedSecret: cipher.encryptedSecret,
      secretIv: cipher.secretIv,
      secretTag: cipher.secretTag,
      secretMasked: masked,
      updatedByUserId: actorUserId,
      configMetadata: mergedMetadata,
    },
    create: {
      companyId,
      category: 'PAYMENT_GATEWAY',
      provider: 'ASAAS',
      scope: 'COMPANY_EXCLUSIVE',
      status: 'ACTIVE',
      environment: envUpper,
      accountName: resolvedAccountName,
      costPayer: 'COMPANY',
      credentialSource: 'VAULT_ENCRYPTED',
      encryptedSecret: cipher.encryptedSecret,
      secretIv: cipher.secretIv,
      secretTag: cipher.secretTag,
      secretMasked: masked,
      createdByUserId: actorUserId,
      configMetadata: mergedMetadata,
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

  if (trimmed) {
    await prisma.company.update({
      where: { id: companyId },
      data: {
        asaasConnectionStatus: 'PENDING',
        asaasConnectionMessage: `Chave Asaas (${envUpper}) configurada. Execute Testar Conexão para validar.`,
      },
    });
  }

  const hasWebhookToken = Boolean(
    (mergedMetadata.encryptedWebhookToken && mergedMetadata.webhookIv && mergedMetadata.webhookTag) ||
      mergedMetadata.webhookToken
  );
  const webhookMasked = mergedMetadata.webhookMasked
    ? String(mergedMetadata.webhookMasked)
    : mergedMetadata.webhookToken
      ? maskSecret(String(mergedMetadata.webhookToken))
      : null;

  await recordOperationalAuditEvent({
    companyId,
    category: 'INTEGRATION',
    action: 'COMPANY_ASAAS_KEY_CONFIGURED',
    entityType: 'COMPANY_API_KEY',
    entityReference: `ASAAS:${companyId}:${envUpper}`,
    entityId: companyId,
    previousValues: null,
    newValues: {
      configured: true,
      environment: envUpper,
      maskedKey: masked,
      hasWebhookToken,
      scope: 'COMPANY_EXCLUSIVE',
    },
    reason: `Configuração de chave Asaas/Serasa (${envUpper}) exclusiva da empresa pelo SuperAdmin`,
    authorUserId: actorUserId,
    authorName: actorName,
    authorRole: 'SUPER_ADMIN',
    ipAddress: ipAddress || null,
  });

  return {
    configured: true,
    environment: envUpper,
    maskedKey: masked,
    accountName: resolvedAccountName,
    hasWebhookToken,
    webhookMasked,
  };
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
  let hasWebhookToken = false;
  let webhookMasked: string | null = null;
  let accountName: string | null = null;

  if (activeInteg) {
    const meta = (activeInteg.configMetadata as Record<string, any>) || {};
    hasWebhookToken = Boolean(
      (meta.encryptedWebhookToken && meta.webhookIv && meta.webhookTag) || meta.webhookToken
    );
    webhookMasked = meta.webhookMasked
      ? String(meta.webhookMasked)
      : meta.webhookToken
        ? maskSecret(String(meta.webhookToken))
        : null;
    accountName = activeInteg.accountName || null;
  }

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
    if (!hasWebhookToken && legacyCfg.webhookToken) {
      hasWebhookToken = true;
      webhookMasked = maskSecret(legacyCfg.webhookToken);
    }
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
    accountName,
    hasWebhookToken,
    webhookMasked,
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
  return extractGeminiHttpStatus(err);
}

export async function listCompanyGeminiModels(companyId: string): Promise<{
  configured: boolean;
  activeModel: string | null;
  recommendedModel: string | null;
  models: GeminiModelDescriptor[];
}> {
  const resolved = await resolveExclusiveCompanyGeminiKey(companyId, { rethrowVaultError: true });
  const meta = await getCompanyGeminiMetadata(companyId);

  if (!resolved.configured || !resolved.key) {
    return {
      configured: false,
      activeModel: meta.geminiModel,
      recommendedModel: null,
      models: [],
    };
  }

  const aiClient = createGoogleGenAiClient(resolved.key);
  const models = await listAvailableGeminiModels({
    apiKey: resolved.key,
    aiClient,
  });

  if (models.length > 0 && meta.geminiModel) {
    await persistCompanyGeminiModel(companyId, meta.geminiModel, models);
  }

  const recommendedModel = models.find((m) => m.recommended)?.id || models[0]?.id || null;
  return {
    configured: true,
    activeModel: meta.geminiModel || recommendedModel,
    recommendedModel,
    models,
  };
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
      activeModel: null,
      model: null,
      availableModels: [],
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
  let activeModel: string | null = null;
  let autoSwitchedFrom: string | null = null;
  let availableModels: GeminiModelDescriptor[] = [];
  const started = Date.now();

  const hasTestOverride = Boolean(getGeminiClientOverrideForTests()) || hasGeminiBaseUrlOverride();

  if (isExternalServicesDisabled() && !hasTestOverride) {
    const trimmedKey = resolved.key.trim();
    const savedMeta = await getCompanyGeminiMetadata(companyId);
    activeModel = savedMeta.geminiModel || DEFAULT_GEMINI_SEARCH_MODEL;
    availableModels = [
      {
        id: activeModel,
        name: `models/${activeModel}`,
        displayName: activeModel,
        supportedMethods: ['generateContent'],
        recommended: true,
      },
    ];
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
      message = `Chave Gemini da empresa validada com sucesso no modelo ${activeModel} (modo seguro de teste).`;
    }
    latencyMs = Date.now() - started;
  } else {
    try {
      if (!hasTestOverride) {
        const check = await validateExternalUrl('https://generativelanguage.googleapis.com');
        if (!check.valid) {
          throw new Error(check.error || 'Endpoint Gemini não autorizado.');
        }
      }

      const ai = createGoogleGenAiClient(resolved.key);
      const resolution = await resolveActiveGeminiModel({
        companyId,
        apiKey: resolved.key,
        aiClient: ai,
      });
      availableModels = resolution.availableModels;

      const triedModels: string[] = [];
      let queue = [...resolution.candidates];
      let lastErr: any = null;
      let discoveryExecuted = availableModels.length > 0;

      const pingModel = async (candidateModel: string) => {
        let timer: NodeJS.Timeout | null = null;
        try {
          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              const timeoutErr: any = new Error('GEMINI_TEST_TIMEOUT');
              timeoutErr.name = 'AbortError';
              reject(timeoutErr);
            }, 8000);
          });

          const callWithoutThinkingIfRejected = async () => {
            try {
              return await ai.models.generateContent({
                model: candidateModel,
                contents: 'Responda apenas OK',
                config: {
                  maxOutputTokens: 32,
                  temperature: 0,
                  thinkingConfig: { thinkingBudget: 0 },
                },
              });
            } catch (cfgErr: any) {
              const cfgMsg = String(cfgErr?.message || '');
              if (
                !isGeminiModelNotFoundError(cfgErr) &&
                extractHttpStatusFromError(cfgErr) === 400 &&
                /thinking/i.test(cfgMsg)
              ) {
                return await ai.models.generateContent({
                  model: candidateModel,
                  contents: 'Responda apenas OK',
                  config: { maxOutputTokens: 32, temperature: 0 },
                });
              }
              throw cfgErr;
            }
          };

          return await Promise.race([callWithoutThinkingIfRejected(), timeoutPromise]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      };

      let finalResp: any = null;
      while (queue.length > 0) {
        const candidate = queue.shift()!;
        if (!candidate || triedModels.includes(candidate)) continue;
        triedModels.push(candidate);

        try {
          finalResp = await pingModel(candidate);
          activeModel = candidate;
          if (triedModels.length > 1) {
            autoSwitchedFrom = triedModels[0];
          }
          break;
        } catch (err: any) {
          lastErr = err;
          if (!isGeminiModelNotFoundError(err)) {
            throw err;
          }

          // Recebeu HTTP 404 / NOT_FOUND -> descobre modelos reais da chave se ainda não consultou
          if (!discoveryExecuted) {
            discoveryExecuted = true;
            try {
              availableModels = await listAvailableGeminiModels({
                apiKey: resolved.key,
                aiClient: ai,
              });
              for (const discovered of availableModels) {
                if (!triedModels.includes(discovered.id) && !queue.includes(discovered.id)) {
                  queue.unshift(discovered.id);
                }
              }
              // Reordena mantendo os recém-descobertos por prioridade no topo
              const discoveredIds = availableModels
                .map((d) => d.id)
                .filter((id) => !triedModels.includes(id));
              const remainingFallbacks = queue.filter((id) => !discoveredIds.includes(id) && !triedModels.includes(id));
              queue = [...discoveredIds, ...remainingFallbacks];
            } catch {
              // segue com a fila residual de fallback
            }
          }
        }
      }

      if (!finalResp || !activeModel) {
        throw lastErr || new Error('Nenhum modelo Gemini compatível disponível para esta chave.');
      }

      if (!discoveryExecuted) {
        try {
          availableModels = await listAvailableGeminiModels({
            apiKey: resolved.key,
            aiClient: ai,
          });
        } catch {
          availableModels = [];
        }
      }

      await persistCompanyGeminiModel(companyId, activeModel, availableModels);

      latencyMs = Date.now() - started;
      httpStatus = 200;
      success = true;
      message = autoSwitchedFrom
        ? `Modelo "${autoSwitchedFrom}" indisponível (404). Conexão migrada e autenticada com sucesso em "${activeModel}".`
        : `Conexão com Google Gemini (${activeModel}) autenticada com sucesso.`;

      const um = finalResp?.usageMetadata;
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
      } else if (isGeminiModelNotFoundError(err)) {
        httpStatus = 404;
        message = `Nenhum modelo Gemini compatível respondeu ao teste (HTTP 404): ${safeErr}`;
      } else if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|network/i.test(safeErr)) {
        message = `Erro de rede ao conectar ao Google Gemini: ${safeErr}`;
      } else {
        message = `Falha na conexão Gemini: ${safeErr}`;
      }
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
      activeModel,
      autoSwitchedFrom,
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
    activeModel,
    model: activeModel,
    autoSwitchedFrom,
    availableModels: availableModels.map((m) => m.id),
    models: availableModels,
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
