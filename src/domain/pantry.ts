import { getCategory } from './categories';
import { addDays, diffDays, formatShortDate } from './dates';
import { formatQuantity } from './money';
import { normalizeSearch } from './search';

/** A validade que o app estima sozinho: aprendida do produto ou o padrão da categoria. */
export type EstimateSource = 'produto' | 'categoria';

/**
 * De onde veio a validade da compra: estimada pelo app (`categoria`, pelo congelador `congelado`, ou contada de novo
 * depois de descongelar `descongelado`), aprendida do produto (`produto`) ou digitada (`manual`). null com data só
 * nas compras antigas.
 */
export type ExpirySource = EstimateSource | 'manual' | 'congelado' | 'descongelado';

/** As origens que o banco aceita (o check de pantry_items.expiry_source; um teste lê a migração). */
export const EXPIRY_SOURCES: readonly ExpirySource[] = ['categoria', 'produto', 'manual', 'congelado', 'descongelado'];

export interface ExpiryEstimate {
  expiresOn: string | null;
  source: EstimateSource | null;
}

/**
 * Validade que o app estimou, e não alguém digitou ou o produto aprendeu: desenhada em cor neutra, com "~". A
 * aprendida (`produto`) conta como certa: veio de uma validade que alguém digitou.
 */
export const isEstimatedExpiry = (source: ExpirySource | null | undefined): boolean =>
  source === 'categoria' || source === 'congelado' || source === 'descongelado';

/** Como o leitor de tela começa a validade estimada (nunca o "til"). */
export const ESTIMATED_EXPIRY_SPOKEN = 'Validade estimada: ';
/** Como o leitor de tela começa a validade certa. */
export const EXPIRY_SPOKEN = 'Validade: ';

/** O selo da validade: o texto na tela, o que o leitor de tela diz e se é estimada (cor neutra). */
export interface ExpiryBadge {
  label: string;
  accessibilityLabel: string;
  estimated: boolean;
}

/**
 * A compra está no congelador agora: foi congelada e ainda não saiu. As colunas faltam antes da migração (e nas
 * cópias guardadas de antes desta versão): aí não está. As regras do congelador estão em domain/freezer.
 */
export const isFrozen = (lot: { frozen_on?: string | null; thawed_on?: string | null }): boolean =>
  Boolean(lot.frozen_on) && !lot.thawed_on;

/** "descongelado em 20 nov", com o ano quando é outro. */
export const thawedLotNote = (thawedOn: string, today: string) =>
  `descongelado em ${formatShortDate(thawedOn, Number(today.slice(0, 4)))}`;

/** "Usei 1" e o congelador quando a compra mudou em outro aparelho no meio. */
export const PANTRY_CHANGED = 'A despensa mudou enquanto isso. Confira e tente de novo.';
export const PANTRY_CHANGED_TITLE = 'A despensa mudou';

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

/**
 * O selo da validade (null sem validade). A estimada leva "~" e a primeira letra minúscula ("~ vence em 3 dias"), e
 * o leitor de tela diz "Validade estimada: vence em 3 dias"; a certa, o texto de sempre ("Validade: Vence em 3 dias").
 */
