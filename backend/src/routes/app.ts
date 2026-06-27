import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';

const router = Router();

// This endpoint returns the latest available app version and the download URL.
router.get('/version', (req: Request, res: Response) => {
  // In a real production system, this could be stored in the DB or env vars.
  // We can read from a simple config file or hardcode for now.
  const latestVersion = '1.0.1'; // Update this whenever a new APK is uploaded
  const apkFileName = 'app-release.apk';
  const downloadUrl = `${req.protocol}://${req.get('host')}/api/app/download`;

  res.json({
    version: latestVersion,
    mandatory: false,
    downloadUrl
  });
});

// Endpoint to actually download the APK
router.get('/download', (req: Request, res: Response) => {
  // We assume the APK is placed in a "public/apk" directory in the backend
  const apkPath = path.join(__dirname, '../../public/apk/app-release.apk');
  
  if (fs.existsSync(apkPath)) {
    res.download(apkPath);
  } else {
    res.status(404).json({ error: 'APK not found on server' });
  }
});

export default router;
