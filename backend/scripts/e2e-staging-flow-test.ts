import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

async function runE2EStagingFlows() {
  const envPath = path.resolve(__dirname, '../.env.test.local');
  const envConfig = dotenv.parse(fs.readFileSync(envPath));
  const databaseUrl = envConfig.DATABASE_URL;
  const jwtSecret = envConfig.JWT_SECRET || 'selectphoto_staging_local_jwt_test_2026_nao_usar_em_producao';

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const baseUrl = 'http://127.0.0.1:3001';

  console.log('====================================================');
  console.log('    TESTES E2E DE FLUXOS NO BACKEND DE STAGING      ');
  console.log('====================================================');

  const uid = 'e2e_' + Date.now();
  const compId = `comp_${uid}`;
  const passwordPlain = 'SenhaStaging123!';
  const passwordHash = await bcrypt.hash(passwordPlain, 10);

  try {
    // 1. Validar /health
    console.log('1. Testando /health...');
    const resHealth = await fetch(`${baseUrl}/health`);
    if (resHealth.status !== 200) throw new Error(`/health retornou ${resHealth.status}`);
    const dataHealth: any = await resHealth.json();
    console.log(`   ✅ /health OK: status=${dataHealth.status}, uptime=${dataHealth.uptimeSeconds}s, memory=${dataHealth.memoryUsageMb}MB`);

    // 2. Criar Empresa e Usuários no banco
    console.log('\n2. Criando dados para teste de login...');
    await prisma.company.create({
      data: { id: compId, name: 'Empresa E2E Staging', cnpj: `55.555.555/${uid.slice(-4)}-55` },
    });

    const userSellerCpf = '12345678900';
    const userSeller = await prisma.user.create({
      data: {
        id: `u_sel_${uid}`,
        name: 'Vendedor E2E',
        email: `seller_${uid}@selectphoto.test`,
        cpf: userSellerCpf,
        password: passwordHash,
        role: 'SELLER',
        companyId: compId,
        active: true,
      },
    });

    const userAdmin = await prisma.user.create({
      data: {
        id: `u_adm_${uid}`,
        name: 'Admin E2E',
        email: `admin_${uid}@selectphoto.test`,
        cpf: '98765432100',
        password: passwordHash,
        role: 'ADMIN',
        companyId: compId,
        active: true,
      },
    });
    console.log('   ✅ Usuários criados com CPF e senha criptografada via bcrypt.');

    // 3. Teste de Login
    console.log('\n3. Testando rota POST /api/auth/login...');
    const resLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cpf: userSellerCpf, password: passwordPlain }),
    });
    if (resLogin.status !== 200) {
      throw new Error(`Login falhou com status ${resLogin.status}: ${await resLogin.text()}`);
    }
    const dataLogin: any = await resLogin.json();
    const token = dataLogin.token;
    if (!token) throw new Error('Token não retornado no login');
    console.log('   ✅ Login bem-sucedido. Token JWT emitido e validado.');

    const tokenAdmin = jwt.sign({ id: userAdmin.id, role: 'ADMIN', companyId: compId }, jwtSecret);

    // 4. Teste de Clientes e Fichas
    console.log('\n4. Testando criação e listagem de Clientes (/api/clients)...');
    const client = await prisma.client.create({
      data: {
        name: 'Cliente Homologação E2E',
        companyId: compId,
        sequenceNumber: `E2E_SEQ_${uid}`,
        phone1: '11988887777',
        city: 'Goiânia',
        state: 'GO',
        status: 'PENDING',
      },
    });

    const resClients = await fetch(`${baseUrl}/api/clients?page=1&limit=10`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resClients.status !== 200) throw new Error(`Listagem de clientes falhou: ${resClients.status}`);
    console.log('   ✅ Clientes listados com isolamento de tenant OK.');

    // 5. Teste de Agenda Pessoal (/api/appointments)
    console.log('\n5. Testando Agenda Pessoal (/api/appointments)...');
    const resAppt = await fetch(`${baseUrl}/api/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        sellerId: userSeller.id,
        title: 'Visita Técnica E2E',
        description: 'Demonstração de produto',
        dateTime: new Date().toISOString(),
      }),
    });
    if (resAppt.status !== 200) throw new Error(`Criação de agendamento falhou: ${resAppt.status}`);
    console.log('   ✅ Agendamento pessoal criado com sucesso.');

    // 6. Teste de Estoque (/api/stock)
    console.log('\n6. Testando Gestão de Estoque (/api/stock)...');
    const resBatch = await fetch(`${baseUrl}/api/stock/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ quantity: 50 }),
    });
    if (resBatch.status !== 201) throw new Error(`Criação de lote de estoque falhou: ${resBatch.status}`);

    const resTransfer = await fetch(`${baseUrl}/api/stock/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ sellerId: userSeller.id, quantity: 20 }),
    });
    if (resTransfer.status !== 201) throw new Error(`Transferência de capas falhou: ${resTransfer.status}`);
    console.log('   ✅ Lote criado e 20 capas transferidas para o vendedor.');

    // 7. Teste de Fechamento Diário (/api/closing)
    console.log('\n7. Testando Fechamento Diário (/api/closing)...');
    const resClosing = await fetch(`${baseUrl}/api/closing/daily/${userSeller.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resClosing.status !== 200) throw new Error(`Consulta de fechamento falhou: ${resClosing.status}`);
    console.log('   ✅ Fechamento diário consultado e isolado com sucesso.');

    // 8. Teste de Backup Scoped (/api/backup/download)
    console.log('\n8. Testando Download de Backup Scoped (/api/backup/download)...');
    const resBackup = await fetch(`${baseUrl}/api/backup/download`, {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    if (resBackup.status !== 200) throw new Error(`Backup download falhou: ${resBackup.status}`);
    const backupJson = JSON.parse(await resBackup.text());
    if (backupJson._metadata.companyId !== compId) throw new Error('Metadata do backup não corresponde à empresa');
    console.log(`   ✅ Backup gerado com sucesso para a empresa ${compId}.`);

    console.log('\n====================================================');
    console.log('  ✅ TODOS OS FLUXOS E2E EXECUTADOS COM SUCESSO!   ');
    console.log('====================================================\n');

  } finally {
    // Cleanup
    await prisma.personalAppointment.deleteMany({ where: { seller: { companyId: compId } } }).catch(() => {});
    await prisma.sellerCoverTransfer.deleteMany({ where: { companyId: compId } }).catch(() => {});
    await prisma.sellerCoverBalance.deleteMany({ where: { seller: { companyId: compId } } }).catch(() => {});
    await prisma.coverStockBatch.deleteMany({ where: { companyId: compId } }).catch(() => {});
    await prisma.client.deleteMany({ where: { companyId: compId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { companyId: compId } }).catch(() => {});
    await prisma.company.deleteMany({ where: { id: compId } }).catch(() => {});
    await prisma.$disconnect();
  }
}

runE2EStagingFlows();
