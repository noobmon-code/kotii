import { assertEquals } from '@std/assert';

import { accessKeyFromQr, STATE_CODES, stateFromCode, stateOfQr } from './uf.ts';

const KEY_PB = '25260912345678000190650010000123451000012347';

Deno.test('as 27 UFs pelo código IBGE, com a preposição de costume', () => {
  const table = STATE_CODES.map((code) => {
    const state = stateFromCode(code)!;
    return [state.code, state.uf, state.of];
  });
  assertEquals(table, [
    ['11', 'RO', 'de Rondônia'],
    ['12', 'AC', 'do Acre'],
    ['13', 'AM', 'do Amazonas'],
    ['14', 'RR', 'de Roraima'],
    ['15', 'PA', 'do Pará'],
    ['16', 'AP', 'do Amapá'],
    ['17', 'TO', 'do Tocantins'],
    ['21', 'MA', 'do Maranhão'],
    ['22', 'PI', 'do Piauí'],
    ['23', 'CE', 'do Ceará'],
    ['24', 'RN', 'do Rio Grande do Norte'],
    ['25', 'PB', 'da Paraíba'],
    ['26', 'PE', 'de Pernambuco'],
    ['27', 'AL', 'de Alagoas'],
    ['28', 'SE', 'de Sergipe'],
    ['29', 'BA', 'da Bahia'],
    ['31', 'MG', 'de Minas Gerais'],
    ['32', 'ES', 'do Espírito Santo'],
    ['33', 'RJ', 'do Rio de Janeiro'],
    ['35', 'SP', 'de São Paulo'],
    ['41', 'PR', 'do Paraná'],
    ['42', 'SC', 'de Santa Catarina'],
    ['43', 'RS', 'do Rio Grande do Sul'],
    ['50', 'MS', 'de Mato Grosso do Sul'],
    ['51', 'MT', 'de Mato Grosso'],
    ['52', 'GO', 'de Goiás'],
    ['53', 'DF', 'do Distrito Federal'],
  ]);
  assertEquals(new Set(table.map(([, uf]) => uf)).size, 27);
});

Deno.test('Paraíba pelo código', () => {
  assertEquals(stateFromCode('25'), { code: '25', uf: 'PB', name: 'Paraíba', of: 'da Paraíba' });
});

Deno.test('código que não é de UF', () => {
  for (const code of ['', '00', '10', '34', '54', '99', '2', '250', 'constructor', 'toString']) {
    assertEquals(stateFromCode(code), null, code);
  }
});

Deno.test('chave de acesso do link do QR', () => {
  assertEquals(accessKeyFromQr(`http://www.sefaz.pb.gov.br/nfce?p=${KEY_PB}|3|1`), KEY_PB);
  assertEquals(accessKeyFromQr(`http://www.sefaz.pb.gov.br/nfce?p=${KEY_PB}%7C3%7C1`), KEY_PB);
  assertEquals(accessKeyFromQr(`https://www.nfce.fazenda.sp.gov.br/qrcode?chNFe=${KEY_PB}&nVersao=100`), KEY_PB);
  assertEquals(accessKeyFromQr('http://www.sefaz.pb.gov.br/nfce?p=123|3|1'), null);
  assertEquals(accessKeyFromQr('http://www.sefaz.pb.gov.br/nfce'), null);
  assertEquals(accessKeyFromQr('não é link'), null);
});

Deno.test('UF da nota pelo link do QR', () => {
  assertEquals(stateOfQr(`http://www.sefaz.pb.gov.br/nfce?p=${KEY_PB}|3|1`)?.uf, 'PB');
  assertEquals(stateOfQr(`https://www.nfce.fazenda.sp.gov.br/qrcode?p=35${KEY_PB.slice(2)}|2|1`)?.of, 'de São Paulo');
  assertEquals(stateOfQr(`https://www.sefaz.x.gov.br/nfce?p=99${KEY_PB.slice(2)}`), null);
  assertEquals(stateOfQr('https://www.sefaz.x.gov.br/nfce'), null);
});
