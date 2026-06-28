import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, requireSuperAdmin, AuthRequest } from '../middleware/authMiddleware';
import jwt from 'jsonwebtoken';

const router = Router();
const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

// Get all companies
router.get('/companies', authenticateToken, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const companies = await prisma.company.findMany({
      include: {
        _count: {
          select: { users: true, clients: true }
        }
      }
    });
    res.json(companies);
  } catch (error) {
    console.error('Error fetching companies:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new company
router.post('/companies', authenticateToken, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, cnpj, planLimit } = req.body;
    const company = await prisma.company.create({
      data: { name, cnpj, planLimit: planLimit || 500 }
    });
    res.status(201).json(company);
  } catch (error) {
    console.error('Error creating company:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Toggle company status
router.put('/companies/:id/toggle', authenticateToken, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const company = await prisma.company.findUnique({ where: { id: id as string } });
    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }
    const updated = await prisma.company.update({
      where: { id: id as string },
      data: { isActive: !company.isActive }
    });
    res.json(updated);
  } catch (error) {
    console.error('Error toggling company:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Impersonate Company (Generate token for a specific company as Super Admin)
router.post('/impersonate/:companyId', authenticateToken, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { companyId } = req.params;
    const company = await prisma.company.findUnique({ where: { id: companyId as string } });
    
    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }

    // Generate a temporary token acting as COMPANY_ADMIN for that company
    const token = jwt.sign(
      { 
        id: req.user.id, 
        email: req.user.email, 
        role: 'COMPANY_ADMIN', // Downgraded to standard company admin view
        companyId: company.id 
      },
      process.env.JWT_SECRET as string,
      { expiresIn: '12h' }
    );

    res.json({ token, company });
  } catch (error) {
    console.error('Error impersonating company:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
