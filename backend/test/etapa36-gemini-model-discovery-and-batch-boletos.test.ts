import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { prisma, disconnectPrisma } from '../src/services/prisma';
import {
  clearCompanyCityScoutCache,
  setEventSearchAiClientOverrideForTests,
} from '../src/routes/events';
import eventsRoutes from '../src/routes/events';
import superadminRoutes from '../src/routes/superadmin';
import creditRoutes from '../src/routes/credit';
import {
  getCompanyGeminiMetadata,
  setGeminiClientOverrideForTests,
} from '../src/services/geminiModelService';
import {
  DEFAULT_EVENT_SEARCH_CONFIG,
  addDaysToDateIso,
  formatDateBrt,
} from '../src/services/eventSearchConfigService';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'lumora_etapa36_test_jwt_secret_99887766';
process.env.INTEGRATION_MASTER_KEY =
  process.env.INTEGRATION_MASTER_KEY ||
  'lumora_disposable_master_key_64hex_0123456789abcdef0123456789abcdef';
process.env.EXTERNAL_SERVICES_DISABLED = 'true';
delete process.env.ASAAS_ALLOW_LIVE_OPERATIONS;

interface MockHttpCall {
  method: string;
  url: string;
  body: any;
}

const mockAsaasCalls: MockHttpCall[] = [];
const mockAsaasServer = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const rawBody = Buffer.concat(chunks).toString('utf8');
    let parsedBody: any = null;
    try {
      parsedBody = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      parsedBody = rawBody;
    }

    const reqUrl = req.url || '';
    const reqMethod = req.method || 'GET';
    mockAsaasCalls.push({ method: reqMethod, url: reqUrl, body: parsedBody });
    res.setHeader('Content-Type', 'application/json');

    const cashMatch = reqUrl.match(/^\/v3\/payments\/([^/]+)\/receiveInCash$/);
    if (cashMatch && reqMethod === 'POST') {
      res.writeHead(200);
      res.end(
        JSON.stringify({
          id: cashMatch[1],
          status: 'RECEIVED_IN_CASH',
          value: parsedBody?.value,
          paymentDate: parsedBody?.paymentDate,
        })
      );
      return;
    }

    const putPayMatch = reqUrl.match(/^\/v3\/payments\/([^/?]+)$/);
    if (putPayMatch && reqMethod === 'PUT') {
      res.writeHead(200);
      res.end(
        JSON.stringify({
          id: putPayMatch[1],
          status: 'PENDING',
          value: parsedBody?.value,
          dueDate: parsedBody?.dueDate,
        })
      );
      return;
    }

    const cancelDunningMatch = reqUrl.match(/^\/v3\/paymentDunnings\/([^/]+)\/cancel$/);
    if (cancelDunningMatch && reqMethod === 'POST') {
      res.writeHead(200);
      res.end(
        JSON.stringify({
          id: cancelDunningMatch[1],
          status: 'CANCELLED',
        })
      );
      return;
    }

    res.writeHead(200);
    res.end(JSON.stringify({ ok: true }));
  });
});

