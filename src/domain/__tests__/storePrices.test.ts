import { describe, expect, it } from '@jest/globals';

import { formatShortDate } from '../dates';
import { PACK_ITEM, type PurchaseLine } from '../priceHistory';
import {
  latestByStore,
  storePriceDetail,
  storePriceGroups,
  storePriceLabel,
  storePricesFromPurchases,
  storePricesFromSaved,
  storePricesView,
  type SavedPrice,
  type StorePrice,
} from '../storePrices';

const at = (day: string, time = '15:00') => new Date(`${day}T${time}:00`).toISOString();
const price = (storeId: string, unitPrice: number, day: string, unit = 'un', pack: Partial<StorePrice> = {}): StorePrice => ({
  storeId,
  unit,
  unitPrice,
  purchasedAt: at(day),
  packLabel: null,
  packagePrice: null,
  ...pack,
});

let serial = 0;
function line(storeId: string | null, unitPrice: number, day: string, patch: Partial<PurchaseLine> = {}): PurchaseLine {
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
    ...patch,
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

  it('dos guardados no aparelho: só os do produto, e o preço de cada unidade à parte', () => {
    const rows = [
      saved('arroz', 'assai', 25.9, '2026-10-10'),
      saved('arroz', 'assai', 5.5, '2026-08-01', 'kg'),
      saved('arroz', 'dia', 24.5, '2026-09-01'),
      saved('leite', 'assai', 3.99, '2026-10-10'),
    ];
    expect(storePriceGroups(storePricesFromSaved(rows, 'arroz'))).toEqual([
      { unit: 'un', title: 'Por unidade', prices: [price('dia', 24.5, '2026-09-01'), price('assai', 25.9, '2026-10-10')] },
      { unit: 'kg', title: 'Por kg', prices: [price('assai', 5.5, '2026-08-01', 'kg')] },
    ]);
    expect(storePricesFromSaved(rows, 'feijao')).toEqual([]);
  });

  it('dos guardados no aparelho: a cartela de 30 e a de 10 se comparam por ovo, como no histórico (o mesmo que online)', () => {
    const rows = [
      { ...saved('ovos', 'assai', 13.99, '2026-10-10'), pack_count: 10 },
      { ...saved('ovos', 'atacadao', 36.9, '2026-10-11'), pack_count: 30 },
    ];
    const online = storePricesFromPurchases([
      line('assai', 13.99, '2026-10-10', { packCount: 10 }),
      line('atacadao', 36.9, '2026-10-11', { packCount: 30 }),
    ]);
    const offline = storePricesFromSaved(rows, 'ovos');
    expect(offline).toEqual(online);
    expect(offline.map((p) => [p.storeId, p.unitPrice, p.unit])).toEqual([
      ['atacadao', 1.23, PACK_ITEM],
      ['assai', 1.4, PACK_ITEM],
    ]);
  });

  it('dos guardados no aparelho: g e kg na mesma conta, por kg (o tamanho do pacote ali não se sabe)', () => {
    const rows = [saved('queijo', 'assai', 0.0399, '2026-10-10', 'g'), saved('queijo', 'dia', 42.9, '2026-10-01', 'kg')];
    expect(storePricesFromSaved(rows, 'queijo')).toEqual([price('assai', 39.9, '2026-10-10', 'kg'), price('dia', 42.9, '2026-10-01', 'kg')]);
  });
});

describe('só se compara o que está na mesma unidade', () => {
  it('pacotes de 5 kg e de 1 kg: pelo preço por kg, e o de 5 kg é o mais barato', () => {
    const byStore = storePricesFromPurchases([
      line('assai', 24.9, '2026-10-10', { description: 'ARROZ T1 5KG' }),
      line('dia', 5.49, '2026-10-12', { description: 'ARROZ T1 1KG' }),
    ]);
    expect(storePriceGroups(byStore)).toEqual([
      {
        unit: 'kg',
        title: 'Por kg',
        prices: [
          price('assai', 4.98, '2026-10-10', 'kg', { packLabel: '5 kg', packagePrice: 24.9 }),
          price('dia', 5.49, '2026-10-12', 'kg', { packLabel: '1 kg', packagePrice: 5.49 }),
        ],
      },
    ]);
    expect(storePriceLabel(byStore[0])).toBe('R$ 4,98/kg');
    expect(storePriceDetail(byStore[0])).toBe(`5 kg por R$ 24,90 · em ${formatShortDate('2026-10-10')}`);
  });

  it('kg e unidade não se comparam: cada um na sua lista, sem "Mais barato" entre eles', () => {
    const groups = storePriceGroups(
      storePricesFromPurchases([
        line('assai', 6.99, '2026-10-10', { unit: 'kg', description: 'BANANA PRATA KG' }),
        line('dia', 1.2, '2026-10-12', { description: 'BANANA PRATA UN' }),
        line('carrefour', 7.49, '2026-10-05', { unit: 'kg', description: 'BANANA PRATA' }),
      ]),
    );
    expect(groups.map((group) => [group.title, group.prices.map((p) => `${p.storeId} ${storePriceLabel(p)}`)])).toEqual([
      ['Por kg', ['assai R$ 6,99/kg', 'carrefour R$ 7,49/kg']],
      ['Por unidade', ['dia R$ 1,20/un']],
    ]);
  });

  it('a linha em g aparece por kg, junto com a de kg', () => {
    const byStore = storePricesFromPurchases([
      line('assai', 0.0399, '2026-10-10', { unit: 'g', quantity: 300, description: 'QUEIJO MUSSARELA' }),
      line('dia', 42.9, '2026-10-12', { unit: 'kg', description: 'QUEIJO MUSSARELA KG' }),
    ]);
    expect(byStore.map(storePriceLabel)).toEqual(['R$ 39,90/kg', 'R$ 42,90/kg']);
    expect(storePriceGroups(byStore)).toHaveLength(1);
  });

  it('um tamanho só: segue o preço do pacote, que já se compara, com o tamanho embaixo', () => {
    const byStore = storePricesFromPurchases([
      line('assai', 24.9, '2026-10-10', { description: 'ARROZ T1 5KG' }),
      line('dia', 26.5, '2026-10-12', { description: 'ARROZ TIPO 1 5 KG' }),
    ]);
    expect(byStore).toEqual([
      price('assai', 24.9, '2026-10-10', 'un', { packLabel: '5 kg' }),
      price('dia', 26.5, '2026-10-12', 'un', { packLabel: '5 kg' }),
    ]);
    expect(storePriceDetail(byStore[0])).toBe(`5 kg · em ${formatShortDate('2026-10-10')}`);
  });

  it('o mesmo mercado com preço por kg e por unidade aparece nas duas listas', () => {
    const groups = storePriceGroups([price('assai', 6.99, '2026-10-10', 'kg'), price('assai', 1.2, '2026-09-01'), price('dia', 1.5, '2026-10-01')]);
    expect(groups.map((group) => group.prices.map((p) => p.storeId))).toEqual([['assai', 'dia'], ['assai']]);
  });

  it('por item do pacote: "cada"', () => {
    const byStore = storePricesFromPurchases([
      line('assai', 9.9, '2026-10-10', { description: 'OVOS BRANCOS C/12' }),
      line('dia', 21, '2026-10-12', { description: 'OVOS BRANCOS C/30' }),
    ]);
    expect(byStore.map(storePriceLabel)).toEqual(['R$ 0,70 cada', 'R$ 0,83 cada']);
    expect(storePriceGroups(byStore)[0].title).toBe('Por item do pacote');
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
