import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { recordDisasterRecoveryLog } from '../src/services/continuityAuditService';

export interface EvidenceValidationResult {
  valid: boolean;
  error?: string;
  details?: Record<string, any>;
}

/**
 * Validação estrutural de formato e consistência interna do manifesto de evidência.
 * ATENÇÃO: Esta rotina valida o formato sintático (ex.: SHA-256 em 64 caracteres hexadecimais)
 * e a consistência aritmética das contagens do manifesto. A validação criptográfica real
 * dos bytes integrais do backup contra esse hash é realizada nas Fases 1 e 2 durante o restoreBackupJson.
 */
export function validateEvidenceData(evidence: any): EvidenceValidationResult {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return { valid: false, error: 'O conteúdo da evidência deve ser um objeto JSON válido.' };
  }

  if (evidence.evidenceType !== 'DISASTER_RECOVERY_ISOLATED_RESTORE_VERIFICATION') {
    return {
      valid: false,
      error: `evidenceType inválido: esperado 'DISASTER_RECOVERY_ISOLATED_RESTORE_VERIFICATION', recebido '${evidence.evidenceType}'.`,
    };
  }

  if (evidence.verifiedRestoreStatus !== 'RESTORE_TESTED_SUCCESS') {
    return {
      valid: false,
      error: `verifiedRestoreStatus inválido: esperado 'RESTORE_TESTED_SUCCESS', recebido '${evidence.verifiedRestoreStatus}'.`,
    };
  }

  // Validação de formato SHA-256 (exatamente 64 caracteres hexadecimais)
  const sha256 = typeof evidence.backupSha256 === 'string' ? evidence.backupSha256.trim() : '';
  if (!sha256 || !/^[A-Fa-f0-9]{64}$/.test(sha256)) {
    return {
      valid: false,
      error: `backupSha256 inválido: esperado exatamente 64 caracteres hexadecimais (SHA-256), recebido '${evidence.backupSha256}'.`,
    };
  }

  // Tamanho do arquivo cifrado em bytes (inteiro positivo)
  const sizeBytes = evidence.backupSizeBytes;
  if (typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    return {
      valid: false,
      error: `backupSizeBytes inválido: esperado inteiro positivo > 0, recebido '${sizeBytes}'.`,
    };
  }

  // Validação de datas
  if (!evidence.backupTimestamp || typeof evidence.backupTimestamp !== 'string' || isNaN(Date.parse(evidence.backupTimestamp))) {
    return {
      valid: false,
      error: `backupTimestamp inválido: esperado timestamp ISO 8601 válido, recebido '${evidence.backupTimestamp}'.`,
    };
  }

  if (!evidence.verifiedRestoreAt || typeof evidence.verifiedRestoreAt !== 'string' || isNaN(Date.parse(evidence.verifiedRestoreAt))) {
    return {
      valid: false,
      error: `verifiedRestoreAt inválido: esperado timestamp ISO 8601 válido, recebido '${evidence.verifiedRestoreAt}'.`,
    };
  }

  // Validação de contagens inteiras
  const totalTables = evidence.totalTables;
  if (typeof totalTables !== 'number' || !Number.isInteger(totalTables) || totalTables < 0) {
    return {
      valid: false,
      error: `totalTables inválido: esperado inteiro >= 0, recebido '${totalTables}'.`,
    };
  }

  const totalRows = evidence.totalRows;
  if (typeof totalRows !== 'number' || !Number.isInteger(totalRows) || totalRows < 0) {
    return {
      valid: false,
      error: `totalRows inválido: esperado inteiro >= 0, recebido '${totalRows}'.`,
    };
  }

  // Validação do mapa detalhado de tabelas (tableCounts)
  if (!evidence.tableCounts || typeof evidence.tableCounts !== 'object' || Array.isArray(evidence.tableCounts)) {
    return {
      valid: false,
      error: 'tableCounts inválido: esperado mapa de contagens por tabela (Record<string, number>).',
    };
  }

  const tableNames = Object.keys(evidence.tableCounts);

  // Consistência estrita entre totalTables e a quantidade de tabelas em tableCounts
  if (tableNames.length !== totalTables) {
    return {
      valid: false,
      error: `Divergência em totalTables: manifesto declara ${totalTables} tabelas, mas tableCounts contém ${tableNames.length} tabelas detalhadas.`,
    };
  }

  // Consistência estrita entre totalRows e o somatório dos registros em tableCounts
  let calculatedRowsSum = 0;
  for (const tableName of tableNames) {
    const count = evidence.tableCounts[tableName];
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
      return {
        valid: false,
        error: `Contagem inválida na tabela '${tableName}': esperado inteiro >= 0, recebido '${count}'.`,
      };
    }
    calculatedRowsSum += count;
  }

  if (calculatedRowsSum !== totalRows) {
    return {
      valid: false,
      error: `Divergência em totalRows: totalRows declara ${totalRows} linhas, mas a soma de tableCounts totaliza ${calculatedRowsSum} linhas.`,
    };
  }

  return {
    valid: true,
    details: {
      sha256,
      sizeBytes,
      totalTables,
      totalRows,
      calculatedRowsSum,
    },
  };
}

/**
 * Importa a prova de continuidade no repositório de auditoria especificado.
 * Executa todas as validações estruturais ANTES de abrir conexões ou gravar dados no banco.
 */
