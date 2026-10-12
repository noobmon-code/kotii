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

/** Um banco de mentira: toda consulta responde `result`, e guarda a tabela pedida. */
function fakeDb(result: { data: unknown; error: unknown }) {
  const tables: string[] = [];
  const query = { select: () => query, order: () => query, limit: async () => result };
  const db = {
    from: (table: string) => {
      tables.push(table);
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
    expect(events.tables).toEqual(['family_events']);
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
    await expect(fetchFamilyEvents(fakeDb({ data: [row, allDay], error: null }).db)).resolves.toEqual([
      { ...row, start_time: '16:00', end_time: '17:00' },
      allDay,
    ]);
    const day = { event_id: 'e1', occurs_on: '2026-10-15', cancelled: true };
    await expect(fetchFamilyEventDays(fakeDb({ data: [day], error: null }).db)).resolves.toEqual([day]);
  });

  it('salvar sem as tabelas avisa com clareza; os outros erros seguem como são', () => {
    expect(familyEventErrorMessage(notInCache)).toBe(FAMILY_EVENTS_UNAVAILABLE);
    expect(familyEventErrorMessage(noRelation)).toBe('Os compromissos ainda estão sendo ativados no Kotii. Tente de novo mais tarde.');
    expect(familyEventErrorMessage(offline)).toBe('TypeError: Network request failed');
  });
});
