// Mercado do mês: para onde foi o dinheiro do mercado. Soma os itens das
// notas confirmadas de um mês por categoria de produto, por item, por ida e
// por mercado. Vale sempre o valor impresso em cada item: quando o total da
// nota não bate com a soma dos itens, a diferença aparece à parte (desconto
// no total, ou valor sem item lido) e nunca é espalhada pelos itens, como faz
// o resumo de gastos (buildEntries em finance.ts, que não muda por causa
// daqui). Limpeza, higiene e pet são mercado; remédio fica de fora da conta e
// aparece numa linha só.

import { joinNames } from './cartPantry';
import { getCategory } from './categories';
import { addDays, formatShortDate, toISODate } from './dates';
import { describeMonthDelta, financeCategoryOfProduct, monthLabel, monthRange, shiftMonth } from './finance';
import { listNameKey } from './listLinks';
import { formatBRL, formatQuantity } from './money';
import { convertQuantity, sameDimension } from './units';

/** O que a conta do total precisa de um item: o valor impresso e a categoria. */
export interface MarketTotalLine {
  /** A categoria do produto ligado ao item; null sem produto. */
  productCategory: string | null;
  suggestedCategory: string | null;
  /** O valor impresso na nota para o item (já com o desconto do item). */
  totalPrice: number | null;
}

/** Um item de nota, como está gravado. */
export interface MarketLine extends MarketTotalLine {
  productId: string | null;
  /** O nome do produto ligado ao item; null sem produto. */
  productName: string | null;
  rawDescription: string;
  suggestedName: string | null;
  quantity: number;
  unit: string;
}

/** O que a conta do total precisa de uma nota. O resumo de gastos já tem isso das notas que leu. */
export interface MarketTotalReceipt {
  /** Quando foi a compra (ISO, com hora); o mês é o do fuso do aparelho, como no resumo. */
  purchasedAt: string;
  status: 'draft' | 'confirmed';
  /** Total cobrado; null na nota digitada à mão. */
  total: number | null;
  lines: MarketTotalLine[];
}

export interface MarketReceipt extends MarketTotalReceipt {
  id: string;
  storeId: string | null;
  storeName: string | null;
  lines: MarketLine[];
}

/** O total do mês, como aparece no cabeçalho da tela e na entrada do resumo de gastos. */
export interface MarketTotal {
  /** O que foi pago: itens mais a parte do mercado nas diferenças das notas, sem a farmácia. */
  totalCents: number;
  trips: number;
  /** "R$ 1.240,00 em 6 idas" */
  headline: string;
  emptyTitle: string;
}

export interface MarketCategory {
  key: string;
  label: string;
  cents: number;
  amount: string;
  /** Parte da soma dos itens do mês: "22%", ou "<1%" para o que não chega a 1%. */
  share: string;
  /**
   * A diferença para o mês anterior, em palavras: "R$ 35,00 a mais que em setembro", "Igual a setembro",
   * "Não teve em setembro". Vazia quando o mês anterior não teve nota de mercado nenhuma (o cabeçalho já diz).
   */
  versusPrevious: string;
  accessibilityLabel: string;
}

export interface MarketItem {
  key: string;
  /** Produto do item; null para o que a casa não acompanha (junta pelo nome). */
  productId: string | null;
  name: string;
  category: string;
  cents: number;
  /** "R$ 45,00", ou "sem valor" quando nenhuma compra do item veio com valor. */
  amount: string;
  share: string;
  /** Quanto foi comprado, em quantas idas e o valor do mês anterior: "10 kg · em 3 idas · setembro: R$ 80,00". */
  detail: string;
  accessibilityLabel: string;
}

export interface MarketTrip {
  receiptId: string;
  storeName: string;
  cents: number;
  amount: string;
  /** "12 out · 18 itens" */
  detail: string;
  accessibilityLabel: string;
}

export interface MarketStore {
  /** O id do mercado; '' para as notas sem mercado. */
  key: string;
  name: string;
  cents: number;
  amount: string;
  /** "3 idas" */
  detail: string;
  accessibilityLabel: string;
}

/** Uma nota para a pessoa abrir e conferir. */
export interface MarketReceiptRef {
  receiptId: string;
  storeName: string;
  /** "12 out" */
  date: string;
  /** O que há para conferir nela: "R$ 20,00", "2 itens"; no rascunho, "Revisar". */
  value: string;
  accessibilityLabel: string;
}

