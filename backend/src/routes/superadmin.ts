import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/prisma';
import { authenticateToken, requireSuperAdmin, AuthRequest } from '../middleware/authMiddleware';
import { claimSupportSessionToken } from '../services/supportCentralService';
import { recordOperationalAuditEvent } from '../services/operationalAuditService';
import {
  formatTailMask,
  resolveCompanyAsaasStatus,
  setExclusiveCompanyAsaasKey,
  setExclusiveCompanyGeminiKey,
  testCompanyAsaasConnection,
  testCompanyGeminiConnection,
} from '../services/companyApiKeyService';
import {
  listPlatformStatementsOverview,
  previewOrGetCompanyStatement,
} from '../services/platformBillingService';
import { getCompetenceForDate } from '../services/monthlyCreditClosingService';
import { sendVaultUnavailableIfApplicable } from '../services/vaultService';
import {
  getCompanyMonthlyApiUsageSummary,
  updateCompanyApiUsageLimits,
} from '../services/apiUsageService';
import {
  getCompanyEventSearchConfig,
  upsertCompanyEventSearchConfig,
  resetCompanyEventSearchConfig,
} from '../services/eventSearchConfigService';
import { clearCompanyCityScoutCache } from './events';
import {
  getCompanyOperationalConfig,
  upsertCompanyOperationalConfig,
} from '../services/companyOperationalConfigService';
import { upload, safeUpload, getUploadedFileUrl } from '../middleware/upload';
import path from 'path';

const router = Router();

function parsePlatformFeeBps(body: any): number | undefined {
  if (body?.platformFeeBps !== undefined && body?.platformFeeBps !== null && body?.platformFeeBps !== '') {
    const bps = Math.round(Number(body.platformFeeBps));
    if (!Number.isFinite(bps) || bps < 0 || bps > 10000) {
      throw { status: 400, message: 'platformFeeBps deve estar entre 0 e 10000 (0% a 100%).' };
    }
    return bps;
  }
  const pctRaw = body?.platformFeePercent ?? body?.initialRatePercentage ?? body?.ratePercentage;
  if (pctRaw !== undefined && pctRaw !== null && pctRaw !== '') {
    const pct = Number(String(pctRaw).replace(',', '.'));
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw { status: 400, message: 'Taxa Lumora (%) deve estar entre 0 e 100.' };
    }
    return Math.round(pct * 100);
  }
  return undefined;
}

async function syncCompanyPlatformRateFromBps(
  companyId: string,
  bps: number,
  actorId: string,
  actorName: string,
  reason: string
) {
  const pctStr = (bps / 100).toFixed(3);
  const latest = await prisma.companyPlatformRate.findFirst({
    where: { companyId },
    orderBy: { version: 'desc' },
  });
  const now = new Date();
  if (latest) {
    await prisma.companyPlatformRate.updateMany({
      where: { companyId, effectiveTo: null },
      data: { effectiveTo: now },
    });
  }
  await prisma.companyPlatformRate.create({
    data: {
      companyId,
      version: (latest?.version || 0) + 1,
      ratePercentage: new Prisma.Decimal(pctStr),
      effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
      effectiveTo: null,
      reason,
      createdByUserId: actorId,
      createdByName: actorName,
    },
  });
}

