// A marca mais barata (decisão do dono de 21/11/2026: "para um item sem marca,
// como 'Arroz', usar e mostrar a marca com o menor preço por kg ou litro no
// mercado escolhido, na conta e no 'Onde comprar'; os preços de outras casas
// também contam"). Aqui ficam as regras de quem pode trocar de marca, do que é
// o mesmo item, do tamanho e dos pacotes inteiros, a busca na base aberta das
// marcas que só outras casas compraram, e os textos curtos. A disputa em si
// mora dentro da regra de preço da lista (itemPricer, em domain/listEstimate):
// assim a lista com o mercado escolhido e cada linha do "Onde comprar" seguem
// sendo uma conta só.
//
// O que a regra nunca faz (na dúvida, o item fica com a resposta de hoje):
// - compara dois itens diferentes (a chave sem marca do produto de sempre, o
//   "mesmo" da revisão da nota, as marcas de outro produto: quebrado, tipo 2,
//   cabra…, e a faixa em volta do preço que a casa pagou);
// - compara preço de pacote de tamanho desconhecido (só por kg ou litro: a
//   granel, ou o pacote de peso ou volume lido na descrição: packagePrice);
// - mexe no item que pede marca ("Marca preferida", ou a marca no nome);
// - dá preço a item que hoje não tem (só troca uma resposta que já existe);
// - põe na conta um pacote maior que o pedido (pacotes inteiros; o maior que
//   sai mais barato por kg só aparece nos detalhes);
// - mostra a descrição da nota de outra casa (a marca que só outras casas
//   compraram é "outra marca").

import { genericItem } from './genericItem';
import { formatBRL, formatQuantity } from './money';
import { LOOSE_UNITS, PACKAGING, singular } from './nameWords';
import {
  brandFreeItemKey,
  EXTRA_SEARCH_CALLS,
  groupSignature,
  itemFits,
  keyPackageSize,
  OPEN_KEYS_PER_ENTRY,
  OPEN_MAX_ENTRIES,
  restorePackMark,
  type OpenKeysAnswer,
  type OpenPricesAnswer,
  type OpenSearchItem,
  type OpenSearchPlan,
  type SharedItemKey,
} from './openPrices';
import { comparablePrice, packagesFor, plainSize, type ComparablePrice } from './packagePrice';
import { samePackageSize, sharedPackageSize, type PackageSize } from './packageSize';
import { spelledOut } from './sameItem';
import { guessCategory } from './search';
import { sharedPack, sharedRowOf, type SharedQuote, type StoreCnpj } from './sharedPrices';

/**
 * As categorias em que o item sem marca pode sair por outra marca. Fora: hortifruti, carnes e peixes (lá a "marca"
 * é a variedade, o corte ou a classificação, que o leitor deixa de lado: "CARNE MOIDA 2A" é lida como "Carne
 * moída"), ovos (a regra da cartela), papel (vendido por rolo e folha, sem kg nem litro), higiene, bebê, pet,
 * outros, remédios e suplementos.
 */
export const BRAND_CATEGORIES: readonly string[] = [
  'laticinios',
  'padaria',
  'graos',
  'congelados',
  'frios',
  'doces',
  'snacks',
  'temperos',
  'oleos',
  'bebidas',
  'alcoolicas',
  'cafe_cha',
  'limpeza',
];

/**
 * A faixa em volta do preço por kg ou litro que a casa pagou pelo de sempre (o centro): outra marca só concorre
 * entre a metade e o dobro dele (withinBand). Fora disso, quase sempre é outro produto ou um tamanho mal lido.
 */
export const BRAND_PRICE_BAND = 2;
/** Quantos tamanhos de pacote, por item, a busca na base aberta pergunta (além do a granel). */
export const BRAND_KEY_SIZES = 4;
/** Chamadas a mais, de cada passo da base aberta, para as marcas: 80 buscas e 80 grupos por lista. */
export const BRAND_MAX_CALLS = EXTRA_SEARCH_CALLS;

const LIST_UNITS = new Set(['un', 'g', 'kg', 'ml', 'l']);

