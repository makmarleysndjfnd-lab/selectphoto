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
import { processAsaasSyncQueue } from '../src/services/asaasService';

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
});
