import { describe, it, before, after } from 'node:test';
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
} from '../src/routes/app';

describe('VALscore & CRIPTOGRAFIA DO APK — Endpoint de Atualização e Download (1.0.6+7)', () => {
  const tmpDir = path.join(__dirname, 'tmp_apk_test_' + Date.now());
  let server: http.Server;
  let baseUrl: string;
  const originalStorageEnv = process.env.APK_STORAGE_PATH;
  const originalShaEnv = process.env.EXPECTED_APK_SHA256;

  before(async () => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const app = express();
    app.use('/api/app', appRoutes);

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}/api/app`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    process.env.APK_STORAGE_PATH = originalStorageEnv;
    process.env.EXPECTED_APK_SHA256 = originalShaEnv;
  });

  function makeRequest(urlPath: string): Promise<{ status: number; body: any; headers: any }> {
    return new Promise((resolve, reject) => {
      http.get(`${baseUrl}${urlPath}`, (res) => {
        let rawData = '';
        res.on('data', (chunk) => (rawData += chunk));
        res.on('end', () => {
          let body = rawData;
          try {
            body = JSON.parse(rawData);
          } catch {}
          resolve({ status: res.statusCode || 0, body, headers: res.headers });
        });
      }).on('error', reject);
    });
  }

  it('1. Arquivo ausente: getApkValidationStatus retorna valid: false com reason APK_NOT_FOUND', () => {
    const fakePath = path.join(tmpDir, 'inexistente.apk');
    const result = getApkValidationStatus(fakePath);

    assert.equal(result.valid, false);
    assert.equal(result.reason, 'APK_NOT_FOUND');
    assert.equal(result.version, CURRENT_APP_VERSION);
    assert.equal(result.buildNumber, CURRENT_BUILD_NUMBER);
    assert.equal(result.expectedSha256, EXPECTED_APK_SHA256);
  });

  it('2. Arquivo ausente: /version retorna apkAvailable: false e downloadUrl vazio', async () => {
    process.env.APK_STORAGE_PATH = path.join(tmpDir, 'inexistente.apk');

    const res = await makeRequest('/version');
    assert.equal(res.status, 200);
    assert.equal(res.body.version, '1.0.6');
    assert.equal(res.body.buildNumber, 7);
    assert.equal(res.body.apkAvailable, false);
    assert.equal(res.body.downloadUrl, '');
  });

  it('3. Arquivo ausente: /download retorna 404 controlado', async () => {
    process.env.APK_STORAGE_PATH = path.join(tmpDir, 'inexistente.apk');

    const res = await makeRequest('/download');
    assert.equal(res.status, 404);
    assert.equal(res.body.reason, 'APK_NOT_FOUND');
  });

  it('4. Arquivo antigo / Hash divergente: getApkValidationStatus retorna SHA256_MISMATCH', () => {
    const oldApkPath = path.join(tmpDir, 'old-app-release.apk');
    const oldContent = Buffer.from('CONTEUDO_DO_APK_ANTIGO_LEGADO_VERSAO_1.0.5');
    fs.writeFileSync(oldApkPath, oldContent);

    const oldHash = crypto.createHash('sha256').update(oldContent).digest('hex').toUpperCase();

    const result = getApkValidationStatus(oldApkPath);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'SHA256_MISMATCH');
    assert.equal(result.foundSha256, oldHash);
    assert.notEqual(result.foundSha256, EXPECTED_APK_SHA256);
  });

  it('5. APK antigo em disco: /version NÃO declara apkAvailable e /download bloqueia com 404', async () => {
    const oldApkPath = path.join(tmpDir, 'old-app-release.apk');
    process.env.APK_STORAGE_PATH = oldApkPath;

    const versionRes = await makeRequest('/version');
    assert.equal(versionRes.status, 200);
    assert.equal(versionRes.body.apkAvailable, false);
    assert.equal(versionRes.body.downloadUrl, '');

    const downloadRes = await makeRequest('/download');
    assert.equal(downloadRes.status, 404);
    assert.equal(downloadRes.body.reason, 'SHA256_MISMATCH');
  });

  it('6. APK com hash correto: getApkValidationStatus retorna valid: true', () => {
    const dummyApkContent = Buffer.from('CONTEUDO_MOCKADO_PARA_TESTE_DE_HASH_ESPECIFICO');
    const dummyHash = crypto.createHash('sha256').update(dummyApkContent).digest('hex').toUpperCase();
    const validMockPath = path.join(tmpDir, 'mock-valid-release.apk');
    fs.writeFileSync(validMockPath, dummyApkContent);

    const result = getApkValidationStatus(validMockPath, dummyHash);
    assert.equal(result.valid, true);
    assert.equal(result.foundSha256, dummyHash);
    assert.equal(result.apkPath, validMockPath);
  });

  it('7. APK com hash correto: /version retorna apkAvailable: true e downloadUrl ativo', async () => {
    const dummyApkContent = Buffer.from('CONTEUDO_MOCKADO_PARA_TESTE_DE_HASH_ESPECIFICO_2');
    const dummyHash = crypto.createHash('sha256').update(dummyApkContent).digest('hex').toUpperCase();
    const validMockPath = path.join(tmpDir, 'mock-valid-release-2.apk');
    fs.writeFileSync(validMockPath, dummyApkContent);

    process.env.APK_STORAGE_PATH = validMockPath;
    process.env.EXPECTED_APK_SHA256 = dummyHash;

    const versionRes = await makeRequest('/version');
    assert.equal(versionRes.status, 200);
    assert.equal(versionRes.body.apkAvailable, true);
    assert.ok(versionRes.body.downloadUrl.includes('/api/app/download'));

    const downloadRes = await makeRequest('/download');
    assert.equal(downloadRes.status, 200);
    assert.equal(downloadRes.body, dummyApkContent.toString());
  });

  it('8. APK real 1.0.6+7: Hash esperado é exatamente B6F42E5F7BC3B9FEE115D7285187855A4344B4142EC56A0B9235FFB3B6BF74F9', () => {
    assert.equal(
      EXPECTED_APK_SHA256,
      'B6F42E5F7BC3B9FEE115D7285187855A4344B4142EC56A0B9235FFB3B6BF74F9'
    );
  });
});
