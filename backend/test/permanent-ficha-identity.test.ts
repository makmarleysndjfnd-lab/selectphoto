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
import { generateVisibleCode, getNextVisibleCode, getBijectiveBase26 } from '../src/utils/visibleCode';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET!;

describe('IDENTIDADE PERMANENTE DA FICHA (UUID + VISIBLE CODE + QR + REBOLO)', { concurrency: 1 }, () => {
  let app: express.Application;
  let server: any;
  let baseUrl: string;

  const compId = `comp-uuid-${uuidv4().substring(0, 8)}`;
  const adminId = `admin-uuid-${uuidv4().substring(0, 8)}`;
  const photogId = `photog-uuid-${uuidv4().substring(0, 8)}`;
  const seller1Id = `seller1-uuid-${uuidv4().substring(0, 8)}`;
  const seller2Id = `seller2-uuid-${uuidv4().substring(0, 8)}`;

  const tokenAdmin = jwt.sign({ id: adminId, companyId: compId, role: 'ADMIN' }, JWT_SECRET);
  const tokenPhotog = jwt.sign({ id: photogId, companyId: compId, role: 'PHOTOGRAPHER' }, JWT_SECRET);
  const tokenSeller1 = jwt.sign({ id: seller1Id, companyId: compId, role: 'SELLER' }, JWT_SECRET);
  const tokenSeller2 = jwt.sign({ id: seller2Id, companyId: compId, role: 'SELLER' }, JWT_SECRET);

  before(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/clients', clientRoutes);
    app.use('/api/sales', salesRoutes);
    app.use('/api/books', booksRoutes);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const port = (server.address() as any).port;
        baseUrl = `http://127.0.0.1:${port}/api`;
        resolve();
      });
    });

    // Seed Company and Users
    await prisma.company.create({
      data: { id: compId, name: 'Empresa Teste UUID', cnpj: `cnpj-${uuidv4().substring(0, 10)}` },
    });

    await prisma.user.createMany({
      data: [
        { id: adminId, name: 'Admin Teste', email: `admin-${compId}@test.com`, password: 'hash', role: 'ADMIN', companyId: compId },
        { id: photogId, name: 'Fotografo Teste', email: `photog-${compId}@test.com`, password: 'hash', role: 'PHOTOGRAPHER', companyId: compId },
        { id: seller1Id, name: 'Vendedor 1', email: `seller1-${compId}@test.com`, password: 'hash', role: 'SELLER', companyId: compId },
        { id: seller2Id, name: 'Vendedor 2', email: `seller2-${compId}@test.com`, password: 'hash', role: 'SELLER', companyId: compId },
      ],
    });
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await prisma.clientTimeline.deleteMany({ where: { client: { companyId: compId } } });
    await prisma.sale.deleteMany({ where: { client: { companyId: compId } } });
    await prisma.nonSale.deleteMany({ where: { client: { companyId: compId } } });
    await prisma.child.deleteMany({ where: { client: { companyId: compId } } });
    await prisma.client.deleteMany({ where: { companyId: compId } });
    await prisma.user.deleteMany({ where: { companyId: compId } });
    await prisma.company.deleteMany({ where: { id: compId } });
    await prisma.$disconnect();
  });

  // ── 1. ALGORITMO BIJETIVO E ROLLOVER DE CÓDIGO VISÍVEL ─────────────────────
  it('1. Deve formatar códigos curtos e executar a transição de F-A999999 para F-B000001 e F-Z999999 para F-AA000001', () => {
    assert.equal(generateVisibleCode(0), 'F-A000001');
    assert.equal(generateVisibleCode(1), 'F-A000002');
    assert.equal(generateVisibleCode(999998), 'F-A999999');

    // Transição A -> B
    assert.equal(generateVisibleCode(999999), 'F-B000001');
    assert.equal(generateVisibleCode(1000000), 'F-B000002');
    assert.equal(generateVisibleCode(2 * 999999 - 1), 'F-B999999');

    // Transição B -> C
    assert.equal(generateVisibleCode(2 * 999999), 'F-C000001');

    // Fim da primeira volta do alfabeto: Z -> AA
    const counterZLast = 25 * 999999 + 999998;
    assert.equal(generateVisibleCode(counterZLast), 'F-Z999999');

    const counterAAFirst = 26 * 999999;
    assert.equal(generateVisibleCode(counterAAFirst), 'F-AA000001');

    const counterABFirst = 27 * 999999;
    assert.equal(generateVisibleCode(counterABFirst), 'F-AB000001');
  });

  // ── 2. PROTEÇÃO CONTRA CONCORRÊNCIA NA GERAÇÃO DO CÓDIGO ──────────────────
  it('2. Deve gerar códigos visíveis estritamente únicos sob 20 requisições simultâneas concorrentes', async () => {
    const promises = Array.from({ length: 20 }, () =>
      prisma.$transaction(async (tx) => {
        return await getNextVisibleCode(tx);
      })
    );

    const generatedCodes = await Promise.all(promises);
    assert.equal(generatedCodes.length, 20);

    const uniqueSet = new Set(generatedCodes);
    assert.equal(uniqueSet.size, 20, 'Nenhum código pode ser repetido em chamadas concorrentes');

    for (const code of generatedCodes) {
      assert.match(code, /^F-[A-Z]+[0-9]{6}$/, `Código deve seguir o padrão: ${code}`);
    }
  });

  // ── 3. REENVIO SEM DUPLICAÇÃO (IDEMPOTÊNCIA POR UUID) ─────────────────────
  it('3. Deve reconhecer a mesma ficha pelo UUID em retentativas sem criar duplicata nem sobrescrever outro cliente', async () => {
    const fichaUuid = uuidv4();
    const payload = {
      uuid: fichaUuid,
      localId: fichaUuid,
      sequenceNumber: '0001-EVENTO-CIDADE-0001',
      name: 'Cliente Original',
      city: 'Brasília',
      phone1: '61999990001',
      event: 'Casamento 2026',
    };

    // Primeiro envio
    const res1 = await fetch(`${baseUrl}/clients/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPhotog}` },
      body: JSON.stringify({ clients: [payload] }),
    });
    const data1: any = await res1.json();
    assert.equal(data1.success, 1);
    assert.equal(data1.details[0].uuid, fichaUuid);
    const visibleCode = data1.details[0].visibleCode;
    const clientId = data1.details[0].id;
    assert.ok(visibleCode);
    assert.ok(clientId);

    // Segundo envio (retentativa com payload idêntico)
    const res2 = await fetch(`${baseUrl}/clients/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPhotog}` },
      body: JSON.stringify({ clients: [payload] }),
    });
    const data2: any = await res2.json();
    assert.equal(data2.success, 1);
    assert.equal(data2.details[0].id, clientId, 'Deve retornar o mesmo ID interno');
    assert.equal(data2.details[0].uuid, fichaUuid, 'Deve manter o mesmo UUID');
    assert.equal(data2.details[0].visibleCode, visibleCode, 'Deve manter o mesmo visibleCode');

    // Terceiro envio (retentativa com atualização permitida em CREATED)
    const res3 = await fetch(`${baseUrl}/clients/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPhotog}` },
      body: JSON.stringify({ clients: [{ ...payload, name: 'Cliente Original Atualizado' }] }),
    });
    const data3: any = await res3.json();
    assert.equal(data3.success, 1);
    assert.equal(data3.details[0].id, clientId);

    // Verificação no banco de dados: apenas 1 cliente existe com este UUID
    const countInDb = await prisma.client.count({ where: { uuid: fichaUuid } });
    assert.equal(countInDb, 1, 'Banco deve conter exatamente 1 registro para o UUID');

    const clientInDb = await prisma.client.findUnique({ where: { uuid: fichaUuid } });
    assert.equal(clientInDb?.name, 'Cliente Original Atualizado');
    assert.equal(clientInDb?.visibleCode, visibleCode);
  });

  // ── 4. LEITURA POLIMÓRFICA DE QR CODE (NOVO UUID, VISIBLE CODE E LEGADO) ───
  it('4. Deve localizar fichas no leitor de QR e busca por UUID permanente, código visível e sequenceNumber legado', async () => {
    // 1. Ficha Nova com UUID e visibleCode
    const newUuid = uuidv4();
    const resSync = await fetch(`${baseUrl}/clients/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPhotog}` },
      body: JSON.stringify({
        clients: [
          {
            uuid: newUuid,
            sequenceNumber: '0001-NEW-BSB-0002',
            name: 'Ficha Nova UUID',
            city: 'Goiânia',
          },
        ],
      }),
    });
    const syncData: any = await resSync.json();
    const newVisibleCode = syncData.details[0].visibleCode;

    // 2. Ficha Legada diretamente no banco (apenas sequenceNumber, visibleCode nulo)
    const legacyId = uuidv4();
    const legacySeq = '0001-LEGADO-BSB-9999';
    await prisma.client.create({
      data: {
        id: legacyId,
        uuid: legacyId,
        sequenceNumber: legacySeq,
        visibleCode: null,
        name: 'Ficha Histórica Legada',
        companyId: compId,
        bookStatus: 'IN_STOCK',
      },
    });

    // Busca 1: Leitura do QR Code com o UUID permanente
    const resSearchUuid = await fetch(`${baseUrl}/books/search?q=${newUuid}`, {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    const searchUuidData: any = await resSearchUuid.json();
    assert.equal(searchUuidData.length, 1);
    assert.equal(searchUuidData[0].uuid, newUuid);

    // Busca 2: Leitura/Digitação do código visível curto (ex: F-A000001)
    const resSearchCode = await fetch(`${baseUrl}/books/search?q=${newVisibleCode}`, {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    const searchCodeData: any = await resSearchCode.json();
    assert.equal(searchCodeData.length, 1);
    assert.equal(searchCodeData[0].visibleCode, newVisibleCode);

    // Busca 3: Leitura de QR Code antigo impresso com sequenceNumber legado
    const resSearchLegacy = await fetch(`${baseUrl}/books/search?q=${legacySeq}`, {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    const searchLegacyData: any = await resSearchLegacy.json();
    assert.equal(searchLegacyData.length, 1);
    assert.equal(searchLegacyData[0].id, legacyId);
    assert.equal(searchLegacyData[0].sequenceNumber, legacySeq);
  });

  // ── 5. PRESERVAÇÃO DE VÍNCULOS DURANTE O CICLO COMPLETO E REBOLO ───────────
  it('5. Deve preservar identidade permanente, anexos, vendas e timeline durante distribuição, troca de vendedor, devolução e rebolo', async () => {
    const permanentUuid = uuidv4();

    // 1. Cadastro da Ficha com UUID
    const resCreate = await fetch(`${baseUrl}/clients/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPhotog}` },
      body: JSON.stringify({
        clients: [
          {
            uuid: permanentUuid,
            sequenceNumber: '0001-REBOLO-BSB-0001',
            name: 'Cliente Rebolo Total',
            city: 'Anápolis',
            children: [{ name: 'Filho 1', age: 7 }],
          },
        ],
      }),
    });
    const createData: any = await resCreate.json();
    const clientId = createData.details[0].id;
    const clientVisibleCode = createData.details[0].visibleCode;
    assert.ok(clientId);

    // Colocar em estoque para distribuição
    await prisma.client.update({
      where: { id: clientId },
      data: { bookStatus: 'IN_STOCK' },
    });

    // 2. Admin distribui para Vendedor 1 usando QR Code (UUID permanente)
    const resDist1 = await fetch(`${baseUrl}/clients/assign-seller`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ identifier: permanentUuid, sellerId: seller1Id }),
    });
    assert.equal(resDist1.status, 200);

    let client = await prisma.client.findUnique({ where: { id: clientId } });
    assert.equal(client?.bookStatus, 'DISTRIBUTED');
    assert.equal(client?.assignedSellerId, seller1Id);

    // 3. Vendedor 1 registra Não Venda (Ciclo 1)
    const resNonSale = await fetch(`${baseUrl}/sales/non-sale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenSeller1}` },
      body: JSON.stringify({
        clientId,
        reason: 'Cliente sem recursos no momento',
        city: 'Anápolis',
        signatureBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      }),
    });
    assert.equal(resNonSale.status, 201);

    client = await prisma.client.findUnique({ where: { id: clientId } });
    assert.equal(client?.bookStatus, 'AWAITING_RETURN');

    // 4. Admin recebe devolução usando QR Code (UUID permanente) -> transiciona para IN_STOCK_REBOLO (Ciclo 2)
    const resReceive = await fetch(`${baseUrl}/books/receive-return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ identifier: permanentUuid }),
    });
    assert.equal(resReceive.status, 200);

    client = await prisma.client.findUnique({ where: { id: clientId } });
    assert.equal(client?.bookStatus, 'IN_STOCK_REBOLO');
    assert.equal(client?.commercialCycle, 2);
    assert.equal(client?.assignedSellerId, null);

    // 5. Admin repassa como Rebolo para Vendedor 2 usando o Código Visível (ex: F-A000001)
    const resDist2 = await fetch(`${baseUrl}/clients/assign-seller`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ identifier: clientVisibleCode, sellerId: seller2Id }),
    });
    assert.equal(resDist2.status, 200);

    client = await prisma.client.findUnique({ where: { id: clientId } });
    assert.equal(client?.bookStatus, 'DISTRIBUTED_REBOLO');
    assert.equal(client?.assignedSellerId, seller2Id);

    // 6. Vendedor 2 registra Venda de Rebolo com comprovantes completos
    const formSale = new FormData();
    formSale.set('clientId', clientId);
    formSale.set('value', '450');
    formSale.set('city', 'Anápolis');
    formSale.set('product', 'Álbum Completo Rebolo');
    formSale.set('paymentMethod', 'PIX');
    formSale.set('receipt', new Blob([Buffer.from('fake-receipt-bytes')], { type: 'image/jpeg' }), 'rec.jpg');
    formSale.set('sheetPhoto', new Blob([Buffer.from('fake-sheet-bytes')], { type: 'image/jpeg' }), 'sheet.jpg');

    const resSale = await fetch(`${baseUrl}/sales/with-receipt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenSeller2}` },
      body: formSale,
    });
    assert.equal(resSale.status, 201);

    client = await prisma.client.findUnique({
      where: { id: clientId },
      include: { children: true, nonSales: true, sales: true, timeline: true },
    });

    // Verificações finais de integridade absoluta:
    assert.equal(client?.id, clientId, 'ID interno deve ser estritamente preservado');
    assert.equal(client?.uuid, permanentUuid, 'UUID permanente deve ser idêntico');
    assert.equal(client?.visibleCode, clientVisibleCode, 'Código visível deve ser idêntico');
    assert.equal(client?.bookStatus, 'REBOLO_SOLD');
    assert.equal(client?.children.length, 1);
    assert.equal(client?.nonSales.length, 1, 'Não venda anterior deve permanecer vinculada');
    assert.equal(client?.sales.length, 1, 'Venda de rebolo deve estar vinculada');
    assert.ok((client?.timeline.length ?? 0) >= 4, 'Todo o histórico de timeline deve ser mantido');
  });
});
