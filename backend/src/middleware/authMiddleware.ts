import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

let _prisma: PrismaClient | null = null;
function getPrisma(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient();
  }
  return _prisma;
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    cpf?: string | null;
    role: string;
    companyId?: string | null;
    teamId?: string | null;
    name?: string | null;
    photographerCode?: string | null;
    actorId?: string;
    actorRole?: string;
    effectiveCompanyId?: string;
    effectiveRole?: string;
  };
}

export const VALID_ROLES = [
  'SUPER_ADMIN',
  'COMPANY_ADMIN',
  'ADMIN',
  'SUPERVISOR',
  'SELLER_MANAGER',
  'SELLER',
  'PHOTOGRAPHER',
  'DRIVER',
  'OPERATOR',
] as const;

export type UserRole = (typeof VALID_ROLES)[number];

export const ROLE_RANK: Record<string, number> = {
  SUPER_ADMIN: 100,
  COMPANY_ADMIN: 80,
  ADMIN: 60,
  SUPERVISOR: 40,
  SELLER_MANAGER: 40,
  SELLER: 20,
  PHOTOGRAPHER: 20,
  DRIVER: 20,
  OPERATOR: 20,
};

export const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Access token missing' });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim() === '') {
    console.error('🛑 [CRITICAL SECURITY ERROR] JWT_SECRET não está configurado.');
    res.status(500).json({ error: 'Authentication service configuration error' });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret) as any;

    if (!decoded || !decoded.id) {
      res.status(403).json({ error: 'Invalid token payload' });
      return;
    }

    // Suporte a Impersonação por SUPER_ADMIN revalidado em tempo real
    if (decoded.actorId && decoded.actorRole === 'SUPER_ADMIN') {
      const actor = await getPrisma().user.findUnique({
        where: { id: decoded.actorId },
      });

      if (!actor || !actor.active || actor.role !== 'SUPER_ADMIN') {
        res.status(403).json({ error: 'Impersonation actor is invalid or inactive' });
        return;
      }

      const targetCompanyId = decoded.effectiveCompanyId || decoded.companyId;
      if (!targetCompanyId) {
        res.status(403).json({ error: 'Impersonation companyId is missing' });
        return;
      }

      const targetCompany = await getPrisma().company.findUnique({
        where: { id: targetCompanyId },
      });

      if (!targetCompany || targetCompany.isActive === false) {
        res.status(403).json({ error: 'Impersonated company is invalid or inactive' });
        return;
      }

      req.user = {
        id: actor.id,
        cpf: actor.cpf,
        role: decoded.effectiveRole || 'COMPANY_ADMIN',
        companyId: targetCompany.id,
        teamId: null,
        name: actor.name,
        photographerCode: null,
        actorId: actor.id,
        actorRole: 'SUPER_ADMIN',
        effectiveCompanyId: targetCompany.id,
        effectiveRole: decoded.effectiveRole || 'COMPANY_ADMIN',
      };

      next();
      return;
    }

    // Revalidação padrão em tempo real no banco de dados
    const user = await getPrisma().user.findUnique({
      where: { id: decoded.id },
      include: { company: true },
    });

    if (!user) {
      res.status(401).json({ error: 'User not found or session invalid' });
      return;
    }

    if (!user.active) {
      const isDeletionRoute =
        (req.baseUrl === '/api/users' && req.path === '/me/request-deletion') ||
        (req.originalUrl && req.originalUrl.includes('/api/users/me/request-deletion'));

      if (!isDeletionRoute) {
        res.status(403).json({ error: 'User account is inactive' });
        return;
      }
    }

    // Para qualquer papel que não seja SUPER_ADMIN, exige empresa existente e ativa
    if (user.role !== 'SUPER_ADMIN') {
      if (!user.companyId || !user.company || user.company.isActive === false) {
        res.status(403).json({ error: 'Company account is inactive' });
        return;
      }
    }

    // O papel e a empresa vêm EXCLUSIVAMENTE do banco de dados, ignorando claims antigas ou adulteradas
    req.user = {
      id: user.id,
      cpf: user.cpf,
      role: user.role,
      companyId: user.companyId,
      teamId: user.teamId,
      name: user.name,
      photographerCode: user.photographerCode,
    };

    next();
  } catch (err: any) {
    console.error('authMiddleware error details:', err?.message || err);
    res.status(403).json({ error: 'Invalid or expired token' });
  }
};

