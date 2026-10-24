// Abreviações aprendidas com as notas da casa. Cada nota confirmada liga a
// descrição da nota ao produto que a casa nomeou (product_aliases: "LT INTEG
// PIRAC 1L" -> "Leite Integral Piracanjuba 1L"), e daí sai "palavra da nota
// -> palavra por extenso" do jeito que os mercados da casa abreviam. A tabela
// fixa (spelledOut, em domain/sameItem) vem antes e decide o que já sabe; o
// aprendido só completa: no casamento da lista com a nota (domain/listLinks),
// na despensa (domain/cartPantry) e no nome sugerido do item novo da nota do
// QR code (domain/nfce).

import { COMMON_ITEMS } from './commonItems';
import { termText } from './itemTerms';
import { LOOSE_UNITS, singular } from './nameWords';
import {
  isFixedWord,
  itemIdentity,
  kindTermValues,
  readItem,
  spellOut,
  spelledOut,
  termWords,
  type ItemIdentity,
  type SpelledWord,
} from './sameItem';
import { normalizeSearch } from './search';

/** Uma descrição de nota já confirmada e o nome que a casa deu ao produto dela. */
export interface AliasPair {
  description: string;
  productName: string;
}

export interface LearnedAbbreviations {
  /** Palavra da nota -> palavra por extenso, as duas sem acento ("integ" -> "integral", "pirac" -> "piracanjuba"). */
  words: ReadonlyMap<string, string>;
  /** Como a casa escreve cada palavra, com acento ("requeijao" -> "requeijão"). */
  spellings: ReadonlyMap<string, string>;
}

/** Nada aprendido: sem notas confirmadas, sem internet ou antes de os apelidos chegarem. */
export const NO_LEARNED: LearnedAbbreviations = { words: new Map(), spellings: new Map() };

// Ligações: não se abreviam. O "c" e o "s" de "C/" e "S/" nem entram (uma letra só).
const LINK_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'sem', 'para', 'em', 'ao', 'na', 'no']);
// Medidas e unidades como a nota escreve, além das soltas (nameWords): "LT" é litro (ou lata), e só é leite onde a
// tabela fixa diz.
const UNITS = new Set([...LOOSE_UNITS, 'kgs', 'grs', 'gs', 'lts', 'mls', 'unds', 'unids', 'pcts', 'cxs', 'dz', 'dzs']);

const onlyLetters = (word: string) => /^[a-z]+$/.test(word);

/** Uma palavra (ou a forma dela no singular) que o app já conhece inteira não é abreviação de outra. */
const knownWhole = (word: string, common: ReadonlySet<string>) =>
  [word, singular(word)].some((form) => isFixedWord(form) || common.has(form));

// As palavras dos itens comuns ("Requeijão", "Papel higiênico"): inteiras, e a grafia delas com acento.
const COMMON_NAMES = COMMON_ITEMS.map((item) => item.name);
const COMMON_WORDS: ReadonlySet<string> = new Set(COMMON_NAMES.flatMap((name) => termText(name).split(' ')));

/** A palavra da nota pode ser abreviação: só letras, duas ou mais, e nada que o app já leia inteiro. */
const mayAbbreviate = (word: string) =>
  word.length >= 2 && onlyLetters(word) && !LINK_WORDS.has(word) && !UNITS.has(word) && !knownWhole(word, COMMON_WORDS);

/**
 * A palavra curta abrevia a comprida: começa pela mesma letra e as letras dela aparecem em ordem na outra
 * ("integ" e "integral", "desn" e "desnatado", "amac" e "amaciante", "parb" e "parboilizado").
 */
function abbreviates(short: string, long: string): boolean {
  if (long.length <= short.length || long[0] !== short[0]) return false;
  // Com duas letras, só o começo da palavra ("AZ" e "azeite"): "EL" não é "espanhol".
  if (short.length === 2) return long.startsWith(short);
  let at = 0;
  for (let i = 0; i < long.length && at < short.length; i++) if (long[i] === short[at]) at++;
  return at === short.length;
}

interface WrittenWord {
  /** Sem acento, minúscula: a palavra de termText. */
  plain: string;
  /** Como está escrita, minúscula e com acento. */
  written: string;
  start: number;
  end: number;
}

const COMBINING = /[\u0300-\u036f]/;

/** As palavras do texto, com onde cada uma começa e termina; as mesmas de termText, na mesma ordem. */
function writtenWords(text: string): WrittenWord[] {
  const words: Omit<WrittenWord, 'written'>[] = [];
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    // A palavra continua se a de antes terminou logo antes deste caractere.
    const current = words.length && words[words.length - 1].end === at ? words[words.length - 1] : null;
    // O acento escrito à parte da letra (NFD) é da letra de antes.
    if (COMBINING.test(char) && current) {
      current.end = at + 1;
      continue;
    }
    const plain = normalizeSearch(char);
    if (!/^[a-z0-9]+$/.test(plain)) continue;
    if (current) {
      current.plain += plain;
      current.end = at + 1;
    } else words.push({ plain, start: at, end: at + 1 });
  }
  return words.map((word) => ({ ...word, written: text.slice(word.start, word.end).normalize('NFC').toLocaleLowerCase('pt-BR') }));
}

