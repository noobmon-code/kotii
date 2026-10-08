import { assert, assertEquals } from '@std/assert';

import { attributes, decodeHtml, describePage, type Fetched, isCaptchaGated, nextHop, safeLocation, showsCaptcha } from './page.ts';

const KEY = '24260912345678000190650010000123451000012342';
const BASE = `http://www.sefaz.rn.gov.br/nfce?p=${KEY}|2|1`;
const KEY_PB = '25260912345678000190650010000123451000012347';
const PB_QR = `http://www.sefaz.pb.gov.br/nfce?p=${KEY_PB}|3|1`;
const PB_CONSULT = `https://www4.sefaz.pb.gov.br/atf/seg/SEGf_AcessarFuncao.jsp?cdFuncao=FIS_1410&p=${KEY_PB}`;

function fetched(html: string, extra: Partial<Fetched> = {}): Fetched {
  return { status: 200, url: BASE, contentType: 'text/html; charset=utf-8', bytes: html.length, html, redirects: [], challenge: false, ...extra };
}

Deno.test('atributos de uma tag, com e sem aspas', () => {
  assertEquals(attributes(`<iframe id=contents SRC='../fis/a.do?x=1&amp;y=2' frameborder="0">`), {
    id: 'contents',
    src: '../fis/a.do?x=1&y=2',
    frameborder: '0',
  });
});

Deno.test('segue meta refresh para outra página de Sefaz', () => {
  const html = `<html><head><meta http-equiv="Refresh" content="0; URL='https://nfce.sefaz.rn.gov.br/consulta.jsp?a=1&amp;p=1'"></head></html>`;
  assertEquals(nextHop(html, BASE), 'https://nfce.sefaz.rn.gov.br/consulta.jsp?a=1&p=1');
});

Deno.test('meta refresh relativo vira endereço completo', () => {
  assertEquals(nextHop('<meta content="3;url=/nfce/consulta.jsp?p=1" http-equiv="refresh">', BASE), 'http://www.sefaz.rn.gov.br/nfce/consulta.jsp?p=1');
});

Deno.test('não segue para fora de .gov.br', () => {
  assertEquals(nextHop('<meta http-equiv="refresh" content="0;url=https://example.com/x">', BASE), null);
  assertEquals(nextHop(`<script>window.location.href = 'https://gov.br.example.com/x';</script>`, BASE), null);
});

Deno.test('segue redirecionamento em JavaScript', () => {
  assertEquals(
    nextHop(`<script type="text/javascript">\n  window.location.href = "https://nfce.sefaz.rn.gov.br/x.jsp?p=1";\n</script>`, BASE),
    'https://nfce.sefaz.rn.gov.br/x.jsp?p=1',
  );
  assertEquals(nextHop(`<script>location.replace('/consulta?p=2')</script>`, BASE), 'http://www.sefaz.rn.gov.br/consulta?p=2');
  assertEquals(nextHop(`<body onload="document.location='/consulta?p=3'"></body>`, BASE), 'http://www.sefaz.rn.gov.br/consulta?p=3');
});

Deno.test('ignora redirecionamento comentado, comparação e script externo', () => {
  assertEquals(nextHop(`<!-- <meta http-equiv="refresh" content="0;url=/a"> --><p>oi</p>`, BASE), null);
  assertEquals(nextHop(`<script>\n// location.href = '/a';\nif (location.href == '/b') {}\n</script>`, BASE), null);
  assertEquals(nextHop(`<script src="/js/app.js">location.href = '/a'</script>`, BASE), null);
  // Comentário de bloco, comentário no fim da linha e script inteiro comentado no HTML.
  assertEquals(nextHop(`<script>/* location.href = "https://nfce.sefaz.rn.gov.br/old.jsp" */</script>`, BASE), null);
  assertEquals(nextHop(`<script>iniciar(); // location.href = '/a';</script>`, BASE), null);
  assertEquals(nextHop(`<!-- <script>location.href = '/a';</script> --><p>oi</p>`, BASE), null);
});

