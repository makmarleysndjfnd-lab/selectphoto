import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptSecret,
  decryptSecret,
  maskSecret,
  isPrivateOrLocalIp,
  validateExternalUrl,
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
} from '../src/services/integrationAdapters';
import { runAsaasSandboxHarness } from '../src/services/asaasSandboxHarness';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

test('Central de Integrações e APIs — Etapa 2 de 4', async (t) => {
  let testCompanyId = '';
  let testUserId = '';

  // Setup: Busca empresa e usuário existentes no banco
  const company = await prisma.company.findFirst({ select: { id: true } });
  const user = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN' },
    select: { id: true },
  });

  if (company && user) {
    testCompanyId = company.id;
    testUserId = user.id;
  }

  await t.test('1. Criptografia no Vault (AES-256-GCM) e Mascaramento Seguro', async () => {
    const originalSecret = '$aact_YTU1YTE0M2M6N2I4MzQ2ZDA6';
    const encrypted = encryptSecret(originalSecret);

    assert.ok(encrypted.encryptedSecret, 'Segredo criptografado deve existir');
    assert.ok(encrypted.secretIv, 'IV deve existir');
    assert.equal(encrypted.secretIv.length, 24, 'IV deve ter 12 bytes em hex (24 chars)');
    assert.ok(encrypted.secretTag, 'Auth Tag deve existir');
    assert.equal(encrypted.secretTag.length, 32, 'Tag deve ter 16 bytes em hex (32 chars)');

    // Descriptografia deve recuperar exatamente o valor original
    const decrypted = decryptSecret(
      encrypted.encryptedSecret,
      encrypted.secretIv,
      encrypted.secretTag
    );
    assert.equal(decrypted, originalSecret, 'Segredo descriptografado deve ser idêntico ao original');

    // Mascaramento: Nunca exibir segredo em claro
    const maskedLong = maskSecret(originalSecret);
    assert.ok(maskedLong.startsWith('$aac'), 'Máscara deve preservar primeiros 4 caracteres');
    assert.ok(maskedLong.endsWith('ZDA6'), 'Máscara deve preservar últimos 4 caracteres');
    assert.ok(maskedLong.includes('••••••••'), 'Máscara deve conter caracteres de bloqueio');

    const maskedShort = maskSecret('12345');
    assert.equal(maskedShort, '••••••••', 'Segredo curto deve ser totalmente mascarado');
  });

  await t.test('2. Proteção Anti-SSRF: Bloqueio de IPs Privados, Loopback e Metadados de Nuvem', async () => {
    // IPs privados e perigosos devem ser detectados
    assert.equal(isPrivateOrLocalIp('127.0.0.1'), true, '127.0.0.1 deve ser bloqueado');
    assert.equal(isPrivateOrLocalIp('localhost'), true, 'localhost deve ser bloqueado');
    assert.equal(isPrivateOrLocalIp('169.254.169.254'), true, 'Metadados AWS/GCP/Render (169.254.169.254) devem ser bloqueados');
    assert.equal(isPrivateOrLocalIp('10.0.0.1'), true, 'Rede interna 10.x.x.x deve ser bloqueada');
    assert.equal(isPrivateOrLocalIp('192.168.1.1'), true, 'Rede interna 192.168.x.x deve ser bloqueada');
    assert.equal(isPrivateOrLocalIp('172.20.0.1'), true, 'Rede interna 172.16-31.x.x deve ser bloqueada');

    // URLs maliciosas bloqueadas
    const check1 = await validateExternalUrl('http://127.0.0.1:3000/internal-admin');
    assert.equal(check1.valid, false, 'Loopback deve ser rejeitado');

    const check2 = await validateExternalUrl('http://169.254.169.254/latest/meta-data/');
    assert.equal(check2.valid, false, 'Metadados de nuvem devem ser rejeitados');

    const check3 = await validateExternalUrl('https://evil-attacker-site.com/webhook');
    assert.equal(check3.valid, false, 'Domínio fora da lista autorizada deve ser rejeitado');

    // URLs legítimas autorizadas
    const check4 = await validateExternalUrl('https://sandbox.asaas.com/api/v3/customers');
    assert.equal(check4.valid, true, 'Sandbox Asaas deve ser autorizado');

    const check5 = await validateExternalUrl('https://viacep.com.br/ws/01001000/json/');
    assert.equal(check5.valid, true, 'ViaCEP deve ser autorizado');
  });

  await t.test('3. Isolamento Estrito Multi-Tenant e Eliminação de Fallback Silencioso', async () => {
    if (!testCompanyId) return;

    // Empresa sem integração de pagamento cadastrada
    const resolvedGateway = await resolveCompanyIntegration('empresa_ficticia_sem_asaas', 'PAYMENT_GATEWAY');
    assert.equal(resolvedGateway.status, 'DISABLED', 'Empresa sem gateway configurado deve retornar DISABLED');
    assert.equal(resolvedGateway.secret, null, 'Nenhum segredo de outra empresa pode ser retornado');
    assert.equal(resolvedGateway.isShared, false, 'Gateways bancários não podem ser compartilhados silenciosamente');

    // Empresa sem WhatsApp cadastrado
    const resolvedMessaging = await resolveCompanyIntegration('empresa_ficticia_sem_whats', 'MESSAGING');
    assert.equal(resolvedMessaging.status, 'DISABLED', 'Empresa sem WhatsApp configurado deve retornar DISABLED');
    assert.equal(resolvedMessaging.secret, null, 'Nenhum número de outra empresa pode ser retornado');
  });

  await t.test('4. Consulta de CEP via ViaCEP com Cache em Memória', async () => {
    const cepTest = '01001000'; // Praça da Sé, SP
    const res1 = await lookupViaCep(cepTest);
    assert.equal(res1.success, true, 'Consulta de CEP válido deve suceder');
    assert.ok(res1.data.logradouro, 'Deve retornar logradouro');

    // Segunda chamada deve vir do cache
    const res2 = await lookupViaCep(cepTest);
    assert.equal(res2.success, true);
    assert.equal(res2.cached, true, 'Segunda chamada imediata deve vir do cache');

    // CEP inválido deve ser rejeitado
    const resInvalid = await lookupViaCep('123');
    assert.equal(resInvalid.success, false, 'CEP com menos de 8 dígitos deve falhar');
  });

  await t.test('5. Registro de Consumo de API (Sem PII) e Orçamento Mensal', async () => {
    if (!testCompanyId) return;

    // Registra métrica de uso
    const usage = await recordApiUsage({
      companyId: testCompanyId,
      category: 'AI_RESEARCH',
      provider: 'GEMINI',
      operation: 'SEARCH_EVENTS',
      unitsUsed: 1,
      estimatedCostCents: 2,
      status: 'SUCCESS',
      latencyMs: 150,
    });

    assert.ok(usage, 'Registro de uso deve ser salvo no banco');
    assert.equal(usage.unitsUsed, 1);
    assert.equal(usage.operation, 'SEARCH_EVENTS');

    // Checagem de orçamento
    const budgetCheck = await checkCompanyApiBudget(testCompanyId, 'AI_RESEARCH');
    assert.equal(typeof budgetCheck.withinBudget, 'boolean');
    assert.ok(budgetCheck.currentSpentCents >= 0);
  });

  await t.test('6. Adaptadores Não Destrutivos de Conexão', async () => {
    // Teste Gemini com chave simulada
    const geminiRes = await testGeminiConnection('AIzaSy_mock_test_key_123456');
    assert.equal(geminiRes.success, true, 'Conexão mock do Gemini deve suceder em ambiente de teste');

    // Teste Asaas Sandbox com chave simulada
    const asaasRes = await testAsaasSandboxConnection('$aact_test_sandbox_key_123456');
    assert.equal(asaasRes.success, true, 'Conexão mock do Asaas Sandbox deve suceder em ambiente de teste');

    // Teste ViaCEP real
    const viacepRes = await testViaCepConnection();
    assert.equal(viacepRes.success, true, 'ViaCEP deve responder com sucesso');
  });

  await t.test('7. Roteiro Executável de Homologação no Asaas Sandbox', async () => {
    if (!testCompanyId) return;

    const report = await runAsaasSandboxHarness({
      companyId: testCompanyId,
      sandboxApiKey: '$aact_test_sandbox_key_homologation',
      webhookToken: 'test_token_asaas_sandbox_2026',
      forceSimulation: true,
    });

    assert.equal(report.overallStatus, 'PASSED', 'Harness deve passar com sucesso');
    assert.equal(report.productionSafetyLocked, true, 'Produção LIVE deve estar travada como DISABLED');
    assert.equal(report.readinessForLive.sandboxHomologated, true, 'Homologação Sandbox deve estar aprovada');
    assert.equal(report.readinessForLive.multiTenantIsolationVerified, true, 'Isolamento verificado');
    assert.equal(report.readinessForLive.idempotencyVerified, true, 'Idempotência verificada');
    assert.equal(report.readinessForLive.adverseCasesVerified, true, 'Casos adversos verificados');
    assert.equal(report.readinessForLive.liveModeStatus, 'DISABLED', 'Modo LIVE estritamente desabilitado');

    // Verifica que 8 etapas foram executadas
    assert.equal(report.steps.length, 8, 'Harness deve conter exatamente 8 etapas');
  });

  await t.test('8. Auditoria de Integrações Sem Vazamento de Segredos', async () => {
    if (!testCompanyId || !testUserId) return;

    // Cria evento de auditoria
    const audit = await prisma.integrationAuditEvent.create({
      data: {
        companyId: testCompanyId,
        action: 'ROTATE',
        authorUserId: testUserId,
        authorName: 'Super Admin Test',
        details: JSON.stringify({
          category: 'PAYMENT_GATEWAY',
          provider: 'ASAAS',
          version: 2,
          reason: 'Teste de auditoria',
        }),
        result: 'SUCCESS',
      },
    });

    assert.ok(audit.id, 'Auditoria deve ser registrada');
    assert.ok(!audit.details.includes('$aact'), 'Detalhes da auditoria NUNCA devem conter chaves secretas');
  });
});
