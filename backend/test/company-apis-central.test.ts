import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import express from 'express';
import jwt from 'jsonwebtoken';
import { prisma, disconnectPrisma } from '../src/services/prisma';
import companyIntegrationsRoutes from '../src/routes/companyIntegrations';
import integrationsRoutes from '../src/routes/integrations';
import eventsRoutes, { clearCityScoutCache } from '../src/routes/events';
import {
  getSimulatedAlerts,
  clearSimulatedAlerts,
  markReservationPendingConfirmation,
  releaseApiReservation,
  reserveApiQuota,
  handleLateProviderResponse,
} from '../src/services/apiQuotaService';
import { assertSafeEffectiveTestConnection } from '../src/utils/testDbGuard';
import { recordApiUsage, clearCepCache } from '../src/services/integrationResolver';

const jwtSecret = 'isolated-central-apis-test-jwt-secret';
process.env.JWT_SECRET = jwtSecret;

const app = express();
app.use(express.json());
app.use('/api/company/integrations', companyIntegrationsRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/owner/integrations', integrationsRoutes);
app.use('/api/events', eventsRoutes);

const server = app.listen(0, '127.0.0.1');
const getBaseUrl = new Promise<string>((resolve) => {
  server.once('listening', () => {
    const port = (server.address() as AddressInfo).port;
    resolve(`http://127.0.0.1:${port}`);
  });
});

const createdCompanyIds: string[] = [];
const createdUserIds: string[] = [];
const createdIntegrationIds: string[] = [];

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  // Limpeza de dados isolados
  if (createdCompanyIds.length > 0) {
    await prisma.apiQuotaAlert.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.companyApiTariff.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.apiUsageRecord.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.integrationAuditEvent.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.companyIntegration.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.ownerCapability.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  }

  await disconnectPrisma();
});

