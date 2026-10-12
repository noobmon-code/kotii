// Nomes parecidos: ao dar nome a um produto na revisão da nota, o app confere
// se a casa já usa um nome parecido (produtos, itens das listas, compras
// recentes e itens comuns). Sem isso, a mesma coisa vira vários itens na
// lista de compras ("Banana", "Bananas", "Banana Prata Kg").

import { listNameKey } from './listLinks';

/** De onde vem o nome que a casa já usa. */
export type NameSource = 'produto' | 'lista' | 'comprado' | 'comum';

export interface NameCandidate {
  name: string;
  category: string;
  /** Produto com este nome: escolher liga o item da nota a ele. */
  productId: string | null;
  source: NameSource;
  /** Itens de listas abertas com este nome. */
  listItemIds: string[];
}

export interface SimilarName extends NameCandidate {
  /** O nome sem acento, plural nem ordem das palavras: o mesmo para grafias diferentes. */
  key: string;
  /**
   * `igual`: o mesmo nome escrito de outro jeito (acento, plural, ordem das
   * palavras). `parecido`: um nome contém o outro, sem contar tamanho e
   * quantidade ("Arroz" e "Arroz Tio João 5kg").
   */
  closeness: 'igual' | 'parecido';
  /**
   * Dá para sugerir sem a pessoa pedir: o mesmo nome, ou um nome da casa que
   * começa pela mesma palavra e cabe inteiro no nome novo ("Arroz" em "Arroz
   * Tio João 5kg"). "Alho" em "Molho de alho" é parecido, mas é outra coisa.
   */
  confident: boolean;
}

// Palavras que não dizem o que é o item.
const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'sem', 'para', 'em', 'a', 'o', 'no', 'na', 'ao']);
// Tamanho e quantidade ("5kg", "500 g", "1,5 l", "c/12"): mudam o produto, não o que ele é.
const UNITS = new Set(['kg', 'g', 'gr', 'mg', 'ml', 'l', 'lt', 'un', 'und', 'unid', 'pct', 'pc', 'cx', 'fd', 'dz', 'cm', 'mm']);
const isSize = (word: string) => /^\d+[a-z]{0,4}$/.test(word) || UNITS.has(word);

/** A palavra no singular ("limoes" -> "limao", "papeis" -> "papel", "bananas" -> "banana"). */
function singular(word: string): string {
  if (word.length >= 4 && /[ao]es$/.test(word)) return `${word.slice(0, -3)}ao`;
  if (word.length > 4 && word.endsWith('eis')) return `${word.slice(0, -3)}el`;
  if (word.length > 4 && word.endsWith('ais')) return `${word.slice(0, -3)}al`;
  if (word.length > 4 && word.endsWith('ois')) return `${word.slice(0, -3)}ol`;
  if (word.length > 3 && word.endsWith('ns')) return `${word.slice(0, -2)}m`;
  if (word.length > 4 && /[rz]es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** Todas as palavras do nome (tamanho e quantidade inclusive), no singular. */
const allWords = (name: string) =>
  listNameKey(name)
    .split(' ')
    .filter((word) => word && !STOPWORDS.has(word))
    .map(singular);

/** As palavras que dizem o que é o item: sem tamanho, quantidade nem letra solta. */
const mainWords = (name: string) =>
  listNameKey(name)
    .split(' ')
    .filter((word) => word.length > 1 && !STOPWORDS.has(word) && !isSize(word));

/**
 * Nota fiscal abrevia cortando a palavra ("DETERG", "REFRIG", "BISC"): quatro
 * letras ou mais, terminando em consoante, no começo de uma palavra bem maior
 * ("papel" não abrevia "papelão").
 */
const abbreviates = (short: string, long: string) =>
  short.length >= 4 && long.length >= short.length + 3 && /[^aeiou]$/.test(short) && long.startsWith(short);

const sameWord = (a: string, b: string) => singular(a) === singular(b) || abbreviates(a, b) || abbreviates(b, a);

/** Cada palavra de `small` aparece em `big`. */
const covers = (big: string[], small: string[]) => small.every((word) => big.some((other) => sameWord(word, other)));

/** A mesma chave para "Feijão Preto", "feijao preto" e "Preto, feijões". */
export function similarNameKey(name: string): string {
  return [...new Set(allWords(name))].sort().join(' ');
}

interface Indexed extends NameCandidate {
  key: string;
  main: string[];
}

/** Os nomes que a casa já usa, prontos para comparar. */
export interface NameIndex {
  entries: Indexed[];
  byKey: Map<string, Indexed>;
}

const SOURCE_RANK: Record<NameSource, number> = { produto: 0, lista: 1, comprado: 2, comum: 3 };

/**
 * Junta os nomes de todas as fontes; a mesma grafia em mais de uma fica uma
 * vez só, com o nome da fonte mais forte (produto, lista, compra, item comum),
 * o produto de quem tiver e todos os itens de lista.
 */
export function indexNames(candidates: readonly NameCandidate[]): NameIndex {
  const byKey = new Map<string, Indexed>();
  for (const candidate of candidates) {
    const name = candidate.name.trim();
    const key = similarNameKey(name);
    if (!name || !key) continue;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { ...candidate, name, key, main: mainWords(name), listItemIds: [...candidate.listItemIds] });
      continue;
    }
    const stronger = SOURCE_RANK[candidate.source] < SOURCE_RANK[current.source];
    byKey.set(key, {
      ...current,
      ...(stronger ? { name, category: candidate.category, source: candidate.source, main: mainWords(name) } : {}),
      productId: (stronger ? candidate.productId : current.productId) ?? current.productId ?? candidate.productId,
      listItemIds: [...new Set([...current.listItemIds, ...candidate.listItemIds])],
    });
  }
  return { entries: [...byKey.values()], byKey };
}

