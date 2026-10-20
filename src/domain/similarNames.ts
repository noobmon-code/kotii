// Nomes parecidos: ao dar nome a um produto na revisão da nota, o app confere
// se a casa já usa um nome parecido (produtos, itens das listas, compras
// recentes e itens comuns). Sem isso, a mesma coisa vira vários itens na
// lista de compras ("Banana", "Bananas", "Banana Prata Kg").

import { listNameKey } from './listLinks';
import { LOOSE_UNITS, OTHER_THING, PACKAGING, singular } from './nameWords';
import { normalizeSearch } from './search';
import { convertQuantity } from './units';

/** De onde vem o nome: da casa (produto, lista, compra), de outro item desta nota ou do catálogo de itens comuns. */
export type NameSource = 'produto' | 'lista' | 'comprado' | 'nota' | 'comum';

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
   * `igual`: o mesmo nome escrito de outro jeito (acento, plural e, sem "de"
   * ou "para" no nome, a ordem das palavras). `parecido`: um nome contém o
   * outro ("Arroz" e "Arroz Tio João 5kg").
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
// Dão um papel a cada palavra: com uma destas, a ordem faz parte do nome ("Suco de laranja" não é "Laranja para suco"). "E" não entra.
const ROLE_LINKS = new Set(['de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'para', 'com', 'ao', 'por']);
// Embalagem (PACKAGING), unidade solta (LOOSE_UNITS) e o que logo depois do nome faz outra coisa (OTHER_THING)
// estão em domain/nameWords, junto do singular: o "mesmo item" da lista e da nota usa as mesmas listas.
// Depois de uma destas, o número é a versão do item ("Arroz Tipo 1", "T.1", "Nº 5"), não um pedaço do tamanho.
const VERSION_WORDS = new Set(['tipo', 'tp', 'tam', 'tamanho', 'numero', 'num', 'nr', 't', 'n', 'no']);
// Marcas curtas demais para ter certeza: depois delas, um número de mais de um dígito com a unidade é o
// tamanho ("Detergente N 500 ml"), não a versão ("Arroz T 1 5kg").
const SHORT_MARKS = new Set(['t', 'n', 'no']);
// A mesma unidade escrita de outro jeito.
const UNIT_ALIASES: Record<string, string> = {
  gr: 'g', grs: 'g', gs: 'g', grama: 'g', gramas: 'g',
  kgs: 'kg', quilo: 'kg', quilos: 'kg', kilo: 'kg', kilos: 'kg',
  lt: 'l', lts: 'l', ls: 'l', litro: 'l', litros: 'l',
  mls: 'ml',
  und: 'un', unid: 'un', uns: 'un', unds: 'un', unidade: 'un', unidades: 'un',
};
const UNITS = new Set(['kg', 'g', 'mg', 'ml', 'l', 'un', 'cm', 'mm', 'm', 'w', 'v', ...Object.keys(UNIT_ALIASES)]);
// Doze unidades.
const DOZEN = new Set(['duzia', 'duzias', 'dz']);
// Versões que fazem outro produto e não estão em nenhum nome do catálogo de itens comuns ("Coca-Cola Zero", "Iogurte
// light"). Só para as sugestões de juntar produtos (saysAnotherKind). Lista fechada e curta: uma palavra só entra
// quando, com certeza, dá nome a outro produto; o que o catálogo já tem não se repete aqui.
const OTHER_VERSIONS = new Set(['zero', 'light', 'diet', 'lite']);
// Tamanho de roupa ou de fralda, sozinho no nome ("Fralda Pampers G"). Unidade colada no número é tamanho de
// embalagem ("20g"), e disso cuidam as regras de tamanho.
const WEAR_SIZES = new Set(['pp', 'p', 'm', 'g', 'gg', 'xg', 'xxg', 'eg']);

// Número, com a vírgula guardada como "p" ("1,5" chega aqui como "1p5": a pontuação sai antes).
const NUMBER = /^\d+(?:p\d+)?$/;
// Número e unidade juntos ("350ml", "1p5l").
const SIZED = /^(\d+(?:p\d+)?)([a-z]+)$/;

/** O número de um jeito só: "1p50" é "1p5", "1p0" é "1". */
function plainNumber(number: string): string {
  const [whole, fraction = ''] = number.split('p');
  const kept = fraction.replace(/0+$/, '');
  return kept ? `${whole}p${kept}` : whole;
}

/** "350ml", "2l", "12un": número e unidade juntos, com a unidade num jeito só. */
function sizeToken(number: string, unit: string): string {
  return `${plainNumber(number)}${UNIT_ALIASES[unit] ?? unit}`;
}

/** Número e unidade num token só ("350ml", "2000ui"); a unidade tem até 4 letras ou é uma conhecida ("2litros"). */
function sizedToken(token: string): [number: string, unit: string] | null {
  const match = SIZED.exec(token);
  return match && (match[2].length <= 4 || UNITS.has(match[2])) ? [match[1], match[2]] : null;
}

interface Part {
  text: string;
  /** `word`: diz o que é o item; `link`: só liga palavras ("de", "em"). */
  kind: 'word' | 'link';
  /** A palavra veio colada na anterior por um hífen ("flor" de "Couve-flor"): as duas juntas são um nome só. */
  joined?: boolean;
}

interface Parsed {
  /** O mesmo para grafias diferentes do mesmo nome. */
  key: string;
  /** As palavras que dizem o que é o item, na ordem, como escritas (sem acento). */
  words: string[];
  /** As palavras no singular, na ordem do nome. */
  order: string;
  /** Tem "de", "para", "com"...: a ordem das palavras faz parte do nome. */
  roles: boolean;
  /** O que distingue versões do mesmo item: tamanho, quantidade, letra ("350ml", "12un", "c" de vitamina C). */
  variants: string[];
  /** Só os tamanhos de verdade, número com unidade ("350ml", "12un" de "c/12" ou "dúzia"). */
  sizes: string[];
  /** Tamanhos que vieram logo depois de um algarismo solto ("1 5l" pode ser 1,5 L): não contam como certos. */
  doubtful: string[];
  /** Palavras de versão que vieram com o número ("tipo" de "Tipo 1"): dizem a versão, não outro produto. */
  versionWords: string[];
  /** Palavras e ligações na ordem do nome. */
  parts: Part[];
}

function parseName(name: string): Parsed {
  const text = normalizeSearch(name)
    // "s/" é sem, "c/" é com: antes de a pontuação sair.
    .replace(/\bs\/\s*/g, 'sem ')
    .replace(/\bc\/\s*/g, 'com ')
    .replace(/\bp\/\s*/g, 'para ')
    // "1,5" é um número só: a vírgula (ou o ponto) vira uma letra, que a chave não tira.
    .replace(/(\d)[.,](\d)/g, '$1p$2');
  const raw = listNameKey(text).split(' ').filter(Boolean);
  // Os tokens que no texto vêm colados no anterior por um hífen ("couve-flor"), pela posição em `raw`.
  const hyphenated = new Set<number>();
  const run = /[a-z0-9]+/g;
  for (let at = 0, found = run.exec(text); found; at += 1, found = run.exec(text)) {
    if (text[found.index - 1] === '-' && /[a-z0-9]/.test(text[found.index - 2] ?? '')) hyphenated.add(at);
  }
  const parts: Part[] = [];
  const variants: string[] = [];
  const sizes: string[] = [];
  const doubtful: string[] = [];
  const versionWords: string[] = [];
  const isNumber = (token: string | undefined) => token != null && NUMBER.test(token);
  // O que vem depois ainda tem palavra? Uma letra no fim ("Vitamina A") é versão, não ligação.
  const wordAfter = (index: number) =>
    raw.slice(index + 1).some((token) => !isNumber(token) && !sizedToken(token) && !LOOSE_UNITS.has(token) && !DOZEN.has(token) && token.length > 1);
  // O token anterior foi um algarismo solto: o tamanho que vier agora ("1 5L") pode ser a parte depois da vírgula.
  let loneDigit = false;
  // A posição do token que virou a última palavra.
  let lastWord = -1;

  for (let i = 0; i < raw.length; i++) {
    const token = raw[i];
    const next = raw[i + 1];
    const afterDigit = loneDigit;
    loneDigit = false;
    const size = (number: string, unit: string) => {
      const sized = sizeToken(number, unit);
      variants.push(sized);
      sizes.push(sized);
      if (afterDigit) doubtful.push(sized);
    };
    const sized = sizedToken(token);
    if (isNumber(token)) {
      // "Tipo 1 Kg", "Tipo 1 5kg", "T.1 5kg", "Nº 5 500g": o número é a versão.
      const mark = i > 0 ? raw[i - 1] : '';
      const sizeAfterMark = SHORT_MARKS.has(mark) && token.length > 1 && next != null && UNITS.has(next);
      const version = VERSION_WORDS.has(mark) && !sizeAfterMark;
      if (!version && next && DOZEN.has(next) && /^\d+$/.test(token)) {
        // "2 dúzias".
        size(String(Number(token) * 12), 'un');
        i += 1;
      } else if (!version && next && UNITS.has(next)) {
        size(token, next);
        i += 1;
      } else {
        variants.push(plainNumber(token));
        loneDigit = !version && /^\d$/.test(token);
      }
    } else if (sized) {
      size(sized[0], sized[1]);
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
      size(next!, 'un');
      i += 1;
    } else if (DOZEN.has(token)) {
      size('12', 'un');
    } else if (LOOSE_UNITS.has(token)) {
      // Unidade solta: nada a dizer.
    } else if (token.length === 1) {
      if (LINKS.has(token) && wordAfter(i)) parts.push({ text: token, kind: 'link' });
      else variants.push(token);
    } else if (LINKS.has(token)) {
      parts.push({ text: token, kind: 'link' });
    } else {
      if (VERSION_WORDS.has(token) && isNumber(next)) versionWords.push(token);
      // Colada por hífen na palavra de antes ("Couve-flor", "Coca-Cola").
      const joined = hyphenated.has(i) && lastWord === i - 1;
      parts.push({ text: token, kind: 'word', ...(joined ? { joined } : {}) });
      lastWord = i;
    }
  }

  const words = parts.filter((part) => part.kind === 'word').map((part) => part.text);
  const singulars = words.map(singular);
  const uniqueVariants = [...new Set(variants)].sort();
  const wordKey = [...new Set(singulars)].sort().join(' ');
  const key = [wordKey, uniqueVariants.join(' ')].filter(Boolean).join(' | ');
  return {
    key,
    words,
    order: singulars.join(' '),
    roles: parts.some((part) => part.kind === 'link' && ROLE_LINKS.has(part.text)),
    variants: uniqueVariants,
    sizes: [...new Set(sizes)],
    doubtful,
    versionWords,
    parts,
  };
}

/** A mesma chave para "Feijão Preto", "feijao preto" e "Preto, feijões"; tamanho e "sem" contam. */
export function similarNameKey(name: string): string {
  return parseName(name).key;
}

/** Os tamanhos que um nome traz, para comparar dois produtos antes de juntar. */
export interface NameSizes {
  /** Cada tamanho de um jeito só ("5kg", "1p5l", "12un"), em ordem: dois nomes com o mesmo tamanho dão a mesma lista. */
  sizes: string[];
  /** Algum tamanho veio depois de um algarismo solto ("Agua 1 5l" pode ser 1,5 L): o número lido pode não ser o do produto. */
  doubtful: boolean;
}

/** Os tamanhos de verdade do nome, número com unidade ("Arroz 5 Kg", "Coca 350ml c/12"); unidade solta não conta. */
export function nameSizes(name: string): NameSizes {
  const parsed = parseName(name);
  return { sizes: [...parsed.sizes].sort(), doubtful: parsed.doubtful.length > 0 };
}

/** O tamanho como a pessoa lê: "5 kg", "1,5 L", "12 un". */
export function sizeLabel(size: string): string {
  const [, number = size, unit = ''] = SIZED.exec(size) ?? [];
  return `${number.replace('p', ',')} ${unit === 'l' ? 'L' : unit}`.trim();
}

/** O número e a unidade de um tamanho como o de `nameSizes` ("1p5l" é 1,5 e "l"). */
function sizeQuantity(size: string): { value: number; unit: string } | null {
  const [, number, unit] = SIZED.exec(size) ?? [];
  return number ? { value: Number(number.replace('p', '.')), unit } : null;
}

/** Os dois tamanhos são a mesma quantidade: o mesmo texto, ou o mesmo peso ou volume em outra unidade ("1kg" e "1000g"). */
function sameQuantity(a: string, b: string): boolean {
  if (a === b) return true;
  const [first, second] = [sizeQuantity(a), sizeQuantity(b)];
  if (!first || !second) return false;
  const converted = convertQuantity(first.value, first.unit, second.unit);
  // A conta é com vírgula flutuante (0,35 L em ml): vale o mesmo número com uma folga mínima.
  return converted != null && Math.abs(converted - second.value) <= 1e-9 * Math.max(1, Math.abs(second.value));
}

/**
 * Os tamanhos de dois nomes (como os de `nameSizes`) são as mesmas quantidades: "5kg" e "5 kg", e também "1kg"
 * e "1000g", "1 L" e "1000 ml". Cada tamanho de um precisa ter o seu no outro ("350ml c/12" não é "350ml").
 */
export function sameSizes(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...b];
  return a.every((size) => {
    const at = left.findIndex((other) => sameQuantity(size, other));
    if (at < 0) return false;
    left.splice(at, 1);
    return true;
  });
}

/**
 * Com a mesma chave, é o mesmo nome se as palavras vêm na mesma ordem ou se
 * nenhum dos dois tem "de", "para", "com"...: "Preto, feijões" é "Feijão
 * preto", mas "Laranja para suco" não é "Suco de laranja".
 */
function sameName(a: Parsed, b: Parsed): boolean {
  return a.key === b.key && (a.order === b.order || !(a.roles || b.roles));
}

// Os nomes que `sameListedName` já leu: a revisão da nota compara os mesmos a cada toque.
const listedNames = new Map<string, Parsed>();
const LISTED_NAMES_LIMIT = 2000;

function parseListed(name: string): Parsed {
  const known = listedNames.get(name);
  if (known) return known;
  if (listedNames.size >= LISTED_NAMES_LIMIT) listedNames.clear();
  const parsed = parseName(name);
  listedNames.set(name, parsed);
  return parsed;
}

/**
 * O item da lista de compras e o produto do item da nota têm o mesmo nome? É
 * o "igual" das sugestões: acento, plural e unidade solta à parte ("Limões" e
 * "Limão", "Banana kg" e "Banana"), e com a ordem das palavras valendo quando
 * um dos dois tem "de", "para", "com"... ("Molho de tomate" não é "Tomate
 * para molho"). A revisão da nota passa esta regra a `matchListItems`.
 */
export function sameListedName(listItemName: string, productName: string): boolean {
  const listed = parseListed(listItemName);
  return listed.key !== '' && sameName(listed, parseListed(productName));
}

interface Indexed extends NameCandidate {
  /** A chave do nome; com as palavras na ordem junto quando outro nome da casa tem as mesmas em outra ordem. */
  key: string;
  parsed: Parsed;
}

/** Os nomes que a casa já usa, prontos para comparar. */
export interface NameIndex {
  entries: Indexed[];
  byKey: Map<string, Indexed>;
  /**
   * As palavras de verdade, no singular: palavra que está aqui não é
   * abreviação. São as do catálogo e as dos itens de lista e compras sem
   * produto; palavra que só aparece em nome de produto entra se não for o
   * começo de outra maior ("deterg", de um produto com o texto da nota
   * fiscal, não tira a leitura de "Detergente").
   */
  vocabulary: Set<string>;
  /** Palavras do vocabulário que começam por um trecho (guardado para não refazer). */
  expansions: Map<string, string[]>;
  /** "X de Y" e "X em Y" que algum nome conhece: X -> os Y ("pao" -> "queijo", "forma"). */
  compounds: Map<string, Set<string>>;
  /**
   * De quantos nomes veio cada coisa que o índice só sabe pelos nomes: as palavras do vocabulário que só nomes de
   * produto trazem e cada par de `compounds` ("X Y"). Serve para conferir o nome de um produto como se ele ainda
   * não existisse: o que só ele ensinou fica de fora (`hidden`, em sameProductPairs).
   */
  learned: { words: Map<string, number>; compounds: Map<string, number> };
  /** O que não vale nesta conferência: palavras do vocabulário e pares de `compounds` ("X Y") que só o nome conferido trouxe. */
  hidden?: { words: ReadonlySet<string>; compounds: ReadonlySet<string> };
}

const SOURCE_RANK: Record<NameSource, number> = { produto: 0, lista: 1, comprado: 2, nota: 3, comum: 4 };

/** A chave com as palavras na ordem: separa nomes com as mesmas palavras que não são o mesmo nome. */
const orderedKey = (parsed: Parsed) => `${parsed.key} > ${parsed.order}`;

/** A entrada do índice que é este mesmo nome, se houver. */
function sameEntry(parsed: Parsed, index: Pick<NameIndex, 'byKey'>): Indexed | undefined {
  const plain = index.byKey.get(parsed.key);
  return plain && sameName(plain.parsed, parsed) ? plain : index.byKey.get(orderedKey(parsed));
}

/** Entre grafias com as mesmas letras, a mais bem escrita: com acento, e sem ser tudo minúsculo ou tudo maiúsculo. */
export function spelling(name: string): number {
  const accents = normalizeSearch(name) !== name.toLowerCase();
  const plainCase = name === name.toLowerCase() || name === name.toUpperCase();
  return (accents ? 2 : 0) + (plainCase ? 0 : 1);
}

/** Os pares que o nome ensina: "Pão de queijo" (pao, queijo) e, colado por hífen, "Couve-flor" (couve, flor). */
function compoundsOf(parsed: Parsed): [head: string, tail: string][] {
  return parsed.parts.flatMap((part, at): [string, string][] => {
    const link: Part | undefined = parsed.parts[at + 1];
    const other: Part | undefined = parsed.parts[at + 2];
    if (part.kind !== 'word') return [];
    // "Pão de queijo" e, colado por hífen, "Couve-flor": o par é um nome só.
    const tail = link?.kind === 'word' && link.joined ? link : link?.kind === 'link' && COMPOUND.has(link.text) && other?.kind === 'word' ? other : null;
    return tail ? [[singular(part.text), singular(tail.text)]] : [];
  });
}

/** O par de `compounds` num texto só, para contar e para esconder. */
const compoundKey = (head: string, tail: string) => `${head} ${tail}`;

/**
 * Junta os nomes de todas as fontes; a mesma grafia em mais de uma fica uma
 * vez só, com a fonte mais forte (produto, lista, compra, item comum), o
 * produto de quem tiver e todos os itens de lista. O nome mostrado é o do
 * produto, como ele é; sem produto, entre nomes com as mesmas letras fica o
 * mais bem escrito ("Açúcar" do catálogo, não o "acucar" da lista), e entre
 * letras diferentes ("Bananas", "Banana"), o da fonte mais forte.
 */
export function indexNames(candidates: readonly NameCandidate[]): NameIndex {
  const byKey = new Map<string, Indexed>();
  // O vocabulário vem dos nomes antes de juntar: depois, cada entrada só guarda a fonte mais forte.
  const real = new Set<string>();
  // Com quantos nomes cada palavra de produto e cada par de `compounds` chegou (um nome conta uma vez).
  const fromProducts = new Map<string, number>();
  const compounds = new Map<string, Set<string>>();
  const compoundNames = new Map<string, number>();
  const count = (counts: Map<string, number>, key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const candidate of candidates) {
    const name = candidate.name.trim();
    const parsed = parseName(name);
    if (!name || !parsed.key) continue;

    // Item de lista ou compra ligado a um produto chega com o nome do produto.
    const ofProduct = candidate.source === 'produto' || candidate.productId != null;
    for (const word of new Set(parsed.words.map(singular))) {
      if (ofProduct) count(fromProducts, word);
      else real.add(word);
    }
    const pairs = compoundsOf(parsed);
    for (const key of new Set(pairs.map(([head, tail]) => compoundKey(head, tail)))) count(compoundNames, key);
    for (const [head, tail] of pairs) compounds.set(head, (compounds.get(head) ?? new Set<string>()).add(tail));

    const plain = byKey.get(parsed.key);
    const key = plain && !sameName(plain.parsed, parsed) ? orderedKey(parsed) : parsed.key;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { ...candidate, name, key, parsed, listItemIds: [...candidate.listItemIds] });
      continue;
    }
    const stronger = SOURCE_RANK[candidate.source] < SOURCE_RANK[current.source];
    const productId = (stronger ? candidate.productId : current.productId) ?? current.productId ?? candidate.productId;
    const sameLetters = normalizeSearch(name) === normalizeSearch(current.name);
    const shows = productId
      ? candidate.productId === productId && current.productId !== productId
      : sameLetters && spelling(name) !== spelling(current.name)
        ? spelling(name) > spelling(current.name)
        : stronger;
    byKey.set(key, {
      ...current,
      ...(shows ? { name, parsed } : {}),
      // Com produto, a categoria é a dele; sem, a da fonte mais forte.
      ...((productId ? shows : stronger) ? { category: candidate.category } : {}),
      source: stronger ? candidate.source : current.source,
      productId,
      listItemIds: [...new Set([...current.listItemIds, ...candidate.listItemIds])],
    });
  }

  const vocabulary = new Set(real);
  const realWords = [...real];
  // As palavras que só os produtos trazem: as do catálogo e das listas valem com qualquer produto fora.
  const learnedWords = new Map<string, number>();
  for (const [word, names] of fromProducts) {
    if (real.has(word)) continue;
    learnedWords.set(word, names);
    if (!realWords.some((longer) => longer.length > word.length && longer.startsWith(word))) vocabulary.add(word);
  }
  return {
    entries: [...byKey.values()],
    byKey,
    vocabulary,
    expansions: new Map(),
    compounds,
    learned: { words: learnedWords, compounds: compoundNames },
  };
}

