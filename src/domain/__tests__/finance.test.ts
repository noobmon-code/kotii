import { describe, expect, it } from '@jest/globals';

import { FINANCE_CATEGORY_KEYS } from '../../../supabase/functions/_shared/categories';
import {
  billsDueSoon,
  FINANCE_CATEGORIES,
  billStatus,
  buildEntries,
  describeBillStatus,
  describeMonthDelta,
  financeCategoryOfProduct,
  monthLabel,
  monthlyTotals,
  monthRange,
  previousMonth,
  shiftMonth,
  stillToPay,
  summarize,
} from '../finance';

describe('finance categories', () => {
  it('matches the keys the Nuke assistant uses', () => {
    expect(FINANCE_CATEGORIES.map((c) => c.key)).toEqual([...FINANCE_CATEGORY_KEYS]);
  });

  it('maps receipt product categories', () => {
    expect(financeCategoryOfProduct('hortifruti')).toBe('mercado');
    expect(financeCategoryOfProduct('limpeza')).toBe('casa');
    expect(financeCategoryOfProduct('medicamentos')).toBe('saude');
    expect(financeCategoryOfProduct('pet')).toBe('pet');
    expect(financeCategoryOfProduct(null)).toBe('mercado');
  });
});

describe('months', () => {
  it('shifts across years and labels in Portuguese', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(monthRange('2026-09')).toEqual({ start: '2026-09-01', end: '2026-10-01' });
    expect(monthLabel('2026-03')).toBe('março de 2026');
  });
});

describe('bills', () => {
  const bill = (next_due_on: string, amount: number | null, active = true) => ({ next_due_on, amount, active });

  it('describes the due date', () => {
    expect(billStatus('2026-09-20', '2026-09-26')).toEqual({ kind: 'atrasada', days: 6 });
    expect(describeBillStatus(billStatus('2026-09-26', '2026-09-26'), '2026-09-26')).toBe('Vence hoje');
    expect(describeBillStatus(billStatus('2026-09-27', '2026-09-26'), '2026-09-27')).toBe('Vence amanhã');
    expect(describeBillStatus(billStatus('2026-10-20', '2026-09-26'), '2026-10-20')).toBe('Vence 20/10/2026');
  });

  it('lists overdue and soon-due bills, most urgent first', () => {
    const bills = [bill('2026-09-30', 10), bill('2026-09-20', 10), bill('2026-09-28', 10), bill('2026-09-01', 10, false)];
    expect(billsDueSoon(bills, '2026-09-26').map((b) => b.next_due_on)).toEqual(['2026-09-20', '2026-09-28']);
  });

  it('adds what is still due this month', () => {
    const bills = [bill('2026-09-28', 100), bill('2026-09-30', null), bill('2026-10-05', 50), bill('2026-09-20', 30)];
    expect(stillToPay(bills, '2026-09-26')).toEqual({ amount: 130, variable: 1 });
  });
});

describe('spending', () => {
  const entries = buildEntries(
    [
      {
        id: 'r1',
        purchased_at_date: '2026-09-20',
        total: 60,
        store_name: 'Atacadão',
        items: [
          { total_price: 25, category: 'graos' },
          { total_price: 10.5, category: 'hortifruti' },
          { total_price: 8, category: 'limpeza' },
        ],
      },
      { id: 'r2', purchased_at_date: '2026-08-15', total: 40, store_name: null, items: [] },
    ],
    [{ id: 'p1', bill_id: 'b1', paid_on: '2026-09-10', amount: 2500, bill_name: 'Aluguel', bill_category: 'moradia' }],
    [{ id: 'e1', spent_on: '2026-09-26', amount: 86.5, category: 'mercado', description: 'Feira' }],
  );

  it('splits receipts by category and keeps the newest first', () => {
    // Itens somam 43,50 e a nota cobrou 60,00: categorias ajustadas na proporção.
    expect(entries.map((e) => [e.description, e.category, e.amount])).toEqual([
      ['Feira', 'mercado', 86.5],
      ['Atacadão', 'mercado', 48.97],
      ['Atacadão', 'casa', 11.03],
      ['Aluguel', 'moradia', 2500],
      ['Nota fiscal', 'mercado', 40],
    ]);
  });

  it('makes each receipt add up to the amount charged, discounts included', () => {
    const discounted = buildEntries(
      [
        {
          id: 'd',
          purchased_at_date: '2026-09-01',
          total: 90,
          store_name: 'Mercado',
          items: [
            { total_price: 33.33, category: 'graos' },
            { total_price: 33.33, category: 'limpeza' },
            { total_price: 33.34, category: 'pet' },
          ],
        },
        { id: 'z', purchased_at_date: '2026-09-02', total: 12, store_name: null, items: [{ total_price: 0, category: 'graos' }] },
      ],
      [],
      [],
    );
    const sumOf = (id: string) => Math.round(discounted.filter((e) => e.refId === id).reduce((s, e) => s + e.amount, 0) * 100) / 100;
    expect(sumOf('d')).toBe(90);
    expect(discounted.filter((e) => e.refId === 'd').map((e) => e.amount).sort()).toEqual([30, 30, 30]);
    expect(sumOf('z')).toBe(12);
  });

  it('summarizes a month by category and place', () => {
    const summary = summarize(entries, monthRange('2026-09'));
    expect(summary.total).toBe(2646.5);
    expect(summary.byCategory).toEqual([
      { category: 'moradia', amount: 2500 },
      { category: 'mercado', amount: 135.47 },
      { category: 'casa', amount: 11.03 },
    ]);
    expect(summary.byPlace[1]).toEqual({ name: 'Feira', amount: 86.5 });
    expect(monthlyTotals(entries, ['2026-08', '2026-09'])).toEqual([
      { month: '2026-08', total: 40 },
      { month: '2026-09', total: 2646.5 },
    ]);
  });

  it('compares with the previous month up to the same day while the month is running', () => {
    const august = buildEntries(
      [],
      [],
      [
        { id: 'a', spent_on: '2026-08-05', amount: 100, category: 'outros', description: 'x' },
        { id: 'b', spent_on: '2026-08-20', amount: 50, category: 'outros', description: 'y' },
      ],
    );
    const running = previousMonth(august, '2026-09', '2026-09-10');
    expect(running).toEqual({ month: '2026-08', amount: 100, uptoDay: 10 });
    expect(describeMonthDelta(80, running)).toBe('R$ 20,00 a menos que até o dia 10 de agosto');
    const closed = previousMonth(august, '2026-09', '2026-10-02');
    expect(closed).toEqual({ month: '2026-08', amount: 150, uptoDay: null });
    expect(describeMonthDelta(200, closed)).toBe('R$ 50,00 a mais que em agosto');
    // 31 de março contra fevereiro: o mês anterior inteiro.
    expect(previousMonth([], '2026-03', '2026-03-31').uptoDay).toBeNull();
    expect(describeMonthDelta(10, { month: '2026-08', amount: 0, uptoDay: null })).toBeNull();
  });
});
