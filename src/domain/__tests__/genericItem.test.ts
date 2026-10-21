import { describe, expect, it } from '@jest/globals';

import { brandChoice, genericItem, pendingSameItem, productSuggestions, sameListItem, switchBrand } from '../genericItem';
import { LinkIndex, listRemovals, matchListItems, type OpenListItem, type ReceiptLine } from '../listLinks';
import { sameItemFit } from '../sameItem';
import { guessCategory } from '../search';

const generic = (name: string, category?: string) => genericItem(name, category).name;
const key = (name: string, category?: string) => genericItem(name, category).key;

describe('genericItem: o item da lista sem a marca', () => {
  it('o caso real de 20/10: a marca e a embalagem saem, o tipo fica', () => {
    expect(generic('Leite IL Desnatado', 'laticinios')).toBe('Leite desnatado');
    expect(generic('Ovo Doninho Caipira', 'ovos')).toBe('Ovo caipira');
    expect(generic('Refrigerante sem Açúcar Coca-Cola Garrafa 1,5l', 'bebidas')).toBe('Refrigerante sem açúcar Coca-Cola');
    expect(generic('Leite UHT Parmalat Caixa', 'laticinios')).toBe('Leite');
    expect(generic('Café 3 Corações', 'cafe_cha')).toBe('Café');
    expect(generic('Água Sanitária Dragão Frasco 1l', 'limpeza')).toBe('Água sanitária');
    expect(generic('Banana Prata Granel 700g', 'hortifruti')).toBe('Banana prata');
    expect(generic('Cebolinha H.Sempre', 'hortifruti')).toBe('Cebolinha');
  });

  it('o tipo que muda o item fica', () => {
    expect(generic('Coca-Cola Zero 1L', 'bebidas')).toBe('Coca-Cola zero');
    // Nada para tirar: o nome fica como está.
    expect(generic('Refrigerante Coca-Cola Zero', 'bebidas')).toBe('Refrigerante Coca-Cola Zero');
    expect(generic('Leite Italac Zero Lactose 1L', 'laticinios')).toBe('Leite zero lactose');
    expect(generic('Café Pilão em Pó 500g', 'cafe_cha')).toBe('Café em pó');
    expect(generic('Óleo de Soja Liza 900ml', 'oleos')).toBe('Óleo de soja');
    expect(generic('Feijão Carioca Kicaldo 1kg', 'graos')).toBe('Feijão carioca');
    expect(generic('Arroz Integral Camil 1kg', 'graos')).toBe('Arroz integral');
    expect(generic('Sabão em Pó Omo Lavagem Perfeita 1,6kg', 'limpeza')).toBe('Sabão em pó');
    expect(generic('Pão de Forma Integral Wickbold', 'padaria')).toBe('Pão de forma integral');
    expect(generic('Queijo Mussarela Fatiado Tirolez', 'laticinios')).toBe('Queijo mussarela fatiado');
    expect(generic('Batata Doce Granel', 'hortifruti')).toBe('Batata doce');
    expect(generic('Bolo de Cenoura Bauducco', 'padaria')).toBe('Bolo de cenoura');
  });

  it('para o refrigerante, a Coca é o sabor; nas outras bebidas e comidas, a marca sai', () => {
    expect(generic('Coca-Cola Original 2L', 'bebidas')).toBe('Coca-Cola original');
    expect(generic('Cerveja Heineken Long Neck 330ml', 'alcoolicas')).toBe('Cerveja');
    expect(generic('Achocolatado em Pó Nescau 400g', 'doces')).toBe('Achocolatado em pó');
  });

  it('nunca inventa: sem saber o item, ou com o item fora do começo, o nome fica', () => {
    expect(generic('Pastilha Mentos', 'doces')).toBe('Pastilha Mentos');
    expect(generic('Nescau 2.0', 'doces')).toBe('Nescau 2.0');
    // "Morango" aqui é o sabor do iogurte, não a fruta.
    expect(generic('Danone Morango', 'laticinios')).toBe('Danone Morango');
    expect(generic('Filé de Peito de Frango Congelado Sadia 1kg', 'congelados')).toBe('Filé de Peito de Frango Congelado Sadia 1kg');
    expect(key('Pastilha Mentos', 'doces')).toBe('n:pastilha mentos');
  });

  it('nunca inventa: o que sairia faz outra coisa ou é outro item', () => {
    expect(generic('Leite Ninho em Pó 400g', 'laticinios')).toBe('Leite Ninho em Pó 400g');
    expect(generic('Chocolate Lacta ao Leite', 'doces')).toBe('Chocolate Lacta ao Leite');
    expect(generic('Sardinha Gomes da Costa com Óleo', 'peixes')).toBe('Sardinha Gomes da Costa com Óleo');
  });

  it('nunca tira o que decide o que se pode comprar: dieta, idade, o leite que é em pó ou fórmula', () => {
    const kept: [string, string][] = [
      ['Pão de Forma Seven Boys Sem Glúten', 'padaria'],
      ['Pão Sem Glúten Schär', 'padaria'],
      ['Pão de Forma Vegano Wickbold', 'padaria'],
      ['Biscoito Sem Glúten Jasmine', 'doces'],
      ['Biscoito Integral Sem Lactose Vitao', 'doces'],
      ['Shampoo Infantil Johnson', 'higiene'],
      ['Leite Infantil Nan Comfor 800g', 'laticinios'],
      ['Leite Ninho Forti+ Integral 380g', 'laticinios'],
      ['Leite Ninho Fases 1+', 'laticinios'],
    ];
    for (const [name, category] of kept) {
      expect(generic(name, category)).toBe(name);
      expect(key(name, category).startsWith('n:')).toBe(true);
    }
    // E não juntam com o item comum, nem na lista.
    expect(key('Pão de Forma Seven Boys Sem Glúten', 'padaria')).not.toBe(key('Pão de Forma Pullman', 'padaria'));
    expect(key('Leite Ninho Forti+ Integral 380g', 'laticinios')).not.toBe(key('Leite Integral Italac 1L', 'laticinios'));
    expect(sameListItem({ name: 'Leite', category: 'laticinios' }, { name: 'Leite infantil Nan', category: 'laticinios' })).toBe(false);
    expect(sameListItem({ name: 'Pão de forma', category: 'padaria' }, { name: 'Pão de Forma Seven Boys Sem Glúten', category: 'padaria' })).toBe(false);
  });

  it('o tipo que muda a compra fica: linguiça, queijo minas, pizza, shampoo e desodorante', () => {
    expect(generic('Linguiça Calabresa Sadia', 'carnes')).toBe('Linguiça calabresa');
    expect(generic('Linguiça Toscana Seara', 'carnes')).toBe('Linguiça toscana');
    expect(key('Linguiça Calabresa Sadia', 'carnes')).not.toBe(key('Linguiça Toscana Seara', 'carnes'));
    expect(key('Linguiça Calabresa Sadia', 'carnes')).toBe(key('Linguiça Calabresa Perdigão', 'carnes'));
    expect(generic('Queijo Minas Frescal Tirolez', 'laticinios')).toBe('Queijo minas frescal');
    expect(key('Queijo Minas Frescal Tirolez', 'laticinios')).not.toBe(key('Queijo Minas Padrão', 'laticinios'));
    expect(generic('Pizza Calabresa Sadia', 'congelados')).toBe('Pizza calabresa');
    expect(key('Pizza Calabresa Sadia', 'congelados')).not.toBe(key('Pizza Portuguesa Seara', 'congelados'));
    expect(generic('Shampoo Anticaspa Clear Men', 'higiene')).toBe('Shampoo anticaspa');
    expect(key('Shampoo Anticaspa Clear Men', 'higiene')).not.toBe(key('Shampoo Seda', 'higiene'));
    expect(generic('Desodorante Rexona Aerosol', 'higiene')).toBe('Desodorante aerosol');
    expect(generic('Desodorante Dove Roll-on', 'higiene')).toBe('Desodorante roll-on');
    expect(key('Desodorante Rexona Aerosol', 'higiene')).not.toBe(key('Desodorante Dove Roll-on', 'higiene'));
    // Na nota também: a toscana não cumpre a calabresa da lista.
    expect(sameItemFit({ name: 'Linguiça calabresa', category: 'carnes' }, { names: ['LINGUICA TOSCANA SEARA'], category: 'carnes' })).toBe('outro');
    expect(sameItemFit({ name: 'Linguiça', category: 'carnes' }, { names: ['LINGUICA CALABRESA SADIA'], category: 'carnes' })).toBe('mesmo');
  });

  it('"gilete" com outro produto de barbear ou o desodorante é a marca, e sai; sozinho, é a lâmina', () => {
    expect(genericItem('Espuma de Barbear Gilete 200ml', 'higiene')).toEqual({ name: 'Espuma de barbear', key: 'i:espuma_barbear', branded: true });
    expect(genericItem('Pós Barba Gilete', 'higiene').name).toBe('Pós barba');
    expect(genericItem('Desodorante Aerosol Gilete', 'higiene').key).toBe(genericItem('Desodorante Aerosol Rexona', 'higiene').key);
    expect(genericItem('Gilete Prestobarba 3', 'higiene')).toEqual({ name: 'Gilete', key: 'i:barbear', branded: true });
  });

  it('onde a marca é o item (ração, fralda, remédio), o nome fica', () => {
    expect(generic('Ração Golden Gatos Castrados 3kg', 'pet')).toBe('Ração Golden Gatos Castrados 3kg');
    expect(generic('Fralda Pampers M', 'bebe')).toBe('Fralda Pampers M');
  });

  it('sem marca para tirar, o nome fica como a pessoa escreveu', () => {
    expect(generic('Requeijão', 'laticinios')).toBe('Requeijão');
    expect(generic('LEITE DESNATADO', 'laticinios')).toBe('LEITE DESNATADO');
    expect(generic('Bombom da Alcatra', 'carnes')).toBe('Bombom da Alcatra');
    expect(generic('Polpa de fruta', 'congelados')).toBe('Polpa de fruta');
    expect(generic('  Banana  ')).toBe('Banana');
  });

  it('uma abreviação por extenso não está no nome: o nome fica, mas a chave diz o item', () => {
    expect(generic('REFRIG COCA ZERO', 'bebidas')).toBe('REFRIG COCA ZERO');
    expect(key('REFRIG COCA ZERO', 'bebidas')).toBe(key('Coca-Cola Zero 1L', 'bebidas'));
  });

  it('a chave junta as marcas do mesmo item e tipo, e separa os tipos', () => {
    expect(key('Leite IL Desnatado', 'laticinios')).toBe(key('Leite desnatado', 'laticinios'));
    expect(key('Leite Italac Desnatado 1L', 'laticinios')).toBe(key('Leite desnatado'));
    expect(key('Refrigerante sem Açúcar Coca-Cola Garrafa 1,5l', 'bebidas')).toBe(key('Coca-Cola Zero 1L', 'bebidas'));
    expect(key('Refrigerante Coca-Cola Zero', 'bebidas')).toBe(key('Coca-Cola Zero 1L', 'bebidas'));
    expect(key('Ovo Doninho Caipira', 'ovos')).toBe(key('Ovos caipira'));
    expect(key('Leite desnatado')).not.toBe(key('Leite integral'));
    expect(key('Leite desnatado')).not.toBe(key('Leite'));
    expect(key('Coca-Cola Zero')).not.toBe(key('Coca-Cola'));
    expect(key('Ovos caipira')).not.toBe(key('Ovos'));
    expect(key('Bolo de cenoura')).not.toBe(key('Bolo de fubá'));
    expect(key('Banana prata')).not.toBe(key('Banana nanica'));
  });
});

