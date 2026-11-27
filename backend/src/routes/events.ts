import { Router, Response } from 'express';
import { prisma } from '../services/prisma';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { isExternalServicesDisabled } from '../utils/externalServices';
import {
  resolveCompanyIntegration,
  recordApiUsage,
  checkCompanyApiBudget,
} from '../services/integrationResolver';
import { resolveExclusiveCompanyGeminiKey } from '../services/companyApiKeyService';
import {
  createGoogleGenAiClient,
  getGeminiClientOverrideForTests,
  isGeminiModelNotFoundError,
  listAvailableGeminiModels,
  persistCompanyGeminiModel,
  resolveActiveGeminiModel,
  GeminiModelDescriptor,
} from '../services/geminiModelService';
import { recordCompanyApiUsageLog } from '../services/apiUsageService';
import {
  getCompanyEventSearchConfig,
  upsertCompanyEventSearchConfig,
  resetCompanyEventSearchConfig,
  buildRenderedEventPrompt,
  formatDateBrt,
  addDaysToDateIso,
  EventSearchConfigValues,
} from '../services/eventSearchConfigService';
import {
  GenerativeAiModelsLike,
  EventSearchExtractionError,
  extractCleanJsonPayload,
  computeInclusiveDurationDays,
  applyDeterministicEventFilter,
  normalizeCanonicalCityInfo,
  sanitizeCachedCityPayload,
  sanitizeCachedStateRadarPayload,
  runTwoStepCityEventSearch,
  runTwoStepStateRadarSearch,
  DEFAULT_GEMINI_SEARCH_MODEL,
} from '../services/eventSearchPipelineService';
import { authorizeCompanyAdmin } from './companyIntegrations';
import {
  reserveApiQuota,
  confirmApiReservation,
  releaseApiReservation,
  markReservationPendingConfirmation,
  resolvePendingReservation,
  handleLateProviderResponse,
} from '../services/apiQuotaService';

const router = Router();

// Cache volátil em memória para Scout de Eventos por cidade (TTL: 24h)
export const cityScoutCache = new Map<string, { data: any; expiresAt: number }>();

export function clearCityScoutCache(city?: string): void {
  if (city) {
    const prefix = `${city.toLowerCase().trim()}:`;
    cityScoutCache.delete(city.toLowerCase().trim());
    for (const key of cityScoutCache.keys()) {
      if (key.startsWith(prefix)) {
        cityScoutCache.delete(key);
      }
    }
  } else {
    cityScoutCache.clear();
  }
}

export function clearCompanyCityScoutCache(companyId?: string | null): void {
  if (!companyId) {
    cityScoutCache.clear();
    return;
  }
  const marker = `:${companyId}:`;
  for (const key of cityScoutCache.keys()) {
    if (key.includes(marker)) {
      cityScoutCache.delete(key);
    }
  }
}


// Instanciação direta por chamada com resolução dinâmica por empresa
// Elimina fallback silencioso para a chave global quando a empresa não tem contratação ativa
let testAiClientOverride: ((apiKey: string) => GenerativeAiModelsLike) | null = null;

export function setEventSearchAiClientOverrideForTests(
  factory: ((apiKey: string) => GenerativeAiModelsLike) | null
): void {
  testAiClientOverride = factory;
}

function resolveAiClientFactory(): ((apiKey: string) => GenerativeAiModelsLike) | null {
  return testAiClientOverride || getGeminiClientOverrideForTests();
}

async function executeGeminiPipelineWithModelFallback<T>(params: {
  companyId?: string | null;
  apiKey: string;
  aiClient: GenerativeAiModelsLike;
  executor: (model: string) => Promise<T>;
}): Promise<T> {
  const { companyId, apiKey, aiClient, executor } = params;
  const resolution = await resolveActiveGeminiModel({
    companyId,
    apiKey,
    aiClient: aiClient as any,
  });

  let queue = [...resolution.candidates];
  let availableModels: GeminiModelDescriptor[] = [...resolution.availableModels];
  let discoveryExecuted = availableModels.length > 0;
  const tried: string[] = [];
  let lastErr: any = null;

  while (queue.length > 0) {
    const candidate = queue.shift()!;
    if (!candidate || tried.includes(candidate)) continue;
    tried.push(candidate);

    try {
      const output = await executor(candidate);
      if (companyId && (!resolution.fromSavedConfig || tried.length > 1)) {
        await persistCompanyGeminiModel(companyId, candidate, availableModels).catch(() => {});
      }
      return output;
    } catch (err: any) {
      lastErr = err;
      if (!isGeminiModelNotFoundError(err)) {
        throw err;
      }

      if (!discoveryExecuted) {
        discoveryExecuted = true;
        try {
          availableModels = await listAvailableGeminiModels({
            apiKey,
            aiClient: aiClient as any,
          });
          const discoveredIds = availableModels
            .map((d) => d.id)
            .filter((id) => !tried.includes(id));
          const remaining = queue.filter(
            (id) => !discoveredIds.includes(id) && !tried.includes(id)
          );
          queue = [...discoveredIds, ...remaining];
        } catch {
          // Mantém candidatos residuais de fallback
        }
      }
    }
  }

  throw lastErr || new Error('Nenhum modelo Gemini compatível disponível para executar a pesquisa.');
}

// Helper to robustly extract clean JSON from AI responses (even with conversational wrappers)
export function extractCleanJson(text: string): string {
  return extractCleanJsonPayload(text);
}

// Helper for exact duration calculation
export function computeExactDurationDays(
  startDateStr?: string,
  endDateStr?: string,
  providedDays?: any
): number {
  return computeInclusiveDurationDays(startDateStr || '', endDateStr || '', providedDays);
}

function buildMockDatesForConfig(cfg: EventSearchConfigValues): {
  todayBrt: string;
  windowEndBrt: string;
  startDate: string;
  endDate: string;
  durationDays: number;
} {
  const todayBrt = formatDateBrt();
  const windowEndBrt = addDaysToDateIso(todayBrt, cfg.horizonDays);
  const desiredDuration = Math.max(
    cfg.minDurationDays || 1,
    cfg.allowSingleDayIfLarge ? 4 : Math.max(2, cfg.minDurationDays || 2)
  );
  const cappedDuration =
    cfg.maxDurationDays !== null && cfg.maxDurationDays !== undefined
      ? Math.min(desiredDuration, cfg.maxDurationDays)
      : desiredDuration;
  const safeDuration = Math.max(1, Math.min(cappedDuration, Math.max(1, cfg.horizonDays)));
  const offsetDays = Math.max(1, Math.min(10, Math.max(0, cfg.horizonDays - safeDuration)));
  const startDate = addDaysToDateIso(todayBrt, offsetDays);
  const endDate = addDaysToDateIso(startDate, safeDuration - 1);
  return { todayBrt, windowEndBrt, startDate, endDate, durationDays: safeDuration };
}

/**
 * Executa uma operação assíncrona com timeout estrito via Promise.race e notificação via AbortSignal.
 * 
 * NOTA TÉCNICA SOBRE CANCELAMENTO:
 * O SDK @google/genai atualmente não expõe suporte nativo a AbortSignal em ai.models.generateContent.
 * Portanto, este wrapper garante o retorno com timeout rápido ao cliente HTTP (504 após timeoutMs),
 * rate limiting e limites estritos de payload, enquanto a promise em background é monitorada
 * com captura de erro silenciosa para evitar exceções não tratadas (unhandledRejection).
 * Para callbacks compatíveis com AbortSignal, o signal é repassado como parâmetro.
 */
