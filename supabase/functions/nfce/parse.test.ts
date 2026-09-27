import { assert, assertEquals } from '@std/assert';

import { isSefazUrl, parseBRNumber, parseNfceHtml } from './parse.ts';

// Leiaute do Portal da NFC-e (consulta pelo QR code), resumido.
const PAGE = `
<div id="conteudo">
  <div class="txtCenter">
    <div id="u20" class="txtTopo">SUPERMERCADO BOM PRE&Ccedil;O LTDA</div>
    <div class="text">CNPJ:  12.345.678/0001-99</div>
    <div class="text">RUA DAS FLORES, 100, , CENTRO, S&Atilde;O PAULO, SP</div>
  </div>
  <table id="tabResult" cellspacing="0" cellpadding="0" align="center">
    <tr id="Item + 1">
      <td valign="top"><span class="txtTit">ARROZ T.JOAO TP1 5KG</span><span class="RCod">(Código: 7891234567890 )</span><br />
        <span class="Rqtd"><strong>Qtde.:</strong>1</span><span class="RUN"><strong>UN: </strong>UN</span>
        <span class="RvlUnit"><strong>Vl. Unit.:</strong>&nbsp;24,9</span></td>
      <td align="right" valign="top" class="txtTit noWrap">Vl. Total<br /><span class="valor">24,90</span></td>
    </tr>
    <tr id="Item + 2">
      <td valign="top"><span class="txtTit">P&Atilde;O FRANC&Ecirc;S KG</span><span class="RCod">(Código: 2000123 )</span><br />
        <span class="Rqtd"><strong>Qtde.:</strong>0,325</span><span class="RUN"><strong>UN: </strong>KG</span>
        <span class="RvlUnit"><strong>Vl. Unit.:</strong>&nbsp;16,9</span></td>
      <td align="right" valign="top" class="txtTit noWrap">Vl. Total<br /><span class="valor">5,49</span></td>
    </tr>
  </table>
  <div id="totalNota" class="txtRight">
    <div id="linhaTotal"><label>Qtd. total de itens:</label><span class="totalNumb">2</span></div>
    <div id="linhaTotal"><label>Valor total R$:</label><span class="totalNumb">1.030,39</span></div>
    <div id="linhaTotal" class="linhaShade"><label>Valor a pagar R$:</label><span class="totalNumb txtMax">1.030,39</span></div>
  </div>
  <div id="infos"><ul><li><strong>Número: </strong>12345<strong> Série: </strong>1<strong> Emissão: </strong>20/09/2026 10:15:32 - Via Consumidor</li></ul></div>
</div>`;

Deno.test('lê mercado, itens, total e data da consulta pública', () => {
  const page = parseNfceHtml(PAGE);
  assertEquals(page.store, {
    name: 'SUPERMERCADO BOM PREÇO LTDA',
    cnpj: '12345678000199',
    address: 'RUA DAS FLORES, 100, , CENTRO, SÃO PAULO, SP',
  });
  assertEquals(page.purchasedAt, '2026-09-20T10:15:32-03:00');
  assertEquals(page.total, 1030.39);
  assertEquals(page.items, [
    { description: 'ARROZ T.JOAO TP1 5KG', code: '7891234567890', quantity: 1, unit: 'UN', unitPrice: 24.9, totalPrice: 24.9 },
    { description: 'PÃO FRANCÊS KG', code: '2000123', quantity: 0.325, unit: 'KG', unitPrice: 16.9, totalPrice: 5.49 },
  ]);
});

Deno.test('página sem itens (verificação, erro) volta vazia', () => {
  const page = parseNfceHtml('<html><body><h1>Digite o código da imagem</h1></body></html>');
  assertEquals(page.items, []);
  assertEquals(page.total, null);
});

Deno.test('números no formato brasileiro', () => {
  assertEquals(parseBRNumber('1.234,56'), 1234.56);
  assertEquals(parseBRNumber('Qtde.: 0,325'), 0.325);
  assertEquals(parseBRNumber('abc'), null);
});

Deno.test('só busca em sites de Sefaz', () => {
  assert(isSefazUrl('https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=1'));
  assert(isSefazUrl('http://www4.fazenda.rj.gov.br/consultaNFCe/QRCode?p=1'));
  assert(!isSefazUrl('https://example.com/?p=1'));
  assert(!isSefazUrl('https://gov.br.example.com/'));
  assert(!isSefazUrl('https://sefaz.gov.br:8443/x'));
  assert(!isSefazUrl('file:///etc/passwd'));
});