/** O nome que a casa já usa e é este mesmo nome (acento, plural e maiúsculas à parte), se houver. */
export function knownName(name: string, index: NameIndex): (NameCandidate & { key: string }) | null {
  const parsed = parseName(name.trim());
  return (parsed.key && sameEntry(parsed, index)) || null;
}

/** A palavra é do vocabulário, e não uma que só o nome conferido trouxe (`hidden`). */
const inVocabulary = (word: string, index: NameIndex) => index.vocabulary.has(word) && !index.hidden?.words.has(word);

/** As palavras do vocabulário que começam por este trecho. */
function expansionsOf(short: string, index: NameIndex): string[] {
  let found = index.expansions.get(short);
  if (!found) {
    // O que fica guardado é do vocabulário inteiro: o que está escondido sai na hora, a cada conferência.
    found = [...index.vocabulary].filter((word) => word.length > short.length && word.startsWith(short));
    index.expansions.set(short, found);
  }
  const { hidden } = index;
  return hidden?.words.size ? found.filter((word) => !hidden.words.has(word)) : found;
}

type WordMatch = 'no' | 'same' | 'abbreviation' | 'loose-abbreviation';

/**
 * A palavra da nota é a palavra do nome da casa? A nota abrevia cortando a
 * palavra ("DETERG", "FEIJ", "ACUC"): vale quando o trecho não é ele mesmo
 * uma palavra de verdade ("papel" não abrevia "papelão"). Para sugerir sem a
 * pessoa pedir, o trecho precisa ser pelo menos metade da palavra, ter uma
 * leitura só ("azeit" pode ser azeite ou azeitona) e não terminar em vogal:
 * o corte da nota para no meio da palavra, e "Goiaba" não é "Goiabada".
 */
