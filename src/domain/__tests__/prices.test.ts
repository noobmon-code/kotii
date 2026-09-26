import { describe, expect, it } from '@jest/globals';

import { summarizePrices } from '../prices';

const p = (store_id: string, unit: string, unit_price: number) => ({ store_id, unit, unit_price });

describe('summarizePrices', () => {
  it('compares only prices in the same unit', () => {
    const summary = summarizePrices([p('s1', 'kg', 5.99), p('s2', 'kg', 6.49), p('s3', 'un', 2)]);
    expect(summary?.unit).toBe('kg');
    expect(summary?.cheapest.store_id).toBe('s1');
    expect(summary?.highest).toBe(6.49);
    expect(summary?.storeCount).toBe(2);
    expect(summary?.otherUnits).toEqual(['un']);
  });

  it('breaks ties by unit order and handles a single price', () => {
    expect(summarizePrices([p('s1', 'kg', 5), p('s2', 'un', 2)])?.unit).toBe('un');
    expect(summarizePrices([p('s1', 'l', 4)])).toMatchObject({ unit: 'l', highest: 4, storeCount: 1, otherUnits: [] });
    expect(summarizePrices([])).toBeNull();
  });
});
