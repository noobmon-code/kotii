// Lista no mercado: quanto a lista deve dar, o preço de referência de cada
// item e o que já está na despensa. Os preços são o último de cada produto em
// cada mercado (notas confirmadas). Item digitado solto ("Coca") usa as
// ligações nome -> produto aprendidas nas notas, ou o produto de mesmo nome.
// "Onde comprar" (recommendation) faz a mesma conta: pergunta aqui o preço de
// cada item em cada mercado (listStorePrices), com o mesmo nível de preço dos
// mercados (priceLevel) e a mesma conversão de unidades (units).
//
// Onde a casa não tem preço, entra o preço visto em outras casas (`shared`,
// sharedQuotes de domain/sharedPrices), marcado como tal e com a semana em que
// foi visto. O preço da casa de um produto sempre vence o de outras casas do
// mesmo produto: de qualquer produto ligado ao item, em qualquer unidade, antes
// do de outras casas; e o de outras casas vem antes da estimativa pelo nível de
// preço. Eles não entram no nível de preço dos mercados nem no "último preço" e
// no "preço bom" do item.
// O item digitado sem marca, sem produto e sem ligação ("Arroz") sai pelo
// produto da casa do mesmo item (a mesma chave de genericItem) comprado por
// último, com "~" e o produto dito (`sameItem`).
// No mercado escolhido (e em cada linha do "Onde comprar"), o item sem marca
// pode sair por outra marca do mesmo item que custa menos lá para a mesma
// quantidade, por kg ou litro, com os preços de outras casas também (`brand`,
// domain/cheaperBrand); sem mercado escolhido, nada muda.
// Por último, o item sem preço nenhum (nem da casa, nem de outras casas pelo
// produto) pode ter o da base aberta (`open`, domain/openPrices): o mesmo item
// de qualquer marca, visto nas notas de outras casas do estado.

import { joinNames } from './cartPantry';
import {
  BRAND_OPT_OUT,
  BRAND_PRICE_BAND,
  brandFreeKey,
  brandHead,
  brandTileName,
  candidateFits,
  KEY_BRAND_FACT,
  packPriceLabel,
  perBaseLabel,
  quantitySentence,
  quantityShort,
  quoteSize,
  type BiggerPack,
  type BrandKeyQuote,
  type BrandSearchItem,
  type CheaperBrand,
  type PerBaseCost,
  type StorePriceSourceName,
} from './cheaperBrand';
import { diffDays, formatShortDate, toISODate, todayISO } from './dates';
import { genericItem } from './genericItem';
import type { LinkIndex } from './listLinks';
import { formatBRL, formatQuantity } from './money';
import { packLabel, perItemLabel } from './packCount';
import { comparablePrice, packagesFor, plainSize, type ComparablePrice } from './packagePrice';
import { packageSize, samePackageSize, type PackageSize } from './packageSize';
import { storePriceIndex } from './priceLevel';
import { MAX_WEIGHT_KG } from './receiptWeight';
import { SAME_TRIP_DAYS } from './restock';
import {
  brandFreeItemKey,
  OPEN_PRICE_FACT,
  openPriceItem,
  openSizeFact,
  openSizeNote,
  ownSameItemKeys,
  productsByGenericKey,
  type OpenSearchItem,
} from './openPrices';
import { normalizeSearch } from './search';
import type { PurchaseRecord } from './recentPurchases';
import { SHARED_PRICES_NOTICE, seenLabel, sharedStoreLabel, withinBand, type SharedQuote } from './sharedPrices';
import { convertQuantity, pricePerBase, priceQuantity, sameDimension } from './units';

export interface EstimateItem {
  id: string;
  name: string;
  productId: string | null;
  quantity: number;
  unit: string;
  inCart: boolean;
  /** A categoria do item da lista: nos ovos, "12 un" são doze ovos, não doze cartelas (eggsAsked). */
  category?: string | null;
  /** A pessoa ligou "Marca preferida": o item fica com o produto dele, sem outra marca (domain/cheaperBrand). */
  brandPreferred?: boolean;
}

