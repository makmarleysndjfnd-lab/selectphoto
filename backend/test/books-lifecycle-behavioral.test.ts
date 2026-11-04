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

import { prisma } from '../src/services/prisma';
import clientRoutes from '../src/routes/clients';
import booksRoutes from '../src/routes/books';
import salesRoutes from '../src/routes/sales';

const JWT_SECRET = process.env.JWT_SECRET!;

describe('CICLO DE VIDA, ISOLAMENTO E RETENÇÃO DE LOTES (RELEASE 1.0.31+43)', { concurrency: 1 }, () => {
  let app: express.Application;
  let server: any;
  let baseUrl: string;

  const compA = `comp-a-${uuidv4().substring(0, 8)}`;
  const compB = `comp-b-${uuidv4().substring(0, 8)}`;

  const adminA = `admin-a-${uuidv4().substring(0, 8)}`;
  const photogA1 = `photog-a1-${uuidv4().substring(0, 8)}`;
  const photogA2 = `photog-a2-${uuidv4().substring(0, 8)}`;
  const sellerA = `seller-a-${uuidv4().substring(0, 8)}`;

  const adminB = `admin-b-${uuidv4().substring(0, 8)}`;
  const photogB = `photog-b-${uuidv4().substring(0, 8)}`;

  const tokenAdminA = jwt.sign({ id: adminA, companyId: compA, role: 'ADMIN' }, JWT_SECRET);
  const tokenPhotogA1 = jwt.sign({ id: photogA1, companyId: compA, role: 'PHOTOGRAPHER' }, JWT_SECRET);
  const tokenPhotogA2 = jwt.sign({ id: photogA2, companyId: compA, role: 'PHOTOGRAPHER' }, JWT_SECRET);
  const tokenSellerA = jwt.sign({ id: sellerA, companyId: compA, role: 'SELLER' }, JWT_SECRET);

  const tokenAdminB = jwt.sign({ id: adminB, companyId: compB, role: 'ADMIN' }, JWT_SECRET);
  const tokenPhotogB = jwt.sign({ id: photogB, companyId: compB, role: 'PHOTOGRAPHER' }, JWT_SECRET);

  before(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/clients', clientRoutes);
    app.use('/api/books', booksRoutes);
    app.use('/api/sales', salesRoutes);

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = (server.address() as any).port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 0. Aplicar migração aditiva no banco de teste local se necessário
    await prisma.$executeRawUnsafe(`ALTER TABLE "BookBatch" ADD COLUMN IF NOT EXISTS "totalProduced" INTEGER DEFAULT 0;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "BookBatch" ADD COLUMN IF NOT EXISTS "city" TEXT;`);

    // 1. Criar empresas de teste
    await prisma.company.createMany({
      data: [
        { id: compA, name: 'Empresa Teste A' },
        { id: compB, name: 'Empresa Teste B' },
      ]
    });

    // 2. Criar usuários de teste
    await prisma.user.createMany({
      data: [
        { id: adminA, name: 'Admin A', email: `${adminA}@test.com`, password: 'hash', role: 'ADMIN', companyId: compA },
        { id: photogA1, name: 'Fotógrafo A1', email: `${photogA1}@test.com`, password: 'hash', role: 'PHOTOGRAPHER', companyId: compA },
        { id: photogA2, name: 'Fotógrafo A2', email: `${photogA2}@test.com`, password: 'hash', role: 'PHOTOGRAPHER', companyId: compA },
        { id: sellerA, name: 'Vendedor A', email: `${sellerA}@test.com`, password: 'hash', role: 'SELLER', companyId: compA },

        { id: adminB, name: 'Admin B', email: `${adminB}@test.com`, password: 'hash', role: 'ADMIN', companyId: compB },
        { id: photogB, name: 'Fotógrafo B', email: `${photogB}@test.com`, password: 'hash', role: 'PHOTOGRAPHER', companyId: compB },
      ]
    });
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    // Teardown cirúrgico dos dados de teste
    try {
      await prisma.salePayment.deleteMany({ where: { sale: { companyId: { in: [compA, compB] } } } });
      await prisma.sale.deleteMany({ where: { companyId: { in: [compA, compB] } } });
      await prisma.clientTimeline.deleteMany({ where: { client: { companyId: { in: [compA, compB] } } } });
      await prisma.child.deleteMany({ where: { client: { companyId: { in: [compA, compB] } } } });
      await prisma.client.deleteMany({ where: { companyId: { in: [compA, compB] } } });
      await prisma.bookBatch.deleteMany({ where: { companyId: { in: [compA, compB] } } });
      await prisma.notification.deleteMany({ where: { companyId: { in: [compA, compB] } } });
      await prisma.user.deleteMany({ where: { companyId: { in: [compA, compB] } } });
      await prisma.company.deleteMany({ where: { id: { in: [compA, compB] } } });
    } catch (_) {}
  });

  it('1. POST /books/session/start bloqueia vendedor com 403 e valida posse de lote', async () => {
    // 1. Vendedor tenta iniciar sessão -> 403
    const resSeller = await fetch(`${baseUrl}/api/books/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenSellerA}` },
      body: JSON.stringify({ eventName: 'Evento Proibido', city: 'Campinas' })
    });
    assert.equal(resSeller.status, 403, 'Vendedor deve ser rejeitado com 403');

    // 2. Fotógrafo A1 cria lote
    const batchIdA1 = `batch-${uuidv4().substring(0, 8)}`;
    const resPhotog = await fetch(`${baseUrl}/api/books/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPhotogA1}` },
      body: JSON.stringify({ batchId: batchIdA1, eventName: 'Formatura Unicamp', city: 'Campinas' })
    });
    assert.equal(resPhotog.status, 200);
    const dataPhotog: any = await resPhotog.json();
    assert.equal(dataPhotog.batchId, batchIdA1);
    assert.equal(dataPhotog.status, 'CREATED');
    assert.equal(dataPhotog.totalProduced, 0);

    // 3. Outra empresa (Fotógrafo B) tenta se apossar do mesmo batchId -> 403
    const resCrossCompany = await fetch(`${baseUrl}/api/books/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPhotogB}` },
      body: JSON.stringify({ batchId: batchIdA1, eventName: 'Ataque Cross-Company' })
    });
    assert.equal(resCrossCompany.status, 403, 'Tentativa de apropriação por outra empresa deve retornar 403');

    // 4. Outro fotógrafo da mesma empresa (Photog A2) tenta se apossar do lote de A1 -> 403
    const resCrossPhotog = await fetch(`${baseUrl}/api/books/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPhotogA2}` },
      body: JSON.stringify({ batchId: batchIdA1, eventName: 'Conflito Fotógrafos' })
    });
    assert.equal(resCrossPhotog.status, 403, 'Fotógrafo diferente não pode sobrescrever lote alheio');
  });

  it('2. POST /api/clients/sync cria BookBatch automaticamente para batchId gerado offline', async () => {
    const offlineBatchId = `batch-offline-${uuidv4().substring(0, 8)}`;
    const clientUuid1 = uuidv4();
    const clientUuid2 = uuidv4();

    // Sincroniza 2 fichas apontando para um lote criado offline no celular
    const resSync = await fetch(`${baseUrl}/api/clients/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPhotogA1}` },
      body: JSON.stringify({
        clients: [
          {
            uuid: clientUuid1,
            name: 'Aluno Um',
            event: 'Escola Modelo',
            city: 'Campinas',
            batchId: offlineBatchId,
          },
          {
            uuid: clientUuid2,
            name: 'Aluno Dois',
            event: 'Escola Modelo',
            city: 'Campinas',
            batchId: offlineBatchId,
          }
        ]
      })
    });
    assert.equal(resSync.status, 200);
    const syncData: any = await resSync.json();
    assert.equal(syncData.success, 2);

    // Verifica que o BookBatch foi criado no banco com status CREATED, vinculado ao fotógrafo e à empresa
    const createdBatch = await prisma.bookBatch.findUnique({
      where: { id: offlineBatchId }
    });
    assert.ok(createdBatch, 'BookBatch deve ter sido criado automaticamente na sincronização offline');
    assert.equal(createdBatch.status, 'CREATED');
    assert.equal(createdBatch.companyId, compA);
    assert.equal(createdBatch.photographerId, photogA1);
    assert.equal(createdBatch.city, 'Campinas');

    // Verifica que as 2 fichas foram associadas corretamente
    const clientsCount = await prisma.client.count({
      where: { batchId: offlineBatchId, companyId: compA }
    });
    assert.equal(clientsCount, 2);
  });

  it('3. POST /books/close-event congela totalProduced e impede reabertura concorrente', async () => {
    const batchIdToClose = `batch-close-${uuidv4().substring(0, 8)}`;
    const clientUuidA = uuidv4();
    const clientUuidB = uuidv4();
    const clientUuidC = uuidv4();

    // Iniciar sessão
    await fetch(`${baseUrl}/api/books/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPhotogA1}` },
      body: JSON.stringify({ batchId: batchIdToClose, eventName: 'Festival de Dança', city: 'Valinhos' })
    });

    // Inserir 3 fichas
    await fetch(`${baseUrl}/api/clients/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPhotogA1}` },
      body: JSON.stringify({
        clients: [
          { uuid: clientUuidA, name: 'Bailarina 1', event: 'Festival de Dança', city: 'Valinhos', batchId: batchIdToClose },
          { uuid: clientUuidB, name: 'Bailarina 2', event: 'Festival de Dança', city: 'Valinhos', batchId: batchIdToClose },
          { uuid: clientUuidC, name: 'Bailarina 3', event: 'Festival de Dança', city: 'Valinhos', batchId: batchIdToClose },
        ]
      })
    });

    // 1. Vendedor tenta fechar lote -> 403
    const resSellerClose = await fetch(`${baseUrl}/api/books/close-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenSellerA}` },
      body: JSON.stringify({ batchId: batchIdToClose })
    });
    assert.equal(resSellerClose.status, 403);

    // 2. Fotógrafo fecha lote -> status AWAITING_RELEASE e totalProduced congelado em 3
    const resClose = await fetch(`${baseUrl}/api/books/close-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPhotogA1}` },
      body: JSON.stringify({ batchId: batchIdToClose })
    });
    assert.equal(resClose.status, 201);
    const closeData: any = await resClose.json();
    assert.equal(closeData.count, 3);

    const closedBatch = await prisma.bookBatch.findUnique({
      where: { id: batchIdToClose }
    });
    assert.ok(closedBatch);
    assert.equal(closedBatch.status, 'AWAITING_RELEASE');
    assert.equal(closedBatch.totalProduced, 3, 'totalProduced deve estar congelado exatamente em 3');

    // 3. Retentativa de fechamento é idempotente (não reabre nem altera contagem)
    const resRetry = await fetch(`${baseUrl}/api/books/close-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPhotogA1}` },
      body: JSON.stringify({ batchId: batchIdToClose })
    });
    assert.equal(resRetry.status, 200);
    const retryData: any = await resRetry.json();
    assert.equal(retryData.alreadyClosed, true);
    assert.equal(retryData.totalProduced, 3);

    // 4. Retentativa de session/start no lote já fechado retorna lote fechado sem reabrir
    const resReopen = await fetch(`${baseUrl}/api/books/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPhotogA1}` },
      body: JSON.stringify({ batchId: batchIdToClose, eventName: 'Festival Reaberto' })
    });
    assert.equal(resReopen.status, 200);
    const reopenData: any = await resReopen.json();
    assert.equal(reopenData.alreadyClosed, true);
    assert.equal(reopenData.status, 'AWAITING_RELEASE');
    assert.equal(reopenData.totalProduced, 3);
  });

  it('4. GET /api/books/batch protege privacidade de CREATED e mantém retenção de lotes com vendedores', async () => {
    // 1. Vendedor é bloqueado com 403
    const resSellerBatch = await fetch(`${baseUrl}/api/books/batch`, {
      headers: { Authorization: `Bearer ${tokenSellerA}` }
    });
    assert.equal(resSellerBatch.status, 403, 'Vendedor não pode listar lotes da gráfica');

    // 2. Criar lote CREATED em campo aberto
    const batchCreatedId = `batch-priv-${uuidv4().substring(0, 8)}`;
    await fetch(`${baseUrl}/api/books/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPhotogA1}` },
      body: JSON.stringify({ batchId: batchCreatedId, eventName: 'Evento Aberto', city: 'Jundiaí' })
    });
    await fetch(`${baseUrl}/api/clients/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPhotogA1}` },
      body: JSON.stringify({
        clients: [
          { uuid: uuidv4(), name: 'Aluno Privado 1', batchId: batchCreatedId },
          { uuid: uuidv4(), name: 'Aluno Privado 2', batchId: batchCreatedId }
        ]
      })
    });

    // 3. Criar lote com todas as fichas DISTRIBUÍDAS para o vendedor (inStock = 0, distributed = 2)
    const batchDistId = `batch-dist-${uuidv4().substring(0, 8)}`;
    await prisma.bookBatch.create({
      data: {
        id: batchDistId,
        name: 'Lote Distribuído',
        city: 'Jundiaí',
        photographerId: photogA1,
        companyId: compA,
        status: 'IN_STOCK',
        totalProduced: 2
      }
    });
    await prisma.client.createMany({
      data: [
        {
          id: `cli-dist-1-${uuidv4().substring(0, 8)}`,
          uuid: uuidv4(),
          name: 'Cliente com Vendedor 1',
          visibleCode: 'VEND-01',
          sequenceNumber: 'VEND-01',
          companyId: compA,
          batchId: batchDistId,
          assignedSellerId: sellerA,
          bookStatus: 'DISTRIBUTED',
          commercialCycle: 1,
        },
        {
          id: `cli-dist-2-${uuidv4().substring(0, 8)}`,
          uuid: uuidv4(),
          name: 'Cliente com Vendedor 2',
          visibleCode: 'VEND-02',
          sequenceNumber: 'VEND-02',
          companyId: compA,
          batchId: batchDistId,
          assignedSellerId: sellerA,
          bookStatus: 'AWAITING_RETURN',
          commercialCycle: 1,
        }
      ]
    });

    // 4. Consultar GET /api/books/batch como Admin A
    const resAdminBatches = await fetch(`${baseUrl}/api/books/batch`, {
      headers: { Authorization: `Bearer ${tokenAdminA}` }
    });
    assert.equal(resAdminBatches.status, 200);
    const adminBatches: any[] = await resAdminBatches.json();

    // Verificação de Privacidade do lote CREATED:
    const foundCreated = adminBatches.find(b => b.id === batchCreatedId);
    assert.ok(foundCreated, 'Lote CREATED deve constar na resposta');
    assert.equal(foundCreated.counts.inProduction, 2, 'Contador de produção deve ser 2');
    assert.deepEqual(foundCreated.clients, [], 'Identidades individuais de clientes em CREATED devem vir vazias por privacidade');

    // Verificação de Retenção do lote distribuído:
    // O lote distribuído NÃO pode sumir da lista operacional mesmo com inStock = 0
    const foundDist = adminBatches.find(b => b.id === batchDistId);
    assert.ok(foundDist, 'Lote cujas fichas estão com vendedores deve ser retido na listagem operacional');
    assert.equal(foundDist.counts.inStock, 0);
    assert.equal(foundDist.counts.distributed, 2);
    assert.equal(foundDist.clients.length, 2, 'Fichas ativas com vendedor e aguardando devolução devem estar presentes');

    // 5. Fotógrafo consulta: só deve ver seus próprios lotes (isolamento de fotógrafo)
    const resPhotogBatches = await fetch(`${baseUrl}/api/books/batch`, {
      headers: { Authorization: `Bearer ${tokenPhotogA2}` }
    });
    assert.equal(resPhotogBatches.status, 200);
    const photogBatches: any[] = await resPhotogBatches.json();
    for (const b of photogBatches) {
      assert.equal(b.photographerId, photogA2, 'Fotógrafo só deve enxergar os lotes criados por ele');
    }
  });
});