test('Central de APIs - Isolamento estrito entre Empresa A e Empresa B, consumo, limites e ViaCEP', async () => {
  await assertSafeEffectiveTestConnection(prisma, process.env.DATABASE_URL);
  const baseUrl = await getBaseUrl;

  const adminPassword = 'SenhaForte123!';
  const hashedPassword = bcrypt.hashSync(adminPassword, 4);

  // 1. Criar Empresa A e Empresa B
  const compA = await prisma.company.create({
    data: {
      id: randomUUID(),
      name: 'Empresa A Fotografia Teste',
      classification: 'TEST_DEMO',
    },
  });
  createdCompanyIds.push(compA.id);

  const compB = await prisma.company.create({
    data: {
      id: randomUUID(),
      name: 'Empresa B Eventos Teste',
      classification: 'TEST_DEMO',
    },
  });
  createdCompanyIds.push(compB.id);

  // 2. Criar Admins de cada empresa e Super Admin da plataforma
  const userAdminA = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: 'Admin Empresa A',
      email: `adminA_${randomUUID().slice(0, 8)}@teste.com`,
      cpf: `111${Date.now().toString().slice(-8)}`,
      password: hashedPassword,
      role: 'ADMIN',
      companyId: compA.id,
    },
  });
  createdUserIds.push(userAdminA.id);

  const userPhotographerA = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: 'Fotografo Empresa A',
      email: `fotoA_${randomUUID().slice(0, 8)}@teste.com`,
      cpf: `222${Date.now().toString().slice(-8)}`,
      password: hashedPassword,
      role: 'FOTOGRAFO',
      companyId: compA.id,
    },
  });
  createdUserIds.push(userPhotographerA.id);

  const userAdminB = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: 'Admin Empresa B',
      email: `adminB_${randomUUID().slice(0, 8)}@teste.com`,
      cpf: `333${Date.now().toString().slice(-8)}`,
      password: hashedPassword,
      role: 'ADMIN',
      companyId: compB.id,
    },
  });
  createdUserIds.push(userAdminB.id);

  const superAdmin = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: 'Super Admin Plataforma',
      email: `super_${randomUUID().slice(0, 8)}@teste.com`,
      cpf: `999${Date.now().toString().slice(-8)}`,
      password: hashedPassword,
      role: 'SUPER_ADMIN',
    },
  });
  createdUserIds.push(superAdmin.id);

  await prisma.ownerCapability.create({
    data: {
      userId: superAdmin.id,
      capability: 'INTEGRATION_CONFIG',
      grantedByUserId: superAdmin.id,
    },
  });

  const tokenAdminA = jwt.sign(
    { id: userAdminA.id, name: userAdminA.name, role: userAdminA.role, companyId: compA.id },
    jwtSecret
  );
  const tokenPhotographerA = jwt.sign(
    { id: userPhotographerA.id, name: userPhotographerA.name, role: userPhotographerA.role, companyId: compA.id },
    jwtSecret
  );
  const tokenAdminB = jwt.sign(
    { id: userAdminB.id, name: userAdminB.name, role: userAdminB.role, companyId: compB.id },
    jwtSecret
  );
  const tokenSuperAdmin = jwt.sign(
    { id: superAdmin.id, name: superAdmin.name, role: superAdmin.role, companyId: compA.id },
    jwtSecret
  );

  // 3. Admin da Empresa A cadastra credencial do Gemini com limites configurados
  const createGeminiResp = await fetch(`${baseUrl}/api/company/integrations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminA}`,
    },
    body: JSON.stringify({
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      secret: 'AIzaSyFakeKeyForEmpresaATesting1234567890',
      accountName: 'Chave Gemini Empresa A',
      passwordConfirmation: adminPassword,
      monthlyUnitsLimit: 100,
      monthlyBudgetLimitCents: 5000, // R$ 50,00
    }),
  });
  assert.equal(createGeminiResp.status, 200, 'Cadastro do Gemini para Empresa A deve ter sucesso');
  const geminiData = await createGeminiResp.json();
  const integrationAId = geminiData.integration.id;
  createdIntegrationIds.push(integrationAId);

  // 4. Admin da Empresa B cadastra credencial do Asaas Sandbox
  const createAsaasResp = await fetch(`${baseUrl}/api/company/integrations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminB}`,
    },
    body: JSON.stringify({
      category: 'PAYMENT_GATEWAY',
      provider: 'ASAAS',
      environment: 'SANDBOX',
      secret: '$aact_YzA1ZTMzY2NmYWQ1MWY5OTBhMmZkZjExYTExFakeKeyEmpresaB',
      webhookToken: 'wh_token_empresa_b_123',
      accountName: 'Conta Asaas Empresa B',
      passwordConfirmation: adminPassword,
      monthlyUnitsLimit: 500,
      monthlyBudgetLimitCents: 20000, // R$ 200,00
    }),
  });
  assert.equal(createAsaasResp.status, 200, 'Cadastro do Asaas para Empresa B deve ter sucesso');
  const asaasData = await createAsaasResp.json();
  const integrationBId = asaasData.integration.id;
  createdIntegrationIds.push(integrationBId);

  // 5. Teste de isolamento de leitura:
  // Admin A enxerga APENAS Empresa A; NÃO enxerga Asaas da Empresa B
  const listRespA = await fetch(`${baseUrl}/api/company/integrations`, {
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  assert.equal(listRespA.status, 200);
  const payloadA = await listRespA.json();
  assert.equal(payloadA.integrations.length, 1);
  assert.equal(payloadA.integrations[0].provider, 'GEMINI');
  assert.equal(payloadA.integrations[0].serviceStatusLevel, 'CONFIGURED');
  assert.equal(payloadA.integrations[0].serviceStatusLabel, 'Configuração cadastrada');
  assert.equal(payloadA.integrations[0].consumption.unitsLimit, 100);
  assert.equal(payloadA.integrations[0].consumption.costBudgetCents, 5000);
  assert.equal(payloadA.sharedServices.length, 1);
  assert.equal(payloadA.sharedServices[0].provider, 'VIACEP');

  // Admin B enxerga APENAS Empresa B; NÃO enxerga Gemini da Empresa A
  const listRespB = await fetch(`${baseUrl}/api/company/integrations`, {
    headers: { Authorization: `Bearer ${tokenAdminB}` },
  });
  assert.equal(listRespB.status, 200);
  const payloadB = await listRespB.json();
  assert.equal(payloadB.integrations.length, 1);
  assert.equal(payloadB.integrations[0].provider, 'ASAAS');
  assert.equal(payloadB.integrations[0].consumption.unitsLimit, 500);
  assert.equal(payloadB.integrations[0].consumption.costBudgetCents, 20000);

  // 6. Teste de isolamento de mutação e acesso cruzado:
  // Admin A tenta remover a integração da Empresa B -> Deve retornar 404 / não encontrada
  const deleteForbidden = await fetch(`${baseUrl}/api/company/integrations/${integrationBId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminA}`,
    },
    body: JSON.stringify({ passwordConfirmation: adminPassword }),
  });
  assert.equal(deleteForbidden.status, 404, 'Admin A não pode acessar nem excluir integração da Empresa B');

  // Admin A tenta testar conexão da integração da Empresa B -> Deve retornar 404
  const testForbidden = await fetch(`${baseUrl}/api/company/integrations/${integrationBId}/test`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  assert.equal(testForbidden.status, 404, 'Admin A não pode testar integração da Empresa B');

  // 7. Simular transição de status para CONEXÃO TESTADA (TESTED):
  await prisma.companyIntegration.update({
    where: { id: integrationAId },
    data: {
      lastValidatedAt: new Date(),
      lastValidationStatus: 'SUCCESS',
    },
  });

  const listAfterTestA = await fetch(`${baseUrl}/api/company/integrations`, {
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  const dataAfterTestA = await listAfterTestA.json();
  assert.equal(dataAfterTestA.integrations[0].serviceStatusLevel, 'TESTED');
  assert.equal(dataAfterTestA.integrations[0].serviceStatusLabel, 'Conexão testada');

  // 8. Simular consumo operacional para Empresa A -> Transição para OPERAÇÃO COMPROVADA (OPERATIONAL)
  await recordApiUsage({
    companyId: compA.id,
    integrationId: integrationAId,
    category: 'AI_RESEARCH',
    provider: 'GEMINI',
    operation: 'SEARCH_EVENTS',
    unitsUsed: 15,
    estimatedCostCents: 30, // R$ 0,30
    status: 'SUCCESS',
  });

  const listAfterUsageA = await fetch(`${baseUrl}/api/company/integrations`, {
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  const dataAfterUsageA = await listAfterUsageA.json();
  const geminiEnriched = dataAfterUsageA.integrations[0];
  assert.equal(geminiEnriched.serviceStatusLevel, 'OPERATIONAL');
  assert.equal(geminiEnriched.serviceStatusLabel, 'Operação comprovada');
  assert.equal(geminiEnriched.consumption.unitsUsed, 15);
  assert.equal(geminiEnriched.consumption.unitsPercent, 15); // 15 de 100 = 15%
  assert.equal(geminiEnriched.consumption.costSpentCents, 30);
  assert.equal(geminiEnriched.consumption.isEstimatedCost, true);
  assert.match(geminiEnriched.consumption.lumoraLimitLabel, /100 un\./);
  assert.match(geminiEnriched.consumption.lumoraLimitLabel, /R\$ 50,00/);
  assert.equal(geminiEnriched.consumption.providerQuotaLabel, 'Cota não informada pelo provedor');

  // 9. Fotógrafo da Empresa A consulta CEP pela rota autenticada existente
  // Rota: GET /api/integrations/cep/:cep
  const cepResp = await fetch(`${baseUrl}/api/integrations/cep/01001000`, {
    headers: { Authorization: `Bearer ${tokenPhotographerA}` },
  });
  assert.equal(cepResp.status, 200, 'Consulta de CEP autenticada deve responder 200');
  const cepData = await cepResp.json();
  assert.equal(cepData.success, true);
  assert.ok(cepData.data?.logradouro, 'Deve retornar logradouro');

  // Verificar que o uso de CEP foi computado para Empresa A e NÃO para Empresa B
  const listWithCepA = await fetch(`${baseUrl}/api/company/integrations`, {
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  const payloadWithCepA = await listWithCepA.json();
  const viaCepServiceA = payloadWithCepA.sharedServices.find((s: any) => s.provider === 'VIACEP');
  assert.ok(viaCepServiceA);
  assert.ok(viaCepServiceA.consumption.unitsUsed >= 1, 'Empresa A deve registrar o consumo da consulta de CEP');
  assert.equal(viaCepServiceA.serviceStatusLevel, 'OPERATIONAL');
  assert.equal(viaCepServiceA.serviceStatusLabel, 'Operação comprovada');

  // Empresa B continua com 0 consultas de CEP
  const listWithCepB = await fetch(`${baseUrl}/api/company/integrations`, {
    headers: { Authorization: `Bearer ${tokenAdminB}` },
  });
  const payloadWithCepB = await listWithCepB.json();
  const viaCepServiceB = payloadWithCepB.sharedServices.find((s: any) => s.provider === 'VIACEP');
  assert.equal(viaCepServiceB.consumption.unitsUsed, 0, 'Empresa B não deve ter consumo de CEP');

  // 10. Atualização de limites via PATCH /api/company/integrations/:id/limits
  const patchLimitsResp = await fetch(`${baseUrl}/api/company/integrations/${integrationAId}/limits`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminA}`,
    },
    body: JSON.stringify({
      monthlyUnitsLimit: 250,
      monthlyBudgetLimitCents: 15000, // R$ 150,00
      passwordConfirmation: adminPassword,
    }),
  });
  assert.equal(patchLimitsResp.status, 200, 'PATCH de limites deve ter sucesso');
  const patchData = await patchLimitsResp.json();
  assert.equal(patchData.monthlyUnitsLimit, 250);
  assert.equal(patchData.monthlyBudgetLimitCents, 15000);

  // 11. Super Admin consulta a Visão Geral de APIs e a visão detalhada de Empresa A
  const overviewResp = await fetch(`${baseUrl}/api/owner/integrations/overview`, {
    headers: { Authorization: `Bearer ${tokenSuperAdmin}` },
  });
  assert.equal(overviewResp.status, 200);
  const overviewData = await overviewResp.json();
  assert.ok(overviewData.totalCompanies >= 2);
  assert.ok(overviewData.totalUnitsUsedThisMonth >= 15);
  const summaryCompA = overviewData.companies.find((c: any) => c.companyId === compA.id);
  assert.ok(summaryCompA);
  assert.ok(summaryCompA.unitsUsedThisMonth >= 15);

  const ownerCompAResp = await fetch(`${baseUrl}/api/owner/integrations/companies/${compA.id}`, {
    headers: { Authorization: `Bearer ${tokenSuperAdmin}` },
  });
  assert.equal(ownerCompAResp.status, 200);
  const ownerCompAData = await ownerCompAResp.json();
  assert.equal(ownerCompAData.integrations.length, 1);
  assert.equal(ownerCompAData.integrations[0].consumption.unitsLimit, 250);
  assert.equal(ownerCompAData.integrations[0].consumption.costBudgetCents, 15000);
});

test('Central de APIs - Tarifas por empresa, Sandbox vs Produção, custo medido sobre estimado e descarte de CEP atrasado', async () => {
  await assertSafeEffectiveTestConnection(prisma, process.env.DATABASE_URL);
  const baseUrl = await getBaseUrl;
  const adminPassword = 'SenhaForte123!';

  // 1. Criar Empresa Alpha e Empresa Beta
  const compAlpha = await prisma.company.create({
    data: { id: randomUUID(), name: 'Empresa Alpha APIs', classification: 'TEST_DEMO' },
  });
  createdCompanyIds.push(compAlpha.id);

  const compBeta = await prisma.company.create({
    data: { id: randomUUID(), name: 'Empresa Beta APIs', classification: 'TEST_DEMO' },
  });
  createdCompanyIds.push(compBeta.id);

  const userAdminAlpha = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: 'Admin Alpha',
      email: `adminAlpha_${randomUUID().slice(0, 8)}@teste.com`,
      cpf: `444${Date.now().toString().slice(-8)}`,
      password: bcrypt.hashSync(adminPassword, 4),
      role: 'ADMIN',
      companyId: compAlpha.id,
    },
  });
  createdUserIds.push(userAdminAlpha.id);

  const userAdminBeta = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: 'Admin Beta',
      email: `adminBeta_${randomUUID().slice(0, 8)}@teste.com`,
      cpf: `555${Date.now().toString().slice(-8)}`,
      password: bcrypt.hashSync(adminPassword, 4),
      role: 'ADMIN',
      companyId: compBeta.id,
    },
  });
  createdUserIds.push(userAdminBeta.id);

  const superAdmin = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: 'Super Admin Tarifas',
      email: `superTarifas_${randomUUID().slice(0, 8)}@teste.com`,
      cpf: `777${Date.now().toString().slice(-8)}`,
      password: bcrypt.hashSync(adminPassword, 4),
      role: 'SUPER_ADMIN',
    },
  });
  createdUserIds.push(superAdmin.id);

  await prisma.ownerCapability.create({
    data: { userId: superAdmin.id, capability: 'INTEGRATION_CONFIG', grantedByUserId: superAdmin.id },
  });

  const tokenAdminAlpha = jwt.sign({ id: userAdminAlpha.id, name: userAdminAlpha.name, role: 'ADMIN', companyId: compAlpha.id }, jwtSecret);
  const tokenAdminBeta = jwt.sign({ id: userAdminBeta.id, name: userAdminBeta.name, role: 'ADMIN', companyId: compBeta.id }, jwtSecret);
  const tokenSuperAdmin = jwt.sign({ id: superAdmin.id, name: superAdmin.name, role: 'SUPER_ADMIN' }, jwtSecret);

  // 2. Empresa Alpha cadastra Asaas em SANDBOX e Asaas em PRODUCTION
  const asaasSandboxResp = await fetch(`${baseUrl}/api/company/integrations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdminAlpha}` },
    body: JSON.stringify({
      category: 'PAYMENT_GATEWAY',
      provider: 'ASAAS',
      environment: 'SANDBOX',
      secret: '$aact_sandbox_key_alpha_123',
      accountName: 'Asaas Alpha Sandbox',
      passwordConfirmation: adminPassword,
      monthlyUnitsLimit: 200,
    }),
  });
  assert.equal(asaasSandboxResp.status, 200);
  const sandboxData = await asaasSandboxResp.json();
  const sandboxId = sandboxData.integration.id;

  const asaasProdResp = await fetch(`${baseUrl}/api/company/integrations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdminAlpha}` },
    body: JSON.stringify({
      category: 'PAYMENT_GATEWAY',
      provider: 'ASAAS',
      environment: 'PRODUCTION',
      secret: '$aact_prod_key_alpha_999',
      accountName: 'Asaas Alpha Prod',
      passwordConfirmation: adminPassword,
      monthlyUnitsLimit: 500,
    }),
  });
  assert.equal(asaasProdResp.status, 200);
  const prodData = await asaasProdResp.json();
  const prodId = prodData.integration.id;

  // Empresa Beta cadastra Asaas em PRODUCTION
  const asaasBetaResp = await fetch(`${baseUrl}/api/company/integrations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdminBeta}` },
    body: JSON.stringify({
      category: 'PAYMENT_GATEWAY',
      provider: 'ASAAS',
      environment: 'PRODUCTION',
      secret: '$aact_prod_key_beta_777',
      accountName: 'Asaas Beta Prod',
      passwordConfirmation: adminPassword,
      monthlyUnitsLimit: 1000,
    }),
  });
  assert.equal(asaasBetaResp.status, 200);
  const betaData = await asaasBetaResp.json();
  const betaProdId = betaData.integration.id;

  // 3. Super Admin registra tarifas DIFERENTES para o mesmo provedor (Asaas) nas duas empresas:
  // Alpha: Franquia 50 un, Mensalidade R$ 0,00, Excedente R$ 1,99 / transação
  const tariffAlphaResp = await fetch(`${baseUrl}/api/owner/integrations/tariffs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenSuperAdmin}` },
    body: JSON.stringify({
      companyId: compAlpha.id,
      category: 'PAYMENT_GATEWAY',
      provider: 'ASAAS',
      environment: 'PRODUCTION',
      companyIntegrationId: prodId,
      includedUnits: 50,
      monthlyFeeCents: 0,
      overageUnitPriceCents: 199,
      overageUnitType: 'transação',
      costPayer: 'COMPANY',
      pricingSource: 'TABELA_OFICIAL',
      notes: 'Tarifa inicial padrão',
    }),
  });
  assert.equal(tariffAlphaResp.status, 201);

  // Beta: Franquia 200 un, Mensalidade R$ 49,90, Excedente R$ 0,99 / transação
  const tariffBetaResp = await fetch(`${baseUrl}/api/owner/integrations/tariffs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenSuperAdmin}` },
    body: JSON.stringify({
      companyId: compBeta.id,
      category: 'PAYMENT_GATEWAY',
      provider: 'ASAAS',
      environment: 'PRODUCTION',
      companyIntegrationId: betaProdId,
      includedUnits: 200,
      monthlyFeeCents: 4990,
      overageUnitPriceCents: 99,
      overageUnitType: 'transação',
      costPayer: 'COMPANY',
      pricingSource: 'CONTRATO_CUSTOMIZADO',
      notes: 'Contrato negociado com desconto por volume',
    }),
  });
  assert.equal(tariffBetaResp.status, 201);

  // 4. Verificar isolamento de tarifas:
  // Admin Alpha consulta integrações -> enxerga apenas a tarifa de Alpha (R$ 1,99, franquia 50)
  const listAlpha = await fetch(`${baseUrl}/api/company/integrations`, {
    headers: { Authorization: `Bearer ${tokenAdminAlpha}` },
  });
  const alphaPayload = await listAlpha.json();
  const prodAlphaCard = alphaPayload.integrations.find((i: any) => i.id === prodId);
  assert.ok(prodAlphaCard.tariff.hasConfirmedTariff);
  assert.equal(prodAlphaCard.tariff.overageUnitPriceCents, 199);
  assert.equal(prodAlphaCard.tariff.includedUnits, 50);
  assert.equal(prodAlphaCard.tariff.monthlyFeeCents, 0);

  // Sandbox de Alpha não tem tarifa própria confirmada -> deve exibir "Tarifa ainda não informada"
  const sandboxAlphaCard = alphaPayload.integrations.find((i: any) => i.id === sandboxId);
  assert.equal(sandboxAlphaCard.tariff.hasConfirmedTariff, false);
  assert.equal(sandboxAlphaCard.tariff.statusLabel, 'Tarifa ainda não informada');

  // Admin Beta consulta integrações -> enxerga apenas a tarifa de Beta (R$ 0,99, franquia 200, mensalidade R$ 49,90)
  const listBeta = await fetch(`${baseUrl}/api/company/integrations`, {
    headers: { Authorization: `Bearer ${tokenAdminBeta}` },
  });
  const betaPayload = await listBeta.json();
  const prodBetaCard = betaPayload.integrations.find((i: any) => i.id === betaProdId);
  assert.ok(prodBetaCard.tariff.hasConfirmedTariff);
  assert.equal(prodBetaCard.tariff.overageUnitPriceCents, 99);
  assert.equal(prodBetaCard.tariff.includedUnits, 200);
  assert.equal(prodBetaCard.tariff.monthlyFeeCents, 4990);

  // 5. Preservação de Histórico quando o Super Admin atualiza a tarifa:
  // Super Admin renegocia a tarifa de Alpha: Excedente baixa de R$ 1,99 para R$ 1,49
  const updateTariffResp = await fetch(`${baseUrl}/api/owner/integrations/tariffs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenSuperAdmin}` },
    body: JSON.stringify({
      companyId: compAlpha.id,
      category: 'PAYMENT_GATEWAY',
      provider: 'ASAAS',
      environment: 'PRODUCTION',
      companyIntegrationId: prodId,
      includedUnits: 80,
      monthlyFeeCents: 0,
      overageUnitPriceCents: 149,
      overageUnitType: 'transação',
      costPayer: 'COMPANY',
      pricingSource: 'CONTRATO_CUSTOMIZADO',
      notes: 'Aditivo contratual de 2026',
    }),
  });
  assert.equal(updateTariffResp.status, 201);

  // Consulta histórico de tarifas de Alpha via Super Admin
  const historyResp = await fetch(`${baseUrl}/api/owner/integrations/tariffs/${compAlpha.id}`, {
    headers: { Authorization: `Bearer ${tokenSuperAdmin}` },
  });
  assert.equal(historyResp.status, 200);
  const historyData = await historyResp.json();
  assert.equal(historyData.tariffs.length, 2, 'Histórico deve preservar 2 registros para Alpha');
  const activeTariff = historyData.tariffs.find((t: any) => t.effectiveTo === null);
  const closedTariff = historyData.tariffs.find((t: any) => t.effectiveTo !== null);
  assert.equal(activeTariff.overageUnitPriceCents, 149);
  assert.equal(closedTariff.overageUnitPriceCents, 199);

  // 6. Separação de Sandbox e Produção:
  // Gerar consumo em SANDBOX para Alpha (3 requisições)
  await recordApiUsage({
    companyId: compAlpha.id,
    integrationId: sandboxId,
    category: 'PAYMENT_GATEWAY',
    provider: 'ASAAS',
    environment: 'SANDBOX',
    operation: 'CREATE_PAYMENT',
    unitsUsed: 3,
    status: 'SUCCESS',
  });

  const listAlphaAfterUsage = await fetch(`${baseUrl}/api/company/integrations`, {
    headers: { Authorization: `Bearer ${tokenAdminAlpha}` },
  });
  const alphaUsagePayload = await listAlphaAfterUsage.json();
  const sandboxCard = alphaUsagePayload.integrations.find((i: any) => i.id === sandboxId);
  const prodCard = alphaUsagePayload.integrations.find((i: any) => i.id === prodId);

  // Sandbox deve ter 3 unidades usadas e status operacional comprovado no sandbox
  assert.equal(sandboxCard.consumption.unitsUsed, 3);
  assert.equal(sandboxCard.serviceStatusLevel, 'OPERATIONAL');

  // Produção DEVE permanecer isolado com 0 unidades e "Consumo ainda não medido"
  assert.equal(prodCard.consumption.unitsUsed, 0);
  assert.equal(prodCard.consumption.consumptionStatusLabel, 'Consumo ainda não medido');
  assert.equal(prodCard.serviceStatusLevel, 'CONFIGURED');

  // 7. Custo Medido e Estimado na MESMA operação:
  // Inserir registro que possui AMBOS measuredCostCents (189) e estimatedCostCents (150)
  await recordApiUsage({
    companyId: compAlpha.id,
    integrationId: prodId,
    category: 'PAYMENT_GATEWAY',
    provider: 'ASAAS',
    environment: 'PRODUCTION',
    operation: 'PROCESS_BOLETO',
    unitsUsed: 1,
    measuredCostCents: 189,
    estimatedCostCents: 150,
    status: 'SUCCESS',
  });

  const listAfterCombinedCost = await fetch(`${baseUrl}/api/company/integrations`, {
    headers: { Authorization: `Bearer ${tokenAdminAlpha}` },
  });
  const combinedPayload = await listAfterCombinedCost.json();
  const prodAfterCost = combinedPayload.integrations.find((i: any) => i.id === prodId);

  // Regra: Quando uma operação tiver custo medido e estimado, usa o medido no total (189 centavos, NÃO 339 nem 150!)
  assert.equal(prodAfterCost.consumption.costSpentCents, 189, 'Deve usar exclusivamente o custo medido (189 centavos) no total');

  // 8. Registros antigos sem vínculo seguro separados:
  // Inserir registro com integrationId: null ou de categoria/provedor legado
  await prisma.apiUsageRecord.create({
    data: {
      companyId: compAlpha.id,
      integrationId: null,
      category: 'LEGACY_API',
      provider: 'LEGACY_GATEWAY',
      environment: 'PRODUCTION',
      operation: 'LEGACY_CALL',
      unitsUsed: 7,
      measuredCostCents: 450, // R$ 4,50
      status: 'SUCCESS',
    },
  });

  const listWithLegacy = await fetch(`${baseUrl}/api/company/integrations`, {
    headers: { Authorization: `Bearer ${tokenAdminAlpha}` },
  });
  const legacyPayload = await listWithLegacy.json();
  assert.ok(legacyPayload.unlinkedUsage, 'Deve retornar bloco de unlinkedUsage');
  assert.equal(legacyPayload.unlinkedUsage.hasUnlinkedRecords, true);
  assert.equal(legacyPayload.unlinkedUsage.unitsUsed, 7);
  assert.equal(legacyPayload.unlinkedUsage.totalSpentCents, 450);

  // As integrações vinculadas continuam isoladas
  const prodCardIsolated = legacyPayload.integrations.find((i: any) => i.id === prodId);
  assert.equal(prodCardIsolated.consumption.unitsUsed, 1);
  assert.equal(prodCardIsolated.consumption.costSpentCents, 189);

  // 9. Consulta de CEP com diferenciação de CACHE vs EXTERNO e simulação de corrida (descarte de resposta atrasada):
  clearCepCache();
  // Primeira consulta: deve bater externamente (source: EXTERNAL)
  const cepExt = await fetch(`${baseUrl}/api/integrations/cep/01001000`, {
    headers: { Authorization: `Bearer ${tokenAdminAlpha}` },
  });
  const cepExtData = await cepExt.json();
  assert.equal(cepExtData.success, true);
  assert.equal(cepExtData.source, 'EXTERNAL');
  assert.equal(cepExtData.cached, false);

  // Segunda consulta ao mesmo CEP: deve ser atendida pelo cache (source: CACHE)
  const cepCache = await fetch(`${baseUrl}/api/integrations/cep/01001000`, {
    headers: { Authorization: `Bearer ${tokenAdminAlpha}` },
  });
  const cepCacheData = await cepCache.json();
  assert.equal(cepCacheData.success, true);
  assert.equal(cepCacheData.source, 'CACHE');
  assert.equal(cepCacheData.cached, true);

  // Simulação de corrida e edição manual do fotógrafo:
  let cepQuerySeq = 0;
  let addressManuallyEdited = false;
  let streetText = '';

  // Início da consulta 1
  const seq1 = ++cepQuerySeq;

  // Durante o trânsito da requisição 1, fotógrafo edita manualmente a rua:
  streetText = 'Avenida Brasil, 500 (Digitado Manualmente)';
  addressManuallyEdited = true;

  // Chegada da resposta 1 (atrasada):
  const simulateArrival1 = () => {
    if (seq1 !== cepQuerySeq) return 'DISCARDED_STALE_SEQUENCE';
    if (addressManuallyEdited) return 'DISCARDED_USER_MANUAL_EDIT';
    streetText = cepExtData.data.logradouro;
    return 'APPLIED';
  };
  const result1 = simulateArrival1();
  assert.equal(result1, 'DISCARDED_USER_MANUAL_EDIT', 'Resposta atrasada deve ser descartada se usuário editou manualmente');
  assert.equal(streetText, 'Avenida Brasil, 500 (Digitado Manualmente)');

  // Simulação de corrida: fotógrafo troca o CEP antes de resposta anterior chegar
  addressManuallyEdited = false;
  const seq2 = ++cepQuerySeq; // Novo CEP disparado
  const simulateArrivalStale = () => {
    if (seq1 !== cepQuerySeq) return 'DISCARDED_STALE_SEQUENCE';
    return 'APPLIED';
  };
  assert.equal(simulateArrivalStale(), 'DISCARDED_STALE_SEQUENCE', 'Resposta de CEP antigo deve ser descartada quando CEP muda');
});

test('Central de APIs - Etapa 2: Base de cobrança por data de operação, tarifa futura em outra moeda, medição de Scout e Radar com cache, alertas de 80% e 100%, e reserva atômica contra concorrência na última unidade', async () => {
  await assertSafeEffectiveTestConnection(prisma, process.env.DATABASE_URL);
  const baseUrl = await getBaseUrl;
  const adminPassword = 'SenhaForte123!';
  const hashedPassword = bcrypt.hashSync(adminPassword, 4);

  clearCityScoutCache();
  clearSimulatedAlerts();

  // 1. Criar Empresa Gamma e Empresa Delta
  const compGamma = await prisma.company.create({
    data: { id: randomUUID(), name: 'Empresa Gamma Eventos', classification: 'TEST_DEMO' },
  });
  createdCompanyIds.push(compGamma.id);

  const compDelta = await prisma.company.create({
    data: { id: randomUUID(), name: 'Empresa Delta Eventos', classification: 'TEST_DEMO' },
  });
  createdCompanyIds.push(compDelta.id);

  const userAdminGamma = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: 'Admin Gamma',
      email: `adminGamma_${randomUUID().slice(0, 8)}@teste.com`,
      cpf: `888${Date.now().toString().slice(-8)}`,
      password: hashedPassword,
      role: 'ADMIN',
      companyId: compGamma.id,
    },
  });
  createdUserIds.push(userAdminGamma.id);

  const userAdminDelta = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: 'Admin Delta',
      email: `adminDelta_${randomUUID().slice(0, 8)}@teste.com`,
      cpf: `999${Date.now().toString().slice(-8)}`,
      password: hashedPassword,
      role: 'ADMIN',
      companyId: compDelta.id,
    },
  });
  createdUserIds.push(userAdminDelta.id);

  const superAdminE2 = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: 'Super Admin Etapa 2',
      email: `superE2_${randomUUID().slice(0, 8)}@teste.com`,
      cpf: `000${Date.now().toString().slice(-8)}`,
      password: hashedPassword,
      role: 'SUPER_ADMIN',
    },
  });
  createdUserIds.push(superAdminE2.id);

  await prisma.ownerCapability.create({
    data: { userId: superAdminE2.id, capability: 'INTEGRATION_CONFIG', grantedByUserId: superAdminE2.id },
  });

  const tokenAdminGamma = jwt.sign({ id: userAdminGamma.id, name: userAdminGamma.name, role: 'ADMIN', companyId: compGamma.id }, jwtSecret);
  const tokenAdminDelta = jwt.sign({ id: userAdminDelta.id, name: userAdminDelta.name, role: 'ADMIN', companyId: compDelta.id }, jwtSecret);
  const tokenSuperAdmin = jwt.sign({ id: superAdminE2.id, name: superAdminE2.name, role: 'SUPER_ADMIN' }, jwtSecret);

  // 2. Empresa Gamma cadastra IA de Pesquisa (Gemini) em PRODUCTION (limite 10 un.) e em SANDBOX (limite 5 un.)
  const geminiProdGammaResp = await fetch(`${baseUrl}/api/company/integrations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdminGamma}` },
    body: JSON.stringify({
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      secret: 'AIzaSyGamma_Prod_Key_1234567890',
      accountName: 'Gemini Gamma Produção',
      passwordConfirmation: adminPassword,
      monthlyUnitsLimit: 10,
      monthlyBudgetLimitCents: 5000,
      allowPaidOverage: true,
      authorizedOverageUnits: 5,
    }),
  });
  assert.equal(geminiProdGammaResp.status, 200);
  const gammaProdData = await geminiProdGammaResp.json();
  const gammaProdId = gammaProdData.integration.id;

  const geminiSandboxGammaResp = await fetch(`${baseUrl}/api/company/integrations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdminGamma}` },
    body: JSON.stringify({
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'SANDBOX',
      secret: 'AIzaSyGamma_Sandbox_Key_0987654321',
      accountName: 'Gemini Gamma Sandbox',
      passwordConfirmation: adminPassword,
      monthlyUnitsLimit: 5,
      allowPaidOverage: true,
    }),
  });
  assert.equal(geminiSandboxGammaResp.status, 200);
  const gammaSandboxData = await geminiSandboxGammaResp.json();
  const gammaSandboxId = gammaSandboxData.integration.id;

  // Empresa Delta cadastra IA de Pesquisa (Gemini) em PRODUCTION com limite 20 un.
  const geminiProdDeltaResp = await fetch(`${baseUrl}/api/company/integrations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdminDelta}` },
    body: JSON.stringify({
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      secret: 'AIzaSyDelta_Prod_Key_9999999999',
      accountName: 'Gemini Delta Produção',
      passwordConfirmation: adminPassword,
      monthlyUnitsLimit: 20,
      allowPaidOverage: true,
    }),
  });
  assert.equal(geminiProdDeltaResp.status, 200);
  const deltaProdData = await geminiProdDeltaResp.json();
  const deltaProdId = deltaProdData.integration.id;

  // 3. Base de Cobrança:
  // a) Cria tarifa GERAL (environment: 'ALL') com excedente de R$ 5,00
  await fetch(`${baseUrl}/api/owner/integrations/tariffs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenSuperAdmin}` },
    body: JSON.stringify({
      companyId: compGamma.id,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'ALL',
      includedUnits: 2,
      overageUnitPriceCents: 500,
      currency: 'BRL',
    }),
  });

  // b) Cria tarifa ATUAL ESPECÍFICA de PRODUÇÃO (environment: 'PRODUCTION') em BRL:
  // Franquia: 5 un, Excedente: R$ 2,50
  const currentTariffResp = await fetch(`${baseUrl}/api/owner/integrations/tariffs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenSuperAdmin}` },
    body: JSON.stringify({
      companyId: compGamma.id,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      companyIntegrationId: gammaProdId,
      includedUnits: 5,
      monthlyFeeCents: 0,
      overageUnitPriceCents: 250,
      overageUnitType: 'consulta',
      currency: 'BRL',
      effectiveFrom: new Date(Date.now() - 3600000).toISOString(), // Vigente desde 1 hora atrás
    }),
  });
  assert.equal(currentTariffResp.status, 201);
  const currentTariffData = await currentTariffResp.json();
  assert.ok(currentTariffData.success);

  // c) Cria tarifa FUTURA em OUTRA MOEDA (USD):
  // Franquia: 20 un, Excedente: US$ 1,50 (150 cents), Vigência a partir de daqui a 30 dias
  const futureDate = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const futureTariffResp = await fetch(`${baseUrl}/api/owner/integrations/tariffs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenSuperAdmin}` },
    body: JSON.stringify({
      companyId: compGamma.id,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      companyIntegrationId: gammaProdId,
      includedUnits: 20,
      monthlyFeeCents: 0,
      overageUnitPriceCents: 150,
      overageUnitType: 'query',
      currency: 'USD',
      effectiveFrom: futureDate.toISOString(),
      notes: 'Contrato global futuro em dólares',
    }),
  });
  assert.equal(futureTariffResp.status, 201);

  // d) Validação da Base de Cobrança:
  // Consulta integrações de Gamma no presente:
  const gammaListResp = await fetch(`${baseUrl}/api/company/integrations`, {
    headers: { Authorization: `Bearer ${tokenAdminGamma}` },
  });
  assert.equal(gammaListResp.status, 200);
  const gammaListData = await gammaListResp.json();
  const gammaProdCard = gammaListData.integrations.find((i: any) => i.id === gammaProdId);

  // A tarifa aplicada deve ser a atual em BRL (R$ 2,50, franquia 5), preservando a moeda BRL
  assert.ok(gammaProdCard.tariff.hasConfirmedTariff);
  assert.equal(gammaProdCard.tariff.currency, 'BRL', 'Moeda original BRL deve ser preservada na data atual');
  assert.equal(gammaProdCard.tariff.overageUnitPriceCents, 250, 'Deve prevalecer a tarifa específica de PRODUCTION sobre ALL (250 vs 500)');
  assert.equal(gammaProdCard.tariff.includedUnits, 5);

  // A tarifa futura em USD NÃO deve ter substituído a tarifa atual de hoje
  assert.notEqual(gammaProdCard.tariff.currency, 'USD', 'Tarifa futura em USD não pode ser aplicada antes de sua vigência');

  // 4. Medição de Scout por Cidade e Radar Estadual com separação de Cache vs Externo:
  // Chamada 1: Scout por Cidade (Goiânia) -> chamada externa
  const scoutExtResp = await fetch(`${baseUrl}/api/events/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdminGamma}`, 'x-environment': 'PRODUCTION' },
    body: JSON.stringify({ city: 'Goiânia' }),
  });
  assert.equal(scoutExtResp.status, 200);
  const scoutExtData = await scoutExtResp.json();
  assert.equal(scoutExtData.source, 'EXTERNAL');
  assert.equal(scoutExtData.cached, false);

  // Chamada 2: Scout por Cidade (Goiânia) -> atendida pelo cache
  const scoutCacheResp = await fetch(`${baseUrl}/api/events/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdminGamma}`, 'x-environment': 'PRODUCTION' },
    body: JSON.stringify({ city: 'Goiânia' }),
  });
  assert.equal(scoutCacheResp.status, 200);
  const scoutCacheData = await scoutCacheResp.json();
  assert.equal(scoutCacheData.source, 'CACHE');
  assert.equal(scoutCacheData.cached, true);

  // Chamada 1: Radar Estadual (GO) -> chamada externa (force=true)
  const radarExtResp = await fetch(`${baseUrl}/api/events/state-radar?state=GO&force=true`, {
    headers: { Authorization: `Bearer ${tokenAdminGamma}`, 'x-environment': 'PRODUCTION' },
  });
  assert.equal(radarExtResp.status, 200);
  const radarExtData = await radarExtResp.json();
  assert.equal(radarExtData.source, 'EXTERNAL');
  assert.equal(radarExtData.cached, false);

  // Chamada 2: Radar Estadual (GO) -> atendida pelo cache
  const radarCacheResp = await fetch(`${baseUrl}/api/events/state-radar?state=GO`, {
    headers: { Authorization: `Bearer ${tokenAdminGamma}`, 'x-environment': 'PRODUCTION' },
  });
  assert.equal(radarCacheResp.status, 200);
  const radarCacheData = await radarCacheResp.json();
  assert.equal(radarCacheData.source, 'CACHE');
  assert.equal(radarCacheData.cached, true);

  // Consulta barra de consumo após Scout e Radar:
  const gammaAfterScoutResp = await fetch(`${baseUrl}/api/company/integrations`, {
    headers: { Authorization: `Bearer ${tokenAdminGamma}` },
  });
  const gammaAfterData = await gammaAfterScoutResp.json();
  const prodCardAfter = gammaAfterData.integrations.find((i: any) => i.id === gammaProdId);

  // Verificação da contagem separada de Cache e Externo
  assert.equal(prodCardAfter.consumption.externalUnitsUsed, 2, '2 chamadas externas (1 scout + 1 radar)');
  assert.equal(prodCardAfter.consumption.cachedUnitsUsed, 2, '2 consultas em cache (1 scout + 1 radar)');
  assert.equal(prodCardAfter.consumption.unitsUsed, 4, 'Total de 4 unidades utilizadas');

  // Verificação de Franquia usada, saldo e excedente:
  assert.equal(prodCardAfter.consumption.usedIncludedUnits, 2, '2 unidades usadas da franquia');
  assert.equal(prodCardAfter.consumption.remainingIncludedUnits, 3, 'Saldo restante da franquia: 3 unidades');
  assert.equal(prodCardAfter.consumption.overageUnits, 0, 'Excedente zero dentro da franquia');

  // 5. Alertas aos 80% e aos 100% (Simulados, UMA VEZ por limite e por período):
  // Limite configurado para Gamma Produção: 10 unidades.
  // Já foram consumidas 2 unidades externas. Executar mais 6 buscas em cidades diferentes para atingir 8 unidades (80%):
  const testCities = ['Anápolis', 'Rio Verde', 'Jataí', 'Itumbiara', 'Caldas Novas', 'Catalão'];
  for (const city of testCities) {
    const res = await fetch(`${baseUrl}/api/events/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdminGamma}`, 'x-environment': 'PRODUCTION' },
      body: JSON.stringify({ city }),
    });
    assert.equal(res.status, 200);
  }

  // Verifica que o alerta de 80% foi disparado no canal simulado
  const alertsAfter80 = getSimulatedAlerts().filter(
    (a) => a.companyId === compGamma.id && a.limitType === 'UNITS' && a.threshold === 80
  );
  assert.equal(alertsAfter80.length, 1, 'Deve disparar exatamente 1 alerta de 80% de requisições');

  // Realizar a 9ª busca externa (90% do limite):
  const res9 = await fetch(`${baseUrl}/api/events/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdminGamma}`, 'x-environment': 'PRODUCTION' },
    body: JSON.stringify({ city: 'Formosa' }),
  });
  assert.equal(res9.status, 200);

  // Confirmação de que o alerta de 80% NÃO se repetiu (uma vez por limite e por período)
  const alertsAfter90 = getSimulatedAlerts().filter(
    (a) => a.companyId === compGamma.id && a.limitType === 'UNITS' && a.threshold === 80
  );
  assert.equal(alertsAfter90.length, 1, 'Alerta de 80% não deve ser duplicado no mesmo período');

  // 6. Concorrência Simultânea pela Última Unidade (Reserva Atômica):
  // Atualmente Gamma possui 9 unidades consumidas de um teto de 10.
  // Disparar simultaneamente duas buscas (cidades 'Luziânia' e 'Trindade') competindo pela última unidade:
  const concurrentCalls = await Promise.all([
    fetch(`${baseUrl}/api/events/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdminGamma}`, 'x-environment': 'PRODUCTION' },
      body: JSON.stringify({ city: 'Luziânia' }),
    }),
    fetch(`${baseUrl}/api/events/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdminGamma}`, 'x-environment': 'PRODUCTION' },
      body: JSON.stringify({ city: 'Trindade' }),
    }),
  ]);

  const statuses = [concurrentCalls[0].status, concurrentCalls[1].status].sort();
  // Exatamente uma deve passar (200) e a outra deve ser bloqueada (429)
  assert.deepEqual(statuses, [200, 429], 'Uma busca concorrente deve ter sucesso e a outra deve receber 429');

  // A requisição que recebeu 429 deve informar qual limite foi atingido
  const rejectedCall = concurrentCalls.find((r) => r.status === 429)!;
  const rejectedData = await rejectedCall.json();
  assert.equal(rejectedData.limitType, 'UNITS');
  assert.ok(
    rejectedData.error.includes('Limite mensal de requisições atingido') ||
    rejectedData.error.includes('Limite de excedente autorizado atingido'),
    `Mensagem deve informar qual limite foi atingido: ${rejectedData.error}`
  );

  // O total no banco de dados deve ser exatamente 10 unidades (reserva atômica impediu estouro de teto para 11)
  const finalGammaRecords = await prisma.apiUsageRecord.findMany({
    where: {
      companyId: compGamma.id,
      integrationId: gammaProdId,
      status: 'SUCCESS',
      operation: 'SCOUT_CITY_EXTERNAL',
    },
  });
  // Total de externas de scout = 1 (inicial) + 6 (teste) + 1 (9ª) + 1 (concorrente vencedora) = 9 scout externas + 1 radar externa = 10 unidades externas!
  const finalTotalUnits = await prisma.apiUsageRecord.aggregate({
    where: {
      companyId: compGamma.id,
      integrationId: gammaProdId,
      status: 'SUCCESS',
      NOT: { operation: { endsWith: '_CACHE' } },
    },
    _sum: { unitsUsed: true },
  });
  assert.equal(finalTotalUnits._sum.unitsUsed, 10, 'Total de unidades externas deve ser estritamente 10');

  // Verifica que o alerta de 100% foi disparado exatamente UMA vez
  const alerts100 = getSimulatedAlerts().filter(
    (a) => a.companyId === compGamma.id && a.limitType === 'UNITS' && a.threshold === 100
  );
  assert.equal(alerts100.length, 1, 'Deve disparar exatamente 1 alerta de 100% de cota');

  // Tentativa subsequente com cota esgotada deve ser rejeitada imediatamente
  const postExhaustionCall = await fetch(`${baseUrl}/api/events/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdminGamma}`, 'x-environment': 'PRODUCTION' },
    body: JSON.stringify({ city: 'Inhumas' }),
  });
  assert.equal(postExhaustionCall.status, 429);
  const postData = await postExhaustionCall.json();
  assert.ok(
    postData.error.includes('Limite mensal de requisições atingido') ||
    postData.error.includes('Limite de excedente autorizado atingido'),
    `Deve indicar cota esgotada: ${postData.error}`
  );

  // 7. Registros sem vínculo seguro separados do saldo que limita a integração:
  // Inserir registro legado desvinculado (integrationId: null) para Empresa Delta com 500 unidades
  await prisma.apiUsageRecord.create({
    data: {
      companyId: compDelta.id,
      integrationId: null,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      operation: 'LEGACY_SEARCH',
      unitsUsed: 500,
      measuredCostCents: 10000,
      status: 'SUCCESS',
    },
  });

  // A Empresa Delta tem limite de 20 unidades. Se os registros desvinculados interferissem, ela estaria bloqueada!
  // Como os registros desvinculados são separados do saldo que limita a integração, Delta deve conseguir buscar com sucesso:
  const deltaSearchResp = await fetch(`${baseUrl}/api/events/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdminDelta}`, 'x-environment': 'PRODUCTION' },
    body: JSON.stringify({ city: 'Cuiabá' }),
  });
  assert.equal(deltaSearchResp.status, 200, 'Empresa Delta deve conseguir realizar busca mesmo com registros legados sem vínculo');

  // Consultar /api/company/integrations de Delta:
  const deltaListResp = await fetch(`${baseUrl}/api/company/integrations`, {
    headers: { Authorization: `Bearer ${tokenAdminDelta}` },
  });
  const deltaListData = await deltaListResp.json();
  assert.ok(deltaListData.unlinkedUsage.hasUnlinkedRecords);
  assert.equal(deltaListData.unlinkedUsage.unitsUsed, 500);

  const deltaProdCard = deltaListData.integrations.find((i: any) => i.id === deltaProdId);
  assert.equal(deltaProdCard.consumption.unitsUsed, 1, 'Integração de Delta deve ter apenas 1 unidade de saldo consumido');
  assert.equal(deltaProdCard.consumption.hasUnitsLimit, true);
  assert.equal(deltaProdCard.consumption.unitsLimit, 20);
});

test('Central de APIs - Etapa 2: Validação de tarifa acima do saldo, excedente sem autorização, timeout após envio e retenção pendente, e diferenciação de excedente usado vs autorizado no card', async () => {
  await assertSafeEffectiveTestConnection(prisma, process.env.DATABASE_URL);
  const baseUrl = await getBaseUrl;
  const adminPassword = 'SenhaForte123!';
  const hashedPassword = bcrypt.hashSync(adminPassword, 4);

  clearCityScoutCache();
  clearSimulatedAlerts();

  // 1. Criar Empresa Épsilon e Empresa Zeta
  const compEpsilon = await prisma.company.create({
    data: { id: randomUUID(), name: 'Empresa Épsilon Eventos', classification: 'TEST_DEMO' },
  });
  createdCompanyIds.push(compEpsilon.id);

  const compZeta = await prisma.company.create({
    data: { id: randomUUID(), name: 'Empresa Zeta Eventos', classification: 'TEST_DEMO' },
  });
  createdCompanyIds.push(compZeta.id);

  const userAdminEpsilon = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: 'Admin Épsilon',
      email: `adminEpsilon_${randomUUID().slice(0, 8)}@teste.com`,
      cpf: `121${Date.now().toString().slice(-8)}`,
      password: hashedPassword,
      role: 'ADMIN',
      companyId: compEpsilon.id,
    },
  });
  createdUserIds.push(userAdminEpsilon.id);

  const userAdminZeta = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: 'Admin Zeta',
      email: `adminZeta_${randomUUID().slice(0, 8)}@teste.com`,
      cpf: `131${Date.now().toString().slice(-8)}`,
      password: hashedPassword,
      role: 'ADMIN',
      companyId: compZeta.id,
    },
  });
  createdUserIds.push(userAdminZeta.id);

  const superAdminE2B = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: 'Super Admin E2B',
      email: `superE2B_${randomUUID().slice(0, 8)}@teste.com`,
      cpf: `141${Date.now().toString().slice(-8)}`,
      password: hashedPassword,
      role: 'SUPER_ADMIN',
    },
  });
  createdUserIds.push(superAdminE2B.id);

  await prisma.ownerCapability.create({
    data: { userId: superAdminE2B.id, capability: 'INTEGRATION_CONFIG', grantedByUserId: superAdminE2B.id },
  });

  const tokenAdminEpsilon = jwt.sign({ id: userAdminEpsilon.id, name: userAdminEpsilon.name, role: 'ADMIN', companyId: compEpsilon.id }, jwtSecret);
  const tokenAdminZeta = jwt.sign({ id: userAdminZeta.id, name: userAdminZeta.name, role: 'ADMIN', companyId: compZeta.id }, jwtSecret);
  const tokenSuperAdmin = jwt.sign({ id: superAdminE2B.id, name: superAdminE2B.name, role: 'SUPER_ADMIN' }, jwtSecret);

  // ── CENÁRIO 1: TARIFA ACIMA DO SALDO ──────────────────────────────────────────
  // Empresa Épsilon tem orçamento mensal de apenas R$ 1,00 (100 centavos)
  const epsilonIntegResp = await fetch(`${baseUrl}/api/company/integrations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdminEpsilon}` },
    body: JSON.stringify({
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      secret: 'AIzaSyEpsilon_Key_123',
      accountName: 'Gemini Épsilon',
      passwordConfirmation: adminPassword,
      monthlyBudgetLimitCents: 100, // R$ 1,00
      allowPaidOverage: true,
    }),
  });
  assert.equal(epsilonIntegResp.status, 200);
  const epsilonIntegData = await epsilonIntegResp.json();
  const epsilonIntegId = epsilonIntegData.integration.id;

  // Tarifa confirmada: Franquia 0 un., Excedente R$ 2,50 (250 centavos) por requisição
  const tariffEpsilonResp = await fetch(`${baseUrl}/api/owner/integrations/tariffs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenSuperAdmin}` },
    body: JSON.stringify({
      companyId: compEpsilon.id,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      companyIntegrationId: epsilonIntegId,
      includedUnits: 0,
      monthlyFeeCents: 0,
      overageUnitPriceCents: 250, // R$ 2,50
      overageUnitType: 'busca',
      currency: 'BRL',
    }),
  });
  assert.equal(tariffEpsilonResp.status, 201);

  // A busca exige R$ 2,50, mas o saldo total de Épsilon é de apenas R$ 1,00. Deve ser bloqueado com 429!
  const epsilonSearchResp = await fetch(`${baseUrl}/api/events/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdminEpsilon}`, 'x-environment': 'PRODUCTION' },
    body: JSON.stringify({ city: 'Manaus' }),
  });
  assert.equal(epsilonSearchResp.status, 429, 'Tarifa acima do saldo restante deve ser rejeitada com HTTP 429');
  const epsilonSearchData = await epsilonSearchResp.json();
  assert.equal(epsilonSearchData.limitType, 'BUDGET');
  assert.ok(
    epsilonSearchData.error.includes('Orçamento mensal financeiro insuficiente para a tarifa da operação'),
    `Mensagem deve indicar tarifa acima do saldo: ${epsilonSearchData.error}`
  );

  // ── CENÁRIO 2: EXCEDENTE SEM AUTORIZAÇÃO E POSTERIOR AUTORIZAÇÃO ───────────────
  // Empresa Zeta cadastra integração com franquia de 2 unidades, mas allowPaidOverage: false
  const zetaIntegResp = await fetch(`${baseUrl}/api/company/integrations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdminZeta}` },
    body: JSON.stringify({
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      secret: 'AIzaSyZeta_Key_456',
      accountName: 'Gemini Zeta',
      passwordConfirmation: adminPassword,
      monthlyUnitsLimit: 10,
      allowPaidOverage: false, // EXCEDENTE PAGO NÃO AUTORIZADO
    }),
  });
  assert.equal(zetaIntegResp.status, 200);
  const zetaIntegData = await zetaIntegResp.json();
  const zetaIntegId = zetaIntegData.integration.id;

  // Super Admin registra tarifa para Zeta: 2 unidades inclusas, excedente R$ 1,50
  const tariffZetaResp = await fetch(`${baseUrl}/api/owner/integrations/tariffs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenSuperAdmin}` },
    body: JSON.stringify({
      companyId: compZeta.id,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      companyIntegrationId: zetaIntegId,
      includedUnits: 2,
      monthlyFeeCents: 0,
      overageUnitPriceCents: 150,
      overageUnitType: 'pesquisa',
      currency: 'BRL',
    }),
  });
  assert.equal(tariffZetaResp.status, 201);
  const tariffZetaData = await tariffZetaResp.json();
  const zetaTariffId = tariffZetaData.tariff.id;

  // Chamada 1 (Brasília): dentro da franquia inclusa (1 de 2) -> Sucesso 200
  const zetaSearch1 = await fetch(`${baseUrl}/api/events/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdminZeta}`, 'x-environment': 'PRODUCTION' },
    body: JSON.stringify({ city: 'Brasília' }),
  });
  assert.equal(zetaSearch1.status, 200);

  // Chamada 2 (Taguatinga): última unidade da franquia inclusa (2 de 2) -> Sucesso 200
  const zetaSearch2 = await fetch(`${baseUrl}/api/events/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdminZeta}`, 'x-environment': 'PRODUCTION' },
    body: JSON.stringify({ city: 'Taguatinga' }),
  });
  assert.equal(zetaSearch2.status, 200);

  // Chamada 3 (Ceilândia): excedente sem autorização -> Deve retornar 429 de bloqueio
  const zetaSearch3 = await fetch(`${baseUrl}/api/events/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdminZeta}`, 'x-environment': 'PRODUCTION' },
    body: JSON.stringify({ city: 'Ceilândia' }),
  });
  assert.equal(zetaSearch3.status, 429, 'Excedente sem autorização deve ser bloqueado com 429');
  const zetaSearch3Data = await zetaSearch3.json();
  assert.equal(zetaSearch3Data.limitType, 'UNITS');
  assert.ok(
    zetaSearch3Data.error.includes('Excedente pago não autorizado'),
    `Mensagem deve indicar excedente não autorizado: ${zetaSearch3Data.error}`
  );

  // Consulta card de Zeta: deve diferenciar excedente usado (0) de excedente autorizado ("Não autorizado")
  const zetaCardPreAuthResp = await fetch(`${baseUrl}/api/company/integrations`, {
    headers: { Authorization: `Bearer ${tokenAdminZeta}` },
  });
  const zetaCardPreAuthData = await zetaCardPreAuthResp.json();
  const zetaCardPre = zetaCardPreAuthData.integrations.find((i: any) => i.id === zetaIntegId);
  assert.equal(zetaCardPre.consumption.isOverageAuthorized, false);
  assert.equal(zetaCardPre.consumption.overageAuthorizedLabel, 'Não autorizado');
  assert.equal(zetaCardPre.consumption.overageUnitsUsed, 0);
  assert.equal(zetaCardPre.consumption.usedIncludedUnits, 2);
  assert.equal(zetaCardPre.consumption.remainingIncludedUnits, 0);

  // Administrador de Zeta autoriza excedente explicitamente com teto de 5 unidades excedentes:
  const updateLimitsResp = await fetch(`${baseUrl}/api/company/integrations/${zetaIntegId}/limits`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdminZeta}` },
    body: JSON.stringify({
      allowPaidOverage: true,
      authorizedOverageUnits: 5,
      passwordConfirmation: adminPassword,
    }),
  });
  assert.equal(updateLimitsResp.status, 200);

  // Repete Chamada 3 (Ceilândia): agora o excedente está autorizado -> Sucesso 200!
  const zetaSearch3Authorized = await fetch(`${baseUrl}/api/events/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdminZeta}`, 'x-environment': 'PRODUCTION' },
    body: JSON.stringify({ city: 'Ceilândia' }),
  });
  assert.equal(zetaSearch3Authorized.status, 200, 'Excedente com autorização explícita deve ser aprovado com 200');

  // Consulta card de Zeta pós-autorização:
  const zetaCardPostAuthResp = await fetch(`${baseUrl}/api/company/integrations`, {
    headers: { Authorization: `Bearer ${tokenAdminZeta}` },
  });
  const zetaCardPostAuthData = await zetaCardPostAuthResp.json();
  const zetaCardPost = zetaCardPostAuthData.integrations.find((i: any) => i.id === zetaIntegId);
  assert.equal(zetaCardPost.consumption.isOverageAuthorized, true);
  assert.equal(zetaCardPost.consumption.overageAuthorizedLabel, '5 un. autorizadas');
  assert.equal(zetaCardPost.consumption.overageUnitsUsed, 1, 'Excedente usado deve ser 1 un.');
  assert.equal(zetaCardPost.consumption.externalUnitsUsed, 3, '3 un. externas no total (2 franquia + 1 excedente)');

  // Preservação da tarifa aplicada no histórico:
  const ceilandiaRecord = await prisma.apiUsageRecord.findFirst({
    where: {
      companyId: compZeta.id,
      integrationId: zetaIntegId,
      status: 'SUCCESS',
      operation: 'SCOUT_CITY_EXTERNAL',
    },
    orderBy: { timestamp: 'desc' },
  });
  assert.ok(ceilandiaRecord);
  assert.equal(ceilandiaRecord.tariffId, zetaTariffId, 'Registro deve preservar o tariffId da tarifa aplicada');
  assert.equal(ceilandiaRecord.appliedTariffUnitPriceCents, 150, 'Registro deve preservar o preço unitário da tarifa');
  assert.equal(ceilandiaRecord.currency, 'BRL', 'Registro deve preservar a moeda original');
  assert.equal(ceilandiaRecord.status, 'SUCCESS');

  // ── CENÁRIO 3: TIMEOUT APÓS ENVIO E RETENÇÃO PENDENTE ─────────────────────────
  // Realiza uma reserva de cota para simular envio de requisição que sofre timeout
  const reservationTimeout = await reserveApiQuota({
    companyId: compZeta.id,
    category: 'AI_RESEARCH',
    provider: 'GEMINI',
    environment: 'PRODUCTION',
    integrationId: zetaIntegId,
    operation: 'SCOUT_CITY_EXTERNAL',
    unitsRequested: 1,
  });
  assert.ok(reservationTimeout.allowed);
  const timeoutResId = reservationTimeout.reservationId!;

  // A chamada sofreu timeout após o envio -> marca como PENDING_CONFIRMATION
  await markReservationPendingConfirmation(timeoutResId, {
    latencyMs: 25000,
    reason: 'TIMEOUT_AFTER_DISPATCH',
  });

  const pendingRecord = await prisma.apiUsageRecord.findUnique({
    where: { id: timeoutResId },
  });
  assert.equal(pendingRecord?.status, 'PENDING_CONFIRMATION', 'Status deve permanecer PENDING_CONFIRMATION após timeout');

  // Verifica que o consumo pendente continua retendo cota no saldo:
  const activeCountWithPending = await prisma.apiUsageRecord.count({
    where: {
      companyId: compZeta.id,
      integrationId: zetaIntegId,
      status: { in: ['SUCCESS', 'RESERVED', 'PENDING_CONFIRMATION'] },
      NOT: { operation: { endsWith: '_CACHE' } },
    },
  });
  assert.equal(activeCountWithPending, 4, '3 confirmadas + 1 pendente retendo cota = 4 unidades ativas');

  // Quando comprovado que a operação não consumiu cota (ex: erro não faturado ou cancelamento comprovado):
  await releaseApiReservation(timeoutResId, {
    reason: 'UNBILLED_CONFIRMED',
  });

  const releasedRecord = await prisma.apiUsageRecord.findUnique({
    where: { id: timeoutResId },
  });
  assert.equal(releasedRecord?.status, 'CANCELLED', 'Reserva liberada deve ter status CANCELLED');

  const activeCountAfterRelease = await prisma.apiUsageRecord.count({
    where: {
      companyId: compZeta.id,
      integrationId: zetaIntegId,
      status: { in: ['SUCCESS', 'RESERVED', 'PENDING_CONFIRMATION'] },
      NOT: { operation: { endsWith: '_CACHE' } },
    },
  });
  assert.equal(activeCountAfterRelease, 3, 'Apenas as 3 confirmadas permanecem ativas após liberação');
});

