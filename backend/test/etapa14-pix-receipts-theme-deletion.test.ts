import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { prisma, disconnectPrisma } from '../src/services/prisma';
import closingRoutes from '../src/routes/closing';
import userRoutes from '../src/routes/users';

const jwtSecret = 'test_jwt_secret_for_etapa14_suite_123456';
process.env.JWT_SECRET = jwtSecret;

const app = express();
app.use(express.json());
app.use('/api/closing', closingRoutes);
app.use('/api/users', userRoutes);

const server = app.listen(0, '127.0.0.1');
const getBaseUrl = new Promise<string>((resolve) => {
  server.once('listening', () => {
    const port = (server.address() as AddressInfo).port;
    resolve(`http://127.0.0.1:${port}`);
  });
});

const createdCompanyIds: string[] = [];
const createdUserIds: string[] = [];
const createdBatchIds: string[] = [];
const createdClientIds: string[] = [];
const createdSaleIds: string[] = [];

function makeToken(user: {
  id: string;
  role: string;
  companyId: string;
  name: string;
  sessionId?: string;
}) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      companyId: user.companyId,
      name: user.name,
      sessionId: user.sessionId || `sess-${user.id}`,
    },
    jwtSecret,
    { expiresIn: '1h' }
  );
}

async function apiJson(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; body?: any } = {}
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  if (createdSaleIds.length > 0) {
    await prisma.creditInstallment.deleteMany({
      where: { agreement: { saleId: { in: createdSaleIds } } },
    });
    await prisma.creditAgreement.deleteMany({
      where: { saleId: { in: createdSaleIds } },
    });
    await prisma.sale.deleteMany({
      where: { id: { in: createdSaleIds } },
    });
  }

  if (createdClientIds.length > 0) {
    await prisma.clientTimeline.deleteMany({
      where: { clientId: { in: createdClientIds } },
    });
    await prisma.client.deleteMany({
      where: { id: { in: createdClientIds } },
    });
  }

  if (createdBatchIds.length > 0) {
    await prisma.bookBatch.deleteMany({
      where: { id: { in: createdBatchIds } },
    });
  }

  if (createdUserIds.length > 0) {
    await prisma.accountDeletionRequest.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
  }

  if (createdCompanyIds.length > 0) {
    await prisma.operationalAuditEvent.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
  }

  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({
      where: { id: { in: createdUserIds } },
    });
  }

  if (createdCompanyIds.length > 0) {
    await prisma.company.deleteMany({
      where: { id: { in: createdCompanyIds } },
    });
  }

  await disconnectPrisma();
});

