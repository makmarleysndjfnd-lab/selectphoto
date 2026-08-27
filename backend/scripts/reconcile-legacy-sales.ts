/**
 * Script de Auditoria de Vendas Legadas e Incompletas
 *
 * REGRAS CRÍTICAS DE SEGURANÇA:
 * 1. Operação estritamente SOMENTE LEITURA (Audit-Only).
 * 2. Nenhuma alteração ou remoção é realizada no banco de dados.
 * 3. Todos os dados sensíveis, identificadores, valores financeiros e datas são mascarados (LGPD).
 * 4. Não realiza premissas de exclusão em massa; apresenta cenários condicionais transparentes.
 * 5. Não carrega automaticamente backend/.env; exige DATABASE_URL explícita do ambiente local (127.0.0.1/localhost).
 */

import { PrismaClient } from '@prisma/client';

export interface DatabaseConnectionInfo {
  host: string;
  port: string;
  database: string;
}

/**
 * Valida formato da DATABASE_URL sem expor credenciais sensíveis.
 */
export function parseAndValidateDatabaseUrl(url?: string): DatabaseConnectionInfo {
  if (!url || !url.trim()) {
    throw new Error('DATABASE_URL não configurada no ambiente. Execução abortada por segurança.');
  }
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const port = parsed.port || '5432';
    const database = parsed.pathname.replace(/^\//, '');
    return { host, port, database };
  } catch (e) {
    throw new Error(`DATABASE_URL com formato inválido: ${e}`);
  }
}

/**
 * Validação rigorosa: bloqueia categoricamente qualquer host remoto ou banco de produção.
 */
export function validateLocalDatabaseUrl(url?: string): DatabaseConnectionInfo {
  const info = parseAndValidateDatabaseUrl(url);
  const isLocalHost =
    info.host === '127.0.0.1' ||
    info.host === 'localhost' ||
    info.host === '::1';

  if (!isLocalHost) {
    throw new Error(
      `[SEGURANÇA] Host remoto recusado (${info.host}). O reconciliador só pode ser executado em 127.0.0.1 ou localhost.`
    );
  }

  const isAllowedDatabase =
    info.database === 'selectphoto_staging_local' ||
    info.database.includes('staging') ||
    info.database.includes('test');

  if (!isAllowedDatabase) {
    throw new Error(
      `[SEGURANÇA] Banco recusado (${info.database}). O reconciliador local só aceita 'selectphoto_staging_local' ou bancos de teste/staging.`
    );
  }

  return info;
}

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
  return parts.map((p) => (p.length > 2 ? `${p.substring(0, 2)}***` : '***')).join(' ');
}

function maskValue(val: number | string | null | undefined): string {
  return 'R$***';
}

function maskDate(date: Date | string | null | undefined): string {
  if (!date) return '****-**-**';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '****-**-**';
  const year = d.getUTCFullYear();
  return `${year}-**-**`;
}

export interface PossibleScenarios {
  scenarioA_regularization: {
    description: string;
    totalSales: number;
    incompleteSales: number;
  };
  scenarioB_cancellation: {
    description: string;
    totalSales: number;
    incompleteSales: number;
  };
  scenarioC_maintenance: {
    description: string;
    totalSales: number;
    incompleteSales: number;
  };
}

export interface ReconciliationReport {
  timestamp: string;
  isReadOnly: boolean;
  totalSalesCount: number;
  salesWithReceiptCount: number;
  salesWithoutReceiptCount: number;
  clientsWithSalesWithoutReceipt: number;
  clientsWithDuplicateSales: number;
  details: Array<{
    clientMaskedId: string;
    maskedSequenceNumber: string;
    clientMaskedName: string;
    maskedCity: string;
    bookStatus: string;
    outcomeStatus: string;
    cityClosedAt: string | null;
    totalSales: number;
    salesWithReceipt: number;
    salesWithoutReceipt: number;
    sales: Array<{
      saleMaskedId: string;
      sellerMaskedName: string;
      maskedValue: string;
      maskedDate: string;
      hasReceipt: boolean;
      paymentStatus: string;
      status: string;
    }>;
    logisticsDiagnosis: string;
    suggestedAction: string;
    pendingDecision: string;
  }>;
  scenarios: PossibleScenarios;
}

