import { describe, expect, it } from '@jest/globals';

import {
  CHOSEN_STORE_MS,
  cartSplitLine,
  currentStoreChoice,
  describeEstimate,
  describePantryHits,
  estimateHeadline,
  estimateList,
  formatItemCost,
  itemFacts,
  listStorePrices,
  pantryHits,
  storeOptionNote,
  storePriceNote,
  unpricedNote,
  type EstimateItem,
  type EstimatePrice,
  type ItemEstimate,
  type PantryStock,
  uncheckedPricesNote,
} from '../listEstimate';
import { LinkIndex, listNameKey } from '../listLinks';
import { formatBRL } from '../money';
import { storePriceIndex } from '../priceLevel';
import type { PurchaseRecord } from '../recentPurchases';
import { recommendStores } from '../recommendation';
import { ranOutItems, restockSuggestions } from '../restock';

const item = (id: string, name: string, productId: string | null, quantity = 1, unit = 'un', inCart = false): EstimateItem => ({
  id,
  name,
  productId,
  quantity,
  unit,
  inCart,
});

const price = (productId: string, storeId: string, unitPrice: number, purchasedAt = '2026-10-01T12:00:00Z', unit = 'un'): EstimatePrice => ({
  productId,
  storeId,
  unitPrice,
  unit,
  purchasedAt,
});

