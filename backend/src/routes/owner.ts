import { Router, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import {
  authenticateToken,
  requireCapability,
  requireStepUpAuth,
  AuthRequest,
} from '../middleware/authMiddleware';
import { recordOperationalAuditEvent } from '../services/operationalAuditService';

const router = Router();
let _prisma: PrismaClient | null = null;
function getPrisma(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient();
  }
  return _prisma;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function logContractAudit(data: {
  companyId?: string | null;
  action: string;
  authorUserId: string;
  authorName: string;
  details: Record<string, any>;
  reason?: string | null;
  req: AuthRequest;
}) {
  try {
    const prisma = getPrisma();
    await prisma.contractAuditEvent.create({
      data: {
        companyId: data.companyId || null,
        action: data.action,
        authorUserId: data.authorUserId,
        authorName: data.authorName,
        details: JSON.stringify(data.details),
        reason: data.reason || null,
        ipAddress: (data.req.ip || data.req.socket.remoteAddress || 'unknown').substring(0, 45),
        userAgent: (data.req.headers['user-agent'] || 'unknown').substring(0, 255),
      },
    });
    await recordOperationalAuditEvent(
      {
        companyId: data.companyId || null,
        category: 'CONTRACT',
        action: data.action,
        entityType: 'COMPANY_CONTRACT',
        entityReference: data.companyId ? `CMP-${data.companyId.slice(0, 8)}` : 'PLATFORM',
        entityId: data.companyId || null,
        previousValues: data.details?.previous ? (data.details.previous as Record<string, unknown>) : null,
        newValues: data.details,
        reason: data.reason || null,
        authorUserId: data.authorUserId,
        authorName: data.authorName,
        authorRole: data.req.user?.role || 'OWNER',
        ipAddress: (data.req.ip || data.req.socket?.remoteAddress || null) as string | null,
      },
      prisma
    );
  } catch (err) {
    console.error('Falha ao registrar log de auditoria contratual:', err);
  }
}

// ── 1. Step-Up Authentication ────────────────────────────────────────────────

router.post('/auth/step-up', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Acesso restrito à Central do Proprietário.' });
    }

    const { password, reason } = req.body;
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Senha é obrigatória para autenticação reforçada.' });
    }

    const prisma = getPrisma();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, password: true },
    });

    if (!user || !user.password) {
      return res.status(401).json({ error: 'Usuário não encontrado ou sem senha cadastrada.' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(403).json({ error: 'Senha incorreta. Reautenticação reforçada negada.' });
    }

    // Gerar token de step-up temporário (10 minutos)
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.stepUpSession.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    });

    await logContractAudit({
      action: 'STEP_UP_AUTHENTICATED',
      authorUserId: user.id,
      authorName: user.name,
      details: { expiresAt: expiresAt.toISOString(), reason: reason || 'Acesso a ação sensível' },
      reason: reason || 'Sessão reforçada iniciada',
      req,
    });

    res.json({
      success: true,
      stepUpToken: rawToken,
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds: 600,
      message: 'Reautenticação reforçada confirmada com validade de 10 minutos.',
    });
  } catch (error) {
    console.error('Erro no step-up auth:', error);
    res.status(500).json({ error: 'Erro interno ao processar reautenticação reforçada.' });
  }
});

router.post('/auth/step-up/revoke', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const token = req.headers['x-step-up-token'] as string | undefined;

    if (userId && token) {
      const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
      const prisma = getPrisma();
      await prisma.stepUpSession.updateMany({
        where: { userId, tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    res.json({ success: true, message: 'Sessão reforçada revogada com sucesso.' });
  } catch (error) {
    console.error('Erro ao revogar step-up:', error);
    res.status(500).json({ error: 'Erro ao revogar sessão.' });
  }
});

// ── 2. Perfil e Capacidades do Proprietário ──────────────────────────────────

router.get('/profile', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId || req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Acesso restrito à Central do Proprietário.' });
    }

    const prisma = getPrisma();
    const capabilities = await prisma.ownerCapability.findMany({
      where: { userId },
      select: { capability: true, createdAt: true },
    });

    res.json({
      user: {
        id: req.user.id,
        name: req.user.name,
        role: req.user.role,
      },
      capabilities: capabilities.map((c) => c.capability),
      hasFinanceCapability: capabilities.some((c) => c.capability === 'PLATFORM_FINANCE'),
      hasContractCapability: capabilities.some((c) => c.capability === 'CONTRACT_MANAGEMENT'),
      hasIntegrationCapability: capabilities.some((c) => c.capability === 'INTEGRATION_CONFIG'),
      hasSupportCapability: capabilities.some((c) => c.capability === 'TECHNICAL_SUPPORT'),
    });
  } catch (error) {
    console.error('Erro ao carregar perfil do proprietário:', error);
    res.status(500).json({ error: 'Erro interno ao carregar perfil.' });
  }
});

