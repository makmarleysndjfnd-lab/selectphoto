import { GoogleGenAI } from '@google/genai';
import { prisma } from './prisma';
import { validateExternalUrl } from './vaultService';
import { isExternalServicesDisabled } from '../utils/externalServices';

export const DEFAULT_GEMINI_SEARCH_MODEL = 'gemini-3-flash-preview';

export const GEMINI_FALLBACK_CANDIDATES = [
  'gemini-3-flash-preview',
  'gemini-3.0-flash',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
];

export interface GeminiModelDescriptor {
  id: string;
  name: string;
  displayName: string;
  supportedMethods: string[];
  recommended: boolean;
}

export interface GeminiClientLike {
  models: {
    generateContent(params: any): Promise<any>;
    list?(params?: any): Promise<any>;
  };
}

let testGeminiClientOverride: ((apiKey: string) => GeminiClientLike) | null = null;

export function setGeminiClientOverrideForTests(
  factory: ((apiKey: string) => GeminiClientLike) | null
): void {
  testGeminiClientOverride = factory;
}

export function getGeminiClientOverrideForTests(): ((apiKey: string) => GeminiClientLike) | null {
  return testGeminiClientOverride;
}

export function hasGeminiBaseUrlOverride(): boolean {
  return Boolean(
    process.env.NODE_ENV === 'test' &&
      process.env.GEMINI_API_BASE_URL_OVERRIDE &&
      /^https?:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(
        process.env.GEMINI_API_BASE_URL_OVERRIDE.trim()
      )
  );
}

export function createGoogleGenAiClient(
  apiKey: string,
  extraFactory?: ((apiKey: string) => GeminiClientLike) | null
): GeminiClientLike {
  if (extraFactory) return extraFactory(apiKey);
  if (testGeminiClientOverride) return testGeminiClientOverride(apiKey);
  if (hasGeminiBaseUrlOverride()) {
    return new GoogleGenAI({
      apiKey,
      httpOptions: { baseUrl: getGeminiApiBaseUrl() },
    } as any);
  }
  return new GoogleGenAI({ apiKey });
}

export function getGeminiApiBaseUrl(): string {
  if (
    process.env.NODE_ENV === 'test' &&
    process.env.GEMINI_API_BASE_URL_OVERRIDE &&
    /^https?:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(
      process.env.GEMINI_API_BASE_URL_OVERRIDE.trim()
    )
  ) {
    return process.env.GEMINI_API_BASE_URL_OVERRIDE.trim().replace(/\/+$/, '');
  }
  return 'https://generativelanguage.googleapis.com';
}

export function normalizeGeminiModelId(raw: unknown): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.replace(/^models\//i, '').trim();
}

export function extractGeminiHttpStatus(err: any): number | null {
  const direct =
    err?.status ??
    err?.statusCode ??
    err?.httpStatus ??
    err?.code ??
    err?.response?.status;
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  const msg = String(err?.message || '');
  const match = msg.match(/\b(400|401|403|404|429|500|502|503|504)\b/);
  return match ? Number(match[1]) : null;
}

export function isGeminiModelNotFoundError(err: any): boolean {
  const status = extractGeminiHttpStatus(err);
  if (status === 404) return true;
  const rawStatus = String(err?.statusText || err?.error?.status || '').toUpperCase();
  if (rawStatus === 'NOT_FOUND') return true;
  const msg = String(err?.message || '');
  return (
    /NOT_FOUND/i.test(msg) ||
    /no longer available/i.test(msg) ||
    /not found for API version/i.test(msg) ||
    /models\/[\w.-]+\s+is not found/i.test(msg) ||
    /model[^\n]*not supported for generateContent/i.test(msg)
  );
}

function getModelPriorityScore(modelId: string): number {
  const lower = modelId.toLowerCase();

  // Exclui modelos especializados não-texto / imagem / vídeo / TTS / áudio puro
  if (
    lower.includes('embedding') ||
    lower.includes('aqa') ||
    lower.includes('imagen') ||
    lower.includes('veo') ||
    lower.includes('native-audio') ||
    lower.includes('robotics') ||
    lower.includes('computer-use') ||
    lower.includes('-tts') ||
    lower.includes('-image')
  ) {
    return -1000;
  }

  let score = 0;

  // Prioridade absoluta: família Gemini 3 Flash mais recente
  const v3FlashMatch = /^gemini-3(?:\.(\d+))?-flash(.*)$/i.exec(lower);
  if (v3FlashMatch) {
    const minor = Number(v3FlashMatch[1] || 0);
    const suffix = v3FlashMatch[2] || '';
    const isLite = suffix.includes('lite');
    const isPreview = suffix.includes('preview') || suffix.includes('exp');
    score = (isLite ? 8500 : 10000) + minor * 100 - (isPreview ? 10 : 0);
    return score;
  }

  if (/^gemini-3.*flash/i.test(lower)) {
    return lower.includes('lite') ? 8200 : 9500;
  }

  // Próximas famílias Flash: 2.5 Flash > 2.5 Flash Lite > 2.0 Flash > outros Flash
  if (/^gemini-2\.5-flash$/i.test(lower)) return 7500;
  if (/^gemini-2\.5-flash(?!.*lite)/i.test(lower)) return 7400;
  if (/^gemini-2\.5-flash-lite/i.test(lower)) return 6800;
  if (/^gemini-2\.0-flash(?!.*lite)/i.test(lower)) return 6200;
  if (/^gemini-2\.0-flash-lite/i.test(lower)) return 5800;
  if (lower.startsWith('gemini-') && lower.includes('flash')) return 5000;

  // Modelos Pro como fallback secundário caso a chave só tenha Pro
  if (/^gemini-3.*pro/i.test(lower)) return 4500;
  if (/^gemini-2\.5-pro/i.test(lower)) return 4000;
  if (lower.startsWith('gemini-') && lower.includes('pro')) return 3000;

  if (lower.startsWith('gemini-')) return 1000;
  return -100;
}

