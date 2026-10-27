import crypto from 'crypto';
import dns from 'dns';
import { promisify } from 'util';

const resolve4Async = promisify(dns.resolve4);

/**
 * Erro específico lançado quando o cofre não possui configuração válida de chave mestra.
 * Falha de forma segura (fail-closed) sem derrubar módulos independentes na inicialização.
 */
export class VaultConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultConfigurationError';
  }
}

/**
 * Catálogo restrito de variáveis de ambiente autorizadas para referência externa (ENV_REFERENCE).
 * Impede que variáveis sensíveis do sistema (como DATABASE_URL ou JWT_SECRET) sejam expostas ou referenciadas.
 */
export const ALLOWED_ENV_VAR_REFERENCES = [
  'GEMINI_API_KEY',
  'GROK_API_KEY',
  'ASAAS_SANDBOX_API_KEY',
  'ASAAS_SANDBOX_WEBHOOK_TOKEN',
  'META_WHATSAPP_TOKEN',
] as const;

export type AllowedEnvVar = typeof ALLOWED_ENV_VAR_REFERENCES[number];

export function isAllowedEnvVarReference(varName: string): boolean {
  if (!varName) return false;
  return (ALLOWED_ENV_VAR_REFERENCES as readonly string[]).includes(varName.trim());
}

/**
 * Deriva uma chave de 256 bits (32 bytes) a partir da variável dedicada INTEGRATION_MASTER_KEY.
 * REMOVIDOS os fallbacks silenciosos para JWT_SECRET e constantes conhecidas do código.
 * Se INTEGRATION_MASTER_KEY estiver ausente ou tiver menos de 32 caracteres, lança VaultConfigurationError.
 */
export function getMasterKey(): Buffer {
  const envKey = process.env.INTEGRATION_MASTER_KEY;
  if (!envKey || envKey.trim().length < 32) {
    throw new VaultConfigurationError(
      'Chave mestra do Vault (INTEGRATION_MASTER_KEY) não configurada ou possui menos de 32 caracteres. Operações criptográficas desabilitadas por segurança.'
    );
  }

  // Se a chave fornecida for hex de 64 caracteres (32 bytes em hex), converte diretamente
  if (/^[0-9a-fA-F]{64}$/.test(envKey.trim())) {
    return Buffer.from(envKey.trim(), 'hex');
  }

  // Caso seja uma string aleatória com >= 32 chars, utiliza os primeiros 32 bytes UTF-8
  return Buffer.from(envKey.trim().slice(0, 32), 'utf-8');
}

/**
 * Função interna para suportar leitura de registros legados durante rotação/migração de chave.
 */
function deriveLegacyKeyForMigration(): Buffer | null {
  const secretSource = process.env.JWT_SECRET;
  if (!secretSource) return null;
  const salt = 'lumora_integration_vault_salt_2026';
  return crypto.pbkdf2Sync(secretSource, salt, 100000, 32, 'sha512');
}

/**
 * Criptografa um segredo usando AES-256-GCM com IV aleatório de 12 bytes (96 bits) e tag de 16 bytes.
 */
export function encryptSecret(
  plainSecret: string,
  customKey?: Buffer
): {
  encryptedSecret: string;
  secretIv: string;
  secretTag: string;
} {
  if (!plainSecret) {
    throw new Error('Segredo não pode ser vazio para criptografia.');
  }

  const key = customKey || getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plainSecret, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return {
    encryptedSecret: encrypted,
    secretIv: iv.toString('hex'),
    secretTag: tag,
  };
}

/**
 * Descriptografa um segredo criptografado com AES-256-GCM.
 * Suporta fallback controlado de leitura para chave legada caso a chave mestra tenha sido rotacionada.
 */
