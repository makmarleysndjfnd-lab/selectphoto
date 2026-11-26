import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma';
import { recordOperationalAuditEvent } from './operationalAuditService';

export type PhotographerCommissionType = 'FIXED_PER_BOOK' | 'PERCENT_OF_SALE';
export type DiscountPolicyMode = 'SILENT_AUDIT_ALERT' | 'HARD_BLOCK';

export interface CompanyOperationalConfigValues {
  virginBookCommissionPercent: number;
  reboloBookCommissionPercent: number;
  virginCompanyCarCommissionPercent: number;
  virginOwnCarCommissionPercent: number;
  reboloCompanyCarCommissionPercent: number;
  reboloOwnCarCommissionPercent: number;
  creditInstallmentCommissionPercent: number;
  photographerCommissionType: PhotographerCommissionType;
  photographerCommissionValue: number;
  defaultBookPriceCents: number | null;
  maxSellerDiscountPercent: number;
  discountPolicyMode: DiscountPolicyMode;
  creditMinDownPaymentPercent: number;
  creditMaxInstallments: number;
  creditLateInterestMonthlyPercent: number;
  creditLateFinePercent: number;
  creditDaysToCollectionQueue: number;
  creditDaysToSerasaEligible: number;
  maxBatchReturnDays: number;
  maxSimultaneousBooksPerSeller: number | null;
  whatsappCreditCollectionTemplate: string | null;
  whatsappAdvanceNoticeTemplate: string | null;
  whatsappPostSaleTemplate: string | null;
  companyLogoUrl: string | null;
  sacPhone: string | null;
  sacWhatsapp: string | null;
  qrReceiptFooterText: string | null;
  qrShowLogo: boolean;
  qrShowTradeName: boolean;
  qrShowSacContact: boolean;
  qrShowSellerName: boolean;
  qrShowPhotographerName: boolean;
  qrShowPaymentMethod: boolean;
  qrShowSaleValue: boolean;
  qrShowInstallmentSummary: boolean;
  qrShowBatchAndBookCode: boolean;
  qrShowRatingForm: boolean;
  qrShowFooterText: boolean;
}

export interface WhatsAppDefaultTemplates {
  creditCollection: string;
  advanceNotice: string;
  postSale: string;
}

export interface CompanyOperationalConfigDTO extends CompanyOperationalConfigValues {
  companyId: string;
  isDefault: boolean;
  defaultTemplates: WhatsAppDefaultTemplates;
  updatedById: string | null;
  updatedAt: string | null;
}

export const DEFAULT_WHATSAPP_CREDIT_COLLECTION_TEMPLATE =
  'Olá, {cliente}! Aqui é da equipe {empresa}. Passando para lembrar da parcela no valor de {valor}, com vencimento em {vencimento}. Para pagamento via Pix, utilize a chave: {pix}. Qualquer dúvida estamos à disposição!';

export const DEFAULT_WHATSAPP_ADVANCE_NOTICE_TEMPLATE =
  'Olá, {cliente}! Segue a atualização da sua conta corrente de vales/pendências com a {empresa}. Saldo atual em aberto: {valor} (referência: {vencimento}). Caso precise acertar via Pix, utilize a chave: {pix}.';

export const DEFAULT_WHATSAPP_POST_SALE_TEMPLATE =
  'Olá, {cliente}! Obrigado pela sua compra de {valor} com a {empresa}! Caso precise de atendimento ou segunda via, estamos à disposição.';

export const DEFAULT_WHATSAPP_TEMPLATES: WhatsAppDefaultTemplates = {
  creditCollection: DEFAULT_WHATSAPP_CREDIT_COLLECTION_TEMPLATE,
  advanceNotice: DEFAULT_WHATSAPP_ADVANCE_NOTICE_TEMPLATE,
  postSale: DEFAULT_WHATSAPP_POST_SALE_TEMPLATE,
};

export const DEFAULT_COMPANY_OPERATIONAL_CONFIG: CompanyOperationalConfigValues = {
  virginBookCommissionPercent: 20.0,
  reboloBookCommissionPercent: 40.0,
  virginCompanyCarCommissionPercent: 20.0,
  virginOwnCarCommissionPercent: 25.0,
  reboloCompanyCarCommissionPercent: 40.0,
  reboloOwnCarCommissionPercent: 50.0,
  creditInstallmentCommissionPercent: 10.0,
  photographerCommissionType: 'FIXED_PER_BOOK',
  photographerCommissionValue: 0,
  defaultBookPriceCents: null,
  maxSellerDiscountPercent: 15.0,
  discountPolicyMode: 'SILENT_AUDIT_ALERT',
  creditMinDownPaymentPercent: 20.0,
  creditMaxInstallments: 6,
  creditLateInterestMonthlyPercent: 2.0,
  creditLateFinePercent: 2.0,
  creditDaysToCollectionQueue: 5,
  creditDaysToSerasaEligible: 30,
  maxBatchReturnDays: 15,
  maxSimultaneousBooksPerSeller: null,
  whatsappCreditCollectionTemplate: null,
  whatsappAdvanceNoticeTemplate: null,
  whatsappPostSaleTemplate: null,
  companyLogoUrl: null,
  sacPhone: null,
  sacWhatsapp: null,
  qrReceiptFooterText: null,
  qrShowLogo: true,
  qrShowTradeName: true,
  qrShowSacContact: true,
  qrShowSellerName: true,
  qrShowPhotographerName: true,
  qrShowPaymentMethod: true,
  qrShowSaleValue: true,
  qrShowInstallmentSummary: true,
  qrShowBatchAndBookCode: true,
  qrShowRatingForm: true,
  qrShowFooterText: true,
};

