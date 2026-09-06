import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { authenticateToken, AuthRequest, requireAdminOrSupervisor } from '../middleware/authMiddleware';
import { getNextVisibleCode } from '../utils/visibleCode';

const router = Router();
const prisma = new PrismaClient();

// Allowed client fields for sync
const ALLOWED_SYNC_CLIENT_FIELDS = [
  'name', 'phone1', 'phone2', 'cep', 'street', 'number', 'condo',
  'block', 'apartment', 'neighborhood', 'city', 'state', 'referencePoint',
  'houseColor', 'gateColor', 'gateObservation', 'profession', 'visitTime',
  'clothesColor', 'notes', 'teamId', 'latitude', 'longitude', 'geocoded', 'event'
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

      // 1. Localizar se já existe ficha com esse UUID permanente
      let existing = await prisma.client.findUnique({
        where: { uuid: clientUuid },
      });

      // Fallback para fichas legadas que vieram apenas com sequenceNumber
      if (!existing && seqNum) {
        existing = await prisma.client.findFirst({
          where: { sequenceNumber: seqNum, companyId },
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
        if (existing.bookStatus !== 'CREATED') {
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
            children: Array.isArray(clientData.children)
              ? {
                  create: clientData.children.map((c: any) => ({
                    name: String(c.name || '').trim(),
                    age: typeof c.age === 'string' ? parseInt(c.age, 10) : (c.age || 0),
                  })),
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

// Get all clients (Admin, Supervisor or User in company)
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    const clients = await prisma.client.findMany({
      where: { companyId },
      include: { children: true, appointments: true, assignedSeller: true, photographer: { select: { id: true, name: true } } }
    });
    res.json(clients);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch clients' });
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

    const { city, bookStatus } = req.query as { city?: string; bookStatus?: string };

    const clients = await prisma.client.findMany({
      where: {
        companyId: userCompanyId,
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

// Get rebolos (clients with rebolo status or non-sales history)
router.get('/rebolos', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId) return res.status(403).json({ error: 'Empresa não identificada' });

    const reboloStatuses = [
      'AWAITING_RETURN',
      'IN_STOCK_REBOLO',
      'DISTRIBUTED_REBOLO',
      'REBOLO_SOLD',
      'DISCARDED'
    ];

    const clients = await prisma.client.findMany({
      where: { 
        companyId: userCompanyId,
        OR: [
          { bookStatus: { in: reboloStatuses } },
          { nonSales: { some: {} } }
        ]
      },
      include: { children: true, appointments: true, nonSales: true, photographer: true, assignedSeller: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(clients);
  } catch (error) {
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

// Get clients by photographer
router.get('/photographer', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId) return res.status(403).json({ error: 'Empresa não identificada' });

    const clients = await prisma.client.findMany({
      where: { 
        companyId: userCompanyId,
        photographerId: req.user?.id
      },
      include: { children: true, appointments: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(clients);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch photographer clients' });
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
    });

    if (!client) {
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }

    const timeline = await prisma.clientTimeline.findMany({
      where: { clientId: id },
      orderBy: { timestamp: 'asc' },
    });

    res.json(timeline);
  } catch (error) {
    console.error('Error fetching client timeline:', error);
    res.status(500).json({ error: 'Falha ao buscar linha do tempo da ficha' });
  }
});

export default router;
