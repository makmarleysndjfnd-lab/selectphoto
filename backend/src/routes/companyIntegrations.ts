import { Router, Response } from 'express';
import { prisma } from '../services/prisma';
import bcrypt from 'bcrypt';
import {
  authenticateToken,
  AuthRequest,
} from '../middleware/authMiddleware';
import {
  encryptSecret,
  maskSecret,
  decryptSecret,
} from '../services/vaultService';
import {
  testGeminiConnection,
  testAsaasSandboxConnection,
  testMetaWhatsAppConnection,
} from '../services/integrationAdapters';
import { isProductionSafetyLocked } from '../services/asaasService';
import { getCompanyEnrichedIntegrations } from '../services/integrationResolver';
import { resolvePendingReservation } from '../services/apiQuotaService';

const router = Router();


// Catálogo permitido para autoatendimento do Admin da Empresa
export const COMPANY_SELF_SERVICE_CATALOG = [
  {
    category: 'AI_RESEARCH',
    label: 'Inteligência Artificial (Pesquisa Comercial de Eventos)',
    supportedProviders: ['GEMINI'],
    supportedScopes: ['EXCLUSIVE_OWN_KEY'],
    environments: ['SANDBOX', 'PRODUCTION'],
    costPayer: 'COMPANY',
    description:
      'Chave própria do Google Gemini para pesquisa inteligente e radar de eventos em cidades de atuação.',
  },
  {
    category: 'PAYMENT_GATEWAY',
    label: 'Gateway de Pagamentos e Boletos (Asaas)',
    supportedProviders: ['ASAAS'],
    supportedScopes: ['COMPANY_EXCLUSIVE'],
    environments: ['SANDBOX', 'PRODUCTION'],
    supportsWebhookToken: true,
    costPayer: 'COMPANY',
    description:
      'Conta Asaas exclusiva da empresa para emissão de Pix e Boletos bancários. Permite Sandbox e Produção.',
  },
  {
    category: 'MESSAGING',
    label: 'WhatsApp Corporativo (Meta Cloud API)',
    supportedProviders: ['META_WHATSAPP'],
    supportedScopes: ['COMPANY_EXCLUSIVE'],
    environments: ['PRODUCTION'],
    costPayer: 'COMPANY',
    description:
      'Envio de mensagens corporativas via WhatsApp sob número e credenciais próprios da empresa.',
  },
];

export const COMPANY_SHARED_SERVICES = [
  {
    category: 'GEO_LOCATION',
    provider: 'VIACEP',
    label: 'Consulta de Endereço e CEP (ViaCEP)',
    type: 'PLATFORM_SHARED',
    status: 'ACTIVE',
    notes: 'Serviço compartilhado fornecido pela plataforma Lumora; não requer chave própria.',
  },
];

export const ALLOWED_ADMIN_ROLES = ['ADMIN', 'COMPANY_ADMIN', 'SUPER_ADMIN'];

/**
 * Validação centralizada de autorização administrativa e contexto de empresa.
 * Vendedores, fotógrafos e demais papéis recebem 403.
 * SUPER_ADMIN requer a capacidade INTEGRATION_CONFIG para gerenciar integrações.
 */
export async function authorizeCompanyAdmin(
  req: AuthRequest,
  res: Response
): Promise<{ companyId: string; userId: string; userName: string; role: string } | null> {
  const companyId = req.user?.companyId;
  const userId = req.user?.id;
  const userRole = req.user?.role;
  const userName = req.user?.name || 'Administrador';

  if (!companyId || !userId) {
    res.status(403).json({ error: 'Empresa ou usuário não identificado na sessão.' });
    return null;
  }

  if (!ALLOWED_ADMIN_ROLES.includes(userRole || '')) {
    res.status(403).json({ error: 'Acesso restrito a administradores da empresa.' });
    return null;
  }

  if (userRole === 'SUPER_ADMIN') {
    const cap = await prisma.ownerCapability.findFirst({
      where: {
        userId,
        capability: 'INTEGRATION_CONFIG',
      },
    });
    if (!cap) {
      res.status(403).json({
        error: 'Acesso negado: Requer a capacidade INTEGRATION_CONFIG para gerenciar integrações.',
      });
      return null;
    }
  }

  return { companyId, userId, userName, role: userRole! };
}

