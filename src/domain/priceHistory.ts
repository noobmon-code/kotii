// Histórico de preço de um produto: o que a casa pagou por ele em cada compra
// (linhas de notas confirmadas), ao longo do tempo. O preço é sempre o impresso
// na nota (unit_price), levado a kg, litro ou unidade para comparar; o que foi
// pago (com desconto) aparece só na linha da compra. Unidades que não se
// comparam (kg e un) nunca se misturam: cada uma tem o seu histórico. Tudo o
// que a seção mostra (frases, gráfico, linhas) sai daqui; a tela só desenha.

import { addMonths, diffDays, formatShortDate, toISODate } from './dates';
import { formatBRL, formatQuantity } from './money';
import { pricePerBase } from './units';

/** Uma linha de nota confirmada ligada ao produto, como o banco a dá. */
export interface PurchaseLine {
  id: string;
  receiptId: string;
  /** null: a nota ficou sem mercado. */
  storeId: string | null;
  storeName: string | null;
  /** Momento da compra (o banco guarda em UTC). */
  purchasedAt: string;
  quantity: number;
  unit: string;
  /** O preço impresso na nota, por `unit`. */
  unitPrice: number;
  /** O que foi pago na linha (já com o desconto do item, se houve). */
  totalPrice: number;
}

/** Uma compra do produto: as linhas iguais de uma mesma nota (mesma unidade, mesmo preço impresso), somadas. */
export interface Purchase {
  key: string;
  receiptId: string;
  /** Chave do mercado: o id dele, ou NO_STORE. */
  store: string;
  storeName: string;
  /** Dia da compra no fuso do aparelho (AAAA-MM-DD). */
  day: string;
  /** Momento da compra, para ordenar as do mesmo dia. */
  time: number;
  /** Quantidade e unidade como na nota ("500 ml"). */
  quantity: number;
  unit: string;
  /** A unidade em que os preços se comparam: kg, l ou un. */
  baseUnit: string;
  /** O preço impresso, por `baseUnit`. */
  price: number;
  /** O que foi pago, somando as linhas. */
  paid: number;
  discounted: boolean;
}

/** Nota sem mercado: conta no histórico, com este nome. */
export const NO_STORE = 'sem-mercado';
export const NO_STORE_NAME = 'Mercado não informado';
/** "Todos" nos chips de mercado. */
export const ALL_STORES = 'todos';

/**
 * Até quantos centavos o total da linha pode ficar abaixo de quantidade x
 * preço sem ser desconto: item por peso arredonda (0,755 kg x R$ 39,90 dá
 * R$ 30,1245, e a nota cobra R$ 30,12), e nota lida por foto pode errar um
 * centavo. Acima disso, a diferença é desconto do item.
 */
export const DISCOUNT_TOLERANCE_CENTS = 2;

const cents = (value: number) => Math.round(value * 100);

/** A linha saiu por menos do que quantidade x preço impresso (além do arredondamento). */
export function hasDiscount(line: Pick<PurchaseLine, 'quantity' | 'unitPrice' | 'totalPrice'>): boolean {
  return cents(line.quantity * line.unitPrice - line.totalPrice) > DISCOUNT_TOLERANCE_CENTS;
}

/** A mais recente primeiro; no mesmo instante (duas notas com a data digitada caem ao meio-dia), sempre na mesma ordem. */
const newestFirst = (a: Purchase, b: Purchase) => b.time - a.time || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/**
 * As compras do produto, da mais recente para a mais antiga. O caixa que
 * passa três caixas de leite uma a uma gera três linhas iguais na nota: aqui
 * elas são uma compra de 3 un. Linhas da mesma nota com preço impresso ou
 * unidade diferentes ficam separadas.
 */