export async function executeWithTimeout<T>(
  promiseFactory: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = 25000
): Promise<T> {
  const abortController = new AbortController();
  let timer: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        abortController.abort();
      } catch (_) {}
      const err: any = new Error('AI_TIMEOUT');
      err.name = 'AbortError';
      reject(err);
    }, timeoutMs);
  });

  const executionPromise = promiseFactory(abortController.signal);

  // Trata rejeições tardias da promise em segundo plano para evitar 'unhandledRejection'
  executionPromise.catch(() => {});

  try {
    return await Promise.race([executionPromise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }
}

// In-memory rate limiter per user/company for AI queries
const aiQueryRateMap = new Map<string, number[]>();
function checkAiRateLimit(key: string, maxPerHour: number = 60): boolean {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const timestamps = (aiQueryRateMap.get(key) || []).filter(t => t > oneHourAgo);
  if (timestamps.length >= maxPerHour) {
    return false;
  }
  timestamps.push(now);
  aiQueryRateMap.set(key, timestamps);
  return true;
}

function resolveAuthorizedEventConfigScope(req: AuthRequest, res: Response): string | null {
  const role = String(req.user?.role || '').toUpperCase();
  if (!['ADMIN', 'COMPANY_ADMIN', 'SUPER_ADMIN'].includes(role)) {
    res.status(403).json({
      error: 'Acesso restrito a administradores da empresa.',
    });
    return null;
  }

  const ownCompanyId = req.user?.companyId ? String(req.user.companyId) : '';
  const requestedCompanyId =
    typeof req.query.companyId === 'string'
      ? req.query.companyId.trim()
      : typeof req.body?.companyId === 'string'
        ? req.body.companyId.trim()
        : '';

  if (role !== 'SUPER_ADMIN') {
    if (!ownCompanyId) {
      res.status(403).json({ error: 'Empresa do usuário não identificada.' });
      return null;
    }
    if (requestedCompanyId && requestedCompanyId !== ownCompanyId) {
      res.status(403).json({
        error: 'Isolamento multi-tenant: proibido acessar configuração de outra empresa.',
      });
      return null;
    }
  }

  const targetCompanyId =
    role === 'SUPER_ADMIN' && requestedCompanyId ? requestedCompanyId : ownCompanyId;
  if (!targetCompanyId) {
    res.status(400).json({ error: 'companyId é obrigatório.' });
    return null;
  }
  return targetCompanyId;
}

// GET /api/events/search-config
router.get('/search-config', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = resolveAuthorizedEventConfigScope(req, res);
    if (!companyId) return;

    const config = await getCompanyEventSearchConfig(companyId);
    res.json(config);
  } catch (error: any) {
    if (error?.status) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error('Erro ao buscar configuração de Eventos IA:', error?.message || error);
    res.status(500).json({ error: 'Erro ao buscar configuração de busca de eventos.' });
  }
});

// PUT /api/events/search-config
router.put('/search-config', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = resolveAuthorizedEventConfigScope(req, res);
    if (!companyId) return;

    const updated = await upsertCompanyEventSearchConfig({
      companyId,
      payload: req.body || {},
      actorUserId: req.user!.id,
      actorName: req.user!.name || 'Admin',
      actorRole: String(req.user!.role || 'ADMIN'),
      ipAddress: req.ip || null,
    });

    clearCompanyCityScoutCache(companyId);
    await prisma.stateRadarCache.deleteMany({
      where: { state: { contains: `:${companyId}:` } },
    });

    res.json(updated);
  } catch (error: any) {
    if (error?.status) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error('Erro ao salvar configuração de Eventos IA:', error?.message || error);
    res.status(500).json({ error: 'Erro ao salvar configuração de busca de eventos.' });
  }
});

// POST /api/events/search-config/reset
router.post('/search-config/reset', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = resolveAuthorizedEventConfigScope(req, res);
    if (!companyId) return;

    const reset = await resetCompanyEventSearchConfig({
      companyId,
      actorUserId: req.user!.id,
      actorName: req.user!.name || 'Admin',
      actorRole: String(req.user!.role || 'ADMIN'),
      ipAddress: req.ip || null,
    });

    clearCompanyCityScoutCache(companyId);
    await prisma.stateRadarCache.deleteMany({
      where: { state: { contains: `:${companyId}:` } },
    });

    res.json(reset);
  } catch (error: any) {
    if (error?.status) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error('Erro ao restaurar padrão de Eventos IA:', error?.message || error);
    res.status(500).json({ error: 'Erro ao restaurar configuração padrão de eventos.' });
  }
});

