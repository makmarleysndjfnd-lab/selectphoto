import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/authMiddleware';
import { upload } from '../middleware/upload';
import fs from 'fs';
import path from 'path';

const router = Router();
const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

// Get all users (Admin only)
router.get('/', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
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
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Create user (Admin only)
router.post('/', authenticateToken, requireAdmin, upload.fields([{ name: 'profilePhoto', maxCount: 1 }, { name: 'criminalRecord', maxCount: 1 }]), async (req: AuthRequest, res: Response) => {
  try {
    const { name, email, password, role, teamId, cpf, rg, phone, emergencyPhone, address, isTeamLeader, usesOwnCar, carId } = req.body;
    
    let profilePhotoUrl = null;
    let criminalRecordUrl = null;

    if (req.files) {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      if (files['profilePhoto'] && files['profilePhoto'].length > 0) {
        profilePhotoUrl = `/uploads/${files['profilePhoto'][0].filename}`;
      }
      if (files['criminalRecord'] && files['criminalRecord'].length > 0) {
        criminalRecordUrl = `/uploads/${files['criminalRecord'][0].filename}`;
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const newUser = await prisma.user.create({
      data: { 
        name, 
        email, 
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
    
    res.status(201).json({ id: newUser.id, email: newUser.email });
  } catch (error: any) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user. Email might be in use.' });
  }
});

// Update user (Admin only)
router.put('/:id', authenticateToken, requireAdmin, upload.fields([{ name: 'profilePhoto', maxCount: 1 }, { name: 'criminalRecord', maxCount: 1 }]), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, email, role, teamId, cpf, rg, phone, emergencyPhone, address, isTeamLeader, usesOwnCar, password, carId } = req.body;

    // Fetch existing to get old URLs
    const existingUser = await prisma.user.findUnique({ where: { id } });
    if (!existingUser || existingUser.companyId !== req.user?.companyId) {
      return res.status(404).json({ error: 'User not found' });
    }

    let profilePhotoUrl = existingUser.profilePhotoUrl;
    let criminalRecordUrl = existingUser.criminalRecordUrl;

    if (req.files) {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      if (files['profilePhoto'] && files['profilePhoto'].length > 0) {
        profilePhotoUrl = `/uploads/${files['profilePhoto'][0].filename}`;
      }
      if (files['criminalRecord'] && files['criminalRecord'].length > 0) {
        criminalRecordUrl = `/uploads/${files['criminalRecord'][0].filename}`;
      }
    }

    const updateData: any = {
      name,
      email,
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
      updateData.password = await bcrypt.hash(password, 10);
    }

    const updatedUser = await prisma.user.update({
      where: { id },
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
  } catch (error: any) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete user (Admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existingUser = await prisma.user.findUnique({ where: { id } });
    if (!existingUser || existingUser.companyId !== req.user?.companyId) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    await prisma.user.delete({ where: { id } });
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
