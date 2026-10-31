import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, requireSuperAdmin, AuthRequest } from '../middleware/authMiddleware';
import { claimSupportSessionToken } from '../services/supportCentralService';

const router = Router();
const prisma = new PrismaClient();

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

// Impersonate Company — Substituído por acesso de suporte formalmente autorizado pela empresa
// Impede contornar a aprovação da empresa com token amplo de 12h
router.post('/impersonate/:companyId', authenticateToken, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { companyId } = req.params;
    const company = await prisma.company.findUnique({ where: { id: companyId as string } });
    
    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }

    if (!company.isActive) {
      res.status(400).json({ error: 'Cannot access an inactive company' });
      return;
    }

    const actorId = req.user?.id;
    if (!actorId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // 1. Verifica se existe concessão de suporte ativa aprovada formalmente pela empresa dona dos dados
    const activeGrant = await prisma.supportAccessGrant.findFirst({
      where: {
        companyId: company.id,
        requestedByUserId: actorId,
        status: 'ACTIVE',
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { grantedAt: 'desc' },
    });

    if (!activeGrant) {
      res.status(403).json({
        error: 'SUPPORT_GRANT_REQUIRED',
        message: 'Acesso ao ambiente da empresa exige solicitação prévia e aprovação formal através da Central de Suporte. Concessão ativa não encontrada.',
      });
      return;
    }

    // 2. Emite sessão de suporte autorizada e restrita ao escopo aprovado
    const clientIp = (req.ip || req.socket.remoteAddress || 'unknown').substring(0, 45);
    const session = await claimSupportSessionToken({
      grantId: activeGrant.id,
      technicianUserId: actorId,
      ipAddress: clientIp,
    });

    res.json({
      message: 'Sessão de suporte autorizada iniciada com sucesso.',
      token: session.token,
      grant: session.grant,
      company,
    });
  } catch (error: any) {
    if (error.status === 403) {
      res.status(403).json({ error: error.message });
      return;
    }
    console.error('Error starting authorized support session:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
