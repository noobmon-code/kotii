import { assertEquals } from '@std/assert';

import { MAX_STORE_CODE, storeCodeKey } from './storeCode.ts';

// Os mesmos casos do teste do banco (store_code_key em scripts/db/test.sql).
Deno.test('storeCodeKey: maiúsculas, sem acento, só letras e dígitos, de 1 a 60', () => {
  assertEquals(storeCodeKey(' 250474 '), '250474');
  assertEquals(storeCodeKey('(Código: 250474)'), 'CODIGO250474');
  assertEquals(storeCodeKey('ab-12/ç'), 'AB12C');
  assertEquals(storeCodeKey('ß1'), '1');
  assertEquals(storeCodeKey('9'.repeat(MAX_STORE_CODE)), '9'.repeat(MAX_STORE_CODE));
  assertEquals(storeCodeKey('9'.repeat(MAX_STORE_CODE + 1)), null);
  assertEquals(storeCodeKey(''), null);
  assertEquals(storeCodeKey(' -/ '), null);
  assertEquals(storeCodeKey(null), null);
  assertEquals(storeCodeKey(undefined), null);
});
