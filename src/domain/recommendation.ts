// Onde comprar a lista: compara lojas usando o último preço conhecido de cada
// produto em cada loja (vindo das notas fiscais confirmadas).
//
// Problema central: quase nunca uma loja tem preço para todos os itens. Para
// comparar de forma justa, cada loja ganha um índice de preço (quão acima ou
// abaixo da média ela costuma estar nos produtos em comum com outras lojas) e
// os itens sem preço naquela loja são estimados com esse índice.
//
// É a mesma conta da estimativa na tela da lista (listEstimate): a tela passa
// o preço de cada item em cada mercado já resolvido de lá (listStorePrices,
// em `priceAt`) e o mesmo índice (priceLevel). Sem `priceAt`, a conta é a
// daqui: o produto do item, numa unidade só para todos os mercados (units).

import { storePriceIndex } from './priceLevel';
import { priceQuantity, sameDimension } from './units';

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
  /** A unidade da lista não converte para a do preço (un x kg): custo = 1 unidade de preço. */
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

/** O preço de um item num mercado, já resolvido por quem chama (`priceAt`). */
export interface StorePriceAnswer {
  cost: number;
  kind: 'known' | 'estimated';
  /** A unidade da lista não converte para a do preço (un x kg): custo = 1 unidade de preço. */
  approximateQuantity: boolean;
}

interface ItemPrices {
  item: ListItemInput;
  /** Os mercados com preço de nota para o item. */
  knownStores: string[];
  /** O preço do item num mercado: o de nota ou o estimado. */
  at: (storeId: string) => StorePriceAnswer;
}

function comparableUnit(item: ListItemInput, prices: PriceInput[]): string {
  const storesPerUnit = new Map<string, number>();
  for (const p of prices) storesPerUnit.set(p.unit, (storesPerUnit.get(p.unit) ?? 0) + 1);
  let best = item.unit;
  let bestCount = storesPerUnit.get(item.unit) ?? 0;
  for (const [unit, count] of storesPerUnit) {
    // No empate, a unidade que converte para a da lista (g e kg) vence a que não converte.
    if (count > bestCount || (count === bestCount && sameDimension(unit, item.unit) && !sameDimension(best, item.unit))) {
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

/**
 * `priceAt`: o preço de cada item (pela `key`) em cada mercado, já resolvido
 * (listStorePrices, da estimativa da lista): o de nota de lá ou o estimado;
 * null quando o item não tem preço. É assim que "Onde comprar" dá o mesmo
 * total que a lista mostra com o mercado escolhido. Sem ele, o preço sai do
 * `productId` do item, numa unidade só para todos os mercados (a que mais
 * mercados têm).
 *
 * `storeIndex`: o nível de preço já calculado com todos os preços da casa
 * (storePriceIndex), o mesmo da estimativa da lista. Sem ele, o nível sai só
 * dos produtos desta lista (com `priceAt`, de todos os preços recebidos).
 */
export function recommendStores(
  items: ListItemInput[],
  prices: PriceInput[],
  maxStores: number,
  {
    storeIndex: givenIndex,
    priceAt,
  }: {
    storeIndex?: ReadonlyMap<string, number>;
    priceAt?: (itemKey: string, storeId: string) => StorePriceAnswer | null;
  } = {},
): Recommendation {
  const pricesByProduct = new Map<string, PriceInput[]>();
  for (const p of prices) {
    // Preço zerado (brinde na nota) não é preço.
    if (!(p.unitPrice > 0)) continue;
    const list = pricesByProduct.get(p.productId) ?? [];
    list.push(p);
    pricesByProduct.set(p.productId, list);
  }

  const storeIndex = new Map<string, number>();
  const priced: ItemPrices[] = [];
  const listPrices = new Map<string, PriceInput[]>();
  const unpricedKeys: string[] = [];
  // Com `priceAt`, a pergunta vai para todo mercado que tem algum preço da casa.
  const everyStore = priceAt ? [...new Set([...pricesByProduct.values()].flat().map((p) => p.storeId))] : [];
  for (const item of items) {
    if (priceAt) {
      const answers = new Map<string, StorePriceAnswer>();
      for (const storeId of everyStore) {
        const answer = priceAt(item.key, storeId);
        if (answer) answers.set(storeId, answer);
      }
      // Sem resposta em algum mercado, o item fica fora da conta: o total de lá não se compararia com o dos outros.
      if (!everyStore.length || answers.size < everyStore.length) {
        unpricedKeys.push(item.key);
        continue;
      }
      priced.push({
        item,
        knownStores: [...answers].filter(([, answer]) => answer.kind === 'known').map(([storeId]) => storeId),
        at: (storeId) => answers.get(storeId)!,
      });
      continue;
    }
    const productPrices = item.productId ? pricesByProduct.get(item.productId) : undefined;
    if (!productPrices?.length) {
      unpricedKeys.push(item.key);
      continue;
    }
    listPrices.set(item.productId!, productPrices);
    const unit = comparableUnit(item, productPrices);
    const byStore = new Map<string, number>();
    for (const p of productPrices) if (p.unit === unit) byStore.set(p.storeId, p.unitPrice);
    const values = [...byStore.values()];
    const average = values.reduce((a, b) => a + b, 0) / values.length;
    // 200 g com preço por kg é 0,2 x o preço; un x kg não converte: 1 unidade do preço.
    const { quantity: multiplier, approximate } = priceQuantity(item.quantity, item.unit, unit);
    priced.push({
      item,
      knownStores: [...byStore.keys()],
      at: (storeId) => {
        const known = byStore.get(storeId);
        return {
          cost: round2((known ?? average * storeIndex.get(storeId)!) * multiplier),
          kind: known == null ? 'estimated' : 'known',
          approximateQuantity: approximate,
        };
      },
    });
  }

  // Índice de preço (priceLevel): média de (preço na loja / preço médio) nos
  // produtos que aparecem em 2+ lojas, puxada para 1 quando são poucos. Itens
  // de uma loja só não dizem nada sobre a loja.
  const level = givenIndex ?? storePriceIndex(priceAt ? prices : [...listPrices.values()].flat());
  const storeIds = [...new Set(priced.flatMap((p) => p.knownStores))].sort();
  for (const id of storeIds) storeIndex.set(id, level.get(id) ?? 1);

  const plans: StorePlan[] = [];
  const limit = Math.max(1, Math.min(maxStores, storeIds.length));
  for (let size = 1; size <= limit; size++) {
    for (const combo of combinations(storeIds, size)) {
      const assignments: Assignment[] = [];
      for (const p of priced) {
        let best: Assignment | null = null;
        for (const storeId of combo) {
          const { cost, kind, approximateQuantity } = p.at(storeId);
          const candidate: Assignment = { itemKey: p.item.key, storeId, cost, kind, approximateQuantity };
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