const app = express();
app.use(express.json());
app.use('/api/events', eventsRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api/credit', creditRoutes);

const appServer = app.listen(0, '127.0.0.1');

const setupReady = Promise.all([
  new Promise<string>((resolve) => {
    appServer.once('listening', () => {
      const port = (appServer.address() as AddressInfo).port;
      resolve(`http://127.0.0.1:${port}`);
    });
  }),
  new Promise<string>((resolve) => {
    mockAsaasServer.listen(0, '127.0.0.1', () => {
      const port = (mockAsaasServer.address() as AddressInfo).port;
      const base = `http://127.0.0.1:${port}/v3`;
      process.env.ASAAS_SANDBOX_BASE_URL_OVERRIDE = base;
      resolve(base);
    });
  }),
]);

const createdCompanyIds: string[] = [];
const createdUserIds: string[] = [];
const createdClientIds: string[] = [];

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
  setEventSearchAiClientOverrideForTests(null);
  setGeminiClientOverrideForTests(null);
  delete process.env.ASAAS_SANDBOX_BASE_URL_OVERRIDE;

  appServer.closeAllConnections();
  mockAsaasServer.closeAllConnections();
  await Promise.all([
    new Promise<void>((resolve) => appServer.close(() => resolve())),
    new Promise<void>((resolve) => mockAsaasServer.close(() => resolve())),
  ]);

  for (const cid of createdCompanyIds) {
    clearCompanyCityScoutCache(cid);
    await prisma.stateRadarCache.deleteMany({
      where: { state: { contains: `:${cid}:` } },
    });
  }

  if (createdCompanyIds.length > 0) {
    await prisma.creditNegativationRecord.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.creditCommission.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.creditPaymentAllocation.deleteMany({
      where: { payment: { companyId: { in: createdCompanyIds } } },
    });
    await prisma.creditPayment.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.asaasCharge.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.creditInstallment.deleteMany({
      where: { agreement: { companyId: { in: createdCompanyIds } } },
    });
    await prisma.creditAgreement.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.sale.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.clientTimeline.deleteMany({
      where: { clientId: { in: createdClientIds } },
    });
    await prisma.client.deleteMany({
      where: { id: { in: createdClientIds } },
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
    await prisma.asaasConfig.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.companyIntegration.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
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

test('Etapa 36: Descoberta Dinâmica Gemini (Fallback 404 -> Gemini 3 Flash + Modelo Customizado + Passo 2 Resiliente) & Baixa em Lote + Edição Sincronizada Asaas', async () => {
  const [baseUrl] = await setupReady;
  const suffix = randomUUID().slice(0, 8);
  const passwordHash = await bcrypt.hash('Lumora36Test!', 6);

  const companyA = await prisma.company.create({
    data: {
      name: `Empresa E36 A ${suffix}`,
      tradeName: 'Foto E36 A',
      status: 'ACTIVE',
      isActive: true,
    },
  });
  const companyB = await prisma.company.create({
    data: {
      name: `Empresa E36 B ${suffix}`,
      tradeName: 'Foto E36 B',
      status: 'ACTIVE',
      isActive: true,
    },
  });
  createdCompanyIds.push(companyA.id, companyB.id);

  const superAdmin = await prisma.user.create({
    data: {
      name: 'SuperAdmin E36',
      email: `sa.e36.${suffix}@lumora.test`,
      password: passwordHash,
      role: 'SUPER_ADMIN',
      companyId: null,
    },
  });
  const adminA = await prisma.user.create({
    data: {
      name: 'Admin E36 A',
      email: `adminA.e36.${suffix}@lumora.test`,
      password: passwordHash,
      role: 'ADMIN',
      companyId: companyA.id,
    },
  });
  const sellerA = await prisma.user.create({
    data: {
      name: 'Seller E36 A',
      email: `sellerA.e36.${suffix}@lumora.test`,
      password: passwordHash,
      role: 'SELLER',
      companyId: companyA.id,
    },
  });
  const photoA = await prisma.user.create({
    data: {
      name: 'Photo E36 A',
      email: `photoA.e36.${suffix}@lumora.test`,
      password: passwordHash,
      role: 'PHOTOGRAPHER',
      companyId: companyA.id,
    },
  });
  const adminB = await prisma.user.create({
    data: {
      name: 'Admin E36 B',
      email: `adminB.e36.${suffix}@lumora.test`,
      password: passwordHash,
      role: 'COMPANY_ADMIN',
      companyId: companyB.id,
    },
  });
  createdUserIds.push(superAdmin.id, adminA.id, sellerA.id, photoA.id, adminB.id);

  const saToken = signUserToken(superAdmin);
  const adminAToken = signUserToken(adminA);
  const sellerAToken = signUserToken(sellerA);
  const photoAToken = signUserToken(photoA);
  const adminBToken = signUserToken(adminB);

  // ═══════════════════════════════════════════════════════════════════════════
  // PARTE 1: GEMINI DYNAMIC DISCOVERY, 404 FALLBACK, CUSTOM MODEL & PIPELINE
  // ═══════════════════════════════════════════════════════════════════════════

  // Empresa B sem chave Gemini mantém bloqueio 403 COMPANY_GEMINI_KEY_REQUIRED
  const blockedB = await apiJson(baseUrl, '/api/events/search', {
    method: 'POST',
    token: adminBToken,
    body: { city: 'Goiânia - GO' },
  });
  assert.equal(blockedB.status, 403);
  assert.equal(blockedB.json?.code, 'COMPANY_GEMINI_KEY_REQUIRED');

  // Cadastrar chave Gemini e definir inicialmente gemini-2.5-flash (simular chave nova que dá 404 nele)
  const saveGeminiRes = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${companyA.id}/integrations/gemini`,
    {
      method: 'PUT',
      token: saToken,
      body: {
        apiKey: 'AIzaSyEtapa36DiscoveryTestKey99999999',
        geminiModel: 'gemini-2.5-flash',
      },
    }
  );
  assert.equal(saveGeminiRes.status, 200);
  assert.equal(saveGeminiRes.json?.geminiModel, 'gemini-2.5-flash');

  const geminiCalls: { op: string; model?: string; hasSchema?: boolean }[] = [];
  let rejectSchemaInStep2 = false;
  let force404OnModels = new Set<string>(['gemini-2.5-flash']);

  const todayBrt = formatDateBrt();
  const futureStart = addDaysToDateIso(todayBrt, 12);
  const futureEnd = addDaysToDateIso(todayBrt, 16);
  const futureStartBr = `${futureStart.slice(8, 10)}/${futureStart.slice(5, 7)}/${futureStart.slice(0, 4)}`;

  const aiMockFactory = () => ({
    models: {
      async list() {
        geminiCalls.push({ op: 'list' });
        return {
          models: [
            {
              name: 'models/text-embedding-004',
              displayName: 'Text Embedding 004',
              supportedActions: ['embedContent'],
            },
            {
              name: 'models/gemini-2.0-flash',
              displayName: 'Gemini 2.0 Flash',
              supportedActions: ['generateContent'],
            },
            {
              name: 'models/gemini-2.5-flash',
              displayName: 'Gemini 2.5 Flash',
              supportedActions: ['generateContent'],
            },
            {
              name: 'models/gemini-3-flash-preview',
              displayName: 'Gemini 3 Flash Preview',
              supportedActions: ['generateContent'],
            },
          ],
        };
      },
      async generateContent(params: any) {
        const model = String(params?.model || '');
        const hasSchema = Boolean(params?.config?.responseSchema);
        geminiCalls.push({ op: 'generateContent', model, hasSchema });

        if (force404OnModels.has(model)) {
          const err: any = new Error(
            `This model models/${model} is no longer available to new users. Status NOT_FOUND`
          );
          err.status = 404;
          throw err;
        }

        if (params?.contents === 'Responda apenas OK') {
          return {
            text: 'OK',
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1, totalTokenCount: 6 },
          };
        }

        const isStep1 =
          Array.isArray(params?.config?.tools) &&
          params.config.tools.some((t: any) => Boolean(t?.googleSearch));

        if (isStep1) {
          return {
            text: `Eventos pesquisados com Gemini (${model}): Festa Agro em ${todayBrt}.`,
            candidates: [
              {
                groundingMetadata: {
                  webSearchQueries: [`expo jatai ${model}`],
                  groundingChunks: [
                    {
                      web: {
                        uri: 'https://www.sympla.com.br/evento/expo-jatai-36/123456',
                        title: 'Expo Jataí Oficial',
                      },
                    },
                  ],
                },
              },
            ],
            usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 200, totalTokenCount: 320 },
          };
        }

        // Passo 2: opcionalmente rejeita responseSchema/thinkingConfig para validar fallback seguro
        if (rejectSchemaInStep2 && hasSchema) {
          const schemaErr: any = new Error('INVALID_ARGUMENT: responseSchema is not supported for this model');
          schemaErr.status = 400;
          throw schemaErr;
        }

        return {
          text: JSON.stringify({
            cityInfo: {
              name: 'Jataí - GO',
              state: 'GO',
              summary: 'Polo agroindustrial de Goiás.',
              population: '105.729 hab.',
              perCapitaIncome: 'R$ 54.000/ano',
              gdp: 'R$ 6,1 bilhões',
            },
            events: [
              {
                name: 'Expo Jataí Oficial',
                category: 'Exposição Agropecuária',
                city: 'Jataí - GO',
                state: 'GO',
                location: 'Parque de Exposições de Jataí',
                startDate: futureStartBr, // Formato DD/MM/YYYY normalizado pelo pós-filtro BRT
                endDate: futureEnd,
                estimatedAudience: '30.000 pessoas',
                ticketPrice: 'R$ 30,00',
                entryType: 'PAID',
                sourceIndex: 1,
                sourceUrl: 'https://www.sympla.com.br/evento/expo-jatai-36/123456',
                score: 'HIGH',
              },
            ],
          }),
          usageMetadata: { promptTokenCount: 180, candidatesTokenCount: 140, totalTokenCount: 320 },
        };
      },
    },
  });

  setGeminiClientOverrideForTests(aiMockFactory);
  setEventSearchAiClientOverrideForTests(aiMockFactory);

  // 1a. Endpoint GET /integrations/gemini/models filtra embedContent e prioriza Gemini 3 Flash
  const modelsRes = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${companyA.id}/integrations/gemini/models`,
    { token: saToken }
  );
  assert.equal(modelsRes.status, 200);
  assert.equal(modelsRes.json?.recommendedModel, 'gemini-3-flash-preview');
  const modelIds = (modelsRes.json?.models || []).map((m: any) => m.id);
  assert.equal(modelIds[0], 'gemini-3-flash-preview');
  assert.ok(!modelIds.includes('text-embedding-004'));

  // 1b. Testar Conexão recebe 404 em gemini-2.5-flash -> descobre e migra para gemini-3-flash-preview automaticamente!
  const testConnRes = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${companyA.id}/integrations/gemini/test`,
    { method: 'POST', token: saToken }
  );
  assert.equal(testConnRes.status, 200);
  assert.equal(testConnRes.json?.success, true);
  assert.equal(testConnRes.json?.activeModel, 'gemini-3-flash-preview');
  assert.equal(testConnRes.json?.autoSwitchedFrom, 'gemini-2.5-flash');

  // Confirma persistência automática em CompanyIntegration.configMetadata.geminiModel
  const persistedMeta = await getCompanyGeminiMetadata(companyA.id);
  assert.equal(persistedMeta.geminiModel, 'gemini-3-flash-preview');

  // 1c. Atualizar apenas modelo customizado em PUT /gemini sem reenviar apiKey (preserva chave e testa uso direto!)
  const customModelPut = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${companyA.id}/integrations/gemini`,
    {
      method: 'PUT',
      token: saToken,
      body: { geminiModel: 'gemini-3.5-flash-custom' },
    }
  );
  assert.equal(customModelPut.status, 200);
  assert.equal(customModelPut.json?.configured, true);
  assert.equal(customModelPut.json?.geminiModel, 'gemini-3.5-flash-custom');

  // Busca em 2 passos usa o modelo customizado salvo e passa no fallback do Passo 2 quando responseSchema falha (400)
  rejectSchemaInStep2 = true;
  geminiCalls.length = 0;

  const searchCustomRes = await apiJson(baseUrl, '/api/events/search', {
    method: 'POST',
    token: adminAToken,
    body: { city: `Jataí E36 ${suffix}`, force: true },
  });
  assert.equal(searchCustomRes.status, 200);
  assert.equal(searchCustomRes.json?.searchMeta?.model, 'gemini-3.5-flash-custom');
  assert.equal(searchCustomRes.json?.events?.length, 1);
  assert.equal(searchCustomRes.json?.events?.[0]?.startDate, futureStart);
  assert.equal(searchCustomRes.json?.events?.[0]?.durationDays, 5);
  assert.equal(searchCustomRes.json?.events?.[0]?.verificationStatus, 'VERIFIED_SOURCE');
  assert.ok(
    geminiCalls.some((c) => c.op === 'generateContent' && c.hasSchema === true) &&
      geminiCalls.some((c) => c.op === 'generateContent' && c.hasSchema === false),
    'Passo 2 deve tentar fallback sem responseSchema quando rejeitado com HTTP 400'
  );

  // 1d. Fallback 404 durante a própria busca de Eventos IA (se modelo customizado passar a dar 404)
  rejectSchemaInStep2 = false;
  force404OnModels.add('gemini-3.5-flash-custom');
  const search404FallbackRes = await apiJson(baseUrl, '/api/events/search', {
    method: 'POST',
    token: adminAToken,
    body: { city: `Mineiros E36 ${suffix}`, force: true },
  });
  assert.equal(search404FallbackRes.status, 200);
  assert.equal(search404FallbackRes.json?.searchMeta?.model, 'gemini-3-flash-preview');
  const updatedMetaAfterSearch = await getCompanyGeminiMetadata(companyA.id);
  assert.equal(updatedMetaAfterSearch.geminiModel, 'gemini-3-flash-preview');

  const usageLogsA = await prisma.apiUsageLog.findMany({
    where: { companyId: companyA.id, provider: 'GEMINI', operation: 'EVENTS_SEARCH' },
  });
  assert.ok(usageLogsA.length >= 2);
  assert.equal(usageLogsA[0].status, 'SUCCESS');
  assert.ok(usageLogsA[0].totalTokens > 0);

  // ═══════════════════════════════════════════════════════════════════════════
  // PARTE 2: BAIXA EM LOTE + EDIÇÃO SINCRONIZADA COM ASAAS (SANDBOX)
  // ═══════════════════════════════════════════════════════════════════════════

  // Configura chave Asaas Sandbox exclusiva para Company A
  const saveAsaasRes = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${companyA.id}/integrations/asaas`,
    {
      method: 'PUT',
      token: saToken,
      body: {
        apiKey: '$aact_hmlg_etapa36_sandbox_mock_1234',
        environment: 'SANDBOX',
        webhookToken: 'wh_e36_secret',
      },
    }
  );
  assert.equal(saveAsaasRes.status, 200);

  const clientA = await prisma.client.create({
    data: {
      company: { connect: { id: companyA.id } },
      name: `Aluno E36 ${suffix}`,
      city: 'Jataí - GO',
      sequenceNumber: `SEQ-${suffix}`,
      bookStatus: 'SOLD',
    },
  });
  createdClientIds.push(clientA.id);

  // Contrato 1 (5 parcelas de R$ 100,00 = R$ 500,00) + cobranças Asaas + registro Serasa ativo para validar baixa na quitação
  const sale1 = await prisma.sale.create({
    data: {
      companyId: companyA.id,
      sellerId: sellerA.id,
      clientId: clientA.id,
      product: 'Book E36 Lote',
      value: 500,
      paymentMethod: 'CREDIT',
      city: 'Jataí - GO',
    },
  });

  const agreement1 = await prisma.creditAgreement.create({
    data: {
      saleId: sale1.id,
      clientId: clientA.id,
      sellerId: sellerA.id,
      companyId: companyA.id,
      buyerName: 'Responsável Lote E36',
      buyerCpf: '52998224725',
      street: 'Rua das Flores',
      number: '100',
      neighborhood: 'Centro',
      city: 'Jataí',
      state: 'GO',
      totalSaleCents: 50000,
      downPaymentCents: 0,
      financedPrincipalCents: 50000,
      remainingPrincipalCents: 50000,
      paidPrincipalCents: 0,
      installmentsCount: 5,
      periodicity: 'MONTHLY',
      firstDueDate: new Date('2026-12-10T12:00:00.000Z'),
      status: 'ACTIVE',
      installmentCommissionRate: 0.1,
    },
  });

  const insts1: any[] = [];
  for (let n = 1; n <= 5; n++) {
    const due = new Date(Date.UTC(2026, 11, 10 + n * 10, 12, 0, 0));
    const inst = await prisma.creditInstallment.create({
      data: {
        agreementId: agreement1.id,
        installmentNumber: n,
        dueDate: due,
        amountCents: 10000,
        principalCents: 10000,
        status: n === 1 ? 'OVERDUE' : 'PENDING',
      },
    });
    await prisma.asaasCharge.create({
      data: {
        companyId: companyA.id,
        agreementId: agreement1.id,
        installmentId: inst.id,
        externalId: `pay_e36_batch_${n}_${suffix}`,
        customerExternalId: `cus_e36_${suffix}`,
        billingType: 'BOLETO',
        status: n === 1 ? 'OVERDUE' : 'PENDING',
        nominalValueCents: 10000,
        dueDate: due,
        bankSlipUrl: `https://sandbox.asaas.com/b/pdf/pay_e36_batch_${n}`,
      },
    });
    insts1.push(inst);
  }

  // Negativação Serasa ativa para validar cancelamento automático ao quitar todas
  const dunningExtId = `dun_e36_${suffix}`;
  await prisma.creditNegativationRecord.create({
    data: {
      companyId: companyA.id,
      agreementId: agreement1.id,
      installmentId: insts1[0].id,
      environment: 'SANDBOX',
      bureau: 'SERASA',
      status: 'NEGATIVACAO_CONFIRMADA',
      externalNegativationId: dunningExtId,
      overdueAmountCents: 10000,
      lumoraVerifiedBalanceCents: 50000,
      requestReason: 'Teste automático Etapa 36',
      requestedByUserId: adminA.id,
      requestedByName: adminA.name,
      idempotencyKey: `neg_e36_${suffix}`,
    },
  });

  // 2a. RBAC e Multi-tenant em /payments/batch (SELLER=403, PHOTOGRAPHER=403, cross-tenant=403)
  const batchBySeller = await apiJson(
    baseUrl,
    `/api/credit/agreements/${agreement1.id}/payments/batch`,
    {
      method: 'POST',
      token: sellerAToken,
      body: { installmentIds: [insts1[0].id] },
    }
  );
  assert.equal(batchBySeller.status, 403);

  const batchByPhoto = await apiJson(
    baseUrl,
    `/api/credit/agreements/${agreement1.id}/payments/batch`,
    {
      method: 'POST',
      token: photoAToken,
      body: { installmentIds: [insts1[0].id] },
    }
  );
  assert.equal(batchByPhoto.status, 403);

  const batchCrossTenant = await apiJson(
    baseUrl,
    `/api/credit/agreements/${agreement1.id}/payments/batch`,
    {
      method: 'POST',
      token: adminBToken,
      body: { installmentIds: [insts1[0].id] },
    }
  );
  assert.equal(batchCrossTenant.status, 403);

  // 2b. Baixa em lote de 3 de 5 parcelas (#2, #4, #5) -> comissão de 10% sobre cada + 3x receiveInCash
  mockAsaasCalls.length = 0;
  const batch3Res = await apiJson(
    baseUrl,
    `/api/credit/agreements/${agreement1.id}/payments/batch`,
    {
      method: 'POST',
      token: adminAToken,
      body: {
        installmentIds: [insts1[1].id, insts1[3].id, insts1[4].id],
        paymentMethod: 'PIX',
        paidAt: '2026-11-26T14:00:00.000Z',
        notes: 'Baixa seletiva de 3 boletos',
      },
    }
  );
  assert.equal(batch3Res.status, 201);
  assert.equal(batch3Res.json?.paidCount, 3);
  assert.equal(batch3Res.json?.amountCents, 30000);
  assert.equal(batch3Res.json?.remainingPrincipalCents, 20000);
  assert.equal(batch3Res.json?.isSettled, false);
  assert.equal(batch3Res.json?.commissionGeneratedCents, 3000); // 10% de R$ 300 = R$ 30,00
  assert.equal(batch3Res.json?.asaasSync?.synced, true);
  assert.equal(batch3Res.json?.asaasSync?.syncedCount, 3);

  const commsAfterBatch3 = await prisma.creditCommission.findMany({
    where: { agreementId: agreement1.id, isReversed: false },
  });
  assert.equal(commsAfterBatch3.length, 3, 'Deve gerar 1 comissão de 10% por parcela paga');
  assert.ok(commsAfterBatch3.every((c) => c.amountCents === 1000));

  for (const n of [2, 4, 5]) {
    const extId = `pay_e36_batch_${n}_${suffix}`;
    const call = mockAsaasCalls.find(
      (c) => c.method === 'POST' && c.url === `/v3/payments/${extId}/receiveInCash`
    );
    assert.ok(call, `Deve disparar POST /v3/payments/${extId}/receiveInCash`);
    const chg = await prisma.asaasCharge.findUnique({ where: { externalId: extId } });
    assert.equal(chg?.status, 'RECEIVED_IN_CASH');
  }

  // Valida que mistura com parcela já paga falha antes de gravar (HTTP 400)
  const invalidMixedBatch = await apiJson(
    baseUrl,
    `/api/credit/agreements/${agreement1.id}/payments/batch`,
    {
      method: 'POST',
      token: adminAToken,
      body: { installmentIds: [insts1[0].id, insts1[1].id] },
    }
  );
  assert.equal(invalidMixedBatch.status, 400);

  // 2c. Baixa das parcelas restantes (#1 e #3) -> quita contrato (SETTLED) + cancela negativação Serasa
  mockAsaasCalls.length = 0;
  const batchSettleRes = await apiJson(
    baseUrl,
    `/api/credit/agreements/${agreement1.id}/payments/batch`,
    {
      method: 'POST',
      token: adminAToken,
      body: {
        installmentIds: [insts1[0].id, insts1[2].id],
        paymentMethod: 'CASH',
      },
    }
  );
  assert.equal(batchSettleRes.status, 201);
  assert.equal(batchSettleRes.json?.isSettled, true);
  assert.equal(batchSettleRes.json?.remainingPrincipalCents, 0);

  const settledAgreement = await prisma.creditAgreement.findUnique({
    where: { id: agreement1.id },
  });
  assert.equal(settledAgreement?.status, 'SETTLED');

  const serasaCancelCall = mockAsaasCalls.find(
    (c) => c.method === 'POST' && c.url === `/v3/paymentDunnings/${dunningExtId}/cancel`
  );
  assert.ok(serasaCancelCall, 'Quitação total no lote deve acionar baixa automática Serasa');

  // ═══════════════════════════════════════════════════════════════════════════
  // PARTE 3: EDIÇÃO DE VENCIMENTO/VALOR DE PARCELA + PUT /v3/payments/{id}
  // ═══════════════════════════════════════════════════════════════════════════

  const sale2 = await prisma.sale.create({
    data: {
      companyId: companyA.id,
      sellerId: sellerA.id,
      clientId: clientA.id,
      product: 'Book E36 Edição',
      value: 200,
      paymentMethod: 'CREDIT',
      city: 'Jataí - GO',
    },
  });

  const agreement2 = await prisma.creditAgreement.create({
    data: {
      saleId: sale2.id,
      clientId: clientA.id,
      sellerId: sellerA.id,
      companyId: companyA.id,
      buyerName: 'Responsável Edição E36',
      buyerCpf: '52998224725',
      street: 'Av. Goiás',
      number: '50',
      neighborhood: 'Centro',
      city: 'Jataí',
      state: 'GO',
      totalSaleCents: 20000,
      downPaymentCents: 0,
      financedPrincipalCents: 20000,
      remainingPrincipalCents: 20000,
      paidPrincipalCents: 0,
      installmentsCount: 2,
      periodicity: 'MONTHLY',
      firstDueDate: new Date('2026-12-20T12:00:00.000Z'),
      status: 'ACTIVE',
      installmentCommissionRate: 0.1,
    },
  });

  const editInst1 = await prisma.creditInstallment.create({
    data: {
      agreementId: agreement2.id,
      installmentNumber: 1,
      dueDate: new Date('2026-12-20T12:00:00.000Z'),
      amountCents: 10000,
      principalCents: 10000,
      status: 'OVERDUE',
    },
  });
  const editInst2 = await prisma.creditInstallment.create({
    data: {
      agreementId: agreement2.id,
      installmentNumber: 2,
      dueDate: new Date('2027-01-20T12:00:00.000Z'),
      amountCents: 10000,
      principalCents: 10000,
      status: 'PENDING',
    },
  });

  const editChargeExtId = `pay_e36_edit_${suffix}`;
  await prisma.asaasCharge.create({
    data: {
      companyId: companyA.id,
      agreementId: agreement2.id,
      installmentId: editInst1.id,
      externalId: editChargeExtId,
      customerExternalId: `cus_e36_${suffix}`,
      billingType: 'BOLETO',
      status: 'OVERDUE',
      nominalValueCents: 10000,
      dueDate: new Date('2026-12-20T12:00:00.000Z'),
      bankSlipUrl: `https://sandbox.asaas.com/b/pdf/${editChargeExtId}`,
    },
  });

  // RBAC e Cross-tenant na edição (SELLER=403, PHOTOGRAPHER=403, Empresa B=403)
  assert.equal(
    (
      await apiJson(
        baseUrl,
        `/api/credit/agreements/${agreement2.id}/installments/${editInst1.id}`,
        { method: 'PUT', token: sellerAToken, body: { amountCents: 12000 } }
      )
    ).status,
    403
  );
  assert.equal(
    (
      await apiJson(
        baseUrl,
        `/api/credit/agreements/${agreement2.id}/installments/${editInst1.id}`,
        { method: 'PUT', token: photoAToken, body: { amountCents: 12000 } }
      )
    ).status,
    403
  );
  assert.equal(
    (
      await apiJson(
        baseUrl,
        `/api/credit/agreements/${agreement2.id}/installments/${editInst1.id}`,
        { method: 'PUT', token: adminBToken, body: { amountCents: 12000 } }
      )
    ).status,
    403
  );

  // Mínimo de 500 centavos quando há boleto Asaas aberto
  const belowMinRes = await apiJson(
    baseUrl,
    `/api/credit/agreements/${agreement2.id}/installments/${editInst1.id}`,
    { method: 'PUT', token: adminAToken, body: { amountCents: 450 } }
  );
  assert.equal(belowMinRes.status, 400);

  // Edição válida: vence 2027-02-15 e valor R$ 145,00 -> recalcula saldo devedor e dispara PUT /v3/payments/{id}
  mockAsaasCalls.length = 0;
  const editOkRes = await apiJson(
    baseUrl,
    `/api/credit/agreements/${agreement2.id}/installments/${editInst1.id}`,
    {
      method: 'PUT',
      token: adminAToken,
      body: {
        dueDate: '2027-02-15',
        amountCents: 14500,
        notes: 'Prorrogação acordada com cliente',
      },
    }
  );
  assert.equal(editOkRes.status, 200);
  assert.equal(editOkRes.json?.installment?.amountCents, 14500);
  assert.equal(editOkRes.json?.agreement?.remainingPrincipalCents, 24500);
  assert.equal(editOkRes.json?.asaasSync?.synced, true);

  const putAsaasCall = mockAsaasCalls.find(
    (c) => c.method === 'PUT' && c.url === `/v3/payments/${editChargeExtId}`
  );
  assert.ok(putAsaasCall, 'Deve chamar PUT /v3/payments/{id} no mock Asaas');
  assert.equal(putAsaasCall.body?.dueDate, '2027-02-15');
  assert.equal(putAsaasCall.body?.value, 145);

  const reloadedEditCharge = await prisma.asaasCharge.findUnique({
    where: { externalId: editChargeExtId },
  });
  assert.equal(reloadedEditCharge?.nominalValueCents, 14500);
  assert.equal(reloadedEditCharge?.status, 'PENDING');

  const auditUpdated = await prisma.operationalAuditEvent.findFirst({
    where: {
      companyId: companyA.id,
      action: 'CREDIT_INSTALLMENT_UPDATED',
      entityId: editInst1.id,
    },
  });
  assert.ok(auditUpdated, 'Deve gravar OperationalAuditEvent CREDIT_INSTALLMENT_UPDATED');

  // Liquida editInst1 via batch e confirma bloqueio HTTP 400 ao tentar editar parcela PAID
  const payEdit1Res = await apiJson(
    baseUrl,
    `/api/credit/agreements/${agreement2.id}/payments/batch`,
    {
      method: 'POST',
      token: adminAToken,
      body: { installmentIds: [editInst1.id] },
    }
  );
  assert.equal(payEdit1Res.status, 201);

  const blockedEditPaidRes = await apiJson(
    baseUrl,
    `/api/credit/agreements/${agreement2.id}/installments/${editInst1.id}`,
    {
      method: 'PUT',
      token: adminAToken,
      body: { dueDate: '2027-03-01', amountCents: 15000 },
    }
  );
  assert.equal(blockedEditPaidRes.status, 400);
  assert.equal(blockedEditPaidRes.json?.code, 'INSTALLMENT_ALREADY_PAID');
});
