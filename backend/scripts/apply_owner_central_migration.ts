import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 [MIGRAÇÃO DDL CONTROLADA — CENTRAL DO PROPRIETÁRIO (ETAPA 1)]');
  console.log('Target Database:', process.env.DATABASE_URL ? 'Configurado' : 'Ausente');

  try {
    // 1. Colunas contratuais em Company
    console.log('1. Aplicando colunas contratuais em Company...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Company"
        ADD COLUMN IF NOT EXISTS "legalName" TEXT,
        ADD COLUMN IF NOT EXISTS "tradeName" TEXT,
        ADD COLUMN IF NOT EXISTS "adminContactName" TEXT,
        ADD COLUMN IF NOT EXISTS "adminContactEmail" TEXT,
        ADD COLUMN IF NOT EXISTS "adminContactPhone" TEXT,
        ADD COLUMN IF NOT EXISTS "contractNotes" TEXT,
        ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ACTIVE',
        ADD COLUMN IF NOT EXISTS "suspensionReason" TEXT,
        ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3),
        ADD COLUMN IF NOT EXISTS "suspendedByUserId" TEXT;
    `);
    console.log('✅ Colunas em Company verificadas/aplicadas.');

    // 2. Tabela CompanyPlatformRate
    console.log('2. Criando tabela CompanyPlatformRate...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "CompanyPlatformRate" (
        "id" TEXT NOT NULL,
        "companyId" TEXT NOT NULL,
        "version" INTEGER NOT NULL DEFAULT 1,
        "ratePercentage" DECIMAL(6, 3) NOT NULL,
        "effectiveFrom" TIMESTAMP(3) NOT NULL,
        "effectiveTo" TIMESTAMP(3),
        "reason" TEXT NOT NULL,
        "createdByUserId" TEXT NOT NULL,
        "createdByName" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "CompanyPlatformRate_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "CompanyPlatformRate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "CompanyPlatformRate_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "CompanyPlatformRate_companyId_effectiveFrom_idx" ON "CompanyPlatformRate"("companyId", "effectiveFrom");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "CompanyPlatformRate_companyId_effectiveTo_idx" ON "CompanyPlatformRate"("companyId", "effectiveTo");
    `);
    console.log('✅ Tabela CompanyPlatformRate e índices verificados/aplicados.');

    // 3. Tabela OwnerCapability
    console.log('3. Criando tabela OwnerCapability...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "OwnerCapability" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "capability" TEXT NOT NULL,
        "grantedByUserId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "OwnerCapability_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "OwnerCapability_userId_capability_key" UNIQUE ("userId", "capability"),
        CONSTRAINT "OwnerCapability_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "OwnerCapability_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "OwnerCapability_userId_idx" ON "OwnerCapability"("userId");
    `);
    console.log('✅ Tabela OwnerCapability e índices verificados/aplicados.');

    // 4. Tabela ContractAuditEvent
    console.log('4. Criando tabela ContractAuditEvent...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ContractAuditEvent" (
        "id" TEXT NOT NULL,
        "companyId" TEXT,
        "action" TEXT NOT NULL,
        "authorUserId" TEXT NOT NULL,
        "authorName" TEXT NOT NULL,
        "details" TEXT NOT NULL,
        "reason" TEXT,
        "ipAddress" TEXT,
        "userAgent" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "ContractAuditEvent_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "ContractAuditEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "ContractAuditEvent_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "ContractAuditEvent_companyId_createdAt_idx" ON "ContractAuditEvent"("companyId", "createdAt");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "ContractAuditEvent_authorUserId_createdAt_idx" ON "ContractAuditEvent"("authorUserId", "createdAt");
    `);
    console.log('✅ Tabela ContractAuditEvent e índices verificados/aplicados.');

    // 5. Tabela StepUpSession
    console.log('5. Criando tabela StepUpSession...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "StepUpSession" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "tokenHash" TEXT NOT NULL,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "revokedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "StepUpSession_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "StepUpSession_tokenHash_key" UNIQUE ("tokenHash"),
        CONSTRAINT "StepUpSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "StepUpSession_userId_expiresAt_idx" ON "StepUpSession"("userId", "expiresAt");
    `);
    console.log('✅ Tabela StepUpSession e índices verificados/aplicados.');

    // 6. Conceder capacidades padrão aos Super Admins existentes
    console.log('6. Inicializando capacidades dos Super Admins...');
    const superAdmins = await prisma.user.findMany({
      where: { role: 'SUPER_ADMIN' },
      select: { id: true, name: true }
    });

    const defaultCapabilities = [
      'PLATFORM_FINANCE',
      'CONTRACT_MANAGEMENT',
      'INTEGRATION_CONFIG',
      'TECHNICAL_SUPPORT'
    ];

    for (const admin of superAdmins) {
      for (const cap of defaultCapabilities) {
        await prisma.ownerCapability.upsert({
          where: {
            userId_capability: {
              userId: admin.id,
              capability: cap
            }
          },
          update: {},
          create: {
            userId: admin.id,
            capability: cap,
            grantedByUserId: null
          }
        });
      }
      console.log(`- Capacidades concedidas para Super Admin: ${admin.name} (${admin.id})`);
    }

    console.log('\n🎉 [MIGRAÇÃO DDL CONCLUÍDA COM 100% DE SUCESSO]');
  } catch (error) {
    console.error('❌ Falha na execução da migração DDL:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
