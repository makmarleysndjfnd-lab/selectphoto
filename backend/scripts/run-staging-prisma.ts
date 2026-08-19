import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import { assertStagingSafety } from './safety-lock';

async function runStagingPrisma() {
  const envPath = path.resolve(__dirname, '../.env.test.local');

  if (!fs.existsSync(envPath)) {
    console.error('❌ ERRO: .env.test.local não encontrado.');
    process.exit(1);
  }

  const envConfig = dotenv.parse(fs.readFileSync(envPath));
  const databaseUrl = envConfig.DATABASE_URL;

  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('❌ Especifique o comando Prisma a executar (ex: migrate status).');
    process.exit(1);
  }

  // Trava de segurança rigorosa
  assertStagingSafety(databaseUrl, `PRISMA_${args[0].toUpperCase()}`);

  console.log(`🚀 Executando: npx prisma ${args.join(' ')}`);
  console.log(`📍 Alvo exclusivo: 127.0.0.1:5432/selectphoto_staging_local\n`);

  // Executa o Prisma com a DATABASE_URL explicitamente injetada no ambiente do subprocesso
  const child = spawn('npx.cmd', ['prisma', ...args], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
    stdio: 'inherit',
    shell: true,
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

runStagingPrisma();
