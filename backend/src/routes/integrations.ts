import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import {
  authenticateToken,
  requireCapability,
  requireStepUpAuth,
  AuthRequest,
} from '../middleware/authMiddleware';
import {
  encryptSecret,
  maskSecret,
  decryptSecret,
  isAllowedEnvVarForIntegration,
} from '../services/vaultService';
import {
  testGeminiConnection,
  testViaCepConnection,
  testAsaasSandboxConnection,
  testMetaWhatsAppConnection,
  testGrokConnection,
} from '../services/integrationAdapters';
import {
  runAsaasSandboxHarness,
  checkHomologationTargetSafety,
} from '../services/asaasSandboxHarness';
import { lookupViaCep } from '../services/integrationResolver';
import { isProductionSafetyLocked } from '../services/asaasService';

const router = Router();
const prisma = new PrismaClient();

// ── Definições do Catálogo Oficial de Integrações ────────────────────────────

export const INTEGRATION_CATALOG = [
  {
    category: 'AI_RESEARCH',
    label: 'Inteligência Artificial (Pesquisa Comercial de Eventos)',
    supportedProviders: ['GEMINI', 'GROK'],
    scopes: ['PLATFORM_SHARED', 'SHARED_CONTROLLED', 'EXCLUSIVE_OWN_KEY'],
    defaultScope: 'SHARED_CONTROLLED',
    defaultCostPayer: 'PLATFORM',
    changeApplicability: 'DYNAMIC',
    description:
      'Varredura inteligente e radar de eventos em cidades de atuação. Pode operar em pool compartilhado ou com chave própria.',
  },
  {
    category: 'PAYMENT_GATEWAY',
    label: 'Gateway de Pagamentos e Boletos (Asaas)',
    supportedProviders: ['ASAAS'],
    scopes: ['COMPANY_EXCLUSIVE'],
    defaultScope: 'COMPANY_EXCLUSIVE',
    defaultCostPayer: 'COMPANY',
    changeApplicability: 'DYNAMIC',
    description:
      'Conta bancária e conciliação financeira exclusiva por empresa. Proibido fallback ou compartilhamento silencioso.',
  },
  {
    category: 'MESSAGING',
    label: 'Comunicação e WhatsApp Empresarial',
    supportedProviders: ['META_WHATSAPP'],
    scopes: ['COMPANY_EXCLUSIVE'],
    defaultScope: 'COMPANY_EXCLUSIVE',
    defaultCostPayer: 'COMPANY',
    changeApplicability: 'DYNAMIC',
    description:
      'Envios corporativos sob número e identidade próprios da empresa contratante.',
  },
  {
    category: 'GEO_LOCATION',
    label: 'Consulta de Endereço e CEP (ViaCEP)',
    supportedProviders: ['VIACEP'],
    scopes: ['PLATFORM_SHARED'],
    defaultScope: 'PLATFORM_SHARED',
    defaultCostPayer: 'PLATFORM',
    changeApplicability: 'DYNAMIC',
    description:
      'Serviço compartilhado da plataforma com cache em memória e conformidade com limites de requisições.',
  },
];

// Helper para registrar auditoria de integração
async function logIntegrationAudit(data: {
  companyId: string;
  integrationId?: string | null;
  action: string;
  authorUserId: string;
  authorName: string;
  details: Record<string, any>;
  result?: string;
  req: AuthRequest;
}) {
  try {
    await prisma.integrationAuditEvent.create({
      data: {
        companyId: data.companyId,
        integrationId: data.integrationId || null,
        action: data.action,
        authorUserId: data.authorUserId,
        authorName: data.authorName,
        details: JSON.stringify(data.details),
        result: data.result || 'SUCCESS',
        ipAddress: (data.req.ip || data.req.socket.remoteAddress || 'unknown').substring(0, 45),
        userAgent: (data.req.headers['user-agent'] || 'unknown').substring(0, 255),
      },
    });
  } catch (err) {
    console.error('[IntegrationsRoute] Falha ao registrar auditoria de integração:', err);
  }
}

/**
 * Remove estritamente qualquer atributo de segredo de webhook dos metadados comuns.
 * O estado mascarado (webhookMasked / hasWebhookToken) é exposto apenas na raiz do objeto sanitizado.
 */
function sanitizeIntegrationMetadata(configMetadata: any): Record<string, any> {
  if (!configMetadata || typeof configMetadata !== 'object') return {};
  const {
    encryptedWebhookToken,
    webhookIv,
    webhookTag,
    webhookMasked,
    webhookToken,
    ...safeMetadata
  } = configMetadata;
  return safeMetadata;
}

function extractWebhookSummary(configMetadata: any): {
  hasWebhookToken: boolean;
  webhookMasked: string | null;
} {
  if (!configMetadata || typeof configMetadata !== 'object') {
    return { hasWebhookToken: false, webhookMasked: null };
  }
  const hasWebhookToken = Boolean(
    (configMetadata.encryptedWebhookToken && configMetadata.webhookIv && configMetadata.webhookTag) ||
      configMetadata.webhookToken
  );
  const webhookMasked = configMetadata.webhookMasked
    ? String(configMetadata.webhookMasked)
    : configMetadata.webhookToken
      ? maskSecret(String(configMetadata.webhookToken))
      : null;
  return { hasWebhookToken, webhookMasked };
}

