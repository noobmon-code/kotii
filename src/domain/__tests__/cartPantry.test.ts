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

  it('produtos diferentes não batem, mesmo com o nome parecido', () => {
    expect(findSamePurchase({ productId: 'p-outro', name: 'Arroz Tio João 5kg' }, '2026-09-25', entries)).toBeUndefined();
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

  it('o botão do item manda aquele item, qualquer que seja a categoria', () => {
    const [row] = cartPantryRows([item({ name: 'Detergente', category: 'limpeza' })], [], { single: true, today });
    expect(row.include).toBe(true);
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
});

describe('joinNames', () => {
  it('junta como se fala', () => {
    expect(joinNames(['Arroz'])).toBe('Arroz');
    expect(joinNames(['Arroz', 'Leite'])).toBe('Arroz e Leite');
    expect(joinNames(['Arroz', 'Leite', 'Pão'])).toBe('Arroz, Leite e Pão');
  });
});
