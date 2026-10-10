import { describe, expect, it } from '@jest/globals';

import {
  kotiiRecordsStart,
  matchBankToKotii,
  namesOverlap,
  type KotiiRecord,
  kotiiRecordsFrom,
  reconcileWindow,
  reconciliationInRange,
  reconciliationTotals,
} from '../bankMatch';
import type { BankInstallment, BankPurchase } from '../bankMonth';
import { addMonths } from '../dates';

const CNPJ = '12345678000199';

const purchase = (key: string, over: Partial<BankPurchase>): BankPurchase => ({
  key,
  date: '2026-10-05',
  amount: 100,
  description: 'COMPRA',
  merchantName: null,
  merchantCnpj: null,
  category: 'mercado',
  autoCategory: 'mercado',
  categorySource: 'auto',
  similarKey: null,
  kind: 'spending',
  pending: false,
  accountId: 'acc',
  installment: null,
  ruleKey: key,
  ruleKeys: [key],
  txIds: [key],
  personTransfer: false,
  sensitive: false,
  storeName: null,
  refundOf: null,
  refundParts: [],
  ...over,
});

/** A parcela `number` de uma compra de 10x de R$ 150 na Magalu em 1º/9 (parcelas 1 e 2 vistas). */
const parcelRow = (number: number, info: Partial<BankInstallment> = {}, over: Partial<BankPurchase> = {}): BankPurchase => {
  const installment: BankInstallment = {
    seriesKey: 'parc-a1',
    number,
    total: 10,
    parcel: 150,
    purchaseDate: '2026-09-01',
    purchaseExact: true,
    purchaseAmount: 1500,
    seen: [1, 2],
    ...info,
  };
  return purchase(`parc-${installment.seriesKey}-${number}`, {
    date: addMonths(installment.purchaseDate, number - 1),
    amount: installment.parcel,
    description: 'MAGALU',
    merchantCnpj: CNPJ,
    category: 'compras',
    autoCategory: 'compras',
    installment,
    ...over,
  });
};

const record = (id: string, over: Partial<KotiiRecord>): KotiiRecord => ({
  kind: 'gasto',
  id,
  amount: 100,
  date: '2026-10-05',
  label: 'Gasto',
  cnpj: null,
  ...over,
});

const summary = (result: ReturnType<typeof matchBankToKotii>) => ({
  matched: result.matched.map((m) => [m.purchase.key, m.record.id, m.confidence, m.reason]),
  bankOnly: result.bankOnly.map((b) => [b.purchase.key, b.suggestions.map((s) => s.record.id)]),
  kotiiOnly: result.kotiiOnly.map((r) => r.id),
});

describe('namesOverlap', () => {
  it('uma palavra que diz qual é a loja basta', () => {
    expect(namesOverlap(['GUANABARA BARRA'], ['Supermercado Guanabara'])).toBe(true);
    expect(namesOverlap(['PAODEACUCAR 123'], ['Pão de Açúcar'])).toBe(true);
    expect(namesOverlap(['SUPERMERCADO BOM'], ['Supermercado Real'])).toBe(false);
    expect(namesOverlap([null, 'COMPRA'], ['Gasto'])).toBe(false);
  });
});

