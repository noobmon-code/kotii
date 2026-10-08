import { assertEquals } from '@std/assert';

import type { NfcePage } from './parse.ts';
import { captchaMessage, NO_ITEMS_MESSAGE, replyFor, SEFAZ_DOWN_MESSAGE } from './reply.ts';
import { lookupNfce } from './sefaz.ts';
import { stateFromCode } from './uf.ts';

const KEY_PB = '25260912345678000190650010000123451000012347';
const PB_QR = `http://www.sefaz.pb.gov.br/nfce?p=${KEY_PB}|3|1`;
const SP_QR = `https://www.nfce.fazenda.sp.gov.br/qrcode?p=35${KEY_PB.slice(2)}|2|1`;

const PAGE: NfcePage = {
  store: { name: 'MERCADO', cnpj: null, address: null },
  issuedAtLocal: null,
  total: 9,
  items: [{ description: 'LEITE', code: null, quantity: 1, unit: 'UN', unitPrice: 9, totalPrice: 9 }],
};

Deno.test('captcha: 422 com o código IBGE da UF (como o NfceQr.uf do app) e a leitura volta', () => {
  assertEquals(replyFor({ kind: 'captcha', trace: [] }, PB_QR), {
    status: 422,
    body: {
      code: 'captcha',
      uf: '25',
      error: 'A Sefaz da Paraíba pede uma confirmação de que você não é robô, que o app não consegue fazer. Leia a nota pela foto.',
    },
    refund: true,
  });
});

Deno.test('captcha: a mensagem usa o estado da chave, ou "deste estado"', () => {
  const sp = replyFor({ kind: 'captcha', trace: [] }, SP_QR);
  assertEquals(sp.body, { code: 'captcha', uf: '35', error: captchaMessage(stateFromCode('35')) });
  assertEquals(captchaMessage(stateFromCode('35')).startsWith('A Sefaz de São Paulo pede'), true);
  const unknown = replyFor({ kind: 'captcha', trace: [] }, 'https://www.sefaz.x.gov.br/nfce');
  assertEquals(unknown, {
    status: 422,
    body: {
      code: 'captcha',
      uf: null,
      error: 'A Sefaz deste estado pede uma confirmação de que você não é robô, que o app não consegue fazer. Leia a nota pela foto.',
    },
    refund: true,
  });
});

Deno.test('QR da Paraíba que leva à consulta do ATF: captcha e a leitura volta', async () => {
  const fn = (input: string) =>
    Promise.resolve(
      input === PB_QR
        ? new Response(`<iframe src="https://www4.sefaz.pb.gov.br/atf/seg/SEGf_AcessarFuncao.jsp?cdFuncao=FIS_1410"></iframe>`, { status: 200 })
        : new Response('', { status: 404 }),
    );
  const reply = replyFor(await lookupNfce(PB_QR, fn), PB_QR);
  assertEquals(reply.status, 422);
  assertEquals(reply.refund, true);
  assertEquals((reply.body as { code: string }).code, 'captcha');
});

Deno.test('Sefaz fora do ar: 502 e a leitura volta', () => {
  assertEquals(replyFor({ kind: 'down', trace: [] }, PB_QR), {
    status: 502,
    body: { error: SEFAZ_DOWN_MESSAGE, code: 'sefaz_down' },
    refund: true,
  });
  assertEquals(SEFAZ_DOWN_MESSAGE, 'A Sefaz não respondeu agora. Tente de novo em alguns minutos ou tire foto da nota.');
});

Deno.test('Sefaz respondeu sem itens: 422 e a leitura conta', () => {
  assertEquals(replyFor({ kind: 'empty', trace: [] }, PB_QR), {
    status: 422,
    body: { error: NO_ITEMS_MESSAGE, code: 'no_items' },
    refund: false,
  });
  assertEquals(NO_ITEMS_MESSAGE, 'A Sefaz não mostrou os itens desta nota. Tente de novo mais tarde ou tire foto da nota.');
});

Deno.test('nota lida: 200 com a nota e a leitura conta', () => {
  assertEquals(replyFor({ kind: 'ok', page: PAGE }, PB_QR), { status: 200, body: PAGE, refund: false });
});
