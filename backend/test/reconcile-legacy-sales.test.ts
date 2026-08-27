import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import {
  runReconciliationAnalysis,
  validateLocalDatabaseUrl,
  parseAndValidateDatabaseUrl,
} from '../scripts/reconcile-legacy-sales';

const testEnvPath = path.resolve(__dirname, '../.env.test.local');
const testEnvConfig = dotenv.parse(fs.readFileSync(testEnvPath));
process.env.DATABASE_URL = testEnvConfig.DATABASE_URL;

describe('SCRIPT DE AUDITORIA DE VENDAS LEGADAS (HOTFIX 1.0.8)', () => {
  it('1. Validador de DATABASE_URL aceita 127.0.0.1/localhost e recusa hosts remotos e nomes arbitrários', () => {
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
      'Deve bloquear expressamente bancos de produção'
    );

    // Recusa substrings arbitrárias contendo "test" ou "staging" misturado com "prod"
    assert.throws(
      () =>
        validateLocalDatabaseUrl('postgresql://user:pass@127.0.0.1:5432/my_test_production'),
      /Banco recusado/,
      'Deve bloquear bancos contendo referências a produção mesmo com test no nome'
    );

    assert.throws(
      () =>
        validateLocalDatabaseUrl('postgresql://user:pass@127.0.0.1:5432/selectphoto_dev'),
      /Banco recusado/,
      'Deve bloquear bancos arbitrários não homologados'
    );
  });

  it('2. Validação não expõe senhas ou credenciais em texto claro nos erros', () => {
    const sensitiveUrl = 'postgresql://admin_user:SuperSecretPassword123@invalid-host-format:port';
    try {
      parseAndValidateDatabaseUrl(sensitiveUrl);
      assert.fail('Deveria ter lançado erro');
    } catch (err: any) {
      assert.ok(
        !err.message.includes('SuperSecretPassword123'),
        'Mensagem de erro não pode conter a senha em texto claro'
      );
    }

    try {
      validateLocalDatabaseUrl('');
      assert.fail('Deveria ter lançado erro');
    } catch (err: any) {
      assert.ok(err.message.includes('DATABASE_URL não configurada'));
    }
  });

  it('3. runReconciliationAnalysis sem cliente injetado valida DATABASE_URL antes de conectar', async () => {
    const originalUrl = process.env.DATABASE_URL;

    try {
      // 1. Sem DATABASE_URL definida
      delete process.env.DATABASE_URL;
      await assert.rejects(
        () => runReconciliationAnalysis(),
        /DATABASE_URL não configurada no ambiente/,
        'Deve abortar antes de conectar quando DATABASE_URL estiver ausente'
      );

      // 2. Com host remoto
      process.env.DATABASE_URL = 'postgresql://user:pass@remote.render.com:5432/selectphoto_test';
      await assert.rejects(
        () => runReconciliationAnalysis(),
        /Host remoto recusado/,
        'Deve abortar antes de conectar quando o host for remoto'
      );

      // 3. Com banco de produção em host local
      process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:5432/selectphoto_live';
      await assert.rejects(
        () => runReconciliationAnalysis(),
        /Banco recusado/,
        'Deve abortar antes de conectar quando o banco for de produção'
      );
    } finally {
      process.env.DATABASE_URL = originalUrl;
    }
  });

  it('4. runReconciliationAnalysis com cliente Prisma injetado preserva a conexão externa', async () => {
    const injectedPrisma = new PrismaClient();
    try {
      const report = await runReconciliationAnalysis({ prismaClient: injectedPrisma });
      assert.equal(report.isReadOnly, true);

      // Verifica se a conexão injetada continua aberta e operacional (não foi fechada indevidamente)
      const count = await injectedPrisma.sale.count();
      assert.ok(typeof count === 'number');
    } finally {
      await injectedPrisma.$disconnect();
    }
  });

  it('5. runReconciliationAnalysis mascara cityClosedAt e não expõe timestamps no relatório', async () => {
    const report = await runReconciliationAnalysis();
    assert.equal(report.isReadOnly, true);

    for (const d of report.details) {
      // hasCityClosed deve ser booleano
      assert.equal(typeof d.hasCityClosed, 'boolean');

      // cityClosedAt deve ser estritamente 'FECHADA' ou null, NUNCA timestamp ISO
      if (d.cityClosedAt !== null) {
        assert.equal(d.cityClosedAt, 'FECHADA', 'cityClosedAt não pode conter timestamp');
        assert.ok(!d.cityClosedAt.includes('T'), 'Não pode conter formato ISO de data');
        assert.ok(!d.cityClosedAt.includes(':'), 'Não pode conter horas/minutos');
      }

      // Mascaramento LGPD
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

  it('6. Execução CLI injeta exclusivamente .env.test.local e finaliza com exit code 0', () => {
    const localDbInfo = validateLocalDatabaseUrl(testEnvConfig.DATABASE_URL);
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
