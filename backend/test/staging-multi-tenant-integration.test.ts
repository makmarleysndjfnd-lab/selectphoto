import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

// 1. Carregar .env.test.local e configurar process.env IMEDIATAMENTE
const envPath = path.resolve(__dirname, '../.env.test.local');
const envConfig = dotenv.parse(fs.readFileSync(envPath));
const databaseUrl = envConfig.DATABASE_URL;
const jwtSecret = envConfig.JWT_SECRET || 'selectphoto_staging_local_jwt_test_2026_nao_usar_em_producao';

process.env.DATABASE_URL = databaseUrl;
process.env.JWT_SECRET = jwtSecret;

// Trava estrita de segurança
if (!databaseUrl || !databaseUrl.includes('127.0.0.1')) {
  throw new Error('🛑 TRAVA DE TESTE: Teste de integração só pode rodar em 127.0.0.1');
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

describe('Ambiente de Staging Local — Testes de Integração e Isolamento Multiempresa', { concurrency: 1 }, () => {
  let server: any;
  let baseUrl: string;

  const uid = 'stg_' + Date.now();

  const compAlphaId = `comp_a_${uid}`;
  const compBetaId = `comp_b_${uid}`;

  const userAlphaAdmin = { id: `u_a_adm_${uid}`, role: 'ADMIN', companyId: compAlphaId, name: 'Admin Alpha' };
  const userAlphaSeller = { id: `u_a_sel_${uid}`, role: 'SELLER', companyId: compAlphaId, name: 'Vendedor Alpha' };
  const userBetaAdmin = { id: `u_b_adm_${uid}`, role: 'ADMIN', companyId: compBetaId, name: 'Admin Beta' };
  const userBetaSeller = { id: `u_b_sel_${uid}`, role: 'SELLER', companyId: compBetaId, name: 'Vendedor Beta' };
  const userSuperAdmin = { id: `u_s_adm_${uid}`, role: 'SUPER_ADMIN', name: 'Super Admin' };

  let tokenAlphaAdmin: string;
  let tokenAlphaSeller: string;
  let tokenBetaAdmin: string;
  let tokenBetaSeller: string;
  let tokenSuperAdmin: string;

  let clientAlphaId: string;
  let clientAlphaSeq: string;
  let clientBetaId: string;
  let editRequestId: string;
  let appointmentId: string;

  before(async () => {
    // 2. Importação dinâmica das rotas APÓS process.env.DATABASE_URL estar configurado
    const editRequestsRouter = (await import('../src/routes/editRequests')).default;
    const appointmentsRouter = (await import('../src/routes/appointments')).default;
    const notificationsRouter = (await import('../src/routes/notifications')).default;
    const closingRouter = (await import('../src/routes/closing')).default;
    const clientsRouter = (await import('../src/routes/clients')).default;
    const stockRouter = (await import('../src/routes/stock')).default;
    const backupRouter = (await import('../src/routes/backup')).default;
    const uploadRouter = (await import('../src/routes/upload')).default;
    const financeRouter = (await import('../src/routes/finance')).default;

    const app = express();
    app.use(express.json());

    app.use('/api/edit-requests', editRequestsRouter);
    app.use('/api/appointments', appointmentsRouter);
    app.use('/api/notifications', notificationsRouter);
    app.use('/api/closing', closingRouter);
    app.use('/api/clients', clientsRouter);
    app.use('/api/stock', stockRouter);
    app.use('/api/backup', backupRouter);
    app.use('/api/upload', uploadRouter);
    app.use('/api/finance', financeRouter);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const port = (server.address() as any).port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    tokenAlphaAdmin = jwt.sign(userAlphaAdmin, jwtSecret);
    tokenAlphaSeller = jwt.sign(userAlphaSeller, jwtSecret);
    tokenBetaAdmin = jwt.sign(userBetaAdmin, jwtSecret);
    tokenBetaSeller = jwt.sign(userBetaSeller, jwtSecret);
    tokenSuperAdmin = jwt.sign(userSuperAdmin, jwtSecret);

    // 1. Criar Empresas no PostgreSQL local
    await prisma.company.create({
      data: { id: compAlphaId, name: 'Empresa Alpha Test', cnpj: `11.111.111/${uid.slice(-4)}-11` },
    });
    await prisma.company.create({
      data: { id: compBetaId, name: 'Empresa Beta Test', cnpj: `22.222.222/${uid.slice(-4)}-22` },
    });

    // 2. Criar Usuários no PostgreSQL local
    await prisma.user.create({
      data: { id: userAlphaAdmin.id, name: userAlphaAdmin.name, email: `adm_${uid}@alpha.test`, role: 'ADMIN', companyId: compAlphaId, password: 'hash' },
    });
    await prisma.user.create({
      data: { id: userAlphaSeller.id, name: userAlphaSeller.name, email: `sel_${uid}@alpha.test`, role: 'SELLER', companyId: compAlphaId, password: 'hash' },
    });
    await prisma.user.create({
      data: { id: userBetaAdmin.id, name: userBetaAdmin.name, email: `adm_${uid}@beta.test`, role: 'ADMIN', companyId: compBetaId, password: 'hash' },
    });
    await prisma.user.create({
      data: { id: userBetaSeller.id, name: userBetaSeller.name, email: `sel_${uid}@beta.test`, role: 'SELLER', companyId: compBetaId, password: 'hash' },
    });
    await prisma.user.create({
      data: { id: userSuperAdmin.id, name: userSuperAdmin.name, email: `sup_${uid}@selectphoto.test`, role: 'SUPER_ADMIN', password: 'hash' },
    });

    // 3. Criar Clientes no PostgreSQL local
    clientAlphaSeq = `SEQ_${uid}`;
    const cAlpha = await prisma.client.create({
      data: {
        name: 'Cliente Alpha Original',
        companyId: compAlphaId,
        sequenceNumber: clientAlphaSeq,
        phone1: '11999990001',
        status: 'PENDING',
      },
    });
    clientAlphaId = cAlpha.id;

    const cBeta = await prisma.client.create({
      data: {
        name: 'Cliente Beta Original',
        companyId: compBetaId,
        sequenceNumber: `SEQ_B_${uid}`,
        phone1: '11999990002',
        status: 'PENDING',
      },
    });
    clientBetaId = cBeta.id;
  });

  after(async () => {
    if (server) server.close();
    await prisma.sale.deleteMany({ where: { companyId: { in: [compAlphaId, compBetaId] } } }).catch(() => {});
    await prisma.personalAppointment.deleteMany({ where: { sellerId: { in: [userAlphaSeller.id, userBetaSeller.id] } } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { companyId: { in: [compAlphaId, compBetaId] } } }).catch(() => {});
    await prisma.clientEditRequest.deleteMany({ where: { client: { companyId: { in: [compAlphaId, compBetaId] } } } }).catch(() => {});
    await prisma.client.deleteMany({ where: { companyId: { in: [compAlphaId, compBetaId] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [userAlphaAdmin.id, userAlphaSeller.id, userBetaAdmin.id, userBetaSeller.id, userSuperAdmin.id] } } }).catch(() => {});
    await prisma.company.deleteMany({ where: { id: { in: [compAlphaId, compBetaId] } } }).catch(() => {});
    await prisma.$disconnect();
  });

  // ── TESTES DE ISOLAMENTO ──────────────────────────────────────────────────

  it('1. editRequests: vendedor da Empresa Alpha cria solicitação de edição para cliente da Empresa Alpha', async () => {
    const res = await fetch(`${baseUrl}/api/edit-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAlphaSeller}` },
      body: JSON.stringify({
        clientId: clientAlphaId,
        proposedData: { name: 'Cliente Alpha Modificado' },
        reason: 'Correção de grafia',
      }),
    });
    assert.equal(res.status, 200);
    const data: any = await res.json();
    editRequestId = data.editRequest?.id || data.id;
    assert.ok(editRequestId);
  });

  it('2. editRequests: vendedor da Empresa Beta NÃO pode criar solicitação para cliente da Empresa Alpha (404)', async () => {
    const res = await fetch(`${baseUrl}/api/edit-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenBetaSeller}` },
      body: JSON.stringify({
        clientId: clientAlphaId,
        proposedData: { name: 'Tentativa de Hack' },
      }),
    });
    assert.equal(res.status, 404);
  });

  it('3. editRequests: Admin da Empresa Beta NÃO pode aprovar solicitação da Empresa Alpha (404 e NÃO altera dados)', async () => {
    const res = await fetch(`${baseUrl}/api/edit-requests/${editRequestId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBetaAdmin}` },
    });
    assert.equal(res.status, 404);

    const client = await prisma.client.findUnique({ where: { id: clientAlphaId } });
    assert.equal(client?.name, 'Cliente Alpha Original');
  });

  it('4. editRequests: Admin da Empresa Alpha PODE aprovar e os dados são atualizados', async () => {
    const res = await fetch(`${baseUrl}/api/edit-requests/${editRequestId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenAlphaAdmin}` },
    });
    assert.equal(res.status, 200);

    const client = await prisma.client.findUnique({ where: { id: clientAlphaId } });
    assert.equal(client?.name, 'Cliente Alpha Modificado');
  });

  it('5. appointments: Vendedor Alpha pode criar compromisso pessoal para si mesmo', async () => {
    const res = await fetch(`${baseUrl}/api/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAlphaSeller}` },
      body: JSON.stringify({
        sellerId: userAlphaSeller.id,
        title: 'Visita Comercial Alpha',
        dateTime: new Date().toISOString(),
      }),
    });
    assert.equal(res.status, 200);
    const data: any = await res.json();
    appointmentId = data.id;
    assert.ok(appointmentId);
  });

  it('6. appointments: Vendedor Beta NÃO pode visualizar compromisso do Vendedor Alpha (403)', async () => {
    const res = await fetch(`${baseUrl}/api/appointments/seller/${userAlphaSeller.id}`, {
      headers: { Authorization: `Bearer ${tokenBetaSeller}` },
    });
    assert.equal(res.status, 403);
  });

  it('7. appointments: Admin Beta NÃO pode excluir compromisso do Vendedor Alpha (403)', async () => {
    const res = await fetch(`${baseUrl}/api/appointments/${appointmentId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenBetaAdmin}` },
    });
    assert.equal(res.status, 403);

    const appt = await prisma.personalAppointment.findUnique({ where: { id: appointmentId } });
    assert.ok(appt);
  });

  it('8. clients/assign-seller: Admin Alpha NÃO pode atribuir Vendedor Beta para Cliente Alpha (404)', async () => {
    const res = await fetch(`${baseUrl}/api/clients/assign-seller`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAlphaAdmin}` },
      body: JSON.stringify({
        sequenceNumber: clientAlphaSeq,
        sellerId: userBetaSeller.id,
      }),
    });
    assert.equal(res.status, 404);
    const data: any = await res.json();
    assert.equal(data.error, 'Vendedor não encontrado na sua empresa');
  });

  it('9. clients/assign-seller: Admin Beta NÃO pode atribuir Vendedor para Cliente de outra empresa (404)', async () => {
    const res = await fetch(`${baseUrl}/api/clients/assign-seller`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenBetaAdmin}` },
      body: JSON.stringify({
        sequenceNumber: clientAlphaSeq,
        sellerId: userBetaSeller.id,
      }),
    });
    assert.equal(res.status, 404);
  });

  it('10. closing: Vendedor Beta NÃO pode acessar fechamento do Vendedor Alpha (403)', async () => {
    const res = await fetch(`${baseUrl}/api/closing/daily/${userAlphaSeller.id}`, {
      headers: { Authorization: `Bearer ${tokenBetaSeller}` },
    });
    assert.equal(res.status, 403);
  });

  it('11. closing: Admin Beta NÃO pode acessar fechamento do Vendedor Alpha (403)', async () => {
    const res = await fetch(`${baseUrl}/api/closing/daily/${userAlphaSeller.id}`, {
      headers: { Authorization: `Bearer ${tokenBetaAdmin}` },
    });
    assert.equal(res.status, 403);
  });

  it('12. backup: Admin Alpha ao baixar backup recebe apenas dados de sua própria empresa', async () => {
    const res = await fetch(`${baseUrl}/api/backup/download`, {
      headers: { Authorization: `Bearer ${tokenAlphaAdmin}` },
    });
    assert.equal(res.status, 200);
    const rawText = await res.text();
    const backupData = JSON.parse(rawText);

    assert.ok(backupData._metadata);
    assert.equal(backupData._metadata.companyId, compAlphaId);

    const clients = backupData.Client || [];
    const betaClients = clients.filter((c: any) => c.companyId === compBetaId);
    assert.equal(betaClients.length, 0);
  });

  it('13. backup: Admin Alpha NÃO pode executar restore no banco (403 - restrito a SUPER_ADMIN)', async () => {
    const res = await fetch(`${baseUrl}/api/backup/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAlphaAdmin}` },
      body: JSON.stringify({ version: '1.0', data: {} }),
    });
    assert.equal(res.status, 403);
  });

  it('14. finance: overview calcula totalEntradas sobre TODOS os registros (>50) e isola empresas', async () => {
    // Cria 60 vendas de R$ 100 para Empresa Alpha (Total esperado: R$ 6.000)
    const salesDataAlpha = [];
    for (let i = 0; i < 60; i++) {
      salesDataAlpha.push({
        id: `sale_a_${uid}_${i}`,
        value: 100.0,
        paymentMethod: 'PIX',
        city: 'Goiânia',
        companyId: compAlphaId,
        sellerId: userAlphaSeller.id,
        clientId: clientAlphaId,
        date: new Date(Date.now() - i * 1000),
      });
    }
    await prisma.sale.createMany({ data: salesDataAlpha });

    // Cria 5 vendas de R$ 50 para Empresa Beta (Total esperado: R$ 250)
    const salesDataBeta = [];
    for (let i = 0; i < 5; i++) {
      salesDataBeta.push({
        id: `sale_b_${uid}_${i}`,
        value: 50.0,
        paymentMethod: 'CASH',
        city: 'Brasília',
        companyId: compBetaId,
        sellerId: userBetaSeller.id,
        clientId: clientBetaId,
        date: new Date(Date.now() - i * 1000),
      });
    }
    await prisma.sale.createMany({ data: salesDataBeta });

    // Consulta overview como Admin da Empresa Alpha
    const resAlpha = await fetch(`${baseUrl}/api/finance/overview`, {
      headers: { Authorization: `Bearer ${tokenAlphaAdmin}` },
    });
    assert.equal(resAlpha.status, 200);
    const dataAlpha = await resAlpha.json();

    // Valida que o total calculado no banco soma todas as 60 vendas (60 * 100 = 6000)
    assert.equal(dataAlpha.totalEntradas, 6000);
    // Valida que a lista visual recente continua limitada a 50 itens
    assert.equal(dataAlpha.recentSales.length, 50);

    // Consulta overview como Admin da Empresa Beta
    const resBeta = await fetch(`${baseUrl}/api/finance/overview`, {
      headers: { Authorization: `Bearer ${tokenBetaAdmin}` },
    });
    assert.equal(resBeta.status, 200);
    const dataBeta = await resBeta.json();

    // Valida isolamento: Empresa Beta tem apenas seus R$ 250
    assert.equal(dataBeta.totalEntradas, 250);
    assert.equal(dataBeta.recentSales.length, 5);
  });
});
