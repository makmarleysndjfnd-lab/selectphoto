"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
// Sync clients from mobile (batch)
router.post('/sync', authMiddleware_1.authenticateToken, async (req, res) => {
    const { clients } = req.body; // Array of clients
    const companyId = req.user?.companyId;
    if (!Array.isArray(clients)) {
        res.status(400).json({ error: 'Expected an array of clients' });
        return;
    }
    const results = { success: 0, failed: 0, errors: [] };
    for (const clientData of clients) {
        try {
            const { children, appointments, signatureBase64, ...basicClientData } = clientData;
            let photographerId = basicClientData.photographerId;
            let assignedSellerId = basicClientData.assignedSellerId;
            if (!photographerId && req.user?.role === 'PHOTOGRAPHER') {
                photographerId = req.user.id;
            }
            if (!assignedSellerId && (req.user?.role === 'SELLER' || req.user?.role === 'SELLER_MANAGER')) {
                assignedSellerId = req.user.id;
            }
            let finalSignatureUrl = basicClientData.signatureUrl;
            if (signatureBase64) {
                // Store as a data URI in the database to keep it simple and compressed
                finalSignatureUrl = `data:image/png;base64,${signatureBase64}`;
            }
            // Upsert client to avoid duplicate on resync
            const client = await prisma.client.upsert({
                where: { sequenceNumber: basicClientData.sequenceNumber },
                update: {
                    ...basicClientData,
                    signatureUrl: finalSignatureUrl,
                    status: 'SYNCED',
                    companyId,
                    photographerId,
                    assignedSellerId,
                },
                create: {
                    ...basicClientData,
                    signatureUrl: finalSignatureUrl,
                    status: 'SYNCED',
                    companyId,
                    photographerId,
                    assignedSellerId,
                    children: children ? {
                        create: children.map((c) => ({ name: c.name, age: typeof c.age === 'string' ? parseInt(c.age, 10) : c.age }))
                    } : undefined,
                    appointments: appointments ? {
                        create: appointments.map((a) => ({
                            date: new Date(a.date),
                            time: a.time,
                            observation: a.observation,
                            responsibleId: a.responsibleId,
                            status: a.status
                        }))
                    } : undefined
                }
            });
            results.success++;
        }
        catch (error) {
            console.error('Error syncing client:', error);
            results.failed++;
            results.errors.push({ sequenceNumber: clientData.sequenceNumber, error: error.message });
        }
    }
    res.json(results);
});
// Get all clients
router.get('/', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const clients = await prisma.client.findMany({
            where: { companyId: req.user?.companyId },
            include: { children: true, appointments: true, assignedSeller: true, photographer: { select: { id: true, name: true } } }
        });
        res.json(clients);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch clients' });
    }
});
// Release city for routing (sets releasedForRouting = true)
router.put('/release-city', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { city } = req.body;
        if (!city) {
            res.status(400).json({ error: 'City is required' });
            return;
        }
        const updated = await prisma.client.updateMany({
            where: {
                companyId: req.user?.companyId,
                city: city,
                releasedForRouting: false
            },
            data: {
                releasedForRouting: true
            }
        });
        res.json({ message: 'Lotes liberados com sucesso!', count: updated.count });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to release city for routing' });
    }
});
// Confirm arrival from gráfica — moves AWAITING_RELEASE → IN_STOCK for a city
router.put('/confirm-grafica', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { city } = req.body;
        if (!city) {
            res.status(400).json({ error: 'City is required' });
            return;
        }
        const updated = await prisma.client.updateMany({
            where: {
                companyId: req.user?.companyId,
                city: { equals: city, mode: 'insensitive' },
                bookStatus: 'AWAITING_RELEASE'
            },
            data: {
                bookStatus: 'IN_STOCK'
            }
        });
        res.json({ message: `${updated.count} fichas movidas para estoque!`, count: updated.count });
    }
    catch (error) {
        console.error('Erro ao confirmar gráfica:', error);
        res.status(500).json({ error: 'Falha ao confirmar chegada da gráfica' });
    }
});
// Get clients by city and optional bookStatus (for gráfica/estoque flow)
router.get('/by-city', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { city, bookStatus } = req.query;
        const clients = await prisma.client.findMany({
            where: {
                companyId: req.user?.companyId,
                ...(city ? { city: { equals: city, mode: 'insensitive' } } : {}),
                ...(bookStatus ? { bookStatus: bookStatus } : {})
            },
            include: { assignedSeller: true, team: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json(clients);
    }
    catch (error) {
        res.status(500).json({ error: 'Falha ao buscar fichas por cidade' });
    }
});
// Get rebolos (clients with nonSales but no sales)
router.get('/rebolos', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const clients = await prisma.client.findMany({
            where: {
                companyId: req.user?.companyId,
                nonSales: { some: {} },
                sales: { none: {} }
            },
            include: { children: true, appointments: true, nonSales: true, photographer: true, assignedSeller: true }
        });
        res.json(clients);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch rebolos' });
    }
});
// Assign seller to a client/book
router.post('/assign-seller', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { sequenceNumber, sellerId } = req.body;
        const userCompanyId = req.user?.companyId;
        if (!sequenceNumber || !sellerId) {
            res.status(400).json({ error: 'Faltam sequenceNumber ou sellerId' });
            return;
        }
        // Verify seller belongs to company
        const seller = await prisma.user.findFirst({
            where: {
                id: sellerId,
                ...(userCompanyId ? { companyId: userCompanyId } : {}),
            },
        });
        if (!seller) {
            res.status(404).json({ error: 'Vendedor não encontrado na sua empresa' });
            return;
        }
        // Find client in same company
        const existingClient = await prisma.client.findFirst({
            where: {
                sequenceNumber,
                ...(userCompanyId ? { companyId: userCompanyId } : {}),
            },
        });
        if (!existingClient) {
            res.status(404).json({ error: 'Cliente não encontrado na sua empresa' });
            return;
        }
        const client = await prisma.client.update({
            where: { id: existingClient.id },
            data: { assignedSellerId: sellerId },
        });
        res.json({ success: true, client });
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao atribuir vendedor' });
    }
});
// Get clients by photographer
router.get('/photographer', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const clients = await prisma.client.findMany({
            where: {
                companyId: req.user?.companyId,
                photographerId: req.user?.id
            },
            include: { children: true, appointments: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json(clients);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch photographer clients' });
    }
});
// Get clients by seller
router.get('/seller', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const clients = await prisma.client.findMany({
            where: {
                companyId: req.user?.companyId,
                assignedSellerId: req.user?.id
            },
            include: { children: true, appointments: true, assignedSeller: true, photographer: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json(clients);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch seller clients' });
    }
});
// Batch assign seller to multiple clients
router.patch('/batch-assign', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { clientIds, assignedSellerId } = req.body;
        const userCompanyId = req.user?.companyId;
        if (!Array.isArray(clientIds) || clientIds.length === 0 || !assignedSellerId) {
            res.status(400).json({ error: 'Lista de fichas ou vendedor inválido' });
            return;
        }
        // Verify seller belongs to user's company
        const seller = await prisma.user.findFirst({
            where: {
                id: assignedSellerId,
                ...(userCompanyId ? { companyId: userCompanyId } : {}),
            },
        });
        if (!seller) {
            res.status(404).json({ error: 'Vendedor não encontrado na sua empresa' });
            return;
        }
        const updated = await prisma.client.updateMany({
            where: {
                id: { in: clientIds },
                ...(userCompanyId ? { companyId: userCompanyId } : {}),
            },
            data: {
                assignedSellerId,
                bookStatus: 'DISTRIBUTED'
            }
        });
        res.json({ success: true, count: updated.count });
    }
    catch (error) {
        console.error("Erro ao atribuir lote de fichas:", error);
        res.status(500).json({ error: 'Erro ao atribuir lote de fichas' });
    }
});
exports.default = router;
