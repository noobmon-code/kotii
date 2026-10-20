import { describe, expect, it } from '@jest/globals';

import { pricesByProduct, summarizePrices } from '../prices';

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

describe('g com kg e ml com litro (tela Preços)', () => {
  const row = (product_id: string, store_id: string, unit: string, unit_price: number) => ({ product_id, store_id, unit, unit_price });

  it('o preço por g entra por kg, e os dois mercados se comparam', () => {
    const byProduct = pricesByProduct([row('queijo', 's1', 'g', 0.0399), row('queijo', 's2', 'kg', 42.9), row('leite', 's1', 'ml', 0.0049)]);
    const summary = summarizePrices(byProduct.get('queijo')!);
    expect(summary).toMatchObject({ unit: 'kg', highest: 42.9, storeCount: 2, otherUnits: [] });
    expect(summary?.cheapest).toEqual(row('queijo', 's1', 'kg', 39.9));
    // Nunca "por g" nem "por ml".
    expect(summarizePrices(byProduct.get('leite')!)).toMatchObject({ unit: 'l', highest: 4.9 });
  });

  it('agrupa por produto uma vez só, sem mudar o que já está por kg, litro ou unidade', () => {
    const prices = [row('arroz', 's1', 'un', 24.9), row('arroz', 's2', 'kg', 5.5), row('feijao', 's1', 'l', 8)];
    const byProduct = pricesByProduct(prices);
    expect([...byProduct.keys()]).toEqual(['arroz', 'feijao']);
    expect(byProduct.get('arroz')).toEqual([prices[0], prices[1]]);
    expect(byProduct.get('arroz')![0]).toBe(prices[0]);
  });

  it('kg e unidade continuam separados', () => {
    const summary = summarizePrices(pricesByProduct([row('banana', 's1', 'kg', 6.99), row('banana', 's2', 'g', 0.0075), row('banana', 's3', 'un', 1.2)]).get('banana')!);
    expect(summary).toMatchObject({ unit: 'kg', storeCount: 2, otherUnits: ['un'] });
  });
});
