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

/**
 * O item repetido: somar na mesma unidade, ou a pessoa escolhe (outra unidade não se soma). `listed`: a pessoa não
 * disse quantidade e a unidade é outra: não há o que perguntar, ele já está na lista.
 */
export type RepeatChoice = { kind: 'sum'; quantity: number } | { kind: 'other_unit' } | { kind: 'listed' };

/**
 * O mesmo item posto de novo, com a quantidade digitada: na mesma unidade, a
 * quantidade do que está para comprar vira a soma ("2 kg" e mais "1 kg" dá
 * "3 kg"); em outra unidade ("2 un" e "1 kg") não há conta que valha, e a
 * pessoa escolhe entre pôr como outro item ou deixar como está. Sem
 * quantidade (`given: false`: o campo vazio e a unidade de sempre), a outra
 * unidade é só a de sempre, e não um pedido: o item já está na lista. O banco
 * pode entregar a quantidade como texto; a soma fica com até 3 casas, como no
 * banco.
 */
export function repeatedQuantity(
  listed: { quantity: number | string; unit: string },
  added: { quantity: number; unit: string; given?: boolean },
): RepeatChoice {
  if (listed.unit !== added.unit) return added.given === false ? { kind: 'listed' } : { kind: 'other_unit' };
  const before = Number(listed.quantity);
  const sum = (Number.isFinite(before) && before > 0 ? before : 0) + (added.quantity > 0 ? added.quantity : 0);
  return { kind: 'sum', quantity: Math.round(sum * 1000) / 1000 };
}
