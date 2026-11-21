import { Router, Response } from 'express';
import { prisma } from '../services/prisma';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import {
  AdvanceProfileRole,
  createDebitAdvance,
  getCompanyAdvanceConfig,
  getUserAdvanceStatement,
  listAdvancesByCompanyRole,
  normalizeProfileRole,
  settleAdvance,
  VALID_ADVANCE_CATEGORIES,
} from '../services/staffAdvanceService';

const router = Router();
const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'SUPERVISOR', 'OWNER'];

function isAdminRole(role?: string): boolean {
  return ADMIN_ROLES.includes(String(role || '').toUpperCase());
}

function parseAmountToCents(body: any): number {
  if (body?.amountCents !== undefined && body?.amountCents !== null) {
    const n = Number(body.amountCents);
    return Number.isFinite(n) ? Math.round(n) : 0;
  }
  if (body?.amount !== undefined && body?.amount !== null) {
    const n = Number(body.amount);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  }
  return 0;
}

// GET /api/advances?role=SELLER|PHOTOGRAPHER (Admin/Supervisor)
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdminRole(req.user?.role)) {
      return res.status(403).json({ error: 'Acesso restrito à administração.' });
    }
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: 'Empresa não identificada.' });
    }

    const rawRole = String(req.query.role || 'SELLER').trim().toUpperCase();
    if (!['SELLER', 'PHOTOGRAPHER', 'VENDEDOR', 'FOTOGRAFO'].includes(rawRole)) {
      return res.status(400).json({ error: 'Parâmetro role inválido. Use SELLER ou PHOTOGRAPHER.' });
    }

    const profileRole: AdvanceProfileRole = normalizeProfileRole(rawRole);
    const data = await listAdvancesByCompanyRole(companyId, profileRole);
    res.json(data);
  } catch (error: any) {
    console.error('Error listing advances:', error);
    res.status(500).json({ error: error.message || 'Falha ao consultar vales/pendências.' });
  }
});

// GET /api/advances/my — Extrato estritamente SOMENTE LEITURA do próprio profissional autenticado
router.get('/my', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.id;
    if (!companyId || !userId) {
      return res.status(403).json({ error: 'Sessão inválida.' });
    }

    const statement = await getUserAdvanceStatement(companyId, userId);
    if (!statement) {
      return res.status(404).json({ error: 'Usuário não encontrado na empresa.' });
    }

    res.json({
      readOnly: true,
      ...statement,
    });
  } catch (error: any) {
    console.error('Error loading own advance statement:', error);
    res.status(500).json({ error: error.message || 'Falha ao consultar seu extrato de vales.' });
  }
});

// GET /api/advances/user/:userId — Extrato imutável completo (Admin/Supervisor)
router.get('/user/:userId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdminRole(req.user?.role)) {
      return res.status(403).json({ error: 'Acesso restrito à administração.' });
    }
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: 'Empresa não identificada.' });
    }

    const userId = String(req.params.userId || '').trim();
    if (!userId) {
      return res.status(400).json({ error: 'userId é obrigatório.' });
    }

    const statement = await getUserAdvanceStatement(companyId, userId);
    if (!statement) {
      return res.status(404).json({ error: 'Profissional não encontrado na sua empresa.' });
    }

    res.json(statement);
  } catch (error: any) {
    console.error('Error loading user advance statement:', error);
    res.status(500).json({ error: error.message || 'Falha ao consultar extrato do profissional.' });
  }
});

// PATCH /api/advances/config — Ajusta limites configuráveis de alerta da empresa
router.patch('/config', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdminRole(req.user?.role)) {
      return res.status(403).json({ error: 'Acesso restrito à administração.' });
    }
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: 'Empresa não identificada.' });
    }

    const limitRaw = req.body?.advanceAlertLimitCents;
    const daysRaw = req.body?.advanceAlertDays;

    const data: { advanceAlertLimitCents?: number; advanceAlertDays?: number } = {};
    if (limitRaw !== undefined) {
      const limitCents = Math.round(Number(limitRaw));
      if (!Number.isFinite(limitCents) || limitCents < 0) {
        return res.status(400).json({ error: 'Limite de alerta inválido.' });
      }
      data.advanceAlertLimitCents = limitCents;
    }
    if (daysRaw !== undefined) {
      const days = Math.round(Number(daysRaw));
      if (!Number.isFinite(days) || days < 1 || days > 365) {
        return res.status(400).json({ error: 'Prazo de alerta em dias inválido (1..365).' });
      }
      data.advanceAlertDays = days;
    }

    await prisma.company.update({
      where: { id: companyId },
      data,
    });

    const updated = await getCompanyAdvanceConfig(companyId);
    res.json(updated);
  } catch (error: any) {
    console.error('Error updating advance config:', error);
    res.status(500).json({ error: error.message || 'Falha ao atualizar configuração de vales.' });
  }
});

