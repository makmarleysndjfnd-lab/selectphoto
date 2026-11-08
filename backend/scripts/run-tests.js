const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

const rootDir = path.resolve(__dirname, '..');
const envTestLocalPath = path.join(rootDir, '.env.test.local');
const envPath = path.join(rootDir, '.env');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}
if (fs.existsSync(envTestLocalPath)) {
  dotenv.config({ path: envTestLocalPath, override: true });
}

process.env.NODE_ENV = 'test';
process.env.DISABLE_CRON = 'true';
if (!process.env.EXTERNAL_SERVICES_DISABLED) {
  process.env.EXTERNAL_SERVICES_DISABLED = 'true';
}

function checkPortListening(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (ok) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(ok);
      }
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

async function ensureLocalTestPostgres() {
  const dbUrl = process.env.DATABASE_URL || '';
  if (!dbUrl.includes('127.0.0.1:5433') && !dbUrl.includes('localhost:5433')) {
    return;
  }

  const isUp = await checkPortListening('127.0.0.1', 5433);
  if (!isUp) {
    const pgCtl = 'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_ctl.exe';
    const pgData = path.join(rootDir, 'pgdata');
    const pgLog = path.join(rootDir, 'pg.log');

    if (fs.existsSync(pgCtl) && fs.existsSync(pgData)) {
      console.log('[run-tests] Iniciando PostgreSQL local de testes na porta 5433...');
      spawnSync(pgCtl, ['-D', pgData, '-l', pgLog, '-o', '-p 5433', 'start'], {
        cwd: rootDir,
        stdio: 'inherit',
        windowsHide: true,
      });
    }
  }

  const prismaCli = path.join(rootDir, 'node_modules', 'prisma', 'build', 'index.js');
  if (fs.existsSync(prismaCli)) {
    spawnSync(process.execPath, [prismaCli, 'db', 'push', '--skip-generate', '--accept-data-loss'], {
      cwd: rootDir,
      env: process.env,
      stdio: 'ignore',
      windowsHide: true,
    });
  }
}

async function resetLocalTestDatabase(prisma) {
  const dbUrl = process.env.DATABASE_URL || '';
  if (!dbUrl.includes('127.0.0.1:5433') && !dbUrl.includes('localhost:5433')) {
    return;
  }
  try {
    const tables = await prisma.$queryRawUnsafe(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `);
    if (Array.isArray(tables) && tables.length > 0) {
      const tableList = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE;`);
    }
  } catch (err) {
    // Ignore if tables do not exist yet
  }
}

async function main() {
  await ensureLocalTestPostgres();
  const { PrismaClient } = require('@prisma/client');
  const cleanupPrisma = new PrismaClient();

  const rawArgs = process.argv.slice(2);
  const ignoredFlags = new Set([
    '--watchAll=false',
    '--watchAll',
    '--forceExit',
    '--runInBand',
    '--no-watch',
  ]);

  const customFiles = [];
  for (const arg of rawArgs) {
    if (ignoredFlags.has(arg)) continue;
    if (arg.startsWith('-')) continue;
    customFiles.push(arg);
  }

  const testDir = path.join(rootDir, 'test');
  const testFiles =
    customFiles.length > 0
      ? customFiles.map((f) => (path.isAbsolute(f) ? f : path.join(rootDir, f)))
      : fs
          .readdirSync(testDir)
          .filter((f) => f.endsWith('.test.ts') || f.endsWith('.spec.ts'))
          .sort()
          .map((f) => path.join(testDir, f));

  const tsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  let failed = 0;

  for (const testFile of testFiles) {
    await resetLocalTestDatabase(cleanupPrisma);
    const relPath = path.relative(rootDir, testFile);
    console.log(`\n▶ Executando suíte: ${relPath}`);
    const result = spawnSync(
      process.execPath,
      [tsxCli, '--test', '--test-concurrency=1', testFile],
      {
        cwd: rootDir,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DISABLE_CRON: 'true',
          EXTERNAL_SERVICES_DISABLED: process.env.EXTERNAL_SERVICES_DISABLED || 'true',
        },
        stdio: 'inherit',
        timeout: 180000,
        windowsHide: true,
      }
    );

    if (result.error) {
      console.error(`❌ Erro ao executar ${relPath}:`, result.error.message);
      failed++;
    } else if (result.status !== 0) {
      console.error(`❌ Falha na suíte ${relPath} (exit code ${result.status})`);
      failed++;
    }
  }

  await cleanupPrisma.$disconnect();

  if (failed > 0) {
    console.error(`\n❌ ${failed} arquivo(s) de teste falharam.`);
    process.exit(1);
  }

  console.log(`\n✅ Todos os ${testFiles.length} arquivos de teste passaram com sucesso!`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Erro fatal no executor de testes:', err);
  process.exit(1);
});

