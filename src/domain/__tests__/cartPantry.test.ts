import { describe, expect, it } from '@jest/globals';

import {
  cartPantryPayload,
  cartPantryRows,
  findSamePurchase,
  joinNames,
  receiptPantryRepeats,
  SAME_PURCHASE_DAYS,
  type CartItem,
} from '../cartPantry';

const item = (over: Partial<CartItem>): CartItem => ({
  id: 'i1',
  name: 'Leite',
  category: 'laticinios',
  quantity: 2,
  unit: 'un',
  product_id: null,
  checked_at: '2026-09-26T15:00:00',
  ...over,
});

describe('findSamePurchase', () => {
  const entries = [
    { product_id: 'p-arroz', name: 'Arroz Tio João 5kg', purchased_on: '2026-09-25' },
    { product_id: null, name: 'Leite', purchased_on: '2026-09-26' },
  ];

  it('acha pelo produto, mesmo com nomes diferentes', () => {
    expect(findSamePurchase({ productId: 'p-arroz', name: 'Arroz' }, '2026-09-27', entries)?.name).toBe('Arroz Tio João 5kg');
  });

  it('acha pelo nome quando um começa pelo outro, sem acento nem caixa', () => {
    expect(findSamePurchase({ productId: null, name: 'LEITE italac 1L' }, '2026-09-26', entries)?.name).toBe('Leite');
    expect(findSamePurchase({ productId: null, name: 'Leiteira' }, '2026-09-26', entries)).toBeUndefined();
  });

  it('produto de outra marca do mesmo item bate: é a pergunta antes de repetir, com o critério da revisão da nota', () => {
    expect(findSamePurchase({ productId: 'p-outro', name: 'Arroz Camil Polido 5kg' }, '2026-09-25', entries)?.name).toBe('Arroz Tio João 5kg');
    expect(findSamePurchase({ productId: 'p-parmalat', name: 'Leite UHT Parmalat Caixa' }, '2026-09-26', entries)?.name).toBe('Leite');
  });

  it('outra coisa não bate, nem com o nome começando igual', () => {
    expect(findSamePurchase({ productId: 'p-feijao', name: 'Feijão Carioca 1kg' }, '2026-09-25', entries)).toBeUndefined();
    expect(findSamePurchase({ productId: null, name: 'Leite condensado' }, '2026-09-26', entries)).toBeUndefined();
    // A versão que só um lado diz é outra coisa: o arroz calado é o branco.
    expect(findSamePurchase({ productId: 'p-integral', name: 'Arroz integral' }, '2026-09-25', [entries[0]])).toBeUndefined();
  });

  it('o mesmo item em pó: "Achocolatado" e "Achocolatado em pó" são uma compra só', () => {
    const fromCart = [{ product_id: null, name: 'Achocolatado', purchased_on: '2026-10-20' }];
    expect(findSamePurchase({ productId: 'p-achoc', name: 'Achocolatado em pó Bom Dia 400g' }, '2026-10-20', fromCart)).toBe(fromCart[0]);
    expect(findSamePurchase({ productId: null, name: 'Gelatina' }, '2026-10-20', [{ product_id: 'p-gel', name: 'Gelatina em pó morango', purchased_on: '2026-10-19' }])).toBeDefined();
  });

  it('a entrada mais certa vem primeiro', () => {
    const pantry = [
      { product_id: null, name: 'Carne', purchased_on: '2026-10-20' },
      { product_id: 'p-moida', name: 'Carne moída bovina', purchased_on: '2026-10-20' },
    ];
    expect(findSamePurchase({ productId: 'p-moida', name: 'Carne Moída Boa Mesa' }, '2026-10-20', pantry)?.name).toBe('Carne moída bovina');
  });

  it('o corte de carne da nota é a "Carne" que o carrinho guardou', () => {
    const fromCart = [{ product_id: null, name: 'Carne', purchased_on: '2026-10-20' }];
    expect(findSamePurchase({ productId: 'p-bombom', name: 'Bombom da Alcatra' }, '2026-10-20', fromCart)).toBe(fromCart[0]);
  });

  it(`só vale até ${SAME_PURCHASE_DAYS} dias de diferença, para os dois lados`, () => {
    expect(findSamePurchase({ productId: null, name: 'Leite' }, '2026-09-29', entries)).toBeDefined();
    expect(findSamePurchase({ productId: null, name: 'Leite' }, '2026-09-23', entries)).toBeDefined();
    expect(findSamePurchase({ productId: null, name: 'Leite' }, '2026-09-30', entries)).toBeUndefined();
  });
});

