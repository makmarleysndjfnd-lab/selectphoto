import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import { prisma, disconnectPrisma } from '../src/services/prisma';
import eventsRoutes, { clearCompanyCityScoutCache } from '../src/routes/events';
import superadminRoutes from '../src/routes/superadmin';
import salesRoutes from '../src/routes/sales';
import closingRoutes from '../src/routes/closing';
import creditRoutes from '../src/routes/credit';
import companyOperationalConfigRoutes from '../src/routes/companyOperationalConfig';
import {
  getPublicBuyerConfirmationPrompt,
  issueBuyerConfirmationLink,
  renderPublicBuyerConfirmationHtml,
  submitPublicBuyerConfirmation,
} from '../src/services/buyerConfirmationService';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'lumora_etapa31_test_jwt_secret_77889900';
process.env.INTEGRATION_MASTER_KEY =
  process.env.INTEGRATION_MASTER_KEY ||
  'lumora_disposable_master_key_64hex_0123456789abcdef0123456789abcd';
process.env.EXTERNAL_SERVICES_DISABLED = 'true';

const app = express();
app.use(express.json());
app.use('/api/events', eventsRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/closing', closingRoutes);
app.use('/api/credit', creditRoutes);
app.use('/api/company', companyOperationalConfigRoutes);

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
const createdBatchIds: string[] = [];
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
    clearCompanyCityScoutCache(cid);
    await prisma.stateRadarCache.deleteMany({
      where: { state: { contains: `:${cid}:` } },
    });
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
    await prisma.staffAdvanceEntry.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.companyOperationalConfig.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.companyEventSearchConfig.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.apiUsageLog.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.apiUsageRecord.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.operationalAuditEvent.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.companyIntegration.deleteMany({
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

test('Etapa 31: Busca IA Avançada, Comissões 25/20/10 + Snapshot, e Personalização QR Code', async () => {
  const baseUrl = await getBaseUrl;
  const suffix = randomUUID().slice(0, 8);
  const passwordHash = await bcrypt.hash('Lumora31Test!', 6);

  const companyA = await prisma.company.create({
    data: {
      name: `Empresa Alpha E31 ${suffix}`,
      tradeName: `Alpha Foto E31`,
      status: 'ACTIVE',
      isActive: true,
    },
  });
  createdCompanyIds.push(companyA.id);

  const companyB = await prisma.company.create({
    data: {
      name: `Empresa Beta E31 ${suffix}`,
      tradeName: `Beta Foto E31`,
      status: 'ACTIVE',
      isActive: true,
    },
  });
  createdCompanyIds.push(companyB.id);

  const superAdmin = await prisma.user.create({
    data: {
      name: 'SuperAdmin E31',
      email: `sa.e31.${suffix}@lumora.test`,
      password: passwordHash,
      role: 'SUPER_ADMIN',
      companyId: null,
    },
  });
  createdUserIds.push(superAdmin.id);

  const adminA = await prisma.user.create({
    data: {
      name: 'Admin Alpha E31',
      email: `admin.a.e31.${suffix}@lumora.test`,
      password: passwordHash,
      role: 'ADMIN',
      companyId: companyA.id,
    },
  });
  createdUserIds.push(adminA.id);

  const sellerA = await prisma.user.create({
    data: {
      name: 'Vendedor Lucas E31',
      email: `seller.a.e31.${suffix}@lumora.test`,
      password: passwordHash,
      role: 'SELLER',
      companyId: companyA.id,
      usesOwnCar: false,
    },
  });
  createdUserIds.push(sellerA.id);

  const photoA = await prisma.user.create({
    data: {
      name: 'Fotógrafa Ana E31',
      email: `photo.a.e31.${suffix}@lumora.test`,
      password: passwordHash,
      role: 'PHOTOGRAPHER',
      companyId: companyA.id,
    },
  });
  createdUserIds.push(photoA.id);

  const sellerB = await prisma.user.create({
    data: {
      name: 'Vendedor Beta E31',
      email: `seller.b.e31.${suffix}@lumora.test`,
      password: passwordHash,
      role: 'SELLER',
      companyId: companyB.id,
      usesOwnCar: false,
    },
  });
  createdUserIds.push(sellerB.id);

  const saToken = signUserToken(superAdmin);
  const adminAToken = signUserToken(adminA);
  const sellerAToken = signUserToken(sellerA);
  const photoAToken = signUserToken(photoA);
  const sellerBToken = signUserToken(sellerB);

  // Configurar Gemini para Company A
  const setGemini = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${companyA.id}/integrations/gemini`,
    {
      method: 'PUT',
      token: saToken,
      body: { apiKey: 'AIzaSyEtapa31TestGeminiKey1234567890' },
    }
  );
  assert.equal(setGemini.status, 200);

  // =========================================================================
  // 1. BUSCA DE EVENTOS IA AVANÇADA (Duração, Porte, Raio, Cache TTL)
  // =========================================================================
  const advPayload = {
    searchDescription: 'Procurar grandes eventos presenciais familiares.',
    horizonDays: 90,
    priorityWeekdays: ['SEX', 'SAB', 'DOM'],
    includeHolidays: false,
    geographicFocus: 'Região Metropolitana',
    minDurationDays: 2,
    maxDurationDays: 10,
    allowSingleDayIfLarge: false,
    minEstimatedAudience: 5000,
    cityPopulationProfile: 'SMALL_MEDIUM',
    audienceFocus: 'GENERAL',
    entryTypePreference: 'FREE_ONLY',
    confirmationLevel: 'CONFIRMED_ONLY',
    baseCity: 'Goiânia',
    maxRadiusKm: 180,
    priorityStates: ['GO', 'MT'],
    maxResultsPerSearch: 12,
    cacheTtlDays: 0,
    eventTypes: [
      { id: 'expo_agro', name: 'Exposição Agropecuária', detail: 'Grande porte', enabled: true },
    ],
    exclusions: [{ id: 'no_1day', text: 'Eventos rápidos sem estrutura' }],
  };

  const putSearchRes = await apiJson(baseUrl, '/api/events/search-config', {
    method: 'PUT',
    token: adminAToken,
    body: advPayload,
  });
  assert.equal(putSearchRes.status, 200);
  assert.equal(putSearchRes.json.minDurationDays, 2);
  assert.equal(putSearchRes.json.maxDurationDays, 10);
  assert.equal(putSearchRes.json.allowSingleDayIfLarge, false);
  assert.equal(putSearchRes.json.minEstimatedAudience, 5000);
  assert.equal(putSearchRes.json.cityPopulationProfile, 'SMALL_MEDIUM');
  assert.equal(putSearchRes.json.audienceFocus, 'GENERAL');
  assert.equal(putSearchRes.json.entryTypePreference, 'FREE_ONLY');
  assert.equal(putSearchRes.json.confirmationLevel, 'CONFIRMED_ONLY');
  assert.equal(putSearchRes.json.baseCity, 'Goiânia');
  assert.equal(putSearchRes.json.maxRadiusKm, 180);
  assert.deepEqual(putSearchRes.json.priorityStates, ['GO', 'MT']);
  assert.equal(putSearchRes.json.maxResultsPerSearch, 12);
  assert.equal(putSearchRes.json.cacheTtlDays, 0);

  const preview: string = putSearchRes.json.renderedPromptPreview;
  assert.ok(preview.includes('Duração entre 2 e 10 dia(s)'));
  assert.ok(preview.includes('Descartar eventos de apenas 1 dia'));
  assert.ok(preview.includes('5.000 pessoas'));
  assert.ok(preview.includes('Cidades pequenas e médias'));
  assert.ok(preview.includes('Público geral amplo'));
  assert.ok(preview.includes('entrada gratuita'));
  assert.ok(preview.includes('Somente edições oficialmente confirmadas'));
  assert.ok(preview.includes('Cidade-base: Goiânia'));
  assert.ok(preview.includes('Raio máximo: 180 km'));
  assert.ok(preview.includes('UFs prioritárias: GO, MT'));
  assert.ok(preview.includes('até 12 eventos'));

  // Cache TTL = 0 nunca reaproveita cache
  const citySearch = `AnapolisE31-${suffix}`;
  const s1 = await apiJson(baseUrl, '/api/events/search', {
    method: 'POST',
    token: adminAToken,
    body: { city: citySearch },
  });
  assert.equal(s1.status, 200);
  assert.equal(s1.json.cached, false);
  assert.equal(s1.json.cacheTtlDays, 0);

  const s2 = await apiJson(baseUrl, '/api/events/search', {
    method: 'POST',
    token: adminAToken,
    body: { city: citySearch },
  });
  assert.equal(s2.status, 200);
  assert.equal(s2.json.cached, false);

  // Altera cacheTtlDays para 5 -> gera novo configHash e ativa cache
  const putTtl5 = await apiJson(baseUrl, `/api/superadmin/companies/${companyA.id}/event-search-config`, {
    method: 'PUT',
    token: saToken,
    body: { ...advPayload, cacheTtlDays: 5 },
  });
  assert.equal(putTtl5.status, 200);
  assert.notEqual(putTtl5.json.configHash, putSearchRes.json.configHash);

  const s3 = await apiJson(baseUrl, '/api/events/search', {
    method: 'POST',
    token: adminAToken,
    body: { city: citySearch },
  });
  assert.equal(s3.status, 200);
  assert.equal(s3.json.cached, false);
  assert.equal(s3.json.configHash, putTtl5.json.configHash);

  const s4 = await apiJson(baseUrl, '/api/events/search', {
    method: 'POST',
    token: adminAToken,
    body: { city: citySearch },
  });
  assert.equal(s4.status, 200);
  assert.equal(s4.json.cached, true);

  // =========================================================================
  // 2. RBAC & MULTI-TENANT CONFIGURAÇÃO OPERACIONAL
  // =========================================================================
  for (const forbidden of [sellerAToken, photoAToken]) {
    const rGet = await apiJson(baseUrl, '/api/company/operational-config', { token: forbidden });
    assert.equal(rGet.status, 403);
    const rPut = await apiJson(baseUrl, '/api/company/operational-config', {
      method: 'PUT',
      token: forbidden,
      body: { virginBookCommissionPercent: 50 },
    });
    assert.equal(rPut.status, 403);
  }

  const crossGet = await apiJson(
    baseUrl,
    `/api/company/operational-config?companyId=${companyB.id}`,
    { token: adminAToken }
  );
  assert.equal(crossGet.status, 403);

  const adminCallingSaOp = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${companyA.id}/operational-config`,
    { token: adminAToken }
  );
  assert.equal(adminCallingSaOp.status, 403);

  // =========================================================================
  // 3. COMISSÕES 25/20/10 DEFAULT + CUSTOMIZAÇÃO + SNAPSHOT IMUTÁVEL
  // =========================================================================
  const batchA = await prisma.bookBatch.create({
    data: {
      name: `Lote E31 A ${suffix}`,
      city: 'Goiânia',
      totalProduced: 10,
      companyId: companyA.id,
      photographerId: photoA.id,
    },
  });
  createdBatchIds.push(batchA.id);

  const batchB = await prisma.bookBatch.create({
    data: {
      name: `Lote E31 B ${suffix}`,
      city: 'Anápolis',
      totalProduced: 5,
      companyId: companyB.id,
      photographerId: sellerB.id,
    },
  });
  createdBatchIds.push(batchB.id);

  const createClient = async (companyId: string, sellerId: string, batchId: string, bookStatus: string, code: string) => {
    const c = await prisma.client.create({
      data: {
        name: `Cliente ${code} ${suffix}`,
        city: 'Goiânia',
        street: 'Rua Teste',
        number: '100',
        neighborhood: 'Centro',
        phone1: '62999991234',
        companyId,
        assignedSellerId: sellerId,
        batchId,
        bookStatus,
        visibleCode: code,
        sequenceNumber: code,
      },
    });
    createdClientIds.push(c.id);
    return c;
  };

  // Empresa B (sem edição): Virgem 25%, Rebolo 20%
  const clientBVirgin = await createClient(companyB.id, sellerB.id, batchB.id, 'DISTRIBUTED', `BV-${suffix}`);
  const clientBRebolo = await createClient(companyB.id, sellerB.id, batchB.id, 'DISTRIBUTED_REBOLO', `BR-${suffix}`);

  const saleBVirgin = await apiJson(baseUrl, '/api/sales', {
    method: 'POST',
    token: sellerBToken,
    body: {
      clientId: clientBVirgin.id,
      city: 'Anápolis',
      value: 200,
      paymentMethod: 'PIX',
      receiptUrl: '/uploads/rec-bv.jpg',
    },
  });
  assert.equal(saleBVirgin.status, 201);
  createdSaleIds.push(saleBVirgin.json.id);
  assert.equal(saleBVirgin.json.appliedCommissionPercent, 25);

  const saleBRebolo = await apiJson(baseUrl, '/api/sales', {
    method: 'POST',
    token: sellerBToken,
    body: {
      clientId: clientBRebolo.id,
      city: 'Anápolis',
      value: 200,
      paymentMethod: 'CASH',
      receiptUrl: '/uploads/rec-br.jpg',
    },
  });
  assert.equal(saleBRebolo.status, 201);
  createdSaleIds.push(saleBRebolo.json.id);
  assert.equal(saleBRebolo.json.appliedCommissionPercent, 20);

  // Empresa A: Venda #1 ANTES de editar (grava snapshot 25%)
  const clientA1 = await createClient(companyA.id, sellerA.id, batchA.id, 'DISTRIBUTED', `A1-${suffix}`);
  const saleA1 = await apiJson(baseUrl, '/api/sales', {
    method: 'POST',
    token: sellerAToken,
    body: {
      clientId: clientA1.id,
      city: 'Goiânia',
      value: 200,
      paymentMethod: 'PIX',
      receiptUrl: '/uploads/rec-a1.jpg',
    },
  });
  assert.equal(saleA1.status, 201);
  createdSaleIds.push(saleA1.json.id);
  assert.equal(saleA1.json.appliedCommissionPercent, 25);

  // Atualiza Comissões de Empresa A para Virgem 30%, Rebolo 15%, Crediário 12% (via SuperAdmin)
  const updateOpRes = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${companyA.id}/operational-config`,
    {
      method: 'PUT',
      token: saToken,
      body: {
        virginBookCommissionPercent: 30,
        reboloBookCommissionPercent: 15,
        creditInstallmentCommissionPercent: 12,
        sacPhone: '(62) 3333-4444',
        sacWhatsapp: '(62) 98888-7777',
        qrReceiptFooterText: 'Garantia Lumora de 90 dias para impressões.',
      },
    }
  );
  assert.equal(updateOpRes.status, 200);
  assert.equal(updateOpRes.json.virginBookCommissionPercent, 30);
  assert.equal(updateOpRes.json.reboloBookCommissionPercent, 15);
  assert.equal(updateOpRes.json.creditInstallmentCommissionPercent, 12);

  // Admin lê exatamente a mesma config salva pelo SuperAdmin (sincronia)
  const adminOpRead = await apiJson(baseUrl, '/api/company/operational-config', {
    token: adminAToken,
  });
  assert.equal(adminOpRead.status, 200);
  assert.equal(adminOpRead.json.virginBookCommissionPercent, 30);
  assert.equal(adminOpRead.json.sacPhone, '(62) 3333-4444');

  // Venda #2 Virgem após edição -> 30%
  const clientA2 = await createClient(companyA.id, sellerA.id, batchA.id, 'DISTRIBUTED', `A2-${suffix}`);
  const saleA2 = await apiJson(baseUrl, '/api/sales', {
    method: 'POST',
    token: sellerAToken,
    body: {
      clientId: clientA2.id,
      city: 'Goiânia',
      value: 200,
      paymentMethod: 'PIX',
      receiptUrl: '/uploads/rec-a2.jpg',
    },
  });
  assert.equal(saleA2.status, 201);
  createdSaleIds.push(saleA2.json.id);
  assert.equal(saleA2.json.appliedCommissionPercent, 30);

  // Venda #3 Rebolo após edição -> 15%
  const clientA3 = await createClient(companyA.id, sellerA.id, batchA.id, 'DISTRIBUTED_REBOLO', `A3-${suffix}`);
  const saleA3 = await apiJson(baseUrl, '/api/sales', {
    method: 'POST',
    token: sellerAToken,
    body: {
      clientId: clientA3.id,
      city: 'Goiânia',
      value: 200,
      paymentMethod: 'CASH',
      receiptUrl: '/uploads/rec-a3.jpg',
    },
  });
  assert.equal(saleA3.status, 201);
  createdSaleIds.push(saleA3.json.id);
  assert.equal(saleA3.json.appliedCommissionPercent, 15);

  // Venda #4 Crediário em Virgem (R$ 500 = R$ 200 entrada + 3x R$ 100) -> entrada 30%, parcelas 12%
  const clientA4 = await createClient(companyA.id, sellerA.id, batchA.id, 'DISTRIBUTED', `A4-${suffix}`);
  const nextMonth = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().split('T')[0];
  const saleA4 = await apiJson(baseUrl, '/api/sales', {
    method: 'POST',
    token: sellerAToken,
    body: {
      clientId: clientA4.id,
      city: 'Goiânia',
      value: 500,
      paymentMethod: 'PIX',
      payments: [{ method: 'PIX', amount: 200 }],
      receiptUrl: '/uploads/rec-a4.jpg',
      credit: {
        buyerCpf: '52998224725',
        downPayment: 200,
        installmentsCount: 3,
        periodicity: 'MONTHLY',
        firstDueDate: nextMonth,
        street: 'Rua Teste',
        number: '100',
        neighborhood: 'Centro',
        city: 'Goiânia',
      },
    },
  });
  assert.equal(saleA4.status, 201);
  createdSaleIds.push(saleA4.json.id);
  assert.equal(saleA4.json.appliedCommissionPercent, 30);

  const agreementA4 = await prisma.creditAgreement.findUniqueOrThrow({
    where: { saleId: saleA4.json.id },
  });
  assert.equal(agreementA4.initialCommissionRate, 0.30);
  assert.equal(agreementA4.installmentCommissionRate, 0.12);

  // Pagar 1 parcela de R$ 100,00 -> deve gerar comissão de 12% (R$ 12,00 = 1200 cents)
  const payInst = await apiJson(
    baseUrl,
    `/api/credit/agreements/${agreementA4.id}/payments`,
    {
      method: 'POST',
      token: adminAToken,
      body: {
        idempotencyKey: `e31-pay-${suffix}`,
        amount: 100,
        paymentMethod: 'PIX',
        destination: 'COMPANY_BANK',
      },
    }
  );
  assert.equal(payInst.status, 201);
  const instComm = await prisma.creditCommission.findFirst({
    where: { agreementId: agreementA4.id, type: 'INSTALLMENT' },
  });
  assert.ok(instComm);
  assert.equal(instComm.amountCents, 1200);

  // Fechamento diário soma corretamente:
  // Sale #1 (snapshot 25% * 200 = 50) + Sale #2 (30% * 200 = 60) + Sale #3 (15% * 200 = 30) = 140 à vista
  // Sale #4 entrada (30% * 200 = 60) -> total diário = 200; parcela crediário = 12
  const todayBr = new Date(Date.now() - 3 * 3600 * 1000).toISOString().split('T')[0];
  const closingRes = await apiJson(
    baseUrl,
    `/api/closing/daily/${sellerA.id}?date=${todayBr}`,
    { token: adminAToken }
  );
  assert.equal(closingRes.status, 200);
  assert.equal(closingRes.json.commissionBreakdown.aVistaCommission, 140);
  assert.equal(closingRes.json.commissionBreakdown.crediarioDownPaymentCommission, 60);
  assert.equal(closingRes.json.commissionBreakdown.crediarioInstallmentsCommission, 12);
  assert.equal(closingRes.json.commissionAmount, 200);

  // Cancelamento da Sale #1 (snapshot anterior 25%) deve debitar EXATAMENTE 25% (5000 cents), sem distorção para 30%!
  const refundA1 = await apiJson(
    baseUrl,
    `/api/sales/${saleA1.json.id}/refund-or-cancel`,
    {
      method: 'POST',
      token: adminAToken,
      body: {
        type: 'FULL_CANCELLATION',
        reason: 'Teste imutabilidade snapshot anterior',
        receiptUrl: '/uploads/refund-a1.jpg',
      },
    }
  );
  assert.equal(refundA1.status, 201);
  assert.equal(refundA1.json.commissionDebitCents, 5000);

  // Cancelamento da Sale #3 (Rebolo 15% * 200) -> 3000 cents!
  const refundA3 = await apiJson(
    baseUrl,
    `/api/sales/${saleA3.json.id}/refund-or-cancel`,
    {
      method: 'POST',
      token: adminAToken,
      body: {
        type: 'FULL_CANCELLATION',
        reason: 'Teste comissão rebolo 15%',
        receiptUrl: '/uploads/refund-a3.jpg',
      },
    }
  );
  assert.equal(refundA3.status, 201);
  assert.equal(refundA3.json.commissionDebitCents, 3000);

  // =========================================================================
  // 4. UPLOAD DE LOGO (B2/LOCAL) + PERSONALIZAÇÃO DO QR CODE DA VENDA
  // =========================================================================
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const logoForm = new FormData();
  logoForm.append('logo', new Blob([pngBytes], { type: 'image/png' }), 'logo-alpha.png');
  const uploadLogoRes = await fetch(`${baseUrl}/api/company/operational-config/logo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminAToken}` },
    body: logoForm,
  });
  assert.equal(uploadLogoRes.status, 200);
  const uploadLogoJson = (await uploadLogoRes.json()) as any;
  assert.ok(String(uploadLogoJson.logoUrl).includes('/api/company/public/logo/'));

  const publicLogoRes = await fetch(`${baseUrl}${uploadLogoJson.logoUrl}`);
  assert.equal(publicLogoRes.status, 200);

  // Ocultar campos específicos do QR Code pelo Admin
  const hideQrFields = await apiJson(baseUrl, '/api/company/operational-config', {
    method: 'PUT',
    token: adminAToken,
    body: {
      qrShowLogo: false,
      qrShowTradeName: true,
      qrShowSacContact: true,
      qrShowSellerName: false,
      qrShowPhotographerName: false,
      qrShowPaymentMethod: false,
      qrShowSaleValue: false,
      qrShowInstallmentSummary: false,
      qrShowBatchAndBookCode: false,
      qrShowRatingForm: false,
      qrShowFooterText: true,
    },
  });
  assert.equal(hideQrFields.status, 200);

  // Emitir token QR para Venda #4 e conferir filtragem estrita no prompt & HTML
  const issuedQr = await issueBuyerConfirmationLink({
    saleId: saleA4.json.id,
    companyId: companyA.id,
    sellerId: sellerA.id,
    actorUserId: sellerA.id,
    actorName: sellerA.name,
    actorRole: 'SELLER',
  });

  const qrPrompt = await getPublicBuyerConfirmationPrompt(issuedQr.rawToken);
  assert.equal(qrPrompt.companyName, 'Alpha Foto E31');
  assert.equal(qrPrompt.companyLogoUrl, null); // Ocultado por qrShowLogo=false
  assert.equal(qrPrompt.sellerName, null); // Ocultado por qrShowSellerName=false
  assert.equal(qrPrompt.photographerName, null); // Ocultado por qrShowPhotographerName=false
  assert.equal(qrPrompt.fichaCode, null); // Ocultado por qrShowBatchAndBookCode=false
  assert.equal(qrPrompt.batchName, null);
  assert.equal(qrPrompt.sacPhone, '(62) 3333-4444');
  assert.equal(qrPrompt.footerText, 'Garantia Lumora de 90 dias para impressões.');

  const qrHtml = renderPublicBuyerConfirmationHtml({
    token: issuedQr.rawToken,
    prompt: qrPrompt,
  });
  assert.ok(!qrHtml.includes('<img src='));
  assert.ok(!qrHtml.includes('<div>Vendedor:'));
  assert.ok(!qrHtml.includes(sellerA.name));
  assert.ok(!qrHtml.includes('<div>Fotógrafo:'));
  assert.ok(!qrHtml.includes(photoA.name));
  assert.ok(!qrHtml.includes('data-rating-group="serviceRating"'));
  assert.ok(qrHtml.includes('(62) 3333-4444'));
  assert.ok(qrHtml.includes('Garantia Lumora de 90 dias para impressões.'));

  // Submeter conferência sem ratings (qrShowRatingForm=false) -> receipt deve omitir campos desmarcados
  const confirmRes = await submitPublicBuyerConfirmation({
    rawToken: issuedQr.rawToken,
    phoneLast4: '1234',
    reportedTotalValue: '500.00',
    reportedPaidValue: '200.00',
    reportedPaymentMethod: 'CREDIARIO',
    reportedRemainingValue: '300.00',
    reportedInstallmentsCount: '3',
    reportedInstallmentValue: '100.00',
    ipAddress: '127.0.0.1',
  });
  assert.equal(confirmRes.received, true);
  assert.equal(confirmRes.receipt.companyName, 'Alpha Foto E31');
  assert.equal(confirmRes.receipt.companyLogoUrl, undefined);
  assert.equal(confirmRes.receipt.sellerName, undefined);
  assert.equal(confirmRes.receipt.photographerName, undefined);
  assert.equal(confirmRes.receipt.referenceCode, undefined);
  assert.equal(confirmRes.receipt.reportedTotalBrl, undefined);
  assert.equal(confirmRes.receipt.reportedPaidBrl, undefined);
  assert.equal(confirmRes.receipt.reportedPaymentMethod, undefined);
  assert.equal(confirmRes.receipt.creditDetails, undefined);
  assert.equal(confirmRes.receipt.sacPhone, '(62) 3333-4444');
  assert.equal(confirmRes.receipt.footerText, 'Garantia Lumora de 90 dias para impressões.');

  // Auditoria gravada
  const auditLogs = await prisma.operationalAuditEvent.findMany({
    where: { companyId: companyA.id, entityType: 'COMPANY_OPERATIONAL_CONFIG' },
  });
  assert.ok(auditLogs.length >= 3);
});
