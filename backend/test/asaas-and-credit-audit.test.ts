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
  const seller1Id = `seller1_${uid}`;
  const seller2Id = `seller2_${uid}`;
  const adminId = `admin_${uid}`;

  let seller1Token: string;
  let seller2Token: string;
  let adminToken: string;

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

    await prisma.company.create({
      data: { id: companyId, name: 'Empresa Teste Asaas Audit' },
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
      ],
    });

    seller1Token = generateToken({ id: seller1Id, role: 'SELLER', companyId, name: 'Vendedor Titular' });
    seller2Token = generateToken({ id: seller2Id, role: 'SELLER', companyId, name: 'Vendedor Externo' });
    adminToken = generateToken({ id: adminId, role: 'COMPANY_ADMIN', companyId, name: 'Administrador Geral' });

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
    try {
      await prisma.asaasDuplicatePaymentAlert.deleteMany({ where: { companyId } });
      await prisma.asaasSyncQueue.deleteMany({ where: { companyId } });
      await prisma.asaasCharge.deleteMany({ where: { companyId } });
      await prisma.asaasWebhookEvent.deleteMany({ where: { companyId } });
      await prisma.asaasConfig.deleteMany({ where: { companyId } });
      await prisma.creditCommissionAdjustment.deleteMany({ where: { companyId } });
      await prisma.creditCommission.deleteMany({ where: { companyId } });
      await prisma.creditPaymentAllocation.deleteMany({ where: { payment: { companyId } } });
      await prisma.creditPayment.deleteMany({ where: { companyId } });
      await prisma.creditAgreementRenegotiation.deleteMany({ where: { agreement: { companyId } } });
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
      update: { webhookToken: 'secret_token_123', mode: 'SANDBOX' },
      create: { companyId, webhookToken: 'secret_token_123', mode: 'SANDBOX' },
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
        'asaas-access-token': 'secret_token_123',
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
        'asaas-access-token': 'secret_token_123',
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

  it('7. Pagamento em Duplicidade: Baixa Manual seguida de Webhook Bancário gera Alerta de Conciliação', async () => {
    // Parcela 3: recebe pagamento em dinheiro no app
    const agreement = await prisma.creditAgreement.findUnique({
      where: { id: agreementId },
      include: { installments: { orderBy: { installmentNumber: 'asc' } } },
    });
    const inst3 = agreement!.installments[2];

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
    const duplicatePaymentId = `pay_asaas_dup_${Date.now()}`;
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
        'asaas-access-token': 'secret_token_123',
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
      body: JSON.stringify({ action: 'ALLOCATE_NEXT', notes: 'Compensado na última parcela' }),
    });
    assert.equal(resolveRes.status, 200);

    const resolvedAlert = await prisma.asaasDuplicatePaymentAlert.findUnique({
      where: { id: alert!.id },
    });
    assert.ok(resolvedAlert!.status.startsWith('RESOLVED'));
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
    // Inst1: estornada (saldo R$ 200)
    // Inst2: Paga (R$ 200)
    // Inst3: Paga (R$ 200)
    // Inst4: Parcial paga R$ 50 (restante R$ 150)
    // Saldo restante total = R$ 350.00
    const remainingBefore = (await prisma.creditAgreement.findUnique({ where: { id: agreementId } }))!.remainingPrincipalCents;
    assert.equal(remainingBefore, 35000);

    // Renegocia o saldo restante de R$ 350 em 2 novas parcelas de R$ 175
    const renegotiateRes = await fetch(`${baseUrl}/api/credit/agreements/${agreementId}/renegotiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller1Token}` },
      body: JSON.stringify({
        numberOfInstallments: 2,
        frequency: 'MONTHLY',
        firstDueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
        notes: 'Renegociação de saldo residual de R$ 350',
        idempotencyKey: `reneg_${Date.now()}`,
      }),
    });
    assert.equal(renegotiateRes.status, 200);

    // Verifica que inst4 foi marcada como RENEGOTIATED e seu histórico de R$ 50 pago foi preservado
    const inst4After = await prisma.creditInstallment.findUnique({ where: { id: inst4.id } });
    assert.equal(inst4After!.status, 'RENEGOTIATED');
    assert.equal(inst4After!.paidCents, 5000);

    // Verifica que as novas parcelas foram geradas EXCLUSIVAMENTE sobre o saldo devedor de R$ 350 (2x R$ 175)
    const newInstallments = await prisma.creditInstallment.findMany({
      where: { agreementId, status: 'PENDING' },
      orderBy: { installmentNumber: 'asc' },
    });
    assert.equal(newInstallments.length, 2);
    const sumNew = newInstallments.reduce((acc, i) => acc + i.amountCents, 0);
    assert.equal(sumNew, 35000);
    assert.equal(newInstallments[0].amountCents, 17500);
    assert.equal(newInstallments[1].amountCents, 17500);
  });
});
