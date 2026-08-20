import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

export const generateBackupJson = async (companyId?: string): Promise<string> => {
  const models = Prisma.dmmf.datamodel.models;
  
  const backupData: Record<string, any> = {
    _metadata: {
      timestamp: new Date().toISOString(),
      companyId: companyId || null,
      scope: companyId ? 'COMPANY' : 'GLOBAL',
      version: '1.0',
    }
  };

  for (const model of models) {
    const modelName = model.name;
    const prismaProp = modelName.charAt(0).toLowerCase() + modelName.slice(1);
    
    // @ts-ignore
    if (prisma[prismaProp] && typeof prisma[prismaProp].findMany === 'function') {
      const hasCompanyIdField = model.fields.some(f => f.name === 'companyId');
      let whereClause: any = undefined;
      if (companyId) {
        if (hasCompanyIdField) {
          whereClause = { companyId };
        } else {
          // Suporte a tabelas filhas sem companyId direto
          if (modelName === 'Appointment' || modelName === 'Child' || modelName === 'Evaluation') {
            whereClause = { client: { companyId } };
          } else if (modelName === 'CarChecklist') {
            whereClause = { car: { companyId } };
          } else if (modelName === 'DailyClosing' || modelName === 'PersonalAppointment' || modelName === 'SellerCoverBalance') {
            whereClause = { seller: { companyId } };
          } else {
            // Modelo sem relação identificada com empresa: omitir do backup multi-tenant
            continue;
          }
        }
      }

      // @ts-ignore
      const rows = await prisma[prismaProp].findMany(whereClause ? { where: whereClause } : undefined);
      
      // Remover hashes de senha e tokens em backups de empresa
      if (companyId && modelName === 'User') {
        backupData[modelName] = rows.map((u: any) => {
          const { password, fcmToken, ...safeUser } = u;
          return safeUser;
        });
      } else {
        backupData[modelName] = rows;
      }
    }
  }

  return JSON.stringify(backupData, null, 2);
};

export const restoreBackupJson = async (backupData: Record<string, any>) => {
  if (!backupData || typeof backupData !== 'object' || !backupData._metadata) {
    throw new Error('Formato de arquivo de backup inválido.');
  }

  if (backupData._metadata.scope !== 'GLOBAL') {
    throw new Error('Restauração global rejeitada: o arquivo fornecido é um backup de empresa (COMPANY), não um backup global.');
  }

  // Validação do conjunto obrigatório de tabelas para restore global seguro
  const REQUIRED_CORE_TABLES = ['Company', 'User', 'Client'];
  for (const table of REQUIRED_CORE_TABLES) {
    if (!Array.isArray(backupData[table])) {
      throw new Error(`Arquivo de backup corrompido ou incompleto: tabela obrigatória '${table}' ausente.`);
    }
  }

  await prisma.$transaction(async (tx) => {
    // Disable foreign key checks for Postgres during restore
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
            // @ts-ignore
            await tx[prismaProp].createMany({ data: rows });
          }
        }
      }
    } finally {
      // Re-enable foreign key checks
      await tx.$executeRawUnsafe(`SET session_replication_role = DEFAULT;`);
    }
  }, {
    timeout: 60000
  });
};
