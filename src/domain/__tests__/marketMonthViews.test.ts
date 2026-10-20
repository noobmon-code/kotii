import { describe, expect, it } from '@jest/globals';

import {
  itemOrderFromParam,
  MARKET_ITEM_ORDERS,
  marketMonth,
  marketStoreMonth,
  marketTrend,
  marketVsSummary,
  orderMarketItems,
  type MarketLine,
  type MarketReceipt,
} from '../marketSpend';

// As partes da tela do mês que a pessoa escolhe: a ordem dos itens, um mercado aberto, a frase que diz por que
// o total não é a barra do Resumo e o que o leitor de tela diz de cada mês da tendência.

const MONTH = '2026-10';
/** Mês já fechado: o anterior entra inteiro nas comparações. */
const AFTER = '2026-11-05';

const at = (month: string, day: number, hour = 12) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, day, hour).toISOString();
};

let nextId = 0;

const line = (name: string, category: string, totalPrice: number | null, quantity = 1, unit = 'un'): MarketLine => ({
  productId: name,
  productName: name,
  productCategory: category,
  rawDescription: name.toUpperCase(),
  suggestedName: null,
  suggestedCategory: null,
  quantity,
  unit,
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

/** Três idas: leite e pão nas três, tomate por peso numa e por unidade na outra, suco por volume. */
const HOUSE = [
  receipt(at(MONTH, 3), [
    line('Leite', 'laticinios', 60, 12),
    line('Arroz', 'graos', 30, 5, 'kg'),
    line('Tomate', 'hortifruti', 5, 0.8, 'kg'),
    line('Suco', 'bebidas', 9, 1, 'l'),
    line('Pão', 'padaria', 8, 10),
  ]),
  receipt(at(MONTH, 8), [line('Leite', 'laticinios', 30, 6), line('Tomate', 'hortifruti', 3, 4), line('Pão', 'padaria', 8, 10), line('Café', 'cafe_cha', 18)]),
  receipt(at(MONTH, 10), [line('Leite', 'laticinios', 30, 6), line('Pão', 'padaria', 4, 5), line('Feijão', 'graos', 9, 1, 'kg'), line('Água', 'bebidas', 6, 3000, 'ml')]),
];

const names = (groups: ReturnType<typeof orderMarketItems>) => groups.map((group) => [group.title, group.items.map((item) => item.name)]);

describe('a ordem dos itens', () => {
  const { items } = marketMonth(HOUSE, MONTH, AFTER);

  it('as três ordens, Valor primeiro; a ordem pedida que não existe cai em Valor', () => {
    expect(MARKET_ITEM_ORDERS.map((order) => order.label)).toEqual(['Valor', 'Quantidade', 'Idas']);
    expect(itemOrderFromParam(undefined)).toBe('valor');
    expect(itemOrderFromParam(['idas'])).toBe('idas');
    expect(itemOrderFromParam('qualquer')).toBe('valor');
  });

  it('por valor: um grupo só, na ordem do mês (do que levou mais dinheiro)', () => {
    expect(names(orderMarketItems(items, 'valor'))).toEqual([[null, ['Leite', 'Arroz', 'Pão', 'Café', 'Feijão', 'Suco', 'Tomate', 'Água']]]);
  });

  it('cada item sabe em quantas idas foi comprado e quanto, na medida em que se soma', () => {
    const of = (name: string) => items.find((item) => item.name === name)!;
    expect([of('Leite').trips, of('Leite').quantity]).toEqual([3, { measure: 'un', amount: 24_000 }]);
    // 5 kg são 5000 g, em milésimos.
    expect(of('Arroz').quantity).toEqual({ measure: 'peso', amount: 5_000_000 });
    expect(of('Água').quantity).toEqual({ measure: 'volume', amount: 3_000_000 });
    // kg numa ida, un na outra: não se soma.
    expect([of('Tomate').trips, of('Tomate').quantity]).toEqual([2, null]);
  });

  it('por quantidade: unidade, peso e volume em grupos, do mais comprado; o que não se soma por último, dizendo por quê', () => {
    const groups = orderMarketItems(items, 'quantidade');
    expect(names(groups)).toEqual([
      ['Por unidade', ['Pão', 'Leite', 'Café']],
      ['Por peso', ['Arroz', 'Feijão']],
      // 3 litros de água passam de 1 litro de suco.
      ['Por volume', ['Água', 'Suco']],
      ['Em medidas que não se somam', ['Tomate']],
    ]);
    expect(groups.map((group) => group.hint)).toEqual([
      null,
      null,
      null,
      'Comprados ora por unidade, ora por peso ou volume: a quantidade não se soma, e a linha diz quantas compras foram.',
    ]);
  });

  it('por quantidade, no empate o valor; uma unidade que não é peso, volume nem "un" ganha um grupo com o nome dela', () => {
    const month = marketMonth(
      [receipt(at(MONTH, 3), [line('Ovos', 'ovos', 12, 2, 'dz'), line('Sabão', 'limpeza', 5, 2), line('Detergente', 'limpeza', 7, 2)])],
      MONTH,
      AFTER,
    );
    expect(names(orderMarketItems(month.items, 'quantidade'))).toEqual([
      ['Por unidade', ['Detergente', 'Sabão']],
      ['Em dz', ['Ovos']],
    ]);
  });

  it('por idas: em quantas idas do mês, e no empate o valor', () => {
    expect(names(orderMarketItems(items, 'idas'))).toEqual([[null, ['Leite', 'Pão', 'Tomate', 'Arroz', 'Café', 'Feijão', 'Suco', 'Água']]]);
  });

  it('o corte pega os primeiros na ordem dos grupos e não deixa grupo vazio', () => {
    expect(names(orderMarketItems(items, 'quantidade', 4))).toEqual([
      ['Por unidade', ['Pão', 'Leite', 'Café']],
      ['Por peso', ['Arroz']],
    ]);
    expect(names(orderMarketItems(items, 'valor', 2))).toEqual([[null, ['Leite', 'Arroz']]]);
    // Sem corte, todos.
    expect(orderMarketItems(items, 'idas').flatMap((group) => group.items)).toHaveLength(items.length);
  });
});

describe('mercados de mesmo nome', () => {
  it('o endereço separa os dois; sem endereço, o CNPJ; o nome que não se repete fica sozinho', () => {
    const month = marketMonth(
      [
        receipt(at(MONTH, 3), [line('Arroz', 'graos', 30)], { storeId: 'a1', storeAddress: ' Av. Brasil, 100 ' }),
        receipt(at(MONTH, 4), [line('Arroz', 'graos', 20)], { storeId: 'a2', storeName: 'ASSAÍ', storeCnpj: '12345678000190' }),
        receipt(at(MONTH, 5), [line('Arroz', 'graos', 10)], { storeId: 'd1', storeName: 'Dia', storeAddress: 'Rua X, 1' }),
      ],
      MONTH,
      AFTER,
    );
    expect(month.stores.map((store) => [store.name, store.place, store.detail, store.accessibilityLabel])).toEqual([
      ['Assaí', 'Av. Brasil, 100', 'Av. Brasil, 100 · 1 ida', 'Assaí, Av. Brasil, 100: R$ 30,00 em 1 ida'],
      // Maiúsculas não fazem outro nome.
      ['ASSAÍ', 'CNPJ 12.345.678/0001-90', 'CNPJ 12.345.678/0001-90 · 1 ida', 'ASSAÍ, CNPJ 12.345.678/0001-90: R$ 20,00 em 1 ida'],
      ['Dia', null, '1 ida', 'Dia: R$ 10,00 em 1 ida'],
    ]);
  });
});

describe('um mercado aberto', () => {
  const receipts = [
    receipt(at(MONTH, 3, 9), [line('Arroz', 'graos', 30), line('Café', 'cafe_cha', 18), line('Dipirona', 'medicamentos', 12)], { total: 55 }),
    receipt(at(MONTH, 9), [line('Arroz', 'graos', 30), line('Leite', 'laticinios', 12, 2)], { storeAddress: 'Av. Brasil, 100' }),
    receipt(at(MONTH, 5), [line('Feijão', 'graos', 9)], { storeId: 'dia', storeName: 'Dia' }),
    receipt(at(MONTH, 6), [line('Banana', 'hortifruti', 4)], { storeId: null, storeName: null }),
    // Do mês anterior e rascunho: não entram.
    receipt(at('2026-09', 20), [line('Arroz', 'graos', 25)]),
    receipt(at(MONTH, 7), [], { status: 'draft' }),
  ];
  const month = marketMonth(receipts, MONTH, AFTER);
  const store = (key: string) => marketStoreMonth(receipts, MONTH, AFTER, month.stores.find((s) => s.key === key)!);

  it('as idas dele (da mais recente) e os itens, com a parte sobre os itens dele; o total bate com a linha do mercado', () => {
    const assai = store('assai')!;
    expect(assai.title).toBe('Assaí');
    expect(assai.headline).toBe('R$ 86,00 em 2 idas');
    expect(month.stores[0]).toMatchObject({ key: 'assai', amount: 'R$ 86,00', detail: '2 idas' });
    expect(assai.trips.map((trip) => [trip.detail, trip.amount])).toEqual([
      ['9 out · 2 itens', 'R$ 42,00'],
      // O desconto do total (R$ 5,00) repartido: R$ 4,00 do mercado, que paga R$ 44,00; a farmácia fica fora.
      ['3 out · 2 itens · farmácia fora: R$ 11,00', 'R$ 44,00'],
    ]);
    expect(assai.items.map((item) => [item.name, item.amount, item.share, item.detail])).toEqual([
      ['Arroz', 'R$ 60,00', '67%', '2 un · em 2 idas'],
      ['Café', 'R$ 18,00', '20%', '1 un · em 1 ida'],
      ['Leite', 'R$ 12,00', '13%', '2 un · em 1 ida'],
    ]);
    // Sem o mês anterior na linha: o valor de setembro seria só deste mercado, e confundiria.
    expect(assai.items[0].accessibilityLabel).toBe('Arroz: R$ 60,00, 67% dos itens deste mercado, 2 un, em 2 idas');
  });

  it('as notas sem mercado também abrem; mercado sem ida no período não abre nada', () => {
    expect(store('')).toMatchObject({ title: 'Sem mercado informado', headline: 'R$ 4,00 em 1 ida' });
    expect(store('dia')!.items.map((item) => item.name)).toEqual(['Feijão']);
    expect(marketStoreMonth(receipts, '2026-08', AFTER, month.stores[0])).toBeNull();
  });

  it('no mês corrente, só até hoje, como o resto da tela', () => {
    const today = '2026-10-08';
    const current = marketMonth(receipts, MONTH, today);
    const assai = marketStoreMonth(receipts, MONTH, today, current.stores.find((s) => s.key === 'assai')!)!;
    expect(assai.headline).toBe('R$ 44,00 em 1 ida');
    expect(assai.trips.map((trip) => trip.detail)).toEqual(['3 out · 2 itens · farmácia fora: R$ 11,00']);
  });

  it('com dois mercados de mesmo nome, o título leva o que os separa', () => {
    const twins = [...receipts, receipt(at(MONTH, 12), [line('Arroz', 'graos', 31)], { storeId: 'assai2', storeAddress: 'Rua das Flores, 5' })];
    const both = marketMonth(twins, MONTH, AFTER);
    const title = (key: string) => marketStoreMonth(twins, MONTH, AFTER, both.stores.find((s) => s.key === key)!)!.title;
    // O endereço é o da ida mais recente.
    expect(title('assai')).toBe('Assaí (Av. Brasil, 100)');
    expect(title('assai2')).toBe('Assaí (Rua das Flores, 5)');
  });
});

describe('por que não é a barra "Mercado" do Resumo', () => {
  it('na tela do mês e no Resumo; no mês corrente fala da nota com data depois de hoje, num mês passado não', () => {
    expect(marketVsSummary(MONTH, '2026-10-13', 'mes')).toBe(
      'Diferente da barra “Mercado” do Resumo: aqui só contam notas fiscais, com limpeza, higiene, papel, bebê, pet e os itens de “Outros”, sem remédio e sem nota com data depois de hoje.',
    );
    expect(marketVsSummary('2026-09', '2026-10-13', 'mes')).toBe(
      'Diferente da barra “Mercado” do Resumo: aqui só contam notas fiscais, com limpeza, higiene, papel, bebê, pet e os itens de “Outros”, sem remédio.',
    );
    expect(marketVsSummary(MONTH, '2026-10-13', 'resumo')).toBe(
      'Diferente da barra “Mercado”: aqui só contam notas fiscais, com limpeza, higiene, papel, bebê, pet e os itens de “Outros”, sem remédio e sem nota com data depois de hoje.',
    );
  });
});

describe('cada mês da tendência, para o leitor de tela', () => {
  it('o mês e o valor; o corrente "até hoje"; na virada do ano, com o ano', () => {
    const trend = marketTrend([receipt(at('2026-09', 5), [line('Arroz', 'graos', 30)]), receipt(at(MONTH, 5), [line('Arroz', 'graos', 40)])], MONTH, '2026-10-13');
    expect(trend.bars.map((bar) => bar.spoken)).toEqual([
      'Maio: sem ida ao mercado',
      'Junho: sem ida ao mercado',
      'Julho: sem ida ao mercado',
      'Agosto: sem ida ao mercado',
      'Setembro: R$ 30,00',
      'Outubro até hoje: R$ 40,00',
    ]);
    const crossing = marketTrend([], '2027-02', '2027-02-10');
    expect(crossing.bars.map((bar) => bar.spoken).slice(3, 5)).toEqual(['Dezembro de 2026: sem ida ao mercado', 'Janeiro de 2027: sem ida ao mercado']);
  });
});
