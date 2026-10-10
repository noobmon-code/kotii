import { describe, expect, it } from '@jest/globals';

import type { FinAccount, FinTransaction } from '@/lib/types';

import { addMonths } from '../dates';
import {
  accountLabels,
  type BankPurchase,
  cardBills,
  currentAccounts,
  effectiveDate,
  financeInstallmentFetchStart,
  futureInstallments,
  groupPurchases,
  merchantFromDescriptor,
  monthSummary,
  stripParcelMarker,
  windowPurchases,
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
// Santander: a "data da compra" vem carimbada parcela por parcela.
const sanChecking = account({ id: 'san-conta', connection_id: 'conn-san' });
const sanCard = account({ id: 'san-cartao', connection_id: 'conn-san', type: 'CREDIT', subtype: 'CREDIT_CARD' });
const allAccounts = [...accounts, sanChecking, sanCard];

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

/** [descrição, dia, valor, número da parcela] de cada lançamento. */
const rows = (purchases: BankPurchase[]) => purchases.map((p) => [p.description, p.date, p.amount, p.installment?.number ?? null]);
const seriesOf = (purchases: BankPurchase[]) => new Set(purchases.map((p) => p.installment?.seriesKey));

describe('effectiveDate', () => {
  it('compra no cartão conta na data da compra; sem ela, na do banco', () => {
    expect(effectiveDate({ purchase_on: '2026-09-30', occurred_on: '2026-10-02' })).toBe('2026-09-30');
    expect(effectiveDate({ purchase_on: null, occurred_on: '2026-10-02' })).toBe('2026-10-02');
  });

  it('data da compra mais de um ciclo de fatura antes não é desta cobrança: vale a do lançamento', () => {
    expect(effectiveDate({ purchase_on: '2026-04-10', occurred_on: '2026-10-02' })).toBe('2026-10-02');
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

  it('compra parcelada conta mês a mês: cada parcela no mês dela, com o valor dela', () => {
    const base = { amount: 150, purchase_on: '2026-08-05', merchant_name: 'Magazine Luiza' };
    const first = parcel(1, 10, { ...base, occurred_on: '2026-08-05', description: 'MAGALU 01/10' });
    const purchases = groupPurchases(
      [
        first,
        parcel(2, 10, { ...base, occurred_on: '2026-09-05', description: 'MAGALU 02/10' }),
        parcel(3, 10, { ...base, occurred_on: '2026-10-05', description: 'MAGALU 03/10' }),
      ],
      accounts,
    );
    expect(rows(purchases)).toEqual([
      ['MAGALU', '2026-10-05', 150, 3],
      ['MAGALU', '2026-09-05', 150, 2],
      ['MAGALU', '2026-08-05', 150, 1],
    ]);
    // Cada parcela tem a própria chave; a compra inteira, uma "serie-" com o id da 1ª parcela.
    expect(new Set(purchases.map((p) => p.key)).size).toBe(3);
    expect(purchases.every((p) => p.txIds.length === 1)).toBe(true);
    expect(purchases[0]).toMatchObject({
      merchantName: 'Magazine Luiza',
      kind: 'spending',
      installment: {
        seriesKey: `serie-${first.id}`,
        number: 3,
        total: 10,
        parcel: 150,
        purchaseDate: '2026-08-05',
        purchaseExact: true,
        purchaseAmount: 1500,
        seen: [1, 2, 3],
      },
    });
    expect(['2026-08', '2026-09', '2026-10'].map((m) => monthSummary(purchases, m))).toMatchObject([
      { spending: 150, count: 1, byCategory: [{ category: 'compras', amount: 150 }] },
      { spending: 150, count: 1 },
      { spending: 150, count: 1 },
    ]);
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
    expect(purchases).toHaveLength(4);
    expect(seriesOf(purchases).size).toBe(2);
    expect(purchases.every((p) => p.installment?.purchaseAmount === 1500 && p.installment.seen.join() === '1,2')).toBe(true);
    expect(['2026-08', '2026-09'].map((m) => monthSummary(purchases, m).spending)).toEqual([300, 300]);
  });

  it('a prevista e a lançada da mesma parcela contam uma vez (vale a lançada)', () => {
    const base = { amount: 150, purchase_on: '2026-08-05', description: 'MAGALU' };
    const posted = parcel(2, 10, { ...base, occurred_on: '2026-09-05' });
    const purchases = groupPurchases(
      [parcel(1, 10, { ...base, occurred_on: '2026-08-05' }), parcel(2, 10, { ...base, occurred_on: '2026-09-04', status: 'PENDING' }), posted],
      accounts,
    );
    expect(rows(purchases)).toEqual([
      ['MAGALU', '2026-09-05', 150, 2],
      ['MAGALU', '2026-08-05', 150, 1],
    ]);
    expect(purchases[0]).toMatchObject({ key: `parc-${posted.id}`, pending: false });
  });

  it('duas compras parceladas iguais com a prevista que sobrou de uma delas: cada parcela lançada conta', () => {
    const base = { amount: 150, purchase_on: '2026-08-05', description: 'MAGALU' };
    const purchases = groupPurchases(
      [
        parcel(1, 10, { ...base, id: 'a1', occurred_on: '2026-08-05' }),
        parcel(1, 10, { ...base, id: 'b1', occurred_on: '2026-08-05' }),
        parcel(2, 10, { ...base, id: 'a2', occurred_on: '2026-09-05' }),
        parcel(2, 10, { ...base, id: 'b2', occurred_on: '2026-09-05' }),
        // A prevista da 3ª de B ainda não sumiu quando as duas lançadas chegaram.
        parcel(3, 10, { ...base, id: 'x-b3-prevista', occurred_on: '2026-10-04', status: 'PENDING' }),
        parcel(3, 10, { ...base, id: 'y-a3', occurred_on: '2026-10-05' }),
        parcel(3, 10, { ...base, id: 'z-b3', occurred_on: '2026-10-05' }),
      ],
      accounts,
    );
    expect(monthSummary(purchases, '2026-10')).toMatchObject({ spending: 300, count: 2, pending: 0 });
    expect(futureInstallments(purchases, '2026-10-07', 1)[0].amount).toBe(0);
  });

  it('sem a data da compra, estima pela parcela e junta mesmo com dias de fatura diferentes', () => {
    const purchases = groupPurchases(
      [
        parcel(2, 3, { amount: 80, occurred_on: '2026-09-07', description: 'LOJA Z 2/3' }),
        parcel(3, 3, { amount: 80, occurred_on: '2026-10-06', description: 'LOJA Z 3/3' }),
      ],
      accounts,
    );
    expect(rows(purchases)).toEqual([
      ['LOJA Z', '2026-10-07', 80, 3],
      ['LOJA Z', '2026-09-07', 80, 2],
    ]);
    expect(purchases[0].installment).toMatchObject({ purchaseDate: '2026-08-07', purchaseExact: false, purchaseAmount: 240 });
  });

  it('Santander: data da compra carimbada por parcela vira uma compra só, uma parcela por mês', () => {
    const base = { account_id: sanCard.id, amount: 100, description: 'AMAZON BR' };
    const purchases = groupPurchases(
      [
        parcel(1, 10, { ...base, purchase_on: '2026-08-18', occurred_on: '2026-08-18' }),
        parcel(2, 10, { ...base, purchase_on: '2026-09-18', occurred_on: '2026-09-18' }),
        parcel(3, 10, { ...base, purchase_on: '2026-10-18', occurred_on: '2026-10-18' }),
      ],
      allAccounts,
    );
    expect(seriesOf(purchases).size).toBe(1);
    expect(rows(purchases)).toEqual([
      ['AMAZON BR', '2026-10-18', 100, 3],
      ['AMAZON BR', '2026-09-18', 100, 2],
      ['AMAZON BR', '2026-08-18', 100, 1],
    ]);
    expect(purchases[0].installment).toMatchObject({ purchaseDate: '2026-08-18', purchaseExact: true, purchaseAmount: 1000 });
    expect(['2026-08', '2026-09', '2026-10'].map((m) => monthSummary(purchases, m).spending)).toEqual([100, 100, 100]);
    expect(futureInstallments(purchases, '2026-11-05', 2).map((m) => m.amount)).toEqual([100, 100]);
  });

  it('Santander: a "data da compra" carimbada na parcela e lançada dias depois, na fatura, ainda é a da parcela', () => {
    const [p] = groupPurchases(
      [parcel(3, 10, { account_id: sanCard.id, amount: 100, description: 'AMAZON BR', purchase_on: '2026-08-18', occurred_on: '2026-09-02' })],
      allAccounts,
    );
    expect(p).toMatchObject({ date: '2026-08-18', amount: 100, installment: { number: 3, purchaseDate: '2026-06-18' } });
  });

  it('Santander: anuidade em 12x conta R$ 55 em cada mês, não as 12 de uma vez', () => {
    const fee = { account_id: sanCard.id, amount: 55, description: 'ANUIDADE DIFERENCIADA' };
    const other = { account_id: sanCard.id, amount: 100, description: 'LOJA Y' };
    const purchases = groupPurchases(
      [
        parcel(5, 12, { ...fee, purchase_on: '2026-08-10', occurred_on: '2026-08-10', description: 'ANUIDADE DIFERENCIADA 05/12' }),
        parcel(6, 12, { ...fee, purchase_on: '2026-09-10', occurred_on: '2026-09-10', description: 'ANUIDADE DIFERENCIADA 06/12' }),
        parcel(7, 12, { ...fee, purchase_on: '2026-10-10', occurred_on: '2026-10-10', description: 'ANUIDADE DIFERENCIADA 07/12' }),
        parcel(1, 2, { ...other, purchase_on: '2026-09-02', occurred_on: '2026-09-02' }),
        parcel(2, 2, { ...other, purchase_on: '2026-10-02', occurred_on: '2026-10-02' }),
      ],
      allAccounts,
    );
    expect(rows(purchases)).toEqual([
      ['ANUIDADE DIFERENCIADA', '2026-10-10', 55, 7],
      ['LOJA Y', '2026-10-02', 100, 2],
      ['ANUIDADE DIFERENCIADA', '2026-09-10', 55, 6],
      ['LOJA Y', '2026-09-02', 100, 1],
      ['ANUIDADE DIFERENCIADA', '2026-08-10', 55, 5],
    ]);
    expect(purchases[0]).toMatchObject({ category: 'taxas', installment: { purchaseDate: '2026-04-10', purchaseAmount: 660 } });
    expect(['2026-08', '2026-09', '2026-10'].map((m) => monthSummary(purchases, m).spending)).toEqual([55, 155, 155]);
    expect(futureInstallments(purchases, '2026-11-01', 1)[0]).toMatchObject({ amount: 55 });
  });

  it('Santander: só a última parcela na janela (sem outra para comparar) fica no mês dela, sem parcelas futuras', () => {
    const purchases = groupPurchases(
      [
        parcel(10, 10, { account_id: sanCard.id, amount: 100, description: 'AMAZON BR 10/10', purchase_on: '2026-08-18', occurred_on: '2026-08-18' }),
        tx({ account_id: sanCard.id, amount: 40, description: 'PADARIA', purchase_on: '2026-09-02', occurred_on: '2026-09-02' }),
      ],
      allAccounts,
    );
    expect(purchases.find((p) => p.installment)).toMatchObject({
      date: '2026-08-18',
      amount: 100,
      installment: { number: 10, purchaseDate: '2025-11-18', purchaseAmount: 1000 },
    });
    expect(monthSummary(purchases, '2026-08').spending).toBe(100);
    expect(futureInstallments(purchases, '2026-11-05', 6).every((m) => m.amount === 0)).toBe(true);
  });

  it('Nubank: uma parcela só, com a data da compra meses antes, cai no mês dela contado da compra', () => {
    const [p] = groupPurchases(
      [parcel(4, 6, { amount: 50, description: 'LOJA N 04/06', purchase_on: '2026-07-10', occurred_on: '2026-10-10' })],
      accounts,
    );
    expect(p).toMatchObject({
      date: '2026-10-10',
      amount: 50,
      installment: { number: 4, purchaseDate: '2026-07-10', purchaseExact: true, purchaseAmount: 300 },
    });
  });

  it('Nubank (data da compra igual em todas) continua do jeito dele com o Santander ao lado', () => {
    const purchases = groupPurchases(
      [
        parcel(1, 3, { amount: 50, purchase_on: '2026-08-05', occurred_on: '2026-08-05', description: 'LOJA N' }),
        parcel(2, 3, { amount: 50, purchase_on: '2026-08-05', occurred_on: '2026-09-05', description: 'LOJA N' }),
        parcel(1, 2, { account_id: sanCard.id, amount: 80, purchase_on: '2026-09-01', occurred_on: '2026-09-01', description: 'LOJA S' }),
        parcel(2, 2, { account_id: sanCard.id, amount: 80, purchase_on: '2026-10-01', occurred_on: '2026-10-01', description: 'LOJA S' }),
      ],
      allAccounts,
    );
    expect(rows(purchases)).toEqual([
      ['LOJA S', '2026-10-01', 80, 2],
      ['LOJA N', '2026-09-05', 50, 2],
      ['LOJA S', '2026-09-01', 80, 1],
      ['LOJA N', '2026-08-05', 50, 1],
    ]);
  });

  it('sem data da compra: 1ª parcela no dia da compra e as outras no dia da fatura continuam uma compra', () => {
    const base = { amount: 100, description: 'LOJA X' };
    const purchases = groupPurchases(
      [
        parcel(1, 3, { ...base, occurred_on: '2026-08-28' }),
        parcel(2, 3, { ...base, occurred_on: '2026-10-04' }),
        parcel(3, 3, { ...base, occurred_on: '2026-11-04' }),
      ],
      accounts,
    );
    expect(seriesOf(purchases).size).toBe(1);
    expect(rows(purchases)).toEqual([
      ['LOJA X', '2026-10-28', 100, 3],
      ['LOJA X', '2026-09-28', 100, 2],
      ['LOJA X', '2026-08-28', 100, 1],
    ]);
    expect(monthSummary(purchases, '2026-09').spending).toBe(100);
  });

  it('compra do fim do mês: com a 1ª parcela buscada, cada parcela cai no mês certo', () => {
    const base = { amount: 100, description: 'LOJA X' };
    const later = [parcel(2, 3, { ...base, occurred_on: '2026-09-04' }), parcel(3, 3, { ...base, occurred_on: '2026-10-04' })];
    // Sem a 1ª: as parcelas 2 e 3, lançadas no dia da fatura, estimam a compra em 4/8 (um mês a mais em cada uma).
    const estimated = groupPurchases(later, accounts);
    expect(rows(estimated)).toEqual([
      ['LOJA X', '2026-10-04', 100, 3],
      ['LOJA X', '2026-09-04', 100, 2],
    ]);
    expect(estimated[0].installment).toMatchObject({ purchaseDate: '2026-08-04', purchaseExact: false });
    // As parcelas vêm buscadas desde bem antes da janela: a 1ª (28/7) acerta a data da compra.
    expect(financeInstallmentFetchStart('2026-10-07') <= '2026-07-28').toBe(true);
    const fetched = groupPurchases([parcel(1, 3, { ...base, occurred_on: '2026-07-28' }), ...later], accounts);
    expect(rows(fetched)).toEqual([
      ['LOJA X', '2026-09-28', 100, 3],
      ['LOJA X', '2026-08-28', 100, 2],
      ['LOJA X', '2026-07-28', 100, 1],
    ]);
    // A 1ª parcela, de julho, fica fora da janela (agosto a outubro).
    expect(rows(windowPurchases(fetched, '2026-10-07'))).toEqual([
      ['LOJA X', '2026-09-28', 100, 3],
      ['LOJA X', '2026-08-28', 100, 2],
    ]);
  });

  it('sem data da compra: todas as parcelas com o dia original da compra (como na fatura impressa) são uma compra', () => {
    const base = { amount: 100, description: 'LOJA X', occurred_on: '2026-08-28' };
    const purchases = groupPurchases([parcel(1, 3, base), parcel(2, 3, base), parcel(3, 3, base)], accounts);
    expect(rows(purchases)).toEqual([
      ['LOJA X', '2026-10-28', 100, 3],
      ['LOJA X', '2026-09-28', 100, 2],
      ['LOJA X', '2026-08-28', 100, 1],
    ]);
  });

  it('sem data da compra: duas compras iguais em meses diferentes continuam duas', () => {
    const base = { amount: 50, description: 'AMAZON' };
    const purchases = groupPurchases(
      [
        parcel(2, 2, { ...base, occurred_on: '2026-08-20' }),
        parcel(1, 2, { ...base, occurred_on: '2026-09-10' }),
        parcel(2, 2, { ...base, occurred_on: '2026-10-10' }),
      ],
      accounts,
    );
    expect(rows(purchases)).toEqual([
      ['AMAZON', '2026-10-10', 50, 2],
      ['AMAZON', '2026-09-10', 50, 1],
      ['AMAZON', '2026-08-20', 50, 2],
    ]);
    expect(seriesOf(purchases).size).toBe(2);
    expect(purchases.map((p) => p.installment?.purchaseDate)).toEqual(['2026-09-10', '2026-09-10', '2026-07-20']);
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
    expect(seriesOf(purchases).size).toBe(1);
    expect(purchases.map((p) => p.amount)).toEqual([33.33, 33.33, 33.34]);
    expect(purchases[0].installment).toMatchObject({ parcel: 33.33, purchaseAmount: 100 });
  });

  it('só uma parcela na janela: conta ela, no mês dela; a compra inteira vai junto como referência', () => {
    const [p] = groupPurchases([parcel(3, 10, { amount: 99.9, purchase_on: '2025-08-01', occurred_on: '2025-10-01' })], accounts);
    expect(p).toMatchObject({ date: '2025-10-01', amount: 99.9, installment: { number: 3, purchaseDate: '2025-08-01', purchaseAmount: 999 } });
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

  it('nome de pessoa como empresa (firma individual) ou na fatura não vai como loja; empresa e marca vão', () => {
    const store = (over: Partial<FinTransaction>) => groupPurchases([tx(over)], accounts)[0].storeName;
    expect(store({ description: 'PAGAMENTO DE BOLETO', counterparty_name: 'MARIANA FERREIRA LIMA', counterparty_doc_kind: 'CNPJ' })).toBeNull();
    expect(store({ account_id: nuCard.id, description: 'MARCOS ANTONIO ROCHA' })).toBeNull();
    expect(store({ account_id: nuCard.id, description: 'Compra', merchant_name: 'JULIANA PRADO ALVES' })).toBeNull();
    // MEI antigo: o CPF no nome vem trocado por "***" na sincronização.
    expect(store({ account_id: nuCard.id, description: 'Compra', merchant_name: 'MARIA SOUZA ***', category: 'Restaurants' })).toBeNull();
    expect(store({ description: 'Pix enviado', counterparty_name: 'Padaria Real Ltda', counterparty_doc_kind: 'CNPJ' })).toBe('Padaria Real Ltda');
    expect(store({ account_id: nuCard.id, description: 'AMAZON MARKETPLACE' })).toBe('AMAZON MARKETPLACE');
    expect(store({ account_id: nuCard.id, description: 'SHOPEE' })).toBe('SHOPEE');
    // Com categoria de loja reconhecida, o nome vai (como na maquininha).
    expect(store({ account_id: nuCard.id, description: 'Compra', merchant_name: 'ANA PAULA DOCES', category: 'Restaurants' })).toBe('ANA PAULA DOCES');
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

describe('groupPurchases — dinheiro que só muda de lugar', () => {
  it('PIX da conta Nubank para a conta Santander sem o CPF da dona: os dois lados são internos', () => {
    const purchases = groupPurchases(
      [
        tx({ amount: 3000, description: 'Transferência enviada pelo Pix', counterparty_doc_kind: 'CPF', category: 'Transfer - PIX' }),
        tx({ account_id: sanChecking.id, amount: 3000, direction: 'CREDIT', description: 'PIX RECEBIDO', occurred_on: '2026-10-06' }),
        tx({ amount: 80, description: 'PADARIA', category: 'Groceries' }),
      ],
      allAccounts,
      [],
    );
    expect(purchases.filter((p) => p.kind === 'internal')).toHaveLength(2);
    expect(monthSummary(purchases, '2026-10')).toMatchObject({ spending: 80, income: 0 });
  });

  it('PIX para uma pessoa e outro de outra pessoa com o mesmo valor (documentos diferentes) não viram internos', () => {
    const purchases = groupPurchases(
      [
        tx({ amount: 100, description: 'Pix enviado', counterparty_doc_kind: 'CPF', counterparty_doc_hash: 'c'.repeat(64) }),
        tx({ account_id: sanChecking.id, amount: 100, direction: 'CREDIT', description: 'Pix recebido', counterparty_doc_kind: 'CPF', counterparty_doc_hash: 'd'.repeat(64) }),
        tx({ amount: 200, description: 'Pix enviado', occurred_on: '2026-10-01' }),
        tx({ account_id: sanChecking.id, amount: 200, direction: 'CREDIT', description: 'Pix recebido', occurred_on: '2026-10-05' }),
      ],
      allAccounts,
      [],
    );
    expect(purchases.filter((p) => p.kind === 'internal')).toHaveLength(0);
  });

  it('sem o CPF da dona, o mesmo documento nos dois lados casa; sabendo o dela, documento de outra pessoa não casa', () => {
    const lent = [
      tx({ amount: 150, description: 'Pix enviado', counterparty_doc_kind: 'CPF', counterparty_doc_hash: 'e'.repeat(64) }),
      tx({ account_id: sanChecking.id, amount: 150, direction: 'CREDIT', description: 'Pix recebido', counterparty_doc_kind: 'CPF', counterparty_doc_hash: 'e'.repeat(64) }),
    ];
    expect(groupPurchases(lent, allAccounts, []).filter((p) => p.kind === 'internal')).toHaveLength(2);
    // Com o documento da dona (OWNER) conhecido, "e..." é outra pessoa: emprestou e recebeu de volta.
    expect(groupPurchases(lent, allAccounts).filter((p) => p.kind === 'internal')).toHaveLength(0);
  });

  it('fatura paga por boleto ou PIX sem a palavra "fatura": o "Pagamento recebido" do cartão acha a saída', () => {
    const purchases = groupPurchases(
      [
        tx({ account_id: sanChecking.id, amount: 2500, description: 'PAGAMENTO DE BOLETO', counterparty_name: 'NU PAGAMENTOS S.A.', counterparty_doc_kind: 'CNPJ', counterparty_cnpj: '18236120000158', category: 'Transfer - Bank slip', occurred_on: '2026-10-08' }),
        tx({ account_id: nuCard.id, amount: 2500, direction: 'CREDIT', description: 'Pagamento recebido', occurred_on: '2026-10-10' }),
        tx({ account_id: nuCard.id, amount: 2500, description: 'LOJA CARA', occurred_on: '2026-09-20' }),
      ],
      allAccounts,
    );
    expect(purchases.filter((p) => p.kind === 'card_payment')).toHaveLength(2);
    expect(monthSummary(purchases, '2026-10').spending).toBe(0);
  });

  it('dois documentos mascarados sem nome não casam: o aluguel e o PIX do cônjuge do mesmo valor continuam saída e entrada', () => {
    const purchases = groupPurchases(
      [
        tx({ account_id: sanChecking.id, amount: 2500, description: 'PIX ENVIADO ALUGUEL', counterparty_doc_kind: 'CPF', occurred_on: '2026-10-05' }),
        tx({ amount: 2500, direction: 'CREDIT', description: 'Transferência recebida pelo Pix', counterparty_doc_kind: 'CPF', occurred_on: '2026-10-04' }),
      ],
      allAccounts,
    );
    expect(purchases.filter((p) => p.kind === 'internal')).toHaveLength(0);
    expect(monthSummary(purchases, '2026-10')).toMatchObject({ spending: 2500, income: 2500, byCategory: [{ category: 'moradia', amount: 2500 }] });
  });

  it('documentos mascarados: com nomes diferentes não casa; com o mesmo nome (do jeito que cada banco corta) casa', () => {
    const pair = (sent: string, received: string) =>
      groupPurchases(
        [
          tx({ amount: 200, description: 'Pix enviado', counterparty_doc_kind: 'CPF', counterparty_name: sent }),
          tx({ account_id: sanChecking.id, amount: 200, direction: 'CREDIT', description: 'PIX RECEBIDO', counterparty_doc_kind: 'CPF', counterparty_name: received, occurred_on: '2026-10-06' }),
        ],
        allAccounts,
      ).filter((p) => p.kind === 'internal').length;
    // A diarista recebeu R$ 200 e a irmã mandou R$ 200 no dia seguinte: pessoas diferentes.
    expect(pair('Maria Aparecida Souza', 'Joana Lima')).toBe(0);
    expect(pair('Andre Barbusci', 'ANDRE BARBUSCI')).toBe(2);
    expect(pair('ANDRE L BARBUSCI', 'Andre Luiz Barbusci')).toBe(2);
    expect(pair('ANDRE LUIZ BARBUS', 'Andre Luiz Barbusci')).toBe(2);
  });

  it('conta para a poupança em outro banco (e de volta): o lado da conta vira aplicação, não saída nem entrada', () => {
    const sanSavings = account({ id: 'san-poup', connection_id: 'conn-san', subtype: 'SAVINGS_ACCOUNT' });
    const withSavings = [...allAccounts, sanSavings];
    const saved = groupPurchases(
      [
        tx({ amount: 1000, description: 'Transferência enviada pelo Pix', counterparty_doc_kind: 'CPF', occurred_on: '2026-10-08' }),
        tx({ account_id: sanSavings.id, amount: 1000, direction: 'CREDIT', description: 'PIX RECEBIDO', counterparty_doc_kind: 'CPF', occurred_on: '2026-10-08' }),
      ],
      withSavings,
    );
    expect(saved.map((p) => p.kind)).toEqual(['investment', 'investment']);
    expect(monthSummary(saved, '2026-10')).toMatchObject({ spending: 0, income: 0 });
    const back = groupPurchases(
      [
        tx({ account_id: sanSavings.id, amount: 1000, description: 'PIX ENVIADO', counterparty_doc_kind: 'CPF', occurred_on: '2026-10-08' }),
        tx({ amount: 1000, direction: 'CREDIT', description: 'Transferência recebida pelo Pix', counterparty_doc_kind: 'CPF', occurred_on: '2026-10-09' }),
      ],
      withSavings,
    );
    expect(back.map((p) => p.kind)).toEqual(['investment', 'investment']);
    expect(monthSummary(back, '2026-10')).toMatchObject({ spending: 0, income: 0 });
  });

  it('um lado já é da dona (o CPF dela) e o outro veio mascarado: o outro lado também é interno', () => {
    const purchases = groupPurchases(
      [
        tx({ amount: 3000, description: 'Transferência enviada pelo Pix', counterparty_doc_kind: 'CPF', counterparty_doc_hash: OWNER }),
        tx({ account_id: sanChecking.id, amount: 3000, direction: 'CREDIT', description: 'PIX RECEBIDO', counterparty_doc_kind: 'CPF' }),
      ],
      allAccounts,
    );
    expect(purchases.map((p) => p.kind)).toEqual(['internal', 'internal']);
    expect(monthSummary(purchases, '2026-10')).toMatchObject({ spending: 0, income: 0 });
  });

  it('o PIX que leva o dinheiro para o banco do cartão não é a fatura: o boleto é', () => {
    const interCard = account({ id: 'inter-cartao', connection_id: 'conn-inter', type: 'CREDIT', subtype: 'CREDIT_CARD' });
    const withInterCard = [...allAccounts, interCard];
    for (const [pixId, boletoId] of [
      ['a-pix', 'z-boleto'],
      ['z-pix', 'a-boleto'],
    ]) {
      const purchases = groupPurchases(
        [
          tx({ id: pixId, amount: 1834.27, description: 'Transferência enviada pelo Pix', occurred_on: '2026-10-08' }),
          tx({ id: 'in-1', account_id: interChecking.id, amount: 1834.27, direction: 'CREDIT', description: 'Pix recebido', occurred_on: '2026-10-08' }),
          tx({ id: boletoId, account_id: interChecking.id, amount: 1834.27, description: 'PAGAMENTO DE BOLETO', counterparty_doc_kind: 'CNPJ', counterparty_name: 'BANCO INTER S.A.', counterparty_cnpj: '00416968000101', occurred_on: '2026-10-08' }),
          tx({ id: 'card-1', account_id: interCard.id, amount: 1834.27, direction: 'CREDIT', description: 'Pagamento recebido', occurred_on: '2026-10-10' }),
        ],
        withInterCard,
      );
      const kindOf = (id: string) => purchases.find((p) => p.key === `tx-${id}`)?.kind;
      expect([kindOf(pixId), kindOf('in-1'), kindOf(boletoId)]).toEqual(['internal', 'internal', 'card_payment']);
      expect(monthSummary(purchases, '2026-10')).toMatchObject({ spending: 0, income: 0 });
    }
  });

  it('fatura que diz "fatura" 4 dias antes do "Pagamento recebido" ainda casa: o PIX que a pagou fica interno', () => {
    const interCard = account({ id: 'inter-cartao', connection_id: 'conn-inter', type: 'CREDIT', subtype: 'CREDIT_CARD' });
    const purchases = groupPurchases(
      [
        tx({ amount: 1834.27, description: 'Transferência enviada pelo Pix', occurred_on: '2026-10-07' }),
        tx({ account_id: interChecking.id, amount: 1834.27, direction: 'CREDIT', description: 'Pix recebido', occurred_on: '2026-10-07' }),
        tx({ account_id: interChecking.id, amount: 1834.27, description: 'PAGAMENTO FATURA CARTAO INTER', occurred_on: '2026-10-06' }),
        tx({ account_id: interCard.id, amount: 1834.27, direction: 'CREDIT', description: 'Pagamento recebido', occurred_on: '2026-10-10' }),
      ],
      [...allAccounts, interCard],
    );
    expect(purchases.filter((p) => p.kind === 'internal')).toHaveLength(2);
    expect(monthSummary(purchases, '2026-10')).toMatchObject({ spending: 0, income: 0 });
  });

  it('a saída que já diz "fatura" casa primeiro: o aluguel do mesmo valor continua gasto', () => {
    const purchases = groupPurchases(
      [
        tx({ amount: 2500, description: 'Pagamento de fatura', occurred_on: '2026-10-05' }),
        tx({ amount: 2500, description: 'ALUGUEL', counterparty_doc_kind: 'CNPJ', occurred_on: '2026-10-06' }),
        tx({ account_id: nuCard.id, amount: 2500, direction: 'CREDIT', description: 'Pagamento recebido', occurred_on: '2026-10-06' }),
      ],
      allAccounts,
    );
    expect(purchases.filter((p) => p.kind === 'spending').map((p) => p.description)).toEqual(['ALUGUEL']);
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
      otherRefunds: 0,
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
      otherRefunds: 0,
      pending: 60,
      byCategory: [
        { category: 'mercado', amount: 150 },
        { category: 'transporte', amount: 60 },
      ],
      count: 2,
    });
  });
});

describe('monthSummary — estornos', () => {
  it('estorno sem a categoria da compra não deixa o total diferente da soma das categorias', () => {
    const purchases = groupPurchases(
      [
        tx({ account_id: nuCard.id, amount: 100, description: 'SUPERMERCADO BOM' }),
        tx({ account_id: nuCard.id, amount: 80, direction: 'CREDIT', description: 'Estorno de compra' }),
      ],
      accounts,
    );
    const summary = monthSummary(purchases, '2026-10');
    // Sem loja e com outro valor, não dá para saber qual compra ele desfaz: aparece à parte, sem abater.
    expect(summary).toMatchObject({ spending: 100, refunds: 0, otherRefunds: 80, byCategory: [{ category: 'mercado', amount: 100 }] });
  });

  it('estorno de compra de outro mês abate o mês da compra, não as saídas deste (nem as da mesma categoria)', () => {
    const purchases = groupPurchases(
      [
        tx({ account_id: nuCard.id, amount: 1000, description: 'LOJA DE TV', occurred_on: '2026-09-10' }),
        tx({ account_id: nuCard.id, amount: 1000, direction: 'CREDIT', description: 'Estorno LOJA DE TV', occurred_on: '2026-10-03' }),
        // Mesma categoria (compras) que a TV, em outubro.
        tx({ account_id: nuCard.id, amount: 700, description: 'AMAZON MARKETPLACE', occurred_on: '2026-10-04' }),
        tx({ account_id: nuCard.id, amount: 600, description: 'SUPERMERCADO BOM', occurred_on: '2026-10-04' }),
      ],
      accounts,
    );
    expect(purchases.find((p) => p.kind === 'refund')?.refundOf).toBe(purchases.find((p) => p.description === 'LOJA DE TV')?.key);
    expect(monthSummary(purchases, '2026-09')).toMatchObject({ spending: 0, refunds: 1000, byCategory: [], count: 0 });
    const october = monthSummary(purchases, '2026-10');
    expect(october).toMatchObject({
      spending: 1300,
      refunds: 0,
      otherRefunds: 0,
      byCategory: [
        { category: 'compras', amount: 700 },
        { category: 'mercado', amount: 600 },
      ],
      count: 2,
    });
    expect(october.spending).toBe(october.byCategory.reduce((sum, c) => sum + c.amount, 0));
  });

  it('estorno liga à compra da mesma loja na mesma conta, e nunca a uma compra depois dele ou de outra conta', () => {
    const purchases = groupPurchases(
      [
        tx({ account_id: nuCard.id, amount: 300, description: 'NETSHOES', occurred_on: '2026-09-20' }),
        tx({ account_id: nuCard.id, amount: 120, direction: 'CREDIT', description: 'Estorno NETSHOES', occurred_on: '2026-10-02' }),
        // Mesmo valor, mas depois do estorno e em outra conta: não é ela.
        tx({ account_id: nuCard.id, amount: 120, description: 'LOJA NOVA', occurred_on: '2026-10-05' }),
        tx({ amount: 120, description: 'COMPRA NO DEBITO NETSHOES', occurred_on: '2026-09-25' }),
      ],
      accounts,
    );
    const refund = purchases.find((p) => p.kind === 'refund');
    expect(purchases.find((p) => p.key === refund?.refundOf)?.description).toBe('NETSHOES');
    // Setembro: 300 - 120 no cartão, mais os 120 no débito.
    expect(monthSummary(purchases, '2026-09')).toMatchObject({ spending: 300, refunds: 120 });
    expect(monthSummary(purchases, '2026-10')).toMatchObject({ spending: 120, refunds: 0, otherRefunds: 0 });
  });

  it('previsto já sem o estorno: nunca passa das saídas', () => {
    const purchases = groupPurchases(
      [
        tx({ account_id: nuCard.id, amount: 200, description: 'SUPERMERCADO BOM', status: 'PENDING' }),
        tx({ account_id: nuCard.id, amount: 200, direction: 'CREDIT', description: 'Estorno SUPERMERCADO BOM', occurred_on: '2026-10-06' }),
        tx({ account_id: nuCard.id, amount: 90, description: 'PADARIA REAL', status: 'PENDING' }),
        tx({ account_id: nuCard.id, amount: 30, direction: 'CREDIT', description: 'Estorno PADARIA REAL', occurred_on: '2026-10-06' }),
      ],
      accounts,
    );
    expect(monthSummary(purchases, '2026-10')).toMatchObject({ spending: 60, pending: 60, refunds: 230, count: 1 });
  });
});

describe('monthSummary — estornos de compra parcelada', () => {
  const magalu = (n: number, over: Partial<FinTransaction> = {}) =>
    parcel(n, 10, {
      amount: 150,
      description: `MAGALU ${String(n).padStart(2, '0')}/10`,
      purchase_on: '2026-08-05',
      occurred_on: addMonths('2026-08-05', n - 1),
      ...over,
    });

  it('estorno de uma parcela abate a parcela que ele diz (ou, sem dizer, a mais recente)', () => {
    const marked = groupPurchases(
      [magalu(1), magalu(2), magalu(3), tx({ account_id: nuCard.id, amount: 150, direction: 'CREDIT', description: 'ESTORNO MAGALU 02/10', occurred_on: '2026-10-06' })],
      accounts,
    );
    const refund = marked.find((p) => p.kind === 'refund');
    expect(marked.find((p) => p.key === refund?.refundOf)?.installment?.number).toBe(2);
    expect(['2026-08', '2026-09', '2026-10'].map((m) => monthSummary(marked, m).spending)).toEqual([150, 0, 150]);

    const plain = groupPurchases(
      [magalu(1), magalu(2), magalu(3), tx({ account_id: nuCard.id, amount: 150, direction: 'CREDIT', description: 'Estorno MAGALU', occurred_on: '2026-10-06' })],
      accounts,
    );
    expect(['2026-08', '2026-09', '2026-10'].map((m) => monthSummary(plain, m).spending)).toEqual([150, 150, 0]);
  });

  it('estorno da compra inteira abate cada parcela no mês dela e não deixa nada comprometido', () => {
    const first = magalu(1);
    const purchases = groupPurchases(
      [first, magalu(2), magalu(3), tx({ account_id: nuCard.id, amount: 1500, direction: 'CREDIT', description: 'Estorno MAGALU', occurred_on: '2026-10-06' })],
      accounts,
    );
    const refund = purchases.find((p) => p.kind === 'refund') as BankPurchase;
    expect(refund.refundOf).toBe(`serie-${first.id}`);
    expect(refund.refundParts.map((part) => part.amount)).toEqual([150, 150, 150]);
    expect(['2026-08', '2026-09', '2026-10'].map((m) => monthSummary(purchases, m))).toMatchObject([
      { spending: 0, refunds: 150, otherRefunds: 0, count: 0 },
      { spending: 0, refunds: 150, otherRefunds: 0, count: 0 },
      { spending: 0, refunds: 150, otherRefunds: 0, count: 0 },
    ]);
    expect(futureInstallments(purchases, '2026-10-07', 3).every((m) => m.amount === 0)).toBe(true);
  });

  it('estorno das parcelas já cobradas (a compra cancelada) também não deixa nada comprometido', () => {
    const purchases = groupPurchases(
      [magalu(1), magalu(2), tx({ account_id: nuCard.id, amount: 300, direction: 'CREDIT', description: 'Estorno MAGALU', occurred_on: '2026-09-20' })],
      accounts,
    );
    expect(['2026-08', '2026-09'].map((m) => monthSummary(purchases, m).spending)).toEqual([0, 0]);
    expect(futureInstallments(purchases, '2026-09-25', 3).every((m) => m.amount === 0)).toBe(true);
  });

  it('uma data na descrição do estorno ("05/09") não liga sozinha o estorno à parcela 5 de 9 de outra loja', () => {
    const lojaY = (n: number, day: string) => parcel(n, 9, { amount: 100, description: `LOJA Y ${n}/9`, purchase_on: '2026-05-10', occurred_on: day });
    const purchases = groupPurchases(
      [
        lojaY(4, '2026-08-10'),
        lojaY(5, '2026-09-10'),
        lojaY(6, '2026-10-10'),
        tx({ account_id: nuCard.id, amount: 20, direction: 'CREDIT', description: 'ESTORNO PADARIA REAL 05/09', occurred_on: '2026-10-03' }),
      ],
      accounts,
    );
    expect(purchases.find((p) => p.kind === 'refund')?.refundOf).toBeNull();
    expect(monthSummary(purchases, '2026-09').spending).toBe(100);
    expect(monthSummary(purchases, '2026-10').otherRefunds).toBe(20);
  });

  it('compra cancelada com a parcela do mês que vem já mandada: devolvidas as já cobradas, nada fica comprometido', () => {
    const first = magalu(1);
    const purchases = groupPurchases(
      [
        first,
        magalu(2),
        magalu(3),
        magalu(4, { status: 'PENDING' }),
        tx({ account_id: nuCard.id, amount: 450, direction: 'CREDIT', description: 'Estorno de compra MAGALU', occurred_on: '2026-10-06' }),
      ],
      accounts,
    );
    expect(purchases.find((p) => p.kind === 'refund')?.refundOf).toBe(`serie-${first.id}`);
    expect(['2026-08', '2026-09', '2026-10'].map((m) => monthSummary(purchases, m).spending)).toEqual([0, 0, 0]);
    expect(futureInstallments(purchases, '2026-10-07', 3).every((m) => m.amount === 0)).toBe(true);
  });

  it('as parcelas já cobradas devolvidas uma a uma: a compra foi cancelada', () => {
    const refund = (n: number) =>
      tx({ account_id: nuCard.id, amount: 150, direction: 'CREDIT', description: `ESTORNO MAGALU 0${n}/10`, occurred_on: '2026-10-06' });
    const purchases = groupPurchases(
      [magalu(1), magalu(2), magalu(3), magalu(4, { status: 'PENDING' }), refund(1), refund(2), refund(3)],
      accounts,
    );
    expect(['2026-08', '2026-09', '2026-10'].map((m) => monthSummary(purchases, m).spending)).toEqual([0, 0, 0]);
    expect(futureInstallments(purchases, '2026-10-07', 3).every((m) => m.amount === 0)).toBe(true);
  });

  it('estorno da única parcela cobrada pode ser só dela: as que faltam continuam comprometidas', () => {
    const loja = (n: number, day: string) =>
      parcel(n, 3, { amount: 100, description: `LOJA Z ${n}/3`, purchase_on: '2026-09-10', occurred_on: day });
    const purchases = groupPurchases(
      [loja(1, '2026-09-10'), tx({ account_id: nuCard.id, amount: 100, direction: 'CREDIT', description: 'Estorno LOJA Z', occurred_on: '2026-09-20' })],
      accounts,
    );
    expect(monthSummary(purchases, '2026-09').spending).toBe(0);
    expect(futureInstallments(purchases, '2026-09-25', 3).map((m) => m.amount)).toEqual([0, 100, 100]);
  });

  it('estorno sem o nome da loja não casa pelo valor com uma parcela de mais de 6 meses atrás', () => {
    const old = { amount: 80, purchase_on: '2025-12-10', description: 'LOJA VELHA' };
    const purchases = groupPurchases(
      [
        parcel(1, 3, { ...old, occurred_on: '2025-12-10' }),
        parcel(2, 3, { ...old, occurred_on: '2026-01-10' }),
        parcel(3, 3, { ...old, occurred_on: '2026-02-10' }),
        tx({ account_id: nuCard.id, amount: 80, direction: 'CREDIT', description: 'Estorno de compra', occurred_on: '2026-10-03' }),
      ],
      accounts,
    );
    expect(purchases.find((p) => p.kind === 'refund')?.refundOf).toBeNull();
    expect(monthSummary(purchases, '2026-10').otherRefunds).toBe(80);
  });

  it('estorno parcial maior que o já cobrado (devolveu parte): o que passou abate as parcelas que faltam', () => {
    const purchases = groupPurchases(
      [magalu(1), magalu(2), tx({ account_id: nuCard.id, amount: 400, direction: 'CREDIT', description: 'Estorno MAGALU', occurred_on: '2026-09-20' })],
      accounts,
    );
    expect(['2026-08', '2026-09'].map((m) => monthSummary(purchases, m).spending)).toEqual([0, 0]);
    // R$ 100 de crédito: a parcela 3 (outubro) fica em R$ 50; as seguintes, cheias.
    expect(futureInstallments(purchases, '2026-09-25', 3).map((m) => m.amount)).toEqual([0, 50, 150]);
  });
});

describe('futureInstallments', () => {
  it('do mês atual, só as parcelas que o banco ainda não lançou; dos seguintes, todas, uma vez por compra', () => {
    const magalu = { amount: 150, purchase_on: '2026-08-05', description: 'MAGALU' };
    const purchases = groupPurchases(
      [
        parcel(1, 10, { ...magalu, occurred_on: '2026-08-05' }),
        parcel(2, 10, { ...magalu, occurred_on: '2026-09-05' }),
        parcel(3, 10, { ...magalu, occurred_on: '2026-10-05' }),
        // A 2ª cai em 20/10 e ainda não veio.
        parcel(1, 3, { amount: 40, purchase_on: '2026-09-20', occurred_on: '2026-09-20', description: 'LOJA B' }),
        parcel(1, 2, {
          amount: 400,
          purchase_on: '2026-10-01',
          occurred_on: '2026-10-01',
          description: 'Parcelamento de fatura 1/2',
          other_credits_type: 'BILL_INSTALLMENT',
        }),
        tx({ account_id: nuCard.id, amount: 90, description: 'PADARIA' }),
      ],
      accounts,
    );
    const months = futureInstallments(purchases, '2026-10-07', 3);
    expect(months.map((m) => [m.month, m.amount, m.parcels.map((p) => `${p.description} ${p.number}/${p.total}`)])).toEqual([
      ['2026-10', 40, ['LOJA B 2/3']],
      ['2026-11', 590, ['Parcelamento de fatura 2/2', 'MAGALU 4/10', 'LOJA B 3/3']],
      ['2026-12', 150, ['MAGALU 5/10']],
    ]);
    expect(new Set(months.flatMap((m) => m.parcels.map((p) => p.key))).size).toBe(5);
  });

  it('parcela que o banco já mandou para um mês que vem conta com o valor dela', () => {
    const base = { purchase_on: '2026-09-05', description: 'LOJA C' };
    const purchases = groupPurchases(
      [
        parcel(1, 3, { ...base, amount: 100.02, occurred_on: '2026-09-05' }),
        parcel(2, 3, { ...base, amount: 99.99, occurred_on: '2026-10-05' }),
        parcel(3, 3, { ...base, amount: 99.99, occurred_on: '2026-11-05', status: 'PENDING' }),
      ],
      accounts,
    );
    expect(futureInstallments(purchases, '2026-10-07', 2)).toEqual([
      { month: '2026-10', amount: 0, parcels: [] },
      {
        month: '2026-11',
        amount: 99.99,
        parcels: [
          { key: `${purchases[0].installment?.seriesKey}-3`, seriesKey: purchases[0].installment?.seriesKey, description: 'LOJA C', number: 3, total: 3, amount: 99.99, seen: true },
        ],
      },
    ]);
    // Fora da janela até o mês dela chegar.
    expect(windowPurchases(purchases, '2026-10-07').map((p) => p.installment?.number)).toEqual([2, 1]);
  });

  it('compra que parou de cobrar (quitada antes ou cancelada) não deixa as que faltam como comprometidas', () => {
    const base = { amount: 150, purchase_on: '2026-03-05', description: 'MAGALU' };
    const purchases = groupPurchases(
      [parcel(1, 10, { ...base, occurred_on: '2026-03-05' }), parcel(2, 10, { ...base, occurred_on: '2026-04-05' })],
      accounts,
    );
    expect(futureInstallments(purchases, '2026-10-07', 6).every((m) => m.amount === 0)).toBe(true);
  });

  it('a parcela que faltou no meio não entra', () => {
    const base = { amount: 150, purchase_on: '2026-08-05', description: 'MAGALU' };
    const purchases = groupPurchases(
      [parcel(1, 4, { ...base, occurred_on: '2026-08-05' }), parcel(3, 4, { ...base, occurred_on: '2026-10-05' })],
      accounts,
    );
    expect(futureInstallments(purchases, '2026-10-07', 3).map((m) => [m.month, m.parcels.map((p) => p.number)])).toEqual([
      ['2026-10', []],
      ['2026-11', [4]],
      ['2026-12', []],
    ]);
  });

  it('meses sem parcela vêm com zero', () => {
    expect(futureInstallments([], '2027-01-10', 2)).toEqual([
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

  it('vencimento que já passou é de uma fatura velha: sai com o fechamento e o mínimo', () => {
    const paid = account({ id: 'c3', type: 'CREDIT', balance: 5508.7, bill_due_date: '2026-09-11', bill_close_date: '2026-09-04', minimum_payment: 486.82 });
    const [bill] = cardBills([paid], accountLabels([paid], connections), '2026-10-07');
    expect(bill).toMatchObject({ amount: 5508.7, dueDate: null, closeDate: null, minimumPayment: null });
    expect(cardBills([paid], accountLabels([paid], connections), '2026-09-11')[0].dueDate).toBe('2026-09-11');
  });

  it('conta que a última sincronização não trouxe (cartão trocado) sai; sem sincronização, todas ficam', () => {
    const synced = '2026-10-07T12:00:00.000Z';
    const fresh = account({ id: 'novo', updated_at: '2026-10-07T12:00:00+00:00' });
    const gone = account({ id: 'velho', updated_at: '2026-09-01T12:00:00+00:00' });
    const other = account({ id: 'outro', connection_id: 'conn-inter', updated_at: '2026-09-01T12:00:00+00:00' });
    const conns = [
      { id: 'conn-nu', last_synced_at: synced },
      { id: 'conn-inter', last_synced_at: null },
    ];
    expect(currentAccounts([fresh, gone, other], conns).map((a) => a.id)).toEqual(['novo', 'outro']);
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
