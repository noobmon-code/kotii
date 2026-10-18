// Preços vistos em outras casas: o que o banco devolve para os produtos desta
// (shared_latest_prices). O app nunca lê a tabela compartilhada, só essa
// função.
//
// A função chega ao banco numa migração própria, e o app pode ser publicado
// antes dela. Sem a função, a resposta é "não disponível" (null), nunca um
// erro: as telas seguem como eram, sem a seção e a linha em Preços. O cartão
// da aba Família pergunta à parte (shared_prices_available), sem buscar preço.

import type { SupabaseClient } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';

import type { SharedPrice } from '@/domain/sharedPrices';
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
 * Os preços de outras casas para os produtos desta: o mais recente de cada
 * produto, mercado e unidade, dos últimos 90 dias e nunca de nota confirmada
 * hoje (cada preço aparece a partir do dia seguinte ao da confirmação); dos
 * mercados da própria casa (`mine`) todos e, dos outros, os 5 mais baratos do
 * estado onde ela compra. null quando a função não existe no banco. Página
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
  // verdade, e estado que não veio é "não se sabe".
  return pages.flat().map((row) => ({ ...row, unit_price: Number(row.unit_price), store_uf: row.store_uf ?? null, mine: row.mine === true }));
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
 * O compartilhamento existe neste banco? É tudo o que o cartão da aba Família
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
