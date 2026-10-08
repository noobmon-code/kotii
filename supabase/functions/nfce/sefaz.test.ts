import { assert, assertEquals } from '@std/assert';

import { lookupNfce, safeError, type TraceEntry } from './sefaz.ts';

// Chaves fictícias (RN e PB), com dígito verificador válido.
const KEY_RN = '24260912345678000190650010000123451000012342';
const KEY_PB = '25260912345678000190650010000123451000012347';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  signal?: AbortSignal;
}

/** `fetch` falso: responde por endereço (só GET existe) e guarda as chamadas. */
function fakeFetch(routes: Record<string, (call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fn = (input: string, init: RequestInit) => {
    const call = {
      url: input,
      method: init.method ?? 'GET',
      headers: init.headers as Record<string, string>,
      body: init.body,
      signal: init.signal ?? undefined,
    };
    calls.push(call);
    const route = call.method === 'GET' ? routes[input] : undefined;
    if (!route) return Promise.reject(new TypeError(`error sending request for url (${input}): connection refused`));
    return Promise.resolve(route(call));
  };
  return { fn, calls };
}

/** Sefaz que não responde: só termina quando o tempo do pedido acaba. */
function hang(call: Call): Promise<Response> {
  return new Promise((_, reject) => {
    call.signal?.addEventListener('abort', () => reject(call.signal?.reason), { once: true });
  });
}

function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
}

function redirect(location: string, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 302, headers: { location, ...headers } });
}

const PORTAL = `<div class="txtTopo">MERCADO SECRETO LTDA</div><table id="tabResult"><tr>
  <td><span class="txtTit">LEITE INTEGRAL 1L</span><span class="RCod">(Código: 7890000000001)</span>
  <span class="Rqtd"><strong>Qtde.:</strong>2</span><span class="RUN"><strong>UN: </strong>UN</span>
  <span class="RvlUnit"><strong>Vl. Unit.:</strong> 4,50</span></td><td><span class="valor">9,00</span></td></tr></table>`;

const LEITE = { description: 'LEITE INTEGRAL 1L', code: '7890000000001', quantity: 2, unit: 'UN', unitPrice: 4.5, totalPrice: 9 };

/** O trace vai para o log: nunca a chave, query, itens, preços ou números longos. */
function assertSafe(trace: TraceEntry[], ...secrets: string[]) {
  const strings = JSON.stringify(trace.map((entry) => Object.values(entry).filter((value) => typeof value !== 'number')));
  assert(!/\d{5,}/.test(strings), strings);
  assert(!strings.includes('?'), `query no log: ${strings}`);
  for (const secret of [KEY_RN, KEY_PB, 'LEITE', 'SECRETO', '9,00', 'SID-abc', ...secrets]) {
    assert(!strings.includes(secret), `vazou ${secret}: ${strings}`);
  }
}

/** Todo pedido foi um GET sem corpo nem cookie. */
function assertPlainGets(calls: Call[]) {
  for (const call of calls) {
    assertEquals(call.method, 'GET');
    assertEquals(call.body, undefined);
    assert(!Object.keys(call.headers).some((name) => name.toLowerCase() === 'cookie'), `cookie enviado para ${call.url}`);
  }
}

