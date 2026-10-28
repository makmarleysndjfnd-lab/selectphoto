import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { resolveCompanyIntegration } from './integrationResolver';
import {
  validateExternalUrl,
  ASAAS_SANDBOX_BASE_URL,
  decryptSecret,
  encryptSecret,
  maskSecret,
} from './vaultService';
import { isProductionSafetyLocked } from './asaasService';

const prisma = new PrismaClient();

export interface HarnessStepResult {
  step: number;
  name: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'BLOCKED' | 'PENDING';
  durationMs: number;
  details: string;
  data?: any;
}

export interface SandboxHarnessReport {
  timestamp: string;
  environment: 'SANDBOX' | 'SIMULATION_TEST';
  companyId: string;
  overallStatus:
    | 'PASSED'
    | 'FAILED'
    | 'BLOCKED_MISSING_CREDENTIALS'
    | 'BLOCKED_MISSING_WEBHOOK_TOKEN'
    | 'BLOCKED_PRODUCTION_GUARD'
    | 'PENDING_PROVIDER_WEBHOOK';
  productionSafetyLocked: boolean;
  productionSafetyDetails?: {
    locked: boolean;
    reason: string;
    globalLiveGateLocked?: boolean;
    financialLiveAuthorized: boolean;
    activeLiveIntegrationFound: boolean;
  };
  steps: HarnessStepResult[];
  readinessForLive: {
    sandboxHomologated: boolean;
    multiTenantIsolationVerified: boolean;
    idempotencyVerified: boolean;
    adverseCasesVerified: boolean;
    liveModeStatus: 'DISABLED';
    pendingOwnerActions: string[];
  };
}

export interface RunHarnessParams {
  companyId: string;
  sandboxApiKey?: string;
  webhookToken?: string;
  forceSimulation?: boolean;
  incomingTestWebhookToken?: string;
  providerWebhookWaitMs?: number;
}

/**
 * Verifica se a URL de banco de dados aponta para infraestrutura operacional/produção
 * ou carece de marcador explícito de homologação/teste/descartável.
 */
export function inspectDatabaseTargetSafety(rawDbUrl?: string, rawNodeEnv?: string): {
  safe: boolean;
  databaseTarget: 'AUTHORIZED_HOMOLOGATION_DB' | 'OPERATIONAL_PRODUCTION' | 'UNVERIFIED_DB_TARGET';
  reason?: string;
} {
  const nodeEnv = (rawNodeEnv ?? process.env.NODE_ENV ?? '').trim().toLowerCase();
  const dbUrl = (rawDbUrl ?? process.env.DATABASE_URL ?? '').trim().toLowerCase();

  if (nodeEnv === 'production') {
    return {
      safe: false,
      databaseTarget: 'OPERATIONAL_PRODUCTION',
      reason:
        'Guarda de Produção Ativa (NODE_ENV=production): Mutações de homologação ou simulação são proibidas no servidor operacional.',
    };
  }

  if (!dbUrl) {
    return {
      safe: false,
      databaseTarget: 'UNVERIFIED_DB_TARGET',
      reason: 'DATABASE_URL ausente: impossível comprovar isolamento do banco de homologação.',
    };
  }

  const forbiddenOperationalPatterns = [
    'render.com',
    'dpg-',
    'virginia-postgres',
    'oregon-postgres',
    'frankfurt-postgres',
    'singapore-postgres',
    'ohio-postgres',
    'banco_app_',
    'neon.tech',
    'supabase.co',
    'amazonaws.com',
    'railway.app',
  ];

  for (const pattern of forbiddenOperationalPatterns) {
    if (dbUrl.includes(pattern)) {
      return {
        safe: false,
        databaseTarget: 'OPERATIONAL_PRODUCTION',
        reason: `Guarda de Banco Operacional Ativa: Destino de banco contém indicador operacional ('${pattern}'). Proibido gravar fixtures de homologação no livro financeiro real.`,
      };
    }
  }

  const isLocalHost = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1');
  const hasHomologMarker =
    dbUrl.includes('staging') ||
    dbUrl.includes('test') ||
    dbUrl.includes('homolog') ||
    dbUrl.includes('sandbox') ||
    dbUrl.includes('disposable');

  if (!isLocalHost || !hasHomologMarker) {
    return {
      safe: false,
      databaseTarget: 'UNVERIFIED_DB_TARGET',
      reason:
        'Destino de banco não autorizado para homologação: exige host local/isolado (localhost/127.0.0.1) e banco explicitamente identificado como test/staging/homolog/sandbox/disposable.',
    };
  }

  return {
    safe: true,
    databaseTarget: 'AUTHORIZED_HOMOLOGATION_DB',
  };
}

/**
 * Guarda combinada de ambiente, banco de dados e escopo da empresa.
 * Executada ANTES de qualquer escrita ou chamada externa.
 * Selecionar uma empresa de teste NÃO autoriza escrita em banco operacional.
 */
export async function checkHomologationTargetSafety(companyId?: string): Promise<{
  safe: boolean;
  code?: 'BLOCKED_PRODUCTION_GUARD';
  reason?: string;
  details?: any;
}> {
  const dbSafety = inspectDatabaseTargetSafety();
  if (!dbSafety.safe) {
    return {
      safe: false,
      code: 'BLOCKED_PRODUCTION_GUARD',
      reason: dbSafety.reason,
      details: {
        nodeEnv: process.env.NODE_ENV || 'development',
        databaseTarget: dbSafety.databaseTarget,
        instructions:
          'Execute o roteiro exclusivamente em ambiente e banco isolados de homologação/teste. No aplicativo operacional, utilize apenas a consulta de situação/prontidão.',
      },
    };
  }

  if (!companyId) {
    return {
      safe: true,
      details: {
        nodeEnv: process.env.NODE_ENV || 'development',
        databaseTarget: dbSafety.databaseTarget,
      },
    };
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true, status: true },
  });

  if (!company) {
    return {
      safe: false,
      code: 'BLOCKED_PRODUCTION_GUARD',
      reason: 'Empresa selecionada não existe no banco de homologação.',
    };
  }

  const companyNameLower = (company.name || '').toLowerCase();
  const companyIdLower = company.id.toLowerCase();
  const isAuthorizedTestCompany =
    companyNameLower.includes('test') ||
    companyNameLower.includes('teste') ||
    companyNameLower.includes('sandbox') ||
    companyNameLower.includes('homolog') ||
    companyNameLower.includes('fictic') ||
    companyIdLower.startsWith('test-') ||
    companyIdLower.startsWith('homolog-') ||
    companyIdLower.startsWith('sandbox-');

  if (!isAuthorizedTestCompany) {
    return {
      safe: false,
      code: 'BLOCKED_PRODUCTION_GUARD',
      reason: `Empresa '${company.name}' não possui escopo explícito de teste/homologação. Mesmo em banco isolado, o roteiro opera apenas sobre empresas de teste.`,
      details: {
        companyId: company.id,
        companyName: company.name,
        databaseTarget: dbSafety.databaseTarget,
        instructions:
          'Utilize uma empresa dedicada de teste/homologação (ex: "Empresa Teste Sandbox") para rodar a jornada.',
      },
    };
  }

  return {
    safe: true,
    details: {
      companyId: company.id,
      companyName: company.name,
      databaseTarget: dbSafety.databaseTarget,
    },
  };
}

