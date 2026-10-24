import { describe, expect, it } from '@jest/globals';

import { findSamePurchase, receiptPantryRepeats } from '../cartPantry';
import { learnAbbreviations, NO_LEARNED, suggestedNoteName, withLearned, type AliasPair } from '../learnedAbbreviations';
import { LinkIndex, matchListItems, receiptLineName, receiptLineNames, type OpenListItem, type ReceiptLine } from '../listLinks';
import { nfceItemsToDraft } from '../nfce';
import { sameListedName } from '../similarNames';

const pair = (description: string, productName: string): AliasPair => ({ description, productName });
const learnedWords = (...pairs: AliasPair[]) => Object.fromEntries(learnAbbreviations(pairs).words);

// Descrições como os mercados escrevem, com o nome que uma casa deu ao produto (nomes inventados ou de prateleira).
const HOUSE: AliasPair[] = [
  pair('MAC INST NIS GAL 85G', 'Macarrão Instantâneo Nissin Galinha 85g'),
  pair('AZ POR EU PARUS VD', 'Azeite'),
  pair('IOG NAT DAN INT 160G', 'Iogurte Natural Danone Integral 160g'),
  pair('ESP SB N RISC LAR 3', 'Esponja Não Risca'),
  pair('PATINHO B RESF BIF K', 'Patinho Bovino Resfriado Bife Kg'),
  pair('QJ MUSS IFAT KG', 'Queijo Muçarela Importado Fatiado 200g'),
];