describe('sameListItem e pendingSameItem: o item que já está na lista', () => {
  it('o genérico e o com marca são o mesmo item, nos dois sentidos', () => {
    expect(sameListItem({ name: 'Leite desnatado', category: 'laticinios' }, { name: 'Leite IL Desnatado', category: 'laticinios' })).toBe(true);
    expect(sameListItem({ name: 'Leite IL Desnatado', category: 'laticinios' }, { name: 'Leite desnatado', category: 'laticinios' })).toBe(true);
    expect(sameListItem({ name: 'Coca-Cola zero' }, { name: 'Refrigerante sem Açúcar Coca-Cola Garrafa 1,5l' })).toBe(true);
    expect(sameListItem({ name: 'arroz' }, { name: 'Arroz' })).toBe(true);
  });

  it('outro tipo, outro tamanho ou um item que o app não conhece não são o mesmo', () => {
    expect(sameListItem({ name: 'Leite' }, { name: 'Leite desnatado' })).toBe(false);
    expect(sameListItem({ name: 'Leite desnatado' }, { name: 'Leite integral' })).toBe(false);
    expect(sameListItem({ name: 'Arroz 5kg' }, { name: 'Arroz 1kg' })).toBe(false);
    expect(sameListItem({ name: 'Pastilha Mentos' }, { name: 'Pastilha Halls' })).toBe(false);
    expect(sameListItem({ name: 'Danone Morango', category: 'laticinios' }, { name: 'Morango', category: 'hortifruti' })).toBe(false);
  });

  it('duas marcas pedidas pelo nome são dois pedidos; o item sem marca é o mesmo que qualquer uma', () => {
    const same = (a: string, b: string) => sameListItem({ name: a, category: guessCategory(a) }, { name: b, category: guessCategory(b) });
    const pairs: [string, string][] = [
      ['Shampoo Seda', 'Shampoo Clear Men'],
      ['Cerveja Heineken', 'Cerveja Brahma'],
      ['Biscoito Oreo', 'Biscoito Passatempo'],
      ['Iogurte Danone', 'Iogurte Nestlé'],
      ['Café Pilão', 'Café Melitta'],
      ['Desodorante Rexona', 'Desodorante Dove'],
      ['Linguiça Toscana', 'Linguiça calabresa'],
    ];
    for (const [a, b] of pairs) {
      expect(same(a, b)).toBe(false);
      expect(same(b, a)).toBe(false);
    }
    expect(same('Cerveja', 'Cerveja Heineken')).toBe(true);
    expect(same('Cerveja Heineken', 'Cerveja')).toBe(true);
    expect(same('Leite desnatado', 'Leite IL Desnatado')).toBe(true);
    // O mesmo nome continua sendo o mesmo pedido.
    expect(same('Shampoo Seda', 'shampoo seda')).toBe(true);
    // O tamanho e a embalagem não são marca.
    expect(same('Leite desnatado caixa 1L', 'Leite IL Desnatado')).toBe(true);
  });

  it('só conta o que ainda está para comprar', () => {
    const items = [
      { id: 'a', name: 'Leite IL Desnatado', category: 'laticinios', checked_at: '2026-10-20T10:00:00Z' },
      { id: 'b', name: 'Ovo Doninho Caipira', category: 'ovos', checked_at: null },
    ];
    expect(pendingSameItem({ name: 'Leite desnatado', category: 'laticinios' }, items)).toBeUndefined();
    expect(pendingSameItem({ name: 'Ovo caipira', category: 'ovos' }, items)?.id).toBe('b');
    expect(pendingSameItem({ name: 'Ovos', category: 'ovos' }, items)).toBeUndefined();
  });
});

