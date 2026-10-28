import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import {
  encryptSecret,
  decryptSecret,
  maskSecret,
  rotateSecretCiphertext,
  isPrivateOrLocalIp,
  validateExternalUrl,
  isAllowedEnvVarReference,
  isAllowedEnvVarForIntegration,
  VaultConfigurationError,
} from '../src/services/vaultService';
import {
  resolveCompanyIntegration,
  checkCompanyApiBudget,
} from '../src/services/integrationResolver';
import {
  testGeminiConnection,
  testAsaasSandboxConnection,
  testGrokConnection,
} from '../src/services/integrationAdapters';
import {
  runAsaasSandboxHarness,
  inspectDatabaseTargetSafety,
} from '../src/services/asaasSandboxHarness';
import {
  getCompanyAsaasConfig,
  getCompanyAsaasConfigForExistingCharge,
  isProductionSafetyLocked,
  enqueueAsaasSync,
} from '../src/services/asaasService';
import integrationsRouter from '../src/routes/integrations';
import creditRouter from '../src/routes/credit';

// ── GUARDA PRÉ-CONEXÃO: Proíbe execução da suíte fora de banco local/descartável ──
const preFlightSafety = inspectDatabaseTargetSafety();
if (!preFlightSafety.safe) {
  throw new Error(
    `[ABORT_TEST_SUITE_OPERATIONAL_DB_GUARD] Execução da suíte bloqueada antes de conectar ao banco: ${preFlightSafety.reason}`
  );
}

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'lumora_test_jwt_secret_isolated_suite_2026_abcdef123456';
process.env.INTEGRATION_MASTER_KEY =
  process.env.INTEGRATION_MASTER_KEY ||
  'lumora_test_master_key_dedicated_64hex_0123456789abcdef0123456789abcdef';
delete process.env.ASAAS_ALLOW_LIVE_OPERATIONS;

const prisma = new PrismaClient();

async function startTestApiServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app = express();
  app.use(express.json());
  app.use('/api/owner/integrations', integrationsRouter);
  app.use('/api/credit', creditRouter);

  return new Promise((resolve) => {
    const srv: http.Server = app.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as { port: number };
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((r) => srv.close(() => r())),
      });
    });
  });
}

