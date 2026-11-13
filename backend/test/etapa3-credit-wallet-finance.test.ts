import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import app from '../src/index';
import { prisma, disconnectPrisma } from '../src/services/prisma';

const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_12345';

describe('ETAPA 3 — BLINDAGEM CREDIÁRIO, ISOLAMENTO DE CARTEIRA, DESBLOQUEIO AUDITADO E FINANCEIRO EM CENTAVOS', { concurrency: 1 }, () => {
  let server: http.Server;
  let baseUrl: string;

  const uid = `e3_${Date.now()}_${randomUUID().slice(0, 6)}`;
  const compAId = `compA_${uid}`;
  const compBId = `compB_${uid}`;

  const adminAId = `adminA_${uid}`;
  const adminBId = `adminB_${uid}`;
  const sellerAId = `sellerA_${uid}`;
  const sellerBId = `sellerB_${uid}`;
  const sellerCompBId = `sellerCompB_${uid}`;

  let adminAToken: string;
  let adminBToken: string;
  let sellerAToken: string;
  let sellerBToken: string;

  let clientA1Id: string;
  let clientA2Id: string;
  let clientB1Id: string;
  let clientCompBId: string;
  let batchAId: string;

  let agreementAId: string;
  let downPaymentCommId: string;
  let firstInstallmentPaymentId: string;

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
        { id: compAId, name: 'Empresa A Etapa 3' },
        { id: compBId, name: 'Empresa B Etapa 3' },
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
          usesOwnCar: true, // 25% entrada e à vista; 10% parcelas
        },
        {
          id: sellerBId,
          companyId: compAId,
          email: `sellerB_${uid}@test.com`,
          name: 'Vendedor B',
          role: 'SELLER',
          password: 'dummy',
          usesOwnCar: false,
        },
        {
          id: sellerCompBId,
          companyId: compBId,
          email: `sellerCompB_${uid}@test.com`,
          name: 'Vendedor Empresa B',
          role: 'SELLER',
          password: 'dummy',
          usesOwnCar: true,
        },
      ],
    });

    adminAToken = makeToken({ id: adminAId, email: `adminA_${uid}@test.com`, role: 'COMPANY_ADMIN', companyId: compAId, name: 'Admin Empresa A' });
    adminBToken = makeToken({ id: adminBId, email: `adminB_${uid}@test.com`, role: 'COMPANY_ADMIN', companyId: compBId, name: 'Admin Empresa B' });
    sellerAToken = makeToken({ id: sellerAId, email: `sellerA_${uid}@test.com`, role: 'SELLER', companyId: compAId, name: 'Vendedor A (Carro Próprio)' });
    sellerBToken = makeToken({ id: sellerBId, email: `sellerB_${uid}@test.com`, role: 'SELLER', companyId: compAId, name: 'Vendedor B' });

    const batch = await prisma.bookBatch.create({
      data: {
        name: `Lote Etapa 3 ${uid}`,
        city: 'Curitiba',
        companyId: compAId,
        photographerId: adminAId,
        status: 'DISTRIBUTED',
      },
    });
    batchAId = batch.id;

    const cA1 = await prisma.client.create({
      data: {
        companyId: compAId,
        batchId: batchAId,
        assignedSellerId: sellerAId,
        sequenceNumber: `SEQ_A1_${uid}`,
        name: 'Cliente A1 Canônico',
        city: 'Curitiba',
        street: 'Rua XV',
        number: '100',
        neighborhood: 'Centro',
        bookStatus: 'DISTRIBUTED',
        outcomeStatus: 'PENDING',
      },
    });
    clientA1Id = cA1.id;

    const cA2 = await prisma.client.create({
      data: {
        companyId: compAId,
        batchId: batchAId,
        assignedSellerId: sellerAId,
        sequenceNumber: `SEQ_A2_${uid}`,
        name: 'Cliente A2 À Vista',
        city: 'Curitiba',
        street: 'Rua das Flores',
        number: '200',
        neighborhood: 'Centro',
        bookStatus: 'DISTRIBUTED',
        outcomeStatus: 'PENDING',
      },
    });
    clientA2Id = cA2.id;

    const cB1 = await prisma.client.create({
      data: {
        companyId: compAId,
        batchId: batchAId,
        assignedSellerId: sellerBId,
        sequenceNumber: `SEQ_B1_${uid}`,
        name: 'Cliente B1 Carteira B',
        city: 'Curitiba',
        street: 'Rua B',
        number: '300',
        neighborhood: 'Batel',
        bookStatus: 'DISTRIBUTED',
        outcomeStatus: 'PENDING',
      },
    });
    clientB1Id = cB1.id;

    const cCompB = await prisma.client.create({
      data: {
        companyId: compBId,
        assignedSellerId: sellerCompBId,
        sequenceNumber: `SEQ_CB_${uid}`,
        name: 'Cliente Empresa B',
        city: 'Londrina',
        street: 'Av Paraná',
        number: '400',
        neighborhood: 'Centro',
        bookStatus: 'DISTRIBUTED',
        outcomeStatus: 'PENDING',
      },
    });
    clientCompBId = cCompB.id;
  });

  after(async () => {
    try {
      await prisma.batchCommissionAdjustment.deleteMany({ where: { companyId: { in: [compAId, compBId] } } });
      await prisma.buyerPurchaseConfirmation.deleteMany({ where: { companyId: { in: [compAId, compBId] } } });
      await prisma.operationalAuditEvent.deleteMany({ where: { companyId: { in: [compAId, compBId] } } });
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

  it('1. Crediário canônico R$ 1.150,00: trava entrada mínima < R$ 150 e gera 25% na entrada (R$ 37,50)', async () => {
    const resLowDown = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sellerAToken}` },
      body: JSON.stringify({
        clientId: clientA1Id,
        value: 1150,
        city: 'Curitiba',
        product: 'Combo Premium',
        paymentMethod: 'CREDIARIO',
        hasCover: false,
        payments: [{ method: 'PIX', amount: 149.99 }],
        credit: {
          downPaymentCents: 14999,
          installmentsCount: 10,
          periodicity: 'MONTHLY',
          firstDueDate: '2026-12-10',
          buyerCpf: validCpf,
          buyerName: 'Cliente A1 Canônico',
          street: 'Rua XV',
          number: '100',
          neighborhood: 'Centro',
          city: 'Curitiba',
          state: 'PR',
        },
      }),
    });
    assert.equal(resLowDown.status, 400);

    const resCanonical = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sellerAToken}` },
      body: JSON.stringify({
        clientId: clientA1Id,
        value: 1150,
        city: 'Curitiba',
        product: 'Combo Premium',
        paymentMethod: 'CREDIARIO',
        hasCover: false,
        payments: [{ method: 'PIX', amount: 150 }],
        credit: {
          downPaymentCents: 15000,
          installmentsCount: 10,
          periodicity: 'MONTHLY',
          firstDueDate: '2026-12-10',
          buyerCpf: validCpf,
          buyerName: 'Cliente A1 Canônico',
          street: 'Rua XV',
          number: '100',
          neighborhood: 'Centro',
          city: 'Curitiba',
          state: 'PR',
        },
      }),
    });
    assert.equal(resCanonical.status, 201);

    const agreement = await prisma.creditAgreement.findFirst({
      where: { clientId: clientA1Id },
      include: { installments: { orderBy: { installmentNumber: 'asc' } }, commissions: true },
    });
    assert.ok(agreement);
    agreementAId = agreement.id;

    assert.equal(agreement.totalSaleCents, 115000);
    assert.equal(agreement.downPaymentCents, 15000);
    assert.equal(agreement.financedPrincipalCents, 100000);
    assert.equal(agreement.remainingPrincipalCents, 100000);
    assert.equal(agreement.installments.length, 10);
    assert.ok(agreement.installments.every((i) => i.amountCents === 10000));

    assert.equal(agreement.commissions.length, 1);
    assert.equal(agreement.commissions[0].type, 'DOWN_PAYMENT');
    assert.equal(agreement.commissions[0].amountCents, 3750); // 25% de R$ 150,00 = R$ 37,50
    downPaymentCommId = agreement.commissions[0].id;
  });

  it('2. Exige idempotencyKey persistente, suporta reenvio idempotente (10% = R$ 10,00) e bloqueia concorrência (409 CONCURRENCY_CONFLICT)', async () => {
    // 2a. Sem idempotencyKey -> 400 IDEMPOTENCY_KEY_REQUIRED
    const resMissingKey = await fetch(`${baseUrl}/api/credit/agreements/${agreementAId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({ amount: 100, paymentMethod: 'PIX', destination: 'COMPANY_ACCOUNT' }),
    });
    assert.equal(resMissingKey.status, 400);
    const bodyMissing = await resMissingKey.json();
    assert.equal(bodyMissing.code, 'IDEMPOTENCY_KEY_REQUIRED');

    // 2b. Duplo clique simultâneo com a MESMA idempotencyKey -> 1 criação + 1 replay idempotente, comissão 1000 cents única
    const sameKey = `idem_same_${uid}`;
    const [r1, r2] = await Promise.all([
      fetch(`${baseUrl}/api/credit/agreements/${agreementAId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
        body: JSON.stringify({
          amount: 100,
          paymentMethod: 'PIX',
          destination: 'COMPANY_ACCOUNT',
          idempotencyKey: sameKey,
        }),
      }),
      fetch(`${baseUrl}/api/credit/agreements/${agreementAId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
        body: JSON.stringify({
          amount: 100,
          paymentMethod: 'PIX',
          destination: 'COMPANY_ACCOUNT',
          idempotencyKey: sameKey,
        }),
      }),
    ]);

    const statusesSame = [r1.status, r2.status];
    assert.ok(statusesSame.includes(201));
    assert.ok(statusesSame.includes(200));

    const b1 = await r1.json();
    const b2 = await r2.json();
    const createdBody = r1.status === 201 ? b1 : b2;
    const replayBody = r1.status === 200 ? b1 : b2;

    assert.equal(replayBody.idempotentReplay, true);
    assert.equal(replayBody.paymentId, createdBody.paymentId);
    assert.equal(createdBody.amountCents, 10000);
    assert.equal(createdBody.remainingPrincipalCents, 90000);
    firstInstallmentPaymentId = createdBody.paymentId;

    // 2c. Reenvio sequencial posterior retorna o mesmo resultado original
    const resSeqReplay = await fetch(`${baseUrl}/api/credit/agreements/${agreementAId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({
        amount: 100,
        paymentMethod: 'PIX',
        destination: 'COMPANY_ACCOUNT',
        idempotencyKey: sameKey,
      }),
    });
    assert.equal(resSeqReplay.status, 200);
    const seqReplayBody = await resSeqReplay.json();
    assert.equal(seqReplayBody.idempotentReplay, true);
    assert.equal(seqReplayBody.paymentId, firstInstallmentPaymentId);

    const paymentsAfterSame = await prisma.creditPayment.findMany({ where: { agreementId: agreementAId } });
    assert.equal(paymentsAfterSame.length, 1);

    const instComm = await prisma.creditCommission.findFirst({
      where: { paymentId: firstInstallmentPaymentId, type: 'INSTALLMENT' },
    });
    assert.ok(instComm);
    assert.equal(instComm.amountCents, 1000); // 10% sobre R$ 100,00 = R$ 10,00

    // 2d. Chamadas concorrentes simultâneas com CHAVES DISTINTAS no mesmo contrato -> uma passa (201), outra falha com 409 CONCURRENCY_CONFLICT
    const [race1, race2] = await Promise.all([
      fetch(`${baseUrl}/api/credit/agreements/${agreementAId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
        body: JSON.stringify({
          amount: 50,
          paymentMethod: 'CASH',
          destination: 'SELLER_HANDS',
          idempotencyKey: `idem_race_a_${uid}`,
        }),
      }),
      fetch(`${baseUrl}/api/credit/agreements/${agreementAId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
        body: JSON.stringify({
          amount: 50,
          paymentMethod: 'CASH',
          destination: 'SELLER_HANDS',
          idempotencyKey: `idem_race_b_${uid}`,
        }),
      }),
    ]);

    const raceStatuses = [race1.status, race2.status];
    assert.ok(raceStatuses.includes(201), `Esperava 201 na vencedora, obteve ${raceStatuses}`);
    assert.ok(raceStatuses.includes(409), `Esperava 409 CONCURRENCY_CONFLICT na perdedora, obteve ${raceStatuses}`);

    const conflictBody = await (race1.status === 409 ? race1 : race2).json();
    assert.equal(conflictBody.code, 'CONCURRENCY_CONFLICT');

    // Saldo restante deve ser R$ 850,00 (1000 - 100 - 50) e apenas 2 pagamentos no total
    const freshAgreement = await prisma.creditAgreement.findUnique({ where: { id: agreementAId } });
    assert.equal(freshAgreement!.remainingPrincipalCents, 85000);

    const allPayments = await prisma.creditPayment.findMany({
      where: { agreementId: agreementAId },
      orderBy: { createdAt: 'asc' },
    });
    assert.equal(allPayments.length, 2);
    assert.equal(allPayments[1].amountCents, 5000);

    const comm2 = await prisma.creditCommission.findFirst({ where: { paymentId: allPayments[1].id } });
    assert.equal(comm2!.amountCents, 500); // 10% sobre R$ 50,00 pagos = R$ 5,00
  });

  it('3. Isolamento estrito de carteira entre vendedores e isolamento por companyId', async () => {
    // Seller B tenta acessar contrato de Seller A na mesma empresa -> 403
    const resContractForbidden = await fetch(`${baseUrl}/api/credit/agreements/${agreementAId}`, {
      headers: { Authorization: `Bearer ${sellerBToken}` },
    });
    assert.equal(resContractForbidden.status, 403);

    // Seller B tenta consultar carteira de Seller A -> 403
    const resPortfolioForbidden = await fetch(
      `${baseUrl}/api/credit/seller/portfolio?sellerId=${sellerAId}`,
      { headers: { Authorization: `Bearer ${sellerBToken}` } }
    );
    assert.equal(resPortfolioForbidden.status, 403);

    // Listagem de contratos de Seller B não inclui contratos de Seller A
    const resListAgreementsB = await fetch(`${baseUrl}/api/credit/agreements`, {
      headers: { Authorization: `Bearer ${sellerBToken}` },
    });
    assert.equal(resListAgreementsB.status, 200);
    const agreementsB = await resListAgreementsB.json();
    assert.equal(agreementsB.some((a: any) => a.id === agreementAId), false);

    // Seller B tenta baixar parcela do contrato de Seller A -> 403
    const resPayForbidden = await fetch(`${baseUrl}/api/credit/agreements/${agreementAId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sellerBToken}` },
      body: JSON.stringify({
        amount: 50,
        idempotencyKey: `idem_seller_forbidden_${uid}`,
      }),
    });
    assert.equal(resPayForbidden.status, 403);

    // Seller B lista /api/clients -> vê apenas suas fichas (clientB1), NÃO vê clientA1/clientA2
    const resClientsB = await fetch(`${baseUrl}/api/clients`, {
      headers: { Authorization: `Bearer ${sellerBToken}` },
    });
    assert.equal(resClientsB.status, 200);
    const clientsB = await resClientsB.json();
    assert.equal(clientsB.some((c: any) => c.id === clientA1Id || c.id === clientA2Id), false);
    assert.equal(clientsB.some((c: any) => c.id === clientB1Id), true);

    // Seller B tenta abrir ficha de Seller A por identificador ou timeline -> 403
    const resFichaForbidden = await fetch(`${baseUrl}/api/clients/ficha/SEQ_A2_${uid}`, {
      headers: { Authorization: `Bearer ${sellerBToken}` },
    });
    assert.equal(resFichaForbidden.status, 403);

    const resTimelineForbidden = await fetch(`${baseUrl}/api/clients/${clientA2Id}/timeline`, {
      headers: { Authorization: `Bearer ${sellerBToken}` },
    });
    assert.equal(resTimelineForbidden.status, 403);

    // Seller B tenta vender ficha da carteira de Seller A -> 403
    const resSellOtherWallet = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sellerBToken}` },
      body: JSON.stringify({
        clientId: clientA2Id,
        value: 400,
        city: 'Curitiba',
        product: 'Foto 20x30',
        paymentMethod: 'PIX',
        hasCover: false,
      }),
    });
    assert.equal(resSellOtherWallet.status, 403);

    // Isolamento cross-company: Admin B não acessa contrato, ficha nem comissão da Empresa A
    const resCrossAgreement = await fetch(`${baseUrl}/api/credit/agreements/${agreementAId}`, {
      headers: { Authorization: `Bearer ${adminBToken}` },
    });
    assert.equal(resCrossAgreement.status, 404);

    const resCrossClient = await fetch(`${baseUrl}/api/clients/ficha/SEQ_A1_${uid}`, {
      headers: { Authorization: `Bearer ${adminBToken}` },
    });
    assert.equal(resCrossClient.status, 404);

    const resCrossCommission = await fetch(`${baseUrl}/api/credit/commissions/${downPaymentCommId}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminBToken}` },
      body: JSON.stringify({}),
    });
    assert.equal(resCrossCommission.status, 404);

    // Seller A não enxerga ficha da Empresa B
    const resCrossSellerFicha = await fetch(`${baseUrl}/api/clients/ficha/SEQ_CB_${uid}`, {
      headers: { Authorization: `Bearer ${sellerAToken}` },
    });
    assert.equal(resCrossSellerFicha.status, 404);
  });

  it('4. Bloqueio preventivo impede novo crediário e desbloqueio administrativo exige justificativa e gera auditoria', async () => {
    // Admin A bloqueia Seller A preventivamente
    const resBlock = await fetch(`${baseUrl}/api/users/${sellerAId}/block`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({ reason: 'Divergência recorrente sob investigação administrativa' }),
    });
    assert.equal(resBlock.status, 200);
    const blockData = await resBlock.json();
    assert.equal(blockData.user.sellerBlocked, true);

    // Seller A bloqueado tenta criar venda em crediário -> 403 SELLER_PREVENTIVELY_BLOCKED
    const resBlockedSale = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sellerAToken}` },
      body: JSON.stringify({
        clientId: clientA2Id,
        value: 500,
        city: 'Curitiba',
        product: 'Álbum',
        paymentMethod: 'CREDIARIO',
        hasCover: false,
        payments: [{ method: 'PIX', amount: 150 }],
        credit: {
          downPaymentCents: 15000,
          installmentsCount: 5,
          periodicity: 'MONTHLY',
          firstDueDate: '2026-12-10',
          buyerCpf: validCpf,
          buyerName: 'Cliente A2',
          street: 'Rua das Flores',
          number: '200',
          neighborhood: 'Centro',
          city: 'Curitiba',
          state: 'PR',
        },
      }),
    });
    assert.equal(resBlockedSale.status, 403);
    const blockedBody = await resBlockedSale.json();
    assert.equal(blockedBody.code, 'SELLER_PREVENTIVELY_BLOCKED');

    // Seller B (não admin) não consegue desbloquear Seller A -> 403
    const resSellerUnblockAttempt = await fetch(`${baseUrl}/api/users/${sellerAId}/unblock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sellerBToken}` },
      body: JSON.stringify({ reason: 'Tentativa não autorizada' }),
    });
    assert.equal(resSellerUnblockAttempt.status, 403);

    // Admin sem justificativa válida não consegue desbloquear -> 400
    const resNoReason = await fetch(`${baseUrl}/api/users/${sellerAId}/unblock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({ reason: 'ok' }),
    });
    assert.equal(resNoReason.status, 400);

    // Admin A executa desbloqueio auditado
    const resUnblock = await fetch(`${baseUrl}/api/users/${sellerAId}/unblock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({ reason: 'Conferência presencial validada e assinada pelo cliente' }),
    });
    assert.equal(resUnblock.status, 200);
    const unblockData = await resUnblock.json();
    assert.equal(unblockData.user.sellerBlocked, false);

    const auditEvent = await prisma.operationalAuditEvent.findFirst({
      where: {
        companyId: compAId,
        action: 'SELLER_PREVENTIVE_BLOCK_REMOVED',
        entityId: sellerAId,
      },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(auditEvent);
    assert.equal(auditEvent.authorUserId, adminAId);

    // Após desbloqueio, Seller A consegue registrar venda à vista em sua própria ficha
    const resUnblockedSale = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sellerAToken}` },
      body: JSON.stringify({
        clientId: clientA2Id,
        value: 400,
        city: 'Curitiba',
        product: 'Foto 20x30',
        paymentMethod: 'PIX',
        hasCover: false,
      }),
    });
    assert.equal(resUnblockedSale.status, 201);
  });

  it('5. Finance overview separa estritamente Faturamento Contratado, Caixa Real, Comissões Brutas, Abatimentos de Auditoria e Comissão Líquida em centavos', async () => {
    // Registra abatimento de auditoria da Etapa 2 vinculado ao lote/venda à vista (ex: R$ 15,00 = 1500 centavos)
    const cashSale = await prisma.sale.findFirst({ where: { clientId: clientA2Id } });
    assert.ok(cashSale);

    const conf =
      (await prisma.buyerPurchaseConfirmation.findFirst({ where: { saleId: cashSale.id } })) ||
      (await prisma.buyerPurchaseConfirmation.create({
        data: {
          saleId: cashSale.id,
          companyId: compAId,
          clientId: clientA2Id,
          sellerId: sellerAId,
          tokenHash: `hash_${uid}`,
          conditionsVersion: 1,
          conditionsSnapshot: { totalCents: 40000, paidCents: 40000 },
          sellerTotalCents: 40000,
          sellerPaidCents: 40000,
          sellerPaymentMethod: 'PIX',
          expiresAt: new Date(Date.now() + 86400000),
          status: 'DIVERGENT',
        },
      }));

    await prisma.batchCommissionAdjustment.create({
      data: {
        companyId: compAId,
        batchId: batchAId,
        saleId: cashSale.id,
        sellerId: sellerAId,
        confirmationId: conf.id,
        divergenceCents: 1500,
        deductionCents: 1500, // R$ 15,00
        originalSellerTotalCents: 40000,
        auditedReferenceTotalCents: 38500,
        reason: 'Abatimento de auditoria Etapa 2',
        appliedByUserId: adminAId,
        appliedByName: 'Admin Empresa A',
      },
    });

    const resFin = await fetch(`${baseUrl}/api/finance/overview?sellerId=${sellerAId}`, {
      headers: { Authorization: `Bearer ${adminAToken}` },
    });
    assert.equal(resFin.status, 200);
    const fin = await resFin.json();

    // Faturamento contratado = 115000 (crediário) + 40000 (à vista) = 155000 (R$ 1.550,00)
    assert.equal(fin.contractedRevenueCents, 155000);
    assert.equal(fin.faturamentoBruto, 1550);

    // Caixa real recebido = 40000 (à vista) + 15000 (entrada crediário) + 15000 (10000 + 5000 parcelas pagas) = 70000 (R$ 700,00)
    assert.equal(fin.realCashReceivedCents, 70000);
    assert.equal(fin.recebimentosEfetivos, 700);
    assert.equal(fin.cashSalesReceivedCents, 40000);
    assert.equal(fin.downPaymentsReceivedCents, 15000);
    assert.equal(fin.installmentsReceivedCents, 15000);
    assert.equal(fin.receivableBalanceCents, 85000);

    // Comissões brutas = 10000 (25% de 400) + 3750 (25% de 150) + 1500 (10% de 150 em parcelas) = 15250 (R$ 152,50)
    assert.equal(fin.grossCommissionsCents, 15250);
    assert.equal(fin.cashSalesCommissionsCents, 10000);
    assert.equal(fin.downPaymentCommissionsCents, 3750);
    assert.equal(fin.installmentCommissionsCents, 1500);

    // Abatimentos de auditoria = 1500 (R$ 15,00) -> Comissão líquida = 15250 - 1500 = 13750 (R$ 137,50)
    assert.equal(fin.batchAuditDeductionsCents, 1500);
    assert.equal(fin.auditDeductionsCents, 1500);
    assert.equal(fin.netCommissionsCents, 13750);
    assert.equal(fin.comissaoLiquida, 137.5);
  });
});

