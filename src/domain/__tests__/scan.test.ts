import { describe, expect, it } from '@jest/globals';

import { accessKeyCheckDigit } from '../nfce';
import { MAX_RECEIPT_PHOTOS } from '../receiptPhotos';
import {
  addScanItems,
  changeScanQuantity,
  classifyFor,
  foundTitle,
  galleryLimit,
  listItemsFromScan,
  MAX_SCAN_QUANTITY,
  pantryRowsFromScan,
  parseScanReply,
  partsRead,
  partsTitle,
  photoStep,
  readScanCode,
  removeScanItem,
  savedToListMessage,
  savedToPantryMessage,
  scanCodeStep,
  scanHint,
  scanItemFromProduct,
  scanItemsFromRead,
  scanLeaveQuestion,
  scanModeFromParam,
  scanNothingMessage,
  scanOptions,
  scanReceiptLaterMessage,
  type ScanState,
} from '../scan';

// Uma chave de NFC-e de São Paulo com o dígito certo, e o link do QR dela.
const FIRST43 = '3526111234567800019565001000012345100001234';
const KEY = `${FIRST43}${accessKeyCheckDigit(FIRST43)}`;
const QR = `https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=${KEY}|2|1|1|A1B2C3`;

const EMPTY: ScanState = { mode: 'tudo', found: 0 };
const WITH_PRODUCTS: ScanState = { mode: 'tudo', found: 2 };
const PANTRY: ScanState = { mode: 'despensa', found: 0 };

describe('o que a câmera leu', () => {
  it('o QR de uma NFC-e é uma nota', () => {
    expect(readScanCode(QR)).toEqual({ kind: 'nota', text: QR, accessKey: KEY });
  });

  it('o código de barras com o dígito certo é um produto, com 13, 8 ou 12 dígitos', () => {
    expect(readScanCode('7891000100103')).toEqual({ kind: 'produto', gtin: '07891000100103' });
    expect(readScanCode(' 7891000100103 ')).toEqual({ kind: 'produto', gtin: '07891000100103' });
    expect(readScanCode('036000291452')).toEqual({ kind: 'produto', gtin: '00036000291452' });
  });

  it('o QR de propaganda da embalagem, o dígito errado e o vazio não são nada: a câmera segue lendo', () => {
    expect(readScanCode('https://www.marca.com.br/promocao?id=42')).toBeNull();
    expect(readScanCode('7891000100104')).toBeNull();
    expect(readScanCode('WIFI:S:casa;T:WPA;P:senha;;')).toBeNull();
    expect(readScanCode('')).toBeNull();
    expect(readScanCode(null)).toBeNull();
    expect(readScanCode(undefined)).toBeNull();
  });

  it('a nota só abre com a tela vazia: com produtos achados, ou no modo da despensa, o QR é ignorado', () => {
    const nota = readScanCode(QR);
    const produto = readScanCode('7891000100103');
    expect(scanCodeStep(nota, EMPTY)).toBe('nota');
    expect(scanCodeStep(nota, WITH_PRODUCTS)).toBe('ignorar');
    expect(scanCodeStep(nota, PANTRY)).toBe('ignorar');
    for (const state of [EMPTY, WITH_PRODUCTS, PANTRY]) expect(scanCodeStep(produto, state)).toBe('produto');
    expect(scanCodeStep(null, EMPTY)).toBe('ignorar');
  });
});

describe('depois da foto', () => {
  it('com a tela vazia a foto pode ser de uma nota comprida: espera a próxima parte, até o máximo de fotos', () => {
    expect(photoStep(EMPTY, 1)).toBe('partes');
    expect(photoStep(EMPTY, MAX_RECEIPT_PHOTOS - 1)).toBe('partes');
    expect(photoStep(EMPTY, MAX_RECEIPT_PHOTOS)).toBe('ler');
  });

  it('com produtos achados, ou no modo da despensa, a foto vai direto para a leitura, pedindo só produtos', () => {
    expect(photoStep(WITH_PRODUCTS, 1)).toBe('ler');
    expect(photoStep(PANTRY, 1)).toBe('ler');
    expect(classifyFor(EMPTY)).toBe('any');
    expect(classifyFor(WITH_PRODUCTS)).toBe('products');
    expect(classifyFor(PANTRY)).toBe('products');
  });

  it('a galeria deixa escolher as partes de uma nota, ou uma foto só quando são produtos', () => {
    expect(galleryLimit(EMPTY)).toBe(MAX_RECEIPT_PHOTOS);
    expect(galleryLimit(WITH_PRODUCTS)).toBe(1);
    expect(galleryLimit(PANTRY)).toBe(1);
  });

  it('o modo vem da URL: só "despensa" muda a câmera', () => {
    expect(scanModeFromParam('despensa')).toBe('despensa');
    expect(scanModeFromParam(['despensa', 'x'])).toBe('despensa');
    for (const value of [undefined, '', 'nota', 'tudo']) expect(scanModeFromParam(value)).toBe('tudo');
  });
});

