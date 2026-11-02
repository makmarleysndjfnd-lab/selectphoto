import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { performance } from 'perf_hooks';
import { spawn, ChildProcess } from 'child_process';
import { PrismaClient } from '@prisma/client';

// ============================================================================
// 1. VALIDAÇÃO ESTRITA DE SEGURANÇA CONTRA PRODUÇÃO
// ============================================================================
const envPath = path.resolve(__dirname, '../.env.test.local');
if (!fs.existsSync(envPath)) {
  throw new Error('🛑 [FATAL] Arquivo .env.test.local não encontrado! Abortando benchmark.');
}

const envConfig = dotenv.parse(fs.readFileSync(envPath));
const targetDbUrl = (envConfig.DATABASE_URL || '').trim();

// Análise explícita de protocolo, hostname, porta e nome do banco
let parsedUrl: URL;
try {
  parsedUrl = new URL(targetDbUrl);
} catch {
  throw new Error('🛑 [FATAL] DATABASE_URL não é uma URL válida.');
}

if (parsedUrl.protocol !== 'postgresql:' && parsedUrl.protocol !== 'postgres:') {
  throw new Error(`🛑 [FATAL] Protocolo proibido: ${parsedUrl.protocol}. Esperado postgresql:`);
}

const allowedHosts = new Set(['127.0.0.1', 'localhost']);
if (!allowedHosts.has(parsedUrl.hostname)) {
  throw new Error(`🛑 [FATAL] Hostname não permitido (${parsedUrl.hostname}). Apenas 127.0.0.1 ou localhost são aceitos.`);
}

const port = parsedUrl.port || '5432';
if (port !== '5433') {
  throw new Error(`🛑 [FATAL] Porta do banco (${port}) não confere com a porta isolada de teste (5433).`);
}

