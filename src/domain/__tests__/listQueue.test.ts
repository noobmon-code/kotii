import { describe, expect, it } from '@jest/globals';

import {
  cartPurchases,
  itemsWithNew,
  planRemoval,
  queuedListItem,
  summaryWithItem,
  summaryWithout,
  type QueuedAction,
  signOutQuestion,
  waitingSummary,
  wasAttempted,
} from '../listQueue';

const action = (ref: string, kind: QueuedAction<string>['kind'], itemId: string | null, started = false): QueuedAction<string> => ({
  ref,
  kind,
  itemId,
  started,
});

describe('tirar um item com a fila esperando', () => {
  it('posto sem internet e ainda na fila: pôr e tirar se cancelam, com o que veio depois para o item', () => {
    const queue = [
      action('marca-arroz', 'toggle', 'arroz'),
      action('poe-cafe', 'add', 'cafe'),
      action('marca-cafe', 'toggle', 'cafe'),
      action('edita-cafe', 'edit', 'cafe'),
      action('limpa', 'clear', null),
    ];
    expect(planRemoval(queue, 'cafe')).toEqual({ drop: ['poe-cafe', 'marca-cafe', 'edita-cafe'], send: false });
  });

  it('o pôr já saiu para o servidor: o tirar vai para a fila, depois dele', () => {
    const queue = [action('poe-cafe', 'add', 'cafe', true), action('marca-cafe', 'toggle', 'cafe')];
    expect(planRemoval(queue, 'cafe')).toEqual({ drop: [], send: true });
  });

  it('item que já existia: o tirar vai para a fila, e as marcações dele continuam na ordem', () => {
    const queue = [action('marca-arroz', 'toggle', 'arroz')];
    expect(planRemoval(queue, 'arroz')).toEqual({ drop: [], send: true });
    expect(planRemoval([], 'arroz')).toEqual({ drop: [], send: true });
  });

  it('o pôr que já tentou uma vez e parou sem internet conta como saído: o servidor pode ter gravado', () => {
    // A resposta da primeira tentativa se perdeu e a conexão caiu: o pôr está parado de novo, mas já foi.
    const add = wasAttempted({ isPaused: true, failureCount: 1 });
    expect(add).toBe(true);
    expect(planRemoval([action('poe-cafe', 'add', 'cafe', add)], 'cafe')).toEqual({ drop: [], send: true });
  });

  it('saiu: enviando agora, ou já tentou; parado sem ter tentado, ainda não', () => {
    expect(wasAttempted({ isPaused: false, failureCount: 0 })).toBe(true);
    expect(wasAttempted({ isPaused: false, failureCount: 2 })).toBe(true);
    expect(wasAttempted({ isPaused: true, failureCount: 0 })).toBe(false);
  });

  it('o pôr de outro item não conta', () => {
    expect(planRemoval([action('poe-leite', 'add', 'leite')], 'cafe')).toEqual({ drop: [], send: true });
  });
});

const lists = () => [
  { id: 'l1', name: 'Mercado', pending: 1, total: 2, items: [
    { name: 'Arroz', product_id: 'p1', checked_at: null },
    { name: 'Leite', product_id: null, checked_at: '2026-10-20T10:00:00Z' },
  ] },
  { id: 'l2', name: 'Farmácia', pending: 0, total: 0, items: [] },
];

describe('o resumo das listas enquanto a fila espera', () => {
  it('item posto conta como pendente, só na lista dele', () => {
    const [mercado, farmacia] = summaryWithItem(lists(), 'l1', { name: 'Café', product_id: null, checked_at: null });
    expect(mercado).toMatchObject({ name: 'Mercado', pending: 2, total: 3 });
    expect(mercado.items.map((i) => i.name)).toEqual(['Arroz', 'Leite', 'Café']);
    expect(farmacia).toEqual(lists()[1]);
  });

  it('item tirado sai das contas', () => {
    const [mercado] = summaryWithout(lists(), 'l1', [{ name: 'Arroz', product_id: 'p1', checked_at: null }]);
    expect(mercado).toMatchObject({ pending: 0, total: 1 });
    expect(mercado.items.map((i) => i.name)).toEqual(['Leite']);
  });

  it('o limpar tira o que estava no carrinho; o pendente continua', () => {
    const [mercado] = summaryWithout(lists(), 'l1', [{ name: 'Leite', product_id: null, checked_at: '2026-10-20T10:05:00Z' }]);
    expect(mercado).toMatchObject({ pending: 1, total: 1 });
    expect(mercado.items.map((i) => i.name)).toEqual(['Arroz']);
  });

  it('com dois itens de mesmo nome, sai o que está no mesmo estado', () => {
    const start = [{ id: 'l1', pending: 1, total: 2, items: [
      { name: 'Pão', product_id: null, checked_at: null },
      { name: 'Pão', product_id: null, checked_at: '2026-10-20T10:00:00Z' },
    ] }];
    const [after] = summaryWithout(start, 'l1', [{ name: 'Pão', product_id: null, checked_at: '2026-10-20T10:00:00Z' }]);
    expect(after.items).toEqual([{ name: 'Pão', product_id: null, checked_at: null }]);
    expect(after).toMatchObject({ pending: 1, total: 1 });
  });

  it('as contas nunca ficam negativas (resumo velho do aparelho)', () => {
    const [after] = summaryWithout([{ id: 'l1', pending: 0, total: 0, items: [] }], 'l1', [{ name: 'X', product_id: null, checked_at: null }]);
    expect(after).toMatchObject({ pending: 0, total: 0, items: [] });
  });
});

