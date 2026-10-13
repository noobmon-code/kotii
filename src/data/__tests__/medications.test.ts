import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';

import { refillReminders, refillRows } from '@/domain/medicationStock';
import type { Medication, MedicationDose } from '@/lib/types';

import {
  fetchDoses,
  fetchMedication,
  fetchMedications,
  isMissingStockColumn,
  MEDICATION_STOCK_UNAVAILABLE,
  restockMedication,
  saveMedication,
  toSchedule,
  toSchedules,
  toStockValues,
  type MedicationValues,
} from '../home';

jest.mock('@/lib/supabase', () => ({
  supabase: {},
  unwrap: (r: { data: unknown; error: unknown }) => {
    if (r.error) throw r.error;
    return r.data;
  },
}));

// Como o banco responde enquanto as colunas do estoque não existem: o Postgres
// numa leitura, o PostgREST numa gravação que as traz no corpo.
const noColumn = { code: '42703', message: 'column medications.stock_count does not exist' };
const notInCache = { code: 'PGRST204', message: "Could not find the 'stock_count' column of 'medications' in the schema cache" };
const offline = { message: 'TypeError: Network request failed' };

const oldRow = {
  id: 'm1',
  person_id: 'ana',
  person_name: 'Ana',
  name: 'Losartana',
  dosage: '50 mg',
  times: ['08:00'],
  start_on: '2026-01-01',
  end_on: null,
  notes: null,
  active: true,
  frequency: 'daily',
  weekdays: null,
  interval_days: null,
  total_doses: null,
  medication_doses: [{ count: 3 }],
};
// O PostgREST pode devolver numeric como texto: o app lê como número.
const newRow = { ...oldRow, stock_count: '12.5', stock_counted_on: '2026-10-10', dose_units: 0.5, stock_warn_days: 10, prescription_until: '2026-12-20' };

const values = {
  person_id: 'ana',
  person_name: 'Ana',
  name: 'Losartana',
  dosage: '50 mg',
  times: ['08:00'],
  start_on: '2026-01-01',
  end_on: null,
  notes: null,
  frequency: 'daily',
  weekdays: null,
  interval_days: null,
  total_doses: null,
} as MedicationValues;

/**
 * Um banco de mentira: guarda cada pedido (o verbo, as colunas pedidas de volta e o que foi gravado) e
 * responde como um banco novo (`hasStock`) ou como um de antes do estoque, que recusa o pedido que
 * fala das colunas novas, na leitura ou no corpo.
 */
function fakeDb(hasStock: boolean, failure?: { message: string }) {
  const requests: { verb: string; columns: string | null; body: Record<string, unknown> | null }[] = [];
  const db = {
    from: () => {
      const request: (typeof requests)[number] = { verb: 'select', columns: null, body: null };
      let one = false;
      const answer = () => {
        requests.push(request);
        if (failure) return { data: null, error: failure };
        const mentionsStock = (text: string | null) => Boolean(text && /stock_count|dose_units|prescription_until/.test(text));
        if (!hasStock && mentionsStock(JSON.stringify(request.body))) return { data: null, error: notInCache };
        if (!hasStock && mentionsStock(request.columns)) return { data: null, error: noColumn };
        if (request.columns === null) return { data: null, error: null };
        const row = hasStock ? newRow : oldRow;
        return { data: one ? row : [row], error: null };
      };
      const query: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(answer()).then(resolve, reject),
        select: (columns: string) => {
          request.columns = columns;
          return query;
        },
        single: () => {
          one = true;
          return query;
        },
      };
      for (const verb of ['insert', 'update']) {
        query[verb] = (body: Record<string, unknown>) => {
          request.verb = verb;
          request.body = body;
          return query;
        };
      }
      for (const filter of ['eq', 'order']) query[filter] = () => query;
      return query;
    },
  };
  return { db: db as unknown as SupabaseClient, requests };
}

const hasStockColumns = (columns: string | null) => Boolean(columns?.includes('stock_count'));