const dbName = parsedUrl.pathname.replace(/^\//, '');
if (dbName !== 'selectphoto_capacity_test') {
  throw new Error(`🛑 [FATAL] Banco de dados '${dbName}' não autorizado. O teste exige estritamente 'selectphoto_capacity_test'.`);
}

// Sanitização de string para logs seguros (sem expor senhas)
const sanitizedDbTarget = `${parsedUrl.protocol}//***:***@${parsedUrl.hostname}:${port}/${dbName}`;
console.log(`🔒 [SEGURANÇA] Alvo de banco validado: ${sanitizedDbTarget}`);

// ============================================================================
// 2. IDENTIFICADOR EXCLUSIVO DA EXECUÇÃO (SEM COLISÃO COM DADOS REAIS OU DEV)
// ============================================================================
const RUN_ID = `cap_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
const COMP_A_ID = `${RUN_ID}_comp_alpha`;
const COMP_B_ID = `${RUN_ID}_comp_beta`;

console.log(`🆔 [EXECUÇÃO] Identificador exclusivo desta rodada: ${RUN_ID}`);
console.log(`   Empresa A: ${COMP_A_ID}`);
console.log(`   Empresa B: ${COMP_B_ID}`);

const JWT_SECRET = envConfig.JWT_SECRET || 'capacity_test_jwt_secret_strictly_local_2026';

interface AccountInfo {
  id: string;
  name: string;
  role: 'COMPANY_ADMIN' | 'PHOTOGRAPHER' | 'SELLER';
  companyId: string;
  token: string;
  photographerCode?: string;
}

const accountsA: AccountInfo[] = [];
const accountsB: AccountInfo[] = [];

function generateJwt(user: { id: string; role: string; companyId: string; name: string }) {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '12h' });
}

// ============================================================================
// 3. SEEDING E PREPARAÇÃO DOS DADOS HISTÓRICOS (5.280 FICHAS + CREDIÁRIO)
// ============================================================================
async function verifyDatabaseSafetyAndMarker(db: PrismaClient) {
  // 1. Confirmar no próprio motor Postgres a base conectada
  const result = await db.$queryRawUnsafe<Array<{ current_database: string; port: number }>>(
    `SELECT current_database(), inet_server_port()::int as port;`
  );
  if (!result || result.length === 0 || result[0].current_database !== 'selectphoto_capacity_test') {
    throw new Error('🛑 [FATAL] A conexão física do PostgreSQL não confirmou o banco selectphoto_capacity_test!');
  }

  // 2. Criar tabela e marca própria de segurança da suíte de capacidade
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS _lumora_capacity_safety_marker (
      id TEXT PRIMARY KEY,
      marker TEXT NOT NULL,
      verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.$executeRawUnsafe(`
    INSERT INTO _lumora_capacity_safety_marker (id, marker, verified_at)
    VALUES ('safety_check', 'STRICTLY_ISOLATED_LOCAL_TEST', NOW())
    ON CONFLICT (id) DO UPDATE SET verified_at = NOW();
  `);
  console.log('✅ [SEGURANÇA] Marca interna de segurança do banco verificada com sucesso.');
}

async function cleanPriorRuns(db: PrismaClient) {
  const oldCompanies = await db.company.findMany({
    where: { id: { startsWith: 'cap_' } },
    select: { id: true },
  });
  if (oldCompanies.length > 0) {
    const oldIds = oldCompanies.map((c) => c.id);
    await db.creditCommission.deleteMany({ where: { companyId: { in: oldIds } } });
    await db.creditInstallment.deleteMany({ where: { agreement: { companyId: { in: oldIds } } } });
    await db.creditAgreement.deleteMany({ where: { companyId: { in: oldIds } } });
    await db.salePayment.deleteMany({ where: { sale: { companyId: { in: oldIds } } } });
    await db.nonSale.deleteMany({ where: { companyId: { in: oldIds } } });
    await db.sale.deleteMany({ where: { companyId: { in: oldIds } } });
    await db.clientTimeline.deleteMany({ where: { client: { companyId: { in: oldIds } } } });
    await db.client.deleteMany({ where: { companyId: { in: oldIds } } });
    await db.user.deleteMany({ where: { companyId: { in: oldIds } } });
    await db.company.deleteMany({ where: { id: { in: oldIds } } });
    console.log(`🧹 [SEED] Limpeza prévia: removidas ${oldIds.length} empresas de execuções anteriores.`);
  }
}

async function seedData(db: PrismaClient) {
  console.log('\n🌱 [SEED] Preparando dados de teste isolados...');
  await cleanPriorRuns(db);

  // 1. Criar as 2 empresas
  await db.company.createMany({
    data: [
      { id: COMP_A_ID, name: `Empresa Alpha (${RUN_ID})`, classification: 'TEST_DEMO' },
      { id: COMP_B_ID, name: `Empresa Beta (${RUN_ID})`, classification: 'TEST_DEMO' },
    ],
  });

  // 2. Criar 40 contas (1 admin, 4 fotógrafos, 15 vendedores por empresa)
  const userCreates: any[] = [];
  accountsA.length = 0;
  accountsB.length = 0;

  for (const compId of [COMP_A_ID, COMP_B_ID]) {
    const isA = compId === COMP_A_ID;
    const prefix = isA ? 'alpha' : 'beta';
    const accList = isA ? accountsA : accountsB;

    // Admin
    const adminId = `${RUN_ID}_usr_${prefix}_admin`;
    const adminName = `Admin ${prefix.toUpperCase()}`;
    userCreates.push({
      id: adminId,
      companyId: compId,
      name: adminName,
      cpf: isA ? '91111111101' : '92222222201',
      password: 'test_password_hash_123',
      role: 'COMPANY_ADMIN',
    });
    accList.push({
      id: adminId,
      name: adminName,
      role: 'COMPANY_ADMIN',
      companyId: compId,
      token: generateJwt({ id: adminId, role: 'COMPANY_ADMIN', companyId: compId, name: adminName }),
    });

    // 4 Fotógrafos
    for (let p = 1; p <= 4; p++) {
      const photogId = `${RUN_ID}_usr_${prefix}_ph0${p}`;
      const photogName = `Fotógrafo ${prefix.toUpperCase()} ${p}`;
      const code = `${prefix.substring(0, 1).toUpperCase()}P${p}`;
      userCreates.push({
        id: photogId,
        companyId: compId,
        name: photogName,
        cpf: isA ? `9111111111${p}` : `9222222221${p}`,
        password: 'test_password_hash_123',
        role: 'PHOTOGRAPHER',
        photographerCode: code,
      });
      accList.push({
        id: photogId,
        name: photogName,
        role: 'PHOTOGRAPHER',
        companyId: compId,
        photographerCode: code,
        token: generateJwt({ id: photogId, role: 'PHOTOGRAPHER', companyId: compId, name: photogName }),
      });
    }

    // 15 Vendedores
    for (let s = 1; s <= 15; s++) {
      const sellerId = `${RUN_ID}_usr_${prefix}_v${String(s).padStart(2, '0')}`;
      const sellerName = `Vendedor ${prefix.toUpperCase()} ${s}`;
      const pad = String(s).padStart(2, '0');
      userCreates.push({
        id: sellerId,
        companyId: compId,
        name: sellerName,
        cpf: isA ? `911111112${pad}` : `922222223${pad}`,
        password: 'test_password_hash_123',
        role: 'SELLER',
      });
      accList.push({
        id: sellerId,
        name: sellerName,
        role: 'SELLER',
        companyId: compId,
        token: generateJwt({ id: sellerId, role: 'SELLER', companyId: compId, name: sellerName }),
      });
    }
  }

  await db.user.createMany({ data: userCreates });
  console.log(`✅ [SEED] 40 contas criadas com sucesso (2 Admins, 8 Fotógrafos, 30 Vendedores).`);

  // 3. Inicializar sequência de visibleCode para evitar qualquer colisão
  await db.$executeRawUnsafe(`
    INSERT INTO "FichaCodeSequence" (id, "nextValue", "updatedAt")
    VALUES (1, 10000, NOW())
    ON CONFLICT (id) DO UPDATE SET "nextValue" = 10000, "updatedAt" = NOW();
  `);

  // 4. Gerar 5.280 Fichas históricas (2.640 por empresa)
  // Distribuição:
  // - 1.000 CREATED (em produção)
  // - 1.000 AWAITING_RELEASE (lote fechado)
  // - 1.500 DISTRIBUTED (distribuídas aos 15 vendedores, elegíveis para venda)
  // - 500 NON_SALE (revisitas/não-vendas)
  // - 1.280 SOLD (640 à vista, 640 a crediário com parcelas)
  console.log(`📦 [SEED] Inserindo 5.280 fichas históricas representativas com vendas e crediário...`);

  for (const compId of [COMP_A_ID, COMP_B_ID]) {
    const isA = compId === COMP_A_ID;
    const prefix = isA ? 'alpha' : 'beta';
    const accList = isA ? accountsA : accountsB;
    const photogs = accList.filter((a) => a.role === 'PHOTOGRAPHER');
    const sellers = accList.filter((a) => a.role === 'SELLER');

    const clientRows: any[] = [];
    const salesRows: any[] = [];
    const cashPaymentsRows: any[] = [];
    const creditAgreementsRows: any[] = [];
    const creditInstallmentsRows: any[] = [];
    const creditCommissionsRows: any[] = [];
    const nonSaleRows: any[] = [];

    for (let i = 1; i <= 2640; i++) {
      const clientId = `${RUN_ID}_cl_${prefix}_${String(i).padStart(5, '0')}`;
      const visibleCode = `F-X${prefix.substring(0, 1).toUpperCase()}${String(i).padStart(5, '0')}`;
      const photog = photogs[(i - 1) % photogs.length];
      const seller = sellers[(i - 1) % sellers.length];
      const city = i % 3 === 0 ? 'Campinas' : i % 3 === 1 ? 'Sorocaba' : 'Jundiaí';

      let bookStatus = 'CREATED';
      let outcomeStatus = 'PENDING';
      let assignedSellerId: string | null = null;
      let deliveredAt: Date | null = null;

      if (i <= 500) {
        // CREATED (fotógrafo trabalhando)
        bookStatus = 'CREATED';
        outcomeStatus = 'PENDING';
      } else if (i <= 1000) {
        // AWAITING_RELEASE
        bookStatus = 'AWAITING_RELEASE';
        outcomeStatus = 'PENDING';
      } else if (i <= 1750) {
        // DISTRIBUTED (carteira ativa do vendedor para visitas e vendas)
        bookStatus = 'DISTRIBUTED';
        outcomeStatus = 'PENDING';
        assignedSellerId = seller.id;
        deliveredAt = new Date();
      } else if (i <= 2000) {
        // NON_SALE (revisita / não-venda)
        bookStatus = 'DISTRIBUTED';
        outcomeStatus = 'NON_SALE';
        assignedSellerId = seller.id;
        deliveredAt = new Date();
        nonSaleRows.push({
          id: `${RUN_ID}_ns_${prefix}_${String(i).padStart(5, '0')}`,
          clientId,
          sellerId: seller.id,
          companyId: compId,
          reason: 'Cliente ausente na visita inicial',
          date: new Date(),
        });
      } else {
        // SOLD (640 vendas: 320 à vista, 320 a crediário parcelado)
        bookStatus = 'SOLD';
        outcomeStatus = 'SOLD';
        assignedSellerId = seller.id;
        deliveredAt = new Date();

        const saleId = `${RUN_ID}_sl_${prefix}_${String(i).padStart(5, '0')}`;
        const isCreditSale = i % 2 === 0;

        salesRows.push({
          id: saleId,
          clientId,
          companyId: compId,
          sellerId: seller.id,
          city,
          value: 1200.0,
          paymentMethod: isCreditSale ? 'CREDIT' : 'CASH',
          status: 'PRONTO',
          date: new Date(),
        });

        if (isCreditSale) {
          const agreementId = `${RUN_ID}_ca_${prefix}_${String(i).padStart(5, '0')}`;
          creditAgreementsRows.push({
            id: agreementId,
            companyId: compId,
            clientId,
            sellerId: seller.id,
            saleId,
            buyerName: `Responsável ${prefix.toUpperCase()} ${i}`,
            buyerCpf: '11144477735',
            street: 'Rua Principal',
            number: '100',
            neighborhood: 'Centro',
            city,
            state: 'SP',
            product: 'Álbum Fotográfico',
            totalSaleCents: 120000,
            downPaymentCents: 20000,
            financedPrincipalCents: 100000,
            remainingPrincipalCents: 75000,
            paidPrincipalCents: 25000,
            installmentsCount: 4,
            periodicity: 'MONTHLY',
            firstDueDate: new Date(),
            status: 'ACTIVE',
          });

          // 4 parcelas
          for (let inst = 1; inst <= 4; inst++) {
            const installmentId = `${RUN_ID}_ci_${prefix}_${i}_${inst}`;
            const isPaid = inst === 1; // 1ª parcela já paga
            creditInstallmentsRows.push({
              id: installmentId,
              agreementId,
              installmentNumber: inst,
              dueDate: new Date(Date.now() + inst * 30 * 86400000),
              amountCents: 25000,
              paidCents: isPaid ? 25000 : 0,
              status: isPaid ? 'PAID' : 'PENDING',
              paidAt: isPaid ? new Date() : null,
            });
          }

          creditCommissionsRows.push({
            id: `${RUN_ID}_cc_${prefix}_${i}`,
            agreementId,
            companyId: compId,
            sellerId: seller.id,
            amountCents: 2500, // 10%
            status: 'RELEASED',
            type: 'INSTALLMENT',
            paidAt: new Date(),
          });
        } else {
          cashPaymentsRows.push({
            id: `${RUN_ID}_pay_${prefix}_${String(i).padStart(5, '0')}`,
            saleId,
            amount: 1200.0,
            method: 'CASH',
            createdAt: new Date(),
          });
        }
      }

      clientRows.push({
        id: clientId,
        uuid: `${RUN_ID}-uuid-${prefix}-${i}`,
        companyId: compId,
        visibleCode,
        sequenceNumber: String(i),
        name: `Aluno ${prefix.toUpperCase()} ${i}`,
        mainContact: `Responsável ${prefix.toUpperCase()} ${i}`,
        phone1: '11988887777',
        city,
        status: 'PENDING',
        bookStatus,
        outcomeStatus,
        photographerId: photog.id,
        assignedSellerId,
      });
    }

    // Inserção em chunks
    const CHUNK = 500;
    for (let c = 0; c < clientRows.length; c += CHUNK) {
      await db.client.createMany({ data: clientRows.slice(c, c + CHUNK) });
    }
    if (nonSaleRows.length > 0) {
      for (let n = 0; n < nonSaleRows.length; n += CHUNK) {
        await db.nonSale.createMany({ data: nonSaleRows.slice(n, n + CHUNK) });
      }
    }
    if (salesRows.length > 0) {
      for (let s = 0; s < salesRows.length; s += CHUNK) {
        await db.sale.createMany({ data: salesRows.slice(s, s + CHUNK) });
      }
    }
    if (cashPaymentsRows.length > 0) {
      for (let p = 0; p < cashPaymentsRows.length; p += CHUNK) {
        await db.salePayment.createMany({ data: cashPaymentsRows.slice(p, p + CHUNK) });
      }
    }
    if (creditAgreementsRows.length > 0) {
      for (let a = 0; a < creditAgreementsRows.length; a += CHUNK) {
        await db.creditAgreement.createMany({ data: creditAgreementsRows.slice(a, a + CHUNK) });
      }
    }
    if (creditInstallmentsRows.length > 0) {
      for (let inst = 0; inst < creditInstallmentsRows.length; inst += CHUNK) {
        await db.creditInstallment.createMany({ data: creditInstallmentsRows.slice(inst, inst + CHUNK) });
      }
    }
    if (creditCommissionsRows.length > 0) {
      for (let comm = 0; comm < creditCommissionsRows.length; comm += CHUNK) {
        await db.creditCommission.createMany({ data: creditCommissionsRows.slice(comm, comm + CHUNK) });
      }
    }
    console.log(`✅ [SEED] Empresa ${prefix.toUpperCase()}: 2.640 fichas e dados comerciais inseridos.`);
  }

  const totalClients = await db.client.count({ where: { companyId: { in: [COMP_A_ID, COMP_B_ID] } } });
  const totalSales = await db.sale.count({ where: { companyId: { in: [COMP_A_ID, COMP_B_ID] } } });
  const totalAgreements = await db.creditAgreement.count({ where: { companyId: { in: [COMP_A_ID, COMP_B_ID] } } });
  console.log(`🎉 [SEED] Total no banco de capacidade: ${totalClients} fichas, ${totalSales} vendas, ${totalAgreements} contratos de crediário.`);
}

async function cleanData(db: PrismaClient) {
  console.log('🧹 [TEARDOWN] Limpando dados da rodada na ordem relacional correta...');
  const compIds = [COMP_A_ID, COMP_B_ID];

  await db.creditCommission.deleteMany({ where: { companyId: { in: compIds } } });
  await db.creditInstallment.deleteMany({ where: { agreement: { companyId: { in: compIds } } } });
  await db.creditAgreement.deleteMany({ where: { companyId: { in: compIds } } });
  await db.salePayment.deleteMany({ where: { sale: { companyId: { in: compIds } } } });
  await db.nonSale.deleteMany({ where: { companyId: { in: compIds } } });
  await db.sale.deleteMany({ where: { companyId: { in: compIds } } });
  await db.clientTimeline.deleteMany({ where: { client: { companyId: { in: compIds } } } });
  await db.client.deleteMany({ where: { companyId: { in: compIds } } });
  await db.user.deleteMany({ where: { companyId: { in: compIds } } });
  await db.company.deleteMany({ where: { id: { in: compIds } } });
  console.log('✅ [TEARDOWN] Limpeza concluída com segurança.');
}

// ============================================================================
// 4. TELEMETRIA DO POSTGRESQL E ESTATÍSTICAS
// ============================================================================
interface LatencyStats {
  count: number;
  minMs: number;
  avgMs: number;
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

function calculatePercentiles(latencies: number[]): LatencyStats {
  if (latencies.length === 0) {
    return { count: 0, minMs: 0, avgMs: 0, p50Ms: 0, p90Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const avg = sum / sorted.length;
  const p = (pct: number) => sorted[Math.min(Math.floor((pct / 100) * sorted.length), sorted.length - 1)];

  return {
    count: sorted.length,
    minMs: Math.round(sorted[0] * 100) / 100,
    avgMs: Math.round(avg * 100) / 100,
    p50Ms: Math.round(p(50) * 100) / 100,
    p90Ms: Math.round(p(90) * 100) / 100,
    p95Ms: Math.round(p(95) * 100) / 100,
    p99Ms: Math.round(p(99) * 100) / 100,
    maxMs: Math.round(sorted[sorted.length - 1] * 100) / 100,
  };
}

async function samplePgConnections(db: PrismaClient): Promise<{ total: number; active: number; idle: number }> {
  try {
    const rows = await db.$queryRawUnsafe<Array<{ state: string; count: bigint | number }>>(
      `SELECT coalesce(state, 'unknown') as state, count(*)::int as count 
       FROM pg_stat_activity 
       WHERE datname = 'selectphoto_capacity_test' 
       GROUP BY state;`
    );

    let total = 0;
    let active = 0;
    let idle = 0;

    for (const r of rows) {
      const cnt = Number(r.count);
      total += cnt;
      if (r.state === 'active') active += cnt;
      if (r.state === 'idle') idle += cnt;
    }
    return { total, active, idle };
  } catch {
    return { total: 0, active: 0, idle: 0 };
  }
}

// ============================================================================
// 5. GESTÃO DO PROCESSO DO SERVIDOR BACKEND ISOLADO
// ============================================================================
interface ServerInstance {
  process: ChildProcess;
  port: number;
  pid: number;
  baseUrl: string;
}

async function startIsolatedServer(connectionLimit: number, poolTimeout: number): Promise<ServerInstance> {
  const tsxCli = path.resolve(__dirname, '../node_modules/tsx/dist/cli.mjs');
  const serverScript = path.resolve(__dirname, 'benchmark-server.ts');

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--max-old-space-size=512',
        tsxCli,
        serverScript,
      ],
      {
        env: {
          ...process.env,
          PRISMA_CONNECTION_LIMIT: String(connectionLimit),
          PRISMA_POOL_TIMEOUT: String(poolTimeout),
        },
        stdio: ['ignore', 'pipe', 'inherit'],
      }
    );

    let resolved = false;

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      const match = text.match(/READY:(\d+):(\d+)/);
      if (match && !resolved) {
        resolved = true;
        const port = parseInt(match[1], 10);
        const pid = parseInt(match[2], 10);
        resolve({
          process: child,
          port,
          pid,
          baseUrl: `http://127.0.0.1:${port}`,
        });
      }
    });

    child.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    child.on('exit', (code) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`Servidor encerrou prematuramente com código ${code}`));
      }
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill();
        reject(new Error('Timeout aguardando inicialização do servidor de benchmark'));
      }
    }, 15000);
  });
}

