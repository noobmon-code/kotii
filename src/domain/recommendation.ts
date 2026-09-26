// Onde comprar a lista: compara lojas usando o último preço conhecido de cada
// produto em cada loja (vindo das notas fiscais confirmadas).
//
// Problema central: quase nunca uma loja tem preço para todos os itens. Para
// comparar de forma justa, cada loja ganha um índice de preço (quão acima ou
// abaixo da média ela costuma estar nos produtos em comum com outras lojas) e
// os itens sem preço naquela loja são estimados com esse índice.

export interface ListItemInput {
  key: string;
  productId: string | null;
  quantity: number;
  unit: string;
}

export interface PriceInput {
  productId: string;
  storeId: string;
  unit: string;
  unitPrice: number;
}

export interface Assignment {
  itemKey: string;
  storeId: string;
  cost: number;
  kind: 'known' | 'estimated';
  /** Unidade da lista difere da unidade do preço: custo = 1 unidade de preço. */
  approximateQuantity: boolean;
}

export interface StorePlan {
  storeIds: string[];
  total: number;
  knownTotal: number;
  estimatedTotal: number;
  knownCount: number;
  estimatedCount: number;
  assignments: Assignment[];
}

export interface Recommendation {
  /** Planos ordenados do mais barato ao mais caro. */
  plans: StorePlan[];
  /** Índice de preço por loja (1 = média; 0,92 = 8% abaixo da média). */
  storeIndex: Map<string, number>;
  /** Itens sem nenhum preço conhecido (fora dos totais). */
  unpricedKeys: string[];
}

interface ItemPrices {
  item: ListItemInput;
  multiplier: number;
  approximateQuantity: boolean;
  byStore: Map<string, number>;
  average: number;
}

function comparableUnit(item: ListItemInput, prices: PriceInput[]): string {
  const storesPerUnit = new Map<string, number>();
  for (const p of prices) storesPerUnit.set(p.unit, (storesPerUnit.get(p.unit) ?? 0) + 1);
  let best = item.unit;
  let bestCount = storesPerUnit.get(item.unit) ?? 0;
  for (const [unit, count] of storesPerUnit) {
    if (count > bestCount) {
      best = unit;
      bestCount = count;
    }
  }
  return best;
}

function* combinations<T>(values: T[], size: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === size) {
    yield acc.slice();
    return;
  }
  for (let i = start; i < values.length; i++) {
    acc.push(values[i]);
    yield* combinations(values, size, i + 1, acc);
    acc.pop();
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function recommendStores(
  items: ListItemInput[],
  prices: PriceInput[],
  maxStores: number,
): Recommendation {
  const pricesByProduct = new Map<string, PriceInput[]>();
  for (const p of prices) {
    const list = pricesByProduct.get(p.productId) ?? [];
    list.push(p);
    pricesByProduct.set(p.productId, list);
  }

  const priced: ItemPrices[] = [];
  const unpricedKeys: string[] = [];
  for (const item of items) {
    const productPrices = item.productId ? pricesByProduct.get(item.productId) : undefined;
    if (!productPrices?.length) {
      unpricedKeys.push(item.key);
      continue;
    }
    const unit = comparableUnit(item, productPrices);
    const byStore = new Map<string, number>();
    for (const p of productPrices) if (p.unit === unit) byStore.set(p.storeId, p.unitPrice);
    const values = [...byStore.values()];
    const sameUnit = item.unit === unit;
    priced.push({
      item,
      multiplier: sameUnit ? item.quantity : 1,
      approximateQuantity: !sameUnit,
      byStore,
      average: values.reduce((a, b) => a + b, 0) / values.length,
    });
  }

  // Índice de preço: média de (preço na loja / preço médio) nos itens que
  // aparecem em 2+ lojas. Itens de uma loja só não dizem nada sobre a loja.
  const ratios = new Map<string, number[]>();
  for (const p of priced) {
    if (p.byStore.size < 2 || p.average === 0) continue;
    for (const [storeId, price] of p.byStore) {
      const list = ratios.get(storeId) ?? [];
      list.push(price / p.average);
      ratios.set(storeId, list);
    }
  }
  const storeIds = [...new Set(priced.flatMap((p) => [...p.byStore.keys()]))].sort();
  const storeIndex = new Map<string, number>();
  for (const id of storeIds) {
    const list = ratios.get(id);
    storeIndex.set(id, list?.length ? list.reduce((a, b) => a + b, 0) / list.length : 1);
  }

  const plans: StorePlan[] = [];
  const limit = Math.max(1, Math.min(maxStores, storeIds.length));
  for (let size = 1; size <= limit; size++) {
    for (const combo of combinations(storeIds, size)) {
      const assignments: Assignment[] = [];
      for (const p of priced) {
        let best: Assignment | null = null;
        for (const storeId of combo) {
          const known = p.byStore.get(storeId);
          const unitCost = known ?? p.average * storeIndex.get(storeId)!;
          const candidate: Assignment = {
            itemKey: p.item.key,
            storeId,
            cost: round2(unitCost * p.multiplier),
            kind: known == null ? 'estimated' : 'known',
            approximateQuantity: p.approximateQuantity,
          };
          // Preço conhecido vence estimativa de mesmo valor.
          if (
            !best ||
            candidate.cost < best.cost ||
            (candidate.cost === best.cost && candidate.kind === 'known' && best.kind === 'estimated')
          ) {
            best = candidate;
          }
        }
        assignments.push(best!);
      }

      // Combinação em que uma loja não recebe nenhum item é só uma combinação
      // menor disfarçada — já avaliada.
      if (size > 1 && combo.some((id) => !assignments.some((a) => a.storeId === id))) continue;

      const known = assignments.filter((a) => a.kind === 'known');
      const estimated = assignments.filter((a) => a.kind === 'estimated');
      const knownTotal = round2(known.reduce((s, a) => s + a.cost, 0));
      const estimatedTotal = round2(estimated.reduce((s, a) => s + a.cost, 0));
      plans.push({
        storeIds: combo,
        total: round2(knownTotal + estimatedTotal),
        knownTotal,
        estimatedTotal,
        knownCount: known.length,
        estimatedCount: estimated.length,
        assignments,
      });
    }
  }

  plans.sort(
    (a, b) =>
      a.total - b.total ||
      a.storeIds.length - b.storeIds.length ||
      b.knownCount - a.knownCount,
  );

  return { plans, storeIndex, unpricedKeys };
}
