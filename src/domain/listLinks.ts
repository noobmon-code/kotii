// Lista de compras x nota: cada mercado escreve de um jeito ("COCA S ACUCAR
// 1 5L"), e a lista é digitada solta ("Coca", "Refrigerante"). Ao confirmar
// a nota, a pessoa diz quais itens da lista a compra cumpriu; cada um vira um
// vínculo nome da lista -> produto, e a próxima nota já vem marcada.

import { normalizeSearch } from './search';

/** Vínculo aprendido: este nome de lista é cumprido por este produto. */
export interface ListLink {
  name_key: string;
  product_id: string;
}

/** O nome da lista como chave do vínculo: sem acento, maiúscula nem pontuação. */
export function listNameKey(name: string): string {
  return normalizeSearch(name)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 200)
    .trim();
}

/** Os vínculos para consulta rápida. */
export class LinkIndex {
  private readonly keys: Set<string>;

  constructor(links: readonly ListLink[] = []) {
    this.keys = new Set(links.map((link) => `${link.name_key}\u0000${link.product_id}`));
  }

  /** O item de lista com este nome é cumprido por este produto? */
  has(listName: string, productId: string): boolean {
    const key = listNameKey(listName);
    return Boolean(key) && this.keys.has(`${key}\u0000${productId}`);
  }
}

// Palavras que não dizem o que é o item.
const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'sem', 'para', 'em', 'a', 'o']);

const words = (text: string) =>
  listNameKey(text)
    .split(' ')
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));

/** Mesma palavra, no singular ou no plural ("tomate" e "tomates"). */
const sameWord = (a: string, b: string) => a === b || `${a}s` === b || `${b}s` === a || `${a}es` === b || `${b}es` === a;

/**
 * Todas as palavras do item da lista aparecem num dos nomes do item da nota
 * ("Cebola" em "Cebola Granel 600g"). Devolve o tamanho do nome mais curto
 * que bate (menor = mais parecido), ou null.
 */
function nameFit(listName: string, receiptNames: string[]): number | null {
  const wanted = words(listName);
  if (!wanted.length) return null;
  let best: number | null = null;
  for (const name of receiptNames) {
    const have = words(name);
    if (wanted.every((w) => have.some((h) => sameWord(w, h)))) best = Math.min(best ?? Infinity, have.length);
  }
  return best;
}

/** Item aberto numa lista de compras. */
export interface OpenListItem {
  id: string;
  name: string;
  category: string;
  product_id: string | null;
}

/** Item da nota como está na revisão. */
export interface ReceiptLine {
  id: string;
  /** Produto já escolhido (existente); produto novo ainda não tem id. */
  productId: string | null;
  /** Nome do produto, sugestão da leitura e texto da nota. */
  names: string[];
  category: string;
}

/** Como o item da lista foi ligado à nota; `escolha`: a pessoa ligou na revisão. */
export type ListMatchReason = 'produto' | 'vinculo' | 'nome' | 'escolha';

export interface ListMatch {
  listItemId: string;
  receiptItemId: string;
  reason: ListMatchReason;
  /** Mesmo produto ou vínculo já confirmado vem marcado; nome parecido só sugere. */
  checked: boolean;
}

/**
 * Que item da nota cumpre cada item aberto das listas: o mesmo produto, um
 * vínculo que a pessoa já confirmou ou, como sugestão desmarcada, um nome
 * com as mesmas palavras. Um item da nota pode cumprir mais de um item de
 * lista ("Coca" e "Refrigerante").
 */
export function matchListItems(listItems: OpenListItem[], receipt: ReceiptLine[], links: LinkIndex): ListMatch[] {
  return listItems.flatMap((item): ListMatch[] => {
    const byProduct = item.product_id ? receipt.find((line) => line.productId === item.product_id) : undefined;
    if (byProduct) return [{ listItemId: item.id, receiptItemId: byProduct.id, reason: 'produto', checked: true }];
    const byLink = receipt.find((line) => line.productId && links.has(item.name, line.productId));
    if (byLink) return [{ listItemId: item.id, receiptItemId: byLink.id, reason: 'vinculo', checked: true }];
    // Mais parecido: primeiro a mesma categoria ("Leite" é o integral, não o
    // condensado dos doces), depois o nome mais curto.
    let best: { line: ReceiptLine; score: [number, number] } | null = null;
    for (const line of receipt) {
      const fit = nameFit(item.name, line.names);
      if (fit == null) continue;
      const score: [number, number] = [line.category === item.category ? 0 : 1, fit];
      if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1])) best = { line, score };
    }
    return best ? [{ listItemId: item.id, receiptItemId: best.line.id, reason: 'nome', checked: false }] : [];
  });
}

/** O que a pessoa decidiu para um item da lista na revisão. */
export interface ListChoice {
  /** null: não foi comprado nesta nota. */
  receiptItemId: string | null;
  checked: boolean;
}

/** As sugestões com as escolhas da pessoa por cima. */
export function applyListChoices(matches: ListMatch[], choices: Record<string, ListChoice>): ListMatch[] {
  const result = new Map(matches.map((m) => [m.listItemId, m]));
  for (const [listItemId, choice] of Object.entries(choices)) {
    const current = result.get(listItemId);
    if (!choice.receiptItemId) {
      result.delete(listItemId);
      continue;
    }
    const sameLine = current?.receiptItemId === choice.receiptItemId;
    result.set(listItemId, {
      listItemId,
      receiptItemId: choice.receiptItemId,
      reason: sameLine ? current.reason : 'escolha',
      checked: choice.checked,
    });
  }
  return [...result.values()];
}

/**
 * Um item de lista que sai com a nota. `name` é o nome visto na revisão: o
 * banco só tira o item (e aprende `name_key`) se ele ainda tem esse nome.
 */
export interface ListRemoval {
  id: string;
  name: string;
  name_key: string;
}

/** Para confirm_receipt: em cada item da nota, os itens de lista que saem (e o nome que vira vínculo). */
export function listRemovals(
  matches: ListMatch[],
  listItems: OpenListItem[],
): Map<string, ListRemoval[]> {
  const names = new Map(listItems.map((item) => [item.id, item.name]));
  const removals = new Map<string, ListRemoval[]>();
  for (const match of matches) {
    const name = names.get(match.listItemId);
    if (!match.checked || name == null) continue;
    removals.set(match.receiptItemId, [
      ...(removals.get(match.receiptItemId) ?? []),
      { id: match.listItemId, name, name_key: listNameKey(name) },
    ]);
  }
  return removals;
}

/**
 * Ligações que a pessoa desfez nesta nota ("Não foi comprado nesta nota" num
 * item que veio marcado por ligação): saem ao confirmar, para não voltarem
 * marcadas. Desmarcar só deixa o item na lista; a ligação continua.
 * `matches`: as sugestões antes das escolhas.
 */
export function forgottenLinks(
  matches: ListMatch[],
  choices: Record<string, ListChoice>,
  listItems: OpenListItem[],
): Map<string, string[]> {
  const names = new Map(listItems.map((item) => [item.id, item.name]));
  const forgotten = new Map<string, string[]>();
  for (const match of matches) {
    const name = names.get(match.listItemId);
    if (match.reason !== 'vinculo' || choices[match.listItemId]?.receiptItemId !== null || name == null) continue;
    forgotten.set(match.receiptItemId, [...(forgotten.get(match.receiptItemId) ?? []), listNameKey(name)]);
  }
  return forgotten;
}
