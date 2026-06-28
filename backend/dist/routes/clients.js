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
            const { children, appointments, ...basicClientData } = clientData;
            // Upsert client to avoid duplicate on resync
            const client = await prisma.client.upsert({
                where: { sequenceNumber: basicClientData.sequenceNumber },
                update: {
                    ...basicClientData,
                    status: 'SYNCED',
                    companyId,
                },
                create: {
                    ...basicClientData,
                    status: 'SYNCED',
                    companyId,
                    children: children ? {
                        create: children.map((c) => ({ name: c.name, age: c.age }))
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
            include: { children: true, appointments: true }
        });
        res.json(clients);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch clients' });
    }
});
exports.default = router;
