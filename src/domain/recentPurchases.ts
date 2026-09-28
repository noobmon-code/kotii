// Comprados recentemente: o que a casa comprou nos últimos meses (carrinhos
// limpos, itens ainda no carrinho e notas confirmadas), para montar a próxima
// lista com um toque. O que se compra mais vezes vem primeiro.

import type { ListKind, Unit } from '@/lib/types';
import { toISODate } from './dates';
import { normalizeSearch } from './search';

export const RECENT_DAYS = 90;

export interface PurchaseRecord {
  name: string;
  category: string;
  productId: string | null;
  quantity: number;
  unit: Unit;
  /** Quando foi comprado (ISO). */
  at: string;
  /** A lista guarda a quantidade como a casa pede; a nota, como saiu no cupom. */
  source: 'list' | 'receipt';
}

export interface RecentItem {
  name: string;
  category: string;
  productId: string | null;
  /** Quantidade sugerida para a próxima lista. */
  quantity: number;
  unit: Unit;
  /** Em quantos dias diferentes foi comprado. */
  times: number;
  lastAt: string;
}

const PHARMACY = ['medicamentos', 'suplementos', 'primeiros_socorros'];
// Na farmácia também se compra higiene e coisas de bebê.
const PHARMACY_LIST = [...PHARMACY, 'higiene', 'bebe'];

export function fitsList(category: string, listKind: ListKind | undefined): boolean {
  if (listKind === 'farmacia') return PHARMACY_LIST.includes(category);
  if (listKind === 'mercado') return !PHARMACY.includes(category);
  return true;
}

/** Quantidade da nota em jeito de lista: 1,234 kg vira 1 kg; 12 un continua 12 un. */
function listQuantity(quantity: number, unit: Unit): number {
  if (unit === 'un') return Math.max(1, Math.round(quantity));
  if (unit === 'g' || unit === 'ml') return Math.max(50, Math.round(quantity / 50) * 50);
  return Math.max(0.5, Math.round(quantity * 2) / 2);
}

/** O que já está na lista: nomes (normalizeSearch) e produtos. */
export interface ListExclusion {
  names: Set<string>;
  productIds: Set<string>;
}

export interface PurchaseGroup {
  key: string;
  /** Da compra mais recente para a mais antiga. */
  records: PurchaseRecord[];
  /** O item como vai para a lista: nome e categoria da última compra, quantidade de sempre. */
  item: Omit<RecentItem, 'times'>;
}

/**
 * Junta as compras pelo nome, só as de `days` dias para cá, e tira o que não
 * cabe na lista ou já está nela.
 */
export function groupPurchases(
  records: PurchaseRecord[],
  { now, days, listKind, exclude }: { now: Date; days: number; listKind?: ListKind; exclude?: ListExclusion },
): PurchaseGroup[] {
  const since = now.getTime() - days * 86_400_000;
  const byName = new Map<string, PurchaseRecord[]>();
  for (const record of records) {
    const time = Date.parse(record.at);
    if (!record.name.trim() || Number.isNaN(time) || time < since || time > now.getTime()) continue;
    const key = normalizeSearch(record.name);
    byName.set(key, [...(byName.get(key) ?? []), record]);
  }

  const groups: PurchaseGroup[] = [];
  for (const [key, group] of byName) {
    const byDate = [...group].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const latest = byDate[0];
    const productId = byDate.find((r) => r.productId)?.productId ?? null;
    if (exclude?.names.has(key) || (productId && exclude?.productIds.has(productId))) continue;
    if (!fitsList(latest.category, listKind)) continue;
    // A quantidade de lista mais recente vale mais que a do cupom.
    const fromList = byDate.find((r) => r.source === 'list');
    const base = fromList ?? latest;
    groups.push({
      key,
      records: byDate,
      item: {
        name: latest.name.trim(),
        category: latest.category,
        productId,
        quantity: fromList ? base.quantity : listQuantity(base.quantity, base.unit),
        unit: base.unit,
        lastAt: latest.at,
      },
    });
  }
  return groups;
}

export function recentPurchases(
  records: PurchaseRecord[],
  {
    now = new Date(),
    listKind,
    exclude,
    limit = 12,
  }: {
    now?: Date;
    listKind?: ListKind;
    exclude?: ListExclusion;
    limit?: number;
  } = {},
): RecentItem[] {
  return groupPurchases(records, { now, days: RECENT_DAYS, listKind, exclude })
    .map(({ records: group, item }) => ({ ...item, times: new Set(group.map((r) => toISODate(new Date(r.at)))).size }))
    .sort((a, b) => b.times - a.times || Date.parse(b.lastAt) - Date.parse(a.lastAt) || a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, limit);
}
