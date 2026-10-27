import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import {
  encryptSecret,
  decryptSecret,
  maskSecret,
  rotateSecretCiphertext,
  isPrivateOrLocalIp,
  validateExternalUrl,
  isAllowedEnvVarReference,
  VaultConfigurationError,
} from '../src/services/vaultService';
import {
  resolveCompanyIntegration,
  recordApiUsage,
  checkCompanyApiBudget,
  lookupViaCep,
} from '../src/services/integrationResolver';
import {
  testGeminiConnection,
  testViaCepConnection,
  testAsaasSandboxConnection,
  testGrokConnection,
  executeGrokChatCompletion,
} from '../src/services/integrationAdapters';
import { runAsaasSandboxHarness } from '../src/services/asaasSandboxHarness';
import { getCompanyAsaasConfig } from '../src/services/asaasService';

const prisma = new PrismaClient();

// Garante chave mestra para a suíte de testes se não estiver injetada
process.env.INTEGRATION_MASTER_KEY =
  process.env.INTEGRATION_MASTER_KEY || 'lumora_test_master_key_dedicated_64hex_0123456789abcdef0123456789abcdef';

test('Central de Integrações e APIs — Correção e Blindagem da Etapa 2', async (t) => {
  let companyAlphaId = '';
  let companyBetaId = '';
  let companyGammaId = '';
  let testAdminUserId = '';

  // Setup: Criação de fixtures exclusivas de teste isoladas contra banco de produção
  t.before(async () => {
    // 1. Cria usuário Super Admin dedicado para os testes
    const testAdmin = await prisma.user.create({
      data: {
        email: `test_admin_etapa2_${Date.now()}@lumora.test.local`,
        name: 'Admin Teste Etapa 2',
        role: 'SUPER_ADMIN',
        password: '$2b$10$FakeHashForTestingOnlyNotRealCredentials',
      },
      select: { id: true },
    });
    testAdminUserId = testAdmin.id;

    // 2. Cria Empresa Alpha (com taxa Lumora 3.5% e chave de IA própria no Vault)
    const compA = await prisma.company.create({
      data: {
        name: `ETAPA2_TEST_EMPRESA_ALPHA_${Date.now()}`,
        legalName: 'Alpha Fotos e Eventos Ltda ME',
        cnpj: '11222333000181',
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    companyAlphaId = compA.id;

    // Taxa contratual de 3.5% para Alpha
    await prisma.companyPlatformRate.create({
      data: {
        companyId: companyAlphaId,
        ratePercentage: 3.5,
        effectiveFrom: new Date('2026-01-01'),
        reason: 'Contrato padrão Alpha 3.5%',
        createdByUserId: testAdminUserId,
      },
    });

    // Integração própria no Vault para Alpha (Gemini)
    const encSecretAlpha = encryptSecret('AIzaSy_AlphaExclusiveSecretKey_987654321');
    await prisma.companyIntegration.create({
      data: {
        companyId: companyAlphaId,
        category: 'AI_RESEARCH',
        provider: 'GEMINI',
        scope: 'EXCLUSIVE_OWN_KEY',
        status: 'ACTIVE',
        environment: 'PRODUCTION',
        credentialSource: 'VAULT_ENCRYPTED',
        encryptedSecret: encSecretAlpha.encryptedSecret,
        secretIv: encSecretAlpha.secretIv,
        secretTag: encSecretAlpha.secretTag,
        secretMasked: maskSecret('AIzaSy_AlphaExclusiveSecretKey_987654321'),
        createdByUserId: testAdminUserId,
      },
    });

    // 3. Cria Empresa Beta (com taxa Lumora 0.0% / Gratuidade explícita e compartilhamento de IA NÃO contratado)
    const compB = await prisma.company.create({
      data: {
        name: `ETAPA2_TEST_EMPRESA_BETA_${Date.now()}`,
        legalName: 'Beta Formaturas Ltda',
        cnpj: '22333444000192',
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    companyBetaId = compB.id;

    // Taxa contratual explícita de 0% (Gratuidade)
    await prisma.companyPlatformRate.create({
      data: {
        companyId: companyBetaId,
        ratePercentage: 0.0,
        effectiveFrom: new Date('2026-01-01'),
        reason: 'Gratuidade contratual promocional ano 1',
        createdByUserId: testAdminUserId,
      },
    });

    // 4. Cria Empresa Gamma (Empresa sem taxa configurada e sem integrações)
    const compG = await prisma.company.create({
      data: {
        name: `ETAPA2_TEST_EMPRESA_GAMMA_${Date.now()}`,
        legalName: 'Gamma Fotografia ME',
        cnpj: '33444555000103',
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    companyGammaId = compG.id;
  });

  // Teardown: Limpeza cirúrgica estrita apenas das fixtures criadas
  t.after(async () => {
    const testCompanyIds = [companyAlphaId, companyBetaId, companyGammaId].filter(Boolean);
    if (testCompanyIds.length > 0) {
      // Limpeza de tabelas filhas
      await prisma.apiUsageRecord.deleteMany({ where: { companyId: { in: testCompanyIds } } });
      await prisma.integrationAuditEvent.deleteMany({ where: { companyId: { in: testCompanyIds } } });
      await prisma.companyIntegration.deleteMany({ where: { companyId: { in: testCompanyIds } } });
      await prisma.companyPlatformRate.deleteMany({ where: { companyId: { in: testCompanyIds } } });
      await prisma.company.deleteMany({ where: { id: { in: testCompanyIds } } });
    }

    if (testAdminUserId) {
      await prisma.user.delete({ where: { id: testAdminUserId } }).catch(() => {});
    }
  });

  // ── 1. Vault, Criptografia, Rotação e Fail-Safe ────────────────────────────
  await t.test('1. Vault: AES-256-GCM, Mascaramento, Rotação e Fail-Safe sem Master Key', async () => {
    const originalSecret = '$aact_YTU1YTE0M2M6N2I4MzQ2ZDA6TestSecretKey2026';
    const encrypted = encryptSecret(originalSecret);

    assert.ok(encrypted.encryptedSecret, 'Segredo criptografado deve existir');
    assert.ok(encrypted.secretIv, 'IV deve existir');
    assert.equal(encrypted.secretIv.length, 24, 'IV deve ter 12 bytes em hex (24 chars)');
    assert.ok(encrypted.secretTag, 'Auth Tag deve existir');
    assert.equal(encrypted.secretTag.length, 32, 'Tag deve ter 16 bytes em hex (32 chars)');

    // Descriptografia exata com a chave primária
    const decrypted = decryptSecret(
      encrypted.encryptedSecret,
      encrypted.secretIv,
      encrypted.secretTag
    );
    assert.equal(decrypted, originalSecret, 'Segredo descriptografado deve ser idêntico ao original');

    // Mascaramento rigoroso
    const maskedLong = maskSecret(originalSecret);
    assert.ok(maskedLong.startsWith('$aac'), 'Máscara deve preservar primeiros 4 chars');
    assert.ok(maskedLong.endsWith('2026'), 'Máscara deve preservar últimos 4 chars');
    assert.ok(maskedLong.includes('••••••••'), 'Máscara deve conter caracteres de bloqueio');

    const maskedShort = maskSecret('12345');
    assert.equal(maskedShort, '••••••••', 'Segredo curto deve ser totalmente mascarado');

    // Rotação de chave: recriptografa de chave antiga para chave nova
    const keyA = Buffer.from('11111111111111111111111111111111', 'utf-8');
    const keyB = Buffer.from('22222222222222222222222222222222', 'utf-8');
    const encWithA = encryptSecret('ChaveSecretaRotacionavel', keyA);
    const rotatedToB = rotateSecretCiphertext(
      encWithA.encryptedSecret,
      encWithA.secretIv,
      encWithA.secretTag,
      keyA,
      keyB
    );
    const decWithB = decryptSecret(
      rotatedToB.encryptedSecret,
      rotatedToB.secretIv,
      rotatedToB.secretTag,
      keyB
    );
    assert.equal(decWithB, 'ChaveSecretaRotacionavel', 'Rotação deve preservar leitura com a nova chave');

    // Fail-Safe: Ausência de chave mestra lança VaultConfigurationError seguro
    const originalEnvKey = process.env.INTEGRATION_MASTER_KEY;
    try {
      delete process.env.INTEGRATION_MASTER_KEY;
      assert.throws(
        () => encryptSecret('segredo_sem_chave'),
        VaultConfigurationError,
        'Cofre sem chave mestra configurada deve falhar de forma segura lançando VaultConfigurationError'
      );
    } finally {
      process.env.INTEGRATION_MASTER_KEY = originalEnvKey;
    }
  });

  // ── 2. Proteção de Rede e Anti-SSRF ───────────────────────────────────────
  await t.test('2. Proteção Anti-SSRF: Bloqueio de IPs Privados, Loopback, Metadados e HTTPS', async () => {
    // IPs perigosos e privados
    assert.equal(isPrivateOrLocalIp('127.0.0.1'), true, '127.0.0.1 deve ser bloqueado');
    assert.equal(isPrivateOrLocalIp('localhost'), true, 'localhost deve ser bloqueado');
    assert.equal(isPrivateOrLocalIp('169.254.169.254'), true, 'Metadados AWS/GCP (169.254.169.254) devem ser bloqueados');
    assert.equal(isPrivateOrLocalIp('10.0.0.1'), true, 'Rede interna 10.x deve ser bloqueada');
    assert.equal(isPrivateOrLocalIp('192.168.1.1'), true, 'Rede interna 192.168.x deve ser bloqueada');
    assert.equal(isPrivateOrLocalIp('172.20.0.1'), true, 'Rede interna 172.16-31.x deve ser bloqueada');

    // URLs maliciosas bloqueadas
    const check1 = await validateExternalUrl('http://127.0.0.1:3000/internal-admin');
    assert.equal(check1.valid, false, 'Loopback deve ser rejeitado');

    const check2 = await validateExternalUrl('http://169.254.169.254/latest/meta-data/');
    assert.equal(check2.valid, false, 'Metadados de nuvem devem ser rejeitados');

    const check3 = await validateExternalUrl('https://evil-attacker-site.com/webhook');
    assert.equal(check3.valid, false, 'Domínio fora do catálogo estrito deve ser rejeitado');

    const checkRenderWildcard = await validateExternalUrl('https://qualquer-app-malicioso.onrender.com/webhook');
    assert.equal(checkRenderWildcard.valid, false, 'Permissão genérica para onrender.com deve estar bloqueada');

    // URLs oficiais autorizadas (com endpoint oficial Sandbox)
    const checkSandbox = await validateExternalUrl('https://api-sandbox.asaas.com/v3/customers');
    assert.equal(checkSandbox.valid, true, 'api-sandbox.asaas.com oficial deve ser autorizado');

    const checkViaCep = await validateExternalUrl('https://viacep.com.br/ws/01001000/json/');
    assert.equal(checkViaCep.valid, true, 'ViaCEP oficial deve ser autorizado');
  });

  // ── 3. Catálogo Restrito de Referências de Infraestrutura ─────────────────
  await t.test('3. Catálogo Restrito de Referências de Ambiente (ENV_REFERENCE)', async () => {
    // Variáveis autorizadas
    assert.equal(isAllowedEnvVarReference('GEMINI_API_KEY'), true);
    assert.equal(isAllowedEnvVarReference('ASAAS_SANDBOX_API_KEY'), true);
    assert.equal(isAllowedEnvVarReference('ASAAS_SANDBOX_WEBHOOK_TOKEN'), true);
    assert.equal(isAllowedEnvVarReference('META_WHATSAPP_TOKEN'), true);
    assert.equal(isAllowedEnvVarReference('GROK_API_KEY'), true);

    // Variáveis de infraestrutura sensíveis PROIBIDAS de referência externa
    assert.equal(isAllowedEnvVarReference('DATABASE_URL'), false, 'DATABASE_URL deve ser estritamente proibida');
    assert.equal(isAllowedEnvVarReference('JWT_SECRET'), false, 'JWT_SECRET deve ser estritamente proibida');
    assert.equal(isAllowedEnvVarReference('INTEGRATION_MASTER_KEY'), false, 'INTEGRATION_MASTER_KEY deve ser estritamente proibida');
    assert.equal(isAllowedEnvVarReference('B2_APPLICATION_KEY'), false, 'Chaves B2 de storage devem ser proibidas');
    assert.equal(isAllowedEnvVarReference('QUALQUER_VARIAVEL_ALEATORIA'), false, 'Variável não catalogada deve ser proibida');
  });

  // ── 4. Isolamento Multi-Tenant Estrito e Eliminação de Fallback Silencioso ──
  await t.test('4. Isolamento Multi-Tenant Estrito (Sem fallback para chave global ou outra empresa)', async () => {
    // Empresa Gamma sem gateway de pagamento cadastrado
    const resolvedGateway = await resolveCompanyIntegration(companyGammaId, 'PAYMENT_GATEWAY');
    assert.equal(resolvedGateway.status, 'DISABLED', 'Empresa sem gateway deve retornar DISABLED');
    assert.equal(resolvedGateway.secret, null, 'Nenhum segredo de outra empresa ou chave global pode ser retornado');
    assert.equal(resolvedGateway.isShared, false, 'Gateways bancários não podem ser compartilhados');

    // Serviço Asaas operacional para empresa sem configuração
    const asaasConfig = await getCompanyAsaasConfig(companyGammaId);
    assert.equal(asaasConfig.mode, 'DISABLED', 'Modo Asaas sem integração deve ser DISABLED');
    assert.equal(asaasConfig.apiKey, null, 'Chave Asaas nunca deve herdar chave global do servidor');

    // Empresa Gamma sem WhatsApp cadastrado
    const resolvedMessaging = await resolveCompanyIntegration(companyGammaId, 'MESSAGING');
    assert.equal(resolvedMessaging.status, 'DISABLED', 'Empresa sem WhatsApp deve retornar DISABLED');
    assert.equal(resolvedMessaging.secret, null);
  });

  // ── 5. Isolamento de IA: Compartilhamento Apenas Sob Autorização Explícita ───
  await t.test('5. Isolamento de IA: Chave exclusiva resolvida; compartilhamento exige contratação explícita', async () => {
    // Empresa Alpha possui chave exclusiva no Vault
    const resolvedAlphaAi = await resolveCompanyIntegration(companyAlphaId, 'AI_RESEARCH');
    assert.equal(resolvedAlphaAi.status, 'ACTIVE');
    assert.equal(resolvedAlphaAi.provider, 'GEMINI');
    assert.equal(resolvedAlphaAi.isShared, false, 'Empresa com chave própria não é compartilhada');
    assert.equal(resolvedAlphaAi.secret, 'AIzaSy_AlphaExclusiveSecretKey_987654321');

    // Empresa Beta NÃO contratou compartilhamento: deve retornar DISABLED (zero fallback silencioso para chave global!)
    const resolvedBetaAi = await resolveCompanyIntegration(companyBetaId, 'AI_RESEARCH');
    assert.equal(resolvedBetaAi.status, 'DISABLED', 'Sem autorização explícita, IA deve permanecer DISABLED');
    assert.equal(resolvedBetaAi.secret, null, 'Chave global do Gemini não pode ser vazada para empresa não autorizada');
  });

  // ── 6. Orçamento de IA: Limite Zero vs Limite Ausente ─────────────────────
  await t.test('6. Orçamento de IA: Limite zero bloqueia; limite ausente permite', async () => {
    // Cria integração de teste para orçamento com limite 0 (bloqueado)
    const compBudgetZero = await prisma.companyIntegration.create({
      data: {
        companyId: companyGammaId,
        category: 'AI_RESEARCH',
        provider: 'GEMINI',
        scope: 'EXCLUSIVE_OWN_KEY',
        status: 'ACTIVE',
        monthlyBudgetLimitCents: 0, // Bloqueio imediato
        createdByUserId: testAdminUserId,
      },
    });

    const checkZero = await checkCompanyApiBudget(companyGammaId, 'AI_RESEARCH');
    assert.equal(checkZero.withinBudget, false, 'Limite 0 cents deve bloquear imediatamente');
    assert.equal(checkZero.limitCents, 0);

    // Atualiza para limite null (ilimitado)
    await prisma.companyIntegration.update({
      where: { id: compBudgetZero.id },
      data: { monthlyBudgetLimitCents: null },
    });

    const checkUnlimited = await checkCompanyApiBudget(companyGammaId, 'AI_RESEARCH');
    assert.equal(checkUnlimited.withinBudget, true, 'Limite null deve ser irrestrito');
    assert.equal(checkUnlimited.limitCents, null);

    // Limpeza
    await prisma.companyIntegration.delete({ where: { id: compBudgetZero.id } });
  });

  // ── 7. Roteiro Asaas Sandbox: Sem Chave Bloqueia com BLOCKED_MISSING_CREDENTIALS
  await t.test('7. Roteiro Asaas Sandbox: Ausência de credenciais bloqueia com BLOCKED_MISSING_CREDENTIALS', async () => {
    // Execução oficial solicitada para empresa Gamma (sem chave de Sandbox)
    const report = await runAsaasSandboxHarness({
      companyId: companyGammaId,
      forceSimulation: false,
    });

    assert.equal(report.overallStatus, 'BLOCKED_MISSING_CREDENTIALS', 'Sem chave deve bloquear');
    assert.equal(report.environment, 'SANDBOX', 'Ambiente declarado deve ser SANDBOX');
    assert.equal(report.readinessForLive.sandboxHomologated, false, 'Homologação oficial deve ser false');
    assert.equal(report.productionSafetyLocked, true, 'Trava LIVE deve estar ativa');
    assert.ok(report.readinessForLive.pendingOwnerActions.length > 0, 'Deve listar ações pendentes do proprietário');
  });

  // ── 8. Roteiro Asaas Sandbox: Simulação NUNCA Aprova Homologação Oficial ────
  await t.test('8. Roteiro Asaas Sandbox: Simulação valida cenários mas mantém sandboxHomologated: false', async () => {
    const report = await runAsaasSandboxHarness({
      companyId: companyAlphaId,
      forceSimulation: true, // Simulação explícita
      sandboxApiKey: '$aact_test_key_simulated_only',
      webhookToken: 'test_valid_token_2026',
      incomingTestWebhookToken: 'test_valid_token_2026',
    });

    assert.equal(report.overallStatus, 'PASSED', 'Cenários simulados devem passar');
    assert.equal(report.environment, 'SIMULATION_TEST', 'Ambiente deve ser explicitamente SIMULATION_TEST');
    // Ponto CRÍTICO apontado pelo usuário: Simulação NUNCA deve devolver sandboxHomologated: true!
    assert.equal(
      report.readinessForLive.sandboxHomologated,
      false,
      'Simulação local não pode aprovar homologação oficial de prontidão bancária externa'
    );
    assert.equal(report.readinessForLive.liveModeStatus, 'DISABLED');
    assert.equal(report.steps.length, 8, 'Harness deve conter exatamente 8 etapas');
  });

  // ── 9. Autenticidade de Webhook e Prevenção de Duplicidade Persistida ──────
  await t.test('9. Webhook: Token autêntico aprovado; token falso rejeitado; idempotência persistida', async () => {
    // Token divergente no harness
    const reportWrongToken = await runAsaasSandboxHarness({
      companyId: companyAlphaId,
      forceSimulation: true,
      webhookToken: 'token_correto_configurado_123',
      incomingTestWebhookToken: 'token_divergente_malicioso_999',
    });

    const webhookStep = reportWrongToken.steps.find((s) => s.step === 5);
    assert.ok(webhookStep, 'Etapa 5 de webhook deve existir');
    assert.equal(webhookStep.status, 'FAILED', 'Webhook com token falso deve falhar autenticação');
    assert.equal(reportWrongToken.overallStatus, 'FAILED');

    // Idempotência persistida com token válido
    const reportValid = await runAsaasSandboxHarness({
      companyId: companyAlphaId,
      forceSimulation: true,
      webhookToken: 'token_correto_configurado_123',
      incomingTestWebhookToken: 'token_correto_configurado_123',
    });
    const idempStep = reportValid.steps.find((s) => s.step === 6);
    assert.ok(idempStep);
    assert.equal(idempStep.status, 'SUCCESS', 'Idempotência verificada via persistência');
  });

  // ── 10. Regras Financeiras Preservadas ─────────────────────────────────────
  await t.test('10. Regra Financeira: Remuneração Lumora por empresa, gratuidade e sem bitributação de parcela', async () => {
    // 1. Empresa Alpha (Taxa configurada em 3.5%)
    const reportAlpha = await runAsaasSandboxHarness({
      companyId: companyAlphaId,
      forceSimulation: true,
      webhookToken: 'token_test_alpha',
      incomingTestWebhookToken: 'token_test_alpha',
    });
    const step7Alpha = reportAlpha.steps.find((s) => s.step === 7);
    assert.ok(step7Alpha && step7Alpha.data);
    assert.equal(step7Alpha.data.activePlatformRate, 3.5, 'Deve resolver a taxa vigente de 3.5% da empresa Alpha');
    assert.equal(step7Alpha.data.lumoraFeeOnSaleCents, 350, 'Taxa Lumora de 3.5% sobre R$ 100,00 deve ser R$ 3,50 (350 cents)');
    assert.equal(
      step7Alpha.data.lumoraFeeOnInstallmentCents,
      0,
      'Parcela de venda já faturada NUNCA sofre nova incidência de taxa Lumora (sem bitributação)'
    );

    // 2. Empresa Beta (Taxa configurada em 0.0% / Gratuidade explícita)
    const reportBeta = await runAsaasSandboxHarness({
      companyId: companyBetaId,
      forceSimulation: true,
      webhookToken: 'token_test_beta',
      incomingTestWebhookToken: 'token_test_beta',
    });
    const step7Beta = reportBeta.steps.find((s) => s.step === 7);
    assert.ok(step7Beta && step7Beta.data);
    assert.equal(step7Beta.data.activePlatformRate, 0.0, 'Deve resolver taxa 0.0% da empresa Beta');
    assert.equal(step7Beta.data.lumoraFeeOnSaleCents, 0, 'Taxa zero explícita significa gratuidade (R$ 0,00)');

    // 3. Empresa Gamma (Sem taxa configurada: não inventa 2.5%!)
    const reportGamma = await runAsaasSandboxHarness({
      companyId: companyGammaId,
      forceSimulation: true,
      webhookToken: 'token_test_gamma',
      incomingTestWebhookToken: 'token_test_gamma',
    });
    const step7Gamma = reportGamma.steps.find((s) => s.step === 7);
    assert.ok(step7Gamma && step7Gamma.data);
    assert.equal(step7Gamma.data.activePlatformRate, null, 'Taxa ausente não pode inventar padrão');
    assert.equal(step7Gamma.data.lumoraFeeOnSaleCents, null, 'Remuneração deve permanecer pendente de contratação');

    // 4. Comissões do vendedor preservadas
    assert.equal(step7Alpha.data.sellerCommissionCompanyCarCents, 2000, 'Entrada com carro da empresa: 20% (R$ 20,00)');
    assert.equal(step7Alpha.data.sellerCommissionOwnCarCents, 2500, 'Entrada com carro próprio: 25% (R$ 25,00)');
    assert.equal(step7Alpha.data.sellerCommissionInstallmentCents, 500, 'Parcela: 10% sobre principal recebido de R$ 50 (R$ 5,00)');
  });

  // ── 11. Adaptadores: Mock Controlado e Grok ──────────────────────────────
  await t.test('11. Adaptadores: Mocks controlados exclusivamente por opções e Grok isolado', async () => {
    // Chave curta/inválida falha
    const resShort = await testGeminiConnection('curta');
    assert.equal(resShort.success, false);

    const resShortAsaas = await testAsaasSandboxConnection('curta');
    assert.equal(resShortAsaas.success, false);

    // Mocks via opção explícita em teste
    const resMockGemini = await testGeminiConnection('AIzaSy_qualquer_coisa_longa_123456', { mockResponse: true });
    assert.equal(resMockGemini.success, true);
    assert.equal(resMockGemini.details.simulated, true);

    const resMockAsaas = await testAsaasSandboxConnection('$aact_qualquer_coisa_longa_123456', { mockResponse: true });
    assert.equal(resMockAsaas.success, true);
    assert.equal(resMockAsaas.details.simulated, true);

    // Teste Grok isolado
    const resGrok = await testGrokConnection('xai_mock_grok_key_1234567890', { mockResponse: true });
    assert.equal(resGrok.success, true);
    assert.equal(resGrok.details.provider, 'GROK');

    // ViaCEP real não destrutivo
    const resViaCep = await testViaCepConnection();
    assert.equal(resViaCep.success, true);
    assert.ok(resViaCep.details.cep);
  });
});
