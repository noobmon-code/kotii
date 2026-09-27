import { describe, expect, it } from '@jest/globals';
import glyphs from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json';

import { CATEGORY_KEYS } from '../../../supabase/functions/_shared/categories';
import { CATEGORIES, compareByAisle, getCategory } from '../categories';
import { choreStatus, describeChoreStatus, describeRecurrence } from '../chores';
import {
  addDays,
  diffDays,
  formatBRDate,
  formatShortDate,
  isValidISODate,
  parseBRDate,
  toISODate,
} from '../dates';
import { dosesForDay, parseTimes, planReminders, type MedicationSchedule } from '../medications';
import { formatBRL, parseDecimal } from '../money';
import { describeExpiry, estimateExpiry, expiryStatus } from '../pantry';
import { guessCategory, normalizeSearch } from '../search';

describe('categories', () => {
  it('matches the keys the receipt AI classifies into', () => {
    expect(CATEGORIES.map((c) => c.key)).toEqual([...CATEGORY_KEYS]);
  });

  it('uses icons that exist in MaterialCommunityIcons', () => {
    for (const c of CATEGORIES) expect(glyphs).toHaveProperty([c.icon]);
  });

  it('falls back to "outros"', () => {
    expect(getCategory('nao-existe').key).toBe('outros');
    expect(getCategory(null).key).toBe('outros');
  });

  it('orders the shopping list by aisle, then by name', () => {
    const items = [
      { category: 'limpeza', name: 'Detergente' },
      { category: 'nao-existe', name: 'Abajur' },
      { category: 'hortifruti', name: 'Maçã' },
      { category: 'hortifruti', name: 'banana' },
    ];
    expect([...items].sort(compareByAisle).map((i) => i.name)).toEqual(['banana', 'Maçã', 'Detergente', 'Abajur']);
  });
});

describe('dates', () => {
  it('does calendar arithmetic across month and year boundaries', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(diffDays('2026-09-26', '2026-10-03')).toBe(7);
    expect(diffDays('2026-10-03', '2026-09-26')).toBe(-7);
  });

  it('formats and validates', () => {
    expect(toISODate(new Date(2026, 8, 5))).toBe('2026-09-05');
    expect(formatShortDate('2026-09-26', 2026)).toBe('26 set');
    expect(formatShortDate('2027-01-02', 2026)).toBe('2 jan 2027');
    expect(isValidISODate('2026-02-30')).toBe(false);
    expect(isValidISODate('2026-02-28')).toBe(true);
  });

  it('round-trips Brazilian dates', () => {
    expect(formatBRDate('2026-12-20')).toBe('20/12/2026');
    expect(parseBRDate('20/12/2026')).toBe('2026-12-20');
    expect(parseBRDate('5/1/27')).toBe('2027-01-05');
    expect(parseBRDate('31/02/2026')).toBeNull();
    expect(parseBRDate('2026-12-20')).toBeNull();
  });
});

describe('search', () => {
  it('ignores accents and case', () => {
    expect(normalizeSearch('  Feijão CARIOCA ')).toBe('feijao carioca');
  });

  it('guesses categories by word, not by substring of short keywords', () => {
    expect(guessCategory('Arroz integral')).toBe('graos');
    expect(guessCategory('Água sanitária 2L')).toBe('limpeza');
    expect(guessCategory('Água mineral')).toBe('bebidas');
    expect(guessCategory('Salmão')).toBe('peixes');
    expect(guessCategory('Sal grosso')).toBe('temperos');
    expect(guessCategory('Pizza congelada')).toBe('congelados');
    expect(guessCategory('Chantilly')).toBe('outros');
    expect(guessCategory('Ovos brancos')).toBe('ovos');
    expect(guessCategory('Papel higiênico')).toBe('papel');
  });
});

describe('pantry expiry', () => {
  it('prefers the shelf life learned for the product', () => {
    expect(estimateExpiry({ purchasedOn: '2026-09-20', category: 'graos', productShelfLifeDays: 30 })).toEqual({
      expiresOn: '2026-10-20',
      source: 'produto',
    });
  });

  it('falls back to the category default, or no expiry', () => {
    expect(estimateExpiry({ purchasedOn: '2026-09-20', category: 'carnes' })).toEqual({
      expiresOn: '2026-09-23',
      source: 'categoria',
    });
    expect(estimateExpiry({ purchasedOn: '2026-09-20', category: 'limpeza' })).toEqual({
      expiresOn: null,
      source: null,
    });
  });

  it('classifies and describes status', () => {
    const today = '2026-09-26';
    expect(describeExpiry(expiryStatus('2026-09-24', today))).toBe('Venceu há 2 dias');
    expect(describeExpiry(expiryStatus('2026-09-26', today))).toBe('Vence hoje');
    expect(describeExpiry(expiryStatus('2026-09-27', today))).toBe('Vence amanhã');
    expect(expiryStatus('2026-09-29', today).kind).toBe('vence_logo');
    expect(expiryStatus('2026-09-30', today).kind).toBe('ok');
    expect(expiryStatus(null, today).kind).toBe('sem_validade');
  });
});

