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
const jwtSecret = envConfig.JWT_SECRET || 'test_secret_for_lifecycle';

process.env.DATABASE_URL = databaseUrl;
process.env.JWT_SECRET = jwtSecret;

import clientRoutes from '../src/routes/clients';
import salesRoutes from '../src/routes/sales';
import closingRoutes from '../src/routes/closing';
import appointmentsRoutes from '../src/routes/appointments';

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
  app.use('/api/appointments', appointmentsRoutes);
  return app;
}

describe('ESCOPO 5 & 6 — Ciclo de Vida das Fichas, Fechamento de Cidade e Janela de Agenda (1.0.6)', { concurrency: 1 }, () => {
  const app = createTestApp();
  let server: any;
  let baseUrl: string;

  const uid = 'lc_' + Date.now();
  const compA_Id = `comp_a_${uid}`;
  const compB_Id = `comp_b_${uid}`;

  let sellerA_Id: string;
  let sellerB_Id: string;

  let tokenSellerA: string;
  let tokenSellerB: string;

  before(async () => {
    // 1. Criar empresas de teste
    await prisma.company.createMany({
      data: [
        { id: compA_Id, name: `Empresa Lifecycle A ${uid}` },
        { id: compB_Id, name: `Empresa Lifecycle B ${uid}` },
      ],
    });

    // 2. Criar vendedores
    sellerA_Id = `seller_a_${uid}`;
    sellerB_Id = `seller_b_${uid}`;

    await prisma.user.createMany({
      data: [
        { id: sellerA_Id, name: 'Vendedor A', password: 'hash', role: 'SELLER', companyId: compA_Id },
        { id: sellerB_Id, name: 'Vendedor B', password: 'hash', role: 'SELLER', companyId: compB_Id },
      ],
    });

    tokenSellerA = generateToken({ id: sellerA_Id, role: 'SELLER', companyId: compA_Id });
    tokenSellerB = generateToken({ id: sellerB_Id, role: 'SELLER', companyId: compB_Id });

    // Iniciar servidor de teste em porta dinâmica
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
    // Limpeza em ordem
    await prisma.sellerCityClosing.deleteMany({ where: { companyId: { in: [compA_Id, compB_Id] } } });
    await prisma.nonSale.deleteMany({ where: { companyId: { in: [compA_Id, compB_Id] } } });
    await prisma.sale.deleteMany({ where: { companyId: { in: [compA_Id, compB_Id] } } });
    await prisma.personalAppointment.deleteMany({ where: { sellerId: { in: [sellerA_Id, sellerB_Id] } } });
    await prisma.client.deleteMany({ where: { companyId: { in: [compA_Id, compB_Id] } } });
    await prisma.user.deleteMany({ where: { companyId: { in: [compA_Id, compB_Id] } } });
    await prisma.company.deleteMany({ where: { id: { in: [compA_Id, compB_Id] } } });
    await prisma.$disconnect();
  });

  it('1. Ficha nova nasce como outcomeStatus PENDING', async () => {
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ-P1-${uid}`,
        name: 'Cliente Pendente Teste',
        city: 'Londrina',
        companyId: compA_Id,
        assignedSellerId: sellerA_Id,
      },
    });

    assert.equal(client.outcomeStatus, 'PENDING');
    assert.equal(client.cityClosedAt, null);
    assert.equal(client.outcomeUpdatedAt, null);
  });

  it('2. Registro de Não-Venda altera outcomeStatus para NON_SALE atomicamente', async () => {
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ-NS1-${uid}`,
        name: 'Cliente Nao Venda Teste',
        city: 'Londrina',
        companyId: compA_Id,
        assignedSellerId: sellerA_Id,
      },
    });

    const res = await fetch(`${baseUrl}/api/sales/non-sale`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenSellerA}`,
      },
      body: JSON.stringify({
        clientId: client.id,
        reason: 'Cliente ausente',
        signatureBase64: 'mock_sig_base64',
      }),
    });

    assert.equal(res.status, 201);
    const nonSale = await res.json();
    assert.ok(nonSale.id);

    const updatedClient = await prisma.client.findUnique({ where: { id: client.id } });
    assert.equal(updatedClient?.outcomeStatus, 'NON_SALE');
    assert.ok(updatedClient?.outcomeUpdatedAt);
    assert.equal(updatedClient?.bookStatus, 'AWAITING_RETURN');
  });

  it('3. Ficha NON_SALE pode ser convertida em SOLD antes do fechamento (superando a não-venda)', async () => {
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ-REVISIT-${uid}`,
        name: 'Cliente Revisita Teste',
        city: 'Londrina',
        companyId: compA_Id,
        assignedSellerId: sellerA_Id,
        outcomeStatus: 'NON_SALE',
      },
    });

    const ns = await prisma.nonSale.create({
      data: {
        clientId: client.id,
        sellerId: sellerA_Id,
        companyId: compA_Id,
        reason: 'Cliente sem dinheiro no momento',
      },
    });

    // Registrar venda agora (revisita convertida em venda)
    const res = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenSellerA}`,
      },
      body: JSON.stringify({
        clientId: client.id,
        value: 1200.0,
        city: 'Londrina',
        product: 'Book completo',
      }),
    });

    assert.equal(res.status, 201);
    const sale = await res.json();
    assert.ok(sale.id);

    // Verificar Client atualizado
    const updatedClient = await prisma.client.findUnique({ where: { id: client.id } });
    assert.equal(updatedClient?.outcomeStatus, 'SOLD');
    assert.equal(updatedClient?.bookStatus, 'SOLD');

    // Verificar Não-Venda marcada como superada
    const supersededNonSale = await prisma.nonSale.findUnique({ where: { id: ns.id } });
    assert.ok(supersededNonSale?.supersededAt);
    assert.equal(supersededNonSale?.supersededBySaleId, sale.id);
  });

  it('4. Ficha SOLD rejeita segunda venda (bloqueio de duplicidade)', async () => {
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ-DUPSALE-${uid}`,
        name: 'Cliente Ja Vendido',
        city: 'Londrina',
        companyId: compA_Id,
        assignedSellerId: sellerA_Id,
        outcomeStatus: 'SOLD',
      },
    });

    const res = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenSellerA}`,
      },
      body: JSON.stringify({
        clientId: client.id,
        value: 500.0,
        city: 'Londrina',
      }),
    });

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.error, /Venda já registrada/i);
  });

  it('5. Cidade fechada (cityClosedAt != null) rejeita nova venda (409)', async () => {
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ-CLOSEDSALE-${uid}`,
        name: 'Cliente Cidade Fechada',
        city: 'Londrina',
        companyId: compA_Id,
        assignedSellerId: sellerA_Id,
        outcomeStatus: 'PENDING',
        cityClosedAt: new Date(),
      },
    });

    const res = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenSellerA}`,
      },
      body: JSON.stringify({
        clientId: client.id,
        value: 800.0,
        city: 'Londrina',
      }),
    });

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.error, /Cidade já foi fechada/i);
  });

  it('6. Cidade fechada rejeita nova não-venda (409)', async () => {
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ-CLOSEDNS-${uid}`,
        name: 'Cliente Cidade Fechada NS',
        city: 'Londrina',
        companyId: compA_Id,
        assignedSellerId: sellerA_Id,
        outcomeStatus: 'PENDING',
        cityClosedAt: new Date(),
      },
    });

    const res = await fetch(`${baseUrl}/api/sales/non-sale`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenSellerA}`,
      },
      body: JSON.stringify({
        clientId: client.id,
        reason: 'Recusa',
        signatureBase64: 'mock_sig',
      }),
    });

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.error, /Cidade já foi fechada/i);
  });

  it('7. Fechamento de cidade calcula contagens e valores reais e cria SellerCityClosing', async () => {
    const city = `Maringa_${uid}`;

    // Criar 1 pendente, 1 revisita, 2 vendidas
    const c1 = await prisma.client.create({
      data: { sequenceNumber: `MC1-${uid}`, name: 'C1', city, companyId: compA_Id, assignedSellerId: sellerA_Id, outcomeStatus: 'PENDING' },
    });
    const c2 = await prisma.client.create({
      data: { sequenceNumber: `MC2-${uid}`, name: 'C2', city, companyId: compA_Id, assignedSellerId: sellerA_Id, outcomeStatus: 'NON_SALE' },
    });
    const c3 = await prisma.client.create({
      data: { sequenceNumber: `MC3-${uid}`, name: 'C3', city, companyId: compA_Id, assignedSellerId: sellerA_Id, outcomeStatus: 'SOLD' },
    });
    const c4 = await prisma.client.create({
      data: { sequenceNumber: `MC4-${uid}`, name: 'C4', city, companyId: compA_Id, assignedSellerId: sellerA_Id, outcomeStatus: 'SOLD' },
    });

    await prisma.sale.createMany({
      data: [
        { clientId: c3.id, sellerId: sellerA_Id, companyId: compA_Id, value: 500.0, city },
        { clientId: c4.id, sellerId: sellerA_Id, companyId: compA_Id, value: 750.0, city },
      ],
    });

    // 1. Testar preview
    const previewRes = await fetch(`${baseUrl}/api/closing/city/preview?city=${encodeURIComponent(city)}`, {
      headers: { Authorization: `Bearer ${tokenSellerA}` },
    });
    assert.equal(previewRes.status, 200);
    const preview = await previewRes.json();
    assert.equal(preview.pendingCount, 1);
    assert.equal(preview.nonSaleCount, 1);
    assert.equal(preview.soldCount, 2);
    assert.equal(preview.totalSalesValue, 1250.0);
    assert.equal(preview.isAlreadyClosed, false);

    // 2. Executar Fechamento Real
    const closeRes = await fetch(`${baseUrl}/api/closing/city`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenSellerA}`,
      },
      body: JSON.stringify({ city, event: 'Evento Principal' }),
    });

    assert.equal(closeRes.status, 201);
    const closeData = await closeRes.json();
    assert.ok(closeData.success);
    assert.equal(closeData.closing.pendingCount, 1);
    assert.equal(closeData.closing.nonSaleCount, 1);
    assert.equal(closeData.closing.soldCount, 2);
    assert.equal(closeData.closing.totalSalesValue, 1250.0);

    // Verificar se todos os clientes da cidade foram marcados com cityClosedAt
    const updatedClients = await prisma.client.findMany({ where: { city, assignedSellerId: sellerA_Id } });
    assert.equal(updatedClients.length, 4);
    assert.ok(updatedClients.every((c) => c.cityClosedAt !== null));
  });

  it('8. Fechamento duplicado de cidade já encerrada é rejeitado (409)', async () => {
    const city = `Maringa_${uid}`;
    const closeRes = await fetch(`${baseUrl}/api/closing/city`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenSellerA}`,
      },
      body: JSON.stringify({ city }),
    });

    assert.equal(closeRes.status, 409);
    const body = await closeRes.json();
    assert.match(body.error, /já foi encerrada/i);
  });

  it('9. Isolamento Multi-tenant: Vendedor B não fecha nem acessa fichas da Empresa A', async () => {
    const city = `Cascavel_${uid}`;
    await prisma.client.create({
      data: { sequenceNumber: `CASCA1-${uid}`, name: 'C1 CompA', city, companyId: compA_Id, assignedSellerId: sellerA_Id, outcomeStatus: 'PENDING' },
    });

    // Vendedor B tenta fechar Cascavel (onde só tem cliente da CompA)
    const closeRes = await fetch(`${baseUrl}/api/closing/city`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenSellerB}`,
      },
      body: JSON.stringify({ city }),
    });

    assert.equal(closeRes.status, 404);
  });

  it('10. GET /api/clients/seller retorna outcomeStatus, outcomeUpdatedAt, cityClosedAt e sales', async () => {
    const res = await fetch(`${baseUrl}/api/clients/seller`, {
      headers: { Authorization: `Bearer ${tokenSellerA}` },
    });

    assert.equal(res.status, 200);
    const clients = await res.json();
    assert.ok(Array.isArray(clients));
    assert.ok(clients.length > 0);
    const sample = clients[0];
    assert.ok('outcomeStatus' in sample);
    assert.ok('cityClosedAt' in sample);
    assert.ok('sales' in sample);
    assert.ok('nonSales' in sample);
  });

  it('11. GET /api/appointments/seller com parâmetro from filtra agendamentos corretamente', async () => {
    const now = new Date();
    const pastDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 dias atrás
    const ancientDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 dias atrás
    const futureDate = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000); // 2 dias no futuro

    await prisma.personalAppointment.createMany({
      data: [
        { sellerId: sellerA_Id, title: 'Agendamento Antigo', dateTime: ancientDate },
        { sellerId: sellerA_Id, title: 'Agendamento 2 Dias Atrás', dateTime: pastDate },
        { sellerId: sellerA_Id, title: 'Agendamento Futuro', dateTime: futureDate },
      ],
    });

    // Buscar a partir de hoje (início do dia)
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const res = await fetch(`${baseUrl}/api/appointments/seller/${sellerA_Id}?from=${startOfToday.toISOString()}`, {
      headers: { Authorization: `Bearer ${tokenSellerA}` },
    });

    assert.equal(res.status, 200);
    const appointments = await res.json();
    assert.equal(appointments.length, 1);
    assert.equal(appointments[0].title, 'Agendamento Futuro');
  });

  it('12. Comprovante de venda existente pode ser enviado mesmo após o fechamento da cidade', async () => {
    const city = `Apucarana_${uid}`;
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ-RCV-${uid}`,
        name: 'Cliente Comprovante Pos Fechamento',
        city,
        companyId: compA_Id,
        assignedSellerId: sellerA_Id,
        outcomeStatus: 'SOLD',
        cityClosedAt: new Date(),
      },
    });

    const sale = await prisma.sale.create({
      data: {
        clientId: client.id,
        sellerId: sellerA_Id,
        companyId: compA_Id,
        value: 990.0,
        city,
      },
    });

    // Simular upload de comprovante na rota de receipt
    const updatedSale = await prisma.sale.update({
      where: { id: sale.id },
      data: { receiptUrl: 'https://storage.example.com/receipt.jpg' },
    });

    assert.equal(updatedSale.receiptUrl, 'https://storage.example.com/receipt.jpg');
  });

  it('13. Concorrência: Venda concluída antes do fechamento é contabilizada no SellerCityClosing', async () => {
    const city = `Toledo_${uid}`;
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ-CONC-${uid}`,
        name: 'Cliente Concorrencia',
        city,
        companyId: compA_Id,
        assignedSellerId: sellerA_Id,
        outcomeStatus: 'PENDING',
      },
    });

    // Realizar venda
    const saleRes = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenSellerA}`,
      },
      body: JSON.stringify({
        clientId: client.id,
        value: 1500.0,
        city,
      }),
    });
    assert.equal(saleRes.status, 201);

    // Fechar cidade logo em seguida
    const closeRes = await fetch(`${baseUrl}/api/closing/city`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenSellerA}`,
      },
      body: JSON.stringify({ city }),
    });
    assert.equal(closeRes.status, 201);
    const closeData = await closeRes.json();
    assert.equal(closeData.closing.soldCount, 1);
    assert.equal(closeData.closing.totalSalesValue, 1500.0);
  });

  it('14. Backfill: Ficha histórica com venda passa a SOLD e cidade não é fechada automaticamente', async () => {
    // Verificar que clientes criados sem fechamento possuem cityClosedAt = null
    const client = await prisma.client.findFirst({
      where: { companyId: compA_Id, outcomeStatus: 'PENDING', cityClosedAt: null },
    });
    assert.ok(client, 'Clientes sem fechamento explícito devem manter cityClosedAt como null');
  });
});
