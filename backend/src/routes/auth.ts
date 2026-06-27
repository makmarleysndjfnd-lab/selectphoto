import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const router = Router();
const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (!user.active) {
      res.status(401).json({ error: 'User is inactive' });
      return;
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Token expires in 30 days for offline persistence
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, teamId: user.teamId, companyId: user.companyId },
      process.env.JWT_SECRET as string,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        teamId: user.teamId,
        companyId: user.companyId,
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Setup initial super admin (only works if no users exist)
router.post('/setup', async (req: Request, res: Response) => {
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

    const hashedPassword = await bcrypt.hash(password, 10);
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
  } catch (error) {
    console.error('Setup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
