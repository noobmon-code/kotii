// Nomes parecidos: ao dar nome a um produto na revisão da nota, o app confere
// se a casa já usa um nome parecido (produtos, itens das listas, compras
// recentes e itens comuns). Sem isso, a mesma coisa vira vários itens na
// lista de compras ("Banana", "Bananas", "Banana Prata Kg").

import { listNameKey } from './listLinks';
import { normalizeSearch } from './search';

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
// Embalagem: não muda o produto.
const PACKAGING = new Set([
  'lata', 'latinha', 'garrafa', 'pet', 'vidro', 'frasco', 'pote', 'caixa', 'caixinha', 'pacote', 'pack', 'fardo', 'sache',
  'refil', 'bandeja', 'barra', 'tablete', 'rolo', 'embalagem', 'granel', 'long', 'neck', 'tetra', 'pak',
]);
// Logo depois do nome da casa, fazem outra coisa mesmo sem "de" ou "em", que a nota fiscal corta ("Leite coco",
// "Batata palha", "Água tônica", "Óleo motor"). No singular e sem acento. É uma lista fechada, só para a sugestão
// que aparece sem a pessoa pedir: não é para crescer junto com o catálogo de itens comuns.
const OTHER_THING = new Set([
  'coco', 'soja', 'queijo', 'palha', 'tonica', 'oxigenada', 'sanitaria', 'poro', 'cacau', 'fruta', 'lactea', 'fermentado',
  'condensado', 'evaporado', 'toalha', 'higienico', 'po', 'doce', 'instantaneo', 'vegetal', 'ingles', 'chips', 'alho',
  'motor', 'passa', 'empanado', 'frita', 'frito',
]);
// Depois de uma destas, o número é a versão do item ("Arroz Tipo 1", "T.1", "Nº 5"), não um pedaço do tamanho.
const VERSION_WORDS = new Set(['tipo', 'tp', 'tam', 'tamanho', 'numero', 'num', 'nr', 't', 'n', 'no']);
// Unidade solta ("Banana Prata Kg", "Alface Unidade") não diz o que é o item nem o tamanho.
const LOOSE_UNITS = new Set([
  'kg', 'gr', 'mg', 'ml', 'lt', 'un', 'und', 'unid', 'pct', 'pc', 'cx', 'fd', 'cm', 'mm',
  'litro', 'litros', 'quilo', 'quilos', 'kilo', 'kilos', 'grama', 'gramas', 'unidade', 'unidades',
]);
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
      const version = i > 0 && VERSION_WORDS.has(raw[i - 1]);
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
function spelling(name: string): number {
  const accents = normalizeSearch(name) !== name.toLowerCase();
  const plainCase = name === name.toLowerCase() || name === name.toUpperCase();
  return (accents ? 2 : 0) + (plainCase ? 0 : 1);
}

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
  const fromProducts = new Set<string>();
  const compounds = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const name = candidate.name.trim();
    const parsed = parseName(name);
    if (!name || !parsed.key) continue;

    // Item de lista ou compra ligado a um produto chega com o nome do produto.
    const ofProduct = candidate.source === 'produto' || candidate.productId != null;
    for (const word of parsed.words) (ofProduct ? fromProducts : real).add(singular(word));
    parsed.parts.forEach((part, at) => {
      const link: Part | undefined = parsed.parts[at + 1];
      const other: Part | undefined = parsed.parts[at + 2];
      if (part.kind !== 'word' || link?.kind !== 'link' || !COMPOUND.has(link.text) || other?.kind !== 'word') return;
      const head = singular(part.text);
      compounds.set(head, (compounds.get(head) ?? new Set<string>()).add(singular(other.text)));
    });

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
  for (const word of fromProducts) {
    if (!realWords.some((longer) => longer.length > word.length && longer.startsWith(word))) vocabulary.add(word);
  }
  return { entries: [...byKey.values()], byKey, vocabulary, expansions: new Map(), compounds };
}