// POST /api/events/search - Gemini AI Event Search
router.post('/search', authenticateToken, async (req: AuthRequest, res: Response) => {
  const callStart = Date.now();
  let reservationId: string | undefined;
  let providerDispatched = false;
  let providerResponded = false;
  let sanitizedCity = '';

  try {
    const { city } = req.body;
    const companyId = req.user?.companyId;

    if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }

    sanitizedCity = String(city || '').replace(/[\r\n\x00-\x1F]/g, ' ').trim().slice(0, 100);
    if (!sanitizedCity) {
      res.status(400).json({ error: 'Cidade não fornecida ou inválida.' });
      return;
    }

    const rateKey = `${req.user?.id || 'unknown'}_${companyId || 'global'}`;
    if (!checkAiRateLimit(rateKey, 60)) {
      res.status(429).json({ error: 'Limite de consultas de IA por hora excedido. Aguarde antes de tentar novamente.' });
      return;
    }

    const environment = String(
      req.headers['x-environment'] || req.query.environment || req.body?.environment || 'PRODUCTION'
    ).toUpperCase();
    const lowerCity = sanitizedCity.toLowerCase();
    const forceRefresh = req.query.force === 'true' || req.body?.force === true;

    // Resolução dinâmica de integração por empresa em tempo de execução
    let activeAiClient: GenerativeAiModelsLike | null = null;
    let resolvedApiKey = '';
    let resolvedIntegrationId: string | undefined = undefined;
    let providerName = 'GEMINI';
    const overrideFactory = resolveAiClientFactory();

    if (companyId) {
      const [exclusiveGemini, resolved] = await Promise.all([
        resolveExclusiveCompanyGeminiKey(companyId),
        resolveCompanyIntegration(companyId, 'AI_RESEARCH', environment),
      ]);
      if (resolved?.integration?.id) {
        resolvedIntegrationId = resolved.integration.id;
      }

      if (exclusiveGemini.configured && exclusiveGemini.key) {
        providerName = 'GEMINI';
        resolvedApiKey = exclusiveGemini.key;
        activeAiClient = createGoogleGenAiClient(exclusiveGemini.key, overrideFactory);
      } else {
        if (resolved?.provider === 'GROK' && resolved.status === 'ACTIVE') {
          res.status(501).json({
            error: 'Provedor Grok (xAI) configurado, mas o radar e pesquisa de eventos está disponível operacionalmente apenas via Gemini. Altere o provedor na Central para GEMINI.',
          });
          return;
        }
        const allowMockQuotaHarness =
          isExternalServicesDisabled() &&
          resolved?.integration?.status === 'ACTIVE' &&
          resolved?.provider === 'GEMINI' &&
          resolved?.integration?.credentialSource === 'NONE';

        if (!allowMockQuotaHarness) {
          res.status(403).json({
            error:
              'Chave Gemini exclusiva da empresa não configurada no SuperAdmin. Configure a chave própria da empresa em Integrações para utilizar Eventos IA.',
            code: 'COMPANY_GEMINI_KEY_REQUIRED',
          });
          return;
        }
        providerName = 'GEMINI';
      }
    } else if (req.user?.role === 'SUPER_ADMIN') {
      if (overrideFactory) {
        resolvedApiKey = process.env.GEMINI_API_KEY || 'superadmin_test_key';
        activeAiClient = overrideFactory(resolvedApiKey);
      } else if (process.env.GEMINI_API_KEY && !isExternalServicesDisabled()) {
        resolvedApiKey = process.env.GEMINI_API_KEY;
        activeAiClient = createGoogleGenAiClient(resolvedApiKey);
      }
    }

    // Configuração dinâmica da busca de Eventos IA por empresa
    const searchConfig = await getCompanyEventSearchConfig(companyId);
    const cacheKey = `${lowerCity}:${companyId || 'global'}:${searchConfig.configHash}`;
    const cacheTtlMs = Math.max(0, searchConfig.cacheTtlDays) * 24 * 3600 * 1000;

    // ── 1. Verificação de Cache do Scout por Cidade (com pós-filtro determinístico) ──
    const cachedEntry = cacheTtlMs > 0 ? cityScoutCache.get(cacheKey) : undefined;
    if (cachedEntry && cachedEntry.expiresAt <= Date.now()) {
      cityScoutCache.delete(cacheKey);
    } else if (cachedEntry && cachedEntry.expiresAt > Date.now() && !forceRefresh) {
      const sanitizedCache = sanitizeCachedCityPayload(cachedEntry.data, searchConfig);
      if (sanitizedCache.hadAllEventsExpired) {
        cityScoutCache.delete(cacheKey);
      } else {
        if (companyId) {
          await recordApiUsage({
            companyId,
            integrationId: resolvedIntegrationId,
            category: 'AI_RESEARCH',
            provider: providerName,
            environment,
            operation: 'SCOUT_CITY_CACHE',
            unitsUsed: 1,
            status: 'SUCCESS',
            latencyMs: Date.now() - callStart,
          });
        }
        return res.json({
          ...sanitizedCache.payload,
          configHash: searchConfig.configHash,
          cacheTtlDays: searchConfig.cacheTtlDays,
          source: 'CACHE',
          cached: true,
        });
      }
    }

    // ── 2. Reserva atômica de cota antes de chamar o provedor externo ─────────
    if (companyId) {
      const reservation = await reserveApiQuota({
        companyId,
        category: 'AI_RESEARCH',
        provider: providerName,
        environment,
        integrationId: resolvedIntegrationId,
        operation: 'SCOUT_CITY_EXTERNAL',
        unitsRequested: 1,
        date: new Date(),
      });

      if (!reservation.allowed) {
        return res.status(429).json({
          error: reservation.message,
          limitType: reservation.limitType,
          currentUnits: reservation.currentUnits,
          unitsLimit: reservation.unitsLimit,
          currentSpentCents: reservation.currentSpentCents,
          budgetLimitCents: reservation.budgetLimitCents,
        });
      }
      reservationId = reservation.reservationId;
    }

    // Retorno mockado quando serviços externos estão desabilitados (sem override de teste) ou sem chave
    if ((isExternalServicesDisabled() && !overrideFactory) || !activeAiClient) {
      providerDispatched = true;

      const simulateTimeout =
        req.headers['x-mock-simulated-timeout'] === 'true' ||
        req.query.mockTimeout === 'true' ||
        req.body?.mockTimeout === true;

      const simulateInvalidContent =
        req.headers['x-mock-invalid-content'] === 'true' ||
        req.query.mockInvalidContent === 'true' ||
        req.body?.mockInvalidContent === true;

      if (simulateTimeout) {
        if (reservationId) {
          const currentResId = reservationId;
          const lateMs = Number(
            req.headers['x-mock-late-response-ms'] ||
            req.query.mockLateResponseMs ||
            req.body?.mockLateResponseMs ||
            0
          );
          const lateOutcome = String(
            req.headers['x-mock-late-outcome'] ||
            req.query.mockLateOutcome ||
            req.body?.mockLateOutcome ||
            'CONFIRMED'
          );
          const timeoutDelayMs = Number(
            req.headers['x-mock-timeout-delay-ms'] ||
            req.query.mockTimeoutDelayMs ||
            req.body?.mockTimeoutDelayMs ||
            0
          );
          const rawLateMeasuredCost =
            req.headers['x-mock-late-measured-cost-cents'] ??
            req.query.mockLateMeasuredCostCents ??
            req.body?.mockLateMeasuredCostCents;
          const lateMeasuredCostCents =
            rawLateMeasuredCost !== undefined && rawLateMeasuredCost !== ''
              ? Number(rawLateMeasuredCost)
              : undefined;

          if (lateMs > 0) {
            setTimeout(async () => {
              await handleLateProviderResponse({
                reservationId: currentResId,
                outcome: lateOutcome as any,
                measuredCostCents: lateMeasuredCostCents,
                reason: 'LATE_PROVIDER_RESPONSE_AUTO_CONFIRMED',
                resolvedByUserId: 'SYSTEM_LATE_RESPONSE',
                resolvedByName: 'Provedor Simulado (Retorno Tardio Automático)',
              });
            }, lateMs);
          }

          await markReservationPendingConfirmation(reservationId, {
            latencyMs: Date.now() - callStart,
            reason: 'TIMEOUT_AFTER_DISPATCH',
            delayMs: timeoutDelayMs,
          });
        }
        if (companyId) {
          await recordCompanyApiUsageLog({
            companyId,
            provider: 'GEMINI',
            operation: 'EVENTS_SEARCH',
            status: 'ERROR',
            httpStatus: 504,
          });
        }
        res.status(504).json({
          error:
            'Tempo limite esgotado ao aguardar resposta do provedor de IA. O consumo foi retido e está pendente de confirmação.',
          status: 'PENDING_CONFIRMATION',
          reservationId,
        });
        return;
      }

      providerResponded = true;

      if (reservationId) {
        await confirmApiReservation(reservationId, {
          status: 'SUCCESS',
          latencyMs: Date.now() - callStart,
        });
      }

      if (simulateInvalidContent) {
        console.error(`[EVENTS] Conteúdo degradado simulado para cidade "${sanitizedCity}".`);
        if (companyId) {
          await recordCompanyApiUsageLog({
            companyId,
            provider: 'GEMINI',
            operation: 'EVENTS_SEARCH',
            status: 'ERROR',
            httpStatus: 502,
          });
        }
        return res.status(200).json({
          cityInfo: normalizeCanonicalCityInfo(
            { name: sanitizedCity },
            sanitizedCity,
            formatDateBrt(),
            'Mock AI Service (Degraded Content)'
          ),
          events: [],
          fetchedAt: new Date().toISOString(),
          warning: 'Resposta do provedor recebida, porém com formatação degradada.',
          source: 'EXTERNAL',
          cached: false,
          preservedUnit: true,
          reservationId,
        });
      }

      if (companyId) {
        await recordCompanyApiUsageLog({
          companyId,
          provider: 'GEMINI',
          operation: 'EVENTS_SEARCH',
          status: 'SUCCESS',
          httpStatus: 200,
        });
      }

      const mockDates = buildMockDatesForConfig(searchConfig);
      const mockFiltered = applyDeterministicEventFilter(
        [
          {
            name: `Exposição Comercial de ${sanitizedCity}`,
            category: 'Exposição Agropecuária',
            startDate: mockDates.startDate,
            endDate: mockDates.endDate,
            durationDays: mockDates.durationDays,
            location: 'Parque de Exposições',
            city: sanitizedCity,
            estimatedAudience: '15.000 pessoas',
            ticketPrice: 'Entrada Franca',
            entryType: 'FREE',
            historicalData: 'Evento anual consolidado',
            organizer: 'Sindicato Rural',
            organizerContact: '(62) 99999-0000',
            socialMedia: '@expo_evento',
            sourcePlatform: 'Portal Oficial',
            score: 'HIGH',
            notes: 'Excelente oportunidade de vendas fotográficas',
            sources: ['Mock Local Fixture'],
          },
        ],
        searchConfig,
        { defaultCity: sanitizedCity }
      );

      const fetchedAt = new Date().toISOString();
      const mockResult = {
        cityInfo: normalizeCanonicalCityInfo(
          {
            name: sanitizedCity,
            summary: `Pesquisa comercial simulada para ${sanitizedCity}.`,
            searchDate: mockDates.todayBrt,
            population: '85.000 hab.',
            perCapitaIncome: 'R$ 38.500/ano',
            rendaDomiciliarPerCapitaMedia: 'R$ 1.950/mês',
            gdp: 'R$ 3,2 bilhões',
            economicActivities: 'Agronegócio, comércio e serviços',
            principaisFestasFixas: 'Exposição Agropecuária e Aniversário da Cidade',
            cityAge: '72 anos',
            aiSource: 'Mock AI Service (External Services Disabled)',
          },
          sanitizedCity,
          mockDates.todayBrt,
          'Mock AI Service (External Services Disabled)'
        ),
        events: mockFiltered.events,
        fetchedAt,
        searchMeta: {
          model: DEFAULT_GEMINI_SEARCH_MODEL,
          pipelineVersion: 'v2-two-step-grounded',
          referenceDateBrt: mockDates.todayBrt,
          windowEndDateBrt: mockDates.windowEndBrt,
          horizonDays: searchConfig.horizonDays,
          grounded: false,
          webSearchQueries: [],
          groundingSourcesCount: 0,
          groundingSources: [],
          diagnostics: mockFiltered.diagnostics,
          tokens: {
            step1Prompt: 0,
            step1Output: 0,
            step1Total: 0,
            step2Prompt: 0,
            step2Output: 0,
            step2Total: 0,
            promptTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
          },
        },
      };

      if (cacheTtlMs > 0) {
        cityScoutCache.set(cacheKey, {
          data: mockResult,
          expiresAt: Date.now() + cacheTtlMs,
        });
      }

      return res.json({
        ...mockResult,
        configHash: searchConfig.configHash,
        cacheTtlDays: searchConfig.cacheTtlDays,
        source: 'EXTERNAL',
        cached: false,
      });
    }

    providerDispatched = true;
    const currentResId = reservationId;

    try {
      const pipelineOut = await executeGeminiPipelineWithModelFallback({
        companyId,
        apiKey: resolvedApiKey,
        aiClient: activeAiClient,
        executor: (model) =>
          runTwoStepCityEventSearch({
            aiClient: activeAiClient!,
            city: sanitizedCity,
            config: searchConfig,
            model,
            onLateResponseAfterTimeout: async () => {
              if (currentResId) {
                await handleLateProviderResponse({
                  reservationId: currentResId,
                  outcome: 'CONFIRMED',
                  reason: 'LATE_PROVIDER_RESPONSE_AUTO_CONFIRMED',
                  resolvedByUserId: 'SYSTEM_LATE_RESPONSE',
                  resolvedByName: 'Provedor Externo (Resposta Tardia Automática)',
                });
              }
            },
          }),
      });

      providerResponded = true;

      if (companyId) {
        await recordCompanyApiUsageLog({
          companyId,
          provider: 'GEMINI',
          operation: 'EVENTS_SEARCH',
          status: 'SUCCESS',
          promptTokens: pipelineOut.searchMeta.tokens.promptTokens,
          outputTokens: pipelineOut.searchMeta.tokens.outputTokens,
          totalTokens: pipelineOut.searchMeta.tokens.totalTokens,
          httpStatus: 200,
        });
      }

      if (reservationId) {
        await confirmApiReservation(reservationId, {
          status: 'SUCCESS',
          latencyMs: Date.now() - callStart,
        });
      }

      try {
        if (cacheTtlMs > 0) {
          cityScoutCache.set(cacheKey, {
            data: pipelineOut,
            expiresAt: Date.now() + cacheTtlMs,
          });
        }
      } catch (cacheErr: any) {
        console.warn('[EVENTS] Erro ao gravar cache do Scout:', cacheErr?.message);
      }

      return res.json({
        ...pipelineOut,
        configHash: searchConfig.configHash,
        cacheTtlDays: searchConfig.cacheTtlDays,
        source: 'EXTERNAL',
        cached: false,
      });
    } catch (err: any) {
      if (err instanceof EventSearchExtractionError) {
        providerResponded = true;
        console.error(
          `[EVENTS] Falha de extração estruturada em POST /search (${sanitizedCity}):`,
          err.message,
          err.rawSnippet ? `| Trecho: ${err.rawSnippet}` : ''
        );

        if (reservationId) {
          await confirmApiReservation(reservationId, {
            status: 'SUCCESS',
            latencyMs: Date.now() - callStart,
            errorMessage: `EXTRACTION_ERROR: ${err.message}`,
          });
        }
        if (companyId) {
          await recordCompanyApiUsageLog({
            companyId,
            provider: 'GEMINI',
            operation: 'EVENTS_SEARCH',
            status: 'ERROR',
            promptTokens: err.tokens.promptTokens,
            outputTokens: err.tokens.outputTokens,
            totalTokens: err.tokens.totalTokens,
            httpStatus: 502,
          });
        }
        res.status(502).json({
          error:
            'Falha ao estruturar os eventos retornados pela IA. Nenhum dado inválido foi salvo em cache. Tente novamente.',
          code: err.code,
          preservedUnit: Boolean(reservationId),
          reservationId,
        });
        return;
      }

      const isTimeout =
        err?.name === 'AbortError' || err?.message === 'AI_TIMEOUT' || err?.code === 'ETIMEDOUT';
      if (reservationId && !providerResponded) {
        if (isTimeout || providerDispatched) {
          await markReservationPendingConfirmation(reservationId, {
            latencyMs: Date.now() - callStart,
            reason: 'TIMEOUT_AFTER_DISPATCH',
          });
        } else {
          await releaseApiReservation(reservationId, {
            reason: err?.message || 'OPERATION_FAILED_NO_QUOTA_CONSUMED',
          });
        }
      }

      if (isTimeout) {
        if (companyId) {
          await recordCompanyApiUsageLog({
            companyId,
            provider: 'GEMINI',
            operation: 'EVENTS_SEARCH',
            status: 'ERROR',
            httpStatus: 504,
          });
        }
        res.status(504).json({
          error:
            'Tempo limite esgotado ao aguardar resposta do provedor de IA. O consumo foi retido e está pendente de confirmação.',
          status: 'PENDING_CONFIRMATION',
          reservationId,
        });
        return;
      }

      if (err?.status === 429 || (err?.message && String(err.message).includes('429'))) {
        if (companyId) {
          await recordCompanyApiUsageLog({
            companyId,
            provider: 'GEMINI',
            operation: 'EVENTS_SEARCH',
            status: 'RATE_LIMITED',
            httpStatus: 429,
          });
        }
        res.status(429).json({
          error: 'Limite de requisições de IA atingido. Tente novamente mais tarde.',
        });
        return;
      }

      if (companyId && providerDispatched && !providerResponded) {
        await recordCompanyApiUsageLog({
          companyId,
          provider: 'GEMINI',
          operation: 'EVENTS_SEARCH',
          status: 'ERROR',
          httpStatus: typeof err?.status === 'number' ? err.status : 503,
        });
      }
      throw err;
    }
  } catch (error: any) {
    if (reservationId) {
      if (!providerResponded) {
        if (providerDispatched) {
          await markReservationPendingConfirmation(reservationId, {
            latencyMs: Date.now() - callStart,
            reason: error?.message || 'DISPATCHED_UNKNOWN_ERROR',
          });
        } else {
          await releaseApiReservation(reservationId, {
            reason: error?.message || 'PRE_DISPATCH_FAILURE',
          });
        }
      } else {
        // Se o provedor respondeu e houve erro ao ler o conteúdo ou salvar o cache, preserve a unidade consumida
        await confirmApiReservation(reservationId, {
          status: 'SUCCESS',
          latencyMs: Date.now() - callStart,
          errorMessage: `DOWNSTREAM_ERROR: ${error?.message || error}`,
        });
        return res.status(200).json({
          cityInfo: { name: sanitizedCity, warning: 'Operação concluída com degradação' },
          events: [],
          source: 'EXTERNAL',
          cached: false,
          preservedUnit: true,
          reservationId,
        });
      }
    }
    console.error('Erro na IA de Eventos:', error?.message || error);
    const errDetail = String(error?.message || '').trim();
    const isModelErr = isGeminiModelNotFoundError(error);
    res.status(isModelErr ? 502 : 503).json({ 
      error: isModelErr
        ? `Modelo Gemini indisponível para a chave configurada: ${errDetail}`
        : errDetail
          ? `Falha ao consultar Eventos IA: ${errDetail.slice(0, 220)}`
          : 'Servidor das IAs sobrecarregado ou indisponível. Aguarde um momento e tente novamente.',
    });
  }
});

