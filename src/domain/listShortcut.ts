// O atalho "Listas de compras" da tela Hoje abre uma lista direto e diz quanto falta comprar nela. Qual lista: a
// aberta que este aparelho abriu por último (lib/openedLists guarda quando cada uma foi aberta aqui); senão a de
// mercado aberta mais nova; senão a aberta mais nova de qualquer tipo. Sem lista aberta (ou antes de as listas e a
// memória do aparelho chegarem), é o atalho de sempre, para Casa → Compras.

import type { ListKind } from '@/lib/types';

export const LISTS_SHORTCUT_LABEL = 'Listas de compras';
export const UNNAMED_LIST = 'Lista sem nome';
/** Quantas listas abertas aqui o aparelho lembra (as de carimbo mais novo). */
export const OPENED_LISTS_MAX = 20;

export interface ShortcutCandidate {
  id: string;
  name: string;
  kind: ListKind;
  created_at: string;
  archived_at?: string | null;
  pending: number;
}

export interface ListShortcut {
  /** A lista que o toque abre; null: o atalho de sempre (Casa → Compras). */
  listId: string | null;
  label: string;
  /** A linha de baixo: quanto falta comprar. */
  caption?: string;
  /** O que o leitor de tela diz. */
  accessibilityLabel?: string;
}

/** Os N carimbos mais novos (empate: o id menor, para a ordem não depender de como o mapa foi montado). */
function newest(entries: [string, number][]): Map<string, number> {
  return new Map(
    entries
      .sort(([idA, a], [idB, b]) => b - a || (idA < idB ? -1 : idA > idB ? 1 : 0))
      .slice(0, OPENED_LISTS_MAX),
  );
}

/** Lê o que o aparelho guardou (`{ id da lista: quando abriu, em ms }`); qualquer outra coisa é "nenhuma". */
export function parseOpenedLists(raw: string | null): ReadonlyMap<string, number> {
  if (!raw) return new Map();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return new Map();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return new Map();
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, number] => entry[0] !== '' && typeof entry[1] === 'number' && Number.isFinite(entry[1]),
  );
  return newest(entries);
}

export function serializeOpenedLists(opened: ReadonlyMap<string, number>): string {
  return JSON.stringify(Object.fromEntries(opened));
}

const greatest = (opened: ReadonlyMap<string, number>) => Math.max(-Infinity, ...opened.values());

/**
 * Anota que a lista foi aberta agora. Devolve o mesmo mapa quando ela já é a mais nova (nada a gravar). O carimbo
 * nunca fica atrás do mais novo: com o relógio do aparelho voltando, a última aberta continua sendo a mais nova.
 */
export function withOpenedList(
  opened: ReadonlyMap<string, number>,
  listId: string,
  at: number,
): ReadonlyMap<string, number> {
  const top = greatest(opened);
  const current = opened.get(listId);
  if (current !== undefined && current === top) {
    const tied = [...opened.values()].filter((stamp) => stamp === top).length;
    if (tied === 1) return opened;
  }
  const stamp = Number.isFinite(top) ? Math.max(at, top + 1) : at;
  const next = [...opened.entries()].filter(([id]) => id !== listId);
  next.push([listId, stamp]);
  return newest(next);
}

const byCreation = (a: ShortcutCandidate, b: ShortcutCandidate) =>
  (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** A lista do atalho: a aberta que o aparelho abriu por último, senão a de mercado mais nova, senão a mais nova. */
export function shortcutList<T extends ShortcutCandidate>(
  lists: readonly T[],
  opened: ReadonlyMap<string, number>,
): T | null {
  const open = lists.filter((l) => !l.archived_at);
  const stamped = open
    .filter((l) => opened.has(l.id))
    .sort((a, b) => (opened.get(b.id) ?? 0) - (opened.get(a.id) ?? 0) || byCreation(a, b));
  if (stamped.length) return stamped[0];
  const sorted = [...open].sort(byCreation);
  return sorted.find((l) => l.kind === 'mercado') ?? sorted[0] ?? null;
}

const pendingCount = (pending: number) => (Number.isFinite(pending) && pending >= 1 ? Math.floor(pending) : 0);

/** A linha de baixo do atalho: quanto falta comprar na lista. */
export function listShortcutCaption(pending: number): string {
  const n = pendingCount(pending);
  return n === 0 ? 'Nada a comprar' : `${n} a comprar`;
}

/** O atalho da tela Hoje: a lista, o rótulo, a linha de baixo e o que o leitor de tela diz. */
export function listShortcut(
  lists: readonly ShortcutCandidate[] | undefined,
  opened: ReadonlyMap<string, number> | null,
): ListShortcut {
  const fallback: ListShortcut = { listId: null, label: LISTS_SHORTCUT_LABEL };
  if (!lists || !opened) return fallback;
  const list = shortcutList(lists, opened);
  if (!list) return fallback;
  const label = list.name.trim() || UNNAMED_LIST;
  const n = pendingCount(list.pending);
  const spoken = n === 0 ? 'nada a comprar' : n === 1 ? '1 item a comprar' : `${n} itens a comprar`;
  return {
    listId: list.id,
    label,
    caption: listShortcutCaption(list.pending),
    accessibilityLabel: `Abrir a lista ${label}, ${spoken}`,
  };
}
