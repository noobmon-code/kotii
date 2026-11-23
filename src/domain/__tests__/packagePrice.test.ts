import { describe, expect, it } from '@jest/globals';

import { comparablePrice, MAX_WHOLE_PACKAGES, packagesFor, plainSize } from '../packagePrice';
import { packageSize } from '../packageSize';

// O preço do pacote por kg ou litro e os pacotes inteiros de uma quantidade: a base aberta (o item pedido em kg) e,
// depois, a troca de marca usam as mesmas regras.

describe('plainSize', () => {
  it('peso ou volume de um pacote só', () => {
    expect(plainSize(packageSize('ARROZ T1 5KG'))).toEqual({ unit: 'kg', amount: 5, label: '5 kg' });
    expect(plainSize(packageSize('OLEO SOJA 900ML'))).toMatchObject({ unit: 'l', amount: 0.9 });
  });

  it('nem a contagem nem o multipack', () => {
    expect(plainSize(packageSize('OVOS C/12'))).toBeNull();
    expect(plainSize(packageSize('CERV SKOL LT 350ML C/12'))).toBeNull();
    expect(plainSize(null)).toBeNull();
  });
});

describe('comparablePrice', () => {
  it('a granel por kg ou litro; o pacote de peso ou volume pelo tamanho', () => {
    expect(comparablePrice('kg', 39.9, null)).toEqual({ base: 'kg', perBase: 39.9, pack: null, packagePrice: null });
    expect(comparablePrice('g', 0.0499, null)).toEqual({ base: 'kg', perBase: 49.9, pack: null, packagePrice: null });
    expect(comparablePrice('ml', 0.01, null)).toMatchObject({ base: 'l', perBase: 10 });
    expect(comparablePrice('un', 22.9, packageSize('ARROZ 5KG'))).toEqual({
      base: 'kg',
      perBase: 4.58,
      pack: { unit: 'kg', amount: 5, label: '5 kg' },
      packagePrice: 22.9,
    });
    expect(comparablePrice('un', 7.2, packageSize('OLEO 900ML'))).toMatchObject({ base: 'l', perBase: 8 });
  });

  it('sem como comparar: a contagem, o multipack, o "un" sem tamanho, o zero', () => {
    expect(comparablePrice('un', 11.9, packageSize('OVOS C/12'))).toBeNull();
    expect(comparablePrice('un', 39.9, packageSize('CERV 350ML C/12'))).toBeNull();
    expect(comparablePrice('un', 3, null)).toBeNull();
    expect(comparablePrice('kg', 0, null)).toBeNull();
  });
});

describe('packagesFor', () => {
  const kilo = packageSize('ARROZ 1KG')!;
  const five = packageSize('ARROZ 5KG')!;
  const liter = packageSize('LEITE 1L')!;

  it('pacotes inteiros, de 1 a 12 por unidade da lista', () => {
    expect(packagesFor(5, 1, kilo)).toBe(5);
    expect(packagesFor(5, 1, five)).toBe(1);
    expect(packagesFor(12, 1, liter)).toBe(12);
    expect(packagesFor(1, 12, liter)).toBe(12);
    expect(packagesFor(0.5, 1, packageSize('ARROZ 500G')!)).toBe(1);
  });

  it('o que não fecha: um pacote maior que a unidade, uma fração, mais de 12', () => {
    expect(packagesFor(1, 1, five)).toBeNull();
    expect(packagesFor(5, 1, packageSize('ARROZ 2KG')!)).toBeNull();
    expect(packagesFor(MAX_WHOLE_PACKAGES + 1, 1, liter)).toBeNull();
    expect(packagesFor(0, 1, liter)).toBeNull();
  });
});