/** A grafia com acento de cada palavra (a mais usada), só das que têm acento ou cedilha. */
function spellingsOf(names: readonly string[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const name of names) {
    for (const { plain, written } of writtenWords(name)) {
      if (written === plain || !onlyLetters(plain)) continue;
      const forms = counts.get(plain) ?? new Map<string, number>();
      forms.set(written, (forms.get(written) ?? 0) + 1);
      counts.set(plain, forms);
    }
  }
  return new Map([...counts].map(([plain, forms]) => [plain, mostUsed(forms)]));
}

/** A forma mais vista; no empate, a primeira em ordem alfabética (o resultado não depende da ordem das notas). */
const mostUsed = (forms: ReadonlyMap<string, number>) =>
  [...forms].sort(([a, countA], [b, countB]) => countB - countA || (a < b ? -1 : a > b ? 1 : 0))[0][0];

const COMMON_SPELLINGS = spellingsOf(COMMON_NAMES);

/**
 * O que a casa ensinou com as notas confirmadas: cada palavra da descrição da
 * nota (já com a tabela fixa por extenso) que abrevia uma palavra só do nome
 * do produto. Fica de fora:
 * - número, medida e unidade ("1L", "5KG", "LT", "UN", "PCT"), ligação e palavra de uma letra;
 * - palavra que o app já conhece inteira (o nome de um item, um tipo, o que a tabela fixa escreve por extenso, os
 *   itens comuns), e o que a tabela fixa já trocou ("INT" já chega como integral);
 * - a palavra que a casa usa inteira num nome que ela escreveu (o nome só com as palavras da nota não conta), e a
 *   que serve para duas palavras do mesmo nome;
 * - a que a casa já viu abreviando duas coisas ("SAB": sabão numa nota, sabonete em outra);
 * - o tipo que as regras fixas já leem como outro ("MASC" é mascavo; ensinada como masculino, não troca).
 * Uma marca abreviada vira a marca ("PIRAC" -> piracanjuba): só aparece com aquele produto. `names`: outros nomes
 * da casa (os produtos), só para a grafia com acento.
 */
export function learnAbbreviations(pairs: readonly AliasPair[], names: readonly string[] = []): LearnedAbbreviations {
  const seen = new Map<string, Map<string, number>>();
  const whole = new Set<string>();
  for (const { description, productName } of pairs) {
    const all = writtenWords(productName).map(({ plain }) => plain);
    const noteWords = new Set(spelledOut(description).split(' '));
    // O nome feito só com palavras da própria nota ("Az gallo", o nome sugerido que a casa aceitou) não ensina nada
    // e não tira nada: senão, quem aceitou "Az gallo 500ml" nunca aprenderia que "AZ" é o azeite.
    if (all.every((word) => noteWords.has(word) || noteWords.has(singular(word)))) continue;
    const inName = new Set(all.flatMap((word) => [word, singular(word)]));
    const nameWords = all.filter((word) => onlyLetters(word) && word.length >= 3 && !LINK_WORDS.has(word) && !UNITS.has(word));
    for (const word of noteWords) {
      if (inName.has(word) || inName.has(singular(word))) {
        whole.add(word);
        continue;
      }
      if (!mayAbbreviate(word)) continue;
      const targets = nameWords.filter((target) => abbreviates(word, target));
      // Nenhuma ou duas palavras do nome ("biscoito" e "biscoitos" são uma).
      if (new Set(targets.map(singular)).size !== 1) continue;
      const kinds = kindTermValues(word);
      if (kinds.size && !targets.some((target) => kinds.has(target) || kinds.has(singular(target)))) continue;
      const forms = seen.get(word) ?? new Map<string, number>();
      forms.set(targets[0], (forms.get(targets[0]) ?? 0) + 1);
      seen.set(word, forms);
    }
  }
  const words = new Map<string, string>();
  for (const [word, forms] of seen) {
    if (whole.has(word) || new Set([...forms.keys()].map(singular)).size > 1) continue;
    words.set(word, mostUsed(forms));
  }
  return { words, spellings: spellingsOf([...pairs.map(({ productName }) => productName), ...names]) };
}

/**
 * O nome (a descrição da nota) com a tabela fixa e as abreviações aprendidas por extenso, sem acento, como
 * spelledOut; null quando nenhuma aprendida aparece (aí o nome fica como está e as regras de sempre o leem).
 */
export function withLearned(name: string, learned: LearnedAbbreviations): string | null {
  if (!learned.words.size) return null;
  const spelled = spellOut(termWords(name));
  const learnedOf = learnedIn(spelled, learned);
  let changed = false;
  const words = spelled.map(({ word }) => {
    const to = learnedOf(word);
    if (to == null) return word;
    changed = true;
    return to;
  });
  return changed ? words.join(' ') : null;
}