// GET /api/events/state-radar
router.get('/state-radar', authenticateToken, async (req: AuthRequest, res: Response) => {
  const callStart = Date.now();
  let reservationId: string | undefined;
  let providerDispatched = false;
  let providerResponded = false;

  try {
    const { state } = req.query;
    const companyId = req.user?.companyId;

    if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }

    if (!state || typeof state !== 'string') {
      res.status(400).json({ error: 'Estado não fornecido. Use ?state=UF' });
      return;
    }

    const stateUF = state.toUpperCase().trim().slice(0, 2);
    const environment = String(
      req.headers['x-environment'] || req.query.environment || 'PRODUCTION'
    ).toUpperCase();

    let resultData: any = null;
    const forceRefresh = req.query.force === 'true';

    // Resolução dinâmica de integração por empresa
    let resolvedIntegrationId: string | undefined = undefined;
    let providerName = 'GEMINI';
    let activeAiClient: GenerativeAiModelsLike | null = null;
    let resolvedApiKey = '';
    const overrideFactory = resolveAiClientFactory();

    if (companyId) {
      const [exclusiveGemini, resolved] = await Promise.all([
        resolveExclusiveCompanyGeminiKey(companyId),
        resolveCompanyIntegration(companyId, 'AI_RESEARCH', environment),
      ]);
      if (resolved?.integration?.id) {
        resolvedIntegrationId = resolved.integration.id;
      }

      if (exclusiveGemini.configured && exclusiveGemini.key) {
        providerName = 'GEMINI';
        resolvedApiKey = exclusiveGemini.key;
        activeAiClient = createGoogleGenAiClient(exclusiveGemini.key, overrideFactory);
      } else {
        if (resolved?.provider === 'GROK' && resolved.status === 'ACTIVE') {
          res.status(501).json({
            error: 'Provedor Grok (xAI) configurado, mas o radar de eventos está disponível operacionalmente apenas via Gemini. Altere o provedor na Central para GEMINI.',
          });
          return;
        }
        const allowMockQuotaHarness =
          isExternalServicesDisabled() &&
          resolved?.integration?.status === 'ACTIVE' &&
          resolved?.provider === 'GEMINI' &&
          resolved?.integration?.credentialSource === 'NONE';

        if (!allowMockQuotaHarness) {
          res.status(403).json({
            error:
              'Chave Gemini exclusiva da empresa não configurada no SuperAdmin. Configure a chave própria da empresa em Integrações para utilizar Eventos IA.',
            code: 'COMPANY_GEMINI_KEY_REQUIRED',
          });
          return;
        }
        providerName = 'GEMINI';
      }
    } else if (req.user?.role === 'SUPER_ADMIN') {
      if (overrideFactory) {
        resolvedApiKey = process.env.GEMINI_API_KEY || 'superadmin_test_key';
        activeAiClient = overrideFactory(resolvedApiKey);
      } else if (process.env.GEMINI_API_KEY && !isExternalServicesDisabled()) {
        resolvedApiKey = process.env.GEMINI_API_KEY;
        activeAiClient = createGoogleGenAiClient(resolvedApiKey);
      }
    }

    const searchConfig = await getCompanyEventSearchConfig(companyId);
    const radarCacheKey = `${stateUF}:${companyId || 'global'}:${searchConfig.configHash.slice(0, 12)}`;

    // ── 1. Verificação de Cache do Radar Estadual (com pós-filtro determinístico) ──
    if (!forceRefresh && searchConfig.cacheTtlDays > 0) {
      const cached = await prisma.stateRadarCache.findUnique({
        where: { state: radarCacheKey },
      });
      if (cached) {
        const ageInDays = (Date.now() - cached.updatedAt.getTime()) / (1000 * 3600 * 24);
        if (ageInDays < searchConfig.cacheTtlDays) {
          const sanitized = sanitizeCachedStateRadarPayload(cached.data, stateUF, searchConfig);
          if (!sanitized.hadAllEventsExpired) {
            resultData = sanitized.payload;
          }
        }
      }
    }

    if (resultData) {
      if (companyId) {
        await recordApiUsage({
          companyId,
          integrationId: resolvedIntegrationId,
          category: 'AI_RESEARCH',
          provider: providerName,
          environment,
          operation: 'STATE_RADAR_CACHE',
          unitsUsed: 1,
          status: 'SUCCESS',
          latencyMs: Date.now() - callStart,
        });
      }
      return res.json({
        ...resultData,
        configHash: searchConfig.configHash,
        cacheTtlDays: searchConfig.cacheTtlDays,
        source: 'CACHE',
        cached: true,
      });
    }

    // ── 2. Reserva atômica de cota antes de chamar o provedor externo ─────────
    if (companyId) {
      const reservation = await reserveApiQuota({
        companyId,
        category: 'AI_RESEARCH',
        provider: providerName,
        environment,
        integrationId: resolvedIntegrationId,
        operation: 'STATE_RADAR_EXTERNAL',
        unitsRequested: 1,
        date: new Date(),
      });

      if (!reservation.allowed) {
        return res.status(429).json({
          error: reservation.message,
          limitType: reservation.limitType,
          currentUnits: reservation.currentUnits,
          unitsLimit: reservation.unitsLimit,
          currentSpentCents: reservation.currentSpentCents,
          budgetLimitCents: reservation.budgetLimitCents,
        });
      }
      reservationId = reservation.reservationId;
    }

    if ((isExternalServicesDisabled() && !overrideFactory) || !activeAiClient) {
      providerDispatched = true;

      const simulateTimeout =
        req.headers['x-mock-simulated-timeout'] === 'true' ||
        req.query.mockTimeout === 'true' ||
        req.body?.mockTimeout === true;

      const simulateInvalidContent =
        req.headers['x-mock-invalid-content'] === 'true' ||
        req.query.mockInvalidContent === 'true' ||
        req.body?.mockInvalidContent === true;

      if (simulateTimeout) {
        if (reservationId) {
          const currentResId = reservationId;
          const lateMs = Number(
            req.headers['x-mock-late-response-ms'] ||
            req.query.mockLateResponseMs ||
            req.body?.mockLateResponseMs ||
            0
          );
          const lateOutcome = String(
            req.headers['x-mock-late-outcome'] ||
            req.query.mockLateOutcome ||
            req.body?.mockLateOutcome ||
            'CONFIRMED'
          );
          const timeoutDelayMs = Number(
            req.headers['x-mock-timeout-delay-ms'] ||
            req.query.mockTimeoutDelayMs ||
            req.body?.mockTimeoutDelayMs ||
            0
          );
          const rawLateMeasuredCost =
            req.headers['x-mock-late-measured-cost-cents'] ??
            req.query.mockLateMeasuredCostCents ??
            req.body?.mockLateMeasuredCostCents;
          const lateMeasuredCostCents =
            rawLateMeasuredCost !== undefined && rawLateMeasuredCost !== ''
              ? Number(rawLateMeasuredCost)
              : undefined;

          if (lateMs > 0) {
            setTimeout(async () => {
              await handleLateProviderResponse({
                reservationId: currentResId,
                outcome: lateOutcome as any,
                measuredCostCents: lateMeasuredCostCents,
                reason: 'LATE_PROVIDER_RESPONSE_AUTO_CONFIRMED',
                resolvedByUserId: 'SYSTEM_LATE_RESPONSE',
                resolvedByName: 'Provedor Simulado (Retorno Tardio Automático)',
              });
            }, lateMs);
          }

          await markReservationPendingConfirmation(reservationId, {
            latencyMs: Date.now() - callStart,
            reason: 'TIMEOUT_AFTER_DISPATCH',
            delayMs: timeoutDelayMs,
          });
        }
        if (companyId) {
          await recordCompanyApiUsageLog({
            companyId,
            provider: 'GEMINI',
            operation: 'STATE_RADAR',
            status: 'ERROR',
            httpStatus: 504,
          });
        }
        return res.status(504).json({
          error:
            'Tempo limite esgotado ao aguardar resposta do provedor de IA. O consumo foi retido e está pendente de confirmação.',
          status: 'PENDING_CONFIRMATION',
          reservationId,
        });
      }

      providerResponded = true;

      if (reservationId) {
        await confirmApiReservation(reservationId, {
          status: 'SUCCESS',
          latencyMs: Date.now() - callStart,
        });
      }

      if (simulateInvalidContent) {
        console.error(`[EVENTS] Conteúdo degradado simulado no Radar Estadual (${stateUF}).`);
        if (companyId) {
          await recordCompanyApiUsageLog({
            companyId,
            provider: 'GEMINI',
            operation: 'STATE_RADAR',
            status: 'ERROR',
            httpStatus: 502,
          });
        }
        const nowIso = new Date().toISOString();
        return res.status(200).json({
          state: stateUF,
          updatedAt: nowIso,
          fetchedAt: nowIso,
          events: [],
          source: 'EXTERNAL',
          cached: false,
          preservedUnit: true,
          reservationId,
        });
      }

      if (companyId) {
        await recordCompanyApiUsageLog({
          companyId,
          provider: 'GEMINI',
          operation: 'STATE_RADAR',
          status: 'SUCCESS',
          httpStatus: 200,
        });
      }

      const mockDates = buildMockDatesForConfig(searchConfig);
      const mockCityName = stateUF === 'GO' ? 'Goiânia - GO' : `Capital - ${stateUF}`;
      const mockFiltered = applyDeterministicEventFilter(
        [
          {
            name: `Festa Regional de ${stateUF}`,
            category: 'Festival Cultural',
            startDate: mockDates.startDate,
            endDate: mockDates.endDate,
            durationDays: mockDates.durationDays,
            city: mockCityName,
            state: stateUF,
            location: 'Parque Central de Eventos',
            estimatedAudience: '20.000 pessoas',
            ticketPrice: 'Entrada Franca',
            entryType: 'FREE',
            organizerContact: '(62) 99999-0000',
            socialMedia: '@festaregional',
            sourcePlatform: 'Portal Oficial',
            population: '1.437.000',
            perCapitaIncome: 'R$ 42.000',
            gdp: 'R$ 59,8 bi',
            score: 'HIGH',
          },
        ],
        searchConfig,
        { defaultState: stateUF }
      );

      const fetchedAt = new Date().toISOString();
      const mockRadar = {
        state: stateUF,
        updatedAt: fetchedAt,
        fetchedAt,
        events: mockFiltered.events,
        searchMeta: {
          model: DEFAULT_GEMINI_SEARCH_MODEL,
          pipelineVersion: 'v2-two-step-grounded',
          referenceDateBrt: mockDates.todayBrt,
          windowEndDateBrt: mockDates.windowEndBrt,
          horizonDays: searchConfig.horizonDays,
          grounded: false,
          webSearchQueries: [],
          groundingSourcesCount: 0,
          groundingSources: [],
          diagnostics: mockFiltered.diagnostics,
          tokens: {
            step1Prompt: 0,
            step1Output: 0,
            step1Total: 0,
            step2Prompt: 0,
            step2Output: 0,
            step2Total: 0,
            promptTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
          },
        },
      };

      if (searchConfig.cacheTtlDays > 0) {
        await prisma.stateRadarCache.upsert({
          where: { state: radarCacheKey },
          update: { data: mockRadar as any, updatedAt: new Date() },
          create: { state: radarCacheKey, data: mockRadar as any },
        });
      }

      return res.json({
        ...mockRadar,
        configHash: searchConfig.configHash,
        cacheTtlDays: searchConfig.cacheTtlDays,
        source: 'EXTERNAL',
        cached: false,
      });
    }

    providerDispatched = true;
    const currentResId = reservationId;

    try {
      const radarOut = await executeGeminiPipelineWithModelFallback({
        companyId,
        apiKey: resolvedApiKey,
        aiClient: activeAiClient,
        executor: (model) =>
          runTwoStepStateRadarSearch({
            aiClient: activeAiClient!,
            stateUF,
            config: searchConfig,
            model,
            onLateResponseAfterTimeout: async () => {
              if (currentResId) {
                await handleLateProviderResponse({
                  reservationId: currentResId,
                  outcome: 'CONFIRMED',
                  reason: 'LATE_PROVIDER_RESPONSE_AUTO_CONFIRMED',
                  resolvedByUserId: 'SYSTEM_LATE_RESPONSE',
                  resolvedByName: 'Provedor Externo (Resposta Tardia Automática)',
                });
              }
            },
          }),
      });

      providerResponded = true;

      if (companyId) {
        await recordCompanyApiUsageLog({
          companyId,
          provider: 'GEMINI',
          operation: 'STATE_RADAR',
          status: 'SUCCESS',
          promptTokens: radarOut.searchMeta.tokens.promptTokens,
          outputTokens: radarOut.searchMeta.tokens.outputTokens,
          totalTokens: radarOut.searchMeta.tokens.totalTokens,
          httpStatus: 200,
        });
      }

      if (reservationId) {
        await confirmApiReservation(reservationId, {
          status: 'SUCCESS',
          latencyMs: Date.now() - callStart,
        });
      }

      if (searchConfig.cacheTtlDays > 0) {
        await prisma.stateRadarCache.upsert({
          where: { state: radarCacheKey },
          update: { data: radarOut as any, updatedAt: new Date() },
          create: { state: radarCacheKey, data: radarOut as any },
        });
      }

      return res.json({
        ...radarOut,
        configHash: searchConfig.configHash,
        cacheTtlDays: searchConfig.cacheTtlDays,
        source: 'EXTERNAL',
        cached: false,
      });
    } catch (err: any) {
      if (err instanceof EventSearchExtractionError) {
        providerResponded = true;
        console.error(
          `[EVENTS] Falha de extração estruturada em GET /state-radar (${stateUF}):`,
          err.message,
          err.rawSnippet ? `| Trecho: ${err.rawSnippet}` : ''
        );

        if (reservationId) {
          await confirmApiReservation(reservationId, {
            status: 'SUCCESS',
            latencyMs: Date.now() - callStart,
            errorMessage: `EXTRACTION_ERROR: ${err.message}`,
          });
        }
        if (companyId) {
          await recordCompanyApiUsageLog({
            companyId,
            provider: 'GEMINI',
            operation: 'STATE_RADAR',
            status: 'ERROR',
            promptTokens: err.tokens.promptTokens,
            outputTokens: err.tokens.outputTokens,
            totalTokens: err.tokens.totalTokens,
            httpStatus: 502,
          });
        }
        res.status(502).json({
          error:
            'Falha ao estruturar os eventos do radar retornados pela IA. Nenhum dado inválido foi salvo em cache.',
          code: err.code,
          preservedUnit: Boolean(reservationId),
          reservationId,
        });
        return;
      }

      const isTimeout =
        err?.name === 'AbortError' || err?.message === 'AI_TIMEOUT' || err?.code === 'ETIMEDOUT';
      if (reservationId && !providerResponded) {
        if (isTimeout || providerDispatched) {
          await markReservationPendingConfirmation(reservationId, {
            latencyMs: Date.now() - callStart,
            reason: 'TIMEOUT_AFTER_DISPATCH',
          });
        } else {
          await releaseApiReservation(reservationId, {
            reason: err?.message || 'OPERATION_FAILED_NO_QUOTA_CONSUMED',
          });
        }
      }

      const isRateLimited = err?.status === 429 || String(err?.message || '').includes('429');
      if (companyId) {
        await recordCompanyApiUsageLog({
          companyId,
          provider: 'GEMINI',
          operation: 'STATE_RADAR',
          status: isRateLimited ? 'RATE_LIMITED' : 'ERROR',
          httpStatus: isTimeout
            ? 504
            : isRateLimited
              ? 429
              : typeof err?.status === 'number'
                ? err.status
                : 503,
        });
      }

      // NUNCA devolver cache quando force=true ou quando o TTL (cacheTtlDays) já expirou
      if (!forceRefresh && searchConfig.cacheTtlDays > 0) {
        const fallbackCache = await prisma.stateRadarCache.findUnique({
          where: { state: radarCacheKey },
        });
        if (fallbackCache) {
          const ageInDays =
            (Date.now() - fallbackCache.updatedAt.getTime()) / (1000 * 3600 * 24);
          if (ageInDays < searchConfig.cacheTtlDays) {
            const sanitizedFallback = sanitizeCachedStateRadarPayload(
              fallbackCache.data,
              stateUF,
              searchConfig
            );
            if (!sanitizedFallback.hadAllEventsExpired) {
              return res.json({
                ...sanitizedFallback.payload,
                configHash: searchConfig.configHash,
                cacheTtlDays: searchConfig.cacheTtlDays,
                source: 'CACHE',
                cached: true,
              });
            }
          }
        }
      }

      if (isTimeout) {
        res.status(504).json({
          error:
            'Tempo limite esgotado ao aguardar resposta do provedor de IA. O consumo foi retido e está pendente de confirmação.',
          status: 'PENDING_CONFIRMATION',
          reservationId,
        });
        return;
      }
      if (isRateLimited) {
        res.status(429).json({ error: 'Limite de requisições de IA atingido no Radar.' });
        return;
      }
      if (isGeminiModelNotFoundError(err)) {
        res.status(502).json({
          error: `Modelo Gemini indisponível para a chave configurada: ${String(err?.message || 'NOT_FOUND')}`,
        });
        return;
      }
      res.status(503).json({
        error: err?.message
          ? `Falha ao consultar radar de eventos do estado: ${String(err.message).slice(0, 200)}`
          : 'Falha ao consultar radar de eventos do estado.',
      });
      return;
    }
  } catch (error: any) {
    if (reservationId) {
      if (!providerResponded) {
        if (providerDispatched) {
          await markReservationPendingConfirmation(reservationId, {
            latencyMs: Date.now() - callStart,
            reason: error?.message || 'DISPATCHED_UNKNOWN_ERROR',
          });
        } else {
          await releaseApiReservation(reservationId, {
            reason: error?.message || 'PRE_DISPATCH_FAILURE',
          });
        }
      } else {
        // Se o provedor respondeu, preserve a unidade consumida!
        await confirmApiReservation(reservationId, {
          status: 'SUCCESS',
          latencyMs: Date.now() - callStart,
          errorMessage: `DOWNSTREAM_ERROR: ${error?.message || error}`,
        });
      }
    }
    console.error('Erro no radar estadual:', error?.message || error);
    res.status(500).json({ error: 'Erro interno ao processar radar de eventos' });
  }
});

