import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest, requireAdminOrSupervisor } from '../middleware/authMiddleware';
import { upload, safeUpload, getUploadedFileUrl } from '../middleware/upload';

const router = express.Router();
const prisma = new PrismaClient();

// Get all cars with their current user and latest checklist
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    const cars = await prisma.car.findMany({
      where: { companyId: userCompanyId },
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

// Create a new car (Admin or Supervisor only)
router.post('/', authenticateToken, requireAdminOrSupervisor, safeUpload(upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'frontPhoto', maxCount: 1 },
  { name: 'backPhoto', maxCount: 1 },
  { name: 'leftPhoto', maxCount: 1 },
  { name: 'rightPhoto', maxCount: 1 },
  { name: 'dashboardPhoto', maxCount: 1 },
  { name: 'enginePhoto', maxCount: 1 },
  { name: 'trunkPhoto', maxCount: 1 }
])), async (req: AuthRequest, res) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    const { plate, model, trackerLink, pendingMaintenance, warrantyParts, nextOilChangeKm, initialChecklist, currentKm } = req.body;
    
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const getPhoto = (field: string) => files?.[field]?.[0] ? getUploadedFileUrl(files[field][0]) : null;

    const photoUrl = getPhoto('photo');
    const frontPhotoUrl = getPhoto('frontPhoto');
    const backPhotoUrl = getPhoto('backPhoto');
    const leftPhotoUrl = getPhoto('leftPhoto');
    const rightPhotoUrl = getPhoto('rightPhoto');
    const dashboardPhotoUrl = getPhoto('dashboardPhoto');
    const enginePhotoUrl = getPhoto('enginePhoto');
    const trunkPhotoUrl = getPhoto('trunkPhoto');

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
        currentKm: (currentKm !== undefined && currentKm !== '') ? parseInt(currentKm.toString().replace(/\D/g, ''), 10) : 0,
        nextOilChangeKm: (nextOilChangeKm !== undefined && nextOilChangeKm !== '') ? parseInt(nextOilChangeKm.toString().replace(/\D/g, ''), 10) : 0,
        status: 'AVAILABLE',
        companyId: userCompanyId
      }
    });
    res.status(201).json(newCar);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create car' });
  }
});

// Update a car (Admin or Supervisor only)
router.put('/:id', authenticateToken, requireAdminOrSupervisor, safeUpload(upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'frontPhoto', maxCount: 1 },
  { name: 'backPhoto', maxCount: 1 },
  { name: 'leftPhoto', maxCount: 1 },
  { name: 'rightPhoto', maxCount: 1 },
  { name: 'dashboardPhoto', maxCount: 1 },
  { name: 'enginePhoto', maxCount: 1 },
  { name: 'trunkPhoto', maxCount: 1 }
])), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    const { plate, model, trackerLink, pendingMaintenance, warrantyParts, nextOilChangeKm, initialChecklist, currentKm } = req.body;
    
    const existing = await prisma.car.findUnique({ where: { id: id as string } });
    if (!existing || (existing.companyId !== userCompanyId && req.user?.role !== 'SUPER_ADMIN')) {
      return res.status(404).json({ error: 'Car not found' });
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const getPhoto = (field: string) => files?.[field]?.[0] ? getUploadedFileUrl(files[field][0]) : undefined;

    const data: any = {
      plate,
      model,
      trackerLink,
      pendingMaintenance,
      warrantyParts,
      initialChecklist,
      currentKm: (currentKm !== undefined && currentKm !== '') ? parseInt(currentKm.toString().replace(/\D/g, ''), 10) : existing.currentKm,
      nextOilChangeKm: (nextOilChangeKm !== undefined && nextOilChangeKm !== '') ? parseInt(nextOilChangeKm.toString().replace(/\D/g, ''), 10) : existing.nextOilChangeKm,
    };

    ['photo', 'frontPhoto', 'backPhoto', 'leftPhoto', 'rightPhoto', 'dashboardPhoto', 'enginePhoto', 'trunkPhoto'].forEach(f => {
      const url = getPhoto(f);
      if (url) data[`${f}Url`] = url;
    });

    const updated = await prisma.car.update({
      where: { id: id as string },
      data
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update car' });
  }
});

// Delete a car (Admin or Supervisor only)
router.delete('/:id', authenticateToken, requireAdminOrSupervisor, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    const existing = await prisma.car.findUnique({ where: { id: id as string } });
    if (!existing || (existing.companyId !== userCompanyId && req.user?.role !== 'SUPER_ADMIN')) {
      return res.status(404).json({ error: 'Car not found' });
    }
    await prisma.car.delete({ where: { id: id as string } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete car' });
  }
});

// Submit a checklist (Driver/Seller or Admin)
router.post('/checklist', authenticateToken, safeUpload(upload.fields([
  { name: 'frontPhoto', maxCount: 1 },
  { name: 'backPhoto', maxCount: 1 },
  { name: 'leftPhoto', maxCount: 1 },
  { name: 'rightPhoto', maxCount: 1 },
  { name: 'dashboardPhoto', maxCount: 1 },
  { name: 'enginePhoto', maxCount: 1 },
  { name: 'trunkPhoto', maxCount: 1 },
  { name: 'signature', maxCount: 1 }
])), async (req: AuthRequest, res) => {
  try {
    const userCompanyId = req.user?.companyId;
    if (!userCompanyId && req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    const { 
      carId, driverId, type, damageReport, reuseInitialPhotos
    } = req.body;

    const mileage = parseInt(req.body.mileage || '0', 10);
    const fuelLevel = req.body.fuelLevel || 'EMPTY';
    const checklistType = type || 'CHECKOUT';

    const existing = await prisma.car.findFirst({
      where: {
        id: carId,
        companyId: userCompanyId,
      }
    });
    if (!existing) {
      return res.status(404).json({ error: 'Car not found' });
    }

    if (driverId) {
      const driver = await prisma.user.findFirst({
        where: {
          id: driverId,
          companyId: userCompanyId,
        }
      });
      if (!driver) {
        return res.status(404).json({ error: 'Motorista não encontrado na sua empresa' });
      }
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const getPhotoUrl = (fieldName: string) => {
      if (files && files[fieldName] && files[fieldName].length > 0) {
        return getUploadedFileUrl(files[fieldName][0]);
      }
      return null;
    };

    // Create the checklist
    const checklist = await prisma.carChecklist.create({
      data: {
        type: checklistType,
        carId,
        driverId: driverId || req.user?.id,
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
        currentUserId: checklistType === 'CHECKOUT' ? (driverId || req.user?.id) : null,
        currentKm: mileage > 0 ? mileage : undefined
      }
    });

    res.status(201).json(checklist);
  } catch (error) {
    console.error('Error saving checklist:', error);
    res.status(500).json({ error: 'Failed to save checklist' });
  }
});

export default router;
