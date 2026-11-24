// Preços vistos em outras casas: o que o banco devolve para os produtos desta
// (shared_latest_prices). O app nunca lê a tabela compartilhada, só essa
// função.
//
// A função chega ao banco numa migração própria, e o app pode ser publicado
// antes dela. Sem a função, a resposta é "não disponível" (null), nunca um
// erro: as telas seguem como eram, sem a seção e a linha em Preços. O cartão
// de Configurações pergunta à parte (shared_prices_available), sem buscar preço.
//
// A base aberta (o item que a casa nunca comprou: domain/openPrices) são
// outras duas funções, shared_item_keys e shared_item_prices, lidas por
// useOpenSharedPrices. As mesmas duas chamadas também trazem, para o item que
// a casa já compra, as outras marcas que só outras casas compraram (a troca de
// marca, domain/cheaperBrand): buscas e grupos a mais, depois dos da base
// aberta e nunca no lugar deles. As chaves delas começam com 'sharedPrices', então toda
// invalidação dos preços de outras casas (confirmar uma nota, juntar
// produtos, os nomes dos mercados, o local da casa) vale para elas também, e
// nada disso fica guardado no aparelho (PERSISTED não tem 'sharedPrices').

import type { SupabaseClient } from '@supabase/supabase-js';
import { keepPreviousData, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  brandGroupCalls,
  brandItemsSignature,
  brandKeyGroups,
  brandKeyQuotes,
  type BrandKeyQuote,
  type BrandSearchItem,
} from '@/domain/cheaperBrand';
import {
  openGroupArgument,
  openGroupCalls,
  openGroups,
  openItemsSignature,
  openQuotes,
  openSearchPlan,
  parseSharedItemKeys,
  parseSharedItemPrices,
  type OpenGroup,
  type OpenKeysAnswer,
  type OpenPricesAnswer,
  type OpenSearchEntry,
  type OpenSearchItem,
} from '@/domain/openPrices';
import { sharedWeekStart, type SharedPrice, type SharedQuote, type StoreCnpj } from '@/domain/sharedPrices';
import { supabase, unwrap } from '@/lib/supabase';

import { isMissingFunction } from './missingSchema';

/**
 * O PostgREST corta em 1000 linhas por pedido (max_rows padrão do Supabase): uma página maior não vem maior,
 * só cortada sem aviso.
 */
const PAGE = 1000;
/**
 * 10 mil preços de outras casas: além disso, o que veio já basta. Eles só cobrem, na lista e no "Onde comprar",
 * onde a casa não tem preço; faltar algum deixa o item como estava (estimado ou sem preço), nunca com conta errada.
 */
const MAX_PAGES = 10;
/**
 * Depois da primeira página cheia, as seguintes vão de três em três ao mesmo tempo: o "Onde comprar" espera a
 * primeira busca, e dez pedidos em fila seriam dez esperas. Na casa comum, a primeira já é a última.
 */
const PARALLEL_PAGES = 3;

/**
 * Os preços de outras casas para os produtos desta: o da semana mais recente
 * de cada produto, mercado e unidade, das últimas 13 semanas e nunca de nota
 * confirmada nesta semana (cada preço aparece na segunda-feira depois da
 * semana da confirmação), com a segunda-feira da semana da compra; dos
 * mercados da própria casa (`mine`) todos e, dos outros, os 5 mais baratos do
 * estado onde ela compra, com o tamanho da embalagem que o servidor leu na
 * nota do QR code (pack_*). null quando a função não existe no banco. Página
 * por página, na ordem da chave da resposta, para as páginas se encaixarem;
 * junta-se até a primeira incompleta.
 */
export async function fetchSharedPrices(db: SupabaseClient = supabase): Promise<SharedPrice[] | null> {
  const fetchPage = async (page: number) => {
    const result = await db
      .rpc('shared_latest_prices')
      .order('product_id')
      .order('store_cnpj')
      .order('unit')
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (result.error && isMissingFunction(result.error, 'shared_latest_prices')) return null;
    return (unwrap(result) ?? []) as SharedPrice[];
  };
  const first = await fetchPage(0);
  if (!first) return null;
  const pages: SharedPrice[][] = [first];
  let next = 1;
  while (pages.at(-1)!.length === PAGE && next < MAX_PAGES) {
    const batch = Array.from({ length: Math.min(PARALLEL_PAGES, MAX_PAGES - next) }, (_, i) => next + i);
    next += batch.length;
    for (const rows of await Promise.all(batch.map(fetchPage))) {
      pages.push(rows ?? []);
      if ((rows ?? []).length < PAGE) break;
    }
  }
  // O preço é numeric no banco: garante número, venha como vier. "É mercado da casa" só com um sim de
  // verdade, e estado que não veio é "não se sabe". O tamanho da embalagem (pack_*) também: a função de antes da
  // coluna não o manda, e aí ele é "não se sabe" (null).
  // A semana: o banco de antes da lista aberta ainda devolve o dia, e o app mostra a segunda-feira dele.
  return pages.flat().map((row) => ({
    ...row,
    unit_price: Number(row.unit_price),
    seen_on: sharedWeekStart(row.seen_on),
    store_uf: row.store_uf ?? null,
    mine: row.mine === true,
    pack_unit: row.pack_unit ?? null,
    pack_amount: row.pack_amount == null ? null : Number(row.pack_amount),
    pack_of: row.pack_of == null ? null : Number(row.pack_of),
  }));
}

