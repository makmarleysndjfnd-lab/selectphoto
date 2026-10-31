import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { recordDisasterRecoveryLog } from '../src/services/continuityAuditService';

/**
 * Script de importação posterior da prova durável de restauração/DR.
 * Utilizado quando a publicação remota imediata não estava configurada
 * ou precisou ser adiada por motivos de conectividade.
 */
async function main() {
  console.log('=== [IMPORT_DR_EVIDENCE] Iniciando importação da prova de continuidade ===');

  const scratchDir =
    'C:/Users/mau_m/.gemini/antigravity/brain/737a352e-e887-4563-8bde-25c90099cf82/scratch';
  const evidenceDir = fs.existsSync(scratchDir)
    ? path.join(scratchDir, 'evidence')
    : path.join(process.cwd(), 'scratch', 'evidence');

  let evidenceFilePath = process.argv[2];

  if (!evidenceFilePath) {
    if (fs.existsSync(evidenceDir)) {
      const files = fs.readdirSync(evidenceDir)
        .filter((f) => f.startsWith('dr_restore_proof_') && f.endsWith('.json'))
        .sort()
        .reverse();
      if (files.length > 0) {
        evidenceFilePath = path.join(evidenceDir, files[0]);
        console.log('Nenhum arquivo especificado. Selecionado arquivo mais recente:', evidenceFilePath);
      }
    }
  }

  if (!evidenceFilePath || !fs.existsSync(evidenceFilePath)) {
    console.error('❌ Arquivo de prova não encontrado. Especifique o caminho como argumento.');
    console.error('Exemplo: npx ts-node backend/scripts/import_dr_evidence.ts "caminho/para/dr_restore_proof_XXXX.json"');
    process.exit(1);
  }

  console.log('Lendo arquivo de evidência:', evidenceFilePath);
  const rawContent = fs.readFileSync(evidenceFilePath, 'utf8');
  const evidence = JSON.parse(rawContent);

  if (
    evidence.evidenceType !== 'DISASTER_RECOVERY_ISOLATED_RESTORE_VERIFICATION' ||
    evidence.verifiedRestoreStatus !== 'RESTORE_TESTED_SUCCESS' ||
    !evidence.backupSha256
  ) {
    throw new Error('O arquivo informado não contém uma prova válida de restauração auditada (RESTORE_TESTED_SUCCESS).');
  }

  const targetAuditUrl =
    process.env.AUDIT_DATABASE_URL ||
    process.env.OPERATIONAL_DATABASE_URL ||
    process.env.DATABASE_URL;

  if (!targetAuditUrl) {
    throw new Error('Nenhuma URL de banco de dados configurada (defina AUDIT_DATABASE_URL ou DATABASE_URL).');
  }

  console.log('Conectando ao repositório de destino:', targetAuditUrl.replace(/:[^:@]+@/, ':***@'));
  const auditDb = new PrismaClient({ datasources: { db: { url: targetAuditUrl } } });

  try {
    // Verifica se já existe registro para esse SHA-256 (idempotência)
    const existing = await auditDb.disasterRecoveryAuditLog.findFirst({
      where: { sha256: evidence.backupSha256 },
    });

    if (existing) {
      console.log(`Registro existente localizado (id: ${existing.id}). Atualizando dados de verificação auditada...`);
      await auditDb.disasterRecoveryAuditLog.update({
        where: { id: existing.id },
        data: {
          verifiedRestoreAt: new Date(evidence.verifiedRestoreAt || Date.now()),
          verifiedRestoreStatus: 'RESTORE_TESTED_SUCCESS',
          verifiedRestoreNotes: `Restauração isolada auditada com 100% de sucesso (${evidence.totalRows} linhas em ${evidence.totalTables} tabelas). Importado via import_dr_evidence.ts.`,
          totalTables: evidence.totalTables,
          totalRows: evidence.totalRows,
        },
      });
    } else {
      console.log('Criando novo registro DisasterRecoveryAuditLog...');
      await recordDisasterRecoveryLog(
        {
          backupTimestamp: new Date(evidence.backupTimestamp || Date.now()),
          sha256: evidence.backupSha256,
          sizeBytes: evidence.backupSizeBytes || 0,
          sanitizedSource: evidence.sanitizedSource || 'disposable_cluster',
          verifiedRestoreAt: new Date(evidence.verifiedRestoreAt || Date.now()),
          verifiedRestoreStatus: 'RESTORE_TESTED_SUCCESS',
          verifiedRestoreNotes: `Restauração isolada auditada com 100% de sucesso (${evidence.totalRows} linhas em ${evidence.totalTables} tabelas). Integridade referencial comprovada.`,
          totalTables: evidence.totalTables,
          totalRows: evidence.totalRows,
        },
        auditDb
      );
    }

    // Atualiza arquivo de prova local
    evidence.publication = {
      status: 'PUBLISHED',
      targetAuditDatabase: targetAuditUrl.replace(/:[^:@]+@/, ':***@'),
      publishedAt: new Date().toISOString(),
      importedVia: 'backend/scripts/import_dr_evidence.ts',
      error: null,
    };
    fs.writeFileSync(evidenceFilePath, JSON.stringify(evidence, null, 2), 'utf8');

    console.log('✅ Prova importada com sucesso no repositório de auditoria!');
    console.log('✅ Arquivo de evidência atualizado com status PUBLISHED.');
  } finally {
    await auditDb.$disconnect();
  }
}

main().catch((err) => {
  console.error('❌ Falha na importação da prova de continuidade:', err.message || err);
  process.exit(1);
});
