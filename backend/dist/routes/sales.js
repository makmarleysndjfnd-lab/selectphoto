"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
// Register a Sale
router.post('/', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { clientId, value, city, product, status, paymentStatus, fichaNumber, paymentMethod } = req.body;
        const sellerId = req.user.id;
        if (!clientId || !value || !city) {
            return res.status(400).json({ error: 'Client ID, Value, and City are required' });
        }
        const sale = await prisma.sale.create({
            data: {
                clientId,
                sellerId,
                value: parseFloat(value),
                city,
                product: product || "Mídias fotográficas",
                status: status || "PRONTO",
                paymentStatus: paymentStatus || "PAID",
                fichaNumber: fichaNumber || null,
                paymentMethod: paymentMethod || "CASH",
                companyId: req.user?.companyId
            },
        });
        res.status(201).json(sale);
    }
    catch (error) {
        console.error('Create sale error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Register a Non-Sale
router.post('/non-sale', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { clientId, reason, signatureBase64 } = req.body;
        const sellerId = req.user.id;
        if (!clientId || !reason || !signatureBase64) {
            return res.status(400).json({ error: 'Client ID, Reason, and Signature are required' });
        }
        const nonSale = await prisma.nonSale.create({
            data: {
                clientId,
                sellerId,
                reason,
                signatureBase64,
                companyId: req.user?.companyId
            },
        });
        res.status(201).json(nonSale);
    }
    catch (error) {
        console.error('Create non-sale error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Admin Metrics: Get Average Sales per City per Seller
router.get('/metrics', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        if (req.user?.role !== 'COMPANY_ADMIN' && req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied' });
        }
        const sales = await prisma.sale.findMany({
            where: { companyId: req.user?.companyId },
            include: {
                seller: {
                    select: { name: true }
                }
            }
        });
        // Grouping logic
        const citySellerTotals = {};
        for (const sale of sales) {
            if (!citySellerTotals[sale.city]) {
                citySellerTotals[sale.city] = {};
            }
            if (!citySellerTotals[sale.city][sale.seller.name]) {
                citySellerTotals[sale.city][sale.seller.name] = { totalValue: 0, count: 0 };
            }
            citySellerTotals[sale.city][sale.seller.name].totalValue += sale.value;
            citySellerTotals[sale.city][sale.seller.name].count += 1;
        }
        const metrics = [];
        for (const city in citySellerTotals) {
            for (const seller in citySellerTotals[city]) {
                const data = citySellerTotals[city][seller];
                metrics.push({
                    city,
                    seller,
                    averageValue: data.totalValue / data.count,
                    totalValue: data.totalValue,
                    salesCount: data.count
                });
            }
        }
        res.json(metrics);
    }
    catch (error) {
        console.error('Get metrics error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Register an Appointment
router.post('/appointments', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { clientId, date, time, observation } = req.body;
        const responsibleId = req.user.id;
        if (!clientId || !date || !time) {
            return res.status(400).json({ error: 'Client ID, Date, and Time are required' });
        }
        const appointment = await prisma.appointment.create({
            data: {
                clientId,
                responsibleId,
                date: new Date(date),
                time,
                observation,
                companyId: req.user?.companyId
            },
        });
        res.status(201).json(appointment);
    }
    catch (error) {
        console.error('Create appointment error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Register a Photo
router.post('/photos', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { clientId, photoBase64 } = req.body;
        const sellerId = req.user.id;
        if (!clientId || !photoBase64) {
            return res.status(400).json({ error: 'Client ID and Photo are required' });
        }
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 10); // Expiration in 10 days
        const photo = await prisma.sellerPhoto.create({
            data: {
                clientId,
                sellerId,
                photoPath: photoBase64, // In a real app this would save to S3 and save the URL, for now using base64 column
                expiresAt,
                companyId: req.user?.companyId
            },
        });
        res.status(201).json({ id: photo.id, expiresAt: photo.expiresAt });
    }
    catch (error) {
        console.error('Upload photo error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
