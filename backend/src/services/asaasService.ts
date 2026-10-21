/**
 * Serviço de Integração Bancária Asaas (Boleto, Pix e Carnê com Blindagem Jurídica)
 * Compatível com SANDBOX e PRODUÇÃO, com modos de operação explícitos e fila persistente.
 * 
 * DIRETRIZ LGPD: NUNCA envia dados ou fotos de crianças para o Asaas. Apenas dados do Responsável Legal.
 */

import { PrismaClient } from '@prisma/client';

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
}

/**
 * Obtém a URL base de acordo com o modo configurado
 */
export function getAsaasBaseUrl(mode: AsaasMode): string {
  if (mode === 'SANDBOX') {
    return 'https://sandbox.asaas.com/api/v3';
  }
  return 'https://api.asaas.com/v3';
}

/**
 * Recupera as configurações do Asaas para uma empresa
 */
export async function getCompanyAsaasConfig(companyId: string): Promise<AsaasConfigData> {
  const config = await prisma.asaasConfig.findUnique({
    where: { companyId },
  });

  if (!config) {
    return {
      mode: 'DISABLED',
      apiKey: process.env.ASAAS_API_KEY || null,
      webhookToken: process.env.ASAAS_WEBHOOK_TOKEN || null,
    };
  }

  return {
    mode: (config.mode as AsaasMode) || 'DISABLED',
    apiKey: config.apiKey || process.env.ASAAS_API_KEY || null,
    webhookToken: config.webhookToken || process.env.ASAAS_WEBHOOK_TOKEN || null,
    walletId: config.walletId,
  };
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
      return { status: 'REFUND_PROCESSING', simulated: true };
    }
    if (endpoint.includes('/receiveInCash')) {
      return { success: true, simulated: true };
    }
    if (method === 'DELETE') {
      return { deleted: true, simulated: true };
    }
    if (endpoint.startsWith('/payments?externalReference=')) {
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
    try {
      const searchRes = await asaasRequest(
        config,
        `/payments?externalReference=${encodeURIComponent(chargeInput.externalReference)}`
      );
      const existingRemote =
        searchRes?.data && Array.isArray(searchRes.data) && searchRes.data.length > 0
          ? searchRes.data[0]
          : null;

      if (existingRemote && existingRemote.id) {
        console.log(
          `[Asaas] Cobrança existente recuperada remotamente por externalReference ${chargeInput.externalReference}: ${existingRemote.id}`
        );

        let identificationField = existingRemote.identificationField;
        if (!identificationField) {
          try {
            const idFieldRes = await asaasRequest(config, `/payments/${existingRemote.id}/identificationField`);
            identificationField = idFieldRes.identificationField;
          } catch {}
        }

        let pixQrCodeUrl: string | undefined;
        let pixPayload: string | undefined;
        try {
          const pixRes = await asaasRequest(config, `/payments/${existingRemote.id}/pixQrCode`);
          pixQrCodeUrl = pixRes.encodedImage ? `data:image/png;base64,${pixRes.encodedImage}` : undefined;
          pixPayload = pixRes.payload;
        } catch {}

        return {
          externalId: existingRemote.id,
          status: existingRemote.status || 'PENDING',
          nominalValueCents: Math.round((Number(existingRemote.value) || chargeInput.value) * 100),
          netValueCents: existingRemote.netValue ? Math.round(Number(existingRemote.netValue) * 100) : undefined,
          bankSlipUrl: existingRemote.bankSlipUrl,
          invoiceUrl: existingRemote.invoiceUrl,
          identificationField,
          pixQrCodeUrl,
          pixPayload,
        };
      }
    } catch (searchErr) {
      console.warn('[Asaas] Aviso ao consultar cobrança existente por externalReference:', searchErr);
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
  const config = await getCompanyAsaasConfig(companyId);
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
  const config = await getCompanyAsaasConfig(companyId);
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
  const config = await getCompanyAsaasConfig(companyId);
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
  const config = await getCompanyAsaasConfig(companyId);
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
    await prisma.asaasSyncQueue.upsert({
      where: { idempotencyKey: params.idempotencyKey },
      create: {
        companyId: params.companyId,
        agreementId: params.agreementId,
        installmentId: params.installmentId,
        action: params.action,
        payload: params.payload,
        status: 'PENDING',
        idempotencyKey: params.idempotencyKey,
      },
      update: {
        payload: params.payload,
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
      const config = await getCompanyAsaasConfig(item.companyId);

      // Regra estrita: NÃO considerar tarefa bancária executada quando estiver desativada
      if (config.mode === 'DISABLED') {
        await prisma.asaasSyncQueue.update({
          where: { id: item.id },
          data: {
            status: 'PENDING_ACTIVATION',
            lastError: 'Integração bancária Asaas está DESATIVADA. Tarefa mantida pendente de ativação.',
          },
        });
        continue;
      }

      const p: any = typeof item.payload === 'string' ? JSON.parse(item.payload) : (item.payload || {});

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
        data: { status: 'SUCCESS' },
      });
      processed++;
    } catch (err: any) {
      errors++;
      await prisma.asaasSyncQueue.update({
        where: { id: item.id },
        data: {
          status: item.attempts + 1 >= item.maxAttempts ? 'FAILED' : 'PENDING',
          attempts: item.attempts + 1,
          lastError: err.message || String(err),
        },
      });
    }
  }

  return { processed, errors };
}
