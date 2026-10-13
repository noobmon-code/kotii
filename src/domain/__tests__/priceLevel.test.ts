import { describe, expect, it } from '@jest/globals';

import { storePriceIndex, type LevelPrice } from '../priceLevel';

const price = (productId: string, storeId: string, unitPrice: number, unit = 'un'): LevelPrice => ({ productId, storeId, unitPrice, unit });

describe('storePriceIndex', () => {
  it('compara os mercados só nos produtos que os dois têm, puxando para a média quando são poucos', () => {
    const index = storePriceIndex([price('arroz', 'bom', 20), price('arroz', 'caro', 24), price('cafe', 'bom', 15), price('pao', 'solto', 8)]);
    // Arroz: média 22 -> bom 0,909, caro 1,091. Um produto em comum pesa 1 em 3: (razão + 2) / 3.
    // O café (só no bom) não diz nada sobre o mercado.
    expect(index.get('bom')).toBeCloseTo((20 / 22 + 2) / 3, 5);
    expect(index.get('caro')).toBeCloseTo((24 / 22 + 2) / 3, 5);
    // Mercado sem produto em comum com outro fica na média.
    expect(index.get('solto')).toBe(1);
  });

  it('com mais produtos em comum, o nível chega perto da razão', () => {
    const products = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const index = storePriceIndex(products.flatMap((id) => [price(id, 'bom', 9), price(id, 'caro', 11)]));
    expect(index.get('bom')).toBeCloseTo((8 * 0.9 + 2) / 10, 5);
    expect(index.get('caro')).toBeCloseTo((8 * 1.1 + 2) / 10, 5);
  });

  it('preço em unidade diferente não entra na mesma conta', () => {
    const index = storePriceIndex([price('banana', 'bom', 6, 'kg'), price('banana', 'caro', 2, 'un')]);
    expect(index.get('bom')).toBe(1);
    expect(index.get('caro')).toBe(1);
  });

  it('o mesmo produto por kg num mercado e por g no outro (ou litro e ml) entra na mesma conta, convertido', () => {
    const index = storePriceIndex([
      price('banana', 'bom', 6, 'kg'),
      price('banana', 'caro', 0.0072, 'g'),
      price('suco', 'bom', 0.008, 'ml'),
      price('suco', 'caro', 9.6, 'l'),
    ]);
    // Banana: R$ 6,00 e R$ 7,20 por kg (média 6,60). Suco: R$ 8,00 e R$ 9,60 por litro (média 8,80).
    expect(index.get('bom')).toBeCloseTo((2 * (6 / 6.6) + 2) / 4, 5);
    expect(index.get('caro')).toBeCloseTo((2 * (7.2 / 6.6) + 2) / 4, 5);
    // Peso e volume não se misturam, nem com "un".
    const apart = storePriceIndex([price('x', 'bom', 6, 'kg'), price('x', 'caro', 9, 'l'), price('x', 'outro', 2, 'un')]);
    expect([apart.get('bom'), apart.get('caro'), apart.get('outro')]).toEqual([1, 1, 1]);
  });

  it('um mercado com o mesmo produto por kg e por g entra uma vez só: com o preço mais novo ou, sem data, com a média dele', () => {
    const dated = (storeId: string, unitPrice: number, unit: string, purchasedAt: string): LevelPrice => ({ ...price('queijo', storeId, unitPrice, unit), purchasedAt });
    // Os dois mercados cobram R$ 40,00/kg hoje; a linha por g do "a" é de uma nota antiga (R$ 20,00/kg).
    const rows = [
      dated('a', 40, 'kg', '2026-10-01T12:00:00Z'),
      dated('a', 0.02, 'g', '2026-06-01T12:00:00Z'),
      dated('b', 40, 'kg', '2026-09-20T12:00:00Z'),
    ];
    for (const order of [rows, [...rows].reverse()]) {
      const index = storePriceIndex(order);
      expect([index.get('a'), index.get('b')]).toEqual([1, 1]);
    }
    // A linha por g é a mais nova: aí é ela o preço do "a" (R$ 20,00/kg contra R$ 40,00/kg do "b"; média 30).
    const newer = storePriceIndex([rows[0], dated('a', 0.02, 'g', '2026-10-05T12:00:00Z'), rows[2]]);
    expect(newer.get('a')).toBeCloseTo((20 / 30 + 2) / 3, 5);
    expect(newer.get('b')).toBeCloseTo((40 / 30 + 2) / 3, 5);
    // Sem data não dá para saber qual é o mais novo: a média do mercado (30), um voto por mercado (média 35).
    const undated = storePriceIndex([price('queijo', 'a', 40, 'kg'), price('queijo', 'a', 0.02, 'g'), price('queijo', 'b', 40, 'kg')]);
    expect(undated.get('a')).toBeCloseTo((30 / 35 + 2) / 3, 5);
    expect(undated.get('b')).toBeCloseTo((40 / 35 + 2) / 3, 5);
    // Duas linhas do mesmo mercado não fazem dois mercados: produto de um mercado só não diz nada.
    const alone = storePriceIndex([price('queijo', 'a', 40, 'kg'), price('queijo', 'a', 0.02, 'g')]);
    expect(alone.get('a')).toBe(1);
  });

  it('preço zerado (brinde na nota) não entra: não zera o nível de ninguém', () => {
    const index = storePriceIndex([price('brinde', 'bom', 0), price('brinde', 'caro', 4), price('arroz', 'caro', 20)]);
    expect(index.get('bom')).toBeUndefined();
    expect(index.get('caro')).toBe(1);
  });

  it('o nível fica numa faixa plausível mesmo com preços disparatados', () => {
    const products = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const index = storePriceIndex(products.flatMap((id) => [price(id, 'barato', 1), price(id, 'absurdo', 99)]));
    expect(index.get('barato')).toBe(0.6);
    expect(index.get('absurdo')).toBe(1.6);
  });
});
