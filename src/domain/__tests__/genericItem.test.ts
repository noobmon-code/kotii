import { describe, expect, it } from '@jest/globals';

import { brandChoice, genericItem, pendingSameItem, prefersBrand, sameListItem } from '../genericItem';
import { LinkIndex, matchListItems, type OpenListItem, type ReceiptLine } from '../listLinks';

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

describe('Marca preferida', () => {
  const milk = { name: 'Leite IL Desnatado', category: 'laticinios' };

  it('o produto com marca deixa escolher; o produto sem marca, não', () => {
    expect(brandChoice(milk)).toEqual({ brandName: 'Leite IL Desnatado', genericName: 'Leite desnatado' });
    expect(brandChoice({ name: 'Requeijão', category: 'laticinios' })).toBeNull();
    expect(brandChoice({ name: 'Pastilha Mentos', category: 'doces' })).toBeNull();
    expect(brandChoice(null)).toBeNull();
  });

  it('ligada é o nome do produto; desligada, o nome sem a marca', () => {
    expect(prefersBrand({ name: 'Leite IL Desnatado' }, milk)).toBe(true);
    expect(prefersBrand({ name: 'leite il desnatado ' }, milk)).toBe(true);
    expect(prefersBrand({ name: 'Leite desnatado' }, milk)).toBe(false);
    expect(prefersBrand({ name: 'Requeijão' }, { name: 'Requeijão', category: 'laticinios' })).toBe(false);
    expect(prefersBrand({ name: 'Leite IL Desnatado' }, undefined)).toBe(false);
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
});

