import cron from 'node-cron';
import { processAsaasSyncQueue } from '../services/asaasService';

let isProcessing = false;

/**
 * Inicializa o cron worker responsável por processar a fila persistente de tarefas bancárias do Asaas
 */
export const initAsaasQueueCron = () => {
  // Executa a cada 1 minuto para capturar tarefas atômicas e recuperar tarefas pendentes
  cron.schedule('*/1 * * * *', async () => {
    if (isProcessing) return;
    isProcessing = true;
    try {
      await processAsaasSyncQueue(20);
    } catch (err: any) {
      console.error('[CRON Asaas Queue] Erro ao processar fila do Asaas:', err?.message || err);
    } finally {
      isProcessing = false;
    }
  });
  console.log('⏳ Cron job de sincronização de fila bancária Asaas agendado (a cada 1 minuto).');
};
