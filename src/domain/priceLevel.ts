// Nível de preço de cada mercado: quanto ele costuma ficar acima ou abaixo da
// média nos produtos que a casa já comprou em mais de um mercado. É com ele
// que a estimativa da lista (listEstimate) e "Onde comprar" (recommendation)
// estimam o que um mercado ainda não tem nas notas.

export interface LevelPrice {
  productId: string;
  storeId: string;
  unit: string;
  unitPrice: number;
}

/**
 * Poucos produtos em comum dizem pouco: a média (nível 1) entra na conta como
 * se fossem mais 2 produtos. Com 1 em comum o nível anda um terço do caminho;
 * com 8, quatro quintos.
 */
const AVERAGE_WEIGHT = 2;
/** Fora desta faixa é erro de nota (embalagem trocada, preço digitado errado), não nível de preço. */
const MIN_LEVEL = 0.6;
const MAX_LEVEL = 1.6;

/**
 * Nível de preço por mercado (1 = na média; 0,92 = 8% abaixo): a média de
 * preço no mercado / preço médio, nos produtos que aparecem em dois mercados
 * ou mais, puxada para 1 quando são poucos e presa a uma faixa plausível.
 * Mercado sem produto em comum com outro fica em 1. Preço zerado ou negativo
 * (brinde na nota) não é preço: fica de fora, e o mercado que só tem desses
 * nem aparece.
 */
export function storePriceIndex(prices: readonly LevelPrice[]): Map<string, number> {
  const groups = new Map<string, LevelPrice[]>();
  for (const price of prices) {
    if (!(price.unitPrice > 0)) continue;
    const key = `${price.productId}\u0000${price.unit}`;
    groups.set(key, [...(groups.get(key) ?? []), price]);
  }
  const index = new Map<string, number>();
  const ratios = new Map<string, number[]>();
  for (const group of groups.values()) {
    for (const price of group) index.set(price.storeId, 1);
    if (new Set(group.map((p) => p.storeId)).size < 2) continue;
    const mean = group.reduce((sum, p) => sum + p.unitPrice, 0) / group.length;
    for (const price of group) ratios.set(price.storeId, [...(ratios.get(price.storeId) ?? []), price.unitPrice / mean]);
  }
  for (const [storeId, list] of ratios) {
    const level = (list.reduce((sum, ratio) => sum + ratio, 0) + AVERAGE_WEIGHT) / (list.length + AVERAGE_WEIGHT);
    index.set(storeId, Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, level)));
  }
  return index;
}
