import { describe, expect, it } from '@jest/globals';

import { MAX_STORE_CODE as SERVER_MAX, storeCodeKey as serverKey } from '../../../supabase/functions/_shared/storeCode';
import { MAX_STORE_CODE, storeCodeKey } from '../storeCode';

// O app (QR code) e as funções (QR e foto) gravam o código já pela chave do banco (store_code_key). Se as duas
// cópias divergirem, a mesma linha ganha códigos diferentes conforme quem a leu, e a casa deixa de reconhecer
// o produto (ou o banco recusa a linha).
const SAMPLES = [
  '250474',
  ' 250474 ',
  '(Código: 250474 )',
  '7891000100103',
  '0007891000100103',
  'ab-12/ç',
  'ÁÉÍÓÚ âêô ãõ àü ñ',
  'ß1',
  'Æ1ø2',
  '１２３',
  'x'.repeat(MAX_STORE_CODE),
  'x'.repeat(MAX_STORE_CODE + 1),
  `${'9'.repeat(MAX_STORE_CODE)}-`,
  '',
  '   ',
  '---',
  'P-123.4/5',
  'código\ninterno\t42',
];

describe('storeCodeKey', () => {
  it('é a regra do banco: maiúsculas, sem acento, só letras e dígitos, de 1 a 60', () => {
    expect(storeCodeKey(' 250474 ')).toBe('250474');
    expect(storeCodeKey('(Código: 250474)')).toBe('CODIGO250474');
    expect(storeCodeKey('ab-12/ç')).toBe('AB12C');
    expect(storeCodeKey('ß1')).toBe('1');
    expect(storeCodeKey('9'.repeat(60))).toBe('9'.repeat(60));
    expect(storeCodeKey('9'.repeat(61))).toBeNull();
    expect(storeCodeKey('')).toBeNull();
    expect(storeCodeKey(' -/ ')).toBeNull();
    expect(storeCodeKey(null)).toBeNull();
    expect(storeCodeKey(undefined)).toBeNull();
  });

  it('o espelho das funções (QR e foto) dá a mesma chave', () => {
    expect(SERVER_MAX).toBe(MAX_STORE_CODE);
    for (const sample of [...SAMPLES, null, undefined]) {
      expect([sample, serverKey(sample)]).toEqual([sample, storeCodeKey(sample)]);
    }
  });

  it('a chave é sempre aceita pelo banco (check de receipt_items.store_code) e não muda de novo', () => {
    for (const sample of SAMPLES) {
      const key = storeCodeKey(sample);
      if (key === null) continue;
      expect(key).toMatch(/^[A-Z0-9]{1,60}$/);
      expect(storeCodeKey(key)).toBe(key);
    }
  });
});