// POST /api/advances — Lançar novo vale (DEBIT) (Admin/Supervisor)
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdminRole(req.user?.role)) {
      return res.status(403).json({ error: 'Somente a administração pode lançar vales.' });
    }
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: 'Empresa não identificada.' });
    }

    const {
      userId,
      profileRole: rawProfileRole,
      category,
      dueDate,
      notes,
      receiptUrl,
      receiptBase64,
      signatureBase64,
      batchId,
      closingReference,
    } = req.body;

    const targetUserId = String(userId || '').trim();
    if (!targetUserId) {
      return res.status(400).json({ error: 'Profissional (userId) é obrigatório.' });
    }

    const targetUser = await prisma.user.findFirst({
      where: { id: targetUserId, companyId },
      select: { id: true, role: true, name: true },
    });
    if (!targetUser) {
      return res.status(404).json({ error: 'Profissional não encontrado nesta empresa.' });
    }

    const amountCents = parseAmountToCents(req.body);
    if (amountCents <= 0) {
      return res.status(400).json({ error: 'O valor do vale deve ser maior que zero.' });
    }

    const normalizedCategory = String(category || 'PERSONAL_ADVANCE').trim().toUpperCase();
    if (!VALID_ADVANCE_CATEGORIES.includes(normalizedCategory as any) || normalizedCategory === 'SETTLEMENT') {
      return res.status(400).json({ error: `Categoria de débito inválida: ${category}` });
    }

    let validBatchId: string | null = null;
    if (batchId && String(batchId).trim()) {
      const batch = await prisma.bookBatch.findFirst({
        where: { id: String(batchId).trim(), companyId },
        select: { id: true },
      });
      if (!batch) {
        return res.status(404).json({ error: 'Lote informado não pertence à sua empresa.' });
      }
      validBatchId = batch.id;
    }

    let parsedDueDate: Date | null = null;
    if (dueDate && String(dueDate).trim()) {
      const d = new Date(String(dueDate).trim());
      if (isNaN(d.getTime())) {
        return res.status(400).json({ error: 'Data de vencimento inválida.' });
      }
      parsedDueDate = d;
    }

    const actor = req.user?.id
      ? await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } })
      : null;

    const profileRole: AdvanceProfileRole = rawProfileRole
      ? normalizeProfileRole(rawProfileRole)
      : normalizeProfileRole(targetUser.role);

    const resolvedReceipt =
      (typeof receiptUrl === 'string' && receiptUrl.trim()) ||
      (typeof receiptBase64 === 'string' && receiptBase64.trim()) ||
      null;

    const result = await createDebitAdvance({
      companyId,
      userId: targetUserId,
      profileRole,
      category: normalizedCategory,
      amountCents,
      dueDate: parsedDueDate,
      notes: typeof notes === 'string' ? notes : null,
      receiptUrl: resolvedReceipt,
      signatureBase64: typeof signatureBase64 === 'string' && signatureBase64.trim() ? signatureBase64.trim() : null,
      batchId: validBatchId,
      closingReference: typeof closingReference === 'string' ? closingReference : null,
      createdById: req.user?.id || null,
      createdByName: actor?.name || req.user?.role || 'Administrador',
    });

    const statement = await getUserAdvanceStatement(companyId, targetUserId);
    res.status(result.alreadyExisted ? 200 : 201).json({
      entry: result.entry,
      alreadyExisted: result.alreadyExisted,
      statement,
    });
  } catch (error: any) {
    if (error && error.status && error.message) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Error creating advance debit:', error);
    res.status(500).json({ error: error.message || 'Falha ao lançar vale.' });
  }
});

// POST /api/advances/settle — Abater parcial ou total (CREDIT) em transação Serializable
router.post('/settle', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdminRole(req.user?.role)) {
      return res.status(403).json({ error: 'Somente a administração pode abater ou quitar vales.' });
    }
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: 'Empresa não identificada.' });
    }

    const { userId, category, notes, receiptUrl, receiptBase64, batchId, closingReference } = req.body;
    const targetUserId = String(userId || '').trim();
    if (!targetUserId) {
      return res.status(400).json({ error: 'Profissional (userId) é obrigatório.' });
    }

    const amountCents = parseAmountToCents(req.body);
    if (amountCents <= 0) {
      return res.status(400).json({ error: 'O valor do abatimento deve ser maior que zero.' });
    }

    let validBatchId: string | null = null;
    if (batchId && String(batchId).trim()) {
      const batch = await prisma.bookBatch.findFirst({
        where: { id: String(batchId).trim(), companyId },
        select: { id: true },
      });
      if (!batch) {
        return res.status(404).json({ error: 'Lote informado não pertence à sua empresa.' });
      }
      validBatchId = batch.id;
    }

    const actor = req.user?.id
      ? await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } })
      : null;

    const resolvedReceipt =
      (typeof receiptUrl === 'string' && receiptUrl.trim()) ||
      (typeof receiptBase64 === 'string' && receiptBase64.trim()) ||
      null;

    const normalizedCategory =
      category && VALID_ADVANCE_CATEGORIES.includes(String(category).trim().toUpperCase() as any)
        ? String(category).trim().toUpperCase()
        : 'SETTLEMENT';

    const result = await settleAdvance({
      companyId,
      userId: targetUserId,
      amountCents,
      category: normalizedCategory,
      notes: typeof notes === 'string' ? notes : null,
      receiptUrl: resolvedReceipt,
      batchId: validBatchId,
      closingReference: typeof closingReference === 'string' ? closingReference : null,
      createdById: req.user?.id || null,
      createdByName: actor?.name || req.user?.role || 'Administrador',
    });

    const statement = await getUserAdvanceStatement(companyId, targetUserId);
    res.status(result.alreadyExisted ? 200 : 201).json({
      entry: result.entry,
      alreadyExisted: result.alreadyExisted,
      remainingOpenCents: result.remainingOpenCents,
      statement,
    });
  } catch (error: any) {
    if (error && error.status && error.message) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Error settling advance:', error);
    res.status(500).json({ error: error.message || 'Falha ao abater vale.' });
  }
});

export default router;
