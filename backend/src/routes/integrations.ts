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
  isAllowedEnvVarReference,
  ALLOWED_ENV_VAR_REFERENCES,
} from '../services/vaultService';
import {
  testGeminiConnection,
  testViaCepConnection,
  testAsaasSandboxConnection,
  testMetaWhatsAppConnection,
  testGrokConnection,
} from '../services/integrationAdapters';
import { runAsaasSandboxHarness } from '../services/asaasSandboxHarness';
import { lookupViaCep } from '../services/integrationResolver';

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

      res.json({ integrations });
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

      res.json({ integration });
    } catch (err: any) {
      res.status(500).json({ error: `Erro ao buscar integração: ${err.message}` });
    }
  }
);

/**
 * POST /api/owner/integrations
 * Cadastra uma nova integração para uma empresa
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
        costPayer = 'PLATFORM',
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

      // Validação de categoria e provedor
      const catalogItem = INTEGRATION_CATALOG.find((c) => c.category === category);
      if (!catalogItem || !catalogItem.supportedProviders.includes(provider)) {
        res.status(400).json({ error: `Provedor ${provider} não suportado para a categoria ${category}.` });
        return;
      }

      let encryptedSecret: string | null = null;
      let secretIv: string | null = null;
      let secretTag: string | null = null;
      let secretMasked: string | null = null;

      if (credentialSource === 'VAULT_ENCRYPTED' && plainSecret) {
        const encrypted = encryptSecret(plainSecret);
        encryptedSecret = encrypted.encryptedSecret;
        secretIv = encrypted.secretIv;
        secretTag = encrypted.secretTag;
        secretMasked = maskSecret(plainSecret);
      } else if (credentialSource === 'ENV_REFERENCE') {
        const trimmedVarName = envVarName ? String(envVarName).trim() : '';
        if (!trimmedVarName || !isAllowedEnvVarReference(trimmedVarName)) {
          res.status(400).json({
            error: `Referência de variável de ambiente '${trimmedVarName}' inválida ou não autorizada no catálogo restrito de infraestrutura. Permitidas: ${ALLOWED_ENV_VAR_REFERENCES.join(', ')}`,
          });
          return;
        }
      }

      const created = await prisma.companyIntegration.create({
        data: {
          companyId,
          category,
          provider,
          scope,
          environment,
          accountName: accountName ? String(accountName).trim() : null,
          costPayer,
          changeApplicability,
          credentialSource,
          encryptedSecret,
          secretIv,
          secretTag,
          secretMasked,
          envVarName: envVarName ? String(envVarName).trim() : null,
          monthlyBudgetLimitCents: monthlyBudgetLimitCents ? Number(monthlyBudgetLimitCents) : null,
          monthlyUnitsLimit: monthlyUnitsLimit ? Number(monthlyUnitsLimit) : null,
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
          credentialSource,
          hasSecret: !!plainSecret,
        },
        req,
      });

      res.status(201).json({
        integration: {
          id: created.id,
          companyId: created.companyId,
          category: created.category,
          provider: created.provider,
          scope: created.scope,
          status: created.status,
          environment: created.environment,
          secretMasked: created.secretMasked,
          version: created.version,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: `Falha ao cadastrar integração: ${err.message}` });
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
      if (!plainSecret || typeof plainSecret !== 'string') {
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

      const encrypted = encryptSecret(plainSecret);
      const masked = maskSecret(plainSecret);

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
          lastValidatedAt: null, // Reset da validação anterior
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
 * Habilita, desabilita ou revoga uma integração (exige Step-Up Auth)
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

      await logIntegrationAudit({
        companyId: integration.companyId,
        integrationId: integration.id,
        action: status,
        authorUserId: req.user!.id,
        authorName: req.user!.name || 'Super Admin',
        details: {
          previousStatus: integration.status,
          newStatus: status,
          reason: reason || 'Alteração de status pelo proprietário',
        },
        req,
      });

      res.json({
        message: `Status da integração alterado para ${status}.`,
        integration: {
          id: updated.id,
          status: updated.status,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: `Erro ao alterar status: ${err.message}` });
    }
  }
);

/**
 * POST /api/owner/integrations/:id/test
 * Executa teste de conexão não destrutivo com o provedor correspondente
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
      } else if (integration.credentialSource === 'ENV_REFERENCE' && integration.envVarName) {
        secret = process.env[integration.envVarName] || null;
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
        if (!secret) {
          testResult = { success: false, message: 'Chave do Asaas Sandbox não cadastrada para esta empresa.', latencyMs: 0 };
        } else {
          testResult = await testAsaasSandboxConnection(secret);
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

      // Atualiza o estado da última validação
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
 * Executa o roteiro completo de homologação no Asaas Sandbox oficial
 */
router.post(
  '/sandbox/run-homologation',
  authenticateToken,
  requireCapability('INTEGRATION_CONFIG'),
  requireStepUpAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { companyId, sandboxApiKey, webhookToken, forceSimulation } = req.body;
      if (!companyId) {
        res.status(400).json({ error: 'companyId é obrigatório para rodar a homologação Sandbox.' });
        return;
      }

      const report = await runAsaasSandboxHarness({
        companyId,
        sandboxApiKey,
        webhookToken,
        forceSimulation,
      });

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
        result: report.overallStatus === 'PASSED' ? 'SUCCESS' : 'FAILED',
        req,
      });

      res.json({ report });
    } catch (err: any) {
      res.status(500).json({ error: `Falha ao executar homologação Sandbox: ${err.message}` });
    }
  }
);

/**
 * GET /api/owner/integrations/sandbox/readiness-report
 * Retorna o relatório de prontidão para entrada futura em modo LIVE
 */
router.get(
  '/sandbox/readiness-report',
  authenticateToken,
  requireCapability('INTEGRATION_CONFIG'),
  async (_req: AuthRequest, res: Response) => {
    res.json({
      readinessReport: {
        title: 'Relatório de Prontidão para Asaas LIVE — Lumora',
        status: 'LIVE_DISABLED_PENDING_EXTERNAL_ACTIONS',
        productionSafetyLocked: true,
        summary:
          'O ambiente de produção financeira permanece strictly DISABLED. Todos os fluxos operam com blindagem e isolamento multi-tenant.',
        requirementsChecklist: [
          { item: 'Sandbox Homologation Harness Executable', status: 'IMPLEMENTED' },
          { item: 'Vault Encrypted Secret Storage (AES-256-GCM)', status: 'IMPLEMENTED' },
          { item: 'Multi-Tenant Isolation & Zero Silent Fallback', status: 'IMPLEMENTED' },
          { item: 'Anti-SSRF Domain Whitelist & Private IP Blocking', status: 'IMPLEMENTED' },
          { item: 'API Usage Metrics Without Prompt PII', status: 'IMPLEMENTED' },
          { item: 'Step-Up Auth on Credential Mutation', status: 'IMPLEMENTED' },
          { item: 'Contratação Formal do Modelo Asaas (Empresas vs Subcontas)', status: 'PENDING_OWNER' },
          { item: 'Aprovação Cadastral no Portal Oficial Asaas', status: 'PENDING_OWNER' },
          { item: 'WhatsApp Business API Onboarding Oficial', status: 'PENDING_OWNER' },
        ],
      },
    });
  }
);

export default router;
