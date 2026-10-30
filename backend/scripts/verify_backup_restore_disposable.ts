import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import {
  restoreBackupJson,
  assertRestoreEnvironmentSafe,
  encryptBackupPayload,
} from '../src/services/backupService';

async function main() {
  console.log('=== [ISOLATED_RESTORE_VERIFICATION] Iniciando prova de restauracao isolada ===');

  const safety = assertRestoreEnvironmentSafe();
  console.log('Guarda de seguranca aprovada:', safety);

  const prisma = new PrismaClient();

  const scratchDir =
    'C:/Users/mau_m/.gemini/antigravity/brain/737a352e-e887-4563-8bde-25c90099cf82/scratch';
  const plainPath = path.join(scratchDir, 'pre_etapa3_operational_backup.json');

  if (!fs.existsSync(plainPath)) {
    throw new Error('Arquivo de backup JSON não encontrado: ' + plainPath);
  }

  console.log('Carregando arquivo JSON e cifrando com a chave de teste ativa (AES-256-GCM)...');
  const rawJson = fs.readFileSync(plainPath, 'utf8');
  const encryptedPayload = encryptBackupPayload(rawJson);

  console.log('Executando restoreBackupJson (com descriptografia automatica) no cluster descartavel...');
  const result = await restoreBackupJson(encryptedPayload, prisma);
  console.log('✅ Restauracao concluida com sucesso!');
  console.log(`Total de linhas restauradas: ${result.totalRowsRestored}`);
  console.log('Tabelas restauradas:');
  for (const [table, count] of Object.entries(result.restoredTables)) {
    if (count > 0) {
      console.log(`  - ${table}: ${count} registros`);
    }
  }

  // Verificações de integridade referencial estrutural
  const companiesCount = await prisma.company.count();
  const usersCount = await prisma.user.count();
  const clientsCount = await prisma.client.count();
  const salesCount = await prisma.sale.count();

  console.log('=== Verificacao de Integridade Referencial ===');
  console.log(`Companies: ${companiesCount}`);
  console.log(`Users: ${usersCount}`);
  console.log(`Clients: ${clientsCount}`);
  console.log(`Sales: ${salesCount}`);

  // Verifica que relações estão íntegras
  const sampleUser = await prisma.user.findFirst({
    where: { companyId: { not: null } },
    include: { company: true },
  });
  if (sampleUser && !sampleUser.company) {
    throw new Error('Inconsistência referencial: User.companyId não aponta para Company existente.');
  }

  const sampleClient = await prisma.client.findFirst({
    where: { companyId: { not: null } },
    include: { company: true },
  });
  if (sampleClient && !sampleClient.company) {
    throw new Error('Inconsistência referencial: Client.companyId não aponta para Company existente.');
  }

  console.log('✅ Integridade referencial verificada com sucesso!');
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Falha na prova de restauracao isolada:', err);
  process.exit(1);
});