// ── 3. Empresas e Gestão Contratual ──────────────────────────────────────────

// Listar empresas com metadados contratuais e taxas vigentes
router.get(
  '/companies',
  authenticateToken,
  requireCapability(['CONTRACT_MANAGEMENT', 'PLATFORM_FINANCE']),
  async (req: AuthRequest, res: Response) => {
    try {
      const prisma = getPrisma();
      const statusFilter = req.query.status as string | undefined;
      const search = req.query.search as string | undefined;

      const where: Prisma.CompanyWhereInput = {};
      if (statusFilter && statusFilter !== 'ALL') {
        where.status = statusFilter;
      }
      if (search && search.trim().length > 0) {
        where.OR = [
          { name: { contains: search.trim(), mode: 'insensitive' } },
          { legalName: { contains: search.trim(), mode: 'insensitive' } },
          { cnpj: { contains: search.trim() } },
          { adminContactName: { contains: search.trim(), mode: 'insensitive' } },
        ];
      }

      const companies = await prisma.company.findMany({
        where,
        include: {
          _count: {
            select: { users: true },
          },
          platformRates: {
            orderBy: { version: 'desc' },
            take: 1, // Taxa mais recente
          },
        },
        orderBy: { name: 'asc' },
      });

      const now = new Date();

      const result = companies.map((c) => {
        const latestRate = c.platformRates[0] || null;
        const isCurrentlyEffective =
          latestRate &&
          new Date(latestRate.effectiveFrom) <= now &&
          (latestRate.effectiveTo === null || new Date(latestRate.effectiveTo) > now);

        return {
          id: c.id,
          name: c.name,
          cnpj: c.cnpj,
          legalName: c.legalName,
          tradeName: c.tradeName,
          status: c.status,
          isActive: c.isActive,
          adminContactName: c.adminContactName,
          adminContactEmail: c.adminContactEmail,
          adminContactPhone: c.adminContactPhone,
          contractNotes: c.contractNotes,
          suspensionReason: c.suspensionReason,
          suspendedAt: c.suspendedAt,
          userCount: c._count.users,
          isRateConfigured: latestRate !== null,
          currentRate: latestRate
            ? {
                id: latestRate.id,
                version: latestRate.version,
                ratePercentage: Number(latestRate.ratePercentage),
                effectiveFrom: latestRate.effectiveFrom,
                effectiveTo: latestRate.effectiveTo,
                reason: latestRate.reason,
                createdByName: latestRate.createdByName,
                isCurrentlyEffective,
              }
            : null,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        };
      });

      res.json(result);
    } catch (error) {
      console.error('Erro ao listar empresas na Central do Proprietário:', error);
      res.status(500).json({ error: 'Erro interno ao listar empresas.' });
    }
  }
);

