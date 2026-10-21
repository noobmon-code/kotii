// "Acho que acabou": pelo histórico de compras, o que a casa compra de tempos
// em tempos e já passou do ponto. Café a cada ~10 dias, última compra há 12:
// provavelmente acabou.

import type { ListKind } from '@/lib/types';
import { diffDays, toISODate, todayISO } from './dates';
import { groupPurchases, isExcluded, type ListExclusion, type PurchaseRecord, type RecentItem } from './recentPurchases';
import { normalizeSearch } from './search';

/** Quanto do histórico olhar (o servidor devolve até mil linhas por busca). */
export const RESTOCK_HISTORY_DAYS = 180;
/** Compras a até 2 dias uma da outra são a mesma ida (feira e mercado, nota lida no dia seguinte). */
export const SAME_TRIP_DAYS = 2;
/** Três compras (dois intervalos) antes de arriscar um palpite. */
const MIN_TRIPS = 3;
const MIN_EVERY_DAYS = 3;
/**
 * Até mês e meio: as três compras precisam caber no histórico já quando o
 * item vence (3 × 45 = 135 < 180). Depois, a mais antiga vai saindo da janela
 * e o palpite some sozinho antes das 3× de atraso, perto de 2× (180 − 2 × 45).
 */
const MAX_EVERY_DAYS = 45;
/** Muito depois do costume, a casa provavelmente parou de comprar. */
const GIVE_UP_FACTOR = 3;

export interface RestockItem extends Omit<RecentItem, 'times'> {
  /** De quantos em quantos dias a casa costuma comprar (mediana). */
  everyDays: number;
  /** Dias desde a última compra. */
  daysSince: number;
  /**
   * Os nomes e produtos com que o item foi comprado ("Leite IL Desnatado", "Leite Italac Desnatado"): o item
   * acabou com todos eles, e o selo "Na despensa" (pantryHits) os reconhece pelo nome de cada compra.
   */
  boughtAs: { name: string; productId: string | null }[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * A leitura do histórico: tudo o que já passou do intervalo de costume, do
 * mais atrasado para o menos. Não tira o que já está na lista nem desiste do
 * que passou demais (isso é da faixa, restockFrom): para o selo "Na despensa"
 * (pantryHits), o que passou do costume acabou, por mais tempo que faça,
 * enquanto as três compras couberem no histórico. `listKind` deixa só o que
 * cabe naquele tipo de lista: é para a faixa (restockSuggestions). O selo lê
 * sem ele, porque a vitamina posta na lista do mercado também acaba.
 */
export function ranOutItems(
  records: PurchaseRecord[],
  { now = new Date(), listKind }: { now?: Date; listKind?: ListKind } = {},
): RestockItem[] {
  const today = todayISO(now);
  const items: RestockItem[] = [];
  for (const { records: group, item } of groupPurchases(records, { now, days: RESTOCK_HISTORY_DAYS, listKind })) {
    const days = [...new Set(group.map((r) => toISODate(new Date(r.at))))].sort();
    const trips: string[] = [];
    for (const day of days) {
      if (!trips.length || diffDays(trips[trips.length - 1], day) > SAME_TRIP_DAYS) trips.push(day);
    }
    if (trips.length < MIN_TRIPS) continue;
    const everyDays = Math.round(median(trips.slice(1).map((day, i) => diffDays(trips[i], day))));
    if (everyDays < MIN_EVERY_DAYS || everyDays > MAX_EVERY_DAYS) continue;
    const daysSince = diffDays(days[days.length - 1], today);
    if (daysSince < everyDays) continue;
    const boughtAs = new Map(group.map((r) => [`${normalizeSearch(r.name)}\u0000${r.productId ?? ''}`, { name: r.name.trim(), productId: r.productId }]));
    items.push({ ...item, everyDays, daysSince, boughtAs: [...boughtAs.values()] });
  }
  // Primeiro o que passou mais do costume.
  return items.sort((a, b) => b.daysSince / b.everyDays - a.daysSince / a.everyDays || a.name.localeCompare(b.name, 'pt-BR'));
}

/**
 * A faixa "Acho que acabou", a partir do que passou do costume (ranOutItems):
 * sem o que a casa parece ter deixado de comprar e sem o que já está na lista.
 */
export function restockFrom(
  ranOut: readonly RestockItem[],
  { exclude, limit = 8 }: { exclude?: ListExclusion; limit?: number } = {},
): RestockItem[] {
  return ranOut
    .filter((item) => item.daysSince <= item.everyDays * GIVE_UP_FACTOR)
    .filter((item) => !isExcluded(item, exclude))
    .slice(0, limit);
}

/** A faixa direto do histórico, para quem não precisa da leitura inteira (a tela Hoje). */
export function restockSuggestions(
  records: PurchaseRecord[],
  { now, listKind, exclude, limit }: { now?: Date; listKind?: ListKind; exclude?: ListExclusion; limit?: number } = {},
): RestockItem[] {
  return restockFrom(ranOutItems(records, { now, listKind }), { exclude, limit });
}

/** "Costuma comprar a cada 7 dias · última há 9 dias" */
export function describeRestock(item: Pick<RestockItem, 'everyDays' | 'daysSince'>): string {
  return `Costuma comprar a cada ${item.everyDays} dias · última há ${item.daysSince} dias`;
}
