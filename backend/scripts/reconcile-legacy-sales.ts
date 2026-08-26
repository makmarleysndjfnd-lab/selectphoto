/**
 * Script de Auditoria e Reconciliação de Vendas Legadas / Incompletas
 * 
 * REGRAS CRÍTICAS DE SEGURANÇA:
 * 1. Executa em MODO DRY-RUN por padrão.
 * 2. Nenhuma alteração de dados é feita sem as flags explícitas:
 *    --apply-live-changes --confirm-reconciliation=SIM
 * 3. TRAVA DE PRODUÇÃO: Bloqueado contra execução em produção ou URLs externas.
 * 4. Dados pessoais são totalmente mascarados nos relatórios (LGPD).
 */

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const defaultPrisma = new PrismaClient();

function maskString(str: string | null | undefined, visibleChars = 3): string {
  if (!str) return 'N/D';
  const clean = str.trim();
  if (clean.length <= visibleChars * 2) {
    return clean.length > 2 ? `${clean[0]}***${clean[clean.length - 1]}` : '***';
  }
  return `${clean.substring(0, visibleChars)}***${clean.substring(clean.length - visibleChars)}`;
}

function maskName(name: string | null | undefined): string {
  if (!name) return 'Nome Oculto';
  const parts = name.trim().split(/\s+/);
  return parts.map(p => (p.length > 2 ? `${p.substring(0, 2)}***` : '***')).join(' ');
}

export interface ReconciliationReport {
  timestamp: string;
  isDryRun: boolean;
  totalSalesCount: number;
  salesWithReceiptCount: number;
  salesWithoutReceiptCount: number;
  clientsWithSalesWithoutReceipt: number;
  clientsWithDuplicateSales: number;
  details: Array<{
    clientMaskedId: string;
    sequenceNumber: string;
    clientMaskedName: string;
    city: string;
    bookStatus: string;
    outcomeStatus: string;
    cityClosedAt: string | null;
    totalSales: number;
    salesWithReceipt: number;
    salesWithoutReceipt: number;
    sales: Array<{
      saleMaskedId: string;
      sellerMaskedName: string;
      value: number;
      date: string;
      hasReceipt: boolean;
      paymentStatus: string;
      status: string;
    }>;
    logisticsDiagnosis: string;
    suggestedAction: string;
    pendingDecision: string;
  }>;
  predictedBeforeAfter: {
    before: { totalSales: number; incompleteSales: number };
    afterPredicted: { totalSales: number; incompleteSales: number };
  };
}

