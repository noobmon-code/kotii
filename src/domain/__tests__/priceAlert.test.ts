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
    expect(alerts.get('i1')).toEqual({ kind: 'cheaper_elsewhere', storeId: 's-assai', price: 16.9, unit: 'un', on: '2026-09-10', saving: 6.2 });
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
    expect(alerts.get('i1')).toEqual({ kind: 'above_usual', usual: 19.9, unit: 'un', percent: 21, saving: 8.2 });
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
    expect(describePriceAlert({ kind: 'cheaper_elsewhere', storeId: 's', price: 16.9, unit: 'un', on: '2026-09-10', saving: 6.2 }, 'Assaí', 2026)).toBe(
      'R$ 16,90 no Assaí em 10 set',
    );
    expect(describePriceAlert({ kind: 'above_usual', usual: 19.9, unit: 'un', percent: 21, saving: 8.2 }, undefined)).toBe(
      '21% acima do costume (R$ 19,90)',
    );
  });
});

describe('priceAlerts com tamanhos e unidades diferentes', () => {
  const rice = (partial: Partial<AlertItem>) => item({ productId: 'p-arroz', quantity: 1, ...partial });
  const ricePoint = (store_id: string, unit_price: number, day: string, description: string) =>
    point(store_id, unit_price, day, { product_id: 'p-arroz', description });

  it('o pacote de 5 kg não é comparado com o preço do pacote de 1 kg', () => {
    const alerts = priceAlerts(
      [rice({ unitPrice: 24.9, description: 'ARROZ T1 5KG' })],
      [ricePoint('s-dia', 5.49, '2026-09-20', 'ARROZ T1 1KG'), ricePoint('s-dia', 5.59, '2026-09-01', 'ARROZ T1 1KG')],
      RECEIPT,
    );
    // R$ 4,98 o kg nesta nota, contra R$ 5,49 o kg no Dia: não há o que avisar (antes: "R$ 5,49 no Dia").
    expect(alerts.size).toBe(0);
  });

  it('o pacote de 1 kg avisa do de 5 kg mais barato, pelo preço por kg', () => {
    const alerts = priceAlerts(
      [rice({ unitPrice: 7.49, quantity: 2, description: 'ARROZ T1 1KG' })],
      [ricePoint('s-assai', 24.9, '2026-09-20', 'ARROZ T1 5KG')],
      RECEIPT,
    );
    const alert = alerts.get('i1')!;
    expect(alert).toEqual({ kind: 'cheaper_elsewhere', storeId: 's-assai', price: 4.98, unit: 'kg', on: '2026-09-20', saving: 5.02 });
    expect(describePriceAlert(alert, 'Assaí', 2026)).toBe('R$ 4,98/kg no Assaí em 20 set');
  });

  it('acima do costume, pelo preço por kg, com a economia na quantidade da nota', () => {
    const alerts = priceAlerts(
      [rice({ unitPrice: 32.9, description: 'ARROZ T1 5KG' })],
      [
        ricePoint('s-here', 5.49, '2026-08-01', 'ARROZ T1 1KG'),
        ricePoint('s-here', 5.59, '2026-08-20', 'ARROZ T1 1KG'),
        ricePoint('s-here', 5.39, '2026-09-10', 'ARROZ T1 1KG'),
      ],
      RECEIPT,
    );
    const alert = alerts.get('i1')!;
    // R$ 6,58 o kg contra R$ 5,49 de costume: 5 kg x R$ 1,09.
    expect(alert).toEqual({ kind: 'above_usual', usual: 5.49, unit: 'kg', percent: 20, saving: 5.45 });
    expect(describePriceAlert(alert, undefined)).toBe('20% acima do costume (R$ 5,49/kg)');
  });

  it('a linha em g se compara com a de kg, por kg', () => {
    const cheese = item({ productId: 'p-queijo', unit: 'g', unitPrice: 0.0459, quantity: 500 });
    const alerts = priceAlerts([cheese], [point('s-assai', 39.9, '2026-09-20', { product_id: 'p-queijo', unit: 'kg' })], RECEIPT);
    expect(alerts.get('i1')).toEqual({ kind: 'cheaper_elsewhere', storeId: 's-assai', price: 39.9, unit: 'kg', on: '2026-09-20', saving: 3 });
  });

  it('um tamanho só: segue pelo preço da embalagem, como antes', () => {
    const alerts = priceAlerts(
      [rice({ unitPrice: 29.9, description: 'ARROZ T1 5KG' })],
      [ricePoint('s-assai', 24.9, '2026-09-20', 'ARROZ TIPO 1 5 KG')],
      RECEIPT,
    );
    expect(alerts.get('i1')).toEqual({ kind: 'cheaper_elsewhere', storeId: 's-assai', price: 24.9, unit: 'un', on: '2026-09-20', saving: 5 });
    expect(describePriceAlert(alerts.get('i1')!, 'Assaí', 2026)).toBe('R$ 24,90 no Assaí em 20 set');
  });

  it('o pacote de tamanho conhecido não se compara com o preço por kg de outro produto nem com outra unidade', () => {
    const alerts = priceAlerts(
      [rice({ unitPrice: 24.9, description: 'ARROZ T1 5KG' }), item({ id: 'i2', productId: 'p-banana', unit: 'un', unitPrice: 9.9 })],
      [point('s-assai', 6.99, '2026-09-20', { product_id: 'p-banana', unit: 'kg' })],
      RECEIPT,
    );
    expect(alerts.size).toBe(0);
  });
});
