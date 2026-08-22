import express, { Response } from 'express';
import { upload, safeUpload, getUploadedFileUrl, s3 } from '../middleware/upload';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { isExternalServicesDisabled } from '../utils/externalServices';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import path from 'path';
import fs from 'fs';

const router = express.Router();
const uploadDir = path.resolve(__dirname, '../../uploads');

// Upload de arquivo único
router.post('/', authenticateToken, (req: AuthRequest, res: Response, next) => {
  if (!req.user?.companyId && req.user?.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Upload não permitido: empresa não identificada.' });
    return;
  }
  next();
}, safeUpload(upload.single('file')), (req: AuthRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    return;
  }

  const fileKey = (req.file as any).key || (req.file.filename ? `${req.user?.companyId || 'global'}/${req.file.filename}` : null);
  const fileUrl = getUploadedFileUrl(req.file) || (fileKey ? `/api/upload/file/${fileKey}` : null);

  res.json({
    url: fileUrl,
    key: fileKey
  });
});

// Proxy / Download autenticado e escopado por empresa de arquivos privados
router.get('/file/:companyId/:filename', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.params.companyId as string;
    const filename = req.params.filename as string;
    const requestedKey = `${companyId}/${filename}`;
    const userRole = req.user?.role;
    const userCompanyId = req.user?.companyId;

    // Validação estrita de isolamento multiempresa
    if (userRole !== 'SUPER_ADMIN' && userCompanyId !== companyId) {
      res.status(403).json({ error: 'Forbidden: Acesso negado a arquivo de outra empresa.' });
      return;
    }

    // Se estiver em modo local/mock ou o arquivo existir localmente
    const localFilePath = path.join(uploadDir, companyId, filename);
    if (fs.existsSync(localFilePath)) {
      const ext = path.extname(filename).toLowerCase();
      let contentType = 'application/octet-stream';
      if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.webp') contentType = 'image/webp';
      else if (ext === '.pdf') contentType = 'application/pdf';

      res.setHeader('Content-Type', contentType);
      fs.createReadStream(localFilePath).pipe(res);
      return;
    }

    // Se estiver em produção com S3 habilitado
    if (!isExternalServicesDisabled() && process.env.B2_KEY_ID && process.env.B2_APPLICATION_KEY) {
      const getCommand = new GetObjectCommand({
        Bucket: process.env.B2_BUCKET_NAME || 'selectphoto-comprovantes-app',
        Key: requestedKey,
      });

      const s3Response = await s3.send(getCommand);
      if (s3Response.ContentType) {
        res.setHeader('Content-Type', s3Response.ContentType);
      }
      if (s3Response.ContentLength) {
        res.setHeader('Content-Length', s3Response.ContentLength.toString());
      }
      
      (s3Response.Body as any).pipe(res);
      return;
    }

    res.status(404).json({ error: 'Arquivo não encontrado.' });
  } catch (error: any) {
    console.error('Error fetching file:', error?.message || error);
    res.status(500).json({ error: 'Erro ao buscar arquivo.' });
  }
});

export default router;
