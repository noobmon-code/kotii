// Para onde vai o item que acabou na despensa: a lista aberta mais nova que
// serve para ele (a última criada), ou outra que a pessoa escolhe.

import type { ListKind } from '@/lib/types';

import { fitsList } from './recentPurchases';

export interface ListChoice {
  id: string;
  name: string;
  kind: ListKind;
  created_at: string;
  archived_at?: string | null;
}

/**
 * As listas abertas em que o item cabe (fitsList: remédio não vai para a de
 * mercado, arroz não vai para a da farmácia), da mais nova para a mais
 * antiga. A primeira é a "última lista criada".
 */
export function listsFor<T extends ListChoice>(category: string, lists: readonly T[]): T[] {
  return lists
    .filter((list) => !list.archived_at && fitsList(category, list.kind))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
}

/** Sem lista aberta em que o item caiba, a lista nova é de farmácia para o que só cabe nela, e de mercado para o resto. */
export function newListKind(category: string): Extract<ListKind, 'mercado' | 'farmacia'> {
  return fitsList(category, 'mercado') ? 'mercado' : 'farmacia';
}

/** A lista escolhida foi arquivada (ou apagada) em outro aparelho entre abrir o menu e tocar. */
export const PANTRY_LIST_GONE = 'Essa lista não está mais aberta. Escolha outra.';
