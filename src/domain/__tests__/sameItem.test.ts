import { describe, expect, it } from '@jest/globals';

import { LinkIndex, matchListItems, receiptLineNames, type OpenListItem, type ReceiptLine } from '../listLinks';
import { itemIdentity, sameItemFit, spelledOut, spellOut, termWords, wordOverlap } from '../sameItem';
import { guessCategory } from '../search';
import { sameListedName } from '../similarNames';

const fit = (listName: string, receiptName: string, categories: { list?: string; receipt?: string } = {}) =>
  sameItemFit({ name: listName, category: categories.list }, { names: [receiptName], category: categories.receipt });
const keyOf = (name: string) => itemIdentity(name)?.key ?? null;

const IN_CART = '2026-10-20T10:00:00.000Z';
const listItem = (id: string, name: string, category: string, inCart = false, product_id: string | null = null): OpenListItem => ({
  id,
  name,
  category,
  product_id,
  checked_at: inCart ? IN_CART : null,
});
const line = (id: string, raw: string, product: string, category: string, productId: string | null = `p-${id}`): ReceiptLine => ({
  id,
  productId,
  name: product,
  names: [product, raw],
  category,
});

describe('itemIdentity: o item sem a marca, a embalagem nem o tamanho', () => {
  it('a marca e a embalagem não mudam o item', () => {
    expect(keyOf('Leite UHT Serrana Caixa')).toBe('leite');
    expect(keyOf('Ovo Fazendinha Caipira')).toBe('ovos');
    expect(keyOf('Salsa Maço')).toBe('salsa');
    expect(keyOf('Café Boa Tarde 500g')).toBe('cafe');
    expect(keyOf('Pastilha Frescor')).toBeNull();
  });

  it('nomes regionais e abreviações comuns de NFC-e', () => {
    expect(keyOf('Pão de caixa')).toBe('pao_forma');
    expect(keyOf('PAO FORMA SOL 500G')).toBe('pao_forma');
    expect(keyOf('Refri')).toBe('refrigerante');
    expect(keyOf('REFRIG COLA ZERO 2L')).toBe('refrigerante');
    expect(keyOf('DET LIQ LIMPA BEM 500ML')).toBe('detergente');
    expect(keyOf('LTE UHT INT 1L')).toBe('leite');
    expect(keyOf('PAP HIG FOLHA DUPLA 12 ROLOS')).toBe('papel_higienico');
    expect(keyOf('QJO MUSS FATIADO KG')).toBe('mussarela');
    expect(keyOf('REQ CREMOSO 200G')).toBe('requeijao');
    expect(keyOf('MARGAR CREMOSA 500G')).toBe('margarina');
    expect(keyOf('AG SANIT 2L')).toBe('agua_sanitaria');
    expect(keyOf('Macaxeira')).toBe('mandioca');
    expect(keyOf('Jerimum')).toBe('abobora');
    expect(keyOf('Salsinha')).toBe('salsa');
    expect(spelledOut('CAF TORR MOID 500G')).toBe('cafe torrado moido 500g');
  });

  it('"LT" logo antes do tipo do leite é o leite; em outro lugar, é litro (ou lata)', () => {
    expect(spelledOut('LT INTEG PIRAC 1L')).toBe('leite integral pirac 1l');
    expect(spelledOut('LT DESN ITALAC')).toBe('leite desnatado italac');
    expect(spelledOut('LT UHT PARMALAT')).toBe('leite uht parmalat');
    expect(keyOf('LT INTEG PIRAC 1L')).toBe('leite');
    expect(spelledOut('CERV SKOL LT 350ML')).toBe('cerveja skol lt 350ml');
    expect(spelledOut('REQUEIJAO LT 200G')).toBe('requeijao light 200g');
    // Só no começo: no meio, "LT" é o light do pão, não o leite.
    expect(spelledOut('PAO FORMA LT INTEG')).toBe('pao forma lt integral');
    expect(keyOf('PAO FORMA LT INTEG')).toBe('pao_forma');
  });

  it('spellOut: cada palavra por extenso sabe de que palavras da nota saiu', () => {
    expect(spellOut(termWords('PAP.HIG. NEVE'))).toEqual([
      { word: 'papel', from: [0, 1] },
      { word: 'higienico', from: [0, 1] },
      { word: 'neve', from: [2, 2] },
    ]);
    expect(spellOut(termWords('LT INTEG'))).toEqual([
      { word: 'leite', from: [0, 1] },
      { word: 'integral', from: [0, 1] },
    ]);
    expect(spellOut(termWords(''))).toEqual([]);
    // Sem os nomes regionais (o nome sugerido): "pao de caixa" fica.
    expect(spellOut(termWords('PAO DE CAIXA'), { regional: false }).map(({ word }) => word)).toEqual(['pao', 'de', 'caixa']);
    expect(spellOut(termWords('PAO DE CAIXA')).map(({ word }) => word)).toEqual(['pao', 'de', 'forma']);
  });

  it('"SEMI DESN" é o semidesnatado, e não o desnatado', () => {
    expect(spelledOut('LEITE SEMI DESN PIRAC')).toBe('leite semidesnatado pirac');
    expect(spelledOut('LT SEMI DESN PIRAC')).toBe('leite semidesnatado pirac');
    expect(spelledOut('LEITE SEMI DESNATADO')).toBe('leite semidesnatado');
    expect(sameItemFit({ name: 'Leite desnatado' }, { names: ['LEITE SEMI DESN PIRAC'] })).toBe('outro');
    expect(sameItemFit({ name: 'Leite semidesnatado' }, { names: ['LEITE SEMI DESN PIRAC'] })).toBe('mesmo');
  });

  it('"Gilete" na lista é a lâmina; o "GILLETTE" da nota é a marca e sozinho não diz o item', () => {
    expect(keyOf('Gilete')).toBe('barbear');
    expect(keyOf('Lâmina de barbear')).toBe('barbear');
    expect(keyOf('GILLETTE APARELHO')).toBeNull();
    expect(keyOf('GILLETTE ESPUMA 200ML')).toBeNull();
  });

  it('o corte e a variedade ficam com a família', () => {
    expect(itemIdentity('Bombom da Alcatra')).toMatchObject({ key: 'alcatra', family: 'carne' });
    expect(itemIdentity('FILE PEITO FRG CONG 1KG')).toMatchObject({ key: 'peito_frango', family: 'frango' });
    expect(itemIdentity('Carne moída de patinho')).toMatchObject({ key: 'patinho', family: 'carne' });
    expect(itemIdentity('Queijo prato fatiado')).toMatchObject({ key: 'prato', family: 'queijo' });
    expect(itemIdentity('Carne')).toMatchObject({ key: 'carne', family: 'carne' });
  });

  it('com a categoria, só vale o item do mesmo grupo', () => {
    expect(itemIdentity('Água oxigenada', 'higiene')).toBeNull();
    expect(itemIdentity('Ração sabor frango', 'pet')?.key).toBe('racao');
    expect(itemIdentity('Leite de magnésia', 'medicamentos')).toBeNull();
  });
});