describe('estimateList', () => {
  const prices = [
    price('arroz', 'bom', 20, '2026-09-01T12:00:00Z'),
    price('arroz', 'caro', 24, '2026-10-05T12:00:00Z'),
    price('feijao', 'bom', 8, '2026-10-03T12:00:00Z'),
    price('feijao', 'caro', 9.6, '2026-09-10T12:00:00Z'),
    price('cafe', 'bom', 15, '2026-10-03T12:00:00Z'),
  ];

  it('sem mercado, vale o último preço que a casa pagou em cada item', () => {
    const estimate = estimateList([item('a', 'Arroz', 'arroz', 2), item('f', 'Feijão', 'feijao'), item('c', 'Café', 'cafe', 1, 'un', true)], prices);
    // Arroz: último no caro (24) x 2; feijão: último no bom (8); café no carrinho (15).
    const arroz = estimate.byItem.get('a')!;
    expect(arroz).toMatchObject({ cost: 48, unitPrice: 24, kind: 'known', approximateQuantity: false, productId: 'arroz' });
    expect(arroz.last).toEqual(price('arroz', 'caro', 24, '2026-10-05T12:00:00Z'));
    expect(arroz.used).toEqual(arroz.last);
    expect(arroz.lowest).toEqual(price('arroz', 'bom', 20, '2026-09-01T12:00:00Z'));
    expect(estimate).toMatchObject({ total: 71, pendingTotal: 56, cartTotal: 15, itemCount: 3, pricedCount: 3, estimatedCount: 0, approximateCount: 0 });
  });

  it('com o mercado escolhido, vale o preço de lá; o que ele não tem é estimado pelo nível de preço dele', () => {
    const list = [item('a', 'Arroz', 'arroz', 2), item('f', 'Feijão', 'feijao'), item('c', 'Café', 'cafe')];
    const noBom = estimateList(list, prices, { storeId: 'bom' });
    expect(noBom).toMatchObject({ total: 63, pricedCount: 3, estimatedCount: 0 });

    const noCaro = estimateList(list, prices, { storeId: 'caro' });
    expect(noCaro.byItem.get('a')).toMatchObject({ cost: 48, kind: 'known' });
    expect(noCaro.byItem.get('f')).toMatchObject({ cost: 9.6, kind: 'known' });
    // Café só tem preço no bom (15). O caro sai 1,0909x a média nos dois produtos em comum (arroz 24/22,
    // feijão 9,6/8,8); com só dois, o nível fica a meio caminho da média: (2 x 1,0909 + 2) / 4.
    const cafe = noCaro.byItem.get('c')!;
    expect(cafe).toMatchObject({ kind: 'estimated', used: null });
    expect(cafe.cost).toBeCloseTo(15 * ((2 * (24 / 22) + 2) / 4), 2);
    expect(noCaro.estimatedCount).toBe(1);
  });

  it('item sem produto usa a ligação aprendida nas notas ou o produto de mesmo nome', () => {
    const links = new LinkIndex([{ name_key: 'refrigerante', product_id: 'coca' }]);
    const estimate = estimateList(
      [item('r', 'Refrigerante', null, 2), item('p', 'pão francês', null), item('x', 'Carregador', null)],
      [price('coca', 'bom', 9), price('pao', 'bom', 12, undefined, 'kg')],
      { links, products: [{ id: 'pao', name: 'Pão francês' }] },
    );
    expect(estimate.byItem.get('r')).toMatchObject({ cost: 18, kind: 'known', productId: 'coca' });
    // Pão: a lista pede 1 un, o preço é por kg: 1 kg, quantidade aproximada.
    expect(estimate.byItem.get('p')).toMatchObject({ cost: 12, unit: 'kg', approximateQuantity: true });
    // Sem preço nenhum: fora dos totais.
    expect(estimate.byItem.has('x')).toBe(false);
    expect(estimate).toMatchObject({ total: 30, itemCount: 3, pricedCount: 2, approximateCount: 1 });
  });

  it('item cujo produto não tem preço cai nas ligações do nome', () => {
    const links = new LinkIndex([{ name_key: 'leite', product_id: 'italac' }]);
    const estimate = estimateList([item('l', 'Leite', 'leite-generico', 2)], [price('italac', 'bom', 5)], { links });
    expect(estimate.byItem.get('l')).toMatchObject({ cost: 10, productId: 'italac' });
  });

  it('nome ligado a produtos em unidades diferentes: o produto é o comprado mais recentemente, e só depois vem a unidade', () => {
    const links = new LinkIndex([
      { name_key: 'carne', product_id: 'bandeja' },
      { name_key: 'carne', product_id: 'patinho' },
    ]);
    // A lista pede em "un"; a bandeja (un) é compra antiga, o patinho (kg) é o que a casa compra agora.
    const estimate = estimateList(
      [item('c', 'Carne', null, 2, 'un')],
      [price('bandeja', 'bom', 25, '2026-06-01T12:00:00Z', 'un'), price('patinho', 'bom', 42, '2026-10-01T12:00:00Z', 'kg')],
      { links },
    );
    expect(estimate.byItem.get('c')).toMatchObject({ productId: 'patinho', unit: 'kg', unitPrice: 42, approximateQuantity: true });
    expect(estimate.byItem.get('c')?.last).toMatchObject({ productId: 'patinho' });
  });

  it('carrinho e o que falta: a linha segue os itens, e o lado sem preço diz que não tem', () => {
    const prices = [price('arroz', 'bom', 20), price('feijao', 'bom', 8)];
    const line = (items: EstimateItem[]) => cartSplitLine(estimateList(items, prices));
    expect(line([item('a', 'Arroz', 'arroz', 1, 'un', true), item('f', 'Feijão', 'feijao')])).toBe('No carrinho: ~R$ 20,00. Falta comprar: ~R$ 8,00.');
    // O que falta não tem preço: o total de cima é só do carrinho, e a linha diz isso.
    expect(line([item('a', 'Arroz', 'arroz', 1, 'un', true), item('x', 'Vela', null)])).toBe(
      'No carrinho: ~R$ 20,00. O que falta comprar ainda não tem preço.',
    );
    expect(line([item('x', 'Vela', null, 1, 'un', true), item('f', 'Feijão', 'feijao')])).toBe(
      'Falta comprar: ~R$ 8,00. O que está no carrinho ainda não tem preço.',
    );
    // Tudo de um lado só, ou nada com preço: sem linha.
    expect(line([item('a', 'Arroz', 'arroz'), item('f', 'Feijão', 'feijao')])).toBeNull();
    expect(line([item('x', 'Vela', null, 1, 'un', true), item('y', 'Fósforo', null)])).toBeNull();
  });

  it('nome ligado a mais de um produto: vale o comprado mais recentemente, e o preço bom é só desse produto', () => {
    const links = new LinkIndex([
      { name_key: 'leite', product_id: 'italac' },
      { name_key: 'leite', product_id: 'piracanjuba' },
    ]);
    const estimate = estimateList(
      [item('l', 'Leite', null, 6)],
      [
        price('italac', 'bom', 3.9, '2026-09-01T12:00:00Z'),
        price('piracanjuba', 'caro', 4.9, '2026-10-01T12:00:00Z'),
        price('piracanjuba', 'bom', 4.5, '2026-08-01T12:00:00Z'),
      ],
      { links },
    );
    expect(estimate.byItem.get('l')).toMatchObject({ cost: 29.4, unitPrice: 4.9, productId: 'piracanjuba' });
    // O menor é o do próprio Piracanjuba (4,50), não o do Italac (3,90): outro produto, outra embalagem.
    expect(estimate.byItem.get('l')?.lowest).toMatchObject({ unitPrice: 4.5, storeId: 'bom', productId: 'piracanjuba' });
  });

  it('mercado escolhido: prefere o mesmo produto lá; outro produto do mesmo nome entra como aproximado', () => {
    const links = new LinkIndex([
      { name_key: 'refrigerante', product_id: 'coca2l' },
      { name_key: 'refrigerante', product_id: 'lata' },
    ]);
    const list = [item('r', 'Refrigerante', null, 2)];
    const quotes = [
      price('coca2l', 'assai', 9.99, '2026-10-05T12:00:00Z'),
      price('coca2l', 'extra', 8.99, '2026-08-01T12:00:00Z'),
      price('lata', 'extra', 2.49, '2026-10-06T12:00:00Z'),
      price('lata', 'dia', 2.99, '2026-09-01T12:00:00Z'),
    ];
    // A lata foi a comprada por último: é dela o preço do item, e o menor preço também.
    const semMercado = estimateList(list, quotes, { links }).byItem.get('r')!;
    expect(semMercado).toMatchObject({ productId: 'lata', unitPrice: 2.49 });
    expect(semMercado.lowest).toMatchObject({ unitPrice: 2.49, storeId: 'extra' });

    // No Assaí só há a garrafa de 2 L: o preço é dela, marcado como aproximado.
    const noAssai = estimateList(list, quotes, { links, storeId: 'assai' }).byItem.get('r')!;
    expect(noAssai).toMatchObject({ cost: 19.98, kind: 'known', productId: 'lata' });
    expect(noAssai.used).toMatchObject({ productId: 'coca2l', storeId: 'assai', unitPrice: 9.99 });
    expect(formatItemCost(noAssai)).toBe('~R$ 19,98');

    // No Extra há a lata: preço exato do mesmo produto.
    const noExtra = estimateList(list, quotes, { links, storeId: 'extra' }).byItem.get('r')!;
    expect(noExtra.used).toMatchObject({ productId: 'lata', unitPrice: 2.49 });
    expect(formatItemCost(noExtra)).toBe('R$ 4,98');
  });

  it('converte g para kg e ml para l: quantidade exata', () => {
    const estimate = estimateList(
      [item('p', 'Presunto', 'presunto', 200, 'g'), item('s', 'Suco', 'suco', 500, 'ml'), item('q', 'Queijo', 'queijo', 0.3, 'kg')],
      [price('presunto', 'bom', 59.9, undefined, 'kg'), price('suco', 'bom', 12, undefined, 'l'), price('queijo', 'bom', 0.0499, undefined, 'g')],
    );
    expect(estimate.byItem.get('p')).toMatchObject({ cost: 11.98, unit: 'kg', approximateQuantity: false });
    expect(estimate.byItem.get('s')).toMatchObject({ cost: 6, unit: 'l', approximateQuantity: false });
    // O preço por g entra na conta já por kg (R$ 0,0499/g são R$ 49,90/kg): o custo é o mesmo.
    expect(estimate.byItem.get('q')).toMatchObject({ cost: 14.97, unit: 'kg', unitPrice: 49.9, approximateQuantity: false });
    expect(estimate).toMatchObject({ total: 32.95, approximateCount: 0 });
    expect(formatItemCost(estimate.byItem.get('p')!)).toBe('R$ 11,98');
  });

  it('unidade que não converte (un x kg, l, ml): 1 unidade do preço, qualquer que seja a quantidade', () => {
    const estimate = estimateList(
      [item('l', 'Leite integral', 'leite', 6, 'l'), item('b', 'Banana', 'banana', 3), item('s', 'Suco', 'suco', 500, 'ml')],
      [price('leite', 'bom', 5.49), price('banana', 'bom', 6, undefined, 'kg'), price('suco', 'bom', 7)],
    );
    expect(estimate.byItem.get('l')).toMatchObject({ cost: 5.49, approximateQuantity: true });
    expect(estimate.byItem.get('b')).toMatchObject({ cost: 6, unit: 'kg', approximateQuantity: true });
    // 500 ml nunca viram 500 x o preço da unidade.
    expect(estimate.byItem.get('s')).toMatchObject({ cost: 7, approximateQuantity: true });
    expect(estimate).toMatchObject({ total: 18.49, pricedCount: 3, approximateCount: 3 });
  });

  it('o mesmo produto por kg num mercado e por g em outro (ou por litro e por ml): o último preço, o menor e a média olham os dois', () => {
    const quotes = [
      price('queijo', 'a', 49.9, '2026-08-05T12:00:00Z', 'kg'),
      price('queijo', 'b', 0.0299, '2026-10-01T12:00:00Z', 'g'),
      price('suco', 'a', 12, '2026-08-05T12:00:00Z', 'l'),
      price('suco', 'b', 0.008, '2026-10-01T12:00:00Z', 'ml'),
    ];
    const list = [item('q', 'Queijo', 'queijo', 1, 'kg'), item('s', 'Suco', 'suco', 1, 'l')];
    const estimate = estimateList(list, quotes);
    // O último preço do queijo é o de outubro, por g: R$ 29,90 por kg. O de agosto, por kg, ficou para trás.
    const queijo = estimate.byItem.get('q')!;
    expect(queijo).toMatchObject({ cost: 29.9, unitPrice: 29.9, unit: 'kg', approximateQuantity: false });
    expect(queijo.last).toEqual({ ...quotes[1], unit: 'kg', unitPrice: 29.9 });
    expect(queijo.lowest).toEqual(queijo.last);
    expect(estimate.byItem.get('s')).toMatchObject({ cost: 8, unitPrice: 8, unit: 'l' });
    expect(estimate.total).toBe(37.9);
    // Mercado sem o item: a média dos dois (R$ 39,90/kg e R$ 10,00/l), não só a do preço por kg.
    const elsewhere = estimateList(list, quotes, { storeId: 'c' });
    expect(elsewhere.byItem.get('q')).toMatchObject({ kind: 'estimated', cost: 39.9, unitPrice: 39.9, unit: 'kg' });
    expect(elsewhere.byItem.get('s')).toMatchObject({ kind: 'estimated', cost: 10, unit: 'l' });
    // O preço por g mais novo e mais caro: é o último, e o por kg de antes é o menor (a referência de promoção).
    const dearer = estimateList(list, [quotes[0], price('queijo', 'b', 0.0599, '2026-10-01T12:00:00Z', 'g')]).byItem.get('q')!;
    expect(dearer.last).toMatchObject({ storeId: 'b', unit: 'kg', unitPrice: 59.9 });
    expect(dearer.lowest).toEqual(quotes[0]);
    // Peso não vira volume, nem "un": continuam contas separadas.
    const apart = estimateList(
      [item('x', 'Azeite', 'azeite', 1, 'l')],
      [
        price('azeite', 'a', 40, '2026-10-01T12:00:00Z', 'l'),
        price('azeite', 'b', 0.03, '2026-10-05T12:00:00Z', 'g'),
        price('azeite', 'c', 25, '2026-10-06T12:00:00Z', 'un'),
      ],
    ).byItem.get('x')!;
    expect(apart).toMatchObject({ cost: 40, unit: 'l' });
    expect(apart.lowest).toMatchObject({ storeId: 'a', unitPrice: 40 });
  });

  it('o mesmo preço escrito por kg e por g é o mesmo preço: não aparece como "menor"', () => {
    // 0,0049 x 1000 dá 4,8999999999999995 na conta do computador; ao entrar na regra, o preço volta às 4 casas da nota.
    const quotes = [price('arroz', 'a', 4.9, '2026-10-01T12:00:00Z', 'kg'), price('arroz', 'b', 0.0049, '2026-09-01T12:00:00Z', 'g')];
    const arroz = estimateList([item('a', 'Arroz', 'arroz', 2, 'kg')], quotes).byItem.get('a')!;
    expect(arroz.lowest).toEqual(quotes[0]);
    expect(arroz.cost).toBe(9.8);
  });

  it('um mercado com o produto por kg e por g: vale o preço mais novo de lá, e o antigo não vira "menor preço" nem entra na média', () => {
    const quotes = [
      price('queijo', 'a', 40, '2026-10-01T12:00:00Z', 'kg'),
      // Uma nota antiga do mesmo mercado saiu por g (R$ 20,00/kg): o último preço de lá é o de outubro.
      price('queijo', 'a', 0.02, '2026-06-01T12:00:00Z', 'g'),
      price('queijo', 'b', 44, '2026-09-01T12:00:00Z', 'kg'),
    ];
    const list = [item('q', 'Queijo', 'queijo', 1, 'kg')];
    for (const order of [quotes, [...quotes].reverse()]) {
      const queijo = estimateList(list, order).byItem.get('q')!;
      expect(queijo.last).toEqual(quotes[0]);
      expect(queijo.lowest).toEqual(quotes[0]);
      expect(estimateList(list, order, { storeId: 'a' }).byItem.get('q')).toMatchObject({ cost: 40, kind: 'known' });
      // Num mercado sem o item, a média é de um preço por mercado: (40 + 44) / 2.
      expect(estimateList(list, order, { storeId: 'c' }).byItem.get('q')).toMatchObject({ cost: 42, kind: 'estimated' });
    }
  });

  it('item em "un" com preço por g ou por ml: a conta é de 1 kg ou 1 litro, nunca de 1 g', () => {
    const estimate = estimateList(
      [item('q', 'Queijo mussarela', 'queijo', 3), item('s', 'Suco', 'suco')],
      [price('queijo', 'bom', 0.0599, undefined, 'g'), price('suco', 'bom', 0.012, undefined, 'ml')],
    );
    expect(estimate.byItem.get('q')).toMatchObject({ cost: 59.9, unit: 'kg', unitPrice: 59.9, approximateQuantity: true });
    expect(estimate.byItem.get('s')).toMatchObject({ cost: 12, unit: 'l', approximateQuantity: true });
    expect(formatItemCost(estimate.byItem.get('q')!)).toBe('~R$ 59,90');
    expect(estimate).toMatchObject({ total: 71.9, approximateCount: 2 });
  });

  it('dois produtos ligados ao mesmo nome, comprados na mesma nota: a ordem das ligações e dos preços não muda a conta', () => {
    const at = '2026-10-05T18:30:00Z';
    const quotes = [price('ninho', 'a', 32.9, at), price('italac', 'a', 5.49, at)];
    const rows = [
      { name_key: 'leite', product_id: 'ninho' },
      { name_key: 'leite', product_id: 'italac' },
    ];
    const list = [item('l', 'Leite', null)];
    const seen = new Set<string>();
    for (const links of [rows, [...rows].reverse()]) {
      for (const prices of [quotes, [...quotes].reverse()]) {
        const estimate = estimateList(list, prices, { links: new LinkIndex(links) });
        seen.add(`${estimate.byItem.get('l')!.productId} ${estimate.total}`);
      }
    }
    // No empate, o de menor id: sempre o mesmo produto e o mesmo total.
    expect([...seen]).toEqual(['italac 5.49']);
    // O mesmo produto em dois mercados no mesmo instante: o último preço também não depende da ordem.
    const two = [price('italac', 'b', 6.1, at), price('italac', 'a', 5.49, at)];
    const totals = [two, [...two].reverse()].map((prices) => estimateList([item('i', 'Leite Italac', 'italac')], prices).total);
    expect(totals).toEqual([5.49, 5.49]);
  });

  it('o preço estimado de 1 unidade, escrito em reais, é o custo do item: não um centavo a mais', () => {
    // R$ 31,49 num mercado e R$ 9,57 no outro: num terceiro, cerca de R$ 20,53 (a média). E outros pares, em que
    // a média cai perto do meio centavo: arredondada duas vezes (4 casas, depois centavos), passava do custo.
    for (let a = 1000; a < 1400; a += 7) {
      for (let b = 2001; b < 2040; b += 2) {
        const quotes = [price('p', 'a', a / 100), price('p', 'b', b / 100), price('q', 'a', 3.33), price('q', 'b', 3.37), price('q', 'c', 3.41)];
        const one = estimateList([item('i', 'Produto', 'p')], quotes, { storeId: 'c' }).byItem.get('i')!;
        expect(one.kind).toBe('estimated');
        expect(formatBRL(one.unitPrice)).toBe(formatBRL(one.cost));
      }
    }
  });

  it('o preço estimado guarda as 4 casas da nota, não só os centavos', () => {
    // Média de R$ 4,999 e R$ 4,50: R$ 4,7495 por kg (o custo, esse sim, é em centavos).
    const quotes = [price('arroz', 'a', 4.999, undefined, 'kg'), price('arroz', 'b', 4.5, undefined, 'kg')];
    const arroz = estimateList([item('a', 'Arroz', 'arroz', 2, 'kg')], quotes, { storeId: 'c' }).byItem.get('a')!;
    expect(arroz).toMatchObject({ kind: 'estimated', unitPrice: 4.7495, cost: 9.5 });
  });

  it('prefere o preço na unidade da lista', () => {
    const estimate = estimateList(
      [item('b', 'Banana', 'banana', 1.5, 'kg')],
      [price('banana', 'bom', 0.9, '2026-10-05T12:00:00Z', 'un'), price('banana', 'caro', 6, '2026-09-01T12:00:00Z', 'kg')],
    );
    expect(estimate.byItem.get('b')).toMatchObject({ cost: 9, unit: 'kg', approximateQuantity: false });
  });

  it('sem preço na unidade da lista, prefere o que converte para ela ao mais recente em outra unidade', () => {
    const estimate = estimateList(
      [item('p', 'Presunto', 'presunto', 200, 'g')],
      [price('presunto', 'bom', 4.99, '2026-10-05T12:00:00Z', 'un'), price('presunto', 'caro', 59.9, '2026-09-01T12:00:00Z', 'kg')],
    );
    expect(estimate.byItem.get('p')).toMatchObject({ cost: 11.98, unit: 'kg', approximateQuantity: false });
  });

  it('mercado escolhido que só tem o produto em outra unidade: vale o preço de lá, aproximado', () => {
    const quotes = [price('banana', 'a', 0.9, '2024-01-01T12:00:00Z', 'un'), price('banana', 'b', 6, '2026-10-01T12:00:00Z', 'kg')];
    const estimate = estimateList([item('b', 'Banana', 'banana', 6)], quotes, { storeId: 'b' });
    const banana = estimate.byItem.get('b')!;
    expect(banana).toMatchObject({ cost: 6, unitPrice: 6, unit: 'kg', kind: 'known', approximateQuantity: true });
    expect(banana.used).toEqual(quotes[1]);
    // O último preço continua sendo o da unidade da lista.
    expect(banana.last).toEqual(quotes[0]);
    expect(estimate).toMatchObject({ estimatedCount: 0, approximateCount: 1 });
    expect(estimate.stores).toEqual([
      { storeId: 'a', knownCount: 1 },
      { storeId: 'b', knownCount: 1 },
    ]);
  });

  it('preço zerado (brinde na nota) não é preço', () => {
    const estimate = estimateList(
      [item('b', 'Brinde', 'brinde'), item('a', 'Arroz', 'arroz')],
      [price('brinde', 'bom', 0), price('arroz', 'bom', 0, '2026-10-05T12:00:00Z'), price('arroz', 'caro', 24, '2026-09-01T12:00:00Z')],
    );
    expect(estimate.byItem.has('b')).toBe(false);
    expect(estimate.byItem.get('a')).toMatchObject({ cost: 24 });
    expect(estimate.byItem.get('a')?.lowest).toMatchObject({ unitPrice: 24, storeId: 'caro' });
    expect(estimate.stores).toEqual([{ storeId: 'caro', knownCount: 1 }]);
  });

  it('mercado que a casa nunca comprou: estimado na média, sem nível próprio', () => {
    const estimate = estimateList([item('a', 'Arroz', 'arroz')], prices, { storeId: 'novo' });
    expect(estimate.byItem.get('a')).toMatchObject({ cost: 22, kind: 'estimated' });
  });

  it('lista os mercados pelo número de itens da lista com preço de nota', () => {
    const estimate = estimateList([item('a', 'Arroz', 'arroz'), item('c', 'Café', 'cafe'), item('x', 'Sem preço', null)], prices);
    expect(estimate.stores).toEqual([
      { storeId: 'bom', knownCount: 2 },
      { storeId: 'caro', knownCount: 1 },
    ]);
  });

  it('mercado das notas sem preço para nenhum item da lista também pode ser escolhido: a conta dele sai estimada', () => {
    // Café só tem preço no bom; o caro entra com zero.
    const list = [item('c', 'Café', 'cafe')];
    expect(estimateList(list, prices).stores).toEqual([
      { storeId: 'bom', knownCount: 1 },
      { storeId: 'caro', knownCount: 0 },
    ]);
    expect(estimateList(list, prices, { storeId: 'caro' })).toMatchObject({ pricedCount: 1, estimatedCount: 1 });
    expect([storeOptionNote(0), storeOptionNote(1), storeOptionNote(3)]).toEqual([
      'Nenhum item da lista com preço lá: a conta sai estimada',
      '1 item da lista com preço',
      '3 itens da lista com preço',
    ]);
    // Sem nenhum item com preço não há o que estimar em mercado nenhum.
    expect(estimateList([item('x', 'Sem preço', null)], prices).stores).toEqual([]);
  });

  it('lista vazia ou sem preços dá zero', () => {
    expect(estimateList([], prices)).toMatchObject({ total: 0, itemCount: 0, pricedCount: 0, stores: [] });
    expect(estimateList([item('a', 'Arroz', 'arroz')], [])).toMatchObject({ total: 0, itemCount: 1, pricedCount: 0 });
  });
});

