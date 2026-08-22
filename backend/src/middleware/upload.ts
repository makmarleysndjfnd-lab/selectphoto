import multer from 'multer';
import multerS3 from 'multer-s3';
import { S3Client } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { RequestHandler, Response } from 'express';
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
  if (!req.user?.companyId && req.user?.role !== 'SUPER_ADMIN') {
    return cb(new Error('Upload rejeitado: empresa não identificada ou ausente.'));
  }

  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_MIME_TYPES.has(file.mimetype) && ALLOWED_EXTENSIONS.has(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de arquivo não permitido. Apenas imagens (JPEG, PNG, WEBP) e PDF são aceitos.'));
  }
};

const diskStorage = multer.diskStorage({
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
    (file as any).key = relativeKey;
    cb(null, `${fileId}${ext}`);
  }
});

let s3Storage: any = null;
function getS3Storage() {
  if (!s3Storage) {
    s3Storage = multerS3({
      s3: s3,
      bucket: process.env.B2_BUCKET_NAME || 'selectphoto-comprovantes-app',
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
  return s3Storage;
}

// Storage dinâmico com avaliação em runtime por requisição
const dynamicStorage: multer.StorageEngine = {
  _handleFile(req: any, file: any, cb: any) {
    const useExternalS3 = !isExternalServicesDisabled() && !!process.env.B2_KEY_ID && !!process.env.B2_APPLICATION_KEY;
    const targetStorage = useExternalS3 ? getS3Storage() : diskStorage;
    targetStorage._handleFile(req, file, cb);
  },
  _removeFile(req: any, file: any, cb: any) {
    const useExternalS3 = !isExternalServicesDisabled() && !!process.env.B2_KEY_ID && !!process.env.B2_APPLICATION_KEY;
    const targetStorage = useExternalS3 ? getS3Storage() : diskStorage;
    targetStorage._removeFile(req, file, cb);
  }
};

export const upload = multer({
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB limit
    files: 10,
  },
  fileFilter,
  storage: dynamicStorage,
});

export function handleUploadError(err: any, res: Response): boolean {
  if (!err) return false;

  // 1. Erros do próprio Multer (tamanho, limite de arquivos, campos inesperados)
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'Arquivo muito grande. O limite máximo é 15MB.' });
      return true;
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      res.status(400).json({ error: 'Número de arquivos enviados excede o limite permitido.' });
      return true;
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      res.status(400).json({ error: `Campo de arquivo não esperado no formulário: ${err.field || ''}`.trim() });
      return true;
    }
    res.status(400).json({ error: `Erro no upload: ${err.message}` });
    return true;
  }

  const errName = (err.name || '').toString();
  const errMsg = (err.message || '').toString();
  const errCode = (err.code || '').toString();
  const lowerMsg = errMsg.toLowerCase();
  const lowerName = errName.toLowerCase();
  const lowerCode = errCode.toLowerCase();

  // 2. Erros de validação de negócio/MIME/Empresa -> HTTP 400
  if (
    lowerMsg.includes('tipo de arquivo') ||
    lowerMsg.includes('não permitido') ||
    lowerMsg.includes('apenas imagens') ||
    lowerMsg.includes('empresa não identificada') ||
    lowerMsg.includes('upload rejeitado')
  ) {
    res.status(400).json({ error: errMsg });
    return true;
  }

  // 3. Falhas do S3/Backblaze B2 e erros de rede -> HTTP 503 amigável e seguro
  const isStorageOrNetworkError =
    errName === 'InvalidAccessKeyId' ||
    errName === 'SignatureDoesNotMatch' ||
    errName === 'AccessDenied' ||
    errName === 'NoSuchBucket' ||
    errName === 'ServiceUnavailable' ||
    errName === 'TimeoutError' ||
    errName === 'NetworkingError' ||
    lowerName.includes('s3') ||
    lowerName.includes('storage') ||
    lowerCode === 'econnreset' ||
    lowerCode === 'econnrefused' ||
    lowerCode === 'etimedout' ||
    lowerCode === 'enotfound' ||
    lowerCode === 'esockettimedout' ||
    lowerMsg.includes('invalidaccesskeyid') ||
    lowerMsg.includes('signaturedoesnotmatch') ||
    lowerMsg.includes('accessdenied') ||
    lowerMsg.includes('nosuchbucket') ||
    lowerMsg.includes('serviceunavailable') ||
    lowerMsg.includes('networking') ||
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('socket') ||
    lowerMsg.includes('econnrefused') ||
    lowerMsg.includes('econnreset') ||
    lowerMsg.includes('etimedout');

  if (isStorageOrNetworkError) {
    console.error('🚨 [SAFE_UPLOAD] Falha no serviço de armazenamento externo:', {
      name: errName,
      code: errCode,
      message: errMsg.replace(/(keyId|secret|token|password|auth|authorization)=([^\s&]+)/gi, '$1=***')
    });
    res.status(503).json({ error: 'Armazenamento temporariamente indisponível. Tente novamente mais tarde.' });
    return true;
  }

  // 4. Fallback seguro para qualquer outra falha de upload -> HTTP 503 sem vazar stack trace
  console.error('🚨 [SAFE_UPLOAD] Erro inesperado no processamento de mídia:', {
    name: errName,
    code: errCode
  });
  res.status(503).json({ error: 'Não foi possível processar o envio do arquivo. Tente novamente mais tarde.' });
  return true;
}

/**
 * Middleware wrapper que captura erros de upload do Multer/S3
 * e retorna respostas padronizadas com tratamento granular sem stack traces.
 */
export function safeUpload(multerMiddleware: any): RequestHandler {
  return (req: any, res: any, next: any) => {
    multerMiddleware(req, res, (err: any) => {
      if (err) {
        return handleUploadError(err, res);
      }
      next();
    });
  };
}

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
