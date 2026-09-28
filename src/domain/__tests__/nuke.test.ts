import { describe, expect, it } from '@jest/globals';

import { buildNukeContext, describeAction, historyForApi, type NukeSnapshot, parseActions } from '../nuke';

const snapshot: NukeSnapshot = {
  today: '2026-09-27',
  household: 'Casa da Ana',
  me: 'Ana',
  members: ['Ana', 'Beto'],
  doses: [{ time: '08:00', name: 'Vitamina D', person: 'Ana', taken: true }],
  chores: [
    { title: 'Limpar filtro', due_on: '2026-09-25', assignee: 'Beto' },
    { title: 'Regar plantas', due_on: '2026-09-29', assignee: null },
  ],
  expiring: [{ name: 'Leite', expires_on: '2026-09-28' }],
  pantry: ['Arroz', 'Feijão', 'Leite'],
  shopping: [{ list: 'Mercado', items: [{ name: 'Café', quantity: 2, unit: 'un' }] }],
  bills: [{ name: 'Luz', amount: null, next_due_on: '2026-09-26', autopay: false }],
  spending: {
    month: 'setembro',
    total: 3646.9,
    byCategory: [{ category: 'moradia', amount: 2500 }],
    previousMonth: 'Agosto',
    previousTotal: 3922.4,
  },
  appointments: [{ starts_at: '2026-10-02T14:00:00', title: 'Pediatra', person: 'Lucas' }],
  documents: [],
  warranties: [],
};

describe('nuke context', () => {
  it('writes one short line per area, with overdue items called out', () => {
    const text = buildNukeContext(snapshot);
    expect(text).toContain('Moradores: Ana (quem está falando), Beto.');
    expect(text).toContain('Limpar filtro — atrasada desde 25/09 (Beto)');
    expect(text).toContain('Regar plantas — vence 29/09');
    expect(text).toContain('Lista "Mercado" (falta comprar): Café 2 un.');
    expect(text).toContain('Luz valor varia — venceu 26/09');
    expect(text).toContain('Gastos de setembro até hoje: R$ 3.646,90 (Moradia R$ 2.500,00). Agosto inteiro: R$ 3.922,40.');
    expect(text).toContain('02/10 14:00 Pediatra (Lucas)');
    expect(text).toContain('Documentos pedindo atenção: nada.');
    expect(text).not.toContain('Orçamento');
  });

  it('includes the month budget when there is one', () => {
    const text = buildNukeContext({
      ...snapshot,
      spending: {
        ...snapshot.spending!,
        budgets: [
          { category: 'moradia', limit: 2400, spent: 2500 },
          { category: 'lazer', limit: 300, spent: 0 },
        ],
      },
    });
    expect(text).toContain('Orçamento de setembro: Moradia R$ 2.500,00 de R$ 2.400,00 (passou); Lazer R$ 0,00 de R$ 300,00.');
  });

  it('caps long lists', () => {
    const many = { ...snapshot, pantry: Array.from({ length: 45 }, (_, i) => `Item ${i}`) };
    expect(buildNukeContext(many)).toContain('Item 39; e mais 5.');
  });
});

describe('nuke history and actions', () => {
  it('sends only the recent successful turns', () => {
    const messages = [
      { id: '1', role: 'user' as const, text: 'Oi' },
      { id: '2', role: 'assistant' as const, text: 'Falha', error: true },
      { id: '3', role: 'user' as const, text: 'De novo' },
    ];
    expect(historyForApi(messages)).toEqual([
      { role: 'user', text: 'Oi' },
      { role: 'user', text: 'De novo' },
    ]);
    expect(historyForApi(messages, 1)).toEqual([{ role: 'user', text: 'De novo' }]);
  });

  it('keeps only well-formed actions from the server', () => {
    const actions = parseActions([
      { type: 'add_to_list', label: 'Adicionar', items: [{ name: 'Café', quantity: 2, unit: 'un', category: 'cafe_cha' }, { name: '', quantity: 1, unit: 'un', category: 'outros' }] },
      { type: 'create_chore', label: 'Criar', title: 'Trocar filtro', due_on: '2026-10-01', recurrence: 'monthly' },
      { type: 'add_expense', label: 'Registrar', description: 'Feira', amount: -3, category: 'mercado', spent_on: '2026-09-27' },
      { type: 'open_screen', label: 'Ver contas', screen: 'contas' },
      { type: 'open_screen', label: 'Ver', screen: 'admin' },
      'lixo',
    ]);
    expect(actions.map((a) => a.type)).toEqual(['add_to_list', 'create_chore', 'open_screen']);
    expect(actions[0].type === 'add_to_list' && actions[0].items).toHaveLength(1);
    expect(describeAction(actions[0])).toBe('Café (2 un)');
    expect(describeAction(actions[1])).toBe('Trocar filtro · 01/10/2026');
    expect(parseActions(null)).toEqual([]);
  });
});
