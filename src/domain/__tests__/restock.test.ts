import { describe, expect, it } from '@jest/globals';

import type { PurchaseRecord } from '../recentPurchases';
import { describeRestock, ranOutItems, restockFrom, restockSuggestions } from '../restock';

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

  it('aprende intervalos de até 45 dias: as três compras cabem no histórico quando o item vence', () => {
    // A cada 45 dias, última há 45 (a primeira há 135): sugere.
    const every45 = [rec('Sabão', '2026-05-15'), rec('Sabão', '2026-06-29'), rec('Sabão', '2026-08-13')];
    expect(restockSuggestions(every45, { now: NOW }).map((i) => [i.name, i.everyDays, i.daysSince])).toEqual([['Sabão', 45, 45]]);
    // A cada 50 dias, também vencido: fica de fora.
    const every50 = [rec('Filtro', '2026-04-30'), rec('Filtro', '2026-06-19'), rec('Filtro', '2026-08-08')];
    expect(restockSuggestions(every50, { now: NOW })).toEqual([]);
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

describe('ranOutItems e restockFrom', () => {
  const records = [
    // Café a cada 10 dias, última há 12.
    ...['2026-08-26', '2026-09-05', '2026-09-15'].map((d) => rec('Café', d, { productId: 'p-cafe' })),
    // Leite a cada 7 dias, última há 10.
    ...['2026-09-03', '2026-09-10', '2026-09-17'].map((d) => rec('Leite', d, { category: 'laticinios' })),
    // Refrigerante a cada 7 dias, última há 104: a casa deixou de comprar.
    ...['2026-06-01', '2026-06-08', '2026-06-15'].map((d) => rec('Refrigerante', d)),
    // Arroz a cada 30 dias, última há 5: ainda tem.
    ...['2026-07-24', '2026-08-23', '2026-09-22'].map((d) => rec('Arroz', d)),
    ...['2026-08-26', '2026-09-05', '2026-09-15'].map((d) => rec('Dipirona', d, { category: 'medicamentos' })),
  ];

  it('ranOutItems: tudo o que passou do intervalo de costume, por mais que tenha passado, com a data da última compra', () => {
    const ranOut = ranOutItems(records, { now: NOW, listKind: 'mercado' });
    expect(ranOut.map((i) => [i.name, i.everyDays, i.daysSince])).toEqual([
      ['Refrigerante', 7, 104],
      ['Leite', 7, 10],
      ['Café', 10, 12],
    ]);
    expect(ranOut[2]).toMatchObject({ productId: 'p-cafe', lastAt: '2026-09-15T10:00:00-03:00' });
    // Sem o tipo da lista, entra também o que é de farmácia.
    expect(ranOutItems(records, { now: NOW }).map((i) => i.name)).toEqual(['Refrigerante', 'Leite', 'Café', 'Dipirona']);
  });

  it('restockFrom: a faixa tira o que a casa deixou de comprar e o que já está na lista', () => {
    const ranOut = ranOutItems(records, { now: NOW, listKind: 'mercado' });
    expect(restockFrom(ranOut).map((i) => i.name)).toEqual(['Leite', 'Café']);
    expect(restockFrom(ranOut, { exclude: { names: new Set(['leite']), productIds: new Set() } }).map((i) => i.name)).toEqual(['Café']);
    expect(restockFrom(ranOut, { exclude: { names: new Set(), productIds: new Set(['p-cafe']) } }).map((i) => i.name)).toEqual(['Leite']);
    expect(restockFrom(ranOut, { limit: 1 }).map((i) => i.name)).toEqual(['Leite']);
  });

  it('restockSuggestions é restockFrom sobre ranOutItems: a mesma faixa, com uma leitura só do histórico', () => {
    const cases = [
      {},
      { listKind: 'mercado' as const },
      { listKind: 'farmacia' as const },
      { exclude: { names: new Set(['cafe']), productIds: new Set<string>() } },
      { listKind: 'mercado' as const, exclude: { names: new Set<string>(), productIds: new Set(['p-cafe']) }, limit: 1 },
    ];
    for (const options of cases) {
      expect(restockFrom(ranOutItems(records, { now: NOW, listKind: options.listKind }), options)).toEqual(
        restockSuggestions(records, { now: NOW, ...options }),
      );
    }
  });
});
