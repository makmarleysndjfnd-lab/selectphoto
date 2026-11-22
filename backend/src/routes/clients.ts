import { Router, Request, Response } from 'express';
import { prisma } from '../services/prisma';
import { randomUUID } from 'crypto';
import { authenticateToken, AuthRequest, requireAdminOrSupervisor } from '../middleware/authMiddleware';
import { getNextVisibleCode } from '../utils/visibleCode';
import { isClientClosedForPhotographer, sanitizeClientForPhotographer } from '../utils/photographerIsolation';
import { recordOperationalAuditEvent } from '../services/operationalAuditService';
import {
  calculateReboloValidityStatus,
  MAX_REBOLO_VALIDITY_DAYS,
  MIN_REBOLO_VALIDITY_DAYS,
  normalizeReboloValidityDays,
  resolveReboloEnteredAt,
  resolveReboloOrigin,
} from '../services/reboloValidityService';

const router = Router();

const CLIENT_MANAGER_OR_BACKOFFICE_ROLES = new Set([
  'ADMIN',
  'COMPANY_ADMIN',
  'SUPER_ADMIN',
  'SUPERVISOR',
  'SELLER_MANAGER',
  'GRAPHIC',
  'OPERATOR',
]);

function isSellerWalletRestricted(role?: string | null): boolean {
  if (!role) return true;
  if (role === 'PHOTOGRAPHER') return false;
  return !CLIENT_MANAGER_OR_BACKOFFICE_ROLES.has(role);
}


// Allowed client fields for sync
const ALLOWED_SYNC_CLIENT_FIELDS = [
  'name', 'phone1', 'phone2', 'cep', 'street', 'number', 'complement', 'condo',
  'block', 'apartment', 'neighborhood', 'city', 'state', 'referencePoint',
  'houseColor', 'gateColor', 'gateObservation', 'profession', 'visitTime',
  'clothesColor', 'notes', 'teamId', 'latitude', 'longitude', 'geocoded', 'event',
  'batchId'
] as const;

// Sync clients from mobile (batch)
router.post('/sync', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { clients } = req.body;
  const companyId = req.user?.companyId;

  if (!companyId) {
    res.status(403).json({ error: 'Company association is required for client sync' });
    return;
  }

  if (!Array.isArray(clients)) {
    res.status(400).json({ error: 'Expected an array of clients' });
    return;
  }

  const results = {
    success: 0,
    synced: 0,
    failed: 0,
    details: [] as Array<{
      sequenceNumber: string;
      uuid?: string;
      visibleCode?: string | null;
      success: boolean;
      error?: string;
      reason?: string;
      id?: string;
    }>
  };

  for (const clientData of clients) {
    try {
      if (!clientData || (!clientData.sequenceNumber && !clientData.uuid && !clientData.localId)) {
        results.failed++;
        results.details.push({
          sequenceNumber: '',
          success: false,
          error: 'Ficha sem identificador permanente ou sequenceNumber',
          reason: 'Ficha sem identificador permanente ou sequenceNumber'
        });
        continue;
      }

      const seqNum = String(clientData.sequenceNumber || '').trim();
      const rawUuid = clientData.uuid || clientData.localId;
      const clientUuid = rawUuid ? String(rawUuid).trim() : randomUUID();
      const clientLocalId = clientData.localId ? String(clientData.localId).trim() : null;

      // Sanitizar dados aceitos
      const sanitizedData: Record<string, any> = {};
      for (const field of ALLOWED_SYNC_CLIENT_FIELDS) {
        if (clientData[field] !== undefined) {
          sanitizedData[field] = clientData[field];
        }
      }

      let photographerId = clientData.photographerId || null;
      let assignedSellerId = clientData.assignedSellerId || null;

      if (!photographerId && req.user?.role === 'PHOTOGRAPHER') {
        photographerId = req.user.id;
      }
      if (!assignedSellerId && (req.user?.role === 'SELLER' || req.user?.role === 'SELLER_MANAGER')) {
        assignedSellerId = req.user.id;
      }

      // Validar que fotógrafo e vendedor pertencem à mesma empresa
      if (photographerId) {
        const photoUser = await prisma.user.findFirst({
          where: { id: photographerId, companyId },
        });
        if (!photoUser) photographerId = null;
      }

      if (assignedSellerId) {
        const sellerUser = await prisma.user.findFirst({
          where: { id: assignedSellerId, companyId },
        });
        if (!sellerUser) assignedSellerId = null;
      }

      let finalSignatureUrl = clientData.signatureUrl || null;
      if (clientData.signatureBase64) {
        finalSignatureUrl = `data:image/png;base64,${clientData.signatureBase64}`;
      }

      // Gerenciamento de batchId offline, validação de posse e auto-criação resiliente
      if (sanitizedData.batchId) {
        const batchExists = await prisma.bookBatch.findUnique({
          where: { id: sanitizedData.batchId }
        });
        if (batchExists) {
          if (batchExists.companyId !== companyId && req.user?.role !== 'SUPER_ADMIN') {
            results.failed++;
            results.details.push({
              sequenceNumber: seqNum || clientUuid,
              uuid: clientUuid,
              success: false,
              error: 'Lote associado pertence a outra empresa',
              reason: 'Lote associado pertence a outra empresa',
            });
            continue;
          }
        } else {
          // Lote criado offline no app que ainda não existe no banco oficial:
          // Cria automaticamente como CREATED vinculado ao fotógrafo autenticado e sua empresa
          const eventTitle = sanitizedData.event || 'Evento';
          const batchCity = sanitizedData.city?.trim() || null;
          const batchName = batchCity
            ? `Lote - ${eventTitle} (${batchCity})`
            : `Lote - ${eventTitle}`;

          await prisma.bookBatch.create({
            data: {
              id: sanitizedData.batchId,
              name: batchName,
              city: batchCity,
              photographerId: photographerId || req.user?.id!,
              companyId,
              status: 'CREATED',
              totalProduced: 0
            }
          });
        }
      } else if (photographerId) {
        // Auto-vincular ao lote ativo do fotógrafo se não especificado
        const activeBatch = await prisma.bookBatch.findFirst({
          where: { photographerId, companyId, status: 'CREATED' },
          orderBy: { date: 'desc' }
        });
        if (activeBatch) {
          sanitizedData.batchId = activeBatch.id;
        }
      }

      // 1. Localizar se já existe ficha com esse UUID permanente
      let existing = await prisma.client.findUnique({
        where: { uuid: clientUuid },
      });

      // Fallback para fichas legadas que vieram apenas com sequenceNumber
      if (!existing && seqNum) {
        existing = await prisma.client.findFirst({
          where: { sequenceNumber: seqNum },
        });
      }

      if (existing) {
        if (existing.companyId !== companyId) {
          // Pertence a OUTRA empresa: NUNCA sobrescrever ou alterar cliente de outra empresa
          results.failed++;
          results.details.push({
            sequenceNumber: seqNum || existing.sequenceNumber,
            uuid: clientUuid,
            success: false,
            error: 'Ficha já cadastrada em outra empresa',
            reason: 'Ficha já cadastrada em outra empresa',
          });
          continue;
        }

        // Pertence à mesma empresa: retentativa idempotente legítima
        // Se a ficha já avançou além de CREATED, mantemos o estado e retornamos sucesso idempotente
        // a menos que seja um localId diferente (colisão de sequenceNumber entre dois clientes locais)
        if (existing.bookStatus !== 'CREATED') {
          if (clientLocalId && existing.localId && clientLocalId !== existing.localId) {
            results.failed++;
            results.details.push({
              sequenceNumber: existing.sequenceNumber,
              uuid: clientUuid,
              success: false,
              error: 'Colisão de sequência com ficha existente',
              reason: 'Colisão de sequência com ficha existente',
            });
            continue;
          }

          results.success++;
          results.synced++;
          results.details.push({
            sequenceNumber: existing.sequenceNumber,
            uuid: existing.uuid,
            visibleCode: existing.visibleCode,
            success: true,
            id: existing.id
          });
          continue;
        }

        // Se ainda está em CREATED, atualiza com os dados mais recentes do formulário
        const validChildrenToSync = Array.isArray(clientData.children)
          ? clientData.children
              .filter((c: any) => String(c?.name || '').trim().length > 0)
              .map((c: any) => ({
                name: String(c.name).trim(),
                age: typeof c.age === 'string' ? (parseInt(c.age, 10) || 0) : (c.age || 0),
              }))
          : null;

        if (validChildrenToSync) {
          await prisma.child.deleteMany({ where: { clientId: existing.id } });
          if (validChildrenToSync.length > 0) {
            await prisma.child.createMany({
              data: validChildrenToSync.map((c: any) => ({
                name: c.name,
                age: c.age,
                clientId: existing.id,
              })),
            });
          }
        }

        const updated = await prisma.client.update({
          where: { id: existing.id },
          data: {
            ...sanitizedData,
            ...(clientLocalId && !existing.localId ? { localId: clientLocalId } : {}),
            ...(finalSignatureUrl ? { signatureUrl: finalSignatureUrl } : {}),
            status: 'SYNCED',
            ...(photographerId ? { photographerId } : {}),
            ...(assignedSellerId ? { assignedSellerId } : {}),
          },
        });
        results.success++;
        results.synced++;
        results.details.push({
          sequenceNumber: updated.sequenceNumber,
          uuid: updated.uuid,
          visibleCode: updated.visibleCode,
          success: true,
          id: updated.id
        });
        continue;
      }

      // 2. Ficha nova: criação atômica com geração de visibleCode
      const { created } = await prisma.$transaction(async (tx) => {
        const visibleCode = await getNextVisibleCode(tx);
        const validNewChildren = Array.isArray(clientData.children)
          ? clientData.children
              .filter((c: any) => String(c?.name || '').trim().length > 0)
              .map((c: any) => ({
                name: String(c.name).trim(),
                age: typeof c.age === 'string' ? (parseInt(c.age, 10) || 0) : (c.age || 0),
              }))
          : [];

        const newClient = await tx.client.create({
          data: {
            ...sanitizedData,
            name: sanitizedData.name || 'Cliente sem nome',
            uuid: clientUuid,
            visibleCode,
            sequenceNumber: seqNum || visibleCode,
            localId: clientLocalId,
            signatureUrl: finalSignatureUrl,
            status: 'SYNCED',
            bookStatus: 'CREATED',
            commercialCycle: 1,
            companyId,
            photographerId,
            assignedSellerId,
            children: validNewChildren.length > 0
              ? {
                  create: validNewChildren,
                }
              : undefined,
          },
        });

        await tx.clientTimeline.create({
          data: {
            clientId: newClient.id,
            cycle: 1,
            action: 'CREATED',
            newStatus: 'CREATED',
            authorId: req.user?.id || photographerId || null,
            authorRole: req.user?.role || null,
            metadata: {
              source: 'sync',
              uuid: clientUuid,
              visibleCode,
              sequenceNumber: seqNum || visibleCode,
              localId: clientLocalId,
              event: sanitizedData.event || null,
              city: sanitizedData.city || null,
            },
          },
        });

        return { created: newClient };
      });

      results.success++;
      results.synced++;
      results.details.push({
        sequenceNumber: created.sequenceNumber,
        uuid: created.uuid,
        visibleCode: created.visibleCode,
        success: true,
        id: created.id
      });
    } catch (error: any) {
      console.error('Error syncing client:', error);
      results.failed++;
      results.details.push({
        sequenceNumber: String(clientData?.sequenceNumber || ''),
        uuid: clientData?.uuid ? String(clientData.uuid) : undefined,
        success: false,
        error: error.message,
        reason: error.message
      });
    }
  }

  res.json(results);
});

