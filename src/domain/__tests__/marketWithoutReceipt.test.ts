import { describe, expect, it } from '@jest/globals';

import { buildEntries, type ExpenseForSpending, type PaymentForSpending } from '../finance';
import {
  marketMonth,
  marketSpendsOf,
  marketStoreMonth,
  marketTotal,
  marketTrend,
  openLabel,
  type MarketLine,
  type MarketReceipt,
} from '../marketSpend';

// A feira e o sacolão sem nota: os gastos avulsos e as contas pagas lançados como Mercado em Finanças entram no
// total do mês, nas idas e na tendência, sem itens.

const MONTH = '2026-10';
/** Mês já fechado: o anterior entra inteiro nas comparações. */
const AFTER = '2026-11-05';
const TODAY = '2026-10-13';

const at = (month: string, day: number) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, day, 12).toISOString();
};

let nextId = 0;

const line = (name: string, category: string, totalPrice: number): MarketLine => ({
  productId: name,
  productName: name,
  productCategory: category,
  rawDescription: name.toUpperCase(),
  suggestedName: null,
  suggestedCategory: null,
  quantity: 1,
  unit: 'un',
  totalPrice,
});

const receipt = (purchasedAt: string, lines: MarketLine[], partial: Partial<MarketReceipt> = {}): MarketReceipt => ({
  id: `r${++nextId}`,
  purchasedAt,
  status: 'confirmed',
  total: null,
  storeId: 'assai',
  storeName: 'Assaí',
  lines,
  ...partial,
});

/** Um gasto avulso como o Resumo o lê. */
const expense = (id: string, spent_on: string, amount: number, description: string, category = 'mercado'): ExpenseForSpending => ({
  id,
  spent_on,
  amount,
  category,
  description,
});

/** O pagamento de uma conta como o Resumo o lê. */
const payment = (id: string, paid_on: string, amount: number, bill_name: string, bill_category = 'mercado'): PaymentForSpending => ({
  id,
  bill_id: `conta-de-${id}`,
  paid_on,
  amount,
  bill_name,
  bill_category,
});

/** Os gastos sem nota pelo mesmo caminho do app: os lançamentos do Resumo, filtrados. */
const spendsOf = (expenses: ExpenseForSpending[], payments: PaymentForSpending[] = []) => marketSpendsOf(buildEntries([], payments, expenses));

describe('quais lançamentos são gastos de mercado sem nota', () => {
  it('só os gastos avulsos e as contas pagas da categoria Mercado; a nota fica de fora, que já entra pelos itens', () => {
    const entries = buildEntries(
      [{ id: 'n1', purchased_at_date: '2026-10-03', total: 40, store_name: 'Assaí', items: [{ total_price: 40, category: 'graos' }] }],
      [payment('p1', '2026-10-02', 80, 'Cesta do sacolão'), payment('p2', '2026-10-04', 120, 'Luz', 'contas')],
      [expense('e1', '2026-10-05', 25.5, '  Feira  '), expense('e2', '2026-10-06', 90, 'Pizza', 'alimentacao'), expense('e3', '2026-10-07', 12, '')],
    );
    // A nota está no Resumo como Mercado, e mesmo assim não vira gasto sem nota: nada conta duas vezes.
    expect(entries.some((entry) => entry.source === 'nota' && entry.category === 'mercado')).toBe(true);
    expect(marketSpendsOf(entries)).toEqual([
      // Sem descrição, o que ele é.
      { key: 'gasto-e3', source: 'gasto', refId: 'e3', date: '2026-10-07', amount: 12, name: 'Gasto avulso' },
      { key: 'gasto-e1', source: 'gasto', refId: 'e1', date: '2026-10-05', amount: 25.5, name: 'Feira' },
      // O pagamento abre a conta.
      { key: 'conta-p1', source: 'conta', refId: 'conta-de-p1', date: '2026-10-02', amount: 80, name: 'Cesta do sacolão' },
    ]);
  });

  it('o toque abre o que é: a nota, o gasto ou a conta', () => {
    expect(openLabel({ kind: 'nota', id: 'n1' })).toBe('Abrir a nota');
    expect(openLabel({ kind: 'gasto', id: 'e1' })).toBe('Abrir o gasto');
    expect(openLabel({ kind: 'conta', id: 'b1' })).toBe('Abrir a conta');
  });
});

