import { assertEquals } from '@std/assert';

import type { NfcePage } from './parse.ts';
import { nfceRead } from './read.ts';

const KEY = '35261011222333000181650010000123451000012347';
const OTHER_KEY = '35261099888777000166650010000123451000012347';
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
