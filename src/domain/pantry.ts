import { getCategory } from './categories';
import { addDays, diffDays } from './dates';
import { normalizeSearch } from './search';

export type ExpirySource = 'produto' | 'categoria' | 'manual';

export interface ExpiryEstimate {
  expiresOn: string | null;
  source: Exclude<ExpirySource, 'manual'> | null;
}

/**
 * Validade estimada sem o usuário digitar: validade aprendida do produto
 * (vinda de correções anteriores) ou, na falta dela, o padrão da categoria.
 */
export function estimateExpiry(input: {
  purchasedOn: string;
  category: string;
  productShelfLifeDays?: number | null;
}): ExpiryEstimate {
  if (input.productShelfLifeDays && input.productShelfLifeDays > 0) {
    return { expiresOn: addDays(input.purchasedOn, input.productShelfLifeDays), source: 'produto' };
  }
  const days = getCategory(input.category).shelfLifeDays;
  if (days == null) return { expiresOn: null, source: null };
  return { expiresOn: addDays(input.purchasedOn, days), source: 'categoria' };
}

export const EXPIRING_SOON_DAYS = 3;

export type ExpiryStatus =
  | { kind: 'sem_validade' }
  | { kind: 'vencido'; daysAgo: number }
  | { kind: 'vence_logo'; daysLeft: number }
  | { kind: 'ok'; daysLeft: number };

export function expiryStatus(expiresOn: string | null, today: string): ExpiryStatus {
  if (!expiresOn) return { kind: 'sem_validade' };
  const daysLeft = diffDays(today, expiresOn);
  if (daysLeft < 0) return { kind: 'vencido', daysAgo: -daysLeft };
  if (daysLeft <= EXPIRING_SOON_DAYS) return { kind: 'vence_logo', daysLeft };
  return { kind: 'ok', daysLeft };
}

export function describeExpiry(status: ExpiryStatus): string {
  switch (status.kind) {
    case 'sem_validade':
      return 'Sem validade';
    case 'vencido':
      return status.daysAgo === 0 ? 'Venceu hoje' : `Venceu há ${status.daysAgo} ${status.daysAgo === 1 ? 'dia' : 'dias'}`;
    case 'vence_logo':
      if (status.daysLeft === 0) return 'Vence hoje';
      if (status.daysLeft === 1) return 'Vence amanhã';
      return `Vence em ${status.daysLeft} dias`;
    case 'ok':
      return `Vence em ${status.daysLeft} dias`;
  }
}

/** Uma compra guardada na despensa. */
export interface PantryLot {
  id: string;
  product_id: string | null;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  purchased_on: string;
  expires_on: string | null;
}

/** Um produto na despensa, com as compras dele. */
export interface PantryGroup<T extends PantryLot> {
  key: string;
  productId: string | null;
  name: string;
  category: string;
  /** Da compra mais antiga para a mais nova. */
  lots: T[];
  /** A validade mais próxima entre as compras: a que pede atenção primeiro. */
  expiresOn: string | null;
  /** Quanto há ao todo, por unidade. */
  totals: { quantity: number; unit: string }[];
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * A despensa por produto: a mesma Coca comprada em três notas vira uma linha
 * só, com as três compras dentro. Item sem produto junta pelo nome. O nome
 * mostrado é o do produto no catálogo (`productNames`), que a pessoa pode
 * ter encurtado; sem ele, o da compra mais nova. Ordem: validade mais
 * próxima primeiro, sem validade no fim.
 */
export function groupPantry<T extends PantryLot>(
  items: T[],
  productNames: ReadonlyMap<string, string> = new Map(),
): PantryGroup<T>[] {
  const byKey = new Map<string, T[]>();
  for (const item of items) {
    const key = item.product_id ? `produto:${item.product_id}` : `nome:${normalizeSearch(item.name)}`;
    byKey.set(key, [...(byKey.get(key) ?? []), item]);
  }
  const groups = [...byKey].map(([key, list]): PantryGroup<T> => {
    const lots = [...list].sort((a, b) => a.purchased_on.localeCompare(b.purchased_on) || a.id.localeCompare(b.id));
    const newest = lots[lots.length - 1];
    const expiries = lots.flatMap((lot) => (lot.expires_on ? [lot.expires_on] : [])).sort();
    const totals = new Map<string, number>();
    for (const lot of lots) totals.set(lot.unit, round3((totals.get(lot.unit) ?? 0) + Number(lot.quantity)));
    return {
      key,
      productId: newest.product_id,
      name: (newest.product_id && productNames.get(newest.product_id)) || newest.name,
      category: newest.category,
      lots,
      expiresOn: expiries[0] ?? null,
      totals: [...totals].map(([unit, quantity]) => ({ quantity, unit })),
    };
  });
  return groups.sort(
    (a, b) =>
      (a.expiresOn ?? '9999-12-31').localeCompare(b.expiresOn ?? '9999-12-31') || a.name.localeCompare(b.name, 'pt-BR'),
  );
}

/** "Usei 1": `remaining` é o que sobra na compra; `null`, a compra acabou. */
export interface PantryTake {
  id: string;
  remaining: number | null;
}

/**
 * "Usei 1" sai da compra mais antiga: em unidades, desconta uma; em peso ou
 * volume (ou na última unidade), aquela compra acaba. Só faz sentido quando
 * sobra alguma coisa depois; senão, é o "acabou".
 */
export function takeOne(lots: PantryLot[]): PantryTake | null {
  const oldest = lots[0];
  if (!oldest) return null;
  const quantity = Number(oldest.quantity);
  if (oldest.unit === 'un' && quantity > 1) return { id: oldest.id, remaining: round3(quantity - 1) };
  return lots.length > 1 ? { id: oldest.id, remaining: null } : null;
}