describe('matchBankToKotii', () => {
  it('mesmo CNPJ, valor e data: alta', () => {
    const result = matchBankToKotii(
      [purchase('p1', { merchantCnpj: CNPJ })],
      [record('n1', { kind: 'nota', cnpj: '12.345.678/0001-99', date: '2026-10-06' })],
    );
    expect(summary(result)).toEqual({ matched: [['p1', 'n1', 'alta', 'Mesmo CNPJ, valor e data']], bankOnly: [], kotiiOnly: [] });
  });

  it('mesmo valor e nome parecido: alta; só valor e data: média', () => {
    const result = matchBankToKotii(
      [
        purchase('p1', { description: 'GUANABARA BARRA', amount: 250.4 }),
        purchase('p2', { description: 'BOLETO', amount: 180, date: '2026-10-10' }),
      ],
      [
        record('n1', { kind: 'nota', label: 'Supermercado Guanabara', amount: 250.4, date: '2026-10-04' }),
        record('c1', { kind: 'conta', label: 'Luz', amount: 180, date: '2026-10-08' }),
      ],
    );
    expect(summary(result).matched).toEqual([
      ['p1', 'n1', 'alta', 'Mesmo valor e nome parecido'],
      ['p2', 'c1', 'media', 'Mesmo valor em data próxima'],
    ]);
  });

  it('nota da mesma loja com o banco até 15% acima: média, "com gorjeta?"', () => {
    const tip = matchBankToKotii([purchase('p1', { merchantCnpj: CNPJ, amount: 110 })], [record('n1', { kind: 'nota', cnpj: CNPJ })]);
    expect(summary(tip).matched).toEqual([['p1', 'n1', 'media', 'Mesma loja e valor um pouco maior: com gorjeta?']]);
    const tooMuch = matchBankToKotii([purchase('p1', { merchantCnpj: CNPJ, amount: 115.01 })], [record('n1', { kind: 'nota', cnpj: CNPJ })]);
    expect(tooMuch.matched).toHaveLength(0);
    // Gorjeta só vale para nota.
    const expense = matchBankToKotii([purchase('p1', { merchantCnpj: CNPJ, amount: 110 })], [record('g1', { cnpj: CNPJ })]);
    expect(expense.matched).toHaveLength(0);
  });

  it('rede de lojas: CNPJ da filial na nota e da matriz no banco (mesma raiz) casa, abaixo do CNPJ igual', () => {
    const branch = '47508411123456';
    const hq = '47508411000156';
    const same = matchBankToKotii([purchase('p1', { merchantCnpj: hq })], [record('n1', { kind: 'nota', cnpj: branch })]);
    expect(summary(same).matched).toEqual([['p1', 'n1', 'alta', 'Mesma empresa (CNPJ), valor e data']]);
    const exactWins = matchBankToKotii(
      [purchase('p1', { merchantCnpj: hq })],
      [record('n1', { kind: 'nota', cnpj: branch }), record('n2', { kind: 'nota', cnpj: hq })],
    );
    expect(summary(exactWins).matched).toEqual([['p1', 'n2', 'alta', 'Mesmo CNPJ, valor e data']]);
  });

  it('rede de lojas: "com gorjeta?" só com o CNPJ da mesma loja, não com outra filial (outra compra da casa)', () => {
    const branchA = '47508411000156';
    const branchB = '47508411123456';
    // A dona pagou R$ 108 na filial A; a nota é a do cônjuge, R$ 100 na filial B no dia seguinte.
    const result = matchBankToKotii(
      [purchase('p1', { merchantCnpj: branchA, amount: 108, date: '2026-10-03' })],
      [record('n1', { kind: 'nota', cnpj: branchB, amount: 100, date: '2026-10-04' })],
    );
    expect(summary(result)).toEqual({ matched: [], bankOnly: [['p1', []]], kotiiOnly: ['n1'] });
  });

  it('casada na janela inteira: um registro perto da virada do mês não conta em dois meses', () => {
    const result = matchBankToKotii(
      [purchase('out', { date: '2026-10-01', amount: 50 }), purchase('set', { date: '2026-09-29', amount: 50 })],
      [record('g1', { date: '2026-09-30', amount: 50 })],
    );
    const september = reconciliationTotals(reconciliationInRange(result, { start: '2026-09-01', end: '2026-10-01' }));
    const october = reconciliationTotals(reconciliationInRange(result, { start: '2026-10-01', end: '2026-11-01' }));
    expect(september.inKotiiCount + october.inKotiiCount).toBe(1);
    expect(september.bankOnlyCount + october.bankOnlyCount).toBe(1);
    expect(reconciliationInRange(result, { start: '2026-10-01', end: '2026-11-01' }).kotiiOnly).toEqual([]);
  });

  it('fora da janela de 3 dias ou com valor diferente não casa', () => {
    const result = matchBankToKotii(
      [purchase('p1', { date: '2026-10-01' }), purchase('p2', { amount: 100.02 })],
      [record('n1', { date: '2026-10-05' })],
    );
    expect(summary(result)).toEqual({ matched: [], bankOnly: [['p1', []], ['p2', []]], kotiiOnly: ['n1'] });
  });

  it('um registro casa com uma compra só, a mais forte', () => {
    const result = matchBankToKotii(
      [purchase('p1', { date: '2026-10-07' }), purchase('p2', { date: '2026-10-05' })],
      [record('n1', { date: '2026-10-05' })],
    );
    expect(summary(result)).toEqual({ matched: [['p2', 'n1', 'media', 'Mesmo valor em data próxima']], bankOnly: [['p1', []]], kotiiOnly: [] });
  });

  it('empate para a mesma compra: fica sem casar, com as duas sugestões', () => {
    const result = matchBankToKotii([purchase('p1', {})], [record('g1', {}), record('g2', {})]);
    expect(summary(result)).toEqual({ matched: [], bankOnly: [['p1', ['g1', 'g2']]], kotiiOnly: ['g1', 'g2'] });
  });

  it('o empate se desfaz quando um dos registros casa melhor com outra compra', () => {
    const result = matchBankToKotii(
      [purchase('p1', {}), purchase('p2', { description: 'PADARIA REAL' })],
      [record('g1', {}), record('g2', { label: 'Padaria Real' })],
    );
    expect(summary(result).matched).toEqual([
      ['p1', 'g1', 'media', 'Mesmo valor em data próxima'],
      ['p2', 'g2', 'alta', 'Mesmo valor e nome parecido'],
    ]);
  });

  it('só compras (saídas) entram na conferência', () => {
    const result = matchBankToKotii(
      [purchase('p1', { kind: 'internal' }), purchase('p2', { kind: 'card_payment' }), purchase('p3', { kind: 'income' })],
      [record('g1', {})],
    );
    expect(summary(result)).toEqual({ matched: [], bankOnly: [], kotiiOnly: ['g1'] });
  });
});