function sanitizeMetadata(metadata: any): Record<string, any> {
  if (!metadata || typeof metadata !== 'object') return {};
  const {
    encryptedWebhookToken,
    webhookIv,
    webhookTag,
    webhookMasked,
    webhookToken,
    ...safe
  } = metadata;
  return safe;
}

function extractWebhookSummary(metadata: any): {
  hasWebhookToken: boolean;
  webhookMasked: string | null;
} {
  if (!metadata || typeof metadata !== 'object') {
    return { hasWebhookToken: false, webhookMasked: null };
  }
  const hasWebhookToken = Boolean(
    (metadata.encryptedWebhookToken && metadata.webhookIv && metadata.webhookTag) ||
      metadata.webhookToken
  );
  const webhookMasked = metadata.webhookMasked
    ? String(metadata.webhookMasked)
    : metadata.webhookToken
      ? maskSecret(String(metadata.webhookToken))
      : null;
  return { hasWebhookToken, webhookMasked };
}

/**
 * GET /api/company/integrations
 * Lista integrações configuradas da empresa autenticada, enriquecidas com métricas reais de consumo,
 * situação operacional comprovada, limites do Lumora e cotas do provedor.
 * Restrito exclusivamente a administradores autorizados.
 */
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const auth = await authorizeCompanyAdmin(req, res);
    if (!auth) return;

    const { companyId } = auth;
    const enrichedData = await getCompanyEnrichedIntegrations(companyId);

    const sanitizedIntegrations = enrichedData.integrations.map((i: any) => {
      const wh = extractWebhookSummary(i.configMetadata);
      return {
        ...i,
        hasWebhookToken: wh.hasWebhookToken,
        webhookMasked: wh.webhookMasked,
        configMetadata: sanitizeMetadata(i.configMetadata),
      };
    });

    const prodSafety = await isProductionSafetyLocked(companyId);
    res.json({
      period: enrichedData.period,
      integrations: sanitizedIntegrations,
      catalog: COMPANY_SELF_SERVICE_CATALOG,
      sharedServices: enrichedData.sharedServices,
      unlinkedUsage: enrichedData.unlinkedUsage,
      overview: enrichedData.overview,
      globalLiveGateLocked: prodSafety.locked,
    });
  } catch (err: any) {
    console.error('Error fetching company integrations:', err);
    res.status(500).json({ error: `Erro ao buscar integrações: ${err.message}` });
  }
});