describe('o mês com notas e gastos sem nota', () => {
  const assai = receipt(at(MONTH, 3), [line('Arroz', 'graos', 30), line('Banana', 'hortifruti', 10)]);
  const spends = spendsOf(
    [
      expense('e1', '2026-10-05', 25.5, 'feira'),
      expense('e2', '2026-10-12', 14.5, 'Feira'),
      // Outra categoria: fica no Resumo, não aqui.
      expense('e3', '2026-10-06', 90, 'Pizza', 'alimentacao'),
    ],
    [payment('p1', '2026-10-03', 80, 'Cesta do sacolão'), payment('p2', '2026-10-08', 120, 'Luz', 'contas')],
  );

  it('soma os dois no total e nas idas; os itens e as categorias continuam só das notas', () => {
    const month = marketMonth([assai], MONTH, AFTER, spends);
    // 40 da nota, 25,50 + 14,50 da feira e 80 da conta paga.
    expect(month.headline).toBe('R$ 160,00 em 4 idas');
    expect(month.totalCents).toBe(16000);
    // A entrada no Resumo faz a mesma conta.
    expect(marketTotal([assai], MONTH, undefined, spends)).toMatchObject({ totalCents: month.totalCents, headline: month.headline });
    expect(month.itemsCents).toBe(4000);
    expect(month.categories.map((c) => [c.label, c.amount, c.share])).toEqual([
      ['Grãos, massas e cereais', 'R$ 30,00', '75%'],
      ['Frutas e verduras', 'R$ 10,00', '25%'],
    ]);
    expect(month.items.map((i) => i.name)).toEqual(['Arroz', 'Banana']);
    // As partes são sobre os itens, e a tela diz isso.
    expect(month.shareBasis).toBe('As porcentagens são sobre os itens lidos (R$ 40,00).');
    // Como o total fecha: os gastos sem nota estão nele, numa linha.
    expect(month.closing).toBe('Inclui R$ 120,00 de gastos lançados sem nota.');
    expect(month.withoutReceipt).toEqual({ label: 'Gastos lançados sem nota', value: 'R$ 120,00', accessibilityLabel: 'Gastos lançados sem nota: R$ 120,00' });
    expect(month.comparison).toBe('Não teve compra de mercado em setembro');
  });

  it('as idas, pela data, com as sem nota dizendo o que são e abrindo o gasto ou a conta', () => {
    const month = marketMonth([assai], MONTH, AFTER, spends);
    expect(month.trips.map((t) => [t.storeName, t.detail, t.amount])).toEqual([
      ['Feira', '12 out · gasto avulso · sem itens', 'R$ 14,50'],
      ['feira', '5 out · gasto avulso · sem itens', 'R$ 25,50'],
      // No mesmo dia, a nota (que tem hora) antes da conta (que não tem).
      ['Assaí', '3 out · 2 itens', 'R$ 40,00'],
      ['Cesta do sacolão', '3 out · conta paga · sem itens', 'R$ 80,00'],
    ]);
    expect(month.trips.map((t) => t.opens)).toEqual([
      { kind: 'gasto', id: 'e2' },
      { kind: 'gasto', id: 'e1' },
      { kind: 'nota', id: assai.id },
      { kind: 'conta', id: 'conta-de-p1' },
    ]);
    expect(new Set(month.trips.map((t) => t.key)).size).toBe(4);
    expect(month.trips[0].accessibilityLabel).toBe('Feira: R$ 14,50, 12 out, gasto avulso, sem itens');
    expect(month.trips.reduce((sum, t) => sum + t.cents, 0)).toBe(month.totalCents);
  });

  it('nos mercados, os gastos de mesmo nome ficam juntos, sem nota e sem itens', () => {
    const month = marketMonth([assai], MONTH, AFTER, spends);
    // "feira" e "Feira" são o mesmo lugar; o nome é o do gasto mais recente.
    expect(month.stores.map((s) => [s.name, s.amount, s.detail, s.noReceipt])).toEqual([
      ['Cesta do sacolão', 'R$ 80,00', '1 ida · sem nota', true],
      ['Assaí', 'R$ 40,00', '1 ida', false],
      ['Feira', 'R$ 40,00', '2 idas · sem nota', true],
    ]);
    expect(month.stores[2].accessibilityLabel).toBe('Feira: R$ 40,00 em 2 idas, sem nota');
    expect(month.stores.reduce((sum, s) => sum + s.cents, 0)).toBe(month.totalCents);

    const feira = marketStoreMonth([assai], MONTH, AFTER, month.stores[2], spends);
    expect(feira).toMatchObject({ title: 'Feira', headline: 'R$ 40,00 em 2 idas', items: [], emptyItems: 'Lançados sem nota: não têm itens.' });
    expect(feira!.trips.map((t) => [t.detail, t.opens])).toEqual([
      ['12 out · gasto avulso · sem itens', { kind: 'gasto', id: 'e2' }],
      ['5 out · gasto avulso · sem itens', { kind: 'gasto', id: 'e1' }],
    ]);
    expect(marketStoreMonth([assai], MONTH, AFTER, month.stores[0], spends)?.emptyItems).toBe('Lançado sem nota: não tem itens.');
    // O mercado da nota continua só com as idas dele.
    expect(marketStoreMonth([assai], MONTH, AFTER, month.stores[1], spends)?.headline).toBe('R$ 40,00 em 1 ida');
  });

  it('mês só com gastos sem nota: tem total e idas, e os itens dizem por que não há nenhum', () => {
    const month = marketMonth([], MONTH, AFTER, spendsOf([expense('e1', '2026-10-05', 25.5, 'Feira')]));
    expect(month.headline).toBe('R$ 25,50 em 1 ida');
    expect(month.items).toEqual([]);
    expect(month.categories).toEqual([]);
    expect(month.emptyItems).toBe('Os gastos de mercado deste mês foram lançados sem nota, e por isso não têm itens.');
    expect(month.shareBasis).toBeNull();
    expect(month.change).toBeNull();
    // Com nota, a frase de sempre.
    expect(marketMonth([assai], MONTH, AFTER).emptyItems).toBe('As notas deste mês vieram sem nenhum item lido.');
  });

  it('gasto de zero não é ida', () => {
    expect(marketTotal([], MONTH, undefined, spendsOf([expense('e1', '2026-10-05', 0, 'Feira')]))).toMatchObject({ totalCents: 0, trips: 0 });
  });
});

