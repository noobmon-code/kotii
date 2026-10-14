import { describe, expect, it } from '@jest/globals';

import { buildNukeContext, describeAction, historyForApi, type NukeSnapshot, parseActions } from '../nuke';
import { supplyLines } from '../supplies';

const snapshot: NukeSnapshot = {
  today: '2026-09-27',
  household: 'Casa da Ana',
  me: 'Ana',
  members: ['Ana', 'Beto'],
  doses: [{ time: '08:00', name: 'Vitamina D', person: 'Ana', taken: true }],
  refills: {
    inUse: 5,
    followed: 3,
    lines: ['Puran (Beto) — deve ter acabado', 'Losartana (Ana) — acaba em 3 dias, receita vence em 10 dias', 'Rivotril (Beto) — estoque sem atualizar desde 04/09'],
  },
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
  events: ['amanhã 16:00–17:00 Natação da Ana (Ana, Beto leva, Carla busca, levar: touca e toalha)', 'qua 30/09 Aniversário de Ana (faz 8 anos)'],
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
    expect(text).toContain(
      'Compromissos da família e aniversários (hoje e próximos 7 dias): amanhã 16:00–17:00 Natação da Ana (Ana, Beto leva, Carla busca, levar: touca e toalha); qua 30/09 Aniversário de Ana (faz 8 anos).',
    );
    expect(text).toContain('Documentos pedindo atenção: nada.');
    expect(text).not.toContain('Orçamento');
  });

  describe('estoque e receita dos remédios: só o que o app acompanha', () => {
    const line = (refills: NukeSnapshot['refills']) =>
      buildNukeContext({ ...snapshot, refills })
        .split('\n')
        .filter((text) => /estoque|receita/i.test(text));

    it('com remédios acompanhados: quantos são e o estado dos que estão acabando, como estimativa', () => {
      expect(line(snapshot.refills)).toEqual([
        'Remédios com estoque ou receita acompanhados pelo app (3 de 5 em uso; estimativa pelas doses previstas): Puran (Beto) — deve ter acabado; Losartana (Ana) — acaba em 3 dias, receita vence em 10 dias; Rivotril (Beto) — estoque sem atualizar desde 04/09.',
      ]);
      // Nenhum dos acompanhados pede atenção: diz isso só deles, sem falar pelos outros.
      expect(line({ inUse: 5, followed: 3, lines: [] })).toEqual([
        'Remédios com estoque ou receita acompanhados pelo app (3 de 5 em uso; estimativa pelas doses previstas): nenhum acabando nem com a receita vencendo.',
      ]);
    });

    it('remédios em uso, mas nenhum acompanhado: o app não sabe, e diz que não sabe', () => {
      expect(line({ inUse: 2, followed: 0, lines: [] })).toEqual([
        'Estoque e receita dos remédios: o app não acompanha o de nenhum remédio (ninguém informou quanto tem).',
      ]);
    });

    it('nenhum remédio em uso (ou retrato sem o campo): nenhuma linha, como antes do estoque', () => {
      expect(line({ inUse: 0, followed: 0, lines: [] })).toEqual([]);
      expect(line(undefined)).toEqual([]);
      // E nunca um "nada" que tranquilize sem base.
      expect(buildNukeContext({ ...snapshot, refills: { inUse: 2, followed: 0, lines: [] } })).not.toMatch(/Remédios[^\n]*: nada\./);
    });
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

  it('says when the gas, water and pet food should run out, only for a household that tracks them', () => {
    const supply = (name: string, kind: string, days: string[]) => ({ name, kind, typical_days: null, refills: days.map((refilled_on) => ({ refilled_on })) });
    const supplies = supplyLines([supply('Galão de água', 'agua', []), supply('Gás de cozinha', 'gas', ['2026-09-13'])], '2026-10-12');
    const text = buildNukeContext({ ...snapshot, today: '2026-10-12', supplies });
    expect(text).toContain('Gás, água e ração (previsão): Gás de cozinha — deve acabar em 28/10; Galão de água — sem previsão.');
    // Logo depois da despensa, uma linha só.
    const lines = text.split('\n');
    expect(lines.findIndex((l) => l.startsWith('Gás, água e ração'))).toBe(lines.findIndex((l) => l.startsWith('Despensa (tem em casa)')) + 1);
    // Retrato antigo (sem o campo) ou casa sem reposições: a linha não entra e o resto não muda.
    expect(buildNukeContext(snapshot)).not.toContain('Gás, água e ração');
    expect(buildNukeContext({ ...snapshot, supplies: [] })).toBe(buildNukeContext(snapshot));
    expect(buildNukeContext({ ...snapshot, supplies: undefined })).toBe(buildNukeContext(snapshot));
  });

  it('says when a bill came above its usual amount, with the numbers ready', () => {
    const text = buildNukeContext({
      ...snapshot,
      bills: [
        {
          name: 'Luz',
          amount: null,
          next_due_on: '2026-10-10',
          autopay: false,
          aboveUsual: 'boleto de R$ 310,00, R$ 85,00 (38%) acima do normal: média R$ 225,00 dos últimos 6 pagamentos',
        },
        { name: 'Internet', amount: 120, next_due_on: '2026-10-05', autopay: true },
      ],
    });
    expect(text).toContain(
      'Luz valor varia, boleto de R$ 310,00, R$ 85,00 (38%) acima do normal: média R$ 225,00 dos últimos 6 pagamentos — vence 10/10; Internet R$ 120,00 — vence 05/10 (débito automático).',
    );
  });

  it('caps long lists', () => {
    const many = { ...snapshot, pantry: Array.from({ length: 45 }, (_, i) => `Item ${i}`) };
    expect(buildNukeContext(many)).toContain('Item 39; e mais 5.');
    const busy = { ...snapshot, events: Array.from({ length: 30 }, (_, i) => `hoje Compromisso ${i}`) };
    expect(buildNukeContext(busy)).toContain('hoje Compromisso 24; e mais 5.');
    // Retrato de antes dos compromissos (ou sem nenhum): a linha diz que não há.
    expect(buildNukeContext({ ...snapshot, events: undefined })).toContain('Compromissos da família e aniversários (hoje e próximos 7 dias): nada.');
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
