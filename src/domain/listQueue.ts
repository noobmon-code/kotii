// A fila da lista sem internet (pôr, marcar, editar, tirar e limpar o
// carrinho, na ordem dos toques): o que a tela mostra enquanto ela espera a
// conexão e o que tirar um item faz com o que ainda não saiu. Puro: quem
// guarda e envia a fila é data/market.

import type { PurchaseRecord } from '@/domain/recentPurchases';
import type { ShoppingListItem, Unit } from '@/lib/types';

export type QueuedKind = 'add' | 'toggle' | 'edit' | 'remove' | 'clear';

/** Uma ação da fila, na ordem dos toques. */
export interface QueuedAction<Ref> {
  /** Quem a fila guarda (a mutação), devolvido em `drop`. */
  ref: Ref;
  kind: QueuedKind;
  /** O item da ação; o limpar leva vários e não entra aqui (null). */
  itemId: string | null;
  /** Já saiu (ou está saindo) para o servidor: não dá mais para desfazer aqui. */
  started: boolean;
}

/**
 * A ação já saiu alguma vez para o servidor: está saindo agora (não está
 * parada) ou já tentou e falhou. Uma tentativa que falhou por falta de
 * resposta pode ter chegado lá (a resposta é que se perdeu), mesmo que a
 * ação esteja parada de novo, esperando a conexão.
 */
export function wasAttempted(state: { isPaused: boolean; failureCount: number }): boolean {
  return !state.isPaused || state.failureCount > 0;
}

/**
 * Tirar um item da lista. Se o item foi posto sem internet e o pôr ainda
 * espera a vez, os dois se cancelam: o pôr sai da fila, junto com o que veio
 * depois para o mesmo item (marcações, edições), e nada vai ao servidor. Se o
 * pôr já saiu (ou o item já existia), o tirar entra na fila, depois do que
 * veio antes.
 */
export function planRemoval<Ref>(queue: readonly QueuedAction<Ref>[], itemId: string): { drop: Ref[]; send: boolean } {
  const add = queue.find((action) => action.kind === 'add' && action.itemId === itemId);
  if (!add || add.started) return { drop: [], send: true };
  return { drop: queue.filter((action) => action.itemId === itemId && !action.started).map((action) => action.ref), send: false };
}

/** Quanto de cada coisa espera a conexão na fila da lista (e na das fotos). */
export interface QueueCounts {
  adds: number;
  marks: number;
  edits: number;
  removes: number;
  clears: number;
  photos: number;
}

/** "2 itens novos, 1 marcação e 1 limpeza do carrinho"; vazio quando nada espera. */
export function waitingSummary(counts: QueueCounts): string {
  const parts = [
    [counts.adds, 'item novo', 'itens novos'],
    [counts.marks, 'marcação', 'marcações'],
    [counts.edits, 'item editado', 'itens editados'],
    [counts.removes, 'item tirado', 'itens tirados'],
    [counts.clears, 'limpeza do carrinho', 'limpezas do carrinho'],
    [counts.photos, 'foto', 'fotos'],
  ] as const;
  const named = parts.flatMap(([n, one, many]) => (n ? [`${n} ${n === 1 ? one : many}`] : []));
  if (named.length <= 1) return named.join('');
  return `${named.slice(0, -1).join(', ')} e ${named[named.length - 1]}`;
}

/**
 * A pergunta de sair da conta. Sair apaga deste aparelho a fila que espera a
 * conexão (ela não pode sair com a sessão de outra conta): com algo nela, a
 * pergunta diz o que se perde. Sair continua possível (aparelho emprestado ou
 * perdido).
 */
export function signOutQuestion(counts: QueueCounts): string {
  const waiting = waitingSummary(counts);
  if (!waiting) return 'Deseja sair desta conta neste aparelho?';
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const verbs = total === 1 ? 'ainda espera a conexão e se perde' : 'ainda esperam a conexão e se perdem';
  return `${waiting} ${verbs} se você sair agora. Deseja sair mesmo assim?`;
}