// ── Rotas Públicas/Compartilhadas de Utilidade ───────────────────────────────

/**
 * GET /api/owner/integrations/catalogs
 * Retorna o catálogo oficial de provedores e categorias suportadas
 */
router.get('/catalogs', authenticateToken, async (_req: AuthRequest, res: Response) => {
  res.json({ catalogs: INTEGRATION_CATALOG });
});

/**
 * GET /api/owner/integrations/cep/:cep
 * Consulta ViaCEP com cache centralizado
 */
router.get('/cep/:cep', authenticateToken, async (req: AuthRequest, res: Response) => {
  const cleanCep = String(req.params.cep || '');
  const result = await lookupViaCep(cleanCep);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result);
});

// ── Rotas do Painel do Proprietário (Requer INTEGRATION_CONFIG) ───────────────

/**
 * GET /api/owner/integrations/companies/:companyId
 * Lista integrações de uma empresa específica
 */
router.get(
  '/companies/:companyId',
  authenticateToken,
  requireCapability('INTEGRATION_CONFIG'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = String(req.params.companyId);
      const integrations = await prisma.companyIntegration.findMany({
        where: { companyId },
        orderBy: [{ category: 'asc' }, { environment: 'asc' }],
        select: {
          id: true,
          companyId: true,
          category: true,
          provider: true,
          scope: true,
          status: true,
          environment: true,
          accountName: true,
          costPayer: true,
          changeApplicability: true,
          credentialSource: true,
          secretMasked: true,
          envVarName: true,
          configMetadata: true,
          version: true,
          monthlyBudgetLimitCents: true,
          monthlyUnitsLimit: true,
          lastValidatedAt: true,
          lastValidationStatus: true,
          lastValidationError: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      const sanitizedIntegrations = integrations.map((i) => {
        const wh = extractWebhookSummary(i.configMetadata);
        return {
          ...i,
          hasWebhookToken: wh.hasWebhookToken,
          webhookMasked: wh.webhookMasked,
          configMetadata: sanitizeIntegrationMetadata(i.configMetadata),
        };
      });

      res.json({ integrations: sanitizedIntegrations });
    } catch (err: any) {
      res.status(500).json({ error: `Erro ao buscar integrações: ${err.message}` });
    }
  }
);

/**
 * GET /api/owner/integrations/:id
 * Busca detalhes de uma integração (com auditoria recente e métricas de consumo)
 */
router.get(
  '/:id',
  authenticateToken,
  requireCapability('INTEGRATION_CONFIG'),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id);
      const integration = await prisma.companyIntegration.findUnique({
        where: { id },
        select: {
          id: true,
          companyId: true,
          category: true,
          provider: true,
          scope: true,
          status: true,
          environment: true,
          accountName: true,
          costPayer: true,
          changeApplicability: true,
          credentialSource: true,
          secretMasked: true,
          envVarName: true,
          configMetadata: true,
          version: true,
          monthlyBudgetLimitCents: true,
          monthlyUnitsLimit: true,
          lastValidatedAt: true,
          lastValidationStatus: true,
          lastValidationError: true,
          createdAt: true,
          updatedAt: true,
          company: {
            select: { id: true, name: true, legalName: true },
          },
          auditEvents: {
            take: 10,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              action: true,
              authorName: true,
              details: true,
              result: true,
              createdAt: true,
            },
          },
        },
      });

      if (!integration) {
        res.status(404).json({ error: 'Integração não encontrada.' });
        return;
      }

      const wh = extractWebhookSummary(integration.configMetadata);
      const sanitized = {
        ...integration,
        hasWebhookToken: wh.hasWebhookToken,
        webhookMasked: wh.webhookMasked,
        configMetadata: sanitizeIntegrationMetadata(integration.configMetadata),
      };

      res.json({ integration: sanitized });
    } catch (err: any) {
      res.status(500).json({ error: `Erro ao buscar integração: ${err.message}` });
    }
  }
);

/**
 * POST /api/owner/integrations
 * Cadastra uma nova integração para uma empresa (exige Step-Up Auth e estado inicial não financeiro)
 */
