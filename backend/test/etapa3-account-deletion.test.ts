import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import app from '../src/index';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

test('ETAPA 3 — FLUXO PERSISTENTE DE EXCLUSÃO DE CONTA E ADMINISTRAÇÃO', async (t) => {
  let server: any;
  let baseUrl: string;
  let testCompanyId: string;
  let operatorId: string;
  let operatorToken: string;
  let adminId: string;
  let adminToken: string;

  await t.test('Setup: Inicializar servidor e criar empresa, admin e operador de teste', async () => {
    server = app.listen(0);
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    const company = await prisma.company.create({
      data: {
        name: `Test Deletion Company ${Date.now()}`,
        cnpj: `000000${Date.now().toString().slice(-8)}`,
      },
    });
    testCompanyId = company.id;

    const hashedPassword = await bcrypt.hash('secret123', 10);

    const admin = await prisma.user.create({
      data: {
        name: 'Admin Teste',
        email: `admin_${Date.now()}@test.com`,
        password: hashedPassword,
        role: 'ADMIN',
        active: true,
        companyId: testCompanyId,
      },
    });
    adminId = admin.id;
    adminToken = jwt.sign({ id: admin.id, role: admin.role, companyId: testCompanyId }, JWT_SECRET);

    const operator = await prisma.user.create({
      data: {
        name: 'Operador Para Deletar',
        email: `operator_${Date.now()}@test.com`,
        cpf: `cpf_${Date.now().toString().slice(-9)}`,
        phone: '11999999999',
        emergencyPhone: '11888888888',
        address: 'Rua de Teste, 123',
        password: hashedPassword,
        role: 'OPERATOR',
        active: true,
        companyId: testCompanyId,
        fcmToken: 'fcm_initial_token_123',
      },
    });
    operatorId = operator.id;
    operatorToken = jwt.sign({ id: operator.id, role: operator.role, companyId: testCompanyId }, JWT_SECRET);

    assert.ok(operatorToken);
    assert.ok(adminToken);
  });

  let deletionRequestId: string;

  await t.test('1. POST /api/users/me/request-deletion cria registro persistente e inativa operador', async () => {
    // Tentativa sem confirmação correta deve falhar com 400
    const resBad = await fetch(`${baseUrl}/api/users/me/request-deletion`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${operatorToken}`,
      },
      body: JSON.stringify({ confirmation: 'WRONG' }),
    });
    assert.equal(resBad.status, 400);

    // Tentativa válida com confirmation: 'DELETE_MY_ACCOUNT'
    const resOk = await fetch(`${baseUrl}/api/users/me/request-deletion`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${operatorToken}`,
      },
      body: JSON.stringify({
        confirmation: 'DELETE_MY_ACCOUNT',
        reason: 'Saída da empresa e término da prestação de serviços',
        acknowledgeUnsyncedData: true,
      }),
    });
    assert.equal(resOk.status, 200);
    const data = await resOk.json();

    assert.equal(data.success, true);
    assert.ok(data.request.id);
    assert.equal(data.request.status, 'PENDING_REVIEW');
    assert.ok(data.retentionNotice);
    assert.equal(data.retentionNotice.accessLogs.period, '6 meses');
    assert.equal(data.retentionNotice.taxAndCommercialRecords.period, '5 anos');

    deletionRequestId = data.request.id;

    // Verificar no banco de dados que a tabela AccountDeletionRequest foi populada
    const dbRequest = await prisma.accountDeletionRequest.findUnique({
      where: { id: deletionRequestId },
    });
    assert.ok(dbRequest);
    assert.equal(dbRequest.userId, operatorId);
    assert.equal(dbRequest.status, 'PENDING_REVIEW');

    // Verificar que o operador foi inativado e push token removido
    const dbUser = await prisma.user.findUnique({ where: { id: operatorId } });
    assert.equal(dbUser?.active, false);
    assert.equal(dbUser?.fcmToken, null);
  });

  await t.test('2. Idempotência: requisição repetida retorna o protocolo existente sem duplicar', async () => {
    const resRepeat = await fetch(`${baseUrl}/api/users/me/request-deletion`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${operatorToken}`,
      },
      body: JSON.stringify({
        confirmation: 'DELETE_MY_ACCOUNT',
      }),
    });
    assert.equal(resRepeat.status, 200);
    const dataRepeat = await resRepeat.json();

    assert.equal(dataRepeat.success, true);
    assert.equal(dataRepeat.alreadyRequested, true);
    assert.equal(dataRepeat.request.id, deletionRequestId);

    const count = await prisma.accountDeletionRequest.count({ where: { userId: operatorId } });
    assert.equal(count, 1, 'Não deve criar múltiplos registros para o mesmo usuário');
  });

  await t.test('3. Admin lista solicitações e executa anonimização real com preservação relacional', async () => {
    // Listar pedidos
    const resList = await fetch(`${baseUrl}/api/users/deletion-requests`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resList.status, 200);
    const dataList = await resList.json();
    assert.ok(dataList.requests.some((r: any) => r.id === deletionRequestId));

    // Executar anonimização efetiva
    const resProcess = await fetch(`${baseUrl}/api/users/deletion-requests/${deletionRequestId}/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ action: 'ANONYMIZE' }),
    });
    assert.equal(resProcess.status, 200);
    const dataProcess = await resProcess.json();
    assert.equal(dataProcess.status, 'APPROVED_ANONYMIZED');

    // Verificar que os dados sensíveis do operador foram efetivamente anonimizados
    const anonUser = await prisma.user.findUnique({ where: { id: operatorId } });
    assert.ok(anonUser);
    assert.ok(anonUser.name.startsWith('Operador Anonimizado'));
    assert.equal(anonUser.phone, null);
    assert.equal(anonUser.emergencyPhone, null);
    assert.equal(anonUser.address, null);
    assert.equal(anonUser.email, null);
    assert.ok(anonUser.password.startsWith('$2b$10$ANONYMIZED_'));

    // O registro na tabela AccountDeletionRequest deve estar finalizado
    const finalRequest = await prisma.accountDeletionRequest.findUnique({ where: { id: deletionRequestId } });
    assert.equal(finalRequest?.status, 'APPROVED_ANONYMIZED');
    assert.ok(finalRequest?.processedAt);
    assert.equal(finalRequest?.processedByUserId, adminId);
  });

  await t.test('Teardown: encerrar servidor e limpar dados de teste', async () => {
    server.close();
    await prisma.accountDeletionRequest.deleteMany({ where: { companyId: testCompanyId } });
    await prisma.notification.deleteMany({ where: { companyId: testCompanyId } });
    await prisma.user.deleteMany({ where: { companyId: testCompanyId } });
    await prisma.company.deleteMany({ where: { id: testCompanyId } });
    await prisma.$disconnect();
  });
});
