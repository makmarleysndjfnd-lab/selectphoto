import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { app } from '../src/index';
import { prisma, disconnectPrisma } from '../src/services/prisma';

const server = http.createServer(app);
const getBaseUrl = new Promise<string>((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    const addr = server.address() as any;
    resolve(`http://127.0.0.1:${addr.port}`);
  });
});

const createdCompanyIds: string[] = [];
const createdUserIds: string[] = [];
const createdBatchIds: string[] = [];
const createdClientIds: string[] = [];
const createdSaleIds: string[] = [];

function signUserToken(user: {
  id: string;
  role: string;
  companyId: string | null;
  name: string;
}) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      companyId: user.companyId,
      name: user.name,
    },
    process.env.JWT_SECRET!,
    { expiresIn: '2h' }
  );
}

async function apiJson(
  baseUrl: string,
  urlPath: string,
  options: { method?: string; token?: string; body?: any } = {}
) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
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

  for (const cid of createdCompanyIds) {
    const logoDir = path.resolve(__dirname, '../uploads', cid);
    await fs.promises.rm(logoDir, { recursive: true, force: true }).catch(() => {});
  }

  if (createdSaleIds.length > 0) {
    await prisma.buyerPurchaseConfirmation.deleteMany({
      where: { saleId: { in: createdSaleIds } },
    });
    await prisma.saleAdjustment.deleteMany({
      where: { saleId: { in: createdSaleIds } },
    });
    await prisma.creditCommission.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.creditPaymentAllocation.deleteMany({
      where: { payment: { agreement: { saleId: { in: createdSaleIds } } } },
    });
    await prisma.creditPayment.deleteMany({
      where: { agreement: { saleId: { in: createdSaleIds } } },
    });
    await prisma.creditInstallment.deleteMany({
      where: { agreement: { saleId: { in: createdSaleIds } } },
    });
    await prisma.creditAgreement.deleteMany({
      where: { saleId: { in: createdSaleIds } },
    });
    await prisma.salePayment.deleteMany({
      where: { saleId: { in: createdSaleIds } },
    });
    await prisma.sale.deleteMany({
      where: { id: { in: createdSaleIds } },
    });
  }

  if (createdCompanyIds.length > 0) {
    await prisma.dailyClosing.deleteMany({
      where: { sellerId: { in: createdUserIds } },
    });
    await prisma.nonSale.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.operationalReviewAlert.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.operationalAuditEvent.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.companyOperationalConfig.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
  }

  if (createdClientIds.length > 0) {
    await prisma.clientTimeline.deleteMany({
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

test('Etapa 32: Regras Gerais (Fotógrafo, Exceções por Vendedor, Preço/Desconto, Crediário, Lotes, WhatsApp e Logo B2)', async () => {
  const baseUrl = await getBaseUrl;
  const suffix = randomUUID().slice(0, 8);
  const passwordHash = await bcrypt.hash('Lumora32Test!', 6);

  const companyA = await prisma.company.create({
    data: {
      name: `Empresa Alpha E32 ${suffix}`,
      tradeName: 'Alpha E32 Foto',
      companyPixKey: 'pix.alpha32@lumora.com.br',
      companyPixKeyType: 'EMAIL',
      status: 'ACTIVE',
      isActive: true,
    },
  });
  createdCompanyIds.push(companyA.id);

  const companyB = await prisma.company.create({
    data: {
      name: `Empresa Beta E32 ${suffix}`,
      tradeName: 'Beta E32 Foto',
      status: 'ACTIVE',
      isActive: true,
    },
  });
  createdCompanyIds.push(companyB.id);

  const superAdmin = await prisma.user.create({
    data: {
      name: 'SuperAdmin E32',
      email: `sa.e32.${suffix}@lumora.test`,
      password: passwordHash,
      role: 'SUPER_ADMIN',
      companyId: null,
    },
  });
  createdUserIds.push(superAdmin.id);

  const adminA = await prisma.user.create({
    data: {
      name: 'Admin Alpha E32',
      email: `admin.a.e32.${suffix}@lumora.test`,
      password: passwordHash,
      role: 'ADMIN',
      companyId: companyA.id,
    },
  });
  createdUserIds.push(adminA.id);

  const sellerA1 = await prisma.user.create({
    data: {
      name: 'Vendedor 1 E32',
      email: `seller1.e32.${suffix}@lumora.test`,
      password: passwordHash,
      role: 'SELLER',
      companyId: companyA.id,
    },
  });
  createdUserIds.push(sellerA1.id);

  const sellerA2 = await prisma.user.create({
    data: {
      name: 'Vendedor 2 E32',
      email: `seller2.e32.${suffix}@lumora.test`,
      password: passwordHash,
      role: 'SELLER',
      companyId: companyA.id,
    },
  });
  createdUserIds.push(sellerA2.id);

  const photoA = await prisma.user.create({
    data: {
      name: 'Fotógrafo Alpha E32',
      email: `photo.a.e32.${suffix}@lumora.test`,
      password: passwordHash,
      role: 'PHOTOGRAPHER',
      companyId: companyA.id,
    },
  });
  createdUserIds.push(photoA.id);

  const adminB = await prisma.user.create({
    data: {
      name: 'Admin Beta E32',
      email: `admin.b.e32.${suffix}@lumora.test`,
      password: passwordHash,
      role: 'ADMIN',
      companyId: companyB.id,
    },
  });
  createdUserIds.push(adminB.id);

  const saToken = signUserToken(superAdmin);
  const adminAToken = signUserToken(adminA);
  const sellerA1Token = signUserToken(sellerA1);
  const sellerA2Token = signUserToken(sellerA2);
  const photoAToken = signUserToken(photoA);
  const adminBToken = signUserToken(adminB);

  // =========================================================================
  // 1. RBAC 403 E MULTI-TENANT NAS EXCEÇÕES E CONFIGURAÇÕES
  // =========================================================================
  for (const deniedToken of [sellerA1Token, photoAToken]) {
    const rOverrides = await apiJson(baseUrl, '/api/company/operational-config/seller-overrides', {
      token: deniedToken,
    });
    assert.equal(rOverrides.status, 403);

    const rPutOverride = await apiJson(
      baseUrl,
      `/api/company/operational-config/seller-overrides/${sellerA1.id}`,
      {
        method: 'PUT',
        token: deniedToken,
        body: { customVirginCommissionPercent: 40 },
      }
    );
    assert.equal(rPutOverride.status, 403);
  }

  // Cross-tenant: Admin B tentando mexer no vendedor da Empresa A
  const crossOverride = await apiJson(
    baseUrl,
    `/api/company/operational-config/seller-overrides/${sellerA1.id}`,
    {
      method: 'PUT',
      token: adminBToken,
      body: { customVirginCommissionPercent: 40 },
    }
  );
  assert.equal(crossOverride.status, 403);

  // =========================================================================
  // 2. CONFIGURAÇÃO GERAL SINCRONIZADA ADMIN <-> SUPERADMIN + MODELOS WHATSAPP
  // =========================================================================
  const configPayload = {
    virginBookCommissionPercent: 30,
    reboloBookCommissionPercent: 15,
    creditInstallmentCommissionPercent: 12,
    photographerCommissionType: 'PERCENT_OF_SALE',
    photographerCommissionValue: 5,
    defaultBookPriceCents: 30000, // R$ 300,00
    maxSellerDiscountPercent: 15, // mínimo R$ 255,00 sem alerta/bloqueio
    discountPolicyMode: 'SILENT_AUDIT_ALERT',
    creditMinDownPaymentPercent: 30,
    creditMaxInstallments: 4,
    creditLateInterestMonthlyPercent: 3,
    creditLateFinePercent: 5,
    creditDaysToCollectionQueue: 5,
    creditDaysToSerasaEligible: 10,
    maxBatchReturnDays: 10,
    maxSimultaneousBooksPerSeller: 2,
    whatsappCreditCollectionTemplate:
      'Cobrança {empresa}: Olá {cliente}, sua parcela de {valor} venceu em {vencimento}. Pix: {pix}.',
    whatsappAdvanceNoticeTemplate:
      'Vale {empresa}: {cliente}, saldo em aberto {valor} ref. {vencimento}. Pix: {pix}.',
    whatsappPostSaleTemplate:
      'Obrigado {cliente}! Compra de {valor} registrada na {empresa}.',
  };

  const saveBySa = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${companyA.id}/operational-config`,
    {
      method: 'PUT',
      token: saToken,
      body: configPayload,
    }
  );
  assert.equal(saveBySa.status, 200);
  assert.equal(saveBySa.json.defaultBookPriceCents, 30000);
  assert.equal(saveBySa.json.creditMaxInstallments, 4);
  assert.equal(saveBySa.json.maxBatchReturnDays, 10);
  assert.equal(saveBySa.json.maxSimultaneousBooksPerSeller, 2);

  // Admin lê exatamente os mesmos valores
  const adminRead = await apiJson(baseUrl, '/api/company/operational-config', {
    token: adminAToken,
  });
  assert.equal(adminRead.status, 200);
  assert.equal(adminRead.json.photographerCommissionType, 'PERCENT_OF_SALE');
  assert.equal(adminRead.json.photographerCommissionValue, 5);
  assert.equal(adminRead.json.creditDaysToSerasaEligible, 10);

  // Seller lê endpoint seguro de templates WhatsApp (sem vazar comissões)
  const sellerWaTpl = await apiJson(baseUrl, '/api/company/whatsapp-templates', {
    token: sellerA1Token,
  });
  assert.equal(sellerWaTpl.status, 200);
  assert.equal(sellerWaTpl.json.companyDisplayName, 'Alpha E32 Foto');
  assert.equal(sellerWaTpl.json.virginBookCommissionPercent, undefined);
  assert.ok(sellerWaTpl.json.whatsappPostSaleTemplate.includes('{cliente}'));

  // Prévia de renderização dos 3 modelos WhatsApp
  const prevCredit = await apiJson(baseUrl, '/api/company/operational-config/whatsapp-preview', {
    method: 'POST',
    token: adminAToken,
    body: {
      kind: 'CREDIT_COLLECTION',
      cliente: 'Maria',
      valor: 'R$ 150,00',
      vencimento: '10/11/2026',
      pix: 'pix.alpha32@lumora.com.br',
      empresa: 'Alpha E32 Foto',
    },
  });
  assert.equal(prevCredit.status, 200);
  assert.equal(
    prevCredit.json.rendered,
    'Cobrança Alpha E32 Foto: Olá Maria, sua parcela de R$ 150,00 venceu em 10/11/2026. Pix: pix.alpha32@lumora.com.br.'
  );

  // =========================================================================
  // 3. LOGO SUPERADMIN EM PASTA DA EMPRESA (B2 / FALLBACK TESTE SEM "global")
  // =========================================================================
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const saLogoForm = new FormData();
  saLogoForm.append('logo', new Blob([pngBytes], { type: 'image/png' }), 'logo-sa.png');
  const saLogoRes = await fetch(
    `${baseUrl}/api/superadmin/companies/${companyA.id}/operational-config/logo`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${saToken}` },
      body: saLogoForm,
    }
  );
  assert.equal(saLogoRes.status, 200);
  const saLogoJson = (await saLogoRes.json()) as any;
  assert.equal(saLogoJson.storageProvider, 'LOCAL_TEST_FALLBACK');
  assert.ok(String(saLogoJson.logoUrl).includes(`/api/company/public/logo/${companyA.id}/`));
  assert.ok(!String(saLogoJson.logoUrl).includes('/global/'));

  const publicLogoFetch = await fetch(`${baseUrl}${saLogoJson.logoUrl}`);
  assert.equal(publicLogoFetch.status, 200);

  // =========================================================================
  // 4. LOTES ATRASADOS (> maxBatchReturnDays) & LIMITE SIMULTÂNEO POR VENDEDOR
  // =========================================================================
  const oldDate = new Date(Date.now() - 15 * 24 * 3600 * 1000);
  const oldBatch = await prisma.bookBatch.create({
    data: {
      name: `Lote Antigo E32 ${suffix}`,
      city: 'Goiânia',
      totalProduced: 6,
      companyId: companyA.id,
      photographerId: photoA.id,
      status: 'IN_STOCK',
      date: oldDate,
    },
  });
  createdBatchIds.push(oldBatch.id);

  const createClient = async (opts: {
    code: string;
    bookStatus: string;
    sellerId?: string | null;
    batchId?: string;
    outcomeStatus?: string;
  }) => {
    const c = await prisma.client.create({
      data: {
        name: `Cliente ${opts.code} ${suffix}`,
        city: 'Goiânia',
        street: 'Rua 1',
        number: '10',
        neighborhood: 'Centro',
        phone1: '62999990000',
        companyId: companyA.id,
        photographerId: photoA.id,
        assignedSellerId: opts.sellerId ?? null,
        batchId: opts.batchId ?? oldBatch.id,
        bookStatus: opts.bookStatus,
        outcomeStatus: opts.outcomeStatus ?? 'PENDING',
        visibleCode: opts.code,
        sequenceNumber: opts.code,
      },
    });
    createdClientIds.push(c.id);
    return c;
  };

  const cStock1 = await createClient({ code: `S1-${suffix}`, bookStatus: 'IN_STOCK' });
  const cStock2 = await createClient({ code: `S2-${suffix}`, bookStatus: 'IN_STOCK' });
  const cStock3 = await createClient({ code: `S3-${suffix}`, bookStatus: 'IN_STOCK' });
  const cAwaitRet = await createClient({
    code: `AR-${suffix}`,
    bookStatus: 'AWAITING_RETURN',
    sellerId: sellerA2.id,
    outcomeStatus: 'NON_SALE',
  });
  await prisma.nonSale.create({
    data: {
      reason: 'Sem interesse no momento',
      date: oldDate,
      sellerId: sellerA2.id,
      clientId: cAwaitRet.id,
      companyId: companyA.id,
    },
  });

  // Batch aging check
  const batchesRes = await apiJson(baseUrl, '/api/books/batch', { token: adminAToken });
  assert.equal(batchesRes.status, 200);
  const foundOldBatch = (batchesRes.json as any[]).find((b) => b.id === oldBatch.id);
  assert.ok(foundOldBatch);
  assert.equal(foundOldBatch.maxBatchReturnDays, 10);
  assert.equal(foundOldBatch.isOverdueReturn, true);
  assert.ok(foundOldBatch.daysOpen >= 14);

  const pendingReturnsRes = await apiJson(baseUrl, '/api/books/pending-returns', { token: adminAToken });
  assert.equal(pendingReturnsRes.status, 200);
  assert.equal(pendingReturnsRes.json.maxBatchReturnDays, 10);
  const retGroup = pendingReturnsRes.json.groups.find((g: any) => g.batchId === oldBatch.id);
  assert.ok(retGroup);
  assert.equal(retGroup.isOverdueReturn, true);

  // Limite simultâneo = 2 para sellerA2
  const assign1 = await apiJson(baseUrl, '/api/clients/assign-seller', {
    method: 'POST',
    token: adminAToken,
    body: { clientId: cStock1.id, sellerId: sellerA2.id },
  });
  assert.equal(assign1.status, 200);

  const assign2 = await apiJson(baseUrl, '/api/clients/assign-seller', {
    method: 'POST',
    token: adminAToken,
    body: { clientId: cStock2.id, sellerId: sellerA2.id },
  });
  assert.equal(assign2.status, 200);

  // 3º book simultâneo deve ser bloqueado (HTTP 400 MAX_SIMULTANEOUS_BOOKS_EXCEEDED)
  const assign3 = await apiJson(baseUrl, '/api/clients/assign-seller', {
    method: 'POST',
    token: adminAToken,
    body: { clientId: cStock3.id, sellerId: sellerA2.id },
  });
  assert.equal(assign3.status, 400);
  assert.equal(assign3.json.code, 'MAX_SIMULTANEOUS_BOOKS_EXCEEDED');

  // =========================================================================
  // 5. EXCEÇÃO INDIVIDUAL DE COMISSÃO + POLÍTICA DE DESCONTO SILENCIOSA vs BLOQUEIO
  // =========================================================================
  const cA1 = await createClient({ code: `A1-${suffix}`, bookStatus: 'DISTRIBUTED', sellerId: sellerA1.id });
  const cA2 = await createClient({ code: `A2-${suffix}`, bookStatus: 'DISTRIBUTED', sellerId: sellerA1.id });
  const cA3 = await createClient({ code: `A3-${suffix}`, bookStatus: 'DISTRIBUTED_REBOLO', sellerId: sellerA1.id });
  const cA4 = await createClient({ code: `A4-${suffix}`, bookStatus: 'DISTRIBUTED', sellerId: sellerA1.id });

  // Venda #1 antes da exceção: valor R$ 200 (< 255 = 33.3% desc) em modo SILENT_AUDIT_ALERT
  // Deve concluir normalmente (201), gravar appliedCommissionPercent = 30 e priceDivergenceAlert = true!
  const sale1Res = await apiJson(baseUrl, '/api/sales', {
    method: 'POST',
    token: sellerA1Token,
    body: {
      clientId: cA1.id,
      city: 'Goiânia',
      value: 200,
      paymentMethod: 'PIX',
      receiptUrl: '/uploads/s1.jpg',
    },
  });
  assert.equal(sale1Res.status, 201);
  createdSaleIds.push(sale1Res.json.id);
  assert.equal(sale1Res.json.appliedCommissionPercent, 30);
  assert.equal(sale1Res.json.priceDivergenceAlert, true);
  assert.ok(String(sale1Res.json.priceDivergenceDetail).includes('33.3%'));

  // Conferir visibilidade do alerta para o Admin no fechamento e trilha OperationalAuditEvent
  const todayBr = new Date(Date.now() - 3 * 3600 * 1000).toISOString().split('T')[0];
  const closingBefore = await apiJson(baseUrl, `/api/closing/daily/${sellerA1.id}?date=${todayBr}`, {
    token: adminAToken,
  });
  assert.equal(closingBefore.status, 200);
  const sale1InClosing = closingBefore.json.sales.find((s: any) => s.id === sale1Res.json.id);
  assert.ok(sale1InClosing);
  assert.equal(sale1InClosing.priceDivergenceAlert, true);

  const divAudit = await prisma.operationalAuditEvent.findFirst({
    where: { companyId: companyA.id, entityId: sale1Res.json.id, action: 'SALE_PRICE_DIVERGENCE_ALERT' },
  });
  assert.ok(divAudit);

  // Definir exceção individual apenas para Seller A1: Virgem 35%, Rebolo 22%, Crediário 14%
  const overrideRes = await apiJson(
    baseUrl,
    `/api/company/operational-config/seller-overrides/${sellerA1.id}`,
    {
      method: 'PUT',
      token: adminAToken,
      body: {
        customVirginCommissionPercent: 35,
        customReboloCommissionPercent: 22,
        customCreditInstallmentCommissionPercent: 14,
      },
    }
  );
  assert.equal(overrideRes.status, 200);
  assert.equal(overrideRes.json.effectiveVirginCommissionPercent, 35);

  // Mudar política de desconto para HARD_BLOCK
  const switchHardBlock = await apiJson(baseUrl, '/api/company/operational-config', {
    method: 'PUT',
    token: adminAToken,
    body: { discountPolicyMode: 'HARD_BLOCK' },
  });
  assert.equal(switchHardBlock.status, 200);

  // Tentar vender cA2 por R$ 200 (desc > 15%) -> deve bloquear com HTTP 400 DISCOUNT_LIMIT_EXCEEDED
  const blockedDiscount = await apiJson(baseUrl, '/api/sales', {
    method: 'POST',
    token: sellerA1Token,
    body: {
      clientId: cA2.id,
      city: 'Goiânia',
      value: 200,
      paymentMethod: 'PIX',
      receiptUrl: '/uploads/s2-fail.jpg',
    },
  });
  assert.equal(blockedDiscount.status, 400);
  assert.equal(blockedDiscount.json.code, 'DISCOUNT_LIMIT_EXCEEDED');

  // Vender cA2 por R$ 280 (desc 6.7% <= 15%) -> sucesso, snapshot = 35% (exceção do vendedor)
  const sale2Res = await apiJson(baseUrl, '/api/sales', {
    method: 'POST',
    token: sellerA1Token,
    body: {
      clientId: cA2.id,
      city: 'Goiânia',
      value: 280,
      paymentMethod: 'PIX',
      receiptUrl: '/uploads/s2.jpg',
    },
  });
  assert.equal(sale2Res.status, 201);
  createdSaleIds.push(sale2Res.json.id);
  assert.equal(sale2Res.json.appliedCommissionPercent, 35);
  assert.equal(sale2Res.json.priceDivergenceAlert, false);

  // Venda #3 Rebolo de Seller A1 -> snapshot = 22%
  const sale3Res = await apiJson(baseUrl, '/api/sales', {
    method: 'POST',
    token: sellerA1Token,
    body: {
      clientId: cA3.id,
      city: 'Goiânia',
      value: 300,
      paymentMethod: 'CASH',
      receiptUrl: '/uploads/s3.jpg',
    },
  });
  assert.equal(sale3Res.status, 201);
  createdSaleIds.push(sale3Res.json.id);
  assert.equal(sale3Res.json.appliedCommissionPercent, 22);

  // Fechamento diário soma: Sale1 (30%*200=60) + Sale2 (35%*280=98) + Sale3 (22%*300=66) = 224
  // Confirmando que Sale #1 antiga preservou 30%!
  const closingAfter = await apiJson(baseUrl, `/api/closing/daily/${sellerA1.id}?date=${todayBr}`, {
    token: adminAToken,
  });
  assert.equal(closingAfter.status, 200);
  assert.equal(closingAfter.json.commissionBreakdown.aVistaCommission, 224);

  // Vendedor 2 sem exceção herda os 30% da empresa
  const saleS2Res = await apiJson(baseUrl, '/api/sales', {
    method: 'POST',
    token: sellerA2Token,
    body: {
      clientId: cStock1.id,
      city: 'Goiânia',
      value: 300,
      paymentMethod: 'PIX',
      receiptUrl: '/uploads/ss2.jpg',
    },
  });
  assert.equal(saleS2Res.status, 201);
  createdSaleIds.push(saleS2Res.json.id);
  assert.equal(saleS2Res.json.appliedCommissionPercent, 30);

  // =========================================================================
  // 6. REGRAS DE CREDIÁRIO (ENTRADA MÍNIMA, MÁX PARCELAS, FILA, JUROS/MULTA E SERASA)
  // =========================================================================
  const nextMonth = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().split('T')[0];

  // Excedeu 4 parcelas
  const creditTooManyInst = await apiJson(baseUrl, '/api/sales', {
    method: 'POST',
    token: sellerA1Token,
    body: {
      clientId: cA4.id,
      city: 'Goiânia',
      value: 600,
      paymentMethod: 'PIX',
      payments: [{ method: 'PIX', amount: 200 }],
      receiptUrl: '/uploads/s4-fail1.jpg',
      credit: {
        buyerCpf: '52998224725',
        downPayment: 200,
        installmentsCount: 5,
        periodicity: 'MONTHLY',
        firstDueDate: nextMonth,
        street: 'Rua 1',
        number: '10',
        neighborhood: 'Centro',
        city: 'Goiânia',
      },
    },
  });
  assert.equal(creditTooManyInst.status, 400);
  assert.equal(creditTooManyInst.json.code, 'CREDIT_MAX_INSTALLMENTS_EXCEEDED');

  // Entrada abaixo de 30% (150 em 600 = 25%)
  const creditLowDown = await apiJson(baseUrl, '/api/sales', {
    method: 'POST',
    token: sellerA1Token,
    body: {
      clientId: cA4.id,
      city: 'Goiânia',
      value: 600,
      paymentMethod: 'PIX',
      payments: [{ method: 'PIX', amount: 150 }],
      receiptUrl: '/uploads/s4-fail2.jpg',
      credit: {
        buyerCpf: '52998224725',
        downPayment: 150,
        installmentsCount: 3,
        periodicity: 'MONTHLY',
        firstDueDate: nextMonth,
        street: 'Rua 1',
        number: '10',
        neighborhood: 'Centro',
        city: 'Goiânia',
      },
    },
  });
  assert.equal(creditLowDown.status, 400);
  assert.equal(creditLowDown.json.code, 'CREDIT_MIN_DOWN_PAYMENT_NOT_MET');

  // Crediário válido: R$ 500 = R$ 200 entrada (40%) + 3x R$ 100
  const sale4Credit = await apiJson(baseUrl, '/api/sales', {
    method: 'POST',
    token: sellerA1Token,
    body: {
      clientId: cA4.id,
      city: 'Goiânia',
      value: 500,
      paymentMethod: 'PIX',
      payments: [{ method: 'PIX', amount: 200 }],
      receiptUrl: '/uploads/s4-ok.jpg',
      credit: {
        buyerCpf: '52998224725',
        downPayment: 200,
        installmentsCount: 3,
        periodicity: 'MONTHLY',
        firstDueDate: nextMonth,
        street: 'Rua 1',
        number: '10',
        neighborhood: 'Centro',
        city: 'Goiânia',
      },
    },
  });
  assert.equal(sale4Credit.status, 201);
  createdSaleIds.push(sale4Credit.json.id);

  const agreement = await prisma.creditAgreement.findUniqueOrThrow({
    where: { saleId: sale4Credit.json.id },
    include: { installments: { orderBy: { installmentNumber: 'asc' } } },
  });
  assert.equal(agreement.initialCommissionRate, 0.35);
  assert.equal(agreement.installmentCommissionRate, 0.14);

  // Retroagir 1ª parcela em 12 dias (>= 5d fila cobrança e >= 10d Serasa configurado!)
  const twelveDaysAgo = new Date(Date.now() - 12 * 24 * 3600 * 1000);
  await prisma.creditInstallment.update({
    where: { id: agreement.installments[0].id },
    data: { dueDate: twelveDaysAgo, status: 'OVERDUE' },
  });

  const queueRes = await apiJson(baseUrl, '/api/credit/agreements?status=COLLECTION_QUEUE', {
    token: adminAToken,
  });
  assert.equal(queueRes.status, 200);
  const queuedAg = (queueRes.json as any[]).find((a) => a.id === agreement.id);
  assert.ok(queuedAg);
  assert.equal(queuedAg.inCollectionQueue, true);
  assert.equal(queuedAg.serasaEligibleByDays, true);
  assert.equal(queuedAg.lateFinePercent, 5);
  assert.equal(queuedAg.lateFineCents, 500); // 5% de R$ 100
  assert.ok(queuedAg.lateInterestCents > 0);
  assert.equal(
    queuedAg.estimatedUpdatedOverdueBalanceCents,
    10000 + queuedAg.lateFineCents + queuedAg.lateInterestCents
  );

  // Serasa: deve considerar creditDaysToSerasaEligible = 10 dias
  const serasaCheck = await apiJson(baseUrl, `/api/credit/agreements/${agreement.id}/serasa`, {
    token: adminAToken,
  });
  assert.equal(serasaCheck.status, 200);
  assert.equal(serasaCheck.json.eligibility.eligible, true);

  // =========================================================================
  // 7. COMISSÃO DO FOTÓGRAFO NO FECHAMENTO + LIMPAR EXCEÇÃO DO VENDEDOR
  // =========================================================================
  const oldBatchDateStr = new Date(oldDate.getTime() - 3 * 3600 * 1000).toISOString().split('T')[0];
  const photoClosing = await apiJson(
    baseUrl,
    `/api/closing/photographer/${photoA.id}?date=${oldBatchDateStr}`,
    { token: adminAToken }
  );
  assert.equal(photoClosing.status, 200);
  assert.equal(photoClosing.json.commissionType, 'PERCENT_OF_SALE');
  assert.equal(photoClosing.json.commissionConfigValue, 5);
  // 5 vendas no lote: 200 + 280 + 300 + 300 + 500 = 1580 * 5% = 79,00 (7900 cents)
  assert.equal(photoClosing.json.commissionCents, 7900);

  // Limpar exceção do Vendedor 1 -> volta a herdar 30% / 15% / 12%
  const clearRes = await apiJson(
    baseUrl,
    `/api/company/operational-config/seller-overrides/${sellerA1.id}`,
    {
      method: 'PUT',
      token: adminAToken,
      body: { clear: true },
    }
  );
  assert.equal(clearRes.status, 200);
  assert.equal(clearRes.json.hasCustomOverride, false);
  assert.equal(clearRes.json.effectiveVirginCommissionPercent, 30);
});
