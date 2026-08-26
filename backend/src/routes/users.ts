import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { authenticateToken, requireAdmin, AuthRequest, VALID_ROLES, ROLE_RANK } from '../middleware/authMiddleware';
import { upload, safeUpload, getUploadedFileUrl } from '../middleware/upload';

const router = Router();
const prisma = new PrismaClient();

// ── ROTAS ESTÁTICAS E DE PERFIL (DEVEM FICAR ANTES DE /:id) ───────────────────

// Update own profile name
router.put('/profile', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { name } = req.body;
    if (!userId || !name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { name: name.trim() },
      select: { id: true, name: true, email: true, role: true }
    });
    res.json(updatedUser);
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

const PIX_MANAGER_ROLES = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'ADMIN', 'SUPERVISOR', 'SELLER_MANAGER'];

router.get('/me/pix-key', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
    if (!PIX_MANAGER_ROLES.includes(req.user.role || '')) {
      return res.status(403).json({ error: 'Sem permissão para gerenciar a chave PIX de repasse' });
    }
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { pixKey: true },
    });
    return res.json({ pixKey: user?.pixKey || '' });
  } catch (_) {
    return res.status(500).json({ error: 'Falha ao carregar chave PIX' });
  }
});

router.put('/me/pix-key', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
    if (!PIX_MANAGER_ROLES.includes(req.user.role || '')) {
      return res.status(403).json({ error: 'Sem permissão para gerenciar a chave PIX de repasse' });
    }
    const pixKey = typeof req.body?.pixKey === 'string' ? req.body.pixKey.trim() : '';
    if (pixKey.length > 140) {
      return res.status(400).json({ error: 'Chave PIX excede o tamanho permitido' });
    }
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { pixKey: pixKey || null },
      select: { pixKey: true },
    });
    return res.json({ pixKey: user.pixKey || '' });
  } catch (_) {
    return res.status(500).json({ error: 'Falha ao salvar chave PIX' });
  }
});

// Get all users in the same company (accessible by any logged in user)
router.get('/company', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.companyId && req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

    const users = await prisma.user.findMany({
      where: { companyId: req.user?.companyId },
      select: {
        id: true,
        name: true,
        role: true,
        email: true,
        active: true
      },
      orderBy: { name: 'asc' }
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch company users' });
  }
});

// Update FCM Token
router.put('/me/fcm-token', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token is required' });

    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: { fcmToken: token }
    });

    res.json({ message: 'FCM Token updated' });
  } catch (error) {
    console.error('Error updating fcm token:', error);
    res.status(500).json({ error: 'Failed to update fcm token' });
  }
});

// ── ROTAS ADMINISTRATIVAS DE GESTÃO DE USUÁRIOS ──────────────────────────────

