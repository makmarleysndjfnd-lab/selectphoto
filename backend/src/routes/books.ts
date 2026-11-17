import express from 'express';
import { prisma, Prisma } from '../services/prisma';
import { authenticateToken as authMiddleware, AuthRequest, requireAdminOrSupervisor } from '../middleware/authMiddleware';
import { isClientClosedForPhotographer } from '../utils/photographerIsolation';
import { recordOperationalAuditEvent } from '../services/operationalAuditService';

const router = express.Router();


// Start Photographer Batch Session
router.post('/session/start', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { batchId, eventName, city } = req.body;
        const photographerId = req.user?.id;
        const companyId = req.user?.companyId;
        const userRole = (req.user?.role || '').toUpperCase();

        if (userRole === 'SELLER' || userRole === 'VENDEDOR') {
            return res.status(403).json({ error: 'Acesso negado: vendedores não iniciam sessões de lote' });
        }
        if (!companyId && userRole !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Empresa não identificada' });
        }
        if (!photographerId) {
            return res.status(400).json({ error: 'Identificação de fotógrafo ausente no token' });
        }

        const effectiveBatchId = (typeof batchId === 'string' && batchId.trim().length > 0)
            ? batchId.trim()
            : undefined;
        const cleanEventName = typeof eventName === 'string' ? eventName.trim() : 'Evento';
        const cleanCity = typeof city === 'string' && city.trim().length > 0 ? city.trim() : null;
        const batchName = cleanCity
            ? `Lote - ${cleanEventName} (${cleanCity})`
            : `Lote - ${cleanEventName}`;

        let batch;
        if (effectiveBatchId) {
            const existingBatch = await prisma.bookBatch.findUnique({
                where: { id: effectiveBatchId },
                include: { photographer: { select: { id: true, name: true } } }
            });

            if (existingBatch) {
                if (existingBatch.companyId !== companyId && userRole !== 'SUPER_ADMIN') {
                    return res.status(403).json({ error: 'Lote pertence a outra empresa' });
                }
                if (existingBatch.photographerId !== photographerId && userRole !== 'ADMIN' && userRole !== 'SUPER_ADMIN') {
                    return res.status(403).json({ error: 'Lote pertence a outro fotógrafo' });
                }
                // Idempotência: se o lote já foi fechado/avançou (status !== 'CREATED'), retorna sem alterar status ou totalProduced
                if (existingBatch.status !== 'CREATED') {
                    return res.status(200).json({
                        success: true,
                        batchId: existingBatch.id,
                        name: existingBatch.name,
                        status: existingBatch.status,
                        photographerId: existingBatch.photographerId,
                        city: existingBatch.city,
                        totalProduced: existingBatch.totalProduced ?? 0,
                        alreadyClosed: true,
                        batch: existingBatch
                    });
                }

                // Se ainda está em CREATED, atualiza metadados mantendo o lote ativo
                batch = await prisma.bookBatch.update({
                    where: { id: effectiveBatchId },
                    data: {
                        name: batchName,
                        ...(cleanCity ? { city: cleanCity } : {}),
                    },
                    include: { photographer: { select: { id: true, name: true } } }
                });
            } else {
                batch = await prisma.bookBatch.create({
                    data: {
                        id: effectiveBatchId,
                        name: batchName,
                        city: cleanCity,
                        photographerId,
                        companyId,
                        status: 'CREATED',
                        totalProduced: 0
                    },
                    include: { photographer: { select: { id: true, name: true } } }
                });
            }
        } else {
            batch = await prisma.bookBatch.create({
                data: {
                    name: batchName,
                    city: cleanCity,
                    photographerId,
                    companyId,
                    status: 'CREATED',
                    totalProduced: 0
                },
                include: { photographer: { select: { id: true, name: true } } }
            });
        }

        res.status(200).json({
            success: true,
            batchId: batch.id,
            name: batch.name,
            status: batch.status,
            photographerId: batch.photographerId,
            city: batch.city,
            totalProduced: batch.totalProduced ?? 0,
            batch
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao iniciar sessão de lote' });
    }
});

