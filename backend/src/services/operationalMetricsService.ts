import { PrismaClient } from '@prisma/client';
import { sanitizeDiagnosticInfo } from './supportCentralService';
import { createOrUpdateInternalAlert } from './internalAlertService';

const prisma = new PrismaClient();

export interface OperationalMetricsFilter {
  companyId?: string;
  startDate?: Date;
  endDate?: Date;
}

export interface DeviceTelemetryPayload {
  userId: string;
  companyId: string;
  deviceId?: string;
  platform?: string;
  appVersion: string;
  buildNumber?: number;
  pendingOfflineCount?: number;
  pendingSummary?: any;
  connectivityStatus?: string;
  lastSyncAttemptAt?: Date;
}

/**
 * Registra ou atualiza telemetria de um aparelho mobile em campo.
 * Sanitiza estritamente qualquer dado antes da persistência.
 */
export async function recordDeviceTelemetry(
  payload: DeviceTelemetryPayload,
  db: PrismaClient = prisma
) {
  const sanitizedSummary = payload.pendingSummary
    ? sanitizeDiagnosticInfo(payload.pendingSummary)
    : null;

  const count = Math.max(0, Number(payload.pendingOfflineCount) || 0);

  const created = await db.deviceTelemetry.create({
    data: {
      userId: payload.userId,
      companyId: payload.companyId,
      deviceId: payload.deviceId ? String(payload.deviceId).slice(0, 64) : null,
      platform: payload.platform ? String(payload.platform).toUpperCase().slice(0, 32) : 'ANDROID',
      appVersion: String(payload.appVersion || 'unknown').slice(0, 32),
      buildNumber: payload.buildNumber ? Number(payload.buildNumber) : null,
      pendingOfflineCount: count,
      pendingSummary: sanitizedSummary,
      connectivityStatus: payload.connectivityStatus
        ? String(payload.connectivityStatus).slice(0, 32)
        : null,
      lastSyncAttemptAt: payload.lastSyncAttemptAt || null,
      lastReportedAt: new Date(),
    },
  });

  // Se o dispositivo estiver acumulando fila offline elevada (>= 10),
  // dispara ou atualiza um alerta operacional interno de retenção de dados
  if (count >= 10 && payload.companyId) {
    try {
      const devKey = payload.deviceId ? payload.deviceId.slice(0, 16) : payload.userId.slice(0, 8);
      await createOrUpdateInternalAlert(
        {
          alertKey: `sync_stalled_${payload.companyId}_${devKey}`,
          companyId: payload.companyId,
          category: 'SYNC_STALLED',
          severity: count >= 50 ? 'CRITICAL' : 'WARNING',
          title: `Fila offline elevada no aparelho (${count} pendências retidas)`,
          details: {
            deviceId: payload.deviceId,
            platform: payload.platform,
            pendingOfflineCount: count,
            pendingSummary: sanitizedSummary,
          },
        },
        db
      );
    } catch (err) {
      console.error('[Telemetry] Falha ao registrar alerta de fila offline:', err);
    }
  }

  return created;
}

/**
 * Retorna status operacional agregado para o painel (proprietário ou empresa).
 * Cumpre a regra estrita:
 * "Pendências offline só aparecem após telemetria do aparelho; indicar data da última informação ou 'sem telemetria'."
 */