/** De onde vem o preço de um item da lista num mercado (domain/listEstimate, StorePriceSource). */
export type StorePriceSourceName =
  /** Do produto do item, na unidade de sempre. */
  | 'product'
  /** Do produto do item, em outra unidade (a quantidade pode sair aproximada). */
  | 'otherUnit'
  /** De outro produto ligado ao mesmo nome: o custo é aproximado. */
  | 'otherProduct'
  /** Outro produto da casa, o mesmo item de outra marca, que sai mais barato lá na quantidade da lista. */
  | 'cheaperBrand'
  /** A casa não tem o item nas notas de lá: é o preço visto em outras casas (`shared`). */
  | 'shared'
  /** O mercado não tem o item nas notas: sai do nível de preço dele. */
  | 'estimated';

const SIZES = new Map<string, PackageSize | null>();
const SIZES_LIMIT = 5000;

/**
 * O tamanho de um preço da casa, pela descrição da nota (latest_prices.raw_description): a leitura estrita
 * (sharedPackageSize, a mesma de quando o tamanho vai para a base) e só peso ou volume de um pacote (plainSize).
 * null sem descrição ou na dúvida ("CERV 350ML C/12", "OVOS C/12").
 */
export function quoteSize(description: string | null | undefined): PackageSize | null {
  if (!description) return null;
  // A conta lê as mesmas descrições a cada mercado e a cada item: a leitura fica guardada.
  const known = SIZES.get(description);
  if (known !== undefined) return known;
  const size = plainSize(sharedPackageSize(description));
  if (SIZES.size >= SIZES_LIMIT) SIZES.clear();
  SIZES.set(description, size);
  return size;
}


/**
 * A chave sem marca do item da lista que pode sair por outra marca (genericItem: "i:arroz"), ou null: "Marca
 * preferida" ligada, marca no nome ("Café Pilão", "Arroz Tio João"; também a palavra de outro produto que o leitor
 * toma por marca, "Arroz pronto"), categoria fora de BRAND_CATEGORIES (ou sem categoria), ou quantidade que não é
 * maior que zero em un, g, kg, ml ou l.
 */
export function brandFreeKey(item: {
  name: string;
  category?: string | null;
  brandPreferred?: boolean;
  quantity: number;
  unit: string;
}): string | null {
  if (!item.category || !BRAND_CATEGORIES.includes(item.category)) return null;
  if (!(item.quantity > 0) || !LIST_UNITS.has(item.unit)) return null;
  return brandFreeItemKey(item);
}

// Não são a marca: os conectivos, o "tipo" e as palavras que descrevem qualquer marca ("Arroz Branco Camil",
// "Café Tradicional Pilão"). Uma palavra a mais aqui só deixa de tirar descrições da busca; uma a menos tiraria todas
// as que a têm ("ARROZ BRANCO T1 KICALDO").
const BRAND_SKIP = new Set([
  'de', 'da', 'do', 'das', 'dos', 'em', 'com', 'e', 'a', 'o', 'ao', 'para', 'sem', 'tipo', 'tp', 'branco', 'branca',
  'tradicional', 'original', 'classico', 'classica', 'comum', 'puro', 'pura', 'extra', 'especial', 'novo', 'nova',
]);
const words = (text: string) => spelledOut(text).split(' ').filter(Boolean);

/**
 * A primeira palavra da marca de um produto da casa: a primeira do nome que não é do nome sem marca (genericItem),
 * nem tamanho, embalagem, unidade, conectivo, "tipo" ou palavra que descreve qualquer marca ("branco", "tradicional").
 * "Arroz Tio João 5kg" é "tio"; "Leite Integral Italac 1L",
 * "italac"; null quando o nome não tem marca ("Arroz 5kg", "Refrigerante Coca-Cola 2l", onde a Coca é o sabor). A
 * descrição da base aberta com essa palavra é o produto da própria casa.
 */
export function brandHead(product: { name: string; category?: string | null }): string | null {
  const generic = new Set(words(genericItem(product.name, product.category).name).map(singular));
  for (const word of words(product.name)) {
    const one = singular(word);
    if (generic.has(one) || generic.has(word) || /\d/.test(word) || BRAND_SKIP.has(word)) continue;
    if (PACKAGING.has(word) || PACKAGING.has(one) || LOOSE_UNITS.has(word)) continue;
    return word;
  }
  return null;
}