Deno.test('segue redirecionamento, meta refresh e JavaScript até a página com itens, só com GET e sem cookies', async () => {
  const qr = `http://www.sefaz.rn.gov.br/nfce?p=${KEY_RN}|2|1|1|HASH`;
  const { fn, calls } = fakeFetch({
    [qr]: () => redirect(`/nfce/consulta?p=${KEY_RN}`, { 'set-cookie': 'SID=SID-abc; Path=/; HttpOnly' }),
    [`http://www.sefaz.rn.gov.br/nfce/consulta?p=${KEY_RN}`]: () => html('<meta http-equiv="refresh" content="0;url=/nfce/quadro.jsp">'),
    'http://www.sefaz.rn.gov.br/nfce/quadro.jsp': () => html(`<script>window.location.href = "https://app.sefaz.rn.gov.br/nota.jsp?x=1";</script>`),
    'https://app.sefaz.rn.gov.br/nota.jsp?x=1': () => html(PORTAL),
  });
  const result = await lookupNfce(qr, fn);
  assertEquals(result.kind, 'ok');
  if (result.kind !== 'ok') return;
  assertEquals(result.page.items, [LEITE]);
  assertEquals(calls.length, 4);
  assertPlainGets(calls);
  assertEquals(calls[3].headers['Referer'], 'http://www.sefaz.rn.gov.br/nfce/quadro.jsp');
});

Deno.test('página 2xx sem itens nem CAPTCHA: resume a estrutura (empty)', async () => {
  const qr = `https://nfce.sefaz.rn.gov.br/consulta?p=${KEY_RN}|2|1|1|HASH`;
  const { fn } = fakeFetch({
    [qr]: () => html(`<script>window.location.href = "/consulta/ver.jsp?chave=${KEY_RN}";</script>`),
    [`https://nfce.sefaz.rn.gov.br/consulta/ver.jsp?chave=${KEY_RN}`]: () =>
      html(`<title>Consulta de MARIA</title><div class="msgErro">NFC-e ${KEY_RN} não encontrada</div>
        <form action="ver.jsp?chave=${KEY_RN}"><input name="chave" value="${KEY_RN}"></form>`),
  });
  const result = await lookupNfce(qr, fn);
  assertEquals(result.kind, 'empty');
  if (result.kind !== 'empty') return;
  assertEquals(result.trace.map((t) => t.step), ['qr', 'salto-1']);
  const last = result.trace[1];
  assert('formActions' in last);
  assertEquals(last.formActions, ['https://nfce.sefaz.rn.gov.br/consulta/ver.jsp']);
  assertEquals(last.inputs, 1);
  assertEquals(last.captcha, false);
  assertSafe(result.trace, 'MARIA', 'encontrada');
});

Deno.test('não abre iframes: a página com o iframe é a última', async () => {
  const qr = `https://nfce.sefaz.rn.gov.br/consulta?p=${KEY_RN}`;
  const { fn, calls } = fakeFetch({
    [qr]: () => html('<iframe id="conteudo" src="https://nfce.sefaz.rn.gov.br/nota.jsp"></iframe>'),
    'https://nfce.sefaz.rn.gov.br/nota.jsp': () => html(PORTAL),
  });
  const result = await lookupNfce(qr, fn);
  assertEquals(result.kind, 'empty');
  assertEquals(calls.map((c) => c.url), [qr]);
});

Deno.test('não sai de .gov.br nos redirecionamentos', async () => {
  const qr = `http://www.sefaz.rn.gov.br/nfce?p=${KEY_RN}`;
  const { fn, calls } = fakeFetch({ [qr]: () => redirect(`https://example.com/roubo?p=${KEY_RN}`) });
  const result = await lookupNfce(qr, fn);
  assertEquals(result.kind, 'down');
  assertEquals(calls.length, 1);
  if (result.kind !== 'down') return;
  assertEquals(result.trace, [{ step: 'erro', error: 'Error: redirect outside Sefaz: https://example.com/roubo' }]);
});

Deno.test('não sai de .gov.br no meta refresh nem no JavaScript', async () => {
  const qr = `http://www.sefaz.rn.gov.br/nfce?p=${KEY_RN}`;
  for (const page of [`<meta http-equiv="refresh" content="0;url=https://example.com/x">`, `<script>location.href = 'https://sefaz.rn.gov.br.example.com/x';</script>`]) {
    const { fn, calls } = fakeFetch({ [qr]: () => html(page) });
    assertEquals((await lookupNfce(qr, fn)).kind, 'empty');
    assertEquals(calls.map((c) => c.url), [qr]);
  }
});

