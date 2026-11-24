import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { prisma, disconnectPrisma } from '../src/services/prisma';
import { recordCompanyApiUsageLog, getCurrentYearMonthBrt } from '../src/services/apiUsageService';
import { syncAsaasCustomer } from '../src/services/asaasService';
import superadminRoutes from '../src/routes/superadmin';
import integrationsRoutes from '../src/routes/integrations';
import companyIntegrationsRoutes from '../src/routes/companyIntegrations';
import eventsRoutes from '../src/routes/events';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'lumora_etapa27_test_jwt_secret_1122334455';
const VALID_MASTER_KEY =
  process.env.INTEGRATION_MASTER_KEY && process.env.INTEGRATION_MASTER_KEY.length >= 32
    ? process.env.INTEGRATION_MASTER_KEY
    : 'lumora_disposable_master_key_64hex_0123456789abcdef0123456789abcd';
process.env.INTEGRATION_MASTER_KEY = VALID_MASTER_KEY;
process.env.EXTERNAL_SERVICES_DISABLED = 'true';

const app = express();
app.use(express.json());
app.use('/api/superadmin', superadminRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/company/integrations', companyIntegrationsRoutes);
app.use('/api/events', eventsRoutes);

const server = app.listen(0, '127.0.0.1');
const getBaseUrl = new Promise<string>((resolve) => {
  server.once('listening', () => {
    const port = (server.address() as AddressInfo).port;
    resolve(`http://127.0.0.1:${port}`);
  });
});

const createdCompanyIds: string[] = [];
const createdUserIds: string[] = [];

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
  process.env.INTEGRATION_MASTER_KEY = VALID_MASTER_KEY;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (createdCompanyIds.length > 0) {
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
    await prisma.asaasConfig.deleteMany({
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

test('Etapa 27: Vault 503 explícito, instrumentação de consumo Gemini/Asaas e RBAC multi-tenant', async () => {
  const baseUrl = await getBaseUrl;
  const suffix = randomUUID().slice(0, 8);
  const passwordHash = await bcrypt.hash('Lumora27Test!', 6);

  const companyA = await prisma.company.create({
    data: {
      name: `Empresa API A ${suffix}`,
      status: 'ACTIVE',
      isActive: true,
    },
  });
  createdCompanyIds.push(companyA.id);

  const companyB = await prisma.company.create({
    data: {
      name: `Empresa API B ${suffix}`,
      status: 'ACTIVE',
      isActive: true,
    },
  });
  createdCompanyIds.push(companyB.id);

  const superAdmin = await prisma.user.create({
    data: {
      name: 'SuperAdmin E27',
      email: `sa.e27.${suffix}@lumora.test`,
      password: passwordHash,
      role: 'SUPER_ADMIN',
      companyId: null,
    },
  });
  createdUserIds.push(superAdmin.id);

  const adminA = await prisma.user.create({
    data: {
      name: 'Admin A E27',
      email: `admin.a.${suffix}@lumora.test`,
      password: passwordHash,
      role: 'ADMIN',
      companyId: companyA.id,
    },
  });
  createdUserIds.push(adminA.id);

  const sellerA = await prisma.user.create({
    data: {
      name: 'Seller A E27',
      email: `seller.a.${suffix}@lumora.test`,
      password: passwordHash,
      role: 'SELLER',
      companyId: companyA.id,
    },
  });
  createdUserIds.push(sellerA.id);

  const photoA = await prisma.user.create({
    data: {
      name: 'Photographer A E27',
      email: `photo.a.${suffix}@lumora.test`,
      password: passwordHash,
      role: 'PHOTOGRAPHER',
      companyId: companyA.id,
    },
  });
  createdUserIds.push(photoA.id);

  const saToken = signUserToken(superAdmin);
  const adminAToken = signUserToken(adminA);
  const sellerAToken = signUserToken(sellerA);
  const photoAToken = signUserToken(photoA);

  // 1. Vault HTTP 503 quando INTEGRATION_MASTER_KEY está ausente ou curta
  try {
    delete process.env.INTEGRATION_MASTER_KEY;
    const missingSaveGemini = await apiJson(
      baseUrl,
      `/api/superadmin/companies/${companyA.id}/integrations/gemini`,
      {
        method: 'PUT',
        token: saToken,
        body: { apiKey: 'AIzaSyEtapa27VaultBlockedMissingKey1234' },
      }
    );
    assert.equal(missingSaveGemini.status, 503);
    assert.equal(missingSaveGemini.json?.code, 'VAULT_NOT_CONFIGURED');

    const missingSaveAsaas = await apiJson(
      baseUrl,
      `/api/superadmin/companies/${companyA.id}/integrations/asaas`,
      {
        method: 'PUT',
        token: saToken,
        body: { apiKey: '$aact_ytbl_missing_key_1234567890', environment: 'SANDBOX' },
      }
    );
    assert.equal(missingSaveAsaas.status, 503);
    assert.equal(missingSaveAsaas.json?.code, 'VAULT_NOT_CONFIGURED');

    process.env.INTEGRATION_MASTER_KEY = 'short_key_under_32_chars';
    const shortSaveGemini = await apiJson(
      baseUrl,
      `/api/superadmin/companies/${companyA.id}/integrations/gemini`,
      {
        method: 'PUT',
        token: saToken,
        body: { apiKey: 'AIzaSyEtapa27VaultBlockedShortKey1234' },
      }
    );
    assert.equal(shortSaveGemini.status, 503);
    assert.equal(shortSaveGemini.json?.code, 'VAULT_NOT_CONFIGURED');
  } finally {
    process.env.INTEGRATION_MASTER_KEY = VALID_MASTER_KEY;
  }

  // 2. Salvar chaves válidas com Vault configurado (AIza... e Asaas Sandbox)
  const saveGeminiOk = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${companyA.id}/integrations/gemini`,
    {
      method: 'PUT',
      token: saToken,
      body: { apiKey: 'AIzaSyEtapa27ValidKey1234567890abcd' },
    }
  );
  assert.equal(saveGeminiOk.status, 200);
  assert.equal(saveGeminiOk.json?.configured, true);

  const saveAsaasOk = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${companyA.id}/integrations/asaas`,
    {
      method: 'PUT',
      token: saToken,
      body: {
        apiKey: '$aact_ytbl_etapa27_valid_key_12345678',
        environment: 'SANDBOX',
        accountName: 'Conta Sandbox E27',
      },
    }
  );
  assert.equal(saveAsaasOk.status, 200);
  assert.equal(saveAsaasOk.json?.configured, true);

  // Testar descriptografia sem INTEGRATION_MASTER_KEY -> HTTP 503 VAULT_NOT_CONFIGURED nas rotas get/test
  try {
    delete process.env.INTEGRATION_MASTER_KEY;

    const getIntegs503 = await apiJson(
      baseUrl,
      `/api/superadmin/companies/${companyA.id}/integrations`,
      { token: saToken }
    );
    assert.equal(getIntegs503.status, 503);
    assert.equal(getIntegs503.json?.code, 'VAULT_NOT_CONFIGURED');

    const testGemini503 = await apiJson(
      baseUrl,
      `/api/superadmin/companies/${companyA.id}/integrations/gemini/test`,
      { method: 'POST', token: saToken }
    );
    assert.equal(testGemini503.status, 503);
    assert.equal(testGemini503.json?.code, 'VAULT_NOT_CONFIGURED');

    const testAsaas503 = await apiJson(
      baseUrl,
      `/api/superadmin/companies/${companyA.id}/integrations/asaas/test`,
      { method: 'POST', token: saToken, body: { environment: 'SANDBOX' } }
    );
    assert.equal(testAsaas503.status, 503);
    assert.equal(testAsaas503.json?.code, 'VAULT_NOT_CONFIGURED');
  } finally {
    process.env.INTEGRATION_MASTER_KEY = VALID_MASTER_KEY;
  }

  // 3. Testar conexão Gemini e Asaas + verificar logs gravados no ApiUsageLog
  const testGeminiOk = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${companyA.id}/integrations/gemini/test`,
    { method: 'POST', token: saToken }
  );
  assert.equal(testGeminiOk.status, 200);
  assert.equal(testGeminiOk.json?.success, true);

  const testAsaasOk = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${companyA.id}/integrations/asaas/test`,
    { method: 'POST', token: saToken, body: { environment: 'SANDBOX' } }
  );
  assert.equal(testAsaasOk.status, 200);
  assert.equal(testAsaasOk.json?.success, true);

  // Instrumentação Events Search (Gemini) e Customer Sync (Asaas)
  const searchRes = await apiJson(baseUrl, '/api/events/search', {
    method: 'POST',
    token: adminAToken,
    body: { city: `CidadeTesteE27-${suffix}`, force: true },
  });
  assert.equal(searchRes.status, 200);

  const radarRes = await apiJson(baseUrl, '/api/events/state-radar?state=GO&force=true', {
    token: adminAToken,
  });
  assert.equal(radarRes.status, 200);

  await syncAsaasCustomer(companyA.id, {
    name: 'Cliente Asaas Teste',
    cpfCnpj: '12345678909',
  });

  // Simular chamada Gemini com tokens reais (usageMetadata) e uma 429 RATE_LIMITED
  await recordCompanyApiUsageLog({
    companyId: companyA.id,
    provider: 'GEMINI',
    operation: 'EVENTS_SEARCH',
    status: 'SUCCESS',
    promptTokens: 120,
    outputTokens: 340,
    totalTokens: 460,
    httpStatus: 200,
  });
  await recordCompanyApiUsageLog({
    companyId: companyA.id,
    provider: 'GEMINI',
    operation: 'STATE_RADAR',
    status: 'RATE_LIMITED',
    httpStatus: 429,
  });
  await recordCompanyApiUsageLog({
    companyId: companyB.id,
    provider: 'GEMINI',
    operation: 'CONNECTION_TEST',
    status: 'SUCCESS',
    httpStatus: 200,
  });

  // 4. Atualizar metas mensais pelo SuperAdmin e conferir percentual proporcional
  const patchLimits = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${companyA.id}/api-usage-limits`,
    {
      method: 'PATCH',
      token: saToken,
      body: { geminiMonthlyLimitCalls: 10, asaasMonthlyLimitCalls: 20 },
    }
  );
  assert.equal(patchLimits.status, 200);
  assert.equal(patchLimits.json?.company?.geminiMonthlyLimitCalls, 10);
  assert.equal(patchLimits.json?.company?.asaasMonthlyLimitCalls, 20);

  const yearMonth = getCurrentYearMonthBrt();
  const saUsage = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${companyA.id}/api-usage?yearMonth=${yearMonth}`,
    { token: saToken }
  );
  assert.equal(saUsage.status, 200);
  assert.equal(saUsage.json?.companyId, companyA.id);
  assert.equal(saUsage.json?.geminiMonthlyLimitCalls, 10);
  assert.equal(saUsage.json?.asaasMonthlyLimitCalls, 20);

  const geminiStats = saUsage.json?.providers?.GEMINI;
  const asaasStats = saUsage.json?.providers?.ASAAS;
  // CONNECTION_TEST + EVENTS_SEARCH (search) + STATE_RADAR + EVENTS_SEARCH (with tokens) + STATE_RADAR (429) = 5
  assert.equal(geminiStats.usedCalls, 5);
  assert.equal(geminiStats.successCalls, 4);
  assert.equal(geminiStats.rateLimitedCalls, 1);
  assert.equal(geminiStats.errorCalls, 0);
  assert.equal(geminiStats.promptTokens, 120);
  assert.equal(geminiStats.outputTokens, 340);
  assert.equal(geminiStats.totalTokens, 460);
  assert.equal(geminiStats.usagePercent, 50);
  assert.ok(geminiStats.lastUsedAt);

  // CONNECTION_TEST + syncAsaasCustomer (GET check + POST create) = 3
  assert.equal(asaasStats.usedCalls, 3);
  assert.equal(asaasStats.successCalls, 3);
  assert.equal(asaasStats.usagePercent, 15);
  assert.ok(asaasStats.lastUsedAt);

  // 5. RBAC & Isolamento Multi-Tenant no endpoint Admin GET /api/integrations/usage
  const adminUsage = await apiJson(baseUrl, '/api/integrations/usage', {
    token: adminAToken,
  });
  assert.equal(adminUsage.status, 200);
  assert.equal(adminUsage.json?.companyId, companyA.id);
  assert.equal(adminUsage.json?.providers?.GEMINI?.usedCalls, 5);

  const adminCrossTenant = await apiJson(
    baseUrl,
    `/api/integrations/usage?companyId=${companyB.id}`,
    { token: adminAToken }
  );
  assert.equal(adminCrossTenant.status, 403);

  const sellerUsage = await apiJson(baseUrl, '/api/integrations/usage', {
    token: sellerAToken,
  });
  assert.equal(sellerUsage.status, 403);

  const photoUsage = await apiJson(baseUrl, '/api/integrations/usage', {
    token: photoAToken,
  });
  assert.equal(photoUsage.status, 403);

  const sellerLimitsAttempt = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${companyA.id}/api-usage-limits`,
    { method: 'PATCH', token: adminAToken, body: { geminiMonthlyLimitCalls: 999 } }
  );
  assert.equal(sellerLimitsAttempt.status, 403);
});