export async function runReconciliationAnalysis(options?: {
  allowWrite?: boolean;
  prismaClient?: PrismaClient;
}): Promise<ReconciliationReport> {
  const prisma = options?.prismaClient || defaultPrisma;
  const isDryRun = !(options?.allowWrite === true);

  // Verificação de segurança: não permitir escrita acidental
  if (!isDryRun) {
    const dbUrl = (process.env.DATABASE_URL || '').toLowerCase();
    const isProd = process.env.NODE_ENV === 'production' ||
      dbUrl.includes('render.com') ||
      dbUrl.includes('supabase') ||
      dbUrl.includes('neon.tech') ||
      dbUrl.includes('oregon-postgres');

    if (isProd) {
      throw new Error(
        '🛑 BLOQUEIO DE SEGURANÇA: Execução com gravação estritamente proibida no banco de dados de produção.'
      );
    }
  }

  // 1. Contagens gerais agregadas
  const totalSales = await prisma.sale.count();
  const salesWithReceipt = await prisma.sale.count({ where: { receiptUrl: { not: null } } });
  const salesWithoutReceipt = await prisma.sale.count({ where: { receiptUrl: null } });

  // 2. Buscar todas as vendas sem comprovante agrupadas por ficha
  const incompleteSales = await prisma.sale.findMany({
    where: { receiptUrl: null },
    include: {
      client: true,
      seller: { select: { id: true, name: true } },
    },
    orderBy: { date: 'asc' },
  });

  const clientMap = new Map<string, typeof incompleteSales>();
  for (const sale of incompleteSales) {
    const list = clientMap.get(sale.clientId) || [];
    list.push(sale);
    clientMap.set(sale.clientId, list);
  }

  // Buscar todas as vendas das fichas afetadas para verificação de duplicidades
  const affectedClientIds = Array.from(clientMap.keys());
  const allSalesForAffectedClients = await prisma.sale.findMany({
    where: { clientId: { in: affectedClientIds } },
    include: {
      client: true,
      seller: { select: { id: true, name: true } },
    },
    orderBy: { date: 'asc' },
  });

  const allSalesByClient = new Map<string, typeof allSalesForAffectedClients>();
  for (const sale of allSalesForAffectedClients) {
    const list = allSalesByClient.get(sale.clientId) || [];
    list.push(sale);
    allSalesByClient.set(sale.clientId, list);
  }

  const details: ReconciliationReport['details'] = [];
  let clientsWithDuplicatesCount = 0;

  for (const clientId of affectedClientIds) {
    const clientSales = allSalesByClient.get(clientId) || [];
    const client = clientSales[0]?.client;
    if (!client) continue;

    const withRec = clientSales.filter((s) => Boolean(s.receiptUrl)).length;
    const withoutRec = clientSales.filter((s) => !s.receiptUrl).length;
    if (clientSales.length > 1) {
      clientsWithDuplicatesCount++;
    }

    const hasCompletedSale = withRec > 0;
    let logisticsDiagnosis = `bookStatus: ${client.bookStatus}; outcome: ${client.outcomeStatus}; cidadeFechada: ${Boolean(client.cityClosedAt)}`;
    let suggestedAction = '';
    let pendingDecision = '';

    if (withoutRec > 1 && !hasCompletedSale) {
      logisticsDiagnosis += ' | Ficha com múltiplas vendas incompletas e nenhuma concluída.';
      suggestedAction =
        'Manter bloqueio contra novas vendas (código LEGACY_SALE_REQUIRES_RECONCILIATION). ' +
        'Auditar com o vendedor se houve recebimento físico em espécie ou se a ficha deve ser revertida.';
      pendingDecision =
        'DECISÃO PENDENTE: Definir com a administração se a ficha deve retornar ao estado PENDING ou DISTRIBUTED, ' +
        'ou se o vendedor apresentará comprovante físico para uma das vendas.';
    } else if (withoutRec === 1 && !hasCompletedSale) {
      suggestedAction =
        'Permitir que o mesmo vendedor anexe o comprovante atômico na próxima tentativa, ou cancelar registro se não houver venda.';
      pendingDecision =
        'DECISÃO PENDENTE: Confirmar se o vendedor ainda possui a posse física ou fotografia do comprovante.';
    } else if (hasCompletedSale) {
      suggestedAction =
        'A ficha já possui uma venda com comprovante válida. Os registros excedentes sem comprovante foram gerados por duplicidade de requisição.';
      pendingDecision =
        'DECISÃO PENDENTE: Autorizar o cancelamento/arquivamento das vendas órfãs mantendo apenas a venda concluída com comprovante.';
    }

    details.push({
      clientMaskedId: maskString(client.id, 4),
      sequenceNumber: client.sequenceNumber || 'S/N',
      clientMaskedName: maskName(client.name),
      city: client.city || 'Desconhecida',
      bookStatus: client.bookStatus,
      outcomeStatus: client.outcomeStatus,
      cityClosedAt: client.cityClosedAt ? client.cityClosedAt.toISOString() : null,
      totalSales: clientSales.length,
      salesWithReceipt: withRec,
      salesWithoutReceipt: withoutRec,
      sales: clientSales.map((s) => ({
        saleMaskedId: maskString(s.id, 4),
        sellerMaskedName: maskName(s.seller?.name),
        value: s.value,
        date: s.date.toISOString().split('T')[0],
        hasReceipt: Boolean(s.receiptUrl),
        paymentStatus: s.paymentStatus,
        status: s.status,
      })),
      logisticsDiagnosis,
      suggestedAction,
      pendingDecision,
    });
  }

  const report: ReconciliationReport = {
    timestamp: new Date().toISOString(),
    isDryRun,
    totalSalesCount: totalSales,
    salesWithReceiptCount: salesWithReceipt,
    salesWithoutReceiptCount: salesWithoutReceipt,
    clientsWithSalesWithoutReceipt: affectedClientIds.length,
    clientsWithDuplicateSales: clientsWithDuplicatesCount,
    details,
    predictedBeforeAfter: {
      before: {
        totalSales,
        incompleteSales: salesWithoutReceipt,
      },
      afterPredicted: {
        totalSales: totalSales - salesWithoutReceipt, // se autorizada a remoção/conclusão
        incompleteSales: 0,
      },
    },
  };

  return report;
}