// Close Event Batch (Photographer)
router.post('/close-event', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { eventName, city, clientIds, batchId } = req.body;
        const photographerId = req.user?.id;
        const companyId = req.user?.companyId;
        const userRole = (req.user?.role || '').toUpperCase();

        if (userRole === 'SELLER' || userRole === 'VENDEDOR') {
            return res.status(403).json({ error: 'Acesso negado: vendedores não fecham lotes' });
        }
        if (!companyId && userRole !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Empresa não identificada' });
        }
        if (!photographerId) return res.status(400).json({ error: 'Missing photographer' });

        const cleanClientIds = Array.isArray(clientIds)
            ? clientIds.filter((id: any) => typeof id === 'string' && id.trim().length > 0)
            : [];
        const cleanBatchId = typeof batchId === 'string' && batchId.trim().length > 0 ? batchId.trim() : null;
        const cleanEventName = typeof eventName === 'string' ? eventName.trim() : '';
        const cleanCity = typeof city === 'string' && city.trim().length > 0 ? city.trim() : null;

        // Validação de posse e idempotência prévia se batchId foi fornecido
        if (cleanBatchId) {
            const existingBatch = await prisma.bookBatch.findUnique({
                where: { id: cleanBatchId }
            });
            if (existingBatch) {
                if (existingBatch.companyId !== companyId && userRole !== 'SUPER_ADMIN') {
                    return res.status(403).json({ error: 'Lote pertence a outra empresa' });
                }
                if (existingBatch.photographerId !== photographerId && userRole !== 'ADMIN' && userRole !== 'SUPER_ADMIN') {
                    return res.status(403).json({ error: 'Lote pertence a outro fotógrafo' });
                }
                if (existingBatch.status !== 'CREATED') {
                    return res.status(200).json({
                        message: 'Lote já finalizado anteriormente.',
                        alreadyClosed: true,
                        count: 0,
                        batchId: existingBatch.id,
                        totalProduced: existingBatch.totalProduced ?? 0,
                        batches: [existingBatch]
                    });
                }
            }
        }

        // Não permitir fechamento ambíguo por apenas evento e cidade sem o conjunto de fichas ou batchId
        if (cleanClientIds.length === 0 && !cleanBatchId) {
            return res.status(400).json({
                error: 'Identificação de lote necessária: informe o conjunto de fichas (clientIds) ou batchId para fechar o lote. O fechamento ambíguo apenas por evento/cidade não é permitido.'
            });
        }

        // Construir escopo estrito de sessão/fichas
        let scopeWhere: any = {
            photographerId,
            companyId,
        };

        if (cleanClientIds.length > 0) {
            // Identidade estável e unívoca pelo conjunto de fichas da sessão (suporta IDs e sequenceNumbers)
            scopeWhere.OR = [
                { id: { in: cleanClientIds } },
                { sequenceNumber: { in: cleanClientIds } }
            ];
        } else if (cleanBatchId) {
            scopeWhere.batchId = cleanBatchId;
        }

        const result = await prisma.$transaction(async (tx) => {
            // 1. Buscar candidatas no escopo restrito
            const candidates = await tx.client.findMany({
                where: scopeWhere,
                select: { id: true, bookStatus: true, name: true, event: true, city: true, batchId: true }
            });

            if (candidates.length === 0) {
                return { count: 0, alreadyClosed: true, batch: null, message: `Nenhuma ficha pendente para o evento "${cleanEventName || 'Informado'}". Lote já finalizado ou sem fichas.` };
            }

            const candidateIds = candidates.map(c => c.id);

            // 2. Lock exclusivo nas fichas candidatas para serializar concorrência (com force-send ou outros fechamentos)
            await tx.$executeRaw`
                SELECT id FROM "Client"
                WHERE id IN (${Prisma.join(candidateIds)})
                FOR UPDATE
            `;

            // 3. Re-verificar sob o lock quais fichas ainda estão em 'CREATED'
            const eligibleClients = await tx.client.findMany({
                where: {
                    id: { in: candidateIds },
                    companyId,
                    bookStatus: 'CREATED'
                }
            });

            if (eligibleClients.length === 0) {
                // Todas já foram processadas por force-send ou fechamento concorrente
                return {
                    count: 0,
                    alreadyClosed: true,
                    batch: null,
                    message: 'Todas as fichas deste lote já foram enviadas. Lote finalizado.'
                };
            }

            // 4. Reutilizar ou criar o BookBatch
            const effectiveEvent = cleanEventName || eligibleClients[0]?.event || 'Evento';
            const effectiveCity = cleanCity || eligibleClients[0]?.city || null;
            const batchName = effectiveCity
                ? `Lote - ${effectiveEvent} (${effectiveCity})`
                : `Lote - ${effectiveEvent}`;

            let targetBatch: any = null;
            if (cleanBatchId) {
                const existing = await tx.bookBatch.findFirst({
                    where: { id: cleanBatchId, ...(companyId ? { companyId } : {}) }
                });
                if (existing) {
                    if (existing.status !== 'CREATED') {
                        return {
                            count: 0,
                            alreadyClosed: true,
                            batch: existing,
                            message: 'Lote já finalizado anteriormente.'
                        };
                    }

                    // Congelamento imutável de totalProduced na transição para AWAITING_RELEASE
                    const clientsAlreadyInBatch = await tx.client.count({
                        where: { batchId: existing.id, companyId }
                    });
                    const newlyAddedCount = eligibleClients.filter(c => c.batchId !== existing.id).length;
                    const frozenTotal = existing.totalProduced && existing.totalProduced > 0
                        ? existing.totalProduced
                        : Math.max(clientsAlreadyInBatch + newlyAddedCount, eligibleClients.length);

                    targetBatch = await tx.bookBatch.update({
                        where: { id: cleanBatchId },
                        data: {
                            name: batchName,
                            city: effectiveCity || existing.city,
                            status: 'AWAITING_RELEASE',
                            totalProduced: frozenTotal
                        }
                    });
                }
            }

            if (!targetBatch) {
                targetBatch = await tx.bookBatch.create({
                    data: {
                        ...(cleanBatchId ? { id: cleanBatchId } : {}),
                        name: batchName,
                        city: effectiveCity,
                        photographerId: photographerId!,
                        companyId,
                        status: 'AWAITING_RELEASE',
                        totalProduced: eligibleClients.length
                    }
                });
            }

            // 5. Atualizar as fichas para AWAITING_RELEASE associando o batchId
            const updateRes = await tx.client.updateMany({
                where: {
                    id: { in: eligibleClients.map(c => c.id) },
                    companyId,
                    bookStatus: 'CREATED'
                },
                data: {
                    bookStatus: 'AWAITING_RELEASE',
                    batchId: targetBatch.id
                }
            });

            if (updateRes.count === 0 && !cleanBatchId) {
                // Se por corrida extrema nenhuma ficha foi associada em lote novo, remove para não deixar lixo
                await tx.bookBatch.delete({ where: { id: targetBatch.id } });
                return { count: 0, alreadyClosed: true, batch: null, message: 'Todas as fichas deste lote já foram enviadas. Lote finalizado.' };
            }

            return {
                count: updateRes.count,
                alreadyClosed: false,
                batch: targetBatch,
                batchName,
                message: `${updateRes.count} ficha(s) enviada(s) para a gráfica no lote "${batchName}".`
            };
        });

        if (result.alreadyClosed) {
            return res.status(200).json({
                message: result.message,
                alreadyClosed: true,
                count: 0,
                batches: []
            });
        }

        // Notificar Admins
        const admins = await prisma.user.findMany({ where: { role: 'ADMIN', companyId } });
        for (const admin of admins) {
            await prisma.notification.create({
                data: {
                    title: 'Novo Lote para Liberação',
                    message: `Fotógrafo finalizou o lote "${result.batchName}" com ${result.count} ficha(s).`,
                    type: 'SYSTEM',
                    senderId: photographerId,
                    recipientId: admin.id,
                    companyId
                }
            });
        }

        res.status(201).json({
            message: result.message,
            batches: [result.batch],
            batchId: result.batch?.id,
            count: result.count
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao fechar lote de evento' });
    }
});