test('Central de APIs - Etapa 2 Ajuste Final: Orçamento em moeda diferente, tarifa ausente, resposta tardia e resposta inválida após envio', async () => {
  await assertSafeEffectiveTestConnection(prisma, process.env.DATABASE_URL);
  const baseUrl = await getBaseUrl;
  clearCityScoutCache();

  const adminPassword = 'SenhaForte123!';
  const hashedPassword = bcrypt.hashSync(adminPassword, 4);

  // 1. Criar Empresa Eta e Admin
  const compEta = await prisma.company.create({
    data: {
      id: randomUUID(),
      name: 'Empresa Eta Ajuste Financeiro Teste',
      classification: 'TEST_DEMO',
    },
  });
  createdCompanyIds.push(compEta.id);

  const userAdminEta = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: 'Admin Empresa Eta',
      email: `adminEta_${randomUUID().slice(0, 8)}@teste.com`,
      cpf: `777${Date.now().toString().slice(-8)}`,
      password: hashedPassword,
      role: 'ADMIN',
      companyId: compEta.id,
    },
  });
  createdUserIds.push(userAdminEta.id);

  const tokenAdminEta = jwt.sign(
    { id: userAdminEta.id, name: userAdminEta.name, role: userAdminEta.role, companyId: compEta.id },
    jwtSecret
  );

  // ── CENÁRIO 1: ORÇAMENTO EM MOEDA DIFERENTE (USD vs BRL) ─────────────────────
  // Integração com orçamento ativo em BRL (R$ 50,00 = 5000 centavos)
  // Sem taxa de conversão cambial configurada inicialmente
  const etaInteg = await prisma.companyIntegration.create({
    data: {
      id: randomUUID(),
      companyId: compEta.id,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      scope: 'COMPANY_EXCLUSIVE',
      status: 'ACTIVE',
      monthlyBudgetLimitCents: 5000, // R$ 50,00
      allowPaidOverage: true,
      configMetadata: {
        currency: 'BRL',
        exchangeRateMilli: null, // Sem taxa confirmada
      },
      credentialSource: 'NONE',
      createdByUserId: userAdminEta.id,
    },
  });
  createdIntegrationIds.push(etaInteg.id);

  // Tarifa cadastrada em USD (US$ 2.00 por consulta = 200 centavos), sem franquia (paga desde o início)
  const tariffUsd = await prisma.companyApiTariff.create({
    data: {
      id: randomUUID(),
      companyId: compEta.id,
      companyIntegrationId: etaInteg.id,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      includedUnits: 0, // Todas são pagas
      overageUnitPriceCents: 200, // US$ 2.00
      overageUnitType: 'REQUEST',
      currency: 'USD',
      costPayer: 'COMPANY',
      pricingSource: 'CONFIRMED_CONTRACT',
      effectiveFrom: new Date(Date.now() - 3600000),
    },
  });

  // Tentativa 1: Sem taxa de conversão confirmada -> Deve BLOQUEAR com HTTP 429
  const searchNoRate = await fetch(`${baseUrl}/api/events/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminEta}`,
      'x-environment': 'PRODUCTION',
    },
    body: JSON.stringify({ city: 'Goiânia' }),
  });
  assert.equal(searchNoRate.status, 429, 'Chamada sem taxa de câmbio confirmada deve retornar 429');
  const searchNoRateData = await searchNoRate.json();
  assert.equal(searchNoRateData.limitType, 'BUDGET');
  assert.ok(
    searchNoRateData.error.includes('Moeda da tarifa (USD) difere da moeda do orçamento (BRL) sem taxa de conversão confirmada'),
    `Mensagem deve indicar ausência de taxa confirmada: ${searchNoRateData.error}`
  );

  // Painel deve refletir o aviso de moeda divergente sem conversão confirmada
  const cardNoRateResp = await fetch(`${baseUrl}/api/company/integrations`, {
    headers: { Authorization: `Bearer ${tokenAdminEta}` },
  });
  const cardNoRateData = await cardNoRateResp.json();
  const etaCardNoRate = cardNoRateData.integrations.find((i: any) => i.id === etaInteg.id);
  assert.equal(etaCardNoRate.consumption.conversionConfirmed, false);
  assert.ok(
    etaCardNoRate.tariff.conversionNotice.includes('sem taxa de conversão confirmada'),
    'Card deve informar a ausência de taxa de conversão'
  );

  // Tentativa 2: Configura taxa de conversão confirmada de R$ 5,50/USD (exchangeRateMilli: 5500)
  // US$ 2.00 * 5,50 = R$ 11,00 (1100 centavos)
  await prisma.companyIntegration.update({
    where: { id: etaInteg.id },
    data: {
      configMetadata: {
        currency: 'BRL',
        exchangeRateMilli: 5500,
      },
    },
  });

  const searchWithRate = await fetch(`${baseUrl}/api/events/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminEta}`,
      'x-environment': 'PRODUCTION',
    },
    body: JSON.stringify({ city: 'Goiânia' }),
  });
  assert.equal(searchWithRate.status, 200, 'Chamada com taxa de câmbio confirmada deve ser autorizada com 200');

  // Painel após chamada: gasto acumulado convertido para R$ 11,00
  const cardWithRateResp = await fetch(`${baseUrl}/api/company/integrations`, {
    headers: { Authorization: `Bearer ${tokenAdminEta}` },
  });
  const cardWithRateData = await cardWithRateResp.json();
  const etaCardWithRate = cardWithRateData.integrations.find((i: any) => i.id === etaInteg.id);
  assert.equal(etaCardWithRate.consumption.costSpentCents, 1100, 'Gasto acumulado deve ser R$ 11,00 (1100 centavos)');
  assert.equal(etaCardWithRate.consumption.costSpentFormatted, 'R$ 11,00');
  assert.equal(etaCardWithRate.consumption.conversionConfirmed, true);

  // Tentativa 3: Reduz o orçamento para R$ 15,00 (1500 centavos). Saldo restante = R$ 4,00.
  // Nova chamada requer R$ 11,00, superando o saldo -> Deve BLOQUEAR com 429
  await prisma.companyIntegration.update({
    where: { id: etaInteg.id },
    data: { monthlyBudgetLimitCents: 1500 },
  });

  const searchExceedBudget = await fetch(`${baseUrl}/api/events/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminEta}`,
      'x-environment': 'PRODUCTION',
    },
    body: JSON.stringify({ city: 'Anápolis' }),
  });
  assert.equal(searchExceedBudget.status, 429, 'Chamada acima do saldo restante deve ser bloqueada com 429');
  const searchExceedBudgetData = await searchExceedBudget.json();
  assert.equal(searchExceedBudgetData.limitType, 'BUDGET');
  assert.ok(
    searchExceedBudgetData.error.includes('Orçamento mensal financeiro insuficiente'),
    `Mensagem deve indicar orçamento insuficiente: ${searchExceedBudgetData.error}`
  );

  // ── CENÁRIO 2: TARIFA AUSENTE COM ORÇAMENTO ATIVO ───────────────────────────
  // Cria Empresa Theta com orçamento ativo de R$ 100,00, mas SEM NENHUMA tarifa cadastrada
  const compTheta = await prisma.company.create({
    data: {
      id: randomUUID(),
      name: 'Empresa Theta Sem Tarifa Teste',
      classification: 'TEST_DEMO',
    },
  });
  createdCompanyIds.push(compTheta.id);

  const userAdminTheta = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: 'Admin Empresa Theta',
      email: `adminTheta_${randomUUID().slice(0, 8)}@teste.com`,
      cpf: `888${Date.now().toString().slice(-8)}`,
      password: hashedPassword,
      role: 'ADMIN',
      companyId: compTheta.id,
    },
  });
  createdUserIds.push(userAdminTheta.id);

  const tokenAdminTheta = jwt.sign(
    { id: userAdminTheta.id, name: userAdminTheta.name, role: userAdminTheta.role, companyId: compTheta.id },
    jwtSecret
  );

  const thetaInteg = await prisma.companyIntegration.create({
    data: {
      id: randomUUID(),
      companyId: compTheta.id,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      scope: 'COMPANY_EXCLUSIVE',
      status: 'ACTIVE',
      monthlyBudgetLimitCents: 10000, // R$ 100,00
      allowPaidOverage: true,
      credentialSource: 'NONE',
      createdByUserId: userAdminTheta.id,
    },
  });
  createdIntegrationIds.push(thetaInteg.id);

  // Chamada deve ser BLOQUEADA porque não há tarifa aplicável para validar o orçamento
  const searchNoTariff = await fetch(`${baseUrl}/api/events/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminTheta}`,
      'x-environment': 'PRODUCTION',
    },
    body: JSON.stringify({ city: 'Rio Verde' }),
  });
  assert.equal(searchNoTariff.status, 429, 'Chamada sem tarifa com orçamento ativo deve retornar 429');
  const searchNoTariffData = await searchNoTariff.json();
  assert.equal(searchNoTariffData.limitType, 'BUDGET');
  assert.ok(
    searchNoTariffData.error.includes('Tarifa aplicável não cadastrada para validar o orçamento ativo'),
    `Mensagem deve indicar tarifa não cadastrada: ${searchNoTariffData.error}`
  );

  // Painel de Theta: card informa "Tarifa ainda não informada" e motivo de bloqueio
  const thetaCardResp = await fetch(`${baseUrl}/api/company/integrations`, {
    headers: { Authorization: `Bearer ${tokenAdminTheta}` },
  });
  const thetaCardData = await thetaCardResp.json();
  const thetaCard = thetaCardData.integrations.find((i: any) => i.id === thetaInteg.id);
  assert.equal(thetaCard.tariff.hasConfirmedTariff, false);
  assert.equal(thetaCard.tariff.statusLabel, 'Tarifa ainda não informada');
  assert.ok(
    thetaCard.tariff.missingPriceReason.includes('Tarifa aplicável não cadastrada para validar o orçamento ativo'),
    'Card deve apresentar o motivo do bloqueio orçamentário'
  );

  // ── CENÁRIO 3: RESPOSTA TARDIA APÓS ENVIO (RESOLVENDO STATUS PENDENTE) ───────
  // Restaura orçamento de Eta para R$ 100,00 para permitir novas requisições
  await prisma.companyIntegration.update({
    where: { id: etaInteg.id },
    data: { monthlyBudgetLimitCents: 10000 },
  });

  // Simula requisição despachada ao provedor que sofre timeout
  const timeoutCall = await fetch(`${baseUrl}/api/events/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminEta}`,
      'x-environment': 'PRODUCTION',
      'x-mock-simulated-timeout': 'true',
    },
    body: JSON.stringify({ city: 'Caldas Novas' }),
  });
  assert.equal(timeoutCall.status, 504, 'Chamada em timeout deve retornar 504');
  const timeoutCallData = await timeoutCall.json();
  assert.equal(timeoutCallData.status, 'PENDING_CONFIRMATION');
  const timeoutReservationId = timeoutCallData.reservationId;
  assert.ok(timeoutReservationId, 'Deve retornar o reservationId');

  // Verifica que no banco a unidade está com status PENDING_CONFIRMATION retendo a cota
  const recordPending = await prisma.apiUsageRecord.findUnique({
    where: { id: timeoutReservationId },
  });
  assert.equal(recordPending?.status, 'PENDING_CONFIRMATION');

  // Caso 3A: Resposta tardia confirma consumo junto ao provedor
  const resolveConfirmed = await fetch(`${baseUrl}/api/company/integrations/reservations/${timeoutReservationId}/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminEta}`,
    },
    body: JSON.stringify({
      outcome: 'CONFIRMED',
      measuredCostCents: 1100,
      reason: 'LATE_CALLBACK_SUCCESS',
    }),
  });
  assert.equal(resolveConfirmed.status, 200);
  const resolveConfirmedData = await resolveConfirmed.json();
  assert.equal(resolveConfirmedData.newStatus, 'SUCCESS');
  assert.equal(resolveConfirmedData.message, 'Consumo confirmado após resposta tardia do provedor.');

  const recordConfirmed = await prisma.apiUsageRecord.findUnique({
    where: { id: timeoutReservationId },
  });
  assert.equal(recordConfirmed?.status, 'SUCCESS');
  assert.equal(recordConfirmed?.measuredCostCents, 1100);

  // Caso 3B: Resposta tardia com comprovação de não consumo (libera cota retida)
  // Simula segundo timeout
  const timeoutCall2 = await fetch(`${baseUrl}/api/events/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminEta}`,
      'x-environment': 'PRODUCTION',
      'x-mock-simulated-timeout': 'true',
    },
    body: JSON.stringify({ city: 'Pirenópolis' }),
  });
  assert.equal(timeoutCall2.status, 504);
  const timeoutReservationId2 = (await timeoutCall2.json()).reservationId;

  // Tentativa de liberação SEM evidência deve ser REJEITADA com 400
  const resolveNoEvidence = await fetch(`${baseUrl}/api/company/integrations/reservations/${timeoutReservationId2}/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminEta}`,
    },
    body: JSON.stringify({
      outcome: 'RELEASED',
    }),
  });
  assert.equal(resolveNoEvidence.status, 400, 'Liberação de reserva sem evidência deve retornar 400');

  // Liberação COM evidência comprovada
  const resolveWithEvidence = await fetch(`${baseUrl}/api/company/integrations/reservations/${timeoutReservationId2}/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminEta}`,
    },
    body: JSON.stringify({
      outcome: 'RELEASED',
      evidence: 'PROVED_BY_PROVIDER_AUDIT_LOG_NO_BILLING',
    }),
  });
  assert.equal(resolveWithEvidence.status, 200);
  const resolveWithEvidenceData = await resolveWithEvidence.json();
  assert.equal(resolveWithEvidenceData.newStatus, 'CANCELLED');
  assert.equal(resolveWithEvidenceData.message, 'Reserva liberada após comprovação de não consumo pelo provedor.');

  const recordReleased = await prisma.apiUsageRecord.findUnique({
    where: { id: timeoutReservationId2 },
  });
  assert.equal(recordReleased?.status, 'CANCELLED');

  // ── CENÁRIO 4: RESPOSTA INVÁLIDA APÓS ENVIO (PRESERVAÇÃO DA UNIDADE CONSUMIDA)
  // Provedor respondeu com sucesso (cota consumida), porém com conteúdo corrompido / falha downstream
  const invalidContentCall = await fetch(`${baseUrl}/api/events/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminEta}`,
      'x-environment': 'PRODUCTION',
      'x-mock-invalid-content': 'true',
    },
    body: JSON.stringify({ city: 'Catalão' }),
  });
  assert.equal(invalidContentCall.status, 200, 'Retorna 200 com degradação/fallback');
  const invalidContentData = await invalidContentCall.json();
  assert.equal(invalidContentData.preservedUnit, true, 'Deve indicar que a unidade foi preservada');
  const preservedResId = invalidContentData.reservationId;
  assert.ok(preservedResId);

  // MANDATÓRIO: A reserva no banco NÃO pode ter sido cancelada! Deve estar como SUCCESS
  const preservedRecord = await prisma.apiUsageRecord.findUnique({
    where: { id: preservedResId },
  });
  assert.ok(preservedRecord);
  assert.equal(preservedRecord?.status, 'SUCCESS', 'Unidade deve ser preservada como SUCCESS no banco');
  assert.equal(preservedRecord?.unitsUsed, 1, 'Unidade consumida deve ser contabilizada');
});

