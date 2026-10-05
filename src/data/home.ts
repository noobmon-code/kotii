// Despensa, tarefas da casa e remédios.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';

import { SAME_PURCHASE_DAYS, type PantryEntry } from '@/domain/cartPantry';
import { addDays, diffDays } from '@/domain/dates';
import type { MedicationSchedule } from '@/domain/medications';
import type { PantryTake } from '@/domain/pantry';
import { supabase, unwrap } from '@/lib/supabase';
import type { Chore, Medication, MedicationDose, PantryItem, Unit } from '@/lib/types';

// ---------------------------------------------------------------------------
// Despensa

const PANTRY_COLUMNS =
  'id, product_id, name, category, quantity, unit, purchased_on, expires_on, expiry_source, consumed_at';

export function usePantry() {
  return useQuery({
    queryKey: ['pantry'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('pantry_items')
          .select(PANTRY_COLUMNS)
          .is('consumed_at', null)
          .order('expires_on', { ascending: true, nullsFirst: false })
          .order('name'),
      ) as PantryItem[],
  });
}

/**
 * Entradas da despensa que não vieram de nota (carrinho ou à mão), compradas
 * perto desta data: a nota que chega depois pergunta antes de repetir.
 */
export async function fetchPantryNear(purchasedOn: string): Promise<PantryEntry[]> {
  return unwrap(
    await supabase
      .from('pantry_items')
      .select('product_id, name, purchased_on')
      .is('receipt_item_id', null)
      .gte('purchased_on', addDays(purchasedOn, -SAME_PURCHASE_DAYS))
      .lte('purchased_on', addDays(purchasedOn, SAME_PURCHASE_DAYS)),
  ) as PantryEntry[];
}

export function usePantryItem(id: string | undefined) {
  return useQuery({
    queryKey: ['pantry', id],
    enabled: Boolean(id),
    queryFn: async () =>
      unwrap(await supabase.from('pantry_items').select(PANTRY_COLUMNS).eq('id', id!).single()) as PantryItem,
  });
}

export interface PantryValues {
  name: string;
  category: string;
  quantity: number;
  unit: Unit;
  purchased_on: string;
  expires_on: string | null;
  expiry_source: PantryItem['expiry_source'];
}

export function useSavePantryItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values, productId }: { id?: string; values: PantryValues; productId?: string | null }) => {
      if (id) unwrap(await supabase.from('pantry_items').update(values).eq('id', id));
      else unwrap(await supabase.from('pantry_items').insert(values));
      // Validade corrigida à mão ensina o produto: a próxima compra já vem certa.
      if (productId && values.expiry_source === 'manual' && values.expires_on) {
        const days = Math.max(1, diffDays(values.purchased_on, values.expires_on));
        unwrap(await supabase.from('products').update({ shelf_life_days: days }).eq('id', productId));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pantry'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

/** Dá baixa nas compras (um produto inteiro na despensa, ou uma compra só). */
export function useConsumePantryItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) =>
      unwrap(await supabase.from('pantry_items').update({ consumed_at: new Date().toISOString() }).in('id', ids)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pantry'] }),
  });
}

/**
 * "Usei 1" (ver takeOne): desconta da compra mais antiga ou dá baixa nela.
 * Só grava se a compra ainda tem a quantidade lida: duas pessoas usando ao
 * mesmo tempo não contam uma vez só.
 */
export function useTakeOneFromPantry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, from, remaining }: PantryTake) => {
      const changed = unwrap(
        await supabase
          .from('pantry_items')
          .update(remaining == null ? { consumed_at: new Date().toISOString() } : { quantity: remaining })
          .eq('id', id)
          .eq('quantity', from)
          .is('consumed_at', null)
          .select('id'),
      ) as { id: string }[];
      if (!changed.length) throw new Error('A despensa mudou enquanto isso. Confira e tente de novo.');
    },
    // Também na falha: a tela mostra o que está na despensa agora.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['pantry'] }),
  });
}

// ---------------------------------------------------------------------------
// Tarefas

const CHORE_COLUMNS = 'id, title, notes, recurrence, interval_count, due_on, assigned_to, active, equipment_id, kid_id, points';

