/**
 * Serviço de Integração Bancária Asaas (Boleto, Pix e Carnê com Blindagem Jurídica)
 * Compatível com SANDBOX e PRODUÇÃO, com modos de operação explícitos e fila persistente.
 * 
 * DIRETRIZ LGPD: NUNCA envia dados ou fotos de crianças para o Asaas. Apenas dados do Responsável Legal.
 */

import { prisma } from './prisma';
import { resolveCompanyIntegration } from './integrationResolver';



export type AsaasMode = 'DISABLED' | 'SANDBOX' | 'PRODUCTION';

export interface AsaasCustomerInput {
  name: string;
  cpfCnpj: string;
  phone?: string | null;
  postalCode?: string | null;
  address?: string | null;
  addressNumber?: string | null;
  complement?: string | null;
  province?: string | null;
  city?: string | null;
  state?: string | null;
  externalReference?: string | null;
}

export interface AsaasChargeInput {
  customerExternalId: string;
  billingType?: 'BOLETO' | 'PIX' | 'UNDEFINED';
  value: number; // Em reais (ex: 100.00)
  dueDate: string; // YYYY-MM-DD
  description?: string;
  externalReference: string; // ID da parcela no banco
}

export interface AsaasConfigData {
  mode: AsaasMode;
  apiKey?: string | null;
  webhookToken?: string | null;
  walletId?: string | null;
  integrationId?: string | null;
  accountName?: string | null;
  environment?: 'SANDBOX' | 'PRODUCTION' | null;
}

/**
 * Obtém a URL base oficial de acordo com o modo configurado
 */
export function getAsaasBaseUrl(mode: AsaasMode): string {
  if (mode === 'SANDBOX') {
    return 'https://api-sandbox.asaas.com/v3';
  }
  return 'https://api.asaas.com/v3';
}

import { decryptSecret } from './vaultService';

/**
 * Verifica se a trava global de operação LIVE está ativa no ambiente.
 * Permanece ativa por padrão até habilitação explícita autorizada em etapa futura.
 */