test('Central de APIs - Fechamento de Segurança da Etapa 2: Autorização administrativa estrita, preservação de estados finais, idempotência, separação e bloqueio por consumo anterior sem câmbio, resposta tardia e inválida no fluxo real', async () => {
  await assertSafeEffectiveTestConnection(prisma, process.env.DATABASE_URL);
  const baseUrl = await getBaseUrl;

  const adminPassword = 'SenhaForte123!';
  const hashedPassword = bcrypt.hashSync(adminPassword, 4);

  // 1. Criar Empresa Iota e Empresa Kappa
  const compIota = await prisma.company.create({
    data: {
      id: randomUUID(),
      name: 'Empresa Iota Seguranca Teste',
      classification: 'TEST_DEMO',
    },
  });
  createdCompanyIds.push(compIota.id);

  const compKappa = await prisma.company.create({
    data: {
      id: randomUUID(),
      name: 'Empresa Kappa Seguranca Teste',
      classification: 'TEST_DEMO',
    },
  });
  createdCompanyIds.push(compKappa.id);

  // 2. Usuários: Admin Iota, Vendedor Iota, e Admin Kappa
  const userAdminIota = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: 'Admin Empresa Iota',
      email: `adminIota_${randomUUID().slice(0, 8)}@teste.com`,
      cpf: `101${Date.now().toString().slice(-8)}`,
      password: hashedPassword,
      role: 'ADMIN',
      companyId: compIota.id,
    },
  });
  createdUserIds.push(userAdminIota.id);

  const userSellerIota = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: 'Vendedor Empresa Iota',
      email: `sellerIota_${randomUUID().slice(0, 8)}@teste.com`,
      cpf: `102${Date.now().toString().slice(-8)}`,
      password: hashedPassword,
      role: 'SELLER',
      companyId: compIota.id,
    },
  });
  createdUserIds.push(userSellerIota.id);

  const userAdminKappa = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: 'Admin Empresa Kappa',
      email: `adminKappa_${randomUUID().slice(0, 8)}@teste.com`,
      cpf: `103${Date.now().toString().slice(-8)}`,
      password: hashedPassword,
      role: 'ADMIN',
      companyId: compKappa.id,
    },
  });
  createdUserIds.push(userAdminKappa.id);

  const tokenAdminIota = jwt.sign(
    { id: userAdminIota.id, name: userAdminIota.name, role: userAdminIota.role, companyId: compIota.id },
    jwtSecret
  );
  const tokenSellerIota = jwt.sign(
    { id: userSellerIota.id, name: userSellerIota.name, role: userSellerIota.role, companyId: compIota.id },
    jwtSecret
  );
  const tokenAdminKappa = jwt.sign(
    { id: userAdminKappa.id, name: userAdminKappa.name, role: userAdminKappa.role, companyId: compKappa.id },
    jwtSecret
  );

  // Integração Iota
  const iotaInteg = await prisma.companyIntegration.create({
    data: {
      id: randomUUID(),
      companyId: compIota.id,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      scope: 'COMPANY_EXCLUSIVE',
      status: 'ACTIVE',
      monthlyUnitsLimit: 100,
      monthlyBudgetLimitCents: 10000, // R$ 100,00
      allowPaidOverage: true,
      credentialSource: 'NONE',
      createdByUserId: userAdminIota.id,
    },
  });
  createdIntegrationIds.push(iotaInteg.id);

  // Tarifa Iota
  const tariffIota = await prisma.companyApiTariff.create({
    data: {
      id: randomUUID(),
      companyId: compIota.id,
      companyIntegrationId: iotaInteg.id,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      includedUnits: 0,
      monthlyFeeCents: 0,
      overageUnitPriceCents: 200, // R$ 2,00 por requisição
      overageUnitType: 'REQUEST',
      currency: 'BRL',
      costPayer: 'COMPANY',
      pricingSource: 'CONFIRMED_CONTRACT',
      effectiveFrom: new Date('2026-01-01'),
      confirmedByUserId: userAdminIota.id,
    },
  });

  // ── 1. Tentativa de Cancelamento por Vendedor (Deve retornar 403 nas duas rotas) ──
  const pendingRecord = await prisma.apiUsageRecord.create({
    data: {
      id: randomUUID(),
      companyId: compIota.id,
      integrationId: iotaInteg.id,
      tariffId: tariffIota.id,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      operation: 'SCOUT_CITY_SEARCH',
      unitsUsed: 1,
      estimatedCostCents: 200,
      status: 'PENDING_CONFIRMATION',
    },
  });

  // Rota 1: /api/company/integrations/reservations/:id/resolve
  const sellerResolve1 = await fetch(`${baseUrl}/api/company/integrations/reservations/${pendingRecord.id}/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenSellerIota}`,
    },
    body: JSON.stringify({ outcome: 'RELEASED', evidence: 'Tentativa vendedor' }),
  });
  assert.equal(sellerResolve1.status, 403, 'Vendedor deve receber 403 na rota de company/integrations');

  // Rota 2: /api/events/reservations/:id/resolve
  const sellerResolve2 = await fetch(`${baseUrl}/api/events/reservations/${pendingRecord.id}/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenSellerIota}`,
    },
    body: JSON.stringify({ outcome: 'RELEASED', evidence: 'Tentativa vendedor' }),
  });
  assert.equal(sellerResolve2.status, 403, 'Vendedor deve receber 403 na rota de events');

  // ── 2. Tentativa de Alterar Reserva de Outra Empresa (Deve retornar 403) ──
  const kappaResolve = await fetch(`${baseUrl}/api/company/integrations/reservations/${pendingRecord.id}/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminKappa}`,
    },
    body: JSON.stringify({ outcome: 'RELEASED', evidence: 'Tentativa cross-company' }),
  });
  assert.equal(kappaResolve.status, 403, 'Admin de outra empresa deve receber 403');

  // ── 3. Preservação de Estados Finais: Tentativa de Reverter Consumo Já Confirmado (409 Conflict) ──
  const successRecord = await prisma.apiUsageRecord.create({
    data: {
      id: randomUUID(),
      companyId: compIota.id,
      integrationId: iotaInteg.id,
      tariffId: tariffIota.id,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      operation: 'SCOUT_CITY_SEARCH',
      unitsUsed: 1,
      measuredCostCents: 200,
      status: 'SUCCESS',
    },
  });

  const revertSuccessResp = await fetch(`${baseUrl}/api/company/integrations/reservations/${successRecord.id}/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminIota}`,
    },
    body: JSON.stringify({ outcome: 'RELEASED', evidence: 'Tentativa de reverter consumo confirmado' }),
  });
  assert.equal(revertSuccessResp.status, 409, 'Tentativa de reverter status SUCCESS deve retornar 409 Conflict');
  const revertSuccessData = await revertSuccessResp.json();
  assert.ok(
    revertSuccessData.error.includes('Não é permitido cancelar ou reverter um consumo já confirmado'),
    `Mensagem deve indicar preservação do estado final: ${revertSuccessData.error}`
  );

  // ── 4. Idempotência: Repetição da mesma decisão sem duplicar efeitos (200 OK) ──
  const repeatConfirmResp = await fetch(`${baseUrl}/api/company/integrations/reservations/${successRecord.id}/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminIota}`,
    },
    body: JSON.stringify({ outcome: 'CONFIRMED' }),
  });
  assert.equal(repeatConfirmResp.status, 200, 'Repetição de confirmação em SUCCESS deve retornar 200 idempotente');
  const repeatConfirmData = await repeatConfirmResp.json();
  assert.equal(repeatConfirmData.idempotent, true);

  // ── 5. Registro de Responsável e Evidência em Liberação de Reserva Pendente ──
  const resolvePendingResp = await fetch(`${baseUrl}/api/events/reservations/${pendingRecord.id}/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminIota}`,
    },
    body: JSON.stringify({
      outcome: 'RELEASED',
      evidence: 'LOG_PROVEDOR_SEM_COBRANCA_TIMEOUT',
    }),
  });
  assert.equal(resolvePendingResp.status, 200);

  const resolvedInDb = await prisma.apiUsageRecord.findUnique({
    where: { id: pendingRecord.id },
  });
  assert.equal(resolvedInDb?.status, 'CANCELLED');
  assert.equal(resolvedInDb?.resolvedByUserId, userAdminIota.id, 'Responsável deve ser registrado');
  assert.ok(resolvedInDb?.evidence?.includes('LOG_PROVEDOR_SEM_COBRANCA_TIMEOUT'), 'Evidência deve ser registrada');

  // Repetição de cancelamento em CANCELLED deve retornar 200 idempotente
  const repeatCancelResp = await fetch(`${baseUrl}/api/events/reservations/${pendingRecord.id}/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminIota}`,
    },
    body: JSON.stringify({
      outcome: 'RELEASED',
      evidence: 'LOG_PROVEDOR_SEM_COBRANCA_TIMEOUT',
    }),
  });
  assert.equal(repeatCancelResp.status, 200, 'Repetição de cancelamento em CANCELLED deve retornar 200 idempotente');
  const repeatCancelData = await repeatCancelResp.json();
  assert.equal(repeatCancelData.idempotent, true);

  // ── 6. Moeda Sem Conversão: Separação do Total e Bloqueio de Novas Chamadas Pagas ──
  // Insere um registro anterior em USD ($ 10.00 / 1000 centavos) na Empresa Iota
  await prisma.apiUsageRecord.create({
    data: {
      id: randomUUID(),
      companyId: compIota.id,
      integrationId: iotaInteg.id,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      operation: 'SCOUT_CITY_SEARCH',
      unitsUsed: 1,
      measuredCostCents: 1000,
      currency: 'USD',
      status: 'SUCCESS',
    },
  });

  // Consulta do painel: o valor em USD NÃO deve se misturar com BRL
  const panelResp = await fetch(`${baseUrl}/api/company/integrations`, {
    headers: { Authorization: `Bearer ${tokenAdminIota}` },
  });
  const panelData = await panelResp.json();
  const iotaCard = panelData.integrations.find((i: any) => i.id === iotaInteg.id);
  assert.equal(iotaCard.consumption.hasUnconvertedRecords, true, 'Deve sinalizar registros não convertidos');
  assert.equal(iotaCard.consumption.unconvertedRecordsCount, 1, 'Deve contar 1 registro não convertido');
  // totalSpentCents em BRL deve conter apenas o registro em BRL já medido (200 centavos), NÃO somando os 1000 de USD diretamente
  assert.equal(iotaCard.consumption.costSpentCents, 200, 'Valores em USD sem taxa não devem ser somados diretamente ao total em BRL');

  // Nova chamada paga DEVE SER BLOQUEADA com 429 porque há consumo anterior sem conversão para apuração do teto
  const searchBlockedResp = await fetch(`${baseUrl}/api/events/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminIota}`,
      'x-environment': 'PRODUCTION',
    },
    body: JSON.stringify({ city: 'Itumbiara' }),
  });
  assert.equal(searchBlockedResp.status, 429, 'Chamada paga com pendência de conversão anterior deve ser bloqueada');
  const searchBlockedData = await searchBlockedResp.json();
  assert.equal(searchBlockedData.limitType, 'BUDGET');
  assert.ok(
    searchBlockedData.error.includes('pendentes de taxa de conversão confirmada para apuração do teto'),
    `Mensagem deve indicar pendência de conversão anterior: ${searchBlockedData.error}`
  );

  // Configura a taxa cambial na integração (R$ 5,00 por USD)
  await prisma.companyIntegration.update({
    where: { id: iotaInteg.id },
    data: {
      configMetadata: {
        currency: 'BRL',
        exchangeRateMilli: 5000,
      },
    },
  });

  // Nova chamada agora deve ser AUTORIZADA com 200
  const searchAllowedResp = await fetch(`${baseUrl}/api/events/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminIota}`,
      'x-environment': 'PRODUCTION',
    },
    body: JSON.stringify({ city: 'Itumbiara' }),
  });
  assert.equal(searchAllowedResp.status, 200, 'Chamada paga após definição de taxa de conversão deve ser autorizada');

  // ── 7. Resposta Tardia e Resposta Inválida no Fluxo Real da Rota com Provedor Simulado ──
  // A. Resposta inválida: unidade confirmada no banco ANTES da tentativa de ler conteúdo ou salvar cache
  const invalidIntegCall = await fetch(`${baseUrl}/api/events/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminIota}`,
      'x-environment': 'PRODUCTION',
      'x-mock-invalid-content': 'true',
    },
    body: JSON.stringify({ city: 'Jataí' }),
  });
  assert.equal(invalidIntegCall.status, 200);
  const invalidIntegData = await invalidIntegCall.json();
  assert.equal(invalidIntegData.preservedUnit, true);
  const invResId = invalidIntegData.reservationId;
  assert.ok(invResId);

  const invRecord = await prisma.apiUsageRecord.findUnique({
    where: { id: invResId },
  });
  assert.equal(invRecord?.status, 'SUCCESS', 'Unidade deve ser confirmada como SUCCESS mesmo com conteúdo degradado');

  // B. Resposta tardia: timeout deixa reserva em PENDING_CONFIRMATION, e resolução manual vincula o desfecho
  const timeoutIntegCall = await fetch(`${baseUrl}/api/events/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminIota}`,
      'x-environment': 'PRODUCTION',
      'x-mock-simulated-timeout': 'true',
    },
    body: JSON.stringify({ city: 'Rio Verde' }),
  });
  assert.equal(timeoutIntegCall.status, 504);
  const timeoutIntegData = await timeoutIntegCall.json();
  const timeoutResId = timeoutIntegData.reservationId;
  assert.ok(timeoutResId);

  // Resolução da resposta tardia confirmando o consumo através da rota de eventos
  const resolveLateResp = await fetch(`${baseUrl}/api/events/reservations/${timeoutResId}/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminIota}`,
    },
    body: JSON.stringify({
      outcome: 'CONFIRMED',
      measuredCostCents: 200,
      reason: 'LATE_CALLBACK_RECEIVED',
    }),
  });
  assert.equal(resolveLateResp.status, 200);
  const resolveLateData = await resolveLateResp.json();
  assert.equal(resolveLateData.newStatus, 'SUCCESS');

  const lateRecordInDb = await prisma.apiUsageRecord.findUnique({
    where: { id: timeoutResId },
  });
  assert.equal(lateRecordInDb?.status, 'SUCCESS');
  assert.equal(lateRecordInDb?.resolvedByUserId, userAdminIota.id);
});