/**
 * POST /api/company/integrations
 * Cadastra ou substitui uma credencial de integração ou ajusta limites para a própria empresa.
 * Exige confirmação de senha do administrador autenticado e persiste auditoria transacional.
 */
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const auth = await authorizeCompanyAdmin(req, res);
    if (!auth) return;

    const { companyId, userId: currentUserId, userName: currentUserName } = auth;

    const {
      category,
      provider,
      environment = 'PRODUCTION',
      secret,
      webhookToken,
      accountName,
      passwordConfirmation,
      removeWebhookToken,
      monthlyBudgetLimitCents,
      monthlyUnitsLimit,
    } = req.body;

    if (!category || !provider) {
      res.status(400).json({ error: 'Campos obrigatórios: category e provider.' });
      return;
    }

    // Confirmação de senha estritamente obrigatória para operações com credenciais
    if (!passwordConfirmation || typeof passwordConfirmation !== 'string' || !passwordConfirmation.trim()) {
      res.status(401).json({ error: 'Senha de confirmação do administrador é obrigatória.' });
      return;
    }

    const userRecord = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { password: true },
    });
    if (!userRecord || !userRecord.password || !bcrypt.compareSync(passwordConfirmation.trim(), userRecord.password)) {
      res.status(401).json({ error: 'Senha de confirmação inválida.' });
      return;
    }

    // Validação estrita do catálogo de autoatendimento
    const catalogItem = COMPANY_SELF_SERVICE_CATALOG.find(
      (c) => c.category === category && c.supportedProviders.includes(provider)
    );
    if (!catalogItem) {
      res.status(400).json({
        error: `Provedor ${provider} não suportado para autoatendimento na categoria ${category}.`,
      });
      return;
    }

    const cleanEnv = environment === 'SANDBOX' ? 'SANDBOX' : 'PRODUCTION';
    if (!catalogItem.environments.includes(cleanEnv)) {
      res.status(400).json({
        error: `Ambiente ${cleanEnv} não permitido para este provedor.`,
      });
      return;
    }

    // Verificar se já existe integração para esta empresa / categoria / ambiente
    const existing = await prisma.companyIntegration.findUnique({
      where: {
        companyId_category_environment: {
          companyId,
          category,
          environment: cleanEnv,
        },
      },
    });

    // Se é criação nova, secret é obrigatório
    if (!existing && (!secret || typeof secret !== 'string' || !secret.trim())) {
      res.status(400).json({ error: 'Chave / secret é obrigatório para cadastrar uma nova integração.' });
      return;
    }

    // Parse de limites
    const parsedBudgetCents =
      monthlyBudgetLimitCents !== undefined
        ? (monthlyBudgetLimitCents !== null && String(monthlyBudgetLimitCents).trim() !== ''
            ? Number(monthlyBudgetLimitCents)
            : null)
        : existing?.monthlyBudgetLimitCents ?? null;

    const parsedUnitsLimit =
      monthlyUnitsLimit !== undefined
        ? (monthlyUnitsLimit !== null && String(monthlyUnitsLimit).trim() !== ''
            ? Number(monthlyUnitsLimit)
            : null)
        : existing?.monthlyUnitsLimit ?? null;

    const parsedAllowPaidOverage =
      req.body.allowPaidOverage !== undefined
        ? Boolean(req.body.allowPaidOverage)
        : existing?.allowPaidOverage ?? false;

    const parsedAuthorizedOverageUnits =
      req.body.authorizedOverageUnits !== undefined
        ? (req.body.authorizedOverageUnits !== null && String(req.body.authorizedOverageUnits).trim() !== ''
            ? Number(req.body.authorizedOverageUnits)
            : null)
        : existing?.authorizedOverageUnits ?? null;

    // Impor regras de isolamento no servidor
    const scope = catalogItem.supportedScopes[0]; // EXCLUSIVE_OWN_KEY ou COMPANY_EXCLUSIVE
    const costPayer = 'COMPANY';
    const credentialSource = 'VAULT_ENCRYPTED';

    const hasNewSecret = Boolean(secret && typeof secret === 'string' && secret.trim());
    const encrypted = hasNewSecret ? encryptSecret(secret.trim()) : null;
    const secretMasked = hasNewSecret ? maskSecret(secret.trim()) : existing?.secretMasked || null;

    // Metadados seguros e tratamento de webhook:
    const configMetadata: Record<string, any> = {
      accountName: accountName !== undefined ? (accountName ? String(accountName).trim() : undefined) : existing?.accountName || undefined,
      registeredByUserId: currentUserId,
      registeredAt: existing ? (existing.configMetadata as any)?.registeredAt || new Date().toISOString() : new Date().toISOString(),
      financialLiveAuthorized: false,
    };

    if (removeWebhookToken === true || req.body.webhookToken === '') {
      // Remoção explícita
      delete configMetadata.encryptedWebhookToken;
      delete configMetadata.webhookIv;
      delete configMetadata.webhookTag;
      delete configMetadata.webhookMasked;
    } else if (
      category === 'PAYMENT_GATEWAY' &&
      webhookToken &&
      typeof webhookToken === 'string' &&
      webhookToken.trim()
    ) {
      // Novo webhook configurado
      const encWh = encryptSecret(webhookToken.trim());
      configMetadata.encryptedWebhookToken = encWh.encryptedSecret;
      configMetadata.webhookIv = encWh.secretIv;
      configMetadata.webhookTag = encWh.secretTag;
      configMetadata.webhookMasked = maskSecret(webhookToken.trim());
    } else if (existing?.configMetadata) {
      // Preservar webhook e metadados anteriores
      const prevMeta = existing.configMetadata as Record<string, any>;
      if (prevMeta.encryptedWebhookToken && prevMeta.webhookIv && prevMeta.webhookTag) {
        configMetadata.encryptedWebhookToken = prevMeta.encryptedWebhookToken;
        configMetadata.webhookIv = prevMeta.webhookIv;
        configMetadata.webhookTag = prevMeta.webhookTag;
        configMetadata.webhookMasked = prevMeta.webhookMasked;
      }
    }

    // Gravação e auditoria transacionais
    const { saved } = await prisma.$transaction(async (tx) => {
      let record;
      if (existing) {
        const updateData: any = {
          provider,
          scope,
          costPayer,
          status: 'ACTIVE',
          accountName: accountName !== undefined ? (accountName ? String(accountName).trim() : null) : existing.accountName,
          configMetadata,
          version: existing.version + 1,
          updatedByUserId: currentUserId,
          monthlyBudgetLimitCents: parsedBudgetCents,
          monthlyUnitsLimit: parsedUnitsLimit,
          allowPaidOverage: parsedAllowPaidOverage,
          authorizedOverageUnits: parsedAuthorizedOverageUnits,
        };

        if (hasNewSecret && encrypted) {
          updateData.credentialSource = credentialSource;
          updateData.encryptedSecret = encrypted.encryptedSecret;
          updateData.secretIv = encrypted.secretIv;
          updateData.secretTag = encrypted.secretTag;
          updateData.secretMasked = secretMasked;
          updateData.lastValidationStatus = null;
          updateData.lastValidationError = null;
        }

        record = await tx.companyIntegration.update({
          where: { id: existing.id },
          data: updateData,
        });
      } else {
        record = await tx.companyIntegration.create({
          data: {
            companyId,
            category,
            provider,
            environment: cleanEnv,
            scope,
            costPayer,
            credentialSource,
            encryptedSecret: encrypted!.encryptedSecret,
            secretIv: encrypted!.secretIv,
            secretTag: encrypted!.secretTag,
            secretMasked,
            status: 'ACTIVE',
            accountName: accountName ? String(accountName).trim() : null,
            configMetadata,
            createdByUserId: currentUserId,
            version: 1,
            monthlyBudgetLimitCents: parsedBudgetCents,
            monthlyUnitsLimit: parsedUnitsLimit,
            allowPaidOverage: parsedAllowPaidOverage,
            authorizedOverageUnits: parsedAuthorizedOverageUnits,
          },
        });
      }

      await tx.integrationAuditEvent.create({
        data: {
          companyId,
          integrationId: record.id,
          action: existing ? 'COMPANY_INTEGRATION_UPDATE' : 'COMPANY_INTEGRATION_CREATE',
          authorUserId: currentUserId,
          authorName: currentUserName,
          details: JSON.stringify({
            category,
            provider,
            environment: cleanEnv,
            scope,
            costPayer,
            version: record.version,
            monthlyBudgetLimitCents: parsedBudgetCents,
            monthlyUnitsLimit: parsedUnitsLimit,
            hasNewSecret,
            hasWebhookToken: Boolean(configMetadata.encryptedWebhookToken),
          }),
          result: 'SUCCESS',
          ipAddress: (req.ip || req.socket.remoteAddress || 'unknown').substring(0, 45),
          userAgent: (req.headers['user-agent'] || 'unknown').substring(0, 255),
        },
      });

      return { saved: record };
    });

    const whSummary = extractWebhookSummary(saved.configMetadata);

    res.json({
      success: true,
      message: 'Integração configurada com sucesso.',
      integration: {
        id: saved.id,
        category: saved.category,
        provider: saved.provider,
        environment: saved.environment,
        scope: saved.scope,
        status: saved.status,
        costPayer: saved.costPayer,
        secretMasked: saved.secretMasked,
        hasWebhookToken: whSummary.hasWebhookToken,
        webhookMasked: whSummary.webhookMasked,
        accountName: saved.accountName,
        version: saved.version,
        monthlyBudgetLimitCents: saved.monthlyBudgetLimitCents,
        monthlyUnitsLimit: saved.monthlyUnitsLimit,
        updatedAt: saved.updatedAt,
      },
      liveProtected: (await isProductionSafetyLocked(companyId)).locked,
    });
  } catch (err: any) {
    console.error('Error saving company integration:', err);
    res.status(500).json({ error: `Erro ao salvar integração: ${err.message}` });
  }
});

