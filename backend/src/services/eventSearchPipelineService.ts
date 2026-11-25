import { Type, Schema } from '@google/genai';
import {
  EventSearchConfigValues,
  buildRenderedEventPrompt,
  formatDateBrt,
  addDaysToDateIso,
} from './eventSearchConfigService';

export const DEFAULT_GEMINI_SEARCH_MODEL = 'gemini-2.5-flash';
export const DEFAULT_STEP1_TIMEOUT_MS = 55000;
export const DEFAULT_STEP2_TIMEOUT_MS = 35000;

export type VerificationStatus = 'VERIFIED_SOURCE' | 'UNVERIFIED_ESTIMATE';
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type EventEntryType = 'FREE' | 'PAID' | 'MIXED' | 'UNKNOWN';

export interface GroundingSourceItem {
  index: number;
  uri: string;
  title: string;
  platform: string;
}

export interface StepTokenUsage {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CombinedPipelineTokenUsage {
  step1Prompt: number;
  step1Output: number;
  step1Total: number;
  step2Prompt: number;
  step2Output: number;
  step2Total: number;
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface EventFilterDiagnostics {
  rawCount: number;
  keptCount: number;
  filteredOutExpired: number;
  filteredOutHorizon: number;
  filteredOutDuration: number;
  filteredOutDuplicates: number;
}

export interface SearchMetaInfo {
  model: string;
  pipelineVersion: string;
  referenceDateBrt: string;
  windowEndDateBrt: string;
  horizonDays: number;
  grounded: boolean;
  webSearchQueries: string[];
  groundingSourcesCount: number;
  groundingSources: GroundingSourceItem[];
  diagnostics: EventFilterDiagnostics;
  tokens: CombinedPipelineTokenUsage;
}

export interface CanonicalEventItem {
  name: string;
  category: string;
  city: string;
  state: string;
  location: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  estimatedAudience: string;
  audience: string;
  estimatedAudienceNumeric: number | null;
  ticketPrice: string;
  entryType: EventEntryType;
  sourceUrl: string;
  sourcePlatform: string;
  sources: string[];
  website: string;
  verificationStatus: VerificationStatus;
  confidenceLevel: ConfidenceLevel;
  score: ConfidenceLevel;
  organizer: string;
  organizerContact: string;
  socialMedia: string;
  historicalData: string;
  notes: string;
  population: string;
  perCapitaIncome: string;
  income: string;
  gdp: string;
}

export interface CanonicalCityInfo {
  name: string;
  state: string;
  summary: string;
  searchDate: string;
  population: string;
  perCapitaIncome: string;
  rendaPerCapita: string;
  rendaDomiciliarPerCapitaMedia: string;
  gdp: string;
  economicActivities: string;
  principaisFestasFixas: string;
  cityAge: string;
  aiSource: string;
}

export interface CityEventSearchPipelineOutput {
  cityInfo: CanonicalCityInfo;
  events: CanonicalEventItem[];
  fetchedAt: string;
  searchMeta: SearchMetaInfo;
}

export interface StateRadarPipelineOutput {
  state: string;
  updatedAt: string;
  fetchedAt: string;
  events: CanonicalEventItem[];
  searchMeta: SearchMetaInfo;
}

export interface GenerativeAiModelsLike {
  models: {
    generateContent(params: any): Promise<any>;
  };
}

export class EventSearchExtractionError extends Error {
  readonly code = 'AI_EXTRACTION_FAILED';
  readonly tokens: CombinedPipelineTokenUsage;
  readonly rawSnippet: string;

  constructor(message: string, tokens: CombinedPipelineTokenUsage, rawSnippet: string = '') {
    super(message);
    this.name = 'EventSearchExtractionError';
    this.tokens = tokens;
    this.rawSnippet = rawSnippet.slice(0, 500);
  }
}

const EVENT_ITEM_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING, description: 'Nome oficial do evento.' },
    category: { type: Type.STRING, description: 'Categoria do evento.' },
    city: { type: Type.STRING, description: 'Município e UF (ex: Rio Verde - GO).' },
    state: { type: Type.STRING, description: 'Sigla da UF com 2 letras (ex: GO).' },
    location: { type: Type.STRING, description: 'Local/parque/espaço do evento.' },
    startDate: { type: Type.STRING, description: 'Data inicial exata no formato YYYY-MM-DD.' },
    endDate: { type: Type.STRING, description: 'Data final exata no formato YYYY-MM-DD.' },
    durationDays: { type: Type.INTEGER, description: 'Duração total em dias.' },
    estimatedAudience: { type: Type.STRING, description: 'Público estimado (ex: 30.000 pessoas).' },
    ticketPrice: {
      type: Type.STRING,
      description: 'Preço do ingresso ou condição de entrada (ex: Entrada Franca, R$ 50,00).',
    },
    entryType: {
      type: Type.STRING,
      enum: ['FREE', 'PAID', 'MIXED', 'UNKNOWN'],
      description: 'Tipo de acesso do público.',
    },
    sourceIndex: {
      type: Type.INTEGER,
      nullable: true,
      description:
        'Número [N] da fonte na lista VERIFIED_GROUNDING_SOURCES que comprova este evento, ou null se não houver.',
    },
    sourceUrl: {
      type: Type.STRING,
      description: 'URL oficial/verificada que comprova o evento (vazio se não houver URL real).',
    },
    sourcePlatform: {
      type: Type.STRING,
      description: 'Plataforma da fonte (ex: Sympla, Instagram, Prefeitura, Sindicato Rural).',
    },
    sources: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Lista de URLs ou nomes de fontes consultadas.',
    },
    website: { type: Type.STRING, description: 'Site oficial do evento, quando existir.' },
    score: {
      type: Type.STRING,
      enum: ['HIGH', 'MEDIUM', 'LOW'],
      description: 'Potencial comercial para venda fotográfica presencial.',
    },
    organizer: { type: Type.STRING, description: 'Entidade ou empresa organizadora.' },
    organizerContact: { type: Type.STRING, description: 'Telefone, WhatsApp ou e-mail do organizador.' },
    socialMedia: { type: Type.STRING, description: 'Perfil oficial nas redes sociais (ex: @perfil).' },
    historicalData: { type: Type.STRING, description: 'Histórico/edição do evento.' },
    notes: { type: Type.STRING, description: 'Observações comerciais relevantes.' },
    population: { type: Type.STRING, description: 'População estimada IBGE do município (se conhecida).' },
    perCapitaIncome: { type: Type.STRING, description: 'Renda per capita aproximada do município.' },
    gdp: { type: Type.STRING, description: 'PIB aproximado do município.' },
  },
  required: ['name', 'category', 'city', 'startDate', 'endDate'],
};