// Release batch to stock (Admin)
router.put('/batch/:id/release', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId;

        if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Empresa não identificada' });
        }

        const existingBatch = await prisma.bookBatch.findFirst({
            where: { id: id as string, ...(companyId ? { companyId } : {}) }
        });
        if (!existingBatch) {
            return res.status(404).json({ error: 'Lote não encontrado' });
        }

        const { batch, updatedClientsCount } = await prisma.$transaction(async (tx) => {
            const updatedBatch = await tx.bookBatch.update({
                where: { id: id as string },
                data: { status: 'IN_STOCK' }
            });

            // Protegido: Atualizar somente fichas em AWAITING_RELEASE ou CREATED.
            // Nunca regredir DISTRIBUTED, SOLD, AWAITING_RETURN, IN_STOCK_REBOLO, DISTRIBUTED_REBOLO, REBOLO_SOLD ou DISCARDED.
            const updatedClients = await tx.client.updateMany({
                where: { 
                    batchId: id as string, 
                    companyId,
                    bookStatus: { in: ['AWAITING_RELEASE', 'CREATED'] }
                },
                data: { bookStatus: 'IN_STOCK' }
            });

            return { batch: updatedBatch, updatedClientsCount: updatedClients.count };
        });

        res.json({ 
            message: `Lote liberado para estoque (${updatedClientsCount} ficha(s) atualizada(s)).`, 
            batch,
            updatedCount: updatedClientsCount
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao liberar lote' });
    }
});

// Receive returned book (Admin)
router.post('/receive-return', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { sequenceNumber, clientId } = req.body;
        const rawIdentifier = clientId || sequenceNumber || req.body.identifier || req.body.uuid || '';
        const identifier = String(rawIdentifier).trim();
        const companyId = req.user?.companyId;

        if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Empresa não identificada' });
        }

        const client = await prisma.client.findFirst({
            where: {
                ...(companyId ? { companyId } : {}),
                OR: [
                    { id: identifier },
                    { uuid: identifier },
                    { visibleCode: identifier },
                    { sequenceNumber: identifier },
                ]
            },
            include: { nonSales: true }
        });

        if (!client) {
            return res.status(404).json({ error: 'Book not found' });
        }
        if (client.bookStatus !== 'AWAITING_RETURN') return res.status(400).json({ error: 'Book is not awaiting return' });

        const latestNonSale =
          Array.isArray(client.nonSales) && client.nonSales.length > 0
            ? [...client.nonSales].sort(
                (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
              )[0]
            : null;
        const isTravelReturn =
          String(latestNonSale?.reason || '')
            .trim()
            .toUpperCase()
            .replace(/\s+/g, ' ') === 'EM VIAGEM';

        if (isTravelReturn) {
          const updated = await prisma.client.update({
            where: { id: client.id },
            data: {
              bookStatus: 'IN_STOCK_VIRGIN',
              assignedSellerId: null,
            },
          });

          await prisma.clientTimeline.create({
            data: {
              clientId: client.id,
              cycle: client.commercialCycle || 1,
              previousStatus: client.bookStatus,
              newStatus: 'IN_STOCK_VIRGIN',
              previousSellerId: client.assignedSellerId,
              newSellerId: null,
              authorId: req.user?.id,
              authorRole: req.user?.role,
              action: 'RECEIVE_RETURN_TRAVEL_VIRGIN',
              reason:
                'Devolução "Em Viagem" recebida pelo Admin; ficha retornou como book virgem (sem envio para Rebolo)',
            },
          });

          return res.json(updated);
        }

        const currentCycle = client.commercialCycle || 1;
        const nonSalesCount = client.nonSales ? client.nonSales.length : 0;
        const isSecondNonSale = currentCycle >= 2 || nonSalesCount >= 2;
        const nextBookStatus = isSecondNonSale ? 'DISCARDED' : 'IN_STOCK_REBOLO';
        const nextCycle = isSecondNonSale ? currentCycle : 2;

        const updated = await prisma.client.update({
            where: { id: client.id },
            data: {
              bookStatus: nextBookStatus,
              assignedSellerId: null,
              commercialCycle: nextCycle,
            }
        });

        await prisma.clientTimeline.create({
          data: {
            clientId: client.id,
            cycle: currentCycle,
            previousStatus: client.bookStatus,
            newStatus: nextBookStatus,
            previousSellerId: client.assignedSellerId,
            newSellerId: null,
            authorId: req.user?.id,
            authorRole: req.user?.role,
            action: 'RECEIVE_RETURN',
            reason: isSecondNonSale
              ? 'Devolução física da 2ª não-venda recebida pelo Admin; ficha encerrada definitivamente (descarte)'
              : 'Devolução da 1ª não-venda recebida pelo Admin; ficha movida para estoque de rebolo',
          },
        });

        res.json(updated);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Force release a single client to Admin (Photographer action)
router.put('/client/:id/force-send', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        const photographerId = req.user?.id;
        const companyId = req.user?.companyId;

        if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Empresa não identificada' });
        }
        if (!photographerId) {
            return res.status(400).json({ error: 'Missing photographer' });
        }

        // Operação protegida contra concorrência real com row-lock
        const result = await prisma.$transaction(async (tx) => {
            // 1. Lock exclusivo na linha da ficha para serializar force-send simultâneo e fechamento de lote
            await tx.$executeRaw`
                SELECT id FROM "Client"
                WHERE id = ${id as string}
                FOR UPDATE
            `;

            const client = await tx.client.findUnique({
                where: { id: id as string },
                include: { timeline: { where: { action: 'CITY_CLOSED' } } },
            });
            if (!client || (client.companyId !== companyId && req.user?.role !== 'SUPER_ADMIN') || client.photographerId !== photographerId) {
                return { status: 404, data: { error: 'Client not found or unauthorized' } };
            }

            if (isClientClosedForPhotographer(client)) {
                return { status: 403, data: { error: 'Ficha indisponível para envio: cidade já encerrada' } };
            }

            // Se já estiver em AWAITING_RELEASE (enviada anteriormente ou pela requisição concorrente vencedora)
            if (client.bookStatus === 'AWAITING_RELEASE') {
                return {
                    status: 200,
                    data: { message: 'Ficha já enviada e aguardando liberação do admin', client, alreadySent: true }
                };
            }

            // Se já avançou no ciclo comercial, nunca regredir nem duplicar lote
            const downstreamStatuses = ['IN_STOCK', 'DISTRIBUTED', 'SOLD', 'AWAITING_RETURN', 'IN_STOCK_REBOLO', 'DISTRIBUTED_REBOLO', 'REBOLO_SOLD', 'DISCARDED'];
            if (downstreamStatuses.includes(client.bookStatus)) {
                return {
                    status: 200,
                    data: { message: 'Ficha já processada e em etapa posterior do fluxo', client, alreadyProcessed: true }
                };
            }

            if (client.bookStatus !== 'CREATED') {
                return { status: 400, data: { error: 'Ficha em estado incompatível para envio avulso' } };
            }

            let batchId = client.batchId;
            if (!batchId) {
                const batch = await tx.bookBatch.create({
                    data: {
                        name: `Lote Avulso - ${client.name || client.sequenceNumber || 'Ficha'}`,
                        photographerId: photographerId!,
                        companyId,
                        status: 'AWAITING_RELEASE'
                    }
                });
                batchId = batch.id;
            }

            const updated = await tx.client.update({
                where: { id: client.id },
                data: { 
                    bookStatus: 'AWAITING_RELEASE',
                    batchId
                }
            });

            return {
                status: 200,
                data: { message: 'Ficha enviada com sucesso', client: updated },
                shouldNotify: true,
                clientName: client.name
            };
        });

        if (result.shouldNotify) {
            const admins = await prisma.user.findMany({ where: { role: 'ADMIN', companyId } });
            for (const admin of admins) {
                await prisma.notification.create({
                    data: {
                        title: 'Ficha Resgatada (Fotógrafo)',
                        message: `Fotógrafo resgatou e forçou envio da ficha de ${result.clientName || 'Sem Nome'}.`,
                        type: 'SYSTEM',
                        senderId: photographerId,
                        recipientId: admin.id,
                        companyId
                    }
                });
            }
        }

        res.status(result.status).json(result.data);
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao enviar ficha avulsa' });
    }
});

