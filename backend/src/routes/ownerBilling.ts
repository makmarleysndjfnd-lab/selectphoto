import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import {
  authenticateToken,
  requireCapability,
  requireStepUpAuth,
  AuthRequest,
} from '../middleware/authMiddleware';
import { getCompetenceForDate, getCompetenceRange } from '../services/monthlyCreditClosingService';
import {
  STORE_BILLING_POLICY_METADATA,
  previewOrGetCompanyStatement,
  closeCompanyMonthlyStatement,
  recordStatementAdjustmentOrReturnCredit,
  recordStatementManualPayment,
  listPlatformStatementsOverview,
  formatStatementResponse,
} from '../services/platformBillingService';
import {
  listOperationalAuditEvents,
  listOperationalReviewAlerts,
  resolveOperationalReviewAlert,
} from '../services/operationalAuditService';
import {
  recordPlatformCostEntry,
  getPlatformCostsAndMarginPanel,
  PROVIDER_BILLING_CAPABILITIES,
} from '../services/platformCostsService';

const router = Router();
const prisma = new PrismaClient();

// ============================================================================
// 1. CONSULTA SELF-SERVICE DO DEMONSTRATIVO PELA PRÓPRIA EMPRESA (SOMENTE LEITURA)
//    Sem CPF, sem fotos, sem dados das crianças, sem links de pagamento no app.
// ============================================================================

router.get(
  '/my-company-statements',
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const userRole = req.user?.role;
      const userCompanyId = req.user?.companyId;

      if (!userRole || !['SUPER_ADMIN', 'COMPANY_ADMIN', 'ADMIN'].includes(userRole)) {
        return res.status(403).json({
          error: 'Acesso restrito a administradores da empresa.',
        });
      }

      if (!userCompanyId) {
        return res.status(404).json({
          error: 'Usuário não está vinculado a uma empresa ativa.',
        });
      }

      const requestedCompanyId = req.query.companyId as string | undefined;
      if (requestedCompanyId && requestedCompanyId !== userCompanyId) {
        return res.status(403).json({
          error: 'Acesso negado: cada empresa consulta exclusivamente o seu próprio demonstrativo.',
        });
      }

      const competenceQuery = (req.query.competence as string | undefined)?.trim();
      const targetCompetence = competenceQuery || getCompetenceForDate(new Date());
      getCompetenceRange(targetCompetence);

      const closedStatements = await prisma.platformMonthlyStatement.findMany({
        where: { companyId: userCompanyId },
        include: {
          company: { select: { id: true, name: true, tradeName: true } },
          appliedAdjustments: { orderBy: { createdAt: 'asc' } },
          payments: { orderBy: { paidAt: 'asc' } },
        },
        orderBy: [{ competence: 'desc' }],
      });

      const currentView = await previewOrGetCompanyStatement(
        {
          companyId: userCompanyId,
          competence: targetCompetence,
          forCompanySelfService: true,
        },
        prisma
      );

      return res.json({
        companyId: userCompanyId,
        selectedCompetence: targetCompetence,
        storeBillingPolicy: STORE_BILLING_POLICY_METADATA,
        privacyGuarantee: {
          exposesChildData: false,
          exposesPhotos: false,
          exposesBuyerCpfOrPhone: false,
        },
        selectedCompetenceDetail: currentView,
        closedHistory: closedStatements.map((s) =>
          formatStatementResponse(s, { forCompanySelfService: true })
        ),
      });
    } catch (error: any) {
      if (error?.message?.includes('competência')) {
        return res.status(400).json({ error: error.message });
      }
      console.error('Erro ao consultar demonstrativo da própria empresa:', error);
      return res.status(500).json({ error: 'Erro ao consultar demonstrativo da empresa.' });
    }
  }
);

router.get(
  '/my-company-statements/:competence',
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const userRole = req.user?.role;
      const userCompanyId = req.user?.companyId;

      if (!userRole || !['SUPER_ADMIN', 'COMPANY_ADMIN', 'ADMIN'].includes(userRole)) {
        return res.status(403).json({
          error: 'Acesso restrito a administradores da empresa.',
        });
      }

      if (!userCompanyId) {
        return res.status(404).json({
          error: 'Usuário não está vinculado a uma empresa ativa.',
        });
      }

      const competence = String(req.params.competence || '').trim();
      const detail = await previewOrGetCompanyStatement(
        {
          companyId: userCompanyId,
          competence,
          forCompanySelfService: true,
        },
        prisma
      );

      return res.json({
        companyId: userCompanyId,
        competence,
        storeBillingPolicy: STORE_BILLING_POLICY_METADATA,
        ...detail,
      });
    } catch (error: any) {
      if (error?.message?.includes('competência')) {
        return res.status(400).json({ error: error.message });
      }
      console.error('Erro ao consultar detalhe do demonstrativo da própria empresa:', error);
      return res.status(500).json({ error: 'Erro ao consultar demonstrativo.' });
    }
  }
);

