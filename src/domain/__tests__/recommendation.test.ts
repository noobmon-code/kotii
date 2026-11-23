import { describe, expect, it } from '@jest/globals';
import { listSharedElsewhere } from '../listEstimate';
import {
  recommendStores,
  SHARED_ONLY_TITLE,
  sharedOffersIntro,
  sharedOnlyFooter,
  sharedStoreOffers,
  unpricedFooter,
  WHERE_TO_BUY_EMPTY,
  WHERE_TO_BUY_SHARED_ONLY,
  type ListItemInput,
  type PriceInput,
  type StorePriceAnswer,
} from '../recommendation';
import type { SharedQuote } from '../sharedPrices';

const item = (key: string, productId: string | null, quantity = 1, unit = 'un'): ListItemInput => ({
  key,
  productId,
  quantity,
  unit,
});
const price = (productId: string, storeId: string, unitPrice: number, unit = 'un'): PriceInput => ({
  productId,
  storeId,
  unitPrice,
  unit,
});

describe('recommendStores', () => {
  it('picks the cheapest single store when every item has prices everywhere', () => {
    const rec = recommendStores(
      [item('a', 'arroz', 2), item('f', 'feijao')],
      [price('arroz', 'bom', 25), price('arroz', 'caro', 28), price('feijao', 'bom', 8), price('feijao', 'caro', 9)],
      1,
    );
    expect(rec.plans.map((p) => p.storeIds)).toEqual([['bom'], ['caro']]);
    expect(rec.plans[0]).toMatchObject({ total: 58, knownCount: 2, estimatedCount: 0 });
    expect(rec.plans[1].total).toBe(65);
  });

  it('estimates missing prices with the store price index instead of ignoring them', () => {
    // "caro" is ~10% above average on shared items; its missing item must not
    // make it look cheaper than "bom".
    const rec = recommendStores(
      [item('a', 'arroz'), item('c', 'cafe')],
      [price('arroz', 'bom', 20), price('arroz', 'caro', 24), price('cafe', 'bom', 15)],
      1,
    );
    const [best, second] = rec.plans;
    expect(best.storeIds).toEqual(['bom']);
    expect(second.storeIds).toEqual(['caro']);
    const cafeAtCaro = second.assignments.find((a) => a.itemKey === 'c')!;
    expect(cafeAtCaro.kind).toBe('estimated');
    // average(cafe) = 15; with a single shared product the index is pulled towards the average:
    // index(caro) = (24/22 + 2) / 3
    expect(cafeAtCaro.cost).toBeCloseTo(15 * ((24 / 22 + 2) / 3), 2);
    expect(rec.storeIndex.get('bom')).toBeCloseTo((20 / 22 + 2) / 3, 5);
  });

  it('uses a precomputed store price index when given one', () => {
    const rec = recommendStores(
      [item('a', 'arroz'), item('c', 'cafe')],
      [price('arroz', 'bom', 20), price('arroz', 'caro', 24), price('cafe', 'bom', 15)],
      1,
      { storeIndex: new Map([['bom', 0.8], ['caro', 1.2]]) },
    );
    const cafeAtCaro = rec.plans[1].assignments.find((a) => a.itemKey === 'c')!;
    expect(cafeAtCaro).toMatchObject({ kind: 'estimated', cost: 18 });
    expect(rec.storeIndex.get('caro')).toBe(1.2);
  });

  it('with priceAt, takes the price the caller resolved for each item in each store', () => {
    const answer = (cost: number, kind: StorePriceAnswer['kind'], approximateQuantity = false): StorePriceAnswer => ({ cost, kind, approximateQuantity });
    const answers: Record<string, Record<string, StorePriceAnswer>> = {
      a: { x: answer(20, 'known'), y: answer(22, 'estimated'), z: answer(25, 'estimated') },
      b: { x: answer(9, 'estimated', true), y: answer(6, 'known', true), z: answer(7, 'estimated', true) },
    };
    const rec = recommendStores(
      [item('a', null), item('b', 'outro'), item('c', 'arroz')],
      [price('arroz', 'x', 1), price('arroz', 'y', 1), price('arroz', 'z', 1)],
      2,
      { priceAt: (itemKey, storeId) => answers[itemKey]?.[storeId] ?? null },
    );
    // "c" has no answer: out of the totals, whatever its productId says. "z" has no receipt price for any item: not ranked.
    expect(rec.unpricedKeys).toEqual(['c']);
    expect(rec.plans.map((p) => [p.storeIds, p.total, p.knownCount, p.estimatedCount])).toEqual([
      [['x', 'y'], 26, 2, 0],
      [['y'], 28, 1, 1],
      [['x'], 29, 1, 1],
    ]);
    expect(rec.plans[1].assignments).toEqual([
      { itemKey: 'a', storeId: 'y', cost: 22, kind: 'estimated', approximateQuantity: false },
      { itemKey: 'b', storeId: 'y', cost: 6, kind: 'known', approximateQuantity: true },
    ]);
    expect([...rec.storeIndex.keys()]).toEqual(['x', 'y']);
  });

  it('with priceAt, an item the caller cannot price in every store stays out of the totals', () => {
    const known: StorePriceAnswer = { cost: 10, kind: 'known', approximateQuantity: false };
    const rec = recommendStores([item('a', null), item('b', null)], [price('arroz', 'x', 1), price('arroz', 'y', 1)], 2, {
      priceAt: (itemKey, storeId) => (itemKey === 'b' && storeId === 'y' ? null : known),
    });
    // "b" has no answer at "y": a total with it at "x" only would not compare with the total at "y".
    expect(rec.unpricedKeys).toEqual(['b']);
    expect(rec.plans.map((p) => [p.storeIds, p.total])).toEqual([
      [['x'], 10],
      [['y'], 10],
    ]);
  });

  it('splits between stores only when allowed and it actually saves money', () => {
    const items = [item('a', 'arroz'), item('l', 'leite', 6)];
    const prices = [
      price('arroz', 'x', 20),
      price('arroz', 'y', 26),
      price('leite', 'x', 5),
      price('leite', 'y', 4.2),
    ];
    const single = recommendStores(items, prices, 1);
    expect(single.plans.map((p) => [p.storeIds, p.total])).toEqual([
      [['x'], 50],
      [['y'], 51.2],
    ]);

    const split = recommendStores(items, prices, 2);
    expect(split.plans[0]).toMatchObject({ storeIds: ['x', 'y'], total: 45.2 });
    const byItem = Object.fromEntries(split.plans[0].assignments.map((a) => [a.itemKey, a.storeId]));
    expect(byItem).toEqual({ a: 'x', l: 'y' });
  });

  it('drops combinations where a store would get no items', () => {
    const rec = recommendStores(
      [item('a', 'arroz')],
      [price('arroz', 'x', 20), price('arroz', 'y', 22), price('arroz', 'z', 30)],
      3,
    );
    expect(rec.plans.every((p) => p.storeIds.length === 1)).toBe(true);
  });

  it('reports items without any price and keeps them out of totals', () => {
    const rec = recommendStores(
      [item('a', 'arroz'), item('x', null), item('y', 'sem-preco')],
      [price('arroz', 'bom', 10)],
      1,
    );
    expect(rec.unpricedKeys).toEqual(['x', 'y']);
    expect(rec.plans).toHaveLength(1);
    expect(rec.plans[0].total).toBe(10);
  });

  it('compares in the unit with most stores and flags quantity mismatch', () => {
    const rec = recommendStores(
      [item('b', 'banana', 3, 'un')],
      [price('banana', 'x', 6.5, 'kg'), price('banana', 'y', 5.9, 'kg'), price('banana', 'z', 1.2, 'un')],
      1,
    );
    expect(rec.plans.map((p) => p.storeIds[0])).toEqual(['y', 'x']);
    expect(rec.plans[0].assignments[0]).toMatchObject({ cost: 5.9, approximateQuantity: true });
  });

  it('counts one kg (or one litre), never one gram, when the list unit does not convert to a price per g or per ml', () => {
    const rec = recommendStores(
      [item('q', 'queijo', 3, 'un'), item('s', 'suco', 2, 'un')],
      [price('queijo', 'x', 0.0599, 'g'), price('queijo', 'y', 0.0499, 'g'), price('suco', 'x', 0.008, 'ml'), price('suco', 'y', 0.012, 'ml')],
      1,
    );
    // 1 kg of cheese and 1 l of juice in each store: x = 59.90 + 8.00, y = 49.90 + 12.00.
    expect(rec.plans.map((p) => [p.storeIds[0], p.total])).toEqual([
      ['y', 61.9],
      ['x', 67.9],
    ]);
    expect(rec.plans[0].assignments.every((a) => a.approximateQuantity)).toBe(true);
  });

  it('converts g to kg and ml to l exactly', () => {
    const rec = recommendStores(
      [item('p', 'presunto', 200, 'g'), item('s', 'suco', 500, 'ml')],
      [price('presunto', 'x', 59.9, 'kg'), price('presunto', 'y', 64.9, 'kg'), price('suco', 'x', 12, 'l'), price('suco', 'y', 12, 'l')],
      1,
    );
    expect(rec.plans.map((p) => [p.storeIds[0], p.total])).toEqual([
      ['x', 17.98],
      ['y', 18.98],
    ]);
    expect(rec.plans[0].assignments.every((a) => !a.approximateQuantity)).toBe(true);
  });

  it('on a tie between units, prefers the one that converts to the list unit', () => {
    const rec = recommendStores([item('p', 'presunto', 200, 'g')], [price('presunto', 'b', 4.99, 'un'), price('presunto', 'a', 59.9, 'kg')], 1);
    expect(rec.plans[0].storeIds).toEqual(['a']);
    expect(rec.plans[0].assignments[0]).toMatchObject({ cost: 11.98, kind: 'known', approximateQuantity: false });
  });

  it('ignores zero prices (a free line on a receipt is not a price)', () => {
    const rec = recommendStores([item('a', 'arroz'), item('b', 'brinde')], [price('arroz', 'x', 0), price('arroz', 'y', 20), price('brinde', 'x', 0)], 1);
    expect(rec.plans.map((p) => [p.storeIds[0], p.total])).toEqual([['y', 20]]);
    expect(rec.unpricedKeys).toEqual(['b']);
  });

  it('returns no plans when nothing has a price', () => {
    const rec = recommendStores([item('a', 'arroz')], [], 2);
    expect(rec.plans).toEqual([]);
    expect(rec.unpricedKeys).toEqual(['a']);
  });
});

