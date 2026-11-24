// Excluir um produto que não está em nenhuma nota: a leitura que a pergunta faz no toque (fetchDeleteFacts), a
// função do banco que exclui (delete_product) e o que precisa ser buscado de novo depois. As regras e as frases
// estão em domain/productDelete.
//
// A função chega numa migração própria (20261123130646_delete_product.sql), e o app pode ser publicado antes
// dela: o botão só aparece quando delete_product_available() responde true (useDeleteProductAvailable). Sem a
// função, excluir avisa que ainda não está disponível. Não há plano B de apagar direto na tabela: isso soltaria
// das linhas de nota o produto, que é justamente o que a função recusa.

import { onlineManager, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

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
  deletableProduct,
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

/**
 * Busca de novo tudo o que mostrava o produto excluído (DELETE_REFRESHES). Com pares que passam para o gêmeo de nome
 * (`carry`, de pairsToCarry), grava esses pares antes (storeCarriedPairs) e só busca os pares de novo depois da
 * gravação, para a busca já trazê-los; o resto vai na hora. `carry` não tem valor padrão de propósito, como em
 * forgetDeletedProduct: todo caminho em que o produto pode ter saído do banco diz os pares que passam, e só os que
 * deixam o produto lá (outro nome, uma compra, uma nota em revisão) passam [].
 */
export function refreshDeletedProduct(queryClient: QueryClient, { carry }: { carry: readonly DistinctPair[] }): void {
  for (const key of DELETE_REFRESHES) {
    if (key !== 'productDistinctPairs' || !carry.length) queryClient.invalidateQueries({ queryKey: [key] });
  }
  if (carry.length) void storeCarriedPairs(carry).finally(() => queryClient.invalidateQueries({ queryKey: ['productDistinctPairs'] }));
}

/**
 * Os pares "São diferentes" que passam para o gêmeo de nome do produto (carriedDistinctPairs), do que a memória
 * tem agora. Calculados antes do pedido de excluir e antes da leitura do toque: depois deles, o produto e os pares
 * dele podem já ter saído da memória (uma busca nova que chegou no meio), e não haveria mais de onde tirar.
 */
export function pairsToCarry(queryClient: QueryClient, id: string): DistinctPair[] {
  return carriedDistinctPairs(
    id,
    queryClient.getQueryData<ProductName[]>(['products']),
    queryClient.getQueryData<DistinctPair[] | null>(['productDistinctPairs']),
  );
}

/** Os pares guardados na memória sem os de `id` (null: nenhum sai) e com os de `carry` que ainda não estão lá. */
function withCarriedPairs(queryClient: QueryClient, id: string | null, carry: readonly DistinctPair[]): void {
  queryClient.setQueryData<DistinctPair[] | null>(['productDistinctPairs'], (pairs) => {
    if (!pairs) return pairs;
    const kept = id === null ? pairs : pairs.filter((pair) => pair.product_a !== id && pair.product_b !== id);
    const added = carry.filter((pair) => !kept.some((p) => p.product_a === pair.product_a && p.product_b === pair.product_b));
    return kept.length === pairs.length && !added.length ? pairs : [...kept, ...added];
  });
}

/**
 * Tira da memória, na hora, o produto que já não existe no banco (excluído agora, ou por outro aparelho antes do
 * toque): ele sai do catálogo guardado e os pares "São diferentes" dele saem com ele, e entram os que passam para o
 * gêmeo de nome (`carry`, de pairsToCarry). As três coisas no mesmo passo, antes de qualquer busca nova: com o
 * produto ainda no catálogo e o par dele já fora dos pares (escritos aqui, ou buscados de novo antes dos produtos,
 * que podem vir em várias páginas), a sugestão que a casa recusou voltaria por um instante no cartão "Parecem o
 * mesmo produto"; e sem o par que passa, voltaria a que a regra do nome escondia por ele (o gêmeo com o mesmo
 * parceiro). `carry` não tem valor padrão de propósito: as respostas de "já não existe" também passam os pares (e
 * refreshDeletedProduct os grava: o aparelho que excluiu pode não ter gravado os dele, se a gravação falhou, se a
 * resposta dele se perdeu ou se o app dele é de antes). É o que useCreateProduct faz com o produto novo, ao
 * contrário; a busca nova de DELETE_REFRESHES confirma depois.
 */
export function forgetDeletedProduct(queryClient: QueryClient, id: string, carry: readonly DistinctPair[]): void {
  queryClient.setQueryData<ProductName[]>(['products'], (products) =>
    products?.some((product) => product.id === id) ? products.filter((product) => product.id !== id) : products,
  );
  withCarriedPairs(queryClient, id, carry);
}

/**
 * O pedido de excluir ficou sem resposta: o banco pode ter excluído, ou não. O produto e os pares dele ficam na
 * memória até a busca nova dizer, e só entram os pares que passam para o gêmeo de nome (`carry`): se excluiu, a busca
 * nova dos produtos pode chegar antes da dos pares (que espera a gravação deles) e, sem eles na memória, a sugestão
 * que a regra do nome escondia pelo produto voltaria nesse meio-tempo. Se não excluiu, eles não mudam nada do que se
 * vê: só dizem o que a regra do nome já dizia, e o produto continua escondendo o mesmo; gravados, aparecem em
 * "Marcados como diferentes" do gêmeo, onde dá para desfazer.
 */
export function rememberCarriedPairs(queryClient: QueryClient, carry: readonly DistinctPair[]): void {
  withCarriedPairs(queryClient, null, carry);
}

/** O pedido de excluir foi cortado sem resposta (PRODUCT_DELETE_TIMEOUT_MS): pode ter excluído, ou não. */
export const isDeleteUnanswered = (error: unknown) => error instanceof Error && error.message === DELETE_NO_ANSWER;

/** O que delete_product devolveu: o que perdeu a ligação (para os testes; a tela só sai). */
export interface DeleteResult {
  pantry: number;
  list: number;
  barcodes: number;
}

/**
 * Grava os pares que passam para os gêmeos de nome do produto excluído (carriedDistinctPairs), o menor id primeiro
 * (orderedPair, como a tabela pede), sem mudar o que já está gravado (ignoreDuplicates: outro aparelho pode ter
 * gravado os mesmos). É o melhor que dá: qualquer erro (um produto do par juntado ou excluído nesse meio-tempo,
 * 23503; sem internet) fica calado e não muda o que a pessoa vê, e o que custa é a sugestão recusada voltar, como era
 * antes. Roda depois da resposta (ou da leitura do toque), então nunca segura a tela.
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
  return useMutation({
    // Os pares a passar saem do que a tela tinha antes do pedido (uma vez, também quando ele se repete): depois
    // dele, os do produto já não existem. Servem à resposta de excluiu, à de "já não existe" (P0002) e à que não
    // chegou.
    onMutate: ({ id }: { id: string; name: string | null }) => ({ carry: pairsToCarry(queryClient, id) }),
    mutationFn: async ({ id, name }: { id: string; name: string | null }): Promise<DeleteResult> => {
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
        return { pantry: Number(gone.pantry ?? 0), list: Number(gone.list ?? 0), barcodes: Number(gone.barcodes ?? 0) };
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
    onSuccess: (_result, { id }, { carry }) => {
      // O produto e os pares primeiro, na hora: nem o par que a casa recusou com ele, nem a sugestão que a regra
      // do nome escondia por ele, piscam de volta enquanto as buscas novas não chegam.
      forgetDeletedProduct(queryClient, id, carry);
      refreshDeletedProduct(queryClient, { carry });
    },
    // O produto sumiu, mudou de nome, ganhou uma compra ou entrou numa nota em revisão por outro aparelho, ou a
    // resposta não chegou e o banco pode ter excluído: o que está na tela ficou velho.
    onError: (error, { id }, context) => {
      if (isMissingFunction(error, 'delete_product')) return;
      const carry = context?.carry ?? [];
      if (isProductGone(error)) {
        // Já não existe: como depois de excluir, sai da memória na hora, com os pares que passam para o gêmeo de
        // nome, e eles são gravados (quem excluiu pode não ter gravado os dele).
        forgetDeletedProduct(queryClient, id, carry);
        refreshDeletedProduct(queryClient, { carry });
      } else if (isDeleteUnanswered(error)) {
        // Sem resposta, não se sabe: o produto fica até a busca nova, mas os pares que passam entram e são gravados
        // como se tivesse excluído (rememberCarriedPairs diz por que não custa nada se não excluiu).
        rememberCarriedPairs(queryClient, carry);
        refreshDeletedProduct(queryClient, { carry });
      } else if ([isProductRenamed, isProductPurchased, isProductInReview].some((is) => is(error))) {
        // O produto continua no banco: nada passa.
        refreshDeletedProduct(queryClient, { carry: [] });
      }
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

/** A chave da pergunta acima, na memória (nunca em PERSISTED): a tela do produto e a nota confirmada usam a mesma. */
export const DELETE_PRODUCT_AVAILABLE_KEY = ['deleteProductAvailable'] as const;

/** A resposta só muda quando a migração é aplicada: perguntada uma vez por abertura do app (só na memória). */
export function useDeleteProductAvailable() {
  return useQuery({ queryKey: DELETE_PRODUCT_AVAILABLE_KEY, queryFn: fetchDeleteProductAvailable, staleTime: Infinity });
}

/**
 * Depois de "Trocar produto" na nota confirmada: o produto de antes dá para excluir agora? Só com
 * delete_product_available() respondendo true (a mesma chave da tela do produto, na memória, perguntada uma vez por
 * abertura do app) e por uma leitura feita para isto, a mesma do toque de excluir (fetchDeleteFacts), nunca pela
 * memória da tela: o produto achado, e nenhuma linha de nota, confirmada ou em revisão, apontando para ele
 * (deletableProduct). Sem internet, ou com a pergunta ou a leitura que falha ou passa de PRODUCT_DELETE_CHECK_MS: null,
 * e nada é oferecido (o caminho por Preços continua). Nada é excluído aqui: o toque na oferta passa pela leitura, pela
 * pergunta e pelo pedido de sempre.
 */
export async function fetchLeftProduct(queryClient: QueryClient, productId: string): Promise<{ id: string; name: string } | null> {
  if (!onlineManager.isOnline()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // A pergunta parada (sem internet no meio, o React Query a segura) não segura a oferta para sempre.
    const available = await Promise.race([
      queryClient.fetchQuery({ queryKey: DELETE_PRODUCT_AVAILABLE_KEY, queryFn: fetchDeleteProductAvailable, staleTime: Infinity }),
      new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), PRODUCT_DELETE_CHECK_MS))),
    ]);
    if (available !== true) return null;
    return deletableProduct(await fetchDeleteFacts(productId));
  } catch {
    // Calado: é só uma oferta, e o caminho por Preços continua.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