export interface EstimatePrice {
  productId: string;
  storeId: string;
  unit: string;
  unitPrice: number;
  /** Quando a casa pagou esse preço (ISO). */
  purchasedAt: string;
  /** Quantos vinham na embalagem desse preço, quando a pessoa disse na revisão ("10 ovos"; domain/packCount). */
  packCount?: number | null;
  /**
   * A descrição da linha da nota desse preço (latest_prices.raw_description), de onde sai o tamanho do pacote
   * (quoteSize, na troca de marca); ausente antes da coluna, e na linha que não diz um tamanho (compactSavedPrice).
   */
  description?: string | null;
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
  /**
   * A unidade da lista não converte para a do preço (un x kg): o custo é o de 1 kg, 1 litro ou 1 unidade, ou,
   * com o item em "un" e o preço por kg ou litro, o do que a casa costuma levar dele (`perPiece`).
   */
  approximateQuantity: boolean;
  /** Item em "un" com preço por kg ou litro: quanto a casa costuma levar dele de uma vez (usualAmounts), o que a conta usa. */
  perPiece?: UsualAmount;
  /** Item em "un" com preço por kg ou litro sem o costume, porque o histórico de compras não carregou: a conta é de 1 kg ou 1 litro, e diz isso. */
  historyMissing?: boolean;
  /**
   * Ovos pedidos em ovos (eggsAsked) com o preço por cartela: quantos ovos a conta usou e quantos vinham na cartela
   * do preço. Com a cartela conhecida, o custo é o dos ovos pelo preço de cada um; sem ela (`pack` null), o de uma
   * cartela. Nos dois casos, aproximado.
   */
  eggs?: { count: number; pack: number | null };
  /** O produto de onde saem o último preço, o "preço bom" e a estimativa do item (itemResolver); null no preço da base aberta. */
  productId: string | null;
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
  /**
   * O item não diz o produto (sem produto, sem ligação nem produto de mesmo nome): o produto é o da casa do mesmo item
   * (a chave de genericItem) comprado por último. A conta é aproximada ("~"), e os detalhes dizem qual.
   */
  sameItem?: true;
  /** No mercado escolhido, a conta saiu por outra marca do mesmo item, mais barata lá (domain/cheaperBrand). */
  brand?: CheaperBrand;
  /** A conta por kg ou litro: a da outra marca, ou a do de sempre em pacotes inteiros da quantidade que a lista diz. */
  perBase?: PerBaseCost;
  /** Um pacote que sai mais barato por kg lá, mas não cabe na quantidade: dito nos detalhes, fora da conta. */
  biggerPack?: BiggerPack;
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
  /** Itens cuja conta, no mercado escolhido, sai por outra marca; 0 sem mercado. */
  brandCount: number;
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

/** Quantos vêm numa cotação em "un" que diz (dois ou mais); null nas outras. */
const countOf = (quote: EstimatePrice) => (quote.unit === 'un' && quote.packCount != null && quote.packCount >= 2 ? quote.packCount : null);

/**
 * A partir de quantas unidades a lista pede ovos, e não cartelas: "1 dz" vira "12 un" na lista (listPaste), e ninguém
 * pede seis cartelas de uma vez. Abaixo disso, "Ovos 2 un" continua sendo duas cartelas.
 */
export const EGGS_AS_COUNT = 6;

/**
 * Quantos ovos o item da lista pede, quando dá para saber: o nome diz quantos vêm ("Ovos (dúzia)", "Ovos (30 un)":
 * cada unidade da lista é essa cartela) ou a quantidade já é de ovos ("12 un", a partir de EGGS_AS_COUNT). null fora
 * dos ovos, fora de "un" e com poucas unidades sem a conta no nome: aí cada unidade é uma cartela, como sempre.
 */
function eggsAsked(item: Pick<EstimateItem, 'name' | 'quantity' | 'unit' | 'category'>): { count: number; fromName: boolean } | null {
  if (item.category !== 'ovos' || item.unit !== 'un' || !(item.quantity > 0)) return null;
  const size = packageSize(item.name);
  if (size?.unit === 'un') return { count: item.quantity * size.amount, fromName: true };
  return item.quantity >= EGGS_AS_COUNT ? { count: item.quantity, fromName: false } : null;
}

/**
 * A quantidade com que entra o item escolhido nas sugestões depois de a pessoa digitar uma quantidade ("30 ovos",
 * "1 dz ovos"), quando ele é de ovos: os mesmos ovos que a linha digitada pede, lidos como a conta lê (eggsAsked).
 * O item cujo nome já diz quantos vêm ("Ovos (30 un)", "Ovos (dúzia)", os itens comuns que a busca por "ovos"
 * sugere) entra em cartelas, arredondadas para cima porque não se compra meia ("30 ovos" é 1 "Ovos (30 un)", e não
 * trinta cartelas de trinta; "2 dz ovos" são 2 "Ovos (dúzia)"; "20 ovos", 1 "Ovos (30 un)"); o sem a conta no nome
 * ("Ovos brancos") entra em ovos, a partir de EGGS_AS_COUNT. Com poucas unidades sem a conta no nome ("2 ovos",
 * "2 caixas de ovos"), cada uma já é uma cartela, como na conta: ficam como foram digitadas. Fora dos ovos e de "un",
 * a quantidade digitada, como sempre.
 */
export function chosenItemQuantity(
  typed: { name: string; quantity: number; unit: string },
  chosen: { name: string; category: string | null | undefined },
): number {
  if (chosen.category !== 'ovos' || typed.unit !== 'un') return typed.quantity;
  // A linha digitada pede os ovos do item escolhido: a categoria é a dele.
  const asked = eggsAsked({ ...typed, category: 'ovos' });
  if (!asked) return typed.quantity;
  const size = packageSize(chosen.name);
  // Com uma folga mínima: num múltiplo exato, o ponto flutuante não pode pôr uma cartela a mais.
  if (size?.unit === 'un') return Math.max(1, Math.ceil(asked.count / size.amount - 1e-9));
  return asked.count >= EGGS_AS_COUNT ? asked.count : typed.quantity;
}

/**
 * O preço por ovo de uma cotação em "un" que diz quantos vêm (dois ou mais); null nas outras. Arredondado a 8 casas:
 * R$ 5,04 em 6 e R$ 8,40 em 10 são o mesmo R$ 0,84 o ovo, mas em ponto flutuante o segundo sai um pouco acima.
 */
const perEggOf = (quote: EstimatePrice) => {
  const count = countOf(quote);
  return count != null ? round8(quote.unitPrice / count) : null;
};

/**
 * O "Menor preço" entre as cotações de um item numa unidade. Cada par se compara pelo preço por ovo quando as duas dizem
 * quantos vêm (a cartela de 30 a R$ 39,90 sai R$ 1,33 o ovo, a de 10 a R$ 13,99 sai R$ 1,40); senão, pelo preço da
 * cartela, como antes. Vence a cotação que nenhuma outra bate pelo par; no empate, a mais nova. Se ninguém vence
 * (um ciclo entre três, com uma sem contagem), vale o menor por ovo entre as que dizem a contagem; sem nenhuma, a menor
 * cartela, e a ordem da lista não decide. Não muda o custo da lista nem a ordem de "Onde comprar", que são pela cotação.
 */
const lowestOf = (quotes: EstimatePrice[]): EstimatePrice => {
  const beats = (quote: EstimatePrice, other: EstimatePrice) => {
    const [mine, theirs] = [perEggOf(quote), perEggOf(other)];
    return mine != null && theirs != null ? mine < theirs : quote.unitPrice < other.unitPrice;
  };
  const unbeaten = quotes.filter((quote) => !quotes.some((other) => beats(other, quote)));
  if (unbeaten.length) return newest(unbeaten);
  const counted = quotes.filter((quote) => perEggOf(quote) != null);
  if (counted.length) return newest(counted.filter((quote) => !counted.some((other) => beats(other, quote))));
  const cheapest = Math.min(...quotes.map((quote) => quote.unitPrice));
  return newest(quotes.filter((quote) => quote.unitPrice === cheapest));
};

/** O preço que serve à unidade da lista: nela; senão, numa que converte para ela (g e kg); senão, o mais recente. */
function bestForUnit<T extends { unit: string }>(listUnit: string, quotes: T[], latest: (quotes: T[]) => T): T {
  const exact = quotes.filter((quote) => quote.unit === listUnit);
  if (exact.length) return latest(exact);
  const convertible = quotes.filter((quote) => sameDimension(quote.unit, listUnit));
  return latest(convertible.length ? convertible : quotes);
}

/**
 * O preço de outras casas visto por último (pela semana). Na mesma semana, sempre o mesmo: o mais barato, depois o
 * de menor produto, CNPJ, unidade e mercado da casa. A ordem em que o banco devolve as linhas não decide a conta.
 */
const newestShared = (quotes: SharedQuote[]) =>
  quotes.reduce((a, b) => {
    if (a.seenWeek !== b.seenWeek) return b.seenWeek > a.seenWeek ? b : a;
    if (a.unitPrice !== b.unitPrice) return b.unitPrice < a.unitPrice ? b : a;
    const order =
      byId(b.productId ?? '', a.productId ?? '') ||
      byId(b.storeCnpj, a.storeCnpj) ||
      byId(b.unit, a.unit) ||
      byId(b.storeId ?? '', a.storeId ?? '');
    return order < 0 ? b : a;
  });

/** De onde saem os preços da lista, além dos da casa. */
export interface PriceSources {
  links?: LinkIndex;
  /**
   * Os produtos da casa. undefined é "não carregados": sem eles não há produto de mesmo nome, nem o produto do mesmo
   * item para o item digitado sem marca, nem outra marca no mercado escolhido.
   */
  products?: readonly { id: string; name: string; category?: string | null }[];
  /** Os preços vistos em outras casas (sharedQuotes): só entram onde a casa não tem preço do item. */
  shared?: readonly SharedQuote[];
  /**
   * Os preços da base aberta, por item da lista (openQuotes de domain/openPrices): só entram no item sem preço nenhum,
   * nem da casa nem de outras casas pelo produto.
   */
  open?: ReadonlyMap<string, readonly SharedQuote[]>;
  /** O que a casa costuma levar dos produtos vendidos a peso (usualAmounts): a conta do item em "un" com preço por kg. */
  usual?: UsualAmounts;
  /** O histórico de compras não carregou (sem dados, e a busca não anda): sem o costume, a conta diz isso. */
  historyMissing?: boolean;
  /**
   * As marcas que só outras casas compraram, por item da lista (brandKeyQuotes de domain/cheaperBrand, da base
   * aberta): concorrem na troca de marca do mercado escolhido.
   */
  brandKeys?: ReadonlyMap<string, readonly BrandKeyQuote[]>;
  /**
   * false: a conta de antes da troca de marca, sem outra marca no mercado escolhido e sem o produto do mesmo item para
   * o item digitado sem marca (os testes provam com isso que o que não pode trocar fica como era). Padrão: true.
   */
  cheaperBrands?: boolean;
}

/** Quanto a casa leva de um produto por vez, em kg ou litro. */
export interface UsualAmount {
  unit: 'kg' | 'l';
  amount: number;
}

/** Por produto, o que a casa costuma levar dele a peso e a litro. */
export type UsualAmounts = ReadonlyMap<string, Partial<Record<UsualAmount['unit'], number>>>;

/** Acima disso, em litro, a linha não é o que a casa leva de uma vez (em kg, o teto é MAX_WEIGHT_KG). */
const MAX_USUAL_LITERS = 20;

/**
 * O que a casa costuma levar de cada produto vendido a peso ou a litro: a
 * mediana das linhas das notas dos últimos meses (os registros de compra), em
 * kg ou litro, arredondada ao grama. Com número par de linhas, a menor das duas
 * do meio, e não a média: 0,200 e 0,202 kg dão 200 g; 0,2 e 2,5 kg dão 0,2 kg.
 * Só as notas: a quantidade da lista é o que a casa pede, não o que a balança
 * deu. Linha acima de 20 kg ou 20 l não entra: é o peso de um erro de digitação
 * ("202" no lugar de "0,202"), não de uma peça do balcão. Serve à conta do item
 * que a lista pede em "un" ("Queijo", 1 un) com o preço por kg: sem ela, a conta
 * seria de 1 kg.
 */
export function usualAmounts(records: readonly Pick<PurchaseRecord, 'productId' | 'quantity' | 'unit' | 'source'>[]): UsualAmounts {
  const amounts = new Map<string, Record<UsualAmount['unit'], number[]>>();
  for (const record of records) {
    if (record.source !== 'receipt' || !record.productId || !(record.quantity > 0)) continue;
    const unit = pricePerBase(1, record.unit).unit;
    if (unit !== 'kg' && unit !== 'l') continue;
    const amount = convertQuantity(record.quantity, record.unit, unit)!;
    if (amount > (unit === 'kg' ? MAX_WEIGHT_KG : MAX_USUAL_LITERS)) continue;
    const seen = amounts.get(record.productId) ?? { kg: [], l: [] };
    seen[unit].push(amount);
    amounts.set(record.productId, seen);
  }
  // Com número par de linhas, a menor das duas do meio (a mediana inferior): uma compra que a casa fez de fato. A média
  // entre 0,2 kg e 2,5 kg, 1,35 kg, ela nunca levou.
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const value = sorted[Math.floor((sorted.length - 1) / 2)];
    return Math.round(value * 1000) / 1000;
  };
  const usual = new Map<string, Partial<Record<UsualAmount['unit'], number>>>();
  for (const [productId, { kg, l }] of amounts) {
    const entry: Partial<Record<UsualAmount['unit'], number>> = {};
    if (kg.length && median(kg) > 0) entry.kg = median(kg);
    if (l.length && median(l) > 0) entry.l = median(l);
    if (entry.kg != null || entry.l != null) usual.set(productId, entry);
  }
  return usual;
}

/**
 * Quanto a conta usa do item pedido em "un" quando o preço é por kg ou litro:
 * o que a casa costuma levar do produto do preço (ou, sem compra dele a peso,
 * do produto do item), uma vez, qualquer que seja a quantidade da lista ("6
 * un" de banana não são seis compras de banana). null quando o item não é em
 * "un", o preço não é por peso nem por volume, ou a casa nunca comprou o
 * produto a peso.
 */
function piecePerUnit(
  usual: UsualAmounts | undefined,
  listUnit: string,
  priceUnit: string,
  productIds: readonly (string | null)[],
): { perPiece: UsualAmount; inPriceUnit: number } | null {
  if (!usual || listUnit !== 'un') return null;
  const unit = pricePerBase(1, priceUnit).unit;
  if (unit !== 'kg' && unit !== 'l') return null;
  for (const productId of productIds) {
    if (!productId) continue;
    const amount = usual.get(productId)?.[unit];
    if (amount != null && amount > 0) return { perPiece: { unit, amount }, inPriceUnit: convertQuantity(amount, unit, priceUnit)! };
  }
  return null;
}