describe('o mesmo corte de data das notas', () => {
  const assai = receipt(at(MONTH, 3), [line('Arroz', 'graos', 40)]);
  const today = spendsOf([expense('e1', TODAY, 25.5, 'Feira')]);
  const futureSpend = spendsOf([expense('e2', '2026-10-20', 30, 'Feira')]);
  const futureBill = spendsOf([], [payment('p1', '2026-10-25', 80, 'Cesta do sacolão')]);

  it('no mês corrente, o gasto de hoje entra; o de depois de hoje fica de fora e aparece para conferir', () => {
    const month = marketMonth([assai], MONTH, TODAY, [...today, ...futureSpend, ...futureBill]);
    expect(month.headline).toBe('R$ 65,50 em 2 idas');
    expect(marketTotal([assai], MONTH, TODAY, [...today, ...futureSpend, ...futureBill]).totalCents).toBe(month.totalCents);
    expect(month.later).toEqual({
      label: '1 gasto e 1 conta com data depois de hoje',
      hint: 'Ficam de fora deste total até o dia chegar. Se a data está errada, toque para abrir e conferir.',
      receipts: [
        {
          key: 'conta-p1',
          opens: { kind: 'conta', id: 'conta-de-p1' },
          storeName: 'Cesta do sacolão',
          date: '25 out',
          value: 'R$ 80,00',
          accessibilityLabel: 'Cesta do sacolão, 25 out: R$ 80,00. Abrir a conta',
        },
        { key: 'gasto-e2', opens: { kind: 'gasto', id: 'e2' }, storeName: 'Feira', date: '20 out', value: 'R$ 30,00', accessibilityLabel: 'Feira, 20 out: R$ 30,00. Abrir o gasto' },
      ],
    });
    expect(month.closing).toBe('Inclui R$ 25,50 de gastos lançados sem nota. Sem contar 1 gasto e 1 conta com data depois de hoje.');
  });

  it('cada tipo diz o que abrir; com nota e gasto juntos, a nota vem contada primeiro', () => {
    const spend = marketMonth([assai], MONTH, TODAY, futureSpend);
    expect(spend.later?.label).toBe('1 gasto com data depois de hoje');
    expect(spend.later?.hint).toBe('Fica de fora deste total até o dia chegar. Se a data está errada, abra o gasto para conferir.');
    expect(marketMonth([assai], MONTH, TODAY, futureBill).later?.hint).toBe(
      'Fica de fora deste total até o dia chegar. Se a data está errada, abra a conta para conferir.',
    );
    const both = marketMonth([assai, receipt(at(MONTH, 22), [line('Feijão', 'graos', 9)])], MONTH, TODAY, futureSpend);
    expect(both.later?.label).toBe('1 nota e 1 gasto com data depois de hoje');
    expect(both.later?.hint).toBe('Ficam de fora deste total até o dia chegar. Se a data está errada, toque para abrir e conferir.');
    expect(both.later?.receipts.map((r) => [r.storeName, r.date, r.opens.kind])).toEqual([
      ['Assaí', '22 out', 'nota'],
      ['Feira', '20 out', 'gasto'],
    ]);
  });

  it('num mês fechado, o mês inteiro conta, e não há nada para depois', () => {
    const month = marketMonth([assai], MONTH, AFTER, [...today, ...futureSpend, ...futureBill]);
    expect(month.headline).toBe('R$ 175,50 em 4 idas');
    expect(month.later).toBeNull();
  });

  it('o mês anterior da comparação também é só até o mesmo dia', () => {
    const september = spendsOf([expense('s1', '2026-09-10', 20, 'Feira'), expense('s2', '2026-09-20', 50, 'Feira')]);
    const month = marketMonth([assai], MONTH, TODAY, [...september, ...today]);
    // Até 13 de setembro só a feira do dia 10 conta: 65,50 contra 20.
    expect(month.comparison).toBe('R$ 45,50 a mais que até o dia 13 de setembro');
  });
});

