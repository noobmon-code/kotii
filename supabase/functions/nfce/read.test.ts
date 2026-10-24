import { assertEquals } from '@std/assert';

import type { NfcePage } from './parse.ts';
import { nfceRead } from './read.ts';

const KEY = '35261011222333000181650010000123451000012341';
const OTHER_KEY = '35261099888777000166650010000123451000012348';
const QR = `https://www.nfce.fazenda.sp.gov.br/qrcode?p=${KEY}|2|1|1|HASH`;
const PAGE_URL = 'https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx';

const PAGE: NfcePage = {
  store: { name: 'ATACADAO MOOCA', cnpj: null, address: null },
  issuedAtLocal: '2026-10-09T18:30:00',
  total: 9,
  items: [{ description: 'LEITE  INTEGRAL 1L', code: null, quantity: 2, unit: 'UN', unitPrice: 4.5, totalPrice: 9 }],
};

const ok = (accessKey: string | null, fetched = [QR, PAGE_URL], pageUrl = PAGE_URL, page = PAGE) =>
  ({ kind: 'ok' as const, page, fetched, pageUrl, accessKey });

Deno.test('nfceRead: a chave do link igual à da página fica, e o CNPJ sai dela', () => {
  assertEquals(nfceRead(ok(KEY), QR, 'h1'), {
    household_id: 'h1',
    source: 'qrcode',
    access_key: KEY,
    store_cnpj: '11222333000181',
    store_name: 'ATACADAO MOOCA',
    purchased_on: '2026-10-09',
    lines: [{ description: 'LEITE INTEGRAL 1L', unit: 'un', unit_price: 4.5 }],
  });
});

Deno.test('nfceRead: a página com outra chave, ou sem chave, deixa a leitura sem chave (sem estado e sem o CNPJ dela)', () => {
  for (const pageKey of [OTHER_KEY, null]) {
    const read = nfceRead(ok(pageKey), QR, 'h1');
    assertEquals([read?.access_key, read?.store_cnpj], [null, null]);
  }
  // O CNPJ impresso na página continua valendo.
  const printed = nfceRead(ok(null, [QR, PAGE_URL], PAGE_URL, { ...PAGE, store: { ...PAGE.store, cnpj: '11222333000181' } }), QR, 'h1');
  assertEquals([printed?.access_key, printed?.store_cnpj], [null, '11222333000181']);
});

Deno.test('nfceRead: caminho fora dos endereços oficiais, ou sem casa, não vira leitura', () => {
  assertEquals(nfceRead(ok(KEY, [QR, 'https://arquivos.fazenda.sp.gov.br/nota.html'], 'https://arquivos.fazenda.sp.gov.br/nota.html'), QR, 'h1'), null);
  assertEquals(nfceRead(ok(KEY, ['http://www.nfce.fazenda.sp.gov.br:8080/qrcode'], 'http://www.nfce.fazenda.sp.gov.br:8080/qrcode'), QR, 'h1'), null);
  assertEquals(nfceRead(ok(KEY), QR, null), null);
  assertEquals(nfceRead(ok(KEY), QR, ''), null);
});

Deno.test('nfceRead: por http num host da lista também vira leitura (PR responde em http sem redirecionar)', () => {
  const qr = `http://www.fazenda.pr.gov.br/nfce/qrcode?p=${KEY}|2|1|1|HASH`;
  const read = nfceRead(ok(KEY, [qr], qr), qr, 'h1');
  assertEquals(read?.access_key, KEY);
});

Deno.test('nfceRead: CNPJ da página que não passa no verificador dá lugar ao da chave conferida', () => {
  const wrong = { ...PAGE, store: { ...PAGE.store, cnpj: '11222333000182' } };
  assertEquals(nfceRead(ok(KEY, [QR, PAGE_URL], PAGE_URL, wrong), QR, 'h1')?.store_cnpj, '11222333000181');
  // Sem a chave conferida, nenhum: um CNPJ errado na base comum seria outro mercado.
  assertEquals(nfceRead(ok(null, [QR, PAGE_URL], PAGE_URL, wrong), QR, 'h1')?.store_cnpj, null);
});

Deno.test('nfceRead: a linha leva o código de barras de 13 ou 14 dígitos; o código interno do mercado e o da balança não vão', () => {
  const page: NfcePage = {
    ...PAGE,
    items: [
      { description: 'LEITE ITALAC 1L', code: '7891000100103', quantity: 1, unit: 'UN', unitPrice: 4.59, totalPrice: 4.59 },
      { description: 'BANANA PRATA', code: '250474', quantity: 1, unit: 'KG', unitPrice: 6.99, totalPrice: 6.99 },
      { description: 'PATINHO KG', code: '2000000000008', quantity: 1, unit: 'KG', unitPrice: 49.9, totalPrice: 49.9 },
      { description: 'LEITE COM DIGITO ERRADO', code: '7891000100104', quantity: 1, unit: 'UN', unitPrice: 4.59, totalPrice: 4.59 },
      { description: 'SACOLA', code: null, quantity: 1, unit: 'UN', unitPrice: 0.1, totalPrice: 0.1 },
      // De 8 ou 12 dígitos com o verificador certo: pode ser o código interno do mercado, e não vai.
      { description: 'QUEIJO DA CASA', code: '12345670', quantity: 1, unit: 'KG', unitPrice: 39.9, totalPrice: 39.9 },
      { description: 'CAFE IMPORTADO', code: '036000291452', quantity: 1, unit: 'UN', unitPrice: 29.9, totalPrice: 29.9 },
      { description: 'SUCO CAIXA 12', code: '17891000100100', quantity: 1, unit: 'UN', unitPrice: 59.9, totalPrice: 59.9 },
    ],
  };
  assertEquals(nfceRead(ok(KEY, [QR, PAGE_URL], PAGE_URL, page), QR, 'h1')?.lines, [
    { description: 'LEITE ITALAC 1L', unit: 'un', unit_price: 4.59, gtin: '07891000100103' },
    { description: 'BANANA PRATA', unit: 'kg', unit_price: 6.99 },
    { description: 'PATINHO KG', unit: 'kg', unit_price: 49.9 },
    { description: 'LEITE COM DIGITO ERRADO', unit: 'un', unit_price: 4.59 },
    { description: 'SACOLA', unit: 'un', unit_price: 0.1 },
    { description: 'QUEIJO DA CASA', unit: 'kg', unit_price: 39.9 },
    { description: 'CAFE IMPORTADO', unit: 'un', unit_price: 29.9 },
    { description: 'SUCO CAIXA 12', unit: 'un', unit_price: 59.9, gtin: '17891000100100' },
  ]);
});
