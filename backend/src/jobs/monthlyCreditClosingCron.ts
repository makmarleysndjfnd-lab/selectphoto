import cron from 'node-cron';
import { recoverMissedMonthlyClosings } from '../services/monthlyCreditClosingService';

/**
 * Agendador da Apuração Mensal de Crediário (10% sobre parcelas posteriores).
 * Executa no dia 01 de cada mês às 00:05 (horário de Brasília) para fechar formalmente
 * a competência do mês anterior recém-encerrada.
 * Também executa recuperação preventiva na inicialização do servidor para apurar
 * meses passados que porventura tenham ficado pendentes por indisponibilidade.
 */
export function initMonthlyCreditClosingCron() {
  // 1. Recuperação preventiva imediata de competências encerradas perdidas
  recoverMissedMonthlyClosings()
    .then((recovered) => {
      if (recovered.length > 0) {
        console.log(`[MONTHLY_CLOSING_CRON] Recuperação inicial: ${recovered.length} fechamentos de competência processados.`);
      }
    })
    .catch((err) => {
      console.error('[MONTHLY_CLOSING_CRON] Erro na recuperação inicial de competências:', err?.message || err);
    });

  // 2. Cron job mensal: dia 1 às 00:05 BRT (America/Sao_Paulo)
  // Expressão cron: minuto 5, hora 0, dia 1, qualquer mês, qualquer dia da semana
  cron.schedule(
    '5 0 1 * *',
    async () => {
      console.log('[MONTHLY_CLOSING_CRON] Executando apuração automática de competência encerrada...');
      try {
        const results = await recoverMissedMonthlyClosings();
        console.log(`[MONTHLY_CLOSING_CRON] Apuração concluída com sucesso. Fechamentos processados: ${results.length}`);
      } catch (error: any) {
        console.error('[MONTHLY_CLOSING_CRON] Falha na apuração automática:', error?.message || error);
      }
    },
    {
      timezone: 'America/Sao_Paulo',
    }
  );

  console.log('⏳ Cron job de fechamento mensal do crediário agendado (Dia 1 às 00:05 BRT).');
}
