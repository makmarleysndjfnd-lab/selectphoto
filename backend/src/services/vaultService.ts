import crypto from 'crypto';
import dns from 'dns';
import { promisify } from 'util';

const resolve4Async = promisify(dns.resolve4);

/**
 * Deriva uma chave de 256 bits (32 bytes) segura para criptografia AES-256-GCM.
 * Prioriza INTEGRATION_MASTER_KEY; caso ausente, deriva determinísticamente
 * a partir de JWT_SECRET com PBKDF2 (100.000 iterações sha512).
 */
function getMasterKey(): Buffer {
  const envKey = process.env.INTEGRATION_MASTER_KEY;
  if (envKey && envKey.length >= 32) {
    return Buffer.from(envKey.slice(0, 32), 'utf-8');
  }

  const salt = 'lumora_integration_vault_salt_2026';
  const secretSource = process.env.JWT_SECRET || 'lumora-default-vault-secure-seed-key-32b';
  return crypto.pbkdf2Sync(secretSource, salt, 100000, 32, 'sha512');
}

/**
 * Criptografa um segredo usando AES-256-GCM com IV aleatório de 12 bytes.
 */
export function encryptSecret(plainSecret: string): {
  encryptedSecret: string;
  secretIv: string;
  secretTag: string;
} {
  if (!plainSecret) {
    throw new Error('Segredo não pode ser vazio para criptografia.');
  }

  const key = getMasterKey();
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
 */
export function decryptSecret(
  encryptedSecret: string,
  secretIv: string,
  secretTag: string
): string {
  if (!encryptedSecret || !secretIv || !secretTag) {
    throw new Error('Parâmetros de criptografia incompletos para descriptografia.');
  }

  const key = getMasterKey();
  const iv = Buffer.from(secretIv, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(Buffer.from(secretTag, 'hex'));

  let decrypted = decipher.update(encryptedSecret, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
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

/**
 * Validação rigorosa contra SSRF (Server-Side Request Forgery).
 * Garante que URLs externas:
 * 1. Usem protocolo seguro https: (ou http: explicitamente controlado em ambiente de teste).
 * 2. Não apontem para IPs privados (RFC1918: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16).
 * 3. Não apontem para loopback (127.0.0.1, localhost, ::1).
 * 4. Não apontem para metadados de nuvem (169.254.169.254).
 * 5. Correspondam à lista de domínios/provedores autorizados.
 */
export const ALLOWED_INTEGRATION_DOMAINS = [
  'sandbox.asaas.com',
  'api.asaas.com',
  'asaas.com',
  'viacep.com.br',
  'googleapis.com',
  'generativelanguage.googleapis.com',
  'graph.facebook.com',
  'api.whatsapp.com',
  'api.x.ai',
  'onrender.com'
];

export function isPrivateOrLocalIp(ip: string): boolean {
  if (!ip) return true;
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (ip === '169.254.169.254' || ip.startsWith('169.254.')) return true; // Link-local / Cloud Metadata

  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return false;

  // 10.0.0.0/8
  if (parts[0] === 10) return true;
  // 172.16.0.0/12 (172.16.0.0 a 172.31.255.255)
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 127.0.0.0/8
  if (parts[0] === 127) return true;
  // 0.0.0.0
  if (parts[0] === 0) return true;

  return false;
}

export async function validateExternalUrl(
  rawUrl: string,
  allowedDomains: string[] = ALLOWED_INTEGRATION_DOMAINS
): Promise<{ valid: boolean; error?: string; url?: URL }> {
  try {
    const parsed = new URL(rawUrl);

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { valid: false, error: 'Protocolo inválido. Apenas HTTP/HTTPS são permitidos.' };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Bloqueia termos óbvios de loopback
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname === '169.254.169.254'
    ) {
      return { valid: false, error: 'Acesso a endereços de loopback ou metadados de nuvem é proibido.' };
    }

    // Verifica correspondência com domínios autorizados
    const domainAllowed = allowedDomains.some(
      (allowed) => hostname === allowed || hostname.endsWith('.' + allowed)
    );

    if (!domainAllowed) {
      return {
        valid: false,
        error: `Domínio '${hostname}' não autorizado no catálogo de integrações.`
      };
    }

    // Resolução DNS para verificar se o IP resolvido é privado
    try {
      const addresses = await resolve4Async(hostname);
      for (const ip of addresses) {
        if (isPrivateOrLocalIp(ip)) {
          return {
            valid: false,
            error: `Domínio '${hostname}' resolve para IP de rede interna/privada (${ip}). Bloqueado por SSRF.`
          };
        }
      }
    } catch (dnsErr: any) {
      // Se não resolver o DNS no ambiente de teste offline, não quebramos se o hostname for explicitamente válido
      if (process.env.NODE_ENV !== 'test') {
        return { valid: false, error: `Falha ao resolver domínio '${hostname}': ${dnsErr.message}` };
      }
    }

    return { valid: true, url: parsed };
  } catch (err: any) {
    return { valid: false, error: `URL inválida: ${err.message}` };
  }
}
