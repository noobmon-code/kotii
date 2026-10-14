import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useAddToPharmacyList } from '../market';

type Row = Record<string, unknown>;

// "mock" no nome: o jest.mock só enxerga variáveis assim. O banco de mentira, como o servidor o serve.
const mockDb = {
  /** O que a função open_pharmacy_list responde. */
  rpc: { data: null as Row | null, error: null as unknown },
  lists: [] as Row[],
  items: [] as Row[],
  /** Cada pedido, na ordem: 'rpc open_pharmacy_list', 'select shopping_lists', 'insert shopping_lists'... */
  calls: [] as string[],
  rpcArgs: [] as unknown[],
};

jest.mock('@/lib/supabase', () => {
  const answer = (result: unknown) => ({
    then: (resolve: (value: unknown) => void, reject: (error: unknown) => void) => Promise.resolve(result).then(resolve, reject),
  });
  return {
    supabase: {
      rpc: (name: string, args: unknown) => {
        mockDb.calls.push(`rpc ${name}`);
        mockDb.rpcArgs.push(args);
        return { single: () => answer({ data: mockDb.rpc.data, error: mockDb.rpc.error }) };
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
              order: () => query,
              limit: () => query,
              then: (resolve: (value: unknown) => void, reject: (error: unknown) => void) =>
                Promise.resolve({ data: rows.filter((row) => filters.every((keep) => keep(row))), error: null }).then(resolve, reject),
            };
            return query;
          },
          insert: (values: Row) => {
            mockDb.calls.push(`insert ${table}`);
            const row: Row = { id: `${table}-${rows.length + 1}`, archived_at: null, checked_at: null, ...values };
            rows.push(row);
            return {
              select: () => ({ single: () => answer({ data: { id: row.id, name: row.name }, error: null }) }),
              ...answer({ data: null, error: null }),
            };
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

const losartana = { name: 'Losartana', category: 'medicamentos', productId: null, quantity: 1, unit: 'un' as const };

async function addToPharmacy() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  let add: ReturnType<typeof useAddToPharmacyList> | undefined;
  function Probe() {
    add = useAddToPharmacyList();
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
    // A promessa sai do act para quem testa ver o resultado ou o erro.
    let added: ReturnType<NonNullable<typeof add>['mutateAsync']> | undefined;
    await act(async () => {
      added = add!.mutateAsync(losartana);
      await added.catch(() => undefined);
    });
    return await added!;
  } finally {
    await act(async () => renderer?.unmount());
    queryClient.clear();
  }
}

afterEach(() => {
  mockDb.rpc = { data: null, error: null };
  mockDb.lists = [];
  mockDb.items = [];
  mockDb.calls = [];
  mockDb.rpcArgs = [];
});

describe('pôr o remédio na lista da farmácia', () => {
  it('a lista vem da função do banco (achar ou criar numa transação só), não de um select seguido de insert', async () => {
    mockDb.rpc.data = { id: 'farmacia-1', name: 'Farmácia' };
    await expect(addToPharmacy()).resolves.toEqual({ id: 'farmacia-1', name: 'Farmácia', added: true });
    expect(mockDb.rpcArgs).toEqual([{ p_name: 'Farmácia' }]);
    expect(mockDb.calls).toEqual(['rpc open_pharmacy_list', 'select shopping_list_items', 'insert shopping_list_items']);
    expect(mockDb.items).toEqual([expect.objectContaining({ list_id: 'farmacia-1', name: 'Losartana', category: 'medicamentos', quantity: 1 })]);
  });

  it.each([
    ['PGRST202', 'Could not find the function public.open_pharmacy_list(p_name) in the schema cache'],
    ['42883', 'function public.open_pharmacy_list(text) does not exist'],
  ])('banco sem a função (%s): procura a lista aberta e, sem nenhuma, cria "Farmácia", como antes', async (code, message) => {
    mockDb.rpc.error = { code, message };
    await expect(addToPharmacy()).resolves.toEqual({ id: 'shopping_lists-1', name: 'Farmácia', added: true });
    expect(mockDb.calls).toEqual([
      'rpc open_pharmacy_list',
      'select shopping_lists',
      'insert shopping_lists',
      'select shopping_list_items',
      'insert shopping_list_items',
    ]);
    expect(mockDb.lists).toEqual([expect.objectContaining({ name: 'Farmácia', kind: 'farmacia' })]);
    expect(mockDb.items).toEqual([expect.objectContaining({ list_id: 'shopping_lists-1', name: 'Losartana' })]);
  });

  it('banco sem a função: usa a lista de farmácia aberta (não a de mercado nem a arquivada)', async () => {
    mockDb.rpc.error = { code: 'PGRST202', message: 'Could not find the function public.open_pharmacy_list(p_name) in the schema cache' };
    mockDb.lists = [
      { id: 'mercado', name: 'Mercado', kind: 'mercado', archived_at: null },
      { id: 'velha', name: 'Farmácia', kind: 'farmacia', archived_at: '2026-10-01T10:00:00Z' },
      { id: 'aberta', name: 'Farmácia', kind: 'farmacia', archived_at: null },
    ];
    await expect(addToPharmacy()).resolves.toMatchObject({ id: 'aberta', name: 'Farmácia', added: true });
    expect(mockDb.calls).not.toContain('insert shopping_lists');
    expect(mockDb.items).toEqual([expect.objectContaining({ list_id: 'aberta' })]);
  });

  it.each([
    ['sem casa', { code: '42501', message: 'sem casa' }],
    ['sem internet', { message: 'TypeError: Network request failed' }],
    ['regra de acesso', { code: '42501', message: 'new row violates row-level security policy for table "shopping_lists"' }],
  ])('qualquer outro erro (%s) chega a quem chamou, sem criar lista por fora', async (_case, error) => {
    mockDb.rpc.error = error;
    await expect(addToPharmacy()).rejects.toBe(error);
    expect(mockDb.calls).toEqual(['rpc open_pharmacy_list']);
    expect(mockDb.lists).toEqual([]);
    expect(mockDb.items).toEqual([]);
  });
});
