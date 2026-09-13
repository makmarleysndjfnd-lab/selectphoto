import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

import booksRouter from '../src/routes/books';
import clientsRouter from '../src/routes/clients';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

describe('AGRUPAMENTO POR BATCHID, MULTI-CIDADES E DISTRIBUIÇÃO PARCIAL', () => {
  let app: express.Application;
  let server: any;
  let baseUrl: string;

  const compId = `comp-batch-${uuidv4()}`;
  const adminId = `admin-${uuidv4()}`;
  const photogId = `photog-${uuidv4()}`;
  const sellerId = `seller-${uuidv4()}`;

  let tokenAdmin: string;

  before(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/books', booksRouter);
    app.use('/api/clients', clientsRouter);

    server = app.listen(0);
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;

    await prisma.company.create({
      data: { id: compId, name: 'Empresa Teste Lotes' },
    });

    await prisma.user.createMany({
      data: [
        { id: adminId, name: 'Admin Lotes', email: `admin-${uuidv4()}@test.com`, role: 'ADMIN', companyId: compId, password: 'hash' },
        { id: photogId, name: 'Fotografo Lotes', email: `photog-${uuidv4()}@test.com`, role: 'PHOTOGRAPHER', companyId: compId, password: 'hash' },
        { id: sellerId, name: 'Vendedor Lotes', email: `seller-${uuidv4()}@test.com`, role: 'SELLER', companyId: compId, password: 'hash' },
      ],
    });

    tokenAdmin = jwt.sign({ id: adminId, role: 'ADMIN', companyId: compId }, JWT_SECRET);
  });

  after(async () => {
    if (server) await new Promise<void>((resolve) => server.close(resolve));
    await prisma.client.deleteMany({ where: { companyId: compId } }).catch(() => {});
    await prisma.bookBatch.deleteMany({ where: { companyId: compId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { companyId: compId } }).catch(() => {});
    await prisma.company.deleteMany({ where: { id: compId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('1. Lote "casa" com Brasília e Palmas e segundo lote homônimo permanecem estritamente separados por batchId', async () => {
    // Lote 1: "casa" com fichas em Brasília e Palmas
    const batch1 = await prisma.bookBatch.create({
      data: {
        name: 'casa',
        photographerId: photogId,
        companyId: compId,
        status: 'IN_STOCK',
      },
    });

    const client1Bsb = await prisma.client.create({
      data: {
        sequenceNumber: 'BSB-001',
        visibleCode: 'BSB-001',
        name: 'Cliente Brasília',
        city: 'Brasília',
        state: 'DF',
        companyId: compId,
        photographerId: photogId,
        batchId: batch1.id,
        bookStatus: 'IN_STOCK',
      },
    });

    const client2Palmas = await prisma.client.create({
      data: {
        sequenceNumber: 'PLM-001',
        visibleCode: 'PLM-001',
        name: 'Cliente Palmas',
        city: 'Palmas',
        state: 'TO',
        companyId: compId,
        photographerId: photogId,
        batchId: batch1.id,
        bookStatus: 'IN_STOCK',
      },
    });

    // Lote 2: também chamado "casa", mas com batchId diferente e outras cidades
    const batch2 = await prisma.bookBatch.create({
      data: {
        name: 'casa',
        photographerId: photogId,
        companyId: compId,
        status: 'IN_STOCK',
      },
    });

    const client3Gyn = await prisma.client.create({
      data: {
        sequenceNumber: 'GYN-001',
        visibleCode: 'GYN-001',
        name: 'Cliente Goiânia',
        city: 'Goiânia',
        state: 'GO',
        companyId: compId,
        photographerId: photogId,
        batchId: batch2.id,
        bookStatus: 'IN_STOCK',
      },
    });

    const res = await fetch(`${baseUrl}/api/books/batch`, {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });

    assert.equal(res.status, 200);
    const batches = await res.json();
    assert.ok(Array.isArray(batches));

    // Devem existir 2 lotes distintos, mesmo com nomes idênticos "casa"
    const casaBatches = batches.filter((b: any) => b.name.startsWith('casa'));
    assert.equal(casaBatches.length, 2);
    assert.notEqual(casaBatches[0].id, casaBatches[1].id);

    // Lote 1 tem 2 clientes (Brasília e Palmas)
    const b1Data = batches.find((b: any) => b.id === batch1.id);
    assert.ok(b1Data);
    assert.equal(b1Data.clients.length, 2);
    const b1Cities = b1Data.clients.map((c: any) => c.city).sort();
    assert.deepEqual(b1Cities, ['Brasília', 'Palmas']);

    // Lote 2 tem 1 cliente (Goiânia)
    const b2Data = batches.find((b: any) => b.id === batch2.id);
    assert.ok(b2Data);
    assert.equal(b2Data.clients.length, 1);
    assert.equal(b2Data.clients[0].city, 'Goiânia');
  });

  it('2. Distribuição parcial distribui apenas a ficha selecionada sem criar outro lote nem alterar cidade', async () => {
    const batch = await prisma.bookBatch.findFirst({
      where: { companyId: compId },
      include: { clients: true },
    });
    assert.ok(batch);
    assert.equal(batch.clients.length, 2);

    const clientBsb = batch.clients.find((c) => c.city === 'Brasília')!;
    const clientPalmas = batch.clients.find((c) => c.city === 'Palmas')!;

    // Distribui apenas a ficha de Brasília para o vendedor
    const resAssign = await fetch(`${baseUrl}/api/clients/batch/assign-seller`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({
        clientIds: [clientBsb.id],
        assignedSellerId: sellerId,
      }),
    });
    assert.equal(resAssign.status, 200);

    // Verifica estado no banco
    const updatedBsb = await prisma.client.findUnique({ where: { id: clientBsb.id } });
    const updatedPalmas = await prisma.client.findUnique({ where: { id: clientPalmas.id } });

    // Ficha de Brasília foi distribuída
    assert.equal(updatedBsb?.bookStatus, 'DISTRIBUTED');
    assert.equal(updatedBsb?.assignedSellerId, sellerId);
    assert.equal(updatedBsb?.batchId, batch.id); // Vínculo ao lote preservado
    assert.equal(updatedBsb?.city, 'Brasília'); // Cidade inalterada

    // Ficha de Palmas permanece em estoque no mesmo lote
    assert.equal(updatedPalmas?.bookStatus, 'IN_STOCK');
    assert.equal(updatedPalmas?.assignedSellerId, null);
    assert.equal(updatedPalmas?.batchId, batch.id); // Vínculo ao lote preservado
    assert.equal(updatedPalmas?.city, 'Palmas'); // Cidade inalterada

    // Não foi criado nenhum lote novo
    const totalBatches = await prisma.bookBatch.count({ where: { companyId: compId } });
    assert.equal(totalBatches, 2);
  });

  it('3. PATCH /api/books/batch/:id/base-city atualiza a localidade-base sem alterar fichas ou criar lotes', async () => {
    const batch = await prisma.bookBatch.findFirst({ where: { companyId: compId } });
    assert.ok(batch);

    const resPatch = await fetch(`${baseUrl}/api/books/batch/${batch.id}/base-city`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ baseCity: 'Brasília' }),
    });

    assert.equal(resPatch.status, 200);
    const data = await resPatch.json();
    assert.ok(data.success);
    assert.ok(data.batch.name.includes('Brasília'));

    const updatedBatch = await prisma.bookBatch.findUnique({ where: { id: batch.id } });
    assert.ok(updatedBatch?.name.includes('Brasília'));
  });
});