Deno.test('função que só roda se chamada não é redirecionamento; a que roda ao carregar é', () => {
  assertEquals(nextHop(`<script>function voltar() { location.href = "https://www.sefaz.rn.gov.br/"; }</script>`, BASE), null);
  assertEquals(nextHop(`<script>var sair = function () { if (x) { location.href = '/sair'; } };</script>`, BASE), null);
  assertEquals(nextHop(`<script>document.getElementById('b').onclick = () => { location.href = '/a'; };</script>`, BASE), null);
  assertEquals(
    nextHop(`<script>setTimeout(function () { window.location.href = '/consulta?p=4'; }, 2000);</script>`, BASE),
    'http://www.sefaz.rn.gov.br/consulta?p=4',
  );
  assertEquals(nextHop(`<script>window.onload = function () { location.replace('/consulta?p=5'); };</script>`, BASE), 'http://www.sefaz.rn.gov.br/consulta?p=5');
  assertEquals(nextHop(`<script>setTimeout(() => { location = '/consulta?p=6'; }, 0);</script>`, BASE), 'http://www.sefaz.rn.gov.br/consulta?p=6');
  // Uma função guardada antes não esconde o redirecionamento de fora dela.
  assertEquals(
    nextHop(`<script>function voltar() { history.back(); }\nlocation.href = '/consulta?p=7';</script>`, BASE),
    'http://www.sefaz.rn.gov.br/consulta?p=7',
  );
});

Deno.test('// dentro de texto entre aspas ou de expressão regular não é comentário', () => {
  assertEquals(nextHop(`<script>location.replace('https://nfce.sefaz.rn.gov.br//nota.jsp?p=1');</script>`, BASE), 'https://nfce.sefaz.rn.gov.br//nota.jsp?p=1');
  assertEquals(nextHop(`<script>var a = "/* x */"; location.href = '/nota.jsp';</script>`, BASE), 'http://www.sefaz.rn.gov.br/nota.jsp');
  assertEquals(nextHop(`<script>var re = /https?:\\/\\//; location.href = '/nota.jsp';</script>`, BASE), 'http://www.sefaz.rn.gov.br/nota.jsp');
  assertEquals(nextHop(`<script>var s = "it's"; // location.href = '/a';\n</script>`, BASE), null);
});

Deno.test('script antigo entre <!-- e //-->: o código das linhas de dentro roda', () => {
  assertEquals(
    nextHop(`<script language="javascript">\n<!--\nwindow.location = "/nota.jsp";\n//-->\n</script>`, BASE),
    'http://www.sefaz.rn.gov.br/nota.jsp',
  );
  // Na mesma linha do <!--, é comentário também no JavaScript.
  assertEquals(nextHop(`<script><!-- window.location = '/nota.jsp'; //--></script>`, BASE), null);
});

Deno.test('não abre iframes, frames, formulários nem links', () => {
  assertEquals(nextHop('<iframe id="conteudo" src="/nota.jsp"></iframe>', BASE), null);
  assertEquals(nextHop(`<frameset rows="80,*"><frame name="topo" src="/topo.html"><frame name="principal" src="/consulta.jsp?p=1"></frameset>`, BASE), null);
  assertEquals(nextHop('<form action="/nota.jsp" method="post"><input name="chave"></form><a href="/nota.jsp">Ver</a>', BASE), null);
  // Nunca a própria página.
  assertEquals(nextHop(`<meta http-equiv="refresh" content="0;url=${BASE}">`, BASE), null);
});