/** O nome que a casa já usa e é este mesmo nome (acento, plural e maiúsculas à parte), se houver. */
export function knownName(name: string, index: NameIndex): (NameCandidate & { key: string }) | null {
  const parsed = parseName(name.trim());
  return (parsed.key && sameEntry(parsed, index)) || null;
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
 * uma palavra de verdade ("papel" não abrevia "papelão"). Para sugerir sem a
 * pessoa pedir, o trecho precisa ser pelo menos metade da palavra, ter uma
 * leitura só ("azeit" pode ser azeite ou azeitona) e não terminar em vogal:
 * o corte da nota para no meio da palavra, e "Goiaba" não é "Goiabada".
 */
function matchWord(noteWord: string, houseWord: string, index: NameIndex): WordMatch {
  if (singular(noteWord) === singular(houseWord)) return 'same';
  if (noteWord.length < 3 || noteWord.startsWith('sem-') || !houseWord.startsWith(noteWord)) return 'no';
  if (index.vocabulary.has(singular(noteWord))) return 'no';
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
 * - a palavra seguinte vem colada por um hífen ("Couve-flor" não é "Couve", nem "Coca-Cola" é "Coca");
 * - a palavra seguinte faz outra coisa mesmo sem ligação ("Batata palha", "Leite coco": OTHER_THING);
 * - algum nome conhecido liga `last` (a última palavra do nome da casa) a essa palavra com "de" ou "em"
 *   ("Pão queijo", com "Pão de queijo congelado" no catálogo).
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
  if (next.joined && rest[0] === next) return true;
  if (OTHER_THING.has(word) || OTHER_THING.has(next.text)) return true;
  return index.compounds.get(singular(last))?.has(word) ?? false;
}

function isConfident(note: Parsed, candidate: Indexed, index: NameIndex): boolean {
  const house = candidate.parsed;
  // O tamanho (ou a letra) do nome da casa precisa estar no nome novo, e sem dúvida: "Coca-Cola 2L" não serve
  // para a lata, nem "Água 5L" para "Agua 1 5l".
  if (!house.variants.every((variant) => note.variants.includes(variant) && !note.doubtful.includes(variant))) return false;
  // Produto da casa com tamanho é um produto certo: o nome novo tem os mesmos tamanhos, nem um a mais ("c/12" é o
  // fardo, não a unidade), e o que sobra depois dele só pode ser embalagem ("Coca-Cola Lata 350ml" é a Coca-Cola
  // 350ml; "Coca-Cola Zero 2L" não é a Coca-Cola 2L) ou a palavra de versão com o número ("Arroz Tio João Tipo 1
  // 5kg" é o Arroz Tio João 5kg). Letra ou número de versão ("Vitamina C") não faz produto certo.
  const exactProduct = candidate.source === 'produto' && house.sizes.length > 0;
  if (exactProduct && note.sizes.length !== house.sizes.length) return false;
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
  if (runAt(note.words, house.words, 0, index)) return fits(0);
  // No meio do nome, só o produto certo escrito com o tipo na frente ("Coca-Cola 2L" em "Refrigerante Coca-Cola
  // 2l"): um produto sem tamanho no meio do nome é sabor ou ingrediente ("Sardinha Molho de Tomate").
  if (!exactProduct || house.words.length < 2) return false;
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

/** Os nomes parecidos com `typed`, do mais parecido para o menos. */
function findSimilar(typed: string, note: Parsed, index: NameIndex, options: SimilarOptions): Found[] {
  const { category, exceptProductId, onlySame = false, onlyConfident = false, also } = options;
  // Nome que já é da casa (catálogo não conta) não ganha sugestão de outro mais genérico.
  const settled = onlyConfident && isHousehold(sameEntry(note, index)?.source ?? 'comum');
  let entries = index.entries;
  if (also) {
    // O mesmo nome nos dois: o da casa vale; o que é só do catálogo sai, e fica o desta nota.
    const replaced = new Set<Indexed>();
    const extra = also.entries.filter((entry) => {
      const same = sameEntry(entry.parsed, index);
      if (same && !isHousehold(same.source)) replaced.add(same);
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
