// Histórico de preço de um produto: o que a casa pagou por ele em cada compra
// (linhas de notas confirmadas), ao longo do tempo. O preço é sempre o
// unit_price guardado: o impresso na nota ou, numa linha pesada, o derivado
// (o total pelo peso na revisão, o preço da bandeja pelo tamanho na leitura).
// Ele é levado a kg, litro ou unidade para comparar e arredondado para centavos
// uma vez só: é esse valor que a seção compara e escreve. O que foi pago (com
// desconto) aparece só na linha da compra. Linha
// com preço zero (a leitura não trouxe o valor, ou o item saiu de graça) não é
// preço: fica na lista como "sem valor" e fora de tudo o que fala de preço.
// Unidades que não se comparam (kg e un) nunca se misturam: cada uma tem o seu
// histórico. Aqui um mercado é o nome dele: lojas de mesmo nome são uma só.
// Embalagens de tamanhos diferentes ("ARROZ 5KG" e "ARROZ 1KG", ambos "1 un")
// se comparam pelo preço por kg, litro ou item do pacote, com o tamanho lido
// na descrição da nota (packageSize); a compra de tamanho desconhecido fica no
// histórico por unidade, como antes, sem tamanho inventado.
// Tudo o que a seção mostra (frases, gráfico, linhas) sai daqui; a tela só
// desenha.

import { addMonths, diffDays, formatShortDate, toISODate } from './dates';
import { formatBRL, formatQuantity } from './money';
import { packageSize, samePackageSize, type PackageSize } from './packageSize';
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
  /** A descrição como veio na nota ("ARROZ T1 5KG"), de onde sai o tamanho da embalagem; sem ela, o tamanho não é conhecido. */
  description?: string;
  /** Quantos vinham na embalagem, respondido na revisão (domain/packCount): vale quando a descrição não diz o tamanho. */
  packCount?: number | null;
}

