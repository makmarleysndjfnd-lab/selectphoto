import { CompanyOperationalConfigValues } from '../services/companyOperationalConfigService';

export interface SellerCommissionProfile {
  usesOwnCar?: boolean | null;
  customVirginCommissionPercent?: number | null;
  customReboloCommissionPercent?: number | null;
  customCreditInstallmentCommissionPercent?: number | null;
}

/**
 * Regra comercial legada (fallback por veículo quando não há configuração da empresa):
 * - carro da empresa: 20%
 * - carro próprio do vendedor: 25%
 */
export function resolveSellerCommissionRate(seller?: SellerCommissionProfile | null): number {
  return seller?.usesOwnCar === true ? 0.25 : 0.20;
}

/**
 * Indica se a ficha/book está em fluxo de Rebolo.
 */
export function isReboloBookStatus(bookStatus?: string | null): boolean {
  const s = String(bookStatus || '').trim().toUpperCase();
  return (
    s === 'DISTRIBUTED_REBOLO' ||
    s === 'IN_STOCK_REBOLO' ||
    s === 'REBOLO_SOLD' ||
    s === 'AWAITING_RETURN'
  );
}

/**
 * Resolve o percentual (ex.: 25.0) e a alíquota decimal (ex.: 0.25) para uma nova venda,
 * seguindo estritamente a precedência:
 * 1) Exceção individual configurada para o vendedor (Virgem vs. Rebolo)
 * 2) Configuração operacional da empresa (Virgem vs. Rebolo)
 * 3) Fallback canônico 25% (Virgem) / 20% (Rebolo)
 */
export function resolveNewSaleCommission(params: {
  bookStatus?: string | null;
  operationalConfig?: Pick<
    CompanyOperationalConfigValues,
    'virginBookCommissionPercent' | 'reboloBookCommissionPercent'
  > | null;
  sellerOverrides?: Pick<
    SellerCommissionProfile,
    'customVirginCommissionPercent' | 'customReboloCommissionPercent'
  > | null;
}): { percent: number; rate: number; isRebolo: boolean; source: 'SELLER_OVERRIDE' | 'COMPANY_CONFIG' | 'CANONICAL_FALLBACK' } {
  const isRebolo = isReboloBookStatus(params.bookStatus);
  const overrideVal = isRebolo
    ? params.sellerOverrides?.customReboloCommissionPercent
    : params.sellerOverrides?.customVirginCommissionPercent;

  if (typeof overrideVal === 'number' && Number.isFinite(overrideVal)) {
    return {
      percent: Number(overrideVal.toFixed(2)),
      rate: Number((overrideVal / 100).toFixed(4)),
      isRebolo,
      source: 'SELLER_OVERRIDE',
    };
  }

  if (params.operationalConfig) {
    const companyPercent = isRebolo
      ? params.operationalConfig.reboloBookCommissionPercent
      : params.operationalConfig.virginBookCommissionPercent;
    return {
      percent: Number(companyPercent.toFixed(2)),
      rate: Number((companyPercent / 100).toFixed(4)),
      isRebolo,
      source: 'COMPANY_CONFIG',
    };
  }

  const fallback = isRebolo ? 20.0 : 25.0;
  return {
    percent: fallback,
    rate: Number((fallback / 100).toFixed(4)),
    isRebolo,
    source: 'CANONICAL_FALLBACK',
  };
}

/**
 * Resolve o percentual e taxa das parcelas subsequentes de crediário para um novo contrato:
 * 1) Exceção individual do vendedor (customCreditInstallmentCommissionPercent)
 * 2) Configuração da empresa (creditInstallmentCommissionPercent)
 * 3) Fallback canônico 10%
 */
export function resolveNewCreditInstallmentCommission(params: {
  operationalConfig?: Pick<CompanyOperationalConfigValues, 'creditInstallmentCommissionPercent'> | null;
  sellerOverrides?: Pick<SellerCommissionProfile, 'customCreditInstallmentCommissionPercent'> | null;
}): { percent: number; rate: number; source: 'SELLER_OVERRIDE' | 'COMPANY_CONFIG' | 'CANONICAL_FALLBACK' } {
  const overrideVal = params.sellerOverrides?.customCreditInstallmentCommissionPercent;
  if (typeof overrideVal === 'number' && Number.isFinite(overrideVal)) {
    return {
      percent: Number(overrideVal.toFixed(2)),
      rate: Number((overrideVal / 100).toFixed(4)),
      source: 'SELLER_OVERRIDE',
    };
  }

  if (params.operationalConfig) {
    const companyPct = params.operationalConfig.creditInstallmentCommissionPercent;
    return {
      percent: Number(companyPct.toFixed(2)),
      rate: Number((companyPct / 100).toFixed(4)),
      source: 'COMPANY_CONFIG',
    };
  }

  return {
    percent: 10.0,
    rate: 0.1,
    source: 'CANONICAL_FALLBACK',
  };
}

/**
 * Calcula a comissão do fotógrafo conforme a regra configurada da empresa:
 * - FIXED_PER_BOOK: valor fixo por book/venda considerado
 * - PERCENT_OF_SALE: % sobre o faturamento líquido considerado
 */
export function resolvePhotographerCommission(params: {
  operationalConfig?: Pick<
    CompanyOperationalConfigValues,
    'photographerCommissionType' | 'photographerCommissionValue'
  > | null;
  booksCount: number;
  netSalesCents: number;
}): {
  type: 'FIXED_PER_BOOK' | 'PERCENT_OF_SALE';
  value: number;
  commissionCents: number;
} {
  const type = params.operationalConfig?.photographerCommissionType || 'FIXED_PER_BOOK';
  const value = Number(params.operationalConfig?.photographerCommissionValue || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return { type, value: 0, commissionCents: 0 };
  }

  const commissionCents =
    type === 'PERCENT_OF_SALE'
      ? Math.round(Math.max(0, params.netSalesCents) * (value / 100))
      : Math.round(Math.max(0, params.booksCount) * value * 100);

  return {
    type,
    value,
    commissionCents,
  };
}

/**
 * Resolve a alíquota histórica de uma venda já gravada:
 * 1) snapshot aplicado no momento da venda (Sale.appliedCommissionPercent) -> imutável
 * 2) taxa salva no contrato de crediário (CreditAgreement.initialCommissionRate)
 * 3) exceção individual do vendedor -> configuração da empresa -> fallback 25/20
 */
export function resolveHistoricalSaleCommissionRate(params: {
  sale: {
    appliedCommissionPercent?: number | null;
    creditAgreement?: { initialCommissionRate?: number | null } | null;
    client?: { bookStatus?: string | null } | null;
    seller?: SellerCommissionProfile | null;
  };
  operationalConfig?: Pick<
    CompanyOperationalConfigValues,
    'virginBookCommissionPercent' | 'reboloBookCommissionPercent'
  > | null;
}): number {
  const { sale, operationalConfig } = params;

  if (
    typeof sale.appliedCommissionPercent === 'number' &&
    Number.isFinite(sale.appliedCommissionPercent)
  ) {
    return Number((sale.appliedCommissionPercent / 100).toFixed(4));
  }

  if (
    typeof sale.creditAgreement?.initialCommissionRate === 'number' &&
    Number.isFinite(sale.creditAgreement.initialCommissionRate)
  ) {
    return sale.creditAgreement.initialCommissionRate;
  }

  return resolveNewSaleCommission({
    bookStatus: sale.client?.bookStatus,
    operationalConfig,
    sellerOverrides: sale.seller,
  }).rate;
}
