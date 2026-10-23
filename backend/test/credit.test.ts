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
const jwtSecret = envConfig.JWT_SECRET || 'test_secret_credit';

process.env.DATABASE_URL = databaseUrl;
process.env.JWT_SECRET = jwtSecret;
process.env.DISABLE_CRON = 'true';
process.env.EXTERNAL_SERVICES_DISABLED = 'true';
process.env.NODE_ENV = 'test';

import salesRoutes from '../src/routes/sales';
import creditRoutes from '../src/routes/credit';
import closingRoutes from '../src/routes/closing';
import financeRoutes from '../src/routes/finance';

const prisma = new PrismaClient();

function generateToken(payload: { id: string; role: string; companyId?: string; name?: string }) {
  return jwt.sign(payload, jwtSecret, { expiresIn: '1h' });
}

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use('/api/sales', salesRoutes);
  app.use('/api/credit', creditRoutes);
  app.use('/api/closing', closingRoutes);
  app.use('/api/finance', financeRoutes);
  return app;
}

describe('MÓDULO DE CREDIÁRIO INTERNO / PARCELADO — ENTREGA 1', { concurrency: 1 }, () => {
  const app = createTestApp();
  let server: any;
  let baseUrl: string;

  const uid = 'credit_' + Date.now();
  const companyId = `comp_${uid}`;
  const sellerId = `seller_${uid}`;
  const adminId = `admin_${uid}`;

  let sellerToken: string;
  let adminToken: string;

  let clientId: string;
  let validCpf = '52998224725'; // CPF válido padrão gerado por algoritmo

  before(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${(addr as any).port}`;
        resolve();
      });
    });

    await prisma.company.create({
      data: { id: companyId, name: 'Empresa Teste Crediário' },
    });

    await prisma.user.createMany({
      data: [
        {
          id: sellerId,
          companyId,
          email: `seller_${uid}@test.com`,
          name: 'Vendedor Crediário',
          role: 'SELLER',
          password: 'dummy',
          usesOwnCar: true, // 25% carro próprio (25% à vista e entrada)
        },
        {
          id: adminId,
          companyId,
          email: `admin_${uid}@test.com`,
          name: 'Admin Crediário',
          role: 'COMPANY_ADMIN',
          password: 'dummy',
        },
      ],
    });

    sellerToken = generateToken({ id: sellerId, role: 'SELLER', companyId, name: 'Vendedor Crediário' });
    adminToken = generateToken({ id: adminId, role: 'COMPANY_ADMIN', companyId, name: 'Admin Crediário' });

    const client = await prisma.client.create({
      data: {
        companyId,
        assignedSellerId: sellerId,
        sequenceNumber: `CRD_${uid}`,
        name: 'Cliente Responsável Silva',
        city: 'Curitiba',
        street: 'Rua das Flores',
        number: '123',
        neighborhood: 'Centro',
        state: 'PR',
        cep: '80000000',
        bookStatus: 'DISTRIBUTED',
        outcomeStatus: 'PENDING',
      },
    });
    clientId = client.id;
  });

  after(async () => {
    if (server) await new Promise<void>((r) => server.close(r));
    try {
      await prisma.creditCommission.deleteMany({ where: { companyId } });
      await prisma.creditPaymentAllocation.deleteMany({ where: { payment: { companyId } } });
      await prisma.creditPayment.deleteMany({ where: { companyId } });
      await prisma.creditInstallment.deleteMany({ where: { agreement: { companyId } } });
      await prisma.creditAgreement.deleteMany({ where: { companyId } });
      await prisma.salePayment.deleteMany({ where: { sale: { companyId } } });
      await prisma.sale.deleteMany({ where: { companyId } });
      await prisma.clientTimeline.deleteMany({ where: { client: { companyId } } });
      await prisma.client.deleteMany({ where: { companyId } });
      await prisma.user.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    } catch (_) {}
    await prisma.$disconnect();
  });

  it('1. Deve rejeitar venda a crediário com entrada inferior a R$ 150,00', async () => {
    const res = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sellerToken}`,
      },
      body: JSON.stringify({
        clientId,
        value: 1000,
        city: 'Curitiba',
        product: 'Book Completo',
        payments: [{ method: 'PIX', amount: 100 }], // Entrada de R$ 100 (< 150)
        credit: {
          buyerName: 'Cliente Silva',
          buyerCpf: validCpf,
          installmentsCount: 3,
        },
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /entrada.*150/i);
  });

  it('2. Deve rejeitar venda a crediário com CPF inválido', async () => {
    const res = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sellerToken}`,
      },
      body: JSON.stringify({
        clientId,
        value: 1000,
        city: 'Curitiba',
        product: 'Book Completo',
        payments: [{ method: 'PIX', amount: 200 }],
        credit: {
          buyerName: 'Cliente Silva',
          buyerCpf: '11111111111', // CPF inválido
          installmentsCount: 4,
        },
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /CPF/i);
  });

  let createdSaleId: string;
  let agreementId: string;

  it('3. Deve registrar com sucesso venda com crediário (R$ 1000 total, R$ 200 entrada, R$ 800 em 4x de R$ 200)', async () => {
    const res = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sellerToken}`,
      },
      body: JSON.stringify({
        clientId,
        value: 1000,
        city: 'Curitiba',
        product: 'Book Completo',
        payments: [
          { method: 'CASH', amount: 100 },
          { method: 'PIX', amount: 100 },
        ],
        credit: {
          buyerName: 'Cliente Responsável Silva',
          buyerCpf: validCpf,
          installmentsCount: 4,
          periodicity: 'MONTHLY',
          notes: 'Venda de teste crediário',
        },
      }),
    });

    assert.equal(res.status, 201);
    const sale = await res.json();
    createdSaleId = sale.id;

    assert.equal(sale.value, 1000);
    assert.equal(sale.paymentStatus, 'PARTIALLY_PAID');
    assert.equal(sale.paymentMethod, 'SPLIT');

    // Verificar CreditAgreement no banco
    const agreement = await prisma.creditAgreement.findUnique({
      where: { saleId: createdSaleId },
      include: {
        installments: { orderBy: { installmentNumber: 'asc' } },
        commissions: true,
      },
    });

    assert.ok(agreement, 'CreditAgreement deve ter sido criado');
    agreementId = agreement!.id;
    assert.equal(agreement!.totalSaleCents, 100000);
    assert.equal(agreement!.downPaymentCents, 20000);
    assert.equal(agreement!.financedPrincipalCents, 80000);
    assert.equal(agreement!.remainingPrincipalCents, 80000);
    assert.equal(agreement!.paidPrincipalCents, 0);
    assert.equal(agreement!.installmentsCount, 4);
    assert.equal(agreement!.status, 'ACTIVE');

    // Verificar 4 parcelas de R$ 200,00 (20000 centavos)
    assert.equal(agreement!.installments.length, 4);
    for (let i = 0; i < 4; i++) {
      assert.equal(agreement!.installments[i].installmentNumber, i + 1);
      assert.equal(agreement!.installments[i].amountCents, 20000);
      assert.equal(agreement!.installments[i].status, 'PENDING');
      assert.equal(agreement!.installments[i].paidCents, 0);
    }

    // Verificar comissão inicial de 25% sobre a entrada (25% de R$ 200 = R$ 50 = 5000 centavos)
    assert.equal(agreement!.commissions.length, 1);
    const initialComm = agreement!.commissions[0];
    assert.equal(initialComm.amountCents, 5000);
    assert.equal(initialComm.type, 'DOWN_PAYMENT');
    assert.equal(initialComm.status, 'RELEASED');
    assert.equal(initialComm.sellerId, sellerId);
  });

  let paymentId: string;

  it('4. Deve registrar pagamento de parcela com alocação FIFO e gerar 10% de comissão', async () => {
    const res = await fetch(`${baseUrl}/api/credit/agreements/${agreementId}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sellerToken}`,
      },
      body: JSON.stringify({
        amount: 200, // R$ 200 quita a parcela 1
        paymentMethod: 'CASH',
        destination: 'SELLER_HANDS',
        notes: 'Pagamento recebido em mãos pelo vendedor',
      }),
    });

    assert.equal(res.status, 201);
    const result = await res.json();
    paymentId = result.payment.id;

    assert.equal(result.payment.amountCents, 20000);
    assert.equal(result.remainingPrincipalCents, 60000); // 800 - 200 = 600
    assert.equal(result.remainingPrincipal, 600);

    // Parcela 1 deve estar PAID
    const inst1 = await prisma.creditInstallment.findFirst({
      where: { agreementId, installmentNumber: 1 },
    });
    assert.equal(inst1!.status, 'PAID');
    assert.equal(inst1!.paidCents, 20000);

    // Parcela 2 deve continuar PENDING
    const inst2 = await prisma.creditInstallment.findFirst({
      where: { agreementId, installmentNumber: 2 },
    });
    assert.equal(inst2!.status, 'PENDING');
    assert.equal(inst2!.paidCents, 0);

    // Comissão da parcela deve ser 10% de R$ 200 = R$ 20 (2000 centavos)
    const comm = await prisma.creditCommission.findFirst({
      where: { paymentId, type: 'INSTALLMENT' },
    });
    assert.ok(comm);
    assert.equal(comm!.amountCents, 2000);
    assert.equal(comm!.sellerId, sellerId);
    assert.equal(comm!.status, 'RELEASED');
  });

  it('5. Fechamento diário do vendedor deve discriminar crediário, comissões (25% entrada + 10% parcela) e repasse', async () => {
    // Simular que a venda e o pagamento têm comprovante/data de hoje
    await prisma.sale.update({
      where: { id: createdSaleId },
      data: { receiptUrl: 'https://storage.test/receipt.jpg' },
    });

    const res = await fetch(`${baseUrl}/api/closing/daily/${sellerId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${sellerToken}`,
      },
    });

    assert.equal(res.status, 200);
    const data = await res.json();

    // Vendas com crediário
    assert.equal(data.crediarioSalesCount, 1);
    assert.equal(data.crediarioTotalValue, 1000);
    assert.equal(data.crediarioDownPaymentValue, 200);
    assert.equal(data.crediarioFinancedValue, 800);

    // Parcelas de crediário recebidas
    assert.equal(data.crediarioPaymentsCollectedValue, 200);

    // Comissões discriminadas:
    // 25% sobre a entrada de 200 = 50
    // 10% sobre a parcela de 200 = 20
    // Total de comissão = 70
    assert.equal(data.commissionBreakdown.crediarioDownPaymentCommission, 50);
    assert.equal(data.commissionBreakdown.crediarioInstallmentsCommission, 20);
    assert.equal(data.commissionAmount, 70);

    // Dinheiro em mãos do vendedor:
    // Entrada: 100 em CASH
    // Parcela 1: 200 em CASH (destination: SELLER_HANDS)
    // Total CASH = 300
    // Repasse líquido: 300 - 70 = 230 devido à empresa
    assert.equal(data.cashValue, 300);
    assert.equal(data.sellerOwesCompany, 230);
  });

  it('6. Deve estornar recebimento com justificativa, reabrindo a parcela e cancelando a comissão', async () => {
    const res = await fetch(`${baseUrl}/api/credit/payments/${paymentId}/reverse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        reason: 'Cliente cancelou o pagamento e solicitou estorno',
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);

    // Parcela 1 deve voltar para PENDING
    const inst1 = await prisma.creditInstallment.findFirst({
      where: { agreementId, installmentNumber: 1 },
    });
    assert.equal(inst1!.status, 'PENDING');
    assert.equal(inst1!.paidCents, 0);

    // Saldo do contrato deve voltar a ser 80000 centavos
    const agr = await prisma.creditAgreement.findUnique({
      where: { id: agreementId },
    });
    assert.equal(agr!.remainingPrincipalCents, 80000);
    assert.equal(agr!.paidPrincipalCents, 0);

    // Comissão do pagamento estornada
    const comm = await prisma.creditCommission.findFirst({
      where: { paymentId },
    });
    assert.equal(comm!.isReversed, true);
    assert.equal(comm!.status, 'REVERSED');
  });

  it('7. Overview administrativo de crediário (/api/credit/overview) deve reportar KPIs consolidados', async () => {
    const res = await fetch(`${baseUrl}/api/credit/overview`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.totalRemainingPrincipal, 800);
    assert.equal(data.totalOverduePrincipal, 0);
    assert.equal(data.delinquencyRate, 0);
    assert.ok(data.delinquencyFormula);
  });
});
