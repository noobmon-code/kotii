// Juntar produtos: os produtos da casa só são únicos pelo nome, então "Arroz
// 5kg" e "Arroz Tio João 5 kg" são dois, cada um com metade do histórico de
// preços. O app sugere os pares que parecem o mesmo (pelas regras dos nomes
// parecidos, domain/similarNames) e a pessoa decide: nada é juntado sozinho.
// Quem junta é o banco, de uma vez (merge_products); aqui ficam as regras e
// as frases, e as telas só mostram.

import { COMMON_ITEMS } from './commonItems';
import { formatShortDate, toISODate } from './dates';
import { formatBRL } from './money';
import { indexNames, nameCandidates, nameSizes, sameProductPairs, similarNames, sizeLabel, type ProductName } from './similarNames';
import { sameDimension } from './units';

/** Par que a casa disse serem produtos diferentes, como o banco guarda: o id menor em `product_a`. */
export interface DistinctPair {
  product_a: string;
  product_b: string;
}

/** Os dois ids na ordem em que o banco guarda o par (o uuid compara como o texto dele em minúsculas). */
export function orderedPair(a: string, b: string): DistinctPair {
  return a < b ? { product_a: a, product_b: b } : { product_a: b, product_b: a };
}

const pairKey = (a: string, b: string) => {
  const { product_a, product_b } = orderedPair(a, b);
  return `${product_a} ${product_b}`;
};

/** Os dois nomes trazem tamanhos, e não são os mesmos ("5kg" e "1kg"). Só um com tamanho não é tamanho diferente. */
export function differentSizes(a: string, b: string): boolean {
  const [sizesA, sizesB] = [nameSizes(a).sizes, nameSizes(b).sizes];
  return sizesA.length > 0 && sizesB.length > 0 && sizesA.join(' ') !== sizesB.join(' ');
}

/** Dois produtos que parecem o mesmo, ainda sem ordem entre eles. */
export type MergePair = [ProductName, ProductName];

/**
 * Os pares de produtos que parecem o mesmo e ainda dá para sugerir. Saem os
 * que a casa já disse serem diferentes e, sempre, os que trazem tamanhos
 * diferentes no nome: juntar "Arroz 5kg" com "Arroz 1kg" misturaria os preços.
 * Um produto nunca faz par com ele mesmo.
 */
export function mergeCandidates(products: readonly ProductName[], distinct: readonly DistinctPair[]): MergePair[] {
  const byId = new Map(products.map((product) => [product.id, product]));
  const refused = new Set(distinct.map((pair) => pairKey(pair.product_a, pair.product_b)));
  return sameProductPairs(products, COMMON_ITEMS).flatMap(({ ids: [a, b] }): MergePair[] => {
    const [first, second] = [byId.get(a), byId.get(b)];
    if (!first || !second || a === b || refused.has(pairKey(a, b)) || differentSizes(first.name, second.name)) return [];
    return [[first, second]];
  });
}

/** Quantas sugestões aparecem de cada vez: as outras vêm conforme estas são resolvidas. */
export const MERGE_SUGGESTION_LIMIT = 3;

/** Compras de cada produto (linhas de notas confirmadas); produto que não está aqui não tem nenhuma. */
export type PurchaseCounts = Readonly<Record<string, number>>;

/**
 * O produto que fica por padrão: o de mais compras; no empate, o que a
 * pessoa abriu (`opened`).
 */
export function defaultKeep(opened: string, other: string, purchases: PurchaseCounts): string {
  return (purchases[other] ?? 0) > (purchases[opened] ?? 0) ? other : opened;
}

/** Uma sugestão pronta para mostrar: `keep` é o produto que ficaria por padrão. */
export interface MergeSuggestion {
  keep: ProductName;
  other: ProductName;
}

/**
 * As sugestões que aparecem: no máximo `limit`, os pares com mais compras
 * primeiro (somando os dois produtos). Cada produto aparece num par só de
 * cada vez ("Arroz" pode parecer com "Arroz Tio João 5kg" e com "Arroz Tio João
 * 1kg"; resolvido um, o outro vem). Com `productId` (a tela do produto), só
 * os pares dele: um de cada vez.
 */
export function mergeSuggestions(
  candidates: readonly MergePair[],
  purchases: PurchaseCounts,
  { productId, limit = MERGE_SUGGESTION_LIMIT }: { productId?: string; limit?: number } = {},
): MergeSuggestion[] {
  const total = ([a, b]: MergePair) => (purchases[a.id] ?? 0) + (purchases[b.id] ?? 0);
  const taken = new Set<string>();
  return candidates
    .filter(([a, b]) => !productId || a.id === productId || b.id === productId)
    .map((pair): MergeSuggestion => {
      // Na tela do produto, o aberto vem primeiro: no empate de compras, é ele que fica.
      const [opened, other] = pair[1].id === productId ? [pair[1], pair[0]] : pair;
      return defaultKeep(opened.id, other.id, purchases) === opened.id ? { keep: opened, other } : { keep: other, other: opened };
    })
    .sort(
      (a, b) =>
        total([b.keep, b.other]) - total([a.keep, a.other]) ||
        a.keep.name.localeCompare(b.keep.name, 'pt-BR') ||
        a.other.name.localeCompare(b.other.name, 'pt-BR'),
    )
    .filter(({ keep, other }) => {
      if (taken.has(keep.id) || taken.has(other.id)) return false;
      taken.add(keep.id).add(other.id);
      return true;
    })
    .slice(0, limit);
}

