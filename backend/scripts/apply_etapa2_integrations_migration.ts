import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 [MIGRAÇÃO DDL CONTROLADA — CENTRAL DE INTEGRAÇÕES E APIS (ETAPA 2)]');
  console.log('Target Database:', process.env.DATABASE_URL ? 'Configurado' : 'Ausente');

  try {
    // 1. Tabela CompanyIntegration
    console.log('1. Criando tabela CompanyIntegration...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "CompanyIntegration" (
        "id" TEXT NOT NULL,
        "companyId" TEXT NOT NULL,
        "category" TEXT NOT NULL,
        "provider" TEXT NOT NULL,
        "scope" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'ACTIVE',
        "environment" TEXT NOT NULL DEFAULT 'PRODUCTION',
        "accountName" TEXT,
        "costPayer" TEXT NOT NULL DEFAULT 'PLATFORM',
        "changeApplicability" TEXT NOT NULL DEFAULT 'DYNAMIC',
        "credentialSource" TEXT NOT NULL DEFAULT 'VAULT_ENCRYPTED',
        "encryptedSecret" TEXT,
        "secretIv" TEXT,
        "secretTag" TEXT,
        "secretMasked" TEXT,
        "envVarName" TEXT,
        "configMetadata" JSONB,
        "version" INTEGER NOT NULL DEFAULT 1,
        "monthlyBudgetLimitCents" INTEGER,
        "monthlyUnitsLimit" INTEGER,
        "lastValidatedAt" TIMESTAMP(3),
        "lastValidationStatus" TEXT,
        "lastValidationError" TEXT,
        "createdByUserId" TEXT NOT NULL,
        "updatedByUserId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "CompanyIntegration_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "CompanyIntegration_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "CompanyIntegration_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "CompanyIntegration_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);

    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        ALTER TABLE "CompanyIntegration" ADD CONSTRAINT "CompanyIntegration_companyId_category_environment_key" UNIQUE ("companyId", "category", "environment");
      EXCEPTION
        WHEN duplicate_table THEN NULL;
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "CompanyIntegration_companyId_status_idx" ON "CompanyIntegration"("companyId", "status");
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "CompanyIntegration_category_status_idx" ON "CompanyIntegration"("category", "status");
    `);
    console.log('✅ Tabela CompanyIntegration e índices verificados/aplicados.');

    // 2. Tabela ApiUsageRecord
    console.log('2. Criando tabela ApiUsageRecord...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ApiUsageRecord" (
        "id" TEXT NOT NULL,
        "companyId" TEXT NOT NULL,
        "integrationId" TEXT,
        "category" TEXT NOT NULL,
        "provider" TEXT NOT NULL,
        "operation" TEXT NOT NULL,
        "unitsUsed" INTEGER NOT NULL DEFAULT 1,
        "estimatedCostCents" INTEGER,
        "measuredCostCents" INTEGER,
        "status" TEXT NOT NULL DEFAULT 'SUCCESS',
        "latencyMs" INTEGER,
        "errorMessage" TEXT,
        "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "ApiUsageRecord_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "ApiUsageRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "ApiUsageRecord_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "CompanyIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "ApiUsageRecord_companyId_category_timestamp_idx" ON "ApiUsageRecord"("companyId", "category", "timestamp");
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "ApiUsageRecord_integrationId_timestamp_idx" ON "ApiUsageRecord"("integrationId", "timestamp");
    `);
    console.log('✅ Tabela ApiUsageRecord e índices verificados/aplicados.');

    // 3. Tabela IntegrationAuditEvent
    console.log('3. Criando tabela IntegrationAuditEvent...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "IntegrationAuditEvent" (
        "id" TEXT NOT NULL,
        "companyId" TEXT NOT NULL,
        "integrationId" TEXT,
        "action" TEXT NOT NULL,
        "authorUserId" TEXT NOT NULL,
        "authorName" TEXT NOT NULL,
        "details" TEXT NOT NULL,
        "result" TEXT NOT NULL DEFAULT 'SUCCESS',
        "ipAddress" TEXT,
        "userAgent" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "IntegrationAuditEvent_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "IntegrationAuditEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "IntegrationAuditEvent_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "IntegrationAuditEvent_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "CompanyIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "IntegrationAuditEvent_companyId_createdAt_idx" ON "IntegrationAuditEvent"("companyId", "createdAt");
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "IntegrationAuditEvent_integrationId_createdAt_idx" ON "IntegrationAuditEvent"("integrationId", "createdAt");
    `);
    console.log('✅ Tabela IntegrationAuditEvent e índices verificados/aplicados.');

    console.log('\n🎉 [MIGRAÇÃO DDL ETAPA 2 CONCLUÍDA COM 100% DE SUCESSO]');
  } catch (error) {
    console.error('❌ Falha na execução da migração DDL:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