// Force release a single client to Stock (Admin action)
router.put('/client/:id/force-release', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId;

        if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Empresa não identificada' });
        }

        const client = await prisma.client.findUnique({ where: { id: id as string } });
        if (!client || (client.companyId !== companyId && req.user?.role !== 'SUPER_ADMIN')) {
            return res.status(404).json({ error: 'Client not found' });
        }

        let batchId = client.batchId;
        if (!batchId) {
            // Create a pseudo batch if none exists
            const batch = await prisma.bookBatch.create({
                data: {
                    name: `Resgate Admin - ${client.name}`,
                    photographerId: client.photographerId || req.user!.id,
                    companyId,
                    status: 'IN_STOCK'
                }
            });
            batchId = batch.id;
        }

        const updated = await prisma.client.update({
            where: { id: client.id },
            data: { 
                bookStatus: 'IN_STOCK',
                assignedSellerId: null,
                batchId
            }
        });

        await prisma.clientTimeline.create({
          data: {
            clientId: client.id,
            cycle: client.commercialCycle || 1,
            previousStatus: client.bookStatus,
            newStatus: 'IN_STOCK',
            previousSellerId: client.assignedSellerId,
            newSellerId: null,
            authorId: req.user?.id,
            authorRole: req.user?.role,
            action: 'FORCE_RELEASE_ADMIN',
            reason: 'Ficha liberada para estoque central pelo Admin',
          },
        });

        res.json({ message: 'Ficha liberada com sucesso', client: updated });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Admin puxa do Vendedor (DISTRIBUTED -> IN_STOCK)
router.put('/client/:id/force-return-to-stock', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId;

        if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Empresa não identificada' });
        }

        const client = await prisma.client.findUnique({ where: { id: id as string } });
        if (!client || (client.companyId !== companyId && req.user?.role !== 'SUPER_ADMIN') || client.bookStatus !== 'DISTRIBUTED') {
            return res.status(404).json({ error: 'Client not found or not distributed' });
        }

        const updated = await prisma.client.update({
            where: { id: client.id },
            data: { bookStatus: 'IN_STOCK', assignedSellerId: null }
        });

        await prisma.clientTimeline.create({
          data: {
            clientId: client.id,
            cycle: client.commercialCycle || 1,
            previousStatus: client.bookStatus,
            newStatus: 'IN_STOCK',
            previousSellerId: client.assignedSellerId,
            newSellerId: null,
            authorId: req.user?.id,
            authorRole: req.user?.role,
            action: 'FORCE_RETURN_TO_STOCK',
            reason: 'Admin resgatou a posse da ficha de volta para o estoque central',
          },
        });

        res.json({ message: 'Ficha resgatada para estoque', client: updated });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Vendedor força devolução pro Admin (DISTRIBUTED -> AWAITING_RETURN)
