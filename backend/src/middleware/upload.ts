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

// ── Validação de variáveis B2 na inicialização (sem imprimir valores) ─────────
function validateB2Config(): void {
  const required = ['B2_ENDPOINT', 'B2_BUCKET_NAME', 'B2_KEY_ID', 'B2_APPLICATION_KEY'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0 && !isExternalServicesDisabled()) {
    console.warn(
      `[UPLOAD] Variáveis B2 ausentes: ${missing.join(', ')}. ` +
      'Upload externo ficará indisponível até que sejam configuradas.'
    );
  }
  // Coerência endpoint × região (aviso seguro, sem imprimir valores)
  const endpoint = process.env.B2_ENDPOINT || '';
  const region = process.env.B2_REGION || '';
  if (endpoint && region && !endpoint.includes(region)) {
    console.warn('[UPLOAD] B2_REGION pode não corresponder ao endpoint configurado. Verifique a consistência.');
  }
}
validateB2Config();

// ── Extrair região do endpoint como fallback seguro ────────────────────────────
export function resolveB2Region(endpointOverride?: string, regionOverride?: string): string {
  const fromEnv = regionOverride !== undefined ? regionOverride : process.env.B2_REGION;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  // Formato B2: https://s3.<region>.backblazeb2.com
  const endpoint = endpointOverride !== undefined ? endpointOverride : (process.env.B2_ENDPOINT || '');
  const match = endpoint.match(/s3\.([^.]+)\.backblazeb2\.com/);
  if (match) return match[1];
  return 'us-east-005'; // fallback conservador
}

