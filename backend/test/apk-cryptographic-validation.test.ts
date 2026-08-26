import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import express from 'express';
import http from 'http';
import appRoutes, {
  getApkValidationStatus,
  CURRENT_APP_VERSION,
  CURRENT_BUILD_NUMBER,
  EXPECTED_APK_SHA256,
  PUBLIC_APP_BASE_URL,
  RELEASE_APK,
  ApkReleaseDescriptor,
  createAppRouter,
} from '../src/routes/app';

describe('VALIDAÇÃO DO APK — Endpoint de atualização e download (1.0.7+8)', { concurrency: 1 }, () => {
  const tmpDir = path.join(__dirname, `tmp_apk_test_${Date.now()}`);
  let server: http.Server;
  let baseUrl: string;
  const originalStorageEnv = process.env.APK_STORAGE_PATH;

  before(async () => {
    await fs.promises.mkdir(tmpDir, { recursive: true });

    const app = express();
    app.use('/api/app', appRoutes);

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}/api/app`;
        resolve();
      });
    });
  });

  afterEach(() => {
    if (originalStorageEnv === undefined) {
      delete process.env.APK_STORAGE_PATH;
    } else {
      process.env.APK_STORAGE_PATH = originalStorageEnv;
    }
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  function sha256(content: Buffer): string {
    return crypto.createHash('sha256').update(content).digest('hex').toUpperCase();
  }

  function descriptorFor(content: Buffer): ApkReleaseDescriptor {
    return {
      ...RELEASE_APK,
      sha256: sha256(content),
    };
  }

  function makeRequest(
    urlPath: string,
    targetBaseUrl = baseUrl
  ): Promise<{ status: number; body: unknown; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
      http
        .get(`${targetBaseUrl}${urlPath}`, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          res.on('end', () => {
            const rawData = Buffer.concat(chunks);
            let body: unknown = rawData;
            try {
              body = JSON.parse(rawData.toString('utf8'));
            } catch {
              // Download válido permanece como Buffer.
            }
            resolve({ status: res.statusCode || 0, body, headers: res.headers });
          });
        })
        .on('error', reject);
    });
  }

  it('1. Arquivo ausente: validação falha com APK_NOT_FOUND', async () => {
    const result = await getApkValidationStatus(path.join(tmpDir, 'inexistente.apk'));

    assert.equal(result.valid, false);
    assert.equal(result.reason, 'APK_NOT_FOUND');
    assert.equal(result.version, CURRENT_APP_VERSION);
    assert.equal(result.buildNumber, CURRENT_BUILD_NUMBER);
    assert.equal(result.expectedSha256, EXPECTED_APK_SHA256);
  });

  it('2. Arquivo ausente: /version não anuncia e /download bloqueia', async () => {
    process.env.APK_STORAGE_PATH = path.join(tmpDir, 'inexistente.apk');

    const versionRes = await makeRequest('/version');
    assert.equal(versionRes.status, 200);
    assert.deepEqual(versionRes.body, {
      version: '1.0.7',
      buildNumber: 8,
      mandatory: false,
      downloadUrl: '',
      apkAvailable: false,
      sha256: EXPECTED_APK_SHA256,
    });

    const downloadRes = await makeRequest('/download');
    assert.equal(downloadRes.status, 404);
    assert.equal((downloadRes.body as { reason: string }).reason, 'APK_NOT_FOUND');
  });

  it('3. APK antigo ou com hash incorreto não é aceito', async () => {
    const oldApkPath = path.join(tmpDir, 'old-app-release.apk');
    const oldContent = Buffer.from('CONTEUDO_DO_APK_ANTIGO_LEGADO_VERSAO_1.0.5');
    await fs.promises.writeFile(oldApkPath, oldContent);

    const result = await getApkValidationStatus(oldApkPath);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'SHA256_MISMATCH');
    assert.equal(result.foundSha256, sha256(oldContent));
    assert.notEqual(result.foundSha256, EXPECTED_APK_SHA256);
  });

  it('4. Versão divergente do release atual é rejeitada antes do hash', async () => {
    const content = Buffer.from('APK_COM_VERSAO_DIVERGENTE');
    const apkPath = path.join(tmpDir, 'wrong-version.apk');
    await fs.promises.writeFile(apkPath, content);

    const result = await getApkValidationStatus(apkPath, {
      ...descriptorFor(content),
      version: '1.0.5',
    });

    assert.equal(result.valid, false);
    assert.equal(result.reason, 'RELEASE_METADATA_MISMATCH');
  });

  it('5. Build divergente do release atual é rejeitado antes do hash', async () => {
    const content = Buffer.from('APK_COM_BUILD_DIVERGENTE');
    const apkPath = path.join(tmpDir, 'wrong-build.apk');
    await fs.promises.writeFile(apkPath, content);

    const result = await getApkValidationStatus(apkPath, {
      ...descriptorFor(content),
      buildNumber: 6,
    });

    assert.equal(result.valid, false);
    assert.equal(result.reason, 'RELEASE_METADATA_MISMATCH');
  });

  it('6. Hash esperado inválido é rejeitado', async () => {
    const content = Buffer.from('APK_COM_HASH_ESPERADO_INVALIDO');
    const apkPath = path.join(tmpDir, 'invalid-expected-hash.apk');
    await fs.promises.writeFile(apkPath, content);

    const result = await getApkValidationStatus(apkPath, {
      ...RELEASE_APK,
      sha256: 'HASH_INVALIDO',
    });

    assert.equal(result.valid, false);
    assert.equal(result.reason, 'INVALID_EXPECTED_SHA256');
  });

  it('7. Arquivo vinculado a versão, build, pacote e hash corretos é aceito', async () => {
    const content = Buffer.from('CONTEUDO_MOCKADO_DO_ARTEFATO_AUDITADO');
    const validPath = path.join(tmpDir, 'validated-release.apk');
    await fs.promises.writeFile(validPath, content);

    const result = await getApkValidationStatus(validPath, descriptorFor(content));
    assert.equal(result.valid, true);
    assert.equal(result.version, '1.0.7');
    assert.equal(result.buildNumber, 8);
    assert.equal(result.packageName, 'com.example.mobile');
    assert.equal(result.foundSha256, sha256(content));
  });

  it('8. APK correto é anunciado e servido pelo endpoint protegido', async () => {
    const content = Buffer.from('CONTEUDO_MOCKADO_SERVIDO_PELO_ENDPOINT_VALIDADO');
    const validPath = path.join(tmpDir, 'endpoint-valid-release.apk');
    await fs.promises.writeFile(validPath, content);

    const isolatedApp = express();
    isolatedApp.use(
      '/api/app',
      createAppRouter({
        apkPath: validPath,
        release: descriptorFor(content),
        publicBaseUrl: PUBLIC_APP_BASE_URL,
      })
    );
    const isolatedServer = await new Promise<http.Server>((resolve) => {
      const startedServer = isolatedApp.listen(0, '127.0.0.1', () => resolve(startedServer));
    });

    try {
      const addr = isolatedServer.address() as { port: number };
      const isolatedBaseUrl = `http://127.0.0.1:${addr.port}/api/app`;
      const versionRes = await makeRequest('/version', isolatedBaseUrl);
      const versionBody = versionRes.body as {
        apkAvailable: boolean;
        downloadUrl: string;
        sha256: string;
      };
      assert.equal(versionBody.apkAvailable, true);
      assert.equal(versionBody.downloadUrl, `${PUBLIC_APP_BASE_URL}/api/app/download`);
      assert.equal(versionBody.sha256, sha256(content));

      const downloadRes = await makeRequest('/download', isolatedBaseUrl);
      assert.equal(downloadRes.status, 200);
      assert.deepEqual(downloadRes.body, content);
    } finally {
      await new Promise<void>((resolve) => isolatedServer.close(() => resolve()));
    }
  });

  it('9. APK antigo em disco não é anunciado nem servido', async () => {
    const oldApkPath = path.join(tmpDir, 'old-server-app-release.apk');
    await fs.promises.writeFile(oldApkPath, Buffer.from('APK_ANTIGO_NO_SERVIDOR'));
    process.env.APK_STORAGE_PATH = oldApkPath;

    const versionRes = await makeRequest('/version');
    const versionBody = versionRes.body as { apkAvailable: boolean; downloadUrl: string };
    assert.equal(versionBody.apkAvailable, false);
    assert.equal(versionBody.downloadUrl, '');

    const downloadRes = await makeRequest('/download');
    assert.equal(downloadRes.status, 404);
    assert.equal((downloadRes.body as { reason: string }).reason, 'SHA256_MISMATCH');
  });

  it('10. Manifesto confiável da release possui versão, build, pacote e hash auditados', () => {
    assert.deepEqual(RELEASE_APK, {
      version: '1.0.7',
      buildNumber: 8,
      sha256: '76F14CE55A5470CED18491866175F84DC9FC5F48429C3E0197E32198B552B60A',
      packageName: 'com.example.mobile',
    });
  });

  it('11. URL de download publicada é canônica e não depende do Host recebido', () => {
    assert.equal(PUBLIC_APP_BASE_URL, 'https://selectphoto-k1ac.onrender.com');
  });
});
