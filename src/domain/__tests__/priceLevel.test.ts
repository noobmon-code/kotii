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
