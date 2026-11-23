// Excluir um produto que não está em nenhuma nota: a leitura que a pergunta faz no toque (fetchDeleteFacts), a
// função do banco que exclui (delete_product) e o que precisa ser buscado de novo depois. As regras e as frases
// estão em domain/productDelete.
//
// A função chega numa migração própria (20261122100000_delete_product.sql), e o app pode ser publicado antes
// dela: o botão só aparece quando delete_product_available() responde true (useDeleteProductAvailable). Sem a
// função, excluir avisa que ainda não está disponível. Não há plano B de apagar direto na tabela: isso soltaria
// das linhas de nota o produto, que é justamente o que a função recusa.

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { toISODate } from '@/domain/dates';
import {
  DELETE_BLOCKED,
  DELETE_CHECK_FAILED,
  DELETE_FAILED_TITLE,
  DELETE_GONE_TITLE,
  DELETE_IN_REVIEW,
  DELETE_IN_REVIEW_TITLE,
  DELETE_NO_ANSWER,
  DELETE_NO_ANSWER_TITLE,
  DELETE_PURCHASED,
  DELETE_PURCHASED_TITLE,
  DELETE_RENAMED,
  DELETE_RENAMED_TITLE,
  DELETE_UNAVAILABLE,
  DELETE_UNAVAILABLE_TITLE,
  isProductInReview,
  isProductPurchased,
  PRODUCT_NOT_IN_HOUSE,
  type DeleteFacts,
  type DraftRef,
} from '@/domain/productDelete';
import { carriedDistinctPairs, isProductRenamed, type DistinctPair } from '@/domain/productMerge';
import type { ProductName } from '@/domain/similarNames';
import { isDeadlock } from '@/lib/databaseErrors';
import { errorMessage, supabase, unwrap } from '@/lib/supabase';

import { isMissingFunction, isMissingTable } from './missingSchema';
import { isProductGone, openListRow, openPantryRow } from './productMerge';

/** Quanto a leitura antes da pergunta espera (não é o DELETE_CHECK_MS de data/providers, de 4 s). */
export const PRODUCT_DELETE_CHECK_MS = 10_000;
/** Quanto esperar a resposta de delete_product antes de desistir do pedido (o mesmo prazo de juntar). */
export const PRODUCT_DELETE_TIMEOUT_MS = 25_000;
/** Quanto esperar a gravação dos pares "São diferentes" que passam para os gêmeos de nome (carriedDistinctPairs). */
export const PAIRS_CARRY_MS = 10_000;

/** O rascunho como vem do banco: a nota, com o dia e o mercado. */
interface DraftRow {
  receipt_id: string;
  receipt: { purchased_at: string; store: { name: string } | null } | null;
}

/**
 * O que a pergunta precisa saber, lido do banco agora: pedidos pequenos, só deste produto (nunca as listas da
 * casa, que o servidor corta em max_rows, calado), todos cortados em PRODUCT_DELETE_CHECK_MS. O produto (zero
 * linhas: não está mais na casa); se uma linha de nota confirmada aponta para ele; um rascunho que tem uma linha
 * dele (o mercado e o dia, para a recusa dizer qual é); se está na despensa aberta ou numa lista que não foi
 * arquivada; e os códigos de barras (quantos, e o primeiro). Uma parte que falha derruba a leitura: a pergunta
 * nunca sai de um pedaço. Sem a tabela dos códigos (o banco de antes deles), zero códigos.
 */