describe('comparação e "O que mudou" com gastos sem nota', () => {
  const september = receipt(at('2026-09', 5), [line('Arroz', 'graos', 30)]);
  const october = receipt(at(MONTH, 4), [line('Arroz', 'graos', 40)]);

  it('o total compara tudo; "O que mudou" é dos itens, e diz que o total pago também conta os gastos sem nota', () => {
    const spends = spendsOf([expense('s1', '2026-09-06', 20, 'Feira'), expense('o1', '2026-10-06', 50, 'Feira')]);
    const month = marketMonth([september, october], MONTH, AFTER, spends);
    expect(month.comparison).toBe('R$ 40,00 a mais que em setembro');
    expect(month.change?.headline).toBe('Nos itens, R$ 10,00 a mais que em setembro');
    expect(month.change?.totalNote).toBe('O total pago, lá em cima, também conta os gastos lançados sem nota.');
  });

  it('o mesmo gasto sem nota nos dois meses não é motivo: a frase não aparece', () => {
    const spends = spendsOf([expense('s1', '2026-09-06', 20, 'Feira'), expense('o1', '2026-10-06', 20, 'Feira')]);
    expect(marketMonth([september, october], MONTH, AFTER, spends).change?.totalNote).toBeNull();
  });

  it('mês anterior só com gasto sem nota: o total compara, os itens e as categorias não têm com o que comparar', () => {
    const month = marketMonth([october], MONTH, AFTER, spendsOf([expense('s1', '2026-09-06', 20, 'Feira')]));
    expect(month.comparison).toBe('R$ 20,00 a mais que em setembro');
    expect(month.categories.map((c) => c.versusPrevious)).toEqual(['']);
    expect(month.change).toBeNull();
  });
});

