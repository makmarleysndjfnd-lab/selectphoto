import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import {
  createSupportTicket,
  listSupportTickets,
  getSupportTicketDetails,
  addTicketMessage,
  updateTicketStatus,
  approveSupportAccessGrant,
  revokeSupportAccessGrant,
  sanitizeDiagnosticInfo,
} from '../services/supportCentralService';

const router = Router();
const prisma = new PrismaClient();

// Todas as rotas de suporte exigem usuário autenticado
router.use(authenticateToken);

// 1. Criar novo chamado de suporte (pela empresa ou operador)
router.post('/tickets', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || !user.id) {
      res.status(401).json({ error: 'Usuário não autenticado.' });
      return;
    }

    const companyId = user.companyId || req.body.companyId;
    if (!companyId) {
      res.status(400).json({ error: 'Identificador da empresa é obrigatório.' });
      return;
    }

    const {
      title,
      description,
      category,
      priority,
      appVersion,
      buildNumber,
      affectedService,
      devicePlatform,
      connectivityStatus,
      errorDetails,
    } = req.body;

    const ticket = await createSupportTicket({
      companyId,
      creatorUserId: user.id,
      creatorName: user.name || 'Operador',
      title,
      description,
      category,
      priority,
      appVersion,
      buildNumber,
      affectedService,
      devicePlatform,
      connectivityStatus,
      errorDetails,
    });

    res.status(201).json({
      success: true,
      message: 'Chamado aberto com sucesso.',
      ticket,
    });
  } catch (err: any) {
    console.error('Erro ao criar chamado de suporte:', err);
    res.status(err.status || 500).json({ error: err.message || 'Erro ao criar chamado.' });
  }
});

// 2. Listar chamados da empresa do usuário autenticado
router.get('/tickets', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || !user.id) {
      res.status(401).json({ error: 'Usuário não autenticado.' });
      return;
    }

    const isSuperAdmin = user.role === 'SUPER_ADMIN';
    const companyId = isSuperAdmin ? (req.query.companyId as string) : user.companyId;

    if (!isSuperAdmin && !companyId) {
      res.status(400).json({ error: 'Empresa não identificada.' });
      return;
    }

    const tickets = await listSupportTickets({
      companyId: companyId || undefined,
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
    console.error('Erro ao listar chamados de suporte:', err);
    res.status(500).json({ error: err.message || 'Erro ao listar chamados.' });
  }
});

// 3. Obter detalhes do chamado (com mensagens e diagnóstico sanitizado)
router.get('/tickets/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || !user.id) {
      res.status(401).json({ error: 'Usuário não autenticado.' });
      return;
    }

    const isSuperAdmin = user.role === 'SUPER_ADMIN';
    const ticketId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ticket = await getSupportTicketDetails(ticketId, {
      companyId: user.companyId || undefined,
      isOwnerSupport: isSuperAdmin,
    });

    res.json({
      success: true,
      ticket,
    });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || 'Erro ao carregar detalhes.' });
  }
});

// 4. Adicionar mensagem ao chamado
router.post('/tickets/:id/messages', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || !user.id) {
      res.status(401).json({ error: 'Usuário não autenticado.' });
      return;
    }

    const isSuperAdmin = user.role === 'SUPER_ADMIN';
    const { message, isInternalNote } = req.body;

    const ticketId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const msg = await addTicketMessage({
      ticketId,
      authorUserId: user.id,
      authorName: user.name || 'Usuário',
      authorRole: isSuperAdmin ? 'SUPPORT' : user.role,
      message,
      isInternalNote: Boolean(isInternalNote && isSuperAdmin),
      companyId: user.companyId || undefined,
      isOwnerSupport: isSuperAdmin,
    });

    res.status(201).json({
      success: true,
      message: 'Mensagem adicionada com sucesso.',
      ticketMessage: msg,
    });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || 'Erro ao adicionar mensagem.' });
  }
});

// 5. Atualizar status do chamado (ex: fechar pelo solicitante)
router.post('/tickets/:id/status', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || !user.id) {
      res.status(401).json({ error: 'Usuário não autenticado.' });
      return;
    }

    const isSuperAdmin = user.role === 'SUPER_ADMIN';
    const { status, assignedToUserId, assignedToName } = req.body;

    const ticketId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const updated = await updateTicketStatus({
      ticketId,
      status,
      assignedToUserId,
      assignedToName,
      companyId: user.companyId || undefined,
      isOwnerSupport: isSuperAdmin,
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
// CONCESSÃO DE ACESSO DE SUPORTE TEMPORÁRIO (AUTORIZAÇÃO PELA EMPRESA)
// =========================================================================

// 6. Listar solicitações de suporte pendentes de aprovação da empresa
router.get('/grants/pending', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || !user.id || !user.companyId) {
      res.status(401).json({ error: 'Acesso restrito ao responsável pela empresa.' });
      return;
    }

    const grants = await prisma.supportAccessGrant.findMany({
      where: {
        companyId: user.companyId,
        status: { in: ['REQUESTED', 'ACTIVE'] },
      },
      include: {
        ticket: { select: { id: true, ticketNumber: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      grants,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erro ao buscar concessões de suporte.' });
  }
});

// 7. Aprovar solicitação de suporte pela empresa dona dos dados
router.post('/grants/:id/approve', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || !user.id || !user.companyId) {
      res.status(401).json({ error: 'Acesso restrito ao responsável pela empresa.' });
      return;
    }

    // Apenas COMPANY_ADMIN ou ADMIN da empresa pode autorizar
    if (user.role !== 'COMPANY_ADMIN' && user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Apenas o administrador da empresa pode autorizar o acesso de suporte.' });
      return;
    }

    const clientIp = (req.ip || req.socket.remoteAddress || 'unknown').substring(0, 45);
    const grantId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await approveSupportAccessGrant({
      grantId,
      approvedByUserId: user.id,
      approvedByName: user.name || 'Administrador',
      companyId: user.companyId,
      ipAddress: clientIp,
    });

    res.json({
      success: true,
      message: 'Acesso de suporte temporário autorizado com sucesso.',
      grant: result.grant,
      expiresAt: result.expiresAt,
    });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || 'Erro ao aprovar suporte.' });
  }
});

// 8. Revogar suporte imediatamente pela empresa
router.post('/grants/:id/revoke', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || !user.id) {
      res.status(401).json({ error: 'Usuário não autenticado.' });
      return;
    }

    const isSuperAdmin = user.role === 'SUPER_ADMIN';
    const grantId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { reason } = req.body;

    const revoked = await revokeSupportAccessGrant({
      grantId,
      revokedByUserId: user.id,
      revokedByName: user.name || 'Administrador',
      companyId: isSuperAdmin ? undefined : (user.companyId || undefined),
      reason,
    });

    res.json({
      success: true,
      message: 'Acesso de suporte revogado imediatamente.',
      grant: revoked,
    });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || 'Erro ao revogar suporte.' });
  }
});

export default router;
