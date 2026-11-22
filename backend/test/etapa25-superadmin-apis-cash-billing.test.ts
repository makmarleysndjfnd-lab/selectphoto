import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { prisma, disconnectPrisma } from '../src/services/prisma';
import { encryptSecret } from '../src/services/vaultService';
import authRoutes from '../src/routes/auth';
import superadminRoutes from '../src/routes/superadmin';
import ownerRoutes from '../src/routes/owner';
import ownerBillingRoutes from '../src/routes/ownerBilling';
import eventsRoutes from '../src/routes/events';
import salesRoutes from '../src/routes/sales';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'lumora_etapa25_test_jwt_secret_998877665544';
process.env.INTEGRATION_MASTER_KEY =
  process.env.INTEGRATION_MASTER_KEY ||
  'lumora_disposable_master_key_64hex_0123456789abcdef0123456789abcd';
process.env.EXTERNAL_SERVICES_DISABLED = 'true';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/api/owner', ownerBillingRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/sales', salesRoutes);

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
const createdSaleIds: string[] = [];

function signUserToken(user: {
  id: string;
  role: string;
  companyId: string | null;
  name: string;
  sessionId?: string | null;
}) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      companyId: user.companyId,
      name: user.name,
      ...(user.sessionId ? { sessionId: user.sessionId } : {}),
    },
    process.env.JWT_SECRET!,
    { expiresIn: '2h' }
  );
}