/** O mesmo item, ou um da mesma família ("bife" e "alcatra" são carne). */
const sameThing = (a: Pick<ItemIdentity, 'key' | 'family'>, b: Pick<ItemIdentity, 'key' | 'family'>) =>
  a.key === b.key || (a.family != null && (a.family === b.family || a.family === b.key)) || b.family === a.key;

/**
 * A palavra por extenso que a casa ensinou para cada palavra deste texto (já com a tabela fixa). A aprendida que é
 * um item ("ESP" -> esponja) só entra onde o texto não diz outro item: em "MAC ESP RENATA" o macarrão já está dito,
 * e ali o "ESP" é o espaguete que a casa nunca confirmou. As outras (marca, sabor, tipo) entram sempre.
 */
function learnedIn(spelled: readonly SpelledWord[], learned: LearnedAbbreviations): (word: string) => string | undefined {
  let said: ItemIdentity | null | undefined;
  return (word) => {
    const to = learned.words.get(word);
    if (to == null) return undefined;
    const item = itemIdentity(to);
    if (!item) return to;
    if (said === undefined) said = itemIdentity(spelled.map((entry) => entry.word).join(' '));
    return !said || sameThing(said, item) ? to : undefined;
  };
}

/**
 * O nome sugerido para o item novo da nota do QR code, com as abreviações por
 * extenso e com acento quando se sabe: "LT INTEG PIRAC 1L" vira "Leite
 * integral pirac 1l". As aprendidas valem sempre (a casa confirmou); as da
 * tabela fixa só onde dizem o item ou o tipo dele (lidos em domain/sameItem):
 * "FRANGO INT" continua "Frango int", e não vira o frango integral, porque ali
 * é o inteiro. O resto do texto (pontuação, tamanho) fica como está. null
 * quando nada muda: o nome fica como hoje (prettifyDescription).
 */
export function suggestedNoteName(raw: string, learned: LearnedAbbreviations = NO_LEARNED): string | null {
  const text = raw.trim().replace(/\s+/g, ' ');
  const tokens = writtenWords(text);
  const plains = tokens.map(({ plain }) => plain);
  // Tem de ser palavra por palavra o texto que a tabela lê; se não for, melhor não mexer.
  if (!tokens.length || plains.join(' ') !== termText(text)) return null;

  let words = spellOut(plains.map((word, at): SpelledWord => ({ word, from: [at, at] })));
  const learnedOf = learnedIn(words, learned);
  const learnedTokens = new Set<number>();
  words = words.map((word) => {
    const to = learnedOf(word.word);
    if (to == null) return word;
    for (let at = word.from[0]; at <= word.from[1]; at++) learnedTokens.add(at);
    return { word: to, from: word.from };
  });
  // A palavra aprendida pode completar um trecho da tabela ("LEI COND" -> "leite cond" -> "leite condensado").
  if (learnedTokens.size) words = spellOut(words);

  // Cada trecho do texto original e as palavras que saíram dele.
  const groups: { first: number; last: number; at: number[] }[] = [];
  words.forEach(({ from }, at) => {
    const group = groups[groups.length - 1];
    if (group && from[0] <= group.last) {
      group.last = Math.max(group.last, from[1]);
      group.at.push(at);
    } else groups.push({ first: from[0], last: from[1], at: [at] });
  });

  const finalText = words.map(({ word }) => word).join(' ');
  const reading = readItem(finalText);
  // O que o item e os tipos dele dizem, pela posição na lista de palavras (a leitura é do mesmo texto).
  const kept = reading && reading.words.join(' ') === finalText ? reading.kept : new Set<number>();
  const spell = (word: string) => learned.spellings.get(word) ?? COMMON_SPELLINGS.get(word) ?? word;

  let changed = false;
  let out = '';
  let end = 0;
  for (const { first, last, at } of groups) {
    const before = plains.slice(first, last + 1).join(' ');
    const after = at.map((index) => words[index].word);
    let learnedHere = false;
    for (let token = first; token <= last; token++) if (learnedTokens.has(token)) learnedHere = true;
    const expand = after.join(' ') !== before && (learnedHere || at.some((index) => kept.has(index)));
    out += text.slice(end, tokens[first].start) + (expand ? after.map(spell).join(' ') : text.slice(tokens[first].start, tokens[last].end));
    end = tokens[last].end;
    if (!expand) continue;
    changed = true;
    // O ponto da abreviação sai com ela ("PAP.HIG." -> "papel higiênico"), sem colar na palavra seguinte.
    if (text[end] === '.') {
      end++;
      if (end < text.length && text[end] !== ' ') out += ' ';
    }
  }
  if (!changed) return null;
  out = (out + text.slice(end)).toLocaleLowerCase('pt-BR');
  return out.charAt(0).toLocaleUpperCase('pt-BR') + out.slice(1);
}
