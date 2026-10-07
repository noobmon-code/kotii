import { describe, expect, it } from '@jest/globals';

import type { FinAccount, FinTransaction } from '@/lib/types';

import {
  accountLabels,
  type BankPurchase,
  cardBills,
  effectiveDate,
  futureInstallments,
  groupPurchases,
  merchantFromDescriptor,
  monthSummary,
  stripParcelMarker,
} from '../bankMonth';

const OWNER = 'a'.repeat(64);

const account = (over: Partial<FinAccount>): FinAccount => ({
  id: 'acc',
  connection_id: 'conn-nu',
  pluggy_account_id: `p-${over.id ?? 'acc'}`,
  type: 'BANK',
  subtype: 'CHECKING_ACCOUNT',
  name: null,
  marketing_name: null,
  number_last4: null,
  owner_doc_hash: OWNER,
  balance: null,
  currency_code: 'BRL',
  credit_limit: null,
  available_credit: null,
  bill_due_date: null,
  bill_close_date: null,
  minimum_payment: null,
  updated_at: '2026-10-07T12:00:00Z',
  ...over,
});

const nuChecking = account({ id: 'nu-conta' });
const nuCard = account({ id: 'nu-cartao', type: 'CREDIT', subtype: 'CREDIT_CARD' });
const interChecking = account({ id: 'inter-conta', connection_id: 'conn-inter' });
const accounts = [nuChecking, nuCard, interChecking];

let seq = 0;
const tx = (over: Partial<FinTransaction>): FinTransaction => {
  seq += 1;
  return {
    id: `t${seq}`,
    account_id: nuChecking.id,
    pluggy_transaction_id: `p${seq}`,
    status: 'POSTED',
    direction: 'DEBIT',
    amount: 10,
    original_amount: null,
    original_currency: null,
    occurred_on: '2026-10-05',
    purchase_on: null,
    description: 'COMPRA',
    description_raw: null,
    category_id: null,
    category: null,
    operation_type: null,
    payment_method: null,
    merchant_name: null,
    merchant_cnpj: null,
    counterparty_name: null,
    counterparty_doc_kind: null,
    counterparty_doc_hash: null,
    counterparty_cnpj: null,
    boleto_barcode: null,
    installment_number: null,
    total_installments: null,
    card_bill_id: null,
    bill_forecast: null,
    other_credits_type: null,
    fee_type: null,
    deleted_at: null,
    first_seen_at: '2026-10-05T12:00:00Z',
    updated_at: '2026-10-05T12:00:00Z',
    ...over,
  };
};

const parcel = (n: number, total: number, over: Partial<FinTransaction>) =>
  tx({ account_id: nuCard.id, installment_number: n, total_installments: total, ...over });

describe('effectiveDate', () => {
  it('compra no cartão conta na data da compra; sem ela, na do banco', () => {
    expect(effectiveDate({ purchase_on: '2026-09-30', occurred_on: '2026-10-02' })).toBe('2026-09-30');
    expect(effectiveDate({ purchase_on: null, occurred_on: '2026-10-02' })).toBe('2026-10-02');
  });
});

describe('stripParcelMarker / merchantFromDescriptor', () => {
  it('tira a marca da parcela', () => {
    expect(stripParcelMarker('MAGALU 02/10')).toBe('MAGALU');
    expect(stripParcelMarker('LOJA X PARC 02/10')).toBe('LOJA X');
    expect(stripParcelMarker('Loja Y - Parcela 3/12')).toBe('Loja Y');
    expect(stripParcelMarker('Loja (2/10)')).toBe('Loja');
    expect(stripParcelMarker('AMAZON 2 de 10')).toBe('AMAZON');
  });

  it('a loja vem depois do "*" da maquininha', () => {
    expect(merchantFromDescriptor('MERCADOPAGO*LOJA')).toBe('LOJA');
    expect(merchantFromDescriptor('MP*PADARIA REAL')).toBe('PADARIA REAL');
    expect(merchantFromDescriptor('PAYPAL *NETFLIX')).toBe('NETFLIX');
    expect(merchantFromDescriptor('UBER *TRIP')).toBeNull();
    expect(merchantFromDescriptor('SUPERMERCADO BOM')).toBeNull();
  });
});

