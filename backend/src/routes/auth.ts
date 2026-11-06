import { Router, Request, Response } from 'express';
import { prisma } from '../services/prisma';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { loginRateLimiter } from '../middleware/securityMiddleware';

const router = Router();


router.post('/login', loginRateLimiter, async (req: Request, res: Response) => {
  const { cpf, password, deviceId } = req.body;

  if (!cpf || !password) {
    res.status(400).json({ error: 'CPF and password are required' });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim() === '') {
    console.error('🛑 [CRITICAL SECURITY ERROR] JWT_SECRET não está configurado.');
    res.status(500).json({ error: 'Authentication service configuration error' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { cpf: String(cpf).trim() },
      include: { company: true },
    });

    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (!user.active) {
      res.status(401).json({ error: 'User is inactive' });
      return;
    }

    // Para qualquer papel que não seja SUPER_ADMIN, rejeite se companyId for ausente ou empresa inativa
    if (user.role !== 'SUPER_ADMIN') {
      if (!user.companyId || !user.company || user.company.isActive === false) {
        res.status(401).json({ error: 'Company account is inactive' });
        return;
      }
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const normalizedDeviceId =
      typeof deviceId === 'string' && deviceId.trim().length > 0
        ? deviceId.trim().substring(0, 128)
        : null;

    const disconnectedPreviousDevice = Boolean(
      user.activeSessionId &&
        (!normalizedDeviceId ||
          !user.activeDeviceId ||
          user.activeDeviceId !== normalizedDeviceId)
    );

    const sessionId = crypto.randomUUID();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        activeSessionId: sessionId,
        activeDeviceId: normalizedDeviceId,
        sessionStartedAt: new Date(),
      },
    });

    // Token expires in 30 days for offline persistence, bound to single active sessionId
    const token = jwt.sign(
      {
        id: user.id,
        cpf: user.cpf,
        role: user.role,
        teamId: user.teamId,
        companyId: user.companyId,
        sessionId,
      },
      secret,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      disconnectedPreviousDevice,
      sessionNotice: disconnectedPreviousDevice
        ? 'Este login estava conectado em outro aparelho e foi desconectado automaticamente do aparelho anterior.'
        : null,
      user: {
        id: user.id,
        name: user.name,
        cpf: user.cpf,
        role: user.role,
        teamId: user.teamId,
        companyId: user.companyId,
        photographerCode: user.photographerCode,
        sessionId,
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    const secret = process.env.JWT_SECRET;

    if (token && secret) {
      try {
        const decoded = jwt.verify(token, secret) as any;
        if (decoded && decoded.id) {
          const currentUser = await prisma.user.findUnique({
            where: { id: decoded.id },
            select: { activeSessionId: true },
          });
          // Limpa a sessão ativa apenas se pertencer à sessão que solicitou logout
          if (
            currentUser &&
            (!decoded.sessionId || currentUser.activeSessionId === decoded.sessionId)
          ) {
            await prisma.user.update({
              where: { id: decoded.id },
              data: {
                activeSessionId: null,
                activeDeviceId: null,
                sessionStartedAt: null,
              },
            });
          }
        }
      } catch (_) {
        // Ignora token já expirado/inválido no logout
      }
    }

    res.json({ success: true });
  } catch (error) {
    res.json({ success: true });
  }
});

// Setup initial super admin (only works if enabled and authenticated with setup secret)
router.post('/setup', async (req: Request, res: Response) => {
  try {
    const isProd = process.env.NODE_ENV === 'production';
    const enableSetup = process.env.ENABLE_SETUP_ENDPOINT === 'true' || (!isProd && process.env.ENABLE_SETUP_ENDPOINT !== 'false');

    if (!enableSetup) {
      res.status(403).json({ error: 'Setup endpoint is disabled' });
      return;
    }

    if (isProd && process.env.ENABLE_PROD_SETUP !== 'true') {
      res.status(403).json({ error: 'Setup endpoint is disabled in production by default' });
      return;
    }

    const setupSecret = process.env.SETUP_SECRET;
    const providedSecret = req.headers['x-setup-secret'] || req.body?.setupSecret;

    if (!setupSecret || setupSecret.trim() === '' || providedSecret !== setupSecret) {
      res.status(403).json({ error: 'Invalid or missing setup secret' });
      return;
    }

    const userCount = await prisma.user.count();
    if (userCount > 0) {
      res.status(403).json({ error: 'Setup already completed' });
      return;
    }

    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      res.status(400).json({ error: 'Name, email and password are required' });
      return;
    }
    
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