describe('sameItemFit: as travas (o que parece, mas é outra coisa)', () => {
  // Os pares de risco do estudo: nenhum vem marcado; os que são outra coisa nem viram sugestão.
  const other: [string, string][] = [
    ['Leite', 'Leite condensado Boa Vaca'],
    ['Leite', 'Creme de leite Vale 200g'],
    ['Leite', 'Doce de leite'],
    ['Leite', 'Leite de coco Sol 200ml'],
    ['Leite', 'LEITE EM PO VALE 400G'],
    ['Leite integral', 'Leite UHT Desnatado Serrana'],
    ['Leite semidesnatado', 'LEITE INTEGRAL SERRANA 1L'],
    ['leite desnatado', 'LEITE SERRA INT 1L'],
    ['Café em pó', 'Café em cápsula Boa Tarde'],
    ['Café', 'Filtro de café 103'],
    ['Coca zero', 'Guaraná Tropical 2L'],
    ['Coca zero', 'Coca-Cola Original 2L'],
    ['Queijo muçarela', 'Queijo parmesão ralado'],
    ['Pão', 'Pão de queijo congelado'],
    ['Água', 'Água sanitária Brilho'],
    ['Água', 'Água de coco Praia 1L'],
    ['Sabão em pó', 'Sabão em barra Limpinho'],
    ['Sabão em pó Brilho', 'SABAO LIQ BRILHO 3L'],
    ['Ovos', 'Ovos de codorna'],
    ['Banana', 'Banana passa'],
    ['batata', 'BATATA DOCE KG'],
    ['alho', 'ALHO PORO UN'],
    ['Feijão Carioca Grão Bom', 'FEIJAO PRETO GRAO BOM 1KG'],
    ['requeijão', 'CR CREAM CHEESE VALE 150G'],
    ['peito de frango', 'PEITO PERU FAT KG'],
    ['amido de milho', 'BISCOITO MAIZENA 400G'],
    ['Margarina', 'MANTEIGA COM SAL 200G'],
    ['Alcatra', 'PICANHA BOV KG'],
    // Leite condensado, achocolatado e fermentado como a nota corta.
    ['Leite', 'LEITE CONDENS BOA VACA 395G'],
    ['Leite', 'LTE CONDENS BOA VACA 395G'],
    ['Leite', 'LEITE ACHOC SERRANA 200ML'],
    ['Leite', 'LEITE C/ CHOCOLATE SERRANA'],
    ['Leite', 'LEITE FERM VIDA 6UN'],
    // O pronto ou processado que começa pelo nome de outro item.
    ['Batata', 'BATATA RUFFLES ORIGINAL 96G'],
    ['Batata', 'BATATA PRE FRITA BOA MESA 2KG'],
    ['Pizza', 'MOLHO PIZZA BOM SABOR 340G'],
    ['Pão', 'PAO DE MEL SOL 30G'],
    ['Alho', 'TEMPERO ALHO E SAL BOM 1KG'],
    ['Feijão', 'FEIJAO TROPEIRO BOM 250G'],
    ['Tomate', 'TOMATE PELADO SOL 400G'],
    // O tipo de biscoito que a lista diz.
    ['Biscoito recheado', 'BISCOITO MAISENA VITA 400G'],
    // A versão que a lista pede e a nota não diz: calada, a nota é a comum.
    ['Coca zero', 'COCA COLA 2L'],
    ['Coca zero', 'REFRIG COCA COLA PET 2L'],
    ['Leite sem lactose', 'LEITE SERRANA 1L'],
    ['Cerveja sem álcool', 'CERVEJA BOA 350ML'],
    ['Requeijão light', 'REQUEIJAO CREMOSO VALE'],
    ['Arroz integral', 'ARROZ GRAO BOM 5KG'],
    ['Café com leite', 'CAFE PILAO 500G'],
    // A marca do refrigerante.
    ['Coca', 'FANTA 2L'],
    ['Coca', 'REFRIG FANTA 2L'],
    ['Fanta', 'COCA COLA 2L'],
    // O achocolatado líquido: pedido pela lista, a nota calada é o pó.
    ['Achocolatado líquido', 'ACHOC NESCAU 400G'],
    ['Achocolatado em pó', 'ACHOC LIQ TODDYNHO 200ML'],
    // A versão abreviada na nota continua não sendo a outra.
    ['Arroz parboilizado', 'ARROZ INTEG TIO JOAO 1KG'],
    ['Arroz integral', 'ARROZ PARB TIO JOAO 5KG'],
    ['Açúcar demerara', 'ACUCAR MASC NATIVE 1KG'],
    ['Água sem gás', 'AGUA MIN GASEIF CRYSTAL 500ML'],
    ['Leite desnatado', 'LEITE INTEG ITALAC 1L'],
  ];
  it.each(other)('"%s" e "%s" são outra coisa', (wanted, found) => {
    expect(fit(wanted, found)).toBe('outro');
  });

  // Pode ser, mas não com certeza: só como sugestão.
  const maybe: [string, string][] = [
    ['Leite desnatado', 'Leite UHT Serrana Caixa'],
    ['Coca', 'COCA COLA ZERO 2L'],
    ['Arroz', 'Arroz integral Grão Bom'],
    ['Arroz 5kg', 'ARROZ GRAO BOM 1KG'],
    ['Sabão em pó', 'LAVA ROUPAS LIMPINHO 1KG'],
    ['Banana prata', 'BANANA NANICA KG'],
    ['Carne', 'Bombom da Alcatra'],
    ['Carne moída', 'PATINHO MOIDO KG'],
    ['Frango', 'Filé de peito de frango'],
    ['Queijo', 'Mussarela fatiada'],
    ['Chocolate', 'Bombom sortido'],
    // Uma versão que só a nota diz.
    ['Café', 'Café com leite'],
    ['Suco', 'SUCO EM PO SOL LARANJA'],
    // A nota calada não diz qual sabão é.
    ['Sabão líquido', 'LAVA ROUPAS LIMPINHO 1KG'],
    ['Batata inglesa', 'BATATA ASTERIX KG'],
    // A versão que só a nota diz, abreviada.
    ['Achocolatado', 'ACHOC LIQ TODDYNHO 200ML'],
    ['Arroz', 'ARROZ PARB TIO JOAO 5KG'],
    ['Coca', 'COCA COLA ZR 2L'],
    ['Água', 'AGUA MIN GASEIF CRYSTAL 500ML'],
    ['Açúcar', 'ACUCAR MASC NATIVE 1KG'],
    ['Requeijão', 'REQUEIJAO LT CATUPIRY 200G'],
    ['Leite', 'LEITE ZERO LACT PIRACANJUBA 1L'],
  ];
  it.each(maybe)('"%s" e "%s" podem ser o mesmo (sugestão)', (wanted, found) => {
    expect(fit(wanted, found)).toBe('talvez');
  });

  it('o refrigerante abreviado na nota não é hortifruti: o tamanho diferente ainda conta', () => {
    const receipt = 'REFRIG FANTA LARANJA 1L';
    expect(fit('Fanta laranja 2L', receipt, { list: 'bebidas', receipt: guessCategory(receipt, { abbreviated: true }) })).toBe('talvez');
  });

  it('um nome da nota que diz outro tipo decide, mesmo com o produto calado', () => {
    expect(sameItemFit({ name: 'leite desnatado' }, { names: ['Leite Serra', 'LEITE SERRA INT 1L'] })).toBe('outro');
  });

  it('a versão que a lista pede basta estar num dos nomes da nota', () => {
    expect(sameItemFit({ name: 'Coca zero' }, { names: ['Coca-Cola 2L', 'REFRIG COCA COLA ZERO 2L'] })).toBe('mesmo');
    expect(sameItemFit({ name: 'Coca zero' }, { names: ['Coca-Cola 2L', 'REFRIG COCA COLA 2L'] })).toBe('outro');
  });
});

