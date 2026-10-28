import { GoogleGenAI } from '@google/genai';
import { validateExternalUrl } from './vaultService';

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  latencyMs: number;
  details?: any;
}

export interface AdapterTestOptions {
  mockResponse?: boolean;
  mockLatencyMs?: number;
}

/**
 * URL base oficial do Asaas Sandbox conforme documentação: https://docs.asaas.com/docs/sandbox
 */
export const ASAAS_SANDBOX_BASE_URL = 'https://api-sandbox.asaas.com/v3';
export const ASAAS_PRODUCTION_BASE_URL = 'https://api.asaas.com/v3';

/**
 * Teste não destrutivo de conexão com a API Google Gemini.
 * Mocks são controlados estritamente via parâmetro de teste explícito (AdapterTestOptions).
 * Atalhos baseados no conteúdo da chave (como conter 'test') foram eliminados do runtime operacional.
 */
export async function testGeminiConnection(
  apiKey: string,
  options?: AdapterTestOptions
): Promise<ConnectionTestResult> {
  const start = Date.now();
  if (!apiKey || apiKey.trim().length < 10) {
    return {
      success: false,
      message: 'Chave Gemini inválida ou muito curta.',
      latencyMs: 0,
    };
  }

  // Injeção de mock controlada exclusivamente por opção explícita em teste
  if (options?.mockResponse) {
    return {
      success: true,
      message: 'Conexão com Gemini validada com sucesso (Ambiente de Teste Controlado).',
      latencyMs: options.mockLatencyMs ?? 15,
      details: { model: 'gemini-2.5-flash', status: 'READY', simulated: true },
    };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    // Operação mínima: prompt de 1 token para validar autenticação e cota
    const response: any = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'Ping',
    });

    const latencyMs = Date.now() - start;
    if (response && response.text) {
      return {
        success: true,
        message: 'Conexão com Gemini estabelecida e autenticada com sucesso.',
        latencyMs,
        details: { model: 'gemini-2.5-flash', status: 'READY' },
      };
    }

    return {
      success: false,
      message: 'Resposta vazia da API Gemini.',
      latencyMs,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    // Sanitiza mensagem de erro para nunca expor a chave
    const cleanError = (err.message || 'Erro desconhecido').replace(apiKey, '••••••••');
    return {
      success: false,
      message: `Falha ao conectar com Gemini: ${cleanError}`,
      latencyMs,
    };
  }
}

/**
 * Teste não destrutivo com ViaCEP (CEP 01001-000, Praça da Sé/SP).
 */
