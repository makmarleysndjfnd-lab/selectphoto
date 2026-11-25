import crypto from 'crypto';
import { prisma } from './prisma';
import { recordOperationalAuditEvent } from './operationalAuditService';

export interface EventSearchTypeItem {
  id: string;
  name: string;
  detail: string;
  enabled: boolean;
}

export interface EventSearchExclusionItem {
  id: string;
  text: string;
}

export const VALID_WEEKDAYS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'] as const;
export type WeekdayCode = (typeof VALID_WEEKDAYS)[number];

export const VALID_CITY_POPULATION_PROFILES = ['ALL', 'SMALL_MEDIUM', 'LARGE'] as const;
export type CityPopulationProfile = (typeof VALID_CITY_POPULATION_PROFILES)[number];

export const VALID_AUDIENCE_FOCUS = ['FAMILY_KIDS', 'GENERAL', 'NIGHTLIFE'] as const;
export type AudienceFocus = (typeof VALID_AUDIENCE_FOCUS)[number];

export const VALID_ENTRY_TYPE_PREFERENCES = ['ANY', 'FREE_ONLY', 'PAID_OK'] as const;
export type EntryTypePreference = (typeof VALID_ENTRY_TYPE_PREFERENCES)[number];

export const VALID_CONFIRMATION_LEVELS = [
  'CONFIRMED_ONLY',
  'CONFIRMED_AND_TRADITIONAL',
] as const;
export type ConfirmationLevel = (typeof VALID_CONFIRMATION_LEVELS)[number];

export interface EventSearchConfigValues {
  searchDescription: string;
  eventTypes: EventSearchTypeItem[];
  horizonDays: number;
  priorityWeekdays: WeekdayCode[];
  includeHolidays: boolean;
  geographicFocus: string;
  exclusions: EventSearchExclusionItem[];
  // Etapa 31: Expansão Avançada
  minDurationDays: number;
  maxDurationDays: number | null;
  allowSingleDayIfLarge: boolean;
  minEstimatedAudience: number | null;
  cityPopulationProfile: CityPopulationProfile;
  audienceFocus: AudienceFocus;
  entryTypePreference: EntryTypePreference;
  confirmationLevel: ConfirmationLevel;
  baseCity: string;
  maxRadiusKm: number | null;
  priorityStates: string[];
  priorityStatesJson: string | null;
  maxResultsPerSearch: number;
  cacheTtlDays: number;
}

export interface CompanyEventSearchConfigDTO extends EventSearchConfigValues {
  companyId: string | null;
  isDefault: boolean;
  configHash: string;
  renderedPromptPreview: string;
  updatedById: string | null;
  updatedAt: string | null;
}

export const DEFAULT_EVENT_SEARCH_CONFIG: EventSearchConfigValues = {
  searchDescription:
    'Você é um agente de Inteligência Comercial e Investigador de Eventos ("pente fino" rigoroso) focado em oportunidades presenciais para venda fotográfica. Priorize eventos confirmados na janela de datas solicitada, levantando nome oficial, categoria, datas exatas, local, público estimado, histórico de edições anteriores, organizador, contato, redes sociais (@perfil), site oficial, observações comerciais e fontes verificáveis.',
  eventTypes: [
    {
      id: 'expo_agro',
      name: 'Exposição Agropecuária',
      detail: 'Feiras agropecuárias, exposições rurais, rodeios e leilões com grande fluxo de famílias.',
      enabled: true,
    },
    {
      id: 'show',
      name: 'Show',
      detail: 'Shows musicais, turnês regionais, arenas e festivais com grande concentração de público.',
      enabled: true,
    },
    {
      id: 'festa_tradicional',
      name: 'Festa Tradicional',
      detail: 'Festas regionais, festivais culturais, aniversários de município, quermesses e festas religiosas tradicionais.',
      enabled: true,
    },
    {
      id: 'circo',
      name: 'Circo',
      detail: 'Circos itinerantes em temporada presencial voltados ao público infantil e familiar.',
      enabled: true,
    },
    {
      id: 'parque',
      name: 'Parque',
      detail: 'Parques de diversões itinerantes ou sazonais em operação aberta ao público.',
      enabled: true,
    },
  ],
  horizonDays: 380,
  priorityWeekdays: ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'],
  includeHolidays: true,
  geographicFocus: '',
  exclusions: [
    {
      id: 'no_unconfirmed',
      text: 'Eventos fictícios, boatos sem fonte confiável ou edições já encerradas fora da janela de datas.',
    },
    {
      id: 'no_private_closed',
      text: 'Eventos privados fechados ao público (casamentos, festas particulares e reuniões corporativas internas).',
    },
    {
      id: 'no_online_only',
      text: 'Eventos exclusivamente online, transmissões digitais ou webinars sem público presencial.',
    },
  ],
  minDurationDays: 1,
  maxDurationDays: null,
  allowSingleDayIfLarge: true,
  minEstimatedAudience: null,
  cityPopulationProfile: 'ALL',
  audienceFocus: 'FAMILY_KIDS',
  entryTypePreference: 'ANY',
  confirmationLevel: 'CONFIRMED_AND_TRADITIONAL',
  baseCity: '',
  maxRadiusKm: null,
  priorityStates: [],
  priorityStatesJson: null,
  maxResultsPerSearch: 20,
  cacheTtlDays: 7,
};

