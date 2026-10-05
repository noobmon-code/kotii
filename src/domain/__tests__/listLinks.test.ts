import { describe, expect, it } from '@jest/globals';

import { findSamePurchase, receiptPantryRepeats } from '../cartPantry';
import {
  applyListChoices,
  forgottenLinks,
  LinkIndex,
  listNameKey,
  listRemovals,
  matchListItems,
  type OpenListItem,
  type ReceiptLine,
} from '../listLinks';

const COCA: ReceiptLine = {
  id: 'r-coca',
  productId: 'p-coca',
  names: ['Refrigerante sem Açúcar Coca-Cola Garrafa 1,5l', 'COCA S ACUCAR 1 5L'],
  category: 'bebidas',
};
const CEBOLA: ReceiptLine = {
  id: 'r-cebola',
  productId: 'p-cebola',
  names: ['Cebola Granel 600g', 'CEBOLA GRANEL 600G APROX'],
  category: 'hortifruti',
};
const SAL: ReceiptLine = { id: 'r-sal', productId: null, names: ['Sal Refinado LEBRE Pacote 1Kg'], category: 'temperos' };
const FILTRO: ReceiptLine = {
  id: 'r-filtro',
  productId: 'p-filtro',
  names: ['Filtro de Papel Original Melitta 102 Caixa 30 Unidades'],
  category: 'outros',
};
const LEITE_CONDENSADO: ReceiptLine = { id: 'r-moca', productId: 'p-moca', names: ['Leite Condensado Moça 395g'], category: 'doces' };
const LEITE: ReceiptLine = { id: 'r-leite', productId: 'p-leite', names: ['Leite Integral Italac 1L'], category: 'laticinios' };

const item = (id: string, name: string, product_id: string | null = null, category = 'outros'): OpenListItem => ({
  id,
  name,
  category,
  product_id,
});

describe('listNameKey', () => {
  it('sem acento, maiúscula nem pontuação', () => {
    expect(listNameKey('  Filtro de Café (102) ')).toBe('filtro de cafe 102');
    expect(listNameKey('Coca-Cola Zero 1,5L')).toBe('coca cola zero 1 5l');
    expect(listNameKey('!!!')).toBe('');
  });
});

describe('matchListItems', () => {
  const receipt = [COCA, CEBOLA, SAL, FILTRO, LEITE_CONDENSADO, LEITE];

  it('mesmo produto vem marcado, mesmo com nome diferente', () => {
    expect(matchListItems([item('l1', 'Coca', 'p-coca')], receipt, new LinkIndex())).toEqual([
      { listItemId: 'l1', receiptItemId: 'r-coca', reason: 'produto', checked: true },
    ]);
  });

  it('vínculo já confirmado vem marcado ("Refrigerante" cumprido pela Coca)', () => {
    const links = new LinkIndex([{ name_key: 'refrigerante', product_id: 'p-coca' }]);
    expect(matchListItems([item('l1', 'Refrigerante')], receipt, links)).toEqual([
      { listItemId: 'l1', receiptItemId: 'r-coca', reason: 'vinculo', checked: true },
    ]);
  });

  it('nome com as mesmas palavras só sugere, desmarcado; produto novo (sem id) também entra', () => {
    expect(matchListItems([item('l1', 'Cebola'), item('l2', 'sal')], receipt, new LinkIndex())).toEqual([
      { listItemId: 'l1', receiptItemId: 'r-cebola', reason: 'nome', checked: false },
      { listItemId: 'l2', receiptItemId: 'r-sal', reason: 'nome', checked: false },
    ]);
  });

  it('entre nomes que batem, fica o da mesma categoria ("Leite" é o integral, não o condensado)', () => {
    expect(matchListItems([item('l1', 'Leite', null, 'laticinios')], receipt, new LinkIndex())[0].receiptItemId).toBe('r-leite');
  });

  it('na mesma categoria, fica o nome mais curto', () => {
    const lines: ReceiptLine[] = [
      { id: 'longo', productId: null, names: ['Tomate Italiano Orgânico Bandeja 500g'], category: 'hortifruti' },
      { id: 'curto', productId: null, names: ['Tomate Granel'], category: 'hortifruti' },
    ];
    expect(matchListItems([item('l1', 'Tomate', null, 'hortifruti')], lines, new LinkIndex())[0].receiptItemId).toBe('curto');
  });

  it('plural, acento e palavras de ligação não atrapalham', () => {
    expect(matchListItems([item('l1', 'Cebolas')], receipt, new LinkIndex())[0].receiptItemId).toBe('r-cebola');
    expect(matchListItems([item('l1', 'Filtro de papel')], receipt, new LinkIndex())[0].receiptItemId).toBe('r-filtro');
  });

  it('sem palavra em comum, não adivinha', () => {
    expect(matchListItems([item('l1', 'Filtro de café'), item('l2', 'Coca Zero'), item('l3', 'Detergente')], receipt, new LinkIndex())).toEqual([]);
  });

  it('o mesmo item da nota cumpre mais de um item de lista', () => {
    const links = new LinkIndex([{ name_key: 'refrigerante', product_id: 'p-coca' }]);
    const matches = matchListItems([item('l1', 'Coca', 'p-coca'), item('l2', 'Refrigerante')], receipt, links);
    expect(matches.map((m) => m.receiptItemId)).toEqual(['r-coca', 'r-coca']);
  });
});

