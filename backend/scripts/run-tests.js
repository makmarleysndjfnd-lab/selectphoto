const fs = require('fs');
const os = require('os');
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

const EXPECTED_TEST_DB = {
  allowedHosts: ['127.0.0.1', 'localhost', '::1'],
  expectedPort: 5433,
  allowedDatabases: ['selectphoto_capacity_test', 'selectphoto_test'],
  allowedUsers: ['postgres', 'selectphoto_test_user'],
};

function validateTestDatabaseUrlOrAbort(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('🛑 [TEST-DB-GUARD] Operação abortada: DATABASE_URL de teste ausente.');
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('🛑 [TEST-DB-GUARD] Operação abortada: DATABASE_URL de teste malformada.');
  }

  const host = (parsed.hostname || '').toLowerCase();
  const port = parsed.port ? parseInt(parsed.port, 10) : 5432;
  const database = (parsed.pathname || '').replace(/^\/+/, '').trim();
  const user = decodeURIComponent(parsed.username || '').trim();

  if (!EXPECTED_TEST_DB.allowedHosts.includes(host)) {
    throw new Error(
      `🛑 [TEST-DB-GUARD] Operação abortada: host "${host}" não é permitido para testes (permitidos: ${EXPECTED_TEST_DB.allowedHosts.join(', ')}).`
    );
  }
  if (port !== EXPECTED_TEST_DB.expectedPort) {
    throw new Error(
      `🛑 [TEST-DB-GUARD] Operação abortada: porta ${port} diverge da porta exclusiva de testes (${EXPECTED_TEST_DB.expectedPort}).`
    );
  }
  if (!EXPECTED_TEST_DB.allowedDatabases.includes(database)) {
    throw new Error(
      `🛑 [TEST-DB-GUARD] Operação abortada: banco "${database}" não é exclusivo de testes (${EXPECTED_TEST_DB.allowedDatabases.join(', ')}).`
    );
  }
  if (!EXPECTED_TEST_DB.allowedUsers.includes(user)) {
    throw new Error(
      `🛑 [TEST-DB-GUARD] Operação abortada: usuário "${user}" não é exclusivo de testes (${EXPECTED_TEST_DB.allowedUsers.join(', ')}).`
    );
  }

  return { host, port, database, user };
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

let startedPgDataDir = null;
const pgBinDir = 'C:\\Program Files\\PostgreSQL\\18\\bin';
const pgCtl = path.join(pgBinDir, 'pg_ctl.exe');
const initDbBin = path.join(pgBinDir, 'initdb.exe');
const createDbBin = path.join(pgBinDir, 'createdb.exe');

