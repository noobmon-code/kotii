// Alerta de preço na nota: compara o que se pagou em cada item com o
// histórico da casa (mesmo produto, mesma unidade). Dois avisos:
// - mais barato em outro mercado, numa compra recente de lá;
// - bem acima do que a casa costuma pagar (mediana dos últimos meses).
// Os preços se comparam como no histórico do produto (toPurchases): g e kg
// por kg, ml e litro por litro, e pacotes de tamanhos diferentes ("ARROZ 5KG"
// e "ARROZ 1KG") pelo preço por kg, litro ou item, com o tamanho lido na
// descrição da nota (ou, sem ele, quantos vinham: na linha da nota, a contagem
// que a tela mostra, com o nome do produto; nos preços de antes, a resposta
// pack_count). Sem isso, a nota do pacote de 5 kg ouvia "R$ 5,49 no outro
// mercado" (o preço do pacote de 1 kg). Uma compra por unidade com tamanho
// conhecido não se compara com outra por unidade que não o tem: a cartela de 30
// não ouve "mais barato" de uma de preço sem tamanho.

import { addDays, formatShortDate, toISODate } from './dates';
import { formatBRL } from './money';
import { PACK_ITEM, toPurchases, type Purchase, type PurchaseLine } from './priceHistory';
import { convertQuantity } from './units';

/** Olha preços de até 90 dias antes da compra; de outro mercado, só dos últimos 60. */
export const PRICE_ALERT_HISTORY_DAYS = 90;
const OTHER_STORE_DAYS = 60;
/** Outro mercado pelo menos 10% mais barato, ou 15% acima do costume… */
const CHEAPER_BY = 0.1;
const ABOVE_BY = 0.15;
/** …e só se a diferença no item passar de 50 centavos. */
const MIN_SAVING = 0.5;

export interface AlertItem {
  id: string;
  productId: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  /** A descrição como veio na nota ("ARROZ T1 5KG"): o tamanho da embalagem. Sem ela e sem packCount, o tamanho não é conhecido. */
  description?: string;
  /**
   * Quantos vinham na embalagem, como a tela da nota mostra (packCountOf: o nome do produto, depois a resposta
   * pack_count): vale quando a descrição não diz o tamanho.
   */
  packCount?: number | null;
}

export interface PricePoint {
  product_id: string;
  store_id: string;
  unit: string;
  unit_price: number;
  purchased_at: string;
  receipt_id: string;
  /** A descrição da linha da nota, de onde sai o tamanho da embalagem. */
  description?: string;
  /** Quantos vinham na embalagem, respondido na revisão (pack_count), como em AlertItem. */
  packCount?: number | null;
}

/**
 * `unit`: a unidade em que os preços foram comparados (un, kg, l ou
 * PACK_ITEM); `price` e `usual` são por ela.
 */
export type PriceAlert =
  | { kind: 'cheaper_elsewhere'; storeId: string; price: number; unit: string; on: string; saving: number }
  | { kind: 'above_usual'; usual: number; unit: string; percent: number; saving: number };

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Dia da compra no fuso do aparelho (o banco guarda em UTC). */
const dayOf = (point: PricePoint) => toISODate(new Date(point.purchased_at));

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Um preço pronto para comparar: por `unit` (kg, l, un ou item do pacote). */
interface Compared {
  unit: string;
  price: number;
  /**
   * A compra tem tamanho de embalagem (na descrição ou na contagem: packCount): em "un", só se compara com outra
   * que também tem.
   */
  packed: boolean;
}

const lineKey = (receiptId: string, unit: string, unitPrice: number) => `${receiptId}|${unit}|${unitPrice}`;

/**
 * Os itens desta nota e os preços de antes, de um produto, levados à unidade
 * em que se comparam, com a mesma regra do histórico (toPurchases): a decisão
 * de comparar pelo tamanho olha todos juntos (dois tamanhos, ou o produto
 * também vendido a peso). Devolve, para cada item, o preço comparável e
 * quanto da unidade comparada vem em cada unidade da nota (5 no pacote de 5
 * kg; 0,001 na linha em g), para a economia sair em reais.
 */
function compare(
  items: AlertItem[],
  points: PricePoint[],
  receiptId: string,
  purchasedOn: string,
): { items: Map<string, Compared & { perUnit: number }>; points: (Compared & { point: PricePoint })[] } {
  const lines: PurchaseLine[] = [
    ...points.map((point, n) => ({
      id: `h${n}`,
      receiptId: point.receipt_id,
      storeId: point.store_id,
      storeName: point.store_id,
      purchasedAt: point.purchased_at,
      quantity: 1,
      unit: point.unit,
      unitPrice: point.unit_price,
      totalPrice: point.unit_price,
      description: point.description,
      packCount: point.packCount,
    })),
    ...items.map((item) => ({
      id: `i${item.id}`,
      receiptId,
      storeId: null,
      storeName: null,
      purchasedAt: `${purchasedOn}T12:00:00`,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      totalPrice: item.unitPrice * item.quantity,
      description: item.description,
      packCount: item.packCount,
    })),
  ];
  const purchases = new Map<string, Purchase>(toPurchases(lines).map((purchase) => [purchase.key, purchase]));
  const found = (key: string) => purchases.get(key)!;
  const compared = new Map<string, Compared & { perUnit: number }>();
  for (const item of items) {
    const purchase = found(lineKey(receiptId, item.unit, item.unitPrice));
    const perUnit = purchase.packagePrice != null && purchase.pack ? purchase.pack.amount : (convertQuantity(1, item.unit, purchase.baseUnit) ?? 1);
    compared.set(item.id, { unit: purchase.baseUnit, price: purchase.price, packed: purchase.pack != null, perUnit });
  }
  return {
    items: compared,
    points: points.map((point) => {
      const purchase = found(lineKey(point.receipt_id, point.unit, point.unit_price));
      return { point, unit: purchase.baseUnit, price: purchase.price, packed: purchase.pack != null };
    }),
  };
}

