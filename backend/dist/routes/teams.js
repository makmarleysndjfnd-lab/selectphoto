"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
// Get all teams
router.get('/', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const teams = await prisma.team.findMany({
            where: { companyId: req.user?.companyId }
        });
        res.json(teams);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch teams' });
    }
});
// Create team (Admin only)
router.post('/', authMiddleware_1.authenticateToken, authMiddleware_1.requireAdmin, async (req, res) => {
    const { name, prefix, type } = req.body;
    try {
        const newTeam = await prisma.team.create({
            data: { name, prefix, type: type || 'SALES', companyId: req.user?.companyId }
        });
        res.status(201).json(newTeam);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to create team. Ensure prefix is unique.' });
    }
});
// Update team (Admin only)
router.put('/:id', authMiddleware_1.authenticateToken, authMiddleware_1.requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { name, prefix, active, type } = req.body;
    try {
        const existing = await prisma.team.findUnique({ where: { id: id } });
        if (!existing || existing.companyId !== req.user?.companyId) {
            return res.status(404).json({ error: 'Team not found' });
        }
        const updatedTeam = await prisma.team.update({
            where: { id: id },
            data: { name, prefix, active, type }
        });
        res.json(updatedTeam);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update team' });
    }
});
// Delete team (Admin only) - soft delete recommended or actual delete
router.delete('/:id', authMiddleware_1.authenticateToken, authMiddleware_1.requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const existing = await prisma.team.findUnique({ where: { id: id } });
        if (!existing || existing.companyId !== req.user?.companyId) {
            return res.status(404).json({ error: 'Team not found' });
        }
        await prisma.team.delete({
            where: { id: id }
        });
        res.status(204).send();
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to delete team. Make sure no users or clients are linked to it.' });
    }
});
exports.default = router;
