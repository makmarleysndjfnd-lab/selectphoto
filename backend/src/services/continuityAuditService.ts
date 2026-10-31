import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export type DisasterRecoveryVerificationStatus =
  | 'BACKUP_CREATED'
  | 'BACKUP_INTEGRITY_VERIFIED'
  | 'RESTORE_TESTED_SUCCESS'
  | 'RESTORE_TESTED_FAILURE'
  | 'PENDING_VERIFICATION'
  | 'NO_BACKUP_REGISTERED';

export interface DisasterRecoveryStatus {
  lastBackupTimestamp: string | null;
  sha256: string | null;
  sizeBytes: number | null;
  sanitizedSource: string;
  verifiedRestoreAt: string | null;
  verifiedRestoreStatus: DisasterRecoveryVerificationStatus;
  verifiedRestoreNotes: string | null;
  totalTables: number;
  totalRows: number;
  securityPolicies: {
    allowGlobalWebDownload: boolean;
    allowWebRestore: boolean;
    reason: string;
  };
}

/**
 * Retorna o status real de continuidade e recuperação de desastres (DR) para o painel do proprietário.
 * Cumpre a regra estrita de NÃO inventar dados, contagens ou datas de restauração:
 * se não houver auditoria comprovada no ambiente, retorna NO_BACKUP_REGISTERED.
 */
export async function getDisasterRecoveryStatus(
  db: PrismaClient = prisma
): Promise<DisasterRecoveryStatus> {
  const latestLog = await db.disasterRecoveryAuditLog.findFirst({
    orderBy: { backupTimestamp: 'desc' },
  });

  // Políticas imutáveis de segurança de infraestrutura
  const securityPolicies = {
    allowGlobalWebDownload: false,
    allowWebRestore: false,
    reason:
      'Por segurança operacional e proteção patrimonial de dados, backups globais e restaurações de banco de dados não podem ser disparados via interface web. Restaurações exigem execução direta em terminal/CLI com chaves locais de infraestrutura e logs auditados.',
  };

  if (latestLog) {
    return {
      lastBackupTimestamp: latestLog.backupTimestamp.toISOString(),
      sha256: latestLog.sha256,
      sizeBytes: latestLog.sizeBytes,
      sanitizedSource: latestLog.sanitizedSource,
      verifiedRestoreAt: latestLog.verifiedRestoreAt ? latestLog.verifiedRestoreAt.toISOString() : null,
      verifiedRestoreStatus: (latestLog.verifiedRestoreStatus as DisasterRecoveryVerificationStatus) || 'PENDING_VERIFICATION',
      verifiedRestoreNotes: latestLog.verifiedRestoreNotes,
      totalTables: latestLog.totalTables,
      totalRows: latestLog.totalRows,
      securityPolicies,
    };
  }

  // Sem prova registrada na base de auditoria, retorna NO_BACKUP_REGISTERED sem dados simulados
  return {
    lastBackupTimestamp: null,
    sha256: null,
    sizeBytes: null,
    sanitizedSource: 'Nenhum backup registrado',
    verifiedRestoreAt: null,
    verifiedRestoreStatus: 'NO_BACKUP_REGISTERED',
    verifiedRestoreNotes: 'Nenhum log auditado de backup ou restauração registrado neste ambiente.',
    totalTables: 0,
    totalRows: 0,
    securityPolicies,
  };
}

/**
 * Registra formalmente um evento de backup e restauração verificada.
 */
export async function recordDisasterRecoveryLog(
  params: {
    backupTimestamp: Date;
    sha256: string;
    sizeBytes: number;
    sanitizedSource: string;
    verifiedRestoreAt?: Date;
    verifiedRestoreStatus?: DisasterRecoveryVerificationStatus;
    verifiedRestoreNotes?: string;
    totalTables: number;
    totalRows: number;
  },
  db: PrismaClient = prisma
) {
  return db.disasterRecoveryAuditLog.create({
    data: {
      backupTimestamp: params.backupTimestamp,
      sha256: params.sha256,
      sizeBytes: params.sizeBytes,
      sanitizedSource: params.sanitizedSource,
      verifiedRestoreAt: params.verifiedRestoreAt || null,
      verifiedRestoreStatus: params.verifiedRestoreStatus || 'BACKUP_CREATED',
      verifiedRestoreNotes: params.verifiedRestoreNotes || null,
      totalTables: params.totalTables,
      totalRows: params.totalRows,
    },
  });
}

/**
 * Bloqueio de segurança operacional:
 * Restauração web arbitrária é expressamente proibida.
 */
export function assertWebRestoreForbidden(): never {
  const err: any = new Error(
    'Ação bloqueada: Restauração de banco de dados via interface web é estritamente proibida por segurança operacional. Use os utilitários de infraestrutura auditados via CLI.'
  );
  err.status = 403;
  err.code = 'WEB_RESTORE_FORBIDDEN';
  throw err;
}

/**
 * Bloqueio de segurança operacional:
 * Download global de dump via web é expressamente proibido.
 */
export function assertGlobalDumpDownloadForbidden(): never {
  const err: any = new Error(
    'Ação bloqueada: Download global de dump de banco de dados é proibido via API web para prevenir exfiltração de dados. O gerenciamento de backups é restrito aos canais cifrados de infraestrutura.'
  );
  err.status = 403;
  err.code = 'GLOBAL_DUMP_DOWNLOAD_FORBIDDEN';
  throw err;
}
