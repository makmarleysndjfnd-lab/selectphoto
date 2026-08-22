import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express, { Response } from 'express';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import multer from 'multer';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { handleUploadError, safeUpload } from '../src/middleware/upload';

const envPath = path.resolve(__dirname, '../.env.test.local');
const envConfig = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {};
const jwtSecret = envConfig.JWT_SECRET || 'test_jwt_secret_safe_upload';

process.env.DATABASE_URL = envConfig.DATABASE_URL || 'postgresql://mock:mock@localhost:5432/mock';
process.env.JWT_SECRET = jwtSecret;
process.env.DISABLE_CRON = 'true';
process.env.EXTERNAL_SERVICES_DISABLED = 'true';
process.env.NODE_ENV = 'test';

import usersRoutes from '../src/routes/users';
import salesRoutes from '../src/routes/sales';
import fleetRoutes from '../src/routes/fleet';
import uploadRoutes from '../src/routes/upload';

const prisma = new PrismaClient();

function generateToken(payload: { id: string; role: string; companyId?: string; name?: string }) {
  return jwt.sign(payload, jwtSecret, { expiresIn: '1h' });
}

describe('Middleware safeUpload e Granularidade de Erros de Armazenamento', { concurrency: 1 }, () => {
  const uid = 'safe_upload_' + Date.now();
  const companyId = `comp_${uid}`;
  const adminId = `admin_${uid}`;
  let token: string;
  let server: any;
  let baseUrl: string;

  before(async () => {
    // 1. Criar empresa e usuário no banco de testes
    await prisma.company.create({
      data: { id: companyId, name: 'Safe Upload Company', isActive: true },
    });

    const hashedPassword = await bcrypt.hash('Senha123!', 10);
    await prisma.user.create({
      data: {
        id: adminId,
        name: 'Admin Safe Upload',
        role: 'ADMIN',
        companyId: companyId,
        cpf: `910${Date.now().toString().slice(-8)}`,
        password: hashedPassword,
        active: true,
      },
    });

    token = generateToken({ id: adminId, role: 'ADMIN', companyId: companyId, name: 'Admin Safe Upload' });

    // 2. Inicializar servidor de teste
    const testApp = express();
    testApp.use(express.json());

    testApp.post('/test/simulated-upload/:errorType', (req, res, next) => {
      const { errorType } = req.params;
      const fakeMulter = (r: any, s: any, cb: (err?: any) => void) => {
        if (errorType === 'file_too_large') {
          return cb(new multer.MulterError('LIMIT_FILE_SIZE'));
        }
        if (errorType === 'invalid_mime') {
          return cb(new Error('Tipo de arquivo não permitido. Apenas imagens (JPEG, PNG, WEBP) e PDF são aceitos.'));
        }
        if (errorType === 'invalid_key') {
          const err = new Error('Invalid Access Key');
          err.name = 'InvalidAccessKeyId';
          return cb(err);
        }
        if (errorType === 'network_timeout') {
          const err: any = new Error('Socket timed out');
          err.code = 'ETIMEDOUT';
          return cb(err);
        }
        cb();
      };

      safeUpload(fakeMulter)(req, res, next);
    }, (req, res) => {
      res.json({ success: true });
    });

    testApp.use('/api/users', usersRoutes);
    testApp.use('/api/sales', salesRoutes);
    testApp.use('/api/fleet', fleetRoutes);
    testApp.use('/api/upload', uploadRoutes);

    await new Promise<void>((resolve) => {
      server = testApp.listen(0, '127.0.0.1', () => {
        const address: any = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    try {
      await prisma.user.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    } catch (_) {}
    await prisma.$disconnect();
  });

  describe('1. Mapeamento Direto de Erros em handleUploadError', () => {
    function mockResponse() {
      const res: any = {
        statusCode: 200,
        body: null,
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(data: any) {
          this.body = data;
          return this;
        },
      };
      return res;
    }

    it('deve retornar HTTP 400 para erro de limite de tamanho do Multer', () => {
      const res = mockResponse();
      const err = new multer.MulterError('LIMIT_FILE_SIZE');
      const handled = handleUploadError(err, res as unknown as Response);

      assert.equal(handled, true);
      assert.equal(res.statusCode, 400);
      assert.match(res.body.error, /15MB/i);
    });

    it('deve retornar HTTP 400 para erro de tipo de arquivo não permitido', () => {
      const res = mockResponse();
      const err = new Error('Tipo de arquivo não permitido. Apenas imagens (JPEG, PNG, WEBP) e PDF são aceitos.');
      const handled = handleUploadError(err, res as unknown as Response);

      assert.equal(handled, true);
      assert.equal(res.statusCode, 400);
      assert.match(res.body.error, /não permitido/i);
    });

    it('deve retornar HTTP 503 para InvalidAccessKeyId do B2 sem vazar chaves', () => {
      const res = mockResponse();
      const err = new Error('The AWS Access Key Id you provided does not exist in our records.');
      err.name = 'InvalidAccessKeyId';
      const handled = handleUploadError(err, res as unknown as Response);

      assert.equal(handled, true);
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.error, 'Armazenamento temporariamente indisponível. Tente novamente mais tarde.');
    });

    it('deve retornar HTTP 503 para SignatureDoesNotMatch do B2', () => {
      const res = mockResponse();
      const err = new Error('The request signature we calculated does not match the signature you provided.');
      err.name = 'SignatureDoesNotMatch';
      const handled = handleUploadError(err, res as unknown as Response);

      assert.equal(handled, true);
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.error, 'Armazenamento temporariamente indisponível. Tente novamente mais tarde.');
    });

    it('deve retornar HTTP 503 para AccessDenied do B2', () => {
      const res = mockResponse();
      const err = new Error('Access Denied');
      err.name = 'AccessDenied';
      const handled = handleUploadError(err, res as unknown as Response);

      assert.equal(handled, true);
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.error, 'Armazenamento temporariamente indisponível. Tente novamente mais tarde.');
    });

    it('deve retornar HTTP 503 para NoSuchBucket do B2', () => {
      const res = mockResponse();
      const err = new Error('The specified bucket does not exist');
      err.name = 'NoSuchBucket';
      const handled = handleUploadError(err, res as unknown as Response);

      assert.equal(handled, true);
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.error, 'Armazenamento temporariamente indisponível. Tente novamente mais tarde.');
    });

    it('deve retornar HTTP 503 para falhas de rede (ECONNRESET, ECONNREFUSED, Timeout)', () => {
      for (const code of ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT']) {
        const res = mockResponse();
        const err: any = new Error(`Network failure with code ${code}`);
        err.code = code;
        const handled = handleUploadError(err, res as unknown as Response);

        assert.equal(handled, true, `Falhou para código ${code}`);
        assert.equal(res.statusCode, 503);
        assert.equal(res.body.error, 'Armazenamento temporariamente indisponível. Tente novamente mais tarde.');
      }
    });

    it('deve retornar HTTP 503 amigável para erro desconhecido sem expor stack trace', () => {
      const res = mockResponse();
      const err = new Error('Internal driver critical stack trace leak 0x99482');
      const handled = handleUploadError(err, res as unknown as Response);

      assert.equal(handled, true);
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.error, 'Não foi possível processar o envio do arquivo. Tente novamente mais tarde.');
      assert.equal(res.body.stack, undefined);
    });
  });

  describe('2. Testes de Integração com Middleware safeUpload nas Rotas', () => {
    it('Rota /test/simulated-upload retorna 400 para arquivo grande', async () => {
      const res = await fetch(`${baseUrl}/test/simulated-upload/file_too_large`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.equal(res.status, 400);
      const data: any = await res.json();
      assert.match(data.error, /15MB/i);
    });

    it('Rota /test/simulated-upload retorna 400 para formato inválido', async () => {
      const res = await fetch(`${baseUrl}/test/simulated-upload/invalid_mime`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.equal(res.status, 400);
      const data: any = await res.json();
      assert.match(data.error, /não permitido/i);
    });

    it('Rota /test/simulated-upload retorna 503 para InvalidAccessKeyId sem vazar segredos', async () => {
      const res = await fetch(`${baseUrl}/test/simulated-upload/invalid_key`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.equal(res.status, 503);
      const data: any = await res.json();
      assert.equal(data.error, 'Armazenamento temporariamente indisponível. Tente novamente mais tarde.');
    });

    it('Rota /test/simulated-upload retorna 503 para ETIMEDOUT de rede', async () => {
      const res = await fetch(`${baseUrl}/test/simulated-upload/network_timeout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.equal(res.status, 503);
      const data: any = await res.json();
      assert.equal(data.error, 'Armazenamento temporariamente indisponível. Tente novamente mais tarde.');
    });

    it('Rota genérica /api/upload sem arquivo retorna 400', async () => {
      const res = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data: any = await res.json();
      assert.equal(res.status, 400, `Expected 400 got ${res.status}: ${JSON.stringify(data)}`);
      assert.match(data.error, /Nenhum arquivo enviado/i);
    });

    it('Rota /api/sales/:id/receipt sem arquivo retorna 400', async () => {
      const res = await fetch(`${baseUrl}/api/sales/sale_123/receipt`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data: any = await res.json();
      assert.equal(res.status, 400, `Expected 400 got ${res.status}: ${JSON.stringify(data)}`);
      assert.match(data.error, /Receipt photo is required/i);
    });
  });
});
