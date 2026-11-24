import { CompanyOperationalConfigValues } from '../services/companyOperationalConfigService';

export interface SellerCommissionProfile {
  usesOwnCar?: boolean | null;
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
 * priorizando a configuração da empresa (Virgem vs. Rebolo) com padrão canônico 25% / 20%.
 */
export function resolveNewSaleCommission(params: {
  bookStatus?: string | null;
  operationalConfig?: Pick<
    CompanyOperationalConfigValues,
    'virginBookCommissionPercent' | 'reboloBookCommissionPercent'
  > | null;
}): { percent: number; rate: number; isRebolo: boolean } {
  const isRebolo = isReboloBookStatus(params.bookStatus);
  const percent = params.operationalConfig
    ? isRebolo
      ? params.operationalConfig.reboloBookCommissionPercent
      : params.operationalConfig.virginBookCommissionPercent
    : isRebolo
      ? 20.0
      : 25.0;

  return {
    percent: Number(percent.toFixed(2)),
    rate: Number((percent / 100).toFixed(4)),
    isRebolo,
  };
}

/**
 * Resolve a alíquota histórica de uma venda já gravada:
 * 1) snapshot aplicado no momento da venda (Sale.appliedCommissionPercent)
 * 2) taxa salva no contrato de crediário (CreditAgreement.initialCommissionRate)
 * 3) configuração operacional da empresa para Virgem vs. Rebolo
 * 4) fallback canônico 25% (virgem) / 20% (rebolo)
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
  }).rate;
}
