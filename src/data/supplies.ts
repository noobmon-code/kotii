// O que acaba sem nota fiscal (gás, água, ração): as reposições da casa com
// as últimas trocas de cada uma. A previsão sai delas em src/domain/supplies.ts.

import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useRef } from 'react';

import type { SupplyValues } from '@/domain/supplies';
import { supabase, unwrap } from '@/lib/supabase';
import type { Supply, SupplyRefill } from '@/lib/types';

/** Trocas trazidas por reposição: a previsão usa os 5 últimos intervalos; o resto é histórico para a tela. */
export const REFILLS_PER_SUPPLY = 12;
/** Uma casa tem meia dúzia; o teto só impede uma resposta sem fim. */
const SUPPLIES_LIMIT = 100;

// Sem apelido na tabela das trocas: a ordem e o limite abaixo valem por ela, pelo nome.
const SUPPLY_COLUMNS = 'id, name, kind, typical_days, notes, created_at, supply_refills(id, refilled_on)';

type SupplyRow = Omit<Supply, 'refills'> & { supply_refills: SupplyRefill[] | null };

export const SUPPLIES_NOT_READY =
  'Os avisos de gás, água e ração ainda estão sendo ativados no Kotii. Tente de novo mais tarde.';

/**
 * O app pode ser publicado antes de as tabelas existirem (a migration é
 * aplicada à parte). Tabela que o PostgREST não conhece dá PGRST205 (42P01
 * quando o erro vem direto do Postgres); PGRST200 é ele já conhecer
 * `supplies`, mas ainda não a ligação com as trocas.
 */
export function isSuppliesMissing(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return code === 'PGRST205' || code === '42P01' || code === 'PGRST200';
}

export interface SuppliesData {
  /** false: este banco ainda não tem as tabelas. As telas tratam como "nenhuma reposição" e nem mostram a seção. */
  available: boolean;
  supplies: Supply[];
}

/**
 * As reposições da casa, cada uma com as 12 trocas mais recentes (o limite é
 * por reposição, aplicado pelo servidor). Sem as tabelas, não é erro: devolve
 * `available: false`, para a Despensa, a tela Hoje, os avisos e o Nuke
 * seguirem como antes.
 */
export async function fetchSupplies(db: SupabaseClient = supabase): Promise<SuppliesData> {
  const result = await db
    .from('supplies')
    .select(SUPPLY_COLUMNS)
    .order('created_at')
    .order('refilled_on', { referencedTable: 'supply_refills', ascending: false })
    .limit(REFILLS_PER_SUPPLY, { referencedTable: 'supply_refills' })
    .limit(SUPPLIES_LIMIT);
  if (isSuppliesMissing(result.error)) return { available: false, supplies: [] };
  const rows = unwrap(result) as unknown as SupplyRow[];
  return { available: true, supplies: rows.map(({ supply_refills, ...supply }) => ({ ...supply, refills: supply_refills ?? [] })) };
}

export function useSupplies() {
  return useQuery({ queryKey: ['supplies'], queryFn: () => fetchSupplies() });
}

/** Gravação: sem as tabelas, o aviso diz o que está acontecendo em vez do texto do banco. */
function written<T>(result: { data: T; error: unknown }): NonNullable<T> {
  if (isSuppliesMissing(result.error)) throw new Error(SUPPLIES_NOT_READY);
  return unwrap(result);
}

export const SUPPLY_GONE = 'Esta reposição não existe mais.';

/**
 * Anota a troca de um dia. Uma por dia: o segundo toque (ou outra pessoa da
 * casa anotando a mesma troca) cai no `unique` e é ignorado, sem erro.
 */
async function recordRefill(supplyId: string, date: string): Promise<void> {
  const result = await supabase
    .from('supply_refills')
    .upsert({ supply_id: supplyId, refilled_on: date }, { onConflict: 'supply_id,refilled_on', ignoreDuplicates: true });
  // A chave estrangeira recusou: outra pessoa da casa excluiu a reposição e esta tela ainda a mostrava.
  if (result.error?.code === '23503') throw new Error(SUPPLY_GONE);
  written(result);
}

export function useSaveSupply() {
  const queryClient = useQueryClient();
  // Criada, mas a primeira troca não gravou: salvar de novo atualiza a mesma, em vez de criar outra.
  const created = useRef<string | null>(null);
  return useMutation({
    /** `startedOn`: quando começou o atual (só ao criar); vira a primeira troca. */
    mutationFn: async ({ id, values, startedOn }: { id?: string; values: SupplyValues; startedOn?: string | null }) => {
      let supplyId = id ?? created.current;
      if (supplyId) {
        written(await supabase.from('supplies').update(values).eq('id', supplyId));
      } else {
        supplyId = (written(await supabase.from('supplies').insert(values).select('id').single()) as { id: string }).id;
        created.current = supplyId;
      }
      if (startedOn) await recordRefill(supplyId, startedOn);
      return supplyId;
    },
    // Também na falha: a reposição pode ter sido criada antes de a troca falhar.
    onSettled: (_data, error) => settled(queryClient, error),
  });
}

/**
 * Depois de gravar (ou de falhar), a lista é buscada de novo. No sucesso a ação espera por ela, para a tela já
 * mostrar a previsão nova; na falha, não: com a rede ruim essa busca insiste por vários segundos, e o aviso do
 * erro tem de aparecer na hora.
 */
function settled(queryClient: QueryClient, error: unknown) {
  const refetched = queryClient.invalidateQueries({ queryKey: ['supplies'] });
  return error ? undefined : refetched;
}

export function useRecordRefill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ supplyId, date }: { supplyId: string; date: string }) => recordRefill(supplyId, date),
    // Também na falha: se a reposição foi excluída por outra pessoa, a linha velha some da tela.
    onSettled: (_data, error) => settled(queryClient, error),
  });
}

/** Apaga uma troca anotada por engano; a previsão é refeita sem ela. */
export function useDeleteRefill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => written(await supabase.from('supply_refills').delete().eq('id', id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['supplies'] }),
  });
}

/** Apaga a reposição; as trocas dela saem junto, em cascata no banco. */
export function useDeleteSupply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => written(await supabase.from('supplies').delete().eq('id', id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['supplies'] }),
  });
}