describe('o produto de cada item', () => {
  it('um produto por item: o do item, o das ligações ou o de mesmo nome; sem preço, nenhum', () => {
    const links = new LinkIndex([
      { name_key: 'refrigerante', product_id: 'coca' },
      { name_key: 'leite', product_id: 'italac' },
    ]);
    const estimate = estimateList(
      [
        item('a', 'Arroz', 'arroz'),
        item('r', 'Refrigerante', null),
        item('l', 'Leite', 'leite-generico'),
        item('p', 'pão francês', null),
        item('x', 'Carregador', null),
        item('y', 'Sabão', 'sabao'),
      ],
      [price('arroz', 'bom', 20), price('coca', 'bom', 9), price('italac', 'bom', 5), price('pao', 'bom', 12, undefined, 'kg')],
      { links, products: [{ id: 'pao', name: 'Pão francês' }] },
    );
    expect([...estimate.byItem].map(([id, cost]) => [id, cost.productId])).toEqual([
      ['a', 'arroz'],
      ['r', 'coca'],
      ['l', 'italac'],
      ['p', 'pao'],
    ]);
  });
});

describe('dois produtos com o mesmo nome, a não ser pelo acento', () => {
  const products = [
    { id: 'p1', name: 'Açúcar' },
    { id: 'p2', name: 'Acucar' },
    { id: 'p3', name: 'Açucar' },
  ];
  const list = [item('a', 'açúcar', null, 2)];
  /** Todas as ordens em que os produtos (ou os preços) podem chegar. */
  const orders = <T,>(values: T[]): T[][] =>
    values.length < 2 ? [values] : values.flatMap((value, i) => orders([...values.slice(0, i), ...values.slice(i + 1)]).map((rest) => [value, ...rest]));
  /** O produto e o custo do item em cada ordem: um só resultado quando a ordem não decide. */
  const chosen = (quotes: EstimatePrice[]) =>
    new Set(
      orders(products).flatMap((productOrder) =>
        orders(quotes).map((quoteOrder) => {
          const cost = estimateList(list, quoteOrder, { products: productOrder }).byItem.get('a');
          return cost ? `${cost.productId} ${cost.cost}` : 'sem preço';
        }),
      ),
    );

  it('só um deles tem preço: é dele o preço do item, chegue em que ordem chegar', () => {
    expect(chosen([price('p1', 'bom', 5)])).toEqual(new Set(['p1 10']));
    expect(chosen([price('p3', 'bom', 6)])).toEqual(new Set(['p3 12']));
  });

  it('mais de um com preço: vale o de preço mais recente; no empate de data, o de menor id', () => {
    expect(
      chosen([
        price('p1', 'bom', 5, '2026-09-01T12:00:00Z'),
        price('p2', 'caro', 6, '2026-10-01T12:00:00Z'),
        price('p3', 'bom', 7, '2026-08-01T12:00:00Z'),
      ]),
    ).toEqual(new Set(['p2 12']));
    expect(chosen([price('p3', 'bom', 7), price('p2', 'bom', 6)])).toEqual(new Set(['p2 12']));
  });

  it('nenhum com preço: o item fica sem preço, em qualquer ordem', () => {
    expect(chosen([price('outro', 'bom', 5)])).toEqual(new Set(['sem preço']));
  });
});

describe('listStorePrices', () => {
  const links = new LinkIndex([
    { name_key: 'leite', product_id: 'italac' },
    { name_key: 'leite', product_id: 'piracanjuba' },
  ]);
  const list = [item('l', 'Leite', null, 12), item('b', 'Banana', 'banana', 6), item('c', 'Café', 'cafe'), item('x', 'Carregador', null)];
  const quotes = [
    price('italac', 'assai', 4.59, '2026-10-05T12:00:00Z'),
    price('piracanjuba', 'dia', 5.29, '2026-09-20T12:00:00Z'),
    price('banana', 'assai', 0.9, '2026-10-01T12:00:00Z'),
    price('banana', 'dia', 6, '2026-10-02T12:00:00Z', 'kg'),
    price('cafe', 'assai', 18),
  ];
  const priceAt = listStorePrices(list, quotes, { links });

  it('diz o preço do item em cada mercado e de onde ele vem', () => {
    // O produto do item, na unidade de sempre.
    expect(priceAt('l', 'assai')).toMatchObject({ source: 'product', kind: 'known', cost: 55.08, unitPrice: 4.59, productId: 'italac' });
    expect(priceAt('l', 'assai')?.used).toEqual(quotes[0]);
    // Outro produto ligado ao mesmo nome: o Dia só tem o Piracanjuba.
    expect(priceAt('l', 'dia')).toMatchObject({ source: 'otherProduct', kind: 'known', cost: 63.48, productId: 'italac' });
    expect(priceAt('l', 'dia')?.used).toEqual(quotes[1]);
    // O produto do item em outra unidade: 6 un com preço por kg conta 1 kg.
    expect(priceAt('b', 'dia')).toMatchObject({ source: 'otherUnit', kind: 'known', cost: 6, unit: 'kg', approximateQuantity: true });
    expect(priceAt('b', 'assai')).toMatchObject({ source: 'product', cost: 5.4, unit: 'un', approximateQuantity: false });
    // O mercado não tem o item: a média do produto, no nível de preço de lá.
    expect(priceAt('c', 'dia')).toMatchObject({ source: 'estimated', kind: 'estimated', used: null, unit: 'un' });
    expect(priceAt('c', 'novo')).toMatchObject({ source: 'estimated', cost: 18 });
  });

  it('a nota de cada preço, para a linha do item em "Onde comprar": sai da mesma resposta que o custo', () => {
    const productName = (id: string) => (id === 'piracanjuba' ? 'Leite Piracanjuba 1L' : undefined);
    // Preço de nota do próprio produto, na quantidade da lista: sem nota (a linha mostra a quantidade) e sem "~".
    expect(storePriceNote(priceAt('l', 'assai')!, productName)).toBeNull();
    expect(formatItemCost(priceAt('l', 'assai')!)).toBe('R$ 55,08');
    // De outro produto ligado ao nome: diz qual, quando sabe o nome dele.
    expect(storePriceNote(priceAt('l', 'dia')!, productName)).toBe('Preço de Leite Piracanjuba 1L');
    expect(storePriceNote(priceAt('l', 'dia')!)).toBe('Preço de outro produto com esse nome');
    expect(formatItemCost(priceAt('l', 'dia')!)).toBe('~R$ 63,48');
    // A unidade da lista não converte para a do preço.
    expect(storePriceNote(priceAt('b', 'dia')!, productName)).toBe('Preço por unidade da nota (quantidade em outra unidade)');
    expect(formatItemCost(priceAt('b', 'dia')!)).toBe('~R$ 6,00');
    // O mercado não tem o item.
    expect(storePriceNote(priceAt('c', 'dia')!, productName)).toBe('Estimado pelo nível de preço do mercado');
    expect(formatItemCost(priceAt('c', 'novo')!)).toBe('~R$ 18,00');
  });

  it('item sem preço nenhum (ou que não é da lista) não tem resposta', () => {
    expect(priceAt('x', 'assai')).toBeNull();
    expect(priceAt('nao-existe', 'assai')).toBeNull();
  });

  it('o item sem preço diz por quê; sem as ligações ou os produtos carregados, que não deu para conferir', () => {
    expect(unpricedNote({ productId: 'sabao' }, true)).toBe('Ainda não aparece em nenhuma nota');
    expect(unpricedNote({ productId: null }, true)).toBe('Item digitado livre: ainda não ligado a um produto com preço');
    // Sem as ligações, "ainda não ligado" seria um palpite: o item pode ter produto e preço nas notas.
    const semLigacoes = listStorePrices(list, quotes);
    expect(semLigacoes('l', 'assai')).toBeNull();
    expect(unpricedNote({ productId: null }, false)).toBe('Não deu para conferir se este item já tem preço');
    expect(unpricedNote({ productId: 'leite-generico' }, false)).toBe('Não deu para conferir se este item já tem preço');
  });

  it('é a resposta que a estimativa usa com o mercado escolhido', () => {
    for (const storeId of ['assai', 'dia', 'novo']) {
      const estimate = estimateList(list, quotes, { links, storeId });
      for (const { id } of list) {
        const answer = priceAt(id, storeId);
        const cost = estimate.byItem.get(id);
        expect(Boolean(answer)).toBe(Boolean(cost));
        if (answer && cost) expect({ ...answer, last: cost.last, lowest: cost.lowest }).toEqual({ ...cost, source: answer.source });
      }
    }
  });
});