/**
 * PATCH / PUT /api/company/integrations/:id/limits
 * Atualiza exclusivamente limites de requisições, orçamento em reais e autorização de excedente.
 */
const updateIntegrationLimitsHandler = async (req: AuthRequest, res: Response) => {
  try {
    const auth = await authorizeCompanyAdmin(req, res);
    if (!auth) return;

    const { companyId, userId: currentUserId, userName: currentUserName } = auth;
    const id = String(req.params.id);
    const { monthlyBudgetLimitCents, monthlyUnitsLimit, passwordConfirmation } = req.body;

    if (!passwordConfirmation || typeof passwordConfirmation !== 'string' || !passwordConfirmation.trim()) {
      res.status(401).json({ error: 'Senha de confirmação do administrador é obrigatória.' });
      return;
    }

    const userRecord = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { password: true },
    });
    if (!userRecord || !userRecord.password || !bcrypt.compareSync(passwordConfirmation.trim(), userRecord.password)) {
      res.status(401).json({ error: 'Senha de confirmação inválida.' });
      return;
    }

    const existing = await prisma.companyIntegration.findFirst({
      where: { id, companyId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Integração não encontrada para esta empresa.' });
      return;
    }

    const parsedBudgetCents =
      monthlyBudgetLimitCents !== undefined
        ? (monthlyBudgetLimitCents !== null && String(monthlyBudgetLimitCents).trim() !== ''
            ? Number(monthlyBudgetLimitCents)
            : null)
        : existing.monthlyBudgetLimitCents;

    const parsedUnitsLimit =
      monthlyUnitsLimit !== undefined
        ? (monthlyUnitsLimit !== null && String(monthlyUnitsLimit).trim() !== ''
            ? Number(monthlyUnitsLimit)
            : null)
        : existing.monthlyUnitsLimit;

    const parsedAllowPaidOverage =
      req.body.allowPaidOverage !== undefined
        ? Boolean(req.body.allowPaidOverage)
        : existing.allowPaidOverage;

    const parsedAuthorizedOverageUnits =
      req.body.authorizedOverageUnits !== undefined
        ? (req.body.authorizedOverageUnits !== null && String(req.body.authorizedOverageUnits).trim() !== ''
            ? Number(req.body.authorizedOverageUnits)
            : null)
        : existing.authorizedOverageUnits;

    const updated = await prisma.$transaction(async (tx) => {
      const rec = await tx.companyIntegration.update({
        where: { id: existing.id },
        data: {
          monthlyBudgetLimitCents: parsedBudgetCents,
          monthlyUnitsLimit: parsedUnitsLimit,
          allowPaidOverage: parsedAllowPaidOverage,
          authorizedOverageUnits: parsedAuthorizedOverageUnits,
          updatedByUserId: currentUserId,
          version: existing.version + 1,
        },
      });

      await tx.integrationAuditEvent.create({
        data: {
          companyId,
          integrationId: rec.id,
          action: 'COMPANY_INTEGRATION_LIMITS_UPDATE',
          authorUserId: currentUserId,
          authorName: currentUserName,
          details: JSON.stringify({
            monthlyBudgetLimitCents: parsedBudgetCents,
            monthlyUnitsLimit: parsedUnitsLimit,
            allowPaidOverage: parsedAllowPaidOverage,
            authorizedOverageUnits: parsedAuthorizedOverageUnits,
            previousBudgetCents: existing.monthlyBudgetLimitCents,
            previousUnitsLimit: existing.monthlyUnitsLimit,
            previousAllowPaidOverage: existing.allowPaidOverage,
            previousAuthorizedOverageUnits: existing.authorizedOverageUnits,
          }),
          result: 'SUCCESS',
          ipAddress: (req.ip || req.socket.remoteAddress || 'unknown').substring(0, 45),
          userAgent: (req.headers['user-agent'] || 'unknown').substring(0, 255),
        },
      });

      return rec;
    });

    res.json({
      success: true,
      message: 'Limites atualizados com sucesso.',
      monthlyBudgetLimitCents: updated.monthlyBudgetLimitCents,
      monthlyUnitsLimit: updated.monthlyUnitsLimit,
      allowPaidOverage: updated.allowPaidOverage,
      authorizedOverageUnits: updated.authorizedOverageUnits,
    });
  } catch (err: any) {
    console.error('Error updating company integration limits:', err);
    res.status(500).json({ error: `Erro ao atualizar limites: ${err.message}` });
  }
};

