// Comprados recentemente: o que a casa comprou nos últimos meses (carrinhos
// limpos, itens ainda no carrinho e notas confirmadas), para montar a próxima
// lista com um toque. O que se compra mais vezes vem primeiro.

import type { ListKind, Unit } from '@/lib/types';
import { toISODate } from './dates';
import { genericItem } from './genericItem';
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

/**
 * O que já está na lista: nomes (normalizeSearch), produtos e, em `keys`, o
 * item sem a marca (genericItem): com "Leite IL Desnatado" na lista, "Leite
 * desnatado" não é sugerido.
 */
export interface ListExclusion {
  names: Set<string>;
  productIds: Set<string>;
  keys?: Set<string>;
}

/** O que está nas listas, para as faixas não sugerirem de novo. `justListed`: nomes postos agora há pouco (normalizeSearch). */
export function listExclusion(
  items: readonly { name: string; category?: string | null; product_id: string | null }[],
  justListed: Iterable<string> = [],
): ListExclusion {
  return {
    names: new Set([...items.map((i) => normalizeSearch(i.name)), ...justListed]),
    productIds: new Set(items.flatMap((i) => (i.product_id ? [i.product_id] : []))),
    keys: new Set(items.map((i) => genericItem(i.name, i.category).key)),
  };
}

/** O item já está na lista (pelo nome, pelo produto ou pelo item sem a marca). */
export function isExcluded(item: { name: string; category: string; productId: string | null }, exclude: ListExclusion | undefined): boolean {
  if (!exclude) return false;
  return (
    exclude.names.has(normalizeSearch(item.name)) ||
    Boolean(item.productId && exclude.productIds.has(item.productId)) ||
    Boolean(exclude.keys?.has(genericItem(item.name, item.category).key))
  );
}

export interface PurchaseGroup {
  key: string;
  /** Da compra mais recente para a mais antiga. */
  records: PurchaseRecord[];
  /** O item como vai para a lista: o nome sem a marca e a categoria da última compra, quantidade de sempre. */
  item: Omit<RecentItem, 'times'>;
}

/**
 * Junta as compras pelo item sem a marca (genericItem: "Leite IL Desnatado" e
 * "Leite Italac Desnatado" são uma compra só, de "Leite desnatado"), só as de
 * `days` dias para cá, e tira o que não cabe na lista ou já está nela. O
 * produto da última compra vai junto como dica de preço.
 */
export function groupPurchases(
  records: PurchaseRecord[],
  { now, days, listKind, exclude }: { now: Date; days: number; listKind?: ListKind; exclude?: ListExclusion },
): PurchaseGroup[] {
  const since = now.getTime() - days * 86_400_000;
  const byItem = new Map<string, PurchaseRecord[]>();
  for (const record of records) {
    const time = Date.parse(record.at);
    if (!record.name.trim() || Number.isNaN(time) || time < since || time > now.getTime()) continue;
    const key = genericItem(record.name, record.category).key;
    byItem.set(key, [...(byItem.get(key) ?? []), record]);
  }

  const groups: PurchaseGroup[] = [];
  for (const [key, group] of byItem) {
    const byDate = [...group].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const latest = byDate[0];
    const productId = byDate.find((r) => r.productId)?.productId ?? null;
    const name = genericItem(latest.name, latest.category).name;
    // Na lista com qualquer um dos nomes da compra, ou com o item sem a marca.
    if (exclude && (byDate.some((r) => exclude.names.has(normalizeSearch(r.name))) || isExcluded({ name, category: latest.category, productId }, exclude))) continue;
    if (!fitsList(latest.category, listKind)) continue;
    // A quantidade de lista mais recente vale mais que a do cupom.
    const fromList = byDate.find((r) => r.source === 'list');
    const base = fromList ?? latest;
    groups.push({
      key,
      records: byDate,
      item: {
        name,
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