function sanitizeOptionalString(raw: unknown, maxLen: number): string | null {
  if (raw === undefined || raw === null) return null;
  const cleaned = String(raw)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .trim()
    .slice(0, maxLen);
  return cleaned.length > 0 ? cleaned : null;
}

function parsePercent(
  raw: unknown,
  fallback: number,
  field: string,
  strict: boolean
): number {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return fallback;
  }
  const num = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(num) || num < 0 || num > 100) {
    if (strict) {
      throw Object.assign(
        new Error(`${field} deve estar entre 0% e 100%.`),
        { status: 400 }
      );
    }
    return fallback;
  }
  return Number(num.toFixed(2));
}

function parseNonNegativeFloat(
  raw: unknown,
  fallback: number,
  max: number,
  field: string,
  strict: boolean
): number {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return fallback;
  }
  const num = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(num) || num < 0 || num > max) {
    if (strict) {
      throw Object.assign(
        new Error(`${field} deve estar entre 0 e ${max}.`),
        { status: 400 }
      );
    }
    return fallback;
  }
  return Number(num.toFixed(2));
}

function parseOptionalPositiveInt(
  raw: unknown,
  min: number,
  max: number,
  field: string,
  strict: boolean
): number | null {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return null;
  }
  const num = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < min || num > max) {
    if (strict) {
      throw Object.assign(
        new Error(`${field} deve ser um número inteiro entre ${min} e ${max}.`),
        { status: 400 }
      );
    }
    return null;
  }
  return num;
}

function parseBoundedInt(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
  field: string,
  strict: boolean
): number {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return fallback;
  }
  const num = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < min || num > max) {
    if (strict) {
      throw Object.assign(
        new Error(`${field} deve ser um número inteiro entre ${min} e ${max}.`),
        { status: 400 }
      );
    }
    return fallback;
  }
  return num;
}

function parseBool(raw: unknown, fallback: boolean): boolean {
  if (raw === undefined || raw === null) return fallback;
  return Boolean(raw);
}

/**
 * Renderiza com segurança um modelo de WhatsApp substituindo as variáveis:
 * {cliente}, {valor}, {vencimento}, {pix} e {empresa}.
 */
export function renderWhatsAppTemplate(
  template: string | null | undefined,
  variables: {
    cliente?: string | null;
    valor?: string | null;
    vencimento?: string | null;
    pix?: string | null;
    empresa?: string | null;
  },
  fallbackTemplate: string = DEFAULT_WHATSAPP_CREDIT_COLLECTION_TEMPLATE
): string {
  const source =
    typeof template === 'string' && template.trim().length > 0
      ? template.trim()
      : fallbackTemplate;

  const safeVal = (val: string | null | undefined, fallback: string) => {
    const cleaned = val ? String(val).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim() : '';
    return cleaned.length > 0 ? cleaned : fallback;
  };

  const replacements: Record<string, string> = {
    '{cliente}': safeVal(variables.cliente, 'Cliente'),
    '{valor}': safeVal(variables.valor, 'R$ 0,00'),
    '{vencimento}': safeVal(variables.vencimento, 'a combinar'),
    '{pix}': safeVal(variables.pix, 'solicite com a equipe'),
    '{empresa}': safeVal(variables.empresa, 'Lumora'),
  };

  return source.replace(/\{(cliente|valor|vencimento|pix|empresa)\}/gi, (match) => {
    const key = match.toLowerCase();
    return replacements[key] ?? match;
  });
}