export function isGlobalLiveGateLocked(): boolean {
  return process.env.ASAAS_ALLOW_LIVE_OPERATIONS !== 'true';
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
 * Verifica dinamicamente o status efetivo da guarda de segurança de produção (Asaas LIVE).
 * Reflete a guarda e a configuração real em vigor; nunca retorna booleano fixo.
 */
export async function isProductionSafetyLocked(companyId?: string): Promise<{
  locked: boolean;
  reason: string;
  globalLiveGateLocked: boolean;
  financialLiveAuthorized: boolean;
  activeLiveIntegrationFound: boolean;
}> {
  const globalGateLocked = isGlobalLiveGateLocked();

  if (companyId) {
    const prodIntegration = await prisma.companyIntegration.findFirst({
      where: { companyId, category: 'PAYMENT_GATEWAY', environment: 'PRODUCTION' },
    });
    const isLiveAuth = Boolean((prodIntegration?.configMetadata as any)?.financialLiveAuthorized === true);
    const isActive = prodIntegration?.status === 'ACTIVE';
    const effectiveConfig = await getCompanyAsaasConfig(companyId, 'PRODUCTION');
    const locked = effectiveConfig.mode !== 'PRODUCTION';

    let reason = 'Operação LIVE habilitada sob autorização explícita.';
    if (locked) {
      if (globalGateLocked) {
        reason = 'Guarda global ativa: Operações financeiras LIVE bloqueadas nesta etapa (ASAAS_ALLOW_LIVE_OPERATIONS inativo).';
      } else if (!isActive) {
        reason = 'Integração de produção inexistente ou desativada na Central.';
      } else if (!isLiveAuth) {
        reason = 'Credencial de produção cadastrada, mas sem autorização financeira explícita (financialLiveAuthorized=false).';
      } else {
        reason = 'Credencial de produção ausente ou inválida no Vault.';
      }
    }

    return {
      locked,
      reason,
      globalLiveGateLocked: globalGateLocked,
      financialLiveAuthorized: isLiveAuth,
      activeLiveIntegrationFound: isActive,
    };
  }

  const activeProdIntegrations = await prisma.companyIntegration.findMany({
    where: { category: 'PAYMENT_GATEWAY', environment: 'PRODUCTION', status: 'ACTIVE' },
    select: { companyId: true, configMetadata: true },
  });

  let anyAuthorizedAndUnlocked = false;
  let anyLiveAuthorized = false;

  for (const integ of activeProdIntegrations) {
    const authorized = Boolean((integ.configMetadata as any)?.financialLiveAuthorized === true);
    if (authorized) {
      anyLiveAuthorized = true;
      const effective = await getCompanyAsaasConfig(integ.companyId, 'PRODUCTION');
      if (effective.mode === 'PRODUCTION') {
        anyAuthorizedAndUnlocked = true;
      }
    }
  }

  const locked = !anyAuthorizedAndUnlocked;
  const reason = locked
    ? globalGateLocked
      ? 'Guarda global ativa: Faturamento LIVE bloqueado (ASAAS_ALLOW_LIVE_OPERATIONS inativo).'
      : 'Nenhuma empresa possui integração LIVE simultaneamente ativa, validada e com autorização financeira explícita.'
    : 'Atenção: Ao menos uma empresa possui operação LIVE efetivamente habilitada.';

  return {
    locked,
    reason,
    globalLiveGateLocked: globalGateLocked,
    financialLiveAuthorized: anyLiveAuthorized,
    activeLiveIntegrationFound: activeProdIntegrations.length > 0,
  };
}

/**
 * Recupera as configurações do Asaas para uma empresa com seleção explícita de ambiente.
 * Prioridade absoluta: Central de Integrações (CompanyIntegration).
 *
 * Regras estritas:
 * 1. NUNCA escolhe Sandbox automaticamente na operação real só porque a credencial de produção está ausente.
 * 2. Desativação/revogação na Central NÃO pode ser anulada por fallback na tabela legada.
 * 3. Produção exige status ACTIVE + autorização financeira explícita (financialLiveAuthorized: true) + liberação da trava global LIVE.
 * 4. Tabela legada AsaasConfig só é consultada se a empresa NÃO tiver nenhum registro em CompanyIntegration.
 */
export async function getCompanyAsaasConfig(
  companyId: string,
  requestedEnv?: 'PRODUCTION' | 'SANDBOX'
): Promise<AsaasConfigData> {
  // 1. Central de Integrações (CompanyIntegration) como fonte única da verdade
  try {
    const centralIntegrations = await prisma.companyIntegration.findMany({
      where: { companyId, category: 'PAYMENT_GATEWAY' },
    });

    if (centralIntegrations.length > 0) {
      // Seleção explícita de ambiente: se não informada pela chamada, a operação real mira PRODUCTION,
      // exceto se a governança da empresa declarar explicitamente operationalFinancialMode === 'SANDBOX'.
      let targetEnv: 'PRODUCTION' | 'SANDBOX' = 'PRODUCTION';
      if (requestedEnv) {
        targetEnv = requestedEnv;
      } else {
        const explicitSandboxOp = centralIntegrations.find(
          (i) =>
            i.environment === 'SANDBOX' &&
            i.status === 'ACTIVE' &&
            (i.configMetadata as any)?.operationalFinancialMode === 'SANDBOX'
        );
        targetEnv = explicitSandboxOp ? 'SANDBOX' : 'PRODUCTION';
      }

      if (targetEnv === 'PRODUCTION') {
        if (isGlobalLiveGateLocked()) {
          return { mode: 'DISABLED', apiKey: null, webhookToken: null };
        }
        const prod = centralIntegrations.find((i) => i.environment === 'PRODUCTION');
        if (!prod || prod.status !== 'ACTIVE') {
          return { mode: 'DISABLED', apiKey: null, webhookToken: null };
        }
        const isLiveAuthorized = Boolean((prod.configMetadata as any)?.financialLiveAuthorized === true);
        if (!isLiveAuthorized) {
          return { mode: 'DISABLED', apiKey: null, webhookToken: null };
        }
        const resolved = await resolveCompanyIntegration(companyId, 'PAYMENT_GATEWAY', 'PRODUCTION');
        if (!resolved || resolved.status !== 'ACTIVE' || !resolved.secret) {
          return { mode: 'DISABLED', apiKey: null, webhookToken: null };
        }
        return {
          mode: 'PRODUCTION',
          apiKey: resolved.secret,
          webhookToken: extractWebhookTokenFromMetadata(resolved.integration?.configMetadata),
          walletId: (resolved.integration?.configMetadata as any)?.walletId || null,
          integrationId: resolved.integration?.id || prod.id,
          accountName: resolved.integration?.accountName || prod.accountName || null,
          environment: 'PRODUCTION',
        };
      }

      if (targetEnv === 'SANDBOX') {
        const sb = centralIntegrations.find((i) => i.environment === 'SANDBOX');
        if (!sb || sb.status !== 'ACTIVE') {
          return { mode: 'DISABLED', apiKey: null, webhookToken: null };
        }
        // Quando chamada sem requestedEnv explícito, exige habilitação operacional explícita
        if (!requestedEnv && (sb.configMetadata as any)?.operationalFinancialMode !== 'SANDBOX') {
          return { mode: 'DISABLED', apiKey: null, webhookToken: null };
        }
        const resolved = await resolveCompanyIntegration(companyId, 'PAYMENT_GATEWAY', 'SANDBOX');
        if (!resolved || resolved.status !== 'ACTIVE' || !resolved.secret) {
          return { mode: 'DISABLED', apiKey: null, webhookToken: null };
        }
        return {
          mode: 'SANDBOX',
          apiKey: resolved.secret,
          webhookToken: extractWebhookTokenFromMetadata(resolved.integration?.configMetadata),
          walletId: (resolved.integration?.configMetadata as any)?.walletId || null,
          integrationId: resolved.integration?.id || sb.id,
          accountName: resolved.integration?.accountName || sb.accountName || null,
          environment: 'SANDBOX',
        };
      }

      return { mode: 'DISABLED', apiKey: null, webhookToken: null };
    }
  } catch (err) {
    console.error(`[AsaasService] Erro ao resolver CompanyIntegration para ${companyId}:`, err);
    return { mode: 'DISABLED', apiKey: null, webhookToken: null };
  }

  // 2. Compatibilidade legada com tabela AsaasConfig (SOMENTE se empresa não tiver registro em CompanyIntegration)
  const config = await prisma.asaasConfig.findUnique({
    where: { companyId },
  });

  if (!config || config.mode === 'DISABLED') {
    return {
      mode: 'DISABLED',
      apiKey: null,
      webhookToken: null,
    };
  }

  // Modo legado PRODUCTION jamais habilita LIVE sem governança e autorização explícita na Central
  if (config.mode === 'PRODUCTION') {
    return {
      mode: 'DISABLED',
      apiKey: null,
      webhookToken: null,
    };
  }

  if (config.mode === 'SANDBOX') {
    if (requestedEnv && requestedEnv !== 'SANDBOX') {
      return { mode: 'DISABLED', apiKey: null, webhookToken: null };
    }
    return {
      mode: 'SANDBOX',
      apiKey: config.apiKey || null,
      webhookToken: config.webhookToken || null,
      walletId: config.walletId,
      integrationId: `legacy_${config.id}`,
      accountName: null,
      environment: 'SANDBOX',
    };
  }

  return {
    mode: 'DISABLED',
    apiKey: null,
    webhookToken: null,
  };
}

/**
 * Resolve a configuração preservando estritamente o ambiente e a conta emissora original de cobranças já emitidas.
 * Evita que mudanças posteriores de credencial/ambiente enviem mutações de cobranças antigas para outra conta ou ambiente.
 */
export async function getCompanyAsaasConfigForExistingCharge(
  companyId: string,
  asaasPaymentId: string
): Promise<AsaasConfigData> {
  const existingCharge = await prisma.asaasCharge.findFirst({
    where: { companyId, externalId: asaasPaymentId },
  });

  let originEnv: 'SANDBOX' | 'PRODUCTION' | undefined;
  let originWalletId: string | null = null;
  let originAccountName: string | null = null;

  if (existingCharge) {
    const urls = `${existingCharge.bankSlipUrl || ''} ${existingCharge.invoiceUrl || ''}`.toLowerCase();
    if (urls.includes('sandbox.asaas.com')) {
      originEnv = 'SANDBOX';
    } else if (urls.includes('asaas.com')) {
      originEnv = 'PRODUCTION';
    }

    const createSyncEntry = await prisma.asaasSyncQueue.findFirst({
      where: {
        companyId,
        installmentId: existingCharge.installmentId,
        action: 'CREATE_CHARGE',
      },
      orderBy: { createdAt: 'asc' },
    });

    const syncMeta = (createSyncEntry?.payload as any)?.__originMeta;
    if (syncMeta) {
      if (syncMeta.environment === 'SANDBOX' || syncMeta.environment === 'PRODUCTION') {
        originEnv = syncMeta.environment;
      }
      if (syncMeta.walletId) originWalletId = String(syncMeta.walletId);
      if (syncMeta.accountName) originAccountName = String(syncMeta.accountName);
    }
  }

  const config = originEnv
    ? await getCompanyAsaasConfig(companyId, originEnv)
    : await getCompanyAsaasConfig(companyId);

  if (config.mode === 'DISABLED') {
    return config;
  }

  // Se a cobrança antiga registrou conta/carteira emissora específica diferente da atual, bloqueia mutação cruzada
  if (originWalletId && config.walletId && originWalletId !== config.walletId) {
    console.warn(
      `[AsaasService] Preservação de conta emissora: cobrança ${asaasPaymentId} emitida na carteira ${originWalletId}, distinta da carteira ativa ${config.walletId}. Mutação bloqueada.`
    );
    return { mode: 'DISABLED', apiKey: null, webhookToken: null };
  }
  if (originAccountName && config.accountName && originAccountName !== config.accountName) {
    console.warn(
      `[AsaasService] Preservação de conta emissora: cobrança ${asaasPaymentId} emitida na conta '${originAccountName}', distinta da conta ativa '${config.accountName}'. Mutação bloqueada.`
    );
    return { mode: 'DISABLED', apiKey: null, webhookToken: null };
  }

  return config;
}

/**
 * Realiza chamada HTTP autenticada à API do Asaas
 */
async function asaasRequest(
  config: AsaasConfigData,
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: any
): Promise<any> {
  if (config.mode === 'DISABLED') {
    throw new Error('Integração Asaas está desativada (DISABLED).');
  }

  if (process.env.EXTERNAL_SERVICES_DISABLED === 'true' || process.env.NODE_ENV === 'test') {
    if (endpoint.includes('/refund')) {
      if ((global as any).__lastSimulatedRefunds) {
        (global as any).__lastSimulatedRefunds.push({ endpoint, method, payload: body });
      }
      return { status: 'REFUND_PROCESSING', simulated: true };
    }
    if (endpoint.includes('/receiveInCash')) {
      return { success: true, simulated: true };
    }
    if (method === 'DELETE') {
      return { deleted: true, simulated: true };
    }
    if (endpoint.startsWith('/negativations/remove') || endpoint.startsWith('/payments/negativation/remove')) {
      const simCtrl = (global as any).__simulatedSerasaControl || {};
      if (simCtrl.failRemoval) {
        throw new Error(
          typeof simCtrl.failRemoval === 'string'
            ? simCtrl.failRemoval
            : 'Falha simulada na comunicação de exclusão Serasa/Asaas Sandbox.'
        );
      }
      return {
        removed: true,
        status: 'CANCELLED',
        removalProtocolNumber: simCtrl.removalProtocolNumber || `SER-REM-SBX-${Date.now()}`,
        simulated: true,
        environment: 'SANDBOX',
      };
    }
    if (endpoint.startsWith('/negativations') || endpoint.startsWith('/payments/negativation')) {
      const simCtrl = (global as any).__simulatedSerasaControl || {};
      if (simCtrl.failRequest) {
        throw new Error(
          typeof simCtrl.failRequest === 'string'
            ? simCtrl.failRequest
            : 'Falha simulada na comunicação de inclusão Serasa/Asaas Sandbox.'
        );
      }
      if (simCtrl.forceRefuseReason) {
        return {
          accepted: false,
          status: 'REFUSED',
          refusalReason: simCtrl.forceRefuseReason,
          protocolNumber: `SER-REF-SBX-${Date.now()}`,
          simulated: true,
          environment: 'SANDBOX',
        };
      }
      return {
        accepted: true,
        id: simCtrl.externalNegativationId || `neg_sbx_${Date.now()}`,
        protocolNumber: simCtrl.protocolNumber || `SER-SBX-${Date.now()}`,
        status: 'REQUESTED',
        simulated: true,
        environment: 'SANDBOX',
      };
    }
    if (endpoint.startsWith('/payments/') && method === 'GET' && !endpoint.includes('?')) {
      if ((global as any).__simulatedAsaasRemotePaymentsError) {
        throw new Error((global as any).__simulatedAsaasRemotePaymentsError);
      }
      const payId = endpoint.replace('/payments/', '').split('?')[0];
      const byId = (global as any).__simulatedAsaasRemotePayments?.[payId];
      if (byId) {
        return byId;
      }
      return { id: payId, status: 'PENDING', simulated: true };
    }
    if (endpoint.startsWith('/payments?externalReference=')) {
      if ((global as any).__simulatedAsaasRemotePaymentsError) {
        throw new Error((global as any).__simulatedAsaasRemotePaymentsError);
      }
      const parts = endpoint.split('externalReference=');
      const ref = decodeURIComponent(parts[1] || '');
      const simulatedPayment = (global as any).__simulatedAsaasRemotePayments?.[ref];
      if (simulatedPayment) {
        return {
          totalCount: 1,
          data: [simulatedPayment],
          simulated: true,
        };
      }
      return { totalCount: 0, data: [], simulated: true };
    }
    return { id: `sim_${Date.now()}`, status: 'CONFIRMED', simulated: true };
  }

  if (!config.apiKey) {
    throw new Error('Chave de API do Asaas não configurada para este ambiente.');
  }

  const baseUrl = getAsaasBaseUrl(config.mode);
  const url = `${baseUrl}${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'access_token': config.apiKey,
    'User-Agent': 'LumoraSystem-CentralFotografica/1.0',
  };

  const options: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(15000),
  };

  if (body && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const responseText = await response.text();

  let responseData: any;
  try {
    responseData = JSON.parse(responseText);
  } catch {
    responseData = { raw: responseText };
  }

  if (!response.ok) {
    const errorMsg = responseData?.errors?.[0]?.description || responseData?.message || responseText || `HTTP ${response.status}`;
    const err: any = new Error(`Erro na API do Asaas (${response.status}): ${errorMsg}`);
    err.status = response.status;
    err.data = responseData;
    throw err;
  }

  return responseData;
}

/**
 * Cadastra ou atualiza o cliente no Asaas (apenas dados do Responsável Legal)
 */
export async function syncAsaasCustomer(
  companyId: string,
  input: AsaasCustomerInput
): Promise<string> {
  const config = await getCompanyAsaasConfig(companyId);
  if (config.mode === 'DISABLED') {
    return 'cus_disabled_dummy';
  }

  const cleanCpf = (input.cpfCnpj || '').replace(/\D/g, '');

  // 1. Verificar se já existe cliente cadastrado com esse CPF no Asaas
  try {
    const searchRes = await asaasRequest(config, `/customers?cpfCnpj=${cleanCpf}`);
    if (searchRes.data && searchRes.data.length > 0) {
      const existing = searchRes.data[0];
      return existing.id;
    }
  } catch (searchErr) {
    console.warn('[Asaas] Aviso ao buscar cliente por CPF:', searchErr);
  }

  // 2. Se não existir, cria novo
  const payload: any = {
    name: input.name,
    cpfCnpj: cleanCpf,
    notificationDisabled: true, // Notificações automáticas controladas pelo sistema
  };

  if (input.phone) payload.mobilePhone = input.phone.replace(/\D/g, '');
  if (input.postalCode) payload.postalCode = input.postalCode.replace(/\D/g, '');
  if (input.address) payload.address = input.address;
  if (input.addressNumber) payload.addressNumber = input.addressNumber;
  if (input.complement) payload.complement = input.complement;
  if (input.province) payload.province = input.province;
  if (input.externalReference) payload.externalReference = input.externalReference;

  const res = await asaasRequest(config, '/customers', 'POST', payload);
  return res.id;
}

/**
 * Cria cobrança no Asaas para uma parcela
 */
export async function createAsaasChargeForInstallment(
  companyId: string,
  chargeInput: AsaasChargeInput
): Promise<{
  externalId: string;
  status: string;
  nominalValueCents: number;
  netValueCents?: number;
  bankSlipUrl?: string;
  invoiceUrl?: string;
  identificationField?: string;
  pixQrCodeUrl?: string;
  pixPayload?: string;
}> {
  const config = await getCompanyAsaasConfig(companyId);
  if (config.mode === 'DISABLED') {
    return {
      externalId: `mock_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      status: 'PENDING',
      nominalValueCents: Math.round(chargeInput.value * 100),
    };
  }

  // 1. Reconciliação remota: consulta o Asaas pela externalReference antes de emitir nova cobrança
  if (chargeInput.externalReference) {
    let searchRes: any;
    try {
      searchRes = await asaasRequest(
        config,
        `/payments?externalReference=${encodeURIComponent(chargeInput.externalReference)}`
      );
    } catch (searchErr: any) {
      console.warn('[Asaas] Falha/Timeout na reconciliação remota por externalReference:', searchErr);
      throw new Error(
        `[RECONCILIAÇÃO_INCONCLUSIVA] Falha/timeout na consulta remota por externalReference ${chargeInput.externalReference}: ${searchErr.message || searchErr}. Nova emissão bloqueada.`
      );
    }

    if (!searchRes || typeof searchRes !== 'object' || !Array.isArray(searchRes.data)) {
      throw new Error(
        `[RECONCILIAÇÃO_INCONCLUSIVA] Resposta inválida na consulta remota por externalReference ${chargeInput.externalReference}. Nova emissão bloqueada.`
      );
    }

    // Filtrar cobrança compatível com a empresa e status ativo (não deletada)
    const compatibleRemote = searchRes.data.find((p: any) => {
      if (!p || !p.id) return false;
      if (p.deleted === true || p.status === 'DELETED') return false;
      if (chargeInput.customerExternalId && p.customer && p.customer !== chargeInput.customerExternalId) {
        return false;
      }
      return true;
    });

    if (compatibleRemote && compatibleRemote.id) {
      console.log(
        `[Asaas] Cobrança existente compatível recuperada remotamente por externalReference ${chargeInput.externalReference}: ${compatibleRemote.id}`
      );

      let identificationField = compatibleRemote.identificationField;
      if (!identificationField) {
        try {
          const idFieldRes = await asaasRequest(config, `/payments/${compatibleRemote.id}/identificationField`);
          identificationField = idFieldRes?.identificationField;
        } catch {}
      }

      let pixQrCodeUrl: string | undefined;
      let pixPayload: string | undefined;
      try {
        const pixRes = await asaasRequest(config, `/payments/${compatibleRemote.id}/pixQrCode`);
        pixQrCodeUrl = pixRes?.encodedImage ? `data:image/png;base64,${pixRes.encodedImage}` : undefined;
        pixPayload = pixRes?.payload;
      } catch {}

      return {
        externalId: compatibleRemote.id,
        status: compatibleRemote.status || 'PENDING',
        nominalValueCents: Math.round((Number(compatibleRemote.value) || chargeInput.value) * 100),
        netValueCents: compatibleRemote.netValue ? Math.round(Number(compatibleRemote.netValue) * 100) : undefined,
        bankSlipUrl: compatibleRemote.bankSlipUrl,
        invoiceUrl: compatibleRemote.invoiceUrl,
        identificationField,
        pixQrCodeUrl,
        pixPayload,
      };
    }
  }

  const payload = {
    customer: chargeInput.customerExternalId,
    billingType: chargeInput.billingType || 'UNDEFINED',
    value: chargeInput.value,
    dueDate: chargeInput.dueDate,
    description: chargeInput.description || 'Parcela de Crediário',
    externalReference: chargeInput.externalReference,
    postalService: false,
  };

  const created = await asaasRequest(config, '/payments', 'POST', payload);
  const paymentId = created.id;

  let identificationField: string | undefined = created.identificationField;
  let pixQrCodeUrl: string | undefined;
  let pixPayload: string | undefined;

  // Buscar linha digitável se for boleto e não veio na resposta inicial
  if (!identificationField) {
    try {
      const idFieldRes = await asaasRequest(config, `/payments/${paymentId}/identificationField`);
      identificationField = idFieldRes.identificationField;
    } catch {
      // Linha digitável pode ser carregada sob demanda
    }
  }

  // Buscar QR Code Pix
  try {
    const pixRes = await asaasRequest(config, `/payments/${paymentId}/pixQrCode`);
    pixQrCodeUrl = pixRes.encodedImage ? `data:image/png;base64,${pixRes.encodedImage}` : undefined;
    pixPayload = pixRes.payload;
  } catch {
    // Pix sob demanda
  }

  return {
    externalId: paymentId,
    status: created.status || 'PENDING',
    nominalValueCents: Math.round((created.value || chargeInput.value) * 100),
    netValueCents: created.netValue ? Math.round(created.netValue * 100) : undefined,
    bankSlipUrl: created.bankSlipUrl,
    invoiceUrl: created.invoiceUrl,
    identificationField,
    pixQrCodeUrl,
    pixPayload,
  };
}

