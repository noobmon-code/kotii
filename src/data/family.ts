// Compromissos da família e o que muda em cada dia deles.
//
// As duas tabelas chegam ao banco numa migração própria, e o app pode ser
// publicado antes dela. Por isso estas consultas não derrubam ninguém: sem as
// tabelas, respondem "nenhum compromisso" (isMissingTable), e as telas que as
// usam (agenda, Hoje, avisos, Nuke) tratam qualquer falha delas como "sem
// compromissos", nunca como tela de erro. Salvar, aí sim, avisa.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useMemo } from 'react';

import { usePeople } from '@/data/health';
import { dayChangesAfterSave, type EventDayValues, type FamilyCalendar, type FamilyEventValues } from '@/domain/familyEvents';
import { errorMessage, supabase, unwrap } from '@/lib/supabase';
import type { FamilyEvent, FamilyEventDay } from '@/lib/types';

const EVENT_COLUMNS =
  'id, title, starts_on, start_time, end_time, person_id, take_by, pick_up_by, location, bring, notes, recurrence, weekdays, until_on';
const DAY_COLUMNS = 'event_id, occurs_on, cancelled, override_take, take_by, override_pick_up, pick_up_by';

/** O que a pessoa lê quando tenta salvar e o banco ainda não tem as tabelas. */
export const FAMILY_EVENTS_UNAVAILABLE = 'Os compromissos ainda estão sendo ativados no Kotii. Tente de novo mais tarde.';

/** O que a pessoa lê quando muda um dia de um compromisso que já foi apagado (em outro celular). */
export const FAMILY_EVENT_GONE = 'Este compromisso não existe mais: foi excluído. Volte para a agenda.';

/** O que a pessoa lê quando alguém do compromisso (de quem é, quem leva ou quem busca) não tem mais ficha. */
export const FAMILY_EVENT_PERSON_GONE = 'Uma das pessoas deste compromisso não está mais nas fichas da casa. Escolha de novo de quem é, quem leva e quem busca, e salve.';

/**
 * A tabela ainda não existe no banco (o app chegou antes da migração): o
 * PostgREST responde PGRST205 ("Could not find the table ... in the schema
 * cache") e o Postgres, 42P01 ("relation ... does not exist").
 */
export function isMissingTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === 'PGRST205' || code === '42P01') return true;
  return (
    typeof message === 'string' &&
    /family_event/.test(message) &&
    /does not exist|could not find the table|schema cache/i.test(message)
  );
}

/** O erro de salvar ou abrir um compromisso, em palavras de gente. */
export function familyEventErrorMessage(error: unknown): string {
  if (isMissingTable(error)) return FAMILY_EVENTS_UNAVAILABLE;
  // O banco recusou uma chave (23503). Na mudança de um dia, a chave do próprio compromisso: ele foi apagado
  // em outro celular com esta tela aberta. Nas outras, a de uma ficha escolhida no formulário, que foi apagada.
  if (error && typeof error === 'object' && (error as { code?: unknown }).code === '23503') {
    const { message, details } = error as { message?: unknown; details?: unknown };
    const text = `${typeof message === 'string' ? message : ''} ${typeof details === 'string' ? details : ''}`;
    return text.includes('family_event_days_event_id') ? FAMILY_EVENT_GONE : FAMILY_EVENT_PERSON_GONE;
  }
  return errorMessage(error);
}

// O banco devolve a hora como "16:00:00".
const hhmm = (time: string | null) => (time ? time.slice(0, 5) : null);
const fromRow = (row: FamilyEvent): FamilyEvent => ({ ...row, start_time: hhmm(row.start_time), end_time: hhmm(row.end_time) });

/** O PostgREST corta em 1000 linhas por pedido (max_rows padrão do Supabase). */
const PAGE = 1000;
/** Dos compromissos de um dia só e das mudanças de dia, bastam os mais recentes. */
const SINGLE_EVENT_PAGES = 2;
const DAY_PAGES = 5;

