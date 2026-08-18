"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const upload_1 = require("../middleware/upload");
const authMiddleware_1 = require("../middleware/authMiddleware");
const multer_1 = __importDefault(require("multer"));
const router = express_1.default.Router();
router.post('/', authMiddleware_1.authenticateToken, (req, res) => {
    upload_1.upload.single('file')(req, res, (err) => {
        if (err) {
            if (err instanceof multer_1.default.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    res.status(400).json({ error: 'Arquivo muito grande. O limite máximo é 15MB.' });
                    return;
                }
                res.status(400).json({ error: `Erro no upload: ${err.message}` });
                return;
            }
            res.status(400).json({ error: err.message || 'Erro ao processar arquivo' });
            return;
        }
        if (!req.file) {
            res.status(400).json({ error: 'Nenhum arquivo enviado.' });
            return;
        }
        const fileUrl = req.file.location || `/uploads/${req.file.filename}`;
        res.json({ url: fileUrl });
    });
});
exports.default = router;
