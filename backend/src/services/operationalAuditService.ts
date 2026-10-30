import crypto from 'crypto';
import { PrismaClient, Prisma } from '@prisma/client';

const defaultPrisma = new PrismaClient();

export type OperationalAuditCategory =
  | 'PRICE'
  | 'DISCOUNT'
  | 'CONDITIONS'
  | 'BUYER_PHONE'
  | 'PAYMENT'
  | 'REVERSAL'
  | 'CONTRACT';

export const VALID_AUDIT_CATEGORIES: readonly OperationalAuditCategory[] = [
  'PRICE',
  'DISCOUNT',
  'CONDITIONS',
  'BUYER_PHONE',
  'PAYMENT',
  'REVERSAL',
  'CONTRACT',
] as const;

export type ReviewAlertStatus = 'PENDING_REVIEW' | 'REVIEWED_OK' | 'ADJUSTMENT_OPENED';

const FORBIDDEN_PII_KEYS = new Set([
  'children',
  'childname',
  'childnames',
  'photourl',
  'photopath',
  'sheetphotourl',
  'signatureurl',
  'signedagreementurl',
  'profilephotourl',
  'criminalrecordurl',
  'password',
  'apikey',
  'webhooktoken',
  'encryptedsecret',
]);

export function shortHashFingerprint(rawValue: string): string {
  const normalized = rawValue.trim();
  if (!normalized) return '';
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 8);
}

export function maskPhoneForAudit(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return '***';
  const fp = shortHashFingerprint(digits);
  if (digits.length >= 10) {
    const ddd = digits.slice(0, 2);
    const tail = digits.slice(-4);
    return `(${ddd}) *****-${tail} [ref:${fp}]`;
  }
  if (digits.length > 4) {
    return `****-${digits.slice(-4)} [ref:${fp}]`;
  }
  return `*** [ref:${fp}]`;
}

export function maskCpfForAudit(cpf?: string | null): string | null {
  if (!cpf) return null;
  const digits = String(cpf).replace(/\D/g, '');
  if (!digits) return '***';
  const tail = digits.slice(-2).padStart(2, '*');
  return `***.***.***-${tail}`;
}

export function maskPersonNameForAudit(name?: string | null): string | null {
  if (!name) return null;
  const trimmed = String(name).trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/).filter(Boolean);
  return parts
    .map((p) => (p.length <= 1 ? '*' : `${p[0]}***`))
    .slice(0, 3)
    .join(' ');
}

export function isTestOrSimulationMarker(text?: string | null): boolean {
  if (!text) return false;
  const upper = String(text).toUpperCase();
  return (
    upper.includes('HOMOLOG_') ||
    upper.includes('HOMOLOG_SEQ_') ||
    upper.includes('HOMOLOG_FIXTURE_') ||
    upper.includes('PAY_SIM_') ||
    upper.includes('_SIM') ||
    upper.includes('"ENVIRONMENT":"SANDBOX"') ||
    upper.includes('SANDBOX') ||
    upper.includes('SIMULATION') ||
    upper.includes('SIMULADO')
  );
}

function scrubFreeTextPii(input: string): string {
  // Mask formatted or raw CPF patterns (11 digits) and phone patterns (10-11 digits)
  let out = input.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, (m) => {
    const digits = m.replace(/\D/g, '');
    return `***.***.***-${digits.slice(-2)}`;
  });
  out = out.replace(/(?:\+?55\s*)?\(?\d{2}\)?\s*9?\d{4}-?\d{4}\b/g, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length >= 10) {
      return `(${digits.slice(0, 2)}) *****-${digits.slice(-4)}`;
    }
    return '*****-****';
  });
  return out;
}