describe('cartPantryRows', () => {
  const today = '2026-09-28';

  it('no limpar, vai o que a categoria guarda e não está na despensa', () => {
    const rows = cartPantryRows(
      [item({ id: 'a' }), item({ id: 'b', name: 'Detergente', category: 'limpeza' }), item({ id: 'c', name: 'Banana', category: 'hortifruti' })],
      [{ product_id: null, name: 'Banana', purchased_on: '2026-09-27' }],
      { single: false, today },
    );
    expect(rows.map((r) => [r.id, r.include, r.alreadySince])).toEqual([
      ['a', true, null],
      ['b', false, null],
      ['c', false, '2026-09-27'],
    ]);
  });

  it('sem saber o que há na despensa, o limpar não marca nada; o botão do item, sim', () => {
    const cart = [item({ id: 'a' }), item({ id: 'b', name: 'Banana', category: 'hortifruti' })];
    expect(cartPantryRows(cart, null, { single: false, today }).map((r) => r.include)).toEqual([false, false]);
    expect(cartPantryRows([item({})], null, { single: true, today })[0].include).toBe(true);
  });

  it('o botão do item manda aquele item, qualquer que seja a categoria', () => {
    const [row] = cartPantryRows([item({ name: 'Detergente', category: 'limpeza' })], [], { single: true, today });
    expect(row.include).toBe(true);
  });

  it('no limpar, outra versão ou o que só pode ser o mesmo não fica de fora sem perguntar', () => {
    const pantry = [
      { product_id: 'p1', name: 'Arroz Grão Bom 5kg', purchased_on: '2026-10-19' },
      { product_id: 'p3', name: 'Coca-Cola 2L', purchased_on: '2026-10-19' },
      { product_id: 'p7', name: 'Leite Integral Serrana', purchased_on: '2026-10-19' },
      { product_id: 'p8', name: 'Bife de Alcatra', purchased_on: '2026-10-19' },
    ];
    const cart = [
      item({ id: 'integral', name: 'Arroz integral Sol', category: 'graos', product_id: 'p2', checked_at: '2026-10-20T15:00:00' }),
      item({ id: 'zero', name: 'Coca zero', category: 'bebidas', product_id: 'p4', checked_at: '2026-10-20T15:00:00' }),
      item({ id: 'achoc', name: 'Leite achocolatado Serrana', category: 'laticinios', product_id: 'p9', checked_at: '2026-10-20T15:00:00' }),
      // Outro tamanho, dois produtos: pode ser o mesmo, mas não com certeza.
      item({ id: 'quilo', name: 'Arroz Sol 1kg', category: 'graos', product_id: 'p5', checked_at: '2026-10-20T15:00:00' }),
      // O mesmo item de outra marca é a mesma compra.
      item({ id: 'marca', name: 'Arroz Sol 5kg', category: 'graos', product_id: 'p6', checked_at: '2026-10-20T15:00:00' }),
      // O nome solto da lista e o corte que a nota trouxe: a mesma compra.
      item({ id: 'carne', name: 'Carne', category: 'carnes', checked_at: '2026-10-20T15:00:00' }),
    ];
    expect(cartPantryRows(cart, pantry, { single: false, today: '2026-10-20' }).map((r) => [r.id, r.include, r.alreadySince])).toEqual([
      ['integral', true, null],
      ['zero', true, null],
      ['achoc', true, null],
      ['quilo', true, null],
      ['marca', false, '2026-10-19'],
      ['carne', false, '2026-10-19'],
    ]);
  });

  it('a data da compra é o dia em que foi para o carrinho; sem ela, hoje', () => {
    expect(cartPantryRows([item({})], [], { single: true, today })[0].purchasedOn).toBe('2026-09-26');
    expect(cartPantryRows([item({ checked_at: null })], [], { single: true, today })[0].purchasedOn).toBe(today);
  });
});

