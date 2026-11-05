import { getCategory } from './categories';
import { addDays, diffDays, formatShortDate } from './dates';
import { formatQuantity } from './money';
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

/** O nome de cada produto do catálogo, para groupPantry. */
export function productNameMap(products: readonly { id: string; name: string }[] = []): Map<string, string> {
  return new Map(products.map((p) => [p.id, p.name]));
}

/**
 * O produto (o grupo de groupPantry sobre `items` inteiro) a que esta compra pertence: a tela Hoje lista as compras
 * que vencem, e o toque abre o menu do produto, o mesmo da aba Casa → Despensa. A compra que não está em `items`
 * vira um grupo só dela.
 */
export function pantryGroupOf<T extends PantryLot>(
  items: T[],
  lot: T,
  productNames?: ReadonlyMap<string, string>,
): PantryGroup<T> {
  return (
    groupPantry(items, productNames).find((group) => group.lots.some((l) => l.id === lot.id)) ??
    groupPantry([lot], productNames)[0]
  );
}

/**
 * A compra tocada numa lista de compras (a seção Despensa da tela Hoje, uma linha por compra que vence): o menu do
 * produto diz qual é ela, pelo que a linha mostrava (a validade), porque as datas de compra a linha não mostrava.
 */
export interface PantryFocus {
  lotId: string;
  /** O dia de hoje (YYYY-MM-DD), para a validade da compra. */
  today: string;
}

/** "venceu há 2 dias", "vence amanhã": a validade da compra, como a linha da tela Hoje dizia, no meio da frase. */
function expiryNote(lot: PantryLot, today: string): string {
  const text = describeExpiry(expiryStatus(lot.expires_on, today));
  return text.charAt(0).toLowerCase() + text.slice(1);
}

const lotDate = (lot: PantryLot) => formatShortDate(lot.purchased_on);
const lotQuantity = (lot: PantryLot) => formatQuantity(lot.quantity, lot.unit);

/**
 * A mensagem do menu de um produto com mais de uma compra: "Compras: 2 set (1 un), 27 set (1 un) e 3 out (1 un).".
 * Com `focus`, a compra tocada leva a validade: "Compras: 27 out (1 un, venceu há 2 dias) e 2 nov (1 un).".
 */
export function describePantryLots(lots: readonly PantryLot[], focus?: PantryFocus | null): string {
  const parts = lots.map((lot) =>
    lot.id === focus?.lotId ? `${lotDate(lot)} (${lotQuantity(lot)}, ${expiryNote(lot, focus.today)})` : `${lotDate(lot)} (${lotQuantity(lot)})`,
  );
  return `Compras: ${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}.`;
}

/**
 * As ações "Editar" do menu de um produto: uma por compra, da mais nova para a mais antiga, "Editar a compra de 27 out
 * (1 un)"; duas no mesmo dia e com a mesma quantidade ganham um número ("· 1ª"). Com uma compra só, "Editar validade e
 * quantidade". Com `focus` (a compra tocada na tela Hoje, entre outras do mesmo produto), ela vem primeiro e é "esta
 * compra", com a validade que a linha mostrava: "Editar esta compra (vence amanhã)".
 */
export function pantryEditActions<T extends PantryLot>(lots: readonly T[], focus?: PantryFocus | null): { lot: T; label: string }[] {
  if (lots.length <= 1) return lots.map((lot) => ({ lot, label: 'Editar validade e quantidade' }));
  const newestFirst = [...lots].reverse();
  const focused = focus ? newestFirst.find((lot) => lot.id === focus.lotId) : undefined;
  const rest = focused ? newestFirst.filter((lot) => lot !== focused) : newestFirst;
  const labels = rest.map((lot) => `Editar a compra de ${lotDate(lot)} (${lotQuantity(lot)})`);
  const actions = rest.map((lot, index) => {
    const same = labels.filter((label) => label === labels[index]).length;
    const nth = labels.slice(0, index + 1).filter((label) => label === labels[index]).length;
    return { lot, label: same > 1 ? `${labels[index]} · ${nth}ª` : labels[index] };
  });
  return focused && focus ? [{ lot: focused, label: `Editar esta compra (${expiryNote(focused, focus.today)})` }, ...actions] : actions;
}

/**
 * "Usei 1": `remaining` é o que sobra na compra; `null`, a compra acabou.
 * `from` é a quantidade lida: só grava se ninguém mudou a compra no meio.
 */
export interface PantryTake {
  id: string;
  from: number;
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
  if (oldest.unit === 'un' && quantity > 1) return { id: oldest.id, from: quantity, remaining: round3(quantity - 1) };
  return lots.length > 1 ? { id: oldest.id, from: quantity, remaining: null } : null;
}
