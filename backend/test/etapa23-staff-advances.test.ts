import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { prisma, disconnectPrisma } from '../src/services/prisma';
import advancesRoutes from '../src/routes/advances';
import closingRoutes from '../src/routes/closing';
import statsRoutes from '../src/routes/stats';

const jwtSecret = 'test_jwt_secret_for_etapa23_suite_778899';
process.env.JWT_SECRET = jwtSecret;

const app = express();
app.use(express.json());
app.use('/api/advances', advancesRoutes);
app.use('/api/closing', closingRoutes);
app.use('/api/stats', statsRoutes);

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
const createdSaleIds: string[] = [];

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

  if (createdSaleIds.length > 0) {
    await prisma.sale.deleteMany({ where: { id: { in: createdSaleIds } } });
  }
  if (createdClientIds.length > 0) {
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
  }
  if (createdCompanyIds.length > 0) {
    await prisma.staffAdvanceEntry.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.operationalAuditEvent.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.cost.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.dailyClosing.deleteMany({
      where: { seller: { companyId: { in: createdCompanyIds } } },
    });
    await prisma.bookBatch.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  if (createdCompanyIds.length > 0) {
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  }

  await disconnectPrisma();
});

test('Etapa 23: Vales/Pendências (Vendedores & Fotógrafos), Fechamento integrado, Estatísticas, Somente Leitura e Multi-Tenant', async (t) => {
  const baseUrl = await getBaseUrl;
  const suffix = randomUUID().slice(0, 8);
  const passwordHash = await bcrypt.hash('Test@123', 10);

  const [compA, compB] = await Promise.all([
    prisma.company.create({
      data: {
        name: `Etapa23 Comp A ${suffix}`,
        tradeName: `Studio A23 ${suffix}`,
        companyPixKey: `pix-empresa-a23-${suffix}@pix.com`,
        companyPixKeyType: 'EMAIL',
        advanceAlertLimitCents: 40000, // R$ 400,00
        advanceAlertDays: 5,
      },
    }),
    prisma.company.create({
      data: {
        name: `Etapa23 Comp B ${suffix}`,
        tradeName: `Studio B23 ${suffix}`,
      },
    }),
  ]);
  createdCompanyIds.push(compA.id, compB.id);

  const adminAId = randomUUID();
  const adminBId = randomUUID();
  const sellerA1Id = randomUUID();
  const sellerA2Id = randomUUID();
  const photogAId = randomUUID();
  const sellerBId = randomUUID();

  await prisma.user.createMany({
    data: [
      {
        id: adminAId,
        name: 'Admin A23',
        cpf: `9201${suffix}`,
        email: `admin-a23-${suffix}@test.local`,
        password: passwordHash,
        role: 'ADMIN',
        companyId: compA.id,
        active: true,
        activeSessionId: `sess-${adminAId}`,
      },
      {
        id: adminBId,
        name: 'Admin B23',
        cpf: `9202${suffix}`,
        email: `admin-b23-${suffix}@test.local`,
        password: passwordHash,
        role: 'ADMIN',
        companyId: compB.id,
        active: true,
        activeSessionId: `sess-${adminBId}`,
      },
      {
        id: sellerA1Id,
        name: 'Vendedor Um A23',
        cpf: `9203${suffix}`,
        email: `seller1-a23-${suffix}@test.local`,
        password: passwordHash,
        role: 'SELLER',
        companyId: compA.id,
        active: true,
        pixKey: `seller1-${suffix}@pix.com`,
        activeSessionId: `sess-${sellerA1Id}`,
      },
      {
        id: sellerA2Id,
        name: 'Vendedor Dois A23',
        cpf: `9204${suffix}`,
        email: `seller2-a23-${suffix}@test.local`,
        password: passwordHash,
        role: 'SELLER',
        companyId: compA.id,
        active: true,
        pixKey: `seller2-${suffix}@pix.com`,
        activeSessionId: `sess-${sellerA2Id}`,
      },
      {
        id: photogAId,
        name: 'Fotógrafo A23',
        cpf: `9205${suffix}`,
        email: `photog-a23-${suffix}@test.local`,
        password: passwordHash,
        role: 'PHOTOGRAPHER',
        companyId: compA.id,
        active: true,
        activeSessionId: `sess-${photogAId}`,
      },
      {
        id: sellerBId,
        name: 'Vendedor B23',
        cpf: `9206${suffix}`,
        email: `seller-b23-${suffix}@test.local`,
        password: passwordHash,
        role: 'SELLER',
        companyId: compB.id,
        active: true,
        activeSessionId: `sess-${sellerBId}`,
      },
    ],
  });
  createdUserIds.push(adminAId, adminBId, sellerA1Id, sellerA2Id, photogAId, sellerBId);

  const adminAToken = makeToken({ id: adminAId, role: 'ADMIN', companyId: compA.id, name: 'Admin A23' });
  const adminBToken = makeToken({ id: adminBId, role: 'ADMIN', companyId: compB.id, name: 'Admin B23' });
  const sellerA1Token = makeToken({ id: sellerA1Id, role: 'SELLER', companyId: compA.id, name: 'Vendedor Um A23' });
  const photogAToken = makeToken({ id: photogAId, role: 'PHOTOGRAPHER', companyId: compA.id, name: 'Fotógrafo A23' });

  const batchA = await prisma.bookBatch.create({
    data: {
      name: `Lote Vales23 ${suffix}`,
      city: 'Joinville',
      companyId: compA.id,
      photographerId: photogAId,
      status: 'IN_STOCK',
    },
  });
  createdBatchIds.push(batchA.id);

  await t.test('1) Lançamento e abatimento de vales (Vendedor e Fotógrafo), ordenação, flags de alerta e bloqueio de abatimento excedente', async () => {
    // Cria vale para Fotógrafo A23 (R$ 500,00 > limite R$ 400,00 -> isOverLimit = true)
    const createPhotogAdv = await apiJson(baseUrl, '/api/advances', {
      method: 'POST',
      token: adminAToken,
      body: {
        userId: photogAId,
        profileRole: 'PHOTOGRAPHER',
        category: 'TRIP_EVENT_ADVANCE',
        amountCents: 50000,
        notes: 'Adiantamento viagem Joinville',
        batchId: batchA.id,
        signatureBase64: 'c2lnbmF0dXJlLW1vY2s=',
      },
    });
    assert.equal(createPhotogAdv.status, 201);
    assert.equal(createPhotogAdv.json?.statement?.summary?.totalOpenCents, 50000);
    assert.equal(createPhotogAdv.json?.statement?.summary?.isOverLimit, true);

    // Tentativa de abater acima do saldo (R$ 600,00 > R$ 500,00) deve ser bloqueada em transação Serializable
    const overSettleRes = await apiJson(baseUrl, '/api/advances/settle', {
      method: 'POST',
      token: adminAToken,
      body: {
        userId: photogAId,
        amountCents: 60000,
        notes: 'Tentativa excedente',
      },
    });
    assert.equal(overSettleRes.status, 400);

    // Abatimento parcial válido de R$ 200,00 -> resta R$ 300,00 (abaixo do limite de R$ 400,00)
    const settlePhotogRes = await apiJson(baseUrl, '/api/advances/settle', {
      method: 'POST',
      token: adminAToken,
      body: {
        userId: photogAId,
        amountCents: 20000,
        notes: 'Abatimento parcial acerto viagem',
      },
    });
    assert.equal(settlePhotogRes.status, 201);
    assert.equal(settlePhotogRes.json?.remainingOpenCents, 30000);
    assert.equal(settlePhotogRes.json?.statement?.summary?.isOverLimit, false);

    // Lança vale retroativo para Vendedor Um (R$ 150,00 há 10 dias > 5 dias -> isOverdue = true)
    const oldDate = new Date(Date.now() - 10 * 86400 * 1000);
    await prisma.staffAdvanceEntry.create({
      data: {
        companyId: compA.id,
        userId: sellerA1Id,
        profileRole: 'SELLER',
        category: 'ROUTE_ADVANCE',
        direction: 'DEBIT',
        amountCents: 15000,
        notes: 'Adiantamento rota antiga',
        createdById: adminAId,
        createdAt: oldDate,
      },
    });

    const listSellers = await apiJson(baseUrl, '/api/advances?role=SELLER', { token: adminAToken });
    assert.equal(listSellers.status, 200);
    assert.equal(listSellers.json?.professionals?.[0]?.userId, sellerA1Id);
    assert.equal(listSellers.json?.professionals?.[0]?.totalOpenCents, 15000);
    assert.equal(listSellers.json?.professionals?.[0]?.isOverdue, true);
    assert.equal(listSellers.json?.professionals?.[0]?.hasAlert, true);
    // Seller 2 sem saldo aparece depois de Seller 1
    assert.equal(listSellers.json?.professionals?.[1]?.userId, sellerA2Id);
    assert.equal(listSellers.json?.professionals?.[1]?.totalOpenCents, 0);
  });

  await t.test('2) Acesso somente leitura (/api/advances/my) e isolamento estrito multi-tenant', async () => {
    // Vendedor consegue ler o próprio extrato em modo readOnly
    const myRes = await apiJson(baseUrl, '/api/advances/my', { token: sellerA1Token });
    assert.equal(myRes.status, 200);
    assert.equal(myRes.json?.readOnly, true);
    assert.equal(myRes.json?.summary?.totalOpenCents, 15000);

    // Fotógrafo também consegue ler apenas o próprio extrato
    const myPhotogRes = await apiJson(baseUrl, '/api/advances/my', { token: photogAToken });
    assert.equal(myPhotogRes.status, 200);
    assert.equal(myPhotogRes.json?.readOnly, true);
    assert.equal(myPhotogRes.json?.summary?.totalOpenCents, 30000);

    // Profissional de campo NÃO pode criar, abater nem acessar extrato de outro ou listagem admin
    const sellerPost = await apiJson(baseUrl, '/api/advances', {
      method: 'POST',
      token: sellerA1Token,
      body: { userId: sellerA1Id, category: 'PERSONAL_ADVANCE', amountCents: 1000 },
    });
    assert.equal(sellerPost.status, 403);

    const sellerSettle = await apiJson(baseUrl, '/api/advances/settle', {
      method: 'POST',
      token: sellerA1Token,
      body: { userId: sellerA1Id, amountCents: 1000 },
    });
    assert.equal(sellerSettle.status, 403);

    const sellerViewOther = await apiJson(baseUrl, `/api/advances/user/${photogAId}`, {
      token: sellerA1Token,
    });
    assert.equal(sellerViewOther.status, 403);

    // Empresa B NÃO acessa dados da Empresa A
    const crossList = await apiJson(baseUrl, `/api/advances/user/${sellerA1Id}`, {
      token: adminBToken,
    });
    assert.equal(crossList.status, 404);
  });

  await t.test('3) Integração Fechamento SELLER_PAYS_COMPANY (repasse parcial -> CLOSING_SHORTFALL idempotente) e COMPANY_PAYS_SELLER (FULL / PARTIAL / NONE)', async () => {
    const clientCash = await prisma.client.create({
      data: {
        uuid: randomUUID(),
        name: 'Comprador Cash 23',
        city: 'Joinville',
        companyId: compA.id,
        photographerId: photogAId,
        assignedSellerId: sellerA2Id,
        bookStatus: 'SOLD',
        outcomeStatus: 'SOLD',
        sequenceNumber: `23C-${suffix}`,
      },
    });
    const clientPix = await prisma.client.create({
      data: {
        uuid: randomUUID(),
        name: 'Comprador Pix 23',
        city: 'Joinville',
        companyId: compA.id,
        photographerId: photogAId,
        assignedSellerId: sellerA1Id,
        bookStatus: 'SOLD',
        outcomeStatus: 'SOLD',
        sequenceNumber: `23P-${suffix}`,
      },
    });
    createdClientIds.push(clientCash.id, clientPix.id);

    // Vendedor 2 vendeu R$ 1.000 em dinheiro (comissão 20% = R$ 200 -> Seller repassa R$ 800 à empresa)
    const saleCash = await prisma.sale.create({
      data: {
        clientId: clientCash.id,
        sellerId: sellerA2Id,
        companyId: compA.id,
        city: 'Joinville',
        paymentMethod: 'CASH',
        value: 1000,
        receiptUrl: `/uploads/cash23_${suffix}.jpg`,
      },
    });
    // Vendedor 1 vendeu R$ 1.000 em Pix (comissão 20% = R$ 200 -> Empresa paga R$ 200 ao Seller 1, que tem vale de R$ 150)
    const salePix = await prisma.sale.create({
      data: {
        clientId: clientPix.id,
        sellerId: sellerA1Id,
        companyId: compA.id,
        city: 'Joinville',
        paymentMethod: 'PIX',
        value: 1000,
        receiptUrl: `/uploads/pix23_${suffix}.jpg`,
      },
    });
    createdSaleIds.push(saleCash.id, salePix.id);

    // Verifica GET /api/closing/daily para Seller 1 trazendo openAdvancesSummary
    const dailyS1Before = await apiJson(baseUrl, `/api/closing/daily/${sellerA1Id}`, {
      token: adminAToken,
    });
    assert.equal(dailyS1Before.status, 200);
    assert.equal(dailyS1Before.json?.finalDirection, 'COMPANY_PAYS_SELLER');
    assert.equal(dailyS1Before.json?.openAdvancesCents, 15000);
    assert.equal(dailyS1Before.json?.openAdvancesSummary?.isOverdue, true);

    // Repasse parcial de Seller 2: devia R$ 800, repassou R$ 550 -> diferença R$ 250 vira CLOSING_SHORTFALL
    const shortRef = `shortfall-ref-${suffix}`;
    const partialPayRes = await apiJson(baseUrl, '/api/closing/pay-repasse', {
      method: 'POST',
      token: adminAToken,
      body: {
        sellerId: sellerA2Id,
        amount: 550,
        paidAmount: 550,
        expectedAmount: 800,
        direction: 'SELLER_PAYS_COMPANY',
        registerShortfallAsAdvance: true,
        closingReference: shortRef,
      },
    });
    assert.equal(partialPayRes.status, 201);
    assert.equal(partialPayRes.json?.shortfallCents, 25000);
    assert.equal(partialPayRes.json?.advanceEntry?.category, 'CLOSING_SHORTFALL');
    assert.equal(partialPayRes.json?.advanceEntry?.amountCents, 25000);

    // Reenvio idempotente com mesmo closingReference não duplica
    const dupShortRes = await apiJson(baseUrl, '/api/closing/pay-repasse', {
      method: 'POST',
      token: adminAToken,
      body: {
        sellerId: sellerA2Id,
        amount: 550,
        paidAmount: 550,
        expectedAmount: 800,
        direction: 'SELLER_PAYS_COMPANY',
        registerShortfallAsAdvance: true,
        closingReference: shortRef,
      },
    });
    assert.equal(dupShortRes.status, 200);
    assert.equal(dupShortRes.json?.alreadyProcessed, true);

    // E agora no GET /api/closing/daily/:sellerId, o fechamento do Seller 2 está SETTLED (sem dupla contagem) enquanto o vale está R$ 250
    const dailyS2After = await apiJson(baseUrl, `/api/closing/daily/${sellerA2Id}`, {
      token: adminAToken,
    });
    assert.equal(dailyS2After.status, 200);
    assert.equal(dailyS2After.json?.openAdvancesCents, 25000);

    // COMPANY_PAYS_SELLER para Seller 1 com modo PARTIAL (abate R$ 100 de R$ 150 em aberto, transfere R$ 100 líquido de R$ 200)
    const payPartRef = `pay-part-${suffix}`;
    const companyPayPartial = await apiJson(baseUrl, '/api/closing/pay-repasse', {
      method: 'POST',
      token: adminAToken,
      body: {
        sellerId: sellerA1Id,
        amount: 200,
        direction: 'COMPANY_PAYS_SELLER',
        advanceDeductionMode: 'PARTIAL',
        advanceDeductionCents: 10000,
        closingReference: payPartRef,
      },
    });
    assert.equal(companyPayPartial.status, 201);
    assert.equal(companyPayPartial.json?.grossAmountCents, 20000);
    assert.equal(companyPayPartial.json?.advanceDeductedCents, 10000);
    assert.equal(companyPayPartial.json?.netTransferCents, 10000);
    assert.equal(companyPayPartial.json?.openAdvancesRemainingCents, 5000);

    // Idempotência no pagamento COMPANY_PAYS_SELLER
    const dupPayPartial = await apiJson(baseUrl, '/api/closing/pay-repasse', {
      method: 'POST',
      token: adminAToken,
      body: {
        sellerId: sellerA1Id,
        amount: 200,
        direction: 'COMPANY_PAYS_SELLER',
        advanceDeductionMode: 'PARTIAL',
        advanceDeductionCents: 10000,
        closingReference: payPartRef,
      },
    });
    assert.equal(dupPayPartial.status, 200);
    assert.equal(dupPayPartial.json?.alreadyProcessed, true);

    // Agora testa modo NONE (mantém restante R$ 50 em aberto) vs FULL
    const companyPayNone = await apiJson(baseUrl, '/api/closing/pay-repasse', {
      method: 'POST',
      token: adminAToken,
      body: {
        sellerId: sellerA1Id,
        amount: 100,
        direction: 'COMPANY_PAYS_SELLER',
        advanceDeductionMode: 'NONE',
      },
    });
    assert.equal(companyPayNone.status, 201);
    assert.equal(companyPayNone.json?.advanceDeductedCents, 0);
    assert.equal(companyPayNone.json?.netTransferCents, 10000);
    assert.equal(companyPayNone.json?.openAdvancesRemainingCents, 5000);

    // Agora testa modo FULL (quita os R$ 50 restantes automaticamente, Pix líquido R$ 150)
    const companyPayFull = await apiJson(baseUrl, '/api/closing/pay-repasse', {
      method: 'POST',
      token: adminAToken,
      body: {
        sellerId: sellerA1Id,
        amount: 200,
        direction: 'COMPANY_PAYS_SELLER',
        advanceDeductionMode: 'FULL',
        closingReference: `pay-full-${suffix}`,
      },
    });
    assert.equal(companyPayFull.status, 201);
    assert.equal(companyPayFull.json?.advanceDeductedCents, 5000);
    assert.equal(companyPayFull.json?.netTransferCents, 15000);
    assert.equal(companyPayFull.json?.openAdvancesRemainingCents, 0);
  });

  await t.test('4) Estatísticas (/api/stats/books) inclui valesEmAberto consolidado', async () => {
    const statsRes = await apiJson(baseUrl, '/api/stats/books', { token: adminAToken });
    assert.equal(statsRes.status, 200);
    const vales = statsRes.json?.valesEmAberto;
    assert.ok(vales);
    // Seller 1 zerou (0), Seller 2 tem 25000, Fotógrafo A tem 30000
    assert.equal(vales.totalVendedoresCents, 25000);
    assert.equal(vales.totalFotografosCents, 30000);
    assert.equal(vales.totalGeralCents, 55000);
    assert.equal(vales.qtdVendedoresComSaldo, 1);
    assert.equal(vales.qtdFotografosComSaldo, 1);
  });
});
