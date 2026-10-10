import { describe, expect, it } from '@jest/globals';

import type { BankPurchase } from '@/domain/bankMonth';

import { installmentSummary, purchaseDetails } from '../bankPurchaseText';

const purchase = (over: Partial<BankPurchase>): BankPurchase => ({
  key: 'k',
  date: '2026-10-07',
  amount: 150,
  description: 'MAGALU',
  merchantName: null,
  merchantCnpj: null,
  category: 'compras',
  autoCategory: 'compras',
  categorySource: 'auto',
  similarKey: null,
  kind: 'spending',
  pending: false,
  accountId: 'nu-cartao',
  installment: null,
  ruleKey: 'k',
  ruleKeys: ['k'],
  txIds: ['t1'],
  personTransfer: false,
  sensitive: false,
  storeName: null,
  refundOf: null,
  refundParts: [],
  ...over,
});

const installment = {
  seriesKey: 'parc-t1',
  number: 2,
  total: 10,
  parcel: 150,
  purchaseDate: '2026-09-07',
  purchaseExact: true,
  purchaseAmount: 1500,
  seen: [1, 2],
};

describe('purchaseDetails / installmentSummary', () => {
  const labels = new Map([['nu-cartao', 'Nubank cartão']]);

  it('a parcela diz qual é; a compra à vista, não', () => {
    expect(purchaseDetails(purchase({ installment, pending: true }), labels)).toMatch(/ · Nubank cartão · parcela 2 de 10 · previsto$/);
    expect(purchaseDetails(purchase({}), labels)).toMatch(/ · Nubank cartão$/);
  });

  it('o resumo da compra parcelada inteira; a data estimada vai só com o mês', () => {
    expect(installmentSummary(purchase({}))).toBeNull();
    expect(installmentSummary(purchase({ installment }))).toMatch(/^Parcelado: R\$\s1\.500,00 em 10x, a 1ª em 7 set( 2026)?$/);
    expect(installmentSummary(purchase({ installment: { ...installment, purchaseExact: false } }))).toMatch(
      /, a 1ª por volta de setembro de 2026$/,
    );
  });
});
