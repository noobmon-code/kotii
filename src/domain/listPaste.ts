// "Colar lista": o texto que a pessoa colou (de uma conversa, de uma nota, ou
// o próprio texto que o app manda pelo WhatsApp, listShare) vira itens, um por
// linha, com quantidade e unidade quando a linha diz. A tela mostra a prévia
// antes de pôr qualquer coisa: o que já está para comprar na lista não entra
// de novo.

import type { Unit } from '@/lib/types';

import { COMMON_ITEMS } from './commonItems';
import { pendingSameItem, sameListItem } from './genericItem';
import { PRIORITIES } from './listItem';
import { listNameKey } from './listLinks';
import { parseDecimal } from './money';
import { guessCategory, normalizeSearch } from './search';

/** Até quantos itens uma colagem põe de uma vez; o resto a prévia diz que ficou de fora. */
export const PASTE_MAX_ITEMS = 100;
/** Um texto enorme (um livro colado por engano) não trava a tela: só estas linhas são lidas. */
const MAX_LINES = 2000;
/** Uma linha comprida demais não é nome de item: o nome fica com este tanto. */
const NAME_MAX = 120;
/** Número maior que isso no começo da linha não é quantidade ("2026 lista"). */
const MAX_QUANTITY = 99999;

export interface PastedItem {
  name: string;
  quantity: number;
  unit: Unit;
  category: string;
}

// As palavras de quantidade, sem acento e sem o ponto da abreviação. Embalagem conta como unidade: "2 pacotes de
// arroz" são 2 un de arroz.
const UNIT_WORDS = new Map<string, Unit>([
  ...['un', 'und', 'unid', 'unidade', 'unidades', 'pc', 'pcs', 'peca', 'pecas', 'pct', 'pcte', 'pacote', 'pacotes', 'cx',
    'caixa', 'caixas', 'lata', 'latas', 'garrafa', 'garrafas', 'saco', 'sacos', 'pote', 'potes', 'vidro', 'vidros',
    'bandeja', 'bandejas', 'rolo', 'rolos', 'maco', 'macos'].map((w) => [w, 'un'] as const),
  ...['kg', 'kgs', 'kilo', 'kilos', 'quilo', 'quilos'].map((w) => [w, 'kg'] as const),
  ...['g', 'gr', 'grs', 'grama', 'gramas'].map((w) => [w, 'g'] as const),
  ...['l', 'lt', 'lts', 'litro', 'litros'].map((w) => [w, 'l'] as const),
  ['ml', 'ml'],
]);
const TIMES = new Set(['x', '×']);
const OF_WORDS = new Set(['de', 'do', 'da', 'dos', 'das']);

// As prioridades como o texto do app as escreve depois de " · " ("· urgente", "· só em promoção").
const PRIORITY_WORDS = new Set(PRIORITIES.filter((p) => p.key !== 'normal').map((p) => normalizeSearch(p.label)));

// Os itens comuns pelo nome, para a categoria; os com parênteses no nome ("Ovos (dúzia)"), em que os parênteses são
// o nome e não a observação.
const COMMON_BY_KEY = new Map(COMMON_ITEMS.map((item) => [listNameKey(item.name), item]));
const COMMON_WITH_PARENS = new Set(COMMON_ITEMS.filter((item) => item.name.includes('(')).map((item) => listNameKey(item.name)));

const NUMBER = '\\d+(?:[.,]\\d+)*';

/** "2", "1,5", "1.234,5": a quantidade, se for uma que vale. */
function quantityOf(text: string): number | null {
  const value = parseDecimal(text);
  return value !== null && value > 0 && value <= MAX_QUANTITY ? value : null;
}

/** A unidade de uma palavra ("kg", "Litros", "pct."), "x" para "2x", ou null. */
function unitWord(word: string): Unit | 'x' | null {
  const plain = normalizeSearch(word).replace(/\.$/, '');
  if (TIMES.has(plain)) return 'x';
  return UNIT_WORDS.get(plain) ?? null;
}

/** Letra ou número: o que começa e termina um nome. Emoji, marcador e pontuação não. */
const isWordChar = (char: string) => /[\p{L}\p{N}]/u.test(char);

