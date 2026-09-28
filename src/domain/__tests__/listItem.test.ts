import { describe, expect, it } from '@jest/globals';

import { compareForShopping, priorityBadge, PRIORITIES } from '../listItem';

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
