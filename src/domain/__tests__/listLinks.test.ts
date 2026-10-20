import { describe, expect, it, jest } from '@jest/globals';

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

  it('sem o mesmo item nem palavra em comum, não adivinha', () => {
    expect(matchListItems([item('l1', 'Detergente'), item('l2', 'Feijão')], receipt, new LinkIndex())).toEqual([]);
  });

  it('o mesmo item da nota cumpre mais de um item de lista', () => {
    const links = new LinkIndex([{ name_key: 'refrigerante', product_id: 'p-coca' }]);
    const matches = matchListItems([item('l1', 'Coca', 'p-coca'), item('l2', 'Refrigerante')], receipt, links);
    expect(matches.map((m) => m.receiptItemId)).toEqual(['r-coca', 'r-coca']);
  });

  it('produto da nota com o mesmo nome do item da lista vem marcado, e só enquanto o nome for esse', () => {
    const line = (name: string | null): ReceiptLine => ({
      id: 'r-1',
      productId: null,
      name,
      names: ['Coca Zero 2l', 'COCA ZERO 2L'],
      category: 'bebidas',
    });
    const list = [item('l1', 'coca zero'), item('l2', 'Coca')];
    // A pessoa deu ao produto o nome que está na lista ("Coca zero"): esse item sai marcado; "Coca" só sugere.
    expect(matchListItems(list, [line('Coca Zero')], new LinkIndex())).toEqual([
      { listItemId: 'l1', receiptItemId: 'r-1', reason: 'nome', checked: true },
      { listItemId: 'l2', receiptItemId: 'r-1', reason: 'nome', checked: false },
    ]);
    // Trocou o nome do produto: volta a ser só sugestão.
    expect(matchListItems(list, [line('Coca-Cola Zero 2L')], new LinkIndex()).map((m) => m.checked)).toEqual([false, false]);
    // Sem produto ("não acompanhar preço"), o nome não marca nada.
    expect(matchListItems(list, [line(null)], new LinkIndex()).map((m) => m.checked)).toEqual([false, false]);
  });

  it('o mesmo nome vale também para produto que já existe e item de lista digitado solto', () => {
    const banana: ReceiptLine = { id: 'r-banana', productId: 'p-banana', name: 'Banana', names: ['Banana', 'BANANA PRATA KG'], category: 'hortifruti' };
    expect(matchListItems([item('l1', 'bananas'), item('l2', 'banana')], [banana], new LinkIndex())).toEqual([
      { listItemId: 'l1', receiptItemId: 'r-banana', reason: 'nome', checked: false },
      { listItemId: 'l2', receiptItemId: 'r-banana', reason: 'nome', checked: true },
    ]);
  });
});

describe('matchListItems com outra noção de mesmo nome', () => {
  const limao: ReceiptLine = { id: 'r-limao', productId: 'p-limao', name: 'Limão', names: ['Limão', 'LIMAO TAITI KG'], category: 'hortifruti' };
  const banana: ReceiptLine = { id: 'r-banana', productId: null, name: 'Banana', names: ['Banana', 'BANANA PRATA KG'], category: 'hortifruti' };
  const list = [item('l1', 'Limões'), item('l2', 'bananas'), item('l3', 'Banana kg'), item('l4', 'Banana prata')];
  // No lugar da regra de verdade (domain/similarNames): sem o plural nem a unidade solta, com as palavras na ordem.
  const loose = (name: string) =>
    listNameKey(name)
      .split(' ')
      .filter((word) => word !== 'kg' && word !== 'de' && word !== 'para')
      .map((word) => word.replace(/oes$/, 'ao').replace(/s$/, ''))
      .join(' ');
  const sameLoose = (listItemName: string, productName: string) => loose(listItemName) === loose(productName);

  it('na revisão da nota, plural e unidade solta não tiram a marca do item da lista', () => {
    expect(matchListItems(list, [limao, banana], new LinkIndex(), sameLoose)).toEqual([
      { listItemId: 'l1', receiptItemId: 'r-limao', reason: 'nome', checked: true },
      { listItemId: 'l2', receiptItemId: 'r-banana', reason: 'nome', checked: true },
      { listItemId: 'l3', receiptItemId: 'r-banana', reason: 'nome', checked: true },
      // Outro nome ("Banana prata" não é "Banana") continua só como sugestão.
      { listItemId: 'l4', receiptItemId: 'r-banana', reason: 'nome', checked: false },
    ]);
  });

  it('quem decide é a regra passada: as mesmas palavras em outra ordem só sugerem, sem marcar', () => {
    const tomate: ReceiptLine = {
      id: 'r-tomate',
      productId: null,
      name: 'Tomate para Molho Kg',
      names: ['Tomate para Molho Kg', 'TOMATE P/ MOLHO KG'],
      category: 'hortifruti',
    };
    // E tomate para molho é tomate, outro item (domain/sameItem): nem sugere.
    expect(matchListItems([item('l1', 'Molho de tomate')], [tomate], new LinkIndex(), sameLoose)).toEqual([]);
    // Na ordem do item da lista, é o mesmo nome.
    const molho: ReceiptLine = { ...tomate, id: 'r-molho', name: 'Molho Tomate', names: ['Molho Tomate'] };
    expect(matchListItems([item('l1', 'Molho de tomate')], [tomate, molho], new LinkIndex(), sameLoose)).toEqual([
      { listItemId: 'l1', receiptItemId: 'r-molho', reason: 'nome', checked: true },
    ]);
  });

  it('a regra recebe o nome do item da lista e o do produto do item da nota, nessa ordem; item sem produto não entra', () => {
    const same = jest.fn((listItemName: string, productName: string) => listItemName === 'Limões' && productName === 'Limão');
    const unnamed: ReceiptLine = { id: 'r-x', productId: null, name: null, names: ['Limões'], category: 'hortifruti' };
    expect(matchListItems([item('l1', 'Limões')], [unnamed, limao], new LinkIndex(), same)).toEqual([
      { listItemId: 'l1', receiptItemId: 'r-limao', reason: 'nome', checked: true },
    ]);
    expect(same.mock.calls).toEqual([['Limões', 'Limão']]);
  });

  it('sem pedir, a marca continua só para o nome escrito igual', () => {
    expect(matchListItems(list, [limao, banana], new LinkIndex()).map((m) => [m.listItemId, m.checked])).toEqual([
      // "Limões" é o mesmo item que o limão, mas fora do carrinho só sugere.
      ['l1', false],
      ['l2', false],
      ['l3', false],
      ['l4', false],
    ]);
  });

  it('o que sai da lista leva o nome e a chave do próprio item, que o banco confere', () => {
    const matches = matchListItems([item('l1', 'Limões')], [limao], new LinkIndex(), sameLoose);
    expect(listRemovals(matches, [item('l1', 'Limões')])).toEqual(new Map([['r-limao', [{ id: 'l1', name: 'Limões', name_key: 'limoes' }]]]));
  });
});

describe('applyListChoices e listRemovals', () => {
  const listItems = [item('l1', 'Cebola'), item('l2', 'Saco de lixo'), item('l3', 'Coca', 'p-coca')];
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
      'r-filtro': [{ id: 'l2', name: 'Saco de lixo', name_key: 'saco de lixo' }],
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
    // Pelo nome da nota, o app não sabe que item é ("Melitta 102"): só a ligação diz.
    expect(findSamePurchase({ productId: 'p-filtro', name: 'Melitta 102 c/30' }, '2026-10-04', entries)).toBeUndefined();
    expect(findSamePurchase({ productId: 'p-filtro', name: 'Melitta 102 c/30' }, '2026-10-04', entries, links)).toBe(
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
