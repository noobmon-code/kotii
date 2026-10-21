// Carrinho -> despensa: o que vai (e com quanto) ao limpar o carrinho ou ao
// guardar um item só, e o aviso de compra repetida quando a nota chega depois.

import { getCategory } from './categories';
import { diffDays, toISODate } from './dates';
import { LinkIndex } from './listLinks';
import { estimateExpiry, type ExpirySource } from './pantry';
import { sameItemFit } from './sameItem';
import { normalizeSearch } from './search';

/** Até tantos dias de diferença, carrinho e nota contam como a mesma compra. */
export const SAME_PURCHASE_DAYS = 3;

/** O que já está na despensa (para achar a mesma compra). */
export interface PantryEntry {
  product_id: string | null;
  name: string;
  purchased_on: string;
}

/**
 * Quando o que só pode ser o mesmo item (domain/sameItem: um corte para
 * "Carne", um tipo que um dos lados não diz) conta como a mesma compra.
 * `sempre`: a nota, que pergunta antes de repetir. `nomeSolto`: só com um
 * nome digitado de um lado, sem produto ("Carne" do carrinho e o "Bife de
 * Alcatra" da nota); é o limpar o carrinho, que deixa de fora sem perguntar,
 * e dois produtos diferentes que só podem ser o mesmo ficam os dois.
 */
export type MaybeSamePurchase = 'sempre' | 'nomeSolto';

/**
 * Quão certo é que são a mesma compra (menor, mais certo), ou null:
 * 0: mesmo produto, nome de lista ligado ao produto do outro ("Cebola" do
 * carrinho e "Cebola Granel 600g" da nota, depois que a pessoa ligou os
 * dois); 1: o mesmo item da revisão da nota (domain/sameItem), de outra marca
 * ("Leite" do carrinho e "Leite UHT Parmalat" da nota), ou nomes em que um
 * começa pelo outro ("Leite" e "Leite Italac 1L"); 2: pode ser ele ("Carne"
 * e "Bombom da Alcatra"). O mesmo critério da nota não deixa o item entrar
 * duas vezes.
 */
function samePurchaseRank(
  a: { productId: string | null; name: string },
  b: PantryEntry,
  links: LinkIndex,
  maybe: MaybeSamePurchase,
): 0 | 1 | 2 | null {
  if (a.productId && a.productId === b.product_id) return 0;
  if (a.productId && links.has(b.name, a.productId)) return 0;
  if (b.product_id && links.has(a.name, b.product_id)) return 0;
  const fits = [sameItemFit({ name: a.name }, { names: [b.name] }), sameItemFit({ name: b.name }, { names: [a.name] })];
  // Outra coisa, mesmo começando pelo mesmo nome ("Leite" e "Leite condensado").
  if (fits.includes('outro')) return null;
  if (fits.includes('mesmo')) return 1;
  // Dois produtos diferentes não são o mesmo só porque um nome começa pelo outro.
  const twoProducts = Boolean(a.productId && b.product_id);
  if (fits.includes('talvez')) return maybe === 'sempre' || !twoProducts ? 2 : null;
  if (twoProducts) return null;
  const x = normalizeSearch(a.name);
  const y = normalizeSearch(b.name);
  if (!x || !y) return null;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return long === short || long.startsWith(`${short} `) ? 1 : null;
}

const nearDays = (a: string, b: string) => Math.abs(diffDays(a, b)) <= SAME_PURCHASE_DAYS;

/** A entrada da despensa que parece ser esta mesma compra, se houver; a mais certa primeiro. */
export function findSamePurchase<T extends PantryEntry>(
  item: { productId: string | null; name: string },
  purchasedOn: string,
  entries: T[],
  links: LinkIndex = new LinkIndex(),
  maybe: MaybeSamePurchase = 'sempre',
): T | undefined {
  let best: { entry: T; rank: number } | undefined;
  for (const entry of entries) {
    if (!nearDays(entry.purchased_on, purchasedOn)) continue;
    const rank = samePurchaseRank(item, entry, links, maybe);
    if (rank != null && (!best || rank < best.rank)) best = { entry, rank };
  }
  return best?.entry;
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
  { single, today, links }: { single: boolean; today: string; links?: LinkIndex },
): CartPantryRow[] {
  return items.map((item) => {
    const purchasedOn = item.checked_at ? toISODate(new Date(item.checked_at)) : today;
    // Fica de fora sem perguntar: dois produtos que só podem ser o mesmo ("Arroz integral" e "Arroz Camil") vão os dois.
    const same = pantry
      ? findSamePurchase({ productId: item.product_id, name: item.name }, purchasedOn, pantry, links, 'nomeSolto')
      : undefined;
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
 * Cada entrada da despensa é a repetição de uma compra só da nota (as linhas
 * do mesmo produto contam como uma), a mais certa: a "Carne" do carrinho é a
 * carne moída ou a alcatra da nota, não as duas.
 */
export function receiptPantryRepeats(
  payload: { id: string; product_id?: string; pantry?: { name: string } }[],
  purchasedOn: string,
  entries: PantryEntry[],
  links: LinkIndex = new LinkIndex(),
): PantryRepeat[] {
  const pairs = payload.flatMap((item, at) => {
    if (!item.pantry) return [];
    const purchase = { productId: item.product_id ?? null, name: item.pantry.name };
    return entries.flatMap((entry, entryAt) => {
      const rank = nearDays(entry.purchased_on, purchasedOn) ? samePurchaseRank(purchase, entry, links, 'sempre') : null;
      return rank == null ? [] : [{ at, entryAt, rank }];
    });
  });
  // A mais certa primeiro; no empate, a ordem da nota e a da despensa (a ordenação é estável).
  pairs.sort((a, b) => a.rank - b.rank);
  const purchaseOf = (at: number) => payload[at].product_id ?? `nome:${normalizeSearch(payload[at].pantry?.name ?? '')}`;
  const owner = new Map<number, string>();
  const repeatOf = new Map<number, PantryEntry>();
  for (const { at, entryAt, rank } of pairs) {
    if (repeatOf.has(at)) continue;
    const purchase = purchaseOf(at);
    const taken = owner.get(entryAt);
    // O mesmo produto (rank 0) é sempre a mesma compra; o resto, só se a entrada ainda não é de outra.
    if (rank > 0 && taken != null && taken !== purchase) continue;
    if (taken == null) owner.set(entryAt, purchase);
    repeatOf.set(at, entries[entryAt]);
  }
  return payload.flatMap((item, at) => {
    const same = repeatOf.get(at);
    return same && item.pantry ? [{ id: item.id, name: item.pantry.name, since: same.purchased_on }] : [];
  });
}
