/**
 * Trava de Segurança Obrigatória para Scripts de Staging
 * Garante que nenhuma operação de teste, migration ou limpeza rode fora de 127.0.0.1:5432/selectphoto_staging_local
 */
export function assertStagingSafety(databaseUrl: string | undefined, operationName: string): void {
  if (!databaseUrl || typeof databaseUrl !== 'string') {
    throw new Error(`🛑 [${operationName}] TRAVA DE SEGURANÇA: DATABASE_URL não definida ou inválida.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch (err: any) {
    throw new Error(`🛑 [${operationName}] TRAVA DE SEGURANÇA: URL do banco de dados malformada: ${err.message}`);
  }

  const allowedProtocols = ['postgresql:', 'postgres:'];
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(`🛑 [${operationName}] Protocolo inválido (${parsed.protocol}). Permitido apenas postgresql:.`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const isExactLocalHost = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
  if (!isExactLocalHost) {
    throw new Error(`🛑 [${operationName}] Host inválido (${hostname}). Exigido estritamente 127.0.0.1 ou localhost.`);
  }

  const port = parsed.port || '5432';
  if (port !== '5432') {
    throw new Error(`🛑 [${operationName}] Porta inválida (${port}). Exigida estritamente a porta 5432.`);
  }

  const dbName = parsed.pathname.replace(/^\//, '').split('?')[0];
  if (dbName !== 'selectphoto_staging_local') {
    throw new Error(`🛑 [${operationName}] Banco inválido (${dbName}). Exigido estritamente selectphoto_staging_local.`);
  }

  // Blacklist de palavras proibidas na URL
  const forbiddenHosts = [
    'render.com', 'neon.tech', 'supabase.co', 'supabase.in',
    'amazonaws.com', 'azure.com', 'google.com', 'dpg-', 'oregon-postgres'
  ];

  const fullUrl = databaseUrl.toLowerCase();
  for (const forbidden of forbiddenHosts) {
    if (fullUrl.includes(forbidden)) {
      throw new Error(`🛑 [${operationName}] BLOQUEIO DE SEGURANÇA: Proibido qualquer acesso a provedor externo (${forbidden}).`);
    }
  }
}
