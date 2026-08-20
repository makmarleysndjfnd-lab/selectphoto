import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';

const router = Router();

const CURRENT_APP_VERSION = '1.0.3';
const CURRENT_BUILD_NUMBER = 3;

// Retorna a versão mais recente do aplicativo e a URL de download se o APK existir
router.get('/version', (req: Request, res: Response) => {
  const apkPath = path.join(__dirname, '../../public/apk/app-release.apk');
  const apkExists = fs.existsSync(apkPath);
  
  const host = req.get('host') || 'selectphoto-k1ac.onrender.com';
  const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const downloadUrl = apkExists ? `${protocol}://${host}/api/app/download` : null;

  res.json({
    version: CURRENT_APP_VERSION,
    buildNumber: CURRENT_BUILD_NUMBER,
    mandatory: false,
    downloadUrl: downloadUrl || '',
    apkAvailable: apkExists
  });
});

// Download do APK se disponível
router.get('/download', (req: Request, res: Response) => {
  const apkPath = path.join(__dirname, '../../public/apk/app-release.apk');
  
  if (fs.existsSync(apkPath)) {
    res.download(apkPath, 'Lumora-release.apk');
  } else {
    res.status(404).json({ error: 'Nenhum APK de atualização disponível no servidor no momento.' });
  }
});

export default router;