Deno.test('endereço para log sem query, sessão nem números longos', () => {
  assertEquals(safeLocation(BASE), 'http://www.sefaz.rn.gov.br/nfce');
  assertEquals(safeLocation('https://nfce.sefaz.rn.gov.br/consulta/ver.jsp;jsessionid=ABC123?chave=1#x'), 'https://nfce.sefaz.rn.gov.br/consulta/ver.jsp');
  assertEquals(safeLocation(`https://sefaz.x.gov.br/nota/${KEY}/ver`), 'https://sefaz.x.gov.br/nota/#/ver');
  assertEquals(safeLocation('javascript:alert(1)'), 'javascript:');
  assertEquals(safeLocation(''), '(vazio)');
});

// --- CAPTCHA ---------------------------------------------------------------

Deno.test('reconhece reCAPTCHA v2 (caixa "não sou um robô")', () => {
  assert(showsCaptcha('<form><div class="g-recaptcha" data-sitekey="6Lc"></div></form>', BASE));
  // Invisível, no próprio botão.
  assert(showsCaptcha('<form><button class="botoes g-recaptcha" data-callback="enviar">Consultar</button></form>', BASE));
  assert(showsCaptcha('<iframe title="reCAPTCHA" src="https://www.google.com/recaptcha/api2/anchor?k=6Lc"></iframe>', BASE));
  assert(showsCaptcha('<form action="/c"></form><script src="https://www.google.com/recaptcha/api.js" async defer></script>', BASE));
  assert(showsCaptcha('<form action="/c"></form><script src="https://www.recaptcha.net/recaptcha/api.js"></script>', BASE));
});

Deno.test('reconhece reCAPTCHA v3 e Enterprise (sem caixa) numa página com formulário', () => {
  assert(showsCaptcha('<form action="/c"></form><script src="https://www.google.com/recaptcha/api.js?render=6LcKEY"></script>', BASE));
  assert(showsCaptcha('<form action="/c"></form><script src="https://www.google.com/recaptcha/enterprise.js?render=6Lc"></script>', BASE));
  // O disparo pode estar dentro do envio do formulário (função que só roda depois).
  assert(
    showsCaptcha(
      `<form id="f" action="/c"></form><script>document.getElementById('f').onsubmit = function () { grecaptcha.execute('6Lc', { action: 'consulta' }); };</script>`,
      BASE,
    ),
  );
  assert(showsCaptcha(`<form action="/c"></form><script>grecaptcha.enterprise.ready(function () { grecaptcha.enterprise.execute('6Lc'); });</script>`, BASE));
});

Deno.test('reconhece hCaptcha, Turnstile, captcha de imagem e a verificação da Cloudflare', () => {
  assert(showsCaptcha('<div class="h-captcha" data-sitekey="x"></div><script src="https://js.hcaptcha.com/1/api.js"></script>', BASE));
  assert(showsCaptcha('<div class="cf-turnstile" data-sitekey="x"></div>', BASE));
  assert(showsCaptcha('<form action="/c"></form><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>', BASE));
  assert(showsCaptcha('<img src="/nfce/Captcha.aspx"><input name="txtCaptcha">', BASE));
  assert(showsCaptcha('<form><input id="codigoCaptcha" type="text"></form>', BASE));
  // Página "verificando o navegador" (desafio gerenciado), sem a palavra captcha.
  assert(
    showsCaptcha(
      `<script>(function(){window._cf_chl_opt={cvId:'3',cType:'managed'};var a=document.createElement('script');a.src='/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=1';document.head.appendChild(a);}());</script>`,
      BASE,
    ),
  );
});

Deno.test('página comum, sem itens e sem CAPTCHA, não é CAPTCHA', () => {
  assert(!showsCaptcha('<div class="msgErro">NFC-e não encontrada. Tente novamente mais tarde.</div>', BASE));
  assert(!showsCaptcha('<!-- <div class="g-recaptcha"></div> --><p>Consulta indisponível</p>', BASE));
  assert(!showsCaptcha('<form action="/nfce/consulta.jsp"><input name="chave"></form>', BASE));
});

