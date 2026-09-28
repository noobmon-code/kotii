// Carrinho -> despensa: o que vai (e com quanto) ao limpar o carrinho ou ao
// guardar um item só, e o aviso de compra repetida quando a nota chega depois.

import { getCategory } from './categories';
import { diffDays, toISODate } from './dates';
import { estimateExpiry, type ExpirySource } from './pantry';
import { normalizeSearch } from './search';

/** Até tantos dias de diferença, carrinho e nota contam como a mesma compra. */
export const SAME_PURCHASE_DAYS = 3;

/** O que já está na despensa (para achar a mesma compra). */
export interface PantryEntry {
  product_id: string | null;
  name: string;
  purchased_on: string;
}

/** Mesmo produto, ou nomes em que um começa pelo outro ("Leite" e "Leite Italac 1L"). */
function sameItem(a: { productId: string | null; name: string }, b: PantryEntry): boolean {
  if (a.productId && b.product_id) return a.productId === b.product_id;
  const x = normalizeSearch(a.name);
  const y = normalizeSearch(b.name);
  if (!x || !y) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return long === short || long.startsWith(`${short} `);
}

/** A entrada da despensa que parece ser esta mesma compra, se houver. */
export function findSamePurchase<T extends PantryEntry>(
  item: { productId: string | null; name: string },
  purchasedOn: string,
  entries: T[],
): T | undefined {
  return entries.find(
    (entry) => Math.abs(diffDays(entry.purchased_on, purchasedOn)) <= SAME_PURCHASE_DAYS && sameItem(item, entry),
  );
}

export interface CartItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  product_id: string | null;
  checked_at: string | null;
}

export interface CartPantryRow {
  id: string;
  name: string;
  category: string;
  unit: string;
  /** Quantidade da lista: o ponto de partida da quantidade comprada. */
  quantity: number;
  productId: string | null;
  /** Dia em que foi para o carrinho (fuso do aparelho). */
  purchasedOn: string;
  /** Vai para a despensa se a pessoa não mudar. */
  include: boolean;
  /** Já está na despensa, de uma compra de data próxima (a data dela). */
  alreadySince: string | null;
}

/**
 * Linhas da confirmação. Um item só (o botão do item) vai por padrão; no
 * limpar o carrinho, vai o que a categoria guarda na despensa e ainda não
 * está lá de uma compra próxima. Sem saber o que há na despensa (`null`:
 * sem internet e nunca carregada neste aparelho), o limpar não marca nada:
 * a pessoa escolhe, em vez de o app repetir o que talvez já esteja lá.
 */
export function cartPantryRows(
  items: CartItem[],
  pantry: PantryEntry[] | null,
  { single, today }: { single: boolean; today: string },
): CartPantryRow[] {
  return items.map((item) => {
    const purchasedOn = item.checked_at ? toISODate(new Date(item.checked_at)) : today;
    const same = pantry ? findSamePurchase({ productId: item.product_id, name: item.name }, purchasedOn, pantry) : undefined;
    const known = pantry !== null;
    return {
      id: item.id,
      name: item.name,
      category: item.category,
      unit: item.unit,
      quantity: Number(item.quantity),
      productId: item.product_id,
      purchasedOn,
      include: single || (known && getCategory(item.category).pantry && !same),
      alreadySince: same?.purchased_on ?? null,
    };
  });
}

/** O que vai para clear_checked_items (ver migration pantry_from_cart). */
export interface CartPantryEntry {
  id: string;
  quantity: number;
  purchased_on: string;
  expires_on: string | null;
  expiry_source: Exclude<ExpirySource, 'manual'> | null;
}

/** Linhas marcadas com a quantidade confirmada; validade estimada como na nota. */
export function cartPantryPayload(
  rows: CartPantryRow[],
  chosen: Record<string, { include: boolean; quantity: number | null }>,
  shelfLifeDays: Map<string, number | null>,
): CartPantryEntry[] {
  return rows.flatMap((row) => {
    const choice = chosen[row.id] ?? { include: row.include, quantity: row.quantity };
    if (!choice.include || !choice.quantity || choice.quantity <= 0) return [];
    const estimate = estimateExpiry({
      purchasedOn: row.purchasedOn,
      category: row.category,
      productShelfLifeDays: row.productId ? shelfLifeDays.get(row.productId) : null,
    });
    return [
      {
        id: row.id,
        quantity: choice.quantity,
        purchased_on: row.purchasedOn,
        expires_on: estimate.expiresOn,
        expiry_source: estimate.expiresOn ? estimate.source : null,
      },
    ];
  });
}

/** "Arroz", "Arroz e Leite", "Arroz, Leite e Pão". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

export interface PantryRepeat {
  id: string;
  name: string;
  since: string;
}

/**
 * Itens da nota que iriam para a despensa, mas que já estão lá de uma compra
 * de data próxima (pelo carrinho ou à mão): pedem confirmação antes de repetir.
 */
export function receiptPantryRepeats(
  payload: { id: string; product_id?: string; pantry?: { name: string } }[],
  purchasedOn: string,
  entries: PantryEntry[],
): PantryRepeat[] {
  return payload.flatMap((item) => {
    if (!item.pantry) return [];
    const same = findSamePurchase({ productId: item.product_id ?? null, name: item.pantry.name }, purchasedOn, entries);
    return same ? [{ id: item.id, name: item.pantry.name, since: same.purchased_on }] : [];
  });
}
