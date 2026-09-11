import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

const envPath = path.resolve(__dirname, '../.env.test.local');
const envConfig = dotenv.parse(fs.readFileSync(envPath));
process.env.DATABASE_URL = envConfig.DATABASE_URL;
process.env.JWT_SECRET = envConfig.JWT_SECRET || 'test_jwt_secret_key_fixed_for_ci_123456';
process.env.EXTERNAL_SERVICES_DISABLED = 'true';

import { PrismaClient } from '@prisma/client';
import clientRoutes from '../src/routes/clients';
import booksRoutes from '../src/routes/books';
import closingRoutes from '../src/routes/closing';
import editRequestsRoutes from '../src/routes/editRequests';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET!;

describe('ISOLAMENTO DE ACESSO DO FOTÓGRAFO E FECHAMENTO DE CIDADE', { concurrency: 1 }, () => {
  let app: express.Application;
  let server: any;
  let baseUrl: string;

  const compId = `comp-iso-${uuidv4().substring(0, 8)}`;
  const adminId = `admin-iso-${uuidv4().substring(0, 8)}`;
  const photogId = `photog-iso-${uuidv4().substring(0, 8)}`;
  const sellerId = `seller-iso-${uuidv4().substring(0, 8)}`;
  const sellerReboloId = `seller2-iso-${uuidv4().substring(0, 8)}`;

  const tokenAdmin = jwt.sign({ id: adminId, companyId: compId, role: 'ADMIN' }, JWT_SECRET);
  const tokenPhotog = jwt.sign({ id: photogId, companyId: compId, role: 'PHOTOGRAPHER' }, JWT_SECRET);
  const tokenSeller = jwt.sign({ id: sellerId, companyId: compId, role: 'SELLER' }, JWT_SECRET);

  const cityName = `CidadeIso_${uuidv4().substring(0, 6)}`;
  let clientOpenId: string;
  let clientClosedId: string;

  before(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/clients', clientRoutes);
    app.use('/api/books', booksRoutes);
    app.use('/api/closing', closingRoutes);
    app.use('/api/edit-requests', editRequestsRoutes);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const port = (server.address() as any).port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Criar Company e Users
    await prisma.company.create({
      data: { id: compId, name: 'Empresa Teste Isolamento' }
    });

    await prisma.user.createMany({
      data: [
        { id: adminId, name: 'Admin Teste', email: `admin_${uuidv4().substring(0,6)}@test.com`, password: 'hash', role: 'ADMIN', companyId: compId },
        { id: photogId, name: 'Fotógrafo Teste', email: `photog_${uuidv4().substring(0,6)}@test.com`, password: 'hash', role: 'PHOTOGRAPHER', companyId: compId },
        { id: sellerId, name: 'Vendedor Teste', email: `seller_${uuidv4().substring(0,6)}@test.com`, password: 'hash', role: 'SELLER', companyId: compId },
        { id: sellerReboloId, name: 'Vendedor Rebolo', email: `rebolo_${uuidv4().substring(0,6)}@test.com`, password: 'hash', role: 'SELLER', companyId: compId },
      ]
    });

    // Criar Ficha 1: Ativa em produção (em cidade diferente)
    const c1 = await prisma.client.create({
      data: {
        uuid: uuidv4(),
        visibleCode: 'F-TEST001',
        sequenceNumber: '001',
        name: 'Cliente Aberto Producao',
        city: 'CidadeAberta',
        state: 'DF',
        companyId: compId,
        photographerId: photogId,
        bookStatus: 'CREATED',
        outcomeStatus: 'PENDING',
      }
    });
    clientOpenId = c1.id;

    // Criar Ficha 2: Na cidade que será fechada
    const c2 = await prisma.client.create({
      data: {
        uuid: uuidv4(),
        visibleCode: 'F-TEST002',
        sequenceNumber: '002',
        name: 'Cliente Para Fechamento',
        city: cityName,
        state: 'GO',
        companyId: compId,
        photographerId: photogId,
        assignedSellerId: sellerId,
        bookStatus: 'SOLD',
        outcomeStatus: 'SOLD',
      }
    });
    clientClosedId = c2.id;

    // Criar Venda com comprovante para permitir fechamento
    await prisma.sale.create({
      data: {
        clientId: clientClosedId,
        sellerId: sellerId,
        companyId: compId,
        city: cityName,
        value: 500,
        receiptUrl: 'https://comprovantes.test/c2.jpg',
      }
    });
  });

  after(async () => {
    if (server) await new Promise<void>((resolve) => server.close(resolve));
    await prisma.sale.deleteMany({ where: { companyId: compId } }).catch(() => {});
    await prisma.clientTimeline.deleteMany({ where: { client: { companyId: compId } } }).catch(() => {});
    await prisma.clientEditRequest.deleteMany({ where: { companyId: compId } }).catch(() => {});
    await prisma.sellerCityClosing.deleteMany({ where: { companyId: compId } }).catch(() => {});
    await prisma.client.deleteMany({ where: { companyId: compId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { companyId: compId } }).catch(() => {});
    await prisma.company.deleteMany({ where: { id: compId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('1. GET /api/clients/photographer retorna apenas fichas próprias e sem dados comerciais', async () => {
    const res = await fetch(`${baseUrl}/api/clients/photographer`, {
      headers: { Authorization: `Bearer ${tokenPhotog}` },
    });
    assert.equal(res.status, 200);
    const clients = await res.json() as any[];

    // Deve conter apenas a ficha em produção (CREATED)
    assert.ok(clients.some(c => c.id === clientOpenId), 'Ficha em produção deve estar presente');
    assert.ok(!clients.some(c => c.id === clientClosedId), 'Ficha vendida/entregue NÃO deve estar presente para o fotógrafo');

    for (const c of clients) {
      // Regra estrita: Nenhum dado comercial transmitido ao fotógrafo
      assert.equal(c.sales, undefined, 'sales não deve ser transmitido');
      assert.equal(c.nonSales, undefined, 'nonSales não deve ser transmitido');
      assert.equal(c.outcomeStatus, undefined, 'outcomeStatus não deve ser transmitido');
      assert.equal(c.assignedSellerId, undefined, 'assignedSellerId não deve ser transmitido');
      assert.equal(c.assignedSeller, undefined, 'assignedSeller não deve ser transmitido');
      assert.equal(c.bookStatus, 'CREATED', 'Fotógrafo enxerga estritamente fichas em produção CREATED');
    }
  });

  it('2. Fechamento da cidade deve marcar cityClosedAt e photographerClosedAt', async () => {
    const resClosing = await fetch(`${baseUrl}/api/closing/city`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenSeller}`,
      },
      body: JSON.stringify({ city: cityName }),
    });
    assert.equal(resClosing.status, 201, 'Fechamento da cidade deve ser concluído com sucesso');

    const updated = await prisma.client.findUnique({ where: { id: clientClosedId } });
    assert.ok(updated?.cityClosedAt !== null, 'cityClosedAt deve estar preenchido');
    assert.ok(updated?.photographerClosedAt !== null, 'photographerClosedAt deve estar preenchido');
  });

  it('3. Ficha fechada desaparece imediatamente da lista do fotógrafo mas permanece para Admin e Vendedor', async () => {
    // Consulta do Fotógrafo
    const resPhotog = await fetch(`${baseUrl}/api/clients/photographer`, {
      headers: { Authorization: `Bearer ${tokenPhotog}` },
    });
    assert.equal(resPhotog.status, 200);
    const photogClients = await resPhotog.json() as any[];

    assert.ok(photogClients.some(c => c.id === clientOpenId), 'Ficha aberta deve continuar visível');
    assert.ok(!photogClients.some(c => c.id === clientClosedId), 'Ficha de cidade fechada DEVE desaparecer do fotógrafo');

    // Consulta do Admin: preserva histórico integral
    const resAdmin = await fetch(`${baseUrl}/api/clients`, {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    assert.equal(resAdmin.status, 200);
    const adminClients = await resAdmin.json() as any[];
    assert.ok(adminClients.some(c => c.id === clientClosedId), 'Admin deve continuar com a ficha e histórico intactos');
  });

  it('4. Ficha fechada não é acessível pelo fotógrafo em busca, force-send ou solicitação de correção', async () => {
    // Busca
    const resSearch = await fetch(`${baseUrl}/api/books/search?q=TEST002`, {
      headers: { Authorization: `Bearer ${tokenPhotog}` },
    });
    assert.equal(resSearch.status, 200);
    const found = await resSearch.json() as any[];
    assert.equal(found.length, 0, 'Fotógrafo não deve encontrar ficha fechada na busca');

    // Force Send
    const resForce = await fetch(`${baseUrl}/api/books/client/${clientClosedId}/force-send`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${tokenPhotog}`,
      },
    });
    assert.equal(resForce.status, 403, 'Force send em ficha fechada deve ser rejeitado com 403');

    // Solicitar Correção
    const resEdit = await fetch(`${baseUrl}/api/edit-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenPhotog}`,
      },
      body: JSON.stringify({
        clientId: clientClosedId,
        proposedData: { phone1: '61999998888' },
        reason: 'Correção de telefone pós-fechamento',
      }),
    });
    assert.equal(resEdit.status, 403, 'Solicitação de correção em ficha fechada deve ser rejeitada com 403');
  });

  it('5. Redistribuição no rebolo NÃO devolve acesso da ficha fechada ao fotógrafo', async () => {
    // Simular que a ficha foi devolvida para o estoque de rebolo e reatribuída para Vendedor 2
    await prisma.client.update({
      where: { id: clientClosedId },
      data: {
        bookStatus: 'IN_STOCK_REBOLO',
      }
    });

    const resReassign = await fetch(`${baseUrl}/api/clients/batch-assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAdmin}`,
      },
      body: JSON.stringify({
        clientIds: [clientClosedId],
        assignedSellerId: sellerReboloId,
      }),
    });
    assert.equal(resReassign.status, 200);

    // Verificar se no fotógrafo a ficha CONTINUA inacessível
    const resPhotog = await fetch(`${baseUrl}/api/clients/photographer`, {
      headers: { Authorization: `Bearer ${tokenPhotog}` },
    });
    const photogClients = await resPhotog.json() as any[];
    assert.ok(!photogClients.some(c => c.id === clientClosedId), 'Rebolo NUNCA deve devolver acesso da ficha ao fotógrafo');
  });

  it('6. Linha do tempo da ficha fechada não é acessível ao fotógrafo', async () => {
    const resTimeline = await fetch(`${baseUrl}/api/clients/${clientClosedId}/timeline`, {
      headers: { Authorization: `Bearer ${tokenPhotog}` },
    });
    assert.equal(resTimeline.status, 403, 'Timeline de ficha fechada deve retornar 403 para o fotógrafo');
  });

  it('7. Fotógrafo não tem acesso a rotas gerais/comerciais (GET /clients, /by-city, /rebolos)', async () => {
    const resClients = await fetch(`${baseUrl}/api/clients`, {
      headers: { Authorization: `Bearer ${tokenPhotog}` },
    });
    assert.equal(resClients.status, 403, 'GET /api/clients deve retornar 403 para fotógrafo');

    const resCity = await fetch(`${baseUrl}/api/clients/by-city?city=${cityName}`, {
      headers: { Authorization: `Bearer ${tokenPhotog}` },
    });
    assert.equal(resCity.status, 403, 'GET /api/clients/by-city deve retornar 403 para fotógrafo');

    const resRebolo = await fetch(`${baseUrl}/api/clients/rebolos`, {
      headers: { Authorization: `Bearer ${tokenPhotog}` },
    });
    assert.equal(resRebolo.status, 403, 'GET /api/clients/rebolos deve retornar 403 para fotógrafo');
  });

  it('8. GET /api/clients/ficha/:identifier valida isolamento, sanitização e fechamento', async () => {
    // Ficha aberta própria do fotógrafo: 200, sanitizada sem dados comerciais
    const resOpen = await fetch(`${baseUrl}/api/clients/ficha/${clientOpenId}`, {
      headers: { Authorization: `Bearer ${tokenPhotog}` },
    });
    assert.equal(resOpen.status, 200);
    const openClient = await resOpen.json() as any;
    assert.equal(openClient.id, clientOpenId);
    assert.equal(openClient.sales, undefined);
    assert.equal(openClient.nonSales, undefined);
    assert.equal(openClient.assignedSeller, undefined);
    assert.equal(openClient.assignedSellerId, undefined);
    assert.equal(openClient.outcomeStatus, undefined);

    // Ficha fechada do fotógrafo: 403
    const resClosed = await fetch(`${baseUrl}/api/clients/ficha/${clientClosedId}`, {
      headers: { Authorization: `Bearer ${tokenPhotog}` },
    });
    assert.equal(resClosed.status, 403, 'Ficha fechada deve retornar 403 para fotógrafo');

    // Admin consultando ficha fechada: 200, acesso total e histórico preservado
    const resAdmin = await fetch(`${baseUrl}/api/clients/ficha/${clientClosedId}`, {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    assert.equal(resAdmin.status, 200);
    const adminFicha = await resAdmin.json() as any;
    assert.equal(adminFicha.id, clientClosedId);
    assert.ok(adminFicha.sales && adminFicha.sales.length > 0, 'Admin deve ver histórico comercial completo');
  });
});

