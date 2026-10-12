// Nomes parecidos: ao dar nome a um produto na revisão da nota, o app confere
// se a casa já usa um nome parecido (produtos, itens das listas, compras
// recentes e itens comuns). Sem isso, a mesma coisa vira vários itens na
// lista de compras ("Banana", "Bananas", "Banana Prata Kg").

import { listNameKey } from './listLinks';
import { normalizeSearch } from './search';

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
   * palavras). `parecido`: um nome contém o outro ("Arroz" e "Arroz Tio João 5kg").
   */
  closeness: 'igual' | 'parecido';
  /**
   * Dá para sugerir sem a pessoa pedir: o mesmo nome, ou um nome da casa que
   * cabe inteiro no começo do nome novo, com o mesmo tamanho se tiver um
   * ("Arroz" em "Arroz Tio João 5kg"). Não é o caso de "Alho" em "Molho de
   * alho", de "Leite" em "Leite de coco" nem de "Coca-Cola 2L" em "Coca-Cola
   * Lata 350ml": parecidos, mas outra coisa.
   */
  confident: boolean;
}

// Ligam palavras sem dizer o que é o item. "Sem" não entra: muda o item.
const LINKS = new Set(['de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos', 'nas', 'ao', 'com', 'para', 'por', 'e', 'a', 'o']);
// Depois do nome da casa, uma destas mais outra palavra faz outra coisa ("Leite de coco", "Sabão em pó").
const COMPOUND = new Set(['de', 'da', 'do', 'das', 'dos', 'em']);
// Embalagem: não muda o produto.
const PACKAGING = new Set([
  'lata', 'latinha', 'garrafa', 'pet', 'vidro', 'frasco', 'pote', 'caixa', 'caixinha', 'pacote', 'pack', 'fardo', 'sache',
  'refil', 'bandeja', 'barra', 'tablete', 'rolo', 'unidade', 'embalagem', 'granel', 'long', 'neck', 'tetra', 'pak',
]);
// Unidade solta ("Banana Prata Kg") não diz o que é o item nem o tamanho.
const LOOSE_UNITS = new Set(['kg', 'gr', 'mg', 'ml', 'lt', 'un', 'und', 'unid', 'pct', 'pc', 'cx', 'fd', 'dz', 'cm', 'mm']);
// A mesma unidade escrita de outro jeito.
const UNIT_ALIASES: Record<string, string> = { gr: 'g', grs: 'g', gs: 'g', kgs: 'kg', lt: 'l', lts: 'l', ls: 'l', mls: 'ml', und: 'un', unid: 'un', uns: 'un', unds: 'un' };
const UNITS = new Set(['kg', 'g', 'mg', 'ml', 'l', 'un', 'cm', 'mm', 'm', 'w', 'v', ...Object.keys(UNIT_ALIASES)]);

/** A palavra no singular ("limoes" -> "limao", "papeis" -> "papel", "bananas" -> "banana"). */
function singular(word: string): string {
  // "sem-gas" já está pronto (ver parseName).
  if (word.startsWith('sem-')) return word;
  if (word.length >= 4 && /[ao]es$/.test(word)) return `${word.slice(0, -3)}ao`;
  if (word.length > 4 && word.endsWith('eis')) return `${word.slice(0, -3)}el`;
  if (word.length > 4 && word.endsWith('ais')) return `${word.slice(0, -3)}al`;
  if (word.length > 4 && word.endsWith('ois')) return `${word.slice(0, -3)}ol`;
  if (word.length > 3 && word.endsWith('ns')) return `${word.slice(0, -2)}m`;
  if (word.length > 4 && /[rz]es$/.test(word)) return word.slice(0, -2);
  // Plural em "s" só depois de vogal: "sals" é abreviação, não plural de "sal".
  if (word.length > 3 && /[aeiou]s$/.test(word)) return word.slice(0, -1);
  return word;
}

/** "350ml", "2l", "12un": número e unidade juntos, com a unidade num jeito só. */
function sizeToken(number: string, unit: string): string {
  return `${number}${UNIT_ALIASES[unit] ?? unit}`;
}

interface Part {
  text: string;
  /** `word`: diz o que é o item; `link`: só liga palavras ("de", "em"). */
  kind: 'word' | 'link';
}

