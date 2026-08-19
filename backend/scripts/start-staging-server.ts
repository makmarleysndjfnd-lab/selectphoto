import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { assertStagingSafety } from './safety-lock';

// 1. Carregar .env.test.local
const envPath = path.resolve(__dirname, '../.env.test.local');
if (!fs.existsSync(envPath)) {
  console.error('❌ ERRO: .env.test.local não encontrado.');
  process.exit(1);
}

const envConfig = dotenv.parse(fs.readFileSync(envPath));
const databaseUrl = envConfig.DATABASE_URL;

// Trava estrita de segurança
assertStagingSafety(databaseUrl, 'START_STAGING_SERVER');

// Injetar variáveis de staging no ambiente
process.env.DATABASE_URL = databaseUrl;
process.env.JWT_SECRET = envConfig.JWT_SECRET || 'selectphoto_staging_local_jwt_test_2026_nao_usar_em_producao';
process.env.PORT = envConfig.PORT || '3001';
process.env.DISABLE_CRON = 'true';

// Mocks explícitos de serviços externos para homologação sem internet
process.env.GEMINI_API_KEY = '';
process.env.OPENAI_API_KEY = '';
process.env.B2_KEY_ID = '';
process.env.B2_APPLICATION_KEY = '';
process.env.B2_BUCKET_NAME = '';
process.env.B2_ENDPOINT = '';
process.env.FIREBASE_SERVICE_ACCOUNT = '';

console.log('====================================================');
console.log('    INICIANDO BACKEND DE STAGING (HOMOLOGAÇÃO)      ');
console.log('====================================================');
console.log(`  Porta:             ${process.env.PORT}`);
console.log(`  Host DB:           127.0.0.1:5432`);
console.log(`  Banco:             selectphoto_staging_local`);
console.log(`  Chamadas Externas: DESATIVADAS (Mocks ativos; zero chamadas a Render, Gemini, OpenAI, B2, Firebase, Maps)`);
console.log('====================================================\n');

// Importar e iniciar servidor Express
import('../src/index').then(() => {
  console.log(`✅ Servidor de Staging pronto e escutando em http://127.0.0.1:${process.env.PORT}`);
});