function matchWord(noteWord: string, houseWord: string, index: NameIndex): WordMatch {
  if (singular(noteWord) === singular(houseWord)) return 'same';
  if (noteWord.length < 3 || noteWord.startsWith('sem-') || !houseWord.startsWith(noteWord)) return 'no';
  if (inVocabulary(singular(noteWord), index)) return 'no';
  const readings = new Set(expansionsOf(noteWord, index));
  const cut = readings.size === 1 && noteWord.length * 2 >= houseWord.length && !/[aeiou]$/.test(noteWord);
  return cut ? 'abbreviation' : 'loose-abbreviation';
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

/**
 * Depois das `count` primeiras palavras, o nome vira outra coisa:
 * - vem "de" ou "em" e uma palavra que não é embalagem ("Leite de coco"; "Skol em lata" continua sendo a Skol);
 * - a palavra seguinte faz outra coisa mesmo sem ligação ("Batata palha", "Leite coco": OTHER_THING);
 * - algum nome conhecido liga `last` (a última palavra do nome da casa) a essa palavra com "de", "em" ou um
 *   hífen ("Pão queijo", com "Pão de queijo congelado" no catálogo; "Couve flor", com "Couve-flor"). O hífen
 *   sozinho, num nome que ninguém conhece, não basta: "Banana-prata" continua sendo a banana.
 */
function otherThingAfter(name: Parsed, count: number, last: string, index: NameIndex): boolean {
  let at = 0;
  for (let seen = 0; at < name.parts.length && seen < count; at++) {
    if (name.parts[at].kind === 'word') seen += 1;
  }
  const rest = name.parts.slice(at);
  const next = rest.find((part) => part.kind === 'word');
  if (!next) return false;
  const word = singular(next.text);
  const linked = rest[0].kind === 'link' && COMPOUND.has(rest[0].text) && rest[1] === next;
  if (linked && !PACKAGING.has(word)) return true;
  if (OTHER_THING.has(word) || OTHER_THING.has(next.text)) return true;
  const head = singular(last);
  return Boolean(index.compounds.get(head)?.has(word)) && !index.hidden?.compounds.has(compoundKey(head, word));
}

/** Onde o nome da casa cabe com confiança no nome novo: a posição da primeira palavra dele, ou -1 se não cabe. */
function confidentAt(note: Parsed, candidate: Indexed, index: NameIndex): number {
  const house = candidate.parsed;
  // O tamanho (ou a letra) do nome da casa precisa estar no nome novo, e sem dúvida: "Coca-Cola 2L" não serve
  // para a lata, nem "Água 5L" para "Agua 1 5l".
  if (!house.variants.every((variant) => note.variants.includes(variant) && !note.doubtful.includes(variant))) return -1;
  // Produto da casa com tamanho é um produto certo: o nome novo tem os mesmos tamanhos, nem um a mais ("c/12" é o
  // fardo, não a unidade), e o que sobra depois dele só pode ser embalagem ("Coca-Cola Lata 350ml" é a Coca-Cola
  // 350ml; "Coca-Cola Zero 2L" não é a Coca-Cola 2L) ou a palavra de versão com o número ("Arroz Tio João Tipo 1
  // 5kg" é o Arroz Tio João 5kg). Letra ou número de versão ("Vitamina C") não faz produto certo.
  const exactProduct = candidate.source === 'produto' && house.sizes.length > 0;
  if (exactProduct && note.sizes.length !== house.sizes.length) return -1;
  const last = house.words[house.words.length - 1];
  const tolerated = (word: string) => PACKAGING.has(singular(word)) || note.versionWords.includes(word);
  const fits = (start: number) => {
    const end = start + house.words.length;
    return (
      runAt(note.words, house.words, start, index) &&
      (!exactProduct || note.words.slice(end).every(tolerated)) &&
      !otherThingAfter(note, end, last, index)
    );
  };
  if (runAt(note.words, house.words, 0, index)) return fits(0) ? 0 : -1;
  // No meio do nome, só o produto certo escrito com o tipo na frente ("Coca-Cola 2L" em "Refrigerante Coca-Cola
  // 2l"): um produto sem tamanho no meio do nome é sabor ou ingrediente ("Sardinha Molho de Tomate").
  if (!exactProduct || house.words.length < 2) return -1;
  for (let start = 1; start + house.words.length <= note.words.length; start++) {
    if (fits(start)) return start;
  }
  return -1;
}

function isConfident(note: Parsed, candidate: Indexed, index: NameIndex): boolean {
  return confidentAt(note, candidate, index) >= 0;
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
  /**
   * Outros nomes para conferir junto (os que a pessoa deu nesta nota). Nome que a casa já usa não se repete; nome
   * que `index` só tem do catálogo dá lugar ao desta nota, com a categoria que a pessoa escolheu.
   */
  also?: NameIndex;
}

interface Found {
  candidate: Indexed;
  closeness: SimilarName['closeness'];
  confident: boolean;
  sizeFit: number;
  extra: number;
}

/** Nome que a casa usa de verdade: os de outros itens da nota e os do catálogo não são. */
const isHousehold = (source: NameSource) => source === 'produto' || source === 'lista' || source === 'comprado';

/**
 * Os nomes parecidos com `typed`, do mais parecido para o menos. `among`: só estes nomes do índice são
 * conferidos, e `typed` é o nome de um produto que já existe, visto como se ainda não existisse (o produto
 * dele fica de fora por `exceptProductId`, e o que só o nome dele ensinou ao índice, por `index.hidden`): a
 * entrada do índice com este nome é a dele mesmo, não um nome que a casa já usava.
 */
function findSimilar(typed: string, note: Parsed, index: NameIndex, options: SimilarOptions, among?: readonly Indexed[]): Found[] {
  const { category, exceptProductId, onlySame = false, onlyConfident = false, also } = options;
  // Nome que já é da casa (catálogo não conta) não ganha sugestão de outro mais genérico.
  const settled = onlyConfident && !among && isHousehold(sameEntry(note, index)?.source ?? 'comum');
  let entries: readonly Indexed[] = among ?? index.entries;
  if (also) {
    // O mesmo nome nos dois: o da casa vale; o que é só do catálogo sai, e fica o desta nota.
    const replaced = new Set<Indexed>();
    const extra = also.entries.filter((entry) => {
      const same = sameEntry(entry.parsed, index);
      // O desta nota que é só o digitado com outro acento ou maiúscula não será oferecido: o do catálogo fica.
      const offered = normalizeSearch(entry.name) !== normalizeSearch(typed);
      if (same && !isHousehold(same.source) && offered) replaced.add(same);
      return !same || !isHousehold(same.source);
    });
    entries = [...index.entries.filter((entry) => !replaced.has(entry)), ...extra];
  }

  const found: Found[] = [];
  for (const candidate of entries) {
    if (exceptProductId && candidate.productId === exceptProductId) continue;
    const house = candidate.parsed;
    if (sameName(note, house)) {
      // Sem produto, só vale oferecer o que muda mais que a maiúscula e não é só o nome digitado sem os acentos
      // ("acucar" da lista para "Açúcar": a lista já trata os dois como o mesmo).
      const spelled = candidate.name.toLowerCase();
      const adds = candidate.productId || (spelled !== typed.toLowerCase() && spelled !== normalizeSearch(typed));
      if (adds) found.push({ candidate, closeness: 'igual', confident: true, sizeFit: 2, extra: 0 });
      continue;
    }
    if (onlySame || settled || !note.words.length || !house.words.length) continue;
    // As mesmas palavras em outra ordem ("Laranja para suco" e "Suco de laranja"): parecido, nunca para sugerir sozinho.
    const reordered = house.key === note.key;
    // O nome da casa cabe no nome novo (mais genérico), ou o contrário.
    if (!reordered && !covers(note.words, house.words, index, true) && !covers(note.words, house.words, index, false)) continue;
    const confident = !reordered && isConfident(note, candidate, index);
    if (onlyConfident && !confident) continue;
    // Mesmo tamanho primeiro; depois nome da casa sem tamanho; por último, tamanho diferente. Nome digitado sem
    // tamanho não põe o nome da casa com tamanho atrás do sem.
    const sameSize = house.variants.some((variant) => note.variants.includes(variant) && !note.doubtful.includes(variant));
    const sizeFit = !note.variants.length ? 1 : sameSize ? 2 : house.variants.length ? 0 : 1;
    found.push({ candidate, closeness: 'parecido', confident, sizeFit, extra: Math.abs(note.words.length - house.words.length) });
  }

  const bySource = (a: Found, b: Found) => SOURCE_RANK[a.candidate.source] - SOURCE_RANK[b.candidate.source];
  // O nome mais completo primeiro: "Leite condensado" antes de "Leite" para o leite condensado.
  const byExtra = (a: Found, b: Found) => a.extra - b.extra;
  return found.sort(
    (a, b) =>
      Number(b.closeness === 'igual') - Number(a.closeness === 'igual') ||
      Number(b.confident) - Number(a.confident) ||
      b.sizeFit - a.sizeFit ||
      // Entre os que só parecem (o seletor), os nomes da casa vêm antes dos do catálogo.
      (a.confident ? byExtra(a, b) || bySource(a, b) : bySource(a, b) || byExtra(a, b)) ||
      Number(b.candidate.category === category) - Number(a.candidate.category === category) ||
      a.candidate.name.length - b.candidate.name.length ||
      a.candidate.name.localeCompare(b.candidate.name, 'pt-BR'),
  );
}

const toSimilar = ({ candidate, closeness, confident }: Found): SimilarName => ({
  name: candidate.name,
  category: candidate.category,
  productId: candidate.productId,
  source: candidate.source,
  listItemIds: candidate.listItemIds,
  key: candidate.key,
  closeness,
  confident,
});

/**
 * Os nomes que a casa já usa e se parecem com `name`, do mais parecido para o
 * menos. Um nome idêntico só entra se trouxer um produto: sem produto, trocar
 * por ele não muda nada. Com `onlyConfident`, um nome que já é da casa não
 * ganha sugestão de outro mais genérico ("Batata-doce" não vira "Batata").
 */
export function similarNames(name: string, index: NameIndex, options: SimilarOptions = {}): SimilarName[] {
  const typed = name.trim();
  const note = parseName(typed);
  if (!note.key) return [];
  return findSimilar(typed, note, index, options)
    .slice(0, options.limit ?? 5)
    .map(toSimilar);
}

/**
 * Algum outro nome conhecido (da casa ou do catálogo) é mais comprido que o
 * escolhido, começa por ele, também cabe no começo do nome novo (nem que seja
 * por uma abreviação duvidosa) e é outra coisa: "Leite condensado" para
 * "Leite cond moca", com "Leite" na lista. Na dúvida, o item não sugere nada.
 */
function vetoed(note: Parsed, chosen: Indexed, index: NameIndex): boolean {
  const base = chosen.parsed.words;
  const last = base[base.length - 1];
  return index.entries.some((entry) => {
    const words = entry.parsed.words;
    if (entry === chosen || words.length <= base.length || words.length > note.words.length) return false;
    if (!base.every((word, at) => singular(word) === singular(words[at]))) return false;
    if (!words.every((word, at) => matchWord(note.words[at], word, index) !== 'no')) return false;
    return otherThingAfter(entry.parsed, base.length, last, index);
  });
}

/**
 * A sugestão que aparece no item da nota sem a pessoa pedir: o melhor nome
 * que a casa usa de verdade (produto, lista ou compra) e dá para sugerir.
 * O catálogo de itens comuns nunca é sugerido aqui e não cala o nome da
 * casa ("Leite" continua valendo para "Leite Integral Italac 1L", com "Leite
 * integral" no catálogo); só segura a sugestão quando um nome mais comprido,
 * dele ou da casa, mostra que o item é outra coisa (ver `vetoed`).
 */
export function suggestedName(name: string, index: NameIndex, options: Pick<SimilarOptions, 'category'> = {}): SimilarName | null {
  const typed = name.trim();
  const note = parseName(typed);
  if (!note.key) return null;
  const best = findSimilar(typed, note, index, { category: options.category, onlyConfident: true }).find((found) =>
    isHousehold(found.candidate.source),
  );
  if (!best || (best.closeness !== 'igual' && vetoed(note, best.candidate, index))) return null;
  return toSimilar(best);
}

/** Um produto da casa, para procurar outro que seja o mesmo. */
export interface ProductName {
  id: string;
  name: string;
  category: string;
}

/** Dois produtos da casa que, pelos nomes, parecem o mesmo. */
export interface SameProductPair {
  /** O produto cujo nome foi conferido e o que a regra achou para ele. */
  ids: [string, string];
  /** `igual`: o mesmo nome com outra grafia; `parecido`: o nome de um cabe no do outro (com a marca ou sem). */
  closeness: SimilarName['closeness'];
}

/**
 * As palavras dos nomes do catálogo de itens comuns, como na chave dos nomes (sem acento, minúsculas, no
 * singular): "integral", "desnatado", "gas", "frances", "mascavo", "moida"... Cada uma dá nome a um tipo de
 * produto. De "Leite sem lactose" entram "sem-lactose" e "lactose".
 */
export function kindWords(common: readonly { name: string }[]): Set<string> {
  const words = new Set<string>();
  for (const { name } of common) {
    for (const word of parseName(name).words.map(singular)) {
      words.add(word);
      if (word.startsWith('sem-')) words.add(word.slice('sem-'.length));
    }
  }
  return words;
}

/**
 * O que um nome tem a mais que o outro diz que é outro tipo de produto, e não o mesmo com a marca? Só para as
 * sugestões de juntar produtos, que aparecem sem a pessoa pedir: na dúvida, o app não sugere. `extra`: as
 * palavras a mais, como na chave dos nomes (sem acento, minúsculas, no singular). É outro tipo quando uma delas:
 * - é palavra de um nome do catálogo (`kinds`, de `kindWords`): "Leite integral", "Açúcar mascavo", "Água com gás";
 * - vem com "sem", que muda o item ("sem-sal", "sem-alcool"), ou é o próprio "sem";
 * - é uma versão que o catálogo não tem ("zero", "light"): OTHER_VERSIONS;
 * - é um tamanho de roupa ou de fralda sozinho ("g" de "Fralda Pampers G"): WEAR_SIZES.
 * Embalagem ("lata", "pet", "caixa") nunca é outro tipo, nem quando o catálogo a tem ("Sardinha em lata"). Uma
 * variedade que o catálogo não conhece ("Limão siciliano") passa por marca: não dá para separar as duas.
 */
export function saysAnotherKind(extra: readonly string[], kinds: ReadonlySet<string>): boolean {
  return extra.some(
    (word) => !PACKAGING.has(word) && (word === 'sem' || word.startsWith('sem-') || kinds.has(word) || OTHER_VERSIONS.has(word) || WEAR_SIZES.has(word)),
  );
}

const NO_KINDS: ReadonlySet<string> = new Set();

/**
 * O que o nome mais comprido tem além do mais curto, que acaba na palavra de número `end` dele: as palavras
 * que vêm depois, no singular, e as letras e números soltos que só ele traz ("g" de "Fralda Pampers G"). A
 * palavra de versão que veio com o número ("tipo" de "Tipo 1") não conta: diz a versão, não outro produto.
 */
function extraWords(longer: Parsed, shorter: Parsed, end: number): string[] {
  const loose = longer.variants.filter((variant) => !longer.sizes.includes(variant) && !shorter.variants.includes(variant));
  return [
    ...longer.words
      .slice(end)
      .filter((word) => !longer.versionWords.includes(word))
      .map(singular),
    ...loose,
  ];
}

/**
 * O par que a sugestão do item da nota daria, mas com outro tipo de produto no nome mais comprido: o que ele
 * tem a mais depois do nome mais curto ("integral" de "Leite integral") ou, antes dele, uma versão ("zero" de
 * "Refrigerante Zero Coca-Cola 2L"). Antes dele, a palavra do catálogo é o tipo escrito na frente
 * ("Refrigerante Coca-Cola 2l" é a "Coca-Cola 2L"), que a regra do produto certo já aceita.
 */
function anotherKind(note: Parsed, candidate: Indexed, index: NameIndex, kinds: ReadonlySet<string>): boolean {
  const start = confidentAt(note, candidate, index);
  const end = start + candidate.parsed.words.length;
  return saysAnotherKind(extraWords(note, candidate.parsed, end), kinds) || saysAnotherKind(note.words.slice(0, start).map(singular), NO_KINDS);
}

/**
 * Os dois nomes trazem tamanho, e é o mesmo produto com a marca ou sem ("Arroz 5kg" e "Arroz Tio João 5 kg").
 * A sugestão do item da nota não chega aqui: para ela, produto com tamanho só aceita embalagem a mais, porque
 * não sabe se o resto é marca ou outro tipo ("Coca-Cola Zero 2L"). Com `saysAnotherKind` dá para saber:
 * - os tamanhos são as mesmas quantidades (`sameSizes`: "1kg" e "1000g" também), lidos sem dúvida;
 * - as palavras do nome mais curto são o começo das do mais comprido (cortadas como na nota também valem);
 * - a letra ou o número de versão do mais curto está no outro ("Vitamina C 500mg" não é a "Vitamina D 500mg");
 * - o que o mais comprido tem a mais não faz outra coisa ("Leite de coco 1L") nem diz outro tipo.
 */
function sameSizeFit(note: Parsed, candidate: Indexed, index: NameIndex, kinds: ReadonlySet<string>): boolean {
  const house = candidate.parsed;
  const end = house.words.length;
  if (!end || !house.sizes.length || !note.sizes.length || house.doubtful.length || note.doubtful.length) return false;
  if (!sameSizes(house.sizes, note.sizes)) return false;
  if (!house.variants.every((variant) => house.sizes.includes(variant) || note.variants.includes(variant))) return false;
  if (!runAt(note.words, house.words, 0, index) || otherThingAfter(note, end, house.words[end - 1], index)) return false;
  return !saysAnotherKind(extraWords(note, house, end), kinds);
}

/**
 * Os pares de produtos que já existem e parecem o mesmo produto, para o app sugerir juntar.
 * - `igual`: o mesmo nome com outro acento, plural, unidade solta ou ordem das palavras ("Limão" e "Limões",
 *   "Banana Prata Kg" e "Banana prata"). Vale entre todos os produtos com esse nome.
 * - `parecido`, pela sugestão que o item da nota mostra sem a pessoa pedir (`suggestedName`), com cada nome
 *   conferido como se chegasse agora numa nota e o produto dele ainda não existisse: o melhor nome que cabe
 *   nele com confiança, em geral o mesmo produto com a marca ou sem ("Arroz" e "Arroz Tio João 5kg"). Um produto
 *   com tamanho é um produto certo: só o que tem o mesmo tamanho e, de resto, embalagem ou versão ("Coca-Cola
 *   2L" e "Refrigerante Coca-Cola 2l Pet"). Daqui sai o par em que o nome mais comprido diz outro tipo de
 *   produto ("Leite" e "Leite integral", "Coca-Cola" e "Coca-Cola Zero": `saysAnotherKind`).
 * - `parecido`, pelo mesmo tamanho nos dois nomes, com a marca dentro ou fora ("Arroz 5kg" e "Arroz Tio João 5
 *   kg": `sameSizeFit`). Este a nota não sugere.
 * Produto que tem outro com o mesmo nome fica só com esse par, como o nome que já é da casa na nota. Na nota
 * nada muda: as duas diferenças valem só aqui.
 * `common`: o catálogo de itens comuns, que mostra quando o nome mais comprido é outra coisa ("Pão de queijo",
 * "Leite condensado") ou outro tipo ("Leite integral").
 */
export function sameProductPairs(products: readonly ProductName[], common: NameSources['common'] = []): SameProductPair[] {
  const index = indexNames(nameCandidates({ products, listItems: [], purchases: [], common }));
  const kinds = kindWords(common);
  const named = products
    .map((product) => ({ product, typed: product.name.trim(), parsed: parseName(product.name.trim()) }))
    .filter(({ parsed }) => parsed.key);
  const pairs = new Map<string, SameProductPair>();
  const add = (a: string, b: string, closeness: SameProductPair['closeness']) => {
    const key = a < b ? `${a} ${b}` : `${b} ${a}`;
    if (a !== b && !pairs.has(key)) pairs.set(key, { ids: [a, b], closeness });
  };

  // O mesmo nome com outra grafia: no índice os dois viram uma entrada só, então a conta é feita aqui.
  const byKey = new Map<string, typeof named>();
  for (const entry of named) byKey.set(entry.parsed.key, [...(byKey.get(entry.parsed.key) ?? []), entry]);
  const twins = new Set<string>();
  for (const group of byKey.values()) {
    group.forEach((a, at) => {
      for (const b of group.slice(at + 1)) {
        if (!sameName(a.parsed, b.parsed)) continue;
        add(a.product.id, b.product.id, 'igual');
        twins.add(a.product.id).add(b.product.id);
      }
    });
  }

  // Um nome só cabe com confiança em outro que tenha a primeira palavra dele (inteira, ou cortada como na
  // nota): os produtos ficam guardados por ela, para cada nome não ser conferido com a casa inteira.
  const byFirstWord = new Map<string, Indexed[]>();
  for (const entry of index.entries) {
    const [first] = entry.parsed.words;
    if (entry.source === 'produto' && first) byFirstWord.set(first, [...(byFirstWord.get(first) ?? []), entry]);
  }
  const firstWords = [...byFirstWord.keys()].map((word) => ({ word, one: singular(word) }));
  for (const { product, typed, parsed } of named) {
    if (twins.has(product.id) || !parsed.words.length) continue;
    const ones = new Set(parsed.words.map(singular));
    const among = firstWords.flatMap(({ word, one }) =>
      ones.has(one) || parsed.words.some((cut) => cut.length >= 3 && word.startsWith(cut)) ? byFirstWord.get(word)! : [],
    );
    if (!among.length) continue;
    // Como se o produto ainda não existisse: o que só o nome dele ensinou ao índice (uma palavra cortada que
    // contaria como palavra de verdade, um "Banana-prata" que passaria por nome conhecido) não vale para ele.
    const own = {
      words: new Set(parsed.words.map(singular).filter((word) => index.learned.words.get(word) === 1)),
      compounds: new Set(
        compoundsOf(parsed)
          .map(([head, tail]) => compoundKey(head, tail))
          .filter((key) => index.learned.compounds.get(key) === 1),
      ),
    };
    const view: NameIndex = { ...index, hidden: own };
    const [best] = findSimilar(typed, parsed, view, { category: product.category, onlyConfident: true, exceptProductId: product.id }, among);
    if (best?.candidate.productId) {
      const same = best.closeness === 'igual';
      if (same || !(vetoed(parsed, best.candidate, view) || anotherKind(parsed, best.candidate, view, kinds))) {
        add(product.id, best.candidate.productId, best.closeness);
      }
    }
    if (!parsed.sizes.length) continue;
    // O mesmo tamanho com a marca dentro ou fora: o nome mais completo que servir.
    const [sized] = among
      .filter((candidate) => candidate.productId && candidate.productId !== product.id)
      .filter((candidate) => sameSizeFit(parsed, candidate, view, kinds) && !vetoed(parsed, candidate, view))
      .sort((a, b) => b.parsed.words.length - a.parsed.words.length || a.name.localeCompare(b.name, 'pt-BR'));
    if (sized?.productId) add(product.id, sized.productId, 'parecido');
  }
  return [...pairs.values()];
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
  nota: 'Nesta nota',
  comum: 'Item comum (catálogo)',
};

/** De onde o nome vem, para mostrar ao lado dele. */
export function nameSourceLabel(candidate: Pick<NameCandidate, 'source' | 'listItemIds'>): string {
  // Produto que também está numa lista aberta: a lista é o que a pessoa reconhece.
  return candidate.source === 'produto' && candidate.listItemIds.length ? 'Produto da casa, na lista de compras' : SOURCE_LABELS[candidate.source];
}

/** O botão que usa o nome que já existe no lugar do digitado. Nome que só o catálogo tem não "já existe" na casa. */
export function existingNameLabel(existing: Pick<NameCandidate, 'name' | 'source'>): string {
  if (existing.source === 'comum') return `Usar "${existing.name}"`;
  return `Usar "${existing.name}" (${existing.source === 'nota' ? 'já está nesta nota' : 'já existe'})`;
}

/** A frase que apresenta a sugestão no item da nota. */
export function similarNameHint(similar: Pick<SimilarName, 'closeness' | 'productId' | 'listItemIds'>): string {
  const same = similar.closeness === 'igual';
  if (similar.productId) return same ? 'A casa já tem este produto:' : 'A casa já tem um produto parecido:';
  // Usar o nome do item da lista marca o item para sair dela.
  if (similar.listItemIds.length) {
    return same ? 'Está na lista de compras como (sai dela ao confirmar):' : 'Parece com um item da lista de compras (sai dela ao confirmar):';
  }
  return same ? 'A casa já usa este nome:' : 'A casa já usa um nome parecido:';
}
