import { describe, expect, it } from '@jest/globals';

import type { PurchaseLine } from '../priceHistory';
import { latestByStore, storePricesFromPurchases, storePricesFromSaved, storePricesView, type SavedPrice, type StorePrice } from '../storePrices';

const at = (day: string, time = '15:00') => new Date(`${day}T${time}:00`).toISOString();
const price = (storeId: string, unitPrice: number, day: string, unit = 'un'): StorePrice => ({ storeId, unit, unitPrice, purchasedAt: at(day) });

let serial = 0;
function line(storeId: string | null, unitPrice: number, day: string): PurchaseLine {
  serial += 1;
  return {
    id: `i${serial}`,
    receiptId: `r${serial}`,
    storeId,
    storeName: storeId,
    purchasedAt: at(day),
    quantity: 1,
    unit: 'un',
    unitPrice,
    totalPrice: unitPrice,
  };
}

const saved = (product_id: string, store_id: string, unit_price: number, day: string, unit = 'un'): SavedPrice => ({
  product_id,
  store_id,
  unit,
  unit_price,
  purchased_at: at(day),
});

describe('o último preço de cada mercado', () => {
  it('a compra mais recente de cada mercado, do mais barato ao mais caro', () => {
    expect(
      latestByStore([price('assai', 25.9, '2026-10-10'), price('assai', 22.9, '2026-07-12'), price('dia', 24.5, '2026-09-01')]),
    ).toEqual([price('dia', 24.5, '2026-09-01'), price('assai', 25.9, '2026-10-10')]);
  });

  it('não depende da ordem em que as compras chegam', () => {
    const prices = [price('assai', 22.9, '2026-07-12'), price('dia', 24.5, '2026-09-01'), price('assai', 25.9, '2026-10-10')];
    expect(latestByStore(prices)).toEqual(latestByStore([...prices].reverse()));
  });

  it('zero não é preço: a compra de verdade anterior do mesmo mercado fica no lugar', () => {
    expect(latestByStore([price('assai', 0, '2026-10-10'), price('assai', 22.9, '2026-07-12')])).toEqual([price('assai', 22.9, '2026-07-12')]);
    expect(latestByStore([price('assai', 0, '2026-10-10')])).toEqual([]);
  });

  it('duas compras no mesmo instante: vale a mais barata, sempre a mesma', () => {
    const a = price('assai', 25.9, '2026-10-10');
    const b = price('assai', 24.9, '2026-10-10');
    expect(latestByStore([a, b])).toEqual([b]);
    expect(latestByStore([b, a])).toEqual([b]);
  });

  it('a nota sem mercado não entra (ela fica no histórico)', () => {
    expect(storePricesFromPurchases([line(null, 9.9, '2026-10-12'), line('assai', 25.9, '2026-10-10')])).toEqual([price('assai', 25.9, '2026-10-10')]);
  });

  it('das compras todas: um mercado com a última compra atrás de centenas de outras continua na lista', () => {
    const recent = Array.from({ length: 300 }, (_, n) => line('assai', 25 + (n % 10) / 10, `2026-10-${String(1 + (n % 28)).padStart(2, '0')}`));
    const byStore = storePricesFromPurchases([...recent, line('atacadao', 19.9, '2025-02-01')]);
    expect(byStore.map((p) => p.storeId)).toEqual(['atacadao', 'assai']);
  });

  it('dos guardados no aparelho: só os do produto, e o mais recente quando o mercado tem preço em duas unidades', () => {
    const rows = [
      saved('arroz', 'assai', 25.9, '2026-10-10'),
      saved('arroz', 'assai', 5.5, '2026-08-01', 'kg'),
      saved('arroz', 'dia', 24.5, '2026-09-01'),
      saved('leite', 'assai', 3.99, '2026-10-10'),
    ];
    expect(storePricesFromSaved(rows, 'arroz')).toEqual([price('dia', 24.5, '2026-09-01'), price('assai', 25.9, '2026-10-10')]);
    expect(storePricesFromSaved(rows, 'feijao')).toEqual([]);
  });
});

describe('de onde sai a lista', () => {
  const fromHistory = [price('assai', 25.9, '2026-10-10')];
  const onDevice = [saved('arroz', 'dia', 24.5, '2026-09-01')];

  it('com o histórico: ele, mesmo havendo preços guardados', () => {
    expect(storePricesView({ data: fromHistory, paused: false, failed: false }, onDevice, 'arroz')).toEqual({ prices: fromHistory, source: 'history' });
    // Uma atualização que falhou não tira da tela o histórico que já tinha chegado.
    expect(storePricesView({ data: fromHistory, paused: false, failed: true }, onDevice, 'arroz').source).toBe('history');
  });

  it('buscando, com internet: ainda não se sabe', () => {
    expect(storePricesView({ data: undefined, paused: false, failed: false }, onDevice, 'arroz')).toEqual({ prices: undefined, source: null });
  });

  it('sem internet: os guardados no aparelho, dizendo isso', () => {
    expect(storePricesView({ data: undefined, paused: true, failed: false }, onDevice, 'arroz')).toEqual({
      prices: [price('dia', 24.5, '2026-09-01')],
      source: 'saved-offline',
    });
    expect(storePricesView({ data: undefined, paused: true, failed: false }, undefined, 'arroz')).toEqual({ prices: [], source: 'saved-offline' });
  });

  it('a busca falhou: os guardados, com o outro aviso', () => {
    expect(storePricesView({ data: undefined, paused: false, failed: true }, onDevice, 'arroz').source).toBe('saved-error');
  });
});