export function normalizeCompanyOperationalConfigValues(
  raw: any,
  strict = false
): CompanyOperationalConfigValues {
  const rawPhotogType = String(
    raw?.photographerCommissionType ||
      DEFAULT_COMPANY_OPERATIONAL_CONFIG.photographerCommissionType
  )
    .trim()
    .toUpperCase();
  let photographerCommissionType: PhotographerCommissionType = 'FIXED_PER_BOOK';
  if (rawPhotogType === 'FIXED_PER_BOOK' || rawPhotogType === 'PERCENT_OF_SALE') {
    photographerCommissionType = rawPhotogType;
  } else if (strict && raw?.photographerCommissionType !== undefined) {
    throw Object.assign(
      new Error('photographerCommissionType inválido. Utilize FIXED_PER_BOOK ou PERCENT_OF_SALE.'),
      { status: 400 }
    );
  }

  const rawDiscountMode = String(
    raw?.discountPolicyMode || DEFAULT_COMPANY_OPERATIONAL_CONFIG.discountPolicyMode
  )
    .trim()
    .toUpperCase();
  let discountPolicyMode: DiscountPolicyMode = 'SILENT_AUDIT_ALERT';
  if (rawDiscountMode === 'SILENT_AUDIT_ALERT' || rawDiscountMode === 'HARD_BLOCK') {
    discountPolicyMode = rawDiscountMode;
  } else if (strict && raw?.discountPolicyMode !== undefined) {
    throw Object.assign(
      new Error('discountPolicyMode inválido. Utilize SILENT_AUDIT_ALERT ou HARD_BLOCK.'),
      { status: 400 }
    );
  }

  const maxPhotoVal = photographerCommissionType === 'PERCENT_OF_SALE' ? 100 : 10000;
  const photographerCommissionValue = parseNonNegativeFloat(
    raw?.photographerCommissionValue,
    DEFAULT_COMPANY_OPERATIONAL_CONFIG.photographerCommissionValue,
    maxPhotoVal,
    'photographerCommissionValue',
    strict
  );

  // Suporte conveniente se payload enviar defaultBookPriceBrl em R$ além de defaultBookPriceCents
  let rawDefaultPriceCents = raw?.defaultBookPriceCents;
  if (
    (rawDefaultPriceCents === undefined || rawDefaultPriceCents === null) &&
    raw?.defaultBookPriceBrl !== undefined &&
    raw?.defaultBookPriceBrl !== null &&
    String(raw.defaultBookPriceBrl).trim() !== ''
  ) {
    const brl = Number(String(raw.defaultBookPriceBrl).replace(',', '.'));
    if (Number.isFinite(brl) && brl > 0) {
      rawDefaultPriceCents = Math.round(brl * 100);
    } else if (strict && brl <= 0) {
      throw Object.assign(
        new Error('Preço padrão do book deve ser maior que zero.'),
        { status: 400 }
      );
    }
  }

  const virginCompanyCar = parsePercent(
    raw?.virginCompanyCarCommissionPercent ?? raw?.virginBookCommissionPercent,
    DEFAULT_COMPANY_OPERATIONAL_CONFIG.virginCompanyCarCommissionPercent,
    'virginCompanyCarCommissionPercent',
    strict
  );
  const virginOwnCar = parsePercent(
    raw?.virginOwnCarCommissionPercent ?? raw?.virginBookCommissionPercent,
    DEFAULT_COMPANY_OPERATIONAL_CONFIG.virginOwnCarCommissionPercent,
    'virginOwnCarCommissionPercent',
    strict
  );
  const reboloCompanyCar = parsePercent(
    raw?.reboloCompanyCarCommissionPercent ?? raw?.reboloBookCommissionPercent,
    DEFAULT_COMPANY_OPERATIONAL_CONFIG.reboloCompanyCarCommissionPercent,
    'reboloCompanyCarCommissionPercent',
    strict
  );
  const reboloOwnCar = parsePercent(
    raw?.reboloOwnCarCommissionPercent ?? raw?.reboloBookCommissionPercent,
    DEFAULT_COMPANY_OPERATIONAL_CONFIG.reboloOwnCarCommissionPercent,
    'reboloOwnCarCommissionPercent',
    strict
  );

  return {
    virginBookCommissionPercent: parsePercent(
      raw?.virginBookCommissionPercent ?? raw?.virginCompanyCarCommissionPercent,
      virginCompanyCar,
      'virginBookCommissionPercent',
      strict
    ),
    reboloBookCommissionPercent: parsePercent(
      raw?.reboloBookCommissionPercent ?? raw?.reboloCompanyCarCommissionPercent,
      reboloCompanyCar,
      'reboloBookCommissionPercent',
      strict
    ),
    virginCompanyCarCommissionPercent: virginCompanyCar,
    virginOwnCarCommissionPercent: virginOwnCar,
    reboloCompanyCarCommissionPercent: reboloCompanyCar,
    reboloOwnCarCommissionPercent: reboloOwnCar,
    creditInstallmentCommissionPercent: parsePercent(
      raw?.creditInstallmentCommissionPercent,
      DEFAULT_COMPANY_OPERATIONAL_CONFIG.creditInstallmentCommissionPercent,
      'creditInstallmentCommissionPercent',
      strict
    ),
    photographerCommissionType,
    photographerCommissionValue,
    defaultBookPriceCents:
      raw?.defaultBookPriceCents !== undefined || raw?.defaultBookPriceBrl !== undefined
        ? parseOptionalPositiveInt(
            rawDefaultPriceCents,
            100,
            100_000_000,
            'defaultBookPriceCents',
            strict
          )
        : DEFAULT_COMPANY_OPERATIONAL_CONFIG.defaultBookPriceCents,
    maxSellerDiscountPercent: parsePercent(
      raw?.maxSellerDiscountPercent,
      DEFAULT_COMPANY_OPERATIONAL_CONFIG.maxSellerDiscountPercent,
      'maxSellerDiscountPercent',
      strict
    ),
    discountPolicyMode,
    creditMinDownPaymentPercent: parsePercent(
      raw?.creditMinDownPaymentPercent,
      DEFAULT_COMPANY_OPERATIONAL_CONFIG.creditMinDownPaymentPercent,
      'creditMinDownPaymentPercent',
      strict
    ),
    creditMaxInstallments: parseBoundedInt(
      raw?.creditMaxInstallments,
      DEFAULT_COMPANY_OPERATIONAL_CONFIG.creditMaxInstallments,
      1,
      48,
      'creditMaxInstallments',
      strict
    ),
    creditLateInterestMonthlyPercent: parsePercent(
      raw?.creditLateInterestMonthlyPercent,
      DEFAULT_COMPANY_OPERATIONAL_CONFIG.creditLateInterestMonthlyPercent,
      'creditLateInterestMonthlyPercent',
      strict
    ),
    creditLateFinePercent: parsePercent(
      raw?.creditLateFinePercent,
      DEFAULT_COMPANY_OPERATIONAL_CONFIG.creditLateFinePercent,
      'creditLateFinePercent',
      strict
    ),
    creditDaysToCollectionQueue: parseBoundedInt(
      raw?.creditDaysToCollectionQueue,
      DEFAULT_COMPANY_OPERATIONAL_CONFIG.creditDaysToCollectionQueue,
      1,
      365,
      'creditDaysToCollectionQueue',
      strict
    ),
    creditDaysToSerasaEligible: parseBoundedInt(
      raw?.creditDaysToSerasaEligible,
      DEFAULT_COMPANY_OPERATIONAL_CONFIG.creditDaysToSerasaEligible,
      1,
      365,
      'creditDaysToSerasaEligible',
      strict
    ),
    maxBatchReturnDays: parseBoundedInt(
      raw?.maxBatchReturnDays,
      DEFAULT_COMPANY_OPERATIONAL_CONFIG.maxBatchReturnDays,
      1,
      365,
      'maxBatchReturnDays',
      strict
    ),
    maxSimultaneousBooksPerSeller:
      raw?.maxSimultaneousBooksPerSeller !== undefined
        ? parseOptionalPositiveInt(
            raw.maxSimultaneousBooksPerSeller,
            1,
            1000,
            'maxSimultaneousBooksPerSeller',
            strict
          )
        : DEFAULT_COMPANY_OPERATIONAL_CONFIG.maxSimultaneousBooksPerSeller,
    whatsappCreditCollectionTemplate:
      raw?.whatsappCreditCollectionTemplate !== undefined
        ? sanitizeOptionalString(raw.whatsappCreditCollectionTemplate, 2000)
        : DEFAULT_COMPANY_OPERATIONAL_CONFIG.whatsappCreditCollectionTemplate,
    whatsappAdvanceNoticeTemplate:
      raw?.whatsappAdvanceNoticeTemplate !== undefined
        ? sanitizeOptionalString(raw.whatsappAdvanceNoticeTemplate, 2000)
        : DEFAULT_COMPANY_OPERATIONAL_CONFIG.whatsappAdvanceNoticeTemplate,
    whatsappPostSaleTemplate:
      raw?.whatsappPostSaleTemplate !== undefined
        ? sanitizeOptionalString(raw.whatsappPostSaleTemplate, 2000)
        : DEFAULT_COMPANY_OPERATIONAL_CONFIG.whatsappPostSaleTemplate,
    companyLogoUrl:
      raw?.companyLogoUrl !== undefined
        ? sanitizeOptionalString(raw.companyLogoUrl, 1000)
        : DEFAULT_COMPANY_OPERATIONAL_CONFIG.companyLogoUrl,
    sacPhone:
      raw?.sacPhone !== undefined
        ? sanitizeOptionalString(raw.sacPhone, 40)
        : DEFAULT_COMPANY_OPERATIONAL_CONFIG.sacPhone,
    sacWhatsapp:
      raw?.sacWhatsapp !== undefined
        ? sanitizeOptionalString(raw.sacWhatsapp, 40)
        : DEFAULT_COMPANY_OPERATIONAL_CONFIG.sacWhatsapp,
    qrReceiptFooterText:
      raw?.qrReceiptFooterText !== undefined
        ? sanitizeOptionalString(raw.qrReceiptFooterText, 1000)
        : DEFAULT_COMPANY_OPERATIONAL_CONFIG.qrReceiptFooterText,
    qrShowLogo: parseBool(raw?.qrShowLogo, DEFAULT_COMPANY_OPERATIONAL_CONFIG.qrShowLogo),
    qrShowTradeName: parseBool(raw?.qrShowTradeName, DEFAULT_COMPANY_OPERATIONAL_CONFIG.qrShowTradeName),
    qrShowSacContact: parseBool(raw?.qrShowSacContact, DEFAULT_COMPANY_OPERATIONAL_CONFIG.qrShowSacContact),
    qrShowSellerName: parseBool(raw?.qrShowSellerName, DEFAULT_COMPANY_OPERATIONAL_CONFIG.qrShowSellerName),
    qrShowPhotographerName: parseBool(raw?.qrShowPhotographerName, DEFAULT_COMPANY_OPERATIONAL_CONFIG.qrShowPhotographerName),
    qrShowPaymentMethod: parseBool(raw?.qrShowPaymentMethod, DEFAULT_COMPANY_OPERATIONAL_CONFIG.qrShowPaymentMethod),
    qrShowSaleValue: parseBool(raw?.qrShowSaleValue, DEFAULT_COMPANY_OPERATIONAL_CONFIG.qrShowSaleValue),
    qrShowInstallmentSummary: parseBool(raw?.qrShowInstallmentSummary, DEFAULT_COMPANY_OPERATIONAL_CONFIG.qrShowInstallmentSummary),
    qrShowBatchAndBookCode: parseBool(raw?.qrShowBatchAndBookCode, DEFAULT_COMPANY_OPERATIONAL_CONFIG.qrShowBatchAndBookCode),
    qrShowRatingForm: parseBool(raw?.qrShowRatingForm, DEFAULT_COMPANY_OPERATIONAL_CONFIG.qrShowRatingForm),
    qrShowFooterText: parseBool(raw?.qrShowFooterText, DEFAULT_COMPANY_OPERATIONAL_CONFIG.qrShowFooterText),
  };
}

