import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { prisma, disconnectPrisma } from '../src/services/prisma';
import {
  DEFAULT_EVENT_SEARCH_CONFIG,
  buildRenderedEventPrompt,
  computeEventSearchConfigHash,
  normalizeEventSearchConfigValues,
} from '../src/services/eventSearchConfigService';
import eventsRoutes, { clearCompanyCityScoutCache } from '../src/routes/events';
import superadminRoutes from '../src/routes/superadmin';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'lumora_etapa29_test_jwt_secret_3344556677';
process.env.INTEGRATION_MASTER_KEY =
  process.env.INTEGRATION_MASTER_KEY ||
  'lumora_disposable_master_key_64hex_0123456789abcdef0123456789abcd';
process.env.EXTERNAL_SERVICES_DISABLED = 'true';

const app = express();
app.use(express.json());
app.use('/api/events', eventsRoutes);
app.use('/api/superadmin', superadminRoutes);

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
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  for (const cid of createdCompanyIds) {
    clearCompanyCityScoutCache(cid);
    await prisma.stateRadarCache.deleteMany({
      where: { state: { contains: `:${cid}:` } },
    });
  }

  if (createdCompanyIds.length > 0) {
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

test('Etapa 29: Motor dinâmico de busca Eventos IA, sincronia Admin <-> SuperAdmin, auditoria e RBAC', async () => {
  const baseUrl = await getBaseUrl;
  const suffix = randomUUID().slice(0, 8);
  const passwordHash = await bcrypt.hash('Lumora29Test!', 6);

  const companyA = await prisma.company.create({
    data: { name: `Empresa Eventos A ${suffix}`, status: 'ACTIVE', isActive: true },
  });
  createdCompanyIds.push(companyA.id);

  const companyB = await prisma.company.create({
    data: { name: `Empresa Eventos B ${suffix}`, status: 'ACTIVE', isActive: true },
  });
  createdCompanyIds.push(companyB.id);

  const superAdmin = await prisma.user.create({
    data: {
      name: 'SuperAdmin E29',
      email: `sa.e29.${suffix}@lumora.test`,
      password: passwordHash,
      role: 'SUPER_ADMIN',
      companyId: null,
    },
  });
  createdUserIds.push(superAdmin.id);

  const adminA = await prisma.user.create({
    data: {
      name: 'Admin A E29',
      email: `admin.a.e29.${suffix}@lumora.test`,
      password: passwordHash,
      role: 'ADMIN',
      companyId: companyA.id,
    },
  });
  createdUserIds.push(adminA.id);

  const sellerA = await prisma.user.create({
    data: {
      name: 'Seller A E29',
      email: `seller.a.e29.${suffix}@lumora.test`,
      password: passwordHash,
      role: 'SELLER',
      companyId: companyA.id,
    },
  });
  createdUserIds.push(sellerA.id);

  const photoA = await prisma.user.create({
    data: {
      name: 'Photo A E29',
      email: `photo.a.e29.${suffix}@lumora.test`,
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

  // 1. Sem chave Gemini exclusiva configurada -> busca bloqueada com COMPANY_GEMINI_KEY_REQUIRED (Etapa 25 preservada)
  const blockedSearch = await apiJson(baseUrl, '/api/events/search', {
    method: 'POST',
    token: adminAToken,
    body: { city: `Anapolis-${suffix}` },
  });
  assert.equal(blockedSearch.status, 403);
  assert.equal(blockedSearch.json?.code, 'COMPANY_GEMINI_KEY_REQUIRED');

  // Configurar chave Gemini exclusiva para Company A
  const setGemini = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${companyA.id}/integrations/gemini`,
    {
      method: 'PUT',
      token: saToken,
      body: { apiKey: 'AIzaSyEtapa29DynamicSearchKey123456' },
    }
  );
  assert.equal(setGemini.status, 200);

  // 2. Fallback canônico inicial em GET /api/events/search-config
  const defaultRes = await apiJson(baseUrl, '/api/events/search-config', {
    token: adminAToken,
  });
  assert.equal(defaultRes.status, 200);
  assert.equal(defaultRes.json?.isDefault, true);
  assert.equal(defaultRes.json?.horizonDays, DEFAULT_EVENT_SEARCH_CONFIG.horizonDays);
  assert.equal(defaultRes.json?.includeHolidays, true);
  assert.equal(
    defaultRes.json?.configHash,
    computeEventSearchConfigHash(normalizeEventSearchConfigValues(DEFAULT_EVENT_SEARCH_CONFIG))
  );
  assert.ok(String(defaultRes.json?.renderedPromptPreview).includes('Exposição Agropecuária'));

  // 3. RBAC: SELLER e PHOTOGRAPHER não podem ler nem editar configurações
  for (const forbiddenToken of [sellerAToken, photoAToken]) {
    const rGet = await apiJson(baseUrl, '/api/events/search-config', { token: forbiddenToken });
    assert.equal(rGet.status, 403);
    const rPut = await apiJson(baseUrl, '/api/events/search-config', {
      method: 'PUT',
      token: forbiddenToken,
      body: { horizonDays: 45 },
    });
    assert.equal(rPut.status, 403);
    const rReset = await apiJson(baseUrl, '/api/events/search-config/reset', {
      method: 'POST',
      token: forbiddenToken,
    });
    assert.equal(rReset.status, 403);
  }

  // Isolamento multi-tenant no Admin
  const crossTenantRes = await apiJson(
    baseUrl,
    `/api/events/search-config?companyId=${companyB.id}`,
    { token: adminAToken }
  );
  assert.equal(crossTenantRes.status, 403);

  const adminCallingSuperAdmin = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${companyA.id}/event-search-config`,
    { token: adminAToken }
  );
  assert.equal(adminCallingSuperAdmin.status, 403);

  // 4. Primeira busca usa configHash padrão e popula cache
  const cityTest = `RioVerdeE29-${suffix}`;
  const firstSearch = await apiJson(baseUrl, '/api/events/search', {
    method: 'POST',
    token: adminAToken,
    body: { city: cityTest },
  });
  assert.equal(firstSearch.status, 200);
  assert.equal(firstSearch.json?.cached, false);
  assert.equal(firstSearch.json?.configHash, defaultRes.json?.configHash);

  const cachedSearch = await apiJson(baseUrl, '/api/events/search', {
    method: 'POST',
    token: adminAToken,
    body: { city: cityTest },
  });
  assert.equal(cachedSearch.status, 200);
  assert.equal(cachedSearch.json?.cached, true);
  assert.equal(cachedSearch.json?.configHash, defaultRes.json?.configHash);

  // 5. Edição pelo Admin -> sincroniza com SuperAdmin + invalida cache imediatamente + altera prompt
  const adminPut = await apiJson(baseUrl, '/api/events/search-config', {
    method: 'PUT',
    token: adminAToken,
    body: {
      searchDescription: 'Focar em festivais escolares e feiras familiares de grande porte.',
      horizonDays: 60,
      priorityWeekdays: ['SEX', 'SAB', 'DOM'],
      includeHolidays: false,
      geographicFocus: 'Raio de 150 km da cidade-polo',
      eventTypes: [
        { id: 'circo', name: 'Circo', detail: 'Temporada infantil', enabled: true },
        { id: 'parque', name: 'Parque', detail: 'Pausado neste ciclo', enabled: false },
        { id: 'festa_junina', name: 'Festa Junina', detail: 'Eventos comunitários', enabled: true },
      ],
      exclusions: [
        { id: 'no_rave', text: 'Baladas noturnas e eventos adultos +18.' },
      ],
    },
  });
  assert.equal(adminPut.status, 200);
  assert.equal(adminPut.json?.isDefault, false);
  assert.equal(adminPut.json?.horizonDays, 60);
  assert.equal(adminPut.json?.includeHolidays, false);
  assert.notEqual(adminPut.json?.configHash, defaultRes.json?.configHash);

  const renderedCityPrompt = buildRenderedEventPrompt(adminPut.json, {
    mode: 'CITY',
    city: 'Goiania',
  });
  assert.ok(renderedCityPrompt.includes('horizonte de 60 dias'));
  assert.ok(renderedCityPrompt.includes('SEX, SAB, DOM'));
  assert.ok(renderedCityPrompt.includes('Não priorizar feriados isolados'));
  assert.ok(renderedCityPrompt.includes('Raio de 150 km'));
  assert.ok(renderedCityPrompt.includes('Festa Junina'));
  assert.ok(!renderedCityPrompt.includes('Pausado neste ciclo'));
  assert.ok(renderedCityPrompt.includes('Baladas noturnas'));

  // SuperAdmin lê a exata mesma config
  const saRead = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${companyA.id}/event-search-config`,
    { token: saToken }
  );
  assert.equal(saRead.status, 200);
  assert.equal(saRead.json?.configHash, adminPut.json?.configHash);
  assert.equal(saRead.json?.horizonDays, 60);

  // Próxima busca NÃO usa cache antigo, e já retorna novo configHash
  const searchAfterAdminEdit = await apiJson(baseUrl, '/api/events/search', {
    method: 'POST',
    token: adminAToken,
    body: { city: cityTest },
  });
  assert.equal(searchAfterAdminEdit.status, 200);
  assert.equal(searchAfterAdminEdit.json?.cached, false);
  assert.equal(searchAfterAdminEdit.json?.configHash, adminPut.json?.configHash);

  // Radar Estadual também usa configHash e popula/invalida cache
  const radar1 = await apiJson(baseUrl, '/api/events/state-radar?state=GO', {
    token: adminAToken,
  });
  assert.equal(radar1.status, 200);
  assert.equal(radar1.json?.cached, false);
  assert.equal(radar1.json?.configHash, adminPut.json?.configHash);

  const radar2 = await apiJson(baseUrl, '/api/events/state-radar?state=GO', {
    token: adminAToken,
  });
  assert.equal(radar2.status, 200);
  assert.equal(radar2.json?.cached, true);

  // 6. SuperAdmin edita -> Admin enxerga imediatamente e invalida radar
  const saPut = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${companyA.id}/event-search-config`,
    {
      method: 'PUT',
      token: saToken,
      body: {
        searchDescription: adminPut.json.searchDescription,
        horizonDays: 90,
        priorityWeekdays: ['SAB', 'DOM'],
        includeHolidays: true,
        geographicFocus: 'Centro-Oeste',
        eventTypes: adminPut.json.eventTypes,
        exclusions: adminPut.json.exclusions,
      },
    }
  );
  assert.equal(saPut.status, 200);
  assert.equal(saPut.json?.horizonDays, 90);
  assert.notEqual(saPut.json?.configHash, adminPut.json?.configHash);

  const adminReadsSaEdit = await apiJson(baseUrl, '/api/events/search-config', {
    token: adminAToken,
  });
  assert.equal(adminReadsSaEdit.status, 200);
  assert.equal(adminReadsSaEdit.json?.horizonDays, 90);
  assert.equal(adminReadsSaEdit.json?.configHash, saPut.json?.configHash);

  const radarAfterSaEdit = await apiJson(baseUrl, '/api/events/state-radar?state=GO', {
    token: adminAToken,
  });
  assert.equal(radarAfterSaEdit.status, 200);
  assert.equal(radarAfterSaEdit.json?.cached, false);
  assert.equal(radarAfterSaEdit.json?.configHash, saPut.json?.configHash);

  // 7. Reset restaura padrão Lumora e grava OperationalAuditEvent
  const resetRes = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${companyA.id}/event-search-config/reset`,
    { method: 'POST', token: saToken }
  );
  assert.equal(resetRes.status, 200);
  assert.equal(resetRes.json?.isDefault, true);
  assert.equal(resetRes.json?.configHash, defaultRes.json?.configHash);

  const auditEvents = await prisma.operationalAuditEvent.findMany({
    where: {
      companyId: companyA.id,
      entityType: 'COMPANY_EVENT_SEARCH_CONFIG',
    },
    orderBy: { createdAt: 'asc' },
  });
  assert.ok(auditEvents.some((e) => e.action === 'EVENT_SEARCH_CONFIG_UPDATED'));
  assert.ok(auditEvents.some((e) => e.action === 'EVENT_SEARCH_CONFIG_RESET'));

  // Telemetria ApiUsageLog da Etapa 27 preservada durante buscas reais/mockadas
  const usageCount = await prisma.apiUsageLog.count({
    where: { companyId: companyA.id, provider: 'GEMINI' },
  });
  assert.ok(usageCount >= 4);
});