describe('matchBankToKotii — compra parcelada', () => {
  const nota = (over: Partial<KotiiRecord> = {}) =>
    record('n1', { kind: 'nota', label: 'Magazine Luiza', amount: 1500, date: '2026-09-01', cnpj: CNPJ, ...over });
  const september = { start: '2026-09-01', end: '2026-10-01' };
  const october = { start: '2026-10-01', end: '2026-11-01' };

  it('a nota da compra inteira vale para cada parcela, no mês dela e pelo valor dela', () => {
    const result = matchBankToKotii([parcelRow(2), parcelRow(1)], [nota()]);
    expect(summary(result)).toEqual({
      matched: [
        ['parc-parc-a1-2', 'n1', 'alta', 'Compra parcelada: mesmo CNPJ, valor e data da compra'],
        ['parc-parc-a1-1', 'n1', 'alta', 'Compra parcelada: mesmo CNPJ, valor e data da compra'],
      ],
      bankOnly: [],
      kotiiOnly: [],
    });
    expect(result.matched.map((m) => m.via)).toEqual(['parcelada', 'parcelada']);
    expect(reconciliationTotals(reconciliationInRange(result, september))).toEqual({ inKotii: 150, inKotiiCount: 1, bankOnly: 0, bankOnlyCount: 0 });
    expect(reconciliationTotals(reconciliationInRange(result, october))).toEqual({ inKotii: 150, inKotiiCount: 1, bankOnly: 0, bankOnlyCount: 0 });
  });

  it('quem lança cada parcela como gasto: a parcela casa com o gasto do mês dela', () => {
    const result = matchBankToKotii(
      [parcelRow(2, {}, { merchantCnpj: null }), parcelRow(1, {}, { merchantCnpj: null })],
      [record('g9', { label: 'Parcela Magalu', amount: 150, date: '2026-09-02' }), record('g10', { label: 'Parcela Magalu', amount: 150, date: '2026-10-01' })],
    );
    expect(summary(result).matched).toEqual([
      ['parc-parc-a1-2', 'g10', 'alta', 'Mesmo valor e nome parecido'],
      ['parc-parc-a1-1', 'g9', 'alta', 'Mesmo valor e nome parecido'],
    ]);
    expect(result.matched.map((m) => m.via)).toEqual(['parcela', 'parcela']);
  });

  it('nota com o CNPJ vence o gasto de uma parcela, que fica sem par (lançado duas vezes no Kotii)', () => {
    const result = matchBankToKotii([parcelRow(2), parcelRow(1)], [nota(), record('g1', { label: 'Parcela Magalu', amount: 150, date: '2026-10-01' })]);
    expect(summary(result)).toMatchObject({ bankOnly: [], kotiiOnly: ['g1'] });
    expect(result.matched.map((m) => [m.record.id, m.via])).toEqual([
      ['n1', 'parcelada'],
      ['n1', 'parcelada'],
    ]);
  });

  it('a parcela que casou sozinha tira a compra inteira da disputa', () => {
    const result = matchBankToKotii(
      [parcelRow(2, {}, { merchantCnpj: null }), parcelRow(1, {}, { merchantCnpj: null })],
      [nota({ cnpj: null, label: 'Nota' }), record('g1', { label: 'Parcela Magalu', amount: 150, date: '2026-10-01' })],
    );
    // A nota da compra inteira continua como sugestão para a outra parcela.
    expect(summary(result)).toEqual({
      matched: [['parc-parc-a1-2', 'g1', 'alta', 'Mesmo valor e nome parecido']],
      bankOnly: [['parc-parc-a1-1', ['n1']]],
      kotiiOnly: ['n1'],
    });
  });

  it('empate entre duas notas: as parcelas ficam só no banco, com as duas como sugestão da compra inteira', () => {
    const result = matchBankToKotii(
      [parcelRow(2, {}, { merchantCnpj: null }), parcelRow(1, {}, { merchantCnpj: null })],
      [nota({ cnpj: null, label: 'Nota' }), nota({ id: 'n2', cnpj: null, label: 'Nota' })],
    );
    expect(summary(result)).toEqual({
      matched: [],
      bankOnly: [
        ['parc-parc-a1-2', ['n1', 'n2']],
        ['parc-parc-a1-1', ['n1', 'n2']],
      ],
      kotiiOnly: ['n1', 'n2'],
    });
    expect(result.bankOnly[0].suggestions.map((s) => s.via)).toEqual(['parcelada', 'parcelada']);
  });

  it('uma parcela sozinha nunca casa com uma nota, nem com uma do mesmo valor', () => {
    const result = matchBankToKotii(
      [parcelRow(2), parcelRow(1)],
      [nota(), record('n2', { kind: 'nota', label: 'Magazine Luiza', amount: 150, date: '2026-10-01', cnpj: CNPJ })],
    );
    expect(result.matched.map((m) => [m.purchase.key, m.record.id, m.via])).toEqual([
      ['parc-parc-a1-2', 'n1', 'parcelada'],
      ['parc-parc-a1-1', 'n1', 'parcelada'],
    ]);
    expect(result.kotiiOnly.map((r) => r.id)).toEqual(['n2']);
  });

  it('parcelada com juros: nota da mesma loja até 15% abaixo do total; uma parcela sozinha nunca é a nota', () => {
    const interest = matchBankToKotii([parcelRow(2, { parcel: 165, purchaseAmount: 1650 }), parcelRow(1, { parcel: 165, purchaseAmount: 1650 })], [nota()]);
    expect(summary(interest).matched).toEqual([
      ['parc-parc-a1-2', 'n1', 'media', 'Mesma loja e valor um pouco maior: parcelada com juros?'],
      ['parc-parc-a1-1', 'n1', 'media', 'Mesma loja e valor um pouco maior: parcelada com juros?'],
    ]);
    const single = matchBankToKotii([parcelRow(1, { parcel: 160, purchaseAmount: 2000 })], [nota({ amount: 150 })]);
    expect(single.matched).toHaveLength(0);
  });

  it('sem a 1ª parcela: data estimada com 4 dias de folga e os centavos que a 1ª costuma levar', () => {
    const estimated = { purchaseExact: false, seen: [2, 3], parcel: 99.99, purchaseAmount: 999.9 };
    const rowsOf = () => [parcelRow(3, estimated), parcelRow(2, estimated)];
    expect(matchBankToKotii(rowsOf(), [nota({ amount: 999.99, date: '2026-09-05' })]).matched).toHaveLength(2);
    expect(matchBankToKotii(rowsOf(), [nota({ amount: 999.99, date: '2026-09-06' })]).matched).toHaveLength(0);
    expect(matchBankToKotii(rowsOf(), [nota({ amount: 1000.01, date: '2026-09-05' })]).matched).toHaveLength(0);
  });

  it('tarifa em parcelas (anuidade) não casa como compra inteira', () => {
    const fee = { seriesKey: 'parc-f1', parcel: 55, total: 12, purchaseAmount: 660 };
    const result = matchBankToKotii(
      [parcelRow(2, fee, { description: 'ANUIDADE', category: 'taxas', autoCategory: 'taxas', merchantCnpj: null })],
      [record('g1', { label: 'Anuidade', amount: 660, date: '2026-09-01' })],
    );
    expect(summary(result)).toEqual({ matched: [], bankOnly: [['parc-parc-f1-2', []]], kotiiOnly: ['g1'] });
  });

  it('registro de antes de singlesFrom só serve à compra parcelada', () => {
    const result = matchBankToKotii(
      [purchase('p1', { date: '2026-08-01' }), parcelRow(4, { purchaseDate: '2026-05-02' })],
      [record('g1', { date: '2026-07-30' }), nota({ date: '2026-05-02' })],
      { singlesFrom: '2026-08-01' },
    );
    expect(summary(result)).toEqual({
      matched: [['parc-parc-a1-4', 'n1', 'alta', 'Compra parcelada: mesmo CNPJ, valor e data da compra']],
      bankOnly: [['p1', []]],
      kotiiOnly: ['g1'],
    });
  });
});

