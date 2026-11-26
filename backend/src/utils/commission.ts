import { CompanyOperationalConfigValues } from '../services/companyOperationalConfigService';

export type SellerVehicleType = 'COMPANY_CAR' | 'OWN_CAR';
export type SellerBookProfile = 'VIRGIN' | 'REBOLO' | 'BOTH';

export interface SellerCommissionProfile {
  usesOwnCar?: boolean | null;
  sellerVehicleType?: string | null;
  sellerBookProfile?: string | null;
  salesType?: string | null;
  customVirginCommissionPercent?: number | null;
  customReboloCommissionPercent?: number | null;
  customCreditInstallmentCommissionPercent?: number | null;
}

export function normalizeSellerVehicleType(
  rawVehicleType?: string | null,
  usesOwnCar?: boolean | null
): SellerVehicleType {
  const upper = String(rawVehicleType || '').trim().toUpperCase();
  if (usesOwnCar === true || upper === 'OWN_CAR' || upper === 'CARRO_PROPRIO') {
    return 'OWN_CAR';
  }
  return 'COMPANY_CAR';
}

export function normalizeSellerBookProfile(
  rawBookProfile?: string | null,
  rawSalesType?: string | null
): SellerBookProfile {
  const primary = String(rawBookProfile || '').trim().toUpperCase();
  if (primary === 'REBOLO' || primary === 'BOTH' || primary === 'VIRGIN') {
    return primary as SellerBookProfile;
  }
  if (primary === 'AMBOS') return 'BOTH';
  const fallback = String(rawSalesType || '').trim().toUpperCase();
  if (fallback === 'REBOLO') return 'REBOLO';
  if (fallback === 'BOTH' || fallback === 'AMBOS') return 'BOTH';
  return 'VIRGIN';
}

export function resolveSellerUsesOwnCar(seller?: SellerCommissionProfile | null): boolean {
  if (!seller) return false;
  return normalizeSellerVehicleType(seller.sellerVehicleType, seller.usesOwnCar) === 'OWN_CAR';
}

/**
 * Regra comercial oficial (fallback quando não há configuração editável da empresa):
 * - Virgem + carro da empresa: 20%
 * - Virgem + carro próprio: 25%
 */
export function resolveSellerCommissionRate(seller?: SellerCommissionProfile | null): number {
  return resolveSellerUsesOwnCar(seller) ? 0.25 : 0.20;
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
 * Resolve o percentual (ex.: 20.0 / 25.0 / 40.0 / 50.0) e a alíquota decimal
 * para uma nova venda ou prévia de comissão, seguindo estritamente a precedência:
 * 1) Exceção individual configurada no cadastro do vendedor (Virgem vs. Rebolo)
 * 2) Matriz editável de CompanyOperationalConfig cruzando Book (Virgem vs. Rebolo) x Veículo (Empresa vs. Próprio)
 * 3) Fallback canônico: Virgem (20% Empresa / 25% Próprio) | Rebolo (40% Empresa / 50% Próprio)
 */
export function resolveNewSaleCommission(params: {
  bookStatus?: string | null;
  operationalConfig?: Pick<
    CompanyOperationalConfigValues,
    | 'virginBookCommissionPercent'
    | 'reboloBookCommissionPercent'
    | 'virginCompanyCarCommissionPercent'
    | 'virginOwnCarCommissionPercent'
    | 'reboloCompanyCarCommissionPercent'
    | 'reboloOwnCarCommissionPercent'
  > | null;
  sellerOverrides?: SellerCommissionProfile | null;
}): {
  percent: number;
  rate: number;
  isRebolo: boolean;
  isOwnCar: boolean;
  source: 'SELLER_OVERRIDE' | 'COMPANY_CONFIG' | 'CANONICAL_FALLBACK';
} {
  const sellerProfile = normalizeSellerBookProfile(
    params.sellerOverrides?.sellerBookProfile,
    params.sellerOverrides?.salesType
  );
  const isRebolo = isReboloBookStatus(params.bookStatus) || sellerProfile === 'REBOLO';
  const isOwnCar = resolveSellerUsesOwnCar(params.sellerOverrides);

  const overrideVal = isRebolo
    ? params.sellerOverrides?.customReboloCommissionPercent
    : params.sellerOverrides?.customVirginCommissionPercent;

  if (typeof overrideVal === 'number' && Number.isFinite(overrideVal)) {
    return {
      percent: Number(overrideVal.toFixed(2)),
      rate: Number((overrideVal / 100).toFixed(4)),
      isRebolo,
      isOwnCar,
      source: 'SELLER_OVERRIDE',
    };
  }

  if (params.operationalConfig) {
    const cfg = params.operationalConfig;
    const companyPercent = isRebolo
      ? isOwnCar
        ? (cfg.reboloOwnCarCommissionPercent ?? cfg.reboloBookCommissionPercent ?? 50.0)
        : (cfg.reboloCompanyCarCommissionPercent ?? cfg.reboloBookCommissionPercent ?? 40.0)
      : isOwnCar
        ? (cfg.virginOwnCarCommissionPercent ?? cfg.virginBookCommissionPercent ?? 25.0)
        : (cfg.virginCompanyCarCommissionPercent ?? cfg.virginBookCommissionPercent ?? 20.0);

    return {
      percent: Number(companyPercent.toFixed(2)),
      rate: Number((companyPercent / 100).toFixed(4)),
      isRebolo,
      isOwnCar,
      source: 'COMPANY_CONFIG',
    };
  }

  const fallback = isRebolo ? (isOwnCar ? 50.0 : 40.0) : (isOwnCar ? 25.0 : 20.0);
  return {
    percent: fallback,
    rate: Number((fallback / 100).toFixed(4)),
    isRebolo,
    isOwnCar,
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
 * 3) exceção individual do vendedor -> matriz da empresa -> fallback 20/25/40/50
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
    | 'virginBookCommissionPercent'
    | 'reboloBookCommissionPercent'
    | 'virginCompanyCarCommissionPercent'
    | 'virginOwnCarCommissionPercent'
    | 'reboloCompanyCarCommissionPercent'
    | 'reboloOwnCarCommissionPercent'
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
