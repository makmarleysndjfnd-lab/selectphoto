"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upload = exports.s3 = void 0;
const multer_1 = __importDefault(require("multer"));
const multer_s3_1 = __importDefault(require("multer-s3"));
const client_s3_1 = require("@aws-sdk/client-s3");
const uuid_1 = require("uuid");
const path_1 = __importDefault(require("path"));
// Configuração do cliente S3 para o Backblaze B2
exports.s3 = new client_s3_1.S3Client({
    endpoint: process.env.B2_ENDPOINT || 'https://s3.us-east-005.backblazeb2.com',
    region: 'us-east-005',
    credentials: {
        accessKeyId: process.env.B2_KEY_ID || '',
        secretAccessKey: process.env.B2_APPLICATION_KEY || '',
    },
});
const ALLOWED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/jpg',
    'application/pdf',
]);
const ALLOWED_EXTENSIONS = new Set([
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.pdf',
]);
const fileFilter = (req, file, cb) => {
    const ext = path_1.default.extname(file.originalname).toLowerCase();
    if (ALLOWED_MIME_TYPES.has(file.mimetype) && ALLOWED_EXTENSIONS.has(ext)) {
        cb(null, true);
    }
    else {
        cb(new Error('Tipo de arquivo não permitido. Apenas imagens (JPEG, PNG, WEBP) e PDF são aceitos.'));
    }
};
exports.upload = (0, multer_1.default)({
    limits: {
        fileSize: 15 * 1024 * 1024, // 15 MB limit
        files: 1,
    },
    fileFilter,
    storage: (0, multer_s3_1.default)({
        s3: exports.s3,
        bucket: process.env.B2_BUCKET_NAME || 'selectphoto-comprovantes-app',
        acl: 'public-read',
        metadata: function (req, file, cb) {
            cb(null, { fieldName: file.fieldname });
        },
        key: function (req, file, cb) {
            const ext = path_1.default.extname(file.originalname).toLowerCase() || '.jpg';
            const companyPrefix = req.user?.companyId ? `${req.user.companyId}/` : '';
            const fileName = `${companyPrefix}${(0, uuid_1.v4)()}${ext}`;
            cb(null, fileName);
        },
    }),
});