function sanitizeText(raw: unknown, maxLen: number): string {
  return String(raw ?? '')
    .replace(/[\r\n\x00-\x08\x0B\x0C\x0E-\x1F]+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function sanitizeMultilineText(raw: unknown, maxLen: number): string {
  return String(raw ?? '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .trim()
    .slice(0, maxLen);
}

export function normalizeEventTypes(input: unknown, strict = false): EventSearchTypeItem[] {
  if (!Array.isArray(input)) {
    if (strict) {
      throw Object.assign(new Error('eventTypes deve ser uma lista válida.'), { status: 400 });
    }
    return DEFAULT_EVENT_SEARCH_CONFIG.eventTypes.map((e) => ({ ...e }));
  }

  if (input.length > 40) {
    throw Object.assign(new Error('Limite máximo de 40 tipos de eventos atingido.'), { status: 400 });
  }

  const out: EventSearchTypeItem[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < input.length; i++) {
    const raw = input[i] as any;
    const name = sanitizeText(raw?.name, 100);
    if (!name) {
      if (strict) {
        throw Object.assign(new Error(`Tipo de evento #${i + 1} precisa ter nome preenchido.`), {
          status: 400,
        });
      }
      continue;
    }
    const detail = sanitizeText(raw?.detail, 300);
    const enabled = raw?.enabled !== undefined ? Boolean(raw.enabled) : true;
    let id = sanitizeText(raw?.id, 60).replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!id || seenIds.has(id)) {
      id = `type_${i + 1}_${crypto.createHash('sha1').update(name).digest('hex').slice(0, 6)}`;
    }
    seenIds.add(id);
    out.push({ id, name, detail, enabled });
  }

  return out;
}

export function normalizeWeekdays(input: unknown, strict = false): WeekdayCode[] {
  if (!Array.isArray(input)) {
    if (strict) {
      throw Object.assign(new Error('priorityWeekdays deve ser uma lista de dias (SEG..DOM).'), {
        status: 400,
      });
    }
    return [...DEFAULT_EVENT_SEARCH_CONFIG.priorityWeekdays];
  }

  const validSet = new Set<string>(VALID_WEEKDAYS);
  const picked = new Set<WeekdayCode>();

  for (const item of input) {
    const code = String(item ?? '').trim().toUpperCase();
    if (!validSet.has(code)) {
      if (strict) {
        throw Object.assign(
          new Error(`Dia da semana inválido: '${code}'. Use SEG, TER, QUA, QUI, SEX, SAB ou DOM.`),
          { status: 400 }
        );
      }
      continue;
    }
    picked.add(code as WeekdayCode);
  }

  if (strict && picked.size === 0) {
    throw Object.assign(new Error('Selecione pelo menos um dia da semana para a busca.'), {
      status: 400,
    });
  }

  if (picked.size === 0) {
    return [...DEFAULT_EVENT_SEARCH_CONFIG.priorityWeekdays];
  }

  return VALID_WEEKDAYS.filter((d) => picked.has(d));
}

export function normalizeExclusions(input: unknown, strict = false): EventSearchExclusionItem[] {
  if (!Array.isArray(input)) {
    if (strict) {
      throw Object.assign(new Error('exclusions deve ser uma lista válida.'), { status: 400 });
    }
    return DEFAULT_EVENT_SEARCH_CONFIG.exclusions.map((e) => ({ ...e }));
  }

  if (input.length > 40) {
    throw Object.assign(new Error('Limite máximo de 40 exclusões atingido.'), { status: 400 });
  }

  const out: EventSearchExclusionItem[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < input.length; i++) {
    const raw = input[i] as any;
    const text =
      typeof raw === 'string' ? sanitizeText(raw, 300) : sanitizeText(raw?.text, 300);
    if (!text) {
      if (strict) {
        throw Object.assign(new Error(`Item de exclusão #${i + 1} não pode ser vazio.`), {
          status: 400,
        });
      }
      continue;
    }
    let id =
      typeof raw === 'object' && raw?.id
        ? sanitizeText(raw.id, 60).replace(/[^a-zA-Z0-9_-]/g, '_')
        : '';
    if (!id || seenIds.has(id)) {
      id = `excl_${i + 1}_${crypto.createHash('sha1').update(text).digest('hex').slice(0, 6)}`;
    }
    seenIds.add(id);
    out.push({ id, text });
  }

  return out;
}

export function normalizePriorityStates(rawStates: unknown, rawJson?: unknown): string[] {
  let source = rawStates;
  if ((source === undefined || source === null) && typeof rawJson === 'string' && rawJson.trim()) {
    try {
      const parsed = JSON.parse(rawJson);
      source = parsed;
    } catch {
      source = rawJson.split(/[,;\s]+/).filter(Boolean);
    }
  } else if (typeof source === 'string') {
    const trimmed = source.trim();
    if (trimmed.startsWith('[')) {
      try {
        source = JSON.parse(trimmed);
      } catch {
        source = trimmed.split(/[,;\s]+/).filter(Boolean);
      }
    } else {
      source = trimmed.split(/[,;\s]+/).filter(Boolean);
    }
  }

  if (!Array.isArray(source)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of source) {
    const uf = String(item ?? '').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
    if (uf.length === 2 && !seen.has(uf)) {
      seen.add(uf);
      out.push(uf);
    }
  }
  return out;
}

function parseOptionalInt(
  value: unknown,
  field: string,
  min: number,
  max: number,
  strict: boolean
): number | null {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }
  const num = Number(value);
  if (!Number.isInteger(num) || num < min || num > max) {
    if (strict) {
      throw Object.assign(
        new Error(`${field} deve ser um número inteiro entre ${min} e ${max}.`),
        { status: 400 }
      );
    }
    return null;
  }
  return num;
}

function parseEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  field: string,
  strict: boolean
): T {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }
  const normalized = String(value).trim().toUpperCase() as T;
  if (allowed.includes(normalized)) return normalized;
  if (strict) {
    throw Object.assign(
      new Error(`${field} inválido: '${value}'. Permitidos: ${allowed.join(', ')}.`),
      { status: 400 }
    );
  }
  return fallback;
}

