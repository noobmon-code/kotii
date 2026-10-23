import { describe, expect, it } from '@jest/globals';

import { compareForShopping, priorityBadge, PRIORITIES, repeatedQuantity } from '../listItem';

describe('compareForShopping', () => {
  it('urgentes no topo, e cada grupo na ordem dos corredores', () => {
    const items = [
      { name: 'Detergente', category: 'limpeza', priority: 'normal' },
      { name: 'Remédio', category: 'medicamentos', priority: 'urgente' },
      { name: 'Banana', category: 'hortifruti', priority: 'se_der' },
      { name: 'Leite', category: 'laticinios', priority: 'urgente' },
      { name: 'Arroz', category: 'graos', priority: null },
    ];
    expect([...items].sort(compareForShopping).map((i) => i.name)).toEqual(['Leite', 'Remédio', 'Banana', 'Arroz', 'Detergente']);
  });
});

describe('priorityBadge', () => {
  it('só as prioridades diferentes de normal têm selo', () => {
    expect(priorityBadge('normal')).toBeNull();
    expect(priorityBadge(undefined)).toBeNull();
    expect(priorityBadge('urgente')).toEqual({ label: 'Urgente', tone: 'danger' });
    expect(priorityBadge('promocao')?.label).toBe('Promoção');
    expect(priorityBadge('se_der')?.label).toBe('Se der');
  });

  it('as quatro opções batem com o banco', () => {
    expect(PRIORITIES.map((p) => p.key)).toEqual(['normal', 'urgente', 'promocao', 'se_der']);
  });
});

describe('repeatedQuantity', () => {
  it('na mesma unidade, a quantidade para comprar vira a soma', () => {
    expect(repeatedQuantity({ quantity: 2, unit: 'kg' }, { quantity: 1, unit: 'kg' })).toEqual({ kind: 'sum', quantity: 3 });
    expect(repeatedQuantity({ quantity: 1, unit: 'un' }, { quantity: 1, unit: 'un' })).toEqual({ kind: 'sum', quantity: 2 });
    // Decimais sem a sobra do ponto flutuante (0,1 + 0,2), com até 3 casas, como no banco.
    expect(repeatedQuantity({ quantity: 0.1, unit: 'l' }, { quantity: 0.2, unit: 'l' })).toEqual({ kind: 'sum', quantity: 0.3 });
    expect(repeatedQuantity({ quantity: 0.3335, unit: 'kg' }, { quantity: 0.0001, unit: 'kg' })).toEqual({ kind: 'sum', quantity: 0.334 });
  });

  it('o banco pode entregar a quantidade como texto', () => {
    expect(repeatedQuantity({ quantity: '1.5', unit: 'kg' }, { quantity: 0.5, unit: 'kg' })).toEqual({ kind: 'sum', quantity: 2 });
  });

  it('em outra unidade não há conta: a pessoa escolhe', () => {
    expect(repeatedQuantity({ quantity: 2, unit: 'un' }, { quantity: 1, unit: 'kg' })).toEqual({ kind: 'other_unit' });
    // Nem gramas com quilos: "com a mesma unidade" é a mesma unidade.
    expect(repeatedQuantity({ quantity: 1, unit: 'kg' }, { quantity: 500, unit: 'g' })).toEqual({ kind: 'other_unit' });
  });
});