interface Parsed {
  /** O mesmo para grafias diferentes do mesmo nome. */
  key: string;
  /** As palavras que dizem o que é o item, na ordem, como escritas (sem acento). */
  words: string[];
  /** O que distingue versões do mesmo item: tamanho, quantidade, letra ("350ml", "12un", "c" de vitamina C). */
  variants: string[];
  /** Palavras e ligações na ordem do nome. */
  parts: Part[];
}

function parseName(name: string): Parsed {
  // "s/" é sem, "c/" é com: antes de a pontuação sair.
  const text = normalizeSearch(name)
    .replace(/\bs\/\s*/g, 'sem ')
    .replace(/\bc\/\s*/g, 'com ')
    .replace(/\bp\/\s*/g, 'para ');
  const raw = listNameKey(text).split(' ').filter(Boolean);
  const parts: Part[] = [];
  const variants: string[] = [];
  const isNumber = (token: string | undefined) => token != null && /^\d+$/.test(token);
  const isSized = (token: string) => /^\d+[a-z]{1,4}$/.test(token);
  // O que vem depois ainda tem palavra? Uma letra no fim ("Vitamina A") é versão, não ligação.
  const wordAfter = (index: number) =>
    raw.slice(index + 1).some((token) => !isNumber(token) && !isSized(token) && !LOOSE_UNITS.has(token) && token.length > 1);

  for (let i = 0; i < raw.length; i++) {
    const token = raw[i];
    const next = raw[i + 1];
    if (isNumber(token)) {
      if (next && UNITS.has(next)) {
        variants.push(sizeToken(token, next));
        i += 1;
      } else {
        variants.push(token);
      }
    } else if (isSized(token)) {
      const [, number, unit] = /^(\d+)([a-z]+)$/.exec(token)!;
      variants.push(sizeToken(number, unit));
    } else if (/^[a-z]\d+$/.test(token)) {
      // "B12": versão do item.
      variants.push(token);
    } else if (token === 'sem') {
      // "Sem sal" é uma palavra só: nem igual nem contido em "com sal".
      if (next && !isNumber(next)) {
        parts.push({ text: `sem-${singular(next)}`, kind: 'word' });
        i += 1;
      }
    } else if (token === 'com' && isNumber(next)) {
      // "c/12": doze unidades.
      variants.push(sizeToken(next!, 'un'));
      i += 1;
    } else if (token === 'duzia') {
      variants.push('12un');
    } else if (LOOSE_UNITS.has(token)) {
      // Unidade solta: nada a dizer.
    } else if (token.length === 1) {
      if (LINKS.has(token) && wordAfter(i)) parts.push({ text: token, kind: 'link' });
      else variants.push(token);
    } else if (LINKS.has(token)) {
      parts.push({ text: token, kind: 'link' });
    } else {
      parts.push({ text: token, kind: 'word' });
    }
  }

  const words = parts.filter((part) => part.kind === 'word').map((part) => part.text);
  const uniqueVariants = [...new Set(variants)].sort();
  const wordKey = [...new Set(words.map(singular))].sort().join(' ');
  const key = [wordKey, uniqueVariants.join(' ')].filter(Boolean).join(' | ');
  return { key, words, variants: uniqueVariants, parts };
}

/** A mesma chave para "Feijão Preto", "feijao preto" e "Preto, feijões"; tamanho e "sem" contam. */
export function similarNameKey(name: string): string {
  return parseName(name).key;
}

interface Indexed extends NameCandidate {
  key: string;
  parsed: Parsed;
}

/** Os nomes que a casa já usa, prontos para comparar. */
export interface NameIndex {
  entries: Indexed[];
  byKey: Map<string, Indexed>;
  /** Todas as palavras dos nomes, no singular: palavra que está aqui não é abreviação. */
  vocabulary: Set<string>;
  /** Palavras do vocabulário que começam por um trecho (guardado para não refazer). */
  expansions: Map<string, string[]>;
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
    const parsed = parseName(name);
    if (!name || !parsed.key) continue;
    const current = byKey.get(parsed.key);
    if (!current) {
      byKey.set(parsed.key, { ...candidate, name, key: parsed.key, parsed, listItemIds: [...candidate.listItemIds] });
      continue;
    }
    const stronger = SOURCE_RANK[candidate.source] < SOURCE_RANK[current.source];
    byKey.set(parsed.key, {
      ...current,
      ...(stronger ? { name, category: candidate.category, source: candidate.source, parsed } : {}),
      productId: (stronger ? candidate.productId : current.productId) ?? current.productId ?? candidate.productId,
      listItemIds: [...new Set([...current.listItemIds, ...candidate.listItemIds])],
    });
  }
  const entries = [...byKey.values()];
  const vocabulary = new Set(entries.flatMap((entry) => entry.parsed.words.map(singular)));
  return { entries, byKey, vocabulary, expansions: new Map() };
}

