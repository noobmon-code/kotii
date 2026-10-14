// Juntar produtos: os pares "São diferentes" da casa, as compras de cada
// produto, o que a confirmação lê dos dois produtos (fetchMergeFacts) e a
// função do banco que junta (merge_products).
//
// A tabela e a função chegam numa migração própria, e o app pode ser
// publicado antes dela. Sem a tabela, os pares vêm como null e a sugestão não
// aparece (o app não teria como guardar o "São diferentes"); sem a função,
// juntar avisa que ainda não está disponível.

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import {
  isProductRenamed,
  MERGE_BLOCKED,
  MERGE_NO_ANSWER,
  MERGE_NO_ANSWER_TITLE,
  MERGE_PRODUCT_GONE,
  MERGE_RENAMED,
  MERGE_RENAMED_TITLE,
  MERGE_UNAVAILABLE,
  MERGE_UNAVAILABLE_TITLE,
  orderedPair,
  PRODUCT_MERGED_AWAY,
  productFacts,
  type DistinctPair,
  type MergeMoved,
  type ProductFacts,
  type PurchaseCounts,
} from '@/domain/productMerge';
import { isDeadlock } from '@/lib/databaseErrors';
import { errorMessage, supabase, unwrap } from '@/lib/supabase';
import type { LatestPrice, Product } from '@/lib/types';

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
    // Com a contagem do servidor: página curta não é o fim (ele corta em max_rows, calado). O fim é a contagem
    // dizer que não sobrou nada, ou a página vir vazia; a seguinte começa depois das linhas que vieram.
    for (let from = 0; ; ) {
      const result = await supabase
        .from('receipt_items')
        .select('product_id, receipt:receipts!inner(status)', { count: 'exact' })
        .eq('receipt.status', 'confirmed')
        .in('product_id', ids)
        // Uma ordem que não empata: sem ela as páginas não se encaixam.
        .order('id')
        .range(from, from + PAGE - 1);
      const rows = (unwrap(result) ?? []) as { product_id: string }[];
      for (const row of rows) counts[row.product_id] = (counts[row.product_id] ?? 0) + 1;
      from += rows.length;
      if (!rows.length || (result.count != null && from >= result.count)) break;
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

/** O que a confirmação de juntar mostra, lido do banco só sobre os dois produtos. */
export interface MergeFacts {
  /** Os produtos como estão no banco agora, pelo id. O que não está aqui foi juntado ou apagado em outro aparelho. */
  products: Readonly<Record<string, Product | undefined>>;
  /** O que o app sabe de cada um dos dois, pelo id. */
  facts: Readonly<Record<string, ProductFacts>>;
}

/**
 * Os dois produtos que a pessoa pensa em juntar, como estão no banco agora, e o que o app sabe de cada um.
 * Juntar não tem volta, então nada aqui sai das listas da casa (despensa, itens das listas, últimos preços),
 * que vêm num pedido só e o servidor corta em max_rows, calado: cada parte é pedida só para estes dois e tem
 * tamanho certo. São duas linhas de produto; uma contagem (as compras); uma resposta de existe ou não existe
 * por produto (despensa e lista, com os filtros dessas listas: o que não foi consumido, e o item de lista que
 * não foi arquivada); e os últimos preços dos dois, que são poucos (um por mercado e unidade) e vêm com a
 * contagem do servidor, que prova que vieram todos. Uma parte que falha, ou que não veio inteira, derruba a
 * leitura: a confirmação nunca mostra um pedaço.
 */
export async function fetchMergeFacts(firstId: string, secondId: string): Promise<MergeFacts> {
  const ids = [firstId, secondId];
  // Uma linha basta: a pergunta é se o produto está lá.
  const inPantry = (id: string) => supabase.from('pantry_items').select('product_id').eq('product_id', id).is('consumed_at', null).limit(1);
  const onList = (id: string) =>
    supabase.from('shopping_list_items').select('product_id, list:shopping_lists!inner(id)').eq('product_id', id).is('list.archived_at', null).limit(1);
  const [found, purchases, priced, ...places] = await Promise.all([
    supabase.from('products').select('id, name, category, shelf_life_days').in('id', ids),
    fetchPurchaseCounts(ids),
    supabase.from('latest_prices').select('product_id, store_id, unit, unit_price, purchased_at', { count: 'exact' }).in('product_id', ids),
    inPantry(firstId),
    inPantry(secondId),
    onList(firstId),
    onList(secondId),
  ]);
  const products = (unwrap(found) ?? []) as Product[];
  const listed = (unwrap(priced) ?? []) as LatestPrice[];
  // Sem a contagem, ou com ela maior do que o que veio, não dá para dizer que estes são todos os preços.
  if (priced.count == null || priced.count > listed.length) throw new Error('Não foi possível carregar todos os preços destes produtos.');
  // Um zero não é preço (ver fetchLatestPrices, em data/market): sai depois da conferência da contagem.
  const prices = listed.filter((price) => price.unit_price > 0);
  const [pantryFirst, pantrySecond, listFirst, listSecond] = places.map((place) => (unwrap(place) ?? []) as { product_id: string | null }[]);
  // Os mercados desses preços, pelo id (cada pedido traz, no máximo, os ids que levou).
  const storeIds = [...new Set(prices.map((price) => price.store_id))];
  const stores: { id: string; name: string }[] = [];
  for (let at = 0; at < storeIds.length; at += ID_CHUNK) {
    stores.push(...((unwrap(await supabase.from('stores').select('id, name').in('id', storeIds.slice(at, at + ID_CHUNK))) ?? []) as typeof stores));
  }
  const source = { purchases, prices, stores, pantry: [...pantryFirst, ...pantrySecond], listItems: [...listFirst, ...listSecond] };
  return {
    products: Object.fromEntries(products.map((product) => [product.id, product])),
    facts: Object.fromEntries(ids.map((id) => [id, productFacts(id, source)])),
  };
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

/** Busca de novo tudo o que mostrava um dos dois produtos (MERGE_REFRESHES). */
export function refreshMergedProducts(queryClient: QueryClient) {
  for (const key of MERGE_REFRESHES) queryClient.invalidateQueries({ queryKey: [key] });
}

/**
 * O produto já não existe: outra pessoa da casa juntou ou apagou antes. É o P0002 de merge_products e, ao
 * gravar um par, a chave estrangeira que não acha o produto (23503).
 */
export function isProductGone(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'P0002' || code === '23503';
}

/**
 * Uma gravação mandou o id de um produto que não existe mais: outra pessoa da casa juntou esse produto com
 * outro, e este aparelho ainda tinha o id de antes. É o 23503 da chave estrangeira para `products` (pela
 * mensagem do Postgres: "... is not present in table "products"", ou, sem os detalhes, o nome da chave, que
 * leva a coluna: "..._product_id_household_id_fkey"). Outro 23503 (uma lista apagada em outro aparelho, a chave
 * da casa numa tabela com "product" no nome) não é isto.
 */
export function isProductMergedAway(error: unknown): boolean {
  if (!error || typeof error !== 'object' || (error as { code?: unknown }).code !== '23503') return false;
  const { message, details } = error as { message?: unknown; details?: unknown };
  const text = `${typeof message === 'string' ? message : ''} ${typeof details === 'string' ? details : ''}`;
  return text.includes('is not present in table "products"') || /insert or update on table "\w+" violates foreign key constraint "\w+_product_id_\w+"/.test(text);
}

/** De onde as telas tiram o id de produto que mandam ao pôr um item numa lista: produtos, despensa e compras recentes. */
export const LISTED_PRODUCT_SOURCES = ['products', 'pantry', 'purchaseRecords'] as const;

/**
 * Roda uma gravação que manda o id de um produto guardado na tela (a nota em revisão, um item para a lista).
 * Se o banco recusar porque o produto foi juntado com outro, busca de novo `refresh` (de onde o id veio) e só
 * depois devolve o erro, já com a frase que a pessoa lê (PRODUCT_MERGED_AWAY): enquanto a busca não chega a
 * gravação continua em andamento, e a tentativa seguinte sai com os ids de agora.
 */
export async function withFreshProducts<T>(queryClient: QueryClient, refresh: readonly string[], write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (!isProductMergedAway(error)) throw error;
    await Promise.all(refresh.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
    throw new Error(PRODUCT_MERGED_AWAY);
  }
}

/** Quanto esperar a resposta de merge_products antes de desistir do pedido. */
export const MERGE_TIMEOUT_MS = 25_000;

/** O pedido de juntar foi cortado por falta de resposta (MERGE_TIMEOUT_MS): não se sabe se o banco juntou. */
/** O pedido de juntar foi cortado sem resposta: pode ter juntado, ou não. */
export const isMergeUnanswered = (error: unknown) => error instanceof Error && error.message === MERGE_NO_ANSWER;

/** O que a confirmação manda juntar: os dois produtos e o nome de cada um como a pessoa leu nela. */
export interface MergeRequest {
  keepId: string;
  mergeId: string;
  keepName: string;
  mergeName: string;
}

/**
 * `mergeId` deixa de existir e tudo o que era dele passa para `keepId`, no banco, de uma vez. Não dá para
 * desfazer. Os nomes vão junto: a busca da confirmação é de alguns segundos antes do toque, e o banco recusa
 * (NK008, sem mudar nada) se um dos dois já tem outro nome.
 */
export function useMergeProducts() {
  const queryClient = useQueryClient();
  const refresh = () => refreshMergedProducts(queryClient);
  return useMutation({
    mutationFn: async ({ keepId, mergeId, keepName, mergeName }: MergeRequest): Promise<MergeMoved> => {
      // Pedido pendurado (sinal fraco no mercado; no Android o pedido não tem prazo): sem cortar, a confirmação
      // ficaria girando sem saída.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), MERGE_TIMEOUT_MS);
      try {
        const moved = unwrap(
          await supabase
            .rpc('merge_products', { p_keep: keepId, p_merge: mergeId, p_keep_name: keepName, p_merge_name: mergeName })
            .abortSignal(controller.signal),
        ) as Partial<MergeMoved>;
        return { purchases: Number(moved.purchases ?? 0), pantry: Number(moved.pantry ?? 0), list: Number(moved.list ?? 0) };
      } catch (error) {
        // Só este prazo corta o pedido. O banco pode ter juntado antes do corte: o erro diz isso à pessoa.
        throw controller.signal.aborted ? new Error(MERGE_NO_ANSWER) : error;
      } finally {
        clearTimeout(timer);
      }
    },
    // O banco desfez o pedido para destravar o de outra pessoa da casa (40P01): repetir uma vez é seguro, a
    // função é uma transação só (ou junta, ou diz que o produto não existe mais). Outro erro não se repete.
    retry: (failures, error) => failures < 1 && isDeadlock(error),
    retryDelay: 0,
    onSuccess: refresh,
    // O produto sumiu ou mudou de nome por outro aparelho, ou a resposta não chegou e o banco pode ter juntado:
    // o que está na tela ficou velho.
    onError: (error) => (isProductGone(error) || isProductRenamed(error) || isMergeUnanswered(error) ? refresh() : undefined),
  });
}

/** O aviso para um erro de juntar ou de marcar "São diferentes", em palavras de gente. */
export function mergeErrorNotice(error: unknown): { title: string; message: string } {
  if (isMissingFunction(error, 'merge_products') || isMissingTable(error, 'product_distinct_pairs')) {
    return { title: MERGE_UNAVAILABLE_TITLE, message: MERGE_UNAVAILABLE };
  }
  if (isMergeUnanswered(error)) return { title: MERGE_NO_ANSWER_TITLE, message: MERGE_NO_ANSWER };
  if (isProductGone(error)) return { title: 'Erro', message: MERGE_PRODUCT_GONE };
  if (isProductRenamed(error)) return { title: MERGE_RENAMED_TITLE, message: MERGE_RENAMED };
  // A trava de merge_products: alguma linha não trocou de produto, e a função desfez tudo.
  if ((error as { code?: unknown } | null)?.code === '55000') return { title: 'Erro', message: MERGE_BLOCKED };
  return { title: 'Erro', message: errorMessage(error) };
}