export async function fetchDeleteFacts(productId: string): Promise<DeleteFacts> {
  const controller = new AbortController();
  const { signal } = controller;
  const timer = setTimeout(() => controller.abort(), PRODUCT_DELETE_CHECK_MS);
  try {
    const [found, bought, draft, pantry, list, codes] = await Promise.all([
      supabase.from('products').select('id, name').eq('id', productId).abortSignal(signal),
      supabase
        .from('receipt_items')
        .select('id, receipt:receipts!inner(status)')
        .eq('product_id', productId)
        .eq('receipt.status', 'confirmed')
        .limit(1)
        .abortSignal(signal),
      supabase
        .from('receipt_items')
        .select('receipt_id, receipt:receipts!inner(status, purchased_at, store:stores(name))')
        .eq('product_id', productId)
        .eq('receipt.status', 'draft')
        .limit(1)
        .abortSignal(signal),
      openPantryRow(productId).abortSignal(signal),
      openListRow(productId).abortSignal(signal),
      supabase
        .from('product_barcodes')
        .select('gtin', { count: 'exact' })
        .eq('product_id', productId)
        .order('gtin')
        .limit(1)
        .abortSignal(signal),
    ]);
    const product = ((unwrap(found) ?? []) as { id: string; name: string }[])[0] ?? null;
    const purchased = ((unwrap(bought) ?? []) as unknown[]).length > 0;
    const draftRow = ((unwrap(draft) ?? []) as unknown as DraftRow[])[0];
    const review: DraftRef | null = draftRow
      ? {
          receiptId: draftRow.receipt_id,
          store: draftRow.receipt?.store?.name ?? null,
          day: toISODate(draftRow.receipt?.purchased_at ? new Date(draftRow.receipt.purchased_at) : new Date()),
        }
      : null;
    const inPantry = ((unwrap(pantry) ?? []) as unknown[]).length > 0;
    const onList = ((unwrap(list) ?? []) as unknown[]).length > 0;
    let barcodes: DeleteFacts['barcodes'];
    if (codes.error && isMissingTable(codes.error, 'product_barcodes')) barcodes = { count: 0, first: null };
    else {
      const rows = (unwrap(codes) ?? []) as { gtin: string }[];
      barcodes = { count: codes.count ?? rows.length, first: rows[0]?.gtin ?? null };
    }
    return { product: product && { id: product.id, name: product.name }, purchased, review, inPantry, onList, barcodes };
  } catch (error) {
    // Só este prazo corta os pedidos: nada foi tentado, a pessoa tenta de novo.
    throw signal.aborted ? new Error(DELETE_CHECK_FAILED) : error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * O que mostrava o produto excluído e precisa ser buscado de novo: as tabelas que delete_product muda (por set
 * null ou cascade). Está contido em MERGE_REFRESHES (um teste confere as duas listas).
 */
export const DELETE_REFRESHES = [
  'products', // products; e as compras de cada um, nas sugestões de juntar (priceHistory)
  'priceHistory',
  'pantry', // pantry_items (set null)
  'lists', // shopping_list_items (set null)
  'listItems',
  'purchaseRecords', // purchase_history (set null)
  'productAliases', // product_aliases (cascade); os preços de outras casas chegam pelos apelidos e códigos da casa
  'sharedPrices',
  'listLinks', // list_item_links (cascade)
  'productBarcodes', // product_barcodes (cascade)
  'productDistinctPairs', // product_distinct_pairs (cascade)
] as const; // product_store_codes não tem busca no app

/** Busca de novo tudo o que mostrava o produto excluído (DELETE_REFRESHES), menos o que `except` diz. */
export function refreshDeletedProduct(queryClient: QueryClient, { except = [] }: { except?: readonly string[] } = {}): void {
  for (const key of DELETE_REFRESHES) if (!except.includes(key)) queryClient.invalidateQueries({ queryKey: [key] });
}

/** O pedido de excluir foi cortado sem resposta (PRODUCT_DELETE_TIMEOUT_MS): pode ter excluído, ou não. */
export const isDeleteUnanswered = (error: unknown) => error instanceof Error && error.message === DELETE_NO_ANSWER;

/** O que delete_product devolveu: o que perdeu a ligação (para os testes; a tela só sai), e os pares que passaram. */
export interface DeleteResult {
  pantry: number;
  list: number;
  barcodes: number;
  carry: DistinctPair[];
}

/**
 * Grava os pares que passam para os gêmeos de nome do produto excluído (carriedDistinctPairs). É o melhor que dá:
 * qualquer erro (um produto do par juntado ou excluído nesse meio-tempo, 23503; sem internet) fica calado, e o que
 * custa é a sugestão recusada voltar, como era antes. Roda depois da resposta, então nunca segura a tela.
 */
async function storeCarriedPairs(carry: readonly DistinctPair[]): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAIRS_CARRY_MS);
  try {
    await supabase.from('product_distinct_pairs').upsert(carry, { ignoreDuplicates: true }).abortSignal(controller.signal);
  } catch {
    // Calado: ver acima.
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Exclui o produto, no banco, de uma vez. Não dá para desfazer. O nome vai junto: a leitura da pergunta é de
 * alguns segundos antes do toque, e o banco recusa (NK008, sem mudar nada) se ele já tem outro nome.
 */
export function useDeleteProduct() {
  const queryClient = useQueryClient();
  const refresh = () => refreshDeletedProduct(queryClient);
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string | null }): Promise<DeleteResult> => {
      // Os pares a passar saem do que a tela tinha antes do pedido: depois dele, os do produto já não existem.
      const carry = carriedDistinctPairs(
        id,
        queryClient.getQueryData<ProductName[]>(['products']),
        queryClient.getQueryData<DistinctPair[] | null>(['productDistinctPairs']),
      );
      // Pedido pendurado (sinal fraco no mercado; no Android o pedido não tem prazo): sem cortar, o botão
      // ficaria girando sem saída.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PRODUCT_DELETE_TIMEOUT_MS);
      try {
        const gone = unwrap(await supabase.rpc('delete_product', { p_id: id, p_name: name }).abortSignal(controller.signal)) as {
          pantry?: unknown;
          list?: unknown;
          barcodes?: unknown;
        };
        return { pantry: Number(gone.pantry ?? 0), list: Number(gone.list ?? 0), barcodes: Number(gone.barcodes ?? 0), carry };
      } catch (error) {
        // Só este prazo corta o pedido. O banco pode ter excluído antes do corte: o erro diz isso à pessoa.
        throw controller.signal.aborted ? new Error(DELETE_NO_ANSWER) : error;
      } finally {
        clearTimeout(timer);
      }
    },
    // O banco desfez o pedido para destravar o de outra pessoa da casa (40P01): repetir uma vez é seguro, a
    // função é uma transação só. Outro erro não se repete.
    retry: (failures, error) => failures < 1 && isDeadlock(error),
    retryDelay: 0,
    onSuccess: ({ carry }, { id }) => {
      // Os pares primeiro, na hora: a sugestão que a regra do nome escondia não pisca de volta.
      queryClient.setQueryData<DistinctPair[] | null>(['productDistinctPairs'], (pairs) => {
        if (!pairs) return pairs;
        const kept = pairs.filter((pair) => pair.product_a !== id && pair.product_b !== id);
        const has = (pair: DistinctPair) => kept.some((p) => p.product_a === pair.product_a && p.product_b === pair.product_b);
        return [...kept, ...carry.filter((pair) => !has(pair))];
      });
      refreshDeletedProduct(queryClient, { except: ['productDistinctPairs'] });
      if (carry.length) {
        void storeCarriedPairs(carry).finally(() => queryClient.invalidateQueries({ queryKey: ['productDistinctPairs'] }));
      } else {
        queryClient.invalidateQueries({ queryKey: ['productDistinctPairs'] });
      }
    },
    // O produto sumiu, mudou de nome, ganhou uma compra ou entrou numa nota em revisão por outro aparelho, ou a
    // resposta não chegou e o banco pode ter excluído: o que está na tela ficou velho.
    onError: (error) => {
      if (isMissingFunction(error, 'delete_product')) return;
      const stale = [isProductGone, isProductRenamed, isDeleteUnanswered, isProductPurchased, isProductInReview].some((is) => is(error));
      if (stale) refresh();
      if (isProductInReview(error)) queryClient.invalidateQueries({ queryKey: ['receipts'] });
    },
  });
}

