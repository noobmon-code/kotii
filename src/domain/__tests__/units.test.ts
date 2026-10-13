import { describe, expect, it } from '@jest/globals';

import { convertQuantity, priceQuantity, sameDimension } from '../units';

describe('unidades', () => {
  it('converte exato dentro da mesma grandeza', () => {
    expect(convertQuantity(200, 'g', 'kg')).toBe(0.2);
    expect(convertQuantity(1.5, 'kg', 'g')).toBe(1500);
    expect(convertQuantity(500, 'ml', 'l')).toBe(0.5);
    expect(convertQuantity(2, 'l', 'ml')).toBe(2000);
    expect(convertQuantity(3, 'un', 'un')).toBe(3);
  });

  it('unidade não vira peso nem volume, e peso não vira volume', () => {
    expect(convertQuantity(3, 'un', 'kg')).toBeNull();
    expect(convertQuantity(500, 'ml', 'un')).toBeNull();
    expect(convertQuantity(1, 'kg', 'l')).toBeNull();
    expect(convertQuantity(1, 'cx', 'un')).toBeNull();
    expect(sameDimension('g', 'kg')).toBe(true);
    expect(sameDimension('un', 'kg')).toBe(false);
  });

  it('quantas unidades do preço a lista pede: exato quando converte, 1 quando não', () => {
    expect(priceQuantity(200, 'g', 'kg')).toEqual({ quantity: 0.2, approximate: false });
    expect(priceQuantity(2, 'un', 'un')).toEqual({ quantity: 2, approximate: false });
    // 500 ml com preço por unidade: nunca 500 x o preço.
    expect(priceQuantity(500, 'ml', 'un')).toEqual({ quantity: 1, approximate: true });
    expect(priceQuantity(6, 'un', 'kg')).toEqual({ quantity: 1, approximate: true });
  });

  it('sem conversão, a conta é de 1 kg, 1 litro ou 1 unidade: preço por g ou por ml nunca vira 1 g ou 1 ml', () => {
    // 1000 x o preço por g é o preço de 1 kg.
    expect(priceQuantity(3, 'un', 'g')).toEqual({ quantity: 1000, approximate: true });
    expect(priceQuantity(1, 'un', 'ml')).toEqual({ quantity: 1000, approximate: true });
    expect(priceQuantity(2, 'l', 'g')).toEqual({ quantity: 1000, approximate: true });
    expect(priceQuantity(3, 'un', 'l')).toEqual({ quantity: 1, approximate: true });
    expect(priceQuantity(2, 'kg', 'cx')).toEqual({ quantity: 1, approximate: true });
  });
});
