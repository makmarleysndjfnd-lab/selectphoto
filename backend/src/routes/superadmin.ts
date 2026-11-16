import { Router, Response } from 'express';
import { prisma } from '../services/prisma';
import { authenticateToken, requireSuperAdmin, AuthRequest } from '../middleware/authMiddleware';
import { claimSupportSessionToken } from '../services/supportCentralService';

const router = Router();


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
    const {
      name,
      tradeName,
      legalName,
      cnpj,
      planLimit,
      adminContactName,
      adminContactEmail,
      adminContactPhone,
      contractNotes,
    } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Nome da empresa é obrigatório.' });
      return;
    }
    const company = await prisma.company.create({
      data: {
        name: name.trim(),
        tradeName: typeof tradeName === 'string' && tradeName.trim() ? tradeName.trim() : null,
        legalName: typeof legalName === 'string' && legalName.trim() ? legalName.trim() : null,
        cnpj: typeof cnpj === 'string' && cnpj.trim() ? cnpj.replace(/\D/g, '') : null,
        adminContactName: typeof adminContactName === 'string' && adminContactName.trim() ? adminContactName.trim() : null,
        adminContactEmail: typeof adminContactEmail === 'string' && adminContactEmail.trim() ? adminContactEmail.trim().toLowerCase() : null,
        adminContactPhone: typeof adminContactPhone === 'string' && adminContactPhone.trim() ? adminContactPhone.trim() : null,
        contractNotes: typeof contractNotes === 'string' && contractNotes.trim() ? contractNotes.trim() : null,
        planLimit: planLimit || 500,
      },
    });
    res.status(201).json(company);
  } catch (error) {
    console.error('Error creating company:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update company branding/commercial details
router.put('/companies/:id', authenticateToken, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.company.findUnique({ where: { id: id as string } });
    if (!existing) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }

    const {
      name,
      tradeName,
      legalName,
      cnpj,
      planLimit,
      adminContactName,
      adminContactEmail,
      adminContactPhone,
      contractNotes,
      isActive,
    } = req.body;

    const cleanCnpj =
      cnpj !== undefined
        ? (typeof cnpj === 'string' && cnpj.trim() ? cnpj.replace(/\D/g, '') : null)
        : existing.cnpj;

    if (cleanCnpj && cleanCnpj !== existing.cnpj) {
      const conflict = await prisma.company.findUnique({ where: { cnpj: cleanCnpj } });
      if (conflict && conflict.id !== existing.id) {
        res.status(409).json({ error: 'CNPJ already registered for another company' });
        return;
      }
    }

    const updated = await prisma.company.update({
      where: { id: existing.id },
      data: {
        name: typeof name === 'string' && name.trim() ? name.trim() : existing.name,
        tradeName:
          tradeName !== undefined
            ? (typeof tradeName === 'string' && tradeName.trim() ? tradeName.trim() : null)
            : existing.tradeName,
        legalName:
          legalName !== undefined
            ? (typeof legalName === 'string' && legalName.trim() ? legalName.trim() : null)
            : existing.legalName,
        cnpj: cleanCnpj,
        adminContactName:
          adminContactName !== undefined
            ? (typeof adminContactName === 'string' && adminContactName.trim() ? adminContactName.trim() : null)
            : existing.adminContactName,
        adminContactEmail:
          adminContactEmail !== undefined
            ? (typeof adminContactEmail === 'string' && adminContactEmail.trim() ? adminContactEmail.trim().toLowerCase() : null)
            : existing.adminContactEmail,
        adminContactPhone:
          adminContactPhone !== undefined
            ? (typeof adminContactPhone === 'string' && adminContactPhone.trim() ? adminContactPhone.trim() : null)
            : existing.adminContactPhone,
        contractNotes:
          contractNotes !== undefined
            ? (typeof contractNotes === 'string' && contractNotes.trim() ? contractNotes.trim() : null)
            : existing.contractNotes,
        planLimit: typeof planLimit === 'number' && planLimit > 0 ? planLimit : existing.planLimit,
        ...(typeof isActive === 'boolean' ? { isActive } : {}),
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating company:', error);
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
