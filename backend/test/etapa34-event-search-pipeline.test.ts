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
  formatDateBrt,
  addDaysToDateIso,
  normalizeEventSearchConfigValues,
} from '../src/services/eventSearchConfigService';
import eventsRoutes, {
  cityScoutCache,
  clearCompanyCityScoutCache,
  setEventSearchAiClientOverrideForTests,
} from '../src/routes/events';
import superadminRoutes from '../src/routes/superadmin';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'lumora_etapa34_test_jwt_secret_99887766';
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

test('Etapa 34: Datas em BRT (-03:00) e preservação integral de prompts > 4000 caracteres sem truncamento', () => {
  // 01:30 UTC de 2026-11-25 corresponde a 22:30 BRT de 2026-11-24
  const lateNightBrt = new Date('2026-11-25T01:30:00.000Z');
  assert.equal(formatDateBrt(lateNightBrt), '2026-11-24');

  // 03:05 UTC de 2026-11-25 corresponde a 00:05 BRT de 2026-11-25
  const earlyMorningBrt = new Date('2026-11-25T03:05:00.000Z');
  assert.equal(formatDateBrt(earlyMorningBrt), '2026-11-25');

  const longDescription =
    'Diretriz comercial detalhada de prospecção fotográfica itinerante. '.repeat(75);
  const cfg = normalizeEventSearchConfigValues({
    ...DEFAULT_EVENT_SEARCH_CONFIG,
    searchDescription: longDescription,
    horizonDays: 45,
    exclusions: [
      ...DEFAULT_EVENT_SEARCH_CONFIG.exclusions,
      {
        id: 'sentinela_final',
        text: 'EXCLUSAO_SENTINELA_FINAL_INTACTA_APOS_4000_CHARS',
      },
    ],
  });

  const promptCity = buildRenderedEventPrompt(cfg, {
    mode: 'CITY',
    city: 'Rio Verde - GO',
    referenceDate: lateNightBrt,
  });

  assert.ok(promptCity.length > 5000, `Prompt deveria ter > 5000 chars, teve ${promptCity.length}`);
  assert.ok(promptCity.includes('Hoje é dia 2026-11-24'));
  assert.ok(promptCity.includes('entre 2026-11-24 e 2027-01-08 (horizonte de 45 dias)'));
  assert.ok(promptCity.includes('EXCLUSAO_SENTINELA_FINAL_INTACTA_APOS_4000_CHARS'));
  assert.ok(promptCity.includes('startDate (YYYY-MM-DD), endDate (YYYY-MM-DD)'));

  const promptRadar = buildRenderedEventPrompt(cfg, {
    mode: 'STATE_RADAR',
    stateUF: 'GO',
    referenceDate: lateNightBrt,
  });
  assert.ok(promptRadar.length > 5000);
  assert.ok(promptRadar.includes('EXCLUSAO_SENTINELA_FINAL_INTACTA_APOS_4000_CHARS'));
  assert.ok(promptRadar.includes('2026-11-24 e 2027-01-08'));
});