describe('ler os remédios', () => {
  it('com as colunas do estoque, num pedido só', async () => {
    const { db, requests } = fakeDb(true);
    const [medication] = await fetchMedications(db);
    expect(requests).toHaveLength(1);
    expect(medication).toMatchObject({
      id: 'm1',
      taken_count: 3,
      stock_count: 12.5,
      stock_counted_on: '2026-10-10',
      dose_units: 0.5,
      stock_warn_days: 10,
      prescription_until: '2026-12-20',
    });
    expect(toSchedule(medication, '2026-10-12', undefined)).toMatchObject({
      stockCount: 12.5,
      stockCountedOn: '2026-10-10',
      doseUnits: 0.5,
      warnDays: 10,
      prescriptionUntil: '2026-12-20',
    });
  });

  it('banco de antes do estoque: lê de novo com as colunas de antes, e nenhum remédio tem estoque acompanhado', async () => {
    const { db, requests } = fakeDb(false);
    const [medication] = await fetchMedications(db);
    expect(requests.map((r) => hasStockColumns(r.columns))).toEqual([true, false]);
    expect(medication).toMatchObject({
      id: 'm1',
      name: 'Losartana',
      taken_count: 3,
      stock_count: null,
      stock_counted_on: null,
      dose_units: 1,
      stock_warn_days: 7,
      prescription_until: null,
    });
    // Um remédio só (a tela de editar): o mesmo caminho.
    const single = fakeDb(false);
    expect(await fetchMedication('m1', single.db)).toMatchObject({ id: 'm1', stock_count: null, dose_units: 1 });
    expect(single.requests).toHaveLength(2);
  });

  it('outro erro (sem internet, outra coluna) continua sendo erro, sem segunda tentativa', async () => {
    const { db, requests } = fakeDb(true, offline);
    await expect(fetchMedications(db)).rejects.toEqual(offline);
    expect(requests).toHaveLength(1);
    const other = { code: '42703', message: 'column medications.frequency does not exist' };
    await expect(fetchMedications(fakeDb(true, other).db)).rejects.toEqual(other);
  });

  it('reconhece a falta das colunas do estoque, e só ela', () => {
    expect(isMissingStockColumn(noColumn)).toBe(true);
    expect(isMissingStockColumn(notInCache)).toBe(true);
    expect(isMissingStockColumn({ message: 'column medications.prescription_until does not exist' })).toBe(true);
    expect(isMissingStockColumn({ code: '42703', message: 'column medications.frequency does not exist' })).toBe(false);
    expect(isMissingStockColumn({ code: '23514', message: 'new row violates check constraint "medications_stock_count_check"' })).toBe(false);
    expect(isMissingStockColumn(offline)).toBe(false);
    expect(isMissingStockColumn(null)).toBe(false);
  });
});

describe('salvar o remédio', () => {
  const stock = toStockValues({ stockCount: 30, stockCountedOn: '2026-10-12', warnDays: 10 });

  it('só as colunas do estoque em que a pessoa mexeu vão para o banco', () => {
    expect(stock).toEqual({ stock_count: 30, stock_counted_on: '2026-10-12', stock_warn_days: 10 });
    expect(toStockValues({})).toEqual({});
    expect(toStockValues({ stockCount: null, stockCountedOn: null, prescriptionUntil: null, doseUnits: 0.5 })).toEqual({
      stock_count: null,
      stock_counted_on: null,
      prescription_until: null,
      dose_units: 0.5,
    });
  });

  it('banco novo: o remédio e o estoque num pedido só', async () => {
    const { db, requests } = fakeDb(true);
    const saved = await saveMedication({ id: 'm1', values, stock }, db);
    expect(saved.stockUnavailable).toBe(false);
    expect(saved.medication.stock_count).toBe(12.5);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ verb: 'update', body: { ...values, ...stock } });
    // Remédio novo, sem mexer no estoque: nada do estoque no corpo (valem os padrões do banco).
    const created = fakeDb(true);
    await saveMedication({ values, stock: {} }, created.db);
    expect(created.requests).toEqual([expect.objectContaining({ verb: 'insert', body: values })]);
  });

  it('banco de antes do estoque: o remédio salva como sempre e a tela fica sabendo que o estoque ficou de fora', async () => {
    const { db, requests } = fakeDb(false);
    const saved = await saveMedication({ id: 'm1', values, stock }, db);
    expect(saved.stockUnavailable).toBe(true);
    expect(saved.medication).toMatchObject({ id: 'm1', name: 'Losartana', stock_count: null });
    // O primeiro pedido foi recusado inteiro; o segundo grava só o remédio.
    expect(requests.map((r) => [r.verb, hasStockColumns(r.columns), r.body])).toEqual([
      ['update', true, { ...values, ...stock }],
      ['update', false, values],
    ]);
    // Um remédio novo também: uma linha só é criada, na segunda tentativa.
    const created = fakeDb(false);
    expect((await saveMedication({ values, stock }, created.db)).stockUnavailable).toBe(true);
    expect(created.requests.map((r) => [r.verb, r.body])).toEqual([
      ['insert', { ...values, ...stock }],
      ['insert', values],
    ]);
  });

  it('banco de antes do estoque, sem mexer no estoque: salva sem aviso nenhum', async () => {
    const { db, requests } = fakeDb(false);
    for (const untouched of [undefined, {}]) {
      const saved = await saveMedication({ id: 'm1', values, stock: untouched }, db);
      expect(saved.stockUnavailable).toBe(false);
      expect(saved.medication.name).toBe('Losartana');
    }
    expect(requests.map((r) => r.body)).toEqual([values, values, values, values]);
  });

  it('outro erro ao salvar continua sendo erro', async () => {
    await expect(saveMedication({ id: 'm1', values, stock }, fakeDb(true, offline).db)).rejects.toEqual(offline);
  });
});

