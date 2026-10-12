import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';

import { FAMILY_EVENTS_UNAVAILABLE, familyEventErrorMessage, fetchFamilyEventDays, fetchFamilyEvents, isMissingTable } from '../family';

jest.mock('@/lib/supabase', () => ({
  supabase: {},
  unwrap: (r: { data: unknown; error: unknown }) => {
    if (r.error) throw r.error;
    return r.data;
  },
  errorMessage: (error: { message?: string }) => error?.message ?? 'Algo deu errado. Tente novamente.',
}));
jest.mock('@/data/health', () => ({ usePeople: jest.fn() }));

/**
 * Um banco de mentira: guarda a tabela pedida e responde `result`. Quando há linhas, respeita o filtro
 * de repetição (eq/neq em `recurrence`) e a página pedida, como o PostgREST.
 */
function fakeDb(result: { data: unknown; error: unknown }) {
  const tables: string[] = [];
  const db = {
    from: (table: string) => {
      tables.push(table);
      let keep = (_row: { recurrence?: string }) => true;
      const query = {
        select: () => query,
        order: () => query,
        eq: (_column: string, value: string) => {
          keep = (row) => (row.recurrence ?? 'none') === value;
          return query;
        },
        neq: (_column: string, value: string) => {
          keep = (row) => (row.recurrence ?? 'none') !== value;
          return query;
        },
        range: async (from: number, to: number) =>
          Array.isArray(result.data)
            ? { data: (result.data as { recurrence?: string }[]).filter(keep).slice(from, to + 1), error: null }
            : result,
      };
      return query;
    },
  };
  return { db: db as unknown as SupabaseClient, tables };
}

// Como o PostgREST e o Postgres respondem quando a tabela ainda não existe.
const notInCache = { code: 'PGRST205', message: "Could not find the table 'public.family_events' in the schema cache" };
const noRelation = { code: '42P01', message: 'relation "public.family_event_days" does not exist' };
const offline = { message: 'TypeError: Network request failed' };

describe('compromissos antes da migração', () => {
  it('reconhece a tabela que ainda não existe, e só ela', () => {
    expect(isMissingTable(notInCache)).toBe(true);
    expect(isMissingTable(noRelation)).toBe(true);
    // Sem o código (um proxy no meio), pela mensagem.
    expect(isMissingTable({ message: notInCache.message })).toBe(true);
    expect(isMissingTable(offline)).toBe(false);
    expect(isMissingTable({ code: '42501', message: 'new row violates row-level security policy for table "family_events"' })).toBe(false);
    expect(isMissingTable({ code: '23514', message: 'new row for relation "family_events" violates check constraint' })).toBe(false);
    expect(isMissingTable(null)).toBe(false);
    expect(isMissingTable('erro')).toBe(false);
  });

  it('sem as tabelas, as consultas respondem "nenhum compromisso" em vez de erro', async () => {
    const events = fakeDb({ data: null, error: notInCache });
    await expect(fetchFamilyEvents(events.db)).resolves.toEqual([]);
    expect(new Set(events.tables)).toEqual(new Set(['family_events']));
    const days = fakeDb({ data: null, error: noRelation });
    await expect(fetchFamilyEventDays(days.db)).resolves.toEqual([]);
    expect(days.tables).toEqual(['family_event_days']);
  });

  it('outra falha (sem internet) continua sendo falha: o que já estava carregado não vira "nenhum"', async () => {
    await expect(fetchFamilyEvents(fakeDb({ data: null, error: offline }).db)).rejects.toBe(offline);
    await expect(fetchFamilyEventDays(fakeDb({ data: null, error: offline }).db)).rejects.toBe(offline);
  });

  it('com as tabelas, devolve as linhas, com a hora como HH:MM', async () => {
    const row = { id: 'e1', title: 'Natação da Ana', starts_on: '2026-10-13', start_time: '16:00:00', end_time: '17:00:00' };
    const allDay = { id: 'e2', title: 'Reunião da escola', starts_on: '2026-10-14', start_time: null, end_time: null };
    // Do mais novo para o mais antigo.
    await expect(fetchFamilyEvents(fakeDb({ data: [row, allDay], error: null }).db)).resolves.toEqual([
      allDay,
      { ...row, start_time: '16:00', end_time: '17:00' },
    ]);
    const day = { event_id: 'e1', occurs_on: '2026-10-15', cancelled: true };
    await expect(fetchFamilyEventDays(fakeDb({ data: [day], error: null }).db)).resolves.toEqual([day]);
  });

  it('a série antiga continua vindo, por mais compromissos de um dia só que a casa tenha criado depois', async () => {
    const oldSeries = { id: 'natacao', title: 'Natação da Ana', starts_on: '2020-03-03', start_time: '16:00:00', end_time: null, recurrence: 'weekly' };
    // 2500 compromissos de um dia só, todos mais novos que a série (do mais novo para o mais antigo, como o banco devolve).
    const singles = Array.from({ length: 2500 }, (_, n) => ({
      id: `s${n}`,
      title: 'Compromisso',
      starts_on: `${2026 - Math.floor(n / 300)}-${String(12 - (Math.floor(n / 25) % 12)).padStart(2, '0')}-${String(28 - (n % 25)).padStart(2, '0')}`,
      start_time: null,
      end_time: null,
      recurrence: 'none',
    }));
    const events = await fetchFamilyEvents(fakeDb({ data: [...singles, oldSeries], error: null }).db);
    expect(events.some((event) => event.id === 'natacao')).toBe(true);
    // Dos de um dia só, as duas primeiras páginas (os mais recentes).
    expect(events.filter((event) => event.recurrence === 'none')).toHaveLength(2000);
    expect(events.some((event) => event.id === 's0')).toBe(true);
    expect(events.some((event) => event.id === 's2499')).toBe(false);
  });

  it('salvar sem as tabelas avisa com clareza; os outros erros seguem como são', () => {
    expect(familyEventErrorMessage(notInCache)).toBe(FAMILY_EVENTS_UNAVAILABLE);
    expect(familyEventErrorMessage(noRelation)).toBe('Os compromissos ainda estão sendo ativados no Kotii. Tente de novo mais tarde.');
    expect(familyEventErrorMessage(offline)).toBe('TypeError: Network request failed');
  });
});