Deno.test('Sefaz fora do ar (status de erro) devolve down', async () => {
  const qr = `http://www.sefaz.rn.gov.br/nfce?p=${KEY_RN}`;
  const { fn } = fakeFetch({ [qr]: () => html('<h1>Service Unavailable</h1>', 503) });
  const result = await lookupNfce(qr, fn);
  assertEquals(result.kind, 'down');
});

Deno.test('Sefaz que não responde: o tempo acaba e devolve down', async () => {
  const qr = `http://www.sefaz.rn.gov.br/nfce?p=${KEY_RN}`;
  const { fn } = fakeFetch({ [qr]: hang });
  const result = await lookupNfce(qr, fn, 50);
  assertEquals(result.kind, 'down');
  if (result.kind !== 'down') return;
  assertEquals(result.trace.map((t) => t.step), ['erro']);
});

Deno.test('laço de páginas: para, e nenhuma página final respondeu (down)', async () => {
  const qr = `http://www.sefaz.rn.gov.br/a?p=${KEY_RN}`;
  const { fn, calls } = fakeFetch({
    [qr]: () => html('<meta http-equiv="refresh" content="0;url=/b">'),
    'http://www.sefaz.rn.gov.br/b': () => html(`<meta http-equiv="refresh" content="0;url=/a?p=${KEY_RN}">`),
  });
  const result = await lookupNfce(qr, fn);
  assertEquals(result.kind, 'down');
  assertEquals(calls.length, 2);
  if (result.kind !== 'down') return;
  assertEquals(result.trace.map((t) => t.step), ['qr', 'salto-1', 'erro']);
});

Deno.test('saltos demais: para no limite (down)', async () => {
  const qr = `http://www.sefaz.rn.gov.br/p0?p=${KEY_RN}`;
  const routes: Record<string, () => Response> = { [qr]: () => html('<meta http-equiv="refresh" content="0;url=/p1">') };
  for (let i = 1; i <= 6; i++) routes[`http://www.sefaz.rn.gov.br/p${i}`] = () => html(`<meta http-equiv="refresh" content="0;url=/p${i + 1}">`);
  const { fn, calls } = fakeFetch(routes);
  assertEquals((await lookupNfce(qr, fn)).kind, 'down');
  assertEquals(calls.length, 4);
});

Deno.test('página que só redireciona e um salto que falha: a Sefaz não mostrou nada (down)', async () => {
  const qr = `https://nfce.sefaz.rn.gov.br/consulta?p=${KEY_RN}|2|1|1|HASH`;
  for (const failing of [() => html('Service Unavailable', 503), () => html('Not Found', 404), hang]) {
    const { fn } = fakeFetch({
      [qr]: () => html('<meta http-equiv="refresh" content="0;url=/real">'),
      'https://nfce.sefaz.rn.gov.br/real': failing,
    });
    const result = await lookupNfce(qr, fn, 200);
    assertEquals(result.kind, 'down');
    if (result.kind !== 'down') return;
    const steps = result.trace.map((t) => t.step);
    assertEquals([steps[0], steps.at(-1)], ['qr', 'erro']);
  }
});

Deno.test('página final 2xx sem itens depois de um salto: a Sefaz respondeu (empty)', async () => {
  const qr = `https://nfce.sefaz.rn.gov.br/consulta?p=${KEY_RN}|2|1|1|HASH`;
  const { fn } = fakeFetch({
    [qr]: () => html(`<script>window.location.href = '/real';</script>`),
    'https://nfce.sefaz.rn.gov.br/real': () => html('<div class="msgErro">NFC-e ainda não autorizada.</div>'),
  });
  assertEquals((await lookupNfce(qr, fn)).kind, 'empty');
});

// --- CAPTCHA ---------------------------------------------------------------

