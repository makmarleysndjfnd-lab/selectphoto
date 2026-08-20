import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'child_process';
import { assertStagingSafety } from './safety-lock';

async function testRollbackAndReapply() {
  const envPath = path.resolve(__dirname, '../.env.test.local');
  const envConfig = dotenv.parse(fs.readFileSync(envPath));
  const databaseUrl = envConfig.DATABASE_URL;

  assertStagingSafety(databaseUrl, 'TEST_ROLLBACK');

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const rollbackSqlPath = path.resolve(__dirname, '../prisma/migrations/20260818163000_reconcile_schema/rollback.sql');
  const rollbackSql = fs.readFileSync(rollbackSqlPath, 'utf8');

  console.log('====================================================');
  console.log('        TESTE DE ROLLBACK NO BANCO DE STAGING       ');
  console.log('====================================================');

  try {
    // 1. Executa script de Rollback statement por statement
    console.log('1. Executando rollback.sql...');
    const rollbackStatements = rollbackSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const stmt of rollbackStatements) {
      await prisma.$executeRawUnsafe(stmt);
    }

    // Remove registro de migration para permitir reaplicação limpa via Prisma
    await prisma.$executeRawUnsafe(`
      DELETE FROM "_prisma_migrations" WHERE migration_name = '20260818163000_reconcile_schema';
    `);

    console.log('✅ rollback.sql executado com sucesso.');

    // 2. Verifica se tabelas foram removidas
    const res: any = await prisma.$queryRawUnsafe(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('PersonalAppointment', 'ClientEditRequest', 'DailyClosing', 'Notification');
    `);
    console.log(`2. Tabelas reconciliadas restantes após rollback: ${res.length} (esperado: 0)`);

    if (res.length !== 0) {
      throw new Error('❌ Falha no rollback: tabelas ainda existem.');
    }
    console.log('✅ Rollback comprovado.');

    // 3. Re-aplica migration de reconciliação via prisma migrate deploy para deixar staging pronto e íntegro
    console.log('\n3. Re-aplicando migration de reconciliação via prisma migrate deploy...');
    const npxExecutable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const result = spawnSync(npxExecutable, ['prisma', 'migrate', 'deploy'], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
      shell: true,
    });
    if (result.status !== 0) {
      throw new Error(`Falha ao re-aplicar migration (status ${result.status}): ${result.stderr || result.stdout || result.error}`);
    }

    // 4. Verifica se as 4 tabelas foram restauradas com sucesso
    const restoredTables: any = await prisma.$queryRawUnsafe(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('PersonalAppointment', 'ClientEditRequest', 'DailyClosing', 'Notification');
    `);
    if (restoredTables.length !== 4) {
      throw new Error(`❌ Falha na verificação pós-deploy: esperado 4 tabelas restauradas, encontrado ${restoredTables.length}`);
    }

    console.log(`✅ Staging restaurado e 100% íntegro. ${restoredTables.length}/4 tabelas ativas.`);

  } finally {
    await prisma.$disconnect();
  }
}

testRollbackAndReapply();
