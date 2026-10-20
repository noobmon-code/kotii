// "Último preço por mercado", na tela do produto: o preço mais recente de
// cada mercado da casa, do mais barato ao mais caro. Sai do histórico inteiro
// do produto (as compras lidas página por página, data/market
// fetchProductPurchases), nunca de uma parte dele: um mercado em que a casa
// comprou pela última vez há muito tempo continua na lista. Sem internet, sai
// dos últimos preços que ficam guardados no aparelho (a view latest_prices,
// lida inteira para a estimativa da lista).
// Os preços se comparam como no histórico logo abaixo (toPurchases): por kg,
// litro, unidade ou item do pacote, com o tamanho da embalagem lido na nota.
// Preço por kg não se compara com preço por unidade: cada unidade tem a sua
// lista e o seu "Mais barato". Os preços guardados no aparelho não têm a
// descrição da nota: ali g vira kg e ml vira litro, mas o tamanho do pacote
// não é conhecido.

import { formatShortDate, toISODate } from './dates';
import { formatBRL } from './money';
import { isPriced, PACK_ITEM, roundPrice, toPurchases, unitLabel, type PurchaseLine } from './priceHistory';
import { pricePerBase } from './units';

export interface StorePrice {
  storeId: string;
  /** A unidade em que os preços se comparam: un, kg, l ou PACK_ITEM (item do pacote). */
  unit: string;
  /** O preço por `unit`, em centavos inteiros (o de g e ml já por kg e litro). */
  unitPrice: number;
  /** Momento da compra (o banco guarda em UTC). */
  purchasedAt: string;
  /** O tamanho da embalagem lido na nota ("5 kg"), na compra por unidade; null quando não se sabe. */
  packLabel: string | null;
  /** Na compra comparada pelo tamanho, o preço impresso da embalagem (o `unitPrice` é por kg, litro ou item); senão, null. */
  packagePrice: number | null;
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
 * O último preço de cada mercado em cada unidade, do mais barato ao mais
 * caro. Zero não é preço (o item que ficou sem valor na nota): a compra de
 * verdade anterior do mesmo mercado fica no lugar dele. No mesmo instante,
 * vale o menor preço, para a lista não mudar de uma leitura para outra.
 */
export function latestByStore(prices: Iterable<StorePrice>): StorePrice[] {
  const latest = new Map<string, StorePrice>();
  for (const price of prices) {
    if (!(price.unitPrice > 0)) continue;
    const key = `${price.storeId}|${price.unit}`;
    const current = latest.get(key);
    const time = Date.parse(price.purchasedAt);
    const currentTime = current ? Date.parse(current.purchasedAt) : -Infinity;
    if (!current || time > currentTime || (time === currentTime && price.unitPrice < current.unitPrice)) latest.set(key, price);
  }
  return [...latest.values()].sort(
    (a, b) => a.unitPrice - b.unitPrice || (a.storeId < b.storeId ? -1 : a.storeId > b.storeId ? 1 : 0) || (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0),
  );
}

/**
 * Das compras do produto, comparadas como no histórico (toPurchases): "ARROZ
 * 5KG" e "ARROZ 1KG" pelo preço por kg, a linha em g por kg. A nota sem
 * mercado não entra aqui (ela fica no histórico, como "Mercado não
 * informado"). Aqui o mercado é a loja (o id), não o nome.
 */
export function storePricesFromPurchases(lines: readonly PurchaseLine[]): StorePrice[] {
  // A compra guarda só a nota; o mercado e o momento são os da nota.
  const receipts = new Map(lines.map((line) => [line.receiptId, line]));
  return latestByStore(
    toPurchases([...lines]).flatMap((purchase) => {
      const receipt = receipts.get(purchase.receiptId);
      if (!receipt?.storeId || !isPriced(purchase)) return [];
      return [
        {
          storeId: receipt.storeId,
          unit: purchase.baseUnit,
          unitPrice: purchase.price,
          purchasedAt: receipt.purchasedAt,
          packLabel: purchase.pack?.label ?? null,
          packagePrice: purchase.packagePrice,
        },
      ];
    }),
  );
}

/** Dos últimos preços guardados no aparelho (uma linha por produto, mercado e unidade), só os deste produto. */
export function storePricesFromSaved(saved: readonly SavedPrice[], productId: string): StorePrice[] {
  return latestByStore(
    saved
      .filter((row) => row.product_id === productId)
      .map((row) => {
        const base = pricePerBase(row.unit_price, row.unit);
        return {
          storeId: row.store_id,
          unit: base.unit,
          unitPrice: roundPrice(base.unitPrice),
          purchasedAt: row.purchased_at,
          packLabel: null,
          packagePrice: null,
        };
      }),
  );
}

export interface StorePriceGroup {
  unit: string;
  /** "Por kg", "Por unidade": o título da lista quando há mais de uma. */
  title: string;
  /** Do mais barato ao mais caro. */
  prices: StorePrice[];
}

const GROUP_ORDER = ['un', PACK_ITEM, 'kg', 'l'];

/**
 * Os preços em listas, uma por unidade: só se comparam (e só ganham "Mais
 * barato") os da mesma unidade. Primeiro a lista com mais mercados; no
 * empate, por unidade, por item do pacote, por kg, por litro.
 */
export function storePriceGroups(prices: readonly StorePrice[]): StorePriceGroup[] {
  const byUnit = new Map<string, StorePrice[]>();
  for (const price of prices) byUnit.set(price.unit, [...(byUnit.get(price.unit) ?? []), price]);
  const rank = (unit: string) => (GROUP_ORDER.includes(unit) ? GROUP_ORDER.indexOf(unit) : GROUP_ORDER.length);
  return [...byUnit.entries()]
    .sort(([ua, a], [ub, b]) => b.length - a.length || rank(ua) - rank(ub) || (ua < ub ? -1 : 1))
    .map(([unit, group]) => {
      const label = unitLabel(unit);
      return { unit, title: label.charAt(0).toLocaleUpperCase('pt-BR') + label.slice(1), prices: group };
    });
}

/** Como a linha mostra o preço: "R$ 4,98/kg", "R$ 25,90/un"; por item do pacote, "R$ 0,83 cada". */
export function storePriceLabel(price: Pick<StorePrice, 'unit' | 'unitPrice'>): string {
  return price.unit === PACK_ITEM ? `${formatBRL(price.unitPrice)} cada` : `${formatBRL(price.unitPrice)}/${price.unit}`;
}

/** "5 kg por R$ 24,90 · em 10 out" na compra comparada pelo tamanho; "5 kg · em 10 out" com um tamanho só; senão, "em 10 out". */
export function storePriceDetail(price: StorePrice): string {
  const when = `em ${formatShortDate(toISODate(new Date(price.purchasedAt)))}`;
  if (!price.packLabel) return when;
  const pack = price.packagePrice != null ? `${price.packLabel} por ${formatBRL(price.packagePrice)}` : price.packLabel;
  return `${pack} · ${when}`;
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
