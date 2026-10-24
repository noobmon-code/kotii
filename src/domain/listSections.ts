// As seções de "Para comprar": os urgentes e depois os corredores do mercado
// (a ordem de CATEGORIES). A tela e o texto que vai pelo WhatsApp (listShare)
// partem daqui, então os dois mostram os mesmos títulos na mesma ordem.

import { getCategory } from './categories';
import { compareForShopping, PRIORITIES } from './listItem';

/** Até aqui a lista vai corrida; com mais itens a comprar, ganha os nomes das seções. */
export const SECTIONS_ABOVE = 8;

const URGENT = 'urgente';

/** O que a seção usa de cada item. */
export interface SectionItem {
  name: string;
  category: string;
  priority?: string | null;
}

/** Com seções, os urgentes (que ficam no topo) ficam na seção deles; o resto, na da categoria. */
export function sectionOf(item: SectionItem): string {
  return item.priority === URGENT ? PRIORITIES.find((p) => p.key === URGENT)!.label : getCategory(item.category).label;
}

export interface ShoppingSection<T> {
  /** O nome da seção; null quando a lista vai corrida, sem títulos. */
  title: string | null;
  items: T[];
}

/**
 * Os itens a comprar na ordem de "Para comprar" (compareForShopping), em
 * seções quando são mais de SECTIONS_ABOVE e de mais de uma seção. Uma seção
 * só (a lista toda de limpeza, ou toda em "Outros") seria um título a mais sem
 * dizer nada: aí vai uma seção sem título, como a lista curta.
 */
export function shoppingSections<T extends SectionItem>(toBuy: readonly T[]): ShoppingSection<T>[] {
  const sorted = [...toBuy].sort(compareForShopping);
  if (!sorted.length) return [];
  if (sorted.length <= SECTIONS_ABOVE || new Set(sorted.map(sectionOf)).size < 2) return [{ title: null, items: sorted }];
  const sections: ShoppingSection<T>[] = [];
  for (const item of sorted) {
    const title = sectionOf(item);
    const last = sections[sections.length - 1];
    if (last?.title === title) last.items.push(item);
    else sections.push({ title, items: [item] });
  }
  return sections;
}