// Coordenadas conhecidas (Cidades-polo)
const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  'goiania': { lat: -16.6869, lng: -49.2648 },
  'aparecida de goiania': { lat: -16.8228, lng: -49.2469 },
  'anapolis': { lat: -16.3286, lng: -48.9534 },
  'rio verde': { lat: -17.7924, lng: -50.9189 },
  'jatai': { lat: -17.8814, lng: -51.7144 },
  'itumbiara': { lat: -18.4194, lng: -49.2158 },
  'caldas novas': { lat: -17.7441, lng: -48.6257 },
  'cuiaba': { lat: -15.6010, lng: -56.0979 },
  'varzea grande': { lat: -15.6469, lng: -56.1325 },
  'rondonopolis': { lat: -16.4677, lng: -54.6364 },
  'sinop': { lat: -11.8608, lng: -55.5094 },
  'sorriso': { lat: -12.5448, lng: -55.7208 },
  'lucas do rio verde': { lat: -13.0537, lng: -55.9128 },
  'primavera do leste': { lat: -15.5562, lng: -54.2964 },
  'barra do garcas': { lat: -15.8906, lng: -52.2569 },
  'campo grande': { lat: -20.4697, lng: -54.6201 },
  'dourados': { lat: -22.2231, lng: -54.8064 },
  'tres lagoas': { lat: -20.7851, lng: -51.7011 },
  'corumba': { lat: -19.0078, lng: -57.6533 },
  'ponta pora': { lat: -22.5361, lng: -55.7256 },
  'uberlandia': { lat: -18.9186, lng: -48.2772 },
  'uberaba': { lat: -19.7483, lng: -47.9319 },
  'patos de minas': { lat: -18.5789, lng: -46.5181 },
  'montes claros': { lat: -16.7281, lng: -43.8617 },
  'porto velho': { lat: -8.7619, lng: -63.9039 },
  'ji-parana': { lat: -10.8778, lng: -61.9511 },
  'ariquemes': { lat: -9.9133, lng: -63.0408 },
  'cacoal': { lat: -11.4386, lng: -61.4472 },
  'vilhena': { lat: -12.7414, lng: -60.1458 },
};