describe('a resposta da leitura', () => {
  it('a nota lida traz o id (também da função de antes, que responde só o id)', () => {
    expect(parseScanReply({ receipt_id: 'r1', duplicate: false })).toEqual({ kind: 'nota', receiptId: 'r1', duplicate: false });
    expect(parseScanReply({ kind: 'nota', receipt_id: 'r2', duplicate: true })).toEqual({ kind: 'nota', receiptId: 'r2', duplicate: true });
  });

  it('a nota que a tela não pediu para ler volta sem id', () => {
    expect(parseScanReply({ kind: 'nota', products: [] })).toEqual({ kind: 'nota-nao-lida' });
  });

  it('os produtos chegam conferidos: nome limpo, categoria conhecida (ou "outros") e quantidade inteira de 1 a 99', () => {
    const reply = parseScanReply({
      kind: 'produtos',
      products: [
        { name: '  Arroz  Tio João 5kg ', category: 'graos', quantity: 2 },
        { name: 'Coisa', category: 'inventada', quantity: 0 },
        { name: 'Leite', category: 'laticinios', quantity: 400.7 },
        { name: 'Sem quantidade', category: 'outros' },
        { name: '   ', category: 'graos', quantity: 1 },
        { category: 'graos', quantity: 1 },
        null,
        'texto',
      ],
    });
    expect(reply).toEqual({
      kind: 'produtos',
      products: [
        { name: 'Arroz Tio João 5kg', category: 'graos', quantity: 2 },
        { name: 'Coisa', category: 'outros', quantity: 1 },
        { name: 'Leite', category: 'laticinios', quantity: MAX_SCAN_QUANTITY },
        { name: 'Sem quantidade', category: 'outros', quantity: 1 },
      ],
    });
  });

  it('"produtos" sem nenhum produto que sirva, e "nada", são nada; o que não se entende é null', () => {
    expect(parseScanReply({ kind: 'produtos', products: [] })).toEqual({ kind: 'nada' });
    expect(parseScanReply({ kind: 'produtos', products: [{ name: '' }] })).toEqual({ kind: 'nada' });
    expect(parseScanReply({ kind: 'produtos' })).toEqual({ kind: 'nada' });
    expect(parseScanReply({ kind: 'nada' })).toEqual({ kind: 'nada' });
    for (const data of [null, undefined, 'ok', 12, {}, { kind: 'outra' }, { receipt_id: '' }]) expect(parseScanReply(data)).toBeNull();
  });
});

describe('os produtos achados', () => {
  const arroz = scanItemFromProduct({ id: 'p1', name: 'Arroz Tio João 5kg', category: 'graos', shelf_life_days: 200 });
  const read = scanItemsFromRead([
    { name: 'Leite Italac 1L', category: 'laticinios', quantity: 3 },
    { name: 'Detergente Ypê 500ml', category: 'limpeza', quantity: 1 },
  ]);

  it('o produto do código de barras entra com o produto da casa; o da foto, só com o nome', () => {
    expect(arroz).toEqual({ key: 'p:p1', name: 'Arroz Tio João 5kg', category: 'graos', quantity: 1, productId: 'p1', shelfLifeDays: 200 });
    expect(read[0]).toEqual({ key: 'n:leite italac 1l', name: 'Leite Italac 1L', category: 'laticinios', quantity: 3, productId: null });
  });

  it('juntam-se na ordem em que chegam; o mesmo produto, ou o mesmo nome, soma a quantidade', () => {
    let tray = addScanItems([], [arroz]);
    tray = addScanItems(tray, read);
    tray = addScanItems(tray, [arroz]);
    tray = addScanItems(tray, scanItemsFromRead([{ name: 'LEITE ITALAC 1L ', category: 'laticinios', quantity: 2 }]));
    expect(tray.map((item) => [item.name, item.quantity])).toEqual([
      ['Arroz Tio João 5kg', 2],
      ['Leite Italac 1L', 5],
      ['Detergente Ypê 500ml', 1],
    ]);
    // Quem chamou fica com a lista de antes: nada é mudado no lugar.
    expect(arroz.quantity).toBe(1);
    expect(read[0].quantity).toBe(3);
  });

  it('a quantidade fica entre 1 e 99, somando, mudando à mão ou chegando errada', () => {
    const many = addScanItems([{ ...arroz, quantity: 98 }], [{ ...arroz, quantity: 5 }]);
    expect(many[0].quantity).toBe(MAX_SCAN_QUANTITY);
    expect(changeScanQuantity(many, arroz.key, 1)[0].quantity).toBe(MAX_SCAN_QUANTITY);
    expect(changeScanQuantity([arroz], arroz.key, -1)[0].quantity).toBe(1);
    expect(changeScanQuantity([arroz], arroz.key, 2)[0].quantity).toBe(3);
    expect(changeScanQuantity([arroz], 'outra', 2)[0].quantity).toBe(1);
    expect(addScanItems([], [{ ...arroz, quantity: 0 }])[0].quantity).toBe(1);
  });

  it('tirar um achado deixa os outros como estão', () => {
    const tray = addScanItems([arroz], read);
    expect(removeScanItem(tray, read[0].key).map((item) => item.name)).toEqual(['Arroz Tio João 5kg', 'Detergente Ypê 500ml']);
    expect(removeScanItem(tray, 'outra')).toHaveLength(3);
  });

  it('na despensa entram em unidades, com a data de hoje e a validade estimada como a do formulário', () => {
    const rows = pantryRowsFromScan(addScanItems([arroz], read), '2026-11-14');
    expect(rows[0]).toEqual({
      name: 'Arroz Tio João 5kg',
      category: 'graos',
      quantity: 1,
      unit: 'un',
      purchased_on: '2026-11-14',
      // A validade que o produto já ensinou à casa.
      expires_on: '2027-06-02',
      expiry_source: 'produto',
      product_id: 'p1',
    });
    // O da foto, sem produto: a validade da categoria (laticínios vencem em poucos dias).
    expect(rows[1]).toMatchObject({ name: 'Leite Italac 1L', quantity: 3, product_id: null, expiry_source: 'categoria' });
    expect(rows[1].expires_on).not.toBeNull();
    // Categoria sem validade padrão: sem data e sem origem.
    expect(rows[2]).toMatchObject({ name: 'Detergente Ypê 500ml', expires_on: null, expiry_source: null });
  });

  it('na lista entram sem a marca, como tudo que vai para a lista, com o produto como dica de preço', () => {
    const items = listItemsFromScan(addScanItems([arroz], read));
    expect(items[0]).toEqual({ name: 'Arroz', category: 'graos', productId: 'p1', quantity: 1, unit: 'un' });
    expect(items[1]).toMatchObject({ name: 'Leite', productId: null, quantity: 3 });
    expect(items[2]).toMatchObject({ name: 'Detergente', category: 'limpeza' });
  });
});

