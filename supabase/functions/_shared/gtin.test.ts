import { assertEquals } from '@std/assert';

import { gtinKey } from './gtin.ts';

// Os mesmos casos do teste do banco (gtin_key em scripts/db/test.sql).
Deno.test('gtinKey: os 14 dígitos do código de barras válido, fora das faixas restritas', () => {
  assertEquals(gtinKey('7891000100103'), '07891000100103');
  assertEquals(gtinKey('7891000100104'), null);
  assertEquals(gtinKey('96385074'), '00000096385074');
  assertEquals(gtinKey('01234565'), null);
  assertEquals(gtinKey('20000004'), null);
  assertEquals(gtinKey('2000000000008'), null);
  assertEquals(gtinKey('036000291452'), '00036000291452');
  assertEquals(gtinKey('212345678992'), null);
  assertEquals(gtinKey('0212345678992'), null);
  assertEquals(gtinKey('412345678996'), null);
  assertEquals(gtinKey('9800000000007'), null);
  assertEquals(gtinKey('9900000000004'), null);
  assertEquals(gtinKey('17891000100100'), '17891000100100');
  assertEquals(gtinKey('97891000100106'), null);
  assertEquals(gtinKey('07891000100103'), '07891000100103');
  assertEquals(gtinKey('789100010010A'), null);
  // O código interno do mercado não é código de barras.
  assertEquals(gtinKey('250474'), null);
  assertEquals(gtinKey('MC12'), null);
  assertEquals(gtinKey('1234567890'), null);
  assertEquals(gtinKey(' 7891000100103'), null);
  assertEquals(gtinKey(null), null);
  assertEquals(gtinKey(undefined), null);
});

Deno.test('gtinKey: a chave da chave é ela mesma', () => {
  for (const code of ['7891000100103', '96385074', '036000291452', '17891000100100']) {
    const key = gtinKey(code)!;
    assertEquals(key.length, 14);
    assertEquals(gtinKey(key), key);
  }
});