interface ResolvedItem {
  productId: string;
  /** Os preços do produto, em todos os mercados e unidades. */
  own: EstimatePrice[];
  /** Os de todos os produtos que servem ao item (os ligados ao mesmo nome). */
  all: EstimatePrice[];
  /** O produto é o da casa do mesmo item, para o item que não diz o produto (sem produto, ligação nem mesmo nome). */
  sameItem?: true;
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
 * nome nas notas e o de mesmo nome, valendo o comprado mais recentemente. O
 * item sem marca que não diz produto nenhum (sem produto, sem ligação e sem
 * produto de mesmo nome: "Arroz" digitado) fica com o produto da casa do mesmo
 * item (a mesma chave de genericItem, com os tipos: "Leite" não é o "Leite
 * integral" da casa) comprado mais recentemente, e só com os preços dele
 * (`sameItem`). Item sem preço nenhum não tem produto.
 */
function itemResolver(prices: readonly EstimatePrice[], { links, products, cheaperBrands }: PriceSources) {
  const productList = products ?? [];
  const byProduct = new Map<string, EstimatePrice[]>();
  for (const price of comparablePrices(prices)) byProduct.set(price.productId, [...(byProduct.get(price.productId) ?? []), price]);
  /** Quando o produto foi comprado por último; sem preço, antes de qualquer data. */
  const lastBought = (productId: string) => Math.max(-Infinity, ...(byProduct.get(productId) ?? []).map((quote) => Date.parse(quote.purchasedAt)));
  // Dois produtos podem ter o mesmo nome, a não ser pelo acento ("Açúcar" e "Acucar"). Vale o de preço mais
  // recente; no empate, e sem preço em nenhum, o de menor id: a ordem em que os produtos chegam não decide.
  const productByName = new Map<string, string>();
  for (const product of productList) {
    const name = normalizeSearch(product.name);
    const current = productByName.get(name);
    if (current === undefined) productByName.set(name, product.id);
    else if (current !== product.id) {
      const [mine, theirs] = [lastBought(product.id), lastBought(current)];
      if (mine > theirs || (mine === theirs && product.id < current)) productByName.set(name, product.id);
    }
  }
  // Os produtos com preço por item sem marca: lidos uma vez, e só quando um item digitado sem marca pede.
  let pricedByKey: Map<string, string[]> | null = null;
  const sameItemProducts = (key: string) => {
    pricedByKey ??= productsByGenericKey(productList, (id) => byProduct.has(id));
    return pricedByKey.get(key) ?? [];
  };
  const sameItemOn = cheaperBrands !== false && products !== undefined;

  /** Os produtos que podem cumprir o item quando o dele não tem preço: os que já cumpriram esse nome nas notas e o de mesmo nome. */
  const candidates = (item: Pick<EstimateItem, 'name'>): string[] => {
    const sameName = productByName.get(normalizeSearch(item.name));
    return [...new Set([...(links?.productsFor(item.name) ?? []), ...(sameName ? [sameName] : [])])];
  };

  const resolve = (item: Pick<EstimateItem, 'name' | 'productId' | 'unit' | 'category' | 'brandPreferred'>): ResolvedItem | null => {
    // O produto do item; sem ele (ou se ele não tem preço), os que já cumpriram esse nome nas notas e o de mesmo nome.
    let all = item.productId ? (byProduct.get(item.productId) ?? []) : [];
    if (!all.length) all = candidates(item).flatMap((productId) => byProduct.get(productId) ?? []);
    if (!all.length) {
      // O item digitado sem marca que não diz produto nenhum: o produto da casa do mesmo item comprado por último, só ele.
      const key = sameItemOn && !item.productId && !candidates(item).length ? brandFreeItemKey(item) : null;
      const same = key ? sameItemProducts(key).flatMap((productId) => byProduct.get(productId) ?? []) : [];
      if (!same.length) return null;
      const { productId } = newest(same);
      const own = same.filter((quote) => quote.productId === productId);
      return { productId, own, all: own, sameItem: true };
    }
    // Entre vários produtos, vale o comprado mais recentemente, em qualquer unidade: a unidade é escolhida
    // depois, só entre os preços desse produto (um produto antigo na unidade da lista não passa na frente).
    const { productId } = newest(all);
    return { productId, own: all.filter((quote) => quote.productId === productId), all };
  };
  return { resolve, candidates, byProduct };
}

/**
 * De onde vem o preço de um item da lista num mercado: do produto do item, na unidade de sempre (`product`) ou em
 * outra (`otherUnit`); de outro produto ligado ao mesmo nome (`otherProduct`); de outra marca da casa do mesmo item,
 * mais barata lá (`cheaperBrand`); o visto em outras casas (`shared`, também o de outra marca); ou do nível de preço
 * do mercado (`estimated`). Declarado em domain/cheaperBrand (ele não importa esta conta).
 */
export type StorePriceSource = StorePriceSourceName;

/** O preço de um item da lista num mercado, e de onde ele vem (listStorePrices). */
export interface StorePrice
  extends Pick<
    ItemEstimate,
    | 'cost'
    | 'unitPrice'
    | 'unit'
    | 'kind'
    | 'approximateQuantity'
    | 'perPiece'
    | 'productId'
    | 'used'
    | 'shared'
    | 'historyMissing'
    | 'eggs'
    | 'sameItem'
    | 'brand'
    | 'perBase'
    | 'biggerPack'
  > {
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
  /** A troca de marca do item (domain/cheaperBrand), quando ele pode trocar; null quando não pode. */
  brandPlan: () => BrandPlan | null;
}

/** Outra marca do mesmo item, num mercado da casa, com o preço por kg ou litro (domain/cheaperBrand). */
interface Contestant {
  /** "p:<produto>" (da casa), "s:<produto>" (da casa, visto em outras casas) ou "k:<grupo>" (só outras casas compraram). */
  id: string;
  name: string | null;
  category: string | null;
  productId: string | null;
  own: EstimatePrice | null;
  shared: SharedQuote | null;
  price: ComparablePrice;
  /** O dia da compra da casa, ou a segunda-feira da semana em que outra casa viu. */
  day: string;
  unit: string;
}

/** O que a troca de marca de um item precisa, uma vez por item. */
interface BrandPlan {
  base: 'kg' | 'l';
  /** O preço por kg ou litro mais novo que a casa pagou pelo de sempre: o centro da faixa. */
  centre: number;
  /** A quantidade que a lista diz, na base (kg ou litro, ou o tamanho no nome vezes a quantidade); null quando não diz. */
  stated: { amount: number; units: number } | null;
  /** O tamanho de pacote que todo preço por unidade do de sempre diz, para a estimativa pelo nível de preço; null sem ele. */
  usualSize: PackageSize | null;
  reference: { id: string; name: string; key: string };
  /** Os produtos da casa com a chave do de sempre e preço (o de sempre também). */
  sameKey: string[];
  contestants: Map<string, Contestant[]>;
}

const cents = (value: number) => Math.round(value * 100);
const dayOf = (iso: string) => toISODate(new Date(iso));

/** A quantidade que a lista diz, na base: em g ou kg, em ml ou l, ou "un" com o tamanho no nome ("Arroz 5kg"). */
function statedAmount(item: Pick<EstimateItem, 'name' | 'quantity' | 'unit'>): { base: 'kg' | 'l'; amount: number; units: number } | null {
  if (item.unit === 'g' || item.unit === 'kg') return { base: 'kg', amount: convertQuantity(item.quantity, item.unit, 'kg')!, units: 1 };
  if (item.unit === 'ml' || item.unit === 'l') return { base: 'l', amount: convertQuantity(item.quantity, item.unit, 'l')!, units: 1 };
  if (item.unit !== 'un') return null;
  const size = plainSize(packageSize(item.name));
  return size ? { base: size.unit as 'kg' | 'l', amount: item.quantity * size.amount, units: item.quantity } : null;
}

/** Entre duas outras marcas de mesmo custo: a da casa antes da de outras casas, a mais nova, o id, a unidade. */
const contestantOrder = (a: Contestant, b: Contestant) =>
  Number(b.own != null) - Number(a.own != null) ||
  (a.day !== b.day ? (a.day < b.day ? 1 : -1) : 0) ||
  byId(a.id, b.id) ||
  byId(a.unit, b.unit);

/**
 * A regra de preço da lista, uma só para a estimativa e para "Onde comprar":
 * o produto de cada item (itemResolver) e, em cada mercado, o preço que vale
 * lá. null para item sem preço nenhum, nem da casa nem de outras casas.
 */
function itemPricer(prices: readonly EstimatePrice[], sources: PriceSources, index = storePriceIndex(prices)) {
  const { resolve, candidates, byProduct } = itemResolver(prices, sources);
  const sharedByProduct = new Map<string, SharedQuote[]>();
  for (const quote of sources.shared ?? []) {
    if (quote.unitPrice > 0 && quote.productId) sharedByProduct.set(quote.productId, [...(sharedByProduct.get(quote.productId) ?? []), quote]);
  }
  // A troca de marca: só com os produtos carregados. Os produtos por item sem marca saem uma vez, e só os que têm
  // preço (da casa ou de outras casas pelo produto): uma casa pode ter milhares de produtos.
  const brandsOn = sources.cheaperBrands !== false && sources.products !== undefined;
  const productById = new Map((sources.products ?? []).map((product) => [product.id, product]));
  let byKey: Map<string, string[]> | null = null;
  const productsOfKey = (key: string) => {
    byKey ??= productsByGenericKey(sources.products ?? [], (id) => byProduct.has(id) || sharedByProduct.has(id));
    return byKey.get(key) ?? [];
  };
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

  /**
   * A troca de marca do item, ou null: o item pode trocar (brandFreeKey), o de sempre (o produto que a regra de hoje
   * resolve) é um item sem marca que o app conhece, e a casa pagou por ele um preço que vira preço por kg ou litro (o
   * centro da faixa, e a medida da conta). As outras marcas de cada mercado: (a) os outros produtos da casa com a mesma
   * chave, pelos preços da casa; (b) esses produtos vistos em outras casas, onde a casa não tem preço deles; (c) as
   * marcas que só outras casas compraram (`brandKeys`). Só as que são o mesmo item (candidateFits) e dentro da faixa.
   */
  const planFor = (item: Pick<EstimateItem, 'id' | 'name' | 'quantity' | 'unit' | 'category' | 'brandPreferred'>, resolved: ResolvedItem): BrandPlan | null => {
    if (!brandFreeKey(item)) return null;
    const product = productById.get(resolved.productId);
    if (!product) return null;
    const key = genericItem(product.name, product.category).key;
    if (!key.startsWith('i:')) return null;
    let centre: { quote: EstimatePrice; price: ComparablePrice } | null = null;
    for (const quote of resolved.own) {
      const price = comparablePrice(quote.unit, quote.unitPrice, quoteSize(quote.description));
      if (!price) continue;
      const later = centre ? Date.parse(quote.purchasedAt) - Date.parse(centre.quote.purchasedAt) : 1;
      if (later > 0 || (later === 0 && price.perBase < centre!.price.perBase)) centre = { quote, price };
    }
    if (!centre) return null;
    const { base, perBase: middle } = centre.price;
    const stated = statedAmount(item);
    if (stated && stated.base !== base) return null;
    // A estimativa pelo nível de preço não diz o tamanho: o que todo preço por unidade do de sempre diz, quando é um só.
    const unitSizes = resolved.own.filter((quote) => quote.unit === 'un').map((quote) => quoteSize(quote.description));
    const first = unitSizes[0] ?? null;
    const usualSize =
      first && first.unit === base && unitSizes.every((size) => size != null && samePackageSize(size, first)) ? first : null;
    const reference = { id: product.id, name: product.name, key };
    const contestants = new Map<string, Contestant[]>();
    const add = (storeId: string, contestant: Contestant) => {
      if (contestant.price.base !== base || !withinBand(contestant.price.perBase, middle, BRAND_PRICE_BAND)) return;
      contestants.set(storeId, [...(contestants.get(storeId) ?? []), contestant]);
    };
    const sameKey = productsOfKey(key);
    for (const productId of sameKey) {
      if (productId === product.id) continue;
      const other = productById.get(productId)!;
      const category = other.category ?? null;
      if (!candidateFits(item, reference, { name: other.name, category })) continue;
      // (a) O preço da casa desse produto; (b) o visto em outras casas, onde a casa não tem um comparável dele.
      const ownHere = new Set<string>();
      for (const quote of byProduct.get(productId) ?? []) {
        const price = comparablePrice(quote.unit, quote.unitPrice, quoteSize(quote.description));
        if (!price || price.base !== base) continue;
        ownHere.add(quote.storeId);
        add(quote.storeId, { id: `p:${productId}`, name: other.name, category, productId, own: quote, shared: null, price, day: dayOf(quote.purchasedAt), unit: quote.unit });
      }
      for (const quote of sharedByProduct.get(productId) ?? []) {
        if (!quote.storeId || ownHere.has(quote.storeId)) continue;
        const price = comparablePrice(quote.unit, quote.unitPrice, quote.pack);
        if (!price) continue;
        add(quote.storeId, { id: `s:${productId}`, name: other.name, category, productId, own: null, shared: quote, price, day: quote.seenWeek, unit: quote.unit });
      }
    }
    // (c) As marcas que só outras casas compraram, feitas para este mesmo de sempre.
    for (const found of sources.brandKeys?.get(item.id) ?? []) {
      if (found.referenceKey !== key) continue;
      const contestant: Contestant = {
        id: `k:${found.group}`,
        name: null,
        category: null,
        productId: null,
        own: null,
        shared: found.quote,
        price: found.price,
        day: found.quote.seenWeek,
        unit: found.quote.unit,
      };
      add(found.storeId, contestant);
    }
    return {
      base,
      centre: middle,
      stated: stated ? { amount: stated.amount, units: stated.units } : null,
      usualSize,
      reference,
      sameKey,
      contestants,
    };
  };

  return (item: Pick<EstimateItem, 'id' | 'name' | 'productId' | 'quantity' | 'unit' | 'category' | 'brandPreferred'>): PricedItem | null => {
    const resolved = resolve(item);
    const productShared = sharedOf(item, resolved);
    // Sem preço nenhum (nem da casa, nem de outras casas pelo produto): o da base aberta, do mesmo item de qualquer marca.
    const shared =
      resolved || productShared.length ? productShared : (sources.open?.get(item.id) ?? []).filter((quote) => quote.unitPrice > 0);
    if (!resolved && !shared.length) return null;
    const own = resolved?.own ?? [];
    const all = resolved?.all ?? [];
    const productId = resolved?.productId ?? shared[0].productId;
    const sameItem = resolved?.sameItem === true;
    // Na unidade da lista quando há preço nela; senão, numa que converte para ela; senão, na do preço mais recente.
    const { unit } = own.length ? bestForUnit(item.unit, own, newest) : bestForUnit(item.unit, shared, newestShared);
    const quotes = own.filter((quote) => quote.unit === unit);
    const last = quotes.length ? newest(quotes) : null;
    // O "preço bom" é do mesmo produto (outro produto do mesmo nome pode ser outra embalagem); no empate, o próprio último.
    // Entre cartelas de ovos que dizem quantos vêm, a comparação é por ovo, par a par (lowestOf).
    const lowest = last && lowestOf(quotes);

    const priced = (source: StorePriceSource, used: EstimatePrice | null, unitPrice: number, seen?: SharedQuote): StorePrice => {
      const priceUnit = seen?.unit ?? used?.unit ?? unit;
      // "Queijo", 1 un, com o preço por kg: o que a casa costuma levar dele de uma vez, e não 1 kg. Como o 1 kg, vale
      // qualquer que seja a quantidade: "6 un" de banana são as bananas de sempre, não seis vezes elas.
      const piece = piecePerUnit(sources.usual, item.unit, priceUnit, [seen?.productId ?? used?.productId ?? productId, productId]);
      // Ovos pedidos em ovos ("1 dz" é "12 un") com o preço por cartela: pelo preço de cada ovo quando a cartela do preço
      // diz quantos vêm (a da nota da casa, a que o servidor leu na nota de outra casa, ou a que a base aberta escolheu);
      // sem isso, uma cartela, e não doze. A cartela do nome ("Ovos (dúzia)") sem a do preço fica como sempre, uma por
      // unidade. O preço estimado não diz quantos vêm.
      const asked = !piece && priceUnit === 'un' ? eggsAsked(item) : null;
      const pack = asked ? (used && !seen ? countOf(used) : seen?.pack?.unit === 'un' ? seen.pack.amount : null) : null;
      const eggs = asked && (pack != null || !asked.fromName) ? { count: asked.count, pack } : null;
      const { quantity, approximate } = piece
        ? { quantity: piece.inPriceUnit, approximate: true }
        : eggs
          ? { quantity: eggs.pack != null ? eggs.count / eggs.pack : 1, approximate: true }
          : priceQuantity(item.quantity, item.unit, priceUnit);
      // Sem o costume porque o histórico de compras não carregou: o 1 kg (ou 1 litro) de sempre, e a conta diz que o costume não entrou.
      const historyMissing =
        !piece && sources.historyMissing === true && item.unit === 'un' && ['kg', 'l'].includes(pricePerBase(1, priceUnit).unit);
      return {
        source,
        cost: round2(unitPrice * quantity),
        // Com as casas da nota, não em centavos: é o preço por unidade que os detalhes do item mostram.
        unitPrice: round8(unitPrice),
        unit: priceUnit,
        kind: used || seen ? 'known' : 'estimated',
        approximateQuantity: approximate,
        ...(piece ? { perPiece: piece.perPiece } : {}),
        ...(historyMissing ? { historyMissing: true } : {}),
        ...(eggs ? { eggs } : {}),
        productId,
        used,
        ...(seen ? { shared: seen } : {}),
        ...(sameItem ? { sameItem: true } : {}),
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
    /** O preço do item num mercado pela regra de sempre (o "de sempre" da troca de marca). */
    const tierAt = (storeId: string): StorePrice | null => {
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
    };

    let plan: BrandPlan | null | undefined;
    // A troca de marca só se calcula quando alguém pergunta por um mercado (sem mercado escolhido, nada muda).
    const brandPlan = () => (plan === undefined ? (plan = brandsOn && resolved ? planFor(item, resolved) : null) : plan);

    /**
     * A disputa num mercado (domain/cheaperBrand): o de sempre lá (tierAt) contra as outras marcas do mesmo item, na
     * mesma quantidade. A quantidade é a que a lista diz; sem ela, a do de sempre lá (o pacote dele vezes a quantidade,
     * ou o pedaço de costume e o 1 kg do preço a granel): "1 un" continua sendo um pacote do que a casa compra ali.
     * Outra marca entra em pacotes inteiros (1 a MAX_WHOLE_PACKAGES por unidade da lista) ou a granel, e vence só
     * custando ao menos um centavo menos que o de sempre na mesma quantidade. Sem vencedora, a lista que diz a
     * quantidade leva o de sempre em pacotes inteiros dela ("Arroz 5kg" onde a casa compra o de 1 kg: 5 pacotes).
     */
    const contest = (usual: StorePrice, storeId: string, brand: BrandPlan): StorePrice => {
      const usualPrice = usual.used
        ? comparablePrice(usual.used.unit, usual.used.unitPrice, quoteSize(usual.used.description))
        : usual.shared
          ? comparablePrice(usual.shared.unit, usual.shared.unitPrice, usual.shared.pack)
          : comparablePrice(usual.unit, usual.unitPrice, usual.unit === 'un' ? brand.usualSize : null);
      if (!usualPrice || usualPrice.base !== brand.base) return usual;
      // A quantidade (na base) e quantas unidades da lista ela cobre.
      const loose = usualPrice.pack == null;
      const fromLoose = !brand.stated && loose;
      const { amount, units } = brand.stated
        ? brand.stated
        : !loose
          ? { amount: item.quantity * usualPrice.pack!.amount, units: item.quantity }
          : { amount: usual.perPiece ? usual.perPiece.amount : 1, units: 1 };
      const perUnit = amount / units;
      const usualPackages = loose ? null : packagesFor(perUnit, units, usualPrice.pack!);
      const usualCost =
        usualPackages != null ? round2(usualPackages * usualPrice.packagePrice!) : round2(usualPrice.perBase * amount);
      const usualProduct = usual.used?.productId ?? usual.shared?.productId ?? usual.productId;
      const here = (brand.contestants.get(storeId) ?? []).filter((contestant) => contestant.productId == null || contestant.productId !== usualProduct);
      const priced = here.map((contestant) => {
        const packages = contestant.price.pack ? packagesFor(perUnit, units, contestant.price.pack) : null;
        const cost =
          contestant.price.pack == null
            ? round2(contestant.price.perBase * amount)
            : packages != null
              ? round2(packages * contestant.price.packagePrice!)
              : null;
        return { contestant, packages, cost };
      });
      const fitting = priced.filter((entry): entry is typeof entry & { cost: number } => entry.cost != null);
      const winner = fitting.length
        ? fitting.reduce((a, b) => (b.cost < a.cost || (b.cost === a.cost && contestantOrder(b.contestant, a.contestant) < 0) ? b : a))
        : null;
      const sayQuantity = (packages: number | null) => packages != null && (item.unit !== 'un' || packages !== item.quantity);
      const stated = brand.stated != null;
      // O mais barato por kg que não cabe: só nos detalhes.
      const biggerOf = (answerPerBase: number, answer: Contestant | null): BiggerPack | null => {
        if (!priced.length) return null;
        const cheapest = priced.reduce((a, b) =>
          b.contestant.price.perBase < a.contestant.price.perBase ||
          (b.contestant.price.perBase === a.contestant.price.perBase && contestantOrder(b.contestant, a.contestant) < 0)
            ? b
            : a,
        );
        const { contestant } = cheapest;
        if (contestant === answer || contestant.price.pack == null || cheapest.packages != null) return null;
        if (cents(contestant.price.perBase) >= cents(answerPerBase)) return null;
        return {
          name: contestant.name,
          price: contestant.price,
          own: contestant.own ? { storeId: contestant.own.storeId, purchasedAt: contestant.own.purchasedAt } : null,
          shared: contestant.shared,
          stated,
        };
      };
      if (winner && cents(winner.cost) < cents(usualCost)) {
        const { contestant, packages, cost } = winner;
        const carried = fromLoose && contestant.price.pack == null;
        const bigger = biggerOf(contestant.price.perBase, contestant);
        return {
          source: contestant.own ? 'cheaperBrand' : 'shared',
          cost,
          unitPrice: round8(contestant.price.perBase),
          unit: brand.base,
          kind: 'known',
          approximateQuantity: carried ? usual.approximateQuantity : false,
          ...(carried && usual.perPiece ? { perPiece: usual.perPiece } : {}),
          ...(carried && usual.historyMissing ? { historyMissing: true } : {}),
          productId: usual.productId,
          used: contestant.own,
          ...(contestant.shared ? { shared: contestant.shared } : {}),
          ...(sameItem ? { sameItem: true } : {}),
          brand: {
            name: contestant.name,
            category: contestant.category,
            productId: contestant.productId,
            usual: { productId: usualProduct ?? brand.reference.id, perBase: usualPrice.perBase, source: usual.source },
          },
          perBase: { ...contestant.price, amount, packages, sayQuantity: sayQuantity(packages) },
          ...(bigger ? { biggerPack: bigger } : {}),
        };
      }
      const bigger = biggerOf(usualPrice.perBase, null);
      // O de sempre, em pacotes inteiros da quantidade que a lista diz (exato: o pacote dele, tantas vezes).
      const recosted: StorePrice =
        stated && usualPackages != null
          ? {
              ...usual,
              cost: round2(usualPackages * usualPrice.packagePrice!),
              approximateQuantity: false,
              perBase: { ...usualPrice, amount, packages: usualPackages, sayQuantity: sayQuantity(usualPackages) },
            }
          : usual;
      return bigger ? { ...recosted, biggerPack: bigger } : recosted;
    };

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
        const usual = tierAt(storeId);
        // Só troca uma resposta que existe: o item tem resposta em todo mercado ou em nenhum, como sempre.
        const brand = usual ? brandPlan() : null;
        return usual && brand ? contest(usual, storeId, brand) : usual;
      },
      elsewhere: () => {
        const byStore = new Map<string, SharedQuote[]>();
        for (const quote of shared) {
          if (quote.storeId == null) byStore.set(quote.storeCnpj, [...(byStore.get(quote.storeCnpj) ?? []), quote]);
        }
        return [...byStore.values()].map(fromShared);
      },
      brandPlan,
    };
  };
}

/**
 * O preço de cada item da lista em cada mercado, e de onde ele vem: do
 * produto do item, na unidade de sempre; dele, em outra unidade; de outro
 * produto ligado ao mesmo nome; o visto em outras casas nesse mercado; ou
 * estimado pelo nível de preço do mercado. No item sem marca, outra marca do
 * mesmo item que sai mais barata lá, na mesma quantidade, pode tomar o lugar
 * dessa resposta (domain/cheaperBrand). null para item sem preço ali (fica
 * fora da conta). É a resposta que a estimativa usa com o mercado escolhido e
 * a que "Onde comprar" recebe (recommendStores, `priceAt`): por isso as duas
 * telas dão o mesmo total.
 */
export function listStorePrices(
  items: readonly Pick<EstimateItem, 'id' | 'name' | 'productId' | 'quantity' | 'unit' | 'category' | 'brandPreferred'>[],
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
  items: readonly Pick<EstimateItem, 'id' | 'name' | 'productId' | 'quantity' | 'unit' | 'category' | 'brandPreferred'>[],
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
  items: readonly Pick<EstimateItem, 'id' | 'name' | 'productId' | 'quantity' | 'unit' | 'category' | 'brandPreferred'>[],
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
 * Os itens sem preço nenhum: nem da casa (de qualquer produto ligado ao item), nem de outras casas pelo produto. A
 * base aberta (`sources.open`) não conta aqui: é para estes itens que ela procura.
 */
export function itemsWithoutPrice(
  items: readonly Pick<EstimateItem, 'id' | 'name' | 'productId' | 'quantity' | 'unit' | 'category' | 'brandPreferred'>[],
  prices: readonly EstimatePrice[],
  sources: PriceSources = {},
): Set<string> {
  // A troca de marca não dá nem tira preço (só troca uma resposta que existe): as marcas de fora não entram aqui.
  const price = itemPricer(prices, { ...sources, open: undefined, brandKeys: undefined });
  return new Set(items.filter((item) => !price(item)).map((item) => item.id));
}

/**
 * Os itens da lista que procuram preço na base aberta, na ordem da lista: os sem preço nenhum (itemsWithoutPrice) que
 * podem buscar (openPriceItem: de qualquer marca, de categoria que se compartilha, e não o item de um produto da casa
 * com preço, ownSameItemKeys). O item digitado "Arroz" numa casa que comprou "Arroz Camil 5kg" não procura: ele sai
 * pelo produto da casa do mesmo item (`sameItem`, itemResolver), e o dado da casa vence.
 */
export function openCandidates(
  items: readonly Pick<EstimateItem, 'id' | 'name' | 'productId' | 'quantity' | 'unit' | 'category' | 'brandPreferred'>[],
  prices: readonly EstimatePrice[],
  sources: PriceSources = {},
  products: readonly { id: string; name: string; category?: string | null }[] = sources.products ?? [],
): OpenSearchItem[] {
  const without = itemsWithoutPrice(items, prices, sources);
  const ownKeys = ownSameItemKeys(products, prices);
  return items
    .filter((item) => without.has(item.id))
    .map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category ?? null,
      quantity: item.quantity,
      unit: item.unit,
      ...(item.brandPreferred === true ? { brandPreferred: true } : {}),
    }))
    .filter((item) => openPriceItem(item, ownKeys));
}