async function sanitizeCompanyForSuperAdmin(c: any, options?: { rethrowVaultError?: boolean }) {
  const [asaasInfo, activeAiInteg] = await Promise.all([
    resolveCompanyAsaasStatus(c.id, options),
    prisma.companyIntegration.findFirst({
      where: {
        companyId: c.id,
        category: 'AI_RESEARCH',
        provider: 'GEMINI',
        status: 'ACTIVE',
        scope: { not: 'PLATFORM_SHARED' },
      },
      select: { secretMasked: true, lastValidationStatus: true, lastValidatedAt: true },
    }),
  ]);

  const geminiConfigured = Boolean(c.geminiApiKeyEncrypted && c.geminiApiKeyIv && c.geminiApiKeyTag) || Boolean(activeAiInteg);
  const geminiMasked = c.geminiApiKeyMasked || activeAiInteg?.secretMasked || null;
  const geminiStatus = c.geminiConnectionStatus || (geminiConfigured ? 'PENDING' : 'UNCONFIGURED');

  const {
    geminiApiKeyEncrypted: _enc,
    geminiApiKeyIv: _iv,
    geminiApiKeyTag: _tag,
    asaasConfig: _asaasCfg,
    integrations: _integs,
    ...safeCompany
  } = c;

  const feeBps = typeof c.platformFeeBps === 'number' ? c.platformFeeBps : 250;
  const commStatus = c.commercialStatus || c.status || 'ACTIVE';

  return {
    ...safeCompany,
    platformFeeBps: feeBps,
    platformFeePercent: Number((feeBps / 100).toFixed(2)),
    commercialStatus: commStatus,
    commercialStatusReason: c.commercialStatusReason || null,
    integrationsSummary: {
      asaas: {
        configured: asaasInfo.configured,
        environment: asaasInfo.environment,
        maskedKey: asaasInfo.maskedKey,
        connectionStatus: asaasInfo.connectionStatus,
        lastTestedAt: asaasInfo.lastTestedAt,
        connectionMessage: asaasInfo.connectionMessage,
      },
      serasa: {
        configured: asaasInfo.configured,
        ready: asaasInfo.configured,
        environment: asaasInfo.environment,
      },
      gemini: {
        configured: geminiConfigured,
        maskedKey: geminiMasked,
        connectionStatus: geminiStatus,
        lastTestedAt: c.geminiLastTestedAt || null,
        connectionMessage: c.geminiConnectionMessage || null,
      },
      companyPix: {
        configured: Boolean(c.companyPixKey && String(c.companyPixKey).trim()),
        type: c.companyPixKeyType || null,
      },
    },
  };
}