router.put('/client/:id/force-return', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        const sellerId = req.user?.id;
        const companyId = req.user?.companyId;

        if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Empresa não identificada' });
        }

        const client = await prisma.client.findUnique({ where: { id: id as string } });
        if (!client || (client.companyId !== companyId && req.user?.role !== 'SUPER_ADMIN') || client.bookStatus !== 'DISTRIBUTED') {
            return res.status(404).json({ error: 'Client not found or not distributed' });
        }

        const updated = await prisma.client.update({
            where: { id: client.id },
            data: { bookStatus: 'AWAITING_RETURN' }
        });

        await prisma.clientTimeline.create({
          data: {
            clientId: client.id,
            cycle: client.commercialCycle || 1,
            previousStatus: client.bookStatus,
            newStatus: 'AWAITING_RETURN',
            previousSellerId: client.assignedSellerId,
            newSellerId: client.assignedSellerId,
            authorId: sellerId,
            authorRole: req.user?.role,
            action: 'FORCE_RETURN_SELLER',
            reason: 'Vendedor enviou ficha para devolução ao Admin',
          },
        });

        // Notify Admins
        const admins = await prisma.user.findMany({ where: { role: 'ADMIN', companyId } });
        for (const admin of admins) {
            await prisma.notification.create({
                data: {
                    title: 'Devolução Forçada (Vendedor)',
                    message: `Vendedor devolveu à força a ficha de ${client.name || 'Sem Nome'}.`,
                    type: 'SYSTEM',
                    senderId: sellerId,
                    recipientId: admin.id,
                    companyId
                }
            });
        }

        res.json({ message: 'Ficha enviada para devolução', client: updated });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Admin puxa do Rebolo (DISTRIBUTED_REBOLO -> IN_STOCK_REBOLO)
router.put('/client/:id/force-return-rebolo-stock', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId;

        if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Empresa não identificada' });
        }

        const client = await prisma.client.findUnique({ where: { id: id as string } });
        if (!client || (client.companyId !== companyId && req.user?.role !== 'SUPER_ADMIN') || client.bookStatus !== 'DISTRIBUTED_REBOLO') {
            return res.status(404).json({ error: 'Client not found or not distributed as rebolo' });
        }

        const updated = await prisma.client.update({
            where: { id: client.id },
            data: { bookStatus: 'IN_STOCK_REBOLO', assignedSellerId: null }
        });

        await prisma.clientTimeline.create({
          data: {
            clientId: client.id,
            cycle: client.commercialCycle || 2,
            previousStatus: client.bookStatus,
            newStatus: 'IN_STOCK_REBOLO',
            previousSellerId: client.assignedSellerId,
            newSellerId: null,
            authorId: req.user?.id,
            authorRole: req.user?.role,
            action: 'FORCE_RETURN_REBOLO_STOCK',
            reason: 'Admin resgatou ficha de rebolo para o estoque de rebolo',
          },
        });

        res.json({ message: 'Rebolo resgatado para estoque', client: updated });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Rebolo força devolução pro Admin (DISTRIBUTED_REBOLO -> AWAITING_RETURN)
router.put('/client/:id/force-return-rebolo', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        const sellerId = req.user?.id;
        const companyId = req.user?.companyId;

        if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Empresa não identificada' });
        }

        const client = await prisma.client.findUnique({ where: { id: id as string } });
        if (!client || (client.companyId !== companyId && req.user?.role !== 'SUPER_ADMIN') || client.bookStatus !== 'DISTRIBUTED_REBOLO') {
            return res.status(404).json({ error: 'Client not found or not distributed as rebolo' });
        }

        const updated = await prisma.client.update({
            where: { id: client.id },
            data: { bookStatus: 'AWAITING_RETURN' }
        });

        await prisma.clientTimeline.create({
          data: {
            clientId: client.id,
            cycle: client.commercialCycle || 2,
            previousStatus: client.bookStatus,
            newStatus: 'AWAITING_RETURN',
            previousSellerId: client.assignedSellerId,
            newSellerId: client.assignedSellerId,
            authorId: sellerId,
            authorRole: req.user?.role,
            action: 'FORCE_RETURN_REBOLO_SELLER',
            reason: 'Vendedor devolveu ficha de rebolo para o Admin',
          },
        });

        // Notify Admins
        const admins = await prisma.user.findMany({ where: { role: 'ADMIN', companyId } });
        for (const admin of admins) {
            await prisma.notification.create({
                data: {
                    title: 'Devolução Forçada (Rebolo)',
                    message: `Rebolo devolveu à força a ficha de ${client.name || 'Sem Nome'}.`,
                    type: 'SYSTEM',
                    senderId: sellerId,
                    recipientId: admin.id,
                    companyId
                }
            });
        }

        res.json({ message: 'Rebolo enviado para devolução', client: updated });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Search book (Seller)