/**
 * Os itens que a troca de marca procura na base aberta (as marcas que só outras casas compraram), na ordem da lista:
 * os que podem trocar de marca (o mesmo plano da conta, sem as marcas de fora), cada um com o de sempre (a chave e o
 * nome), a medida (kg ou litro), as quantidades por unidade da lista que ele pode pedir nos mercados (a que a lista
 * diz; sem ela, os tamanhos dos pacotes do de sempre, da casa e vistos em outras casas, e, no preço a granel, o pedaço
 * de costume e o 1 kg ou litro), as descrições da própria casa (`aliases`, product_aliases: as dos produtos dela com
 * a mesma chave, que não são outra marca) e a primeira palavra da marca desses produtos (brandHead).
 */
export function brandSearchItems(
  items: readonly Pick<EstimateItem, 'id' | 'name' | 'productId' | 'quantity' | 'unit' | 'category' | 'brandPreferred'>[],
  prices: readonly EstimatePrice[],
  sources: PriceSources,
  aliases: readonly { alias: string; product_id: string }[],
): BrandSearchItem[] {
  const price = itemPricer(prices, { ...sources, brandKeys: undefined });
  const products = new Map((sources.products ?? []).map((product) => [product.id, product]));
  const keyOf = new Map<string, string>();
  const productKey = (productId: string) => {
    let key = keyOf.get(productId);
    if (key === undefined) {
      const product = products.get(productId);
      key = product ? genericItem(product.name, product.category).key : '';
      keyOf.set(productId, key);
    }
    return key;
  };
  const shared = sources.shared ?? [];
  const round = (amount: number) => Math.round(amount * 1e9) / 1e9;
  const found: BrandSearchItem[] = [];
  for (const item of items) {
    const plan = price(item)?.brandPlan();
    if (!plan) continue;
    const { reference, base } = plan;
    const amounts = new Set<number>();
    if (plan.stated) amounts.add(round(plan.stated.amount / plan.stated.units));
    else {
      const own = prices.filter((quote) => quote.productId === reference.id && quote.unitPrice > 0);
      const seen = shared.filter((quote) => quote.productId === reference.id);
      for (const quote of own) {
        const size = quote.unit === 'un' ? quoteSize(quote.description) : null;
        if (size?.unit === base) amounts.add(round(size.amount));
      }
      for (const quote of seen) {
        const size = quote.unit === 'un' ? plainSize(quote.pack) : null;
        if (size?.unit === base) amounts.add(round(size.amount));
      }
      if ([...own, ...seen].some((quote) => pricePerBase(1, quote.unit).unit === base)) {
        amounts.add(1);
        const piece = sources.usual?.get(reference.id)?.[base];
        if (piece != null && piece > 0) amounts.add(round(piece));
      }
    }
    const house = new Set([...plan.sameKey, reference.id]);
    for (const row of aliases) if (productKey(row.product_id) === reference.key) house.add(row.product_id);
    const excludedKeys = [...new Set(aliases.filter((row) => house.has(row.product_id)).map((row) => row.alias))].sort();
    const houseHeads = [
      ...new Set(
        [...house].flatMap((productId) => {
          const product = products.get(productId);
          const head = product ? brandHead(product) : null;
          return head ? [head] : [];
        }),
      ),
    ].sort();
    found.push({
      id: item.id,
      name: item.name,
      category: item.category ?? null,
      quantity: item.quantity,
      unit: item.unit,
      brandPreferred: false,
      referenceKey: reference.key,
      referenceName: reference.name,
      base,
      amounts: [...amounts].sort((a, b) => a - b),
      excludedKeys,
      houseHeads,
    });
  }
  return found;
}