describe('learnAbbreviations: o que a casa ensinou com as notas', () => {
  it('cada palavra da nota que abrevia uma palavra só do nome, de marca ou não', () => {
    expect(learnedWords(...HOUSE)).toEqual({
      nis: 'nissin',
      gal: 'galinha',
      az: 'azeite',
      nat: 'natural',
      dan: 'danone',
      esp: 'esponja',
      risc: 'risca',
      bif: 'bife',
    });
    expect(learnedWords(pair('LT INTEG PIRAC 1L', 'Leite Integral Piracanjuba 1L'))).toEqual({ pirac: 'piracanjuba' });
    expect(learnedWords(pair('ARROZ PARB TIO JOAO 5KG', 'Arroz Parboilizado Tio João 5kg'))).toEqual({ parb: 'parboilizado' });
  });

  it('a nota de 20/10, lida pela foto e quase sem abreviação, não ensina nada errado', () => {
    const note = [
      pair('UVA VITORIA RESERVA', 'Uva'),
      pair('LEITE UHT PARMALAT CX', 'Leite UHT Parmalat Caixa'),
      pair('CEBOLINHA H.SEMPRE', 'Cebolinha H.Sempre'),
      pair('SALSA ORGÂNICO UN', 'Salsa Orgânica'),
      pair('MANJERICÃO ORGÂNICO', 'Manjericão Unidade'),
      pair('PÃO DE FORMA PÃO DE', 'Pão de Forma'),
      pair('REQUEIJÃO CATUPIRY', 'Requeijão'),
      pair('PASTILHA MENTOS 30MIN', 'Pastilha Mentos'),
      pair('ÁGUA SANITÁRIA DRAGÃO', 'Água Sanitária Dragão Frasco 1l'),
      pair('CAFÉ 3 CORAÇÕES', 'Café 3 Corações'),
      pair('REFRIG COCA-COLA ZERO', 'Refrigerante Coca-Cola Zero'),
      pair('OVOS RANCHO CAIPIRA', 'Ovos Rancho Caipira'),
      pair('POLPA BEMAIS 100G', 'Polpa de fruta'),
      pair('FILÉ PEITO FRG SADIA', 'Filé de Peito de Frango Congelado Sadia 1kg'),
      pair('BOMBOM DA ALCATRA', 'Bombom da Alcatra'),
    ];
    expect(learnedWords(...note)).toEqual({});
  });

  it('número, medida, unidade, ligação e letra solta não se aprendem', () => {
    expect(
      learnedWords(
        pair('AGUA MIN 5L PCT C/6 UN', 'Água Mineral Pacote 6 Unidades'),
        pair('FARINHA MAND 1KG CX', 'Farinha de Mandioca Caixa 1kg'),
        pair('LEITE S/LACTOSE LT 1L', 'Leite sem lactose Lata Litro'),
      ),
    ).toEqual({ min: 'mineral', mand: 'mandioca' });
  });

  it('a palavra que já está inteira no nome, ou que serve para duas palavras dele, fica de fora', () => {
    // "pao" é palavra inteira (e do app); "choc" serve para chocolate e chocolatudo.
    expect(learnedWords(pair('PAO DE MEL CHOCOLATUDO', 'Pão de Mel'))).toEqual({});
    expect(learnedWords(pair('CHOCOL CHOCOLATUDO', 'Chocolate Chocolatudo'))).toEqual({});
    // Duas letras, só o começo da palavra: o "El" do vinho não é "espanhol".
    expect(learnedWords(pair('Vinho Tinto Espanhol El Ninot', 'Vinho Tinto Espanhol El Ninot'))).toEqual({});
    expect(learnedWords(pair('VINHO TTO EL NINOT', 'Vinho Tinto Espanhol'))).toEqual({ tto: 'tinto' });
  });

  it('uma palavra que a casa viu abreviando duas coisas é ambígua e fica de fora', () => {
    const sabao = pair('SAB OMO 1KG', 'Sabão Omo 1kg');
    const sabonete = pair('SAB DOVE 90G', 'Sabonete Dove 90g');
    expect(learnedWords(sabao)).toEqual({ sab: 'sabao' });
    expect(learnedWords(sabonete)).toEqual({ sab: 'sabonete' });
    expect(learnedWords(sabao, sabonete)).toEqual({});
    // Também quando a casa escreveu a palavra inteira no nome de outro produto.
    expect(learnedWords(pair('IOGURTE NAT 170G', 'Iogurte natural'))).toEqual({ nat: 'natural' });
    expect(learnedWords(pair('IOGURTE NAT 170G', 'Iogurte natural'), pair('NAT CHIPS 50G', 'Salgadinho Nat Chips'))).toEqual({});
  });

  it('o nome que é só o texto da nota (a sugestão aceita) não ensina nem tira nada', () => {
    const accepted = pair('AZ GALLO 500ML', 'Az gallo 500ml');
    const trimmed = pair('AZ ANDORINHA 500ML', 'Az Andorinha');
    expect(learnedWords(accepted, trimmed)).toEqual({});
    expect(learnedWords(accepted, trimmed, pair('AZ POR EU PARUS VD', 'Azeite'))).toEqual({ az: 'azeite' });
  });

  it('não troca o que a tabela fixa já decide, nem as travas dela', () => {
    // "INT" e "DESN" a tabela já escreve por extenso; "LT" é medida (é leite só onde a tabela diz).
    expect(learnedWords(pair('LT INT DESN 1L', 'Leite Integral Desnatado 1L'))).toEqual({});
    // Sozinho, "FERM" é fermento; depois de leite, a tabela já disse fermentado.
    expect(learnedWords(pair('LEITE FERM YAKULT', 'Leite Fermentado Yakult'))).toEqual({});
    // "MASC" é o açúcar mascavo nas regras fixas: ensinado como masculino, não muda.
    expect(learnedWords(pair('DESOD AER MASC REXONA', 'Desodorante Aerosol Masculino Rexona'))).toEqual({ aer: 'aerosol' });
    expect(learnedWords(pair('ACUCAR MASC UNIAO', 'Açúcar Mascavo União'))).toEqual({ masc: 'mascavo' });
  });

  it('guarda a grafia com acento da casa', () => {
    const { spellings } = learnAbbreviations([pair('REQ CATUPIRY', 'Requeijão Catupiry')], ['Feijão Carioca']);
    expect(spellings.get('requeijao')).toBe('requeijão');
    expect(spellings.get('feijao')).toBe('feijão');
    expect(spellings.has('catupiry')).toBe(false);
    // O acento escrito à parte da letra (NFD) é da mesma palavra.
    const nfd = learnAbbreviations([pair('REQ CATUPIRY', 'Requeijão Catupiry'.normalize('NFD'))]);
    expect(nfd.words.get('req')).toBeUndefined();
    expect(nfd.spellings.get('requeijao')).toBe('requeijão');
  });
});

describe('withLearned: a descrição com as aprendidas por extenso', () => {
  const learned = learnAbbreviations(HOUSE);

  it('com a tabela fixa junto; sem nenhuma aprendida no texto, null (as regras de sempre leem)', () => {
    expect(withLearned('AZ GALLO 500ML', learned)).toBe('azeite gallo 500ml');
    expect(withLearned('MAC INST NIS CARNE', learned)).toBe('macarrao instantaneo nissin carne');
    expect(withLearned('MAC INST MIOJO', learned)).toBeNull();
    expect(withLearned('AZ GALLO 500ML', NO_LEARNED)).toBeNull();
  });

  it('a aprendida que é um item só entra onde o texto não diz outro item', () => {
    // "ESP" a casa ensinou como esponja; no macarrão, é o espaguete, que ela nunca confirmou.
    expect(withLearned('MAC ESP RENATA 500G', learned)).toBeNull();
    expect(suggestedNoteName('MAC ESP RENATA 500G', learned)).toBe('Macarrão esp renata 500g');
    expect(withLearned('ESP SCOTCH BRITE', learned)).toBe('esponja scotch brite');
    // O bife é carne, como a alcatra: entra.
    expect(withLearned('BIF ALCATRA RESF KG', learned)).toBe('bife alcatra resfriado kg');
    // A marca e o sabor entram sempre.
    expect(withLearned('CALDO GAL KNORR', learned)).toBe('caldo galinha knorr');
  });
});