// ============================================================================
// 2. CENTRAL DO PROPRIETÁRIO — DEMONSTRATIVOS MENSAIS DA TAXA VARIÁVEL LUMORA
// ============================================================================

router.get(
  '/billing/statements',
  authenticateToken,
  requireCapability('PLATFORM_FINANCE'),
  async (req: AuthRequest, res: Response) => {
    try {
      const competence = (req.query.competence as string | undefined)?.trim();
      const companyId = (req.query.companyId as string | undefined)?.trim();
      const status = (req.query.status as string | undefined)?.trim();

      const result = await listPlatformStatementsOverview(
        { competence, companyId, status },
        prisma
      );
      return res.json(result);
    } catch (error: any) {
      if (error?.message?.includes('competência')) {
        return res.status(400).json({ error: error.message });
      }
      console.error('Erro ao listar demonstrativos da plataforma:', error);
      return res.status(500).json({ error: 'Erro interno ao listar demonstrativos.' });
    }
  }
);

router.get(
  '/billing/statements/preview',
  authenticateToken,
  requireCapability('PLATFORM_FINANCE'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = String(req.query.companyId || '').trim();
      const competence =
        String(req.query.competence || '').trim() || getCompetenceForDate(new Date());

      if (!companyId) {
        return res.status(400).json({ error: 'companyId é obrigatório.' });
      }

      const result = await previewOrGetCompanyStatement(
        { companyId, competence, forCompanySelfService: false },
        prisma
      );
      return res.json(result);
    } catch (error: any) {
      const status = error?.status || (error?.message?.includes('competência') ? 400 : 500);
      return res.status(status).json({ error: error.message || 'Erro ao gerar prévia.' });
    }
  }
);

router.get(
  '/billing/statements/:id',
  authenticateToken,
  requireCapability('PLATFORM_FINANCE'),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id || '').trim();
      const statement = await prisma.platformMonthlyStatement.findUnique({
        where: { id },
        include: {
          company: { select: { id: true, name: true, tradeName: true, cnpj: true, status: true } },
          items: { orderBy: { saleDate: 'asc' } },
          appliedAdjustments: { orderBy: { createdAt: 'asc' } },
          payments: { orderBy: { paidAt: 'asc' } },
        },
      });
      if (!statement) {
        return res.status(404).json({ error: 'Demonstrativo mensal não encontrado.' });
      }
      return res.json({ statement: formatStatementResponse(statement) });
    } catch (error) {
      console.error('Erro ao buscar detalhe de demonstrativo:', error);
      return res.status(500).json({ error: 'Erro interno ao buscar demonstrativo.' });
    }
  }
);

router.post(
  '/billing/statements/close',
  authenticateToken,
  requireCapability('PLATFORM_FINANCE'),
  requireStepUpAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { companyId, competence, notes } = req.body;
      if (!companyId || !competence) {
        return res
          .status(400)
          .json({ error: 'companyId e competence (YYYY-MM) são obrigatórios.' });
      }

      const result = await closeCompanyMonthlyStatement(
        {
          companyId: String(companyId).trim(),
          competence: String(competence).trim(),
          closedByUserId: req.user!.id,
          closedByName: req.user!.name || 'Proprietário',
          notes,
          referenceDate: req.body?.referenceDate,
          ipAddress: req.ip || req.socket.remoteAddress || undefined,
        },
        prisma
      );

      return res.status(result.created ? 201 : 200).json(result);
    } catch (error: any) {
      const status = error?.status || (error?.message?.includes('competência') ? 400 : 500);
      return res.status(status).json({
        error: error.message || 'Erro ao fechar demonstrativo mensal.',
        code: error?.code,
        unclosedCompetence: error?.unclosedCompetence,
      });
    }
  }
);

