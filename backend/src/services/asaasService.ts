/**
 * Serviço de Integração Bancária Asaas (Boleto, Pix e Carnê com Blindagem Jurídica)
 * Compatível com SANDBOX e PRODUÇÃO, com modos de operação explícitos e fila persistente.
 * 
 * DIRETRIZ LGPD: NUNCA envia dados ou fotos de crianças para o Asaas. Apenas dados do Responsável Legal.
 */

import { PrismaClient } from '@prisma/client';
import { resolveCompanyIntegration } from './integrationResolver';

const prisma = new PrismaClient();

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
        ORDER BY "createdAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "AsaasSyncQueue" q
      SET status = 'PROCESSING', "updatedAt" = NOW()
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