export async function fetchChores(db: SupabaseClient = supabase): Promise<Chore[]> {
  return unwrap(await db.from('chores').select(CHORE_COLUMNS).eq('active', true).order('due_on').order('title')) as Chore[];
}

export function useChores() {
  return useQuery({ queryKey: ['chores'], queryFn: () => fetchChores() });
}

export function useChore(id: string | undefined) {
  return useQuery({
    queryKey: ['chores', id],
    enabled: Boolean(id),
    queryFn: async () =>
      unwrap(await supabase.from('chores').select(CHORE_COLUMNS).eq('id', id!).single()) as Chore,
  });
}

export type ChoreValues = Pick<Chore, 'title' | 'notes' | 'recurrence' | 'interval_count' | 'due_on' | 'assigned_to'> &
  Partial<Pick<Chore, 'equipment_id' | 'kid_id' | 'points'>>;

export function useSaveChore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: ChoreValues }) =>
      id
        ? unwrap(await supabase.from('chores').update(values).eq('id', id))
        : unwrap(await supabase.from('chores').insert(values)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chores'] }),
  });
}

/** O que a conclusão fez: se registrou (toque repetido não registra), os pontos que deu e para quem. */
export interface CompleteChoreResult {
  completed: boolean;
  points: number;
  person_id: string | null;
  due_on: string;
  active: boolean;
}

