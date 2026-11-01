import { Router, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
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

const router = Router();
const prisma = new PrismaClient();

// Catálogo permitido para autoatendimento do Admin da Empresa
export const COMPANY_SELF_SERVICE_CATALOG = [
  {
    category: 'AI_RESEARCH',
    label: 'Inteligência Artificial (Pesquisa Comercial de Eventos)',
    supportedProviders: ['GEMINI'],
    supportedScopes: ['EXCLUSIVE_OWN_KEY'],
    environments: ['PRODUCTION'],
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
 * Lista integrações configuradas da empresa autenticada e o catálogo de provedores disponíveis
 */
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      res.status(403).json({ error: 'Empresa não identificada.' });
      return;
    }

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
        configMetadata: true,
        version: true,
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
        configMetadata: sanitizeMetadata(i.configMetadata),
      };
    });

    const prodSafety = await isProductionSafetyLocked(companyId);
    res.json({
      integrations: sanitizedIntegrations,
      catalog: COMPANY_SELF_SERVICE_CATALOG,
      sharedServices: COMPANY_SHARED_SERVICES,
      globalLiveGateLocked: prodSafety.locked,
    });
  } catch (err: any) {
    console.error('Error fetching company integrations:', err);
    res.status(500).json({ error: `Erro ao buscar integrações: ${err.message}` });
  }
});