const CITY_EXTRACTION_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    cityInfo: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        state: { type: Type.STRING },
        summary: { type: Type.STRING },
        population: { type: Type.STRING },
        perCapitaIncome: { type: Type.STRING },
        rendaDomiciliarPerCapitaMedia: { type: Type.STRING },
        gdp: { type: Type.STRING },
        economicActivities: { type: Type.STRING },
        principaisFestasFixas: { type: Type.STRING },
        cityAge: { type: Type.STRING },
      },
      required: ['name', 'summary'],
    },
    events: {
      type: Type.ARRAY,
      items: EVENT_ITEM_SCHEMA,
    },
  },
  required: ['cityInfo', 'events'],
};

const STATE_RADAR_EXTRACTION_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    state: { type: Type.STRING },
    events: {
      type: Type.ARRAY,
      items: EVENT_ITEM_SCHEMA,
    },
  },
  required: ['state', 'events'],
};

export function extractCleanJsonPayload(rawText: string): string {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) return '';

  const fencedMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;

  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return candidate.slice(firstBrace, lastBrace + 1);
  }
  return candidate;
}

export function normalizeIsoDateString(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const cleaned = String(raw).trim();
  if (!cleaned) return null;

  const head = cleaned.split('T')[0].trim();

  let year = 0;
  let month = 0;
  let day = 0;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(head);
  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else {
    const brMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(head);
    if (brMatch) {
      day = Number(brMatch[1]);
      month = Number(brMatch[2]);
      year = Number(brMatch[3]);
    } else {
      return null;
    }
  }

  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function computeInclusiveDurationDays(
  startDateIso: string,
  endDateIso: string,
  fallbackProvided?: unknown
): number {
  const sNorm = normalizeIsoDateString(startDateIso);
  const eNorm = normalizeIsoDateString(endDateIso);
  if (sNorm && eNorm) {
    const [sy, sm, sd] = sNorm.split('-').map(Number);
    const [ey, em, ed] = eNorm.split('-').map(Number);
    const sUtc = Date.UTC(sy, sm - 1, sd);
    const eUtc = Date.UTC(ey, em - 1, ed);
    const diffDays = Math.round((eUtc - sUtc) / 86400000) + 1;
    if (diffDays >= 1) return diffDays;
  }
  if (fallbackProvided !== undefined && fallbackProvided !== null) {
    const parsed = parseInt(String(fallbackProvided), 10);
    if (!isNaN(parsed) && parsed >= 1) return parsed;
  }
  return 1;
}

function readStepUsage(response: any): StepTokenUsage {
  const um = response?.usageMetadata;
  const promptTokens =
    typeof um?.promptTokenCount === 'number' && Number.isFinite(um.promptTokenCount)
      ? Math.max(0, Math.trunc(um.promptTokenCount))
      : 0;
  const outputTokens =
    typeof um?.candidatesTokenCount === 'number' && Number.isFinite(um.candidatesTokenCount)
      ? Math.max(0, Math.trunc(um.candidatesTokenCount))
      : 0;
  const totalTokens =
    typeof um?.totalTokenCount === 'number' && Number.isFinite(um.totalTokenCount)
      ? Math.max(promptTokens + outputTokens, Math.trunc(um.totalTokenCount))
      : promptTokens + outputTokens;
  return { promptTokens, outputTokens, totalTokens };
}

function combineStepUsage(step1: StepTokenUsage, step2: StepTokenUsage): CombinedPipelineTokenUsage {
  const promptTokens = step1.promptTokens + step2.promptTokens;
  const outputTokens = step1.outputTokens + step2.outputTokens;
  const totalTokens = step1.totalTokens + step2.totalTokens;
  return {
    step1Prompt: step1.promptTokens,
    step1Output: step1.outputTokens,
    step1Total: step1.totalTokens,
    step2Prompt: step2.promptTokens,
    step2Output: step2.outputTokens,
    step2Total: step2.totalTokens,
    promptTokens,
    outputTokens,
    totalTokens,
  };
}

function normalizeUrlForCompare(raw: unknown): string {
  const str = String(raw || '').trim();
  if (!/^https?:\/\//i.test(str)) return '';
  try {
    const u = new URL(str);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (
      host === 'exemplo.com' ||
      host === 'example.com' ||
      host === 'localhost' ||
      host.endsWith('.exemplo.com') ||
      host.endsWith('.example.com')
    ) {
      return '';
    }
    const cleanPath = u.pathname.replace(/\/+$/, '');
    return `${u.protocol.toLowerCase()}//${host}${cleanPath}${u.search}`;
  } catch {
    return '';
  }
}

function sanitizeHttpUrl(raw: unknown): string {
  const str = String(raw || '').trim();
  if (!/^https?:\/\//i.test(str)) return '';
  if (!normalizeUrlForCompare(str)) return '';
  return str;
}

export function inferSourcePlatform(urlOrText: string, fallbackTitle: string = ''): string {
  const combined = `${urlOrText || ''} ${fallbackTitle || ''}`.toLowerCase();
  if (combined.includes('sympla')) return 'Sympla';
  if (combined.includes('instagram.com') || combined.includes('insta')) return 'Instagram';
  if (combined.includes('facebook.com')) return 'Facebook';
  if (combined.includes('bilheteriadigital')) return 'Bilheteria Digital';
  if (combined.includes('guicheweb')) return 'Guichê Web';
  if (combined.includes('ingresso') || combined.includes('baladapp') || combined.includes('eventim')) {
    return 'Bilheteria Oficial';
  }
  if (combined.includes('.gov.br') || combined.includes('prefeitura') || combined.includes('turismo')) {
    return 'Prefeitura / Gov';
  }
  if (combined.includes('ibge.gov.br')) return 'IBGE';
  if (combined.includes('sindicato') || combined.includes('expo')) return 'Sindicato / Expo';
  if (combined.includes('g1.globo') || combined.includes('jornal') || combined.includes('noticias')) {
    return 'Imprensa';
  }
  if (/^https?:\/\//i.test(urlOrText || '')) return 'Fonte Web';
  return '';
}

export function extractGroundingMetadataInfo(response: any): {
  grounded: boolean;
  webSearchQueries: string[];
  groundingSources: GroundingSourceItem[];
} {
  const gm = response?.candidates?.[0]?.groundingMetadata;
  const rawQueries = Array.isArray(gm?.webSearchQueries) ? gm.webSearchQueries : [];
  const webSearchQueries = rawQueries
    .map((q: unknown) => String(q || '').trim())
    .filter((q: string) => q.length > 0);

  const rawChunks = Array.isArray(gm?.groundingChunks) ? gm.groundingChunks : [];
  const seenNormalized = new Set<string>();
  const groundingSources: GroundingSourceItem[] = [];

  for (const chunk of rawChunks) {
    const rawUri = chunk?.web?.uri || chunk?.retrievedContext?.uri || '';
    const cleanUri = sanitizeHttpUrl(rawUri);
    if (!cleanUri) continue;
    const norm = normalizeUrlForCompare(cleanUri);
    if (!norm || seenNormalized.has(norm)) continue;
    seenNormalized.add(norm);

    const title = String(
      chunk?.web?.title || chunk?.retrievedContext?.title || chunk?.web?.domain || ''
    ).trim();
    groundingSources.push({
      index: groundingSources.length + 1,
      uri: cleanUri,
      title: title || cleanUri,
      platform: inferSourcePlatform(cleanUri, title) || 'Fonte Web',
    });
  }

  return {
    grounded: webSearchQueries.length > 0 || groundingSources.length > 0,
    webSearchQueries,
    groundingSources,
  };
}

function normalizeSlug(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseAudienceNumber(raw: unknown): number | null {
  const str = String(raw || '').trim();
  if (!str) return null;
  const milMatch = /(\d+(?:[.,]\d+)?)\s*mil\b/i.exec(str);
  if (milMatch) {
    const val = parseFloat(milMatch[1].replace(',', '.'));
    if (Number.isFinite(val)) return Math.round(val * 1000);
  }
  const numGroupMatch = /(\d{1,3}(?:\.\d{3})+|\d{4,})/.exec(str);
  if (numGroupMatch) {
    const digits = numGroupMatch[1].replace(/\./g, '');
    const parsed = parseInt(digits, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function cleanDisplayField(raw: unknown, fallback: string = ''): string {
  if (raw === undefined || raw === null) return fallback;
  const s = String(raw).trim();
  if (!s) return fallback;
  if (/^(n\/a|na|null|undefined|desconhecid[oa]|none|-)$/i.test(s)) {
    return fallback;
  }
  return s;
}

function extractCityAndState(rawCity: unknown, fallbackCity: string, fallbackState: string): {
  city: string;
  state: string;
} {
  const base = cleanDisplayField(rawCity, fallbackCity);
  const ufSuffix = /\s*[-/]\s*([A-Za-z]{2})$/.exec(base);
  if (ufSuffix) {
    const uf = ufSuffix[1].toUpperCase();
    return { city: base, state: uf };
  }
  const cleanState = cleanDisplayField(fallbackState).toUpperCase().slice(0, 2);
  if (cleanState.length === 2 && base && !base.toUpperCase().endsWith(` - ${cleanState}`)) {
    return { city: `${base} - ${cleanState}`, state: cleanState };
  }
  return { city: base, state: cleanState };
}

function isLargeSingleDayEvent(rawEvent: any, audienceNum: number | null, cfg: EventSearchConfigValues): boolean {
  const threshold =
    cfg.minEstimatedAudience !== null && cfg.minEstimatedAudience > 0
      ? cfg.minEstimatedAudience
      : 5000;
  if (audienceNum !== null && audienceNum >= threshold) {
    return true;
  }
  const score = String(rawEvent?.score || '').trim().toUpperCase();
  const combinedNotes = `${rawEvent?.estimatedAudience || ''} ${rawEvent?.audience || ''} ${rawEvent?.notes || ''}`.toLowerCase();
  if (
    score === 'HIGH' &&
    (combinedNotes.includes('grande porte') ||
      combinedNotes.includes('multidao') ||
      combinedNotes.includes('multidão') ||
      combinedNotes.includes('arena') ||
      combinedNotes.includes('regional'))
  ) {
    return true;
  }
  return false;
}

function resolveEventVerification(
  rawEvent: any,
  groundingSources: GroundingSourceItem[],
  preserveExistingVerificationWhenFromCache: boolean
): {
  verificationStatus: VerificationStatus;
  sourceUrl: string;
  sourcePlatform: string;
  sources: string[];
  website: string;
} {
  const groundingByNormUrl = new Map<string, GroundingSourceItem>();
  const groundingByIndex = new Map<number, GroundingSourceItem>();
  for (const gs of groundingSources) {
    const norm = normalizeUrlForCompare(gs.uri);
    if (norm) groundingByNormUrl.set(norm, gs);
    groundingByIndex.set(gs.index, gs);
  }

  const candidateUrls: string[] = [];
  const rawSourceUrl = sanitizeHttpUrl(rawEvent?.sourceUrl);
  const rawWebsite = sanitizeHttpUrl(rawEvent?.website);
  if (rawSourceUrl) candidateUrls.push(rawSourceUrl);
  if (rawWebsite) candidateUrls.push(rawWebsite);

  const rawSourcesList: string[] = Array.isArray(rawEvent?.sources)
    ? rawEvent.sources.map((x: unknown) => String(x || '').trim()).filter(Boolean)
    : [];
  for (const item of rawSourcesList) {
    const u = sanitizeHttpUrl(item);
    if (u) candidateUrls.push(u);
  }

  let matchedGrounding: GroundingSourceItem | undefined;
  for (const url of candidateUrls) {
    const norm = normalizeUrlForCompare(url);
    if (norm && groundingByNormUrl.has(norm)) {
      matchedGrounding = groundingByNormUrl.get(norm);
      break;
    }
  }

  if (!matchedGrounding && typeof rawEvent?.sourceIndex === 'number') {
    const byIdx = groundingByIndex.get(Math.trunc(rawEvent.sourceIndex));
    if (byIdx) matchedGrounding = byIdx;
  }

  if (!matchedGrounding && groundingSources.length > 0) {
    const eventSlug = normalizeSlug(rawEvent?.name);
    if (eventSlug.length >= 6) {
      matchedGrounding = groundingSources.find((gs) => {
        const titleSlug = normalizeSlug(gs.title);
        return titleSlug.length >= 6 && (titleSlug.includes(eventSlug) || eventSlug.includes(titleSlug));
      });
    }
  }

  if (matchedGrounding) {
    const allSources = Array.from(
      new Set([matchedGrounding.uri, ...rawSourcesList.filter((s) => !s.includes('exemplo.com'))])
    );
    return {
      verificationStatus: 'VERIFIED_SOURCE',
      sourceUrl: matchedGrounding.uri,
      sourcePlatform:
        cleanDisplayField(rawEvent?.sourcePlatform) ||
        matchedGrounding.platform ||
        inferSourcePlatform(matchedGrounding.uri, matchedGrounding.title) ||
        'Fonte Verificada',
      sources: allSources,
      website: rawWebsite || matchedGrounding.uri,
    };
  }

  if (
    preserveExistingVerificationWhenFromCache &&
    String(rawEvent?.verificationStatus || '').toUpperCase() === 'VERIFIED_SOURCE' &&
    rawSourceUrl
  ) {
    return {
      verificationStatus: 'VERIFIED_SOURCE',
      sourceUrl: rawSourceUrl,
      sourcePlatform:
        cleanDisplayField(rawEvent?.sourcePlatform) ||
        inferSourcePlatform(rawSourceUrl) ||
        'Fonte Verificada',
      sources: rawSourcesList.length > 0 ? rawSourcesList : [rawSourceUrl],
      website: rawWebsite || rawSourceUrl,
    };
  }

  const bestUnverifiedUrl = rawSourceUrl || rawWebsite || '';
  const platform =
    cleanDisplayField(rawEvent?.sourcePlatform) ||
    (bestUnverifiedUrl ? inferSourcePlatform(bestUnverifiedUrl) : '');

  return {
    verificationStatus: 'UNVERIFIED_ESTIMATE',
    sourceUrl: bestUnverifiedUrl,
    sourcePlatform: platform,
    sources: rawSourcesList.filter((s) => !/exemplo\.com|example\.com/i.test(s)),
    website: rawWebsite,
  };
}

function normalizeEntryType(rawEntryType: unknown, ticketPrice: string): EventEntryType {
  const upper = String(rawEntryType || '').trim().toUpperCase();
  if (upper === 'FREE' || upper === 'PAID' || upper === 'MIXED') {
    return upper;
  }
  const lowerTicket = ticketPrice.toLowerCase();
  if (/gratuit|franca|livre|abert|0,00/.test(lowerTicket)) return 'FREE';
  if (/r\$\s*\d|ingresso|pago|bilheteria|lote/.test(lowerTicket)) return 'PAID';
  return 'UNKNOWN';
}

function normalizeScore(raw: unknown): ConfidenceLevel {
  const upper = String(raw || '').trim().toUpperCase();
  if (upper === 'LOW' || upper === 'BAIXO') return 'LOW';
  if (upper === 'MEDIUM' || upper === 'MÉDIO' || upper === 'MEDIO') return 'MEDIUM';
  return 'HIGH';
}

const SCORE_RANK: Record<ConfidenceLevel, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export function applyDeterministicEventFilter(
  rawEvents: unknown[],
  cfg: EventSearchConfigValues,
  options: {
    referenceDate?: Date;
    groundingSources?: GroundingSourceItem[];
    defaultCity?: string;
    defaultState?: string;
    preserveExistingVerificationWhenFromCache?: boolean;
  } = {}
): {
  events: CanonicalEventItem[];
  diagnostics: EventFilterDiagnostics;
  referenceDateBrt: string;
  windowEndDateBrt: string;
} {
  const list = Array.isArray(rawEvents) ? rawEvents : [];
  const referenceDateBrt = formatDateBrt(options.referenceDate || new Date());
  const windowEndDateBrt = addDaysToDateIso(referenceDateBrt, cfg.horizonDays);
  const groundingSources = options.groundingSources || [];
  const preserveCache = Boolean(options.preserveExistingVerificationWhenFromCache);

  let filteredOutExpired = 0;
  let filteredOutHorizon = 0;
  let filteredOutDuration = 0;
  let filteredOutDuplicates = 0;

  const dedupedMap = new Map<string, CanonicalEventItem>();

  for (const item of list) {
    if (!item || typeof item !== 'object') {
      filteredOutExpired++;
      continue;
    }
    const raw = item as Record<string, any>;
    const name = cleanDisplayField(raw.name);
    if (!name) {
      filteredOutExpired++;
      continue;
    }

    const startDate = normalizeIsoDateString(raw.startDate);
    if (!startDate) {
      filteredOutExpired++;
      continue;
    }

    const endDate = normalizeIsoDateString(raw.endDate) || startDate;
    if (endDate < startDate) {
      filteredOutExpired++;
      continue;
    }

    // 1. Descarta eventos já encerrados antes de hoje em Brasília (-03:00)
    if (endDate < referenceDateBrt) {
      filteredOutExpired++;
      continue;
    }

    // 2. Descarta eventos fora da janela horizonDays
    if (startDate > windowEndDateBrt) {
      filteredOutHorizon++;
      continue;
    }

    // 3. Recalcula durationDays exato (inclusivo)
    const durationDays = computeInclusiveDurationDays(startDate, endDate, raw.durationDays);

    const audienceStr =
      cleanDisplayField(raw.estimatedAudience) ||
      cleanDisplayField(raw.audience) ||
      'Público em confirmação';
    const audienceNumeric = parseAudienceNumber(audienceStr);

    // 4. Regras de duração: maxDurationDays, minDurationDays e allowSingleDayIfLarge
    if (cfg.maxDurationDays !== null && cfg.maxDurationDays !== undefined && durationDays > cfg.maxDurationDays) {
      filteredOutDuration++;
      continue;
    }

    if (durationDays === 1) {
      if (!cfg.allowSingleDayIfLarge) {
        filteredOutDuration++;
        continue;
      }
      if (cfg.minDurationDays > 1 && !isLargeSingleDayEvent(raw, audienceNumeric, cfg)) {
        filteredOutDuration++;
        continue;
      }
    } else if (durationDays < cfg.minDurationDays) {
      filteredOutDuration++;
      continue;
    }

    const { city, state } = extractCityAndState(
      raw.city,
      options.defaultCity || '',
      cleanDisplayField(raw.state, options.defaultState || '')
    );

    const verification = resolveEventVerification(raw, groundingSources, preserveCache);
    const ticketRaw = cleanDisplayField(raw.ticketPrice);
    const entryType = normalizeEntryType(raw.entryType, ticketRaw);
    const ticketPrice =
      ticketRaw ||
      (entryType === 'FREE'
        ? 'Entrada Franca'
        : entryType === 'PAID'
          ? 'Ingresso pago (consultar lote)'
          : 'Consultar organizador');

    const score = normalizeScore(raw.score);
    const confidenceLevel: ConfidenceLevel =
      verification.verificationStatus === 'VERIFIED_SOURCE'
        ? 'HIGH'
        : cleanDisplayField(raw.organizerContact) || cleanDisplayField(raw.location)
          ? 'MEDIUM'
          : 'LOW';

    const perCapita =
      cleanDisplayField(raw.perCapitaIncome) || cleanDisplayField(raw.income);

    const normalizedEvent: CanonicalEventItem = {
      name,
      category: cleanDisplayField(raw.category, 'Evento Regional'),
      city: city || options.defaultCity || '',
      state,
      location: cleanDisplayField(raw.location, 'Local em confirmação'),
      startDate,
      endDate,
      durationDays,
      estimatedAudience: audienceStr,
      audience: audienceStr,
      estimatedAudienceNumeric: audienceNumeric,
      ticketPrice,
      entryType,
      sourceUrl: verification.sourceUrl,
      sourcePlatform: verification.sourcePlatform,
      sources: verification.sources,
      website: verification.website,
      verificationStatus: verification.verificationStatus,
      confidenceLevel,
      score,
      organizer: cleanDisplayField(raw.organizer, 'Organização local'),
      organizerContact: cleanDisplayField(raw.organizerContact, 'Consultar redes oficiais'),
      socialMedia: cleanDisplayField(raw.socialMedia),
      historicalData: cleanDisplayField(raw.historicalData),
      notes: cleanDisplayField(raw.notes, 'Oportunidade comercial mapeada para prospecção.'),
      population: cleanDisplayField(raw.population),
      perCapitaIncome: perCapita,
      income: perCapita,
      gdp: cleanDisplayField(raw.gdp),
    };

    const dedupeKey = `${normalizeSlug(name)}|${normalizeSlug(normalizedEvent.city)}|${startDate}`;
    const existing = dedupedMap.get(dedupeKey);
    if (existing) {
      filteredOutDuplicates++;
      if (
        existing.verificationStatus !== 'VERIFIED_SOURCE' &&
        normalizedEvent.verificationStatus === 'VERIFIED_SOURCE'
      ) {
        dedupedMap.set(dedupeKey, normalizedEvent);
      }
      continue;
    }
    dedupedMap.set(dedupeKey, normalizedEvent);
  }

  const ordered = Array.from(dedupedMap.values()).sort((a, b) => {
    const verA = a.verificationStatus === 'VERIFIED_SOURCE' ? 1 : 0;
    const verB = b.verificationStatus === 'VERIFIED_SOURCE' ? 1 : 0;
    if (verA !== verB) return verB - verA;

    const scoreDiff = SCORE_RANK[b.score] - SCORE_RANK[a.score];
    if (scoreDiff !== 0) return scoreDiff;

    return a.startDate.localeCompare(b.startDate);
  });

  const limited = ordered.slice(0, cfg.maxResultsPerSearch);

  return {
    events: limited,
    diagnostics: {
      rawCount: list.length,
      keptCount: limited.length,
      filteredOutExpired,
      filteredOutHorizon,
      filteredOutDuration,
      filteredOutDuplicates,
    },
    referenceDateBrt,
    windowEndDateBrt,
  };
}

export function normalizeCanonicalCityInfo(
  rawCityInfo: any,
  fallbackCityName: string,
  referenceDateBrt: string,
  aiSource: string
): CanonicalCityInfo {
  const { city, state } = extractCityAndState(
    rawCityInfo?.name || fallbackCityName,
    fallbackCityName,
    cleanDisplayField(rawCityInfo?.state)
  );
  const perCapita =
    cleanDisplayField(rawCityInfo?.perCapitaIncome) ||
    cleanDisplayField(rawCityInfo?.rendaPerCapita) ||
    cleanDisplayField(rawCityInfo?.rendaDomiciliarPerCapitaMedia) ||
    'Não informado pelo IBGE local';
  const domiciliar =
    cleanDisplayField(rawCityInfo?.rendaDomiciliarPerCapitaMedia) || perCapita;

  return {
    name: city || fallbackCityName,
    state,
    summary: cleanDisplayField(
      rawCityInfo?.summary,
      `Panorama comercial de eventos para ${city || fallbackCityName}.`
    ),
    searchDate: cleanDisplayField(rawCityInfo?.searchDate, referenceDateBrt),
    population: cleanDisplayField(rawCityInfo?.population, 'Não informado'),
    perCapitaIncome: perCapita,
    rendaPerCapita: perCapita,
    rendaDomiciliarPerCapitaMedia: domiciliar,
    gdp: cleanDisplayField(rawCityInfo?.gdp, 'Não informado'),
    economicActivities: cleanDisplayField(rawCityInfo?.economicActivities, 'Comércio, serviços e agronegócio'),
    principaisFestasFixas: cleanDisplayField(
      rawCityInfo?.principaisFestasFixas,
      'Aniversário do município e calendário regional'
    ),
    cityAge: cleanDisplayField(rawCityInfo?.cityAge, 'Não informado'),
    aiSource: cleanDisplayField(rawCityInfo?.aiSource, aiSource),
  };
}

export function sanitizeCachedCityPayload(
  cachedData: any,
  cfg: EventSearchConfigValues,
  referenceDate?: Date
): { payload: CityEventSearchPipelineOutput; hadAllEventsExpired: boolean } {
  const rawEvents = Array.isArray(cachedData?.events) ? cachedData.events : [];
  const filtered = applyDeterministicEventFilter(rawEvents, cfg, {
    referenceDate,
    defaultCity: cachedData?.cityInfo?.name || '',
    defaultState: cachedData?.cityInfo?.state || '',
    preserveExistingVerificationWhenFromCache: true,
  });

  const hadAllEventsExpired = rawEvents.length > 0 && filtered.events.length === 0;
  const cityInfo = normalizeCanonicalCityInfo(
    cachedData?.cityInfo || {},
    cachedData?.cityInfo?.name || 'Município',
    filtered.referenceDateBrt,
    cachedData?.cityInfo?.aiSource || 'Cache Validado Lumora'
  );

  const prevMeta = cachedData?.searchMeta || {};
  const searchMeta: SearchMetaInfo = {
    model: prevMeta.model || DEFAULT_GEMINI_SEARCH_MODEL,
    pipelineVersion: prevMeta.pipelineVersion || 'v2-two-step-grounded',
    referenceDateBrt: filtered.referenceDateBrt,
    windowEndDateBrt: filtered.windowEndDateBrt,
    horizonDays: cfg.horizonDays,
    grounded: Boolean(prevMeta.grounded),
    webSearchQueries: Array.isArray(prevMeta.webSearchQueries) ? prevMeta.webSearchQueries : [],
    groundingSourcesCount: Number(prevMeta.groundingSourcesCount || 0),
    groundingSources: Array.isArray(prevMeta.groundingSources) ? prevMeta.groundingSources : [],
    diagnostics: filtered.diagnostics,
    tokens: prevMeta.tokens || combineStepUsage(
      { promptTokens: 0, outputTokens: 0, totalTokens: 0 },
      { promptTokens: 0, outputTokens: 0, totalTokens: 0 }
    ),
  };

  return {
    payload: {
      cityInfo,
      events: filtered.events,
      fetchedAt: cachedData?.fetchedAt || new Date().toISOString(),
      searchMeta,
    },
    hadAllEventsExpired,
  };
}

export function sanitizeCachedStateRadarPayload(
  cachedData: any,
  stateUF: string,
  cfg: EventSearchConfigValues,
  referenceDate?: Date
): { payload: StateRadarPipelineOutput; hadAllEventsExpired: boolean } {
  let rawEvents: any[] = [];
  if (Array.isArray(cachedData?.events)) {
    rawEvents = cachedData.events;
  } else if (Array.isArray(cachedData?.cities)) {
    // Compatibilidade com registros antigos no banco que tinham { cities: [{ city, events }] }
    for (const c of cachedData.cities) {
      if (Array.isArray(c?.events)) {
        for (const ev of c.events) {
          rawEvents.push({ ...ev, city: ev?.city || c?.city || '' });
        }
      }
    }
  }

  const filtered = applyDeterministicEventFilter(rawEvents, cfg, {
    referenceDate,
    defaultState: stateUF,
    preserveExistingVerificationWhenFromCache: true,
  });

  const hadAllEventsExpired = rawEvents.length > 0 && filtered.events.length === 0;
  const fetchedAt = cachedData?.fetchedAt || cachedData?.updatedAt || new Date().toISOString();
  const prevMeta = cachedData?.searchMeta || {};

  const searchMeta: SearchMetaInfo = {
    model: prevMeta.model || DEFAULT_GEMINI_SEARCH_MODEL,
    pipelineVersion: prevMeta.pipelineVersion || 'v2-two-step-grounded',
    referenceDateBrt: filtered.referenceDateBrt,
    windowEndDateBrt: filtered.windowEndDateBrt,
    horizonDays: cfg.horizonDays,
    grounded: Boolean(prevMeta.grounded),
    webSearchQueries: Array.isArray(prevMeta.webSearchQueries) ? prevMeta.webSearchQueries : [],
    groundingSourcesCount: Number(prevMeta.groundingSourcesCount || 0),
    groundingSources: Array.isArray(prevMeta.groundingSources) ? prevMeta.groundingSources : [],
    diagnostics: filtered.diagnostics,
    tokens: prevMeta.tokens || combineStepUsage(
      { promptTokens: 0, outputTokens: 0, totalTokens: 0 },
      { promptTokens: 0, outputTokens: 0, totalTokens: 0 }
    ),
  };

  return {
    payload: {
      state: stateUF,
      updatedAt: fetchedAt,
      fetchedAt,
      events: filtered.events,
      searchMeta,
    },
    hadAllEventsExpired,
  };
}

async function runWithTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        controller.abort();
      } catch (_) {}
      const err: any = new Error('AI_TIMEOUT');
      err.name = 'AbortError';
      reject(err);
    }, timeoutMs);
  });

  const execution = work(controller.signal);
  execution.catch(() => {});

  try {
    return await Promise.race([execution, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildStep2ExtractionPrompt(params: {
  mode: 'CITY' | 'STATE_RADAR';
  city?: string;
  stateUF?: string;
  referenceDateBrt: string;
  windowEndDateBrt: string;
  cfg: EventSearchConfigValues;
  step1ResearchText: string;
  groundingSources: GroundingSourceItem[];
}): string {
  const sourcesBlock =
    params.groundingSources.length > 0
      ? params.groundingSources
          .map((s) => `[${s.index}] ${s.title} | Plataforma: ${s.platform} | URL: ${s.uri}`)
          .join('\n')
      : '(Nenhuma URL retornada pelo Google Search Grounding nesta consulta)';

  const targetDesc =
    params.mode === 'CITY'
      ? `Município alvo: "${params.city}". Extraia também os dados demográficos reais em cityInfo.`
      : `Estado alvo (UF): "${params.stateUF}". Retorne a lista unificada em "events" contendo eventos reais das cidades do estado.`;

  return `Você é um extrator estruturado rigoroso de inteligência comercial.
Converta o dossiê pesquisado abaixo em JSON estritamente aderente ao schema fornecido.

REGRAS OBRIGATÓRIAS DE EXTRAÇÃO:
1. ${targetDesc}
2. Data de hoje (Brasília -03:00): ${params.referenceDateBrt}. Janela permitida: ${params.referenceDateBrt} até ${params.windowEndDateBrt}.
3. NÃO inclua eventos cuja data final (endDate) seja anterior a ${params.referenceDateBrt} nem eventos fora da janela.
4. Use formato estrito YYYY-MM-DD em startDate e endDate. Se um evento não tiver data identificável, omita-o.
5. Para sourceIndex e sourceUrl: associe APENAS URLs reais listadas em VERIFIED_GROUNDING_SOURCES que comprovem o evento. Se não houver URL verificada correspondente, use sourceIndex: null e sourceUrl: "". NUNCA invente URLs fictícias.
6. Preencha ticketPrice, estimatedAudience, organizerContact, socialMedia, location e notes com dados objetivos em português (sem escrever "N/A").

VERIFIED_GROUNDING_SOURCES:
${sourcesBlock}

DOSSIÊ PESQUISADO NO PASSO 1:
${params.step1ResearchText || '(Sem texto retornado no Passo 1)'}`;
}

export async function runTwoStepCityEventSearch(params: {
  aiClient: GenerativeAiModelsLike;
  city: string;
  config: EventSearchConfigValues;
  referenceDate?: Date;
  model?: string;
  step1TimeoutMs?: number;
  step2TimeoutMs?: number;
  onLateResponseAfterTimeout?: () => Promise<void>;
}): Promise<CityEventSearchPipelineOutput> {
  const model = params.model || DEFAULT_GEMINI_SEARCH_MODEL;
  const step1TimeoutMs = Math.max(50000, params.step1TimeoutMs ?? DEFAULT_STEP1_TIMEOUT_MS);
  const step2TimeoutMs = params.step2TimeoutMs ?? DEFAULT_STEP2_TIMEOUT_MS;
  const referenceDate = params.referenceDate || new Date();
  const referenceDateBrt = formatDateBrt(referenceDate);
  const windowEndDateBrt = addDaysToDateIso(referenceDateBrt, params.config.horizonDays);

  const step1Prompt = buildRenderedEventPrompt(params.config, {
    mode: 'CITY',
    city: params.city,
    referenceDate,
  });

  // ── PASSO 1: Pesquisa Web com Google Search Grounding ─────────────────────
  let timedOutStep1 = false;
  let step1Resp: any;
  try {
    step1Resp = await runWithTimeout(async (signal) => {
      const p = params.aiClient.models.generateContent({
        model,
        contents: step1Prompt,
        config: {
          temperature: 0.1,
          tools: [{ googleSearch: {} }],
          thinkingConfig: { thinkingBudget: 0 },
          abortSignal: signal,
        },
      });
      p.then(async () => {
        if (timedOutStep1 && params.onLateResponseAfterTimeout) {
          await params.onLateResponseAfterTimeout();
        }
      }).catch(() => {});
      return await p;
    }, step1TimeoutMs);
  } catch (err: any) {
    if (err?.name === 'AbortError' || err?.message === 'AI_TIMEOUT') {
      timedOutStep1 = true;
    }
    throw err;
  }

  const step1Usage = readStepUsage(step1Resp);
  const step1Text = String(step1Resp?.text || '').slice(0, 60000);
  const grounding = extractGroundingMetadataInfo(step1Resp);

  // ── PASSO 2: Extração Estruturada JSON estrita (sem tools) ────────────────
  const step2Prompt = buildStep2ExtractionPrompt({
    mode: 'CITY',
    city: params.city,
    referenceDateBrt,
    windowEndDateBrt,
    cfg: params.config,
    step1ResearchText: step1Text,
    groundingSources: grounding.groundingSources,
  });

  let step2Resp: any;
  try {
    step2Resp = await runWithTimeout(async (signal) => {
      return await params.aiClient.models.generateContent({
        model,
        contents: step2Prompt,
        config: {
          temperature: 0.0,
          responseMimeType: 'application/json',
          responseSchema: CITY_EXTRACTION_SCHEMA,
          thinkingConfig: { thinkingBudget: 0 },
          abortSignal: signal,
        },
      });
    }, step2TimeoutMs);
  } catch (err: any) {
    if (err?.name === 'AbortError' || err?.message === 'AI_TIMEOUT') {
      throw err;
    }
    const partialTokens = combineStepUsage(step1Usage, {
      promptTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    });
    throw new EventSearchExtractionError(
      `Falha na chamada de extração estruturada (Passo 2): ${err?.message || err}`,
      partialTokens
    );
  }

  const step2Usage = readStepUsage(step2Resp);
  const combinedTokens = combineStepUsage(step1Usage, step2Usage);
  const rawStep2Text = String(step2Resp?.text || '');
  const cleanJson = extractCleanJsonPayload(rawStep2Text);

  let parsed: any;
  try {
    if (!cleanJson) {
      throw new Error('Resposta vazia no Passo 2 de extração JSON.');
    }
    parsed = JSON.parse(cleanJson);
  } catch (parseErr: any) {
    throw new EventSearchExtractionError(
      `JSON inválido retornado no Passo 2: ${parseErr?.message || parseErr}`,
      combinedTokens,
      rawStep2Text
    );
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.events)) {
    throw new EventSearchExtractionError(
      'Estrutura JSON do Passo 2 não contém array "events" válido.',
      combinedTokens,
      rawStep2Text
    );
  }

  const filtered = applyDeterministicEventFilter(parsed.events, params.config, {
    referenceDate,
    groundingSources: grounding.groundingSources,
    defaultCity: params.city,
    preserveExistingVerificationWhenFromCache: false,
  });

  const aiSourceLabel = grounding.grounded
    ? `Google Gemini (${model}) · Google Search Grounding (${grounding.groundingSources.length} fonte(s))`
    : `Google Gemini (${model}) · Estimativa sem fontes web retornadas`;

  const cityInfo = normalizeCanonicalCityInfo(
    parsed.cityInfo || {},
    params.city,
    referenceDateBrt,
    aiSourceLabel
  );

  const fetchedAt = new Date().toISOString();

  return {
    cityInfo,
    events: filtered.events,
    fetchedAt,
    searchMeta: {
      model,
      pipelineVersion: 'v2-two-step-grounded',
      referenceDateBrt,
      windowEndDateBrt,
      horizonDays: params.config.horizonDays,
      grounded: grounding.grounded,
      webSearchQueries: grounding.webSearchQueries,
      groundingSourcesCount: grounding.groundingSources.length,
      groundingSources: grounding.groundingSources,
      diagnostics: filtered.diagnostics,
      tokens: combinedTokens,
    },
  };
}

export async function runTwoStepStateRadarSearch(params: {
  aiClient: GenerativeAiModelsLike;
  stateUF: string;
  config: EventSearchConfigValues;
  referenceDate?: Date;
  model?: string;
  step1TimeoutMs?: number;
  step2TimeoutMs?: number;
  onLateResponseAfterTimeout?: () => Promise<void>;
}): Promise<StateRadarPipelineOutput> {
  const model = params.model || DEFAULT_GEMINI_SEARCH_MODEL;
  const step1TimeoutMs = Math.max(50000, params.step1TimeoutMs ?? DEFAULT_STEP1_TIMEOUT_MS);
  const step2TimeoutMs = params.step2TimeoutMs ?? DEFAULT_STEP2_TIMEOUT_MS;
  const referenceDate = params.referenceDate || new Date();
  const referenceDateBrt = formatDateBrt(referenceDate);
  const windowEndDateBrt = addDaysToDateIso(referenceDateBrt, params.config.horizonDays);

  const step1Prompt = buildRenderedEventPrompt(params.config, {
    mode: 'STATE_RADAR',
    stateUF: params.stateUF,
    referenceDate,
  });

  let timedOutStep1 = false;
  let step1Resp: any;
  try {
    step1Resp = await runWithTimeout(async (signal) => {
      const p = params.aiClient.models.generateContent({
        model,
        contents: step1Prompt,
        config: {
          temperature: 0.1,
          tools: [{ googleSearch: {} }],
          thinkingConfig: { thinkingBudget: 0 },
          abortSignal: signal,
        },
      });
      p.then(async () => {
        if (timedOutStep1 && params.onLateResponseAfterTimeout) {
          await params.onLateResponseAfterTimeout();
        }
      }).catch(() => {});
      return await p;
    }, step1TimeoutMs);
  } catch (err: any) {
    if (err?.name === 'AbortError' || err?.message === 'AI_TIMEOUT') {
      timedOutStep1 = true;
    }
    throw err;
  }

  const step1Usage = readStepUsage(step1Resp);
  const step1Text = String(step1Resp?.text || '').slice(0, 60000);
  const grounding = extractGroundingMetadataInfo(step1Resp);

  const step2Prompt = buildStep2ExtractionPrompt({
    mode: 'STATE_RADAR',
    stateUF: params.stateUF,
    referenceDateBrt,
    windowEndDateBrt,
    cfg: params.config,
    step1ResearchText: step1Text,
    groundingSources: grounding.groundingSources,
  });

  let step2Resp: any;
  try {
    step2Resp = await runWithTimeout(async (signal) => {
      return await params.aiClient.models.generateContent({
        model,
        contents: step2Prompt,
        config: {
          temperature: 0.0,
          responseMimeType: 'application/json',
          responseSchema: STATE_RADAR_EXTRACTION_SCHEMA,
          thinkingConfig: { thinkingBudget: 0 },
          abortSignal: signal,
        },
      });
    }, step2TimeoutMs);
  } catch (err: any) {
    if (err?.name === 'AbortError' || err?.message === 'AI_TIMEOUT') {
      throw err;
    }
    const partialTokens = combineStepUsage(step1Usage, {
      promptTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    });
    throw new EventSearchExtractionError(
      `Falha na chamada de extração estruturada do Radar (Passo 2): ${err?.message || err}`,
      partialTokens
    );
  }

  const step2Usage = readStepUsage(step2Resp);
  const combinedTokens = combineStepUsage(step1Usage, step2Usage);
  const rawStep2Text = String(step2Resp?.text || '');
  const cleanJson = extractCleanJsonPayload(rawStep2Text);

  let parsed: any;
  try {
    if (!cleanJson) {
      throw new Error('Resposta vazia no Passo 2 do Radar Estadual.');
    }
    parsed = JSON.parse(cleanJson);
  } catch (parseErr: any) {
    throw new EventSearchExtractionError(
      `JSON inválido retornado no Passo 2 do Radar: ${parseErr?.message || parseErr}`,
      combinedTokens,
      rawStep2Text
    );
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.events)) {
    throw new EventSearchExtractionError(
      'Estrutura JSON do Passo 2 do Radar não contém array "events" válido.',
      combinedTokens,
      rawStep2Text
    );
  }

  const filtered = applyDeterministicEventFilter(parsed.events, params.config, {
    referenceDate,
    groundingSources: grounding.groundingSources,
    defaultState: params.stateUF,
    preserveExistingVerificationWhenFromCache: false,
  });

  const fetchedAt = new Date().toISOString();

  return {
    state: params.stateUF,
    updatedAt: fetchedAt,
    fetchedAt,
    events: filtered.events,
    searchMeta: {
      model,
      pipelineVersion: 'v2-two-step-grounded',
      referenceDateBrt,
      windowEndDateBrt,
      horizonDays: params.config.horizonDays,
      grounded: grounding.grounded,
      webSearchQueries: grounding.webSearchQueries,
      groundingSourcesCount: grounding.groundingSources.length,
      groundingSources: grounding.groundingSources,
      diagnostics: filtered.diagnostics,
      tokens: combinedTokens,
    },
  };
}