test('Etapa 14 — Pix direcional no fechamento, legenda Lote/Ficha e exclusão segura de conta', async (t) => {
  const baseUrl = await getBaseUrl;
  const suffix = randomUUID().slice(0, 8);

  const comp = await prisma.company.create({
    data: {
      id: `comp-e14-${suffix}`,
      name: `Empresa E14 ${suffix}`,
      tradeName: 'Hyper Fotos E14',
    },
  });
  createdCompanyIds.push(comp.id);

  const passwordHash = await bcrypt.hash('SenhaForte14!', 10);

  const admin = await prisma.user.create({
    data: {
      id: `adm-e14-${suffix}`,
      name: 'Admin E14',
      cpf: `81011122${suffix.slice(0, 3)}`,
      password: passwordHash,
      role: 'ADMIN',
      companyId: comp.id,
      active: true,
      activeSessionId: `sess-adm-${suffix}`,
    },
  });

  // Vendedor 1: venderá em dinheiro (deve repassar à empresa -> exibe Pix da Empresa)
  const sellerOwes = await prisma.user.create({
    data: {
      id: `sel1-e14-${suffix}`,
      name: 'Vendedor Dinheiro',
      cpf: `81022233${suffix.slice(0, 3)}`,
      email: `sel1_${suffix}@lumora.test`,
      password: passwordHash,
      role: 'SELLER',
      companyId: comp.id,
      active: true,
      pixKey: `seller1-pix-${suffix}@pix.local`,
      activeSessionId: `sess-sel1-${suffix}`,
    },
  });

  // Vendedor 2: venderá via Pix/Cartão (empresa deve pagar comissão -> exibe Pix do Vendedor 2)
  const sellerReceives = await prisma.user.create({
    data: {
      id: `sel2-e14-${suffix}`,
      name: 'Vendedor Pix Comissao',
      cpf: `81033344${suffix.slice(0, 3)}`,
      password: passwordHash,
      role: 'SELLER',
      companyId: comp.id,
      active: true,
      pixKey: `chave-pix-vendedor2-${suffix}@banco.com`,
      activeSessionId: `sess-sel2-${suffix}`,
    },
  });

  const photographer = await prisma.user.create({
    data: {
      id: `fot-e14-${suffix}`,
      name: 'Fotografo E14',
      cpf: `81044455${suffix.slice(0, 3)}`,
      password: passwordHash,
      role: 'PHOTOGRAPHER',
      companyId: comp.id,
      active: true,
      activeSessionId: `sess-fot-${suffix}`,
    },
  });

  createdUserIds.push(admin.id, sellerOwes.id, sellerReceives.id, photographer.id);

  const tokenAdmin = makeToken({
    id: admin.id,
    role: admin.role,
    companyId: comp.id,
    name: admin.name,
    sessionId: `sess-adm-${suffix}`,
  });
  const tokenSeller1 = makeToken({
    id: sellerOwes.id,
    role: sellerOwes.role,
    companyId: comp.id,
    name: sellerOwes.name,
    sessionId: `sess-sel1-${suffix}`,
  });

  const batch = await prisma.bookBatch.create({
    data: {
      id: `batch-e14-${suffix}`,
      name: `Lote Campinas ${suffix}`,
      city: 'Campinas',
      photographerId: photographer.id,
      companyId: comp.id,
      status: 'DISTRIBUTED',
      totalProduced: 2,
    },
  });
  createdBatchIds.push(batch.id);

  const clientCash = await prisma.client.create({
    data: {
      id: `cli1-e14-${suffix}`,
      sequenceNumber: `SEQ1-${suffix}`,
      visibleCode: `FCH-${suffix}-1`,
      name: 'Comprador Dinheiro',
      city: 'Campinas',
      companyId: comp.id,
      photographerId: photographer.id,
      assignedSellerId: sellerOwes.id,
      batchId: batch.id,
      bookStatus: 'SOLD',
      outcomeStatus: 'SOLD',
    },
  });
  const clientPix = await prisma.client.create({
    data: {
      id: `cli2-e14-${suffix}`,
      sequenceNumber: `SEQ2-${suffix}`,
      visibleCode: `FCH-${suffix}-2`,
      name: 'Comprador Cartao',
      city: 'Campinas',
      companyId: comp.id,
      photographerId: photographer.id,
      assignedSellerId: sellerReceives.id,
      batchId: batch.id,
      bookStatus: 'SOLD',
      outcomeStatus: 'SOLD',
    },
  });
  createdClientIds.push(clientCash.id, clientPix.id);

  const today = new Date();
  const dateParam = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const saleCash = await prisma.sale.create({
    data: {
      id: `sale1-e14-${suffix}`,
      value: 1000,
      city: 'Campinas',
      date: today,
      sellerId: sellerOwes.id,
      clientId: clientCash.id,
      companyId: comp.id,
      paymentMethod: 'CASH',
      fichaNumber: clientCash.visibleCode,
      receiptUrl: `/uploads/comprovante_cash_${suffix}.jpg`,
    },
  });

  const saleCard = await prisma.sale.create({
    data: {
      id: `sale2-e14-${suffix}`,
      value: 1000,
      city: 'Campinas',
      date: today,
      sellerId: sellerReceives.id,
      clientId: clientPix.id,
      companyId: comp.id,
      paymentMethod: 'CREDIT_CARD',
      fichaNumber: clientPix.visibleCode,
      receiptUrl: `/uploads/comprovante_card_${suffix}.jpg`,
    },
  });
  createdSaleIds.push(saleCash.id, saleCard.id);

  await t.test('1. Cadastro e edição do Pix da Empresa com auditoria e bloqueio para não-Admin', async () => {
    const initialGet = await apiJson(baseUrl, '/api/closing/company-pix', {
      token: tokenAdmin,
    });
    assert.equal(initialGet.status, 200);
    assert.equal(initialGet.json.companyPixKey, '');

    // Seller não pode alterar Pix da Empresa
    const forbiddenSeller = await apiJson(baseUrl, '/api/closing/company-pix', {
      method: 'PATCH',
      token: tokenSeller1,
      body: { companyPixKey: 'hack@pix.com', companyPixKeyType: 'EMAIL' },
    });
    assert.equal(forbiddenSeller.status, 403);

    // Tipo inválido retorna 400
    const badType = await apiJson(baseUrl, '/api/closing/company-pix', {
      method: 'PATCH',
      token: tokenAdmin,
      body: { companyPixKey: '12345678000199', companyPixKeyType: 'BITCOIN' },
    });
    assert.equal(badType.status, 400);

    // Admin salva Pix CNPJ da Empresa
    const saveRes = await apiJson(baseUrl, '/api/closing/company-pix', {
      method: 'PATCH',
      token: tokenAdmin,
      body: {
        companyPixKey: '12.345.678/0001-99',
        companyPixKeyType: 'CNPJ',
        reason: 'Cadastro inicial Pix financeiro empresa',
      },
    });
    assert.equal(saveRes.status, 200);
    assert.equal(saveRes.json.companyPixKey, '12.345.678/0001-99');
    assert.equal(saveRes.json.companyPixKeyType, 'CNPJ');

    const audit = await prisma.operationalAuditEvent.findFirst({
      where: { companyId: comp.id, action: 'COMPANY_PIX_KEY_UPDATED' },
    });
    assert.ok(audit);
  });

  await t.test('2. Pix direcional no fechamento e legenda Lote/Ficha nos comprovantes', async () => {
    // Vendedor 1 (SELLER_PAYS_COMPANY): deve retornar Pix da Empresa, nunca do vendedor
    const closing1 = await apiJson(
      baseUrl,
      `/api/closing/daily/${sellerOwes.id}?date=${dateParam}`,
      { token: tokenAdmin }
    );
    assert.equal(closing1.status, 200);
    assert.equal(closing1.json.finalDirection, 'SELLER_PAYS_COMPANY');
    assert.equal(closing1.json.companyPixKey, '12.345.678/0001-99');
    assert.equal(closing1.json.companyPixKeyType, 'CNPJ');
    assert.equal(closing1.json.directionalPix.recipient, 'COMPANY');
    assert.equal(closing1.json.directionalPix.pixKey, '12.345.678/0001-99');
    assert.notEqual(closing1.json.directionalPix.pixKey, sellerOwes.pixKey);

    // Legenda de Lote / Ficha presente nos comprovantes retornados
    assert.equal(closing1.json.sales.length, 1);
    const receiptSale = closing1.json.sales[0];
    assert.equal(receiptSale.loteName, batch.name);
    assert.equal(receiptSale.client.batch.name, batch.name);
    assert.equal(receiptSale.fichaLabel, clientCash.visibleCode);
    assert.equal(receiptSale.clientName, clientCash.name);

    // Vendedor 2 (COMPANY_PAYS_SELLER): deve retornar Pix do Vendedor 2, nunca da empresa
    const closing2 = await apiJson(
      baseUrl,
      `/api/closing/daily/${sellerReceives.id}?date=${dateParam}`,
      { token: tokenAdmin }
    );
    assert.equal(closing2.status, 200);
    assert.equal(closing2.json.finalDirection, 'COMPANY_PAYS_SELLER');
    assert.equal(closing2.json.sellerPixKey, sellerReceives.pixKey);
    assert.equal(closing2.json.directionalPix.recipient, 'SELLER');
    assert.equal(closing2.json.directionalPix.pixKey, sellerReceives.pixKey);
    assert.notEqual(closing2.json.directionalPix.pixKey, '12.345.678/0001-99');
  });

  await t.test('3. Exclusão segura de conta exige senha, revoga sessão e preserva vendas/registros', async () => {
    // Sem senha -> 400
    const noPass = await apiJson(baseUrl, '/api/users/me/delete-account', {
      method: 'POST',
      token: tokenSeller1,
      body: {},
    });
    assert.equal(noPass.status, 400);

    // Senha errada -> 401
    const wrongPass = await apiJson(baseUrl, '/api/users/me/delete-account', {
      method: 'POST',
      token: tokenSeller1,
      body: { currentPassword: 'SenhaErrada999!' },
    });
    assert.equal(wrongPass.status, 401);

    // Senha correta -> 200, inativa, revoga activeSessionId e anonimiza
    const okDelete = await apiJson(baseUrl, '/api/users/me/delete-account', {
      method: 'POST',
      token: tokenSeller1,
      body: {
        currentPassword: 'SenhaForte14!',
        reason: 'Desligamento confirmado pelo usuário',
      },
    });
    assert.equal(okDelete.status, 200);
    assert.equal(okDelete.json.deleted, true);
    assert.equal(okDelete.json.sessionRevoked, true);
    assert.equal(okDelete.json.anonymized, true);
    assert.equal(okDelete.json.preservedFiscalAndFinancialRecords, true);

    // Token antigo imediatamente bloqueado no authMiddleware
    const reuseToken = await apiJson(baseUrl, '/api/closing/company-pix', {
      token: tokenSeller1,
    });
    assert.ok(reuseToken.status === 401 || reuseToken.status === 403);

    const dbUser = await prisma.user.findUnique({ where: { id: sellerOwes.id } });
    assert.ok(dbUser);
    assert.equal(dbUser.active, false);
    assert.equal(dbUser.activeSessionId, null);
    assert.equal(dbUser.email, null);
    assert.equal(dbUser.pixKey, null);
    assert.ok(dbUser.passwordResetAt !== null);

    // Registros financeiros obrigatórios da empresa preservados
    const preservedSale = await prisma.sale.findUnique({ where: { id: saleCash.id } });
    assert.ok(preservedSale);
    assert.equal(preservedSale.sellerId, sellerOwes.id);
    assert.equal(preservedSale.value, 1000);

    const audit = await prisma.operationalAuditEvent.findFirst({
      where: { companyId: comp.id, action: 'USER_ACCOUNT_DELETED_SELF', entityId: sellerOwes.id },
    });
    assert.ok(audit);
  });
});