export interface MarketMonth {
  month: string;
  /** "Mercado de outubro até hoje" */
  title: string;
  /** O que foi pago: itens mais as diferenças das notas, sem a farmácia. */
  totalCents: number;
  /** A soma dos itens, pelo valor impresso: é sobre ela que as partes (%) são contadas. */
  itemsCents: number;
  /** "R$ 1.240,00 em 6 idas" */
  headline: string;
  /** Comparação com o mês anterior; null sem idas no mês. */
  comparison: string | null;
  /** Da mais recente para a mais antiga. */
  trips: MarketTrip[];
  /** Da maior para a menor. */
  categories: MarketCategory[];
  /** Do que levou mais dinheiro para o que levou menos. */
  items: MarketItem[];
  stores: MarketStore[];
  /** "As porcentagens são sobre os itens lidos (R$ 1.200,00)."; null quando o total pago é a soma dos itens. */
  shareBasis: string | null;
  /**
   * O que há no total além dos itens lidos e o que ficou de fora dele, em poucas palavras: "Inclui R$ 20,00
   * de notas sem item lido e R$ 10,00 de descontos."; null quando não há nada disso no mês.
   */
  closing: string | null;
  /** Notas com total abaixo da soma dos itens. */
  discount: { label: string; value: string; accessibilityLabel: string } | null;
  /**
   * Notas com total acima da soma dos itens: a leitura perdeu um item ou um valor. `receipts` só traz as
   * notas com diferença acima de RECEIPT_CHECK_CENTS, e pode vir vazia.
   */
  unread: { label: string; value: string; accessibilityLabel: string; receipts: MarketReceiptRef[] } | null;
  /** Itens sem valor (contam zero), com as notas em que estão. */
  noValue: { label: string; hint: string; receipts: MarketReceiptRef[] } | null;
  /** "Farmácia, fora desta conta: R$ 42,00": o que foi pago nos itens de farmácia. */
  pharmacy: string | null;
  pharmacyCents: number;
  /** Rascunhos do mês, que ainda não contam: a frase, os mais recentes para abrir e "e mais 2 em Finanças > Notas". */
  drafts: { label: string; receipts: MarketReceiptRef[]; more: string | null } | null;
  emptyTitle: string;
}

/** As partes da tela, na ordem da chave; a primeira é a que abre. */
export type MarketView = 'itens' | 'categorias' | 'idas' | 'mercados';

export const MARKET_VIEWS: { value: MarketView; label: string }[] = [
  { value: 'itens', label: 'Itens' },
  { value: 'categorias', label: 'Categorias' },
  { value: 'idas', label: 'Idas' },
  { value: 'mercados', label: 'Mercados' },
];

/**
 * Até quantos centavos de diferença entre o total da nota e a soma dos itens
 * a nota não é listada para conferir. É a folga do aviso "A soma não bate com
 * o total" na tela da nota (`totalMismatch`, em src/app/nota/[id].tsx): abaixo
 * dela a pessoa abriria a nota e não veria nada de errado. Os valores
 * continuam exatos; só a lista de notas usa a folga.
 */
export const RECEIPT_CHECK_CENTS = 5;

/** Quantos rascunhos do mês aparecem um a um; o resto é contado. */
const DRAFTS_SHOWN = 3;

const NO_STORE_LABEL = 'Sem mercado informado';

// As contas são feitas em centavos: 0,1 + 0,2 não pode aparecer num total.
const cents = (value: number | null | undefined) => (value != null && Number.isFinite(value) ? Math.round(value * 100) : 0);
const money = (amount: number) => formatBRL(amount / 100);
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const monthName = (month: string) => monthLabel(month).split(' ')[0];
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Remédio fica fora do dinheiro do mercado: as categorias de produto que o resumo conta como Saúde. */
const isPharmacy = (category: string) => financeCategoryOfProduct(category) === 'saude';

/** A categoria do item é a do produto; sem produto, a sugerida na leitura; sem nenhuma, "outros" (como no resumo). */
const lineCategory = (line: MarketTotalLine) => getCategory(line.productCategory ?? line.suggestedCategory).key;

const lineName = (line: MarketLine) =>
  line.productName?.trim() || line.suggestedName?.trim() || line.rawDescription.trim() || 'Item sem nome';

