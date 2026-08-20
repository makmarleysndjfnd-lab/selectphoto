import { Router, Response } from 'express';
import { authenticateToken, AuthRequest, requireAdmin, requireSuperAdmin } from '../middleware/authMiddleware';
import { generateBackupJson, restoreBackupJson } from '../services/backupService';
import { getLatestOnlineBackupDate } from '../services/backupOnlineService';
import multer from 'multer';

const uploadMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});
const router = Router();

// Geração e Download de Backup
// Super Admin pode baixar global; Admin de empresa baixa apenas os dados da própria empresa
router.get('/download', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';
    const targetCompanyId = isSuperAdmin ? undefined : (req.user?.companyId || undefined);

    const backupJsonString = await generateBackupJson(targetCompanyId);
    const dateStr = new Date().toISOString().split('T')[0];
    const companySuffix = targetCompanyId ? `-${targetCompanyId}` : '-global';
    const filename = `backup-selectphoto${companySuffix}-${dateStr}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    res.send(backupJsonString);
  } catch (error) {
    console.error('Erro ao baixar backup:', error);
    res.status(500).json({ error: 'Erro ao gerar backup' });
  }
});

// Restauração de Banco Integral - Restrita EXCLUSIVAMENTE a SUPER_ADMIN
router.post('/restore', authenticateToken, requireSuperAdmin, uploadMem.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    // Desabilitar restore HTTP em produção por padrão, exigindo ativação explícita
    if (process.env.NODE_ENV === 'production' && process.env.ENABLE_HTTP_RESTORE !== 'true') {
      res.status(403).json({ error: 'Restauração HTTP está desabilitada em produção. Defina ENABLE_HTTP_RESTORE=true para habilitar.' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'Nenhum arquivo enviado.' });
      return;
    }

    const force = req.query.force === 'true';
    const fileContent = req.file.buffer.toString('utf-8');
    let backupData: any;

    try {
      backupData = JSON.parse(fileContent);
    } catch {
      res.status(400).json({ error: 'Arquivo de backup inválido (JSON corrompido).' });
      return;
    }

    // Verificação de integridade dos metadados
    if (!backupData._metadata || typeof backupData._metadata !== 'object') {
      res.status(400).json({ error: 'Arquivo inválido: metadados de backup ausentes.' });
      return;
    }

    // Verificação de data contra backup online
    if (!force) {
      const fileTimestamp = backupData._metadata?.timestamp;
      if (fileTimestamp) {
        const fileDate = new Date(fileTimestamp);
        const onlineDate = await getLatestOnlineBackupDate();
        if (onlineDate && onlineDate > fileDate) {
          res.status(409).json({ 
            error: 'O backup online é mais recente que o arquivo selecionado.',
            requiresForce: true 
          });
          return;
        }
      }
    }

    await restoreBackupJson(backupData);
    res.json({ message: 'Backup restaurado com sucesso!' });
  } catch (error: any) {
    console.error('Erro ao restaurar backup:', error);
    res.status(500).json({ error: error.message || 'Erro ao processar o arquivo de backup.' });
  }
});

export default router;