router.patch('/:id/limits', authenticateToken, updateIntegrationLimitsHandler);
router.put('/:id/limits', authenticateToken, updateIntegrationLimitsHandler);

/**
 * DELETE /api/company/integrations/:id
 * Remove uma credencial de integração pertencente à empresa do admin autenticado.
 * Exige confirmação de senha do administrador autenticado e auditoria transacional persistente.
 */
router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const auth = await authorizeCompanyAdmin(req, res);
    if (!auth) return;

    const { companyId, userId: currentUserId, userName: currentUserName } = auth;
    const id = String(req.params.id);

    // Confirmação de senha obrigatória (recebida no body JSON ou header)
    const passwordConfirmation =
      req.body?.passwordConfirmation || (req.headers['x-password-confirmation'] as string);

    if (!passwordConfirmation || typeof passwordConfirmation !== 'string' || !passwordConfirmation.trim()) {
      res.status(401).json({
        error: 'Senha de confirmação do administrador é obrigatória para remoção de credenciais.',
      });
      return;
    }

    const userRecord = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { password: true },
    });
    if (!userRecord || !userRecord.password || !bcrypt.compareSync(passwordConfirmation.trim(), userRecord.password)) {
      res.status(401).json({ error: 'Senha de confirmação inválida.' });
      return;
    }

    const existing = await prisma.companyIntegration.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      res.status(404).json({ error: 'Integração não encontrada para esta empresa.' });
      return;
    }

    // Exclusão e auditoria transacionais: registra auditoria com integraçãoId nulo e dados no details
    await prisma.$transaction(async (tx) => {
      await tx.integrationAuditEvent.create({
        data: {
          companyId,
          integrationId: null, // Mantém nulo para sobreviver com integridade relacional
          action: 'COMPANY_INTEGRATION_DELETE',
          authorUserId: currentUserId,
          authorName: currentUserName,
          details: JSON.stringify({
            deletedIntegrationId: existing.id,
            category: existing.category,
            provider: existing.provider,
            environment: existing.environment,
            scope: existing.scope,
            costPayer: existing.costPayer,
            accountName: existing.accountName,
            version: existing.version,
          }),
          result: 'SUCCESS',
          ipAddress: (req.ip || req.socket.remoteAddress || 'unknown').substring(0, 45),
          userAgent: (req.headers['user-agent'] || 'unknown').substring(0, 255),
        },
      });

      await tx.companyIntegration.delete({
        where: { id: existing.id },
      });
    });

    res.json({ success: true, message: 'Integração removida com sucesso.' });
  } catch (err: any) {
    console.error('Error deleting company integration:', err);
    res.status(500).json({ error: `Erro ao remover integração: ${err.message}` });
  }
});