export interface SimilarOptions {
  /** A categoria do item da nota: entre parecidos iguais, a mesma categoria vem antes. */
  category?: string;
  limit?: number;
  /** O produto já escolhido para o item: não é sugestão. */
  exceptProductId?: string | null;
  /** Só o mesmo nome com outra grafia. */
  onlySame?: boolean;
  /** Só o que dá para sugerir sem a pessoa pedir (ver `confident`). */
  onlyConfident?: boolean;
}

/**
 * Os nomes que a casa já usa e se parecem com `name`, do mais parecido para o
 * menos. Um nome idêntico só entra se trouxer um produto: sem produto, trocar
 * por ele não muda nada (o item de lista com esse nome já aparece na revisão,
 * em "Lista de compras").
 */
export function similarNames(name: string, index: NameIndex, options: SimilarOptions = {}): SimilarName[] {
  const { category, limit = 5, exceptProductId, onlySame = false, onlyConfident = false } = options;
  const typed = name.trim();
  const key = similarNameKey(typed);
  const main = mainWords(typed);
  if (!key) return [];

  const found: { candidate: Indexed; closeness: SimilarName['closeness']; confident: boolean; sameStart: boolean; extra: number }[] = [];
  for (const candidate of index.entries) {
    if (exceptProductId && candidate.productId === exceptProductId) continue;
    if (candidate.key === key) {
      const adds = candidate.productId || candidate.name.toLowerCase() !== typed.toLowerCase();
      if (adds) found.push({ candidate, closeness: 'igual', confident: true, sameStart: true, extra: 0 });
      continue;
    }
    if (onlySame || !main.length || !candidate.main.length) continue;
    // O nome da casa cabe no nome novo (mais genérico), ou o contrário.
    const inside = covers(main, candidate.main);
    if (!inside && !covers(candidate.main, main)) continue;
    // Em português o que o item é vem primeiro ("Molho de alho" é molho).
    const sameStart = sameWord(main[0], candidate.main[0]);
    const confident = inside && sameStart;
    if (onlyConfident && !confident) continue;
    found.push({ candidate, closeness: 'parecido', confident, sameStart, extra: Math.abs(main.length - candidate.main.length) });
  }

  return found
    .sort(
      (a, b) =>
        Number(b.closeness === 'igual') - Number(a.closeness === 'igual') ||
        Number(b.confident) - Number(a.confident) ||
        Number(b.sameStart) - Number(a.sameStart) ||
        a.extra - b.extra ||
        SOURCE_RANK[a.candidate.source] - SOURCE_RANK[b.candidate.source] ||
        Number(b.candidate.category === category) - Number(a.candidate.category === category) ||
        a.candidate.name.length - b.candidate.name.length ||
        a.candidate.name.localeCompare(b.candidate.name, 'pt-BR'),
    )
    .slice(0, limit)
    .map(({ candidate, closeness, confident }) => ({
      name: candidate.name,
      category: candidate.category,
      productId: candidate.productId,
      source: candidate.source,
      listItemIds: candidate.listItemIds,
      key: candidate.key,
      closeness,
      confident,
    }));
}

/** O que a nota precisa de cada fonte para montar os nomes da casa. */
export interface NameSources {
  products: readonly { id: string; name: string; category: string }[];
  /** Itens de listas abertas. */
  listItems: readonly { id: string; name: string; category: string; product_id: string | null }[];
  /** Compras recentes (carrinhos limpos e notas). */
  purchases: readonly { name: string; category: string; productId: string | null }[];
  /** Itens comuns da lista de compras. */
  common: readonly { name: string; category: string }[];
}

export function nameCandidates({ products, listItems, purchases, common }: NameSources): NameCandidate[] {
  const known = new Set(products.map((product) => product.id));
  // Produto apagado depois da compra: o nome continua valendo, sem o produto.
  const productId = (id: string | null) => (id && known.has(id) ? id : null);
  return [
    ...products.map((p): NameCandidate => ({ name: p.name, category: p.category, productId: p.id, source: 'produto', listItemIds: [] })),
    ...listItems.map(
      (i): NameCandidate => ({ name: i.name, category: i.category, productId: productId(i.product_id), source: 'lista', listItemIds: [i.id] }),
    ),
    ...purchases.map(
      (r): NameCandidate => ({ name: r.name, category: r.category, productId: productId(r.productId), source: 'comprado', listItemIds: [] }),
    ),
    ...common.map((c): NameCandidate => ({ name: c.name, category: c.category, productId: null, source: 'comum', listItemIds: [] })),
  ];
}

const SOURCE_LABELS: Record<NameSource, string> = {
  produto: 'Produto da casa',
  lista: 'Está na lista de compras',
  comprado: 'Comprado antes',
  comum: 'Item comum da lista',
};

/** De onde o nome vem, para mostrar ao lado dele. */
export function nameSourceLabel(candidate: Pick<NameCandidate, 'source' | 'listItemIds'>): string {
  // Produto que também está numa lista aberta: a lista é o que a pessoa reconhece.
  return candidate.source === 'produto' && candidate.listItemIds.length ? 'Produto da casa, na lista de compras' : SOURCE_LABELS[candidate.source];
}