/** O dia da compra, no fuso do aparelho. */
const purchasedOn = (receipt: MarketTotalReceipt) => toISODate(new Date(receipt.purchasedAt));

/**
 * O que junta as compras num item só: o produto. Item sem produto ("Não
 * acompanhar preço deste item") junta pelo nome sem acento, maiúscula nem
 * pontuação (listNameKey), dentro da categoria. Nome parecido não junta:
 * "Arroz 5kg" e "Arroz Tio João 5 kg" são duas linhas até a pessoa juntar os
 * produtos.
 */
function itemKey(line: MarketLine, category: string): string {
  if (line.productId) return `p:${line.productId}`;
  const name = lineName(line);
  return `n:${category}:${listNameKey(name) || name.toLowerCase()}`;
}

/**
 * Quanto foi comprado, somando o que é da mesma grandeza (kg com g, l com
 * ml, un com un): "2,5 kg", "12 un". null quando as unidades não se somam
 * (un e kg).
 */
export function totalQuantity(parts: { quantity: number; unit: string }[]): string | null {
  if (!parts.length) return null;
  const first = parts[0].unit;
  if (!parts.every((part) => sameDimension(part.unit, first))) return null;
  // Soma na unidade pequena (g, ml), em milésimos inteiros: 0,1 kg + 0,2 kg não vira 0,30000000000000004.
  const small = convertQuantity(1, first, 'g') != null ? 'g' : convertQuantity(1, first, 'ml') != null ? 'ml' : first;
  const thousandths = parts.reduce((sum, part) => sum + Math.round((convertQuantity(part.quantity, part.unit, small) ?? 0) * 1000), 0);
  const big = small === 'g' ? 'kg' : small === 'ml' ? 'l' : null;
  return big && thousandths >= 1_000_000 ? formatQuantity(thousandths / 1_000_000, big) : formatQuantity(thousandths / 1000, small);
}

function shareOf(part: number, whole: number): string {
  if (part <= 0 || whole <= 0) return '0%';
  const percent = Math.round((part * 100) / whole);
  return percent === 0 ? '<1%' : `${percent}%`;
}

/** A parte, para o leitor de tela; `of` diz de quê ("do mês", ou "dos itens" quando o total pago não é a soma deles). */
const spokenShare = (share: string, of: string) => `${share === '<1%' ? 'menos de 1%' : share} ${of}`;

interface ReceiptMoney<L> {
  /** Os itens de mercado (sem os de farmácia), com a categoria e o valor impresso. */
  market: { line: L; category: string; value: number }[];
  /** A soma dos itens de mercado, pelo valor impresso. */
  itemsCents: number;
  /** O que foi pago de farmácia: os itens dela mais a parte dela na diferença do total. */
  pharmacyCents: number;
  noValue: number;
  /** Nota só de farmácia não é ida ao mercado. */
  trip: boolean;
  /** Total da nota menos a soma de todos os itens dela, o que a tela da nota compara; zero sem total. */
  diffCents: number;
  /** A parte do mercado nessa diferença. */
  marketDiffCents: number;
  /** O que foi pago de mercado nesta nota: nunca negativo. */
  paidCents: number;
}

/**
 * O dinheiro de uma nota. A diferença entre o total e a soma dos itens é
 * repartida entre o mercado e a farmácia na proporção do que está impresso de
 * cada lado, como o resumo de gastos faz com o total (buildEntries): o
 * desconto do remédio não sai do mercado. O centavo que sobra da divisão fica
 * com a farmácia, e as duas partes somam a diferença. Os itens não mudam: só
 * a diferença é repartida.
 */
function receiptMoney<L extends MarketTotalLine>(receipt: { total: number | null; lines: L[] }): ReceiptMoney<L> {
  const market: ReceiptMoney<L>['market'] = [];
  let printedPharmacy = 0;
  let noValue = 0;
  for (const line of receipt.lines) {
    // Item sem valor conta zero e é contado à parte: nunca um palpite.
    const value = Math.max(0, cents(line.totalPrice));
    if (value === 0) noValue += 1;
    const category = lineCategory(line);
    if (isPharmacy(category)) printedPharmacy += value;
    else market.push({ line, category, value });
  }
  const itemsCents = market.reduce((sum, { value }) => sum + value, 0);
  const printed = itemsCents + printedPharmacy;
  // Sem total (nota digitada à mão), o total é a soma dos itens: não há diferença.
  const charged = receipt.total != null && receipt.total > 0 ? cents(receipt.total) : null;
  const diffCents = charged == null ? 0 : charged - printed;
  // Nota só de farmácia não é ida ao mercado: a diferença do total dela é toda da farmácia.
  const trip = receipt.lines.length === 0 || market.length > 0;
  // Sem nenhum valor impresso não há proporção: a diferença fica toda no mercado, como "sem item lido".
  const marketDiffCents = !trip ? 0 : printed > 0 ? Math.round((diffCents * itemsCents) / printed) : diffCents;
  return {
    market,
    itemsCents,
    pharmacyCents: printedPharmacy + diffCents - marketDiffCents,
    noValue,
    trip,
    diffCents,
    marketDiffCents,
    paidCents: itemsCents + marketDiffCents,
  };
}