/**
 * POST /api/company/integrations/:id/test
 * Testa a conectividade da integração da empresa utilizando adaptadores oficiais.
 * Respeita estritamente o ambiente (SANDBOX vs PRODUCTION) e as travas LIVE.
 */
router.post('/:id/test', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const auth = await authorizeCompanyAdmin(req, res);
    if (!auth) return;

    const { companyId } = auth;
    const id = String(req.params.id);

    const integration = await prisma.companyIntegration.findFirst({
      where: { id, companyId },
    });

    if (!integration) {
      res.status(404).json({ error: 'Integração não encontrada para esta empresa.' });
      return;
    }

    if (!integration.encryptedSecret || !integration.secretIv || !integration.secretTag) {
      res.status(400).json({ error: 'Credencial incompleta ou não encontrada no cofre.' });
      return;
    }

    const plainSecret = decryptSecret(
      integration.encryptedSecret,
      integration.secretIv,
      integration.secretTag
    );

    let testResult: { success: boolean; message: string; details?: any } = {
      success: false,
      message: 'Provedor sem teste operacional disponível.',
    };

    if (integration.provider === 'GEMINI') {
      testResult = await testGeminiConnection(plainSecret);
    } else if (integration.provider === 'ASAAS') {
      if (integration.environment === 'SANDBOX') {
        testResult = await testAsaasSandboxConnection(plainSecret);
      } else {
        // Ambiente de Produção: respeitar travas de segurança da plataforma
        const prodSafety = await isProductionSafetyLocked(companyId);
        if (prodSafety.locked) {
          testResult = {
            success: false,
            message:
              'Operações financeiras LIVE em Produção estão bloqueadas pelas políticas de segurança da plataforma. O teste ativo não foi executado.',
            details: {
              environment: 'PRODUCTION',
              productionSafetyLocked: true,
              reason:
                prodSafety.reason ||
                'Etapa 4 em modo de homologação segura; operações Asaas LIVE não autorizadas.',
            },
          };
        } else {
          // Quando não bloqueado, validação sintática estrita sem disparar cobranças reais
          const isValidFormat = plainSecret.startsWith('$aact_') || plainSecret.length >= 32;
          testResult = {
            success: isValidFormat,
            message: isValidFormat
              ? 'Chave de produção Asaas verificada sintaticamente sem disparo de cobrança real.'
              : 'Formato da chave de produção Asaas inválido (esperado token iniciando com $aact_).',
            details: { environment: 'PRODUCTION', formatValid: isValidFormat },
          };
        }
      }
    } else if (integration.provider === 'META_WHATSAPP') {
      testResult = await testMetaWhatsAppConnection(plainSecret);
    } else {
      testResult = {
        success: false,
        message: `Provedor ${integration.provider} não possui adaptador de teste configurado.`,
      };
    }

    await prisma.companyIntegration.update({
      where: { id: integration.id },
      data: {
        lastValidatedAt: new Date(),
        lastValidationStatus: testResult.success ? 'SUCCESS' : 'FAILED',
        lastValidationError: testResult.success ? null : testResult.message,
      },
    });

    res.json({
      success: testResult.success,
      message: testResult.message,
      details: testResult.details || null,
      lastValidatedAt: new Date(),
    });
  } catch (err: any) {
    console.error('Error testing company integration:', err);
    res.status(500).json({ error: `Erro ao testar integração: ${err.message}` });
  }
});

