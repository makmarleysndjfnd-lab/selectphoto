import fs from 'fs';
import path from 'path';
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
  const plainPath = path.join(scratchDir, 'pre_etapa3_operational_backup.json');
  const encPath = path.join(scratchDir, 'pre_etapa3_operational_backup.enc.json');

  let rawJson: string;
  if (fs.existsSync(plainPath)) {
    console.log('Utilizando backup existente em:', plainPath);
    rawJson = fs.readFileSync(plainPath, 'utf8');
  } else {
    console.log('Gerando novo backup GLOBAL completo...');
    rawJson = await generateBackupJson();
    fs.writeFileSync(plainPath, rawJson, 'utf8');
  }

  const parsed = JSON.parse(rawJson);
  const tableCounts: Record<string, number> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (k.startsWith('_')) continue;
    if (Array.isArray(v)) tableCounts[k] = v.length;
  }

  console.log('Criptografando payload de desastre com AES-256-GCM via chave mestra...');
  const encContainer = encryptBackupPayload(rawJson);
  fs.writeFileSync(encPath, JSON.stringify(encContainer, null, 2), 'utf8');

  console.log('Testando descriptografia de integridade imediata...');
  const decryptedCheck = decryptBackupPayload(encContainer);
  const parsedDecrypted = JSON.parse(decryptedCheck);

  if (parsedDecrypted._metadata?.scope !== 'GLOBAL') {
    throw new Error('Falha na validação do escopo após descriptografia.');
  }

  console.log('✅ BACKUP GLOBAL CIFRADO COM SUCESSO');
  console.log('PLAIN_PATH=' + plainPath);
  console.log('ENC_PATH=' + encPath);
  console.log('ENC_BYTES=' + fs.statSync(encPath).size);
  console.log('SCOPE=' + parsed._metadata?.scope);
  console.log('TIMESTAMP=' + parsed._metadata?.timestamp);
  console.log('ALGORITHM=' + encContainer.algorithm);
  console.log('TOTAL_TABLES=' + Object.keys(tableCounts).length);
  console.log('TABLE_COUNTS=' + JSON.stringify(tableCounts));
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Falha na geração/cifragem do backup de desastre:', err);
  process.exit(1);
});

