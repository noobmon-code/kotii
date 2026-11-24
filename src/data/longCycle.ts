// Prazos de troca (domain/longCycle): o que a casa mudou (long_cycle_settings) e a última compra de cada item, até 4
// anos (long_cycle_purchases). Este é o único lugar que lê e grava os dois.
//
// A tabela e a função chegam na migração 20261122130000_long_cycle_settings.sql, e o app pode ser publicado antes
// dela: sem a tabela, os ajustes vêm como null (valem os prazos do app, e nada se grava); sem a função, a leitura
// longa vem como null (o Hoje usa só as compras dos 180 dias).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { addMonths, todayISO } from '@/domain/dates';
import {
  LONG_CYCLE_HISTORY_MONTHS,
  LONG_CYCLE_ITEMS,
  LONG_CYCLE_NOT_READY,
  longCycleFirstWords,
  type LongCycleChange,
  type LongCycleSetting,
} from '@/domain/longCycle';
import type { PurchaseRecord } from '@/domain/recentPurchases';
import { supabase, unwrap } from '@/lib/supabase';
import type { Unit } from '@/lib/types';

import { isMissingFunction, isMissingTable } from './missingSchema';

/**
 * Debaixo de 'purchaseRecords' de propósito: toda invalidação do histórico de compras (limpar o carrinho, o fim da
 * fila da lista, confirmar uma nota, mexer numa linha dela, juntar produtos, renomear um mercado) atualiza esta
 * também, e ela fica guardada no aparelho com ele (PERSISTED lê só o primeiro pedaço da chave). O setQueryData de
 * recordClearedPurchases é pela chave exata ['purchaseRecords'] e não mexe aqui: por isso o grupo do Hoje espera o
 * histórico dos 180 dias.
 */
export const LONG_CYCLE_HISTORY_KEY = ['purchaseRecords', 'longCycle'] as const;
export const LONG_CYCLE_SETTINGS_KEY = ['longCycleSettings'] as const;

const SETTING_COLUMNS = 'item_key, every_months, off, replaced_on';

type HistoryRow = {
  name: string;
  category: string;
  product_id: string | null;
  quantity: number | string;
  unit: Unit;
  bought_at: string;
  source: 'list' | 'receipt';
};

/**
 * A última compra de cada nome que pode ser um item da tabela, até LONG_CYCLE_HISTORY_MONTHS para trás (do começo do
 * dia, no fuso do aparelho). null: o banco ainda não tem a função.
 */
export async function fetchLongCycleHistory(now = new Date()): Promise<PurchaseRecord[] | null> {
  const since = addMonths(todayISO(now), -LONG_CYCLE_HISTORY_MONTHS);
  const result = await supabase.rpc('long_cycle_purchases', {
    p_words: longCycleFirstWords(),
    p_since: new Date(`${since}T00:00:00`).toISOString(),
  });
  if (result.error && isMissingFunction(result.error, 'long_cycle_purchases')) return null;
  const rows = (unwrap(result) ?? []) as HistoryRow[];
  return rows.map((row) => ({
    name: row.name,
    category: row.category,
    productId: row.product_id,
    quantity: Number(row.quantity),
    unit: row.unit,
    at: row.bought_at,
    source: row.source,
  }));
}

export function useLongCycleHistory() {
  return useQuery({ queryKey: LONG_CYCLE_HISTORY_KEY, queryFn: () => fetchLongCycleHistory() });
}

/**
 * O que a casa mudou, só dos itens que o app conhece (`.in`: no máximo um por item da tabela, e o max_rows do
 * servidor nunca corta; uma chave de uma versão mais nova nem vem). null: o banco ainda não tem a tabela.
 */
export async function fetchLongCycleSettings(): Promise<LongCycleSetting[] | null> {
  const result = await supabase
    .from('long_cycle_settings')
    .select(SETTING_COLUMNS)
    .in(
      'item_key',
      LONG_CYCLE_ITEMS.map((item) => item.key),
    );
  if (result.error && isMissingTable(result.error, 'long_cycle_settings')) return null;
  return (unwrap(result) ?? []) as LongCycleSetting[];
}

/** Guardado no aparelho (PERSISTED): sem internet, o Hoje ainda respeita o "Não sugerir mais". */
export function useLongCycleSettings() {
  return useQuery({ queryKey: LONG_CYCLE_SETTINGS_KEY, queryFn: fetchLongCycleSettings });
}

/**
 * Grava o que mudou num item: só as chaves presentes em `change` (um upsert parcial; as outras colunas ficam como
 * estão, e a casa vem do padrão da coluna). Pede a linha de volta. Nunca fica parado à espera da internet
 * (`networkMode: 'always'`, sem tentar de novo): sem conexão, falha na hora com "Sem internet agora…", e nada vai
 * para a fila guardada no aparelho.
 */
export async function saveLongCycleSetting({ itemKey, change }: { itemKey: string; change: LongCycleChange }): Promise<LongCycleSetting> {
  const result = await supabase
    .from('long_cycle_settings')
    .upsert({ item_key: itemKey, ...change }, { onConflict: 'household_id,item_key' })
    .select(SETTING_COLUMNS)
    .single();
  if (result.error && isMissingTable(result.error, 'long_cycle_settings')) throw new Error(LONG_CYCLE_NOT_READY);
  return unwrap(result) as LongCycleSetting;
}

export function useSetLongCycleSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: saveLongCycleSetting,
    onSuccess: (row) => {
      queryClient.setQueryData<LongCycleSetting[] | null>(LONG_CYCLE_SETTINGS_KEY, (rows) =>
        rows ? [...rows.filter((r) => r.item_key !== row.item_key), row] : rows,
      );
      queryClient.invalidateQueries({ queryKey: LONG_CYCLE_SETTINGS_KEY });
    },
  });
}
