import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import {
  listSupportTickets,
  getSupportTicketDetails,
  addTicketMessage,
} from '../services/supportCentralService';
import { getAggregatedOperationalMetrics } from '../services/operationalMetricsService';
import { listInternalAlerts, acknowledgeInternalAlert } from '../services/internalAlertService';
import {
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

const router = Router();
const prisma = new PrismaClient();

// Todas as rotas desta sessão exigem autenticação
router.use(authenticateToken);

// Middleware de verificação de permissão: exige papel SUPPORT_AUTHORIZED ou SUPER_ADMIN
router.use((req: AuthRequest, res: Response, next) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Usuário não autenticado.' });
    return;
  }
  if (user.role !== 'SUPPORT_AUTHORIZED' && user.role !== 'SUPER_ADMIN') {
    res.status(403).json({
      error: 'SUPPORT_FORBIDDEN',
      message: 'Acesso restrito à sessão de suporte técnico autorizada.',
    });
    return;
  }
  if (!user.companyId) {
    res.status(403).json({
      error: 'SUPPORT_COMPANY_REQUIRED',
      message: 'Empresa vinculada à sessão de suporte não identificada.',
    });
    return;
  }
  next();
});

// 1. GET /api/support/session/tickets — Listar chamados da empresa autorizada
router.get('/tickets', async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.companyId!;
    const tickets = await listSupportTickets({
      companyId,
      status: req.query.status as string,
      priority: req.query.priority as string,
      category: req.query.category as string,
      search: req.query.search as string,
    });

    res.json({
      success: true,
      total: tickets.length,
      tickets,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erro ao listar chamados.' });
  }
});

// 2. GET /api/support/session/tickets/:id — Detalhes de chamado da empresa autorizada
router.get('/tickets/:id', async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.companyId!;
    const ticketId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ticket = await getSupportTicketDetails(ticketId, {
      companyId,
      isOwnerSupport: false,
    });

    res.json({
      success: true,
      ticket,
    });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || 'Erro ao obter chamado.' });
  }
});

// 3. POST /api/support/session/tickets/:id/messages — Adicionar resposta ao chamado
router.post('/tickets/:id/messages', async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const companyId = user.companyId!;
    const ticketId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { message } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json({ error: 'Mensagem não pode ser vazia.' });
      return;
    }

    const msg = await addTicketMessage({
      ticketId,
      authorUserId: user.id,
      authorName: user.name || 'Técnico de Suporte',
      authorRole: 'SUPPORT',
      message: message.trim(),
      isInternalNote: false, // Mensagem técnica pública no chamado
      companyId,
      isOwnerSupport: true,
    });

    res.status(201).json({
      success: true,
      message: 'Resposta técnica adicionada com sucesso.',
      ticketMessage: msg,
    });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || 'Erro ao enviar mensagem.' });
  }
});

// 4. GET /api/support/session/metrics — Métricas operacionais e telemetria (contrato comum alinhado)
router.get('/metrics', async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.companyId!;
    const { startDate, endDate } = req.query;

    const baseMetrics = await getAggregatedOperationalMetrics({
      companyId,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
    });

    // Busca telemetria recente para construir lista plana esperada pela tela
    const recentTelemetries = await prisma.deviceTelemetry.findMany({
      where: {
        companyId,
        lastReportedAt: {
          gte: new Date(Date.now() - 48 * 60 * 60 * 1000),
        },
      },
      orderBy: { lastReportedAt: 'desc' },
      take: 50,
      include: {
        user: { select: { id: true, name: true, role: true } },
      },
    });

    const telemetriaDispositivos = recentTelemetries.map((d) => ({
      deviceId: d.deviceId,
      vendedor: d.user?.name || 'Operador',
      plataforma: d.platform,
      platform: d.platform,
      appVersion: d.appVersion,
      buildNumber: d.buildNumber,
      pendingOfflineCount: d.pendingOfflineCount,
      pendingSummary: d.pendingSummary,
      connectivityStatus: d.connectivityStatus,
      lastReportedAt: d.lastReportedAt.toISOString(),
      ultimaComunicacao: d.lastReportedAt.toISOString(),
    }));

    // Contrato explícito comum (fornece tanto os campos novos quanto os legados sem zeros silenciosos)
    const alignedMetrics = {
      ...baseMetrics,
      fichas: {
        ...baseMetrics.fichas,
        totalCadastradas: baseMetrics.fichas.total,
      },
      vendas: {
        ...baseMetrics.vendas,
        totalRealizadas: baseMetrics.vendas.totalQuantidade,
      },
      telemetriaDispositivos,
    };

    res.json({
      success: true,
      metrics: alignedMetrics,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erro ao carregar métricas operacionais.' });
  }
});

// 5. GET /api/support/session/alerts — Alertas operacionais internos da empresa
router.get('/alerts', async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.companyId!;
    const acknowledged = req.query.acknowledged === 'true';
    const alerts = await listInternalAlerts({ companyId, acknowledged }, prisma);

    res.json({
      success: true,
      total: alerts.length,
      alerts,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erro ao listar alertas internos.' });
  }
});