Deno.test('reCAPTCHA v2 na página: para ali, sem seguir o meta refresh', async () => {
  const qr = `https://nfce.sefaz.rn.gov.br/consulta?p=${KEY_RN}`;
  const { fn, calls } = fakeFetch({
    [qr]: () =>
      html(`<meta http-equiv="refresh" content="0;url=/consulta/nota.jsp"><form action="nota.jsp" method="post">
        <input name="chave" value="${KEY_RN}"><div class="g-recaptcha" data-sitekey="6Lc"></div><button>Consultar</button></form>`),
    'https://nfce.sefaz.rn.gov.br/consulta/nota.jsp': () => html(PORTAL),
  });
  const result = await lookupNfce(qr, fn);
  assertEquals(result.kind, 'captcha');
  assertEquals(calls.map((c) => c.url), [qr]);
  if (result.kind !== 'captcha') return;
  const page = result.trace[0];
  assert('captcha' in page);
  assertEquals(page.captcha, true);
  assertSafe(result.trace);
});

Deno.test('reCAPTCHA v3 depois de um salto: captcha', async () => {
  const qr = `https://nfce.sefaz.rn.gov.br/consulta?p=${KEY_RN}`;
  const { fn, calls } = fakeFetch({
    [qr]: () => html(`<script>location.replace('/consulta/ver.jsp?chave=${KEY_RN}')</script>`),
    [`https://nfce.sefaz.rn.gov.br/consulta/ver.jsp?chave=${KEY_RN}`]: () =>
      html(`<form id="f" action="ver.jsp" method="post"><input name="token"><button>Consultar</button></form>
        <script src="https://www.google.com/recaptcha/api.js?render=6Lc"></script>
        <script>grecaptcha.ready(function () { grecaptcha.execute('6Lc'); });</script>`),
  });
  const result = await lookupNfce(qr, fn);
  assertEquals(result.kind, 'captcha');
  assertEquals(calls.length, 2);
  assertPlainGets(calls);
});

Deno.test('verificação da Cloudflare (403 com Turnstile) é captcha, não Sefaz fora do ar', async () => {
  const qr = `https://nfce.sefaz.rn.gov.br/consulta?p=${KEY_RN}`;
  const { fn } = fakeFetch({
    [qr]: () => html('<div class="cf-turnstile" data-sitekey="x"></div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>', 403),
  });
  assertEquals((await lookupNfce(qr, fn)).kind, 'captcha');
});

Deno.test('verificação da Cloudflare só no cabeçalho (cf-mitigated: challenge): captcha', async () => {
  const qr = `https://nfce.sefaz.rn.gov.br/consulta?p=${KEY_RN}`;
  const { fn } = fakeFetch({ [qr]: () => html('<p>Um momento…</p>', 403, { 'cf-mitigated': 'challenge' }) });
  assertEquals((await lookupNfce(qr, fn)).kind, 'captcha');
});

Deno.test('página sem itens com o script do reCAPTCHA no rodapé e a palavra captcha: não é captcha (empty)', async () => {
  const qr = `https://nfce.sefaz.rn.gov.br/consulta?p=${KEY_RN}`;
  const { fn } = fakeFetch({
    [qr]: () =>
      html(`<p>NFC-e ainda não autorizada. Tente mais tarde ou consulte pelo portal (com captcha).</p>
        <script src="https://www.google.com/recaptcha/api.js"></script>`),
  });
  assertEquals((await lookupNfce(qr, fn)).kind, 'empty');
});

Deno.test('página com itens e script do reCAPTCHA: lê os itens', async () => {
  const qr = `https://nfce.sefaz.rn.gov.br/consulta?p=${KEY_RN}`;
  const { fn } = fakeFetch({ [qr]: () => html(`<script src="https://www.google.com/recaptcha/api.js?render=6Lc"></script>${PORTAL}`) });
  const result = await lookupNfce(qr, fn);
  assertEquals(result.kind, 'ok');
});

// --- Paraíba ---------------------------------------------------------------

