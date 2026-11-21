import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { prisma, disconnectPrisma } from '../src/services/prisma';
import salesRoutes from '../src/routes/sales';
import statsRoutes from '../src/routes/stats';
import {
  issueBuyerConfirmationLink,
  getPublicBuyerConfirmationPrompt,
  submitPublicBuyerConfirmation,
  renderPublicBuyerConfirmationHtml,
  sanitizePublicBuyerConfirmationError,
} from '../src/services/buyerConfirmationService';

const jwtSecret = 'test_jwt_secret_for_etapa20_suite_987654';
process.env.JWT_SECRET = jwtSecret;

const app = express();
app.use(express.json());
app.use('/api/sales', salesRoutes);
app.use('/api/stats', statsRoutes);

app.get('/confirmar-compra/:token', async (req, res) => {
  try {
    const prompt = await getPublicBuyerConfirmationPrompt(req.params.token);
    res.setHeader('Content-Type', 'text/html; charset=utf-8').send(
      renderPublicBuyerConfirmationHtml({ token: req.params.token, prompt })
    );
  } catch (err: any) {
    const safe = sanitizePublicBuyerConfirmationError(err);
    res.status(safe.status).json({ error: safe.message, code: safe.code });
  }
});

app.post('/confirmar-compra/:token', async (req, res) => {
  try {
    const result = await submitPublicBuyerConfirmation({
      rawToken: req.params.token,
      ...req.body,
      ipAddress: '127.0.0.1',
      userAgent: 'Etapa20Test/1.0',
    });
    res.json(result);
  } catch (err: any) {
    const safe = sanitizePublicBuyerConfirmationError(err);
    res.status(safe.status).json({ error: safe.message, code: safe.code });
  }
});

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
  return { status: res.status, json, rawText: text };
}

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  if (createdSaleIds.length > 0) {
    await prisma.buyerPurchaseConfirmation.deleteMany({
      where: { saleId: { in: createdSaleIds } },
    });
    await prisma.sale.deleteMany({
      where: { id: { in: createdSaleIds } },
    });
  }

  if (createdCompanyIds.length > 0) {
    await prisma.operationalReviewAlert.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.operationalAuditEvent.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.clientTimeline.deleteMany({
      where: { clientId: { in: createdClientIds } },
    });
    await prisma.client.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.bookBatch.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
  } else if (createdClientIds.length > 0) {
    await prisma.client.deleteMany({
      where: { id: { in: createdClientIds } },
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

test('Etapa 20 — Avaliações de Vendedor/Contato/Fotógrafo, traduções PT-BR e Estatísticas multi-tenant', async (t) => {
  const baseUrl = await getBaseUrl;
  const suffix = randomUUID().slice(0, 8);
  const password = await bcrypt.hash('Senha123!', 10);

  const compA = await prisma.company.create({
    data: { name: `Empresa E20 A ${suffix}`, tradeName: `Hyper E20 ${suffix}` },
  });
  const compB = await prisma.company.create({
    data: { name: `Empresa E20 B ${suffix}`, tradeName: `Outra E20 ${suffix}` },
  });
  createdCompanyIds.push(compA.id, compB.id);

  const adminAId = randomUUID();
  const seller1Id = randomUUID();
  const seller2Id = randomUUID();
  const photogAId = randomUUID();
  const adminBId = randomUUID();
  const sellerBId = randomUUID();
  const photogBId = randomUUID();

  await prisma.user.createMany({
    data: [
      {
        id: adminAId,
        name: `Admin E20 A ${suffix}`,
        cpf: `9200${suffix}`,
        email: `admin_a_${suffix}@test.local`,
        password,
        role: 'ADMIN',
        companyId: compA.id,
        active: true,
        activeSessionId: `sess-${adminAId}`,
      },
      {
        id: seller1Id,
        name: `Vendedor Um ${suffix}`,
        cpf: `9201${suffix}`,
        email: `v1_${suffix}@test.local`,
        password,
        role: 'SELLER',
        companyId: compA.id,
        active: true,
        activeSessionId: `sess-${seller1Id}`,
      },
      {
        id: seller2Id,
        name: `Vendedor Dois ${suffix}`,
        cpf: `9202${suffix}`,
        email: `v2_${suffix}@test.local`,
        password,
        role: 'SELLER',
        companyId: compA.id,
        active: true,
        activeSessionId: `sess-${seller2Id}`,
      },
      {
        id: photogAId,
        name: `Fotografo Carlos ${suffix}`,
        cpf: `9203${suffix}`,
        email: `fa_${suffix}@test.local`,
        password,
        role: 'PHOTOGRAPHER',
        companyId: compA.id,
        active: true,
        activeSessionId: `sess-${photogAId}`,
      },
      {
        id: adminBId,
        name: `Admin E20 B ${suffix}`,
        cpf: `9204${suffix}`,
        email: `admin_b_${suffix}@test.local`,
        password,
        role: 'ADMIN',
        companyId: compB.id,
        active: true,
        activeSessionId: `sess-${adminBId}`,
      },
      {
        id: sellerBId,
        name: `Vendedor B ${suffix}`,
        cpf: `9205${suffix}`,
        email: `vb_${suffix}@test.local`,
        password,
        role: 'SELLER',
        companyId: compB.id,
        active: true,
        activeSessionId: `sess-${sellerBId}`,
      },
      {
        id: photogBId,
        name: `Fotografo B ${suffix}`,
        cpf: `9206${suffix}`,
        email: `fb_${suffix}@test.local`,
        password,
        role: 'PHOTOGRAPHER',
        companyId: compB.id,
        active: true,
        activeSessionId: `sess-${photogBId}`,
      },
    ],
  });
  createdUserIds.push(adminAId, seller1Id, seller2Id, photogAId, adminBId, sellerBId, photogBId);

  const adminAToken = makeToken({
    id: adminAId,
    role: 'ADMIN',
    companyId: compA.id,
    name: `Admin E20 A ${suffix}`,
  });
  const adminBToken = makeToken({
    id: adminBId,
    role: 'ADMIN',
    companyId: compB.id,
    name: `Admin E20 B ${suffix}`,
  });

  const batchA = await prisma.bookBatch.create({
    data: {
      name: `Lote E20 A ${suffix}`,
      city: 'Curitiba',
      photographerId: photogAId,
      companyId: compA.id,
      status: 'DISTRIBUTED',
      totalProduced: 3,
    },
  });
  const batchB = await prisma.bookBatch.create({
    data: {
      name: `Lote E20 B ${suffix}`,
      city: 'Maringá',
      photographerId: photogBId,
      companyId: compB.id,
      status: 'DISTRIBUTED',
      totalProduced: 1,
    },
  });
  createdBatchIds.push(batchA.id, batchB.id);

  const cA1 = await prisma.client.create({
    data: {
      name: `Cliente A1 ${suffix}`,
      phone1: '41999991111',
      mainContact: 'Contato Ana',
      city: 'Curitiba',
      event: 'Evento Primavera',
      companyId: compA.id,
      batchId: batchA.id,
      photographerId: photogAId,
      assignedSellerId: seller1Id,
      bookStatus: 'SOLD',
      outcomeStatus: 'SOLD',
      sequenceNumber: `E20-1-${suffix}`,
    },
  });
  const cA2 = await prisma.client.create({
    data: {
      name: `Cliente A2 ${suffix}`,
      phone1: '41999992222',
      mainContact: 'Contato Ana',
      city: 'Curitiba',
      event: 'Evento Primavera',
      companyId: compA.id,
      batchId: batchA.id,
      photographerId: photogAId,
      assignedSellerId: seller1Id,
      bookStatus: 'SOLD',
      outcomeStatus: 'SOLD',
      sequenceNumber: `E20-2-${suffix}`,
    },
  });
  const cA3 = await prisma.client.create({
    data: {
      name: `Cliente A3 ${suffix}`,
      phone1: '41999993333',
      mainContact: 'Contato Bia',
      city: 'Curitiba',
      event: 'Evento Primavera',
      companyId: compA.id,
      batchId: batchA.id,
      photographerId: photogAId,
      assignedSellerId: seller2Id,
      bookStatus: 'SOLD',
      outcomeStatus: 'SOLD',
      sequenceNumber: `E20-3-${suffix}`,
    },
  });
  const cB1 = await prisma.client.create({
    data: {
      name: `Cliente B1 ${suffix}`,
      phone1: '44999994444',
      mainContact: 'Contato Tenant B',
      city: 'Maringá',
      event: 'Evento B',
      companyId: compB.id,
      batchId: batchB.id,
      photographerId: photogBId,
      assignedSellerId: sellerBId,
      bookStatus: 'SOLD',
      outcomeStatus: 'SOLD',
      sequenceNumber: `E20-B-${suffix}`,
    },
  });
  createdClientIds.push(cA1.id, cA2.id, cA3.id, cB1.id);

  const sA1 = await prisma.sale.create({
    data: {
      clientId: cA1.id,
      sellerId: seller1Id,
      companyId: compA.id,
      value: 1000,
      city: 'Curitiba',
      paymentMethod: 'CASH',
      receiptUrl: `/uploads/e20-1-${suffix}.jpg`,
      fichaNumber: `F-E20-1-${suffix}`,
    },
  });
  const sA2 = await prisma.sale.create({
    data: {
      clientId: cA2.id,
      sellerId: seller1Id,
      companyId: compA.id,
      value: 800,
      city: 'Curitiba',
      paymentMethod: 'CREDIT',
      receiptUrl: `/uploads/e20-2-${suffix}.jpg`,
      fichaNumber: `F-E20-2-${suffix}`,
    },
  });
  const sA3 = await prisma.sale.create({
    data: {
      clientId: cA3.id,
      sellerId: seller2Id,
      companyId: compA.id,
      value: 600,
      city: 'Curitiba',
      paymentMethod: 'SPLIT',
      receiptUrl: `/uploads/e20-3-${suffix}.jpg`,
      fichaNumber: `F-E20-3-${suffix}`,
    },
  });
  const sB1 = await prisma.sale.create({
    data: {
      clientId: cB1.id,
      sellerId: sellerBId,
      companyId: compB.id,
      value: 900,
      city: 'Maringá',
      paymentMethod: 'PIX',
      receiptUrl: `/uploads/e20-b-${suffix}.jpg`,
      fichaNumber: `F-E20-B-${suffix}`,
    },
  });
  createdSaleIds.push(sA1.id, sA2.id, sA3.id, sB1.id);

  await t.test('1) Fluxo QR coleta Vendedor, Contato e Fotógrafo (1-5 estrelas) e traduz termos técnicos para PT-BR', async () => {
    const link1 = await issueBuyerConfirmationLink({ saleId: sA1.id, companyId: compA.id });
    const link2 = await issueBuyerConfirmationLink({ saleId: sA2.id, companyId: compA.id });
    const link3 = await issueBuyerConfirmationLink({ saleId: sA3.id, companyId: compA.id });
    const linkB = await issueBuyerConfirmationLink({ saleId: sB1.id, companyId: compB.id });

    // Verifica HTML público com os 3 blocos de estrelas e nomes vinculados
    const htmlRes = await fetch(`${baseUrl}/confirmar-compra/${link1.rawToken}`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.ok(html.includes('id="serviceRating"'));
    assert.ok(html.includes('id="contactRating"'));
    assert.ok(html.includes('id="photographerRating"'));
    assert.ok(html.includes('Contato Ana'));
    assert.ok(html.includes(`Fotografo Carlos ${suffix}`));

    // Rejeita nota fora da faixa 1..5
    const badRating = await apiJson(baseUrl, `/confirmar-compra/${link1.rawToken}`, {
      method: 'POST',
      body: {
        phoneLast4: '1111',
        reportedTotalValue: 1000,
        reportedPaidValue: 1000,
        reportedPaymentMethod: 'CASH',
        serviceRating: 5,
        contactRating: 6,
        photographerRating: 4,
      },
    });
    assert.equal(badRating.status, 400);

    // Envia Venda 1 com DIVERGÊNCIA (vendedor CASH 1000 vs comprador CREDIT 1200) + notas V=5, C=5, F=5
    const confirm1 = await apiJson(baseUrl, `/confirmar-compra/${link1.rawToken}`, {
      method: 'POST',
      body: {
        phoneLast4: '1111',
        reportedTotalValue: 1200,
        reportedPaidValue: 200,
        reportedPaymentMethod: 'CREDIT',
        serviceRating: 5,
        contactRating: 5,
        photographerRating: 5,
      },
    });
    assert.equal(confirm1.status, 200);
    assert.equal(confirm1.json?.serviceRating, 5);
    assert.equal(confirm1.json?.contactRating, 5);
    assert.equal(confirm1.json?.photographerRating, 5);
    assert.equal(confirm1.json?.receipt?.reportedPaymentMethodLabel, 'Cartão de Crédito');

    // Envia Venda 2 coincidente: V=3, C=4, F=4
    const confirm2 = await apiJson(baseUrl, `/confirmar-compra/${link2.rawToken}`, {
      method: 'POST',
      body: {
        phoneLast4: '2222',
        reportedTotalValue: 800,
        reportedPaidValue: 800,
        reportedPaymentMethod: 'CREDIT',
        serviceRating: 3,
        contactRating: 4,
        photographerRating: 4,
      },
    });
    assert.equal(confirm2.status, 200);

    // Envia Venda 3 coincidente: Vendedor Dois=4, Contato Bia=2, Fotografo Carlos=3
    const confirm3 = await apiJson(baseUrl, `/confirmar-compra/${link3.rawToken}`, {
      method: 'POST',
      body: {
        phoneLast4: '3333',
        reportedTotalValue: 600,
        reportedPaidValue: 600,
        reportedPaymentMethod: 'SPLIT',
        serviceRating: 4,
        contactRating: 2,
        photographerRating: 3,
      },
    });
    assert.equal(confirm3.status, 200);
    assert.equal(confirm3.json?.receipt?.reportedPaymentMethodLabel, 'Pagamento Misto');

    // Envia Empresa B (nota 1 para tudo — não pode vazar na Empresa A)
    const confirmB = await apiJson(baseUrl, `/confirmar-compra/${linkB.rawToken}`, {
      method: 'POST',
      body: {
        phoneLast4: '4444',
        reportedTotalValue: 900,
        reportedPaidValue: 900,
        reportedPaymentMethod: 'PIX',
        serviceRating: 1,
        contactRating: 1,
        photographerRating: 1,
      },
    });
    assert.equal(confirmB.status, 200);

    // Conferência Admin: verifica traduções limpas e ausência de códigos técnicos crus em inglês nos rótulos/resumo
    const reviewRes = await apiJson(
      baseUrl,
      '/api/sales/buyer-confirmations/review?groupBy=seller',
      { token: adminAToken }
    );
    assert.equal(reviewRes.status, 200);
    assert.equal(reviewRes.json?.summary?.averageRating, 4); // (5+3+4)/3 = 4.0
    assert.equal(reviewRes.json?.summary?.contactAverageRating, 3.7); // (5+4+2)/3 = 3.666 -> 3.7
    assert.equal(reviewRes.json?.summary?.photographerAverageRating, 4); // (5+4+3)/3 = 4.0

    const allItems = (reviewRes.json?.groups || []).flatMap((g: any) => g.confirmations || []);
    const divItem = allItems.find((i: any) => i.saleId === sA1.id);
    assert.ok(divItem);
    assert.equal(divItem.sellerDeclared?.paymentMethodLabel, 'Dinheiro');
    assert.equal(divItem.buyerReported?.paymentMethodLabel, 'Cartão de Crédito');
    assert.ok(divItem.divergenceReasonLabels.includes('Divergência no valor total'));
    assert.ok(divItem.divergenceReasonLabels.includes('Divergência no valor pago no ato'));

    const summaryStr = String(divItem.divergenceSummary || '');
    assert.ok(summaryStr.includes('Dinheiro'));
    assert.ok(summaryStr.includes('Cartão de Crédito'));
    assert.ok(summaryStr.includes('Divergência no valor total'));
    assert.ok(summaryStr.includes('Divergência no valor pago no ato'));
    for (const forbiddenRawCode of [
      'TOTAL_MISMATCH',
      'PAID_MISMATCH',
      'PAYMENT_METHOD_MISMATCH',
      'CASH',
      'CREDIT',
      'DEBIT',
      'SPLIT',
      'CREDIT_AGREEMENT',
    ]) {
      assert.equal(
        new RegExp(`\\b${forbiddenRawCode}\\b`).test(summaryStr),
        false,
        `Resumo formatado não pode conter código cru em inglês: ${forbiddenRawCode} em "${summaryStr}"`
      );
    }
  });

  await t.test('2) Endpoint /api/stats/books calcula médias reais por profissional com isolamento multi-tenant', async () => {
    const statsARes = await apiJson(baseUrl, '/api/stats/books', { token: adminAToken });
    assert.equal(statsARes.status, 200);

    const avA = statsARes.json?.avaliacoesEquipe;
    assert.ok(avA);
    assert.equal(avA.resumoGeral.vendedor.media, 4);
    assert.equal(avA.resumoGeral.vendedor.totalAvaliacoes, 3);
    assert.equal(avA.resumoGeral.contato.media, 3.7);
    assert.equal(avA.resumoGeral.contato.totalAvaliacoes, 3);
    assert.equal(avA.resumoGeral.fotografo.media, 4);
    assert.equal(avA.resumoGeral.fotografo.totalAvaliacoes, 3);

    const v1Stats = (avA.porVendedor || []).find((v: any) => v.sellerId === seller1Id);
    const v2Stats = (avA.porVendedor || []).find((v: any) => v.sellerId === seller2Id);
    assert.equal(v1Stats?.media, 4); // (5+3)/2 = 4.0
    assert.equal(v1Stats?.totalAvaliacoes, 2);
    assert.equal(v2Stats?.media, 4);
    assert.equal(v2Stats?.totalAvaliacoes, 1);

    const anaStats = (avA.porContato || []).find((c: any) => c.name === 'Contato Ana');
    const biaStats = (avA.porContato || []).find((c: any) => c.name === 'Contato Bia');
    assert.equal(anaStats?.media, 4.5); // (5+4)/2 = 4.5
    assert.equal(anaStats?.totalAvaliacoes, 2);
    assert.equal(biaStats?.media, 2);
    assert.equal(biaStats?.totalAvaliacoes, 1);

    const fotogStats = (avA.porFotografo || []).find((f: any) => f.photographerId === photogAId);
    assert.equal(fotogStats?.media, 4); // (5+4+3)/3 = 4.0
    assert.equal(fotogStats?.totalAvaliacoes, 3);

    // Verifica formasPagamento com methodLabel em PT-BR
    const labelsPt = (statsARes.json?.formasPagamento || []).map((f: any) => f.methodLabel);
    assert.ok(labelsPt.includes('Dinheiro'));
    assert.ok(labelsPt.includes('Cartão de Crédito'));
    assert.ok(labelsPt.includes('Pagamento Misto'));

    // Multi-tenant estrito: Empresa B vê APENAS sua nota 1 e nenhum dado da Empresa A
    assert.equal((avA.porVendedor || []).some((v: any) => v.sellerId === sellerBId), false);
    const statsBRes = await apiJson(baseUrl, '/api/stats/books', { token: adminBToken });
    assert.equal(statsBRes.status, 200);
    const avB = statsBRes.json?.avaliacoesEquipe;
    assert.equal(avB.resumoGeral.vendedor.media, 1);
    assert.equal(avB.resumoGeral.vendedor.totalAvaliacoes, 1);
    assert.equal(avB.resumoGeral.contato.media, 1);
    assert.equal(avB.resumoGeral.fotografo.media, 1);
    assert.equal((avB.porVendedor || []).some((v: any) => v.sellerId === seller1Id), false);
  });
});