router.post(
  '/',
  authenticateToken,
  requireCapability('INTEGRATION_CONFIG'),
  requireStepUpAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        companyId,
        category,
        provider,
        scope,
        environment = 'PRODUCTION',
        accountName,
        costPayer,
        changeApplicability = 'DYNAMIC',
        credentialSource = 'VAULT_ENCRYPTED',
        plainSecret,
        envVarName,
        monthlyBudgetLimitCents,
        monthlyUnitsLimit,
      } = req.body;

      if (!companyId || !category || !provider || !scope) {
        res.status(400).json({ error: 'Campos obrigatórios: companyId, category, provider, scope.' });
        return;
      }

      const catalogItem = INTEGRATION_CATALOG.find((c) => c.category === category);
      if (!catalogItem || !catalogItem.supportedProviders.includes(provider)) {
        res.status(400).json({ error: `Provedor ${provider} não suportado para a categoria ${category}.` });
        return;
      }

      if (!catalogItem.scopes.includes(scope)) {
        res.status(400).json({
          error: `Escopo '${scope}' inválido para a categoria ${category}. Permitidos: ${catalogItem.scopes.join(', ')}.`,
        });
        return;
      }

      if (!['PRODUCTION', 'SANDBOX'].includes(environment)) {
        res.status(400).json({ error: 'Ambiente inválido. Permitidos: PRODUCTION, SANDBOX.' });
        return;
      }

      const resolvedCostPayer = costPayer || catalogItem.defaultCostPayer || 'COMPANY';
      if (!['COMPANY', 'PLATFORM'].includes(resolvedCostPayer)) {
        res.status(400).json({ error: 'Titularidade de custo (costPayer) inválida. Permitidos: COMPANY, PLATFORM.' });
        return;
      }

      if (req.body.financialLiveAuthorized === true) {
        res.status(403).json({
          error: 'Autorização financeira LIVE não pode ser concedida no cadastro da credencial.',
        });
        return;
      }

      const duplicate = await prisma.companyIntegration.findUnique({
        where: {
          companyId_category_environment: {
            companyId: String(companyId),
            category: String(category),
            environment: String(environment),
          },
        },
        select: { id: true },
      });
      if (duplicate) {
        res.status(409).json({
          error: `Já existe uma integração ${category} (${environment}) cadastrada para esta empresa. Utilize a edição ou rotação de credenciais.`,
        });
        return;
      }

      // Preservação estrita de limite zero e validação de inteiros não-negativos
      let parsedBudgetLimitCents: number | null = null;
      if (
        monthlyBudgetLimitCents !== undefined &&
        monthlyBudgetLimitCents !== null &&
        String(monthlyBudgetLimitCents).trim() !== ''
      ) {
        const num = Number(monthlyBudgetLimitCents);
        if (!Number.isInteger(num) || num < 0) {
          res.status(400).json({ error: 'monthlyBudgetLimitCents deve ser um número inteiro maior ou igual a zero.' });
          return;
        }
        parsedBudgetLimitCents = num;
      }

      let parsedUnitsLimit: number | null = null;
      if (
        monthlyUnitsLimit !== undefined &&
        monthlyUnitsLimit !== null &&
        String(monthlyUnitsLimit).trim() !== ''
      ) {
        const num = Number(monthlyUnitsLimit);
        if (!Number.isInteger(num) || num < 0) {
          res.status(400).json({ error: 'monthlyUnitsLimit deve ser um número inteiro maior ou igual a zero.' });
          return;
        }
        parsedUnitsLimit = num;
      }

      let encryptedSecret: string | null = null;
      let secretIv: string | null = null;
      let secretTag: string | null = null;
      let secretMasked: string | null = null;
      let validatedEnvVarName: string | null = null;

      if (credentialSource === 'VAULT_ENCRYPTED') {
        if (plainSecret && String(plainSecret).trim().length > 0) {
          const cleanSecret = String(plainSecret).trim();
          const encrypted = encryptSecret(cleanSecret);
          encryptedSecret = encrypted.encryptedSecret;
          secretIv = encrypted.secretIv;
          secretTag = encrypted.secretTag;
          secretMasked = maskSecret(cleanSecret);
        }
      } else if (credentialSource === 'ENV_REFERENCE') {
        const trimmedVarName = envVarName ? String(envVarName).trim() : '';
        const envCheck = isAllowedEnvVarForIntegration({
          varName: trimmedVarName,
          category,
          provider,
          environment,
        });
        if (!trimmedVarName || !envCheck.allowed) {
          res.status(400).json({
            error:
              envCheck.reason ||
              `Referência de variável de ambiente '${trimmedVarName}' inválida ou não autorizada para ${provider} (${category}/${environment}).`,
          });
          return;
        }

        if (
          (scope === 'COMPANY_EXCLUSIVE' || scope === 'EXCLUSIVE_OWN_KEY') &&
          (!accountName || !String(accountName).trim())
        ) {
          res.status(400).json({
            error:
              'Referência de variável de infraestrutura para escopo exclusivo exige identificação explícita da conta vinculada (accountName).',
          });
          return;
        }

        validatedEnvVarName = trimmedVarName;
      } else if (credentialSource !== 'NONE') {
        res.status(400).json({
          error: 'credentialSource inválido. Permitidos: VAULT_ENCRYPTED, ENV_REFERENCE, NONE.',
        });
        return;
      }

      // Regra: Novas configurações bancárias SEMPRE iniciam desativadas/aguardando validação (estado não financeiro)
      const requestedNonFinancialStatus =
        req.body.status && ['ACTIVE', 'DISABLED', 'TESTING'].includes(req.body.status)
          ? req.body.status
          : 'ACTIVE';
      const initialStatus = category === 'PAYMENT_GATEWAY' ? 'DISABLED' : requestedNonFinancialStatus;

      const configMetadata: Record<string, any> = {
        financialLiveAuthorized: false, // Faturamento LIVE permanece estritamente bloqueado no cadastro
        allowSharedPool:
          category !== 'PAYMENT_GATEWAY' && category !== 'MESSAGING' && req.body.allowSharedPool === true,
      };

      if (req.body.walletId && String(req.body.walletId).trim()) {
        configMetadata.walletId = String(req.body.walletId).trim();
      }

      if (req.body.plainWebhookToken && String(req.body.plainWebhookToken).trim()) {
        const trimmedWebhook = String(req.body.plainWebhookToken).trim();
        const encryptedWebhook = encryptSecret(trimmedWebhook);
        configMetadata.encryptedWebhookToken = encryptedWebhook.encryptedSecret;
        configMetadata.webhookIv = encryptedWebhook.secretIv;
        configMetadata.webhookTag = encryptedWebhook.secretTag;
        configMetadata.webhookMasked = maskSecret(trimmedWebhook);
      }

      const created = await prisma.companyIntegration.create({
        data: {
          companyId,
          category,
          provider,
          scope,
          environment,
          status: initialStatus,
          accountName: accountName ? String(accountName).trim() : null,
          costPayer: resolvedCostPayer,
          changeApplicability,
          credentialSource,
          encryptedSecret,
          secretIv,
          secretTag,
          secretMasked,
          envVarName: validatedEnvVarName,
          configMetadata,
          monthlyBudgetLimitCents: parsedBudgetLimitCents,
          monthlyUnitsLimit: parsedUnitsLimit,
          lastValidationStatus: 'PENDING',
          createdByUserId: req.user!.id,
        },
      });

      await logIntegrationAudit({
        companyId,
        integrationId: created.id,
        action: 'CREATE',
        authorUserId: req.user!.id,
        authorName: req.user!.name || 'Super Admin',
        details: {
          category,
          provider,
          scope,
          environment,
          status: initialStatus,
          costPayer: resolvedCostPayer,
          accountName: created.accountName,
          credentialSource,
          hasSecret: Boolean(encryptedSecret),
          hasWebhookToken: Boolean(configMetadata.encryptedWebhookToken),
          monthlyBudgetLimitCents: parsedBudgetLimitCents,
          monthlyUnitsLimit: parsedUnitsLimit,
        },
        req,
      });

      const wh = extractWebhookSummary(configMetadata);
      res.status(201).json({
        integration: {
          id: created.id,
          companyId: created.companyId,
          category: created.category,
          provider: created.provider,
          scope: created.scope,
          status: created.status,
          environment: created.environment,
          accountName: created.accountName,
          costPayer: created.costPayer,
          credentialSource: created.credentialSource,
          envVarName: created.envVarName,
          secretMasked: created.secretMasked,
          hasWebhookToken: wh.hasWebhookToken,
          webhookMasked: wh.webhookMasked,
          configMetadata: sanitizeIntegrationMetadata(configMetadata),
          version: created.version,
          monthlyBudgetLimitCents: created.monthlyBudgetLimitCents,
          monthlyUnitsLimit: created.monthlyUnitsLimit,
          lastValidationStatus: created.lastValidationStatus,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: `Falha ao cadastrar integração: ${err.message}` });
    }
  }
);

