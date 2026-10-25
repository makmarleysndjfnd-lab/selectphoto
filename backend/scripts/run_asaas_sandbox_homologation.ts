import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { runAsaasSandboxHarness } from '../src/services/asaasSandboxHarness';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  LUMORA — ROTEIRO EXECUTÁVEL DE HOMOLOGAÇÃO NO ASAAS SANDBOX     ');
  console.log('  Ambiente: Isolado | Produção Financeira: DISABLED               ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  try {
    // Busca a primeira empresa cadastrada no banco para o teste
    const company = await prisma.company.findFirst({
      select: { id: true, name: true },
    });

    if (!company) {
      console.error('❌ Nenhuma empresa encontrada no banco para vincular a homologação.');
      process.exit(1);
    }

    console.log(`Empresa Selecionada para Homologação: ${company.name} (${company.id})`);

    const report = await runAsaasSandboxHarness({
      companyId: company.id,
      sandboxApiKey: process.env.ASAAS_SANDBOX_API_KEY,
      webhookToken: process.env.ASAAS_SANDBOX_WEBHOOK_TOKEN,
    });

    console.log(`\nStatus Geral: [${report.overallStatus}]`);
    console.log(`Trava de Segurança (Produção LIVE DISABLED): ${report.productionSafetyLocked ? 'ATIVADA (Seguro)' : 'INSEGURA'}`);
    console.log(`Ambiente Operado: ${report.environment}\n`);

    console.log('Etapas Executadas:');
    for (const step of report.steps) {
      const icon = step.status === 'SUCCESS' ? '✅' : step.status === 'BLOCKED' ? '⚠️' : '❌';
      console.log(`  ${icon} Etapa ${step.step}: ${step.name} (${step.durationMs}ms)`);
      console.log(`     └─ ${step.details}`);
    }

    console.log('\nProntidão para LIVE:');
    console.log(`  - Homologação Sandbox Concluída: ${report.readinessForLive.sandboxHomologated ? 'SIM' : 'NÃO'}`);
    console.log(`  - Isolamento Multi-Tenant Verificado: ${report.readinessForLive.multiTenantIsolationVerified ? 'SIM' : 'NÃO'}`);
    console.log(`  - Idempotência Verificada: ${report.readinessForLive.idempotencyVerified ? 'SIM' : 'NÃO'}`);
    console.log(`  - Casos Adversos Cobertos: ${report.readinessForLive.adverseCasesVerified ? 'SIM' : 'NÃO'}`);
    console.log(`  - Modo Produção: ${report.readinessForLive.liveModeStatus}`);

    if (report.readinessForLive.pendingOwnerActions.length > 0) {
      console.log('\nAções Pendentes do Proprietário nos Portais Externos:');
      for (const action of report.readinessForLive.pendingOwnerActions) {
        console.log(`  • ${action}`);
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════════════\n');
  } catch (err) {
    console.error('❌ Falha na execução da homologação:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
