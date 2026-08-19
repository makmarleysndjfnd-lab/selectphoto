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
const jwtSecret = envConfig.JWT_SECRET || 'test_secret_for_auth_hardening_2026';

process.env.DATABASE_URL = databaseUrl;
process.env.JWT_SECRET = jwtSecret;

const prisma = new PrismaClient();

describe('ETAPA 1 — Testes de Autenticação, Autorização e Prevenção de Elevação de Privilégios', { concurrency: 1 }, () => {
  let server: any;
  let baseUrl: string;

  const uid = 'etapa1_' + Date.now();
  const activeCompId = `comp_active_${uid}`;
  const inactiveCompId = `comp_inactive_${uid}`;

  let activeSellerId: string;
  let inactiveUserId: string;
  let userInInactiveCompId: string;
  let adminId: string;

  let tokenActiveSeller: string;
  let tokenInactiveUser: string;
  let tokenUserInInactiveComp: string;
  let tokenAdmin: string;
  let tokenForgedSuperAdmin: string;

  before(async () => {
    // 1. Criar empresas de teste
    await prisma.company.create({
      data: { id: activeCompId, name: 'Empresa Ativa', isActive: true },
    });
    await prisma.company.create({
      data: { id: inactiveCompId, name: 'Empresa Inativa', isActive: false },
    });

    const hashedPassword = await bcrypt.hash('Senha123!', 10);

    // 2. Criar usuário vendedor ativo
    const seller = await prisma.user.create({
      data: {
        id: `u_sel_${uid}`,
        name: 'Vendedor Ativo',
        cpf: `100${Date.now().toString().slice(-8)}`,
        password: hashedPassword,
        role: 'SELLER',
        active: true,
        companyId: activeCompId,
      },
    });
    activeSellerId = seller.id;

    // 3. Criar usuário inativo
    const inactiveUser = await prisma.user.create({
      data: {
        id: `u_inact_${uid}`,
        name: 'Usuário Inativo',
        cpf: `200${Date.now().toString().slice(-8)}`,
        password: hashedPassword,
        role: 'SELLER',
        active: false,
        companyId: activeCompId,
      },
    });
    inactiveUserId = inactiveUser.id;

    // 4. Criar usuário em empresa inativa
    const userInInactiveComp = await prisma.user.create({
      data: {
        id: `u_inact_comp_${uid}`,
        name: 'Usuário em Empresa Desativada',
        cpf: `300${Date.now().toString().slice(-8)}`,
        password: hashedPassword,
        role: 'SELLER',
        active: true,
        companyId: inactiveCompId,
      },
    });
    userInInactiveCompId = userInInactiveComp.id;

    // 5. Criar Admin
    const admin = await prisma.user.create({
      data: {
        id: `u_adm_${uid}`,
        name: 'Admin Empresa',
        cpf: `400${Date.now().toString().slice(-8)}`,
        password: hashedPassword,
        role: 'ADMIN',
        active: true,
        companyId: activeCompId,
      },
    });
    adminId = admin.id;

    // Gerar tokens
    tokenActiveSeller = jwt.sign({ id: activeSellerId, role: 'SELLER', companyId: activeCompId }, jwtSecret);
    tokenInactiveUser = jwt.sign({ id: inactiveUserId, role: 'SELLER', companyId: activeCompId }, jwtSecret);
    tokenUserInInactiveComp = jwt.sign({ id: userInInactiveCompId, role: 'SELLER', companyId: inactiveCompId }, jwtSecret);
    tokenAdmin = jwt.sign({ id: adminId, role: 'ADMIN', companyId: activeCompId }, jwtSecret);

    // Token forjado: alega ser SUPER_ADMIN no JWT, mas no banco o ID é de um SELLER
    tokenForgedSuperAdmin = jwt.sign({ id: activeSellerId, role: 'SUPER_ADMIN', companyId: activeCompId }, jwtSecret);

    // Montar app express com rotas dinâmicas
    const authRouter = (await import('../src/routes/auth')).default;
    const usersRouter = (await import('../src/routes/users')).default;

    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);
    app.use('/api/users', usersRouter);

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
    // Limpeza
    await prisma.user.deleteMany({
      where: { id: { in: [activeSellerId, inactiveUserId, userInInactiveCompId, adminId] } },
    });
    await prisma.company.deleteMany({
      where: { id: { in: [activeCompId, inactiveCompId] } },
    });
    await prisma.$disconnect();
  });

  it('1. Login: Rejeita usuário inativo com 401', async () => {
    const inactiveUser = await prisma.user.findUnique({ where: { id: inactiveUserId } });
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cpf: inactiveUser?.cpf, password: 'Senha123!' }),
    });
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.match(data.error, /inactive/i);
  });

  it('2. Login: Rejeita usuário em empresa inativa com 401', async () => {
    const user = await prisma.user.findUnique({ where: { id: userInInactiveCompId } });
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cpf: user?.cpf, password: 'Senha123!' }),
    });
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.match(data.error, /company account is inactive/i);
  });

  it('3. Revalidação Online: Rejeita requisição de usuário inativo com 403', async () => {
    const res = await fetch(`${baseUrl}/api/users/company`, {
      headers: { Authorization: `Bearer ${tokenInactiveUser}` },
    });
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.match(data.error, /inactive/i);
  });

  it('4. Revalidação Online: Rejeita requisição de empresa inativa com 403', async () => {
    const res = await fetch(`${baseUrl}/api/users/company`, {
      headers: { Authorization: `Bearer ${tokenUserInInactiveComp}` },
    });
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.match(data.error, /company account is inactive/i);
  });

  it('5. Proteção de Claims: Revalida papel no banco e impede privilégio forjado no JWT', async () => {
    // Tenta acessar rota restrita de ADMIN com token forjado que tem role 'SUPER_ADMIN' no JWT mas é 'SELLER' no banco
    const res = await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: `Bearer ${tokenForgedSuperAdmin}` },
    });
    assert.equal(res.status, 403);
  });

  it('6. Elevação de Privilégio: ADMIN comum NÃO pode criar usuário SUPER_ADMIN (403)', async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenAdmin}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Tentativa Super Admin',
        cpf: `999${Date.now().toString().slice(-8)}`,
        password: 'SenhaSecreta123!',
        role: 'SUPER_ADMIN',
      }),
    });
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.match(data.error, /SUPER_ADMIN/i);
  });

  it('7. Auto-Elevação: ADMIN não pode alterar o próprio papel em PUT /api/users/:id (403)', async () => {
    const res = await fetch(`${baseUrl}/api/users/${adminId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${tokenAdmin}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Admin Alterado',
        role: 'SUPER_ADMIN',
      }),
    });
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.match(data.error, /Cannot change your own role/i);
  });

  it('8. Resolução de Rotas: PUT /api/users/profile não é capturado por /:id', async () => {
    const res = await fetch(`${baseUrl}/api/users/profile`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${tokenActiveSeller}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Vendedor Nome Atualizado' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.name, 'Vendedor Nome Atualizado');
  });

  it('9. Resolução de Rotas: GET /api/users/company lista usuários da mesma empresa', async () => {
    const res = await fetch(`${baseUrl}/api/users/company`, {
      headers: { Authorization: `Bearer ${tokenActiveSeller}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data));
    assert.ok(data.some((u: any) => u.id === activeSellerId));
  });
});