/**
 * Outra marca é o mesmo item da lista: o mesmo item sem marca do produto de sempre (a chave de genericItem, com os
 * tipos que a casa compra: o "Leite" comprado integral compara só leite integral), o `mesmo` da revisão da nota com o
 * item da lista (o tamanho e os tipos que a lista diz contam: "Arroz 5kg" não leva o pacote de 1 kg) e as marcas de
 * outro produto (quebrado, tipo 2, cabra, lata…) só as que a lista ou o de sempre têm, e todas as do de sempre
 * (itemFits, de domain/openPrices, com o resultado guardado).
 */
export function candidateFits(
  item: { name: string; category?: string | null },
  reference: { key: string; name: string },
  candidate: { name: string; category: string | null },
): boolean {
  return genericItem(candidate.name, candidate.category).key === reference.key && itemFits(item, candidate, reference.name);
}

/** A descrição da base como candidata: com a caixa de volta e a categoria que o app adivinha dela. */
export function keyCandidate(key: string): { name: string; category: string | null } {
  const name = restorePackMark(key);
  return { name, category: guessCategory(name, { abbreviated: true }) };
}

/** A outra marca que entrou na conta. */
export interface CheaperBrand {
  /** O nome do produto da casa; null: "outra marca", uma que só outras casas compraram. */
  name: string | null;
  /** A categoria desse produto (o nome curto do quadrinho, brandTileName); null na outra marca. */
  category: string | null;
  productId: string | null;
  /** O de sempre nesse mercado: o produto, o preço por kg ou litro e de onde ele vinha. */
  usual: { productId: string; perBase: number; source: StorePriceSourceName };
}

/** A conta por kg ou litro: o preço, a quantidade (na base) e, em pacotes inteiros, quantos. */
export interface PerBaseCost extends ComparablePrice {
  amount: number;
  packages: number | null;
  /** Os detalhes e a linha dizem quantos pacotes (a lista não é em "un", ou os pacotes não são as unidades dela). */
  sayQuantity: boolean;
}

/** O pacote mais barato por kg que não cabe na quantidade pedida: só dito nos detalhes, nunca na conta. */
export interface BiggerPack {
  name: string | null;
  price: ComparablePrice;
  own: { storeId: string; purchasedAt: string } | null;
  shared: SharedQuote | null;
  /** A lista disse a quantidade (kg, l, ou o tamanho no nome); senão, a conta fica com o tamanho de sempre. */
  stated: boolean;
}

// ---------------------------------------------------------------------------
// A base aberta: as marcas que só outras casas compraram

/** O item que a troca de marca procura na base aberta (listEstimate, brandSearchItems). */
export interface BrandSearchItem extends OpenSearchItem {
  brandPreferred: false;
  /** A chave sem marca do produto de sempre e o nome dele. */
  referenceKey: string;
  referenceName: string;
  base: 'kg' | 'l';
  /** As quantidades por unidade da lista que o item pode pedir nos mercados, na base: para escolher os tamanhos úteis. */
  amounts: number[];
  /** As descrições de nota (product_aliases) dos produtos da casa com a chave do de sempre: são da própria casa. */
  excludedKeys: string[];
  /** A primeira palavra da marca (brandHead) desses produtos, o de sempre também. */
  houseHeads: string[];
}

/** Um grupo de descrições do mesmo tamanho (ou a peso), para um ou mais itens: a mesma forma dos grupos da base aberta. */
export interface BrandGroup {
  signature: string;
  keys: string[];
  weightOnly: string[];
  expected: PackageSize | null;
  items: { id: string; base: 'kg' | 'l'; size: PackageSize | null; referenceKey: string }[];
  /** 0 a peso; 1, 2, 3, 4 os tamanhos, do mais visto ao menos visto: o primeiro tamanho de cada item vai antes do segundo de qualquer um. */
  rank: number;
}

