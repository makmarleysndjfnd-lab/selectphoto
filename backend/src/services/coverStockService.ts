import { prisma } from './prisma';

export const ADMIN_COVER_ROLES = ['ADMIN', 'COMPANY_ADMIN', 'SUPERVISOR', 'SUPER_ADMIN'];
export const SELLER_COVER_ROLES = ['SELLER', 'SELLER_MANAGER'];

export function resolveSaleHasCover(rawHasCover: any, product?: string | null): boolean {
  const prodNorm = String(product || '').trim().toLowerCase();
  if (prodNorm.includes('sem capa')) {
    return false;
  }
  if (rawHasCover === false || rawHasCover === 'false' || rawHasCover === 0 || rawHasCover === '0') {
    return false;
  }
  if (rawHasCover === true || rawHasCover === 'true' || rawHasCover === 1 || rawHasCover === '1') {
    return true;
  }
  return true;
}

/**
 * Reconcilia vendas confirmadas (status = 'PRONTO', hasCover = true, coverDeducted = false)
 * descontando automaticamente do saldo de capas em posse do vendedor quando houver saldo (> 0).
 */
export async function reconcilePendingSellerCoverDeductions(
  tx: any,
  sellerId: string
): Promise<number> {
  try {
    if (!tx?.sellerCoverBalance?.findUnique || !tx?.sale?.findMany) {
      return 0;
    }

    const balanceRecord = await tx.sellerCoverBalance.findUnique({
      where: { sellerId },
    });

    if (!balanceRecord || balanceRecord.balance <= 0) {
      return 0;
    }

    const pendingSales = await tx.sale.findMany({
      where: {
        sellerId,
        hasCover: true,
        coverDeducted: false,
        status: 'PRONTO',
      },
      select: { id: true },
      orderBy: { date: 'asc' },
    });

    if (!Array.isArray(pendingSales) || pendingSales.length === 0) {
      return 0;
    }

    const toDeduct = Math.min(balanceRecord.balance, pendingSales.length);
    if (toDeduct <= 0) {
      return 0;
    }

    const saleIdsToMark = pendingSales.slice(0, toDeduct).map((s: any) => s.id);

    await tx.sellerCoverBalance.update({
      where: { sellerId },
      data: { balance: balanceRecord.balance - toDeduct },
    });

    if (tx.sale.updateMany) {
      await tx.sale.updateMany({
        where: { id: { in: saleIdsToMark } },
        data: { coverDeducted: true },
      });
    } else {
      for (const sId of saleIdsToMark) {
        await tx.sale.update({
          where: { id: sId },
          data: { coverDeducted: true },
        });
      }
    }

    return toDeduct;
  } catch (err) {
    console.warn('[CoverStockService] Aviso ao reconciliar baixas de capas do vendedor:', err);
    return 0;
  }
}

/**
 * Dá baixa de 1 capa do saldo do vendedor ao confirmar uma venda com capa.
 */
export async function deductCoverForSellerSale(
  tx: any,
  params: { saleId: string; sellerId: string; hasCover: boolean }
): Promise<boolean> {
  if (!params.hasCover) return false;

  try {
    if (!tx?.sellerCoverBalance?.findUnique) return false;

    const currentBalance = await tx.sellerCoverBalance.findUnique({
      where: { sellerId: params.sellerId },
    });

    if (currentBalance && currentBalance.balance > 0) {
      await tx.sellerCoverBalance.update({
        where: { sellerId: params.sellerId },
        data: { balance: currentBalance.balance - 1 },
      });

      if (tx?.sale?.update) {
        await tx.sale.update({
          where: { id: params.saleId },
          data: { coverDeducted: true },
        });
      }
      return true;
    }
    return false;
  } catch (err) {
    console.warn('[CoverStockService] Aviso ao dar baixa de capa na venda:', err);
    return false;
  }
}

/**
 * Estorna 1 capa de volta ao saldo do vendedor quando uma venda que já teve baixa de capa é cancelada/estornada.
 */
export async function restoreCoverForCanceledSale(
  tx: any,
  params: { saleId: string; sellerId: string; wasDeducted: boolean }
): Promise<boolean> {
  if (!params.wasDeducted) return false;

  try {
    if (!tx?.sellerCoverBalance?.findUnique) return false;

    const currentBalance = await tx.sellerCoverBalance.findUnique({
      where: { sellerId: params.sellerId },
    });

    if (currentBalance) {
      await tx.sellerCoverBalance.update({
        where: { sellerId: params.sellerId },
        data: { balance: currentBalance.balance + 1 },
      });
    } else {
      await tx.sellerCoverBalance.create({
        data: { sellerId: params.sellerId, balance: 1 },
      });
    }

    if (tx?.sale?.update) {
      await tx.sale.update({
        where: { id: params.saleId },
        data: { coverDeducted: false },
      });
    }

    return true;
  } catch (err) {
    console.warn('[CoverStockService] Aviso ao restaurar capa de venda cancelada:', err);
    return false;
  }
}

/**
 * Reconcilia o estoque de capas da empresa:
 * 1. Converte saldos fantasmas em SellerCoverBalance de usuários ADMIN/SUPERVISOR em devolução para o estoque central (SellerCoverTransfer negativo).
 * 2. Aplica baixas pendentes de vendas confirmadas com capa (hasCover = true, coverDeducted = false) nos vendedores com saldo.
 */
export async function reconcileCompanyCoverStock(companyId: string): Promise<void> {
  try {
    const allBalances = await prisma.sellerCoverBalance.findMany({
      where: {
        balance: { gt: 0 },
        seller: { companyId },
      },
      include: {
        seller: {
          select: { id: true, role: true, companyId: true },
        },
      },
    });

    for (const bal of allBalances) {
      const role = bal.seller?.role || '';
      if (ADMIN_COVER_ROLES.includes(role) && bal.balance > 0) {
        // Devolução que havia caído em SellerCoverBalance do Admin em vez do estoque central
        await prisma.$transaction(async (tx) => {
          const fresh = await tx.sellerCoverBalance.findUnique({
            where: { id: bal.id },
          });
          if (!fresh || fresh.balance <= 0) return;

          await tx.sellerCoverBalance.update({
            where: { id: bal.id },
            data: { balance: 0 },
          });

          await tx.sellerCoverTransfer.create({
            data: {
              sellerId: bal.sellerId,
              adminId: bal.sellerId,
              quantity: -fresh.balance,
              companyId,
            },
          });
        });
      } else if (SELLER_COVER_ROLES.includes(role) && bal.balance > 0) {
        await prisma.$transaction(async (tx) => {
          await reconcilePendingSellerCoverDeductions(tx, bal.sellerId);
        });
      }
    }
  } catch (err) {
    console.warn('[CoverStockService] Aviso ao reconciliar estoque de capas da empresa:', err);
  }
}