// Get all clients (Admin, Supervisor or User in company - exclui fichas em produção do fotógrafo)
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    if (req.user?.role === 'PHOTOGRAPHER') {
      return res.status(403).json({ error: 'Acesso restrito. Fotógrafos devem utilizar a rota de produção /clients/photographer.' });
    }

    const sellerOnlyWalletFilter = isSellerWalletRestricted(req.user?.role)
      ? { assignedSellerId: req.user?.id }
      : {};
    const activeBookOnly = req.query.activeBookOnly === 'true';

    const clients = await prisma.client.findMany({
      where: { 
        companyId,
        ...(activeBookOnly
          ? {
              bookStatus: { in: ['AWAITING_RELEASE', 'IN_STOCK', 'DISTRIBUTED'] },
              cityClosedAt: null,
            }
          : {
              bookStatus: { not: 'CREATED' },
            }),
        ...sellerOnlyWalletFilter,
      },
      include: { 
        children: true, 
        appointments: true, 
        assignedSeller: true, 
        photographer: { select: { id: true, name: true } },
        batch: { select: { id: true, name: true, status: true } }
      }
    });

    const enrichedClients = clients.map((c) => {
      const sellerName = c.assignedSeller?.name || null;
      const batchName = c.batch?.name || null;
      const trackingLocationType = sellerName
        ? 'SELLER'
        : c.batchId
        ? 'BATCH'
        : 'UNASSIGNED';
      const trackingLocationLabel = sellerName
        ? `Com vendedor: ${sellerName}`
        : batchName
        ? `No lote: ${batchName}`
        : 'Sem lote atribuído';

      return {
        ...c,
        trackingLocationType,
        trackingLocationLabel,
      };
    });

    res.json(enrichedClients);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

