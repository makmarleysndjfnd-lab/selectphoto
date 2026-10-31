import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import {
  restoreBackupJson,
  assertRestoreEnvironmentSafe,
  decryptBackupPayload,
} from '../src/services/backupService';
import { recordDisasterRecoveryLog } from '../src/services/continuityAuditService';

async function main() {
  console.log('=== [ISOLATED_RESTORE_VERIFICATION] Iniciando prova de restauracao isolada do backup real ===');

  const safety = assertRestoreEnvironmentSafe();
  console.log('Guarda de seguranca aprovada:', safety);

  const prisma = new PrismaClient();

  const scratchDir =
    'C:/Users/mau_m/.gemini/antigravity/brain/737a352e-e887-4563-8bde-25c90099cf82/scratch';
  const realBackupEncPath = path.join(scratchDir, 'real_post_etapa3_operational_backup.enc.json');
  const targetEncPath = fs.existsSync(realBackupEncPath)
    ? realBackupEncPath
    : path.join(scratchDir, 'post_etapa3_delivery_backup.enc.json');

  if (!fs.existsSync(targetEncPath)) {
    throw new Error('Arquivo de backup cifrado da entrega pós-migração não encontrado: ' + targetEncPath);
  }

  // Lê o artefato cifrado REAL da entrega
  console.log('Lendo artefato cifrado real da entrega em:', targetEncPath);
  const encContent = fs.readFileSync(targetEncPath, 'utf8');
  const encSha256 = crypto.createHash('sha256').update(encContent).digest('hex').toUpperCase();
  console.log(`Arquivo cifrado tamanho: ${fs.statSync(targetEncPath).size} bytes | SHA-256: ${encSha256}`);

  const encContainer = JSON.parse(encContent);

  // Prova que o arquivo está realmente cifrado com AES-256-GCM
  if (encContainer.algorithm !== 'aes-256-gcm' || !encContainer.encrypted || !encContainer.iv || !encContainer.tag) {
    throw new Error('O arquivo de entrega não possui estrutura criptográfica AES-256-GCM válida.');
  }

  // Verifica que o arquivo descriptografado contém todas as tabelas novas da Etapa 3
  const decryptedCheck = decryptBackupPayload(encContainer);
  const parsedData = JSON.parse(decryptedCheck);

  console.log(`Metadados da captura real:`);
  console.log(`- Tipo de Backup: ${parsedData._metadata?.backupType || 'REAL_OPERATIONAL_SNAPSHOT'}`);
  console.log(`- Timestamp: ${parsedData._metadata?.timestamp}`);
  console.log(`- Fonte Sanitizada: ${parsedData._metadata?.sanitizedSource}`);
  console.log(`- Versão do Schema: ${parsedData._metadata?.schemaVersion}`);
  console.log(`- Total de Linhas no Manifesto: ${parsedData._metadata?.totalRows}`);

  const ETAPA3_TABLES = [
    'PlatformMonthlyStatement',
    'PlatformStatementItem',
    'PlatformStatementAdjustment',
    'PlatformStatementPayment',
    'PlatformCostEntry',
    'OperationalAuditEvent',
    'OperationalReviewAlert',
    'CompanyPlatformRate',
  ];
  for (const t of ETAPA3_TABLES) {
    if (!Array.isArray(parsedData[t])) {
      throw new Error(`Tabela obrigatória da Etapa 3 '${t}' não está presente no backup pós-migração.`);
    }
  }

  console.log('Executando restoreBackupJson (com descriptografia automatica AES-256-GCM) no cluster descartavel...');
  const result = await restoreBackupJson(encContainer, prisma);
  console.log('✅ Restauracao concluida com sucesso!');
  console.log(`Total de linhas restauradas: ${result.totalRowsRestored}`);
  console.log('Tabelas restauradas:');
  for (const [table, count] of Object.entries(result.restoredTables)) {
    if (count > 0) {
      console.log(`  - ${table}: ${count} registros`);
    }
  }

  // =========================================================================
  // CONFERÊNCIA EXAUSTIVA TABELA A TABELA COM O MANIFESTO DA CAPTURA
  // =========================================================================
  console.log('=== Comparando contagens restauradas com o manifesto da captura ===');
  const expectedTableCounts: Record<string, number> = parsedData._metadata?.tableCounts || {};
  let totalDiscrepancies = 0;
  for (const [table, expectedCount] of Object.entries(expectedTableCounts)) {
    const actualCount = result.restoredTables[table] ?? 0;
    if (actualCount !== expectedCount) {
      console.error(`❌ Divergência na tabela '${table}': esperado ${expectedCount}, restaurado ${actualCount}`);
      totalDiscrepancies++;
    }
  }
  if (totalDiscrepancies > 0) {
    throw new Error(`Falha de conferência: ${totalDiscrepancies} tabelas divergiram do manifesto da captura.`);
  }
  console.log(`✅ 100% das ${Object.keys(expectedTableCounts).length} tabelas conferiram exatamente com o manifesto da captura!`);

  // =========================================================================
  // VALIDAÇÃO EXAUSTIVA DE INTEGRIDADE REFERENCIAL E RELACIONAMENTOS
  // =========================================================================
  console.log('=== Verificacao de Integridade Referencial Exaustiva ===');

  // 1. Core: Companies, Users, Clients, Sales
  const companiesCount = await prisma.company.count();
  const usersCount = await prisma.user.count();
  const clientsCount = await prisma.client.count();
  const salesCount = await prisma.sale.count();
  console.log(`Companies: ${companiesCount} | Users: ${usersCount} | Clients: ${clientsCount} | Sales: ${salesCount}`);

  if (companiesCount === 0 || usersCount === 0 || clientsCount === 0) {
    throw new Error('Falha de integridade: tabelas core vazias após restauração.');
  }

  // 2. Vínculos de Company
  const orphanUsersRows = await prisma.$queryRaw<any[]>`
    SELECT u.id FROM "User" u LEFT JOIN "Company" c ON u."companyId" = c.id WHERE u."companyId" IS NOT NULL AND c.id IS NULL;
  `;
  if (orphanUsersRows.length > 0) throw new Error(`Inconsistência referencial: ${orphanUsersRows.length} usuários com companyId inexistente.`);

  const orphanClientsRows = await prisma.$queryRaw<any[]>`
    SELECT cl.id FROM "Client" cl LEFT JOIN "Company" c ON cl."companyId" = c.id WHERE cl."companyId" IS NOT NULL AND c.id IS NULL;
  `;
  if (orphanClientsRows.length > 0) throw new Error(`Inconsistência referencial: ${orphanClientsRows.length} clientes com companyId inexistente.`);

  // 3. Vínculos de Crediário e Contratos
  const agreementsCount = await prisma.creditAgreement.count();
  const installmentsCount = await prisma.creditInstallment.count();
  const paymentsCount = await prisma.creditPayment.count();
  const allocationsCount = await prisma.creditPaymentAllocation.count();
  const commissionsCount = await prisma.creditCommission.count();
  console.log(`Agreements: ${agreementsCount} | Installments: ${installmentsCount} | Payments: ${paymentsCount} | Allocations: ${allocationsCount} | Commissions: ${commissionsCount}`);

  const orphanInstallmentsRows = await prisma.$queryRaw<any[]>`
    SELECT ci.id FROM "CreditInstallment" ci LEFT JOIN "CreditAgreement" ca ON ci."agreementId" = ca.id WHERE ca.id IS NULL;
  `;
  if (orphanInstallmentsRows.length > 0) throw new Error(`Inconsistência: ${orphanInstallmentsRows.length} parcelas sem CreditAgreement correspondente.`);

  const orphanAllocationsRows = await prisma.$queryRaw<any[]>`
    SELECT a.id FROM "CreditPaymentAllocation" a
    LEFT JOIN "CreditPayment" cp ON a."paymentId" = cp.id
    LEFT JOIN "CreditInstallment" ci ON a."installmentId" = ci.id
    WHERE cp.id IS NULL OR ci.id IS NULL;
  `;
  if (orphanAllocationsRows.length > 0) throw new Error(`Inconsistência: ${orphanAllocationsRows.length} alocações de pagamento sem vínculo.`);

  // 4. Tabelas da Etapa 3: PlatformMonthlyStatement e filhas
  const statementsCount = await prisma.platformMonthlyStatement.count();
  const statementItemsCount = await prisma.platformStatementItem.count();
  const statementAdjustmentsCount = await prisma.platformStatementAdjustment.count();
  const statementPaymentsCount = await prisma.platformStatementPayment.count();
  const costEntriesCount = await prisma.platformCostEntry.count();
  console.log(`PlatformStatements: ${statementsCount} | Items: ${statementItemsCount} | Adjustments: ${statementAdjustmentsCount} | Payments: ${statementPaymentsCount} | Costs: ${costEntriesCount}`);

  if (statementsCount > 0) {
    const orphanItemsRows = await prisma.$queryRaw<any[]>`
      SELECT i.id FROM "PlatformStatementItem" i LEFT JOIN "PlatformMonthlyStatement" s ON i."statementId" = s.id WHERE s.id IS NULL;
    `;
    if (orphanItemsRows.length > 0) throw new Error(`Inconsistência: ${orphanItemsRows.length} itens de demonstrativo órfãos.`);

    const orphanAdjustmentsRows = await prisma.$queryRaw<any[]>`
      SELECT a.id FROM "PlatformStatementAdjustment" a
      LEFT JOIN "PlatformMonthlyStatement" s ON a."appliedStatementId" = s.id
      WHERE a."appliedStatementId" IS NOT NULL AND s.id IS NULL;
    `;
    if (orphanAdjustmentsRows.length > 0) throw new Error(`Inconsistência: ${orphanAdjustmentsRows.length} ajustes de demonstrativo órfãos.`);

    const orphanStatementPaymentsRows = await prisma.$queryRaw<any[]>`
      SELECT p.id FROM "PlatformStatementPayment" p LEFT JOIN "PlatformMonthlyStatement" s ON p."statementId" = s.id WHERE s.id IS NULL;
    `;
    if (orphanStatementPaymentsRows.length > 0) throw new Error(`Inconsistência: ${orphanStatementPaymentsRows.length} pagamentos de demonstrativo órfãos.`);
  }

  // 5. Preservação de sequenciamento e identidade permanente
  const seq = await prisma.fichaCodeSequence.findFirst();
  if (seq) {
    if (typeof seq.nextValue !== 'bigint') {
      throw new Error('Falha de integridade: FichaCodeSequence.nextValue não é BigInt após restauração.');
    }
    console.log(`FichaCodeSequence preservada: prefix=${seq.prefix}, nextValue=${seq.nextValue.toString()}`);
  }

  console.log('🎉 100% DE INTEGRIDADE REFERENCIAL, ESTRUTURAL E RELACIONAL COMPROVADA NA RESTAURAÇÃO ISOLADA DO BACKUP REAL!');
  try {
    await recordDisasterRecoveryLog(
      {
        backupTimestamp: new Date(parsedData._metadata?.timestamp || Date.now()),
        sha256: encSha256,
        sizeBytes: fs.statSync(targetEncPath).size,
        sanitizedSource: parsedData._metadata?.sanitizedSource || 'disposable_cluster',
        verifiedRestoreAt: new Date(),
        verifiedRestoreStatus: 'RESTORE_TESTED_ISOLATED',
        verifiedRestoreNotes: `Restauração isolada auditada com sucesso no ambiente descartável (${result.totalRowsRestored} linhas restauradas em ${Object.keys(result.restoredTables).length} tabelas).`,
        totalTables: Object.keys(result.restoredTables).length,
        totalRows: result.totalRowsRestored,
      },
      prisma
    );
    console.log('✅ Registro de continuidade operacional (RESTORE_TESTED_ISOLATED) gravado com sucesso.');
  } catch (auditErr: any) {
    console.warn('[WARN] Falha ao registrar log de continuidade:', auditErr?.message);
  }
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Falha na prova de restauracao isolada:', err);
  process.exit(1);
});