export function useCompleteChore() {
  const queryClient = useQueryClient();
  return useMutation({
    // dueOn: o vencimento na tela. Se a tarefa já andou (toque duplo, outro
    // celular), o servidor não registra de novo nem credita pontos outra vez.
    mutationFn: async ({ id, today, dueOn }: { id: string; today: string; dueOn: string }) =>
      unwrap(await supabase.rpc('complete_chore', { p_chore_id: id, p_today: today, p_due_on: dueOn })) as CompleteChoreResult,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chores'] });
      queryClient.invalidateQueries({ queryKey: ['choreHistory'] });
      queryClient.invalidateQueries({ queryKey: ['kidPoints'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Pontos das crianças

/** Saldo de pontos por ficha (tarefas feitas menos prêmios trocados). */
export function useKidPoints() {
  return useQuery({
    queryKey: ['kidPoints'],
    queryFn: async () =>
      Object.fromEntries(
        (unwrap(await supabase.from('kid_points').select('person_id, balance')) as { person_id: string; balance: number }[]).map(
          (p) => [p.person_id, Number(p.balance)],
        ),
      ) as Record<string, number>,
  });
}

/**
 * Tarefas feitas e prêmios de uma criança (os mais recentes) e os pontos
 * ganhos desde `weekStart` (AAAA-MM-DD, local), somados à parte: o histórico
 * é cortado e a semana não pode ser.
 */
export function useKidHistory(personId: string, weekStart: string) {
  return useQuery({
    queryKey: ['kidPoints', personId, weekStart],
    queryFn: async () => {
      const [completions, redemptions, week] = await Promise.all([
        supabase
          .from('chore_completions')
          .select('id, points, completed_at, chore_title, chore:chores(title)')
          .eq('person_id', personId)
          .gt('points', 0)
          .order('completed_at', { ascending: false })
          .limit(30),
        supabase
          .from('point_redemptions')
          .select('id, points, created_at, title')
          .eq('person_id', personId)
          .order('created_at', { ascending: false })
          .limit(30),
        supabase
          .from('chore_completions')
          .select('points')
          .eq('person_id', personId)
          .gt('points', 0)
          .gte('completed_at', new Date(`${weekStart}T00:00:00`).toISOString()),
      ]);
      type CompletionRow = {
        id: string;
        points: number;
        completed_at: string;
        chore_title: string | null;
        chore: { title: string } | null;
      };
      return {
        completions: (unwrap(completions) as unknown as CompletionRow[]).map((c) => ({
          id: c.id,
          points: c.points,
          completed_at: c.completed_at,
          // Tarefa apagada: vale o nome guardado na conclusão.
          title: c.chore?.title ?? c.chore_title ?? 'Tarefa',
        })),
        redemptions: unwrap(redemptions) as { id: string; points: number; created_at: string; title: string }[],
        weekPoints: (unwrap(week) as { points: number }[]).reduce((sum, c) => sum + c.points, 0),
      };
    },
  });
}

export function useRedeemPoints() {
  const queryClient = useQueryClient();
  return useMutation({
    // Pela função: trava a ficha e não deixa dois prêmios ao mesmo tempo passarem do saldo.
    mutationFn: async (input: { person_id: string; title: string; points: number }) =>
      unwrap(await supabase.rpc('redeem_points', { p_person_id: input.person_id, p_title: input.title, p_points: input.points })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['kidPoints'] }),
  });
}

export function useDeleteChore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('chores').delete().eq('id', id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chores'] }),
  });
}

// ---------------------------------------------------------------------------
// Remédios

export function toSchedule(m: Medication): MedicationSchedule {
  return {
    id: m.id,
    personName: m.person_name,
    name: m.name,
    dosage: m.dosage,
    times: m.times,
    startOn: m.start_on,
    endOn: m.end_on,
    active: m.active,
    frequency: m.frequency,
    weekdays: m.weekdays,
    intervalDays: m.interval_days,
    totalDoses: m.total_doses,
    takenCount: m.taken_count,
  };
}

// Com a contagem de doses tomadas, para os tratamentos por número de doses.
const MEDICATION_COLUMNS =
  'id, person_id, person_name, name, dosage, times, start_on, end_on, notes, active, frequency, weekdays, interval_days, total_doses, medication_doses(count)';

type MedicationRow = Omit<Medication, 'taken_count'> & { medication_doses?: { count: number }[] };

const fromRow = ({ medication_doses, ...m }: MedicationRow): Medication => ({
  ...m,
  taken_count: medication_doses?.[0]?.count ?? 0,
});

export async function fetchMedications(db: SupabaseClient = supabase): Promise<Medication[]> {
  return (
    unwrap(await db.from('medications').select(MEDICATION_COLUMNS).eq('active', true).order('person_name').order('name')) as MedicationRow[]
  ).map(fromRow);
}

export function useMedications() {
  return useQuery({ queryKey: ['medications'], queryFn: () => fetchMedications() });
}

export function useMedication(id: string | undefined) {
  return useQuery({
    queryKey: ['medications', id],
    enabled: Boolean(id),
    queryFn: async () =>
      fromRow(unwrap(await supabase.from('medications').select(MEDICATION_COLUMNS).eq('id', id!).single()) as MedicationRow),
  });
}

export type MedicationValues = Pick<
  Medication,
  | 'person_id'
  | 'person_name'
  | 'name'
  | 'dosage'
  | 'times'
  | 'start_on'
  | 'end_on'
  | 'notes'
  | 'frequency'
  | 'weekdays'
  | 'interval_days'
  | 'total_doses'
>;

export function useSaveMedication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: MedicationValues }) =>
      fromRow(
        (id
          ? unwrap(await supabase.from('medications').update(values).eq('id', id).select(MEDICATION_COLUMNS).single())
          : unwrap(await supabase.from('medications').insert(values).select(MEDICATION_COLUMNS).single())) as MedicationRow,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['medications'] }),
  });
}

export function useArchiveMedication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(await supabase.from('medications').update({ active: false }).eq('id', id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['medications'] }),
  });
}

export function useDoses(date: string) {
  return useQuery({
    queryKey: ['doses', date],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('medication_doses')
          .select('id, medication_id, scheduled_on, scheduled_time, taken_at')
          .eq('scheduled_on', date),
      ) as MedicationDose[],
  });
}

export function useToggleDose(date: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ medicationId, time, taken }: { medicationId: string; time: string; taken: boolean }) => {
      if (taken) {
        unwrap(
          await supabase
            .from('medication_doses')
            .upsert(
              { medication_id: medicationId, scheduled_on: date, scheduled_time: time },
              { onConflict: 'medication_id,scheduled_on,scheduled_time', ignoreDuplicates: true },
            ),
        );
      } else {
        unwrap(
          await supabase
            .from('medication_doses')
            .delete()
            .eq('medication_id', medicationId)
            .eq('scheduled_on', date)
            .eq('scheduled_time', time),
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['doses', date] });
      // A contagem de tomadas encerra os tratamentos por número de doses.
      queryClient.invalidateQueries({ queryKey: ['medications'] });
    },
  });
}