describe('sameItemFit: o mesmo item, de qualquer marca', () => {
  const same: [string, string][] = [
    ['Refrigerante sem Açúcar Coca-Cola Garrafa 1,5l', 'REFRIG COCA-COLA ZERO'],
    ['Café em pó', 'CAFE BOA TARDE 500G'],
    ['Pao de caixa', 'PÃO DE FORMA SOL'],
    ['Ovo Fazendinha Caipira', 'OVOS GRANJA SOL CAIPIRA'],
    ['Salsa Maço', 'SALSA ORGÂNICA UN'],
    ['Leite', 'LEITE UHT INTEGRAL SERRANA 1L'],
    ['Feijão', 'FEIJAO CARIOCA GRAO BOM 1KG'],
    ['Óleo', 'OLEO DE SOJA SOL 900ML'],
    ['sabão em pó', 'LAVA ROUP PO LIMPINHO 1,6KG'],
    ['água sanitária', 'AG SANIT BRILHO 2L'],
    ['Filtro de café', 'Filtro de Papel 103 Caixa 30 Unidades'],
    ['Luvas de limpeza', 'Luva'],
    ['Tangerina', 'MEXERICA PONKAN KG'],
    ['Banana Prata Granel 700g', 'BANANA PRATA KG'],
    // A versão como a nota escreve.
    ['Leite sem lactose', 'Leite S/Lactose Serrana'],
    ['Leite zero lactose', 'LEITE ZERO LAC SERRANA 1L'],
    ['Cerveja sem álcool', 'CERV S/ALCOOL BOA 350ML'],
    ['Cerveja sem álcool', 'CERVEJA BOA ZERO 350ML'],
    ['Coca zero', 'COCA COLA S/ACUCAR 2L'],
    // A versão com as abreviações comuns de nota.
    ['Arroz integral', 'ARROZ INTEG TIO JOAO 1KG'],
    ['Arroz parboilizado', 'ARROZ PARB TIO JOAO 5KG'],
    ['Pão de forma integral', 'PAO FORMA INTEG PULLMAN'],
    ['Coca zero', 'REFRIG COCA COLA ZR 2L'],
    ['Água com gás', 'AGUA MIN GASEIF CRYSTAL 500ML'],
    ['Açúcar mascavo', 'ACUCAR MASC NATIVE 1KG'],
    ['Açúcar refinado', 'ACUCAR REF UNIAO 1KG'],
    ['Requeijão light', 'REQUEIJAO LT CATUPIRY 200G'],
    ['Requeijão light', 'REQ CREM LT VALE 200G'],
    ['Leite sem lactose', 'LEITE ZERO LACT PIRACANJUBA 1L'],
    ['Leite sem lactose', 'LEITE S/LACT PIRACANJUBA 1L'],
    ['Leite integral', 'LEITE INTEG ITALAC 1L'],
    // Longe do requeijão, "LT" é litro, não light.
    ['Leite', 'LEITE INTEGRAL ITALAC 1 LT'],
    // O nome sozinho é o de pó.
    ['Achocolatado', 'ACHOC PO BOM DIA 400G'],
    ['Achocolatado', 'ACHOCOLATADO EM PO BOM DIA 400G'],
    ['Gelatina', 'GELATINA PO SOL MORANGO'],
    ['Fermento', 'FERMENTO EM PO SOL 100G'],
    // A batata comum, e o biscoito sem tipo, que é qualquer um.
    ['Batata', 'BATATA INGLES KG'],
    ['Batata inglesa', 'BATATA LAVADA KG'],
    ['Biscoito', 'BISCOITO MAISENA VITA 400G'],
    ['Tempero', 'TEMPERO ALHO E SAL BOM 1KG'],
    ['Leite condensado', 'LEITE CONDENS BOA VACA 395G'],
  ];
  it.each(same)('"%s" e "%s"', (wanted, found) => {
    expect(fit(wanted, found)).toBe('mesmo');
  });

  it('nome que o app não conhece não decide nada', () => {
    expect(fit('Pastilha Frescor', 'PASTILHA FRESCOR 30MIN')).toBeNull();
    expect(fit('Leite', 'PASTILHA FRESCOR')).toBeNull();
  });
});

