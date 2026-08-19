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
  };
}

export const VALID_ROLES = [
  'SUPER_ADMIN',
  'COMPANY_ADMIN',
  'ADMIN',
  'SUPERVISOR',
  'SELLER',
  'PHOTOGRAPHER',
  'OPERATOR',
] as const;

export type UserRole = (typeof VALID_ROLES)[number];

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

    // Revalidação em tempo real no banco de dados
    const user = await getPrisma().user.findUnique({
      where: { id: decoded.id },
      include: { company: true },
    });

    if (!user) {
      res.status(401).json({ error: 'User not found or session invalid' });
      return;
    }

    if (!user.active) {
      res.status(403).json({ error: 'User account is inactive' });
      return;
    }

    if (user.company && user.company.isActive === false) {
      res.status(403).json({ error: 'Company account is inactive' });
      return;
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
    console.error('authMiddleware error details:', err);
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

// Middleware to check if user has Admin or Supervisor role
export const requireAdminOrSupervisor = requireRoles(
  ['ADMIN', 'SUPERVISOR', 'COMPANY_ADMIN', 'SUPER_ADMIN'],
  'Forbidden: Requires Admin or Supervisor role'
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

