"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
router.post('/login', async (req, res) => {
    const { cpf, password } = req.body;
    try {
        const user = await prisma.user.findUnique({ where: { cpf } });
        if (!user) {
            res.status(401).json({ error: 'Invalid credentials' });
            return;
        }
        if (!user.active) {
            res.status(401).json({ error: 'User is inactive' });
            return;
        }
        const passwordMatch = await bcrypt_1.default.compare(password, user.password);
        if (!passwordMatch) {
            res.status(401).json({ error: 'Invalid credentials' });
            return;
        }
        // Token expires in 30 days for offline persistence
        const token = jsonwebtoken_1.default.sign({ id: user.id, cpf: user.cpf, role: user.role, teamId: user.teamId, companyId: user.companyId }, process.env.JWT_SECRET, { expiresIn: '30d' });
        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                cpf: user.cpf,
                role: user.role,
                teamId: user.teamId,
                companyId: user.companyId,
            }
        });
    }
    catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Setup initial super admin (only works if no users exist)
router.post('/setup', async (req, res) => {
    try {
        const userCount = await prisma.user.count();
        if (userCount > 0) {
            res.status(403).json({ error: 'Setup already completed' });
            return;
        }
        const { name, email, password } = req.body;
        // Create master company
        const masterCompany = await prisma.company.create({
            data: {
                name: 'Select Photo Master',
                cnpj: '00000000000000',
                planLimit: 999999,
            }
        });
        const hashedPassword = await bcrypt_1.default.hash(password, 10);
        const superAdmin = await prisma.user.create({
            data: {
                name,
                email,
                password: hashedPassword,
                role: 'SUPER_ADMIN',
                companyId: masterCompany.id,
            }
        });
        res.status(201).json({ message: 'Setup successful', user: { email: superAdmin.email } });
    }
    catch (error) {
        console.error('Setup error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
