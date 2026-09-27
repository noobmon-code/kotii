import { describe, expect, it } from '@jest/globals';

import type { PurchaseRecord } from '../recentPurchases';
import { describeRestock, restockSuggestions } from '../restock';

const NOW = new Date('2026-09-27T15:00:00-03:00');

function rec(name: string, day: string, partial: Partial<PurchaseRecord> = {}): PurchaseRecord {
  return { name, at: `${day}T10:00:00-03:00`, category: 'mercearia', productId: null, quantity: 1, unit: 'un', source: 'list', ...partial };
}

describe('restockSuggestions', () => {
  it('sugere o que passou do intervalo de costume, o mais atrasado primeiro', () => {
    const items = restockSuggestions(
      [
        // Café a cada 10 dias, última há 12.
        rec('Café', '2026-08-26'),
        rec('Café', '2026-09-05'),
        rec('Café', '2026-09-15'),
        // Leite a cada 7 dias, última há 10.
        rec('Leite', '2026-09-03', { category: 'laticinios' }),
        rec('Leite', '2026-09-10', { category: 'laticinios' }),
        rec('Leite', '2026-09-17', { category: 'laticinios', quantity: 12 }),
        // Arroz a cada 30 dias, última há 5: ainda tem.
        rec('Arroz', '2026-07-24'),
        rec('Arroz', '2026-08-23'),
        rec('Arroz', '2026-09-22'),
      ],
      { now: NOW },
    );
    expect(items.map((i) => [i.name, i.everyDays, i.daysSince])).toEqual([
      ['Leite', 7, 10],
      ['Café', 10, 12],
    ]);
    expect(items[0].quantity).toBe(12);
  });

  it('precisa de três idas ao mercado; lista e nota do mesmo dia (ou do dia seguinte) são uma ida só', () => {
    const items = restockSuggestions(
      [
        rec('Café', '2026-09-01'),
        rec('Café', '2026-09-02', { source: 'receipt' }),
        rec('Café', '2026-09-11'),
        rec('Café', '2026-09-11', { source: 'receipt' }),
      ],
      { now: NOW },
    );
    expect(items).toEqual([]);
  });

  it('usa a mediana dos intervalos entre idas', () => {
    const [item] = restockSuggestions(
      [rec('Pão', '2026-09-01'), rec('Pão', '2026-09-08'), rec('Pão', '2026-09-10'), rec('Pão', '2026-09-17')],
      { now: NOW },
    );
    // Idas em 01, 08 e 17 (o dia 10 conta junto com o 08): intervalos 7 e 9, mediana 8.
    expect(item).toMatchObject({ name: 'Pão', everyDays: 8, daysSince: 10 });
  });

  it('para de sugerir o que a casa deixou de comprar', () => {
    const items = restockSuggestions(
      [rec('Refrigerante', '2026-06-01'), rec('Refrigerante', '2026-06-08'), rec('Refrigerante', '2026-06-15')],
      { now: NOW },
    );
    expect(items).toEqual([]);
  });

  it('deixa de fora o que já está na lista e o que não é da lista (farmácia)', () => {
    const records = [
      ...['2026-08-26', '2026-09-05', '2026-09-15'].map((d) => rec('Café', d, { productId: 'p-cafe' })),
      ...['2026-08-26', '2026-09-05', '2026-09-15'].map((d) => rec('Dipirona', d, { category: 'medicamentos' })),
    ];
    expect(restockSuggestions(records, { now: NOW, listKind: 'mercado' }).map((i) => i.name)).toEqual(['Café']);
    expect(
      restockSuggestions(records, { now: NOW, exclude: { names: new Set(), productIds: new Set(['p-cafe']) } }).map((i) => i.name),
    ).toEqual(['Dipirona']);
  });

  it('descreve o palpite', () => {
    expect(describeRestock({ everyDays: 7, daysSince: 9 })).toBe('Costuma comprar a cada 7 dias · última há 9 dias');
  });
});