// Detalhes completos da empresa (com histórico de taxas e auditoria)
router.get(
  '/companies/:id',
  authenticateToken,
  requireCapability(['CONTRACT_MANAGEMENT', 'PLATFORM_FINANCE']),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const prisma = getPrisma();

      const company = await prisma.company.findUnique({
        where: { id: id as string },
        include: {
          platformRates: {
            orderBy: { version: 'desc' },
          },
          contractAuditEvents: {
            orderBy: { createdAt: 'desc' },
            take: 20,
          },
          _count: {
            select: { users: true, sales: true },
          },
        },
      });

      if (!company) {
        return res.status(404).json({ error: 'Empresa não encontrada.' });
      }

      // Contagem de usuários por função (agregado seguro sem vazar PII)
      const userRolesCount = await prisma.user.groupBy({
        by: ['role'],
        where: { companyId: id as string, active: true },
        _count: { id: true },
      });

      const rolesSummary: Record<string, number> = {};
      userRolesCount.forEach((r) => {
        rolesSummary[r.role] = r._count.id;
      });

      const now = new Date();
      const currentRate =
        company.platformRates.find(
          (r) =>
            new Date(r.effectiveFrom) <= now &&
            (r.effectiveTo === null || new Date(r.effectiveTo) > now)
        ) || company.platformRates[0] || null;

      res.json({
        id: company.id,
        name: company.name,
        cnpj: company.cnpj,
        legalName: company.legalName,
        tradeName: company.tradeName,
        status: company.status,
        isActive: company.isActive,
        adminContactName: company.adminContactName,
        adminContactEmail: company.adminContactEmail,
        adminContactPhone: company.adminContactPhone,
        contractNotes: company.contractNotes,
        suspensionReason: company.suspensionReason,
        suspendedAt: company.suspendedAt,
        userCount: company._count.users,
        salesCount: company._count.sales,
        usersByRole: rolesSummary,
        isRateConfigured: company.platformRates.length > 0,
        currentRate: currentRate
          ? {
              id: currentRate.id,
              version: currentRate.version,
              ratePercentage: Number(currentRate.ratePercentage),
              effectiveFrom: currentRate.effectiveFrom,
              effectiveTo: currentRate.effectiveTo,
              reason: currentRate.reason,
              createdByName: currentRate.createdByName,
            }
          : null,
        rateHistory: company.platformRates.map((r) => ({
          id: r.id,
          version: r.version,
          ratePercentage: Number(r.ratePercentage),
          effectiveFrom: r.effectiveFrom,
          effectiveTo: r.effectiveTo,
          reason: r.reason,
          createdByName: r.createdByName,
          createdAt: r.createdAt,
        })),
        auditEvents: company.contractAuditEvents.map((a) => ({
          id: a.id,
          action: a.action,
          authorName: a.authorName,
          details: JSON.parse(a.details || '{}'),
          reason: a.reason,
          createdAt: a.createdAt,
        })),
        createdAt: company.createdAt,
        updatedAt: company.updatedAt,
      });
    } catch (error) {
      console.error('Erro ao buscar detalhes da empresa:', error);
      res.status(500).json({ error: 'Erro interno ao consultar detalhes da empresa.' });
    }
  }
);

// Cadastrar nova empresa com dados contratuais
router.post(
  '/companies',
  authenticateToken,
  requireCapability('CONTRACT_MANAGEMENT'),
  requireStepUpAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        name,
        cnpj,
        legalName,
        tradeName,
        adminContactName,
        adminContactEmail,
        adminContactPhone,
        contractNotes,
        planLimit,
        initialRatePercentage,
        initialRateReason,
        initialRateEffectiveFrom,
      } = req.body;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Nome da empresa é obrigatório.' });
      }

      const prisma = getPrisma();

      if (cnpj && typeof cnpj === 'string' && cnpj.trim().length > 0) {
        const cleanCnpj = cnpj.replace(/\D/g, '');
        const existing = await prisma.company.findUnique({ where: { cnpj: cleanCnpj } });
        if (existing) {
          return res.status(409).json({ error: 'Já existe uma empresa cadastrada com este CNPJ.' });
        }
      }

      const company = await prisma.company.create({
        data: {
          name: name.trim(),
          cnpj: cnpj && cnpj.trim().length > 0 ? cnpj.replace(/\D/g, '') : null,
          legalName: legalName ? legalName.trim() : null,
          tradeName: tradeName ? tradeName.trim() : null,
          adminContactName: adminContactName ? adminContactName.trim() : null,
          adminContactEmail: adminContactEmail ? adminContactEmail.trim().toLowerCase() : null,
          adminContactPhone: adminContactPhone ? adminContactPhone.trim() : null,
          contractNotes: contractNotes ? contractNotes.trim() : null,
          planLimit: typeof planLimit === 'number' && planLimit > 0 ? planLimit : 500,
          status: 'ACTIVE',
          isActive: true,
        },
      });

      // Se informada taxa inicial contratada
      if (initialRatePercentage !== undefined && initialRatePercentage !== null) {
        const parsedRate = Number(initialRatePercentage);
        if (isNaN(parsedRate) || parsedRate < 0 || parsedRate > 100) {
          return res.status(400).json({ error: 'Taxa inicial deve ser um percentual entre 0 e 100%.' });
        }

        const effectiveFrom = initialRateEffectiveFrom ? new Date(initialRateEffectiveFrom) : new Date();
        await prisma.companyPlatformRate.create({
          data: {
            companyId: company.id,
            version: 1,
            ratePercentage: new Prisma.Decimal(parsedRate.toFixed(3)),
            effectiveFrom,
            effectiveTo: null,
            reason: initialRateReason && initialRateReason.trim().length > 0 ? initialRateReason.trim() : 'Taxa inicial de adesão contratual',
            createdByUserId: req.user!.id,
            createdByName: req.user!.name || 'Proprietário',
          },
        });
      }

      await logContractAudit({
        companyId: company.id,
        action: 'COMPANY_CREATED',
        authorUserId: req.user!.id,
        authorName: req.user!.name || 'Proprietário',
        details: { name: company.name, cnpj: company.cnpj, initialRate: initialRatePercentage },
        reason: 'Cadastro inicial de empresa na Central do Proprietário',
        req,
      });

      res.status(201).json(company);
    } catch (error) {
      console.error('Erro ao cadastrar empresa:', error);
      res.status(500).json({ error: 'Erro interno ao cadastrar empresa.' });
    }
  }
);

