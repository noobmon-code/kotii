// Mercado do mês: para onde foi o dinheiro do mercado. Soma os itens das
// notas confirmadas de um mês por categoria de produto, por item, por ida e
// por mercado. Vale sempre o valor impresso em cada item: quando o total da
// nota não bate com a soma dos itens, a diferença aparece à parte (desconto
// no total, ou valor sem item lido) e nunca é espalhada pelos itens, como faz
// o resumo de gastos (buildEntries em finance.ts, que não muda por causa
// daqui). Limpeza, higiene e pet são mercado; remédio fica de fora da conta e
// aparece numa linha só. Os gastos avulsos e as contas pagas que a pessoa
// lança como Mercado (a feira, o sacolão) também entram no total, nas idas e
// na tendência, como idas sem itens: não têm item para o ranking nem
// categoria de produto.

import { joinNames } from './cartPantry';
import { getCategory } from './categories';
import { addDays, formatShortDate, toISODate } from './dates';
import { describeMonthDelta, financeCategoryOfProduct, monthLabel, monthRange, monthShortLabel, shiftMonth, type Entry } from './finance';
import { listNameKey } from './listLinks';
import { marketChange, type ChangePurchase, type MarketChange } from './marketChange';
import { formatBRL, formatQuantity } from './money';
import { hasReceiptTotal, TOTAL_TOLERANCE_CENTS } from './receiptGap';
import { formatCnpj } from './storeName';
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
  /** O endereço e o CNPJ do mercado: separam dois mercados de mesmo nome. */
  storeAddress?: string | null;
  storeCnpj?: string | null;
  lines: MarketLine[];
}

/**
 * Um gasto de mercado lançado sem nota: um gasto avulso ou o pagamento de uma conta, da categoria "Mercado" do
 * Resumo. Não tem itens: conta no total, nas idas e na tendência, nunca nos itens nem nas categorias de produto.
 */
export interface MarketSpend {
  /** Único: o id do lançamento no Resumo ("gasto-…", "conta-…"). */
  key: string;
  source: 'gasto' | 'conta';
  /** O que o toque abre: o gasto, ou a conta (o pagamento é visto na tela da conta). */
  refId: string;
  /** O dia do gasto ou do pagamento ("AAAA-MM-DD"): não tem hora nem fuso. */
  date: string;
  /** Em reais. */
  amount: number;
  /** O nome que a pessoa deu ao gasto, ou o nome da conta. */
  name: string;
}

/** As notas e os gastos sem nota que a tela do mês usa, lidos juntos. */
export interface MarketData {
  receipts: MarketReceipt[];
  spends: MarketSpend[];
}

/**
 * Os gastos sem nota da categoria "Mercado", tirados dos lançamentos do Resumo (buildEntries): a mesma regra de
 * categoria, de data e do que é pago. Conta só entra pelo pagamento (a que ainda vai vencer não é gasto), e a nota
 * fiscal fica de fora: ela já entra pelos itens. Uma nota confirmada nunca vira gasto avulso, então nada é
 * contado duas vezes.
 */
export function marketSpendsOf(entries: Entry[]): MarketSpend[] {
  return entries
    .filter((entry): entry is Entry & { source: 'gasto' | 'conta' } => entry.source !== 'nota' && entry.category === 'mercado')
    .map((entry) => ({
      key: entry.id,
      source: entry.source,
      refId: entry.refId,
      date: entry.date,
      amount: entry.amount,
      name: entry.description.trim() || (entry.source === 'gasto' ? 'Gasto avulso' : 'Conta'),
    }));
}

/** O que o toque numa ida, ou numa linha para conferir, abre. */
export interface MarketOpen {
  kind: 'nota' | 'gasto' | 'conta';
  id: string;
}

const OPEN_LABELS: Record<MarketOpen['kind'], string> = { nota: 'Abrir a nota', gasto: 'Abrir o gasto', conta: 'Abrir a conta' };

/** O que o leitor de tela diz que o toque faz: "Abrir a nota", "Abrir o gasto", "Abrir a conta". */
export const openLabel = (open: MarketOpen) => OPEN_LABELS[open.kind];

/** O total do mês, como aparece no cabeçalho da tela e na entrada do resumo de gastos. */
export interface MarketTotal {
  /** O que foi pago: itens mais a parte do mercado nas diferenças das notas, sem a farmácia, mais os gastos sem nota. */
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
   * "Não teve em setembro". Vazia quando o mês anterior não teve nota de mercado nenhuma: sem itens, não há com o
   * que comparar (sem compra nenhuma, o cabeçalho diz; só com gasto sem nota, o total compara e as categorias não).
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
  /** Em quantas idas do mês o item foi comprado. */
  trips: number;
  /**
   * Quanto foi comprado, para ordenar: a medida ('un', 'peso', 'volume', ou a unidade como veio) e a soma em
   * milésimos da unidade pequena (g, ml, un). null quando as compras vieram em medidas que não se somam.
   */
  quantity: { measure: string; amount: number } | null;
}

export interface MarketTrip {
  /** Único na lista: o id da nota, ou o do gasto sem nota. */
  key: string;
  /** O que o toque abre: a nota, o gasto ou a conta. */
  opens: MarketOpen;
  /** O mercado da nota, ou o nome do gasto sem nota. */
  storeName: string;
  cents: number;
  amount: string;
  /** "12 out · 18 itens"; sem nota, "12 out · gasto avulso · sem itens". */
  detail: string;
  accessibilityLabel: string;
}

export interface MarketStore {
  /** O id do mercado; '' para as notas sem mercado; "avulso:…" para os gastos sem nota de mesmo nome. */
  key: string;
  /** Os gastos lançados sem nota com este nome ("Feira"): não têm itens. */
  noReceipt: boolean;
  name: string;
  /**
   * Só quando outro mercado do mês tem o mesmo nome: o endereço, o CNPJ ou, sem nenhum dos dois, "loja 2".
   * null quando o nome basta.
   */
  place: string | null;
  cents: number;
  amount: string;
  /** "3 idas", "Av. Brasil, 100 · 3 idas" com dois mercados de mesmo nome, ou "2 idas · sem nota". */
  detail: string;
  accessibilityLabel: string;
}

/** Um mercado tocado na lista: as idas e os itens dele no mês. */
export interface MarketStoreMonth {
  key: string;
  /** "Assaí", ou "Assaí (Av. Brasil, 100)" com dois mercados de mesmo nome. */
  title: string;
  /** "R$ 61,00 em 2 idas" */
  headline: string;
  /** Da mais recente para a mais antiga. */
  trips: MarketTrip[];
  /** Do que levou mais dinheiro para o que levou menos; a parte é sobre os itens deste mercado. */
  items: MarketItem[];
  /** O que a parte dos itens diz quando não há nenhum. */
  emptyItems: string;
}

