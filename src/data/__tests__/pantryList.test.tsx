import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { PANTRY_LIST_GONE } from '@/domain/pantryList';

import { useAddToMarketList, useAddToPantryList } from '../market';

type Row = Record<string, unknown>;

// "mock" no nome: o jest.mock só enxerga variáveis assim. O banco de mentira, como o servidor o serve.
const mockDb = {
  lists: [] as Row[],
  items: [] as Row[],
  /** Cada pedido, na ordem: 'rpc open_market_list', 'select shopping_lists', 'insert shopping_list_items'... */
  calls: [] as string[],
  /** O banco já tem add_to_list (a migração chegou)? */
  hasAddToList: true,
  /** Listas que outro aparelho arquiva logo antes de add_to_list travar a linha delas. */
  archivedMeanwhile: [] as string[],
};

/** add_to_list como o servidor a roda: a lista travada e aberta, sem repetir o pendente. */
function mockAddToList(args: Row): { data: unknown; error: unknown } {
  if (!mockDb.hasAddToList) {
    return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.add_to_list in the schema cache' } };
  }
  // A lista pedida, se está entre as que outro aparelho arquiva no meio, fecha logo antes da trava.
  if (mockDb.archivedMeanwhile.includes(String(args.p_list_id))) {
    const archived = mockDb.lists.find((l) => l.id === args.p_list_id);
    if (archived) archived.archived_at = '2026-10-18T12:00:00Z';
  }
  const list = mockDb.lists.find((l) => l.id === args.p_list_id && !l.archived_at);
  if (!list) return { data: null, error: { code: 'P0002', message: 'list is not open' } };
  const name = String(args.p_name).trim().toLowerCase();
  const pending = mockDb.items.find((i) => i.list_id === list.id && !i.checked_at && String(i.name).trim().toLowerCase() === name);
  if (pending) return { data: { list_id: list.id, list_name: list.name, item_id: pending.id, added: false }, error: null };
  const row = { id: `item-${mockDb.items.length + 1}`, list_id: list.id, name: args.p_name, checked_at: null };
  mockDb.items.push(row);
  return { data: { list_id: list.id, list_name: list.name, item_id: row.id, added: true }, error: null };
}

jest.mock('@/lib/supabase', () => {
  const answer = (result: unknown) => ({
    then: (resolve: (value: unknown) => void, reject: (error: unknown) => void) => Promise.resolve(result).then(resolve, reject),
  });
  return {
    supabase: {
      rpc: (name: string, args: Row) => {
        mockDb.calls.push(`rpc ${name}`);
        if (name === 'add_to_list') return { single: () => answer(mockAddToList(args)) };
        const kind = name === 'open_pharmacy_list' ? 'farmacia' : 'mercado';
        const row = { id: `${kind}-nova`, name: kind === 'farmacia' ? 'Farmácia' : 'Mercado', kind, archived_at: null, created_at: '2026-10-18T12:00:00Z' };
        mockDb.lists.push(row);
        return { single: () => answer({ data: { id: row.id, name: row.name }, error: null }) };
      },
      from: (table: string) => {
        const rows = table === 'shopping_lists' ? mockDb.lists : mockDb.items;
        return {
          select: () => {
            mockDb.calls.push(`select ${table}`);
            const filters: ((row: Row) => boolean)[] = [];
            const query = {
              eq: (column: string, value: unknown) => {
                filters.push((row) => row[column] === value);
                return query;
              },
              is: (column: string, value: unknown) => {
                filters.push((row) => (row[column] ?? null) === value);
                return query;
              },
              ilike: (column: string, value: string) => {
                filters.push((row) => String(row[column]).toLowerCase() === value.toLowerCase());
                return query;
              },
              in: () => query,
              order: () => query,
              limit: () => query,
              then: (resolve: (value: unknown) => void, reject: (error: unknown) => void) =>
                Promise.resolve({ data: rows.filter((row) => filters.every((keep) => keep(row))), error: null }).then(resolve, reject),
            };
            return query;
          },
          insert: (values: Row) => {
            mockDb.calls.push(`insert ${table}`);
            rows.push({ id: `${table}-${rows.length + 1}`, checked_at: null, ...values });
            return answer({ data: null, error: null });
          },
        };
      },
    },
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
  };
});

type Item = Parameters<ReturnType<typeof useAddToPantryList>['mutateAsync']>[0];

const rice: Item = { name: 'Arroz', category: 'mercearia', productId: null, quantity: 1, unit: 'un' };
const pills: Item = { name: 'Dipirona', category: 'medicamentos', productId: null, quantity: 1, unit: 'un' };

const list = (id: string, kind: string, created_at: string, archived_at: string | null = null): Row => ({ id, name: id, kind, created_at, archived_at });