/** O aviso para um erro de excluir, em palavras de gente. */
export function deleteErrorNotice(error: unknown): { title: string; message: string } {
  if (isMissingFunction(error, 'delete_product')) return { title: DELETE_UNAVAILABLE_TITLE, message: DELETE_UNAVAILABLE };
  if (isDeleteUnanswered(error)) return { title: DELETE_NO_ANSWER_TITLE, message: DELETE_NO_ANSWER };
  if (isProductGone(error)) return { title: DELETE_GONE_TITLE, message: PRODUCT_NOT_IN_HOUSE };
  if (isProductRenamed(error)) return { title: DELETE_RENAMED_TITLE, message: DELETE_RENAMED };
  if (isProductPurchased(error)) return { title: DELETE_PURCHASED_TITLE, message: DELETE_PURCHASED };
  if (isProductInReview(error)) return { title: DELETE_IN_REVIEW_TITLE, message: DELETE_IN_REVIEW };
  // A trava de delete_product: o produto não saiu, e a função desfez tudo.
  if ((error as { code?: unknown } | null)?.code === '55000') return { title: DELETE_FAILED_TITLE, message: DELETE_BLOCKED };
  return { title: DELETE_FAILED_TITLE, message: errorMessage(error) };
}

/**
 * Este banco já sabe excluir produto? O botão só aparece com true: o app pode chegar antes da migração. false
 * quando a função não existe; outro erro sobe.
 */
export async function fetchDeleteProductAvailable(): Promise<boolean> {
  const result = await supabase.rpc('delete_product_available');
  if (result.error && isMissingFunction(result.error, 'delete_product_available')) return false;
  return unwrap(result) === true;
}

/** A resposta só muda quando a migração é aplicada: perguntada uma vez por abertura do app (só na memória). */
export function useDeleteProductAvailable() {
  return useQuery({ queryKey: ['deleteProductAvailable'], queryFn: fetchDeleteProductAvailable, staleTime: Infinity });
}