/** Busca página por página até vir uma incompleta (ou `maxPages`). Sem a tabela, nada. */
async function fetchPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  maxPages = Infinity,
): Promise<T[]> {
  const out: T[] = [];
  for (let n = 0; n < maxPages; n += 1) {
    const result = await page(n * PAGE, (n + 1) * PAGE - 1);
    if (result.error && isMissingTable(result.error)) return [];
    const rows = (unwrap(result as Parameters<typeof unwrap>[0]) ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Os compromissos da casa (as regras; as datas saem delas). Sem a tabela,
 * nenhum. Os que se repetem vêm todos: uma série criada há anos continua
 * valendo hoje, por mais compromissos que a casa tenha feito depois. Dos de
 * um dia só, os mais recentes.
 */
export async function fetchFamilyEvents(db: SupabaseClient = supabase): Promise<FamilyEvent[]> {
  const rules = (repeating: boolean, from: number, to: number) => {
    const query = db.from('family_events').select(EVENT_COLUMNS);
    return (repeating ? query.neq('recurrence', 'none') : query.eq('recurrence', 'none'))
      .order('starts_on', { ascending: false })
      .order('id')
      .range(from, to);
  };
  const [repeating, single] = await Promise.all([
    fetchPages<FamilyEvent>((from, to) => rules(true, from, to)),
    fetchPages<FamilyEvent>((from, to) => rules(false, from, to), SINGLE_EVENT_PAGES),
  ]);
  return [...repeating, ...single].map(fromRow).sort((a, b) => b.starts_on.localeCompare(a.starts_on));
}

/** O que muda em cada dia dos compromissos (as datas mais recentes primeiro). Sem a tabela, nada. */
export async function fetchFamilyEventDays(db: SupabaseClient = supabase): Promise<FamilyEventDay[]> {
  return fetchPages<FamilyEventDay>(
    (from, to) =>
      db
        .from('family_event_days')
        .select(DAY_COLUMNS)
        .order('occurs_on', { ascending: false })
        .order('event_id')
        .range(from, to),
    DAY_PAGES,
  );
}

export function useFamilyEvents() {
  return useQuery({ queryKey: ['familyEvents'], queryFn: () => fetchFamilyEvents() });
}

export function useFamilyEventDays() {
  return useQuery({ queryKey: ['familyEventDays'], queryFn: () => fetchFamilyEventDays() });
}

/** Um compromisso; null se não existe mais (apagado por outra pessoa). */
export function useFamilyEvent(id: string | undefined) {
  return useQuery({
    queryKey: ['familyEvents', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const row = unwrap(await supabase.from('family_events').select(EVENT_COLUMNS).eq('id', id!).maybeSingle()) as FamilyEvent | null;
      return row ? fromRow(row) : null;
    },
  });
}

/**
 * Compromissos, mudanças de cada dia e fichas, juntos, para a agenda, a tela
 * Hoje e o Nuke. Nunca dá erro: se os compromissos não carregaram, o
 * calendário vem só com as fichas (os aniversários continuam). Sem as
 * mudanças de cada dia não há compromissos: mostrar um dia que "não vai ter"
 * seria pior que não mostrar. Quem usa não espera por eles: enquanto carregam,
 * a tela segue com o que já tinha.
 */
export function useFamilyCalendar() {
  const people = usePeople();
  const events = useFamilyEvents();
  const days = useFamilyEventDays();
  const calendar = useMemo<FamilyCalendar>(
    () => ({ events: events.data && days.data ? events.data : [], days: days.data ?? [], people: people.data ?? [] }),
    [events.data, days.data, people.data],
  );
  const { refetch: refetchEvents } = events;
  const { refetch: refetchDays } = days;
  const refetch = useCallback(() => {
    refetchEvents();
    refetchDays();
  }, [refetchEvents, refetchDays]);
  return { calendar, refetch };
}

function useInvalidateFamilyEvents() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['familyEvents'] });
    queryClient.invalidateQueries({ queryKey: ['familyEventDays'] });
  };
}

/**
 * Cria ou muda o compromisso (mudar vale para todas as vezes). Ao mudar, a
 * regra ou as pessoas podem ter mudado: saem as mudanças de dias que não são
 * mais do compromisso (todas, se ele deixou de se repetir) e as que ficaram
 * iguais ao de sempre (dayChangesAfterSave). Se essa limpeza falhar, o
 * salvar falha junto: a pessoa toca em Salvar de novo e ela termina. Calada,
 * uma mudança igual ao de sempre ficaria guardada e voltaria do nada numa
 * mudança seguinte do compromisso.
 */
export async function saveFamilyEvent(
  { id, values }: { id?: string; values: FamilyEventValues },
  db: SupabaseClient = supabase,
): Promise<void> {
  if (!id) {
    unwrap(await db.from('family_events').insert(values));
    return;
  }
  unwrap(await db.from('family_events').update(values).eq('id', id));
  const rows = unwrap(await db.from('family_event_days').select(DAY_COLUMNS).eq('event_id', id)) as FamilyEventDay[];
  const { remove, rewrite } = dayChangesAfterSave(values, rows);
  if (remove.length) unwrap(await db.from('family_event_days').delete().eq('event_id', id).in('occurs_on', remove));
  if (rewrite.length) {
    unwrap(
      await db
        .from('family_event_days')
        .upsert(rewrite.map((change) => ({ event_id: id, ...change })), { onConflict: 'event_id,occurs_on' }),
    );
  }
}

export function useSaveFamilyEvent() {
  const invalidate = useInvalidateFamilyEvents();
  return useMutation({
    mutationFn: (input: { id?: string; values: FamilyEventValues }) => saveFamilyEvent(input),
    // Também na falha: o compromisso pode ter sido gravado e só a limpeza dos dias ter ficado pela metade.
    onSettled: invalidate,
  });
}

/** Apaga o compromisso, com todas as vezes e as mudanças de cada dia (em cascata, no banco). */
export function useDeleteFamilyEvent() {
  const invalidate = useInvalidateFamilyEvents();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('family_events').delete().eq('id', id)),
    onSuccess: invalidate,
  });
}

/**
 * Grava o que muda num dia do compromisso (normalizeDayChange); `change`
 * nulo: nada mudou, a linha do dia sai.
 */
export function useSaveFamilyEventDay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ eventId, date, change }: { eventId: string; date: string; change: EventDayValues | null }) =>
      change
        ? unwrap(await supabase.from('family_event_days').upsert({ event_id: eventId, occurs_on: date, ...change }, { onConflict: 'event_id,occurs_on' }))
        : unwrap(await supabase.from('family_event_days').delete().eq('event_id', eventId).eq('occurs_on', date)),
    onSuccess: (_data, { eventId, date, change }) => {
      // Já na tela, sem esperar a busca: o próximo toque parte do que acabou de ser gravado.
      queryClient.setQueryData<FamilyEventDay[]>(['familyEventDays'], (rows) =>
        rows && [
          ...rows.filter((row) => !(row.event_id === eventId && row.occurs_on === date)),
          ...(change ? [{ event_id: eventId, occurs_on: date, ...change }] : []),
        ],
      );
      queryClient.invalidateQueries({ queryKey: ['familyEventDays'] });
    },
  });
}
