import { describe, expect, it } from '@jest/globals';

import { accessKeyCheckDigit, nfceItemsToDraft, normalizeNfceUnit, parseNfceQr } from '../nfce';

// SP (35), set/2026, CNPJ 12.345.678/0001-99, modelo 65, série 1, nota 12345.
const BODY = '35' + '2609' + '12345678000199' + '65' + '001' + '000012345' + '1' + '12345678';
const KEY = BODY + accessKeyCheckDigit(BODY);

describe('parseNfceQr', () => {
  it('lê o link do QR (consulta pública da Sefaz)', () => {
    const url = `https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=${KEY}|2|1|1|A1B2C3`;
    expect(parseNfceQr(url)).toEqual({
      url: expect.stringContaining('nfce.fazenda.sp.gov.br'),
      accessKey: KEY,
      uf: '35',
      cnpj: '12345678000199',
      month: '2026-09',
    });
  });

  it('aceita a chave digitada, com espaços', () => {
    const typed = KEY.replace(/(\d{4})/g, '$1 ');
    expect(parseNfceQr(typed)).toMatchObject({ url: null, accessKey: KEY });
  });

  it('recusa chave com dígito errado, NF-e (modelo 55) e texto qualquer', () => {
    const wrong = KEY.slice(0, 43) + ((Number(KEY[43]) + 1) % 10);
    expect(parseNfceQr(wrong)).toBeNull();
    const nfe = BODY.slice(0, 20) + '55' + BODY.slice(22);
    expect(parseNfceQr(nfe + accessKeyCheckDigit(nfe))).toBeNull();
    expect(parseNfceQr('https://example.com/?p=123')).toBeNull();
    expect(parseNfceQr('oi')).toBeNull();
  });
});

describe('nfceItemsToDraft', () => {
  it('converte unidades, sugere nome e categoria, e usa o produto já conhecido', () => {
    const draft = nfceItemsToDraft(
      [
        { description: 'ARROZ T.JOAO TP1 5KG', code: '123', quantity: 1, unit: 'UN', unitPrice: 24.9, totalPrice: 24.9 },
        { description: 'BANANA PRATA  KG', code: null, quantity: 0.325, unit: 'KG', unitPrice: 5.99, totalPrice: 1.95 },
        { description: 'DETERG YPE NEUTRO 500ML', code: null, quantity: 2, unit: 'PCT', unitPrice: 0, totalPrice: 5.58 },
      ],
      new Map([['ARROZ T.JOAO TP1 5KG', { productId: 'p-arroz', category: 'graos' }]]),
    );
    expect(draft).toEqual([
      expect.objectContaining({ position: 0, product_id: 'p-arroz', suggested_category: 'graos', unit: 'un', total_price: 24.9 }),
      expect.objectContaining({
        position: 1,
        raw_description: 'BANANA PRATA KG',
        suggested_name: 'Banana prata kg',
        suggested_category: 'hortifruti',
        unit: 'kg',
        quantity: 0.325,
      }),
      expect.objectContaining({ position: 2, product_id: null, suggested_category: 'limpeza', unit_price: 2.79 }),
    ]);
    expect(normalizeNfceUnit(' lt ')).toBe('l');
  });
});