Deno.test('a palavra captcha ou o script do provedor sem formulário não são CAPTCHA', () => {
  // Rodapé do site inteiro com o script do reCAPTCHA, numa página de aviso.
  assert(!showsCaptcha('<p>NFC-e ainda não autorizada. Tente mais tarde.</p><script src="https://www.google.com/recaptcha/api.js"></script>', BASE));
  assert(!showsCaptcha('<p>Aviso</p><script src="https://www.google.com/recaptcha/api.js?render=6Lc"></script><script>grecaptcha.ready(function () { grecaptcha.execute(\'6Lc\', { action: \'home\' }); });</script>', BASE));
  // Só texto.
  assert(!showsCaptcha('<p>NFC-e ainda não autorizada. Consulte pelo portal (com captcha).</p>', BASE));
  assert(!showsCaptcha('<p>Marque a caixa "Não sou um robô" no portal.</p>', BASE));
  assert(!showsCaptcha('<style>.g-recaptcha { margin: 0 }</style><p>Aviso</p>', BASE));
  // Disparo comentado.
  assert(!showsCaptcha(`<form action="/c"></form><script>// grecaptcha.execute('6Lc');\n/* hcaptcha.render('x') */</script>`, BASE));
  // Script de detecção que a Cloudflare põe em páginas comuns.
  assert(!showsCaptcha(`<p>Aviso</p><script>(function(){var a=document.createElement('script');a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';}());</script>`, BASE));
});

// Os nomes das páginas do ATF ficam em grafias variadas (o teste também
// confere que maiúsculas e minúsculas não importam).
const ATF = 'https://www4.sefaz.pb.gov.br';

Deno.test('ATF da Paraíba: a consulta (FIS_1410) e o que vem depois do CAPTCHA, em qualquer grafia', () => {
  for (
    const url of [
      PB_CONSULT,
      `${ATF}/atf/seg/SEGf_AcessarFuncao.jsp?cdfuncao=fis_1410`,
      // A nota depois do CAPTCHA (FIS_1417) e os arquivos das funções fiscais.
      `${ATF}/atf/seg/SEGf_AcessarFuncao.jsp?cdFuncao=FIS_1417&p=1`,
      `${ATF}/atf/fis/FisF_ExibirNfce.do?p=${KEY_PB}`,
      `${ATF}/atf/fis/fisf_consultarnfce.do`,
      // Grafias que o servidor entende como /atf.
      `${ATF}/%61tf/fis/FisF_ExibirNfce.do?p=${KEY_PB}`,
      `${ATF}/%2561tf/x.do`,
      `${ATF}//atf/fis/x.do`,
      `${ATF}/atf;x=1/fis/x.do`,
      `${ATF}/atf;jsessionid=ABC/fis/x.do`,
      `${ATF}/x/..;/atf/fis/x.do`,
      `${ATF}/x/%2e%2e/atf/fis/x.do`,
      `${ATF}/x%2f..%2fatf/fis/x.do`,
      `${ATF}/x%5c..%5catf/fis/x.do`,
      `${ATF}/ATF/fis/x.do`,
      `${ATF}/atf`,
      `${ATF}/atf/fis/fisf_exibir%4efce.do`,
      // Outros hosts da PB, com e sem o ponto final do domínio.
      'https://www4.receita.pb.gov.br/atf/seg/SEGf_AcessarFuncao.jsp?cdFuncao=FIS_1410',
      'https://www.sefaz.pb.gov.br/atf/fis/x.do',
      'https://www4.sefaz.pb.gov.br./atf/fis/x.do',
      // As marcas do ATF valem em qualquer host, também codificadas.
      'https://www.sefaz.rn.gov.br/x/SEGf_AcessarFuncao.jsp?cdFuncao=FIS_1417',
      'https://atf.exemplo.gov.br/fis/FisF_ExibirNfce.do',
      'https://atf.exemplo.gov.br/fis/%46%49%53f_x.do',
      'https://atf.exemplo.gov.br/seg/x.jsp?cdFuncao=%46IS_1417',
      'https://atf.exemplo.gov.br/seg/x.jsp?cdFuncao=+FIS_1499',
    ]
  ) {
    assert(isCaptchaGated(url), url);
  }
});

