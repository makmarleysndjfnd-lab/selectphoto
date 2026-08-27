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
import salesRoutes from '../src/routes/sales';
import { runReconciliationAnalysis } from '../scripts/reconcile-legacy-sales';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET;

describe('CENÁRIOS DE VENDA, COMPROVANTE E RECONCILIAÇÃO (HOTFIX 1.0.8)', { concurrency: 1 }, () => {
  let app: express.Application;
  let server: any;
  let baseUrl: string;

  const compId = `comp-rec-${uuidv4().substring(0, 8)}`;
  const sellerA_Id = `seller-a-${uuidv4().substring(0, 8)}`;
  const sellerB_Id = `seller-b-${uuidv4().substring(0, 8)}`;

  const tokenSellerA = jwt.sign(
    { id: sellerA_Id, companyId: compId, role: 'SELLER', email: 'sellerA@test.com' },
    JWT_SECRET
  );
  const tokenSellerB = jwt.sign(
    { id: sellerB_Id, companyId: compId, role: 'SELLER', email: 'sellerB@test.com' },
    JWT_SECRET
  );

  before(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/sales', salesRoutes);

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
        name: 'Empresa Reconciliação Teste',
        cnpj: `cnpj-${uuidv4().substring(0, 8)}`,
      },
    });

    await prisma.user.createMany({
      data: [
        {
          id: sellerA_Id,
          name: 'Vendedor A',
          email: `${sellerA_Id}@test.com`,
          password: 'hash',
          role: 'SELLER',
          companyId: compId,
        },
        {
          id: sellerB_Id,
          name: 'Vendedor B',
          email: `${sellerB_Id}@test.com`,
          password: 'hash',
          role: 'SELLER',
          companyId: compId,
        },
      ],
    });
  });

  after(async () => {
    if (server) await new Promise<void>((resolve) => server.close(resolve));
    await prisma.sale.deleteMany({ where: { companyId: compId } });
    await prisma.client.deleteMany({ where: { companyId: compId } });
    await prisma.user.deleteMany({ where: { companyId: compId } });
    await prisma.company.deleteMany({ where: { id: compId } });
    await prisma.$disconnect();
  });

  function createSaleFormData(clientId: string, value = 450) {
    const fd = new FormData();
    fd.set('clientId', clientId);
    fd.set('value', String(value));
    fd.set('city', 'Londrina');
    fd.set('product', 'Book Completo');
    fd.set('receipt', new Blob([Buffer.from('fake-receipt-content')], { type: 'image/jpeg' }), 'comprovante.jpg');
    return fd;
  }

  it('1. Ficha limpa + comprovante: cria uma venda completa e marca ficha vendida', async () => {
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ-LIMPA-${uuidv4().substring(0, 6)}`,
        name: 'Cliente Ficha Limpa',
        city: 'Londrina',
        companyId: compId,
        assignedSellerId: sellerA_Id,
        outcomeStatus: 'PENDING',
        bookStatus: 'DISTRIBUTED',
      },
    });

    const res = await fetch(`${baseUrl}/api/sales/with-receipt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenSellerA}` },
      body: createSaleFormData(client.id, 500),
    });

    assert.equal(res.status, 201);
    const sale = await res.json();
    assert.equal(sale.paymentStatus, 'PAID');
    assert.equal(sale.status, 'PRONTO');
    assert.ok(sale.receiptUrl);

    const updatedClient = await prisma.client.findUnique({ where: { id: client.id } });
    assert.equal(updatedClient?.outcomeStatus, 'SOLD');
    assert.equal(updatedClient?.bookStatus, 'SOLD');
  });

  it('2. Retentativa idêntica: retorna a mesma venda sem duplicar registro', async () => {
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ-RETRY-${uuidv4().substring(0, 6)}`,
        name: 'Cliente Retentativa Idêntica',
        city: 'Londrina',
        companyId: compId,
        assignedSellerId: sellerA_Id,
        outcomeStatus: 'PENDING',
        bookStatus: 'DISTRIBUTED',
      },
    });

    // Primeira chamada
    const res1 = await fetch(`${baseUrl}/api/sales/with-receipt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenSellerA}` },
      body: createSaleFormData(client.id, 600),
    });
    assert.equal(res1.status, 201);
    const sale1 = await res1.json();

    // Segunda chamada idêntica (retentativa)
    const res2 = await fetch(`${baseUrl}/api/sales/with-receipt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenSellerA}` },
      body: createSaleFormData(client.id, 600),
    });
    assert.equal(res2.status, 200, 'Retentativa idêntica deve retornar 200 OK');
    const sale2 = await res2.json();

    // Devolve o mesmo ID
    assert.equal(sale2.id, sale1.id);
    const totalSales = await prisma.sale.count({ where: { clientId: client.id } });
    assert.equal(totalSales, 1, 'Não pode haver duplicidade de venda no banco');
  });

  it('3. Uma venda incompleta antiga do mesmo vendedor: anexa comprovante e conclui com segurança', async () => {
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ-INCOMPL-${uuidv4().substring(0, 6)}`,
        name: 'Cliente Venda Incompleta',
        city: 'Londrina',
        companyId: compId,
        assignedSellerId: sellerA_Id,
        outcomeStatus: 'PENDING',
        bookStatus: 'DISTRIBUTED',
      },
    });

    // Cria venda legada antiga sem comprovante (receiptUrl: null)
    const legacySale = await prisma.sale.create({
      data: {
        clientId: client.id,
        sellerId: sellerA_Id,
        companyId: compId,
        value: 300,
        city: 'Londrina',
        status: 'PENDING_RECEIPT',
        paymentStatus: 'PENDING_RECEIPT',
        receiptUrl: null,
      },
    });

    const res = await fetch(`${baseUrl}/api/sales/with-receipt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenSellerA}` },
      body: createSaleFormData(client.id, 350),
    });

    assert.equal(res.status, 201);
    const finalSale = await res.json();
    assert.equal(finalSale.id, legacySale.id, 'Deve reaproveitar e atualizar o registro existente');
    assert.equal(finalSale.paymentStatus, 'PAID');
    assert.ok(finalSale.receiptUrl);

    const totalSales = await prisma.sale.count({ where: { clientId: client.id } });
    assert.equal(totalSales, 1, 'Não pode criar nova venda se já havia uma incompleta do mesmo vendedor');

    const updatedClient = await prisma.client.findUnique({ where: { id: client.id } });
    assert.equal(updatedClient?.outcomeStatus, 'SOLD');
  });

  it('4. Mais de uma venda incompleta para a mesma ficha: rejeita com LEGACY_SALE_REQUIRES_RECONCILIATION', async () => {
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ-MULTI-LEGACY-${uuidv4().substring(0, 6)}`,
        name: 'Cliente Duplicidade Legada',
        city: 'Londrina',
        companyId: compId,
        assignedSellerId: sellerA_Id,
        outcomeStatus: 'PENDING',
        bookStatus: 'AWAITING_RETURN',
      },
    });

    // Cria duas vendas incompletas antigas para a mesma ficha
    await prisma.sale.createMany({
      data: [
        {
          clientId: client.id,
          sellerId: sellerA_Id,
          companyId: compId,
          value: 400,
          city: 'Londrina',
          status: 'PENDING_RECEIPT',
          paymentStatus: 'PENDING_RECEIPT',
          receiptUrl: null,
        },
        {
          clientId: client.id,
          sellerId: sellerA_Id,
          companyId: compId,
          value: 450,
          city: 'Londrina',
          status: 'PENDING_RECEIPT',
          paymentStatus: 'PENDING_RECEIPT',
          receiptUrl: null,
        },
      ],
    });

    const res = await fetch(`${baseUrl}/api/sales/with-receipt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenSellerA}` },
      body: createSaleFormData(client.id, 500),
    });

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, 'LEGACY_SALE_REQUIRES_RECONCILIATION');

    // Nenhuma terceira venda deve ter sido criada
    const totalSales = await prisma.sale.count({ where: { clientId: client.id } });
    assert.equal(totalSales, 2);
  });

  it('5. Vendedor diferente tentando registrar venda em ficha com venda de outro: bloqueia sem vazar dados', async () => {
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SEQ-DIFF-SELLER-${uuidv4().substring(0, 6)}`,
        name: 'Cliente Outro Vendedor',
        city: 'Londrina',
        companyId: compId,
        assignedSellerId: sellerA_Id,
        outcomeStatus: 'PENDING',
        bookStatus: 'DISTRIBUTED',
      },
    });

    // Vendedor A registra venda com comprovante
    const resA = await fetch(`${baseUrl}/api/sales/with-receipt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenSellerA}` },
      body: createSaleFormData(client.id, 700),
    });
    assert.equal(resA.status, 201);

    // Vendedor B tenta registrar venda na mesma ficha
    const resB = await fetch(`${baseUrl}/api/sales/with-receipt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenSellerB}` },
      body: createSaleFormData(client.id, 750),
    });

    assert.equal(resB.status, 409);
    const body = await resB.json();
    assert.equal(body.code, 'SALE_ALREADY_EXISTS');
  });

  it('6. Script de reconciliação gera relatório detalhado em modo somente leitura sem alterar banco', async () => {
    const report = await runReconciliationAnalysis(prisma);

    assert.equal(report.isReadOnly, true);
    assert.ok(typeof report.totalSalesCount === 'number');
    assert.ok(typeof report.salesWithReceiptCount === 'number');
    assert.ok(typeof report.salesWithoutReceiptCount === 'number');
    assert.ok(Array.isArray(report.details));

    for (const d of report.details) {
      assert.ok(d.suggestedAction.length > 0);
      assert.ok(d.pendingDecision.length > 0);
      // Garantir mascaramento (não expor dados brutos completos)
      assert.ok(d.clientMaskedId.includes('***'));
    }
  });
});