describe('wordOverlap', () => {
  it('conta abreviação de 3 letras ou mais e exige a primeira palavra da lista', () => {
    expect(wordOverlap('Escova de cabelo', ['ESC CABELO MACIA'])).toBe(1);
    expect(wordOverlap('Fralda Turminha G', ['FRALDA SONINHO CONF G'])).toBe(0.5);
    expect(wordOverlap('Salsa maço', ['CEBOLINHA MACO'])).toBe(0);
  });

  it('só a palavra da nota abrevia a da lista, não o contrário', () => {
    expect(wordOverlap('Chá', ['CHANTILLY AMELIA 200G'])).toBe(0);
    expect(wordOverlap('Pimenta', ['PIMENTAO VERDE KG'])).toBe(0);
    expect(wordOverlap('Pimenta do reino', ['PIMENTAO VERDE KG'])).toBe(0);
    expect(wordOverlap('Detergente', ['DET LIQ LIMPOL'])).toBe(1);
  });
});

describe('matchListItems com o mesmo item: o caso real, com nomes inventados', () => {
  // A nota de 20/10: 12 itens da lista estavam nela, e a regra de antes marcou 5 (os do mesmo produto e do mesmo
  // nome). Os da lista vieram com a marca da última compra, e a casa comprou outra.
  const receipt: ReceiptLine[] = [
    line('r1', 'UVA ITALIA DOCE', 'Uva', 'hortifruti', 'p-uva'),
    line('r2', 'LEITE UHT SERRANA CX', 'Leite UHT Serrana Caixa', 'laticinios', 'p-leite'),
    line('r2b', 'LEITE UHT SERRANA CX', 'Leite UHT Serrana Caixa', 'laticinios', 'p-leite'),
    line('r3', 'CEBOLINHA HORTA BOA', 'Cebolinha Horta Boa', 'hortifruti'),
    line('r4', 'SALSA ORGANICA UN', 'Salsa Orgânica', 'hortifruti'),
    line('r5', 'MANJERICAO ORGANICO', 'Manjericão Unidade', 'hortifruti'),
    line('r6', 'PAO DE FORMA SOL', 'Pão de Forma', 'padaria'),
    line('r7', 'REQUEIJAO CREMOSO VALE', 'Requeijão', 'laticinios', 'p-requeijao'),
    line('r8', 'PASTILHA FRESCOR 30MIN', 'Pastilha Frescor', 'doces'),
    line('r9', 'AGUA SANITARIA BRILHO', 'Água Sanitária Brilho Frasco 1l', 'limpeza', 'p-agua'),
    line('r10', 'CAFE BOA TARDE', 'Café Boa Tarde', 'cafe_cha'),
    line('r11', 'REFRIG COCA-COLA ZERO', 'Refrigerante Coca-Cola Zero', 'bebidas', 'p-coca-c'),
    line('r12', 'OVOS GRANJA SOL CAIPIRA', 'Ovos Granja Sol Caipira', 'ovos'),
    line('r13', 'POLPA FRUTAMAIS 100G', 'Polpa de fruta', 'congelados', 'p-polpa'),
    line('r13b', 'POLPA FRUTAMAIS 100G', 'Polpa de fruta', 'congelados', 'p-polpa'),
    line('r14', 'FILE PEITO FRG BOA MESA', 'Filé de Peito de Frango Boa Mesa 1kg', 'congelados', 'p-file'),
    line('r15', 'BOMBOM DA ALCATRA', 'Bombom da Alcatra', 'carnes'),
  ];
  // [item da lista, linha que cumpre (ou null: não veio)]
  const cases: [OpenListItem, string | null][] = [
    [listItem('l1', 'Refrigerante sem Açúcar Coca-Cola Garrafa 1,5l', 'bebidas', true, 'p-coca-a'), 'r11'],
    [listItem('l2', 'Polpa de fruta', 'congelados', true, 'p-polpa'), 'r13'],
    [listItem('l3', 'Saco de lixo', 'limpeza', true), null],
    [listItem('l4', 'Café em pó', 'cafe_cha', true), 'r10'],
    [listItem('l5', 'Pao de caixa', 'padaria', true), 'r6'],
    [listItem('l6', 'Leite Serra Verde Desnatado', 'laticinios', true, 'p-leite-sv'), 'r2'],
    [listItem('l7', 'Carne', 'carnes', true), 'r15'],
    [listItem('l8', 'Ovo Fazendinha Caipira', 'ovos', true, 'p-ovo-f'), 'r12'],
    [listItem('l9', 'Salsa Maço', 'hortifruti', true), 'r4'],
    [listItem('l10', 'Requeijão', 'laticinios', true), 'r7'],
    [listItem('l11', 'Uva', 'hortifruti', true), 'r1'],
    [listItem('l12', 'Água Sanitária Brilho Frasco 1l', 'limpeza', true, 'p-agua'), 'r9'],
    [listItem('l13', 'Filé de Peito de Frango Boa Mesa 1kg', 'congelados', true, 'p-file'), 'r14'],
    [listItem('l14', 'Banana Prata Granel 700g', 'hortifruti', false, 'p-banana'), null],
    [listItem('l15', 'Tangerina', 'hortifruti', false), null],
  ];
  const run = (items: OpenListItem[]) => new Map(matchListItems(items, receipt, new LinkIndex(), sameListedName).map((m) => [m.listItemId, m]));

  it('com tudo no carrinho, passa de 5 para 10 de 12 marcados, sem marcar errado; os outros 2 vêm sugeridos na linha certa', () => {
    const matches = run(cases.map(([item]) => item));
    const marked = cases.filter(([item, expected]) => expected && matches.get(item.id)?.checked && matches.get(item.id)?.receiptItemId === expected);
    const wrong = cases.filter(([item, expected]) => matches.get(item.id)?.checked && matches.get(item.id)?.receiptItemId !== expected);
    expect(marked.length).toBeGreaterThanOrEqual(9);
    expect(marked.map(([item]) => item.id)).toEqual(['l1', 'l2', 'l4', 'l5', 'l8', 'l9', 'l10', 'l11', 'l12', 'l13']);
    expect(wrong).toEqual([]);
    // O leite pedido desnatado (a nota não diz) e a carne que veio como um corte: sugestão, desmarcada.
    expect(matches.get('l6')).toEqual({ listItemId: 'l6', receiptItemId: 'r2', reason: 'parecido', checked: false });
    expect(matches.get('l7')).toEqual({ listItemId: 'l7', receiptItemId: 'r15', reason: 'parecido', checked: false });
    // O que não veio não vira nada.
    expect(['l3', 'l14', 'l15'].map((id) => matches.get(id))).toEqual([undefined, undefined, undefined]);
  });

  it('sem o carrinho, o mesmo item de outra marca só sugere, sempre na linha certa', () => {
    const matches = run(cases.map(([item]) => ({ ...item, checked_at: null })));
    const checked = [...matches.values()].filter((m) => m.checked).map((m) => m.listItemId);
    // Os de antes continuam: mesmo produto e mesmo nome.
    expect(checked).toEqual(['l2', 'l10', 'l11', 'l12', 'l13']);
    for (const [item, expected] of cases) if (expected) expect([item.id, matches.get(item.id)?.receiptItemId]).toEqual([item.id, expected]);
    expect(matches.get('l4')).toEqual({ listItemId: 'l4', receiptItemId: 'r10', reason: 'item', checked: false });
  });
});

