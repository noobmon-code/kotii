// "Acho que acabou": pelo histórico de compras, o que a casa compra de tempos
// em tempos e já passou do ponto. Café a cada ~10 dias, última compra há 12:
// provavelmente acabou.

import type { ListKind } from '@/lib/types';
import { diffDays, toISODate, todayISO } from './dates';
import { groupPurchases, type ListExclusion, type PurchaseRecord, type RecentItem } from './recentPurchases';

/** Quanto do histórico olhar: dá para ver o que se compra a cada mês ou dois. */
export const RESTOCK_HISTORY_DAYS = 180;
/** Compras a até 2 dias uma da outra são a mesma ida (feira e mercado, nota lida no dia seguinte). */
const SAME_TRIP_DAYS = 2;
/** Três compras (dois intervalos) antes de arriscar um palpite. */
const MIN_TRIPS = 3;
const MIN_EVERY_DAYS = 3;
const MAX_EVERY_DAYS = 60;
/** Muito depois do costume, a casa provavelmente parou de comprar. */
const GIVE_UP_FACTOR = 3;

export interface RestockItem extends Omit<RecentItem, 'times'> {
  /** De quantos em quantos dias a casa costuma comprar (mediana). */
  everyDays: number;
  /** Dias desde a última compra. */
  daysSince: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function restockSuggestions(
  records: PurchaseRecord[],
  {
    now = new Date(),
    listKind,
    exclude,
    limit = 8,
  }: { now?: Date; listKind?: ListKind; exclude?: ListExclusion; limit?: number } = {},
): RestockItem[] {
  const today = todayISO(now);
  const items: RestockItem[] = [];
  for (const { records: group, item } of groupPurchases(records, { now, days: RESTOCK_HISTORY_DAYS, listKind, exclude })) {
    const days = [...new Set(group.map((r) => toISODate(new Date(r.at))))].sort();
    const trips: string[] = [];
    for (const day of days) {
      if (!trips.length || diffDays(trips[trips.length - 1], day) > SAME_TRIP_DAYS) trips.push(day);
    }
    if (trips.length < MIN_TRIPS) continue;
    const everyDays = Math.round(median(trips.slice(1).map((day, i) => diffDays(trips[i], day))));
    if (everyDays < MIN_EVERY_DAYS || everyDays > MAX_EVERY_DAYS) continue;
    const daysSince = diffDays(days[days.length - 1], today);
    if (daysSince < everyDays || daysSince > everyDays * GIVE_UP_FACTOR) continue;
    items.push({ ...item, everyDays, daysSince });
  }
  // Primeiro o que passou mais do costume.
  return items
    .sort((a, b) => b.daysSince / b.everyDays - a.daysSince / a.everyDays || a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, limit);
}

/** "Costuma comprar a cada 7 dias · última há 9 dias" */
export function describeRestock(item: Pick<RestockItem, 'everyDays' | 'daysSince'>): string {
  return `Costuma comprar a cada ${item.everyDays} dias · última há ${item.daysSince} dias`;
}