/**
 * PUT /api/owner/integrations/:id
 * Atualiza parâmetros não secretos e segredo de webhook (exige Step-Up Auth e auditoria)
 */
router.put(
  '/:id',
  authenticateToken,
  requireCapability('INTEGRATION_CONFIG'),
  requireStepUpAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id);
      const existing = await prisma.companyIntegration.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: 'Integração não encontrada.' });
        return;
      }

      if (req.body.financialLiveAuthorized === true) {
        res.status(403).json({
          error: 'Habilitação financeira LIVE exige fluxo específico autorizado e permanece bloqueada nesta etapa.',
        });
        return;
      }

      const catalogItem = INTEGRATION_CATALOG.find((c) => c.category === existing.category);
      const updates: any = {};
      const changes: Record<string, any> = {};

      if (req.body.accountName !== undefined) {
        updates.accountName = req.body.accountName ? String(req.body.accountName).trim() : null;
        changes.accountName = updates.accountName;
      }

      if (req.body.scope !== undefined) {
        if (catalogItem && !catalogItem.scopes.includes(req.body.scope)) {
          res.status(400).json({
            error: `Escopo '${req.body.scope}' inválido para ${existing.category}.`,
          });
          return;
        }
        updates.scope = req.body.scope;
        changes.scope = updates.scope;
      }

      if (req.body.costPayer !== undefined) {
        if (!['COMPANY', 'PLATFORM'].includes(req.body.costPayer)) {
          res.status(400).json({ error: 'costPayer inválido. Permitidos: COMPANY, PLATFORM.' });
          return;
        }
        updates.costPayer = req.body.costPayer;
        changes.costPayer = updates.costPayer;
      }

      if (req.body.envVarName !== undefined && existing.credentialSource === 'ENV_REFERENCE') {
        const trimmedVarName = req.body.envVarName ? String(req.body.envVarName).trim() : '';
        const envCheck = isAllowedEnvVarForIntegration({
          varName: trimmedVarName,
          category: existing.category,
          provider: existing.provider,
          environment: existing.environment,
        });
        if (!trimmedVarName || !envCheck.allowed) {
          res.status(400).json({
            error:
              envCheck.reason ||
              `Variável de ambiente '${trimmedVarName}' não autorizada para ${existing.provider}.`,
          });
          return;
        }
        updates.envVarName = trimmedVarName;
        changes.envVarName = trimmedVarName;
      }

      if (req.body.monthlyBudgetLimitCents !== undefined) {
        if (req.body.monthlyBudgetLimitCents === null || String(req.body.monthlyBudgetLimitCents).trim() === '') {
          updates.monthlyBudgetLimitCents = null;
        } else {
          const num = Number(req.body.monthlyBudgetLimitCents);
          if (!Number.isInteger(num) || num < 0) {
            res.status(400).json({ error: 'monthlyBudgetLimitCents deve ser um número inteiro maior ou igual a zero.' });
            return;
          }
          updates.monthlyBudgetLimitCents = num;
        }
        changes.monthlyBudgetLimitCents = updates.monthlyBudgetLimitCents;
      }

      if (req.body.monthlyUnitsLimit !== undefined) {
        if (req.body.monthlyUnitsLimit === null || String(req.body.monthlyUnitsLimit).trim() === '') {
          updates.monthlyUnitsLimit = null;
        } else {
          const num = Number(req.body.monthlyUnitsLimit);
          if (!Number.isInteger(num) || num < 0) {
            res.status(400).json({ error: 'monthlyUnitsLimit deve ser um número inteiro maior ou igual a zero.' });
            return;
          }
          updates.monthlyUnitsLimit = num;
        }
        changes.monthlyUnitsLimit = updates.monthlyUnitsLimit;
      }

      // Atualização segura de configMetadata
      const currentMetadata: Record<string, any> = { ...((existing.configMetadata as any) || {}) };
      let metadataChanged = false;

      if (req.body.allowSharedPool !== undefined) {
        currentMetadata.allowSharedPool =
          existing.category !== 'PAYMENT_GATEWAY' &&
          existing.category !== 'MESSAGING' &&
          req.body.allowSharedPool === true;
        metadataChanged = true;
        changes.allowSharedPool = currentMetadata.allowSharedPool;
      }

      if (req.body.walletId !== undefined) {
        currentMetadata.walletId = req.body.walletId ? String(req.body.walletId).trim() : null;
        metadataChanged = true;
        changes.walletId = currentMetadata.walletId;
      }

      if (req.body.operationalFinancialMode !== undefined && existing.category === 'PAYMENT_GATEWAY') {
        if (req.body.operationalFinancialMode === null || req.body.operationalFinancialMode === '') {
          delete currentMetadata.operationalFinancialMode;
          metadataChanged = true;
          changes.operationalFinancialMode = null;
        } else if (req.body.operationalFinancialMode === 'SANDBOX' && existing.environment === 'SANDBOX') {
          currentMetadata.operationalFinancialMode = 'SANDBOX';
          metadataChanged = true;
          changes.operationalFinancialMode = 'SANDBOX';
        } else {
          res.status(400).json({
            error: 'operationalFinancialMode inválido. Apenas SANDBOX explícito em integração SANDBOX ou null são permitidos nesta etapa.',
          });
          return;
        }
      }

      if (req.body.plainWebhookToken && String(req.body.plainWebhookToken).trim()) {
        const trimmed = String(req.body.plainWebhookToken).trim();
        const encWebhook = encryptSecret(trimmed);
        currentMetadata.encryptedWebhookToken = encWebhook.encryptedSecret;
        currentMetadata.webhookIv = encWebhook.secretIv;
        currentMetadata.webhookTag = encWebhook.secretTag;
        currentMetadata.webhookMasked = maskSecret(trimmed);
        delete currentMetadata.webhookToken;
        metadataChanged = true;
        changes.webhookTokenUpdated = true;
      }

      if (metadataChanged) {
        updates.configMetadata = currentMetadata;
      }

      updates.updatedByUserId = req.user!.id;

      const updated = await prisma.companyIntegration.update({
        where: { id },
        data: updates,
      });

      await logIntegrationAudit({
        companyId: existing.companyId,
        integrationId: existing.id,
        action: 'UPDATE_METADATA',
        authorUserId: req.user!.id,
        authorName: req.user!.name || 'Super Admin',
        details: changes,
        req,
      });

      const wh = extractWebhookSummary(updated.configMetadata);
      res.json({
        integration: {
          id: updated.id,
          companyId: updated.companyId,
          category: updated.category,
          provider: updated.provider,
          scope: updated.scope,
          status: updated.status,
          environment: updated.environment,
          accountName: updated.accountName,
          costPayer: updated.costPayer,
          monthlyBudgetLimitCents: updated.monthlyBudgetLimitCents,
          monthlyUnitsLimit: updated.monthlyUnitsLimit,
          hasWebhookToken: wh.hasWebhookToken,
          webhookMasked: wh.webhookMasked,
          configMetadata: sanitizeIntegrationMetadata(updated.configMetadata),
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: `Falha ao atualizar parâmetros da integração: ${err.message}` });
    }
  }
);

