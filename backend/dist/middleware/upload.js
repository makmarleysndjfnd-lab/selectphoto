"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upload = void 0;
const multer_1 = __importDefault(require("multer"));
const multer_s3_1 = __importDefault(require("multer-s3"));
const client_s3_1 = require("@aws-sdk/client-s3");
const uuid_1 = require("uuid");
const path_1 = __importDefault(require("path"));
// Configuração do cliente S3 para o Backblaze B2
const s3 = new client_s3_1.S3Client({
    endpoint: process.env.B2_ENDPOINT || 'https://s3.us-east-005.backblazeb2.com',
    region: 'us-east-005', // A região é extraída do endpoint (ex: us-east-005)
    credentials: {
        accessKeyId: process.env.B2_KEY_ID || '',
        secretAccessKey: process.env.B2_APPLICATION_KEY || '',
    },
});
exports.upload = (0, multer_1.default)({
    storage: (0, multer_s3_1.default)({
        s3: s3,
        bucket: process.env.B2_BUCKET_NAME || 'selectphoto-comprovantes-app',
        acl: 'public-read', // Permite que a foto seja lida publicamente pelo app
        metadata: function (req, file, cb) {
            cb(null, { fieldName: file.fieldname });
        },
        key: function (req, file, cb) {
            const ext = path_1.default.extname(file.originalname) || '.jpg';
            const fileName = `${(0, uuid_1.v4)()}${ext}`;
            cb(null, fileName);
        },
    }),
});
