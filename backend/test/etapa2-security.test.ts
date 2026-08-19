import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const envPath = path.resolve(__dirname, '../.env.test.local');
const envConfig = dotenv.parse(fs.readFileSync(envPath));
const databaseUrl = envConfig.DATABASE_URL;
const JWT_SECRET = envConfig.JWT_SECRET || 'selectphoto-jwt-secret-key';

process.env.DATABASE_URL = databaseUrl;
process.env.JWT_SECRET = JWT_SECRET;

import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

// Import routes
import backupRouter from '../src/routes/backup';
import financeRoutes from '../src/routes/finance';
import costsRoutes from '../src/routes/costs';
import stockRoutes from '../src/routes/stock';

const prisma = new PrismaClient();

function generateToken(payload: { id: string; role: string; companyId: string; name?: string }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

const tokenSuperAdmin = generateToken({ id: 'sec_super_1', role: 'SUPER_ADMIN', companyId: 'comp_sec_global', name: 'Super Admin' });
const tokenAdmin = generateToken({ id: 'sec_admin_1', role: 'ADMIN', companyId: 'comp_sec_a', name: 'Admin Company A' });
const tokenSeller = generateToken({ id: 'sec_seller_1', role: 'SELLER', companyId: 'comp_sec_a', name: 'Seller 1' });
const tokenPhotographer = generateToken({ id: 'sec_photo_1', role: 'PHOTOGRAPHER', companyId: 'comp_sec_a', name: 'Photographer 1' });

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/backup', backupRouter);
  app.use('/api/finance', financeRoutes);
  app.use('/api/costs', costsRoutes);
  app.use('/api/stock', stockRoutes);
  return app;
}