/** Um preço da base aberta de outra marca, num mercado da casa, pronto para a conta (por kg ou litro). */
export interface BrandKeyQuote {
  storeId: string;
  /** O preço como os de outras casas aparecem (productId null; sem `open`: não é o preço do item sem preço). */
  quote: SharedQuote;
  price: ComparablePrice;
  /** A assinatura do grupo: a identidade da outra marca na disputa. */
  group: string;
  /** A chave do de sempre para que o grupo foi feito: outra chave, outra disputa. */
  referenceKey: string;
}

const WEIGHT_UNITS: Record<'kg' | 'l', readonly string[]> = { kg: ['kg', 'g'], l: ['l', 'ml'] };

/** As chaves do grupo, no máximo OPEN_KEYS_PER_ENTRY (as da semana mais nova, as mais vistas), em ordem e sem repetir. */
function capped(keys: readonly SharedItemKey[]): string[] {
  const best = [...keys].sort((a, b) =>
    a.week !== b.week ? (a.week < b.week ? 1 : -1) : b.seen - a.seen || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  const chosen: string[] = [];
  for (const key of best) {
    if (chosen.length >= OPEN_KEYS_PER_ENTRY) break;
    if (!chosen.includes(key.key)) chosen.push(key.key);
  }
  return chosen.sort();
}

/**
 * Os grupos de descrições das marcas que só outras casas compraram. Para cada item: as descrições da busca dele (em
 * todas as respostas), menos as da própria casa (as descrições dos produtos dela com a mesma chave, e as que têm a
 * primeira palavra da marca de um deles: "ARROZ T1 TIO JOAO 5KG"), só as que são o mesmo item (candidateFits). As
 * vendidas a peso (na medida do item: kg e g, ou l e ml) formam um grupo; as por unidade com um pacote de peso ou
 * volume na medida do item (keyPackageSize), um grupo por tamanho, só os tamanhos que cabem inteiros numa quantidade
 * que o item pode pedir, os BRAND_KEY_SIZES mais vistos (Σ seen; no empate, o menor, depois o rótulo). Grupos com as
 * mesmas descrições e o mesmo tamanho viram um.
 */
export function brandKeyGroups(items: readonly BrandSearchItem[], answers: readonly OpenKeysAnswer[], plan: OpenSearchPlan): BrandGroup[] {
  const keysOf = new Map<string, Map<string, SharedItemKey>>();
  for (const answer of answers) {
    answer.entries.forEach((signature, at) => {
      const known = keysOf.get(signature) ?? new Map<string, SharedItemKey>();
      for (const key of answer.keys[at] ?? []) known.set(`${key.key}\u0000${key.unit}`, key);
      keysOf.set(signature, known);
    });
  }
  const groups = new Map<string, BrandGroup>();
  const add = (keys: string[], weightOnly: string[], expected: PackageSize | null, rank: number, entry: BrandGroup['items'][number]) => {
    const signature = groupSignature(keys, weightOnly, expected);
    const group = groups.get(signature) ?? { signature, keys, weightOnly, expected, items: [], rank };
    group.rank = Math.min(group.rank, rank);
    if (!group.items.some((other) => other.id === entry.id)) group.items.push(entry);
    groups.set(signature, group);
  };
  for (const item of items) {
    const signature = plan.entryOf.get(item.id);
    if (!signature) continue;
    const excluded = new Set(item.excludedKeys);
    const heads = new Set(item.houseHeads);
    const reference = { key: item.referenceKey, name: item.referenceName };
    const kept = [...(keysOf.get(signature)?.values() ?? [])].filter(
      (key) =>
        !excluded.has(key.key) &&
        !words(restorePackMark(key.key)).some((word) => heads.has(word) || heads.has(singular(word))) &&
        candidateFits(item, reference, keyCandidate(key.key)),
    );
    const entry = (size: PackageSize | null) => ({ id: item.id, base: item.base, size, referenceKey: item.referenceKey });
    const weight = kept.filter((key) => WEIGHT_UNITS[item.base].includes(key.unit));
    if (weight.length) add([], capped(weight), null, 0, entry(null));
    const sized = new Map<string, { size: PackageSize; keys: SharedItemKey[]; seen: number }>();
    for (const key of kept) {
      if (key.unit !== 'un') continue;
      const size = plainSize(keyPackageSize(key.key));
      if (!size || size.unit !== item.base || !item.amounts.some((amount) => packagesFor(amount, 1, size) != null)) continue;
      const group = sized.get(size.label) ?? { size, keys: [], seen: 0 };
      group.keys.push(key);
      group.seen += key.seen;
      sized.set(size.label, group);
    }
    [...sized.values()]
      .sort((a, b) => b.seen - a.seen || a.size.amount - b.size.amount || (a.size.label < b.size.label ? -1 : a.size.label > b.size.label ? 1 : 0))
      .slice(0, BRAND_KEY_SIZES)
      .forEach((group, at) => add(capped(group.keys), [], group.size, at + 1, entry(group.size)));
  }
  return [...groups.values()];
}

/**
 * As chamadas do passo 2 para as marcas: os grupos que a base aberta ainda não pede (`asked`, as assinaturas dos
 * grupos dela), pelo rank e depois pela assinatura, em chamadas de OPEN_MAX_ENTRIES, no máximo BRAND_MAX_CALLS.
 */
export function brandGroupCalls(groups: readonly BrandGroup[], asked: ReadonlySet<string>): BrandGroup[][] {
  const sorted = groups
    .filter((group) => !asked.has(group.signature))
    .sort((a, b) => a.rank - b.rank || (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0));
  const calls: BrandGroup[][] = [];
  for (let at = 0; at < sorted.length && calls.length < BRAND_MAX_CALLS; at += OPEN_MAX_ENTRIES) calls.push(sorted.slice(at, at + OPEN_MAX_ENTRIES));
  return calls;
}

/**
 * Os preços das marcas que só outras casas compraram, por item da lista. Uma linha chega a um grupo só pela
 * assinatura dele (em todas as respostas, as da base aberta também), e só de um mercado da casa (pelo CNPJ: cada
 * mercado da casa com esse CNPJ). A linha a peso vira preço por kg ou litro; a por unidade, pelo tamanho do grupo (a
 * que o servidor leu com outro tamanho fica de fora); o resto não entra.
 */
export function brandKeyQuotes(
  answers: readonly OpenPricesAnswer[],
  groups: readonly BrandGroup[],
  stores: readonly StoreCnpj[],
): Map<string, BrandKeyQuote[]> {
  const bySignature = new Map<string, OpenPricesAnswer['rows']>();
  for (const answer of answers) {
    for (const row of answer.rows) {
      const signature = answer.groups[row.group];
      if (signature === undefined) continue;
      bySignature.set(signature, [...(bySignature.get(signature) ?? []), row]);
    }
  }
  const idsByCnpj = new Map<string, string[]>();
  const nameByCnpj = new Map<string, string>();
  for (const store of stores) {
    if (!store.cnpj) continue;
    idsByCnpj.set(store.cnpj, [...(idsByCnpj.get(store.cnpj) ?? []), store.id]);
    if (!nameByCnpj.has(store.cnpj)) nameByCnpj.set(store.cnpj, store.name);
  }
  const quotes = new Map<string, BrandKeyQuote[]>();
  for (const group of groups) {
    for (const row of bySignature.get(group.signature) ?? []) {
      const ids = row.mine ? (idsByCnpj.get(row.store_cnpj) ?? []) : [];
      if (!ids.length) continue;
      for (const item of group.items) {
        let price: ComparablePrice | null = null;
        if (row.unit !== 'un') price = comparablePrice(row.unit, row.unit_price, null);
        else if (item.size) {
          const read = sharedPack(row);
          if (read && !samePackageSize(read, item.size)) continue;
          price = comparablePrice('un', row.unit_price, item.size);
        }
        if (!price || price.base !== item.base) continue;
        const shown = { ...sharedRowOf(row, nameByCnpj.get(row.store_cnpj)), pack: row.unit === 'un' ? item.size : null };
        const list = quotes.get(item.id) ?? [];
        for (const storeId of ids) {
          list.push({ storeId, quote: { ...shown, productId: null, storeId }, price, group: group.signature, referenceKey: item.referenceKey });
        }
        quotes.set(item.id, list);
      }
    }
  }
  return quotes;
}

/** O que identifica os itens da busca das marcas (o gancho guarda o plano e os grupos por isto). */
export function brandItemsSignature(items: readonly BrandSearchItem[] | null | undefined): string {
  return JSON.stringify(
    (items ?? []).map((item) => [
      item.id,
      item.name,
      item.category,
      item.quantity,
      item.unit,
      item.referenceKey,
      item.referenceName,
      item.base,
      item.amounts,
      item.excludedKeys,
      item.houseHeads,
    ]),
  );
}

// ---------------------------------------------------------------------------
// Os textos

/** "R$ 4,58/kg", "R$ 4,79/l". */
export function perBaseLabel(price: Pick<ComparablePrice, 'base' | 'perBase'>): string {
  return `${formatBRL(price.perBase)}/${price.base}`;
}

/** "5 kg por R$ 22,90"; null no preço a granel. */
export function packPriceLabel(price: Pick<ComparablePrice, 'pack' | 'packagePrice'>): string | null {
  return price.pack && price.packagePrice != null ? `${price.pack.label} por ${formatBRL(price.packagePrice)}` : null;
}

/** "5 kg", "500 g", "900 ml": a quantidade na base, em g ou ml abaixo de 1 kg ou 1 litro. */
function amountLabel(base: 'kg' | 'l', amount: number): string {
  if (amount < 1) return formatQuantity(Math.round(amount * 1000), base === 'kg' ? 'g' : 'ml');
  return formatQuantity(amount, base);
}

const packagesWord = (count: number) => (count === 1 ? 'pacote' : 'pacotes');

/**
 * O nome curto da marca no quadrinho do item: sem as primeiras palavras que já são do item ("Arroz Prato Fino 5kg"
 * é "Prato Fino 5kg"; "Leite Integral Italac 1L", "Italac 1L"); o nome inteiro quando não sobraria nada além do
 * tamanho ("Refrigerante Coca-Cola 2l").
 */
export function brandTileName(name: string, category?: string | null): string {
  const generic = new Set(words(genericItem(name, category).name).map(singular));
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  let at = 0;
  while (at < tokens.length) {
    const inner = words(tokens[at]);
    if (!inner.length || !inner.every((word) => generic.has(word) || generic.has(singular(word)))) break;
    at += 1;
  }
  const rest = tokens.slice(at);
  const onlySizes = rest.every((token) => words(token).every((word) => /\d/.test(word) || LOOSE_UNITS.has(word)));
  return onlySizes ? name.trim() : rest.join(' ');
}

/** "A conta usa 5 kg: 5 pacotes de 1 kg."; null quando não há o que dizer. */
export function quantitySentence(cost: PerBaseCost): string | null {
  if (!cost.sayQuantity || cost.packages == null || !cost.pack) return null;
  return `A conta usa ${amountLabel(cost.base, cost.amount)}: ${cost.packages} ${packagesWord(cost.packages)} de ${cost.pack.label}.`;
}

/** "5 pacotes de 1 kg", na linha do "Onde comprar"; null quando não há o que dizer. */
export function quantityShort(cost: PerBaseCost): string | null {
  if (!cost.sayQuantity || cost.packages == null || !cost.pack) return null;
  return `${cost.packages} ${packagesWord(cost.packages)} de ${cost.pack.label}`;
}

/** Depois da outra marca que só outras casas compraram, nos detalhes do item. */
export const KEY_BRAND_FACT = 'A marca não aparece: é o menor preço desse tamanho que outras casas viram nesse mercado, naquela semana.';
/** Onde a "Marca preferida" existe (o item tem um produto com marca): como ficar com o de sempre. */
export const BRAND_OPT_OUT = 'Para a conta ficar com o de sempre, ligue "Marca preferida".';

/** O selo do plano no "Onde comprar". */
export function CHEAPER_BRAND_BADGE(count: number): string {
  return `${count} pela marca mais barata`;
}

/** A parte do ranking por mercado: " · 2 pela marca mais barata". */
export function cheaperBrandRankPart(count: number): string {
  return count ? ` · ${count} pela marca mais barata` : '';
}