/**
 * POST /api/owner/integrations/:id/credentials
 * Salva ou rotaciona a credencial criptografada no Vault (exige Step-Up Auth)
 */
router.post(
  '/:id/credentials',
  authenticateToken,
  requireCapability('INTEGRATION_CONFIG'),
  requireStepUpAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { plainSecret, reason } = req.body;
      if (!plainSecret || typeof plainSecret !== 'string' || !plainSecret.trim()) {
        res.status(400).json({ error: 'Credencial (plainSecret) é obrigatória.' });
        return;
      }

      const id = String(req.params.id);
      const integration = await prisma.companyIntegration.findUnique({
        where: { id },
      });

      if (!integration) {
        res.status(404).json({ error: 'Integração não encontrada.' });
        return;
      }

      const cleanSecret = plainSecret.trim();
      const encrypted = encryptSecret(cleanSecret);
      const masked = maskSecret(cleanSecret);

      const updated = await prisma.companyIntegration.update({
        where: { id: integration.id },
        data: {
          credentialSource: 'VAULT_ENCRYPTED',
          encryptedSecret: encrypted.encryptedSecret,
          secretIv: encrypted.secretIv,
          secretTag: encrypted.secretTag,
          secretMasked: masked,
          version: { increment: 1 },
          updatedByUserId: req.user!.id,
          lastValidatedAt: null,
          lastValidationStatus: 'PENDING',
        },
      });

      await logIntegrationAudit({
        companyId: integration.companyId,
        integrationId: integration.id,
        action: 'ROTATE',
        authorUserId: req.user!.id,
        authorName: req.user!.name || 'Super Admin',
        details: {
          category: integration.category,
          provider: integration.provider,
          newVersion: updated.version,
          reason: reason || 'Rotação periódica de credencial',
        },
        req,
      });

      res.json({
        message: 'Credencial rotacionada e criptografada com sucesso.',
        integration: {
          id: updated.id,
          secretMasked: updated.secretMasked,
          version: updated.version,
          lastValidationStatus: updated.lastValidationStatus,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: `Erro ao rotacionar credencial: ${err.message}` });
    }
  }
);