describe('os textos', () => {
  it('a frase da câmera diz o que ela lê agora', () => {
    expect(scanHint(EMPTY)).toContain('QR code da nota');
    expect(scanHint(WITH_PRODUCTS)).not.toContain('QR code');
    expect(scanHint(WITH_PRODUCTS)).toContain('A nota fica para depois');
    expect(scanHint(PANTRY)).toContain('prateleira');
    expect(scanHint(PANTRY)).not.toContain('nota');
  });

  it('as opções além da câmera: as da nota saem quando a tela está só nos produtos', () => {
    expect(scanOptions(EMPTY)).toEqual(['galeria', 'link', 'codigo', 'manual']);
    expect(scanOptions(WITH_PRODUCTS)).toEqual(['galeria', 'codigo']);
    expect(scanOptions(PANTRY)).toEqual(['galeria', 'codigo']);
  });

  it('contagens no singular e no plural', () => {
    expect([foundTitle(1), foundTitle(3)]).toEqual(['1 produto achado', '3 produtos achados']);
    expect([partsTitle(1), partsTitle(2)]).toEqual(['Foto tirada', '2 fotos tiradas']);
    expect([partsRead(1), partsRead(3)]).toEqual(['Ler', 'Ler (3 fotos)']);
    expect([savedToPantryMessage(1), savedToPantryMessage(4)]).toEqual(['1 item foi para a despensa.', '4 itens foram para a despensa.']);
    expect([scanLeaveQuestion(1), scanLeaveQuestion(2)]).toEqual([
      'O produto achado ainda não foi guardado.',
      'Os 2 produtos achados ainda não foram guardados.',
    ]);
  });

  it('o que foi para a lista, e o que já estava lá', () => {
    expect(savedToListMessage(1, 0, 'Mercado')).toBe('1 item foi para a lista "Mercado".');
    expect(savedToListMessage(3, 0, 'Mercado')).toBe('3 itens foram para a lista "Mercado".');
    expect(savedToListMessage(2, 1, 'Mercado')).toBe('2 itens foram para a lista "Mercado". 1 já estava lá.');
    expect(savedToListMessage(1, 2, 'Mercado')).toBe('1 item foi para a lista "Mercado". 2 já estavam lá.');
    expect(savedToListMessage(0, 1, 'Mercado')).toBe('Já estava na lista "Mercado".');
    expect(savedToListMessage(0, 3, 'Mercado')).toBe('Já estava tudo na lista "Mercado".');
  });

  it('a foto que não serviu diz o que tentar, pela tela em que foi tirada', () => {
    expect(scanNothingMessage(EMPTY)).toContain('uma nota nem um produto');
    expect(scanNothingMessage(PANTRY)).toContain('nenhum produto');
    expect(scanReceiptLaterMessage(PANTRY)).toContain('Escanear da tela Hoje');
    expect(scanReceiptLaterMessage(WITH_PRODUCTS)).toContain('Guarde antes os produtos');
  });
});
