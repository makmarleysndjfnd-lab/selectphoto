import { PrismaClient } from '@prisma/client';
import { sanitizeDiagnosticInfo } from './supportCentralService';

const prisma = new PrismaClient();

export interface InternalAlertParams {
  alertKey: string;
  companyId?: string;
  category: 'INTEGRATION_FAILURE' | 'QUOTA_LIMIT' | 'UNCLOSED_STATEMENT_DUE' | 'SYNC_STALLED' | 'SYSTEM_HEALTH';
  severity?: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  title: string;
  details?: any;
}

/**
 * Registra ou atualiza um alerta operacional interno de forma idempotente.
 * Sem disparos externos a clientes ou terceiros.
 */
export async function createOrUpdateInternalAlert(
  params: InternalAlertParams,
  db: PrismaClient = prisma
) {
  const sanitizedDetails = params.details ? sanitizeDiagnosticInfo(params.details) : null;

  return db.internalOperationalAlert.upsert({
    where: { alertKey: params.alertKey },
    create: {
      alertKey: params.alertKey,
      companyId: params.companyId || null,
      category: params.category,
      severity: params.severity || 'WARNING',
      title: String(params.title).slice(0, 255),
      details: sanitizedDetails,
      acknowledged: false,
    },
    update: {
      companyId: params.companyId || null,
      category: params.category,
      severity: params.severity || 'WARNING',
      title: String(params.title).slice(0, 255),
      details: sanitizedDetails,
      acknowledged: false, // Reabre caso ocorra novamente
      acknowledgedAt: null,
      acknowledgedByUserId: null,
      updatedAt: new Date(),
    },
  });
}

/**
 * Lista alertas operacionais internos para o painel de governança.
 */
export async function listInternalAlerts(
  filter: {
    companyId?: string;
    acknowledged?: boolean;
    category?: string;
    severity?: string;
  } = {},
  db: PrismaClient = prisma
) {
  const where: any = {};
  if (filter.companyId) where.companyId = filter.companyId;
  if (filter.acknowledged !== undefined) where.acknowledged = filter.acknowledged;
  if (filter.category) where.category = filter.category;
  if (filter.severity) where.severity = filter.severity;

  return db.internalOperationalAlert.findMany({
    where,
    include: {
      company: { select: { id: true, name: true, tradeName: true } },
    },
    orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
  });
}

/**
 * Reconhece / resolve um alerta operacional interno.
 */
export async function acknowledgeInternalAlert(
  alertId: string,
  userId: string,
  db: PrismaClient = prisma
) {
  return db.internalOperationalAlert.update({
    where: { id: alertId },
    data: {
      acknowledged: true,
      acknowledgedAt: new Date(),
      acknowledgedByUserId: userId,
    },
  });
}