/** O que foi pago de mercado, e em quantas idas, nas notas confirmadas com a data da compra em [start, end). */
function paidBetween(receipts: MarketTotalReceipt[], start: string, end: string): { totalCents: number; trips: number } {
  let totalCents = 0;
  let trips = 0;
  for (const receipt of receipts) {
    if (receipt.status !== 'confirmed') continue;
    const date = purchasedOn(receipt);
    if (date < start || date >= end) continue;
    const paid = receiptMoney(receipt);
    if (!paid.trip) continue;
    totalCents += paid.paidCents;
    trips += 1;
  }
  return { totalCents, trips };
}

/**
 * O total do mercado de um mês e o número de idas. É a conta do cabeçalho da
 * tela (marketMonth usa esta função) e da entrada no resumo de gastos, que a
 * faz com as notas que o resumo já leu: os dois números não têm como diferir.
 */
export function marketTotal(receipts: MarketTotalReceipt[], month: string): MarketTotal {
  const range = monthRange(month);
  const { totalCents, trips } = paidBetween(receipts, range.start, range.end);
  return {
    totalCents,
    trips,
    headline: `${money(totalCents)} em ${plural(trips, 'ida', 'idas')}`,
    emptyTitle: `Nenhuma nota de mercado em ${monthName(month)}`,
  };
}

interface ItemFigures {
  key: string;
  productId: string | null;
  name: string;
  category: string;
  cents: number;
  purchases: { quantity: number; unit: string }[];
  receiptIds: Set<string>;
}

interface TripFigures {
  receipt: MarketReceipt;
  date: string;
  /** Quantos itens de mercado a nota tem. */
  lines: number;
  money: ReceiptMoney<MarketLine>;
}

interface Figures {
  trips: TripFigures[];
  itemsCents: number;
  categories: Map<string, number>;
  items: Map<string, ItemFigures>;
  pharmacyCents: number;
  noValue: { receipt: MarketReceipt; date: string; count: number }[];
  drafts: { receipt: MarketReceipt; date: string }[];
}

/** As notas com a data da compra em [start, end), somadas. */
function figures(receipts: MarketReceipt[], start: string, end: string): Figures {
  const result: Figures = { trips: [], itemsCents: 0, categories: new Map(), items: new Map(), pharmacyCents: 0, noValue: [], drafts: [] };
  const inRange = receipts
    .map((receipt) => ({ receipt, date: purchasedOn(receipt) }))
    .filter(({ date }) => date >= start && date < end)
    // Da mais recente para a mais antiga; o id desempata: a ordem não depende de como a busca devolveu.
    .sort((a, b) => Date.parse(b.receipt.purchasedAt) - Date.parse(a.receipt.purchasedAt) || a.receipt.id.localeCompare(b.receipt.id));

  for (const { receipt, date } of inRange) {
    if (receipt.status !== 'confirmed') {
      result.drafts.push({ receipt, date });
      continue;
    }
    const paid = receiptMoney(receipt);
    if (paid.noValue) result.noValue.push({ receipt, date, count: paid.noValue });
    result.pharmacyCents += paid.pharmacyCents;
    if (!paid.trip) continue;

    result.trips.push({ receipt, date, lines: paid.market.length, money: paid });
    result.itemsCents += paid.itemsCents;

    for (const { line, category, value } of paid.market) {
      result.categories.set(category, (result.categories.get(category) ?? 0) + value);
      const key = itemKey(line, category);
      // O nome é o da compra mais recente (as notas vêm da mais nova para a mais antiga).
      const item = result.items.get(key) ?? { key, productId: line.productId, name: lineName(line), category, cents: 0, purchases: [], receiptIds: new Set() };
      item.cents += value;
      item.purchases.push({ quantity: Number(line.quantity) || 0, unit: line.unit });
      item.receiptIds.add(receipt.id);
      result.items.set(key, item);
    }
  }
  return result;
}