const PB_QR = `http://www.sefaz.pb.gov.br/nfce?p=${KEY_PB}|3|1`;
const PB_CONSULT = `https://www4.sefaz.pb.gov.br/atf/seg/SEGf_AcessarFuncao.jsp?cdFuncao=FIS_1410&p=${KEY_PB}|3|1`;

/**
 * Nenhum pedido ao ATF da PB nem a páginas depois do CAPTCHA, e nenhum
 * formulário enviado. Conferido aqui sem o isCaptchaGated (o que se testa).
 */
function assertNoAtfRequest(calls: Call[]) {
  assertPlainGets(calls);
  for (const call of calls) {
    const decoded = decodeURIComponent(call.url).toLowerCase();
    assert(!/\.pb\.gov\.br\/+(?:[^/]*;[^/]*\/)*atf/.test(decoded), `buscou o ATF: ${call.url}`);
    assert(!/fisf_|acessarfuncao|cdfuncao/.test(decoded), `buscou depois do CAPTCHA: ${call.url}`);
  }
}

Deno.test('Paraíba: página do QR com a consulta do ATF num iframe: captcha, só o link do QR é buscado', async () => {
  const { fn, calls } = fakeFetch({
    [PB_QR]: () => html(`<title>SEFAZ-PB</title><iframe id="contents" src="${PB_CONSULT}"></iframe>`, 200, { 'set-cookie': 'JSESSIONID=abc123' }),
    [PB_CONSULT]: () => html('<form method="post"><div class="g-recaptcha"></div></form>'),
  });
  const result = await lookupNfce(PB_QR, fn);
  assertEquals(result.kind, 'captcha');
  assertEquals(calls.map((c) => c.url), [PB_QR]);
  assertNoAtfRequest(calls);
  if (result.kind !== 'captcha') return;
  assertEquals(result.trace.length, 1);
  const page = result.trace[0];
  assert('frameHosts' in page);
  assertEquals(page.frameHosts, ['www4.sefaz.pb.gov.br']);
  assertSafe(result.trace, 'abc123');
});

Deno.test('Paraíba: redirecionamento HTTP para a consulta do ATF: para antes de buscá-la', async () => {
  const { fn, calls } = fakeFetch({
    [PB_QR]: () => redirect(PB_CONSULT),
    [PB_CONSULT]: () => html('<form method="post"><div class="g-recaptcha"></div></form>'),
  });
  const result = await lookupNfce(PB_QR, fn);
  assertEquals(result.kind, 'captcha');
  assertEquals(calls.map((c) => c.url), [PB_QR]);
  assertNoAtfRequest(calls);
  if (result.kind !== 'captcha') return;
  assertEquals(result.trace, [{ step: 'qr', captchaGate: 'https://www4.sefaz.pb.gov.br/atf/seg/SEGf_AcessarFuncao.jsp' }]);
});

Deno.test('Paraíba: meta refresh ou JavaScript para a consulta do ATF: para antes de buscá-la', async () => {
  for (const page of [`<meta http-equiv="refresh" content="0;url=${PB_CONSULT}">`, `<script>window.location.href = '${PB_CONSULT}';</script>`]) {
    const { fn, calls } = fakeFetch({ [PB_QR]: () => html(page), [PB_CONSULT]: () => html('<p>ATF</p>') });
    const result = await lookupNfce(PB_QR, fn);
    assertEquals(result.kind, 'captcha');
    assertEquals(calls.map((c) => c.url), [PB_QR]);
    assertNoAtfRequest(calls);
  }
});

