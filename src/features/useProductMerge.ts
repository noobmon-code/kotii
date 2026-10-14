// Juntar produtos: o que as telas precisam. As sugestões saem do que já está
// carregado (produtos, pares, compras); a confirmação lê os dois produtos do
// banco, só para ela. As regras e as frases ficam em domain/productMerge.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import { useProducts } from '@/data/market';
import { fetchMergeFacts, refreshMergedProducts, useDistinctPairs, usePurchaseCounts, type MergeFacts } from '@/data/productMerge';
import { mergeCandidates, mergeSuggestions, type MergeSuggestion, type PurchaseCounts } from '@/domain/productMerge';

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
 * Os dois produtos que a pessoa pensa em juntar, como estão no banco agora, e
 * o que o app sabe de cada um. Juntar não tem volta: nada do que a confirmação
 * mostra sai do que as telas já tinham carregado (os nomes que elas guardavam,
 * as listas da casa, que o servidor pode cortar), e sim de uma leitura só
 * sobre os dois (`fetchMergeFacts`), feita com a confirmação aberta e também
 * quando o par muda. `read` só vem de uma leitura que chegou depois disso e
 * deu certo: enquanto outra está a caminho não há o que confirmar, e a que
 * falha aparece em `error`, mesmo havendo a de antes. Fechada a confirmação,
 * nada fica na memória, e a chave não é das que vão para o aparelho
 * (PERSISTED, em lib/queryClient). `gone`: a leitura veio sem um dos dois, que
 * foi juntado ou apagado em outro aparelho; o que as telas mostram dele é
 * buscado de novo, como depois de juntar.
 */
export function useMergeFacts(firstId: string, secondId: string): { read: MergeFacts | null; gone: boolean; error: unknown; refetch: () => void } {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['mergeFacts', firstId, secondId],
    queryFn: () => fetchMergeFacts(firstId, secondId),
    gcTime: 0,
    staleTime: 0,
    refetchOnMount: 'always',
    // Só lê de novo quando a confirmação pede: voltar ao app não troca a tela no meio da leitura dela.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const read = query.isSuccess && !query.isFetching && query.isFetchedAfterMount ? query.data : null;
  const gone = read !== null && (!read.products[firstId] || !read.products[secondId]);
  useEffect(() => {
    if (gone) refreshMergedProducts(queryClient);
  }, [gone, queryClient]);
  const { refetch } = query;
  return { read, gone, error: query.isFetching ? null : query.error, refetch: () => void refetch() };
}