export async function importDrEvidence(
  evidenceFilePath: string,
  options?: { auditDatabaseUrl?: string }
): Promise<{ success: boolean; auditLogId: string; sha256: string }> {
  if (!evidenceFilePath || typeof evidenceFilePath !== 'string' || evidenceFilePath.trim().length === 0) {
    throw new Error('Caminho do arquivo de evidência não informado.');
  }

  const resolvedPath = path.resolve(evidenceFilePath.trim());
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Arquivo de evidência não encontrado no caminho: "${resolvedPath}".`);
  }

  let rawContent: string;
  let evidence: any;
  try {
    rawContent = fs.readFileSync(resolvedPath, 'utf8');
    evidence = JSON.parse(rawContent);
  } catch (err: any) {
    throw new Error(`Falha ao ler/parsear arquivo JSON em "${resolvedPath}": ${err.message}`);
  }

  // Validação estrutural rigorosa ANTES de qualquer conexão com banco de dados
  const validation = validateEvidenceData(evidence);
  if (!validation.valid) {
    throw new Error(`Prova de restauração rejeitada por inconsistência estrutural: ${validation.error}`);
  }

  const targetAuditUrl =
    options?.auditDatabaseUrl ||
    process.env.AUDIT_DATABASE_URL ||
    process.env.OPERATIONAL_DATABASE_URL ||
    process.env.DATABASE_URL;

  if (!targetAuditUrl) {
    throw new Error('Nenhuma URL de banco de dados configurada (defina AUDIT_DATABASE_URL ou DATABASE_URL).');
  }

  const sanitizedTargetUrl = targetAuditUrl.replace(/:[^:@]+@/, ':***@');
  console.log('Conectando ao repositório de auditoria de destino:', sanitizedTargetUrl);

  const auditDb = new PrismaClient({ datasources: { db: { url: targetAuditUrl } } });

  try {
    // Busca registro existente por SHA-256 para importação idempotente
    const existing = await auditDb.disasterRecoveryAuditLog.findFirst({
      where: { sha256: evidence.backupSha256 },
    });

    let auditLogId: string;

    if (existing) {
      console.log(`Registro existente localizado (id: ${existing.id}). Atualizando dados de verificação auditada...`);
      const updated = await auditDb.disasterRecoveryAuditLog.update({
        where: { id: existing.id },
        data: {
          verifiedRestoreAt: new Date(evidence.verifiedRestoreAt),
          verifiedRestoreStatus: 'RESTORE_TESTED_SUCCESS',
          verifiedRestoreNotes: `Restauração isolada auditada com 100% de sucesso (${evidence.totalRows} linhas em ${evidence.totalTables} tabelas). Importado via import_dr_evidence.ts.`,
          totalTables: evidence.totalTables,
          totalRows: evidence.totalRows,
        },
      });
      auditLogId = updated.id;
    } else {
      console.log('Criando novo registro DisasterRecoveryAuditLog...');
      const created = await recordDisasterRecoveryLog(
        {
          backupTimestamp: new Date(evidence.backupTimestamp),
          sha256: evidence.backupSha256,
          sizeBytes: evidence.backupSizeBytes,
          sanitizedSource: evidence.sanitizedSource || 'disposable_cluster',
          verifiedRestoreAt: new Date(evidence.verifiedRestoreAt),
          verifiedRestoreStatus: 'RESTORE_TESTED_SUCCESS',
          verifiedRestoreNotes: `Restauração isolada auditada com 100% de sucesso (${evidence.totalRows} linhas em ${evidence.totalTables} tabelas). Integridade referencial comprovada.`,
          totalTables: evidence.totalTables,
          totalRows: evidence.totalRows,
        },
        auditDb
      );
      auditLogId = created.id;
    }

    // Atualiza o arquivo de evidência local com o status PUBLISHED
    evidence.publication = {
      status: 'PUBLISHED',
      targetAuditDatabase: sanitizedTargetUrl,
      publishedAt: new Date().toISOString(),
      importedVia: 'backend/scripts/import_dr_evidence.ts',
      error: null,
    };
    fs.writeFileSync(resolvedPath, JSON.stringify(evidence, null, 2), 'utf8');

    console.log('✅ Prova importada com sucesso no repositório de auditoria! Log ID:', auditLogId);
    console.log('✅ Arquivo de evidência atualizado com status PUBLISHED.');

    return {
      success: true,
      auditLogId,
      sha256: evidence.backupSha256,
    };
  } catch (err: any) {
    // Em caso de falha de conexão/publicação, grava a indicação de erro no arquivo de evidência local
    try {
      evidence.publication = {
        status: 'FAILED',
        targetAuditDatabase: sanitizedTargetUrl,
        publishedAt: null,
        importedVia: 'backend/scripts/import_dr_evidence.ts',
        error: err?.message || String(err),
      };
      fs.writeFileSync(resolvedPath, JSON.stringify(evidence, null, 2), 'utf8');
    } catch {
      // Ignora falhas secundárias de gravação do arquivo
    }
    throw err;
  } finally {
    await auditDb.$disconnect().catch(() => {});
  }
}

// Execução via linha de comando
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('import_dr_evidence.ts') ||
    process.argv[1].endsWith('import_dr_evidence.js') ||
    (typeof require !== 'undefined' && require.main === module));

if (isMain) {
  const filePathArg = process.argv[2]?.trim();

  if (!filePathArg) {
    console.error('=== [IMPORT_DR_EVIDENCE] Parâmetro obrigatório ausente ===');
    console.error('Uso: npx ts-node backend/scripts/import_dr_evidence.ts <caminho_da_prova.json>');
    console.error('Instrução: informe o caminho explícito do arquivo de evidência de restauração auditada (.json).');
    console.error('Nenhum arquivo foi selecionado automaticamente e nenhuma conexão ou gravação de banco foi efetuada.');
    process.exit(1);
  }

  importDrEvidence(filePathArg)
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Falha na importação da prova de continuidade:', err.message || err);
      process.exit(1);
    });
}