/**
 * Avalia política de preço padrão e desconto máximo para uma venda.
 */
export function evaluateSalePricePolicy(params: {
  saleValueReais: number;
  operationalConfig?: CompanyOperationalConfigValues | null;
}): {
  exceeded: boolean;
  shouldBlock: boolean;
  priceDivergenceAlert: boolean;
  priceDivergenceDetail: string | null;
  discountPercent: number;
} {
  const cfg = params.operationalConfig;
  if (!cfg || !cfg.defaultBookPriceCents || cfg.defaultBookPriceCents <= 0) {
    return {
      exceeded: false,
      shouldBlock: false,
      priceDivergenceAlert: false,
      priceDivergenceDetail: null,
      discountPercent: 0,
    };
  }

  const saleCents = Math.round(params.saleValueReais * 100);
  if (saleCents >= cfg.defaultBookPriceCents) {
    return {
      exceeded: false,
      shouldBlock: false,
      priceDivergenceAlert: false,
      priceDivergenceDetail: null,
      discountPercent: 0,
    };
  }

  const discountCents = cfg.defaultBookPriceCents - saleCents;
  const discountPercent = Number(((discountCents / cfg.defaultBookPriceCents) * 100).toFixed(2));
  const maxPct = cfg.maxSellerDiscountPercent ?? 15.0;

  if (discountPercent <= maxPct) {
    return {
      exceeded: false,
      shouldBlock: false,
      priceDivergenceAlert: false,
      priceDivergenceDetail: null,
      discountPercent,
    };
  }

  const baseBrl = (cfg.defaultBookPriceCents / 100).toFixed(2);
  const saleBrl = (saleCents / 100).toFixed(2);
  const detail = `Venda em R$ ${saleBrl} com desconto de ${discountPercent.toFixed(1)}% acima do teto de ${maxPct.toFixed(1)}% sobre o preço padrão de R$ ${baseBrl}.`;

  if (cfg.discountPolicyMode === 'HARD_BLOCK') {
    return {
      exceeded: true,
      shouldBlock: true,
      priceDivergenceAlert: false,
      priceDivergenceDetail: detail,
      discountPercent,
    };
  }

  return {
    exceeded: true,
    shouldBlock: false,
    priceDivergenceAlert: true,
    priceDivergenceDetail: detail,
    discountPercent,
  };
}