/** Tira do começo os marcadores ("-", "•", "*", "[ ]", "✅", "1."), emojis e espaços. */
function stripLeading(text: string): string {
  let s = text;
  for (;;) {
    const before = s;
    s = s.replace(/^\[[\sxX✓✔]?\]\s*/, '');
    // Numeração ("1.", "2)"), só com espaço depois: "1.5 kg" é quantidade.
    s = s.replace(/^\d{1,3}[.)]\s+(?=\S)/, '');
    while (s && !isWordChar(s[0]) && s[0] !== '(') s = s.slice(1);
    if (s === before) return s;
  }
}

/** Tira do fim emojis, marcadores de formatação e pontuação solta (",", ";", "!"); ")", "%" e ":" (o do título) ficam. */
function stripTrailing(text: string): string {
  let s = text;
  while (s && !isWordChar(s[s.length - 1]) && !')%:'.includes(s[s.length - 1])) s = s.slice(0, -1);
  return s;
}

/** O par de parênteses que fecha a linha ("Leite (sem lactose)"), com os de dentro; null sem ele ou quando é a linha toda. */
function trailingGroup(text: string): { start: number; inner: string } | null {
  if (!text.endsWith(')')) return null;
  let depth = 0;
  for (let at = text.length - 1; at >= 0; at--) {
    if (text[at] === ')') depth++;
    else if (text[at] === '(' && --depth === 0) return at === 0 ? null : { start: at, inner: text.slice(at + 1, -1).trim() };
  }
  return null;
}

/** "2", "2x", "x2", "2 kg": a quantidade escrita entre parênteses ou depois do nome. */
function quantityPhrase(text: string): { quantity: number; unit: Unit | null } | null {
  const match = new RegExp(`^(?:[x×]\\s*)?(${NUMBER})\\s*(\\S+)?$`, 'i').exec(text.trim());
  if (!match) return null;
  const quantity = quantityOf(match[1]);
  const unit = match[2] ? unitWord(match[2]) : null;
  if (quantity === null || (match[2] && !unit)) return null;
  return { quantity, unit: unit === 'x' ? null : unit };
}

/** Separa "arroz, feijão; óleo" nos itens, sem cortar "1,5 kg" nem a observação entre parênteses. */
function splitItems(line: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let at = 0; at < line.length; at++) {
    const char = line[at];
    if (char === '(') depth++;
    else if (char === ')') depth = Math.max(0, depth - 1);
    const splits = depth === 0 && (char === ';' || (char === ',' && !/\d/.test(line[at + 1] ?? '')));
    if (splits) {
      parts.push(current);
      current = '';
    } else current += char;
  }
  parts.push(current);
  return parts;
}

/** Título do texto do app ("*Mercado* · 12 itens"), seção ("*Laticínios*") ou título da pessoa ("Feira:"). */
function isHeading(text: string): boolean {
  return /^\*[^*]+\*(?:\s*·.*)?$/.test(text) || /^_[^_]+_$/.test(text);
}

/** Um item da linha, ou null quando ela não diz item nenhum. */
function readItem(text: string): PastedItem | null {
  let s = stripTrailing(stripLeading(text.trim()));
  if (!s || s.endsWith(':')) return null;
  // "· urgente", "· se der": a prioridade que o app escreve fica de fora.
  const dot = s.lastIndexOf('·');
  if (dot > 0 && PRIORITY_WORDS.has(normalizeSearch(s.slice(dot + 1)))) s = stripTrailing(s.slice(0, dot).trim());

  // Quantidade no começo: "2 kg arroz", "2kg de arroz", "2x leite", "2 leite", e a do texto do app ("2 un Leite").
  let quantity = 1;
  let unit: Unit = 'un';
  let counted = false;
  const lead = new RegExp(`^(${NUMBER})\\s*(\\S+)?\\s*(.*)$`).exec(s);
  const leadQuantity = lead ? quantityOf(lead[1]) : null;
  if (lead && leadQuantity !== null && (lead[2] || lead[3])) {
    const word = lead[2] ?? '';
    const found = word ? unitWord(word) : null;
    let rest = found ? lead[3] : `${word} ${lead[3]}`.trim();
    if (found && found !== 'x') {
      const [first, ...others] = rest.split(/\s+/);
      if (OF_WORDS.has(normalizeSearch(first ?? '')) && others.length) rest = others.join(' ');
    }
    // "2 garrafas" sozinho: a embalagem é o nome.
    s = rest || word;
    quantity = leadQuantity;
    unit = found && found !== 'x' ? found : 'un';
    counted = true;
  }

  // Quantidade no fim: "Leite (2)", "Leite x2", "Leite 2x"; a do começo vale mais. Outro parêntese no fim é a
  // observação, que sai, a não ser que seja o nome de um item comum ("Ovos (dúzia)").
  const group = trailingGroup(s);
  if (group && !COMMON_WITH_PARENS.has(listNameKey(s))) {
    const after = quantityPhrase(group.inner);
    s = stripTrailing(s.slice(0, group.start).trim());
    if (after && !counted) {
      quantity = after.quantity;
      unit = after.unit ?? 'un';
      counted = true;
    }
  }
  const times = counted ? null : new RegExp(`\\s+(?:[x×]\\s*(${NUMBER})|(${NUMBER})\\s*[x×])$`, 'i').exec(s);
  const timesQuantity = times ? quantityOf(times[1] ?? times[2]) : null;
  if (times && timesQuantity !== null) {
    quantity = timesQuantity;
    s = s.slice(0, times.index).trim();
  }

  const name = stripTrailing(stripLeading(s.replace(/\s+/g, ' ').trim())).slice(0, NAME_MAX).trim();
  if (!name || !/\p{L}/u.test(name)) return null;
  // Tudo em minúsculas ("arroz", como se digita numa conversa): a primeira letra maiúscula, como os outros itens.
  const shown = name === name.toLocaleLowerCase('pt-BR') ? name.charAt(0).toLocaleUpperCase('pt-BR') + name.slice(1) : name;
  const common = COMMON_BY_KEY.get(listNameKey(shown));
  return { name: shown, quantity, unit, category: common?.category ?? guessCategory(shown) };
}