/** Uma compra do produto: as linhas iguais de uma mesma nota (mesma unidade, mesmo preço impresso), somadas. */
export interface Purchase {
  key: string;
  receiptId: string;
  /** Chave do mercado: o nome dele (storeKey), ou NO_STORE. */
  store: string;
  storeName: string;
  /** Dia da compra no fuso do aparelho (AAAA-MM-DD). */
  day: string;
  /** Momento da compra, para ordenar as do mesmo dia. */
  time: number;
  /** Quantidade e unidade como na nota ("500 ml"). */
  quantity: number;
  unit: string;
  /**
   * A unidade em que os preços se comparam: kg, l, un ou PACK_ITEM. A compra por unidade de uma embalagem de
   * tamanho conhecido passa a kg, l ou PACK_ITEM quando o produto tem embalagens de tamanhos diferentes (ou também
   * é vendido a peso): ver compareBySize.
   */
  baseUnit: string;
  /** O preço impresso, por `baseUnit`, já em centavos inteiros (roundPrice). Zero: compra sem valor. */
  price: number;
  /** O tamanho da embalagem lido na nota, só na compra por unidade; null quando a nota não diz (ou deixa dúvida). */
  pack: PackageSize | null;
  /** Na compra comparada pelo tamanho, o preço impresso por embalagem (o `price` é por kg, l ou item); senão, null. */
  packagePrice: number | null;
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

/**
 * Metade da quarta casa decimal: o banco guarda o preço da linha com quatro
 * casas, então o preço guardado pode estar até isto acima do verdadeiro. Numa
 * linha em g ou ml a sobra se multiplica pela quantidade (900 ml a R$ 0,0086
 * dão R$ 7,74 para um total de R$ 7,70) e não é desconto.
 */
const UNIT_PRICE_PRECISION = 0.00005;

const cents = (value: number) => Math.round(value * 100);

/** A linha saiu por menos do que quantidade x preço impresso (além do arredondamento do total e do preço guardado). */
export function hasDiscount(line: Pick<PurchaseLine, 'quantity' | 'unitPrice' | 'totalPrice'>): boolean {
  return cents(line.quantity * line.unitPrice - line.totalPrice - line.quantity * UNIT_PRICE_PRECISION) > DISCOUNT_TOLERANCE_CENTS;
}

/**
 * O preço em centavos inteiros, que é como a tela o escreve. Seis casas antes
 * de arredondar: 1,005 x 100 dá 100,49999999999999 no ponto flutuante, e o
 * preço é R$ 1,01. toPurchases arredonda uma vez e a seção inteira compara e
 * escreve esse valor: dois preços iguais na tela são o mesmo preço em toda
 * frase e no gráfico.
 */
export function roundPrice(price: number): number {
  return Math.round(Number((price * 100).toFixed(6))) / 100;
}

/** A compra tem preço. Preço impresso zero (ou que nem chega a um centavo) é compra sem valor: não entra em nada que fale de preço. */
export const isPriced = (purchase: Pick<Purchase, 'price'>) => purchase.price > 0;

/**
 * Nesta seção um mercado é o nome dele, sem caixa nem espaços nas pontas
 * (como o sameStoreName de data/receipts): duas filiais com o mesmo nome na
 * nota, ou a mesma loja cadastrada duas vezes, são um mercado só. O prefixo
 * separa o nome das outras chaves (uma loja chamada "Todos" não é ALL_STORES).
 */
export const storeKey = (name: string) => `nome:${name.trim().toLocaleLowerCase('pt-BR')}`;

/** A mais recente primeiro; no mesmo instante (duas notas com a data digitada caem ao meio-dia), sempre na mesma ordem. */
const newestFirst = (a: Purchase, b: Purchase) => b.time - a.time || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** A cartela que a pessoa disse na revisão ("10 ovos"): um pacote de N itens, como "C/10" na descrição. */
const answeredPack = (count: number | null | undefined): PackageSize | null =>
  count != null && count >= 2 ? { unit: 'un', amount: count, label: `${count} un` } : null;

/**
 * As compras do produto, da mais recente para a mais antiga. O caixa que
 * passa três caixas de leite uma a uma gera três linhas iguais na nota: aqui
 * elas são uma compra de 3 un. Linhas da mesma nota com preço impresso ou
 * unidade diferentes ficam separadas.
 */
export function toPurchases(lines: PurchaseLine[]): Purchase[] {
  const byKey = new Map<string, Purchase>();
  // O preço impresso, sem arredondar: o preço por kg sai dele, não do já arredondado.
  const printed = new Map<string, number>();
  for (const line of lines) {
    const key = `${line.receiptId}|${line.unit}|${line.unitPrice}`;
    const pack = line.unit === 'un' ? ((line.description ? packageSize(line.description) : null) ?? answeredPack(line.packCount)) : null;
    const same = byKey.get(key);
    if (same) {
      same.quantity = Math.round((same.quantity + line.quantity) * 1000) / 1000;
      same.paid = cents(same.paid + line.totalPrice) / 100;
      same.discounted = same.discounted || hasDiscount(line);
      // Duas linhas somadas com tamanhos diferentes (ou uma sem tamanho): o tamanho da compra não é conhecido.
      if (!(same.pack && pack && samePackageSize(same.pack, pack))) same.pack = null;
      continue;
    }
    printed.set(key, line.unitPrice);
    const at = new Date(line.purchasedAt);
    const base = pricePerBase(line.unitPrice, line.unit);
    const storeName = line.storeId ? (line.storeName ?? 'Mercado') : NO_STORE_NAME;
    byKey.set(key, {
      key,
      receiptId: line.receiptId,
      store: line.storeId ? storeKey(storeName) : NO_STORE,
      storeName,
      // O dia é o do aparelho: a compra das 22h do dia 31 não cai no mês seguinte.
      day: toISODate(at),
      time: at.getTime(),
      quantity: line.quantity,
      unit: line.unit,
      baseUnit: base.unit,
      price: roundPrice(base.unitPrice),
      pack,
      packagePrice: null,
      paid: line.totalPrice,
      discounted: hasDiscount(line),
    });
  }
  return compareBySize([...byKey.values()], printed).sort(newestFirst);
}

/** A unidade das compras comparadas pelo item do pacote ("OVOS C/12" e "OVOS C/30": o preço de cada ovo). */
export const PACK_ITEM = 'item';

/**
 * Embalagens de tamanhos diferentes do mesmo produto se comparam pelo tamanho:
 * "ARROZ 5KG" a R$ 24,90 e "ARROZ 1KG" a R$ 5,49 são R$ 4,98 e R$ 5,49 por kg,
 * e não um preço que caiu para um quinto. Para cada grandeza (peso, volume,
 * itens do pacote), as compras por unidade com o tamanho conhecido passam a
 * ser por kg, litro ou item quando há pelo menos dois tamanhos, ou quando o
 * produto também é vendido a peso (ou a litro): aí entram no mesmo histórico
 * que a compra a granel, que já tem preço por kg. Com um tamanho só, nada
 * muda: o preço da embalagem já se compara. A compra sem tamanho conhecido
 * fica por unidade, à parte. `printed`: o preço impresso de cada compra.
 */
function compareBySize(purchases: Purchase[], printed: ReadonlyMap<string, number>): Purchase[] {
  const sold = new Set(purchases.map((p) => p.baseUnit));
  for (const measure of ['kg', 'l', 'un'] as const) {
    const packed = purchases.filter((p) => p.baseUnit === 'un' && p.pack?.unit === measure);
    const sizes = packed.filter((p, index) => packed.findIndex((other) => samePackageSize(other.pack!, p.pack!)) === index);
    const byWeight = measure !== 'un' && sold.has(measure);
    if (!packed.length || (sizes.length < 2 && !byWeight)) continue;
    for (const p of packed) {
      p.packagePrice = p.price;
      p.baseUnit = measure === 'un' ? PACK_ITEM : measure;
      p.price = roundPrice((printed.get(p.key) ?? p.price) / p.pack!.amount);
    }
  }
  return purchases;
}

// ---------------------------------------------------------------------------
// Unidade, período e mercado

const UNIT_ORDER = ['un', PACK_ITEM, 'kg', 'l'];
const UNIT_LABELS: Record<string, string> = { un: 'por unidade', [PACK_ITEM]: 'por item do pacote', kg: 'por kg', l: 'por litro' };

export const unitLabel = (unit: string) => UNIT_LABELS[unit] ?? `por ${unit}`;

/** As unidades em que o produto foi comprado (un, kg, l), nessa ordem. */
export function purchaseUnits(purchases: Purchase[]): string[] {
  const rank = (unit: string) => (UNIT_ORDER.includes(unit) ? UNIT_ORDER.indexOf(unit) : UNIT_ORDER.length);
  return [...new Set(purchases.map((p) => p.baseUnit))].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1));
}

