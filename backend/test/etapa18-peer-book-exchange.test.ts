import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { prisma, disconnectPrisma } from '../src/services/prisma';
import booksRoutes from '../src/routes/books';
import clientRoutes from '../src/routes/clients';
import usersRoutes from '../src/routes/users';

const jwtSecret = 'test_jwt_secret_for_etapa18_suite_987654';
process.env.JWT_SECRET = jwtSecret;

const app = express();
app.use(express.json());
app.use('/api/books', booksRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/users', usersRoutes);

const server = app.listen(0, '127.0.0.1');
const getBaseUrl = new Promise<string>((resolve) => {
  server.once('listening', () => {
    const port = (server.address() as AddressInfo).port;
    resolve(`http://127.0.0.1:${port}`);
  });
});

const createdCompanyIds: string[] = [];
const createdUserIds: string[] = [];
const createdBatchIds: string[] = [];
const createdClientIds: string[] = [];

function makeToken(user: {
  id: string;
  role: string;
  companyId: string;
  name: string;
}) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      companyId: user.companyId,
      name: user.name,
      sessionId: `sess-${user.id}`,
    },
    jwtSecret,
    { expiresIn: '1h' }
  );
}

async function apiJson(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; body?: any } = {}
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  if (createdCompanyIds.length > 0) {
    await prisma.bookTransfer.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
  }

  if (createdClientIds.length > 0) {
    await prisma.clientTimeline.deleteMany({
      where: { clientId: { in: createdClientIds } },
    });
    await prisma.client.deleteMany({
      where: { id: { in: createdClientIds } },
    });
  }

  if (createdCompanyIds.length > 0) {
    await prisma.operationalAuditEvent.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.bookBatch.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
  } else if (createdBatchIds.length > 0) {
    await prisma.bookBatch.deleteMany({
      where: { id: { in: createdBatchIds } },
    });
  }

  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({
      where: { id: { in: createdUserIds } },
    });
  }

  if (createdCompanyIds.length > 0) {
    await prisma.company.deleteMany({
      where: { id: { in: createdCompanyIds } },
    });
  }

  await disconnectPrisma();
});

