import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env') });

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL ausente no backend/.env');
    process.exit(1);
  }

  const { generateBackupJson } = await import('../src/services/backupService');

  const scratchDir =
    'C:/Users/mau_m/.gemini/antigravity/brain/737a352e-e887-4563-8bde-25c90099cf82/scratch';
  const outPath = path.join(scratchDir, 'pre_etapa3_operational_backup.json');

  console.log('Gerando backup recuperavel GLOBAL pre-migracao Etapa 3...');
  const raw = await generateBackupJson();
  fs.writeFileSync(outPath, raw, 'utf8');

  const parsed = JSON.parse(raw);
  const tableCounts: Record<string, number> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (k.startsWith('_')) continue;
    if (Array.isArray(v)) tableCounts[k] = v.length;
  }

  console.log('BACKUP_PATH=' + outPath);
  console.log('BACKUP_BYTES=' + fs.statSync(outPath).size);
  console.log('BACKUP_SCOPE=' + parsed._metadata?.scope);
  console.log('BACKUP_TIMESTAMP=' + parsed._metadata?.timestamp);
  console.log('BACKUP_TABLES=' + JSON.stringify(tableCounts));
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Falha no backup pre-migracao:', err);
  process.exit(1);
});

