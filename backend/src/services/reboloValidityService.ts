export const DEFAULT_REBOLO_VALIDITY_DAYS = 365;
export const MIN_REBOLO_VALIDITY_DAYS = 1;
export const MAX_REBOLO_VALIDITY_DAYS = 3650;

export type ReboloTrafficLightZone = 'GREEN' | 'YELLOW' | 'RED';

export interface ReboloValidityStatus {
  validityDays: number;
  enteredAt: string;
  expiresAt: string;
  elapsedDays: number;
  remainingDays: number;
  isExpired: boolean;
  progressRatio: number;
  zone: ReboloTrafficLightZone;
  zoneLabel: 'Verde' | 'Amarelo' | 'Vermelho';
}

export function normalizeReboloValidityDays(input?: number | null): number {
  const num = Number(input);
  if (!Number.isFinite(num) || num <= 0) {
    return DEFAULT_REBOLO_VALIDITY_DAYS;
  }
  return Math.max(
    MIN_REBOLO_VALIDITY_DAYS,
    Math.min(MAX_REBOLO_VALIDITY_DAYS, Math.round(num))
  );
}

/**
 * Computes the proportional 3-tier Rebolo deadline traffic light:
 * - First 1/3 elapsed  -> GREEN  (Verde)
 * - Second 1/3 elapsed -> YELLOW (Amarelo)
 * - Final 1/3 or expired -> RED  (Vermelho)
 */
export function calculateReboloValidityStatus(
  enteredAtInput: Date | string,
  validityDaysInput?: number | null,
  nowInput: Date = new Date()
): ReboloValidityStatus {
  const validityDays = normalizeReboloValidityDays(validityDaysInput);
  const parsedStart = new Date(enteredAtInput);
  const enteredAt = Number.isNaN(parsedStart.getTime()) ? new Date(nowInput) : parsedStart;
  const now = new Date(nowInput);

  const dayMs = 86_400_000;
  const totalMs = validityDays * dayMs;
  const elapsedMs = Math.max(0, now.getTime() - enteredAt.getTime());
  const elapsedDays = Math.floor(elapsedMs / dayMs);
  const expiresAt = new Date(enteredAt.getTime() + totalMs);
  const remainingMs = expiresAt.getTime() - now.getTime();
  const remainingDays = Math.ceil(remainingMs / dayMs);
  const isExpired = remainingMs <= 0;

  const rawRatio = elapsedMs / totalMs;
  const progressRatio = Math.min(1, Math.max(0, Number(rawRatio.toFixed(4))));

  let zone: ReboloTrafficLightZone;
  let zoneLabel: 'Verde' | 'Amarelo' | 'Vermelho';
  if (isExpired || rawRatio >= 2 / 3) {
    zone = 'RED';
    zoneLabel = 'Vermelho';
  } else if (rawRatio >= 1 / 3) {
    zone = 'YELLOW';
    zoneLabel = 'Amarelo';
  } else {
    zone = 'GREEN';
    zoneLabel = 'Verde';
  }

  return {
    validityDays,
    enteredAt: enteredAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    elapsedDays,
    remainingDays,
    isExpired,
    progressRatio,
    zone,
    zoneLabel,
  };
}

export function resolveReboloEnteredAt(client: any): Date {
  const timeline = Array.isArray(client?.timeline) ? client.timeline : [];
  const physicalReturnEntry = [...timeline]
    .reverse()
    .find(
      (t: any) => t?.action === 'RECEIVE_RETURN' && t?.newStatus === 'IN_STOCK_REBOLO'
    );
  if (physicalReturnEntry?.timestamp || physicalReturnEntry?.createdAt) {
    return new Date(physicalReturnEntry.timestamp || physicalReturnEntry.createdAt);
  }

  const nonSales = Array.isArray(client?.nonSales) ? client.nonSales : [];
  if (nonSales.length > 0) {
    const sorted = [...nonSales]
      .filter((ns) => ns?.date)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (sorted.length > 0) {
      return new Date(sorted[0].date);
    }
  }

  const reboloEntry = timeline.find(
    (t: any) => t?.newStatus === 'AWAITING_RETURN' || t?.newStatus === 'IN_STOCK_REBOLO'
  );
  if (reboloEntry?.timestamp || reboloEntry?.createdAt) {
    return new Date(reboloEntry.timestamp || reboloEntry.createdAt);
  }

  if (client?.outcomeUpdatedAt) {
    return new Date(client.outcomeUpdatedAt);
  }
  return client?.createdAt ? new Date(client.createdAt) : new Date();
}

export function resolveReboloOrigin(client: any) {
  const nonSales = Array.isArray(client?.nonSales) ? client.nonSales : [];
  const sortedNonSales = [...nonSales].sort(
    (a, b) => new Date(a?.date || 0).getTime() - new Date(b?.date || 0).getTime()
  );
  const latestNonSale = sortedNonSales.length > 0 ? sortedNonSales[sortedNonSales.length - 1] : null;
  const firstNonSale = sortedNonSales.length > 0 ? sortedNonSales[0] : null;

  return {
    batchId: client?.batch?.id || client?.batchId || null,
    batchName: client?.batch?.name || null,
    photographerId: client?.photographer?.id || client?.photographerId || null,
    photographerName: client?.photographer?.name || null,
    currentSellerId: client?.assignedSeller?.id || client?.assignedSellerId || null,
    currentSellerName: client?.assignedSeller?.name || null,
    originSellerId: firstNonSale?.seller?.id || firstNonSale?.sellerId || null,
    originSellerName: firstNonSale?.seller?.name || null,
    lastSellerId:
      latestNonSale?.seller?.id ||
      latestNonSale?.sellerId ||
      client?.assignedSeller?.id ||
      client?.assignedSellerId ||
      null,
    lastSellerName:
      latestNonSale?.seller?.name ||
      client?.assignedSeller?.name ||
      null,
    lastReason: latestNonSale?.reason || client?.outcomeStatus || null,
    nonSaleCount: sortedNonSales.length,
  };
}
