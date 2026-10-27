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
    const args = process.argv.slice(2);
    let targetCompanyArg: string | null = null;
    let forceSimulation = false;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--company' || args[i] === '--company-id' || args[i] === '-c') {
        targetCompanyArg = args[i + 1] || null;
        i++;
      } else if (args[i] === '--simulation' || args[i] === '--simulated') {
        forceSimulation = true;
      }
    }

    if (!targetCompanyArg) {
      console.error('❌ ERRO DE PARÂMETRO: Empresa de teste obrigatória não informada.');
      console.error('   O executor de homologação exige empresa de teste explícita para evitar seleção acidental.');
      console.error('\n   Uso correto:');
      console.error('     npx ts-node scripts/run_asaas_sandbox_homologation.ts --company <ID_DA_EMPRESA> [--simulation]\n');

      const available = await prisma.company.findMany({
        take: 10,
        select: { id: true, name: true, status: true },
      });

      if (available.length > 0) {
        console.error('   Empresas cadastradas disponíveis para teste:');
        for (const c of available) {
          console.error(`     - [${c.id}] ${c.name} (${c.situation})`);
        }
      }
      process.exit(1);
    }

    // Busca a empresa explicitamente especificada
    const company = await prisma.company.findFirst({
      where: {
        OR: [
          { id: targetCompanyArg },
          { name: { equals: targetCompanyArg, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, status: true },
    });

    if (!company) {
      console.error(`❌ Empresa '${targetCompanyArg}' não encontrada no banco de dados.`);
      process.exit(1);
    }

    console.log(`Empresa de Homologação Selecionada: ${company.name} (${company.id})`);
    console.log(`Modo de Execução Solicitado: ${forceSimulation ? 'SIMULAÇÃO LOCAL CONTROLADA' : 'HOMOLOGAÇÃO OFICIAL EXTERNA NO SANDBOX'}\n`);

    const report = await runAsaasSandboxHarness({
      companyId: company.id,
      sandboxApiKey: process.env.ASAAS_SANDBOX_API_KEY,
      webhookToken: process.env.ASAAS_SANDBOX_WEBHOOK_TOKEN,
      forceSimulation,
    });

    console.log(`\nStatus Geral: [${report.overallStatus}]`);
    console.log(`Ambiente da Execução: [${report.environment}]`);
    console.log(`Trava de Segurança (Produção LIVE DISABLED): ${report.productionSafetyLocked ? 'ATIVADA (Seguro)' : 'INSEGURA'}\n`);

    console.log('Etapas Executadas:');
    for (const step of report.steps) {
      const icon = step.status === 'SUCCESS' ? '✅' : step.status === 'BLOCKED' ? '⚠️' : '❌';
      console.log(`  ${icon} Etapa ${step.step}: ${step.name} (${step.durationMs}ms)`);
      console.log(`     └─ ${step.details}`);
    }

    console.log('\nProntidão Operacional:');
    console.log(`  - Homologação Oficial Concluída no Provedor: ${report.readinessForLive.sandboxHomologated ? 'SIM' : 'NÃO (Simulado/Bloqueado/Pendente)'}`);
    console.log(`  - Isolamento Multi-Tenant Verificado: ${report.readinessForLive.multiTenantIsolationVerified ? 'SIM' : 'NÃO'}`);
    console.log(`  - Idempotência Verificada via Persistência: ${report.readinessForLive.idempotencyVerified ? 'SIM' : 'NÃO'}`);
    console.log(`  - Casos Adversos Cobertos: ${report.readinessForLive.adverseCasesVerified ? 'SIM' : 'NÃO'}`);
    console.log(`  - Modo Produção Asaas: ${report.readinessForLive.liveModeStatus}`);

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
