import { PrismaClient, Prisma } from '@prisma/client';
import { encryptSecret, decryptSecret } from './vaultService';

const prisma = new PrismaClient();

const OWNER_ONLY_GOVERNANCE_MODELS = new Set([
  'OwnerCapability',
  'StepUpSession',
  'ContractAuditEvent',
  'IntegrationAuditEvent',
  'ApiUsageRecord',
  'PlatformMonthlyStatement',
  'PlatformStatementItem',
  'PlatformStatementAdjustment',
  'PlatformStatementPayment',
  'PlatformCostEntry',
  'OperationalAuditEvent',
  'OperationalReviewAlert',
]);

function sanitizeIntegrationRow(row: any): any {
  const {
    encryptedSecret,
    encryptionIv,
    encryptionAuthTag,
    secretIv,
    secretTag,
    ...rest
  } = row;
  let safeMetadata = rest.configMetadata;
  if (safeMetadata && typeof safeMetadata === 'object' && !Array.isArray(safeMetadata)) {
    const {
      encryptedWebhookToken,
      webhookTokenIv,
      webhookTokenTag,
      ...metaRest
    } = safeMetadata as Record<string, any>;
    safeMetadata = metaRest;
  }
  return {
    ...rest,
    configMetadata: safeMetadata,
  };
}

