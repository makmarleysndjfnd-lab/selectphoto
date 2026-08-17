import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: any;
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Access token missing' });
    return;
  }

  const secret = process.env.JWT_SECRET || 'selectphoto-jwt-secret-key';
  if (!process.env.JWT_SECRET) {
    console.warn('[SECURITY WARNING] JWT_SECRET não está definida no .env! Usando chave padrão insegura.');
  }
  jwt.verify(token, secret, (err: any, user: any) => {
    if (err) {
      res.status(403).json({ error: 'Invalid token' });
      return;
    }
    req.user = user;
    next();
  });
};

// Middleware to check if user has Admin or Supervisor role
export const requireAdminOrSupervisor = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.user && (['ADMIN', 'SUPERVISOR', 'COMPANY_ADMIN', 'SUPER_ADMIN'].includes(req.user.role))) {
    next();
  } else {
    res.status(403).json({ error: 'Forbidden: Requires Admin or Supervisor role' });
  }
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.user && (['ADMIN', 'COMPANY_ADMIN', 'SUPER_ADMIN'].includes(req.user.role))) {
    next();
  } else {
    res.status(403).json({ error: 'Forbidden: Requires Admin role' });
  }
};

export const requireCompanyAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.user && (['COMPANY_ADMIN', 'SUPER_ADMIN'].includes(req.user.role))) {
    next();
  } else {
    res.status(403).json({ error: 'Forbidden: Requires Company Admin role' });
  }
};

export const requireSuperAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.user && req.user.role === 'SUPER_ADMIN') {
    next();
  } else {
    res.status(403).json({ error: 'Forbidden: Requires Super Admin role' });
  }
};
