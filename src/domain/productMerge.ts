// Juntar produtos: os produtos da casa só são únicos pelo nome, então "Arroz
// 5kg" e "Arroz Tio João 5 kg" são dois, cada um com metade do histórico de
// preços. O app sugere os pares que parecem o mesmo (pelas regras dos nomes
// parecidos, domain/similarNames) e a pessoa decide: nada é juntado sozinho.
// Quem junta é o banco, de uma vez (merge_products); aqui ficam as regras e
// as frases, e as telas só mostram.

import { COMMON_ITEMS } from './commonItems';
import { formatShortDate, toISODate } from './dates';
import { formatBRL } from './money';
import {
  indexNames,
  nameCandidates,
  nameSizes,
  sameProductPairs,
  sameSizes,
  similarNameKey,
  similarNames,
  sizeLabel,
  spelling,
  type ProductName,
} from './similarNames';
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

/**
 * Os dois nomes trazem tamanhos, e não são as mesmas quantidades ("5kg" e "1kg"; "1kg" e "1000g" são a mesma).
 * Só um com tamanho não é tamanho diferente.
 */
export function differentSizes(a: string, b: string): boolean {
  const [sizesA, sizesB] = [nameSizes(a).sizes, nameSizes(b).sizes];
  return sizesA.length > 0 && sizesB.length > 0 && !sameSizes(sizesA, sizesB);
}

/** Dois produtos que parecem o mesmo, ainda sem ordem entre eles. */
export type MergePair = [ProductName, ProductName];

/**
 * Os pares de produtos que parecem o mesmo e ainda dá para sugerir. Saem os
 * que a casa já disse serem diferentes e, sempre, os que trazem tamanhos
 * diferentes no nome: juntar "Arroz 5kg" com "Arroz 1kg" misturaria os preços.
 * Um produto nunca faz par com ele mesmo.
 *
 * "São diferentes" vale para o nome: quem é diferente do "Limão" é diferente
 * de todo produto com esse nome em outra grafia ("Limao", "Limões"). Sem isso,
 * um nome que só parece ("Limão siciliano") voltava como sugestão com o gêmeo
 * que nascesse depois. Entre dois com o mesmo nome, só sai o par marcado.
 */
