import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { PrismaClient, Prisma } from '@prisma/client';
import ownerRoutes from '../src/routes/owner';
import { centralErrorHandler } from '../src/middleware/securityMiddleware';

describe('ETAPA 1 — CENTRAL DO PROPRIETÁRIO (BLOCO 1: IDENTIDADE, EMPRESAS E ACESSO LIMITADO)', { concurrency: 1 }, () => {
  const prisma = new PrismaClient();
  let server: http.Server;
  let baseUrl: string;

  const testSuffix = `test_${Date.now()}`;
  let superAdminId: string;
  let superAdminToken: string;
  let ownerNoCapId: string;
  let ownerNoCapToken: string;
  let companyAdminId: string;
  let companyAdminToken: string;
  let sellerId: string;
  let sellerToken: string;

  let companyAId: string;
  let companyBId: string;

  const superAdminPassword = 'SuperSecretOwnerPassword123!';

  before(async () => {
    // 1. Criar empresas de teste A e B
    const companyA = await prisma.company.create({
      data: {
        name: `Empresa Alfa ${testSuffix}`,
        legalName: `Alfa Fotos Escolares LTDA ${testSuffix}`,
        tradeName: `Alfa Photos ${testSuffix}`,
        cnpj: `11${Date.now().toString().slice(-12)}`,
        adminContactName: 'Carlos Diretor',
        adminContactEmail: `carlos@alfa-${testSuffix}.com`,
        adminContactPhone: '11999990001',
        status: 'ACTIVE',
        isActive: true,
      },
    });
    companyAId = companyA.id;

    const companyB = await prisma.company.create({
      data: {
        name: `Empresa Beta ${testSuffix}`,
        legalName: `Beta Eventos e Fotografias LTDA ${testSuffix}`,
        tradeName: `Beta Imagens ${testSuffix}`,
        cnpj: `22${Date.now().toString().slice(-12)}`,
        adminContactName: 'Mariana Gestora',
        adminContactEmail: `mariana@beta-${testSuffix}.com`,
        adminContactPhone: '11999990002',
        status: 'ACTIVE',
        isActive: true,
      },
    });
    companyBId = companyB.id;

    // 2. Criar Usuários
    const hashedPassword = await bcrypt.hash(superAdminPassword, 8);

    // Super Admin com todas as capacidades
    const superAdmin = await prisma.user.create({
      data: {
        name: `Proprietário Master ${testSuffix}`,
        email: `proprietario-${testSuffix}@lumora.app`,
        password: hashedPassword,
        role: 'SUPER_ADMIN',
        active: true,
      },
    });
    superAdminId = superAdmin.id;

    const caps = ['PLATFORM_FINANCE', 'CONTRACT_MANAGEMENT', 'INTEGRATION_CONFIG', 'TECHNICAL_SUPPORT'];
    for (const c of caps) {
      await prisma.ownerCapability.create({
        data: {
          userId: superAdminId,
          capability: c,
        },
      });
    }

    // Super Admin SEM capacidade de contrato (apenas suporte técnico)
    const ownerNoCap = await prisma.user.create({
      data: {
        name: `Operador Suporte ${testSuffix}`,
        email: `suporte-${testSuffix}@lumora.app`,
        password: hashedPassword,
        role: 'SUPER_ADMIN',
        active: true,
      },
    });
    ownerNoCapId = ownerNoCap.id;
    await prisma.ownerCapability.create({
      data: {
        userId: ownerNoCapId,
        capability: 'TECHNICAL_SUPPORT',
      },
    });

    // Company Admin da Empresa A
    const companyAdmin = await prisma.user.create({
      data: {
        name: `Admin Alfa ${testSuffix}`,
        email: `admin-alfa-${testSuffix}@alfa.com`,
        password: hashedPassword,
        role: 'COMPANY_ADMIN',
        companyId: companyAId,
        active: true,
      },
    });
    companyAdminId = companyAdmin.id;

    // Vendedor da Empresa A
    const seller = await prisma.user.create({
      data: {
        name: `Vendedor Alfa ${testSuffix}`,
        email: `vendedor-alfa-${testSuffix}@alfa.com`,
        password: hashedPassword,
        role: 'SELLER',
        companyId: companyAId,
        active: true,
      },
    });
    sellerId = seller.id;

    // 3. Tokens JWT
    const secret = process.env.JWT_SECRET || 'testsecret';
    superAdminToken = jwt.sign({ id: superAdminId, role: 'SUPER_ADMIN' }, secret);
    ownerNoCapToken = jwt.sign({ id: ownerNoCapId, role: 'SUPER_ADMIN' }, secret);
    companyAdminToken = jwt.sign({ id: companyAdminId, role: 'COMPANY_ADMIN', companyId: companyAId }, secret);
    sellerToken = jwt.sign({ id: sellerId, role: 'SELLER', companyId: companyAId }, secret);

    // 4. Iniciar servidor Express de teste
    const app = express();
    app.use(express.json());
    app.use('/api/owner', ownerRoutes);
    app.use(centralErrorHandler);

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}/api/owner`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    // Cleanup de teste
    try {
      await prisma.stepUpSession.deleteMany({ where: { userId: { in: [superAdminId, ownerNoCapId] } } });
      await prisma.ownerCapability.deleteMany({ where: { userId: { in: [superAdminId, ownerNoCapId] } } });
      await prisma.contractAuditEvent.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
      await prisma.companyPlatformRate.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
      await prisma.user.deleteMany({ where: { id: { in: [superAdminId, ownerNoCapId, companyAdminId, sellerId] } } });
      await prisma.company.deleteMany({ where: { id: { in: [companyAId, companyBId] } } });
    } catch (_) {}
    await prisma.$disconnect();
  });

  async function api(path: string, options: { method?: string; body?: any; token?: string; stepUpToken?: string } = {}) {
    const url = `${baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (options.token) {
      headers['Authorization'] = `Bearer ${options.token}`;
    }
    if (options.stepUpToken) {
      headers['X-Step-Up-Token'] = options.stepUpToken;
    }

    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, body: data };
  }

  // ── TESTES ─────────────────────────────────────────────────────────────────

  it('1. Separação de Capacidades e Bloqueios RBAC estritos', async () => {
    // Vendedor não pode acessar central do proprietário
    const sellerRes = await api('/companies', { token: sellerToken });
    assert.equal(sellerRes.status, 403, 'Vendedor deve ser rejeitado com 403');

    // Admin da empresa não pode listar todas as empresas na central do proprietário
    const companyAdminRes = await api('/companies', { token: companyAdminToken });
    assert.equal(companyAdminRes.status, 403, 'Company Admin deve ser rejeitado com 403 da central global');

    // Super Admin sem capacidade CONTRACT_MANAGEMENT é bloqueado ao tentar listar/gerenciar contratos
    const noCapRes = await api('/companies', { token: ownerNoCapToken });
    assert.equal(noCapRes.status, 403, 'Super Admin sem capacidade deve receber 403');
    assert.equal(noCapRes.body.error, 'FORBIDDEN_CAPABILITY');

    // Super Admin com capacidade obtém sucesso
    const masterRes = await api('/companies', { token: superAdminToken });
    assert.equal(masterRes.status, 200, 'Super Admin com capacidade CONTRACT_MANAGEMENT deve ter acesso 200');
    assert.ok(Array.isArray(masterRes.body));
  });

  it('2. Autenticação Reforçada (Step-Up Auth) para Ações Contratuais Sensíveis', async () => {
    // Tentativa de alterar taxa sem step-up auth deve ser bloqueada
    const directRateRes = await api(`/companies/${companyAId}/rates`, {
      method: 'POST',
      token: superAdminToken,
      body: {
        ratePercentage: 2.5,
        effectiveFrom: new Date().toISOString(),
        reason: 'Tentativa sem reautenticação',
      },
    });
    assert.equal(directRateRes.status, 403);
    assert.equal(directRateRes.body.error, 'STEP_UP_AUTH_REQUIRED');

    // Tentativa de step-up com senha errada falha com 403
    const badStepUp = await api('/auth/step-up', {
      method: 'POST',
      token: superAdminToken,
      body: { password: 'WrongPassword!' },
    });
    assert.equal(badStepUp.status, 403);

    // Step-up com senha correta emite token válido
    const goodStepUp = await api('/auth/step-up', {
      method: 'POST',
      token: superAdminToken,
      body: { password: superAdminPassword, reason: 'Ajuste contratual teste' },
    });
    assert.equal(goodStepUp.status, 200);
    assert.ok(goodStepUp.body.stepUpToken);
    const stepUpToken = goodStepUp.body.stepUpToken;

    // Agora com o step-up token, a ação sensível é autorizada
    const authedRateRes = await api(`/companies/${companyAId}/rates`, {
      method: 'POST',
      token: superAdminToken,
      stepUpToken,
      body: {
        ratePercentage: 2.5,
        effectiveFrom: new Date().toISOString(),
        reason: 'Contrato homologado Alfa',
      },
    });
    assert.equal(authedRateRes.status, 201);
    assert.equal(authedRateRes.body.rate.ratePercentage, 2.5);

    // Revogação de sessão reforçada funciona
    const revokeRes = await api('/auth/step-up/revoke', {
      method: 'POST',
      token: superAdminToken,
      stepUpToken,
    });
    assert.equal(revokeRes.status, 200);

    // Tentativa subsequente com o token revogado falha
    const afterRevokeRes = await api(`/companies/${companyAId}/rates`, {
      method: 'POST',
      token: superAdminToken,
      stepUpToken,
      body: {
        ratePercentage: 3.0,
        effectiveFrom: new Date(Date.now() + 86400000).toISOString(),
        reason: 'Tentativa pós revogação',
      },
    });
    assert.equal(afterRevokeRes.status, 403);
    assert.equal(afterRevokeRes.body.error, 'STEP_UP_AUTH_REQUIRED');
  });

  it('3. Multi-Empresa A/B: Configuração de Taxa em A não afeta B e suporta Decimais e Gratuidade', async () => {
    // Autenticar step-up para os testes
    const stepUp = await api('/auth/step-up', {
      method: 'POST',
      token: superAdminToken,
      body: { password: superAdminPassword },
    });
    const stepUpToken = stepUp.body.stepUpToken;

    // Empresa B inicia sem taxa configurada
    const checkBInitial = await api(`/companies/${companyBId}`, { token: superAdminToken });
    assert.equal(checkBInitial.status, 200);
    assert.equal(checkBInitial.body.isRateConfigured, false, 'Empresa B não deve ter taxa configurada por padrão');
    assert.equal(checkBInitial.body.currentRate, null);

    // Configurar taxa fracionária na Empresa B: 3.750% com vigência a partir de hoje
    const now = new Date();
    const setRateB = await api(`/companies/${companyBId}/rates`, {
      method: 'POST',
      token: superAdminToken,
      stepUpToken,
      body: {
        ratePercentage: 3.75,
        effectiveFrom: now.toISOString(),
        reason: 'Contrato Beta com taxa personalizada de 3,75%',
      },
    });
    assert.equal(setRateB.status, 201);
    assert.equal(setRateB.body.rate.ratePercentage, 3.75);

    // Verificar isolamento: Empresa A continua em 2.5%, Empresa B está em 3.75%
    const checkA = await api(`/companies/${companyAId}`, { token: superAdminToken });
    const checkB = await api(`/companies/${companyBId}`, { token: superAdminToken });
    assert.equal(checkA.body.currentRate.ratePercentage, 2.5);
    assert.equal(checkB.body.currentRate.ratePercentage, 3.75);

    // Testar taxa zero expressa (Gratuidade Contratual): aceita e válida
    const setGratis = await api(`/companies/${companyAId}/rates`, {
      method: 'POST',
      token: superAdminToken,
      stepUpToken,
      body: {
        ratePercentage: 0,
        effectiveFrom: new Date(Date.now() + 10000).toISOString(),
        reason: 'Período promocional de gratuidade contratada',
      },
    });
    assert.equal(setGratis.status, 201);
    assert.equal(setGratis.body.rate.ratePercentage, 0);

    // Validação de limites: taxa negativa deve ser rejeitada com 400
    const negativeRes = await api(`/companies/${companyAId}/rates`, {
      method: 'POST',
      token: superAdminToken,
      stepUpToken,
      body: {
        ratePercentage: -1.5,
        effectiveFrom: new Date().toISOString(),
        reason: 'Taxa negativa inválida',
      },
    });
    assert.equal(negativeRes.status, 400);

    // Validação de limites: taxa > 100% deve ser rejeitada com 400
    const over100Res = await api(`/companies/${companyAId}/rates`, {
      method: 'POST',
      token: superAdminToken,
      stepUpToken,
      body: {
        ratePercentage: 105,
        effectiveFrom: new Date().toISOString(),
        reason: 'Taxa acima de 100% inválida',
      },
    });
    assert.equal(over100Res.status, 400);
  });

  it('4. Histórico de Vigências sem Sobreposição e Versionamento Incremental', async () => {
    const stepUp = await api('/auth/step-up', {
      method: 'POST',
      token: superAdminToken,
      body: { password: superAdminPassword },
    });
    const stepUpToken = stepUp.body.stepUpToken;

    // Criar nova vigência para Empresa B
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Daqui a 30 dias
    const newRateRes = await api(`/companies/${companyBId}/rates`, {
      method: 'POST',
      token: superAdminToken,
      stepUpToken,
      body: {
        ratePercentage: 4.25,
        effectiveFrom: futureDate.toISOString(),
        reason: 'Reajuste contratual programado para próximo mês',
      },
    });
    assert.equal(newRateRes.status, 201);
    assert.equal(newRateRes.body.rate.version, 2, 'Versão deve ser incrementada para 2');

    // Verificar histórico na empresa B
    const companyBDetails = await api(`/companies/${companyBId}`, { token: superAdminToken });
    assert.equal(companyBDetails.body.rateHistory.length, 2);

    const [v2, v1] = companyBDetails.body.rateHistory;
    assert.equal(v2.version, 2);
    assert.equal(v2.ratePercentage, 4.25);
    assert.equal(v2.effectiveTo, null, 'Nova taxa deve estar em aberto');

    assert.equal(v1.version, 1);
    assert.equal(v1.ratePercentage, 3.75);
    assert.notEqual(v1.effectiveTo, null, 'Taxa anterior deve ter sido fechada no início da nova');
  });

  it('5. Consulta de Contrato Próprio pelo Admin da Empresa (Somente Leitura)', async () => {
    // Admin da Empresa A consulta seu próprio contrato
    const myContractRes = await api('/my-company-contract', { token: companyAdminToken });
    assert.equal(myContractRes.status, 200);
    assert.equal(myContractRes.body.company.id, companyAId);
    assert.equal(myContractRes.body.company.name, `Empresa Alfa ${testSuffix}`);
    assert.ok(myContractRes.body.isRateConfigured);
    assert.ok(Array.isArray(myContractRes.body.rateHistory));

    // Admin da Empresa A NÃO tem acesso aos dados da Empresa B
    const accessB = await api(`/companies/${companyBId}`, { token: companyAdminToken });
    assert.equal(accessB.status, 403, 'Admin da Empresa A não pode consultar Empresa B');
  });

  it('6. Governança de Suspensão sem perda de dados offline', async () => {
    const stepUp = await api('/auth/step-up', {
      method: 'POST',
      token: superAdminToken,
      body: { password: superAdminPassword },
    });
    const stepUpToken = stepUp.body.stepUpToken;

    // Suspender Empresa A com justificativa
    const suspendRes = await api(`/companies/${companyAId}/status`, {
      method: 'POST',
      token: superAdminToken,
      stepUpToken,
      body: {
        status: 'SUSPENDED',
        reason: 'Inadimplência de mensalidade do software após notificação',
      },
    });
    assert.equal(suspendRes.status, 200);
    assert.equal(suspendRes.body.company.status, 'SUSPENDED');
    assert.equal(suspendRes.body.company.isActive, false);
    assert.ok(suspendRes.body.message.includes('dados pendentes dos aparelhos permanece preservada'));

    // Reativar Empresa A com justificativa
    const reactivateRes = await api(`/companies/${companyAId}/status`, {
      method: 'POST',
      token: superAdminToken,
      stepUpToken,
      body: {
        status: 'ACTIVE',
        reason: 'Acordo financeiro formalizado e quitado',
      },
    });
    assert.equal(reactivateRes.status, 200);
    assert.equal(reactivateRes.body.company.status, 'ACTIVE');
    assert.equal(reactivateRes.body.company.isActive, true);
  });

  it('7. Blindagem LGPD: Nenhum dado de clientes ou crianças é retornado na Central do Proprietário', async () => {
    const details = await api(`/companies/${companyAId}`, { token: superAdminToken });
    assert.equal(details.status, 200);

    const jsonString = JSON.stringify(details.body);
    assert.equal(jsonString.includes('children'), false, 'Não deve expor children');
    assert.equal(jsonString.includes('cpfResponsavel'), false, 'Não deve expor CPF de responsáveis');
    assert.equal(jsonString.includes('photos'), false, 'Não deve expor fotos');
    assert.equal(jsonString.includes('assinatura'), false, 'Não deve expor assinatura');
  });

  it('8. Trilha de Auditoria Contratual Sanitizada', async () => {
    const logsRes = await api('/audit-logs?limit=10', { token: superAdminToken });
    assert.equal(logsRes.status, 200);
    assert.ok(Array.isArray(logsRes.body));
    assert.ok(logsRes.body.length > 0);

    const actions = logsRes.body.map((l: any) => l.action);
    assert.ok(actions.includes('RATE_CONFIGURED'), 'Deve registrar RATE_CONFIGURED');
    assert.ok(actions.includes('COMPANY_SUSPENDED'), 'Deve registrar COMPANY_SUSPENDED');
    assert.ok(actions.includes('COMPANY_REACTIVATED'), 'Deve registrar COMPANY_REACTIVATED');

    // Sanitização: nenhuma senha gravada no log
    const logDetailsString = JSON.stringify(logsRes.body);
    assert.equal(logDetailsString.includes(superAdminPassword), false, 'Senha nunca deve vazar na auditoria');
  });
});
