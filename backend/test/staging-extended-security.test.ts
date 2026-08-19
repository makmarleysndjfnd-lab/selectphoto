import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

// 1. Carregar .env.test.local e configurar process.env
const envPath = path.resolve(__dirname, '../.env.test.local');
const envConfig = dotenv.parse(fs.readFileSync(envPath));
const databaseUrl = envConfig.DATABASE_URL;
const jwtSecret = envConfig.JWT_SECRET || 'selectphoto_staging_local_jwt_test_2026_nao_usar_em_producao';

process.env.DATABASE_URL = databaseUrl;
process.env.JWT_SECRET = jwtSecret;

if (!databaseUrl || !databaseUrl.includes('127.0.0.1')) {
  throw new Error('🛑 TRAVA DE TESTE: Teste de integração só pode rodar em 127.0.0.1');
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

describe('Staging Local — Testes Estendidos de Segurança, Concorrência, Upload e Resiliência', { concurrency: 1 }, () => {
  let server: any;
  let baseUrl: string;

  const uid = 'ext_' + Date.now();

  const compAlphaId = `comp_a_${uid}`;
  const compBetaId = `comp_b_${uid}`;

  const userAlphaAdmin = { id: `u_a_adm_${uid}`, role: 'ADMIN', companyId: compAlphaId, name: 'Admin Alpha', active: true };
  const userAlphaSeller1 = { id: `u_a_sel1_${uid}`, role: 'SELLER', companyId: compAlphaId, name: 'Vendedor Alpha 1', active: true };
  const userAlphaSeller2 = { id: `u_a_sel2_${uid}`, role: 'SELLER', companyId: compAlphaId, name: 'Vendedor Alpha 2', active: true };
  const userBetaAdmin = { id: `u_b_adm_${uid}`, role: 'ADMIN', companyId: compBetaId, name: 'Admin Beta', active: true };
  const userBetaSeller = { id: `u_b_sel_${uid}`, role: 'SELLER', companyId: compBetaId, name: 'Vendedor Beta', active: true };
  const userInactive = { id: `u_inact_${uid}`, role: 'SELLER', companyId: compAlphaId, name: 'Vendedor Inativo', active: false };

  let tokenAlphaAdmin: string;
  let tokenAlphaSeller1: string;
  let tokenAlphaSeller2: string;
  let tokenBetaAdmin: string;
  let tokenBetaSeller: string;
  let tokenInactiveUser: string;

  let notifAlphaId: string;

  before(async () => {
    // Importação dinâmica de routers
    const notificationsRouter = (await import('../src/routes/notifications')).default;
    const stockRouter = (await import('../src/routes/stock')).default;
    const uploadRouter = (await import('../src/routes/upload')).default;
    const closingRouter = (await import('../src/routes/closing')).default;
    const backupRouter = (await import('../src/routes/backup')).default;
    const clientsRouter = (await import('../src/routes/clients')).default;

    const app = express();
    app.use(express.json({ limit: '20mb' }));

    app.use('/api/notifications', notificationsRouter);
    app.use('/api/stock', stockRouter);
    app.use('/api/upload', uploadRouter);
    app.use('/api/closing', closingRouter);
    app.use('/api/backup', backupRouter);
    app.use('/api/clients', clientsRouter);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const port = (server.address() as any).port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    tokenAlphaAdmin = jwt.sign(userAlphaAdmin, jwtSecret);
    tokenAlphaSeller1 = jwt.sign(userAlphaSeller1, jwtSecret);
    tokenAlphaSeller2 = jwt.sign(userAlphaSeller2, jwtSecret);
    tokenBetaAdmin = jwt.sign(userBetaAdmin, jwtSecret);
    tokenBetaSeller = jwt.sign(userBetaSeller, jwtSecret);
    tokenInactiveUser = jwt.sign(userInactive, jwtSecret);

    // 1. Criar Empresas
    await prisma.company.create({
      data: { id: compAlphaId, name: 'Empresa Alpha Ext', cnpj: `33.333.333/${uid.slice(-4)}-33` },
    });
    await prisma.company.create({
      data: { id: compBetaId, name: 'Empresa Beta Ext', cnpj: `44.444.444/${uid.slice(-4)}-44` },
    });

    // 2. Criar Usuários
    await prisma.user.create({
      data: { id: userAlphaAdmin.id, name: userAlphaAdmin.name, email: `adm_${uid}@a.test`, role: 'ADMIN', companyId: compAlphaId, password: 'hash', active: true },
    });
    await prisma.user.create({
      data: { id: userAlphaSeller1.id, name: userAlphaSeller1.name, email: `sel1_${uid}@a.test`, role: 'SELLER', companyId: compAlphaId, password: 'hash', active: true },
    });
    await prisma.user.create({
      data: { id: userAlphaSeller2.id, name: userAlphaSeller2.name, email: `sel2_${uid}@a.test`, role: 'SELLER', companyId: compAlphaId, password: 'hash', active: true },
    });
    await prisma.user.create({
      data: { id: userBetaAdmin.id, name: userBetaAdmin.name, email: `adm_${uid}@b.test`, role: 'ADMIN', companyId: compBetaId, password: 'hash', active: true },
    });
    await prisma.user.create({
      data: { id: userBetaSeller.id, name: userBetaSeller.name, email: `sel_${uid}@b.test`, role: 'SELLER', companyId: compBetaId, password: 'hash', active: true },
    });
    await prisma.user.create({
      data: { id: userInactive.id, name: userInactive.name, email: `inact_${uid}@a.test`, role: 'SELLER', companyId: compAlphaId, password: 'hash', active: false },
    });

    // 3. Criar Notificação para Vendedor Alpha 1
    const notif = await prisma.notification.create({
      data: {
        title: 'Notificação Privada Alpha',
        message: 'Mensagem confidencial Alpha',
        type: 'SYSTEM',
        status: 'UNREAD',
        recipientId: userAlphaSeller1.id,
        companyId: compAlphaId,
      },
    });
    notifAlphaId = notif.id;

    // 4. Inicializar Saldo de Capas para Vendedor Alpha 1 (10 capas)
    await prisma.sellerCoverBalance.create({
      data: { sellerId: userAlphaSeller1.id, balance: 10 },
    });
  });

  after(async () => {
    if (server) server.close();
    await prisma.sellerCoverBalance.deleteMany({ where: { sellerId: { in: [userAlphaSeller1.id, userAlphaSeller2.id, userBetaSeller.id] } } }).catch(() => {});
    await prisma.sellerCoverTransfer.deleteMany({ where: { companyId: { in: [compAlphaId, compBetaId] } } }).catch(() => {});
    await prisma.coverStockBatch.deleteMany({ where: { companyId: { in: [compAlphaId, compBetaId] } } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { companyId: { in: [compAlphaId, compBetaId] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [userAlphaAdmin.id, userAlphaSeller1.id, userAlphaSeller2.id, userBetaAdmin.id, userBetaSeller.id, userInactive.id] } } }).catch(() => {});
    await prisma.company.deleteMany({ where: { id: { in: [compAlphaId, compBetaId] } } }).catch(() => {});
    await prisma.$disconnect();
  });

  // ── 1. SEGURANÇA EM NOTIFICAÇÕES ──────────────────────────────────────────

  it('1. Notificações: Vendedor Beta NÃO pode ler ou marcar notificação do Vendedor Alpha (404)', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/${notifAlphaId}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenBetaSeller}` },
    });
    assert.equal(res.status, 404);

    // Garante que o status no banco permaneceu UNREAD
    const n = await prisma.notification.findUnique({ where: { id: notifAlphaId } });
    assert.equal(n?.status, 'UNREAD');
  });

  it('2. Notificações: Vendedor Alpha 1 (destinatário legítimo) PODE marcar como lida', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/${notifAlphaId}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenAlphaSeller1}` },
    });
    assert.equal(res.status, 200);

    const n = await prisma.notification.findUnique({ where: { id: notifAlphaId } });
    assert.equal(n?.status, 'READ');
  });

  // ── 2. SEGURANÇA E OPERAÇÕES DE ESTOQUE ────────────────────────────────────

  it('3. Estoque: Admin Alpha NÃO pode transferir capas para vendedor de outra empresa (404)', async () => {
    const res = await fetch(`${baseUrl}/api/stock/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAlphaAdmin}` },
      body: JSON.stringify({ sellerId: userBetaSeller.id, quantity: 5 }),
    });
    assert.equal(res.status, 404);
    const data: any = await res.json();
    assert.equal(data.error, 'Vendedor não encontrado na sua empresa');
  });

  it('4. Estoque: Vendedor Alpha 1 NÃO pode transferir capas para Vendedor Beta de outra empresa (404)', async () => {
    const res = await fetch(`${baseUrl}/api/stock/transfer-between-sellers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAlphaSeller1}` },
      body: JSON.stringify({ recipientId: userBetaSeller.id, quantity: 2 }),
    });
    assert.equal(res.status, 404);
    const data: any = await res.json();
    assert.equal(data.error, 'Vendedor destinatário não encontrado na sua empresa');
  });

  it('5. Estoque: Vendedor Alpha 1 NÃO pode devolver mais capas do que possui em saldo (400)', async () => {
    const res = await fetch(`${baseUrl}/api/stock/return-cover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAlphaSeller1}` },
      body: JSON.stringify({ quantity: 999 }),
    });
    assert.equal(res.status, 400);
  });

  it('6. Estoque: Vendedor comum NÃO pode criar lotes de estoque admin (403)', async () => {
    const res = await fetch(`${baseUrl}/api/stock/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAlphaSeller1}` },
      body: JSON.stringify({ quantity: 100 }),
    });
    assert.equal(res.status, 403);
  });

  // ── 3. CONCORRÊNCIA E SALDO NEGATIVO EM ESTOQUE ────────────────────────────

  it('7. Concorrência: Vendedor com 10 capas tentando transferências concorrentes não pode ter saldo negativo', async () => {
    // Vendedor Alpha 1 tem saldo 10. Dispara 3 requisições simultâneas de devolução de 6 capas (total 18).
    const results = await Promise.all([
      fetch(`${baseUrl}/api/stock/return-cover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAlphaSeller1}` },
        body: JSON.stringify({ quantity: 6 }),
      }),
      fetch(`${baseUrl}/api/stock/return-cover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAlphaSeller1}` },
        body: JSON.stringify({ quantity: 6 }),
      }),
    ]);

    // O saldo deve ser estritamente não negativo no banco
    const balance = await prisma.sellerCoverBalance.findUnique({ where: { sellerId: userAlphaSeller1.id } });
    assert.ok(balance!.balance >= 0, `Saldo ficou negativo: ${balance?.balance}`);
  });

  // ── 4. SEGURANÇA EM UPLOAD ────────────────────────────────────────────────

  it('8. Upload: Requisição anônima sem token é rejeitada com 401', async () => {
    const res = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 401);
  });

  it('9. Upload: Requisição sem arquivo é rejeitada com 400', async () => {
    const res = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenAlphaSeller1}` },
    });
    assert.equal(res.status, 400);
  });

  // ── 5. FECHAMENTOS DIÁRIOS (CLOSING) ENTRE EMPRESAS ────────────────────────

  it('10. Fechamento: Vendedor Beta NÃO pode acessar fechamento do Vendedor Alpha (403)', async () => {
    const res = await fetch(`${baseUrl}/api/closing/daily/${userAlphaSeller1.id}`, {
      headers: { Authorization: `Bearer ${tokenBetaSeller}` },
    });
    assert.equal(res.status, 403);
  });

  it('11. Fechamento: Admin Beta NÃO pode acessar fechamento do Vendedor Alpha (403)', async () => {
    const res = await fetch(`${baseUrl}/api/closing/daily/${userAlphaSeller1.id}`, {
      headers: { Authorization: `Bearer ${tokenBetaAdmin}` },
    });
    assert.equal(res.status, 403);
  });

  // ── 6. AUTENTICAÇÃO E TOKENS INVÁLIDOS ─────────────────────────────────────

  it('12. Autenticação: Token assinado com secret incorreto é rejeitado com 403', async () => {
    const fakeToken = jwt.sign({ id: userAlphaSeller1.id, role: 'SELLER' }, 'chave_falsa_hacker_123');
    const res = await fetch(`${baseUrl}/api/clients/photographer`, {
      headers: { Authorization: `Bearer ${fakeToken}` },
    });
    assert.equal(res.status, 403);
  });

  // ── 7. IDEMPOTÊNCIA DE SINCRONIZAÇÃO OFFLINE (SIMULAÇÃO) ───────────────────

  it('13. Idempotência: Repetição da mesma requisição de atribuição não corrompe estado', async () => {
    const client = await prisma.client.create({
      data: {
        name: 'Cliente Idempotência',
        companyId: compAlphaId,
        sequenceNumber: `IDEMP_${uid}`,
        status: 'PENDING',
      },
    });

    // 1ª Atribuição
    const res1 = await fetch(`${baseUrl}/api/clients/assign-seller`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAlphaAdmin}` },
      body: JSON.stringify({ sequenceNumber: client.sequenceNumber, sellerId: userAlphaSeller1.id }),
    });
    assert.equal(res1.status, 200);

    // 2ª Atribuição repetida (mesmos dados simulando reenvio de fila offline)
    const res2 = await fetch(`${baseUrl}/api/clients/assign-seller`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAlphaAdmin}` },
      body: JSON.stringify({ sequenceNumber: client.sequenceNumber, sellerId: userAlphaSeller1.id }),
    });
    assert.equal(res2.status, 200);

    // Confirma que o cliente permanece atribuído corretamente ao mesmo vendedor
    const updatedClient = await prisma.client.findUnique({ where: { id: client.id } });
    assert.equal(updatedClient?.assignedSellerId, userAlphaSeller1.id);
  });

  // ── 8. RESILIÊNCIA E MOCKS DE IA (GEMINI / ROTEIRIZAÇÃO) ──────────────────

  it('14. Resiliência de IA: Sanitizador trata JSON corrompido ou truncado sem derrubar processo', async () => {
    const { extractCleanJson } = await import('../src/routes/events');

    // Teste 1: JSON com blocos markdown e quebra de linha
    const rawMarkdown = '```json\n{"city": "Anápolis", "cluster": 1}\n```';
    const clean1 = extractCleanJson(rawMarkdown);
    const parsed1 = JSON.parse(clean1);
    assert.equal(parsed1.city, 'Anápolis');

    // Teste 2: Texto explicativo com JSON embutido
    const rawText = 'Aqui está a sugestão:\n{"route": ["Goiânia", "Trindade"]}\nEspero ter ajudado!';
    const clean2 = extractCleanJson(rawText);
    const parsed2 = JSON.parse(clean2);
    assert.deepEqual(parsed2.route, ['Goiânia', 'Trindade']);

    // Teste 3: String sem delimitadores
    const rawDirect = '{"valid": true}';
    const clean3 = extractCleanJson(rawDirect);
    assert.equal(JSON.parse(clean3).valid, true);
  });
});