// Atualizar dados contratuais e contato da empresa
router.put(
  '/companies/:id',
  authenticateToken,
  requireCapability('CONTRACT_MANAGEMENT'),
  requireStepUpAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const {
        name,
        cnpj,
        legalName,
        tradeName,
        adminContactName,
        adminContactEmail,
        adminContactPhone,
        contractNotes,
        planLimit,
      } = req.body;

      const prisma = getPrisma();
      const existing = await prisma.company.findUnique({ where: { id: id as string } });
      if (!existing) {
        return res.status(404).json({ error: 'Empresa não encontrada.' });
      }

      const cleanCnpj = cnpj ? cnpj.replace(/\D/g, '') : null;
      if (cleanCnpj && cleanCnpj !== existing.cnpj) {
        const conflict = await prisma.company.findUnique({ where: { cnpj: cleanCnpj } });
        if (conflict) {
          return res.status(409).json({ error: 'Já existe outra empresa com este CNPJ.' });
        }
      }

      const updated = await prisma.company.update({
        where: { id: id as string },
        data: {
          name: name ? name.trim() : existing.name,
          cnpj: cleanCnpj,
          legalName: legalName !== undefined ? (legalName ? legalName.trim() : null) : existing.legalName,
          tradeName: tradeName !== undefined ? (tradeName ? tradeName.trim() : null) : existing.tradeName,
          adminContactName: adminContactName !== undefined ? (adminContactName ? adminContactName.trim() : null) : existing.adminContactName,
          adminContactEmail: adminContactEmail !== undefined ? (adminContactEmail ? adminContactEmail.trim().toLowerCase() : null) : existing.adminContactEmail,
          adminContactPhone: adminContactPhone !== undefined ? (adminContactPhone ? adminContactPhone.trim() : null) : existing.adminContactPhone,
          contractNotes: contractNotes !== undefined ? (contractNotes ? contractNotes.trim() : null) : existing.contractNotes,
          planLimit: typeof planLimit === 'number' && planLimit > 0 ? planLimit : existing.planLimit,
        },
      });

      await logContractAudit({
        companyId: updated.id,
        action: 'COMPANY_UPDATED',
        authorUserId: req.user!.id,
        authorName: req.user!.name || 'Proprietário',
        details: { previous: existing, updated },
        reason: 'Atualização cadastral e contratual da empresa',
        req,
      });

      res.json(updated);
    } catch (error) {
      console.error('Erro ao atualizar empresa:', error);
      res.status(500).json({ error: 'Erro interno ao atualizar empresa.' });
    }
  }
);