// Get all companies (sanitizado sem chaves em texto plano)
router.get('/companies', authenticateToken, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const companies = await prisma.company.findMany({
      include: {
        _count: {
          select: { users: true, clients: true }
        }
      },
      orderBy: { name: 'asc' },
    });
    const sanitized = await Promise.all(companies.map((c) => sanitizeCompanyForSuperAdmin(c)));
    res.json(sanitized);
  } catch (error) {
    if (sendVaultUnavailableIfApplicable(res, error)) return;
    console.error('Error fetching companies:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single company details (sanitizado sem chaves em texto plano)
router.get('/companies/:id', authenticateToken, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: String(req.params.id) },
      include: {
        _count: { select: { users: true, clients: true } },
        platformRates: { orderBy: { version: 'desc' }, take: 5 },
      },
    });
    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada.' });
    }
    return res.json(await sanitizeCompanyForSuperAdmin(company));
  } catch (error) {
    if (sendVaultUnavailableIfApplicable(res, error)) return;
    console.error('Error fetching company:', error);
    return res.status(500).json({ error: 'Internal server error' });
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
      commercialStatus,
      commercialStatusReason,
      geminiApiKey,
      asaasApiKey,
      asaasEnvironment,
    } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Nome da empresa é obrigatório.' });
      return;
    }

    const parsedBps = parsePlatformFeeBps(req.body);
    const feeBps = parsedBps !== undefined ? parsedBps : 250;
    const rawCommStatus = String(commercialStatus || 'ACTIVE').toUpperCase();
    const validCommStatus = ['ACTIVE', 'WARNING', 'SUSPENDED'].includes(rawCommStatus) ? rawCommStatus : 'ACTIVE';
    const isSusp = validCommStatus === 'SUSPENDED';

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
        platformFeeBps: feeBps,
        commercialStatus: validCommStatus,
        commercialStatusReason: typeof commercialStatusReason === 'string' && commercialStatusReason.trim() ? commercialStatusReason.trim() : null,
        status: isSusp ? 'SUSPENDED' : 'ACTIVE',
        isActive: !isSusp,
        ...(isSusp ? { suspensionReason: commercialStatusReason || 'Suspensa no cadastro', suspendedAt: new Date(), suspendedByUserId: req.user?.id || null } : {}),
      },
    });

    await syncCompanyPlatformRateFromBps(
      company.id,
      feeBps,
      req.user!.id,
      req.user!.name || 'SuperAdmin',
      'Taxa Lumora configurada no cadastro da empresa'
    );

    if (typeof geminiApiKey === 'string' && geminiApiKey.trim()) {
      await setExclusiveCompanyGeminiKey({
        companyId: company.id,
        apiKey: geminiApiKey,
        actorUserId: req.user!.id,
        actorName: req.user!.name || 'SuperAdmin',
        ipAddress: req.ip || null,
      });
    }
    if (typeof asaasApiKey === 'string' && asaasApiKey.trim()) {
      await setExclusiveCompanyAsaasKey({
        companyId: company.id,
        apiKey: asaasApiKey,
        environment: asaasEnvironment === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX',
        actorUserId: req.user!.id,
        actorName: req.user!.name || 'SuperAdmin',
        ipAddress: req.ip || null,
      });
    }

    const refreshed = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    res.status(201).json(await sanitizeCompanyForSuperAdmin(refreshed));
  } catch (error: any) {
    if (sendVaultUnavailableIfApplicable(res, error)) return;
    if (error?.status) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error('Error creating company:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update company branding/commercial details, platform fee, commercial status, and optional API keys
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
      commercialStatus,
      commercialStatusReason,
      geminiApiKey,
      asaasApiKey,
      asaasEnvironment,
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

    const parsedBps = parsePlatformFeeBps(req.body);
    let nextCommStatus = existing.commercialStatus || existing.status || 'ACTIVE';
    let nextCommReason = existing.commercialStatusReason;
    let nextStatus = existing.status;
    let nextIsActive = typeof isActive === 'boolean' ? isActive : existing.isActive;

    if (commercialStatus !== undefined) {
      const upper = String(commercialStatus).toUpperCase();
      if (!['ACTIVE', 'WARNING', 'SUSPENDED'].includes(upper)) {
        return res.status(400).json({ error: 'commercialStatus deve ser ACTIVE, WARNING ou SUSPENDED.' });
      }
      nextCommStatus = upper;
      nextStatus = upper === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';
      nextIsActive = upper !== 'SUSPENDED';
      nextCommReason =
        upper === 'ACTIVE'
          ? null
          : typeof commercialStatusReason === 'string' && commercialStatusReason.trim()
            ? commercialStatusReason.trim()
            : existing.commercialStatusReason;
    } else if (commercialStatusReason !== undefined) {
      nextCommReason = typeof commercialStatusReason === 'string' && commercialStatusReason.trim()
        ? commercialStatusReason.trim()
        : null;
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
        platformFeeBps: parsedBps !== undefined ? parsedBps : existing.platformFeeBps,
        commercialStatus: nextCommStatus,
        commercialStatusReason: nextCommReason,
        status: nextStatus,
        isActive: nextIsActive,
        ...(nextCommStatus === 'SUSPENDED'
          ? {
              suspensionReason: nextCommReason || 'Suspensão comercial',
              suspendedAt: existing.suspendedAt || new Date(),
              suspendedByUserId: req.user?.id || null,
            }
          : commercialStatus !== undefined
            ? { suspensionReason: null, suspendedAt: null, suspendedByUserId: null }
            : {}),
      },
    });

    if (parsedBps !== undefined && parsedBps !== existing.platformFeeBps) {
      await syncCompanyPlatformRateFromBps(
        updated.id,
        parsedBps,
        req.user!.id,
        req.user!.name || 'SuperAdmin',
        'Atualização da Taxa Lumora pelo SuperAdmin'
      );
    }

    if (typeof geminiApiKey === 'string') {
      await setExclusiveCompanyGeminiKey({
        companyId: updated.id,
        apiKey: geminiApiKey,
        actorUserId: req.user!.id,
        actorName: req.user!.name || 'SuperAdmin',
        ipAddress: req.ip || null,
      });
    }
    if (typeof asaasApiKey === 'string') {
      await setExclusiveCompanyAsaasKey({
        companyId: updated.id,
        apiKey: asaasApiKey,
        environment: asaasEnvironment === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX',
        actorUserId: req.user!.id,
        actorName: req.user!.name || 'SuperAdmin',
        ipAddress: req.ip || null,
      });
    }

    if (commercialStatus !== undefined && commercialStatus !== existing.commercialStatus) {
      await recordOperationalAuditEvent({
        companyId: updated.id,
        category: 'GOVERNANCE',
        action: `COMPANY_COMMERCIAL_STATUS_${nextCommStatus}`,
        entityType: 'COMPANY',
        entityReference: updated.name,
        entityId: updated.id,
        previousValues: { commercialStatus: existing.commercialStatus, status: existing.status },
        newValues: { commercialStatus: nextCommStatus, reason: nextCommReason },
        reason: nextCommReason || `Status comercial alterado para ${nextCommStatus}`,
        authorUserId: req.user!.id,
        authorName: req.user!.name || 'SuperAdmin',
        authorRole: 'SUPER_ADMIN',
        ipAddress: req.ip || null,
      });
    }

    const refreshed = await prisma.company.findUniqueOrThrow({ where: { id: updated.id } });
    res.json(await sanitizeCompanyForSuperAdmin(refreshed));
  } catch (error: any) {
    if (sendVaultUnavailableIfApplicable(res, error)) return;
    if (error?.status) {
      res.status(error.status).json({ error: error.message });
      return;
    }
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
    const nextActive = !company.isActive;
    const updated = await prisma.company.update({
      where: { id: id as string },
      data: {
        isActive: nextActive,
        status: nextActive ? 'ACTIVE' : 'SUSPENDED',
        commercialStatus: nextActive ? 'ACTIVE' : 'SUSPENDED',
      },
    });
    res.json(await sanitizeCompanyForSuperAdmin(updated));
  } catch (error) {
    if (sendVaultUnavailableIfApplicable(res, error)) return;
    console.error('Error toggling company:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// APIs EXCLUSIVAS POR EMPRESA (ASAAS/SERASA E GEMINI) + TESTAR CONEXÃO REAL
// ============================================================================

router.get('/companies/:id/integrations', authenticateToken, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const company = await prisma.company.findUnique({ where: { id: String(req.params.id) } });
    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada.' });
    }
    const sanitized = await sanitizeCompanyForSuperAdmin(company, { rethrowVaultError: true });
    return res.json({
      companyId: company.id,
      companyName: company.tradeName || company.name,
      ...sanitized.integrationsSummary,
    });
  } catch (error) {
    if (sendVaultUnavailableIfApplicable(res, error)) return;
    console.error('Error reading company integrations:', error);
    return res.status(500).json({ error: 'Erro ao consultar integrações da empresa.' });
  }
});

