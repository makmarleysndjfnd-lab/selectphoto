import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'child_process';
import { assertStagingSafety } from './safety-lock';

async function restoreReconciledSchema() {
  const envPath = path.resolve(__dirname, '../.env.test.local');
  const envConfig = dotenv.parse(fs.readFileSync(envPath));
  const databaseUrl = envConfig.DATABASE_URL;

  assertStagingSafety(databaseUrl, 'RESTORE_STAGING_SCHEMA');

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

  try {
    console.log('Removendo registro de reconciliação de _prisma_migrations para reaplicação limpa...');
    await prisma.$executeRawUnsafe(`
      DELETE FROM "_prisma_migrations" WHERE migration_name = '20260818163000_reconcile_schema';
    `);

    console.log('Executando prisma migrate deploy...');
    const npxExecutable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const result = spawnSync(npxExecutable, ['prisma', 'migrate', 'deploy'], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
      shell: false,
    });
    console.log(result.stdout);
    if (result.status !== 0) {
      console.error(result.stderr);
    }
  } finally {
    await prisma.$disconnect();
  }
}

restoreReconciledSchema();