/**
 * Os preços de outras casas; `data` null: a função ainda não existe no banco.
 * Fora do cache guardado no aparelho (lib/queryClient): o que outras casas
 * viram não fica no celular. Não são em tempo real, então cinco minutos sem
 * perguntar de novo não fazem falta (confirmar uma nota busca na hora).
 */
export function useSharedPrices() {
  return useQuery({ queryKey: ['sharedPrices'], queryFn: () => fetchSharedPrices(), staleTime: 5 * 60_000 });
}

/**
 * O compartilhamento existe neste banco? É tudo o que o cartão de Configurações
 * precisa saber: a função dos preços calcularia e mandaria todos eles para um
 * parágrafo fixo. false quando a função não existe (o app chegou antes da
 * migração); outro erro sobe.
 */
export async function fetchSharedPricesAvailable(db: SupabaseClient = supabase): Promise<boolean> {
  const result = await db.rpc('shared_prices_available');
  if (result.error && isMissingFunction(result.error, 'shared_prices_available')) return false;
  return unwrap(result) === true;
}

/**
 * A resposta só muda quando a migração é aplicada: perguntada uma vez por
 * abertura do app (fica só na memória, fora do cache guardado no aparelho).
 */
export function useSharedPricesAvailable() {
  return useQuery({ queryKey: ['sharedPricesAvailable'], queryFn: () => fetchSharedPricesAvailable(), staleTime: Infinity });
}

// ---------------------------------------------------------------------------
// A base aberta: o mesmo item, de qualquer marca, que a casa nunca comprou

/**
 * O passo 1 (shared_item_keys): as descrições da base que começam pelas palavras de cada busca. null quando a função
 * não existe no banco (o app chegou antes da migração): sem preço aberto, sem erro. Uma resposta fora da forma é
 * erro (a busca tenta de novo), nunca meia resposta.
 */
export async function fetchSharedItemKeys(entries: readonly OpenSearchEntry[], db: SupabaseClient = supabase): Promise<OpenKeysAnswer | null> {
  const result = await db.rpc('shared_item_keys', { p_items: entries.map((entry) => ({ f: entry.first, s: entry.second, x: entry.extra })) });
  if (result.error && isMissingFunction(result.error, 'shared_item_keys')) return null;
  return parseSharedItemKeys(unwrap(result), entries);
}

/** O passo 2 (shared_item_prices): os preços de cada grupo de descrições. null quando a função não existe. */
export async function fetchSharedItemPrices(
  groups: readonly Pick<OpenGroup, 'signature' | 'keys' | 'weightOnly' | 'expected'>[],
  db: SupabaseClient = supabase,
): Promise<OpenPricesAnswer | null> {
  const result = await db.rpc('shared_item_prices', { p_groups: groups.map(openGroupArgument) });
  if (result.error && isMissingFunction(result.error, 'shared_item_prices')) return null;
  return parseSharedItemPrices(unwrap(result), groups);
}

/**
 * As respostas de várias buscas, juntas: os dados (a mesma lista de antes quando nada mudou, pela junção do
 * TanStack, que reaproveita o que é igual) e se alguma está na primeira vez, a caminho.
 */
function joinAnswers<T>(results: readonly { data: T | undefined; isPending: boolean; fetchStatus: string }[]) {
  return {
    data: results.map((result) => result.data),
    waiting: results.some((result) => result.isPending && result.fetchStatus === 'fetching'),
  };
}

/** Os preços abertos não são em tempo real: dez minutos sem perguntar de novo. */
const OPEN_STALE_MS = 10 * 60_000;
const NO_QUOTES: ReadonlyMap<string, SharedQuote[]> = new Map();
const NO_BRAND_QUOTES: ReadonlyMap<string, BrandKeyQuote[]> = new Map();