/**
 * POST /api/company/integrations/reservations/:id/resolve
 * Trata resposta tardia para resolver status pendente de reserva (PENDING_CONFIRMATION ou RESERVED).
 */
router.post('/reservations/:id/resolve', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const auth = await authorizeCompanyAdmin(req, res);
    if (!auth) return;

    const { id } = req.params;
    const { outcome, measuredCostCents, evidence, reason, simulateAuditFailure } = req.body || {};

    if (!outcome || !['CONFIRMED', 'RELEASED'].includes(outcome)) {
      res.status(400).json({ error: 'Parâmetro outcome deve ser "CONFIRMED" ou "RELEASED".' });
      return;
    }

    const reservation = await prisma.apiUsageRecord.findUnique({
      where: { id: String(id) },
    });
    if (!reservation) {
      res.status(404).json({ error: 'Reserva não encontrada.' });
      return;
    }

    if (auth.role !== 'SUPER_ADMIN' && auth.companyId !== reservation.companyId) {
      res.status(403).json({ error: 'Acesso negado à reserva desta empresa.' });
      return;
    }

    const result = await resolvePendingReservation({
      reservationId: String(id),
      outcome,
      measuredCostCents,
      evidence,
      reason,
      resolvedByUserId: auth.userId,
      resolvedByName: auth.userName,
      simulateAuditFailure: simulateAuditFailure || req.headers['x-mock-simulate-audit-failure'] === 'true',
    });

    res.json(result);
  } catch (err: any) {
    const status = err.statusCode || err.status || 400;
    res.status(status).json({ error: err.message || 'Erro ao resolver reserva pendente.', code: err.code });
  }
});

export default router;