Deno.test('Paraíba: página intermediária com o formulário do reCAPTCHA: captcha, sem enviar nada', async () => {
  const middle = 'https://www.sefaz.pb.gov.br/nfce/consulta';
  const { fn, calls } = fakeFetch({
    [PB_QR]: () => html(`<meta http-equiv="refresh" content="0;url=${middle}">`),
    [middle]: () =>
      html(`<form action="https://www4.sefaz.pb.gov.br/atf/fis/ConsultaNFCe.do" method="post"><input name="chave" value="${KEY_PB}">
        <button class="g-recaptcha botoes">Consultar</button></form>`),
  });
  const result = await lookupNfce(PB_QR, fn);
  assertEquals(result.kind, 'captcha');
  assertEquals(calls.map((c) => c.url), [PB_QR, middle]);
  assertNoAtfRequest(calls);
});

Deno.test('Paraíba: link do QR que já é a consulta do ATF: nenhum pedido', async () => {
  const { fn, calls } = fakeFetch({});
  assertEquals((await lookupNfce(PB_CONSULT, fn)).kind, 'captcha');
  assertEquals(calls.length, 0);
});

// Grafias do ATF que o servidor entende como /atf (o nome do arquivo fica em
// grafias variadas: maiúsculas e minúsculas não importam).
const PB_AFTER_CAPTCHA = [
  `https://www4.sefaz.pb.gov.br/atf/seg/SEGf_AcessarFuncao.jsp?cdFuncao=FIS_1417&p=${KEY_PB}`,
  `https://www4.sefaz.pb.gov.br/%61tf/fis/FisF_ExibirNfce.do?p=${KEY_PB}`,
  `https://www4.sefaz.pb.gov.br//atf/fis/FisF_ExibirNfce.do?p=${KEY_PB}`,
  `https://www4.sefaz.pb.gov.br/atf;x=1/fis/FisF_ExibirNfce.do?p=${KEY_PB}`,
  `https://www4.sefaz.pb.gov.br/atf/fis/fisf_exibir%4efce.do?p=${KEY_PB}`,
  `https://www4.receita.pb.gov.br/atf/seg/SEGf_AcessarFuncao.jsp?cdFuncao=FIS_1410&p=${KEY_PB}`,
];

Deno.test('Paraíba: link colado que já é do ATF, em qualquer grafia: nenhum pedido', async () => {
  for (const url of PB_AFTER_CAPTCHA) {
    const { fn, calls } = fakeFetch({ [url]: () => html(PORTAL) });
    const result = await lookupNfce(url, fn);
    assertEquals(result.kind, 'captcha', url);
    assertEquals(calls.length, 0, url);
  }
});

Deno.test('Paraíba: redirecionamento, meta refresh ou JavaScript para o ATF em qualquer grafia: só o link do QR é buscado', async () => {
  for (const target of PB_AFTER_CAPTCHA) {
    for (
      const qrRoute of [
        () => redirect(target),
        () => html(`<meta http-equiv="refresh" content="0;url=${target}">`),
        () => html(`<script>location.replace('${target}');</script>`),
      ]
    ) {
      const { fn, calls } = fakeFetch({ [PB_QR]: qrRoute, [target]: () => html(PORTAL) });
      const result = await lookupNfce(PB_QR, fn);
      assertEquals(result.kind, 'captcha', target);
      assertEquals(calls.map((c) => c.url), [PB_QR], target);
      assertNoAtfRequest(calls);
      if (result.kind === 'captcha') assertSafe(result.trace);
    }
  }
});

Deno.test('Paraíba: página do QR fora do ar continua down', async () => {
  const { fn, calls } = fakeFetch({ [PB_QR]: () => html('<h1>Service Unavailable</h1>', 503) });
  assertEquals((await lookupNfce(PB_QR, fn)).kind, 'down');
  assertNoAtfRequest(calls);
});

Deno.test('mensagem de erro sem endereço completo nem números longos', () => {
  assertEquals(
    safeError(new TypeError(`error sending request for url (http://www.sefaz.pb.gov.br/nfce?p=${KEY_PB}|3|1): dns error ${KEY_PB}`)),
    'TypeError: error sending request for url (http://www.sefaz.pb.gov.br/nfce): dns error #',
  );
});
