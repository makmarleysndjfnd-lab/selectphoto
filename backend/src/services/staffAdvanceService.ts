import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { recordOperationalAuditEvent } from './operationalAuditService';

export type AdvanceProfileRole = 'SELLER' | 'PHOTOGRAPHER';

export const VALID_ADVANCE_CATEGORIES = [
  'CLOSING_SHORTFALL',
  'PERSONAL_ADVANCE',
  'ROUTE_ADVANCE',
  'ADJUSTMENT_DIVERGENCE',
  'TRIP_EVENT_ADVANCE',
  'ROUTE_EXPENSE',
  'SETTLEMENT',
] as const;

export const SELLER_ADVANCE_CATEGORIES = [
  'CLOSING_SHORTFALL',
  'PERSONAL_ADVANCE',
  'ROUTE_ADVANCE',
  'ADJUSTMENT_DIVERGENCE',
] as const;

export const PHOTOGRAPHER_ADVANCE_CATEGORIES = [
  'TRIP_EVENT_ADVANCE',
  'PERSONAL_ADVANCE',
  'ROUTE_EXPENSE',
  'ADJUSTMENT_DIVERGENCE',
] as const;

export function normalizeProfileRole(rawRole: unknown): AdvanceProfileRole {
  const up = String(rawRole || '').trim().toUpperCase();
  if (up === 'PHOTOGRAPHER' || up === 'FOTOGRAFO') return 'PHOTOGRAPHER';
  return 'SELLER';
}

export function rolesForProfile(profileRole: AdvanceProfileRole): string[] {
  if (profileRole === 'PHOTOGRAPHER') {
    return ['PHOTOGRAPHER', 'FOTOGRAFO'];
  }
  return ['SELLER', 'SELLER_MANAGER', 'VENDEDOR'];
}

export interface AdvanceEntryLike {
  id: string;
  direction: string;
  amountCents: number;
  createdAt: Date | string;
  dueDate?: Date | string | null;
}

export interface ComputedAdvanceSummary {
  totalDebitsCents: number;
  totalCreditsCents: number;
  totalOpenCents: number;
  oldestOpenDays: number;
  oldestOpenCreatedAt: string | null;
  hasPastDueDate: boolean;
  isOverLimit: boolean;
  isOverdue: boolean;
  hasAlert: boolean;
}

export function computeUserAdvanceSummary(
  entries: AdvanceEntryLike[],
  config: { advanceAlertLimitCents?: number | null; advanceAlertDays?: number | null },
  nowMs = Date.now()
): ComputedAdvanceSummary {
  const limitCents = config.advanceAlertLimitCents ?? 50000;
  const alertDays = config.advanceAlertDays ?? 7;

  const sorted = [...entries].sort((a, b) => {
    const tA = new Date(a.createdAt).getTime();
    const tB = new Date(b.createdAt).getTime();
    if (tA !== tB) return tA - tB;
    return String(a.id).localeCompare(String(b.id));
  });

  let totalDebitsCents = 0;
  let totalCreditsCents = 0;
  const debits: Array<{ amountCents: number; createdAt: Date; dueDate: Date | null }> = [];

  for (const e of sorted) {
    const amt = Math.max(0, Math.round(Number(e.amountCents || 0)));
    if (e.direction === 'CREDIT') {
      totalCreditsCents += amt;
    } else if (e.direction === 'DEBIT') {
      totalDebitsCents += amt;
      debits.push({
        amountCents: amt,
        createdAt: new Date(e.createdAt),
        dueDate: e.dueDate ? new Date(e.dueDate) : null,
      });
    }
  }

  const totalOpenCents = Math.max(0, totalDebitsCents - totalCreditsCents);

  // Consome créditos em ordem FIFO para identificar a idade e o vencimento do débito em aberto mais antigo
  let creditToApply = totalCreditsCents;
  let oldestOpenCreatedAt: Date | null = null;
  let hasPastDueDate = false;

  for (const d of debits) {
    if (creditToApply >= d.amountCents) {
      creditToApply -= d.amountCents;
      continue;
    }
    creditToApply = 0;
    if (!oldestOpenCreatedAt) {
      oldestOpenCreatedAt = d.createdAt;
    }
    if (d.dueDate && d.dueDate.getTime() < nowMs) {
      hasPastDueDate = true;
    }
  }

  const oldestOpenDays =
    totalOpenCents > 0 && oldestOpenCreatedAt
      ? Math.max(0, Math.floor((nowMs - oldestOpenCreatedAt.getTime()) / 86400000))
      : 0;

  const isOverLimit = totalOpenCents > limitCents;
  const isOverdue = totalOpenCents > 0 && (oldestOpenDays > alertDays || hasPastDueDate);

  return {
    totalDebitsCents,
    totalCreditsCents,
    totalOpenCents,
    oldestOpenDays,
    oldestOpenCreatedAt: oldestOpenCreatedAt ? oldestOpenCreatedAt.toISOString() : null,
    hasPastDueDate,
    isOverLimit,
    isOverdue,
    hasAlert: isOverLimit || isOverdue,
  };
}

