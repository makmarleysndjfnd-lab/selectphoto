"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const bcrypt_1 = __importDefault(require("bcrypt"));
const authMiddleware_1 = require("../middleware/authMiddleware");
const upload_1 = require("../middleware/upload");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
// Get all users (Admin only)
router.get('/', authMiddleware_1.authenticateToken, authMiddleware_1.requireAdmin, async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            where: { companyId: req.user?.companyId },
            include: {
                team: true,
                currentCars: true, // Fetch assigned cars
            },
            orderBy: { createdAt: 'desc' }
        });
        // Remove passwords before sending to client
        const safeUsers = users.map(user => {
            const { password, ...safeUser } = user;
            return safeUser;
        });
        res.json(safeUsers);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});
// Create user (Admin only)
router.post('/', authMiddleware_1.authenticateToken, authMiddleware_1.requireAdmin, upload_1.upload.fields([{ name: 'profilePhoto', maxCount: 1 }, { name: 'criminalRecord', maxCount: 1 }]), async (req, res) => {
    try {
        const { name, password, role, teamId, cpf, rg, phone, emergencyPhone, address, isTeamLeader, usesOwnCar, carId } = req.body;
        if (!cpf)
            return res.status(400).json({ error: 'CPF is required' });
        let profilePhotoUrl = null;
        let criminalRecordUrl = null;
        if (req.files) {
            const files = req.files;
            if (files['profilePhoto'] && files['profilePhoto'].length > 0) {
                profilePhotoUrl = `/uploads/${files['profilePhoto'][0].filename}`;
            }
            if (files['criminalRecord'] && files['criminalRecord'].length > 0) {
                criminalRecordUrl = `/uploads/${files['criminalRecord'][0].filename}`;
            }
        }
        const hashedPassword = await bcrypt_1.default.hash(password, 10);
        const newUser = await prisma.user.create({
            data: {
                name,
                password: hashedPassword,
                role: role || 'OPERATOR',
                teamId: teamId || null,
                cpf: cpf || null,
                rg: rg || null,
                phone: phone || null,
                emergencyPhone: emergencyPhone || null,
                address: address || null,
                isTeamLeader: isTeamLeader === 'true',
                usesOwnCar: usesOwnCar === 'true',
                profilePhotoUrl,
                criminalRecordUrl,
                companyId: req.user?.companyId
            }
        });
        if (carId && carId !== 'null' && carId !== '') {
            await prisma.car.update({
                where: { id: carId },
                data: { currentUserId: newUser.id }
            });
        }
        res.status(201).json({ id: newUser.id, cpf: newUser.cpf });
    }
    catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ error: 'Failed to create user. CPF might be in use.' });
    }
});
// Update user (Admin only)
router.put('/:id', authMiddleware_1.authenticateToken, authMiddleware_1.requireAdmin, upload_1.upload.fields([{ name: 'profilePhoto', maxCount: 1 }, { name: 'criminalRecord', maxCount: 1 }]), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, role, teamId, cpf, rg, phone, emergencyPhone, address, isTeamLeader, usesOwnCar, password, carId } = req.body;
        // Fetch existing to get old URLs
        const existingUser = await prisma.user.findUnique({ where: { id: id } });
        if (!existingUser || existingUser.companyId !== req.user?.companyId) {
            return res.status(404).json({ error: 'User not found' });
        }
        let profilePhotoUrl = existingUser.profilePhotoUrl;
        let criminalRecordUrl = existingUser.criminalRecordUrl;
        if (req.files) {
            const files = req.files;
            if (files['profilePhoto'] && files['profilePhoto'].length > 0) {
                profilePhotoUrl = `/uploads/${files['profilePhoto'][0].filename}`;
            }
            if (files['criminalRecord'] && files['criminalRecord'].length > 0) {
                criminalRecordUrl = `/uploads/${files['criminalRecord'][0].filename}`;
            }
        }
        const updateData = {
            name,
            role,
            teamId: teamId || null,
            cpf: cpf || null,
            rg: rg || null,
            phone: phone || null,
            emergencyPhone: emergencyPhone || null,
            address: address || null,
            isTeamLeader: isTeamLeader === 'true',
            usesOwnCar: usesOwnCar === 'true',
            profilePhotoUrl,
            criminalRecordUrl
        };
        if (password && password.trim() !== '') {
            updateData.password = await bcrypt_1.default.hash(password, 10);
        }
        const updatedUser = await prisma.user.update({
            where: { id: id },
            data: updateData
        });
        if (carId !== undefined) {
            // Clear previous car assignments for this user
            await prisma.car.updateMany({
                where: { currentUserId: id },
                data: { currentUserId: null }
            });
            // Assign new car if valid
            if (carId && carId !== 'null' && carId !== '') {
                await prisma.car.update({
                    where: { id: carId },
                    data: { currentUserId: id }
                });
            }
        }
        res.json({ id: updatedUser.id, email: updatedUser.email });
    }
    catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ error: 'Failed to update user' });
    }
});
// Delete user (Admin only)
router.delete('/:id', authMiddleware_1.authenticateToken, authMiddleware_1.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const existingUser = await prisma.user.findUnique({ where: { id: id } });
        if (!existingUser || existingUser.companyId !== req.user?.companyId) {
            return res.status(404).json({ error: 'User not found' });
        }
        await prisma.user.delete({ where: { id: id } });
        res.json({ message: 'User deleted successfully' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to delete user' });
    }
});
exports.default = router;