/** Uma nota (ou um gasto sem nota) para a pessoa abrir e conferir. */
export interface MarketReceiptRef {
  /** Único na lista: o id da nota, ou o do gasto sem nota. */
  key: string;
  /** O que o toque abre: a nota, o gasto ou a conta. */
  opens: MarketOpen;
  storeName: string;
  /** "12 out" */
  date: string;
  /** O que há para conferir nela: "R$ 20,00", "2 itens"; no rascunho, "Revisar". */
  value: string;
  accessibilityLabel: string;
}

/** Quantos itens o ranking mostra antes de "Ver todos". */
export const MARKET_ITEMS_SHOWN = 10;

export interface MarketMonth {
  month: string;
  /** "Mercado de outubro até hoje" */
  title: string;
  /** O que foi pago: itens mais as diferenças das notas, sem a farmácia, mais os gastos sem nota. */
  totalCents: number;
  /** A soma dos itens, pelo valor impresso: é sobre ela que as partes (%) são contadas. */
  itemsCents: number;
  /** "R$ 1.240,00 em 6 idas" */
  headline: string;
  /** Comparação com o mês anterior; null sem idas no mês. */
  comparison: string | null;
  /** Da mais recente para a mais antiga, com os gastos sem nota no meio, pela data. */
  trips: MarketTrip[];
  /** Da maior para a menor. */
  categories: MarketCategory[];
  /** Do que levou mais dinheiro para o que levou menos. */
  items: MarketItem[];
  /** O que os itens e as categorias dizem quando não há item nenhum: as notas vieram sem item lido, ou só há gasto sem nota. */
  emptyItems: string;
  /**
   * Com mais itens do que a lista mostra de início: quantos ela mostra e o que os dois botões dizem
   * ("Ver todos os 25 itens" / "Mostrar só os 10 primeiros"). null quando cabem todos.
   */
  itemsCut: { shown: number; more: string; less: string } | null;
  stores: MarketStore[];
  /** "As porcentagens são sobre os itens lidos (R$ 1.200,00)."; null quando o total pago é a soma dos itens. */
  shareBasis: string | null;
  /**
   * O que há no total além dos itens lidos e o que ficou de fora dele, em poucas palavras: "Inclui R$ 20,00
   * de notas sem item lido e R$ 10,00 de descontos."; null quando não há nada disso no mês.
   */
  closing: string | null;
  /** Os gastos avulsos e as contas lançados como Mercado: estão no total e não têm itens. */
  withoutReceipt: { label: string; value: string; accessibilityLabel: string } | null;
  /** Notas com total abaixo da soma dos itens. */
  discount: { label: string; value: string; accessibilityLabel: string } | null;
  /**
   * Notas com total acima da soma dos itens: a leitura perdeu um item ou um valor. `receipts` só traz as
   * notas com diferença acima de RECEIPT_CHECK_CENTS, e pode vir vazia.
   */
  unread: { label: string; value: string; accessibilityLabel: string; receipts: MarketReceiptRef[] } | null;
  /** Itens sem valor (contam zero), com as notas em que estão. */
  noValue: { label: string; hint: string; receipts: MarketReceiptRef[] } | null;
  /**
   * No mês corrente: as notas confirmadas com data depois de hoje (de mercado ou só de farmácia) e os gastos sem
   * nota com data depois de hoje, fora da conta "até hoje".
   */
  later: { label: string; hint: string; receipts: MarketReceiptRef[] } | null;
  /** "Farmácia, fora desta conta: R$ 42,00": o que foi pago nos itens de farmácia. */
  pharmacy: string | null;
  pharmacyCents: number;
  /** Rascunhos do mês, que ainda não contam: a frase, os mais recentes para abrir e "e mais 2 em Finanças > Notas". */
  drafts: { label: string; receipts: MarketReceiptRef[]; more: string | null } | null;
  /**
   * "O que mudou": por que os itens custaram mais ou menos que na janela do mês anterior (a do cabeçalho), em
   * domain/marketChange. null sem nota de mercado no mês ou na janela: os gastos sem nota não têm itens.
   */
  change: MarketChange | null;
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
 * a nota não é listada para conferir. É a folga do aviso de diferença na tela
 * da nota ("Faltam R$ …", em domain/receiptGap), a mesma constante: abaixo
 * dela a pessoa abriria a nota e não veria nada de errado. Os valores
 * continuam exatos; só a lista de notas usa a folga.
 */
export const RECEIPT_CHECK_CENTS = TOTAL_TOLERANCE_CENTS;

/**
 * O total da nota e a soma dos itens diferem mais do que a folga? Em centavos inteiros: em reais, 10,05 menos
 * 10,00 dá um fio acima de 0,05, e a tela da nota avisaria de uma diferença que a do mês não manda conferir.
 * Sem total (nota digitada à mão, ou total zerado: `hasReceiptTotal`), não há o que comparar.
 */
export function receiptTotalMismatch(total: number | null, itemsTotal: number): boolean {
  return hasReceiptTotal(total) && Math.abs(Math.round(total * 100) - Math.round(itemsTotal * 100)) > RECEIPT_CHECK_CENTS;
}

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
  const sum = sumQuantity(parts);
  if (!sum) return null;
  const { small, thousandths } = sum;
  const big = small === 'g' ? 'kg' : small === 'ml' ? 'l' : null;
  return big && thousandths >= 1_000_000 ? formatQuantity(thousandths / 1_000_000, big) : formatQuantity(thousandths / 1000, small);
}

/** A soma na unidade pequena (g, ml, ou a própria unidade), em milésimos inteiros; null quando não se somam. */
function sumQuantity(parts: { quantity: number; unit: string }[]): { small: string; thousandths: number } | null {
  if (!parts.length) return null;
  const first = parts[0].unit;
  if (!parts.every((part) => sameDimension(part.unit, first))) return null;
  // Em milésimos inteiros: 0,1 kg + 0,2 kg não vira 0,30000000000000004.
  const small = convertQuantity(1, first, 'g') != null ? 'g' : convertQuantity(1, first, 'ml') != null ? 'ml' : first;
  const thousandths = parts.reduce((sum, part) => sum + Math.round((convertQuantity(part.quantity, part.unit, small) ?? 0) * 1000), 0);
  return { small, thousandths };
}