router.get('/search', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { q } = req.query;
        const companyId = req.user?.companyId;

        if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Empresa não identificada' });
        }

        if (!q) return res.json([]);

        const isPhotographer = req.user?.role === 'PHOTOGRAPHER';
        const photographerWhere = isPhotographer && req.user?.id ? {
            photographerId: req.user.id,
            photographerClosedAt: null,
            cityClosedAt: null,
            bookStatus: 'CREATED',
            commercialCycle: { lte: 1 },
            timeline: { none: { action: 'CITY_CLOSED' } },
        } : {};

        let clients: any[];
        const queryString = (q as string).trim();

        if (isPhotographer) {
            clients = await prisma.client.findMany({
                where: {
                    companyId,
                    ...photographerWhere,
                    OR: [
                        { uuid: { contains: queryString, mode: 'insensitive' } },
                        { visibleCode: { contains: queryString, mode: 'insensitive' } },
                        { sequenceNumber: { contains: queryString, mode: 'insensitive' } },
                        { name: { contains: queryString, mode: 'insensitive' } },
                        { mainContact: { contains: queryString, mode: 'insensitive' } },
                        { children: { some: { name: { contains: queryString, mode: 'insensitive' } } } }
                    ]
                },
                include: {
                    timeline: { where: { action: 'CITY_CLOSED' } },
                    children: { select: { id: true, name: true, age: true } },
                    batch: { select: { id: true, name: true } },
                },
                take: 20
            });
        } else {
            clients = await prisma.client.findMany({
                where: {
                    companyId,
                    OR: [
                        { uuid: { contains: queryString, mode: 'insensitive' } },
                        { visibleCode: { contains: queryString, mode: 'insensitive' } },
                        { sequenceNumber: { contains: queryString, mode: 'insensitive' } },
                        { name: { contains: queryString, mode: 'insensitive' } },
                        { mainContact: { contains: queryString, mode: 'insensitive' } },
                        { children: { some: { name: { contains: queryString, mode: 'insensitive' } } } }
                    ]
                },
                select: {
                    id: true,
                    uuid: true,
                    visibleCode: true,
                    sequenceNumber: true,
                    name: true,
                    mainContact: true,
                    city: true,
                    state: true,
                    bookStatus: true,
                    outcomeStatus: true,
                    batchId: true,
                    batch: {
                        select: { id: true, name: true }
                    },
                    children: {
                        select: { id: true, name: true, age: true }
                    },
                    photographer: {
                        select: { id: true, name: true }
                    },
                    assignedSeller: {
                        select: { id: true, name: true }
                    }
                },
                take: 20
            });
        }

        const formatChild = (ch: any) => {
            const name = ch?.name ? String(ch.name).trim() : '';
            const ageRaw = ch?.age;
            if (ageRaw !== undefined && ageRaw !== null && String(ageRaw).trim() !== '') {
                const ageNum = parseInt(String(ageRaw).trim(), 10);
                if (!isNaN(ageNum)) {
                    const unit = ageNum === 1 ? 'ano' : 'anos';
                    return name ? `${name} — ${ageNum} ${unit}` : `${ageNum} ${unit}`;
                }
            }
            return name;
        };

        const formattedClients = isPhotographer
            ? clients
                .filter((c) => !isClientClosedForPhotographer(c))
                .map((c) => ({
                    id: c.id,
                    uuid: c.uuid,
                    visibleCode: c.visibleCode,
                    sequenceNumber: c.sequenceNumber,
                    name: c.name,
                    mainContact: c.mainContact,
                    city: c.city,
                    state: c.state,
                    batchName: c.batch?.name || 'Sem Lote',
                    childrenNames: (c.children || []).map(formatChild).filter(Boolean).join(', '),
                    currentCustodian: 'Fotógrafo (' + (c.photographer?.name || 'Você') + ')',
                    bookStatus: c.bookStatus || 'CREATED',
                }))
            : clients.map((c) => {
                let currentCustodian = 'Estoque / Central';
                const status = (c.bookStatus || '').toUpperCase();

                if (status === 'CREATED' || status === 'AWAITING_RELEASE') {
                    currentCustodian = c.photographer?.name ? `Fotógrafo (${c.photographer.name})` : 'Em produção fotográfica';
                } else if (status === 'IN_STOCK' || status === 'IN_STOCK_REBOLO') {
                    currentCustodian = 'Estoque / Central';
                } else if (status === 'DISTRIBUTED' || status === 'DISTRIBUTED_REBOLO') {
                    currentCustodian = c.assignedSeller?.name ? `Com vendedor (${c.assignedSeller.name})` : 'Com vendedor';
                } else if (status === 'AWAITING_RETURN') {
                    currentCustodian = c.assignedSeller?.name
                        ? `Aguardando devolução do vendedor (${c.assignedSeller.name}) para o Estoque`
                        : 'Aguardando devolução para o Estoque';
                } else if (status === 'SOLD' || status === 'REBOLO_SOLD') {
                    currentCustodian = c.assignedSeller?.name ? `Vendida (${c.assignedSeller.name})` : 'Vendida';
                }

                return {
                    id: c.id,
                    uuid: c.uuid,
                    visibleCode: c.visibleCode,
                    sequenceNumber: c.sequenceNumber,
                    name: c.name,
                    mainContact: c.mainContact,
                    city: c.city,
                    state: c.state,
                    batchId: c.batchId,
                    batchName: c.batch?.name || 'Sem Lote',
                    childrenNames: (c.children || []).map(formatChild).filter(Boolean).join(', '),
                    children: c.children,
                    bookStatus: c.bookStatus,
                    outcomeStatus: c.outcomeStatus,
                    currentCustodian,
                    assignedSeller: c.assignedSeller,
                };
            });

        res.json(formattedClients);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// List book batches
