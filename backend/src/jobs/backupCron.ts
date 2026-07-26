import cron from 'node-cron';
import { generateBackupJson } from '../services/backupService';
import { s3 } from '../middleware/upload';
import { PutObjectCommand } from '@aws-sdk/client-s3';

export const backupCron = async () => {
  try {
    console.log('[CRON] Iniciando backup geral do banco de dados...');
    const backupJsonString = await generateBackupJson();
    
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `backups/backup-selectphoto-${dateStr}.json`;

    const command = new PutObjectCommand({
      Bucket: process.env.B2_BUCKET_NAME || 'selectphoto-comprovantes-app',
      Key: filename,
      Body: backupJsonString,
      ContentType: 'application/json'
    });

    await s3.send(command);
    console.log(`[CRON] Backup salvo com sucesso no B2: ${filename}`);
  } catch (error) {
    console.error('[CRON] Erro ao fazer backup geral:', error);
  }
};

// Configura para rodar às 03:00 da manhã, todos os dias
export const initBackupCron = () => {
  cron.schedule('0 3 * * *', () => {
    backupCron();
  }, {
    timezone: 'America/Sao_Paulo'
  });
  console.log('⏳ Cron job de backup geral agendado para 03:00 AM (BRT).');
};
