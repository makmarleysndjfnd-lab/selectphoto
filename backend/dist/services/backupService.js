"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restoreBackupJson = exports.generateBackupJson = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const generateBackupJson = async () => {
    // Pega a lista de todos os modelos através do DMMF
    const models = client_1.Prisma.dmmf.datamodel.models;
    const backupData = {
        _metadata: {
            timestamp: new Date().toISOString()
        }
    };
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
        }
        catch (error) {
            console.error(`Erro ao fazer backup da tabela ${modelName}:`, error);
        }
    }
    return JSON.stringify(backupData, null, 2);
};
exports.generateBackupJson = generateBackupJson;
const restoreBackupJson = async (backupData) => {
    await prisma.$transaction(async (tx) => {
        // Disable foreign key checks for Postgres
        await tx.$executeRawUnsafe(`SET session_replication_role = replica;`);
        try {
            // Loop backwards or any order to delete and recreate. Since FKs are disabled, order doesn't matter strictly for Postgres, but let's just do it.
            for (const model of Object.keys(backupData)) {
                if (model === '_metadata')
                    continue;
                const prismaProp = model.charAt(0).toLowerCase() + model.slice(1);
                // @ts-ignore
                if (tx[prismaProp]) {
                    // @ts-ignore
                    await tx[prismaProp].deleteMany({});
                    const rows = backupData[model];
                    if (rows && rows.length > 0) {
                        // @ts-ignore
                        await tx[prismaProp].createMany({ data: rows });
                    }
                }
            }
        }
        finally {
            // Re-enable foreign key checks
            await tx.$executeRawUnsafe(`SET session_replication_role = DEFAULT;`);
        }
    }, {
        timeout: 30000 // Aumenta timeout caso banco seja grande
    });
};
exports.restoreBackupJson = restoreBackupJson;
