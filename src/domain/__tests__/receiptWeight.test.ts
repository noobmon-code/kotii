import { describe, expect, it } from '@jest/globals';

import { asksWeight, readWeight, weighedLine, weightQuestion } from '../receiptWeight';

const line = (raw_description: string, over: Partial<{ unit: string; total_price: number; quantity: number }> = {}) => ({
  raw_description,
  unit: 'un',
  total_price: 22.99,
  quantity: 1,
  ...over,
});

describe('asksWeight', () => {
  it('queijo, frios, carne e peixe em "un", com valor e sem tamanho: pode ter sido pesado', () => {
    expect(asksWeight(line('QUEIJO parmesão'), 'laticinios')).toBe(true);
    expect(asksWeight(line('MUSSARELA FATIADA'), 'laticinios')).toBe(true);
    expect(asksWeight(line('PRESUNTO COZIDO'), 'frios')).toBe(true);
    expect(asksWeight(line('PATINHO BIFE'), 'carnes')).toBe(true);
    expect(asksWeight(line('FILE DE TILAPIA'), 'peixes')).toBe(true);
    // O nome do produto escolhido também diz que é queijo.
    expect(asksWeight(line('PRESIDENT PARM'), 'laticinios', 'Queijo parmesão President')).toBe(true);
  });

  it('o resto dos laticínios vem em embalagem: não pergunta', () => {
    expect(asksWeight(line('REQUEIJÃO CATUPIRY'), 'laticinios')).toBe(false);
    expect(asksWeight(line('PRESIDENT MANTEIGA'), 'laticinios')).toBe(false);
    expect(asksWeight(line('LEITE IL DESNATADO'), 'laticinios')).toBe(false);
    expect(asksWeight(line('CREAM CHEESE'), 'laticinios')).toBe(false);
  });

  it('com tamanho de embalagem, já por kg, sem valor ou de outra categoria: não pergunta', () => {
    expect(asksWeight(line('QUEIJO RALADO 50G'), 'laticinios')).toBe(false);
    expect(asksWeight(line('HAMBURGUER'), 'carnes', 'Hambúrguer Seara 672g')).toBe(false);
    expect(asksWeight(line('QJ MUSS IFAT KG', { unit: 'kg' }), 'laticinios')).toBe(false);
    expect(asksWeight(line('QUEIJO parmesão', { total_price: 0 }), 'laticinios')).toBe(false);
    expect(asksWeight(line('BANANA PRATA'), 'hortifruti')).toBe(false);
    // O pacote com a contagem também é embalagem.
    expect(asksWeight(line('SALSICHA 6UN'), 'frios')).toBe(false);
  });

  it('o tamanho colado a um ponto depois de letra é embalagem: "PTO.PERU SADIA.200G" não pergunta o peso', () => {
    expect(asksWeight(line('PTO.PERU SADIA.200G'), 'frios')).toBe(false);
  });
});

describe('readWeight', () => {
  it('o peso da etiqueta em kg, com vírgula ou ponto; gramas com "g" ou como número inteiro grande', () => {
    expect(readWeight('0,186')).toBe(0.186);
    expect(readWeight(' 0.186 ')).toBe(0.186);
    expect(readWeight('1,2 kg')).toBe(1.2);
    expect(readWeight('186 g')).toBe(0.186);
    expect(readWeight('186g')).toBe(0.186);
    expect(readWeight('186')).toBe(0.186);
    expect(readWeight('2')).toBe(2);
  });

  it('o que não dá para ler, zero ou mais de 20 kg: null', () => {
    expect(readWeight('')).toBeNull();
    expect(readWeight('abc')).toBeNull();
    expect(readWeight('0')).toBeNull();
    expect(readWeight('0,0004')).toBeNull();
    expect(readWeight('25,5')).toBeNull();
    expect(readWeight('186 ml')).toBeNull();
  });
});

describe('weighedLine', () => {
  it('o valor da nota fica; o peso é a quantidade e o preço é o valor sobre o peso', () => {
    expect(weighedLine({ total_price: 22.99 }, 0.186)).toEqual({ quantity: 0.186, unit: 'kg', unit_price: 123.6022, total_price: 22.99 });
  });

  it('mais de uma peça pesa ao todo', () => {
    expect(weightQuestion({ quantity: 1 })).toContain('quanto pesou (');
    expect(weightQuestion({ quantity: 2 })).toContain('quanto pesou ao todo');
  });
});
