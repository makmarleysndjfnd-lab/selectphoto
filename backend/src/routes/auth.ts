import { Router, Request, Response } from 'express';
import { prisma } from '../services/prisma';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { loginRateLimiter } from '../middleware/securityMiddleware';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import passwordRecoveryRoutes from './passwordRecovery';
import { resolveCompanyDisplayName } from '../constants/companyClassification';

const router = Router();
router.use(passwordRecoveryRoutes);

router.get('/session', authenticateToken, async (req: AuthRequest, res: Response) => {
  const companyId = req.user?.companyId || null;
  let companyName: string | null = null;
  let companyTradeName: string | null = null;
  let commercialStatus: string = 'ACTIVE';
  let commercialStatusReason: string | null = null;
  let governanceWarning: string | null = null;
  if (companyId) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        name: true,
        tradeName: true,
        status: true,
        isActive: true,
        commercialStatus: true,
        commercialStatusReason: true,
        suspensionReason: true,
      },
    });
    if (company) {
      if (
        req.user?.role !== 'SUPER_ADMIN' &&
        !req.user?.isTemporarySupportSession &&
        (company.isActive === false ||
          company.status === 'SUSPENDED' ||
          company.commercialStatus === 'SUSPENDED')
      ) {
        return res.status(403).json({
          error:
            company.commercialStatusReason ||
            company.suspensionReason ||
            'Company account is inactive (suspended).',
          code: 'COMPANY_SUSPENDED',
          commercialStatus: 'SUSPENDED',
        });
      }
      companyTradeName = company.tradeName || null;
      companyName = resolveCompanyDisplayName(company, company.name);
      commercialStatus = company.commercialStatus || company.status || 'ACTIVE';
      commercialStatusReason = company.commercialStatusReason || null;
      if (commercialStatus === 'WARNING') {
        governanceWarning =
          commercialStatusReason ||
          'Aviso financeiro Lumora: regularize pendências para evitar suspensão do acesso.';
      }
    }
  }
  res.json({
    valid: true,
    userId: req.user?.id || null,
    role: req.user?.role || null,
    companyId,
    companyName,
    companyTradeName,
    commercialStatus,
    commercialStatusReason,
    governanceWarning,
    isTemporarySupportSession: Boolean(req.user?.isTemporarySupportSession),
  });
});


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

    // Para qualquer papel que não seja SUPER_ADMIN, rejeite se companyId for ausente, inativa ou suspensa
    if (user.role !== 'SUPER_ADMIN') {
      if (!user.companyId || !user.company) {
        res.status(401).json({ error: 'Company account is inactive' });
        return;
      }
      if (
        user.company.commercialStatus === 'SUSPENDED' ||
        user.company.status === 'SUSPENDED'
      ) {
        res.status(403).json({
          error:
            user.company.commercialStatusReason ||
            user.company.suspensionReason ||
            'Acesso bloqueado: empresa suspensa comercialmente. Seus dados permanecem preservados.',
          code: 'COMPANY_SUSPENDED',
          commercialStatus: 'SUSPENDED',
        });
        return;
      }
      if (user.company.isActive === false) {
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

    const session = await prisma.user.updateMany({
      where: { id: user.id, active: true, password: user.password },
      data: {
        activeSessionId: sessionId,
        activeDeviceId: normalizedDeviceId,
        sessionStartedAt: new Date(),
      },
    });
    if (session.count !== 1) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

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
        companyName: user.company
          ? resolveCompanyDisplayName(user.company, user.company.name)
          : null,
        companyLegalName: user.company?.name || null,
        companyTradeName: user.company?.tradeName || null,
        commercialStatus: user.company?.commercialStatus || user.company?.status || 'ACTIVE',
        commercialStatusReason: user.company?.commercialStatusReason || null,
        governanceWarning:
          user.company?.commercialStatus === 'WARNING'
            ? (user.company.commercialStatusReason ||
                'Aviso financeiro Lumora: regularize pendências para evitar suspensão do acesso.')
            : null,
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
        if (decoded && typeof decoded.id === 'string') {
          // Um token antigo não deve apagar uma sessão nova, inclusive depois de um reset.
          await prisma.user.updateMany({
            where: {
              id: decoded.id,
              ...(typeof decoded.sessionId === 'string'
                ? { activeSessionId: decoded.sessionId }
                : { activeSessionId: null, passwordResetAt: null }),
            },
            data: {
              activeSessionId: null,
              activeDeviceId: null,
              sessionStartedAt: null,
            },
          });
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
        name: 'Lumora Master',
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
