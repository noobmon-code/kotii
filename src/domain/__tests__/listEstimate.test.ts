import { describe, expect, it } from '@jest/globals';

import {
  describeEstimate,
  estimateList,
  formatItemCost,
  itemFacts,
  pantryHits,
  storePriceIndex,
  type EstimateItem,
  type EstimatePrice,
  type ItemEstimate,
  type PantryStock,
} from '../listEstimate';
import { LinkIndex } from '../listLinks';

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

describe('storePriceIndex', () => {
  it('compara os mercados só nos produtos que os dois têm', () => {
    const index = storePriceIndex([
      price('arroz', 'bom', 20),
      price('arroz', 'caro', 24),
      price('cafe', 'bom', 15),
      price('pao', 'solto', 8),
    ]);
    // Arroz: média 22 -> bom 0,909, caro 1,091. O café (só no bom) não diz nada sobre o mercado.
    expect(index.get('bom')).toBeCloseTo(20 / 22, 5);
    expect(index.get('caro')).toBeCloseTo(24 / 22, 5);
    // Mercado sem produto em comum com outro fica na média.
    expect(index.get('solto')).toBe(1);
  });

  it('preço em unidade diferente não entra na mesma conta', () => {
    const index = storePriceIndex([price('banana', 'bom', 6, undefined, 'kg'), price('banana', 'caro', 2, undefined, 'un')]);
    expect(index.get('bom')).toBe(1);
    expect(index.get('caro')).toBe(1);
  });
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
    expect(estimate.byItem.get('a')).toMatchObject({ cost: 48, unitPrice: 24, kind: 'known', approximateQuantity: false });
    expect(estimate.byItem.get('a')?.last).toEqual({ unitPrice: 24, storeId: 'caro', purchasedAt: '2026-10-05T12:00:00Z' });
    expect(estimate.byItem.get('a')?.lowest).toEqual({ unitPrice: 20, storeId: 'bom' });
    expect(estimate).toMatchObject({ total: 71, pendingTotal: 56, cartTotal: 15, itemCount: 3, pricedCount: 3, estimatedCount: 0 });
  });

  it('com o mercado escolhido, vale o preço de lá; o que ele não tem é estimado pelo nível de preço dele', () => {
    const list = [item('a', 'Arroz', 'arroz', 2), item('f', 'Feijão', 'feijao'), item('c', 'Café', 'cafe')];
    const noBom = estimateList(list, prices, { storeId: 'bom' });
    expect(noBom).toMatchObject({ total: 63, pricedCount: 3, estimatedCount: 0 });

    const noCaro = estimateList(list, prices, { storeId: 'caro' });
    expect(noCaro.byItem.get('a')).toMatchObject({ cost: 48, kind: 'known' });
    expect(noCaro.byItem.get('f')).toMatchObject({ cost: 9.6, kind: 'known' });
    // Café só tem preço no bom (15). O caro costuma ser 1,0909x a média (arroz 24/22, feijão 9,6/8,8).
    const cafe = noCaro.byItem.get('c')!;
    expect(cafe.kind).toBe('estimated');
    expect(cafe.cost).toBeCloseTo(15 * (24 / 22), 2);
    expect(noCaro.estimatedCount).toBe(1);
  });

  it('item sem produto usa a ligação aprendida nas notas ou o produto de mesmo nome', () => {
    const links = new LinkIndex([{ name_key: 'refrigerante', product_id: 'coca' }]);
    const estimate = estimateList(
      [item('r', 'Refrigerante', null, 2), item('p', 'pão francês', null), item('x', 'Carregador', null)],
      [price('coca', 'bom', 9), price('pao', 'bom', 12, undefined, 'kg')],
      { links, products: [{ id: 'pao', name: 'Pão francês' }] },
    );
    expect(estimate.byItem.get('r')).toMatchObject({ cost: 18, kind: 'known' });
    // Pão: a lista pede 1 un, o preço é por kg: 1 kg, quantidade aproximada.
    expect(estimate.byItem.get('p')).toMatchObject({ cost: 12, unit: 'kg', approximateQuantity: true });
    // Sem preço nenhum: fora dos totais.
    expect(estimate.byItem.has('x')).toBe(false);
    expect(estimate).toMatchObject({ total: 30, itemCount: 3, pricedCount: 2 });
  });

  it('nome ligado a mais de um produto: vale o comprado mais recentemente, e o menor preço é o preço bom', () => {
    const links = new LinkIndex([
      { name_key: 'leite', product_id: 'italac' },
      { name_key: 'leite', product_id: 'piracanjuba' },
    ]);
    const estimate = estimateList(
      [item('l', 'Leite', null, 6)],
      [price('italac', 'bom', 5.5, '2026-09-01T12:00:00Z'), price('piracanjuba', 'caro', 4.9, '2026-10-01T12:00:00Z')],
      { links },
    );
    expect(estimate.byItem.get('l')).toMatchObject({ cost: 29.4, unitPrice: 4.9 });
    expect(estimate.byItem.get('l')?.lowest).toEqual({ unitPrice: 4.9, storeId: 'caro' });
  });

  it('prefere o preço na unidade da lista', () => {
    const estimate = estimateList(
      [item('b', 'Banana', 'banana', 1.5, 'kg')],
      [price('banana', 'bom', 0.9, '2026-10-05T12:00:00Z', 'un'), price('banana', 'caro', 6, '2026-09-01T12:00:00Z', 'kg')],
    );
    expect(estimate.byItem.get('b')).toMatchObject({ cost: 9, unit: 'kg', approximateQuantity: false });
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

  it('lista vazia ou sem preços dá zero', () => {
    expect(estimateList([], prices)).toMatchObject({ total: 0, itemCount: 0, pricedCount: 0, stores: [] });
    expect(estimateList([item('a', 'Arroz', 'arroz')], [])).toMatchObject({ total: 0, itemCount: 1, pricedCount: 0 });
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

  it('vencido não é "tem em casa"; soma as entradas e mostra a validade que vence primeiro', () => {
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
    expect(hits.get('b')).toMatchObject({ quantity: null, unit: null });
  });

  it('produto diferente com nome igual não confunde quando os dois têm produto', () => {
    const hits = pantryHits([item('a', 'Arroz', 'arroz-branco')], [stock('Arroz', 'arroz-integral')], { today });
    expect(hits.size).toBe(0);
  });
});

describe('textos da estimativa', () => {
  const estimate: ItemEstimate = {
    cost: 10.98,
    unitPrice: 5.49,
    unit: 'un',
    kind: 'known',
    approximateQuantity: false,
    last: { unitPrice: 5.49, storeId: 'assai', purchasedAt: '2026-10-03T15:00:00Z' },
    lowest: { unitPrice: 4.99, storeId: 'atacadao' },
  };
  const storeName = (id: string) => ({ assai: 'Assaí', atacadao: 'Atacadão', dia: 'Dia' })[id] ?? 'Mercado';

  it('o custo leva ~ quando é estimado ou a quantidade é aproximada', () => {
    expect(formatItemCost(estimate)).toBe('R$ 10,98');
    expect(formatItemCost({ ...estimate, kind: 'estimated' })).toBe('~R$ 10,98');
    expect(formatItemCost({ ...estimate, approximateQuantity: true })).toBe('~R$ 10,98');
  });

  it('diz de onde sai a estimativa', () => {
    expect(describeEstimate({ itemCount: 22, pricedCount: 18, estimatedCount: 0 }, null)).toBe(
      'Pelo último preço que a casa pagou em cada item; 18 de 22 itens têm preço.',
    );
    expect(describeEstimate({ itemCount: 3, pricedCount: 3, estimatedCount: 1 }, 'Assaí')).toBe(
      'Pelos preços do Assaí; todos os itens têm preço, 1 estimado pelo nível de preço de lá.',
    );
    expect(describeEstimate({ itemCount: 9, pricedCount: 7, estimatedCount: 3 }, 'Assaí')).toBe(
      'Pelos preços do Assaí; 7 de 9 itens têm preço, 3 estimados pelo nível de preço de lá.',
    );
  });

  it('os detalhes do item: último preço, preço bom, mercado escolhido e despensa', () => {
    expect(itemFacts(estimate, undefined, { storeName })).toEqual([
      'Último preço: R$ 5,49/un no Assaí, em 3 out.',
      'Menor entre os mercados: R$ 4,99/un no Atacadão.',
    ]);
    expect(
      itemFacts({ ...estimate, kind: 'estimated', unitPrice: 5.2 }, undefined, { storeName, chosenStore: 'dia', promotionOnly: true }),
    ).toEqual([
      'Último preço: R$ 5,49/un no Assaí, em 3 out.',
      'Menor entre os mercados: R$ 4,99/un no Atacadão.',
      'No Dia a casa ainda não comprou este item: cerca de R$ 5,20/un, pelo nível de preço de lá.',
      'Só em promoção: o preço bom é R$ 4,99/un ou menos.',
    ]);
    // Um mercado só: o último preço já é o menor.
    expect(itemFacts({ ...estimate, lowest: { unitPrice: 5.49, storeId: 'assai' } }, undefined, { storeName })).toEqual([
      'Último preço: R$ 5,49/un no Assaí, em 3 out.',
    ]);
    expect(itemFacts({ ...estimate, unit: 'kg', approximateQuantity: true }, undefined, { storeName }).at(-1)).toBe(
      'O preço é por kg: a conta da lista usa 1 kg.',
    );
  });

  it('o que está na despensa', () => {
    expect(
      itemFacts(undefined, { name: 'Leite Integral Italac 1L', quantity: 6, unit: 'un', since: '2026-10-03', expiresOn: '2026-10-20' }, { storeName }),
    ).toEqual(['Na despensa: 6 un de Leite Integral Italac 1L, da compra de 3 out; vence em 20 out.']);
    expect(itemFacts(undefined, { name: 'Banana', quantity: null, unit: null, since: '2026-10-03', expiresOn: null }, { storeName })).toEqual([
      'Na despensa: Banana, da compra de 3 out.',
    ]);
    expect(itemFacts(undefined, undefined, { storeName })).toEqual([]);
  });
});
