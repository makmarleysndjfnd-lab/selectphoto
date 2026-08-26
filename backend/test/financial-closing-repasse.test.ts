import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveSellerCommissionRate } from '../src/utils/commission';

describe('Financial Closing & Repasse Calculation Logic', () => {
  it('Regra automática: carro da empresa recebe 20%', () => {
    assert.strictEqual(resolveSellerCommissionRate({ usesOwnCar: false }), 0.20);
  });

  it('Regra automática: carro próprio recebe 25%', () => {
    assert.strictEqual(resolveSellerCommissionRate({ usesOwnCar: true }), 0.25);
  });
  function calculateRepasse(
    sales: Array<{ value: number; paymentMethod: string }>,
    commissionRate: number,
    historicalBalance: number = 0,
    hasExistingClosing: boolean = false
  ) {
    let totalSalesValue = 0;
    let cashValue = 0;
    let pixValue = 0;
    let debitValue = 0;
    let creditValue = 0;

    sales.forEach(sale => {
      totalSalesValue += sale.value;
      const pm = (sale.paymentMethod || '').toUpperCase();
      if (pm === 'CASH' || pm === 'DINHEIRO') cashValue += sale.value;
      else if (pm === 'PIX') pixValue += sale.value;
      else if (pm === 'DEBIT' || pm === 'DEBITO') debitValue += sale.value;
      else if (pm === 'CREDIT' || pm === 'CREDITO') creditValue += sale.value;
      else pixValue += sale.value;
    });

    const commissionAmount = Number((totalSalesValue * commissionRate).toFixed(2));
    const netDailySellerRepasse = Number((cashValue - commissionAmount).toFixed(2));

    let sellerOwesCompany = 0;
    let companyOwesSeller = 0;

    if (netDailySellerRepasse > 0) {
      sellerOwesCompany = netDailySellerRepasse;
    } else if (netDailySellerRepasse < 0) {
      companyOwesSeller = Math.abs(netDailySellerRepasse);
    }

    const finalNet = Number((historicalBalance + (hasExistingClosing ? 0 : netDailySellerRepasse)).toFixed(2));
    let finalDirection: 'SELLER_PAYS_COMPANY' | 'COMPANY_PAYS_SELLER' | 'SETTLED' = 'SETTLED';
    let finalAmount = 0;

    if (finalNet > 0.01) {
      finalDirection = 'SELLER_PAYS_COMPANY';
      finalAmount = finalNet;
    } else if (finalNet < -0.01) {
      finalDirection = 'COMPANY_PAYS_SELLER';
      finalAmount = Math.abs(finalNet);
    }

    return {
      totalSalesValue,
      cashValue,
      pixValue,
      debitValue,
      creditValue,
      commissionAmount,
      sellerOwesCompany,
      companyOwesSeller,
      historicalBalance,
      finalDirection,
      finalAmount,
    };
  }

  it('Cenário 1: Venda de R$ 1.000 no crédito com 25% comissão -> empresa deve R$ 250 ao vendedor', () => {
    const result = calculateRepasse([{ value: 1000, paymentMethod: 'CREDIT' }], 0.25);
    assert.strictEqual(result.totalSalesValue, 1000);
    assert.strictEqual(result.creditValue, 1000);
    assert.strictEqual(result.cashValue, 0);
    assert.strictEqual(result.commissionAmount, 250);
    assert.strictEqual(result.sellerOwesCompany, 0);
    assert.strictEqual(result.companyOwesSeller, 250);
    assert.strictEqual(result.finalDirection, 'COMPANY_PAYS_SELLER');
    assert.strictEqual(result.finalAmount, 250);
  });

  it('Cenário 2: Venda de R$ 1.000 em dinheiro com 25% comissão -> vendedor deve R$ 750 à empresa', () => {
    const result = calculateRepasse([{ value: 1000, paymentMethod: 'CASH' }], 0.25);
    assert.strictEqual(result.totalSalesValue, 1000);
    assert.strictEqual(result.cashValue, 1000);
    assert.strictEqual(result.commissionAmount, 250);
    assert.strictEqual(result.sellerOwesCompany, 750);
    assert.strictEqual(result.companyOwesSeller, 0);
    assert.strictEqual(result.finalDirection, 'SELLER_PAYS_COMPANY');
    assert.strictEqual(result.finalAmount, 750);
  });

  it('Cenário 3: Venda de R$ 1.000 no PIX com 25% comissão -> empresa deve R$ 250 ao vendedor', () => {
    const result = calculateRepasse([{ value: 1000, paymentMethod: 'PIX' }], 0.25);
    assert.strictEqual(result.totalSalesValue, 1000);
    assert.strictEqual(result.pixValue, 1000);
    assert.strictEqual(result.cashValue, 0);
    assert.strictEqual(result.commissionAmount, 250);
    assert.strictEqual(result.sellerOwesCompany, 0);
    assert.strictEqual(result.companyOwesSeller, 250);
    assert.strictEqual(result.finalDirection, 'COMPANY_PAYS_SELLER');
    assert.strictEqual(result.finalAmount, 250);
  });

  it('Cenário 4: Quitação histórica reduz o saldo exatamente a zero', () => {
    // Vendedor devia 750 de um dia em dinheiro
    const previousDebt = 750;
    // Realiza pagamento de 750
    const payment = -750;
    const historicalBalance = previousDebt + payment;

    const result = calculateRepasse([], 0.20, historicalBalance);
    assert.strictEqual(result.historicalBalance, 0);
    assert.strictEqual(result.finalDirection, 'SETTLED');
    assert.strictEqual(result.finalAmount, 0);
  });
});