router.post(
  '/billing/statements/adjustments',
  authenticateToken,
  requireCapability('PLATFORM_FINANCE'),
  requireStepUpAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        companyId,
        idempotencyKey,
        type,
        originSaleId,
        returnedBaseCents,
        manualAmountCents,
        appliedCompetence,
        reason,
      } = req.body;

      if (!companyId || !type || !idempotencyKey) {
        return res.status(400).json({
          error: 'companyId, type e idempotencyKey são obrigatórios.',
        });
      }

      const result = await recordStatementAdjustmentOrReturnCredit(
        {
          companyId: String(companyId).trim(),
          idempotencyKey: String(idempotencyKey).trim(),
          type,
          originSaleId: originSaleId ? String(originSaleId).trim() : undefined,
          returnedBaseCents:
            returnedBaseCents !== undefined && returnedBaseCents !== null
              ? Number(returnedBaseCents)
              : undefined,
          manualAmountCents:
            manualAmountCents !== undefined && manualAmountCents !== null
              ? Number(manualAmountCents)
              : undefined,
          appliedCompetence: appliedCompetence
            ? String(appliedCompetence).trim()
            : undefined,
          reason: String(reason || ''),
          authorUserId: req.user!.id,
          authorName: req.user!.name || 'Proprietário',
          ipAddress: req.ip || req.socket.remoteAddress || undefined,
        },
        prisma
      );

      return res.status(result.created ? 201 : 200).json(result);
    } catch (error: any) {
      const status = error?.status || 500;
      return res.status(status).json({
        error: error.message || 'Erro ao registrar ajuste/devolução no demonstrativo.',
        code: error?.code,
      });
    }
  }
);

router.post(
  '/billing/statements/:id/payments',
  authenticateToken,
  requireCapability('PLATFORM_FINANCE'),
  requireStepUpAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const statementId = String(req.params.id || '').trim();
      const {
        idempotencyKey,
        amountCents,
        paymentMethod,
        paidAt,
        externalReference,
        notes,
      } = req.body;

      const result = await recordStatementManualPayment(
        {
          statementId,
          idempotencyKey: String(idempotencyKey || '').trim(),
          amountCents: Number(amountCents),
          paymentMethod,
          paidAt: paidAt ? new Date(paidAt) : undefined,
          externalReference,
          notes,
          recordedByUserId: req.user!.id,
          recordedByName: req.user!.name || 'Proprietário',
          ipAddress: req.ip || req.socket.remoteAddress || undefined,
        },
        prisma
      );

      return res.status(result.created ? 201 : 200).json(result);
    } catch (error: any) {
      const status = error?.status || 500;
      return res.status(status).json({
        error: error.message || 'Erro ao registrar conciliação manual do demonstrativo.',
        code: error?.code,
      });
    }
  }
);

// ============================================================================
// 3. TRILHA DE AUDITORIA OPERACIONAL GERAL (7 DOMÍNIOS, PII MASCARADA) E ALERTAS
// ============================================================================

router.get(
  '/billing/operational-audit',
  authenticateToken,
  requireCapability(['PLATFORM_FINANCE', 'CONTRACT_MANAGEMENT']),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = (req.query.companyId as string | undefined)?.trim();
      const category = (req.query.category as string | undefined)?.trim();
      const entityReference = (req.query.entityReference as string | undefined)?.trim();
      const startDate = req.query.startDate
        ? new Date(String(req.query.startDate))
        : undefined;
      const endDate = req.query.endDate ? new Date(String(req.query.endDate)) : undefined;
      const includeSimulation = req.query.includeSimulation === 'true';
      const limit = req.query.limit ? Number(req.query.limit) : 100;

      const result = await listOperationalAuditEvents(
        {
          companyId,
          category,
          entityReference,
          startDate,
          endDate,
          includeSimulation,
          limit,
        },
        prisma
      );

      return res.json(result);
    } catch (error) {
      console.error('Erro ao consultar auditoria operacional:', error);
      return res.status(500).json({ error: 'Erro interno ao consultar auditoria operacional.' });
    }
  }
);

router.get(
  '/billing/review-alerts',
  authenticateToken,
  requireCapability(['PLATFORM_FINANCE', 'CONTRACT_MANAGEMENT']),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = (req.query.companyId as string | undefined)?.trim();
      const status = (req.query.status as string | undefined)?.trim();
      const includeSimulation = req.query.includeSimulation === 'true';
      const limit = req.query.limit ? Number(req.query.limit) : 100;

      const result = await listOperationalReviewAlerts(
        { companyId, status, includeSimulation, limit },
        prisma
      );
      return res.json(result);
    } catch (error) {
      console.error('Erro ao consultar alertas de revisão:', error);
      return res.status(500).json({ error: 'Erro interno ao consultar alertas de revisão.' });
    }
  }
);

