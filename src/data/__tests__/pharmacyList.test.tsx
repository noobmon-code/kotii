import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useAddToPharmacyList } from '../market';

type Row = Record<string, unknown>;
type Answer = { data: unknown; error: unknown };

// "mock" no nome: o jest.mock só enxerga variáveis assim. O banco de mentira, como o servidor o serve.
const mockDb = {
  /** O que cada função do banco responde (ou faz), pelo nome; sem ela, o banco não tem a função (PGRST202). */
  functions: {} as Record<string, Answer | ((args: Row) => Answer)>,
  lists: [] as Row[],
  items: [] as Row[],
  /** Cada pedido, na ordem: 'rpc add_to_pharmacy_list', 'select shopping_lists', 'insert shopping_lists'... */
  calls: [] as string[],
  /** Os argumentos de cada função chamada, na ordem. */
  rpcArgs: [] as [string, unknown][],
};

jest.mock('@/lib/supabase', () => {
  const answer = (result: unknown) => ({
    then: (resolve: (value: unknown) => void, reject: (error: unknown) => void) => Promise.resolve(result).then(resolve, reject),
  });
  return {
    supabase: {
      rpc: (name: string, args: Row) => {
        mockDb.calls.push(`rpc ${name}`);
        mockDb.rpcArgs.push([name, args]);
        const fn = mockDb.functions[name];
        const result = typeof fn === 'function' ? fn(args) : (fn ?? { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache` } });
        return { single: () => answer(result) };
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

const losartana = { name: 'Losartana', altName: 'Losartana — Ana', category: 'medicamentos', productId: null, quantity: 1, unit: 'un' as const };
type Item = Parameters<ReturnType<typeof useAddToPharmacyList>['mutateAsync']>[0];

/** Um celular com o app aberto: o hook de verdade, num QueryClient próprio. */
async function phone() {
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
  return {
    add: (item: Item) => add!.mutateAsync(item),
    close: async () => {
      await act(async () => renderer?.unmount());
      queryClient.clear();
    },
  };
}

async function addToPharmacy(item: Item = losartana) {
  const device = await phone();
  try {
    // A promessa sai do act para quem testa ver o resultado ou o erro.
    let added: Promise<unknown> | undefined;
    await act(async () => {
      added = device.add(item);
      await added.catch(() => undefined);
    });
    return await added!;
  } finally {
    await device.close();
  }
}

/** A função do banco como o servidor a roda: acha o item pendente ou o põe, numa vez só (a trava é dela). */
function atomicAdd(args: Row): Answer {
  const names = [args.p_item, args.p_alt_item].filter(Boolean).map((name) => String(name).trim().toLowerCase());
  const pending = mockDb.items.find((item) => !item.checked_at && names.includes(String(item.name).trim().toLowerCase()));
  if (pending) return { data: { list_id: pending.list_id, list_name: 'Farmácia', item_id: pending.id, added: false }, error: null };
  const row = { id: `item-${mockDb.items.length + 1}`, list_id: 'farmacia-1', name: args.p_item, checked_at: null };
  mockDb.items.push(row);
  return { data: { list_id: 'farmacia-1', list_name: 'Farmácia', item_id: row.id, added: true }, error: null };
}

const missing = (fn: string) => ({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` } });

afterEach(() => {
  mockDb.functions = {};
  mockDb.lists = [];
  mockDb.items = [];
  mockDb.calls = [];
  mockDb.rpcArgs = [];
});

describe('pôr o remédio na lista da farmácia', () => {
  it('a função do banco acha a lista e põe o item numa vez só, conferindo o nome do remédio e o nome com a pessoa', async () => {
    mockDb.functions.add_to_pharmacy_list = { data: { list_id: 'farmacia-1', list_name: 'Farmácia', item_id: 'item-1', added: true }, error: null };
    await expect(addToPharmacy()).resolves.toEqual({ id: 'farmacia-1', name: 'Farmácia', added: true });
    expect(mockDb.rpcArgs).toEqual([['add_to_pharmacy_list', { p_item: 'Losartana', p_alt_item: 'Losartana — Ana' }]]);
    // Nada de achar a lista, conferir e pôr por fora: é tudo da função.
    expect(mockDb.calls).toEqual(['rpc add_to_pharmacy_list']);
  });

  it('já estava pendente (nesta lista ou noutra de farmácia aberta): a resposta diz onde, e nada é posto', async () => {
    mockDb.functions.add_to_pharmacy_list = { data: { list_id: 'farmacia-velha', list_name: 'Drogasil', item_id: 'item-9', added: false }, error: null };
    await expect(addToPharmacy()).resolves.toEqual({ id: 'farmacia-velha', name: 'Drogasil', added: false });
    expect(mockDb.calls).toEqual(['rpc add_to_pharmacy_list']);
    // Sem o nome com a pessoa, só o nome.
    mockDb.rpcArgs = [];
    await addToPharmacy({ ...losartana, altName: undefined });
    expect(mockDb.rpcArgs).toEqual([['add_to_pharmacy_list', { p_item: 'Losartana', p_alt_item: null }]]);
  });

  it('dois celulares ao mesmo tempo: quem decide é a função do banco, e o remédio fica na lista uma vez só', async () => {
    mockDb.functions.add_to_pharmacy_list = atomicAdd;
    const [ana, beto] = [await phone(), await phone()];
    try {
      let both: unknown[] = [];
      await act(async () => {
        both = await Promise.all([ana.add(losartana), beto.add({ ...losartana, altName: 'Losartana — Beto' })]);
      });
      expect(both).toEqual([
        { id: 'farmacia-1', name: 'Farmácia', added: true },
        { id: 'farmacia-1', name: 'Farmácia', added: false },
      ]);
      expect(mockDb.items).toHaveLength(1);
      expect(mockDb.calls).toEqual(['rpc add_to_pharmacy_list', 'rpc add_to_pharmacy_list']);
    } finally {
      await ana.close();
      await beto.close();
    }
  });

  it.each([
    ['PGRST202', 'Could not find the function public.add_to_pharmacy_list(p_alt_item, p_item) in the schema cache'],
    ['42883', 'function public.add_to_pharmacy_list(text, text) does not exist'],
  ])(
    'banco sem add_to_pharmacy_list, ou com o cache de antes dela (%s): o caminho de antes, com a lista de open_pharmacy_list',
    async (code, message) => {
      mockDb.functions.add_to_pharmacy_list = { data: null, error: { code, message } };
      mockDb.functions.open_pharmacy_list = { data: { id: 'farmacia-1', name: 'Farmácia' }, error: null };
      await expect(addToPharmacy()).resolves.toEqual({ id: 'farmacia-1', name: 'Farmácia', added: true });
      expect(mockDb.rpcArgs.map(([fn, args]) => [fn, args])).toEqual([
        ['add_to_pharmacy_list', { p_item: 'Losartana', p_alt_item: 'Losartana — Ana' }],
        ['open_pharmacy_list', { p_name: 'Farmácia' }],
      ]);
      expect(mockDb.calls).toEqual(['rpc add_to_pharmacy_list', 'rpc open_pharmacy_list', 'select shopping_list_items', 'insert shopping_list_items']);
      expect(mockDb.items).toEqual([expect.objectContaining({ list_id: 'farmacia-1', name: 'Losartana', category: 'medicamentos', quantity: 1 })]);
    },
  );

  it('no caminho de antes, o item já pendente na lista não entra de novo', async () => {
    mockDb.functions.open_pharmacy_list = { data: { id: 'farmacia-1', name: 'Farmácia' }, error: null };
    mockDb.items = [{ id: 'item-1', list_id: 'farmacia-1', name: 'losartana', checked_at: null }];
    await expect(addToPharmacy()).resolves.toEqual({ id: 'farmacia-1', name: 'Farmácia', added: false });
    expect(mockDb.calls).toEqual(['rpc add_to_pharmacy_list', 'rpc open_pharmacy_list', 'select shopping_list_items']);
    expect(mockDb.items).toHaveLength(1);
  });

  it.each([
    ['PGRST202', 'Could not find the function public.open_pharmacy_list(p_name) in the schema cache'],
    ['42883', 'function public.open_pharmacy_list(text) does not exist'],
  ])('banco sem nenhuma das duas funções (%s): procura a lista aberta e, sem nenhuma, cria "Farmácia", como antes', async (code, message) => {
    mockDb.functions.open_pharmacy_list = { data: null, error: { code, message } };
    await expect(addToPharmacy()).resolves.toEqual({ id: 'shopping_lists-1', name: 'Farmácia', added: true });
    expect(mockDb.calls).toEqual([
      'rpc add_to_pharmacy_list',
      'rpc open_pharmacy_list',
      'select shopping_lists',
      'insert shopping_lists',
      'select shopping_list_items',
      'insert shopping_list_items',
    ]);
    expect(mockDb.lists).toEqual([expect.objectContaining({ name: 'Farmácia', kind: 'farmacia' })]);
    expect(mockDb.items).toEqual([expect.objectContaining({ list_id: 'shopping_lists-1', name: 'Losartana' })]);
  });

  it('banco sem as funções: usa a lista de farmácia aberta (não a de mercado nem a arquivada)', async () => {
    mockDb.functions.open_pharmacy_list = missing('open_pharmacy_list(p_name)');
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
    ['regra de acesso', { code: '42501', message: 'new row violates row-level security policy for table "shopping_list_items"' }],
    // A função existe e uma que ela chama, não: não é o banco de antes da migração.
    ['outra função faltando lá dentro', { code: '42883', message: 'function public.normalize(text, unknown) does not exist' }],
  ])('qualquer outro erro (%s) chega a quem chamou, sem pôr lista nem item por fora', async (_case, error) => {
    mockDb.functions.add_to_pharmacy_list = { data: null, error };
    await expect(addToPharmacy()).rejects.toBe(error);
    expect(mockDb.calls).toEqual(['rpc add_to_pharmacy_list']);
    expect(mockDb.lists).toEqual([]);
    expect(mockDb.items).toEqual([]);
  });

  it.each([
    ['sem casa', { code: '42501', message: 'sem casa' }],
    ['sem internet', { message: 'TypeError: Network request failed' }],
  ])('no caminho de antes, um erro de open_pharmacy_list (%s) também chega a quem chamou, sem criar lista por fora', async (_case, error) => {
    mockDb.functions.open_pharmacy_list = { data: null, error };
    await expect(addToPharmacy()).rejects.toBe(error);
    expect(mockDb.calls).toEqual(['rpc add_to_pharmacy_list', 'rpc open_pharmacy_list']);
    expect(mockDb.lists).toEqual([]);
    expect(mockDb.items).toEqual([]);
  });
});
