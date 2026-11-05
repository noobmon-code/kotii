import { describe, expect, it } from '@jest/globals';

import {
  LISTS_SHORTCUT_LABEL,
  listShortcut,
  listShortcutCaption,
  OPENED_LISTS_MAX,
  parseOpenedLists,
  serializeOpenedLists,
  shortcutList,
  withOpenedList,
  type ShortcutCandidate,
} from '../listShortcut';

// O atalho das listas na tela Hoje: abre a lista aberta que este aparelho abriu por último (senão a de mercado mais
// nova, senão a mais nova) e diz quanto falta comprar nela.

const list = (over: Partial<ShortcutCandidate> & { id: string }): ShortcutCandidate => ({
  name: over.id,
  kind: 'mercado',
  created_at: '2026-10-01T10:00:00Z',
  archived_at: null,
  pending: 0,
  ...over,
});

const mercado = list({ id: 'm1', name: 'Mercado', kind: 'mercado', created_at: '2026-10-01T10:00:00Z', pending: 12 });
const farmacia = list({ id: 'f1', name: 'Farmácia', kind: 'farmacia', created_at: '2026-10-20T10:00:00Z', pending: 1 });

describe('shortcutList', () => {
  it('com uma lista aberta, é ela, lembrada ou não', () => {
    expect(shortcutList([mercado], new Map())).toBe(mercado);
    expect(shortcutList([mercado], new Map([['outra', 5]]))).toBe(mercado);
  });

  it('a lista aberta que o aparelho abriu por último ganha, mesmo mais velha e de outro tipo', () => {
    expect(shortcutList([mercado, farmacia], new Map([['f1', 5]]))).toBe(farmacia);
    expect(shortcutList([mercado, farmacia], new Map([['f1', 5], ['m1', 9]]))).toBe(mercado);
  });

  it('ids lembrados de fora (outra casa, arquivada) não contam, e a arquivada nunca é escolhida', () => {
    const archived = list({ id: 'a1', created_at: '2026-10-30T10:00:00Z', archived_at: '2026-10-31T10:00:00Z' });
    expect(shortcutList([mercado, archived], new Map([['a1', 50], ['x', 99]]))).toBe(mercado);
    expect(shortcutList([archived], new Map([['a1', 50]]))).toBeNull();
  });

  it('carimbos iguais: a criada por último, depois o id menor', () => {
    const older = list({ id: 'b', created_at: '2026-10-01T10:00:00Z' });
    const newer = list({ id: 'c', created_at: '2026-10-05T10:00:00Z' });
    const twin = list({ id: 'a', created_at: '2026-10-05T10:00:00Z' });
    expect(shortcutList([older, newer], new Map([['b', 3], ['c', 3]]))).toBe(newer);
    expect(shortcutList([newer, twin], new Map([['c', 3], ['a', 3]]))).toBe(twin);
  });

  it('nenhuma lembrada: a de mercado mais nova, mesmo com outra mais nova; sem mercado, a mais nova', () => {
    const outros = list({ id: 'o1', kind: 'outros', created_at: '2026-10-25T10:00:00Z' });
    const oldMercado = list({ id: 'm0', created_at: '2026-09-01T10:00:00Z' });
    expect(shortcutList([oldMercado, farmacia, outros, mercado], new Map())).toBe(mercado);
    expect(shortcutList([farmacia, outros], new Map())).toBe(outros);
    expect(shortcutList([], new Map())).toBeNull();
  });
});