export async function getCompanyAdvanceConfig(
  companyId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma
) {
  const company = await tx.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      tradeName: true,
      companyPixKey: true,
      companyPixKeyType: true,
      advanceAlertLimitCents: true,
      advanceAlertDays: true,
    },
  });
  return {
    id: companyId,
    companyDisplayName: company?.tradeName?.trim() || company?.name?.trim() || 'Empresa',
    companyPixKey: company?.companyPixKey?.trim() || null,
    companyPixKeyType: company?.companyPixKeyType?.trim() || null,
    advanceAlertLimitCents: company?.advanceAlertLimitCents ?? 50000,
    advanceAlertDays: company?.advanceAlertDays ?? 7,
  };
}

export async function listAdvancesByCompanyRole(companyId: string, profileRole: AdvanceProfileRole) {
  const targetRoles = rolesForProfile(profileRole);

  const [companyConfig, users, entries] = await Promise.all([
    getCompanyAdvanceConfig(companyId),
    prisma.user.findMany({
      where: {
        companyId,
        active: true,
        role: { in: targetRoles },
      },
      select: {
        id: true,
        name: true,
        role: true,
        phone: true,
        pixKey: true,
      },
      orderBy: { name: 'asc' },
    }),
    prisma.staffAdvanceEntry.findMany({
      where: { companyId, profileRole },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);

  const entriesByUser = new Map<string, typeof entries>();
  for (const e of entries) {
    const arr = entriesByUser.get(e.userId) || [];
    arr.push(e);
    entriesByUser.set(e.userId, arr);
  }

  // Inclui usuários que possuam movimentações nesse profileRole mesmo se inativos/alterados
  const knownUserIds = new Set(users.map((u) => u.id));
  const extraUserIds = Array.from(entriesByUser.keys()).filter((id) => !knownUserIds.has(id));
  const extraUsers =
    extraUserIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: extraUserIds }, companyId },
          select: { id: true, name: true, role: true, phone: true, pixKey: true },
        })
      : [];

  const allUsers = [...users, ...extraUsers];

  let totalOpenCents = 0;
  let usersWithBalanceCount = 0;
  let usersOverAlertCount = 0;

  const items = allUsers
    .map((u) => {
      const userEntries = entriesByUser.get(u.id) || [];
      const summary = computeUserAdvanceSummary(userEntries, companyConfig);
      if (summary.totalOpenCents > 0) usersWithBalanceCount += 1;
      if (summary.hasAlert) usersOverAlertCount += 1;
      totalOpenCents += summary.totalOpenCents;
      const latestEntry = userEntries.length > 0 ? userEntries[userEntries.length - 1] : null;
      return {
        userId: u.id,
        name: u.name,
        role: u.role,
        profileRole,
        phone: u.phone || null,
        pixKey: u.pixKey || null,
        entriesCount: userEntries.length,
        lastMovementAt: latestEntry ? latestEntry.createdAt : null,
        ...summary,
      };
    })
    .sort((a, b) => {
      if (b.totalOpenCents !== a.totalOpenCents) return b.totalOpenCents - a.totalOpenCents;
      if (a.hasAlert !== b.hasAlert) return a.hasAlert ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return {
    profileRole,
    companyConfig,
    summary: {
      totalOpenCents,
      usersCount: items.length,
      usersWithBalanceCount,
      usersOverAlertCount,
    },
    professionals: items,
  };
}

export async function getUserAdvanceStatement(companyId: string, userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, companyId },
    select: {
      id: true,
      name: true,
      role: true,
      phone: true,
      pixKey: true,
      active: true,
    },
  });

  if (!user) {
    return null;
  }

  const profileRole = normalizeProfileRole(user.role);
  const [companyConfig, entries] = await Promise.all([
    getCompanyAdvanceConfig(companyId),
    prisma.staffAdvanceEntry.findMany({
      where: { companyId, userId },
      include: {
        batch: { select: { id: true, name: true, city: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);

  const summary = computeUserAdvanceSummary(entries, companyConfig);

  return {
    user: {
      ...user,
      profileRole,
    },
    companyConfig,
    summary,
    entries: [...entries].reverse(),
  };
}

export async function createDebitAdvance(params: {
  companyId: string;
  userId: string;
  profileRole: AdvanceProfileRole;
  category: string;
  amountCents: number;
  dueDate?: Date | null;
  notes?: string | null;
  receiptUrl?: string | null;
  signatureBase64?: string | null;
  batchId?: string | null;
  closingReference?: string | null;
  createdById?: string | null;
  createdByName?: string | null;
  tx?: Prisma.TransactionClient;
}) {
  const run = async (tx: Prisma.TransactionClient) => {
    const cleanRef = params.closingReference?.trim() || null;
    if (cleanRef) {
      const existing = await tx.staffAdvanceEntry.findFirst({
        where: {
          companyId: params.companyId,
          closingReference: cleanRef,
          direction: 'DEBIT',
        },
      });
      if (existing) {
        return { entry: existing, alreadyExisted: true };
      }
    }

    const entry = await tx.staffAdvanceEntry.create({
      data: {
        companyId: params.companyId,
        userId: params.userId,
        profileRole: params.profileRole,
        category: params.category,
        direction: 'DEBIT',
        amountCents: params.amountCents,
        dueDate: params.dueDate ?? null,
        notes: params.notes?.trim() || null,
        receiptUrl: params.receiptUrl?.trim() || null,
        signatureBase64: params.signatureBase64?.trim() || null,
        batchId: params.batchId || null,
        closingReference: cleanRef,
        createdById: params.createdById || null,
      },
      include: {
        batch: { select: { id: true, name: true, city: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    await recordOperationalAuditEvent(
      {
        companyId: params.companyId,
        category: 'PAYMENT',
        action: 'ADVANCE_DEBIT_CREATED',
        entityType: 'StaffAdvanceEntry',
        entityReference: `ADV-${entry.id.slice(0, 8)}`,
        entityId: entry.id,
        authorUserId: params.createdById || null,
        authorName: params.createdByName || 'Administrador',
        newValues: {
          targetUserId: params.userId,
          profileRole: params.profileRole,
          category: params.category,
          amountCents: params.amountCents,
          batchId: params.batchId || null,
          closingReference: cleanRef,
        },
        reason: params.notes?.trim() || null,
      },
      tx
    );

    return { entry, alreadyExisted: false };
  };

  if (params.tx) {
    return await run(params.tx);
  }
  return await prisma.$transaction(run);
}

export async function settleAdvance(params: {
  companyId: string;
  userId: string;
  amountCents: number;
  category?: string;
  notes?: string | null;
  receiptUrl?: string | null;
  batchId?: string | null;
  closingReference?: string | null;
  createdById?: string | null;
  createdByName?: string | null;
  tx?: Prisma.TransactionClient;
}) {
  const run = async (tx: Prisma.TransactionClient) => {
    const cleanRef = params.closingReference?.trim() || null;
    if (cleanRef) {
      const existing = await tx.staffAdvanceEntry.findFirst({
        where: {
          companyId: params.companyId,
          closingReference: cleanRef,
          direction: 'CREDIT',
        },
      });
      if (existing) {
        return { entry: existing, alreadyExisted: true, remainingOpenCents: null as number | null };
      }
    }

    const user = await tx.user.findFirst({
      where: { id: params.userId, companyId: params.companyId },
      select: { id: true, role: true, name: true },
    });
    if (!user) {
      throw { status: 404, message: 'Profissional não encontrado nesta empresa.' };
    }

    const existingEntries = await tx.staffAdvanceEntry.findMany({
      where: { companyId: params.companyId, userId: params.userId },
      select: { direction: true, amountCents: true },
    });

    let openCents = 0;
    for (const e of existingEntries) {
      if (e.direction === 'DEBIT') openCents += e.amountCents;
      else if (e.direction === 'CREDIT') openCents -= e.amountCents;
    }
    openCents = Math.max(0, openCents);

    if (openCents <= 0) {
      throw { status: 409, message: 'Profissional não possui saldo de vale em aberto para abater.' };
    }
    if (params.amountCents <= 0) {
      throw { status: 400, message: 'O valor do abatimento deve ser maior que zero.' };
    }
    if (params.amountCents > openCents) {
      throw {
        status: 400,
        message: `Valor de abatimento (${(params.amountCents / 100).toFixed(2)}) excede o saldo em aberto (${(openCents / 100).toFixed(2)}).`,
      };
    }

    const profileRole = normalizeProfileRole(user.role);
    const entry = await tx.staffAdvanceEntry.create({
      data: {
        companyId: params.companyId,
        userId: params.userId,
        profileRole,
        category: params.category || 'SETTLEMENT',
        direction: 'CREDIT',
        amountCents: params.amountCents,
        notes: params.notes?.trim() || null,
        receiptUrl: params.receiptUrl?.trim() || null,
        batchId: params.batchId || null,
        closingReference: cleanRef,
        createdById: params.createdById || null,
      },
      include: {
        batch: { select: { id: true, name: true, city: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    await recordOperationalAuditEvent(
      {
        companyId: params.companyId,
        category: 'PAYMENT',
        action: 'ADVANCE_CREDIT_SETTLED',
        entityType: 'StaffAdvanceEntry',
        entityReference: `ADV-${entry.id.slice(0, 8)}`,
        entityId: entry.id,
        authorUserId: params.createdById || null,
        authorName: params.createdByName || 'Administrador',
        previousValues: { openCents },
        newValues: {
          targetUserId: params.userId,
          profileRole,
          category: entry.category,
          amountCents: params.amountCents,
          remainingOpenCents: Math.max(0, openCents - params.amountCents),
          closingReference: cleanRef,
        },
        reason: params.notes?.trim() || null,
      },
      tx
    );

    return {
      entry,
      alreadyExisted: false,
      remainingOpenCents: Math.max(0, openCents - params.amountCents),
    };
  };

  if (params.tx) {
    return await run(params.tx);
  }
  return await prisma.$transaction(run, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

export async function getOpenAdvancesStatsSummary(companyId: string) {
  const entries = await prisma.staffAdvanceEntry.findMany({
    where: { companyId },
    select: {
      userId: true,
      profileRole: true,
      direction: true,
      amountCents: true,
    },
  });

  const userBalances = new Map<string, { profileRole: AdvanceProfileRole; openCents: number }>();
  for (const e of entries) {
    const role = normalizeProfileRole(e.profileRole);
    const cur = userBalances.get(e.userId) || { profileRole: role, openCents: 0 };
    cur.openCents += e.direction === 'DEBIT' ? e.amountCents : -e.amountCents;
    userBalances.set(e.userId, cur);
  }

  let totalVendedoresCents = 0;
  let totalFotografosCents = 0;
  let qtdVendedoresComSaldo = 0;
  let qtdFotografosComSaldo = 0;

  for (const bal of userBalances.values()) {
    const open = Math.max(0, bal.openCents);
    if (open <= 0) continue;
    if (bal.profileRole === 'PHOTOGRAPHER') {
      totalFotografosCents += open;
      qtdFotografosComSaldo += 1;
    } else {
      totalVendedoresCents += open;
      qtdVendedoresComSaldo += 1;
    }
  }

  return {
    totalVendedoresCents,
    totalFotografosCents,
    totalGeralCents: totalVendedoresCents + totalFotografosCents,
    qtdVendedoresComSaldo,
    qtdFotografosComSaldo,
  };
}
