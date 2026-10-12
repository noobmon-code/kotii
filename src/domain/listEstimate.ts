// Lista no mercado: quanto a lista deve dar, o preço de referência de cada
// item e o que já está na despensa. Os preços são o último de cada produto em
// cada mercado (notas confirmadas). Item digitado solto ("Coca") usa as
// ligações nome -> produto aprendidas nas notas, ou o produto de mesmo nome.

import { formatShortDate, toISODate } from './dates';
import type { LinkIndex } from './listLinks';
import { formatBRL, formatQuantity } from './money';
import { normalizeSearch } from './search';

export interface EstimateItem {
  id: string;
  name: string;
  productId: string | null;
  quantity: number;
  unit: string;
  inCart: boolean;
}

export interface EstimatePrice {
  productId: string;
  storeId: string;
  unit: string;
  unitPrice: number;
  /** Quando a casa pagou esse preço (ISO). */
  purchasedAt: string;
}

export interface ItemEstimate {
  /** Quanto o item deve custar, na quantidade da lista. */
  cost: number;
  unitPrice: number;
  /** A unidade do preço (R$/kg não é R$/un). */
  unit: string;
  /**
   * `known`: preço de nota, do mercado escolhido ou, sem mercado, o último que
   * a casa pagou. `estimated`: o mercado escolhido não tem esse item; o preço
   * sai do nível de preço dele (como em "Onde comprar").
   */
  kind: 'known' | 'estimated';
  /** A unidade da lista não é a do preço: o custo é o de 1 unidade do preço. */
  approximateQuantity: boolean;
  /** O último preço que a casa pagou pelo item, em qualquer mercado. */
  last: { unitPrice: number; storeId: string; purchasedAt: string };
  /** O menor entre os últimos preços dos mercados: o "preço bom". */
  lowest: { unitPrice: number; storeId: string };
}

