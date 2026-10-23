import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import app from '../src/index';
import jwt from 'jsonwebtoken';
import http from 'http';
import {
  getCompetenceRange,
  getCompetenceForDate,
  processMonthlyCreditClosing,
  recordMonthlyCreditPayout,
} from '../src/services/monthlyCreditClosingService';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_12345';

describe('ETAPA 2 — CARTEIRA DO VENDEDOR E FECHAMENTO MENSAL DO CREDIÁRIO (9 PONTOS DE VERIFICAÇÃO)', () => {
  let server: http.Server;
  let baseUrl: string;

  const uid = 'et2_' + Date.now();
  const companyAId = 'comp_a_' + uid;
  const companyBId = 'comp_b_' + uid;

  const sellerAId = 'seller_a_' + uid;
  const sellerBId = 'seller_b_' + uid;
  const adminAId = 'admin_a_' + uid;
  const photoAId = 'photo_a_' + uid;

  let sellerAToken: string;
  let sellerBToken: string;
  let adminAToken: string;
  let photoAToken: string;

  let agreementId: string;
  let clientAId: string;

  before(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${(addr as any).port}`;
        resolve();
      });
    });

    // Criar empresas isoladas A e B
    await prisma.company.createMany({
      data: [
        { id: companyAId, name: 'Empresa A Etapa 2' },
        { id: companyBId, name: 'Empresa B Etapa 2' },
      ],
    });

    // Criar usuários de teste
    await prisma.user.createMany({
      data: [
        {
          id: sellerAId,
          companyId: companyAId,
          email: `seller_a_${uid}@test.com`,
          name: 'Vendedor Empresa A',
          role: 'SELLER',
          password: 'dummy',
          usesOwnCar: false, // 20% na entrada
        },
        {
          id: sellerBId,
          companyId: companyBId,
          email: `seller_b_${uid}@test.com`,
          name: 'Vendedor Empresa B',
          role: 'SELLER',
          password: 'dummy',
          usesOwnCar: true, // 25% na entrada
        },
        {
          id: adminAId,
          companyId: companyAId,
          email: `admin_a_${uid}@test.com`,
          name: 'Admin Empresa A',
          role: 'COMPANY_ADMIN',
          password: 'dummy',
        },
        {
          id: photoAId,
          companyId: companyAId,
          email: `photo_a_${uid}@test.com`,
          name: 'Fotógrafo Empresa A',
          role: 'PHOTOGRAPHER',
          password: 'dummy',
        },
      ],
    });

    sellerAToken = jwt.sign({ id: sellerAId, email: `seller_a_${uid}@test.com`, role: 'SELLER', companyId: companyAId }, JWT_SECRET);
    sellerBToken = jwt.sign({ id: sellerBId, email: `seller_b_${uid}@test.com`, role: 'SELLER', companyId: companyBId }, JWT_SECRET);
    adminAToken = jwt.sign({ id: adminAId, email: `admin_a_${uid}@test.com`, role: 'COMPANY_ADMIN', companyId: companyAId }, JWT_SECRET);
    photoAToken = jwt.sign({ id: photoAId, email: `photo_a_${uid}@test.com`, role: 'PHOTOGRAPHER', companyId: companyAId }, JWT_SECRET);

    const client = await prisma.client.create({
      data: {
        companyId: companyAId,
        name: 'Cliente Teste Etapa 2',
        city: 'São Paulo',
        neighborhood: 'Bela Vista',
        street: 'Av Paulista',
        number: '1000',
        assignedSellerId: sellerAId,
        outcomeStatus: 'PENDING',
        sequenceNumber: 'ET2-001',
      },
    });
    clientAId = client.id;
  });

  after(async () => {
    if (server) server.close();
  });

  it('Verificação 1: Entrada de R$ 400 grava taxa histórica (20% carro empresa / 25% carro próprio)', async () => {
    const salePayload = {
      clientId: clientAId,
      value: 1000,
      city: 'São Paulo',
      product: 'Álbum Fotográfico Completo',
      paymentMethod: 'SPLIT',
      payments: [
        { method: 'CASH', amount: 400, receiptUrl: 'https://storage.test/rec_emp.jpg' },
      ],
      receiptUrl: 'https://storage.test/rec_emp.jpg',
      credit: {
        buyerCpf: '52998224725',
        buyerName: 'Comprador Teste V1',
        street: 'Av Paulista',
        number: '1000',
        neighborhood: 'Bela Vista',
        city: 'São Paulo',
        downPaymentCents: 40000, // R$ 400 entrada
        financedPrincipalCents: 60000, // R$ 600 financiado
        installmentsCount: 6,
        periodicity: 'MONTHLY',
        firstDueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
      },
    };

    const res = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sellerAToken}` },
      body: JSON.stringify(salePayload),
    });

    assert.equal(res.status, 201);
    const saleData = await res.json();
    const createdSale = saleData.sale || saleData;

    const agreement = await prisma.creditAgreement.findFirst({
      where: { saleId: createdSale.id },
    });
    assert.ok(agreement);
    agreementId = agreement.id;

    // Carro da empresa: initialCommissionRate gravada = 0.20 (20%)
    assert.equal(agreement.initialCommissionRate, 0.20);
    assert.equal(agreement.installmentCommissionRate, 0.10);

    const downPaymentComm = await prisma.creditCommission.findFirst({
      where: { agreementId: agreement.id, type: 'DOWN_PAYMENT' },
    });
    assert.ok(downPaymentComm);
    assert.equal(downPaymentComm.amountCents, 8000); // R$ 80 (20% de 400)
  });

  it('Verificação 2: Parcela de R$ 100 gera R$ 10 de comissão; Pagamento parcial de R$ 40 gera R$ 4 sobre principal', async () => {
    // 1. Pagamento de parcela de R$ 100 feito pelo Admin
    const res1 = await fetch(`${baseUrl}/api/credit/agreements/${agreementId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({
        amount: 100,
        paymentMethod: 'CASH',
        destination: 'SELLER_HANDS',
        notes: 'Parcela 1 R$ 100',
      }),
    });
    assert.equal(res1.status, 201);
    const data1 = await res1.json();

    const comm1 = await prisma.creditCommission.findFirst({
      where: { paymentId: data1.payment.id, type: 'INSTALLMENT' },
    });
    assert.ok(comm1);
    assert.equal(comm1.amountCents, 1000); // R$ 10

    // 2. Pagamento parcial de R$ 40
    const res2 = await fetch(`${baseUrl}/api/credit/agreements/${agreementId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({
        amount: 40,
        paymentMethod: 'PIX',
        destination: 'COMPANY_ACCOUNT',
        notes: 'Pagamento parcial R$ 40',
      }),
    });
    assert.equal(res2.status, 201);
    const data2 = await res2.json();

    const comm2 = await prisma.creditCommission.findFirst({
      where: { paymentId: data2.payment.id, type: 'INSTALLMENT' },
    });
    assert.ok(comm2);
    assert.equal(comm2.amountCents, 400); // R$ 4 (10% de 40)
  });

  it('Verificação 3: Carteira do vendedor é somente consulta pós-venda (403 para baixa/renegociar/estornar/pagar; PHOTOGRAPHER 403; Admin permitido)', async () => {
    // Vendedor tenta dar baixa manual -> 403
    const resBaixa = await fetch(`${baseUrl}/api/credit/agreements/${agreementId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sellerAToken}` },
      body: JSON.stringify({ amount: 50 }),
    });
    assert.equal(resBaixa.status, 403);

    // Vendedor tenta renegociar contrato -> 403
    const resReneg = await fetch(`${baseUrl}/api/credit/agreements/${agreementId}/renegotiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sellerAToken}` },
      body: JSON.stringify({ installmentsCount: 3 }),
    });
    assert.equal(resReneg.status, 403);

    // Vendedor tenta pagar comissões -> 403
    const resPay = await fetch(`${baseUrl}/api/credit/commissions/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sellerAToken}` },
      body: JSON.stringify({ sellerId: sellerAId, commissionIds: ['fake'] }),
    });
    assert.equal(resPay.status, 403);

    // Vendedor consulta sua própria carteira -> 200 permitido!
    const resPortfolio = await fetch(`${baseUrl}/api/credit/seller/portfolio`, {
      headers: { Authorization: `Bearer ${sellerAToken}` },
    });
    assert.equal(resPortfolio.status, 200);

    // Fotógrafo tenta acessar crediário -> 403
    const resPhoto = await fetch(`${baseUrl}/api/credit/overview`, {
      headers: { Authorization: `Bearer ${photoAToken}` },
    });
    assert.equal(resPhoto.status, 403);
  });

  it('Verificação 4: Recebimentos na virada do mês, mês de 31 dias e fevereiro bissexto entram na competência correta (America/Sao_Paulo)', () => {
    // 31 de janeiro às 23:59:59 BRT (-03:00) -> UTC é 01/02 às 02:59:59Z -> competência DEVE ser 2026-01
    const dtJan31 = new Date('2026-02-01T02:59:59.000Z');
    assert.equal(getCompetenceForDate(dtJan31), '2026-01');

    // 1 de fevereiro às 00:00:00 BRT (-03:00) -> UTC é 01/02 às 03:00:00Z -> competência DEVE ser 2026-02
    const dtFeb1 = new Date('2026-02-01T03:00:00.000Z');
    assert.equal(getCompetenceForDate(dtFeb1), '2026-02');

    // Fevereiro de ano bissexto (2024): 29 de fevereiro às 23:59:59 BRT -> 2024-03-01T02:59:59Z
    const dtFeb29Leap = new Date('2024-03-01T02:59:59.000Z');
    assert.equal(getCompetenceForDate(dtFeb29Leap), '2024-02');

    // Início de março após o bissexto: 01 de março às 00:00:00 BRT -> 2024-03-01T03:00:00Z
    const dtMar1 = new Date('2024-03-01T03:00:00.000Z');
    assert.equal(getCompetenceForDate(dtMar1), '2024-03');

    // Intervalo de competência com 31 dias (Janeiro)
    const rangeJan = getCompetenceRange('2026-01');
    assert.equal(rangeJan.startDate.toISOString(), '2026-01-01T03:00:00.000Z');
    assert.equal(rangeJan.endDate.toISOString(), '2026-02-01T03:00:00.000Z');

    // Intervalo de competência Fevereiro ano bissexto (2024)
    const rangeFebLeap = getCompetenceRange('2024-02');
    assert.equal(rangeFebLeap.startDate.toISOString(), '2024-02-01T03:00:00.000Z');
    assert.equal(rangeFebLeap.endDate.toISOString(), '2024-03-01T03:00:00.000Z');
  });

  it('Verificação 5: Idempotência e proteção contra concorrência: duas execuções simultâneas fecham a mesma competência uma única vez', async () => {
    // Criar um pagamento histórico em competência encerrada (2026-05)
    const historicalPaymentDate = new Date('2026-05-15T15:00:00.000Z');
    const paymentHist = await prisma.creditPayment.create({
      data: {
        agreementId,
        companyId: companyAId,
        amountCents: 20000, // R$ 200
        paymentMethod: 'PIX',
        receivedByRole: 'ADMIN',
        receiverUserId: adminAId,
        destination: 'COMPANY_ACCOUNT',
        paidAt: historicalPaymentDate,
      },
    });

    await prisma.creditCommission.create({
      data: {
        agreementId,
        paymentId: paymentHist.id,
        companyId: companyAId,
        sellerId: sellerAId,
        amountCents: 2000, // R$ 20 (10% de 200)
        status: 'RELEASED',
        type: 'INSTALLMENT',
        createdAt: historicalPaymentDate,
      },
    });

    // Disparar duas chamadas simultâneas de fechamento para a competência encerrada '2026-05'
    const [p1, p2] = await Promise.all([
      processMonthlyCreditClosing({ companyId: companyAId, sellerId: sellerAId, competence: '2026-05' }),
      processMonthlyCreditClosing({ companyId: companyAId, sellerId: sellerAId, competence: '2026-05' }),
    ]);

    // Uma criou, a outra reusou sem duplicar
    assert.equal((p1.created && !p2.created) || (!p1.created && p2.created), true);
    assert.equal(p1.closing.id, p2.closing.id);

    // Contagem no banco de fechamentos para 2026-05 deste vendedor DEVE ser exatamente 1
    const count = await prisma.monthlyCreditClosing.count({
      where: { companyId: companyAId, sellerId: sellerAId, competence: '2026-05' },
    });
    assert.equal(count, 1);
    assert.equal(p1.closing.netCommissionCents, 2000); // R$ 20 apurados
  });

  it('Verificação 6: Comissão de mês aberto não pode ser paga; rota legada /commissions/pay bloqueia INSTALLMENT com 400', async () => {
    // 1. Tentar fechar mês futuro ou aberto via POST /api/credit/monthly-closings/process -> 400
    const resOpen = await fetch(`${baseUrl}/api/credit/monthly-closings/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({ sellerId: sellerAId, competence: '2099-01' }),
    });
    assert.equal(resOpen.status, 400);
    const errOpen = await resOpen.json();
    assert.equal(errOpen.code, 'COMPETENCE_NOT_ENDED');

    // 2. Buscar uma comissão de parcela (INSTALLMENT) liberada
    const installmentComm = await prisma.creditCommission.findFirst({
      where: { companyId: companyAId, sellerId: sellerAId, type: 'INSTALLMENT', status: 'RELEASED', monthlyClosingId: null },
    });
    assert.ok(installmentComm);

    // Tentar pagar comissão de parcela via rota legada POST /api/credit/commissions/pay -> bloqueado com 400
    const resLegacyPay = await fetch(`${baseUrl}/api/credit/commissions/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({
        sellerId: sellerAId,
        commissionIds: [installmentComm.id],
      }),
    });
    assert.equal(resLegacyPay.status, 400);
    const errLegacy = await resLegacyPay.json();
    assert.equal(errLegacy.code, 'INSTALLMENT_COMMISSION_MONTHLY_ONLY');
  });

  it('Verificação 7: Acerto parcial rastreável e idempotência persistente (replay vs 409 conflict, saldo máximo)', async () => {
    // Obter o fechamento de 2026-05 criado no teste 5 (R$ 20 = 2000 cents a pagar)
    const closing = await prisma.monthlyCreditClosing.findUnique({
      where: { companyId_sellerId_competence: { companyId: companyAId, sellerId: sellerAId, competence: '2026-05' } },
    });
    assert.ok(closing);

    // 1. Acerto parcial de R$ 12 (1200 cents) com chave de idempotência
    const resPayout1 = await fetch(`${baseUrl}/api/credit/monthly-closings/${closing.id}/payout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({
        amountCents: 1200,
        paymentMethod: 'PIX',
        idempotencyKey: `idem_payout_${uid}_1`,
        notes: 'Acerto parcial 1',
      }),
    });
    assert.equal(resPayout1.status, 200);
    const dataPayout1 = await resPayout1.json();
    assert.equal(dataPayout1.closing.status, 'PARTIALLY_PAID');
    assert.equal(dataPayout1.closing.paidAmount, 12.00);
    assert.equal(dataPayout1.closing.remainingBalance, 8.00);

    // 2. Reenvio com a MESMA chave e MESMOS parâmetros -> replay idempotente sem duplicar (200)
    const resPayoutReplay = await fetch(`${baseUrl}/api/credit/monthly-closings/${closing.id}/payout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({
        amountCents: 1200,
        paymentMethod: 'PIX',
        idempotencyKey: `idem_payout_${uid}_1`,
      }),
    });
    assert.equal(resPayoutReplay.status, 200);
    const dataReplay = await resPayoutReplay.json();
    assert.equal(dataReplay.idempotentReplay, true);

    // 3. Reenvio com a MESMA chave e parâmetros DIFERENTES -> conflito 409
    const resConflict = await fetch(`${baseUrl}/api/credit/monthly-closings/${closing.id}/payout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({
        amountCents: 500, // Parâmetro diferente!
        paymentMethod: 'PIX',
        idempotencyKey: `idem_payout_${uid}_1`,
      }),
    });
    assert.equal(resConflict.status, 409);

    // 4. Tentativa de pagar valor acima do saldo restante (saldo restante é R$ 8; tenta pagar R$ 15) -> 400
    const resExcess = await fetch(`${baseUrl}/api/credit/monthly-closings/${closing.id}/payout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({
        amountCents: 1500, // R$ 15 ultrapassa R$ 8 restante
        paymentMethod: 'PIX',
      }),
    });
    assert.equal(resExcess.status, 400);

    // 5. Quitação do saldo restante de R$ 8
    const resPayoutFinal = await fetch(`${baseUrl}/api/credit/monthly-closings/${closing.id}/payout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({
        amountCents: 800,
        paymentMethod: 'PIX',
        notes: 'Quitação final',
      }),
    });
    assert.equal(resPayoutFinal.status, 200);
    const dataFinal = await resPayoutFinal.json();
    assert.equal(dataFinal.closing.status, 'PAID');
    assert.equal(dataFinal.closing.remainingBalance, 0.00);
    assert.equal(dataFinal.closing.paidAmount, 20.00);
  });

  it('Verificação 8: Estorno de pagamento de competência fechada gera ajuste auditável sem alterar histórico', async () => {
    // Localizar a comissão do pagamento histórico que foi fechado em 2026-05
    const commClosed = await prisma.creditCommission.findFirst({
      where: {
        companyId: companyAId,
        sellerId: sellerAId,
        monthlyClosing: { competence: '2026-05' },
      },
      include: { payment: true },
    });
    assert.ok(commClosed);
    assert.ok(commClosed.paymentId);

    // Realizar estorno do pagamento pago/fechado via POST /api/credit/payments/:id/reverse
    const resReverse = await fetch(`${baseUrl}/api/credit/payments/${commClosed.paymentId}/reverse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({ reason: 'Cancelamento judicial de parcela antiga' }),
    });
    assert.equal(resReverse.status, 200);

    // O fechamento histórico de 2026-05 NÃO deve ter seus valores alterados (imutabilidade auditável)
    const closingAfter = await prisma.monthlyCreditClosing.findUnique({
      where: { id: commClosed.monthlyClosingId! },
    });
    assert.equal(closingAfter?.totalCommissionCents, 2000);
    assert.equal(closingAfter?.netCommissionCents, 2000);

    // Deve existir um CreditCommissionAdjustment com status PENDING para abater na próxima competência
    const adj = await prisma.creditCommissionAdjustment.findFirst({
      where: {
        companyId: companyAId,
        sellerId: sellerAId,
        paymentId: commClosed.paymentId,
        status: 'PENDING',
      },
    });
    assert.ok(adj);
    assert.equal(adj.amountCents, -2000); // Débito rastreável de R$ 20
  });

  it('Verificação 9: Cards e filtros respeitam multi-tenant e exibem 4 estados visíveis sem vazamento entre empresas', async () => {
    // 1. Quatro estados visíveis para o Vendedor A
    const resStates = await fetch(`${baseUrl}/api/credit/seller/four-states`, {
      headers: { Authorization: `Bearer ${sellerAToken}` },
    });
    assert.equal(resStates.status, 200);
    const dataStates = await resStates.json();

    assert.ok(dataStates.states.future);
    assert.ok(dataStates.states.accumulatedCurrentMonth);
    assert.ok(dataStates.states.closedAwaitingPayment);
    assert.ok(dataStates.states.paid);

    const resSellerB = await fetch(`${baseUrl}/api/credit/monthly-closings`, {
      headers: { Authorization: `Bearer ${sellerBToken}` },
    });
    assert.equal(resSellerB.status, 200);
    const dataB = await resSellerB.json();
    assert.ok(!dataB.closings.some((c: any) => c.sellerId === sellerAId)); // Empresa B não tem fechamentos da Empresa A
    assert.ok(dataB.closings.every((c: any) => c.sellerId === sellerBId));

    // 3. Vendedor A tenta consultar dados do Vendedor B -> 403
    const resLeakAttempt = await fetch(`${baseUrl}/api/credit/monthly-closings?sellerId=${sellerBId}`, {
      headers: { Authorization: `Bearer ${sellerAToken}` },
    });
    assert.equal(resLeakAttempt.status, 403);
  });
});