// Resumo gerencial de fichas em produção (Admin visualiza resumo por fotógrafo, local e lote, sem acesso às fichas individuais)
router.get('/production-summary', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    const createdClients = await prisma.client.findMany({
      where: {
        ...(userCompanyId ? { companyId: userCompanyId } : {}),
        bookStatus: 'CREATED',
      },
      select: {
        id: true,
        photographerId: true,
        photographer: { select: { id: true, name: true } },
        city: true,
        event: true,
        batchId: true,
        batch: { select: { id: true, name: true } },
      },
    });

    const groups: Record<string, {
      photographerId: string | null;
      photographerName: string;
      city: string;
      event: string;
      batchName: string;
      count: number;
      status: string;
    }> = {};

    for (const c of createdClients) {
      const pId = c.photographerId || 'sem_fotografo';
      const pName = c.photographer?.name || (c.photographerId ? `Fotógrafo #${c.photographerId.slice(0, 8)}` : 'Sem fotógrafo');
      const city = (c.city || 'Sem cidade').trim();
      const event = (c.event || 'Evento sem nome').trim();
      const batchName = c.batch?.name || 'Em produção na câmera';
      const key = `${pId}|${city}|${event}|${batchName}`;

      if (!groups[key]) {
        groups[key] = {
          photographerId: c.photographerId,
          photographerName: pName,
          city,
          event,
          batchName,
          count: 0,
          status: 'Em produção',
        };
      }
      groups[key].count++;
    }

    res.json(Object.values(groups));
  } catch (error: any) {
    console.error('Error fetching production summary:', error);
    res.status(500).json({ error: 'Falha ao buscar resumo de produção' });
  }
});

// Release city for routing (sets releasedForRouting = true)
router.put('/release-city', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId) return res.status(403).json({ error: 'Empresa não identificada' });

    const { city } = req.body;
    if (!city) {
      res.status(400).json({ error: 'City is required' });
      return;
    }

    const updated = await prisma.client.updateMany({
      where: {
        companyId: userCompanyId,
        city: city,
        releasedForRouting: false
      },
      data: {
        releasedForRouting: true
      }
    });

    res.json({ message: 'Lotes liberados com sucesso!', count: updated.count });
  } catch (error) {
    res.status(500).json({ error: 'Failed to release city for routing' });
  }
});

// Confirm arrival from gráfica — moves AWAITING_RELEASE → IN_STOCK scoped by exact clientIds or eventName + city
router.put('/confirm-grafica', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId) return res.status(403).json({ error: 'Empresa não identificada' });

    const { city, event, eventName, clientIds } = req.body;
    const targetEvent = event || eventName;

    const whereClause: any = {
      companyId: userCompanyId,
      bookStatus: 'AWAITING_RELEASE'
    };

    if (Array.isArray(clientIds) && clientIds.length > 0) {
      const sanitizedIds = Array.from(new Set(clientIds.map((id: any) => String(id).trim()))).filter(Boolean);
      whereClause.id = { in: sanitizedIds };
    } else {
      if (!city && !targetEvent) {
        return res.status(400).json({ error: 'É necessário informar clientIds, ou evento e cidade para confirmar a chegada da gráfica.' });
      }
      if (city) {
        whereClause.city = { equals: String(city).trim(), mode: 'insensitive' };
      }
      if (targetEvent) {
        whereClause.event = { equals: String(targetEvent).trim(), mode: 'insensitive' };
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const clientsToUpdate = await tx.client.findMany({
        where: whereClause,
        select: { id: true, batchId: true }
      });

      if (clientsToUpdate.length === 0) {
        return { count: 0 };
      }

      const clientIdsToUpdate = clientsToUpdate.map(c => c.id);
      const updateResult = await tx.client.updateMany({
        where: { id: { in: clientIdsToUpdate } },
        data: {
          bookStatus: 'IN_STOCK'
        }
      });

      const batchIds = Array.from(new Set(clientsToUpdate.map(c => c.batchId).filter(Boolean))) as string[];
      for (const batchId of batchIds) {
        const remainingUnreleased = await tx.client.count({
          where: { batchId, bookStatus: { in: ['AWAITING_RELEASE', 'CREATED'] } }
        });
        if (remainingUnreleased === 0) {
          await tx.bookBatch.updateMany({
            where: { id: batchId },
            data: { status: 'IN_STOCK' }
          });
        }
      }

      return { count: updateResult.count };
    });

    res.json({ message: `${updated.count} fichas movidas para estoque!`, count: updated.count });
  } catch (error) {
    console.error('Erro ao confirmar gráfica:', error);
    res.status(500).json({ error: 'Falha ao confirmar chegada da gráfica' });
  }
});

// Get clients by city and optional bookStatus (for gráfica/estoque flow)
router.get('/by-city', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId) return res.status(403).json({ error: 'Empresa não identificada' });

    if (req.user?.role === 'PHOTOGRAPHER') {
      return res.status(403).json({ error: 'Acesso não autorizado para fotógrafo' });
    }

    const { city, bookStatus } = req.query as { city?: string; bookStatus?: string };
    const sellerOnlyWalletFilter = isSellerWalletRestricted(req.user?.role)
      ? { assignedSellerId: req.user?.id }
      : {};

    const clients = await prisma.client.findMany({
      where: {
        companyId: userCompanyId,
        ...sellerOnlyWalletFilter,
        ...(city ? { city: { equals: city as string, mode: 'insensitive' } } : {}),
        ...(bookStatus ? { bookStatus: bookStatus as string } : {})
      },
      include: { assignedSeller: true, team: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(clients);
  } catch (error) {
    res.status(500).json({ error: 'Falha ao buscar fichas por cidade' });
  }
});

// Consultar configuração de validade do Rebolo da empresa
router.get('/rebolo-settings', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId) return res.status(403).json({ error: 'Empresa não identificada' });

    const company = await prisma.company.findUnique({
      where: { id: userCompanyId },
      select: { id: true, reboloValidityDays: true },
    });

    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    res.json({
      reboloValidityDays: normalizeReboloValidityDays(company.reboloValidityDays),
      minDays: MIN_REBOLO_VALIDITY_DAYS,
      maxDays: MAX_REBOLO_VALIDITY_DAYS,
    });
  } catch (error) {
    console.error('Error fetching rebolo settings:', error);
    res.status(500).json({ error: 'Falha ao consultar prazo do Rebolo' });
  }
});

// Atualizar configuração de validade do Rebolo (padrão 365 dias)
router.patch('/rebolo-settings', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId) return res.status(403).json({ error: 'Empresa não identificada' });

    const rawDays = Number(req.body?.reboloValidityDays);
    if (
      !Number.isFinite(rawDays) ||
      !Number.isInteger(rawDays) ||
      rawDays < MIN_REBOLO_VALIDITY_DAYS ||
      rawDays > MAX_REBOLO_VALIDITY_DAYS
    ) {
      return res.status(400).json({
        error: `Prazo de validade inválido. Informe um número inteiro entre ${MIN_REBOLO_VALIDITY_DAYS} e ${MAX_REBOLO_VALIDITY_DAYS} dias.`,
      });
    }

    const company = await prisma.company.findUnique({
      where: { id: userCompanyId },
      select: { id: true, name: true, tradeName: true, reboloValidityDays: true },
    });

    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.company.update({
        where: { id: userCompanyId },
        data: { reboloValidityDays: rawDays },
        select: { id: true, reboloValidityDays: true },
      });

      await recordOperationalAuditEvent(
        {
          companyId: userCompanyId,
          category: 'CONDITIONS',
          action: 'REBOLO_VALIDITY_UPDATED',
          entityType: 'Company',
          entityId: userCompanyId,
          entityReference: company.tradeName || company.name,
          previousValues: { reboloValidityDays: company.reboloValidityDays },
          newValues: { reboloValidityDays: saved.reboloValidityDays },
          reason: req.body?.reason ? String(req.body.reason).trim() : 'Edição administrativa do prazo de validade do Rebolo',
          authorUserId: req.user?.id || null,
          authorName: req.user?.name || req.user?.cpf || 'Admin',
          authorRole: req.user?.role || null,
        },
        tx
      );

      return saved;
    });

    res.json({
      reboloValidityDays: updated.reboloValidityDays,
      message: `Prazo de validade do Rebolo atualizado para ${updated.reboloValidityDays} dias.`,
    });
  } catch (error) {
    console.error('Error updating rebolo settings:', error);
    res.status(500).json({ error: 'Falha ao atualizar prazo do Rebolo' });
  }
});

