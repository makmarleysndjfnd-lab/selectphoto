import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

function isIsolatedTestDatabaseUrl(dbUrl: string): boolean {
  try {
    const parsed = new URL(dbUrl);
    const host = (parsed.hostname || '').toLowerCase();
    const dbName = (parsed.pathname || '').replace(/^\//, '').toLowerCase();
    const isLocalHost = host === '127.0.0.1' || host === 'localhost' || host === '::1';
    const hasTestDbName =
      dbName.includes('test') ||
      dbName.includes('staging') ||
      dbName.includes('homolog') ||
      dbName.includes('sandbox') ||
      dbName.includes('isolated');
    return isLocalHost && hasTestDbName;
  } catch {
    return false;
  }
}

async function main() {
  const dbUrl = process.env.DATABASE_URL || '';
  if (!dbUrl) {
    console.error('❌ DATABASE_URL ausente.');
    process.exit(1);
  }

  const allowOperational = process.argv.includes('--allow-operational');
  const isolated = isIsolatedTestDatabaseUrl(dbUrl);

  if (!isolated && !allowOperational) {
    console.error(
      '🛑 [BLOQUEIO DE SEGURANÇA] Destino não é banco isolado de teste/homologação. ' +
        'Gere e valide o backup recuperável primeiro e execute explicitamente com --allow-operational.'
    );
    process.exit(2);
  }

  const prisma = new PrismaClient();
  console.log('🚀 [MIGRAÇÃO DDL CONTROLADA — FATURAMENTO, AUDITORIA E CUSTOS (ETAPA 3)]');
  console.log(`Modo de destino: ${isolated ? 'ISOLATED_TEST_DB' : 'OPERATIONAL_DB_AUTHORIZED'}`);

  try {
    console.log('1. Criando tabela PlatformMonthlyStatement...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "PlatformMonthlyStatement" (
        "id" TEXT NOT NULL,
        "companyId" TEXT NOT NULL,
        "competence" TEXT NOT NULL,
        "startDate" TIMESTAMP(3) NOT NULL,
        "endDate" TIMESTAMP(3) NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'CLOSED',
        "isGratuitousZero" BOOLEAN NOT NULL DEFAULT false,
        "roundingPolicy" TEXT NOT NULL DEFAULT 'ITEM_HALF_UP_SUM',
        "eligibleSalesCount" INTEGER NOT NULL DEFAULT 0,
        "eligibleSalesBaseCents" INTEGER NOT NULL DEFAULT 0,
        "grossPlatformFeeCents" INTEGER NOT NULL DEFAULT 0,
        "adjustmentsCents" INTEGER NOT NULL DEFAULT 0,
        "netDueCents" INTEGER NOT NULL DEFAULT 0,
        "paidAmountCents" INTEGER NOT NULL DEFAULT 0,
        "remainingBalanceCents" INTEGER NOT NULL DEFAULT 0,
        "carryForwardCreditCents" INTEGER NOT NULL DEFAULT 0,
        "companyConfirmedSalesCents" INTEGER NOT NULL DEFAULT 0,
        "companyCreditReceivedPrincipalCents" INTEGER NOT NULL DEFAULT 0,
        "sellerInitialCommissionsCents" INTEGER NOT NULL DEFAULT 0,
        "sellerInstallmentCommissionsCents" INTEGER NOT NULL DEFAULT 0,
        "providerFeesCents" INTEGER NOT NULL DEFAULT 0,
        "excludedPreContractCount" INTEGER NOT NULL DEFAULT 0,
        "excludedPreContractBaseCents" INTEGER NOT NULL DEFAULT 0,
        "excludedTestOrUnconfirmedCount" INTEGER NOT NULL DEFAULT 0,
        "vigenciaBreakdown" JSONB NOT NULL,
        "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "closedByUserId" TEXT NOT NULL,
        "closedByName" TEXT NOT NULL,
        "notes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "PlatformMonthlyStatement_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "PlatformMonthlyStatement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "PlatformMonthlyStatement_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `);

    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        ALTER TABLE "PlatformMonthlyStatement" ADD CONSTRAINT "PlatformMonthlyStatement_companyId_competence_key" UNIQUE ("companyId", "competence");
      EXCEPTION
        WHEN duplicate_table THEN NULL;
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "PlatformMonthlyStatement_competence_status_idx" ON "PlatformMonthlyStatement"("competence", "status");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "PlatformMonthlyStatement_companyId_status_idx" ON "PlatformMonthlyStatement"("companyId", "status");
    `);
    console.log('✅ Tabela PlatformMonthlyStatement verificada/aplicada.');

    console.log('2. Criando tabela PlatformStatementItem...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "PlatformStatementItem" (
        "id" TEXT NOT NULL,
        "statementId" TEXT NOT NULL,
        "companyId" TEXT NOT NULL,
        "saleId" TEXT NOT NULL,
        "competence" TEXT NOT NULL,
        "saleReference" TEXT NOT NULL,
        "saleDate" TIMESTAMP(3) NOT NULL,
        "city" TEXT NOT NULL,
        "product" TEXT NOT NULL,
        "paymentModality" TEXT NOT NULL,
        "saleBaseCents" INTEGER NOT NULL,
        "rateId" TEXT NOT NULL,
        "rateVersion" INTEGER NOT NULL,
        "ratePercentage" DECIMAL(6,3) NOT NULL,
        "rateMilliPercent" INTEGER NOT NULL,
        "calculatedFeeCents" INTEGER NOT NULL,
        "creditedBaseCents" INTEGER NOT NULL DEFAULT 0,
        "creditedFeeCents" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "PlatformStatementItem_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "PlatformStatementItem_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "PlatformMonthlyStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "PlatformStatementItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "PlatformStatementItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        ALTER TABLE "PlatformStatementItem" ADD CONSTRAINT "PlatformStatementItem_saleId_key" UNIQUE ("saleId");
      EXCEPTION
        WHEN duplicate_table THEN NULL;
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "PlatformStatementItem_statementId_idx" ON "PlatformStatementItem"("statementId");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "PlatformStatementItem_companyId_competence_idx" ON "PlatformStatementItem"("companyId", "competence");
    `);
    console.log('✅ Tabela PlatformStatementItem verificada/aplicada.');

    console.log('3. Criando tabela PlatformStatementAdjustment...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "PlatformStatementAdjustment" (
        "id" TEXT NOT NULL,
        "idempotencyKey" TEXT NOT NULL,
        "companyId" TEXT NOT NULL,
        "appliedStatementId" TEXT,
        "appliedCompetence" TEXT NOT NULL,
        "originStatementId" TEXT,
        "originItemId" TEXT,
        "originSaleId" TEXT,
        "originSaleReference" TEXT,
        "type" TEXT NOT NULL,
        "returnedBaseCents" INTEGER NOT NULL DEFAULT 0,
        "originalRateVersion" INTEGER,
        "originalRatePercentage" DECIMAL(6,3),
        "originalRateMilliPercent" INTEGER,
        "amountCents" INTEGER NOT NULL,
        "reason" TEXT NOT NULL,
        "createdByUserId" TEXT NOT NULL,
        "createdByName" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "PlatformStatementAdjustment_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "PlatformStatementAdjustment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "PlatformStatementAdjustment_appliedStatementId_fkey" FOREIGN KEY ("appliedStatementId") REFERENCES "PlatformMonthlyStatement"("id") ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "PlatformStatementAdjustment_originStatementId_fkey" FOREIGN KEY ("originStatementId") REFERENCES "PlatformMonthlyStatement"("id") ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "PlatformStatementAdjustment_originItemId_fkey" FOREIGN KEY ("originItemId") REFERENCES "PlatformStatementItem"("id") ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "PlatformStatementAdjustment_originSaleId_fkey" FOREIGN KEY ("originSaleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "PlatformStatementAdjustment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        ALTER TABLE "PlatformStatementAdjustment" ADD CONSTRAINT "PlatformStatementAdjustment_idempotencyKey_key" UNIQUE ("idempotencyKey");
      EXCEPTION
        WHEN duplicate_table THEN NULL;
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "PlatformStatementAdjustment_companyId_appliedCompetence_idx" ON "PlatformStatementAdjustment"("companyId", "appliedCompetence");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "PlatformStatementAdjustment_originItemId_idx" ON "PlatformStatementAdjustment"("originItemId");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "PlatformStatementAdjustment_originSaleId_idx" ON "PlatformStatementAdjustment"("originSaleId");
    `);
    console.log('✅ Tabela PlatformStatementAdjustment verificada/aplicada.');

    console.log('4. Criando tabela PlatformStatementPayment...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "PlatformStatementPayment" (
        "id" TEXT NOT NULL,
        "idempotencyKey" TEXT NOT NULL,
        "statementId" TEXT NOT NULL,
        "companyId" TEXT NOT NULL,
        "amountCents" INTEGER NOT NULL,
        "paymentMethod" TEXT NOT NULL,
        "paidAt" TIMESTAMP(3) NOT NULL,
        "externalReference" TEXT,
        "notes" TEXT,
        "recordedByUserId" TEXT NOT NULL,
        "recordedByName" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "PlatformStatementPayment_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "PlatformStatementPayment_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "PlatformMonthlyStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "PlatformStatementPayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "PlatformStatementPayment_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        ALTER TABLE "PlatformStatementPayment" ADD CONSTRAINT "PlatformStatementPayment_idempotencyKey_key" UNIQUE ("idempotencyKey");
      EXCEPTION
        WHEN duplicate_table THEN NULL;
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "PlatformStatementPayment_statementId_idx" ON "PlatformStatementPayment"("statementId");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "PlatformStatementPayment_companyId_paidAt_idx" ON "PlatformStatementPayment"("companyId", "paidAt");
    `);
    console.log('✅ Tabela PlatformStatementPayment verificada/aplicada.');

    console.log('5. Criando tabela OperationalAuditEvent...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "OperationalAuditEvent" (
        "id" TEXT NOT NULL,
        "companyId" TEXT,
        "category" TEXT NOT NULL,
        "action" TEXT NOT NULL,
        "entityType" TEXT NOT NULL,
        "entityReference" TEXT NOT NULL,
        "entityId" TEXT,
        "previousValues" JSONB,
        "newValues" JSONB,
        "reason" TEXT,
        "authorUserId" TEXT,
        "authorName" TEXT NOT NULL,
        "authorRole" TEXT,
        "isTestOrSimulation" BOOLEAN NOT NULL DEFAULT false,
        "ipAddress" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "OperationalAuditEvent_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "OperationalAuditEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "OperationalAuditEvent_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "OperationalAuditEvent_companyId_category_createdAt_idx" ON "OperationalAuditEvent"("companyId", "category", "createdAt");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "OperationalAuditEvent_category_createdAt_idx" ON "OperationalAuditEvent"("category", "createdAt");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "OperationalAuditEvent_entityType_entityId_idx" ON "OperationalAuditEvent"("entityType", "entityId");
    `);
    console.log('✅ Tabela OperationalAuditEvent verificada/aplicada.');

    console.log('6. Criando tabela OperationalReviewAlert...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "OperationalReviewAlert" (
        "id" TEXT NOT NULL,
        "companyId" TEXT NOT NULL,
        "auditEventId" TEXT,
        "alertType" TEXT NOT NULL,
        "severity" TEXT NOT NULL DEFAULT 'ATTENTION',
        "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
        "entityType" TEXT NOT NULL,
        "entityReference" TEXT NOT NULL,
        "entityId" TEXT,
        "summary" TEXT NOT NULL,
        "details" JSONB,
        "reviewNotes" TEXT,
        "reviewedByUserId" TEXT,
        "reviewedByName" TEXT,
        "reviewedAt" TIMESTAMP(3),
        "isTestOrSimulation" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "OperationalReviewAlert_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "OperationalReviewAlert_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "OperationalReviewAlert_auditEventId_fkey" FOREIGN KEY ("auditEventId") REFERENCES "OperationalAuditEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "OperationalReviewAlert_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "OperationalReviewAlert_companyId_status_createdAt_idx" ON "OperationalReviewAlert"("companyId", "status", "createdAt");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "OperationalReviewAlert_status_createdAt_idx" ON "OperationalReviewAlert"("status", "createdAt");
    `);
    console.log('✅ Tabela OperationalReviewAlert verificada/aplicada.');

    console.log('7. Criando tabela PlatformCostEntry...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "PlatformCostEntry" (
        "id" TEXT NOT NULL,
        "idempotencyKey" TEXT NOT NULL,
        "companyId" TEXT,
        "competence" TEXT NOT NULL,
        "periodStart" TIMESTAMP(3),
        "periodEnd" TIMESTAMP(3),
        "category" TEXT NOT NULL,
        "provider" TEXT NOT NULL,
        "measurementType" TEXT NOT NULL,
        "sourceDocument" TEXT NOT NULL,
        "currency" TEXT NOT NULL DEFAULT 'BRL',
        "originalAmountCents" INTEGER NOT NULL,
        "exchangeRateMilli" INTEGER,
        "amountBrlCents" INTEGER NOT NULL,
        "costPayer" TEXT NOT NULL DEFAULT 'PLATFORM',
        "allocationRule" TEXT NOT NULL DEFAULT 'UNALLOCATED_PLATFORM_OVERHEAD',
        "replacesTelemetryUsage" BOOLEAN NOT NULL DEFAULT false,
        "isTestOrSimulation" BOOLEAN NOT NULL DEFAULT false,
        "notes" TEXT,
        "createdByUserId" TEXT NOT NULL,
        "createdByName" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "PlatformCostEntry_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "PlatformCostEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "PlatformCostEntry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        ALTER TABLE "PlatformCostEntry" ADD CONSTRAINT "PlatformCostEntry_idempotencyKey_key" UNIQUE ("idempotencyKey");
      EXCEPTION
        WHEN duplicate_table THEN NULL;
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "PlatformCostEntry_competence_costPayer_idx" ON "PlatformCostEntry"("competence", "costPayer");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "PlatformCostEntry_companyId_competence_idx" ON "PlatformCostEntry"("companyId", "competence");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "PlatformCostEntry_provider_competence_idx" ON "PlatformCostEntry"("provider", "competence");
    `);
    console.log('✅ Tabela PlatformCostEntry verificada/aplicada.');

    console.log('\n🎉 [MIGRAÇÃO DDL ETAPA 3 CONCLUÍDA COM 100% DE SUCESSO]');
  } catch (error) {
    console.error('❌ Falha na execução da migração DDL:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