export function decryptSecret(
  encryptedSecret: string,
  secretIv: string,
  secretTag: string,
  customKey?: Buffer
): string {
  if (!encryptedSecret || !secretIv || !secretTag) {
    throw new Error('Parâmetros de criptografia incompletos para descriptografia.');
  }

  const iv = Buffer.from(secretIv, 'hex');
  const tag = Buffer.from(secretTag, 'hex');

  // 1. Tenta descriptografar com a chave primária
  try {
    const key = customKey || getMasterKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encryptedSecret, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (primaryErr: any) {
    // 2. Se falhar com a chave primária e não for chave customizada, tenta chave legada de migração
    if (!customKey) {
      const legacyKey = deriveLegacyKeyForMigration();
      if (legacyKey) {
        try {
          const legacyDecipher = crypto.createDecipheriv('aes-256-gcm', legacyKey, iv);
          legacyDecipher.setAuthTag(tag);
          let legacyDecrypted = legacyDecipher.update(encryptedSecret, 'hex', 'utf8');
          legacyDecrypted += legacyDecipher.final('utf8');
          return legacyDecrypted;
        } catch (_) {
          // Ignora erro legado e lança o erro da chave primária
        }
      }
    }

    throw new Error(`Falha ao descriptografar segredo: integridade ou chave inválida (${primaryErr.message}).`);
  }
}

/**
 * Rotaciona a criptografia de um segredo de uma chave antiga para uma nova chave mestra.
 */
export function rotateSecretCiphertext(
  encryptedSecret: string,
  secretIv: string,
  secretTag: string,
  oldKey: Buffer,
  newKey: Buffer
): {
  encryptedSecret: string;
  secretIv: string;
  secretTag: string;
} {
  const plain = decryptSecret(encryptedSecret, secretIv, secretTag, oldKey);
  return encryptSecret(plain, newKey);
}

/**
 * Gera máscara segura para exibição visual no painel.
 * Credenciais nunca retornam íntegras para a interface.
 */
export function maskSecret(secret: string): string {
  if (!secret) return '';
  const trimmed = secret.trim();
  if (trimmed.length <= 8) {
    return '••••••••';
  }
  const start = trimmed.slice(0, 4);
  const end = trimmed.slice(-4);
  return `${start}••••••••${end}`;
}

export const ASAAS_SANDBOX_BASE_URL = 'https://api-sandbox.asaas.com/v3';
export const ASAAS_PRODUCTION_BASE_URL = 'https://api.asaas.com/v3';

/**
 * Lista estrita de domínios externos autorizados.
 * Apenas os endpoints oficiais necessários por provedor estão homologados.
 * Removidos coringas amplos (.onrender.com, etc.).
 */
export const ALLOWED_INTEGRATION_DOMAINS = [
  'api-sandbox.asaas.com',
  'api.asaas.com',
  'viacep.com.br',
  'generativelanguage.googleapis.com',
  'api.x.ai',
  'graph.facebook.com',
] as const;

/**
 * Verifica se um endereço IP pertence a faixas privadas, loopback ou reservadas.
 */
export function isPrivateOrLocalIp(ip: string): boolean {
  if (!ip) return true;
  const cleanIp = ip.trim().toLowerCase();

  // Loopback e termos óbvios
  if (
    cleanIp === '127.0.0.1' ||
    cleanIp === '::1' ||
    cleanIp === 'localhost' ||
    cleanIp === '0.0.0.0'
  ) {
    return true;
  }

  // IPv6 site-local, unique local ou loopback
  if (
    cleanIp.startsWith('fe80:') ||
    cleanIp.startsWith('fc00:') ||
    cleanIp.startsWith('fd00:') ||
    cleanIp.startsWith('::ffff:127.')
  ) {
    return true;
  }

  // Link-local / Cloud Metadata (169.254.x.x)
  if (cleanIp === '169.254.169.254' || cleanIp.startsWith('169.254.')) {
    return true;
  }

  const parts = cleanIp.split('.').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) {
    return false;
  }

  // 10.0.0.0/8 (Rede privada RFC 1918)
  if (parts[0] === 10) return true;

  // 172.16.0.0/12 (172.16.0.0 a 172.31.255.255 - Rede privada RFC 1918)
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

  // 192.168.0.0/16 (Rede privada RFC 1918)
  if (parts[0] === 192 && parts[1] === 168) return true;

  // 127.0.0.0/8 (Loopback IPv4)
  if (parts[0] === 127) return true;

  // 0.0.0.0/8
  if (parts[0] === 0) return true;

  return false;
}

/**
 * Validação rigorosa contra SSRF (Server-Side Request Forgery).
 * 1. Exige HTTPS no runtime (HTTP permitido exclusivamente sob NODE_ENV === 'test').
 * 2. Valida contra lista fechada de domínios oficiais autorizados.
 * 3. Bloqueia loopback, metadados de nuvem e IPs privados/reservados via DNS.
 */
export async function validateExternalUrl(
  rawUrl: string,
  allowedDomains: readonly string[] = ALLOWED_INTEGRATION_DOMAINS
): Promise<{ valid: boolean; error?: string; url?: URL }> {
  try {
    const parsed = new URL(rawUrl);

    // Exigência de HTTPS fora de ambiente de teste automatizado
    if (process.env.NODE_ENV !== 'test') {
      if (parsed.protocol !== 'https:') {
        return {
          valid: false,
          error: `Protocolo '${parsed.protocol}' inválido. Conexões externas exigem HTTPS estrito em produção.`,
        };
      }
    } else {
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return {
          valid: false,
          error: 'Protocolo inválido. Apenas HTTP/HTTPS são permitidos.',
        };
      }
    }

    const hostname = parsed.hostname.toLowerCase();

    // Bloqueia termos óbvios de loopback e metadados
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname === '169.254.169.254'
    ) {
      return {
        valid: false,
        error: 'Acesso a endereços de loopback ou metadados de nuvem é proibido.',
      };
    }

    // Verifica se o hostname está estritamente contido na lista de domínios autorizados
    const domainAllowed = allowedDomains.includes(hostname as any);

    if (!domainAllowed) {
      return {
        valid: false,
        error: `Domínio '${hostname}' não autorizado no catálogo estrito de integrações.`,
      };
    }

    // Resolução DNS para verificar se o IP resolvido pertence a rede interna/privada
    try {
      const addresses = await resolve4Async(hostname);
      for (const ip of addresses) {
        if (isPrivateOrLocalIp(ip)) {
          return {
            valid: false,
            error: `Domínio '${hostname}' resolve para IP de rede interna/privada (${ip}). Bloqueado por SSRF.`,
          };
        }
      }
    } catch (dnsErr: any) {
      // Se não resolver o DNS no ambiente de teste offline, não quebramos se o hostname for explicitamente válido
      if (process.env.NODE_ENV !== 'test') {
        return {
          valid: false,
          error: `Falha ao resolver domínio '${hostname}': ${dnsErr.message}`,
        };
      }
    }

    return { valid: true, url: parsed };
  } catch (err: any) {
    return { valid: false, error: `URL inválida: ${err.message}` };
  }
}