export function toPurchases(lines: PurchaseLine[]): Purchase[] {
  const byKey = new Map<string, Purchase>();
  for (const line of lines) {
    const key = `${line.receiptId}|${line.unit}|${line.unitPrice}`;
    const same = byKey.get(key);
    if (same) {
      same.quantity = Math.round((same.quantity + line.quantity) * 1000) / 1000;
      same.paid = cents(same.paid + line.totalPrice) / 100;
      same.discounted = same.discounted || hasDiscount(line);
      continue;
    }
    const at = new Date(line.purchasedAt);
    const base = pricePerBase(line.unitPrice, line.unit);
    byKey.set(key, {
      key,
      receiptId: line.receiptId,
      store: line.storeId ?? NO_STORE,
      storeName: line.storeId ? (line.storeName ?? 'Mercado') : NO_STORE_NAME,
      // O dia é o do aparelho: a compra das 22h do dia 31 não cai no mês seguinte.
      day: toISODate(at),
      time: at.getTime(),
      quantity: line.quantity,
      unit: line.unit,
      baseUnit: base.unit,
      price: base.unitPrice,
      paid: line.totalPrice,
      discounted: hasDiscount(line),
    });
  }
  return [...byKey.values()].sort(newestFirst);
}

// ---------------------------------------------------------------------------
// Unidade, período e mercado

const UNIT_ORDER = ['un', 'kg', 'l'];
const UNIT_LABELS: Record<string, string> = { un: 'por unidade', kg: 'por kg', l: 'por litro' };

export const unitLabel = (unit: string) => UNIT_LABELS[unit] ?? `por ${unit}`;

/** As unidades em que o produto foi comprado (un, kg, l), nessa ordem. */
export function purchaseUnits(purchases: Purchase[]): string[] {
  const rank = (unit: string) => (UNIT_ORDER.includes(unit) ? UNIT_ORDER.indexOf(unit) : UNIT_ORDER.length);
  return [...new Set(purchases.map((p) => p.baseUnit))].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1));
}

/** A unidade com mais compras; no empate, a da compra mais recente. null sem compra nenhuma. */
export function defaultUnit(purchases: Purchase[]): string | null {
  const counts = new Map<string, number>();
  for (const p of purchases) counts.set(p.baseUnit, (counts.get(p.baseUnit) ?? 0) + 1);
  const most = Math.max(0, ...counts.values());
  // As compras vêm da mais recente para a mais antiga: a primeira das empatadas é a mais nova.
  return purchases.find((p) => counts.get(p.baseUnit) === most)?.baseUnit ?? null;
}

export type Period = '3m' | '6m' | '1a' | 'tudo';

export const PERIODS: { value: Period; label: string; months: number | null }[] = [
  { value: '3m', label: '3 meses', months: 3 },
  { value: '6m', label: '6 meses', months: 6 },
  { value: '1a', label: '1 ano', months: 12 },
  { value: 'tudo', label: 'Tudo', months: null },
];

/** O primeiro dia do período, contado para trás a partir de hoje (no fuso do aparelho); null em "Tudo". */
export function periodStart(period: Period, today: string): string | null {
  const months = PERIODS.find((p) => p.value === period)?.months;
  return months ? addMonths(today, -months) : null;
}

export function inPeriod(purchases: Purchase[], period: Period, today: string): Purchase[] {
  const since = periodStart(period, today);
  return since ? purchases.filter((p) => p.day >= since) : purchases;
}

/** "6 meses" quando há pelo menos duas compras neles; senão, "Tudo". */
export function defaultPeriod(purchases: Purchase[], today: string): Period {
  return inPeriod(purchases, '6m', today).length >= 2 ? '6m' : 'tudo';
}

export interface Option<T extends string = string> {
  value: T;
  label: string;
}

/** Os chips de mercado: "Todos" e um por mercado, só quando as compras vêm de dois ou mais. */
export function storeOptions(purchases: Purchase[]): Option[] {
  const names = new Map<string, string>();
  for (const p of purchases) names.set(p.store, p.storeName);
  if (names.size < 2) return [];
  const stores = [...names].map(([value, label]) => ({ value, label }));
  // Por nome; a compra sem mercado fica por último.
  stores.sort((a, b) => Number(a.value === NO_STORE) - Number(b.value === NO_STORE) || a.label.localeCompare(b.label, 'pt-BR'));
  return [{ value: ALL_STORES, label: 'Todos' }, ...stores];
}

// ---------------------------------------------------------------------------
// O resumo, em frases