export function expiryBadge(status: ExpiryStatus, estimated: boolean): ExpiryBadge | null {
  if (status.kind === 'sem_validade') return null;
  const text = describeExpiry(status);
  const lower = `${text[0].toLowerCase()}${text.slice(1)}`;
  return estimated
    ? { label: `~ ${lower}`, accessibilityLabel: `${ESTIMATED_EXPIRY_SPOKEN}${lower}`, estimated: true }
    : { label: text, accessibilityLabel: `${EXPIRY_SPOKEN}${lower}`, estimated: false };
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
  /** As colunas do congelador: undefined antes da migração e nas cópias guardadas de antes desta versão. */
  expiry_source?: ExpirySource | null;
  frozen_on?: string | null;
  thawed_on?: string | null;
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
  /** As compras estão no congelador (o grupo só junta compras congeladas com compras congeladas). */
  frozen: boolean;
  /** O primeiro dia em que uma das compras foi para o congelador; null fora dele. */
  frozenOn: string | null;
  /** A validade mais próxima é estimada: todas as compras com essa data são estimadas (a certa vence o empate). */
  expiryEstimated: boolean;
  /** A compra que decide a validade saiu do congelador neste dia; null quando não saiu. */
  thawedOn: string | null;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * A despensa por produto: a mesma Coca comprada em três notas vira uma linha
 * só, com as três compras dentro. Item sem produto junta pelo nome. O nome
 * mostrado é o do produto no catálogo (`productNames`), que a pessoa pode
 * ter encurtado; sem ele, o da compra mais nova. Ordem: validade mais
 * próxima primeiro, sem validade no fim. O que está no congelador é outro
 * grupo (o frango fresco e o congelado são duas linhas: "Congelar" e
 * "Descongelei" sempre valem para o grupo inteiro); o descongelado volta
 * para o grupo do fresco.
 */
export function groupPantry<T extends PantryLot>(
  items: T[],
  productNames: ReadonlyMap<string, string> = new Map(),
): PantryGroup<T>[] {
  const byKey = new Map<string, T[]>();
  for (const item of items) {
    const base = item.product_id ? `produto:${item.product_id}` : `nome:${normalizeSearch(item.name)}`;
    const key = isFrozen(item) ? `${base}:congelado` : base;
    byKey.set(key, [...(byKey.get(key) ?? []), item]);
  }
  const groups = [...byKey].map(([key, list]): PantryGroup<T> => {
    const lots = [...list].sort((a, b) => a.purchased_on.localeCompare(b.purchased_on) || a.id.localeCompare(b.id));
    const newest = lots[lots.length - 1];
    const expiries = lots.flatMap((lot) => (lot.expires_on ? [lot.expires_on] : [])).sort();
    const expiresOn = expiries[0] ?? null;
    const deciding = expiresOn ? lots.filter((lot) => lot.expires_on === expiresOn) : [];
    const thawed = deciding[0]?.thawed_on ?? null;
    const frozenDays = lots.flatMap((lot) => (isFrozen(lot) && lot.frozen_on ? [lot.frozen_on] : [])).sort();
    const totals = new Map<string, number>();
    for (const lot of lots) totals.set(lot.unit, round3((totals.get(lot.unit) ?? 0) + Number(lot.quantity)));
    return {
      key,
      productId: newest.product_id,
      name: (newest.product_id && productNames.get(newest.product_id)) || newest.name,
      category: newest.category,
      lots,
      expiresOn,
      totals: [...totals].map(([unit, quantity]) => ({ quantity, unit })),
      frozen: lots.every(isFrozen),
      frozenOn: frozenDays[0] ?? null,
      expiryEstimated: deciding.length > 0 && deciding.every((lot) => isEstimatedExpiry(lot.expiry_source)),
      thawedOn: thawed || null,
    };
  });
  return groups.sort(
    (a, b) =>
      (a.expiresOn ?? '9999-12-31').localeCompare(b.expiresOn ?? '9999-12-31') || a.name.localeCompare(b.name, 'pt-BR'),
  );
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

/**
 * "Compras: 2 set (1 un), 27 set (1 un) e 3 out (1 un)." A compra que saiu do congelador diz quando: "12 nov (1 un,
 * descongelado em 20 nov)". As datas de outro ano levam o ano.
 */
export function describeLots(group: Pick<PantryGroup<PantryLot>, 'lots'>, today: string): string {
  const year = Number(today.slice(0, 4));
  const parts = group.lots.map((lot) => {
    const amount = formatQuantity(lot.quantity, lot.unit);
    const note = lot.thawed_on ? `, ${thawedLotNote(lot.thawed_on, today)}` : '';
    return `${formatShortDate(lot.purchased_on, year)} (${amount}${note})`;
  });
  return `Compras: ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}` : parts[0]}.`;
}
