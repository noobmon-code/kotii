import { assertEquals } from '@std/assert';

import { accessKeyCheckDigit, cnpjFromAccessKey, isValidAccessKey, isValidCnpj } from './fiscalIds.ts';

// Chave fictícia com o verificador certo, do CNPJ 11.222.333/0001-81 (também válido).
const KEY = '35261011222333000181650010000123451000012341';

Deno.test('isValidAccessKey: 44 dígitos e o verificador certo', () => {
  assertEquals(accessKeyCheckDigit(KEY.slice(0, 43)), 1);
  assertEquals(isValidAccessKey(KEY), true);
  // Um dígito trocado, o verificador errado, curta ou com espaço: não.
  assertEquals(isValidAccessKey(`${KEY.slice(0, 30)}9${KEY.slice(31)}`), false);
  assertEquals(isValidAccessKey(`${KEY.slice(0, 43)}7`), false);
  assertEquals(isValidAccessKey(KEY.slice(1)), false);
  assertEquals(isValidAccessKey(`${KEY.slice(0, 20)} ${KEY.slice(20)}`), false);
});

Deno.test('isValidCnpj: os dois verificadores do módulo 11', () => {
  assertEquals(isValidCnpj('11222333000181'), true);
  assertEquals(isValidCnpj('12345678000195'), true);
  assertEquals(isValidCnpj('11222333000182'), false, 'segundo verificador errado');
  assertEquals(isValidCnpj('11222333000171'), false, 'primeiro verificador errado');
  assertEquals(isValidCnpj('11222343000181'), false, 'um dígito lido errado');
  assertEquals(isValidCnpj('00000000000000'), false, 'passa na conta, mas não é CNPJ');
  assertEquals(isValidCnpj('1122233300018'), false);
  assertEquals(isValidCnpj('11.222.333/0001-81'), false, 'só dígitos');
});

Deno.test('cnpjFromAccessKey: o CNPJ de dentro da chave válida, se ele passar no verificador', () => {
  assertEquals(cnpjFromAccessKey(KEY), '11222333000181');
  assertEquals(cnpjFromAccessKey(`${KEY.slice(0, 43)}7`), null);
  assertEquals(cnpjFromAccessKey(null), null);
  // Chave válida com um CNPJ que não passa no verificador (12.345.678/0001-90).
  assertEquals(cnpjFromAccessKey('25260912345678000190650010000123451000012347'), null);
});
