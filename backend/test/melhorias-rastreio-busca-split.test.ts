import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

import salesRouter from '../src/routes/sales';
import clientsRouter from '../src/routes/clients';
import booksRouter from '../src/routes/books';
import closingRouter from '../src/routes/closing';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

describe('MELHORIAS OPERACIONAIS: RASTREIO, BUSCA E PAGAMENTO DIVIDIDO', () => {
  let app: express.Application;
  let server: any;
  let baseUrl: string;

  const compId = `comp-melhorias-${uuidv4()}`;
  const adminId = `admin-${uuidv4()}`;
  const photogId = `photog-${uuidv4()}`;
  const sellerId = `seller-${uuidv4()}`;

  let tokenAdmin: string;
  let tokenSeller: string;

  before(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/sales', salesRouter);
    app.use('/api/clients', clientsRouter);
    app.use('/api/books', booksRouter);
    app.use('/api/closing', closingRouter);

    server = app.listen(0);
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;

    await prisma.company.create({
      data: { id: compId, name: 'Empresa Teste Melhorias' },
    });

    await prisma.user.createMany({
      data: [
        { id: adminId, name: 'Admin Geral', email: `admin-${uuidv4()}@test.com`, role: 'ADMIN', companyId: compId, password: 'hash' },
        { id: photogId, name: 'Fotógrafo Carlos', email: `photog-${uuidv4()}@test.com`, role: 'PHOTOGRAPHER', companyId: compId, password: 'hash' },
        { id: sellerId, name: 'Vendedor João', email: `seller-${uuidv4()}@test.com`, role: 'SELLER', companyId: compId, password: 'hash' },
      ],
    });

    tokenAdmin = jwt.sign({ id: adminId, role: 'ADMIN', companyId: compId }, JWT_SECRET);
    tokenSeller = jwt.sign({ id: sellerId, role: 'SELLER', companyId: compId }, JWT_SECRET);
  });

  after(async () => {
    if (server) await new Promise<void>((resolve) => server.close(resolve));
    await prisma.salePayment.deleteMany({ where: { sale: { companyId: compId } } }).catch(() => {});
    await prisma.sale.deleteMany({ where: { companyId: compId } }).catch(() => {});
    await prisma.dailyClosing.deleteMany({ where: { sellerId } }).catch(() => {});
    await prisma.clientTimeline.deleteMany({ where: { client: { companyId: compId } } }).catch(() => {});
    await prisma.child.deleteMany({ where: { client: { companyId: compId } } }).catch(() => {});
    await prisma.client.deleteMany({ where: { companyId: compId } }).catch(() => {});
    await prisma.bookBatch.deleteMany({ where: { companyId: compId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { companyId: compId } }).catch(() => {});
    await prisma.company.deleteMany({ where: { id: compId } }).catch(() => {});
    await prisma.$disconnect();
  });

  describe('1. Rastreio e Distribuição Parcial de Lotes', () => {
    it('deve manter um único lote com contadores de estoque e vendedor após distribuição parcial', async () => {
      const batch = await prisma.bookBatch.create({
        data: {
          name: 'Lote Escola Sol',
          photographerId: photogId,
          companyId: compId,
          status: 'IN_STOCK',
        },
      });

      const c1 = await prisma.client.create({
        data: {
          sequenceNumber: 'SOL-001',
          name: 'Maria Responsável',
          city: 'Goiânia',
          batchId: batch.id,
          companyId: compId,
          bookStatus: 'IN_STOCK',
        },
      });

      const c2 = await prisma.client.create({
        data: {
          sequenceNumber: 'SOL-002',
          name: 'Pedro Responsável',
          city: 'Anápolis',
          batchId: batch.id,
          companyId: compId,
          bookStatus: 'IN_STOCK',
        },
      });

      // Distribui apenas c1 para o vendedor João
      const resAssign = await fetch(`${baseUrl}/api/clients/batch-assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}` },
        body: JSON.stringify({
          clientIds: [c1.id],
          assignedSellerId: sellerId,
        }),
      });
      assert.equal(resAssign.status, 200);

      // Consulta os lotes
      const resBatches = await fetch(`${baseUrl}/api/books/batch`, {
        headers: { Authorization: `Bearer ${tokenAdmin}` },
      });
      assert.equal(resBatches.status, 200);
      const batches = await resBatches.json();
      const solBatch = batches.find((b: any) => b.id === batch.id);

      assert.ok(solBatch, 'Lote original deve existir sem duplicação');
      assert.equal(solBatch.clients.length, 2);

      const inStockCount = solBatch.clients.filter((c: any) => c.bookStatus === 'IN_STOCK').length;
      const distributedCount = solBatch.clients.filter((c: any) => c.bookStatus === 'DISTRIBUTED').length;

      assert.equal(inStockCount, 1, 'Deve ter exatamente 1 em estoque');
      assert.equal(distributedCount, 1, 'Deve ter exatamente 1 com vendedor');
      assert.notEqual(solBatch.status, 'DISTRIBUTED', 'O lote inteiro não deve ser marcado como entregue');
    });
  });

  describe('2. Busca de Fichas (Admin e Vendedor)', () => {
    it('deve localizar ficha pelo nome da criança e pelo nome do responsável insensível a maiúsculas', async () => {
      const client = await prisma.client.create({
        data: {
          sequenceNumber: 'BUSCA-001',
          visibleCode: 'CF-BSB-101',
          name: 'Ana Carolina Pereira', // Responsável
          mainContact: 'Tia Fernanda',
          city: 'Brasília',
          companyId: compId,
          bookStatus: 'DISTRIBUTED',
          assignedSellerId: sellerId,
          children: {
            create: [
              { name: 'Lucas Gabriel Pereira', age: 7 },
            ],
          },
        },
      });

      // Busca por parte do nome da criança: "lucas"
      const resSearchChild = await fetch(`${baseUrl}/api/books/search?q=lucas`, {
        headers: { Authorization: `Bearer ${tokenAdmin}` },
      });
      assert.equal(resSearchChild.status, 200);
      const resultsChild = await resSearchChild.json();
      assert.ok(resultsChild.some((r: any) => r.id === client.id), 'Deve encontrar a ficha pela criança');

      const found = resultsChild.find((r: any) => r.id === client.id);
      assert.equal(found.visibleCode, 'CF-BSB-101');
      assert.equal(found.name, 'Ana Carolina Pereira');
      assert.ok(found.currentCustodian.includes('João'), 'Deve indicar que está com o vendedor João');

      // Busca por parte do nome do responsável: "carolina"
      const resSearchParent = await fetch(`${baseUrl}/api/books/search?q=carolina`, {
        headers: { Authorization: `Bearer ${tokenSeller}` },
      });
      assert.equal(resSearchParent.status, 200);
      const resultsParent = await resSearchParent.json();
      assert.ok(resultsParent.some((r: any) => r.id === client.id), 'Deve encontrar a ficha pelo responsável');
    });
  });

  describe('3. Pagamento Dividido e Validações Monetárias', () => {
    it('deve rejeitar venda quando a soma das parcelas for diferente do valor total da venda', async () => {
      const client = await prisma.client.create({
        data: {
          sequenceNumber: 'VAL-001',
          name: 'Cliente Soma Incorreta',
          city: 'Goiânia',
          companyId: compId,
          bookStatus: 'DISTRIBUTED',
          assignedSellerId: sellerId,
        },
      });

      // Venda de 1000,00 com soma de parcelas 300 + 600 = 900 (falta 100)
      const resInvalid = await fetch(`${baseUrl}/api/sales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenSeller}` },
        body: JSON.stringify({
          clientId: client.id,
          city: 'Goiânia',
          value: 1000.0,
          payments: [
            { method: 'CASH', amount: 300.0 },
            { method: 'CREDIT', amount: 600.0 },
          ],
        }),
      });

      assert.equal(resInvalid.status, 400);
      const errData = await resInvalid.json();
      assert.ok(errData.error.includes('deve corresponder exatamente ao valor da venda'));
    });

    it('deve persistir corretamente venda com duas formas de pagamento e computar no fechamento', async () => {
      const client = await prisma.client.create({
        data: {
          sequenceNumber: 'SPLIT-001',
          name: 'Cliente Pagamento Dividido',
          city: 'Goiânia',
          companyId: compId,
          bookStatus: 'DISTRIBUTED',
          assignedSellerId: sellerId,
        },
      });

      // Venda de R$ 1.000,00 dividida: Dinheiro R$ 300,00 e Cartão de Crédito R$ 700,00
      const resValid = await fetch(`${baseUrl}/api/sales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenSeller}` },
        body: JSON.stringify({
          clientId: client.id,
          city: 'Goiânia',
          value: 1000.0,
          payments: [
            { method: 'CASH', amount: 300.0 },
            { method: 'CREDIT', amount: 700.0 },
          ],
        }),
      });

      assert.equal(resValid.status, 201);
      const sale = await resValid.json();
      assert.equal(sale.paymentMethod, 'SPLIT');
      assert.equal(sale.value, 1000.0);

      // Verifica persistência das parcelas em SalePayment
      const persistedPayments = await prisma.salePayment.findMany({
        where: { saleId: sale.id },
      });
      assert.equal(persistedPayments.length, 2);
      const cashP = persistedPayments.find((p) => p.method === 'CASH');
      const credP = persistedPayments.find((p) => p.method === 'CREDIT');
      assert.equal(cashP?.amount, 300.0);
      assert.equal(credP?.amount, 700.0);

      // Simula comprovante e recalcula fechamento
      await prisma.sale.update({
        where: { id: sale.id },
        data: { receiptUrl: 'https://storage.exemplo.com/receipt.jpg' },
      });

      const today = new Date().toISOString().split('T')[0];
      const resClosing = await fetch(`${baseUrl}/api/closing/daily/${sellerId}?date=${today}`, {
        headers: { Authorization: `Bearer ${tokenSeller}` },
      });
      const closingBody = await resClosing.text();
      if (resClosing.status !== 200) {
        console.error('ERRO NO CLOSING:', resClosing.status, closingBody);
      }
      assert.equal(resClosing.status, 200);
      const closing = JSON.parse(closingBody);

      assert.equal(closing.cashValue, 300.0, 'Dinheiro em mãos deve ser exatamente R$ 300,00');
      assert.equal(closing.creditValue, 700.0, 'Cartão de crédito deve ser exatamente R$ 700,00');
      assert.equal(closing.totalSalesValue, 1000.0, 'Total vendido não deve ser duplicado');
    });
  });
});
