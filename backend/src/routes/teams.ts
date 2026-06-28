import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/authMiddleware';

const router = Router();
const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

// Get all teams
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const teams = await prisma.team.findMany({
      where: { companyId: req.user?.companyId }
    });
    res.json(teams);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
});

// Create team (Admin only)
router.post('/', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { name, prefix, type } = req.body;
  try {
    const newTeam = await prisma.team.create({
      data: { name, prefix, type: type || 'SALES', companyId: req.user?.companyId }
    });
    res.status(201).json(newTeam);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create team. Ensure prefix is unique.' });
  }
});

// Update team (Admin only)
router.put('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { name, prefix, active, type } = req.body;
  try {
    const existing = await prisma.team.findUnique({ where: { id: id as string } });
    if (!existing || existing.companyId !== req.user?.companyId) {
      return res.status(404).json({ error: 'Team not found' });
    }
    const updatedTeam = await prisma.team.update({
      where: { id: id as string },
      data: { name, prefix, active, type }
    });
    res.json(updatedTeam);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update team' });
  }
});

// Delete team (Admin only) - soft delete recommended or actual delete
router.delete('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const existing = await prisma.team.findUnique({ where: { id: id as string } });
    if (!existing || existing.companyId !== req.user?.companyId) {
      return res.status(404).json({ error: 'Team not found' });
    }
    await prisma.team.delete({
      where: { id: id as string }
    });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete team. Make sure no users or clients are linked to it.' });
  }
});

export default router;
