import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import {
  processMonthlyCreditClosing,
  recordMonthlyCreditPayout,
  calculateSellerMonthlyCreditClosing,
  reconcileLegacyInstallmentCommissions,
} from '../src/services/monthlyCreditClosingService';

const prisma = new PrismaClient();

describe('ETAPA 2 — CORREÇÕES FINANCEIRAS: COST REAL, SALDO RESIDUAL E ISOLAMENTO DE LIQUIDADAS', () => {
  const uid = 'fin_' + Date.now();
  const companyId = 'comp_' + uid;
  const sellerId = 'seller_' + uid;
  const adminId = 'admin_' + uid;
  let agreementId: string;

  before(async () => {
    await prisma.company.create({
      data: { id: companyId, name: 'Empresa Teste Financeiro' },
    });

    await prisma.user.createMany({
      data: [
        {
          id: sellerId,
          companyId,
          name: 'Vendedor Financeiro',
          email: `${sellerId}@test.com`,
          password: 'dummy',
          role: 'SELLER',
          usesOwnCar: true,
        },
        {
          id: adminId,
          companyId,
          name: 'Admin Financeiro',
          email: `${adminId}@test.com`,
          password: 'dummy',
          role: 'ADMIN',
        },
      ],
    });

    const client = await prisma.client.create({
      data: {
        sequenceNumber: 'FIN_' + uid,
        name: 'Cliente Teste Financeiro',
        city: 'Cidade Teste',
        companyId,
        assignedSellerId: sellerId,
      },
    });

    const sale = await prisma.sale.create({
      data: {
        companyId,
        sellerId,
        clientId: client.id,
        value: 1000,
        city: 'Cidade Teste',
        paymentMethod: 'CREDIARIO',
        status: 'PRONTO',
      },
    });

    const agreement = await txOrPrisma(prisma).creditAgreement.create({
      data: {
        saleId: sale.id,
        companyId,
        sellerId,
        clientId: client.id,
        buyerName: 'Comprador Teste',
        buyerCpf: '11122233344',
        street: 'Rua Teste',
        number: '123',
        neighborhood: 'Bairro Teste',
        city: 'Cidade Teste',
        state: 'SP',
        totalSaleCents: 100000,
        downPaymentCents: 20000,
        financedPrincipalCents: 80000,
        remainingPrincipalCents: 80000,
        installmentsCount: 8,
        firstDueDate: new Date('2026-06-10T12:00:00Z'),
        status: 'ACTIVE',
        initialCommissionRate: 0.25,
        installmentCommissionRate: 0.10,
      },
    });
    agreementId = agreement.id;
  });

  after(async () => {
    await prisma.$disconnect();
  });

  function txOrPrisma(p: any) {
    return p;
  }

  it('Correção 1: recordMonthlyCreditPayout cria Cost real aprovado e replay idempotente não duplica saída', async () => {
    // 1. Criar um pagamento em competência passada (2026-04)
    const paidAt = new Date('2026-04-15T15:00:00.000Z');
    const payment = await prisma.creditPayment.create({
      data: {
        agreementId,
        companyId,
        amountCents: 30000, // R$ 300
        paymentMethod: 'PIX',
        receivedByRole: 'ADMIN',
        receiverUserId: adminId,
        destination: 'COMPANY_ACCOUNT',
        paidAt,
      },
    });

    await prisma.creditCommission.create({
      data: {
        agreementId,
        paymentId: payment.id,
        companyId,
        sellerId,
        amountCents: 3000, // R$ 30 (10% de 300)
        status: 'RELEASED',
        type: 'INSTALLMENT',
        createdAt: paidAt,
      },
    });

    // Fechar competência 2026-04
    const { closing } = await processMonthlyCreditClosing({
      companyId,
      sellerId,
      competence: '2026-04',
      closedByUserId: adminId,
    });

    assert.equal(closing.netCommissionCents, 3000); // R$ 30
    assert.equal(closing.remainingBalanceCents, 3000);

    const idempotencyKey = `idem_payout_${uid}_fin_1`;

    // Realizar acerto parcial de R$ 15 (1500 centavos)
    const res1 = await recordMonthlyCreditPayout({
      closingId: closing.id,
      companyId,
      authorId: adminId,
      amountCents: 1500,
      paymentMethod: 'PIX',
      notes: 'Primeiro acerto parcial',
      idempotencyKey,
    });

    assert.equal(res1.idempotentReplay, false);
    assert.equal(res1.closing?.paidAmountCents, 1500);
    assert.equal(res1.closing?.remainingBalanceCents, 1500);

    // Verificar se Cost correspondente foi criado no banco
    const costsAfterFirst = await prisma.cost.findMany({
      where: {
        companyId,
        userId: sellerId,
        category: 'COMMISSION',
        subcategory: 'MONTHLY_CREDIT',
      },
    });

    assert.equal(costsAfterFirst.length, 1);
    assert.equal(costsAfterFirst[0].amount, 15.00);
    assert.equal(costsAfterFirst[0].status, 'APPROVED');

    // Replay com a MESMA idempotencyKey
    const resReplay = await recordMonthlyCreditPayout({
      closingId: closing.id,
      companyId,
      authorId: adminId,
      amountCents: 1500,
      paymentMethod: 'PIX',
      notes: 'Primeiro acerto parcial',
      idempotencyKey,
    });

    assert.equal(resReplay.idempotentReplay, true);

    // Contagem de Cost DEVE continuar rigorosamente 1 (não duplicou saída financeira)
    const costsAfterReplay = await prisma.cost.findMany({
      where: {
        companyId,
        userId: sellerId,
        category: 'COMMISSION',
        subcategory: 'MONTHLY_CREDIT',
      },
    });
    assert.equal(costsAfterReplay.length, 1);

    // Quitar os R$ 15 restantes com nova chave de idempotência
    const res2 = await recordMonthlyCreditPayout({
      closingId: closing.id,
      companyId,
      authorId: adminId,
      amountCents: 1500,
      paymentMethod: 'PIX',
      notes: 'Segundo acerto final',
      idempotencyKey: `idem_payout_${uid}_fin_2`,
    });

    assert.equal(res2.closing?.status, 'PAID');
    assert.equal(res2.closing?.remainingBalanceCents, 0);

    // Contagem de Cost agora DEVE ser exatamente 2 (15 + 15 = R$ 30)
    const costsTotal = await prisma.cost.findMany({
      where: {
        companyId,
        userId: sellerId,
        category: 'COMMISSION',
        subcategory: 'MONTHLY_CREDIT',
      },
    });
    assert.equal(costsTotal.length, 2);
    const sumCosts = costsTotal.reduce((s, c) => s + c.amount, 0);
    assert.equal(sumCosts, 30.00);
  });

  it('Correção 2: Apuração não inclui comissões já liquidadas/pagas em novo cálculo', async () => {
    // 1. Criar pagamento e comissão para 2026-03
    const paidAt = new Date('2026-03-10T12:00:00.000Z');
    const payment = await prisma.creditPayment.create({
      data: {
        agreementId,
        companyId,
        amountCents: 20000, // R$ 200
        paymentMethod: 'PIX',
        receivedByRole: 'ADMIN',
        receiverUserId: adminId,
        destination: 'COMPANY_ACCOUNT',
        paidAt,
      },
    });

    // Criar comissão já marcada como PAID (liquidada historicamente)
    await prisma.creditCommission.create({
      data: {
        agreementId,
        paymentId: payment.id,
        companyId,
        sellerId,
        amountCents: 2000,
        status: 'PAID', // Já liquidada
        paidAt: new Date('2026-03-20T12:00:00.000Z'),
        type: 'INSTALLMENT',
        createdAt: paidAt,
      },
    });

    // Calcular competência 2026-03
    const calc = await calculateSellerMonthlyCreditClosing({
      companyId,
      sellerId,
      competence: '2026-03',
    });

    // Não deve puxar a comissão já paga
    assert.equal(calc.commissions.length, 0);
    assert.equal(calc.totalCommissionCents, 0);
    assert.equal(calc.netCommissionCents, 0);
  });

  it('Correção 3: Débito de ajuste maior que a comissão do mês gera residual rastreável para o próximo ciclo', async () => {
    // Competência 2026-02:
    // Comissão bruta de R$ 20 (2000 cents)
    const paidAt = new Date('2026-02-10T12:00:00.000Z');
    const payment = await prisma.creditPayment.create({
      data: {
        agreementId,
        companyId,
        amountCents: 20000, // R$ 200
        paymentMethod: 'PIX',
        receivedByRole: 'ADMIN',
        receiverUserId: adminId,
        destination: 'COMPANY_ACCOUNT',
        paidAt,
      },
    });

    await prisma.creditCommission.create({
      data: {
        agreementId,
        paymentId: payment.id,
        companyId,
        sellerId,
        amountCents: 2000, // R$ 20
        status: 'RELEASED',
        type: 'INSTALLMENT',
        createdAt: paidAt,
      },
    });

    // Débito de ajuste de R$ 50 (-5000 cents) criado antes do fim da competência
    await prisma.creditCommissionAdjustment.create({
      data: {
        companyId,
        sellerId,
        agreementId,
        amountCents: -5000, // Débito de R$ 50
        reason: 'Estorno de comissão passada',
        status: 'PENDING',
        createdAt: new Date('2026-02-15T12:00:00.000Z'),
      },
    });

    // Fechar formalmente a competência 2026-02
    const { closing } = await processMonthlyCreditClosing({
      companyId,
      sellerId,
      competence: '2026-02',
      closedByUserId: adminId,
    });

    // Verificações do fechamento de 2026-02:
    // 1. Comissão bruta R$ 20
    assert.equal(closing.totalCommissionCents, 2000);
    // 2. Ajuste absorvido neste mês foi -R$ 20 (apenas o suficiente para zerar)
    assert.equal(closing.adjustmentsCents, -2000);
    // 3. Comissão líquida a pagar é R$ 0
    assert.equal(closing.netCommissionCents, 0);
    assert.equal(closing.status, 'PAID');

    // 4. O débito excedente de R$ 30 (3000 centavos) NÃO DESAPARECEU:
    // Deve existir um novo CreditCommissionAdjustment PENDING com amountCents = -3000
    const carryoverAdjustment = await prisma.creditCommissionAdjustment.findFirst({
      where: {
        companyId,
        sellerId,
        status: 'PENDING',
        amountCents: -3000,
      },
    });

    assert.ok(carryoverAdjustment, 'Ajuste residual de -R$ 30 deve existir e estar PENDING');
    assert.equal(carryoverAdjustment.amountCents, -3000);

    // 5. Testar que no ciclo seguinte (2026-01 simulado ou cálculo posterior), o residual de R$ 30 é deduzido:
    // Se o vendedor tiver R$ 100 de comissões, o cálculo aplicará o débito residual de R$ 30
    const calcFuture = await calculateSellerMonthlyCreditClosing({
      companyId,
      sellerId,
      competence: '2026-11', // Competência futura posterior à criação do ajuste (2026-10)
    });
    // O ajuste residual de -3000 centavos (-R$ 30) está presente na lista de pendentes!
    const foundInNext = calcFuture.adjustments.find((a) => a.id === carryoverAdjustment.id);
    assert.ok(foundInNext, 'Ajuste residual deve ser carregado para cálculos subsequentes');
    assert.equal(calcFuture.rawAdjustmentsCents, -3000);
  });

  it('Correção 4: reconcileLegacyInstallmentCommissions marca como PAID comissões legadas já liquidadas', async () => {
    // Criar comissão com paidAt preenchido mas status 'RELEASED'
    const legacyComm = await prisma.creditCommission.create({
      data: {
        agreementId,
        companyId,
        sellerId,
        amountCents: 1500,
        status: 'RELEASED',
        type: 'INSTALLMENT',
        paidAt: new Date('2026-01-10T12:00:00Z'),
      },
    });

    const res = await reconcileLegacyInstallmentCommissions(companyId);
    assert.ok(res.reconciledPaidCount >= 1);

    const updated = await prisma.creditCommission.findUnique({
      where: { id: legacyComm.id },
    });
    assert.equal(updated?.status, 'PAID');
  });
});
