import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { FamilyEventValues } from '@/domain/familyEvents';

import {
  FAMILY_EVENT_GONE,
  FAMILY_EVENT_PERSON_GONE,
  FAMILY_EVENTS_UNAVAILABLE,
  familyEventErrorMessage,
  fetchFamilyEventDays,
  fetchFamilyEvents,
  isMissingTable,
  saveFamilyEvent,
} from '../family';

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

/**
 * Um banco de mentira para o salvar: guarda cada operação ("tabela.verbo") e responde o que `answer`
 * disser para ela (sem resposta combinada, dá certo e não devolve nada).
 */
function savingDb(answer: (op: string) => { data: unknown; error: unknown } | undefined) {
  const ops: { op: string; args: unknown[] }[] = [];
  const db = {
    from: (table: string) => {
      let op = table;
      const query: Record<string, unknown> = {
        // Sem resposta combinada: dá certo. O "mudar" devolve a linha mudada, como o banco quando ela existe.
        then: (resolve: (value: { data: unknown; error: unknown }) => void) =>
          resolve(answer(op) ?? { data: op === 'family_events.update' ? { id: 'e1' } : null, error: null }),
      };
      for (const verb of ['insert', 'update', 'select', 'delete', 'upsert']) {
        query[verb] = (...args: unknown[]) => {
          // O `select` depois de gravar só pede a linha de volta: é o mesmo pedido.
          if (verb === 'select' && op !== table) return query;
          op = `${table}.${verb}`;
          ops.push({ op, args });
          return query;
        };
      }
      for (const filter of ['eq', 'in', 'maybeSingle']) query[filter] = () => query;
      return query;
    },
  };
  return { db: db as unknown as SupabaseClient, ops };
}

describe('salvar o compromisso', () => {
  const values = {
    title: 'Natação da Ana',
    starts_on: '2026-10-13',
    start_time: '16:00',
    end_time: null,
    person_id: 'ana',
    take_by: 'vo',
    pick_up_by: 'carla',
    location: null,
    bring: null,
    notes: null,
    recurrence: 'weekly',
    weekdays: [2, 4],
    until_on: null,
  } as FamilyEventValues;
  // Na quinta 15 a vó já levava (agora é o de sempre); na terça 20 o Beto busca.
  const days = [
    { event_id: 'e1', occurs_on: '2026-10-15', cancelled: false, override_take: true, take_by: 'vo', override_pick_up: false, pick_up_by: null },
    { event_id: 'e1', occurs_on: '2026-10-20', cancelled: false, override_take: true, take_by: 'vo', override_pick_up: true, pick_up_by: 'beto' },
  ];

  it('novo: só grava o compromisso', async () => {
    const { db, ops } = savingDb(() => undefined);
    await saveFamilyEvent({ values }, db);
    expect(ops.map((o) => o.op)).toEqual(['family_events.insert']);
  });

  it('ao mudar, tira as mudanças de dia que ficaram iguais ao de sempre e reescreve as que mudaram em parte', async () => {
    const { db, ops } = savingDb((op) => (op === 'family_event_days.select' ? { data: days, error: null } : undefined));
    await saveFamilyEvent({ id: 'e1', values }, db);
    expect(ops.map((o) => o.op)).toEqual(['family_events.update', 'family_event_days.select', 'family_event_days.delete', 'family_event_days.upsert']);
    expect(ops[3].args[0]).toEqual([
      { event_id: 'e1', occurs_on: '2026-10-20', cancelled: false, override_take: false, take_by: null, override_pick_up: true, pick_up_by: 'beto' },
    ]);
  });

  it('o compromisso foi excluído em outro celular: mudar não "dá certo" calado, e a limpeza dos dias nem começa', async () => {
    // O banco responde sem erro e sem linha nenhuma mudada.
    const gone = savingDb((op) => (op === 'family_events.update' ? { data: null, error: null } : undefined));
    await expect(saveFamilyEvent({ id: 'e1', values }, gone.db)).rejects.toThrow(FAMILY_EVENT_GONE);
    expect(gone.ops.map((o) => o.op)).toEqual(['family_events.update']);
    const error = await saveFamilyEvent({ id: 'e1', values }, gone.db).catch((e: unknown) => e);
    expect(familyEventErrorMessage(error)).toBe('Este compromisso não existe mais: foi excluído. Volte para a agenda.');
  });

  it('se a limpeza dos dias falha, o salvar falha junto (tocar em Salvar de novo termina)', async () => {
    const offlineError = { message: 'TypeError: Network request failed' };
    const reading = savingDb((op) => (op === 'family_event_days.select' ? { data: null, error: offlineError } : undefined));
    await expect(saveFamilyEvent({ id: 'e1', values }, reading.db)).rejects.toBe(offlineError);
    const deleting = savingDb((op) =>
      op === 'family_event_days.select' ? { data: days, error: null } : op === 'family_event_days.delete' ? { data: null, error: offlineError } : undefined,
    );
    await expect(saveFamilyEvent({ id: 'e1', values }, deleting.db)).rejects.toBe(offlineError);
    // O compromisso em si não gravou: nem tenta a limpeza.
    const updating = savingDb((op) => (op === 'family_events.update' ? { data: null, error: offlineError } : undefined));
    await expect(saveFamilyEvent({ id: 'e1', values }, updating.db)).rejects.toBe(offlineError);
    expect(updating.ops.map((o) => o.op)).toEqual(['family_events.update']);
  });
});

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
    // A ficha de quem leva foi apagada com o formulário aberto: o banco recusa a chave, e a pessoa lê o que fazer.
    const gone = { code: '23503', message: 'insert or update on table "family_events" violates foreign key constraint "family_events_take_by_household_id_fkey"' };
    expect(familyEventErrorMessage(gone)).toBe(FAMILY_EVENT_PERSON_GONE);
    // A mesma recusa na mudança de um dia, pela chave do próprio compromisso: ele foi excluído em outro celular.
    const deleted = { code: '23503', message: 'insert or update on table "family_event_days" violates foreign key constraint "family_event_days_event_id_household_id_fkey"' };
    expect(familyEventErrorMessage(deleted)).toBe(FAMILY_EVENT_GONE);
    expect(FAMILY_EVENT_GONE).toBe('Este compromisso não existe mais: foi excluído. Volte para a agenda.');
    // A ficha de quem ia levar naquele dia, apagada: é a chave de uma pessoa.
    const driver = { code: '23503', message: 'insert or update on table "family_event_days" violates foreign key constraint "family_event_days_take_by_household_id_fkey"' };
    expect(familyEventErrorMessage(driver)).toBe(FAMILY_EVENT_PERSON_GONE);
    expect(FAMILY_EVENT_PERSON_GONE).toBe('Uma das pessoas deste compromisso não está mais nas fichas da casa. Escolha de novo de quem é, quem leva e quem busca, e salve.');
  });
});