export function normalizeEventSearchConfigValues(
  raw: Partial<EventSearchConfigValues> | any,
  strict = false
): EventSearchConfigValues {
  const horizonRaw =
    raw?.horizonDays !== undefined ? Number(raw.horizonDays) : DEFAULT_EVENT_SEARCH_CONFIG.horizonDays;
  if (!Number.isInteger(horizonRaw) || horizonRaw < 1 || horizonRaw > 730) {
    if (strict) {
      throw Object.assign(
        new Error('horizonDays deve ser um número inteiro entre 1 e 730 dias.'),
        { status: 400 }
      );
    }
  }
  const horizonDays =
    Number.isInteger(horizonRaw) && horizonRaw >= 1 && horizonRaw <= 730
      ? horizonRaw
      : DEFAULT_EVENT_SEARCH_CONFIG.horizonDays;

  const searchDescription =
    raw?.searchDescription !== undefined
      ? sanitizeMultilineText(raw.searchDescription, 12000)
      : DEFAULT_EVENT_SEARCH_CONFIG.searchDescription;

  if (strict && !searchDescription) {
    throw Object.assign(
      new Error('A descrição detalhada da busca (searchDescription) não pode ser vazia.'),
      { status: 400 }
    );
  }

  const eventTypes =
    raw?.eventTypes !== undefined
      ? normalizeEventTypes(raw.eventTypes, strict)
      : DEFAULT_EVENT_SEARCH_CONFIG.eventTypes.map((e) => ({ ...e }));

  if (strict && eventTypes.filter((e) => e.enabled).length === 0) {
    throw Object.assign(
      new Error('Mantenha pelo menos 1 tipo de evento ativo para orientar a busca.'),
      { status: 400 }
    );
  }

  const priorityWeekdays =
    raw?.priorityWeekdays !== undefined
      ? normalizeWeekdays(raw.priorityWeekdays, strict)
      : [...DEFAULT_EVENT_SEARCH_CONFIG.priorityWeekdays];

  const includeHolidays =
    raw?.includeHolidays !== undefined
      ? Boolean(raw.includeHolidays)
      : DEFAULT_EVENT_SEARCH_CONFIG.includeHolidays;

  const geographicFocus =
    raw?.geographicFocus !== undefined
      ? sanitizeText(raw.geographicFocus, 250)
      : DEFAULT_EVENT_SEARCH_CONFIG.geographicFocus;

  const exclusions =
    raw?.exclusions !== undefined
      ? normalizeExclusions(raw.exclusions, strict)
      : DEFAULT_EVENT_SEARCH_CONFIG.exclusions.map((e) => ({ ...e }));

  const minDurationRaw =
    raw?.minDurationDays !== undefined
      ? Number(raw.minDurationDays)
      : DEFAULT_EVENT_SEARCH_CONFIG.minDurationDays;
  if (!Number.isInteger(minDurationRaw) || minDurationRaw < 1 || minDurationRaw > 365) {
    if (strict) {
      throw Object.assign(
        new Error('minDurationDays deve ser um número inteiro entre 1 e 365.'),
        { status: 400 }
      );
    }
  }
  const minDurationDays =
    Number.isInteger(minDurationRaw) && minDurationRaw >= 1 && minDurationRaw <= 365
      ? minDurationRaw
      : DEFAULT_EVENT_SEARCH_CONFIG.minDurationDays;

  const maxDurationDays = parseOptionalInt(
    raw?.maxDurationDays,
    'maxDurationDays',
    1,
    365,
    strict
  );
  if (strict && maxDurationDays !== null && maxDurationDays < minDurationDays) {
    throw Object.assign(
      new Error('Duração máxima (maxDurationDays) deve ser maior ou igual à duração mínima.'),
      { status: 400 }
    );
  }

  const allowSingleDayIfLarge =
    raw?.allowSingleDayIfLarge !== undefined
      ? Boolean(raw.allowSingleDayIfLarge)
      : DEFAULT_EVENT_SEARCH_CONFIG.allowSingleDayIfLarge;

  const minEstimatedAudience = parseOptionalInt(
    raw?.minEstimatedAudience,
    'minEstimatedAudience',
    0,
    10000000,
    strict
  );

  const cityPopulationProfile = parseEnum(
    raw?.cityPopulationProfile,
    VALID_CITY_POPULATION_PROFILES,
    DEFAULT_EVENT_SEARCH_CONFIG.cityPopulationProfile,
    'cityPopulationProfile',
    strict
  );

  const audienceFocus = parseEnum(
    raw?.audienceFocus,
    VALID_AUDIENCE_FOCUS,
    DEFAULT_EVENT_SEARCH_CONFIG.audienceFocus,
    'audienceFocus',
    strict
  );

  const entryTypePreference = parseEnum(
    raw?.entryTypePreference,
    VALID_ENTRY_TYPE_PREFERENCES,
    DEFAULT_EVENT_SEARCH_CONFIG.entryTypePreference,
    'entryTypePreference',
    strict
  );

  const confirmationLevel = parseEnum(
    raw?.confirmationLevel,
    VALID_CONFIRMATION_LEVELS,
    DEFAULT_EVENT_SEARCH_CONFIG.confirmationLevel,
    'confirmationLevel',
    strict
  );

  const baseCity =
    raw?.baseCity !== undefined
      ? sanitizeText(raw.baseCity, 120)
      : DEFAULT_EVENT_SEARCH_CONFIG.baseCity;

  const maxRadiusKm = parseOptionalInt(raw?.maxRadiusKm, 'maxRadiusKm', 1, 5000, strict);

  const priorityStates = normalizePriorityStates(raw?.priorityStates, raw?.priorityStatesJson);
  const priorityStatesJson =
    priorityStates.length > 0 ? JSON.stringify(priorityStates) : null;

  const maxResultsRaw =
    raw?.maxResultsPerSearch !== undefined
      ? Number(raw.maxResultsPerSearch)
      : DEFAULT_EVENT_SEARCH_CONFIG.maxResultsPerSearch;
  if (!Number.isInteger(maxResultsRaw) || maxResultsRaw < 1 || maxResultsRaw > 50) {
    if (strict) {
      throw Object.assign(
        new Error('maxResultsPerSearch deve ser um número inteiro entre 1 e 50.'),
        { status: 400 }
      );
    }
  }
  const maxResultsPerSearch =
    Number.isInteger(maxResultsRaw) && maxResultsRaw >= 1 && maxResultsRaw <= 50
      ? maxResultsRaw
      : DEFAULT_EVENT_SEARCH_CONFIG.maxResultsPerSearch;

  const cacheTtlRaw =
    raw?.cacheTtlDays !== undefined
      ? Number(raw.cacheTtlDays)
      : DEFAULT_EVENT_SEARCH_CONFIG.cacheTtlDays;
  if (!Number.isInteger(cacheTtlRaw) || cacheTtlRaw < 0 || cacheTtlRaw > 30) {
    if (strict) {
      throw Object.assign(
        new Error('cacheTtlDays deve ser um número inteiro entre 0 e 30 dias.'),
        { status: 400 }
      );
    }
  }
  const cacheTtlDays =
    Number.isInteger(cacheTtlRaw) && cacheTtlRaw >= 0 && cacheTtlRaw <= 30
      ? cacheTtlRaw
      : DEFAULT_EVENT_SEARCH_CONFIG.cacheTtlDays;

  return {
    searchDescription: searchDescription || DEFAULT_EVENT_SEARCH_CONFIG.searchDescription,
    eventTypes,
    horizonDays,
    priorityWeekdays,
    includeHolidays,
    geographicFocus,
    exclusions,
    minDurationDays,
    maxDurationDays:
      maxDurationDays !== null && maxDurationDays < minDurationDays
        ? minDurationDays
        : maxDurationDays,
    allowSingleDayIfLarge,
    minEstimatedAudience,
    cityPopulationProfile,
    audienceFocus,
    entryTypePreference,
    confirmationLevel,
    baseCity,
    maxRadiusKm,
    priorityStates,
    priorityStatesJson,
    maxResultsPerSearch,
    cacheTtlDays,
  };
}

