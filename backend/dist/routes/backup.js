"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = require("../middleware/authMiddleware");
const backupService_1 = require("../services/backupService");
const backupOnlineService_1 = require("../services/backupOnlineService");
const multer_1 = __importDefault(require("multer"));
const uploadMem = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});
const router = (0, express_1.Router)();
// Geração e Download de Backup
// Super Admin pode baixar global; Admin de empresa baixa apenas os dados da própria empresa
router.get('/download', authMiddleware_1.authenticateToken, authMiddleware_1.requireAdmin, async (req, res) => {
    try {
        const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';
        const targetCompanyId = isSuperAdmin ? undefined : req.user?.companyId;
        const backupJsonString = await (0, backupService_1.generateBackupJson)(targetCompanyId);
        const dateStr = new Date().toISOString().split('T')[0];
        const companySuffix = targetCompanyId ? `-${targetCompanyId}` : '-global';
        const filename = `backup-selectphoto${companySuffix}-${dateStr}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(backupJsonString);
    }
    catch (error) {
        console.error('Erro ao baixar backup:', error);
        res.status(500).json({ error: 'Erro ao gerar backup' });
    }
});
// Restauração de Banco Integral - Restrita EXCLUSIVAMENTE a SUPER_ADMIN
router.post('/restore', authMiddleware_1.authenticateToken, authMiddleware_1.requireSuperAdmin, uploadMem.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            res.status(400).json({ error: 'Nenhum arquivo enviado.' });
            return;
        }
        const force = req.query.force === 'true';
        const fileContent = req.file.buffer.toString('utf-8');
        let backupData;
        try {
            backupData = JSON.parse(fileContent);
        }
        catch {
            res.status(400).json({ error: 'Arquivo de backup inválido (JSON corrompido).' });
            return;
        }
        // Verificação de integridade dos metadados
        if (!backupData._metadata || typeof backupData._metadata !== 'object') {
            res.status(400).json({ error: 'Arquivo inválido: metadados de backup ausentes.' });
            return;
        }
        // Verificação de data contra backup online
        if (!force) {
            const fileTimestamp = backupData._metadata?.timestamp;
            if (fileTimestamp) {
                const fileDate = new Date(fileTimestamp);
                const onlineDate = await (0, backupOnlineService_1.getLatestOnlineBackupDate)();
                if (onlineDate && onlineDate > fileDate) {
                    res.status(409).json({
                        error: 'O backup online é mais recente que o arquivo selecionado.',
                        requiresForce: true
                    });
                    return;
                }
            }
        }
        await (0, backupService_1.restoreBackupJson)(backupData);
        res.json({ message: 'Backup restaurado com sucesso!' });
    }
    catch (error) {
        console.error('Erro ao restaurar backup:', error);
        res.status(500).json({ error: 'Erro ao processar o arquivo de backup.' });
    }
});
exports.default = router;
