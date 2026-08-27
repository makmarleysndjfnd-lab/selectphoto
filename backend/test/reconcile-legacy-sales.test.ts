import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import {
  runReconciliationAnalysis,
  validateLocalDatabaseUrl,
} from '../scripts/reconcile-legacy-sales';

const testEnvPath = path.resolve(__dirname, '../.env.test.local');
const testEnvConfig = dotenv.parse(fs.readFileSync(testEnvPath));
process.env.DATABASE_URL = testEnvConfig.DATABASE_URL;

describe('SCRIPT DE AUDITORIA DE VENDAS LEGADAS (HOTFIX 1.0.8)', () => {
  it('1. Validador de DATABASE_URL aceita 127.0.0.1/localhost e recusa hosts remotos', () => {
    // Host local válido
    const validInfo = validateLocalDatabaseUrl(
      'postgresql://user:pass@127.0.0.1:5432/selectphoto_staging_local'
    );
    assert.equal(validInfo.host, '127.0.0.1');
    assert.equal(validInfo.database, 'selectphoto_staging_local');

    // Recusa host remoto (ex: Render, AWS, Neon, Supabase)
    assert.throws(
      () =>
        validateLocalDatabaseUrl(
          'postgresql://user:pass@selectphoto-db.onrender.com:5432/selectphoto_prod'
        ),
      /Host remoto recusado/,
      'Deve bloquear expressamente conexões para hosts remotos'
    );

    // Recusa banco de produção
    assert.throws(
      () =>
        validateLocalDatabaseUrl('postgresql://user:pass@127.0.0.1:5432/selectphoto_production'),
      /Banco recusado/,
      'Deve bloquear expressamente bancos que não sejam staging ou teste'
    );
  });

  it('2. runReconciliationAnalysis executa em modo estritamente somente leitura com mascaramento LGPD completo', async () => {
    const report = await runReconciliationAnalysis();
    assert.equal(report.isReadOnly, true, 'Deve ser estritamente somente leitura');
    assert.ok(report.timestamp);
    assert.ok(typeof report.totalSalesCount === 'number');
    assert.ok(typeof report.salesWithReceiptCount === 'number');
    assert.ok(typeof report.salesWithoutReceiptCount === 'number');
    assert.ok(report.scenarios.scenarioA_regularization);
    assert.ok(report.scenarios.scenarioB_cancellation);
    assert.ok(report.scenarios.scenarioC_maintenance);

    for (const d of report.details) {
      assert.ok(
        d.maskedSequenceNumber.includes('***') ||
          d.maskedSequenceNumber === 'N/D' ||
          d.maskedSequenceNumber === '***'
      );
      assert.ok(d.clientMaskedId.includes('***') || d.clientMaskedId === '***');
      assert.ok(d.clientMaskedName.includes('***') || d.clientMaskedName === 'Nome Oculto');
      assert.ok(d.maskedCity.includes('***') || d.maskedCity === '***');

      for (const s of d.sales) {
        assert.equal(s.maskedValue, 'R$***', 'Valores financeiros devem ser mascarados');
        assert.ok(s.maskedDate.includes('**'), 'Datas exatas devem ser mascaradas');
      }
    }
  });

  it('3. Execução CLI injeta exclusivamente .env.test.local e finaliza com exit code 0', () => {
    const localDbInfo = validateLocalDatabaseUrl(testEnvConfig.DATABASE_URL);
    // Demonstração explícita de conexão segura: exibe apenas host e nome do banco, NUNCA senha
    console.log(
      `[TESTE CLI] Injetando banco local com segurança: Host=${localDbInfo.host}:${localDbInfo.port}, Banco=${localDbInfo.database}`
    );

    const scriptPath = path.resolve(__dirname, '../scripts/reconcile-legacy-sales.ts');
    const output = execSync(`npx tsx "${scriptPath}"`, {
      encoding: 'utf-8',
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        DATABASE_URL: testEnvConfig.DATABASE_URL,
      },
    });

    assert.ok(output.includes('Conectando com segurança em: Host=127.0.0.1:5432, Banco=selectphoto_staging_local'));
    assert.ok(output.includes('MODO SOMENTE LEITURA'), 'Deve informar modo somente leitura');
    assert.ok(output.includes('CENÁRIOS POSSÍVEIS DE RECONCILIAÇÃO'), 'Deve apresentar cenários');
    assert.ok(output.includes('Auditoria somente leitura concluída'), 'Deve confirmar conclusão segura');
    assert.ok(!output.includes('MODO GRAVAÇÃO'), 'Não pode conter menção a modo gravação');
    assert.ok(!output.includes('--apply-live-changes'), 'Não pode aceitar flag de escrita');
  });
});