describe('matchListItems: a regra do carrinho', () => {
  const leiteA = line('a', 'LEITE INTEGRAL SERRANA 1L', 'Leite Integral Serrana', 'laticinios');
  const leiteB = line('b', 'LEITE DESNATADO VALE 1L', 'Leite Desnatado Vale', 'laticinios');
  const leiteA2 = { ...leiteA, id: 'a2' };
  const condensado = line('c', 'LEITE COND BOA VACA 395G', 'Leite Condensado Boa Vaca', 'doces');
  const leite = (inCart: boolean) => listItem('l1', 'Leite', 'laticinios', inCart);
  const match = (items: OpenListItem[], lines: ReceiptLine[]) => matchListItems(items, lines, new LinkIndex(), sameListedName);

  it('sozinho só com o item no carrinho e uma linha só da nota sendo ele', () => {
    expect(match([leite(true)], [leiteA, condensado])).toEqual([{ listItemId: 'l1', receiptItemId: 'a', reason: 'item', checked: true }]);
    // Fora do carrinho, sugere; aqui as palavras da lista estão no nome, e a dica é a do nome parecido.
    expect(match([leite(false)], [leiteA, condensado])).toEqual([{ listItemId: 'l1', receiptItemId: 'a', reason: 'nome', checked: false }]);
  });

  it('duas linhas que podem ser o item: a pessoa escolhe; duas linhas do mesmo produto são uma compra só', () => {
    expect(match([leite(true)], [leiteA, leiteB]).map((m) => m.checked)).toEqual([false]);
    expect(match([leite(true)], [leiteA, leiteA2])).toEqual([{ listItemId: 'l1', receiptItemId: 'a', reason: 'item', checked: true }]);
  });

  it('uma linha do mesmo item e outra que pode ser ele (um corte): não marca sozinho', () => {
    const carneMoida = line('m', 'CARNE MOIDA BOV KG', 'Carne Moída Bovina', 'carnes');
    const patinho = line('p', 'PATINHO MOIDO KG', 'Patinho Moído', 'carnes');
    expect(match([listItem('l1', 'Carne moída', 'carnes', true)], [carneMoida, patinho])).toEqual([
      { listItemId: 'l1', receiptItemId: 'm', reason: 'nome', checked: false },
    ]);
  });

  it('o corte da família nunca vem marcado sozinho, nem no carrinho', () => {
    expect(match([listItem('l1', 'Frango', 'carnes', true)], [line('f', 'FILE PEITO FRG 1KG', 'Filé de Peito', 'carnes')])).toEqual([
      { listItemId: 'l1', receiptItemId: 'f', reason: 'parecido', checked: false },
    ]);
  });

  it('o que é outra coisa não entra nem como sugestão de nome parecido', () => {
    // "Leite" está nas palavras de "Leite condensado", mas é outro item.
    expect(match([leite(false)], [condensado])).toEqual([]);
    expect(match([listItem('l1', 'Batata', 'hortifruti', true)], [line('d', 'BATATA DOCE KG', 'Batata Doce', 'hortifruti')])).toEqual([]);
  });

  it('por último, palavras em comum com abreviação, só entre comida e comida ou casa e casa', () => {
    const escova = line('e', 'ESC CABELO MACIA', 'Esc Cabelo Macia', 'higiene', null);
    expect(match([listItem('l1', 'Escova de cabelo', 'higiene')], [escova])).toEqual([
      { listItemId: 'l1', receiptItemId: 'e', reason: 'parecido', checked: false },
    ]);
    expect(match([listItem('l1', 'Escova de cabelo', 'hortifruti')], [escova])).toEqual([]);
  });

  it('as palavras em comum respeitam as travas, mesmo na linha que o app não sabe ler', () => {
    const sabLiq = line('s', 'SAB LIQ BRILHO 3L', 'Sab Liq Brilho 3l', 'limpeza', null);
    expect(match([listItem('l1', 'Sabão em pó', 'limpeza')], [sabLiq])).toEqual([]);
    expect(match([listItem('l1', 'Sabão líquido', 'limpeza')], [sabLiq])).toEqual([
      { listItemId: 'l1', receiptItemId: 's', reason: 'parecido', checked: false },
    ]);
    expect(match([listItem('l1', 'Batata', 'hortifruti')], [line('d', 'BAT DOCE KG', 'Bat Doce Kg', 'hortifruti', null)])).toEqual([]);
    expect(match([listItem('l1', 'Chá', 'cafe_cha')], [line('c', 'CHANTILLY AMELIA 200G', 'Chantilly Amelia', 'laticinios', null)])).toEqual([]);
  });

  it('a versão que a lista pede e a nota não diz não vira nem sugestão', () => {
    expect(match([listItem('l1', 'Coca zero', 'bebidas', true)], [line('c', 'COCA COLA 2L', 'Coca Cola 2l', 'bebidas')])).toEqual([]);
    expect(match([listItem('l1', 'Leite sem lactose', 'laticinios')], [line('l', 'LEITE UHT SERRANA 1L', 'Leite UHT Serrana', 'laticinios')])).toEqual([]);
    expect(match([listItem('l1', 'Coca', 'bebidas')], [line('f', 'REFRIG FANTA 2L', 'Refrigerante Fanta 2l', 'bebidas')])).toEqual([]);
  });

  it('o leite no carrinho não marca sozinho o leite condensado, nem o café com leite marca o café', () => {
    expect(match([leite(true)], [line('c', 'LEITE CONDENS BOA VACA 395G', 'Leite Condens Boa Vaca', 'doces')])).toEqual([]);
    const cafe = line('p', 'CAFE PILAO 500G', 'Cafe Pilao 500g', 'cafe_cha');
    const nescafe = line('n', 'NESCAFE C LEITE', 'Nescafe C Leite', 'cafe_cha');
    expect(match([listItem('l1', 'Café com leite', 'cafe_cha', true)], [cafe, nescafe]).filter((m) => m.checked)).toEqual([]);
  });

  it('uma linha que o app não sabe ler, mas começa pelo item, também pode ser ele: não marca sozinho', () => {
    const batata = line('b', 'BATATA RUFFLES ORIGINAL 96G', 'Batata Ruffles', 'snacks');
    const kg = line('k', 'BATATA LAVADA KG', 'Batata Lavada', 'hortifruti');
    const abbreviated = line('i', 'BAT INGLESA KG', 'Bat Inglesa Kg', 'hortifruti', null);
    const doce = line('d', 'BAT DOCE KG', 'Bat Doce Kg', 'hortifruti', null);
    // A Ruffles é outro item: nem conta.
    expect(match([listItem('l1', 'Batata', 'hortifruti', true)], [batata, kg])).toEqual([
      { listItemId: 'l1', receiptItemId: 'k', reason: 'item', checked: true },
    ]);
    expect(match([listItem('l1', 'Batata', 'hortifruti', true)], [kg, abbreviated]).map((m) => m.checked)).toEqual([false]);
    // A que, lida como o item, é outra coisa não atrapalha.
    expect(match([listItem('l1', 'Batata', 'hortifruti', true)], [kg, doce])).toEqual([
      { listItemId: 'l1', receiptItemId: 'k', reason: 'item', checked: true },
    ]);
  });
});

