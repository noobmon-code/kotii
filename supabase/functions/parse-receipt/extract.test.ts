import { assertEquals } from '@std/assert';

import { cleanReceipt, type ExtractedReceipt } from './extract.ts';

const base: ExtractedReceipt = {
  is_receipt: true,
  store_name: ' Mercado Bom ',
  cnpj: '12.345.678/0001-99',
  address: null,
  purchased_at: '2026-09-20T10:15:00-03:00',
  access_key: '3526 0912 3456 7800 0199 6500 1000 0012 3410 0012 3456',
  total: 30.5,
  items: [
    {
      raw_description: 'ARROZ T.JOAO 5KG',
      normalized_name: 'Arroz Tio João 5kg',
      category: 'graos',
      quantity: 1,
      unit: 'un',
      unit_price: 25,
      total_price: 25,
      matched_product_id: 'invented-id',
    },
    {
      raw_description: 'BANANA PRATA',
      normalized_name: 'Banana prata',
      category: 'hortifruti',
      quantity: 0.535,
      unit: 'kg',
      unit_price: 0,
      total_price: 3.21,
      matched_product_id: 'p-banana',
    },
    {
      raw_description: '   ',
      normalized_name: '',
      category: 'outros',
      quantity: 1,
      unit: 'un',
      unit_price: 1,
      total_price: 1,
      matched_product_id: null,
    },
  ],
};

Deno.test('cleans identifiers, dates and items', () => {
  const r = cleanReceipt(base, new Set(['p-banana', 'p-arroz']), new Map([['ARROZ T.JOAO 5KG', 'p-arroz']]));
  assertEquals(r.storeName, 'Mercado Bom');
  assertEquals(r.cnpj, '12345678000199');
  assertEquals(r.accessKey, '35260912345678000199650010000012341000123456');
  assertEquals(r.purchasedAt, '2026-09-20T13:15:00.000Z');
  assertEquals(r.items.length, 2, 'blank line dropped');
  assertEquals(r.items[0].product_id, 'p-arroz', 'alias wins over model suggestion');
  assertEquals(r.items[1].product_id, 'p-banana', 'valid model suggestion kept');
  assertEquals(r.items[1].unit_price, 6, 'unit price derived from total / weight');
});

Deno.test('drops invalid identifiers and unknown product ids', () => {
  const r = cleanReceipt(
    { ...base, cnpj: '123', access_key: null, purchased_at: 'ontem' },
    new Set(),
    new Map(),
  );
  assertEquals(r.cnpj, null);
  assertEquals(r.accessKey, null);
  assertEquals(r.purchasedAt, null);
  assertEquals(r.items[0].product_id, null);
});