/** O mês anterior para comparar: inteiro, ou só até o dia `uptoDay`. */
interface PreviousWindow {
  month: string;
  start: string;
  end: string;
  uptoDay: number | null;
}

/**
 * No mês corrente o anterior só conta até o mesmo dia (a regra do resumo,
 * previousMonth em finance.ts): mês pela metade contra mês cheio sempre
 * parece economia.
 */
function previousWindow(month: string, today: string): PreviousWindow {
  const previous = shiftMonth(month, -1);
  const range = monthRange(previous);
  const whole = { month: previous, ...range, uptoDay: null };
  if (today.slice(0, 7) !== month) return whole;
  const day = Number(today.slice(8, 10));
  const cut = addDays(range.start, day);
  return cut >= range.end ? whole : { month: previous, start: range.start, end: cut, uptoDay: day };
}

const when = (previous: PreviousWindow) =>
  previous.uptoDay ? `até o dia ${previous.uptoDay} de ${monthName(previous.month)}` : `em ${monthName(previous.month)}`;

/** A diferença de uma categoria para o mês anterior, para o meio de uma frase (a linha da tela começa com maiúscula). */
function versusPrevious(current: number, previousCents: number, previous: PreviousWindow): string {
  if (previousCents <= 0) return `não teve ${when(previous)}`;
  const diff = current - previousCents;
  if (diff === 0) return previous.uptoDay ? `igual ao gasto ${when(previous)}` : `igual a ${monthName(previous.month)}`;
  return `${money(Math.abs(diff))} a ${diff > 0 ? 'mais' : 'menos'} que ${when(previous)}`;
}

const storeNameOf = (receipt: MarketReceipt) => receipt.storeName?.trim() || (receipt.storeId ? 'Mercado' : NO_STORE_LABEL);

const byAmountThenName = <T extends { cents: number; name: string; key: string }>(a: T, b: T) =>
  b.cents - a.cents || a.name.localeCompare(b.name, 'pt-BR') || a.key.localeCompare(b.key);

/**
 * Tudo o que a tela "Mercado do mês" mostra, a partir das notas do mês e do
 * mês anterior (com mercado e itens). `today` diz se o mês é o corrente.
 */