describe('groupPurchases', () => {
  it('deixa de fora o que sumiu da Pluggy', () => {
    const purchases = groupPurchases([tx({}), tx({ deleted_at: '2026-10-06T00:00:00Z' })], accounts);
    expect(purchases).toHaveLength(1);
  });

  it('cartão sem data da compra (Nubank) usa a data do banco', () => {
    const [p] = groupPurchases([tx({ account_id: nuCard.id, occurred_on: '2026-10-03', description: 'PADARIA' })], accounts);
    expect(p.date).toBe('2026-10-03');
  });

  it('duas compras iguais no mesmo dia continuam duas', () => {
    const same = { account_id: nuCard.id, amount: 25, description: 'PADARIA REAL', purchase_on: '2026-10-04' };
    const purchases = groupPurchases([tx(same), tx(same)], accounts);
    expect(purchases).toHaveLength(2);
    expect(monthSummary(purchases, '2026-10')).toMatchObject({ spending: 50, count: 2 });
  });

  it('junta as parcelas 1/10 a 3/10 numa compra de 10x a parcela, na data da compra', () => {
    const base = { amount: 150, purchase_on: '2026-08-05', merchant_name: 'Magazine Luiza' };
    const purchases = groupPurchases(
      [
        parcel(1, 10, { ...base, occurred_on: '2026-08-05', description: 'MAGALU 01/10' }),
        parcel(2, 10, { ...base, occurred_on: '2026-09-05', description: 'MAGALU 02/10' }),
        parcel(3, 10, { ...base, occurred_on: '2026-10-05', description: 'MAGALU 03/10' }),
      ],
      accounts,
    );
    expect(purchases).toHaveLength(1);
    expect(purchases[0]).toMatchObject({
      date: '2026-08-05',
      amount: 1500,
      description: 'MAGALU',
      merchantName: 'Magazine Luiza',
      kind: 'spending',
      installments: { seen: [1, 2, 3], total: 10, parcel: 150 },
    });
    expect(purchases[0].txIds).toHaveLength(3);
    expect(monthSummary(purchases, '2026-08').spending).toBe(1500);
    expect(monthSummary(purchases, '2026-10').spending).toBe(0);
  });

  it('duas compras parceladas iguais viram duas', () => {
    const base = { amount: 150, purchase_on: '2026-08-05', description: 'MAGALU' };
    const purchases = groupPurchases(
      [
        parcel(1, 10, { ...base, occurred_on: '2026-08-05' }),
        parcel(1, 10, { ...base, occurred_on: '2026-08-05' }),
        parcel(2, 10, { ...base, occurred_on: '2026-09-05' }),
        parcel(2, 10, { ...base, occurred_on: '2026-09-05' }),
      ],
      accounts,
    );
    expect(purchases).toHaveLength(2);
    expect(purchases.map((p) => [p.amount, p.installments?.seen])).toEqual([
      [1500, [1, 2]],
      [1500, [1, 2]],
    ]);
  });

  it('sem a data da compra, estima pela parcela e junta mesmo com dias de fatura diferentes', () => {
    const purchases = groupPurchases(
      [
        parcel(2, 3, { amount: 80, occurred_on: '2026-09-07', description: 'LOJA Z 2/3' }),
        parcel(3, 3, { amount: 80, occurred_on: '2026-10-06', description: 'LOJA Z 3/3' }),
      ],
      accounts,
    );
    expect(purchases).toHaveLength(1);
    expect(purchases[0]).toMatchObject({ date: '2026-08-07', amount: 240 });
  });

  it('a sobra dos centavos na primeira parcela não separa a compra', () => {
    const base = { purchase_on: '2026-10-01', description: 'LOJA' };
    const purchases = groupPurchases(
      [
        parcel(1, 3, { ...base, amount: 33.34 }),
        parcel(2, 3, { ...base, amount: 33.33 }),
        parcel(3, 3, { ...base, amount: 33.33 }),
      ],
      accounts,
    );
    expect(purchases).toHaveLength(1);
    expect(purchases[0].amount).toBe(100);
  });

  it('só uma parcela na janela ainda vale a compra inteira', () => {
    const [p] = groupPurchases([parcel(3, 10, { amount: 99.9, purchase_on: '2025-08-01', occurred_on: '2025-10-01' })], accounts);
    expect(p).toMatchObject({ date: '2025-08-01', amount: 999 });
  });

  it('compra em moeda estrangeira vale o valor em reais', () => {
    const [p] = groupPurchases(
      [tx({ account_id: nuCard.id, amount: 55.3, original_amount: 10, original_currency: 'USD', description: 'STEAM' })],
      accounts,
    );
    expect(p.amount).toBe(55.3);
  });

  it('nome da loja: o da Pluggy, a empresa do PIX ou o que vem depois do "*"', () => {
    const [fromDescriptor] = groupPurchases([tx({ description: 'MERCADOPAGO*LOJA' })], accounts);
    expect(fromDescriptor.merchantName).toBe('LOJA');
    const [fromPluggy] = groupPurchases([tx({ description: 'MERCADOPAGO*LOJA', merchant_name: 'Loja Bonita' })], accounts);
    expect(fromPluggy.merchantName).toBe('Loja Bonita');
    const [company] = groupPurchases(
      [
        tx({
          description: 'Pix enviado',
          counterparty_name: 'Padaria Real Ltda',
          counterparty_doc_kind: 'CNPJ',
          counterparty_cnpj: '12345678000199',
        }),
      ],
      accounts,
    );
    expect(company).toMatchObject({ merchantName: 'Padaria Real Ltda', merchantCnpj: '12345678000199', personTransfer: false });
  });

  it('PIX para pessoa é marcado; o nome da pessoa não vira loja', () => {
    const [p] = groupPurchases(
      [tx({ description: 'Pix enviado', counterparty_name: 'Maria Silva', counterparty_doc_kind: 'CPF', counterparty_doc_hash: 'c'.repeat(64) })],
      accounts,
    );
    expect(p).toMatchObject({ kind: 'spending', personTransfer: true, merchantName: null });
  });

  it('marca saúde e afins como sensível', () => {
    const [p] = groupPurchases([tx({ description: 'DROGASIL 123', category: 'Pharmacy' })], accounts);
    expect(p).toMatchObject({ category: 'saude', sensitive: true });
  });
});

