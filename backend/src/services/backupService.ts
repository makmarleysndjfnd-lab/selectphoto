import { PrismaClient, Prisma } from '@prisma/client';

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

export const restoreBackupJson = async (backupData: Record<string, any>) => {
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

  await prisma.$transaction(
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
            }
          }
        }
      } finally {
        await tx.$executeRawUnsafe(`SET session_replication_role = DEFAULT;`);
      }
    },
    {
      timeout: 60000,
    }
  );
};
