"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const authMiddleware_1 = require("../middleware/authMiddleware");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
// Get all companies
router.get('/companies', authMiddleware_1.authenticateToken, authMiddleware_1.requireSuperAdmin, async (req, res) => {
    try {
        const companies = await prisma.company.findMany({
            include: {
                _count: {
                    select: { users: true, clients: true }
                }
            }
        });
        res.json(companies);
    }
    catch (error) {
        console.error('Error fetching companies:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Create a new company
router.post('/companies', authMiddleware_1.authenticateToken, authMiddleware_1.requireSuperAdmin, async (req, res) => {
    try {
        const { name, cnpj, planLimit } = req.body;
        const company = await prisma.company.create({
            data: { name, cnpj, planLimit: planLimit || 500 }
        });
        res.status(201).json(company);
    }
    catch (error) {
        console.error('Error creating company:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Toggle company status
router.put('/companies/:id/toggle', authMiddleware_1.authenticateToken, authMiddleware_1.requireSuperAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const company = await prisma.company.findUnique({ where: { id: id } });
        if (!company) {
            res.status(404).json({ error: 'Company not found' });
            return;
        }
        const updated = await prisma.company.update({
            where: { id: id },
            data: { isActive: !company.isActive }
        });
        res.json(updated);
    }
    catch (error) {
        console.error('Error toggling company:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Impersonate Company (Generate token for a specific company as Super Admin)
router.post('/impersonate/:companyId', authMiddleware_1.authenticateToken, authMiddleware_1.requireSuperAdmin, async (req, res) => {
    try {
        const { companyId } = req.params;
        const company = await prisma.company.findUnique({ where: { id: companyId } });
        if (!company) {
            res.status(404).json({ error: 'Company not found' });
            return;
        }
        // Generate a temporary token acting as COMPANY_ADMIN for that company
        const token = jsonwebtoken_1.default.sign({
            id: req.user.id,
            email: req.user.email,
            role: 'COMPANY_ADMIN', // Downgraded to standard company admin view
            companyId: company.id
        }, process.env.JWT_SECRET, { expiresIn: '12h' });
        res.json({ token, company });
    }
    catch (error) {
        console.error('Error impersonating company:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
