import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { prisma, disconnectPrisma } from '../src/services/prisma';
import usersRoutes from '../src/routes/users';
import superadminRoutes from '../src/routes/superadmin';
import salesRoutes from '../src/routes/sales';
import closingRoutes from '../src/routes/closing';
import creditRoutes from '../src/routes/credit';
import companyOperationalConfigRoutes from '../src/routes/companyOperationalConfig';
import { getCompanyAsaasConfig } from '../src/services/asaasService';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'lumora_etapa34c_test_jwt_secret_11223344';
process.env.INTEGRATION_MASTER_KEY =
  process.env.INTEGRATION_MASTER_KEY ||
  'lumora_disposable_master_key_64hex_0123456789abcdef0123456789abcd';
process.env.EXTERNAL_SERVICES_DISABLED = 'true';

const app = express();
app.use(express.json());
app.use('/api/users', usersRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/closing', closingRoutes);
app.use('/api/credit', creditRoutes);
app.use('/api/company', companyOperationalConfigRoutes);

const server = app.listen(0, '127.0.0.1');
const getBaseUrl = new Promise<string>((resolve) => {
  server.once('listening', () => {
    const port = (server.address() as AddressInfo).port;
    resolve(`http://127.0.0.1:${port}`);
  });
});

const createdCompanyIds: string[] = [];
const createdUserIds: string[] = [];
const createdClientIds: string[] = [];
const createdBatchIds: string[] = [];
const createdSaleIds: string[] = [];

function signUserToken(user: {
  id: string;
  role: string;
  companyId: string | null;
  name: string;
}) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      companyId: user.companyId,
      name: user.name,
    },
    process.env.JWT_SECRET!,
    { expiresIn: '2h' }
  );
}

async function apiJson(
  baseUrl: string,
  urlPath: string,
  options: { method?: string; token?: string; body?: any } = {}
) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
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

  if (createdCompanyIds.length > 0) {
    await prisma.asaasConfig.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.companyIntegration.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.operationalAuditEvent.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.creditCommission.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.creditPaymentAllocation.deleteMany({
      where: { payment: { companyId: { in: createdCompanyIds } } },
    });
    await prisma.creditPayment.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.creditInstallment.deleteMany({
      where: { agreement: { companyId: { in: createdCompanyIds } } },
    });
    await prisma.creditAgreement.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.saleAdjustment.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.salePayment.deleteMany({ where: { sale: { companyId: { in: createdCompanyIds } } } });
    await prisma.sale.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.dailyClosing.deleteMany({ where: { sellerId: { in: createdUserIds } } });
    await prisma.clientTimeline.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.bookBatch.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.companyOperationalConfig.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  }

  await disconnectPrisma();
});

