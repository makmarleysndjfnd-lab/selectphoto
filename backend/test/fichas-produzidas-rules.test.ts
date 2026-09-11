import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

import clientsRouter from '../src/routes/clients';
import booksRouter from '../src/routes/books';
import editRequestsRouter from '../src/routes/editRequests';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key_fixed_for_ci_12345';

describe('REGRAS DA TELA FICHAS PRODUZIDAS & RESUMO GERENCIAL ADMIN', () => {
  let app: express.Express;
  let server: any;
  let baseUrl: string;

  const companyId = `comp_${uuidv4().substring(0, 8)}`;
  const photographerId = `photog_${uuidv4().substring(0, 8)}`;
  const otherPhotographerId = `photog_other_${uuidv4().substring(0, 8)}`;
  const adminId = `admin_${uuidv4().substring(0, 8)}`;

  let tokenPhotog: string;
  let tokenAdmin: string;

  let fichaCreated1Id: string;
  let fichaCreated2Id: string;
  let fichaAwaitingReleaseId: string;
  let fichaInStockId: string;
  let fichaSoldId: string;

  before(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/clients', clientsRouter);
    app.use('/api/books', booksRouter);
    app.use('/api/edit-requests', editRequestsRouter);

    server = app.listen(0);
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // Criar empresa e usuários
    await prisma.company.create({
      data: { id: companyId, name: 'Empresa Teste Producao' }
    });

    await prisma.user.createMany({
      data: [
        {
          id: photographerId,
          name: 'Fotografo Principal',
          email: `photog_${uuidv4().substring(0, 6)}@test.com`,
          password: 'hash',
          role: 'PHOTOGRAPHER',
          companyId
        },
        {
          id: otherPhotographerId,
          name: 'Fotografo Colega',
          email: `photog2_${uuidv4().substring(0, 6)}@test.com`,
          password: 'hash',
          role: 'PHOTOGRAPHER',
          companyId
        },
        {
          id: adminId,
          name: 'Administrador Geral',
          email: `admin_${uuidv4().substring(0, 6)}@test.com`,
          password: 'hash',
          role: 'ADMIN',
          companyId
        }
      ]
    });

    tokenPhotog = jwt.sign({ id: photographerId, role: 'PHOTOGRAPHER', companyId }, JWT_SECRET);
    tokenAdmin = jwt.sign({ id: adminId, role: 'ADMIN', companyId }, JWT_SECRET);

    // Criar Fichas em diversos estados
    const c1 = await prisma.client.create({
      data: {
        uuid: uuidv4(),
        visibleCode: 'FP-001',
        sequenceNumber: 'FP001',
        name: 'Cliente Em Producao 1',
        city: 'Brasilia',
        event: 'Colegio Alfa',
        bookStatus: 'CREATED',
        photographerId,
        companyId
      }
    });
    fichaCreated1Id = c1.id;

    const c2 = await prisma.client.create({
      data: {
        uuid: uuidv4(),
        visibleCode: 'FP-002',
        sequenceNumber: 'FP002',
        name: 'Cliente Em Producao 2',
        city: 'Brasilia',
        event: 'Colegio Alfa',
        bookStatus: 'CREATED',
        photographerId,
        companyId
      }
    });
    fichaCreated2Id = c2.id;

    const c3 = await prisma.client.create({
      data: {
        uuid: uuidv4(),
        visibleCode: 'FP-003',
        sequenceNumber: 'FP003',
        name: 'Cliente Aguardando Liberacao',
        city: 'Brasilia',
        event: 'Colegio Alfa',
        bookStatus: 'AWAITING_RELEASE',
        photographerId,
        companyId
      }
    });
    fichaAwaitingReleaseId = c3.id;

    const c4 = await prisma.client.create({
      data: {
        uuid: uuidv4(),
        visibleCode: 'FP-004',
        sequenceNumber: 'FP004',
        name: 'Cliente Em Estoque',
        city: 'Brasilia',
        event: 'Colegio Alfa',
        bookStatus: 'IN_STOCK',
        photographerId,
        companyId
      }
    });
    fichaInStockId = c4.id;

    const c5 = await prisma.client.create({
      data: {
        uuid: uuidv4(),
        visibleCode: 'FP-005',
        sequenceNumber: 'FP005',
        name: 'Cliente Vendido',
        city: 'Brasilia',
        event: 'Colegio Alfa',
        bookStatus: 'SOLD',
        photographerId,
        companyId
      }
    });
    fichaSoldId = c5.id;

    // Ficha de outro fotógrafo em produção
    await prisma.client.create({
      data: {
        uuid: uuidv4(),
        visibleCode: 'FP-006',
        sequenceNumber: 'FP006',
        name: 'Cliente Do Colega',
        city: 'Goiania',
        event: 'Colegio Beta',
        bookStatus: 'CREATED',
        photographerId: otherPhotographerId,
        companyId
      }
    });
  });

  after(async () => {
    if (server) await new Promise<void>((resolve) => server.close(resolve));
    await prisma.bookBatch.deleteMany({ where: { companyId } }).catch(() => {});
    await prisma.clientTimeline.deleteMany({ where: { client: { companyId } } }).catch(() => {});
    await prisma.clientEditRequest.deleteMany({ where: { companyId } }).catch(() => {});
    await prisma.client.deleteMany({ where: { companyId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { companyId } }).catch(() => {});
    await prisma.company.deleteMany({ where: { id: companyId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('1. GET /api/clients/photographer retorna SOMENTE fichas em produção CREATED do próprio fotógrafo', async () => {
    const res = await fetch(`${baseUrl}/api/clients/photographer`, {
      headers: { Authorization: `Bearer ${tokenPhotog}` }
    });
    assert.equal(res.status, 200);
    const clients = await res.json() as any[];

    // Deve conter estritamente as fichas em CREATED do fotógrafo
    assert.ok(clients.some(c => c.id === fichaCreated1Id));
    assert.ok(clients.some(c => c.id === fichaCreated2Id));

    // NUNCA deve conter fichas enviadas, em estoque, vendidas ou de outro fotógrafo
    assert.ok(!clients.some(c => c.id === fichaAwaitingReleaseId), 'Ficha AWAITING_RELEASE não deve aparecer');
    assert.ok(!clients.some(c => c.id === fichaInStockId), 'Ficha IN_STOCK não deve aparecer');
    assert.ok(!clients.some(c => c.id === fichaSoldId), 'Ficha SOLD não deve aparecer');
    assert.ok(!clients.some(c => c.photographerId === otherPhotographerId), 'Ficha de outro fotógrafo não deve aparecer');

    for (const c of clients) {
      assert.equal(c.bookStatus, 'CREATED');
    }
  });

  it('2. GET /api/clients para Admin exclui fichas individuais em produção CREATED', async () => {
    const res = await fetch(`${baseUrl}/api/clients`, {
      headers: { Authorization: `Bearer ${tokenAdmin}` }
    });
    assert.equal(res.status, 200);
    const clients = await res.json() as any[];

    // Nenhuma ficha CREATED deve estar na listagem operacional do Admin
    assert.ok(!clients.some(c => c.id === fichaCreated1Id));
    assert.ok(!clients.some(c => c.id === fichaCreated2Id));
    // As que já foram entregues ao admin devem estar presentes
    assert.ok(clients.some(c => c.id === fichaAwaitingReleaseId));
    assert.ok(clients.some(c => c.id === fichaInStockId));
  });

  it('3. GET /api/clients/production-summary retorna resumo agregado por fotógrafo, local e lote sem fichas individuais', async () => {
    const res = await fetch(`${baseUrl}/api/clients/production-summary`, {
      headers: { Authorization: `Bearer ${tokenAdmin}` }
    });
    assert.equal(res.status, 200);
    const summary = await res.json() as any[];

    assert.ok(Array.isArray(summary));
    assert.ok(summary.length >= 2, 'Deve conter os resumos agrupados');

    // Fotógrafo Principal em Brasília
    const grupo1 = summary.find(g => g.photographerId === photographerId && g.city === 'Brasilia');
    assert.ok(grupo1, 'Grupo do Fotografo Principal em Brasília deve existir');
    assert.equal(grupo1.count, 2, 'Deve contabilizar exatamente 2 fichas CREATED');
    assert.equal(grupo1.status, 'Em produção');
    assert.equal(grupo1.event, 'Colegio Alfa');

    // Verificar que não vazam campos individuais de clientes
    assert.equal((grupo1 as any).children, undefined);
    assert.equal((grupo1 as any).clients, undefined);
    assert.equal((grupo1 as any).phone1, undefined);
  });

  it('4. Fotógrafo não pode acessar ficha já entregue via GET /api/clients/ficha/:id', async () => {
    // Ficha em produção: permitido
    const resOpen = await fetch(`${baseUrl}/api/clients/ficha/${fichaCreated1Id}`, {
      headers: { Authorization: `Bearer ${tokenPhotog}` }
    });
    assert.equal(resOpen.status, 200);

    // Ficha entregue / AWAITING_RELEASE: negado com 403
    const resAwaiting = await fetch(`${baseUrl}/api/clients/ficha/${fichaAwaitingReleaseId}`, {
      headers: { Authorization: `Bearer ${tokenPhotog}` }
    });
    assert.equal(resAwaiting.status, 403);

    // Ficha em estoque: negado com 403
    const resStock = await fetch(`${baseUrl}/api/clients/ficha/${fichaInStockId}`, {
      headers: { Authorization: `Bearer ${tokenPhotog}` }
    });
    assert.equal(resStock.status, 403);
  });

  it('5. Envio avulso (force-send) move a ficha para AWAITING_RELEASE e a retira do acesso do fotógrafo', async () => {
    const resSend = await fetch(`${baseUrl}/api/books/client/${fichaCreated1Id}/force-send`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenPhotog}` }
    });
    assert.equal(resSend.status, 200);
    const data = await resSend.json();
    assert.equal(data.client.bookStatus, 'AWAITING_RELEASE');

    // Consulta do fotógrafo não deve mais retornar a ficha enviada
    const resList = await fetch(`${baseUrl}/api/clients/photographer`, {
      headers: { Authorization: `Bearer ${tokenPhotog}` }
    });
    const remaining = await resList.json() as any[];
    assert.ok(!remaining.some(c => c.id === fichaCreated1Id), 'Ficha enviada avulsa sumiu do fotógrafo');
    assert.ok(remaining.some(c => c.id === fichaCreated2Id), 'Ficha ainda em produção permanece');
  });

  it('6. Finalização de lote fecha as fichas CREATED, transfere para AWAITING_RELEASE e as retira do fotógrafo', async () => {
    const resBatch = await fetch(`${baseUrl}/api/books/close-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenPhotog}`
      },
      body: JSON.stringify({
        eventName: 'Colegio Alfa',
        city: 'Brasilia',
        clientIds: [fichaCreated2Id]
      })
    });
    const bodyText = await resBatch.text();
    assert.equal(resBatch.status, 201, `Erro em close-event: ${bodyText}`);
    const batchData = JSON.parse(bodyText);
    assert.equal(batchData.count, 1);

    // A ficha 2 agora está em AWAITING_RELEASE
    const checkFicha2 = await prisma.client.findUnique({ where: { id: fichaCreated2Id } });
    assert.equal(checkFicha2?.bookStatus, 'AWAITING_RELEASE');

    // Fotógrafo agora não tem mais nenhuma ficha em produção para esse lote
    const resList = await fetch(`${baseUrl}/api/clients/photographer`, {
      headers: { Authorization: `Bearer ${tokenPhotog}` }
    });
    const remaining = await resList.json() as any[];
    assert.ok(!remaining.some(c => c.id === fichaCreated2Id));
  });
});
