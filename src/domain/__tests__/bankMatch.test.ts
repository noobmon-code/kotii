import { describe, expect, it } from '@jest/globals';

import {
  matchBankToKotii,
  namesOverlap,
  type KotiiRecord,
  kotiiRecordsFrom,
  reconciliationInRange,
  reconciliationTotals,
} from '../bankMatch';
import type { BankPurchase } from '../bankMonth';

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
  installments: null,
  txIds: [key],
  personTransfer: false,
  sensitive: false,
  storeName: null,
  refundOf: null,
  ...over,
});

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
  bankOnly: result.bankOnly.map((b) => [b.purchase.key, b.suggestions.map((s) => s.id)]),
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
