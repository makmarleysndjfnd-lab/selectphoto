import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'child_process';
import { assertStagingSafety } from './safety-lock';

async function rebuildCleanStaging() {
  const envPath = path.resolve(__dirname, '../.env.test.local');
  const envConfig = dotenv.parse(fs.readFileSync(envPath));
  const databaseUrl = envConfig.DATABASE_URL;

  assertStagingSafety(databaseUrl, 'REBUILD_CLEAN_STAGING');

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

  try {
    console.log('1. Limpando schema public no banco descartável de staging...');
    await prisma.$executeRawUnsafe(`DROP SCHEMA public CASCADE;`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA public;`);

    console.log('2. Aplicando todas as migrations via prisma migrate deploy...');
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
      process.exit(1);
    }
    console.log('✅ Banco de staging local 100% reconstruído e pronto.');
  } finally {
    await prisma.$disconnect();
  }
}

rebuildCleanStaging();