// Get rebolos (clients with rebolo status or non-sales history)
router.get('/rebolos', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId) return res.status(403).json({ error: 'Empresa não identificada' });

    if (req.user?.role === 'PHOTOGRAPHER') {
      return res.status(403).json({ error: 'Acesso não autorizado para fotógrafo' });
    }

    const reboloStatuses = [
      'AWAITING_RETURN',
      'IN_STOCK_REBOLO',
      'DISTRIBUTED_REBOLO',
      'REBOLO_SOLD',
      'DISCARDED'
    ];
    const sellerOnlyWalletFilter = isSellerWalletRestricted(req.user?.role)
      ? { assignedSellerId: req.user?.id }
      : {};

    const [company, clients] = await Promise.all([
      prisma.company.findUnique({
        where: { id: userCompanyId },
        select: { reboloValidityDays: true },
      }),
      prisma.client.findMany({
        where: { 
          companyId: userCompanyId,
          ...sellerOnlyWalletFilter,
          bookStatus: { not: 'IN_STOCK_VIRGIN' },
          OR: [
            { bookStatus: { in: reboloStatuses } },
            {
              nonSales: {
                some: {
                  reason: { notIn: ['Em Viagem', 'EM VIAGEM', 'em viagem', 'EM_VIAGEM'] },
                },
              },
            },
          ]
        },
        include: {
          children: true,
          appointments: true,
          batch: { select: { id: true, name: true, city: true, date: true, status: true } },
          nonSales: {
            include: { seller: { select: { id: true, name: true } } },
            orderBy: { date: 'asc' },
          },
          photographer: { select: { id: true, name: true } },
          assignedSeller: { select: { id: true, name: true } },
          timeline: {
            orderBy: { timestamp: 'asc' },
            take: 30,
          },
        },
        orderBy: { createdAt: 'desc' }
      }),
    ]);

    const validityDays = normalizeReboloValidityDays(company?.reboloValidityDays);
    const now = new Date();

    const filteredReboloClients = clients.filter((client) => {
      if (client.bookStatus === 'AWAITING_RETURN') {
        const activeNonSales = Array.isArray(client.nonSales)
          ? client.nonSales.filter((ns: any) => !ns.supersededAt)
          : [];
        const latestNs =
          activeNonSales.length > 0
            ? activeNonSales[activeNonSales.length - 1]
            : client.nonSales?.[client.nonSales.length - 1];
        const normalizedReason = String(latestNs?.reason || '')
          .trim()
          .toUpperCase()
          .replace(/\s+/g, ' ');
        if (normalizedReason === 'EM VIAGEM' || normalizedReason === 'EM_VIAGEM') {
          return false;
        }
      }
      return true;
    });

    const enrichedRebolos = filteredReboloClients.map((client) => {
      const enteredAt = resolveReboloEnteredAt(client);
      const reboloValidity = calculateReboloValidityStatus(enteredAt, validityDays, now);
      const reboloOrigin = resolveReboloOrigin(client);

      return {
        ...client,
        reboloValidityDays: validityDays,
        reboloEnteredAt: enteredAt.toISOString(),
        reboloValidity,
        reboloOrigin,
      };
    });

    res.json(enrichedRebolos);
  } catch (error) {
    console.error('Error fetching rebolos:', error);
    res.status(500).json({ error: 'Failed to fetch rebolos' });
  }
});

// Assign seller to a client/book
router.post('/assign-seller', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId) return res.status(403).json({ error: 'Empresa não identificada' });

    const { sequenceNumber, clientId, sellerId, identifier: bodyIdentifier, uuid: bodyUuid } = req.body;
    const rawIdentifier = clientId || sequenceNumber || bodyIdentifier || bodyUuid || '';
    const identifier = String(rawIdentifier).trim();

    if (!identifier || !sellerId) {
      res.status(400).json({ error: 'Faltam sequenceNumber/clientId ou sellerId' });
      return;
    }

    // Verify seller belongs to company
    const seller = await prisma.user.findFirst({
      where: {
        id: sellerId,
        companyId: userCompanyId,
      },
    });

    if (!seller) {
      res.status(404).json({ error: 'Vendedor não encontrado na sua empresa' });
      return;
    }

    // Find client in same company by any valid identifier
    const existingClient = await prisma.client.findFirst({
      where: {
        companyId: userCompanyId,
        OR: [
          { id: identifier },
          { uuid: identifier },
          { visibleCode: identifier },
          { sequenceNumber: identifier },
        ]
      },
    });

    if (!existingClient) {
      res.status(404).json({ error: 'Cliente não encontrado na sua empresa' });
      return;
    }

    const closedStatuses = ['SOLD', 'REBOLO_SOLD', 'DISCARDED'];
    if (closedStatuses.includes(existingClient.bookStatus)) {
      return res.status(409).json({
        error: `Não é permitido atribuir vendedor para ficha com status finalizado (${existingClient.bookStatus}).`,
      });
    }

    let updateData: any = { assignedSellerId: sellerId };
    let newBookStatus = existingClient.bookStatus;
    if (existingClient.bookStatus === 'IN_STOCK_REBOLO') {
      updateData.bookStatus = 'DISTRIBUTED_REBOLO';
      updateData.outcomeStatus = 'PENDING';
      updateData.cityClosedAt = null;
      if (!existingClient.photographerClosedAt) {
        updateData.photographerClosedAt = existingClient.cityClosedAt || new Date();
      }
      newBookStatus = 'DISTRIBUTED_REBOLO';
    } else if (existingClient.bookStatus === 'IN_STOCK' || existingClient.bookStatus === 'DISTRIBUTED') {
      updateData.bookStatus = 'DISTRIBUTED';
      newBookStatus = 'DISTRIBUTED';
    }

    const client = await prisma.client.update({
      where: { id: existingClient.id },
      data: updateData,
    });

    await prisma.clientTimeline.create({
      data: {
        clientId: client.id,
        cycle: client.commercialCycle || 1,
        action: 'ASSIGNED_SELLER',
        previousStatus: existingClient.bookStatus,
        newStatus: newBookStatus,
        previousSellerId: existingClient.assignedSellerId,
        newSellerId: sellerId,
        authorId: req.user?.id || null,
        authorRole: req.user?.role || null,
        metadata: {
          previousSellerId: existingClient.assignedSellerId,
          newSellerId: sellerId,
        },
      },
    }).catch((err) => console.error('Error creating timeline for ASSIGNED_SELLER:', err));

    res.json({ success: true, client });
  } catch (error: any) {
    console.error('Error in assign-seller:', error);
    res.status(500).json({ error: 'Erro ao atribuir vendedor', message: error?.message });
  }
});

