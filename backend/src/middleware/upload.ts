import multer from 'multer';
import multerS3 from 'multer-s3';
import { S3Client } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

// Configuração do cliente S3 para o Backblaze B2
export const s3 = new S3Client({
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

const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_MIME_TYPES.has(file.mimetype) && ALLOWED_EXTENSIONS.has(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de arquivo não permitido. Apenas imagens (JPEG, PNG, WEBP) e PDF são aceitos.'));
  }
};

export const upload = multer({
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB limit
    files: 1,
  },
  fileFilter,
  storage: multerS3({
    s3: s3,
    bucket: process.env.B2_BUCKET_NAME || 'selectphoto-comprovantes-app',
    acl: 'public-read',
    metadata: function (req: any, file: any, cb: any) {
      cb(null, { fieldName: file.fieldname });
    },
    key: function (req: any, file: any, cb: any) {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      const companyPrefix = req.user?.companyId ? `${req.user.companyId}/` : '';
      const fileName = `${companyPrefix}${uuidv4()}${ext}`;
      cb(null, fileName);
    },
  }),
});

