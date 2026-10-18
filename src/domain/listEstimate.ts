// Lista no mercado: quanto a lista deve dar, o preço de referência de cada
// item e o que já está na despensa. Os preços são o último de cada produto em
// cada mercado (notas confirmadas). Item digitado solto ("Coca") usa as
// ligações nome -> produto aprendidas nas notas, ou o produto de mesmo nome.
// "Onde comprar" (recommendation) faz a mesma conta: pergunta aqui o preço de
// cada item em cada mercado (listStorePrices), com o mesmo nível de preço dos
// mercados (priceLevel) e a mesma conversão de unidades (units).
//
// Onde a casa não tem preço, entra o preço visto em outras casas (`shared`,
// sharedQuotes de domain/sharedPrices), marcado como tal e com o dia em que
// foi visto. O preço da própria casa sempre vence: de qualquer produto ligado
// ao item, em qualquer unidade, antes do de outras casas; e o de outras casas
// vem antes da estimativa pelo nível de preço. Eles não entram no nível de
// preço dos mercados nem no "último preço" e no "preço bom" do item.

import { joinNames } from './cartPantry';
import { diffDays, formatShortDate, toISODate, todayISO } from './dates';
import type { LinkIndex } from './listLinks';
import { formatBRL, formatQuantity } from './money';
import { storePriceIndex } from './priceLevel';
import { SAME_TRIP_DAYS } from './restock';
import { normalizeSearch } from './search';
import { SHARED_PRICES_NOTICE, seenLabel, sharedStoreLabel, type SharedQuote } from './sharedPrices';
import { pricePerBase, priceQuantity, sameDimension } from './units';

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
  /** A unidade do preço que entrou na conta (R$/kg não é R$/un): o preço por g ou por ml entra já por kg ou por litro. */
  unit: string;
  /**
   * `known`: preço de nota, do mercado escolhido ou, sem mercado, o último que
   * a casa pagou (ou, sem preço da casa, o visto em outras casas: `shared`).
   * `estimated`: o mercado escolhido não tem esse item; o preço sai do nível
   * de preço dele (como em "Onde comprar").
   */
  kind: 'known' | 'estimated';
  /** A unidade da lista não converte para a do preço (un x kg): o custo é o de 1 kg, 1 litro ou 1 unidade. */
  approximateQuantity: boolean;
  /** O produto de onde saem o último preço, o "preço bom" e a estimativa do item (itemResolver). */
  productId: string;
  /**
   * O preço de nota da casa que entrou na conta; null quando é estimado ou de
   * outras casas. No mercado escolhido pode ser de outro produto ligado ao
   * mesmo nome (o do item não tem preço lá): aí o custo é aproximado.
   */
  used: EstimatePrice | null;
  /** O preço visto em outras casas que entrou na conta: a casa não tem preço do item ali (ou em lugar nenhum). */
  shared?: SharedQuote;
  /** O último preço que a casa pagou pelo item, em qualquer mercado; null quando ela nunca pagou (o preço é de outras casas). */
  last: EstimatePrice | null;
  /** O menor entre os últimos preços dos mercados, do mesmo produto: o "preço bom". null como `last`. */
  lowest: EstimatePrice | null;
}