export function computeEventSearchConfigHash(cfg: EventSearchConfigValues): string {
  const canonical = {
    searchDescription: cfg.searchDescription,
    horizonDays: cfg.horizonDays,
    includeHolidays: cfg.includeHolidays,
    geographicFocus: cfg.geographicFocus,
    priorityWeekdays: cfg.priorityWeekdays,
    eventTypes: cfg.eventTypes.map((e) => ({
      id: e.id,
      name: e.name,
      detail: e.detail,
      enabled: e.enabled,
    })),
    exclusions: cfg.exclusions.map((x) => ({ id: x.id, text: x.text })),
    minDurationDays: cfg.minDurationDays,
    maxDurationDays: cfg.maxDurationDays,
    allowSingleDayIfLarge: cfg.allowSingleDayIfLarge,
    minEstimatedAudience: cfg.minEstimatedAudience,
    cityPopulationProfile: cfg.cityPopulationProfile,
    audienceFocus: cfg.audienceFocus,
    entryTypePreference: cfg.entryTypePreference,
    confirmationLevel: cfg.confirmationLevel,
    baseCity: cfg.baseCity,
    maxRadiusKm: cfg.maxRadiusKm,
    priorityStates: cfg.priorityStates,
    maxResultsPerSearch: cfg.maxResultsPerSearch,
    cacheTtlDays: cfg.cacheTtlDays,
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

const CITY_POP_LABEL: Record<CityPopulationProfile, string> = {
  ALL: 'Qualquer porte de cidade',
  SMALL_MEDIUM: 'Cidades pequenas e médias',
  LARGE: 'Cidades grandes e regiões metropolitanas',
};

const AUDIENCE_FOCUS_LABEL: Record<AudienceFocus, string> = {
  FAMILY_KIDS: 'Famílias e crianças (foco fotográfico infantil/familiar)',
  GENERAL: 'Público geral amplo',
  NIGHTLIFE: 'Público adulto e vida noturna',
};

const ENTRY_PREF_LABEL: Record<EntryTypePreference, string> = {
  ANY: 'Entrada gratuita ou paga',
  FREE_ONLY: 'Priorizar entrada gratuita / acesso aberto',
  PAID_OK: 'Eventos pagos com bilheteria ou controle de acesso',
};

const CONFIRMATION_LEVEL_LABEL: Record<ConfirmationLevel, string> = {
  CONFIRMED_ONLY: 'Somente edições oficialmente confirmadas com data fechada',
  CONFIRMED_AND_TRADITIONAL: 'Eventos confirmados e edições tradicionais recorrentes do calendário local',
};

export function formatDateBrt(date: Date = new Date()): string {
  // Horário oficial de Brasília (UTC-03:00)
  const brtMs = date.getTime() - 3 * 60 * 60 * 1000;
  const brt = new Date(brtMs);
  const year = brt.getUTCFullYear();
  const month = String(brt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(brt.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDaysToDateIso(yyyyMmDd: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(yyyyMmDd || '').trim());
  if (!match) {
    return formatDateBrt(new Date(Date.now() + days * 24 * 3600 * 1000));
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const sy = shifted.getUTCFullYear();
  const sm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const sd = String(shifted.getUTCDate()).padStart(2, '0');
  return `${sy}-${sm}-${sd}`;
}

export function buildRenderedEventPrompt(
  cfg: EventSearchConfigValues,
  target: { mode: 'CITY' | 'STATE_RADAR'; city?: string; stateUF?: string; referenceDate?: Date } = {
    mode: 'CITY',
    city: '<CIDADE>',
  }
): string {
  const baseDate = target.referenceDate ? new Date(target.referenceDate) : new Date();
  const currentDateStr = formatDateBrt(baseDate);
  const maxDateStr = addDaysToDateIso(currentDateStr, cfg.horizonDays);
  const safeSearchDescription = sanitizeMultilineText(cfg.searchDescription, 8000);

  const activeTypes = cfg.eventTypes.filter((t) => t.enabled);
  const categorySample =
    activeTypes.map((t) => t.name).join(' / ') || 'Exposição Agropecuária / Show / Festa Tradicional';
  const typesBlock = activeTypes
    .map((t) => `- ${t.name}${t.detail ? `: ${t.detail}` : ''}`)
    .join('\n');

  const weekdaysLabel = cfg.priorityWeekdays.join(', ');
  const holidaysRule = cfg.includeHolidays
    ? 'Incluir feriados nacionais, estaduais e municipais no período.'
    : 'Não priorizar feriados isolados sem evento confirmado.';

  const durationRule = cfg.maxDurationDays
    ? `Duração entre ${cfg.minDurationDays} e ${cfg.maxDurationDays} dia(s).`
    : `Duração mínima de ${cfg.minDurationDays} dia(s).`;
  const singleDayRule = cfg.allowSingleDayIfLarge
    ? 'Aceitar eventos de 1 dia apenas quando forem de grande porte/público expressivo.'
    : 'Descartar eventos de apenas 1 dia.';

  const audienceMinRule =
    cfg.minEstimatedAudience !== null && cfg.minEstimatedAudience > 0
      ? `Público estimado mínimo: ${cfg.minEstimatedAudience.toLocaleString('pt-BR')} pessoas.`
      : '';

  const areaParts: string[] = [];
  if (cfg.baseCity) areaParts.push(`Cidade-base: ${cfg.baseCity}`);
  if (cfg.maxRadiusKm) areaParts.push(`Raio máximo: ${cfg.maxRadiusKm} km`);
  if (cfg.priorityStates.length > 0) areaParts.push(`UFs prioritárias: ${cfg.priorityStates.join(', ')}`);
  if (cfg.geographicFocus) areaParts.push(`Foco: ${cfg.geographicFocus}`);
  const geoRule = areaParts.length > 0 ? `ÁREA DE ATUAÇÃO: ${areaParts.join(' | ')}.\n` : '';

  const exclusionsBlock =
    cfg.exclusions.length > 0
      ? `EXCLUSÕES (NÃO RETORNAR):\n${cfg.exclusions.map((e) => `- ${e.text}`).join('\n')}\n`
      : '';

  const filtersSummary = `FILTROS E PORTE:
- ${durationRule} ${singleDayRule}
- Perfil de cidade: ${CITY_POP_LABEL[cfg.cityPopulationProfile]}.
- Público-alvo: ${AUDIENCE_FOCUS_LABEL[cfg.audienceFocus]}.
- Entrada: ${ENTRY_PREF_LABEL[cfg.entryTypePreference]}.${audienceMinRule ? `\n- ${audienceMinRule}` : ''}
- Confirmação: ${CONFIRMATION_LEVEL_LABEL[cfg.confirmationLevel]}.
- Limite máximo: até ${cfg.maxResultsPerSearch} eventos nesta busca.`;

  if (target.mode === 'STATE_RADAR') {
    const stateUF = target.stateUF || '<UF>';
    return `${safeSearchDescription}

ALVO DO RADAR: Principais cidades no estado "${stateUF}" com eventos reais entre ${currentDateStr} e ${maxDateStr} (horizonte de ${cfg.horizonDays} dias, fuso de Brasília -03:00).
Hoje é dia ${currentDateStr}. Descarte imediatamente qualquer evento já encerrado antes de ${currentDateStr}.
DIAS PRIORITÁRIOS: ${weekdaysLabel}. ${holidaysRule}
${geoRule}${filtersSummary}
TIPOS DE EVENTOS PROCURADOS:
${typesBlock}

${exclusionsBlock}Pesquise na web (portais de prefeituras, calendários oficiais de eventos/turismo, sindicatos rurais, Sympla, Bilheteria Digital, Guichê Web, imprensa regional e perfis oficiais) e levante para cada evento confirmado: nome oficial, categoria (${categorySample}), cidade - ${stateUF}, startDate (YYYY-MM-DD), endDate (YYYY-MM-DD), durationDays, público estimado, valor de ingresso/entrada, organizador/contato, redes sociais (@perfil), população IBGE/renda per capita/PIB aproximados do município e URL real da fonte verificada.`;
  }

  const cityName = target.city || '<CIDADE>';
  return `${safeSearchDescription}

ALVO DA BUSCA: Cidade "${cityName}".
Hoje é dia ${currentDateStr} (fuso de Brasília -03:00).
JANELA OBRIGATÓRIA: Retorne APENAS eventos reais que acontecerão entre ${currentDateStr} e ${maxDateStr} (horizonte de ${cfg.horizonDays} dias). Descarte imediatamente qualquer edição já encerrada antes de ${currentDateStr}.
DIAS PRIORITÁRIOS: ${weekdaysLabel}. ${holidaysRule}
${geoRule}${filtersSummary}
TIPOS DE EVENTOS PROCURADOS:
${typesBlock}

${exclusionsBlock}Pesquise na web (portais oficiais do município, secretarias de cultura/turismo, sindicato rural, Sympla, Bilheteria Digital, imprensa local, Instagram oficial e dados demográficos IBGE de "${cityName}") e levante:
1. Cenário demográfico e econômico real de "${cityName}": população IBGE, renda per capita, PIB, principais atividades econômicas, idade/fundação do município e principais festas fixas anuais.
2. Lista de eventos reais na janela ${currentDateStr} a ${maxDateStr} com: nome oficial, categoria (${categorySample}), startDate (YYYY-MM-DD), endDate (YYYY-MM-DD), durationDays, local exato, público estimado, ingresso/entrada (gratuito ou faixa de preço), histórico de edições, organizador, telefone/WhatsApp, redes sociais (@perfil), site/link oficial e fontes verificáveis com URL.`;
}

function toDto(
  companyId: string | null,
  values: EventSearchConfigValues,
  isDefault: boolean,
  updatedById: string | null,
  updatedAt: Date | null
): CompanyEventSearchConfigDTO {
  return {
    companyId,
    isDefault,
    ...values,
    configHash: computeEventSearchConfigHash(values),
    renderedPromptPreview: buildRenderedEventPrompt(values, {
      mode: 'CITY',
      city: '<CIDADE_ALVO>',
    }),
    updatedById,
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
  };
}

export async function getCompanyEventSearchConfig(
  companyId?: string | null
): Promise<CompanyEventSearchConfigDTO> {
  if (!companyId) {
    return toDto(null, normalizeEventSearchConfigValues(DEFAULT_EVENT_SEARCH_CONFIG), true, null, null);
  }

  const row = await prisma.companyEventSearchConfig.findUnique({
    where: { companyId },
  });

  if (!row) {
    return toDto(
      companyId,
      normalizeEventSearchConfigValues(DEFAULT_EVENT_SEARCH_CONFIG),
      true,
      null,
      null
    );
  }

  const values = normalizeEventSearchConfigValues({
    searchDescription: row.searchDescription,
    eventTypes: row.eventTypesJson,
    horizonDays: row.horizonDays,
    priorityWeekdays: row.priorityWeekdaysJson,
    includeHolidays: row.includeHolidays,
    geographicFocus: row.geographicFocus ?? '',
    exclusions: row.exclusionsJson,
    minDurationDays: row.minDurationDays,
    maxDurationDays: row.maxDurationDays,
    allowSingleDayIfLarge: row.allowSingleDayIfLarge,
    minEstimatedAudience: row.minEstimatedAudience,
    cityPopulationProfile: row.cityPopulationProfile,
    audienceFocus: row.audienceFocus,
    entryTypePreference: row.entryTypePreference,
    confirmationLevel: row.confirmationLevel,
    baseCity: row.baseCity ?? '',
    maxRadiusKm: row.maxRadiusKm,
    priorityStatesJson: row.priorityStatesJson,
    maxResultsPerSearch: row.maxResultsPerSearch,
    cacheTtlDays: row.cacheTtlDays,
  });

  return toDto(companyId, values, false, row.updatedById || null, row.updatedAt || null);
}

export async function upsertCompanyEventSearchConfig(params: {
  companyId: string;
  payload: any;
  actorUserId: string;
  actorName: string;
  actorRole: string;
  ipAddress?: string | null;
}): Promise<CompanyEventSearchConfigDTO> {
  const { companyId, payload, actorUserId, actorName, actorRole, ipAddress } = params;

  const previous = await getCompanyEventSearchConfig(companyId);
  const nextValues = normalizeEventSearchConfigValues(payload, true);

  const dataBlock = {
    searchDescription: nextValues.searchDescription,
    eventTypesJson: nextValues.eventTypes as any,
    horizonDays: nextValues.horizonDays,
    priorityWeekdaysJson: nextValues.priorityWeekdays as any,
    includeHolidays: nextValues.includeHolidays,
    geographicFocus: nextValues.geographicFocus || null,
    exclusionsJson: nextValues.exclusions as any,
    minDurationDays: nextValues.minDurationDays,
    maxDurationDays: nextValues.maxDurationDays,
    allowSingleDayIfLarge: nextValues.allowSingleDayIfLarge,
    minEstimatedAudience: nextValues.minEstimatedAudience,
    cityPopulationProfile: nextValues.cityPopulationProfile,
    audienceFocus: nextValues.audienceFocus,
    entryTypePreference: nextValues.entryTypePreference,
    confirmationLevel: nextValues.confirmationLevel,
    baseCity: nextValues.baseCity || null,
    maxRadiusKm: nextValues.maxRadiusKm,
    priorityStatesJson: nextValues.priorityStatesJson,
    maxResultsPerSearch: nextValues.maxResultsPerSearch,
    cacheTtlDays: nextValues.cacheTtlDays,
    updatedById: actorUserId,
  };

  const saved = await prisma.companyEventSearchConfig.upsert({
    where: { companyId },
    create: {
      companyId,
      ...dataBlock,
    },
    update: dataBlock,
  });

  const nextDto = toDto(companyId, nextValues, false, saved.updatedById || actorUserId, saved.updatedAt);

  await recordOperationalAuditEvent({
    companyId,
    category: 'INTEGRATION',
    action: 'EVENT_SEARCH_CONFIG_UPDATED',
    entityType: 'COMPANY_EVENT_SEARCH_CONFIG',
    entityReference: `EVENT_SEARCH:${companyId}`,
    entityId: saved.id,
    previousValues: {
      isDefault: previous.isDefault,
      configHash: previous.configHash,
      horizonDays: previous.horizonDays,
      includeHolidays: previous.includeHolidays,
      priorityWeekdays: previous.priorityWeekdays,
      activeTypesCount: previous.eventTypes.filter((t) => t.enabled).length,
      exclusionsCount: previous.exclusions.length,
      minDurationDays: previous.minDurationDays,
      maxDurationDays: previous.maxDurationDays,
      cacheTtlDays: previous.cacheTtlDays,
      maxResultsPerSearch: previous.maxResultsPerSearch,
    },
    newValues: {
      isDefault: false,
      configHash: nextDto.configHash,
      horizonDays: nextDto.horizonDays,
      includeHolidays: nextDto.includeHolidays,
      priorityWeekdays: nextDto.priorityWeekdays,
      activeTypesCount: nextDto.eventTypes.filter((t) => t.enabled).length,
      exclusionsCount: nextDto.exclusions.length,
      minDurationDays: nextDto.minDurationDays,
      maxDurationDays: nextDto.maxDurationDays,
      cacheTtlDays: nextDto.cacheTtlDays,
      maxResultsPerSearch: nextDto.maxResultsPerSearch,
    },
    reason: 'Atualização detalhada da configuração de busca de Eventos IA',
    authorUserId: actorUserId,
    authorName: actorName,
    authorRole: actorRole,
    ipAddress: ipAddress || null,
  });

  return nextDto;
}

export async function resetCompanyEventSearchConfig(params: {
  companyId: string;
  actorUserId: string;
  actorName: string;
  actorRole: string;
  ipAddress?: string | null;
}): Promise<CompanyEventSearchConfigDTO> {
  const { companyId, actorUserId, actorName, actorRole, ipAddress } = params;
  const previous = await getCompanyEventSearchConfig(companyId);

  await prisma.companyEventSearchConfig.deleteMany({
    where: { companyId },
  });

  const defaults = await getCompanyEventSearchConfig(companyId);

  await recordOperationalAuditEvent({
    companyId,
    category: 'INTEGRATION',
    action: 'EVENT_SEARCH_CONFIG_RESET',
    entityType: 'COMPANY_EVENT_SEARCH_CONFIG',
    entityReference: `EVENT_SEARCH:${companyId}`,
    entityId: companyId,
    previousValues: {
      isDefault: previous.isDefault,
      configHash: previous.configHash,
      horizonDays: previous.horizonDays,
    },
    newValues: {
      isDefault: true,
      configHash: defaults.configHash,
      horizonDays: defaults.horizonDays,
    },
    reason: 'Restauração da configuração padrão Lumora para busca de Eventos IA',
    authorUserId: actorUserId,
    authorName: actorName,
    authorRole: actorRole,
    ipAddress: ipAddress || null,
  });

  return defaults;
}
