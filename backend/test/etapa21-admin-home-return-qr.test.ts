import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { prisma, disconnectPrisma } from '../src/services/prisma';
import bookRoutes from '../src/routes/books';
import salesRoutes from '../src/routes/sales';
import closingRoutes from '../src/routes/closing';
import clientRoutes from '../src/routes/clients';
import creditRoutes from '../src/routes/credit';
import { resolveReboloEnteredAt } from '../src/services/reboloValidityService';

const jwtSecret = 'test_jwt_secret_for_etapa21_suite_543210';
process.env.JWT_SECRET = jwtSecret;

const app = express();
app.use(express.json());
app.use('/api/books', bookRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/closing', closingRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/credit', creditRoutes);

const server = app.listen(0, '127.0.0.1');
const getBaseUrl = new Promise<string>((resolve) => {
  server.once('listening', () => {
    const port = (server.address() as AddressInfo).port;
    resolve(`http://127.0.0.1:${port}`);
  });
});

const createdCompanyIds: string[] = [];
const createdUserIds: string[] = [];
const createdBatchIds: string[] = [];
const createdClientIds: string[] = [];
const createdSaleIds: string[] = [];

function makeToken(user: {
  id: string;
  role: string;
  companyId: string;
  name: string;
}) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      companyId: user.companyId,
      name: user.name,
      sessionId: `sess-${user.id}`,
    },
    jwtSecret,
    { expiresIn: '1h' }
  );
}

async function apiJson(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; body?: any } = {}
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

function getTodaySaoPauloYmd(offsetDays = 0): string {
  const brMs = Date.now() - 3 * 60 * 60 * 1000 + offsetDays * 86400 * 1000;
  const br = new Date(brMs);
  const y = br.getUTCFullYear();
  const m = String(br.getUTCMonth() + 1).padStart(2, '0');
  const d = String(br.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  if (createdSaleIds.length > 0) {
    await prisma.creditInstallment.deleteMany({
      where: { agreement: { saleId: { in: createdSaleIds } } },
    });
    await prisma.creditAgreement.deleteMany({
      where: { saleId: { in: createdSaleIds } },
    });
    await prisma.buyerPurchaseConfirmation.deleteMany({
      where: { saleId: { in: createdSaleIds } },
    });
    await prisma.sale.deleteMany({
      where: { id: { in: createdSaleIds } },
    });
  }

  if (createdClientIds.length > 0) {
    await prisma.nonSale.deleteMany({
      where: { clientId: { in: createdClientIds } },
    });
    await prisma.clientTimeline.deleteMany({
      where: { clientId: { in: createdClientIds } },
    });
    await prisma.child.deleteMany({
      where: { clientId: { in: createdClientIds } },
    });
    await prisma.client.deleteMany({
      where: { id: { in: createdClientIds } },
    });
  }

  if (createdCompanyIds.length > 0) {
    await prisma.operationalAuditEvent.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.sellerCityClosing.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.dailyClosing.deleteMany({
      where: { seller: { companyId: { in: createdCompanyIds } } },
    });
    await prisma.bookBatch.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
  } else if (createdBatchIds.length > 0) {
    await prisma.bookBatch.deleteMany({
      where: { id: { in: createdBatchIds } },
    });
  }

  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({
      where: { id: { in: createdUserIds } },
    });
  }

  if (createdCompanyIds.length > 0) {
    await prisma.company.deleteMany({
      where: { id: { in: createdCompanyIds } },
    });
  }

  await disconnectPrisma();
});

