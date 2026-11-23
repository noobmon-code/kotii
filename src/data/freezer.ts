// Congelador da despensa: a pergunta se o banco já o tem e as duas funções que mudam as compras. As regras e as
// frases estão em domain/freezer.
//
// O congelador chega numa migração própria (20261122110000_pantry_freezer.sql), e o app pode ser publicado antes
// dela: os controles que congelam só aparecem quando pantry_freezer_available() responde true (useFreezer). Sem a
// migração, uma linha "Congelei" levaria 'congelado' a um check que não o aceita, e a nota inteira falharia. Os
// tempos são os do app (DEFAULT_FREEZE_DAYS): não há tempos por casa, e o banco refaz a data de quem grava.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { deviceDayMessage } from '@/domain/dates';
import { DEFAULT_FREEZE_DAYS, FREEZER_DAY_PURPOSE, FREEZER_NOT_READY, type FreezeDays, type FreezeKind, type FreezerRow } from '@/domain/freezer';
import type { ExpirySource } from '@/domain/pantry';
import { EXPECTS_ROWS_META } from '@/lib/accessErrors';
import { supabase, unwrap } from '@/lib/supabase';

import { isMissingColumn, isMissingFunction } from './missingSchema';

export const FREEZER_AVAILABLE_KEY = ['freezerAvailable'] as const;

/** As colunas que a migração põe em pantry_items. */
export const FREEZER_COLUMNS = ['frozen_on', 'thawed_on', 'freeze_kind', 'fresh_expires_on', 'fresh_expiry_source'] as const;

/**
 * Uma coluna do congelador que o banco (ou o cache de esquema da API) ainda não tem: a leitura repete sem elas, e a
 * gravação que as leva diz que o congelador está sendo ativado.
 */
export const isMissingFreezerColumn = (error: unknown): boolean => FREEZER_COLUMNS.some((column) => isMissingColumn(error, column));

/**
 * Este banco já tem o congelador? false quando a função não existe (antes da migração, ou o cache de esquema da API
 * de antes dela); outro erro sobe.
 */
export async function fetchFreezerAvailable(): Promise<boolean> {
  const result = await supabase.rpc('pantry_freezer_available');
  if (result.error && isMissingFunction(result.error, 'pantry_freezer_available')) return false;
  return unwrap(result) === true;
}

/** A resposta só muda quando a migração é aplicada: perguntada uma vez por abertura do app (só na memória). */
export function useFreezerAvailable() {
  return useQuery({ queryKey: FREEZER_AVAILABLE_KEY, queryFn: fetchFreezerAvailable, staleTime: Infinity });
}

/**
 * `available`: true quando o banco respondeu que tem o congelador; false quando não tem; undefined enquanto a
 * pergunta não respondeu (ou falhou sem resposta guardada). `days` só com true: toda conta do congelador (a nota, o
 * formulário) precisa deles, e sem eles nada é congelado.
 */
export function useFreezer(): { available: boolean | undefined; days: FreezeDays | null } {
  const { data } = useFreezerAvailable();
  return { available: data, days: data === true ? DEFAULT_FREEZE_DAYS : null };
}

interface RpcRow {
  item_id: string;
  item_expires_on: string | null;
  item_expiry_source: ExpirySource | null;
  item_frozen_on: string | null;
}

const toRow = (row: RpcRow): FreezerRow => ({
  id: row.item_id,
  expiresOn: row.item_expires_on,
  expirySource: row.item_expiry_source,
  frozenOn: row.item_frozen_on,
});

/**
 * O erro de congelar e descongelar na frase da tela: a função que o banco ainda não tem (o cache de esquema da API,
 * com a pergunta respondendo antes) diz que está sendo ativado; o dia fora do que o banco aceita (22023: só o dia
 * do aparelho pode estar errado, o tipo vem do app) pede para acertar a data do aparelho. O resto passa como veio.
 */
export function freezerError(error: unknown, fn: string): unknown {
  if (isMissingFunction(error, fn)) return new Error(FREEZER_NOT_READY);
  if ((error as { code?: unknown } | null)?.code === '22023') return new Error(deviceDayMessage(FREEZER_DAY_PURPOSE));
  return error;
}

async function callFreezer(fn: 'freeze_pantry_items' | 'thaw_pantry_items', args: Record<string, unknown>): Promise<FreezerRow[]> {
  const result = await supabase.rpc(fn, args);
  if (result.error) throw freezerError(result.error, fn);
  return ((result.data ?? []) as RpcRow[]).map(toRow);
}

export interface FreezeInput {
  ids: string[];
  kind: FreezeKind;
  /** O dia pedido; o banco usa, para cada compra, o mais tarde entre ele, a compra e a saída do congelador. */
  frozenOn: string;
}

/**
 * "Congelar": as compras que mudaram (a que foi consumida ou já está no congelador fica de fora). Nenhuma: a
 * despensa mudou em outro aparelho, ou a pessoa saiu da casa (EXPECTS_ROWS_META confere a casa de novo).
 */
export function useFreezePantryItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, kind, frozenOn }: FreezeInput) =>
      callFreezer('freeze_pantry_items', { p_ids: ids, p_kind: kind, p_frozen_on: frozenOn }),
    meta: EXPECTS_ROWS_META,
    // Também na falha: a tela mostra o que está na despensa agora.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['pantry'] }),
  });
}

/** "Descongelei": as compras que saíram do congelador (com frozenOn null as desfeitas no mesmo dia). */
export function useThawPantryItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, thawedOn }: { ids: string[]; thawedOn: string }) =>
      callFreezer('thaw_pantry_items', { p_ids: ids, p_thawed_on: thawedOn }),
    meta: EXPECTS_ROWS_META,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['pantry'] }),
  });
}