router.put('/companies/:id/integrations/gemini', authenticateToken, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const company = await prisma.company.findUnique({ where: { id: String(req.params.id) } });
    if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });

    const result = await setExclusiveCompanyGeminiKey({
      companyId: company.id,
      apiKey: req.body?.apiKey ?? null,
      actorUserId: req.user!.id,
      actorName: req.user!.name || 'SuperAdmin',
      ipAddress: req.ip || null,
    });

    return res.json({ success: true, ...result });
  } catch (error: any) {
    if (sendVaultUnavailableIfApplicable(res, error)) return;
    console.error('Error updating company Gemini key:', error);
    return res.status(500).json({ error: error.message || 'Erro ao salvar chave Gemini da empresa.' });
  }
});

router.put('/companies/:id/integrations/asaas', authenticateToken, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const company = await prisma.company.findUnique({ where: { id: String(req.params.id) } });
    if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });

    const env = String(req.body?.environment || 'SANDBOX').toUpperCase() === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX';
    const result = await setExclusiveCompanyAsaasKey({
      companyId: company.id,
      apiKey: req.body?.apiKey ?? null,
      environment: env,
      accountName: req.body?.accountName || null,
      actorUserId: req.user!.id,
      actorName: req.user!.name || 'SuperAdmin',
      ipAddress: req.ip || null,
    });

    return res.json({ success: true, ...result });
  } catch (error: any) {
    if (sendVaultUnavailableIfApplicable(res, error)) return;
    console.error('Error updating company Asaas key:', error);
    return res.status(500).json({ error: error.message || 'Erro ao salvar chave Asaas da empresa.' });
  }
});