describe('reconcileWindow / kotiiRecordsStart', () => {
  const today = '2026-10-07';
  const may = { purchaseDate: '2026-05-10', seen: [4, 5, 6] };

  it('a busca do Kotii volta até o mês da compra parcelada mais antiga com parcela na janela', () => {
    expect(kotiiRecordsStart([purchase('p1', {})], today)).toBe('2026-08-01');
    expect(kotiiRecordsStart([parcelRow(4, may), parcelRow(6, may)], today)).toBe('2026-05-01');
    // A 3 dias da virada, a nota pode ser do mês anterior.
    expect(kotiiRecordsStart([parcelRow(4, { purchaseDate: '2026-05-02', seen: [4] })], today)).toBe('2026-04-01');
    // Compra que já não tem parcela na janela, ou tarifa em parcelas, não puxa a busca.
    expect(kotiiRecordsStart([parcelRow(2, may)], today)).toBe('2026-08-01');
    expect(kotiiRecordsStart([parcelRow(4, may, { autoCategory: 'taxas' })], today)).toBe('2026-08-01');
  });

  it('a conferência da janela: parcela de uma compra de maio casa com a nota de maio, mês a mês', () => {
    const records = [record('n1', { kind: 'nota', label: 'Magalu', amount: 1500, date: '2026-05-10', cnpj: CNPJ })];
    const result = reconcileWindow([parcelRow(6, may), parcelRow(5, may), parcelRow(4, may), parcelRow(3, may)], records, today);
    // A parcela 3 (julho) fica fora da janela; as outras, uma por mês, já estão no Kotii.
    expect(result.matched.map((m) => [m.purchase.date, m.record.id])).toEqual([
      ['2026-10-10', 'n1'],
      ['2026-09-10', 'n1'],
      ['2026-08-10', 'n1'],
    ]);
    expect(result.bankOnly).toEqual([]);
  });
});

