// O termo que diz o que é o item, num nome digitado ou numa descrição de nota.
// Vence o termo que aparece primeiro no nome: o produto vem antes do sabor ou
// do ingrediente ("iogurte de morango" é iogurte, "chocolate ao leite" é
// chocolate). No empate, vale a regra que vem antes, a mais específica ("pao
// de forma" antes de "pao"). A mesma leitura escolhe o desenho do item
// (itemArt) e diz se a lista e a nota falam do mesmo item (sameItem).

import { normalizeSearch } from './search';

/** O nome como os termos são procurados: sem acento nem maiúscula, e só letras e números, com um espaço entre eles. */
export function termText(name: string): string {
  return normalizeSearch(name).replace(/[^a-z0-9]+/g, ' ').trim();
}

const escape = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Cada palavra do termo, no singular ou no plural ("paes de forma", "sacos de
// lixo"): mamao/mamoes/paes, hamburguer/hamburgueres, frances/franceses,
// papel/papeis, atum/atuns, ovo/ovos.
const CONNECTORS = new Set(['ao', 'com', 'da', 'de', 'do', 'em', 'para']);
// No meio do termo, estas a nota fiscal corta ou troca ("PAO FORMA", "LEITE COCO", "SABAO PO", "BOMBOM DA ALCATRA").
const LOOSE_LINKS = new Set(['de', 'da', 'do', 'das', 'dos', 'em']);
function inflect(word: string): string {
  if (CONNECTORS.has(word)) return word;
  const stem = (cut: number) => escape(word.slice(0, word.length - cut));
  if (word.endsWith('ao')) return `${stem(2)}(?:ao|oes|aes|aos)`;
  if (/[rz]$/.test(word)) return `${stem(0)}(?:es|s)?`;
  if (word.endsWith('s')) return `${stem(0)}(?:es)?`;
  if (word.endsWith('l')) return `${stem(1)}(?:l|is)`;
  if (word.endsWith('m')) return `${stem(1)}(?:m|ns)`;
  return `${stem(0)}s?`;
}

/** O termo como palavra inteira, no singular ou no plural, com "de", "da", "em"... do meio opcionais. */
export function termRegex(term: string): RegExp {
  const words = term.split(' ');
  const pattern = words
    .map((word, at) => {
      if (at === 0) return inflect(word);
      if (LOOSE_LINKS.has(word) && at < words.length - 1) return '(?:\\s+(?:de|da|do|das|dos|em))?';
      return `\\s+${inflect(word)}`;
    })
    .join('');
  return new RegExp(`(?:^|[^a-z0-9])${pattern}(?=[^a-z0-9]|$)`, 'g');
}

// Depois de "de", "com", "sabor"…, o termo é o sabor ou o ingrediente de
// outro produto ("gelatina de morango", "ração sabor frango"): não é o item.
const FLAVOR_BEFORE = /(?:^|\s)(?:a|ao|com|da|das|de|do|dos|e|sabor)\s*$/;
// Corte ou embalagem no começo não é o produto: "file de tilapia", "barra de
// cereal", "lata de atum" continuam peixe, cereal e atum.
const CUT_OR_PACK = new RegExp(
  `^(?:\\d+\\s*x?\\s*)?(?:meia\\s+)?(?:${[
    'asa', 'bandeja', 'barra', 'bisnaga', 'cacho', 'caixa', 'caixinha', 'copo', 'coxa', 'duzia', 'embalagem', 'fardo',
    'fatia', 'file', 'frasco', 'galao', 'galoe', 'garrafa', 'garrafinha', 'kit', 'lata', 'latinha', 'maco', 'pacote',
    'pacotinho', 'pedaco', 'peca', 'porcao', 'posta', 'pote', 'rede', 'refil', 'sache', 'saco', 'saquinho', 'sobrecoxa',
    'tablete', 'tubo', 'unidade', 'vidro',
  ].join('|')})s?\\s+(?:de|do|da)\\s*$`,
);

/** Onde o termo aparece como o produto, e não como sabor de outro. */
export interface TermHit<K extends string> {
  key: K;
  term: string;
  /** Onde o trecho que casou começa (com o espaço de antes, se houver): é o que decide quem vem primeiro. */
  index: number;
  /** Onde o termo termina. */
  end: number;
}

export type TermRules<K extends string> = readonly (readonly [K, readonly string[]])[];

export interface CompiledTerms<K extends string> {
  readonly terms: readonly { key: K; term: string; re: RegExp }[];
}

export function compileTerms<K extends string>(rules: TermRules<K>): CompiledTerms<K> {
  return { terms: rules.flatMap(([key, terms]) => terms.map((term) => ({ key, term, re: termRegex(term) }))) };
}

/** O primeiro trecho do texto em que o termo casa e não é sabor de outro produto. */
function productMatch(re: RegExp, text: string): { index: number; end: number } | undefined {
  for (const match of text.matchAll(re)) {
    const start = /[a-z0-9]/.test(text[match.index]) ? match.index : match.index + 1;
    const before = text.slice(0, start);
    if (!FLAVOR_BEFORE.test(before) || CUT_OR_PACK.test(before)) return { index: match.index, end: match.index + match[0].length };
  }
  return undefined;
}

/**
 * Os termos que aparecem no texto (de `termText`) como produto, do primeiro
 * ao último; no mesmo lugar, o da regra (e do termo) que vem antes.
 */
export function productTerms<K extends string>(compiled: CompiledTerms<K>, text: string): TermHit<K>[] {
  const hits: TermHit<K>[] = [];
  for (const { key, term, re } of compiled.terms) {
    const found = productMatch(re, text);
    if (found) hits.push({ key, term, ...found });
  }
  // A ordenação é estável: no mesmo lugar, fica a ordem das regras.
  return hits.sort((a, b) => a.index - b.index);
}

/** O termo que diz o produto: o primeiro que aparece, ou null. */
export function firstProductTerm<K extends string>(compiled: CompiledTerms<K>, text: string): TermHit<K> | null {
  let best: TermHit<K> | null = null;
  for (const { key, term, re } of compiled.terms) {
    // Nada vem antes do começo do texto.
    if (best && best.index === 0) break;
    const found = productMatch(re, text);
    if (found && (!best || found.index < best.index)) best = { key, term, ...found };
  }
  return best;
}

/** Onde aparece primeiro qualquer um dos termos (sabor ou não), ou Infinity. */
export function firstMention(regexes: readonly RegExp[], text: string): number {
  return Math.min(...regexes.map((re) => text.matchAll(re).next().value?.index ?? Infinity));
}
