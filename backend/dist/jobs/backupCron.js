"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initBackupCron = exports.backupCron = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const backupService_1 = require("../services/backupService");
const upload_1 = require("../middleware/upload");
const client_s3_1 = require("@aws-sdk/client-s3");
const backupCron = async () => {
    try {
        console.log('[CRON] Iniciando backup geral do banco de dados...');
        const backupJsonString = await (0, backupService_1.generateBackupJson)();
        const dateStr = new Date().toISOString().split('T')[0];
        const filename = `backups/backup-selectphoto-${dateStr}.json`;
        const command = new client_s3_1.PutObjectCommand({
            Bucket: process.env.B2_BUCKET_NAME || 'selectphoto-comprovantes-app',
            Key: filename,
            Body: backupJsonString,
            ContentType: 'application/json'
        });
        await upload_1.s3.send(command);
        console.log(`[CRON] Backup salvo com sucesso no B2: ${filename}`);
    }
    catch (error) {
        console.error('[CRON] Erro ao fazer backup geral:', error);
    }
};
exports.backupCron = backupCron;
// Configura para rodar às 03:00 da manhã, todos os dias
const initBackupCron = () => {
    node_cron_1.default.schedule('0 3 * * *', () => {
        (0, exports.backupCron)();
    }, {
        timezone: 'America/Sao_Paulo'
    });
    console.log('⏳ Cron job de backup geral agendado para 03:00 AM (BRT).');
};
exports.initBackupCron = initBackupCron;