Deno.test('ATF da Paraíba: não bloqueia o link do QR nem a consulta pública de outros estados', () => {
  for (
    const url of [
      PB_QR,
      `http://www.receita.pb.gov.br/nfce?p=${KEY_PB}|3|1`,
      'https://www.sefaz.pb.gov.br/nfce/consulta',
      'https://www.sefaz.pb.gov.br/x/atf/y',
      // RN, AM, MA, AL e SE usam "consultarNFCe" na consulta pública do QR.
      `http://nfce.set.rn.gov.br/consultarNFCe.aspx?p=${KEY}|2|1`,
      `http://sistemas.sefaz.am.gov.br/nfceweb/consultarNFCe.jsp?p=${KEY}|2|1`,
      'https://www.sefaz.rn.gov.br/atf/x.jsp?cdFuncao=FIS_1310',
      'https://www4.sefaz.pb.gov.br.example.com/x.jsp',
      'não é endereço',
    ]
  ) {
    assert(!isCaptchaGated(url), url);
  }
});

Deno.test('página que é ou aponta para o ATF da Paraíba pede CAPTCHA', () => {
  assert(showsCaptcha('<p>Consulta</p>', PB_CONSULT));
  assert(showsCaptcha(`<iframe src="${PB_CONSULT}"></iframe>`, PB_QR));
  assert(showsCaptcha(`<frameset><frame src="${PB_CONSULT}"></frameset>`, PB_QR));
  assert(showsCaptcha('<form action="https://www4.sefaz.pb.gov.br/atf/fis/ConsultaNFCe.do" method="post"></form>', PB_QR));
  assert(showsCaptcha(`<a href="${PB_CONSULT}">Consultar a nota</a>`, PB_QR));
  assert(showsCaptcha(`<meta http-equiv="refresh" content="0;url=${PB_CONSULT}">`, PB_QR));
  assert(showsCaptcha(`<script>location.href = '${PB_CONSULT}';</script>`, PB_QR));
  assert(showsCaptcha(`<meta http-equiv="refresh" content="0;url=https://www4.sefaz.pb.gov.br/%61tf/fis/FisF_ExibirNfce.do">`, PB_QR));
  assert(!showsCaptcha('<p>Consulte sua nota</p>', PB_QR));
});

// --- Resumo para o log -----------------------------------------------------

// Página de verificação com dados da nota em campos, no título e no texto.
const NOISY_PAGE = `<!DOCTYPE html>
<html><head><title>Consulta NFC-e ${KEY} de MARIA DA SILVA</title>
<script src="https://www.google.com/recaptcha/api.js?render=6LcKEY12345"></script>
<script src="/nfce/js/funcoes.js?v=20260901"></script>
<script>var cliente = 'JOSE PEREIRA'; setTimeout(function () { location.href = '/nfce/ver.jsp?chave=${KEY}'; }, 9000);</script>
<meta http-equiv="refresh" content="600;url=/nfce/sair.jsp?chave=${KEY}">
</head><body>
<div id="cliente_123.456.789-09"><form name="frmConsulta" method="post" action="ver.jsp;jsessionid=XYZ987654?chave=${KEY}">
  <input type="hidden" name="chave_${KEY}" value="${KEY}">
  <input type="hidden" name="hidCPF" value="123.456.789-09">
  <input type="text" name="cnpj" value="12.345.678/0001-90">
  <input type="hidden" name="produto" value="ARROZ TIO JOAO 5KG">
  <select name="pagamento"><option>Crédito</option></select>
  <button class="g-recaptcha botoes" name="btnConsultar" data-sitekey="6LcKEY12345">Consultar</button>
</form></div>
<iframe id="contents" src="https://nfce.sefaz.rn.gov.br/nota/${KEY}/ver.jsp?p=${KEY}|2|1"></iframe>
<div class="msgErro">Chave ${KEY} não encontrada para o CPF 123.456.789-09 de MARIA DA SILVA</div>
<p>Mercado Bom Preço, CNPJ 12.345.678/0001-90, total R$ 24,90</p>
</body></html>`;

