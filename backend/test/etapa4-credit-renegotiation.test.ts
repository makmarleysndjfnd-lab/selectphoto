import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import app from '../src/index';
import { prisma, disconnectPrisma } from '../src/services/prisma';

const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_12345';

describe('ETAPA 4 — RENEGOCIAÇÃO RASTREÁVEL, SEPARAÇÃO PRINCIPAL VS ENCARGOS, CONCORRÊNCIA E DESBLOQUEIO', { concurrency: 1 }, () => {
  let server: http.Server;
  let baseUrl: string;

  const uid = `e4_${Date.now()}_${randomUUID().slice(0, 6)}`;
  const compAId = `compA_${uid}`;
  const compBId = `compB_${uid}`;

  const adminAId = `adminA_${uid}`;
  const blockedAdminId = `blockedAdminA_${uid}`;
  const adminBId = `adminB_${uid}`;
  const sellerAId = `sellerA_${uid}`;
  const sellerBId = `sellerB_${uid}`;

  let adminAToken: string;
  let blockedAdminToken: string;
  let adminBToken: string;
  let sellerAToken: string;

  let clientA1Id: string;
  let clientA2Id: string;
  let clientB1Id: string;
  let batchAId: string;

  let saleA1Id: string;
  let agreementA1Id: string;
  let agreementA2Id: string;
  let firstRenegIdempotencyKey: string;
  let initialQrToken: string;

  const validCpf = '52998224725';

  function makeToken(user: { id: string; email: string; role: string; companyId: string; name: string }) {
    return jwt.sign(user, JWT_SECRET);
  }

  before(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    await prisma.company.createMany({
      data: [
        { id: compAId, name: 'Empresa A Etapa 4' },
        { id: compBId, name: 'Empresa B Etapa 4' },
      ],
    });

    await prisma.user.createMany({
      data: [
        {
          id: adminAId,
          companyId: compAId,
          email: `adminA_${uid}@test.com`,
          name: 'Admin Empresa A',
          role: 'COMPANY_ADMIN',
          password: 'dummy',
        },
        {
          id: blockedAdminId,
          companyId: compAId,
          email: `blockedAdmin_${uid}@test.com`,
          name: 'Supervisor Bloqueado',
          role: 'SUPERVISOR',
          password: 'dummy',
          sellerBlocked: true,
          sellerBlockedReason: 'Bloqueio preventivo em teste',
        },
        {
          id: adminBId,
          companyId: compBId,
          email: `adminB_${uid}@test.com`,
          name: 'Admin Empresa B',
          role: 'COMPANY_ADMIN',
          password: 'dummy',
        },
        {
          id: sellerAId,
          companyId: compAId,
          email: `sellerA_${uid}@test.com`,
          name: 'Vendedor A (Carro Próprio)',
          role: 'SELLER',
          password: 'dummy',
          usesOwnCar: true, // 25% entrada, 10% principal das parcelas
        },
        {
          id: sellerBId,
          companyId: compAId,
          email: `sellerB_${uid}@test.com`,
          name: 'Vendedor B',
          role: 'SELLER',
          password: 'dummy',
          usesOwnCar: false,
          sellerBlocked: true,
          sellerBlockedReason: 'Divergência preventiva QR',
          sellerBlockedAt: new Date(),
        },
      ],
    });

    adminAToken = makeToken({
      id: adminAId,
      email: `adminA_${uid}@test.com`,
      role: 'COMPANY_ADMIN',
      companyId: compAId,
      name: 'Admin Empresa A',
    });
    blockedAdminToken = makeToken({
      id: blockedAdminId,
      email: `blockedAdmin_${uid}@test.com`,
      role: 'SUPERVISOR',
      companyId: compAId,
      name: 'Supervisor Bloqueado',
    });
    adminBToken = makeToken({
      id: adminBId,
      email: `adminB_${uid}@test.com`,
      role: 'COMPANY_ADMIN',
      companyId: compBId,
      name: 'Admin Empresa B',
    });
    sellerAToken = makeToken({
      id: sellerAId,
      email: `sellerA_${uid}@test.com`,
      role: 'SELLER',
      companyId: compAId,
      name: 'Vendedor A',
    });

    const batch = await prisma.bookBatch.create({
      data: {
        name: `Lote E4 ${uid}`,
        city: 'Curitiba',
        companyId: compAId,
        photographerId: adminAId,
        status: 'DISTRIBUTED',
      },
    });
    batchAId = batch.id;

    const c1 = await prisma.client.create({
      data: {
        companyId: compAId,
        batchId: batchAId,
        assignedSellerId: sellerAId,
        sequenceNumber: `SEQ_A1_${uid}`,
        name: 'Cliente A1 Renegociação',
        city: 'Curitiba',
        street: 'Rua XV',
        number: '100',
        neighborhood: 'Centro',
        bookStatus: 'DISTRIBUTED',
        outcomeStatus: 'PENDING',
      },
    });
    clientA1Id = c1.id;

    const c2 = await prisma.client.create({
      data: {
        companyId: compAId,
        batchId: batchAId,
        assignedSellerId: sellerAId,
        sequenceNumber: `SEQ_A2_${uid}`,
        name: 'Cliente A2 Encargos',
        city: 'Curitiba',
        street: 'Rua Marechal',
        number: '200',
        neighborhood: 'Centro',
        bookStatus: 'DISTRIBUTED',
        outcomeStatus: 'PENDING',
      },
    });
    clientA2Id = c2.id;

    const c3 = await prisma.client.create({
      data: {
        companyId: compAId,
        batchId: batchAId,
        assignedSellerId: sellerBId,
        sequenceNumber: `SEQ_B1_${uid}`,
        name: 'Cliente B1 Desbloqueio',
        city: 'Curitiba',
        street: 'Av Batel',
        number: '300',
        neighborhood: 'Batel',
        bookStatus: 'DISTRIBUTED',
        outcomeStatus: 'PENDING',
      },
    });
    clientB1Id = c3.id;
  });

  after(async () => {
    try {
      await prisma.batchCommissionAdjustment.deleteMany({ where: { companyId: { in: [compAId, compBId] } } });
      await prisma.buyerPurchaseConfirmation.deleteMany({ where: { companyId: { in: [compAId, compBId] } } });
      await prisma.operationalAuditEvent.deleteMany({ where: { companyId: { in: [compAId, compBId] } } });
      await prisma.creditAgreementRenegotiation.deleteMany({
        where: { agreement: { companyId: { in: [compAId, compBId] } } },
      });
      await prisma.creditCommission.deleteMany({ where: { companyId: { in: [compAId, compBId] } } });
      await prisma.creditPaymentAllocation.deleteMany({
        where: { payment: { companyId: { in: [compAId, compBId] } } },
      });
      await prisma.creditPayment.deleteMany({ where: { companyId: { in: [compAId, compBId] } } });
      await prisma.creditInstallment.deleteMany({
        where: { agreement: { companyId: { in: [compAId, compBId] } } },
      });
      await prisma.creditAgreement.deleteMany({ where: { companyId: { in: [compAId, compBId] } } });
      await prisma.salePayment.deleteMany({
        where: { sale: { companyId: { in: [compAId, compBId] } } },
      });
      await prisma.clientTimeline.deleteMany({
        where: { client: { companyId: { in: [compAId, compBId] } } },
      });
      await prisma.sale.deleteMany({ where: { companyId: { in: [compAId, compBId] } } });
      await prisma.client.deleteMany({ where: { companyId: { in: [compAId, compBId] } } });
      await prisma.bookBatch.deleteMany({ where: { companyId: { in: [compAId, compBId] } } });
      await prisma.user.deleteMany({ where: { companyId: { in: [compAId, compBId] } } });
      await prisma.company.deleteMany({ where: { id: { in: [compAId, compBId] } } });
    } finally {
      if (server) server.close();
      await disconnectPrisma();
      await prisma.$disconnect();
    }
  });

  async function createCanonicalAgreement(clientId: string, buyerName: string) {
    const res = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sellerAToken}` },
      body: JSON.stringify({
        clientId,
        value: 1150,
        city: 'Curitiba',
        product: 'Combo Canônico',
        paymentMethod: 'CREDIARIO',
        hasCover: false,
        payments: [{ method: 'PIX', amount: 150 }],
        credit: {
          downPaymentCents: 15000,
          installmentsCount: 10,
          periodicity: 'MONTHLY',
          firstDueDate: '2026-12-10',
          buyerCpf: validCpf,
          buyerName,
          street: 'Rua XV',
          number: '100',
          neighborhood: 'Centro',
          city: 'Curitiba',
          state: 'PR',
        },
      }),
    });
    const data: any = await res.json();
    assert.equal(res.status, 201, `Erro ao criar venda canônica: ${JSON.stringify(data)}`);
    assert.ok(data.id, `Resposta de POST /sales sem id: ${JSON.stringify(data)}`);
    const agreement = await prisma.creditAgreement.findFirst({ where: { saleId: data.id } });
    assert.ok(agreement, `CreditAgreement não criado para venda ${data.id}`);
    return {
      saleId: data.id as string,
      agreementId: agreement.id as string,
      initialQrToken: (data.buyerConfirmation?.confirmationUrl || '') as string,
    };
  }

  it('1. Setup contrato canônico R$ 1.150 (R$ 150 entrada + 10x R$ 100), quita 2 parcelas (R$ 200) e emite QR ativo', async () => {
    const created = await createCanonicalAgreement(clientA1Id, 'Cliente A1 Renegociação');
    saleA1Id = created.saleId;
    agreementA1Id = created.agreementId;

    initialQrToken = created.initialQrToken;
    const existingConf = await prisma.buyerPurchaseConfirmation.findFirst({
      where: { saleId: saleA1Id },
    });
    assert.ok(existingConf, 'POST /sales deve gerar BuyerPurchaseConfirmation inicial');

    // Baixa das 2 primeiras parcelas (2 x R$ 100,00 = R$ 200,00 -> comissão 10% = R$ 20,00)
    const pay1 = await fetch(`${baseUrl}/api/credit/agreements/${agreementA1Id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({
        amount: 100,
        paymentMethod: 'PIX',
        destination: 'COMPANY_ACCOUNT',
        idempotencyKey: `e4_p1_${uid}`,
      }),
    });
    const pay1Data: any = await pay1.json();
    assert.equal(pay1.status, 201);
    assert.equal(pay1Data.remainingPrincipalCents, 90000);
    assert.equal(pay1Data.commission.amountCents, 1000);

    const pay2 = await fetch(`${baseUrl}/api/credit/agreements/${agreementA1Id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({
        amount: 100,
        paymentMethod: 'PIX',
        destination: 'COMPANY_ACCOUNT',
        idempotencyKey: `e4_p2_${uid}`,
      }),
    });
    const pay2Data: any = await pay2.json();
    assert.equal(pay2.status, 201);
    assert.equal(pay2Data.remainingPrincipalCents, 80000);
    assert.equal(pay2Data.commission.amountCents, 1000);
  });

  it('2. Bloqueia renegociação sem idempotencyKey (400), por vendedor/bloqueado (403), outra empresa (404) e encargos negativos (400)', async () => {
    const resSeller = await fetch(`${baseUrl}/api/credit/agreements/${agreementA1Id}/renegotiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sellerAToken}` },
      body: JSON.stringify({
        installmentsCount: 4,
        reason: 'Tentativa direta vendedor',
        idempotencyKey: `e4_r_seller_${uid}`,
      }),
    });
    assert.equal(resSeller.status, 403);

    const resBlockedAdmin = await fetch(`${baseUrl}/api/credit/agreements/${agreementA1Id}/renegotiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${blockedAdminToken}` },
      body: JSON.stringify({
        installmentsCount: 4,
        reason: 'Supervisor bloqueado tentando renegociar',
        idempotencyKey: `e4_r_blocked_${uid}`,
      }),
    });
    assert.equal(resBlockedAdmin.status, 403);

    const resOtherComp = await fetch(`${baseUrl}/api/credit/agreements/${agreementA1Id}/renegotiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminBToken}` },
      body: JSON.stringify({
        installmentsCount: 4,
        reason: 'Tentativa cross-tenant',
        idempotencyKey: `e4_r_compB_${uid}`,
      }),
    });
    assert.equal(resOtherComp.status, 404);

    const resNoKey = await fetch(`${baseUrl}/api/credit/agreements/${agreementA1Id}/renegotiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({
        installmentsCount: 4,
        reason: 'Sem idempotência',
      }),
    });
    const noKeyData: any = await resNoKey.json();
    assert.equal(resNoKey.status, 400);
    assert.equal(noKeyData.code, 'IDEMPOTENCY_KEY_REQUIRED');

    const resNegCharges = await fetch(`${baseUrl}/api/credit/agreements/${agreementA1Id}/renegotiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({
        installmentsCount: 4,
        chargesCents: -500,
        reason: 'Encargo negativo inválido',
        idempotencyKey: `e4_r_neg_${uid}`,
      }),
    });
    assert.equal(resNegCharges.status, 400);
  });

  it('3. Renegocia saldo R$ 800 em 4x sem encargos preservando PAID, invalidando/reemitindo QR, auditando e garantindo replay/concorrência', async () => {
    firstRenegIdempotencyKey = `e4_reneg_a1_${uid}`;
    const competingKey = `e4_reneg_a1_competing_${uid}`;

    // Disparo concorrente com chaves distintas: ao menos 1 conclui e nunca gera 8 parcelas duplicadas
    const [race1, race2] = await Promise.all([
      fetch(`${baseUrl}/api/credit/agreements/${agreementA1Id}/renegotiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
        body: JSON.stringify({
          newInstallmentsCount: 4,
          periodicity: 'MONTHLY',
          firstDueDate: '2027-01-10',
          reason: 'Cliente solicitou alongamento de 4 meses sem encargos',
          idempotencyKey: firstRenegIdempotencyKey,
        }),
      }),
      fetch(`${baseUrl}/api/credit/agreements/${agreementA1Id}/renegotiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
        body: JSON.stringify({
          newInstallmentsCount: 5,
          periodicity: 'MONTHLY',
          firstDueDate: '2027-01-10',
          reason: 'Chamada concorrente competitiva',
          idempotencyKey: competingKey,
        }),
      }),
    ]);

    const body1: any = await race1.json();
    const body2: any = await race2.json();
    const statuses = [race1.status, race2.status].sort((a, b) => a - b);
    // Ou uma ganhou 200 e a outra tomou 409 CONCURRENCY_CONFLICT, ou serializaram; vamos garantir que não duplicou parcelas!
    assert.ok(
      (statuses[0] === 200 && statuses[1] === 409) || (statuses[0] === 200 && statuses[1] === 200),
      `Status inesperados na concorrência: ${statuses.join(', ')}`
    );
    if (race1.status === 409) assert.equal(body1.code, 'CONCURRENCY_CONFLICT');
    if (race2.status === 409) assert.equal(body2.code, 'CONCURRENCY_CONFLICT');

    // Reenvio idêntico da chave vencedora deve retornar replay 200 idempotentReplay: true
    const winnerKey = race1.status === 200 ? firstRenegIdempotencyKey : competingKey;
    const expectedReplayCount = race1.status === 200 ? 4 : 5;
    firstRenegIdempotencyKey = winnerKey;

    const replayRes = await fetch(`${baseUrl}/api/credit/agreements/${agreementA1Id}/renegotiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({
        newInstallmentsCount: 4,
        periodicity: 'MONTHLY',
        firstDueDate: '2027-01-10',
        reason: 'Reenvio idempotente',
        idempotencyKey: winnerKey,
      }),
    });
    const replayData: any = await replayRes.json();
    assert.equal(replayRes.status, 200);
    assert.equal(replayData.idempotentReplay, true);
    assert.equal(replayData.remainingPrincipalCents, 80000);
    assert.equal(replayData.newInstallments.length, expectedReplayCount);

    // Verificar banco: 2 PAID preservadas, antigas em RENEGOTIATED e plano PENDING único somando R$ 800
    const dbAgreement = await prisma.creditAgreement.findUnique({
      where: { id: agreementA1Id },
      include: {
        installments: { orderBy: { installmentNumber: 'asc' } },
        renegotiations: { orderBy: { createdAt: 'asc' } },
      },
    });
    assert.ok(dbAgreement);
    assert.equal(dbAgreement.totalSaleCents, 115000);
    assert.equal(dbAgreement.remainingPrincipalCents, 80000);
    assert.equal(dbAgreement.paidPrincipalCents, 20000);
    assert.equal(dbAgreement.remainingChargesCents, 0);

    const paidInsts = dbAgreement.installments.filter((i) => i.status === 'PAID');
    const pendingInsts = dbAgreement.installments.filter((i) => i.status === 'PENDING');
    const renegInsts = dbAgreement.installments.filter((i) => i.status === 'RENEGOTIATED');
    const lastReneg = dbAgreement.renegotiations[dbAgreement.renegotiations.length - 1];
    const lastRenegCount = Array.isArray(lastReneg?.newSchedule) ? (lastReneg.newSchedule as any[]).length : 0;

    assert.equal(paidInsts.length, 2, 'As 2 parcelas já pagas devem permanecer intactas como PAID');
    assert.equal(pendingInsts.length, lastRenegCount);
    assert.equal(
      pendingInsts.reduce((s, i) => s + i.amountCents, 0),
      80000,
      'Novo plano PENDING deve somar exatamente o saldo devedor de R$ 800,00'
    );
    assert.ok(renegInsts.length >= 8, 'Parcelas anteriores em aberto devem ser marcadas como RENEGOTIATED');
    assert.ok(dbAgreement.renegotiations.length >= 1);

    // Auditoria operacional gravada
    const auditEvents = await prisma.operationalAuditEvent.findMany({
      where: { entityId: agreementA1Id, action: 'CREDIT_SCHEDULE_RENEGOTIATED' },
    });
    assert.ok(auditEvents.length >= 1);

    // QR antigo deve ter sido substituído/reemitido
    const confirmations = await prisma.buyerPurchaseConfirmation.findMany({
      where: { saleId: saleA1Id },
      orderBy: { createdAt: 'asc' },
    });
    assert.ok(confirmations.length >= 2, 'Deve haver confirmação anterior invalidada e nova reemitida');
    assert.equal(confirmations[0].status, 'INVALIDATED');
    assert.equal(confirmations[confirmations.length - 1].status, 'PENDING');

    // Finance overview nunca duplica faturamento contratado (R$ 1.150,00) nem comissões (R$ 37,50 + R$ 20,00 = R$ 57,50)
    const finRes = await fetch(`${baseUrl}/api/finance/overview`, {
      headers: { Authorization: `Bearer ${adminAToken}` },
    });
    const finData: any = await finRes.json();
    assert.equal(finRes.status, 200);
    assert.equal(finData.contractedRevenueCents, 115000);
    assert.equal(finData.grossCommissionsCents, 5750);
    assert.equal(finData.receivableBalanceCents, 80000);
  });

  it('4. Contrato com encargos (R$ 800 principal + R$ 80 mora em 4x de R$ 220): 10% incide só no principal, nunca nos encargos', async () => {
    const created2 = await createCanonicalAgreement(clientA2Id, 'Cliente A2 Encargos');
    agreementA2Id = created2.agreementId;

    // Quita 2x R$ 100 antes da renegociação -> restante = R$ 800 (80000 cents)
    for (let k = 1; k <= 2; k++) {
      const p = await fetch(`${baseUrl}/api/credit/agreements/${agreementA2Id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
        body: JSON.stringify({
          amount: 100,
          paymentMethod: 'PIX',
          destination: 'COMPANY_ACCOUNT',
          idempotencyKey: `e4_a2_pre_${k}_${uid}`,
        }),
      });
      assert.equal(p.status, 201);
    }

    // Chave de idempotência do contrato A1 não pode ser reaproveitada no contrato A2
    const crossKeyRes = await fetch(`${baseUrl}/api/credit/agreements/${agreementA2Id}/renegotiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({
        installmentsCount: 4,
        chargesCents: 8000,
        reason: 'Tentativa reuso chave outro contrato',
        idempotencyKey: firstRenegIdempotencyKey,
      }),
    });
    assert.equal(crossKeyRes.status, 409);

    // Renegocia R$ 800 principal + R$ 80 encargos em 4x -> cada parcela = R$ 220 (20000 principal + 2000 encargos)
    const renegRes = await fetch(`${baseUrl}/api/credit/agreements/${agreementA2Id}/renegotiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({
        installmentsCount: 4,
        chargesCents: 8000,
        periodicity: 'MONTHLY',
        firstDueDate: '2027-01-15',
        reason: 'Inclusão de encargos por atraso (R$ 80,00)',
        idempotencyKey: `e4_reneg_a2_${uid}`,
      }),
    });
    const renegData: any = await renegRes.json();
    assert.equal(renegRes.status, 200);
    assert.equal(renegData.remainingPrincipalCents, 80000);
    assert.equal(renegData.chargesCents, 8000);
    assert.equal(renegData.remainingChargesCents, 8000);
    assert.equal(renegData.newInstallments.length, 4);
    for (const inst of renegData.newInstallments) {
      assert.equal(inst.principalCents, 20000);
      assert.equal(inst.chargesCents, 2000);
      assert.equal(inst.amountCents, 22000);
    }

    // Pagar 1 parcela renegociada integral (R$ 220 = R$ 200 principal + R$ 20 encargos)
    // Comissão deve ser 10% de R$ 200 = R$ 20,00 (2000 cents), JAMAIS R$ 22,00 (2200 cents)
    const payFullReneg = await fetch(`${baseUrl}/api/credit/agreements/${agreementA2Id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({
        amount: 220,
        paymentMethod: 'PIX',
        destination: 'COMPANY_ACCOUNT',
        idempotencyKey: `e4_a2_post_full_${uid}`,
      }),
    });
    const fullData: any = await payFullReneg.json();
    assert.equal(payFullReneg.status, 201);
    assert.equal(fullData.principalPaidCents, 20000);
    assert.equal(fullData.chargesPaidCents, 2000);
    assert.equal(fullData.remainingPrincipalCents, 60000);
    assert.equal(fullData.remainingChargesCents, 6000);
    assert.equal(fullData.commission.amountCents, 2000);

    // Pagar metade (R$ 110) da próxima parcela -> 10000 principal + 1000 encargos -> comissão = 1000 cents
    const payHalfReneg = await fetch(`${baseUrl}/api/credit/agreements/${agreementA2Id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({
        amount: 110,
        paymentMethod: 'PIX',
        destination: 'COMPANY_ACCOUNT',
        idempotencyKey: `e4_a2_post_half_${uid}`,
      }),
    });
    const halfData: any = await payHalfReneg.json();
    assert.equal(payHalfReneg.status, 201);
    assert.equal(halfData.principalPaidCents, 10000);
    assert.equal(halfData.chargesPaidCents, 1000);
    assert.equal(halfData.commission.amountCents, 1000);

    // Estornar pagamento parcial deve recompor principal +10000 e encargos +1000 exatamente
    const revRes = await fetch(`${baseUrl}/api/credit/payments/${halfData.paymentId}/reverse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({ reason: 'Teste de consistência no estorno com encargos' }),
    });
    assert.equal(revRes.status, 200);

    const afterRev = await prisma.creditAgreement.findUnique({ where: { id: agreementA2Id } });
    assert.equal(afterRev?.remainingPrincipalCents, 60000);
    assert.equal(afterRev?.remainingChargesCents, 6000);

    // Finance overview: 2 contratos canônicos = 230000 contratados (sem inflação por R$ 80 de encargos!),
    // principal recebido nas parcelas = 20000 (A1) + 20000 (A2 pré) + 20000 (A2 pós) = 60000,
    // encargos recebidos = 2000, receita a receber principal = 80000 + 60000 = 140000, encargos a receber = 6000
    const finRes = await fetch(`${baseUrl}/api/finance/overview`, {
      headers: { Authorization: `Bearer ${adminAToken}` },
    });
    const finData: any = await finRes.json();
    assert.equal(finRes.status, 200);
    assert.equal(finData.contractedRevenueCents, 230000);
    assert.equal(finData.installmentPrincipalReceivedCents, 60000);
    assert.equal(finData.renegotiationChargesReceivedCents, 2000);
    assert.equal(finData.installmentsReceivedCents, 62000);
    assert.equal(finData.receivableBalanceCents, 140000);
    assert.equal(finData.receivableChargesCents, 6000);
    // Comissões totais: 2 entradas (3750 * 2 = 7500) + 10% sobre 60000 principal (6000) = 13500
    assert.equal(finData.grossCommissionsCents, 13500);
  });

  it('5. Visibilidade de vendedor bloqueado no resumo do crediário e desbloqueio auditado via Admin', async () => {
    const sellerBSale = await prisma.sale.create({
      data: {
        clientId: clientB1Id,
        sellerId: sellerBId,
        companyId: compAId,
        value: 1150,
        city: 'Curitiba',
        paymentMethod: 'CREDIARIO',
      },
    });
    await prisma.creditAgreement.create({
      data: {
        saleId: sellerBSale.id,
        clientId: clientB1Id,
        sellerId: sellerBId,
        companyId: compAId,
        buyerName: 'Cliente B1 Desbloqueio',
        buyerCpf: validCpf,
        street: 'Av Batel',
        number: '300',
        neighborhood: 'Batel',
        city: 'Curitiba',
        state: 'PR',
        totalSaleCents: 115000,
        downPaymentCents: 15000,
        financedPrincipalCents: 100000,
        remainingPrincipalCents: 100000,
        paidPrincipalCents: 0,
        installmentsCount: 10,
        periodicity: 'MONTHLY',
        firstDueDate: new Date('2026-12-10'),
        status: 'ACTIVE',
      },
    });

    const sumBefore = await fetch(`${baseUrl}/api/credit/sellers-summary`, {
      headers: { Authorization: `Bearer ${adminAToken}` },
    });
    const sumBeforeList: any[] = await sumBefore.json();
    assert.equal(sumBefore.status, 200);
    const sellerBCard = sumBeforeList.find((s) => s.sellerId === sellerBId);
    assert.ok(sellerBCard);
    assert.equal(sellerBCard.sellerBlocked, true);

    // Validação motivo curto
    const shortRes = await fetch(`${baseUrl}/api/users/${sellerBId}/unblock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({ reason: 'ok' }),
    });
    assert.equal(shortRes.status, 400);

    // Outra empresa -> 404
    const crossCompRes = await fetch(`${baseUrl}/api/users/${sellerBId}/unblock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminBToken}` },
      body: JSON.stringify({ reason: 'Tentativa cross-company' }),
    });
    assert.equal(crossCompRes.status, 404);

    // Admin A desbloqueia com justificativa auditada
    const unblockRes = await fetch(`${baseUrl}/api/users/${sellerBId}/unblock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({ reason: 'Divergência revisada e regularizada com o cliente' }),
    });
    const unblockData: any = await unblockRes.json();
    assert.equal(unblockRes.status, 200);
    assert.equal(unblockData.user?.sellerBlocked, false);

    const sumAfter = await fetch(`${baseUrl}/api/credit/sellers-summary`, {
      headers: { Authorization: `Bearer ${adminAToken}` },
    });
    const sumAfterList: any[] = await sumAfter.json();
    const sellerBAfter = sumAfterList.find((s) => s.sellerId === sellerBId);
    assert.equal(sellerBAfter.sellerBlocked, false);

    const unblockAudit = await prisma.operationalAuditEvent.findFirst({
      where: { companyId: compAId, entityId: sellerBId, action: 'SELLER_PREVENTIVE_BLOCK_REMOVED' },
    });
    assert.ok(unblockAudit, 'Trilha de auditoria SELLER_PREVENTIVE_BLOCK_REMOVED deve existir');
  });
});