describe('money', () => {
  it('parses Brazilian and plain decimals', () => {
    expect(parseDecimal('12,90')).toBe(12.9);
    expect(parseDecimal('1.234,56')).toBe(1234.56);
    expect(parseDecimal('R$ 3')).toBe(3);
    expect(parseDecimal('1.5')).toBe(1.5);
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal('')).toBeNull();
  });

  it('formats BRL', () => {
    expect(formatBRL(1234.5)).toBe('R$ 1.234,50');
  });
});

describe('chores', () => {
  it('describes status relative to today', () => {
    expect(describeChoreStatus(choreStatus('2026-09-25', '2026-09-26'))).toBe('Atrasada 1 dia');
    expect(describeChoreStatus(choreStatus('2026-09-26', '2026-09-26'))).toBe('Hoje');
    expect(describeChoreStatus(choreStatus('2026-09-27', '2026-09-26'))).toBe('Amanhã');
  });

  it('describes recurrence', () => {
    expect(describeRecurrence('weekly', 1)).toBe('Toda semana');
    expect(describeRecurrence('daily', 2)).toBe('A cada 2 dias');
    expect(describeRecurrence('none', 1)).toBe('Uma vez');
  });
});

describe('medications', () => {
  const base: MedicationSchedule = {
    id: 'm1',
    personName: 'Ana',
    name: 'Vitamina D',
    dosage: null,
    times: ['20:00', '08:00'],
    startOn: '2026-09-01',
    endOn: '2026-09-30',
    active: true,
  };

  it('lists doses of the day sorted by time within the treatment period', () => {
    const other = { ...base, id: 'm2', personName: 'Bia', name: 'Xarope', times: ['08:00'] };
    expect(dosesForDay([base, other], '2026-09-26').map((d) => `${d.time} ${d.personName}`)).toEqual([
      '08:00 Ana',
      '08:00 Bia',
      '20:00 Ana',
    ]);
    expect(dosesForDay([base], '2026-10-01')).toEqual([]);
    expect(dosesForDay([{ ...base, active: false }], '2026-09-26')).toEqual([]);
  });

  it('parses user-typed times', () => {
    expect(parseTimes('8:00, 20:00')).toEqual(['08:00', '20:00']);
    expect(parseTimes('22 8')).toEqual(['08:00', '22:00']);
    expect(parseTimes('25:00')).toBeNull();
    expect(parseTimes('')).toBeNull();
  });
});

describe('planReminders', () => {
  const med = (startOn: string, endOn: string | null, active = true) => ({ times: ['20:00', '08:00'], startOn, endOn, active });

  it('repeats daily only while the whole window is inside the treatment', () => {
    expect(planReminders(med('2026-09-01', null), '2026-09-26', '10:00')).toEqual({ kind: 'daily', times: ['08:00', '20:00'] });
    expect(planReminders(med('2026-09-01', '2026-12-31'), '2026-09-26', '10:00').kind).toBe('daily');
  });

  it('schedules single doses before the start and near the end', () => {
    const starting = planReminders(med('2026-09-30', null), '2026-09-26', '10:00');
    expect(starting.kind).toBe('dates');
    if (starting.kind !== 'dates') return;
    expect(starting.slots[0]).toEqual({ date: '2026-09-30', time: '08:00' });
    expect(starting.slots.at(-1)).toEqual({ date: '2026-10-03', time: '20:00' });

    const ending = planReminders(med('2026-09-01', '2026-09-27'), '2026-09-26', '10:00');
    expect(ending).toEqual({
      kind: 'dates',
      slots: [
        { date: '2026-09-26', time: '20:00' },
        { date: '2026-09-27', time: '08:00' },
        { date: '2026-09-27', time: '20:00' },
      ],
    });
  });

  it('schedules nothing for ended, archived or far-future treatments', () => {
    expect(planReminders(med('2026-09-01', '2026-09-20'), '2026-09-26', '10:00')).toEqual({ kind: 'none' });
    expect(planReminders(med('2026-09-01', null, false), '2026-09-26', '10:00')).toEqual({ kind: 'none' });
    expect(planReminders(med('2026-12-01', null), '2026-09-26', '10:00')).toEqual({ kind: 'none' });
    expect(planReminders(med('2026-09-01', '2026-09-26'), '2026-09-26', '21:00')).toEqual({ kind: 'none' });
  });
});
