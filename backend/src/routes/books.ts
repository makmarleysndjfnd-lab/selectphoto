import express from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { authenticateToken as authMiddleware, AuthRequest } from '../middleware/authMiddleware';

const router = express.Router();
const prisma = new PrismaClient();

// Close Event Batch (Photographer)
router.post('/close-event', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { eventName, city, clientIds, batchId } = req.body;
        const photographerId = req.user?.id;
        const companyId = req.user?.companyId;

        if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Empresa não identificada' });
        }
        if (!photographerId) return res.status(400).json({ error: 'Missing photographer' });

        const cleanClientIds = Array.isArray(clientIds)
            ? clientIds.filter((id: any) => typeof id === 'string' && id.trim().length > 0)
            : [];
        const cleanBatchId = typeof batchId === 'string' && batchId.trim().length > 0 ? batchId.trim() : null;
        const cleanEventName = typeof eventName === 'string' ? eventName.trim() : '';
        const cleanCity = typeof city === 'string' && city.trim().length > 0 ? city.trim() : null;

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
                select: { id: true, bookStatus: true, name: true, event: true, city: true }
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

            // 4. Criar o BookBatch
            const effectiveEvent = cleanEventName || eligibleClients[0]?.event || 'Evento';
            const effectiveCity = cleanCity || eligibleClients[0]?.city || null;
            const batchName = effectiveCity
                ? `Lote - ${effectiveEvent} (${effectiveCity})`
                : `Lote - ${effectiveEvent}`;

            const newBatch = await tx.bookBatch.create({
                data: {
                    name: batchName,
                    photographerId: photographerId!,
                    companyId,
                    status: 'AWAITING_RELEASE'
                }
            });

            // 5. Atualizar as fichas para AWAITING_RELEASE associando o batchId
            const updateRes = await tx.client.updateMany({
                where: {
                    id: { in: eligibleClients.map(c => c.id) },
                    companyId,
                    bookStatus: 'CREATED'
                },
                data: {
                    bookStatus: 'AWAITING_RELEASE',
                    batchId: newBatch.id
                }
            });

            if (updateRes.count === 0) {
                // Se por corrida extrema nenhuma ficha foi associada, remove o lote para nunca deixar lote vazio
                await tx.bookBatch.delete({ where: { id: newBatch.id } });
                return { count: 0, alreadyClosed: true, batch: null, message: 'Todas as fichas deste lote já foram enviadas. Lote finalizado.' };
            }

            return {
                count: updateRes.count,
                alreadyClosed: false,
                batch: newBatch,
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
        const { sequenceNumber } = req.body;
        const companyId = req.user?.companyId;

        if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Empresa não identificada' });
        }

        const client = await prisma.client.findUnique({
            where: { sequenceNumber },
            include: { nonSales: true }
        });

        if (!client || (client.companyId !== companyId && req.user?.role !== 'SUPER_ADMIN')) {
            return res.status(404).json({ error: 'Book not found' });
        }
        if (client.bookStatus !== 'AWAITING_RETURN') return res.status(400).json({ error: 'Book is not awaiting return' });

        const nonSalesCount = client.nonSales ? client.nonSales.length : 0;
        const nextBookStatus = nonSalesCount >= 2 ? 'DISCARDED' : 'IN_STOCK_REBOLO';

        const updated = await prisma.client.update({
            where: { id: client.id },
            data: { bookStatus: nextBookStatus, assignedSellerId: null }
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

            const client = await tx.client.findUnique({ where: { id: id as string } });
            if (!client || (client.companyId !== companyId && req.user?.role !== 'SUPER_ADMIN') || client.photographerId !== photographerId) {
                return { status: 404, data: { error: 'Client not found or unauthorized' } };
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
                batchId
            }
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
            data: { bookStatus: 'IN_STOCK' }
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
            data: { bookStatus: 'IN_STOCK_REBOLO' }
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

        const clients = await prisma.client.findMany({
            where: {
                companyId,
                OR: [
                    { sequenceNumber: { contains: q as string, mode: 'insensitive' } },
                    { name: { contains: q as string, mode: 'insensitive' } }
                ]
            },
            select: {
                id: true,
                sequenceNumber: true,
                name: true,
                bookStatus: true,
                assignedSeller: {
                    select: { name: true }
                }
            },
            take: 10
        });

        res.json(clients);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// List book batches
router.get('/batch', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Empresa não identificada' });
        }

        const batches = await prisma.bookBatch.findMany({
            where: { companyId },
            include: { photographer: true },
            orderBy: { date: 'desc' }
        });

        res.json(batches);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
