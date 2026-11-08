import { PrismaClient, Prisma } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const isTestRuntime =
  process.env.NODE_ENV === 'test' ||
  Boolean(process.env.NODE_TEST_CONTEXT) ||
  process.argv.some((a) => a.includes('--test') || a.endsWith('.test.ts') || a.endsWith('.spec.ts'));

if (isTestRuntime) {
  process.env.NODE_ENV = 'test';
  process.env.DISABLE_CRON = 'true';
  process.env.EXTERNAL_SERVICES_DISABLED = process.env.EXTERNAL_SERVICES_DISABLED || 'true';
  const testEnvPath = path.resolve(__dirname, '../../.env.test.local');
  if (fs.existsSync(testEnvPath)) {
    const parsed = dotenv.parse(fs.readFileSync(testEnvPath));
    if (
      parsed.DATABASE_URL &&
      (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('render.com'))
    ) {
      process.env.DATABASE_URL = parsed.DATABASE_URL;
    }
    if (parsed.JWT_SECRET && !process.env.JWT_SECRET) {
      process.env.JWT_SECRET = parsed.JWT_SECRET;
    }
  }
}

export type PrismaTransaction = Prisma.TransactionClient;

export interface PrismaConfigOptions {
  connectionLimit?: number;
  poolTimeout?: number;
  datasourceUrl?: string;
}

/**
 * Monta a URL de conexão do PostgreSQL garantindo os parâmetros `connection_limit` e `pool_timeout`
 * necessários para o Prisma 6.19.3 e a cota de conexões do Render PostgreSQL.
 */
export function formatDatasourceUrl(
  rawUrl?: string,
  customLimit?: number,
  customTimeout?: number
): string {
  const base = (rawUrl || process.env.DATABASE_URL || '').trim();
  if (!base) return '';

  const envLimit = process.env.PRISMA_CONNECTION_LIMIT || process.env.DATABASE_POOL_SIZE;
  const connectionLimit = customLimit ?? (envLimit ? parseInt(envLimit, 10) : 5);

  const envTimeout = process.env.PRISMA_POOL_TIMEOUT;
  const poolTimeout = customTimeout ?? (envTimeout ? parseInt(envTimeout, 10) : 10);

  try {
    const url = new URL(base);
    // Configura o connection_limit se informado expressamente ou se ausente na URL
    if (Number.isFinite(connectionLimit) && connectionLimit > 0) {
      if (!url.searchParams.has('connection_limit') || customLimit !== undefined || envLimit !== undefined) {
        url.searchParams.set('connection_limit', String(connectionLimit));
      }
    }
    // Configura o pool_timeout se informado expressamente ou se ausente na URL
    if (Number.isFinite(poolTimeout) && poolTimeout >= 0) {
      if (!url.searchParams.has('pool_timeout') || customTimeout !== undefined || envTimeout !== undefined) {
        url.searchParams.set('pool_timeout', String(poolTimeout));
      }
    }
    return url.toString();
  } catch (_e) {
    // Caso a string não seja uma URL formal padrão, faz o append manual
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}connection_limit=${connectionLimit}&pool_timeout=${poolTimeout}`;
  }
}

let _singletonInstance: PrismaClient | null = null;
let _currentConfigKey: string | null = null;

/**
 * Obtém a instância compartilhada (singleton) do PrismaClient para o processo atual.
 * Permite passagem de opções para testes ou inicialização personalizada.
 */
export function getPrisma(options?: PrismaConfigOptions): PrismaClient {
  // Se já há instância e nenhuma opção específica foi solicitada, retorna a atual
  const hasCustomOptions = options && (options.datasourceUrl || options.connectionLimit !== undefined || options.poolTimeout !== undefined);

  if (_singletonInstance && !hasCustomOptions) {
    return _singletonInstance;
  }

  const effectiveUrl = formatDatasourceUrl(options?.datasourceUrl, options?.connectionLimit, options?.poolTimeout);
  const configKey = effectiveUrl || 'default';

  if (_singletonInstance && _currentConfigKey === configKey) {
    return _singletonInstance;
  }

  // Se já havia uma instância com outra configuração (ex: troca de banco em teste), fecha a anterior
  if (_singletonInstance && _currentConfigKey !== configKey) {
    _singletonInstance.$disconnect().catch(() => {});
    _singletonInstance = null;
  }

  const clientOptions: Prisma.PrismaClientOptions = {};
  if (effectiveUrl) {
    clientOptions.datasourceUrl = effectiveUrl;
  }
  if (process.env.DEBUG_PRISMA === 'true') {
    clientOptions.log = ['query', 'info', 'warn', 'error'];
  }

  _singletonInstance = new PrismaClient(clientOptions);
  _currentConfigKey = configKey;
  return _singletonInstance;
}

/**
 * Permite injeção de uma instância customizada/mockada nos testes.
 */
export function setPrisma(client: PrismaClient | null): void {
  _singletonInstance = client;
  _currentConfigKey = client ? 'injected' : null;
}

/**
 * Desconecta a instância singleton limpando os recursos de conexão.
 */
export async function disconnectPrisma(): Promise<void> {
  if (_singletonInstance) {
    const inst = _singletonInstance;
    _singletonInstance = null;
    _currentConfigKey = null;
    try {
      await inst.$disconnect();
    } catch (err) {
      console.warn('⚠️ [prisma] Erro ao desconectar Prisma singleton:', err);
    }
  }
}

/**
 * Reseta o singleton desconectando qualquer conexão ativa.
 */
export async function resetPrisma(): Promise<void> {
  await disconnectPrisma();
}

/**
 * Export padrão: Proxy transparente que delega qualquer propriedade ou método ao singleton atual.
 * Suporta injeção dinâmica em testes sem re-importação de módulos.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, _receiver) {
    const client = getPrisma() as any;
    if (!client) return undefined;
    const value = client[prop];
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
  set(_target, prop, value) {
    const client = getPrisma() as any;
    if (client) {
      client[prop] = value;
    }
    return true;
  },
});

export { PrismaClient, Prisma };
export default prisma;
