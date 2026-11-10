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
    cityScoutCache.delete(city.toLowerCase().trim());
  } else {
    cityScoutCache.clear();
  }
}


// Instanciação direta por chamada com resolução dinâmica por empresa
// Elimina fallback silencioso para a chave global quando a empresa não tem contratação ativa

// Helper to robustly extract clean JSON from AI responses (even with conversational wrappers)
export function extractCleanJson(text: string): string {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

// Helper for exact duration calculation
export function computeExactDurationDays(startDateStr?: string, endDateStr?: string, providedDays?: any): number {
  if (startDateStr && endDateStr) {
    const s = new Date(startDateStr.split('T')[0]);
    const e = new Date(endDateStr.split('T')[0]);
    if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
      const diffMs = e.getTime() - s.getTime();
      const diffDays = Math.round(diffMs / (1000 * 3600 * 24)) + 1;
      if (diffDays >= 1) return diffDays;
    }
  }
  if (providedDays !== undefined && providedDays !== null) {
    const p = parseInt(providedDays.toString(), 10);
    if (!isNaN(p) && p >= 1) return p;
  }
  return 1;
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
    let activeAiClient: GoogleGenAI | null = null;
    let resolvedIntegrationId: string | undefined = undefined;
    let providerName = 'GEMINI';

    if (companyId) {
      const resolved = await resolveCompanyIntegration(companyId, 'AI_RESEARCH', environment);
      if (!resolved || resolved.status !== 'ACTIVE' || !resolved.secret) {
        if (!isExternalServicesDisabled()) {
          res.status(403).json({
            error: 'Pesquisa de eventos por IA desabilitada para esta empresa. Cadastre uma chave própria ou contrate o compartilhamento da plataforma na Central.',
          });
          return;
        }
      } else {
        providerName = resolved.provider;
        resolvedIntegrationId = resolved.integration?.id;
        if (providerName === 'GROK') {
          res.status(501).json({
            error: 'Provedor Grok (xAI) configurado, mas o radar e pesquisa de eventos está disponível operacionalmente apenas via Gemini. Altere o provedor na Central para GEMINI.',
          });
          return;
        }
        activeAiClient = new GoogleGenAI({ apiKey: resolved.secret });
      }
    } else if (req.user?.role === 'SUPER_ADMIN') {
      if (process.env.GEMINI_API_KEY && !isExternalServicesDisabled()) {
        activeAiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      }
    }

    // ── 1. Verificação de Cache do Scout por Cidade ───────────────────────────
    const cachedEntry = cityScoutCache.get(lowerCity);
    if (cachedEntry && cachedEntry.expiresAt > Date.now() && !forceRefresh) {
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
        ...cachedEntry.data,
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

    // Retorno mockado quando serviços externos estão desabilitados ou sem chave
    if (isExternalServicesDisabled() || !activeAiClient) {
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

          // Gravação condicional do timeout: passa de RESERVED para PENDING_CONFIRMATION apenas se a reserva ainda estiver aberta
          await markReservationPendingConfirmation(reservationId, {
            latencyMs: Date.now() - callStart,
            reason: 'TIMEOUT_AFTER_DISPATCH',
            delayMs: timeoutDelayMs,
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

      // O provedor respondeu à chamada!
      providerResponded = true;

      if (reservationId) {
        await confirmApiReservation(reservationId, {
          status: 'SUCCESS',
          latencyMs: Date.now() - callStart,
        });
      }

      if (simulateInvalidContent) {
        // Se o provedor respondeu e houve erro ao ler o conteúdo ou salvar o cache, preserve a unidade consumida
        return res.status(200).json({
          cityInfo: {
            name: sanitizedCity,
            warning: 'Resposta do provedor recebida, porém com formatação degradada.',
          },
          events: [],
          source: 'EXTERNAL',
          cached: false,
          preservedUnit: true,
          reservationId,
        });
      }

      const mockResult = {
        cityInfo: {
          name: sanitizedCity,
          summary: `Pesquisa comercial simulada para ${sanitizedCity}.`,
          searchDate: new Date().toISOString().split('T')[0],
          aiSource: 'Mock AI Service (External Services Disabled)'
        },
        events: [
          {
            name: `Exposição Comercial de ${sanitizedCity}`,
            category: 'Exposição Agropecuária',
            startDate: '2026-09-10',
            endDate: '2026-09-13',
            durationDays: 4,
            location: 'Parque de Exposições',
            city: sanitizedCity,
            estimatedAudience: '15.000 pessoas',
            historicalData: 'Evento anual consolidado',
            organizer: 'Sindicato Rural',
            organizerContact: '(62) 99999-0000',
            socialMedia: '@expo_evento',
            website: 'https://exemplo.com',
            notes: 'Excelente oportunidade de vendas fotográficas',
            sources: ['Mock Local Fixture']
          }
        ]
      };

      cityScoutCache.set(lowerCity, {
        data: mockResult,
        expiresAt: Date.now() + 24 * 3600 * 1000,
      });

      return res.json({
        ...mockResult,
        source: 'EXTERNAL',
        cached: false,
      });
    }

    const currentDate = new Date();
    const targetDate = new Date();
    targetDate.setDate(currentDate.getDate());
    const maxDate = new Date();
    maxDate.setDate(currentDate.getDate() + 380);
    
    const currentDateStr = currentDate.toISOString().split('T')[0];
    const targetDateStr = targetDate.toISOString().split('T')[0];
    const maxDateStr = maxDate.toISOString().split('T')[0];

    const prompt = `Você é um agente de Inteligência Comercial e Investigador de Eventos ("pente fino" rigoroso). Procure eventos na cidade "${sanitizedCity}".
    Hoje é dia ${currentDateStr}.
    Você DEVE retornar APENAS eventos reais que acontecerão entre ${targetDateStr} e ${maxDateStr}.
    
    Retorne a resposta EXCLUSIVAMENTE em formato JSON puro:
    {
      "cityInfo": {
        "name": "${sanitizedCity}",
        "summary": "Breve resumo sobre o cenário de eventos da cidade neste período.",
        "searchDate": "${currentDateStr}"
      },
      "events": [
        {
          "name": "Nome do Evento",
          "category": "Exposição Agropecuária / Show / Festa Tradicional / Circo / Parque",
          "startDate": "YYYY-MM-DD",
          "endDate": "YYYY-MM-DD",
          "durationDays": 3,
          "location": "Local",
          "city": "${sanitizedCity}",
          "estimatedAudience": "Público estimado",
          "historicalData": "Histórico",
          "organizer": "Organizador",
          "organizerContact": "(DD) 9XXXX-XXXX",
          "socialMedia": "@perfil",
          "website": "https://...",
          "notes": "Observações comerciais",
          "sources": ["Fonte"]
        }
      ]
    }`.slice(0, 4000);

    let text = '';
    providerDispatched = true;
    let hasTimedOut = false;
    const currentResId = reservationId;

    try {
      const response: any = await executeWithTimeout(async (signal) => {
        const genPromise = activeAiClient!.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: { 
            temperature: 0.1,
            tools: [{ googleSearch: {} }] 
          }
        });

        // Liga o retorno tardio do provedor à confirmação automática da reserva usando a mesma rotina unificada:
        genPromise.then(async () => {
          if (hasTimedOut && currentResId) {
            await handleLateProviderResponse({
              reservationId: currentResId,
              outcome: 'CONFIRMED',
              reason: 'LATE_PROVIDER_RESPONSE_AUTO_CONFIRMED',
              resolvedByUserId: 'SYSTEM_LATE_RESPONSE',
              resolvedByName: 'Provedor Externo (Resposta Tardia Automática)',
            });
          }
        }).catch((lateErr) => {
          // Quando o consumo continuar incerto, mantenha a reserva pendente para revisão!
          console.warn('[API-QUOTA] Resposta tardia com erro; consumo incerto. Mantendo PENDING_CONFIRMATION:', lateErr?.message);
        });

        return await genPromise;
      }, 25000);

      // O provedor respondeu com sucesso
      providerResponded = true;
      text = (response.text || '').slice(0, 50000);

      if (reservationId) {
        await confirmApiReservation(reservationId, {
          status: 'SUCCESS',
          latencyMs: Date.now() - callStart,
        });
      }
    } catch (err: any) {
      hasTimedOut = true;
      const isTimeout = err.name === 'AbortError' || err.message === 'AI_TIMEOUT' || err.code === 'ETIMEDOUT';
      if (reservationId && !providerResponded) {
        if (isTimeout || providerDispatched) {
          // Se a chamada já foi enviada e terminar em timeout ou perda de conexão, deixa o consumo pendente de confirmação
          await markReservationPendingConfirmation(reservationId, {
            latencyMs: Date.now() - callStart,
            reason: 'TIMEOUT_AFTER_DISPATCH',
          });
        } else {
          // Libera a reserva quando comprovado que a operação não consumiu cota
          await releaseApiReservation(reservationId, {
            reason: err.message || 'OPERATION_FAILED_NO_QUOTA_CONSUMED',
          });
        }
      }

      if (isTimeout) {
        res.status(504).json({
          error: 'Tempo limite esgotado ao aguardar resposta do provedor de IA. O consumo foi retido e está pendente de confirmação.',
          status: 'PENDING_CONFIRMATION',
          reservationId,
        });
        return;
      }
      if (err.status === 429 || (err.message && err.message.includes('429'))) {
        res.status(429).json({ error: 'Limite de requisições de IA atingido. Tente novamente mais tarde.' });
        return;
      }
      throw err;
    }

    const cleanJson = extractCleanJson(text);
    let result: any;
    try {
      result = JSON.parse(cleanJson);
      if (result && Array.isArray(result.events)) {
        result.events = result.events.slice(0, 30);
        for (let ev of result.events) {
          ev.durationDays = computeExactDurationDays(ev.startDate, ev.endDate, ev.durationDays);
        }
      } else {
        result = { cityInfo: { name: sanitizedCity }, events: [] };
      }
    } catch (parseError) {
      // Se o provedor respondeu mas o JSON é malformado, preserva a unidade consumida
      result = { cityInfo: { name: sanitizedCity, warning: 'Resposta do provedor com formatação degradada' }, events: [] };
    }

    try {
      cityScoutCache.set(lowerCity, {
        data: result,
        expiresAt: Date.now() + 24 * 3600 * 1000,
      });
    } catch (cacheErr: any) {
      console.warn('[EVENTS] Erro ao gravar cache do Scout:', cacheErr?.message);
    }

    res.json({
      ...result,
      source: 'EXTERNAL',
      cached: false,
    });
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
    res.status(503).json({ 
      error: 'Servidor das IAs sobrecarregado ou indisponível. Aguarde um momento e tente novamente.' 
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
    let activeAiClient: GoogleGenAI | null = null;

    if (companyId) {
      const resolved = await resolveCompanyIntegration(companyId, 'AI_RESEARCH', environment);
      if (!resolved || resolved.status !== 'ACTIVE' || !resolved.secret) {
        if (!isExternalServicesDisabled()) {
          res.status(403).json({
            error: 'Pesquisa de radar por IA desabilitada para esta empresa. Cadastre uma chave própria ou contrate o compartilhamento da plataforma na Central.',
          });
          return;
        }
      } else {
        providerName = resolved.provider;
        resolvedIntegrationId = resolved.integration?.id;
        if (providerName === 'GROK') {
          res.status(501).json({
            error: 'Provedor Grok (xAI) configurado, mas o radar de eventos está disponível operacionalmente apenas via Gemini. Altere o provedor na Central para GEMINI.',
          });
          return;
        }
        activeAiClient = new GoogleGenAI({ apiKey: resolved.secret });
      }
    } else if (req.user?.role === 'SUPER_ADMIN') {
      if (process.env.GEMINI_API_KEY && !isExternalServicesDisabled()) {
        activeAiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      }
    }

    // ── 1. Verificação de Cache do Radar Estadual ────────────────────────────
    if (!forceRefresh) {
      const cached = await prisma.stateRadarCache.findUnique({
        where: { state: stateUF }
      });
      if (cached) {
        const ageInDays = (new Date().getTime() - cached.updatedAt.getTime()) / (1000 * 3600 * 24);
        if (ageInDays < 10) {
          resultData = cached.data;
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

    let providerDispatched = false;
    let providerResponded = false;

    if (isExternalServicesDisabled() || !activeAiClient) {
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

          // Gravação condicional do timeout: passa de RESERVED para PENDING_CONFIRMATION apenas se a reserva ainda estiver aberta
          await markReservationPendingConfirmation(reservationId, {
            latencyMs: Date.now() - callStart,
            reason: 'TIMEOUT_AFTER_DISPATCH',
            delayMs: timeoutDelayMs,
          });
        }
        if (!forceRefresh) {
          const fallbackCache = await prisma.stateRadarCache.findUnique({ where: { state: stateUF } });
          if (fallbackCache) {
            return res.json({ ...(fallbackCache.data as Record<string, any>), source: 'CACHE', cached: true });
          }
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
        return res.status(200).json({
          state: stateUF,
          cities: [],
          source: 'EXTERNAL',
          cached: false,
          preservedUnit: true,
          reservationId,
        });
      }

      const mockRadar = {
        state: stateUF,
        updatedAt: new Date().toISOString(),
        cities: [
          {
            city: stateUF === 'GO' ? 'Goiânia' : 'Capital',
            eventsCount: 3,
            events: [
              {
                name: `Festa Regional de ${stateUF}`,
                category: 'Festival Cultural',
                startDate: '2026-09-15',
                endDate: '2026-09-18',
                durationDays: 4,
                city: stateUF === 'GO' ? 'Goiânia' : 'Capital',
                score: 'HIGH'
              }
            ]
          }
        ]
      };

      await prisma.stateRadarCache.upsert({
        where: { state: stateUF },
        update: { data: mockRadar, updatedAt: new Date() },
        create: { state: stateUF, data: mockRadar }
      });

      return res.json({
        ...mockRadar,
        source: 'EXTERNAL',
        cached: false,
      });
    }

    const currentDate = new Date();
    const targetDate = new Date();
    targetDate.setDate(currentDate.getDate());
    const maxDate = new Date();
    maxDate.setDate(currentDate.getDate() + 380);
    
    const currentDateStr = currentDate.toISOString().split('T')[0];
    const targetDateStr = targetDate.toISOString().split('T')[0];
    const maxDateStr = maxDate.toISOString().split('T')[0];

    const prompt = `Você é um agente de Inteligência Comercial e Investigador de Eventos ("pente fino" rigoroso). Procure as principais cidades no estado "${stateUF}" que terão eventos entre ${targetDateStr} e ${maxDateStr}.
    Retorne APENAS JSON válido com o radar de cidades e eventos.`.slice(0, 4000);

    providerDispatched = true;
    let hasTimedOut = false;
    const currentResId = reservationId;

    try {
      const response: any = await executeWithTimeout(async (signal) => {
        const genPromise = activeAiClient!.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: { 
            temperature: 0.1,
            tools: [{ googleSearch: {} }] 
          }
        });

        // Liga o retorno tardio do provedor à confirmação automática da reserva usando a mesma rotina unificada:
        genPromise.then(async () => {
          if (hasTimedOut && currentResId) {
            await handleLateProviderResponse({
              reservationId: currentResId,
              outcome: 'CONFIRMED',
              reason: 'LATE_PROVIDER_RESPONSE_AUTO_CONFIRMED',
              resolvedByUserId: 'SYSTEM_LATE_RESPONSE',
              resolvedByName: 'Provedor Externo (Resposta Tardia Automática)',
            });
          }
        }).catch((lateErr) => {
          console.warn('[API-QUOTA] Resposta tardia com erro no Radar; consumo incerto:', lateErr?.message);
        });

        return await genPromise;
      }, 25000);

      providerResponded = true;

      // Confirme a unidade assim que o provedor responder com sucesso, antes de ler o conteúdo ou salvar o cache
      if (reservationId) {
        await confirmApiReservation(reservationId, {
          status: 'SUCCESS',
          latencyMs: Date.now() - callStart,
        });
      }

      const text = (response.text || '').slice(0, 50000);
      try {
        const cleanJson = extractCleanJson(text);
        resultData = JSON.parse(cleanJson);

        if (resultData && typeof resultData === 'object' && (Array.isArray(resultData.cities) || Array.isArray(resultData.events))) {
          await prisma.stateRadarCache.upsert({
            where: { state: stateUF },
            update: { data: resultData, updatedAt: new Date() },
            create: { state: stateUF, data: resultData }
          });
        }
      } catch (downstreamErr) {
        // Falha ao ler conteúdo ou salvar cache downstream não anula consumo confirmado
        resultData = { state: stateUF, cities: [], warning: 'Falha downstream ao processar resposta do provedor' };
      }
    } catch (err: any) {
      hasTimedOut = true;
      const isTimeout = err.name === 'AbortError' || err.message === 'AI_TIMEOUT' || err.code === 'ETIMEDOUT';
      if (reservationId && !providerResponded) {
        if (isTimeout || providerDispatched) {
          await markReservationPendingConfirmation(reservationId, {
            latencyMs: Date.now() - callStart,
            reason: 'TIMEOUT_AFTER_DISPATCH',
          });
        } else {
          await releaseApiReservation(reservationId, {
            reason: err.message || 'OPERATION_FAILED_NO_QUOTA_CONSUMED',
          });
        }
      }

      if (isTimeout) {
        const fallbackCache = await prisma.stateRadarCache.findUnique({ where: { state: stateUF } });
        if (fallbackCache) {
          res.json({ ...(fallbackCache.data as Record<string, any>), source: 'CACHE', cached: true });
          return;
        }
        res.status(504).json({
          error: 'Tempo limite esgotado ao aguardar resposta do provedor de IA. O consumo foi retido e está pendente de confirmação.',
          status: 'PENDING_CONFIRMATION',
          reservationId,
        });
        return;
      }
      const fallbackCache = await prisma.stateRadarCache.findUnique({ where: { state: stateUF } });
      if (fallbackCache) {
        res.json({ ...(fallbackCache.data as Record<string, any>), source: 'CACHE', cached: true });
        return;
      }
      res.status(503).json({ error: 'Falha ao consultar radar de eventos do estado.' });
      return;
    }

    res.json({
      ...((resultData as Record<string, any>) || { state: stateUF, cities: [] }),
      source: 'EXTERNAL',
      cached: false,
    });
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