describe('o item posto sem internet', () => {
  const novo = queuedListItem(
    { id: 'i9', listId: 'l1', token: 't9', name: 'Café', category: 'mercearia', productId: null, quantity: 2, unit: 'un' },
    '2026-10-20T11:00:00Z',
  );

  it('aparece como um item comum, para comprar, com o selo e o id gerados no aparelho', () => {
    expect(novo).toEqual({
      id: 'i9',
      list_id: 'l1',
      product_id: null,
      name: 'Café',
      category: 'mercearia',
      quantity: 2,
      unit: 'un',
      notes: null,
      priority: 'normal',
      photo_path: null,
      checked_at: null,
      checked_by: null,
      toggle_token: 't9',
      created_at: '2026-10-20T11:00:00Z',
    });
  });

  it('entra no fim da lista uma vez só', () => {
    const once = itemsWithNew([], novo);
    expect(once).toEqual([novo]);
    expect(itemsWithNew(once, novo)).toEqual([novo]);
  });
});

describe('o que sai do carrinho vai para o histórico', () => {
  it('com a hora em que foi para o carrinho; o que não estava nele fica de fora', () => {
    const base = queuedListItem(
      { id: 'a', listId: 'l1', token: 't', name: 'Arroz', category: 'mercearia', productId: 'p1', quantity: 2, unit: 'kg' },
      '2026-10-20T09:00:00Z',
    );
    expect(cartPurchases([{ ...base, checked_at: '2026-10-20T10:00:00Z' }, { ...base, id: 'b', name: 'Feijão' }])).toEqual([
      { name: 'Arroz', category: 'mercearia', productId: 'p1', quantity: 2, unit: 'kg', at: '2026-10-20T10:00:00Z', source: 'list' },
    ]);
  });
});

describe('o aviso do que espera a conexão', () => {
  const none = { adds: 0, marks: 0, edits: 0, removes: 0, clears: 0, photos: 0 };

  it('conta o limpar, os itens postos e os tirados junto com o resto', () => {
    expect(waitingSummary({ ...none, adds: 2, marks: 1, clears: 1 })).toBe('2 itens novos, 1 marcação e 1 limpeza do carrinho');
    expect(waitingSummary({ adds: 1, marks: 3, edits: 1, removes: 2, clears: 2, photos: 1 })).toBe(
      '1 item novo, 3 marcações, 1 item editado, 2 itens tirados, 2 limpezas do carrinho e 1 foto',
    );
  });

  it('uma coisa só, ou nada', () => {
    expect(waitingSummary({ ...none, removes: 1 })).toBe('1 item tirado');
    expect(waitingSummary(none)).toBe('');
  });
});

describe('sair da conta com algo esperando a conexão', () => {
  const none = { adds: 0, marks: 0, edits: 0, removes: 0, clears: 0, photos: 0 };

  it('com a fila vazia, a pergunta de sempre', () => {
    expect(signOutQuestion(none)).toBe('Deseja sair desta conta neste aparelho?');
  });

  it('diz o que se perde, sem impedir a saída', () => {
    expect(signOutQuestion({ ...none, adds: 2, marks: 1 })).toBe(
      '2 itens novos e 1 marcação ainda esperam a conexão e se perdem se você sair agora. Deseja sair mesmo assim?',
    );
    expect(signOutQuestion({ ...none, photos: 1 })).toBe('1 foto ainda espera a conexão e se perde se você sair agora. Deseja sair mesmo assim?');
  });
});
