// Alerta de preço na nota: compara o que se pagou em cada item com o
// histórico da casa (mesmo produto, mesma unidade). Dois avisos:
// - mais barato em outro mercado, numa compra recente de lá;
// - bem acima do que a casa costuma pagar (mediana dos últimos meses).

import { addDays, formatShortDate } from './dates';
import { formatBRL } from './money';

/** Olha preços de até 90 dias antes da compra; de outro mercado, só dos últimos 60. */
const HISTORY_DAYS = 90;
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
}

export interface PricePoint {
  product_id: string;
  store_id: string;
  unit: string;
  unit_price: number;
  purchased_at: string;
  receipt_id: string;
}

export type PriceAlert =
  | { kind: 'cheaper_elsewhere'; storeId: string; price: number; on: string; saving: number }
  | { kind: 'above_usual'; usual: number; percent: number; saving: number };

const round2 = (value: number) => Math.round(value * 100) / 100;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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
  const since = addDays(purchasedOn, -HISTORY_DAYS);
  const otherSince = addDays(purchasedOn, -OTHER_STORE_DAYS);
  const alerts = new Map<string, PriceAlert>();

  for (const item of items) {
    if (!(item.unitPrice > 0)) continue;
    const points = history.filter((p) => {
      const day = p.purchased_at.slice(0, 10);
      return p.product_id === item.productId && p.unit === item.unit && p.receipt_id !== receiptId && day >= since && day <= purchasedOn;
    });
    if (!points.length) continue;

    // Outro mercado: o preço mais recente de cada um; vale o mais barato.
    const latestByStore = new Map<string, PricePoint>();
    for (const point of points) {
      if (point.store_id === storeId || point.purchased_at.slice(0, 10) < otherSince) continue;
      const current = latestByStore.get(point.store_id);
      if (!current || point.purchased_at > current.purchased_at) latestByStore.set(point.store_id, point);
    }
    const cheapest = [...latestByStore.values()].sort((a, b) => a.unit_price - b.unit_price)[0];
    if (cheapest) {
      const saving = round2((item.unitPrice - cheapest.unit_price) * item.quantity);
      if (cheapest.unit_price <= item.unitPrice * (1 - CHEAPER_BY) && saving >= MIN_SAVING) {
        alerts.set(item.id, {
          kind: 'cheaper_elsewhere',
          storeId: cheapest.store_id,
          price: cheapest.unit_price,
          on: cheapest.purchased_at.slice(0, 10),
          saving,
        });
        continue;
      }
    }

    const usual = round2(median(points.map((p) => p.unit_price)));
    const saving = round2((item.unitPrice - usual) * item.quantity);
    if (item.unitPrice >= usual * (1 + ABOVE_BY) && saving >= MIN_SAVING) {
      alerts.set(item.id, { kind: 'above_usual', usual, percent: Math.round((item.unitPrice / usual - 1) * 100), saving });
    }
  }
  return alerts;
}

/** Quanto daria para economizar somando os avisos. */
export function totalSaving(alerts: Map<string, PriceAlert>): number {
  return round2([...alerts.values()].reduce((sum, alert) => sum + alert.saving, 0));
}

/** "R$ 16,90 no Assaí em 10 set" ou "21% acima do costume (R$ 19,90)". */
export function describePriceAlert(alert: PriceAlert, storeName: string | undefined, referenceYear?: number): string {
  if (alert.kind === 'cheaper_elsewhere') {
    return `${formatBRL(alert.price)} no ${storeName ?? 'outro mercado'} em ${formatShortDate(alert.on, referenceYear)}`;
  }
  return `${alert.percent}% acima do costume (${formatBRL(alert.usual)})`;
}