/** As palavras do vocabulário que começam por este trecho. */
function expansionsOf(short: string, index: NameIndex): string[] {
  let found = index.expansions.get(short);
  if (!found) {
    found = [...index.vocabulary].filter((word) => word.length > short.length && word.startsWith(short));
    index.expansions.set(short, found);
  }
  return found;
}

type WordMatch = 'no' | 'same' | 'abbreviation' | 'loose-abbreviation';

/**
 * A palavra da nota é a palavra do nome da casa? A nota abrevia cortando a
 * palavra ("DETERG", "FEIJ", "ACUC"): vale quando o trecho não é ele mesmo
 * uma palavra da casa ("papel" não abrevia "papelão"). Para sugerir sem a
 * pessoa pedir, o trecho precisa ser pelo menos metade da palavra e ter uma
 * leitura só ("azeit" pode ser azeite ou azeitona).
 */
function matchWord(noteWord: string, houseWord: string, index: NameIndex): WordMatch {
  if (singular(noteWord) === singular(houseWord)) return 'same';
  if (noteWord.length < 3 || noteWord.startsWith('sem-') || !houseWord.startsWith(noteWord)) return 'no';
  if (index.vocabulary.has(singular(noteWord))) return 'no';
  const readings = new Set(expansionsOf(noteWord, index));
  return readings.size === 1 && noteWord.length * 2 >= houseWord.length ? 'abbreviation' : 'loose-abbreviation';
}

/** Cada palavra do nome da casa aparece no nome da nota (ou o contrário, com `note` e `house` trocados de papel). */
function covers(note: string[], house: string[], index: NameIndex, houseInsideNote: boolean): boolean {
  return houseInsideNote
    ? house.every((h) => note.some((n) => matchWord(n, h, index) !== 'no'))
    : note.every((n) => house.some((h) => matchWord(n, h, index) !== 'no'));
}

/** As palavras do nome da casa aparecem em sequência no nome da nota, a partir de `start`. */
function runAt(note: string[], house: string[], start: number, index: NameIndex): boolean {
  if (start + house.length > note.length) return false;
  return house.every((h, offset) => {
    const match = matchWord(note[start + offset], h, index);
    return match === 'same' || match === 'abbreviation';
  });
}

/** Depois das `count` primeiras palavras vem "de", "em"... e mais uma palavra: é outra coisa ("Leite de coco"). */
function compoundAfter(note: Parsed, count: number): boolean {
  let seen = 0;
  for (let i = 0; i < note.parts.length; i++) {
    if (note.parts[i].kind === 'word') seen += 1;
    if (seen < count) continue;
    const link = note.parts[i + 1];
    return Boolean(link && link.kind === 'link' && COMPOUND.has(link.text) && note.parts.slice(i + 2).some((part) => part.kind === 'word'));
  }
  return false;
}