export const requireRoles = (allowedRoles: string[], customErrorMessage?: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !req.user.role) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (allowedRoles.includes(req.user.role)) {
      next();
    } else {
      res.status(403).json({ error: customErrorMessage || `Forbidden: Requires one of [${allowedRoles.join(', ')}] role` });
    }
  };
};

// Middlewares de papéis
export const requireAdminOrSupervisor = requireRoles(
  ['ADMIN', 'SUPERVISOR', 'SELLER_MANAGER', 'COMPANY_ADMIN', 'SUPER_ADMIN'],
  'Forbidden: Requires Admin, Supervisor, Seller Manager or Company Admin role'
);

export const requireAdmin = requireRoles(
  ['ADMIN', 'COMPANY_ADMIN', 'SUPER_ADMIN'],
  'Forbidden: Requires Admin role'
);

export const requireCompanyAdmin = requireRoles(
  ['COMPANY_ADMIN', 'SUPER_ADMIN'],
  'Forbidden: Requires Company Admin role'
);

export const requireSuperAdmin = requireRoles(
  ['SUPER_ADMIN'],
  'Forbidden: Requires Super Admin role'
);

export const OWNER_CAPABILITIES = [
  'PLATFORM_FINANCE',
  'CONTRACT_MANAGEMENT',
  'INTEGRATION_CONFIG',
  'TECHNICAL_SUPPORT',
] as const;

export type OwnerCapabilityType = (typeof OWNER_CAPABILITIES)[number];

export const requireCapability = (capability: OwnerCapabilityType | OwnerCapabilityType[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user || !req.user.id) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (req.user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Acesso restrito à Central do Proprietário (SUPER_ADMIN).' });
      return;
    }

    const caps = Array.isArray(capability) ? capability : [capability];
    const userCaps = await getPrisma().ownerCapability.findMany({
      where: {
        userId: req.user.id,
        capability: { in: caps },
      },
      select: { capability: true },
    });

    if (userCaps.length === 0) {
      res.status(403).json({
        error: 'FORBIDDEN_CAPABILITY',
        message: `Acesso negado: Requer uma das seguintes capacidades da Central do Proprietário: [${caps.join(', ')}].`,
      });
      return;
    }

    next();
  };
};

export const requireStepUpAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.user || !req.user.id) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // 1. Header X-Step-Up-Token
  const stepUpToken = req.headers['x-step-up-token'] as string | undefined;
  if (stepUpToken && typeof stepUpToken === 'string' && stepUpToken.trim().length > 0) {
    const crypto = await import('crypto');
    const tokenHash = crypto.createHash('sha256').update(stepUpToken.trim()).digest('hex');
    const session = await getPrisma().stepUpSession.findFirst({
      where: {
        userId: req.user.id,
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (session) {
      next();
      return;
    }
  }

  // 2. Fallback: passwordConfirmation no corpo da requisição
  const passwordConfirmation = req.body?.passwordConfirmation;
  if (passwordConfirmation && typeof passwordConfirmation === 'string') {
    const user = await getPrisma().user.findUnique({
      where: { id: req.user.id },
      select: { password: true },
    });

    if (user && user.password) {
      const bcrypt = await import('bcrypt');
      const valid = await bcrypt.compare(passwordConfirmation, user.password);
      if (valid) {
        next();
        return;
      }
    }
  }

  res.status(403).json({
    error: 'STEP_UP_AUTH_REQUIRED',
    message: 'Esta ação contratual sensível exige reautenticação reforçada com confirmação de senha.',
  });
};
