// Resumo de preços de um produto entre mercados, comparando só preços na
// mesma unidade (R$/kg não se compara com R$/un). O preço por g ou por ml
// entra antes por kg ou por litro (inBaseUnit): o queijo de um mercado
// lançado por g se compara com o de outro lançado por kg.
// A linha de cada produto na tela Preços (summarizeStorePrices e as frases
// dela) é a primeira lista do "Último preço por mercado" da tela do produto,
// tirada dos últimos preços guardados (savedPricesByProduct): embalagens de
// tamanhos diferentes se comparam pelo preço por kg, litro ou item do pacote,
// como no histórico. summarizePrices fica para a conta da lista, onde o preço
// por unidade da casa continua por unidade.

import { formatBRL } from './money';
import { packSizeText } from './packCount';
import { PACK_ITEM } from './priceHistory';
import { storePriceGroups, type StorePrice } from './storePrices';
import { pricePerBase } from './units';

const UNIT_ORDER = ['un', 'kg', 'l'];

/**
 * Em Preços, buscando, o produto da casa que ainda não tem preço de nota (o nome dado a um código de barras, o
 * que ficou de uma nota excluída) aparece depois dos que têm, com esta linha: é por aí que se chega à tela dele
 * (para juntar, desfazer um "São diferentes" ou excluir).
 */
export const NO_PRICE_YET = 'Sem preço de nota ainda';

export interface PriceLike {
  store_id: string;
  unit: string;
  unit_price: number;
}

export interface PriceSummary<T extends PriceLike> {
  unit: string;
  cheapest: T;
  highest: number;
  /** Mercados com preço nesta unidade. */
  storeCount: number;
  /** Unidades em que também há preço, fora da comparação. */
  otherUnits: string[];
}

/** Quatro casas, como o banco guarda: 0,0399 x 1000 dá 39,900000000000006. */
const round4 = (value: number) => Math.round(value * 10000) / 10000;

/** O preço por kg ou litro quando veio por g ou ml (R$ 0,0399/g são R$ 39,90/kg); as outras unidades ficam como estão. */
export function inBaseUnit<T extends PriceLike>(price: T): T {
  const base = pricePerBase(price.unit_price, price.unit);
  if (base.unit === price.unit) return price;
  // kg e l são unidades do banco, como g e ml: o tipo da linha continua valendo.
  return { ...price, unit: base.unit, unit_price: round4(base.unitPrice) };
}

/**
 * Usa a unidade com mais mercados (empate: un, kg, l) e acha o menor e o
 * maior preço só entre eles. Os preços chegam por kg ou litro, nunca por g
 * ou ml (inBaseUnit).
 */
export function summarizePrices<T extends PriceLike>(prices: T[]): PriceSummary<T> | null {
  if (!prices.length) return null;
  const byUnit = new Map<string, T[]>();
  for (const price of prices) byUnit.set(price.unit, [...(byUnit.get(price.unit) ?? []), price]);
  const rank = (unit: string) => (UNIT_ORDER.includes(unit) ? UNIT_ORDER.indexOf(unit) : UNIT_ORDER.length);
  const [unit, group] = [...byUnit.entries()].sort(
    ([ua, a], [ub, b]) => new Set(b.map((p) => p.store_id)).size - new Set(a.map((p) => p.store_id)).size || rank(ua) - rank(ub),
  )[0];
  return {
    unit,
    cheapest: group.reduce((a, b) => (b.unit_price < a.unit_price ? b : a)),
    highest: Math.max(...group.map((p) => p.unit_price)),
    storeCount: new Set(group.map((p) => p.store_id)).size,
    otherUnits: [...byUnit.keys()].filter((u) => u !== unit),
  };
}

// ---------------------------------------------------------------------------
// A linha de cada produto na tela Preços