/**
 * POST /api/company/integrations
 * Cadastra ou substitui uma credencial de integração para a própria empresa
 */
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const currentUserId = req.user?.id;
    const currentUserName = req.user?.name || 'Administrador';

    if (!companyId || !currentUserId) {
      res.status(403).json({ error: 'Empresa ou usuário não identificado.' });
      return;
    }

    const userRole = req.user?.role;
    if (!['ADMIN', 'COMPANY_ADMIN', 'SUPER_ADMIN'].includes(userRole || '')) {
      res.status(403).json({ error: 'Acesso restrito a administradores da empresa.' });
      return;
    }

    const {
      category,
      provider,
      environment = 'PRODUCTION',
      secret,
      webhookToken,
      accountName,
      passwordConfirmation,
    } = req.body;

    if (!category || !provider || !secret || typeof secret !== 'string' || !secret.trim()) {
      res.status(400).json({ error: 'Campos obrigatórios: category, provider e secret.' });
      return;
    }

    // Reautenticação do administrador para operações de credenciais
    if (passwordConfirmation) {
      const userRecord = await prisma.user.findUnique({
        where: { id: currentUserId },
        select: { password: true },
      });
      if (!userRecord || !bcrypt.compareSync(passwordConfirmation, userRecord.password)) {
        res.status(401).json({ error: 'Senha de confirmação inválida.' });
        return;
      }
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

    // Impor regras de isolamento no servidor
    const scope = catalogItem.supportedScopes[0]; // EXCLUSIVE_OWN_KEY ou COMPANY_EXCLUSIVE
    const costPayer = 'COMPANY';
    const credentialSource = 'VAULT_ENCRYPTED';

    // Criptografar segredo no cofre AES-256-GCM
    const encrypted = encryptSecret(secret.trim());
    const secretMasked = maskSecret(secret.trim());

    // Metadados seguros e webhook opcional para Asaas
    const configMetadata: Record<string, any> = {
      accountName: accountName ? String(accountName).trim() : undefined,
      registeredByUserId: currentUserId,
      registeredAt: new Date().toISOString(),
      financialLiveAuthorized: false,
    };

    if (category === 'PAYMENT_GATEWAY' && webhookToken && typeof webhookToken === 'string' && webhookToken.trim()) {
      const encWh = encryptSecret(webhookToken.trim());
      configMetadata.encryptedWebhookToken = encWh.encryptedSecret;
      configMetadata.webhookIv = encWh.secretIv;
      configMetadata.webhookTag = encWh.secretTag;
      configMetadata.webhookMasked = maskSecret(webhookToken.trim());
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

    let saved;
    if (existing) {
      saved = await prisma.companyIntegration.update({
        where: { id: existing.id },
        data: {
          provider,
          scope,
          costPayer,
          credentialSource,
          encryptedSecret: encrypted.encryptedSecret,
          secretIv: encrypted.secretIv,
          secretTag: encrypted.secretTag,
          secretMasked,
          status: 'ACTIVE',
          accountName: accountName ? String(accountName).trim() : existing.accountName,
          configMetadata,
          version: existing.version + 1,
          updatedByUserId: currentUserId,
          lastValidationStatus: null,
          lastValidationError: null,
        },
      });
    } else {
      saved = await prisma.companyIntegration.create({
        data: {
          companyId,
          category,
          provider,
          environment: cleanEnv,
          scope,
          costPayer,
          credentialSource,
          encryptedSecret: encrypted.encryptedSecret,
          secretIv: encrypted.secretIv,
          secretTag: encrypted.secretTag,
          secretMasked,
          status: 'ACTIVE',
          accountName: accountName ? String(accountName).trim() : null,
          configMetadata,
          createdByUserId: currentUserId,
          version: 1,
        },
      });
    }

    // Auditoria sem segredos
    try {
      await prisma.integrationAuditEvent.create({
        data: {
          companyId,
          integrationId: saved.id,
          action: existing ? 'COMPANY_INTEGRATION_UPDATE' : 'COMPANY_INTEGRATION_CREATE',
          authorUserId: currentUserId,
          authorName: currentUserName,
          details: JSON.stringify({
            category,
            provider,
            environment: cleanEnv,
            scope,
            costPayer,
            version: saved.version,
            hasWebhookToken: Boolean(configMetadata.encryptedWebhookToken),
          }),
          result: 'SUCCESS',
          ipAddress: (req.ip || req.socket.remoteAddress || 'unknown').substring(0, 45),
          userAgent: (req.headers['user-agent'] || 'unknown').substring(0, 255),
        },
      });
    } catch (_) {}

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
 * DELETE /api/company/integrations/:id
 * Remove uma credencial de integração pertencente à empresa do admin autenticado
 */
router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const currentUserId = req.user?.id;
    const currentUserName = req.user?.name || 'Administrador';
    const id = String(req.params.id);

    if (!companyId || !currentUserId) {
      res.status(403).json({ error: 'Empresa ou usuário não identificado.' });
      return;
    }

    const existing = await prisma.companyIntegration.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      res.status(404).json({ error: 'Integração não encontrada para esta empresa.' });
      return;
    }

    await prisma.companyIntegration.delete({
      where: { id: existing.id },
    });

    try {
      await prisma.integrationAuditEvent.create({
        data: {
          companyId,
          integrationId: existing.id,
          action: 'COMPANY_INTEGRATION_DELETE',
          authorUserId: currentUserId,
          authorName: currentUserName,
          details: JSON.stringify({
            category: existing.category,
            provider: existing.provider,
            environment: existing.environment,
          }),
          result: 'SUCCESS',
          ipAddress: (req.ip || req.socket.remoteAddress || 'unknown').substring(0, 45),
          userAgent: (req.headers['user-agent'] || 'unknown').substring(0, 255),
        },
      });
    } catch (_) {}

    res.json({ success: true, message: 'Integração removida com sucesso.' });
  } catch (err: any) {
    console.error('Error deleting company integration:', err);
    res.status(500).json({ error: `Erro ao remover integração: ${err.message}` });
  }
});

/**
 * POST /api/company/integrations/:id/test
 * Testa a conectividade da integração da empresa utilizando adaptadores oficiais
 */
router.post('/:id/test', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const id = String(req.params.id);

    if (!companyId) {
      res.status(403).json({ error: 'Empresa não identificada.' });
      return;
    }

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
      testResult = await testAsaasSandboxConnection(plainSecret);
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

export default router;
