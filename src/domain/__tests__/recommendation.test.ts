import { describe, expect, it } from '@jest/globals';
import { recommendStores, type ListItemInput, type PriceInput, type StorePriceAnswer } from '../recommendation';

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