describe('a lista e "Onde comprar" dão o mesmo total', () => {
  type Sources = { links?: LinkIndex; products?: { id: string; name: string }[] };

  /** A conta como a tela "Onde comprar" a chama (onde-comprar.tsx): só o que falta comprar, com a resposta de listStorePrices. */
  const whereToBuy = (list: EstimateItem[], quotes: EstimatePrice[], sources: Sources, maxStores = 1) => {
    const pending = list.filter((i) => !i.inCart);
    return recommendStores(
      pending.map((i) => ({ key: i.id, productId: i.productId, quantity: i.quantity, unit: i.unit })),
      quotes,
      maxStores,
      { storeIndex: storePriceIndex(quotes), priceAt: listStorePrices(pending, quotes, sources) },
    );
  };

  /** Em cada mercado, o plano de um mercado só bate com a estimativa da lista com ele escolhido: total, itens e avisos. */
  function expectSameAccount(list: EstimateItem[], quotes: EstimatePrice[], sources: Sources, storeIds: string[]) {
    const pending = list.filter((i) => !i.inCart);
    const recommendation = whereToBuy(list, quotes, sources);
    const ranked = new Set(
      estimateList(pending, quotes, sources)
        .stores.filter((s) => s.knownCount > 0)
        .map((s) => s.storeId),
    );
    const estimates = new Map(storeIds.map((storeId) => [storeId, estimateList(list, quotes, { ...sources, storeId })]));
    for (const [storeId, estimate] of estimates) {
      const plan = recommendation.plans.find((p) => p.storeIds[0] === storeId);
      // Entram no ranking os mercados com preço de nota para algum item. A lista oferece esses para escolher e também
      // os que não têm nenhum (quem está lá vê a conta estimada), mas recomendar um deles seria palpite.
      expect(Boolean(plan)).toBe(ranked.has(storeId));
      if (!plan) continue;
      expect(plan.total).toBe(estimate.pendingTotal);
      expect(plan.assignments.map((a) => [a.itemKey, a.cost, a.kind, a.approximateQuantity])).toEqual(
        pending.flatMap((i) => {
          const cost = estimate.byItem.get(i.id);
          return cost ? [[i.id, cost.cost, cost.kind, cost.approximateQuantity]] : [];
        }),
      );
    }
    expect(recommendation.unpricedKeys).toEqual(pending.filter((i) => !estimates.get(storeIds[0])!.byItem.has(i.id)).map((i) => i.id));

    // Dividindo entre dois mercados, cada item sai pelo preço da estimativa no mercado em que ficou: o menor dos dois.
    for (const plan of whereToBuy(list, quotes, sources, 2).plans) {
      for (const a of plan.assignments) {
        const costs = plan.storeIds.map((storeId) => estimates.get(storeId)!.byItem.get(a.itemKey)!.cost);
        expect(a.cost).toBe(Math.min(...costs));
        expect(a.cost).toBe(estimates.get(a.storeId)!.byItem.get(a.itemKey)!.cost);
      }
    }
    return { recommendation, estimates };
  }

  it('para a mesma lista e o mesmo mercado', () => {
    const links = new LinkIndex([{ name_key: 'refrigerante', product_id: 'coca' }]);
    const products = [{ id: 'pao', name: 'Pão francês' }];
    const list = [
      item('a', 'Arroz', 'arroz', 2),
      item('r', 'Refrigerante', null, 2),
      item('c', 'Café', 'cafe'),
      item('p', 'Presunto', 'presunto', 200, 'g'),
      item('f', 'pão francês', null, 6),
      item('x', 'Carregador', null),
      // No carrinho: "Onde comprar" só conta o que falta comprar.
      item('z', 'Feijão', 'feijao', 1, 'un', true),
    ];
    const quotes = [
      price('arroz', 'assai', 20),
      price('arroz', 'dia', 24),
      price('coca', 'assai', 9),
      price('cafe', 'dia', 18),
      price('presunto', 'assai', 59.9, undefined, 'kg'),
      price('presunto', 'dia', 64.9, undefined, 'kg'),
      price('pao', 'dia', 14, undefined, 'kg'),
      price('feijao', 'assai', 8),
      // Fora da lista: entra no nível de preço dos mercados nas duas telas.
      price('sabao', 'assai', 10),
      price('sabao', 'dia', 20),
    ];
    const pending = list.filter((i) => !i.inCart);
    const { recommendation, estimates } = expectSameAccount(list, quotes, { links, products }, ['assai', 'dia']);
    expect(recommendation.unpricedKeys).toEqual(['x']);
    for (const [storeId, estimate] of estimates) {
      const plan = recommendation.plans.find((p) => p.storeIds[0] === storeId)!;
      expect(plan.estimatedCount).toBe(pending.filter((i) => estimate.byItem.get(i.id)?.kind === 'estimated').length);
    }
    // E não é um total trivial: há item de nota, item estimado e item convertido.
    expect(estimates.get('assai')).toMatchObject({ pricedCount: 6, estimatedCount: 2 });
  });

  it('duas marcas ligadas ao mesmo nome: cada mercado com a que a casa compra lá', () => {
    const links = new LinkIndex([
      { name_key: 'leite', product_id: 'italac' },
      { name_key: 'leite', product_id: 'piracanjuba' },
    ]);
    const list = [item('l', 'Leite', null, 12), item('a', 'Arroz', 'arroz')];
    const quotes = [
      price('italac', 'assai', 4.59, '2026-10-05T12:00:00Z'),
      price('piracanjuba', 'dia', 5.29, '2026-09-20T12:00:00Z'),
      price('arroz', 'assai', 20),
      price('arroz', 'dia', 22),
    ];
    const { recommendation, estimates } = expectSameAccount(list, quotes, { links }, ['assai', 'dia']);
    // No Dia vale o Piracanjuba de lá (12 x 5,29), não o Italac estimado pelo nível de preço.
    expect(estimates.get('dia')!.pendingTotal).toBe(85.48);
    expect(estimates.get('assai')!.pendingTotal).toBe(75.08);
    expect(recommendation.plans.map((p) => [p.storeIds[0], p.total, p.knownCount, p.estimatedCount])).toEqual([
      ['assai', 75.08, 2, 0],
      ['dia', 85.48, 2, 0],
    ]);
  });

  it('refrigerante de 2 L num mercado e lata no outro', () => {
    const links = new LinkIndex([
      { name_key: 'refrigerante', product_id: 'coca2l' },
      { name_key: 'refrigerante', product_id: 'lata' },
    ]);
    const list = [item('r', 'Refrigerante', null, 2), item('a', 'Arroz', 'arroz')];
    const quotes = [
      price('coca2l', 'assai', 9.99, '2026-10-05T12:00:00Z'),
      price('lata', 'dia', 2.99, '2026-09-01T12:00:00Z'),
      price('arroz', 'assai', 20),
      price('arroz', 'dia', 22),
    ];
    const { recommendation } = expectSameAccount(list, quotes, { links }, ['assai', 'dia']);
    expect(recommendation.plans.map((p) => [p.storeIds[0], p.total])).toEqual([
      ['dia', 27.98],
      ['assai', 39.98],
    ]);
  });

  it('o mesmo produto por unidade num mercado e por kg em outro', () => {
    const list = [item('b', 'Banana', 'banana', 6), item('p', 'Presunto', 'presunto', 200, 'g')];
    const quotes = [
      price('banana', 'a', 0.9, '2026-10-01T12:00:00Z'),
      price('banana', 'b', 6, '2026-10-02T12:00:00Z', 'kg'),
      price('banana', 'c', 6.5, '2026-10-03T12:00:00Z', 'kg'),
      price('presunto', 'a', 59.9, '2026-10-01T12:00:00Z', 'kg'),
      price('presunto', 'b', 4.99, '2026-10-02T12:00:00Z'),
      price('presunto', 'c', 5.49, '2026-10-03T12:00:00Z'),
    ];
    const { recommendation } = expectSameAccount(list, quotes, {}, ['a', 'b', 'c']);
    // Os três mercados entram no ranking, cada um com o preço dele: 6 un a 0,90 e 200 g a 59,90/kg no A; 1 kg e 1 un nos outros.
    expect(recommendation.plans.map((p) => [p.storeIds[0], p.total])).toEqual([
      ['b', 10.99],
      ['c', 11.99],
      ['a', 17.38],
    ]);
    expect(recommendation.plans[0].assignments.map((a) => a.approximateQuantity)).toEqual([true, true]);
    expect(recommendation.plans[2].assignments.map((a) => a.approximateQuantity)).toEqual([false, false]);
  });

  it('queijo por kg num mercado e por g no outro, com a lista em "un": 1 kg nos dois, e ganha o mais barato', () => {
    const list = [item('q', 'Queijo mussarela', 'queijo'), item('a', 'Arroz', 'arroz')];
    const quotes = [
      price('queijo', 'a', 49.9, '2026-10-01T12:00:00Z', 'kg'),
      price('queijo', 'b', 0.0599, '2026-09-01T12:00:00Z', 'g'),
      price('arroz', 'a', 20),
      price('arroz', 'b', 20),
    ];
    const { recommendation, estimates } = expectSameAccount(list, quotes, {}, ['a', 'b']);
    // No B o queijo é 1 kg a R$ 59,90, não 1 g a R$ 0,06: o A sai R$ 10,00 mais barato.
    expect(recommendation.plans.map((p) => [p.storeIds[0], p.total])).toEqual([
      ['a', 69.9],
      ['b', 79.9],
    ]);
    expect(estimates.get('b')!.byItem.get('q')).toMatchObject({ cost: 59.9, unit: 'kg', kind: 'known', approximateQuantity: true });
  });

  it('mercado com o mesmo produto por kg e por g: o nível de preço conta o mercado uma vez só', () => {
    const list = [item('q', 'Queijo', 'queijo', 0.5, 'kg'), item('c', 'Café', 'cafe')];
    const quotes = [
      price('queijo', 'a', 40, '2026-10-01T12:00:00Z', 'kg'),
      // Nota antiga do A, por g (R$ 20,00/kg): não é mais o preço de lá.
      price('queijo', 'a', 0.02, '2026-06-01T12:00:00Z', 'g'),
      price('queijo', 'b', 40, '2026-09-20T12:00:00Z', 'kg'),
      price('cafe', 'a', 18),
    ];
    const { recommendation } = expectSameAccount(list, quotes, {}, ['a', 'b']);
    // Os dois cobram R$ 40,00/kg hoje: mesmo nível, e o café que o B não tem sai pela média, R$ 18,00.
    expect(recommendation.plans.map((p) => [p.storeIds[0], p.total, p.estimatedCount])).toEqual([
      ['a', 38, 0],
      ['b', 38, 1],
    ]);
  });

  /** Sorteio com semente (mulberry32): as mesmas listas a cada rodada. */
  const seeded = (seed: number) => {
    let state = seed;
    const random = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), state | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
    const pick = <T,>(values: readonly T[]) => values[int(0, values.length - 1)];
    const chance = (p: number) => random() < p;
    return { random, int, pick, chance };
  };

  it('em listas sorteadas de coisas vendidas a peso e a volume: kg e g, litro e ml, às vezes os dois no mesmo mercado', () => {
    const { int, pick, chance } = seeded(20261013);
    const seen = { plans: 0, estimated: 0, approximate: 0, bothUnits: 0, perGram: 0 };
    for (let round = 0; round < 300; round++) {
      const stores = ['a', 'b', 'c', 'd'].slice(0, int(2, 4));
      // Seis produtos: três a peso, três a volume.
      const catalog = Array.from({ length: 6 }, (_, n) => ({ id: `p${n}`, name: `Produto ${n}`, units: n < 3 ? ['kg', 'g'] : ['l', 'ml'] }));
      const quotes: EstimatePrice[] = [];
      for (const product of catalog) {
        for (const storeId of stores) {
          if (chance(0.3)) continue;
          // Cada nota saiu numa unidade; alguns mercados têm o produto nas duas (notas de dias diferentes).
          const units = chance(0.25) ? product.units : [pick(product.units)];
          if (units.length > 1) seen.bothUnits += 1;
          for (const unit of units) {
            // De R$ 3,00 a R$ 90,00 por kg ou litro; por g e por ml, com as 4 casas da nota.
            const unitPrice = unit === 'g' || unit === 'ml' ? int(30, 900) / 10000 : int(300, 9000) / 100;
            const day = `2026-${pick(['08', '09', '10'])}-${String(int(1, 28)).padStart(2, '0')}`;
            quotes.push(price(product.id, storeId, unitPrice, `${day}T12:00:00Z`, unit));
          }
        }
      }
      const list = Array.from({ length: int(2, 6) }, (_, n) => {
        const product = pick(catalog);
        const unit = pick([...product.units, 'un']);
        const quantity = unit === 'g' || unit === 'ml' ? int(1, 18) * 50 : unit === 'un' ? int(1, 6) : int(1, 6) / 2;
        return item(`i${n}`, product.name, product.id, quantity, unit, chance(0.15));
      });

      const { recommendation, estimates } = expectSameAccount(list, quotes, {}, stores);
      seen.plans += recommendation.plans.length;
      for (const plan of recommendation.plans) {
        for (const a of plan.assignments) {
          const cost = estimates.get(plan.storeIds[0])!.byItem.get(a.itemKey)!;
          // Toda resposta vem por kg ou por litro: nenhum item sai pelo preço de 1 g ou de 1 ml.
          expect(['kg', 'l']).toContain(cost.unit);
          if (a.kind === 'estimated') seen.estimated += 1;
          if (a.approximateQuantity) seen.approximate += 1;
          // O preço da nota veio por g ou por ml: entrou na conta convertido.
          if (cost.used && !quotes.includes(cost.used)) seen.perGram += 1;
        }
      }
    }
    for (const count of Object.values(seen)) expect(count).toBeGreaterThan(40);
  });

  it('em centenas de listas sorteadas, em todos os mercados', () => {
    const { random, int, pick, chance } = seeded(20261012);

    const NAMES = ['Leite', 'Refrigerante', 'Café', 'Sabão em pó', 'Queijo'];
    const UNITS = ['un', 'un', 'un', 'kg', 'g', 'l', 'ml'];
    const seen = { plans: 0, estimated: 0, otherProduct: 0, otherUnit: 0, approximate: 0, unpriced: 0, split: 0 };
    for (let round = 0; round < 400; round++) {
      const stores = ['a', 'b', 'c', 'd'].slice(0, int(2, 4));
      // Dez produtos, cada um com a unidade em que costuma ser vendido; os dois últimos nunca têm preço.
      const catalog = Array.from({ length: 10 }, (_, n) => ({ id: `p${n}`, name: `Produto ${n}`, unit: pick(['un', 'un', 'kg', 'l']) }));
      const quotes: EstimatePrice[] = [];
      for (const product of catalog.slice(0, 8)) {
        for (const storeId of stores) {
          // Alguns mercados não têm o produto; alguns o vendem em outra unidade; brinde sai a zero.
          if (chance(0.4)) continue;
          const unit = chance(0.2) ? pick(['un', 'kg', 'g', 'l']) : product.unit;
          const unitPrice = chance(0.04) ? 0 : int(100, 6000) / 100;
          const day = `2026-${pick(['08', '09', '10'])}-${String(int(1, 28)).padStart(2, '0')}`;
          quotes.push(price(product.id, storeId, unitPrice, `${day}T12:00:00Z`, unit));
        }
      }
      // Nomes digitados soltos, ligados a um ou dois produtos pelas notas.
      const links = new LinkIndex(
        NAMES.flatMap((name) =>
          [...new Set([int(0, 9), ...(chance(0.6) ? [int(0, 9)] : [])])].map((n) => ({ name_key: listNameKey(name), product_id: `p${n}` })),
        ),
      );
      const list = Array.from({ length: int(2, 8) }, (_, n) => {
        const product = pick(catalog);
        const kind = random();
        // Produto próprio; nome solto com ligações (às vezes com um produto sem preço); nome igual ao de um produto; nome que ninguém conhece.
        const [name, productId] =
          kind < 0.45
            ? [product.name, product.id]
            : kind < 0.8
              ? [pick(NAMES), chance(0.2) ? 'p9' : null]
              : kind < 0.92
                ? [product.name.toUpperCase(), null]
                : ['Carregador', null];
        const unit = chance(0.6) ? product.unit : pick(UNITS);
        const quantity = unit === 'g' || unit === 'ml' ? int(1, 18) * 50 : unit === 'un' ? int(1, 12) : int(1, 6) / 2;
        return item(`i${n}`, name, productId, quantity, unit, chance(0.15));
      });
      const sources = { links, products: catalog.map(({ id, name }) => ({ id, name })) };

      const { recommendation, estimates } = expectSameAccount(list, quotes, sources, stores);
      seen.plans += recommendation.plans.length;
      seen.unpriced += recommendation.unpricedKeys.length;
      seen.split += whereToBuy(list, quotes, sources, 2).plans.filter((p) => p.storeIds.length === 2).length;
      for (const plan of recommendation.plans) {
        for (const a of plan.assignments) {
          const cost = estimates.get(plan.storeIds[0])!.byItem.get(a.itemKey)!;
          if (a.kind === 'estimated') seen.estimated += 1;
          if (a.approximateQuantity) seen.approximate += 1;
          if (cost.used && cost.used.productId !== cost.productId) seen.otherProduct += 1;
          if (cost.used && cost.used.productId === cost.productId && cost.used.unit !== cost.last.unit) seen.otherUnit += 1;
        }
      }
    }
    // O sorteio passou por todos os caminhos da conta, muitas vezes.
    expect(seen.plans).toBeGreaterThan(800);
    for (const count of Object.values(seen)) expect(count).toBeGreaterThan(40);
  });
});