router.post('/companies/:id/integrations/gemini/test', authenticateToken, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const company = await prisma.company.findUnique({ where: { id: String(req.params.id) } });
    if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });

    const testRes = await testCompanyGeminiConnection({
      companyId: company.id,
      actorUserId: req.user!.id,
      actorName: req.user!.name || 'SuperAdmin',
      ipAddress: req.ip || null,
    });

    return res.json(testRes);
  } catch (error: any) {
    if (sendVaultUnavailableIfApplicable(res, error)) return;
    console.error('Error testing Gemini connection:', error);
    return res.status(500).json({ error: error.message || 'Erro ao testar conexão Gemini.' });
  }
});

router.post('/companies/:id/integrations/asaas/test', authenticateToken, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const company = await prisma.company.findUnique({ where: { id: String(req.params.id) } });
    if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });

    const testRes = await testCompanyAsaasConnection({
      companyId: company.id,
      actorUserId: req.user!.id,
      actorName: req.user!.name || 'SuperAdmin',
      requestedEnv: req.body?.environment,
      ipAddress: req.ip || null,
    });

    return res.json(testRes);
  } catch (error: any) {
    if (sendVaultUnavailableIfApplicable(res, error)) return;
    console.error('Error testing Asaas connection:', error);
    return res.status(500).json({ error: error.message || 'Erro ao testar conexão Asaas.' });
  }
});

router.get('/companies/:id/api-usage', authenticateToken, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const summary = await getCompanyMonthlyApiUsageSummary(
      String(req.params.id),
      typeof req.query.yearMonth === 'string' ? req.query.yearMonth : undefined
    );
    return res.json(summary);
  } catch (error: any) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Error reading company API usage:', error);
    return res.status(500).json({ error: error.message || 'Erro ao consultar consumo de APIs.' });
  }
});

router.patch('/companies/:id/api-usage-limits', authenticateToken, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const updated = await updateCompanyApiUsageLimits(String(req.params.id), req.body || {});
    const summary = await getCompanyMonthlyApiUsageSummary(String(req.params.id));
    return res.json({
      success: true,
      company: updated,
      usage: summary,
    });
  } catch (error: any) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Error updating company API usage limits:', error);
    return res.status(500).json({ error: error.message || 'Erro ao atualizar metas mensais de API.' });
  }
});

// ============================================================================
// CONFIGURAÇÃO DETALHADA DA BUSCA DE EVENTOS IA POR EMPRESA (SUPERADMIN)
// ============================================================================

router.get('/companies/:id/event-search-config', authenticateToken, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const company = await prisma.company.findUnique({ where: { id: String(req.params.id) } });
    if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });

    const config = await getCompanyEventSearchConfig(company.id);
    return res.json(config);
  } catch (error: any) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Error reading company event search config:', error);
    return res.status(500).json({ error: error.message || 'Erro ao consultar configuração de Eventos IA.' });
  }
});

router.put('/companies/:id/event-search-config', authenticateToken, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const company = await prisma.company.findUnique({ where: { id: String(req.params.id) } });
    if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });

    const updated = await upsertCompanyEventSearchConfig({
      companyId: company.id,
      payload: req.body || {},
      actorUserId: req.user!.id,
      actorName: req.user!.name || 'SuperAdmin',
      actorRole: 'SUPER_ADMIN',
      ipAddress: req.ip || null,
    });

    clearCompanyCityScoutCache(company.id);
    await prisma.stateRadarCache.deleteMany({
      where: { state: { contains: `:${company.id}:` } },
    });

    return res.json(updated);
  } catch (error: any) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Error saving company event search config:', error);
    return res.status(500).json({ error: error.message || 'Erro ao salvar configuração de Eventos IA.' });
  }
});