// Get all users (Admin only)
router.get('/', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.companyId && req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Empresa não identificada' });
    }

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
router.post('/', authenticateToken, requireAdmin, safeUpload(upload.fields([{ name: 'profilePhoto', maxCount: 1 }, { name: 'criminalRecord', maxCount: 1 }])), async (req: AuthRequest, res: Response) => {
  try {
    const { name, password, role, teamId, cpf, rg, phone, emergencyPhone, address, usesOwnCar, carId, photographerCode: providedPhotographerCode, salesType } = req.body;
    
    if (!cpf) return res.status(400).json({ error: 'CPF is required' });
    if (!password) return res.status(400).json({ error: 'Password is required' });
    
    const callerRole = req.user?.role || '';
    const callerRank = ROLE_RANK[callerRole] || 0;

    // Validação de Role e Bloqueio de Elevação de Privilégio
    const targetRole = role || 'OPERATOR';
    if (!VALID_ROLES.includes(targetRole)) {
      return res.status(400).json({ error: `Invalid role. Allowed: ${VALID_ROLES.join(', ')}` });
    }

    const targetRank = ROLE_RANK[targetRole] || 0;

    if (callerRole === 'COMPANY_ADMIN' && targetRole === 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Forbidden: COMPANY_ADMIN cannot create SUPER_ADMIN' });
    }

    if (callerRole === 'ADMIN' && targetRank >= ROLE_RANK.ADMIN) {
      return res.status(403).json({ error: 'Forbidden: ADMIN cannot create ADMIN, COMPANY_ADMIN or SUPER_ADMIN' });
    }

    // Validação de teamId pertencente à mesma empresa
    if (teamId && teamId !== 'null' && teamId !== '') {
      const team = await prisma.team.findFirst({
        where: { id: teamId, companyId: req.user?.companyId }
      });
      if (!team) {
        return res.status(400).json({ error: 'Time não pertence à sua empresa' });
      }
    }

    // Validação de carId pertencente à mesma empresa
    if (carId && carId !== 'null' && carId !== '') {
      const car = await prisma.car.findFirst({
        where: { id: carId, companyId: req.user?.companyId }
      });
      if (!car) {
        return res.status(400).json({ error: 'Veículo não pertence à sua empresa' });
      }
    }
    
    let profilePhotoUrl = null;
    let criminalRecordUrl = null;

    if (req.files) {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      if (files['profilePhoto'] && files['profilePhoto'].length > 0) {
        profilePhotoUrl = getUploadedFileUrl(files['profilePhoto'][0]);
      }
      if (files['criminalRecord'] && files['criminalRecord'].length > 0) {
        criminalRecordUrl = getUploadedFileUrl(files['criminalRecord'][0]);
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    let photographerCode = null;
    if (targetRole === 'PHOTOGRAPHER') {
      if (providedPhotographerCode && providedPhotographerCode.trim() !== '') {
        photographerCode = providedPhotographerCode.trim();
      } else {
        const lastPhotographer = await prisma.user.findFirst({
          where: { role: 'PHOTOGRAPHER', photographerCode: { not: null }, companyId: req.user?.companyId },
          orderBy: { photographerCode: 'desc' }
        });
        if (lastPhotographer && lastPhotographer.photographerCode) {
          const lastCodeInt = parseInt(lastPhotographer.photographerCode, 10);
          photographerCode = (!isNaN(lastCodeInt)) ? (lastCodeInt + 1).toString().padStart(4, '0') : '0001';
        } else {
          photographerCode = '0001';
        }
      }
    }
    
    const newUser = await prisma.user.create({
      data: { 
        name, 
        password: hashedPassword, 
        role: targetRole, 
        teamId: teamId || null,
        cpf: cpf || null,
        rg: rg || null,
        phone: phone || null,
        emergencyPhone: emergencyPhone || null,
        address: address || null,
        usesOwnCar: usesOwnCar === 'true' || usesOwnCar === true,
        salesType: salesType ? salesType.trim() : null,
        profilePhotoUrl,
        criminalRecordUrl,
        photographerCode,
        companyId: req.user?.companyId
      }
    });

    if (carId && carId !== 'null' && carId !== '') {
      await prisma.car.update({
        where: { id: carId },
        data: { currentUserId: newUser.id, status: 'IN_USE' }
      });
    }
    
    res.status(201).json({ id: newUser.id, cpf: newUser.cpf });
  } catch (error: any) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user. CPF might be in use.' });
  }
});

// Update user (Admin only)
router.put('/:id', authenticateToken, requireAdmin, safeUpload(upload.fields([{ name: 'profilePhoto', maxCount: 1 }, { name: 'criminalRecord', maxCount: 1 }])), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, role, teamId, cpf, rg, phone, emergencyPhone, address, usesOwnCar, password, carId, photographerCode, salesType } = req.body;

    const callerRole = req.user?.role || '';
    const callerRank = ROLE_RANK[callerRole] || 0;

    // Fetch existing user to verify permissions
    const existingUser = await prisma.user.findUnique({ where: { id: id as string } });
    if (!existingUser || (existingUser.companyId !== req.user?.companyId && req.user?.role !== 'SUPER_ADMIN')) {
      return res.status(404).json({ error: 'User not found' });
    }

    const existingRank = ROLE_RANK[existingUser.role] || 0;

    // ADMIN não pode alterar usuário com papel igual ou superior
    if (callerRole === 'ADMIN' && existingRank >= ROLE_RANK.ADMIN && req.user?.id !== id) {
      return res.status(403).json({ error: 'Forbidden: ADMIN cannot modify users with role ADMIN or above' });
    }

    // COMPANY_ADMIN não pode alterar SUPER_ADMIN
    if (callerRole === 'COMPANY_ADMIN' && existingUser.role === 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Forbidden: COMPANY_ADMIN cannot modify SUPER_ADMIN' });
    }

    // Bloqueio de auto-alteração de papel para ganho de privilégio
    if (role && role !== existingUser.role) {
      if (!VALID_ROLES.includes(role)) {
        return res.status(400).json({ error: `Invalid role. Allowed: ${VALID_ROLES.join(', ')}` });
      }
      if (req.user?.id === id && req.user.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Forbidden: Cannot change your own role' });
      }
      if (role === 'SUPER_ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Forbidden: Only SUPER_ADMIN can promote to SUPER_ADMIN' });
      }
      const newRank = ROLE_RANK[role] || 0;
      if (callerRole === 'ADMIN' && newRank >= ROLE_RANK.ADMIN) {
        return res.status(403).json({ error: 'Forbidden: ADMIN cannot promote to ADMIN or above' });
      }
      if (callerRole === 'COMPANY_ADMIN' && role === 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Forbidden: COMPANY_ADMIN cannot promote to SUPER_ADMIN' });
      }
    }

    // Validação de teamId
    if (teamId && teamId !== 'null' && teamId !== '') {
      const team = await prisma.team.findFirst({
        where: { id: teamId, companyId: req.user?.companyId }
      });
      if (!team) {
        return res.status(400).json({ error: 'Time não pertence à sua empresa' });
      }
    }

    // Validação de carId
    if (carId && carId !== 'null' && carId !== '') {
      const car = await prisma.car.findFirst({
        where: { id: carId, companyId: req.user?.companyId }
      });
      if (!car) {
        return res.status(400).json({ error: 'Veículo não pertence à sua empresa' });
      }
    }

    let profilePhotoUrl = existingUser.profilePhotoUrl;
    let criminalRecordUrl = existingUser.criminalRecordUrl;

    if (req.files) {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      if (files['profilePhoto'] && files['profilePhoto'].length > 0) {
        profilePhotoUrl = getUploadedFileUrl(files['profilePhoto'][0]);
      }
      if (files['criminalRecord'] && files['criminalRecord'].length > 0) {
        criminalRecordUrl = getUploadedFileUrl(files['criminalRecord'][0]);
      }
    }

    const updateData: any = {
      name,
      teamId: teamId || null,
      cpf: cpf || null,
      rg: rg || null,
      phone: phone || null,
      emergencyPhone: emergencyPhone || null,
      address: address || null,
      usesOwnCar: usesOwnCar === 'true' || usesOwnCar === true,
      salesType: salesType !== undefined ? (salesType && salesType.trim() !== '' ? salesType.trim() : null) : existingUser.salesType,
      profilePhotoUrl,
      criminalRecordUrl
    };

    if (role) {
      updateData.role = role;
    }
    
    if (role === 'PHOTOGRAPHER' && photographerCode !== undefined) {
      updateData.photographerCode = photographerCode && photographerCode.trim() !== '' ? photographerCode.trim() : null;
    }

    if (password && password.trim() !== '') {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const updatedUser = await prisma.user.update({
      where: { id: id as string },
      data: updateData
    });

    if (carId !== undefined) {
      // Clear previous car assignments for this user
      await prisma.car.updateMany({
        where: { currentUserId: id as string },
        data: { currentUserId: null, status: 'AVAILABLE' }
      });
      // Assign new car if valid
      if (carId && carId !== 'null' && carId !== '') {
        await prisma.car.update({
          where: { id: carId },
          data: { currentUserId: id as string, status: 'IN_USE' }
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
    
    if (req.user?.id === id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const callerRole = req.user?.role || '';
    const existingUser = await prisma.user.findUnique({ where: { id: id as string } });
    if (!existingUser || (existingUser.companyId !== req.user?.companyId && req.user?.role !== 'SUPER_ADMIN')) {
      return res.status(404).json({ error: 'User not found' });
    }

    const existingRank = ROLE_RANK[existingUser.role] || 0;
    if (callerRole === 'ADMIN' && existingRank >= ROLE_RANK.ADMIN) {
      return res.status(403).json({ error: 'Forbidden: ADMIN cannot delete users with role ADMIN or above' });
    }

    if (callerRole === 'COMPANY_ADMIN' && existingUser.role === 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Forbidden: COMPANY_ADMIN cannot delete SUPER_ADMIN' });
    }
    
    await prisma.user.delete({ where: { id: id as string } });
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