describe('monthSummary', () => {
  it('fronteira do mês pela data da compra', () => {
    const purchases = groupPurchases(
      [
        tx({ account_id: nuCard.id, amount: 100, purchase_on: '2026-09-30', occurred_on: '2026-10-02' }),
        tx({ amount: 40, occurred_on: '2026-10-01' }),
        tx({ amount: 7, occurred_on: '2026-10-31' }),
        tx({ amount: 9, occurred_on: '2026-11-01' }),
      ],
      accounts,
    );
    expect(monthSummary(purchases, '2026-09').spending).toBe(100);
    expect(monthSummary(purchases, '2026-10').spending).toBe(47);
    expect(monthSummary(purchases, '2026-11').spending).toBe(9);
  });

  it('PIX entre contas da dona, aplicação e fatura paga não contam', () => {
    const purchases = groupPurchases(
      [
        tx({ amount: 500, description: 'Pix enviado', counterparty_doc_hash: OWNER }),
        tx({ account_id: interChecking.id, amount: 500, direction: 'CREDIT', description: 'Pix recebido', counterparty_doc_hash: OWNER }),
        tx({ amount: 300, description: 'Aplicação RDB' }),
        tx({ amount: 2000, description: 'Pagamento de fatura' }),
        tx({ account_id: nuCard.id, amount: 2000, direction: 'CREDIT', description: 'Pagamento recebido' }),
        tx({ account_id: nuCard.id, amount: 80, description: 'PADARIA REAL', category: 'Groceries' }),
      ],
      accounts,
    );
    expect(purchases.filter((p) => p.kind === 'internal')).toHaveLength(2);
    expect(purchases.filter((p) => p.kind === 'card_payment')).toHaveLength(2);
    expect(monthSummary(purchases, '2026-10')).toEqual({
      spending: 80,
      income: 0,
      refunds: 0,
      pending: 0,
      byCategory: [{ category: 'mercado', amount: 80 }],
      count: 1,
    });
  });

  it('estorno abate da categoria; previsto e entradas aparecem à parte', () => {
    const purchases = groupPurchases(
      [
        tx({ account_id: nuCard.id, amount: 200, description: 'SUPERMERCADO BOM' }),
        tx({ account_id: nuCard.id, amount: 50, direction: 'CREDIT', description: 'Estorno SUPERMERCADO BOM' }),
        tx({ account_id: nuCard.id, amount: 60, description: 'UBER *TRIP', status: 'PENDING' }),
        tx({ amount: 5000, direction: 'CREDIT', description: 'Salário', category: 'Salary' }),
      ],
      accounts,
    );
    expect(monthSummary(purchases, '2026-10')).toEqual({
      spending: 210,
      income: 5000,
      refunds: 50,
      pending: 60,
      byCategory: [
        { category: 'mercado', amount: 150 },
        { category: 'transporte', amount: 60 },
      ],
      count: 2,
    });
  });
});