describe('pantryHits', () => {
  const stock = (name: string, product_id: string | null, extra: Partial<PantryStock> = {}): PantryStock => ({
    product_id,
    name,
    quantity: 1,
    unit: 'un',
    purchased_on: '2026-10-01',
    expires_on: null,
    ...extra,
  });
  const today = '2026-10-12';

  it('acha o mesmo produto, o nome ligado pelas notas e o mesmo nome', () => {
    const links = new LinkIndex([{ name_key: 'leite', product_id: 'italac' }]);
    const hits = pantryHits(
      [item('a', 'Arroz', 'arroz'), item('l', 'Leite', null), item('c', 'café', null), item('x', 'Feijão', null)],
      [stock('Arroz Tio João 5kg', 'arroz'), stock('Leite Integral Italac 1L', 'italac', { quantity: 6 }), stock('Café', null)],
      { links, today },
    );
    expect([...hits.keys()]).toEqual(['a', 'l', 'c']);
    expect(hits.get('l')).toEqual({ name: 'Leite Integral Italac 1L', quantity: 6, unit: 'un', since: '2026-10-01', expiresOn: null });
  });

  it('nome só parecido não conta', () => {
    const hits = pantryHits([item('l', 'Leite', null)], [stock('Leite condensado Moça', 'moca'), stock('Leite de coco', null)], { today });
    expect(hits.size).toBe(0);
  });

  it('vencido não conta; soma as entradas e mostra a validade que vence primeiro', () => {
    const hits = pantryHits(
      [item('i', 'Iogurte', 'iogurte'), item('p', 'Presunto', 'presunto')],
      [
        stock('Iogurte', 'iogurte', { quantity: 2, purchased_on: '2026-10-02', expires_on: '2026-10-20' }),
        stock('Iogurte', 'iogurte', { quantity: 4, purchased_on: '2026-10-08', expires_on: '2026-10-15' }),
        stock('Iogurte', 'iogurte', { quantity: 1, purchased_on: '2026-09-01', expires_on: '2026-10-01' }),
        stock('Presunto', 'presunto', { expires_on: '2026-10-11' }),
      ],
      { today },
    );
    expect(hits.get('i')).toEqual({ name: 'Iogurte', quantity: 6, unit: 'un', since: '2026-10-08', expiresOn: '2026-10-15' });
    expect(hits.has('p')).toBe(false);
  });

  it('entradas em unidades diferentes: sem soma', () => {
    const hits = pantryHits(
      [item('b', 'Banana', 'banana')],
      [stock('Banana', 'banana', { quantity: 1.2, unit: 'kg' }), stock('Banana', 'banana', { quantity: 6, unit: 'un' })],
      { today },
    );
    expect(hits.get('b')).toMatchObject({ name: 'Banana', quantity: null, unit: null });
  });

  it('produto diferente com nome igual não confunde quando os dois têm produto', () => {
    const hits = pantryHits([item('a', 'Arroz', 'arroz-branco')], [stock('Arroz', 'arroz-integral')], { today });
    expect(hits.size).toBe(0);
  });

  it('produto diferente conta quando a pessoa já confirmou essa ligação numa nota', () => {
    const links = new LinkIndex([{ name_key: 'leite', product_id: 'italac' }]);
    const hits = pantryHits([item('l', 'Leite', 'leite-generico')], [stock('Leite Integral Italac 1L', 'italac', { quantity: 6 })], { links, today });
    expect(hits.get('l')).toMatchObject({ name: 'Leite Integral Italac 1L', quantity: 6 });
  });

  it('entradas de produtos diferentes: o nome da lista, sem número', () => {
    const links = new LinkIndex([
      { name_key: 'leite', product_id: 'italac' },
      { name_key: 'leite', product_id: 'ninho' },
    ]);
    const hits = pantryHits(
      [item('l', 'Leite', null)],
      [
        stock('Leite Integral Italac 1L', 'italac', { quantity: 6, purchased_on: '2026-10-05' }),
        stock('Leite em pó Ninho 800g', 'ninho', { expires_on: '2027-03-01' }),
      ],
      { links, today },
    );
    expect(hits.get('l')).toEqual({ name: 'Leite', quantity: null, unit: null, since: '2026-10-05', expiresOn: '2027-03-01' });
    // Os dois com o mesmo nome na despensa continuam sendo dois produtos: sem soma.
    const renamed = pantryHits(
      [item('l', 'Leite', null)],
      [stock('Leite', 'italac', { quantity: 6 }), stock('Leite', 'ninho', { quantity: 2 })],
      { links, today },
    );
    expect(renamed.get('l')).toMatchObject({ name: 'Leite', quantity: null, unit: null });
    // Um deles e uma entrada sem produto com o mesmo nome: é a mesma coisa, soma.
    const mixed = pantryHits([item('l', 'Leite', null)], [stock('Leite', 'italac', { quantity: 6 }), stock('leite', null)], { links, today });
    expect(mixed.get('l')).toMatchObject({ quantity: 7, unit: 'un' });
  });

  it('o mesmo nome com e sem produto é a mesma coisa: soma', () => {
    const hits = pantryHits([item('c', 'Café', null)], [stock('Café', null), stock('café', 'cafe', { quantity: 2 })], { today });
    expect(hits.get('c')).toMatchObject({ name: 'Café', quantity: 3, unit: 'un' });
  });

  it('entrada antiga sem validade continua valendo (a data vai nos detalhes)', () => {
    const hits = pantryHits([item('d', 'Detergente', null)], [stock('Detergente', null, { purchased_on: '2025-08-01' })], { today });
    expect(hits.get('d')).toMatchObject({ since: '2025-08-01', expiresOn: null });
  });

  it('o que o app acha que acabou não aparece como "na despensa"', () => {
    const links = new LinkIndex([{ name_key: 'cafe', product_id: 'pilao' }]);
    const pantry = [stock('Café Pilão 500g', 'pilao'), stock('Arroz', null), stock('Óleo de soja', 'oleo')];
    const list = [item('c', 'Café', null), item('a', 'arroz', null), item('o', 'Óleo de soja', 'oleo')];
    expect([...pantryHits(list, pantry, { links, today }).keys()]).toEqual(['c', 'a', 'o']);
    // Pelo produto da entrada (café), pelo nome (arroz); o óleo não passou do costume e fica.
    const ranOut = [
      { name: 'Café Pilão 500g', productId: 'pilao', lastAt: '2026-10-01T12:00:00', everyDays: 10 },
      { name: 'Arroz', productId: null, lastAt: '2026-10-01T12:00:00', everyDays: 10 },
    ];
    expect([...pantryHits(list, pantry, { links, today, ranOut }).keys()]).toEqual(['o']);
  });

  it('o que acabou sob um produto ligado ao nome do item não volta pela entrada posta à mão', () => {
    const links = new LinkIndex([
      { name_key: 'leite', product_id: 'italac' },
      { name_key: 'leite', product_id: 'ninho' },
    ]);
    const list = [item('l', 'Leite', null)];
    // O palpite veio com o nome da nota, sob o produto.
    const ranOut = [{ name: 'LEITE UHT ITALAC 1L', productId: 'italac', lastAt: '2026-09-20T12:00:00', everyDays: 7 }];
    const manual = (purchased_on: string) => [stock('Leite', null, { purchased_on })];
    expect(pantryHits(list, manual('2026-09-01'), { links, today }).has('l')).toBe(true);
    // Posta à mão antes da última compra do Italac: acabou junto.
    expect(pantryHits(list, manual('2026-09-01'), { links, today, ranOut }).has('l')).toBe(false);
    // Posta à mão depois dela, e ainda dentro do costume: estoque novo.
    expect(pantryHits(list, manual('2026-10-08'), { links, today, ranOut }).has('l')).toBe(true);
    // A entrada de outro produto ligado ao nome responde por ela mesma: o Ninho não acabou.
    const ninho = [stock('Leite Ninho 1L', 'ninho', { purchased_on: '2026-09-01' })];
    expect(pantryHits(list, ninho, { links, today, ranOut }).has('l')).toBe(true);
    // O item que já tem produto (o Ninho) aceita a mesma entrada pelo nome: o palpite dos ligados vale para ele também.
    const withProduct = [item('l', 'Leite', 'ninho')];
    expect(pantryHits(withProduct, manual('2026-09-01'), { links, today }).has('l')).toBe(true);
    expect(pantryHits(withProduct, manual('2026-09-01'), { links, today, ranOut }).has('l')).toBe(false);
    expect(pantryHits(withProduct, manual('2026-10-08'), { links, today, ranOut }).has('l')).toBe(true);
    expect(pantryHits(withProduct, ninho, { links, today, ranOut }).has('l')).toBe(true);
    // Sem ligação com o nome, o palpite de outro produto não diz nada sobre este item.
    expect(pantryHits(list, manual('2026-09-01'), { links: new LinkIndex([]), today, ranOut }).has('l')).toBe(true);
  });

  it('"acho que acabou" de verdade: café comprado de 10 em 10 dias, última compra há 14', () => {
    const bought = (day: string): PurchaseRecord => ({
      name: 'Café Pilão 500g',
      category: 'cafe_cha',
      productId: 'pilao',
      quantity: 1,
      unit: 'un',
      at: `${day}T12:00:00`,
      source: 'receipt',
    });
    const ranOut = ranOutItems(['2026-09-08', '2026-09-18', '2026-09-28'].map(bought), {
      now: new Date(`${today}T23:59:59.999`),
      listKind: 'mercado',
    });
    expect(ranOut.map((r) => r.name)).toEqual(['Café Pilão 500g']);
    const pantry = [stock('Café Pilão 500g', 'pilao', { purchased_on: '2026-09-28', expires_on: '2027-03-27' })];
    expect(pantryHits([item('c', 'Café Pilão 500g', 'pilao')], pantry, { today }).size).toBe(1);
    expect(pantryHits([item('c', 'Café Pilão 500g', 'pilao')], pantry, { today, ranOut }).size).toBe(0);
  });

  const purchase = (name: string, productId: string | null, day: string, source: PurchaseRecord['source']): PurchaseRecord => ({
    name,
    category: 'mercearia',
    productId,
    quantity: 1,
    unit: 'un',
    at: `${day}T12:00:00`,
    source,
  });
  const endOf = (day: string) => new Date(`${day}T23:59:59.999`);

  it('entrada mais nova que a última compra conhecida é estoque novo: café posto na despensa à mão', () => {
    // Café nas notas de 8, 18 e 28 set: a cada 10 dias, última há 14. Acabou.
    const ranOut = ranOutItems(['2026-09-08', '2026-09-18', '2026-09-28'].map((day) => purchase('Café Pilão 500g', 'pilao', day, 'receipt')), {
      now: endOf(today),
      listKind: 'mercado',
    });
    expect(ranOut.map((r) => [r.name, r.everyDays, r.daysSince])).toEqual([['Café Pilão 500g', 10, 14]]);
    const list = [item('c', 'Café Pilão 500g', 'pilao')];
    const old = stock('Café Pilão 500g', 'pilao', { purchased_on: '2026-09-28' });
    expect(pantryHits(list, [old], { today, ranOut }).size).toBe(0);
    // Em 11 out alguém pôs café na despensa: só essa entrada conta (a de 28 set é a compra que acabou).
    const fresh = stock('Café Pilão 500g', 'pilao', { purchased_on: '2026-10-11', quantity: 2 });
    expect(pantryHits(list, [old, fresh], { today, ranOut }).get('c')).toEqual({
      name: 'Café Pilão 500g',
      quantity: 2,
      unit: 'un',
      since: '2026-10-11',
      expiresOn: null,
    });
    // A mesma ida ao mercado, anotada dois dias depois (30 set), não é estoque novo.
    const sameTrip = stock('Café Pilão 500g', 'pilao', { purchased_on: '2026-09-30', quantity: 2 });
    expect(pantryHits(list, [old, sameTrip], { today, ranOut }).size).toBe(0);
    // E o estoque novo também acaba: passado o intervalo de costume dele (10 dias desde 11 out), deixa de valer.
    const later = (day: string) =>
      pantryHits(list, [old, fresh], {
        today: day,
        ranOut: ranOutItems(['2026-09-08', '2026-09-18', '2026-09-28'].map((d) => purchase('Café Pilão 500g', 'pilao', d, 'receipt')), {
          now: endOf(day),
          listKind: 'mercado',
        }),
      }).size;
    expect(later('2026-10-20')).toBe(1);
    expect(later('2026-10-21')).toBe(0);
  });

  it('entrada mais nova que a última compra conhecida é estoque novo: nota lida sem marcar a lista', () => {
    // "Leite" marcado na lista em 12 set, 22 set e 2 out: a cada 10 dias, última há 10. Acabou, pelo nome.
    const ranOut = ranOutItems(['2026-09-12', '2026-09-22', '2026-10-02'].map((day) => purchase('Leite', null, day, 'list')), {
      now: endOf(today),
      listKind: 'mercado',
    });
    expect(ranOut.map((r) => [r.name, r.everyDays, r.daysSince])).toEqual([['Leite', 10, 10]]);
    const links = new LinkIndex([{ name_key: 'leite', product_id: 'italac' }]);
    const list = [item('l', 'Leite', null)];
    // A nota de 10 out pôs 12 caixas de Italac na despensa.
    const fromReceipt = stock('Leite Integral Italac 1L', 'italac', { quantity: 12, purchased_on: '2026-10-10' });
    expect(pantryHits(list, [fromReceipt], { links, today, ranOut }).get('l')).toMatchObject({
      name: 'Leite Integral Italac 1L',
      quantity: 12,
      since: '2026-10-10',
    });
    // A entrada do dia da última compra conhecida (ou de antes) é a que acabou.
    const sameDay = stock('Leite Integral Italac 1L', 'italac', { quantity: 12, purchased_on: '2026-10-02' });
    expect(pantryHits(list, [sameDay], { links, today, ranOut }).size).toBe(0);
    expect(pantryHits(list, [sameDay, stock('Leite', null, { purchased_on: '2026-09-22' })], { links, today, ranOut }).size).toBe(0);
  });

  it('o que acabou pelo nome da lista vale também para o item que já tem o produto ligado a esse nome', () => {
    // "Leite" marcado na lista (sem produto) em 12 set, 22 set e 2 out: a cada 10 dias, última há 10. Acabou, pelo nome.
    const ranOut = ranOutItems(['2026-09-12', '2026-09-22', '2026-10-02'].map((day) => purchase('Leite', null, day, 'list')), { now: endOf(today) });
    expect(ranOut.map((r) => [r.name, r.productId])).toEqual([['Leite', null]]);
    const links = new LinkIndex([{ name_key: 'leite', product_id: 'italac' }]);
    // Uma nota pôs o Italac na despensa, e depois alguém pôs o leite na lista pela sugestão do produto.
    const carton = (purchased_on: string) => [stock('Leite Integral Italac 1L', 'italac', { purchased_on })];
    const backed = [item('l', 'Leite Integral Italac 1L', 'italac')];
    // Sem as ligações, o palpite sobre "Leite" não diz nada sobre o Italac.
    expect(pantryHits(backed, carton('2026-10-02'), { today, ranOut }).size).toBe(1);
    // Com elas, "Leite" é o Italac: as caixas da última compra conhecida acabaram, como para o item digitado "Leite".
    expect(pantryHits(backed, carton('2026-10-02'), { links, today, ranOut }).size).toBe(0);
    expect(pantryHits([item('l', 'Leite', null)], carton('2026-10-02'), { links, today, ranOut }).size).toBe(0);
    // Caixas compradas depois (e ainda dentro do costume) são estoque novo.
    expect(pantryHits(backed, carton('2026-10-09'), { links, today, ranOut }).size).toBe(1);

    // O costume do nome não vale para a caixa do produto comprada depois do palpite: quem diz se ela acabou é o
    // histórico do próprio produto. "Leite" deixou de ser marcado em 2 set (era a cada 10 dias) e o Italac passou a
    // vir nas notas, de 14 em 14 dias: a caixa de 30 set, de 12 dias atrás, continua na despensa.
    const stale = ranOutItems(
      [
        ...['2026-08-13', '2026-08-23', '2026-09-02'].map((day) => purchase('Leite', null, day, 'list')),
        ...['2026-09-02', '2026-09-16', '2026-09-30'].map((day) => purchase('Leite Integral Italac 1L', 'italac', day, 'receipt')),
      ],
      { now: endOf(today) },
    );
    expect(stale.map((r) => [r.name, r.productId])).toEqual([['Leite', null]]);
    expect(pantryHits(backed, carton('2026-09-30'), { links, today, ranOut: stale }).size).toBe(1);
    // A caixa da mesma ida ao mercado do último "Leite" marcado acabou com ele, e o item digitado "Leite" segue o costume do nome.
    expect(pantryHits(backed, carton('2026-09-02'), { links, today, ranOut: stale }).size).toBe(0);
    expect(pantryHits([item('l', 'Leite', null)], carton('2026-09-30'), { links, today, ranOut: stale }).size).toBe(0);
    // Quando o próprio Italac passa do costume dele (14 dias), o palpite dele, de compra mais recente, é o que vale.
    const later = '2026-10-20';
    const both = ranOutItems(
      [
        ...['2026-08-13', '2026-08-23', '2026-09-02'].map((day) => purchase('Leite', null, day, 'list')),
        ...['2026-09-02', '2026-09-16', '2026-09-30'].map((day) => purchase('Leite Integral Italac 1L', 'italac', day, 'receipt')),
      ],
      { now: endOf(later) },
    );
    expect(both.map((r) => r.productId).sort()).toEqual(['italac', null]);
    expect(pantryHits(backed, carton('2026-09-30'), { links, today: later, ranOut: both }).size).toBe(0);

    // Nome ligado a dois produtos: o palpite não diz qual deles acabou, e a entrada de cada um responde por ela mesma.
    const two = new LinkIndex([
      { name_key: 'leite', product_id: 'italac' },
      { name_key: 'leite', product_id: 'ninho' },
    ]);
    expect(pantryHits(backed, carton('2026-10-02'), { links: two, today, ranOut }).size).toBe(1);
    const ninho = [stock('Leite Ninho 800g', 'ninho', { purchased_on: '2026-09-25' })];
    expect(pantryHits([item('n', 'Leite Ninho 800g', 'ninho')], ninho, { links: two, today, ranOut }).size).toBe(1);

    // O palpite que já sabe de qual produto é (o Ninho) não passa para outro pelas ligações do nome.
    const ofNinho = [{ name: 'Leite', productId: 'ninho', lastAt: '2026-10-02T12:00:00', everyDays: 10 }];
    expect(pantryHits(backed, carton('2026-10-02'), { links, today, ranOut: ofNinho }).size).toBe(1);
  });

  it('o palpite de um produto não vale, pelo nome, para a entrada de outro produto de mesmo nome', () => {
    // Italac e Ninho renomeados para "Leite" na despensa. O app acha que o Italac acabou (comprado a cada 5 dias, a última vez em 2 out).
    const ranOut = [{ name: 'Leite', productId: 'italac', lastAt: '2026-10-02T12:00:00', everyDays: 5 }];
    const pantry = [stock('Leite', 'italac', { purchased_on: '2026-10-02' }), stock('Leite', 'ninho', { purchased_on: '2026-10-01' })];
    // O Ninho continua com o selo; o Italac, não.
    expect(pantryHits([item('n', 'Leite', 'ninho')], pantry, { today, ranOut }).size).toBe(1);
    expect(pantryHits([item('i', 'Leite', 'italac')], pantry, { today, ranOut }).size).toBe(0);
    // Sem produto (o item digitado "Leite" e a entrada posta à mão), o nome é tudo o que se sabe: o palpite vale.
    const byHand = [stock('Leite', null, { purchased_on: '2026-10-01' })];
    expect(pantryHits([item('l', 'Leite', null)], byHand, { today, ranOut }).size).toBe(0);
    expect(pantryHits([item('l', 'Leite', null)], byHand, { today, ranOut: [] }).size).toBe(1);
    // E o palpite sem produto ("Leite" marcado na lista) segue valendo pelo nome, tenha a entrada produto ou não.
    const named = [{ name: 'Leite', productId: null, lastAt: '2026-10-02T12:00:00', everyDays: 5 }];
    expect(pantryHits([item('n', 'Leite', 'ninho')], pantry, { today, ranOut: named }).size).toBe(0);
  });

  it('palpites empatados no dia: o selo não depende da ordem em que eles e as ligações chegam', () => {
    // Italac e Ninho, ligados a "Leite", comprados pela última vez na mesma nota (2 out), com costumes diferentes:
    // o Italac a cada 5 dias (acabou), o Ninho a cada 30. Uma caixa de "Leite" posta à mão em 5 out.
    const guesses = [
      { name: 'Leite Integral Italac 1L', productId: 'italac', lastAt: '2026-10-02T12:00:00', everyDays: 5 },
      { name: 'Leite Ninho 800g', productId: 'ninho', lastAt: '2026-10-02T12:00:00', everyDays: 30 },
    ];
    const rows = [
      { name_key: 'leite', product_id: 'ninho' },
      { name_key: 'leite', product_id: 'italac' },
    ];
    const byHand = [stock('Leite', null, { purchased_on: '2026-10-06' })];
    const sizes = new Set<number>();
    for (const ranOut of [guesses, [...guesses].reverse()]) {
      for (const links of [rows, [...rows].reverse()]) {
        sizes.add(pantryHits([item('l', 'Leite', null)], byHand, { links: new LinkIndex(links), today, ranOut }).size);
      }
    }
    // No empate vale o costume mais curto (5 dias): a caixa de 6 out, de 6 dias atrás, já passou dele. Sempre.
    expect([...sizes]).toEqual([0]);
  });

  it('o que passou muito do costume continua fora: o selo não volta depois de 3 vezes o intervalo', () => {
    const records = ['2026-09-08', '2026-09-18', '2026-09-28'].map((day) => purchase('Café Pilão 500g', 'pilao', day, 'receipt'));
    const pantry = [stock('Café Pilão 500g', 'pilao', { purchased_on: '2026-09-28', expires_on: '2027-03-27' })];
    const list = [item('c', 'Café Pilão 500g', 'pilao')];
    // 14, 30, 31, 48 e 114 dias depois da última compra (o costume é a cada 10).
    for (const day of ['2026-10-12', '2026-10-28', '2026-10-29', '2026-11-15', '2027-01-20']) {
      const ranOut = ranOutItems(records, { now: endOf(day), listKind: 'mercado' });
      expect(pantryHits(list, pantry, { today: day, ranOut }).size).toBe(0);
    }
    // A faixa "Acho que acabou" é sugestão e continua desistindo depois de 3 vezes o intervalo.
    expect(restockSuggestions(records, { now: endOf('2026-10-28'), listKind: 'mercado' }).map((r) => r.name)).toEqual(['Café Pilão 500g']);
    expect(restockSuggestions(records, { now: endOf('2026-10-29'), listKind: 'mercado' })).toEqual([]);
  });

  it('o limite é o histórico: quando a mais antiga das três compras sai dos 180 dias, o app não tem mais o costume', () => {
    const records = ['2026-09-08', '2026-09-18', '2026-09-28'].map((day) => purchase('Café Pilão 500g', 'pilao', day, 'receipt'));
    const pantry = [stock('Café Pilão 500g', 'pilao', { purchased_on: '2026-09-28', expires_on: '2027-03-27' })];
    const list = [item('c', 'Café Pilão 500g', 'pilao')];
    const hits = (day: string) => pantryHits(list, pantry, { today: day, ranOut: ranOutItems(records, { now: endOf(day), listKind: 'mercado' }) });
    // 1 mar 2027: a compra de 8 set ainda está no histórico (174 dias). 20 mar: só restam duas, e duas compras não dizem o costume.
    expect(hits('2027-03-01').size).toBe(0);
    expect(hits('2027-03-20').size).toBe(1);
  });
});