/**
 * Os itens do texto colado, um por linha (ou por vírgula: "arroz, feijão,
 * óleo"). Aceita marcadores e emojis no começo ("- ", "• ", "✅ ", "1. "),
 * quantidade antes ("2 kg arroz", "2x leite") ou depois ("leite (2)", "leite
 * x2") e o texto que o app manda pelo WhatsApp: o título e as seções em
 * negrito ficam de fora, e a observação entre parênteses e a prioridade
 * ("· urgente") saem do nome. Linhas vazias e títulos ("Feira:") não viram
 * item. A categoria é a do item comum de mesmo nome, ou o chute pelo nome.
 * Até PASTE_MAX_ITEMS itens; `cut` diz quantos ficaram de fora.
 */
export function parsePastedList(text: string): { items: PastedItem[]; cut: number } {
  const items: PastedItem[] = [];
  const lines = text.normalize('NFC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').split(/\r\n|\r|\n/).slice(0, MAX_LINES);
  for (const raw of lines) {
    // Emoji antes do título ("🛒 *Mercado*") não o faz virar item.
    const line = raw.replace(/^[\s\p{Extended_Pictographic}\uFE0F\u20E3]+/u, '').trim();
    if (!line || isHeading(line)) continue;
    for (const part of splitItems(line)) {
      const item = readItem(part);
      if (item) items.push(item);
    }
  }
  return { items: items.slice(0, PASTE_MAX_ITEMS), cut: Math.max(0, items.length - PASTE_MAX_ITEMS) };
}

/** Uma linha da prévia: o item e, quando ele já está para comprar na lista, o nome com que está lá. */
export interface PasteRow {
  item: PastedItem;
  /** Já está na lista com este nome: não entra de novo. */
  listed: string | null;
}

/**
 * A prévia da colagem. O que já está para comprar na lista (o mesmo item, com
 * este nome ou outro: pendingSameItem) aparece como "já está na lista" e não
 * entra. O mesmo item duas vezes no texto entra uma vez só: na mesma unidade,
 * com as quantidades somadas; em outra unidade, cada um como veio.
 */
export function pastePreview<T extends { name: string; category?: string | null; checked_at?: string | null }>(
  items: readonly PastedItem[],
  pending: readonly T[],
): PasteRow[] {
  const rows: PasteRow[] = [];
  for (const item of items) {
    const listed = pendingSameItem(item, pending);
    const earlier = rows.find((row) => sameListItem(row.item, item) && (row.listed !== null || row.item.unit === item.unit));
    if (earlier?.listed) continue;
    if (earlier) {
      earlier.item = { ...earlier.item, quantity: Math.round((earlier.item.quantity + item.quantity) * 1000) / 1000 };
      continue;
    }
    rows.push({ item, listed: listed ? listed.name : null });
  }
  return rows;
}

/** Os itens da prévia que entram na lista. */
export const pasteToAdd = (rows: readonly PasteRow[]): PastedItem[] => rows.filter((row) => !row.listed).map((row) => row.item);