export function marketMonth(receipts: MarketReceipt[], month: string, today: string): MarketMonth {
  const range = monthRange(month);
  // O total e as idas do cabeçalho: a mesma conta da entrada no resumo de gastos.
  const total = marketTotal(receipts, month);
  const current = figures(receipts, range.start, range.end);
  const previous = previousWindow(month, today);
  // As comparações (total e categorias) usam a janela do mês anterior; o valor de cada item é o do mês anterior inteiro.
  const compared = figures(receipts, previous.start, previous.end);
  const comparedTotal = paidBetween(receipts, previous.start, previous.end);
  const previousWhole = previous.uptoDay ? figures(receipts, previous.start, monthRange(previous.month).end) : compared;
  const year = Number(today.slice(0, 4));
  const name = monthName(month);
  const shortDate = (date: string) => formatShortDate(date, year);
  // Com desconto no total ou valor sem item lido, o total pago não é a soma dos itens: a parte diz de quê é.
  const sharesOfItems = total.totalCents !== current.itemsCents;
  const shareOfWhat = sharesOfItems ? 'dos itens' : 'do mês';
  // Mês anterior sem nota de mercado: o cabeçalho diz isso uma vez, e as categorias não repetem.
  const hadPrevious = comparedTotal.trips > 0;

  const categories = [...current.categories]
    .map(([key, amount]) => ({ key, name: getCategory(key).label, cents: amount }))
    .sort(byAmountThenName)
    .map(({ key, name: label, cents: amount }): MarketCategory => {
      const share = shareOf(amount, current.itemsCents);
      const versus = hadPrevious ? versusPrevious(amount, compared.categories.get(key) ?? 0, previous) : '';
      return {
        key,
        label,
        cents: amount,
        amount: money(amount),
        share,
        versusPrevious: capitalize(versus),
        accessibilityLabel: [`${label}: ${money(amount)}`, spokenShare(share, shareOfWhat), versus].filter(Boolean).join(', '),
      };
    });

  const items = [...current.items.values()].sort(byAmountThenName).map((item): MarketItem => {
    const amount = item.cents > 0 ? money(item.cents) : 'sem valor';
    const share = shareOf(item.cents, current.itemsCents);
    const before = previousWhole.items.get(item.key)?.cents ?? 0;
    const detail = [
      // Unidades que não se somam (un e kg): em vez da quantidade, quantas vezes foi comprado.
      totalQuantity(item.purchases) ?? plural(item.purchases.length, 'compra', 'compras'),
      `em ${plural(item.receiptIds.size, 'ida', 'idas')}`,
      before > 0 ? `${monthName(previous.month)}: ${money(before)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      key: item.key,
      productId: item.productId,
      name: item.name,
      category: item.category,
      cents: item.cents,
      amount,
      share,
      detail,
      accessibilityLabel: `${item.name}: ${amount}, ${spokenShare(share, shareOfWhat)}, ${detail.replace(/ · /g, ', ')}`,
    };
  });

  const trips = current.trips.map((trip): MarketTrip => {
    const storeName = storeNameOf(trip.receipt);
    const detail = [
      shortDate(trip.date),
      plural(trip.lines, 'item', 'itens'),
      trip.money.pharmacyCents > 0 ? `farmácia fora: ${money(trip.money.pharmacyCents)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      receiptId: trip.receipt.id,
      storeName,
      cents: trip.money.paidCents,
      amount: money(trip.money.paidCents),
      detail,
      accessibilityLabel: `${storeName}: ${money(trip.money.paidCents)}, ${detail.replace(/ · /g, ', ')}`,
    };
  });

  // Por mercado: pelo id, não pelo nome (dois mercados podem ter o mesmo nome).
  const byStore = new Map<string, { key: string; name: string; cents: number; trips: number }>();
  for (const trip of current.trips) {
    const key = trip.receipt.storeId ?? '';
    const store = byStore.get(key) ?? { key, name: storeNameOf(trip.receipt), cents: 0, trips: 0 };
    store.cents += trip.money.paidCents;
    store.trips += 1;
    byStore.set(key, store);
  }
  const stores = [...byStore.values()].sort(byAmountThenName).map((store): MarketStore => {
    const detail = plural(store.trips, 'ida', 'idas');
    return {
      key: store.key,
      name: store.name,
      cents: store.cents,
      amount: money(store.cents),
      detail,
      accessibilityLabel: `${store.name}: ${money(store.cents)} em ${detail}`,
    };
  });

  const ref = (receipt: MarketReceipt, date: string, value: string): MarketReceiptRef => {
    const storeName = storeNameOf(receipt);
    return { receiptId: receipt.id, storeName, date: shortDate(date), value, accessibilityLabel: `${storeName}, ${shortDate(date)}: ${value}. Abrir a nota` };
  };
  // As duas linhas usam a parte do mercado na diferença de cada nota, sem uma abater a outra.
  const discountCents = current.trips.reduce((sum, trip) => sum + Math.max(0, -trip.money.marketDiffCents), 0);
  const unreadCents = current.trips.reduce((sum, trip) => sum + Math.max(0, trip.money.marketDiffCents), 0);
  // Para conferir, só as notas em que a tela da nota também avisa que a soma não bate.
  const unreadTrips = current.trips.filter((trip) => trip.money.marketDiffCents > 0 && trip.money.diffCents > RECEIPT_CHECK_CENTS);
  const noValueCount = current.noValue.reduce((sum, entry) => sum + entry.count, 0);
  const draftCount = current.drafts.length;

  let comparison: string | null = null;
  if (total.trips > 0) {
    comparison = hadPrevious
      ? describeMonthDelta(total.totalCents / 100, { month: previous.month, amount: comparedTotal.totalCents / 100, uptoDay: previous.uptoDay })
      : `Não teve nota de mercado ${when(previous)}`;
  }

  const inside = [
    unreadCents > 0 ? `${money(unreadCents)} de notas sem item lido` : null,
    discountCents > 0 ? `${money(discountCents)} de descontos` : null,
  ].filter((part): part is string => part !== null);
  const outside = [
    current.pharmacyCents > 0 ? `${money(current.pharmacyCents)} de farmácia` : null,
    noValueCount > 0 ? plural(noValueCount, 'item sem valor', 'itens sem valor') : null,
    draftCount > 0 ? plural(draftCount, 'nota que espera a revisão', 'notas que esperam a revisão') : null,
  ].filter((part): part is string => part !== null);
  const closing = [inside.length ? `Inclui ${joinNames(inside)}.` : null, outside.length ? `Sem contar ${joinNames(outside)}.` : null]
    .filter(Boolean)
    .join(' ');

  return {
    month,
    title: today.slice(0, 7) === month ? `Mercado de ${name} até hoje` : `Mercado de ${name}`,
    totalCents: total.totalCents,
    itemsCents: current.itemsCents,
    headline: total.headline,
    comparison,
    trips,
    categories,
    items,
    stores,
    // Sem nenhum valor lido não há porcentagem para explicar.
    shareBasis: sharesOfItems && current.itemsCents > 0 ? `As porcentagens são sobre os itens lidos (${money(current.itemsCents)}).` : null,
    closing: closing || null,
    discount:
      discountCents > 0
        ? {
            label: 'Descontos no total das notas',
            // Sinal de menos de verdade (−), não hífen.
            value: `−${money(discountCents)}`,
            accessibilityLabel: `Descontos no total das notas: menos ${money(discountCents)}`,
          }
        : null,
    unread:
      unreadCents > 0
        ? {
            label: 'Nas notas, sem item lido',
            value: money(unreadCents),
            accessibilityLabel: `Nas notas, sem item lido: ${money(unreadCents)}`,
            receipts: unreadTrips.map((trip) => ref(trip.receipt, trip.date, money(trip.money.marketDiffCents))),
          }
        : null,
    noValue:
      noValueCount > 0
        ? {
            label: plural(noValueCount, 'item sem valor', 'itens sem valor'),
            // Nota confirmada não se edita: a frase diz o que dá para fazer, que é abrir e ver. Num mês sem ida
            // ao mercado (só farmácia) não há "este total" na tela para o item entrar como zero.
            hint: !current.trips.length
              ? noValueCount === 1
                ? 'Veio sem valor na nota. Abra a nota para ver qual é.'
                : 'Vieram sem valor na nota. Abra a nota para ver quais são.'
              : noValueCount === 1
                ? 'Entra como zero neste total. Abra a nota para ver qual é.'
                : 'Entram como zero neste total. Abra a nota para ver quais são.',
            receipts: current.noValue.map((entry) => ref(entry.receipt, entry.date, plural(entry.count, 'item', 'itens'))),
          }
        : null,
    pharmacy: current.pharmacyCents > 0 ? `Farmácia, fora desta conta: ${money(current.pharmacyCents)}` : null,
    pharmacyCents: current.pharmacyCents,
    drafts:
      draftCount === 0
        ? null
        : {
            label:
              draftCount === 1
                ? `1 nota de ${name} ainda espera a revisão. Ela entra nesta conta quando for confirmada.`
                : `${draftCount} notas de ${name} ainda esperam a revisão. Elas entram nesta conta quando forem confirmadas.`,
            // Cada rascunho abre a própria nota, que é onde ele é confirmado.
            receipts: current.drafts.slice(0, DRAFTS_SHOWN).map(({ receipt, date }) => {
              const storeName = storeNameOf(receipt);
              return {
                receiptId: receipt.id,
                storeName,
                date: shortDate(date),
                value: 'Revisar',
                accessibilityLabel: `${storeName}, ${shortDate(date)}. Abrir a nota para revisar`,
              };
            }),
            more: draftCount > DRAFTS_SHOWN ? `e mais ${draftCount - DRAFTS_SHOWN} em Finanças > Notas` : null,
          },
    emptyTitle: total.emptyTitle,
  };
}

/** O mês pedido na URL ("AAAA-MM"), se existe e não passa do corrente; senão, o corrente. */
export function monthFromParam(value: string | string[] | undefined, current: string): string {
  const month = Array.isArray(value) ? value[0] : value;
  return month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month <= current ? month : current;
}

/** A parte da tela pedida na URL; sem ela, ou com um valor que não existe, os itens. */
export function viewFromParam(value: string | string[] | undefined): MarketView {
  const wanted = Array.isArray(value) ? value[0] : value;
  return MARKET_VIEWS.find((view) => view.value === wanted)?.value ?? 'itens';
}