describe('textos da estimativa', () => {
  // Meio-dia no fuso do aparelho: o dia mostrado não muda com o fuso de quem roda o teste.
  const quote = (storeId: string, unitPrice: number, day: string, extra: Partial<EstimatePrice> = {}): EstimatePrice => ({
    productId: 'cafe',
    storeId,
    unit: 'un',
    unitPrice,
    purchasedAt: `${day}T12:00:00`,
    ...extra,
  });
  const last = quote('assai', 5.49, '2026-10-03');
  const estimate: ItemEstimate = {
    cost: 10.98,
    unitPrice: 5.49,
    unit: 'un',
    kind: 'known',
    approximateQuantity: false,
    productId: 'cafe',
    used: last,
    last,
    lowest: quote('atacadao', 4.99, '2026-09-20'),
  };
  const names: Record<string, string> = { assai: 'Assaí', atacadao: 'Atacadão', dia: 'Dia' };
  const storeName = (id: string) => names[id];
  const today = '2026-10-12';

  it('o custo leva ~ quando é estimado, a quantidade é aproximada ou o preço é de outro produto', () => {
    expect(formatItemCost(estimate)).toBe('R$ 10,98');
    expect(formatItemCost({ ...estimate, kind: 'estimated', used: null })).toBe('~R$ 10,98');
    expect(formatItemCost({ ...estimate, approximateQuantity: true })).toBe('~R$ 10,98');
    expect(formatItemCost({ ...estimate, used: quote('dia', 5.49, '2026-10-01', { productId: 'outro' }) })).toBe('~R$ 10,98');
  });

  it('o título do total: a lista toda só quando todos os itens têm preço', () => {
    expect(estimateHeadline({ itemCount: 22, pricedCount: 22 })).toBe('A lista deve dar');
    expect(estimateHeadline({ itemCount: 22, pricedCount: 4 })).toBe('Os 4 itens com preço devem dar');
    expect(estimateHeadline({ itemCount: 3, pricedCount: 1 })).toBe('O item com preço deve dar');
  });

  it('diz de onde sai a estimativa e o que ficou de fora', () => {
    const counts = (itemCount: number, pricedCount: number, estimatedCount = 0, approximateCount = 0) => ({
      itemCount,
      pricedCount,
      estimatedCount,
      approximateCount,
    });
    expect(describeEstimate(counts(22, 22), null)).toBe('Pelo último preço que a casa pagou em cada item; todos os itens têm preço.');
    expect(describeEstimate(counts(22, 18), null)).toBe(
      'Pelo último preço que a casa pagou em cada item; 18 de 22 itens têm preço. Os outros 4 ficam fora da conta.',
    );
    expect(describeEstimate(counts(3, 1), null)).toBe(
      'Pelo último preço que a casa pagou em cada item; 1 de 3 itens tem preço. Os outros 2 ficam fora da conta.',
    );
    expect(describeEstimate(counts(3, 2), null)).toBe(
      'Pelo último preço que a casa pagou em cada item; 2 de 3 itens têm preço. O outro fica fora da conta.',
    );
    expect(describeEstimate(counts(5, 5, 0, 2), null)).toBe(
      'Pelo último preço que a casa pagou em cada item; todos os itens têm preço; em 2 a quantidade é aproximada (o preço é por kg ou por unidade).',
    );
    // Com o lugar escolhido, sem artigo antes do nome ("do Farmácia" não existe).
    expect(describeEstimate(counts(3, 3, 1), 'Assaí')).toBe(
      'Lugar escolhido: Assaí. Todos os itens têm preço; 1 é estimado pelo nível de preço de lá.',
    );
    expect(describeEstimate(counts(9, 7, 3, 1), 'Farmácia São João')).toBe(
      'Lugar escolhido: Farmácia São João. 7 de 9 itens têm preço; 3 são estimados pelo nível de preço de lá; em 1 a quantidade é aproximada (o preço é por kg ou por unidade). Os outros 2 ficam fora da conta.',
    );
  });

  it('os detalhes do item: último preço e menor preço, com mercado e data', () => {
    expect(itemFacts(estimate, undefined, { storeName, today })).toEqual([
      'Último preço: R$ 5,49/un (Assaí, 3 out).',
      'Menor preço: R$ 4,99/un (Atacadão, 20 set).',
    ]);
    // Fora do ano de hoje, a data leva o ano.
    expect(itemFacts(estimate, undefined, { storeName, today: '2027-01-05' })).toEqual([
      'Último preço: R$ 5,49/un (Assaí, 3 out 2026).',
      'Menor preço: R$ 4,99/un (Atacadão, 20 set 2026).',
    ]);
    // Mercado sem nome carregado: só a data, nunca um nome inventado.
    expect(itemFacts({ ...estimate, lowest: last }, undefined, { storeName: () => undefined, today })).toEqual([
      'Último preço: R$ 5,49/un (3 out).',
    ]);
  });

  it('só em promoção: o preço bom é o menor, e a frase some quando ele é o próprio último preço', () => {
    expect(itemFacts(estimate, undefined, { storeName, today, promotionOnly: true })).toEqual([
      'Último preço: R$ 5,49/un (Assaí, 3 out).',
      'Menor preço: R$ 4,99/un (Atacadão, 20 set).',
      'Só em promoção: o preço bom é R$ 4,99/un ou menos.',
    ]);
    // Um mercado só: o último preço já é o menor, e não é preço de promoção.
    expect(itemFacts({ ...estimate, lowest: last }, undefined, { storeName, today, promotionOnly: true })).toEqual([
      'Último preço: R$ 5,49/un (Assaí, 3 out).',
    ]);
  });

  it('com o mercado escolhido, diz o preço que entrou na conta', () => {
    // O mercado não tem o item: estimado.
    expect(
      itemFacts({ ...estimate, kind: 'estimated', unitPrice: 5.2, used: null }, undefined, { storeName, today, chosenStore: 'dia', promotionOnly: true }),
    ).toEqual([
      'Último preço: R$ 5,49/un (Assaí, 3 out).',
      'Menor preço: R$ 4,99/un (Atacadão, 20 set).',
      'Dia: a casa ainda não comprou este item lá; cerca de R$ 5,20/un, pelo nível de preço de lá.',
      'Só em promoção: o preço bom é R$ 4,99/un ou menos.',
    ]);
    // Preço de nota de lá, que não é o último nem o menor.
    expect(itemFacts({ ...estimate, unitPrice: 5.2, used: quote('dia', 5.2, '2026-02-10') }, undefined, { storeName, today, chosenStore: 'dia' })).toEqual([
      'Último preço: R$ 5,49/un (Assaí, 3 out).',
      'Menor preço: R$ 4,99/un (Atacadão, 20 set).',
      'Preço usado na conta: R$ 5,20/un (Dia, 10 fev).',
    ]);
    // O mercado escolhido é o do último preço: não repete.
    expect(itemFacts(estimate, undefined, { storeName, today, chosenStore: 'assai' })).toEqual([
      'Último preço: R$ 5,49/un (Assaí, 3 out).',
      'Menor preço: R$ 4,99/un (Atacadão, 20 set).',
    ]);
  });

  it('preço de outro produto do mesmo nome, ou em outra unidade, vem dito', () => {
    const productName = (id: string) => (id === 'lata' ? 'Guaraná lata 350ml' : undefined);
    expect(
      itemFacts({ ...estimate, unitPrice: 2.99, used: quote('dia', 2.99, '2026-09-01', { productId: 'lata' }) }, undefined, {
        storeName,
        today,
        chosenStore: 'dia',
        productName,
      }).at(-1),
    ).toBe('Preço usado na conta: R$ 2,99/un, de Guaraná lata 350ml (Dia, 1 set).');
    expect(
      itemFacts({ ...estimate, unitPrice: 2.99, used: quote('dia', 2.99, '2026-09-01', { productId: 'sem-nome' }) }, undefined, {
        storeName,
        today,
        chosenStore: 'dia',
        productName,
      }).at(-1),
    ).toBe('Preço usado na conta: R$ 2,99/un, de outro produto com esse nome (Dia, 1 set).');
    expect(
      itemFacts(
        { ...estimate, cost: 6, unitPrice: 6, unit: 'kg', approximateQuantity: true, used: quote('dia', 6, '2026-10-01', { unit: 'kg' }) },
        undefined,
        { storeName, today, chosenStore: 'dia' },
      ).slice(-2),
    ).toEqual(['Preço usado na conta: R$ 6,00/kg (Dia, 1 out).', 'O preço é por kg: a conta da lista usa 1 kg.']);
  });

  it('preço por g ou por ml aparece por kg ou por litro, nunca como "R$ 0,00/g"', () => {
    const facts = (storeId: string | null, quotes: EstimatePrice[]) =>
      itemFacts(estimateList([{ id: 'a', name: 'Arroz', productId: 'arroz', quantity: 500, unit: 'g', inCart: false }], quotes, { storeId }).byItem.get('a'), undefined, {
        storeName,
        today,
        chosenStore: storeId,
        promotionOnly: true,
      });
    const perGram = [
      quote('assai', 0.0049, '2026-10-01', { productId: 'arroz', unit: 'g' }),
      quote('atacadao', 0.0041, '2026-09-01', { productId: 'arroz', unit: 'g' }),
    ];
    expect(facts(null, perGram)).toEqual([
      'Último preço: R$ 4,90/kg (Assaí, 1 out).',
      'Menor preço: R$ 4,10/kg (Atacadão, 1 set).',
      'Só em promoção: o preço bom é R$ 4,10/kg ou menos.',
    ]);
    // Estimado num mercado sem o item: a média, também por kg.
    expect(facts('dia', perGram)[2]).toBe('Dia: a casa ainda não comprou este item lá; cerca de R$ 4,50/kg, pelo nível de preço de lá.');
    // O mesmo queijo por kg num mercado e por g no outro: o por g, mais novo e mais caro, é o último; o por kg é o menor.
    expect(
      facts(null, [
        quote('assai', 49.9, '2026-08-05', { productId: 'arroz', unit: 'kg' }),
        quote('atacadao', 0.0599, '2026-10-01', { productId: 'arroz', unit: 'g' }),
      ]),
    ).toEqual([
      'Último preço: R$ 59,90/kg (Atacadão, 1 out).',
      'Menor preço: R$ 49,90/kg (Assaí, 5 ago).',
      'Só em promoção: o preço bom é R$ 49,90/kg ou menos.',
    ]);
    // A frase não depende de quem montou a estimativa: um preço por ml sai por litro.
    const perMl = quote('assai', 0.0083, '2026-10-03', { unit: 'ml' });
    expect(itemFacts({ ...estimate, unit: 'ml', unitPrice: 0.0083, used: perMl, last: perMl, lowest: perMl }, undefined, { storeName, today })).toEqual([
      'Último preço: R$ 8,30/l (Assaí, 3 out).',
    ]);
  });

  it('lista em "un" com preço por g: os detalhes dizem que a conta usa 1 kg', () => {
    const queijo = estimateList(
      [{ id: 'q', name: 'Queijo mussarela', productId: 'queijo', quantity: 3, unit: 'un', inCart: false }],
      [quote('assai', 49.9, '2026-10-03', { productId: 'queijo', unit: 'kg' }), quote('dia', 0.0599, '2026-09-01', { productId: 'queijo', unit: 'g' })],
      { storeId: 'dia' },
    ).byItem.get('q');
    expect(itemFacts(queijo, undefined, { storeName, today, chosenStore: 'dia' })).toEqual([
      'Último preço: R$ 49,90/kg (Assaí, 3 out).',
      'Preço usado na conta: R$ 59,90/kg (Dia, 1 set).',
      'O preço é por kg: a conta da lista usa 1 kg.',
    ]);
    // Para a estimativa montada com o preço como veio na nota, a frase é a mesma: nunca "usa 1 g".
    const perGram = quote('dia', 0.0599, '2026-09-01', { unit: 'g' });
    expect(
      itemFacts({ ...estimate, cost: 59.9, unitPrice: 0.0599, unit: 'g', approximateQuantity: true, used: perGram }, undefined, {
        storeName,
        today,
        chosenStore: 'dia',
      }).slice(-2),
    ).toEqual(['Preço usado na conta: R$ 59,90/kg (Dia, 1 set).', 'O preço é por kg: a conta da lista usa 1 kg.']);
  });

  it('sem as ligações ou os produtos carregados, o cartão diz que não deu para conferir o que ficou sem preço', () => {
    expect(uncheckedPricesNote({ itemCount: 5, pricedCount: 3 }, false)).toBe('Não deu para conferir se os outros 2 itens já têm preço.');
    expect(uncheckedPricesNote({ itemCount: 2, pricedCount: 1 }, false)).toBe('Não deu para conferir se o outro item já tem preço.');
    // Carregados, ou com todos os itens com preço, não há o que avisar.
    expect(uncheckedPricesNote({ itemCount: 5, pricedCount: 3 }, true)).toBeNull();
    expect(uncheckedPricesNote({ itemCount: 5, pricedCount: 5 }, false)).toBeNull();
    // Sem item com preço não há conta (nem "outros"): a linha fala da lista toda, e o cartão aparece só com ela.
    expect(uncheckedPricesNote({ itemCount: 5, pricedCount: 0 }, false)).toBe('Não deu para conferir se os itens da lista já têm preço.');
    expect(uncheckedPricesNote({ itemCount: 1, pricedCount: 0 }, false)).toBe('Não deu para conferir se o item da lista já tem preço.');
    expect(uncheckedPricesNote({ itemCount: 5, pricedCount: 0 }, true)).toBeNull();
    expect(uncheckedPricesNote({ itemCount: 0, pricedCount: 0 }, false)).toBeNull();
  });

  it('o que está na despensa, desde quando', () => {
    expect(
      itemFacts(undefined, { name: 'Leite Integral Italac 1L', quantity: 6, unit: 'un', since: '2026-10-03', expiresOn: '2026-10-20' }, { storeName, today }),
    ).toEqual(['Na despensa desde 3 out: 6 un de Leite Integral Italac 1L; vence em 20 out.']);
    expect(itemFacts(undefined, { name: 'Banana', quantity: null, unit: null, since: '2026-10-03', expiresOn: null }, { storeName, today })).toEqual([
      'Na despensa desde 3 out: Banana.',
    ]);
    // Entrada velha: o ano aparece, e a pessoa vê que pode já ter acabado.
    expect(itemFacts(undefined, { name: 'Detergente', quantity: 1, unit: 'un', since: '2025-08-01', expiresOn: null }, { storeName, today })).toEqual([
      'Na despensa desde 1 ago 2025: 1 un de Detergente.',
    ]);
    expect(itemFacts(undefined, undefined, { storeName, today })).toEqual([]);
  });

  it('a frase do cartão: nomes sem repetir, os três primeiros e quantos mais', () => {
    expect(describePantryHits(['Café'])).toBe('Na despensa: Café. Se já acabou, dê baixa lá.');
    expect(describePantryHits(['Leite', 'leite', 'Café', 'CAFE'])).toBe('Na despensa: Leite e Café. Se já acabou, dê baixa lá.');
    expect(describePantryHits(['Café', 'Arroz', 'Leite'])).toBe('Na despensa: Café, Arroz e Leite. Se já acabou, dê baixa lá.');
    expect(describePantryHits(['Café', 'Arroz', 'Leite', 'Óleo', 'Sal', 'café'])).toBe(
      'Na despensa: Café, Arroz, Leite e mais 2. Se já acabou, dê baixa lá.',
    );
  });
});

describe('o mercado escolhido vale por uma ida ao mercado', () => {
  const at = Date.parse('2026-10-12T10:00:00Z');

  it('vale por 6 horas e depois é esquecido', () => {
    expect(currentStoreChoice(undefined, at)).toBeNull();
    expect(currentStoreChoice({ storeId: 'assai', at }, at + 60_000)).toBe('assai');
    expect(currentStoreChoice({ storeId: 'assai', at }, at + CHOSEN_STORE_MS - 1)).toBe('assai');
    expect(currentStoreChoice({ storeId: 'assai', at }, at + CHOSEN_STORE_MS)).toBeNull();
    expect(CHOSEN_STORE_MS).toBe(6 * 60 * 60 * 1000);
  });
});