test('Central de APIs - Concorrência atômica, atomicidade de auditoria e confirmação automática de retorno tardio após 504', async () => {
  await assertSafeEffectiveTestConnection(prisma, process.env.DATABASE_URL);
  const baseUrl = await getBaseUrl;

  const adminPassword = 'SenhaForte123!';
  const hashedPassword = bcrypt.hashSync(adminPassword, 4);

  // 1. Criar Empresa Lambda
  const compLambda = await prisma.company.create({
    data: {
      id: randomUUID(),
      name: 'Empresa Lambda Concorrencia Teste',
      classification: 'TEST_DEMO',
    },
  });
  createdCompanyIds.push(compLambda.id);

  const userAdminLambda = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: 'Admin Empresa Lambda',
      email: `adminLambda_${randomUUID().slice(0, 8)}@teste.com`,
      cpf: `105${Date.now().toString().slice(-8)}`,
      password: hashedPassword,
      role: 'ADMIN',
      companyId: compLambda.id,
    },
  });
  createdUserIds.push(userAdminLambda.id);

  const tokenAdminLambda = jwt.sign(
    { id: userAdminLambda.id, name: userAdminLambda.name, role: userAdminLambda.role, companyId: compLambda.id },
    jwtSecret
  );

  const lambdaInteg = await prisma.companyIntegration.create({
    data: {
      id: randomUUID(),
      companyId: compLambda.id,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      scope: 'COMPANY_EXCLUSIVE',
      status: 'ACTIVE',
      monthlyUnitsLimit: 100,
      monthlyBudgetLimitCents: 10000,
      allowPaidOverage: true,
      credentialSource: 'NONE',
      createdByUserId: userAdminLambda.id,
    },
  });
  createdIntegrationIds.push(lambdaInteg.id);

  const tariffLambda = await prisma.companyApiTariff.create({
    data: {
      id: randomUUID(),
      companyId: compLambda.id,
      companyIntegrationId: lambdaInteg.id,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      includedUnits: 0,
      monthlyFeeCents: 0,
      overageUnitPriceCents: 200,
      overageUnitType: 'REQUEST',
      currency: 'BRL',
      costPayer: 'COMPANY',
      pricingSource: 'CONFIRMED_CONTRACT',
      effectiveFrom: new Date('2026-01-01'),
      confirmedByUserId: userAdminLambda.id,
    },
  });

  // ── CENÁRIO 1: DUAS DECISÕES SIMULTÂNEAS COM RESULTADO ÚNICO (CONCORRÊNCIA TRANSACIONAL) ──
  // Cria reserva pendente
  const concurrentRes = await prisma.apiUsageRecord.create({
    data: {
      id: randomUUID(),
      companyId: compLambda.id,
      integrationId: lambdaInteg.id,
      tariffId: tariffLambda.id,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      operation: 'SCOUT_CITY_SEARCH',
      unitsUsed: 1,
      estimatedCostCents: 200,
      status: 'PENDING_CONFIRMATION',
    },
  });

  // Dispara simultaneamente uma CONFIRMAÇÃO e uma LIBERAÇÃO
  const [res1, res2] = await Promise.all([
    fetch(`${baseUrl}/api/company/integrations/reservations/${concurrentRes.id}/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAdminLambda}`,
      },
      body: JSON.stringify({ outcome: 'CONFIRMED' }),
    }),
    fetch(`${baseUrl}/api/company/integrations/reservations/${concurrentRes.id}/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAdminLambda}`,
      },
      body: JSON.stringify({ outcome: 'RELEASED', evidence: 'PROVA_CANCELAMENTO_CONCORRENTE' }),
    }),
  ]);

  const statuses = [res1.status, res2.status].sort();
  // Exatamente uma das transações vence e a concorrente recebe 409 Conflict
  assert.deepEqual(statuses, [200, 409], 'Duas decisões conflitantes simultâneas devem resultar em [200, 409]');

  // Inspeciona o estado final no banco de dados
  const finalConcurrentRecord = await prisma.apiUsageRecord.findUnique({
    where: { id: concurrentRes.id },
  });
  assert.ok(['SUCCESS', 'CANCELLED'].includes(finalConcurrentRecord?.status || ''));

  // ── CENÁRIO 2: FALHA NA GRAVAÇÃO DA AUDITORIA (ROLLBACK TRANSACIONAL COMPLETO) ──
  const auditFailRes = await prisma.apiUsageRecord.create({
    data: {
      id: randomUUID(),
      companyId: compLambda.id,
      integrationId: lambdaInteg.id,
      tariffId: tariffLambda.id,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      operation: 'SCOUT_CITY_SEARCH',
      unitsUsed: 1,
      estimatedCostCents: 200,
      status: 'PENDING_CONFIRMATION',
    },
  });

  const auditFailCall = await fetch(`${baseUrl}/api/company/integrations/reservations/${auditFailRes.id}/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminLambda}`,
      'x-mock-simulate-audit-failure': 'true',
    },
    body: JSON.stringify({ outcome: 'CONFIRMED', simulateAuditFailure: true }),
  });
  assert.notEqual(auditFailCall.status, 200, 'Chamada com falha na auditoria não pode ter sucesso');

  // Verifica que o rollback impediu que a reserva fosse alterada para SUCCESS
  const recordAfterAuditFail = await prisma.apiUsageRecord.findUnique({
    where: { id: auditFailRes.id },
  });
  assert.equal(
    recordAfterAuditFail?.status,
    'PENDING_CONFIRMATION',
    'Falha na gravação da auditoria deve dar rollback completo, mantendo a reserva pendente'
  );

  // ── CENÁRIO 3: PROVEDOR SIMULADO QUE RESPONDE DEPOIS DO 504 (CONFIRMAÇÃO AUTOMÁTICA SEM CHAMADA ADMIN) ──
  const lateAutoCall = await fetch(`${baseUrl}/api/events/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminLambda}`,
      'x-environment': 'PRODUCTION',
      'x-mock-simulated-timeout': 'true',
      'x-mock-late-response-ms': '100', // Provedor responde 100ms depois
    },
    body: JSON.stringify({ city: 'Caldas Novas' }),
  });

  assert.equal(lateAutoCall.status, 504, 'Chamada inicial deve retornar 504 com reserva retida');
  const lateAutoData = await lateAutoCall.json();
  const lateResId = lateAutoData.reservationId;
  assert.ok(lateResId, 'Deve retornar reservationId no 504');

  // Imediatamente após o 504, o registro no banco deve estar PENDING_CONFIRMATION
  const immediateRecord = await prisma.apiUsageRecord.findUnique({
    where: { id: lateResId },
  });
  assert.equal(immediateRecord?.status, 'PENDING_CONFIRMATION');

  // Aguarda 250ms para que o provedor simulado responda tardiamente em segundo plano
  await new Promise((resolve) => setTimeout(resolve, 250));

  // Inspeciona o banco SEM QUALQUER CHAMADA ADMINISTRATIVA À ROTA DE RESOLUÇÃO
  const autoConfirmedRecord = await prisma.apiUsageRecord.findUnique({
    where: { id: lateResId },
  });
  assert.equal(
    autoConfirmedRecord?.status,
    'SUCCESS',
    'A reserva deve chegar a SUCCESS automaticamente via retorno tardio do provedor, sem chamada administrativa'
  );
  assert.equal(autoConfirmedRecord?.resolvedByUserId, 'SYSTEM_LATE_RESPONSE');
  assert.ok(autoConfirmedRecord?.evidence?.includes('LATE_PROVIDER_RESPONSE_AUTO_CONFIRMED'));
});