/** O resumo da linha em Preços: a primeira lista da tela do produto (a unidade com mais mercados). */
export interface StoreSummary {
  /** un, kg, l ou PACK_ITEM (item do pacote). */
  unit: string;
  cheapest: StorePrice;
  /** O maior preço da mesma unidade, em reais com centavos (como unitPrice). */
  highest: number;
  storeCount: number;
  /** As outras listas (kg, l, un, PACK_ITEM), fora da comparação; sem a dos pacotes sem tamanho, que vai em unsizedStores. */
  otherUnits: string[];
  /** Quantos mercados têm preço por unidade sem o tamanho na nota, ao lado de outros preços com tamanho; 0 quando não é o caso. */
  unsizedStores: number;
}

/**
 * O resumo de um produto a partir do "Último preço por mercado" (storePricesFromPurchases ou savedPricesByProduct):
 * a lista com mais mercados é a comparada. A lista por unidade em que nenhum preço diz o tamanho, ao lado de outros
 * que dizem, não é "também vendido por un": é o mercado cuja nota não diz o tamanho (unsizedStores).
 */
export function summarizeStorePrices(prices: readonly StorePrice[]): StoreSummary | null {
  const [main, ...others] = storePriceGroups(prices);
  if (!main) return null;
  const sized = prices.some((price) => price.packLabel != null);
  const unsized = others.find((group) => group.unit === 'un' && sized && group.prices.every((price) => price.packLabel == null));
  return {
    unit: main.unit,
    cheapest: main.prices[0],
    highest: Math.max(...main.prices.map((price) => price.unitPrice)),
    storeCount: main.prices.length,
    otherUnits: others.filter((group) => group !== unsized).map((group) => group.unit),
    unsizedStores: unsized ? unsized.prices.length : 0,
  };
}

/** "R$ 4,98–5,49/kg", "R$ 0,83–0,99 cada" ("o ovo" nos ovos), "R$ 5,49–24,90" (por unidade, sem sufixo), "R$ 24,90". */
export function storeSummaryPrice(summary: StoreSummary, category?: string | null): string {
  const { unit, cheapest, highest, storeCount } = summary;
  const range = storeCount > 1 && highest > cheapest.unitPrice ? `–${formatBRL(highest).replace('R$ ', '')}` : '';
  const suffix = unit === 'un' ? '' : unit === PACK_ITEM ? (category === 'ovos' ? ' o ovo' : ' cada') : `/${unit}`;
  return `${formatBRL(cheapest.unitPrice)}${range}${suffix}`;
}

/**
 * A linha embaixo do produto em Preços: "Mais barato: Assaí (5 kg por R$ 24,90) · 2 mercados", "Só em Dia", e as
 * outras listas ("também vendido por kg", "também por item do pacote", "mais 1 mercado sem o tamanho na nota").
 * O tamanho entre parênteses só quando a lista se comparou pelo tamanho (o preço é por kg, litro ou item).
 */
export function storeSummaryLine(summary: StoreSummary, storeName: (storeId: string) => string | undefined, category?: string | null): string {
  const { cheapest, storeCount, otherUnits, unsizedStores } = summary;
  const pack =
    cheapest.packagePrice != null && cheapest.packLabel ? ` (${packSizeText(cheapest.packLabel, category)} por ${formatBRL(cheapest.packagePrice)})` : '';
  const parts = [
    storeCount > 1
      ? `Mais barato: ${storeName(cheapest.storeId) ?? 'mercado'}${pack} · ${storeCount} mercados`
      : `Só em ${storeName(cheapest.storeId) ?? 'um mercado'}${pack}`,
  ];
  const plain = otherUnits.filter((unit) => unit !== PACK_ITEM);
  if (plain.length) parts.push(`também vendido por ${plain.join(', ')}`);
  if (otherUnits.includes(PACK_ITEM)) parts.push(category === 'ovos' ? 'também por ovo' : 'também por item do pacote');
  if (unsizedStores) parts.push(`mais ${unsizedStores} ${unsizedStores === 1 ? 'mercado' : 'mercados'} sem o tamanho na nota`);
  return parts.join(' · ');
}
