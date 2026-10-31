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
    supportGrantId?: string;
    supportScope?: 'READ_ONLY' | 'OPERATIONAL_SUPPORT' | 'INTEGRATION_DEBUG' | string;
    isTemporarySupportSession?: boolean;
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
  'SUPPORT_AUTHORIZED',
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
  SUPPORT_AUTHORIZED: 10,
};

/**
 * Aplica a política unificada de autorização para qualquer sessão de suporte técnico
 * (seja por token dedicado de suporte ou por token de impersonação legada).
 *
 * REGRAS CRÍTICAS:
 * 1. Negação por padrão: métodos e ações devem ser explicitamente autorizados.
 * 2. Bloqueio absoluto de vendas (/sales, /vendas), finanças, taxas, faturamento, backups e senhas.
 * 3. Diferenciação estrita de escopo (READ_ONLY vs OPERATIONAL_SUPPORT vs INTEGRATION_DEBUG).
 * 4. Isolamento estrito de empresa dona dos dados.
 */
export function enforceSupportSessionRestrictions(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
  grant: {
    id: string;
    companyId: string;
    scope: string;
    status: string;
    expiresAt: Date | null;
    revokedAt: Date | null;
  }
): boolean {
  const method = req.method.toUpperCase();
  const isSafeRead = ['GET', 'HEAD', 'OPTIONS'].includes(method);
  const normalizedPath = ((req.baseUrl || '') + (req.path || '')).toLowerCase();

  // 1. Verificação contínua de integridade da concessão
  if (grant.status !== 'ACTIVE' || grant.revokedAt !== null) {
    res.status(403).json({
      error: 'SUPPORT_GRANT_REVOKED',
      message: 'Sessão de suporte inativa ou revogada pela empresa.',
    });
    return false;
  }

  if (grant.expiresAt && grant.expiresAt < new Date()) {
    res.status(403).json({
      error: 'SUPPORT_GRANT_EXPIRED',
      message: 'Sessão de suporte expirada.',
    });
    return false;
  }

  // 2. Isolamento de empresa: impede acesso cruzado a outra empresa
  const targetCompanyId = req.params.companyId || req.query.companyId || req.body?.companyId;
  if (targetCompanyId && typeof targetCompanyId === 'string' && targetCompanyId !== grant.companyId) {
    res.status(403).json({
      error: 'SUPPORT_COMPANY_MISMATCH',
      message: 'Sessão de suporte autorizada restrita exclusivamente à empresa da concessão.',
    });
    return false;
  }

  // 3. BLOQUEIOS CATEGÓRICOS PARA QUALQUER SESSÃO DE SUPORTE (INDEPENDENTE DE ESCOPO)

  // 3.1. Backups e Dumps (nunca acessíveis por suporte)
  if (normalizedPath.includes('/backup')) {
    res.status(403).json({
      error: 'SUPPORT_BACKUP_FORBIDDEN',
      message: 'Sessões de suporte não têm autorização para download ou restauração de backups.',
    });
    return false;
  }

  // 3.2. Faturamento da plataforma, taxas contratuais e rotas de governança global
  if (
    normalizedPath.includes('/owner/billing') ||
    normalizedPath.includes('/closing') ||
    normalizedPath.includes('/owner/rates') ||
    normalizedPath.includes('/company-platform-rates') ||
    normalizedPath.includes('/superadmin') ||
    (normalizedPath.includes('/owner') &&
      !normalizedPath.includes('/owner/support') &&
      !normalizedPath.includes('/owner/alerts') &&
      !normalizedPath.includes('/owner/integrations'))
  ) {
    res.status(403).json({
      error: 'SUPPORT_FINANCIAL_ACTION_FORBIDDEN',
      message: 'Ações financeiras, fechamento de faturamento e configuração de taxas são proibidas para sessões de suporte.',
    });
    return false;
  }

  // 3.3. Vendas e Contratos Comerciais (/sales, /vendas):
  // Proíbe expressamente CRIAÇÃO, EDIÇÃO ou EXCLUSÃO de vendas comerciais em qualquer sessão técnica!
  if (
    (normalizedPath.includes('/sales') || normalizedPath.includes('/vendas')) &&
    !isSafeRead
  ) {
    res.status(403).json({
      error: 'SUPPORT_FINANCIAL_ACTION_FORBIDDEN',
      message: 'Sessões de suporte não podem criar, alterar ou excluir vendas comerciais ou contratos.',
    });
    return false;
  }

  // 3.4. Mutações Financeiras, Pagamentos, Estornos e Tarifas
  if (
    (normalizedPath.includes('/finance') ||
      normalizedPath.includes('/payment') ||
      normalizedPath.includes('/refund') ||
      normalizedPath.includes('/charges') ||
      normalizedPath.includes('/boleto') ||
      normalizedPath.includes('/pix') ||
      normalizedPath.includes('/costs')) &&
    !isSafeRead
  ) {
    res.status(403).json({
      error: 'SUPPORT_FINANCIAL_MUTATION_FORBIDDEN',
      message: 'Sessões de suporte não podem registrar pagamentos, estornos ou baixas financeiras.',
    });
    return false;
  }

  // 3.5. Alteração de credenciais e senhas
  if (
    (normalizedPath.includes('/password') ||
      normalizedPath.includes('/reset-password') ||
      normalizedPath.includes('/change-password')) &&
    !isSafeRead
  ) {
    res.status(403).json({
      error: 'SUPPORT_CREDENTIAL_CHANGE_FORBIDDEN',
      message: 'Sessões de suporte não podem alterar senhas ou credenciais de usuários.',
    });
    return false;
  }

  // 4. MATRIZ DE ESCOPO E NEGAÇÃO POR PADRÃO (DEFAULT DENY)

  // 4.1. Escopo READ_ONLY: Veta CATEGORICAMENTE qualquer mutação HTTP
  if (grant.scope === 'READ_ONLY') {
    if (!isSafeRead) {
      res.status(403).json({
        error: 'SUPPORT_READ_ONLY_MUTATION_FORBIDDEN',
        message: 'Sessão de suporte em modo READ_ONLY não pode realizar mutações (POST/PUT/PATCH/DELETE).',
      });
      return false;
    }
    next();
    return true;
  }

  // 4.2. Escopo OPERATIONAL_SUPPORT: Permite leitura + mutações específicas de apoio operacional
  if (grant.scope === 'OPERATIONAL_SUPPORT') {
    if (isSafeRead) {
      next();
      return true;
    }

    const isAllowedSupportMutation =
      (normalizedPath.includes('/support/tickets') && (normalizedPath.includes('/messages') || normalizedPath.includes('/attachments'))) ||
      (normalizedPath.includes('/alerts') && normalizedPath.endsWith('/ack')) ||
      normalizedPath.includes('/app/telemetry');

    if (!isAllowedSupportMutation) {
      res.status(403).json({
        error: 'SUPPORT_ACTION_FORBIDDEN',
        message: 'Ação não autorizada para o escopo de suporte operacional.',
      });
      return false;
    }

    next();
    return true;
  }

  // 4.3. Escopo INTEGRATION_DEBUG: Permite leitura + diagnósticos de conectividade de integração
  if (grant.scope === 'INTEGRATION_DEBUG') {
    if (isSafeRead) {
      next();
      return true;
    }

    const isAllowedDebugMutation =
      (normalizedPath.includes('/integrations') && (normalizedPath.endsWith('/test') || normalizedPath.endsWith('/ping'))) ||
      (normalizedPath.includes('/support/tickets') && (normalizedPath.includes('/messages') || normalizedPath.includes('/attachments')));

    if (!isAllowedDebugMutation) {
      res.status(403).json({
        error: 'SUPPORT_ACTION_FORBIDDEN',
        message: 'Ação não autorizada para o escopo de depuração de integrações.',
      });
      return false;
    }

    next();
    return true;
  }

  // 4.4. Escopo desconhecido: Negação por padrão
  res.status(403).json({
    error: 'SUPPORT_SCOPE_INVALID',
    message: `Escopo de suporte desconhecido ou inválido: ${grant.scope}`,
  });
  return false;
}

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

    // =========================================================================
    // 1. SESSÃO DE SUPORTE TEMPORÁRIO AUTORIZADO (CONTEXTO EXPLÍCITO E SEGURO)
    // =========================================================================
    if (
      decoded.isTemporarySupportSession === true ||
      decoded.purpose === 'SUPPORT_SESSION' ||
      decoded.supportGrantId
    ) {
      if (!decoded.supportGrantId) {
        res.status(403).json({ error: 'Support session token missing supportGrantId' });
        return;
      }

      const grant = await getPrisma().supportAccessGrant.findUnique({
        where: { id: decoded.supportGrantId },
        include: { company: true },
      });

      if (!grant) {
        res.status(403).json({
          error: 'SUPPORT_GRANT_INVALID',
          message: 'Concessão de suporte não encontrada.',
        });
        return;
      }

      if (grant.status === 'REVOKED' || grant.revokedAt !== null) {
        res.status(403).json({
          error: 'SUPPORT_GRANT_REVOKED',
          message: 'Sessão de suporte revogada imediatamente pela empresa.',
        });
        return;
      }

      if (grant.status !== 'ACTIVE') {
        res.status(403).json({
          error: 'SUPPORT_GRANT_INACTIVE',
          message: `Sessão de suporte inativa (status atual: ${grant.status}).`,
        });
        return;
      }

      if (grant.expiresAt && grant.expiresAt < new Date()) {
        await getPrisma().supportAccessGrant.update({
          where: { id: grant.id },
          data: { status: 'EXPIRED' },
        });
        res.status(403).json({
          error: 'SUPPORT_GRANT_EXPIRED',
          message: 'Sessão de suporte expirada.',
        });
        return;
      }

      if (grant.companyId !== decoded.companyId) {
        res.status(403).json({
          error: 'SUPPORT_COMPANY_MISMATCH',
          message: 'Token de suporte não corresponde à empresa autorizada na concessão.',
        });
        return;
      }

      if (grant.requestedByUserId !== decoded.id) {
        res.status(403).json({
          error: 'SUPPORT_USER_MISMATCH',
          message: 'Token de suporte não pertence ao técnico solicitante.',
        });
        return;
      }

      const technicianUser = await getPrisma().user.findUnique({
        where: { id: decoded.id },
      });

      if (!technicianUser || !technicianUser.active) {
        res.status(403).json({ error: 'Conta de técnico inativa ou não encontrada' });
        return;
      }

      if (!grant.company || grant.company.isActive === false) {
        res.status(403).json({ error: 'A empresa dona dos dados está inativa' });
        return;
      }

      // Regra de Ouro: O papel na sessão de suporte é ESTRITAMENTE 'SUPPORT_AUTHORIZED'.
      // Mesmo que o usuário seja SUPER_ADMIN no banco, seu papel nesta requisição NUNCA é SUPER_ADMIN!
      req.user = {
        id: technicianUser.id,
        cpf: technicianUser.cpf,
        name: technicianUser.name,
        role: 'SUPPORT_AUTHORIZED',
        companyId: grant.companyId,
        teamId: null,
        photographerCode: null,
        actorId: technicianUser.id,
        actorRole: 'SUPPORT_AUTHORIZED',
        effectiveCompanyId: grant.companyId,
        effectiveRole: 'SUPPORT_AUTHORIZED',
        supportGrantId: grant.id,
        supportScope: grant.scope,
        isTemporarySupportSession: true,
      };

      // Aplica a política compartilhada e unificada de autorização de suporte
      enforceSupportSessionRestrictions(req, res, next, grant);
      return;
    }

    // =========================================================================
    // 2. IMPERSONAÇÃO LEGADA (VINCULADA À CONCESSÃO E SUJEITA À MESMA POLÍTICA)
    // =========================================================================
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

      // Validação de concessão ativa para impedir que impersonação contorne autorização
      const activeGrant = await getPrisma().supportAccessGrant.findFirst({
        where: {
          companyId: targetCompany.id,
          requestedByUserId: actor.id,
          status: 'ACTIVE',
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { grantedAt: 'desc' },
      });

      if (!activeGrant) {
        res.status(403).json({
          error: 'SUPPORT_GRANT_REQUIRED',
          message: 'Acesso à empresa exige solicitação prévia e aprovação formal através da Central de Suporte.',
        });
        return;
      }

      req.user = {
        id: actor.id,
        cpf: actor.cpf,
        role: 'SUPPORT_AUTHORIZED', // Converte para o perfil estrito de suporte
        companyId: targetCompany.id,
        teamId: null,
        name: actor.name,
        photographerCode: null,
        actorId: actor.id,
        actorRole: 'SUPPORT_AUTHORIZED',
        effectiveCompanyId: targetCompany.id,
        effectiveRole: 'SUPPORT_AUTHORIZED',
        supportGrantId: activeGrant.id,
        supportScope: activeGrant.scope,
        isTemporarySupportSession: true,
      };

      // APLICA AS MESMÍSSIMAS RESTRIÇÕES DA POLÍTICA COMPARTILHADA
      enforceSupportSessionRestrictions(req, res, next, activeGrant);
      return;
    }

    // =========================================================================
    // 3. REVALIDAÇÃO PADRÃO EM TEMPO REAL NO BANCO DE DADOS
    // =========================================================================
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
      return;
    }

    // Sessão de suporte autorizada tem acesso operacional a rotas da empresa (ADMIN, COMPANY_ADMIN, OPERATOR, etc.)
    // Jamais concede acesso a rotas que exigem estritamente SUPER_ADMIN
    if (
      req.user.role === 'SUPPORT_AUTHORIZED' &&
      req.user.isTemporarySupportSession
    ) {
      const isStrictlySuperAdminOnly =
        allowedRoles.length === 1 && allowedRoles[0] === 'SUPER_ADMIN';

      if (!isStrictlySuperAdminOnly) {
        const hasCompanyOperationalRole = allowedRoles.some((r) =>
          [
            'COMPANY_ADMIN',
            'ADMIN',
            'SUPERVISOR',
            'SELLER_MANAGER',
            'OPERATOR',
            'SELLER',
            'SUPPORT_AUTHORIZED',
          ].includes(r)
        );

        if (hasCompanyOperationalRole) {
          next();
          return;
        }
      }
    }

    res.status(403).json({
      error: customErrorMessage || `Forbidden: Requires one of [${allowedRoles.join(', ')}] role`,
    });
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
