import { describe, expect, it } from '@jest/globals';

import {
  CHOSEN_STORE_MS,
  currentStoreChoice,
  describeEstimate,
  describePantryHits,
  estimateHeadline,
  estimateList,
  formatItemCost,
  itemFacts,
  pantryHits,
  resolveListProducts,
  type EstimateItem,
  type EstimatePrice,
  type ItemEstimate,
  type PantryStock,
} from '../listEstimate';
import { LinkIndex } from '../listLinks';
import { storePriceIndex } from '../priceLevel';
import type { PurchaseRecord } from '../recentPurchases';
import { recommendStores } from '../recommendation';
import { restockSuggestions } from '../restock';

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
    expect(estimate.byItem.get('q')).toMatchObject({ cost: 14.97, unit: 'g', approximateQuantity: false });
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

  it('lista vazia ou sem preços dá zero', () => {
    expect(estimateList([], prices)).toMatchObject({ total: 0, itemCount: 0, pricedCount: 0, stores: [] });
    expect(estimateList([item('a', 'Arroz', 'arroz')], [])).toMatchObject({ total: 0, itemCount: 1, pricedCount: 0 });
  });
});

describe('resolveListProducts', () => {
  it('um produto por item: o do item, o das ligações ou o de mesmo nome; sem preço, nenhum', () => {
    const links = new LinkIndex([
      { name_key: 'refrigerante', product_id: 'coca' },
      { name_key: 'leite', product_id: 'italac' },
    ]);
    const resolved = resolveListProducts(
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
    expect([...resolved]).toEqual([
      ['a', 'arroz'],
      ['r', 'coca'],
      ['l', 'italac'],
      ['p', 'pao'],
    ]);
  });
});

describe('a lista e "Onde comprar" dão o mesmo total', () => {
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
    const resolved = resolveListProducts(pending, quotes, { links, products });
    const recommendation = recommendStores(
      pending.map((i) => ({ key: i.id, productId: resolved.get(i.id) ?? i.productId, quantity: i.quantity, unit: i.unit })),
      quotes,
      1,
      { storeIndex: storePriceIndex(quotes) },
    );
    expect(recommendation.unpricedKeys).toEqual(['x']);
    for (const storeId of ['assai', 'dia']) {
      const estimate = estimateList(list, quotes, { links, products, storeId });
      const plan = recommendation.plans.find((p) => p.storeIds[0] === storeId)!;
      expect(plan.total).toBe(estimate.pendingTotal);
      expect(plan.estimatedCount).toBe(pending.filter((i) => estimate.byItem.get(i.id)?.kind === 'estimated').length);
    }
    // E não é um total trivial: há item de nota, item estimado e item convertido.
    expect(estimateList(list, quotes, { links, products, storeId: 'assai' })).toMatchObject({ pricedCount: 6, estimatedCount: 2 });
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
      { name: 'Café Pilão 500g', productId: 'pilao' },
      { name: 'Arroz', productId: null },
    ];
    expect([...pantryHits(list, pantry, { links, today, ranOut }).keys()]).toEqual(['o']);
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
    const ranOut = restockSuggestions(['2026-09-08', '2026-09-18', '2026-09-28'].map(bought), {
      now: new Date(`${today}T23:59:59.999`),
      listKind: 'mercado',
      limit: Number.POSITIVE_INFINITY,
    });
    expect(ranOut.map((r) => r.name)).toEqual(['Café Pilão 500g']);
    const pantry = [stock('Café Pilão 500g', 'pilao', { purchased_on: '2026-09-28', expires_on: '2027-03-27' })];
    expect(pantryHits([item('c', 'Café Pilão 500g', 'pilao')], pantry, { today }).size).toBe(1);
    expect(pantryHits([item('c', 'Café Pilão 500g', 'pilao')], pantry, { today, ranOut }).size).toBe(0);
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
