import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIRMED_TEST_COMPANY_IDS,
  PROJECT_COMPANY_ID,
  isConfirmedTestCompany,
  COMPANY_CLASSIFICATION,
} from '../src/constants/companyClassification';

test('1. Classificação Canônica — Catálogo de 51 Fixtures de Teste vs Empresa do Projeto', () => {
  assert.equal(CONFIRMED_TEST_COMPANY_IDS.length, 51, 'Devem existir exatamente 51 empresas de teste catalogadas');
  assert.equal(PROJECT_COMPANY_ID, '91f736ae-93af-4f7a-b5d5-87c98e53cdf6', 'Empresa do projeto deve ser Select Photo Default');

  // Testar pertença
  assert.equal(isConfirmedTestCompany(PROJECT_COMPANY_ID), false, 'Empresa do projeto não pode ser classificada como teste');
  assert.equal(isConfirmedTestCompany('comp_a_et2_1792666952082'), true, 'Fixture de teste de etapa2 deve ser reconhecida');
  assert.equal(isConfirmedTestCompany('comp-batch-5454d072-1d57-4529-a262-4db7578bdca2'), true, 'Batch fixture deve ser reconhecida');
  assert.equal(isConfirmedTestCompany(null), false, 'Nulo deve retornar false');
  assert.equal(isConfirmedTestCompany(undefined), false, 'Indefinido deve retornar false');
});

test('2. Contrato de Resposta do Step-Up Auth — Fornece stepUpToken e token para retrocompatibilidade', () => {
  // Simular payload canônico retornado pela rota
  const rawToken = 'step_up_token_test_abc123';
  const responsePayload = {
    success: true,
    stepUpToken: rawToken,
    token: rawToken,
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    expiresInSeconds: 600,
    message: 'Reautenticação reforçada confirmada com validade de 10 minutos.',
  };

  assert.equal(responsePayload.stepUpToken, rawToken);
  assert.equal(responsePayload.token, rawToken);

  // Simular consumo seguro do cliente mobile: resp['stepUpToken'] ?? resp['token']
  const tokenConsumidoMobile = responsePayload.stepUpToken ?? responsePayload.token;
  assert.equal(tokenConsumidoMobile, rawToken);
});

test('3. Mapeamento de Empresas e Trilha de Auditoria com Identificação de Teste', () => {
  const mockEmpresaOperacional = {
    id: PROJECT_COMPANY_ID,
    name: 'Select Photo Default',
    classification: COMPANY_CLASSIFICATION.OPERATIONAL,
  };

  const mockEmpresaTeste = {
    id: 'comp_a_et2_1792666952082',
    name: 'Empresa A Etapa 2',
    classification: COMPANY_CLASSIFICATION.TEST_DEMO,
  };

  const mapear = (c: any) => ({
    id: c.id,
    name: c.name,
    classification: c.classification || 'OPERATIONAL',
    isTestExample: c.classification === 'TEST_DEMO' || isConfirmedTestCompany(c.id),
  });

  const resOp = mapear(mockEmpresaOperacional);
  assert.equal(resOp.classification, 'OPERATIONAL');
  assert.equal(resOp.isTestExample, false);

  const resTeste = mapear(mockEmpresaTeste);
  assert.equal(resTeste.classification, 'TEST_DEMO');
  assert.equal(resTeste.isTestExample, true);
});