export function sanitizeAuditPayload(value: unknown): Prisma.InputJsonValue | null {
  if (value === undefined || value === null) return null;

  const visit = (node: any, keyName?: string): any => {
    if (node === undefined || node === null) return null;
    const lowerKey = (keyName || '').toLowerCase();

    if (FORBIDDEN_PII_KEYS.has(lowerKey)) {
      return '[REDACTED_PROTECTED_MEDIA_OR_SECRET]';
    }

    if (typeof node === 'bigint') {
      return node.toString();
    }

    if (typeof node === 'number' || typeof node === 'boolean') {
      return node;
    }

    if (node instanceof Date) {
      return node.toISOString();
    }

    if (typeof node === 'string') {
      if (lowerKey.includes('phone') || lowerKey.includes('telefone') || lowerKey.includes('celular')) {
        return maskPhoneForAudit(node);
      }
      if (lowerKey.includes('cpf') || lowerKey.includes('documento')) {
        return maskCpfForAudit(node);
      }
      if (
        lowerKey === 'buyername' ||
        lowerKey === 'clientname' ||
        lowerKey === 'customername' ||
        lowerKey === 'nomecomprador'
      ) {
        return maskPersonNameForAudit(node);
      }
      if (lowerKey.includes('street') || lowerKey.includes('address') || lowerKey.includes('endereco')) {
        return '[ENDERECO_MASCARADO]';
      }
      return scrubFreeTextPii(node);
    }

    if (Array.isArray(node)) {
      return node.map((item) => visit(item));
    }

    if (typeof node === 'object') {
      const sanitizedObj: Record<string, any> = {};
      for (const [k, v] of Object.entries(node)) {
        const lk = k.toLowerCase();
        if (FORBIDDEN_PII_KEYS.has(lk)) continue;
        sanitizedObj[k] = visit(v, k);
      }
      return sanitizedObj;
    }

    return String(node);
  };

  return visit(value) as Prisma.InputJsonValue;
}

export interface RecordOperationalAuditInput {
  companyId?: string | null;
  category: OperationalAuditCategory;
  action: string;
  entityType: string;
  entityReference: string;
  entityId?: string | null;
  previousValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  reason?: string | null;
  authorUserId?: string | null;
  authorName: string;
  authorRole?: string | null;
  ipAddress?: string | null;
  isTestOrSimulation?: boolean;
  reviewAlert?: {
    alertType: string;
    severity?: 'INFO' | 'ATTENTION' | 'HIGH';
    summary: string;
    details?: Record<string, unknown>;
  } | null;
}

export async function recordOperationalAuditEvent(
  input: RecordOperationalAuditInput,
  txClient?: Prisma.TransactionClient | PrismaClient
) {
  const db = txClient || defaultPrisma;

  const detectedTest =
    Boolean(input.isTestOrSimulation) ||
    isTestOrSimulationMarker(input.entityReference) ||
    isTestOrSimulationMarker(input.reason || '');

  const safePrevious = sanitizeAuditPayload(input.previousValues);
  const safeNew = sanitizeAuditPayload(input.newValues);
  const safeReason = input.reason ? scrubFreeTextPii(String(input.reason).trim()) : null;
  const safeReference = scrubFreeTextPii(String(input.entityReference || 'SEM_REF').trim());

  const createdEvent = await db.operationalAuditEvent.create({
    data: {
      companyId: input.companyId || null,
      category: input.category,
      action: input.action,
      entityType: input.entityType,
      entityReference: safeReference,
      entityId: input.entityId || null,
      previousValues: safePrevious ?? Prisma.DbNull,
      newValues: safeNew ?? Prisma.DbNull,
      reason: safeReason,
      authorUserId: input.authorUserId || null,
      authorName: input.authorName || 'Sistema',
      authorRole: input.authorRole || null,
      isTestOrSimulation: detectedTest,
      ipAddress: input.ipAddress || null,
    },
  });

  let createdAlert = null;
  if (input.reviewAlert && input.companyId) {
    const safeAlertDetails = sanitizeAuditPayload(input.reviewAlert.details);
    createdAlert = await db.operationalReviewAlert.create({
      data: {
        companyId: input.companyId,
        auditEventId: createdEvent.id,
        alertType: input.reviewAlert.alertType,
        severity: input.reviewAlert.severity || 'ATTENTION',
        status: 'PENDING_REVIEW',
        entityType: input.entityType,
        entityReference: safeReference,
        entityId: input.entityId || null,
        summary: scrubFreeTextPii(input.reviewAlert.summary),
        details: safeAlertDetails ?? Prisma.DbNull,
        isTestOrSimulation: detectedTest,
      },
    });
  }

  return { event: createdEvent, alert: createdAlert };
}

export interface ListOperationalAuditFilter {
  companyId?: string;
  category?: string;
  startDate?: Date;
  endDate?: Date;
  entityReference?: string;
  includeSimulation?: boolean;
  limit?: number;
}

