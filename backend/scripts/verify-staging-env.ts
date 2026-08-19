import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

import { assertStagingSafety } from './safety-lock';

async function verifyStagingEnvironment() {
  const envPath = path.resolve(__dirname, '../.env.test.local');

  if (!fs.existsSync(envPath)) {
    console.error('❌ ERRO CRÍTICO: Arquivo .env.test.local não encontrado.');
    process.exit(1);
  }

  // Carrega estritamente o .env.test.local
  const envConfig = dotenv.parse(fs.readFileSync(envPath));
  const databaseUrl = envConfig.DATABASE_URL;

  if (!databaseUrl || databaseUrl.includes('[SUA_SENHA_AQUI]')) {
    console.error('❌ ERRO: DATABASE_URL não configurada ou senha pendente em .env.test.local.');
    process.exit(1);
  }

  assertStagingSafety(databaseUrl, 'VERIFY_STAGING_ENV');

  // Trava 2: Exigência de host local
  if (!databaseUrl.includes('127.0.0.1') && !databaseUrl.includes('localhost')) {
    console.error('🛑 TRAVA DE SEGURANÇA ATIVADA: DATABASE_URL não aponta para 127.0.0.1/localhost.');
    process.exit(1);
  }

  // Conecta ao banco local
  const prisma = new PrismaClient({
    datasourceUrl: databaseUrl,
  });

  try {
    const result: any = await prisma.$queryRawUnsafe(`
      SELECT
        current_database()::text   AS banco,
        current_user::text         AS usuario,
        coalesce(inet_server_addr()::text, '127.0.0.1') AS host,
        coalesce(inet_server_port()::text, '5432')      AS porta
    `);

    const row = result[0];

    console.log('====================================================');
    console.log('       RELATÓRIO DE VERIFICAÇÃO DO BANCO LOCAL      ');
    console.log('====================================================');
    console.log(`current_database() : ${row.banco}`);
    console.log(`current_user       : ${row.usuario}`);
    console.log(`inet_server_addr() : ${row.host}`);
    console.log(`inet_server_port() : ${row.porta}`);
    console.log('====================================================');

    // Validação das travas obrigatórias
    const errors: string[] = [];
    const cleanHost = row.host ? row.host.split('/')[0] : '127.0.0.1';

    if (row.banco !== 'selectphoto_staging_local') {
      errors.push(`Banco inválido: esperado 'selectphoto_staging_local', obtido '${row.banco}'`);
    }
    if (row.usuario !== 'selectphoto_test_user') {
      errors.push(`Usuário inválido: esperado 'selectphoto_test_user', obtido '${row.usuario}'`);
    }
    if (cleanHost !== '127.0.0.1' && cleanHost !== '::1') {
      errors.push(`Host inválido: esperado '127.0.0.1' ou '::1', obtido '${row.host}'`);
    }
    if (row.porta !== '5432') {
      errors.push(`Porta inválida: esperada '5432', obtida '${row.porta}'`);
    }

    if (errors.length > 0) {
      console.error('\n🛑 TRAVAS VIOLADAS:');
      errors.forEach(err => console.error(` - ${err}`));
      console.error('\nOperação abortada sem executar Prisma.');
      process.exit(1);
    }

    console.log('✅ TRAVAS ATENDIDAS COM SUCESSO.');
    console.log('✅ Banco 100% isolado em 127.0.0.1. Nenhuma conexão com a Render.');
  } catch (err: any) {
    console.error('❌ Falha ao conectar no banco local:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

verifyStagingEnvironment();
