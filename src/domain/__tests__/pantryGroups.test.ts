import { describe, expect, it } from '@jest/globals';

import { describeLots, groupPantry, takeOne, type PantryLot } from '../pantry';

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

describe('o congelador na despensa', () => {
  const frango = (over: Partial<PantryLot>) => lot({ product_id: 'frango', name: 'Frango', category: 'carnes', ...over });

  it('o que está no congelador é outro grupo; o descongelado volta para o do fresco', () => {
    const groups = groupPantry([
      frango({ id: 'fresco', purchased_on: '2026-11-15', expires_on: '2026-11-18', expiry_source: 'categoria' }),
      frango({ id: 'cong1', purchased_on: '2026-11-01', expires_on: '2027-01-30', expiry_source: 'congelado', frozen_on: '2026-11-01', thawed_on: null }),
      frango({ id: 'cong2', purchased_on: '2026-11-05', expires_on: '2027-02-03', expiry_source: 'congelado', frozen_on: '2026-11-05', thawed_on: null }),
      frango({ id: 'desc', purchased_on: '2026-11-01', expires_on: '2026-11-23', expiry_source: 'descongelado', frozen_on: '2026-11-01', thawed_on: '2026-11-20' }),
    ]);
    expect(groups.map((g) => [g.key, g.lots.map((l) => l.id), g.frozen, g.frozenOn])).toEqual([
      ['produto:frango', ['desc', 'fresco'], false, null],
      ['produto:frango:congelado', ['cong1', 'cong2'], true, '2026-11-01'],
    ]);
  });

  it('a validade é estimada quando todas as compras com ela são estimadas; a certa vence o empate', () => {
    const [estimated] = groupPantry([
      frango({ id: 'a', expires_on: '2026-11-18', expiry_source: 'categoria' }),
      frango({ id: 'b', expires_on: '2026-11-25', expiry_source: 'manual' }),
    ]);
    expect(estimated.expiryEstimated).toBe(true);
    const [tie] = groupPantry([
      frango({ id: 'a', expires_on: '2026-11-18', expiry_source: 'categoria' }),
      frango({ id: 'b', expires_on: '2026-11-18', expiry_source: 'produto' }),
    ]);
    expect(tie.expiryEstimated).toBe(false);
    // Sem origem (as compras antigas, e as cópias de antes desta versão): a cor de sempre.
    expect(groupPantry([frango({ expires_on: '2026-11-18' })])[0].expiryEstimated).toBe(false);
    expect(groupPantry([frango({ expires_on: null, expiry_source: null })])[0].expiryEstimated).toBe(false);
  });

  it('thawedOn: a compra que decide a validade saiu do congelador', () => {
    const [group] = groupPantry([
      frango({ id: 'a', expires_on: '2026-11-23', expiry_source: 'descongelado', frozen_on: '2026-11-01', thawed_on: '2026-11-20' }),
      frango({ id: 'b', expires_on: '2026-11-25', expiry_source: 'categoria' }),
    ]);
    expect(group.thawedOn).toBe('2026-11-20');
    const [other] = groupPantry([
      frango({ id: 'a', expires_on: '2026-11-28', expiry_source: 'descongelado', frozen_on: '2026-11-01', thawed_on: '2026-11-20' }),
      frango({ id: 'b', expires_on: '2026-11-25', expiry_source: 'categoria' }),
    ]);
    expect(other.thawedOn).toBeNull();
  });

  it('describeLots marca a compra descongelada, com o ano só quando é outro', () => {
    expect(
      describeLots(
        {
          lots: [
            frango({ purchased_on: '2026-11-12', thawed_on: '2026-11-20', frozen_on: '2026-11-12' }),
            frango({ purchased_on: '2026-11-21' }),
          ],
        },
        '2026-11-22',
      ),
    ).toBe('Compras: 12 nov (1 un, descongelado em 20 nov) e 21 nov (1 un).');
    expect(describeLots({ lots: [frango({ purchased_on: '2025-12-30' }), frango({ purchased_on: '2026-01-02' }), frango({ purchased_on: '2026-01-03' })] }, '2026-01-05')).toBe(
      'Compras: 30 dez 2025 (1 un), 2 jan (1 un) e 3 jan (1 un).',
    );
  });
});
