import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import path from 'path';

import {
  estimateStock,
  MAX_STOCK_DATE,
  MIN_STOCK_DATE,
  refillReminders,
  refillRows,
  refillSummary,
  stockFormOf,
  stockStatus,
  type StockedMedication,
} from '../medicationStock';

// A conta do estoque anda dia a dia com addDays. Aqui ele conta as chamadas e
// derruba o teste quando passam de um teto: uma conta que não termina falha,
// em vez de prender o Jest num laço sem fim. ("mock" no nome: o jest.mock só
// enxerga variáveis assim.)
const mockDays = { calls: 0, limit: 50_000 };

jest.mock('../dates', () => {
  const actual = jest.requireActual<typeof import('../dates')>('../dates');
  return {
    ...actual,
    addDays: (iso: string, days: number) => {
      mockDays.calls += 1;
      if (mockDays.calls > mockDays.limit) throw new Error(`a conta não termina: addDays chamado mais de ${mockDays.limit} vezes (em "${iso}")`);
      return actual.addDays(iso, days);
    },
  };
});

// 12/10/2026 é uma segunda-feira.
const today = '2026-10-12';

const med = (patch: Partial<StockedMedication> = {}): StockedMedication => ({
  id: 'm1',
  personName: 'Ana',
  name: 'Losartana',
  dosage: null,
  times: ['08:00'],
  startOn: '2026-01-01',
  endOn: null,
  active: true,
  stockCount: 4,
  stockCountedOn: today,
  doseUnits: 1,
  warnDays: 7,
  prescriptionUntil: null,
  ...patch,
});

beforeEach(() => {
  mockDays.calls = 0;
});

describe('dia da contagem que não é uma data plausível', () => {
  // Não sai das telas do app, que gravam sempre o dia de hoje: só por fora dele (e o banco, hoje, recusa).
  const schedules: Partial<StockedMedication>[] = [
    {},
    { frequency: 'weekdays', weekdays: [1] },
    { frequency: 'interval', intervalDays: 3 },
    { frequency: 'monthly' },
    { totalDoses: 30, takenCount: 2 },
  ];
  const bad = ['infinity', '-infinity', '9999-12-31', '10000-01-01', 'NaN-NaN-NaN', 'ontem', '2026-10-12T08:00:00Z'];

  it.each(bad)('"%s": o app não acompanha o estoque, e a conta termina', (stockCountedOn) => {
    for (const schedule of schedules) {
      const m = med({ ...schedule, stockCountedOn });
      expect(estimateStock(m, today)).toBeNull();
      expect(stockStatus(m, today)).toEqual({ kind: 'none' });
      expect(refillRows([m], today)).toEqual([]);
      expect(refillReminders([m], today)).toEqual([]);
      expect(refillSummary([m], today)).toEqual({ inUse: 1, followed: 0, lines: [] });
      // "Quanto tem agora" abre com o número guardado: escrever o de agora (contado hoje) conserta.
      expect(stockFormOf(m, today).stock).toBe('4');
    }
    // Nem um dia andado: a data é recusada antes de a conta começar.
    expect(mockDays.calls).toBe(0);
  });

  it('data de verdade, de hoje ou de poucos dias à frente (o relógio de outro aparelho): a conta de sempre', () => {
    for (const schedule of schedules) {
      for (const stockCountedOn of [today, '2026-10-13', '2026-10-19']) {
        expect(estimateStock(med({ ...schedule, stockCountedOn }), today)).not.toBeNull();
      }
    }
    expect(estimateStock(med({ frequency: 'weekdays', weekdays: [1], stockCountedOn: '2026-10-13' }), today)).toEqual({
      unitsLeft: 4,
      runsOutOn: '2026-11-09',
      daysLeft: 28,
      ends: 'stock',
    });
  });
});

describe('as datas que o banco aceita', () => {
  it('a migração e o formulário dizem o mesmo intervalo', () => {
    const sql = readFileSync(path.join(__dirname, '../../../supabase/migrations/20261012160000_medication_stock.sql'), 'utf8');
    const range = `between date '${MIN_STOCK_DATE}' and date '${MAX_STOCK_DATE}'`;
    expect(sql).toContain(`check (stock_counted_on is null or stock_counted_on ${range})`);
    expect(sql).toContain(`check (prescription_until is null or prescription_until ${range})`);
  });
});
