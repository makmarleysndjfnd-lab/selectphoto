import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { prisma, disconnectPrisma } from '../src/services/prisma';
import salesRoutes from '../src/routes/sales';
import closingRoutes from '../src/routes/closing';
import statsRoutes from '../src/routes/stats';
import financeRoutes from '../src/routes/finance';
import advancesRoutes from '../src/routes/advances';
import { previewOrGetCompanyStatement } from '../src/services/platformBillingService';

function getCompetenceForDate(date: Date): string {
  const br = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  const y = br.getUTCFullYear();
  const m = String(br.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

const jwtSecret = 'test_jwt_secret_for_etapa24_suite_112233';
process.env.JWT_SECRET = jwtSecret;

const app = express();
app.use(express.json());
app.use('/api/sales', salesRoutes);
app.use('/api/closing', closingRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/advances', advancesRoutes);

const server = app.listen(0, '127.0.0.1');
const getBaseUrl = new Promise<string>((resolve) => {
  server.once('listening', () => {
    const port = (server.address() as AddressInfo).port;
    resolve(`http://127.0.0.1:${port}`);
  });
});

const createdCompanyIds: string[] = [];
const createdUserIds: string[] = [];
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

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  if (createdCompanyIds.length > 0) {
    await prisma.platformStatementAdjustment.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.platformStatementItem.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.platformMonthlyStatement.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.companyPlatformRate.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.saleAdjustment.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.staffAdvanceEntry.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.operationalAuditEvent.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
  }
  if (createdSaleIds.length > 0) {
    await prisma.creditInstallment.deleteMany({
      where: { agreement: { saleId: { in: createdSaleIds } } },
    });
    await prisma.creditAgreement.deleteMany({
      where: { saleId: { in: createdSaleIds } },
    });
    await prisma.salePayment.deleteMany({
      where: { saleId: { in: createdSaleIds } },
    });
    await prisma.sale.deleteMany({ where: { id: { in: createdSaleIds } } });
  }
  if (createdUserIds.length > 0) {
    await prisma.sellerCoverBalance.deleteMany({
      where: { sellerId: { in: createdUserIds } },
    });
    await prisma.dailyClosing.deleteMany({
      where: { sellerId: { in: createdUserIds } },
    });
  }
  if (createdClientIds.length > 0) {
    await prisma.clientTimeline.deleteMany({
      where: { clientId: { in: createdClientIds } },
    });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  if (createdCompanyIds.length > 0) {
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  }

  await disconnectPrisma();
});

async function setupFixture() {
  const uid = randomUUID().slice(0, 8);
  const passwordHash = await bcrypt.hash('Test@123', 4);

  const company = await prisma.company.create({
    data: { name: `Empresa Etapa24 ${uid}`, cnpj: `24${uid}000199` },
  });
  createdCompanyIds.push(company.id);

  const adminId = randomUUID();
  const sellerId = randomUUID();
  const photogId = randomUUID();
  const otherAdminId = randomUUID();

  const admin = await prisma.user.create({
    data: {
      id: adminId,
      name: `Admin 24 ${uid}`,
      email: `admin24-${uid}@test.local`,
      password: passwordHash,
      role: 'ADMIN',
      companyId: company.id,
      active: true,
      activeSessionId: `sess-${adminId}`,
    },
  });
  createdUserIds.push(admin.id);

  const seller = await prisma.user.create({
    data: {
      id: sellerId,
      name: `Seller 24 ${uid}`,
      email: `seller24-${uid}@test.local`,
      password: passwordHash,
      role: 'SELLER',
      companyId: company.id,
      usesOwnCar: true, // 25% comissão
      active: true,
      activeSessionId: `sess-${sellerId}`,
    },
  });
  createdUserIds.push(seller.id);

  const photographer = await prisma.user.create({
    data: {
      id: photogId,
      name: `Photo 24 ${uid}`,
      email: `photo24-${uid}@test.local`,
      password: passwordHash,
      role: 'PHOTOGRAPHER',
      companyId: company.id,
      active: true,
      activeSessionId: `sess-${photogId}`,
    },
  });
  createdUserIds.push(photographer.id);

  const otherCompany = await prisma.company.create({
    data: { name: `Outra Empresa 24 ${uid}`, cnpj: `99${uid}000188` },
  });
  createdCompanyIds.push(otherCompany.id);

  const otherAdmin = await prisma.user.create({
    data: {
      id: otherAdminId,
      name: `Other Admin 24 ${uid}`,
      email: `otheradmin24-${uid}@test.local`,
      password: passwordHash,
      role: 'ADMIN',
      companyId: otherCompany.id,
      active: true,
      activeSessionId: `sess-${otherAdminId}`,
    },
  });
  createdUserIds.push(otherAdmin.id);

  return {
    uid,
    company,
    admin,
    seller,
    photographer,
    otherAdmin,
    adminToken: makeToken({ id: admin.id, role: 'ADMIN', companyId: company.id, name: admin.name }),
    sellerToken: makeToken({ id: seller.id, role: 'SELLER', companyId: company.id, name: seller.name }),
    photoToken: makeToken({ id: photographer.id, role: 'PHOTOGRAPHER', companyId: company.id, name: photographer.name }),
    otherAdminToken: makeToken({ id: otherAdmin.id, role: 'ADMIN', companyId: otherCompany.id, name: otherAdmin.name }),
  };
}

test('Etapa 24 - 1. Controle de acesso (403 vendedor/fotógrafo/outra empresa) e mesma competência em aberto sem dupla cobrança', async () => {
  const baseUrl = await getBaseUrl;
  const fx = await setupFixture();

  const client = await prisma.client.create({
    data: {
      companyId: fx.company.id,
      name: `Cliente Aberto ${fx.uid}`,
      city: 'Londrina',
      sequenceNumber: `F24A-${fx.uid}`,
      assignedSellerId: fx.seller.id,
      photographerId: fx.photographer.id,
      outcomeStatus: 'SOLD',
      bookStatus: 'WITH_CLIENT',
    },
  });
  createdClientIds.push(client.id);

  const sale = await prisma.sale.create({
    data: {
      companyId: fx.company.id,
      clientId: client.id,
      sellerId: fx.seller.id,
      value: 1000,
      city: 'Londrina',
      paymentMethod: 'DINHEIRO',
      paymentStatus: 'PAID',
      status: 'PRONTO',
      fichaNumber: client.sequenceNumber,
      receiptUrl: '/uploads/fake-receipt.jpg',
      coverDeducted: true,
      payments: {
        create: [{ method: 'CASH', amount: 1000 }],
      },
    },
  });
  createdSaleIds.push(sale.id);

  await prisma.sellerCoverBalance.create({
    data: { sellerId: fx.seller.id, balance: 5 },
  });

  // 403 para vendedor e fotógrafo
  const sellerRes = await apiJson(baseUrl, `/api/sales/${sale.id}/refund-or-cancel`, {
    method: 'POST',
    token: fx.sellerToken,
    body: { type: 'PARTIAL_REFUND_DISCOUNT', amount: 100, reason: 'Tentativa seller' },
  });
  assert.equal(sellerRes.status, 403);

  const photoRes = await apiJson(baseUrl, `/api/sales/${sale.id}/refund-or-cancel`, {
    method: 'POST',
    token: fx.photoToken,
    body: { type: 'FULL_CANCELLATION', reason: 'Tentativa fotografo' },
  });
  assert.equal(photoRes.status, 403);

  const crossCompanyRes = await apiJson(baseUrl, `/api/sales/${sale.id}/refund-or-cancel`, {
    method: 'POST',
    token: fx.otherAdminToken,
    body: { type: 'FULL_CANCELLATION', reason: 'Outra empresa' },
  });
  assert.equal(crossCompanyRes.status, 403);

  // Admin aplica desconto parcial de R$ 300,00 no mesmo dia com fechamento ainda em aberto
  const partialRes = await apiJson(baseUrl, `/api/sales/${sale.id}/refund-or-cancel`, {
    method: 'POST',
    token: fx.adminToken,
    body: {
      type: 'PARTIAL_REFUND_DISCOUNT',
      amountCents: 30000,
      reason: 'Desconto comercial combinado com cliente',
      receiptUrl: '/uploads/refund-pix.jpg',
    },
  });
  assert.equal(partialRes.status, 201, `Unexpected partialRes: ${JSON.stringify(partialRes.json)}`);
  assert.equal(partialRes.json.sale.saleStatus, 'PARTIALLY_REFUNDED');
  assert.equal(partialRes.json.sale.refundedAmountCents, 30000);
  assert.equal(partialRes.json.commissionAlreadyAccounted, false);
  assert.equal(partialRes.json.sellerAdvanceEntry, null); // Não deve cobrar em duplicidade no mesmo dia em aberto

  // Verificar fechamento diário (700 líquido, comissão 25% = 175)
  const closingRes = await apiJson(baseUrl, `/api/closing/daily/${fx.seller.id}`, {
    token: fx.adminToken,
  });
  assert.equal(closingRes.status, 200);
  assert.equal(closingRes.json.totalSalesValue, 700);
  assert.equal(closingRes.json.cashValue, 700);
  assert.equal(closingRes.json.commissionAmount, 175);
  assert.equal(closingRes.json.openAdvancesCents, 0);

  // Verificar Stats BI & Financeiro refletem 700 líquido
  const statsRes = await apiJson(baseUrl, '/api/stats/books', { token: fx.adminToken });
  assert.equal(statsRes.status, 200);
  assert.equal(statsRes.json.analiseValores.faturamentoTotal, 700);

  const finRes = await apiJson(baseUrl, '/api/finance/overview', { token: fx.adminToken });
  assert.equal(finRes.status, 200);
  assert.equal(finRes.json.faturamentoContratado, 700);
  assert.equal(finRes.json.faturamentoContratadoCents, 70000);

  // Verificar faturamento mensal na plataforma (competência aberta usa líquido 700)
  const comp = getCompetenceForDate(new Date());
  const billingPreview = await previewOrGetCompanyStatement(
    { companyId: fx.company.id, competence: comp },
    prisma
  );
  assert.equal(billingPreview.preview?.financialSeparation?.companyConfirmedSalesCents, 70000);

  // Cancelamento total dos R$ 700 restantes -> exclui 100%, restaura capa e volta ficha para PENDING
  const cancelRes = await apiJson(baseUrl, `/api/sales/${sale.id}/refund-or-cancel`, {
    method: 'POST',
    token: fx.adminToken,
    body: {
      type: 'FULL_CANCELLATION',
      reason: 'Cliente devolveu o material completo',
    },
  });
  assert.equal(cancelRes.status, 201);
  assert.equal(cancelRes.json.sale.saleStatus, 'CANCELLED');
  assert.equal(cancelRes.json.sale.refundedAmountCents, 100000);
  assert.equal(cancelRes.json.sale.coverDeducted, false);

  const updatedClient = await prisma.client.findUnique({ where: { id: client.id } });
  assert.equal(updatedClient?.outcomeStatus, 'PENDING');
  const coverBal = await prisma.sellerCoverBalance.findUnique({ where: { sellerId: fx.seller.id } });
  assert.equal(coverBal?.balance, 6);

  // Tentar estornar venda já cancelada -> 409
  const dupCancel = await apiJson(baseUrl, `/api/sales/${sale.id}/refund-or-cancel`, {
    method: 'POST',
    token: fx.adminToken,
    body: { type: 'FULL_CANCELLATION', reason: 'Duplicado' },
  });
  assert.equal(dupCancel.status, 409);

  // Fechamento diário e stats agora zerados
  const closingAfterCancel = await apiJson(baseUrl, `/api/closing/daily/${fx.seller.id}`, {
    token: fx.adminToken,
  });
  assert.equal(closingAfterCancel.json.salesCount, 0);
  assert.equal(closingAfterCancel.json.totalSalesValue, 0);

  const statsAfterCancel = await apiJson(baseUrl, '/api/stats/books', { token: fx.adminToken });
  assert.equal(statsAfterCancel.json.analiseValores.totalVendas, 0);
  assert.equal(statsAfterCancel.json.analiseValores.faturamentoTotal, 0);

  // Histórico de ajustes da venda acessível ao Admin
  const histRes = await apiJson(baseUrl, `/api/sales/${sale.id}/adjustments`, {
    token: fx.adminToken,
  });
  assert.equal(histRes.status, 200);
  assert.equal(histRes.json.adjustments.length, 2);
});

test('Etapa 24 - 2. Venda com fechamento já realizado gera débito automático idempotente em Vales + Crédito em competência mensal fechada', async () => {
  const baseUrl = await getBaseUrl;
  const fx = await setupFixture();

  // Configurar taxa de plataforma 5% e fechar competência anterior para simular venda já faturada
  await prisma.companyPlatformRate.create({
    data: {
      companyId: fx.company.id,
      version: 1,
      ratePercentage: '5.00',
      effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
      reason: 'Taxa teste Etapa 24',
      createdByUserId: fx.admin.id,
      createdByName: fx.admin.name,
    },
  });

  const client = await prisma.client.create({
    data: {
      companyId: fx.company.id,
      name: `Cliente Fechado ${fx.uid}`,
      city: 'Maringá',
      sequenceNumber: `F24B-${fx.uid}`,
      assignedSellerId: fx.seller.id,
      photographerId: fx.photographer.id,
      outcomeStatus: 'SOLD',
    },
  });
  createdClientIds.push(client.id);

  const pastDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000); // mês anterior
  const originComp = getCompetenceForDate(pastDate);

  const sale = await prisma.sale.create({
    data: {
      companyId: fx.company.id,
      clientId: client.id,
      sellerId: fx.seller.id,
      value: 1000,
      city: 'Maringá',
      date: pastDate,
      paymentMethod: 'PIX',
      paymentStatus: 'PAID',
      status: 'PRONTO',
      fichaNumber: client.sequenceNumber,
      receiptUrl: '/uploads/receipt-b.jpg',
      payments: { create: [{ method: 'PIX', amount: 1000 }] },
    },
  });
  createdSaleIds.push(sale.id);

  // Simular demonstrativo mensal fechado contendo essa venda (R$ 1.000 -> taxa R$ 50,00)
  const closedStatement = await prisma.platformMonthlyStatement.create({
    data: {
      companyId: fx.company.id,
      competence: originComp,
      status: 'CLOSED',
      startDate: new Date(`${originComp}-01T03:00:00.000Z`),
      endDate: new Date(`${originComp}-28T03:00:00.000Z`),
      eligibleSalesCount: 1,
      eligibleSalesBaseCents: 100000,
      grossPlatformFeeCents: 5000,
      adjustmentsCents: 0,
      netDueCents: 5000,
      remainingBalanceCents: 5000,
      vigenciaBreakdown: [],
      closedByUserId: fx.admin.id,
      closedByName: fx.admin.name,
    },
  });

  const rateRow = await prisma.companyPlatformRate.findFirstOrThrow({
    where: { companyId: fx.company.id },
  });

  await prisma.platformStatementItem.create({
    data: {
      statementId: closedStatement.id,
      companyId: fx.company.id,
      competence: originComp,
      saleId: sale.id,
      saleReference: sale.fichaNumber || sale.id,
      saleDate: pastDate,
      city: 'Maringá',
      product: 'Book',
      paymentModality: 'PIX',
      saleBaseCents: 100000,
      rateId: rateRow.id,
      rateVersion: 1,
      ratePercentage: rateRow.ratePercentage,
      rateMilliPercent: 5000,
      calculatedFeeCents: 5000,
    },
  });

  // Admin estorna R$ 200,00 da venda já fechada/faturada
  const adjRes = await apiJson(baseUrl, `/api/sales/${sale.id}/refund-or-cancel`, {
    method: 'POST',
    token: fx.adminToken,
    body: {
      type: 'PARTIAL_REFUND_DISCOUNT',
      amountCents: 20000,
      reason: 'Desconto pós-fechamento em conta fechada',
    },
  });
  assert.equal(adjRes.status, 201, `Unexpected adjRes: ${JSON.stringify(adjRes.json)}`);
  assert.equal(adjRes.json.commissionAlreadyAccounted, true);
  assert.equal(adjRes.json.commissionDebitCents, 5000); // 25% de R$ 200,00 = R$ 50,00

  // Deve ter lançado DEBIT automático em StaffAdvanceEntry (Vales)
  assert.ok(adjRes.json.sellerAdvanceEntry?.id);
  assert.equal(adjRes.json.sellerAdvanceEntry.direction, 'DEBIT');
  assert.equal(adjRes.json.sellerAdvanceEntry.category, 'ADJUSTMENT_DIVERGENCE');
  assert.equal(adjRes.json.sellerAdvanceEntry.amountCents, 5000);

  // Deve ter gerado crédito proporcional de taxa da plataforma na próxima competência aberta (5% de 200 = R$ 10,00 = -1000 cents)
  assert.ok(adjRes.json.platformAdjustment?.id);
  assert.equal(adjRes.json.platformAdjustment.type, 'PARTIAL_RETURN_CREDIT');
  assert.equal(adjRes.json.platformAdjustment.returnedBaseCents, 20000);
  assert.equal(adjRes.json.platformAdjustment.amountCents, -1000);

  // Saldo de vales do vendedor reflete o débito de R$ 50,00
  const advRes = await apiJson(baseUrl, `/api/advances/user/${fx.seller.id}`, {
    token: fx.adminToken,
  });
  assert.equal(advRes.status, 200);
  assert.equal(advRes.json.summary.totalOpenCents, 5000);
});

test('Etapa 24 - 3. Estorno parcial e cancelamento total de venda no Crediário', async () => {
  const baseUrl = await getBaseUrl;
  const fx = await setupFixture();

  const client = await prisma.client.create({
    data: {
      companyId: fx.company.id,
      name: `Cliente Crediario ${fx.uid}`,
      city: 'Curitiba',
      sequenceNumber: `F24C-${fx.uid}`,
      assignedSellerId: fx.seller.id,
      photographerId: fx.photographer.id,
      outcomeStatus: 'SOLD',
    },
  });
  createdClientIds.push(client.id);

  const sale = await prisma.sale.create({
    data: {
      companyId: fx.company.id,
      clientId: client.id,
      sellerId: fx.seller.id,
      value: 1000,
      city: 'Curitiba',
      paymentMethod: 'CREDIARIO',
      paymentStatus: 'PARTIALLY_PAID',
      status: 'PRONTO',
      fichaNumber: client.sequenceNumber,
      receiptUrl: '/uploads/receipt-cred.jpg',
    },
  });
  createdSaleIds.push(sale.id);

  const agr = await prisma.creditAgreement.create({
    data: {
      saleId: sale.id,
      clientId: client.id,
      sellerId: fx.seller.id,
      companyId: fx.company.id,
      buyerName: client.name,
      buyerCpf: '52998224725',
      street: 'Rua Teste',
      number: '100',
      neighborhood: 'Centro',
      city: 'Curitiba',
      state: 'PR',
      totalSaleCents: 100000,
      downPaymentCents: 20000,
      financedPrincipalCents: 80000,
      remainingPrincipalCents: 80000,
      installmentsCount: 4,
      firstDueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      initialCommissionRate: 0.25,
      installmentCommissionRate: 0.10,
      installments: {
        create: [1, 2, 3, 4].map((n) => ({
          installmentNumber: n,
          dueDate: new Date(Date.now() + n * 30 * 24 * 60 * 60 * 1000),
          amountCents: 20000,
          principalCents: 20000,
          status: 'PENDING',
        })),
      },
    },
  });

  // Desconto parcial de R$ 200,00 -> reduz última parcela para CANCELLED e remainingPrincipalCents para 60000
  const partCredRes = await apiJson(baseUrl, `/api/sales/${sale.id}/refund-or-cancel`, {
    method: 'POST',
    token: fx.adminToken,
    body: {
      type: 'PARTIAL_REFUND_DISCOUNT',
      amountCents: 20000,
      reason: 'Abatimento de 1 parcela por acordo',
    },
  });
  assert.equal(partCredRes.status, 201);
  assert.equal(partCredRes.json.commissionDebitCents, 0); // Abateu só parcela futura não paga

  const agrMid = await prisma.creditAgreement.findUnique({
    where: { id: agr.id },
    include: { installments: { orderBy: { installmentNumber: 'asc' } } },
  });
  assert.equal(agrMid?.remainingPrincipalCents, 60000);
  assert.equal(agrMid?.installments[3].status, 'CANCELLED');
  assert.equal(agrMid?.installments[0].status, 'PENDING');

  // Cancelamento total do restante (80000) -> cancela parcelas 1..3, acordo e debita apenas 25% da entrada (200 * 0.25 = R$ 50)
  const fullCredRes = await apiJson(baseUrl, `/api/sales/${sale.id}/refund-or-cancel`, {
    method: 'POST',
    token: fx.adminToken,
    body: {
      type: 'FULL_CANCELLATION',
      reason: 'Desistência total do crediário',
    },
  });
  assert.equal(fullCredRes.status, 201);
  assert.equal(fullCredRes.json.sale.saleStatus, 'CANCELLED');
  assert.equal(fullCredRes.json.commissionDebitCents, 5000);

  const agrFinal = await prisma.creditAgreement.findUnique({
    where: { id: agr.id },
    include: { installments: true },
  });
  assert.equal(agrFinal?.status, 'CANCELLED');
  assert.equal(agrFinal?.remainingPrincipalCents, 0);
  assert.equal(agrFinal?.remainingChargesCents, 0);
  assert.ok(agrFinal?.installments.every((i) => i.status === 'CANCELLED'));
});