describe('productSuggestions: a busca, uma vez por item', () => {
  const coffee = [
    { id: 'a-melitta', name: 'Café Melitta 500g', category: 'cafe_cha' },
    { id: 'b-pilao', name: 'Café Pilão 500g', category: 'cafe_cha' },
    { id: 'c-leite', name: 'Leite IL Desnatado', category: 'laticinios' },
  ];

  it('de cada item vai o produto usado por último, mesmo que venha depois na lista', () => {
    const used = new Map([
      ['a-melitta', Date.parse('2025-01-10T10:00:00Z')],
      ['b-pilao', Date.parse('2026-10-15T10:00:00Z')],
    ]);
    expect(productSuggestions(coffee, 'cafe', used).map((s) => [s.product.id, s.name])).toEqual([['b-pilao', 'Café']]);
    // Sem data de uso, vale a ordem.
    expect(productSuggestions(coffee, 'cafe', new Map()).map((s) => s.product.id)).toEqual(['a-melitta']);
    // Usado só o primeiro: fica ele.
    expect(productSuggestions(coffee, 'cafe', new Map([['a-melitta', 1]])).map((s) => s.product.id)).toEqual(['a-melitta']);
  });

  it('só o que tem o texto, até o limite de itens', () => {
    expect(productSuggestions(coffee, 'leite', new Map()).map((s) => s.name)).toEqual(['Leite desnatado']);
    expect(productSuggestions(coffee, 'e', new Map(), 1)).toHaveLength(1);
  });
});

