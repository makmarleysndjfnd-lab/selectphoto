import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import {
  runAsaasSandboxHarness,
  inspectDatabaseTargetSafety,
  checkHomologationTargetSafety,
} from '../src/services/asaasSandboxHarness';

// Carrega exclusivamente arquivo de ambiente de homologação/teste local (NUNCA ../.env operacional por padrão)
const explicitEnvPath = process.env.HOMOLOGATION_ENV_FILE
  ? path.resolve(process.cwd(), process.env.HOMOLOGATION_ENV_FILE)
  : path.resolve(__dirname, '../.env.test.local');

if (fs.existsSync(explicitEnvPath)) {
  dotenv.config({ path: explicitEnvPath, override: false });
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  LUMORA — ROTEIRO EXECUTÁVEL DE HOMOLOGAÇÃO NO ASAAS SANDBOX     ');
  console.log('  Guarda de Banco Operacional: ATIVA | Asaas LIVE: DISABLED        ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // 1. Guarda de ambiente/banco ANTES de conectar o PrismaClient ou executar qualquer leitura/escrita
  const preFlightDbCheck = inspectDatabaseTargetSafety();
  if (!preFlightDbCheck.safe) {
    console.error('❌ BLOQUEIO DE SEGURANÇA (BLOCKED_PRODUCTION_GUARD):');
    console.error(`   ${preFlightDbCheck.reason}`);
    console.error('   Configure DATABASE_URL apontando para um banco local/descartável de homologação (.env.test.local).\n');
    process.exit(2);
  }

  const prisma = new PrismaClient();

  try {
    const args = process.argv.slice(2);
    let targetCompanyArg: string | null = null;
    let forceSimulation = false;
    let explicitApiKey: string | undefined;
    let explicitWebhookToken: string | undefined;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--company' || args[i] === '--company-id' || args[i] === '-c') {
        targetCompanyArg = args[i + 1] || null;
        i++;
      } else if (args[i] === '--simulation' || args[i] === '--simulated') {
        forceSimulation = true;
      } else if (args[i] === '--api-key') {
        explicitApiKey = args[i + 1] || undefined;
        i++;
      } else if (args[i] === '--webhook-token') {
        explicitWebhookToken = args[i + 1] || undefined;
        i++;
      }
    }

    if (!targetCompanyArg) {
      console.error('❌ ERRO DE PARÂMETRO: Empresa de teste obrigatória não informada.');
      console.error('   Uso: npx tsx scripts/run_asaas_sandbox_homologation.ts --company <ID_DA_EMPRESA_TESTE> [--simulation]\n');

      const available = await prisma.company.findMany({
        take: 10,
        select: { id: true, name: true, status: true },
      });

      if (available.length > 0) {
        console.error('   Empresas presentes no banco de homologação:');
        for (const c of available) {
          console.error(`     - [${c.id}] ${c.name} (${c.status})`);
        }
      }
      process.exit(1);
    }

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
      console.error(`❌ Empresa '${targetCompanyArg}' não encontrada no banco de homologação.`);
      process.exit(1);
    }

    const companyGuard = await checkHomologationTargetSafety(company.id);
    if (!companyGuard.safe) {
      console.error(`❌ BLOQUEIO DE ESCOPO (${companyGuard.code}): ${companyGuard.reason}`);
      process.exit(2);
    }

    console.log(`Empresa de Homologação: ${company.name} (${company.id})`);
    console.log(`Modo Solicitado: ${forceSimulation ? 'SIMULAÇÃO LOCAL IDENTIFICADA' : 'HOMOLOGAÇÃO OFICIAL SANDBOX'}\n`);

    // Zero fallbacks para variáveis globais (ASAAS_SANDBOX_API_KEY / ASAAS_SANDBOX_WEBHOOK_TOKEN):
    // usa exclusivamente a credencial vinculada à empresa na Central (ou argumento CLI explícito de sessão).
    const report = await runAsaasSandboxHarness({
      companyId: company.id,
      sandboxApiKey: explicitApiKey,
      webhookToken: explicitWebhookToken,
      forceSimulation,
    });

    console.log(`\nStatus Geral: [${report.overallStatus}]`);
    console.log(`Ambiente da Execução: [${report.environment}]`);
    console.log(`Guarda Produção LIVE: ${report.productionSafetyLocked ? 'BLOQUEADA (Seguro)' : 'HABILITADA'}\n`);

    console.log('Etapas Executadas:');
    for (const step of report.steps) {
      const icon =
        step.status === 'SUCCESS'
          ? '✅'
          : step.status === 'PENDING'
            ? '⏳'
            : step.status === 'BLOCKED'
              ? '⚠️'
              : '❌';
      console.log(`  ${icon} Etapa ${step.step}: ${step.name} [${step.status}] (${step.durationMs}ms)`);
      console.log(`     └─ ${step.details}`);
    }

    console.log('\nProntidão Operacional:');
    console.log(`  - Homologação Oficial Concluída no Provedor: ${report.readinessForLive.sandboxHomologated ? 'SIM' : 'NÃO'}`);
    console.log(`  - Isolamento Multi-Tenant Verificado: ${report.readinessForLive.multiTenantIsolationVerified ? 'SIM' : 'NÃO'}`);
    console.log(`  - Idempotência/Concorrência/Reinício Verificados: ${report.readinessForLive.idempotencyVerified ? 'SIM' : 'NÃO'}`);
    console.log(`  - Casos Adversos Verificados na Rota Operacional: ${report.readinessForLive.adverseCasesVerified ? 'SIM' : 'NÃO'}`);
    console.log(`  - Modo Produção Asaas: ${report.readinessForLive.liveModeStatus}`);

    if (report.readinessForLive.pendingOwnerActions.length > 0) {
      console.log('\nAções Pendentes:');
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