describe('futureInstallments', () => {
  const purchase = (over: Partial<BankPurchase>): BankPurchase => ({
    key: 'k',
    date: '2026-08-05',
    amount: 1500,
    description: 'MAGALU',
    merchantName: null,
    merchantCnpj: null,
    category: 'outros',
    kind: 'spending',
    pending: false,
    accountId: nuCard.id,
    installments: { seen: [1, 2, 3], total: 10, parcel: 150 },
    txIds: [],
    personTransfer: false,
    sensitive: false,
    ...over,
  });

  it('põe cada parcela que falta no mês em que cai', () => {
    const months = futureInstallments(
      [
        purchase({}),
        purchase({ key: 'fin', date: '2026-10-10', kind: 'financing', installments: { seen: [1], total: 2, parcel: 400 } }),
        purchase({ key: 'avista', installments: null }),
      ],
      '2026-11',
      3,
    );
    expect(months.map((m) => [m.month, m.amount, m.parcels.map((p) => `${p.key} ${p.number}/${p.total}`)])).toEqual([
      ['2026-11', 550, ['k 4/10', 'fin 2/2']],
      ['2026-12', 150, ['k 5/10']],
      ['2027-01', 150, ['k 6/10']],
    ]);
  });

  it('meses sem parcela vêm com zero', () => {
    expect(futureInstallments([purchase({ installments: { seen: [1], total: 2, parcel: 10 } })], '2027-01', 2)).toEqual([
      { month: '2027-01', amount: 0, parcels: [] },
      { month: '2027-02', amount: 0, parcels: [] },
    ]);
  });
});

describe('accountLabels / cardBills', () => {
  const connections = [
    { id: 'conn-nu', label: 'Nubank' },
    { id: 'conn-inter', label: 'Inter' },
  ];

  it('nome curto de cada conta, com número quando repete', () => {
    const labels = accountLabels(
      [
        nuChecking,
        nuCard,
        account({ id: 'nu-cartao-2', type: 'CREDIT', subtype: 'CREDIT_CARD' }),
        account({ id: 'inter-poupanca', connection_id: 'conn-inter', subtype: 'SAVINGS_ACCOUNT' }),
      ],
      connections,
    );
    expect([...labels.values()]).toEqual(['Nubank conta', 'Nubank cartão', 'Nubank cartão 2', 'Inter poupança']);
  });

  it('fatura do jeito que o banco informa, pela data de vencimento', () => {
    const cards = [
      account({ id: 'c1', type: 'CREDIT', balance: 900, bill_due_date: '2026-10-20', connection_id: 'conn-inter' }),
      account({ id: 'c2', type: 'CREDIT', balance: 2300, bill_due_date: '2026-10-10', bill_close_date: '2026-10-03', minimum_payment: 345 }),
    ];
    const bills = cardBills([nuChecking, ...cards], accountLabels(cards, connections));
    expect(bills.map((b) => [b.label, b.amount, b.dueDate, b.minimumPayment])).toEqual([
      ['Nubank cartão', 2300, '2026-10-10', 345],
      ['Inter cartão', 900, '2026-10-20', null],
    ]);
  });
});