/** Um toque em "Acabou" (ou, com `useAdd`, outro jeito de pôr na lista), com o hook de verdade num QueryClient próprio. */
async function finish(item: Item, useAdd: () => { mutateAsync: (item: Item) => Promise<unknown> } = useAddToPantryList) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  let add: { mutateAsync: (item: Item) => Promise<unknown> } | undefined;
  function Probe() {
    add = useAdd();
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  try {
    let added: Promise<unknown> | undefined;
    await act(async () => {
      added = add!.mutateAsync(item);
      await added.catch(() => undefined);
    });
    return await added!;
  } finally {
    await act(async () => renderer?.unmount());
    queryClient.clear();
  }
}

const itemsIn = (listId: string) => mockDb.items.filter((item) => item.list_id === listId).map((item) => item.name);

afterEach(() => {
  mockDb.lists = [];
  mockDb.items = [];
  mockDb.calls = [];
  mockDb.hasAddToList = true;
  mockDb.archivedMeanwhile = [];
});

describe('o que acabou na despensa vai para uma lista', () => {
  it('sem escolha: a última lista criada em que o item cabe, lida no servidor na hora', async () => {
    mockDb.lists = [
      list('Mercado', 'mercado', '2026-10-01T10:00:00Z'),
      list('Feira', 'mercado', '2026-10-15T10:00:00Z'),
      list('Farmácia', 'farmacia', '2026-10-17T10:00:00Z'),
      list('Arquivada', 'mercado', '2026-10-18T10:00:00Z', '2026-10-18T11:00:00Z'),
    ];
    expect(await finish(rice)).toEqual({ id: 'Feira', name: 'Feira', added: true });
    expect(itemsIn('Feira')).toEqual(['Arroz']);
    expect(mockDb.calls).not.toContain('rpc open_market_list');
  });

  it('a lista escolhida, mesmo não sendo a mais nova', async () => {
    mockDb.lists = [list('Mercado', 'mercado', '2026-10-01T10:00:00Z'), list('Feira', 'mercado', '2026-10-15T10:00:00Z')];
    expect(await finish({ ...rice, listId: 'Mercado' })).toEqual({ id: 'Mercado', name: 'Mercado', added: true });
    expect(itemsIn('Mercado')).toEqual(['Arroz']);
  });

  it('a escolhida foi arquivada em outro aparelho: nada é gravado e o aviso pede outra', async () => {
    mockDb.lists = [list('Feira', 'mercado', '2026-10-15T10:00:00Z', '2026-10-18T09:00:00Z'), list('Mercado', 'mercado', '2026-10-01T10:00:00Z')];
    await expect(finish({ ...rice, listId: 'Feira' })).rejects.toThrow(PANTRY_LIST_GONE);
    expect(mockDb.items).toEqual([]);
  });

  it('já pendente na lista: não entra de novo', async () => {
    mockDb.lists = [list('Feira', 'mercado', '2026-10-15T10:00:00Z')];
    mockDb.items = [{ id: 'i1', list_id: 'Feira', name: 'arroz', checked_at: null }];
    expect(await finish(rice)).toEqual({ id: 'Feira', name: 'Feira', added: false });
    expect(mockDb.items).toHaveLength(1);
  });

  it('o mesmo item já pendente com outro nome (com a marca, ou sem ela): não entra de novo', async () => {
    const milk: Item = { name: 'Leite desnatado', category: 'laticinios', productId: 'il', quantity: 1, unit: 'un' };
    mockDb.lists = [list('Feira', 'mercado', '2026-10-15T10:00:00Z')];
    mockDb.items = [{ id: 'i1', list_id: 'Feira', name: 'Leite IL Desnatado', category: 'laticinios', checked_at: null }];
    expect(await finish(milk)).toEqual({ id: 'Feira', name: 'Feira', added: false });
    expect(mockDb.calls).not.toContain('rpc add_to_list');
    // O contrário também.
    mockDb.items = [{ id: 'i1', list_id: 'Feira', name: 'Leite desnatado', category: 'laticinios', checked_at: null }];
    expect(await finish({ ...milk, name: 'Leite IL Desnatado' })).toMatchObject({ added: false });
    // Outro tipo do mesmo item entra; no carrinho, não conta.
    expect(await finish({ ...milk, name: 'Leite integral' })).toMatchObject({ added: true });
    mockDb.items = [{ id: 'i1', list_id: 'Feira', name: 'Leite IL Desnatado', category: 'laticinios', checked_at: '2026-10-18T10:00:00Z' }];
    expect(await finish(milk)).toMatchObject({ added: true });
  });

  it('nenhuma lista aberta em que caiba: a de mercado de sempre (achada ou criada no servidor)', async () => {
    mockDb.lists = [list('Farmácia', 'farmacia', '2026-10-17T10:00:00Z')];
    expect(await finish(rice)).toMatchObject({ name: 'Mercado', added: true });
    expect(mockDb.calls).toContain('rpc open_market_list');
  });

  it('remédio sem lista de farmácia aberta: a da farmácia, não a de mercado', async () => {
    mockDb.lists = [list('Feira', 'mercado', '2026-10-15T10:00:00Z')];
    expect(await finish(pills)).toMatchObject({ name: 'Farmácia', added: true });
    expect(mockDb.calls).toContain('rpc open_pharmacy_list');
    expect(itemsIn('Feira')).toEqual([]);
  });

  it('a escolhida é arquivada entre a leitura e a trava: nada é gravado e o aviso pede outra', async () => {
    mockDb.lists = [list('Feira', 'mercado', '2026-10-15T10:00:00Z'), list('Mercado', 'mercado', '2026-10-01T10:00:00Z')];
    mockDb.archivedMeanwhile = ['Feira'];
    await expect(finish({ ...rice, listId: 'Feira' })).rejects.toThrow(PANTRY_LIST_GONE);
    expect(mockDb.items).toEqual([]);
  });

  it('a que o app escolheu é arquivada no meio: vai para a próxima mais nova', async () => {
    mockDb.lists = [list('Feira', 'mercado', '2026-10-15T10:00:00Z'), list('Mercado', 'mercado', '2026-10-01T10:00:00Z')];
    mockDb.archivedMeanwhile = ['Feira'];
    expect(await finish(rice)).toEqual({ id: 'Mercado', name: 'Mercado', added: true });
    expect(itemsIn('Feira')).toEqual([]);
    expect(itemsIn('Mercado')).toEqual(['Arroz']);
  });

  it('a lista que o menu mostrou vale enquanto aberta, mesmo com outra criada depois em outro aparelho', async () => {
    mockDb.lists = [list('Feira', 'mercado', '2026-10-15T10:00:00Z'), list('Nova', 'mercado', '2026-10-18T10:00:00Z')];
    expect(await finish({ ...rice, shownListId: 'Feira' })).toEqual({ id: 'Feira', name: 'Feira', added: true });
    // Fechada: a mais nova.
    mockDb.lists[0].archived_at = '2026-10-18T11:00:00Z';
    expect(await finish({ ...rice, name: 'Feijão', shownListId: 'Feira' })).toEqual({ id: 'Nova', name: 'Nova', added: true });
  });

  it('listas arquivadas uma depois da outra: para depois de 3 tentativas, sem gravar nada', async () => {
    mockDb.lists = ['A', 'B', 'C', 'D'].map((id, i) => list(id, 'mercado', `2026-10-1${i}T10:00:00Z`));
    mockDb.archivedMeanwhile = ['A', 'B', 'C', 'D'];
    await expect(finish(rice)).rejects.toThrow(PANTRY_LIST_GONE);
    expect(mockDb.calls.filter((c) => c === 'rpc add_to_list')).toHaveLength(3);
    expect(mockDb.items).toEqual([]);
  });

  it('banco sem add_to_list: o caminho de antes, conferindo a lista e o pendente daqui', async () => {
    mockDb.hasAddToList = false;
    mockDb.lists = [list('Feira', 'mercado', '2026-10-15T10:00:00Z')];
    expect(await finish(rice)).toEqual({ id: 'Feira', name: 'Feira', added: true });
    expect(mockDb.calls).toContain('insert shopping_list_items');
    expect(itemsIn('Feira')).toEqual(['Arroz']);
  });
});