/**
 * Avisos por item (id do item → aviso). `purchasedOn` é a data da nota
 * (AAAA-MM-DD): só conta o que foi comprado antes dela, fora desta nota.
 */
export function priceAlerts(
  items: AlertItem[],
  history: PricePoint[],
  { receiptId, storeId, purchasedOn }: { receiptId: string; storeId: string | null; purchasedOn: string },
): Map<string, PriceAlert> {
  const since = addDays(purchasedOn, -PRICE_ALERT_HISTORY_DAYS);
  const otherSince = addDays(purchasedOn, -OTHER_STORE_DAYS);
  const alerts = new Map<string, PriceAlert>();

  const priced = items.filter((item) => item.unitPrice > 0);
  for (const productId of new Set(priced.map((item) => item.productId))) {
    const productItems = priced.filter((item) => item.productId === productId);
    const window = history.filter((p) => {
      const day = dayOf(p);
      return p.product_id === productId && p.receipt_id !== receiptId && day >= since && day <= purchasedOn;
    });
    if (!window.length) continue;
    const compared = compare(productItems, window, receiptId, purchasedOn);

    for (const item of productItems) {
      const mine = compared.items.get(item.id)!;
      if (!(mine.price > 0)) continue;
      // Em "un", a compra com tamanho de embalagem não se compara com a que não tem (a cartela de 30 e um preço sem quantos vinham).
      const points = compared.points.filter((p) => p.unit === mine.unit && (mine.unit !== 'un' || p.packed === mine.packed));
      if (!points.length) continue;
      // Quanto da unidade comparada o item levou: a economia é em reais, na quantidade da nota.
      const amount = item.quantity * mine.perUnit;

      // Outro mercado: o preço mais recente de cada um; vale o mais barato.
      const latestByStore = new Map<string, (typeof points)[number]>();
      for (const p of points) {
        if (p.point.store_id === storeId || dayOf(p.point) < otherSince) continue;
        const current = latestByStore.get(p.point.store_id);
        if (!current || p.point.purchased_at > current.point.purchased_at) latestByStore.set(p.point.store_id, p);
      }
      const cheapest = [...latestByStore.values()].sort((a, b) => a.price - b.price)[0];
      if (cheapest) {
        const saving = round2((mine.price - cheapest.price) * amount);
        if (cheapest.price <= mine.price * (1 - CHEAPER_BY) && saving >= MIN_SAVING) {
          alerts.set(item.id, {
            kind: 'cheaper_elsewhere',
            storeId: cheapest.point.store_id,
            price: cheapest.price,
            unit: mine.unit,
            on: dayOf(cheapest.point),
            saving,
          });
          continue;
        }
      }

      const usual = round2(median(points.map((p) => p.price)));
      const saving = round2((mine.price - usual) * amount);
      if (mine.price >= usual * (1 + ABOVE_BY) && saving >= MIN_SAVING) {
        alerts.set(item.id, { kind: 'above_usual', usual, unit: mine.unit, percent: Math.round((mine.price / usual - 1) * 100), saving });
      }
    }
  }
  return alerts;
}

/** Quanto daria para economizar somando os avisos. */
export function totalSaving(alerts: Map<string, PriceAlert>): number {
  return round2([...alerts.values()].reduce((sum, alert) => sum + alert.saving, 0));
}

/** "R$ 16,90" por unidade (como sempre foi), "R$ 4,98/kg", "R$ 0,83 cada" (item do pacote). */
function priceText(price: number, unit: string): string {
  if (unit === 'un') return formatBRL(price);
  return unit === PACK_ITEM ? `${formatBRL(price)} cada` : `${formatBRL(price)}/${unit}`;
}

/** "R$ 16,90 no Assaí em 10 set" ou "21% acima do costume (R$ 19,90)"; por kg, "R$ 4,98/kg no Assaí em 10 set". */
export function describePriceAlert(alert: PriceAlert, storeName: string | undefined, referenceYear?: number): string {
  if (alert.kind === 'cheaper_elsewhere') {
    return `${priceText(alert.price, alert.unit)} no ${storeName ?? 'outro mercado'} em ${formatShortDate(alert.on, referenceYear)}`;
  }
  return `${alert.percent}% acima do costume (${priceText(alert.usual, alert.unit)})`;
}