function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

// GET /api/events/smart-route
router.get('/smart-route', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }

    let prospects = await prisma.commercialEvent.findMany({
      where: { companyId, isProspect: true },
      orderBy: { startDate: 'asc' }
    });

    if (prospects.length === 0) {
      prospects = await prisma.commercialEvent.findMany({
        where: { companyId },
        orderBy: { startDate: 'asc' }
      });
    }

    if (prospects.length === 0) {
      res.json({
        routes: [],
        message: 'Nenhum prospecto cadastrado. Adicione eventos no Radar para gerar roteiros.'
      });
      return;
    }

    let filtered = prospects.filter(p => (p.durationDays ?? 10) >= 6);
    if (filtered.length === 0) filtered = prospects;

    const clusters: any[][] = [];
    const visited = new Set<string>();

    for (let i = 0; i < filtered.length; i++) {
      const p1 = filtered[i];
      if (visited.has(p1.id)) continue;

      const cluster = [p1];
      visited.add(p1.id);

      const cityKey1 = (p1.city || '').toLowerCase().trim();
      const coords1 = CITY_COORDS[cityKey1] || null;

      for (let j = i + 1; j < filtered.length; j++) {
        const p2 = filtered[j];
        if (visited.has(p2.id)) continue;

        const cityKey2 = (p2.city || '').toLowerCase().trim();
        const coords2 = CITY_COORDS[cityKey2] || null;

        if (coords1 && coords2) {
          const dist = haversineDistanceKm(coords1.lat, coords1.lng, coords2.lat, coords2.lng);
          if (dist <= 300) {
            cluster.push(p2);
            visited.add(p2.id);
          }
        }
      }
      clusters.push(cluster);
    }

    const routes = clusters.map((cluster, idx) => {
      let totalKm = 0;
      let totalDays = 0;

      const stops = cluster.map((evt, sIdx) => {
        const duration = evt.durationDays ?? 10;
        totalDays += duration;

        const currKey = (evt.city || '').toLowerCase().trim();
        const cCurr = CITY_COORDS[currKey] || null;
        let distFromPrev: number | null = 0;

        if (sIdx > 0) {
          const prevKey = (cluster[sIdx - 1].city || '').toLowerCase().trim();
          const cPrev = CITY_COORDS[prevKey] || null;
          if (cPrev && cCurr) {
            distFromPrev = haversineDistanceKm(cPrev.lat, cPrev.lng, cCurr.lat, cCurr.lng);
            totalKm += distFromPrev;
          } else {
            distFromPrev = null; // Cidade sem coordenadas não inventa distância
          }
        }

        return {
          id: evt.id,
          city: evt.city,
          name: evt.name,
          startDate: evt.startDate,
          endDate: evt.endDate,
          durationDays: duration,
          score: evt.score || 'HIGH',
          distanceFromPrevKm: distFromPrev,
          geocoded: cCurr !== null,
        };
      });

      return {
        id: `route-${idx + 1}`,
        summary: {
          stopCount: stops.length,
          totalKm,
          totalDays,
        },
        stops
      };
    });

    res.json({ routes, message: 'Roteiros gerados com sucesso.' });
  } catch (error: any) {
    console.error('Erro ao gerar roteiros inteligentes:', error?.message || error);
    res.status(500).json({ error: 'Erro ao gerar roteiros inteligentes' });
  }
});

