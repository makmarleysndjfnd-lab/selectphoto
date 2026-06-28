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
// Get all cars with their current user and latest checklist
router.get('/', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const cars = await prisma.car.findMany({
            where: { companyId: req.user?.companyId },
            include: {
                currentUser: {
                    select: { id: true, name: true, team: { select: { prefix: true } } }
                },
                checklists: {
                    orderBy: { date: 'desc' },
                    take: 1
                }
            }
        });
        res.json(cars);
    }
    catch (error) {
        console.error('Error fetching fleet:', error);
        res.status(500).json({ error: 'Failed to fetch fleet' });
    }
});
// Create a new car
router.post('/', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { plate, model, trackerLink, pendingMaintenance, warrantyParts, nextOilChangeKm } = req.body;
        const newCar = await prisma.car.create({
            data: {
                plate,
                model,
                trackerLink,
                pendingMaintenance,
                warrantyParts,
                nextOilChangeKm: nextOilChangeKm || 0,
                status: 'AVAILABLE',
                companyId: req.user?.companyId
            }
        });
        res.status(201).json(newCar);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to create car' });
    }
});
// Update a car (Admin)
router.put('/:id', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        const existing = await prisma.car.findUnique({ where: { id: id } });
        if (!existing || existing.companyId !== req.user?.companyId) {
            return res.status(404).json({ error: 'Car not found' });
        }
        const updated = await prisma.car.update({
            where: { id: id },
            data
        });
        res.json(updated);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update car' });
    }
});
// Submit a checklist (Driver/Seller)
router.post('/checklist', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { carId, driverId, mileage, fuelLevel, damageReport, frontPhotoUrl, backPhotoUrl, leftPhotoUrl, rightPhotoUrl, dashboardPhotoUrl } = req.body;
        const existing = await prisma.car.findUnique({ where: { id: carId } });
        if (!existing || existing.companyId !== req.user?.companyId) {
            return res.status(404).json({ error: 'Car not found' });
        }
        // Create the checklist
        const checklist = await prisma.carChecklist.create({
            data: {
                carId,
                driverId,
                mileage,
                fuelLevel,
                damageReport,
                frontPhotoUrl,
                backPhotoUrl,
                leftPhotoUrl,
                rightPhotoUrl,
                dashboardPhotoUrl
            }
        });
        // Update car status to IN_USE and update its current driver
        await prisma.car.update({
            where: { id: carId },
            data: {
                status: 'IN_USE',
                currentUserId: driverId
            }
        });
        res.status(201).json(checklist);
    }
    catch (error) {
        console.error('Error saving checklist:', error);
        res.status(500).json({ error: 'Failed to save checklist' });
    }
});
exports.default = router;