/**
 * As respostas de um plano do "Onde comprar" em quatro partes que somam os preços conhecidos (`knownCount`): pela
 * marca mais barata (toda resposta com `brand`), de outro produto ligado ao nome, de outras casas (sem `brand`) e o
 * resto, os preços reais. Uma resposta de outra marca nunca é "preço real". `anyShared`: alguma resposta usa um preço
 * de outras casas (de outra marca ou não), e o aviso aparece.
 */
export function planPriceCounts(
  assignments: readonly { itemKey: string; storeId: string; kind: 'known' | 'estimated' }[],
  priceAt: (itemKey: string, storeId: string) => StorePrice | null,
): { real: number; otherProduct: number; cheaperBrand: number; shared: number; anyShared: boolean } {
  const counts = { real: 0, otherProduct: 0, cheaperBrand: 0, shared: 0, anyShared: false };
  for (const assignment of assignments) {
    const price = priceAt(assignment.itemKey, assignment.storeId);
    if (price?.shared) counts.anyShared = true;
    if (assignment.kind !== 'known') continue;
    if (price?.brand) counts.cheaperBrand += 1;
    else if (price?.source === 'otherProduct') counts.otherProduct += 1;
    else if (price?.shared) counts.shared += 1;
    else counts.real += 1;
  }
  return counts;
}

