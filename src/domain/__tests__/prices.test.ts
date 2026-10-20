import { describe, expect, it } from '@jest/globals';

import { pricesByProduct, summarizePrices } from '../prices';
import { cheaperSharedPrice, type SharedPriceRow } from '../sharedPrices';

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
  const row = (product_id: string, store_id: string, unit: string, unit_price: number, purchased_at = '2026-10-01T12:00:00-03:00') => ({
    product_id,
    store_id,
    unit,
    unit_price,
    purchased_at,
  });

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

  // latest_prices guarda um preço por mercado e unidade do banco: o queijo lançado por g há um ano e por kg hoje,
  // no mesmo mercado, viraria dois preços por kg.
  const oldGrams = row('queijo', 'assai', 'g', 0.0299, '2025-01-10T12:00:00-03:00');
  const newKilo = row('queijo', 'assai', 'kg', 45.9, '2026-10-01T12:00:00-03:00');
  const dia = row('queijo', 'dia', 'kg', 39.9, '2026-09-20T12:00:00-03:00');

  it('o mesmo mercado por g (antigo) e por kg (novo): vale o preço mais recente', () => {
    const own = pricesByProduct([oldGrams, newKilo, dia]).get('queijo')!;
    expect(own).toEqual([newKilo, dia]);
    const summary = summarizePrices(own);
    expect(summary).toMatchObject({ unit: 'kg', highest: 45.9, storeCount: 2, otherUnits: [] });
    expect(summary?.cheapest).toBe(dia);
    // A ordem das linhas não muda nada: o g antigo depois do kg novo também sai.
    expect(pricesByProduct([newKilo, dia, oldGrams]).get('queijo')).toEqual([newKilo, dia]);
  });

  it('o g mais recente que o kg é o que vale, já por kg', () => {
    const recentGrams = row('queijo', 'assai', 'g', 0.0419, '2026-10-15T12:00:00-03:00');
    expect(pricesByProduct([newKilo, recentGrams]).get('queijo')).toEqual([row('queijo', 'assai', 'kg', 41.9, '2026-10-15T12:00:00-03:00')]);
  });

  it('no mesmo momento, o menor dos dois', () => {
    const sameTime = row('queijo', 'assai', 'g', 0.0449, newKilo.purchased_at);
    expect(pricesByProduct([newKilo, sameTime]).get('queijo')).toEqual([row('queijo', 'assai', 'kg', 44.9, newKilo.purchased_at)]);
    expect(pricesByProduct([sameTime, newKilo]).get('queijo')).toEqual([row('queijo', 'assai', 'kg', 44.9, newKilo.purchased_at)]);
  });

  it('o "outra casa viu mais barato" mede contra o preço de hoje, não contra o antigo', () => {
    const seen: SharedPriceRow = { storeCnpj: '1', storeName: 'Super Outro', state: 'SP', mine: false, unit: 'kg', unitPrice: 35, seenOn: '2026-10-10' };
    expect(cheaperSharedPrice(pricesByProduct([oldGrams, newKilo, dia]).get('queijo')!, [seen], 'kg')).toBe(seen);
  });
});