export function mergeCandidates(products: readonly ProductName[], distinct: readonly DistinctPair[]): MergePair[] {
  const byId = new Map(products.map((product) => [product.id, product]));
  const refused = new Set(distinct.map((pair) => pairKey(pair.product_a, pair.product_b)));
  const keys = new Map<string, string>();
  const nameKey = (id: string) => {
    if (!keys.has(id)) keys.set(id, similarNameKey(byId.get(id)?.name ?? ''));
    return keys.get(id)!;
  };
  // Cada produto com os nomes de que a casa disse que ele é diferente.
  const refusedNames = new Set<string>();
  for (const { product_a, product_b } of distinct) {
    if (nameKey(product_b)) refusedNames.add(`${product_a} ${nameKey(product_b)}`);
    if (nameKey(product_a)) refusedNames.add(`${product_b} ${nameKey(product_a)}`);
  }
  const differentByName = (a: string, b: string) => refusedNames.has(`${a} ${nameKey(b)}`) || refusedNames.has(`${b} ${nameKey(a)}`);
  return sameProductPairs(products, COMMON_ITEMS).flatMap(({ ids: [a, b], closeness }): MergePair[] => {
    const [first, second] = [byId.get(a), byId.get(b)];
    if (!first || !second || a === b || refused.has(pairKey(a, b)) || differentSizes(first.name, second.name)) return [];
    if (closeness === 'parecido' && differentByName(a, b)) return [];
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
 * O par com o nome mais bem escrito na frente (com acento, sem ser tudo
 * maiúsculo ou minúsculo: "Detergente Ypê 500ml", não "Deterg Ype 500ml");
 * com a mesma grafia, o mais comprido ("Biscoito Passatempo", não "Bisc
 * Passatempo"); sem nada que os separe, fica a ordem em que vieram.
 */
function betterNamedFirst(pair: MergePair): MergePair {
  const [a, b] = pair;
  return (spelling(b.name) - spelling(a.name) || b.name.length - a.name.length) > 0 ? [b, a] : pair;
}

/**
 * As sugestões que aparecem: no máximo `limit`, os pares com mais compras
 * primeiro (somando os dois produtos). Cada produto aparece num par só de
 * cada vez ("Arroz" pode parecer com "Arroz Tio João 5kg" e com "Arroz Tio João
 * 1kg"; resolvido um, o outro vem). Com `productId` (a tela do produto), só
 * os pares dele: um de cada vez. No empate de compras fica o produto aberto;
 * sem produto aberto (Preços), o de nome mais bem escrito (`betterNamedFirst`).
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
      // Na tela do produto, o aberto vem primeiro: no empate de compras, é ele que fica. Em Preços ninguém abriu
      // produto nenhum, e o primeiro do par seria o nome cortado da nota: vem primeiro o mais bem escrito.
      const [opened, other] = !productId ? betterNamedFirst(pair) : pair[1].id === productId ? [pair[1], pair[0]] : pair;
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
 * O aviso de tamanho, quando os dois nomes trazem um: as quantidades não são
 * as mesmas ("5 kg e 1 kg"; "1kg" e "1000g" são a mesma e não avisam), ou um
 * tamanho foi lido com dúvida ("Agua 1 5l" pode ser 1,5 L ou 5 L). Com dúvida
 * o app não afirma número nem que são diferentes, só pede para conferir,
 * tenha o outro nome o número que tiver; o mesmo nome escrito de outro jeito
 * ("AGUA 1 5L") não tem o que conferir.
 */
function sizeWarning(a: string, b: string): string | null {
  const [sizesA, sizesB] = [nameSizes(a), nameSizes(b)];
  if (!sizesA.sizes.length || !sizesB.sizes.length) return null;
  if (sizesA.doubtful || sizesB.doubtful) {
    return similarNameKey(a) === similarNameKey(b) ? null : `Confira se são do mesmo tamanho. ${MIXES_PRICES}`;
  }
  if (sameSizes(sizesA.sizes, sizesB.sizes)) return null;
  const label = (sizes: string[]) => sizes.map(sizeLabel).join(' + ');
  return `Parecem tamanhos diferentes (${label(sizesA.sizes)} e ${label(sizesB.sizes)}). ${MIXES_PRICES}`;
}

/**
 * Os avisos que aparecem antes do botão de juntar (a pessoa ainda pode
 * juntar): os nomes trazem tamanhos diferentes, ou os dois produtos nunca
 * foram comprados na mesma medida (um por peso, o outro por unidade).
 */
export function mergeWarnings(a: MergeSide, b: MergeSide): string[] {
  const warnings: string[] = [];
  const size = sizeWarning(a.name, b.name);
  if (size) warnings.push(size);
  const [measuresA, measuresB] = [a, b].map((side) => [...new Set(side.facts.units.map(measure))]);
  if (measuresA.length && measuresB.length && !measuresA.some((m) => measuresB.includes(m))) {
    // O sujeito é o preço (as medidas vêm dos últimos preços): a frase não muda com o número de compras nem
    // adivinha o gênero do nome do produto.
    warnings.push(`O preço de "${a.name}" é ${measuresA.join(' e ')}, e o de "${b.name}", ${measuresB.join(' e ')}. ${MIXES_PRICES}`);
  }
  return warnings;
}

/** O que acontece com cada um dos dois nomes, na confirmação. */
export const NAME_STAYS = 'Este nome fica';
export const NAME_GOES = 'Deixa de existir';

/**
 * O que o leitor de tela diz de cada produto na confirmação. O rótulo entra no
 * lugar do conteúdo do cartão: leva o nome, o que o app sabe do produto e o
 * que acontece com ele ("Este nome fica" ou "Deixa de existir").
 */
export function choiceLabel(name: string, line: string, stays: boolean): string {
  return `${name}. ${line}. ${stays ? NAME_STAYS : NAME_GOES}.`;
}

/** Os botões de cada par sugerido, para quem ouve a tela: sem o par, três "Juntar" seguidos não dizem de quê. */
export function joinLabel(first: string, second: string): string {
  return `Juntar ${first} com ${second}`;
}

export function distinctLabel(first: string, second: string): string {
  return `${first} e ${second} são diferentes`;
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
/**
 * A resposta de juntar não chegou a tempo. Não dá para saber se o banco juntou: a pessoa confere os produtos
 * antes de tentar de novo.
 */
export const MERGE_NO_ANSWER_TITLE = 'Sem resposta';
export const MERGE_NO_ANSWER = 'A resposta não chegou, e pode ser que os produtos já tenham sido juntados. Confira os produtos antes de tentar de novo.';
/**
 * Uma gravação (a nota, um item na lista) mandou um produto que outra pessoa da casa juntou com outro enquanto
 * esta tela estava aberta. A tela busca os produtos de novo; a pessoa confere e repete.
 */
export const PRODUCT_MERGED_AWAY = 'Um produto daqui foi juntado com outro. Confira e tente de novo.';
/** O banco não conseguiu passar tudo para o outro produto e desistiu de juntar (55000 de merge_products). */
export const MERGE_BLOCKED = 'Não deu para juntar: uma parte do que é deste produto não pôde passar para o outro. Nada foi mudado.';
/** O título do aviso depois de juntar. */
export const MERGE_DONE_TITLE = 'Agora é um produto só';