describe('cartPantryPayload', () => {
  const rows = cartPantryRows(
    [
      item({ id: 'a', product_id: 'p-leite' }),
      item({ id: 'b', name: 'Detergente', category: 'limpeza' }),
      item({ id: 'c', name: 'Pão', category: 'padaria' }),
    ],
    [],
    { single: false, today: '2026-09-28' },
  );

  it('leva a quantidade confirmada e a validade estimada', () => {
    const payload = cartPantryPayload(rows, { a: { include: true, quantity: 3 } }, new Map([['p-leite', 10]]));
    expect(payload).toEqual([
      { id: 'a', quantity: 3, purchased_on: '2026-09-26', expires_on: '2026-10-06', expiry_source: 'produto' },
      { id: 'c', quantity: 2, purchased_on: '2026-09-26', expires_on: '2026-10-01', expiry_source: 'categoria' },
    ]);
  });

  it('respeita o que a pessoa desmarcou ou marcou, e pula quantidade inválida', () => {
    const payload = cartPantryPayload(
      rows,
      { a: { include: false, quantity: 2 }, b: { include: true, quantity: 1 }, c: { include: true, quantity: null } },
      new Map(),
    );
    expect(payload).toEqual([{ id: 'b', quantity: 1, purchased_on: '2026-09-26', expires_on: null, expiry_source: null }]);
  });
});

describe('receiptPantryRepeats', () => {
  it('aponta o que a nota repetiria na despensa', () => {
    const repeats = receiptPantryRepeats(
      [
        { id: 'r1', product_id: 'p-leite', pantry: { name: 'Leite Italac 1L' } },
        { id: 'r2', pantry: { name: 'Banana prata' } },
        { id: 'r3', product_id: 'p-sabao' },
      ],
      '2026-09-28',
      [
        { product_id: 'p-leite', name: 'Leite', purchased_on: '2026-09-27' },
        { product_id: null, name: 'Banana', purchased_on: '2026-09-20' },
        { product_id: 'p-sabao', name: 'Sabão', purchased_on: '2026-09-28' },
      ],
    );
    expect(repeats).toEqual([{ id: 'r1', name: 'Leite Italac 1L', since: '2026-09-27' }]);
  });

  it('uma entrada da despensa é a repetição de uma compra só da nota, a mais certa', () => {
    const fromCart = [{ product_id: null, name: 'Carne', purchased_on: '2026-10-18' }];
    const repeats = receiptPantryRepeats(
      [
        { id: 'r1', product_id: 'p-bife', pantry: { name: 'Bife de Alcatra' } },
        { id: 'r2', product_id: 'p-moida', pantry: { name: 'Carne Moída' } },
        { id: 'r3', product_id: 'p-costela', pantry: { name: 'Costela Bovina' } },
      ],
      '2026-10-20',
      fromCart,
    );
    // A carne moída é a "Carne" com certeza; o bife e a costela só poderiam ser, e a entrada já é da moída.
    expect(repeats).toEqual([{ id: 'r2', name: 'Carne Moída', since: '2026-10-18' }]);
  });

  it('duas linhas do mesmo produto são uma compra só: as duas repetem', () => {
    const repeats = receiptPantryRepeats(
      [
        { id: 'r1', product_id: 'p-leite', pantry: { name: 'Leite UHT Serrana' } },
        { id: 'r2', product_id: 'p-leite', pantry: { name: 'Leite UHT Serrana' } },
        { id: 'r3', product_id: 'p-condensado', pantry: { name: 'Leite Condensado Boa Vaca' } },
      ],
      '2026-10-20',
      [{ product_id: null, name: 'Leite', purchased_on: '2026-10-20' }],
    );
    expect(repeats.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('pergunta também pelo que só pode ser o mesmo, de dois produtos', () => {
    const repeats = receiptPantryRepeats(
      [{ id: 'r1', product_id: 'p-quilo', pantry: { name: 'Arroz Sol 1kg' } }],
      '2026-10-20',
      [{ product_id: 'p-cinco', name: 'Arroz Grão Bom 5kg', purchased_on: '2026-10-19' }],
    );
    expect(repeats).toEqual([{ id: 'r1', name: 'Arroz Sol 1kg', since: '2026-10-19' }]);
  });
});

describe('joinNames', () => {
  it('junta como se fala', () => {
    expect(joinNames(['Arroz'])).toBe('Arroz');
    expect(joinNames(['Arroz', 'Leite'])).toBe('Arroz e Leite');
    expect(joinNames(['Arroz', 'Leite', 'Pão'])).toBe('Arroz, Leite e Pão');
  });
});