export async function getCompanyOperationalConfig(
  companyId: string,
  dbClient: Pick<PrismaClient, 'companyOperationalConfig'> = defaultPrisma
): Promise<CompanyOperationalConfigDTO> {
  const row = await dbClient.companyOperationalConfig.findUnique({
    where: { companyId },
  });

  if (!row) {
    return {
      companyId,
      isDefault: true,
      ...DEFAULT_COMPANY_OPERATIONAL_CONFIG,
      defaultTemplates: DEFAULT_WHATSAPP_TEMPLATES,
      updatedById: null,
      updatedAt: null,
    };
  }

  const values = normalizeCompanyOperationalConfigValues(row, false);
  return {
    companyId,
    isDefault: false,
    ...values,
    defaultTemplates: DEFAULT_WHATSAPP_TEMPLATES,
    updatedById: row.updatedById || null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

export async function upsertCompanyOperationalConfig(
  params: {
    companyId: string;
    payload: any;
    actorUserId: string;
    actorName: string;
    actorRole: string;
    ipAddress?: string | null;
  },
  dbClient: PrismaClient = defaultPrisma
): Promise<CompanyOperationalConfigDTO> {
  const { companyId, payload, actorUserId, actorName, actorRole, ipAddress } = params;

  const previous = await getCompanyOperationalConfig(companyId, dbClient);
  const safePayload = payload && typeof payload === 'object' ? { ...payload } : {};
  const hasOwn = (key: string) =>
    Object.prototype.hasOwnProperty.call(safePayload, key) && safePayload[key] !== undefined;

  if (hasOwn('virginBookCommissionPercent')) {
    if (!hasOwn('virginCompanyCarCommissionPercent')) {
      safePayload.virginCompanyCarCommissionPercent = safePayload.virginBookCommissionPercent;
    }
    if (!hasOwn('virginOwnCarCommissionPercent')) {
      safePayload.virginOwnCarCommissionPercent = safePayload.virginBookCommissionPercent;
    }
  } else if (hasOwn('virginCompanyCarCommissionPercent')) {
    safePayload.virginBookCommissionPercent = safePayload.virginCompanyCarCommissionPercent;
  }

  if (hasOwn('reboloBookCommissionPercent')) {
    if (!hasOwn('reboloCompanyCarCommissionPercent')) {
      safePayload.reboloCompanyCarCommissionPercent = safePayload.reboloBookCommissionPercent;
    }
    if (!hasOwn('reboloOwnCarCommissionPercent')) {
      safePayload.reboloOwnCarCommissionPercent = safePayload.reboloBookCommissionPercent;
    }
  } else if (hasOwn('reboloCompanyCarCommissionPercent')) {
    safePayload.reboloBookCommissionPercent = safePayload.reboloCompanyCarCommissionPercent;
  }

  const mergedInput = {
    ...previous,
    ...safePayload,
  };
  const nextValues = normalizeCompanyOperationalConfigValues(mergedInput, true);

  const saved = await dbClient.companyOperationalConfig.upsert({
    where: { companyId },
    create: {
      companyId,
      ...nextValues,
      updatedById: actorUserId,
    },
    update: {
      ...nextValues,
      updatedById: actorUserId,
    },
  });

  await recordOperationalAuditEvent(
    {
      companyId,
      category: 'GOVERNANCE',
      action: 'COMPANY_OPERATIONAL_CONFIG_UPDATED',
      entityType: 'COMPANY_OPERATIONAL_CONFIG',
      entityReference: `OP_CONFIG:${companyId}`,
      entityId: saved.id,
      previousValues: {
        isDefault: previous.isDefault,
        virginBookCommissionPercent: previous.virginBookCommissionPercent,
        reboloBookCommissionPercent: previous.reboloBookCommissionPercent,
        virginCompanyCarCommissionPercent: previous.virginCompanyCarCommissionPercent,
        virginOwnCarCommissionPercent: previous.virginOwnCarCommissionPercent,
        reboloCompanyCarCommissionPercent: previous.reboloCompanyCarCommissionPercent,
        reboloOwnCarCommissionPercent: previous.reboloOwnCarCommissionPercent,
        creditInstallmentCommissionPercent: previous.creditInstallmentCommissionPercent,
        photographerCommissionType: previous.photographerCommissionType,
        photographerCommissionValue: previous.photographerCommissionValue,
        defaultBookPriceCents: previous.defaultBookPriceCents,
        maxSellerDiscountPercent: previous.maxSellerDiscountPercent,
        discountPolicyMode: previous.discountPolicyMode,
        creditMinDownPaymentPercent: previous.creditMinDownPaymentPercent,
        creditMaxInstallments: previous.creditMaxInstallments,
        creditLateInterestMonthlyPercent: previous.creditLateInterestMonthlyPercent,
        creditLateFinePercent: previous.creditLateFinePercent,
        creditDaysToCollectionQueue: previous.creditDaysToCollectionQueue,
        creditDaysToSerasaEligible: previous.creditDaysToSerasaEligible,
        maxBatchReturnDays: previous.maxBatchReturnDays,
        maxSimultaneousBooksPerSeller: previous.maxSimultaneousBooksPerSeller,
        companyLogoUrl: previous.companyLogoUrl,
        sacPhone: previous.sacPhone,
        sacWhatsapp: previous.sacWhatsapp,
      },
      newValues: {
        isDefault: false,
        virginBookCommissionPercent: nextValues.virginBookCommissionPercent,
        reboloBookCommissionPercent: nextValues.reboloBookCommissionPercent,
        virginCompanyCarCommissionPercent: nextValues.virginCompanyCarCommissionPercent,
        virginOwnCarCommissionPercent: nextValues.virginOwnCarCommissionPercent,
        reboloCompanyCarCommissionPercent: nextValues.reboloCompanyCarCommissionPercent,
        reboloOwnCarCommissionPercent: nextValues.reboloOwnCarCommissionPercent,
        creditInstallmentCommissionPercent: nextValues.creditInstallmentCommissionPercent,
        photographerCommissionType: nextValues.photographerCommissionType,
        photographerCommissionValue: nextValues.photographerCommissionValue,
        defaultBookPriceCents: nextValues.defaultBookPriceCents,
        maxSellerDiscountPercent: nextValues.maxSellerDiscountPercent,
        discountPolicyMode: nextValues.discountPolicyMode,
        creditMinDownPaymentPercent: nextValues.creditMinDownPaymentPercent,
        creditMaxInstallments: nextValues.creditMaxInstallments,
        creditLateInterestMonthlyPercent: nextValues.creditLateInterestMonthlyPercent,
        creditLateFinePercent: nextValues.creditLateFinePercent,
        creditDaysToCollectionQueue: nextValues.creditDaysToCollectionQueue,
        creditDaysToSerasaEligible: nextValues.creditDaysToSerasaEligible,
        maxBatchReturnDays: nextValues.maxBatchReturnDays,
        maxSimultaneousBooksPerSeller: nextValues.maxSimultaneousBooksPerSeller,
        companyLogoUrl: nextValues.companyLogoUrl,
        sacPhone: nextValues.sacPhone,
        sacWhatsapp: nextValues.sacWhatsapp,
      },
      reason: 'Atualização das configurações operacionais gerais da empresa',
      authorUserId: actorUserId,
      authorName: actorName,
      authorRole: actorRole,
      ipAddress: ipAddress || null,
    },
    dbClient as any
  );

  return {
    companyId,
    isDefault: false,
    ...nextValues,
    defaultTemplates: DEFAULT_WHATSAPP_TEMPLATES,
    updatedById: saved.updatedById || actorUserId,
    updatedAt: saved.updatedAt ? saved.updatedAt.toISOString() : null,
  };
}

function parseOptionalPercentField(raw: unknown, field: string): number | null {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return null;
  }
  const num = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(num) || num < 0 || num > 100) {
    throw Object.assign(
      new Error(`${field} deve estar entre 0% e 100% (ou vazio/null para herdar da empresa).`),
      { status: 400 }
    );
  }
  return Number(num.toFixed(2));
}