router.get('/batch', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const companyId = req.user?.companyId;
        const userRole = (req.user?.role || '').toUpperCase();

        if (userRole === 'SELLER' || userRole === 'VENDEDOR') {
            return res.status(403).json({ error: 'Acesso restrito: vendedores não têm permissão para listar lotes da gráfica' });
        }

        if (!companyId && userRole !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Empresa não identificada' });
        }

        const isPhotographer = userRole === 'PHOTOGRAPHER' || userRole === 'FOTOGRAFO';
        const batchWhere: any = companyId ? { companyId } : {};
        if (isPhotographer && req.user?.id) {
            batchWhere.photographerId = req.user.id;
        }

        const batches = await prisma.bookBatch.findMany({
            where: batchWhere,
            include: { 
                photographer: { select: { id: true, name: true } },
                clients: {
                    select: {
                        id: true,
                        uuid: true,
                        visibleCode: true,
                        sequenceNumber: true,
                        name: true,
                        city: true,
                        state: true,
                        bookStatus: true,
                        outcomeStatus: true,
                        cityClosedAt: true,
                        assignedSellerId: true,
                        assignedSeller: { select: { id: true, name: true } }
                    }
                }
            },
            orderBy: { date: 'desc' }
        });

        const includeConcluded = req.query.includeConcluded === 'true';

        const formattedBatches = batches.map(batch => {
            const allClients = batch.clients || [];
            
            // Fichas ativas primárias na rota gráfica (exclui vendidas, descartadas, encerradas ou em Rebolo)
            const activePrimaryClients = allClients.filter(c => 
                ['CREATED', 'AWAITING_RELEASE', 'IN_STOCK', 'DISTRIBUTED'].includes(c.bookStatus) &&
                !c.cityClosedAt
            );

            // Contagens por estágio do fluxo primário de Books
            const inProductionCount = allClients.filter(c => c.bookStatus === 'CREATED').length;
            const awaitingReleaseCount = allClients.filter(c => c.bookStatus === 'AWAITING_RELEASE').length;
            const inStockCount = allClients.filter(c => c.bookStatus === 'IN_STOCK').length;
            const distributedCount = allClients.filter(c => c.bookStatus === 'DISTRIBUTED' && !c.cityClosedAt).length;
            const reboloCount = allClients.filter(c =>
                ['AWAITING_RETURN', 'IN_STOCK_REBOLO', 'DISTRIBUTED_REBOLO'].includes(c.bookStatus)
            ).length;
            const soldCount = allClients.filter(c => c.bookStatus === 'SOLD' || c.bookStatus === 'REBOLO_SOLD').length;
            
            // Marco de total produzido: totalProduced gravado ou total histórico de fichas vinculadas
            const totalProduced = batch.totalProduced && batch.totalProduced > 0 
                ? batch.totalProduced 
                : allClients.length;

            // Vendedores atribuídos às fichas deste lote
            const sellerCounts = new Map<string, { id: string; name: string; count: number }>();
            const sellerSourceClients = includeConcluded ? allClients : activePrimaryClients;
            for (const c of sellerSourceClients) {
                if (c.assignedSellerId && c.assignedSeller?.name) {
                    const prev = sellerCounts.get(c.assignedSellerId);
                    if (prev) {
                        prev.count++;
                    } else {
                        sellerCounts.set(c.assignedSellerId, {
                            id: c.assignedSellerId,
                            name: c.assignedSeller.name,
                            count: 1
                        });
                    }
                }
            }
            const assignedSellers = Array.from(sellerCounts.values()).sort(
                (a, b) => b.count - a.count || a.name.localeCompare(b.name)
            );

            // Cidades distintas (não vazias)
            const citiesSet = new Set<string>();
            if (batch.city && batch.city.trim()) citiesSet.add(batch.city.trim());
            for (const c of allClients) {
                if (c.city && c.city.trim()) citiesSet.add(c.city.trim());
            }
            const distinctCities = Array.from(citiesSet);

            // Para preservar a privacidade de fichas cadastradas em campo aberto durante a produção,
            // não expõe identidades individuais de clientes enquanto o lote estiver com status CREATED,
            // retornando apenas os totais/contadores agregados.
            const clientsForResponse = batch.status === 'CREATED'
                ? []
                : (includeConcluded ? allClients : activePrimaryClients);

            return {
                ...batch,
                totalProduced,
                cities: distinctCities,
                assignedSellers,
                clients: clientsForResponse,
                counts: {
                    produced: totalProduced,
                    inProduction: inProductionCount,
                    awaitingRelease: awaitingReleaseCount,
                    inStock: inStockCount,
                    distributed: distributedCount,
                    rebolo: reboloCount,
                    sold: soldCount,
                    active: activePrimaryClients.length
                }
            };
        });

        // Filtrar lotes já concluídos, inteiramente vendidos ou transferidos ao Rebolo
        const operationalBatches = includeConcluded 
            ? formattedBatches 
            : formattedBatches.filter(b => {
                const activePrimaryTotal =
                    b.counts.inProduction +
                    b.counts.awaitingRelease +
                    b.counts.inStock +
                    b.counts.distributed;
                if (activePrimaryTotal > 0) return true;
                // Lote recém-aberto ainda sem fichas cadastradas permanece visível
                if ((b.clients?.length ?? 0) === 0 && (b.counts.produced ?? 0) === 0 && (b.status === 'CREATED' || b.status === 'AWAITING_RELEASE')) {
                    return true;
                }
                return false;
            });

        res.json(operationalBatches);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Update batch base city (Admin)
router.patch('/batch/:id/base-city', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        const { baseCity } = req.body;
        const companyId = req.user?.companyId;

        if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Empresa não identificada' });
        }

        const batch = await prisma.bookBatch.findFirst({
            where: { id: id as string, ...(companyId ? { companyId } : {}) }
        });

        if (!batch) {
            return res.status(404).json({ error: 'Lote não encontrado' });
        }

        const cleanBaseCity = typeof baseCity === 'string' ? baseCity.trim() : '';
        let newName = batch.name;
        if (cleanBaseCity.length > 0) {
            const baseName = batch.name.replace(/\s*\([^)]*\)\s*$/, '').trim();
            newName = `${baseName} (${cleanBaseCity})`;
        } else {
            newName = batch.name.replace(/\s*\([^)]*\)\s*$/, '').trim();
        }

        const updated = await prisma.bookBatch.update({
            where: { id: id as string },
            data: { name: newName }
        });

        res.json({ success: true, batch: updated });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Lista fichas registradas como "Em Viagem" aguardando geração de novo lote (book virgem)
router.get('/travel-virgin', authMiddleware, requireAdminOrSupervisor, async (req: AuthRequest, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Empresa não identificada' });
        }

        const clients = await prisma.client.findMany({
            where: {
                ...(companyId ? { companyId } : {}),
                bookStatus: 'IN_STOCK_VIRGIN',
            },
            include: {
                batch: { select: { id: true, name: true, city: true } },
                photographer: { select: { id: true, name: true } },
                assignedSeller: { select: { id: true, name: true } },
                nonSales: {
                    where: { supersededAt: null },
                    include: { seller: { select: { id: true, name: true } } },
                    orderBy: { date: 'desc' },
                    take: 1,
                },
                children: true,
            },
            orderBy: { outcomeUpdatedAt: 'desc' },
        });

        res.json(clients);
    } catch (error: any) {
        console.error('Error fetching travel-virgin books:', error);
        res.status(500).json({ error: 'Falha ao buscar books Em Viagem (virgens)' });
    }
});