/**
 * POST /api/owner/integrations/:id/status
 * Habilita, desabilita ou revoga uma integração (exige Step-Up Auth).
 * Nota: Em PAYMENT_GATEWAY PRODUCTION, status ACTIVE na Central não habilita chamadas LIVE sozinho
 * sem autorização financeira explícita (financialLiveAuthorized) e liberação da trava global LIVE.
 */
router.post(
  '/:id/status',
  authenticateToken,
  requireCapability('INTEGRATION_CONFIG'),
  requireStepUpAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { status, reason } = req.body;
      const validStatuses = ['ACTIVE', 'DISABLED', 'TESTING', 'REVOKED'];
      if (!validStatuses.includes(status)) {
        res.status(400).json({ error: `Status inválido. Escolha: ${validStatuses.join(', ')}.` });
        return;
      }

      const id = String(req.params.id);
      const integration = await prisma.companyIntegration.findUnique({
        where: { id },
      });

      if (!integration) {
        res.status(404).json({ error: 'Integração não encontrada.' });
        return;
      }

      const updated = await prisma.companyIntegration.update({
        where: { id: integration.id },
        data: {
          status,
          updatedByUserId: req.user!.id,
        },
      });

      const isPaymentProd =
        integration.category === 'PAYMENT_GATEWAY' && integration.environment === 'PRODUCTION';

      await logIntegrationAudit({
        companyId: integration.companyId,
        integrationId: integration.id,
        action: status,
        authorUserId: req.user!.id,
        authorName: req.user!.name || 'Super Admin',
        details: {
          previousStatus: integration.status,
          newStatus: status,
          financialLiveEnabled: false,
          reason: reason || 'Alteração de status pelo proprietário',
        },
        req,
      });

      res.json({
        message:
          isPaymentProd && status === 'ACTIVE'
            ? 'Status alterado para ACTIVE na Central, porém chamadas financeiras LIVE permanecem bloqueadas até autorização financeira explícita.'
            : `Status da integração alterado para ${status}.`,
        integration: {
          id: updated.id,
          status: updated.status,
          ...(isPaymentProd ? { financialLiveEnabled: false } : {}),
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: `Erro ao alterar status: ${err.message}` });
    }
  }
);

/**
 * POST /api/owner/integrations/:id/test
 * Executa teste de conexão não destrutivo com o provedor correspondente,
 * validando estritamente referências de ambiente por provedor/categoria/ambiente antes da leitura.
 */
