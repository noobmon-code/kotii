import { describe, expect, it } from '@jest/globals';

import { dayTitle, menuLines, planningWeek, suggestionToItems, weekDays, weekLabel, weekStartOf } from '../menu';

describe('menu', () => {
  it('a semana vai de segunda a domingo', () => {
    expect(weekStartOf('2026-09-27')).toBe('2026-09-21'); // domingo fecha a semana
    expect(weekStartOf('2026-09-28')).toBe('2026-09-28');
    expect(weekStartOf('2026-10-01')).toBe('2026-09-28');
    expect(weekDays('2026-09-28')).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
  });

  it('no domingo, planeja a semana que começa amanhã', () => {
    expect(planningWeek('2026-09-27')).toBe('2026-09-28');
    expect(planningWeek('2026-09-30')).toBe('2026-09-28');
  });

  it('nomeia o dia e a semana', () => {
    expect(dayTitle('2026-09-28')).toBe('Segunda, 28/9');
    expect(weekLabel('2026-09-28', 2026)).toBe('28 set – 4 out');
  });

  it('descreve o cardápio para o Nuke, dia a dia', () => {
    expect(
      menuLines([
        { id: '3', day: '2026-09-29', meal: 'jantar', dish: 'Sopa' },
        { id: '1', day: '2026-09-28', meal: 'jantar', dish: 'Omelete' },
        { id: '2', day: '2026-09-28', meal: 'almoco', dish: 'Lasanha' },
      ]),
    ).toEqual(['Segunda, 28/9: almoço Lasanha; jantar Omelete', 'Terça, 29/9: jantar Sopa']);
  });

  it('transforma a sugestão em pratos a gravar, de hoje em diante', () => {
    expect(
      suggestionToItems(
        [
          { date: '2026-09-27', lunch: 'Ontem', dinner: 'Ontem' },
          { date: '2026-09-28', lunch: 'Lasanha', dinner: null },
          { date: '2026-09-29', lunch: ' ', dinner: 'Sopa' },
        ],
        '2026-09-28',
      ),
    ).toEqual([
      { day: '2026-09-28', meal: 'almoco', dish: 'Lasanha' },
      { day: '2026-09-29', meal: 'jantar', dish: 'Sopa' },
    ]);
  });
});