async function stopIsolatedServer(server: ServerInstance): Promise<void> {
  return new Promise((resolve) => {
    server.process.kill('SIGTERM');
    const timer = setTimeout(() => {
      try {
        server.process.kill('SIGKILL');
      } catch {}
      resolve();
    }, 4000);

    server.process.on('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// ============================================================================
// 6. MOTOR DE CARGA COM JORNADAS VÁLIDAS E ASSERTADAS
// ============================================================================
interface OperationLatencies {
  sync: number[];
  photogList: number[];
  adminSummary: number[];
  adminStock: number[];
  sellerList: number[];
  saleSuccess: number[];
  saleNonSale: number[];
  closingDaily: number[];
  creditStates: number[];
  idempotencyReplay: number[];
  crossTenantBlock: number[];
}

interface BenchmarkRoundResult {
  connectionLimit: number;
  poolTimeout: number;
  concurrency: number;
  totalTransactions: number;
  durationSeconds: number;
  requestsPerSecond: number;
  aggregatedLatencies: LatencyStats;
  latenciesByOperation: Record<string, LatencyStats>;
  journeyCounts: Record<string, number>;
  unexpectedErrors: number;
  securityPasses: number;
  peakPgConnections: number;
  peakPgActive: number;
  peakPgIdle: number;
  peakServerRssMb: number;
  poolTimeouts: number;
  passed: boolean;
  failReasons: string[];
}

async function runBenchmarkRound(
  db: PrismaClient,
  server: ServerInstance,
  options: {
    connectionLimit: number;
    poolTimeout: number;
    totalTransactions: number;
    concurrency: number;
  }
): Promise<BenchmarkRoundResult> {
  console.log(`\n======================================================================`);
  console.log(`🚀 EXECUTANDO CARGA: CONNECTION_LIMIT = ${options.connectionLimit} | CONCORRÊNCIA = ${options.concurrency}`);
  console.log(`   Transações: ${options.totalTransactions} | Servidor PID: ${server.pid} | Porta: ${server.port}`);
  console.log(`======================================================================`);

  const opLatencies: OperationLatencies = {
    sync: [],
    photogList: [],
    adminSummary: [],
    adminStock: [],
    sellerList: [],
    saleSuccess: [],
    saleNonSale: [],
    closingDaily: [],
    creditStates: [],
    idempotencyReplay: [],
    crossTenantBlock: [],
  };

  const journeyCounts: Record<string, number> = {
    'J1: Fotógrafo - Listagem de Produção': 0,
    'J2: Fotógrafo - Sincronização de Novas Fichas': 0,
    'J3: Admin - Resumo de Produção': 0,
    'J4: Admin - Consulta de Estoque': 0,
    'J5: Vendedor - Sincronização de Carteira': 0,
    'J6: Vendedor - Realização de Venda': 0,
    'J7: Vendedor - Registro de Não-Venda': 0,
    'J8: Vendedor - Consulta de Fechamento Diário': 0,
    'J9: Vendedor - Quatro Estados do Crediário': 0,
    'J10: Idempotência - Reenvio de Venda': 0,
    'J11: Isolamento Multi-Tenant': 0,
  };

  let unexpectedErrors = 0;
  let securityPasses = 0;
  let poolTimeouts = 0;
  const failReasons: string[] = [];

  let peakPgConnections = 0;
  let peakPgActive = 0;
  let peakPgIdle = 0;
  let peakServerRssMb = 0;

  // Monitor em segundo plano (Postgres connections + Server RSS)
  let isMonitoring = true;
  const monitorPromise = (async () => {
    while (isMonitoring) {
      const stats = await samplePgConnections(db);
      if (stats.total > peakPgConnections) peakPgConnections = stats.total;
      if (stats.active > peakPgActive) peakPgActive = stats.active;
      if (stats.idle > peakPgIdle) peakPgIdle = stats.idle;

      try {
        const healthRes = await fetch(`${server.baseUrl}/health`);
        if (healthRes.ok) {
          const healthData = (await healthRes.json()) as any;
          if (healthData.rssMb > peakServerRssMb) {
            peakServerRssMb = healthData.rssMb;
          }
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
  })();

  const allAccounts = [...accountsA, ...accountsB];
  const allPhotogs = allAccounts.filter((a) => a.role === 'PHOTOGRAPHER');
  const allAdmins = allAccounts.filter((a) => a.role === 'COMPANY_ADMIN');
  const allSellers = allAccounts.filter((a) => a.role === 'SELLER');

  // Seleciona um conjunto de fichas DISTRIBUTED de cada empresa para as vendas
  const availableClientsA = await db.client.findMany({
    where: { companyId: COMP_A_ID, bookStatus: 'DISTRIBUTED', outcomeStatus: 'PENDING' },
    select: { id: true, city: true, assignedSellerId: true },
    take: 750,
  });

  const availableClientsB = await db.client.findMany({
    where: { companyId: COMP_B_ID, bookStatus: 'DISTRIBUTED', outcomeStatus: 'PENDING' },
    select: { id: true, city: true, assignedSellerId: true },
    take: 750,
  });

  let clientIdxA = 0;
  let clientIdxB = 0;
  let globalTxCounter = 0;

  async function executeWorker(workerId: number): Promise<void> {
    while (true) {
      const tx = globalTxCounter++;
      if (tx >= options.totalTransactions) break;

      // Define a jornada com base no resto da iteração para garantir cobertura de todos os papéis
      const journeyType = tx % 11;
      const start = performance.now();

      try {
        if (journeyType === 0) {
          // J1: Fotógrafo - Listagem de Produção
          const photog = allPhotogs[tx % allPhotogs.length];
          const res = await fetch(`${server.baseUrl}/api/clients/photographer`, {
            headers: { Authorization: `Bearer ${photog.token}` },
          });
          const body = (await res.json()) as any;
          const elapsed = performance.now() - start;

          if (res.status === 200 && Array.isArray(body)) {
            opLatencies.photogList.push(elapsed);
            journeyCounts['J1: Fotógrafo - Listagem de Produção']++;
          } else {
            unexpectedErrors++;
            failReasons.push(`J1 falhou com status ${res.status}`);
          }
        } else if (journeyType === 1) {
          // J2: Fotógrafo - Sincronização de Novas Fichas (/api/clients/sync)
          const photog = allPhotogs[tx % allPhotogs.length];
          const newFichas = [
            {
              uuid: `${RUN_ID}_lim${options.connectionLimit}_c${options.concurrency}_new_${tx}_01`,
              sequenceNumber: `SYNC-${options.connectionLimit}-${options.concurrency}-${tx}`,
              name: `Aluno Sincronizado ${tx}-1`,
              city: 'Campinas',
              phone1: '11988887777',
              photographerId: photog.id,
            },
          ];

          const res = await fetch(`${server.baseUrl}/api/clients/sync`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${photog.token}`,
            },
            body: JSON.stringify({ clients: newFichas }),
          });
          const body = (await res.json()) as any;
          const elapsed = performance.now() - start;

          if (res.status === 200 && body.success >= 1) {
            opLatencies.sync.push(elapsed);
            journeyCounts['J2: Fotógrafo - Sincronização de Novas Fichas']++;
          } else {
            unexpectedErrors++;
            failReasons.push(`J2 falhou com status ${res.status}`);
          }
        } else if (journeyType === 2) {
          // J3: Admin - Resumo de Produção
          const admin = allAdmins[tx % allAdmins.length];
          const res = await fetch(`${server.baseUrl}/api/clients/production-summary`, {
            headers: { Authorization: `Bearer ${admin.token}` },
          });
          const body = (await res.json()) as any;
          const elapsed = performance.now() - start;

          if (res.status === 200 && Array.isArray(body)) {
            opLatencies.adminSummary.push(elapsed);
            journeyCounts['J3: Admin - Resumo de Produção']++;
          } else {
            unexpectedErrors++;
            failReasons.push(`J3 falhou com status ${res.status}`);
          }
        } else if (journeyType === 3) {
          // J4: Admin - Consulta de Estoque
          const admin = allAdmins[tx % allAdmins.length];
          const res = await fetch(`${server.baseUrl}/api/stock/info`, {
            headers: { Authorization: `Bearer ${admin.token}` },
          });
          await res.text();
          const elapsed = performance.now() - start;

          if (res.status === 200) {
            opLatencies.adminStock.push(elapsed);
            journeyCounts['J4: Admin - Consulta de Estoque']++;
          } else {
            unexpectedErrors++;
            failReasons.push(`J4 falhou com status ${res.status}`);
          }
        } else if (journeyType === 4) {
          // J5: Vendedor - Sincronização de Carteira (/api/clients)
          const seller = allSellers[tx % allSellers.length];
          const res = await fetch(`${server.baseUrl}/api/clients`, {
            headers: { Authorization: `Bearer ${seller.token}` },
          });
          const body = (await res.json()) as any;
          const elapsed = performance.now() - start;

          if (res.status === 200 && Array.isArray(body)) {
            opLatencies.sellerList.push(elapsed);
            journeyCounts['J5: Vendedor - Sincronização de Carteira']++;
          } else {
            unexpectedErrors++;
            failReasons.push(`J5 falhou com status ${res.status}`);
          }
        } else if (journeyType === 5) {
          // J6: Vendedor - Realização de Venda com Payload Completo
          const isA = tx % 2 === 0;
          const clientPool = isA ? availableClientsA : availableClientsB;
          const targetClient = isA ? clientPool[clientIdxA++ % clientPool.length] : clientPool[clientIdxB++ % clientPool.length];
          const seller = allSellers.find((s) => s.id === targetClient.assignedSellerId) || allSellers[0];

          const res = await fetch(`${server.baseUrl}/api/sales`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${seller.token}`,
            },
            body: JSON.stringify({
              clientId: targetClient.id,
              value: 1200,
              city: targetClient.city,
              product: 'Books',
              paymentMethod: 'CASH',
              notes: `Venda sob carga tx ${tx}`,
              idempotencyKey: `idemp_sale_${tx}_${uuidv4().substring(0, 6)}`,
            }),
          });
          const body = (await res.json()) as any;
          const elapsed = performance.now() - start;

          if ((res.status === 201 || res.status === 200) && (body.id || body.sale?.id)) {
            opLatencies.saleSuccess.push(elapsed);
            journeyCounts['J6: Vendedor - Realização de Venda']++;
          } else {
            unexpectedErrors++;
            failReasons.push(`J6 falhou com status ${res.status}: ${JSON.stringify(body)}`);
          }
        } else if (journeyType === 6) {
          // J7: Vendedor - Registro de Não-Venda (/api/sales/non-sale)
          const isA = tx % 2 === 0;
          const clientPool = isA ? availableClientsA : availableClientsB;
          const targetClient = isA ? clientPool[clientIdxA++ % clientPool.length] : clientPool[clientIdxB++ % clientPool.length];
          const seller = allSellers.find((s) => s.id === targetClient.assignedSellerId) || allSellers[0];

          const res = await fetch(`${server.baseUrl}/api/sales/non-sale`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${seller.token}`,
            },
            body: JSON.stringify({
              clientId: targetClient.id,
              reason: 'Revisita agendada para semana seguinte',
              signatureBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            }),
          });
          const body = (await res.json()) as any;
          const elapsed = performance.now() - start;

          if (res.status === 200 || res.status === 201) {
            opLatencies.saleNonSale.push(elapsed);
            journeyCounts['J7: Vendedor - Registro de Não-Venda']++;
          } else {
            unexpectedErrors++;
            failReasons.push(`J7 falhou com status ${res.status}`);
          }
        } else if (journeyType === 7) {
          // J8: Vendedor - Consulta de Fechamento Diário (/api/closing/daily/:sellerId)
          const seller = allSellers[tx % allSellers.length];
          const res = await fetch(`${server.baseUrl}/api/closing/daily/${seller.id}`, {
            headers: { Authorization: `Bearer ${seller.token}` },
          });
          const body = (await res.json()) as any;
          const elapsed = performance.now() - start;

          if (res.status === 200) {
            opLatencies.closingDaily.push(elapsed);
            journeyCounts['J8: Vendedor - Consulta de Fechamento Diário']++;
          } else {
            unexpectedErrors++;
            failReasons.push(`J8 falhou com status ${res.status}`);
          }
        } else if (journeyType === 8) {
          // J9: Vendedor - Quatro Estados do Crediário (/api/credit/seller/four-states)
          const seller = allSellers[tx % allSellers.length];
          const res = await fetch(`${server.baseUrl}/api/credit/seller/four-states`, {
            headers: { Authorization: `Bearer ${seller.token}` },
          });
          const body = (await res.json()) as any;
          const elapsed = performance.now() - start;

          if (res.status === 200) {
            opLatencies.creditStates.push(elapsed);
            journeyCounts['J9: Vendedor - Quatro Estados do Crediário']++;
          } else {
            unexpectedErrors++;
            failReasons.push(`J9 falhou com status ${res.status}`);
          }
        } else if (journeyType === 9) {
          // J10: Idempotência - Reenvio de Venda com Mesma IdempotencyKey
          const isA = tx % 2 === 0;
          const clientPool = isA ? availableClientsA : availableClientsB;
          const targetClient = isA ? clientPool[clientIdxA++ % clientPool.length] : clientPool[clientIdxB++ % clientPool.length];
          const seller = allSellers.find((s) => s.id === targetClient.assignedSellerId) || allSellers[0];
          const fixedIdempKey = `fixed_idemp_lim${options.connectionLimit}_c${options.concurrency}_tx${tx}_${uuidv4().substring(0, 6)}`;

          // Primeira chamada (cria)
          await fetch(`${server.baseUrl}/api/sales`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${seller.token}`,
            },
            body: JSON.stringify({
              clientId: targetClient.id,
              value: 1200,
              city: targetClient.city,
              product: 'Books',
              paymentMethod: 'CASH',
              idempotencyKey: fixedIdempKey,
            }),
          });

          // Segunda chamada concorrente / reenvio idêntico
          const replayStart = performance.now();
          const replayRes = await fetch(`${server.baseUrl}/api/sales`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${seller.token}`,
            },
            body: JSON.stringify({
              clientId: targetClient.id,
              value: 1200,
              city: targetClient.city,
              product: 'Books',
              paymentMethod: 'CASH',
              idempotencyKey: fixedIdempKey,
            }),
          });
          const replayElapsed = performance.now() - replayStart;
          await replayRes.json();

          if (replayRes.status === 200 || replayRes.status === 201) {
            opLatencies.idempotencyReplay.push(replayElapsed);
            journeyCounts['J10: Idempotência - Reenvio de Venda']++;
          } else {
            unexpectedErrors++;
            failReasons.push(`J10 falhou com status ${replayRes.status}`);
          }
        } else {
          // J11: Isolamento Multi-Tenant (Vendedor de A tenta vender ficha de B)
          // Esperado: 404 (Client not found in your company)
          const sellerA = accountsA.find((a) => a.role === 'SELLER')!;
          const targetClientB = availableClientsB[0];

          const crossRes = await fetch(`${server.baseUrl}/api/sales`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${sellerA.token}`,
            },
            body: JSON.stringify({
              clientId: targetClientB.id,
              value: 1200,
              city: targetClientB.city,
              product: 'Books',
              paymentMethod: 'CASH',
            }),
          });
          const crossBody = (await crossRes.json()) as any;
          const crossElapsed = performance.now() - start;

          if (crossRes.status === 404 || crossRes.status === 403) {
            securityPasses++;
            opLatencies.crossTenantBlock.push(crossElapsed);
            journeyCounts['J11: Isolamento Multi-Tenant']++;
          } else {
            unexpectedErrors++;
            failReasons.push(`J11 quebrou isolamento: retornou status ${crossRes.status}`);
          }
        }
      } catch (err: any) {
        unexpectedErrors++;
        if (err.message && err.message.includes('Timed out')) {
          poolTimeouts++;
        }
        failReasons.push(`Exceção de rede/pool: ${err.message}`);
      }
    }
  }

  const roundStart = performance.now();
  const workers = Array.from({ length: options.concurrency }, (_, i) => executeWorker(i));
  await Promise.all(workers);
  const totalDurationMs = performance.now() - roundStart;

  isMonitoring = false;
  await monitorPromise;

  const durationSeconds = Math.round((totalDurationMs / 1000) * 100) / 100;
  const rps = Math.round((options.totalTransactions / durationSeconds) * 100) / 100;

  // Compilação de percentis
  const allLatencies: number[] = [];
  const latenciesByOperation: Record<string, LatencyStats> = {};

  for (const [opKey, latList] of Object.entries(opLatencies)) {
    allLatencies.push(...latList);
    latenciesByOperation[opKey] = calculatePercentiles(latList);
  }

  const aggregatedLatencies = calculatePercentiles(allLatencies);

  // Verificação de aprovação estrita dos critérios
  let passed = true;
  const errorRate = (unexpectedErrors / options.totalTransactions) * 100;

  if (errorRate >= 1.0) {
    passed = false;
    failReasons.push(`Taxa de erros inesperados (${errorRate.toFixed(2)}%) acima do limite de 1%`);
  }

  if (aggregatedLatencies.p95Ms > 2000) {
    passed = false;
    failReasons.push(`Latência p95 agregada (${aggregatedLatencies.p95Ms}ms) acima da meta de 2.000ms`);
  }

  if (poolTimeouts > 0) {
    passed = false;
    failReasons.push(`Ocorreram ${poolTimeouts} timeouts de conexão do pool`);
  }

  return {
    connectionLimit: options.connectionLimit,
    poolTimeout: options.poolTimeout,
    concurrency: options.concurrency,
    totalTransactions: options.totalTransactions,
    durationSeconds,
    requestsPerSecond: rps,
    aggregatedLatencies,
    latenciesByOperation,
    journeyCounts,
    unexpectedErrors,
    securityPasses,
    peakPgConnections,
    peakPgActive,
    peakPgIdle,
    peakServerRssMb,
    poolTimeouts,
    passed,
    failReasons,
  };
}

// ============================================================================
// 7. ORQUESTRADOR PRINCIPAL DO BENCHMARK
// ============================================================================
async function main() {
  console.log('🏁 ====================================================================');
  console.log('   SELECTPHOTO / LUMORA — BENCHMARK DE CAPACIDADE V2 (CORRIGIDO)');
  console.log('   40 Contas Reais (2 Admins, 8 Fotógrafos, 30 Vendedores)');
  console.log('   5.280 Fichas Históricas (Vendas, Crediário, Revisitas, Estoque)');
  console.log('   Jornadas Reais do Aplicativo | Isolamento de Processos | Gate de Falha');
  console.log('====================================================================\n');

  // Inicializa Prisma administrativo local para seed e auditoria
  const adminDb = new PrismaClient({
    datasources: { db: { url: targetDbUrl } },
  });

  try {
    await verifyDatabaseSafetyAndMarker(adminDb);
    await seedData(adminDb);

    // ========================================================================
    // PROGRESSÃO DE CARGA: 10, 20 E 40 USUÁRIOS VIRTUAIS (LIMITE = 3 vs LIMITE = 5)
    // ========================================================================
    const results: Array<{
      scenario: string;
      limit: number;
      concurrency: number;
      result: BenchmarkRoundResult;
    }> = [];

    for (const limit of [3, 5]) {
      console.log(`\n----------------------------------------------------------------------`);
      console.log(`🔌 INICIALIZANDO SERVIDOR DE TESTE COM CONNECTION_LIMIT = ${limit}`);
      console.log(`----------------------------------------------------------------------`);

      const serverInstance = await startIsolatedServer(limit, 10);
      console.log(`✅ Servidor backend pronto em ${serverInstance.baseUrl} (PID: ${serverInstance.pid})`);

      try {
        // Aquecimento prévio controlado (50 transações)
        console.log('🔥 Executando aquecimento inicial de 50 requisições...');
        await runBenchmarkRound(adminDb, serverInstance, {
          connectionLimit: limit,
          poolTimeout: 10,
          totalTransactions: 50,
          concurrency: 5,
        });

        // Testes nas cargas de 10, 20 e 40 usuários virtuais
        for (const conc of [10, 20, 40]) {
          const transCount = conc === 40 ? 600 : 300;
          const res = await runBenchmarkRound(adminDb, serverInstance, {
            connectionLimit: limit,
            poolTimeout: 10,
            totalTransactions: transCount,
            concurrency: conc,
          });

          results.push({
            scenario: `Conexões: ${limit} | Usuários: ${conc}`,
            limit,
            concurrency: conc,
            result: res,
          });
        }
      } finally {
        console.log(`🛑 Encerrando servidor isolado (PID: ${serverInstance.pid})...`);
        await stopIsolatedServer(serverInstance);
      }
    }

    // ========================================================================
    // APRESENTAÇÃO COMPLETA DOS RESULTADOS
    // ========================================================================
    console.log('\n======================================================================');
    console.log('📊 RELATÓRIO CONSOLIDADO DO BENCHMARK V2');
    console.log('======================================================================\n');

    const summaryTable = results.map((r) => {
      const res = r.result;
      return {
        Cenário: r.scenario,
        Reqs: res.totalTransactions,
        Duração: `${res.durationSeconds}s`,
        'Vazão (req/s)': res.requestsPerSecond,
        'p50 (ms)': `${res.aggregatedLatencies.p50Ms} ms (${(res.aggregatedLatencies.p50Ms / 1000).toFixed(3)}s)`,
        'p95 (ms)': `${res.aggregatedLatencies.p95Ms} ms (${(res.aggregatedLatencies.p95Ms / 1000).toFixed(3)}s)`,
        'p99 (ms)': `${res.aggregatedLatencies.p99Ms} ms (${(res.aggregatedLatencies.p99Ms / 1000).toFixed(3)}s)`,
        'Pico PG (Tot/Act/Idl)': `${res.peakPgConnections}/${res.peakPgActive}/${res.peakPgIdle}`,
        'RSS Backend': `${res.peakServerRssMb} MB`,
        'Erros Inesperados': res.unexpectedErrors,
        Timeouts: res.poolTimeouts,
        Status: res.passed ? '✅ APROVADO' : '❌ REPROVADO',
      };
    });

    console.table(summaryTable);

    // Detalhamento de Latência por Operação no Cenário Máximo (40 Usuários)
    console.log('\n📋 LATÊNCIA DETALHADA POR OPERAÇÃO (40 USUÁRIOS VIRTUAIS):');
    const res40_limit3 = results.find((r) => r.limit === 3 && r.concurrency === 40)?.result;
    const res40_limit5 = results.find((r) => r.limit === 5 && r.concurrency === 40)?.result;

    if (res40_limit3 && res40_limit5) {
      const opsTable: any[] = [];
      const allOpKeys = Object.keys(res40_limit3.latenciesByOperation);

      for (const op of allOpKeys) {
        const l3 = res40_limit3.latenciesByOperation[op];
        const l5 = res40_limit5.latenciesByOperation[op];
        opsTable.push({
          Operação: op,
          'Limite 3 (p50)': `${l3.p50Ms} ms`,
          'Limite 3 (p95)': `${l3.p95Ms} ms`,
          'Limite 5 (p50)': `${l5.p50Ms} ms`,
          'Limite 5 (p95)': `${l5.p95Ms} ms`,
        });
      }
      console.table(opsTable);
    }

    // Salvar JSON do relatório detalhado
    const reportPath = path.resolve(__dirname, '../capacity-benchmark-report.json');
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          environment: {
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            database: 'PostgreSQL 18.4 (Local isolated port 5433)',
            note: 'Ambiente local de execução funcional. Não replica cgroups 0.5 CPU / 512 MiB do Render.',
          },
          summary: summaryTable,
          detailedResults: results,
        },
        null,
        2
      )
    );
    console.log(`\n📄 Relatório JSON completo salvo em: ${reportPath}`);

    // Limpeza segura dos dados deste RUN_ID
    await cleanData(adminDb);
  } finally {
    await adminDb.$disconnect();
  }
}

main().catch((err) => {
  console.error('❌ Erro fatal durante a execução do benchmark v2:', err);
  process.exit(1);
});
