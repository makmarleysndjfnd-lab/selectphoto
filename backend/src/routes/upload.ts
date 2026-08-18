import express, { Response } from 'express';
import { upload } from '../middleware/upload';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import multer from 'multer';

const router = express.Router();

router.post('/', authenticateToken, (req: AuthRequest, res: Response) => {
  upload.single('file')(req, res, (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError) {
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

    const fileUrl = (req.file as any).location || `/uploads/${req.file.filename}`;
    res.json({ url: fileUrl });
  });
});

export default router;

