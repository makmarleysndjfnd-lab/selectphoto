"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
// Add book batch (Photographer)
router.post('/batch', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { name } = req.body;
        const photographerId = req.user?.id;
        if (!photographerId)
            return res.status(401).json({ error: 'Unauthorized' });
        const batch = await prisma.bookBatch.create({
            data: {
                name,
                photographerId,
                companyId: req.user?.companyId,
            }
        });
        res.status(201).json(batch);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// List book batches
router.get('/batch', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        const batches = await prisma.bookBatch.findMany({
            where: companyId ? { companyId } : undefined,
            include: { photographer: true },
            orderBy: { date: 'desc' }
        });
        res.json(batches);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Update book batch status (Admin ramifications)
router.put('/batch/:id', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const batch = await prisma.bookBatch.update({
            where: { id: id },
            data: { status }
        });
        res.json(batch);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.default = router;