export async function runReconciliationAnalysis(options?: {
  prismaClient?: PrismaClient;
}): Promise<ReconciliationReport> {
  const prisma = options?.prismaClient || defaultPrisma;

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
      maskedSequenceNumber: maskString(client.sequenceNumber || 'S/N', 2),
      clientMaskedName: maskName(client.name),
      maskedCity: maskString(client.city || 'Desconhecida', 3),
      bookStatus: client.bookStatus,
      outcomeStatus: client.outcomeStatus,
      cityClosedAt: client.cityClosedAt ? client.cityClosedAt.toISOString() : null,
      totalSales: clientSales.length,
      salesWithReceipt: withRec,
      salesWithoutReceipt: withoutRec,
      sales: clientSales.map((s) => ({
        saleMaskedId: maskString(s.id, 4),
        sellerMaskedName: maskName(s.seller?.name),
        maskedValue: maskValue(s.value),
        maskedDate: maskDate(s.date),
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
    isReadOnly: true,
    totalSalesCount: totalSales,
    salesWithReceiptCount: salesWithReceipt,
    salesWithoutReceiptCount: salesWithoutReceipt,
    clientsWithSalesWithoutReceipt: affectedClientIds.length,
    clientsWithDuplicateSales: clientsWithDuplicatesCount,
    details,
    scenarios: {
      scenarioA_regularization: {
        description: 'Vendas incompletas são regularizadas mediante upload legítimo de comprovante',
        totalSales,
        incompleteSales: 0,
      },
      scenarioB_cancellation: {
        description: 'Vendas incompletas sem confirmação comercial são estornadas/canceladas pela administração',
        totalSales: Math.max(0, totalSales - salesWithoutReceipt),
        incompleteSales: 0,
      },
      scenarioC_maintenance: {
        description: 'Registros permanecem como estão aguardando resolução individual de cada vendedor',
        totalSales,
        incompleteSales: salesWithoutReceipt,
      },
    },
  };

  return report;
}

// Execução CLI (estritamente somente leitura em banco local)
if (require.main === module) {
  try {
    const dbInfo = validateLocalDatabaseUrl(process.env.DATABASE_URL);
    console.log(
      `[RECONCILIADOR] Conectando com segurança em: Host=${dbInfo.host}:${dbInfo.port}, Banco=${dbInfo.database}`
    );
  } catch (err: any) {
    console.error(`❌ ${err.message}`);
    process.exitCode = 1;
  }

  if (process.exitCode !== 1) {
    runReconciliationAnalysis()
      .then((report) => {
        console.log('\n═══════════════════════════════════════════════════════════════════════════');
        console.log('📋 RELATÓRIO DE AUDITORIA DE VENDAS LEGADAS (MODO SOMENTE LEITURA)');
        console.log('═══════════════════════════════════════════════════════════════════════════');
        console.log(`📅 Data/Hora: ${report.timestamp}`);
        console.log(
          `📊 Vendas no banco: Total=${report.totalSalesCount} | Com Comprovante=${report.salesWithReceiptCount} | Sem Comprovante=${report.salesWithoutReceiptCount}`
        );
        console.log(
          `📑 Fichas afetadas: ${report.clientsWithSalesWithoutReceipt} | Fichas com vendas duplicadas: ${report.clientsWithDuplicateSales}`
        );
        console.log('\n--- DETALHES POR FICHA AFETADA (DADOS MASCARADOS - LGPD) ---');

        for (const d of report.details) {
          console.log(
            `\n• Ficha: [${d.maskedSequenceNumber}] ID=${d.clientMaskedId} Cliente=${d.clientMaskedName} Cidade=${d.maskedCity}`
          );
          console.log(`  Situação logística: ${d.logisticsDiagnosis}`);
          console.log(`  Vendas associadas (${d.totalSales}):`);
          for (const s of d.sales) {
            console.log(
              `    - ID=${s.saleMaskedId} Vendedor=${s.sellerMaskedName} Valor=${s.maskedValue} Data=${s.maskedDate} Comprovante=${s.hasReceipt ? 'SIM' : 'NÃO'} Status=${s.paymentStatus}/${s.status}`
            );
          }
          console.log(`  💡 Ação sugerida: ${d.suggestedAction}`);
          console.log(`  ⚠️ ${d.pendingDecision}`);
        }

        console.log('\n--- CENÁRIOS POSSÍVEIS DE RECONCILIAÇÃO (CONDICIONAIS) ---');
        console.log(
          `• Cenário A (Regularização com comprovante): Total Vendas=${report.scenarios.scenarioA_regularization.totalSales}, Incompletas=${report.scenarios.scenarioA_regularization.incompleteSales}`
        );
        console.log(
          `• Cenário B (Cancelamento/estorno administrativo): Total Vendas=${report.scenarios.scenarioB_cancellation.totalSales}, Incompletas=${report.scenarios.scenarioB_cancellation.incompleteSales}`
        );
        console.log(
          `• Cenário C (Manutenção do estado atual): Total Vendas=${report.scenarios.scenarioC_maintenance.totalSales}, Incompletas=${report.scenarios.scenarioC_maintenance.incompleteSales}`
        );
        console.log('═══════════════════════════════════════════════════════════════════════════\n');
        console.log('🔒 Auditoria somente leitura concluída: nenhuma modificação de banco executada.');
      })
      .catch((err) => {
        console.error('❌ Erro na auditoria:', err.message);
        process.exitCode = 1;
      })
      .finally(async () => {
        await defaultPrisma.$disconnect();
      });
  }
}