/** O que o resumo das listas sabe de cada item (o nome e o produto, para "Acabou" e a tela Hoje). */
export interface ListItemRef {
  name: string;
  product_id: string | null;
  checked_at: string | null;
}

export interface ListSummaryCounts {
  id: string;
  pending: number;
  total: number;
  items: ListItemRef[];
}

/** O resumo das listas com o item posto agora (ainda sem passar pelo servidor). */
export function summaryWithItem<T extends ListSummaryCounts>(lists: readonly T[], listId: string, item: ListItemRef): T[] {
  return lists.map((list) =>
    list.id === listId
      ? {
          ...list,
          pending: list.pending + (item.checked_at ? 0 : 1),
          total: list.total + 1,
          items: [...(list.items ?? []), item],
        }
      : list,
  );
}

/**
 * O resumo das listas sem os itens que saíram (tirados ou levados pelo
 * limpar). O resumo não tem o id dos itens: sai um por nome e produto,
 * de preferência o que estava no mesmo estado (no carrinho ou não).
 */
export function summaryWithout<T extends ListSummaryCounts>(lists: readonly T[], listId: string, removed: readonly ListItemRef[]): T[] {
  if (!removed.length) return [...lists];
  return lists.map((list) => {
    if (list.id !== listId) return list;
    const items = [...(list.items ?? [])];
    for (const gone of removed) {
      const same = (ref: ListItemRef) => ref.name === gone.name && ref.product_id === gone.product_id;
      let at = items.findIndex((ref) => same(ref) && Boolean(ref.checked_at) === Boolean(gone.checked_at));
      if (at < 0) at = items.findIndex(same);
      if (at >= 0) items.splice(at, 1);
    }
    const pendingGone = removed.filter((ref) => !ref.checked_at).length;
    return {
      ...list,
      pending: Math.max(0, list.pending - pendingGone),
      total: Math.max(0, list.total - removed.length),
      items,
    };
  });
}

/** O que a pessoa pôs na lista sem internet: o item como a tela o mostra até o servidor responder. */
export interface QueuedNewItem {
  id: string;
  listId: string;
  /** O selo do item: a primeira marcação parte dele, ainda na fila. */
  token: string;
  name: string;
  category: string;
  productId: string | null;
  quantity: number;
  unit: Unit;
}

/**
 * `brandColumn`: os itens que a tela já tem vieram com a "Marca preferida" (o banco tem a coluna). O item novo
 * entra sem ela, como o banco o põe (o pôr não manda a coluna); sem saber se o banco a tem, o item vem sem o campo
 * e a escolha aparece quando a lista voltar do servidor.
 */
export function queuedListItem(item: QueuedNewItem, createdAt: string, brandColumn = false): ShoppingListItem {
  return {
    ...(brandColumn ? { brand_preferred: false } : {}),
    id: item.id,
    list_id: item.listId,
    product_id: item.productId,
    name: item.name,
    category: item.category,
    quantity: item.quantity,
    unit: item.unit,
    notes: null,
    priority: 'normal',
    photo_path: null,
    checked_at: null,
    checked_by: null,
    toggle_token: item.token,
    created_at: createdAt,
  };
}

/** Os itens da lista com o novo no fim; repetir (a mesma ação de novo) não duplica. */
export function itemsWithNew(items: readonly ShoppingListItem[], item: ShoppingListItem): ShoppingListItem[] {
  return items.some((i) => i.id === item.id) ? [...items] : [...items, item];
}

/** O que sai do carrinho vai para o histórico de compras, com a hora em que foi para o carrinho. */
export function cartPurchases(items: readonly ShoppingListItem[]): PurchaseRecord[] {
  return items.flatMap((i): PurchaseRecord[] =>
    i.checked_at
      ? [
          {
            name: i.name,
            category: i.category,
            productId: i.product_id,
            quantity: Number(i.quantity),
            unit: i.unit,
            at: i.checked_at,
            source: 'list',
          },
        ]
      : [],
  );
}