/**
 * Para escolher à mão com qual produto juntar: os de nome mais parecido com o
 * deste, do mais parecido para o menos (os mesmos "nomes parecidos" do seletor
 * de produto da nota). Os outros produtos a tela lista depois, por nome.
 */
export function similarProducts(product: ProductName, products: readonly ProductName[], limit = 5): ProductName[] {
  const others = products.filter((other) => other.id !== product.id);
  const byId = new Map(others.map((other) => [other.id, other]));
  const index = indexNames(nameCandidates({ products: others, listItems: [], purchases: [], common: [] }));
  return similarNames(product.name, index, { category: product.category, limit }).flatMap((similar) => {
    const found = similar.productId ? byId.get(similar.productId) : undefined;
    return found ? [found] : [];
  });
}

// ---------------------------------------------------------------------------
// O que o app sabe de cada produto

/** O que o app sabe de um produto, para a pessoa reconhecer cada um antes de juntar. */
export interface ProductFacts {
  /** Linhas de notas confirmadas com o produto. */
  purchases: number;
  /** O preço mais recente (de nota com mercado). */
  lastPrice: { unitPrice: number; unit: string; store: string | null; on: string } | null;
  /** Tem item na despensa (ainda não consumido). */
  inPantry: boolean;
  /** Tem item numa lista de compras aberta. */
  onList: boolean;
  /** As unidades em que já foi comprado. */
  units: string[];
}

/** O que as telas já têm carregado, de onde saem os fatos de cada produto. */
export interface ProductFactsSource {
  purchases: PurchaseCounts;
  /** Os últimos preços da casa (um por produto, mercado e unidade). */
  prices: readonly { product_id: string; store_id: string; unit: string; unit_price: number; purchased_at: string }[];
  stores: readonly { id: string; name: string }[];
  /** Itens abertos da despensa. */
  pantry: readonly { product_id: string | null }[];
  /** Itens de listas abertas. */
  listItems: readonly { product_id: string | null }[];
}

export function productFacts(productId: string, source: ProductFactsSource): ProductFacts {
  const prices = source.prices.filter((price) => price.product_id === productId);
  const latest = prices.reduce<(typeof prices)[number] | null>(
    (best, price) => (!best || new Date(price.purchased_at).getTime() > new Date(best.purchased_at).getTime() ? price : best),
    null,
  );
  return {
    purchases: source.purchases[productId] ?? 0,
    lastPrice: latest && {
      unitPrice: latest.unit_price,
      unit: latest.unit,
      store: source.stores.find((store) => store.id === latest.store_id)?.name ?? null,
      on: toISODate(new Date(latest.purchased_at)),
    },
    inPantry: source.pantry.some((item) => item.product_id === productId),
    onList: source.listItems.some((item) => item.product_id === productId),
    units: [...new Set(prices.map((price) => price.unit))],
  };
}

/** "12 compras", "1 compra", "nenhuma compra". */
export function purchasesLabel(count: number): string {
  if (count <= 0) return 'nenhuma compra';
  return count === 1 ? '1 compra' : `${count} compras`;
}

/**
 * O que o app sabe do produto, numa linha: "12 compras · último preço R$ 25,90
 * em 10 out (Assaí) · na despensa · na lista". `referenceYear`: o ano que não
 * precisa aparecer na data (o atual).
 */
export function factsLine(facts: ProductFacts, referenceYear?: number): string {
  const { lastPrice } = facts;
  const price = lastPrice
    ? [
        `último preço ${formatBRL(lastPrice.unitPrice)}${lastPrice.unit === 'un' ? '' : `/${lastPrice.unit}`}`,
        `em ${formatShortDate(lastPrice.on, referenceYear)}`,
        lastPrice.store ? `(${lastPrice.store})` : null,
      ]
        .filter(Boolean)
        .join(' ')
    : null;
  return [purchasesLabel(facts.purchases), price, facts.inPantry ? 'na despensa' : null, facts.onList ? 'na lista' : null]
    .filter(Boolean)
    .join(' · ');
}

// ---------------------------------------------------------------------------
// Avisos e frases da confirmação

/** O nome com o que o app sabe do produto. */
export interface MergeSide {
  name: string;
  facts: ProductFacts;
}

const MIXES_PRICES = 'Juntar mistura os preços dos dois no histórico.';

/** Como a compra é medida: por unidade, por peso (kg, g) ou por volume (l, ml). */
function measure(unit: string): string {
  if (sameDimension(unit, 'kg')) return 'por peso';
  if (sameDimension(unit, 'l')) return 'por volume';
  return 'por unidade';
}

