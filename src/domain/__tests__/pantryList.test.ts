import { describe, expect, it } from '@jest/globals';

import { listsFor, newListKind } from '../pantryList';

const list = (id: string, kind: 'mercado' | 'farmacia' | 'outros', created_at: string, archived_at: string | null = null) => ({
  id,
  name: id,
  kind,
  created_at,
  archived_at,
});

describe('para qual lista vai o que acabou na despensa', () => {
  const lists = [
    list('Mercado', 'mercado', '2026-10-01T10:00:00Z'),
    list('Feira', 'mercado', '2026-10-15T10:00:00Z'),
    list('Farmácia', 'farmacia', '2026-10-17T10:00:00Z'),
    list('Churrasco', 'outros', '2026-10-16T10:00:00Z'),
    list('Velha', 'mercado', '2026-10-18T10:00:00Z', '2026-10-18T11:00:00Z'),
  ];

  it('a última lista criada em que o item cabe vem primeiro; a arquivada fica de fora', () => {
    expect(listsFor('mercearia', lists).map((l) => l.id)).toEqual(['Churrasco', 'Feira', 'Mercado']);
  });

  it('remédio só cabe na farmácia e nas listas de "outros"', () => {
    expect(listsFor('medicamentos', lists).map((l) => l.id)).toEqual(['Farmácia', 'Churrasco']);
  });

  it('higiene cabe em todas', () => {
    expect(listsFor('higiene', lists).map((l) => l.id)).toEqual(['Farmácia', 'Churrasco', 'Feira', 'Mercado']);
  });

  it('não mexe na ordem de quem passou as listas', () => {
    const copy = [...lists];
    listsFor('mercearia', copy);
    expect(copy).toEqual(lists);
  });

  it('sem lista aberta: farmácia para o que só cabe nela, mercado para o resto', () => {
    expect(newListKind('medicamentos')).toBe('farmacia');
    expect(newListKind('mercearia')).toBe('mercado');
    expect(newListKind('higiene')).toBe('mercado');
  });
});
