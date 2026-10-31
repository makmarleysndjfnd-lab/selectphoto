import { Router, Response } from 'express';
import { authenticateToken, AuthRequest, requireAdmin, requireSuperAdmin } from '../middleware/authMiddleware';
import { generateBackupJson } from '../services/backupService';
import {
  assertGlobalDumpDownloadForbidden,
  assertWebRestoreForbidden,
} from '../services/continuityAuditService';

const router = Router();

// Geração e Download de Backup
// Super Admin é BLOQUEADO de baixar dump global por HTTP (política de prevenção contra exfiltração de dados).
// Sessões de suporte são BLOQUEADAS de baixar backups.
// Admin de empresa pode baixar apenas os dados sanitizados da sua própria empresa.
router.get('/download', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // 1. Sessão de suporte jamais pode baixar backups
    if (req.user?.role === 'SUPPORT_AUTHORIZED' || req.user?.isTemporarySupportSession) {
      res.status(403).json({
        error: 'SUPPORT_BACKUP_FORBIDDEN',
        message: 'Sessões de suporte não têm autorização para baixar backups de dados.',
      });
      return;
    }

    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';
    const targetCompanyId = req.user?.companyId || undefined;

    // 2. Bloqueio de download GLOBAL em todos os caminhos HTTP (inclusive rotas legadas)
    if (isSuperAdmin || !targetCompanyId) {
      assertGlobalDumpDownloadForbidden();
    }

    // 3. Exportação sanitizada de dados da própria empresa para o administrador local
    const backupJsonString = await generateBackupJson(targetCompanyId);
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `backup-selectphoto-empresa-${targetCompanyId}-${dateStr}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(backupJsonString);
  } catch (error: any) {
    if (error.status === 403 || error.code === 'GLOBAL_DUMP_DOWNLOAD_FORBIDDEN') {
      res.status(403).json({
        error: error.code || 'GLOBAL_DUMP_DOWNLOAD_FORBIDDEN',
        message: error.message,
      });
      return;
    }
    console.error('Erro ao baixar backup sanitizado da empresa:', error);
    res.status(500).json({ error: 'Erro ao gerar backup' });
  }
});

// Restauração de Banco Integral - Restrita a procedimentos de infraestrutura via CLI
// O bloqueio de restauração HTTP vale para todas as rotas (novas e legadas)
router.post('/restore', authenticateToken, requireSuperAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    assertWebRestoreForbidden();
  } catch (error: any) {
    res.status(403).json({
      error: error.code || 'WEB_RESTORE_FORBIDDEN',
      message: error.message,
    });
  }
});

export default router;