test('Etapa 18 — Troca direta de books entre vendedores com validação por login e rastreamento em tempo real', async (t) => {
  const baseUrl = await getBaseUrl;
  const suffix = randomUUID().slice(0, 8);
  const hashA = await bcrypt.hash('TrocaSenha1!', 10);
  const hashB = await bcrypt.hash('TrocaSenha2!', 10);

  const compA = await prisma.company.create({
    data: { name: `Empresa E18 A ${suffix}` },
  });
  const compB = await prisma.company.create({
    data: { name: `Empresa E18 B ${suffix}` },
  });
  createdCompanyIds.push(compA.id, compB.id);

  const adminAId = randomUUID();
  const photogAId = randomUUID();
  const seller1Id = randomUUID();
  const seller2Id = randomUUID();
  const seller3Id = randomUUID();
  const sellerBlockedId = randomUUID();
  const sellerBId = randomUUID();

  const cpf1 = `8101${suffix}`;
  const cpf2 = `8102${suffix}`;
  const cpf3 = `8103${suffix}`;
  const cpfBlocked = `8104${suffix}`;
  const cpfB = `8105${suffix}`;

  await prisma.user.createMany({
    data: [
      {
        id: adminAId,
        name: `Admin E18 A ${suffix}`,
        cpf: `8100${suffix}`,
        email: `admin_e18_${suffix}@test.local`,
        password: hashA,
        role: 'ADMIN',
        companyId: compA.id,
        active: true,
        activeSessionId: `sess-${adminAId}`,
      },
      {
        id: photogAId,
        name: `Fotografo E18 ${suffix}`,
        cpf: `8109${suffix}`,
        email: `foto_e18_${suffix}@test.local`,
        password: hashA,
        role: 'PHOTOGRAPHER',
        companyId: compA.id,
        active: true,
        activeSessionId: `sess-${photogAId}`,
      },
      {
        id: seller1Id,
        name: `Joao Silva ${suffix}`,
        cpf: cpf1,
        email: `joao_${suffix}@test.local`,
        password: hashA,
        role: 'SELLER',
        companyId: compA.id,
        active: true,
        activeSessionId: `sess-${seller1Id}`,
      },
      {
        id: seller2Id,
        name: `Maria Souza ${suffix}`,
        cpf: cpf2,
        email: `maria_${suffix}@test.local`,
        password: hashB,
        role: 'SELLER',
        companyId: compA.id,
        active: true,
        activeSessionId: `sess-${seller2Id}`,
      },
      {
        id: seller3Id,
        name: `Carlos Lima ${suffix}`,
        cpf: cpf3,
        email: `carlos_${suffix}@test.local`,
        password: hashA,
        role: 'SELLER_MANAGER',
        companyId: compA.id,
        active: true,
        activeSessionId: `sess-${seller3Id}`,
      },
      {
        id: sellerBlockedId,
        name: `Bloqueado ${suffix}`,
        cpf: cpfBlocked,
        email: `blocked_${suffix}@test.local`,
        password: hashA,
        role: 'SELLER',
        companyId: compA.id,
        active: true,
        sellerBlocked: true,
        sellerBlockedReason: 'Divergência pendente',
        activeSessionId: `sess-${sellerBlockedId}`,
      },
      {
        id: sellerBId,
        name: `Vendedor Comp B ${suffix}`,
        cpf: cpfB,
        email: `compb_${suffix}@test.local`,
        password: hashA,
        role: 'SELLER',
        companyId: compB.id,
        active: true,
        activeSessionId: `sess-${sellerBId}`,
      },
    ],
  });
  createdUserIds.push(
    adminAId,
    photogAId,
    seller1Id,
    seller2Id,
    seller3Id,
    sellerBlockedId,
    sellerBId
  );

  const adminAToken = makeToken({
    id: adminAId,
    role: 'ADMIN',
    companyId: compA.id,
    name: `Admin E18 A ${suffix}`,
  });
  const seller1Token = makeToken({
    id: seller1Id,
    role: 'SELLER',
    companyId: compA.id,
    name: `Joao Silva ${suffix}`,
  });
  const seller2Token = makeToken({
    id: seller2Id,
    role: 'SELLER',
    companyId: compA.id,
    name: `Maria Souza ${suffix}`,
  });
  const sellerBlockedToken = makeToken({
    id: sellerBlockedId,
    role: 'SELLER',
    companyId: compA.id,
    name: `Bloqueado ${suffix}`,
  });
  const sellerBToken = makeToken({
    id: sellerBId,
    role: 'SELLER',
    companyId: compB.id,
    name: `Vendedor Comp B ${suffix}`,
  });

  const batchA = await prisma.bookBatch.create({
    data: {
      name: `Lote E18 ${suffix}`,
      city: 'Londrina',
      photographerId: photogAId,
      companyId: compA.id,
      status: 'DISTRIBUTED',
      totalProduced: 2,
    },
  });
  createdBatchIds.push(batchA.id);

  const book1 = await prisma.client.create({
    data: {
      name: `Mae Book 1 ${suffix}`,
      visibleCode: `E18-A-${suffix}`,
      sequenceNumber: `001-${suffix}`,
      city: 'Londrina',
      companyId: compA.id,
      batchId: batchA.id,
      photographerId: photogAId,
      assignedSellerId: seller1Id,
      bookStatus: 'DISTRIBUTED',
      outcomeStatus: 'PENDING',
      releasedForRouting: true,
    },
  });

  const book2 = await prisma.client.create({
    data: {
      name: `Mae Book 2 ${suffix}`,
      visibleCode: `E18-B-${suffix}`,
      sequenceNumber: `002-${suffix}`,
      city: 'Londrina',
      companyId: compA.id,
      batchId: batchA.id,
      photographerId: photogAId,
      assignedSellerId: seller3Id,
      bookStatus: 'DISTRIBUTED',
      outcomeStatus: 'PENDING',
      releasedForRouting: true,
    },
  });
  createdClientIds.push(book1.id, book2.id);

  await t.test('1) Lista de vendedores elegíveis exclui bloqueados, outro tenant e o próprio solicitante', async () => {
    const sellersRes = await apiJson(baseUrl, '/api/books/peer-exchange/sellers', {
      token: seller1Token,
    });
    assert.equal(sellersRes.status, 200);
    const ids = (sellersRes.json || []).map((u: any) => u.id);
    assert.ok(ids.includes(seller2Id));
    assert.ok(ids.includes(seller3Id));
    assert.equal(ids.includes(seller1Id), false, 'Não pode listar a si próprio');
    assert.equal(ids.includes(sellerBlockedId), false, 'Não pode listar vendedor bloqueado');
    assert.equal(ids.includes(sellerBId), false, 'Não pode listar vendedor de outra empresa');
  });

  await t.test('2) Bloqueia senha/login incorretos do parceiro, vendedor bloqueado e tentativa cross-tenant', async () => {
    const wrongPwd = await apiJson(baseUrl, '/api/books/peer-exchange', {
      method: 'POST',
      token: seller1Token,
      body: {
        targetSellerId: seller2Id,
        partnerLogin: cpf2,
        partnerPassword: 'SenhaErrada999!',
        clientIds: [book1.id],
      },
    });
    assert.equal(wrongPwd.status, 401);
    assert.equal(wrongPwd.json?.code, 'PARTNER_CREDENTIALS_INVALID');

    const wrongLogin = await apiJson(baseUrl, '/api/books/peer-exchange', {
      method: 'POST',
      token: seller1Token,
      body: {
        targetSellerId: seller2Id,
        partnerLogin: cpf1, // CPF errado para Maria
        partnerPassword: 'TrocaSenha2!',
        clientIds: [book1.id],
      },
    });
    assert.equal(wrongLogin.status, 401);

    const blockedPartner = await apiJson(baseUrl, '/api/books/peer-exchange', {
      method: 'POST',
      token: seller1Token,
      body: {
        targetSellerId: sellerBlockedId,
        partnerLogin: cpfBlocked,
        partnerPassword: 'TrocaSenha1!',
        clientIds: [book1.id],
      },
    });
    assert.equal(blockedPartner.status, 403);
    assert.equal(blockedPartner.json?.code, 'PARTNER_SELLER_BLOCKED');

    const blockedRequester = await apiJson(baseUrl, '/api/books/peer-exchange', {
      method: 'POST',
      token: sellerBlockedToken,
      body: {
        targetSellerId: seller2Id,
        partnerPassword: 'TrocaSenha2!',
        clientIds: [book1.id],
      },
    });
    assert.equal(blockedRequester.status, 403);
    assert.equal(blockedRequester.json?.code, 'SELLER_BLOCKED');

    const crossTenantPartner = await apiJson(baseUrl, '/api/books/peer-exchange', {
      method: 'POST',
      token: seller1Token,
      body: {
        targetSellerId: sellerBId,
        partnerPassword: 'TrocaSenha1!',
        clientIds: [book1.id],
      },
    });
    assert.equal(crossTenantPartner.status, 403);

    const crossTenantRequester = await apiJson(baseUrl, '/api/books/peer-exchange', {
      method: 'POST',
      token: sellerBToken,
      body: {
        targetSellerId: seller2Id,
        partnerPassword: 'TrocaSenha2!',
        clientIds: [book1.id],
      },
    });
    assert.equal(crossTenantRequester.status, 403);

    const unchanged = await prisma.client.findUnique({ where: { id: book1.id } });
    assert.equal(unchanged?.assignedSellerId, seller1Id);
    const transfersCount = await prisma.bookTransfer.count({ where: { clientId: book1.id } });
    assert.equal(transfersCount, 0);
  });

  await t.test('3) Troca direta multi-salto sem Admin atualiza posse, Admin Books/Rotas em tempo real e grava trilha completa', async () => {
    // Salto 1: Seller 1 -> Seller 2 com login+senha de Seller 2
    const hop1 = await apiJson(baseUrl, '/api/books/peer-exchange', {
      method: 'POST',
      token: seller1Token,
      body: {
        targetSellerId: seller2Id,
        partnerLogin: cpf2,
        partnerPassword: 'TrocaSenha2!',
        clientIds: [book1.id],
        reason: 'Cobertura de rota em Londrina Sul',
      },
    });
    assert.equal(hop1.status, 200);
    assert.equal(hop1.json?.success, true);
    assert.equal(hop1.json?.transferredCount, 1);
    assert.equal(hop1.json?.trackingLocationLabel, `Com vendedor: Maria Souza ${suffix}`);

    // Vendedor 1 não vê mais o book1; Vendedor 2 vê imediatamente
    const [wallet1, wallet2] = await Promise.all([
      apiJson(baseUrl, '/api/clients/seller', { token: seller1Token }),
      apiJson(baseUrl, '/api/clients/seller', { token: seller2Token }),
    ]);
    assert.equal((wallet1.json || []).some((c: any) => c.id === book1.id), false);
    assert.equal((wallet2.json || []).some((c: any) => c.id === book1.id), true);

    // Salto 2 (troca bidirecional): Seller 2 entrega book1 para Seller 3 e recebe book2 de Seller 3
    const hop2 = await apiJson(baseUrl, '/api/books/peer-exchange', {
      method: 'POST',
      token: seller2Token,
      body: {
        targetSellerId: seller3Id,
        partnerLogin: `carlos_${suffix}@test.local`,
        partnerPassword: 'TrocaSenha1!',
        clientIds: [book1.id],
        counterClientIds: [book2.id],
        reason: 'Rebalanceamento entre rotas',
      },
    });
    assert.equal(hop2.status, 200);
    assert.equal(hop2.json?.transferredCount, 2);

    // Consultas do Admin refletem posse imediata em Books e Rotas Gráficas
    const adminClientsRes = await apiJson(baseUrl, '/api/clients?activeBookOnly=true', {
      token: adminAToken,
    });
    assert.equal(adminClientsRes.status, 200);
    const adminBook1 = (adminClientsRes.json || []).find((c: any) => c.id === book1.id);
    const adminBook2 = (adminClientsRes.json || []).find((c: any) => c.id === book2.id);
    assert.equal(adminBook1?.assignedSellerId, seller3Id);
    assert.equal(adminBook1?.trackingLocationLabel, `Com vendedor: Carlos Lima ${suffix}`);
    assert.equal(adminBook2?.assignedSellerId, seller2Id);
    assert.equal(adminBook2?.trackingLocationLabel, `Com vendedor: Maria Souza ${suffix}`);

    const batchesRes = await apiJson(baseUrl, '/api/books/batch', { token: adminAToken });
    assert.equal(batchesRes.status, 200);
    const batchRow = (batchesRes.json || []).find((b: any) => b.id === batchA.id);
    assert.ok(batchRow);
    const assignedIds = (batchRow.assignedSellers || []).map((s: any) => s.id);
    assert.ok(assignedIds.includes(seller2Id));
    assert.ok(assignedIds.includes(seller3Id));
    assert.equal(assignedIds.includes(seller1Id), false);

    // Histórico completo em /api/books/:id/history mostra toda a cadeia Joao -> Maria -> Carlos
    const historyRes = await apiJson(baseUrl, `/api/books/${book1.id}/history`, {
      token: adminAToken,
    });
    assert.equal(historyRes.status, 200);
    assert.equal(historyRes.json?.trackingLocationLabel, `Com vendedor: Carlos Lima ${suffix}`);
    assert.equal((historyRes.json?.transfers || []).length, 2);
    assert.equal(historyRes.json.transfers[0].fromSellerId, seller1Id);
    assert.equal(historyRes.json.transfers[0].toSellerId, seller2Id);
    assert.equal(historyRes.json.transfers[1].fromSellerId, seller2Id);
    assert.equal(historyRes.json.transfers[1].toSellerId, seller3Id);

    // Timeline enriquecida do cliente também traz nomes resolvidos e ação SELLER_PEER_EXCHANGE
    const timelineRes = await apiJson(baseUrl, `/api/clients/${book1.id}/timeline`, {
      token: adminAToken,
    });
    assert.equal(timelineRes.status, 200);
    const peerEvents = (timelineRes.json || []).filter(
      (ev: any) => ev.action === 'SELLER_PEER_EXCHANGE'
    );
    assert.equal(peerEvents.length, 2);
    assert.equal(peerEvents[0].previousSellerName, `Joao Silva ${suffix}`);
    assert.equal(peerEvents[0].newSellerName, `Maria Souza ${suffix}`);
    assert.equal(peerEvents[1].previousSellerName, `Maria Souza ${suffix}`);
    assert.equal(peerEvents[1].newSellerName, `Carlos Lima ${suffix}`);

    // Auditoria operacional gravada para todos os saltos
    const audits = await prisma.operationalAuditEvent.findMany({
      where: {
        companyId: compA.id,
        action: 'SELLER_PEER_BOOK_EXCHANGE',
      },
    });
    assert.equal(audits.length, 3);
  });
});
