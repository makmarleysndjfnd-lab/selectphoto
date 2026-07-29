"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLatestOnlineBackupDate = void 0;
const upload_1 = require("../middleware/upload");
const client_s3_1 = require("@aws-sdk/client-s3");
const getLatestOnlineBackupDate = async () => {
    try {
        const command = new client_s3_1.ListObjectsV2Command({
            Bucket: process.env.B2_BUCKET_NAME || 'selectphoto-comprovantes-app',
            Prefix: 'backups/',
        });
        const response = await upload_1.s3.send(command);
        if (!response.Contents || response.Contents.length === 0) {
            return null;
        }
        // Sort by LastModified (descending)
        const sorted = response.Contents.sort((a, b) => {
            const dateA = a.LastModified ? a.LastModified.getTime() : 0;
            const dateB = b.LastModified ? b.LastModified.getTime() : 0;
            return dateB - dateA;
        });
        const latest = sorted[0];
        if (latest.LastModified) {
            return latest.LastModified;
        }
        return null;
    }
    catch (error) {
        console.error('Erro ao buscar último backup online:', error);
        return null;
    }
};
exports.getLatestOnlineBackupDate = getLatestOnlineBackupDate;
