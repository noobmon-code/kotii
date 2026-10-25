import { describe, expect, it } from '@jest/globals';

import { asksPackCount, packCountOf, packLabel, packLine, perItemLabel, readPackCount } from '../packCount';

const eggs = (raw_description: string, over: Partial<{ unit: string; total_price: number; pack_count: number | null | undefined }> = {}) => ({
  raw_description,
  unit: 'un',
  total_price: 13.99,
  quantity: 1,
  pack_count: null as number | null | undefined,
  ...over,
});

describe('packCountOf', () => {
  it('a descrição da nota diz; sem ela, o nome do produto; sem os dois, a resposta guardada', () => {
    expect(packCountOf(eggs('OVOS BRANCOS C/12'))).toBe(12);
    expect(packCountOf(eggs('OVO VERMELHO 30UN', { pack_count: 20 }))).toBe(30);
    expect(packCountOf(eggs('OVOS RANCHO CAIPIRA'), 'Ovos Rancho Caipira 20un')).toBe(20);
    expect(packCountOf(eggs('OVOS RANCHO CAIPIRA', { pack_count: 10 }))).toBe(10);
    expect(packCountOf(eggs('OVOS RANCHO CAIPIRA'))).toBeNull();
    expect(packCountOf(eggs('OVOS DZ'))).toBe(12);
  });
});

describe('asksPackCount', () => {
  it('ovos em "un", com valor e sem a conta: pergunta', () => {
    expect(asksPackCount(eggs('OVOS RANCHO CAIPIRA'), 'ovos')).toBe(true);
    expect(asksPackCount(eggs('OVO DONINHO CAIPIRA'), 'ovos', 'Ovo Doninho Caipira')).toBe(true);
  });

  it('com a conta, já respondido, sem valor, de outra categoria ou sem a coluna no banco: não pergunta', () => {
    expect(asksPackCount(eggs('OVOS BRANCOS C/12'), 'ovos')).toBe(false);
    expect(asksPackCount(eggs('OVOS RANCHO CAIPIRA', { pack_count: 10 }), 'ovos')).toBe(false);
    expect(asksPackCount(eggs('OVOS RANCHO CAIPIRA', { total_price: 0 }), 'ovos')).toBe(false);
    expect(asksPackCount(eggs('OVOS RANCHO CAIPIRA', { unit: 'kg' }), 'ovos')).toBe(false);
    expect(asksPackCount(eggs('IOGURTE NATURAL'), 'laticinios')).toBe(false);
    // A leitura de antes da migração não traz a coluna: a resposta não teria onde ficar.
    expect(asksPackCount(eggs('OVOS RANCHO CAIPIRA', { pack_count: undefined }), 'ovos')).toBe(false);
  });
});

describe('textos', () => {
  it('ovos se contam em ovos; o resto, em unidades', () => {
    expect(packLabel(10, 'ovos')).toBe('10 ovos');
    expect(packLabel(12, 'laticinios')).toBe('12 un');
    expect(perItemLabel(13.99, 10, 'ovos')).toBe('R$ 1,40 o ovo');
    expect(perItemLabel(9.99, 12, null)).toBe('R$ 0,83 cada');
    expect(packLine({ total_price: 17.98, quantity: 2 }, 10, 'ovos')).toBe('10 ovos na embalagem: R$ 0,90 o ovo');
  });

  it('o número digitado: inteiro de 2 a 1000', () => {
    expect(readPackCount(' 18 ')).toBe(18);
    expect(readPackCount('1')).toBeNull();
    expect(readPackCount('1001')).toBeNull();
    expect(readPackCount('12,5')).toBeNull();
    expect(readPackCount('')).toBeNull();
  });
});