router.post('/companies/:id/event-search-config/reset', authenticateToken, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const company = await prisma.company.findUnique({ where: { id: String(req.params.id) } });
    if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });

    const reset = await resetCompanyEventSearchConfig({
      companyId: company.id,
      actorUserId: req.user!.id,
      actorName: req.user!.name || 'SuperAdmin',
      actorRole: 'SUPER_ADMIN',
      ipAddress: req.ip || null,
    });

    clearCompanyCityScoutCache(company.id);
    await prisma.stateRadarCache.deleteMany({
      where: { state: { contains: `:${company.id}:` } },
    });

    return res.json(reset);
  } catch (error: any) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Error resetting company event search config:', error);
    return res.status(500).json({ error: error.message || 'Erro ao restaurar padrão de Eventos IA.' });
  }
});

// ============================================================================
// CONFIGURAÇÃO OPERACIONAL POR EMPRESA (COMISSÕES + LOGO + SAC + QR CODE)
// ============================================================================

router.get('/companies/:id/operational-config', authenticateToken, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const company = await prisma.company.findUnique({ where: { id: String(req.params.id) } });
    if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });

    const config = await getCompanyOperationalConfig(company.id);
    return res.json(config);
  } catch (error: any) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Error reading company operational config:', error);
    return res.status(500).json({ error: error.message || 'Erro ao consultar configuração operacional.' });
  }
});

router.put('/companies/:id/operational-config', authenticateToken, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const company = await prisma.company.findUnique({ where: { id: String(req.params.id) } });
    if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });

    const updated = await upsertCompanyOperationalConfig({
      companyId: company.id,
      payload: req.body || {},
      actorUserId: req.user!.id,
      actorName: req.user!.name || 'SuperAdmin',
      actorRole: 'SUPER_ADMIN',
      ipAddress: req.ip || null,
    });

    return res.json(updated);
  } catch (error: any) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Error updating company operational config:', error);
    return res.status(500).json({ error: error.message || 'Erro ao salvar configuração operacional.' });
  }
});

router.post(
  '/companies/:id/operational-config/logo',
  authenticateToken,
  requireSuperAdmin,
  safeUpload(upload.single('logo')),
  async (req: AuthRequest, res: Response) => {
    try {
      const company = await prisma.company.findUnique({ where: { id: String(req.params.id) } });
      if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });
      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo de logo enviado (campo "logo").' });
      }

      const fileKey =
        (req.file as any).key ||
        (req.file.filename ? `${req.user?.companyId || company.id}/${req.file.filename}` : null);
      const rawUrl = getUploadedFileUrl(req.file);
      let publicLogoUrl = rawUrl;

      if (!publicLogoUrl || publicLogoUrl.startsWith('/api/upload/file/')) {
        const cleanFileName = fileKey ? path.basename(String(fileKey)) : req.file.filename;
        const folderCompany =
          fileKey && String(fileKey).includes('/') ? String(fileKey).split('/')[0] : company.id;
        publicLogoUrl = `/api/company/public/logo/${encodeURIComponent(folderCompany)}/${encodeURIComponent(cleanFileName)}`;
      }

      const updated = await upsertCompanyOperationalConfig({
        companyId: company.id,
        payload: { companyLogoUrl: publicLogoUrl },
        actorUserId: req.user!.id,
        actorName: req.user!.name || 'SuperAdmin',
        actorRole: 'SUPER_ADMIN',
        ipAddress: req.ip || null,
      });

      return res.json({
        logoUrl: updated.companyLogoUrl,
        config: updated,
      });
    } catch (error: any) {
      if (error?.status) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error('Error uploading company logo (SuperAdmin):', error);
      return res.status(500).json({ error: error.message || 'Erro ao salvar logo da empresa.' });
    }
  }
);