router.post(
  '/:id/test',
  authenticateToken,
  requireCapability('INTEGRATION_CONFIG'),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id);
      const integration = await prisma.companyIntegration.findUnique({
        where: { id },
      });

      if (!integration) {
        res.status(404).json({ error: 'Integração não encontrada.' });
        return;
      }

      let secret: string | null = null;
      if (integration.credentialSource === 'VAULT_ENCRYPTED') {
        if (integration.encryptedSecret && integration.secretIv && integration.secretTag) {
          secret = decryptSecret(
            integration.encryptedSecret,
            integration.secretIv,
            integration.secretTag
          );
        }
      } else if (integration.credentialSource === 'ENV_REFERENCE') {
        const envCheck = isAllowedEnvVarForIntegration({
          varName: integration.envVarName || '',
          category: integration.category,
          provider: integration.provider,
          environment: integration.environment,
        });

        if (!envCheck.allowed) {
          const blockedResult = {
            success: false,
            message:
              envCheck.reason ||
              'Referência de variável de ambiente bloqueada por incompatibilidade de provedor/categoria/ambiente.',
            latencyMs: 0,
            details: { reason: 'BLOCKED_CROSS_PROVIDER_ENV_REFERENCE' },
          };

          await prisma.companyIntegration.update({
            where: { id: integration.id },
            data: {
              lastValidatedAt: new Date(),
              lastValidationStatus: 'FAILED',
              lastValidationError: blockedResult.message.slice(0, 300),
            },
          });

          await logIntegrationAudit({
            companyId: integration.companyId,
            integrationId: integration.id,
            action: 'TEST_CONNECTION',
            authorUserId: req.user!.id,
            authorName: req.user!.name || 'Super Admin',
            details: {
              provider: integration.provider,
              envVarName: integration.envVarName,
              blockedReason: blockedResult.message,
              success: false,
            },
            result: 'BLOCKED',
            req,
          });

          res.status(422).json({ error: blockedResult.message, testResult: blockedResult });
          return;
        }

        if (
          (integration.scope === 'COMPANY_EXCLUSIVE' || integration.scope === 'EXCLUSIVE_OWN_KEY') &&
          (!integration.accountName || !integration.accountName.trim())
        ) {
          const missingBindingResult = {
            success: false,
            message:
              'Referência de infraestrutura bloqueada: conta/empresa vinculada (accountName) ausente.',
            latencyMs: 0,
            details: { reason: 'BLOCKED_UNBOUND_ENV_REFERENCE' },
          };

          await prisma.companyIntegration.update({
            where: { id: integration.id },
            data: {
              lastValidatedAt: new Date(),
              lastValidationStatus: 'FAILED',
              lastValidationError: missingBindingResult.message.slice(0, 300),
            },
          });

          res.status(422).json({ error: missingBindingResult.message, testResult: missingBindingResult });
          return;
        }

        secret = integration.envVarName ? process.env[integration.envVarName] || null : null;
      }

      let testResult: { success: boolean; message: string; latencyMs: number; details?: any } = {
        success: false,
        message: 'Provedor sem adaptador de teste configurado.',
        latencyMs: 0,
      };

      if (integration.provider === 'GEMINI') {
        if (!secret) {
          testResult = { success: false, message: 'Chave Gemini não cadastrada para esta empresa.', latencyMs: 0 };
        } else {
          testResult = await testGeminiConnection(secret);
        }
      } else if (integration.provider === 'VIACEP') {
        testResult = await testViaCepConnection();
      } else if (integration.provider === 'ASAAS') {
        const asaasEnv = integration.environment === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX';
        if (!secret) {
          testResult = {
            success: false,
            message: `Chave do Asaas (${asaasEnv}) não cadastrada para esta empresa.`,
            latencyMs: 0,
          };
        } else {
          testResult = await testAsaasSandboxConnection(secret, { environment: asaasEnv });
        }
      } else if (integration.provider === 'META_WHATSAPP') {
        if (!secret) {
          testResult = { success: false, message: 'Token do Meta WhatsApp não cadastrado para esta empresa.', latencyMs: 0 };
        } else {
          testResult = await testMetaWhatsAppConnection(secret);
        }
      } else if (integration.provider === 'GROK') {
        if (!secret) {
          testResult = { success: false, message: 'Chave do Grok não cadastrada para esta empresa.', latencyMs: 0 };
        } else {
          testResult = await testGrokConnection(secret);
        }
      }

      await prisma.companyIntegration.update({
        where: { id: integration.id },
        data: {
          lastValidatedAt: new Date(),
          lastValidationStatus: testResult.success ? 'SUCCESS' : 'FAILED',
          lastValidationError: testResult.success ? null : testResult.message.slice(0, 300),
        },
      });

      await logIntegrationAudit({
        companyId: integration.companyId,
        integrationId: integration.id,
        action: 'TEST_CONNECTION',
        authorUserId: req.user!.id,
        authorName: req.user!.name || 'Super Admin',
        details: {
          provider: integration.provider,
          environment: integration.environment,
          latencyMs: testResult.latencyMs,
          success: testResult.success,
        },
        result: testResult.success ? 'SUCCESS' : 'FAILED',
        req,
      });

      res.json({ testResult });
    } catch (err: any) {
      res.status(500).json({ error: `Erro ao testar conexão: ${err.message}` });
    }
  }
);

/**
 * GET /api/owner/integrations/:id/usage
 * Histórico de consumo e métricas da integração
 */
router.get(
  '/:id/usage',
  authenticateToken,
  requireCapability('INTEGRATION_CONFIG'),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id);
      const records = await prisma.apiUsageRecord.findMany({
        where: { integrationId: id },
        orderBy: { timestamp: 'desc' },
        take: 50,
      });

      res.json({ usage: records });
    } catch (err: any) {
      res.status(500).json({ error: `Erro ao buscar histórico de consumo: ${err.message}` });
    }
  }
);

/**
 * POST /api/owner/integrations/sandbox/run-homologation
 * Executa o roteiro completo de homologação no Asaas Sandbox oficial (somente em ambiente de homologação autorizado)
 */