describe('suggestedNoteName: o nome sugerido do item novo da nota do QR code', () => {
  it('a tabela fixa por extenso, com acento quando se sabe', () => {
    expect(suggestedNoteName('LT INTEG PIRAC 1L')).toBe('Leite integral pirac 1l');
    expect(suggestedNoteName('REQ CATUPIRY 200G')).toBe('Requeijão catupiry 200g');
    expect(suggestedNoteName('PAP.HIG. NEVE 12UN')).toBe('Papel higiênico neve 12un');
    expect(suggestedNoteName('PAP.HIG.NEVE 12UN')).toBe('Papel higiênico neve 12un');
    expect(suggestedNoteName('COCA S ACUCAR 1,5L')).toBe('Coca sem açúcar 1,5l');
    expect(suggestedNoteName('SAB PO OMO 1KG')).toBe('Sabão em pó omo 1kg');
  });

  it('as aprendidas da casa, a marca também', () => {
    const learned = learnAbbreviations([...HOUSE, pair('LT INTEG PIRAC 1L', 'Leite Integral Piracanjuba 1L')]);
    expect(suggestedNoteName('LT DESN PIRAC 1L', learned)).toBe('Leite desnatado piracanjuba 1l');
    expect(suggestedNoteName('AZ GALLO 500ML', learned)).toBe('Azeite gallo 500ml');
    expect(suggestedNoteName('MAC INST NIS CARNE 85G', learned)).toBe('Macarrão instantâneo nissin carne 85g');
  });

  it('nunca piora: a tabela só onde diz o item ou o tipo dele, e o que não se sabe fica', () => {
    // "INT" do frango é o inteiro, e "PRES" depois da manteiga é a marca (President), e não o presunto.
    expect(suggestedNoteName('FRANGO INT CONG')).toBeNull();
    expect(suggestedNoteName('MANT PRES 200G')).toBe('Manteiga pres 200g');
    expect(suggestedNoteName('ARROZ T.JOAO TP1 5KG')).toBeNull();
    expect(suggestedNoteName('  ')).toBeNull();
  });

  it('nfceItemsToDraft: o nome sugerido com as abreviações; o que não muda fica como a nota', () => {
    const learned = learnAbbreviations(HOUSE);
    const item = (description: string) => ({ description, code: null, quantity: 1, unit: 'UN', unitPrice: 9.9, totalPrice: 9.9 });
    const draft = nfceItemsToDraft([item('AZ GALLO 500ML'), item('LT INTEG PIRAC 1L'), item('ARROZ T.JOAO TP1 5KG')], new Map(), new Map(), learned);
    expect(draft.map((line) => line.suggested_name)).toEqual(['Azeite gallo 500ml', 'Leite integral pirac 1l', 'Arroz t.joao tp1 5kg']);
    // A descrição fica como a nota escreve: é por ela que a casa aprende.
    expect(draft[0].raw_description).toBe('AZ GALLO 500ML');
    expect(nfceItemsToDraft([item('AZ GALLO 500ML')], new Map())[0].suggested_name).toBe('Az gallo 500ml');
  });
});

