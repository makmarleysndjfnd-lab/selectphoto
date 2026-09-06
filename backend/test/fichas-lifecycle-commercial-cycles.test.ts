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
import salesRoutes from '../src/routes/sales';
import booksRoutes from '../src/routes/books';
import closingRoutes from '../src/routes/closing';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET;
const uploadsDir = path.resolve(__dirname, '../uploads');

describe('CICLO DE VIDA DA FICHA, REBOLO E TIMELINE (LIFECYCLE V2)', { concurrency: 1 }, () => {
  let app: express.Application;
  let server: any;
  let baseUrl: string;

  const compId = `comp-life-${uuidv4().substring(0, 8)}`;
  const adminId = `admin-${uuidv4().substring(0, 8)}`;
  const photogId = `photog-${uuidv4().substring(0, 8)}`;
  const seller1Id = `seller-1-${uuidv4().substring(0, 8)}`;
  const seller2Id = `seller-2-${uuidv4().substring(0, 8)}`;

  const emailAdmin = `admin_${compId}@test.com`;
  const emailPhotog = `photog_${compId}@test.com`;
  const emailSeller1 = `seller1_${compId}@test.com`;
  const emailSeller2 = `seller2_${compId}@test.com`;

  const tokenAdmin = jwt.sign(
    { id: adminId, companyId: compId, role: 'ADMIN', email: emailAdmin },
    JWT_SECRET
  );
  const tokenPhotog = jwt.sign(
    { id: photogId, companyId: compId, role: 'PHOTOGRAPHER', email: emailPhotog },
    JWT_SECRET
  );
  const tokenSeller1 = jwt.sign(
    { id: seller1Id, companyId: compId, role: 'SELLER', email: emailSeller1 },
    JWT_SECRET
  );
  const tokenSeller2 = jwt.sign(
    { id: seller2Id, companyId: compId, role: 'SELLER', email: emailSeller2 },
    JWT_SECRET
  );

  before(async () => {
    app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use('/api/clients', clientRoutes);
    app.use('/api/sales', salesRoutes);
    app.use('/api/books', booksRoutes);
    app.use('/api/closing', closingRoutes);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    await prisma.company.create({
      data: {
        id: compId,
        name: 'Empresa Teste Ciclo Ficha',
        cnpj: `cnpj-${uuidv4().substring(0, 8)}`,
      },
    });

    await prisma.user.createMany({
      data: [
        { id: adminId, name: 'Admin Teste', email: emailAdmin, role: 'ADMIN', companyId: compId, password: 'hash' },
        { id: photogId, name: 'Fotografo Teste', email: emailPhotog, role: 'PHOTOGRAPHER', companyId: compId, password: 'hash' },
        { id: seller1Id, name: 'Vendedor 1', email: emailSeller1, role: 'SELLER', companyId: compId, password: 'hash' },
        { id: seller2Id, name: 'Vendedor 2', email: emailSeller2, role: 'SELLER', companyId: compId, password: 'hash' },
      ],
    });
  });

  after(async () => {
    if (server) await new Promise<void>((resolve) => server.close(resolve));
    await prisma.sellerCityClosing.deleteMany({ where: { companyId: compId } }).catch(() => {});
    await prisma.clientTimeline.deleteMany({ where: { client: { companyId: compId } } }).catch(() => {});
    await prisma.sale.deleteMany({ where: { client: { companyId: compId } } }).catch(() => {});
    await prisma.nonSale.deleteMany({ where: { client: { companyId: compId } } }).catch(() => {});
    await prisma.client.deleteMany({ where: { companyId: compId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { companyId: compId } }).catch(() => {});
    await prisma.company.deleteMany({ where: { id: compId } }).catch(() => {});
    await prisma.$disconnect();
  });

  const validPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  it('1. Cadastro via syncClients com localId é idempotente e registra timeline CREATED', async () => {
    const localId = uuidv4();
    const seq = `SEQ-SYNC-${uuidv4().substring(0, 6)}`;

    const payload = {
      localId,
      sequenceNumber: seq,
      name: 'Cliente Teste Sync',
      city: 'Maringa',
      event: 'Formatura Unicesumar',
      signatureBase64: validPngBase64,
    };

    // 1ª sincronização
    const res1 = await fetch(`${baseUrl}/api/clients/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPhotog}` },
      body: JSON.stringify({ clients: [payload] }),
    });
    assert.equal(res1.status, 200);
    const data1 = await res1.json();
    assert.equal(data1.success, 1);
    assert.equal(data1.synced, 1);

    const client = await prisma.client.findFirst({ where: { sequenceNumber: seq, companyId: compId } });
    assert.ok(client);
    assert.equal(client.localId, localId);
    assert.equal(client.bookStatus, 'CREATED');
    assert.equal(client.commercialCycle, 1);

    // 2ª sincronização (retentativa com mesmo localId)
    const res2 = await fetch(`${baseUrl}/api/clients/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPhotog}` },
      body: JSON.stringify({ clients: [payload] }),
    });
    assert.equal(res2.status, 200);
    const data2 = await res2.json();
    assert.equal(data2.synced, 1);

    // Não duplicou
    const count = await prisma.client.count({ where: { sequenceNumber: seq, companyId: compId } });
    assert.equal(count, 1);

    // Timeline registrada
    const timeline = await prisma.clientTimeline.findMany({ where: { clientId: client.id } });
    assert.ok(timeline.some((t) => t.action === 'CREATED'));
  });

  it('2. Colisão de sequenceNumber com ficha existente que avançou de status é rejeitada com 400', async () => {
    const originalLocalId = uuidv4();
    const seq = `SEQ-COLLISION-${uuidv4().substring(0, 6)}`;

    // Cria ficha 1 e avança para IN_STOCK
    const client1 = await prisma.client.create({
      data: {
        sequenceNumber: seq,
        localId: originalLocalId,
        name: 'Cliente Original',
        city: 'Maringa',
        companyId: compId,
        photographerId: photogId,
        bookStatus: 'IN_STOCK',
      },
    });

    // Outro cadastro local gerou mesmo sequenceNumber com localId diferente
    const collisionPayload = {
      localId: uuidv4(),
      sequenceNumber: seq,
      name: 'Cliente Invasor',
      city: 'Maringa',
      event: 'Outro Evento',
      signatureBase64: validPngBase64,
    };

    const res = await fetch(`${baseUrl}/api/clients/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPhotog}` },
      body: JSON.stringify({ clients: [collisionPayload] }),
    });

    assert.equal(res.status, 200);
    const errData = await res.json();
    assert.equal(errData.failed, 1);
    assert.ok(errData.details[0].reason.includes('Colisão'));

    // Verifica que cliente original não foi alterado
    const original = await prisma.client.findUnique({ where: { id: client1.id } });
    assert.equal(original?.name, 'Cliente Original');
    assert.equal(original?.bookStatus, 'IN_STOCK');
  });

  it('3. Não permite atribuir vendedor para fichas finalizadas (SOLD ou DISCARDED)', async () => {
    const soldClient = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ-SOLD-${uuidv4().substring(0, 6)}`,
        name: 'Cliente Vendido',
        city: 'Cascavel',
        companyId: compId,
        outcomeStatus: 'SOLD',
        bookStatus: 'SOLD',
      },
    });

    const discardedClient = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ-DISC-${uuidv4().substring(0, 6)}`,
        name: 'Cliente Descartado',
        city: 'Cascavel',
        companyId: compId,
        outcomeStatus: 'NON_SALE',
        bookStatus: 'DISCARDED',
      },
    });

    // Tentar atribuir soldClient via batch/assign-seller
    const res1 = await fetch(`${baseUrl}/api/clients/batch/assign-seller`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({
        clientIds: [soldClient.id],
        assignedSellerId: seller1Id,
      }),
    });
    assert.equal(res1.status, 409);

    // Tentar atribuir discardedClient via assign-seller individual
    const res2 = await fetch(`${baseUrl}/api/clients/assign-seller`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({
        clientId: discardedClient.id,
        sellerId: seller1Id,
      }),
    });
    assert.equal(res2.status, 409);
  });

  it('4. Assinatura: rejeita fictitious_signature com 400 e aceita assinatura real em Base64', async () => {
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ-SIG-${uuidv4().substring(0, 6)}`,
        name: 'Cliente Teste Assinatura',
        city: 'Londrina',
        companyId: compId,
        assignedSellerId: seller1Id,
        bookStatus: 'DISTRIBUTED',
        outcomeStatus: 'PENDING',
      },
    });

    // 1. Tenta enviar fictitious_signature
    const resFake = await fetch(`${baseUrl}/api/sales/non-sale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenSeller1}` },
      body: JSON.stringify({
        clientId: client.id,
        reason: 'Sem condições',
        signatureBase64: 'fictitious_signature',
      }),
    });
    assert.equal(resFake.status, 400);
    const fakeJson = await resFake.json();
    assert.ok(fakeJson.error.includes('Assinatura'));

    // 2. Envia assinatura Base64 PNG real
    const resReal = await fetch(`${baseUrl}/api/sales/non-sale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenSeller1}` },
      body: JSON.stringify({
        clientId: client.id,
        reason: 'Sem condições financeiras',
        signatureBase64: validPngBase64,
        sellerRating: 5,
        photoRating: 4,
        contactRating: 5,
      }),
    });
    assert.equal(resReal.status, 201);
    const realJson = await resReal.json();
    assert.ok(realJson.id);

    const updated = await prisma.client.findUnique({ where: { id: client.id } });
    assert.equal(updated?.outcomeStatus, 'NON_SALE');
    assert.equal(updated?.bookStatus, 'AWAITING_RETURN');
  });

  it('5. Venda com comprovante exige sheetPhoto, persiste notas de atendimento e anotações do relatório', async () => {
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ-SALE-${uuidv4().substring(0, 6)}`,
        name: 'Cliente Venda Completa',
        city: 'Apucarana',
        companyId: compId,
        assignedSellerId: seller1Id,
        bookStatus: 'DISTRIBUTED',
        outcomeStatus: 'PENDING',
      },
    });

    // 1. Tenta enviar sem sheetPhoto
    const formMissingSheet = new FormData();
    formMissingSheet.set('clientId', client.id);
    formMissingSheet.set('value', '850');
    formMissingSheet.set('city', 'Apucarana');
    formMissingSheet.set('receipt', new Blob([Buffer.from('fake-receipt')], { type: 'image/jpeg' }), 'rec.jpg');

    const resMissing = await fetch(`${baseUrl}/api/sales/with-receipt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenSeller1}` },
      body: formMissingSheet,
    });
    assert.equal(resMissing.status, 400);
    const missingJson = await resMissing.json();
    assert.ok(missingJson.error.includes('ficha') || missingJson.code === 'SHEET_PHOTO_REQUIRED');

    // 2. Envia com receipt + sheetPhoto + ratings + reportNotes
    const formComplete = new FormData();
    formComplete.set('clientId', client.id);
    formComplete.set('value', '850');
    formComplete.set('city', 'Apucarana');
    formComplete.set('product', 'Book completo');
    formComplete.set('receipt', new Blob([Buffer.from('fake-receipt-data')], { type: 'image/jpeg' }), 'rec.jpg');
    formComplete.set('sheetPhoto', new Blob([Buffer.from('fake-sheet-data')], { type: 'image/jpeg' }), 'sheet.jpg');
    formComplete.set('reportNotes', 'Cliente solicitou entrega com embalagem especial');
    formComplete.set('sellerRating', '5');
    formComplete.set('photographerRating', '4');
    formComplete.set('contactRating', '5');

    const resComplete = await fetch(`${baseUrl}/api/sales/with-receipt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenSeller1}` },
      body: formComplete,
    });
    assert.equal(resComplete.status, 201);
    const saleData = await resComplete.json();
    assert.ok(saleData.id);

    const sale = await prisma.sale.findUnique({ where: { id: saleData.id } });
    assert.ok(sale);
    assert.ok(sale.receiptUrl);
    assert.ok(sale.sheetPhotoUrl);
    assert.equal(sale.reportNotes, 'Cliente solicitou entrega com embalagem especial');
    assert.equal(sale.sellerRating, 5);
    assert.equal(sale.photographerRating, 4);
    assert.equal(sale.contactRating, 5);

    const clientAfterSale = await prisma.client.findUnique({ where: { id: client.id } });
    assert.equal(clientAfterSale?.outcomeStatus, 'SOLD');
    assert.equal(clientAfterSale?.bookStatus, 'SOLD');
  });

  it('6. Ciclos comerciais Rebolo: ciclo 1 não-venda vai para REBOLO; ciclo 2 não-venda vai para DISCARDED', async () => {
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ-REBOLO-${uuidv4().substring(0, 6)}`,
        name: 'Cliente Rebolo Multiciclo',
        city: 'Toledo',
        companyId: compId,
        assignedSellerId: seller1Id,
        bookStatus: 'DISTRIBUTED',
        outcomeStatus: 'PENDING',
        commercialCycle: 1,
      },
    });

    // Ciclo 1: Vendedor 1 registra não-venda
    const resNs1 = await fetch(`${baseUrl}/api/sales/non-sale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenSeller1}` },
      body: JSON.stringify({
        clientId: client.id,
        reason: 'Não quis atender',
        signatureBase64: validPngBase64,
      }),
    });
    assert.equal(resNs1.status, 201);

    let c = await prisma.client.findUnique({ where: { id: client.id } });
    assert.equal(c?.bookStatus, 'AWAITING_RETURN');

    // Admin recebe devolução do ciclo 1 -> deve ir para IN_STOCK_REBOLO, cycle 2, assignedSellerId: null
    const resRet1 = await fetch(`${baseUrl}/api/books/receive-return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ clientId: client.id }),
    });
    assert.equal(resRet1.status, 200);

    c = await prisma.client.findUnique({ where: { id: client.id } });
    assert.equal(c?.bookStatus, 'IN_STOCK_REBOLO');
    assert.equal(c?.commercialCycle, 2);
    assert.equal(c?.assignedSellerId, null);

    // Atribui para Vendedor 2 no ciclo de rebolo -> DISTRIBUTED_REBOLO
    const resAssign2 = await fetch(`${baseUrl}/api/clients/assign-seller`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ clientId: client.id, sellerId: seller2Id }),
    });
    assert.equal(resAssign2.status, 200);

    c = await prisma.client.findUnique({ where: { id: client.id } });
    assert.equal(c?.bookStatus, 'DISTRIBUTED_REBOLO');
    assert.equal(c?.assignedSellerId, seller2Id);

    // Ciclo 2: Vendedor 2 registra nova não-venda
    const resNs2 = await fetch(`${baseUrl}/api/sales/non-sale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenSeller2}` },
      body: JSON.stringify({
        clientId: client.id,
        reason: 'Recusou novamente',
        signatureBase64: validPngBase64,
      }),
    });
    assert.equal(resNs2.status, 201);

    // Admin recebe devolução do ciclo 2 -> deve ir para DISCARDED
    const resRet2 = await fetch(`${baseUrl}/api/books/receive-return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ clientId: client.id }),
    });
    assert.equal(resRet2.status, 200);

    c = await prisma.client.findUnique({ where: { id: client.id } });
    assert.equal(c?.bookStatus, 'DISCARDED');
    assert.equal(c?.assignedSellerId, null);
  });

  it('7. Fechamento de cidade bloqueia quando há pendências e só encerra fichas com desfecho definitivo', async () => {
    const city = `Cidade-Fechamento-${uuidv4().substring(0, 6)}`;

    // Ficha 1: Pendente (sem desfecho)
    const pendingClient = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ-CLOSE-P-${uuidv4().substring(0, 6)}`,
        name: 'Cliente Pendente Fechamento',
        city,
        companyId: compId,
        assignedSellerId: seller1Id,
        outcomeStatus: 'PENDING',
        bookStatus: 'DISTRIBUTED',
      },
    });

    // Ficha 2: Vendida com comprovante
    const soldClient = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ-CLOSE-S-${uuidv4().substring(0, 6)}`,
        name: 'Cliente Vendido Fechamento',
        city,
        companyId: compId,
        assignedSellerId: seller1Id,
        outcomeStatus: 'SOLD',
        bookStatus: 'SOLD',
      },
    });
    await prisma.sale.create({
      data: {
        clientId: soldClient.id,
        sellerId: seller1Id,
        companyId: compId,
        value: 500,
        city,
        receiptUrl: '/uploads/fake-receipt.jpg',
        sheetPhotoUrl: '/uploads/fake-sheet.jpg',
      },
    });

    // 1. Preview da cidade indica canClose: false e lista pendingClients
    const resPreview = await fetch(`${baseUrl}/api/closing/city/preview?city=${encodeURIComponent(city)}`, {
      headers: { Authorization: `Bearer ${tokenSeller1}` },
    });
    assert.equal(resPreview.status, 200);
    const previewData = await resPreview.json();
    assert.equal(previewData.canClose, false);
    assert.equal(previewData.pendingCount, 1);
    assert.equal(previewData.pendingClients.length, 1);
    assert.equal(previewData.pendingClients[0].id, pendingClient.id);

    // 2. Tentar fechar cidade diretamente deve retornar 409 (pendências não resolvidas)
    const resCloseFail = await fetch(`${baseUrl}/api/closing/city`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenSeller1}` },
      body: JSON.stringify({ city }),
    });
    assert.equal(resCloseFail.status, 409);

    // 3. Resolver a ficha pendente (registrando não-venda com assinatura real)
    const resResolve = await fetch(`${baseUrl}/api/sales/non-sale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenSeller1}` },
      body: JSON.stringify({
        clientId: pendingClient.id,
        reason: 'Ausente',
        signatureBase64: validPngBase64,
      }),
    });
    assert.equal(resResolve.status, 201);

    // 4. Agora o fechamento deve passar com 201
    const resCloseOk = await fetch(`${baseUrl}/api/closing/city`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenSeller1}` },
      body: JSON.stringify({ city }),
    });
    assert.equal(resCloseOk.status, 201);

    const c1 = await prisma.client.findUnique({ where: { id: pendingClient.id } });
    const c2 = await prisma.client.findUnique({ where: { id: soldClient.id } });
    assert.ok(c1?.cityClosedAt);
    assert.ok(c2?.cityClosedAt);
  });

  it('8. Timeline GET /api/clients/:id/timeline expõe histórico cronológico completo', async () => {
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ-TL-${uuidv4().substring(0, 6)}`,
        name: 'Cliente Timeline Teste',
        city: 'Foz',
        companyId: compId,
      },
    });

    await prisma.clientTimeline.createMany({
      data: [
        { clientId: client.id, action: 'CREATED', newStatus: 'CREATED', metadata: { source: 'sync' } },
        { clientId: client.id, action: 'CONFIRMED_GRAFICA', previousStatus: 'AWAITING_RELEASE', newStatus: 'IN_STOCK' },
        { clientId: client.id, action: 'ASSIGNED_SELLER', newStatus: 'DISTRIBUTED', authorId: adminId, newSellerId: seller1Id },
      ],
    });

    const res = await fetch(`${baseUrl}/api/clients/${client.id}/timeline`, {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    assert.equal(res.status, 200);
    const entries = await res.json();
    assert.ok(Array.isArray(entries));
    assert.equal(entries.length, 3);
    assert.equal(entries[0].action, 'CREATED');
    assert.equal(entries[1].action, 'CONFIRMED_GRAFICA');
    assert.equal(entries[2].action, 'ASSIGNED_SELLER');
  });
});
