import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSaleHasCover,
  deductCoverForSellerSale,
  restoreCoverForCanceledSale,
  reconcilePendingSellerCoverDeductions,
} from '../src/services/coverStockService';

test('Cover Stock Metrics & Automatic Sale Write-Off Suite', async (t) => {
  await t.test('1. resolveSaleHasCover: respeita flag explícito e regra de Book sem capa', () => {
    assert.equal(resolveSaleHasCover(true, 'Book completo capa +Book+mídias'), true);
    assert.equal(resolveSaleHasCover(true, 'Book sem mídias'), true);
    assert.equal(resolveSaleHasCover(false, 'Book com defeito'), false);
    assert.equal(resolveSaleHasCover(true, 'Book com defeito'), true);
    assert.equal(resolveSaleHasCover(undefined, 'Book completo capa +Book+mídias'), true);
    assert.equal(resolveSaleHasCover(undefined, 'Book sem capa'), false);
    assert.equal(resolveSaleHasCover(true, 'Book sem capa'), false);
  });

  await t.test('2. Baixa automática ao vender (deductCoverForSellerSale) e estorno ao cancelar (restoreCoverForCanceledSale)', async () => {
    const state = {
      balances: new Map<string, number>([['seller-1', 10]]),
      sales: new Map<string, { id: string; sellerId: string; hasCover: boolean; coverDeducted: boolean; status: string }>([
        ['sale-with-cover', { id: 'sale-with-cover', sellerId: 'seller-1', hasCover: true, coverDeducted: false, status: 'PRONTO' }],
        ['sale-without-cover', { id: 'sale-without-cover', sellerId: 'seller-1', hasCover: false, coverDeducted: false, status: 'PRONTO' }],
      ]),
    };

    const mockTx: any = {
      sellerCoverBalance: {
        findUnique: async ({ where }: any) => {
          const bal = state.balances.get(where.sellerId);
          return bal !== undefined ? { id: `bal-${where.sellerId}`, sellerId: where.sellerId, balance: bal } : null;
        },
        update: async ({ where, data }: any) => {
          const next = data.balance;
          state.balances.set(where.sellerId, next);
          return { id: `bal-${where.sellerId}`, sellerId: where.sellerId, balance: next };
        },
        create: async ({ data }: any) => {
          state.balances.set(data.sellerId, data.balance);
          return { id: `bal-${data.sellerId}`, sellerId: data.sellerId, balance: data.balance };
        },
      },
      sale: {
        update: async ({ where, data }: any) => {
          const s = state.sales.get(where.id)!;
          const updated = { ...s, ...data };
          state.sales.set(where.id, updated);
          return updated;
        },
      },
    };

    // Venda sem capa: não deve dar baixa
    const deductedNoCover = await deductCoverForSellerSale(mockTx, {
      saleId: 'sale-without-cover',
      sellerId: 'seller-1',
      hasCover: false,
    });
    assert.equal(deductedNoCover, false);
    assert.equal(state.balances.get('seller-1'), 10);
    assert.equal(state.sales.get('sale-without-cover')?.coverDeducted, false);

    // Venda com capa: deve dar baixa de 1 capa no saldo do vendedor e marcar coverDeducted = true
    const deductedWithCover = await deductCoverForSellerSale(mockTx, {
      saleId: 'sale-with-cover',
      sellerId: 'seller-1',
      hasCover: true,
    });
    assert.equal(deductedWithCover, true);
    assert.equal(state.balances.get('seller-1'), 9);
    assert.equal(state.sales.get('sale-with-cover')?.coverDeducted, true);

    // Cancelamento da venda com capa: deve estornar +1 capa ao saldo do vendedor
    const restored = await restoreCoverForCanceledSale(mockTx, {
      saleId: 'sale-with-cover',
      sellerId: 'seller-1',
      wasDeducted: true,
    });
    assert.equal(restored, true);
    assert.equal(state.balances.get('seller-1'), 10);
    assert.equal(state.sales.get('sale-with-cover')?.coverDeducted, false);
  });

  await t.test('3. Reconciliação de vendas pendentes de baixa quando vendedor recebe capas', async () => {
    const state = {
      balance: 3,
      pendingSales: [
        { id: 's1', date: new Date('2026-11-01T10:00:00Z'), coverDeducted: false },
        { id: 's2', date: new Date('2026-11-02T10:00:00Z'), coverDeducted: false },
      ],
    };

    const mockTx: any = {
      sellerCoverBalance: {
        findUnique: async () => ({ id: 'bal-1', sellerId: 'seller-1', balance: state.balance }),
        update: async ({ data }: any) => {
          state.balance = data.balance;
          return { id: 'bal-1', sellerId: 'seller-1', balance: state.balance };
        },
      },
      sale: {
        findMany: async () => state.pendingSales.filter((s) => !s.coverDeducted),
        updateMany: async ({ where, data }: any) => {
          const ids: string[] = where.id.in;
          for (const s of state.pendingSales) {
            if (ids.includes(s.id)) s.coverDeducted = data.coverDeducted;
          }
          return { count: ids.length };
        },
      },
    };

    const count = await reconcilePendingSellerCoverDeductions(mockTx, 'seller-1');
    assert.equal(count, 2);
    assert.equal(state.balance, 1);
    assert.equal(state.pendingSales.every((s) => s.coverDeducted), true);
  });
});
