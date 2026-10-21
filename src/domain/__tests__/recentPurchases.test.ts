import { describe, expect, it } from '@jest/globals';

import { listExclusion, recentPurchases, type PurchaseRecord } from '../recentPurchases';

const NOW = new Date('2026-09-27T15:00:00-03:00');

function rec(partial: Partial<PurchaseRecord> & Pick<PurchaseRecord, 'name' | 'at'>): PurchaseRecord {
  return { category: 'outros', productId: null, quantity: 1, unit: 'un', source: 'list', ...partial };
}

describe('recentPurchases', () => {
  it('junta lista e nota pelo nome e põe o que se compra mais vezes primeiro', () => {
    const items = recentPurchases(
      [
        rec({ name: 'Leite', category: 'laticinios', quantity: 12, at: '2026-09-20T10:00:00-03:00' }),
        rec({ name: 'leite', category: 'laticinios', quantity: 6, source: 'receipt', productId: 'p-leite', at: '2026-09-06T10:00:00-03:00' }),
        rec({ name: 'Banana', category: 'hortifruti', unit: 'kg', at: '2026-09-25T10:00:00-03:00' }),
      ],
      { now: NOW },
    );
    expect(items.map((i) => i.name)).toEqual(['Leite', 'Banana']);
    expect(items[0]).toMatchObject({ times: 2, productId: 'p-leite', quantity: 12, unit: 'un' });
  });

  it('conta uma vez a mesma compra vista na lista e na nota do mesmo dia', () => {
    const [item] = recentPurchases(
      [
        rec({ name: 'Café', at: '2026-09-20T10:00:00-03:00' }),
        rec({ name: 'Café', source: 'receipt', at: '2026-09-20T11:30:00-03:00' }),
      ],
      { now: NOW },
    );
    expect(item.times).toBe(1);
  });

  it('empate: o comprado mais recente vem antes', () => {
    const items = recentPurchases(
      [rec({ name: 'Arroz', at: '2026-09-01T10:00:00-03:00' }), rec({ name: 'Feijão', at: '2026-09-15T10:00:00-03:00' })],
      { now: NOW },
    );
    expect(items.map((i) => i.name)).toEqual(['Feijão', 'Arroz']);
  });

  it('só a nota: quantidade arredondada em jeito de lista', () => {
    const items = recentPurchases(
      [
        rec({ name: 'Banana', unit: 'kg', quantity: 1.234, source: 'receipt', at: '2026-09-20T10:00:00-03:00' }),
        rec({ name: 'Iogurte', quantity: 2.4, source: 'receipt', at: '2026-09-20T10:00:00-03:00' }),
        rec({ name: 'Queijo ralado', unit: 'g', quantity: 212, source: 'receipt', at: '2026-09-20T10:00:00-03:00' }),
      ],
      { now: NOW },
    );
    const byName = Object.fromEntries(items.map((i) => [i.name, [i.quantity, i.unit]]));
    expect(byName).toEqual({ Banana: [1, 'kg'], Iogurte: [2, 'un'], 'Queijo ralado': [200, 'g'] });
  });

  it('deixa de fora o que já está na lista e o que é antigo', () => {
    const items = recentPurchases(
      [
        rec({ name: 'Arroz', at: '2026-09-20T10:00:00-03:00' }),
        rec({ name: 'Leite Italac', productId: 'p1', at: '2026-09-20T10:00:00-03:00' }),
        rec({ name: 'Sabão', at: '2026-05-01T10:00:00-03:00' }),
      ],
      { now: NOW, exclude: { names: new Set(['arroz']), productIds: new Set(['p1']) } },
    );
    expect(items).toEqual([]);
  });

  it('sem marca: as marcas do mesmo item são uma compra só, com o produto da última como dica de preço', () => {
    const items = recentPurchases(
      [
        rec({ name: 'Leite IL Desnatado', category: 'laticinios', productId: 'p-il', source: 'receipt', at: '2026-09-06T10:00:00-03:00' }),
        rec({ name: 'Leite Italac Desnatado 1L', category: 'laticinios', productId: 'p-italac', source: 'receipt', at: '2026-09-20T10:00:00-03:00' }),
        rec({ name: 'Ovo Doninho Caipira', category: 'ovos', productId: 'p-ovo', source: 'receipt', at: '2026-09-13T10:00:00-03:00' }),
        // As três Cocas zero da casa: um item só.
        rec({ name: 'Refrigerante sem Açúcar Coca-Cola Garrafa 1,5l', category: 'bebidas', productId: 'c1', source: 'receipt', at: '2026-09-04T10:00:00-03:00' }),
        rec({ name: 'Coca-Cola Zero 1L', category: 'bebidas', productId: 'c2', source: 'receipt', at: '2026-09-11T10:00:00-03:00' }),
        rec({ name: 'Refrigerante Coca-Cola Zero', category: 'bebidas', productId: 'c3', source: 'receipt', at: '2026-09-18T10:00:00-03:00' }),
        // O leite integral é outro item.
        rec({ name: 'Leite Italac Integral', category: 'laticinios', productId: 'p-int', source: 'receipt', at: '2026-09-21T10:00:00-03:00' }),
      ],
      { now: NOW },
    );
    expect(items.map((i) => [i.name, i.productId, i.times])).toEqual([
      ['Refrigerante Coca-Cola Zero', 'c3', 3],
      ['Leite desnatado', 'p-italac', 2],
      ['Leite integral', 'p-int', 1],
      ['Ovo caipira', 'p-ovo', 1],
    ]);
  });

  it('o que já está na lista com ou sem a marca não é sugerido de novo', () => {
    const records = [
      rec({ name: 'Leite IL Desnatado', category: 'laticinios', productId: 'p-il', source: 'receipt', at: '2026-09-20T10:00:00-03:00' }),
      rec({ name: 'Ovo Doninho Caipira', category: 'ovos', productId: 'p-ovo', source: 'receipt', at: '2026-09-20T10:00:00-03:00' }),
    ];
    const suggested = (listed: { name: string; category: string; product_id: string | null }[]) =>
      recentPurchases(records, { now: NOW, exclude: listExclusion(listed) }).map((i) => i.name);
    // "Leite desnatado" digitado, sem produto: é o mesmo item.
    expect(suggested([{ name: 'Leite desnatado', category: 'laticinios', product_id: null }])).toEqual(['Ovo caipira']);
    // O item antigo, com a marca no nome e outro produto.
    expect(suggested([{ name: 'Ovo Doninho Caipira', category: 'ovos', product_id: null }])).toEqual(['Leite desnatado']);
    // "Leite" não é o desnatado.
    expect(suggested([{ name: 'Leite', category: 'laticinios', product_id: null }]).sort()).toEqual(['Leite desnatado', 'Ovo caipira']);
  });

  it('mostra na farmácia o que é de farmácia, e no mercado o resto', () => {
    const records = [
      rec({ name: 'Dipirona', category: 'medicamentos', at: '2026-09-20T10:00:00-03:00' }),
      rec({ name: 'Fralda', category: 'bebe', at: '2026-09-20T10:00:00-03:00' }),
      rec({ name: 'Arroz', category: 'graos', at: '2026-09-20T10:00:00-03:00' }),
    ];
    const names = (listKind: 'mercado' | 'farmacia' | 'outros') =>
      recentPurchases(records, { now: NOW, listKind }).map((i) => i.name).sort();
    expect(names('farmacia')).toEqual(['Dipirona', 'Fralda']);
    expect(names('mercado')).toEqual(['Arroz', 'Fralda']);
    expect(names('outros')).toEqual(['Arroz', 'Dipirona', 'Fralda']);
  });

  it('respeita o limite', () => {
    const records = Array.from({ length: 20 }, (_, i) => rec({ name: `Item ${i}`, at: '2026-09-20T10:00:00-03:00' }));
    expect(recentPurchases(records, { now: NOW, limit: 5 })).toHaveLength(5);
  });
});