test('Etapa 34: Pipeline 2 passos, groundingMetadata real, pós-filtro determinístico, cache sanitizado, force=true, contrato unificado STATE_RADAR e ApiUsageLog (tokens 2 passos + ERROR)', async () => {
  const baseUrl = await getBaseUrl;
  const suffix = randomUUID().slice(0, 8);
  const passwordHash = await bcrypt.hash('Lumora34Test!', 6);

  const company = await prisma.company.create({
    data: {
      name: `Empresa Pipeline E34 ${suffix}`,
      tradeName: 'Foto E34',
      status: 'ACTIVE',
      isActive: true,
    },
  });
  createdCompanyIds.push(company.id);

  const superAdmin = await prisma.user.create({
    data: {
      name: 'SuperAdmin E34',
      email: `sa.e34.${suffix}@lumora.test`,
      password: passwordHash,
      role: 'SUPER_ADMIN',
      companyId: null,
    },
  });
  createdUserIds.push(superAdmin.id);

  const admin = await prisma.user.create({
    data: {
      name: 'Admin E34',
      email: `admin.e34.${suffix}@lumora.test`,
      password: passwordHash,
      role: 'ADMIN',
      companyId: company.id,
    },
  });
  createdUserIds.push(admin.id);

  const saToken = signUserToken(superAdmin);
  const adminToken = signUserToken(admin);

  // 1. Trava COMPANY_GEMINI_KEY_REQUIRED (403) preservada sem chave exclusiva
  const blockedRes = await apiJson(baseUrl, '/api/events/search', {
    method: 'POST',
    token: adminToken,
    body: { city: 'Rio Verde - GO' },
  });
  assert.equal(blockedRes.status, 403);
  assert.equal(blockedRes.json?.code, 'COMPANY_GEMINI_KEY_REQUIRED');

  // Cadastrar chave Gemini exclusiva no Vault
  const saveKey = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${company.id}/integrations/gemini`,
    {
      method: 'PUT',
      token: saToken,
      body: { apiKey: 'AIzaSyEtapa34PipelineTwoStepKey1234567' },
    }
  );
  assert.equal(saveKey.status, 200);

  // Configurar regras estritas: horizonDays=60, minDurationDays=3, maxDurationDays=10, allowSingleDayIfLarge=false, cacheTtlDays=5
  const cfgPut = await apiJson(baseUrl, '/api/events/search-config', {
    method: 'PUT',
    token: adminToken,
    body: {
      searchDescription: 'Buscar exposições e festas confirmadas para venda fotográfica.',
      horizonDays: 60,
      priorityWeekdays: ['QUI', 'SEX', 'SAB', 'DOM'],
      includeHolidays: true,
      minDurationDays: 3,
      maxDurationDays: 10,
      allowSingleDayIfLarge: false,
      maxResultsPerSearch: 15,
      cacheTtlDays: 5,
      eventTypes: [
        { id: 'expo', name: 'Exposição Agropecuária', detail: 'Rodeios e feiras', enabled: true },
        { id: 'festa', name: 'Festa Tradicional', detail: 'Aniversário da cidade', enabled: true },
      ],
      exclusions: [{ id: 'no_past', text: 'Eventos encerrados' }],
    },
  });
  assert.equal(cfgPut.status, 200);

  // 2. Verificar modo mock de STATE_RADAR: NUNCA retorna { cities }, SEMPRE { events, cached, fetchedAt, searchMeta }
  const mockRadarCheck = await apiJson(baseUrl, '/api/events/state-radar?state=MT&force=true', {
    token: adminToken,
  });
  assert.equal(mockRadarCheck.status, 200);
  assert.ok(Array.isArray(mockRadarCheck.json?.events));
  assert.equal('cities' in mockRadarCheck.json, false);
  assert.ok(mockRadarCheck.json?.fetchedAt);
  assert.ok(mockRadarCheck.json?.searchMeta);

  // Limpar logs iniciais do mock antes de testar o pipeline real de 2 passos
  await prisma.apiUsageLog.deleteMany({ where: { companyId: company.id } });

  const todayBrt = formatDateBrt();
  const validStart1 = addDaysToDateIso(todayBrt, 10);
  const validEnd1 = addDaysToDateIso(todayBrt, 15); // 6 dias (válido: entre 3 e 10)
  const validStart2 = addDaysToDateIso(todayBrt, 20);
  const validEnd2 = addDaysToDateIso(todayBrt, 23); // 4 dias (válido: entre 3 e 10)
  const expiredStart = addDaysToDateIso(todayBrt, -10);
  const expiredEnd = addDaysToDateIso(todayBrt, -2); // vencido!
  const beyondHorizonStart = addDaysToDateIso(todayBrt, 90); // > 60 dias!
  const beyondHorizonEnd = addDaysToDateIso(todayBrt, 94);
  const tooShortDate = addDaysToDateIso(todayBrt, 12); // 1 dia (inválido: minDuration=3 e allowSingleDayIfLarge=false)
  const tooLongStart = addDaysToDateIso(todayBrt, 15);
  const tooLongEnd = addDaysToDateIso(todayBrt, 30); // 16 dias (> maxDuration=10)

  const recordedCalls: any[] = [];
  let modeBehavior: 'NORMAL' | 'BAD_JSON_STEP2' | 'PROVIDER_TIMEOUT' = 'NORMAL';

  setEventSearchAiClientOverrideForTests(() => ({
    models: {
      async generateContent(params: any) {
        recordedCalls.push(params);
        const hasGoogleSearch = Array.isArray(params?.config?.tools) &&
          params.config.tools.some((t: any) => Boolean(t?.googleSearch));

        if (modeBehavior === 'PROVIDER_TIMEOUT') {
          const timeoutErr: any = new Error('AI_TIMEOUT');
          timeoutErr.name = 'AbortError';
          throw timeoutErr;
        }

        if (hasGoogleSearch) {
          // PASSO 1: Pesquisa Web Grounded
          return {
            text: `Dossiê pesquisado para eventos em ${todayBrt}: Expo Rio Verde confirmada no Sympla e Festa do Milho tradicional.`,
            candidates: [
              {
                groundingMetadata: {
                  webSearchQueries: ['expo rio verde go programação oficial sympla'],
                  groundingChunks: [
                    {
                      web: {
                        uri: 'https://www.sympla.com.br/evento/expo-rio-verde-oficial/778899',
                        title: 'Expo Rio Verde Oficial - Ingressos Sympla',
                      },
                    },
                    {
                      web: {
                        uri: 'https://cidades.ibge.gov.br/brasil/go/rio-verde/panorama',
                        title: 'IBGE Cidades - Rio Verde GO',
                      },
                    },
                  ],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 310,
              candidatesTokenCount: 420,
              totalTokenCount: 730,
            },
          };
        }

        // PASSO 2: Extração Estruturada JSON (sem tools)
        if (modeBehavior === 'BAD_JSON_STEP2') {
          return {
            text: '{ json_truncado_invalido: [',
            usageMetadata: {
              promptTokenCount: 290,
              candidatesTokenCount: 110,
              totalTokenCount: 400,
            },
          };
        }

        const isRadarPrompt = String(params?.contents || '').includes('Estado alvo (UF)');
        if (isRadarPrompt) {
          return {
            text: JSON.stringify({
              state: 'GO',
              events: [
                {
                  name: 'Expo Rio Verde Oficial',
                  category: 'Exposição Agropecuária',
                  city: 'Rio Verde - GO',
                  state: 'GO',
                  location: 'Parque Agropecuário de Rio Verde',
                  startDate: validStart1,
                  endDate: validEnd1,
                  durationDays: 99, // IA errou o número, mas o pós-filtro deve recalcular para 6!
                  estimatedAudience: '45.000 pessoas',
                  ticketPrice: 'R$ 40,00 (Pista)',
                  entryType: 'PAID',
                  sourceIndex: 1,
                  sourceUrl: 'https://www.sympla.com.br/evento/expo-rio-verde-oficial/778899',
                  sourcePlatform: 'Sympla',
                  score: 'HIGH',
                  organizer: 'Sindicato Rural de Rio Verde',
                  organizerContact: '(64) 3621-0000',
                  socialMedia: '@exporioverde',
                  population: '235.647',
                  perCapitaIncome: 'R$ 68.400',
                  gdp: 'R$ 16,2 bi',
                  notes: 'Grande concentração familiar.',
                },
                {
                  name: 'Evento Já Encerrado Radar',
                  category: 'Show',
                  city: 'Jataí - GO',
                  startDate: expiredStart,
                  endDate: expiredEnd,
                  durationDays: 9,
                },
              ],
            }),
            usageMetadata: {
              promptTokenCount: 450,
              candidatesTokenCount: 250,
              totalTokenCount: 700,
            },
          };
        }

        return {
          text: JSON.stringify({
            cityInfo: {
              name: 'Rio Verde - GO',
              state: 'GO',
              summary: 'Polo forte do agronegócio goiano com calendário intenso.',
              population: '235.647 hab.',
              perCapitaIncome: 'R$ 68.400/ano',
              rendaDomiciliarPerCapitaMedia: 'R$ 2.850/mês',
              gdp: 'R$ 16,2 bilhões',
              economicActivities: 'Agronegócio, agroindústria e comércio',
              principaisFestasFixas: 'Expo Rio Verde (Julho) e Aniversário em Agosto',
              cityAge: '176 anos',
            },
            events: [
              {
                name: 'Expo Rio Verde Oficial',
                category: 'Exposição Agropecuária',
                city: 'Rio Verde - GO',
                state: 'GO',
                location: 'Parque de Exposições',
                startDate: validStart1,
                endDate: validEnd1,
                durationDays: 99, // Deve ser recalculado deterministicamente para 6 dias!
                estimatedAudience: '50.000 pessoas',
                ticketPrice: 'R$ 50,00',
                entryType: 'PAID',
                sourceIndex: 1,
                sourceUrl: 'https://www.sympla.com.br/evento/expo-rio-verde-oficial/778899',
                sourcePlatform: 'Sympla',
                sources: ['https://www.sympla.com.br/evento/expo-rio-verde-oficial/778899'],
                score: 'HIGH',
                organizer: 'Sindicato Rural',
                organizerContact: '(64) 3621-1111',
                socialMedia: '@exporioverde',
                notes: 'Confirmado via bilheteria oficial.',
              },
              {
                // Duplicado normalizado do evento acima (deve ser removido)
                name: '  expo rio verde oficial! ',
                category: 'Exposição Agropecuária',
                city: 'rio verde - go',
                startDate: validStart1,
                endDate: validEnd1,
                durationDays: 6,
              },
              {
                // Evento válido porém SEM URL respaldada em groundingChunks -> UNVERIFIED_ESTIMATE
                name: 'Festival Gastronômico Regional',
                category: 'Festa Tradicional',
                city: 'Rio Verde - GO',
                location: 'Praça Central',
                startDate: validStart2,
                endDate: validEnd2,
                durationDays: 4,
                estimatedAudience: '8.000 pessoas',
                ticketPrice: 'Entrada Franca',
                entryType: 'FREE',
                sourceUrl: 'https://portal-nao-presente-no-grounding.org/festival',
                score: 'MEDIUM',
                organizer: 'Associação Comercial',
                organizerContact: '(64) 99999-2222',
              },
              {
                name: 'Show Passado Vencido',
                category: 'Show',
                city: 'Rio Verde - GO',
                startDate: expiredStart,
                endDate: expiredEnd,
                durationDays: 9,
              },
              {
                name: 'Feira Muito Distante Fora Horizonte',
                category: 'Exposição Agropecuária',
                city: 'Rio Verde - GO',
                startDate: beyondHorizonStart,
                endDate: beyondHorizonEnd,
                durationDays: 5,
              },
              {
                name: 'Encontro Rápido 1 Dia',
                category: 'Show',
                city: 'Rio Verde - GO',
                startDate: tooShortDate,
                endDate: tooShortDate,
                durationDays: 1,
              },
              {
                name: 'Temporada Muito Longa 16 Dias',
                category: 'Festa Tradicional',
                city: 'Rio Verde - GO',
                startDate: tooLongStart,
                endDate: tooLongEnd,
                durationDays: 16,
              },
            ],
          }),
          usageMetadata: {
            promptTokenCount: 540,
            candidatesTokenCount: 260,
            totalTokenCount: 800,
          },
        };
      },
    },
  }));

  // 3. Executar busca por cidade em 2 passos
  const cityName = `Rio Verde E34 ${suffix}`;
  const searchRes = await apiJson(baseUrl, '/api/events/search', {
    method: 'POST',
    token: adminToken,
    body: { city: cityName },
  });
  assert.equal(searchRes.status, 200);
  assert.equal(searchRes.json?.cached, false);
  assert.equal(searchRes.json?.source, 'EXTERNAL');
  assert.ok(searchRes.json?.fetchedAt);

  // Confirmar que foram feitas exatamente 2 chamadas ao Gemini (Passo 1 Grounded + Passo 2 Structured JSON)
  assert.equal(recordedCalls.length, 2);
  assert.deepEqual(recordedCalls[0].config.tools, [{ googleSearch: {} }]);
  assert.deepEqual(recordedCalls[0].config.thinkingConfig, { thinkingBudget: 0 });
  assert.equal(recordedCalls[0].config.responseSchema, undefined);

  assert.equal(recordedCalls[1].config.tools, undefined);
  assert.equal(recordedCalls[1].config.responseMimeType, 'application/json');
  assert.ok(recordedCalls[1].config.responseSchema);
  assert.deepEqual(recordedCalls[1].config.thinkingConfig, { thinkingBudget: 0 });
  assert.ok(
    String(recordedCalls[1].contents).includes(
      'https://www.sympla.com.br/evento/expo-rio-verde-oficial/778899'
    ),
    'Passo 2 deve receber as URLs reais extraídas dos groundingChunks do Passo 1'
  );

  // Validar eventos filtrados deterministicamente (apenas 2 válidos de 7 brutos!)
  const events = searchRes.json.events;
  assert.equal(events.length, 2);

  const evVerified = events[0];
  assert.equal(evVerified.name, 'Expo Rio Verde Oficial');
  assert.equal(evVerified.durationDays, 6, 'Deve recalcular durationDays exato (6 em vez de 99)');
  assert.equal(evVerified.verificationStatus, 'VERIFIED_SOURCE');
  assert.equal(evVerified.confidenceLevel, 'HIGH');
  assert.equal(evVerified.sourcePlatform, 'Sympla');
  assert.equal(evVerified.sourceUrl, 'https://www.sympla.com.br/evento/expo-rio-verde-oficial/778899');
  assert.equal(evVerified.audience, '50.000 pessoas');
  assert.equal(evVerified.estimatedAudience, '50.000 pessoas');
  assert.equal(evVerified.ticketPrice, 'R$ 50,00');

  const evUnverified = events[1];
  assert.equal(evUnverified.name, 'Festival Gastronômico Regional');
  assert.equal(evUnverified.durationDays, 4);
  assert.equal(
    evUnverified.verificationStatus,
    'UNVERIFIED_ESTIMATE',
    'URL não presente nos groundingChunks reais não pode receber VERIFIED_SOURCE'
  );

  // Validar diagnósticos de filtro determinístico e metadados de grounding
  const diag = searchRes.json.searchMeta.diagnostics;
  assert.equal(diag.rawCount, 7);
  assert.equal(diag.keptCount, 2);
  assert.equal(diag.filteredOutExpired, 1);
  assert.equal(diag.filteredOutHorizon, 1);
  assert.equal(diag.filteredOutDuration, 2);
  assert.equal(diag.filteredOutDuplicates, 1);
  assert.equal(searchRes.json.searchMeta.grounded, true);
  assert.equal(searchRes.json.searchMeta.groundingSourcesCount, 2);

  // Validar cityInfo completo e sem N/A
  assert.equal(searchRes.json.cityInfo.population, '235.647 hab.');
  assert.equal(searchRes.json.cityInfo.perCapitaIncome, 'R$ 68.400/ano');
  assert.equal(searchRes.json.cityInfo.rendaPerCapita, 'R$ 68.400/ano');
  assert.equal(searchRes.json.cityInfo.gdp, 'R$ 16,2 bilhões');
  assert.ok(String(searchRes.json.cityInfo.aiSource).includes('Google Search Grounding'));

  // Validar soma dos tokens dos 2 passos gravada no ApiUsageLog (310+540=850, 420+260=680, 730+800=1530)
  const cityLogs = await prisma.apiUsageLog.findMany({
    where: { companyId: company.id, operation: 'EVENTS_SEARCH' },
  });
  assert.equal(cityLogs.length, 1);
  assert.equal(cityLogs[0].status, 'SUCCESS');
  assert.equal(cityLogs[0].promptTokens, 850);
  assert.equal(cityLogs[0].outputTokens, 680);
  assert.equal(cityLogs[0].totalTokens, 1530);

  // 4. Sanitização determinística ao ler de cityScoutCache (remove evento que venceu após gravação)
  const cacheEntryKey = Array.from(cityScoutCache.keys()).find((k) =>
    k.includes(`:${company.id}:`)
  )!;
  assert.ok(cacheEntryKey);
  const storedCache = cityScoutCache.get(cacheEntryKey)!;
  storedCache.data.events.push({
    name: 'Evento Que Expirou Ontem No Cache',
    category: 'Show',
    city: cityName,
    startDate: expiredStart,
    endDate: expiredEnd,
    durationDays: 5,
  });

  const cachedRead = await apiJson(baseUrl, '/api/events/search', {
    method: 'POST',
    token: adminToken,
    body: { city: cityName },
  });
  assert.equal(cachedRead.status, 200);
  assert.equal(cachedRead.json?.cached, true);
  assert.equal(cachedRead.json?.source, 'CACHE');
  assert.equal(
    cachedRead.json?.events.length,
    2,
    'Leitura do cityScoutCache deve remover deterministicamente eventos vencidos'
  );
  assert.equal(recordedCalls.length, 2, 'Leitura em cache não deve chamar provedor');

  // 5. force: true ignora cache e faz nova busca ao vivo
  const forcedCitySearch = await apiJson(baseUrl, '/api/events/search', {
    method: 'POST',
    token: adminToken,
    body: { city: cityName, force: true },
  });
  assert.equal(forcedCitySearch.status, 200);
  assert.equal(forcedCitySearch.json?.cached, false);
  assert.equal(forcedCitySearch.json?.source, 'EXTERNAL');
  assert.equal(recordedCalls.length, 4, 'force=true deve disparar os 2 passos novamente');

  // 6. STATE_RADAR em 2 passos + sanitização de cache legado { cities } + bloqueio de cache vencido em erro/force
  const radarLive = await apiJson(baseUrl, '/api/events/state-radar?state=GO', {
    token: adminToken,
  });
  assert.equal(radarLive.status, 200);
  assert.equal(radarLive.json?.cached, false);
  assert.equal('cities' in radarLive.json, false);
  assert.equal(radarLive.json?.events.length, 1);
  assert.equal(radarLive.json?.events[0].name, 'Expo Rio Verde Oficial');
  assert.equal(radarLive.json?.events[0].durationDays, 6);
  assert.equal(radarLive.json?.events[0].verificationStatus, 'VERIFIED_SOURCE');

  // Injetar evento vencido no StateRadarCache do banco e confirmar que leitura em cache o descarta
  const radarRow = await prisma.stateRadarCache.findFirst({
    where: { state: { startsWith: `GO:${company.id}:` } },
  });
  assert.ok(radarRow);
  await prisma.stateRadarCache.update({
    where: { id: radarRow!.id },
    data: {
      data: {
        cities: [
          {
            city: 'Rio Verde - GO',
            events: [
              ...(radarLive.json.events || []),
              {
                name: 'Evento Vencido No Banco Radar',
                category: 'Show',
                city: 'Anápolis - GO',
                startDate: expiredStart,
                endDate: expiredEnd,
                durationDays: 5,
              },
            ],
          },
        ],
      } as any,
    },
  });

  const radarCachedSanitized = await apiJson(baseUrl, '/api/events/state-radar?state=GO', {
    token: adminToken,
  });
  assert.equal(radarCachedSanitized.status, 200);
  assert.equal(radarCachedSanitized.json?.cached, true);
  assert.equal('cities' in radarCachedSanitized.json, false, 'Nunca deve retornar { cities }');
  assert.equal(radarCachedSanitized.json?.events.length, 1);
  assert.equal(radarCachedSanitized.json?.events[0].name, 'Expo Rio Verde Oficial');

  // Quando force=true e ocorre timeout/erro na IA, NUNCA deve devolver cache como disfarce!
  modeBehavior = 'PROVIDER_TIMEOUT';
  const radarForcedTimeout = await apiJson(
    baseUrl,
    '/api/events/state-radar?state=GO&force=true',
    { token: adminToken }
  );
  assert.equal(
    radarForcedTimeout.status,
    504,
    'Com force=true em erro/timeout, nunca deve devolver cache antigo'
  );

  // Quando force=false mas o cache do banco já expirou o TTL (ex: 8 dias > cacheTtlDays=5), NUNCA deve devolver cache vencido!
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000);
  await prisma.$executeRaw`
    UPDATE "StateRadarCache"
    SET "updatedAt" = ${eightDaysAgo}
    WHERE "id" = ${radarRow!.id}
  `;

  const radarExpiredFallbackBlocked = await apiJson(
    baseUrl,
    '/api/events/state-radar?state=GO',
    { token: adminToken }
  );
  assert.equal(
    radarExpiredFallbackBlocked.status,
    504,
    'Com TTL expirado, o bloco catch nunca deve retornar cache vencido'
  );

  // 7. Falha de extração/parse no Passo 2 registra ERROR no ApiUsageLog com a soma dos tokens (310+290=600, 420+110=530, 730+400=1130)
  modeBehavior = 'BAD_JSON_STEP2';
  const badExtractCity = `CatalaoErroJson-${suffix}`;
  const badExtractRes = await apiJson(baseUrl, '/api/events/search', {
    method: 'POST',
    token: adminToken,
    body: { city: badExtractCity, force: true },
  });
  assert.equal(badExtractRes.status, 502);
  assert.equal(badExtractRes.json?.code, 'AI_EXTRACTION_FAILED');

  // Garantir que erro de extração NÃO gravou nada no cityScoutCache
  const pollutedKey = Array.from(cityScoutCache.keys()).find((k) =>
    k.startsWith(`${badExtractCity.toLowerCase()}:`)
  );
  assert.equal(pollutedKey, undefined);

  const errorLogs = await prisma.apiUsageLog.findMany({
    where: {
      companyId: company.id,
      operation: 'EVENTS_SEARCH',
      status: 'ERROR',
      httpStatus: 502,
    },
  });
  assert.equal(errorLogs.length, 1);
  assert.equal(errorLogs[0].promptTokens, 600);
  assert.equal(errorLogs[0].outputTokens, 530);
  assert.equal(errorLogs[0].totalTokens, 1130);
});
