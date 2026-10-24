import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { RENAME_LIST_OFFLINE } from '@/data/market';
import type { MarketTrip } from '@/domain/marketTrips';
import { RenameListModal } from '@/features/RenameListModal';
import { ShoppingListsPanel } from '@/features/ShoppingListsPanel';
import type { ShoppingList } from '@/lib/types';
import { notify } from '@/ui/dialogs';
import { Button, TextField } from '@/ui/primitives';

// Renomear a lista e reabrir as arquivadas, com os hooks de verdade e o banco de mentira: o que é gravado e o
// que as outras telas (a lista, as listas, a faixa da ida) passam a mostrar.

type Row = ShoppingList;
// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockDb = {
  lists: [] as Row[],
  updates: [] as { values: Record<string, unknown>; id: string }[],
  /** O que a busca das arquivadas pediu: a ordem e o limite. */
  archivedReads: [] as { order: unknown[]; limit: number | null }[],
};
jest.mock('@/lib/supabase', () => {
  const table = (name: string) => {
    let update: Record<string, unknown> | null = null;
    let id = '';
    let archived: 'open' | 'archived' | null = null;
    let limit = Infinity;
    let order: unknown[] = [];
    const run = async () => {
      if (name !== 'shopping_lists') return { data: [], error: null };
      if (update) {
        mockDb.updates.push({ values: update, id });
        for (const list of mockDb.lists) if (list.id === id) Object.assign(list, update);
        return { data: null, error: null };
      }
      if (archived === 'archived') mockDb.archivedReads.push({ order, limit: Number.isFinite(limit) ? limit : null });
      const rows = mockDb.lists
        .filter((l) => (archived === 'open' ? !l.archived_at : archived === 'archived' ? Boolean(l.archived_at) : true))
        .sort((a, b) =>
          archived === 'archived' ? (b.archived_at ?? '').localeCompare(a.archived_at ?? '') : b.created_at.localeCompare(a.created_at),
        )
        .slice(0, limit)
        .map((l) => ({ ...l, shopping_list_items: [] }));
      return { data: rows, error: null };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      order: (...args: unknown[]) => {
        order = args;
        return builder;
      },
      in: () => builder,
      update: (values: Record<string, unknown>) => {
        update = values;
        return builder;
      },
      eq: (_column: string, value: string) => {
        id = value;
        return builder;
      },
      is: () => {
        archived = 'open';
        return builder;
      },
      not: () => {
        archived = 'archived';
        return builder;
      },
      limit: (n: number) => {
        limit = n;
        return builder;
      },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => run().then(resolve, reject),
    };
    return builder;
  };
  return {
    supabase: { from: (name: string) => table(name) },
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
    errorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  };
});
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn() }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/ui/art', () => ({}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));

const list = (id: string, name: string, archived_at: string | null = null): Row => ({
  id,
  name,
  kind: 'mercado',
  archived_at,
  created_at: '2026-10-01T12:00:00Z',
});
const trip = (list_id: string, name: string): MarketTrip => ({
  id: `t-${list_id}`,
  list_id,
  user_id: 'u1',
  display_name: 'Ana',
  created_at: '2026-10-24T14:00:00Z',
  ends_at: '2026-10-24T16:00:00Z',
  ended_at: null,
  list: { name, kind: 'mercado', archived_at: null },
});

// As mutações do app saem mesmo sem internet (lib/queryClient): renomear é que diz que não dá.
let client: QueryClient;
let renderer: ReactTestRenderer | undefined;
let closed = 0;

const rawText = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(rawText).join(''));
const page = () => rawText(renderer!.root);
const button = (title: string) => renderer!.root.findAllByType(Button).find((entry) => entry.props.title === title);
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

async function render(element: ReactElement) {
  await act(async () => {
    renderer = create(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  });
  await settle();
}
async function press(title: string) {
  const target = button(title);
  expect(target).toBeDefined();
  await act(async () => target!.props.onPress());
  await settle();
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity, networkMode: 'always' } } });
  mockDb.lists = [];
  mockDb.updates = [];
  mockDb.archivedReads = [];
  closed = 0;
  onlineManager.setOnline(true);
  jest.mocked(notify).mockReset();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  client.clear();
  onlineManager.setOnline(true);
});

