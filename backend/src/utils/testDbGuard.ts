import { PrismaClient } from '@prisma/client';

export interface ExpectedTestDbConfig {
  allowedHosts?: string[];
  expectedPort?: number;
  allowedDatabases?: string[];
  allowedUsers?: string[];
}

export const DEFAULT_EXPECTED_TEST_DB_CONFIG: Required<ExpectedTestDbConfig> = {
  allowedHosts: ['127.0.0.1', 'localhost', '::1'],
  expectedPort: 5433,
  allowedDatabases: ['selectphoto_capacity_test', 'selectphoto_test'],
  allowedUsers: ['postgres', 'selectphoto_test_user'],
};

export class TestDatabaseProtectionError extends Error {
  public readonly code: string;
  public readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'TestDatabaseProtectionError';
    this.code = code;
    this.details = details;
  }
}

export interface ParsedTestDbUrl {
  host: string;
  port: number;
  database: string;
  user: string;
}

/**
 * Valida estritamente a string de conexão DATABASE_URL antes de qualquer operação de limpeza de banco.
 * Garante que host, porta, nome do banco e usuário pertencem exclusivamente ao ambiente de teste local.
 */
export function validateTestDatabaseUrl(
  rawUrl?: string | null,
  customExpected?: ExpectedTestDbConfig
): ParsedTestDbUrl {
  const expected: Required<ExpectedTestDbConfig> = {
    ...DEFAULT_EXPECTED_TEST_DB_CONFIG,
    ...(customExpected || {}),
  };

  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new TestDatabaseProtectionError(
      'TEST_DB_URL_MISSING',
      'Operação abortada: DATABASE_URL ausente ou vazia ao tentar limpar banco de testes.'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new TestDatabaseProtectionError(
      'TEST_DB_URL_MALFORMED',
      'Operação abortada: DATABASE_URL malformada ao validar proteção do banco de testes.',
      { rawUrl }
    );
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new TestDatabaseProtectionError(
      'TEST_DB_PROTOCOL_INVALID',
      `Operação abortada: protocolo de banco inválido (${parsed.protocol}).`,
      { protocol: parsed.protocol }
    );
  }

  const host = (parsed.hostname || '').toLowerCase();
  const port = parsed.port ? parseInt(parsed.port, 10) : 5432;
  const database = (parsed.pathname || '').replace(/^\/+/, '').trim();
  const user = decodeURIComponent(parsed.username || '').trim();

  if (!host || !expected.allowedHosts.map((h) => h.toLowerCase()).includes(host)) {
    throw new TestDatabaseProtectionError(
      'TEST_DB_HOST_MISMATCH',
      `Operação abortada: host "${host}" não é permitido para limpeza de testes. Permitidos: ${expected.allowedHosts.join(', ')}.`,
      { host, allowedHosts: expected.allowedHosts }
    );
  }

  if (port !== expected.expectedPort) {
    throw new TestDatabaseProtectionError(
      'TEST_DB_PORT_MISMATCH',
      `Operação abortada: porta ${port} diverge da porta exclusiva de testes (${expected.expectedPort}).`,
      { port, expectedPort: expected.expectedPort }
    );
  }

  if (!database || !expected.allowedDatabases.includes(database)) {
    throw new TestDatabaseProtectionError(
      'TEST_DB_NAME_MISMATCH',
      `Operação abortada: banco "${database}" não é um banco exclusivo de testes (${expected.allowedDatabases.join(', ')}).`,
      { database, allowedDatabases: expected.allowedDatabases }
    );
  }

  if (!user || !expected.allowedUsers.includes(user)) {
    throw new TestDatabaseProtectionError(
      'TEST_DB_USER_MISMATCH',
      `Operação abortada: usuário "${user}" não é o usuário exclusivo de testes (${expected.allowedUsers.join(', ')}).`,
      { user, allowedUsers: expected.allowedUsers }
    );
  }

  return { host, port, database, user };
}

/**
 * Inspeciona a sessão efetiva ativa no PostgreSQL e valida que ela corresponde exatamente
 * ao host, porta, banco e usuário exclusivos de teste antes de executar qualquer limpeza.
 */