describe('listShortcut', () => {
  it('sem as listas, sem a memória do aparelho ou sem lista aberta: o atalho de sempre', () => {
    const fallback = { listId: null, label: LISTS_SHORTCUT_LABEL };
    expect(listShortcut(undefined, new Map())).toEqual(fallback);
    expect(listShortcut([mercado], null)).toEqual(fallback);
    expect(listShortcut([], new Map())).toEqual(fallback);
    expect(LISTS_SHORTCUT_LABEL).toBe('Listas de compras');
  });

  it('o nome da lista, quanto falta comprar e o que o leitor de tela diz', () => {
    expect(listShortcut([mercado], new Map())).toEqual({
      listId: 'm1',
      label: 'Mercado',
      caption: '12 a comprar',
      accessibilityLabel: 'Abrir a lista Mercado, 12 itens a comprar',
    });
    expect(listShortcut([{ ...mercado, pending: 1 }], new Map())).toMatchObject({
      caption: '1 a comprar',
      accessibilityLabel: 'Abrir a lista Mercado, 1 item a comprar',
    });
    expect(listShortcut([{ ...mercado, pending: 0 }], new Map())).toMatchObject({
      caption: 'Nada a comprar',
      accessibilityLabel: 'Abrir a lista Mercado, nada a comprar',
    });
  });

  it('o nome sem espaços nas pontas, e "Lista sem nome" para o nome em branco', () => {
    expect(listShortcut([{ ...mercado, name: '  Feira  ' }], new Map()).label).toBe('Feira');
    const blank = listShortcut([{ ...mercado, name: '   ' }], new Map());
    expect(blank.label).toBe('Lista sem nome');
    expect(blank.accessibilityLabel).toBe('Abrir a lista Lista sem nome, 12 itens a comprar');
  });

  it('a linha de baixo', () => {
    expect(listShortcutCaption(0)).toBe('Nada a comprar');
    expect(listShortcutCaption(-1)).toBe('Nada a comprar');
    expect(listShortcutCaption(Number.NaN)).toBe('Nada a comprar');
    expect(listShortcutCaption(1)).toBe('1 a comprar');
    expect(listShortcutCaption(12)).toBe('12 a comprar');
  });
});

describe('o que o aparelho guarda', () => {
  it('qualquer coisa que não seja um objeto de carimbos é "nenhuma"', () => {
    for (const raw of [null, '', '{', '[]', 'null', '3', '"x"']) expect(parseOpenedLists(raw).size).toBe(0);
  });

  it('descarta carimbos que não são números finitos e ids vazios', () => {
    const parsed = parseOpenedLists(JSON.stringify({ a: 5, b: '7', c: null, d: 1e400, '': 3, e: { x: 1 }, f: 9 }));
    expect([...parsed.entries()].sort()).toEqual([
      ['a', 5],
      ['f', 9],
    ]);
  });

  it('guarda só os mais novos', () => {
    const raw = JSON.stringify(Object.fromEntries(Array.from({ length: OPENED_LISTS_MAX + 5 }, (_, i) => [`l${i}`, i])));
    const parsed = parseOpenedLists(raw);
    expect(parsed.size).toBe(OPENED_LISTS_MAX);
    expect(parsed.has('l0')).toBe(false);
    expect(parsed.has(`l${OPENED_LISTS_MAX + 4}`)).toBe(true);
  });

  it('ida e volta', () => {
    const m = new Map([
      ['a', 5],
      ['b', 9],
    ]);
    expect(parseOpenedLists(serializeOpenedLists(m))).toEqual(m);
  });
});

describe('withOpenedList', () => {
  it('a lista aberta agora passa a ser a mais nova', () => {
    const next = withOpenedList(new Map([['a', 5]]), 'b', 10);
    expect(next.get('b')).toBe(10);
    expect(shortcutList([list({ id: 'a' }), list({ id: 'b' })], next)?.id).toBe('b');
  });

  it('com o relógio voltando, ainda é a mais nova', () => {
    const next = withOpenedList(new Map([['a', 1000]]), 'b', 10);
    expect(next.get('b')).toBe(1001);
    expect(shortcutList([list({ id: 'a' }), list({ id: 'b' })], next)?.id).toBe('b');
  });

  it('a que já é a mais nova não muda nada (o mesmo mapa: nada a gravar)', () => {
    const opened = new Map([
      ['a', 5],
      ['b', 9],
    ]);
    expect(withOpenedList(opened, 'b', 100)).toBe(opened);
    // Empatada com outra, ela sobe e deixa de empatar.
    const tied = new Map([
      ['a', 9],
      ['b', 9],
    ]);
    const next = withOpenedList(tied, 'b', 1);
    expect(next).not.toBe(tied);
    expect(shortcutList([list({ id: 'a' }), list({ id: 'b' })], next)?.id).toBe('b');
  });

  it('guarda só as mais novas', () => {
    let opened: ReadonlyMap<string, number> = new Map();
    for (let i = 0; i < OPENED_LISTS_MAX + 3; i++) opened = withOpenedList(opened, `l${i}`, i);
    expect(opened.size).toBe(OPENED_LISTS_MAX);
    expect(opened.has('l0')).toBe(false);
    expect(opened.has(`l${OPENED_LISTS_MAX + 2}`)).toBe(true);
  });
});
