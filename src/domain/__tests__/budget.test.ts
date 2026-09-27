import { describe, expect, it } from '@jest/globals';

import { budgetProgress, describeBudget } from '../budget';

describe('budgetProgress', () => {
  const byCategory = [
    { category: 'mercado' as const, amount: 1250 },
    { category: 'lazer' as const, amount: 250 },
  ];

  it('compara o gasto do mês com o limite e ordena pela mais apertada', () => {
    const lines = budgetProgress(
      [
        { category: 'lazer', monthly_limit: 300 },
        { category: 'mercado', monthly_limit: 1200 },
        { category: 'pet', monthly_limit: 200 },
      ],
      byCategory,
    );
    expect(lines.map((l) => [l.category, l.spent, l.status])).toEqual([
      ['mercado', 1250, 'estourou'],
      ['lazer', 250, 'perto'],
      ['pet', 0, 'ok'],
    ]);
  });

  it('descreve quanto falta ou quanto passou', () => {
    const [mercado, lazer] = budgetProgress(
      [
        { category: 'mercado', monthly_limit: 1200 },
        { category: 'lazer', monthly_limit: 250 },
      ],
      byCategory,
    );
    expect(describeBudget(mercado)).toBe('R$ 1.250,00 de R$ 1.200,00 · passou R$ 50,00 do limite');
    expect(describeBudget(lazer)).toBe('R$ 250,00 de R$ 250,00 · chegou no limite');
    expect(describeBudget({ ...lazer, spent: 100 })).toBe('R$ 100,00 de R$ 250,00 · faltam R$ 150,00');
  });
});
