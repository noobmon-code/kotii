import { describe, expect, it } from '@jest/globals';

import { groupPantry, takeOne, type PantryLot } from '../pantry';

const lot = (over: Partial<PantryLot>): PantryLot => ({
  id: 'l1',
  product_id: null,
  name: 'Leite',
  category: 'laticinios',
  quantity: 1,
  unit: 'un',
  purchased_on: '2026-09-28',
  expires_on: null,
  ...over,
});

const COCA = 'Refrigerante sem Açúcar Coca-Cola Garrafa 1,5l';

describe('groupPantry', () => {
  it('a mesma Coca de três notas vira uma linha, com as compras da mais antiga para a mais nova', () => {
    const groups = groupPantry([
      lot({ id: 'c2', product_id: 'coca', name: COCA, category: 'bebidas', purchased_on: '2026-09-28', expires_on: '2027-03-27' }),
      lot({ id: 'c3', product_id: 'coca', name: COCA, category: 'bebidas', purchased_on: '2026-10-03', expires_on: '2027-04-01' }),
      lot({ id: 'c1', product_id: 'coca', name: COCA, category: 'bebidas', purchased_on: '2026-09-02', expires_on: '2027-03-01' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual(
      expect.objectContaining({
        productId: 'coca',
        name: COCA,
        expiresOn: '2027-03-01',
        totals: [{ quantity: 3, unit: 'un' }],
      }),
    );
    expect(groups[0].lots.map((l) => l.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('mostra o nome que a pessoa deu ao produto', () => {
    const [group] = groupPantry([lot({ product_id: 'coca', name: COCA })], new Map([['coca', 'Coca-Cola Zero 1,5L']]));
    expect(group.name).toBe('Coca-Cola Zero 1,5L');
  });

  it('sem produto, junta pelo nome (sem diferença de acento e maiúscula); produtos diferentes ficam separados', () => {
    const groups = groupPantry([
      lot({ id: 'a', name: 'Filtro de café' }),
      lot({ id: 'b', name: 'filtro de cafe' }),
      lot({ id: 'c', name: 'Filtro de café', product_id: 'melitta' }),
    ]);
    expect(groups.map((g) => g.lots.map((l) => l.id))).toEqual([['a', 'b'], ['c']]);
  });

  it('soma por unidade e ordena pela validade mais próxima, sem validade no fim', () => {
    const groups = groupPantry([
      lot({ id: 'arroz', name: 'Arroz', quantity: 1, unit: 'un' }),
      lot({ id: 't1', name: 'Tomate', quantity: 0.45, unit: 'kg', expires_on: '2026-10-10' }),
      lot({ id: 't2', name: 'Tomate', quantity: 2, unit: 'un', expires_on: '2026-10-08' }),
      lot({ id: 't3', name: 'Tomate', quantity: 0.3, unit: 'kg', expires_on: '2026-10-12' }),
      lot({ id: 'leite', name: 'Leite', expires_on: '2026-10-09' }),
    ]);
    expect(groups.map((g) => g.name)).toEqual(['Tomate', 'Leite', 'Arroz']);
    expect(groups[0].totals).toEqual([
      { quantity: 0.75, unit: 'kg' },
      { quantity: 2, unit: 'un' },
    ]);
  });
});

describe('takeOne', () => {
  it('em unidades, desconta uma da compra mais antiga', () => {
    expect(takeOne([lot({ id: 'velha', quantity: 3 }), lot({ id: 'nova', quantity: 1 })])).toEqual({
      id: 'velha',
      from: 3,
      remaining: 2,
    });
  });

  it('a última unidade da compra mais antiga encerra aquela compra', () => {
    expect(takeOne([lot({ id: 'velha', quantity: 1 }), lot({ id: 'nova' })])).toEqual({
      id: 'velha',
      from: 1,
      remaining: null,
    });
  });

  it('em peso, a compra mais antiga acaba inteira', () => {
    expect(takeOne([lot({ id: 'velha', quantity: 0.4, unit: 'kg' }), lot({ id: 'nova', unit: 'kg' })])).toEqual({
      id: 'velha',
      from: 0.4,
      remaining: null,
    });
  });

  it('uma compra só, sem sobra: não há "usei 1", é o "acabou"', () => {
    expect(takeOne([lot({ quantity: 1 })])).toBeNull();
    expect(takeOne([lot({ quantity: 0.5, unit: 'kg' })])).toBeNull();
    expect(takeOne([])).toBeNull();
  });
});