router.post(
  '/sandbox/run-homologation',
  authenticateToken,
  requireCapability('INTEGRATION_CONFIG'),
  requireStepUpAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { companyId, sandboxApiKey, webhookToken, forceSimulation, providerWebhookWaitMs } = req.body;
      if (!companyId) {
        res.status(400).json({ error: 'companyId é obrigatório para rodar a homologação Sandbox.' });
        return;
      }

      const clampedWaitMs =
        typeof providerWebhookWaitMs === 'number' && Number.isFinite(providerWebhookWaitMs)
          ? Math.max(0, Math.min(15000, Math.trunc(providerWebhookWaitMs)))
          : undefined;

      const report = await runAsaasSandboxHarness({
        companyId,
        sandboxApiKey,
        webhookToken,
        forceSimulation,
        providerWebhookWaitMs: clampedWaitMs,
      });

      const auditResult =
        report.overallStatus === 'PASSED'
          ? 'SUCCESS'
          : report.overallStatus === 'PENDING_PROVIDER_WEBHOOK'
            ? 'PENDING'
            : report.overallStatus.startsWith('BLOCKED_')
              ? 'BLOCKED'
              : 'FAILED';

      await logIntegrationAudit({
        companyId,
        action: 'ASAAS_SANDBOX_HOMOLOGATION',
        authorUserId: req.user!.id,
        authorName: req.user!.name || 'Super Admin',
        details: {
          environment: report.environment,
          overallStatus: report.overallStatus,
          stepsCount: report.steps.length,
          sandboxHomologated: report.readinessForLive.sandboxHomologated,
        },
        result: auditResult,
        req,
      });

      // Alinhamento estrito de status HTTP:
      // - 422 para bloqueios esperados (falta de credencial/token ou guarda de produção/banco operacional)
      // - 202 para estado pendente aguardando webhook real do provedor
      // - 200 para execução concluída (PASSED ou FAILED de etapa)
      if (report.overallStatus.startsWith('BLOCKED_')) {
        res.status(422).json({ report });
        return;
      }

      if (report.overallStatus === 'PENDING_PROVIDER_WEBHOOK') {
        res.status(202).json({ report });
        return;
      }

      res.status(200).json({ report });
    } catch (err: any) {
      res.status(500).json({ error: `Falha ao executar homologação Sandbox: ${err.message}` });
    }
  }
);

/**
 * GET /api/owner/integrations/sandbox/readiness-report
 * Consulta somente leitura da situação de prontidão, guarda LIVE e isolamento de homologação (sem mutações no banco)
 */
router.get(
  '/sandbox/readiness-report',
  authenticateToken,
  requireCapability('INTEGRATION_CONFIG'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.query.companyId ? String(req.query.companyId) : undefined;
      const safety = await isProductionSafetyLocked(companyId);
      const homologationTargetSafety = await checkHomologationTargetSafety(companyId);

      let companySandboxSummary: Record<string, any> | null = null;
      if (companyId) {
        const sbIntegration = await prisma.companyIntegration.findFirst({
          where: { companyId, category: 'PAYMENT_GATEWAY', environment: 'SANDBOX' },
          select: {
            id: true,
            status: true,
            accountName: true,
            credentialSource: true,
            secretMasked: true,
            envVarName: true,
            configMetadata: true,
            lastValidatedAt: true,
            lastValidationStatus: true,
          },
        });
        const wh = extractWebhookSummary(sbIntegration?.configMetadata);
        const lastOfficialWebhook = await prisma.asaasWebhookEvent.findFirst({
          where: {
            companyId,
            processed: true,
            NOT: { eventId: { startsWith: 'HOMOLOG_TEST_' } },
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true, event: true, externalPaymentId: true, createdAt: true },
        });

        companySandboxSummary = {
          companyId,
          configured: Boolean(sbIntegration),
          status: sbIntegration?.status || 'NOT_CONFIGURED',
          accountName: sbIntegration?.accountName || null,
          hasApiKey: Boolean(sbIntegration?.secretMasked || sbIntegration?.envVarName),
          hasWebhookToken: wh.hasWebhookToken,
          webhookMasked: wh.webhookMasked,
          lastValidationStatus: sbIntegration?.lastValidationStatus || null,
          lastValidatedAt: sbIntegration?.lastValidatedAt || null,
          lastOfficialWebhookEvidence: lastOfficialWebhook || null,
        };
      }

      res.json({
        readinessReport: {
          title: 'Relatório de Prontidão para Asaas LIVE — Lumora',
          status: safety.locked ? 'LIVE_DISABLED_PENDING_EXTERNAL_ACTIONS' : 'LIVE_AUTHORIZED',
          productionSafetyLocked: safety.locked,
          productionSafetyDetails: safety,
          homologationTargetSafety,
          companySandboxSummary,
          summary: safety.reason,
          requirementsChecklist: [
            { item: 'Sandbox Homologation Harness Executable (Real HTTP Route)', status: 'IMPLEMENTED' },
            { item: 'Operational Database Mutation Guard', status: homologationTargetSafety.safe ? 'HOMOLOGATION_ENV_READY' : 'OPERATIONAL_DB_PROTECTED' },
            { item: 'Vault Encrypted Secret Storage (AES-256-GCM)', status: 'IMPLEMENTED' },
            { item: 'Multi-Tenant Isolation & Zero Silent Fallback', status: 'IMPLEMENTED' },
            { item: 'Anti-SSRF Domain Whitelist & Private IP Blocking', status: 'IMPLEMENTED' },
            { item: 'API Usage Metrics Without Prompt PII', status: 'IMPLEMENTED' },
            { item: 'Step-Up Auth on Credential & Metadata Mutation', status: 'IMPLEMENTED' },
            { item: 'Contratação Formal do Modelo Asaas (Empresas vs Subcontas)', status: 'PENDING_OWNER' },
            { item: 'Aprovação Cadastral no Portal Oficial Asaas', status: 'PENDING_OWNER' },
            { item: 'WhatsApp Business API Onboarding Oficial', status: 'PENDING_OWNER' },
          ],
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: `Erro ao consultar relatório de prontidão: ${err.message}` });
    }
  }
);

export default router;
