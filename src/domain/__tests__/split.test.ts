import { describe, expect, it } from '@jest/globals';

import { splitMonth } from '../split';

const members = [
  { userId: 'ana', name: 'Ana' },
  { userId: 'beto', name: 'Beto' },
];

describe('splitMonth', () => {
  it('divide igual e diz quem passa quanto para quem', () => {
    const result = splitMonth({
      members,
      entries: [
        { amount: 2500, paidBy: 'ana' },
        { amount: 300, paidBy: 'beto' },
        { amount: 100, paidBy: 'beto' },
        { amount: 50, paidBy: null },
      ],
    });
    expect(result.total).toBe(2900);
    expect(result.unassigned).toBe(50);
    expect(result.rows.map((r) => [r.name, r.paid, r.share, r.balance])).toEqual([
      ['Ana', 2500, 1450, 1050],
      ['Beto', 400, 1450, -1050],
    ]);
    expect(result.transfers).toEqual([{ from: 'beto', to: 'ana', amount: 1050 }]);
  });

  it('usa o peso de cada um e desconta os acertos já feitos', () => {
    const result = splitMonth({
      members,
      entries: [{ amount: 3000, paidBy: 'ana' }],
      weights: { ana: 2 },
      settlements: [{ from: 'beto', to: 'ana', amount: 600 }],
    });
    // Ana fica com 2/3 (2000), Beto com 1/3 (1000); Beto já passou 600.
    expect(result.rows.map((r) => [r.name, r.share, r.balance])).toEqual([
      ['Ana', 2000, 400],
      ['Beto', 1000, -400],
    ]);
    expect(result.transfers).toEqual([{ from: 'beto', to: 'ana', amount: 400 }]);
  });

  it('com três ou mais, fecha as contas com poucas transferências e partes que somam o total', () => {
    const result = splitMonth({
      members: [...members, { userId: 'caio', name: 'Caio' }],
      entries: [
        { amount: 100, paidBy: 'ana' },
        { amount: 0.01, paidBy: 'caio' },
      ],
    });
    expect(result.rows.reduce((sum, r) => sum + r.share, 0)).toBeCloseTo(100.01, 2);
    expect(result.transfers).toEqual([
      { from: 'beto', to: 'ana', amount: 33.34 },
      { from: 'caio', to: 'ana', amount: 33.33 },
    ]);
  });

  it('tudo acertado: sem transferências', () => {
    const result = splitMonth({ members, entries: [{ amount: 100, paidBy: 'ana' }, { amount: 100, paidBy: 'beto' }] });
    expect(result.transfers).toEqual([]);
  });
});