/**
 * A unidade com mais compras com preço; no empate, a da mais recente delas.
 * Sem nenhuma com preço, contam todas. null sem compra nenhuma.
 */
export function defaultUnit(purchases: Purchase[]): string | null {
  const priced = purchases.filter(isPriced);
  const counted = priced.length ? priced : purchases;
  const counts = new Map<string, number>();
  for (const p of counted) counts.set(p.baseUnit, (counts.get(p.baseUnit) ?? 0) + 1);
  const most = Math.max(0, ...counts.values());
  // As compras vêm da mais recente para a mais antiga: a primeira das empatadas é a mais nova.
  return counted.find((p) => counts.get(p.baseUnit) === most)?.baseUnit ?? null;
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

/** "6 meses" quando há pelo menos duas compras com preço neles; senão, "Tudo". */
export function defaultPeriod(purchases: Purchase[], today: string): Period {
  return inPeriod(purchases.filter(isPriced), '6m', today).length >= 2 ? '6m' : 'tudo';
}

export interface Option<T extends string = string> {
  value: T;
  label: string;
}

/**
 * Os chips de mercado: "Todos" e um por nome de mercado, só quando as compras
 * (com ou sem valor: todas estão na lista) vêm de dois ou mais. Nomes que só
 * mudam na caixa são um chip, com o nome como veio na compra mais recente.
 */
export function storeOptions(purchases: Purchase[]): Option[] {
  const names = new Map<string, string>();
  for (const p of [...purchases].sort(newestFirst)) if (!names.has(p.store)) names.set(p.store, p.storeName);
  if (names.size < 2) return [];
  const stores = [...names].map(([value, label]) => ({ value, label }));
  // Por nome; a compra sem mercado fica por último.
  stores.sort((a, b) => Number(a.value === NO_STORE) - Number(b.value === NO_STORE) || a.label.localeCompare(b.label, 'pt-BR'));
  return [{ value: ALL_STORES, label: 'Todos' }, ...stores];
}

// ---------------------------------------------------------------------------
// O resumo, em frases

const yearOf = (today: string) => Number(today.slice(0, 4));
/** "R$ 4,98/kg", "R$ 25,90/un"; por item do pacote, "R$ 0,83 cada". */
const perUnit = (p: Pick<Purchase, 'price' | 'baseUnit'>) =>
  p.baseUnit === PACK_ITEM ? `${formatBRL(p.price)} cada` : `${formatBRL(p.price)}/${p.baseUnit}`;
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
 * 12 jul (era R$ 22,90)", "Caiu 8% desde…", "Mesmo preço desde 12 jul" com os
 * mesmos centavos, ou "Quase o mesmo preço desde 12 jul (era R$ 100,00)" com
 * centavos diferentes numa mudança que arredonda para 0% (logo abaixo vem
 * "Menor: R$ 100,00 · Maior: R$ 100,40"). Só com compras com preço, em dois
 * dias diferentes. Com as duas em mercados de nomes diferentes (só acontece
 * sem mercado escolhido), a frase diz isso: diferença entre mercados não é o
 * preço que subiu.
 */
export function changeSentence(first: Purchase, last: Purchase, today: string): string | null {
  if (first.day === last.day || !isPriced(first) || !isPriced(last)) return null;
  const since = `desde ${formatShortDate(first.day, yearOf(today))}`;
  const elsewhere =
    first.store === last.store ? null : first.store === NO_STORE ? 'numa compra sem mercado informado' : `em outro mercado: ${first.storeName}`;
  if (first.price === last.price) return `Mesmo preço ${since}${elsewhere ? ` (${elsewhere})` : ''}`;
  const was = `(era ${formatBRL(first.price)}${elsewhere ? `, ${elsewhere}` : ''})`;
  const percent = percentChange(first.price, last.price);
  if (!percent) return `Quase o mesmo preço ${since} ${was}`;
  return `${percent > 0 ? 'Subiu' : 'Caiu'} ${Math.abs(percent)}% ${since} ${was}`;
}

/** O menor e o maior preço; no empate (os mesmos centavos, também entre uma compra em g e outra em kg), vale a compra mais recente. null sem compras. */
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
  if (lowest.price === highest.price) {
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
  if (!range || purchases.length < 3 || range.lowest.price === range.highest.price) return null;
  // Entre dois preços, a mediana pode cair em meio centavo: sai em centavos como os outros.
  return `Costuma custar ${formatBRL(roundPrice(medianPrice(purchases)!))}`;
}

const PERIOD_WORDS: Record<Period, string> = { '3m': ' em 3 meses', '6m': ' em 6 meses', '1a': ' em 1 ano', tudo: '' };

/**
 * "8 compras em 6 meses", "1 compra": as compras com preço. Com outras sem
 * valor à vista, diz quantas ficaram de fora: "8 compras e 1 sem valor em 6
 * meses".
 */
export function countSentence(count: number, period: Period, noValue = 0): string {
  return `${plural(count, 'compra', 'compras')}${noValue > 0 ? ` e ${noValue} sem valor` : ''}${PERIOD_WORDS[period]}`;
}

/** Período sem compra nenhuma: diz isso e onde ver mais. */
/**
 * A frase de "Último preço por mercado" quando nenhum mercado tem preço deste produto. A nota sem mercado não
 * entra ali, mas é compra e aparece no histórico logo abaixo: a frase não pode dizer que não há nota nenhuma.
 * A compra sem valor também não entra (zero não é preço), mesmo com mercado: a frase diz qual é o caso.
 * `purchases`: as compras do produto; undefined enquanto não se sabe (buscando, ou a busca falhou).
 */
export function noStorePriceSentence(purchases: readonly Pick<Purchase, 'store'>[] | undefined): string {
  if (!purchases) return 'Nenhum preço por mercado ainda.';
  if (!purchases.length) return 'Nenhuma nota confirmada com este produto ainda.';
  const one = purchases.length === 1;
  const noStore = purchases.filter((purchase) => purchase.store === NO_STORE).length;
  if (noStore === purchases.length) {
    return one
      ? 'A compra deste produto está numa nota sem mercado informado: veja o histórico abaixo.'
      : 'As compras deste produto estão em notas sem mercado informado: veja o histórico abaixo.';
  }
  // Com mercado e fora dos preços por mercado: é a compra sem valor.
  if (!noStore) {
    return one ? 'A compra deste produto está sem valor: veja o histórico abaixo.' : 'As compras deste produto estão sem valor: veja o histórico abaixo.';
  }
  return 'As compras deste produto estão sem valor ou em notas sem mercado informado: veja o histórico abaixo.';
}

export function emptyPeriodSentence(period: Period): string {
  const when = period === '1a' ? 'no último ano' : `nos últimos ${PERIODS.find((p) => p.value === period)?.label}`;
  return period === 'tudo' ? 'Nenhuma compra ainda.' : `Nenhuma compra ${when}. Veja em "Tudo".`;
}

/** Há compras à vista, mas nenhuma com preço: a lista aparece, e esta frase fica no lugar do resumo. */
export function noValueSentence(period: Period): string {
  return period === 'tudo' ? 'Nenhuma compra com valor ainda.' : 'Nenhuma compra com valor neste período.';
}

/**
 * O resumo acima do gráfico, uma frase por linha. `purchases` são as compras
 * à vista (da unidade, do período e do mercado escolhidos), da mais recente
 * para a mais antiga. Só as que têm preço entram nas frases; as sem valor
 * aparecem na contagem. Com uma compra só, o resumo é ela.
 */
export function summarize(purchases: Purchase[], { period, today }: { period: Period; today: string }): string[] {
  if (!purchases.length) return [emptyPeriodSentence(period)];
  const priced = purchases.filter(isPriced);
  if (!priced.length) return [noValueSentence(period)];
  const last = priced[0];
  const first = priced[priced.length - 1];
  return [
    latestSentence(last, today),
    changeSentence(first, last, today),
    rangeSentence(priced, period, today),
    usualSentence(priced),
    countSentence(priced.length, period, purchases.length - priced.length),
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
  // Os preços já estão em centavos: iguais na tela são o mesmo preço, e a linha é reta.
  const spread = range.highest.price - range.lowest.price;
  return sorted.map((p, index) => ({
    key: p.key,
    x: days > 0 ? diffDays(firstDay, p.day) / days : 0.5,
    // Nunca fora da área do desenho.
    y: spread > 0 ? Math.min(1, Math.max(0, (p.price - range.lowest.price) / spread)) : 0.5,
    latest: index === sorted.length - 1,
  }));
}

export interface PriceChart {
  points: ChartPoint[];
  /** O menor e o maior preço, escritos à esquerda (iguais quando o preço não variou). */
  lowLabel: string;
  highLabel: string;
  /** O preço não variou: uma linha reta a meia altura, com um preço só à esquerda. */
  flat: boolean;
  /** A primeira e a última data, embaixo. */
  firstDate: string;
  lastDate: string;
  /** O mesmo em palavras, para leitor de tela. */
  label: string;
}

/**
 * O gráfico do preço ao longo do tempo, só das compras com preço. null sem
 * elas em pelo menos dois dias diferentes: com uma compra (ou várias no mesmo
 * dia) não há linha do tempo a desenhar, e o resumo e a lista bastam.
 */
export function priceChart(purchases: Purchase[], { productName, today }: { productName: string; today: string }): PriceChart | null {
  const priced = purchases.filter(isPriced);
  const points = chartPoints(priced);
  const range = priceRange(priced);
  if (!range || !points.some((p) => p.x !== points[0].x)) return null;
  const sorted = [...priced].sort(newestFirst);
  const last = sorted[0];
  const firstDate = formatShortDate(sorted[sorted.length - 1].day, yearOf(today));
  const lastDate = formatShortDate(last.day, yearOf(today));
  const lowLabel = formatBRL(range.lowest.price);
  const highLabel = formatBRL(range.highest.price);
  const flat = range.lowest.price === range.highest.price;
  const prices = flat ? `sempre ${lowLabel}` : `de ${lowLabel} a ${highLabel}; o último, ${formatBRL(last.price)}`;
  return { points, lowLabel, highLabel, flat, firstDate, lastDate, label: `Preço de ${productName} de ${firstDate} a ${lastDate}: ${prices}` };
}

// ---------------------------------------------------------------------------
// As compras, uma por linha

export interface PurchaseRow {
  key: string;
  /** A nota que a linha abre. */
  receiptId: string;
  /** O mercado. */
  title: string;
  /** "10 out · 2 un · pagou R$ 51,80" (com o ano quando não é o de hoje); "10 out · 2 un · sem valor" na compra sem valor. */
  detail: string;
  /** O preço impresso: "R$ 25,90/un"; "sem valor" quando a compra não tem preço. */
  price: string;
  /** Na compra comparada pelo tamanho, a embalagem e o preço que se compara: "5 kg · R$ 4,98/kg" ("5 kg" sem valor); senão, null. */
  size: string | null;
  priced: boolean;
  discounted: boolean;
}

/** O que a linha diz no lugar do preço (e do que foi pago) na compra sem valor. */
export const NO_VALUE = 'sem valor';

export function purchaseRow(purchase: Purchase, today: string): PurchaseRow {
  const priced = isPriced(purchase);
  // Sem preço e sem nada pago, "pagou R$ 0,00" seria dar um valor que a nota não tem.
  const paid = priced || cents(purchase.paid) > 0 ? `pagou ${formatBRL(purchase.paid)}` : NO_VALUE;
  return {
    key: purchase.key,
    receiptId: purchase.receiptId,
    title: purchase.storeName,
    detail: `${formatShortDate(purchase.day, yearOf(today))} · ${formatQuantity(purchase.quantity, purchase.unit)} · ${paid}`,
    // O preço da direita é o impresso, por embalagem; o que se compara (por kg, litro ou item) vem na linha do tamanho.
    price: priced ? perUnit(purchase.packagePrice == null ? purchase : { price: purchase.packagePrice, baseUnit: 'un' }) : NO_VALUE,
    size: purchase.packagePrice != null && purchase.pack ? (priced ? `${purchase.pack.label} · ${perUnit(purchase)}` : purchase.pack.label) : null,
    priced,
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

/**
 * O mesmo botão para o leitor de tela, que diz de qual lista ele é (a tela do produto tem outros "Ver mais"). Começa
 * pelo texto do botão inteiro, como ele aparece: quem usa o controle por voz diz o que está vendo.
 */
export function moreAccessibilityLabel(left: number): string | null {
  const label = moreLabel(left);
  return label && `${label} do histórico de preço`;
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
  /** A primeira frase do resumo é a última compra (em destaque); falso quando o resumo é só um aviso. */
  headline: boolean;
  chart: PriceChart | null;
  rows: PurchaseRow[];
  /** "Ver mais (faltam 12)", ou null com todas as compras à vista. */
  more: string | null;
  /** O que o leitor de tela diz nesse botão. */
  moreAccessibilityLabel: string | null;
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
  // O mercado escolhido que saiu de vista (outro período, outra unidade) volta a "Todos" (e chooseInHistory o esquece).
  const store = stores.some((s) => s.value === choices.store) ? choices.store! : ALL_STORES;
  const shown = store === ALL_STORES ? ofPeriod : ofPeriod.filter((p) => p.store === store);
  const visible = shown.slice(0, ROWS_AT_FIRST + Math.max(0, choices.more) * ROWS_PER_MORE);
  const left = shown.length - visible.length;
  return {
    units: allUnits.length > 1 ? allUnits.map((value) => ({ value, label: unitLabel(value) })) : [],
    unit,
    periods: PERIODS.map(({ value, label }) => ({ value, label })),
    period,
    stores,
    store,
    summary: summarize(shown, { period, today }),
    headline: shown.some(isPriced),
    chart: priceChart(shown, { productName, today }),
    rows: visible.map((p) => purchaseRow(p, today)),
    more: moreLabel(left),
    moreAccessibilityLabel: moreAccessibilityLabel(left),
  };
}

/**
 * As escolhas depois de um toque (outra unidade, outro período, outro
 * mercado). A lista volta às primeiras compras, e o mercado guardado é o que
 * a seção de fato vai mostrar: se o escolhido saiu de vista (sem compra na
 * nova unidade ou no novo período), a escolha é esquecida, e ele não volta
 * sozinho num toque seguinte.
 */
export function chooseInHistory(
  purchases: Purchase[],
  choices: HistoryChoices,
  choice: Partial<Pick<HistoryChoices, 'unit' | 'period' | 'store'>>,
  context: { today: string; productName: string },
): HistoryChoices {
  const next = { ...choices, ...choice, more: 0 };
  const view = priceHistoryView(purchases, next, context);
  return { ...next, store: !view || view.store === ALL_STORES ? null : view.store };
}
