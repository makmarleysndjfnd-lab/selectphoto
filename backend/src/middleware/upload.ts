import multer from 'multer';
import multerS3 from 'multer-s3';
import { S3Client } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { isExternalServicesDisabled } from '../utils/externalServices';

const uploadDir = path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

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
  // Rejeitar upload quando não houver empresa efetiva
  if (!req.user?.companyId) {
    return cb(new Error('Upload rejeitado: empresa não identificada ou ausente.'));
  }

  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_MIME_TYPES.has(file.mimetype) && ALLOWED_EXTENSIONS.has(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de arquivo não permitido. Apenas imagens (JPEG, PNG, WEBP) e PDF são aceitos.'));
  }
};

function createStorage() {
  const useExternalS3 = !isExternalServicesDisabled() && !!process.env.B2_KEY_ID && !!process.env.B2_APPLICATION_KEY;

  if (useExternalS3) {
    return multerS3({
      s3: s3,
      bucket: process.env.B2_BUCKET_NAME || 'selectphoto-comprovantes-app',
      acl: 'private',
      metadata: function (req: any, file: any, cb: any) {
        cb(null, { fieldName: file.fieldname, companyId: req.user?.companyId || 'UNKNOWN' });
      },
      key: function (req: any, file: any, cb: any) {
        const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
        const companyPrefix = req.user?.companyId ? `${req.user.companyId}/` : 'global/';
        const fileName = `${companyPrefix}${uuidv4()}${ext}`;
        cb(null, fileName);
      },
    });
  }

  // Local storage para staging / testes sem tráfego externo
  return multer.diskStorage({
    destination: (req: any, file, cb) => {
      const companyDir = path.join(uploadDir, req.user?.companyId || 'global');
      if (!fs.existsSync(companyDir)) {
        fs.mkdirSync(companyDir, { recursive: true });
      }
      cb(null, companyDir);
    },
    filename: (req: any, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      const fileId = uuidv4();
      const companyId = req.user?.companyId || 'global';
      const relativeKey = `${companyId}/${fileId}${ext}`;
      // Anexa relativeKey ao objeto do arquivo para compatibilidade
      (file as any).key = relativeKey;
      cb(null, `${fileId}${ext}`);
    }
  });
}

export const upload = multer({
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB limit
    files: 10, // Permite formulários com várias fotos (checklist, documentos, etc.)
  },
  fileFilter,
  storage: createStorage(),
});

export function getUploadedFileUrl(file?: Express.Multer.File): string | null {
  if (!file) return null;
  const anyFile = file as any;
  if (anyFile.key) {
    return `/api/upload/file/${anyFile.key}`;
  }
  if (anyFile.location) {
    return anyFile.location;
  }
  if (anyFile.filename) {
    return `/uploads/${anyFile.filename}`;
  }
  return null;
}