export function rankAndFilterGeminiModels(rawItems: any[]): GeminiModelDescriptor[] {
  const dedup = new Map<string, GeminiModelDescriptor>();

  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;
    const rawName = String(item.name || item.id || '').trim();
    const id = normalizeGeminiModelId(rawName);
    if (!id) continue;

    const methodsRaw: string[] = Array.isArray(item.supportedActions)
      ? item.supportedActions
      : Array.isArray(item.supportedGenerationMethods)
        ? item.supportedGenerationMethods
        : [];
    const supportedMethods = methodsRaw.map((m) => String(m).trim()).filter(Boolean);

    // Quando a API informa métodos suportados, exigir generateContent
    if (
      supportedMethods.length > 0 &&
      !supportedMethods.some((m) => m.toLowerCase() === 'generatecontent')
    ) {
      continue;
    }

    const score = getModelPriorityScore(id);
    if (score < 0) continue;

    if (!dedup.has(id)) {
      dedup.set(id, {
        id,
        name: rawName || `models/${id}`,
        displayName: String(item.displayName || id).trim(),
        supportedMethods,
        recommended: false,
      });
    }
  }

  const sorted = Array.from(dedup.values()).sort((a, b) => {
    const scoreDiff = getModelPriorityScore(b.id) - getModelPriorityScore(a.id);
    if (scoreDiff !== 0) return scoreDiff;
    return a.id.localeCompare(b.id);
  });

  if (sorted.length > 0) {
    sorted[0].recommended = true;
  }

  return sorted;
}