const yearOf = (today: string) => Number(today.slice(0, 4));
const perUnit = (p: Purchase) => `${formatBRL(p.price)}/${p.baseUnit}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "R$ 25,90/un · Assaí · 10 out". */
export function latestSentence(purchase: Purchase, today: string): string {
  return `${perUnit(purchase)} · ${purchase.storeName} · ${formatShortDate(purchase.day, yearOf(today))}`;
}

/**
 * Quanto o preço mudou, em porcento inteiro (13, -8, 0). A metade arredonda
 * para longe do zero, igual para cima e para baixo (0,5% é 1%, -0,5% é -1%;
 * 0,4% é 0). null quando o preço de partida é zero: não há porcento de nada.
 */
export function percentChange(from: number, to: number): number | null {
  if (!(from > 0)) return null;
  // Seis casas antes de arredondar: 8,04 sobre 8,00 é 0,5%, não 0,4999999999.
  const percent = Math.round(((to - from) / from) * 100 * 1e6) / 1e6;
  const whole = Math.round(Math.abs(percent));
  return whole === 0 ? 0 : Math.sign(percent) * whole;
}

/**
 * O que mudou da primeira compra do período para a última: "Subiu 13% desde
 * 12 jul (era R$ 22,90)", "Caiu 8% desde…", ou "Mesmo preço desde 12 jul"
 * quando a mudança arredonda para 0%. Só com compras em dois dias diferentes.
 * Com as duas em mercados diferentes (só acontece sem mercado escolhido), a
 * frase diz isso: diferença entre mercados não é o preço que subiu.
 */
export function changeSentence(first: Purchase, last: Purchase, today: string): string | null {
  if (first.day === last.day) return null;
  const since = `desde ${formatShortDate(first.day, yearOf(today))}`;
  const elsewhere =
    first.store === last.store ? null : first.store === NO_STORE ? 'numa compra sem mercado informado' : `em outro mercado: ${first.storeName}`;
  const same = `Mesmo preço ${since}${elsewhere ? ` (${elsewhere})` : ''}`;
  const was = `(era ${formatBRL(first.price)}${elsewhere ? `, ${elsewhere}` : ''})`;
  const percent = percentChange(first.price, last.price);
  // Era de graça (preço zero na nota): se agora custa, subiu, sem porcento.
  if (percent == null) return cents(last.price) > 0 ? `Subiu ${since} ${was}` : same;
  if (percent === 0) return same;
  return `${percent > 0 ? 'Subiu' : 'Caiu'} ${Math.abs(percent)}% ${since} ${was}`;
}

/** O menor e o maior preço; no empate, vale a compra mais recente. null sem compras. */
export function priceRange(purchases: Purchase[]): { lowest: Purchase; highest: Purchase } | null {
  if (!purchases.length) return null;
  // Da mais recente para a mais antiga, só troca por um preço de fato menor (ou maior).
  const sorted = [...purchases].sort(newestFirst);
  let [lowest] = sorted;
  let highest = lowest;
  for (const p of sorted) {
    if (p.price < lowest.price) lowest = p;
    if (p.price > highest.price) highest = p;
  }
  return { lowest, highest };
}

/**
 * "Menor: R$ 21,90 (Atacadão, 12 ago) · Maior: R$ 27,90 (Assaí, 3 set)"; com
 * todas as compras no mesmo preço, "Sempre R$ 25,90 neste período". null com
 * menos de duas compras.
 */
export function rangeSentence(purchases: Purchase[], period: Period, today: string): string | null {
  const range = priceRange(purchases);
  if (!range || purchases.length < 2) return null;
  const { lowest, highest } = range;
  if (cents(lowest.price) === cents(highest.price)) {
    return `Sempre ${formatBRL(lowest.price)}${period === 'tudo' ? '' : ' neste período'}`;
  }
  const at = (p: Purchase) => `${formatBRL(p.price)} (${p.storeName}, ${formatShortDate(p.day, yearOf(today))})`;
  return `Menor: ${at(lowest)} · Maior: ${at(highest)}`;
}

/** A mediana dos preços; null sem compras. */
export function medianPrice(purchases: Purchase[]): number | null {
  if (!purchases.length) return null;
  const sorted = purchases.map((p) => p.price).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** "Costuma custar R$ 24,50": a mediana do período, a partir de três compras (e só se o preço variou). */
export function usualSentence(purchases: Purchase[]): string | null {
  const range = priceRange(purchases);
  if (!range || purchases.length < 3 || cents(range.lowest.price) === cents(range.highest.price)) return null;
  return `Costuma custar ${formatBRL(medianPrice(purchases)!)}`;
}

const PERIOD_WORDS: Record<Period, string> = { '3m': ' em 3 meses', '6m': ' em 6 meses', '1a': ' em 1 ano', tudo: '' };

/** "8 compras em 6 meses", "1 compra". */
export function countSentence(count: number, period: Period): string {
  return `${plural(count, 'compra', 'compras')}${PERIOD_WORDS[period]}`;
}

/** Período sem compra nenhuma: diz isso e onde ver mais. */
export function emptyPeriodSentence(period: Period): string {
  const when = period === '1a' ? 'no último ano' : `nos últimos ${PERIODS.find((p) => p.value === period)?.label}`;
  return period === 'tudo' ? 'Nenhuma compra ainda.' : `Nenhuma compra ${when}. Veja em "Tudo".`;
}

/**
 * O resumo acima do gráfico, uma frase por linha. `purchases` são as compras
 * à vista (da unidade, do período e do mercado escolhidos), da mais recente
 * para a mais antiga. Com uma compra só, o resumo é ela.
 */
export function summarize(purchases: Purchase[], { period, today }: { period: Period; today: string }): string[] {
  if (!purchases.length) return [emptyPeriodSentence(period)];
  const last = purchases[0];
  const first = purchases[purchases.length - 1];
  return [
    latestSentence(last, today),
    changeSentence(first, last, today),
    rangeSentence(purchases, period, today),
    usualSentence(purchases),
    countSentence(purchases.length, period),
  ].filter((sentence): sentence is string => sentence != null);
}

// ---------------------------------------------------------------------------
// O gráfico

export interface ChartPoint {
  key: string;
  /** 0 = o primeiro dia, 1 = o último (proporcional ao tempo). */
  x: number;
  /** 0 = o menor preço, 1 = o maior. */
  y: number;
  /** A compra mais recente, que o gráfico destaca. */
  latest: boolean;
}

/**
 * Os pontos do gráfico, da compra mais antiga para a mais recente, em 0..1.
 * Todas no mesmo dia (ou uma só) ficam no meio da largura; todas no mesmo
 * preço, no meio da altura. Duas compras no mesmo dia têm o mesmo x.
 */
export function chartPoints(purchases: Purchase[]): ChartPoint[] {
  const sorted = [...purchases].sort(newestFirst).reverse();
  const range = priceRange(sorted);
  if (!range) return [];
  const firstDay = sorted[0].day;
  const days = diffDays(firstDay, sorted[sorted.length - 1].day);
  // Preços iguais como aparecem na tela (em centavos) são o mesmo preço: linha reta.
  const spread = cents(range.highest.price) === cents(range.lowest.price) ? 0 : range.highest.price - range.lowest.price;
  return sorted.map((p, index) => ({
    key: p.key,
    x: days > 0 ? diffDays(firstDay, p.day) / days : 0.5,
    y: spread > 0 ? (p.price - range.lowest.price) / spread : 0.5,
    latest: index === sorted.length - 1,
  }));
}

export interface PriceChart {
  points: ChartPoint[];
  /** O menor e o maior preço, escritos à esquerda (iguais quando o preço não variou). */
  lowLabel: string;
  highLabel: string;
  /** A primeira e a última data, embaixo. */
  firstDate: string;
  lastDate: string;
  /** O mesmo em palavras, para leitor de tela. */
  label: string;
}

/**
 * O gráfico do preço ao longo do tempo. null sem compras em pelo menos dois
 * dias diferentes: com uma compra (ou várias no mesmo dia) não há linha do
 * tempo a desenhar, e o resumo e a lista bastam.
 */
export function priceChart(purchases: Purchase[], { productName, today }: { productName: string; today: string }): PriceChart | null {
  const points = chartPoints(purchases);
  const range = priceRange(purchases);
  if (!range || !points.some((p) => p.x !== points[0].x)) return null;
  const sorted = [...purchases].sort(newestFirst);
  const last = sorted[0];
  const firstDate = formatShortDate(sorted[sorted.length - 1].day, yearOf(today));
  const lastDate = formatShortDate(last.day, yearOf(today));
  const lowLabel = formatBRL(range.lowest.price);
  const highLabel = formatBRL(range.highest.price);
  const prices = lowLabel === highLabel ? `sempre ${lowLabel}` : `de ${lowLabel} a ${highLabel}; o último, ${formatBRL(last.price)}`;
  return { points, lowLabel, highLabel, firstDate, lastDate, label: `Preço de ${productName} de ${firstDate} a ${lastDate}: ${prices}` };
}

// ---------------------------------------------------------------------------
// As compras, uma por linha

export interface PurchaseRow {
  key: string;
  /** A nota que a linha abre. */
  receiptId: string;
  /** O mercado. */
  title: string;
  /** "10 out · 2 un · pagou R$ 51,80" (com o ano quando não é o de hoje). */
  detail: string;
  /** O preço impresso: "R$ 25,90/un". */
  price: string;
  discounted: boolean;
}

export function purchaseRow(purchase: Purchase, today: string): PurchaseRow {
  return {
    key: purchase.key,
    receiptId: purchase.receiptId,
    title: purchase.storeName,
    detail: `${formatShortDate(purchase.day, yearOf(today))} · ${formatQuantity(purchase.quantity, purchase.unit)} · pagou ${formatBRL(purchase.paid)}`,
    price: perUnit(purchase),
    discounted: purchase.discounted,
  };
}

/** Quantas compras a lista mostra de início, e quantas mais a cada "Ver mais". */
export const ROWS_AT_FIRST = 10;
export const ROWS_PER_MORE = 20;

/** "Ver mais (faltam 12)": quantas ainda não apareceram; null quando já estão todas à vista. */
export function moreLabel(left: number): string | null {
  return left > 0 ? `Ver mais (${left === 1 ? 'falta' : 'faltam'} ${left})` : null;
}

// ---------------------------------------------------------------------------
// A seção inteira

export interface HistoryChoices {
  /** O que a pessoa escolheu; null (ou o que não existe mais) vale o padrão. */
  unit: string | null;
  period: Period | null;
  store: string | null;
  /** Quantas vezes tocou em "Ver mais". */
  more: number;
}

export interface PriceHistoryView {
  /** As unidades a escolher ("por kg", "por unidade"); vazio quando o produto só tem uma. */
  units: Option[];
  unit: string;
  periods: Option<Period>[];
  period: Period;
  /** Os mercados a escolher; vazio quando as compras à vista vêm de um só. */
  stores: Option[];
  store: string;
  summary: string[];
  chart: PriceChart | null;
  rows: PurchaseRow[];
  /** "Ver mais (faltam 12)", ou null com todas as compras à vista. */
  more: string | null;
}

/**
 * Tudo o que a seção "Histórico de preço" mostra, a partir das compras do
 * produto e do que a pessoa escolheu. null quando o produto não tem compra
 * nenhuma.
 */
export function priceHistoryView(
  purchases: Purchase[],
  choices: HistoryChoices,
  { today, productName }: { today: string; productName: string },
): PriceHistoryView | null {
  const allUnits = purchaseUnits(purchases);
  const unit = choices.unit && allUnits.includes(choices.unit) ? choices.unit : defaultUnit(purchases);
  if (!unit) return null;
  const ofUnit = purchases.filter((p) => p.baseUnit === unit);
  const period = choices.period ?? defaultPeriod(ofUnit, today);
  const ofPeriod = inPeriod(ofUnit, period, today);
  const stores = storeOptions(ofPeriod);
  // O mercado escolhido que saiu de vista (outro período, outra unidade) volta a "Todos".
  const store = stores.some((s) => s.value === choices.store) ? choices.store! : ALL_STORES;
  const shown = store === ALL_STORES ? ofPeriod : ofPeriod.filter((p) => p.store === store);
  const visible = shown.slice(0, ROWS_AT_FIRST + Math.max(0, choices.more) * ROWS_PER_MORE);
  return {
    units: allUnits.length > 1 ? allUnits.map((value) => ({ value, label: unitLabel(value) })) : [],
    unit,
    periods: PERIODS.map(({ value, label }) => ({ value, label })),
    period,
    stores,
    store,
    summary: summarize(shown, { period, today }),
    chart: priceChart(shown, { productName, today }),
    rows: visible.map((p) => purchaseRow(p, today)),
    more: moreLabel(shown.length - visible.length),
  };
}
