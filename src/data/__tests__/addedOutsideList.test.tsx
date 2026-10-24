import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { setAddedItemsRecorder, useAddItemsToList, useAddToMarketList } from '@/data/market';

// Os itens que este aparelho põe fora da tela da lista (o Nuke, o cardápio, as reposições, a dieta e a tela Hoje)
// também ficam como deste aparelho: o id sai daqui, vai no insert e é guardado (o selo "Novo" da ida ao mercado
// não vale para eles).

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockDb = { inserts: [] as Record<string, unknown>[] };
jest.mock('@/lib/supabase', () => {
  const table = () => {
    let inserted: Record<string, unknown>[] | null = null;
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      insert: (values: Record<string, unknown> | Record<string, unknown>[]) => {
        inserted = Array.isArray(values) ? values : [values];
        return builder;
      },
      then: (resolve: (value: unknown) => unknown) => {
        if (inserted) mockDb.inserts.push(...inserted);
        return Promise.resolve({ data: inserted ? null : [], error: null }).then(resolve);
      },
    };
    return builder;
  };
  return {
    supabase: {
      from: () => table(),
      rpc: () => ({ single: async () => ({ data: { id: 'l1', name: 'Mercado' }, error: null }) }),
    },
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
  };
});

/** O que lib/queryClient liga no app: data/market avisa quem guarda. */
const recorded: { listId: string; ids: string[] }[] = [];

let client: QueryClient;
let renderer: ReactTestRenderer | undefined;
const hooks: { market?: ReturnType<typeof useAddToMarketList>; many?: ReturnType<typeof useAddItemsToList> } = {};

function Probe() {
  const market = useAddToMarketList();
  const many = useAddItemsToList();
  useEffect(() => {
    hooks.market = market;
    hooks.many = many;
  });
  return null;
}

beforeEach(async () => {
  mockDb.inserts = [];
  recorded.length = 0;
  setAddedItemsRecorder((listId, ids) => recorded.push({ listId, ids }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  client.clear();
  setAddedItemsRecorder(() => undefined);
});

const leite = { name: 'Leite', category: 'laticinios', productId: null, quantity: 1, unit: 'un' as const };

describe('itens postos fora da tela da lista', () => {
  it('o "Pôr na lista" do Nuke, do cardápio e das reposições: o id do insert fica guardado como deste aparelho', async () => {
    await act(async () => {
      await hooks.market!.mutateAsync(leite);
    });
    expect(mockDb.inserts).toHaveLength(1);
    const id = mockDb.inserts[0].id as string;
    expect(typeof id).toBe('string');
    expect(recorded).toEqual([{ listId: 'l1', ids: [id] }]);
  });

  it('vários de uma vez (a dieta, a tela Hoje): os ids de todos', async () => {
    await act(async () => {
      await hooks.many!.mutateAsync({ listId: 'l2', newListName: 'Mercado', items: [leite, { ...leite, name: 'Pão' }] });
    });
    const ids = mockDb.inserts.map((row) => row.id as string);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(recorded).toEqual([{ listId: 'l2', ids }]);
  });
});
