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
import editRequestsRoutes from '../src/routes/editRequests';
import appointmentsRoutes from '../src/routes/appointments';
import uploadRoutes from '../src/routes/upload';
import notificationsRoutes from '../src/routes/notifications';
import clientRoutes from '../src/routes/clients';
import closingRoutes from '../src/routes/closing';

const prisma = new PrismaClient();

function generateToken(payload: { id: string; role: string; companyId: string; name?: string }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

// Tokens for testing
const tokenCompanyA_Admin = generateToken({ id: 'auth_iso_admin_a', role: 'ADMIN', companyId: 'comp_auth_iso_a', name: 'Admin A' });
const tokenCompanyA_Seller = generateToken({ id: 'auth_iso_seller_a1', role: 'SELLER', companyId: 'comp_auth_iso_a', name: 'Seller A1' });
const tokenCompanyA_Seller2 = generateToken({ id: 'auth_iso_seller_a2', role: 'SELLER', companyId: 'comp_auth_iso_a', name: 'Seller A2' });
const tokenCompanyB_Admin = generateToken({ id: 'auth_iso_admin_b', role: 'ADMIN', companyId: 'comp_auth_iso_b', name: 'Admin B' });
const tokenCompanyB_Seller = generateToken({ id: 'auth_iso_seller_b1', role: 'SELLER', companyId: 'comp_auth_iso_b', name: 'Seller B1' });

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/edit-requests', editRequestsRoutes);
  app.use('/api/appointments', appointmentsRoutes);
  app.use('/api/upload', uploadRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/clients', clientRoutes);
  app.use('/api/closing', closingRoutes);
  return app;
}

describe('Etapa 1 - Segurança, Autenticação e Isolamento Multiempresa', () => {
  const app = createTestApp();
  let server: any;
  let baseUrl: string;

  test.before(async () => {
    // Seed test companies and users
    await prisma.company.upsert({ where: { id: 'comp_auth_iso_a' }, update: { isActive: true }, create: { id: 'comp_auth_iso_a', name: 'Empresa Auth Iso A', isActive: true } });
    await prisma.company.upsert({ where: { id: 'comp_auth_iso_b' }, update: { isActive: true }, create: { id: 'comp_auth_iso_b', name: 'Empresa Auth Iso B', isActive: true } });

    const usersToSeed = [
      { id: 'auth_iso_admin_a', name: 'Admin A', role: 'ADMIN', companyId: 'comp_auth_iso_a', cpf: '01010101011' },
      { id: 'auth_iso_seller_a1', name: 'Seller A1', role: 'SELLER', companyId: 'comp_auth_iso_a', cpf: '01010101012' },
      { id: 'auth_iso_seller_a2', name: 'Seller A2', role: 'SELLER', companyId: 'comp_auth_iso_a', cpf: '01010101013' },
      { id: 'auth_iso_admin_b', name: 'Admin B', role: 'ADMIN', companyId: 'comp_auth_iso_b', cpf: '01010101014' },
      { id: 'auth_iso_seller_b1', name: 'Seller B1', role: 'SELLER', companyId: 'comp_auth_iso_b', cpf: '01010101015' },
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
    await prisma.dailyClosing.deleteMany({ where: { sellerId: { in: ['auth_iso_admin_a', 'auth_iso_seller_a1', 'auth_iso_seller_a2', 'auth_iso_admin_b', 'auth_iso_seller_b1'] } } });
    await prisma.user.deleteMany({ where: { id: { in: ['auth_iso_admin_a', 'auth_iso_seller_a1', 'auth_iso_seller_a2', 'auth_iso_admin_b', 'auth_iso_seller_b1'] } } });
    await prisma.company.deleteMany({ where: { id: { in: ['comp_auth_iso_a', 'comp_auth_iso_b'] } } });
    await prisma.$disconnect();
  });

  // ── 1. editRequests ──────────────────────────────────────────────────────────
  describe('1. Proteção de editRequests', () => {
    it('deve rejeitar acesso anônimo em GET /api/edit-requests/pending com 401', async () => {
      const res = await fetch(`${baseUrl}/api/edit-requests/pending`);
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error, 'Access token missing');
    });

    it('deve rejeitar acesso de vendedor comum em GET /api/edit-requests/pending com 403', async () => {
      const res = await fetch(`${baseUrl}/api/edit-requests/pending`, {
        headers: { Authorization: `Bearer ${tokenCompanyA_Seller}` },
      });
      assert.equal(res.status, 403);
    });

    it('deve rejeitar aprovação anônima em POST /api/edit-requests/:id/approve com 401', async () => {
      const res = await fetch(`${baseUrl}/api/edit-requests/req-123/approve`, {
        method: 'POST',
      });
      assert.equal(res.status, 401);
    });

    it('deve rejeitar aprovação por vendedor comum com 403', async () => {
      const res = await fetch(`${baseUrl}/api/edit-requests/req-123/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenCompanyA_Seller}` },
      });
      assert.equal(res.status, 403);
    });

    it('deve rejeitar rejeição de solicitação por vendedor comum com 403', async () => {
      const res = await fetch(`${baseUrl}/api/edit-requests/req-123/reject`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenCompanyA_Seller}` },
      });
      assert.equal(res.status, 403);
    });
  });

  // ── 2. appointments ──────────────────────────────────────────────────────────
  describe('2. Proteção de appointments (Agenda)', () => {
    it('deve rejeitar criação anônima de agendamento com 401', async () => {
      const res = await fetch(`${baseUrl}/api/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sellerId: 'auth_iso_seller_a1', title: 'Visita', dateTime: new Date().toISOString() }),
      });
      assert.equal(res.status, 401);
    });

    it('deve rejeitar vendedor tentando consultar agenda de outro vendedor com 403', async () => {
      const res = await fetch(`${baseUrl}/api/appointments/seller/auth_iso_seller_a2`, {
        headers: { Authorization: `Bearer ${tokenCompanyA_Seller}` },
      });
      assert.equal(res.status, 403);
    });

    it('deve rejeitar vendedor da empresa B tentando consultar agenda de vendedor da empresa A com 403', async () => {
      const res = await fetch(`${baseUrl}/api/appointments/seller/auth_iso_seller_a1`, {
        headers: { Authorization: `Bearer ${tokenCompanyB_Seller}` },
      });
      assert.equal(res.status, 403);
    });

    it('deve rejeitar exclusão de agendamento anônima com 401', async () => {
      const res = await fetch(`${baseUrl}/api/appointments/apt-123`, {
        method: 'DELETE',
      });
      assert.equal(res.status, 401);
    });
  });

  // ── 3. upload ────────────────────────────────────────────────────────────────
  describe('3. Proteção da rota de upload', () => {
    it('deve rejeitar upload anônimo com 401', async () => {
      const res = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
      });
      assert.equal(res.status, 401);
    });

    it('deve retornar 400 se nenhum arquivo for enviado com usuário autenticado', async () => {
      const res = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenCompanyA_Admin}` },
      });
      assert.equal(res.status, 400);
    });
  });

  // ── 4. notifications ─────────────────────────────────────────────────────────
  describe('4. Proteção de notificações', () => {
    it('deve rejeitar leitura de notificações sem autenticação com 401', async () => {
      const res = await fetch(`${baseUrl}/api/notifications`);
      assert.equal(res.status, 401);
    });

    it('deve rejeitar ação de notificação anônima com 401', async () => {
      const res = await fetch(`${baseUrl}/api/notifications/notif-123/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionType: 'ACCEPT' }),
      });
      assert.equal(res.status, 401);
    });

    it('deve rejeitar marcar notificação inexistente ou de outro destinatário com 404', async () => {
      const res = await fetch(`${baseUrl}/api/notifications/notif-alheia/read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${tokenCompanyA_Seller}` },
      });
      assert.equal(res.status, 404);
    });
  });

  // ── 5. closing (Fechamento) ──────────────────────────────────────────────────
  describe('5. Isolamento Multiempresa em Fechamentos', () => {
    it('deve rejeitar vendedor tentando ver fechamento diário de outro vendedor com 403', async () => {
      const res = await fetch(`${baseUrl}/api/closing/daily/auth_iso_seller_a2`, {
        headers: { Authorization: `Bearer ${tokenCompanyA_Seller}` },
      });
      assert.equal(res.status, 403);
    });

    it('deve rejeitar vendedor tentando ver fechamento de vendedor de outra empresa com 403', async () => {
      const res = await fetch(`${baseUrl}/api/closing/daily/auth_iso_seller_a1`, {
        headers: { Authorization: `Bearer ${tokenCompanyB_Seller}` },
      });
      assert.equal(res.status, 403);
    });

    it('deve rejeitar vendedor comum tentando registrar repasse com 403', async () => {
      const res = await fetch(`${baseUrl}/api/closing/pay-repasse`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenCompanyA_Seller}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sellerId: 'auth_iso_seller_a1', amount: 100 }),
      });
      assert.equal(res.status, 403);
    });
  });
});
