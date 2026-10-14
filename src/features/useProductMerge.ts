// Juntar produtos: o que as telas precisam, montado com o que já está
// carregado (produtos, últimos preços, despensa, listas). As regras e as
// frases ficam em domain/productMerge.

import { useEffect, useMemo } from 'react';

import { usePantry } from '@/data/home';
import { useLatestPrices, useOpenListItems, useProducts, useStores } from '@/data/market';
import { useDistinctPairs, usePurchaseCounts } from '@/data/productMerge';
import { mergeCandidates, mergeSuggestions, productFacts, type MergeSuggestion, type ProductFacts, type PurchaseCounts } from '@/domain/productMerge';

const NO_PURCHASES: PurchaseCounts = {};

/**
 * As sugestões "Parecem o mesmo produto" (até 3, as de mais compras
 * primeiro) e as compras de cada produto delas. Com `productId`, só as desse
 * produto. Vazio enquanto algo carrega, se algo falhou ou se o banco ainda não
 * guarda o "São diferentes": a sugestão é um extra, nunca um erro na tela.
 */
export function useMergeSuggestions(productId?: string): { suggestions: MergeSuggestion[]; purchases: PurchaseCounts } {
  const products = useProducts();
  const distinct = useDistinctPairs();
  const candidates = useMemo(() => {
    if (!products.data || !distinct.data) return [];
    const all = mergeCandidates(products.data, distinct.data);
    return productId ? all.filter(([a, b]) => a.id === productId || b.id === productId) : all;
  }, [products.data, distinct.data, productId]);
  // A ordem das sugestões é a das compras: são contadas para todos os pares, não só para os 3 que aparecem.
  const ids = useMemo(() => candidates.flatMap(([a, b]) => [a.id, b.id]), [candidates]);
  const counts = usePurchaseCounts(ids, { keepPrevious: true });
  return useMemo(() => {
    // Resolvido um par, a contagem de antes ainda traz os produtos dos que sobraram: o cartão não pisca
    // enquanto a nova chega. Se falta algum produto nela (um par novo), espera.
    const purchases = counts.data && ids.every((id) => id in counts.data) ? counts.data : null;
    return { suggestions: purchases ? mergeSuggestions(candidates, purchases, { productId }) : [], purchases: purchases ?? NO_PURCHASES };
  }, [candidates, ids, counts.data, productId]);
}

/**
 * O que o app sabe dos dois produtos que a pessoa pensa em juntar. Juntar não
 * tem volta: o que a confirmação mostra (o que passa da despensa e da lista,
 * os avisos de unidade e de tamanho) tem de ter sido buscado com ela aberta,
 * e não só estar guardado no aparelho, onde outro aparelho pode ter posto o
 * produto na despensa ou numa lista depois. Ao abrir, cada busca é pedida de
 * novo (a que já estava a caminho é aproveitada), e `facts` só vem quando
 * todas chegaram depois disso e nenhuma falhou. A busca que falha aparece em
 * `error`, mesmo havendo o que estava guardado.
 */
export function useMergeFacts(firstId: string, secondId: string) {
  const counts = usePurchaseCounts([firstId, secondId]);
  const prices = useLatestPrices();
  const stores = useStores();
  const pantry = usePantry();
  const listItems = useOpenListItems();
  const queries = [counts, prices, stores, pantry, listItems];
  const refetchCounts = counts.refetch;
  const refetchPrices = prices.refetch;
  const refetchStores = stores.refetch;
  const refetchPantry = pantry.refetch;
  const refetchListItems = listItems.refetch;
  // Também quando o par muda sem a confirmação fechar: o que estava guardado do par novo não é de agora.
  useEffect(() => {
    for (const refetch of [refetchCounts, refetchPrices, refetchStores, refetchPantry, refetchListItems]) {
      void refetch({ cancelRefetch: false });
    }
  }, [firstId, secondId, refetchCounts, refetchPrices, refetchStores, refetchPantry, refetchListItems]);
  const facts = useMemo((): Record<string, ProductFacts> | null => {
    if (!counts.data || !prices.data || !stores.data || !pantry.data || !listItems.data) return null;
    const source = { purchases: counts.data, prices: prices.data, stores: stores.data, pantry: pantry.data, listItems: listItems.data };
    return { [firstId]: productFacts(firstId, source), [secondId]: productFacts(secondId, source) };
  }, [firstId, secondId, counts.data, prices.data, stores.data, pantry.data, listItems.data]);
  // A última busca de alguma falhou: com ou sem o que estava guardado, não há o que confirmar.
  const failed = queries.find((query) => query.error);
  const current = !failed && queries.every((query) => query.isFetchedAfterMount);
  return {
    facts: current ? facts : null,
    purchases: counts.data ?? NO_PURCHASES,
    error: failed?.error ?? null,
    refetch: () => queries.forEach((query) => (query.error ? query.refetch() : undefined)),
  };
}