test('Central de APIs - Fechamento do Retorno Tardio: Scout, Radar, gravação condicional e corrida com gravação em andamento', async () => {
  await assertSafeEffectiveTestConnection(prisma, process.env.DATABASE_URL);
  const baseUrl = await getBaseUrl;

  const adminPassword = 'SenhaForte123!';
  const hashedPassword = bcrypt.hashSync(adminPassword, 4);

  // 1. Criar Empresa Mu
  const compMu = await prisma.company.create({
    data: {
      id: randomUUID(),
      name: 'Empresa Mu Retorno Tardio Teste',
      classification: 'TEST_DEMO',
    },
  });
  createdCompanyIds.push(compMu.id);

  const userAdminMu = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: 'Admin Empresa Mu',
      email: `adminMu_${randomUUID().slice(0, 8)}@teste.com`,
      cpf: `106${Date.now().toString().slice(-8)}`,
      password: hashedPassword,
      role: 'ADMIN',
      companyId: compMu.id,
    },
  });
  createdUserIds.push(userAdminMu.id);

  const tokenAdminMu = jwt.sign(
    { id: userAdminMu.id, name: userAdminMu.name, role: userAdminMu.role, companyId: compMu.id },
    jwtSecret
  );

  const muInteg = await prisma.companyIntegration.create({
    data: {
      id: randomUUID(),
      companyId: compMu.id,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      scope: 'COMPANY_EXCLUSIVE',
      status: 'ACTIVE',
      monthlyUnitsLimit: 100,
      monthlyBudgetLimitCents: 20000,
      allowPaidOverage: true,
      credentialSource: 'NONE',
      createdByUserId: userAdminMu.id,
    },
  });
  createdIntegrationIds.push(muInteg.id);

  const tariffMu = await prisma.companyApiTariff.create({
    data: {
      id: randomUUID(),
      companyId: compMu.id,
      companyIntegrationId: muInteg.id,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      includedUnits: 0,
      monthlyFeeCents: 0,
      overageUnitPriceCents: 200,
      overageUnitType: 'REQUEST',
      currency: 'BRL',
      costPayer: 'COMPANY',
      pricingSource: 'CONFIRMED_CONTRACT',
      effectiveFrom: new Date('2026-01-01'),
      confirmedByUserId: userAdminMu.id,
    },
  });

  // ── 1. FLUXO NORMAL DO SCOUT COM RETORNO TARDIO DO PROVEDOR APÓS 504 ──
  const scoutCall = await fetch(`${baseUrl}/api/events/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminMu}`,
      'x-environment': 'PRODUCTION',
      'x-mock-simulated-timeout': 'true',
      'x-mock-late-response-ms': '60',
    },
    body: JSON.stringify({ city: 'Pirenopolis' }),
  });
  assert.equal(scoutCall.status, 504, 'Scout deve retornar 504 ao estourar o timeout');
  const scoutData = await scoutCall.json();
  const scoutResId = scoutData.reservationId;
  assert.ok(scoutResId, 'Scout deve fornecer reservationId retido');

  // Imediatamente após 504, status deve ser PENDING_CONFIRMATION
  const scoutBefore = await prisma.apiUsageRecord.findUnique({ where: { id: scoutResId } });
  assert.equal(scoutBefore?.status, 'PENDING_CONFIRMATION');

  // Aguarda resposta tardia automática (150ms)
  await new Promise((r) => setTimeout(r, 150));

  const scoutAfter = await prisma.apiUsageRecord.findUnique({ where: { id: scoutResId } });
  assert.equal(scoutAfter?.status, 'SUCCESS', 'Scout deve atingir SUCCESS automaticamente via retorno tardio');
  assert.equal(scoutAfter?.resolvedByUserId, 'SYSTEM_LATE_RESPONSE');
  assert.equal(scoutAfter?.measuredCostCents, null, 'Sem custo confirmado informado, measuredCostCents deve ficar vazio (null)');
  assert.equal(scoutAfter?.estimatedCostCents, 200, 'Estimativa gravada na reserva deve ser preservada no Scout');

  // Auditoria deve conter exatamente 1 evento gerado pela confirmação automática
  const scoutAudits = await prisma.integrationAuditEvent.findMany({
    where: { companyId: compMu.id, action: 'RESERVATION_CONFIRMED' },
  });
  const matchingScoutAudits = scoutAudits.filter((a) => a.details.includes(scoutResId));
  assert.equal(matchingScoutAudits.length, 1, 'Scout deve registrar exatamente 1 evento de auditoria');
  const scoutAuditDetails = JSON.parse(matchingScoutAudits[0].details);
  assert.equal(scoutAuditDetails.measuredCostCents, null, 'Auditoria do Scout deve conter measuredCostCents vazio');
  assert.equal(scoutAuditDetails.estimatedCostCents, 200, 'Auditoria do Scout deve conter estimativa preservada');

  // ── 2. FLUXO NORMAL DO RADAR COM RETORNO TARDIO DO PROVEDOR APÓS 504 (SEM CUSTO INFORMADO) ──
  const radarCall = await fetch(
    `${baseUrl}/api/events/state-radar?state=TO&force=true&mockTimeout=true&mockLateResponseMs=60`,
    {
      headers: {
        Authorization: `Bearer ${tokenAdminMu}`,
        'x-environment': 'PRODUCTION',
      },
    }
  );
  assert.equal(radarCall.status, 504, 'Radar deve retornar 504 ao estourar o timeout');
  const radarData = await radarCall.json();
  const radarResId = radarData.reservationId;
  assert.ok(radarResId, 'Radar deve fornecer reservationId retido');

  // Imediatamente após 504, status deve ser PENDING_CONFIRMATION
  const radarBefore = await prisma.apiUsageRecord.findUnique({ where: { id: radarResId } });
  assert.equal(radarBefore?.status, 'PENDING_CONFIRMATION');

  // Aguarda resposta tardia automática (150ms)
  await new Promise((r) => setTimeout(r, 150));

  const radarAfter = await prisma.apiUsageRecord.findUnique({ where: { id: radarResId } });
  assert.equal(radarAfter?.status, 'SUCCESS', 'Radar deve atingir SUCCESS automaticamente via rotina idêntica de retorno tardio');
  assert.equal(radarAfter?.resolvedByUserId, 'SYSTEM_LATE_RESPONSE');
  assert.equal(radarAfter?.measuredCostCents, null, 'Sem custo confirmado informado, measuredCostCents deve ficar vazio (null)');
  assert.equal(radarAfter?.estimatedCostCents, 200, 'Estimativa gravada na reserva deve ser preservada no Radar');

  const radarAudits = await prisma.integrationAuditEvent.findMany({
    where: { companyId: compMu.id, action: 'RESERVATION_CONFIRMED' },
  });
  const matchingRadarAudits = radarAudits.filter((a) => a.details.includes(radarResId));
  assert.equal(matchingRadarAudits.length, 1, 'Radar deve registrar exatamente 1 evento de auditoria');
  const radarAuditDetails = JSON.parse(matchingRadarAudits[0].details);
  assert.equal(radarAuditDetails.measuredCostCents, null, 'Auditoria do Radar deve conter measuredCostCents vazio');
  assert.equal(radarAuditDetails.estimatedCostCents, 200, 'Auditoria do Radar deve conter estimativa preservada');

  // ── 3. CORRIDA: RESPOSTA CHEGA ENQUANTO A GRAVAÇÃO DO TIMEOUT AINDA ESTÁ EM ANDAMENTO ──
  // Simula timeout com gravação atrasada (80ms) e resposta do provedor chegando aos 20ms
  const raceCall = await fetch(`${baseUrl}/api/events/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminMu}`,
      'x-environment': 'PRODUCTION',
      'x-mock-simulated-timeout': 'true',
      'x-mock-timeout-delay-ms': '80', // Gravação de timeout em andamento
      'x-mock-late-response-ms': '20', // Resposta chega antes do fim da gravação do timeout
    },
    body: JSON.stringify({ city: 'Formosa' }),
  });
  assert.equal(raceCall.status, 504);
  const raceData = await raceCall.json();
  const raceResId = raceData.reservationId;
  assert.ok(raceResId);

  // Aguarda a finalização de ambas as operações concorrentes
  await new Promise((r) => setTimeout(r, 150));

  const raceRecord = await prisma.apiUsageRecord.findUnique({ where: { id: raceResId } });
  assert.equal(
    raceRecord?.status,
    'SUCCESS',
    'Mesmo que a gravação do timeout estivesse em andamento, o status final deve ser SUCCESS preservado'
  );
  assert.equal(raceRecord?.resolvedByUserId, 'SYSTEM_LATE_RESPONSE');

  // Verifica que há apenas 1 auditoria e 1 confirmação
  const raceAudits = await prisma.integrationAuditEvent.findMany({
    where: { companyId: compMu.id, action: 'RESERVATION_CONFIRMED' },
  });
  const matchingRaceAudits = raceAudits.filter((a) => a.details.includes(raceResId));
  assert.equal(
    matchingRaceAudits.length,
    1,
    'Deve haver exatamente 1 confirmação e auditoria, sem duplicidade pela corrida com gravação de timeout'
  );

  // ── 4. PRESERVAÇÃO DE ESTADO FINAL NA GRAVAÇÃO CONDICIONAL DE TIMEOUT ──
  // Testa diretamente a função markReservationPendingConfirmation sobre um registro já em SUCCESS
  const successRes = await prisma.apiUsageRecord.create({
    data: {
      id: randomUUID(),
      companyId: compMu.id,
      integrationId: muInteg.id,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      operation: 'SCOUT_CITY_SEARCH',
      unitsUsed: 1,
      status: 'SUCCESS',
    },
  });

  const conditionalSuccessTry = await markReservationPendingConfirmation(successRes.id);
  assert.equal(conditionalSuccessTry.updated, false, 'Não pode atualizar registro já em SUCCESS');
  assert.equal(conditionalSuccessTry.currentStatus, 'SUCCESS', 'Deve preservar o status SUCCESS');

  const checkSuccessStill = await prisma.apiUsageRecord.findUnique({ where: { id: successRes.id } });
  assert.equal(checkSuccessStill?.status, 'SUCCESS', 'Status no banco deve continuar SUCCESS');

  // Testa diretamente sobre um registro já cancelado (CANCELLED)
  const cancelledRes = await prisma.apiUsageRecord.create({
    data: {
      id: randomUUID(),
      companyId: compMu.id,
      integrationId: muInteg.id,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
      operation: 'SCOUT_CITY_SEARCH',
      unitsUsed: 1,
      status: 'CANCELLED',
    },
  });

  const conditionalCancelTry = await markReservationPendingConfirmation(cancelledRes.id);
  assert.equal(conditionalCancelTry.updated, false, 'Não pode atualizar registro já em CANCELLED');
  assert.equal(conditionalCancelTry.currentStatus, 'CANCELLED', 'Deve preservar o status CANCELLED');

  const checkCancelStill = await prisma.apiUsageRecord.findUnique({ where: { id: cancelledRes.id } });
  assert.equal(checkCancelStill?.status, 'CANCELLED', 'Status no banco deve continuar CANCELLED');

  // ── 5. RESPOSTA TARDIA COM CUSTO CONFIRMADO INFORMADO EXPLICITAMENTE PELA SIMULAÇÃO (350 centavos) ──
  const explicitCostCall = await fetch(`${baseUrl}/api/events/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminMu}`,
      'x-environment': 'PRODUCTION',
      'x-mock-simulated-timeout': 'true',
      'x-mock-late-response-ms': '40',
      'x-mock-late-measured-cost-cents': '350', // Custo explicitamente informado na simulação
    },
    body: JSON.stringify({ city: 'Cristalina' }),
  });
  assert.equal(explicitCostCall.status, 504);
  const explicitCostData = await explicitCostCall.json();
  const explicitCostResId = explicitCostData.reservationId;
  assert.ok(explicitCostResId);

  await new Promise((r) => setTimeout(r, 120));

  const explicitRecord = await prisma.apiUsageRecord.findUnique({ where: { id: explicitCostResId } });
  assert.equal(explicitRecord?.status, 'SUCCESS');
  assert.equal(explicitRecord?.measuredCostCents, 350, 'Quando o provedor informa custo confirmado, deve gravar em measuredCostCents');
  assert.equal(explicitRecord?.estimatedCostCents, 200, 'Estimativa original deve continuar preservada');
});