function stopStartedPostgresIfNeeded() {
  if (startedPgDataDir && fs.existsSync(pgCtl)) {
    try {
      spawnSync(pgCtl, ['-D', startedPgDataDir, '-m', 'fast', 'stop'], {
        cwd: rootDir,
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch (_) {}
    startedPgDataDir = null;
  }
}

async function ensureLocalTestPostgres() {
  const urlCfg = validateTestDatabaseUrlOrAbort(process.env.DATABASE_URL);

  const isUp = await checkPortListening('127.0.0.1', urlCfg.port);
  if (!isUp && fs.existsSync(pgCtl)) {
    const rootPgData = path.join(rootDir, 'pgdata');
    const tmpPgData = path.join(os.tmpdir(), 'selectphoto_pg5433');
    const pgData = fs.existsSync(path.join(rootPgData, 'PG_VERSION')) ? rootPgData : tmpPgData;
    const pgLog = path.join(pgData, 'postgres.log');

    if (!fs.existsSync(path.join(pgData, 'PG_VERSION')) && fs.existsSync(initDbBin)) {
      fs.mkdirSync(pgData, { recursive: true });
      spawnSync(initDbBin, ['-D', pgData, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--no-locale'], {
        cwd: rootDir,
        stdio: 'ignore',
        windowsHide: true,
      });
    }

    if (fs.existsSync(path.join(pgData, 'PG_VERSION'))) {
      const pidFile = path.join(pgData, 'postmaster.pid');
      if (fs.existsSync(pidFile)) {
        try {
          fs.unlinkSync(pidFile);
        } catch (_) {}
      }
      console.log(`[run-tests] Iniciando PostgreSQL local de testes na porta ${urlCfg.port}...`);
      spawnSync(pgCtl, ['-D', pgData, '-l', pgLog, '-o', `-p ${urlCfg.port} -h 127.0.0.1`, 'start'], {
        cwd: rootDir,
        stdio: 'ignore',
        windowsHide: true,
      });
      startedPgDataDir = pgData;

      for (let i = 0; i < 25; i++) {
        const ready = await checkPortListening('127.0.0.1', urlCfg.port, 200);
        if (ready) break;
        await new Promise((r) => setTimeout(r, 200));
      }

      if (fs.existsSync(createDbBin)) {
        spawnSync(createDbBin, ['-h', '127.0.0.1', '-p', String(urlCfg.port), '-U', urlCfg.user, urlCfg.database], {
          cwd: rootDir,
          stdio: 'ignore',
          windowsHide: true,
        });
      }
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
  const urlCfg = validateTestDatabaseUrlOrAbort(process.env.DATABASE_URL);

  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      current_database() AS db,
      current_user AS usr,
      COALESCE(inet_server_addr()::text, '127.0.0.1') AS addr,
      COALESCE(inet_server_port(), 0)::int AS port
  `);

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('🛑 [TEST-DB-GUARD] Operação abortada: impossível verificar conexão efetiva do banco.');
  }

  const effective = rows[0];
  const effectiveAddr = String(effective.addr || '')
    .toLowerCase()
    .replace(/\/\d+$/, '');
  const effectivePort = Number(effective.port);
  const effectiveDb = String(effective.db || '').trim();
  const effectiveUser = String(effective.usr || '').trim();

  if (!EXPECTED_TEST_DB.allowedHosts.includes(effectiveAddr)) {
    throw new Error(
      `🛑 [TEST-DB-GUARD] Operação abortada: host efetivo conectado (${effectiveAddr}) não é local de teste.`
    );
  }
  if (effectivePort !== EXPECTED_TEST_DB.expectedPort || effectivePort !== urlCfg.port) {
    throw new Error(
      `🛑 [TEST-DB-GUARD] Operação abortada: porta efetiva conectada (${effectivePort}) diverge de ${EXPECTED_TEST_DB.expectedPort}.`
    );
  }
  if (effectiveDb !== urlCfg.database || !EXPECTED_TEST_DB.allowedDatabases.includes(effectiveDb)) {
    throw new Error(
      `🛑 [TEST-DB-GUARD] Operação abortada: banco efetivo conectado ("${effectiveDb}") diverge do banco de testes ("${urlCfg.database}").`
    );
  }
  if (effectiveUser !== urlCfg.user || !EXPECTED_TEST_DB.allowedUsers.includes(effectiveUser)) {
    throw new Error(
      `🛑 [TEST-DB-GUARD] Operação abortada: usuário efetivo conectado ("${effectiveUser}") diverge do usuário de testes ("${urlCfg.user}").`
    );
  }

  const tables = await prisma.$queryRawUnsafe(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `);
  if (Array.isArray(tables) && tables.length > 0) {
    const tableList = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE;`);
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
  const srcTestsDir = path.join(rootDir, 'src', '__tests__');

  let defaultFiles = [];
  if (fs.existsSync(testDir)) {
    defaultFiles.push(
      ...fs
        .readdirSync(testDir)
        .filter((f) => f.endsWith('.test.ts') || f.endsWith('.spec.ts'))
        .sort()
        .map((f) => path.join(testDir, f))
    );
  }
  if (fs.existsSync(srcTestsDir)) {
    defaultFiles.push(
      ...fs
        .readdirSync(srcTestsDir)
        .filter((f) => f.endsWith('.test.ts') || f.endsWith('.spec.ts'))
        .sort()
        .map((f) => path.join(srcTestsDir, f))
    );
  }

  const testFiles =
    customFiles.length > 0
      ? customFiles.map((f) => (path.isAbsolute(f) ? f : path.join(rootDir, f)))
      : defaultFiles;

  const tsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  let failed = 0;

  for (const testFile of testFiles) {
    await resetLocalTestDatabase(cleanupPrisma);
    const relPath = path.relative(rootDir, testFile);
    console.log(`\n▶ Executando suíte (sem --test-force-exit): ${relPath}`);
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
  stopStartedPostgresIfNeeded();

  if (failed > 0) {
    console.error(`\n❌ ${failed} arquivo(s) de teste falharam.`);
    process.exit(1);
  }

  console.log(`\n✅ Todos os ${testFiles.length} arquivos de teste encerraram sozinhos e passaram com sucesso!`);
  process.exit(0);
}

main().catch((err) => {
  stopStartedPostgresIfNeeded();
  console.error('❌ Erro fatal no executor de testes:', err);
  process.exit(1);
});
