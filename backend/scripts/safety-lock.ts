/**
 * Trava de Segurança Obrigatória para Scripts de Staging
 * Garante que nenhuma operação de teste, migration ou limpeza rode fora de 127.0.0.1/selectphoto_staging_local
 */
export function assertStagingSafety(databaseUrl: string | undefined, operationName: string): void {
  if (!databaseUrl) {
    throw new Error(`🛑 [${operationName}] TRAVA DE SEGURANÇA: DATABASE_URL não definida.`);
  }

  const isLocalHost = databaseUrl.includes('127.0.0.1') || databaseUrl.includes('localhost');
  const isStagingDb = databaseUrl.includes('/selectphoto_staging_local');
  const isCloudHost =
    databaseUrl.includes('render.com') ||
    databaseUrl.includes('neon.tech') ||
    databaseUrl.includes('supabase.co') ||
    databaseUrl.includes('supabase.in') ||
    databaseUrl.includes('amazonaws.com') ||
    databaseUrl.includes('azure.com') ||
    databaseUrl.includes('google.com');

  if (!isLocalHost || !isStagingDb || isCloudHost) {
    throw new Error(
      `🛑 [${operationName}] TRAVA DE SEGURANÇA ATIVADA!\n` +
      `Operação bloqueada imediatamente.\n` +
      `Alvo DEVE ser estritamente 127.0.0.1:5432/selectphoto_staging_local.\n` +
      `Proibido qualquer acesso a Render, Neon, Supabase ou hosts externos.`
    );
  }
}
