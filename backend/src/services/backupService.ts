import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

export const generateBackupJson = async (companyId?: string): Promise<string> => {
  const models = Prisma.dmmf.datamodel.models;
  
  const backupData: Record<string, any> = {
    _metadata: {
      timestamp: new Date().toISOString(),
      companyId: companyId || 'GLOBAL',
      version: '1.0',
    }
  };

  for (const model of models) {
    const modelName = model.name;
    const prismaProp = modelName.charAt(0).toLowerCase() + modelName.slice(1);
    
    try {
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
        backupData[modelName] = rows;
      }
    } catch (error) {
      console.error(`Erro ao fazer backup da tabela ${modelName}:`, error);
    }
  }

  return JSON.stringify(backupData, null, 2);
};

export const restoreBackupJson = async (backupData: Record<string, any>) => {
  if (!backupData || typeof backupData !== 'object' || !backupData._metadata) {
    throw new Error('Formato de arquivo de backup inválido.');
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