export async function testViaCepConnection(): Promise<ConnectionTestResult> {
  const start = Date.now();
  const endpoint = 'https://viacep.com.br/ws/01001000/json/';
  try {
    const urlValidation = await validateExternalUrl(endpoint);
    if (!urlValidation.valid) {
      return {
        success: false,
        message: `Bloqueado por política SSRF: ${urlValidation.error}`,
        latencyMs: 0,
      };
    }

    const res = await fetch(endpoint, {
      method: 'GET',
      headers: { 'User-Agent': 'LumoraPlatform-Test/2.0' },
    });

    const latencyMs = Date.now() - start;
    if (res.ok) {
      const data = await res.json();
      if (data.cep) {
        return {
          success: true,
          message: 'ViaCEP operacional e respondendo normalmente.',
          latencyMs,
          details: { cep: data.cep, localidade: data.localidade },
        };
      }
    }

    return {
      success: false,
      message: `ViaCEP retornou status inesperado ${res.status}.`,
      latencyMs,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Falha ao testar ViaCEP: ${err.message}`,
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Teste não destrutivo de conexão e validação de credencial com o Asaas (GET /customers?limit=1).
 * Utiliza o endpoint oficial do ambiente selecionado (Sandbox ou Produção) apenas para leitura de autenticação,
 * sem habilitar operações financeiras LIVE.
 */
export async function testAsaasSandboxConnection(
  apiKey: string,
  options?: AdapterTestOptions & { environment?: 'SANDBOX' | 'PRODUCTION' }
): Promise<ConnectionTestResult> {
  const start = Date.now();
  const targetEnv = options?.environment === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX';
  const envLabel = targetEnv === 'PRODUCTION' ? 'Asaas Produção (somente validação de credencial; LIVE permanece bloqueado)' : 'Asaas Sandbox';
  if (!apiKey || apiKey.trim().length < 10) {
    return {
      success: false,
      message: `Chave de API do ${targetEnv === 'PRODUCTION' ? 'Asaas Produção' : 'Asaas Sandbox'} ausente ou inválida.`,
      latencyMs: 0,
    };
  }

  // Injeção de mock controlada exclusivamente por opção explícita em teste
  if (options?.mockResponse) {
    return {
      success: true,
      message: `Conexão com ${envLabel} autenticada com sucesso (Ambiente de Teste Controlado).`,
      latencyMs: options.mockLatencyMs ?? 25,
      details: { environment: targetEnv, authorized: true, financialLiveEnabled: false, simulated: true },
    };
  }

  const baseUrl = targetEnv === 'PRODUCTION' ? ASAAS_PRODUCTION_BASE_URL : ASAAS_SANDBOX_BASE_URL;
  const endpoint = `${baseUrl}/customers?limit=1`;
  try {
    const urlValidation = await validateExternalUrl(endpoint);
    if (!urlValidation.valid) {
      return {
        success: false,
        message: `Bloqueado por política SSRF: ${urlValidation.error}`,
        latencyMs: 0,
      };
    }

    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'access_token': apiKey,
        'Content-Type': 'application/json',
        'User-Agent': 'LumoraPlatform-CredentialCheck/2.0',
      },
    });

    const latencyMs = Date.now() - start;
    if (res.status === 200) {
      return {
        success: true,
        message:
          targetEnv === 'PRODUCTION'
            ? 'Credencial Asaas Produção validada (somente leitura). Operações financeiras LIVE permanecem bloqueadas até autorização explícita.'
            : 'Conexão e credenciais do Asaas Sandbox validadas com sucesso no endpoint oficial.',
        latencyMs,
        details: { environment: targetEnv, status: 'AUTHENTICATED', financialLiveEnabled: false },
      };
    } else if (res.status === 401 || res.status === 403) {
      return {
        success: false,
        message: `Chave do ${targetEnv === 'PRODUCTION' ? 'Asaas Produção' : 'Asaas Sandbox'} recusada pelo provedor (401/403 Não Autorizado).`,
        latencyMs,
      };
    } else {
      const body = await res.text().catch(() => '');
      return {
        success: false,
        message: `Asaas (${targetEnv}) respondeu com erro (${res.status}): ${body.slice(0, 150)}`,
        latencyMs,
      };
    }
  } catch (err: any) {
    return {
      success: false,
      message: `Falha de rede ao conectar com Asaas (${targetEnv}): ${err.message}`,
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Teste não destrutivo com Meta WhatsApp Cloud API (GET /v19.0/me).
 */
export async function testMetaWhatsAppConnection(
  accessToken: string,
  options?: AdapterTestOptions
): Promise<ConnectionTestResult> {
  const start = Date.now();
  if (!accessToken || accessToken.trim().length < 15) {
    return {
      success: false,
      message: 'Token de acesso Meta WhatsApp ausente ou inválido.',
      latencyMs: 0,
    };
  }

  if (options?.mockResponse) {
    return {
      success: true,
      message: 'Conexão Meta WhatsApp validada (Ambiente de Teste Controlado).',
      latencyMs: options.mockLatencyMs ?? 20,
      details: { provider: 'META_WHATSAPP', status: 'READY', simulated: true },
    };
  }

  const endpoint = 'https://graph.facebook.com/v19.0/me';
  try {
    const urlValidation = await validateExternalUrl(endpoint);
    if (!urlValidation.valid) {
      return {
        success: false,
        message: `Bloqueado por política SSRF: ${urlValidation.error}`,
        latencyMs: 0,
      };
    }

    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const latencyMs = Date.now() - start;
    if (res.ok) {
      const data = await res.json();
      return {
        success: true,
        message: 'Conexão Meta WhatsApp Cloud API validada com sucesso.',
        latencyMs,
        details: data,
      };
    }

    return {
      success: false,
      message: `Meta WhatsApp API rejeitou o token (Status ${res.status}).`,
      latencyMs,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Erro ao testar Meta WhatsApp: ${err.message}`,
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Teste não destrutivo com Grok (xAI) API (GET /v1/models).
 */
export async function testGrokConnection(
  apiKey: string,
  options?: AdapterTestOptions
): Promise<ConnectionTestResult> {
  const start = Date.now();
  if (!apiKey || apiKey.trim().length < 10) {
    return {
      success: false,
      message: 'Chave de API do Grok ausente ou inválida.',
      latencyMs: 0,
    };
  }

  if (options?.mockResponse) {
    return {
      success: true,
      message: 'Conexão com Grok/xAI validada (Ambiente de Teste Controlado).',
      latencyMs: options.mockLatencyMs ?? 30,
      details: { provider: 'GROK', status: 'READY', simulated: true },
    };
  }

  const endpoint = 'https://api.x.ai/v1/models';
  try {
    const urlValidation = await validateExternalUrl(endpoint);
    if (!urlValidation.valid) {
      return {
        success: false,
        message: `Bloqueado por política SSRF: ${urlValidation.error}`,
        latencyMs: 0,
      };
    }

    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const latencyMs = Date.now() - start;
    if (res.ok) {
      return {
        success: true,
        message: 'Conexão com xAI Grok validada com sucesso.',
        latencyMs,
      };
    }

    return {
      success: false,
      message: `xAI Grok rejeitou a credencial (Status ${res.status}).`,
      latencyMs,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Erro ao testar Grok: ${err.message}`,
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Adaptador funcional de consulta de IA para Grok (xAI) compatível com a API OpenAI Chat Completions.
 * Garante que a chave do Grok NUNCA seja encaminhada ao GoogleGenAI.
 */
export async function executeGrokChatCompletion(params: {
  apiKey: string;
  prompt: string;
  model?: string;
}): Promise<{ success: boolean; text?: string; error?: string }> {
  try {
    const endpoint = 'https://api.x.ai/v1/chat/completions';
    const urlValidation = await validateExternalUrl(endpoint);
    if (!urlValidation.valid) {
      return { success: false, error: urlValidation.error };
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model: params.model || 'grok-beta',
        messages: [{ role: 'user', content: params.prompt }],
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        success: false,
        error: `Grok API retornou erro HTTP ${res.status}: ${errText.slice(0, 200)}`,
      };
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    return { success: true, text: content || '' };
  } catch (err: any) {
    return { success: false, error: `Falha na requisição ao Grok: ${err.message}` };
  }
}