async function apiJson(
  baseUrl: string,
  method: string,
  path: string,
  opts?: { token?: string; stepUpToken?: string; headers?: Record<string, string>; body?: any }
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts?.headers || {}),
  };
  if (opts?.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts?.stepUpToken) headers['X-Step-Up-Token'] = opts.stepUpToken;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test('Etapa 2 — Ajustes Remanescentes Antes do Faturamento (Banco Isolado)', async (t) => {
  let companyAlphaId = '';
  let companyBetaId = '';
  let companyGammaId = '';
  let companyRealNameId = '';
  let superAdminId = '';
  let companyAdminGammaId = '';
  let superAdminJwt = '';
  let companyAdminGammaJwt = '';
  let validStepUpToken = '';
  let apiServer: { baseUrl: string; close: () => Promise<void> } | null = null;

  t.before(async () => {
    const suffix = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    const superAdmin = await prisma.user.create({
      data: {
        email: `owner_etapa2_${suffix}@lumora.test.local`,
        name: 'Proprietário Teste Etapa 2',
        role: 'SUPER_ADMIN',
        active: true,
        password: '$2b$10$FakeHashForTestingOnlyNotRealCredentials000000000000',
      },
    });
    superAdminId = superAdmin.id;

    await prisma.ownerCapability.create({
      data: {
        userId: superAdminId,
        capability: 'INTEGRATION_CONFIG',
        grantedByUserId: superAdminId,
      },
    });

    validStepUpToken = `stepup_raw_${suffix}_secret_token`;
    const tokenHash = crypto.createHash('sha256').update(validStepUpToken).digest('hex');
    await prisma.stepUpSession.create({
      data: {
        userId: superAdminId,
        tokenHash,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });

    superAdminJwt = jwt.sign(
      { id: superAdminId, role: 'SUPER_ADMIN' },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' }
    );

    const compA = await prisma.company.create({
      data: {
        name: `ETAPA2_TEST_EMPRESA_ALPHA_${suffix}`,
        legalName: 'Alpha Fotos Teste Ltda',
        cnpj: '11222333000181',
        status: 'ACTIVE',
        isActive: true,
      },
    });
    companyAlphaId = compA.id;

    await prisma.companyPlatformRate.create({
      data: {
        companyId: companyAlphaId,
        ratePercentage: 3.5,
        effectiveFrom: new Date('2026-01-01'),
        reason: 'Contrato Alpha 3.5%',
        createdByUserId: superAdminId,
      },
    });

    const encAlphaAi = encryptSecret('AIzaSy_AlphaExclusiveSecretKey_987654321');
    await prisma.companyIntegration.create({
      data: {
        companyId: companyAlphaId,
        category: 'AI_RESEARCH',
        provider: 'GEMINI',
        scope: 'EXCLUSIVE_OWN_KEY',
        status: 'ACTIVE',
        environment: 'PRODUCTION',
        accountName: 'Alpha Gemini Próprio',
        credentialSource: 'VAULT_ENCRYPTED',
        encryptedSecret: encAlphaAi.encryptedSecret,
        secretIv: encAlphaAi.secretIv,
        secretTag: encAlphaAi.secretTag,
        secretMasked: maskSecret('AIzaSy_AlphaExclusiveSecretKey_987654321'),
        createdByUserId: superAdminId,
      },
    });

    const compB = await prisma.company.create({
      data: {
        name: `ETAPA2_TEST_EMPRESA_BETA_${suffix}`,
        legalName: 'Beta Formaturas Teste Ltda',
        cnpj: '22333444000192',
        status: 'ACTIVE',
        isActive: true,
      },
    });
    companyBetaId = compB.id;

    await prisma.companyPlatformRate.create({
      data: {
        companyId: companyBetaId,
        ratePercentage: 0.0,
        effectiveFrom: new Date('2026-01-01'),
        reason: 'Gratuidade explícita ano 1',
        createdByUserId: superAdminId,
      },
    });

    const compG = await prisma.company.create({
      data: {
        name: `ETAPA2_TEST_EMPRESA_GAMMA_${suffix}`,
        legalName: 'Gamma Fotografia Teste ME',
        cnpj: '33444555000103',
        status: 'ACTIVE',
        isActive: true,
      },
    });
    companyGammaId = compG.id;

    const compReal = await prisma.company.create({
      data: {
        name: `Estúdio Comercial Operacional ${suffix}`, // Nome SEM escopo de teste!
        legalName: 'Estúdio Operacional Ltda',
        cnpj: '44555666000114',
        status: 'ACTIVE',
        isActive: true,
      },
    });
    companyRealNameId = compReal.id;

    const adminGamma = await prisma.user.create({
      data: {
        companyId: companyGammaId,
        email: `admin_gamma_${suffix}@lumora.test.local`,
        name: 'Admin Gamma',
        role: 'COMPANY_ADMIN',
        active: true,
        password: '$2b$10$FakeHashForTestingOnlyNotRealCredentials000000000000',
      },
    });
    companyAdminGammaId = adminGamma.id;
    companyAdminGammaJwt = jwt.sign(
      { id: companyAdminGammaId, role: 'COMPANY_ADMIN', companyId: companyGammaId },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' }
    );

    apiServer = await startTestApiServer();
  });

  t.after(async () => {
    if (apiServer) await apiServer.close();
    await prisma.$disconnect();
  });

  // ── 1. Vault, Criptografia, Rotação e Fail-Closed ──────────────────────────
  await t.test('1. Vault: AES-256-GCM, mascaramento, rotação e bloqueio sem chave mestra', async () => {
    const originalSecret = '$aact_YTU1YTE0M2M6N2I4MzQ2ZDA6TestSecretKey2026';
    const encrypted = encryptSecret(originalSecret);
    assert.equal(encrypted.secretIv.length, 24);
    assert.equal(encrypted.secretTag.length, 32);

    const decrypted = decryptSecret(
      encrypted.encryptedSecret,
      encrypted.secretIv,
      encrypted.secretTag
    );
    assert.equal(decrypted, originalSecret);
    assert.equal(maskSecret(originalSecret), '$aac••••••••2026');
    assert.equal(maskSecret('12345'), '••••••••');

    const keyA = Buffer.from('11111111111111111111111111111111', 'utf-8');
    const keyB = Buffer.from('22222222222222222222222222222222', 'utf-8');
    const encA = encryptSecret('SegredoRotacionado', keyA);
    const rotB = rotateSecretCiphertext(encA.encryptedSecret, encA.secretIv, encA.secretTag, keyA, keyB);
    assert.equal(decryptSecret(rotB.encryptedSecret, rotB.secretIv, rotB.secretTag, keyB), 'SegredoRotacionado');

    const prevKey = process.env.INTEGRATION_MASTER_KEY;
    try {
      delete process.env.INTEGRATION_MASTER_KEY;
      assert.throws(() => encryptSecret('x'), VaultConfigurationError);
    } finally {
      process.env.INTEGRATION_MASTER_KEY = prevKey;
    }
  });

  // ── 2. Anti-SSRF ──────────────────────────────────────────────────────────
  await t.test('2. Anti-SSRF: Bloqueio de loopback, IPs privados e domínios não homologados', async () => {
    assert.equal(isPrivateOrLocalIp('127.0.0.1'), true);
    assert.equal(isPrivateOrLocalIp('169.254.169.254'), true);
    assert.equal(isPrivateOrLocalIp('10.0.0.1'), true);
    assert.equal(isPrivateOrLocalIp('192.168.1.5'), true);
    assert.equal((await validateExternalUrl('http://127.0.0.1:3000/api')).valid, false);
    assert.equal((await validateExternalUrl('https://app-qualquer.onrender.com/x')).valid, false);
  });

  // ── 3. Referências de Variáveis Restritas por Provedor/Categoria/Ambiente ─
  await t.test('3. ENV_REFERENCE: Não atravessa fornecedor/categoria/ambiente no cadastro nem na leitura/teste', async () => {
    assert.equal(isAllowedEnvVarReference('DATABASE_URL'), false);
    assert.equal(isAllowedEnvVarReference('JWT_SECRET'), false);

    // Asaas em Gemini -> proibido
    const crossCheck1 = isAllowedEnvVarForIntegration({
      varName: 'ASAAS_SANDBOX_API_KEY',
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      environment: 'PRODUCTION',
    });
    assert.equal(crossCheck1.allowed, false);

    // Sandbox Asaas em Production Asaas -> proibido
    const crossCheck2 = isAllowedEnvVarForIntegration({
      varName: 'ASAAS_SANDBOX_API_KEY',
      category: 'PAYMENT_GATEWAY',
      provider: 'ASAAS',
      environment: 'PRODUCTION',
    });
    assert.equal(crossCheck2.allowed, false);

    // HTTP POST /api/owner/integrations rejeita referência cruzada entre provedores!
    const crossPostRes = await apiJson(apiServer!.baseUrl, 'POST', '/api/owner/integrations', {
      token: superAdminJwt,
      stepUpToken: validStepUpToken,
      body: {
        companyId: companyBetaId,
        category: 'AI_RESEARCH',
        provider: 'GEMINI',
        scope: 'EXCLUSIVE_OWN_KEY',
        environment: 'PRODUCTION',
        accountName: 'Conta Beta IA',
        credentialSource: 'ENV_REFERENCE',
        envVarName: 'META_WHATSAPP_TOKEN',
      },
    });
    assert.equal(crossPostRes.status, 400, 'API deve recusar ENV_REFERENCE de outro fornecedor no cadastro');

    // HTTP POST rejeita ENV_REFERENCE exclusiva sem vínculo de conta (accountName)
    const unboundEnvRes = await apiJson(apiServer!.baseUrl, 'POST', '/api/owner/integrations', {
      token: superAdminJwt,
      stepUpToken: validStepUpToken,
      body: {
        companyId: companyBetaId,
        category: 'PAYMENT_GATEWAY',
        provider: 'ASAAS',
        scope: 'COMPANY_EXCLUSIVE',
        environment: 'SANDBOX',
        credentialSource: 'ENV_REFERENCE',
        envVarName: 'ASAAS_SANDBOX_API_KEY',
      },
    });
    assert.equal(unboundEnvRes.status, 400, 'ENV_REFERENCE exclusiva sem accountName deve ser rejeitada');

    // Validação TAMBÉM na leitura e na rota /:id/test (caso registro adulterado exista no banco)
    process.env.META_WHATSAPP_TOKEN = 'EAAB_fake_whatsapp_secret_for_scope_test_only';
    const tampered = await prisma.companyIntegration.create({
      data: {
        companyId: companyBetaId,
        category: 'AI_RESEARCH',
        provider: 'GROK',
        scope: 'EXCLUSIVE_OWN_KEY',
        environment: 'PRODUCTION',
        status: 'ACTIVE',
        accountName: 'Conta Grok Beta',
        credentialSource: 'ENV_REFERENCE',
        envVarName: 'META_WHATSAPP_TOKEN', // Fornecedor incompatível!
        createdByUserId: superAdminId,
      },
    });

    try {
      const resolvedTampered = await resolveCompanyIntegration(companyBetaId, 'AI_RESEARCH', 'PRODUCTION');
      assert.equal(resolvedTampered.status, 'DISABLED', 'Resolver deve bloquear ENV_REFERENCE cruzada na leitura');
      assert.equal(resolvedTampered.secret, null, 'Segredo de outro fornecedor nunca pode ser retornado');

      const testRouteRes = await apiJson(
        apiServer!.baseUrl,
        'POST',
        `/api/owner/integrations/${tampered.id}/test`,
        { token: superAdminJwt }
      );
      assert.equal(testRouteRes.status, 422, 'Rota de teste deve bloquear ENV_REFERENCE incompatível com HTTP 422');
      assert.equal(testRouteRes.data.testResult.success, false);
    } finally {
      delete process.env.META_WHATSAPP_TOKEN;
      await prisma.companyIntegration.delete({ where: { id: tampered.id } });
    }
  });

  // ── 4. Revogação/Desativação Interrompe Pool Compartilhado (PLATFORM_SHARED) ─
  await t.test('4. Revogação ou desativação bloqueia pool compartilhado imediatamente sem fallback', async () => {
    process.env.GEMINI_API_KEY = 'AIzaSy_GlobalPlatformPoolTestKey_123456';
    const sharedRec = await prisma.companyIntegration.create({
      data: {
        companyId: companyBetaId,
        category: 'AI_RESEARCH',
        provider: 'GEMINI',
        scope: 'PLATFORM_SHARED',
        environment: 'PRODUCTION',
        status: 'ACTIVE',
        costPayer: 'PLATFORM',
        credentialSource: 'NONE',
        configMetadata: { allowSharedPool: true },
        createdByUserId: superAdminId,
      },
    });

    try {
      const activePool = await resolveCompanyIntegration(companyBetaId, 'AI_RESEARCH', 'PRODUCTION');
      assert.equal(activePool.status, 'ACTIVE');
      assert.equal(activePool.isShared, true);
      assert.equal(activePool.secret, 'AIzaSy_GlobalPlatformPoolTestKey_123456');

      // Revoga integração mantendo allowSharedPool: true
      await prisma.companyIntegration.update({
        where: { id: sharedRec.id },
        data: { status: 'REVOKED' },
      });

      const revokedPool = await resolveCompanyIntegration(companyBetaId, 'AI_RESEARCH', 'PRODUCTION');
      assert.equal(revokedPool.status, 'REVOKED', 'REVOKED deve interromper antes do compartilhamento');
      assert.equal(revokedPool.secret, null, 'Chave do pool nunca pode vazar após revogação');
      assert.equal(revokedPool.isShared, false);

      // Desativa integração mantendo allowSharedPool: true
      await prisma.companyIntegration.update({
        where: { id: sharedRec.id },
        data: { status: 'DISABLED' },
      });

      const disabledPool = await resolveCompanyIntegration(companyBetaId, 'AI_RESEARCH', 'PRODUCTION');
      assert.equal(disabledPool.status, 'DISABLED', 'DISABLED deve interromper antes do compartilhamento');
      assert.equal(disabledPool.secret, null);
    } finally {
      delete process.env.GEMINI_API_KEY;
      await prisma.companyIntegration.delete({ where: { id: sharedRec.id } });
    }
  });

  // ── 5. Primeiro Cadastro Completo via API (Fluxo Mobile), Step-Up, Segredos Ocultos e Limite Zero ─
  await t.test('5. Primeiro cadastro completo, Step-Up, segredo separado/mascarado e limite zero (0) persistido ponta a ponta', async () => {
    const rawApiKey = '$aact_SandboxFirstRegSecret_99887766';
    const rawWebhookSecret = 'whsec_FirstRegWebhookSecret_55443322';

    // Sem Step-Up -> 403
    const noStepUpRes = await apiJson(apiServer!.baseUrl, 'POST', '/api/owner/integrations', {
      token: superAdminJwt,
      body: {
        companyId: companyGammaId,
        category: 'PAYMENT_GATEWAY',
        provider: 'ASAAS',
        scope: 'COMPANY_EXCLUSIVE',
        environment: 'SANDBOX',
        accountName: 'Gamma Asaas Sandbox',
        plainSecret: rawApiKey,
        plainWebhookToken: rawWebhookSecret,
      },
    });
    assert.equal(noStepUpRes.status, 403);
    assert.equal(noStepUpRes.data.error, 'STEP_UP_AUTH_REQUIRED');

    // Com Step-Up e monthlyBudgetLimitCents = 0 (mesmo enviando status: 'ACTIVE', PAYMENT_GATEWAY inicia DISABLED!)
    const createRes = await apiJson(apiServer!.baseUrl, 'POST', '/api/owner/integrations', {
      token: superAdminJwt,
      stepUpToken: validStepUpToken,
      body: {
        companyId: companyGammaId,
        category: 'PAYMENT_GATEWAY',
        provider: 'ASAAS',
        scope: 'COMPANY_EXCLUSIVE',
        environment: 'SANDBOX',
        status: 'ACTIVE', // Deve ser ignorado para PAYMENT_GATEWAY -> inicia DISABLED!
        costPayer: 'COMPANY',
        accountName: 'Gamma Asaas Sandbox Conta Teste',
        credentialSource: 'VAULT_ENCRYPTED',
        plainSecret: rawApiKey,
        plainWebhookToken: rawWebhookSecret,
        walletId: 'wal_gamma_sandbox_01',
        monthlyBudgetLimitCents: 0,
      },
    });

    assert.equal(createRes.status, 201);
    const created = createRes.data.integration;
    assert.equal(created.status, 'DISABLED', 'Nova configuração bancária deve iniciar DISABLED (estado não financeiro)');
    assert.equal(created.monthlyBudgetLimitCents, 0, 'Limite zero (0) deve ser preservado na resposta do POST');
    assert.equal(created.hasWebhookToken, true);
    assert.equal(created.webhookMasked, maskSecret(rawWebhookSecret));
    assert.equal(created.secretMasked, maskSecret(rawApiKey));
    assert.equal(created.configMetadata.walletId, 'wal_gamma_sandbox_01');
    assert.equal(created.configMetadata.financialLiveAuthorized, false);

    // Segredo NUNCA aparece em JSON público ou metadados comuns
    const serializedPost = JSON.stringify(createRes.data);
    assert.equal(serializedPost.includes(rawApiKey), false, 'API Key nunca pode constar no JSON');
    assert.equal(serializedPost.includes(rawWebhookSecret), false, 'Webhook token nunca pode constar no JSON');
    assert.equal('encryptedWebhookToken' in created.configMetadata, false);
    assert.equal('webhookMasked' in created.configMetadata, false);

    // Verifica no banco e nas rotas GET de listagem e detalhe
    const dbRecord = await prisma.companyIntegration.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(dbRecord.monthlyBudgetLimitCents, 0, 'Limite zero (0) deve persistir como 0 no PostgreSQL');

    const getDetailRes = await apiJson(
      apiServer!.baseUrl,
      'GET',
      `/api/owner/integrations/${created.id}`,
      { token: superAdminJwt }
    );
    assert.equal(getDetailRes.status, 200);
    assert.equal(getDetailRes.data.integration.monthlyBudgetLimitCents, 0, 'GET /:id deve retornar 0');
    assert.equal(JSON.stringify(getDetailRes.data).includes(rawWebhookSecret), false);
    assert.equal('webhookMasked' in getDetailRes.data.integration.configMetadata, false);

    const getListRes = await apiJson(
      apiServer!.baseUrl,
      'GET',
      `/api/owner/integrations/companies/${companyGammaId}`,
      { token: superAdminJwt }
    );
    assert.equal(getListRes.status, 200);
    const listedItem = getListRes.data.integrations.find((i: any) => i.id === created.id);
    assert.equal(listedItem.monthlyBudgetLimitCents, 0, 'GET /companies/:id deve retornar 0');

    // Resolver de orçamento deve bloquear com 0
    const budgetAtZero = await checkCompanyApiBudget(companyGammaId, 'PAYMENT_GATEWAY', 'SANDBOX');
    assert.equal(budgetAtZero.withinBudget, false);
    assert.equal(budgetAtZero.limitCents, 0);

    // Validação de inteiros negativos no PUT -> 400
    const badNegRes = await apiJson(
      apiServer!.baseUrl,
      'PUT',
      `/api/owner/integrations/${created.id}`,
      {
        token: superAdminJwt,
        stepUpToken: validStepUpToken,
        body: { monthlyBudgetLimitCents: -10 },
      }
    );
    assert.equal(badNegRes.status, 400);

    // PUT para null (ilimitado) e depois de volta para 0 com auditoria
    const putNullRes = await apiJson(
      apiServer!.baseUrl,
      'PUT',
      `/api/owner/integrations/${created.id}`,
      {
        token: superAdminJwt,
        stepUpToken: validStepUpToken,
        body: {
          accountName: 'Gamma Asaas Sandbox Auditado',
          monthlyBudgetLimitCents: null,
        },
      }
    );
    assert.equal(putNullRes.status, 200);
    assert.equal(putNullRes.data.integration.monthlyBudgetLimitCents, null);
    assert.equal(putNullRes.data.integration.accountName, 'Gamma Asaas Sandbox Auditado');

    const putZeroAgainRes = await apiJson(
      apiServer!.baseUrl,
      'PUT',
      `/api/owner/integrations/${created.id}`,
      {
        token: superAdminJwt,
        stepUpToken: validStepUpToken,
        body: { monthlyBudgetLimitCents: 0 },
      }
    );
    assert.equal(putZeroAgainRes.status, 200);
    assert.equal(putZeroAgainRes.data.integration.monthlyBudgetLimitCents, 0);

    // Tentativa de habilitar financialLiveAuthorized pelo PUT comum -> 403
    const forbiddenLiveAuth = await apiJson(
      apiServer!.baseUrl,
      'PUT',
      `/api/owner/integrations/${created.id}`,
      {
        token: superAdminJwt,
        stepUpToken: validStepUpToken,
        body: { financialLiveAuthorized: true },
      }
    );
    assert.equal(forbiddenLiveAuth.status, 403);

    await prisma.companyIntegration.delete({ where: { id: created.id } });
  });

  // ── 6. Credencial PRODUCTION ACTIVE Não Habilita LIVE Sozinha + Seleção Explícita + Origem Antiga ─
  await t.test('6. Produção ACTIVE não habilita LIVE sozinha; Sandbox não é escolhido implicitamente; cobranças antigas preservam conta; Central bloqueia legado', async () => {
    // 1. Cadastra PRODUCTION para Gamma e marca status ACTIVE
    const prodCreate = await apiJson(apiServer!.baseUrl, 'POST', '/api/owner/integrations', {
      token: superAdminJwt,
      stepUpToken: validStepUpToken,
      body: {
        companyId: companyGammaId,
        category: 'PAYMENT_GATEWAY',
        provider: 'ASAAS',
        scope: 'COMPANY_EXCLUSIVE',
        environment: 'PRODUCTION',
        accountName: 'Gamma Produção Real',
        plainSecret: '$aact_prod_real_looking_key_1234567890',
        plainWebhookToken: 'whsec_prod_gamma_token_123456',
        walletId: 'wal_prod_gamma_1',
      },
    });
    assert.equal(prodCreate.status, 201);
    const prodId = prodCreate.data.integration.id;
    assert.equal(prodCreate.data.integration.status, 'DISABLED');

    const activateRes = await apiJson(
      apiServer!.baseUrl,
      'POST',
      `/api/owner/integrations/${prodId}/status`,
      {
        token: superAdminJwt,
        stepUpToken: validStepUpToken,
        body: { status: 'ACTIVE', reason: 'Teste de guarda financeira' },
      }
    );
    assert.equal(activateRes.status, 200);
    assert.equal(activateRes.data.integration.financialLiveEnabled, false);

    // Mesmo ACTIVE e com chave válida no Vault, LIVE continua BLOQUEADO!
    const liveConfig = await getCompanyAsaasConfig(companyGammaId);
    assert.equal(liveConfig.mode, 'DISABLED', 'PRODUCTION ACTIVE sem autorização financeira e trava global deve retornar DISABLED');
    assert.equal(liveConfig.apiKey, null);

    // Webhook usando o token de PRODUCTION sem autorização financeira -> 403!
    const prodWhAttempt = await apiJson(apiServer!.baseUrl, 'POST', '/api/credit/webhooks/asaas', {
      headers: { 'asaas-access-token': 'whsec_prod_gamma_token_123456' },
      body: { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_live_blocked', value: 100 } },
    });
    assert.equal(prodWhAttempt.status, 403, 'Webhook LIVE sem autorização financeira deve ser bloqueado com 403');

    // productionSafetyLocked reflete dinamicamente a guarda real (não booleano fixo)
    const lockedState = await isProductionSafetyLocked(companyGammaId);
    assert.equal(lockedState.locked, true);
    assert.equal(lockedState.activeLiveIntegrationFound, true);
    assert.equal(lockedState.financialLiveAuthorized, false);

    // Verifica que isProductionSafetyLocked responde dinamicamente se ambas as guardas forem abertas em teste isolado
    try {
      await prisma.companyIntegration.update({
        where: { id: prodId },
        data: {
          configMetadata: {
            ...((await prisma.companyIntegration.findUniqueOrThrow({ where: { id: prodId } })).configMetadata as any),
            financialLiveAuthorized: true,
          },
        },
      });
      process.env.ASAAS_ALLOW_LIVE_OPERATIONS = 'true';

      const unlockedProbe = await isProductionSafetyLocked(companyGammaId);
      assert.equal(unlockedProbe.locked, false, 'isProductionSafetyLocked deve refletir dinamicamente o estado real');
    } finally {
      delete process.env.ASAAS_ALLOW_LIVE_OPERATIONS;
      const meta = (await prisma.companyIntegration.findUniqueOrThrow({ where: { id: prodId } })).configMetadata as any;
      await prisma.companyIntegration.update({
        where: { id: prodId },
        data: { configMetadata: { ...meta, financialLiveAuthorized: false } },
      });
    }

    const relockedProbe = await isProductionSafetyLocked(companyGammaId);
    assert.equal(relockedProbe.locked, true, 'Guarda LIVE restaurada para bloqueio rigoroso');

    // 2. Deleta PRODUCTION e deixa APENAS SANDBOX ACTIVE -> operação real NUNCA escolhe Sandbox implicitamente!
    await prisma.companyIntegration.delete({ where: { id: prodId } });

    const sbCreate = await apiJson(apiServer!.baseUrl, 'POST', '/api/owner/integrations', {
      token: superAdminJwt,
      stepUpToken: validStepUpToken,
      body: {
        companyId: companyGammaId,
        category: 'PAYMENT_GATEWAY',
        provider: 'ASAAS',
        scope: 'COMPANY_EXCLUSIVE',
        environment: 'SANDBOX',
        accountName: 'Gamma Conta Sandbox A',
        plainSecret: '$aact_sb_gamma_key_99999999',
        plainWebhookToken: 'whsec_sb_gamma_token_9999',
        walletId: 'wal_sb_origem_A',
      },
    });
    const sbId = sbCreate.data.integration.id;
    await apiJson(apiServer!.baseUrl, 'POST', `/api/owner/integrations/${sbId}/status`, {
      token: superAdminJwt,
      stepUpToken: validStepUpToken,
      body: { status: 'ACTIVE' },
    });

    const implicitOpCall = await getCompanyAsaasConfig(companyGammaId);
    assert.equal(
      implicitOpCall.mode,
      'DISABLED',
      'Operação real (sem requestedEnv) NUNCA deve selecionar SANDBOX implicitamente por ausência de PRODUCTION'
    );

    const explicitSbCall = await getCompanyAsaasConfig(companyGammaId, 'SANDBOX');
    assert.equal(explicitSbCall.mode, 'SANDBOX');
    assert.equal(explicitSbCall.walletId, 'wal_sb_origem_A');

    // 3. Preservação de ambiente e conta emissora de cobranças antigas
    const gammaClient = await prisma.client.create({
      data: { companyId: companyGammaId, sequenceNumber: 'ORIG_1', name: 'Cliente Origem', phone1: '11999991111' },
    });
    const gammaSale = await prisma.sale.create({
      data: {
        companyId: companyGammaId,
        clientId: gammaClient.id,
        sellerId: companyAdminGammaId,
        value: 80,
        city: 'SP',
        product: 'Books',
        paymentMethod: 'BOLETO',
        status: 'PRONTO',
      },
    });
    const gammaAgr = await prisma.creditAgreement.create({
      data: {
        saleId: gammaSale.id,
        clientId: gammaClient.id,
        sellerId: companyAdminGammaId,
        companyId: companyGammaId,
        buyerName: 'Comprador Origem',
        buyerCpf: '04702952000',
        street: 'Rua A',
        number: '1',
        neighborhood: 'Centro',
        city: 'SP',
        state: 'SP',
        totalSaleCents: 8000,
        downPaymentCents: 0,
        financedPrincipalCents: 8000,
        remainingPrincipalCents: 8000,
        installmentsCount: 1,
        firstDueDate: new Date(),
        status: 'ACTIVE',
      },
    });
    const gammaInst = await prisma.creditInstallment.create({
      data: { agreementId: gammaAgr.id, installmentNumber: 1, dueDate: new Date(), amountCents: 8000 },
    });
    const oldPaymentId = `pay_old_origin_${Date.now()}`;
    await prisma.asaasCharge.create({
      data: {
        companyId: companyGammaId,
        agreementId: gammaAgr.id,
        installmentId: gammaInst.id,
        externalId: oldPaymentId,
        customerExternalId: 'cus_old_1',
        billingType: 'BOLETO',
        status: 'PENDING',
        nominalValueCents: 8000,
        dueDate: new Date(),
        invoiceUrl: `https://sandbox.asaas.com/i/${oldPaymentId}`,
      },
    });
    await enqueueAsaasSync({
      companyId: companyGammaId,
      agreementId: gammaAgr.id,
      installmentId: gammaInst.id,
      action: 'CREATE_CHARGE',
      idempotencyKey: `idem_orig_${oldPaymentId}`,
      payload: {
        __originMeta: {
          environment: 'SANDBOX',
          walletId: 'wal_sb_origem_A',
          accountName: 'Gamma Conta Sandbox A',
        },
      },
    });

    const sameAccountForOld = await getCompanyAsaasConfigForExistingCharge(companyGammaId, oldPaymentId);
    assert.equal(sameAccountForOld.mode, 'SANDBOX', 'Cobrança antiga de Sandbox preserva ambiente original');
    assert.equal(sameAccountForOld.walletId, 'wal_sb_origem_A');

    // Muda carteira emissora na Central -> mutação da cobrança antiga emitida em outra carteira é bloqueada!
    await apiJson(apiServer!.baseUrl, 'PUT', `/api/owner/integrations/${sbId}`, {
      token: superAdminJwt,
      stepUpToken: validStepUpToken,
      body: { walletId: 'wal_sb_outra_conta_B' },
    });
    const divergedAccountForOld = await getCompanyAsaasConfigForExistingCharge(companyGammaId, oldPaymentId);
    assert.equal(
      divergedAccountForOld.mode,
      'DISABLED',
      'Troca de conta/carteira na Central não pode mutar cobrança antiga emitida por outra conta'
    );

    // 4. Desativação/revogação na Central NÃO é anulada por fallback na tabela legada AsaasConfig
    await prisma.asaasConfig.upsert({
      where: { companyId: companyGammaId },
      create: {
        companyId: companyGammaId,
        mode: 'SANDBOX',
        apiKey: '$aact_legacy_should_not_override',
        webhookToken: 'whsec_legacy_should_not_override',
      },
      update: {
        mode: 'SANDBOX',
        apiKey: '$aact_legacy_should_not_override',
        webhookToken: 'whsec_legacy_should_not_override',
      },
    });

    await apiJson(apiServer!.baseUrl, 'POST', `/api/owner/integrations/${sbId}/status`, {
      token: superAdminJwt,
      stepUpToken: validStepUpToken,
      body: { status: 'REVOKED' },
    });

    const afterRevoke = await getCompanyAsaasConfig(companyGammaId, 'SANDBOX');
    assert.equal(afterRevoke.mode, 'DISABLED', 'Revogação na Central jamais cai para tabela legada AsaasConfig');

    const legacyWhBypassAttempt = await apiJson(
      apiServer!.baseUrl,
      'POST',
      '/api/credit/webhooks/asaas',
      {
        headers: { 'asaas-access-token': 'whsec_legacy_should_not_override' },
        body: { event: 'PAYMENT_RECEIVED', payment: { id: oldPaymentId, value: 80 } },
      }
    );
    assert.equal(legacyWhBypassAttempt.status, 401, 'Token legado não pode contornar empresa governada pela Central');

    // Rota legada POST /api/credit/asaas/config bloqueia PRODUCTION (403) e empresa governada pela Central (409)
    const legacyProdAttempt = await apiJson(apiServer!.baseUrl, 'POST', '/api/credit/asaas/config', {
      token: companyAdminGammaJwt,
      body: { mode: 'PRODUCTION', apiKey: 'qualquer' },
    });
    assert.equal(legacyProdAttempt.status, 403);

    const legacySandboxConflict = await apiJson(apiServer!.baseUrl, 'POST', '/api/credit/asaas/config', {
      token: companyAdminGammaJwt,
      body: { mode: 'SANDBOX', apiKey: 'qualquer' },
    });
    assert.equal(legacySandboxConflict.status, 409);

    await prisma.companyIntegration.delete({ where: { id: sbId } });
    await prisma.asaasConfig.delete({ where: { companyId: companyGammaId } });
  });

  // ── 7. Guarda de Banco Operacional / Produção e Zero Fallback de Credenciais ─
  await t.test('7. Produção/banco operacional impede escrita de homologação (HTTP 422) mesmo para empresa de teste; sem chave/token não há fallback', async () => {
    const eventsBefore = await prisma.asaasWebhookEvent.count({ where: { companyId: companyGammaId } });

    // A. Mesmo selecionando empresa de teste (ETAPA2_TEST_...), URL de banco operacional (render.com) bloqueia com 422!
    const origDbUrl = process.env.DATABASE_URL;
    try {
      process.env.DATABASE_URL =
        'postgresql://user:pass@dpg-d9ic4afavr4c73aindgg-a.virginia-postgres.render.com/banco_app_v0av';
      const blockedDbRes = await apiJson(
        apiServer!.baseUrl,
        'POST',
        '/api/owner/integrations/sandbox/run-homologation',
        {
          token: superAdminJwt,
          stepUpToken: validStepUpToken,
          body: {
            companyId: companyGammaId,
            forceSimulation: true,
            webhookToken: 'whsec_should_never_write',
          },
        }
      );
      assert.equal(blockedDbRes.status, 422, 'Banco operacional deve retornar HTTP 422');
      assert.equal(blockedDbRes.data.report.overallStatus, 'BLOCKED_PRODUCTION_GUARD');
    } finally {
      process.env.DATABASE_URL = origDbUrl;
    }

    // B. Mesmo em banco local de teste, empresa real sem escopo de teste é bloqueada com 422!
    const blockedRealCompanyRes = await apiJson(
      apiServer!.baseUrl,
      'POST',
      '/api/owner/integrations/sandbox/run-homologation',
      {
        token: superAdminJwt,
        stepUpToken: validStepUpToken,
        body: {
          companyId: companyRealNameId,
          forceSimulation: true,
          webhookToken: 'whsec_should_not_run_on_real_company',
        },
      }
    );
    assert.equal(blockedRealCompanyRes.status, 422);
    assert.equal(blockedRealCompanyRes.data.report.overallStatus, 'BLOCKED_PRODUCTION_GUARD');

    const eventsAfterGuard = await prisma.asaasWebhookEvent.count({ where: { companyId: companyGammaId } });
    assert.equal(eventsAfterGuard, eventsBefore, 'Nenhuma escrita de evento pode ocorrer quando a guarda bloqueia');

    // C. Sem chave ou sem token da empresa -> ZERO fallback para ASAAS_SANDBOX_API_KEY / ASAAS_SANDBOX_WEBHOOK_TOKEN globais!
    process.env.ASAAS_SANDBOX_API_KEY = '$aact_global_env_must_never_be_used_implicitly';
    process.env.ASAAS_SANDBOX_WEBHOOK_TOKEN = 'whsec_global_env_must_never_be_used_implicitly';
    try {
      const noCredsRes = await apiJson(
        apiServer!.baseUrl,
        'POST',
        '/api/owner/integrations/sandbox/run-homologation',
        {
          token: superAdminJwt,
          stepUpToken: validStepUpToken,
          body: { companyId: companyGammaId, forceSimulation: false },
        }
      );
      assert.equal(noCredsRes.status, 422);
      assert.equal(noCredsRes.data.report.overallStatus, 'BLOCKED_MISSING_CREDENTIALS');

      const noWhSimRes = await apiJson(
        apiServer!.baseUrl,
        'POST',
        '/api/owner/integrations/sandbox/run-homologation',
        {
          token: superAdminJwt,
          stepUpToken: validStepUpToken,
          body: { companyId: companyGammaId, forceSimulation: true },
        }
      );
      assert.equal(noWhSimRes.status, 422);
      assert.equal(noWhSimRes.data.report.overallStatus, 'BLOCKED_MISSING_WEBHOOK_TOKEN');
    } finally {
      delete process.env.ASAAS_SANDBOX_API_KEY;
      delete process.env.ASAAS_SANDBOX_WEBHOOK_TOKEN;
    }
  });

  // ── 8. Jornada Real HTTP: Baixa, Comissão 10%, Replay HTTP, Concorrência, Reinício e Estorno ─
  await t.test('8. Jornada real por HTTP: amortização, comissão 10%, replay HTTP, concorrência, replay pós-reinício, estorno e falta de retorno -> PENDING_PROVIDER_WEBHOOK (202)', async () => {
    // 1. Executa jornada de simulação via rota HTTP da Central -> exercita rota real /api/credit/webhooks/asaas,
    //    concorrência e reinício de servidor Express!
    const simHttpRes = await apiJson(
      apiServer!.baseUrl,
      'POST',
      '/api/owner/integrations/sandbox/run-homologation',
      {
        token: superAdminJwt,
        stepUpToken: validStepUpToken,
        body: {
          companyId: companyAlphaId,
          forceSimulation: true,
          sandboxApiKey: '$aact_alpha_sim_key_123456',
          webhookToken: 'whsec_alpha_real_processor_token_2026',
        },
      }
    );

    assert.equal(simHttpRes.status, 200);
    const simReport = simHttpRes.data.report;
    assert.equal(simReport.overallStatus, 'PASSED');
    assert.equal(simReport.environment, 'SIMULATION_TEST');
    assert.equal(simReport.readinessForLive.sandboxHomologated, false, 'Simulação NUNCA homologa externamente');
    assert.equal(simReport.readinessForLive.idempotencyVerified, true);
    assert.equal(simReport.readinessForLive.adverseCasesVerified, true);
    assert.equal(simReport.steps.every((s: any) => s.status === 'SUCCESS'), true);

    // 2. Testa também estorno real (PAYMENT_REFUNDED) na rota operacional /api/credit/webhooks/asaas
    const settledPayment = await prisma.creditPayment.findFirstOrThrow({
      where: { companyId: companyAlphaId, isReversed: false },
      orderBy: { createdAt: 'desc' },
    });
    const refundRes = await apiJson(apiServer!.baseUrl, 'POST', '/api/credit/webhooks/asaas', {
      headers: { 'asaas-access-token': 'whsec_alpha_real_processor_token_2026' },
      body: {
        id: `evt_refund_test_${Date.now()}`,
        event: 'PAYMENT_REFUNDED',
        payment: {
          id: settledPayment.externalPaymentId,
          value: 50.0,
          netValue: 49.01,
          billingType: 'BOLETO',
        },
      },
    });
    assert.equal(refundRes.status, 200);
    const reversedPayment = await prisma.creditPayment.findUniqueOrThrow({ where: { id: settledPayment.id } });
    assert.equal(reversedPayment.isReversed, true, 'PAYMENT_REFUNDED deve estornar o recebimento');
    const reversedComm = await prisma.creditCommission.findFirstOrThrow({ where: { paymentId: settledPayment.id } });
    assert.equal(reversedComm.status, 'REVERSED', 'Comissão de 10% deve ser estornada junto ao pagamento');

    // 3. Modo Oficial (!isSimulation) SEM retorno do provedor Asaas Sandbox:
    //    Intercepta apenas chamadas externas para api-sandbox.asaas.com (simulando que o Asaas criou a cobrança
    //    mas ainda não entregou o webhook público) -> NUNCA substitui por payload local, retorna HTTP 202 + PENDING_PROVIDER_WEBHOOK!
    const realFetch = globalThis.fetch;
    let paySeq = 0;
    let firstMockExternalPayId = '';
    let latestMockExternalPayId = '';
    globalThis.fetch = (async (input: any, init?: any) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (urlStr.startsWith('https://api-sandbox.asaas.com/v3/customers')) {
        return new Response(JSON.stringify({ id: 'cus_official_sandbox_001' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.endsWith('/simulatePayment')) {
        return new Response(JSON.stringify({ id: latestMockExternalPayId, status: 'RECEIVED' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.startsWith('https://api-sandbox.asaas.com/v3/payments')) {
        latestMockExternalPayId = `pay_official_pending_${Date.now()}_${++paySeq}`;
        if (!firstMockExternalPayId) firstMockExternalPayId = latestMockExternalPayId;
        return new Response(JSON.stringify({ id: latestMockExternalPayId, status: 'PENDING', value: 50.0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return realFetch(input, init);
    }) as typeof fetch;

    try {
      // Cadastra e ativa credencial Sandbox oficial de teste para Beta
      const betaSb = await apiJson(apiServer!.baseUrl, 'POST', '/api/owner/integrations', {
        token: superAdminJwt,
        stepUpToken: validStepUpToken,
        body: {
          companyId: companyBetaId,
          category: 'PAYMENT_GATEWAY',
          provider: 'ASAAS',
          scope: 'COMPANY_EXCLUSIVE',
          environment: 'SANDBOX',
          accountName: 'Beta Conta Sandbox Oficial',
          plainSecret: '$aact_beta_official_sandbox_key_123456',
          plainWebhookToken: 'whsec_beta_official_sandbox_2026',
        },
      });
      await apiJson(
        apiServer!.baseUrl,
        'POST',
        `/api/owner/integrations/${betaSb.data.integration.id}/status`,
        {
          token: superAdminJwt,
          stepUpToken: validStepUpToken,
          body: { status: 'ACTIVE' },
        }
      );

      // Executa via harness com providerWebhookWaitMs curto (sem chegada de webhook do provedor)
      const officialPendingReport = await runAsaasSandboxHarness({
        companyId: companyBetaId,
        forceSimulation: false,
        providerWebhookWaitMs: 60,
      });

      assert.equal(
        officialPendingReport.overallStatus,
        'PENDING_PROVIDER_WEBHOOK',
        'Sem webhook real do provedor, modo oficial deve ficar em PENDING_PROVIDER_WEBHOOK'
      );
      assert.equal(
        officialPendingReport.readinessForLive.sandboxHomologated,
        false,
        'Falta de retorno externo NUNCA pode aprovar homologação oficial'
      );

      const pendingCharge = await prisma.asaasCharge.findFirstOrThrow({
        where: { companyId: companyBetaId, externalId: firstMockExternalPayId },
        include: { installment: true },
      });
      assert.equal(
        pendingCharge.installment.status,
        'PENDING',
        'Parcela da cobrança Sandbox permanece PENDING (zero substituição por payload local)'
      );

      // Verifica também o status HTTP 202 na rota /sandbox/run-homologation
      const routePendingRes = await apiJson(
        apiServer!.baseUrl,
        'POST',
        '/api/owner/integrations/sandbox/run-homologation',
        {
          token: superAdminJwt,
          stepUpToken: validStepUpToken,
          body: { companyId: companyBetaId, forceSimulation: false, providerWebhookWaitMs: 60 },
        }
      );
      assert.equal(routePendingRes.status, 202, 'Rota deve retornar HTTP 202 quando aguarda webhook do provedor');
      assert.equal(routePendingRes.data.report.overallStatus, 'PENDING_PROVIDER_WEBHOOK');
      assert.equal(routePendingRes.data.report.readinessForLive.sandboxHomologated, false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  // ── 9. Regras Comerciais Preservadas ───────────────────────────────────────
  await t.test('9. Regras comerciais intactas: Taxa Lumora variável por empresa/vigência, sem bitributar parcela, e comissão vendedor 20%/25%/10%', async () => {
    const repAlpha = await runAsaasSandboxHarness({
      companyId: companyAlphaId,
      forceSimulation: true,
      webhookToken: 'whsec_alpha_real_processor_token_2026',
    });
    const s7Alpha = repAlpha.steps.find((s) => s.step === 7)!;
    assert.equal(s7Alpha.data.activePlatformRate, 3.5);
    assert.equal(s7Alpha.data.lumoraFeeOnSaleCents, 350);
    assert.equal(s7Alpha.data.lumoraFeeOnInstallmentCents, 0);
    assert.equal(s7Alpha.data.sellerCommissionCompanyCarCents, 2000);
    assert.equal(s7Alpha.data.sellerCommissionOwnCarCents, 2500);
    assert.equal(s7Alpha.data.sellerCommissionInstallmentCents, 500);

    const repBeta = await runAsaasSandboxHarness({
      companyId: companyBetaId,
      forceSimulation: true,
      webhookToken: 'whsec_beta_official_sandbox_2026',
    });
    const s7Beta = repBeta.steps.find((s) => s.step === 7)!;
    assert.equal(s7Beta.data.activePlatformRate, 0.0);
    assert.equal(s7Beta.data.lumoraFeeOnSaleCents, 0);

    const repGamma = await runAsaasSandboxHarness({
      companyId: companyGammaId,
      forceSimulation: true,
      webhookToken: 'whsec_gamma_sim_token_2026',
    });
    const s7Gamma = repGamma.steps.find((s) => s.step === 7)!;
    assert.equal(s7Gamma.data.activePlatformRate, null);
    assert.equal(s7Gamma.data.lumoraFeeOnSaleCents, null);
  });

  // ── 10. Adaptadores com Mock Explícito ─────────────────────────────────────
  await t.test('10. Adaptadores: Mocks controlados apenas por opção explícita', async () => {
    assert.equal((await testGeminiConnection('curta')).success, false);
    assert.equal((await testAsaasSandboxConnection('curta')).success, false);
    assert.equal((await testGeminiConnection('AIzaSy_chave_longa_teste_123456', { mockResponse: true })).success, true);
    assert.equal((await testAsaasSandboxConnection('$aact_chave_longa_teste_123456', { mockResponse: true })).success, true);
    assert.equal((await testGrokConnection('xai_chave_longa_teste_123456', { mockResponse: true })).success, true);
  });
});