describe('Marca preferida', () => {
  it('uma ligação com outra marca (de antes da escolha) só sugere, e marcar outra marca não ensina ligação', () => {
    const item: OpenListItem = { id: 'l1', name: 'Leite IL Desnatado', category: 'laticinios', product_id: 'il', checked_at: null, brand: true };
    const receipt: ReceiptLine[] = [
      { id: 'r1', productId: 'italac', name: 'Leite Italac Desnatado', names: ['Leite Italac Desnatado', 'LEITE ITALAC DESN'], category: 'laticinios' },
    ];
    const links = new LinkIndex([{ name_key: 'leite il desnatado', product_id: 'italac' }]);
    expect(matchListItems([item], receipt, links)).toEqual([{ listItemId: 'l1', receiptItemId: 'r1', reason: 'vinculo', checked: false }]);
    // Sem a escolha, a ligação vale como sempre.
    expect(matchListItems([{ ...item, brand: false }], receipt, links)).toEqual([{ listItemId: 'l1', receiptItemId: 'r1', reason: 'vinculo', checked: true }]);
    // O mesmo produto continua cumprindo.
    expect(matchListItems([item], [{ ...receipt[0], productId: 'il' }], links)).toEqual([{ listItemId: 'l1', receiptItemId: 'r1', reason: 'produto', checked: true }]);
    // A pessoa marcou o Italac na revisão: o item sai, mas sem ensinar que "Leite IL Desnatado" é o Italac.
    const chosen = [{ listItemId: 'l1', receiptItemId: 'r1', reason: 'escolha' as const, checked: true }];
    expect(listRemovals(chosen, [item], receipt).get('r1')).toEqual([{ id: 'l1', name: 'Leite IL Desnatado', name_key: '' }]);
    expect(listRemovals(chosen, [{ ...item, brand: false }], receipt).get('r1')).toEqual([
      { id: 'l1', name: 'Leite IL Desnatado', name_key: 'leite il desnatado' },
    ]);
    // Com o próprio produto, ensina.
    expect(listRemovals(chosen, [item], [{ ...receipt[0], productId: 'il' }]).get('r1')).toEqual([
      { id: 'l1', name: 'Leite IL Desnatado', name_key: 'leite il desnatado' },
    ]);
  });

  const milk = { name: 'Leite IL Desnatado', category: 'laticinios' };

  it('o produto com marca deixa escolher; o produto sem marca, não', () => {
    expect(brandChoice(milk)).toEqual({ brandName: 'Leite IL Desnatado', genericName: 'Leite desnatado' });
    expect(brandChoice({ name: 'Requeijão', category: 'laticinios' })).toBeNull();
    expect(brandChoice({ name: 'Pastilha Mentos', category: 'doces' })).toBeNull();
    expect(brandChoice(null)).toBeNull();
  });

  it('ligar põe o nome do produto; desligar volta o nome do item, ou o sem a marca', () => {
    const choice = brandChoice(milk);
    // Item sem marca: liga com o nome do produto e, desligando, volta ao nome que tinha.
    expect(switchBrand({ on: false, name: 'Leite desnatado' }, 'Leite desnatado', choice)).toEqual({ on: true, name: 'Leite IL Desnatado' });
    expect(switchBrand({ on: true, name: 'Leite IL Desnatado' }, 'Leite da vovó', choice)).toEqual({ on: false, name: 'Leite da vovó' });
    // O item já tinha o nome do produto (ligada antes, ou um item de antes da lista sem marca): desliga sem a marca.
    expect(switchBrand({ on: true, name: 'Leite IL Desnatado' }, 'leite il desnatado ', choice)).toEqual({ on: false, name: 'Leite desnatado' });
    // Um item de antes, com o nome do produto e sem a escolha: ligar só liga (o nome já é o do produto).
    expect(switchBrand({ on: false, name: 'Leite IL Desnatado' }, 'Leite IL Desnatado', choice)).toEqual({ on: true, name: 'Leite IL Desnatado' });
    // O nome que a pessoa escreveu no campo fica.
    expect(switchBrand({ on: true, name: 'Leite IL 1L' }, 'Leite IL Desnatado', choice)).toEqual({ on: false, name: 'Leite IL 1L' });
    // Sem produto com marca (a escolha ficou de antes): só a escolha muda.
    expect(switchBrand({ on: true, name: 'Leite IL Desnatado' }, 'Leite IL Desnatado', null)).toEqual({ on: false, name: 'Leite IL Desnatado' });
  });

  it('o item de antes com o nome de um produto, sem a escolha, casa com outra marca do mesmo item (#119)', () => {
    const receipt: ReceiptLine[] = [
      { id: 'r1', productId: 'p-italac', name: 'Leite Italac Desnatado', names: ['Leite Italac Desnatado', 'LEITE ITALAC DESN'], category: 'laticinios' },
    ];
    const legacy: OpenListItem = {
      id: 'l1',
      name: 'Leite IL Desnatado',
      category: 'laticinios',
      product_id: 'p-il',
      checked_at: '2026-10-20T10:00:00Z',
    };
    expect(matchListItems([legacy], receipt, new LinkIndex())).toEqual([{ listItemId: 'l1', receiptItemId: 'r1', reason: 'item', checked: true }]);
    expect(matchListItems([{ ...legacy, brand: false }], receipt, new LinkIndex())).toEqual([
      { listItemId: 'l1', receiptItemId: 'r1', reason: 'item', checked: true },
    ]);
    // Com a escolha ligada, a outra marca não cumpre.
    expect(matchListItems([{ ...legacy, brand: true }], receipt, new LinkIndex())).toEqual([]);
  });

  it('na nota, com a marca preferida só cumpre o mesmo produto ou o mesmo nome; sem ela, qualquer marca', () => {
    const receipt: ReceiptLine[] = [
      { id: 'r1', productId: 'p-rancho', name: 'Ovos Rancho Caipira', names: ['Ovos Rancho Caipira', 'OVOS RANCHO CAIPIRA'], category: 'ovos' },
    ];
    const item = (brand: boolean, name: string): OpenListItem => ({
      id: 'l1',
      name,
      category: 'ovos',
      product_id: 'p-doninho',
      checked_at: '2026-10-20T10:00:00Z',
      brand,
    });
    const match = (listItem: OpenListItem) => matchListItems([listItem], receipt, new LinkIndex());
    // Genérico, com o Doninho só como dica de preço: os ovos caipira de outra marca cumprem.
    expect(match(item(false, 'Ovo caipira'))).toEqual([{ listItemId: 'l1', receiptItemId: 'r1', reason: 'item', checked: true }]);
    // Marca preferida: nem como sugestão.
    expect(match(item(true, 'Ovo Doninho Caipira'))).toEqual([]);
    // O mesmo produto cumpre.
    expect(matchListItems([item(true, 'Ovo Doninho Caipira')], [{ ...receipt[0], productId: 'p-doninho' }], new LinkIndex())).toEqual([
      { listItemId: 'l1', receiptItemId: 'r1', reason: 'produto', checked: true },
    ]);
    // Um nome com as mesmas palavras (com a marca) fica como sugestão.
    const sameWords: ReceiptLine = { id: 'r2', productId: 'p-novo', name: 'Ovo Doninho Caipira 12un', names: ['Ovo Doninho Caipira 12un', 'OVO DONINHO CAIPIRA'], category: 'ovos' };
    expect(matchListItems([item(true, 'Ovo Doninho Caipira')], [sameWords], new LinkIndex())).toEqual([
      { listItemId: 'l1', receiptItemId: 'r2', reason: 'nome', checked: false },
    ]);
  });

  it('o item genérico da leitura por foto não faz outra marca cumprir a marca preferida', () => {
    const photo: ReceiptLine = { id: 'r1', productId: null, names: ['ITALAC DESN 1L'], generic: 'leite desnatado', category: 'laticinios' };
    const wanted = (brand: boolean): OpenListItem => ({
      id: 'l1',
      name: brand ? 'Leite IL Desnatado' : 'Leite desnatado',
      category: 'laticinios',
      product_id: 'il',
      checked_at: '2026-10-20T10:00:00Z',
      brand,
    });
    // Sem a escolha, o genérico diz o item e a linha cumpre (#120).
    expect(matchListItems([wanted(false)], [photo], new LinkIndex())).toEqual([{ listItemId: 'l1', receiptItemId: 'r1', reason: 'item', checked: true }]);
    // Com a marca preferida, a outra marca não cumpre, nem como sugestão.
    expect(matchListItems([wanted(true)], [photo], new LinkIndex())).toEqual([]);
  });
});