// Suspender ou Reativar Empresa (governança auditável sem travar filas offline)
router.post(
  '/companies/:id/status',
  authenticateToken,
  requireCapability('CONTRACT_MANAGEMENT'),
  requireStepUpAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { status, reason } = req.body;

      if (!status || !['ACTIVE', 'SUSPENDED'].includes(status)) {
        return res.status(400).json({ error: 'Status deve ser "ACTIVE" ou "SUSPENDED".' });
      }

      if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
        return res.status(400).json({ error: 'Justificativa é obrigatória (mínimo 5 caracteres).' });
      }

      const prisma = getPrisma();
      const company = await prisma.company.findUnique({ where: { id: id as string } });
      if (!company) {
        return res.status(404).json({ error: 'Empresa não encontrada.' });
      }

      const isSuspending = status === 'SUSPENDED';
      const updated = await prisma.company.update({
        where: { id: id as string },
        data: {
          status,
          isActive: !isSuspending,
          suspensionReason: isSuspending ? reason.trim() : null,
          suspendedAt: isSuspending ? new Date() : null,
          suspendedByUserId: isSuspending ? req.user!.id : null,
        },
      });

      await logContractAudit({
        companyId: updated.id,
        action: isSuspending ? 'COMPANY_SUSPENDED' : 'COMPANY_REACTIVATED',
        authorUserId: req.user!.id,
        authorName: req.user!.name || 'Proprietário',
        details: { previousStatus: company.status, newStatus: status, reason: reason.trim() },
        reason: reason.trim(),
        req,
      });

      res.json({
        success: true,
        company: updated,
        message: isSuspending
          ? 'Empresa suspensa com sucesso. A recuperação de dados pendentes dos aparelhos permanece preservada.'
          : 'Empresa reativada com sucesso.',
      });
    } catch (error) {
      console.error('Erro ao alterar status da empresa:', error);
      res.status(500).json({ error: 'Erro interno ao alterar status da empresa.' });
    }
  }
);

// ── 4. Configuração da Taxa de Remuneração do Lumora com Vigência ─────────────

router.post(
  '/companies/:id/rates',
  authenticateToken,
  requireCapability('CONTRACT_MANAGEMENT'),
  requireStepUpAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { ratePercentage, effectiveFrom, reason } = req.body;

      if (ratePercentage === undefined || ratePercentage === null) {
        return res.status(400).json({
          error: 'Percentual da remuneração do Lumora (ratePercentage) é obrigatório.',
        });
      }

      const parsedRate = Number(ratePercentage);
      if (isNaN(parsedRate) || parsedRate < 0 || parsedRate > 100) {
        return res.status(400).json({
          error: 'Percentual inválido. Deve ser um número entre 0.000% e 100.000%. Taxa 0% exige escolha explícita e significa gratuidade.',
        });
      }

      if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
        return res.status(400).json({
          error: 'Justificativa contratual da taxa é obrigatória (mínimo 5 caracteres).',
        });
      }

      if (!effectiveFrom) {
        return res.status(400).json({
          error: 'Data de início da vigência (effectiveFrom) é obrigatória.',
        });
      }

      const startDate = new Date(effectiveFrom);
      if (isNaN(startDate.getTime())) {
        return res.status(400).json({
          error: 'Data de início da vigência inválida.',
        });
      }

      const prisma = getPrisma();
      const company = await prisma.company.findUnique({ where: { id: id as string } });
      if (!company) {
        return res.status(404).json({ error: 'Empresa não encontrada.' });
      }

      // Buscar taxa atual em aberto da empresa
      const currentOpenRate = await prisma.companyPlatformRate.findFirst({
        where: {
          companyId: id as string,
          effectiveTo: null,
        },
        orderBy: { version: 'desc' },
      });

      // Validação de não-retroatividade sobre vigências passadas
      if (currentOpenRate) {
        if (startDate < new Date(currentOpenRate.effectiveFrom)) {
          return res.status(400).json({
            error: `A nova data de vigência (${startDate.toISOString()}) não pode ser anterior ao início da vigência atual (${new Date(currentOpenRate.effectiveFrom).toISOString()}).`,
          });
        }
      }

      // Calcular próxima versão contratual
      const maxVersionAgg = await prisma.companyPlatformRate.aggregate({
        where: { companyId: id as string },
        _max: { version: true },
      });
      const nextVersion = (maxVersionAgg._max.version || 0) + 1;

      // Executar transação: fecha vigência anterior no instante de início da nova e insere o novo registro
      const result = await prisma.$transaction(async (tx) => {
        if (currentOpenRate) {
          await tx.companyPlatformRate.update({
            where: { id: currentOpenRate.id },
            data: { effectiveTo: startDate },
          });
        }

        const newRate = await tx.companyPlatformRate.create({
          data: {
            companyId: id as string,
            version: nextVersion,
            ratePercentage: new Prisma.Decimal(parsedRate.toFixed(3)),
            effectiveFrom: startDate,
            effectiveTo: null,
            reason: reason.trim(),
            createdByUserId: req.user!.id,
            createdByName: req.user!.name || 'Proprietário',
          },
        });

        return newRate;
      });

      await logContractAudit({
        companyId: id as string,
        action: 'RATE_CONFIGURED',
        authorUserId: req.user!.id,
        authorName: req.user!.name || 'Proprietário',
        details: {
          version: result.version,
          ratePercentage: parsedRate,
          effectiveFrom: result.effectiveFrom,
          previousRateId: currentOpenRate ? currentOpenRate.id : null,
          reason: reason.trim(),
        },
        reason: reason.trim(),
        req,
      });

      res.status(201).json({
        success: true,
        rate: {
          id: result.id,
          version: result.version,
          ratePercentage: Number(result.ratePercentage),
          effectiveFrom: result.effectiveFrom,
          effectiveTo: result.effectiveTo,
          reason: result.reason,
          createdByName: result.createdByName,
          createdAt: result.createdAt,
        },
        message: `Taxa da plataforma Lumora (${parsedRate}%) configurada com sucesso para a empresa a partir de ${startDate.toLocaleDateString('pt-BR')}.`,
      });
    } catch (error) {
      console.error('Erro ao configurar taxa da empresa:', error);
      res.status(500).json({ error: 'Erro interno ao configurar taxa.' });
    }
  }
);