export async function getAggregatedOperationalMetrics(
  filter: OperationalMetricsFilter = {},
  db: PrismaClient = prisma
) {
  const clientWhere: any = {};
  const saleWhere: any = {};
  const creditWhere: any = {};
  const telemetryWhere: any = {};
  const asaasSyncWhere: any = {};

  if (filter.companyId) {
    clientWhere.companyId = filter.companyId;
    saleWhere.companyId = filter.companyId;
    creditWhere.companyId = filter.companyId;
    telemetryWhere.companyId = filter.companyId;
    asaasSyncWhere.companyId = filter.companyId;
  }

  if (filter.startDate || filter.endDate) {
    clientWhere.createdAt = {};
    saleWhere.date = {};
    creditWhere.createdAt = {};
    if (filter.startDate) {
      clientWhere.createdAt.gte = filter.startDate;
      saleWhere.date.gte = filter.startDate;
      creditWhere.createdAt.gte = filter.startDate;
    }
    if (filter.endDate) {
      clientWhere.createdAt.lte = filter.endDate;
      saleWhere.date.lte = filter.endDate;
      creditWhere.createdAt.lte = filter.endDate;
    }
  }

  // 1. Quantidades de fichas por etapa (status, bookStatus, outcomeStatus)
  const [
    totalClients,
    clientsByStatusRaw,
    clientsByOutcomeRaw,
    totalSales,
    salesAggregate,
    creditAgreementsRaw,
    syncErrorsCount,
    internalAlertsCount,
    latestTelemetries,
  ] = await Promise.all([
    db.client.count({ where: clientWhere }),
    db.client.groupBy({
      by: ['status'],
      where: clientWhere,
      _count: { id: true },
    }),
    db.client.groupBy({
      by: ['outcomeStatus'],
      where: clientWhere,
      _count: { id: true },
    }),

    // 2. Vendas
    db.sale.count({ where: saleWhere }),
    db.sale.aggregate({
      where: saleWhere,
      _sum: { value: true },
      _avg: { value: true },
    }),

    // 3. Contratos de crediário / parcelamentos
    db.creditAgreement.groupBy({
      by: ['status'],
      where: creditWhere,
      _count: { id: true },
      _sum: {
        totalSaleCents: true,
        financedPrincipalCents: true,
        paidPrincipalCents: true,
        remainingPrincipalCents: true,
      },
    }),

    // 4. Erros de sincronização (AsaasSyncQueue com erro/falha)
    db.asaasSyncQueue.count({
      where: {
        ...asaasSyncWhere,
        status: { in: ['FAILED', 'ERROR'] },
      },
    }),

    // Alertas internos operacionais não resolvidos
    db.internalOperationalAlert.count({
      where: {
        ...(filter.companyId ? { companyId: filter.companyId } : {}),
        acknowledged: false,
      },
    }),

    // 5. Telemetria de Aparelhos (Pendências offline)
    // Busca os registros mais recentes (últimas 48 horas)
    db.deviceTelemetry.findMany({
      where: {
        ...telemetryWhere,
        lastReportedAt: {
          gte: new Date(Date.now() - 48 * 60 * 60 * 1000),
        },
      },
      orderBy: { lastReportedAt: 'desc' },
      take: 100,
      include: {
        user: { select: { id: true, name: true, role: true } },
      },
    }),
  ]);

  // Formatação das fichas por status
  const fichasPorStatus: Record<string, number> = {};
  for (const item of clientsByStatusRaw) {
    fichasPorStatus[item.status] = item._count.id;
  }
  const fichasPorDesfecho: Record<string, number> = {};
  for (const item of clientsByOutcomeRaw) {
    fichasPorDesfecho[item.outcomeStatus] = item._count.id;
  }

  // Formatação dos contratos
  const contratos = {
    total: 0,
    porStatus: {} as Record<string, number>,
    totalFinanciadoCents: 0,
    totalPagoCents: 0,
    totalRestanteCents: 0,
  };
  for (const c of creditAgreementsRaw) {
    contratos.total += c._count.id;
    contratos.porStatus[c.status] = c._count.id;
    contratos.totalFinanciadoCents += c._sum.financedPrincipalCents || 0;
    contratos.totalPagoCents += c._sum.paidPrincipalCents || 0;
    contratos.totalRestanteCents += c._sum.remainingPrincipalCents || 0;
  }

  // Apuração estrita da telemetria offline
  // Agrupa pelo aparelho mais recente de cada usuário
  const userLatestMap = new Map<string, (typeof latestTelemetries)[0]>();
  for (const t of latestTelemetries) {
    const key = `${t.userId}_${t.deviceId || 'default'}`;
    if (!userLatestMap.has(key)) {
      userLatestMap.set(key, t);
    }
  }

  const distinctAparelhos = Array.from(userLatestMap.values());
  let pendenciasOfflineInfo: {
    status: 'SEM_TELEMETRIA_DO_APARELHO' | 'TELEMETRIA_DISPONIVEL';
    dataUltimaInformacao: string | null;
    aparelhosComFila: number;
    totalPendenciasOffline: number | null;
    aviso: string;
    amostraAparelhos: Array<{
      vendedor: string;
      plataforma: string;
      versaoApp: string;
      pendencias: number;
      conectividade: string | null;
      ultimaComunicacao: string;
    }>;
  };

  if (distinctAparelhos.length === 0) {
    pendenciasOfflineInfo = {
      status: 'SEM_TELEMETRIA_DO_APARELHO',
      dataUltimaInformacao: null,
      aparelhosComFila: 0,
      totalPendenciasOffline: null,
      aviso: 'Pendências offline só aparecem após telemetria do aparelho; sem comunicação recente registrada.',
      amostraAparelhos: [],
    };
  } else {
    let sumPending = 0;
    let countWithQueue = 0;
    let maxDate = new Date(0);

    const amostra = distinctAparelhos.map((d) => {
      if (d.pendingOfflineCount > 0) countWithQueue += 1;
      sumPending += d.pendingOfflineCount;
      if (d.lastReportedAt > maxDate) maxDate = d.lastReportedAt;

      return {
        vendedor: d.user?.name || 'Operador',
        plataforma: d.platform,
        versaoApp: d.appVersion,
        pendencias: d.pendingOfflineCount,
        conectividade: d.connectivityStatus,
        ultimaComunicacao: d.lastReportedAt.toISOString(),
      };
    });

    pendenciasOfflineInfo = {
      status: 'TELEMETRIA_DISPONIVEL',
      dataUltimaInformacao: maxDate.getTime() > 0 ? maxDate.toISOString() : null,
      aparelhosComFila: countWithQueue,
      totalPendenciasOffline: sumPending,
      aviso: 'Telemetria operacional recebida dos aparelhos ativos em campo.',
      amostraAparelhos: amostra.slice(0, 10),
    };
  }

  const grossSalesTotalBrl = Number(salesAggregate._sum.value || 0);

  return {
    fichas: {
      total: totalClients,
      porStatus: fichasPorStatus,
      porDesfecho: fichasPorDesfecho,
    },
    vendas: {
      totalQuantidade: totalSales,
      valorTotalBrl: grossSalesTotalBrl,
      ticketMedioBrl: totalSales > 0 ? grossSalesTotalBrl / totalSales : 0,
    },
    contratos,
    sincronizacaoEErros: {
      falhasIntegracaoAsaas: syncErrorsCount,
      alertasOperacionaisNaoReconhecidos: internalAlertsCount,
      statusGeral: syncErrorsCount === 0 && internalAlertsCount === 0 ? 'HEALTHY' : 'WARNING',
    },
    pendenciasOfflineAparelhos: pendenciasOfflineInfo,
    geradoEm: new Date().toISOString(),
  };
}

