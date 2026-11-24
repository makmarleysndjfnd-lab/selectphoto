import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { upload, safeUpload, getUploadedFileUrl, s3 } from '../middleware/upload';
import { isExternalServicesDisabled } from '../utils/externalServices';
import { prisma } from '../services/prisma';
import {
  DEFAULT_WHATSAPP_TEMPLATES,
  getCompanyOperationalConfig,
  listSellerCommissionOverrides,
  renderWhatsAppTemplate,
  upsertCompanyOperationalConfig,
  upsertSellerCommissionOverride,
} from '../services/companyOperationalConfigService';

const router = Router();
const uploadDir = path.resolve(__dirname, '../../uploads');

function resolveAuthorizedCompanyScope(req: AuthRequest, res: Response): string | null {
  const role = String(req.user?.role || '').toUpperCase();
  if (!['ADMIN', 'COMPANY_ADMIN', 'SUPER_ADMIN'].includes(role)) {
    res.status(403).json({
      error: 'Acesso restrito a administradores da empresa.',
    });
    return null;
  }

  const ownCompanyId = req.user?.companyId ? String(req.user.companyId) : '';
  const requestedCompanyId =
    typeof req.query.companyId === 'string'
      ? req.query.companyId.trim()
      : typeof req.body?.companyId === 'string'
        ? req.body.companyId.trim()
        : '';

  if (role !== 'SUPER_ADMIN') {
    if (!ownCompanyId) {
      res.status(403).json({ error: 'Empresa do usuário não identificada.' });
      return null;
    }
    if (requestedCompanyId && requestedCompanyId !== ownCompanyId) {
      res.status(403).json({
        error: 'Isolamento multi-tenant: proibido acessar configuração de outra empresa.',
      });
      return null;
    }
  }

  const targetCompanyId =
    role === 'SUPER_ADMIN' && requestedCompanyId ? requestedCompanyId : ownCompanyId;
  if (!targetCompanyId) {
    res.status(400).json({ error: 'companyId é obrigatório.' });
    return null;
  }
  return targetCompanyId;
}

// GET /api/company/whatsapp-templates
// Leitura segura (sem dados sensíveis de comissão) para fluxos do vendedor/admin (Cobrança, Vales e Pós-Venda)
router.get('/whatsapp-templates', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      res.status(403).json({ error: 'Empresa do usuário não identificada.' });
      return;
    }
    const [cfg, company] = await Promise.all([
      getCompanyOperationalConfig(companyId),
      prisma.company.findUnique({
        where: { id: companyId },
        select: { name: true, tradeName: true, companyPixKey: true, companyPixKeyType: true },
      }),
    ]);

    const rawName = String(company?.tradeName || company?.name || '').trim();
    const companyDisplayName =
      rawName && rawName !== 'Select Photo Default' ? rawName : 'Lumora';

    res.json({
      companyId,
      companyDisplayName,
      companyPixKey: company?.companyPixKey || null,
      companyPixKeyType: company?.companyPixKeyType || null,
      whatsappCreditCollectionTemplate:
        cfg.whatsappCreditCollectionTemplate || DEFAULT_WHATSAPP_TEMPLATES.creditCollection,
      whatsappAdvanceNoticeTemplate:
        cfg.whatsappAdvanceNoticeTemplate || DEFAULT_WHATSAPP_TEMPLATES.advanceNotice,
      whatsappPostSaleTemplate:
        cfg.whatsappPostSaleTemplate || DEFAULT_WHATSAPP_TEMPLATES.postSale,
      defaultTemplates: DEFAULT_WHATSAPP_TEMPLATES,
    });
  } catch (error) {
    console.error('Erro ao consultar modelos de WhatsApp:', error);
    res.status(500).json({ error: 'Erro ao consultar modelos de WhatsApp da empresa.' });
  }
});

