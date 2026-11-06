import { prisma, getPrisma } from '../services/prisma';
import { CONFIRMED_TEST_COMPANY_IDS, PROJECT_COMPANY_ID } from '../constants/companyClassification';

/**
 * Garante idempotentemente a coluna `classification` na tabela Company
 * e atualiza os 51 registros confirmados de teste para 'TEST_DEMO',
 * preservando a empresa operacional do projeto como 'OPERATIONAL'.
 */
export async function initDatabaseClassification(): Promise<void> {
  try {
    const prisma = getPrisma();

    // 1. Adicionar a coluna de forma idempotente e retrocompatível
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "classification" TEXT NOT NULL DEFAULT 'OPERATIONAL';`
    );

    // 1.1 Garantir colunas de sessão única por aparelho e cronograma de fechamento do crediário
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "creditClosingStartDate" TIMESTAMP(3);`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "creditClosingEndDate" TIMESTAMP(3);`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "creditClosingPayoutDate" TIMESTAMP(3);`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "activeSessionId" TEXT;`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "activeDeviceId" TEXT;`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionStartedAt" TIMESTAMP(3);`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "MonthlyCreditClosing" ADD COLUMN IF NOT EXISTS "payoutDate" TIMESTAMP(3);`
    );

    // 2. Classificar os 51 registros de teste catalogados
    if (CONFIRMED_TEST_COMPANY_IDS.length > 0) {
      const quotedIds = CONFIRMED_TEST_COMPANY_IDS.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
      await prisma.$executeRawUnsafe(
        `UPDATE "Company" SET "classification" = 'TEST_DEMO' WHERE "id" IN (${quotedIds}) AND "classification" != 'TEST_DEMO';`
      );
    }

    // 3. Garantir a empresa operacional do projeto
    await prisma.$executeRawUnsafe(
      `UPDATE "Company" SET "classification" = 'OPERATIONAL' WHERE "id" = '${PROJECT_COMPANY_ID.replace(/'/g, "''")}';`
    );

    console.log('✅ [initDatabaseClassification] Classificação de empresas validada no banco de dados.');
  } catch (error) {
    // Em testes ou ambientes com migrations pendentes, não derrubar a aplicação
    console.warn('⚠️ [initDatabaseClassification] Aviso ao inicializar classificação de empresas:', (error as Error).message);
  }
}