Deno.test('resumo da página mostra só a estrutura', () => {
  const summary = describePage('qr', fetched(NOISY_PAGE, { redirects: ['http://www.sefaz.rn.gov.br/nfce'], contentType: 'text/html;charset=ISO-8859-1' }));
  assertEquals(summary, {
    step: 'qr',
    status: 200,
    url: 'http://www.sefaz.rn.gov.br/nfce',
    type: 'text/html; charset=iso-8859-1',
    bytes: NOISY_PAGE.length,
    redirects: ['http://www.sefaz.rn.gov.br/nfce'],
    forms: 1,
    iframes: 1,
    scripts: 3,
    inputs: 6,
    formActions: ['http://www.sefaz.rn.gov.br/ver.jsp'],
    frameHosts: ['nfce.sefaz.rn.gov.br'],
    scriptHosts: ['www.google.com', 'www.sefaz.rn.gov.br'],
    refresh: 'http://www.sefaz.rn.gov.br/nfce/sair.jsp',
    captcha: true,
    frames: true,
    jsRedirect: true,
  });
});

Deno.test('resumo da página sem CAPTCHA, frames nem JavaScript', () => {
  const summary = describePage('salto-1', fetched('<div class="msgErro">NFC-e não encontrada</div>', { status: 404, contentType: 'text/html' }));
  assertEquals(summary.captcha, false);
  assertEquals(summary.frames, false);
  assertEquals(summary.jsRedirect, false);
  assertEquals(summary.refresh, null);
  assertEquals(summary.type, 'text/html');
  assertEquals([summary.forms, summary.iframes, summary.scripts, summary.inputs], [0, 0, 0, 0]);
});

Deno.test('resumo da página nunca leva textos, nomes, query nem números longos', () => {
  const summary = describePage('qr', fetched(NOISY_PAGE, { contentType: `text/html; nome="MARIA ${KEY}"` }));
  // Os números do resumo (status, bytes, contagens) não vêm do texto; os textos são só estrutura.
  const strings = JSON.stringify(Object.values(summary).filter((value) => typeof value !== 'number'));
  assert(!/\d{5,}/.test(strings), strings);
  assert(!strings.includes('?'), `query no resumo: ${strings}`);
  for (
    const secret of [
      KEY,
      '123.456.789-09',
      '12.345.678/0001-90',
      'MARIA',
      'SILVA',
      'JOSE',
      'PEREIRA',
      'ARROZ',
      'Bom Preço',
      '24,90',
      'Crédito',
      'Consulta',
      'encontrada',
      'chave',
      'hidCPF',
      'produto',
      'cliente',
      'jsessionid',
      'XYZ',
      '6LcKEY',
    ]
  ) {
    assert(!strings.includes(secret), `vazou ${secret}: ${strings}`);
  }
});

Deno.test('decodifica ISO-8859-1 com e sem charset declarado', () => {
  const latin1 = new Uint8Array([0x50, 0xc3, 0x4f]); // "PÃO" em ISO-8859-1 (não é UTF-8 válido)
  assertEquals(decodeHtml(latin1, 'text/html; charset=ISO-8859-1'), 'PÃO');
  assertEquals(decodeHtml(latin1, null), 'PÃO');
  assertEquals(decodeHtml(new TextEncoder().encode('PÃO'), null), 'PÃO');
  const declaredInMeta = new Uint8Array([...new TextEncoder().encode('<meta charset="iso-8859-1">'), 0xc7]);
  assertEquals(decodeHtml(declaredInMeta, 'text/html'), '<meta charset="iso-8859-1">Ç');
});
