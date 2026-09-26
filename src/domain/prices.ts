// Resumo de preços de um produto entre mercados, comparando só preços na
// mesma unidade (R$/kg não se compara com R$/un).

const UNIT_ORDER = ['un', 'kg', 'g', 'l', 'ml'];

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

/**
 * Usa a unidade com mais mercados (empate: un, kg, g, l, ml) e acha o menor
 * e o maior preço só entre eles.
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
