// Detalhes do item da lista de compras: prioridade (uma só por item) e a
// ordem de "Para comprar", com os urgentes no topo.

import { compareByAisle } from './categories';

export type ListPriority = 'normal' | 'urgente' | 'promocao' | 'se_der';

export const PRIORITIES: { key: ListPriority; label: string }[] = [
  { key: 'normal', label: 'Normal' },
  { key: 'urgente', label: 'Urgente' },
  { key: 'promocao', label: 'Só em promoção' },
  { key: 'se_der', label: 'Se der' },
];

/** Selo do item na lista; normal não tem. */
export function priorityBadge(priority: string | null | undefined): { label: string; tone: 'danger' | 'info' | 'neutral' } | null {
  switch (priority) {
    case 'urgente':
      return { label: 'Urgente', tone: 'danger' };
    case 'promocao':
      return { label: 'Promoção', tone: 'info' };
    case 'se_der':
      return { label: 'Se der', tone: 'neutral' };
    default:
      return null;
  }
}

export const MAX_NOTES = 500;

/** Urgentes primeiro; o resto (e os urgentes entre si) na ordem dos corredores. */
export function compareForShopping(
  a: { category: string; name: string; priority?: string | null },
  b: { category: string; name: string; priority?: string | null },
): number {
  const urgent = Number(b.priority === 'urgente') - Number(a.priority === 'urgente');
  return urgent || compareByAisle(a, b);
}