async function apiJson(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; stepUpToken?: string; body?: any } = {}
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.stepUpToken ? { 'X-Step-Up-Token': options.stepUpToken } : {}),
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
    await prisma.platformStatementAdjustment.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.platformStatementItem.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.platformMonthlyStatement.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.companyPlatformRate.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.operationalAuditEvent.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.companyIntegration.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
    await prisma.asaasConfig.deleteMany({
      where: { companyId: { in: createdCompanyIds } },
    });
  }

  if (createdSaleIds.length > 0) {
    await prisma.creditPayment.deleteMany({
      where: { agreement: { saleId: { in: createdSaleIds } } },
    });
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
    await prisma.client.deleteMany({
      where: { id: { in: createdClientIds } },
    });
  }

  if (createdUserIds.length > 0) {
    await prisma.stepUpSession.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.ownerCapability.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
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

test('Etapa 25 — APIs Exclusivas por Empresa, Testar Conexão, Faturamento Caixa Real, Governança e Modo Suporte', async () => {
  const baseUrl = await getBaseUrl;
  const suffix = randomUUID().slice(0, 8);
  const passwordHash = await bcrypt.hash('Lumora@2026!', 10);

  // Criar SuperAdmin
  const superAdmin = await prisma.user.create({
    data: {
      name: `SuperAdmin E25 ${suffix}`,
      email: `superadmin_e25_${suffix}@lumora.test`,
      password: passwordHash,
      role: 'SUPER_ADMIN',
      active: true,
    },
  });
  createdUserIds.push(superAdmin.id);
  await prisma.ownerCapability.createMany({
    data: [
      { userId: superAdmin.id, capability: 'PLATFORM_FINANCE', grantedByUserId: superAdmin.id },
      { userId: superAdmin.id, capability: 'CONTRACT_MANAGEMENT', grantedByUserId: superAdmin.id },
      { userId: superAdmin.id, capability: 'INTEGRATION_CONFIG', grantedByUserId: superAdmin.id },
      { userId: superAdmin.id, capability: 'OPERATIONAL_SUPPORT', grantedByUserId: superAdmin.id },
    ],
  });
  const superToken = signUserToken({
    id: superAdmin.id,
    role: 'SUPER_ADMIN',
    companyId: null,
    name: superAdmin.name,
  });

  // Criar StepUp válido para o fechamento no ownerBilling
  const rawStepUp = `stepup_${suffix}_${randomUUID()}`;
  const stepUpHash = require('crypto').createHash('sha256').update(rawStepUp).digest('hex');
  await prisma.stepUpSession.create({
    data: {
      userId: superAdmin.id,
      tokenHash: stepUpHash,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });

  // ── 1. APIs Exclusivas por Empresa, Mascaramento & Testar Conexão ─────────
  const compARes = await apiJson(baseUrl, '/api/superadmin/companies', {
    method: 'POST',
    token: superToken,
    body: {
      name: `Empresa Alpha E25 ${suffix}`,
      tradeName: `Alpha Fotos ${suffix}`,
      platformFeePercent: 2.5,
      commercialStatus: 'ACTIVE',
    },
  });
  assert.equal(compARes.status, 201, `Create Company A failed: ${JSON.stringify(compARes.json)}`);
  const compAId = compARes.json.id as string;
  createdCompanyIds.push(compAId);
  assert.equal(compARes.json.platformFeeBps, 250);
  assert.equal(compARes.json.platformFeePercent, 2.5);
  assert.equal(compARes.json.commercialStatus, 'ACTIVE');

  const compBRes = await apiJson(baseUrl, '/api/superadmin/companies', {
    method: 'POST',
    token: superToken,
    body: {
      name: `Empresa Beta E25 ${suffix}`,
      platformFeePercent: 2.5,
    },
  });
  assert.equal(compBRes.status, 201);
  const compBId = compBRes.json.id as string;
  createdCompanyIds.push(compBId);

  const adminAEmail = `admin_a_${suffix}@lumora.test`;
  const adminACpf = `991${String(Date.now()).slice(-8)}`;
  const adminA = await prisma.user.create({
    data: {
      name: `Admin Alpha ${suffix}`,
      email: adminAEmail,
      cpf: adminACpf,
      password: passwordHash,
      role: 'ADMIN',
      company: { connect: { id: compAId } },
      active: true,
      activeSessionId: `sess-adminA-${suffix}`,
    },
  });
  createdUserIds.push(adminA.id);
  const adminAToken = signUserToken({
    id: adminA.id,
    role: 'ADMIN',
    companyId: compAId,
    name: adminA.name,
    sessionId: `sess-adminA-${suffix}`,
  });

  const adminB = await prisma.user.create({
    data: {
      name: `Admin Beta ${suffix}`,
      email: `admin_b_${suffix}@lumora.test`,
      password: passwordHash,
      role: 'ADMIN',
      company: { connect: { id: compBId } },
      active: true,
      activeSessionId: `sess-adminB-${suffix}`,
    },
  });
  createdUserIds.push(adminB.id);
  const adminBToken = signUserToken({
    id: adminB.id,
    role: 'ADMIN',
    companyId: compBId,
    name: adminB.name,
    sessionId: `sess-adminB-${suffix}`,
  });

  // Criar também uma integração PLATFORM_SHARED para garantir que NUNCA vaza para empresa sem chave própria
  const sharedCipher = encryptSecret('AIzaSySharedShouldNeverBeUsed9999');
  await prisma.companyIntegration.create({
    data: {
      company: { connect: { id: compAId } },
      createdByUser: { connect: { id: superAdmin.id } },
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      scope: 'PLATFORM_SHARED',
      status: 'ACTIVE',
      environment: 'PRODUCTION',
      costPayer: 'PLATFORM',
      credentialSource: 'VAULT_ENCRYPTED',
      encryptedSecret: sharedCipher.encryptedSecret,
      secretIv: sharedCipher.secretIv,
      secretTag: sharedCipher.secretTag,
      secretMasked: '••••9999',
    },
  });

  // Eventos IA sem chave Gemini exclusiva da empresa deve ser bloqueado (403)
  const blockedSearch = await apiJson(baseUrl, '/api/events/search', {
    method: 'POST',
    token: adminAToken,
    body: { city: 'Campinas', uf: 'SP' },
  });
  assert.equal(blockedSearch.status, 403);
  assert.equal(blockedSearch.json.code, 'COMPANY_GEMINI_KEY_REQUIRED');

  const blockedRadar = await apiJson(baseUrl, '/api/events/state-radar?state=SP', {
    token: adminAToken,
  });
  assert.equal(blockedRadar.status, 403);
  assert.equal(blockedRadar.json.code, 'COMPANY_GEMINI_KEY_REQUIRED');

  // Salvar chaves exclusivas apenas na Empresa A
  const rawGeminiA = `AIzaSyExclusiveAlpha_${suffix}_9876`;
  const rawAsaasA = `$aact_sandbox_Alpha_${suffix}_4321`;

  const saveGeminiRes = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${compAId}/integrations/gemini`,
    {
      method: 'PUT',
      token: superToken,
      body: { apiKey: rawGeminiA },
    }
  );
  assert.equal(saveGeminiRes.status, 200);
  assert.equal(saveGeminiRes.json.configured, true);
  assert.equal(saveGeminiRes.json.maskedKey, '••••9876');

  const saveAsaasRes = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${compAId}/integrations/asaas`,
    {
      method: 'PUT',
      token: superToken,
      body: { apiKey: rawAsaasA, environment: 'SANDBOX' },
    }
  );
  assert.equal(saveAsaasRes.status, 200);
  assert.equal(saveAsaasRes.json.configured, true);
  assert.equal(saveAsaasRes.json.environment, 'SANDBOX');
  assert.equal(saveAsaasRes.json.maskedKey, '••••4321');

  // Mascaramento estrito: resposta jamais expõe texto plano
  const integListRes = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${compAId}/integrations`,
    { token: superToken }
  );
  assert.equal(integListRes.status, 200);
  const rawJsonText = JSON.stringify(integListRes.json);
  assert.equal(rawJsonText.includes(rawGeminiA), false);
  assert.equal(rawJsonText.includes(rawAsaasA), false);
  assert.equal(integListRes.json.gemini.maskedKey, '••••9876');
  assert.equal(integListRes.json.asaas.maskedKey, '••••4321');

  // Empresa B continua bloqueada no Eventos IA (isolamento total entre empresas)
  const blockedBeta = await apiJson(baseUrl, '/api/events/search', {
    method: 'POST',
    token: adminBToken,
    body: { city: 'Santos', uf: 'SP' },
  });
  assert.equal(blockedBeta.status, 403);
  assert.equal(blockedBeta.json.code, 'COMPANY_GEMINI_KEY_REQUIRED');

  // Testar Conexão real (Asaas + Gemini) e auditoria
  const testGemini = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${compAId}/integrations/gemini/test`,
    { method: 'POST', token: superToken }
  );
  assert.equal(testGemini.status, 200);
  assert.equal(testGemini.json.success, true);
  assert.equal(testGemini.json.status, 'CONNECTED');

  const testAsaas = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${compAId}/integrations/asaas/test`,
    { method: 'POST', token: superToken, body: { environment: 'SANDBOX' } }
  );
  assert.equal(testAsaas.status, 200);
  assert.equal(testAsaas.json.success, true);
  assert.equal(testAsaas.json.status, 'CONNECTED');
  assert.equal(testAsaas.json.environment, 'SANDBOX');

  const compAAfterTests = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${compAId}`,
    { token: superToken }
  );
  assert.equal(compAAfterTests.status, 200);
  assert.equal(compAAfterTests.json.integrationsSummary.gemini.connectionStatus, 'CONNECTED');
  assert.equal(compAAfterTests.json.integrationsSummary.asaas.connectionStatus, 'CONNECTED');

  // ── 2. Regime de Caixa Real Pago & Taxa Lumora Configurável (3.0% / 4.0%) ─
  const compCRes = await apiJson(baseUrl, '/api/superadmin/companies', {
    method: 'POST',
    token: superToken,
    body: {
      name: `Empresa CashBilling E25 ${suffix}`,
      platformFeePercent: 3.0,
    },
  });
  assert.equal(compCRes.status, 201);
  const compCId = compCRes.json.id as string;
  createdCompanyIds.push(compCId);

  const sellerC = await prisma.user.create({
    data: {
      name: `Vendedor C ${suffix}`,
      email: `seller_c_${suffix}@lumora.test`,
      password: passwordHash,
      role: 'SELLER',
      company: { connect: { id: compCId } },
      active: true,
    },
  });
  createdUserIds.push(sellerC.id);

  const clientC = await prisma.client.create({
    data: {
      company: { connect: { id: compCId } },
      sequenceNumber: `E25-${suffix}`,
      name: `Responsável E25 ${suffix}`,
      city: 'Campinas',
      state: 'SP',
      bookStatus: 'SOLD',
    },
  });
  createdClientIds.push(clientC.id);

  // Data fixa na competência já encerrada 2026-10
  const saleDateOct = new Date('2026-10-10T15:00:00.000Z');

  // Venda 1: À vista PIX R$ 500,00 (50.000 cents) -> PAGO integral
  const sale1 = await prisma.sale.create({
    data: {
      company: { connect: { id: compCId } },
      client: { connect: { id: clientC.id } },
      seller: { connect: { id: sellerC.id } },
      value: 500,
      city: 'Campinas',
      paymentMethod: 'PIX',
      paymentStatus: 'PAID',
      status: 'PRONTO',
      saleStatus: 'ACTIVE',
      date: saleDateOct,
    },
  });
  createdSaleIds.push(sale1.id);

  // Venda 2: Crediário R$ 1.000,00 com R$ 200,00 de entrada + 2x R$ 400,00
  const sale2 = await prisma.sale.create({
    data: {
      company: { connect: { id: compCId } },
      client: { connect: { id: clientC.id } },
      seller: { connect: { id: sellerC.id } },
      value: 1000,
      city: 'Campinas',
      paymentMethod: 'CREDIARIO',
      paymentStatus: 'PAID',
      status: 'PRONTO',
      saleStatus: 'ACTIVE',
      date: saleDateOct,
    },
  });
  createdSaleIds.push(sale2.id);

  const agreement = await prisma.creditAgreement.create({
    data: {
      company: { connect: { id: compCId } },
      client: { connect: { id: clientC.id } },
      sale: { connect: { id: sale2.id } },
      seller: { connect: { id: sellerC.id } },
      buyerName: `Comprador E25 ${suffix}`,
      buyerCpf: '12345678901',
      street: 'Rua Teste',
      number: '100',
      neighborhood: 'Centro',
      city: 'Campinas',
      state: 'SP',
      totalSaleCents: 100000,
      downPaymentCents: 20000,
      financedPrincipalCents: 80000,
      remainingPrincipalCents: 70000,
      installmentsCount: 2,
      firstDueDate: new Date('2026-10-15T12:00:00.000Z'),
      status: 'ACTIVE',
      createdAt: saleDateOct,
    },
  });

  await prisma.creditInstallment.create({
    data: {
      agreement: { connect: { id: agreement.id } },
      installmentNumber: 1,
      dueDate: new Date('2026-10-15T12:00:00.000Z'),
      amountCents: 40000,
      paidCents: 10000,
      status: 'PARTIAL',
    },
  });

  await prisma.creditInstallment.create({
    data: {
      agreement: { connect: { id: agreement.id } },
      installmentNumber: 2,
      dueDate: new Date('2026-11-15T12:00:00.000Z'),
      amountCents: 40000,
      paidCents: 0,
      status: 'PENDING',
    },
  });

  // Pagamento efetivo de R$ 100,00 em outubro sobre a parcela 1 (restam R$ 700,00 em aberto!)
  await prisma.creditPayment.create({
    data: {
      agreement: { connect: { id: agreement.id } },
      company: { connect: { id: compCId } },
      amountCents: 10000,
      paymentMethod: 'PIX',
      receiver: { connect: { id: sellerC.id } },
      paidAt: new Date('2026-10-15T15:00:00.000Z'),
    },
  });

  // Venda 3: CANCELADA (R$ 400,00) -> Deve ser 100% excluída do caixa
  const sale3 = await prisma.sale.create({
    data: {
      company: { connect: { id: compCId } },
      client: { connect: { id: clientC.id } },
      seller: { connect: { id: sellerC.id } },
      value: 400,
      city: 'Campinas',
      paymentMethod: 'CASH',
      paymentStatus: 'PAID',
      status: 'CANCELLED',
      saleStatus: 'CANCELLED',
      refundedAmountCents: 40000,
      date: saleDateOct,
    },
  });
  createdSaleIds.push(sale3.id);

  // Venda 4: Estornada parcialmente (R$ 300,00 venda à vista - R$ 100,00 estorno = R$ 200,00 caixa líquido)
  const sale4 = await prisma.sale.create({
    data: {
      company: { connect: { id: compCId } },
      client: { connect: { id: clientC.id } },
      seller: { connect: { id: sellerC.id } },
      value: 300,
      city: 'Campinas',
      paymentMethod: 'PIX',
      paymentStatus: 'PAID',
      status: 'PRONTO',
      saleStatus: 'PARTIALLY_REFUNDED',
      refundedAmountCents: 10000,
      date: saleDateOct,
    },
  });
  createdSaleIds.push(sale4.id);

  const preview3Pct = await apiJson(
    baseUrl,
    `/api/superadmin/billing/preview?companyId=${compCId}&competence=2026-10`,
    { token: superToken }
  );
  assert.equal(preview3Pct.status, 200);
  const pv3 = preview3Pct.json.preview;
  // À vista: 50000 (Sale1) + 20000 (Sale4 líquida) = 70000
  assert.equal(pv3.cashSalesPaidCents, 70000);
  // Entradas crediário pagas: 20000 (NUNCA os 100000 do crediário!)
  assert.equal(pv3.creditDownPaymentsPaidCents, 20000);
  // Parcelas pagas no mês: 10000
  assert.equal(pv3.creditInstallmentsPaidCents, 10000);
  // Base total efetivamente paga = R$ 1.000,00 (100000 cents)
  assert.equal(pv3.eligibleSalesBaseCents, 100000);
  // 3.0% sobre 100000 cents = 3000 cents (R$ 30,00)
  assert.equal(pv3.appliedRatePercentage, 3);
  assert.equal(pv3.appliedRateBps, 300);
  assert.equal(pv3.grossPlatformFeeCents, 3000);
  assert.equal(pv3.netDueCents, 3000);

  // Atualizar taxa da Empresa C para 4.0% e confirmar recálculo imediato antes do fechamento
  const updateRate4 = await apiJson(baseUrl, `/api/superadmin/companies/${compCId}`, {
    method: 'PUT',
    token: superToken,
    body: { platformFeePercent: 4.0 },
  });
  assert.equal(updateRate4.status, 200);
  assert.equal(updateRate4.json.platformFeeBps, 400);

  const preview4Pct = await apiJson(
    baseUrl,
    `/api/superadmin/billing/preview?companyId=${compCId}&competence=2026-10`,
    { token: superToken }
  );
  assert.equal(preview4Pct.status, 200);
  assert.equal(preview4Pct.json.preview.eligibleSalesBaseCents, 100000);
  assert.equal(preview4Pct.json.preview.appliedRatePercentage, 4);
  assert.equal(preview4Pct.json.preview.netDueCents, 4000);

  // Fechar competência e validar persistência dos novos campos caixa real no banco
  const closeRes = await apiJson(baseUrl, '/api/owner/billing/statements/close', {
    method: 'POST',
    token: superToken,
    stepUpToken: rawStepUp,
    body: { companyId: compCId, competence: '2026-10' },
  });
  assert.equal(closeRes.status, 201, `Close statement failed: ${JSON.stringify(closeRes.json)}`);
  assert.equal(closeRes.json.statement.cashSalesPaidCents, 70000);
  assert.equal(closeRes.json.statement.creditDownPaymentsPaidCents, 20000);
  assert.equal(closeRes.json.statement.creditInstallmentsPaidCents, 10000);
  assert.equal(closeRes.json.statement.appliedRateBps, 400);
  assert.equal(closeRes.json.statement.netDueCents, 4000);

  // ── 3. Governança Comercial: ACTIVE -> WARNING -> SUSPENDED -> ACTIVE ─────
  const warnRes = await apiJson(baseUrl, `/api/superadmin/companies/${compAId}`, {
    method: 'PUT',
    token: superToken,
    body: {
      commercialStatus: 'WARNING',
      commercialStatusReason: 'Fatura em aberto vencimento 15/11',
    },
  });
  assert.equal(warnRes.status, 200);
  assert.equal(warnRes.json.commercialStatus, 'WARNING');

  const adminLoginWarning = await apiJson(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { cpf: adminACpf, password: 'Lumora@2026!' },
  });
  assert.equal(adminLoginWarning.status, 200);
  assert.equal(adminLoginWarning.json.user.commercialStatus, 'WARNING');
  assert.match(adminLoginWarning.json.user.governanceWarning, /Fatura em aberto/);

  const activeAdminWarningJwt = adminLoginWarning.json.token as string;
  const sessionWarning = await apiJson(baseUrl, '/api/auth/session', {
    token: activeAdminWarningJwt,
  });
  assert.equal(sessionWarning.status, 200);
  assert.equal(sessionWarning.json.commercialStatus, 'WARNING');

  // Suspender empresa: login E rotas autenticadas devem ser bloqueados
  const suspRes = await apiJson(baseUrl, `/api/superadmin/companies/${compAId}`, {
    method: 'PUT',
    token: superToken,
    body: {
      commercialStatus: 'SUSPENDED',
      commercialStatusReason: 'Suspensão por inadimplência E25',
    },
  });
  assert.equal(suspRes.status, 200);
  assert.equal(suspRes.json.commercialStatus, 'SUSPENDED');

  const adminLoginSuspended = await apiJson(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { cpf: adminACpf, password: 'Lumora@2026!' },
  });
  assert.equal(adminLoginSuspended.status, 403);
  assert.equal(adminLoginSuspended.json.code, 'COMPANY_SUSPENDED');

  const blockedOpsSuspended = await apiJson(baseUrl, '/api/sales/history', {
    token: activeAdminWarningJwt,
  });
  assert.equal(blockedOpsSuspended.status, 403);
  assert.equal(blockedOpsSuspended.json.code, 'COMPANY_SUSPENDED');

  // Reativar Empresa A
  const reactivateRes = await apiJson(baseUrl, `/api/superadmin/companies/${compAId}`, {
    method: 'PUT',
    token: superToken,
    body: { commercialStatus: 'ACTIVE' },
  });
  assert.equal(reactivateRes.status, 200);
  assert.equal(reactivateRes.json.commercialStatus, 'ACTIVE');

  // Reautenticar Admin A para validar não-interferência do Modo Suporte
  const adminLoginActive = await apiJson(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { cpf: adminACpf, password: 'Lumora@2026!' },
  });
  assert.equal(adminLoginActive.status, 200);
  const realAdminToken = adminLoginActive.json.token as string;

  // ── 4. Modo Suporte Auditado: "Acessar como Admin (Suporte)" ──────────────
  const supportLogin = await apiJson(
    baseUrl,
    `/api/superadmin/companies/${compAId}/support-login`,
    {
      method: 'POST',
      token: superToken,
      body: { reason: 'Conferência de configuração e suporte E25' },
    }
  );
  assert.equal(supportLogin.status, 200);
  assert.equal(supportLogin.json.success, true);
  assert.ok(supportLogin.json.token);
  assert.ok(supportLogin.json.auditEventId);

  const supportToken = supportLogin.json.token as string;
  const supportSession = await apiJson(baseUrl, '/api/auth/session', {
    token: supportToken,
  });
  assert.equal(supportSession.status, 200);
  assert.equal(supportSession.json.isTemporarySupportSession, true);
  assert.equal(supportSession.json.role, 'ADMIN');
  assert.equal(supportSession.json.companyId, compAId);

  // Admin real NÃO foi desconectado pelo suporte!
  const realAdminSales = await apiJson(baseUrl, '/api/sales/history', {
    token: realAdminToken,
  });
  assert.equal(realAdminSales.status, 200);

  const supportLogout = await apiJson(baseUrl, '/api/superadmin/support-logout', {
    method: 'POST',
    token: supportToken,
  });
  assert.equal(supportLogout.status, 200);

  // Confirmar trilha completa em OperationalAuditEvent (inclui API tests, governança e suporte)
  const audits = await prisma.operationalAuditEvent.findMany({
    where: { companyId: compAId },
    select: { action: true, category: true, reason: true },
  });
  const actions = audits.map((a) => a.action);
  assert.ok(actions.includes('COMPANY_GEMINI_KEY_CONFIGURED'));
  assert.ok(actions.includes('COMPANY_ASAAS_KEY_CONFIGURED'));
  assert.ok(actions.includes('COMPANY_GEMINI_CONNECTION_TESTED'));
  assert.ok(actions.includes('COMPANY_ASAAS_CONNECTION_TESTED'));
  assert.ok(actions.includes('COMPANY_COMMERCIAL_STATUS_SUSPENDED'));
  assert.ok(actions.includes('SUPERADMIN_SUPPORT_SESSION_STARTED'));
  assert.ok(actions.includes('SUPERADMIN_SUPPORT_SESSION_ENDED'));
});
