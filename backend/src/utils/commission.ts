export interface SellerCommissionProfile {
  usesOwnCar?: boolean | null;
}

/**
 * Regra comercial única:
 * - carro da empresa: 20%
 * - carro próprio do vendedor: 25%
 */
export function resolveSellerCommissionRate(seller?: SellerCommissionProfile | null): number {
  return seller?.usesOwnCar === true ? 0.25 : 0.20;
}