export interface ListEstimate {
  byItem: Map<string, ItemEstimate>;
  /** A lista toda (a comprar e no carrinho), só os itens com preço. */
  total: number;
  cartTotal: number;
  pendingTotal: number;
  itemCount: number;
  pricedCount: number;
  estimatedCount: number;
  /** Mercados com preço de nota para algum item da lista, do que cobre mais itens para o que cobre menos. */
  stores: { storeId: string; knownCount: number }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

/**
 * Nível de preço de cada mercado (1 = na média; 0,92 = 8% abaixo): a média de
 * preço no mercado / preço médio, nos produtos que aparecem em dois mercados
 * ou mais. Mercado sem produto em comum com outro fica em 1.
 */
export function storePriceIndex(prices: readonly EstimatePrice[]): Map<string, number> {
  const groups = new Map<string, EstimatePrice[]>();
  for (const price of prices) {
    const key = `${price.productId}\u0000${price.unit}`;
    groups.set(key, [...(groups.get(key) ?? []), price]);
  }
  const ratios = new Map<string, number[]>();
  for (const group of groups.values()) {
    if (new Set(group.map((p) => p.storeId)).size < 2) continue;
    const mean = average(group.map((p) => p.unitPrice));
    if (mean <= 0) continue;
    for (const price of group) ratios.set(price.storeId, [...(ratios.get(price.storeId) ?? []), price.unitPrice / mean]);
  }
  const index = new Map<string, number>();
  for (const price of prices) index.set(price.storeId, 1);
  for (const [storeId, list] of ratios) index.set(storeId, average(list));
  return index;
}

const newest = <T extends { purchasedAt: string }>(quotes: T[]) =>
  quotes.reduce((a, b) => (Date.parse(b.purchasedAt) > Date.parse(a.purchasedAt) ? b : a));

/**
 * A estimativa da lista. Com `storeId` ("estou no Assaí"), vale o preço desse
 * mercado; o que ele não tem é estimado pelo nível de preço dele. Sem mercado,
 * vale o último preço que a casa pagou em cada item. Item sem preço nenhum
 * fica fora dos totais.
 */
export function estimateList(
  items: readonly EstimateItem[],
  prices: readonly EstimatePrice[],
  {
    links,
    products = [],
    storeId = null,
  }: { links?: LinkIndex; products?: readonly { id: string; name: string }[]; storeId?: string | null } = {},
): ListEstimate {
  const byProduct = new Map<string, EstimatePrice[]>();
  for (const price of prices) byProduct.set(price.productId, [...(byProduct.get(price.productId) ?? []), price]);
  const productByName = new Map(products.map((product) => [normalizeSearch(product.name), product.id]));
  const index = storePriceIndex(prices);

  const byItem = new Map<string, ItemEstimate>();
  const known = new Map<string, number>();
  for (const item of items) {
    // O produto do item; sem ele, os que já cumpriram esse nome nas notas, ou o de mesmo nome.
    const sameName = productByName.get(normalizeSearch(item.name));
    const candidates = item.productId
      ? [item.productId]
      : [...new Set([...(links?.productsFor(item.name) ?? []), ...(sameName ? [sameName] : [])])];
    const all = candidates.flatMap((productId) => byProduct.get(productId) ?? []);
    if (!all.length) continue;
    // Na unidade da lista quando há preço nela; senão, na do preço mais recente.
    const unit = all.some((quote) => quote.unit === item.unit) ? item.unit : newest(all).unit;
    const quotes = all.filter((quote) => quote.unit === unit);
    const last = newest(quotes);
    const lowest = quotes.reduce((a, b) => (b.unitPrice < a.unitPrice ? b : a));

    for (const store of new Set(quotes.map((quote) => quote.storeId))) known.set(store, (known.get(store) ?? 0) + 1);

    let unitPrice = last.unitPrice;
    let kind: ItemEstimate['kind'] = 'known';
    if (storeId) {
      const here = quotes.filter((quote) => quote.storeId === storeId);
      if (here.length) {
        unitPrice = newest(here).unitPrice;
      } else {
        // O mercado não tem esse item nas notas: a média do produto nos outros, no nível de preço deste.
        const sameProduct = quotes.filter((quote) => quote.productId === last.productId);
        unitPrice = average(sameProduct.map((quote) => quote.unitPrice)) * (index.get(storeId) ?? 1);
        kind = 'estimated';
      }
    }
    const sameUnit = item.unit === unit;
    byItem.set(item.id, {
      cost: round2(unitPrice * (sameUnit ? item.quantity : 1)),
      unitPrice: round2(unitPrice),
      unit,
      kind,
      approximateQuantity: !sameUnit,
      last: { unitPrice: last.unitPrice, storeId: last.storeId, purchasedAt: last.purchasedAt },
      lowest: { unitPrice: lowest.unitPrice, storeId: lowest.storeId },
    });
  }

  const sum = (inCart: boolean) => round2(items.reduce((s, item) => s + (item.inCart === inCart ? (byItem.get(item.id)?.cost ?? 0) : 0), 0));
  const cartTotal = sum(true);
  const pendingTotal = sum(false);
  return {
    byItem,
    total: round2(cartTotal + pendingTotal),
    cartTotal,
    pendingTotal,
    itemCount: items.length,
    pricedCount: byItem.size,
    estimatedCount: [...byItem.values()].filter((estimate) => estimate.kind === 'estimated').length,
    stores: [...known]
      .map(([id, knownCount]) => ({ storeId: id, knownCount }))
      .sort((a, b) => b.knownCount - a.knownCount || a.storeId.localeCompare(b.storeId)),
  };
}

/** O que está na despensa (sem o que já foi consumido). */
export interface PantryStock {
  product_id: string | null;
  name: string;
  quantity: number;
  unit: string;
  purchased_on: string;
  expires_on: string | null;
}

export interface PantryHit {
  /** O nome como está na despensa. */
  name: string;
  /** A soma do que há; null quando as entradas estão em unidades diferentes. */
  quantity: number | null;
  unit: string | null;
  /** A compra mais recente. */
  since: string;
  /** A validade que vence primeiro, se houver. */
  expiresOn: string | null;
}

/**
 * Itens da lista que já estão na despensa, dentro da validade: o mesmo
 * produto, um nome que as notas já ligaram a esse produto, ou o mesmo nome.
 * Nome só parecido não conta ("Leite" não é "Leite condensado").
 */
export function pantryHits(
  items: readonly Pick<EstimateItem, 'id' | 'name' | 'productId'>[],
  pantry: readonly PantryStock[],
  { links, today }: { links?: LinkIndex; today: string },
): Map<string, PantryHit> {
  const fresh = pantry.filter((entry) => !entry.expires_on || entry.expires_on >= today);
  const hits = new Map<string, PantryHit>();
  for (const item of items) {
    const name = normalizeSearch(item.name);
    const same = fresh.filter((entry) => {
      if (item.productId && entry.product_id) return item.productId === entry.product_id;
      if (entry.product_id && links?.has(item.name, entry.product_id)) return true;
      if (item.productId && links?.has(entry.name, item.productId)) return true;
      return Boolean(name) && normalizeSearch(entry.name) === name;
    });
    if (!same.length) continue;
    const oneUnit = same.every((entry) => entry.unit === same[0].unit);
    const expiries = same.flatMap((entry) => (entry.expires_on ? [entry.expires_on] : [])).sort();
    hits.set(item.id, {
      name: same[0].name,
      quantity: oneUnit ? Math.round(same.reduce((s, entry) => s + Number(entry.quantity), 0) * 1000) / 1000 : null,
      unit: oneUnit ? same[0].unit : null,
      since: same.map((entry) => entry.purchased_on).sort().at(-1)!,
      expiresOn: expiries[0] ?? null,
    });
  }
  return hits;
}

const perUnit = (unitPrice: number, unit: string) => `${formatBRL(unitPrice)}/${unit}`;

/** Como o custo do item aparece na lista: "~" quando é estimado ou a quantidade é aproximada. */
export function formatItemCost(estimate: Pick<ItemEstimate, 'cost' | 'kind' | 'approximateQuantity'>): string {
  return `${estimate.kind === 'estimated' || estimate.approximateQuantity ? '~' : ''}${formatBRL(estimate.cost)}`;
}

/** De onde sai a estimativa da lista, numa frase. */
export function describeEstimate(estimate: Pick<ListEstimate, 'itemCount' | 'pricedCount' | 'estimatedCount'>, storeName: string | null): string {
  const priced =
    estimate.pricedCount === estimate.itemCount
      ? 'todos os itens têm preço'
      : `${estimate.pricedCount} de ${estimate.itemCount} itens têm preço`;
  if (!storeName) return `Pelo último preço que a casa pagou em cada item; ${priced}.`;
  const estimated = estimate.estimatedCount
    ? `, ${estimate.estimatedCount} ${estimate.estimatedCount === 1 ? 'estimado' : 'estimados'} pelo nível de preço de lá`
    : '';
  return `Pelos preços do ${storeName}; ${priced}${estimated}.`;
}

/**
 * O que a casa sabe do item, para os detalhes dele na lista: o último preço,
 * o menor entre os mercados (o "preço bom"), o preço no mercado escolhido e o
 * que já está na despensa.
 */
export function itemFacts(
  estimate: ItemEstimate | undefined,
  hit: PantryHit | undefined,
  { storeName, chosenStore, promotionOnly = false }: { storeName: (storeId: string) => string; chosenStore?: string | null; promotionOnly?: boolean },
): string[] {
  const facts: string[] = [];
  if (estimate) {
    const { last, lowest, unit } = estimate;
    facts.push(`Último preço: ${perUnit(last.unitPrice, unit)} no ${storeName(last.storeId)}, em ${formatShortDate(toISODate(new Date(last.purchasedAt)))}.`);
    if (lowest.unitPrice < last.unitPrice) facts.push(`Menor entre os mercados: ${perUnit(lowest.unitPrice, unit)} no ${storeName(lowest.storeId)}.`);
    if (chosenStore && estimate.kind === 'estimated') {
      facts.push(`No ${storeName(chosenStore)} a casa ainda não comprou este item: cerca de ${perUnit(estimate.unitPrice, unit)}, pelo nível de preço de lá.`);
    }
    if (promotionOnly) facts.push(`Só em promoção: o preço bom é ${perUnit(lowest.unitPrice, unit)} ou menos.`);
    if (estimate.approximateQuantity) facts.push(`O preço é por ${unit}: a conta da lista usa 1 ${unit}.`);
  }
  if (hit) {
    const amount = hit.quantity != null && hit.unit ? `${formatQuantity(hit.quantity, hit.unit)} de ` : '';
    const expiry = hit.expiresOn ? `; vence em ${formatShortDate(hit.expiresOn)}` : '';
    facts.push(`Na despensa: ${amount}${hit.name}, da compra de ${formatShortDate(hit.since)}${expiry}.`);
  }
  return facts;
}
