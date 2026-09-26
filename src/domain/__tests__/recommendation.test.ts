import { describe, expect, it } from '@jest/globals';
import { recommendStores, type ListItemInput, type PriceInput } from '../recommendation';

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
    // average(cafe) = 15, index(caro) = 24/22
    expect(cafeAtCaro.cost).toBeCloseTo(15 * (24 / 22), 2);
    expect(rec.storeIndex.get('bom')).toBeCloseTo(20 / 22, 5);
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

  it('returns no plans when nothing has a price', () => {
    const rec = recommendStores([item('a', 'arroz')], [], 2);
    expect(rec.plans).toEqual([]);
    expect(rec.unpricedKeys).toEqual(['a']);
  });
});
