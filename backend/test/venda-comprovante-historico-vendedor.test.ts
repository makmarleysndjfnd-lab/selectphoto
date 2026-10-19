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

describe('VALIDAÇÃO FOCADA: VENDA SOMENTE COM COMPROVANTE E HISTÓRICO POR VENDEDOR/PERÍODO', { concurrency: 1 }, () => {
  let app: express.Application;
  let server: any;
  let baseUrl: string;

  const compId = `comp-test-sale-${uuidv4().substring(0, 8)}`;
  const adminId = `admin-${uuidv4().substring(0, 8)}`;
  const seller1Id = `seller-1-${uuidv4().substring(0, 8)}`;
  const seller2Id = `seller-2-${uuidv4().substring(0, 8)}`;

  const tokenAdmin = jwt.sign(
    { id: adminId, companyId: compId, role: 'ADMIN', email: `admin_${compId}@test.com` },
    JWT_SECRET!
  );
  const tokenSeller1 = jwt.sign(
    { id: seller1Id, companyId: compId, role: 'SELLER', email: `seller1_${compId}@test.com` },
    JWT_SECRET!
  );
  const tokenSeller2 = jwt.sign(
    { id: seller2Id, companyId: compId, role: 'SELLER', email: `seller2_${compId}@test.com` },
    JWT_SECRET!
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
        name: 'Empresa Teste Venda Comprovante',
      },
    });

    await prisma.user.createMany({
      data: [
        {
          id: adminId,
          name: 'Administrador Master',
          email: `admin_${compId}@test.com`,
          role: 'ADMIN',
          companyId: compId,
          password: 'hash',
        },
        {
          id: seller1Id,
          name: 'Vendedora Paula',
          email: `seller1_${compId}@test.com`,
          role: 'SELLER',
          companyId: compId,
          password: 'hash',
        },
        {
          id: seller2Id,
          name: 'Vendedor Roberto',
          email: `seller2_${compId}@test.com`,
          role: 'SELLER',
          companyId: compId,
          password: 'hash',
        },
      ],
    });
  });

  after(async () => {
    if (server) await new Promise<void>((resolve) => server.close(resolve));
    await prisma.salePayment.deleteMany({ where: { sale: { companyId: compId } } }).catch(() => {});
    await prisma.sale.deleteMany({ where: { companyId: compId } }).catch(() => {});
    await prisma.clientTimeline.deleteMany({ where: { client: { companyId: compId } } }).catch(() => {});
    await prisma.child.deleteMany({ where: { client: { companyId: compId } } }).catch(() => {});
    await prisma.client.deleteMany({ where: { companyId: compId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { companyId: compId } }).catch(() => {});
    await prisma.company.deleteMany({ where: { id: compId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('1. Deve concluir venda somente com foto do comprovante, sem sheetPhoto (isLegacy: false)', async () => {
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `CLI-${uuidv4().substring(0, 6)}`,
        name: 'Cliente Sem Foto Da Folha',
        city: 'Maringá',
        companyId: compId,
        assignedSellerId: seller1Id,
        bookStatus: 'DISTRIBUTED',
        outcomeStatus: 'PENDING',
      },
    });

    const form = new FormData();
    form.set('clientId', client.id);
    form.set('value', '600.00');
    form.set('city', 'Maringá');
    form.set('product', 'Book + Mídias');
    form.set('receipt', new Blob([Buffer.from('fake-receipt-content')], { type: 'image/jpeg' }), 'comprovante.jpg');

    const res = await fetch(`${baseUrl}/api/sales/with-receipt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenSeller1}` },
      body: form,
    });

    assert.equal(res.status, 201);
    const saleData = await res.json();
    assert.ok(saleData.id);

    const sale = await prisma.sale.findUnique({
      where: { id: saleData.id },
      include: { payments: true },
    });
    assert.ok(sale);
    assert.ok(sale.receiptUrl);
    assert.equal(sale.sheetPhotoUrl, null, 'sheetPhotoUrl deve ser nulo pois não foi exigido');
    assert.equal(sale.isLegacy, false, 'Venda concluída com comprovante não é legada');
    assert.equal(sale.sellerId, seller1Id);
    assert.equal(sale.status, 'PRONTO');
    assert.equal(sale.paymentStatus, 'PAID');

    const clientAfter = await prisma.client.findUnique({ where: { id: client.id } });
    assert.equal(clientAfter?.outcomeStatus, 'SOLD');
  });

  it('2. Pagamento dividido com comprovante único e retentativa idempotente sem duplicação', async () => {
    const client = await prisma.client.create({
      data: {
        sequenceNumber: `SPLIT-${uuidv4().substring(0, 6)}`,
        name: 'Cliente Pagamento Dividido',
        city: 'Cascavel',
        companyId: compId,
        assignedSellerId: seller2Id,
        bookStatus: 'DISTRIBUTED',
        outcomeStatus: 'PENDING',
      },
    });

    const payments = [
      { method: 'PIX', amount: 300.0 },
      { method: 'CREDIT', amount: 450.0 },
    ];

    const form = new FormData();
    form.set('clientId', client.id);
    form.set('value', '750.00');
    form.set('city', 'Cascavel');
    form.set('product', 'Book Completo');
    form.set('paymentMethod', 'SPLIT');
    form.set('payments', JSON.stringify(payments));
    form.set('receipt', new Blob([Buffer.from('single-receipt')], { type: 'image/jpeg' }), 'comprovante_unico.jpg');

    // Primeira tentativa
    const res1 = await fetch(`${baseUrl}/api/sales/with-receipt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenSeller2}` },
      body: form,
    });
    assert.equal(res1.status, 201);
    const sale1 = await res1.json();

    const paymentsInDb = await prisma.salePayment.findMany({ where: { saleId: sale1.id } });
    assert.equal(paymentsInDb.length, 2, 'Deve registrar exatamente 2 parcelas');

    // Retentativa idempotente com os mesmos dados comerciais (simulando timeout de rede)
    const formRetry = new FormData();
    formRetry.set('clientId', client.id);
    formRetry.set('value', '750.00');
    formRetry.set('city', 'Cascavel');
    formRetry.set('product', 'Book Completo');
    formRetry.set('paymentMethod', 'SPLIT');
    formRetry.set('payments', JSON.stringify(payments));
    formRetry.set('receipt', new Blob([Buffer.from('single-receipt-retry')], { type: 'image/jpeg' }), 'comprovante_unico.jpg');

    const res2 = await fetch(`${baseUrl}/api/sales/with-receipt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenSeller2}` },
      body: formRetry,
    });
    assert.equal(res2.status, 200, 'Retentativa idempotente deve retornar 200');
    const sale2 = await res2.json();
    assert.equal(sale2.id, sale1.id, 'Deve retornar a mesma venda');

    const totalSales = await prisma.sale.count({ where: { clientId: client.id } });
    assert.equal(totalSales, 1, 'Não deve criar venda duplicada');

    const paymentsAfterRetry = await prisma.salePayment.findMany({ where: { saleId: sale1.id } });
    assert.equal(paymentsAfterRetry.length, 2, 'Não deve duplicar parcelas de pagamento');
  });

  it('3. Consulta ao histórico com filtro de data abrangendo integralmente o último dia (23:59:59.999)', async () => {
    // Venda de ontem
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(14, 0, 0, 0);

    const clientYesterday = await prisma.client.create({
      data: {
        sequenceNumber: `HIST-YEST-${uuidv4().substring(0, 4)}`,
        name: 'Cliente Ontem',
        city: 'Londrina',
        companyId: compId,
        outcomeStatus: 'SOLD',
      },
    });

    await prisma.sale.create({
      data: {
        clientId: clientYesterday.id,
        sellerId: seller1Id,
        companyId: compId,
        value: 500,
        city: 'Londrina',
        product: 'Mídias',
        receiptUrl: 'https://exemplo.com/receipt-yesterday.jpg',
        date: yesterday,
      },
    });

    // Consulta filtrando apenas hoje (não deve trazer a venda de ontem)
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const resToday = await fetch(`${baseUrl}/api/sales/history?startDate=${todayStr}&endDate=${todayStr}`, {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    assert.equal(resToday.status, 200);
    const salesToday = await resToday.json();
    const foundYesterday = salesToday.find((s: any) => s.clientId === clientYesterday.id);
    assert.equal(foundYesterday, undefined, 'Venda de ontem não deve aparecer no filtro de hoje');

    // Consulta incluindo ontem até hoje: deve incluir
    const yestStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    const resRange = await fetch(`${baseUrl}/api/sales/history?startDate=${yestStr}&endDate=${todayStr}`, {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    assert.equal(resRange.status, 200);
    const salesRange = await resRange.json();
    const foundRange = salesRange.find((s: any) => s.clientId === clientYesterday.id);
    assert.ok(foundRange, 'Venda de ontem deve aparecer no intervalo');
    assert.equal(foundRange.seller?.name, 'Vendedora Paula', 'Vendedor da venda deve estar presente');
  });
});
