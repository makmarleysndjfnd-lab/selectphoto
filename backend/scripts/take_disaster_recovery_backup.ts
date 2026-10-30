import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env') });

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL ausente no backend/.env');
    process.exit(1);
  }

  const { generateBackupJson, encryptBackupPayload, decryptBackupPayload } = await import(
    '../src/services/backupService'
  );

  const scratchDir =
    'C:/Users/mau_m/.gemini/antigravity/brain/737a352e-e887-4563-8bde-25c90099cf82/scratch';

  // PRESERVAÇÃO: pre_etapa3_operational_backup.enc.json e .json permanecem intactos!
  const preEtapa3Enc = path.join(scratchDir, 'pre_etapa3_operational_backup.enc.json');
  if (fs.existsSync(preEtapa3Enc)) {
    console.log('ℹ️ Backup pré-migração preservado intacto em:', preEtapa3Enc);
  }

  // NOVO BACKUP PÓS-MIGRAÇÃO DA ETAPA 3
  const plainPath = path.join(scratchDir, 'post_etapa3_delivery_backup.json');
  const encPath = path.join(scratchDir, 'post_etapa3_delivery_backup.enc.json');

  console.log('Capturando estado completo pós-migração com todas as tabelas (Etapas 1, 2 e 3)...');
  const rawJson = await generateBackupJson();
  fs.writeFileSync(plainPath, rawJson, 'utf8');

  const parsed = JSON.parse(rawJson);
  const tableCounts: Record<string, number> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (k.startsWith('_')) continue;
    if (Array.isArray(v)) tableCounts[k] = v.length;
  }

  // Verifica explicitamente a presença das tabelas novas da Etapa 3
  const ETAPA3_TABLES = [
    'PlatformMonthlyStatement',
    'PlatformStatementItem',
    'PlatformStatementAdjustment',
    'PlatformStatementPayment',
    'PlatformCostEntry',
    'OperationalAuditEvent',
    'OperationalReviewAlert',
  ];
  for (const t of ETAPA3_TABLES) {
    if (!(t in tableCounts)) {
      throw new Error(`Tabela nova obrigatória da Etapa 3 '${t}' não está presente no backup pós-migração.`);
    }
  }

  console.log('Criptografando novo backup pós-migração com AES-256-GCM via chave mestra...');
  const encContainer = encryptBackupPayload(rawJson);
  const encJsonString = JSON.stringify(encContainer, null, 2);
  fs.writeFileSync(encPath, encJsonString, 'utf8');

  console.log('Testando descriptografia de integridade imediata...');
  const decryptedCheck = decryptBackupPayload(encContainer);
  const parsedDecrypted = JSON.parse(decryptedCheck);

  if (parsedDecrypted._metadata?.scope !== 'GLOBAL') {
    throw new Error('Falha na validação do escopo após descriptografia.');
  }

  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(encPath)).digest('hex').toUpperCase();

  console.log('✅ BACKUP PÓS-MIGRAÇÃO DA ETAPA 3 CIFRADO COM SUCESSO');
  console.log('ENC_PATH=' + encPath);
  console.log('ENC_BYTES=' + fs.statSync(encPath).size);
  console.log('SHA256=' + sha256);
  console.log('SCOPE=' + parsed._metadata?.scope);
  console.log('TIMESTAMP=' + parsed._metadata?.timestamp);
  console.log('ALGORITHM=' + encContainer.algorithm);
  console.log('TOTAL_TABLES=' + Object.keys(tableCounts).length);
  console.log('TABLE_COUNTS=' + JSON.stringify(tableCounts));
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Falha na geração/cifragem do backup pós-migração:', err);
  process.exit(1);
});
