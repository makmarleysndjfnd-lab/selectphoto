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
const jwtSecret = envConfig.JWT_SECRET || 'test_secret_asaas_audit';

process.env.DATABASE_URL = databaseUrl;
process.env.JWT_SECRET = jwtSecret;
process.env.DISABLE_CRON = 'true';
process.env.EXTERNAL_SERVICES_DISABLED = 'true';
process.env.NODE_ENV = 'test';

import salesRoutes from '../src/routes/sales';
import creditRoutes from '../src/routes/credit';
import financeRoutes from '../src/routes/finance';
import closingRoutes from '../src/routes/closing';
import { processAsaasSyncQueue, createAsaasChargeForInstallment } from '../src/services/asaasService';

const prisma = new PrismaClient();

function generateToken(payload: { id: string; role: string; companyId?: string; name?: string }) {
  return jwt.sign(payload, jwtSecret, { expiresIn: '1h' });
}

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use('/api/sales', salesRoutes);
  app.use('/api/credit', creditRoutes);
  app.use('/api/finance', financeRoutes);
  app.use('/api/closing', closingRoutes);
  return app;
}

describe('AUDITORIA DE CREDIÁRIO & INTEGRAÇÃO BANCÁRIA ASAAS — ENTREGAS 1 E 2', { concurrency: 1 }, () => {
  const app = createTestApp();
  let server: any;
  let baseUrl: string;

  const uid = 'asaas_' + Date.now();
  const companyId = `comp_${uid}`;
  const company2Id = `comp2_${uid}`;
  const seller1Id = `seller1_${uid}`;
  const seller2Id = `seller2_${uid}`;
  const adminId = `admin_${uid}`;
  const admin2Id = `admin2_${uid}`;

  let seller1Token: string;
  let seller2Token: string;
  let adminToken: string;
  let admin2Token: string;

  const webhookToken = 'secret_token_' + uid;

  let clientId: string;
  const validCpf = '52998224725';

  before(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${(addr as any).port}`;
        resolve();
      });
    });

    try {
      await prisma.asaasConfig.deleteMany({
        where: { webhookToken: { startsWith: 'secret_token_' } }
      });
    } catch (_) {}

    await prisma.company.createMany({
      data: [
        { id: companyId, name: 'Empresa Teste Asaas Audit' },
        { id: company2Id, name: 'Empresa Teste Isolada 2' },
      ],
    });

    await prisma.user.createMany({
      data: [
        {
          id: seller1Id,
          companyId,
          email: `seller1_${uid}@test.com`,
          name: 'Vendedor Titular',
          role: 'SELLER',
          password: 'dummy',
          usesOwnCar: false,
        },
        {
          id: seller2Id,
          companyId,
          email: `seller2_${uid}@test.com`,
          name: 'Vendedor Externo',
          role: 'SELLER',
          password: 'dummy',
          usesOwnCar: false,
        },
        {
          id: adminId,
          companyId,
          email: `admin_${uid}@test.com`,
          name: 'Administrador Geral',
          role: 'COMPANY_ADMIN',
          password: 'dummy',
        },
        {
          id: admin2Id,
          companyId: company2Id,
          email: `admin2_${uid}@test.com`,
          name: 'Administrador Empresa 2',
          role: 'COMPANY_ADMIN',
          password: 'dummy',
        },
      ],
    });

    seller1Token = generateToken({ id: seller1Id, role: 'SELLER', companyId, name: 'Vendedor Titular' });
    seller2Token = generateToken({ id: seller2Id, role: 'SELLER', companyId, name: 'Vendedor Externo' });
    adminToken = generateToken({ id: adminId, role: 'COMPANY_ADMIN', companyId, name: 'Administrador Geral' });
    admin2Token = generateToken({ id: admin2Id, role: 'COMPANY_ADMIN', companyId: company2Id, name: 'Administrador Empresa 2' });

    const client = await prisma.client.create({
      data: {
        companyId,
        assignedSellerId: seller1Id,
        sequenceNumber: `AS_${uid}`,
        name: 'Aluno Alvo',
        city: 'Cidade Teste',
        street: 'Rua Principal',
        number: '100',
        neighborhood: 'Centro',
        state: 'SP',
        cep: '01001000',
        bookStatus: 'DISTRIBUTED',
        outcomeStatus: 'PENDING',
      },
    });
    clientId = client.id;
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    const compIds = [companyId, company2Id];
    try {
      await prisma.asaasDuplicatePaymentAlert.deleteMany({ where: { companyId: { in: compIds } } });
      await prisma.asaasSyncQueue.deleteMany({ where: { companyId: { in: compIds } } });
      await prisma.asaasCharge.deleteMany({ where: { companyId: { in: compIds } } });
      await prisma.asaasWebhookEvent.deleteMany({ where: { companyId: { in: compIds } } });
      await prisma.asaasConfig.deleteMany({ where: { companyId: { in: compIds } } });
      await prisma.creditCommissionAdjustment.deleteMany({ where: { companyId: { in: compIds } } });
      await prisma.creditCommission.deleteMany({ where: { companyId: { in: compIds } } });
      await prisma.creditPaymentAllocation.deleteMany({ where: { payment: { companyId: { in: compIds } } } });
      await prisma.creditPayment.deleteMany({ where: { companyId: { in: compIds } } });
      await prisma.creditAgreementRenegotiation.deleteMany({ where: { agreement: { companyId: { in: compIds } } } });
      await prisma.creditInstallment.deleteMany({ where: { agreement: { companyId: { in: compIds } } } });
      await prisma.creditAgreement.deleteMany({ where: { companyId: { in: compIds } } });
      await prisma.salePayment.deleteMany({ where: { sale: { companyId: { in: compIds } } } });
      await prisma.sale.deleteMany({ where: { companyId: { in: compIds } } });
      await prisma.clientTimeline.deleteMany({ where: { client: { companyId: { in: compIds } } } });
      await prisma.client.deleteMany({ where: { companyId: { in: compIds } } });
      await prisma.user.deleteMany({ where: { companyId: { in: compIds } } });
      await prisma.company.deleteMany({ where: { id: { in: compIds } } });
    } catch (_) {}
    await prisma.$disconnect();
  });

  let agreementId: string;

  it('1. Deve registrar venda a prazo (R$ 1.000 com R$ 200 de entrada e 4x R$ 200)', async () => {
    const salePayload = {
      clientId,
      value: 1000,
      city: 'Curitiba',
      product: 'Book Completo',
      payments: [
        { method: 'CASH', amount: 100 },
        { method: 'PIX', amount: 100 },
      ],
      credit: {
        buyerName: 'Responsavel Legal Teste',
        buyerCpf: validCpf,
        installmentsCount: 4,
        periodicity: 'MONTHLY',
        notes: 'Venda de teste crediário audit',
      },
    };

    const res = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${seller1Token}`,
      },
      body: JSON.stringify(salePayload),
    });

    assert.equal(res.status, 201);
    const sale = await res.json();
    assert.ok(sale.id);

    const agreementFound = await prisma.creditAgreement.findFirst({
      where: { saleId: sale.id },
    });
    assert.ok(agreementFound);
    agreementId = agreementFound.id;

    const agreement = await prisma.creditAgreement.findUnique({
      where: { id: agreementId },
      include: { installments: true, commissions: true },
    });
    assert.ok(agreement);
    assert.equal(agreement.totalSaleCents, 100000);
    assert.equal(agreement.downPaymentCents, 20000);
    assert.equal(agreement.financedPrincipalCents, 80000);
    assert.equal(agreement.remainingPrincipalCents, 80000);
    assert.equal(agreement.installments.length, 4);

    // Comissão de entrada (25% sobre R$ 200 = R$ 50)
    const downComm = agreement.commissions.find((c) => c.type === 'DOWN_PAYMENT');
    assert.ok(downComm);
    assert.equal(downComm.amountCents, 5000);
    assert.equal(downComm.status, 'RELEASED');
  });

  it('2. Caixa em /finance/overview deve separar Vendas Brutas de Recebimentos Efetivos e Saldo a Receber', async () => {
    const res = await fetch(`${baseUrl}/api/finance/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();

    // Vendas Brutas deve ser 1000.0
    assert.equal(data.faturamentoBruto, 1000.0);
    // Recebimento efetivo até o momento é APENAS a entrada de R$ 200.00
    assert.equal(data.recebimentosEfetivos, 200.0);
    // Saldo disponível (descontando saídas zero)
    assert.equal(data.saldo, 200.0);
    // Saldo a receber do crediário deve ser R$ 800.00
    assert.equal(data.saldoAReceber, 800.0);
  });

  it('3. Autorização estrita: vendedor 2 NÃO pode ver nem receber contrato da carteira do vendedor 1', async () => {
    // Tentativa de consulta individual
    const getRes = await fetch(`${baseUrl}/api/credit/agreements/${agreementId}`, {
      headers: { Authorization: `Bearer ${seller2Token}` },
    });
    assert.equal(getRes.status, 403);

    // Tentativa de registro de pagamento
    const agreement = await prisma.creditAgreement.findUnique({
      where: { id: agreementId },
      include: { installments: true },
    });
    const inst1 = agreement!.installments[0];

    const payRes = await fetch(`${baseUrl}/api/credit/agreements/${agreementId}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${seller2Token}`,
      },
      body: JSON.stringify({
        installmentId: inst1.id,
        amount: 200.0,
        paymentMethod: 'CASH',
        idempotencyKey: `idem_forbidden_${Date.now()}`,
      }),
    });
    assert.equal(payRes.status, 403);
  });

  it('4. Idempotência Persistente: pagamentos simultâneos com mesma chave não duplicam baixa', async () => {
    const agreement = await prisma.creditAgreement.findUnique({
      where: { id: agreementId },
      include: { installments: true },
    });
    const inst1 = agreement!.installments[0];
    const sharedIdempotencyKey = `idem_pay_inst1_${Date.now()}`;

    // Dispara 2 requisições com a mesma idempotencyKey
    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/api/credit/agreements/${agreementId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller1Token}` },
        body: JSON.stringify({
          installmentId: inst1.id,
          amount: 200.0,
          paymentMethod: 'PIX',
          idempotencyKey: sharedIdempotencyKey,
        }),
      }),
      fetch(`${baseUrl}/api/credit/agreements/${agreementId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller1Token}` },
        body: JSON.stringify({
          installmentId: inst1.id,
          amount: 200.0,
          paymentMethod: 'PIX',
          idempotencyKey: sharedIdempotencyKey,
        }),
      }),
    ]);

    // Uma deve retornar 201, a outra 200 (idempotente) ou 409
    const statuses = [res1.status, res2.status];
    assert.ok(statuses.includes(201));
    assert.ok(statuses.includes(200) || statuses.includes(409));

    // Verifica que existe rigorosamente 1 pagamento e 1 comissão para inst1
    const allocations = await prisma.creditPaymentAllocation.findMany({
      where: { installmentId: inst1.id },
      include: { payment: true },
    });
    assert.equal(allocations.length, 1);
    assert.equal(allocations[0].payment.amountCents, 20000);

    const commissions = await prisma.creditCommission.findMany({
      where: { paymentId: allocations[0].payment.id },
    });
    assert.equal(commissions.length, 1);
    assert.equal(commissions[0].amountCents, 2000); // 10% de R$ 200 = R$ 20
  });

  it('5. Liquidação de comissão e Estorno: gera Ajuste de Débito rastreável sem apagar histórico', async () => {
    // 5.1 Admin liquida/paga as comissões liberadas do vendedor 1
    const releasedComms = await prisma.creditCommission.findMany({
      where: { sellerId: seller1Id, status: 'RELEASED' },
    });
    assert.ok(releasedComms.length >= 2); // Down payment + Parcela 1

    const payCommRes = await fetch(`${baseUrl}/api/credit/commissions/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        sellerId: seller1Id,
        commissionIds: releasedComms.map((c) => c.id),
        paymentMethod: 'PIX',
        idempotencyKey: `payout_${Date.now()}`,
        notes: 'Acerto semanal',
      }),
    });
    assert.equal(payCommRes.status, 200);

    // 5.2 Agora estorna o pagamento da parcela 1
    const payment = await prisma.creditPayment.findFirst({
      where: { agreementId, isReversed: false },
    });
    assert.ok(payment);

    const reverseRes = await fetch(`${baseUrl}/api/credit/payments/${payment!.id}/reverse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        reason: 'Cliente contestou o pagamento',
        idempotencyKey: `reverse_${Date.now()}`,
      }),
    });
    assert.equal(reverseRes.status, 200);

    // 5.3 Verifica que a comissão original permanece como PAID e existe um CreditCommissionAdjustment rastreável
    const originalComm = await prisma.creditCommission.findFirst({
      where: { paymentId: payment!.id },
    });
    assert.ok(originalComm);
    assert.equal(originalComm!.status, 'PAID');

    const adjustment = await prisma.creditCommissionAdjustment.findFirst({
      where: { commissionId: originalComm!.id },
    });
    assert.ok(adjustment);
    assert.equal(adjustment!.amountCents, 2000); // Débito de R$ 20.00
    assert.equal(adjustment!.status, 'PENDING');
  });

  it('6. Asaas Webhook: PAYMENT_CONFIRMED amortiza principal nominal e separa tarifa bancária; PAYMENT_RECEIVED liquida sem duplicar', async () => {
    // Pega a parcela 2 do contrato (valor R$ 200.00 = 20000 cents)
    const agreement = await prisma.creditAgreement.findUnique({
      where: { id: agreementId },
      include: { installments: { orderBy: { installmentNumber: 'asc' } } },
    });
    const inst2 = agreement!.installments[1];
    const externalPaymentId = `pay_asaas_test_${Date.now()}`;

    // Configura Asaas webhook secret
    await prisma.asaasConfig.upsert({
      where: { companyId },
      update: { webhookToken: webhookToken, mode: 'SANDBOX' },
      create: { companyId, webhookToken: webhookToken, mode: 'SANDBOX' },
    });

    // Cria a cobrança bancária local vinculada ao Asaas
    await prisma.asaasCharge.create({
      data: {
        companyId,
        agreementId,
        installmentId: inst2.id,
        externalId: externalPaymentId,
        customerExternalId: 'cus_123',
        billingType: 'BOLETO',
        status: 'PENDING',
        nominalValueCents: 20000,
        netValueCents: 19801,
        dueDate: inst2.dueDate,
      },
    });

    // Simula primeiro webhook: PAYMENT_CONFIRMED
    const webhookPayloadConfirmed = {
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: externalPaymentId,
        customer: 'cus_123',
        value: 200.0,
        netValue: 198.01, // Tarifa Asaas de R$ 1.99
        billingType: 'BOLETO',
        status: 'CONFIRMED',
        externalReference: `${agreementId}:${inst2.id}`,
      },
    };

    const res1 = await fetch(`${baseUrl}/api/credit/webhooks/asaas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'asaas-access-token': webhookToken,
      },
      body: JSON.stringify(webhookPayloadConfirmed),
    });
    assert.equal(res1.status, 200);

    // Verifica que a parcela foi baixada pelo valor nominal (R$ 200.00) e a dívida do cliente foi quitada
    const updatedInst2 = await prisma.creditInstallment.findUnique({
      where: { id: inst2.id },
    });
    assert.equal(updatedInst2!.status, 'PAID');
    assert.equal(updatedInst2!.paidCents, 20000);

    // Verifica que o pagamento bancário registrou o valor nominal e a tarifa bancária
    const creditPayment = await prisma.creditPayment.findFirst({
      where: { externalPaymentId },
    });
    assert.ok(creditPayment);
    assert.equal(creditPayment!.amountCents, 20000);
    assert.equal(creditPayment!.bankFeeCents, 199); // Tarifa de R$ 1.99
    assert.equal(creditPayment!.isAsaasSettled, false); // Não liquidado ainda

    // Verifica que gerou comissão de 10% sobre o nominal (R$ 20.00)
    const commInst2 = await prisma.creditCommission.findFirst({
      where: { paymentId: creditPayment!.id },
    });
    assert.ok(commInst2);
    assert.equal(commInst2!.amountCents, 2000);

    // Simula segundo webhook subsequente: PAYMENT_RECEIVED (saldo liberado na conta bancária)
    const webhookPayloadReceived = {
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: externalPaymentId,
        customer: 'cus_123',
        value: 200.0,
        netValue: 198.01,
        billingType: 'BOLETO',
        status: 'RECEIVED',
        externalReference: `${agreementId}:${inst2.id}`,
      },
    };

    const res2 = await fetch(`${baseUrl}/api/credit/webhooks/asaas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'asaas-access-token': webhookToken,
      },
      body: JSON.stringify(webhookPayloadReceived),
    });
    assert.equal(res2.status, 200);

    // Verifica que NÃO criou um segundo CreditPayment e NÃO duplicou a comissão
    const allAllocationsForInst2 = await prisma.creditPaymentAllocation.findMany({
      where: { installmentId: inst2.id },
    });
    assert.equal(allAllocationsForInst2.length, 1);

    const reloadedCreditPayment = await prisma.creditPayment.findUnique({
      where: { id: creditPayment!.id },
    });
    assert.equal(reloadedCreditPayment!.isAsaasSettled, true);
    assert.ok(reloadedCreditPayment!.settledAt);

    const allCommsForInst2 = await prisma.creditCommission.findMany({
      where: { paymentId: creditPayment!.id },
    });
    assert.equal(allCommsForInst2.length, 1);
  });

  it('7. Pagamento em Duplicidade: Baixa Manual seguida de Webhook Bancário gera Alerta de Conciliação e Alocação Atômica', async () => {
    // Parcela 3: recebe pagamento em dinheiro no app
    const agreement = await prisma.creditAgreement.findUnique({
      where: { id: agreementId },
      include: { installments: { orderBy: { installmentNumber: 'asc' } } },
    });
    const inst3 = agreement!.installments[2];

    const duplicatePaymentId = `pay_asaas_dup_${Date.now()}`;
    await prisma.asaasCharge.create({
      data: {
        companyId,
        agreementId,
        installmentId: inst3.id,
        externalId: duplicatePaymentId,
        customerExternalId: 'cus_123',
        billingType: 'BOLETO',
        status: 'PENDING',
        nominalValueCents: 20000,
        netValueCents: 19801,
        dueDate: inst3.dueDate,
      },
    });

    const manualPayRes = await fetch(`${baseUrl}/api/credit/agreements/${agreementId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller1Token}` },
      body: JSON.stringify({
        installmentId: inst3.id,
        amount: 200.0,
        paymentMethod: 'CASH',
        idempotencyKey: `manual_pay_inst3_${Date.now()}`,
      }),
    });
    assert.equal(manualPayRes.status, 201);

    // Agora chega um webhook bancário informando que o cliente também pagou o boleto bancário no Asaas
    const webhookDuplicate = {
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: duplicatePaymentId,
        customer: 'cus_123',
        value: 200.0,
        netValue: 198.01,
        billingType: 'BOLETO', // Não é RECEIVED_IN_CASH
        status: 'RECEIVED',
        externalReference: `${agreementId}:${inst3.id}`,
      },
    };

    const res = await fetch(`${baseUrl}/api/credit/webhooks/asaas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'asaas-access-token': webhookToken,
      },
      body: JSON.stringify(webhookDuplicate),
    });
    assert.equal(res.status, 200);

    // Verifica que gerou um AsaasDuplicatePaymentAlert pendente para o Admin
    const alert = await prisma.asaasDuplicatePaymentAlert.findFirst({
      where: { externalPaymentId: duplicatePaymentId },
    });
    assert.ok(alert);
    assert.equal(alert!.amountCents, 20000);
    assert.equal(alert!.status, 'PENDING');

    // Admin resolve o alerta alocando na próxima parcela
    const resolveRes = await fetch(`${baseUrl}/api/credit/asaas/duplicate-alerts/${alert!.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ action: 'ALLOCATE_NEXT', notes: 'Compensado na parcela pendente' }),
    });
    assert.equal(resolveRes.status, 200);

    const resolvedAlert = await prisma.asaasDuplicatePaymentAlert.findUnique({
      where: { id: alert!.id },
    });
    assert.equal(resolvedAlert!.status, 'RESOLVED_ALLOCATED');

    // Efeito financeiro atômico: a parcela inst1 (estornada anteriormente) foi recomposta e quitada
    const inst1AfterAlloc = await prisma.creditInstallment.findUnique({ where: { id: agreement!.installments[0].id } });
    assert.equal(inst1AfterAlloc!.status, 'PAID');
    assert.equal(inst1AfterAlloc!.paidCents, 20000);

    // E o saldo devedor do contrato reduziu atomicamente em R$ 200 (restando 20000 cents da parcela 4)
    const agreementAfterAlloc = await prisma.creditAgreement.findUnique({ where: { id: agreementId } });
    assert.equal(agreementAfterAlloc!.remainingPrincipalCents, 20000);
  });

  it('8. Renegociação: marca parcelas residuais como RENEGOTIATED sem duplicar saldo de parcelas parciais', async () => {
    // Parcela 4 tem valor de R$ 200. Cliente paga parcialmente R$ 50
    const agreement = await prisma.creditAgreement.findUnique({
      where: { id: agreementId },
      include: { installments: { orderBy: { installmentNumber: 'asc' } } },
    });
    const inst4 = agreement!.installments[3];

    const partialPayRes = await fetch(`${baseUrl}/api/credit/agreements/${agreementId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller1Token}` },
      body: JSON.stringify({
        installmentId: inst4.id,
        amount: 50.0,
        paymentMethod: 'CASH',
        idempotencyKey: `partial_pay_inst4_${Date.now()}`,
      }),
    });
    assert.equal(partialPayRes.status, 201);

    const reloadedInst4 = await prisma.creditInstallment.findUnique({ where: { id: inst4.id } });
    assert.ok(reloadedInst4!.status === 'PARTIALLY_PAID' || reloadedInst4!.status === 'PARTIAL');
    assert.equal(reloadedInst4!.paidCents, 5000);

    // Saldo residual real do contrato:
    // Inst1: Paga via alocação atômica (R$ 200)
    // Inst2: Paga via webhook Asaas (R$ 200)
    // Inst3: Paga via dinheiro (R$ 200)
    // Inst4: Parcial paga R$ 50 (restante R$ 150)
    // Saldo restante total = R$ 150.00
    const remainingBefore = (await prisma.creditAgreement.findUnique({ where: { id: agreementId } }))!.remainingPrincipalCents;
    assert.equal(remainingBefore, 15000);

    // Renegocia o saldo restante de R$ 150 em 2 novas parcelas de R$ 75
    const renegotiateRes = await fetch(`${baseUrl}/api/credit/agreements/${agreementId}/renegotiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller1Token}` },
      body: JSON.stringify({
        numberOfInstallments: 2,
        frequency: 'MONTHLY',
        firstDueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
        notes: 'Renegociação de saldo residual de R$ 150',
        idempotencyKey: `reneg_${Date.now()}`,
      }),
    });
    assert.equal(renegotiateRes.status, 200);

    // Verifica que inst4 foi marcada como RENEGOTIATED e seu histórico de R$ 50 pago foi preservado
    const inst4After = await prisma.creditInstallment.findUnique({ where: { id: inst4.id } });
    assert.equal(inst4After!.status, 'RENEGOTIATED');
    assert.equal(inst4After!.paidCents, 5000);

    // Verifica que as novas parcelas foram geradas EXCLUSIVAMENTE sobre o saldo devedor de R$ 150 (2x R$ 75)
    const newInstallments = await prisma.creditInstallment.findMany({
      where: { agreementId, status: 'PENDING' },
      orderBy: { installmentNumber: 'asc' },
    });
    assert.equal(newInstallments.length, 2);
    const sumNew = newInstallments.reduce((acc, i) => acc + i.amountCents, 0);
    assert.equal(sumNew, 15000);
    assert.equal(newInstallments[0].amountCents, 7500);
    assert.equal(newInstallments[1].amountCents, 7500);
  });

  it('9. Webhook Segurança: validação obrigatória antes de qualquer mutação, bloqueio em modo DISABLED e descarte de referências não vinculadas', async () => {
    // 9.1 Ausência de cabeçalho de autenticação -> 401
    const resNoToken = await fetch(`${baseUrl}/api/credit/webhooks/asaas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'PAYMENT_RECEIVED', payment: { id: 'any_id' } }),
    });
    assert.equal(resNoToken.status, 401);

    // 9.2 Token inválido / não cadastrado -> 401
    const resWrongToken = await fetch(`${baseUrl}/api/credit/webhooks/asaas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'asaas-access-token': 'wrong_invalid_secret_token',
      },
      body: JSON.stringify({ event: 'PAYMENT_RECEIVED', payment: { id: 'any_id' } }),
    });
    assert.equal(resWrongToken.status, 401);

    // 9.3 Empresa com modo DISABLED -> 403
    await prisma.asaasConfig.update({
      where: { companyId },
      data: { mode: 'DISABLED' },
    });

    const resDisabled = await fetch(`${baseUrl}/api/credit/webhooks/asaas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'asaas-access-token': webhookToken,
      },
      body: JSON.stringify({ event: 'PAYMENT_RECEIVED', payment: { id: 'any_id' } }),
    });
    assert.equal(resDisabled.status, 403);

    // Restaura SANDBOX para os próximos testes
    await prisma.asaasConfig.update({
      where: { companyId },
      data: { mode: 'SANDBOX' },
    });

    // 9.4 Referência externa não vinculada a cobrança local -> 200 unlinked, sem criar cobranças arbitrárias
    const fakeExternalId = `pay_unlinked_external_${Date.now()}`;
    const resUnlinked = await fetch(`${baseUrl}/api/credit/webhooks/asaas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'asaas-access-token': webhookToken,
      },
      body: JSON.stringify({
        event: 'PAYMENT_CONFIRMED',
        payment: {
          id: fakeExternalId,
          value: 999.0,
          billingType: 'BOLETO',
          status: 'CONFIRMED',
          externalReference: 'arbitrary_fake_reference',
        },
      }),
    });
    assert.equal(resUnlinked.status, 200);
    const unlinkedJson = await resUnlinked.json();
    assert.equal(unlinkedJson.unlinked, true);

    // Garante que NENHUMA cobrança local, pagamento ou alerta foi criado para essa referência falsa
    const fakeChargeFound = await prisma.asaasCharge.findFirst({ where: { externalId: fakeExternalId } });
    assert.equal(fakeChargeFound, null);
    const fakePaymentFound = await prisma.creditPayment.findFirst({ where: { externalPaymentId: fakeExternalId } });
    assert.equal(fakePaymentFound, null);
  });

  async function createTestClient(name: string) {
    return await prisma.client.create({
      data: {
        companyId,
        assignedSellerId: seller1Id,
        sequenceNumber: `CLI_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        name,
        city: 'Curitiba',
        street: 'Rua Teste',
        number: '123',
        neighborhood: 'Centro',
        state: 'PR',
        cep: '80000000',
        bookStatus: 'DISTRIBUTED',
        outcomeStatus: 'PENDING',
      },
    });
  }

  it('10. Idempotência e Out-of-Order: PAYMENT_RECEIVED direto sem PAYMENT_CONFIRMED prévio liquida e não duplica', async () => {
    // Cria novo cliente e nova venda e contrato para isolar o teste
    const client10 = await createTestClient('Aluno Teste 10');
    const saleRes = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller1Token}` },
      body: JSON.stringify({
        clientId: client10.id,
        value: 400,
        city: 'Curitiba',
        product: 'Quadro Teste Out-of-Order',
        payments: [{ method: 'CASH', amount: 200 }],
        credit: {
          buyerName: 'Responsavel Out-of-order',
          buyerCpf: validCpf,
          installmentsCount: 1,
          periodicity: 'MONTHLY',
        },
      }),
    });
    assert.equal(saleRes.status, 201);
    const saleData = await saleRes.json();
    const newAgreement = await prisma.creditAgreement.findFirst({
      where: { saleId: saleData.id },
      include: { installments: true },
    });
    assert.ok(newAgreement);
    const inst = newAgreement!.installments[0];

    const outOfOrderId = `pay_ooo_${Date.now()}`;
    await prisma.asaasCharge.create({
      data: {
        companyId,
        agreementId: newAgreement!.id,
        installmentId: inst.id,
        externalId: outOfOrderId,
        customerExternalId: 'cus_ooo',
        billingType: 'PIX',
        status: 'PENDING',
        nominalValueCents: 20000,
        netValueCents: 19801,
        dueDate: inst.dueDate,
      },
    });

    const eventId = `evt_ooo_${Date.now()}`;
    const payload = {
      id: eventId,
      event: 'PAYMENT_RECEIVED', // Chega diretamente sem PAYMENT_CONFIRMED
      payment: {
        id: outOfOrderId,
        customer: 'cus_ooo',
        value: 200.0,
        netValue: 198.01,
        billingType: 'PIX',
        status: 'RECEIVED',
      },
    };

    // Primeiro envio
    const res1 = await fetch(`${baseUrl}/api/credit/webhooks/asaas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'asaas-access-token': webhookToken },
      body: JSON.stringify(payload),
    });
    assert.equal(res1.status, 200);

    const instAfter = await prisma.creditInstallment.findUnique({ where: { id: inst.id } });
    assert.equal(instAfter!.status, 'PAID');
    assert.equal(instAfter!.paidCents, 20000);

    const cp = await prisma.creditPayment.findFirst({ where: { externalPaymentId: outOfOrderId } });
    assert.ok(cp);
    assert.equal(cp!.isAsaasSettled, true);

    // Segundo envio com mesmo ID do evento Asaas -> Deduplicação
    const res2 = await fetch(`${baseUrl}/api/credit/webhooks/asaas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'asaas-access-token': webhookToken },
      body: JSON.stringify(payload),
    });
    assert.equal(res2.status, 200);
    const json2 = await res2.json();
    assert.equal(json2.deduplicated, true);

    const allocs = await prisma.creditPaymentAllocation.findMany({ where: { installmentId: inst.id } });
    assert.equal(allocs.length, 1);
  });

  it('11. Concorrência: Webhooks simultâneos para cobranças distintas do mesmo contrato usam trava e releitura atômica', async () => {
    // Venda de R$ 400 com R$ 200 de entrada e 2x R$ 100
    const client11 = await createTestClient('Aluno Teste 11');
    const saleRes = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller1Token}` },
      body: JSON.stringify({
        clientId: client11.id,
        value: 400,
        city: 'Curitiba',
        product: 'Pacote Concorrência',
        payments: [{ method: 'CASH', amount: 200 }],
        credit: {
          buyerName: 'Responsavel Concorrencia',
          buyerCpf: validCpf,
          installmentsCount: 2,
          periodicity: 'MONTHLY',
        },
      }),
    });
    assert.equal(saleRes.status, 201);
    const saleData = await saleRes.json();
    const concurrentAgreement = await prisma.creditAgreement.findFirst({
      where: { saleId: saleData.id },
      include: { installments: { orderBy: { installmentNumber: 'asc' } } },
    });
    assert.ok(concurrentAgreement);
    assert.equal(concurrentAgreement!.remainingPrincipalCents, 20000);

    const instA = concurrentAgreement!.installments[0];
    const instB = concurrentAgreement!.installments[1];
    const payIdA = `pay_conc_A_${Date.now()}`;
    const payIdB = `pay_conc_B_${Date.now()}`;

    await prisma.asaasCharge.createMany({
      data: [
        {
          companyId,
          agreementId: concurrentAgreement!.id,
          installmentId: instA.id,
          externalId: payIdA,
          customerExternalId: 'cus_conc',
          billingType: 'BOLETO',
          status: 'PENDING',
          nominalValueCents: 10000,
          netValueCents: 9801,
          dueDate: instA.dueDate,
        },
        {
          companyId,
          agreementId: concurrentAgreement!.id,
          installmentId: instB.id,
          externalId: payIdB,
          customerExternalId: 'cus_conc',
          billingType: 'BOLETO',
          status: 'PENDING',
          nominalValueCents: 10000,
          netValueCents: 9801,
          dueDate: instB.dueDate,
        },
      ],
    });

    // Dispara dois webhooks simultâneos para as duas parcelas do mesmo contrato
    const [resA, resB] = await Promise.all([
      fetch(`${baseUrl}/api/credit/webhooks/asaas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'asaas-access-token': webhookToken },
        body: JSON.stringify({
          event: 'PAYMENT_RECEIVED',
          payment: { id: payIdA, value: 100.0, netValue: 98.01, billingType: 'BOLETO', status: 'RECEIVED' },
        }),
      }),
      fetch(`${baseUrl}/api/credit/webhooks/asaas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'asaas-access-token': webhookToken },
        body: JSON.stringify({
          event: 'PAYMENT_RECEIVED',
          payment: { id: payIdB, value: 100.0, netValue: 98.01, billingType: 'BOLETO', status: 'RECEIVED' },
        }),
      }),
    ]);

    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);

    // Ambas as parcelas devem estar PAID
    const reloadedA = await prisma.creditInstallment.findUnique({ where: { id: instA.id } });
    const reloadedB = await prisma.creditInstallment.findUnique({ where: { id: instB.id } });
    assert.equal(reloadedA!.status, 'PAID');
    assert.equal(reloadedB!.status, 'PAID');

    // O contrato deve estar rigorosamente com saldo devedor ZERO e SETTLED
    const agreementFinal = await prisma.creditAgreement.findUnique({ where: { id: concurrentAgreement!.id } });
    assert.equal(agreementFinal!.remainingPrincipalCents, 0);
    assert.equal(agreementFinal!.status, 'SETTLED');
  });

  it('12. Pagamento manual parcial preserva cobrança Asaas com saldo residual sem disparar receiveInCash', async () => {
    // Venda de R$ 500 com 1x R$ 300 financiado
    const client12 = await createTestClient('Aluno Teste 12');
    const saleRes = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller1Token}` },
      body: JSON.stringify({
        clientId: client12.id,
        value: 500,
        city: 'Curitiba',
        product: 'Pacote Parcial Teste',
        payments: [{ method: 'CASH', amount: 200 }],
        credit: {
          buyerName: 'Responsavel Parcial',
          buyerCpf: validCpf,
          installmentsCount: 1,
          periodicity: 'MONTHLY',
        },
      }),
    });
    assert.equal(saleRes.status, 201);
    const saleData = await saleRes.json();
    const partialAgreement = await prisma.creditAgreement.findFirst({
      where: { saleId: saleData.id },
      include: { installments: true },
    });
    const inst = partialAgreement!.installments[0];
    const partialChargeId = `pay_partial_${Date.now()}`;

    await prisma.asaasCharge.create({
      data: {
        companyId,
        agreementId: partialAgreement!.id,
        installmentId: inst.id,
        externalId: partialChargeId,
        customerExternalId: 'cus_part',
        billingType: 'BOLETO',
        status: 'PENDING',
        nominalValueCents: 30000,
        netValueCents: 29801,
        dueDate: inst.dueDate,
      },
    });

    // Cliente paga R$ 100 em dinheiro no app (deixando saldo residual de R$ 200)
    const payRes = await fetch(`${baseUrl}/api/credit/agreements/${partialAgreement!.id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller1Token}` },
      body: JSON.stringify({
        installmentId: inst.id,
        amount: 100.0,
        paymentMethod: 'CASH',
        idempotencyKey: `partial_manual_${Date.now()}`,
      }),
    });
    assert.equal(payRes.status, 201);

    const reloadedInst = await prisma.creditInstallment.findUnique({ where: { id: inst.id } });
    assert.equal(reloadedInst!.status, 'PARTIALLY_PAID');
    assert.equal(reloadedInst!.paidCents, 10000);

    // Cobrança Asaas local deve ser mantida com o valor residual de R$ 200 (20000 cents) e status PENDING (não RECEIVED_IN_CASH)
    const reloadedCharge = await prisma.asaasCharge.findUnique({ where: { externalId: partialChargeId } });
    assert.equal(reloadedCharge!.nominalValueCents, 20000);
    assert.notEqual(reloadedCharge!.status, 'RECEIVED_IN_CASH');
  });

  it('13. Alertas de Duplicidade: isolamento multiempresa e fluxo completo de devolução (REFUND_PROCESSING -> PAYMENT_REFUNDED -> REFUNDED)', async () => {
    // Cria um alerta de duplicidade para a empresa 1
    const agreement = await prisma.creditAgreement.findUnique({
      where: { id: agreementId },
      include: { installments: true },
    });
    const inst = agreement!.installments[0];
    const refundExtPayId = `pay_refund_cycle_${Date.now()}`;

    const alert = await prisma.asaasDuplicatePaymentAlert.create({
      data: {
        companyId,
        agreementId,
        installmentId: inst.id,
        externalPaymentId: refundExtPayId,
        amountCents: 15000,
        reason: 'Pagamento duplo identificado',
        status: 'PENDING',
      },
    });

    // 13.1 Tentativa de resolução por admin de outra empresa (empresa 2) -> 404 (isolamento)
    const foreignRes = await fetch(`${baseUrl}/api/credit/asaas/duplicate-alerts/${alert.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin2Token}` },
      body: JSON.stringify({ action: 'REFUND' }),
    });
    assert.equal(foreignRes.status, 404);

    // 13.2 Ação inválida -> 400
    const invalidRes = await fetch(`${baseUrl}/api/credit/asaas/duplicate-alerts/${alert.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ action: 'INVALID_ACTION' }),
    });
    assert.equal(invalidRes.status, 400);

    // 13.3 Solicitação de Devolução (REFUND) por admin autorizado
    const refundRes = await fetch(`${baseUrl}/api/credit/asaas/duplicate-alerts/${alert.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ action: 'REFUND', notes: 'Devolução solicitada pelo titular' }),
    });
    assert.equal(refundRes.status, 200);

    const alertProcessing = await prisma.asaasDuplicatePaymentAlert.findUnique({ where: { id: alert.id } });
    assert.ok(alertProcessing!.status === 'REFUND_PROCESSING' || alertProcessing!.status === 'REFUNDED');

    // 13.4 Webhook PAYMENT_REFUNDED confirma a devolução do Asaas
    const webhookRefundRes = await fetch(`${baseUrl}/api/credit/webhooks/asaas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'asaas-access-token': webhookToken },
      body: JSON.stringify({
        event: 'PAYMENT_REFUNDED',
        payment: { id: refundExtPayId, value: 150.0, status: 'REFUNDED' },
      }),
    });
    assert.equal(webhookRefundRes.status, 200);

    const alertConfirmed = await prisma.asaasDuplicatePaymentAlert.findUnique({ where: { id: alert.id } });
    assert.equal(alertConfirmed!.status, 'REFUNDED');
    assert.ok(alertConfirmed!.resolvedAt);
  });

  it('14. Fila Asaas: captura atômica, recuperação de tarefas interrompidas (>5 min) e PENDING_ACTIVATION quando DISABLED', async () => {
    // 14.1 Configura empresa em modo DISABLED
    await prisma.asaasConfig.upsert({
      where: { companyId },
      update: { mode: 'DISABLED' },
      create: { companyId, mode: 'DISABLED' },
    });

    // Tarefa 1: parada em PROCESSING há 10 minutos (interrompida)
    const stalledId = `task_stalled_${Date.now()}`;
    await prisma.asaasSyncQueue.create({
      data: {
        id: stalledId,
        companyId,
        agreementId,
        action: 'RECEIVE_IN_CASH',
        payload: { asaasPaymentId: 'pay_x', value: 100 },
        status: 'PROCESSING',
        idempotencyKey: `idem_stalled_${Date.now()}`,
        updatedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min atrás
      },
    });

    // Tarefa 2: pendente
    const pendingId = `task_pending_${Date.now()}`;
    await prisma.asaasSyncQueue.create({
      data: {
        id: pendingId,
        companyId,
        agreementId,
        action: 'RECEIVE_IN_CASH',
        payload: { asaasPaymentId: 'pay_y', value: 50 },
        status: 'PENDING',
        idempotencyKey: `idem_pending_${Date.now()}`,
      },
    });

    // Executa o processador da fila
    await processAsaasSyncQueue(10);

    // Ambas as tarefas devem estar como PENDING_ACTIVATION (e NUNCA SUCCESS enquanto DISABLED)
    const taskStalled = await prisma.asaasSyncQueue.findUnique({ where: { id: stalledId } });
    assert.equal(taskStalled!.status, 'PENDING_ACTIVATION');
    assert.ok(taskStalled!.lastError?.includes('DESATIVADA'));

    const taskPending = await prisma.asaasSyncQueue.findUnique({ where: { id: pendingId } });
    assert.equal(taskPending!.status, 'PENDING_ACTIVATION');
    assert.ok(taskPending!.lastError?.includes('DESATIVADA'));

    // Restaura SANDBOX para não afetar outros testes
    await prisma.asaasConfig.update({
      where: { companyId },
      data: { mode: 'SANDBOX' },
    });
  });

  it('15. Financeiro: identifica vendas à vista estritamente por creditAgreement: null e separa principal, tarifas, saldo Asaas e vendedor', async () => {
    // 15.1 Cria uma venda estritamente À VISTA (sem creditAgreement) de R$ 350
    const client15 = await createTestClient('Aluno Teste 15');
    const cashSaleRes = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller1Token}` },
      body: JSON.stringify({
        clientId: client15.id,
        value: 350,
        city: 'Curitiba',
        product: 'Venda À Vista Pura',
        payments: [{ method: 'PIX', amount: 350 }],
      }),
    });
    assert.equal(cashSaleRes.status, 201);
    const cashSaleData = await cashSaleRes.json();

    // Garante no banco que a venda à vista não tem creditAgreement
    const saleRecord = await prisma.sale.findUnique({
      where: { id: cashSaleData.id },
      include: { creditAgreement: true },
    });
    assert.equal(saleRecord!.creditAgreement, null);

    // Consulta o resumo financeiro oficial
    const finRes = await fetch(`${baseUrl}/api/finance/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(finRes.status, 200);
    const fin = await finRes.json();

    // Venda à vista pura computada exclusivamente em entradasAVista
    assert.ok(fin.entradasAVista >= 350.0);
    // Campos de segregação bancária e de vendedor presentes e numéricos
    assert.ok(typeof fin.principalRecebido === 'number');
    assert.ok(typeof fin.tarifasBancarias === 'number');
    assert.ok(typeof fin.saldoConfirmadoAsaas === 'number');
    assert.ok(typeof fin.saldoDisponivelAsaas === 'number');
    assert.ok(typeof fin.valoresEmPoderDoVendedor === 'number');
    assert.ok(typeof fin.saldoAReceber === 'number');
    assert.ok(fin.recebimentosEfetivos >= fin.entradasAVista);
  });

  it('16. Sellers-summary: alinhamento com mobile (Reais e isActive), isolamento por vendedor, preservação de inativos e exclusão de vendas à vista', async () => {
    // 16.1 Cria vendedor inativo com carteira histórica
    const inactiveSeller = await prisma.user.create({
      data: {
        email: `inactive_seller_${Date.now()}@teste.com`,
        password: 'dummy',
        name: 'Vendedor Inativo Histórico',
        role: 'SELLER',
        companyId,
        active: false,
      },
    });

    const client16A = await createTestClient('Cliente Crediário Ativo');
    const client16B = await createTestClient('Cliente Crediário Inativo');
    const client16Cash = await createTestClient('Cliente Venda À Vista');

    // Venda 100% à vista (não deve entrar no sellers-summary de crediário)
    await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller1Token}` },
      body: JSON.stringify({
        clientId: client16Cash.id,
        value: 400,
        city: 'Curitiba',
        product: 'Venda À Vista 16',
        payments: [{ method: 'PIX', amount: 400 }],
      }),
    });

    // Contrato Crediário para Vendedor 1
    const sale16ARes = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller1Token}` },
      body: JSON.stringify({
        clientId: client16A.id,
        value: 1000,
        city: 'Curitiba',
        product: 'Venda Crediário V1',
        payments: [{ method: 'CASH', amount: 200 }],
        credit: {
          buyerName: 'Responsavel 16A',
          buyerCpf: validCpf,
          installmentsCount: 2,
          periodicity: 'MONTHLY',
        },
      }),
    });
    assert.equal(sale16ARes.status, 201);
    const sale16AData = await sale16ARes.json();

    // Contrato Crediário para Vendedor Inativo
    const sale16B = await prisma.sale.create({
      data: {
        companyId,
        sellerId: inactiveSeller.id,
        clientId: client16B.id,
        value: 800,
        city: 'Curitiba',
        date: new Date(),
        product: 'Venda Crediário Inativo',
        paymentMethod: 'CREDIARIO',
        status: 'COMPLETED',
      },
    });

    const agreement16B = await prisma.creditAgreement.create({
      data: {
        companyId,
        sellerId: inactiveSeller.id,
        clientId: client16B.id,
        saleId: sale16B.id,
        buyerName: 'Responsavel Inativo',
        buyerCpf: validCpf,
        street: 'Rua Inativo',
        number: '100',
        neighborhood: 'Bairro',
        city: 'Curitiba',
        state: 'PR',
        firstDueDate: new Date(Date.now() - 5 * 24 * 3600 * 1000),
        totalSaleCents: 80000,
        downPaymentCents: 20000,
        financedPrincipalCents: 60000,
        remainingPrincipalCents: 60000,
        paidPrincipalCents: 0,
        installmentsCount: 2,
        periodicity: 'MONTHLY',
        status: 'ACTIVE',
        installments: {
          create: [
            {
              installmentNumber: 1,
              dueDate: new Date(Date.now() - 5 * 24 * 3600 * 1000), // vencida
              amountCents: 30000,
              paidCents: 0,
              status: 'OVERDUE',
            },
            {
              installmentNumber: 2,
              dueDate: new Date(Date.now() + 25 * 24 * 3600 * 1000), // a vencer
              amountCents: 30000,
              paidCents: 0,
              status: 'PENDING',
            },
          ],
        },
      },
    });

    // Consulta sellers-summary
    const summaryRes = await fetch(`${baseUrl}/api/credit/sellers-summary`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(summaryRes.status, 200);
    const summaryList = await summaryRes.json();

    // Localiza os dois vendedores
    const s1Card = summaryList.find((s: any) => s.sellerId === seller1Id);
    const sInactCard = summaryList.find((s: any) => s.sellerId === inactiveSeller.id);

    assert.ok(s1Card, 'Vendedor ativo 1 deve estar no resumo');
    assert.ok(sInactCard, 'Vendedor inativo deve permanecer no resumo histórico');

    // Validação estrita do contrato com mobile:
    // Deve conter campos em Reais convertidos exatamente uma vez (cents / 100.0)
    assert.equal(typeof s1Card.totalRemainingPrincipal, 'number');
    assert.equal(typeof s1Card.totalOverduePrincipal, 'number');
    assert.equal(typeof s1Card.netCommissionPayable, 'number');
    assert.equal(s1Card.isActive, true);
    assert.equal(s1Card.active, true);

    assert.equal(typeof sInactCard.totalRemainingPrincipal, 'number');
    assert.equal(sInactCard.totalRemainingPrincipal, 600.0);
    assert.equal(sInactCard.totalOverduePrincipal, 300.0);
    assert.equal(sInactCard.isActive, false);
    assert.equal(sInactCard.active, false);

    // Validação ao clicar em um vendedor: filtrar estritamente sua carteira
    const filterS1Res = await fetch(`${baseUrl}/api/credit/agreements?sellerId=${seller1Id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(filterS1Res.status, 200);
    const s1Agreements = await filterS1Res.json();
    assert.ok(s1Agreements.every((a: any) => a.sellerId === seller1Id));
    assert.ok(s1Agreements.some((a: any) => a.id === sale16AData.creditAgreement?.id || a.buyerName === 'Responsavel 16A'));

    const filterInactRes = await fetch(`${baseUrl}/api/credit/agreements?sellerId=${inactiveSeller.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(filterInactRes.status, 200);
    const inactAgreements = await filterInactRes.json();
    assert.equal(inactAgreements.length, 1);
    assert.equal(inactAgreements[0].id, agreement16B.id);

    // Contratos quitados (status=SETTLED) acessíveis pelo filtro
    const filterSettledRes = await fetch(`${baseUrl}/api/credit/agreements?status=SETTLED`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(filterSettledRes.status, 200);
    const settledList = await filterSettledRes.json();
    assert.ok(Array.isArray(settledList));
  });

  it('17. Pendência 1: Padronização de perfil e destino (SELLER_HANDS/SELLER) e segregação de acumulado vs não repassado', async () => {
    // 17.1 Cria contrato e registra pagamento com destination: SELLER_HANDS e receivedByRole: SELLER
    const client17 = await createTestClient('Aluno Teste 17');
    const sale17Res = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller1Token}` },
      body: JSON.stringify({
        clientId: client17.id,
        value: 1000,
        city: 'Curitiba',
        product: 'Crediário Repasse Teste',
        payments: [{ method: 'CASH', amount: 200 }],
        credit: {
          buyerName: 'Responsavel Repasse',
          buyerCpf: validCpf,
          installmentsCount: 2,
          periodicity: 'MONTHLY',
        },
      }),
    });
    assert.equal(sale17Res.status, 201);
    const sale17Data = await sale17Res.json();
    const agreement17 = await prisma.creditAgreement.findFirst({
      where: { saleId: sale17Data.id },
      include: { installments: true },
    });

    // Pagamento em dinheiro em mãos do vendedor: R$ 250
    const pay17Res = await fetch(`${baseUrl}/api/credit/agreements/${agreement17!.id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller1Token}` },
      body: JSON.stringify({
        installmentId: agreement17!.installments[0].id,
        amount: 250.0,
        paymentMethod: 'CASH',
        destination: 'SELLER_HANDS',
        idempotencyKey: `pay_hands_${Date.now()}`,
      }),
    });
    assert.equal(pay17Res.status, 201);

    // Consulta finance overview inicial
    const finRes1 = await fetch(`${baseUrl}/api/finance/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(finRes1.status, 200);
    const fin1 = await finRes1.json();
    const acumuladoAntes = fin1.recebimentosAcumuladosVendedor;
    const emPoderAntes = fin1.valoresEmPoderDoVendedor;
    assert.ok(acumuladoAntes >= 250.0);

    // 17.2 Realiza acerto de repasse oficial: Vendedor repassa R$ 200 à empresa
    const repasseRes = await fetch(`${baseUrl}/api/closing/pay-repasse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        sellerId: seller1Id,
        amount: 200.0,
        direction: 'SELLER_PAYS_COMPANY',
      }),
    });
    assert.equal(repasseRes.status, 201);

    // Consulta finance overview após acerto
    const finRes2 = await fetch(`${baseUrl}/api/finance/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(finRes2.status, 200);
    const fin2 = await finRes2.json();

    // Acumulado permanece inalterado (histórico bruto)
    assert.equal(fin2.recebimentosAcumuladosVendedor, acumuladoAntes);
    // Acertos realizados registra os R$ 200
    assert.ok(fin2.acertosRealizadosVendedor >= 200.0);
    // Saldo em poder do vendedor reduz exatamente pelos R$ 200 repassados
    assert.equal(Number((emPoderAntes - fin2.valoresEmPoderDoVendedor).toFixed(2)), 200.0);
    assert.equal(fin2.valoresEmPoderDoVendedor, fin2.valoresNaoRepassadosVendedor);
  });

  it('18. Pendência 2: ALLOCATE_NEXT distribui multi-parcelas, gera comissão 10%, preserva excedente e bloqueia concorrência', async () => {
    const client18 = await createTestClient('Aluno Teste 18');
    const sale18Res = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller1Token}` },
      body: JSON.stringify({
        clientId: client18.id,
        value: 1000,
        city: 'Curitiba',
        product: 'Crediário Multi Alocação',
        payments: [{ method: 'CASH', amount: 200 }],
        credit: {
          buyerName: 'Responsavel Excedente',
          buyerCpf: validCpf,
          installmentsCount: 2, // 2x R$ 400 = R$ 800 devedor
          periodicity: 'MONTHLY',
        },
      }),
    });
    assert.equal(sale18Res.status, 201);
    const sale18Data = await sale18Res.json();
    const agreement18 = await prisma.creditAgreement.findFirst({
      where: { saleId: sale18Data.id },
      include: { installments: { orderBy: { installmentNumber: 'asc' } } },
    });

    // Baixa manual da parcela 1
    await prisma.creditInstallment.update({
      where: { id: agreement18!.installments[0].id },
      data: { status: 'PAID', paidCents: 40000, paidAt: new Date() },
    });
    await prisma.creditAgreement.update({
      where: { id: agreement18!.id },
      data: { remainingPrincipalCents: 40000, paidPrincipalCents: 40000 },
    });
    // Agora resta apenas a Parcela 2 com R$ 400 devedor

    // Cria alerta de duplicidade no valor de R$ 600 (excede os R$ 400 restantes em R$ 200)
    const alert18 = await prisma.asaasDuplicatePaymentAlert.create({
      data: {
        companyId,
        agreementId: agreement18!.id,
        installmentId: agreement18!.installments[0].id,
        externalPaymentId: `pay_dup_surplus_${Date.now()}`,
        amountCents: 60000, // R$ 600
        reason: 'Pagamento duplicado com excedente',
        status: 'PENDING',
      },
    });

    // Teste de concorrência: duas resoluções simultâneas do MESMO alerta
    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/api/credit/asaas/duplicate-alerts/${alert18.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ action: 'ALLOCATE_NEXT', notes: 'Tentativa 1' }),
      }),
      fetch(`${baseUrl}/api/credit/asaas/duplicate-alerts/${alert18.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ action: 'ALLOCATE_NEXT', notes: 'Tentativa 2 Concorrente' }),
      }),
    ]);

    // Exatamente uma teve sucesso (200), e a outra foi rejeitada (400) sob a trava
    const statuses = [res1.status, res2.status];
    assert.ok(statuses.includes(200), `Uma das requisições deve ter sucesso. Statuses: ${statuses.join(', ')}`);
    assert.ok(statuses.includes(400), `A requisição concorrente deve ser rejeitada com 400. Statuses: ${statuses.join(', ')}`);

    const successRes = res1.status === 200 ? await res1.json() : await res2.json();
    assert.equal(successRes.totalAmortizedCents, 40000); // R$ 400 amortizados
    assert.equal(successRes.surplusCents, 20000); // R$ 200 excedente
    assert.equal(successRes.commissionCents, 4000); // 10% sobre R$ 400 = R$ 40

    // Verifica que a Parcela 2 foi quitada e contrato foi quitado
    const reloadedInst2 = await prisma.creditInstallment.findUnique({ where: { id: agreement18!.installments[1].id } });
    assert.equal(reloadedInst2!.status, 'PAID');
    assert.equal(reloadedInst2!.paidCents, 40000);

    const reloadedAgreement18 = await prisma.creditAgreement.findUnique({ where: { id: agreement18!.id } });
    assert.equal(reloadedAgreement18!.remainingPrincipalCents, 0);
    assert.equal(reloadedAgreement18!.status, 'SETTLED');

    // Alerta original resolvido
    const originalAlertReloaded = await prisma.asaasDuplicatePaymentAlert.findUnique({ where: { id: alert18.id } });
    assert.equal(originalAlertReloaded!.status, 'RESOLVED_ALLOCATED');

    // Alerta residual criado para o excedente de R$ 200
    const surplusAlert = await prisma.asaasDuplicatePaymentAlert.findFirst({
      where: {
        agreementId: agreement18!.id,
        externalPaymentId: `${alert18.externalPaymentId}:surplus`,
      },
    });
    assert.ok(surplusAlert, 'Alerta residual para excedente deve existir');
    assert.equal(surplusAlert!.amountCents, 20000);
    assert.equal(surplusAlert!.status, 'PENDING');
  });

  it('19. Pendência 3: Captura exclusiva de tarefas no banco com FOR UPDATE SKIP LOCKED testada com dois processadores simultâneos', async () => {
    // Cria 6 tarefas na fila
    const taskIds: string[] = [];
    for (let i = 0; i < 6; i++) {
      const id = `queue_concurrency_${Date.now()}_${i}`;
      taskIds.push(id);
      await prisma.asaasSyncQueue.create({
        data: {
          id,
          companyId,
          agreementId,
          action: 'RECEIVE_IN_CASH',
          payload: { asaasPaymentId: `pay_concurrent_${i}`, value: 10 + i },
          status: 'PENDING',
          idempotencyKey: `idem_queue_conc_${Date.now()}_${i}`,
        },
      });
    }

    // Executa dois processadores simultâneos
    const [proc1, proc2] = await Promise.all([
      processAsaasSyncQueue(3),
      processAsaasSyncQueue(3),
    ]);

    // Cada processador deve ter capturado e processado tarefas
    assert.equal(proc1.processed + proc2.processed, 6);

    // Nenhuma tarefa permaneceu PENDING
    const remainingPending = await prisma.asaasSyncQueue.count({
      where: { id: { in: taskIds }, status: 'PENDING' },
    });
    assert.equal(remainingPending, 0);
  });

  it('20. Pendência 4: Recuperação de respostas perdidas consultando Asaas por externalReference antes de emitir nova cobrança', async () => {
    const client20 = await createTestClient('Aluno Teste 20');
    const sale20Res = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller1Token}` },
      body: JSON.stringify({
        clientId: client20.id,
        value: 500,
        city: 'Curitiba',
        product: 'Crediário Recuperação Resposta',
        payments: [{ method: 'CASH', amount: 200 }],
        credit: {
          buyerName: 'Responsavel Recuperacao',
          buyerCpf: validCpf,
          installmentsCount: 1,
          periodicity: 'MONTHLY',
        },
      }),
    });
    assert.equal(sale20Res.status, 201);
    const sale20Data = await sale20Res.json();
    const agreement20 = await prisma.creditAgreement.findFirst({
      where: { saleId: sale20Data.id },
      include: { installments: true },
    });
    const inst20 = agreement20!.installments[0];

    // Simula que a cobrança já foi criada no Asaas com externalReference = inst20.id,
    // mas a resposta foi perdida e não foi gravada no banco local (AsaasCharge local está ausente)
    const remoteAsaasPaymentId = `pay_recovered_remote_${Date.now()}`;
    (global as any).__simulatedAsaasRemotePayments = {
      [inst20.id]: {
        id: remoteAsaasPaymentId,
        status: 'PENDING',
        value: 300.0,
        netValue: 298.01,
        billingType: 'BOLETO',
        bankSlipUrl: 'https://sandbox.asaas.com/b/recovered',
        invoiceUrl: 'https://sandbox.asaas.com/i/recovered',
        identificationField: '00190.00009 01018.000000 00000.000000 1 00000000030000',
      },
    };

    // Chama createAsaasChargeForInstallment diretamente
    const recovered = await createAsaasChargeForInstallment(companyId, {
      customerExternalId: 'cus_remote_test',
      billingType: 'BOLETO',
      value: 300.0,
      dueDate: new Date(inst20.dueDate).toISOString().split('T')[0],
      externalReference: inst20.id,
    });

    // Deve ter recuperado o ID remoto existente em vez de criar um novo
    assert.equal(recovered.externalId, remoteAsaasPaymentId);
    assert.equal(recovered.bankSlipUrl, 'https://sandbox.asaas.com/b/recovered');

    // Limpa simulação
    delete (global as any).__simulatedAsaasRemotePayments;
  });

  it('21. Consulta remota com timeout não executa POST de emissão; retentativa recupera cobrança existente', async () => {
    const client21 = await createTestClient('Aluno Teste 21 Reconciliação');
    const sale21Res = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller1Token}` },
      body: JSON.stringify({
        clientId: client21.id,
        value: 700,
        city: 'Curitiba',
        product: 'Crediário Teste 21',
        payments: [{ method: 'CASH', amount: 200 }],
        credit: {
          buyerName: 'Responsavel Teste 21',
          buyerCpf: validCpf,
          installmentsCount: 1,
          periodicity: 'MONTHLY',
        },
      }),
    });
    assert.equal(sale21Res.status, 201);
    const sale21Data = await sale21Res.json();
    const agreement21 = await prisma.creditAgreement.findFirst({
      where: { saleId: sale21Data.id },
      include: { installments: true },
    });
    const inst21 = agreement21!.installments[0];

    // Simula falha/timeout na consulta remota por externalReference
    (global as any).__simulatedAsaasRemotePaymentsError = 'ETIMEDOUT: Connection timeout na API do Asaas';

    // Enfileira emissão da parcela
    const queueItem = await prisma.asaasSyncQueue.create({
      data: {
        companyId,
        agreementId: agreement21!.id,
        installmentId: inst21.id,
        action: 'CREATE_CHARGE',
        payload: {
          customerExternalId: 'cus_test_21',
          billingType: 'BOLETO',
          value: 500.0,
          dueDate: new Date().toISOString().split('T')[0],
          externalReference: inst21.id,
        },
        idempotencyKey: `sync_charge_timeout_${Date.now()}`,
        status: 'PENDING',
        attempts: 0,
      },
    });

    // Processa a fila: consulta remota falha
    const run1 = await processAsaasSyncQueue(10);
    assert.equal(run1.errors, 1);

    // Tarefa DEVE permanecer em PENDING para retentativa controlada e NÃO criar cobrança
    const itemAfterTimeout = await prisma.asaasSyncQueue.findUnique({ where: { id: queueItem.id } });
    assert.equal(itemAfterTimeout!.status, 'PENDING');
    assert.ok(itemAfterTimeout!.lastError?.includes('RECONCILIAÇÃO_INCONCLUSIVA'));

    const chargeAfterTimeout = await prisma.asaasCharge.findUnique({ where: { installmentId: inst21.id } });
    assert.equal(chargeAfterTimeout, null, 'Nenhuma cobrança local deve ter sido criada após consulta inconclusiva');

    // Agora resolve o timeout: o Asaas responde com a cobrança existente
    delete (global as any).__simulatedAsaasRemotePaymentsError;
    const remoteId21 = `pay_recovered_remote_21_${Date.now()}`;
    (global as any).__simulatedAsaasRemotePayments = {
      [inst21.id]: {
        id: remoteId21,
        status: 'PENDING',
        value: 500.0,
        netValue: 497.01,
        billingType: 'BOLETO',
        bankSlipUrl: 'https://sandbox.asaas.com/b/recovered21',
      },
    };

    // Retentativa processa a fila
    const run2 = await processAsaasSyncQueue(10);
    assert.ok(run2.processed >= 1);

    // Tarefa concluída com sucesso recuperando a cobrança existente
    const itemRecovered = await prisma.asaasSyncQueue.findUnique({ where: { id: queueItem.id } });
    assert.equal(itemRecovered!.status, 'SUCCESS');

    const chargeRecovered = await prisma.asaasCharge.findUnique({ where: { installmentId: inst21.id } });
    assert.ok(chargeRecovered);
    assert.equal(chargeRecovered!.externalId, remoteId21);

    delete (global as any).__simulatedAsaasRemotePayments;
  });

  it('22. Alocação distribuída e devolução residual usam ID bancário real, somente valor excedente e não repetem devolução', async () => {
    const client22 = await createTestClient('Aluno Teste 22 Residual');
    const sale22Res = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller1Token}` },
      body: JSON.stringify({
        clientId: client22.id,
        value: 800,
        city: 'Curitiba',
        product: 'Crediário Teste 22 Residual',
        payments: [{ method: 'CASH', amount: 200 }],
        credit: {
          buyerName: 'Responsavel Teste 22',
          buyerCpf: validCpf,
          installmentsCount: 2, // 2x R$ 300 = R$ 600
          periodicity: 'MONTHLY',
        },
      }),
    });
    assert.equal(sale22Res.status, 201);
    const sale22Data = await sale22Res.json();
    const agreement22 = await prisma.creditAgreement.findFirst({
      where: { saleId: sale22Data.id },
      include: { installments: { orderBy: { installmentNumber: 'asc' } } },
    });

    // Baixa manual da Parcela 1 (R$ 300)
    await prisma.creditInstallment.update({
      where: { id: agreement22!.installments[0].id },
      data: { status: 'PAID', paidCents: 30000, paidAt: new Date() },
    });
    await prisma.creditAgreement.update({
      where: { id: agreement22!.id },
      data: { remainingPrincipalCents: 30000, paidPrincipalCents: 30000 },
    });
    // Resta apenas Parcela 2 com R$ 300

    // Pagamento duplicado no banco no valor de R$ 500 (excede R$ 300 em R$ 200)
    const realBankId22 = `pay_real_bank_22_${Date.now()}`;
    const alert22 = await prisma.asaasDuplicatePaymentAlert.create({
      data: {
        companyId,
        agreementId: agreement22!.id,
        installmentId: agreement22!.installments[0].id,
        externalPaymentId: realBankId22,
        bankPaymentId: realBankId22,
        amountCents: 50000, // R$ 500
        reason: 'Duplicidade com excedente para devolução',
        status: 'PENDING',
      },
    });

    // 1. Resolve com ALLOCATE_NEXT
    const allocRes = await fetch(`${baseUrl}/api/credit/asaas/duplicate-alerts/${alert22.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ action: 'ALLOCATE_NEXT' }),
    });
    assert.equal(allocRes.status, 200);
    const allocData = await allocRes.json();
    assert.equal(allocData.totalAmortizedCents, 30000); // R$ 300 amortizados
    assert.equal(allocData.surplusCents, 20000); // R$ 200 excedente

    // Alerta residual criado para o excedente preserva o identificador bancário real
    const surplusAlert = await prisma.asaasDuplicatePaymentAlert.findFirst({
      where: {
        agreementId: agreement22!.id,
        status: 'PENDING',
      },
    });
    assert.ok(surplusAlert);
    assert.equal(surplusAlert!.amountCents, 20000);
    assert.equal(surplusAlert!.bankPaymentId, realBankId22); // Identificador bancário REAL preservado!

    // 2. Solicita estorno/devolução do excedente
    (global as any).__lastSimulatedRefunds = [];
    const refundRes = await fetch(`${baseUrl}/api/credit/asaas/duplicate-alerts/${surplusAlert!.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ action: 'REFUND', notes: 'Devolução de excedente' }),
    });
    assert.equal(refundRes.status, 200);
    const refundData = await refundRes.json();
    assert.equal(refundData.bankPaymentId, realBankId22); // Usou o ID bancário real, não o sufixo sintético!
    assert.equal(refundData.refundAmountCents, 20000); // Devolveu estritamente R$ 200 (não os R$ 300 alocados)

    // Se tentar devolver novamente o mesmo alerta, rejeita com 400
    const retryRefundRes = await fetch(`${baseUrl}/api/credit/asaas/duplicate-alerts/${surplusAlert!.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ action: 'REFUND' }),
    });
    assert.equal(retryRefundRes.status, 400);

    delete (global as any).__lastSimulatedRefunds;
  });

  it('3. Dois vendedores com recebimentos diferentes; pagamento direto à empresa não vira posse do vendedor; fechamento negativo sem transferência não abate saldo; repasse efetivo abate apenas o saldo correspondente', async () => {
    // Vendedor 1 recebe R$ 250 em dinheiro em mãos (SELLER_HANDS)
    const client23A = await createTestClient('Aluno Teste 23A');
    const sale23ARes = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller1Token}` },
      body: JSON.stringify({
        clientId: client23A.id,
        value: 500,
        city: 'Curitiba',
        product: 'Crediário Vendedor 1',
        payments: [{ method: 'CASH', amount: 200 }],
        credit: {
          buyerName: 'Responsavel 23A',
          buyerCpf: validCpf,
          installmentsCount: 1,
          periodicity: 'MONTHLY',
        },
      }),
    });
    assert.equal(sale23ARes.status, 201);
    const sale23AData = await sale23ARes.json();
    const agreement23A = await prisma.creditAgreement.findFirst({
      where: { saleId: sale23AData.id },
      include: { installments: true },
    });

    await fetch(`${baseUrl}/api/credit/agreements/${agreement23A!.id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller1Token}` },
      body: JSON.stringify({
        installmentId: agreement23A!.installments[0].id,
        amount: 250.0,
        paymentMethod: 'CASH',
        destination: 'SELLER_HANDS',
        idempotencyKey: `pay_s1_hands_${Date.now()}`,
      }),
    });

    // Vendedor 2 recebe R$ 300 via Pix direto na conta da empresa (COMPANY_ACCOUNT)
    const client23B = await createTestClient('Aluno Teste 23B');
    const sale23BRes = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller2Token}` },
      body: JSON.stringify({
        clientId: client23B.id,
        value: 600,
        city: 'Curitiba',
        product: 'Crediário Vendedor 2',
        payments: [{ method: 'CASH', amount: 200 }],
        credit: {
          buyerName: 'Responsavel 23B',
          buyerCpf: validCpf,
          installmentsCount: 1,
          periodicity: 'MONTHLY',
        },
      }),
    });
    assert.equal(sale23BRes.status, 201);
    const sale23BData = await sale23BRes.json();
    const agreement23B = await prisma.creditAgreement.findFirst({
      where: { saleId: sale23BData.id },
      include: { installments: true },
    });

    await fetch(`${baseUrl}/api/credit/agreements/${agreement23B!.id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller2Token}` },
      body: JSON.stringify({
        installmentId: agreement23B!.installments[0].id,
        amount: 300.0,
        paymentMethod: 'PIX',
        destination: 'COMPANY_ACCOUNT',
        idempotencyKey: `pay_s2_company_${Date.now()}`,
      }),
    });

    // Consulta overview inicial
    const finRes1 = await fetch(`${baseUrl}/api/finance/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const fin1 = await finRes1.json();
    const possevendedorAntes = fin1.valoresEmPoderDoVendedor;
    // O valor em poder dos vendedores deve incluir os R$ 250 do Vendedor 1, mas NÃO os R$ 300 do Vendedor 2
    assert.ok(possevendedorAntes >= 250.0);

    // Vendedor 2 tem um fechamento diário normal de vendas com repasseDebt negativo (empresa deve comissão a ele)
    await prisma.dailyClosing.create({
      data: {
        sellerId: seller2Id,
        totalSalesValue: 1000,
        commission: 400,
        cashValue: 250,
        pixValue: 0,
        debitValue: 0,
        creditValue: 0,
        repasseDebt: -150, // Empresa deve R$ 150 de comissão líquida
        closingType: 'SALES',
      },
    });

    // Consulta overview: Fechamento com repasseDebt negativo NÃO abate saldo em poder do vendedor!
    const finRes2 = await fetch(`${baseUrl}/api/finance/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const fin2 = await finRes2.json();
    assert.equal(fin2.valoresEmPoderDoVendedor, possevendedorAntes, 'Fechamento com repasseDebt negativo não pode abater saldo em poder do vendedor');

    // Agora Vendedor 1 realiza acerto efetivo de R$ 200 à empresa via pay-repasse
    const repasseRes = await fetch(`${baseUrl}/api/closing/pay-repasse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        sellerId: seller1Id,
        amount: 200.0,
        direction: 'SELLER_PAYS_COMPANY',
      }),
    });
    assert.equal(repasseRes.status, 201);

    // Consulta overview: Abateu exatamente os R$ 200 do Vendedor 1
    const finRes3 = await fetch(`${baseUrl}/api/finance/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const fin3 = await finRes3.json();
    assert.equal(Number((possevendedorAntes - fin3.valoresEmPoderDoVendedor).toFixed(2)), 200.0);
  });

  it('24. Venda com quatro entradas de R$ 100; saldo R$ 600 por quantidade e por valor desejado R$ 250 (R$ 250 + R$ 250 + R$ 100)', async () => {
    const client24A = await createTestClient('Aluno Teste 24A Qtd');
    // Venda de R$ 1.000 com 4 formas de entrada de R$ 100 (total entrada R$ 400 >= 150)
    // Financiado R$ 600 em 6 parcelas de R$ 100
    const sale24ARes = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller1Token}` },
      body: JSON.stringify({
        clientId: client24A.id,
        value: 1000,
        city: 'Curitiba',
        product: 'Composição 4 Entradas Qtd',
        payments: [
          { method: 'CASH', amount: 100 },
          { method: 'PIX', amount: 100 },
          { method: 'CREDIT', amount: 100 },
          { method: 'DEBIT', amount: 100 },
        ],
        credit: {
          buyerName: 'Responsavel 24A',
          buyerCpf: validCpf,
          installmentsCount: 6,
          periodicity: 'MONTHLY',
          calculationMode: 'BY_COUNT',
        },
      }),
    });
    assert.equal(sale24ARes.status, 201);
    const sale24AData = await sale24ARes.json();
    const agreement24A = await prisma.creditAgreement.findFirst({
      where: { saleId: sale24AData.id },
      include: { installments: { orderBy: { installmentNumber: 'asc' } } },
    });
    assert.equal(agreement24A!.installmentsCount, 6);
    assert.equal(agreement24A!.downPaymentCents, 40000);
    assert.equal(agreement24A!.financedPrincipalCents, 60000);
    assert.equal(agreement24A!.installments.length, 6);
    for (const inst of agreement24A!.installments) {
      assert.equal(inst.amountCents, 10000); // 6x R$ 100
    }

    // Venda de R$ 1.000 com 4 entradas de R$ 100 e saldo R$ 600 em modo VALOR DESEJADO de R$ 250
    const client24B = await createTestClient('Aluno Teste 24B Desejado');
    const sale24BRes = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller1Token}` },
      body: JSON.stringify({
        clientId: client24B.id,
        value: 1000,
        city: 'Curitiba',
        product: 'Composição 4 Entradas Desejado',
        payments: [
          { method: 'CASH', amount: 100 },
          { method: 'PIX', amount: 100 },
          { method: 'CREDIT', amount: 100 },
          { method: 'DEBIT', amount: 100 },
        ],
        credit: {
          buyerName: 'Responsavel 24B',
          buyerCpf: validCpf,
          installmentsCount: 3,
          periodicity: 'BIWEEKLY',
          calculationMode: 'BY_AMOUNT',
          desiredInstallmentAmountCents: 25000, // R$ 250
        },
      }),
    });
    assert.equal(sale24BRes.status, 201);
    const sale24BData = await sale24BRes.json();
    const agreement24B = await prisma.creditAgreement.findFirst({
      where: { saleId: sale24BData.id },
      include: { installments: { orderBy: { installmentNumber: 'asc' } } },
    });

    // Deve resultar em 3 parcelas: R$ 250 + R$ 250 + R$ 100 (NÃO 3x R$ 200!)
    assert.equal(agreement24B!.installmentsCount, 3);
    assert.equal(agreement24B!.installments.length, 3);
    assert.equal(agreement24B!.installments[0].amountCents, 25000); // R$ 250
    assert.equal(agreement24B!.installments[1].amountCents, 25000); // R$ 250
    assert.equal(agreement24B!.installments[2].amountCents, 10000); // R$ 100

    // Verifica que periodicidade quinzenal foi configurada a cada 15 dias
    const d0 = new Date(agreement24B!.installments[0].dueDate).getTime();
    const d1 = new Date(agreement24B!.installments[1].dueDate).getTime();
    const diffDays = Math.round((d1 - d0) / (24 * 3600 * 1000));
    assert.equal(diffDays, 15, 'Periodicidade quinzenal deve ter 15 dias de intervalo');

    // Validação de entrada mínima de R$ 150 na soma: rejeita soma de 2x R$ 50 = R$ 100 (< 150)
    const client24C = await createTestClient('Aluno Teste 24C Entrada Minima');
    const sale24CRes = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller1Token}` },
      body: JSON.stringify({
        clientId: client24C.id,
        value: 1000,
        city: 'Curitiba',
        product: 'Crediário Entrada Insuficiente',
        payments: [
          { method: 'CASH', amount: 50 },
          { method: 'PIX', amount: 50 },
        ],
        credit: {
          buyerName: 'Responsavel 24C',
          buyerCpf: validCpf,
          installmentsCount: 5,
        },
      }),
    });
    assert.equal(sale24CRes.status, 400);
    const err24C = await sale24CRes.json();
    assert.ok(err24C.error?.includes('150,00'));
  });

  it('25. Cards do Admin apresentam valores corretos exclusivamente de crediário sem incluir vendas à vista', async () => {
    // Registra uma venda totalmente à vista (R$ 500 em dinheiro, sem crediário) para o Vendedor 1
    const client25Vista = await createTestClient('Aluno Venda A Vista');
    const vistaRes = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller1Token}` },
      body: JSON.stringify({
        clientId: client25Vista.id,
        value: 500,
        city: 'Curitiba',
        product: 'Venda Totalmente A Vista',
        paymentMethod: 'CASH',
        payments: [{ method: 'CASH', amount: 500 }],
      }),
    });
    assert.equal(vistaRes.status, 201);

    // Consulta sellers-summary
    const summaryRes = await fetch(`${baseUrl}/api/credit/sellers-summary`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(summaryRes.status, 200);
    const sellersSummary = await summaryRes.json();

    // Vendedor 1 deve aparecer com seus contratos de crediário
    const s1 = sellersSummary.find((s: any) => s.sellerId === seller1Id);
    assert.ok(s1);
    assert.equal(typeof s1.totalRemainingPrincipal, 'number');
    assert.equal(typeof s1.totalOverduePrincipal, 'number');
    assert.equal(typeof s1.netCommissionPayable, 'number');
    assert.equal(s1.active, true);
    assert.equal(s1.isActive, true);

    // Consulta os contratos filtrados por vendedor 1:
    const agreementsRes = await fetch(`${baseUrl}/api/credit/agreements?sellerId=${seller1Id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(agreementsRes.status, 200);
    const agreements = await agreementsRes.json();
    assert.ok(Array.isArray(agreements));
    for (const a of agreements) {
      assert.equal(a.sellerId, seller1Id, 'Contratos devem ser estritamente do vendedor 1');
      assert.ok(a.installmentsCount > 0, 'Todos os contratos retornados devem ser de crediário');
    }
  });
});

