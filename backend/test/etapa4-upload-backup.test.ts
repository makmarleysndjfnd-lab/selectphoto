import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const envPath = path.resolve(__dirname, '../.env.test.local');
const envConfig = dotenv.parse(fs.readFileSync(envPath));
const databaseUrl = envConfig.DATABASE_URL;
const jwtSecret = envConfig.JWT_SECRET || 'test_secret_etapa4_upload_backup';

process.env.DATABASE_URL = databaseUrl;
process.env.JWT_SECRET = jwtSecret;
process.env.DISABLE_CRON = 'true';
process.env.EXTERNAL_SERVICES_DISABLED = 'true';
process.env.NODE_ENV = 'test';

import uploadRoutes from '../src/routes/upload';
import backupRoutes from '../src/routes/backup';
import { generateBackupJson } from '../src/services/backupService';
import { assertStagingSafety } from '../scripts/safety-lock';

const prisma = new PrismaClient();

function generateToken(payload: { id: string; role: string; companyId?: string; name?: string }) {
  return jwt.sign(payload, jwtSecret, { expiresIn: '1h' });
}

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/upload', uploadRoutes);
  app.use('/api/backup', backupRoutes);
  return app;
}

describe('ETAPA 4 — Testes de Upload Seguro, Backup Multi-Tenant e Travas de Staging', { concurrency: 1 }, () => {
  const app = createTestApp();
  let server: any;
  let baseUrl: string;

  const uid = 'etapa4_' + Date.now();
  const compA_Id = `comp_a_${uid}`;
  const compB_Id = `comp_b_${uid}`;

  let adminA_Id: string;
  let sellerA_Id: string;
  let superAdminId: string;

  let tokenAdminA: string;
  let tokenAdminB: string;
  let tokenSellerA: string;
  let tokenSuperAdmin: string;

  before(async () => {
    // 1. Criar empresas
    await prisma.company.create({
      data: { id: compA_Id, name: 'Upload Comp A', isActive: true },
    });
    await prisma.company.create({
      data: { id: compB_Id, name: 'Upload Comp B', isActive: true },
    });

    const hashedPassword = await bcrypt.hash('Senha123!', 10);

    // 2. Criar Usuários
    const adminA = await prisma.user.create({
      data: {
        id: `admin_a_${uid}`,
        name: 'Admin A',
        role: 'ADMIN',
        companyId: compA_Id,
        cpf: `410${Date.now().toString().slice(-8)}`,
        password: hashedPassword,
        active: true,
      },
    });
    adminA_Id = adminA.id;

    const sellerA = await prisma.user.create({
      data: {
        id: `seller_a_${uid}`,
        name: 'Seller A',
        role: 'SELLER',
        companyId: compA_Id,
        cpf: `420${Date.now().toString().slice(-8)}`,
        password: hashedPassword,
        active: true,
      },
    });
    sellerA_Id = sellerA.id;

    const adminB = await prisma.user.create({
      data: {
        id: `admin_b_${uid}`,
        name: 'Admin B',
        role: 'ADMIN',
        companyId: compB_Id,
        cpf: `425${Date.now().toString().slice(-8)}`,
        password: hashedPassword,
        active: true,
      },
    });

    const superAdmin = await prisma.user.create({
      data: {
        id: `super_${uid}`,
        name: 'Super Admin',
        role: 'SUPER_ADMIN',
        cpf: `430${Date.now().toString().slice(-8)}`,
        password: hashedPassword,
        active: true,
      },
    });
    superAdminId = superAdmin.id;

    // 3. Criar Cliente e registros filhos da Empresa A
    const clientA = await prisma.client.create({
      data: {
        id: `cl_a_${uid}`,
        name: 'Cliente Backup A',
        sequenceNumber: `SEQ-400-${uid}`,
        companyId: compA_Id,
        city: 'Goiânia',
        children: {
          create: [{ name: 'Filho A1', age: 7 }],
        },
      },
    });

    // 4. Criar Cliente e registros filhos da Empresa B
    await prisma.client.create({
      data: {
        id: `cl_b_${uid}`,
        name: 'Cliente Backup B',
        sequenceNumber: `SEQ-401-${uid}`,
        companyId: compB_Id,
        city: 'Brasília',
        children: {
          create: [{ name: 'Filho B1', age: 10 }],
        },
      },
    });

    tokenAdminA = generateToken({ id: adminA_Id, role: 'ADMIN', companyId: compA_Id, name: 'Admin A' });
    tokenAdminB = generateToken({ id: adminB.id, role: 'ADMIN', companyId: compB_Id, name: 'Admin B' });
    tokenSellerA = generateToken({ id: sellerA_Id, role: 'SELLER', companyId: compA_Id, name: 'Seller A' });
    tokenSuperAdmin = generateToken({ id: superAdminId, role: 'SUPER_ADMIN', name: 'Super Admin' });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const port = (server.address() as any).port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) server.close();
    await prisma.child.deleteMany({ where: { client: { companyId: { in: [compA_Id, compB_Id] } } } });
    await prisma.client.deleteMany({ where: { companyId: { in: [compA_Id, compB_Id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [adminA_Id, sellerA_Id, superAdminId] } } });
    await prisma.company.deleteMany({ where: { id: { in: [compA_Id, compB_Id] } } });
    await prisma.$disconnect();
  });

  describe('1. Upload Seguro e Validação de Tipos / Autenticação', () => {
    it('deve rejeitar upload não autenticado com 401', async () => {
      const res = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
      });
      assert.equal(res.status, 401);
    });

    it('deve rejeitar upload sem arquivo com 400', async () => {
      const form = new FormData();
      const res = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenSellerA}`,
        },
        body: form,
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.ok(data.error);
    });

    it('deve aceitar upload de imagem válida e retornar URL escopada por empresa', async () => {
      const form = new FormData();
      const imageFile = new File([Buffer.from('fake jpeg image data')], 'foto_teste.jpg', { type: 'image/jpeg' });
      form.append('file', imageFile);

      const res = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenSellerA}`,
        },
        body: form,
      });

      const data = await res.json();
      assert.equal(res.status, 200);
      assert.ok(data.url);
      assert.ok(data.url.includes(`/api/upload/file/${compA_Id}/`));
      
      const fileUrl = data.url;

      // 1. Download legítimo com token da Empresa A
      const dlResAuth = await fetch(`${baseUrl}${fileUrl}`, {
        headers: { Authorization: `Bearer ${tokenAdminA}` },
      });
      assert.equal(dlResAuth.status, 200);

      // 2. Download cruzado com token da Empresa B (deve retornar 403 Forbidden)
      const dlResCross = await fetch(`${baseUrl}${fileUrl}`, {
        headers: { Authorization: `Bearer ${tokenAdminB}` },
      });
      assert.equal(dlResCross.status, 403);

      // 3. Download não autenticado (deve retornar 401 Unauthorized)
      const dlResAnon = await fetch(`${baseUrl}${fileUrl}`);
      assert.equal(dlResAnon.status, 401);
    });
  });

  describe('2. Backup Multi-Tenant e Proteção de Dados Relacionados', () => {
    it('deve incluir apenas clientes e filhos da Empresa A ao gerar backup tenant-scoped', async () => {
      const backupRaw = await generateBackupJson(compA_Id);
      const backup = JSON.parse(backupRaw);

      assert.equal(backup._metadata.companyId, compA_Id);
      assert.ok(backup.Client);
      assert.equal(backup.Client.length, 1);
      assert.equal(backup.Client[0].companyId, compA_Id);

      // Child table relation scoping
      assert.ok(backup.Child);
      assert.equal(backup.Child.length, 1);
      assert.equal(backup.Child[0].name, 'Filho A1');
    });

    it('deve permitir que Admin A baixe backup exclusivamente da sua empresa via GET /api/backup/download', async () => {
      const res = await fetch(`${baseUrl}/api/backup/download`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${tokenAdminA}`,
        },
      });

      assert.equal(res.status, 200);
      const backup = await res.json();
      assert.equal(backup._metadata.companyId, compA_Id);
      assert.ok(backup.Client.every((c: any) => c.companyId === compA_Id));
    });

    it('deve rejeitar tentativa de restore de banco por Admin comum com 403', async () => {
      const form = new FormData();
      const blob = new Blob([JSON.stringify({ _metadata: { version: '1.0' } })], { type: 'application/json' });
      form.append('file', blob, 'backup.json');

      const res = await fetch(`${baseUrl}/api/backup/restore`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: form,
      });

      assert.equal(res.status, 403);
    });
  });

  describe('3. Trava Estrita de Segurança (safety-lock) com Parser de URL', () => {
    it('deve aprovar DATABASE_URL válida com 127.0.0.1:5432/selectphoto_staging_local', () => {
      assert.doesNotThrow(() => {
        assertStagingSafety('postgresql://postgres:postgres@127.0.0.1:5432/selectphoto_staging_local', 'TEST_OP');
      });
    });

    it('deve rejeitar URLs com hosts de produção ou serviços cloud (Render, Supabase, Neon)', () => {
      assert.throws(() => {
        assertStagingSafety('postgresql://user:pass@dpg-xxx.render.com:5432/prod_db', 'TEST_RENDER');
      }, /BLOQUEIO DE SEGURANÇA|Host inválido/);

      assert.throws(() => {
        assertStagingSafety('postgresql://user:pass@ep-cool-pool.neon.tech/neondb', 'TEST_NEON');
      }, /BLOQUEIO DE SEGURANÇA|Host inválido/);

      assert.throws(() => {
        assertStagingSafety('postgresql://postgres:pass@db.supabase.co:5432/postgres', 'TEST_SUPABASE');
      }, /BLOQUEIO DE SEGURANÇA|Host inválido/);
    });

    it('deve rejeitar porta diferente de 5432 ou banco diferente de selectphoto_staging_local', () => {
      assert.throws(() => {
        assertStagingSafety('postgresql://postgres:postgres@127.0.0.1:5433/selectphoto_staging_local', 'TEST_PORT');
      }, /Porta inválida/);

      assert.throws(() => {
        assertStagingSafety('postgresql://postgres:postgres@127.0.0.1:5432/selectphoto_prod', 'TEST_DB');
      }, /Banco inválido/);
    });
  });
});