/** O que a lista e o "Onde comprar" recebem da base aberta. */
export interface OpenSharedPrices {
  /** Por item da lista, os preços da base aberta (domain/openPrices, openQuotes). */
  quotes: ReadonlyMap<string, readonly SharedQuote[]>;
  /** Por item da lista, as marcas que só outras casas compraram (domain/cheaperBrand, brandKeyQuotes). */
  brandQuotes: ReadonlyMap<string, readonly BrandKeyQuote[]>;
  /** Alguma busca está na primeira vez, a caminho. Uma parada (sem internet), um erro ou a função que não existe não esperam. */
  waiting: boolean;
  /** Busca de novo o que está na tela (puxar para atualizar). */
  refetch: () => Promise<void>;
}

/**
 * A base aberta para os itens da lista (`items`, de openCandidates; null enquanto a lista não sabe quais são): as
 * descrições (passo 1, uma busca por conjunto de palavras, de 40 em 40) e, delas, os preços dos grupos que o app
 * decidiu serem o mesmo item (passo 2). As chaves são as assinaturas das buscas e dos grupos: duas listas com os
 * mesmos itens dividem as respostas, e o "Onde comprar" não pede nada que a lista já pediu. Marcar um item no
 * carrinho não refaz nada (o plano e os grupos se guardam pela assinatura dos itens e pelas respostas).
 *
 * `brandItems` (de brandSearchItems; null enquanto a lista não sabe quais são): os itens que já têm preço da casa e
 * procuram outras marcas do mesmo item (domain/cheaperBrand). As buscas e os grupos deles vão depois dos da base
 * aberta, que ficam exatamente como sem eles, e no máximo BRAND_MAX_CALLS chamadas a mais de cada passo; a busca ou
 * o grupo igual a um da base aberta é o mesmo pedido.
 */
export function useOpenSharedPrices(
  items: readonly OpenSearchItem[] | null,
  stores: readonly StoreCnpj[] | undefined,
  brandItems: readonly BrandSearchItem[] | null = null,
): OpenSharedPrices {
  const queryClient = useQueryClient();
  const signature = openItemsSignature(items ?? []) + brandItemsSignature(brandItems);
  const asking = items != null || brandItems != null;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a assinatura é o que muda a busca, não a lista em si.
  const plan = useMemo(() => openSearchPlan(items ?? [], brandItems ?? []), [signature]);
  const keyAnswers = useQueries({
    queries: plan.calls.map((call) => ({
      queryKey: ['sharedPrices', 'open', 'keys', call.map((entry) => entry.signature)],
      queryFn: () => fetchSharedItemKeys(call),
      enabled: asking,
      staleTime: OPEN_STALE_MS,
      placeholderData: keepPreviousData,
    })),
    combine: joinAnswers<OpenKeysAnswer | null>,
  });
  const keyData = keyAnswers.data;
  const groups = useMemo(
    () => openGroups(items ?? [], keyData.filter((answer): answer is OpenKeysAnswer => answer != null), plan),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- os itens entram pela assinatura (o plano é dela).
    [plan, keyData],
  );
  const brandGroups = useMemo(
    () => brandKeyGroups(brandItems ?? [], keyData.filter((answer): answer is OpenKeysAnswer => answer != null), plan),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- os itens entram pela assinatura (o plano é dela).
    [plan, keyData],
  );
  const calls = useMemo(
    () => [...openGroupCalls(groups), ...brandGroupCalls(brandGroups, new Set(groups.map((group) => group.signature)))],
    [groups, brandGroups],
  );
  const priceAnswers = useQueries({
    queries: calls.map((call) => ({
      queryKey: ['sharedPrices', 'open', 'prices', call.map((group) => group.signature)],
      queryFn: () => fetchSharedItemPrices(call),
      enabled: asking,
      staleTime: OPEN_STALE_MS,
      placeholderData: keepPreviousData,
    })),
    combine: joinAnswers<OpenPricesAnswer | null>,
  });
  const priceData = priceAnswers.data;
  const answered = useMemo(() => priceData.filter((answer): answer is OpenPricesAnswer => answer != null), [priceData]);
  const quotes = useMemo(() => (stores ? openQuotes(answered, groups, stores) : NO_QUOTES), [groups, stores, answered]);
  const brandQuotes = useMemo(
    () => (stores && brandGroups.length ? brandKeyQuotes(answered, brandGroups, stores) : NO_BRAND_QUOTES),
    [brandGroups, stores, answered],
  );
  const waiting = asking && (keyAnswers.waiting || priceAnswers.waiting);
  const refetch = () => queryClient.refetchQueries({ queryKey: ['sharedPrices', 'open'], type: 'active' });
  return { quotes, brandQuotes, waiting, refetch };
}
