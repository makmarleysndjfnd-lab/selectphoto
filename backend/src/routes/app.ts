import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const router = Router();

export const CURRENT_APP_VERSION = '1.0.6';
export const CURRENT_BUILD_NUMBER = 7;
export const EXPECTED_APK_SHA256 =
  process.env.EXPECTED_APK_SHA256 ||
  'B6F42E5F7BC3B9FEE115D7285187855A4344B4142EC56A0B9235FFB3B6BF74F9';

export interface ApkValidationResult {
  valid: boolean;
  reason?: 'APK_NOT_FOUND' | 'SHA256_MISMATCH';
  version: string;
  buildNumber: number;
  expectedSha256: string;
  foundSha256?: string;
  apkPath?: string;
  sizeBytes?: number;
}

// Cache em memória para evitar recomputar SHA-256 de arquivo grande (~85MB) a cada requisição
let apkCache: {
  filePath: string;
  size: number;
  mtimeMs: number;
  sha256: string;
} | null = null;

export function getApkValidationStatus(
  customPath?: string,
  targetExpectedHash?: string
): ApkValidationResult {
  const targetPath =
    customPath ||
    process.env.APK_STORAGE_PATH ||
    path.join(__dirname, '../../public/apk/app-release.apk');
  const expectedHash = (
    targetExpectedHash ||
    process.env.EXPECTED_APK_SHA256 ||
    EXPECTED_APK_SHA256
  )
    .toUpperCase()
    .trim();

  if (!fs.existsSync(targetPath)) {
    return {
      valid: false,
      reason: 'APK_NOT_FOUND',
      version: CURRENT_APP_VERSION,
      buildNumber: CURRENT_BUILD_NUMBER,
      expectedSha256: expectedHash,
    };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(targetPath);
  } catch {
    return {
      valid: false,
      reason: 'APK_NOT_FOUND',
      version: CURRENT_APP_VERSION,
      buildNumber: CURRENT_BUILD_NUMBER,
      expectedSha256: expectedHash,
    };
  }

  // Verifica se temos o hash em cache válido para o mesmo arquivo, tamanho e timestamp de modificação
  let fileHash: string;
  if (
    apkCache &&
    apkCache.filePath === targetPath &&
    apkCache.size === stat.size &&
    apkCache.mtimeMs === stat.mtimeMs
  ) {
    fileHash = apkCache.sha256;
  } else {
    try {
      const fileBuffer = fs.readFileSync(targetPath);
      fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex').toUpperCase();
      apkCache = {
        filePath: targetPath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        sha256: fileHash,
      };
    } catch {
      return {
        valid: false,
        reason: 'APK_NOT_FOUND',
        version: CURRENT_APP_VERSION,
        buildNumber: CURRENT_BUILD_NUMBER,
        expectedSha256: expectedHash,
      };
    }
  }

  if (fileHash !== expectedHash) {
    return {
      valid: false,
      reason: 'SHA256_MISMATCH',
      version: CURRENT_APP_VERSION,
      buildNumber: CURRENT_BUILD_NUMBER,
      expectedSha256: expectedHash,
      foundSha256: fileHash,
      apkPath: targetPath,
      sizeBytes: stat.size,
    };
  }

  return {
    valid: true,
    version: CURRENT_APP_VERSION,
    buildNumber: CURRENT_BUILD_NUMBER,
    expectedSha256: expectedHash,
    foundSha256: fileHash,
    apkPath: targetPath,
    sizeBytes: stat.size,
  };
}

// Retorna a versão mais recente do aplicativo e a URL de download SE E SOMENTE SE o APK for validado
router.get('/version', (req: Request, res: Response) => {
  const validation = getApkValidationStatus();

  const host = req.get('host') || 'selectphoto-k1ac.onrender.com';
  const protocol =
    req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';

  const downloadUrl = validation.valid ? `${protocol}://${host}/api/app/download` : '';

  res.json({
    version: CURRENT_APP_VERSION,
    buildNumber: CURRENT_BUILD_NUMBER,
    mandatory: false,
    downloadUrl,
    apkAvailable: validation.valid,
    sha256: validation.expectedSha256,
  });
});

// Download do APK se e somente se o arquivo for validado criptograficamente
router.get('/download', (req: Request, res: Response) => {
  const validation = getApkValidationStatus();

  if (!validation.valid || !validation.apkPath) {
    res.status(404).json({
      error:
        'Nenhum APK de atualização validado e autenticado para a versão 1.0.6+7 está disponível no servidor no momento.',
      reason: validation.reason,
      expectedSha256: validation.expectedSha256,
    });
    return;
  }

  res.download(validation.apkPath, `Lumora-${CURRENT_APP_VERSION}+${CURRENT_BUILD_NUMBER}.apk`);
});

export default router;
