import { describe, expect, it } from '@jest/globals';

import { formatShortDate } from '../dates';
import {
  describePantryLots,
  groupPantry,
  pantryEditActions,
  pantryGroupOf,
  productNameMap,
  takeOne,
  type PantryLot,
} from '../pantry';

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

describe('pantryGroupOf (a compra da tela Hoje abre o menu do produto dela)', () => {
  const names = productNameMap([{ id: 'leite', name: 'Leite Italac' }]);
  const expired = lot({ id: 'l-old', product_id: 'leite', name: 'LEITE UHT ITALAC', purchased_on: '2026-10-01', expires_on: '2026-10-20' });
  const fresh = lot({ id: 'l-new', product_id: 'leite', name: 'LEITE UHT ITALAC', purchased_on: '2026-11-04', expires_on: '2027-02-01' });
  const rice = lot({ id: 'a1', product_id: 'arroz', name: 'Arroz', category: 'graos', purchased_on: '2026-10-10' });

  it('a compra vencida dá o produto inteiro, com as duas compras, o nome do catálogo e o produto', () => {
    const group = pantryGroupOf([fresh, rice, expired], expired, names);
    expect(group.lots.map((l) => l.id)).toEqual(['l-old', 'l-new']);
    expect(group.name).toBe('Leite Italac');
    expect(group.productId).toBe('leite');
  });

  it('sem produto, junta pelo nome normalizado, como groupPantry', () => {
    const a = lot({ id: 'n1', name: 'leite italac', purchased_on: '2026-10-01' });
    const b = lot({ id: 'n2', name: 'Leite Itálac', purchased_on: '2026-10-05' });
    const group = pantryGroupOf([a, b], a);
    expect(group).toEqual(groupPantry([a, b])[0]);
    expect(group.lots.map((l) => l.id)).toEqual(['n1', 'n2']);
  });

  it('para cada compra, o mesmo grupo que groupPantry dá a ela', () => {
    const items = [
      expired,
      fresh,
      rice,
      lot({ id: 'n1', name: 'Feijão', category: 'graos', purchased_on: '2026-09-01' }),
      lot({ id: 'n2', name: 'feijao', category: 'graos', purchased_on: '2026-09-15', expires_on: '2026-11-06' }),
      lot({ id: 'c1', product_id: 'coca', name: COCA, category: 'bebidas' }),
    ];
    const groups = groupPantry(items, names);
    for (const item of items) {
      expect(pantryGroupOf(items, item, names)).toEqual(groups.find((g) => g.lots.some((l) => l.id === item.id)));
    }
  });

  it('a compra que não está na lista vira um grupo só dela (com o nome do catálogo)', () => {
    const group = pantryGroupOf([rice], expired, names);
    expect(group.lots).toEqual([expired]);
    expect(group.name).toBe('Leite Italac');
  });

  it('productNameMap', () => {
    expect(productNameMap().size).toBe(0);
    expect(productNameMap([{ id: 'a', name: 'Arroz' }])).toEqual(new Map([['a', 'Arroz']]));
  });
});

describe('o menu do produto: as compras e as ações de editar', () => {
  const TODAY = '2026-11-05';
  // Três compras do mesmo iogurte, da mais antiga para a mais nova (como groupPantry as deixa).
  const old = lot({ id: 'a', name: 'Iogurte', purchased_on: '2026-10-20', expires_on: '2026-11-03' });
  const soon = lot({ id: 'b', name: 'Iogurte', purchased_on: '2026-10-27', expires_on: '2026-11-06' });
  const fresh = lot({ id: 'c', name: 'Iogurte', purchased_on: '2026-11-02', expires_on: '2026-11-30', quantity: 2 });
  const day = (l: PantryLot) => formatShortDate(l.purchased_on);

  it('na Despensa (a linha é o produto): as datas de compra, da mais nova para a mais antiga', () => {
    expect(describePantryLots([old, soon, fresh])).toBe(`Compras: ${day(old)} (1 un), ${day(soon)} (1 un) e ${day(fresh)} (2 un).`);
    expect(pantryEditActions([old, soon, fresh]).map((a) => [a.lot.id, a.label])).toEqual([
      ['c', `Editar a compra de ${day(fresh)} (2 un)`],
      ['b', `Editar a compra de ${day(soon)} (1 un)`],
      ['a', `Editar a compra de ${day(old)} (1 un)`],
    ]);
  });

  it('na tela Hoje (a linha é uma compra, com a validade): a tocada vem primeiro, como "esta compra", pela validade', () => {
    const focus = { lotId: 'b', today: TODAY };
    expect(describePantryLots([old, soon, fresh], focus)).toBe(
      `Compras: ${day(old)} (1 un), ${day(soon)} (1 un, vence amanhã) e ${day(fresh)} (2 un).`,
    );
    expect(pantryEditActions([old, soon, fresh], focus).map((a) => [a.lot.id, a.label])).toEqual([
      ['b', 'Editar esta compra (vence amanhã)'],
      ['c', `Editar a compra de ${day(fresh)} (2 un)`],
      ['a', `Editar a compra de ${day(old)} (1 un)`],
    ]);
    expect(pantryEditActions([old, soon, fresh], { lotId: 'a', today: TODAY })[0].label).toBe('Editar esta compra (venceu há 2 dias)');
  });

  it('duas compras iguais (mesmo dia e quantidade) ganham um número; a tocada não precisa dele', () => {
    const twin = lot({ id: 'd', name: 'Iogurte', purchased_on: soon.purchased_on, expires_on: '2026-11-07' });
    expect(pantryEditActions([soon, twin]).map((a) => a.label)).toEqual([
      `Editar a compra de ${day(soon)} (1 un) · 1ª`,
      `Editar a compra de ${day(soon)} (1 un) · 2ª`,
    ]);
    expect(pantryEditActions([soon, twin], { lotId: 'b', today: TODAY }).map((a) => a.label)).toEqual([
      'Editar esta compra (vence amanhã)',
      `Editar a compra de ${day(soon)} (1 un)`,
    ]);
  });

  it('uma compra só: "Editar validade e quantidade", com ou sem a compra tocada', () => {
    expect(pantryEditActions([soon]).map((a) => a.label)).toEqual(['Editar validade e quantidade']);
    expect(pantryEditActions([soon], { lotId: 'b', today: TODAY }).map((a) => a.label)).toEqual(['Editar validade e quantidade']);
  });

  it('uma compra tocada que não está entre as do produto não muda nada', () => {
    const focus = { lotId: 'x', today: TODAY };
    expect(pantryEditActions([old, fresh], focus)).toEqual(pantryEditActions([old, fresh]));
    expect(describePantryLots([old, fresh], focus)).toBe(describePantryLots([old, fresh]));
  });
});