describe('as doses de hoje já marcadas vão com o remédio, para a conta do estoque', () => {
  const today = '2026-10-12';
  const dose = (medication_id: string, scheduled_on: string, scheduled_time: string): MedicationDose => ({
    id: `${medication_id} ${scheduled_on} ${scheduled_time}`,
    medication_id,
    scheduled_on,
    scheduled_time,
    taken_at: `${scheduled_on}T12:00:00Z`,
  });
  const twice = async (patch: Partial<Medication> = {}): Promise<Medication> => ({
    ...(await fetchMedications(fakeDb(true).db))[0],
    times: ['08:00', '20:00'],
    ...patch,
  });

  it('de cada remédio, quantos dos horários de hoje já foram marcados', async () => {
    const ana = await twice();
    const beto = await twice({ id: 'm2' });
    const doses = [
      dose('m1', today, '08:00'),
      dose('m2', today, '08:00'),
      dose('m2', today, '20:00'),
      // De outro dia, e de um horário que o remédio não tem mais: não contam.
      dose('m1', '2026-10-11', '20:00'),
      dose('m1', today, '06:00'),
    ];
    expect(toSchedules([ana, beto], today, doses).map((m) => [m.id, m.takenToday])).toEqual([
      ['m1', 1],
      ['m2', 2],
    ]);
    expect(toSchedule(ana, today, doses)).toEqual(toSchedules([ana, beto], today, doses)[0]);
    expect(toSchedule(ana, today, []).takenToday).toBe(0);
    // Marcações de outro dia entregues como se fossem de hoje: nenhuma conta.
    expect(toSchedule(ana, '2026-10-13', doses).takenToday).toBe(0);
  });

  it('marcações que ainda não carregaram: o remédio vai sem elas', async () => {
    const ana = await twice();
    expect(toSchedule(ana, today, undefined).takenToday).toBeUndefined();
    expect(toSchedules([ana], today, undefined)[0].takenToday).toBeUndefined();
    expect(toSchedules([ana], today, undefined)[0]).toMatchObject({ id: 'm1', times: ['08:00', '20:00'], takenCount: 3 });
  });

  it('tratamento por número de doses com as marcações adiantadas: a mesma resposta a cada dose de hoje marcada', async () => {
    // Amoxicilina, 20 doses desde 09/10: em 12/10, com 9 marcadas, passou de três para duas por dia; 10 comprimidos contados nesse dia.
    const course = await twice({ start_on: '2026-10-09', total_doses: 20, stock_count: 10, stock_counted_on: today, dose_units: 1, stock_warn_days: 7, prescription_until: null });
    const steps = [[], [dose('m1', today, '08:00')], [dose('m1', today, '08:00'), dose('m1', today, '20:00')]];
    for (const doses of steps) {
      const schedules = toSchedules([{ ...course, taken_count: 9 + doses.length }], today, doses);
      // 10 comprimidos para as 9 doses que ficam depois das duas de hoje: nada a avisar, nas telas e por notificação.
      expect(refillRows(schedules, today)).toEqual([]);
      expect(refillReminders(schedules, today)).toEqual([]);
    }
    // Sem as marcações de hoje, a conta de antes (as duas doses de hoje contam de novo): avisa.
    expect(refillRows(toSchedules([{ ...course, taken_count: 9 }], today, undefined), today)).toMatchObject([{ id: 'm1', stock: 'low' }]);
  });

  it('as doses marcadas de um dia, na casa pedida', async () => {
    const asked: unknown[] = [];
    const rows = [dose('m1', today, '08:00')];
    const db = {
      from: (table: string) => ({
        select: (columns: string) => ({
          eq: async (column: string, value: string) => {
            asked.push([table, columns, column, value]);
            return { data: rows, error: null };
          },
        }),
      }),
    } as unknown as SupabaseClient;
    expect(await fetchDoses(today, db)).toEqual(rows);
    expect(asked).toEqual([['medication_doses', 'id, medication_id, scheduled_on, scheduled_time, taken_at', 'scheduled_on', today]]);
  });
});

describe('"Comprei mais"', () => {
  const count = { stockCount: 50, stockCountedOn: '2026-10-12' };

  it('grava a contagem nova', async () => {
    const { db, requests } = fakeDb(true);
    await restockMedication({ id: 'm1', count }, db);
    expect(requests).toEqual([{ verb: 'update', columns: null, body: { stock_count: 50, stock_counted_on: '2026-10-12' } }]);
  });

  it('banco de antes do estoque: diz que o estoque ainda está sendo ativado', async () => {
    await expect(restockMedication({ id: 'm1', count }, fakeDb(false).db)).rejects.toThrow(MEDICATION_STOCK_UNAVAILABLE);
    expect(MEDICATION_STOCK_UNAVAILABLE).toBe('O estoque de remédios ainda está sendo ativado no Kotii. Tente de novo mais tarde.');
    await expect(restockMedication({ id: 'm1', count }, fakeDb(true, offline).db)).rejects.toEqual(offline);
  });
});
