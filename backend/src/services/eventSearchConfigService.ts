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

export interface EventSearchConfigValues {
  searchDescription: string;
  eventTypes: EventSearchTypeItem[];
  horizonDays: number;
  priorityWeekdays: WeekdayCode[];
  includeHolidays: boolean;
  geographicFocus: string;
  exclusions: EventSearchExclusionItem[];
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
      ? sanitizeMultilineText(raw.searchDescription, 4000)
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

  return {
    searchDescription: searchDescription || DEFAULT_EVENT_SEARCH_CONFIG.searchDescription,
    eventTypes,
    horizonDays,
    priorityWeekdays,
    includeHolidays,
    geographicFocus,
    exclusions,
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
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function buildRenderedEventPrompt(
  cfg: EventSearchConfigValues,
  target: { mode: 'CITY' | 'STATE_RADAR'; city?: string; stateUF?: string; referenceDate?: Date } = {
    mode: 'CITY',
    city: '<CIDADE>',
  }
): string {
  const baseDate = target.referenceDate ? new Date(target.referenceDate) : new Date();
  const maxDate = new Date(baseDate);
  maxDate.setDate(baseDate.getDate() + cfg.horizonDays);

  const currentDateStr = baseDate.toISOString().split('T')[0];
  const maxDateStr = maxDate.toISOString().split('T')[0];

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
  const geoRule = cfg.geographicFocus
    ? `FOCO GEOGRÁFICO / RAIO: ${cfg.geographicFocus}\n`
    : '';

  const exclusionsBlock =
    cfg.exclusions.length > 0
      ? `EXCLUSÕES (NÃO RETORNAR):\n${cfg.exclusions.map((e) => `- ${e.text}`).join('\n')}\n`
      : '';

  if (target.mode === 'STATE_RADAR') {
    const stateUF = target.stateUF || '<UF>';
    return `${cfg.searchDescription}

ALVO DO RADAR: Principais cidades no estado "${stateUF}" com eventos reais entre ${currentDateStr} e ${maxDateStr} (horizonte de ${cfg.horizonDays} dias).
DIAS PRIORITÁRIOS: ${weekdaysLabel}. ${holidaysRule}
${geoRule}TIPOS DE EVENTOS PROCURADOS:
${typesBlock}

${exclusionsBlock}Retorne APENAS JSON válido no formato:
{
  "state": "${stateUF}",
  "updatedAt": "${currentDateStr}",
  "events": [
    {
      "name": "Nome do Evento",
      "category": "${categorySample}",
      "city": "Cidade - ${stateUF}",
      "startDate": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD",
      "durationDays": 3,
      "score": "HIGH",
      "audience": "Público estimado",
      "organizerContact": "(DD) 9XXXX-XXXX",
      "socialMedia": "@perfil",
      "notes": "Observações comerciais"
    }
  ]
}`.slice(0, 4000);
  }

  const cityName = target.city || '<CIDADE>';
  return `${cfg.searchDescription}

ALVO DA BUSCA: Cidade "${cityName}".
Hoje é dia ${currentDateStr}.
JANELA OBRIGATÓRIA: Retorne APENAS eventos reais que acontecerão entre ${currentDateStr} e ${maxDateStr} (horizonte de ${cfg.horizonDays} dias).
DIAS PRIORITÁRIOS: ${weekdaysLabel}. ${holidaysRule}
${geoRule}TIPOS DE EVENTOS PROCURADOS:
${typesBlock}

${exclusionsBlock}Retorne a resposta EXCLUSIVAMENTE em formato JSON puro:
{
  "cityInfo": {
    "name": "${cityName}",
    "summary": "Breve resumo sobre o cenário de eventos da cidade neste período.",
    "searchDate": "${currentDateStr}"
  },
  "events": [
    {
      "name": "Nome do Evento",
      "category": "${categorySample}",
      "startDate": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD",
      "durationDays": 3,
      "location": "Local",
      "city": "${cityName}",
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

  const saved = await prisma.companyEventSearchConfig.upsert({
    where: { companyId },
    create: {
      companyId,
      searchDescription: nextValues.searchDescription,
      eventTypesJson: nextValues.eventTypes as any,
      horizonDays: nextValues.horizonDays,
      priorityWeekdaysJson: nextValues.priorityWeekdays as any,
      includeHolidays: nextValues.includeHolidays,
      geographicFocus: nextValues.geographicFocus || null,
      exclusionsJson: nextValues.exclusions as any,
      updatedById: actorUserId,
    },
    update: {
      searchDescription: nextValues.searchDescription,
      eventTypesJson: nextValues.eventTypes as any,
      horizonDays: nextValues.horizonDays,
      priorityWeekdaysJson: nextValues.priorityWeekdays as any,
      includeHolidays: nextValues.includeHolidays,
      geographicFocus: nextValues.geographicFocus || null,
      exclusionsJson: nextValues.exclusions as any,
      updatedById: actorUserId,
    },
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
    },
    newValues: {
      isDefault: false,
      configHash: nextDto.configHash,
      horizonDays: nextDto.horizonDays,
      includeHolidays: nextDto.includeHolidays,
      priorityWeekdays: nextDto.priorityWeekdays,
      activeTypesCount: nextDto.eventTypes.filter((t) => t.enabled).length,
      exclusionsCount: nextDto.exclusions.length,
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
