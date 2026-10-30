import { PrismaClient, Prisma } from '@prisma/client';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

// Sanitizador de diagnóstico e mensagens: remove senhas, chaves de API, CPFs, números de cartão e credenciais
export function sanitizeDiagnosticInfo(data: any): any {
  if (data === null || data === undefined) return null;

  function maskString(str: string): string {
    return str
      // Tokens Bearer e headers
      .replace(/(?:bearer\s+)["']?[a-zA-Z0-9_\-\.]{8,}["']?/gi, 'Bearer [REDACTED]')
      // Padrões de chave=valor ou chave: valor
      .replace(/(?:api[_-]?key|token|secret|password|senha|authorization)\s*[:=]\s*["']?[^"'\s,}{]+/gi, '$1: "[REDACTED]"')
      // CPFs formatados (000.000.000-00)
      .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '***.***.***-**')
      // CPFs contínuos (11 dígitos)
      .replace(/\b\d{11}\b/g, '***.***.***-**')
      // Cartões de crédito (13-19 dígitos)
      .replace(/\b(?:\d{4}[-\s]?){3}\d{4}\b/g, '****-****-****-****')
      // URLs assinadas S3/GCS
      .replace(/(X-Amz-Signature=[a-f0-9]+|Signature=[^&\s]+)/gi, 'Signature=[REDACTED]');
  }

  function sanitizeRecursive(val: any): any {
    if (val === null || val === undefined) return val;
    if (typeof val === 'string') {
      return maskString(val);
    }
    if (Array.isArray(val)) {
      return val.map(sanitizeRecursive);
    }
    if (typeof val === 'object') {
      const copy: Record<string, any> = {};
      for (const [k, v] of Object.entries(val)) {
        if (/password|senha|secret|token|api[_-]?key|authorization/i.test(k)) {
          copy[k] = '[REDACTED]';
        } else {
          copy[k] = sanitizeRecursive(v);
        }
      }
      return copy;
    }
    return val;
  }

  return sanitizeRecursive(data);
}

export interface CreateTicketParams {
  companyId: string;
  creatorUserId: string;
  creatorName: string;
  title: string;
  description: string;
  category?: string;
  priority?: string;
  appVersion?: string;
  buildNumber?: number;
  affectedService?: string;
  devicePlatform?: string;
  connectivityStatus?: string;
  errorDetails?: any;
}

export async function createSupportTicket(params: CreateTicketParams, db: PrismaClient = prisma) {
  const title = String(params.title || '').trim();
  const description = String(params.description || '').trim();
  if (title.length < 3) {
    const err: any = new Error('Título do chamado deve ter pelo menos 3 caracteres.');
    err.status = 400;
    throw err;
  }
  if (description.length < 10) {
    const err: any = new Error('Descrição do chamado deve ter pelo menos 10 caracteres.');
    err.status = 400;
    throw err;
  }

  const sanitizedErrors = params.errorDetails ? sanitizeDiagnosticInfo(params.errorDetails) : null;

  return db.supportTicket.create({
    data: {
      companyId: params.companyId,
      creatorUserId: params.creatorUserId,
      creatorName: params.creatorName,
      title,
      description: sanitizeDiagnosticInfo(description),
      category: params.category || 'QUESTION',
      priority: params.priority || 'MEDIUM',
      status: 'OPEN',
      appVersion: params.appVersion ? String(params.appVersion).slice(0, 32) : null,
      buildNumber: params.buildNumber ? Number(params.buildNumber) : null,
      affectedService: params.affectedService ? String(params.affectedService).slice(0, 64) : null,
      devicePlatform: params.devicePlatform ? String(params.devicePlatform).slice(0, 32) : null,
      connectivityStatus: params.connectivityStatus ? String(params.connectivityStatus).slice(0, 32) : null,
      sanitizedErrorDetails: sanitizedErrors,
    },
    include: {
      company: { select: { id: true, name: true, tradeName: true } },
      creatorUser: { select: { id: true, name: true, role: true } },
    },
  });
}

export async function listSupportTickets(
  filter: {
    companyId?: string;
    status?: string;
    priority?: string;
    category?: string;
    search?: string;
  },
  db: PrismaClient = prisma
) {
  const where: Prisma.SupportTicketWhereInput = {};
  if (filter.companyId) where.companyId = filter.companyId;
  if (filter.status) where.status = filter.status;
  if (filter.priority) where.priority = filter.priority;
  if (filter.category) where.category = filter.category;
  if (filter.search) {
    where.OR = [
      { title: { contains: filter.search, mode: 'insensitive' } },
      { description: { contains: filter.search, mode: 'insensitive' } },
    ];
  }

  return db.supportTicket.findMany({
    where,
    include: {
      company: { select: { id: true, name: true, tradeName: true } },
      creatorUser: { select: { id: true, name: true, role: true } },
      assignedUser: { select: { id: true, name: true, role: true } },
      _count: { select: { messages: true, attachments: true } },
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function getSupportTicketDetails(
  ticketId: string,
  userContext: { companyId?: string; isOwnerSupport: boolean },
  db: PrismaClient = prisma
) {
  const ticket = await db.supportTicket.findUnique({
    where: { id: ticketId },
    include: {
      company: { select: { id: true, name: true, tradeName: true } },
      creatorUser: { select: { id: true, name: true, role: true, email: true } },
      assignedUser: { select: { id: true, name: true, role: true } },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { attachments: true },
      },
      attachments: { where: { messageId: null } },
      accessGrants: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!ticket) {
    const err: any = new Error('Chamado não encontrado.');
    err.status = 404;
    throw err;
  }

  // Isolamento multi-tenant: usuário da empresa só acessa tickets da sua própria empresa
  if (!userContext.isOwnerSupport && userContext.companyId && ticket.companyId !== userContext.companyId) {
    const err: any = new Error('Acesso não autorizado a este chamado.');
    err.status = 403;
    throw err;
  }

  // Usuários da empresa não visualizam notas internas da equipe Lumora
  if (!userContext.isOwnerSupport) {
    ticket.messages = ticket.messages.filter((m) => !m.isInternalNote);
  }

  return ticket;
}

export async function addTicketMessage(
  params: {
    ticketId: string;
    authorUserId: string;
    authorName: string;
    authorRole: string;
    message: string;
    isInternalNote?: boolean;
    companyId?: string;
    isOwnerSupport: boolean;
  },
  db: PrismaClient = prisma
) {
  const ticket = await db.supportTicket.findUnique({
    where: { id: params.ticketId },
    select: { id: true, companyId: true, status: true },
  });
  if (!ticket) {
    const err: any = new Error('Chamado não encontrado.');
    err.status = 404;
    throw err;
  }

  if (!params.isOwnerSupport && params.companyId && ticket.companyId !== params.companyId) {
    const err: any = new Error('Acesso não autorizado a este chamado.');
    err.status = 403;
    throw err;
  }

  const isInternal = Boolean(params.isInternalNote && params.isOwnerSupport);

  const cleanMessage = sanitizeDiagnosticInfo(String(params.message || '').trim());
  if (cleanMessage.length < 1) {
    const err: any = new Error('Mensagem não pode ser vazia.');
    err.status = 400;
    throw err;
  }

  const msg = await db.supportTicketMessage.create({
    data: {
      ticketId: params.ticketId,
      authorUserId: params.authorUserId,
      authorName: params.authorName,
      authorRole: params.authorRole,
      message: cleanMessage,
      isInternalNote: isInternal,
    },
  });

  // Atualização automática de status de acordo com o autor
  let newStatus: string | undefined = undefined;
  if (!isInternal) {
    if (params.isOwnerSupport && ticket.status === 'OPEN') {
      newStatus = 'WAITING_COMPANY';
    } else if (!params.isOwnerSupport && ticket.status === 'WAITING_COMPANY') {
      newStatus = 'IN_PROGRESS';
    }
  }

  if (newStatus) {
    await db.supportTicket.update({
      where: { id: params.ticketId },
      data: { status: newStatus },
    });
  }

  return msg;
}

export async function updateTicketStatus(
  params: {
    ticketId: string;
    status: string;
    assignedToUserId?: string;
    assignedToName?: string;
    companyId?: string;
    isOwnerSupport: boolean;
  },
  db: PrismaClient = prisma
) {
  const ticket = await db.supportTicket.findUnique({
    where: { id: params.ticketId },
  });
  if (!ticket) {
    const err: any = new Error('Chamado não encontrado.');
    err.status = 404;
    throw err;
  }

  if (!params.isOwnerSupport && params.companyId && ticket.companyId !== params.companyId) {
    const err: any = new Error('Acesso não autorizado.');
    err.status = 403;
    throw err;
  }

  const VALID_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_COMPANY', 'RESOLVED', 'CLOSED'];
  if (!VALID_STATUSES.includes(params.status)) {
    const err: any = new Error(`Status inválido: ${params.status}`);
    err.status = 400;
    throw err;
  }

  const updateData: Prisma.SupportTicketUpdateInput = {
    status: params.status,
  };
  if (params.status === 'RESOLVED' && !ticket.resolvedAt) {
    updateData.resolvedAt = new Date();
  }
  if (params.status === 'CLOSED' && !ticket.closedAt) {
    updateData.closedAt = new Date();
  }
  if (params.assignedToUserId !== undefined && params.isOwnerSupport) {
    updateData.assignedUser = params.assignedToUserId
      ? { connect: { id: params.assignedToUserId } }
      : { disconnect: true };
    updateData.assignedToName = params.assignedToName || null;
  }

  return db.supportTicket.update({
    where: { id: params.ticketId },
    data: updateData,
  });
}

// =========================================================================
// FLUXO DE ACESSO DE SUPORTE TEMPORÁRIO AUTORIZADO
// =========================================================================

export async function requestSupportAccessGrant(
  params: {
    companyId: string;
    ticketId?: string;
    requestedByUserId: string;
    requestedByName: string;
    scope?: string;
    reason: string;
    durationMinutes?: number;
  },
  db: PrismaClient = prisma
) {
  const reason = String(params.reason || '').trim();
  if (reason.length < 5) {
    const err: any = new Error('Motivo da solicitação de suporte deve ter pelo menos 5 caracteres.');
    err.status = 400;
    throw err;
  }

  const ALLOWED_SCOPES = ['READ_ONLY', 'OPERATIONAL_SUPPORT', 'INTEGRATION_DEBUG'];
  const scope = String(params.scope || 'READ_ONLY').toUpperCase();
  if (!ALLOWED_SCOPES.includes(scope)) {
    const err: any = new Error(
      `Escopo de suporte inválido (${scope}). Permitidos: READ_ONLY, OPERATIONAL_SUPPORT, INTEGRATION_DEBUG. Ações financeiras gerais nunca são autorizadas por sessão de suporte.`
    );
    err.status = 400;
    throw err;
  }

  const durationMinutes = Math.min(Math.max(Number(params.durationMinutes) || 60, 15), 1440); // 15 min a 24 horas

  return db.supportAccessGrant.create({
    data: {
      companyId: params.companyId,
      ticketId: params.ticketId || null,
      requestedByUserId: params.requestedByUserId,
      requestedByName: params.requestedByName,
      scope,
      reason,
      durationMinutes,
      status: 'REQUESTED',
    },
  });
}

export async function approveSupportAccessGrant(
  params: {
    grantId: string;
    approvedByUserId: string;
    approvedByName: string;
    companyId: string;
    ipAddress?: string;
  },
  db: PrismaClient = prisma
) {
  const grant = await db.supportAccessGrant.findUnique({
    where: { id: params.grantId },
  });
  if (!grant) {
    const err: any = new Error('Solicitação de acesso de suporte não encontrada.');
    err.status = 404;
    throw err;
  }
  if (grant.companyId !== params.companyId) {
    const err: any = new Error('Apenas o responsável pela empresa dona dos dados pode autorizar o acesso de suporte.');
    err.status = 403;
    throw err;
  }
  if (grant.status !== 'REQUESTED') {
    const err: any = new Error(`Esta solicitação de suporte não está pendente (status atual: ${grant.status}).`);
    err.status = 409;
    throw err;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + grant.durationMinutes * 60 * 1000);
  const rawSessionToken = `sup_session_${crypto.randomBytes(24).toString('hex')}`;
  const sessionTokenHash = crypto.createHash('sha256').update(rawSessionToken).digest('hex');

  const updatedGrant = await db.supportAccessGrant.update({
    where: { id: params.grantId },
    data: {
      status: 'ACTIVE',
      approvedByUserId: params.approvedByUserId,
      approvedByName: params.approvedByName,
      grantedAt: now,
      expiresAt,
      sessionTokenHash,
      ipAddress: params.ipAddress || null,
    },
  });

  // Emite token JWT de suporte efêmero estritamente amarrado ao escopo e empresa
  const jwtSecret = process.env.JWT_SECRET || 'fallback_secret_only_for_tests';
  const ephemeralSupportJwt = jwt.sign(
    {
      id: grant.requestedByUserId,
      name: grant.requestedByName,
      role: 'SUPPORT_AUTHORIZED',
      supportGrantId: grant.id,
      companyId: grant.companyId,
      scope: grant.scope,
      isTemporarySupportSession: true,
    },
    jwtSecret,
    { expiresIn: `${grant.durationMinutes}m` }
  );

  return {
    grant: updatedGrant,
    rawSessionToken,
    ephemeralSupportJwt,
    expiresAt,
  };
}

export async function revokeSupportAccessGrant(
  params: {
    grantId: string;
    revokedByUserId: string;
    revokedByName: string;
    companyId?: string;
    reason?: string;
  },
  db: PrismaClient = prisma
) {
  const grant = await db.supportAccessGrant.findUnique({
    where: { id: params.grantId },
  });
  if (!grant) {
    const err: any = new Error('Concessão de suporte não encontrada.');
    err.status = 404;
    throw err;
  }

  if (params.companyId && grant.companyId !== params.companyId) {
    const err: any = new Error('Acesso não autorizado para revogar este suporte.');
    err.status = 403;
    throw err;
  }

  return db.supportAccessGrant.update({
    where: { id: params.grantId },
    data: {
      status: 'REVOKED',
      revokedAt: new Date(),
      revokedByUserId: params.revokedByUserId,
      revokedByName: params.revokedByName,
      revocationReason: params.reason || 'Revogado voluntariamente pelo responsável.',
    },
  });
}

export async function verifyActiveSupportGrant(grantId: string, db: PrismaClient = prisma) {
  const grant = await db.supportAccessGrant.findUnique({
    where: { id: grantId },
  });
  if (!grant) return { active: false, reason: 'NOT_FOUND' };

  if (grant.status === 'REVOKED') {
    return { active: false, reason: 'REVOKED' };
  }

  if (grant.expiresAt && grant.expiresAt < new Date()) {
    if (grant.status === 'ACTIVE') {
      await db.supportAccessGrant.update({
        where: { id: grantId },
        data: { status: 'EXPIRED' },
      });
    }
    return { active: false, reason: 'EXPIRED' };
  }

  if (grant.status !== 'ACTIVE') {
    return { active: false, reason: grant.status };
  }

  return { active: true, grant };
}