describe('"Onde comprar" só com preços de outras casas', () => {
  const quote = (storeCnpj: string, unitPrice: number): SharedQuote => ({
    productId: null,
    storeId: null,
    storeCnpj,
    storeName: 'ATACADAO S.A.',
    state: 'SP',
    mine: false,
    unit: 'un',
    unitPrice,
    seenWeek: '2026-11-09',
    pack: null,
    open: { size: null, sizeBy: null, fromPackage: null, packages: null },
  });

  it('os mercados de fora vêm também sem plano (a casa sem preço nenhum): os preços da base aberta, sem comparação', () => {
    const elsewhere = listSharedElsewhere(
      [{ id: 'a', name: 'Arroz', productId: null, quantity: 1, unit: 'un' }],
      [],
      { open: new Map([['a', [quote('11222333000181', 22.9), quote('99888777000166', 21.5)]]]) },
    );
    const offers = sharedStoreOffers(elsewhere, undefined);
    expect(offers.map((offer) => [offer.storeCnpj, offer.total, offer.planTotal])).toEqual([
      ['99888777000166', 21.5, null],
      ['11222333000181', 22.9, null],
    ]);
  });

  it('os textos com e sem plano', () => {
    expect(WHERE_TO_BUY_EMPTY).toEqual({
      title: 'Ainda sem preços para comparar',
      message: 'Importe notas fiscais das suas compras. Itens da lista escolhidos pela sugestão de produto passam a ter preço por mercado.',
    });
    expect(WHERE_TO_BUY_SHARED_ONLY).toEqual({
      title: 'Só há preços de outras casas',
      message:
        'A casa ainda não tem nota destes itens para comparar os mercados. Abaixo estão os preços que outras casas viram para eles nos mercados do seu estado. Com as notas das suas compras, o app monta a comparação.',
    });
    expect(SHARED_ONLY_TITLE).toBe('Só com preço de outras casas');
    expect(sharedOffersIntro(true)).toBe(
      'Mercados onde outras casas viram itens desta lista. Ficam fora da comparação acima: a casa não tem preço do resto da lista lá.',
    );
    expect(sharedOffersIntro(false)).toBe('Mercados onde outras casas viram itens desta lista.');
    expect(sharedOnlyFooter(true)).toBe('A casa ainda não comprou esses itens: ficam fora da comparação e dos totais acima.');
    expect(sharedOnlyFooter(false)).toBe('A casa ainda não comprou esses itens: cada um aparece com o preço visto por último em outra casa.');
    expect(unpricedFooter(true)).toBe('Esses itens ficam fora dos totais.');
    expect(unpricedFooter(false)).toBe('Esses itens ainda não têm preço.');
  });
});