/**
 * A estimativa da lista. Com `storeId` ("estou no Assaí"), vale o preço desse
 * mercado; o que a casa não tem de lá é o visto em outras casas nesse mercado
 * ou, sem ele, estimado pelo nível de preço dele; o item sem marca pode sair
 * por outra marca mais barata lá (domain/cheaperBrand). Sem mercado, vale o
 * último preço que a casa pagou em cada item (sem nenhum, o visto em outras
 * casas). Item sem preço nenhum fica fora dos totais.
 */
export function estimateList(
  items: readonly EstimateItem[],
  prices: readonly EstimatePrice[],
  { storeId = null, ...sources }: PriceSources & { storeId?: string | null } = {},
): ListEstimate {
  const index = storePriceIndex(prices);
  // Todas as fontes vão para a regra de preço, as que existem hoje e as que vierem: a mesma de "Onde comprar".
  const price = itemPricer(prices, sources, index);

  const byItem = new Map<string, ItemEstimate>();
  // Todo mercado com nível de preço pode ser escolhido, mesmo sem preço de nota para esta lista. Só esses: o
  // mercado da casa em que só outras casas viram preço (sem nota dela) não entra na escolha.
  const known = new Map<string, number>([...index.keys()].map((store) => [store, 0]));
  for (const item of items) {
    const priced = price(item);
    if (!priced) continue;
    for (const store of priced.stores) if (known.has(store)) known.set(store, known.get(store)! + 1);
    // O mercado onde só outra marca do item tem preço de verdade também conta para ele.
    if (priced.brandPlan()) {
      for (const store of known.keys()) if (!priced.stores.has(store) && priced.at(store)?.brand) known.set(store, known.get(store)! + 1);
    }
    const answer = storeId ? priced.at(storeId) : priced.lastPaid();
    if (!answer) continue;
    const { cost, unitPrice, unit, kind, approximateQuantity, perPiece, productId, used, shared: seen } = answer;
    byItem.set(item.id, {
      cost,
      unitPrice,
      unit,
      kind,
      approximateQuantity,
      ...(perPiece ? { perPiece } : {}),
      ...(answer.historyMissing ? { historyMissing: true } : {}),
      ...(answer.eggs ? { eggs: answer.eggs } : {}),
      productId,
      used,
      ...(seen ? { shared: seen } : {}),
      ...(answer.sameItem ? { sameItem: true } : {}),
      ...(answer.brand ? { brand: answer.brand } : {}),
      ...(answer.perBase ? { perBase: answer.perBase } : {}),
      ...(answer.biggerPack ? { biggerPack: answer.biggerPack } : {}),
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
    brandCount: storeId ? estimates.filter((estimate) => estimate.brand).length : 0,
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

/**
 * A escolha guardada no aparelho (o texto do AsyncStorage), se ainda vale: null quando não há, quando o texto não
 * é uma escolha (guardado por outra versão, estragado) ou quando as 6 horas já passaram.
 */
export function parseStoreChoice(raw: string | null | undefined, now: number = Date.now()): StoreChoice | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const { storeId, at } = value as { storeId?: unknown; at?: unknown };
  if (typeof storeId !== 'string' || !storeId || typeof at !== 'number' || !Number.isFinite(at)) return null;
  const choice = { storeId, at };
  return currentStoreChoice(choice, now) ? choice : null;
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
    ranOut?: readonly {
      name: string;
      productId: string | null;
      lastAt: string;
      everyDays: number;
      /** Os nomes e produtos de cada compra do item (ranOutItems junta as marcas sob o nome sem a marca). */
      boughtAs?: readonly { name: string; productId: string | null }[];
    }[];
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
    // O item acabou com cada nome e produto com que foi comprado ("Leite desnatado" é o IL e o Italac).
    for (const bought of [{ name: gone.name, productId: gone.productId }, ...(gone.boughtAs ?? [])]) {
      const name = normalizeSearch(bought.name);
      keep(bought.productId ? goneProductNames : goneNames, name, latest);
      // O palpite sem produto ("Leite" marcado na lista) é do produto que as notas ligaram a esse nome, quando é um
      // só: vale para as entradas dele e para o item que já o tem. Com dois ligados, não dá para saber qual acabou.
      const linked = bought.productId ? [] : [...new Set(links?.productsFor(bought.name))];
      const productId = bought.productId ?? (linked.length === 1 ? linked[0] : null);
      if (productId) keep(goneProducts, productId, bought.productId ? latest : { ...latest, lent: true });
    }
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

/** "200 g", "1,2 kg", "500 ml": o que a casa costuma levar por vez, em g ou ml abaixo de 1 kg ou 1 litro. */
export function usualAmountLabel({ unit, amount }: UsualAmount): string {
  if (amount < 1) return formatQuantity(Math.round(amount * 1000), unit === 'kg' ? 'g' : 'ml');
  return formatQuantity(amount, unit);
}

/**
 * Quanto o de sempre sai no mercado da outra marca, por kg ou litro: "O de sempre (Arroz Tio João 5kg) sai R$ 4,98/kg
 * aqui.", "… sai R$ 4,30/kg aqui, em preço de outras casas.", "… sairia cerca de R$ 5,20/kg aqui, pelo nível de
 * preço de lá."
 */
function usualSentence(
  usual: CheaperBrand['usual'],
  base: 'kg' | 'l',
  productName?: (productId: string) => string | undefined,
): string {
  const name = productName?.(usual.productId);
  const who = name ? `O de sempre (${name})` : 'O de sempre';
  const label = perBaseLabel({ base, perBase: usual.perBase });
  if (usual.source === 'estimated') return `${who} sairia cerca de ${label} aqui, pelo nível de preço de lá.`;
  if (usual.source === 'shared') return `${who} sai ${label} aqui, em preço de outras casas.`;
  return `${who} sai ${label} aqui.`;
}

/**
 * O pacote mais barato por kg ou litro que não cabe na quantidade: "Por kg, o mais barato aqui é Arroz Prato Fino
 * 5kg, R$ 4,30/kg, 5 kg por R$ 21,50 (de outras casas, visto na semana de 9 nov), mas a conta fica com o tamanho de
 * sempre."
 */
function biggerPackSentence(
  bigger: BiggerPack,
  storeName: (storeId: string) => string | undefined,
  day: (iso: string) => string,
  year: number,
): string {
  const where = bigger.own
    ? [storeName(bigger.own.storeId), day(toISODate(new Date(bigger.own.purchasedAt)))].filter(Boolean).join(', ')
    : bigger.shared
      ? `de outras casas, ${seenLabel(bigger.shared, year)}`
      : '';
  const pack = packPriceLabel(bigger.price);
  return `Por ${bigger.price.base === 'kg' ? 'kg' : 'litro'}, o mais barato aqui é ${bigger.name ?? 'outra marca'}, ${perBaseLabel(bigger.price)}${pack ? `, ${pack}` : ''}${where ? ` (${where})` : ''}, mas a conta fica com ${bigger.stated ? 'o que a lista pede' : 'o tamanho de sempre'}.`;
}

/** "R$ 4,90/kg". O preço por g ou por ml aparece por kg ou por litro: em centavos, R$ 0,0049 por g seria "R$ 0,00/g". */
const perUnit = (unitPrice: number, unit: string) => {
  const base = pricePerBase(unitPrice, unit);
  return `${formatBRL(base.unitPrice)}/${base.unit}`;
};

/** O preço com quantos vinham na embalagem, quando se sabe: "R$ 13,99/un, 10 ovos (R$ 1,40 o ovo)". */
const quoteText = (quote: EstimatePrice, category?: string | null) => {
  const count = countOf(quote);
  const price = perUnit(quote.unitPrice, quote.unit);
  return count ? `${price}, ${packLabel(count, category)} (${perItemLabel(quote.unitPrice, count, category)})` : price;
};

const sameQuote = (a: EstimatePrice, b: EstimatePrice) =>
  a.productId === b.productId && a.storeId === b.storeId && a.unit === b.unit && a.unitPrice === b.unitPrice && a.purchasedAt === b.purchasedAt;

/**
 * Como o custo do item aparece na lista: "~" quando é estimado, a quantidade é aproximada, o preço é de outro
 * produto do mesmo nome ou outra marca do mesmo item, é o visto em outras casas (não é em tempo real) ou o produto
 * é o da casa do mesmo item, para o item que não diz qual (`sameItem`).
 */
export function formatItemCost(
  estimate: Pick<ItemEstimate, 'cost' | 'kind' | 'approximateQuantity' | 'productId' | 'used' | 'shared' | 'sameItem'>,
): string {
  const otherProduct = estimate.used != null && estimate.productId != null && estimate.used.productId !== estimate.productId;
  const rough =
    estimate.kind === 'estimated' || estimate.approximateQuantity || otherProduct || estimate.shared != null || estimate.sameItem === true;
  return `${rough ? '~' : ''}${formatBRL(estimate.cost)}`;
}

/**
 * A marca no quadrinho do item, embaixo do preço: o nome curto do produto da casa ("Prato Fino 5kg", brandTileName)
 * ou "outra marca" (a que só outras casas compraram), com " ×5" quando a conta usa pacotes que não são as unidades
 * da lista ("Camil 1kg ×5"). null sem outra marca.
 */
export function brandTileText(estimate: Pick<ItemEstimate, 'brand' | 'perBase'> | undefined): string | null {
  const brand = estimate?.brand;
  if (!brand) return null;
  const name = brand.name ? brandTileName(brand.name, brand.category) : 'outra marca';
  const packages = estimate.perBase?.sayQuantity ? estimate.perBase.packages : null;
  return packages != null ? `${name} ×${packages}` : name;
}

/**
 * O mesmo para o leitor de tela, depois do preço: "pela marca mais barata: Arroz Camil 1kg, 5 pacotes",
 * "pela marca mais barata: outra marca, de outras casas". null sem outra marca.
 */
export function brandSpoken(estimate: Pick<ItemEstimate, 'brand' | 'perBase' | 'shared'> | undefined): string | null {
  const brand = estimate?.brand;
  if (!brand) return null;
  const packages = estimate.perBase?.sayQuantity ? estimate.perBase.packages : null;
  return [
    `pela marca mais barata: ${brand.name ?? 'outra marca'}`,
    ...(packages != null ? [`${packages} ${packages === 1 ? 'pacote' : 'pacotes'}`] : []),
    ...(estimate.shared ? ['de outras casas'] : []),
  ].join(', ');
}

/**
 * A quantidade dos ovos pedidos em ovos: "~12 ovos a R$ 0,70 o ovo" quando a cartela do preço diz quantos vêm, ou
 * "1 cartela (sem saber quantos ovos vêm nela)": a nota que não disse, o preço de outras casas ou o estimado.
 */
function eggsNote(eggs: NonNullable<ItemEstimate['eggs']>, unitPrice: number | undefined): string {
  if (eggs.pack != null && unitPrice != null) return `~${packLabel(eggs.count, 'ovos')} a ${perItemLabel(unitPrice, eggs.pack, 'ovos')}`;
  return '1 cartela (sem saber quantos ovos vêm nela)';
}

/** O texto da nota e, depois de vírgula, a quantidade que a conta usou (quando não é a da lista). */
const withNote = (text: string, note: string | null) => (note ? `${text}, ${note}` : text);

/**
 * A quantidade que a conta usou, quando não é a da lista: o costume ("~201 g (o que a casa costuma levar)") ou, sem
 * ele, 1 kg, 1 litro ou 1 unidade (e, se o histórico de compras não carregou, diz isso). null quando é a da lista.
 */
function countedNote(
  price: Partial<Pick<StorePrice, 'approximateQuantity' | 'perPiece' | 'unit' | 'unitPrice' | 'historyMissing' | 'eggs'>>,
): string | null {
  if (price.perPiece) return `~${usualAmountLabel(price.perPiece)} (o que a casa costuma levar)`;
  if (price.eggs) return eggsNote(price.eggs, price.unitPrice);
  if (!price.approximateQuantity) return null;
  const base = pricePerBase(1, price.unit ?? '').unit;
  const counted = base === 'kg' ? '1 kg' : base === 'l' ? '1 litro' : '1 unidade';
  return `${counted} (${price.historyMissing ? 'o histórico de compras não carregou' : 'quantidade em outra unidade'})`;
}

/** "Preço por kg" e "Preço por litro" para o que é por peso ou volume; "Preço por unidade da nota", para o resto. */
function priceHead(unit: string): string {
  const base = pricePerBase(1, unit).unit;
  return `Preço por ${base === 'kg' ? 'kg' : base === 'l' ? 'litro' : 'unidade da nota'}`;
}

/**
 * A linha da outra marca no "Onde comprar": "Mais barato aqui: Arroz Camil 1kg", "Mais barato aqui: Arroz Prato Fino
 * 5kg, de outras casas, visto na semana de 9 nov", "Mais barato aqui: outra marca, de outras casas, visto na semana de
 * 9 nov". null sem outra marca.
 */
function brandRowNote(price: Pick<StorePrice, 'brand' | 'shared'>, referenceYear?: number): string | null {
  if (!price.brand) return null;
  const name = price.brand.name ?? 'outra marca';
  return price.shared ? `Mais barato aqui: ${name}, de outras casas, ${seenLabel(price.shared, referenceYear)}` : `Mais barato aqui: ${name}`;
}

/**
 * A nota da linha de um item em "Onde comprar", da mesma resposta que dá o
 * custo (listStorePrices): outra marca mais barata lá (qual), estimado, de
 * outras casas (com a semana em que foi visto), de outro produto ligado ao
 * nome (qual, quando `productName` sabe), do produto da casa do mesmo item
 * (qual) ou do próprio produto em outra unidade. Com quantidade que não é a da
 * lista, diz qual foi: os pacotes inteiros ("5 pacotes de 1 kg") ou
 * countedNote. null para o preço de nota do próprio produto, na quantidade da
 * lista: nada a avisar.
 */
export function storePriceNote(
  price: Pick<
    StorePrice,
    | 'source'
    | 'approximateQuantity'
    | 'perPiece'
    | 'unit'
    | 'unitPrice'
    | 'used'
    | 'shared'
    | 'historyMissing'
    | 'eggs'
    | 'brand'
    | 'perBase'
    | 'sameItem'
    | 'productId'
  >,
  productName?: (productId: string) => string | undefined,
  referenceYear?: number,
): string | null {
  const packages = price.perBase ? quantityShort(price.perBase) : null;
  const counted = packages ?? countedNote(price);
  const brand = brandRowNote(price, referenceYear);
  if (brand) return withNote(brand, counted);
  if (price.source === 'estimated') return withNote('Estimado pelo nível de preço do mercado', counted);
  if (price.shared) {
    return withNote(`Preço de outras casas${openSizeNote(price.shared.open)}, ${seenLabel(price.shared, referenceYear)}`, counted);
  }
  if (price.source === 'otherProduct') {
    return withNote(`Preço de ${(price.used && productName?.(price.used.productId)) || 'outro produto com esse nome'}`, counted);
  }
  if (price.sameItem) {
    const name = price.productId ? productName?.(price.productId) : undefined;
    return withNote(name ? `Preço de ${name}, o mesmo item` : 'Preço de outro produto do mesmo item', counted);
  }
  if (packages) return packages;
  return counted ? `${priceHead(price.unit)}, ${counted}` : null;
}

/**
 * A linha do item que só tem preço de outras casas, em "Onde comprar": de
 * que mercado (o nome que a casa conhece, quando é dela), de que dia e, quando
 * a conta usa outra quantidade, qual.
 */
export function sharedOnlyNote(
  price: Pick<StorePrice, 'shared'> &
    Partial<Pick<StorePrice, 'approximateQuantity' | 'perPiece' | 'unit' | 'unitPrice' | 'historyMissing' | 'eggs'>>,
  storeName: (storeId: string) => string | undefined = () => undefined,
  referenceYear?: number,
): string {
  const seen = price.shared;
  if (!seen) return 'Só há preço de outras casas';
  const place = (seen.storeId ? storeName(seen.storeId) : undefined) ?? sharedStoreLabel(seen);
  return withNote(`Só há preço de outras casas${openSizeNote(seen.open)}: ${place}, ${seenLabel(seen, referenceYear)}`, countedNote(price));
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
 * Qual produto "Ver preços" abre nos detalhes de um item da lista. Com preço,
 * o produto de onde o preço sai (`pricedProductId`, da estimativa). Sem preço,
 * o produto do próprio item; sem ele, o produto que as notas ligaram a esse
 * nome, quando é um só: "Leite" ligado ao Italac e ao Ninho não diz qual abrir.
 * Item sem produto nenhum não tem preço a ver (null).
 */
export function seePricesProduct(
  item: Pick<EstimateItem, 'name' | 'productId'>,
  pricedProductId: string | null | undefined,
  links?: LinkIndex | null,
): string | null {
  if (pricedProductId) return pricedProductId;
  if (item.productId) return item.productId;
  const linked = [...new Set(links?.productsFor(item.name) ?? [])];
  return linked.length === 1 ? linked[0] : null;
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
    Partial<Pick<ListEstimate, 'sharedCount' | 'sharedTotal' | 'brandCount'>>,
  storeName: string | null,
): string {
  const { itemCount, pricedCount, estimatedCount, approximateCount, sharedCount = 0, sharedTotal = 0, brandCount = 0 } = estimate;
  const missing = itemCount - pricedCount;
  const clauses = [
    missing === 0 ? 'todos os itens têm preço' : `${pricedCount} de ${itemCount} itens ${pricedCount === 1 ? 'tem' : 'têm'} preço`,
    ...(storeName && estimatedCount
      ? [`${estimatedCount} ${estimatedCount === 1 ? 'é estimado' : 'são estimados'} pelo nível de preço de lá`]
      : []),
    // No mercado escolhido, os itens que saem por outra marca, mais barata lá (domain/cheaperBrand).
    ...(storeName && brandCount ? [`${brandCount} ${brandCount === 1 ? 'sai' : 'saem'} pela marca mais barata de lá`] : []),
    // Quanto do total não é preço da casa: o visto em outras casas, onde ela não tem preço.
    ...(sharedCount
      ? [`${formatBRL(sharedTotal)} do total ${sharedCount === 1 ? 'é de 1 item' : `são de ${sharedCount} itens`} com preço de outras casas`]
      : []),
    ...(approximateCount ? [`em ${approximateCount} a quantidade é aproximada (o preço é por kg ou por unidade)`] : []),
  ].join('; ');
  const left = missing === 0 ? '' : missing === 1 ? ' O outro fica fora da conta.' : ` Os outros ${missing} ficam fora da conta.`;
  if (!storeName) {
    // De onde sai a conta sem mercado escolhido: o que a casa pagou, o visto em outras casas onde ela não tem preço,
    // ou só o visto em outras casas (a primeira compra).
    const from =
      sharedCount === 0
        ? 'Pelo último preço que a casa pagou em cada item'
        : sharedCount < pricedCount
          ? 'Pelo último preço que a casa pagou em cada item e, onde ela não tem preço, pelo visto em outras casas'
          : 'Pelo preço visto em outras casas, porque a casa ainda não pagou por estes itens';
    return `${from}; ${clauses}.${left}`;
  }
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

// O cartão da conta, antes da lista, fica recolhido numa linha: o quanto deve dar e o "i" que abre, ali mesmo, o
// resto (de onde sai a conta, os preços de outras casas, o que não deu para conferir, carrinho e falta comprar,
// "Onde estou" e a despensa). A linha recolhida não pode deixar o número ser lido errado: diz o lugar escolhido e
// que há preço de outras casas na conta.

/** O "i" do cartão da conta, para o leitor de tela (que também diz se está aberto). */
export const ESTIMATE_MORE_LABEL = 'Mais sobre a conta da lista';

/**
 * O que a linha recolhida diz embaixo do total, para ele não ser lido errado: o lugar escolhido (a conta é a de lá,
 * não a do último preço) e, com preço de outras casas na conta, que ela os inclui (o aviso inteiro, de que não são
 * em tempo real, fica no "i"). null quando não há o que dizer.
 */
export function estimateMarker(
  estimate: Partial<Pick<ListEstimate, 'sharedCount' | 'brandCount'>>,
  storeName: string | null,
): string | null {
  const brands = estimate.brandCount ?? 0;
  const parts = [
    ...(storeName ? [`Lugar escolhido: ${storeName}`] : []),
    ...(storeName && brands ? [`${brands} ${brands === 1 ? 'item' : 'itens'} pela marca mais barata`] : []),
    ...(estimate.sharedCount ? [storeName ? 'inclui preços de outras casas' : 'Inclui preços de outras casas'] : []),
  ];
  return parts.length ? parts.join(' · ') : null;
}

/** Quantos itens diferentes da lista estão na despensa (sem ligar para maiúscula ou acento, como describePantryHits). */
const pantryCount = (names: readonly string[]) => new Set(names.map(normalizeSearch).filter(Boolean)).size;

/**
 * A linha recolhida quando nenhum item tem preço: só o que o cartão tem a dizer, curto (os preços que não deu para
 * conferir, quantos itens estão na despensa). null quando não há nada (o cartão nem aparece).
 */
export function estimateShortLine({ unchecked, inPantry }: { unchecked: boolean; inPantry: readonly string[] }): string | null {
  const count = pantryCount(inPantry);
  const pantry = count ? `${count === 1 ? '1 item da lista está' : `${count} itens da lista estão`} na despensa.` : null;
  if (unchecked) return pantry ? `Não deu para conferir os preços. ${pantry}` : 'Não deu para conferir os preços.';
  return pantry;
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
    category,
    canPreferBrand = false,
  }: {
    storeName: (storeId: string) => string | undefined;
    chosenStore?: string | null;
    promotionOnly?: boolean;
    today?: string;
    productName?: (productId: string) => string | undefined;
    /** A categoria do item: ovos se contam em ovos ("10 ovos, R$ 1,40 o ovo"). */
    category?: string | null;
    /** O item tem a "Marca preferida" para escolher (um produto com marca): dá para ficar com o de sempre. */
    canPreferBrand?: boolean;
  },
): string[] {
  const year = Number(today.slice(0, 4));
  const day = (iso: string) => formatShortDate(iso, year);
  const place = (quote: Pick<EstimatePrice, 'storeId' | 'purchasedAt'>) =>
    [storeName(quote.storeId), day(toISODate(new Date(quote.purchasedAt)))].filter(Boolean).join(', ');
  const where = (quote: EstimatePrice) => `(${place(quote)})`;
  const facts: string[] = [];
  if (estimate) {
    const { last, lowest, used, unit, shared, brand, perBase, biggerPack } = estimate;
    // Com um mercado só, o menor é o próprio último preço: não é referência de promoção. O menor sai de lowestOf: se não
    // é o último, é outra cotação, a que vence a comparação (por ovo, quando as duas cartelas dizem quantos vêm).
    const cheaper = last != null && lowest != null && !sameQuote(lowest, last);
    if (last) facts.push(`Último preço: ${quoteText(last, category)} ${where(last)}.`);
    if (cheaper) facts.push(`Menor preço: ${quoteText(lowest, category)} ${where(lowest)}.`);
    // O item que não diz o produto: qual produto da casa a conta usa.
    if (estimate.sameItem) {
      const name = estimate.productId ? productName?.(estimate.productId) : undefined;
      facts.push(
        name
          ? `A lista não diz o produto: a conta usa ${name}, o mesmo item que a casa comprou por último.`
          : 'A lista não diz o produto: a conta usa o mesmo item que a casa comprou por último.',
      );
    }
    if (brand && perBase) {
      // Outra marca, mais barata lá: qual, por kg ou litro, de onde, quanto sai o de sempre e quantos pacotes.
      const pack = packPriceLabel(perBase);
      const from = used ? where(used) : shared ? `(de outras casas, ${seenLabel(shared, year)})` : '';
      facts.push(`Mais barato aqui: ${brand.name ?? 'outra marca'}, ${perBaseLabel(perBase)}${pack ? `, ${pack}` : ''}${from ? ` ${from}` : ''}.`);
      if (!brand.name) facts.push(KEY_BRAND_FACT);
      facts.push(usualSentence(brand.usual, perBase.base, productName));
      const packages = quantitySentence(perBase);
      if (packages) facts.push(packages);
      if (canPreferBrand) facts.push(BRAND_OPT_OUT);
      if (shared) facts.push(SHARED_PRICES_NOTICE);
    } else if (shared) {
      // A casa não tem preço do item ali (ou em lugar nenhum): o de outras casas, com o mercado, a semana e o aviso. Da
      // base aberta, também o que esse preço é e o tamanho que a conta usou, quando o app escolheu.
      const place = (shared.storeId ? storeName(shared.storeId) : undefined) ?? sharedStoreLabel(shared);
      facts.push(`Preço de outras casas na conta: ${perUnit(shared.unitPrice, shared.unit)} (${place}, visto na semana de ${day(shared.seenWeek)}).`);
      if (shared.open) {
        facts.push(OPEN_PRICE_FACT);
        const size = estimate.eggs ? null : openSizeFact(shared.open, shared.unit);
        if (size) facts.push(size);
      }
      facts.push(SHARED_PRICES_NOTICE);
    } else if (!used) {
      const place = chosenStore ? storeName(chosenStore) : undefined;
      facts.push(
        `${place ? `${place}: a` : 'A'} casa ainda não comprou este item lá; cerca de ${perUnit(estimate.unitPrice, unit)}, pelo nível de preço de lá.`,
      );
    } else if (!last || !sameQuote(used, last)) {
      // No mercado escolhido, o preço da conta não é o último pago: diz qual foi, de onde e de quando.
      const other = used.productId === estimate.productId ? '' : `, de ${productName?.(used.productId) ?? 'outro produto com esse nome'}`;
      facts.push(`Preço usado na conta: ${quoteText(used, category)}${other} ${where(used)}.`);
    }
    // O de sempre em pacotes inteiros da quantidade que a lista diz ("Arroz 5kg" onde a casa compra o de 1 kg).
    const packages = !brand && perBase ? quantitySentence(perBase) : null;
    if (packages) facts.push(packages);
    if (biggerPack) facts.push(biggerPackSentence(biggerPack, (storeId) => storeName(storeId), day, year));
    if (promotionOnly && cheaper) {
      // Com a contagem, o preço bom sai por ovo primeiro, e a cartela vai entre parênteses.
      const count = countOf(lowest);
      const good = count
        ? `${perItemLabel(lowest.unitPrice, count, category)} ou menos (${perUnit(lowest.unitPrice, lowest.unit)}, ${packLabel(count, category)})`
        : `${quoteText(lowest, category)} ou menos`;
      facts.push(`Só em promoção: o preço bom é ${good}.`);
    }
    if (estimate.eggs) {
      // Ovos pedidos em ovos: pelo preço de cada ovo da cartela do preço, ou, sem saber quantos vêm nela, uma cartela.
      const { count, pack } = estimate.eggs;
      facts.push(
        pack != null
          ? `A lista pede ${packLabel(count, 'ovos')}: a conta usa ${perItemLabel(estimate.unitPrice, pack, 'ovos')}, da cartela de ${pack}.`
          : `A lista pede ${packLabel(count, 'ovos')}, e não se sabe quantos vêm na cartela do preço: a conta usa 1 cartela.`,
      );
    } else if (estimate.perPiece) {
      // Item em "un" com preço por kg: a conta usa o que a casa costuma levar dele de uma vez (usualAmounts).
      const counted = pricePerBase(1, unit).unit;
      facts.push(`O preço é por ${counted}: a conta da lista usa ${usualAmountLabel(estimate.perPiece)}, o que a casa costuma levar de uma vez.`);
    } else if (estimate.approximateQuantity) {
      // A conta é de 1 kg, 1 litro ou 1 unidade (units, priceQuantity): com o preço por g, de 1 kg, como o preço aparece.
      // Sem o costume porque o histórico de compras não carregou, diz isso.
      const counted = pricePerBase(1, unit).unit;
      const why = estimate.historyMissing ? ' (o histórico de compras não carregou)' : '';
      facts.push(`O preço é por ${counted}: a conta da lista usa 1 ${counted}${why}.`);
    }
  }
  if (hit) {
    const amount = hit.quantity != null && hit.unit ? `${formatQuantity(hit.quantity, hit.unit)} de ` : '';
    const expiry = hit.expiresOn ? `; vence em ${day(hit.expiresOn)}` : '';
    facts.push(`Na despensa desde ${day(hit.since)}: ${amount}${hit.name}${expiry}.`);
  }
  return facts;
}