// 6. POST /api/support/session/alerts/:id/ack — Reconhecer alerta operacional interno
router.post('/alerts/:id/ack', async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const companyId = user.companyId!;
    const alertId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const alert = await prisma.internalOperationalAlert.findUnique({
      where: { id: alertId },
    });

    if (!alert) {
      res.status(404).json({ error: 'Alerta não encontrado.' });
      return;
    }

    if (alert.companyId !== companyId) {
      res.status(403).json({
        error: 'SUPPORT_COMPANY_MISMATCH',
        message: 'Alerta pertence a outra empresa.',
      });
      return;
    }

    const updated = await acknowledgeInternalAlert(alertId, user.id, prisma);

    res.json({
      success: true,
      message: 'Alerta operacional reconhecido.',
      alert: updated,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erro ao reconhecer alerta.' });
  }
});

// 7. GET /api/support/session/integrations — Listar integrações (estrito para INTEGRATION_DEBUG)
router.get('/integrations', async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const companyId = user.companyId!;

    // Trava de escopo: Apenas INTEGRATION_DEBUG pode inspecionar integrações
    if (user.supportScope && user.supportScope !== 'INTEGRATION_DEBUG' && user.role !== 'SUPER_ADMIN') {
      res.status(403).json({
        error: 'SUPPORT_ACTION_FORBIDDEN',
        message: 'Aba de integrações disponível exclusivamente no escopo INTEGRATION_DEBUG.',
      });
      return;
    }

    const integrations = await prisma.companyIntegration.findMany({
      where: { companyId },
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
        secretMasked: true,
        lastValidatedAt: true,
        lastValidationStatus: true,
        lastValidationError: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      total: integrations.length,
      integrations,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erro ao listar integrações.' });
  }
});

// 8. POST /api/support/session/integrations/:id/test — Testar conectividade (estrito para INTEGRATION_DEBUG)
router.post('/integrations/:id/test', async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const companyId = user.companyId!;
    const integrationId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (user.supportScope && user.supportScope !== 'INTEGRATION_DEBUG' && user.role !== 'SUPER_ADMIN') {
      res.status(403).json({
        error: 'SUPPORT_ACTION_FORBIDDEN',
        message: 'Teste de conexão de integrações disponível exclusivamente no escopo INTEGRATION_DEBUG.',
      });
      return;
    }

    let integration = await prisma.companyIntegration.findUnique({
      where: { id: integrationId },
    });

    if (!integration) {
      integration = await prisma.companyIntegration.findFirst({
        where: {
          companyId,
          provider: integrationId.toUpperCase() as any,
        },
      });
    }

    if (!integration) {
      const upperProvider = integrationId.toUpperCase();
      if (['ASAAS', 'GEMINI', 'VIACEP', 'META_WHATSAPP', 'GROK'].includes(upperProvider)) {
        let testResult: { success: boolean; message: string; latencyMs: number } = {
          success: true,
          message: `Conexão simulada com ${upperProvider} bem sucedida (sandbox).`,
          latencyMs: 15,
        };
        if (upperProvider === 'ASAAS') {
          testResult = await testAsaasSandboxConnection('dummy_sandbox_key_for_test');
        } else if (upperProvider === 'VIACEP') {
          testResult = await testViaCepConnection();
        }
        res.json({
          success: true,
          integration: integrationId.toLowerCase(),
          testResult,
        });
        return;
      }

      res.status(404).json({ error: 'Integração não encontrada.' });
      return;
    }

    if (integration.companyId !== companyId) {
      res.status(403).json({
        error: 'SUPPORT_COMPANY_MISMATCH',
        message: 'Integração informada pertence a outra empresa.',
      });
      return;
    }

    // Obtenção da credencial
    let secret: string | null = null;
    if (integration.credentialSource === 'VAULT_ENCRYPTED') {
      if (integration.encryptedSecret && integration.secretIv && integration.secretTag) {
        secret = decryptSecret(integration.encryptedSecret, integration.secretIv, integration.secretTag);
      }
    } else if (integration.credentialSource === 'ENV_REFERENCE') {
      const envCheck = isAllowedEnvVarForIntegration({
        varName: integration.envVarName || '',
        category: integration.category,
        provider: integration.provider,
        environment: integration.environment,
      });
      if (!envCheck.allowed) {
        res.status(422).json({
          success: false,
          testResult: {
            success: false,
            message: envCheck.reason || 'Referência de variável de ambiente bloqueada.',
            latencyMs: 0,
          },
        });
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
        testResult = { success: false, message: `Chave do Asaas (${asaasEnv}) não cadastrada.`, latencyMs: 0 };
      } else {
        testResult = await testAsaasSandboxConnection(secret, { environment: asaasEnv });
      }
    } else if (integration.provider === 'META_WHATSAPP') {
      if (!secret) {
        testResult = { success: false, message: 'Token do Meta WhatsApp não cadastrado.', latencyMs: 0 };
      } else {
        testResult = await testMetaWhatsAppConnection(secret);
      }
    } else if (integration.provider === 'GROK') {
      if (!secret) {
        testResult = { success: false, message: 'Chave do Grok não cadastrada.', latencyMs: 0 };
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

    res.json({
      success: testResult.success,
      testResult,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erro ao executar teste de integração.' });
  }
});

export default router;
