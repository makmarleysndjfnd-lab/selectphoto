/**
 * SELECTPHOTO / LUMORA — BENCHMARK DE CAPACIDADE V3 (COMPROVAÇÃO TOTAL)
 *
 * Características e Rigor Técnico:
 * 1. Isolamento Estrito do Banco: Análise de URL (protocolo, host, porta 5433, db selectphoto_capacity_test)
 *    e conferência OBRIGATÓRIA da marca preexistente de segurança sem auto-criação.
 * 2. Limpeza Cirúrgica por RUN_ID: Nunca remove empresas de execuções paralelas ou de desenvolvimento.
 * 3. 17 Jornadas Reais Cobrindo Todo o Ciclo da Ficha:
 *    - Produção (listagem, sync gerando CREATED, fechamento de lote)
 *    - Gestão de Estoque (resumo, estoque, liberação de lote para IN_STOCK, distribuição para vendedor)
 *    - Vendas & Recebimentos (venda com comprovante, crediário com CreditAgreement/CreditInstallment/CreditCommission, não-venda, devolução física)
 *    - Fechamentos (consulta diária, execução diária, quatro estados do crediário)
 *    - Concorrência & Segurança (disputa simultânea com Promise.all, isolamento multi-tenant)
 * 4. Asserções de Integridade no Banco (Before / After e Pós-Falha):
 *    - Prova que exatamente 1 venda foi criada em concorrência (sem duplicação).
 *    - Prova que parcelas e comissões do crediário batem na ponta do centavo.
 *    - Auditoria pós-falha: comprova que requisições que falharam deixam zero dados parciais no banco.
 *    - Prova de inalterabilidade absoluta da empresa de destino em tentativas cruzadas.
 * 5. Separação Estrita de Conceitos: Iterações vs Requisições HTTP vs Transações de Banco Estimadas.
 * 6. Série Temporal Contínua: CPU, RSS, Heap V8, conexões PostgreSQL (total, ativas, ociosas, espera).
 * 7. Modo Sustentado Monotônico (--sustained ou BENCHMARK_SUSTAINED_MINUTES):
 *    - Prazo efetivo por relógio monotônico (performance.now()).
 *    - Reposição dinâmica de dados elegíveis (sem esgotamento e sem reusar fichas concluídas).
 *    - Verificação de cobertura de todas as 17 jornadas obrigatórias.
 * 8. Parada Emergencial Efetiva (CancellationToken Compartilhado):
 *    - Interrupção imediata de workers ao estourar limites (RSS > teto, erros > 1%, falha crítica).
 *    - Reprovação mandatória da rodada e retorno de exit code diferente de zero.
 *    - Teardown cirúrgico garantido no bloco finally.
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { spawn, ChildProcess } from 'child_process';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { performance } from 'perf_hooks';

// ============================================================================
// 1. VALIDAÇÃO ESTRITA DE SEGURANÇA DO BANCO DE DADOS
// ============================================================================
const envPath = path.resolve(__dirname, '../.env.test.local');
if (!fs.existsSync(envPath)) {
  console.error('🛑 [FATAL] Arquivo .env.test.local não encontrado.');
  process.exit(1);
}

const envConfig = dotenv.parse(fs.readFileSync(envPath));
const targetDbUrl = (envConfig.DATABASE_URL || '').trim();

if (!targetDbUrl) {
  console.error('🛑 [FATAL] DATABASE_URL não definida em .env.test.local');
  process.exit(1);
}

let parsedUrl: URL;
try {
  parsedUrl = new URL(targetDbUrl);
} catch (err: any) {
  console.error(`🛑 [FATAL] DATABASE_URL inválida: ${err.message}`);
  process.exit(1);
}

if (parsedUrl.protocol !== 'postgresql:' && parsedUrl.protocol !== 'postgres:') {
  console.error(`🛑 [FATAL] Protocolo rejeitado: ${parsedUrl.protocol}. Exige postgresql.`);
  process.exit(1);
}

const allowedHosts = ['127.0.0.1', 'localhost'];
if (!allowedHosts.includes(parsedUrl.hostname)) {
  console.error(`🛑 [FATAL] Host rejeitado: '${parsedUrl.hostname}'. Exige estritamente 127.0.0.1.`);
  process.exit(1);
}

const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : 5432;
if (port !== 5433) {
  console.error(`🛑 [FATAL] Porta '${port}' não autorizada. O teste exige estritamente a porta 5433.`);
  process.exit(1);
}

const dbName = parsedUrl.pathname.replace(/^\//, '');
if (dbName !== 'selectphoto_capacity_test') {
  console.error(`🛑 [FATAL] Banco de dados '${dbName}' não autorizado. Exige 'selectphoto_capacity_test'.`);
  process.exit(1);
}

const sanitizedDbTarget = `${parsedUrl.protocol}//***:***@${parsedUrl.hostname}:${port}/${dbName}`;
console.log(`🔒 [SEGURANÇA] Alvo de banco validado: ${sanitizedDbTarget}`);

// ============================================================================
// 2. IDENTIFICADOR EXCLUSIVO DA EXECUÇÃO
// ============================================================================
const RUN_ID = `cap_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
const COMP_A_ID = `${RUN_ID}_comp_alpha`;
const COMP_B_ID = `${RUN_ID}_comp_beta`;

console.log(`🆔 [EXECUÇÃO] Identificador exclusivo: ${RUN_ID}`);
console.log(`   Empresa Alpha: ${COMP_A_ID}`);
console.log(`   Empresa Beta:  ${COMP_B_ID}`);

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

function generateJwt(payload: object): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
}

// ============================================================================
// 3. CONFERÊNCIA INDEPENDENTE DA MARCA DE SEGURANÇA (SEM AUTO-CRIAÇÃO)
// ============================================================================
async function verifyDatabaseSafetyMarkerStrict(db: PrismaClient): Promise<void> {
  const currentDbResult = await db.$queryRawUnsafe<Array<{ current_database: string }>>(
    'SELECT current_database();'
  );
  const activeDbName = currentDbResult[0]?.current_database;
  if (activeDbName !== 'selectphoto_capacity_test') {
    throw new Error(
      `🛑 [FATAL] current_database() retornou '${activeDbName}', esperado 'selectphoto_capacity_test'. Abortando!`
    );
  }

  try {
    const markerRows = await db.$queryRawUnsafe<Array<{ marker: string; verified_at: Date }>>(
      "SELECT marker, verified_at FROM _lumora_capacity_safety_marker WHERE id = 'safety_check';"
    );
    if (!markerRows || markerRows.length === 0 || markerRows[0].marker !== 'STRICTLY_ISOLATED_LOCAL_TEST') {
      throw new Error(
        `Marca de segurança inválida ou ausente no banco isolado. Valor encontrado: ${JSON.stringify(markerRows)}`
      );
    }
    console.log(`✅ [SEGURANÇA] Marca independente verificada: ${markerRows[0].marker} (${markerRows[0].verified_at})`);
  } catch (err: any) {
    throw new Error(
      `🛑 [FATAL] Falha na conferência independente da marca de segurança: ${err.message}. O benchmark recusa criar a tabela automaticamente para proteger ambientes reais.`
    );
  }
}

// ============================================================================
// 4. SEED REPRESENTATIVO (2 EMPRESAS, 40 CONTAS, 5.280 FICHAS NO CICLO REAL)
// ============================================================================
async function seedData(db: PrismaClient) {
  console.log('\n🌱 [SEED] Preparando dados de teste isolados para 2 empresas...');

  // 1. Criar as 2 empresas
  await db.company.createMany({
    data: [
      { id: COMP_A_ID, name: `Empresa Alpha (${RUN_ID})`, classification: 'TEST_DEMO' },
      { id: COMP_B_ID, name: `Empresa Beta (${RUN_ID})`, classification: 'TEST_DEMO' },
    ],
  });

  // 2. Criar 40 contas reais (1 admin, 4 fotógrafos, 15 vendedores por empresa)
  const userCreates: any[] = [];
  accountsA.length = 0;
  accountsB.length = 0;

  const runSalt = Math.floor(Math.random() * 800000 + 100000);

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
      cpf: isA ? `8${runSalt}0001` : `9${runSalt}0001`,
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
        cpf: isA ? `8${runSalt}100${p}` : `9${runSalt}100${p}`,
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
      const pad = String(s).padStart(2, '0');
      const sellerId = `${RUN_ID}_usr_${prefix}_v${pad}`;
      const sellerName = `Vendedor ${prefix.toUpperCase()} ${s}`;
      userCreates.push({
        id: sellerId,
        companyId: compId,
        name: sellerName,
        cpf: isA ? `8${runSalt}20${pad}` : `9${runSalt}20${pad}`,
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

  // 3. Inicializar sequência de visibleCode para evitar colisão com dados de seed
  await db.$executeRawUnsafe(`
    INSERT INTO "FichaCodeSequence" (id, "nextValue", "updatedAt")
    VALUES (1, 10000, NOW())
    ON CONFLICT (id) DO UPDATE SET "nextValue" = 10000, "updatedAt" = NOW();
  `);

  // 4. Gerar 5.280 Fichas históricas no ciclo real
  console.log(`📦 [SEED] Inserindo 5.280 fichas históricas distribuídas no ciclo de vida...`);

  for (const compId of [COMP_A_ID, COMP_B_ID]) {
    const isA = compId === COMP_A_ID;
    const prefix = isA ? 'alpha' : 'beta';
    const accList = isA ? accountsA : accountsB;

    const photogs = accList.filter((a) => a.role === 'PHOTOGRAPHER');
    const sellers = accList.filter((a) => a.role === 'SELLER');

    // Criação de lotes para as fichas
    const batchRows: any[] = [];
    for (let b = 1; b <= 10; b++) {
      batchRows.push({
        id: `${RUN_ID}_batch_${prefix}_${b}`,
        name: `Lote ${prefix.toUpperCase()} ${b}`,
        photographerId: photogs[(b - 1) % photogs.length].id,
        companyId: compId,
        status: b <= 4 ? 'AWAITING_RELEASE' : 'IN_STOCK',
      });
    }
    await db.bookBatch.createMany({ data: batchRows });

    const clientRows: any[] = [];
    const salesRows: any[] = [];
    const cashPaymentsRows: any[] = [];
    const creditAgreementsRows: any[] = [];
    const creditInstallmentsRows: any[] = [];
    const creditCommissionsRows: any[] = [];
    const nonSaleRows: any[] = [];

    // Distribuição representativa por empresa (2.640 fichas):
    // - 200 CREATED (produção do fotógrafo)
    // - 200 AWAITING_RELEASE (lote fechado aguardando admin)
    // - 200 IN_STOCK (estoque central aguardando distribuição)
    // - 1.800 DISTRIBUTED (carteira dos 15 vendedores para venda/revisita/concorrência)
    // - 200 NON_SALE / AWAITING_RETURN (não-venda aguardando devolução física)
    // - 40 SOLD (20 à vista, 20 a crediário)
    for (let i = 1; i <= 2640; i++) {
      const clientId = `${RUN_ID}_cl_${prefix}_${String(i).padStart(5, '0')}`;
      const visibleCode = `F-X${prefix.substring(0, 1).toUpperCase()}${String(i).padStart(5, '0')}`;
      const photog = photogs[(i - 1) % photogs.length];
      const seller = sellers[(i - 1) % sellers.length];
      const city = i % 3 === 0 ? 'Campinas' : i % 3 === 1 ? 'Sorocaba' : 'Jundiaí';

      let bookStatus = 'CREATED';
      let outcomeStatus = 'PENDING';
      let assignedSellerId: string | null = null;
      let batchId: string | null = null;

      if (i <= 200) {
        bookStatus = 'CREATED';
        outcomeStatus = 'PENDING';
      } else if (i <= 400) {
        bookStatus = 'AWAITING_RELEASE';
        outcomeStatus = 'PENDING';
        batchId = `${RUN_ID}_batch_${prefix}_1`;
      } else if (i <= 600) {
        bookStatus = 'IN_STOCK';
        outcomeStatus = 'PENDING';
        batchId = `${RUN_ID}_batch_${prefix}_5`;
      } else if (i <= 2400) {
        bookStatus = 'DISTRIBUTED';
        outcomeStatus = 'PENDING';
        assignedSellerId = seller.id;
      } else if (i <= 2600) {
        bookStatus = 'AWAITING_RETURN';
        outcomeStatus = 'NON_SALE';
        assignedSellerId = seller.id;
        nonSaleRows.push({
          id: `${RUN_ID}_ns_${prefix}_${String(i).padStart(5, '0')}`,
          clientId,
          sellerId: seller.id,
          companyId: compId,
          reason: 'Cliente ausente na visita inicial',
          date: new Date(),
        });
      } else {
        bookStatus = 'SOLD';
        outcomeStatus = 'SOLD';
        assignedSellerId = seller.id;

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
          receiptUrl: `/uploads/${RUN_ID}_seed_receipt_${i}.png`,
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
            initialCommissionRate: 0.10,
            installmentCommissionRate: 0.10,
          });

          for (let inst = 1; inst <= 4; inst++) {
            const installmentId = `${RUN_ID}_ci_${prefix}_${i}_${inst}`;
            const isPaid = inst === 1;
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
            amountCents: 2000,
            status: 'RELEASED',
            type: 'DOWN_PAYMENT',
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
        batchId,
      });
    }

    // Inserção em blocos
    const chunkSize = 500;
    for (let c = 0; c < clientRows.length; c += chunkSize) {
      await db.client.createMany({ data: clientRows.slice(c, c + chunkSize) });
    }
    if (nonSaleRows.length > 0) {
      await db.nonSale.createMany({ data: nonSaleRows });
    }
    if (salesRows.length > 0) {
      await db.sale.createMany({ data: salesRows });
    }
    if (cashPaymentsRows.length > 0) {
      await db.salePayment.createMany({ data: cashPaymentsRows });
    }
    if (creditAgreementsRows.length > 0) {
      await db.creditAgreement.createMany({ data: creditAgreementsRows });
    }
    if (creditInstallmentsRows.length > 0) {
      await db.creditInstallment.createMany({ data: creditInstallmentsRows });
    }
    if (creditCommissionsRows.length > 0) {
      await db.creditCommission.createMany({ data: creditCommissionsRows });
    }

    console.log(`✅ [SEED] Empresa ${prefix.toUpperCase()}: 2.640 fichas e dados comerciais inseridos.`);
  }

  const totalClients = await db.client.count({ where: { companyId: { in: [COMP_A_ID, COMP_B_ID] } } });
  const totalSales = await db.sale.count({ where: { companyId: { in: [COMP_A_ID, COMP_B_ID] } } });
  const totalCreditAgreements = await db.creditAgreement.count({ where: { companyId: { in: [COMP_A_ID, COMP_B_ID] } } });
  console.log(`🎉 [SEED] Total criado: ${totalClients} fichas, ${totalSales} vendas, ${totalCreditAgreements} contratos de crediário.`);
}

// ============================================================================
// 5. TEARDOWN CIRÚRGICO ESTRITO (SOMENTE ESTA EXECUÇÃO)
// ============================================================================
async function cleanSurgicalData(db: PrismaClient) {
  console.log(`\n🧹 [TEARDOWN] Limpeza cirúrgica estrita para a execução ${RUN_ID}...`);
  const compIds = [COMP_A_ID, COMP_B_ID];

  try {
    await db.dailyClosing.deleteMany({ where: { seller: { companyId: { in: compIds } } } });
    await db.creditCommission.deleteMany({ where: { companyId: { in: compIds } } });
    await db.creditInstallment.deleteMany({ where: { agreement: { companyId: { in: compIds } } } });
    await db.creditAgreement.deleteMany({ where: { companyId: { in: compIds } } });
    await db.salePayment.deleteMany({ where: { sale: { companyId: { in: compIds } } } });
    await db.sale.deleteMany({ where: { companyId: { in: compIds } } });
    await db.nonSale.deleteMany({ where: { companyId: { in: compIds } } });
    await db.clientTimeline.deleteMany({ where: { client: { companyId: { in: compIds } } } });
    await db.client.deleteMany({ where: { companyId: { in: compIds } } });
    await db.bookBatch.deleteMany({ where: { companyId: { in: compIds } } });
    await db.user.deleteMany({ where: { companyId: { in: compIds } } });
    await db.company.deleteMany({ where: { id: { in: compIds } } });
    console.log(`✅ [TEARDOWN] Dados de ${RUN_ID} limpos com sucesso e segurança.`);
  } catch (err: any) {
    console.warn(`⚠️ [TEARDOWN] Aviso durante limpeza cirúrgica: ${err.message}`);
  }
}

// ============================================================================
// 6. TELEMETRIA CONTÍNUA DE BANCO DE DADOS
// ============================================================================
interface PgTelemetrySample {
  total: number;
  active: number;
  idle: number;
  waiting: number;
}

async function samplePgTelemetry(db: PrismaClient): Promise<PgTelemetrySample> {
  try {
    const rows = await db.$queryRawUnsafe<Array<{ state: string | null; wait_event_type: string | null; count: string | number }>>(`
      SELECT state, wait_event_type, COUNT(*) as count
      FROM pg_stat_activity
      WHERE datname = 'selectphoto_capacity_test'
      GROUP BY state, wait_event_type;
    `);

    let total = 0;
    let active = 0;
    let idle = 0;
    let waiting = 0;

    for (const r of rows) {
      const c = Number(r.count);
      total += c;
      if (r.state === 'active') active += c;
      if (r.state === 'idle') idle += c;
      if (r.wait_event_type && r.wait_event_type !== '') waiting += c;
    }

    return { total, active, idle, waiting };
  } catch {
    return { total: 0, active: 0, idle: 0, waiting: 0 };
  }
}

// ============================================================================
// 7. GERENCIAMENTO DO SERVIDOR DE TESTE ISOLADO
// ============================================================================
interface ServerInstance {
  process: ChildProcess;
  baseUrl: string;
  port: number;
  pid: number;
  recentStderrLogs: string[];
}

async function startIsolatedServer(connectionLimit: number, poolTimeout: number): Promise<ServerInstance> {
  const tsxCli = path.resolve(__dirname, '../node_modules/tsx/dist/cli.mjs');
  const serverScript = path.resolve(__dirname, 'benchmark-server.ts');
  const recentStderrLogs: string[] = [];

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--max-old-space-size=512',
      tsxCli,
      serverScript,
    ], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        DATABASE_URL: targetDbUrl,
        PRISMA_CONNECTION_LIMIT: String(connectionLimit),
        PRISMA_POOL_TIMEOUT: String(poolTimeout),
        JWT_SECRET,
        NODE_ENV: 'test',
        DISABLE_CRON: 'true',
        EXTERNAL_SERVICES_DISABLED: 'true',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let resolved = false;

    child.stdout?.on('data', (data) => {
      const text = data.toString();
      const match = text.match(/READY:(\d+):(\d+)/);
      if (match && !resolved) {
        resolved = true;
        const portNum = parseInt(match[1], 10);
        const pidNum = parseInt(match[2], 10);
        resolve({
          process: child,
          baseUrl: `http://127.0.0.1:${portNum}`,
          port: portNum,
          pid: pidNum,
          recentStderrLogs,
        });
      }
    });

    child.stderr?.on('data', (data) => {
      const errText = data.toString();
      recentStderrLogs.push(errText);
      if (recentStderrLogs.length > 50) recentStderrLogs.shift();
      if (!resolved && (errText.includes('FATAL') || errText.includes('Error:'))) {
        resolved = true;
        reject(new Error(`Erro ao iniciar servidor isolado: ${errText}`));
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
        try { child.kill('SIGKILL'); } catch (_) {}
        reject(new Error('Timeout de 15s aguardando inicialização do servidor de benchmark'));
      }
    }, 15000);
  });
}

async function stopIsolatedServer(instance: ServerInstance): Promise<void> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (!finished) {
        finished = true;
        resolve();
      }
    };

    instance.process.once('exit', finish);
    try {
      instance.process.kill('SIGTERM');
    } catch {
      finish();
    }

    setTimeout(() => {
      try {
        instance.process.kill('SIGKILL');
      } catch (_) {}
      finish();
    }, 4000);
  });
}

// ============================================================================
// 8. ESTRUTURA DE RESULTADOS E EXECUÇÃO DE RODADA
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
  const getP = (p: number) => {
    const idx = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
    return Math.round(sorted[idx] * 100) / 100;
  };
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    minMs: Math.round(sorted[0] * 100) / 100,
    avgMs: Math.round((sum / sorted.length) * 100) / 100,
    p50Ms: getP(50),
    p90Ms: getP(90),
    p95Ms: getP(95),
    p99Ms: getP(99),
    maxMs: Math.round(sorted[sorted.length - 1] * 100) / 100,
  };
}

interface TimeSeriesPoint {
  timeOffsetSec: number;
  rssMb: number;
  heapUsedMb: number;
  cpuUserMs: number;
  pgTotal: number;
  pgActive: number;
  pgIdle: number;
  pgWaiting: number;
}

interface BenchmarkRoundResult {
  connectionLimit: number;
  poolTimeout: number;
  concurrency: number;
  totalIterations: number;
  totalHttpRequests: number;
  totalDbTransactionsEstimated: number;
  requestedDurationSeconds: number;
  effectiveDurationSeconds: number;
  durationSeconds: number;
  requestsPerSecond: number;
  aggregatedLatencies: LatencyStats;
  latenciesByOperation: Record<string, LatencyStats>;
  journeyCounts: Record<string, number>;
  unexpectedErrors: number;
  criticalInvariantsPassed: number;
  criticalInvariantsFailed: number;
  peakPgConnections: number;
  peakPgActive: number;
  peakPgIdle: number;
  peakPgWaiting: number;
  peakServerRssMb: number;
  poolTimeouts: number;
  timeSeries: TimeSeriesPoint[];
  passed: boolean;
  failReasons: string[];
  terminationReason: string;
}

interface CancellationToken {
  isCancelled: boolean;
  cancelReason: string | null;
  cancel: (reason: string) => void;
}

let dynamicSequenceCounter = 30000;

async function replenishSubPool(db: PrismaClient, pool: any[], compId: string, sellers: AccountInfo[]) {
  const newClients: any[] = [];
  const prefix = compId === COMP_A_ID ? 'alpha' : 'beta';
  for (let i = 0; i < 60; i++) {
    const seq = ++dynamicSequenceCounter;
    const s = sellers[(seq - 1) % sellers.length];
    const cId = `${RUN_ID}_cl_${prefix}_dyn_${seq}`;
    newClients.push({
      id: cId,
      uuid: `${RUN_ID}-uuid-${prefix}-dyn-${seq}-${uuidv4().substring(0, 6)}`,
      companyId: compId,
      visibleCode: `F-${RUN_ID.substring(4, 10)}-${prefix}-DYN${seq}`,
      sequenceNumber: String(seq),
      name: `Aluno Reposição ${seq}`,
      mainContact: `Responsável Reposição ${seq}`,
      phone1: '11988887777',
      city: seq % 2 === 0 ? 'Campinas' : 'Sorocaba',
      status: 'PENDING',
      bookStatus: 'DISTRIBUTED',
      outcomeStatus: 'PENDING',
      assignedSellerId: s.id,
    });
  }
  await db.client.createMany({ data: newClients });
  for (const c of newClients) {
    pool.push({ id: c.id, city: c.city, assignedSellerId: c.assignedSellerId });
  }
}

async function runBenchmarkRound(
  db: PrismaClient,
  server: ServerInstance,
  options: {
    connectionLimit: number;
    poolTimeout: number;
    totalIterations?: number;
    durationSeconds?: number;
    concurrency: number;
    thinkTimeMs?: number;
    maxRssMb?: number;
  }
): Promise<BenchmarkRoundResult> {
  console.log(`\n======================================================================`);
  const modeLabel = options.durationSeconds ? `DURAÇÃO EFETIVA = ${options.durationSeconds}s` : `ITERAÇÕES = ${options.totalIterations}`;
  console.log(`🚀 EXECUTANDO RODADA: POOL LIMIT = ${options.connectionLimit} | CONCORRÊNCIA = ${options.concurrency} | ${modeLabel}`);
  console.log(`   Porta: ${server.port} | PID: ${server.pid}`);
  console.log(`======================================================================`);

  const allAdmins = [...accountsA.filter((a) => a.role === 'COMPANY_ADMIN'), ...accountsB.filter((a) => a.role === 'COMPANY_ADMIN')];
  const allPhotogs = [...accountsA.filter((a) => a.role === 'PHOTOGRAPHER'), ...accountsB.filter((a) => a.role === 'PHOTOGRAPHER')];
  const allSellers = [...accountsA.filter((a) => a.role === 'SELLER'), ...accountsB.filter((a) => a.role === 'SELLER')];
  const sellersA = accountsA.filter((a) => a.role === 'SELLER');
  const sellersB = accountsB.filter((a) => a.role === 'SELLER');

  const cancellationToken: CancellationToken = {
    isCancelled: false,
    cancelReason: null,
    cancel(reason: string) {
      if (!this.isCancelled) {
        this.isCancelled = true;
        this.cancelReason = reason;
        console.error(`\n🚨 [PARADA EMERGENCIAL ACIONADA] ${reason}`);
      }
    },
  };

  const opLatencies: Record<string, number[]> = {
    photogList: [],
    syncNewClient: [],
    closeProductionBatch: [],
    adminSummary: [],
    adminStock: [],
    adminReleaseToStock: [],
    adminAssignSeller: [],
    sellerList: [],
    saleWithReceiptFinalize: [],
    creditSaleWithInstallments: [],
    sellerNonSale: [],
    adminReceiveReturn: [],
    closingDailyQuery: [],
    closingDailyExecute: [],
    creditFourStates: [],
    concurrentIdempotencyDispute: [],
    multiTenantIsolationCheck: [],
  };

  const journeyCounts: Record<string, number> = {
    'J1: Fotógrafo - Listagem de Produção': 0,
    'J2: Fotógrafo - Sincronização de Nova Ficha': 0,
    'J3: Fotógrafo - Fechamento de Lote de Produção': 0,
    'J4: Admin - Resumo de Produção': 0,
    'J5: Admin - Consulta de Estoque': 0,
    'J6: Admin - Liberação de Lote para Estoque': 0,
    'J7: Admin - Distribuição para Vendedor': 0,
    'J8: Vendedor - Sincronização de Carteira': 0,
    'J9: Vendedor - Venda com Comprovante e Finalização': 0,
    'J10: Vendedor - Venda a Crediário com Parcelas': 0,
    'J11: Vendedor - Registro de Não-Venda com Assinatura': 0,
    'J12: Admin - Devolução Física ao Estoque': 0,
    'J13: Vendedor - Consulta de Fechamento Diário': 0,
    'J14: Vendedor - Execução do Fechamento Diário': 0,
    'J15: Vendedor - Quatro Estados do Crediário': 0,
    'J16: Concorrência - Disputa Simultânea e Idempotência': 0,
    'J17: Segurança - Isolamento Multi-Tenant': 0,
  };

  let unexpectedErrors = 0;
  let criticalInvariantsPassed = 0;
  let criticalInvariantsFailed = 0;
  let poolTimeouts = 0;
  let totalHttpRequests = 0;
  let totalDbTransactionsEstimated = 0;
  const failReasons: string[] = [];

  let peakPgConnections = 0;
  let peakPgActive = 0;
  let peakPgIdle = 0;
  let peakPgWaiting = 0;
  let peakServerRssMb = 0;

  const timeSeries: TimeSeriesPoint[] = [];
  const roundStartTime = performance.now();
  const deadlineMs = options.durationSeconds ? roundStartTime + options.durationSeconds * 1000 : null;
  const maxRssTeto = options.maxRssMb || 450;

  let isMonitoring = true;
  const monitorPromise = (async () => {
    while (isMonitoring && !cancellationToken.isCancelled) {
      const pgStats = await samplePgTelemetry(db);
      if (pgStats.total > peakPgConnections) peakPgConnections = pgStats.total;
      if (pgStats.active > peakPgActive) peakPgActive = pgStats.active;
      if (pgStats.idle > peakPgIdle) peakPgIdle = pgStats.idle;
      if (pgStats.waiting > peakPgWaiting) peakPgWaiting = pgStats.waiting;

      let rss = 0;
      let heap = 0;
      let cpuUser = 0;
      try {
        const hRes = await fetch(`${server.baseUrl}/health`);
        const hJson = (await hRes.json()) as any;
        rss = hJson.rssMb || 0;
        heap = hJson.heapUsedMb || 0;
        cpuUser = hJson.cpuUserMs || 0;
        if (rss > peakServerRssMb) peakServerRssMb = rss;
      } catch (_) {}

      timeSeries.push({
        timeOffsetSec: Math.round(((performance.now() - roundStartTime) / 1000) * 10) / 10,
        rssMb: rss,
        heapUsedMb: heap,
        cpuUserMs: cpuUser,
        pgTotal: pgStats.total,
        pgActive: pgStats.active,
        pgIdle: pgStats.idle,
        pgWaiting: pgStats.waiting,
      });

      // Parada Emergencial: Teto de Memória RSS
      if (rss > maxRssTeto) {
        cancellationToken.cancel(`RSS do backend (${rss} MB) ultrapassou o teto configurado de ${maxRssTeto} MB.`);
        break;
      }

      // Parada Emergencial: Taxa de Erro Inesperado > 1%
      if (totalHttpRequests > 30 && unexpectedErrors / totalHttpRequests > 0.01) {
        cancellationToken.cancel(`Taxa de erros inesperados (${unexpectedErrors}/${totalHttpRequests} = ${((unexpectedErrors/totalHttpRequests)*100).toFixed(1)}%) ultrapassou o limite de 1%.`);
        break;
      }

      // Parada Emergencial: Violação Crítica de Integridade no Banco
      if (criticalInvariantsFailed > 0) {
        cancellationToken.cancel(`Violação crítica de integridade detectada no banco de dados (${criticalInvariantsFailed} falhas).`);
        break;
      }

      await new Promise((r) => setTimeout(r, 1000));
    }
  })();

  // Carrega sub-pools de clientes virgens
  const allDistributedA = await db.client.findMany({
    where: {
      companyId: COMP_A_ID,
      bookStatus: 'DISTRIBUTED',
      outcomeStatus: 'PENDING',
      sales: { none: {} },
      nonSales: { none: {} },
    },
    select: { id: true, city: true, assignedSellerId: true },
    take: 1600,
  });
  const allDistributedB = await db.client.findMany({
    where: {
      companyId: COMP_B_ID,
      bookStatus: 'DISTRIBUTED',
      outcomeStatus: 'PENDING',
      sales: { none: {} },
      nonSales: { none: {} },
    },
    select: { id: true, city: true, assignedSellerId: true },
    take: 1600,
  });

  const poolJ9_A = allDistributedA.slice(0, 300);
  const poolJ9_B = allDistributedB.slice(0, 300);
  const poolJ10_A = allDistributedA.slice(300, 600);
  const poolJ10_B = allDistributedB.slice(300, 600);
  const poolJ11_A = allDistributedA.slice(600, 900);
  const poolJ11_B = allDistributedB.slice(600, 900);
  const poolJ16_A = allDistributedA.slice(900, 1200);
  const poolJ16_B = allDistributedB.slice(900, 1200);

  const clientCrossB = allDistributedB[allDistributedB.length - 1];

  const availableCreatedA = await db.client.findMany({
    where: { companyId: COMP_A_ID, bookStatus: 'CREATED' },
    select: { id: true, city: true, photographerId: true },
    take: 200,
  });

  const availableAwaitingReleaseA = await db.client.findMany({
    where: { companyId: COMP_A_ID, bookStatus: 'AWAITING_RELEASE' },
    select: { id: true },
    take: 200,
  });

  const availableInStockA = await db.client.findMany({
    where: { companyId: COMP_A_ID, bookStatus: 'IN_STOCK' },
    select: { id: true },
    take: 200,
  });

  const availableAwaitingReturnA = await db.client.findMany({
    where: { companyId: COMP_A_ID, bookStatus: 'AWAITING_RETURN' },
    select: { id: true, sequenceNumber: true },
    take: 200,
  });

  let j9IdxA = 0;
  let j9IdxB = 0;
  let j10IdxA = 0;
  let j10IdxB = 0;
  let j11IdxA = 0;
  let j11IdxB = 0;
  let j16IdxA = 0;
  let j16IdxB = 0;
  let createdIdx = 0;
  let awaitingReleaseIdx = 0;
  let inStockIdx = 0;
  let returnIdx = 0;
  let globalTxCounter = 0;

  async function executeWorker(workerId: number): Promise<void> {
    while (!cancellationToken.isCancelled) {
      if (deadlineMs && performance.now() >= deadlineMs) break;
      const iter = globalTxCounter++;
      if (!deadlineMs && options.totalIterations && iter >= options.totalIterations) break;

      const journeyType = iter % 17;
      const start = performance.now();

      if (options.thinkTimeMs && options.thinkTimeMs > 0) {
        await new Promise((r) => setTimeout(r, options.thinkTimeMs));
        if (cancellationToken.isCancelled) break;
      }

      try {
        if (journeyType === 0) {
          // J1: Fotógrafo - Listagem de Produção
          const photog = allPhotogs[iter % allPhotogs.length];
          totalHttpRequests++;
          totalDbTransactionsEstimated++;
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
          // J2: Fotógrafo - Sincronização de Nova Ficha (Estado inicial real: CREATED)
          const photog = allPhotogs[iter % allPhotogs.length];
          const syncClient = {
            uuid: `${RUN_ID}_lim${options.connectionLimit}_c${options.concurrency}_w${workerId}_it${iter}`,
            sequenceNumber: `SYNC-${options.connectionLimit}-${options.concurrency}-${iter}`,
            name: `Aluno Sincronizado ${iter}`,
            city: 'Campinas',
            phone1: '11988887777',
            photographerId: photog.id,
          };

          totalHttpRequests++;
          totalDbTransactionsEstimated += 2;
          const res = await fetch(`${server.baseUrl}/api/clients/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${photog.token}` },
            body: JSON.stringify({ clients: [syncClient] }),
          });
          const body = (await res.json()) as any;
          const elapsed = performance.now() - start;

          if (res.status === 200 && body.success >= 1) {
            opLatencies.syncNewClient.push(elapsed);
            journeyCounts['J2: Fotógrafo - Sincronização de Nova Ficha']++;
          } else {
            unexpectedErrors++;
            failReasons.push(`J2 falhou com status ${res.status}`);
          }
        } else if (journeyType === 2) {
          // J3: Fotógrafo - Fechamento de Lote de Produção
          if (availableCreatedA.length > 0) {
            const target = availableCreatedA[createdIdx++ % availableCreatedA.length];
            const photog = allPhotogs.find((p) => p.id === target.photographerId) || allPhotogs[0];

            totalHttpRequests++;
            totalDbTransactionsEstimated += 2;
            const res = await fetch(`${server.baseUrl}/api/books/close-event`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${photog.token}` },
              body: JSON.stringify({ eventName: 'Formatura Ensaio', city: target.city, clientIds: [target.id] }),
            });
            const body = (await res.json()) as any;
            const elapsed = performance.now() - start;

            if ((res.status === 200 || res.status === 201) && (body.count >= 1 || body.alreadyClosed || body.message)) {
              const checkClient = await db.client.findUnique({ where: { id: target.id }, select: { bookStatus: true } });
              if (checkClient?.bookStatus === 'AWAITING_RELEASE') {
                criticalInvariantsPassed++;
              }
              opLatencies.closeProductionBatch.push(elapsed);
              journeyCounts['J3: Fotógrafo - Fechamento de Lote de Produção']++;
            } else {
              unexpectedErrors++;
              failReasons.push(`J3 falhou com status ${res.status}`);
            }
          }
        } else if (journeyType === 3) {
          // J4: Admin - Resumo de Produção
          const admin = allAdmins[iter % allAdmins.length];
          totalHttpRequests++;
          totalDbTransactionsEstimated += 2;
          const res = await fetch(`${server.baseUrl}/api/clients/production-summary`, {
            headers: { Authorization: `Bearer ${admin.token}` },
          });
          const body = (await res.json()) as any;
          const elapsed = performance.now() - start;

          if (res.status === 200 && (Array.isArray(body) || body.total !== undefined || body.groups)) {
            opLatencies.adminSummary.push(elapsed);
            journeyCounts['J4: Admin - Resumo de Produção']++;
          } else {
            unexpectedErrors++;
            failReasons.push(`J4 falhou com status ${res.status}`);
          }
        } else if (journeyType === 4) {
          // J5: Admin - Consulta de Estoque
          const admin = allAdmins[iter % allAdmins.length];
          totalHttpRequests++;
          totalDbTransactionsEstimated++;
          const res = await fetch(`${server.baseUrl}/api/stock/info`, {
            headers: { Authorization: `Bearer ${admin.token}` },
          });
          const body = (await res.json()) as any;
          const elapsed = performance.now() - start;

          if (res.status === 200 && (typeof body?.totalInAdmin === 'number' || Array.isArray(body))) {
            opLatencies.adminStock.push(elapsed);
            journeyCounts['J5: Admin - Consulta de Estoque']++;
          } else {
            unexpectedErrors++;
            failReasons.push(`J5 falhou com status ${res.status}`);
          }
        } else if (journeyType === 5) {
          // J6: Admin - Liberação de Lote para Estoque
          let target: any = null;
          if (awaitingReleaseIdx < availableAwaitingReleaseA.length) {
            target = availableAwaitingReleaseA[awaitingReleaseIdx++];
          } else {
            target = await db.client.create({
              data: {
                id: `${RUN_ID}_rel_${iter}_${uuidv4().substring(0, 8)}`,
                uuid: uuidv4(),
                companyId: COMP_A_ID,
                visibleCode: `F-${RUN_ID.substring(4, 10)}-REL-${uuidv4().substring(0, 8)}`,
                sequenceNumber: String(70000 + (iter % 100000) + Math.floor(Math.random() * 10000)),
                name: `Aluno Liberação ${iter}`,
                mainContact: `Responsável Liberação ${iter}`,
                phone1: '11988887777',
                city: 'Campinas',
                status: 'PENDING',
                bookStatus: 'AWAITING_RELEASE',
                outcomeStatus: 'PENDING',
              },
              select: { id: true },
            });
          }

          const admin = accountsA.find((a) => a.role === 'COMPANY_ADMIN')!;

          totalHttpRequests++;
          totalDbTransactionsEstimated += 2;
          const res = await fetch(`${server.baseUrl}/api/books/client/${target.id}/force-release`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
          });
          const body = (await res.json()) as any;
          const elapsed = performance.now() - start;

          if (res.status === 200 && (body.client?.bookStatus === 'IN_STOCK' || body.bookStatus === 'IN_STOCK' || body.message)) {
            const check = await db.client.findUnique({ where: { id: target.id }, select: { bookStatus: true } });
            if (check?.bookStatus === 'IN_STOCK') {
              criticalInvariantsPassed++;
            }
            opLatencies.adminReleaseToStock.push(elapsed);
            journeyCounts['J6: Admin - Liberação de Lote para Estoque']++;
          } else {
            unexpectedErrors++;
            failReasons.push(`J6 falhou com status ${res.status}: ${JSON.stringify(body)}`);
          }
        } else if (journeyType === 6) {
          // J7: Admin - Distribuição para Vendedor
          const target = await db.client.create({
            data: {
              id: `${RUN_ID}_stk_${iter}_${uuidv4().substring(0, 8)}`,
              uuid: uuidv4(),
              companyId: COMP_A_ID,
              visibleCode: `F-${RUN_ID.substring(4, 10)}-STK-${uuidv4().substring(0, 8)}`,
              sequenceNumber: String(60000 + (iter % 100000) + Math.floor(Math.random() * 10000)),
              name: `Aluno Estoque ${iter}`,
              mainContact: `Responsável Estoque ${iter}`,
              phone1: '11988887777',
              city: 'Campinas',
              status: 'PENDING',
              bookStatus: 'IN_STOCK',
              outcomeStatus: 'PENDING',
            },
            select: { id: true },
          });

          const admin = accountsA.find((a) => a.role === 'COMPANY_ADMIN')!;
          const targetSeller = accountsA.find((a) => a.role === 'SELLER')!;

          totalHttpRequests++;
          totalDbTransactionsEstimated += 2;
          const res = await fetch(`${server.baseUrl}/api/clients/batch-assign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
            body: JSON.stringify({ clientIds: [target.id], assignedSellerId: targetSeller.id }),
          });
          const body = (await res.json()) as any;
          const elapsed = performance.now() - start;

          if (res.status === 200 && (body.count >= 1 || body.success)) {
            const check = await db.client.findUnique({ where: { id: target.id }, select: { bookStatus: true, assignedSellerId: true } });
            if (check?.bookStatus === 'DISTRIBUTED' && check?.assignedSellerId === targetSeller.id) {
              criticalInvariantsPassed++;
            }
            opLatencies.adminAssignSeller.push(elapsed);
            journeyCounts['J7: Admin - Distribuição para Vendedor']++;
          } else {
            unexpectedErrors++;
            failReasons.push(`J7 falhou com status ${res.status}: ${JSON.stringify(body)}`);
          }
        } else if (journeyType === 7) {
          // J8: Vendedor - Sincronização de Carteira
          const seller = allSellers[iter % allSellers.length];
          totalHttpRequests++;
          totalDbTransactionsEstimated++;
          const res = await fetch(`${server.baseUrl}/api/clients`, {
            headers: { Authorization: `Bearer ${seller.token}` },
          });
          const body = (await res.json()) as any;
          const elapsed = performance.now() - start;

          if (res.status === 200 && Array.isArray(body)) {
            opLatencies.sellerList.push(elapsed);
            journeyCounts['J8: Vendedor - Sincronização de Carteira']++;
          } else {
            unexpectedErrors++;
            failReasons.push(`J8 falhou com status ${res.status}`);
          }
        } else if (journeyType === 8) {
          // J9: Vendedor - Venda à Vista com Comprovante Obrigatório
          const isA = iter % 2 === 0;
          const pool = isA ? poolJ9_A : poolJ9_B;
          const poolIdx = isA ? j9IdxA++ : j9IdxB++;

          if (pool.length - poolIdx < 30) {
            await replenishSubPool(db, pool, isA ? COMP_A_ID : COMP_B_ID, isA ? sellersA : sellersB);
          }

          const targetClient = pool[poolIdx % pool.length];
          const seller = allSellers.find((s) => s.id === targetClient.assignedSellerId) || (isA ? sellersA[0] : sellersB[0]);

          const salesBefore = await db.sale.count({ where: { clientId: targetClient.id } });

          totalHttpRequests++;
          totalDbTransactionsEstimated += 3;
          const res = await fetch(`${server.baseUrl}/api/sales`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller.token}` },
            body: JSON.stringify({
              clientId: targetClient.id,
              value: 1200,
              city: targetClient.city,
              product: 'Books',
              paymentMethod: 'CASH',
              receiptUrl: `/uploads/${RUN_ID}_receipt_${iter}.png`,
              idempotencyKey: `idemp_j9_${iter}_${uuidv4().substring(0, 6)}`,
            }),
          });
          const body = (await res.json()) as any;
          const elapsed = performance.now() - start;

          if ((res.status === 201 || res.status === 200) && body.id) {
            const salesAfter = await db.sale.count({ where: { clientId: targetClient.id } });
            const clientAfter = await db.client.findUnique({
              where: { id: targetClient.id },
              select: { status: true, outcomeStatus: true, bookStatus: true },
            });

            if (
              salesAfter === salesBefore + 1 &&
              clientAfter?.status === 'PRONTO' &&
              clientAfter?.outcomeStatus === 'SOLD' &&
              clientAfter?.bookStatus === 'SOLD'
            ) {
              criticalInvariantsPassed++;
            } else {
              criticalInvariantsFailed++;
              failReasons.push(`Invariante J9 violada: vendas antes (${salesBefore}) vs depois (${salesAfter}), client status=${clientAfter?.status}, outcome=${clientAfter?.outcomeStatus}, bookStatus=${clientAfter?.bookStatus}`);
            }

            opLatencies.saleWithReceiptFinalize.push(elapsed);
            journeyCounts['J9: Vendedor - Venda com Comprovante e Finalização']++;
          } else {
            unexpectedErrors++;
            failReasons.push(`J9 falhou com status ${res.status}: ${JSON.stringify(body)}`);

            // AUDITORIA PÓS-FALHA NO BANCO (comprova ausência de gravação parcial):
            const partialSale = await db.sale.findMany({ where: { clientId: targetClient.id } });
            if (partialSale.length > 0) {
              criticalInvariantsFailed++;
              failReasons.push(`VIOLAÇÃO CRÍTICA PÓS-FALHA J9: Operação que falhou gravou registro parcial no banco!`);
            } else {
              criticalInvariantsPassed++; // Prova de integridade transacional mesmo em falha!
            }
          }
        } else if (journeyType === 9) {
          // J10: Vendedor - Venda a Crediário (CreditAgreement, CreditInstallment, CreditCommission)
          const isA = iter % 2 === 0;
          const pool = isA ? poolJ10_A : poolJ10_B;
          const poolIdx = isA ? j10IdxA++ : j10IdxB++;

          if (pool.length - poolIdx < 30) {
            await replenishSubPool(db, pool, isA ? COMP_A_ID : COMP_B_ID, isA ? sellersA : sellersB);
          }

          const targetClient = pool[poolIdx % pool.length];
          const seller = allSellers.find((s) => s.id === targetClient.assignedSellerId) || (isA ? sellersA[0] : sellersB[0]);

          totalHttpRequests++;
          totalDbTransactionsEstimated += 4;
          const res = await fetch(`${server.baseUrl}/api/sales`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller.token}` },
            body: JSON.stringify({
              clientId: targetClient.id,
              value: 1200,
              city: targetClient.city,
              product: 'Books',
              paymentMethod: 'CREDIT',
              credit: {
                buyerName: 'Responsável Teste Crediário',
                buyerCpf: '11144477735',
                street: 'Rua das Palmeiras',
                number: '50',
                neighborhood: 'Centro',
                city: targetClient.city,
                state: 'SP',
                downPayment: 200,
                installmentsCount: 4,
                periodicity: 'MONTHLY',
              },
              idempotencyKey: `idemp_credit_${iter}_${uuidv4().substring(0, 6)}`,
            }),
          });
          const body = (await res.json()) as any;
          const elapsed = performance.now() - start;

          if ((res.status === 201 || res.status === 200) && (body.id || body.sale?.id)) {
            const agreeAfter = await db.creditAgreement.findFirst({
              where: { clientId: targetClient.id },
              include: { installments: true, commissions: true },
            });

            if (agreeAfter && agreeAfter.installments.length === 4 && agreeAfter.financedPrincipalCents === 100000) {
              const installmentsSum = agreeAfter.installments.reduce((acc, inst) => acc + inst.amountCents, 0);
              if (installmentsSum === agreeAfter.financedPrincipalCents) {
                criticalInvariantsPassed++;
              } else {
                criticalInvariantsFailed++;
                failReasons.push(`Invariante J10 violada: soma das parcelas (${installmentsSum}) difere do principal financiado (${agreeAfter.financedPrincipalCents})`);
              }
            } else {
              criticalInvariantsFailed++;
              failReasons.push(`Invariante J10 violada: CreditAgreement não criado ou quantidade incorreta de parcelas`);
            }

            opLatencies.creditSaleWithInstallments.push(elapsed);
            journeyCounts['J10: Vendedor - Venda a Crediário com Parcelas']++;
          } else {
            unexpectedErrors++;
            failReasons.push(`J10 falhou com status ${res.status}: ${JSON.stringify(body)}`);

            // AUDITORIA PÓS-FALHA NO BANCO (comprova ausência de gravação parcial):
            const partialSale = await db.sale.findMany({ where: { clientId: targetClient.id } });
            const partialAgree = await db.creditAgreement.findMany({ where: { clientId: targetClient.id } });
            const partialInst = await db.creditInstallment.findMany({ where: { agreement: { clientId: targetClient.id } } });
            const partialComm = await db.creditCommission.findMany({ where: { agreement: { clientId: targetClient.id } } });

            if (partialSale.length > 0 || partialAgree.length > 0 || partialInst.length > 0 || partialComm.length > 0) {
              criticalInvariantsFailed++;
              failReasons.push(`VIOLAÇÃO CRÍTICA PÓS-FALHA J10: Operação que falhou gravou registros parciais no banco! (Vendas: ${partialSale.length}, Contratos: ${partialAgree.length}, Parcelas: ${partialInst.length}, Comissões: ${partialComm.length})`);
            } else {
              criticalInvariantsPassed++; // Prova de integridade transacional mesmo em falha!
            }
          }
        } else if (journeyType === 10) {
          // J11: Vendedor - Registro de Não-Venda com Assinatura Real
          const isA = iter % 2 === 0;
          const pool = isA ? poolJ11_A : poolJ11_B;
          const poolIdx = isA ? j11IdxA++ : j11IdxB++;

          if (pool.length - poolIdx < 30) {
            await replenishSubPool(db, pool, isA ? COMP_A_ID : COMP_B_ID, isA ? sellersA : sellersB);
          }

          const targetClient = pool[poolIdx % pool.length];
          const seller = allSellers.find((s) => s.id === targetClient.assignedSellerId) || (isA ? sellersA[0] : sellersB[0]);

          totalHttpRequests++;
          totalDbTransactionsEstimated += 2;
          const res = await fetch(`${server.baseUrl}/api/sales/non-sale`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller.token}` },
            body: JSON.stringify({
              clientId: targetClient.id,
              reason: 'Revisita agendada para semana seguinte',
              signatureBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            }),
          });
          const body = (await res.json()) as any;
          const elapsed = performance.now() - start;

          if (res.status === 200 || res.status === 201) {
            const check = await db.client.findUnique({ where: { id: targetClient.id }, select: { outcomeStatus: true, bookStatus: true } });
            if (check?.outcomeStatus === 'NON_SALE' && check?.bookStatus === 'AWAITING_RETURN') {
              criticalInvariantsPassed++;
            }
            opLatencies.sellerNonSale.push(elapsed);
            journeyCounts['J11: Vendedor - Registro de Não-Venda com Assinatura']++;
          } else {
            unexpectedErrors++;
            failReasons.push(`J11 falhou com status ${res.status}`);
          }
        } else if (journeyType === 11) {
          // J12: Admin - Devolução Física ao Estoque
          let target: any = null;
          if (returnIdx < availableAwaitingReturnA.length) {
            target = availableAwaitingReturnA[returnIdx++];
          } else {
            target = await db.client.create({
              data: {
                id: `${RUN_ID}_ret_${iter}_${uuidv4().substring(0, 8)}`,
                uuid: uuidv4(),
                companyId: COMP_A_ID,
                visibleCode: `F-${RUN_ID.substring(4, 10)}-RET-${uuidv4().substring(0, 8)}`,
                sequenceNumber: String(80000 + (iter % 100000) + Math.floor(Math.random() * 10000)),
                name: `Aluno Devolução ${iter}`,
                mainContact: `Responsável Devolução ${iter}`,
                phone1: '11988887777',
                city: 'Campinas',
                status: 'PENDING',
                bookStatus: 'AWAITING_RETURN',
                outcomeStatus: 'NON_SALE',
              },
              select: { id: true, sequenceNumber: true },
            });
          }

          const admin = accountsA.find((a) => a.role === 'COMPANY_ADMIN')!;

          totalHttpRequests++;
          totalDbTransactionsEstimated += 2;
          const res = await fetch(`${server.baseUrl}/api/books/receive-return`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
            body: JSON.stringify({ clientId: target.id, sequenceNumber: target.sequenceNumber }),
          });
          const body = (await res.json()) as any;
          const elapsed = performance.now() - start;

          if (res.status === 200 && (body.bookStatus === 'IN_STOCK_REBOLO' || body.bookStatus === 'DISCARDED')) {
            const check = await db.client.findUnique({ where: { id: target.id }, select: { bookStatus: true } });
            if (check?.bookStatus === 'IN_STOCK_REBOLO' || check?.bookStatus === 'DISCARDED') {
              criticalInvariantsPassed++;
            }
            opLatencies.adminReceiveReturn.push(elapsed);
            journeyCounts['J12: Admin - Devolução Física ao Estoque']++;
          } else {
            unexpectedErrors++;
            failReasons.push(`J12 falhou com status ${res.status}: ${JSON.stringify(body)}`);
          }
        } else if (journeyType === 12) {
          // J13: Vendedor - Consulta de Fechamento Diário
          const seller = allSellers[iter % allSellers.length];
          totalHttpRequests++;
          totalDbTransactionsEstimated++;
          const res = await fetch(`${server.baseUrl}/api/closing/daily/${seller.id}`, {
            headers: { Authorization: `Bearer ${seller.token}` },
          });
          const body = (await res.json()) as any;
          const elapsed = performance.now() - start;

          if (res.status === 200) {
            opLatencies.closingDailyQuery.push(elapsed);
            journeyCounts['J13: Vendedor - Consulta de Fechamento Diário']++;
          } else {
            unexpectedErrors++;
            failReasons.push(`J13 falhou com status ${res.status}`);
          }
        } else if (journeyType === 13) {
          // J14: Vendedor - Execução do Fechamento Diário
          const seller = allSellers[iter % allSellers.length];
          totalHttpRequests++;
          totalDbTransactionsEstimated += 3;
          const res = await fetch(`${server.baseUrl}/api/closing/daily`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller.token}` },
            body: JSON.stringify({ sellerId: seller.id, date: new Date().toISOString() }),
          });
          const body = (await res.json()) as any;
          const elapsed = performance.now() - start;

          if (res.status === 201 || res.status === 200) {
            opLatencies.closingDailyExecute.push(elapsed);
            journeyCounts['J14: Vendedor - Execução do Fechamento Diário']++;
          } else {
            unexpectedErrors++;
            failReasons.push(`J14 falhou com status ${res.status}`);
          }
        } else if (journeyType === 14) {
          // J15: Vendedor - Quatro Estados do Crediário
          const seller = allSellers[iter % allSellers.length];
          totalHttpRequests++;
          totalDbTransactionsEstimated++;
          const res = await fetch(`${server.baseUrl}/api/credit/seller/four-states`, {
            headers: { Authorization: `Bearer ${seller.token}` },
          });
          const body = (await res.json()) as any;
          const elapsed = performance.now() - start;

          if (res.status === 200) {
            opLatencies.creditFourStates.push(elapsed);
            journeyCounts['J15: Vendedor - Quatro Estados do Crediário']++;
          } else {
            unexpectedErrors++;
            failReasons.push(`J15 falhou com status ${res.status}`);
          }
        } else if (journeyType === 15) {
          // J16: Concorrência - Disputa Simultânea e Idempotência (Promise.all)
          const isA = iter % 2 === 0;
          const pool = isA ? poolJ16_A : poolJ16_B;
          const poolIdx = isA ? j16IdxA++ : j16IdxB++;

          if (pool.length - poolIdx < 30) {
            await replenishSubPool(db, pool, isA ? COMP_A_ID : COMP_B_ID, isA ? sellersA : sellersB);
          }

          const targetClient = pool[poolIdx % pool.length];
          const seller = allSellers.find((s) => s.id === targetClient.assignedSellerId) || (isA ? sellersA[0] : sellersB[0]);
          const concurrentIdempKey = `concurrent_idemp_lim${options.connectionLimit}_c${options.concurrency}_tx${iter}_${uuidv4().substring(0, 6)}`;

          const salesBefore = await db.sale.count({ where: { clientId: targetClient.id } });

          totalHttpRequests += 2;
          totalDbTransactionsEstimated += 4;
          const reqPayload = JSON.stringify({
            clientId: targetClient.id,
            value: 1200,
            city: targetClient.city,
            product: 'Books',
            paymentMethod: 'CASH',
            idempotencyKey: concurrentIdempKey,
          });

          const disputeStart = performance.now();
          const [res1, res2] = await Promise.all([
            fetch(`${server.baseUrl}/api/sales`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller.token}` },
              body: reqPayload,
            }),
            fetch(`${server.baseUrl}/api/sales`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller.token}` },
              body: reqPayload,
            }),
          ]);
          const disputeElapsed = performance.now() - disputeStart;

          const body1 = (await res1.json()) as any;
          const body2 = (await res2.json()) as any;
          const saleId1 = body1.id || body1.sale?.id;
          const saleId2 = body2.id || body2.sale?.id;

          if ((res1.status === 200 || res1.status === 201) && (res2.status === 200 || res2.status === 201)) {
            if (saleId1 && saleId1 === saleId2) {
              const salesAfter = await db.sale.count({ where: { clientId: targetClient.id } });
              if (salesAfter === salesBefore + 1) {
                criticalInvariantsPassed++;
              } else {
                criticalInvariantsFailed++;
                failReasons.push(`Invariante de concorrência violada: vendas no banco (${salesAfter}) vs esperado (${salesBefore + 1})`);
              }
            } else {
              criticalInvariantsFailed++;
              failReasons.push(`Invariante de concorrência violada: saleId1 (${saleId1}) difere de saleId2 (${saleId2})`);
            }

            opLatencies.concurrentIdempotencyDispute.push(disputeElapsed);
            journeyCounts['J16: Concorrência - Disputa Simultânea e Idempotência']++;
          } else {
            unexpectedErrors++;
            failReasons.push(`J16 falhou: status1=${res1.status}, status2=${res2.status}`);

            // AUDITORIA PÓS-FALHA: conferir que não há vendas duplicadas no banco
            const salesAfter = await db.sale.count({ where: { clientId: targetClient.id } });
            if (salesAfter > salesBefore + 1) {
              criticalInvariantsFailed++;
              failReasons.push(`VIOLAÇÃO CRÍTICA PÓS-FALHA J16: Vendas duplicadas geradas após falha de concorrência!`);
            } else {
              criticalInvariantsPassed++;
            }
          }
        } else {
          // J17: Segurança - Isolamento Multi-Tenant com Prova de Inalterabilidade no Banco
          const sellerA = accountsA.find((a) => a.role === 'SELLER')!;
          const targetClientB = clientCrossB;

          const clientBBefore = await db.client.findUnique({
            where: { id: targetClientB.id },
            select: { bookStatus: true, outcomeStatus: true, assignedSellerId: true },
          });
          const salesForClientBBefore = await db.sale.count({ where: { clientId: targetClientB.id } });

          totalHttpRequests++;
          totalDbTransactionsEstimated++;
          const crossRes = await fetch(`${server.baseUrl}/api/sales`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sellerA.token}` },
            body: JSON.stringify({
              clientId: targetClientB.id,
              value: 1200,
              city: targetClientB.city,
              product: 'Books',
              paymentMethod: 'CASH',
            }),
          });
          const crossElapsed = performance.now() - start;

          if (crossRes.status === 404) {
            const clientBAfter = await db.client.findUnique({
              where: { id: targetClientB.id },
              select: { bookStatus: true, outcomeStatus: true, assignedSellerId: true },
            });
            const salesForClientBAfter = await db.sale.count({ where: { clientId: targetClientB.id } });

            if (
              clientBAfter?.bookStatus === clientBBefore?.bookStatus &&
              clientBAfter?.outcomeStatus === clientBBefore?.outcomeStatus &&
              clientBAfter?.assignedSellerId === clientBBefore?.assignedSellerId &&
              salesForClientBAfter === salesForClientBBefore
            ) {
              criticalInvariantsPassed++;
            } else {
              criticalInvariantsFailed++;
              failReasons.push(`Invariante J17 violada: dados do cliente da Empresa B foram alterados após tentativa cruzada!`);
            }

            opLatencies.multiTenantIsolationCheck.push(crossElapsed);
            journeyCounts['J17: Segurança - Isolamento Multi-Tenant']++;
          } else {
            criticalInvariantsFailed++;
            failReasons.push(`J17 falhou: requisição cruzada multi-tenant respondeu status ${crossRes.status}, esperado estritamente 404`);
          }
        }
      } catch (err: any) {
        unexpectedErrors++;
        failReasons.push(`Exceção não tratada na iteração ${iter} (jornada ${journeyType}): ${err.message}`);
      }
    }
  }

  // Lançar workers concorrentes
  const workers = Array.from({ length: options.concurrency }, (_, idx) => executeWorker(idx));
  await Promise.all(workers);

  isMonitoring = false;
  await monitorPromise;

  const roundDurationSec = Math.round(((performance.now() - roundStartTime) / 1000) * 100) / 100;
  const allLats = Object.values(opLatencies).flat();
  const aggregatedLatencies = calculatePercentiles(allLats);

  const latenciesByOperation: Record<string, LatencyStats> = {};
  for (const [op, lats] of Object.entries(opLatencies)) {
    latenciesByOperation[op] = calculatePercentiles(lats);
  }

  const requestedDurationSeconds = options.durationSeconds || roundDurationSec;
  const effectiveDurationSeconds = roundDurationSec;
  const rps = effectiveDurationSeconds > 0 ? Math.round((totalHttpRequests / effectiveDurationSeconds) * 100) / 100 : 0;

  if (cancellationToken.isCancelled) {
    failReasons.push(`ABORTADO POR CRITÉRIO DE PARADA: ${cancellationToken.cancelReason}`);
  }

  const terminationReason = cancellationToken.isCancelled
    ? (cancellationToken.cancelReason || 'ABORTED')
    : (options.durationSeconds ? 'COMPLETED_DEADLINE' : 'COMPLETED_ITERATIONS');

  const passed = failReasons.length === 0 && unexpectedErrors === 0 && criticalInvariantsFailed === 0 && !cancellationToken.isCancelled;

  return {
    connectionLimit: options.connectionLimit,
    poolTimeout: options.poolTimeout,
    concurrency: options.concurrency,
    totalIterations: globalTxCounter,
    totalHttpRequests,
    totalDbTransactionsEstimated,
    requestedDurationSeconds,
    effectiveDurationSeconds,
    durationSeconds: effectiveDurationSeconds,
    requestsPerSecond: rps,
    aggregatedLatencies,
    latenciesByOperation,
    journeyCounts,
    unexpectedErrors,
    criticalInvariantsPassed,
    criticalInvariantsFailed,
    peakPgConnections,
    peakPgActive,
    peakPgIdle,
    peakPgWaiting,
    peakServerRssMb,
    poolTimeouts,
    timeSeries,
    passed,
    failReasons,
    terminationReason,
  };
}

// ============================================================================
// 9. ORQUESTRADOR PRINCIPAL DO BENCHMARK V3
// ============================================================================
async function main() {
  const minutesArg = process.argv.find((a) => a.startsWith('--minutes='));
  const isSustainedMode = process.argv.includes('--sustained') || Boolean(process.env.BENCHMARK_SUSTAINED_MINUTES) || Boolean(minutesArg);
  const sustainedMinutes = minutesArg
    ? parseFloat(minutesArg.split('=')[1])
    : process.env.BENCHMARK_SUSTAINED_MINUTES
    ? parseFloat(process.env.BENCHMARK_SUSTAINED_MINUTES)
    : 15;
  const isEmergencyStopTest = process.env.BENCHMARK_TEST_EMERGENCY_STOP === 'true';

  console.log(`🏁 ====================================================================`);
  console.log(`   SELECTPHOTO / LUMORA — BENCHMARK DE CAPACIDADE V3 (COMPROVAÇÃO TOTAL)`);
  console.log(`   40 Contas Reais (2 Admins, 8 Fotógrafos, 30 Vendedores)`);
  console.log(`   5.280 Fichas Históricas no Ciclo Completo | 17 Jornadas Reais`);
  console.log(`   Asserções Before/After & Pós-Falha | Série Temporal | Zero Tolerância`);
  if (isEmergencyStopTest) {
    console.log(`   ⚠️ MODO TESTE DE PARADA EMERGENCIAL ATIVADO (Teto RSS = 1 MB)`);
  } else if (isSustainedMode) {
    console.log(`   ⏳ MODO SUSTENTADO ATIVADO (${sustainedMinutes} minutos por relógio monotônico)`);
  } else {
    console.log(`   📊 MATRIZ COMPLETA DE CONCORRÊNCIA (Pool 3 e 5 | 10, 20 e 40 Usuários)`);
  }
  console.log(`====================================================================\n`);

  const adminDb = new PrismaClient({
    datasources: { db: { url: targetDbUrl } },
  });

  const results: Array<{
    scenario: string;
    limit: number;
    concurrency: number;
    result: BenchmarkRoundResult;
  }> = [];

  let allPassed = true;
  const benchmarkExecutionStartTime = new Date();

  try {
    await verifyDatabaseSafetyMarkerStrict(adminDb);
    await seedData(adminDb);

    if (isEmergencyStopTest) {
      console.log(`\n🚨 EXECUTANDO TESTE DA PARADA EMERGENCIAL COM TETO REDUZIDO...`);
      const limit = 3;
      const conc = 10;
      const serverInstance = await startIsolatedServer(limit, 10);
      console.log(`✅ Servidor backend pronto em ${serverInstance.baseUrl} (PID: ${serverInstance.pid})`);

      try {
        const res = await runBenchmarkRound(adminDb, serverInstance, {
          connectionLimit: limit,
          poolTimeout: 10,
          totalIterations: 500,
          concurrency: conc,
          thinkTimeMs: 10,
          maxRssMb: 1, // Teto minúsculo forçando acionamento imediato da parada de emergência
        });

        results.push({
          scenario: `Teste de Parada Emergencial | Pool: ${limit} | VUs: ${conc}`,
          limit,
          concurrency: conc,
          result: res,
        });

        if (!res.passed) allPassed = false;
      } finally {
        await stopIsolatedServer(serverInstance);
      }
    } else if (isSustainedMode) {
      console.log(`\n⏳ INICIANDO MODO SUSTENTADO DE ${sustainedMinutes} MINUTOS (RELÓGIO MONOTÔNICO)...`);
      const limit = 3;
      const conc = 40;
      const sustainedDurationSec = Math.round(sustainedMinutes * 60);

      const serverInstance = await startIsolatedServer(limit, 10);
      console.log(`✅ Servidor backend pronto em ${serverInstance.baseUrl} (PID: ${serverInstance.pid})`);

      try {
        const res = await runBenchmarkRound(adminDb, serverInstance, {
          connectionLimit: limit,
          poolTimeout: 10,
          durationSeconds: sustainedDurationSec,
          concurrency: conc,
          thinkTimeMs: 25,
        });

        // Verificar cobertura de todas as 17 jornadas
        const missingJourneys = Object.entries(res.journeyCounts).filter(([_, count]) => count === 0);
        if (missingJourneys.length > 0) {
          res.passed = false;
          res.failReasons.push(`Cobertura incompleta no modo sustentado: jornadas sem execução: ${missingJourneys.map(([j]) => j).join(', ')}`);
        }

        results.push({
          scenario: `Modo Sustentado (${sustainedMinutes}m) | Pool: ${limit} | VUs: ${conc}`,
          limit,
          concurrency: conc,
          result: res,
        });

        if (!res.passed) allPassed = false;
      } finally {
        await stopIsolatedServer(serverInstance);
      }
    } else {
      // Matriz Completa de Concorrência: Pool 3 e 5 | 10, 20 e 40 Usuários Virtuais
      for (const limit of [3, 5]) {
        console.log(`\n----------------------------------------------------------------------`);
        console.log(`🔌 INICIALIZANDO SERVIDOR DE TESTE COM CONNECTION_LIMIT = ${limit}`);
        console.log(`----------------------------------------------------------------------`);

        const serverInstance = await startIsolatedServer(limit, 10);
        console.log(`✅ Servidor backend pronto em ${serverInstance.baseUrl} (PID: ${serverInstance.pid})`);

        try {
          console.log('🔥 Executando aquecimento inicial de 50 iterações...');
          await runBenchmarkRound(adminDb, serverInstance, {
            connectionLimit: limit,
            poolTimeout: 10,
            totalIterations: 50,
            concurrency: 5,
            thinkTimeMs: 10,
          });

          for (const conc of [10, 20, 40]) {
            const iterCount = conc === 40 ? 600 : 300;
            const res = await runBenchmarkRound(adminDb, serverInstance, {
              connectionLimit: limit,
              poolTimeout: 10,
              totalIterations: iterCount,
              concurrency: conc,
              thinkTimeMs: 15,
            });

            results.push({
              scenario: `Conexões: ${limit} | Usuários: ${conc}`,
              limit,
              concurrency: conc,
              result: res,
            });

            if (!res.passed) allPassed = false;
          }
        } finally {
          console.log(`🛑 Encerrando servidor isolado (PID: ${serverInstance.pid})...`);
          await stopIsolatedServer(serverInstance);
        }
      }
    }

    const benchmarkExecutionEndTime = new Date();

    console.log('\n======================================================================');
    console.log('📊 RELATÓRIO CONSOLIDADO DO BENCHMARK V3');
    console.log('======================================================================\n');

    const summaryTable = results.map((r) => {
      const res = r.result;
      return {
        'Cenário': r.scenario,
        'Iterações': res.totalIterations,
        'Reqs HTTP': res.totalHttpRequests,
        'Duração Solicitada': `${res.requestedDurationSeconds}s`,
        'Duração Efetiva': `${res.effectiveDurationSeconds}s`,
        'Vazão (req/s)': res.requestsPerSecond,
        'p50 (ms)': `${res.aggregatedLatencies.p50Ms} ms (${(res.aggregatedLatencies.p50Ms / 1000).toFixed(3)}s)`,
        'p95 (ms)': `${res.aggregatedLatencies.p95Ms} ms (${(res.aggregatedLatencies.p95Ms / 1000).toFixed(3)}s)`,
        'p99 (ms)': `${res.aggregatedLatencies.p99Ms} ms (${(res.aggregatedLatencies.p99Ms / 1000).toFixed(3)}s)`,
        'Máx Conexões PG (Tot/Act/Idl)': `${res.peakPgConnections}/${res.peakPgActive}/${res.peakPgIdle}*`,
        'RSS Backend': `${res.peakServerRssMb} MB`,
        'Invariantes OK': res.criticalInvariantsPassed,
        'Invariantes FALHA': res.criticalInvariantsFailed,
        'Erros Inesperados': res.unexpectedErrors,
        'Timeouts': res.poolTimeouts,
        'Motivo Término': res.terminationReason,
        'Status': res.passed ? '✅ APROVADO' : '❌ REPROVADO',
      };
    });

    console.table(summaryTable);
    console.log('\n* Nota sobre conexões: Os valores de pico (Tot/Act/Idl) representam máximos instantâneos coletados em instantes diferentes ao longo da amostragem, não uma soma aritmética simultânea.');

    const reportPath = path.resolve(__dirname, '../capacity-benchmark-report.json');
    const fullReportJson = {
      timestamp: new Date().toISOString(),
      executionRunId: RUN_ID,
      executionTiming: {
        startedAt: benchmarkExecutionStartTime.toISOString(),
        endedAt: benchmarkExecutionEndTime.toISOString(),
        totalWallClockSeconds: Math.round((benchmarkExecutionEndTime.getTime() - benchmarkExecutionStartTime.getTime()) / 1000),
      },
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        database: 'PostgreSQL 18.4 (Local isolated port 5433)',
        resourceEquivalenceNote:
          'Ambiente de execução local no Windows. Limitação V8 (--max-old-space-size=512) afeta apenas o old-gen heap e não reproduz limites de cgroups (0.5 vCPU / 512 MiB web e 0.1 vCPU / 256 MiB db) do Render. Capacidade comercial no plano Render permanece formalmente declarada como NÃO HOMOLOGADA comercialmente, dependente de homologação em ambiente espelhado ou contêineres equivalentes.',
      },
      summary: summaryTable,
      detailedResults: results,
    };

    fs.writeFileSync(reportPath, JSON.stringify(fullReportJson, null, 2), 'utf-8');
    console.log(`\n📄 Relatório JSON completo salvo em: ${reportPath}`);
  } catch (fatalErr: any) {
    console.error('\n❌ Erro fatal durante a execução do benchmark v3:', fatalErr);
    allPassed = false;
  } finally {
    await cleanSurgicalData(adminDb);
    await adminDb.$disconnect();
  }

  if (!allPassed) {
    console.error('\n🛑 [FALHA] O benchmark reprovou um ou mais critérios obrigatórios.');
    process.exit(1);
  } else {
    console.log('\n🎉 [SUCESSO] Todos os cenários e invariantes de integridade foram aprovados no ensaio local!');
    process.exit(0);
  }
}

main();