describe('o Nuke e o cardápio (lista de mercado aberta, sem add_to_list)', () => {
  it('o mesmo item já pendente com outro nome não entra de novo; outro tipo e outra marca entram', async () => {
    const milk: Item = { name: 'Leite desnatado', category: 'laticinios', productId: null, quantity: 1, unit: 'un' };
    mockDb.items = [
      { id: 'i1', list_id: 'mercado-nova', name: 'Leite IL Desnatado', category: 'laticinios', checked_at: null },
      { id: 'i2', list_id: 'mercado-nova', name: 'Shampoo Seda', category: 'higiene', checked_at: null },
    ];
    expect(await finish(milk, useAddToMarketList)).toMatchObject({ added: false });
    expect(await finish({ ...milk, name: 'leite il desnatado' }, useAddToMarketList)).toMatchObject({ added: false });
    expect(mockDb.calls).not.toContain('insert shopping_list_items');
    expect(await finish({ ...milk, name: 'Leite integral' }, useAddToMarketList)).toMatchObject({ added: true });
    expect(await finish({ ...milk, name: 'Shampoo Clear Men', category: 'higiene' }, useAddToMarketList)).toMatchObject({ added: true });
    expect(itemsIn('mercado-nova')).toEqual(['Leite IL Desnatado', 'Shampoo Seda', 'Leite integral', 'Shampoo Clear Men']);
  });
});