describe('matchListItems com o item genérico da leitura por foto', () => {
  // A linha como a revisão monta: o nome sugerido pela leitura e o texto da nota; o genérico fica à parte.
  const photoLine = (id: string, raw: string, suggested: string, category: string, generic: string | null): ReceiptLine => ({
    id,
    productId: null,
    name: suggested,
    names: receiptLineNames({ productName: suggested, suggestedName: suggested, rawDescription: raw }),
    generic,
    category,
  });
  const match = (items: OpenListItem[], lines: ReceiptLine[]) => matchListItems(items, lines, new LinkIndex(), sameListedName);

  it('a marca usada como nome: "Gilete" casa com "GILLETTE APARELHO", que a IA disse ser aparelho de barbear', () => {
    const gilete = listItem('l1', 'Gilete', 'higiene', true);
    expect(match([gilete], [photoLine('g', 'GILLETTE APARELHO', 'Gillette Aparelho', 'higiene', 'aparelho de barbear')])).toEqual([
      { listItemId: 'l1', receiptItemId: 'g', reason: 'item', checked: true },
    ]);
    // Sem o genérico (a nota do QR, a leitura de antes), a nota não diz que item é: nada, como antes.
    expect(match([gilete], [photoLine('g', 'GILLETTE APARELHO', 'Gillette Aparelho', 'higiene', null)])).toEqual([]);
    // Fora do carrinho, só sugere.
    expect(match([{ ...gilete, checked_at: null }], [photoLine('g', 'GILLETTE APARELHO', 'Gillette Aparelho', 'higiene', 'lâmina de barbear')])).toEqual([
      { listItemId: 'l1', receiptItemId: 'g', reason: 'item', checked: false },
    ]);
  });

  it('a abreviação do mercado: "Café em pó" com "CAF TORR MOIDO", e o que só o genérico diz ("PH NEVE")', () => {
    const cafe = photoLine('c', 'CAF TORR MOIDO 3COR 500G', 'Caf Torr Moido 3cor 500g', 'cafe_cha', 'café em pó');
    expect(match([listItem('l1', 'Café em pó', 'cafe_cha', true)], [cafe])).toEqual([
      { listItemId: 'l1', receiptItemId: 'c', reason: 'item', checked: true },
    ]);
    const papel = (generic: string | null) => photoLine('p', 'PH NEVE FD 12X30M', 'Ph Neve Fd 12x30m', 'papel', generic);
    expect(match([listItem('l1', 'Papel higiênico', 'papel', true)], [papel('papel higiênico')])).toEqual([
      { listItemId: 'l1', receiptItemId: 'p', reason: 'item', checked: true },
    ]);
    expect(match([listItem('l1', 'Papel higiênico', 'papel', true)], [papel(null)])).toEqual([]);
    const nescau = (generic: string | null) => photoLine('n', 'NESCAU 2.0 400G', 'Nescau 2.0 400g', 'bebidas', generic);
    expect(match([listItem('l1', 'Achocolatado', 'bebidas', true)], [nescau('achocolatado em pó')]).map((m) => m.checked)).toEqual([true]);
    expect(match([listItem('l1', 'Achocolatado', 'bebidas', true)], [nescau(null)])).toEqual([]);
  });

  it('as travas continuam: o genérico é um nome a mais, e o texto da nota que diz outra coisa decide', () => {
    // A nota diz INTEGRAL: o genérico "leite" não faz dela o leite desnatado da lista, nem como sugestão.
    const integral = photoLine('i', 'LEITE INTEGRAL ITALAC 1L', 'Leite Integral Italac 1l', 'laticinios', 'leite');
    expect(match([listItem('l1', 'Leite desnatado', 'laticinios', true)], [integral])).toEqual([]);
    // A versão que a lista pede e nenhum nome da linha diz: a comum, outra coisa.
    const coca = photoLine('c', 'REFRIG COCA COLA 2L', 'Refrig Coca Cola 2l', 'bebidas', 'refrigerante');
    expect(match([listItem('l1', 'Coca zero', 'bebidas', true)], [coca])).toEqual([]);
    // O genérico também é um nome que pode dizer outra coisa: o sabão líquido não é o em pó.
    const omo = photoLine('o', 'OMO LAV PERF 3L', 'Omo Lav Perf 3l', 'limpeza', 'sabão líquido');
    expect(match([listItem('l1', 'Sabão em pó', 'limpeza', true)], [omo])).toEqual([]);
    // E o corte da família continua sendo só uma sugestão.
    const alcatra = photoLine('a', 'BOMBOM DA ALCATRA', 'Bombom da Alcatra', 'carnes', 'alcatra');
    expect(match([listItem('l1', 'Carne', 'carnes', true)], [alcatra])).toEqual([
      { listItemId: 'l1', receiptItemId: 'a', reason: 'parecido', checked: false },
    ]);
  });

  it('o texto que o app não sabe ler, mas que lido como o item diz outra coisa, decide: o genérico que tira o tipo não passa', () => {
    // A IA deixou o "doce" de fora: a nota diz BAT DOCE, não é a batata da lista, nem como sugestão.
    const batataDoce = (generic: string | null) => photoLine('b', 'BAT DOCE KG', 'Bat Doce Kg', 'hortifruti', generic);
    for (const generic of [null, 'batata']) {
      expect(match([listItem('l1', 'Batata', 'hortifruti', true)], [batataDoce(generic)])).toEqual([]);
      expect(match([listItem('l1', 'Batata', 'hortifruti')], [batataDoce(generic)])).toEqual([]);
    }
    // "SAB LIQ" é o sabão líquido: nem o genérico "sabão em pó" nem "sabão para roupas" fazem dele o em pó.
    const omo = (generic: string | null) => photoLine('o', 'SAB LIQ OMO 3L', 'Sab Liq Omo 3l', 'limpeza', generic);
    for (const generic of [null, 'sabão em pó', 'sabão para roupas']) {
      expect(match([listItem('l1', 'Sabão em pó', 'limpeza', true)], [omo(generic)])).toEqual([]);
      expect(match([listItem('l1', 'Sabão em pó', 'limpeza')], [omo(generic)])).toEqual([]);
    }
  });

  it('o genérico não acrescenta a versão que a nota calou: calada, a nota é a comum', () => {
    const parmalat = (generic: string | null) => photoLine('p', 'LEITE UHT PARMALAT 1L', 'Leite UHT Parmalat 1l', 'laticinios', generic);
    for (const wanted of ['Leite sem lactose', 'Leite desnatado']) {
      const item = listItem('l1', wanted, 'laticinios', true);
      const withoutGeneric = match([item], [parmalat(null)]);
      // Com o genérico que diz a versão, nunca marcado, e a mesma resposta de sem ele.
      expect(match([item], [parmalat(wanted.toLowerCase())])).toEqual(withoutGeneric);
      expect(withoutGeneric.every((m) => !m.checked)).toBe(true);
    }
    // "Coca zero" e uma nota que não diz zero: outra coisa, também com o genérico "coca zero".
    const coca = photoLine('c', 'REFRIG COCA COLA 2L', 'Refrig Coca Cola 2l', 'bebidas', 'coca zero');
    expect(match([listItem('l1', 'Coca zero', 'bebidas', true)], [coca])).toEqual([]);
    // Quando o texto diz a versão, ela vale como sempre.
    const desnatado = photoLine('d', 'LTE UHT ITALAC DESN 1L', 'Lte Uht Italac Desn 1l', 'laticinios', 'leite desnatado');
    expect(match([listItem('l1', 'Leite desnatado', 'laticinios', true)], [desnatado])).toEqual([
      { listItemId: 'l1', receiptItemId: 'd', reason: 'item', checked: true },
    ]);
  });

  it('quando só o genérico diz o item, a versão que só ele diz é sugestão, nunca marcada sozinha', () => {
    const italac = (raw: string, generic: string) => photoLine('s', raw, raw, 'laticinios', generic);
    const asked = (raw: string, generic: string, wanted: string) => match([listItem('l1', wanted, 'laticinios', true)], [italac(raw, generic)]);
    // A nota não diz a versão (nem o item): pode ser, a pessoa confirma com um toque.
    expect(asked('ITALAC 1L', 'leite desnatado', 'Leite desnatado')).toEqual([{ listItemId: 'l1', receiptItemId: 's', reason: 'parecido', checked: false }]);
    expect(asked('ITALAC ZL 1L', 'leite sem lactose', 'Leite sem lactose')).toEqual([{ listItemId: 'l1', receiptItemId: 's', reason: 'parecido', checked: false }]);
    // O genérico que só diz o item vale inteiro.
    expect(asked('ITALAC 1L', 'leite', 'Leite')).toEqual([{ listItemId: 'l1', receiptItemId: 's', reason: 'item', checked: true }]);
    // E o item sem a versão não vira a versão que a lista pede.
    expect(asked('ITALAC 1L', 'leite', 'Leite desnatado').every((m) => !m.checked)).toBe(true);
    // A versão impressa, mesmo sem o item, vale como sempre ("ZERO LAC" é sem lactose).
    expect(asked('ITALAC ZERO LAC 1L', 'leite sem lactose', 'Leite sem lactose')).toEqual([{ listItemId: 'l1', receiptItemId: 's', reason: 'item', checked: true }]);
    // O tipo que é o padrão da linha (o café calado é em pó) não é uma versão: o genérico vale inteiro.
    expect(match([listItem('l1', 'Café em pó', 'cafe_cha', true)], [photoLine('c', 'PILAO 500G', 'Pilao 500g', 'cafe_cha', 'café em pó')])).toEqual([
      { listItemId: 'l1', receiptItemId: 'c', reason: 'item', checked: true },
    ]);
  });

  it('sameItemFit: a versão que só o genérico diz é talvez', () => {
    const fitWith = (wanted: string, raw: string, generic: string) =>
      sameItemFit({ name: wanted, category: 'laticinios' }, { names: [raw], generic, category: 'laticinios' });
    expect(fitWith('Leite desnatado', 'ITALAC 1L', 'leite desnatado')).toBe('talvez');
    expect(fitWith('Leite sem lactose', 'ITALAC ZL 1L', 'leite sem lactose')).toBe('talvez');
    expect(fitWith('Leite', 'ITALAC 1L', 'leite')).toBe('mesmo');
    expect(fitWith('Leite desnatado', 'ITALAC 1L', 'leite')).not.toBe('mesmo');
    expect(fitWith('Leite sem lactose', 'ITALAC S/LACTOSE 1L', 'leite sem lactose')).toBe('mesmo');
  });

  it('o genérico não tira o corte que a nota diz: "BOMBOM DA ALCATRA" com o genérico "carne" continua só sugestão', () => {
    const alcatra = photoLine('a', 'BOMBOM DA ALCATRA', 'Bombom da Alcatra', 'carnes', 'carne');
    expect(match([listItem('l1', 'Carne', 'carnes', true)], [alcatra])).toEqual([
      { listItemId: 'l1', receiptItemId: 'a', reason: 'parecido', checked: false },
    ]);
  });

  it('sem o genérico, os nomes e o casamento são os de antes', () => {
    const before: ReceiptLine = { id: 'x', productId: null, name: 'Caf Torr', names: ['Caf Torr', 'Caf Torr', 'CAF TORR 500G'], category: 'cafe_cha' };
    const items = [listItem('l1', 'Café', 'cafe_cha', true), listItem('l2', 'Café em pó', 'cafe_cha')];
    for (const generic of [undefined, null, '', '  ']) {
      const now = { ...photoLine('x', 'CAF TORR 500G', 'Caf Torr', 'cafe_cha', null), generic };
      expect(now.names).toEqual(before.names);
      expect(match(items, [now])).toEqual(match(items, [before]));
    }
  });
});