describe('Etapa 2 - Proteção de Backup, Finanças, Custos e Estoque', () => {
  const app = createTestApp();
  let server: any;
  let baseUrl: string;

  test.before(async () => {
    // Seed companies and users
    await prisma.company.upsert({ where: { id: 'comp_sec_global' }, update: { isActive: true }, create: { id: 'comp_sec_global', name: 'Global Company', isActive: true } });
    await prisma.company.upsert({ where: { id: 'comp_sec_a' }, update: { isActive: true }, create: { id: 'comp_sec_a', name: 'Company Sec A', isActive: true } });

    const usersToSeed = [
      { id: 'sec_super_1', name: 'Super Admin', role: 'SUPER_ADMIN', companyId: 'comp_sec_global', cpf: '02020202021' },
      { id: 'sec_admin_1', name: 'Admin Company A', role: 'ADMIN', companyId: 'comp_sec_a', cpf: '02020202022' },
      { id: 'sec_seller_1', name: 'Seller 1', role: 'SELLER', companyId: 'comp_sec_a', cpf: '02020202023' },
      { id: 'sec_photo_1', name: 'Photographer 1', role: 'PHOTOGRAPHER', companyId: 'comp_sec_a', cpf: '02020202024' },
    ];

    for (const u of usersToSeed) {
      await prisma.user.upsert({
        where: { id: u.id },
        update: { role: u.role, companyId: u.companyId, active: true },
        create: { id: u.id, name: u.name, role: u.role, companyId: u.companyId, cpf: u.cpf, password: 'hash', active: true }
      });
    }

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const port = (server.address() as any).port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  test.after(async () => {
    if (server) server.close();
    await prisma.user.deleteMany({ where: { id: { in: ['sec_super_1', 'sec_admin_1', 'sec_seller_1', 'sec_photo_1'] } } });
    await prisma.company.deleteMany({ where: { id: { in: ['comp_sec_global', 'comp_sec_a'] } } });
    await prisma.$disconnect();
  });

  // ── 1. Backup e Restauração ──────────────────────────────────────────────────
  describe('1. Segurança de Backup e Restauração', () => {
    it('deve rejeitar download de backup anônimo com 401', async () => {
      const res = await fetch(`${baseUrl}/api/backup/download`);
      assert.equal(res.status, 401);
    });

    it('deve rejeitar download de backup por vendedor comum com 403', async () => {
      const res = await fetch(`${baseUrl}/api/backup/download`, {
        headers: { Authorization: `Bearer ${tokenSeller}` },
      });
      assert.equal(res.status, 403);
    });

    it('deve rejeitar tentativa de restauração anônima com 401', async () => {
      const res = await fetch(`${baseUrl}/api/backup/restore`, {
        method: 'POST',
      });
      assert.equal(res.status, 401);
    });

    it('deve rejeitar tentativa de restauração por Admin comum com 403 (exclusivo SUPER_ADMIN)', async () => {
      const res = await fetch(`${baseUrl}/api/backup/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenAdmin}` },
      });
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.match(data.error, /Requires Super Admin role/i);
    });

    it('deve rejeitar tentativa de restauração por Vendedor com 403', async () => {
      const res = await fetch(`${baseUrl}/api/backup/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenSeller}` },
      });
      assert.equal(res.status, 403);
    });
  });

  // ── 2. Finanças ──────────────────────────────────────────────────────────────
  describe('2. Segurança de Rotas Financeiras', () => {
    it('deve rejeitar acesso de vendedor em GET /api/finance/overview com 403', async () => {
      const res = await fetch(`${baseUrl}/api/finance/overview`, {
        headers: { Authorization: `Bearer ${tokenSeller}` },
      });
      assert.equal(res.status, 403);
    });

    it('deve rejeitar acesso de fotógrafo em GET /api/finance/health com 403', async () => {
      const res = await fetch(`${baseUrl}/api/finance/health`, {
        headers: { Authorization: `Bearer ${tokenPhotographer}` },
      });
      assert.equal(res.status, 403);
    });

    it('deve rejeitar vendedor tentando aprovar/rejeitar custo em /api/finance/costs/:id/status com 403', async () => {
      const res = await fetch(`${baseUrl}/api/finance/costs/c-123/status`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${tokenSeller}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'APPROVED' }),
      });
      assert.equal(res.status, 403);
    });

    it('deve retornar 400 se admin enviar status inválido em /api/finance/costs/:id/status', async () => {
      const res = await fetch(`${baseUrl}/api/finance/costs/c-123/status`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${tokenAdmin}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'HACKED' }),
      });
      assert.equal(res.status, 400);
    });
  });

  // ── 3. Custos ────────────────────────────────────────────────────────────────
  describe('3. Validação de Entrada e Permissões em Custos', () => {
    it('deve rejeitar envio de custo anônimo com 401', async () => {
      const res = await fetch(`${baseUrl}/api/costs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 50, category: 'GASOLINA' }),
      });
      assert.equal(res.status, 401);
    });

    it('deve retornar 400 se valor do custo for negativo ou zero', async () => {
      const res = await fetch(`${baseUrl}/api/costs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenSeller}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount: -15, category: 'GASOLINA' }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /positivo maior que zero/i);
    });

    it('deve retornar 400 se categoria estiver ausente', async () => {
      const res = await fetch(`${baseUrl}/api/costs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenSeller}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount: 50 }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /categoria.*obrigat/i);
    });
  });

  // ── 4. Estoque ───────────────────────────────────────────────────────────────
  describe('4. Segurança e Transações de Estoque', () => {
    it('deve rejeitar criação de lote de estoque por vendedor com 403', async () => {
      const res = await fetch(`${baseUrl}/api/stock/batch`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenSeller}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ quantity: 100 }),
      });
      assert.equal(res.status, 403);
    });

    it('deve retornar 400 se admin enviar quantidade de lote negativa ou inválida', async () => {
      const res = await fetch(`${baseUrl}/api/stock/batch`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenAdmin}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ quantity: -50 }),
      });
      assert.equal(res.status, 400);
    });

    it('deve rejeitar transferência de estoque por vendedor com 403', async () => {
      const res = await fetch(`${baseUrl}/api/stock/transfer`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenSeller}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sellerId: 'seller-1', quantity: 20 }),
      });
      assert.equal(res.status, 403);
    });

    it('deve rejeitar descarte de capas danificadas por vendedor comum com 403', async () => {
      const res = await fetch(`${baseUrl}/api/stock/defective`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenSeller}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sellerId: 'seller-1', quantity: 5 }),
      });
      assert.equal(res.status, 403);
    });

    it('deve retornar 400 se quantidade de devolução for inválida', async () => {
      const res = await fetch(`${baseUrl}/api/stock/return-cover`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenSeller}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ quantity: 0 }),
      });
      assert.equal(res.status, 400);
    });
  });
});