function isConfident(note: Parsed, candidate: Indexed, index: NameIndex): boolean {
  const house = candidate.parsed;
  // O tamanho (ou a letra) do nome da casa precisa estar no nome novo: "Coca-Cola 2L" não serve para a lata.
  if (!house.variants.every((variant) => note.variants.includes(variant))) return false;
  // Produto da casa com tamanho é um produto certo: o que sobra depois dele no nome novo só pode ser
  // embalagem ("Coca-Cola Lata 350ml" é a Coca-Cola 350ml; "Coca-Cola Zero 2L" não é a Coca-Cola 2L).
  const exactProduct = candidate.source === 'produto' && house.variants.length > 0;
  const fits = (start: number) =>
    runAt(note.words, house.words, start, index) &&
    (!exactProduct || note.words.slice(start + house.words.length).every((word) => PACKAGING.has(singular(word))));
  if (runAt(note.words, house.words, 0, index)) return fits(0) && !compoundAfter(note, house.words.length);
  // Produto da casa escrito com a marca na frente ("Coca-Cola 2L" em "Refrigerante Coca-Cola 2l").
  if (candidate.source !== 'produto' || house.words.length < 2) return false;
  for (let start = 1; start + house.words.length <= note.words.length; start++) {
    if (fits(start)) return true;
  }
  return false;
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
 * por ele não muda nada. Com `onlyConfident`, um nome que já é da casa não
 * ganha sugestão de outro mais genérico ("Batata-doce" não vira "Batata").
 */
export function similarNames(name: string, index: NameIndex, options: SimilarOptions = {}): SimilarName[] {
  const { category, limit = 5, exceptProductId, onlySame = false, onlyConfident = false } = options;
  const typed = name.trim();
  const note = parseName(typed);
  if (!note.key) return [];
  const settled = onlyConfident && index.byKey.has(note.key);

  const found: { candidate: Indexed; closeness: SimilarName['closeness']; confident: boolean; sizeFit: number; extra: number }[] = [];
  for (const candidate of index.entries) {
    if (exceptProductId && candidate.productId === exceptProductId) continue;
    if (candidate.key === note.key) {
      const adds = candidate.productId || candidate.name.toLowerCase() !== typed.toLowerCase();
      if (adds) found.push({ candidate, closeness: 'igual', confident: true, sizeFit: 2, extra: 0 });
      continue;
    }
    const house = candidate.parsed;
    if (onlySame || settled || !note.words.length || !house.words.length) continue;
    // O nome da casa cabe no nome novo (mais genérico), ou o contrário.
    if (!covers(note.words, house.words, index, true) && !covers(note.words, house.words, index, false)) continue;
    const confident = isConfident(note, candidate, index);
    if (onlyConfident && !confident) continue;
    // Mesmo tamanho primeiro; depois nome da casa sem tamanho; por último, tamanho diferente.
    const sizeFit = house.variants.some((variant) => note.variants.includes(variant)) ? 2 : house.variants.length ? 0 : 1;
    found.push({ candidate, closeness: 'parecido', confident, sizeFit, extra: Math.abs(note.words.length - house.words.length) });
  }

  return found
    .sort(
      (a, b) =>
        Number(b.closeness === 'igual') - Number(a.closeness === 'igual') ||
        Number(b.confident) - Number(a.confident) ||
        b.sizeFit - a.sizeFit ||
        // O nome mais completo primeiro: "Leite condensado" antes de "Leite" para o leite condensado.
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

/**
 * A sugestão que aparece no item da nota sem a pessoa pedir: o nome que
 * melhor serve, se for um nome que a casa usa de verdade (produto, lista ou
 * compra). Quando o que melhor serve é um item comum do catálogo ("Leite
 * condensado" para o leite condensado, com "Leite" na lista), não sugere
 * nada: o catálogo aparece só no seletor, para quem está mudando o nome.
 */
export function suggestedName(name: string, index: NameIndex, options: Pick<SimilarOptions, 'category'> = {}): SimilarName | null {
  const [best] = similarNames(name, index, { ...options, limit: 1, onlyConfident: true });
  return best && best.source !== 'comum' ? best : null;
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

/**
 * Os nomes da casa de todas as fontes. Item de lista ou compra ligado a um
 * produto entra com o nome atual do produto (o produto pode ter sido
 * renomeado depois); produto apagado deixa só o nome.
 */
export function nameCandidates({ products, listItems, purchases, common }: NameSources): NameCandidate[] {
  const byId = new Map(products.map((product) => [product.id, product]));
  const linked = (id: string | null, name: string, category: string) => {
    const product = id ? byId.get(id) : undefined;
    return product ? { name: product.name, category: product.category, productId: product.id } : { name, category, productId: null };
  };
  return [
    ...products.map((p): NameCandidate => ({ name: p.name, category: p.category, productId: p.id, source: 'produto', listItemIds: [] })),
    ...listItems.map((i): NameCandidate => ({ ...linked(i.product_id, i.name, i.category), source: 'lista', listItemIds: [i.id] })),
    ...purchases.map((r): NameCandidate => ({ ...linked(r.productId, r.name, r.category), source: 'comprado', listItemIds: [] })),
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

/** A frase que apresenta a sugestão no item da nota. */
export function similarNameHint(similar: Pick<SimilarName, 'closeness' | 'productId' | 'listItemIds'>): string {
  const same = similar.closeness === 'igual';
  if (similar.productId) return same ? 'A casa já tem este produto:' : 'A casa já tem um produto parecido:';
  if (similar.listItemIds.length) return same ? 'Está na lista de compras como:' : 'Parece com um item da lista de compras:';
  return same ? 'A casa já usa este nome:' : 'A casa já usa um nome parecido:';
}
