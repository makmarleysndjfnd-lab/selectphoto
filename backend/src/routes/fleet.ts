import express from 'express';
import { PrismaClient } from '@prisma/client';

import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { upload } from '../middleware/upload';

const router = express.Router();
const prisma = new PrismaClient();

// Get all cars with their current user and latest checklist
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
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
  } catch (error) {
    console.error('Error fetching fleet:', error);
    res.status(500).json({ error: 'Failed to fetch fleet' });
  }
});

// Create a new car
router.post('/', authenticateToken, upload.single('photo'), async (req: AuthRequest, res) => {
  try {
    const { plate, model, trackerLink, pendingMaintenance, warrantyParts, nextOilChangeKm, initialChecklist } = req.body;
    let photoUrl = null;
    if (req.file) {
      photoUrl = (req.file as any).location;
    }

    const newCar = await prisma.car.create({
      data: {
        plate,
        model,
        trackerLink,
        pendingMaintenance,
        warrantyParts,
        initialChecklist,
        photoUrl,
        nextOilChangeKm: nextOilChangeKm ? parseInt(nextOilChangeKm, 10) : 0,
        status: 'AVAILABLE',
        companyId: req.user?.companyId
      }
    });
    res.status(201).json(newCar);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create car' });
  }
});

// Update a car (Admin)
router.put('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    
    const existing = await prisma.car.findUnique({ where: { id: id as string } });
    if (!existing || existing.companyId !== req.user?.companyId) {
      return res.status(404).json({ error: 'Car not found' });
    }

    const updated = await prisma.car.update({
      where: { id: id as string },
      data
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update car' });
  }
});

// Delete a car (Admin)
router.delete('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.car.findUnique({ where: { id: id as string } });
    if (!existing || existing.companyId !== req.user?.companyId) {
      return res.status(404).json({ error: 'Car not found' });
    }
    await prisma.car.delete({ where: { id: id as string } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete car' });
  }
});

// Submit a checklist (Driver/Seller or Admin)
router.post('/checklist', authenticateToken, upload.fields([
  { name: 'frontPhoto', maxCount: 1 },
  { name: 'backPhoto', maxCount: 1 },
  { name: 'leftPhoto', maxCount: 1 },
  { name: 'rightPhoto', maxCount: 1 },
  { name: 'dashboardPhoto', maxCount: 1 },
  { name: 'enginePhoto', maxCount: 1 },
  { name: 'trunkPhoto', maxCount: 1 },
  { name: 'signature', maxCount: 1 }
]), async (req: AuthRequest, res) => {
  try {
    const { 
      carId, driverId, type, damageReport
    } = req.body;

    const mileage = parseInt(req.body.mileage || '0', 10);
    const fuelLevel = req.body.fuelLevel || 'EMPTY';
    const checklistType = type || 'CHECKOUT';

    const existing = await prisma.car.findUnique({ where: { id: carId } });
    if (!existing || existing.companyId !== req.user?.companyId) {
      return res.status(404).json({ error: 'Car not found' });
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const getPhotoUrl = (fieldName: string) => {
      if (files && files[fieldName] && files[fieldName].length > 0) {
        return (files[fieldName][0] as any).location;
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
        frontPhotoUrl: getPhotoUrl('frontPhoto'),
        backPhotoUrl: getPhotoUrl('backPhoto'),
        leftPhotoUrl: getPhotoUrl('leftPhoto'),
        rightPhotoUrl: getPhotoUrl('rightPhoto'),
        dashboardPhotoUrl: getPhotoUrl('dashboardPhoto'),
        enginePhotoUrl: getPhotoUrl('enginePhoto'),
        trunkPhotoUrl: getPhotoUrl('trunkPhoto'),
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
  } catch (error) {
    console.error('Error saving checklist:', error);
    res.status(500).json({ error: 'Failed to save checklist' });
  }
});

export default router;
