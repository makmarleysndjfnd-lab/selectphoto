import { Router } from 'express';
import { authenticateToken, checkRole } from '../middleware/auth';
import { generateBackupJson } from '../services/backupService';

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

export default router;
