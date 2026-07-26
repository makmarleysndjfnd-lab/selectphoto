import { Router } from 'express';
import { authenticateToken, checkRole } from '../middleware/auth';
import { generateBackupJson, restoreBackupJson } from '../services/backupService';
import { getLatestOnlineBackupDate } from '../services/backupOnlineService';
import multer from 'multer';

const uploadMem = multer({ storage: multer.memoryStorage() });
const router = Router();

// Apenas administradores podem gerar o backup
router.get('/download', authenticateToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const backupJsonString = await generateBackupJson();
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `backup-selectphoto-${dateStr}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    res.send(backupJsonString);
  } catch (error) {
    console.error('Erro ao baixar backup:', error);
    res.status(500).json({ error: 'Erro ao gerar backup' });
  }
});

router.post('/restore', authenticateToken, checkRole(['ADMIN']), uploadMem.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }

    const force = req.query.force === 'true';
    const fileContent = req.file.buffer.toString('utf-8');
    const backupData = JSON.parse(fileContent);

    // Verificação de data
    if (!force) {
      const fileTimestamp = backupData._metadata?.timestamp;
      if (fileTimestamp) {
        const fileDate = new Date(fileTimestamp);
        const onlineDate = await getLatestOnlineBackupDate();
        if (onlineDate && onlineDate > fileDate) {
          return res.status(409).json({ 
            error: 'O backup online é mais recente que o arquivo selecionado.',
            requiresForce: true 
          });
        }
      }
    }

    await restoreBackupJson(backupData);
    res.json({ message: 'Backup restaurado com sucesso!' });
  } catch (error) {
    console.error('Erro ao restaurar backup:', error);
    res.status(500).json({ error: 'Erro ao processar o arquivo de backup.' });
  }
});

export default router;
