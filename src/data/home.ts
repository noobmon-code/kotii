// Despensa, tarefas da casa e remédios.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { diffDays } from '@/domain/dates';
import type { MedicationSchedule } from '@/domain/medications';
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

export function useConsumePantryItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(await supabase.from('pantry_items').update({ consumed_at: new Date().toISOString() }).eq('id', id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pantry'] }),
  });
}

// ---------------------------------------------------------------------------
// Tarefas

const CHORE_COLUMNS = 'id, title, notes, recurrence, interval_count, due_on, assigned_to, active, equipment_id';

export function useChores() {
  return useQuery({
    queryKey: ['chores'],
    queryFn: async () =>
      unwrap(
        await supabase.from('chores').select(CHORE_COLUMNS).eq('active', true).order('due_on').order('title'),
      ) as Chore[],
  });
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
  Partial<Pick<Chore, 'equipment_id'>>;

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

export function useCompleteChore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, today }: { id: string; today: string }) =>
      unwrap(await supabase.rpc('complete_chore', { p_chore_id: id, p_today: today })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chores'] });
      queryClient.invalidateQueries({ queryKey: ['choreHistory'] });
    },
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
  };
}

const MEDICATION_COLUMNS = 'id, person_id, person_name, name, dosage, times, start_on, end_on, notes, active';

export function useMedications() {
  return useQuery({
    queryKey: ['medications'],
    queryFn: async () =>
      unwrap(
        await supabase.from('medications').select(MEDICATION_COLUMNS).eq('active', true).order('person_name').order('name'),
      ) as Medication[],
  });
}

export function useMedication(id: string | undefined) {
  return useQuery({
    queryKey: ['medications', id],
    enabled: Boolean(id),
    queryFn: async () =>
      unwrap(await supabase.from('medications').select(MEDICATION_COLUMNS).eq('id', id!).single()) as Medication,
  });
}

export type MedicationValues = Pick<
  Medication,
  'person_id' | 'person_name' | 'name' | 'dosage' | 'times' | 'start_on' | 'end_on' | 'notes'
>;

export function useSaveMedication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: MedicationValues }) =>
      id
        ? (unwrap(await supabase.from('medications').update(values).eq('id', id).select(MEDICATION_COLUMNS).single()) as Medication)
        : (unwrap(await supabase.from('medications').insert(values).select(MEDICATION_COLUMNS).single()) as Medication),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['doses', date] }),
  });
}
