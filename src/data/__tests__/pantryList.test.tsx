import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { PANTRY_LIST_GONE } from '@/domain/pantryList';

import { useAddToPantryList } from '../market';

type Row = Record<string, unknown>;

// "mock" no nome: o jest.mock só enxerga variáveis assim. O banco de mentira, como o servidor o serve.
const mockDb = {
  lists: [] as Row[],
  items: [] as Row[],
  /** Cada pedido, na ordem: 'rpc open_market_list', 'select shopping_lists', 'insert shopping_list_items'... */
  calls: [] as string[],
};

jest.mock('@/lib/supabase', () => {
  const answer = (result: unknown) => ({
    then: (resolve: (value: unknown) => void, reject: (error: unknown) => void) => Promise.resolve(result).then(resolve, reject),
  });
  return {
    supabase: {
      rpc: (name: string) => {
        mockDb.calls.push(`rpc ${name}`);
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

/** Um toque em "Acabou", com o hook de verdade num QueryClient próprio. */
async function finish(item: Item) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  let add: ReturnType<typeof useAddToPantryList> | undefined;
  function Probe() {
    add = useAddToPantryList();
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
});