// Gera um novo lote operacional (BookBatch) identificado a partir de fichas "Em Viagem" para nova tentativa
router.post('/travel-batch', authMiddleware, requireAdminOrSupervisor, async (req: AuthRequest, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Empresa não identificada' });
        }

        const { clientIds, batchName, city, targetSellerId, reason } = req.body as {
            clientIds?: string[];
            batchName?: string;
            city?: string;
            targetSellerId?: string;
            reason?: string;
        };

        if (!Array.isArray(clientIds) || clientIds.length === 0) {
            return res.status(400).json({ error: 'Selecione ao menos uma ficha "Em Viagem" para gerar o novo lote.' });
        }

        const cleanIds = Array.from(new Set(clientIds.map((id) => String(id).trim()).filter(Boolean)));
        if (cleanIds.length === 0) {
            return res.status(400).json({ error: 'Nenhuma ficha válida informada.' });
        }

        const virginClients = await prisma.client.findMany({
            where: {
                id: { in: cleanIds },
                ...(companyId ? { companyId } : {}),
                bookStatus: 'IN_STOCK_VIRGIN',
            },
            include: {
                batch: { select: { id: true, name: true } },
            },
        });

        if (virginClients.length !== cleanIds.length) {
            return res.status(409).json({
                error: 'Uma ou mais fichas selecionadas não estão disponíveis como book virgem "Em Viagem" na sua empresa.',
            });
        }

        const effectiveCompanyId = virginClients[0].companyId || companyId!;

        let validSeller: { id: string; name: string } | null = null;
        if (targetSellerId && String(targetSellerId).trim()) {
            const seller = await prisma.user.findFirst({
                where: {
                    id: String(targetSellerId).trim(),
                    companyId: effectiveCompanyId,
                    active: true,
                    role: { in: ['SELLER', 'SELLER_MANAGER', 'VENDEDOR'] },
                },
                select: { id: true, name: true },
            });
            if (!seller) {
                return res.status(404).json({ error: 'Vendedor de destino não encontrado ou inativo na empresa.' });
            }
            validSeller = seller;
        }

        const citiesList = Array.from(
            new Set(virginClients.map((c) => (c.city || '').trim()).filter(Boolean))
        );
        const effectiveCity =
            (city && String(city).trim()) ||
            (citiesList.length === 1 ? citiesList[0] : citiesList.join(', ').slice(0, 80) || null);

        const nowBr = new Date(Date.now() - 3 * 60 * 60 * 1000);
        const dayStr = `${String(nowBr.getUTCDate()).padStart(2, '0')}/${String(nowBr.getUTCMonth() + 1).padStart(2, '0')}`;
        const defaultName = effectiveCity
            ? `Lote Em Viagem - ${effectiveCity} (${dayStr})`
            : `Lote Em Viagem (${dayStr})`;
        const cleanBatchName =
            batchName && String(batchName).trim()
                ? String(batchName).trim()
                : defaultName;

        const photographerId =
            virginClients.find((c) => Boolean(c.photographerId))?.photographerId || req.user?.id!;
        const nextClientStatus = validSeller ? 'DISTRIBUTED' : 'IN_STOCK';
        const nextBatchStatus = validSeller ? 'DISTRIBUTED' : 'IN_STOCK';

        const result = await prisma.$transaction(async (tx) => {
            const createdBatch = await tx.bookBatch.create({
                data: {
                    name: cleanBatchName,
                    city: effectiveCity,
                    photographerId,
                    companyId: effectiveCompanyId,
                    status: nextBatchStatus,
                    totalProduced: virginClients.length,
                },
            });

            await tx.client.updateMany({
                where: { id: { in: cleanIds } },
                data: {
                    batchId: createdBatch.id,
                    bookStatus: nextClientStatus,
                    assignedSellerId: validSeller ? validSeller.id : null,
                    outcomeStatus: 'PENDING',
                    outcomeUpdatedAt: null,
                    cityClosedAt: null,
                    commercialCycle: 1,
                },
            });

            for (const c of virginClients) {
                await tx.clientTimeline.create({
                    data: {
                        clientId: c.id,
                        cycle: 1,
                        action: 'TRAVEL_BATCH_CREATED',
                        previousStatus: c.bookStatus,
                        newStatus: nextClientStatus,
                        previousSellerId: c.assignedSellerId,
                        newSellerId: validSeller ? validSeller.id : null,
                        authorId: req.user?.id || null,
                        authorRole: req.user?.role || null,
                        reason:
                            reason?.trim() ||
                            `Novo lote "${cleanBatchName}" gerado a partir de book Em Viagem (book virgem)`,
                        metadata: {
                            previousBatchId: c.batchId,
                            previousBatchName: c.batch?.name || null,
                            newBatchId: createdBatch.id,
                            newBatchName: createdBatch.name,
                            origin: 'EM_VIAGEM_VIRGIN',
                        },
                    },
                });
            }

            await recordOperationalAuditEvent(
                {
                    companyId: effectiveCompanyId,
                    category: 'CONDITIONS',
                    action: 'ADMIN_TRAVEL_BATCH_CREATED',
                    entityType: 'BookBatch',
                    entityId: createdBatch.id,
                    entityReference: createdBatch.name,
                    previousValues: {
                        sourceClientIds: cleanIds,
                        previousStatus: 'IN_STOCK_VIRGIN',
                    },
                    newValues: {
                        batchId: createdBatch.id,
                        batchName: createdBatch.name,
                        status: createdBatch.status,
                        movedCount: virginClients.length,
                        targetSellerId: validSeller?.id || null,
                        targetSellerName: validSeller?.name || null,
                    },
                    reason:
                        reason?.trim() ||
                        `Geração de lote operacional "${createdBatch.name}" com ${virginClients.length} book(s) virgem(ns) Em Viagem`,
                    authorUserId: req.user?.id || null,
                    authorName: req.user?.name || req.user?.cpf || 'Admin',
                    authorRole: req.user?.role || null,
                },
                tx
            );

            return createdBatch;
        });

        res.status(201).json({
            batch: result,
            movedCount: virginClients.length,
            clientIds: cleanIds,
            targetSeller: validSeller,
            message: `Lote "${result.name}" gerado com ${virginClients.length} ficha(s) virgem(ns).`,
        });
    } catch (error: any) {
        console.error('Error creating travel batch:', error);
        res.status(500).json({ error: error.message || 'Falha ao gerar novo lote Em Viagem' });
    }
});

export default router;