// Get clients by photographer (Restrito à produção - somente fichas em produção CREATED)
router.get('/photographer', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId) return res.status(403).json({ error: 'Empresa não identificada' });

    const clients = await prisma.client.findMany({
      where: { 
        companyId: userCompanyId,
        photographerId: req.user?.id,
        bookStatus: 'CREATED',
        photographerClosedAt: null,
        cityClosedAt: null,
        commercialCycle: { lte: 1 },
        timeline: { none: { action: 'CITY_CLOSED' } },
      },
      include: {
        children: true,
        timeline: { where: { action: 'CITY_CLOSED' } },
      },
      orderBy: { createdAt: 'desc' }
    });

    const accessibleClients = clients
      .filter((c) => !isClientClosedForPhotographer(c))
      .map(sanitizeClientForPhotographer);

    res.json(accessibleClients);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch photographer clients' });
  }
});

// Get client by ficha identifier (sequenceNumber, uuid, visibleCode, id)
router.get('/ficha/:identifier', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    const rawIdentifier = req.params.identifier;
    const identifier = String(rawIdentifier || '').trim();
    if (!identifier) {
      return res.status(400).json({ error: 'Identificador não fornecido' });
    }

    const client = await prisma.client.findFirst({
      where: {
        ...(userCompanyId ? { companyId: userCompanyId } : {}),
        OR: [
          { id: identifier },
          { uuid: identifier },
          { visibleCode: identifier },
          { sequenceNumber: identifier },
        ],
      },
      include: {
        children: true,
        timeline: { where: { action: 'CITY_CLOSED' } },
        appointments: true,
        assignedSeller: true,
        photographer: true,
        sales: {
          include: {
            payments: true,
            adjustments: { orderBy: { createdAt: 'desc' } },
          },
          orderBy: { date: 'desc' },
        },
        nonSales: { where: { supersededAt: null }, orderBy: { date: 'desc' } },
        bookTransfers: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!client) {
      return res.status(404).json({ error: 'Ficha não encontrada na sua empresa' });
    }

    if (req.user?.role === 'PHOTOGRAPHER') {
      if (client.photographerId !== req.user.id || client.bookStatus !== 'CREATED' || isClientClosedForPhotographer(client)) {
        return res.status(403).json({ error: 'Acesso não autorizado a esta ficha' });
      }
      return res.json(sanitizeClientForPhotographer(client));
    }

    if (isSellerWalletRestricted(req.user?.role)) {
      const assignedOther = Boolean(client.assignedSellerId && client.assignedSellerId !== req.user?.id);
      const soldByOther = Array.isArray(client.sales) && client.sales.some((s) => s.sellerId !== req.user?.id);
      if (assignedOther || soldByOther) {
        return res.status(403).json({
          error: 'Acesso negado: esta ficha pertence à carteira de outro vendedor.',
          code: 'WALLET_ACCESS_DENIED',
        });
      }
    }

    res.json(client);
  } catch (error: any) {
    console.error('Error in /clients/ficha/:identifier:', error);
    res.status(500).json({ error: 'Falha ao buscar ficha' });
  }
});

