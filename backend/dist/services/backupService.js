"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restoreBackupJson = exports.generateBackupJson = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const generateBackupJson = async (companyId) => {
    const models = client_1.Prisma.dmmf.datamodel.models;
    const backupData = {
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
                let whereClause = undefined;
                if (companyId && hasCompanyIdField) {
                    whereClause = { companyId };
                }
                else if (companyId && !hasCompanyIdField) {
                    // If model has no direct companyId (e.g. system configurations), skip if doing tenant-scoped backup
                    if (['User', 'Team', 'Car'].includes(modelName)) {
                        whereClause = { companyId };
                    }
                    else {
                        continue;
                    }
                }
                // @ts-ignore
                const rows = await prisma[prismaProp].findMany(whereClause ? { where: whereClause } : undefined);
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
    if (!backupData || typeof backupData !== 'object' || !backupData._metadata) {
        throw new Error('Formato de arquivo de backup inválido.');
    }
    await prisma.$transaction(async (tx) => {
        // Disable foreign key checks for Postgres during restore
        await tx.$executeRawUnsafe(`SET session_replication_role = replica;`);
        try {
            for (const model of Object.keys(backupData)) {
                if (model.startsWith('_'))
                    continue;
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
        }
        finally {
            // Re-enable foreign key checks
            await tx.$executeRawUnsafe(`SET session_replication_role = DEFAULT;`);
        }
    }, {
        timeout: 60000
    });
};
exports.restoreBackupJson = restoreBackupJson;
