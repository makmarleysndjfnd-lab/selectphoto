import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'child_process';
import path from 'path';
import { runReconciliationAnalysis } from '../scripts/reconcile-legacy-sales';

describe('SCRIPT DE AUDITORIA DE VENDAS LEGADAS (HOTFIX 1.0.8)', () => {
  it('1. runReconciliationAnalysis executa em modo estritamente somente leitura com cenários condicionais', async () => {
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
      assert.ok(d.maskedSequenceNumber.includes('***') || d.maskedSequenceNumber === 'N/D' || d.maskedSequenceNumber === '***');
      assert.ok(d.clientMaskedId.includes('***') || d.clientMaskedId === '***');
      assert.ok(d.clientMaskedName.includes('***') || d.clientMaskedName === 'Nome Oculto');
      assert.ok(d.maskedCity.includes('***') || d.maskedCity === '***');
    }
  });

  it('2. Execução CLI real via npx tsx scripts/reconcile-legacy-sales.ts finaliza com exit code 0', () => {
    const scriptPath = path.resolve(__dirname, '../scripts/reconcile-legacy-sales.ts');
    const output = execSync(`npx tsx "${scriptPath}"`, {
      encoding: 'utf-8',
      cwd: path.resolve(__dirname, '..'),
    });

    assert.ok(output.includes('MODO SOMENTE LEITURA'), 'Deve informar modo somente leitura');
    assert.ok(output.includes('CENÁRIOS POSSÍVEIS DE RECONCILIAÇÃO'), 'Deve apresentar cenários');
    assert.ok(output.includes('Auditoria somente leitura concluída'), 'Deve confirmar conclusão segura');
    assert.ok(!output.includes('MODO GRAVAÇÃO'), 'Não pode conter menção a modo gravação');
    assert.ok(!output.includes('--apply-live-changes'), 'Não pode aceitar flag de escrita');
  });
});