// GET /api/events
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }

    const events = await prisma.commercialEvent.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' }
    });
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar eventos' });
  }
});

// POST /api/events
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Empresa não identificada' });
      return;
    }

    const { 
      name, city, category, score, audience, organizerContact, socialMedia, 
      notes, isFavorite, isProspect, startDate, endDate, durationDays, isItinerant,
      venueType, ticketPrice, observations, expectedRevenue,
      cityAge, cityIncome, cityPerCapita, cityEconomy 
    } = req.body;
    
    if (!name || !city || !category || !score) {
      res.status(400).json({ error: 'Faltam campos obrigatórios' });
      return;
    }

    const event = await prisma.commercialEvent.create({
      data: {
        name, city, category, score, audience, organizerContact, socialMedia, notes,
        isFavorite: isFavorite || false, isProspect: isProspect || false,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        durationDays: durationDays ? parseInt(durationDays.toString()) : null,
        isItinerant: isItinerant !== undefined ? Boolean(isItinerant) : false,
        venueType,
        ticketPrice,
        observations,
        expectedRevenue: expectedRevenue ? parseFloat(expectedRevenue.toString()) : 0,
        cityAge, cityIncome, cityPerCapita, cityEconomy,
        companyId: companyId!
      }
    });

    res.status(201).json(event);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar evento' });
  }
});