test('Etapa 34C: Matriz Oficial 20/25/40/50 + 10% Caixa Real, Perfil Vendedor, Exceção, Snapshot Imutável e Selo SANDBOX', async () => {
  const baseUrl = await getBaseUrl;
  const suffix = randomUUID().slice(0, 8);
  const passwordHash = await bcrypt.hash('Lumora34cTest!', 4);

  const company = await prisma.company.create({
    data: {
      name: `Empresa E34C ${suffix}`,
      tradeName: `Foto E34C ${suffix}`,
      status: 'ACTIVE',
      classification: 'TEST_DEMO',
      isActive: true,
    },
  });
  createdCompanyIds.push(company.id);

  const superAdmin = await prisma.user.create({
    data: {
      name: 'SuperAdmin E34C',
      email: `sa.e34c.${suffix}@lumora.test`,
      cpf: `901${Date.now().toString().slice(-8)}`,
      password: passwordHash,
      role: 'SUPER_ADMIN',
      companyId: null,
    },
  });
  createdUserIds.push(superAdmin.id);

  const admin = await prisma.user.create({
    data: {
      name: 'Admin E34C',
      email: `admin.e34c.${suffix}@lumora.test`,
      cpf: `801${Date.now().toString().slice(-8)}`,
      password: passwordHash,
      role: 'ADMIN',
      companyId: company.id,
    },
  });
  createdUserIds.push(admin.id);

  const photo = await prisma.user.create({
    data: {
      name: 'Fotografo E34C',
      email: `photo.e34c.${suffix}@lumora.test`,
      cpf: `701${Date.now().toString().slice(-8)}`,
      password: passwordHash,
      role: 'PHOTOGRAPHER',
      companyId: company.id,
    },
  });
  createdUserIds.push(photo.id);

  const saToken = signUserToken(superAdmin);
  const adminToken = signUserToken(admin);

  // 1. Verificar default oficial da empresa (20 / 25 / 40 / 50 + 10)
  const cfgDefault = await apiJson(baseUrl, '/api/company/operational-config', {
    token: adminToken,
  });
  assert.equal(cfgDefault.status, 200);
  assert.equal(cfgDefault.json.virginCompanyCarCommissionPercent, 20);
  assert.equal(cfgDefault.json.virginOwnCarCommissionPercent, 25);
  assert.equal(cfgDefault.json.reboloCompanyCarCommissionPercent, 40);
  assert.equal(cfgDefault.json.reboloOwnCarCommissionPercent, 50);
  assert.equal(cfgDefault.json.creditInstallmentCommissionPercent, 10);

  // 2. Cadastrar 2 vendedores via API com sellerVehicleType e sellerBookProfile
  const createSellerCompanyRes = await apiJson(baseUrl, '/api/users', {
    method: 'POST',
    token: adminToken,
    body: {
      name: 'Vendedor Carro Empresa E34C',
      cpf: `601${Date.now().toString().slice(-8)}`,
      password: 'User123!',
      role: 'SELLER',
      sellerVehicleType: 'COMPANY_CAR',
      sellerBookProfile: 'BOTH',
    },
  });
  assert.equal(createSellerCompanyRes.status, 201);
  assert.equal(createSellerCompanyRes.json.usesOwnCar, false);
  assert.equal(createSellerCompanyRes.json.sellerVehicleType, 'COMPANY_CAR');
  assert.equal(createSellerCompanyRes.json.sellerBookProfile, 'BOTH');
  createdUserIds.push(createSellerCompanyRes.json.id);

  const createSellerOwnRes = await apiJson(baseUrl, '/api/users', {
    method: 'POST',
    token: adminToken,
    body: {
      name: 'Vendedor Carro Proprio E34C',
      cpf: `602${Date.now().toString().slice(-8)}`,
      password: 'User123!',
      role: 'SELLER',
      sellerVehicleType: 'OWN_CAR',
      sellerBookProfile: 'REBOLO',
    },
  });
  assert.equal(createSellerOwnRes.status, 201);
  assert.equal(createSellerOwnRes.json.usesOwnCar, true);
  assert.equal(createSellerOwnRes.json.sellerVehicleType, 'OWN_CAR');
  assert.equal(createSellerOwnRes.json.sellerBookProfile, 'REBOLO');
  createdUserIds.push(createSellerOwnRes.json.id);

  const sellerCompanyToken = signUserToken({
    id: createSellerCompanyRes.json.id,
    role: 'SELLER',
    companyId: company.id,
    name: 'Vendedor Carro Empresa E34C',
  });
  const sellerOwnToken = signUserToken({
    id: createSellerOwnRes.json.id,
    role: 'SELLER',
    companyId: company.id,
    name: 'Vendedor Carro Proprio E34C',
  });

  // 3. Testar as 4 combinações padrão (20% / 25% / 40% / 50%) + 0% sobre saldo financiado
  const batch = await prisma.bookBatch.create({
    data: {
      name: `Lote E34C ${suffix}`,
      city: 'Goiânia',
      totalProduced: 10,
      companyId: company.id,
      photographerId: photo.id,
    },
  });
  createdBatchIds.push(batch.id);

  const makeClient = async (sellerId: string, bookStatus: string, code: string) => {
    const c = await prisma.client.create({
      data: {
        name: `Cliente ${code}`,
        city: 'Goiânia',
        street: 'Rua 1',
        number: '10',
        neighborhood: 'Centro',
        phone1: '62999990000',
        companyId: company.id,
        assignedSellerId: sellerId,
        batchId: batch.id,
        bookStatus,
        visibleCode: `${code}-${suffix}`,
        sequenceNumber: `${code}-${suffix}`,
      },
    });
    createdClientIds.push(c.id);
    return c;
  };

  // A) Virgem + Carro Empresa -> 20%
  const cVC = await makeClient(createSellerCompanyRes.json.id, 'DISTRIBUTED', 'VC');
  const saleVC = await apiJson(baseUrl, '/api/sales', {
    method: 'POST',
    token: sellerCompanyToken,
    body: {
      clientId: cVC.id,
      city: 'Goiânia',
      value: 1000,
      paymentMethod: 'PIX',
      payments: [{ method: 'PIX', amount: 200 }],
      receiptUrl: '/uploads/vc.jpg',
      credit: {
        buyerCpf: '52998224725',
        downPayment: 200,
        installmentsCount: 4,
        periodicity: 'MONTHLY',
        street: 'Rua 1',
        number: '10',
        neighborhood: 'Centro',
        city: 'Goiânia',
      },
    },
  });
  assert.equal(saleVC.status, 201);
  assert.equal(saleVC.json.appliedCommissionPercent, 20);
  createdSaleIds.push(saleVC.json.id);

  const agrVC = await prisma.creditAgreement.findUniqueOrThrow({
    where: { saleId: saleVC.json.id },
    include: { commissions: true },
  });
  assert.equal(agrVC.initialCommissionRate, 0.2);
  assert.equal(agrVC.installmentCommissionRate, 0.1);
  // Caixa Real: R$ 200 entrada -> R$ 40 (4000 cents). ZERO comissão sobre R$ 800 financiado!
  assert.equal(agrVC.commissions.length, 1);
  assert.equal(agrVC.commissions[0].type, 'DOWN_PAYMENT');
  assert.equal(agrVC.commissions[0].amountCents, 4000);

  // Pagar 1 parcela de R$ 200 -> 10% = R$ 20 (2000 cents)
  const payInst = await apiJson(baseUrl, `/api/credit/agreements/${agrVC.id}/payments`, {
    method: 'POST',
    token: adminToken,
    body: {
      amount: 200,
      paymentMethod: 'PIX',
      destination: 'COMPANY_ACCOUNT',
      idempotencyKey: `e34c-inst-${suffix}`,
    },
  });
  assert.equal(payInst.status, 201);
  const instComm = await prisma.creditCommission.findFirst({
    where: { agreementId: agrVC.id, type: 'INSTALLMENT' },
  });
  assert.ok(instComm);
  assert.equal(instComm.amountCents, 2000);

  // B) Rebolo + Carro Empresa -> 40%
  const cRC = await makeClient(createSellerCompanyRes.json.id, 'DISTRIBUTED_REBOLO', 'RC');
  const saleRC = await apiJson(baseUrl, '/api/sales', {
    method: 'POST',
    token: sellerCompanyToken,
    body: {
      clientId: cRC.id,
      city: 'Goiânia',
      value: 200,
      paymentMethod: 'CASH',
      receiptUrl: '/uploads/rc.jpg',
    },
  });
  assert.equal(saleRC.status, 201);
  assert.equal(saleRC.json.appliedCommissionPercent, 40);
  createdSaleIds.push(saleRC.json.id);

  // C) Rebolo + Carro Próprio -> 50% (sellerOwn tem sellerBookProfile: 'REBOLO' e client DISTRIBUTED)
  const cRO = await makeClient(createSellerOwnRes.json.id, 'DISTRIBUTED', 'RO');
  const saleRO = await apiJson(baseUrl, '/api/sales', {
    method: 'POST',
    token: sellerOwnToken,
    body: {
      clientId: cRO.id,
      city: 'Goiânia',
      value: 200,
      paymentMethod: 'PIX',
      receiptUrl: '/uploads/ro.jpg',
    },
  });
  assert.equal(saleRO.status, 201);
  assert.equal(saleRO.json.appliedCommissionPercent, 50);
  createdSaleIds.push(saleRO.json.id);

  // D) Alterar vendedor carro próprio para BOTH via PUT /api/users/:id -> Virgem + Carro Próprio -> 25%
  const editSellerOwn = await apiJson(baseUrl, `/api/users/${createSellerOwnRes.json.id}`, {
    method: 'PUT',
    token: adminToken,
    body: {
      name: 'Vendedor Carro Proprio E34C',
      role: 'SELLER',
      sellerVehicleType: 'OWN_CAR',
      sellerBookProfile: 'BOTH',
    },
  });
  assert.equal(editSellerOwn.status, 200);
  assert.equal(editSellerOwn.json.sellerBookProfile, 'BOTH');
  assert.equal(editSellerOwn.json.usesOwnCar, true);

  const cVO = await makeClient(createSellerOwnRes.json.id, 'DISTRIBUTED', 'VO');
  const saleVO = await apiJson(baseUrl, '/api/sales', {
    method: 'POST',
    token: sellerOwnToken,
    body: {
      clientId: cVO.id,
      city: 'Goiânia',
      value: 200,
      paymentMethod: 'PIX',
      receiptUrl: '/uploads/vo.jpg',
    },
  });
  assert.equal(saleVO.status, 201);
  assert.equal(saleVO.json.appliedCommissionPercent, 25);
  createdSaleIds.push(saleVO.json.id);

  // 4. Editar a matriz da empresa via SuperAdmin -> 22 / 28 / 44 / 55 / 12
  const updateMatrix = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${company.id}/operational-config`,
    {
      method: 'PUT',
      token: saToken,
      body: {
        virginCompanyCarCommissionPercent: 22,
        virginOwnCarCommissionPercent: 28,
        reboloCompanyCarCommissionPercent: 44,
        reboloOwnCarCommissionPercent: 55,
        creditInstallmentCommissionPercent: 12,
      },
    }
  );
  assert.equal(updateMatrix.status, 200);
  assert.equal(updateMatrix.json.virginCompanyCarCommissionPercent, 22);
  assert.equal(updateMatrix.json.virginOwnCarCommissionPercent, 28);
  assert.equal(updateMatrix.json.reboloCompanyCarCommissionPercent, 44);
  assert.equal(updateMatrix.json.reboloOwnCarCommissionPercent, 55);
  assert.equal(updateMatrix.json.creditInstallmentCommissionPercent, 12);

  // Nova venda Rebolo + Carro Próprio -> 55% (enquanto venda anterior RO preserva snapshot 50%)
  const cRO2 = await makeClient(createSellerOwnRes.json.id, 'DISTRIBUTED_REBOLO', 'RO2');
  const saleRO2 = await apiJson(baseUrl, '/api/sales', {
    method: 'POST',
    token: sellerOwnToken,
    body: {
      clientId: cRO2.id,
      city: 'Goiânia',
      value: 200,
      paymentMethod: 'PIX',
      receiptUrl: '/uploads/ro2.jpg',
    },
  });
  assert.equal(saleRO2.status, 201);
  assert.equal(saleRO2.json.appliedCommissionPercent, 55);
  createdSaleIds.push(saleRO2.json.id);

  // Exceção individual do vendedor vence a matriz da empresa -> 60% Rebolo
  const setOverride = await apiJson(
    baseUrl,
    `/api/company/operational-config/seller-overrides/${createSellerOwnRes.json.id}`,
    {
      method: 'PUT',
      token: adminToken,
      body: { customReboloCommissionPercent: 60 },
    }
  );
  assert.equal(setOverride.status, 200);

  const cRO3 = await makeClient(createSellerOwnRes.json.id, 'DISTRIBUTED_REBOLO', 'RO3');
  const saleRO3 = await apiJson(baseUrl, '/api/sales', {
    method: 'POST',
    token: sellerOwnToken,
    body: {
      clientId: cRO3.id,
      city: 'Goiânia',
      value: 200,
      paymentMethod: 'PIX',
      receiptUrl: '/uploads/ro3.jpg',
    },
  });
  assert.equal(saleRO3.status, 201);
  assert.equal(saleRO3.json.appliedCommissionPercent, 60);
  createdSaleIds.push(saleRO3.json.id);

  // Fechamento diário de sellerOwn preserva snapshots históricos: RO (50%=100) + VO (25%=50) + RO2 (55%=110) + RO3 (60%=120) = 380!
  const todayBr = new Date(Date.now() - 3 * 3600 * 1000).toISOString().split('T')[0];
  const closingOwn = await apiJson(
    baseUrl,
    `/api/closing/daily/${createSellerOwnRes.json.id}?date=${todayBr}`,
    { token: adminToken }
  );
  assert.equal(closingOwn.status, 200);
  assert.equal(closingOwn.json.commissionBreakdown.aVistaCommission, 380);

  // 5. Confirmar que salvar Asaas Sandbox pelo fluxo unificado do SuperAdmin grava operationalFinancialMode: 'SANDBOX'
  const saveAsaasSa = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${company.id}/integrations/asaas`,
    {
      method: 'PUT',
      token: saToken,
      body: {
        environment: 'SANDBOX',
        apiKey: '$aact_hmlg_etapa34c_sandbox_key_9999',
        webhookToken: 'wh_etapa34c_secret',
        accountName: 'Sandbox E34C',
      },
    }
  );
  assert.equal(saveAsaasSa.status, 200);

  const integRow = await prisma.companyIntegration.findUniqueOrThrow({
    where: {
      companyId_category_environment: {
        companyId: company.id,
        category: 'PAYMENT_GATEWAY',
        environment: 'SANDBOX',
      },
    },
  });
  assert.equal((integRow.configMetadata as any)?.operationalFinancialMode, 'SANDBOX');

  const asaasCfg = await getCompanyAsaasConfig(company.id);
  assert.equal(asaasCfg.mode, 'SANDBOX');

  const asaasStatusRes = await apiJson(baseUrl, '/api/credit/asaas/config', {
    token: adminToken,
  });
  assert.equal(asaasStatusRes.status, 200);
  assert.equal(asaasStatusRes.json.mode, 'SANDBOX');
  assert.equal(asaasStatusRes.json.hasApiKey, true);
  assert.equal(asaasStatusRes.json.hasWebhookToken, true);
});