describe('reconciliationTotals / kotiiRecordsFrom', () => {
  it('soma o que já está no Kotii e o que está só no banco', () => {
    const result = matchBankToKotii(
      [purchase('p1', { amount: 100 }), purchase('p2', { amount: 49.9, date: '2026-10-20' }), purchase('p3', { amount: 0.1, date: '2026-10-21' })],
      [record('g1', {})],
    );
    expect(reconciliationTotals(result)).toEqual({ inKotii: 100, inKotiiCount: 1, bankOnly: 50, bankOnlyCount: 2 });
  });

  it('monta os registros a partir de notas, contas pagas e gastos', () => {
    expect(
      kotiiRecordsFrom({
        receipts: [
          { id: 'r1', date: '2026-10-04', total: 250.4, store: 'Guanabara', cnpj: CNPJ },
          { id: 'r2', date: '2026-10-04', total: null, store: null, cnpj: null },
        ],
        payments: [{ id: 'b1', paid_on: '2026-10-08', amount: 180, bill_name: 'Luz' }],
        expenses: [{ id: 'e1', spent_on: '2026-10-09', amount: 30, description: 'Feira' }],
      }),
    ).toEqual([
      { kind: 'nota', id: 'r1', amount: 250.4, date: '2026-10-04', label: 'Guanabara', cnpj: CNPJ },
      { kind: 'conta', id: 'b1', amount: 180, date: '2026-10-08', label: 'Luz', cnpj: null },
      { kind: 'gasto', id: 'e1', amount: 30, date: '2026-10-09', label: 'Feira', cnpj: null },
    ]);
  });
});
