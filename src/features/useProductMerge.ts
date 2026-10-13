// Juntar produtos: o que as telas precisam, montado com o que já está
// carregado (produtos, últimos preços, despensa, listas). As regras e as
// frases ficam em domain/productMerge.

import { useMemo } from 'react';

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

/** O que o app sabe dos dois produtos que a pessoa pensa em juntar. */
export function useMergeFacts(firstId: string, secondId: string) {
  const counts = usePurchaseCounts([firstId, secondId]);
  const prices = useLatestPrices();
  const stores = useStores();
  const pantry = usePantry();
  const listItems = useOpenListItems();
  const queries = [counts, prices, stores, pantry, listItems];
  const facts = useMemo((): Record<string, ProductFacts> | null => {
    if (!counts.data || !prices.data || !stores.data || !pantry.data || !listItems.data) return null;
    const source = { purchases: counts.data, prices: prices.data, stores: stores.data, pantry: pantry.data, listItems: listItems.data };
    return { [firstId]: productFacts(firstId, source), [secondId]: productFacts(secondId, source) };
  }, [firstId, secondId, counts.data, prices.data, stores.data, pantry.data, listItems.data]);
  return {
    facts,
    purchases: counts.data ?? NO_PURCHASES,
    error: facts ? null : (queries.find((query) => query.error)?.error ?? null),
    refetch: () => queries.forEach((query) => (query.error ? query.refetch() : undefined)),
  };
}