describe('matchListItems com as abreviações aprendidas', () => {
  const IN_CART = '2026-10-20T10:00:00.000Z';
  const listItem = (id: string, name: string, category: string, inCart = false): OpenListItem => ({
    id,
    name,
    category,
    product_id: null,
    checked_at: inCart ? IN_CART : null,
  });
  // A linha de um produto novo da nota do QR code, como a revisão a monta.
  const qrLine = (id: string, raw: string, category: string, learned = NO_LEARNED): ReceiptLine => {
    const suggestedName = suggestedNoteName(raw, learned) ?? raw;
    return {
      id,
      productId: null,
      name: receiptLineName({ source: 'qrcode', productName: suggestedName, isNew: true, suggestedName, rawDescription: raw }),
      names: receiptLineNames({ productName: suggestedName, suggestedName, rawDescription: raw }, learned),
      category,
    };
  };
  const match = (items: OpenListItem[], lines: ReceiptLine[]) => matchListItems(items, lines, new LinkIndex(), sameListedName);
  const learned = learnAbbreviations(HOUSE);

  it('a linha que hoje não casa passa a vir como sugestão', () => {
    const azeite = listItem('l1', 'Azeite', 'oleos');
    expect(match([azeite], [qrLine('r1', 'AZ GALLO 500ML', 'outros')])).toEqual([]);
    expect(match([azeite], [qrLine('r1', 'AZ GALLO 500ML', 'outros', learned)])).toEqual([
      { listItemId: 'l1', receiptItemId: 'r1', reason: 'nome', checked: false },
    ]);
  });

  it('marcar sozinho segue a regra do dono: só no carrinho e com uma linha só que é o item', () => {
    const inCart = listItem('l1', 'Azeite', 'oleos', true);
    const gallo = qrLine('r1', 'AZ GALLO 500ML', 'outros', learned);
    expect(match([inCart], [gallo])).toEqual([{ listItemId: 'l1', receiptItemId: 'r1', reason: 'item', checked: true }]);
    // Duas linhas que são azeite: a pessoa escolhe.
    const andorinha = qrLine('r2', 'AZ ANDORINHA 500ML', 'outros', learned);
    expect(match([inCart], [gallo, andorinha])).toEqual([{ listItemId: 'l1', receiptItemId: 'r1', reason: 'nome', checked: false }]);
    // O nome sugerido por extenso ("Azeite gallo 500ml") não vira "o mesmo nome" do item fora do carrinho.
    const azeite = qrLine('r3', 'AZ 500ML', 'outros', learned);
    expect(azeite.names[0]).toBe('Azeite 500ml');
    expect(match([listItem('l2', 'Azeite', 'oleos')], [azeite])).toEqual([{ listItemId: 'l2', receiptItemId: 'r3', reason: 'nome', checked: false }]);
  });

  it('as travas continuam: lida por extenso, a linha que diz outra coisa não casa', () => {
    const natural = listItem('l1', 'Iogurte natural', 'laticinios', true);
    // "MOR" não foi ensinado, mas "IOG DAN NAT" é o natural e "IOG DAN MORANGO" é outro sabor.
    expect(match([natural], [qrLine('r1', 'IOG DAN NAT 170G', 'laticinios', learned), qrLine('r2', 'IOG DAN MORANGO 170G', 'laticinios', learned)])).toEqual([
      { listItemId: 'l1', receiptItemId: 'r1', reason: 'item', checked: true },
    ]);
  });

  it('a abreviação ambígua não casa', () => {
    const condicionador = pair('CND PANTENE 200ML', 'Condicionador Pantene 200ml');
    const condensado = pair('LTE CND MOCA 395G', 'Leite Condensado Moça 395g');
    const item = listItem('l1', 'Condicionador', 'higiene');
    const seda = (taught: AliasPair[]) => qrLine('r1', 'CND SEDA 300ML', 'outros', learnAbbreviations(taught));
    expect(match([item], [seda([condicionador])])).toEqual([{ listItemId: 'l1', receiptItemId: 'r1', reason: 'nome', checked: false }]);
    expect(match([item], [seda([condicionador, condensado])])).toEqual([]);
  });

  it('o nome do produto que a casa deu não passa pelas abreviações; a sugestão e o texto da nota, sim', () => {
    expect(receiptLineNames({ productName: 'Az do sítio', suggestedName: 'Az gallo', rawDescription: 'AZ GALLO' }, learned)).toEqual([
      'Az do sítio',
      'azeite gallo',
      'azeite gallo',
    ]);
    // A nota da foto (ou de antes) fica como era.
    expect(receiptLineName({ source: 'ai', productName: 'Azeite gallo', isNew: true, suggestedName: 'Azeite gallo', rawDescription: 'AZ GALLO' })).toBe(
      'Azeite gallo',
    );
    expect(receiptLineName({ source: 'qrcode', productName: 'Az gallo', isNew: true, suggestedName: 'Az gallo', rawDescription: 'AZ GALLO' })).toBe('Az gallo');
  });
});

describe('a despensa com as abreviações aprendidas', () => {
  const learned = learnAbbreviations(HOUSE);
  const entries = [{ product_id: 'p-gallo', name: 'Az gallo 500ml', purchased_on: '2026-10-20' }];

  it('o "Azeite" do carrinho é o produto que ficou com o nome da nota', () => {
    expect(findSamePurchase({ productId: null, name: 'Azeite' }, '2026-10-20', entries)).toBeUndefined();
    expect(findSamePurchase({ productId: null, name: 'Azeite' }, '2026-10-20', entries, new LinkIndex(), 'nomeSolto', learned)).toBe(entries[0]);
    expect(
      receiptPantryRepeats([{ id: 'r1', product_id: 'p-outro', pantry: { name: 'Az andorinha' } }], '2026-10-20', [
        { product_id: null, name: 'Azeite', purchased_on: '2026-10-20' },
      ], new LinkIndex(), learned),
    ).toEqual([{ id: 'r1', name: 'Az andorinha', since: '2026-10-20' }]);
  });
});