// ── Fábrica de configuração do cliente S3 para o Backblaze B2 ─────────────────
// requestChecksumCalculation: 'WHEN_REQUIRED' evita envio automático de CRC32
// que o B2 S3-compatible não suporta (retornaria NotImplemented).
export function createB2S3Client(options?: {
  endpoint?: string;
  region?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
  forcePathStyle?: boolean;
}): S3Client {
  const endpoint = options?.endpoint || process.env.B2_ENDPOINT || 'https://s3.us-east-005.backblazeb2.com';
  const region = options?.region || resolveB2Region(options?.endpoint, options?.region);
  return new S3Client({
    endpoint,
    region,
    credentials: options?.credentials || {
      accessKeyId: process.env.B2_KEY_ID || '',
      secretAccessKey: process.env.B2_APPLICATION_KEY || '',
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    forcePathStyle: options?.forcePathStyle ?? true,
  });
}

export const s3 = createB2S3Client();

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

// ── Sanitizador de mensagem de erro (sem vazar segredos) ──────────────────────
function sanitizeErrorMessage(msg: string): string {
  return msg
    .replace(/(keyId|secret|token|password|auth|authorization|key|credential)=([^\s&"']+)/gi, '$1=***')
    .replace(/https?:\/\/[^@\s]+@[^\s"']+/gi, 'https://***@***')
    .substring(0, 300);
}

// ── Anonimizar requestId (manter apenas prefixo para correlação) ──────────────
function anonymizeRequestId(requestId?: string): string {
  if (!requestId) return 'n/a';
  return requestId.length > 8 ? `${requestId.substring(0, 8)}...` : requestId;
}

export interface UploadFileMetadata {
  fieldname?: string;
  mimetype?: string;
  size?: number;
}

export function handleUploadError(
  err: any,
  res: Response,
  correlationId?: string,
  fileMeta?: UploadFileMetadata
): boolean {
  if (!err) return false;

  const corrId = correlationId || uuidv4().substring(0, 8);

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

  // Metadados S3 seguros para log
  const httpStatus = err.$metadata?.httpStatusCode;
  const rawRequestId = err.$metadata?.requestId || err.requestId;

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

  // 3. Falhas do S3/Backblaze B2, checksum e rede -> HTTP 503 amigável e seguro
  const isAuthError =
    errName === 'InvalidAccessKeyId' ||
    errName === 'SignatureDoesNotMatch' ||
    errName === 'AccessDenied' ||
    lowerMsg.includes('invalidaccesskeyid') ||
    lowerMsg.includes('signaturedoesnotmatch') ||
    lowerMsg.includes('accessdenied');

  const isStorageOrNetworkError =
    isAuthError ||
    errName === 'NoSuchBucket' ||
    // Checksum e compatibilidade B2 (incluídos na 1.0.5)
    errName === 'NotImplemented' ||
    errName === 'InvalidArgument' ||
    errName === 'BadDigest' ||
    errName === 'ChecksumMismatch' ||
    errName === 'XAmzContentSHA256Mismatch' ||
    // Disponibilidade
    errName === 'ServiceUnavailable' ||
    errName === 'TimeoutError' ||
    errName === 'NetworkingError' ||
    lowerName.includes('s3') ||
    lowerName.includes('storage') ||
    // Códigos de rede
    lowerCode === 'econnreset' ||
    lowerCode === 'econnrefused' ||
    lowerCode === 'etimedout' ||
    lowerCode === 'enotfound' ||
    lowerCode === 'esockettimedout' ||
    // Mensagem como fallback
    lowerMsg.includes('nosuchbucket') ||
    lowerMsg.includes('notimplemented') ||
    lowerMsg.includes('invalidargument') ||
    lowerMsg.includes('baddigest') ||
    lowerMsg.includes('checksum') ||
    lowerMsg.includes('serviceunavailable') ||
    lowerMsg.includes('networking') ||
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('socket') ||
    lowerMsg.includes('econnrefused') ||
    lowerMsg.includes('econnreset') ||
    lowerMsg.includes('etimedout');

  // Metadados seguros do arquivo (quando disponíveis)
  const safeFileMeta = {
    fieldname: fileMeta?.fieldname || 'n/a',
    mimetype: fileMeta?.mimetype || 'n/a',
    sizeBytes: fileMeta?.size !== undefined ? fileMeta.size : 'n/a',
  };

  if (isStorageOrNetworkError) {
    // Para erros de autenticação, evita mensagem bruta para prevenir vazamento
    const sanitizedMsg = isAuthError
      ? 'Falha de autenticação/autorização no serviço de armazenamento externo'
      : sanitizeErrorMessage(errMsg);

    console.error('🚨 [SAFE_UPLOAD] Falha no serviço de armazenamento externo:', {
      correlationId: corrId,
      name: errName,
      code: errCode,
      httpStatus: httpStatus ?? 'n/a',
      requestId: anonymizeRequestId(rawRequestId),
      ...safeFileMeta,
      message: sanitizedMsg,
    });
    res.status(503).json({
      error: 'Armazenamento temporariamente indisponível. Tente novamente mais tarde.',
      supportCode: corrId,
    });
    return true;
  }

  // 4. Fallback seguro para qualquer outra falha de upload -> HTTP 503 sem vazar stack trace
  console.error('🚨 [SAFE_UPLOAD] Erro inesperado no processamento de mídia:', {
    correlationId: corrId,
    name: errName,
    code: errCode,
    httpStatus: httpStatus ?? 'n/a',
    requestId: anonymizeRequestId(rawRequestId),
    ...safeFileMeta,
  });
  res.status(503).json({
    error: 'Não foi possível processar o envio do arquivo. Tente novamente mais tarde.',
    supportCode: corrId,
  });
  return true;
}

/**
 * Middleware wrapper que captura erros de upload do Multer/S3
 * e retorna respostas padronizadas com tratamento granular sem stack traces.
 * Gera um correlationId único por requisição para rastreabilidade segura.
 */
export function safeUpload(multerMiddleware: any): RequestHandler {
  return (req: any, res: any, next: any) => {
    const correlationId = uuidv4().substring(0, 8);
    multerMiddleware(req, res, (err: any) => {
      if (err) {
        const fileMeta: UploadFileMetadata = {
          fieldname: req.file?.fieldname ?? (Array.isArray(req.files) ? req.files[0]?.fieldname : undefined),
          mimetype: req.file?.mimetype ?? (Array.isArray(req.files) ? req.files[0]?.mimetype : undefined),
          size: req.file?.size ?? (Array.isArray(req.files) ? req.files[0]?.size : undefined),
        };
        return handleUploadError(err, res, correlationId, fileMeta);
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