function extractWebhookTokenFromMetadata(configMetadata: any): string | null {
  if (!configMetadata) return null;
  if (configMetadata.encryptedWebhookToken && configMetadata.webhookIv && configMetadata.webhookTag) {
    try {
      return decryptSecret(
        configMetadata.encryptedWebhookToken,
        configMetadata.webhookIv,
        configMetadata.webhookTag
      );
    } catch {
      return null;
    }
  }
  return configMetadata.webhookToken || null;
}

/**
 * Inicia uma instância HTTP efêmera montando a rota operacional real (/api/credit/webhooks/asaas).
 * Permite exercitar transporte HTTP real, concorrência e reinício completo da instância Express.
 */
async function startEphemeralOperationalWebhookServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const expressMod = await import('express');
  const creditRouter = (await import('../routes/credit')).default;
  const app = expressMod.default();
  app.use(expressMod.default.json());
  app.use('/api/credit', creditRouter);

  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Falha ao alocar porta local para o servidor HTTP de homologação.'));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((resClose) => server.close(() => resClose())),
      });
    });
    server.on('error', reject);
  });
}

async function postWebhookToOperationalRoute(
  baseUrl: string,
  payload: any,
  tokenHeader?: string
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (tokenHeader !== undefined) {
    headers['asaas-access-token'] = tokenHeader;
  }

  const res = await fetch(`${baseUrl}/api/credit/webhooks/asaas`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function ensureScopedSellerForTestCompany(companyId: string, scopeSuffix: string) {
  const existingUser = await prisma.user.findFirst({
    where: { companyId },
  });
  if (existingUser) return existingUser;

  return prisma.user.create({
    data: {
      companyId,
      email: `homolog_seller_${scopeSuffix}@lumora.test.local`,
      password: '$2b$10$homologationScopedFixtureNonInteractiveHash000000000000',
      name: `Vendedor Fixture Homologação ${scopeSuffix}`,
      role: 'SELLER',
    },
  });
}

async function createScopedCreditLedgerFixture(params: {
  companyId: string;
  sellerId: string;
  scopeTag: string;
  installmentsCount?: number;
}) {
  const count = params.installmentsCount ?? 2;
  const client = await prisma.client.create({
    data: {
      companyId: params.companyId,
      sequenceNumber: `HOMOLOG_SEQ_${params.scopeTag}`,
      name: `HOMOLOG_FIXTURE_CLIENT_${params.scopeTag}`,
      phone1: '11999990000',
    },
  });

  const sale = await prisma.sale.create({
    data: {
      companyId: params.companyId,
      clientId: client.id,
      sellerId: params.sellerId,
      value: 50.0 * count,
      city: 'Cidade Homologação',
      product: 'Books',
      paymentMethod: 'BOLETO',
      status: 'PRONTO',
    },
  });

  const totalCents = 5000 * count;
  const agreement = await prisma.creditAgreement.create({
    data: {
      saleId: sale.id,
      clientId: client.id,
      sellerId: params.sellerId,
      companyId: params.companyId,
      buyerName: `Responsável Homologação ${params.scopeTag}`,
      buyerCpf: '04702952000',
      street: 'Rua Homologação',
      number: '100',
      neighborhood: 'Centro',
      city: 'Cidade Homologação',
      state: 'SP',
      totalSaleCents: totalCents,
      downPaymentCents: 0,
      financedPrincipalCents: totalCents,
      remainingPrincipalCents: totalCents,
      installmentsCount: count,
      firstDueDate: new Date(),
      status: 'ACTIVE',
      installmentCommissionRate: 0.1,
    },
  });

  const installments = [];
  for (let i = 1; i <= count; i++) {
    const inst = await prisma.creditInstallment.create({
      data: {
        agreementId: agreement.id,
        installmentNumber: i,
        dueDate: new Date(Date.now() + i * 86400000),
        amountCents: 5000,
        paidCents: 0,
        status: 'PENDING',
      },
    });
    installments.push(inst);
  }

  return { client, sale, agreement, installments };
}

/**
 * Executor do roteiro de homologação do Asaas Sandbox.
 * - Bloqueia qualquer mutação fora de banco/empresa de homologação.
 * - Zero fallbacks automáticos de chave ou token de webhook.
 * - Percorre a rota HTTP real (/api/credit/webhooks/asaas), amortização, comissão de 10%, replay HTTP,
 *   concorrência sob FOR UPDATE, replay após reinício de servidor, cross-company e fora de ordem.
 * - Em modo oficial (!isSimulation), NUNCA substitui falta de retorno do provedor por payload local:
 *   retorna PENDING_PROVIDER_WEBHOOK e sandboxHomologated: false enquanto aguarda o provedor.
 */
export async function runAsaasSandboxHarness(params: RunHarnessParams): Promise<SandboxHarnessReport> {
  const steps: HarnessStepResult[] = [];
  const timestamp = new Date().toISOString();
  const isSimulation = params.forceSimulation === true;
  const executionEnv: 'SANDBOX' | 'SIMULATION_TEST' = isSimulation ? 'SIMULATION_TEST' : 'SANDBOX';

  // 0. Guarda Estrita de Ambiente, Banco e Empresa (ANTES de qualquer escrita ou chamada externa)
  const step0Start = Date.now();
  const safetyCheck = await checkHomologationTargetSafety(params.companyId);
  let prodSafety = {
    locked: true,
    reason: 'Guarda global ativa: Faturamento LIVE bloqueado.',
    globalLiveGateLocked: true,
    financialLiveAuthorized: false,
    activeLiveIntegrationFound: false,
  };

  try {
    prodSafety = await isProductionSafetyLocked(params.companyId);
  } catch {
    // Mantém leitura conservadora se banco estiver indisponível/bloqueado
  }

  if (!safetyCheck.safe) {
    steps.push({
      step: 1,
      name: 'Guarda de Ambiente e Isolamento do Banco Operacional',
      status: 'BLOCKED',
      durationMs: Date.now() - step0Start,
      details: safetyCheck.reason || 'Execução bloqueada pela guarda de banco operacional.',
      data: safetyCheck.details,
    });

    return {
      timestamp,
      environment: executionEnv,
      companyId: params.companyId,
      overallStatus: 'BLOCKED_PRODUCTION_GUARD',
      productionSafetyLocked: prodSafety.locked,
      productionSafetyDetails: prodSafety,
      steps,
      readinessForLive: {
        sandboxHomologated: false,
        multiTenantIsolationVerified: true,
        idempotencyVerified: false,
        adverseCasesVerified: false,
        liveModeStatus: 'DISABLED',
        pendingOwnerActions: [
          'Executar a homologação exclusivamente em banco de homologação/teste autorizado.',
          'No aplicativo operacional, utilizar apenas a consulta somente leitura de prontidão.',
        ],
      },
    };
  }

  // 1. Resolução Estrita de Credenciais Vinculadas à Empresa (SEM FALLBACKS GLOBAIS)
  const step1Start = Date.now();
  const resolvedSandbox = await resolveCompanyIntegration(
    params.companyId,
    'PAYMENT_GATEWAY',
    'SANDBOX'
  );

  const apiKey =
    params.sandboxApiKey?.trim() ||
    (resolvedSandbox?.status === 'ACTIVE' && resolvedSandbox.secret
      ? resolvedSandbox.secret.trim()
      : undefined);

  const webhookToken =
    params.webhookToken?.trim() ||
    (resolvedSandbox?.status === 'ACTIVE'
      ? extractWebhookTokenFromMetadata(resolvedSandbox.integration?.configMetadata)?.trim()
      : undefined);

  if (!apiKey && !isSimulation) {
    steps.push({
      step: 1,
      name: 'Verificação de Credenciais Sandbox da Empresa',
      status: 'BLOCKED',
      durationMs: Date.now() - step1Start,
      details:
        'Chave de API do Asaas Sandbox ausente ou integração Sandbox desativada para esta empresa. Sem fallback automático.',
      data: {
        targetBaseUrl: ASAAS_SANDBOX_BASE_URL,
        integrationStatus: resolvedSandbox?.status || 'NOT_CONFIGURED',
        reason: 'BLOCKED_MISSING_CREDENTIALS',
      },
    });

    return {
      timestamp,
      environment: 'SANDBOX',
      companyId: params.companyId,
      overallStatus: 'BLOCKED_MISSING_CREDENTIALS',
      productionSafetyLocked: prodSafety.locked,
      productionSafetyDetails: prodSafety,
      steps,
      readinessForLive: {
        sandboxHomologated: false,
        multiTenantIsolationVerified: true,
        idempotencyVerified: false,
        adverseCasesVerified: false,
        liveModeStatus: 'DISABLED',
        pendingOwnerActions: [
          'Acessar o portal Asaas Sandbox (https://sandbox.asaas.com)',
          'Gerar API Key em Integrações > Chaves de API',
          'Cadastrar a chave e o segredo de webhook na Central de Integrações (ambiente SANDBOX) e ativar para teste',
        ],
      },
    };
  }

  if (!webhookToken) {
    steps.push({
      step: 1,
      name: 'Verificação de Token Secreto de Webhook da Empresa',
      status: 'BLOCKED',
      durationMs: Date.now() - step1Start,
      details:
        'Token secreto de webhook do Asaas Sandbox não configurado para a empresa. Nenhum token padrão/global é assumido.',
      data: {
        integrationStatus: resolvedSandbox?.status || 'NOT_CONFIGURED',
        reason: 'BLOCKED_MISSING_WEBHOOK_TOKEN',
      },
    });

    return {
      timestamp,
      environment: executionEnv,
      companyId: params.companyId,
      overallStatus: 'BLOCKED_MISSING_WEBHOOK_TOKEN',
      productionSafetyLocked: prodSafety.locked,
      productionSafetyDetails: prodSafety,
      steps,
      readinessForLive: {
        sandboxHomologated: false,
        multiTenantIsolationVerified: true,
        idempotencyVerified: false,
        adverseCasesVerified: false,
        liveModeStatus: 'DISABLED',
        pendingOwnerActions: [
          'Configurar a URL oficial de webhook (/api/credit/webhooks/asaas) no portal Asaas Sandbox',
          'Cadastrar o token secreto de webhook correspondente na Central de Integrações da empresa',
        ],
      },
    };
  }

  const scopeSuffix = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const seller = await ensureScopedSellerForTestCompany(params.companyId, scopeSuffix);

  // Em simulação (ou homologação com token explícito para empresa de teste sem registro prévio),
  // garante que o token esteja gravado criptografado no Vault da empresa de teste, sem sobrescrever integrações DISABLED/REVOKED.
  const existingCompanySandbox = await prisma.companyIntegration.findUnique({
    where: {
      companyId_category_environment: {
        companyId: params.companyId,
        category: 'PAYMENT_GATEWAY',
        environment: 'SANDBOX',
      },
    },
  });

  if (!existingCompanySandbox) {
    const encWh = encryptSecret(webhookToken);
    const encApi = apiKey ? encryptSecret(apiKey) : null;
    await prisma.companyIntegration.create({
      data: {
        companyId: params.companyId,
        category: 'PAYMENT_GATEWAY',
        provider: 'ASAAS',
        scope: 'COMPANY_EXCLUSIVE',
        environment: 'SANDBOX',
        status: 'ACTIVE',
        accountName: 'Conta Sandbox Homologação Isolada',
        costPayer: 'COMPANY',
        credentialSource: encApi ? 'VAULT_ENCRYPTED' : 'NONE',
        encryptedSecret: encApi?.encryptedSecret || null,
        secretIv: encApi?.secretIv || null,
        secretTag: encApi?.secretTag || null,
        secretMasked: apiKey ? maskSecret(apiKey) : null,
        createdByUserId: seller.id,
        configMetadata: {
          financialLiveAuthorized: false,
          encryptedWebhookToken: encWh.encryptedSecret,
          webhookIv: encWh.secretIv,
          webhookTag: encWh.secretTag,
          webhookMasked: maskSecret(webhookToken),
        },
      },
    });
  } else if (
    existingCompanySandbox.status === 'ACTIVE' &&
    !extractWebhookTokenFromMetadata(existingCompanySandbox.configMetadata)
  ) {
    const encWh = encryptSecret(webhookToken);
    const currentMeta = ((existingCompanySandbox.configMetadata as any) || {});
    await prisma.companyIntegration.update({
      where: { id: existingCompanySandbox.id },
      data: {
        configMetadata: {
          ...currentMeta,
          encryptedWebhookToken: encWh.encryptedSecret,
          webhookIv: encWh.secretIv,
          webhookTag: encWh.secretTag,
          webhookMasked: maskSecret(webhookToken),
        },
      },
    });
  }

  steps.push({
    step: 1,
    name: 'Verificação de Ambiente, Banco e Credenciais sem Fallback',
    status: 'SUCCESS',
    durationMs: Date.now() - step1Start,
    details: isSimulation
      ? 'Banco de homologação e empresa de teste verificados. Modo SIMULAÇÃO identificado (nunca homologa externamente).'
      : `Banco de homologação verificado e credenciais Sandbox exclusivas da empresa carregadas (${ASAAS_SANDBOX_BASE_URL}).`,
    data: {
      executionEnv,
      targetBaseUrl: ASAAS_SANDBOX_BASE_URL,
      databaseTarget: safetyCheck.details?.databaseTarget,
      productionSafetyLocked: prodSafety.locked,
    },
  });

  const primaryLedger = await createScopedCreditLedgerFixture({
    companyId: params.companyId,
    sellerId: seller.id,
    scopeTag: `PRIMARY_${scopeSuffix}`,
    installmentsCount: 2,
  });
  const primaryInstallment = primaryLedger.installments[0];
  const secondaryInstallment = primaryLedger.installments[1];

  // 2. Criação de Cliente Fictício Seguro no Sandbox
  const step2Start = Date.now();
  let customerId = `cus_sim_homolog_${scopeSuffix}`;
  let externalProviderFailed = false;

  try {
    if (!isSimulation && apiKey) {
      const custEndpoint = `${ASAAS_SANDBOX_BASE_URL}/customers`;
      const urlCheck = await validateExternalUrl(custEndpoint);
      if (!urlCheck.valid) throw new Error(urlCheck.error);

      const res = await fetch(custEndpoint, {
        method: 'POST',
        headers: {
          access_token: apiKey,
          'Content-Type': 'application/json',
          'User-Agent': 'LumoraHarness-Sandbox/2.1',
        },
        body: JSON.stringify({
          name: 'Homologação Sandbox Lumora (Fictício)',
          cpfCnpj: '04702952000',
          email: 'homologacao.sandbox@lumora.com.br',
          notificationDisabled: true,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Falha ao criar cliente no Asaas Sandbox (${res.status}): ${errText}`);
      }
      const custData = await res.json();
      customerId = custData.id;
    }

    steps.push({
      step: 2,
      name: 'Criação de Cliente Fictício Seguro',
      status: 'SUCCESS',
      durationMs: Date.now() - step2Start,
      details: isSimulation
        ? `Cliente de simulação estruturado (${customerId}).`
        : `Cliente fictício criado no Asaas Sandbox (${customerId}) com notificações desativadas.`,
      data: { customerId },
    });
  } catch (err: any) {
    externalProviderFailed = true;
    steps.push({
      step: 2,
      name: 'Criação de Cliente Fictício Seguro',
      status: 'FAILED',
      durationMs: Date.now() - step2Start,
      details: err.message,
    });
  }

  // 3. Emissão de Cobrança Vinculada à Parcela da Fixture
  const step3Start = Date.now();
  let paymentId = `pay_sim_homolog_${scopeSuffix}`;
  const externalReference = primaryInstallment.id;

  try {
    if (!isSimulation && apiKey) {
      if (externalProviderFailed) {
        throw new Error('Emissão abortada devido à falha na etapa anterior no provedor Sandbox.');
      }
      const payEndpoint = `${ASAAS_SANDBOX_BASE_URL}/payments`;
      const urlCheck = await validateExternalUrl(payEndpoint);
      if (!urlCheck.valid) throw new Error(urlCheck.error);

      const res = await fetch(payEndpoint, {
        method: 'POST',
        headers: {
          access_token: apiKey,
          'Content-Type': 'application/json',
          'User-Agent': 'LumoraHarness-Sandbox/2.1',
        },
        body: JSON.stringify({
          customer: customerId,
          billingType: 'BOLETO',
          value: 50.0,
          dueDate: primaryInstallment.dueDate.toISOString().split('T')[0],
          description: `Homologação Sandbox Lumora (${scopeSuffix})`,
          externalReference,
          postalService: false,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Falha ao emitir cobrança no Sandbox (${res.status}): ${errText}`);
      }
      const payData = await res.json();
      paymentId = payData.id;
    }

    await prisma.asaasCharge.create({
      data: {
        companyId: params.companyId,
        agreementId: primaryLedger.agreement.id,
        installmentId: primaryInstallment.id,
        externalId: paymentId,
        customerExternalId: customerId,
        billingType: 'BOLETO',
        status: 'PENDING',
        nominalValueCents: 5000,
        dueDate: primaryInstallment.dueDate,
        invoiceUrl: isSimulation
          ? `https://sandbox.asaas.com/i/${paymentId}`
          : `https://sandbox.asaas.com/i/${paymentId}`,
      },
    });

    steps.push({
      step: 3,
      name: 'Emissão e Vínculo Local de Cobrança (AsaasCharge)',
      status: 'SUCCESS',
      durationMs: Date.now() - step3Start,
      details: `Cobrança ${paymentId} vinculada à parcela ${primaryInstallment.id} (R$ 50,00).`,
      data: { paymentId, installmentId: primaryInstallment.id, value: 50.0 },
    });
  } catch (err: any) {
    externalProviderFailed = true;
    steps.push({
      step: 3,
      name: 'Emissão e Vínculo Local de Cobrança (AsaasCharge)',
      status: 'FAILED',
      durationMs: Date.now() - step3Start,
      details: err.message,
    });
  }

  // 4. Liquidação/Simulação de Pagamento no Provedor Sandbox
  const step4Start = Date.now();
  try {
    if (!isSimulation && apiKey) {
      if (externalProviderFailed) {
        throw new Error('Simulação de pagamento abortada devido à falha na emissão da cobrança.');
      }
      const simUrl = `${ASAAS_SANDBOX_BASE_URL}/payments/${paymentId}/simulatePayment`;
      const urlCheck = await validateExternalUrl(simUrl);
      if (!urlCheck.valid) throw new Error(urlCheck.error);

      const res = await fetch(simUrl, {
        method: 'POST',
        headers: {
          access_token: apiKey,
          'Content-Type': 'application/json',
          'User-Agent': 'LumoraHarness-Sandbox/2.1',
        },
        body: JSON.stringify({ value: 50.0 }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Falha ao simular pagamento no provedor Asaas Sandbox (Status ${res.status}): ${errText}`);
      }

      steps.push({
        step: 4,
        name: 'Gatilho de Pagamento no Provedor Sandbox',
        status: 'SUCCESS',
        durationMs: Date.now() - step4Start,
        details: `Pagamento acionado no endpoint oficial do Asaas Sandbox (${paymentId}). Aguardando webhook real.`,
      });
    } else {
      steps.push({
        step: 4,
        name: 'Preparação do Gatilho de Pagamento (Modo Simulação)',
        status: 'SUCCESS',
        durationMs: Date.now() - step4Start,
        details: 'Modo de simulação identificado: entrega HTTP será realizada na rota operacional local.',
      });
    }
  } catch (err: any) {
    externalProviderFailed = true;
    steps.push({
      step: 4,
      name: 'Gatilho de Pagamento no Provedor Sandbox',
      status: 'FAILED',
      durationMs: Date.now() - step4Start,
      details: err.message,
    });
  }

  // 5 & 6. Recepção do Webhook na Rota Operacional, Amortização, Comissão, Replay HTTP, Concorrência e Reinício
  let server1: { baseUrl: string; close: () => Promise<void> } | null = null;
  let server2: { baseUrl: string; close: () => Promise<void> } | null = null;
  let idempotencyVerified = false;
  let adverseCasesVerified = false;
  let awaitingProviderWebhook = false;

  try {
    server1 = await startEphemeralOperationalWebhookServer();

    if (!isSimulation) {
      // MODO OFICIAL: Proibido substituir falta de retorno do provedor por payload local!
      const step5Start = Date.now();
      const totalWaitMs = params.providerWebhookWaitMs ?? 1500;
      const pollIntervalMs = Math.max(50, Math.floor(totalWaitMs / 3));
      let realWebhookEvent = null;

      if (!externalProviderFailed) {
        for (let attempt = 0; attempt < 3; attempt++) {
          realWebhookEvent = await prisma.asaasWebhookEvent.findFirst({
            where: {
              companyId: params.companyId,
              externalPaymentId: paymentId,
              processed: true,
            },
            orderBy: { createdAt: 'desc' },
          });
          if (realWebhookEvent) break;
          if (totalWaitMs > 0 && attempt < 2) {
            await new Promise((r) => setTimeout(r, pollIntervalMs));
          }
        }
      }

      if (externalProviderFailed) {
        steps.push({
          step: 5,
          name: 'Recepção e Autenticação do Webhook Real do Sandbox',
          status: 'FAILED',
          durationMs: Date.now() - step5Start,
          details: 'Não foi possível aguardar webhook pois a comunicação prévia com o provedor falhou.',
        });
        steps.push({
          step: 6,
          name: 'Baixa, Comissão, Replay HTTP, Concorrência e Reinício',
          status: 'FAILED',
          durationMs: 0,
          details: 'Etapa não concluída devido à falha prévia no provedor Sandbox.',
        });
      } else if (!realWebhookEvent) {
        awaitingProviderWebhook = true;
        steps.push({
          step: 5,
          name: 'Recepção e Autenticação do Webhook Real do Sandbox',
          status: 'PENDING',
          durationMs: Date.now() - step5Start,
          details: `Aguardando entrega do webhook oficial pelo Asaas Sandbox para a cobrança ${paymentId} em /api/credit/webhooks/asaas. Nenhum payload local foi sintetizado.`,
          data: { paymentId, state: 'PENDING_PROVIDER_WEBHOOK' },
        });
        steps.push({
          step: 6,
          name: 'Baixa, Comissão, Replay HTTP, Concorrência e Reinício',
          status: 'PENDING',
          durationMs: 0,
          details: `Pendente da chegada do webhook real do provedor para comprovar amortização da parcela ${primaryInstallment.id} e comissão de 10%.`,
          data: { installmentId: primaryInstallment.id, state: 'PENDING_PROVIDER_WEBHOOK' },
        });
      } else {
        // O provedor entregou o webhook real e ele foi autenticado e persistido!
        steps.push({
          step: 5,
          name: 'Recepção e Autenticação do Webhook Real do Sandbox',
          status: 'SUCCESS',
          durationMs: Date.now() - step5Start,
          details: `Webhook oficial recebido do Asaas Sandbox e autenticado (Event ID: ${realWebhookEvent.eventId || realWebhookEvent.id}).`,
          data: { webhookEventDbId: realWebhookEvent.id, eventId: realWebhookEvent.eventId },
        });

        const step6Start = Date.now();
        // Exercita replay HTTP, concorrência e replay após reinício com o próprio payload autêntico recebido
        const replayPayload = realWebhookEvent.payload as any;
        const httpReplayRes = await postWebhookToOperationalRoute(
          server1.baseUrl,
          replayPayload,
          webhookToken
        );

        await Promise.all([
          postWebhookToOperationalRoute(server1.baseUrl, replayPayload, webhookToken),
          postWebhookToOperationalRoute(server1.baseUrl, replayPayload, webhookToken),
        ]);

        // Reinício real da instância HTTP Express
        await server1.close();
        server1 = null;
        server2 = await startEphemeralOperationalWebhookServer();

        const afterRestartRes = await postWebhookToOperationalRoute(
          server2.baseUrl,
          replayPayload,
          webhookToken
        );

        const refreshedInstallment = await prisma.creditInstallment.findUnique({
          where: { id: primaryInstallment.id },
        });
        const refreshedCharge = await prisma.asaasCharge.findFirst({
          where: { companyId: params.companyId, externalId: paymentId },
        });
        const payments = await prisma.creditPayment.findMany({
          where: { companyId: params.companyId, externalPaymentId: paymentId },
        });
        const commissions = payments[0]
          ? await prisma.creditCommission.findMany({ where: { paymentId: payments[0].id } })
          : [];

        const chargeSettled =
          refreshedCharge?.status === 'RECEIVED' || refreshedCharge?.status === 'CONFIRMED';
        const installmentPaid =
          refreshedInstallment?.status === 'PAID' && refreshedInstallment?.paidCents === 5000;
        const singlePayment = payments.length === 1 && payments[0].amountCents === 5000;
        const singleCommission = commissions.length === 1 && commissions[0].amountCents === 500;
        const replayOk = httpReplayRes.status === 200;
        const restartReplayOk = afterRestartRes.status === 200;

        idempotencyVerified = Boolean(
          chargeSettled &&
            installmentPaid &&
            singlePayment &&
            singleCommission &&
            replayOk &&
            restartReplayOk
        );

        steps.push({
          step: 6,
          name: 'Baixa, Comissão, Replay HTTP, Concorrência e Reinício',
          status: idempotencyVerified ? 'SUCCESS' : 'FAILED',
          durationMs: Date.now() - step6Start,
          details: idempotencyVerified
            ? 'Cobrança Sandbox vinculada e baixada (PAID), comissão de 10% (R$ 5,00) persistida, sem duplicidade em replay HTTP, concorrência e pós-reinício.'
            : `Inconsistência na verificação pós-webhook: chargeSettled=${chargeSettled}, installmentPaid=${installmentPaid}, payments=${payments.length}, commissions=${commissions.length}.`,
        });
      }
    } else {
      // MODO SIMULAÇÃO LOCAL IDENTIFICADO (isSimulation === true):
      // Exercita transporte HTTP real contra /api/credit/webhooks/asaas, Vault real, amortização, comissão,
      // replay HTTP, concorrência sob FOR UPDATE e replay após reinício do servidor HTTP.
      const step5Start = Date.now();
      const simEventId = `HOMOLOG_TEST_EVT_${scopeSuffix}`;
      const simPayload = {
        id: simEventId,
        event: 'PAYMENT_RECEIVED',
        payment: {
          id: paymentId,
          value: 50.0,
          netValue: 49.01,
          billingType: 'BOLETO',
          externalReference: primaryInstallment.id,
        },
      };

      const headerForPrimaryDelivery =
        params.incomingTestWebhookToken !== undefined
          ? params.incomingTestWebhookToken
          : webhookToken;

      const firstHttpRes = await postWebhookToOperationalRoute(
        server1.baseUrl,
        simPayload,
        headerForPrimaryDelivery
      );

      const invalidHttpRes = await postWebhookToOperationalRoute(
        server1.baseUrl,
        simPayload,
        `token_invalido_${scopeSuffix}`
      );

      const step5Ok =
        firstHttpRes.status === 200 &&
        firstHttpRes.body?.processed === true &&
        invalidHttpRes.status === 401;

      steps.push({
        step: 5,
        name: 'Autenticação HTTP na Rota Operacional (/api/credit/webhooks/asaas)',
        status: step5Ok ? 'SUCCESS' : 'FAILED',
        durationMs: Date.now() - step5Start,
        details: step5Ok
          ? 'Rota HTTP operacional autenticou o segredo gravado no Vault da empresa e rejeitou token inválido com HTTP 401.'
          : `Falha na autenticação HTTP da rota operacional: firstStatus=${firstHttpRes.status}, invalidStatus=${invalidHttpRes.status}.`,
      });

      const step6Start = Date.now();
      // 1. Replay HTTP imediato na mesma instância
      const httpReplayRes = await postWebhookToOperationalRoute(
        server1.baseUrl,
        simPayload,
        webhookToken
      );

      // 2. Concorrência real na 2ª parcela via requisições HTTP paralelas
      const concurrentPayId = `pay_sim_conc_${scopeSuffix}`;
      await prisma.asaasCharge.create({
        data: {
          companyId: params.companyId,
          agreementId: primaryLedger.agreement.id,
          installmentId: secondaryInstallment.id,
          externalId: concurrentPayId,
          customerExternalId: customerId,
          billingType: 'PIX',
          status: 'PENDING',
          nominalValueCents: 5000,
          dueDate: secondaryInstallment.dueDate,
          invoiceUrl: `https://sandbox.asaas.com/i/${concurrentPayId}`,
        },
      });

      const concurrentPayload = {
        id: `HOMOLOG_TEST_CONC_${scopeSuffix}`,
        event: 'PAYMENT_RECEIVED',
        payment: {
          id: concurrentPayId,
          value: 50.0,
          netValue: 49.5,
          billingType: 'PIX',
          externalReference: secondaryInstallment.id,
        },
      };

      await Promise.all([
        postWebhookToOperationalRoute(server1.baseUrl, concurrentPayload, webhookToken),
        postWebhookToOperationalRoute(server1.baseUrl, concurrentPayload, webhookToken),
        postWebhookToOperationalRoute(server1.baseUrl, concurrentPayload, webhookToken),
      ]);

      // 3. Replay após reinício completo da instância HTTP Express
      await server1.close();
      server1 = null;
      server2 = await startEphemeralOperationalWebhookServer();

      const replayAfterRestartRes = await postWebhookToOperationalRoute(
        server2.baseUrl,
        simPayload,
        webhookToken
      );

      // Conferência no livro de homologação
      const updatedInst1 = await prisma.creditInstallment.findUnique({
        where: { id: primaryInstallment.id },
      });
      const updatedInst2 = await prisma.creditInstallment.findUnique({
        where: { id: secondaryInstallment.id },
      });
      const updatedAgreement = await prisma.creditAgreement.findUnique({
        where: { id: primaryLedger.agreement.id },
      });
      const inst1Payments = await prisma.creditPayment.findMany({
        where: { companyId: params.companyId, externalPaymentId: paymentId },
      });
      const inst2Payments = await prisma.creditPayment.findMany({
        where: { companyId: params.companyId, externalPaymentId: concurrentPayId },
      });
      const inst1Commissions = inst1Payments[0]
        ? await prisma.creditCommission.findMany({ where: { paymentId: inst1Payments[0].id } })
        : [];
      const inst2Commissions = inst2Payments[0]
        ? await prisma.creditCommission.findMany({ where: { paymentId: inst2Payments[0].id } })
        : [];

      const amortOk =
        updatedInst1?.status === 'PAID' &&
        updatedInst1.paidCents === 5000 &&
        updatedInst2?.status === 'PAID' &&
        updatedInst2.paidCents === 5000 &&
        updatedAgreement?.remainingPrincipalCents === 0 &&
        updatedAgreement?.paidPrincipalCents === 10000 &&
        updatedAgreement?.status === 'SETTLED';
      const noDuplicatePayments = inst1Payments.length === 1 && inst2Payments.length === 1;
      const commissionsOk =
        inst1Commissions.length === 1 &&
        inst1Commissions[0].amountCents === 500 &&
        inst2Commissions.length === 1 &&
        inst2Commissions[0].amountCents === 500;
      const httpReplayDeduplicated =
        httpReplayRes.status === 200 && httpReplayRes.body?.deduplicated === true;
      const restartReplayDeduplicated =
        replayAfterRestartRes.status === 200 && replayAfterRestartRes.body?.deduplicated === true;

      idempotencyVerified = Boolean(
        step5Ok &&
          amortOk &&
          noDuplicatePayments &&
          commissionsOk &&
          httpReplayDeduplicated &&
          restartReplayDeduplicated
      );

      steps.push({
        step: 6,
        name: 'Baixa, Comissão, Replay HTTP, Concorrência e Replay Pós-Reinício',
        status: idempotencyVerified ? 'SUCCESS' : 'FAILED',
        durationMs: Date.now() - step6Start,
        details: idempotencyVerified
          ? 'Baixa integral persistida (SETTLED), comissões de 10% (2x R$ 5,00) geradas, replay HTTP deduplicado, 3 entregas concorrentes contidas por FOR UPDATE (1 pagamento) e replay após reinício do servidor sem duplicação.'
          : `Falha na esteira: amortOk=${amortOk}, inst1Pay=${inst1Payments.length}, inst2Pay=${inst2Payments.length}, commOk=${commissionsOk}, replay=${httpReplayDeduplicated}, restartReplay=${restartReplayDeduplicated}.`,
      });
    }

    // 7. Demonstrativo de Remuneração Contratual da Plataforma e Comissões (Regras Comerciais Intactas)
    const step7Start = Date.now();
    try {
      const rateRecord = await prisma.companyPlatformRate.findFirst({
        where: {
          companyId: params.companyId,
          effectiveFrom: { lte: new Date() },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
        },
        orderBy: { effectiveFrom: 'desc' },
      });

      const activePlatformRate = rateRecord ? Number(rateRecord.ratePercentage) : null;
      const rateStatusDescription =
        activePlatformRate === null
          ? 'Taxa não configurada / pendente de contratação (sem padrão arbitrário)'
          : activePlatformRate === 0
            ? 'Taxa 0,00% (Gratuidade contratual explícita)'
            : `Taxa vigente: ${activePlatformRate.toFixed(2)}% (desde ${rateRecord!.effectiveFrom.toISOString().split('T')[0]})`;

      const testSaleTotalCents = 10000;
      const installmentPrincipalCents = 5000;
      const lumoraFeeOnSaleCents =
        activePlatformRate !== null ? Math.round(testSaleTotalCents * (activePlatformRate / 100)) : null;
      const lumoraFeeOnInstallmentCents = 0; // Sem nova incidência sobre parcela de venda já contabilizada
      const sellerCommissionCompanyCarCents = Math.round(testSaleTotalCents * 0.2);
      const sellerCommissionOwnCarCents = Math.round(testSaleTotalCents * 0.25);
      const sellerCommissionInstallmentCents = Math.round(installmentPrincipalCents * 0.1);

      steps.push({
        step: 7,
        name: 'Demonstrativo de Comissão e Taxa da Plataforma',
        status: 'SUCCESS',
        durationMs: Date.now() - step7Start,
        details: `Venda Base R$ ${(testSaleTotalCents / 100).toFixed(2)} | Lumora: ${rateStatusDescription} -> R$ ${lumoraFeeOnSaleCents !== null ? (lumoraFeeOnSaleCents / 100).toFixed(2) : 'Pendente'} | Parcela recebida: R$ 0,00 Lumora | Vendedor: 20%/25% na entrada, 10% (R$ ${(sellerCommissionInstallmentCents / 100).toFixed(2)}) na parcela.`,
        data: {
          activePlatformRate,
          lumoraFeeOnSaleCents,
          lumoraFeeOnInstallmentCents,
          sellerCommissionCompanyCarCents,
          sellerCommissionOwnCarCents,
          sellerCommissionInstallmentCents,
          savedToLiveBook: false,
        },
      });
    } catch (err: any) {
      steps.push({
        step: 7,
        name: 'Demonstrativo de Comissão e Taxa da Plataforma',
        status: 'FAILED',
        durationMs: Date.now() - step7Start,
        details: `Erro ao consultar taxa contratual: ${err.message}`,
      });
    }

    // 8. Casos Adversos na Rota/Serviços Operacionais Reais:
    //    - Token inválido (HTTP 401)
    //    - Conta/Empresa diferente (cobrança real de outra empresa de teste isolada -> unlinked: true, saldo intocado)
    //    - Eventos fora de ordem (PAYMENT_CONFIRMED após PAYMENT_RECEIVED -> estado RECEIVED preservado, sem duplicar baixa)
    const step8Start = Date.now();
    try {
      const activeServer = server2 ?? server1 ?? (server2 = await startEphemeralOperationalWebhookServer());

      // Caso A: Token inválido / de conta externa desconhecida
      const badTokenRes = await postWebhookToOperationalRoute(
        activeServer.baseUrl,
        {
          id: `HOMOLOG_TEST_BADTOK_${scopeSuffix}`,
          event: 'PAYMENT_RECEIVED',
          payment: { id: `pay_bad_${scopeSuffix}`, value: 50.0 },
        },
        `whsec_outra_conta_desconhecida_${scopeSuffix}`
      );
      const invalidTokenRejected = badTokenRes.status === 401;

      // Caso B: Cobrança real pertencente a OUTRA empresa de teste (isolamento cross-tenant)
      const otherCompany = await prisma.company.create({
        data: {
          id: `homolog-other-${scopeSuffix}`,
          name: `Empresa Teste Outra Conta ${scopeSuffix}`,
          status: 'ACTIVE',
        },
      });
      const otherSeller = await ensureScopedSellerForTestCompany(otherCompany.id, `OTHER_${scopeSuffix}`);
      const otherLedger = await createScopedCreditLedgerFixture({
        companyId: otherCompany.id,
        sellerId: otherSeller.id,
        scopeTag: `OTHER_${scopeSuffix}`,
        installmentsCount: 1,
      });
      const otherChargeExternalId = `pay_other_tenant_${scopeSuffix}`;
      await prisma.asaasCharge.create({
        data: {
          companyId: otherCompany.id,
          agreementId: otherLedger.agreement.id,
          installmentId: otherLedger.installments[0].id,
          externalId: otherChargeExternalId,
          customerExternalId: `cus_other_${scopeSuffix}`,
          billingType: 'PIX',
          status: 'PENDING',
          nominalValueCents: 5000,
          dueDate: otherLedger.installments[0].dueDate,
        },
      });

      const crossTenantRes = await postWebhookToOperationalRoute(
        activeServer.baseUrl,
        {
          id: `HOMOLOG_TEST_CROSS_${scopeSuffix}`,
          event: 'PAYMENT_RECEIVED',
          payment: {
            id: otherChargeExternalId,
            value: 50.0,
            netValue: 49.5,
            billingType: 'PIX',
            externalReference: otherLedger.installments[0].id,
          },
        },
        webhookToken // Autenticado como params.companyId tentando atingir cobrança de otherCompany!
      );
      const otherInstallmentAfter = await prisma.creditInstallment.findUnique({
        where: { id: otherLedger.installments[0].id },
      });
      const crossCompanyIsolated =
        crossTenantRes.status === 200 &&
        crossTenantRes.body?.unlinked === true &&
        otherInstallmentAfter?.status === 'PENDING' &&
        otherInstallmentAfter?.paidCents === 0;

      // Caso C: Evento fora de ordem (PAYMENT_CONFIRMED chegando DEPOIS de PAYMENT_RECEIVED)
      const oooLedger = await createScopedCreditLedgerFixture({
        companyId: params.companyId,
        sellerId: seller.id,
        scopeTag: `OOO_${scopeSuffix}`,
        installmentsCount: 1,
      });
      const oooPayId = `pay_ooo_${scopeSuffix}`;
      const oooCharge = await prisma.asaasCharge.create({
        data: {
          companyId: params.companyId,
          agreementId: oooLedger.agreement.id,
          installmentId: oooLedger.installments[0].id,
          externalId: oooPayId,
          customerExternalId: customerId,
          billingType: 'BOLETO',
          status: 'PENDING',
          nominalValueCents: 5000,
          dueDate: oooLedger.installments[0].dueDate,
        },
      });

      const oooReceivedRes = await postWebhookToOperationalRoute(
        activeServer.baseUrl,
        {
          id: `HOMOLOG_TEST_OOO_1_${scopeSuffix}`,
          event: 'PAYMENT_RECEIVED',
          payment: {
            id: oooPayId,
            value: 50.0,
            netValue: 49.0,
            billingType: 'BOLETO',
            externalReference: oooLedger.installments[0].id,
          },
        },
        webhookToken
      );

      const oooLateConfirmedRes = await postWebhookToOperationalRoute(
        activeServer.baseUrl,
        {
          id: `HOMOLOG_TEST_OOO_2_${scopeSuffix}`,
          event: 'PAYMENT_CONFIRMED',
          payment: {
            id: oooPayId,
            value: 50.0,
            netValue: 49.0,
            billingType: 'BOLETO',
            externalReference: oooLedger.installments[0].id,
          },
        },
        webhookToken
      );

      const oooChargeAfter = await prisma.asaasCharge.findUnique({ where: { id: oooCharge.id } });
      const oooPaymentsCount = await prisma.creditPayment.count({
        where: { companyId: params.companyId, externalPaymentId: oooPayId },
      });

      const outOfOrderHandled =
        oooReceivedRes.status === 200 &&
        oooLateConfirmedRes.status === 200 &&
        oooChargeAfter?.status === 'RECEIVED' &&
        oooPaymentsCount === 1;

      adverseCasesVerified = Boolean(
        invalidTokenRejected && crossCompanyIsolated && outOfOrderHandled
      );

      steps.push({
        step: 8,
        name: 'Casos Adversos na Rota Operacional (401, Outra Empresa e Fora de Ordem)',
        status: adverseCasesVerified ? 'SUCCESS' : 'FAILED',
        durationMs: Date.now() - step8Start,
        details: adverseCasesVerified
          ? 'Rota HTTP operacional validou: token inválido recusado (401), cobrança de outra empresa bloqueada (unlinked: true, parcela intacta) e PAYMENT_CONFIRMED fora de ordem ignorado sem regredir status RECEIVED nem duplicar pagamento.'
          : `Falha nos casos adversos: invalidTokenRejected=${invalidTokenRejected}, crossCompanyIsolated=${crossCompanyIsolated}, outOfOrderHandled=${outOfOrderHandled}.`,
      });
    } catch (err: any) {
      adverseCasesVerified = false;
      steps.push({
        step: 8,
        name: 'Casos Adversos na Rota Operacional (401, Outra Empresa e Fora de Ordem)',
        status: 'FAILED',
        durationMs: Date.now() - step8Start,
        details: `Erro nos testes adversos via HTTP: ${err.message}`,
      });
    }
  } finally {
    if (server1) await server1.close().catch(() => {});
    if (server2) await server2.close().catch(() => {});
  }

  const hasFailedSteps = steps.some((s) => s.status === 'FAILED' || s.status === 'BLOCKED');

  let overallStatus: SandboxHarnessReport['overallStatus'] = 'PASSED';
  let isHomologatedOfficial = false;

  if (hasFailedSteps) {
    overallStatus = 'FAILED';
    isHomologatedOfficial = false;
  } else if (isSimulation) {
    // Simulação local NUNCA homologa externamente
    overallStatus = 'PASSED';
    isHomologatedOfficial = false;
  } else if (awaitingProviderWebhook || !idempotencyVerified) {
    overallStatus = 'PENDING_PROVIDER_WEBHOOK';
    isHomologatedOfficial = false;
  } else {
    overallStatus = 'PASSED';
    isHomologatedOfficial = true;
  }

  const refreshedProdSafety = await isProductionSafetyLocked(params.companyId);

  return {
    timestamp,
    environment: executionEnv,
    companyId: params.companyId,
    overallStatus,
    productionSafetyLocked: refreshedProdSafety.locked,
    productionSafetyDetails: refreshedProdSafety,
    steps,
    readinessForLive: {
      sandboxHomologated: isHomologatedOfficial,
      multiTenantIsolationVerified: adverseCasesVerified,
      idempotencyVerified,
      adverseCasesVerified,
      liveModeStatus: 'DISABLED',
      pendingOwnerActions: awaitingProviderWebhook
        ? [
            `Aguardar entrega do webhook oficial do Asaas Sandbox para a cobrança ${paymentId} em /api/credit/webhooks/asaas`,
            'Conferir se a URL pública de homologação está ativa e com o mesmo token cadastrado no portal Asaas Sandbox',
            'Reexecutar ou consultar prontidão após o recebimento do evento real do provedor',
          ]
        : [
            'Aprovação formal dos dados cadastrais no portal oficial Asaas',
            'Contratação formal do modelo de conta bancária homologada',
            'Validação final das tarifas bancárias negociadas (Boleto/Pix)',
            'Ativação do modo LIVE apenas em etapa futura mediante autorização financeira explícita',
          ],
    },
  };
}
