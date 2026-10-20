import { describe, expect, it } from '@jest/globals';

import {
  MARKET_ITEM_ORDERS,
  marketMonth,
  marketStoreMonth,
  marketTrend,
  marketVsSummary,
  noCategoryItems,
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

const names = (list: ReturnType<typeof orderMarketItems>) => list.groups.map((group) => [group.title, group.items.map((item) => item.name)]);

describe('a ordem dos itens', () => {
  const { items } = marketMonth(HOUSE, MONTH, AFTER);

  it('as três ordens, Valor primeiro', () => {
    expect(MARKET_ITEM_ORDERS.map((order) => order.label)).toEqual(['Valor', 'Quantidade', 'Idas']);
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
    const list = orderMarketItems(items, 'quantidade');
    expect(names(list)).toEqual([
      ['Por unidade', ['Pão', 'Leite', 'Café']],
      ['Por peso', ['Arroz', 'Feijão']],
      // 3 litros de água passam de 1 litro de suco.
      ['Por volume', ['Água', 'Suco']],
      ['Em medidas que não se somam', ['Tomate']],
    ]);
    expect(list.toggle).toBeNull();
    expect(list.groups.map((group) => group.hint)).toEqual([
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

  it('por valor e por idas, o corte pega os primeiros; o botão diz quantos são e volta aos primeiros', () => {
    const cut = { shown: 2, more: 'Ver todos os 8 itens', less: 'Mostrar só os 2 primeiros' };
    expect(orderMarketItems(items, 'valor', cut)).toEqual({ groups: [expect.objectContaining({ title: null, rest: null })], toggle: 'Ver todos os 8 itens' });
    expect(names(orderMarketItems(items, 'valor', cut))).toEqual([[null, ['Leite', 'Arroz']]]);
    expect(names(orderMarketItems(items, 'idas', cut))).toEqual([[null, ['Leite', 'Pão']]]);
    const all = orderMarketItems(items, 'valor', cut, true);
    expect(all.groups[0].items).toHaveLength(items.length);
    expect(all.toggle).toBe('Mostrar só os 2 primeiros');
    // Sem corte, todos, e nenhum botão.
    expect(orderMarketItems(items, 'idas')).toEqual({ groups: [expect.objectContaining({ items: expect.any(Array) })], toggle: null });
    expect(orderMarketItems(items, 'idas').groups[0].items).toHaveLength(items.length);
  });

  it('por quantidade, o corte é por medida: dez itens por unidade não escondem o peso, o volume nem o que não se soma', () => {
    const units = Array.from({ length: 12 }, (_, index) => line(`Unidade ${String(index + 1).padStart(2, '0')}`, 'limpeza', 1, 12 - index));
    const month = marketMonth(
      [
        receipt(at(MONTH, 3), [
          ...units,
          ...[4, 3, 2, 1].map((kg) => line(`Peso ${kg}`, 'carnes', 1, kg, 'kg')),
          line('Litro 2', 'bebidas', 1, 2, 'l'),
          line('Litro 1', 'bebidas', 1, 1, 'l'),
          line('Tomate', 'hortifruti', 1, 0.5, 'kg'),
        ]),
        receipt(at(MONTH, 8), [line('Tomate', 'hortifruti', 1, 2)]),
      ],
      MONTH,
      AFTER,
    );
    expect(month.itemsCut).toEqual({ shown: 10, more: 'Ver todos os 19 itens', less: 'Mostrar só os 10 primeiros' });
    const list = orderMarketItems(month.items, 'quantidade', month.itemsCut);
    // Cada medida com os primeiros dela (pelo menos 3); a vaga que sobra vai para o primeiro grupo.
    expect(names(list)).toEqual([
      ['Por unidade', ['Unidade 01', 'Unidade 02', 'Unidade 03', 'Unidade 04']],
      ['Por peso', ['Peso 4', 'Peso 3', 'Peso 2']],
      ['Por volume', ['Litro 2', 'Litro 1']],
      ['Em medidas que não se somam', ['Tomate']],
    ]);
    expect(list.groups.flatMap((group) => group.items)).toHaveLength(10);
    // O grupo cortado diz quantos ficaram para o "Ver todos"; o que veio inteiro não diz nada.
    expect(list.groups.map((group) => group.rest)).toEqual([
      'Mais 8 itens por unidade: veja em “Ver todos”.',
      'Mais 1 item por peso: veja em “Ver todos”.',
      null,
      null,
    ]);
    expect(list.groups[3].hint).toContain('a quantidade não se soma');
    expect(list.toggle).toBe('Ver todos os 19 itens');

    const all = orderMarketItems(month.items, 'quantidade', month.itemsCut, true);
    expect(all.groups.map((group) => group.items.length)).toEqual([12, 4, 2, 1]);
    expect(all.groups.map((group) => group.rest)).toEqual([null, null, null, null]);
    // Voltar ao corte não é "os 10 primeiros": é o começo de cada medida.
    expect(all.toggle).toBe('Mostrar só os primeiros de cada medida');
  });

  it('por quantidade, as vagas de uma medida pequena vão para as outras; numa medida só, os 10 primeiros', () => {
    const many = (count: number) => Array.from({ length: count }, (_, index) => line(`Item ${String(index + 1).padStart(2, '0')}`, 'limpeza', 1, count - index));
    const twoMeasures = marketMonth([receipt(at(MONTH, 3), [...many(25), line('Carne', 'carnes', 1, 1, 'kg')])], MONTH, AFTER);
    const two = orderMarketItems(twoMeasures.items, 'quantidade', twoMeasures.itemsCut);
    expect(two.groups.map((group) => [group.title, group.items.length, group.rest])).toEqual([
      ['Por unidade', 9, 'Mais 16 itens por unidade: veja em “Ver todos”.'],
      ['Por peso', 1, null],
    ]);

    const oneMeasure = marketMonth([receipt(at(MONTH, 3), many(12))], MONTH, AFTER);
    const one = orderMarketItems(oneMeasure.items, 'quantidade', oneMeasure.itemsCut);
    expect(one.groups.map((group) => [group.title, group.items.length, group.rest])).toEqual([['Por unidade', 10, null]]);
    expect(orderMarketItems(oneMeasure.items, 'quantidade', oneMeasure.itemsCut, true).toggle).toBe('Mostrar só os 10 primeiros');
  });

  it('corte que, por medida, já mostra todos os itens não tem botão', () => {
    // 8 itens em 4 medidas: até 3 de cada cabem todos.
    const list = orderMarketItems(items, 'quantidade', { shown: 4, more: 'Ver todos os 8 itens', less: 'Mostrar só os 4 primeiros' });
    expect(list.groups.flatMap((group) => group.items)).toHaveLength(items.length);
    expect(list.toggle).toBeNull();
    expect(list.groups.map((group) => group.rest)).toEqual([null, null, null, null]);
  });
});

describe('uma categoria escolhida sem item no mês', () => {
  it('a frase diz a categoria e o mês', () => {
    expect(noCategoryItems('graos', '2026-08')).toBe('Nenhum item de “Grãos, massas e cereais” em agosto.');
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

  it('só os que não têm endereço nem CNPJ ganham número: um sozinho é "sem endereço", nunca "loja 2" sem "loja 1"', () => {
    const month = marketMonth(
      [
        receipt(at(MONTH, 3), [line('Arroz', 'graos', 30)], { storeId: 'a3', storeCnpj: '12345678000190' }),
        receipt(at(MONTH, 4), [line('Arroz', 'graos', 20)], { storeId: 'a2' }),
        receipt(at(MONTH, 5), [line('Arroz', 'graos', 10)], { storeId: 'a1', storeAddress: 'Av. Brasil, 100' }),
      ],
      MONTH,
      AFTER,
    );
    expect(month.stores.map((store) => [store.key, store.place])).toEqual([
      ['a3', 'CNPJ 12.345.678/0001-90'],
      ['a2', 'sem endereço'],
      ['a1', 'Av. Brasil, 100'],
    ]);
  });

  it('os números seguem o mercado, não o valor do mês: a mesma unidade não troca de número quando gasta mais', () => {
    const places = (month: string, zCents: number, aCents: number) =>
      Object.fromEntries(
        marketMonth(
          [
            receipt(at(month, 3), [line('Arroz', 'graos', zCents)], { storeId: 'z9' }),
            receipt(at(month, 4), [line('Arroz', 'graos', aCents)], { storeId: 'b1' }),
            receipt(at(month, 5), [line('Arroz', 'graos', 5)], { storeId: 'm5', storeAddress: 'Rua X, 1' }),
          ],
          month,
          AFTER,
        ).stores.map((store) => [store.key, store.place]),
      );
    const october = places(MONTH, 50, 10);
    const september = places('2026-09', 10, 50);
    expect(october).toEqual({ b1: 'loja 1', z9: 'loja 2', m5: 'Rua X, 1' });
    expect(september).toEqual(october);
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
    // No Resumo, "aqui" seria o próprio Resumo: a frase diz o nome da tela.
    expect(marketVsSummary(MONTH, '2026-10-13', 'resumo')).toBe(
      'Diferente da barra “Mercado”: no Mercado do mês só contam notas fiscais, com limpeza, higiene, papel, bebê, pet e os itens de “Outros”, sem remédio e sem nota com data depois de hoje.',
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
    // O botão de cada mês: abrir; o último, o mês da tela, diz que está aberto (na web, o "selecionado" não chega).
    expect(trend.bars.map((bar) => bar.accessibilityLabel).slice(-2)).toEqual(['Setembro: R$ 30,00. Abrir este mês', 'Outubro até hoje: R$ 40,00. Mês aberto']);
    const past = marketTrend([receipt(at('2026-09', 5), [line('Arroz', 'graos', 30)])], '2026-09', '2026-10-13');
    expect(past.bars.at(-1)!.accessibilityLabel).toBe('Setembro: R$ 30,00. Mês aberto');
    const crossing = marketTrend([], '2027-02', '2027-02-10');
    expect(crossing.bars.map((bar) => bar.spoken).slice(3, 5)).toEqual(['Dezembro de 2026: sem ida ao mercado', 'Janeiro de 2027: sem ida ao mercado']);
  });
});