// Get clients by seller
router.get('/seller', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId) return res.status(403).json({ error: 'Empresa não identificada' });

    const clients = await prisma.client.findMany({
      where: { 
        companyId: userCompanyId,
        assignedSellerId: req.user?.id
      },
      include: {
        children: true,
        appointments: true,
        assignedSeller: true,
        photographer: true,
        sales: {
          include: {
            payments: true,
            adjustments: { orderBy: { createdAt: 'desc' } },
          },
          orderBy: { date: 'desc' },
        },
        nonSales: {
          where: { supersededAt: null },
          orderBy: { date: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(clients);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch seller clients' });
  }
});

// Batch assign seller to multiple clients
const batchAssignHandler = async (req: AuthRequest, res: Response) => {
  try {
    const { clientIds, assignedSellerId } = req.body;
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId) return res.status(403).json({ error: 'Empresa não identificada' });

    if (!Array.isArray(clientIds) || clientIds.length === 0 || !assignedSellerId) {
      res.status(400).json({ error: 'Lista de fichas ou vendedor inválido' });
      return;
    }

    // Deduplicate clientIds
    const uniqueClientIds = Array.from(new Set(clientIds.map((id: any) => String(id).trim()))).filter(Boolean);
    if (uniqueClientIds.length === 0) {
      res.status(400).json({ error: 'Nenhum identificador de ficha válido fornecido.' });
      return;
    }

    if (uniqueClientIds.length > 500) {
      res.status(400).json({ error: 'Limite máximo de 500 fichas por lote excedido.' });
      return;
    }

    // Verify seller belongs to user's company, is active, and has real selling role
    const seller = await prisma.user.findFirst({
      where: {
        id: assignedSellerId,
        companyId: userCompanyId,
      },
    });

    if (!seller) {
      res.status(404).json({ error: 'Vendedor não encontrado na sua empresa' });
      return;
    }

    if (!seller.active) {
      res.status(400).json({ error: 'O vendedor selecionado está inativo no sistema' });
      return;
    }

    const allowedRoles = ['SELLER', 'SELLER_MANAGER', 'VENDEDOR'];
    if (!allowedRoles.includes(seller.role)) {
      res.status(400).json({ error: 'O usuário selecionado não possui permissão/função de vendedor' });
      return;
    }

    // Transactional validation and atomic update
    const updatedCount = await prisma.$transaction(async (tx) => {
      // 1. Rejeitar imediatamente se qualquer ficha já estiver encerrada (SOLD, REBOLO_SOLD, DISCARDED)
      const closedStatuses = ['SOLD', 'REBOLO_SOLD', 'DISCARDED'];
      const finalizedClients = await tx.client.findMany({
        where: {
          id: { in: uniqueClientIds },
          companyId: userCompanyId,
          bookStatus: { in: closedStatuses }
        },
        select: { id: true, bookStatus: true }
      });

      if (finalizedClients.length > 0) {
        throw {
          status: 409,
          error: `Não é permitido atribuir vendedor para fichas com status finalizado (${finalizedClients.map(c => c.bookStatus).join(', ')}).`
        };
      }

      // Fetch all requested clients for the company that are in stock
      const clientsInStock = await tx.client.findMany({
        where: {
          id: { in: uniqueClientIds },
          companyId: userCompanyId,
          bookStatus: { in: ['IN_STOCK', 'IN_STOCK_REBOLO'] }
        },
        select: { id: true, bookStatus: true, commercialCycle: true, assignedSellerId: true }
      });

      if (clientsInStock.length !== uniqueClientIds.length) {
        const foundIds = new Set(clientsInStock.map(c => c.id));
        const invalidCount = uniqueClientIds.length - clientsInStock.length;
        throw {
          status: 400,
          error: `Uma ou mais fichas não estão disponíveis em estoque para distribuição (${invalidCount} indisponível(is) ou de outra empresa).`
        };
      }

      const reboloIds = clientsInStock.filter(c => c.bookStatus === 'IN_STOCK_REBOLO').map(c => c.id);
      const stockIds = clientsInStock.filter(c => c.bookStatus === 'IN_STOCK').map(c => c.id);

      let totalUpdated = 0;
      if (reboloIds.length > 0) {
        // Assegurar que photographerClosedAt permaneça preenchido em qualquer ficha de rebolo
        await tx.client.updateMany({
          where: {
            id: { in: reboloIds },
            companyId: userCompanyId,
            photographerClosedAt: null,
          },
          data: {
            photographerClosedAt: new Date(),
          },
        });

        const reboloUpdate = await tx.client.updateMany({
          where: {
            id: { in: reboloIds },
            companyId: userCompanyId,
            bookStatus: 'IN_STOCK_REBOLO',
          },
          data: {
            assignedSellerId,
            bookStatus: 'DISTRIBUTED_REBOLO',
            outcomeStatus: 'PENDING',
            cityClosedAt: null,
          }
        });
        totalUpdated += reboloUpdate.count;
      }

      if (stockIds.length > 0) {
        const stockUpdate = await tx.client.updateMany({
          where: {
            id: { in: stockIds },
            companyId: userCompanyId,
            bookStatus: 'IN_STOCK',
          },
          data: {
            assignedSellerId,
            bookStatus: 'DISTRIBUTED',
          }
        });
        totalUpdated += stockUpdate.count;
      }

      if (totalUpdated !== uniqueClientIds.length) {
        throw {
          status: 409,
          error: 'Conflito de concorrência: algumas fichas foram alteradas por outra operação durante a distribuição.'
        };
      }

      // Gravar auditoria na timeline para cada ficha distribuída
      const timelineEntries = clientsInStock.map((c) => ({
        clientId: c.id,
        cycle: c.commercialCycle || 1,
        action: 'ASSIGNED_SELLER',
        previousStatus: c.bookStatus,
        newStatus: c.bookStatus === 'IN_STOCK_REBOLO' ? 'DISTRIBUTED_REBOLO' : 'DISTRIBUTED',
        previousSellerId: c.assignedSellerId,
        newSellerId: assignedSellerId,
        authorId: req.user?.id || null,
        authorRole: req.user?.role || null,
      }));

      await tx.clientTimeline.createMany({ data: timelineEntries });

      return totalUpdated;
    });

    res.json({ success: true, requested: uniqueClientIds.length, count: updatedCount });
  } catch (error: any) {
    if (error && typeof error === 'object' && error.status && error.error) {
      return res.status(error.status).json({ error: error.error });
    }
    console.error("Erro ao atribuir lote de fichas:", error);
    res.status(500).json({ error: 'Erro ao atribuir lote de fichas' });
  }
};

router.patch('/batch-assign', authenticateToken, requireAdminOrSupervisor, batchAssignHandler);
router.post('/batch-assign', authenticateToken, requireAdminOrSupervisor, batchAssignHandler);
router.post('/batch/assign-seller', authenticateToken, requireAdminOrSupervisor, batchAssignHandler);

// Get client timeline audit
router.get('/:id/timeline', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    const client = await prisma.client.findFirst({
      where: {
        id,
        ...(userCompanyId ? { companyId: userCompanyId } : {}),
      },
      include: {
        timeline: { where: { action: 'CITY_CLOSED' } },
      },
    });

    if (!client) {
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }

    if (req.user?.role === 'PHOTOGRAPHER') {
      if (client.photographerId !== req.user.id || isClientClosedForPhotographer(client)) {
        return res.status(403).json({ error: 'Acesso negado à linha do tempo da ficha' });
      }
    } else if (isSellerWalletRestricted(req.user?.role)) {
      const hasOtherSellerSale = await prisma.sale.findFirst({
        where: { clientId: client.id, companyId: client.companyId, sellerId: { not: req.user?.id } },
        select: { id: true },
      });
      if ((client.assignedSellerId && client.assignedSellerId !== req.user?.id) || Boolean(hasOtherSellerSale)) {
        return res.status(403).json({
          error: 'Acesso negado: esta ficha pertence à carteira de outro vendedor.',
          code: 'WALLET_ACCESS_DENIED',
        });
      }
    }

    const timeline = await prisma.clientTimeline.findMany({
      where: { clientId: id },
      orderBy: { timestamp: 'asc' },
    });

    const userIdsToResolve = Array.from(
      new Set(
        timeline
          .flatMap((t) => [t.previousSellerId, t.newSellerId, t.authorId])
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      )
    );
    const resolvedUsers =
      userIdsToResolve.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: userIdsToResolve } },
            select: { id: true, name: true },
          })
        : [];
    const userNameMap = new Map(resolvedUsers.map((u) => [u.id, u.name]));

    const enrichedTimeline = timeline.map((t) => ({
      ...t,
      previousSellerName: t.previousSellerId ? userNameMap.get(t.previousSellerId) || null : null,
      newSellerName: t.newSellerId ? userNameMap.get(t.newSellerId) || null : null,
      authorName: t.authorId ? userNameMap.get(t.authorId) || null : null,
    }));

    res.json(enrichedTimeline);
  } catch (error) {
    console.error('Error fetching client timeline:', error);
    res.status(500).json({ error: 'Falha ao buscar linha do tempo da ficha' });
  }
});

const ADMIN_EDITABLE_CLIENT_FIELDS = [
  'name',
  'sequenceNumber',
  'phone1',
  'phone2',
  'cep',
  'street',
  'number',
  'complement',
  'neighborhood',
  'city',
  'state',
  'condo',
  'block',
  'apartment',
  'houseColor',
  'gateColor',
  'gateObservation',
  'referencePoint',
  'profession',
  'visitTime',
  'clothesColor',
  'event',
  'mainContact',
] as const;

