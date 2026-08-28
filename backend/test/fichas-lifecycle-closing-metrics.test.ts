import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const envPath = path.resolve(__dirname, '../.env.test.local');
const envConfig = dotenv.parse(fs.readFileSync(envPath));
const databaseUrl = envConfig.DATABASE_URL;
const jwtSecret = envConfig.JWT_SECRET || 'test_secret_for_lifecycle_metrics';

process.env.DATABASE_URL = databaseUrl;
process.env.JWT_SECRET = jwtSecret;
process.env.EXTERNAL_SERVICES_DISABLED = 'true';

import clientRoutes from '../src/routes/clients';
import salesRoutes from '../src/routes/sales';
import closingRoutes from '../src/routes/closing';
import booksRoutes from '../src/routes/books';

const prisma = new PrismaClient();

function generateToken(payload: { id: string; role: string; companyId: string; name?: string }) {
  return jwt.sign(payload, jwtSecret, { expiresIn: '1h' });
}

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/clients', clientRoutes);
  app.use('/api/sales', salesRoutes);
  app.use('/api/closing', closingRoutes);
  app.use('/api/books', booksRoutes);
  return app;
}

describe('CICLO DE VIDA DE FICHAS, REBOLO, FECHAMENTO MULTI-CIDADES E MÉTRICAS (1.0.8+9)', { concurrency: 1 }, () => {
  const app = createTestApp();
  let server: any;
  let baseUrl: string;

  const uid = 'flc_' + Date.now();
  const compA_Id = `comp_a_${uid}`;
  const compB_Id = `comp_b_${uid}`;

  let adminA_Id: string;
  let sellerA1_Id: string;
  let sellerA2_Id: string;
  let sellerB_Id: string;

  let tokenAdminA: string;
  let tokenSellerA1: string;
  let tokenSellerA2: string;
  let tokenSellerB: string;

  before(async () => {
    // 1. Criar empresas
    await prisma.company.createMany({
      data: [
        { id: compA_Id, name: `Empresa Lifecycle A ${uid}` },
        { id: compB_Id, name: `Empresa Lifecycle B ${uid}` },
      ],
    });

    // 2. Criar usuários
    adminA_Id = `admin_a_${uid}`;
    sellerA1_Id = `seller_a1_${uid}`;
    sellerA2_Id = `seller_a2_${uid}`;
    sellerB_Id = `seller_b_${uid}`;

    await prisma.user.createMany({
      data: [
        { id: adminA_Id, name: 'Admin A', password: 'hash', role: 'ADMIN', companyId: compA_Id },
        { id: sellerA1_Id, name: 'Vendedor A1', password: 'hash', role: 'SELLER', companyId: compA_Id },
        { id: sellerA2_Id, name: 'Vendedor A2', password: 'hash', role: 'SELLER', companyId: compA_Id },
        { id: sellerB_Id, name: 'Vendedor B', password: 'hash', role: 'SELLER', companyId: compB_Id },
      ],
    });

    tokenAdminA = generateToken({ id: adminA_Id, role: 'ADMIN', companyId: compA_Id });
    tokenSellerA1 = generateToken({ id: sellerA1_Id, role: 'SELLER', companyId: compA_Id });
    tokenSellerA2 = generateToken({ id: sellerA2_Id, role: 'SELLER', companyId: compA_Id });
    tokenSellerB = generateToken({ id: sellerB_Id, role: 'SELLER', companyId: compB_Id });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) await new Promise<void>((resolve) => server.close(resolve));
    await prisma.sellerCityClosing.deleteMany({ where: { companyId: { in: [compA_Id, compB_Id] } } });
    await prisma.nonSale.deleteMany({ where: { companyId: { in: [compA_Id, compB_Id] } } });
    await prisma.sale.deleteMany({ where: { companyId: { in: [compA_Id, compB_Id] } } });
    await prisma.client.deleteMany({ where: { companyId: { in: [compA_Id, compB_Id] } } });
    await prisma.user.deleteMany({ where: { companyId: { in: [compA_Id, compB_Id] } } });
    await prisma.company.deleteMany({ where: { id: { in: [compA_Id, compB_Id] } } });
    await prisma.$disconnect();
  });

  async function api(path: string, options: { method?: string; body?: any; token?: string } = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await res.text();
    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, body: data };
  }

  it('1. Venda normal com comprovante encerra em SOLD (outcomeStatus=SOLD, bookStatus=SOLD)', async () => {
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ_SOLD_${uid}`,
        name: 'Cliente Venda 1',
        city: 'Curitiba',
        bookStatus: 'DISTRIBUTED',
        outcomeStatus: 'PENDING',
        assignedSellerId: sellerA1_Id,
        companyId: compA_Id,
      },
    });

    const res = await api('/api/sales', {
      method: 'POST',
      token: tokenSellerA1,
      body: {
        clientId: client.id,
        value: 1200,
        city: 'Curitiba',
        product: 'Álbum Luxo',
        paymentMethod: 'PIX',
      },
    });
    assert.equal(res.status, 201);
    const saleId = res.body.id;

    // Atualizar diretamente simulando comprovante persistido
    await prisma.sale.update({
      where: { id: saleId },
      data: { receiptUrl: 'https://storage.selectphoto.com/receipts/r1.jpg' },
    });
    await prisma.client.update({
      where: { id: client.id },
      data: { outcomeStatus: 'SOLD', bookStatus: 'SOLD' },
    });

    const updatedClient = await prisma.client.findUnique({ where: { id: client.id } });
    assert.equal(updatedClient?.outcomeStatus, 'SOLD');
    assert.equal(updatedClient?.bookStatus, 'SOLD');
  });

  it('2. Primeira não venda segue para devolução e IN_STOCK_REBOLO após receive-return pelo admin', async () => {
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ_REBOLO_1_${uid}`,
        name: 'Cliente Rebolo 1',
        city: 'Londrina',
        bookStatus: 'DISTRIBUTED',
        outcomeStatus: 'PENDING',
        assignedSellerId: sellerA1_Id,
        companyId: compA_Id,
      },
    });

    // Vendedor registra primeira não-venda
    const nonSaleRes = await api('/api/sales/non-sale', {
      method: 'POST',
      token: tokenSellerA1,
      body: {
        clientId: client.id,
        reason: 'Sem interesse no momento',
        signatureBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      },
    });
    assert.equal(nonSaleRes.status, 201);

    const clientAfterNonSale = await prisma.client.findUnique({ where: { id: client.id } });
    assert.equal(clientAfterNonSale?.outcomeStatus, 'NON_SALE');
    assert.equal(clientAfterNonSale?.bookStatus, 'AWAITING_RETURN');

    // Admin recebe devolução física
    const returnRes = await api('/api/books/receive-return', {
      method: 'POST',
      token: tokenAdminA,
      body: { sequenceNumber: client.sequenceNumber },
    });
    assert.equal(returnRes.status, 200);
    assert.equal(returnRes.body.bookStatus, 'IN_STOCK_REBOLO');
    assert.equal(returnRes.body.assignedSellerId, null);
  });

  it('3. Reatribuição do rebolo limpa ciclo anterior, usa DISTRIBUTED_REBOLO, outcomeStatus=PENDING e cityClosedAt=null', async () => {
    const client = await prisma.client.findFirst({ where: { sequenceNumber: `SEQ_REBOLO_1_${uid}` } });
    assert.ok(client);

    // Simular que a cidade anterior foi fechada
    await prisma.client.update({
      where: { id: client.id },
      data: { cityClosedAt: new Date() },
    });

    // Admin distribui ficha em lote (batch-assign) para outro vendedor (sellerA2)
    const assignRes = await api('/api/clients/batch-assign', {
      method: 'PATCH',
      token: tokenAdminA,
      body: {
        clientIds: [client.id],
        assignedSellerId: sellerA2_Id,
      },
    });
    assert.equal(assignRes.status, 200);

    const updatedClient = await prisma.client.findUnique({
      where: { id: client.id },
      include: { nonSales: true },
    });
    assert.equal(updatedClient?.bookStatus, 'DISTRIBUTED_REBOLO');
    assert.equal(updatedClient?.outcomeStatus, 'PENDING');
    assert.equal(updatedClient?.cityClosedAt, null);
    assert.equal(updatedClient?.assignedSellerId, sellerA2_Id);
    assert.equal(updatedClient?.nonSales.length, 1); // Histórico anterior preservado
  });

  it('4. Venda no rebolo termina em REBOLO_SOLD e outcomeStatus=SOLD', async () => {
    const client = await prisma.client.findFirst({ where: { sequenceNumber: `SEQ_REBOLO_1_${uid}` } });
    assert.ok(client);

    // Venda registrada no rebolo pelo sellerA2
    const sale = await prisma.sale.create({
      data: {
        clientId: client.id,
        sellerId: sellerA2_Id,
        companyId: compA_Id,
        value: 1500,
        city: 'Londrina',
        receiptUrl: 'https://storage.selectphoto.com/receipts/rebolo_receipt.jpg',
      },
    });

    // Atualização com regra de ciclo do rebolo
    const nextBookStatus =
      client.bookStatus === 'DISTRIBUTED_REBOLO' || client.bookStatus === 'IN_STOCK_REBOLO'
        ? 'REBOLO_SOLD'
        : 'SOLD';

    await prisma.client.update({
      where: { id: client.id },
      data: {
        outcomeStatus: 'SOLD',
        outcomeUpdatedAt: sale.date,
        bookStatus: nextBookStatus,
      },
    });

    const clientAfterSale = await prisma.client.findUnique({ where: { id: client.id } });
    assert.equal(clientAfterSale?.outcomeStatus, 'SOLD');
    assert.equal(clientAfterSale?.bookStatus, 'REBOLO_SOLD');
  });

  it('5. Segunda não venda, após devolução e receive-return, detecta 2 não vendas e termina em DISCARDED', async () => {
    // Criar ficha que já teve 1 não-venda no histórico e está no segundo ciclo (DISTRIBUTED_REBOLO)
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ_DISCARD_${uid}`,
        name: 'Cliente Descarte',
        city: 'Maringá',
        bookStatus: 'DISTRIBUTED_REBOLO',
        outcomeStatus: 'PENDING',
        assignedSellerId: sellerA2_Id,
        companyId: compA_Id,
      },
    });

    // Primeira não-venda antiga
    await prisma.nonSale.create({
      data: {
        clientId: client.id,
        sellerId: sellerA1_Id,
        companyId: compA_Id,
        reason: 'Não quis na 1ª visita',
        supersededAt: new Date(),
      },
    });

    // Segunda não-venda registrada pelo sellerA2
    const nonSaleRes = await api('/api/sales/non-sale', {
      method: 'POST',
      token: tokenSellerA2,
      body: {
        clientId: client.id,
        reason: 'Recusa definitiva',
        signatureBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      },
    });
    assert.equal(nonSaleRes.status, 201);

    const clientAwaiting = await prisma.client.findUnique({ where: { id: client.id } });
    assert.equal(clientAwaiting?.bookStatus, 'AWAITING_RETURN');

    // Admin recebe devolução da 2ª não-venda
    const returnRes = await api('/api/books/receive-return', {
      method: 'POST',
      token: tokenAdminA,
      body: { sequenceNumber: client.sequenceNumber },
    });
    assert.equal(returnRes.status, 200);
    assert.equal(returnRes.body.bookStatus, 'DISCARDED');
    assert.equal(returnRes.body.assignedSellerId, null);
  });

  it('6. Reenvio da mesma não venda não cria um segundo ciclo (Idempotência)', async () => {
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ_IDEMPOTENT_NS_${uid}`,
        name: 'Cliente Idempotente NS',
        city: 'Cascavel',
        bookStatus: 'DISTRIBUTED',
        outcomeStatus: 'PENDING',
        assignedSellerId: sellerA1_Id,
        companyId: compA_Id,
      },
    });

    // 1ª chamada
    const res1 = await api('/api/sales/non-sale', {
      method: 'POST',
      token: tokenSellerA1,
      body: {
        clientId: client.id,
        reason: 'Não quis',
        signatureBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      },
    });
    assert.equal(res1.status, 201);

    // 2ª chamada (toque duplo / retry com os mesmos dados)
    const res2 = await api('/api/sales/non-sale', {
      method: 'POST',
      token: tokenSellerA1,
      body: {
        clientId: client.id,
        reason: 'Não quis',
        signatureBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      },
    });
    assert.equal(res2.status, 200);
    assert.equal(res2.body.id, res1.body.id);

    const nonSales = await prisma.nonSale.findMany({ where: { clientId: client.id } });
    assert.equal(nonSales.length, 1); // Exatamente 1 registro criado
  });

  it('7. Fechamento ignora duplicata antiga sem comprovante quando existe venda válida', async () => {
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ_LEGACY_IGN_${uid}`,
        name: 'Cliente Legado Ignorado',
        city: 'Ponta Grossa',
        bookStatus: 'DISTRIBUTED',
        outcomeStatus: 'SOLD',
        assignedSellerId: sellerA1_Id,
        companyId: compA_Id,
      },
    });

    // Venda 1: Antiga sem comprovante (legado)
    await prisma.sale.create({
      data: {
        clientId: client.id,
        sellerId: sellerA1_Id,
        companyId: compA_Id,
        value: 800,
        city: 'Ponta Grossa',
        receiptUrl: null,
      },
    });

    // Venda 2: Válida com comprovante
    await prisma.sale.create({
      data: {
        clientId: client.id,
        sellerId: sellerA1_Id,
        companyId: compA_Id,
        value: 1000,
        city: 'Ponta Grossa',
        receiptUrl: 'https://storage.selectphoto.com/receipts/valid_ponta_grossa.jpg',
      },
    });

    const preview = await api('/api/closing/city/preview?city=Ponta Grossa', {
      token: tokenSellerA1,
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.totalClients, 1);
    assert.equal(preview.body.totalCount, 1);
    assert.equal(preview.body.pendingReceiptsCount, 0); // Venda válida sobrepõe legado
    assert.equal(preview.body.ignoredLegacyCount, 1);
    assert.equal(preview.body.canClose, true);

    const closeRes = await api('/api/closing/city', {
      method: 'POST',
      token: tokenSellerA1,
      body: { city: 'Ponta Grossa' },
    });
    assert.equal(closeRes.status, 201);
  });

  it('8. Fechamento bloqueia uma venda incompleta atual e retorna dados da ficha pendente', async () => {
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ_BLOCK_INC_${uid}`,
        name: 'Cliente Incompleto Bloqueante',
        city: 'Foz do Iguaçu',
        bookStatus: 'DISTRIBUTED',
        outcomeStatus: 'PENDING',
        assignedSellerId: sellerA1_Id,
        companyId: compA_Id,
      },
    });

    // Venda incompleta (sem comprovante e sem nenhuma venda válida)
    await prisma.sale.create({
      data: {
        clientId: client.id,
        sellerId: sellerA1_Id,
        companyId: compA_Id,
        value: 750,
        city: 'Foz do Iguaçu',
        receiptUrl: null,
      },
    });

    const preview = await api('/api/closing/city/preview?city=Foz do Iguaçu', {
      token: tokenSellerA1,
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.canClose, false);
    assert.equal(preview.body.pendingReceiptsCount, 1);
    assert.equal(preview.body.pendingClients.length, 1);
    assert.equal(preview.body.pendingClients[0].id, client.id);
    assert.equal(preview.body.pendingClients[0].sequenceNumber, `SEQ_BLOCK_INC_${uid}`);

    // Tentativa de fechar deve retornar 409
    const closeRes = await api('/api/closing/city', {
      method: 'POST',
      token: tokenSellerA1,
      body: { city: 'Foz do Iguaçu' },
    });
    assert.equal(closeRes.status, 409);
  });

  it('9. Fechamento de várias cidades funciona na mesma operação transacional (POST /closing/cities)', async () => {
    // Cidade 1: Toledo (vendida)
    const cToledo = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ_TOLEDO_${uid}`,
        name: 'Cliente Toledo',
        city: 'Toledo',
        bookStatus: 'DISTRIBUTED',
        outcomeStatus: 'SOLD',
        assignedSellerId: sellerA1_Id,
        companyId: compA_Id,
      },
    });
    await prisma.sale.create({
      data: {
        clientId: cToledo.id,
        sellerId: sellerA1_Id,
        companyId: compA_Id,
        value: 1100,
        city: 'Toledo',
        receiptUrl: 'https://storage.selectphoto.com/receipts/toledo.jpg',
      },
    });

    // Cidade 2: Umuarama (não-venda)
    await prisma.client.create({
      data: {
        sequenceNumber: `SEQ_UMUARAMA_${uid}`,
        name: 'Cliente Umuarama',
        city: 'Umuarama',
        bookStatus: 'AWAITING_RETURN',
        outcomeStatus: 'NON_SALE',
        assignedSellerId: sellerA1_Id,
        companyId: compA_Id,
      },
    });

    // Prévia multi-cidades
    const multiPreview = await api('/api/closing/cities/preview', {
      token: tokenSellerA1,
    });
    assert.equal(multiPreview.status, 200);
    const toledoPrev = multiPreview.body.find((p: any) => p.city === 'Toledo');
    const umuaramaPrev = multiPreview.body.find((p: any) => p.city === 'Umuarama');
    assert.ok(toledoPrev && toledoPrev.canClose);
    assert.ok(umuaramaPrev && umuaramaPrev.canClose);

    // Fechar ambas simultaneamente
    const multiClose = await api('/api/closing/cities', {
      method: 'POST',
      token: tokenSellerA1,
      body: { cities: ['Toledo', 'Umuarama'] },
    });
    assert.equal(multiClose.status, 201);
    assert.equal(multiClose.body.count, 2);

    const clientToledoAfter = await prisma.client.findUnique({ where: { id: cToledo.id } });
    assert.ok(clientToledoAfter?.cityClosedAt !== null);
  });

  it('10. Métricas por vendedor, período (UTC) e cidade apresentam valores corretos e ticket médio exato', async () => {
    const baseDate = new Date('2026-08-28T14:00:00.000Z');

    // 2 vendas de 1000 cada e 1 não-venda
    const client1 = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ_METRIC_1_${uid}`,
        name: 'Cliente M1',
        city: 'Apucarana',
        bookStatus: 'SOLD',
        outcomeStatus: 'SOLD',
        assignedSellerId: sellerA1_Id,
        companyId: compA_Id,
      },
    });
    await prisma.sale.create({
      data: {
        clientId: client1.id,
        sellerId: sellerA1_Id,
        companyId: compA_Id,
        value: 1000,
        city: 'Apucarana',
        receiptUrl: 'https://storage.selectphoto.com/receipts/m1.jpg',
        date: baseDate,
      },
    });

    const client2 = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ_METRIC_2_${uid}`,
        name: 'Cliente M2',
        city: 'Apucarana',
        bookStatus: 'SOLD',
        outcomeStatus: 'SOLD',
        assignedSellerId: sellerA1_Id,
        companyId: compA_Id,
      },
    });
    await prisma.sale.create({
      data: {
        clientId: client2.id,
        sellerId: sellerA1_Id,
        companyId: compA_Id,
        value: 1000,
        city: 'Apucarana',
        receiptUrl: 'https://storage.selectphoto.com/receipts/m2.jpg',
        date: baseDate,
      },
    });

    const client3 = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ_METRIC_3_${uid}`,
        name: 'Cliente M3',
        city: 'Apucarana',
        bookStatus: 'AWAITING_RETURN',
        outcomeStatus: 'NON_SALE',
        assignedSellerId: sellerA1_Id,
        companyId: compA_Id,
      },
    });
    await prisma.nonSale.create({
      data: {
        clientId: client3.id,
        sellerId: sellerA1_Id,
        companyId: compA_Id,
        reason: 'Recusa teste',
        date: baseDate,
      },
    });

    const startIso = '2026-08-28T00:00:00.000Z';
    const endIso = '2026-08-28T23:59:59.999Z';

    const metricsRes = await api(
      `/api/closing/custom?sellerIds=${sellerA1_Id}&startDate=${startIso}&endDate=${endIso}&city=Apucarana`,
      { token: tokenAdminA }
    );
    assert.equal(metricsRes.status, 200);
    assert.equal(metricsRes.body.salesCount, 2);
    assert.equal(metricsRes.body.nonSalesCount, 1);
    assert.equal(metricsRes.body.totalFichas, 3);
    assert.equal(metricsRes.body.totalSalesValue, 2000);
    // Ticket médio = totalSalesValue / salesCount (2000 / 2 = 1000, e NÃO 2000 / 3)
    assert.equal(metricsRes.body.averageTicket, 1000);
    assert.equal(metricsRes.body.uniqueClientsCount, 3);
  });

  it('11. Isolamento completo entre empresas', async () => {
    // Vendedor B tenta acessar ou fechar cidade da Empresa A
    const previewRes = await api('/api/closing/city/preview?city=Apucarana', {
      token: tokenSellerB,
    });
    assert.equal(previewRes.status, 200);
    assert.equal(previewRes.body.totalClients, 0); // Vendedor B não enxerga dados da empresa A

    const closeRes = await api('/api/closing/city', {
      method: 'POST',
      token: tokenSellerB,
      body: { city: 'Apucarana' },
    });
    assert.equal(closeRes.status, 404); // Bloqueado com 404 por não possuir fichas nessa cidade
  });
});