describe('"Gilete" é a lâmina; com outro produto de barbear no nome, é a marca', () => {
  const line = (id: string, raw: string, generic: string | null = null): ReceiptLine => ({
    id,
    productId: null,
    name: raw,
    names: [raw],
    generic,
    category: 'higiene',
  });
  const match = (items: OpenListItem[], lines: ReceiptLine[]) => matchListItems(items, lines, new LinkIndex(), sameListedName);

  it('a espuma, o gel, o pós-barba e o desodorante da marca não são a lâmina, nas duas ordens', () => {
    expect(keyOf('Gilete')).toBe('barbear');
    expect(keyOf('GILETE MACH3 CARGA')).toBe('barbear');
    for (const name of ['ESP BARB GILETE 200ML', 'ESPUMA DE BARBEAR GILETE', 'CREME DE BARBEAR GILETE', 'GEL BARBEAR GILETE', 'GILETE ESPUMA BARB', 'Espuma de barbear Gilete']) {
      expect(keyOf(name)).toBe('espuma_barbear');
    }
    expect(keyOf('POS BARBA GILETE')).toBe('pos_barba');
    expect(keyOf('DESOD GILETE AERO')).toBe('desodorante');
    for (const name of ['ESPUMA GILETE', 'GILETE GEL', 'Gel gilete', 'GILETE AERO 150ML']) expect(keyOf(name)).toBeNull();
  });

  it('na nota: "Gilete" da lista não sai com a espuma, nem quando o genérico é "espuma de barbear"', () => {
    const gilete = listItem('l1', 'Gilete', 'higiene', true);
    for (const raw of ['ESP BARB GILETE 200ML', 'GEL BARBEAR GILETE', 'ESPUMA GILETE', 'GILETE ESPUMA BARB', 'POS BARBA GILETE', 'CREME DE BARBEAR GILETE']) {
      expect(match([gilete], [line('e', raw)]).filter((m) => m.checked)).toEqual([]);
      expect(match([gilete], [line('e', raw, 'espuma de barbear')])).toEqual([]);
    }
    expect(match([gilete], [line('g', 'GILETE PRESTOBARBA 2UN')])).toEqual([{ listItemId: 'l1', receiptItemId: 'g', reason: 'item', checked: true }]);
    // A marca com dois L não diz o item; o genérico diz: a lâmina, como antes.
    expect(match([gilete], [line('g', 'GILLETTE MACH3 APARELHO', 'aparelho de barbear')])).toEqual([
      { listItemId: 'l1', receiptItemId: 'g', reason: 'item', checked: true },
    ]);
  });

  it('na lista: "Espuma de barbear Gilete" e "Gel gilete" não saem com o aparelho', () => {
    for (const name of ['Espuma de barbear Gilete', 'Gel gilete']) {
      const item = listItem('l1', name, 'higiene', true);
      expect(match([item], [line('a', 'APARELHO DE BARBEAR BIC')]).filter((m) => m.checked)).toEqual([]);
      expect(match([item], [line('a', 'BARBEADOR BIC CONFORT')]).filter((m) => m.checked)).toEqual([]);
    }
    expect(match([listItem('l1', 'Espuma de barbear', 'higiene', true)], [line('e', 'ESP BARB GILETE 200ML')])).toEqual([
      { listItemId: 'l1', receiptItemId: 'e', reason: 'item', checked: true },
    ]);
  });
});
