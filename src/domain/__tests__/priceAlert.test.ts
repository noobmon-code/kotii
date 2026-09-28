import { describe, expect, it } from '@jest/globals';

import { describePriceAlert, priceAlerts, totalSaving, type AlertItem, type PricePoint } from '../priceAlert';

const RECEIPT = { receiptId: 'r-now', storeId: 's-here', purchasedOn: '2026-09-27' };

const item = (partial: Partial<AlertItem> = {}): AlertItem => ({
  id: 'i1',
  productId: 'p-cafe',
  unit: 'un',
  unitPrice: 20,
  quantity: 2,
  ...partial,
});

const point = (store_id: string, unit_price: number, day: string, partial: Partial<PricePoint> = {}): PricePoint => ({
  product_id: 'p-cafe',
  store_id,
  unit: 'un',
  unit_price,
  purchased_at: `${day}T15:00:00.000Z`,
  receipt_id: `r-${store_id}-${day}`,
  ...partial,
});

describe('priceAlerts', () => {
  it('avisa quando outro mercado vendia mais barato há pouco tempo', () => {
    const alerts = priceAlerts([item()], [point('s-assai', 16.9, '2026-09-10'), point('s-atacadao', 17.5, '2026-09-20')], RECEIPT);
    expect(alerts.get('i1')).toEqual({ kind: 'cheaper_elsewhere', storeId: 's-assai', price: 16.9, on: '2026-09-10', saving: 6.2 });
  });

  it('usa o preço mais recente de cada mercado', () => {
    const alerts = priceAlerts(
      [item({ unitPrice: 19.8 })],
      [point('s-assai', 15, '2026-08-10'), point('s-assai', 19.5, '2026-09-20')],
      RECEIPT,
    );
    // O Assaí agora está a 19,50: não chega a 10% mais barato. E 19,80 fica abaixo de 15% sobre a mediana (17,25).
    expect(alerts.size).toBe(0);
  });

  it('avisa quando está bem acima do que a casa costuma pagar', () => {
    const alerts = priceAlerts(
      [item({ unitPrice: 24 })],
      [point('s-here', 19.9, '2026-08-01'), point('s-here', 20.5, '2026-08-20'), point('s-here', 19.5, '2026-09-10')],
      RECEIPT,
    );
    expect(alerts.get('i1')).toEqual({ kind: 'above_usual', usual: 19.9, percent: 21, saving: 8.2 });
  });

  it('ignora diferenças pequenas, outras unidades, esta nota, o que é antigo e o que é depois da compra', () => {
    const alerts = priceAlerts(
      [item({ unitPrice: 2.2, quantity: 1 }), item({ id: 'i2', unit: 'kg' })],
      [
        point('s-assai', 1.8, '2026-09-20'), // 40 centavos: pouco
        point('s-assai', 10, '2026-09-20', { unit: 'kg', receipt_id: 'r-now' }), // esta mesma nota
        point('s-assai', 10, '2026-05-01', { unit: 'kg' }), // antigo
        point('s-assai', 10, '2026-09-28', { unit: 'kg' }), // depois da compra
      ],
      RECEIPT,
    );
    expect(alerts.size).toBe(0);
  });

  it('soma quanto daria para economizar', () => {
    const alerts = priceAlerts(
      [item(), item({ id: 'i2', productId: 'p-leite', unitPrice: 6, quantity: 12 })],
      [point('s-assai', 16.9, '2026-09-10'), point('s-assai', 4.99, '2026-09-10', { product_id: 'p-leite' })],
      RECEIPT,
    );
    expect(totalSaving(alerts)).toBe(18.32);
  });

  it('descreve os avisos', () => {
    expect(describePriceAlert({ kind: 'cheaper_elsewhere', storeId: 's', price: 16.9, on: '2026-09-10', saving: 6.2 }, 'Assaí', 2026)).toBe(
      'R$ 16,90 no Assaí em 10 set',
    );
    expect(describePriceAlert({ kind: 'above_usual', usual: 19.9, percent: 21, saving: 8.2 }, undefined)).toBe(
      '21% acima do costume (R$ 19,90)',
    );
  });
});
