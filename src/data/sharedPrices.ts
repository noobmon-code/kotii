// Preços vistos em outras casas: o que o banco devolve para os produtos desta
// (shared_latest_prices). O app nunca lê a tabela compartilhada, só essa
// função.
//
// A função chega ao banco numa migração própria, e o app pode ser publicado
// antes dela. Sem a função, a resposta é "não disponível" (null), nunca um
// erro: as telas seguem como eram, sem a seção, a linha em Preços e o cartão
// da aba Família.

import type { SupabaseClient } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';

import type { SharedPrice } from '@/domain/sharedPrices';
import { supabase, unwrap } from '@/lib/supabase';

/**
 * A função ainda não existe no banco (o app chegou antes da migração): o
 * PostgREST responde PGRST202 ("Could not find the function ... in the schema
 * cache") e o Postgres, 42883 ("function ... does not exist").
 */
export function isMissingFunction(error: unknown, name: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === 'PGRST202' || code === '42883') return true;
  return typeof message === 'string' && message.includes(name) && /does not exist|could not find the function|schema cache/i.test(message);
}

/** O PostgREST corta em 1000 linhas por pedido (max_rows padrão do Supabase). */
const PAGE = 1000;
/** 10 mil preços de outras casas: além disso, o que veio já basta (são dicas, não entram em conta nenhuma). */
const MAX_PAGES = 10;

/**
 * Os preços de outras casas para os produtos desta: o mais recente de cada
 * produto, mercado e unidade, dos últimos 90 dias e nunca de nota confirmada
 * hoje (cada preço aparece a partir do dia seguinte ao da confirmação); dos
 * mercados da própria casa (`mine`) todos e, dos outros, os 5 mais baratos do
 * estado onde ela compra. null quando a função não existe no banco. Página
 * por página, na ordem da chave da resposta, para as páginas se encaixarem.
 */
export async function fetchSharedPrices(db: SupabaseClient = supabase): Promise<SharedPrice[] | null> {
  const prices: SharedPrice[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await db
      .rpc('shared_latest_prices')
      .order('product_id')
      .order('store_cnpj')
      .order('unit')
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (result.error && isMissingFunction(result.error, 'shared_latest_prices')) return null;
    const rows = (unwrap(result) ?? []) as SharedPrice[];
    // O preço é numeric no banco: garante número, venha como vier. "É mercado da casa" só com um sim de
    // verdade, e estado que não veio é "não se sabe".
    prices.push(...rows.map((row) => ({ ...row, unit_price: Number(row.unit_price), store_uf: row.store_uf ?? null, mine: row.mine === true })));
    if (rows.length < PAGE) break;
  }
  return prices;
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