// POST /api/company/operational-config/whatsapp-preview
router.post('/operational-config/whatsapp-preview', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = resolveAuthorizedCompanyScope(req, res);
    if (!companyId) return;

    const cfg = await getCompanyOperationalConfig(companyId);
    const kind = String(req.body?.kind || 'CREDIT_COLLECTION').trim().toUpperCase();
    const fallback =
      kind === 'ADVANCE_NOTICE'
        ? DEFAULT_WHATSAPP_TEMPLATES.advanceNotice
        : kind === 'POST_SALE'
          ? DEFAULT_WHATSAPP_TEMPLATES.postSale
          : DEFAULT_WHATSAPP_TEMPLATES.creditCollection;
    const configuredTemplate =
      kind === 'ADVANCE_NOTICE'
        ? cfg.whatsappAdvanceNoticeTemplate
        : kind === 'POST_SALE'
          ? cfg.whatsappPostSaleTemplate
          : cfg.whatsappCreditCollectionTemplate;

    const templateToUse =
      typeof req.body?.template === 'string' && req.body.template.trim().length > 0
        ? req.body.template
        : configuredTemplate || fallback;

    const rendered = renderWhatsAppTemplate(
      templateToUse,
      {
        cliente: req.body?.cliente,
        valor: req.body?.valor,
        vencimento: req.body?.vencimento,
        pix: req.body?.pix,
        empresa: req.body?.empresa,
      },
      fallback
    );

    res.json({ kind, rendered });
  } catch (error) {
    console.error('Erro ao renderizar prévia WhatsApp:', error);
    res.status(500).json({ error: 'Erro ao renderizar prévia do WhatsApp.' });
  }
});

// GET /api/company/operational-config
router.get('/operational-config', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = resolveAuthorizedCompanyScope(req, res);
    if (!companyId) return;

    const config = await getCompanyOperationalConfig(companyId);
    res.json(config);
  } catch (error: any) {
    if (error?.status) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error('Erro ao buscar configuração operacional da empresa:', error);
    res.status(500).json({ error: 'Erro ao consultar configuração operacional da empresa.' });
  }
});

// PUT /api/company/operational-config
router.put('/operational-config', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = resolveAuthorizedCompanyScope(req, res);
    if (!companyId) return;

    const updated = await upsertCompanyOperationalConfig({
      companyId,
      payload: req.body || {},
      actorUserId: req.user!.id,
      actorName: req.user!.name || 'Admin',
      actorRole: String(req.user!.role || 'ADMIN'),
      ipAddress: req.ip || null,
    });

    res.json(updated);
  } catch (error: any) {
    if (error?.status) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error('Erro ao salvar configuração operacional da empresa:', error);
    res.status(500).json({ error: 'Erro ao salvar configuração operacional da empresa.' });
  }
});

// GET /api/company/operational-config/seller-overrides
router.get('/operational-config/seller-overrides', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = resolveAuthorizedCompanyScope(req, res);
    if (!companyId) return;

    const data = await listSellerCommissionOverrides(companyId);
    res.json(data);
  } catch (error: any) {
    if (error?.status) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error('Erro ao listar exceções individuais de comissão:', error);
    res.status(500).json({ error: 'Erro ao listar exceções individuais de comissão.' });
  }
});

// PUT /api/company/operational-config/seller-overrides/:sellerId
router.put('/operational-config/seller-overrides/:sellerId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = resolveAuthorizedCompanyScope(req, res);
    if (!companyId) return;

    const updated = await upsertSellerCommissionOverride({
      companyId,
      sellerId: String(req.params.sellerId || '').trim(),
      payload: req.body || {},
      actorUserId: req.user!.id,
      actorName: req.user!.name || 'Admin',
      actorRole: String(req.user!.role || 'ADMIN'),
      ipAddress: req.ip || null,
    });

    res.json(updated);
  } catch (error: any) {
    if (error?.status) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error('Erro ao salvar exceção individual de comissão:', error);
    res.status(500).json({ error: 'Erro ao salvar exceção individual de comissão.' });
  }
});

