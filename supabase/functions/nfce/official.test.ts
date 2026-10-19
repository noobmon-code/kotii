import { assert, assertEquals } from '@std/assert';

import { isOfficialNfceUrl, isOfficialRead, OFFICIAL_STATES } from './official.ts';
import { STATE_CODES, stateFromCode } from './uf.ts';

Deno.test('a lista tem as 27 Sefaz', () => {
  assertEquals([...OFFICIAL_STATES].sort(), STATE_CODES.map((code) => stateFromCode(code)!.uf).sort());
});

Deno.test('endereços de consulta das Sefaz (os do QR e os que a busca percorre)', () => {
  for (
    const url of [
      'https://www.nfce.fazenda.sp.gov.br/qrcode?p=1',
      'https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=1',
      'http://www.sefaz.pb.gov.br/nfce?p=1',
      'https://www4.sefaz.pb.gov.br/nfce/consulta',
      'http://nfce.set.rn.gov.br/consultarNFCe.aspx?p=1',
      'https://app.sefaz.rn.gov.br/nota.jsp',
      'https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode?p=1',
      'https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml?p=1',
      'https://sat.sef.sc.gov.br/nfce/consulta?p=1',
      'https://WWW.SEFAZ.RS.GOV.BR/NFCE/NFCE-COM.aspx?p=1',
    ]
  ) {
    assert(isOfficialNfceUrl(url), url);
  }
});

Deno.test('outros endereços .gov.br, parecidos ou com porta e usuário não são de consulta', () => {
  for (
    const url of [
      'https://arquivos.sefaz.pb.gov.br/upload/nota.html',
      'https://www.prefeitura.sp.gov.br/nfce',
      'https://www.nfce.fazenda.sp.gov.br.exemplo.com/qrcode',
      'https://x.www.nfce.fazenda.sp.gov.br/qrcode',
      'https://www.nfce.fazenda.sp.gov.br:8443/qrcode',
      'https://user@www.nfce.fazenda.sp.gov.br/qrcode',
      'ftp://www.nfce.fazenda.sp.gov.br/qrcode',
      'não é endereço',
    ]
  ) {
    assert(!isOfficialNfceUrl(url), url);
  }
});

Deno.test('a leitura vale com a página por https e todo o caminho em endereços oficiais', () => {
  const qr = 'http://www.sefaz.rn.gov.br/nfce?p=1';
  const page = 'https://app.sefaz.rn.gov.br/nota.jsp';
  assert(isOfficialRead([qr, 'http://www.sefaz.rn.gov.br/nfce/consulta', page], page));
  // A página dos itens por http: não vale.
  assert(!isOfficialRead([qr], qr));
  // Um salto passou por um endereço de fora da lista: não vale, nem com a página final oficial.
  assert(!isOfficialRead([qr, 'https://arquivos.sefaz.rn.gov.br/x', page], page));
  // A página dos itens fora da lista.
  assert(!isOfficialRead([qr, 'https://arquivos.sefaz.rn.gov.br/x'], 'https://arquivos.sefaz.rn.gov.br/x'));
  assert(!isOfficialRead([], page));
});