/** Quanto foi comprado, para ordenar: peso com peso, volume com volume, unidade com unidade. */
function quantityOf(parts: { quantity: number; unit: string }[]): MarketItem['quantity'] {
  const sum = sumQuantity(parts);
  if (!sum) return null;
  return { measure: sum.small === 'g' ? 'peso' : sum.small === 'ml' ? 'volume' : sum.small, amount: sum.thousandths };
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

interface SpendFigures {
  spend: MarketSpend;
  cents: number;
}

/**
 * Os gastos sem nota com a data em [start, end), do mais recente para o mais antigo (a chave desempata). O dia é
 * o que a pessoa lançou, sem fuso, como no Resumo. Pagamento de zero não é ida ao mercado.
 */
function spendsBetween(spends: MarketSpend[], start: string, end: string): SpendFigures[] {
  return spends
    .filter((spend) => spend.date >= start && spend.date < end)
    .map((spend) => ({ spend, cents: Math.max(0, cents(spend.amount)) }))
    .filter(({ cents: value }) => value > 0)
    .sort((a, b) => b.spend.date.localeCompare(a.spend.date) || a.spend.key.localeCompare(b.spend.key));
}

const centsOf = (spends: SpendFigures[]) => spends.reduce((sum, { cents: value }) => sum + value, 0);

/**
 * O que foi pago de mercado, e em quantas idas, nas notas confirmadas com a data da compra em [start, end) e nos
 * gastos sem nota com a data no mesmo trecho.
 */
function paidBetween(receipts: MarketTotalReceipt[], spends: MarketSpend[], start: string, end: string): { totalCents: number; trips: number } {
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
  const loose = spendsBetween(spends, start, end);
  return { totalCents: totalCents + centsOf(loose), trips: trips + loose.length };
}

/**
 * O fim (o dia seguinte ao último) do que conta num mês. No mês corrente a conta vai até hoje: é o que o
 * título diz ("até hoje") e é com o mesmo trecho do mês anterior que ela é comparada. A nota com data depois
 * de hoje (a data foi digitada errada, ou a compra ainda vai acontecer) fica de fora até o dia chegar.
 */
function periodEnd(month: string, today?: string): string {
  const range = monthRange(month);
  if (!today || today.slice(0, 7) !== month) return range.end;
  const tomorrow = addDays(today, 1);
  return tomorrow < range.end ? tomorrow : range.end;
}

/**
 * O total do mercado de um mês e o número de idas, com os gastos sem nota (`spends`). É a conta do cabeçalho da
 * tela (marketMonth usa esta função) e da entrada no resumo de gastos, que a faz com as notas e os lançamentos
 * que o resumo já leu: é a mesma conta, então a entrada bate com a tela enquanto a leitura do resumo vier
 * inteira (ela é uma busca só, sem páginas; a da tela lê em páginas e falha em vez de cortar). `today` diz se o
 * mês é o corrente (aí a conta vai até hoje); sem ele, o mês inteiro.
 */
export function marketTotal(receipts: MarketTotalReceipt[], month: string, today?: string, spends: MarketSpend[] = []): MarketTotal {
  const range = monthRange(month);
  const { totalCents, trips } = paidBetween(receipts, spends, range.start, periodEnd(month, today));
  return {
    totalCents,
    trips,
    headline: `${money(totalCents)} em ${plural(trips, 'ida', 'idas')}`,
    emptyTitle: `Nenhuma compra de mercado em ${monthName(month)}`,
  };
}

interface ItemFigures {
  key: string;
  productId: string | null;
  name: string;
  category: string;
  cents: number;
  /** Cada compra do item, com o valor impresso (zero sem valor): "O que mudou" precisa saber qual veio sem. */
  purchases: ChangePurchase[];
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
      item.purchases.push({ quantity: Number(line.quantity) || 0, unit: line.unit, value });
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

/** O mercado da nota, como a lista de mercados junta: pelo id; '' para as notas sem mercado. */
const storeKeyOf = (receipt: MarketReceipt) => receipt.storeId ?? '';

type StorePlaceInput = { key: string; name: string; address: string; cnpj: string };

/**
 * O que separa um mercado de outro do mesmo nome no mês (duas unidades do Assaí): o endereço; sem ele, o CNPJ;
 * sem nenhum dos dois, "sem endereço" ou, com mais de um assim, "loja 1", "loja 2". Só esses entram na conta
 * dos números (o que já mostra o endereço não leva número, então nunca há "loja 2" sem "loja 1"), e na ordem
 * do id do mercado, não do valor: a mesma unidade não troca de número de um mês para o outro só porque gastou
 * mais. null quando nenhum outro mercado tem o nome.
 */
function storePlace(store: StorePlaceInput, all: StorePlaceInput[]): string | null {
  const same = all.filter((other) => other.name.toLocaleLowerCase('pt-BR') === store.name.toLocaleLowerCase('pt-BR'));
  if (same.length < 2) return null;
  if (store.address) return store.address;
  if (store.cnpj) return `CNPJ ${formatCnpj(store.cnpj)}`;
  const bare = same
    .filter((other) => !other.address && !other.cnpj)
    .map((other) => other.key)
    .sort((a, b) => a.localeCompare(b));
  return bare.length < 2 ? 'sem endereço' : `loja ${bare.indexOf(store.key) + 1}`;
}

/**
 * As linhas dos itens, do que levou mais dinheiro para o que levou menos. `shareOfWhat` diz de quê é a parte
 * para o leitor de tela; `previous`, quando vem, põe o valor de cada item no mês anterior.
 */
function itemRows(current: Figures, shareOfWhat: string, previous: { month: string; items: Map<string, ItemFigures> } | null): MarketItem[] {
  return [...current.items.values()].sort(byAmountThenName).map((item): MarketItem => {
    const amount = item.cents > 0 ? money(item.cents) : 'sem valor';
    const share = shareOf(item.cents, current.itemsCents);
    const before = previous?.items.get(item.key)?.cents ?? 0;
    const detail = [
      // Unidades que não se somam (un e kg): em vez da quantidade, quantas vezes foi comprado.
      totalQuantity(item.purchases) ?? plural(item.purchases.length, 'compra', 'compras'),
      `em ${plural(item.receiptIds.size, 'ida', 'idas')}`,
      previous && before > 0 ? `${monthName(previous.month)}: ${money(before)}` : null,
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
      trips: item.receiptIds.size,
      quantity: quantityOf(item.purchases),
    };
  });
}

/** O que a linha da ida sem nota diz dela: o que é, como no Resumo. */
const SPEND_KINDS: Record<MarketSpend['source'], string> = { gasto: 'gasto avulso', conta: 'conta paga' };

/**
 * Pela data, da mais recente para a mais antiga. As duas listas já vêm nessa ordem e a ordenação é estável: cada
 * uma fica na ordem dela, e no mesmo dia a nota (que tem hora) vem antes do gasto sem nota (que não tem).
 */
const byDate = <T extends { date: string }>(receipts: T[], spends: T[]): T[] => [...receipts, ...spends].sort((a, b) => b.date.localeCompare(a.date));

/** As linhas das idas, da mais recente para a mais antiga: as notas e os gastos sem nota, pela data. */
function tripRows(trips: TripFigures[], spends: SpendFigures[], shortDate: (date: string) => string): MarketTrip[] {
  const fromReceipts = trips.map((trip) => {
    const storeName = storeNameOf(trip.receipt);
    const detail = [
      shortDate(trip.date),
      plural(trip.lines, 'item', 'itens'),
      trip.money.pharmacyCents > 0 ? `farmácia fora: ${money(trip.money.pharmacyCents)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const row: MarketTrip = {
      key: trip.receipt.id,
      opens: { kind: 'nota', id: trip.receipt.id },
      storeName,
      cents: trip.money.paidCents,
      amount: money(trip.money.paidCents),
      detail,
      accessibilityLabel: `${storeName}: ${money(trip.money.paidCents)}, ${detail.replace(/ · /g, ', ')}`,
    };
    return { date: trip.date, row };
  });
  const fromSpends = spends.map(({ spend, cents: value }) => {
    // Sem itens: a linha diz isso, e é por isso que o gasto não aparece nos itens nem nas categorias.
    const detail = [shortDate(spend.date), SPEND_KINDS[spend.source], 'sem itens'].join(' · ');
    const row: MarketTrip = {
      key: spend.key,
      opens: { kind: spend.source, id: spend.refId },
      storeName: spend.name,
      cents: value,
      amount: money(value),
      detail,
      accessibilityLabel: `${spend.name}: ${money(value)}, ${detail.replace(/ · /g, ', ')}`,
    };
    return { date: spend.date, row };
  });
  return byDate(fromReceipts, fromSpends).map(({ row }) => row);
}

/**
 * Os gastos sem nota de mesmo nome ("Feira" toda semana) ficam juntos na lista de mercados, pelo nome sem acento,
 * maiúscula nem pontuação, como os itens sem produto. O prefixo não se confunde com o id de um mercado.
 */
const spendStoreKey = (spend: MarketSpend) => `avulso:${listNameKey(spend.name) || spend.name.toLowerCase()}`;

/**
 * Tudo o que a tela "Mercado do mês" mostra, a partir das notas do mês e do mês anterior (com mercado e itens) e
 * dos gastos sem nota lançados como Mercado (`spends`). `today` diz se o mês é o corrente.
 */
export function marketMonth(receipts: MarketReceipt[], month: string, today: string, spends: MarketSpend[] = []): MarketMonth {
  const range = monthRange(month);
  // O total e as idas do cabeçalho: a mesma conta da entrada no resumo de gastos.
  const end = periodEnd(month, today);
  const total = marketTotal(receipts, month, today, spends);
  const current = figures(receipts, range.start, end);
  const currentSpends = spendsBetween(spends, range.start, end);
  const spendCents = centsOf(currentSpends);
  // No mês corrente, o que tem data depois de hoje: fica de fora da conta, e a tela diz.
  const later = end < range.end ? figures(receipts, end, range.end) : null;
  // Toda nota confirmada de data futura, seja ou não uma ida ao mercado: a que só tem itens de farmácia também
  // precisa aparecer, para a pessoa poder abrir e conferir a data. O valor é o que a nota custou inteira.
  const laterReceipts =
    end < range.end
      ? receipts
          .filter((receipt) => receipt.status === 'confirmed')
          .map((receipt) => ({ receipt, date: purchasedOn(receipt) }))
          .filter(({ date }) => date >= end && date < range.end)
          .sort((a, b) => Date.parse(b.receipt.purchasedAt) - Date.parse(a.receipt.purchasedAt) || a.receipt.id.localeCompare(b.receipt.id))
          .map(({ receipt, date }) => {
            const paid = receiptMoney(receipt);
            return { receipt, date, cents: paid.paidCents + paid.pharmacyCents };
          })
      : [];
  // O gasto sem nota com data depois de hoje também fica de fora até o dia chegar, e aparece junto, para conferir.
  const laterSpends = end < range.end ? spendsBetween(spends, end, range.end) : [];
  const laterCount = laterReceipts.length + laterSpends.length;
  // Os rascunhos esperam a revisão com a data que tiverem: os de data futura vêm junto (e primeiro, que são os mais novos).
  const drafts = later ? [...later.drafts, ...current.drafts] : current.drafts;
  const previous = previousWindow(month, today);
  // As comparações (total e categorias) usam a janela do mês anterior; o valor de cada item é o do mês anterior inteiro.
  const compared = figures(receipts, previous.start, previous.end);
  const comparedTotal = paidBetween(receipts, spends, previous.start, previous.end);
  const comparedSpendCents = centsOf(spendsBetween(spends, previous.start, previous.end));
  const previousWhole = previous.uptoDay ? figures(receipts, previous.start, monthRange(previous.month).end) : compared;
  const year = Number(today.slice(0, 4));
  const name = monthName(month);
  const shortDate = (date: string) => formatShortDate(date, year);
  // Com desconto no total, valor sem item lido ou gasto sem nota, o total pago não é a soma dos itens: a parte diz de quê é.
  const sharesOfItems = total.totalCents !== current.itemsCents;
  const shareOfWhat = sharesOfItems ? 'dos itens' : 'do mês';
  // Mês anterior sem compra de mercado: o cabeçalho diz isso uma vez.
  const hadPrevious = comparedTotal.trips > 0;
  // As categorias e "O que mudou" são dos itens: só se comparam com um mês anterior que teve nota de mercado.
  const hadPreviousItems = compared.trips.length > 0;

  const categories = [...current.categories]
    .map(([key, amount]) => ({ key, name: getCategory(key).label, cents: amount }))
    .sort(byAmountThenName)
    .map(({ key, name: label, cents: amount }): MarketCategory => {
      const share = shareOf(amount, current.itemsCents);
      const versus = hadPreviousItems ? versusPrevious(amount, compared.categories.get(key) ?? 0, previous) : '';
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

  const items = itemRows(current, shareOfWhat, { month: previous.month, items: previousWhole.items });
  const trips = tripRows(current.trips, currentSpends, shortDate);

  // Por mercado: pelo id, não pelo nome (dois mercados podem ter o mesmo nome). Os gastos sem nota, pelo nome.
  type StoreFigures = { key: string; noReceipt: boolean; name: string; address: string; cnpj: string; cents: number; trips: number };
  const byStore = new Map<string, StoreFigures>();
  for (const trip of current.trips) {
    const key = storeKeyOf(trip.receipt);
    // O endereço e o CNPJ da ida mais recente (as idas vêm da mais nova para a mais antiga).
    const store = byStore.get(key) ?? {
      key,
      noReceipt: false,
      name: storeNameOf(trip.receipt),
      address: trip.receipt.storeAddress?.trim() ?? '',
      cnpj: trip.receipt.storeCnpj?.trim() ?? '',
      cents: 0,
      trips: 0,
    };
    store.cents += trip.money.paidCents;
    store.trips += 1;
    byStore.set(key, store);
  }
  for (const { spend, cents: value } of currentSpends) {
    const key = spendStoreKey(spend);
    // O nome do gasto mais recente (os gastos vêm do mais novo para o mais antigo).
    const store = byStore.get(key) ?? { key, noReceipt: true, name: spend.name, address: '', cnpj: '', cents: 0, trips: 0 };
    store.cents += value;
    store.trips += 1;
    byStore.set(key, store);
  }
  const sortedStores = [...byStore.values()].sort(byAmountThenName);
  // Só um mercado de nota precisa de endereço para se separar de outro de mesmo nome: o gasto sem nota já diz "sem nota".
  const receiptStores = sortedStores.filter((store) => !store.noReceipt);
  const stores = sortedStores.map((store): MarketStore => {
    const place = store.noReceipt ? null : storePlace(store, receiptStores);
    const idas = plural(store.trips, 'ida', 'idas');
    const detail = [place, idas, store.noReceipt ? 'sem nota' : null].filter(Boolean).join(' · ');
    return {
      key: store.key,
      noReceipt: store.noReceipt,
      name: store.name,
      place,
      cents: store.cents,
      amount: money(store.cents),
      detail,
      accessibilityLabel: `${place ? `${store.name}, ${place}` : store.name}: ${money(store.cents)} em ${idas}${store.noReceipt ? ', sem nota' : ''}`,
    };
  });

  const ref = (receipt: MarketReceipt, date: string, value: string): MarketReceiptRef => {
    const storeName = storeNameOf(receipt);
    return {
      key: receipt.id,
      opens: { kind: 'nota', id: receipt.id },
      storeName,
      date: shortDate(date),
      value,
      accessibilityLabel: `${storeName}, ${shortDate(date)}: ${value}. Abrir a nota`,
    };
  };
  const spendRef = ({ spend, cents: value }: SpendFigures): MarketReceiptRef => {
    const opens: MarketOpen = { kind: spend.source, id: spend.refId };
    return {
      key: spend.key,
      opens,
      storeName: spend.name,
      date: shortDate(spend.date),
      value: money(value),
      accessibilityLabel: `${spend.name}, ${shortDate(spend.date)}: ${money(value)}. ${openLabel(opens)}`,
    };
  };
  // As duas linhas usam a parte do mercado na diferença de cada nota, sem uma abater a outra.
  const discountCents = current.trips.reduce((sum, trip) => sum + Math.max(0, -trip.money.marketDiffCents), 0);
  const unreadCents = current.trips.reduce((sum, trip) => sum + Math.max(0, trip.money.marketDiffCents), 0);
  // Para conferir, só as notas em que a tela da nota também avisa que a soma não bate.
  const unreadTrips = current.trips.filter((trip) => trip.money.marketDiffCents > 0 && trip.money.diffCents > RECEIPT_CHECK_CENTS);
  const noValueCount = current.noValue.reduce((sum, entry) => sum + entry.count, 0);
  const draftCount = drafts.length;

  let comparison: string | null = null;
  if (total.trips > 0) {
    comparison = hadPrevious
      ? describeMonthDelta(total.totalCents / 100, { month: previous.month, amount: comparedTotal.totalCents / 100, uptoDay: previous.uptoDay })
      : `Não teve compra de mercado ${when(previous)}`;
  }

  // O que mudou: os itens do período da tela contra os da mesma janela do cabeçalho e das categorias.
  // O total pago muda diferente dos itens pelo que os descontos, os valores sem item e os gastos sem nota somam a
  // mais ou a menos que na janela: o mesmo valor nos dois períodos não abre diferença nenhuma, e não é motivo.
  const comparedDiscountCents = compared.trips.reduce((sum, trip) => sum + Math.max(0, -trip.money.marketDiffCents), 0);
  const comparedUnreadCents = compared.trips.reduce((sum, trip) => sum + Math.max(0, trip.money.marketDiffCents), 0);
  const change =
    current.trips.length > 0 && hadPreviousItems
      ? marketChange({
          current: current.items,
          previous: compared.items,
          previousWhen: when(previous),
          currentWhen: today.slice(0, 7) === month ? 'neste mês até hoje' : `em ${name}`,
          paidDiffCents: total.totalCents - comparedTotal.totalCents,
          receiptDifferences: {
            discounts: discountCents !== comparedDiscountCents,
            unread: unreadCents !== comparedUnreadCents,
            withoutReceipt: spendCents !== comparedSpendCents,
          },
        })
      : null;

  // O que tem data depois de hoje, em palavras: "1 nota", "2 gastos", "1 nota e 1 conta".
  const laterWhat = joinNames(
    [
      [laterReceipts.length, 'nota', 'notas'] as const,
      [laterSpends.filter(({ spend }) => spend.source === 'gasto').length, 'gasto', 'gastos'] as const,
      [laterSpends.filter(({ spend }) => spend.source === 'conta').length, 'conta', 'contas'] as const,
    ]
      .filter(([count]) => count > 0)
      .map(([count, one, many]) => plural(count, one, many)),
  );
  // Um tipo só: "dá para corrigir na nota" (a nota confirmada também deixa corrigir a data); mais de um, cada
  // linha abre o que é.
  const laterOpen = !laterSpends.length
    ? 'dá para corrigir na nota'
    : !laterReceipts.length && laterSpends.every(({ spend }) => spend.source === 'gasto')
      ? 'dá para corrigir no gasto'
      : !laterReceipts.length && laterSpends.every(({ spend }) => spend.source === 'conta')
        ? 'dá para corrigir na conta'
        : 'toque para abrir e corrigir';

  const inside = [
    spendCents > 0 ? `${money(spendCents)} de gastos lançados sem nota` : null,
    unreadCents > 0 ? `${money(unreadCents)} de notas sem item lido` : null,
    discountCents > 0 ? `${money(discountCents)} de descontos` : null,
  ].filter((part): part is string => part !== null);
  const outside = [
    current.pharmacyCents > 0 ? `${money(current.pharmacyCents)} de farmácia` : null,
    noValueCount > 0 ? plural(noValueCount, 'item sem valor', 'itens sem valor') : null,
    draftCount > 0 ? plural(draftCount, 'nota que espera a revisão', 'notas que esperam a revisão') : null,
    laterCount > 0 ? `${laterWhat} com data depois de hoje` : null,
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
    // Só gasto sem nota no mês: não há nota para ter vindo sem item lido.
    emptyItems:
      current.trips.length === 0 && currentSpends.length > 0
        ? 'Os gastos de mercado deste mês foram lançados sem nota, e por isso não têm itens.'
        : 'As notas deste mês vieram sem nenhum item lido.',
    // Nunca um corte calado: os primeiros vêm com o botão de ver todos.
    itemsCut:
      items.length > MARKET_ITEMS_SHOWN
        ? { shown: MARKET_ITEMS_SHOWN, more: `Ver todos os ${items.length} itens`, less: `Mostrar só os ${MARKET_ITEMS_SHOWN} primeiros` }
        : null,
    stores,
    // Sem nenhum valor lido não há porcentagem para explicar.
    shareBasis: sharesOfItems && current.itemsCents > 0 ? `As porcentagens são sobre os itens lidos (${money(current.itemsCents)}).` : null,
    closing: closing || null,
    withoutReceipt:
      spendCents > 0
        ? {
            label: 'Gastos lançados sem nota',
            value: money(spendCents),
            accessibilityLabel: `Gastos lançados sem nota: ${money(spendCents)}`,
          }
        : null,
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
            // A frase diz o que dá para fazer daqui, que é abrir a nota e ver (é lá que o item sem valor da nota
            // confirmada pode ganhar o valor). Sem nota de mercado no mês (só farmácia), o item não está em
            // total nenhum da tela para entrar como zero.
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
    later:
      laterCount > 0
        ? {
            label: `${laterWhat} com data depois de hoje`,
            // "Deste total", não "desta conta": aqui "conta" pode ser a conta paga.
            hint: `${laterCount === 1 ? 'Fica' : 'Ficam'} de fora deste total até o dia chegar. Se a data está errada, ${laterOpen}.`,
            receipts: byDate(
              laterReceipts.map((entry) => ({ date: entry.date, ref: ref(entry.receipt, entry.date, money(entry.cents)) })),
              laterSpends.map((entry) => ({ date: entry.spend.date, ref: spendRef(entry) })),
            ).map((entry) => entry.ref),
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
            receipts: drafts.slice(0, DRAFTS_SHOWN).map(({ receipt, date }): MarketReceiptRef => {
              const storeName = storeNameOf(receipt);
              return {
                key: receipt.id,
                opens: { kind: 'nota', id: receipt.id },
                storeName,
                date: shortDate(date),
                value: 'Revisar',
                accessibilityLabel: `${storeName}, ${shortDate(date)}. Abrir a nota para revisar`,
              };
            }),
            more: draftCount > DRAFTS_SHOWN ? `e mais ${draftCount - DRAFTS_SHOWN} em Finanças > Notas` : null,
          },
    change,
    emptyTitle: total.emptyTitle,
  };
}

/**
 * Um mercado da lista do mês (`store`, de `marketMonth`), aberto: as idas e os itens dele no mesmo período da
 * tela (no mês corrente, até hoje), pelas mesmas contas. A parte de cada item é sobre os itens deste mercado.
 * Os gastos sem nota de mesmo nome (`store.noReceipt`) vêm com as idas deles e nenhum item. null quando o mercado
 * não teve ida no período.
 */
export function marketStoreMonth(
  receipts: MarketReceipt[],
  month: string,
  today: string,
  store: MarketStore,
  spends: MarketSpend[] = [],
): MarketStoreMonth | null {
  const range = monthRange(month);
  const end = periodEnd(month, today);
  const year = Number(today.slice(0, 4));
  const shortDate = (date: string) => formatShortDate(date, year);
  if (store.noReceipt) {
    const own = spendsBetween(spends, range.start, end).filter(({ spend }) => spendStoreKey(spend) === store.key);
    if (!own.length) return null;
    return {
      key: store.key,
      title: store.name,
      headline: `${money(centsOf(own))} em ${plural(own.length, 'ida', 'idas')}`,
      trips: tripRows([], own, shortDate),
      items: [],
      emptyItems: own.length === 1 ? 'Lançado sem nota: não tem itens.' : 'Lançados sem nota: não têm itens.',
    };
  }
  const current = figures(
    receipts.filter((receipt) => storeKeyOf(receipt) === store.key),
    range.start,
    end,
  );
  if (!current.trips.length) return null;
  const paid = current.trips.reduce((sum, trip) => sum + trip.money.paidCents, 0);
  return {
    key: store.key,
    title: store.place ? `${store.name} (${store.place})` : store.name,
    headline: `${money(paid)} em ${plural(current.trips.length, 'ida', 'idas')}`,
    trips: tripRows(current.trips, [], shortDate),
    items: itemRows(current, 'dos itens deste mercado', null),
    emptyItems: 'As notas deste mercado vieram sem nenhum item lido.',
  };
}

/** A ordem dos itens do mês. */
export type MarketItemOrder = 'valor' | 'quantidade' | 'idas';

export const MARKET_ITEM_ORDERS: { value: MarketItemOrder; label: string }[] = [
  { value: 'valor', label: 'Valor' },
  { value: 'quantidade', label: 'Quantidade' },
  { value: 'idas', label: 'Idas' },
];

/** Na ordem por quantidade, a frase de cima: por que os itens vêm em grupos. */
export const QUANTITY_ORDER_NOTE = 'A quantidade só se soma na mesma medida: o que é por unidade, por peso e por volume vem separado.';

/** Os itens numa ordem, em grupos: um só (sem título) por valor e por idas; por quantidade, um por medida. */
export interface MarketItemGroup {
  key: string;
  /** "Por peso"; null no grupo único. */
  title: string | null;
  /** O que o grupo quer dizer, quando precisa: o dos itens que não se somam. */
  hint: string | null;
  items: MarketItem[];
  /**
   * Por quantidade, com o corte: quantos itens do grupo ficaram para o "Ver todos" ("Mais 15 itens por unidade:
   * veja em “Ver todos”."); null quando o grupo vem inteiro.
   */
  rest: string | null;
}

/** Os itens na ordem escolhida, já com o corte: os grupos e o que o botão do corte diz. */
export interface MarketItemList {
  groups: MarketItemGroup[];
  /** "Ver todos os 25 itens" / "Mostrar só os 10 primeiros"; null quando não há o que esconder. */
  toggle: string | null;
}

/** Por quantidade, com o corte, cada medida mostra pelo menos estes primeiros: nenhum grupo some da tela. */
export const MARKET_ITEMS_SHOWN_PER_MEASURE = 3;

/** O botão que volta ao corte, quando ele é feito por medida. */
const LESS_BY_MEASURE = 'Mostrar só os primeiros de cada medida';

const MEASURE_TITLES: Record<string, string> = { un: 'Por unidade', peso: 'Por peso', volume: 'Por volume' };
const MEASURE_ORDER = ['un', 'peso', 'volume'];
const MIXED = 'Em medidas que não se somam';
const MIXED_HINT = 'Comprados ora por unidade, ora por peso ou volume: a quantidade não se soma, e a linha diz quantas compras foram.';

/**
 * Os itens na ordem escolhida. Por valor: a de `marketMonth` (do que levou mais dinheiro). Por idas: em
 * quantas idas do mês o item foi comprado, e no empate o valor. Por quantidade: 2 kg de arroz e 12 caixas de
 * leite não se comparam, então cada medida vem num grupo (por unidade, por peso, por volume, e a unidade que
 * vier diferente com o nome dela), do que foi mais comprado para o que foi menos; os itens comprados em
 * medidas que não se somam (por unidade numa ida e por peso na outra) ficam por último, num grupo que diz isso.
 *
 * `cut` (o `itemsCut` do mês), sem `showAll`, mostra só os primeiros. Num grupo só (por valor, por idas, ou
 * tudo numa medida), os `cut.shown` primeiros. Por quantidade, com mais de uma medida, o corte é por grupo:
 * cada medida mostra os primeiros dela (pelo menos MARKET_ITEMS_SHOWN_PER_MEASURE), e as vagas que sobram vão
 * para os grupos na ordem; assim o peso e o volume nunca somem atrás de dez itens por unidade, e cada grupo
 * cortado diz quantos ficaram para o "Ver todos". Corte que não esconde nada não tem botão.
 */
export function orderMarketItems(
  items: MarketItem[],
  order: MarketItemOrder,
  cut: { shown: number; more: string; less: string } | null = null,
  showAll = false,
): MarketItemList {
  const tieBreak = (a: MarketItem, b: MarketItem) => b.cents - a.cents || a.name.localeCompare(b.name, 'pt-BR') || a.key.localeCompare(b.key);
  let groups: MarketItemGroup[];
  if (order === 'valor') groups = [{ key: 'todos', title: null, hint: null, items, rest: null }];
  else if (order === 'idas')
    groups = [{ key: 'todos', title: null, hint: null, items: [...items].sort((a, b) => b.trips - a.trips || tieBreak(a, b)), rest: null }];
  else {
    const byMeasure = new Map<string, MarketItem[]>();
    for (const item of items) {
      const measure = item.quantity?.measure ?? '';
      byMeasure.set(measure, [...(byMeasure.get(measure) ?? []), item]);
    }
    const rank = (measure: string) => (measure === '' ? MEASURE_ORDER.length + 1 : MEASURE_ORDER.includes(measure) ? MEASURE_ORDER.indexOf(measure) : MEASURE_ORDER.length);
    groups = [...byMeasure.keys()]
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
      .map((measure) => ({
        key: measure || 'misturado',
        title: measure === '' ? MIXED : (MEASURE_TITLES[measure] ?? `Em ${measure}`),
        hint: measure === '' ? MIXED_HINT : null,
        items: byMeasure.get(measure)!.sort((a, b) => (b.quantity?.amount ?? 0) - (a.quantity?.amount ?? 0) || tieBreak(a, b)),
        rest: null,
      }));
  }
  // Sem itens não há grupo nenhum.
  groups = groups.filter((group) => group.items.length > 0);
  if (!cut) return { groups, toggle: null };

  const byMeasure = groups.length > 1;
  const counts = groups.map((group) => Math.min(group.items.length, byMeasure ? Math.max(MARKET_ITEMS_SHOWN_PER_MEASURE, Math.floor(cut.shown / groups.length)) : cut.shown));
  let left = cut.shown - counts.reduce((sum, count) => sum + count, 0);
  groups.forEach((group, index) => {
    const extra = Math.min(Math.max(0, left), group.items.length - counts[index]);
    counts[index] += extra;
    left -= extra;
  });
  const hidden = groups.reduce((sum, group, index) => sum + group.items.length - counts[index], 0);
  if (hidden === 0) return { groups, toggle: null };
  if (showAll) return { groups, toggle: byMeasure ? LESS_BY_MEASURE : cut.less };
  return {
    groups: groups.map((group, index) => {
      const restCount = group.items.length - counts[index];
      const name = group.title ? group.title.charAt(0).toLocaleLowerCase('pt-BR') + group.title.slice(1) : null;
      return {
        ...group,
        items: group.items.slice(0, counts[index]),
        rest: byMeasure && name && restCount > 0 ? `Mais ${plural(restCount, 'item', 'itens')} ${name}: veja em “Ver todos”.` : null,
      };
    }),
    toggle: cut.more,
  };
}

/** Com uma categoria escolhida que não tem item no mês: a frase no lugar da lista. */
export function noCategoryItems(category: string, month: string): string {
  return `Nenhum item de “${getCategory(category).label}” em ${monthName(month)}.`;
}

/**
 * Por que o total do mercado não é a barra "Mercado" do Resumo, em duas frases: a tela do mês diz no pé (`where`
 * 'mes'), e a entrada no Resumo, logo abaixo dela ('resumo'). As duas contas diferem de propósito nas notas
 * fiscais: aqui elas entram com as categorias que o Resumo põe em outras barras (limpeza, higiene, papel e bebê
 * em "Limpeza e higiene", pet em "Pet", e os itens "Outros" em "Outros"), e sem os remédios. Os gastos avulsos e
 * as contas pagas lançados como Mercado contam nos dois. No mês corrente, o que tem data depois de hoje fica de fora
 * daqui (o Resumo conta); num mês passado não há nada assim, e a frase não fala disso. No Resumo, "aqui" seria o
 * próprio Resumo: lá a frase diz o nome da tela, "no Mercado do mês", e "lá".
 */
export function marketVsSummary(month: string, today: string, where: 'mes' | 'resumo'): string {
  const start = where === 'mes' ? 'Diferente da barra “Mercado” do Resumo: aqui' : 'Diferente da barra “Mercado”: no Mercado do mês';
  const there = where === 'mes' ? '' : ' lá';
  const later = today.slice(0, 7) === month ? ', e o que tem data depois de hoje fica de fora' : '';
  return (
    `${start} as notas fiscais entram com limpeza, higiene, papel, bebê, pet e os itens de “Outros”, sem remédio. ` +
    `Os gastos avulsos e as contas pagas lançados como Mercado também contam${there}${later}.`
  );
}

/** Quantos meses o cartão de tendência mostra, contando o da tela: as notas lidas vão até o primeiro deles. */
export const MARKET_TREND_MONTHS = 6;

/** Embaixo do cartão de tendência, quando cada mês abre na tela. */
export const MARKET_TREND_HINT = 'Toque num mês para ver o mercado dele.';

/** O que a barra e o leitor de tela dizem do mês sem ida ao mercado (sem nota nem gasto, ou só com farmácia ou rascunho). */
const NO_TRIP = 'sem ida';
const NO_TRIP_SPOKEN = 'sem ida ao mercado';
/** Na tendência de uma categoria, o mês que só teve gastos sem nota: não há item para dizer quanto foi nela. */
const NO_ITEMS = 'sem nota';
const NO_ITEMS_SPOKEN = 'só gastos lançados sem nota';

/** Um mês do cartão de tendência. */
export interface MarketTrendBar {
  month: string;
  /** "mai" */
  label: string;
  /**
   * O ano, só quando a janela atravessa o ano e só no primeiro mês de cada ano nela ("2025" em novembro,
   * "2026" em janeiro); null nos outros.
   */
  year: string | null;
  /** "hoje" no mês corrente, que ainda não fechou e conta só até hoje; null nos outros. */
  note: string | null;
  cents: number;
  /** "R$ 1.240,00"; "sem ida ao mercado" no mês sem ida (aparece como zero, não some). */
  amount: string;
  /** O valor curto que cabe embaixo da barra: "840", "1,2 mil", "sem ida". */
  short: string;
  /** O mês teve ida ao mercado (nota confirmada com item de mercado, ou gasto sem nota). */
  hasTrips: boolean;
  /**
   * Na tendência de uma categoria, o mês teve ida mas só gastos sem nota: sem itens, o valor dela não é zero, é
   * desconhecido ("sem nota"), e o mês fica fora da média.
   */
  noItems: boolean;
  /** O mês corrente, contado só até hoje. */
  partial: boolean;
  /**
   * O mês e o valor, para o leitor de tela (cada mês do cartão é um botão): "Setembro: R$ 130,00", "Outubro até
   * hoje: sem ida ao mercado". Com o ano quando a janela atravessa o ano.
   */
  spoken: string;
  /**
   * O que o botão do mês diz, em todas as plataformas (na web o estado "selecionado" de um botão não chega ao
   * leitor de tela): "Setembro: R$ 130,00. Abrir este mês"; o último, o mês da tela, "…. Mês aberto".
   */
  accessibilityLabel: string;
}

export interface MarketTrend {
  /** "Últimos 6 meses", "6 meses até agosto", "Hortifrúti nos últimos 6 meses". */
  title: string;
  /** Do mais antigo para o mais recente (o da tela). */
  bars: MarketTrendBar[];
  /** A maior barra (ou a média, se for maior): é a altura cheia do gráfico. */
  maxCents: number;
  /** A média dos meses fechados com ida ao mercado; null sem nenhum. */
  averageCents: number | null;
  /** "Média dos meses fechados: R$ 1.100,00" */
  average: string | null;
  /** "2 meses sem ida ao mercado ficam fora da média."; null quando não há. */
  averageNote: string | null;
  /** Algum mês da janela teve ida ao mercado: sem nenhuma, a tela não mostra o cartão. */
  hasAny: boolean;
}

/** O valor curto, embaixo da barra: o cartão já diz que é em reais. "840", "1,2 mil", "12 mil". */
export function shortAmount(amountCents: number): string {
  const reais = Math.round(amountCents / 100);
  if (reais < 1000) return String(reais);
  const thousands = reais / 1000;
  const text = thousands < 10 ? thousands.toFixed(1).replace(/\.0$/, '').replace('.', ',') : String(Math.round(thousands));
  return `${text} mil`;
}

/**
 * Como o mercado andou nos `MARKET_TREND_MONTHS` meses que terminam no mês da tela: o total pago de cada mês
 * (a conta do cabeçalho, a de `paidBetween`) ou, com `category`, a soma dos itens dela pelo valor impresso (a
 * conta da linha da categoria). As mesmas regras da tela: só as idas ao mercado, farmácia fora, a data da
 * compra no fuso do aparelho e, no mês corrente, só até hoje (a nota de data futura fica de fora, como no
 * cabeçalho). Mês sem ida aparece como "sem ida", com barra zero. A média é só dos meses fechados com ida: o
 * mês corrente está pela metade, e um mês sem nota nenhuma diz mais sobre o uso do app do que sobre o gasto
 * (puxaria a média para baixo). Cada nota é vista uma vez: a data e o dinheiro dela são contados numa passada só.
 * Os gastos sem nota (`spends`) entram no total de cada mês como idas, com o mesmo corte de data. Numa categoria
 * de produto eles não têm valor (não têm itens): o mês que só teve gasto sem nota diz "sem nota", e não zero, e
 * fica fora da média, que zero ali puxaria para baixo sem ser verdade.
 */
export function marketTrend(
  receipts: MarketTotalReceipt[],
  month: string,
  today: string,
  category: string | null = null,
  spends: MarketSpend[] = [],
): MarketTrend {
  const currentMonth = today.slice(0, 7);
  const first = shiftMonth(month, -(MARKET_TREND_MONTHS - 1));
  const windows = Array.from({ length: MARKET_TREND_MONTHS }, (_, index) => {
    const m = shiftMonth(first, index);
    return { month: m, end: periodEnd(m, today), cents: 0, trips: 0, receiptTrips: 0 };
  });
  const byMonth = new Map(windows.map((window) => [window.month, window]));
  for (const receipt of receipts) {
    if (receipt.status !== 'confirmed') continue;
    const date = purchasedOn(receipt);
    const window = byMonth.get(date.slice(0, 7));
    // Fora da janela, ou no mês corrente com data depois de hoje.
    if (!window || date >= window.end) continue;
    const paid = receiptMoney(receipt);
    if (!paid.trip) continue;
    window.trips += 1;
    window.receiptTrips += 1;
    if (category == null) window.cents += paid.paidCents;
    else for (const { category: key, value } of paid.market) if (key === category) window.cents += value;
  }
  for (const window of windows) {
    const loose = spendsBetween(spends, monthRange(window.month).start, window.end);
    window.trips += loose.length;
    if (category == null) window.cents += centsOf(loose);
  }

  const crossesYear = first.slice(0, 4) !== month.slice(0, 4);
  // Na virada do ano, "dezembro de 2025": sem o ano, dezembro e janeiro lado a lado confundem.
  const spokenMonth = (m: string) => (crossesYear ? monthLabel(m) : monthName(m));
  const bars = windows.map(({ month: m, cents: value, trips, receiptTrips }, index): MarketTrendBar => {
    const hasTrips = trips > 0;
    const noItems = category != null && hasTrips && receiptTrips === 0;
    const amount = !hasTrips ? NO_TRIP_SPOKEN : noItems ? NO_ITEMS_SPOKEN : money(value);
    const spoken = `${capitalize(spokenMonth(m))}${m === currentMonth ? ' até hoje' : ''}: ${amount}`;
    return {
      month: m,
      label: monthShortLabel(m),
      year: crossesYear && (index === 0 || m.endsWith('-01')) ? m.slice(0, 4) : null,
      note: m === currentMonth ? 'hoje' : null,
      cents: hasTrips ? value : 0,
      amount,
      short: !hasTrips ? NO_TRIP : noItems ? NO_ITEMS : shortAmount(value),
      hasTrips,
      noItems,
      partial: m === currentMonth,
      spoken,
      // O gráfico termina no mês da tela.
      accessibilityLabel: m === month ? `${spoken}. Mês aberto` : `${spoken}. Abrir este mês`,
    };
  });
  const closed = bars.filter((bar) => !bar.partial);
  const counted = closed.filter((bar) => bar.hasTrips && !bar.noItems);
  const averageCents = counted.length ? Math.round(counted.reduce((sum, bar) => sum + bar.cents, 0) / counted.length) : null;
  const withoutTrips = closed.filter((bar) => !bar.hasTrips).length;
  const withoutItems = closed.filter((bar) => bar.noItems).length;
  const average = averageCents == null ? null : `Média dos meses fechados: ${money(averageCents)}`;
  // "1 mês sem ida ao mercado e 1 mês só com gastos lançados sem nota ficam fora da média."
  const skipped = [
    withoutTrips ? plural(withoutTrips, `mês ${NO_TRIP_SPOKEN}`, `meses ${NO_TRIP_SPOKEN}`) : null,
    withoutItems ? plural(withoutItems, 'mês só com gastos lançados sem nota', 'meses só com gastos lançados sem nota') : null,
  ].filter((part): part is string => part !== null);
  const averageNote =
    averageCents != null && skipped.length
      ? `${joinNames(skipped)} ${withoutTrips + withoutItems === 1 ? 'fica' : 'ficam'} fora da média.`
      : null;
  const span = month === currentMonth ? `últimos ${MARKET_TREND_MONTHS} meses` : `${MARKET_TREND_MONTHS} meses até ${monthName(month)}`;
  const title = category ? `${getCategory(category).label} ${month === currentMonth ? 'nos' : 'em'} ${span}` : capitalize(span);
  return {
    title,
    bars,
    maxCents: Math.max(0, averageCents ?? 0, ...bars.map((bar) => bar.cents)),
    averageCents,
    average,
    averageNote,
    hasAny: bars.some((bar) => bar.hasTrips),
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
