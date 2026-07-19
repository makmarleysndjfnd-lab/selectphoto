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
                },
                create: {
                    ...basicClientData,
                    signatureUrl: finalSignatureUrl,
                    status: 'SYNCED',
                    companyId,
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
            include: { children: true, appointments: true, assignedSeller: true }
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
        if (!sequenceNumber || !sellerId) {
            res.status(400).json({ error: 'Faltam sequenceNumber ou sellerId' });
            return;
        }
        const client = await prisma.client.update({
            where: { sequenceNumber },
            data: { assignedSellerId: sellerId }
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
exports.default = router;
