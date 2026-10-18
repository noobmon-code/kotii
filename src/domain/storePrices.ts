// "Último preço por mercado", na tela do produto: o preço mais recente de
// cada mercado da casa, do mais barato ao mais caro. Sai do histórico inteiro
// do produto (as compras lidas página por página, data/market
// fetchProductPurchases), nunca de uma parte dele: um mercado em que a casa
// comprou pela última vez há muito tempo continua na lista. Sem internet, sai
// dos últimos preços que ficam guardados no aparelho (a view latest_prices,
// lida inteira para a estimativa da lista).

import type { PurchaseLine } from './priceHistory';

export interface StorePrice {
  storeId: string;
  unit: string;
  /** O preço impresso na nota, por `unit`. */
  unitPrice: number;
  /** Momento da compra (o banco guarda em UTC). */
  purchasedAt: string;
}

/** Uma linha de `latest_prices` (lib/types LatestPrice), só com o que a lista usa. */
export interface SavedPrice {
  product_id: string;
  store_id: string;
  unit: string;
  unit_price: number;
  purchased_at: string;
}

/**
 * O último preço de cada mercado, do mais barato ao mais caro. Zero não é
 * preço (o item que ficou sem valor na nota): a compra de verdade anterior do
 * mesmo mercado fica no lugar dele. No mesmo instante, vale o menor preço,
 * para a lista não mudar de uma leitura para outra.
 */
export function latestByStore(prices: Iterable<StorePrice>): StorePrice[] {
  const latest = new Map<string, StorePrice>();
  for (const price of prices) {
    if (!(price.unitPrice > 0)) continue;
    const current = latest.get(price.storeId);
    const time = Date.parse(price.purchasedAt);
    const currentTime = current ? Date.parse(current.purchasedAt) : -Infinity;
    if (!current || time > currentTime || (time === currentTime && price.unitPrice < current.unitPrice)) latest.set(price.storeId, price);
  }
  return [...latest.values()].sort((a, b) => a.unitPrice - b.unitPrice || (a.storeId < b.storeId ? -1 : a.storeId > b.storeId ? 1 : 0));
}

/** Das compras do produto: a nota sem mercado não entra aqui (ela fica no histórico, como "Mercado não informado"). */
export function storePricesFromPurchases(lines: readonly PurchaseLine[]): StorePrice[] {
  return latestByStore(
    lines.flatMap((line) =>
      line.storeId ? [{ storeId: line.storeId, unit: line.unit, unitPrice: line.unitPrice, purchasedAt: line.purchasedAt }] : [],
    ),
  );
}

/** Dos últimos preços guardados no aparelho (uma linha por produto, mercado e unidade), só os deste produto. */
export function storePricesFromSaved(saved: readonly SavedPrice[], productId: string): StorePrice[] {
  return latestByStore(
    saved
      .filter((row) => row.product_id === productId)
      .map((row) => ({ storeId: row.store_id, unit: row.unit, unitPrice: row.unit_price, purchasedAt: row.purchased_at })),
  );
}

/** De onde veio a lista: do histórico (em dia) ou do que ficou guardado no aparelho, por quê. */
export type StorePricesSource = 'history' | 'saved-offline' | 'saved-error';

export interface StorePricesView {
  /** undefined: ainda não se sabe (buscando). */
  prices: StorePrice[] | undefined;
  source: StorePricesSource | null;
}

/**
 * Qual lista mostrar. O histórico, quando chegou. Sem ele, porque a busca
 * está parada (sem internet) ou falhou, os últimos preços guardados no
 * aparelho, dizendo isso. Sem histórico nem nada guardado: lista vazia quando
 * a busca está parada (a tela diz que espera a conexão), e undefined enquanto
 * busca.
 */
export function storePricesView(
  history: { data: StorePrice[] | undefined; paused: boolean; failed: boolean },
  saved: readonly SavedPrice[] | undefined,
  productId: string,
): StorePricesView {
  if (history.data) return { prices: history.data, source: 'history' };
  if (!history.paused && !history.failed) return { prices: undefined, source: null };
  const source = history.paused ? 'saved-offline' : 'saved-error';
  return { prices: saved ? storePricesFromSaved(saved, productId) : [], source };
}

export const SAVED_PRICES_OFFLINE = 'Sem internet: estes são os últimos preços guardados no aparelho. O histórico de preço aparece quando a conexão voltar.';
export const SAVED_PRICES_ERROR = 'Não foi possível atualizar: estes são os últimos preços guardados no aparelho.';
export const NO_SAVED_PRICES_OFFLINE = 'Sem internet, e nenhum preço deste produto guardado no aparelho. Os preços aparecem quando a conexão voltar.';
export const NO_SAVED_PRICES_ERROR = 'Não foi possível carregar os preços deste produto.';
