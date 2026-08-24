import { describe, it } from 'node:test';
import assert from 'node:assert';
import { handleUploadError, resolveB2Region } from '../src/middleware/upload';

describe('Upload Middleware & B2 Storage Resilience', () => {
  it('should resolve correct B2 region from endpoint or fallback', () => {
    assert.strictEqual(resolveB2Region('https://s3.us-east-005.backblazeb2.com'), 'us-east-005');
    assert.strictEqual(resolveB2Region('https://s3.eu-central-003.backblazeb2.com'), 'eu-central-003');
    assert.strictEqual(resolveB2Region(undefined, 'us-west-004'), 'us-west-004');
    assert.strictEqual(resolveB2Region('https://custom-s3-endpoint.com'), 'us-east-005');
  });

  it('should return 503 with supportCode and controlled message when B2 is not configured in production', () => {
    let capturedStatus: number | null = null;
    let capturedJson: any = null;

    const mockRes: any = {
      status(code: number) {
        capturedStatus = code;
        return this;
      },
      json(body: any) {
        capturedJson = body;
        return this;
      },
    };

    const err: any = new Error('Armazenamento em nuvem B2 não configurado no ambiente de produção.');
    err.code = 'B2_NOT_CONFIGURED';

    const handled = handleUploadError(err, mockRes, 'test-corr-123');

    assert.strictEqual(handled, true);
    assert.strictEqual(capturedStatus, 503);
    assert.strictEqual(capturedJson.supportCode, 'test-corr-123');
    assert.strictEqual(capturedJson.error.includes('temporariamente indisponível'), true);
  });

  it('should return 400 for business/MIME/file type validation errors', () => {
    let capturedStatus: number | null = null;
    let capturedJson: any = null;

    const mockRes: any = {
      status(code: number) {
        capturedStatus = code;
        return this;
      },
      json(body: any) {
        capturedJson = body;
        return this;
      },
    };

    const err = new Error('Tipo de arquivo não permitido. Apenas imagens (JPEG, PNG, WEBP) e PDF são aceitos.');
    const handled = handleUploadError(err, mockRes, 'test-corr-456');

    assert.strictEqual(handled, true);
    assert.strictEqual(capturedStatus, 400);
    assert.strictEqual(capturedJson.error.includes('Tipo de arquivo não permitido'), true);
  });

  it('should return 503 with supportCode for S3/B2 network or storage errors without leaking secrets', () => {
    let capturedStatus: number | null = null;
    let capturedJson: any = null;

    const mockRes: any = {
      status(code: number) {
        capturedStatus = code;
        return this;
      },
      json(body: any) {
        capturedJson = body;
        return this;
      },
    };

    const err: any = new Error('getaddrinfo ENOTFOUND s3.us-east-005.backblazeb2.com keyId=K283921 secret=supersecret');
    err.name = 'NetworkingError';
    err.code = 'ENOTFOUND';

    const handled = handleUploadError(err, mockRes, 'b2-net-999');

    assert.strictEqual(handled, true);
    assert.strictEqual(capturedStatus, 503);
    assert.strictEqual(capturedJson.supportCode, 'b2-net-999');
    assert.strictEqual(capturedJson.error.includes('supersecret'), false);
  });
});