/**
 * Notifica o Asaas que um pagamento foi recebido em dinheiro/espécie manualmente
 */
export async function notifyAsaasReceiveInCash(
  companyId: string,
  asaasPaymentId: string,
  paymentDate: string,
  value: number
): Promise<any> {
  const config = await getCompanyAsaasConfigForExistingCharge(companyId, asaasPaymentId);
  if (config.mode === 'DISABLED') return { success: true };

  return asaasRequest(config, `/payments/${asaasPaymentId}/receiveInCash`, 'POST', {
    paymentDate,
    value,
    notifyCustomer: false,
  });
}

/**
 * Atualiza valor ou vencimento de cobrança no Asaas
 */
export async function updateAsaasPayment(
  companyId: string,
  asaasPaymentId: string,
  data: { value?: number; dueDate?: string }
): Promise<any> {
  const config = await getCompanyAsaasConfigForExistingCharge(companyId, asaasPaymentId);
  if (config.mode === 'DISABLED') return { success: true };

  return asaasRequest(config, `/payments/${asaasPaymentId}`, 'POST', data);
}

/**
 * Cancela cobrança no Asaas
 */
export async function cancelAsaasPayment(
  companyId: string,
  asaasPaymentId: string
): Promise<any> {
  const config = await getCompanyAsaasConfigForExistingCharge(companyId, asaasPaymentId);
  if (config.mode === 'DISABLED') return { success: true };

  try {
    return await asaasRequest(config, `/payments/${asaasPaymentId}`, 'DELETE');
  } catch (err: any) {
    console.warn(`[Asaas] Aviso ao cancelar cobrança ${asaasPaymentId}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Solicita estorno/devolução de cobrança paga no Asaas
 */
export async function refundAsaasPayment(
  companyId: string,
  asaasPaymentId: string,
  value?: number,
  description?: string
): Promise<any> {
  const config = await getCompanyAsaasConfigForExistingCharge(companyId, asaasPaymentId);
  if (config.mode === 'DISABLED') {
    return { status: 'REFUND_PROCESSING', mode: 'DISABLED' };
  }

  return asaasRequest(config, `/payments/${asaasPaymentId}/refund`, 'POST', {
    ...(value !== undefined ? { value } : {}),
    ...(description ? { description } : {}),
  });
}

/**
 * Enfileira uma ação de sincronização bancária na fila persistente
 */
export async function enqueueAsaasSync(params: {
  companyId: string;
  agreementId: string;
  installmentId?: string | null;
  action: 'CREATE_CUSTOMER' | 'CREATE_CHARGE' | 'UPDATE_CHARGE' | 'CANCEL_CHARGE' | 'RECEIVE_IN_CASH';
  payload: any;
  idempotencyKey: string;
}): Promise<void> {
  try {
    let enrichedPayload = params.payload;
    if (params.action === 'CREATE_CHARGE' && params.payload && typeof params.payload === 'object' && !params.payload.__originMeta) {
      const activeConfig = await getCompanyAsaasConfig(params.companyId);
      if (activeConfig.mode !== 'DISABLED') {
        enrichedPayload = {
          ...params.payload,
          __originMeta: {
            environment: activeConfig.environment || activeConfig.mode,
            walletId: activeConfig.walletId || null,
            accountName: activeConfig.accountName || null,
            integrationId: activeConfig.integrationId || null,
          },
        };
      }
    }

    await prisma.asaasSyncQueue.upsert({
      where: { idempotencyKey: params.idempotencyKey },
      create: {
        companyId: params.companyId,
        agreementId: params.agreementId,
        installmentId: params.installmentId,
        action: params.action,
        payload: enrichedPayload,
        status: 'PENDING',
        idempotencyKey: params.idempotencyKey,
      },
      update: {
        payload: enrichedPayload,
        status: 'PENDING',
      },
    });
  } catch (err: any) {
    console.error('[Asaas Queue] Erro ao enfileirar sincronização:', err);
  }
}

/**
 * Processador da fila de sincronização persistente do Asaas
 * - Recuperação de tarefas interrompidas (stalled tasks)
 * - Captura atômica de tarefas
 * - Respeito ao modo operacional (não marca SUCCESS se DISABLED)
 * - Reconciliação de respostas perdidas para evitar duplicação de cobranças
 */
export async function processAsaasSyncQueue(limit = 10): Promise<{ processed: number; errors: number }> {
  // 1. Recuperação de tarefas interrompidas (stalled tasks > 5 minutos em PROCESSING)
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  try {
    await prisma.asaasSyncQueue.updateMany({
      where: {
        status: 'PROCESSING',
        updatedAt: { lt: fiveMinutesAgo },
      },
      data: {
        status: 'PENDING',
      },
    });
  } catch (recErr) {
    console.warn('[Asaas Queue] Aviso ao recuperar tarefas interrompidas:', recErr);
  }

  // 2. Captura exclusiva no banco com FOR UPDATE SKIP LOCKED
  const pendingItems = await prisma.$transaction(async (tx) => {
    const captured: Array<any> = await tx.$queryRaw`
      WITH selected AS (
        SELECT id
        FROM "AsaasSyncQueue"
        WHERE status = 'PENDING' AND attempts < 5
        ORDER BY "createdAt" ASC, id ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "AsaasSyncQueue" q
      SET status = 'PROCESSING', "updatedAt" = (NOW() AT TIME ZONE 'UTC')
      FROM selected
      WHERE q.id = selected.id
      RETURNING q.*;
    `;

    return captured || [];
  });

  let processed = 0;
  let errors = 0;

  for (const item of pendingItems) {
    try {
      const p: any = typeof item.payload === 'string' ? JSON.parse(item.payload) : (item.payload || {});
      const isExistingChargeMutation =
        (item.action === 'RECEIVE_IN_CASH' || item.action === 'UPDATE_CHARGE' || item.action === 'CANCEL_CHARGE') &&
        Boolean(p.asaasPaymentId);

      const config = isExistingChargeMutation
        ? await getCompanyAsaasConfigForExistingCharge(item.companyId, p.asaasPaymentId)
        : await getCompanyAsaasConfig(item.companyId);

      // Regra estrita: NÃO considerar tarefa bancária executada quando estiver desativada
      if (config.mode === 'DISABLED') {
        await prisma.asaasSyncQueue.update({
          where: { id: item.id },
          data: {
            status: 'PENDING_ACTIVATION',
            lastError: 'Integração bancária Asaas está DESATIVADA ou conta emissora divergente. Tarefa mantida pendente de ativação.',
          },
        });
        continue;
      }

      switch (item.action) {
        case 'CREATE_CUSTOMER': {
          await syncAsaasCustomer(item.companyId, p);
          break;
        }
        case 'CREATE_CHARGE': {
          // Reconciliação de respostas perdidas: verifica se cobrança já existe antes de emitir nova
          let res: any;
          if (item.installmentId) {
            const existing = await prisma.asaasCharge.findUnique({
              where: { installmentId: item.installmentId },
            });
            if (existing && existing.externalId) {
              res = {
                externalId: existing.externalId,
                status: existing.status,
                nominalValueCents: existing.nominalValueCents,
                netValueCents: existing.netValueCents,
                bankSlipUrl: existing.bankSlipUrl,
                invoiceUrl: existing.invoiceUrl,
                identificationField: existing.identificationField,
                pixQrCodeUrl: existing.pixQrCodeUrl,
                pixPayload: existing.pixPayload,
              };
            }
          }

          if (!res) {
            if (!p.externalReference && item.installmentId) {
              p.externalReference = item.installmentId;
            }
            res = await createAsaasChargeForInstallment(item.companyId, p);
          }

          if (item.installmentId) {
            await prisma.asaasCharge.upsert({
              where: { installmentId: item.installmentId },
              create: {
                companyId: item.companyId,
                agreementId: item.agreementId,
                installmentId: item.installmentId,
                externalId: res.externalId,
                customerExternalId: p.customerExternalId,
                billingType: p.billingType || 'UNDEFINED',
                status: res.status,
                nominalValueCents: res.nominalValueCents,
                netValueCents: res.netValueCents,
                dueDate: new Date(p.dueDate),
                bankSlipUrl: res.bankSlipUrl,
                invoiceUrl: res.invoiceUrl,
                identificationField: res.identificationField,
                pixQrCodeUrl: res.pixQrCodeUrl,
                pixPayload: res.pixPayload,
              },
              update: {
                externalId: res.externalId,
                status: res.status,
                nominalValueCents: res.nominalValueCents,
                netValueCents: res.netValueCents,
                bankSlipUrl: res.bankSlipUrl,
                invoiceUrl: res.invoiceUrl,
                identificationField: res.identificationField,
                pixQrCodeUrl: res.pixQrCodeUrl,
                pixPayload: res.pixPayload,
              },
            });
          }
          break;
        }
        case 'RECEIVE_IN_CASH': {
          await notifyAsaasReceiveInCash(item.companyId, p.asaasPaymentId, p.paymentDate, p.value);
          break;
        }
        case 'UPDATE_CHARGE': {
          await updateAsaasPayment(item.companyId, p.asaasPaymentId, p.data);
          break;
        }
        case 'CANCEL_CHARGE': {
          await cancelAsaasPayment(item.companyId, p.asaasPaymentId);
          break;
        }
      }

      await prisma.asaasSyncQueue.update({
        where: { id: item.id },
        data: {
          status: 'SUCCESS',
          ...(item.action === 'CREATE_CHARGE' && !p.__originMeta
            ? {
                payload: {
                  ...p,
                  __originMeta: {
                    environment: config.environment || config.mode,
                    walletId: config.walletId || null,
                    accountName: config.accountName || null,
                    integrationId: config.integrationId || null,
                  },
                },
              }
            : {}),
        },
      });
      processed++;
    } catch (err: any) {
      errors++;
      const isInconclusive = String(err.message || '').includes('[RECONCILIAÇÃO_INCONCLUSIVA]');
      await prisma.asaasSyncQueue.update({
        where: { id: item.id },
        data: {
          status: isInconclusive ? 'PENDING' : (item.attempts + 1 >= item.maxAttempts ? 'FAILED' : 'PENDING'),
          attempts: item.attempts + 1,
          lastError: err.message || String(err),
        },
      });
    }
  }

  return { processed, errors };
}

// ============================================================================
// ETAPA 5 · ADAPTADOR SEGURO SERASA / DUPLA CONFERÊNCIA EM SANDBOX (NUNCA LIVE)
// ============================================================================

const ASAAS_PAID_STATUSES = new Set([
  'RECEIVED',
  'CONFIRMED',
  'RECEIVED_IN_CASH',
  'DUNNING_RECEIVED',
]);

const ASAAS_REPLACED_OR_INVALID_STATUSES = new Set([
  'REFUNDED',
  'DELETED',
  'CHARGEBACK_REQUESTED',
  'CHARGEBACK_DISPUTE',
  'AWAITING_CHARGEBACK_REVERSAL',
]);

/**
 * Garante que operações de negativação Serasa NUNCA ativem Asaas LIVE/Produção.
 */
export function assertSerasaSandboxEnvironment(requestedEnvironment?: string | null): 'SANDBOX' {
  const normalized = String(requestedEnvironment || 'SANDBOX').trim().toUpperCase();
  if (normalized === 'PRODUCTION' || normalized === 'LIVE' || normalized === 'PROD') {
    const err: any = new Error(
      'A ativação do Serasa/Asaas em Produção permanece bloqueada por segurança neste ambiente. Utilize apenas Sandbox.'
    );
    err.status = 403;
    err.code = 'SERASA_PRODUCTION_LOCKED';
    throw err;
  }
  return 'SANDBOX';
}

export interface AsaasDualBalanceResult {
  environment: 'SANDBOX';
  mode: string;
  asaasConfiguredInSandbox: boolean;
  hasLocalAsaasCharges: boolean;
  dualCheckPassed: boolean;
  blockCode: string | null;
  blockMessage: string | null;
  asaasVerifiedBalanceCents: number | null;
  checkedInstallmentsCount: number;
  paidExternallyDetected: boolean;
  replacedOrCancelledChargeDetected: boolean;
  details: Array<{
    installmentId: string;
    externalId: string | null;
    localStatus: string | null;
    remoteStatus: string | null;
    remoteValueCents: number | null;
    lumoraOpenCents: number;
    consistent: boolean;
    note?: string;
  }>;
}

/**
 * Dupla conferência automática de cobranças no Asaas apenas em SANDBOX (nunca LIVE).
 * Identifica cobranças já pagas no gateway (RECEIVED/CONFIRMED/RECEIVED_IN_CASH/DUNNING_RECEIVED)
 * ou substituídas/canceladas antes de permitir envio para negativação Serasa.
 */
export async function checkAsaasChargesBalanceForAgreement(
  companyId: string,
  params: {
    agreementId: string;
    lumoraRemainingTotalCents: number;
    installments: Array<{
      id: string;
      status: string;
      amountCents: number;
      paidCents: number;
      asaasCharge?: {
        id: string;
        externalId: string;
        status: string;
        nominalValueCents: number;
      } | null;
    }>;
  }
): Promise<AsaasDualBalanceResult> {
  assertSerasaSandboxEnvironment('SANDBOX');

  // Nunca solicita 'PRODUCTION'; restringe explicitamente a 'SANDBOX'.
  const sandboxConfig = await getCompanyAsaasConfig(companyId, 'SANDBOX');
  const isTestSimulation =
    process.env.EXTERNAL_SERVICES_DISABLED === 'true' || process.env.NODE_ENV === 'test';

  const openInstallments = params.installments.filter(
    (i) => i.status !== 'PAID' && i.status !== 'RENEGOTIATED' && Math.max(0, i.amountCents - i.paidCents) > 0
  );
  const localChargesCount = openInstallments.filter((i) => Boolean(i.asaasCharge)).length;
  const hasLocalAsaasCharges = localChargesCount > 0;

  const details: AsaasDualBalanceResult['details'] = [];
  let paidExternallyDetected = false;
  let replacedOrCancelledChargeDetected = false;
  let remoteCheckFailedMessage: string | null = null;
  let aggregatedAsaasOpenCents = 0;
  let hasRemoteOrLocalValueData = false;

  const effectiveRequestConfig: AsaasConfigData | null =
    sandboxConfig.mode === 'SANDBOX'
      ? sandboxConfig
      : isTestSimulation
      ? { mode: 'SANDBOX', apiKey: null, webhookToken: null, environment: 'SANDBOX' }
      : null;

  for (const inst of openInstallments) {
    const lumoraOpenCents = Math.max(0, inst.amountCents - inst.paidCents);
    const localCharge = inst.asaasCharge || null;
    const localStatus = localCharge?.status || null;
    let remoteStatus: string | null = null;
    let remoteValueCents: number | null = localCharge ? localCharge.nominalValueCents : null;
    let consistent = true;
    let note: string | undefined;

    if (localStatus && ASAAS_PAID_STATUSES.has(localStatus)) {
      paidExternallyDetected = true;
      consistent = false;
      note = `Cobrança local Asaas (${localCharge?.externalId}) já consta como ${localStatus}.`;
    } else if (localStatus && ASAAS_REPLACED_OR_INVALID_STATUSES.has(localStatus)) {
      replacedOrCancelledChargeDetected = true;
      consistent = false;
      note = `Cobrança local Asaas (${localCharge?.externalId}) está cancelada/estornada (${localStatus}).`;
    }

    if (consistent && effectiveRequestConfig) {
      const shouldQueryRemote =
        Boolean(localCharge?.externalId) ||
        sandboxConfig.mode === 'SANDBOX' ||
        Boolean((global as any).__simulatedAsaasRemotePayments) ||
        Boolean((global as any).__simulatedAsaasRemotePaymentsError);

      if (shouldQueryRemote) {
        try {
          const byRef = await asaasRequest(
            effectiveRequestConfig,
            `/payments?externalReference=${encodeURIComponent(`inst_${inst.id}`)}`,
            'GET'
          );
          let remotePay = Array.isArray(byRef?.data) && byRef.data.length > 0 ? byRef.data[0] : null;

          if (!remotePay && localCharge?.externalId) {
            const byId = await asaasRequest(
              effectiveRequestConfig,
              `/payments/${encodeURIComponent(localCharge.externalId)}`,
              'GET'
            );
            if (byId && byId.id) {
              remotePay = byId;
            }
          }

          if (remotePay && remotePay.status) {
            remoteStatus = String(remotePay.status).toUpperCase();
            if (remotePay.value !== undefined && remotePay.value !== null) {
              remoteValueCents = Math.round(Number(remotePay.value) * 100);
            }

            if (ASAAS_PAID_STATUSES.has(remoteStatus)) {
              paidExternallyDetected = true;
              consistent = false;
              note = `Pagamento detectado no Asaas Sandbox (${remoteStatus}) para parcela ${inst.id}.`;
            } else if (ASAAS_REPLACED_OR_INVALID_STATUSES.has(remoteStatus)) {
              replacedOrCancelledChargeDetected = true;
              consistent = false;
              note = `Cobrança no Asaas Sandbox substituída/estornada (${remoteStatus}).`;
            } else if (remoteValueCents !== null && remoteValueCents !== lumoraOpenCents) {
              replacedOrCancelledChargeDetected = true;
              consistent = false;
              note = `Divergência de saldo entre Lumora (${lumoraOpenCents}c) e Asaas Sandbox (${remoteValueCents}c).`;
            }
          }
        } catch (err: any) {
          remoteCheckFailedMessage = err?.message || 'Erro ao consultar Asaas Sandbox.';
          consistent = false;
          note = remoteCheckFailedMessage || undefined;
        }
      }
    }

    if (remoteValueCents !== null) {
      hasRemoteOrLocalValueData = true;
      aggregatedAsaasOpenCents += consistent && !paidExternallyDetected ? remoteValueCents : 0;
    }

    details.push({
      installmentId: inst.id,
      externalId: localCharge?.externalId || null,
      localStatus,
      remoteStatus,
      remoteValueCents,
      lumoraOpenCents,
      consistent,
      ...(note ? { note } : {}),
    });
  }

  // Caso haja cobranças Asaas vinculadas em produção real e Sandbox esteja indisponível sem modo teste:
  if (
    hasLocalAsaasCharges &&
    sandboxConfig.mode !== 'SANDBOX' &&
    !isTestSimulation &&
    !paidExternallyDetected &&
    !replacedOrCancelledChargeDetected
  ) {
    return {
      environment: 'SANDBOX',
      mode: sandboxConfig.mode,
      asaasConfiguredInSandbox: false,
      hasLocalAsaasCharges,
      dualCheckPassed: false,
      blockCode: 'ASAAS_SANDBOX_NOT_CONFIGURED_FOR_CHARGED_AGREEMENT',
      blockMessage:
        'Contrato possui boletos/cobranças Asaas vinculadas, mas o adaptador Sandbox está desativado para dupla conferência.',
      asaasVerifiedBalanceCents: null,
      checkedInstallmentsCount: openInstallments.length,
      paidExternallyDetected,
      replacedOrCancelledChargeDetected,
      details,
    };
  }

  if (paidExternallyDetected) {
    return {
      environment: 'SANDBOX',
      mode: sandboxConfig.mode,
      asaasConfiguredInSandbox: sandboxConfig.mode === 'SANDBOX',
      hasLocalAsaasCharges,
      dualCheckPassed: false,
      blockCode: 'EXTERNAL_OR_INTERNAL_PAYMENT_DETECTED',
      blockMessage:
        'Dupla conferência bloqueou a negativação: uma ou mais parcelas constam como pagas no Asaas.',
      asaasVerifiedBalanceCents: hasRemoteOrLocalValueData ? aggregatedAsaasOpenCents : 0,
      checkedInstallmentsCount: openInstallments.length,
      paidExternallyDetected: true,
      replacedOrCancelledChargeDetected,
      details,
    };
  }

  if (replacedOrCancelledChargeDetected) {
    return {
      environment: 'SANDBOX',
      mode: sandboxConfig.mode,
      asaasConfiguredInSandbox: sandboxConfig.mode === 'SANDBOX',
      hasLocalAsaasCharges,
      dualCheckPassed: false,
      blockCode: 'ASAAS_BALANCE_OR_CHARGE_DIVERGENCE',
      blockMessage:
        'Dupla conferência bloqueou a negativação: há divergência de saldo ou cobrança cancelada/substituída no Asaas.',
      asaasVerifiedBalanceCents: hasRemoteOrLocalValueData ? aggregatedAsaasOpenCents : null,
      checkedInstallmentsCount: openInstallments.length,
      paidExternallyDetected,
      replacedOrCancelledChargeDetected: true,
      details,
    };
  }

  if (remoteCheckFailedMessage) {
    return {
      environment: 'SANDBOX',
      mode: sandboxConfig.mode,
      asaasConfiguredInSandbox: sandboxConfig.mode === 'SANDBOX',
      hasLocalAsaasCharges,
      dualCheckPassed: false,
      blockCode: 'ASAAS_REMOTE_CHECK_FAILED',
      blockMessage: `Falha na dupla conferência remota com Asaas Sandbox: ${remoteCheckFailedMessage}`,
      asaasVerifiedBalanceCents: null,
      checkedInstallmentsCount: openInstallments.length,
      paidExternallyDetected: false,
      replacedOrCancelledChargeDetected: false,
      details,
    };
  }

  const verifiedAsaasCents = hasRemoteOrLocalValueData
    ? aggregatedAsaasOpenCents
    : params.lumoraRemainingTotalCents;

  return {
    environment: 'SANDBOX',
    mode: hasLocalAsaasCharges || sandboxConfig.mode === 'SANDBOX' ? 'SANDBOX' : 'INTERNAL_CREDIARIO_SANDBOX',
    asaasConfiguredInSandbox: sandboxConfig.mode === 'SANDBOX',
    hasLocalAsaasCharges,
    dualCheckPassed: true,
    blockCode: null,
    blockMessage: null,
    asaasVerifiedBalanceCents: verifiedAsaasCents,
    checkedInstallmentsCount: openInstallments.length,
    paidExternallyDetected: false,
    replacedOrCancelledChargeDetected: false,
    details,
  };
}

/**
 * Envia solicitação de inclusão/negativação Serasa exclusivamente via Sandbox / simulador seguro.
 * NUNCA ativa LIVE nem expõe chaves de API.
 */
export async function sendAsaasSerasaNegativationRequest(
  companyId: string,
  payload: {
    agreementId: string;
    buyerCpf: string;
    buyerName: string;
    overdueAmountCents: number;
    externalChargeId?: string | null;
    idempotencyKey: string;
    requestedEnvironment?: string | null;
  }
): Promise<{
  accepted: boolean;
  refused: boolean;
  status: string;
  protocolNumber: string;
  externalNegativationId: string | null;
  refusalReason: string | null;
  environment: 'SANDBOX';
  simulated: boolean;
}> {
  assertSerasaSandboxEnvironment(payload.requestedEnvironment);

  const sandboxConfig = await getCompanyAsaasConfig(companyId, 'SANDBOX');
  const isTestSimulation =
    process.env.EXTERNAL_SERVICES_DISABLED === 'true' || process.env.NODE_ENV === 'test';

  if (sandboxConfig.mode !== 'SANDBOX' && !isTestSimulation) {
    // Em ambiente local/homologação sem chave real do birô, registra protocolo Sandbox auditado sem nunca chamar LIVE.
    return {
      accepted: true,
      refused: false,
      status: 'REQUESTED',
      protocolNumber: `SER-SBX-${payload.agreementId.slice(0, 8).toUpperCase()}-${Date.now()}`,
      externalNegativationId: `sbx_${payload.agreementId.slice(0, 8)}_${Date.now()}`,
      refusalReason: null,
      environment: 'SANDBOX',
      simulated: true,
    };
  }

  const reqConfig: AsaasConfigData =
    sandboxConfig.mode === 'SANDBOX'
      ? sandboxConfig
      : { mode: 'SANDBOX', apiKey: null, webhookToken: null, environment: 'SANDBOX' };

  const resp = await asaasRequest(reqConfig, '/negativations', 'POST', {
    agreementId: payload.agreementId,
    payment: payload.externalChargeId || undefined,
    customerCpfCnpj: payload.buyerCpf.replace(/\D/g, ''),
    customerName: payload.buyerName,
    value: Number((payload.overdueAmountCents / 100).toFixed(2)),
    externalReference: `serasa_${payload.agreementId}_${payload.idempotencyKey.slice(0, 24)}`,
  });

  if (resp?.status === 'REFUSED' || resp?.accepted === false) {
    return {
      accepted: false,
      refused: true,
      status: 'REFUSED',
      protocolNumber: String(resp?.protocolNumber || `SER-REF-SBX-${Date.now()}`),
      externalNegativationId: resp?.id ? String(resp.id) : null,
      refusalReason: String(resp?.refusalReason || 'Recusado na pré-validação do birô (Sandbox).'),
      environment: 'SANDBOX',
      simulated: Boolean(resp?.simulated ?? true),
    };
  }

  return {
    accepted: true,
    refused: false,
    status: String(resp?.status || 'REQUESTED'),
    protocolNumber: String(resp?.protocolNumber || `SER-SBX-${Date.now()}`),
    externalNegativationId: resp?.id ? String(resp.id) : null,
    refusalReason: null,
    environment: 'SANDBOX',
    simulated: Boolean(resp?.simulated ?? true),
  };
}

/**
 * Solicita baixa/exclusão de negativação Serasa (Súmula 548 STJ) em Sandbox.
 */
export async function sendAsaasSerasaNegativationRemoval(
  companyId: string,
  payload: {
    recordId: string;
    agreementId: string;
    externalNegativationId?: string | null;
    reason: string;
    idempotencyKey: string;
  }
): Promise<{
  removed: boolean;
  removalProtocolNumber: string;
  environment: 'SANDBOX';
  simulated: boolean;
}> {
  assertSerasaSandboxEnvironment('SANDBOX');

  const sandboxConfig = await getCompanyAsaasConfig(companyId, 'SANDBOX');
  const isTestSimulation =
    process.env.EXTERNAL_SERVICES_DISABLED === 'true' || process.env.NODE_ENV === 'test';

  if (sandboxConfig.mode !== 'SANDBOX' && !isTestSimulation) {
    return {
      removed: true,
      removalProtocolNumber: `SER-REM-SBX-${payload.recordId.slice(0, 8).toUpperCase()}-${Date.now()}`,
      environment: 'SANDBOX',
      simulated: true,
    };
  }

  const reqConfig: AsaasConfigData =
    sandboxConfig.mode === 'SANDBOX'
      ? sandboxConfig
      : { mode: 'SANDBOX', apiKey: null, webhookToken: null, environment: 'SANDBOX' };

  const resp = await asaasRequest(reqConfig, '/negativations/remove', 'POST', {
    recordId: payload.recordId,
    agreementId: payload.agreementId,
    externalNegativationId: payload.externalNegativationId || undefined,
    reason: payload.reason,
    idempotencyKey: payload.idempotencyKey,
  });

  return {
    removed: Boolean(resp?.removed ?? true),
    removalProtocolNumber: String(resp?.removalProtocolNumber || `SER-REM-SBX-${Date.now()}`),
    environment: 'SANDBOX',
    simulated: Boolean(resp?.simulated ?? true),
  };
}