describe('renomear a lista', () => {
  beforeEach(() => {
    mockDb.lists = [list('l1', 'Mercado'), list('l2', 'Farmácia')];
    client.setQueryData(['list', 'l1'], list('l1', 'Mercado'));
    client.setQueryData(['lists'], [list('l1', 'Mercado'), list('l2', 'Farmácia')].map((l) => ({ ...l, pending: 0, total: 0, items: [] })));
    client.setQueryData(['marketTrips'], [trip('l1', 'Mercado'), trip('l2', 'Farmácia')]);
  });

  it('grava o nome limpo e a lista, as listas e a faixa da ida passam a mostrá-lo', async () => {
    await render(<RenameListModal listId="l1" name="Mercado" onClose={() => (closed += 1)} />);
    const field = renderer!.root.findByType(TextField);
    expect(field.props.value).toBe('Mercado');
    await act(async () => field.props.onChangeText('  Feira   do sábado '));
    await press('Salvar');
    expect(mockDb.updates).toEqual([{ values: { name: 'Feira do sábado' }, id: 'l1' }]);
    expect(closed).toBe(1);
    expect(client.getQueryData<Row>(['list', 'l1'])?.name).toBe('Feira do sábado');
    expect(client.getQueryData<Row[]>(['lists'])?.map((l) => l.name)).toEqual(['Feira do sábado', 'Farmácia']);
    expect(client.getQueryData<MarketTrip[]>(['marketTrips'])?.map((t) => t.list.name)).toEqual(['Feira do sábado', 'Farmácia']);
    expect(client.getQueryState(['lists'])?.isInvalidated).toBe(true);
  });

  it('nome vazio ou comprido demais: diz o que falta e não grava', async () => {
    await render(<RenameListModal listId="l1" name="Mercado" onClose={() => (closed += 1)} />);
    await act(async () => renderer!.root.findByType(TextField).props.onChangeText('   '));
    await press('Salvar');
    expect(page()).toContain('Escreva o nome da lista.');
    await act(async () => renderer!.root.findByType(TextField).props.onChangeText('a'.repeat(61)));
    await press('Salvar');
    expect(page()).toContain('Use até 60 letras.');
    expect(mockDb.updates).toEqual([]);
    expect(closed).toBe(0);
  });

  it('o mesmo nome só fecha, sem gravar', async () => {
    await render(<RenameListModal listId="l1" name="Mercado" onClose={() => (closed += 1)} />);
    await press('Salvar');
    expect(mockDb.updates).toEqual([]);
    expect(closed).toBe(1);
  });

  it('sem internet: avisa, não grava e o modal fica aberto com o nome digitado', async () => {
    onlineManager.setOnline(false);
    await render(<RenameListModal listId="l1" name="Mercado" onClose={() => (closed += 1)} />);
    await act(async () => renderer!.root.findByType(TextField).props.onChangeText('Feira'));
    await press('Salvar');
    expect(mockDb.updates).toEqual([]);
    expect(notify).toHaveBeenCalledWith('Não deu para renomear a lista', RENAME_LIST_OFFLINE);
    expect(closed).toBe(0);
    expect(renderer!.root.findByType(TextField).props.value).toBe('Feira');
    expect(client.getQueryData<Row>(['list', 'l1'])?.name).toBe('Mercado');
  });
});

describe('as listas arquivadas no painel das listas', () => {
  it('sem nenhuma arquivada, a entrada nem aparece', async () => {
    mockDb.lists = [list('l1', 'Mercado')];
    await render(<ShoppingListsPanel />);
    expect(page()).toContain('Mercado');
    expect(button('Listas arquivadas')).toBeUndefined();
  });

  it('todas arquivadas: "Nenhuma lista aberta", e não "Nenhuma lista ainda"', async () => {
    mockDb.lists = [list('a1', 'Churrasco', '2026-10-10T12:00:00Z')];
    await render(<ShoppingListsPanel />);
    expect(page()).toContain('Nenhuma lista aberta');
    expect(page()).not.toContain('Nenhuma lista ainda');
    expect(button('Listas arquivadas')).toBeDefined();
  });

  it('mostra as arquivadas, as mais novas primeiro, e "Reabrir" tira o archived_at e a devolve às listas', async () => {
    mockDb.lists = [
      list('l1', 'Mercado'),
      list('a1', 'Churrasco', '2026-10-10T12:00:00Z'),
      list('a2', 'Festa junina', '2026-10-20T12:00:00Z'),
    ];
    await render(<ShoppingListsPanel />);
    // Fechada, só a entrada.
    expect(page()).not.toContain('Churrasco');
    await press('Listas arquivadas');
    const text = page();
    expect(text.indexOf('Festa junina')).toBeGreaterThan(-1);
    expect(text.indexOf('Festa junina')).toBeLessThan(text.indexOf('Churrasco'));
    expect(text).toContain('Arquivada em 20 out');
    // O servidor manda as arquivadas por último primeiro, no máximo 20.
    expect(mockDb.archivedReads[0]).toEqual({ order: ['archived_at', { ascending: false }], limit: 20 });

    const reopen = renderer!.root.findAllByType(Button).find((entry) => entry.props.accessibilityLabel === 'Reabrir a lista Churrasco')!;
    await act(async () => reopen.props.onPress());
    await settle();
    expect(mockDb.updates).toEqual([{ values: { archived_at: null }, id: 'a1' }]);
    await settle();
    // Saiu das arquivadas e voltou para "Suas listas".
    const after = page();
    expect(after.indexOf('Churrasco')).toBeLessThan(after.indexOf('Esconder as arquivadas'));
    expect(after.split('Churrasco')).toHaveLength(2);
  });
});