// POST /api/company/operational-config/logo
router.post(
  '/operational-config/logo',
  authenticateToken,
  (req: AuthRequest, res: Response, next) => {
    const companyId = resolveAuthorizedCompanyScope(req, res);
    if (!companyId) return;
    (req as any).resolvedOperationalCompanyId = companyId;
    (req as any).resolvedUploadCompanyId = companyId;
    next();
  },
  safeUpload(upload.single('logo')),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId: string = (req as any).resolvedOperationalCompanyId;
      if (!req.file) {
        res.status(400).json({ error: 'Nenhum arquivo de logo enviado (campo "logo").' });
        return;
      }

      const fileKey =
        (req.file as any).key ||
        (req.file.filename ? `${companyId}/${req.file.filename}` : null);
      const rawUrl = getUploadedFileUrl(req.file);
      let publicLogoUrl = rawUrl;

      if (!publicLogoUrl || publicLogoUrl.startsWith('/api/upload/file/')) {
        const cleanFileName = fileKey ? path.basename(String(fileKey)) : req.file.filename;
        const folderCompany =
          fileKey && String(fileKey).includes('/')
            ? String(fileKey).split('/')[0]
            : companyId;
        publicLogoUrl = `/api/company/public/logo/${encodeURIComponent(folderCompany)}/${encodeURIComponent(cleanFileName)}`;
      }

      const updated = await upsertCompanyOperationalConfig({
        companyId,
        payload: { companyLogoUrl: publicLogoUrl },
        actorUserId: req.user!.id,
        actorName: req.user!.name || 'Admin',
        actorRole: String(req.user!.role || 'ADMIN'),
        ipAddress: req.ip || null,
      });

      const usingB2 =
        !isExternalServicesDisabled() &&
        Boolean(process.env.B2_KEY_ID && process.env.B2_APPLICATION_KEY);

      res.json({
        logoUrl: updated.companyLogoUrl,
        storageProvider: usingB2 ? 'BACKBLAZE_B2' : 'LOCAL_TEST_FALLBACK',
        storageKey: fileKey,
        config: updated,
      });
    } catch (error: any) {
      if (error?.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      console.error('Erro ao salvar logo da empresa:', error);
      res.status(500).json({ error: 'Erro ao realizar upload da logo da empresa.' });
    }
  }
);

// GET /api/company/public/logo/:companyId/:filename
// Leitura pública somente da logo institucional exibida no comprovante QR da venda
router.get('/public/logo/:companyId/:filename', async (req, res: Response) => {
  try {
    const companyId = String(req.params.companyId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const filename = path.basename(String(req.params.filename || ''));
    if (!companyId || !filename) {
      res.status(404).json({ error: 'Logo não encontrada.' });
      return;
    }

    const ext = path.extname(filename).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
    };
    const contentType = mimeMap[ext];
    if (!contentType) {
      res.status(403).json({ error: 'Formato de arquivo não permitido.' });
      return;
    }

    const localFilePath = path.join(uploadDir, companyId, filename);
    if (fs.existsSync(localFilePath)) {
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      fs.createReadStream(localFilePath).pipe(res);
      return;
    }

    if (!isExternalServicesDisabled() && process.env.B2_BUCKET_NAME) {
      const command = new GetObjectCommand({
        Bucket: process.env.B2_BUCKET_NAME,
        Key: `${companyId}/${filename}`,
      });
      const response = await s3.send(command);
      if (response.Body) {
        res.setHeader('Content-Type', response.ContentType || contentType);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        (response.Body as any).pipe(res);
        return;
      }
    }

    res.status(404).json({ error: 'Logo não encontrada.' });
  } catch (err) {
    console.error('Erro ao servir logo pública da empresa:', err);
    res.status(404).json({ error: 'Logo não encontrada.' });
  }
});

export default router;