/**
 * Os avisos que aparecem antes do botão de juntar (a pessoa ainda pode
 * juntar): os nomes trazem tamanhos diferentes, ou os dois produtos nunca
 * foram comprados na mesma medida (um por peso, o outro por unidade).
 */
export function mergeWarnings(a: MergeSide, b: MergeSide): string[] {
  const warnings: string[] = [];
  if (differentSizes(a.name, b.name)) {
    const [sizesA, sizesB] = [nameSizes(a.name), nameSizes(b.name)];
    const label = (sizes: string[]) => sizes.map(sizeLabel).join(' + ');
    // Tamanho lido com dúvida ("Agua 1 5l"): avisa, sem afirmar um número que pode não ser o do produto.
    warnings.push(
      sizesA.doubtful || sizesB.doubtful
        ? `Os nomes parecem trazer tamanhos diferentes. ${MIXES_PRICES}`
        : `Parecem tamanhos diferentes (${label(sizesA.sizes)} e ${label(sizesB.sizes)}). ${MIXES_PRICES}`,
    );
  }
  const [measuresA, measuresB] = [a, b].map((side) => [...new Set(side.facts.units.map(measure))]);
  if (measuresA.length && measuresB.length && !measuresA.some((m) => measuresB.includes(m))) {
    warnings.push(
      `As compras de "${a.name}" são ${measuresA.join(' e ')}, e as de "${b.name}", ${measuresB.join(' e ')}. ${MIXES_PRICES}`,
    );
  }
  return warnings;
}

export const MERGE_IRREVERSIBLE = 'Não dá para desfazer.';

/**
 * O que vai acontecer, antes de a pessoa confirmar: "As 12 compras, o que está
 * na despensa e na lista de "Arroz 5kg" passam para "Arroz Tio João 5 kg". Não
 * dá para desfazer." `gone` é o produto que deixa de existir.
 */
export function mergeSummary(gone: MergeSide, keepName: string): string {
  const { purchases, inPantry, onList } = gone.facts;
  const bought = purchases > 1 ? `as ${purchases} compras` : purchases === 1 ? 'a compra' : null;
  const places = [inPantry ? 'na despensa' : null, onList ? 'na lista' : null].filter(Boolean).join(' e ');
  const kept = places ? `o que está ${places}` : null;
  const moving = [bought, kept].filter(Boolean);
  if (!moving.length) return `"${gone.name}" deixa de existir e fica só "${keepName}". ${MERGE_IRREVERSIBLE}`;
  const subject = moving.join(bought && inPantry && onList ? ', ' : ' e ');
  // "As compras ... passam"; "A compra passa", "O que está na despensa e na lista passa".
  const verb = purchases > 1 || moving.length > 1 ? 'passam' : 'passa';
  return `${subject[0].toUpperCase()}${subject.slice(1)} de "${gone.name}" ${verb} para "${keepName}". ${MERGE_IRREVERSIBLE}`;
}

/** O que o banco diz que passou para o produto que ficou (ver merge_products). */
export interface MergeMoved {
  /** Linhas de notas confirmadas. */
  purchases: number;
  /** Itens abertos da despensa. */
  pantry: number;
  /** Itens de listas abertas. */
  list: number;
}

const counted = (count: number, one: string, many: string) => (count === 1 ? `1 ${one}` : `${count} ${many}`);

/** Depois de juntar: o que aconteceu, com o que passou de um produto para o outro. */
export function mergeResult(goneName: string, keepName: string, moved: MergeMoved): string {
  const parts = [
    moved.purchases > 0 ? counted(moved.purchases, 'compra', 'compras') : null,
    moved.pantry > 0 ? counted(moved.pantry, 'item da despensa', 'itens da despensa') : null,
    moved.list > 0 ? counted(moved.list, 'item da lista', 'itens da lista') : null,
  ].filter((part): part is string => part !== null);
  const done = `"${goneName}" passou a ser "${keepName}".`;
  if (!parts.length) return done;
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}` : parts[0];
  const single = moved.purchases + moved.pantry + moved.list === 1;
  return `${done} ${single ? 'Foi' : 'Foram'} junto ${list}.`;
}

/** O banco ainda não tem a função de juntar (o app chegou antes da migração). */
export const MERGE_UNAVAILABLE_TITLE = 'Ainda não está disponível';
export const MERGE_UNAVAILABLE = 'Juntar produtos ainda está sendo ativado no Kotii. Tente de novo mais tarde.';
/** Outra pessoa da casa juntou ou apagou um dos dois enquanto a tela estava aberta. */
export const MERGE_PRODUCT_GONE = 'Um destes produtos não existe mais: alguém da casa já juntou ou apagou.';
/** O banco não conseguiu passar tudo para o outro produto e desistiu de juntar (55000 de merge_products). */
export const MERGE_BLOCKED = 'Não deu para juntar: uma parte do que é deste produto não pôde passar para o outro. Nada foi mudado.';
/** O título do aviso depois de juntar. */
export const MERGE_DONE_TITLE = 'Agora é um produto só';