test('Etapa 21: Devolução física por QR na base, fechamento sem baixa antecipada e filtros diários -03:00 da Home Admin', async (t) => {
  const baseUrl = await getBaseUrl;
  const suffix = randomUUID().slice(0, 8);
  const passwordHash = await bcrypt.hash('Test@123', 10);

  const [compA, compB] = await Promise.all([
    prisma.company.create({ data: { name: `Etapa21 Comp A ${suffix}`, tradeName: `Comp A21 ${suffix}` } }),
    prisma.company.create({ data: { name: `Etapa21 Comp B ${suffix}`, tradeName: `Comp B21 ${suffix}` } }),
  ]);
  createdCompanyIds.push(compA.id, compB.id);

  const adminAId = randomUUID();
  const adminBId = randomUUID();
  const photogAId = randomUUID();
  const sellerAId = randomUUID();
  const sellerBId = randomUUID();

  const [adminA, adminB, photogA, sellerA, sellerB] = await Promise.all([
    prisma.user.create({
      data: {
        id: adminAId,
        name: 'Admin A21',
        cpf: `9101${suffix}`,
        email: `admin-a21-${suffix}@test.local`,
        password: passwordHash,
        role: 'ADMIN',
        companyId: compA.id,
        active: true,
        activeSessionId: `sess-${adminAId}`,
      },
    }),
    prisma.user.create({
      data: {
        id: adminBId,
        name: 'Admin B21',
        cpf: `9102${suffix}`,
        email: `admin-b21-${suffix}@test.local`,
        password: passwordHash,
        role: 'ADMIN',
        companyId: compB.id,
        active: true,
        activeSessionId: `sess-${adminBId}`,
      },
    }),
    prisma.user.create({
      data: {
        id: photogAId,
        name: 'Fotog A21',
        cpf: `9103${suffix}`,
        email: `photog-a21-${suffix}@test.local`,
        password: passwordHash,
        role: 'PHOTOGRAPHER',
        companyId: compA.id,
        active: true,
        activeSessionId: `sess-${photogAId}`,
      },
    }),
    prisma.user.create({
      data: {
        id: sellerAId,
        name: 'Vendedor A21',
        cpf: `9104${suffix}`,
        email: `seller-a21-${suffix}@test.local`,
        password: passwordHash,
        role: 'SELLER',
        companyId: compA.id,
        active: true,
        activeSessionId: `sess-${sellerAId}`,
      },
    }),
    prisma.user.create({
      data: {
        id: sellerBId,
        name: 'Vendedor B21',
        cpf: `9105${suffix}`,
        email: `seller-b21-${suffix}@test.local`,
        password: passwordHash,
        role: 'SELLER',
        companyId: compB.id,
        active: true,
        activeSessionId: `sess-${sellerBId}`,
      },
    }),
  ]);
  createdUserIds.push(adminA.id, adminB.id, photogA.id, sellerA.id, sellerB.id);

  const adminAToken = makeToken({ id: adminA.id, role: 'ADMIN', companyId: compA.id, name: adminA.name });
  const adminBToken = makeToken({ id: adminB.id, role: 'ADMIN', companyId: compB.id, name: adminB.name });
  const sellerAToken = makeToken({ id: sellerA.id, role: 'SELLER', companyId: compA.id, name: sellerA.name });

  const batchA = await prisma.bookBatch.create({
    data: {
      name: `Lote QR21 ${suffix}`,
      city: 'Florianópolis',
      companyId: compA.id,
      photographerId: photogA.id,
      status: 'DISTRIBUTED',
      totalProduced: 4,
    },
  });
  createdBatchIds.push(batchA.id);

  const [cRebolo, cTravel, cDefect, cSecondCycle] = await Promise.all([
    prisma.client.create({
      data: {
        uuid: randomUUID(),
        name: 'Cliente Rebolo 21',
        mainContact: 'Pai 1',
        phone1: '48999990001',
        city: 'Florianópolis',
        companyId: compA.id,
        photographerId: photogA.id,
        assignedSellerId: sellerA.id,
        batchId: batchA.id,
        bookStatus: 'DISTRIBUTED',
        outcomeStatus: 'PENDING',
        commercialCycle: 1,
        visibleCode: `E21-R-${suffix}`,
        sequenceNumber: `21R-${suffix}`,
      },
    }),
    prisma.client.create({
      data: {
        uuid: randomUUID(),
        name: 'Cliente Em Viagem 21',
        mainContact: 'Mae 2',
        phone1: '48999990002',
        city: 'Florianópolis',
        companyId: compA.id,
        photographerId: photogA.id,
        assignedSellerId: sellerA.id,
        batchId: batchA.id,
        bookStatus: 'DISTRIBUTED',
        outcomeStatus: 'PENDING',
        commercialCycle: 1,
        visibleCode: `E21-V-${suffix}`,
        sequenceNumber: `21V-${suffix}`,
      },
    }),
    prisma.client.create({
      data: {
        uuid: randomUUID(),
        name: 'Cliente Defeito 21',
        mainContact: 'Pai 3',
        phone1: '48999990003',
        city: 'Florianópolis',
        companyId: compA.id,
        photographerId: photogA.id,
        assignedSellerId: sellerA.id,
        batchId: batchA.id,
        bookStatus: 'DISTRIBUTED',
        outcomeStatus: 'PENDING',
        commercialCycle: 1,
        visibleCode: `E21-D-${suffix}`,
        sequenceNumber: `21D-${suffix}`,
      },
    }),
    prisma.client.create({
      data: {
        uuid: randomUUID(),
        name: 'Cliente 2Ciclo 21',
        mainContact: 'Mae 4',
        phone1: '48999990004',
        city: 'Florianópolis',
        companyId: compA.id,
        photographerId: photogA.id,
        assignedSellerId: sellerA.id,
        batchId: batchA.id,
        bookStatus: 'DISTRIBUTED',
        outcomeStatus: 'PENDING',
        commercialCycle: 2,
        visibleCode: `E21-2-${suffix}`,
        sequenceNumber: `21S-${suffix}`,
      },
    }),
  ]);
  createdClientIds.push(cRebolo.id, cTravel.id, cDefect.id, cSecondCycle.id);

  // Deixa cSecondCycle com 1 nao-venda anterior para completar 2a nao-venda
  await prisma.nonSale.create({
    data: {
      clientId: cSecondCycle.id,
      sellerId: sellerA.id,
      companyId: compA.id,
      reason: 'Cliente ausente ciclo 1',
      date: new Date(Date.now() - 20 * 86400 * 1000),
    },
  });

  const sig =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  await t.test('1) Não-venda comum e Em Viagem ficam AWAITING_RETURN inclusive após fechamento da cidade', async () => {
    for (const [cl, reason] of [
      [cRebolo, 'Cliente ausente no momento'],
      [cTravel, 'Em Viagem'],
      [cDefect, 'Material com defeito de gráfica'],
      [cSecondCycle, 'Não fechou na 2a visita'],
    ] as const) {
      const r = await apiJson(baseUrl, '/api/sales/non-sale', {
        method: 'POST',
        token: sellerAToken,
        body: {
          clientId: cl.id,
          sellerId: sellerA.id,
          reason,
          signatureBase64: sig,
        },
      });
      assert.ok(r.status === 200 || r.status === 201, `non-sale falhou: ${JSON.stringify(r.json)}`);
      assert.equal(r.json?.bookStatus, 'AWAITING_RETURN');
    }

    // Fechamento da cidade não altera AWAITING_RETURN nem bloqueia pendência física
    const closeCityRes = await apiJson(baseUrl, '/api/closing/cities', {
      method: 'POST',
      token: sellerAToken,
      body: { cities: ['Florianópolis'] },
    });
    assert.equal(closeCityRes.status, 201, `closeCity falhou: ${JSON.stringify(closeCityRes.json)}`);
    assert.equal(Number(closeCityRes.json?.pendingPhysicalReturnsCount || 0), 4);

    // Rebolo nunca inclui Em Viagem
    const rebolosRes = await apiJson(baseUrl, '/api/clients/rebolos', { token: adminAToken });
    assert.equal(rebolosRes.status, 200);
    const reboloIds = (rebolosRes.json || []).map((x: any) => x.id);
    assert.equal(reboloIds.includes(cTravel.id), false);
    assert.equal(reboloIds.includes(cRebolo.id), true);

    // GET /api/books/pending-returns agrupa com contadores Bipados 0 de 4 / Faltam 4
    const pendRes = await apiJson(baseUrl, '/api/books/pending-returns', { token: adminAToken });
    assert.equal(pendRes.status, 200);
    assert.equal(pendRes.json?.totalPending, 4);
    assert.equal(pendRes.json?.totalScanned, 0);
    assert.equal(pendRes.json?.totalExpected, 4);
    const grp = (pendRes.json?.groups || []).find(
      (g: any) => g.sellerId === sellerA.id && g.batchId === batchA.id
    );
    assert.ok(grp);
    assert.equal(grp.pendingCount, 4);
    assert.equal(grp.scannedCount, 0);
    assert.equal(grp.totalExpected, 4);
  });

  await t.test('2) Bipagem QR na base roteia corretamente (Rebolo / Em Viagem Virgem / Descarte), é idempotente e isola empresas', async () => {
    // Empresa B não pode bipar ficha da Empresa A
    const crossCompanyScan = await apiJson(baseUrl, '/api/books/receive-return', {
      method: 'POST',
      token: adminBToken,
      body: { qrCode: cRebolo.uuid },
    });
    assert.equal(crossCompanyScan.status, 404);

    // 1) Bipa Rebolo via QR composto -> IN_STOCK_REBOLO + ciclo 2 + contador 1/4
    const scanRebolo = await apiJson(baseUrl, '/api/books/receive-return', {
      method: 'POST',
      token: adminAToken,
      body: { qrCode: `LUMORA:BOOK:${cRebolo.uuid}` },
    });
    assert.equal(scanRebolo.status, 200);
    assert.equal(scanRebolo.json?.routingType, 'REBOLO');
    assert.equal(scanRebolo.json?.alreadyProcessed, false);
    assert.equal(scanRebolo.json?.client?.bookStatus, 'IN_STOCK_REBOLO');
    assert.equal(scanRebolo.json?.client?.assignedSellerId, null);
    assert.equal(scanRebolo.json?.batchReturnProgress?.scannedCount, 1);
    assert.equal(scanRebolo.json?.batchReturnProgress?.pendingCount, 3);
    assert.equal(scanRebolo.json?.batchReturnProgress?.totalExpected, 4);

    // Bipa novamente o mesmo QR -> idempotente (200, alreadyProcessed: true)
    const duplicateScan = await apiJson(baseUrl, '/api/books/receive-return', {
      method: 'POST',
      token: adminAToken,
      body: { qrCode: cRebolo.uuid },
    });
    assert.equal(duplicateScan.status, 200);
    assert.equal(duplicateScan.json?.alreadyProcessed, true);
    assert.equal(duplicateScan.json?.client?.bookStatus, 'IN_STOCK_REBOLO');

    // Auditoria e timeline gravadas
    const tl = await prisma.clientTimeline.findFirst({
      where: { clientId: cRebolo.id, action: 'RECEIVE_RETURN' },
    });
    assert.ok(tl);
    const audit = await prisma.operationalAuditEvent.findFirst({
      where: { companyId: compA.id, action: 'ADMIN_RECEIVE_RETURN', entityId: cRebolo.id },
    });
    assert.ok(audit);

    // Prazo de 365 dias usa a data da bipagem física (RECEIVE_RETURN) como marco inicial
    const enteredAt = resolveReboloEnteredAt({
      outcomeUpdatedAt: new Date(Date.now() - 10 * 86400 * 1000),
      nonSales: [{ date: new Date(Date.now() - 10 * 86400 * 1000), supersededAt: null }],
      timeline: [{ action: 'RECEIVE_RETURN', timestamp: tl!.timestamp, newStatus: 'IN_STOCK_REBOLO' }],
    });
    assert.ok(enteredAt);
    assert.equal(enteredAt!.getTime(), tl!.timestamp.getTime());

    // 2) Bipa Em Viagem -> IN_STOCK_VIRGIN (nunca Rebolo)
    const scanTravel = await apiJson(baseUrl, '/api/books/receive-return', {
      method: 'POST',
      token: adminAToken,
      body: { identifier: cTravel.visibleCode },
    });
    assert.equal(scanTravel.status, 200);
    assert.equal(scanTravel.json?.routingType, 'EM_VIAGEM');
    assert.equal(scanTravel.json?.client?.bookStatus, 'IN_STOCK_VIRGIN');

    const travelList = await apiJson(baseUrl, '/api/books/travel-virgin', { token: adminAToken });
    assert.equal(travelList.status, 200);
    assert.ok((travelList.json || []).some((c: any) => c.id === cTravel.id));

    // 3) Bipa Defeito -> DISCARDED
    const scanDefect = await apiJson(baseUrl, '/api/books/receive-return', {
      method: 'POST',
      token: adminAToken,
      body: { code: cDefect.sequenceNumber, condition: 'DEFECT' },
    });
    assert.equal(scanDefect.status, 200);
    assert.equal(scanDefect.json?.routingType, 'DEFECT');
    assert.equal(scanDefect.json?.client?.bookStatus, 'DISCARDED');

    // 4) Bipa 2a Não-Venda -> DISCARDED
    const scanSecond = await apiJson(baseUrl, '/api/books/receive-return', {
      method: 'POST',
      token: adminAToken,
      body: { clientId: cSecondCycle.id },
    });
    assert.equal(scanSecond.status, 200);
    assert.equal(scanSecond.json?.routingType, 'DISCARD_SECOND_CYCLE');
    assert.equal(scanSecond.json?.client?.bookStatus, 'DISCARDED');

    // Pendências zeradas após bipar as 4 fichas
    const pendAfter = await apiJson(baseUrl, '/api/books/pending-returns', { token: adminAToken });
    assert.equal(pendAfter.status, 200);
    assert.equal(pendAfter.json?.totalPending, 0);
  });

  await t.test('3) Atalhos Cobranças do Dia (DUE_TODAY) e Conferência do Dia (todayOnly) respeitam -03:00 e multi-tenant', async () => {
    const todayBr = getTodaySaoPauloYmd(0);
    const yesterdayBr = getTodaySaoPauloYmd(-1);
    const todayMidBr = new Date(`${todayBr}T12:00:00.000-03:00`);
    const tomorrowMidBr = new Date(`${getTodaySaoPauloYmd(1)}T12:00:00.000-03:00`);
    const yesterdayMidBr = new Date(`${yesterdayBr}T15:00:00.000-03:00`);

    const [clientCredA, clientCredB, clientConfToday, clientConfOld] = await Promise.all([
      prisma.client.create({
        data: {
          uuid: randomUUID(),
          name: 'Cliente Cred Hoje A',
          city: 'Palhoça',
          companyId: compA.id,
          photographerId: photogA.id,
          bookStatus: 'SOLD',
          sequenceNumber: `21CA-${suffix}`,
        },
      }),
      prisma.client.create({
        data: {
          uuid: randomUUID(),
          name: 'Cliente Cred Hoje B',
          city: 'São José',
          companyId: compB.id,
          bookStatus: 'SOLD',
          sequenceNumber: `21CB-${suffix}`,
        },
      }),
      prisma.client.create({
        data: {
          uuid: randomUUID(),
          name: 'Cliente Conf Hoje',
          city: 'Biguaçu',
          companyId: compA.id,
          photographerId: photogA.id,
          bookStatus: 'SOLD',
          sequenceNumber: `21CT-${suffix}`,
        },
      }),
      prisma.client.create({
        data: {
          uuid: randomUUID(),
          name: 'Cliente Conf Ontem',
          city: 'Biguaçu',
          companyId: compA.id,
          photographerId: photogA.id,
          bookStatus: 'SOLD',
          sequenceNumber: `21CO-${suffix}`,
        },
      }),
    ]);
    createdClientIds.push(clientCredA.id, clientCredB.id, clientConfToday.id, clientConfOld.id);

    const [saleCredA, saleCredB, saleConfToday, saleConfOld] = await Promise.all([
      prisma.sale.create({
        data: {
          clientId: clientCredA.id,
          sellerId: sellerA.id,
          companyId: compA.id,
          city: 'Palhoça',
          paymentMethod: 'BOLETO',
          value: 400,
        },
      }),
      prisma.sale.create({
        data: {
          clientId: clientCredB.id,
          sellerId: sellerB.id,
          companyId: compB.id,
          city: 'São José',
          paymentMethod: 'BOLETO',
          value: 500,
        },
      }),
      prisma.sale.create({
        data: {
          clientId: clientConfToday.id,
          sellerId: sellerA.id,
          companyId: compA.id,
          city: 'Biguaçu',
          paymentMethod: 'PIX',
          value: 350,
          date: todayMidBr,
        },
      }),
      prisma.sale.create({
        data: {
          clientId: clientConfOld.id,
          sellerId: sellerA.id,
          companyId: compA.id,
          city: 'Biguaçu',
          paymentMethod: 'PIX',
          value: 250,
          date: yesterdayMidBr,
        },
      }),
    ]);
    createdSaleIds.push(saleCredA.id, saleCredB.id, saleConfToday.id, saleConfOld.id);

    const agrA = await prisma.creditAgreement.create({
      data: {
        saleId: saleCredA.id,
        clientId: clientCredA.id,
        sellerId: sellerA.id,
        companyId: compA.id,
        buyerName: 'Comprador Cred Hoje A',
        buyerCpf: '11122233344',
        street: 'Rua A',
        number: '100',
        neighborhood: 'Centro',
        city: 'Palhoça',
        state: 'SC',
        totalSaleCents: 40000,
        downPaymentCents: 0,
        financedPrincipalCents: 40000,
        remainingPrincipalCents: 40000,
        installmentsCount: 2,
        firstDueDate: todayMidBr,
        status: 'ACTIVE',
      },
    });
    await prisma.creditInstallment.createMany({
      data: [
        {
          agreementId: agrA.id,
          installmentNumber: 1,
          amountCents: 20000,
          dueDate: todayMidBr,
          status: 'PENDING',
        },
        {
          agreementId: agrA.id,
          installmentNumber: 2,
          amountCents: 20000,
          dueDate: tomorrowMidBr,
          status: 'PENDING',
        },
      ],
    });

    const agrB = await prisma.creditAgreement.create({
      data: {
        saleId: saleCredB.id,
        clientId: clientCredB.id,
        sellerId: sellerB.id,
        companyId: compB.id,
        buyerName: 'Comprador Cred Hoje B',
        buyerCpf: '55566677788',
        street: 'Rua B',
        number: '200',
        neighborhood: 'Kobrasol',
        city: 'São José',
        state: 'SC',
        totalSaleCents: 50000,
        downPaymentCents: 0,
        financedPrincipalCents: 50000,
        remainingPrincipalCents: 50000,
        installmentsCount: 1,
        firstDueDate: todayMidBr,
        status: 'ACTIVE',
      },
    });
    await prisma.creditInstallment.create({
      data: {
        agreementId: agrB.id,
        installmentNumber: 1,
        amountCents: 50000,
        dueDate: todayMidBr,
        status: 'PENDING',
      },
    });

    const farFuture = new Date(Date.now() + 7 * 86400 * 1000);
    await prisma.buyerPurchaseConfirmation.createMany({
      data: [
        {
          tokenHash: `tok-today-${suffix}`,
          saleId: saleConfToday.id,
          clientId: clientConfToday.id,
          sellerId: sellerA.id,
          companyId: compA.id,
          conditionsSnapshot: { totalCents: 35000 },
          sellerTotalCents: 35000,
          sellerPaidCents: 35000,
          sellerPaymentMethod: 'PIX',
          reportedTotalCents: 20000,
          hasDivergence: true,
          status: 'UNDER_REVIEW',
          expiresAt: farFuture,
          createdAt: todayMidBr,
          usedAt: todayMidBr,
        },
        {
          tokenHash: `tok-old-${suffix}`,
          saleId: saleConfOld.id,
          clientId: clientConfOld.id,
          sellerId: sellerA.id,
          companyId: compA.id,
          conditionsSnapshot: { totalCents: 25000 },
          sellerTotalCents: 25000,
          sellerPaidCents: 25000,
          sellerPaymentMethod: 'PIX',
          reportedTotalCents: 25000,
          hasDivergence: false,
          status: 'CONFIRMED',
          expiresAt: farFuture,
          createdAt: yesterdayMidBr,
          usedAt: yesterdayMidBr,
        },
      ],
    });

    // DUE_TODAY traz apenas contrato da Empresa A vencendo hoje (-03:00)
    const dueRes = await apiJson(baseUrl, '/api/credit/agreements?status=DUE_TODAY', {
      token: adminAToken,
    });
    assert.equal(dueRes.status, 200);
    const dueIds = (dueRes.json || []).map((a: any) => a.id);
    assert.equal(dueIds.includes(agrA.id), true);
    assert.equal(dueIds.includes(agrB.id), false);

    // buyer-confirmations/review?todayOnly=true traz apenas confirmação de hoje com divergência
    const revRes = await apiJson(
      baseUrl,
      '/api/sales/buyer-confirmations/review?todayOnly=true',
      { token: adminAToken }
    );
    assert.equal(revRes.status, 200);
    assert.equal(revRes.json?.summary?.total, 1);
    assert.equal(revRes.json?.summary?.divergentCount, 1);
    assert.equal(revRes.json?.confirmations?.[0]?.saleId, saleConfToday.id);
  });
});