export async function listOperationalAuditEvents(
  filter: ListOperationalAuditFilter,
  dbClient: PrismaClient = defaultPrisma
) {
  const where: Prisma.OperationalAuditEventWhereInput = {};

  if (filter.companyId) {
    where.companyId = filter.companyId;
  }
  if (filter.category && VALID_AUDIT_CATEGORIES.includes(filter.category as OperationalAuditCategory)) {
    where.category = filter.category;
  }
  if (!filter.includeSimulation) {
    where.isTestOrSimulation = false;
  }
  if (filter.entityReference) {
    where.entityReference = { contains: filter.entityReference.trim(), mode: 'insensitive' };
  }
  if (filter.startDate || filter.endDate) {
    where.createdAt = {};
    if (filter.startDate) where.createdAt.gte = filter.startDate;
    if (filter.endDate) where.createdAt.lte = filter.endDate;
  }

  const limit = Math.min(Math.max(Number(filter.limit) || 100, 1), 300);

  const events = await dbClient.operationalAuditEvent.findMany({
    where,
    include: {
      company: {
        select: { id: true, name: true, tradeName: true },
      },
      reviewAlerts: {
        select: {
          id: true,
          alertType: true,
          severity: true,
          status: true,
          summary: true,
          reviewedAt: true,
          reviewedByName: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return {
    piiMaskedByDefault: true,
    policy: {
      piiMasking: 'ACTIVE_BY_DEFAULT',
      exposesPhotosOrChildData: false,
      clientConfirmationSaleBlocking: 'NOT_IMPLEMENTED_DEFERRED_EVOLUTION',
      alertSemantics: 'ADMINISTRATIVE_REVIEW_ONLY_NON_ACCUSATORY',
    },
    count: events.length,
    events,
  };
}

export async function listOperationalReviewAlerts(
  filter: {
    companyId?: string;
    status?: string;
    includeSimulation?: boolean;
    limit?: number;
  },
  dbClient: PrismaClient = defaultPrisma
) {
  const where: Prisma.OperationalReviewAlertWhereInput = {};
  if (filter.companyId) where.companyId = filter.companyId;
  if (filter.status) where.status = filter.status;
  if (!filter.includeSimulation) where.isTestOrSimulation = false;

  const limit = Math.min(Math.max(Number(filter.limit) || 100, 1), 300);

  const alerts = await dbClient.operationalReviewAlert.findMany({
    where,
    include: {
      company: {
        select: { id: true, name: true, tradeName: true },
      },
      auditEvent: {
        select: {
          id: true,
          category: true,
          action: true,
          previousValues: true,
          newValues: true,
          reason: true,
          authorName: true,
          authorRole: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return {
    piiMaskedByDefault: true,
    policy: {
      alertSemantics: 'ADMINISTRATIVE_REVIEW_ONLY_NON_ACCUSATORY',
      blocksSalesAutomatically: false,
      accusesFraudAutomatically: false,
    },
    count: alerts.length,
    alerts,
  };
}

export async function resolveOperationalReviewAlert(
  params: {
    alertId: string;
    status: 'REVIEWED_OK' | 'ADJUSTMENT_OPENED';
    reviewNotes: string;
    reviewerUserId: string;
    reviewerName: string;
  },
  dbClient: PrismaClient = defaultPrisma
) {
  if (params.status !== 'REVIEWED_OK' && params.status !== 'ADJUSTMENT_OPENED') {
    throw new Error('Status de revisão inválido. Use REVIEWED_OK ou ADJUSTMENT_OPENED.');
  }
  const cleanNotes = scrubFreeTextPii(String(params.reviewNotes || '').trim());
  if (cleanNotes.length < 5) {
    throw new Error('Informe uma observação administrativa de conferência (mínimo 5 caracteres).');
  }

  const existing = await dbClient.operationalReviewAlert.findUnique({
    where: { id: params.alertId },
  });
  if (!existing) {
    throw new Error('Alerta de revisão não encontrado.');
  }

  return dbClient.operationalReviewAlert.update({
    where: { id: params.alertId },
    data: {
      status: params.status,
      reviewNotes: cleanNotes,
      reviewedByUserId: params.reviewerUserId,
      reviewedByName: params.reviewerName,
      reviewedAt: new Date(),
    },
  });
}