router.post(
  '/billing/review-alerts/:id/resolve',
  authenticateToken,
  requireCapability(['PLATFORM_FINANCE', 'CONTRACT_MANAGEMENT']),
  requireStepUpAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const alertId = String(req.params.id || '').trim();
      const { status, reviewNotes } = req.body;

      const updated = await resolveOperationalReviewAlert(
        {
          alertId,
          status,
          reviewNotes: String(reviewNotes || ''),
          reviewerUserId: req.user!.id,
          reviewerName: req.user!.name || 'Proprietário',
        },
        prisma
      );

      return res.json({ success: true, alert: updated });
    } catch (error: any) {
      return res.status(400).json({ error: error.message || 'Erro ao revisar alerta.' });
    }
  }
);

// ============================================================================
// 4. CUSTOS VERIFICADOS DA PLATAFORMA, RATEIO EXPLÍCITO E MARGEM REAL / ESTIMADA
// ============================================================================

router.get(
  '/billing/costs-and-margin',
  authenticateToken,
  requireCapability('PLATFORM_FINANCE'),
  async (req: AuthRequest, res: Response) => {
    try {
      const competence =
        String(req.query.competence || '').trim() || getCompetenceForDate(new Date());
      const includeSimulation = req.query.includeSimulation === 'true';

      const panel = await getPlatformCostsAndMarginPanel(
        { competence, includeSimulation },
        prisma
      );
      return res.json(panel);
    } catch (error: any) {
      if (error?.message?.includes('competência')) {
        return res.status(400).json({ error: error.message });
      }
      console.error('Erro ao consultar painel de custos e margem:', error);
      return res.status(500).json({ error: 'Erro interno ao consultar custos e margem.' });
    }
  }
);

router.post(
  '/billing/costs',
  authenticateToken,
  requireCapability('PLATFORM_FINANCE'),
  requireStepUpAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await recordPlatformCostEntry(
        {
          ...req.body,
          createdByUserId: req.user!.id,
          createdByName: req.user!.name || 'Proprietário',
          ipAddress: req.ip || req.socket.remoteAddress || undefined,
        },
        prisma
      );
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error: any) {
      const status = error?.status || (error?.message?.includes('competência') ? 400 : 500);
      return res.status(status).json({ error: error.message || 'Erro ao lançar custo.' });
    }
  }
);

// ============================================================================
// 5. CONFORMIDADE COM POLÍTICAS DE COBRANÇA DAS LOJAS (GOOGLE PLAY & APPLE)
// ============================================================================

router.get(
  '/billing/store-policies-status',
  authenticateToken,
  requireCapability(['PLATFORM_FINANCE', 'CONTRACT_MANAGEMENT']),
  async (_req: AuthRequest, res: Response) => {
    return res.json({
      storeBillingPolicy: STORE_BILLING_POLICY_METADATA,
      providerBillingCapabilities: PROVIDER_BILLING_CAPABILITIES,
      googlePlayAssessment: {
        policyReference: 'Google Play Payments Policy (9858738)',
        physicalPhotoProductsClassification:
          'Venda de bens físicos (álbuns/kits fotográficos impressos) entregues pelas empresas clientes — fora do faturamento de conteúdo digital do Google Play.',
        lumoraB2bSoftwareFeeClassification:
          'Remuneração contratual B2B entre PJ (empresa cliente e Lumora), apurada em demonstrativo informativo e liquidada integralmente fora do aplicativo, sem checkout in-app nem links externos de compra digital.',
      },
      appleAppStoreAssessment: {
        policyReferences: [
          'App Store Review Guideline 3.1.1 (In-App Purchase)',
          'App Store Review Guideline 3.1.3(e) (Goods and Services Outside of the App)',
          'App Store Review Guideline 3.1.3(f) (Free Stand-alone Apps / B2B Enterprise Companion)',
        ],
        physicalPhotoProductsClassification:
          'Bens físicos comercializados em campo pelas empresas clientes (Guideline 3.1.3(e)) — não utilizam IAP.',
        lumoraB2bSoftwareFeeClassification:
          'Acesso empresarial B2B contratado fora do app sem venda de assinatura/acesso digital dentro do aplicativo e sem botões/atalhos de pagamento externo.',
      },
      operationalSafeguards: {
        asaasLiveEnabled: false,
        inAppSaaSCheckoutEnabled: false,
        externalSaaSPaymentLinksInUi: false,
        automaticCompanyBlockingOnOverdue: false,
      },
    });
  }
);

export default router;