// Edição administrativa direta de ficha (Admin / Supervisor da própria empresa)
router.patch('/:id/admin-edit', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    const existingClient = await prisma.client.findFirst({
      where: {
        id,
        ...(userCompanyId ? { companyId: userCompanyId } : {}),
      },
      include: { children: true },
    });

    if (!existingClient) {
      return res.status(404).json({ error: 'Ficha não encontrada na empresa' });
    }

    const updateData: Record<string, any> = {};
    const previousValues: Record<string, any> = {};
    const newValues: Record<string, any> = {};

    for (const field of ADMIN_EDITABLE_CLIENT_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        const rawVal = req.body[field];
        const nextVal = rawVal === null || rawVal === undefined ? null : String(rawVal).trim();
        if (field === 'name' && !nextVal) {
          return res.status(400).json({ error: 'O nome da ficha não pode ficar vazio.' });
        }
        if (field === 'sequenceNumber' && !nextVal) {
          return res.status(400).json({ error: 'O número da ficha não pode ficar vazio.' });
        }
        if (existingClient[field] !== nextVal) {
          previousValues[field] = existingClient[field];
          newValues[field] = nextVal;
          updateData[field] = nextVal;
        }
      }
    }

    const hasChildrenUpdate = Array.isArray(req.body?.children);
    const parsedChildren = hasChildrenUpdate
      ? req.body.children
          .filter((c: any) => String(c?.name || '').trim().length > 0)
          .map((c: any) => ({
            name: String(c.name).trim(),
            age: typeof c.age === 'string' ? parseInt(c.age, 10) || 0 : Number(c.age) || 0,
          }))
      : null;

    if (Object.keys(updateData).length === 0 && !hasChildrenUpdate) {
      return res.status(400).json({ error: 'Nenhum campo válido alterado.' });
    }

    const reason = req.body?.reason
      ? String(req.body.reason).trim()
      : 'Edição administrativa da ficha';

    const updatedClient = await prisma.$transaction(async (tx) => {
      if (parsedChildren !== null) {
        await tx.child.deleteMany({ where: { clientId: existingClient.id } });
        if (parsedChildren.length > 0) {
          await tx.child.createMany({
            data: parsedChildren.map((c: any) => ({
              name: c.name,
              age: c.age,
              clientId: existingClient.id,
            })),
          });
        }
      }

      const saved = await tx.client.update({
        where: { id: existingClient.id },
        data: updateData,
        include: {
          children: true,
          batch: { select: { id: true, name: true, status: true } },
          assignedSeller: { select: { id: true, name: true } },
          photographer: { select: { id: true, name: true } },
        },
      });

      await tx.clientTimeline.create({
        data: {
          clientId: existingClient.id,
          cycle: existingClient.commercialCycle,
          action: 'ADMIN_EDITED',
          previousStatus: existingClient.bookStatus,
          newStatus: existingClient.bookStatus,
          authorId: req.user?.id || null,
          authorRole: req.user?.role || null,
          metadata: {
            changedFields: Object.keys(newValues),
            childrenUpdated: hasChildrenUpdate,
            reason,
          },
        },
      });

      await recordOperationalAuditEvent(
        {
          companyId: existingClient.companyId,
          category: 'CONDITIONS',
          action: 'ADMIN_CLIENT_EDITED',
          entityType: 'Client',
          entityId: existingClient.id,
          entityReference: existingClient.visibleCode || existingClient.sequenceNumber,
          previousValues: {
            ...previousValues,
            ...(hasChildrenUpdate ? { childrenCount: existingClient.children.length } : {}),
          },
          newValues: {
            ...newValues,
            ...(hasChildrenUpdate ? { childrenCount: parsedChildren?.length ?? 0 } : {}),
          },
          reason,
          authorUserId: req.user?.id || null,
          authorName: req.user?.name || req.user?.cpf || 'Admin',
          authorRole: req.user?.role || null,
        },
        tx
      );

      return saved;
    });

    res.json({
      message: 'Ficha atualizada com sucesso',
      client: updatedClient,
    });
  } catch (error: any) {
    console.error('Error editing client as admin:', error);
    res.status(500).json({ error: 'Falha ao editar dados da ficha' });
  }
});

// Mover ficha entre lotes (BookBatch) e/ou vendedores ativos da mesma empresa
router.post('/:id/move', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    const existingClient = await prisma.client.findFirst({
      where: {
        id,
        ...(userCompanyId ? { companyId: userCompanyId } : {}),
      },
      include: {
        batch: { select: { id: true, name: true } },
        assignedSeller: { select: { id: true, name: true } },
      },
    });

    if (!existingClient) {
      return res.status(404).json({ error: 'Ficha não encontrada na empresa' });
    }

    const finalizedStatuses = ['SOLD', 'REBOLO_SOLD', 'DISCARDED'];
    const isFinalized = finalizedStatuses.includes(existingClient.bookStatus);

    const hasBatchTarget = Object.prototype.hasOwnProperty.call(req.body || {}, 'targetBatchId');
    const hasSellerTarget = Object.prototype.hasOwnProperty.call(req.body || {}, 'targetSellerId');

    if (!hasBatchTarget && !hasSellerTarget) {
      return res.status(400).json({
        error: 'Informe o lote de destino (targetBatchId) ou o vendedor de destino (targetSellerId).',
      });
    }

    const updateData: Record<string, any> = {};
    let nextBatchName: string | null = existingClient.batch?.name || null;
    let nextSellerName: string | null = existingClient.assignedSeller?.name || null;
    let nextStatus = existingClient.bookStatus;

    if (hasBatchTarget) {
      const targetBatchId = req.body.targetBatchId ? String(req.body.targetBatchId).trim() : '';
      if (!targetBatchId) {
        updateData.batchId = null;
        nextBatchName = null;
      } else {
        const targetBatch = await prisma.bookBatch.findFirst({
          where: {
            id: targetBatchId,
            ...(existingClient.companyId ? { companyId: existingClient.companyId } : {}),
          },
          select: { id: true, name: true },
        });
        if (!targetBatch) {
          return res.status(404).json({ error: 'Lote de destino não encontrado na mesma empresa.' });
        }
        updateData.batchId = targetBatch.id;
        nextBatchName = targetBatch.name;
      }
    }

    if (hasSellerTarget) {
      const targetSellerId = req.body.targetSellerId ? String(req.body.targetSellerId).trim() : '';
      if (!targetSellerId) {
        updateData.assignedSellerId = null;
        nextSellerName = null;
        if (!isFinalized) {
          updateData.cityClosedAt = null;
          if (existingClient.bookStatus === 'DISTRIBUTED') {
            nextStatus = 'IN_STOCK';
            updateData.bookStatus = 'IN_STOCK';
          } else if (existingClient.bookStatus === 'DISTRIBUTED_REBOLO') {
            nextStatus = 'IN_STOCK_REBOLO';
            updateData.bookStatus = 'IN_STOCK_REBOLO';
          }
        }
      } else {
        const targetSeller = await prisma.user.findFirst({
          where: {
            id: targetSellerId,
            ...(existingClient.companyId ? { companyId: existingClient.companyId } : {}),
          },
          select: { id: true, name: true, active: true, role: true },
        });
        if (!targetSeller) {
          return res.status(404).json({ error: 'Vendedor de destino não encontrado na mesma empresa.' });
        }
        if (!targetSeller.active) {
          return res.status(400).json({ error: 'O vendedor de destino está inativo.' });
        }
        const allowedSellerRoles = ['SELLER', 'SELLER_MANAGER', 'VENDEDOR'];
        if (!allowedSellerRoles.includes(targetSeller.role)) {
          return res.status(400).json({ error: 'O usuário selecionado não possui perfil de vendedor.' });
        }

        if (isFinalized) {
          updateData.assignedSellerId = targetSeller.id;
        } else {
          const isReboloFlow = ['AWAITING_RETURN', 'IN_STOCK_REBOLO', 'DISTRIBUTED_REBOLO'].includes(
            existingClient.bookStatus
          );
          nextStatus = isReboloFlow ? 'DISTRIBUTED_REBOLO' : 'DISTRIBUTED';
          updateData.assignedSellerId = targetSeller.id;
          updateData.bookStatus = nextStatus;
          updateData.cityClosedAt = null;
        }
        nextSellerName = targetSeller.name;
      }
    }

    const reason = req.body?.reason
      ? String(req.body.reason).trim()
      : 'Movimentação administrativa de lote/vendedor';

    const movedClient = await prisma.$transaction(async (tx) => {
      const saved = await tx.client.update({
        where: { id: existingClient.id },
        data: updateData,
        include: {
          batch: { select: { id: true, name: true, status: true } },
          assignedSeller: { select: { id: true, name: true } },
          photographer: { select: { id: true, name: true } },
        },
      });

      await tx.clientTimeline.create({
        data: {
          clientId: existingClient.id,
          cycle: existingClient.commercialCycle,
          action: 'ADMIN_MOVED',
          previousStatus: existingClient.bookStatus,
          newStatus: nextStatus,
          authorId: req.user?.id || null,
          authorRole: req.user?.role || null,
          metadata: {
            previousBatchId: existingClient.batchId,
            previousBatchName: existingClient.batch?.name || null,
            newBatchId: saved.batchId,
            newBatchName: nextBatchName,
            previousSellerId: existingClient.assignedSellerId,
            previousSellerName: existingClient.assignedSeller?.name || null,
            newSellerId: saved.assignedSellerId,
            newSellerName: nextSellerName,
            reason,
          },
        },
      });

      await recordOperationalAuditEvent(
        {
          companyId: existingClient.companyId,
          category: 'CONDITIONS',
          action: 'ADMIN_CLIENT_MOVED',
          entityType: 'Client',
          entityId: existingClient.id,
          entityReference: existingClient.visibleCode || existingClient.sequenceNumber,
          previousValues: {
            batchId: existingClient.batchId,
            assignedSellerId: existingClient.assignedSellerId,
            bookStatus: existingClient.bookStatus,
          },
          newValues: {
            batchId: saved.batchId,
            assignedSellerId: saved.assignedSellerId,
            bookStatus: saved.bookStatus,
          },
          reason,
          authorUserId: req.user?.id || null,
          authorName: req.user?.name || req.user?.cpf || 'Admin',
          authorRole: req.user?.role || null,
        },
        tx
      );

      return saved;
    });

    res.json({
      message: 'Ficha movimentada com sucesso',
      client: movedClient,
    });
  } catch (error: any) {
    console.error('Error moving client:', error);
    res.status(500).json({ error: 'Falha ao movimentar ficha' });
  }
});

