// A moderação dos nomes dos mercados (domain/storeModeration): quem modera, a lista de CNPJs e as decisões, pelas
// funções do banco (20261023120000_store_standard_names.sql), que conferem a moderação de novo. O app pode chegar
// antes da migração: sem a is_moderator, ninguém modera e a entrada não aparece. Nada daqui fica no cache
// guardado no aparelho (as chaves não estão em PERSISTED, em lib/queryClient).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { StoreNameReview } from '@/domain/storeModeration';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

import { isMissingFunction } from './missingSchema';
import { refreshStoreNames } from './storeNameRefresh';

export const isModeratorQueryKey = (userId: string | undefined) => ['isModerator', userId] as const;
export const storeNamesReviewQueryKey = (userId: string | undefined) => ['storeNamesReview', userId] as const;

/** A pessoa modera. Sem a função no banco, não. */
export async function fetchIsModerator(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_moderator');
  if (error && isMissingFunction(error, 'is_moderator')) return false;
  if (error) throw error;
  return data === true;
}

export function useIsModerator() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({ queryKey: isModeratorQueryKey(userId), enabled: Boolean(userId), queryFn: fetchIsModerator });
}

export async function fetchStoreNamesForReview(): Promise<StoreNameReview[]> {
  const { data, error } = await supabase.rpc('store_names_for_review');
  if (error) throw error;
  return ((data ?? []) as StoreNameReview[]).map((row) => ({ ...row, nicknames: row.nicknames ?? [] }));
}

export function useStoreNamesForReview(enabled: boolean) {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: storeNamesReviewQueryKey(userId),
    enabled: enabled && Boolean(userId),
    queryFn: fetchStoreNamesForReview,
  });
}

/**
 * Escolhe o nome padrão do CNPJ (null: fica o nome da nota). O banco já o grava nos mercados das casas que não
 * deram outro nome, inclusive nos desta casa: o que mostra o nome do mercado é buscado de novo.
 */
export function useReviewStoreName() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ cnpj, name }: { cnpj: string; name: string | null }) => {
      const { error } = await supabase.rpc('review_store_name', { p_cnpj: cnpj, p_name: name });
      if (error) throw error;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: storeNamesReviewQueryKey(userId) });
      refreshStoreNames(queryClient, { sharedPrices: true });
    },
  });
}

/** Pede a consulta à Receita de novo; a resposta chega em até uns 20 minutos (o pg_cron roda a cada 10). */
export function useLookupStoreNameAgain() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (cnpj: string) => {
      const { error } = await supabase.rpc('lookup_store_name_again', { p_cnpj: cnpj });
      if (error) throw error;
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: storeNamesReviewQueryKey(userId) }),
  });
}
