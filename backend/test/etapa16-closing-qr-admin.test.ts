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
import clientRoutes from '../src/routes/clients';
import {
  issueBuyerConfirmationLink,
  renderPublicBuyerConfirmationHtml,
} from '../src/services/buyerConfirmationService';

const jwtSecret = 'test_jwt_secret_for_etapa16_suite_987654';
process.env.JWT_SECRET = jwtSecret;

const app = express();
app.use(express.json());
app.use('/api/sales', salesRoutes);
app.use('/api/closing', closingRoutes);
app.use('/api/clients', clientRoutes);

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

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  if (createdSaleIds.length > 0) {
    await prisma.buyerPurchaseConfirmation.deleteMany({
      where: { saleId: { in: createdSaleIds } },
    });
    await prisma.batchCommissionAdjustment.deleteMany({
      where: { saleId: { in: createdSaleIds } },
    });
    await prisma.salePayment.deleteMany({
      where: { saleId: { in: createdSaleIds } },
    });
    await prisma.creditInstallment.deleteMany({
      where: { agreement: { saleId: { in: createdSaleIds } } },
    });
    await prisma.creditAgreement.deleteMany({
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

  if (createdBatchIds.length > 0) {
    await prisma.bookBatch.deleteMany({
      where: { id: { in: createdBatchIds } },
    });
  }

  if (createdCompanyIds.length > 0) {
    await prisma.operationalReviewAlert.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.operationalAuditEvent.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.dailyClosing.deleteMany({
      where: { seller: { companyId: { in: createdCompanyIds } } },
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

test('Etapa 16 — Fechamento Dia (-03:00), Divergências QR + Cards Vendedor + Estrelas + Reemissão e CRUD Admin Total', async (t) => {
  const baseUrl = await getBaseUrl;
  const suffix = randomUUID().slice(0, 8);
  const password = await bcrypt.hash('Senha123!', 10);

  const compA = await prisma.company.create({
    data: {
      id: `comp-a-e16-${suffix}`,
      name: `Lumora Test A ${suffix}`,
      tradeName: `Hyper Studio ${suffix}`,
    },
  });
  const compB = await prisma.company.create({
    data: {
      id: `comp-b-e16-${suffix}`,
      name: `Lumora Test B ${suffix}`,
    },
  });
  createdCompanyIds.push(compA.id, compB.id);

  const adminA = await prisma.user.create({
    data: {
      id: `admin-a-e16-${suffix}`,
      name: 'Admin A E16',
      cpf: `9100001${suffix.slice(0, 4)}`,
      password,
      role: 'ADMIN',
      companyId: compA.id,
      active: true,
      activeSessionId: `sess-admin-a-e16-${suffix}`,
    },
  });
  const adminB = await prisma.user.create({
    data: {
      id: `admin-b-e16-${suffix}`,
      name: 'Admin B E16',
      cpf: `9200002${suffix.slice(0, 4)}`,
      password,
      role: 'ADMIN',
      companyId: compB.id,
      active: true,
      activeSessionId: `sess-admin-b-e16-${suffix}`,
    },
  });
  const photogA = await prisma.user.create({
    data: {
      id: `phot-a-e16-${suffix}`,
      name: 'Fotografo A E16',
      cpf: `9300003${suffix.slice(0, 4)}`,
      password,
      role: 'PHOTOGRAPHER',
      companyId: compA.id,
      active: true,
      activeSessionId: `sess-phot-a-e16-${suffix}`,
    },
  });
  const seller1 = await prisma.user.create({
    data: {
      id: `sell-1-e16-${suffix}`,
      name: 'Carlos Vendedor E16',
      cpf: `9400004${suffix.slice(0, 4)}`,
      password,
      role: 'SELLER',
      companyId: compA.id,
      active: true,
      activeSessionId: `sess-sell-1-e16-${suffix}`,
    },
  });
  const seller2 = await prisma.user.create({
    data: {
      id: `sell-2-e16-${suffix}`,
      name: 'Beatriz Vendedora E16',
      cpf: `9500005${suffix.slice(0, 4)}`,
      password,
      role: 'SELLER',
      companyId: compA.id,
      active: true,
      activeSessionId: `sess-sell-2-e16-${suffix}`,
    },
  });
  createdUserIds.push(adminA.id, adminB.id, photogA.id, seller1.id, seller2.id);

  const tokenAdminA = makeToken(adminA as any);
  const tokenAdminB = makeToken(adminB as any);
  const tokenSeller1 = makeToken(seller1 as any);
  const tokenSeller2 = makeToken(seller2 as any);

  const batch1 = await prisma.bookBatch.create({
    data: {
      id: `batch-1-e16-${suffix}`,
      name: `Lote E16 Alpha ${suffix}`,
      photographerId: photogA.id,
      companyId: compA.id,
      status: 'DISTRIBUTED',
      city: 'Maringá',
    },
  });
  const batch2 = await prisma.bookBatch.create({
    data: {
      id: `batch-2-e16-${suffix}`,
      name: `Lote E16 Beta ${suffix}`,
      photographerId: photogA.id,
      companyId: compA.id,
      status: 'DISTRIBUTED',
      city: 'Londrina',
    },
  });
  createdBatchIds.push(batch1.id, batch2.id);

  await t.test('1. Divergências QR visíveis no Admin (com e sem lote), agrupamento por vendedor, avaliação 1–5 estrelas e reemissão QR', async () => {
    const cWithBatch = await prisma.client.create({
      data: {
        id: `cli-qr-b-${suffix}`,
        sequenceNumber: `Q1-${suffix}`,
        visibleCode: `FQ1-${suffix}`,
        name: 'Cliente Lote QR',
        phone1: '(44) 99999-1111',
        city: 'Maringá',
        companyId: compA.id,
        batchId: batch1.id,
        assignedSellerId: seller1.id,
        bookStatus: 'SOLD',
        outcomeStatus: 'SOLD',
      },
    });
    const cNoBatch = await prisma.client.create({
      data: {
        id: `cli-qr-nb-${suffix}`,
        sequenceNumber: `Q2-${suffix}`,
        visibleCode: `FQ2-${suffix}`,
        name: 'Cliente Sem Lote QR',
        phone1: '(44) 99999-2222',
        city: 'Maringá',
        companyId: compA.id,
        batchId: null,
        assignedSellerId: seller1.id,
        bookStatus: 'SOLD',
        outcomeStatus: 'SOLD',
      },
    });
    const cPendingS2 = await prisma.client.create({
      data: {
        id: `cli-qr-s2-${suffix}`,
        sequenceNumber: `Q3-${suffix}`,
        visibleCode: `FQ3-${suffix}`,
        name: 'Cliente Pendente QR',
        phone1: '(43) 99999-3333',
        city: 'Londrina',
        companyId: compA.id,
        batchId: batch2.id,
        assignedSellerId: seller2.id,
        bookStatus: 'SOLD',
        outcomeStatus: 'SOLD',
      },
    });
    createdClientIds.push(cWithBatch.id, cNoBatch.id, cPendingS2.id);

    const sale1 = await prisma.sale.create({
      data: {
        id: `sale-qr-1-${suffix}`,
        clientId: cWithBatch.id,
        sellerId: seller1.id,
        companyId: compA.id,
        value: 1200,
        paymentMethod: 'PIX',
        city: 'Maringá',
        product: 'Álbum Premium',
        receiptUrl: `/uploads/qr1-${suffix}.jpg`,
        status: 'PRONTO',
        paymentStatus: 'PAID',
      },
    });
    const sale2 = await prisma.sale.create({
      data: {
        id: `sale-qr-2-${suffix}`,
        clientId: cNoBatch.id,
        sellerId: seller1.id,
        companyId: compA.id,
        value: 950,
        paymentMethod: 'CASH',
        city: 'Maringá',
        product: 'Book Digital',
        receiptUrl: `/uploads/qr2-${suffix}.jpg`,
        status: 'PRONTO',
        paymentStatus: 'PAID',
      },
    });
    const sale3 = await prisma.sale.create({
      data: {
        id: `sale-qr-3-${suffix}`,
        clientId: cPendingS2.id,
        sellerId: seller2.id,
        companyId: compA.id,
        value: 800,
        paymentMethod: 'PIX',
        city: 'Londrina',
        product: 'Álbum',
        receiptUrl: `/uploads/qr3-${suffix}.jpg`,
        status: 'PRONTO',
        paymentStatus: 'PAID',
      },
    });
    createdSaleIds.push(sale1.id, sale2.id, sale3.id);

    const issued1 = await issueBuyerConfirmationLink({ saleId: sale1.id, companyId: compA.id });
    const issued2 = await issueBuyerConfirmationLink({ saleId: sale2.id, companyId: compA.id });
    await issueBuyerConfirmationLink({ saleId: sale3.id, companyId: compA.id });

    // Verifica que HTML pública possui estrelas 1..5
    const html = renderPublicBuyerConfirmationHtml({
      token: issued1.rawToken!,
      prompt: {
        companyName: compA.tradeName,
        fichaCode: cWithBatch.visibleCode,
        buyerFirstName: 'Cliente',
        city: 'Maringá',
        product: 'Álbum Premium',
        conditionsVersion: 1,
        requiresIdentityCheck: true,
        isCreditAgreement: false,
      },
    });
    assert.ok(html.includes('id="starsBox"'));
    assert.ok(html.includes('name="serviceRating"'));

    // Rejeita avaliação inválida (6 estrelas)
    const badRating = await apiJson(baseUrl, `/api/sales/public/confirm/${issued1.rawToken}`, {
      method: 'POST',
      body: {
        phoneLast4: '1111',
        reportedTotalValue: 800,
        reportedPaidValue: 800,
        reportedPaymentMethod: 'PIX',
        serviceRating: 6,
      },
    });
    assert.equal(badRating.status, 400);
    assert.equal(badRating.json.code, 'INVALID_SERVICE_RATING');

    // Comprador 1 confirma valor divergente (1200 -> 800) + 4 estrelas
    const confirm1 = await apiJson(baseUrl, `/api/sales/public/confirm/${issued1.rawToken}`, {
      method: 'POST',
      body: {
        phoneLast4: '1111',
        reportedTotalValue: 800,
        reportedPaidValue: 800,
        reportedPaymentMethod: 'PIX',
        serviceRating: 4,
      },
    });
    assert.equal(confirm1.status, 200);
    assert.equal(confirm1.json.serviceRating, 4);

    // Comprador 2 (SEM BookBatch) confirma valor divergente (950 -> 700) + 5 estrelas
    const confirm2 = await apiJson(baseUrl, `/api/sales/public/confirm/${issued2.rawToken}`, {
      method: 'POST',
      body: {
        phoneLast4: '2222',
        reportedTotalValue: 700,
        reportedPaidValue: 700,
        reportedPaymentMethod: 'CASH',
        serviceRating: 5,
      },
    });
    assert.equal(confirm2.status, 200);
    assert.equal(confirm2.json.serviceRating, 5);

    // Mesmo se issueBuyerConfirmationLink for acionado novamente na sale1, NÃO pode sobrescrever nem ocultar UNDER_REVIEW
    const duplicateAttempt = await issueBuyerConfirmationLink({ saleId: sale1.id, companyId: compA.id });
    assert.equal((duplicateAttempt as any).alreadyResponded, true);

    // Listagem Admin agrupada por vendedor (Cards por Vendedor) com filtro Divergências
    const reviewDiv = await apiJson(
      baseUrl,
      '/api/sales/buyer-confirmations/review?groupBy=seller&hasDivergence=true',
      { token: tokenAdminA }
    );
    assert.equal(reviewDiv.status, 200);
    assert.equal(reviewDiv.json.total, 2);
    assert.equal(reviewDiv.json.sellerGroups.length, 1);

    const cardSeller1 = reviewDiv.json.sellerGroups[0];
    assert.equal(cardSeller1.seller.sellerId, seller1.id);
    assert.equal(cardSeller1.seller.divergentCount, 2);
    assert.equal(cardSeller1.seller.averageRating, 4.5);
    assert.equal(cardSeller1.seller.ratedCount, 2);
    const saleIdsInCard = cardSeller1.confirmations.map((c: any) => c.saleId);
    assert.ok(saleIdsInCard.includes(sale1.id), 'Venda com lote deve aparecer na divergência');
    assert.ok(saleIdsInCard.includes(sale2.id), 'Venda sem lote deve aparecer na divergência');

    // Visão segura do vendedor indica hasServiceRating sem vazar valores nem nota
    const sellerSafe = await apiJson(baseUrl, `/api/sales/${sale1.id}/buyer-confirmation`, {
      token: tokenSeller1,
    });
    assert.equal(sellerSafe.status, 200);
    assert.equal(sellerSafe.json.hasServiceRating, true);
    assert.equal(sellerSafe.json.hasDivergence, undefined);

    // Reemissão de QR pelo vendedor 2 em venda ainda pendente gera novo link ativo
    const reissueS2 = await apiJson(
      baseUrl,
      `/api/sales/${sale3.id}/buyer-confirmation/reissue`,
      { method: 'POST', token: tokenSeller2 }
    );
    assert.equal(reissueS2.status, 200);
    assert.equal(reissueS2.json.alreadyResponded, false);
    assert.ok(reissueS2.json.confirmationUrl);

    // Reemissão em venda já respondida preserva resposta do comprador
    const reissueS1 = await apiJson(
      baseUrl,
      `/api/sales/${sale1.id}/buyer-confirmation/reissue`,
      { method: 'POST', token: tokenSeller1 }
    );
    assert.equal(reissueS1.status, 200);
    assert.equal(reissueS1.json.alreadyResponded, true);
  });

  await t.test('2. Fechamento Dia contabiliza 2 vendas e 2 não-vendas no mesmo dia operacional (-03:00)', async () => {
    const sellerDay = await prisma.user.create({
      data: {
        id: `sell-day-e16-${suffix}`,
        name: 'Vendedor Fechamento Dia',
        cpf: `9600006${suffix.slice(0, 4)}`,
        password,
        role: 'SELLER',
        companyId: compA.id,
        active: true,
        activeSessionId: `sess-sell-day-e16-${suffix}`,
      },
    });
    createdUserIds.push(sellerDay.id);
    const tokenSellerDay = makeToken(sellerDay as any);

    const clientsDay = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((idx) =>
        prisma.client.create({
          data: {
            id: `cli-day-${idx}-e16-${suffix}`,
            sequenceNumber: `D${idx}-${suffix}`,
            name: `Cliente Dia ${idx}`,
            city: 'Curitiba',
            companyId: compA.id,
            assignedSellerId: sellerDay.id,
            bookStatus: idx <= 2 ? 'SOLD' : 'AWAITING_RETURN',
            outcomeStatus: idx <= 2 ? 'SOLD' : 'NON_SALE',
          },
        })
      )
    );
    clientsDay.forEach((c) => createdClientIds.push(c.id));

    // Mesmo dia operacional BRT (2026-11-16): 1 venda + 1 não-venda às 14:00 -03:00 e 1 venda + 1 não-venda às 22:15 -03:00 (01:15 UTC do dia 17!)
    const sDay1 = await prisma.sale.create({
      data: {
        id: `sale-day-1-${suffix}`,
        clientId: clientsDay[0].id,
        sellerId: sellerDay.id,
        companyId: compA.id,
        value: 500,
        paymentMethod: 'PIX',
        city: 'Curitiba',
        receiptUrl: `/uploads/d1-${suffix}.jpg`,
        date: new Date('2026-11-16T14:00:00.000-03:00'),
      },
    });
    const sDay2 = await prisma.sale.create({
      data: {
        id: `sale-day-2-${suffix}`,
        clientId: clientsDay[1].id,
        sellerId: sellerDay.id,
        companyId: compA.id,
        value: 700,
        paymentMethod: 'CASH',
        city: 'Curitiba',
        receiptUrl: `/uploads/d2-${suffix}.jpg`,
        date: new Date('2026-11-16T22:15:00.000-03:00'),
      },
    });
    // Venda de outro dia operacional (dia 15 às 23:40 -03:00 = 02:40 UTC de 16!) NÃO pode entrar no dia 16
    const sOtherDay = await prisma.sale.create({
      data: {
        id: `sale-day-prev-${suffix}`,
        clientId: clientsDay[4].id,
        sellerId: sellerDay.id,
        companyId: compA.id,
        value: 999,
        paymentMethod: 'CASH',
        city: 'Curitiba',
        receiptUrl: `/uploads/dprev-${suffix}.jpg`,
        date: new Date('2026-11-15T23:40:00.000-03:00'),
      },
    });
    createdSaleIds.push(sDay1.id, sDay2.id, sOtherDay.id);

    await prisma.nonSale.create({
      data: {
        clientId: clientsDay[2].id,
        sellerId: sellerDay.id,
        companyId: compA.id,
        reason: 'Sem interesse',
        signatureUrl: 'data:image/png;base64,abc',
        date: new Date('2026-11-16T15:30:00.000-03:00'),
      },
    });
    await prisma.nonSale.create({
      data: {
        clientId: clientsDay[3].id,
        sellerId: sellerDay.id,
        companyId: compA.id,
        reason: 'Sem condições',
        signatureUrl: 'data:image/png;base64,def',
        date: new Date('2026-11-16T23:10:00.000-03:00'),
      },
    });
    // Não-venda do dia 17 às 00:10 -03:00 não pode entrar no dia 16
    await prisma.nonSale.create({
      data: {
        clientId: clientsDay[5].id,
        sellerId: sellerDay.id,
        companyId: compA.id,
        reason: 'Outro dia',
        signatureUrl: 'data:image/png;base64,ghi',
        date: new Date('2026-11-17T00:10:00.000-03:00'),
      },
    });

    const dailyRes = await apiJson(
      baseUrl,
      `/api/closing/daily/${sellerDay.id}?date=2026-11-16`,
      { token: tokenSellerDay }
    );
    assert.equal(dailyRes.status, 200);
    assert.equal(dailyRes.json.salesCount, 2, 'Deve contabilizar exatamente 2 vendas no dia -03:00');
    assert.equal(dailyRes.json.nonSalesCount, 2, 'Deve contabilizar exatamente 2 não-vendas no dia -03:00');
    assert.equal(dailyRes.json.totalFichas, 4);
    assert.equal(dailyRes.json.totalSalesValue, 1200);
  });

  await t.test('3. Admin possui permissão total para editar, mover e excluir qualquer ficha da própria empresa com auditoria', async () => {
    const cFull = await prisma.client.create({
      data: {
        id: `cli-full-del-${suffix}`,
        sequenceNumber: `DEL-${suffix}`,
        visibleCode: `FDEL-${suffix}`,
        name: 'Cliente Completo Excluir',
        city: 'Maringá',
        companyId: compA.id,
        batchId: batch1.id,
        assignedSellerId: seller1.id,
        bookStatus: 'SOLD',
        outcomeStatus: 'SOLD',
      },
    });
    createdClientIds.push(cFull.id);

    const sFull = await prisma.sale.create({
      data: {
        id: `sale-full-del-${suffix}`,
        clientId: cFull.id,
        sellerId: seller1.id,
        companyId: compA.id,
        value: 1000,
        paymentMethod: 'CREDIARIO',
        city: 'Maringá',
        receiptUrl: `/uploads/del-${suffix}.jpg`,
      },
    });
    createdSaleIds.push(sFull.id);

    await prisma.salePayment.create({
      data: {
        saleId: sFull.id,
        method: 'CASH',
        amount: 200,
      },
    });

    const ca = await prisma.creditAgreement.create({
      data: {
        saleId: sFull.id,
        clientId: cFull.id,
        sellerId: seller1.id,
        companyId: compA.id,
        buyerName: 'Cliente Completo Excluir',
        buyerCpf: '12345678909',
        street: 'Rua Teste',
        number: '10',
        neighborhood: 'Centro',
        city: 'Maringá',
        state: 'PR',
        product: 'Álbum',
        totalSaleCents: 100000,
        downPaymentCents: 20000,
        financedPrincipalCents: 80000,
        remainingPrincipalCents: 80000,
        installmentsCount: 4,
        periodicity: 'MONTHLY',
        firstDueDate: new Date(),
      },
    });
    await prisma.creditInstallment.create({
      data: {
        agreementId: ca.id,
        installmentNumber: 1,
        dueDate: new Date(),
        amountCents: 20000,
      },
    });

    // Admin A move ficha finalizada (SOLD) para outro lote mantendo integridade
    const moveFinal = await apiJson(baseUrl, `/api/clients/${cFull.id}/move`, {
      method: 'POST',
      token: tokenAdminA,
      body: { targetBatchId: batch2.id, reason: 'Correção administrativa de lote' },
    });
    assert.equal(moveFinal.status, 200);
    assert.equal(moveFinal.json.client.batchId, batch2.id);
    assert.equal(moveFinal.json.client.bookStatus, 'SOLD');

    // Cross-tenant continua bloqueado com 404
    const crossDel = await apiJson(baseUrl, `/api/clients/${cFull.id}`, {
      method: 'DELETE',
      token: tokenAdminB,
      body: { reason: 'Tentativa inválida' },
    });
    assert.equal(crossDel.status, 404);

    // Admin A exclui definitivamente ficha vendida/com crediário da própria empresa
    const delFull = await apiJson(baseUrl, `/api/clients/${cFull.id}`, {
      method: 'DELETE',
      token: tokenAdminA,
      body: { reason: 'Exclusão definitiva confirmada pelo Admin' },
    });
    assert.equal(delFull.status, 200);
    assert.equal(delFull.json.deleted, true);

    const clientAfter = await prisma.client.findUnique({ where: { id: cFull.id } });
    assert.equal(clientAfter, null);

    const deleteAudit = await prisma.operationalAuditEvent.findFirst({
      where: {
        companyId: compA.id,
        entityId: cFull.id,
        action: 'ADMIN_CLIENT_DELETED',
      },
    });
    assert.ok(deleteAudit, 'Auditoria da exclusão definitiva deve existir');
  });
});