// Exclusão administrativa irrestrita de qualquer ficha da própria empresa mediante confirmação e auditoria
router.delete('/:id', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    const existingClient = await prisma.client.findFirst({
      where: {
        id,
        ...(userCompanyId ? { companyId: userCompanyId } : {}),
      },
      include: {
        sales: { select: { id: true } },
        creditAgreements: { select: { id: true, status: true } },
        nonSales: { select: { id: true } },
        batch: { select: { id: true, name: true, status: true } },
      },
    });

    if (!existingClient) {
      return res.status(404).json({ error: 'Ficha não encontrada na empresa' });
    }

    const reason = req.body?.reason
      ? String(req.body.reason).trim()
      : 'Exclusão administrativa de ficha pelo painel Admin';

    const saleIds = existingClient.sales.map((s) => s.id);

    await prisma.$transaction(async (tx) => {
      await recordOperationalAuditEvent(
        {
          companyId: existingClient.companyId,
          category: 'REVERSAL',
          action: 'ADMIN_CLIENT_DELETED',
          entityType: 'Client',
          entityId: existingClient.id,
          entityReference: existingClient.visibleCode || existingClient.sequenceNumber,
          previousValues: {
            name: existingClient.name,
            sequenceNumber: existingClient.sequenceNumber,
            visibleCode: existingClient.visibleCode,
            bookStatus: existingClient.bookStatus,
            outcomeStatus: existingClient.outcomeStatus,
            batchId: existingClient.batchId,
            batchName: existingClient.batch?.name || null,
            salesCount: saleIds.length,
            creditAgreementsCount: existingClient.creditAgreements.length,
            nonSalesCount: existingClient.nonSales.length,
          },
          newValues: null,
          reason,
          authorUserId: req.user?.id || null,
          authorName: req.user?.name || req.user?.cpf || 'Admin',
          authorRole: req.user?.role || null,
        },
        tx
      );

      if (saleIds.length > 0) {
        await tx.platformStatementAdjustment.updateMany({
          where: { originSaleId: { in: saleIds } },
          data: { originSaleId: null },
        });
        await tx.platformStatementItem.deleteMany({
          where: { saleId: { in: saleIds } },
        });
        await tx.batchCommissionAdjustment.deleteMany({
          where: { saleId: { in: saleIds } },
        });
        await tx.buyerPurchaseConfirmation.deleteMany({
          where: { saleId: { in: saleIds } },
        });
        await tx.salePayment.deleteMany({
          where: { saleId: { in: saleIds } },
        });
        await tx.nonSale.updateMany({
          where: { supersededBySaleId: { in: saleIds } },
          data: { supersededBySaleId: null },
        });
      }

      if (existingClient.creditAgreements.length > 0) {
        await tx.creditAgreement.deleteMany({ where: { clientId: existingClient.id } });
      }
      if (existingClient.nonSales.length > 0) {
        await tx.nonSale.deleteMany({ where: { clientId: existingClient.id } });
      }
      if (saleIds.length > 0) {
        await tx.sale.deleteMany({ where: { clientId: existingClient.id } });
      }

      await tx.evaluation.deleteMany({ where: { clientId: existingClient.id } });
      await tx.sellerPhoto.deleteMany({ where: { clientId: existingClient.id } });
      await tx.clientEditRequest.deleteMany({ where: { clientId: existingClient.id } });
      await tx.clientTimeline.deleteMany({ where: { clientId: existingClient.id } });
      await tx.appointment.deleteMany({ where: { clientId: existingClient.id } });
      await tx.child.deleteMany({ where: { clientId: existingClient.id } });
      await tx.client.delete({ where: { id: existingClient.id } });
    });

    res.json({
      deleted: true,
      id: existingClient.id,
      message: 'Ficha excluída definitivamente e registrada na trilha de auditoria.',
    });
  } catch (error: any) {
    console.error('Error deleting client as admin:', error);
    res.status(500).json({ error: 'Falha ao excluir ficha' });
  }
});

export default router;
