import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { recordDeviceTelemetry } from '../services/operationalMetricsService';

export const CURRENT_APP_VERSION = '1.0.24';
export const CURRENT_BUILD_NUMBER = 35;

export interface ApkReleaseDescriptor {
  version: string;
  buildNumber: number;
  sha256: string;
  packageName: string;
}

/**
 * Manifesto imutável do APK auditado antes da publicação.
 *
 * O binário não fica no Git. A versão, o build e o hash abaixo vinculam o
 * endpoint exclusivamente ao artefato que passou pela auditoria do manifesto.
 */
export const RELEASE_APK: Readonly<ApkReleaseDescriptor> = Object.freeze({
  version: '1.0.24',
  buildNumber: 35,
  sha256: '3B12CF88584889515CF6489A1FACFE72098BE296A2F5E6DBF12102BD608EEA54',
  packageName: 'com.example.mobile',
});

export const EXPECTED_APK_SHA256 = RELEASE_APK.sha256;
export const PUBLIC_APP_BASE_URL = 'https://selectphoto-k1ac.onrender.com';

export type ApkValidationFailureReason =
  | 'APK_NOT_FOUND'
  | 'RELEASE_METADATA_MISMATCH'
  | 'INVALID_EXPECTED_SHA256'
  | 'SHA256_MISMATCH';

export interface ApkValidationResult {
  valid: boolean;
  reason?: ApkValidationFailureReason;
  version: string;
  buildNumber: number;
  packageName: string;
  expectedSha256: string;
  foundSha256?: string;
  apkPath?: string;
  sizeBytes?: number;
}

let apkCache: {
  filePath: string;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  sha256: string;
} | null = null;

function resultFromDescriptor(
  descriptor: Readonly<ApkReleaseDescriptor>,
  partial: Partial<ApkValidationResult>
): ApkValidationResult {
  return {
    valid: false,
    version: descriptor.version,
    buildNumber: descriptor.buildNumber,
    packageName: descriptor.packageName,
    expectedSha256: descriptor.sha256.toUpperCase().trim(),
    ...partial,
  };
}

async function calculateFileSha256(targetPath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(targetPath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex').toUpperCase()));
  });
}

export async function getApkValidationStatus(
  customPath?: string,
  descriptor: Readonly<ApkReleaseDescriptor> = RELEASE_APK
): Promise<ApkValidationResult> {
  const targetPath =
    customPath ||
    process.env.APK_STORAGE_PATH ||
    path.join(__dirname, '../../public/apk/app-release.apk');
  const expectedHash = descriptor.sha256.toUpperCase().trim();

  if (
    descriptor.version !== CURRENT_APP_VERSION ||
    descriptor.buildNumber !== CURRENT_BUILD_NUMBER ||
    descriptor.packageName !== RELEASE_APK.packageName
  ) {
    return resultFromDescriptor(descriptor, {
      reason: 'RELEASE_METADATA_MISMATCH',
    });
  }

  if (!/^[A-F0-9]{64}$/.test(expectedHash)) {
    return resultFromDescriptor(descriptor, {
      reason: 'INVALID_EXPECTED_SHA256',
    });
  }

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(targetPath);
    if (!stat.isFile()) {
      throw new Error('APK path is not a file');
    }
  } catch {
    return resultFromDescriptor(descriptor, {
      reason: 'APK_NOT_FOUND',
    });
  }

  let fileHash: string;
  if (
    apkCache &&
    apkCache.filePath === targetPath &&
    apkCache.size === stat.size &&
    apkCache.mtimeMs === stat.mtimeMs &&
    apkCache.ctimeMs === stat.ctimeMs
  ) {
    fileHash = apkCache.sha256;
  } else {
    try {
      fileHash = await calculateFileSha256(targetPath);
      apkCache = {
        filePath: targetPath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs,
        sha256: fileHash,
      };
    } catch {
      return resultFromDescriptor(descriptor, {
        reason: 'APK_NOT_FOUND',
      });
    }
  }

  if (fileHash !== expectedHash) {
    return resultFromDescriptor(descriptor, {
      reason: 'SHA256_MISMATCH',
      foundSha256: fileHash,
      apkPath: targetPath,
      sizeBytes: stat.size,
    });
  }

  return resultFromDescriptor(descriptor, {
    valid: true,
    foundSha256: fileHash,
    apkPath: targetPath,
    sizeBytes: stat.size,
  });
}

export interface AppRouterOptions {
  apkPath?: string;
  release?: Readonly<ApkReleaseDescriptor>;
  publicBaseUrl?: string;
}

export function createAppRouter(options: AppRouterOptions = {}): Router {
  const appRouter = Router();
  const descriptor = options.release || RELEASE_APK;
  const publicBaseUrl = options.publicBaseUrl || PUBLIC_APP_BASE_URL;

  appRouter.get('/version', async (_req: Request, res: Response) => {
    const validation = await getApkValidationStatus(options.apkPath, descriptor);

    res.json({
      version: CURRENT_APP_VERSION,
      buildNumber: CURRENT_BUILD_NUMBER,
      mandatory: false,
      downloadUrl: validation.valid ? `${publicBaseUrl}/api/app/download` : '',
      apkAvailable: validation.valid,
      sha256: validation.expectedSha256,
    });
  });

  appRouter.get('/download', async (_req: Request, res: Response) => {
    const validation = await getApkValidationStatus(options.apkPath, descriptor);

    if (!validation.valid || !validation.apkPath) {
      res.status(404).json({
        error:
          `Nenhum APK de atualização validado para a versão ${CURRENT_APP_VERSION}+${CURRENT_BUILD_NUMBER} está disponível no servidor no momento.`,
        reason: validation.reason,
        expectedSha256: validation.expectedSha256,
      });
      return;
    }

    res.download(validation.apkPath, `Lumora-${CURRENT_APP_VERSION}+${CURRENT_BUILD_NUMBER}.apk`);
  });

  appRouter.post('/telemetry', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const user = req.user;
      if (!user || !user.id) {
        res.status(401).json({ error: 'Usuário não autenticado.' });
        return;
      }
      if (!user.companyId) {
        res.status(400).json({ error: 'Usuário sem empresa vinculada.' });
        return;
      }

      const {
        deviceId,
        platform,
        appVersion,
        buildNumber,
        pendingOfflineCount,
        pendingSummary,
        connectivityStatus,
        lastSyncAttemptAt,
      } = req.body;

      const record = await recordDeviceTelemetry({
        userId: user.id,
        companyId: user.companyId,
        deviceId,
        platform,
        appVersion: appVersion || CURRENT_APP_VERSION,
        buildNumber: buildNumber ? Number(buildNumber) : CURRENT_BUILD_NUMBER,
        pendingOfflineCount: pendingOfflineCount !== undefined ? Number(pendingOfflineCount) : 0,
        pendingSummary,
        connectivityStatus,
        lastSyncAttemptAt: lastSyncAttemptAt ? new Date(lastSyncAttemptAt) : undefined,
      });

      res.status(201).json({
        success: true,
        telemetryId: record.id,
        lastReportedAt: record.lastReportedAt,
      });
    } catch (err: any) {
      console.error('Erro ao registrar telemetria do aparelho:', err);
      res.status(500).json({ error: err.message || 'Erro ao registrar telemetria.' });
    }
  });

  return appRouter;
}

const router = createAppRouter();

export default router;