describe('applyListChoices e listRemovals', () => {
  const listItems = [item('l1', 'Cebola'), item('l2', 'Filtro de café'), item('l3', 'Coca', 'p-coca')];
  const matches = matchListItems(listItems, [COCA, CEBOLA, FILTRO], new LinkIndex());

  it('a pessoa marca a sugestão, liga um item à mão e desfaz outro', () => {
    const chosen = applyListChoices(matches, {
      l1: { receiptItemId: 'r-cebola', checked: true },
      l2: { receiptItemId: 'r-filtro', checked: true },
      l3: { receiptItemId: null, checked: false },
    });
    expect(chosen).toEqual([
      { listItemId: 'l1', receiptItemId: 'r-cebola', reason: 'nome', checked: true },
      { listItemId: 'l2', receiptItemId: 'r-filtro', reason: 'escolha', checked: true },
    ]);
    expect(Object.fromEntries(listRemovals(chosen, listItems))).toEqual({
      'r-cebola': [{ id: 'l1', name: 'Cebola', name_key: 'cebola' }],
      'r-filtro': [{ id: 'l2', name: 'Filtro de café', name_key: 'filtro de cafe' }],
    });
  });

  it('sugestão desmarcada não sai da lista', () => {
    expect(listRemovals(matches, listItems)).toEqual(new Map([['r-coca', [{ id: 'l3', name: 'Coca', name_key: 'coca' }]]]));
  });
});

describe('despensa sem repetir, com vínculos', () => {
  const links = new LinkIndex([{ name_key: 'filtro de cafe', product_id: 'p-filtro' }]);

  it('o "Filtro de café" do carrinho é o filtro Melitta da nota', () => {
    const entries = [{ product_id: null, name: 'Filtro de café', purchased_on: '2026-10-03' }];
    expect(findSamePurchase({ productId: 'p-filtro', name: 'Filtro de Papel Melitta' }, '2026-10-04', entries)).toBeUndefined();
    expect(findSamePurchase({ productId: 'p-filtro', name: 'Filtro de Papel Melitta' }, '2026-10-04', entries, links)).toBe(
      entries[0],
    );
  });

  it('a nota que chega depois do carrinho pergunta antes de repetir', () => {
    const repeats = receiptPantryRepeats(
      [{ id: 'r-filtro', product_id: 'p-filtro', pantry: { name: 'Filtro de Papel Original Melitta' } }],
      '2026-10-03',
      [{ product_id: null, name: 'Filtro de café', purchased_on: '2026-10-03' }],
      links,
    );
    expect(repeats).toEqual([{ id: 'r-filtro', name: 'Filtro de Papel Original Melitta', since: '2026-10-03' }]);
  });
});

describe('forgottenLinks', () => {
  const links = new LinkIndex([{ name_key: 'refrigerante', product_id: 'p-coca' }]);
  const listItems = [item('l1', 'Refrigerante'), item('l2', 'Coca', 'p-coca')];
  const matches = matchListItems(listItems, [COCA], links);

  it('"não foi comprado nesta nota" num item ligado antes desfaz a ligação', () => {
    expect(forgottenLinks(matches, { l1: { receiptItemId: null, checked: false } }, listItems)).toEqual(
      new Map([['r-coca', ['refrigerante']]]),
    );
  });

  it('só desmarcar deixa o item na lista e mantém a ligação; mesmo produto não é ligação aprendida', () => {
    expect(
      forgottenLinks(
        matches,
        { l1: { receiptItemId: 'r-coca', checked: false }, l2: { receiptItemId: null, checked: false } },
        listItems,
      ),
    ).toEqual(new Map());
  });
});
