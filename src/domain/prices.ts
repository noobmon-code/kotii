// Resumo de preços de um produto entre mercados, comparando só preços na
// mesma unidade (R$/kg não se compara com R$/un). O preço por g ou por ml
// entra antes por kg ou por litro (inBaseUnit): o queijo de um mercado
// lançado por g se compara com o de outro lançado por kg.

import { pricePerBase } from './units';

const UNIT_ORDER = ['un', 'kg', 'l'];

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
 * Os preços de cada produto, já por kg ou litro (inBaseUnit), agrupados uma
 * vez só: a tela Preços filtra os produtos a cada letra da busca, e não a
 * lista inteira de preços para cada produto.
 */
export function pricesByProduct<T extends PriceLike & { product_id: string }>(prices: readonly T[]): Map<string, T[]> {
  const byProduct = new Map<string, T[]>();
  for (const price of prices) {
    const list = byProduct.get(price.product_id);
    if (list) list.push(inBaseUnit(price));
    else byProduct.set(price.product_id, [inBaseUnit(price)]);
  }
  return byProduct;
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