export async function listAvailableGeminiModels(params: {
  apiKey: string;
  aiClient?: GeminiClientLike | null;
  timeoutMs?: number;
}): Promise<GeminiModelDescriptor[]> {
  const { apiKey, aiClient, timeoutMs = 8000 } = params;
  const cleanKey = String(apiKey || '').trim();
  if (!cleanKey) return [];

  const collected: any[] = [];

  // 1. Tenta via SDK @google/genai (ou cliente injetado em teste) quando suportar models.list()
  const effectiveClient =
    aiClient ??
    (testGeminiClientOverride ? testGeminiClientOverride(cleanKey) : null);

  if (effectiveClient?.models && typeof effectiveClient.models.list === 'function') {
    try {
      const listResp: any = await effectiveClient.models.list();
      if (Array.isArray(listResp)) {
        collected.push(...listResp);
      } else if (Array.isArray(listResp?.models)) {
        collected.push(...listResp.models);
      } else if (Array.isArray(listResp?.page)) {
        collected.push(...listResp.page);
      } else if (listResp && typeof listResp[Symbol.asyncIterator] === 'function') {
        for await (const m of listResp) {
          collected.push(m);
          if (collected.length >= 200) break;
        }
      }
      const ranked = rankAndFilterGeminiModels(collected);
      if (ranked.length > 0) return ranked;
    } catch {
      // Continua para tentativa via REST v1beta se aplicável
    }
  }

  // Em ambiente de teste isolado sem base URL override e sem mock REST, não faz chamadas externas
  const hasRestOverride = Boolean(
    process.env.NODE_ENV === 'test' &&
      process.env.GEMINI_API_BASE_URL_OVERRIDE &&
      /^https?:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(
        process.env.GEMINI_API_BASE_URL_OVERRIDE.trim()
      )
  );

  if (isExternalServicesDisabled() && !hasRestOverride) {
    return rankAndFilterGeminiModels(
      GEMINI_FALLBACK_CANDIDATES.map((id) => ({
        name: `models/${id}`,
        displayName: id,
        supportedGenerationMethods: ['generateContent'],
      }))
    );
  }

  // 2. Consulta direta REST v1beta/models?key=...
  const baseUrl = getGeminiApiBaseUrl();
  if (baseUrl.startsWith('https://')) {
    const check = await validateExternalUrl(baseUrl);
    if (!check.valid) {
      throw new Error(check.error || 'Endpoint Gemini não autorizado.');
    }
  }

  const endpoint = `${baseUrl}/v1beta/models?key=${encodeURIComponent(cleanKey)}&pageSize=100`;
  const resp = await fetch(endpoint, {
    method: 'GET',
    headers: { 'User-Agent': 'LumoraPlatform/2.0' },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    const err: any = new Error(
      `Falha ao listar modelos Gemini (HTTP ${resp.status}): ${errText.slice(0, 200)}`
    );
    err.status = resp.status;
    throw err;
  }

  const data: any = await resp.json().catch(() => ({}));
  const modelsArr = Array.isArray(data?.models) ? data.models : [];
  const ranked = rankAndFilterGeminiModels(modelsArr);
  if (ranked.length > 0) return ranked;

  return [];
}

export async function getCompanyGeminiMetadata(companyId?: string | null): Promise<{
  geminiModel: string | null;
  availableModels: string[];
}> {
  if (!companyId) {
    return { geminiModel: null, availableModels: [] };
  }

  const integ = await prisma.companyIntegration.findFirst({
    where: {
      companyId,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      scope: { not: 'PLATFORM_SHARED' },
    },
    orderBy: { updatedAt: 'desc' },
    select: { configMetadata: true },
  });

  const meta =
    integ?.configMetadata && typeof integ.configMetadata === 'object'
      ? (integ.configMetadata as Record<string, any>)
      : {};

  const savedModel = normalizeGeminiModelId(meta.geminiModel);
  const availableModels = Array.isArray(meta.detectedGeminiModels)
    ? meta.detectedGeminiModels
        .map((m: unknown) => normalizeGeminiModelId(m))
        .filter(Boolean)
    : [];

  return {
    geminiModel: savedModel || null,
    availableModels,
  };
}

export async function persistCompanyGeminiModel(
  companyId: string | null | undefined,
  geminiModel: string,
  availableModels?: GeminiModelDescriptor[]
): Promise<void> {
  if (!companyId) return;
  const cleanModel = normalizeGeminiModelId(geminiModel);
  if (!cleanModel) return;

  const existing = await prisma.companyIntegration.findFirst({
    where: {
      companyId,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      scope: { not: 'PLATFORM_SHARED' },
    },
    orderBy: { updatedAt: 'desc' },
  });

  if (!existing) return;

  const prevMeta =
    existing.configMetadata && typeof existing.configMetadata === 'object'
      ? { ...(existing.configMetadata as Record<string, any>) }
      : {};

  const nextMeta: Record<string, any> = {
    ...prevMeta,
    geminiModel: cleanModel,
    geminiModelValidatedAt: new Date().toISOString(),
  };

  if (Array.isArray(availableModels) && availableModels.length > 0) {
    nextMeta.detectedGeminiModels = availableModels.map((m) => m.id).slice(0, 20);
  }

  await prisma.companyIntegration.update({
    where: { id: existing.id },
    data: { configMetadata: nextMeta },
  });
}

export async function resolveActiveGeminiModel(params: {
  companyId?: string | null;
  apiKey: string;
  aiClient?: GeminiClientLike | null;
  forceDiscover?: boolean;
}): Promise<{
  model: string;
  candidates: string[];
  availableModels: GeminiModelDescriptor[];
  fromSavedConfig: boolean;
}> {
  const { companyId, apiKey, aiClient, forceDiscover = false } = params;
  const saved = await getCompanyGeminiMetadata(companyId);

  if (saved.geminiModel && !forceDiscover) {
    return {
      model: saved.geminiModel,
      candidates: [
        saved.geminiModel,
        ...GEMINI_FALLBACK_CANDIDATES.filter((m) => m !== saved.geminiModel),
      ],
      availableModels: [],
      fromSavedConfig: true,
    };
  }

  let availableModels: GeminiModelDescriptor[] = [];
  try {
    availableModels = await listAvailableGeminiModels({ apiKey, aiClient });
  } catch {
    availableModels = [];
  }

  const candidateIds: string[] = [];
  for (const m of availableModels) {
    if (!candidateIds.includes(m.id)) candidateIds.push(m.id);
  }
  if (saved.geminiModel && !candidateIds.includes(saved.geminiModel)) {
    candidateIds.push(saved.geminiModel);
  }
  for (const fallback of GEMINI_FALLBACK_CANDIDATES) {
    if (!candidateIds.includes(fallback)) candidateIds.push(fallback);
  }

  const primary = candidateIds[0] || DEFAULT_GEMINI_SEARCH_MODEL;

  return {
    model: primary,
    candidates: candidateIds,
    availableModels,
    fromSavedConfig: false,
  };
}
