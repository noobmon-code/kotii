// Cardápio da semana: pratos por dia e refeição, e a sugestão do Nuke.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { functionErrorMessage } from '@/data/images';
import type { Meal, MenuItem, MenuSuggestionDay } from '@/domain/menu';
import { supabase, unwrap } from '@/lib/supabase';
import type { Unit } from '@/lib/types';

/** Pratos de `from` a `to` (inclusive, AAAA-MM-DD). */
export function useMenu(from: string, to: string) {
  return useQuery({
    queryKey: ['menu', from, to],
    queryFn: async () =>
      unwrap(
        await supabase.from('menu_items').select('id, day, meal, dish').gte('day', from).lte('day', to).order('day'),
      ) as MenuItem[],
  });
}

function useInvalidateMenu() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['menu'] });
}

/** Grava o prato da refeição; vazio tira o prato. */
export function useSaveMenuItem() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: async ({ day, meal, dish }: { day: string; meal: Meal; dish: string }) =>
      dish.trim()
        ? unwrap(await supabase.from('menu_items').upsert({ day, meal, dish: dish.trim() }, { onConflict: 'household_id,day,meal' }))
        : unwrap(await supabase.from('menu_items').delete().eq('day', day).eq('meal', meal)),
    onSuccess: invalidate,
  });
}

/** Usa a sugestão: cada prato sugerido entra no lugar do que estava na refeição. */
export function useApplyMenu() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: async (items: { day: string; meal: Meal; dish: string }[]) =>
      unwrap(await supabase.from('menu_items').upsert(items, { onConflict: 'household_id,day,meal' })),
    onSuccess: invalidate,
  });
}

export interface MenuSuggestion {
  days: MenuSuggestionDay[];
  shopping: { name: string; quantity: number; unit: Unit; category: string }[];
  note: string;
}

export function useSuggestMenu() {
  return useMutation({
    mutationFn: async (input: { context: string; today: string; weekStart: string; preferences: string }) => {
      const { data, error } = await supabase.functions.invoke<MenuSuggestion>('nuke', { body: { mode: 'menu', ...input } });
      if (error || !data) throw new Error(await functionErrorMessage(error, 'Não consegui montar o cardápio agora. Tente de novo.'));
      return { days: data.days ?? [], shopping: data.shopping ?? [], note: String(data.note ?? '') } satisfies MenuSuggestion;
    },
  });
}