// Execução CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const allowWrite = args.includes('--apply-live-changes') && args.includes('--confirm-reconciliation=SIM');

  runReconciliationAnalysis({ allowWrite })
    .then((report) => {
      console.log('\n═══════════════════════════════════════════════════════════════════════════');
      console.log(`📋 RELATÓRIO DE RECONCILIAÇÃO DE VENDAS LEGADAS (${report.isDryRun ? 'MODO DRY-RUN' : 'MODO GRAVAÇÃO'})`);
      console.log('═══════════════════════════════════════════════════════════════════════════');
      console.log(`📅 Data/Hora: ${report.timestamp}`);
      console.log(`📊 Vendas no banco: Total=${report.totalSalesCount} | Com Comprovante=${report.salesWithReceiptCount} | Sem Comprovante=${report.salesWithoutReceiptCount}`);
      console.log(`📑 Fichas afetadas: ${report.clientsWithSalesWithoutReceipt} | Fichas com vendas duplicadas: ${report.clientsWithDuplicateSales}`);
      console.log('\n--- DETALHES POR FICHA AFETADA (DADOS MASCARADOS - LGPD) ---');

      for (const d of report.details) {
        console.log(`\n• Ficha: [${d.sequenceNumber}] ID=${d.clientMaskedId} Cliente=${d.clientMaskedName} Cidade=${d.city}`);
        console.log(`  Situação logística: ${d.logisticsDiagnosis}`);
        console.log(`  Vendas associadas (${d.totalSales}):`);
        for (const s of d.sales) {
          console.log(`    - ID=${s.saleMaskedId} Vendedor=${s.sellerMaskedName} Valor=R$${s.value.toFixed(2)} Data=${s.date} Comprovante=${s.hasReceipt ? 'SIM' : 'NÃO'} Status=${s.paymentStatus}/${s.status}`);
        }
        console.log(`  💡 Ação sugerida: ${d.suggestedAction}`);
        console.log(`  ⚠️ ${d.pendingDecision}`);
      }

      console.log('\n--- PROJEÇÃO DE CONTAGENS (ANTES vs DEPOIS PREVISTO) ---');
      console.log(`• ANTES: Total Vendas=${report.predictedBeforeAfter.before.totalSales}, Incompletas=${report.predictedBeforeAfter.before.incompleteSales}`);
      console.log(`• APÓS RECONCILIAÇÃO AUTORIZADA: Total Vendas=${report.predictedBeforeAfter.afterPredicted.totalSales}, Incompletas=${report.predictedBeforeAfter.afterPredicted.incompleteSales}`);
      console.log('═══════════════════════════════════════════════════════════════════════════\n');

      if (report.isDryRun) {
        console.log('🔒 Modo Dry-Run ativo: nenhuma alteração foi gravada no banco de dados.');
      }
    })
    .catch((err) => {
      console.error('❌ Erro na reconciliação:', err.message);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