// PUT /api/events/:id/favorite
router.put('/:id/favorite', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { isFavorite } = req.body;
    const companyId = req.user?.companyId;

    const existing = await prisma.commercialEvent.findFirst({
      where: { id: id as string, ...(companyId ? { companyId } : {}) }
    });

    if (!existing) {
      res.status(404).json({ error: 'Evento não encontrado' });
      return;
    }

    const updated = await prisma.commercialEvent.update({
      where: { id: id as string },
      data: { isFavorite }
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar favorito' });
  }
});

// PUT /api/events/:id/prospect
router.put('/:id/prospect', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { isProspect } = req.body;
    const companyId = req.user?.companyId;

    const existing = await prisma.commercialEvent.findFirst({
      where: { id: id as string, ...(companyId ? { companyId } : {}) }
    });

    if (!existing) {
      res.status(404).json({ error: 'Evento não encontrado' });
      return;
    }

    const updated = await prisma.commercialEvent.update({
      where: { id: id as string },
      data: { isProspect }
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar prospecto' });
  }
});

// PATCH /api/events/:id/approve-roi
// Tratar chamada de aprovação de ROI com regra financeira pendente sem lançamentos fictícios
router.patch('/:id/approve-roi', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const companyId = req.user?.companyId;

    const existing = await prisma.commercialEvent.findFirst({
      where: { id: id as string, ...(companyId ? { companyId } : {}) }
    });

    if (!existing) {
      res.status(404).json({ error: 'Evento não encontrado' });
      return;
    }

    // Regra financeira pendente: informar pendência contábil sem simular lançamentos no caixa
    res.status(501).json({
      error: 'Regra financeira pendente de especificação contábil. A integração automática no fluxo de caixa está suspensa.',
      code: 'FINANCIAL_RULE_PENDING'
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao processar aprovação de ROI' });
  }
});

// POST /api/events/reservations/:id/resolve
// Trata resposta tardia de provedor externo para resolver status pendente (PENDING_CONFIRMATION ou RESERVED)
router.post('/reservations/:id/resolve', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const auth = await authorizeCompanyAdmin(req, res);
    if (!auth) return;

    const { id } = req.params;
    const { outcome, measuredCostCents, evidence, reason, simulateAuditFailure } = req.body || {};

    if (!outcome || !['CONFIRMED', 'RELEASED'].includes(outcome)) {
      res.status(400).json({ error: 'Parâmetro outcome deve ser "CONFIRMED" ou "RELEASED".' });
      return;
    }

    const reservation = await prisma.apiUsageRecord.findUnique({
      where: { id: id as string },
    });
    if (!reservation) {
      res.status(404).json({ error: 'Reserva não encontrada.' });
      return;
    }

    if (auth.role !== 'SUPER_ADMIN' && auth.companyId !== reservation.companyId) {
      res.status(403).json({ error: 'Acesso negado à reserva desta empresa.' });
      return;
    }

    const result = await resolvePendingReservation({
      reservationId: id as string,
      outcome,
      measuredCostCents,
      evidence,
      reason,
      resolvedByUserId: auth.userId,
      resolvedByName: auth.userName,
      simulateAuditFailure: simulateAuditFailure || req.headers['x-mock-simulate-audit-failure'] === 'true',
    });

    res.json(result);
  } catch (err: any) {
    const status = err.statusCode || err.status || 400;
    res.status(status).json({ error: err.message || 'Erro ao resolver reserva pendente.', code: err.code });
  }
});

export default router;