export async function listSellerCommissionOverrides(
  companyId: string,
  dbClient: PrismaClient = defaultPrisma
) {
  const [opCfg, sellers] = await Promise.all([
    getCompanyOperationalConfig(companyId, dbClient),
    dbClient.user.findMany({
      where: {
        companyId,
        role: { in: ['SELLER', 'SELLER_MANAGER', 'VENDEDOR'] },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        usesOwnCar: true,
        sellerVehicleType: true,
        sellerBookProfile: true,
        salesType: true,
        customVirginCommissionPercent: true,
        customReboloCommissionPercent: true,
        customCreditInstallmentCommissionPercent: true,
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    }),
  ]);

  return {
    companyId,
    companyDefaults: {
      virginBookCommissionPercent: opCfg.virginBookCommissionPercent,
      reboloBookCommissionPercent: opCfg.reboloBookCommissionPercent,
      virginCompanyCarCommissionPercent: opCfg.virginCompanyCarCommissionPercent,
      virginOwnCarCommissionPercent: opCfg.virginOwnCarCommissionPercent,
      reboloCompanyCarCommissionPercent: opCfg.reboloCompanyCarCommissionPercent,
      reboloOwnCarCommissionPercent: opCfg.reboloOwnCarCommissionPercent,
      creditInstallmentCommissionPercent: opCfg.creditInstallmentCommissionPercent,
    },
    sellers: sellers.map((s) => {
      const isOwn =
        s.usesOwnCar === true ||
        String(s.sellerVehicleType || '').toUpperCase() === 'OWN_CAR';
      const defaultVirgin = isOwn
        ? opCfg.virginOwnCarCommissionPercent
        : opCfg.virginCompanyCarCommissionPercent;
      const defaultRebolo = isOwn
        ? opCfg.reboloOwnCarCommissionPercent
        : opCfg.reboloCompanyCarCommissionPercent;
      return {
        ...s,
        sellerVehicleType: isOwn ? 'OWN_CAR' : 'COMPANY_CAR',
        effectiveVirginCommissionPercent:
          s.customVirginCommissionPercent ?? defaultVirgin,
        effectiveReboloCommissionPercent:
          s.customReboloCommissionPercent ?? defaultRebolo,
        effectiveCreditInstallmentCommissionPercent:
          s.customCreditInstallmentCommissionPercent ?? opCfg.creditInstallmentCommissionPercent,
        hasCustomOverride:
          s.customVirginCommissionPercent !== null ||
          s.customReboloCommissionPercent !== null ||
          s.customCreditInstallmentCommissionPercent !== null,
      };
    }),
  };
}

export async function upsertSellerCommissionOverride(
  params: {
    companyId: string;
    sellerId: string;
    payload: {
      customVirginCommissionPercent?: unknown;
      customReboloCommissionPercent?: unknown;
      customCreditInstallmentCommissionPercent?: unknown;
      clear?: boolean;
    };
    actorUserId: string;
    actorName: string;
    actorRole: string;
    ipAddress?: string | null;
  },
  dbClient: PrismaClient = defaultPrisma
) {
  const { companyId, sellerId, payload, actorUserId, actorName, actorRole, ipAddress } = params;

  const existingSeller = await dbClient.user.findUnique({
    where: { id: sellerId },
    select: {
      id: true,
      name: true,
      role: true,
      companyId: true,
      active: true,
      customVirginCommissionPercent: true,
      customReboloCommissionPercent: true,
      customCreditInstallmentCommissionPercent: true,
    },
  });

  if (!existingSeller) {
    throw Object.assign(new Error('Vendedor não encontrado.'), { status: 404 });
  }
  if (existingSeller.companyId !== companyId) {
    throw Object.assign(
      new Error('Isolamento multi-tenant: vendedor pertence a outra empresa.'),
      { status: 403 }
    );
  }
  if (!['SELLER', 'SELLER_MANAGER', 'VENDEDOR'].includes(String(existingSeller.role).toUpperCase())) {
    throw Object.assign(
      new Error('Exceção individual de comissão só pode ser aplicada a vendedores.'),
      { status: 400 }
    );
  }

  const nextVirgin = payload?.clear
    ? null
    : payload?.customVirginCommissionPercent !== undefined
      ? parseOptionalPercentField(payload.customVirginCommissionPercent, 'customVirginCommissionPercent')
      : existingSeller.customVirginCommissionPercent;
  const nextRebolo = payload?.clear
    ? null
    : payload?.customReboloCommissionPercent !== undefined
      ? parseOptionalPercentField(payload.customReboloCommissionPercent, 'customReboloCommissionPercent')
      : existingSeller.customReboloCommissionPercent;
  const nextCredit = payload?.clear
    ? null
    : payload?.customCreditInstallmentCommissionPercent !== undefined
      ? parseOptionalPercentField(
          payload.customCreditInstallmentCommissionPercent,
          'customCreditInstallmentCommissionPercent'
        )
      : existingSeller.customCreditInstallmentCommissionPercent;

  const updated = await dbClient.user.update({
    where: { id: sellerId },
    data: {
      customVirginCommissionPercent: nextVirgin,
      customReboloCommissionPercent: nextRebolo,
      customCreditInstallmentCommissionPercent: nextCredit,
    },
    select: {
      id: true,
      name: true,
      role: true,
      active: true,
      companyId: true,
      usesOwnCar: true,
      sellerVehicleType: true,
      sellerBookProfile: true,
      customVirginCommissionPercent: true,
      customReboloCommissionPercent: true,
      customCreditInstallmentCommissionPercent: true,
    },
  });

  await recordOperationalAuditEvent(
    {
      companyId,
      category: 'GOVERNANCE',
      action: 'SELLER_COMMISSION_OVERRIDE_UPDATED',
      entityType: 'USER',
      entityReference: updated.name,
      entityId: updated.id,
      previousValues: {
        customVirginCommissionPercent: existingSeller.customVirginCommissionPercent,
        customReboloCommissionPercent: existingSeller.customReboloCommissionPercent,
        customCreditInstallmentCommissionPercent: existingSeller.customCreditInstallmentCommissionPercent,
      },
      newValues: {
        customVirginCommissionPercent: updated.customVirginCommissionPercent,
        customReboloCommissionPercent: updated.customReboloCommissionPercent,
        customCreditInstallmentCommissionPercent: updated.customCreditInstallmentCommissionPercent,
      },
      reason: 'Configuração de exceção individual de comissão para vendedor',
      authorUserId: actorUserId,
      authorName: actorName,
      authorRole: actorRole,
      ipAddress: ipAddress || null,
    },
    dbClient as any
  );

  const opCfg = await getCompanyOperationalConfig(companyId, dbClient);
  const isOwn =
    updated.usesOwnCar === true ||
    String(updated.sellerVehicleType || '').toUpperCase() === 'OWN_CAR';
  const defaultVirgin = isOwn
    ? opCfg.virginOwnCarCommissionPercent
    : opCfg.virginCompanyCarCommissionPercent;
  const defaultRebolo = isOwn
    ? opCfg.reboloOwnCarCommissionPercent
    : opCfg.reboloCompanyCarCommissionPercent;
  return {
    ...updated,
    effectiveVirginCommissionPercent:
      updated.customVirginCommissionPercent ?? defaultVirgin,
    effectiveReboloCommissionPercent:
      updated.customReboloCommissionPercent ?? defaultRebolo,
    effectiveCreditInstallmentCommissionPercent:
      updated.customCreditInstallmentCommissionPercent ?? opCfg.creditInstallmentCommissionPercent,
    hasCustomOverride:
      updated.customVirginCommissionPercent !== null ||
      updated.customReboloCommissionPercent !== null ||
      updated.customCreditInstallmentCommissionPercent !== null,
  };
}