// ── 5. Consulta de Contrato Próprio pela Empresa (COMPANY_ADMIN) ─────────────

router.get('/my-company-contract', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userRole = req.user?.role;
    const companyId = req.user?.companyId;

    if (!userRole || !['SUPER_ADMIN', 'COMPANY_ADMIN', 'ADMIN'].includes(userRole)) {
      return res.status(403).json({ error: 'Acesso restrito a administradores da empresa.' });
    }

    if (!companyId) {
      return res.status(404).json({ error: 'Usuário não vinculado a uma empresa ativa.' });
    }

    const prisma = getPrisma();
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      include: {
        platformRates: {
          orderBy: { version: 'desc' },
        },
      },
    });

    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada.' });
    }

    const now = new Date();
    const currentRate =
      company.platformRates.find(
        (r) =>
          new Date(r.effectiveFrom) <= now &&
          (r.effectiveTo === null || new Date(r.effectiveTo) > now)
      ) || company.platformRates[0] || null;

    res.json({
      company: {
        id: company.id,
        name: company.name,
        legalName: company.legalName,
        tradeName: company.tradeName,
        cnpj: company.cnpj,
        status: company.status,
        isActive: company.isActive,
      },
      isRateConfigured: company.platformRates.length > 0,
      currentRate: currentRate
        ? {
            version: currentRate.version,
            ratePercentage: Number(currentRate.ratePercentage),
            effectiveFrom: currentRate.effectiveFrom,
            effectiveTo: currentRate.effectiveTo,
            reason: currentRate.reason,
          }
        : null,
      rateHistory: company.platformRates.map((r) => ({
        version: r.version,
        ratePercentage: Number(r.ratePercentage),
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo,
        reason: r.reason,
        createdAt: r.createdAt,
      })),
      notice: 'A remuneração do Lumora é definida pelo proprietário da plataforma conforme contrato e não pode ser alterada diretamente pela empresa.',
    });
  } catch (error) {
    console.error('Erro ao consultar contrato da própria empresa:', error);
    res.status(500).json({ error: 'Erro interno ao consultar contrato.' });
  }
});

// ── 6. Trilha de Auditoria Geral da Plataforma ───────────────────────────────

router.get(
  '/audit-logs',
  authenticateToken,
  requireCapability(['CONTRACT_MANAGEMENT', 'PLATFORM_FINANCE']),
  async (req: AuthRequest, res: Response) => {
    try {
      const prisma = getPrisma();
      const companyId = req.query.companyId as string | undefined;
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

      const where: Prisma.ContractAuditEventWhereInput = {};
      if (companyId) {
        where.companyId = companyId;
      }

      const logs = await prisma.contractAuditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          company: {
            select: { id: true, name: true, cnpj: true },
          },
        },
      });

      res.json(
        logs.map((log) => ({
          id: log.id,
          action: log.action,
          companyId: log.companyId,
          companyName: log.company?.name || 'Geral / Plataforma',
          authorUserId: log.authorUserId,
          authorName: log.authorName,
          details: JSON.parse(log.details || '{}'),
          reason: log.reason,
          ipAddress: log.ipAddress,
          createdAt: log.createdAt,
        }))
      );
    } catch (error) {
      console.error('Erro ao consultar logs de auditoria:', error);
      res.status(500).json({ error: 'Erro interno ao consultar logs de auditoria.' });
    }
  }
);

export default router;
