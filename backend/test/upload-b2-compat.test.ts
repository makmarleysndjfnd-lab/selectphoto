/**
 * upload-b2-compat.test.ts
 * Testes de compatibilidade com Backblaze B2 S3-compatible.
 * Executado 100% localmente sem chamadas externas e sem credenciais reais.
 *
 * NOTA DE HOMOLOGAÇÃO:
 * Configuração de compatibilidade B2 testada localmente;
 * upload real pendente de homologação autenticada após deploy.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import {
  s3,
  createB2S3Client,
  createB2S3Storage,
  resolveB2Region,
  handleUploadError,
  UploadFileMetadata,
} from '../src/middleware/upload';

function mockResponse(): { status: (n: number) => any; json: (b: any) => any; statusCode: number; jsonBody: any } {
  const r: any = { statusCode: 200, jsonBody: null };
  r.status = (n: number) => { r.statusCode = n; return r; };
  r.json = (b: any) => { r.jsonBody = b; return r; };
  return r;
}

describe('COMPATIBILIDADE BACKBLAZE B2 — Testes Locais e Configuração S3 (1.0.5)', { concurrency: 1 }, () => {

  describe('1. Verificação de Fábrica e Configurações de Checksum do S3Client', () => {
    it('s3 padrão exportado possui requestChecksumCalculation = WHEN_REQUIRED', async () => {
      const config = s3.config;
      const reqChecksum = typeof config.requestChecksumCalculation === 'function'
        ? await config.requestChecksumCalculation()
        : config.requestChecksumCalculation;
      assert.equal(reqChecksum, 'WHEN_REQUIRED', 'requestChecksumCalculation deve ser WHEN_REQUIRED para compatibilidade com B2');
    });

    it('s3 padrão exportado possui responseChecksumValidation = WHEN_REQUIRED', async () => {
      const config = s3.config;
      const resChecksum = typeof config.responseChecksumValidation === 'function'
        ? await config.responseChecksumValidation()
        : config.responseChecksumValidation;
      assert.equal(resChecksum, 'WHEN_REQUIRED', 'responseChecksumValidation deve ser WHEN_REQUIRED para compatibilidade com B2');
    });

    it('createB2S3Client cria instância com parâmetros de compatibilidade B2', async () => {
      const customClient = createB2S3Client({
        endpoint: 'https://s3.eu-central-003.backblazeb2.com',
        credentials: { accessKeyId: 'dummyKey', secretAccessKey: 'dummySecret' },
      });
      const reqChecksum = typeof customClient.config.requestChecksumCalculation === 'function'
        ? await customClient.config.requestChecksumCalculation()
        : customClient.config.requestChecksumCalculation;
      assert.equal(reqChecksum, 'WHEN_REQUIRED');
    });
  });

  describe('2. Resolução Dinâmica de Região do B2', () => {
    it('Extrai região corretamente de endpoint no formato B2 (ex: eu-central-003)', () => {
      const region = resolveB2Region('https://s3.eu-central-003.backblazeb2.com', '');
      assert.equal(region, 'eu-central-003');
    });

    it('Extrai região corretamente de endpoint no formato B2 (ex: us-west-004)', () => {
      const region = resolveB2Region('https://s3.us-west-004.backblazeb2.com', '');
      assert.equal(region, 'us-west-004');
    });

    it('B2_REGION explícita tem precedência absoluta sobre o endpoint', () => {
      const region = resolveB2Region('https://s3.us-west-004.backblazeb2.com', 'us-east-005');
      assert.equal(region, 'us-east-005');
    });

    it('Endpoint não formatado utiliza fallback seguro conservador us-east-005', () => {
      const region = resolveB2Region('https://custom-storage.example.com', '');
      assert.equal(region, 'us-east-005');
    });
  });

  describe('3. Simulação Local de PutObject contra Servidor HTTP Controlado (Sem Internet / Sem CRC32)', () => {
    it('Requisição PutObject simulada NÃO envia header x-amz-checksum-crc32 automático', async () => {
      let interceptedHeaders: http.IncomingHttpHeaders = {};
      let interceptedMethod = '';
      let serverCalls = 0;

      // Inicia servidor HTTP local estritamente em 127.0.0.1
      const server = http.createServer((req, res) => {
        serverCalls++;
        interceptedMethod = req.method || '';
        interceptedHeaders = req.headers;

        // Responde como S3 200 OK com ETag
        res.writeHead(200, {
          'Content-Type': 'application/xml',
          'ETag': '"d41d8cd98f00b204e9800998ecf8427e"',
        });
        res.end();
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as any).port;
      const localEndpoint = `http://127.0.0.1:${port}`;

      try {
        const localClient = createB2S3Client({
          endpoint: localEndpoint,
          region: 'us-east-005',
          credentials: {
            accessKeyId: 'test-local-key-id',
            secretAccessKey: 'test-local-app-key',
          },
          forcePathStyle: true,
        });

        const command = new PutObjectCommand({
          Bucket: 'test-bucket',
          Key: 'test-company/test-file.jpg',
          Body: Buffer.from('simulated-jpeg-content-bytes'),
          ContentType: 'image/jpeg',
        });

        const response = await localClient.send(command);

        // Asserções
        assert.equal(serverCalls, 1, 'Servidor local recebeu exatamente 1 requisição');
        assert.equal(interceptedMethod, 'PUT', 'Método HTTP foi PUT');
        assert.equal(
          interceptedHeaders['x-amz-checksum-crc32'],
          undefined,
          'x-amz-checksum-crc32 NÃO deve ser enviado automaticamente (incompatível com B2)'
        );
        assert.ok(response.$metadata.httpStatusCode === 200, 'Comando S3 concluiu com sucesso');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('Storage B2 envia corpo completo com Content-Length e sem canned ACL', async () => {
      let interceptedHeaders: http.IncomingHttpHeaders = {};
      let receivedBytes = 0;
      const server = http.createServer((req, res) => {
        interceptedHeaders = req.headers;
        req.on('data', (chunk) => { receivedBytes += chunk.length; });
        req.on('end', () => {
          res.writeHead(200, {
            'Content-Type': 'application/xml',
            'ETag': '"d41d8cd98f00b204e9800998ecf8427e"',
          });
          res.end();
        });
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as any).port;

      try {
        const localClient = createB2S3Client({
          endpoint: `http://127.0.0.1:${port}`,
          region: 'us-east-005',
          credentials: {
            accessKeyId: 'test-local-key-id',
            secretAccessKey: 'test-local-app-key',
          },
          forcePathStyle: true,
        });
        const storage: any = createB2S3Storage(localClient, 'test-bucket');

        await new Promise<void>((resolve, reject) => {
          storage._handleFile(
            { user: { companyId: 'company-test' } },
            {
              fieldname: 'profilePhoto',
              originalname: 'profile.jpg',
              encoding: '7bit',
              mimetype: 'image/jpeg',
              stream: Readable.from(Buffer.from('simulated-jpeg-content-bytes')),
            },
            (error: Error | null) => error ? reject(error) : resolve()
          );
        });

        assert.equal(
          interceptedHeaders['x-amz-acl'],
          undefined,
          'storage não deve enviar x-amz-acl ao B2'
        );
        assert.equal(Number(interceptedHeaders['content-length']), receivedBytes);
        assert.equal(receivedBytes, Buffer.byteLength('simulated-jpeg-content-bytes'));
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe('4. Tratamento Seguro e Granular de Erros (handleUploadError)', () => {
    it('Sem erro: retorna false', () => {
      const res = mockResponse() as any;
      assert.equal(handleUploadError(null, res), false);
    });

    it('NotImplemented (B2 rejeição de recurso) -> 503 com supportCode', () => {
      const err = Object.assign(new Error('The requested functionality is not implemented'), {
        name: 'NotImplemented',
        code: 'NotImplemented',
        $metadata: { httpStatusCode: 501, requestId: 'req123' },
      });
      const res = mockResponse() as any;
      handleUploadError(err, res, 'corr-notimpl');
      assert.equal(res.statusCode, 503);
      assert.equal(res.jsonBody.supportCode, 'corr-notimpl');
      assert.ok(res.jsonBody.error.includes('indisponível') || res.jsonBody.error.includes('processar'));
    });

    it('InvalidArgument -> 503 com suporte', () => {
      const err = Object.assign(new Error('Invalid argument header'), {
        name: 'InvalidArgument',
      });
      const res = mockResponse() as any;
      handleUploadError(err, res, 'corr-arg');
      assert.equal(res.statusCode, 503);
    });

    it('BadDigest, ChecksumMismatch, XAmzContentSHA256Mismatch -> 503', () => {
      const errors = ['BadDigest', 'ChecksumMismatch', 'XAmzContentSHA256Mismatch'];
      for (const name of errors) {
        const err = Object.assign(new Error('checksum failure'), { name });
        const res = mockResponse() as any;
        handleUploadError(err, res, 'corr-chk');
        assert.equal(res.statusCode, 503, `${name} deve retornar 503`);
      }
    });

    it('IncompleteBody do B2 -> 503 rastreável sem expor detalhes internos', () => {
      const err = Object.assign(new Error('Request body size did not match the expected size'), {
        name: 'IncompleteBody',
        code: 'IncompleteBody',
        $metadata: { httpStatusCode: 400, requestId: 'INTERNAL_REQUEST_ID' },
      });
      const res = mockResponse() as any;
      handleUploadError(err, res, 'corr-body');
      assert.equal(res.statusCode, 503);
      assert.equal(res.jsonBody.supportCode, 'corr-body');
      assert.ok(res.jsonBody.error.includes('indisponível'));
      assert.ok(!JSON.stringify(res.jsonBody).includes('INTERNAL_REQUEST_ID'));
    });

    it('InvalidAccessKeyId (auth error) -> 503 com sanitização total de mensagem', () => {
      const err = Object.assign(new Error('The Access Key Id keyId=SUPER_SECRET_KEY does not exist'), {
        name: 'InvalidAccessKeyId',
        $metadata: { httpStatusCode: 403, requestId: 'SECRET_REQ_ID_LONG' },
      });
      const res = mockResponse() as any;
      handleUploadError(err, res, 'corr-auth');
      assert.equal(res.statusCode, 503);
      const resStr = JSON.stringify(res.jsonBody);
      assert.ok(!resStr.includes('SUPER_SECRET_KEY'), 'Chave secreta não deve vazar na resposta');
      assert.ok(!resStr.includes('SECRET_REQ_ID_LONG'), 'Request ID longo não deve vazar na resposta');
    });

    it('Erro S3 genérico com HTTP 403 -> 503 de configuração e supportCode', () => {
      const err = Object.assign(new Error('Forbidden'), {
        name: 'Unknown',
        $metadata: { httpStatusCode: 403, requestId: 'SECRET_REQ_ID_LONG' },
      });
      const res = mockResponse() as any;
      handleUploadError(err, res, 'corr-403');
      assert.equal(res.statusCode, 503);
      assert.equal(res.jsonBody.supportCode, 'corr-403');
      assert.ok(res.jsonBody.error.includes('indisponível'));
      assert.ok(!JSON.stringify(res.jsonBody).includes('SECRET_REQ_ID_LONG'));
    });

    it('ECONNREFUSED -> 503', () => {
      const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), {
        code: 'ECONNREFUSED',
      });
      const res = mockResponse() as any;
      handleUploadError(err, res, 'corr-net');
      assert.equal(res.statusCode, 503);
    });

    it('LIMIT_FILE_SIZE -> 400 com mensagem amigável de 15MB', () => {
      const { MulterError } = require('multer');
      const err = new MulterError('LIMIT_FILE_SIZE');
      const res = mockResponse() as any;
      handleUploadError(err, res);
      assert.equal(res.statusCode, 400);
      assert.ok(res.jsonBody.error.includes('15MB'));
    });

    it('Tipo de arquivo não permitido -> 400', () => {
      const err = new Error('Tipo de arquivo não permitido. Apenas imagens (JPEG, PNG, WEBP) e PDF são aceitos.');
      const res = mockResponse() as any;
      handleUploadError(err, res);
      assert.equal(res.statusCode, 400);
    });

    it('Stack trace não vaza na resposta do cliente', () => {
      const err = Object.assign(new Error('Internal unexpected exception'), {
        name: 'UnexpectedStorageBug',
        stack: 'Error: Internal\n  at upload.ts:123:45\n  at execute (/app/s3.js)',
      });
      const res = mockResponse() as any;
      handleUploadError(err, res, 'corr-stack');
      const resStr = JSON.stringify(res.jsonBody);
      assert.ok(!resStr.includes('upload.ts'), 'Stack trace não deve vazar');
      assert.ok(!resStr.includes('execute'), 'Stack trace não deve vazar');
    });

    it('Metadados do arquivo (fieldname, mimetype, sizeBytes) são aceitos e repassados ao log', () => {
      const err = Object.assign(new Error('B2 timeout'), { code: 'ETIMEDOUT' });
      const res = mockResponse() as any;
      const fileMeta: UploadFileMetadata = {
        fieldname: 'evidence',
        mimetype: 'image/jpeg',
        size: 1048576,
      };
      const handled = handleUploadError(err, res, 'corr-meta', fileMeta);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 503);
      assert.equal(res.jsonBody.supportCode, 'corr-meta');
    });
  });
});