export interface ListEstimate {
  byItem: Map<string, ItemEstimate>;
  /** A lista toda (a comprar e no carrinho), só os itens com preço. */
  total: number;
  cartTotal: number;
  pendingTotal: number;
  /** Quantos itens há de cada lado (com ou sem preço) e quantos deles têm preço. */
  cartCount: number;
  pendingCount: number;
  cartPricedCount: number;
  pendingPricedCount: number;
  itemCount: number;
  pricedCount: number;
  estimatedCount: number;
  /** Itens com preço em que a quantidade é aproximada (a unidade da lista não converte para a do preço). */
  approximateCount: number;
  /** Itens cujo preço na conta é o visto em outras casas, e quanto do total vem deles. */
  sharedCount: number;
  sharedTotal: number;
  /**
   * Os mercados em que dá para estimar a lista (os das notas da casa), do que
   * tem preço (de nota da casa ou de outras casas) para mais itens dela para o que tem para menos. Com
   * zero, a conta de lá sai toda estimada pelo nível de preço do mercado.
   * Vazio enquanto nenhum item tem preço.
   */
  stores: { storeId: string; knownCount: number }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
/** As 4 casas do preço por unidade nas notas (R$ 0,0499 por g). */
const round4 = (n: number) => Math.round(n * 10000) / 10000;
/** Só para tirar o ruído da conta em ponto flutuante: arredondar o preço estimado a 4 casas e depois a centavos podia dar um centavo a mais que o custo. */
const round8 = (n: number) => Math.round(n * 1e8) / 1e8;
const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/**
 * O preço mais recente. No empate de data (dois produtos na mesma nota, dois mercados no mesmo dia), sempre o
 * mesmo: o de menor produto, mercado e unidade. Nem a ordem das ligações nem a dos preços decide a conta.
 */
const newest = (quotes: EstimatePrice[]) =>
  quotes.reduce((a, b) => {
    const [mine, theirs] = [Date.parse(b.purchasedAt), Date.parse(a.purchasedAt)];
    if (mine !== theirs) return mine > theirs ? b : a;
    return (byId(b.productId, a.productId) || byId(b.storeId, a.storeId) || byId(b.unit, a.unit)) < 0 ? b : a;
  });

/** O preço que serve à unidade da lista: nela; senão, numa que converte para ela (g e kg); senão, o mais recente. */
function bestForUnit<T extends { unit: string }>(listUnit: string, quotes: T[], latest: (quotes: T[]) => T): T {
  const exact = quotes.filter((quote) => quote.unit === listUnit);
  if (exact.length) return latest(exact);
  const convertible = quotes.filter((quote) => sameDimension(quote.unit, listUnit));
  return latest(convertible.length ? convertible : quotes);
}

/**
 * O preço de outras casas visto por último. No empate de dia, sempre o mesmo: o mais barato, depois o de menor
 * produto, CNPJ, unidade e mercado da casa. A ordem em que o banco devolve as linhas não decide a conta.
 */
const newestShared = (quotes: SharedQuote[]) =>
  quotes.reduce((a, b) => {
    if (a.seenOn !== b.seenOn) return b.seenOn > a.seenOn ? b : a;
    if (a.unitPrice !== b.unitPrice) return b.unitPrice < a.unitPrice ? b : a;
    const order =
      byId(b.productId, a.productId) || byId(b.storeCnpj, a.storeCnpj) || byId(b.unit, a.unit) || byId(b.storeId ?? '', a.storeId ?? '');
    return order < 0 ? b : a;
  });

interface PriceSources {
  links?: LinkIndex;
  products?: readonly { id: string; name: string }[];
  /** Os preços vistos em outras casas (sharedQuotes): só entram onde a casa não tem preço do item. */
  shared?: readonly SharedQuote[];
}

interface ResolvedItem {
  productId: string;
  /** Os preços do produto, em todos os mercados e unidades. */
  own: EstimatePrice[];
  /** Os de todos os produtos que servem ao item (os ligados ao mesmo nome). */
  all: EstimatePrice[];
}

/**
 * Os preços como entram na regra. Por g vira por kg e por ml vira por litro
 * (R$ 0,0499 por g são R$ 49,90 por kg): assim o último preço, o "preço bom" e
 * a média do produto comparam o kg de um mercado com o g de outro, e nenhuma
 * frase mostra "R$ 0,00/g". Preço por un, kg ou litro passa como veio (o mesmo
 * objeto). E cada mercado fica com um preço só por produto e unidade, o mais
 * novo (no empate de data, o menor): com o produto por kg numa nota e por g em
 * outra, a linha antiga não é mais o preço de lá. Preço zerado (brinde na
 * nota) não é preço.
 */
function comparablePrices(prices: readonly EstimatePrice[]): EstimatePrice[] {
  const latest = new Map<string, EstimatePrice>();
  for (const price of prices) {
    if (!(price.unitPrice > 0)) continue;
    const base = pricePerBase(price.unitPrice, price.unit);
    // De volta às 4 casas: 0,0049 x 1000 dá 4,8999999999999995, que apareceria como "menor" que R$ 4,90.
    const quote = base.unit === price.unit ? price : { ...price, unit: base.unit, unitPrice: round4(base.unitPrice) };
    const key = `${quote.productId}\u0000${quote.storeId}\u0000${quote.unit}`;
    const seen = latest.get(key);
    const later = seen ? Date.parse(quote.purchasedAt) - Date.parse(seen.purchasedAt) : 0;
    if (!seen || later > 0 || (later === 0 && quote.unitPrice < seen.unitPrice)) latest.set(key, quote);
  }
  return [...latest.values()];
}

/**
 * De qual produto saem os preços de cada item da lista (o último, o "preço
 * bom" e a estimativa pelo nível de preço): um só. O produto do próprio item;
 * se ele não tem produto, ou o produto não tem preço, os que já cumpriram esse
 * nome nas notas e o de mesmo nome, valendo o comprado mais recentemente. Item
 * sem preço nenhum não tem produto.
 */
function itemResolver(prices: readonly EstimatePrice[], { links, products = [] }: PriceSources) {
  const byProduct = new Map<string, EstimatePrice[]>();
  for (const price of comparablePrices(prices)) byProduct.set(price.productId, [...(byProduct.get(price.productId) ?? []), price]);
  /** Quando o produto foi comprado por último; sem preço, antes de qualquer data. */
  const lastBought = (productId: string) => Math.max(-Infinity, ...(byProduct.get(productId) ?? []).map((quote) => Date.parse(quote.purchasedAt)));
  // Dois produtos podem ter o mesmo nome, a não ser pelo acento ("Açúcar" e "Acucar"). Vale o de preço mais
  // recente; no empate, e sem preço em nenhum, o de menor id: a ordem em que os produtos chegam não decide.
  const productByName = new Map<string, string>();
  for (const product of products) {
    const name = normalizeSearch(product.name);
    const current = productByName.get(name);
    if (current === undefined) productByName.set(name, product.id);
    else if (current !== product.id) {
      const [mine, theirs] = [lastBought(product.id), lastBought(current)];
      if (mine > theirs || (mine === theirs && product.id < current)) productByName.set(name, product.id);
    }
  }

  /** Os produtos que podem cumprir o item quando o dele não tem preço: os que já cumpriram esse nome nas notas e o de mesmo nome. */
  const candidates = (item: Pick<EstimateItem, 'name'>): string[] => {
    const sameName = productByName.get(normalizeSearch(item.name));
    return [...new Set([...(links?.productsFor(item.name) ?? []), ...(sameName ? [sameName] : [])])];
  };

  const resolve = (item: Pick<EstimateItem, 'name' | 'productId' | 'unit'>): ResolvedItem | null => {
    // O produto do item; sem ele (ou se ele não tem preço), os que já cumpriram esse nome nas notas e o de mesmo nome.
    let all = item.productId ? (byProduct.get(item.productId) ?? []) : [];
    if (!all.length) all = candidates(item).flatMap((productId) => byProduct.get(productId) ?? []);
    if (!all.length) return null;
    // Entre vários produtos, vale o comprado mais recentemente, em qualquer unidade: a unidade é escolhida
    // depois, só entre os preços desse produto (um produto antigo na unidade da lista não passa na frente).
    const { productId } = newest(all);
    return { productId, own: all.filter((quote) => quote.productId === productId), all };
  };
  return { resolve, candidates };
}

/** De onde vem o preço de um item da lista num mercado. */
export type StorePriceSource =
  /** Do produto do item, na unidade de sempre. */
  | 'product'
  /** Do produto do item, em outra unidade (a quantidade pode sair aproximada). */
  | 'otherUnit'
  /** De outro produto ligado ao mesmo nome: o custo é aproximado. */
  | 'otherProduct'
  /** A casa não tem o item nas notas de lá: é o preço visto em outras casas (`shared`). */
  | 'shared'
  /** O mercado não tem o item nas notas: sai do nível de preço dele. */
  | 'estimated';

/** O preço de um item da lista num mercado, e de onde ele vem (listStorePrices). */
export interface StorePrice
  extends Pick<ItemEstimate, 'cost' | 'unitPrice' | 'unit' | 'kind' | 'approximateQuantity' | 'productId' | 'used' | 'shared'> {
  source: StorePriceSource;
}

/** Um item com preço: o último, o "preço bom" e o preço dele em cada mercado. */
interface PricedItem {
  /** null quando a casa nunca pagou pelo item: o preço dele é só o de outras casas. */
  last: EstimatePrice | null;
  lowest: EstimatePrice | null;
  /** Os mercados da casa com preço para o item: de nota da casa ou visto em outras casas. */
  stores: Set<string>;
  /** Sem mercado escolhido: o último preço que a casa pagou (sem nenhum, o visto em outras casas). */
  lastPaid: () => StorePrice;
  /** null: o item só tem preço de outras casas, e nenhum desse mercado. */
  at: (storeId: string) => StorePrice | null;
  /** Os preços de outras casas em mercados que não são da casa, um por mercado (CNPJ). */
  elsewhere: () => StorePrice[];
}

/**
 * A regra de preço da lista, uma só para a estimativa e para "Onde comprar":
 * o produto de cada item (itemResolver) e, em cada mercado, o preço que vale
 * lá. null para item sem preço nenhum, nem da casa nem de outras casas.
 */
function itemPricer(prices: readonly EstimatePrice[], sources: PriceSources, index = storePriceIndex(prices)) {
  const { resolve, candidates } = itemResolver(prices, sources);
  const sharedByProduct = new Map<string, SharedQuote[]>();
  for (const quote of sources.shared ?? []) {
    if (quote.unitPrice > 0) sharedByProduct.set(quote.productId, [...(sharedByProduct.get(quote.productId) ?? []), quote]);
  }
  /**
   * Os preços de outras casas que servem ao item. Com preço da casa, só os do mesmo produto de onde ele sai (um
   * produto só por item). Sem nenhum, como na casa: o produto do item; sem ele (ou sem preço de outras casas),
   * os ligados ao nome e o de mesmo nome, valendo o visto por último.
   */
  const sharedOf = (item: Pick<EstimateItem, 'name' | 'productId'>, resolved: ResolvedItem | null): SharedQuote[] => {
    if (resolved) return sharedByProduct.get(resolved.productId) ?? [];
    let all = item.productId ? (sharedByProduct.get(item.productId) ?? []) : [];
    if (!all.length) all = candidates(item).flatMap((productId) => sharedByProduct.get(productId) ?? []);
    if (!all.length) return [];
    const { productId } = newestShared(all);
    return all.filter((quote) => quote.productId === productId);
  };

  return (item: Pick<EstimateItem, 'name' | 'productId' | 'quantity' | 'unit'>): PricedItem | null => {
    const resolved = resolve(item);
    const shared = sharedOf(item, resolved);
    if (!resolved && !shared.length) return null;
    const own = resolved?.own ?? [];
    const all = resolved?.all ?? [];
    const productId = resolved?.productId ?? shared[0].productId;
    // Na unidade da lista quando há preço nela; senão, numa que converte para ela; senão, na do preço mais recente.
    const { unit } = own.length ? bestForUnit(item.unit, own, newest) : bestForUnit(item.unit, shared, newestShared);
    const quotes = own.filter((quote) => quote.unit === unit);
    const last = quotes.length ? newest(quotes) : null;
    // O "preço bom" é do mesmo produto (outro produto do mesmo nome pode ser outra embalagem); no empate, o próprio último.
    const lowest = last && quotes.reduce((a, b) => (b.unitPrice < a.unitPrice ? b : a), last);

    const priced = (source: StorePriceSource, used: EstimatePrice | null, unitPrice: number, seen?: SharedQuote): StorePrice => {
      const priceUnit = seen?.unit ?? used?.unit ?? unit;
      const { quantity, approximate } = priceQuantity(item.quantity, item.unit, priceUnit);
      return {
        source,
        cost: round2(unitPrice * quantity),
        // Com as casas da nota, não em centavos: é o preço por unidade que os detalhes do item mostram.
        unitPrice: round8(unitPrice),
        unit: priceUnit,
        kind: used || seen ? 'known' : 'estimated',
        approximateQuantity: approximate,
        productId,
        used,
        ...(seen ? { shared: seen } : {}),
      };
    };
    const fromShared = (list: SharedQuote[]) => {
      const seen = bestForUnit(item.unit, list, newestShared);
      return priced('shared', null, seen.unitPrice, seen);
    };
    // O preço de lá: do produto, na unidade de sempre; do produto, em outra unidade; ou de outro produto ligado ao mesmo nome.
    const tiers: [StorePriceSource, EstimatePrice[]][] = [
      ['product', quotes],
      ['otherUnit', own],
      ['otherProduct', all],
    ];
    return {
      last,
      lowest,
      stores: new Set([...all.map((quote) => quote.storeId), ...shared.flatMap((quote) => (quote.storeId ? [quote.storeId] : []))]),
      lastPaid: () => {
        if (last) return priced('product', last, last.unitPrice);
        // Sem preço da casa: o visto por último, de preferência num mercado dela (é onde ela compra).
        const home = shared.filter((quote) => quote.storeId != null);
        return fromShared(home.length ? home : shared);
      },
      at: (storeId) => {
        for (const [source, list] of tiers) {
          const here = list.filter((quote) => quote.storeId === storeId);
          if (!here.length) continue;
          const used = bestForUnit(item.unit, here, newest);
          return priced(source, used, used.unitPrice);
        }
        // A casa não tem o item nas notas de lá: o preço visto em outras casas nesse mercado (pelo CNPJ).
        const seenHere = shared.filter((quote) => quote.storeId === storeId);
        if (seenHere.length) return fromShared(seenHere);
        // Sem preço da casa em lugar nenhum, não há média para estimar: o item fica sem preço aqui.
        if (!quotes.length) return null;
        // O mercado não tem esse item nas notas: a média do produto nos outros, no nível de preço deste. Os preços
        // conhecidos entram como estão, sem dividir pelo nível do mercado de cada um: um nível ainda incerto pesaria
        // duas vezes na conta. Os de outras casas não entram na média: a estimativa é pela casa.
        return priced('estimated', null, average(quotes.map((quote) => quote.unitPrice)) * (index.get(storeId) ?? 1));
      },
      elsewhere: () => {
        const byStore = new Map<string, SharedQuote[]>();
        for (const quote of shared) {
          if (quote.storeId == null) byStore.set(quote.storeCnpj, [...(byStore.get(quote.storeCnpj) ?? []), quote]);
        }
        return [...byStore.values()].map(fromShared);
      },
    };
  };
}

/**
 * O preço de cada item da lista em cada mercado, e de onde ele vem: do
 * produto do item, na unidade de sempre; dele, em outra unidade; de outro
 * produto ligado ao mesmo nome; o visto em outras casas nesse mercado; ou
 * estimado pelo nível de preço do mercado. null para item sem preço ali (fica
 * fora da conta). É a resposta que a estimativa usa com o mercado escolhido e
 * a que "Onde comprar" recebe (recommendStores, `priceAt`): por isso as duas
 * telas dão o mesmo total.
 */
export function listStorePrices(
  items: readonly Pick<EstimateItem, 'id' | 'name' | 'productId' | 'quantity' | 'unit'>[],
  prices: readonly EstimatePrice[],
  sources: PriceSources = {},
): (itemId: string, storeId: string) => StorePrice | null {
  const price = itemPricer(prices, sources);
  const byItem = new Map(items.map((item) => [item.id, price(item)]));
  return (itemId, storeId) => byItem.get(itemId)?.at(storeId) ?? null;
}

/**
 * Os itens da lista sem preço nenhum da casa, só com o visto em outras casas,
 * e o preço deles: o mesmo que a lista mostra sem mercado escolhido (o visto
 * por último, de preferência num mercado da casa). No "Onde comprar" eles
 * ficam fora dos planos (não têm resposta em todo mercado, e não há média da
 * casa para estimar) e aparecem à parte.
 */
export function listSharedOnly(
  items: readonly Pick<EstimateItem, 'id' | 'name' | 'productId' | 'quantity' | 'unit'>[],
  prices: readonly EstimatePrice[],
  sources: PriceSources = {},
): Map<string, StorePrice> {
  const price = itemPricer(prices, sources);
  const byItem = new Map<string, StorePrice>();
  for (const item of items) {
    const priced = price(item);
    if (priced && !priced.last) byItem.set(item.id, priced.lastPaid());
  }
  return byItem;
}

/**
 * Os preços de outras casas para os itens da lista em mercados que não são da
 * casa ("Em outros mercados", no "Onde comprar"): por item, um por mercado,
 * do mesmo produto de onde sai o preço do item na lista. Só os itens que têm.
 */
export function listSharedElsewhere(
  items: readonly Pick<EstimateItem, 'id' | 'name' | 'productId' | 'quantity' | 'unit'>[],
  prices: readonly EstimatePrice[],
  sources: PriceSources = {},
): Map<string, StorePrice[]> {
  const price = itemPricer(prices, sources);
  const byItem = new Map<string, StorePrice[]>();
  for (const item of items) {
    const elsewhere = price(item)?.elsewhere() ?? [];
    if (elsewhere.length) byItem.set(item.id, elsewhere);
  }
  return byItem;
}

/**
 * A estimativa da lista. Com `storeId` ("estou no Assaí"), vale o preço desse
 * mercado; o que a casa não tem de lá é o visto em outras casas nesse mercado
 * ou, sem ele, estimado pelo nível de preço dele. Sem mercado, vale o último
 * preço que a casa pagou em cada item (sem nenhum, o visto em outras casas).
 * Item sem preço nenhum fica fora dos totais.
 */
export function estimateList(
  items: readonly EstimateItem[],
  prices: readonly EstimatePrice[],
  { links, products, shared, storeId = null }: PriceSources & { storeId?: string | null } = {},
): ListEstimate {
  const index = storePriceIndex(prices);
  const price = itemPricer(prices, { links, products, shared }, index);

  const byItem = new Map<string, ItemEstimate>();
  // Todo mercado com nível de preço pode ser escolhido, mesmo sem preço de nota para esta lista. Só esses: o
  // mercado da casa em que só outras casas viram preço (sem nota dela) não entra na escolha.
  const known = new Map<string, number>([...index.keys()].map((store) => [store, 0]));
  for (const item of items) {
    const priced = price(item);
    if (!priced) continue;
    for (const store of priced.stores) if (known.has(store)) known.set(store, known.get(store)! + 1);
    const answer = storeId ? priced.at(storeId) : priced.lastPaid();
    if (!answer) continue;
    const { cost, unitPrice, unit, kind, approximateQuantity, productId, used, shared: seen } = answer;
    byItem.set(item.id, {
      cost,
      unitPrice,
      unit,
      kind,
      approximateQuantity,
      productId,
      used,
      ...(seen ? { shared: seen } : {}),
      last: priced.last,
      lowest: priced.lowest,
    });
  }

  const sum = (inCart: boolean) => round2(items.reduce((s, item) => s + (item.inCart === inCart ? (byItem.get(item.id)?.cost ?? 0) : 0), 0));
  const cartTotal = sum(true);
  const pendingTotal = sum(false);
  const estimates = [...byItem.values()];
  const count = (inCart: boolean, pricedOnly: boolean) =>
    items.filter((item) => item.inCart === inCart && (!pricedOnly || byItem.has(item.id))).length;
  return {
    byItem,
    total: round2(cartTotal + pendingTotal),
    cartTotal,
    pendingTotal,
    cartCount: count(true, false),
    pendingCount: count(false, false),
    cartPricedCount: count(true, true),
    pendingPricedCount: count(false, true),
    itemCount: items.length,
    pricedCount: byItem.size,
    estimatedCount: estimates.filter((estimate) => estimate.kind === 'estimated').length,
    approximateCount: estimates.filter((estimate) => estimate.approximateQuantity).length,
    sharedCount: estimates.filter((estimate) => estimate.shared).length,
    sharedTotal: round2(estimates.reduce((s, estimate) => s + (estimate.shared ? estimate.cost : 0), 0)),
    stores: byItem.size
      ? [...known]
          .map(([id, knownCount]) => ({ storeId: id, knownCount }))
          .sort((a, b) => b.knownCount - a.knownCount || a.storeId.localeCompare(b.storeId))
      : [],
  };
}

/** A linha de cada mercado na escolha de "Onde você está comprando?". */
export function storeOptionNote(knownCount: number): string {
  if (!knownCount) return 'Nenhum item da lista com preço lá: a conta sai estimada';
  return `${knownCount} ${knownCount === 1 ? 'item da lista com preço' : 'itens da lista com preço'}`;
}

/**
 * A linha "No carrinho / Falta comprar", quando a lista tem itens dos dois
 * lados. O lado em que nenhum item tem preço diz isso, em vez de sumir ou de
 * mostrar R$ 0,00: o total de cima seria só do outro lado, sem ninguém saber.
 */
export function cartSplitLine(
  estimate: Pick<ListEstimate, 'cartTotal' | 'pendingTotal' | 'cartCount' | 'pendingCount' | 'cartPricedCount' | 'pendingPricedCount'>,
): string | null {
  if (!estimate.cartCount || !estimate.pendingCount) return null;
  const cart = estimate.cartPricedCount ? `No carrinho: ~${formatBRL(estimate.cartTotal)}.` : null;
  const pending = estimate.pendingPricedCount ? `Falta comprar: ~${formatBRL(estimate.pendingTotal)}.` : null;
  if (cart && pending) return `${cart} ${pending}`;
  if (cart) return `${cart} O que falta comprar ainda não tem preço.`;
  if (pending) return `${pending} O que está no carrinho ainda não tem preço.`;
  return null;
}

/** O mercado em que a pessoa disse estar, e quando disse. */
export interface StoreChoice {
  storeId: string;
  at: number;
}

/** A escolha do mercado vale por uma ida ao mercado: 6 horas. */
export const CHOSEN_STORE_MS = 6 * 60 * 60 * 1000;

/** O mercado escolhido que ainda vale; null depois de 6 horas (a próxima compra pode ser em outro lugar). */
export function currentStoreChoice(choice: StoreChoice | null | undefined, now: number = Date.now()): string | null {
  return choice && now - choice.at < CHOSEN_STORE_MS ? choice.storeId : null;
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
  /** O nome como está na despensa; o do item da lista quando as entradas são de produtos diferentes. */
  name: string;
  /** A soma do que há; null quando as entradas são de produtos ou unidades diferentes. */
  quantity: number | null;
  unit: string | null;
  /** A compra mais recente. */
  since: string;
  /** A validade que vence primeiro, se houver. */
  expiresOn: string | null;
}

/**
 * Itens da lista que estão na despensa, dentro da validade: o mesmo produto,
 * um produto que as notas já ligaram a esse nome, ou o mesmo nome. Nome só
 * parecido não conta ("Leite" não é "Leite condensado"). A despensa só perde
 * uma entrada quando alguém dá baixa, então o que o próprio app acha que
 * acabou (`ranOut`, de ranOutItems: sem tirar o que já está na lista e por
 * mais que tenha passado do costume) fica de fora: está na lista justamente
 * porque acabou. Só a entrada mais nova que a última compra que esse palpite
 * conhece (`lastAt`) continua valendo: é compra que ele não viu, estoque novo.
 * O palpite vale também pelos produtos que as notas já ligaram ao nome do
 * item, tenha ele produto ou não: se o Italac acabou, a entrada "Leite" posta
 * à mão antes disso não traz o selo de volta. E no sentido contrário: o
 * palpite sem produto ("Leite" marcado na lista de 10 em 10 dias) vale para o
 * produto que as notas ligaram a esse nome, quando é um só, e assim para o
 * item da lista que já tem esse produto; com dois produtos ligados, não dá
 * para saber qual acabou, e a entrada de cada um responde por ela mesma.
 * Mais nova de verdade (não a mesma ida ao mercado, lida um ou dois dias
 * depois) e só enquanto ela mesma não passar do intervalo de costume
 * (`everyDays`): depois disso, também acabou.
 */
export function pantryHits(
  items: readonly Pick<EstimateItem, 'id' | 'name' | 'productId'>[],
  pantry: readonly PantryStock[],
  {
    links,
    today,
    ranOut = [],
  }: {
    links?: LinkIndex;
    today: string;
    ranOut?: readonly { name: string; productId: string | null; lastAt: string; everyDays: number }[];
  },
): Map<string, PantryHit> {
  // O que acabou, pelo nome e pelo produto: o dia da última compra conhecida e o intervalo de costume.
  interface Gone {
    day: string;
    everyDays: number;
    /** O palpite é do nome ("Leite"), emprestado ao produto ligado a ele: ver stillThere. */
    lent?: boolean;
  }
  // Pelo nome, o palpite que não sabe de qual produto é ("Leite" marcado na lista) fica separado do que sabe:
  // este só vale, pelo nome, para o que também não diz o produto (ver goneOf).
  const goneNames = new Map<string, Gone>();
  const goneProductNames = new Map<string, Gone>();
  const goneProducts = new Map<string, Gone>();
  /**
   * Entre dois palpites, o da compra mais recente. No empate de dia, sempre o mesmo: o do próprio produto antes
   * do emprestado pelo nome, depois o de costume mais curto. A ordem em que os palpites e as ligações chegam não decide.
   */
  const later = (a: Gone | null, b: Gone | null): Gone | null => {
    if (!a || !b) return a ?? b;
    if (a.day !== b.day) return a.day > b.day ? a : b;
    if (Boolean(a.lent) !== Boolean(b.lent)) return a.lent ? b : a;
    return b.everyDays < a.everyDays ? b : a;
  };
  const keep = <K>(map: Map<K, Gone>, key: K, gone: Gone) => map.set(key, later(map.get(key) ?? null, gone) ?? gone);
  for (const gone of ranOut) {
    const latest = { day: toISODate(new Date(gone.lastAt)), everyDays: gone.everyDays };
    const name = normalizeSearch(gone.name);
    keep(gone.productId ? goneProductNames : goneNames, name, latest);
    // O palpite sem produto ("Leite" marcado na lista) é do produto que as notas ligaram a esse nome, quando é um
    // só: vale para as entradas dele e para o item que já o tem. Com dois ligados, não dá para saber qual acabou.
    const linked = gone.productId ? [] : [...new Set(links?.productsFor(gone.name))];
    const productId = gone.productId ?? (linked.length === 1 ? linked[0] : null);
    if (productId) keep(goneProducts, productId, gone.productId ? latest : { ...latest, lent: true });
  }
  /**
   * O palpite de que acabou que vale para uma entrada da despensa; null quando o app não acha que acabou. Com
   * produto, só o do produto: o dele mesmo, ou o do nome que as notas ligaram só a ele (goneProducts). O nome
   * igual não basta: "Leite" marcado na lista não diz se foi o Italac ou o Ninho, mesmo que os dois se chamem
   * "Leite" na despensa. Sem produto (a entrada posta à mão), o nome é tudo o que se sabe: vale o palpite do
   * nome e o de um produto com esse nome.
   */
  const goneOf = (key: string, productId: string | null): Gone | null =>
    productId != null ? (goneProducts.get(productId) ?? null) : later(goneNames.get(key) ?? null, goneProductNames.get(key) ?? null);
  /**
   * A entrada é estoque que o palpite não viu: comprada depois (fora a mesma ida ao mercado) e ainda dentro do
   * costume. No palpite emprestado do nome basta ser de depois: o costume é o do nome ("Leite" marcado a cada 10
   * dias), e quem diz se o produto comprado depois já acabou é o histórico dele mesmo (o palpite próprio dele,
   * de compra mais recente, passa na frente deste).
   */
  const stillThere = (purchasedOn: string, gone: Gone | null) =>
    !gone || (diffDays(gone.day, purchasedOn) > SAME_TRIP_DAYS && (gone.lent === true || diffDays(purchasedOn, today) < gone.everyDays));
  // O nome de cada entrada normalizado uma vez, fora do laço dos itens.
  const fresh = pantry
    .filter((entry) => !entry.expires_on || entry.expires_on >= today)
    .map((entry) => ({ entry, key: normalizeSearch(entry.name) }))
    .filter(({ entry, key }) => stillThere(entry.purchased_on, goneOf(key, entry.product_id)));

  const hits = new Map<string, PantryHit>();
  for (const item of items) {
    const name = normalizeSearch(item.name);
    // O item da lista acabou: só conta a entrada comprada depois disso (e ainda dentro do costume). O item com
    // produto, pelo palpite do produto; o digitado, pelo do nome ("Leite" marcado na lista). O palpite de um
    // produto que só tem o mesmo nome não é do item: vale para a entrada desse produto e para a posta à mão.
    const itemGone = (item.productId != null ? goneProducts.get(item.productId) : goneNames.get(name)) ?? null;
    // O que acabou pode estar com o nome da nota, sob um produto ligado a este nome (tenha o item produto ou
    // não). A entrada sem produto (posta à mão) não diz qual é: vale o palpite mais recente entre os ligados.
    const linkedGone = (links?.productsFor(item.name) ?? []).reduce<Gone | null>(
      (latest, productId) => later(latest, goneProducts.get(productId) ?? null),
      null,
    );
    const same = fresh.filter(({ entry, key }) => {
      // O palpite do item vale para a entrada do mesmo produto e para a que não diz o produto. O item digitado
      // (sem produto) é o nome: se "Leite" acabou, acabou o que foi comprado antes, de qualquer produto que o
      // cumpra. Já a entrada de OUTRO produto, ligado ao nome de um item que tem o seu, responde só por ela
      // (passou pelo palpite dela em `fresh`): o Ninho não some porque o Italac acabou.
      const ofAnother = item.productId != null && entry.product_id != null && entry.product_id !== item.productId;
      if (!ofAnother && !stillThere(entry.purchased_on, itemGone)) return false;
      if (!entry.product_id && !stillThere(entry.purchased_on, linkedGone)) return false;
      if (item.productId && entry.product_id === item.productId) return true;
      // Outro produto só conta quando a pessoa já confirmou, numa nota, que ele cumpre este nome.
      if (entry.product_id && links?.has(item.name, entry.product_id)) return true;
      if (item.productId && entry.product_id) return false;
      if (item.productId && links?.has(entry.name, item.productId)) return true;
      return Boolean(name) && key === name;
    });
    if (!same.length) continue;
    const first = same[0];
    // Italac e Ninho não se somam, nem com o mesmo nome na despensa (os dois renomeados para "Leite"): só há
    // número quando tudo é o mesmo produto, ou o mesmo nome sem dois produtos diferentes entre as entradas.
    const products = new Set(same.flatMap(({ entry }) => (entry.product_id ? [entry.product_id] : [])));
    const oneThing =
      products.size <= 1 && (same.every(({ entry }) => entry.product_id != null) || same.every(({ key }) => key === first.key));
    const countable = oneThing && same.every(({ entry }) => entry.unit === first.entry.unit);
    const expiries = same.flatMap(({ entry }) => (entry.expires_on ? [entry.expires_on] : [])).sort();
    hits.set(item.id, {
      name: oneThing ? first.entry.name : item.name,
      quantity: countable ? Math.round(same.reduce((s, { entry }) => s + Number(entry.quantity), 0) * 1000) / 1000 : null,
      unit: countable ? first.entry.unit : null,
      since: same.map(({ entry }) => entry.purchased_on).sort().at(-1)!,
      expiresOn: expiries[0] ?? null,
    });
  }
  return hits;
}

/** "R$ 4,90/kg". O preço por g ou por ml aparece por kg ou por litro: em centavos, R$ 0,0049 por g seria "R$ 0,00/g". */
const perUnit = (unitPrice: number, unit: string) => {
  const base = pricePerBase(unitPrice, unit);
  return `${formatBRL(base.unitPrice)}/${base.unit}`;
};

const sameQuote = (a: EstimatePrice, b: EstimatePrice) =>
  a.productId === b.productId && a.storeId === b.storeId && a.unit === b.unit && a.unitPrice === b.unitPrice && a.purchasedAt === b.purchasedAt;

/**
 * Como o custo do item aparece na lista: "~" quando é estimado, a quantidade é aproximada, o preço é de outro
 * produto do mesmo nome ou é o visto em outras casas (não é em tempo real).
 */
export function formatItemCost(estimate: Pick<ItemEstimate, 'cost' | 'kind' | 'approximateQuantity' | 'productId' | 'used' | 'shared'>): string {
  const otherProduct = estimate.used != null && estimate.used.productId !== estimate.productId;
  const rough = estimate.kind === 'estimated' || estimate.approximateQuantity || otherProduct || estimate.shared != null;
  return `${rough ? '~' : ''}${formatBRL(estimate.cost)}`;
}

/**
 * A nota da linha de um item em "Onde comprar", da mesma resposta que dá o
 * custo (listStorePrices): estimado, de outras casas (com o dia em que foi
 * visto), de outro produto ligado ao nome (qual, quando `productName` sabe) ou
 * com a quantidade em outra unidade. null para o preço de nota do próprio
 * produto, na quantidade da lista: nada a avisar.
 */
export function storePriceNote(
  price: Pick<StorePrice, 'source' | 'approximateQuantity' | 'used' | 'shared'>,
  productName?: (productId: string) => string | undefined,
  referenceYear?: number,
): string | null {
  if (price.source === 'estimated') return 'Estimado pelo nível de preço do mercado';
  if (price.shared) {
    const note = `Preço de outras casas, ${seenLabel(price.shared, referenceYear)}`;
    return price.approximateQuantity ? `${note} (quantidade em outra unidade)` : note;
  }
  if (price.source === 'otherProduct') {
    return `Preço de ${(price.used && productName?.(price.used.productId)) || 'outro produto com esse nome'}`;
  }
  return price.approximateQuantity ? 'Preço por unidade da nota (quantidade em outra unidade)' : null;
}

/**
 * A linha do item que só tem preço de outras casas, em "Onde comprar": de
 * que mercado (o nome que a casa conhece, quando é dela) e de que dia.
 */
export function sharedOnlyNote(
  price: Pick<StorePrice, 'shared'>,
  storeName: (storeId: string) => string | undefined = () => undefined,
  referenceYear?: number,
): string {
  const seen = price.shared;
  if (!seen) return 'Só há preço de outras casas';
  const place = (seen.storeId ? storeName(seen.storeId) : undefined) ?? sharedStoreLabel(seen);
  return `Só há preço de outras casas: ${place}, ${seenLabel(seen, referenceYear)}`;
}

/**
 * Por que um item ficou sem preço em "Onde comprar". Com `sourcesLoaded`
 * falso, as ligações ou os produtos não chegaram (a busca falhou, ou sem
 * internet e nunca vistos neste aparelho): o item pode ter preço nas notas, e
 * dizer "ainda não ligado" seria palpite.
 */
export function unpricedNote(item: Pick<EstimateItem, 'productId'>, sourcesLoaded: boolean): string {
  if (!sourcesLoaded) return 'Não deu para conferir se este item já tem preço';
  return item.productId ? 'Ainda não aparece em nenhuma nota' : 'Item digitado livre: ainda não ligado a um produto com preço';
}

/**
 * A linha a mais do cartão da lista quando as ligações ou os produtos não
 * chegaram (a busca falhou, ou sem internet e nunca vistos neste aparelho): o
 * que ficou "fora da conta" pode ser só item que não deu para conferir. null
 * quando chegaram ou quando todo item tem preço. Sem item nenhum com preço
 * não há conta, e a linha (sozinha no cartão) fala da lista toda.
 */
export function uncheckedPricesNote(estimate: Pick<ListEstimate, 'itemCount' | 'pricedCount'>, sourcesLoaded: boolean): string | null {
  const missing = estimate.itemCount - estimate.pricedCount;
  if (sourcesLoaded || !missing) return null;
  if (!estimate.pricedCount) return `Não deu para conferir se ${missing === 1 ? 'o item da lista já tem' : 'os itens da lista já têm'} preço.`;
  return `Não deu para conferir se ${missing === 1 ? 'o outro item já tem' : `os outros ${missing} itens já têm`} preço.`;
}

/** O título do total: "A lista deve dar" só quando todos os itens têm preço; senão, diz que a conta é de parte deles. */
export function estimateHeadline(estimate: Pick<ListEstimate, 'itemCount' | 'pricedCount'>): string {
  if (estimate.pricedCount === estimate.itemCount) return 'A lista deve dar';
  return estimate.pricedCount === 1 ? 'O item com preço deve dar' : `Os ${estimate.pricedCount} itens com preço devem dar`;
}

/**
 * De onde sai a estimativa da lista e o que ficou de fora dela. O nome do
 * lugar vem sem artigo antes ("do Farmácia São João" não existe).
 */
export function describeEstimate(
  estimate: Pick<ListEstimate, 'itemCount' | 'pricedCount' | 'estimatedCount' | 'approximateCount'> &
    Partial<Pick<ListEstimate, 'sharedCount' | 'sharedTotal'>>,
  storeName: string | null,
): string {
  const { itemCount, pricedCount, estimatedCount, approximateCount, sharedCount = 0, sharedTotal = 0 } = estimate;
  const missing = itemCount - pricedCount;
  const clauses = [
    missing === 0 ? 'todos os itens têm preço' : `${pricedCount} de ${itemCount} itens ${pricedCount === 1 ? 'tem' : 'têm'} preço`,
    ...(storeName && estimatedCount
      ? [`${estimatedCount} ${estimatedCount === 1 ? 'é estimado' : 'são estimados'} pelo nível de preço de lá`]
      : []),
    // Quanto do total não é preço da casa: o visto em outras casas, onde ela não tem preço.
    ...(sharedCount
      ? [`${formatBRL(sharedTotal)} do total ${sharedCount === 1 ? 'é de 1 item' : `são de ${sharedCount} itens`} com preço de outras casas`]
      : []),
    ...(approximateCount ? [`em ${approximateCount} a quantidade é aproximada (o preço é por kg ou por unidade)`] : []),
  ].join('; ');
  const left = missing === 0 ? '' : missing === 1 ? ' O outro fica fora da conta.' : ` Os outros ${missing} ficam fora da conta.`;
  if (!storeName) return `Pelo último preço que a casa pagou em cada item; ${clauses}.${left}`;
  return `Lugar escolhido: ${storeName}. ${clauses[0].toUpperCase()}${clauses.slice(1)}.${left}`;
}

/** Quantos nomes cabem na frase da despensa antes de "e mais N". */
const PANTRY_NAMES = 3;

/**
 * A frase do cartão sobre o que está na despensa: o que o app sabe, não um
 * fato sobre a casa (a entrada pode só não ter tido baixa). Nomes sem repetir
 * (sem ligar para maiúscula ou acento), os três primeiros e quantos mais.
 */
export function describePantryHits(names: readonly string[]): string {
  const unique = new Map<string, string>();
  for (const name of names) {
    const key = normalizeSearch(name);
    if (key && !unique.has(key)) unique.set(key, name.trim());
  }
  const all = [...unique.values()];
  const shown = all.length > PANTRY_NAMES ? [...all.slice(0, PANTRY_NAMES), `mais ${all.length - PANTRY_NAMES}`] : all;
  return `Na despensa: ${joinNames(shown)}. Se já acabou, dê baixa lá.`;
}

/**
 * O que a casa sabe do item, para os detalhes dele na lista: o último preço,
 * o menor entre os mercados (o "preço bom"), o preço que entrou na conta no
 * mercado escolhido e o que está na despensa. `today` é a data de hoje (as
 * datas de outro ano levam o ano); `storeName` devolve undefined para um
 * mercado sem nome carregado, e aí a frase fica só com a data.
 */
export function itemFacts(
  estimate: ItemEstimate | undefined,
  hit: PantryHit | undefined,
  {
    storeName,
    chosenStore,
    promotionOnly = false,
    today = todayISO(),
    productName,
  }: {
    storeName: (storeId: string) => string | undefined;
    chosenStore?: string | null;
    promotionOnly?: boolean;
    today?: string;
    productName?: (productId: string) => string | undefined;
  },
): string[] {
  const day = (iso: string) => formatShortDate(iso, Number(today.slice(0, 4)));
  const where = (quote: EstimatePrice) =>
    `(${[storeName(quote.storeId), day(toISODate(new Date(quote.purchasedAt)))].filter(Boolean).join(', ')})`;
  const facts: string[] = [];
  if (estimate) {
    const { last, lowest, used, unit, shared } = estimate;
    // Com um mercado só, o menor é o próprio último preço: não é referência de promoção.
    const cheaper = last != null && lowest != null && lowest.unitPrice < last.unitPrice;
    if (last) facts.push(`Último preço: ${perUnit(last.unitPrice, last.unit)} ${where(last)}.`);
    if (cheaper) facts.push(`Menor preço: ${perUnit(lowest.unitPrice, lowest.unit)} ${where(lowest)}.`);
    if (shared) {
      // A casa não tem preço do item ali (ou em lugar nenhum): o de outras casas, com o mercado, o dia e o aviso.
      const place = (shared.storeId ? storeName(shared.storeId) : undefined) ?? sharedStoreLabel(shared);
      facts.push(`Preço de outras casas na conta: ${perUnit(shared.unitPrice, shared.unit)} (${place}, visto em ${day(shared.seenOn)}).`);
      facts.push(SHARED_PRICES_NOTICE);
    } else if (!used) {
      const place = chosenStore ? storeName(chosenStore) : undefined;
      facts.push(
        `${place ? `${place}: a` : 'A'} casa ainda não comprou este item lá; cerca de ${perUnit(estimate.unitPrice, unit)}, pelo nível de preço de lá.`,
      );
    } else if (!last || !sameQuote(used, last)) {
      // No mercado escolhido, o preço da conta não é o último pago: diz qual foi, de onde e de quando.
      const other = used.productId === estimate.productId ? '' : `, de ${productName?.(used.productId) ?? 'outro produto com esse nome'}`;
      facts.push(`Preço usado na conta: ${perUnit(used.unitPrice, used.unit)}${other} ${where(used)}.`);
    }
    if (promotionOnly && cheaper) facts.push(`Só em promoção: o preço bom é ${perUnit(lowest.unitPrice, lowest.unit)} ou menos.`);
    if (estimate.approximateQuantity) {
      // A conta é de 1 kg, 1 litro ou 1 unidade (units, priceQuantity): com o preço por g, de 1 kg, como o preço aparece.
      const counted = pricePerBase(1, unit).unit;
      facts.push(`O preço é por ${counted}: a conta da lista usa 1 ${counted}.`);
    }
  }
  if (hit) {
    const amount = hit.quantity != null && hit.unit ? `${formatQuantity(hit.quantity, hit.unit)} de ` : '';
    const expiry = hit.expiresOn ? `; vence em ${day(hit.expiresOn)}` : '';
    facts.push(`Na despensa desde ${day(hit.since)}: ${amount}${hit.name}${expiry}.`);
  }
  return facts;
}
