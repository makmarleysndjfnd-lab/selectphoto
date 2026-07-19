"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const authMiddleware_1 = require("../middleware/authMiddleware");
const upload_1 = require("../middleware/upload");
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
router.post('/', authMiddleware_1.authenticateToken, upload_1.upload.fields([
    { name: 'photo', maxCount: 1 },
    { name: 'frontPhoto', maxCount: 1 },
    { name: 'backPhoto', maxCount: 1 },
    { name: 'leftPhoto', maxCount: 1 },
    { name: 'rightPhoto', maxCount: 1 },
    { name: 'dashboardPhoto', maxCount: 1 },
    { name: 'enginePhoto', maxCount: 1 },
    { name: 'trunkPhoto', maxCount: 1 }
]), async (req, res) => {
    try {
        const { plate, model, trackerLink, pendingMaintenance, warrantyParts, nextOilChangeKm, initialChecklist } = req.body;
        const files = req.files;
        const getPhotoUrl = (field) => files?.[field]?.[0] ? files[field][0].location : null;
        const photoUrl = getPhotoUrl('photo');
        const frontPhotoUrl = getPhotoUrl('frontPhoto');
        const backPhotoUrl = getPhotoUrl('backPhoto');
        const leftPhotoUrl = getPhotoUrl('leftPhoto');
        const rightPhotoUrl = getPhotoUrl('rightPhoto');
        const dashboardPhotoUrl = getPhotoUrl('dashboardPhoto');
        const enginePhotoUrl = getPhotoUrl('enginePhoto');
        const trunkPhotoUrl = getPhotoUrl('trunkPhoto');
        const newCar = await prisma.car.create({
            data: {
                plate,
                model,
                trackerLink,
                pendingMaintenance,
                warrantyParts,
                initialChecklist,
                photoUrl,
                frontPhotoUrl,
                backPhotoUrl,
                leftPhotoUrl,
                rightPhotoUrl,
                dashboardPhotoUrl,
                enginePhotoUrl,
                trunkPhotoUrl,
                nextOilChangeKm: nextOilChangeKm ? parseInt(nextOilChangeKm, 10) : 0,
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
router.put('/:id', authMiddleware_1.authenticateToken, upload_1.upload.fields([
    { name: 'photo', maxCount: 1 },
    { name: 'frontPhoto', maxCount: 1 },
    { name: 'backPhoto', maxCount: 1 },
    { name: 'leftPhoto', maxCount: 1 },
    { name: 'rightPhoto', maxCount: 1 },
    { name: 'dashboardPhoto', maxCount: 1 },
    { name: 'enginePhoto', maxCount: 1 },
    { name: 'trunkPhoto', maxCount: 1 }
]), async (req, res) => {
    try {
        const { id } = req.params;
        const { plate, model, trackerLink, pendingMaintenance, warrantyParts, nextOilChangeKm, initialChecklist } = req.body;
        const existing = await prisma.car.findUnique({ where: { id: id } });
        if (!existing || existing.companyId !== req.user?.companyId) {
            return res.status(404).json({ error: 'Car not found' });
        }
        const files = req.files;
        const getPhotoUrl = (field) => files?.[field]?.[0] ? files[field][0].location : undefined;
        const data = {
            plate,
            model,
            trackerLink,
            pendingMaintenance,
            warrantyParts,
            initialChecklist,
            nextOilChangeKm: nextOilChangeKm ? parseInt(nextOilChangeKm, 10) : undefined,
        };
        ['photo', 'frontPhoto', 'backPhoto', 'leftPhoto', 'rightPhoto', 'dashboardPhoto', 'enginePhoto', 'trunkPhoto'].forEach(f => {
            const url = getPhotoUrl(f);
            if (url)
                data[`${f}Url`] = url;
        });
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
// Delete a car (Admin)
router.delete('/:id', authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await prisma.car.findUnique({ where: { id: id } });
        if (!existing || existing.companyId !== req.user?.companyId) {
            return res.status(404).json({ error: 'Car not found' });
        }
        await prisma.car.delete({ where: { id: id } });
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to delete car' });
    }
});
// Submit a checklist (Driver/Seller or Admin)
router.post('/checklist', authMiddleware_1.authenticateToken, upload_1.upload.fields([
    { name: 'frontPhoto', maxCount: 1 },
    { name: 'backPhoto', maxCount: 1 },
    { name: 'leftPhoto', maxCount: 1 },
    { name: 'rightPhoto', maxCount: 1 },
    { name: 'dashboardPhoto', maxCount: 1 },
    { name: 'enginePhoto', maxCount: 1 },
    { name: 'trunkPhoto', maxCount: 1 },
    { name: 'signature', maxCount: 1 }
]), async (req, res) => {
    try {
        const { carId, driverId, type, damageReport, reuseInitialPhotos } = req.body;
        const mileage = parseInt(req.body.mileage || '0', 10);
        const fuelLevel = req.body.fuelLevel || 'EMPTY';
        const checklistType = type || 'CHECKOUT';
        const existing = await prisma.car.findUnique({ where: { id: carId } });
        if (!existing || existing.companyId !== req.user?.companyId) {
            return res.status(404).json({ error: 'Car not found' });
        }
        const files = req.files;
        const getPhotoUrl = (fieldName) => {
            if (files && files[fieldName] && files[fieldName].length > 0) {
                return files[fieldName][0].location;
            }
            return null;
        };
        // Create the checklist
        const checklist = await prisma.carChecklist.create({
            data: {
                type: checklistType,
                carId,
                driverId,
                mileage,
                fuelLevel,
                damageReport,
                frontPhotoUrl: (reuseInitialPhotos === 'true' || reuseInitialPhotos === true) ? existing.frontPhotoUrl : getPhotoUrl('frontPhoto'),
                backPhotoUrl: (reuseInitialPhotos === 'true' || reuseInitialPhotos === true) ? existing.backPhotoUrl : getPhotoUrl('backPhoto'),
                leftPhotoUrl: (reuseInitialPhotos === 'true' || reuseInitialPhotos === true) ? existing.leftPhotoUrl : getPhotoUrl('leftPhoto'),
                rightPhotoUrl: (reuseInitialPhotos === 'true' || reuseInitialPhotos === true) ? existing.rightPhotoUrl : getPhotoUrl('rightPhoto'),
                dashboardPhotoUrl: (reuseInitialPhotos === 'true' || reuseInitialPhotos === true) ? existing.dashboardPhotoUrl : getPhotoUrl('dashboardPhoto'),
                enginePhotoUrl: (reuseInitialPhotos === 'true' || reuseInitialPhotos === true) ? existing.enginePhotoUrl : getPhotoUrl('enginePhoto'),
                trunkPhotoUrl: (reuseInitialPhotos === 'true' || reuseInitialPhotos === true) ? existing.trunkPhotoUrl : getPhotoUrl('trunkPhoto'),
                signatureUrl: getPhotoUrl('signature'),
            }
        });
        // Update car status based on type
        await prisma.car.update({
            where: { id: carId },
            data: {
                status: checklistType === 'CHECKOUT' ? 'IN_USE' : 'AVAILABLE',
                currentUserId: checklistType === 'CHECKOUT' ? driverId : null
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
