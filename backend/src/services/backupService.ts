import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

export const generateBackupJson = async (): Promise<string> => {
  // Pega a lista de todos os modelos através do DMMF
  const models = Prisma.dmmf.datamodel.models;
  
  const backupData: Record<string, any> = {};

  for (const model of models) {
    const modelName = model.name;
    // O nome da propriedade no prismaClient é geralmente minúsculo com o primeiro caractere em minúsculo
    const prismaProp = modelName.charAt(0).toLowerCase() + modelName.slice(1);
    
    try {
      // @ts-ignore
      if (prisma[prismaProp] && typeof prisma[prismaProp].findMany === 'function') {
        // @ts-ignore
        const rows = await prisma[prismaProp].findMany();
        backupData[modelName] = rows;
      }
    } catch (error) {
      console.error(`Erro ao fazer backup da tabela ${modelName}:`, error);
    }
  }

  return JSON.stringify(backupData, null, 2);
};