describe('a tendência', () => {
  const receipts = [receipt(at('2026-09', 5), [line('Arroz', 'graos', 30)])];
  const spends = spendsOf([
    expense('a1', '2026-08-10', 25, 'Feira'),
    expense('s1', '2026-09-06', 20, 'Feira'),
    // Depois de hoje: fica de fora, como no cabeçalho.
    expense('o1', '2026-10-20', 30, 'Feira'),
  ]);

  it('o total de cada mês tem os gastos sem nota, pela mesma conta do cabeçalho', () => {
    const trend = marketTrend(receipts, MONTH, TODAY, null, spends);
    expect(trend.bars.map((bar) => [bar.label, bar.short])).toEqual([
      ['mai', 'sem ida'],
      ['jun', 'sem ida'],
      ['jul', 'sem ida'],
      // Agosto só teve feira: é um mês com ida.
      ['ago', '25'],
      ['set', '50'],
      ['out', 'sem ida'],
    ]);
    expect(trend.bars[4].cents).toBe(marketMonth(receipts, '2026-09', TODAY, spends).totalCents);
    expect(trend.average).toBe('Média dos meses fechados: R$ 37,50');
    expect(trend.averageNote).toBe('3 meses sem ida ao mercado ficam fora da média.');
  });

  it('numa categoria, o mês só com gastos sem nota diz "sem nota", não zero, e fica fora da média', () => {
    const trend = marketTrend(receipts, MONTH, TODAY, 'graos', spends);
    expect(trend.bars[3]).toMatchObject({
      cents: 0,
      amount: 'só gastos lançados sem nota',
      short: 'sem nota',
      hasTrips: true,
      noItems: true,
      spoken: 'Agosto: só gastos lançados sem nota',
    });
    expect(trend.bars[4]).toMatchObject({ cents: 3000, short: '30', noItems: false });
    expect(trend.average).toBe('Média dos meses fechados: R$ 30,00');
    expect(trend.averageNote).toBe('3 meses sem ida ao mercado e 1 mês só com gastos lançados sem nota ficam fora da média.');
    // Sem categoria, nenhum mês é "sem nota".
    expect(marketTrend(receipts, MONTH, TODAY, null, spends).bars.some((bar) => bar.noItems)).toBe(false);
  });

  it('um mês só fora da média: "fica"', () => {
    const trend = marketTrend(
      [receipt(at('2026-06', 5), [line('Arroz', 'graos', 30)]), receipt(at('2026-07', 5), [line('Arroz', 'graos', 30)]), receipt(at('2026-08', 5), [line('Arroz', 'graos', 30)]), receipt(at('2026-09', 5), [line('Arroz', 'graos', 30)])],
      MONTH,
      TODAY,
      'graos',
      spendsOf([expense('m1', '2026-05-10', 25, 'Feira')]),
    );
    expect(trend.averageNote).toBe('1 mês só com gastos lançados sem nota fica fora da média.');
  });
});