// ============================================================================
// FATURAMENTO LUMORA EM REGIME DE CAIXA REAL PAGO (SUPERADMIN)
// ============================================================================

router.get('/billing/preview', authenticateToken, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = String(req.query.companyId || '').trim();
    if (!companyId) return res.status(400).json({ error: 'companyId é obrigatório.' });
    const competence = String(req.query.competence || '').trim() || getCompetenceForDate(new Date());

    const result = await previewOrGetCompanyStatement(
      { companyId, competence, useCompanyBpsIfNoRate: true },
      prisma
    );
    return res.json(result);
  } catch (error: any) {
    return res.status(error?.status || 500).json({ error: error.message || 'Erro ao calcular caixa real.' });
  }
});

router.get('/billing/overview', authenticateToken, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const competence = (req.query.competence as string | undefined)?.trim() || getCompetenceForDate(new Date());
    const companyId = (req.query.companyId as string | undefined)?.trim();
    const result = await listPlatformStatementsOverview(
      { competence, companyId, useCompanyBpsIfNoRate: true },
      prisma
    );
    return res.json(result);
  } catch (error: any) {
    return res.status(error?.status || 500).json({ error: error.message || 'Erro ao carregar faturamento.' });
  }
});

// ============================================================================
// MODO SUPORTE AUDITADO: "ACESSAR COMO ADMIN (SUPORTE)"
// ============================================================================

router.post('/companies/:companyId/support-login', authenticateToken, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = String(req.params.companyId || '').trim();
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada.' });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ error: 'JWT_SECRET não configurado.' });
    }

    const reason =
      typeof req.body?.reason === 'string' && req.body.reason.trim().length >= 3
        ? req.body.reason.trim()
        : 'Atendimento e suporte operacional SuperAdmin no painel Admin da empresa';

    const audit = await recordOperationalAuditEvent({
      companyId: company.id,
      category: 'SUPPORT',
      action: 'SUPERADMIN_SUPPORT_SESSION_STARTED',
      entityType: 'COMPANY',
      entityReference: company.name,
      entityId: company.id,
      previousValues: null,
      newValues: {
        supportAdminId: req.user!.id,
        supportAdminName: req.user!.name || 'SuperAdmin',
      },
      reason,
      authorUserId: req.user!.id,
      authorName: req.user!.name || 'SuperAdmin',
      authorRole: 'SUPER_ADMIN',
      ipAddress: req.ip || null,
    });

    const supportToken = jwt.sign(
      {
        id: req.user!.id,
        supportAdminId: req.user!.id,
        companyId: company.id,
        isSuperAdminSupportSession: true,
        supportAuditId: audit.event.id,
      },
      secret,
      { expiresIn: '2h' }
    );

    return res.json({
      success: true,
      token: supportToken,
      auditEventId: audit.event.id,
      company: {
        id: company.id,
        name: company.tradeName || company.name,
        legalName: company.name,
        commercialStatus: company.commercialStatus || company.status,
        commercialStatusReason: company.commercialStatusReason || null,
      },
    });
  } catch (error: any) {
    console.error('Error starting SuperAdmin support login:', error);
    return res.status(500).json({ error: error.message || 'Erro ao iniciar Modo Suporte.' });
  }
});

router.post('/support-logout', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.isTemporarySupportSession && req.user?.companyId) {
      await recordOperationalAuditEvent({
        companyId: req.user.companyId,
        category: 'SUPPORT',
        action: 'SUPERADMIN_SUPPORT_SESSION_ENDED',
        entityType: 'COMPANY',
        entityReference: req.user.companyId,
        entityId: req.user.companyId,
        previousValues: null,
        newValues: { endedAt: new Date().toISOString() },
        reason: 'Retorno explícito do Modo Suporte ao SuperAdmin',
        authorUserId: req.user.actorId || req.user.id,
        authorName: req.user.name || 'SuperAdmin',
        authorRole: 'SUPER_ADMIN',
        ipAddress: req.ip || null,
      });
    }
    return res.json({ success: true });
  } catch {
    return res.json({ success: true });
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