export async function assertSafeEffectiveTestConnection(
  prisma: Pick<PrismaClient, '$queryRawUnsafe'>,
  rawUrl?: string | null,
  customExpected?: ExpectedTestDbConfig
): Promise<ParsedTestDbUrl> {
  const expected: Required<ExpectedTestDbConfig> = {
    ...DEFAULT_EXPECTED_TEST_DB_CONFIG,
    ...(customExpected || {}),
  };

  const urlConfig = validateTestDatabaseUrl(rawUrl, expected);

  const rows = (await prisma.$queryRawUnsafe(`
    SELECT
      current_database() AS db,
      current_user AS usr,
      COALESCE(inet_server_addr()::text, '127.0.0.1') AS addr,
      COALESCE(inet_server_port(), 0)::int AS port
  `)) as Array<{ db: string; usr: string; addr: string; port: number }>;

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new TestDatabaseProtectionError(
      'TEST_DB_EFFECTIVE_CHECK_EMPTY',
      'Operação abortada: não foi possível verificar a conexão efetiva do PostgreSQL.'
    );
  }

  const effective = rows[0];
  const rawAddr = String(effective.addr || '')
    .toLowerCase()
    .replace(/\/\d+$/, '');
  const effectivePort = Number(effective.port);
  const effectiveDb = String(effective.db || '').trim();
  const effectiveUser = String(effective.usr || '').trim();

  if (!expected.allowedHosts.map((h) => h.toLowerCase()).includes(rawAddr)) {
    throw new TestDatabaseProtectionError(
      'TEST_DB_EFFECTIVE_HOST_MISMATCH',
      `Operação abortada: endereço efetivo do servidor PostgreSQL (${rawAddr}) não é local de teste.`,
      { effectiveAddr: rawAddr, allowedHosts: expected.allowedHosts }
    );
  }

  if (effectivePort !== expected.expectedPort || effectivePort !== urlConfig.port) {
    throw new TestDatabaseProtectionError(
      'TEST_DB_EFFECTIVE_PORT_MISMATCH',
      `Operação abortada: porta efetiva da conexão PostgreSQL (${effectivePort}) diverge da porta de teste (${expected.expectedPort}).`,
      { effectivePort, expectedPort: expected.expectedPort, urlPort: urlConfig.port }
    );
  }

  if (effectiveDb !== urlConfig.database || !expected.allowedDatabases.includes(effectiveDb)) {
    throw new TestDatabaseProtectionError(
      'TEST_DB_EFFECTIVE_NAME_MISMATCH',
      `Operação abortada: banco efetivo conectado ("${effectiveDb}") diverge do banco de teste configurado ("${urlConfig.database}").`,
      { effectiveDb, urlDatabase: urlConfig.database, allowedDatabases: expected.allowedDatabases }
    );
  }

  if (effectiveUser !== urlConfig.user || !expected.allowedUsers.includes(effectiveUser)) {
    throw new TestDatabaseProtectionError(
      'TEST_DB_EFFECTIVE_USER_MISMATCH',
      `Operação abortada: usuário efetivo conectado ("${effectiveUser}") diverge do usuário de teste configurado ("${urlConfig.user}").`,
      { effectiveUser, urlUser: urlConfig.user, allowedUsers: expected.allowedUsers }
    );
  }

  return urlConfig;
}

/**
 * Executa a limpeza das tabelas públicas SOMENTE após validar que tanto a URL quanto a conexão
 * efetiva ativa no PostgreSQL pertencem exclusivamente ao banco de testes.
 */
export async function safeTruncateTestDatabase(
  prisma: Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>,
  rawUrl?: string | null,
  customExpected?: ExpectedTestDbConfig
): Promise<{ truncatedTables: number; connection: ParsedTestDbUrl }> {
  const connection = await assertSafeEffectiveTestConnection(prisma, rawUrl, customExpected);

  const tables = (await prisma.$queryRawUnsafe(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `)) as Array<{ tablename: string }>;

  if (Array.isArray(tables) && tables.length > 0) {
    const tableList = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE;`);
    return { truncatedTables: tables.length, connection };
  }

  return { truncatedTables: 0, connection };
}

