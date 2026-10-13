// Juntar produtos: os pares "São diferentes" da casa, as compras de cada
// produto e a função do banco que junta (merge_products).
//
// A tabela e a função chegam numa migração própria, e o app pode ser
// publicado antes dela. Sem a tabela, os pares vêm como null e a sugestão não
// aparece (o app não teria como guardar o "São diferentes"); sem a função,
// juntar avisa que ainda não está disponível.

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  MERGE_BLOCKED,
  MERGE_PRODUCT_GONE,
  MERGE_UNAVAILABLE,
  MERGE_UNAVAILABLE_TITLE,
  orderedPair,
  type DistinctPair,
  type MergeMoved,
  type PurchaseCounts,
} from '@/domain/productMerge';
import { errorMessage, supabase, unwrap } from '@/lib/supabase';

import { isMissingFunction, isMissingTable } from './missingSchema';

/** O servidor devolve até 1000 linhas por pedido (max_rows padrão do Supabase). */
const PAGE = 1000;

/** Os pares que a casa disse serem produtos diferentes; null quando o banco ainda não tem a tabela. */
export async function fetchDistinctPairs(): Promise<DistinctPair[] | null> {
  const pairs: DistinctPair[] = [];
  for (let from = 0; ; from += PAGE) {
    const result = await supabase
      .from('product_distinct_pairs')
      .select('product_a, product_b')
      .order('product_a')
      .order('product_b')
      .range(from, from + PAGE - 1);
    if (result.error && isMissingTable(result.error, 'product_distinct_pairs')) return null;
    const rows = (unwrap(result) ?? []) as DistinctPair[];
    pairs.push(...rows);
    if (rows.length < PAGE) return pairs;
  }
}

export function useDistinctPairs() {
  return useQuery({ queryKey: ['productDistinctPairs'], queryFn: fetchDistinctPairs });
}

/** "São diferentes": o par não volta como sugestão, para ninguém da casa. */
export function useMarkDistinct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ a, b }: { a: string; b: string }) => {
      const { error } = await supabase.from('product_distinct_pairs').insert(orderedPair(a, b));
      // Outra pessoa da casa já tinha marcado o mesmo par (23505): é o que se queria.
      if (error && error.code !== '23505') throw error;
    },
    // Um dos dois sumiu por outro aparelho: a lista de produtos da tela ficou velha.
    onError: (error) => (isProductGone(error) ? queryClient.invalidateQueries({ queryKey: ['products'] }) : undefined),
    onSuccess: (_data, { a, b }) => {
      // O par sai da tela já, sem esperar a busca.
      queryClient.setQueryData<DistinctPair[] | null>(['productDistinctPairs'], (pairs) => (pairs ? [...pairs, orderedPair(a, b)] : pairs));
      queryClient.invalidateQueries({ queryKey: ['productDistinctPairs'] });
    },
  });
}

/** Quantos ids vão num pedido: a lista vai no endereço, que tem limite de tamanho. */
const ID_CHUNK = 100;

/**
 * As compras de cada produto pedido: linhas de notas confirmadas (o rascunho
 * não conta), página por página. Produto sem compra vem com zero.
 */
export async function fetchPurchaseCounts(productIds: readonly string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = Object.fromEntries(productIds.map((id) => [id, 0]));
  for (let at = 0; at < productIds.length; at += ID_CHUNK) {
    const ids = productIds.slice(at, at + ID_CHUNK);
    for (let from = 0; ; from += PAGE) {
      const rows = (unwrap(
        await supabase
          .from('receipt_items')
          .select('product_id, receipt:receipts!inner(status)')
          .eq('receipt.status', 'confirmed')
          .in('product_id', ids)
          // Uma ordem que não empata: sem ela as páginas não se encaixam.
          .order('id')
          .range(from, from + PAGE - 1),
      ) ?? []) as { product_id: string }[];
      for (const row of rows) counts[row.product_id] = (counts[row.product_id] ?? 0) + 1;
      if (rows.length < PAGE) break;
    }
  }
  return counts;
}

/**
 * As compras de cada produto. A chave começa com `priceHistory`: confirmar ou excluir uma nota já busca de
 * novo. `keepPrevious`: enquanto a contagem de uma lista nova de produtos não chega, fica a da lista de antes
 * (quem usa confere se ela traz os produtos que quer).
 */
export function usePurchaseCounts(productIds: readonly string[], { keepPrevious = false }: { keepPrevious?: boolean } = {}) {
  const ids = [...new Set(productIds)].sort();
  return useQuery({
    queryKey: ['priceHistory', 'counts', ids],
    enabled: ids.length > 0,
    placeholderData: keepPrevious ? keepPreviousData : undefined,
    queryFn: (): Promise<PurchaseCounts> => fetchPurchaseCounts(ids),
  });
}

/**
 * Tudo o que mostrava um dos dois produtos e precisa ser buscado de novo:
 * o que confirmar uma nota atualiza (useConfirmReceipt), o que renomear um
 * produto atualiza (useRenameProduct) e os pares "São diferentes".
 */
export const MERGE_REFRESHES = [
  'products',
  'latestPrices',
  'priceHistory',
  'receipts',
  'receipt',
  'pantry',
  'spending',
  'purchaseRecords',
  'lists',
  'listItems',
  'listLinks',
  'productDistinctPairs',
] as const;

/**
 * O produto já não existe: outra pessoa da casa juntou ou apagou antes. É o P0002 de merge_products e, ao
 * gravar um par, a chave estrangeira que não acha o produto (23503).
 */
function isProductGone(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'P0002' || code === '23503';
}

/** `mergeId` deixa de existir e tudo o que era dele passa para `keepId`, no banco, de uma vez. Não dá para desfazer. */
export function useMergeProducts() {
  const queryClient = useQueryClient();
  const refresh = () => {
    for (const key of MERGE_REFRESHES) queryClient.invalidateQueries({ queryKey: [key] });
  };
  return useMutation({
    mutationFn: async ({ keepId, mergeId }: { keepId: string; mergeId: string }): Promise<MergeMoved> => {
      const moved = unwrap(await supabase.rpc('merge_products', { p_keep: keepId, p_merge: mergeId })) as Partial<MergeMoved>;
      return { purchases: Number(moved.purchases ?? 0), pantry: Number(moved.pantry ?? 0), list: Number(moved.list ?? 0) };
    },
    onSuccess: refresh,
    // O produto sumiu por outro aparelho: o que está na tela ficou velho.
    onError: (error) => (isProductGone(error) ? refresh() : undefined),
  });
}

/** O aviso para um erro de juntar ou de marcar "São diferentes", em palavras de gente. */
export function mergeErrorNotice(error: unknown): { title: string; message: string } {
  if (isMissingFunction(error, 'merge_products') || isMissingTable(error, 'product_distinct_pairs')) {
    return { title: MERGE_UNAVAILABLE_TITLE, message: MERGE_UNAVAILABLE };
  }
  if (isProductGone(error)) return { title: 'Erro', message: MERGE_PRODUCT_GONE };
  // A trava de merge_products: alguma linha não trocou de produto, e a função desfez tudo.
  if ((error as { code?: unknown } | null)?.code === '55000') return { title: 'Erro', message: MERGE_BLOCKED };
  return { title: 'Erro', message: errorMessage(error) };
}
