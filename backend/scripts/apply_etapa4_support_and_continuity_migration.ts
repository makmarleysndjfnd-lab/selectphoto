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
  console.log('🚀 [MIGRAÇÃO DDL CONTROLADA — SUPORTE AUTORIZADO, INDICADORES E CONTINUIDADE (ETAPA 4)]');
  console.log(`Modo de destino: ${isolated ? 'ISOLATED_TEST_DB' : 'OPERATIONAL_DB_AUTHORIZED'}`);

  try {
    console.log('1. Criando tabela SupportTicket...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "SupportTicket" (
        "id" TEXT NOT NULL,
        "ticketNumber" SERIAL NOT NULL,
        "companyId" TEXT NOT NULL,
        "creatorUserId" TEXT NOT NULL,
        "creatorName" TEXT NOT NULL,
        "assignedToUserId" TEXT,
        "assignedToName" TEXT,
        "title" TEXT NOT NULL,
        "description" TEXT NOT NULL,
        "category" TEXT NOT NULL DEFAULT 'QUESTION',
        "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
        "status" TEXT NOT NULL DEFAULT 'OPEN',
        "appVersion" TEXT,
        "buildNumber" INTEGER,
        "affectedService" TEXT,
        "devicePlatform" TEXT,
        "connectivityStatus" TEXT,
        "sanitizedErrorDetails" JSONB,
        "resolvedAt" TIMESTAMP(3),
        "closedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "SupportTicket_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "SupportTicket_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "SupportTicket_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SupportTicket_companyId_status_idx" ON "SupportTicket"("companyId", "status")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SupportTicket_status_priority_idx" ON "SupportTicket"("status", "priority")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SupportTicket_creatorUserId_idx" ON "SupportTicket"("creatorUserId")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SupportTicket_assignedToUserId_idx" ON "SupportTicket"("assignedToUserId")`);
    console.log('✅ Tabela SupportTicket verificada/aplicada.');

    console.log('2. Criando tabela SupportTicketMessage...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "SupportTicketMessage" (
        "id" TEXT NOT NULL,
        "ticketId" TEXT NOT NULL,
        "authorUserId" TEXT NOT NULL,
        "authorName" TEXT NOT NULL,
        "authorRole" TEXT NOT NULL,
        "message" TEXT NOT NULL,
        "isInternalNote" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "SupportTicketMessage_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "SupportTicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "SupportTicketMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SupportTicketMessage_ticketId_createdAt_idx" ON "SupportTicketMessage"("ticketId", "createdAt")`);
    console.log('✅ Tabela SupportTicketMessage verificada/aplicada.');

    console.log('3. Criando tabela SupportTicketAttachment...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "SupportTicketAttachment" (
        "id" TEXT NOT NULL,
        "ticketId" TEXT NOT NULL,
        "messageId" TEXT,
        "fileName" TEXT NOT NULL,
        "fileSize" INTEGER NOT NULL,
        "mimeType" TEXT NOT NULL,
        "storageUrl" TEXT NOT NULL,
        "isVoluntary" BOOLEAN NOT NULL DEFAULT true,
        "isSanitized" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "SupportTicketAttachment_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "SupportTicketAttachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "SupportTicketAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "SupportTicketMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SupportTicketAttachment_ticketId_idx" ON "SupportTicketAttachment"("ticketId")`);
    console.log('✅ Tabela SupportTicketAttachment verificada/aplicada.');

    console.log('4. Criando tabela SupportAccessGrant...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "SupportAccessGrant" (
        "id" TEXT NOT NULL,
        "ticketId" TEXT,
        "companyId" TEXT NOT NULL,
        "requestedByUserId" TEXT NOT NULL,
        "requestedByName" TEXT NOT NULL,
        "approvedByUserId" TEXT,
        "approvedByName" TEXT,
        "scope" TEXT NOT NULL DEFAULT 'READ_ONLY',
        "reason" TEXT NOT NULL,
        "durationMinutes" INTEGER NOT NULL DEFAULT 60,
        "status" TEXT NOT NULL DEFAULT 'REQUESTED',
        "grantedAt" TIMESTAMP(3),
        "expiresAt" TIMESTAMP(3),
        "revokedAt" TIMESTAMP(3),
        "revokedByUserId" TEXT,
        "revokedByName" TEXT,
        "revocationReason" TEXT,
        "sessionTokenHash" TEXT,
        "ipAddress" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "SupportAccessGrant_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "SupportAccessGrant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "SupportAccessGrant_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "SupportAccessGrant_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "SupportAccessGrant_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "SupportAccessGrant_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
      )
    `);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        ALTER TABLE "SupportAccessGrant" ADD CONSTRAINT "SupportAccessGrant_sessionTokenHash_key" UNIQUE ("sessionTokenHash");
      EXCEPTION
        WHEN duplicate_table THEN NULL;
        WHEN duplicate_object THEN NULL;
      END $$
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SupportAccessGrant_companyId_status_idx" ON "SupportAccessGrant"("companyId", "status")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SupportAccessGrant_requestedByUserId_status_idx" ON "SupportAccessGrant"("requestedByUserId", "status")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SupportAccessGrant_expiresAt_idx" ON "SupportAccessGrant"("expiresAt")`);
    console.log('✅ Tabela SupportAccessGrant verificada/aplicada.');

    console.log('5. Criando tabela InternalOperationalAlert...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "InternalOperationalAlert" (
        "id" TEXT NOT NULL,
        "companyId" TEXT,
        "alertKey" TEXT NOT NULL,
        "category" TEXT NOT NULL,
        "severity" TEXT NOT NULL DEFAULT 'WARNING',
        "title" TEXT NOT NULL,
        "details" JSONB,
        "acknowledged" BOOLEAN NOT NULL DEFAULT false,
        "acknowledgedAt" TIMESTAMP(3),
        "acknowledgedByUserId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "InternalOperationalAlert_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "InternalOperationalAlert_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE
      )
    `);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        ALTER TABLE "InternalOperationalAlert" ADD CONSTRAINT "InternalOperationalAlert_alertKey_key" UNIQUE ("alertKey");
      EXCEPTION
        WHEN duplicate_table THEN NULL;
        WHEN duplicate_object THEN NULL;
      END $$
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "InternalOperationalAlert_companyId_ack_sev_idx" ON "InternalOperationalAlert"("companyId", "acknowledged", "severity")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "InternalOperationalAlert_category_ack_idx" ON "InternalOperationalAlert"("category", "acknowledged")`);
    console.log('✅ Tabela InternalOperationalAlert verificada/aplicada.');

    console.log('6. Criando tabela DisasterRecoveryAuditLog...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "DisasterRecoveryAuditLog" (
        "id" TEXT NOT NULL,
        "backupTimestamp" TIMESTAMP(3) NOT NULL,
        "scope" TEXT NOT NULL DEFAULT 'GLOBAL',
        "sha256" TEXT NOT NULL,
        "sizeBytes" INTEGER NOT NULL,
        "sanitizedSource" TEXT NOT NULL,
        "verifiedRestoreAt" TIMESTAMP(3),
        "verifiedRestoreStatus" TEXT,
        "verifiedRestoreNotes" TEXT,
        "totalTables" INTEGER NOT NULL,
        "totalRows" INTEGER NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "DisasterRecoveryAuditLog_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DisasterRecoveryAuditLog_backupTimestamp_idx" ON "DisasterRecoveryAuditLog"("backupTimestamp")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DisasterRecoveryAuditLog_verifiedRestoreStatus_idx" ON "DisasterRecoveryAuditLog"("verifiedRestoreStatus")`);
    console.log('✅ Tabela DisasterRecoveryAuditLog verificada/aplicada.');

    console.log('7. Criando tabela DeviceTelemetry...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "DeviceTelemetry" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "companyId" TEXT NOT NULL,
        "deviceId" TEXT,
        "platform" TEXT NOT NULL DEFAULT 'ANDROID',
        "appVersion" TEXT NOT NULL,
        "buildNumber" INTEGER,
        "pendingOfflineCount" INTEGER NOT NULL DEFAULT 0,
        "pendingSummary" JSONB,
        "lastSyncAttemptAt" TIMESTAMP(3),
        "connectivityStatus" TEXT,
        "lastReportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "DeviceTelemetry_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "DeviceTelemetry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "DeviceTelemetry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DeviceTelemetry_companyId_lastReportedAt_idx" ON "DeviceTelemetry"("companyId", "lastReportedAt")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DeviceTelemetry_userId_lastReportedAt_idx" ON "DeviceTelemetry"("userId", "lastReportedAt")`);
    console.log('✅ Tabela DeviceTelemetry verificada/aplicada.');

    console.log('\n🎉 [MIGRAÇÃO DDL ETAPA 4 CONCLUÍDA COM 100% DE SUCESSO]');
    process.exit(0);
  } catch (error) {
    console.error('❌ [ERRO NA MIGRAÇÃO DDL ETAPA 4]:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
