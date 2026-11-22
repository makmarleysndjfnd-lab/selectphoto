/**
 * Helpers centralizados (Etapa 24) para calcular o valor líquido efetivo de uma venda
 * após cancelamentos totais ou estornos/descontos parciais com devolução.
 */

export const CANCELLED_STATUS_VALUES = new Set([
  'CANCELLED',
  'CANCELED',
  'VOIDED',
  'RETURNED',
  'ESTORNADA',
  'CANCELADA',
]);

export interface SaleNetLike {
  value?: number | null;
  saleStatus?: string | null;
  status?: string | null;
  paymentStatus?: string | null;
  refundedAmountCents?: number | null;
  paymentMethod?: string | null;
  paymentType?: string | null;
  payments?: Array<{
    method?: string | null;
    amount?: number | null;
  }> | null;
}

export function isSaleCancelled(sale: SaleNetLike | null | undefined): boolean {
  if (!sale) return false;
  if (String(sale.saleStatus || '').trim().toUpperCase() === 'CANCELLED') {
    return true;
  }
  const st = String(sale.status || '').trim().toUpperCase();
  if (CANCELLED_STATUS_VALUES.has(st)) {
    return true;
  }
  const paySt = String(sale.paymentStatus || '').trim().toUpperCase();
  if (CANCELLED_STATUS_VALUES.has(paySt)) {
    return true;
  }
  return false;
}

export function getSaleOriginalCents(sale: SaleNetLike | null | undefined): number {
  if (!sale) return 0;
  return Math.max(0, Math.round(Number(sale.value || 0) * 100));
}

export function getSaleNetCents(sale: SaleNetLike | null | undefined): number {
  if (!sale || isSaleCancelled(sale)) return 0;
  const origCents = getSaleOriginalCents(sale);
  const refundedCents = Math.max(0, Math.round(Number(sale.refundedAmountCents || 0)));
  return Math.max(0, origCents - refundedCents);
}

export function getSaleNetValue(sale: SaleNetLike | null | undefined): number {
  return getSaleNetCents(sale) / 100;
}

export function getSaleNetRatio(sale: SaleNetLike | null | undefined): number {
  if (!sale || isSaleCancelled(sale)) return 0;
  const origCents = getSaleOriginalCents(sale);
  if (origCents <= 0) return 0;
  const netCents = getSaleNetCents(sale);
  return Math.max(0, Math.min(1, netCents / origCents));
}

export function getSaleEffectivePayments(
  sale: SaleNetLike | null | undefined
): Array<{ method: string; amount: number; amountCents: number }> {
  if (!sale || isSaleCancelled(sale)) return [];
  const origCents = getSaleOriginalCents(sale);
  const netCents = getSaleNetCents(sale);
  if (origCents <= 0 || netCents <= 0) return [];

  const rawPayments =
    Array.isArray(sale.payments) && sale.payments.length > 0
      ? sale.payments
      : [{ method: sale.paymentMethod || sale.paymentType || 'DINHEIRO', amount: origCents / 100 }];

  const valid = rawPayments
    .map((p) => ({
      method: String(p.method || 'OUTRO').trim() || 'OUTRO',
      rawCents: Math.max(0, Math.round(Number(p.amount || 0) * 100)),
    }))
    .filter((p) => p.rawCents > 0);

  if (valid.length === 0) return [];

  const ratio = netCents / origCents;
  if (ratio >= 0.999999) {
    return valid.map((p) => ({
      method: p.method,
      amount: p.rawCents / 100,
      amountCents: p.rawCents,
    }));
  }

  let allocatedCents = 0;
  const scaled = valid.map((p, idx) => {
    const isLast = idx === valid.length - 1;
    const partCents = isLast
      ? Math.max(0, netCents - allocatedCents)
      : Math.max(0, Math.round(p.rawCents * ratio));
    allocatedCents += partCents;
    return {
      method: p.method,
      amount: partCents / 100,
      amountCents: partCents,
    };
  });

  return scaled.filter((p) => p.amountCents > 0);
}
