import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import {
  authenticateToken,
  requireSuperAdmin,
  AuthRequest,
} from '../middleware/authMiddleware';
import {
  listSupportTickets,
  getSupportTicketDetails,
  addTicketMessage,
  updateTicketStatus,
  requestSupportAccessGrant,
  revokeSupportAccessGrant,
} from '../services/supportCentralService';
import { getAggregatedOperationalMetrics } from '../services/operationalMetricsService';
import {
  getDisasterRecoveryStatus,
  assertWebRestoreForbidden,
  assertGlobalDumpDownloadForbidden,
} from '../services/continuityAuditService';
import {
  listInternalAlerts,
  acknowledgeInternalAlert,
} from '../services/internalAlertService';

const router = Router();
const prisma = new PrismaClient();

// Todas as rotas de suporte do proprietário exigem SUPER_ADMIN
router.use(authenticateToken);
router.use(requireSuperAdmin);

// 1. Visão geral de chamados de todas as empresas
router.get('/tickets', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { companyId, status, priority, category, search } = req.query;
    const tickets = await listSupportTickets({
      companyId: companyId as string,
      status: status as string,
      priority: priority as string,
      category: category as string,
      search: search as string,
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

// 2. Detalhes do chamado com notas internas completas
router.get('/tickets/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ticketId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ticket = await getSupportTicketDetails(ticketId, {
      isOwnerSupport: true,
    });

    res.json({
      success: true,
      ticket,
    });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || 'Erro ao carregar detalhes.' });
  }
});

// 3. Responder chamado ou adicionar nota interna técnica
router.post('/tickets/:id/messages', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { message, isInternalNote } = req.body;

    const ticketId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const msg = await addTicketMessage({
      ticketId,
      authorUserId: user.id,
      authorName: user.name || 'Suporte Lumora',
      authorRole: 'SUPPORT',
      message,
      isInternalNote: Boolean(isInternalNote),
      isOwnerSupport: true,
    });

    res.status(201).json({
      success: true,
      message: isInternalNote ? 'Nota interna adicionada.' : 'Resposta enviada à empresa.',
      ticketMessage: msg,
    });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || 'Erro ao adicionar mensagem.' });
  }
});

// 4. Atualizar status e atribuir responsável técnico
router.post('/tickets/:id/status', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, assignedToUserId, assignedToName } = req.body;

    const ticketId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const updated = await updateTicketStatus({
      ticketId,
      status,
      assignedToUserId,
      assignedToName,
      isOwnerSupport: true,
    });

    res.json({
      success: true,
      message: 'Status atualizado com sucesso.',
      ticket: updated,
    });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || 'Erro ao atualizar status.' });
  }
});

// =========================================================================
// SOLICITAÇÃO DE ACESSO DE SUPORTE TEMPORÁRIO
// =========================================================================

// 5. Solicitar acesso de suporte temporário a uma empresa
router.post('/grants/request', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { companyId, ticketId, scope, reason, durationMinutes } = req.body;

    if (!companyId) {
      res.status(400).json({ error: 'companyId é obrigatório.' });
      return;
    }

    const grant = await requestSupportAccessGrant({
      companyId,
      ticketId,
      requestedByUserId: user.id,
      requestedByName: user.name || 'Equipe Lumora',
      scope,
      reason,
      durationMinutes,
    });

    res.status(201).json({
      success: true,
      message: 'Solicitação de acesso de suporte registrada e enviada à empresa para autorização formal.',
      grant,
    });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || 'Erro ao solicitar acesso.' });
  }
});

// 6. Listar concessões de acesso de suporte
router.get('/grants', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { companyId, status } = req.query;
    const where: any = {};
    if (companyId) where.companyId = companyId as string;
    if (status) where.status = status as string;

    const grants = await prisma.supportAccessGrant.findMany({
      where,
      include: {
        company: { select: { id: true, name: true, tradeName: true } },
        ticket: { select: { id: true, ticketNumber: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      total: grants.length,
      grants,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erro ao buscar concessões.' });
  }
});

// =========================================================================
// STATUS OPERACIONAL AGREGADO E TELEMETRIA DE PENDÊNCIAS OFFLINE
// =========================================================================

// 7. Status operacional agregado
router.get('/operational-metrics', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { companyId, startDate, endDate } = req.query;
    const metrics = await getAggregatedOperationalMetrics({
      companyId: companyId as string,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
    });

    res.json({
      success: true,
      metrics,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erro ao obter métricas operacionais.' });
  }
});

// =========================================================================
// CONTINUIDADE E DISASTER RECOVERY
// =========================================================================

// 8. Visibilidade do status de backups e restaurações testadas
router.get('/continuity/status', async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const status = await getDisasterRecoveryStatus();
    res.json({
      success: true,
      continuity: status,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erro ao consultar status de continuidade.' });
  }
});

// 9. Bloqueio estrito de restauração web arbitrária
router.post('/continuity/restore-web', (_req: AuthRequest, _res: Response): void => {
  assertWebRestoreForbidden();
});

// 10. Bloqueio estrito de download global de dump de banco
router.get('/continuity/download-backup', (_req: AuthRequest, _res: Response): void => {
  assertGlobalDumpDownloadForbidden();
});

// =========================================================================
// ALERTAS OPERACIONAIS INTERNOS
// =========================================================================

// 11. Listar alertas internos de integração e acertos
router.get('/internal-alerts', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { companyId, acknowledged, category, severity } = req.query;
    const alerts = await listInternalAlerts({
      companyId: companyId as string,
      acknowledged: acknowledged !== undefined ? acknowledged === 'true' : false,
      category: category as string,
      severity: severity as string,
    });

    res.json({
      success: true,
      total: alerts.length,
      alerts,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erro ao listar alertas internos.' });
  }
});

// 12. Reconhecer alerta interno
router.post('/internal-alerts/:id/ack', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const alertId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const updated = await acknowledgeInternalAlert(alertId, user.id);

    res.json({
      success: true,
      message: 'Alerta reconhecido.',
      alert: updated,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erro ao reconhecer alerta.' });
  }
});

export default router;