export const generateBackupJson = async (
  companyId?: string,
  options?: { redactSecretsInGlobal?: boolean }
): Promise<string> => {
  const models = Prisma.dmmf.datamodel.models;
  const redactSecrets = Boolean(companyId) || Boolean(options?.redactSecretsInGlobal);

  const backupData: Record<string, any> = {
    _metadata: {
      timestamp: new Date().toISOString(),
      companyId: companyId || null,
      scope: companyId ? 'COMPANY' : 'GLOBAL',
      secretsRedacted: redactSecrets,
      version: '1.1',
    },
  };

  for (const model of models) {
    const modelName = model.name;
    const prismaProp = modelName.charAt(0).toLowerCase() + modelName.slice(1);

    if (companyId && OWNER_ONLY_GOVERNANCE_MODELS.has(modelName)) {
      continue;
    }

    // @ts-ignore
    if (prisma[prismaProp] && typeof prisma[prismaProp].findMany === 'function') {
      const hasCompanyIdField = model.fields.some((f) => f.name === 'companyId');
      let whereClause: any = undefined;
      if (companyId) {
        if (hasCompanyIdField) {
          whereClause = { companyId };
        } else {
          if (
            modelName === 'Appointment' ||
            modelName === 'Child' ||
            modelName === 'Evaluation' ||
            modelName === 'ClientTimeline'
          ) {
            whereClause = { client: { companyId } };
          } else if (modelName === 'CarChecklist') {
            whereClause = { car: { companyId } };
          } else if (
            modelName === 'DailyClosing' ||
            modelName === 'PersonalAppointment' ||
            modelName === 'SellerCoverBalance'
          ) {
            whereClause = { seller: { companyId } };
          } else if (modelName === 'SalePayment') {
            whereClause = { sale: { companyId } };
          } else if (
            modelName === 'CreditInstallment' ||
            modelName === 'CreditAgreementRenegotiation'
          ) {
            whereClause = { agreement: { companyId } };
          } else if (modelName === 'CreditPaymentAllocation') {
            whereClause = { payment: { companyId } };
          } else if (modelName === 'MonthlyCreditClosingPayout') {
            whereClause = { closing: { companyId } };
          } else {
            continue;
          }
        }
      }

      let rows: any[];
      try {
        // @ts-ignore
        rows = await prisma[prismaProp].findMany(
          whereClause ? { where: whereClause } : undefined
        );
      } catch (err: any) {
        if (err?.code === 'P2021') {
          // Tabela ainda não criada antes de migração DDL aditiva; registra ausente sem abortar backup pré-migração
          continue;
        }
        throw err;
      }

      if (redactSecrets && modelName === 'User') {
        backupData[modelName] = rows.map((u: any) => {
          const { password, fcmToken, ...safeUser } = u;
          return safeUser;
        });
      } else if (redactSecrets && modelName === 'CompanyIntegration') {
        backupData[modelName] = rows.map(sanitizeIntegrationRow);
      } else if (redactSecrets && modelName === 'AsaasConfig') {
        backupData[modelName] = rows.map((cfg: any) => {
          const { apiKey, webhookToken, ...safeCfg } = cfg;
          return safeCfg;
        });
      } else if (redactSecrets && modelName === 'StepUpSession') {
        backupData[modelName] = [];
      } else {
        backupData[modelName] = rows;
      }
    }
  }

  return JSON.stringify(
    backupData,
    (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
    2
  );
};

export function assertRestoreEnvironmentSafe(
  rawDbUrl?: string,
  rawNodeEnv?: string
): { safe: boolean; reason?: string } {
  const nodeEnv = (rawNodeEnv ?? process.env.NODE_ENV ?? '').trim().toLowerCase();
  const dbUrl = (rawDbUrl ?? process.env.DATABASE_URL ?? '').trim().toLowerCase();

  if (nodeEnv === 'production') {
    throw new Error(
      'Guarda de Banco Operacional Ativa: Restauração de backup (restoreBackupJson) é estritamente proibida em ambiente de produção (NODE_ENV=production).'
    );
  }

  if (!dbUrl) {
    throw new Error(
      'Guarda de Banco Operacional Ativa: DATABASE_URL ausente: impossível comprovar que o destino não é operacional.'
    );
  }

  const forbiddenOperationalPatterns = [
    'render.com',
    'dpg-',
    'virginia-postgres',
    'oregon-postgres',
    'frankfurt-postgres',
    'singapore-postgres',
    'ohio-postgres',
    'banco_app_',
    'neon.tech',
    'supabase.co',
    'amazonaws.com',
    'railway.app',
  ];

  for (const pattern of forbiddenOperationalPatterns) {
    if (dbUrl.includes(pattern)) {
      throw new Error(
        `Guarda de Banco Operacional Ativa: Destino do banco contém indicador operacional ('${pattern}'). Restauração rejeitada para proteger o livro financeiro e histórico real.`
      );
    }
  }

  const isLocalHost = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1');
  const hasTestOrStagingMarker =
    dbUrl.includes('test') ||
    dbUrl.includes('staging') ||
    dbUrl.includes('homolog') ||
    dbUrl.includes('sandbox') ||
    dbUrl.includes('disposable');

  if (!isLocalHost || !hasTestOrStagingMarker) {
    throw new Error(
      'Destino de banco não autorizado para restauração: exige host local (localhost/127.0.0.1) e banco explicitamente identificado como test/staging/homolog/sandbox/disposable.'
    );
  }

  return { safe: true };
}

/**
 * Criptografa o JSON de backup usando AES-256-GCM com a chave mestra dedicada.
 */
export function encryptBackupPayload(
  plainJson: string,
  key?: Buffer
): {
  encrypted: string;
  iv: string;
  tag: string;
  algorithm: 'aes-256-gcm';
  encryptedAt: string;
} {
  const enc = encryptSecret(plainJson, key);
  return {
    encrypted: enc.encryptedSecret,
    iv: enc.secretIv,
    tag: enc.secretTag,
    algorithm: 'aes-256-gcm',
    encryptedAt: new Date().toISOString(),
  };
}

/**
 * Descriptografa um container de backup criptografado com AES-256-GCM.
 */
export function decryptBackupPayload(
  payload: { encrypted: string; iv: string; tag: string },
  key?: Buffer
): string {
  return decryptSecret(payload.encrypted, payload.iv, payload.tag, key);
}

export const restoreBackupJson = async (
  rawBackup: Record<string, any> | string,
  dbClient: PrismaClient = prisma
): Promise<{
  restoredTables: Record<string, number>;
  totalRowsRestored: number;
}> => {
  assertRestoreEnvironmentSafe();

  let backupData: Record<string, any>;
  if (typeof rawBackup === 'string') {
    try {
      backupData = JSON.parse(rawBackup);
    } catch {
      throw new Error('Arquivo de backup inválido (JSON corrompido).');
    }
  } else {
    backupData = rawBackup;
  }

  // Se o payload estiver cifrado com AES-256-GCM, descriptografa antes de restaurar
  if (backupData.encrypted && backupData.iv && backupData.tag) {
    const decryptedJson = decryptBackupPayload(backupData as any);
    backupData = JSON.parse(decryptedJson);
  }

  if (!backupData || typeof backupData !== 'object' || !backupData._metadata) {
    throw new Error('Formato de arquivo de backup inválido.');
  }

  if (backupData._metadata.scope !== 'GLOBAL') {
    throw new Error(
      'Restauração global rejeitada: o arquivo fornecido é um backup de empresa (COMPANY), não um backup global.'
    );
  }

  const REQUIRED_CORE_TABLES = ['Company', 'User', 'Client'];
  for (const table of REQUIRED_CORE_TABLES) {
    if (!Array.isArray(backupData[table])) {
      throw new Error(
        `Arquivo de backup corrompido ou incompleto: tabela obrigatória '${table}' ausente.`
      );
    }
  }

  const restoredTables: Record<string, number> = {};
  let totalRowsRestored = 0;

  await dbClient.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET session_replication_role = replica;`);

      try {
        for (const model of Object.keys(backupData)) {
          if (model.startsWith('_')) continue;
          const prismaProp = model.charAt(0).toLowerCase() + model.slice(1);

          // @ts-ignore
          if (tx[prismaProp]) {
            // @ts-ignore
            await tx[prismaProp].deleteMany({});

            const rows = backupData[model];
            if (Array.isArray(rows) && rows.length > 0) {
              const normalizedRows =
                model === 'FichaCodeSequence'
                  ? rows.map((r: any) => ({
                      ...r,
                      nextValue:
                        typeof r.nextValue === 'string'
                          ? BigInt(r.nextValue)
                          : r.nextValue,
                    }))
                  : rows;
              // @ts-ignore
              await tx[prismaProp].createMany({ data: normalizedRows });
              restoredTables[model] = rows.length;
              totalRowsRestored += rows.length;
            } else {
              restoredTables[model] = 0;
            }
          }
        }
      } finally {
        await tx.$executeRawUnsafe(`SET session_replication_role = DEFAULT;`);
      }
    },
    {
      timeout: 120000,
    }
  );

  return { restoredTables, totalRowsRestored };
};
