import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import {
  setAddedItemsRecorder,
  useAddItemsToList,
  useAddToMarketList,
  useAddToPantryList,
  useAddToPharmacyList,
} from '@/data/market';

// Os itens que este aparelho põe fora da tela da lista também ficam como deste aparelho (o selo "Novo" da ida ao
// mercado não vale para eles): o Nuke, o cardápio, as reposições, a dieta e a tela Hoje mandam o id gerado aqui,
// guardado antes do envio; o "Acabou" da despensa, o "Pôr na lista" do produto e o remédio usam o id que a função
// do banco devolve.

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockDb = {
  inserts: [] as Record<string, unknown>[],
  /** O insert falha (a resposta que se perdeu, do ponto de vista do app). */
  failInsert: false,
  /** add_to_list e add_to_pharmacy_list: o item já estava pendente (nada posto). */
  alreadyListed: false,
};
jest.mock('@/lib/supabase', () => {
  const table = (name: string) => {
    let inserted: Record<string, unknown>[] | null = null;
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      order: () => builder,
      insert: (values: Record<string, unknown> | Record<string, unknown>[]) => {
        inserted = Array.isArray(values) ? values : [values];
        return builder;
      },
      then: (resolve: (value: unknown) => unknown) => {
        if (inserted) {
          if (mockDb.failInsert) return Promise.resolve({ data: null, error: { code: '08006', message: 'conexão caiu' } }).then(resolve);
          mockDb.inserts.push(...inserted);
          return Promise.resolve({ data: null, error: null }).then(resolve);
        }
        // As listas abertas (o "Acabou" da despensa escolhe a mais nova em que o item cabe); itens pendentes, nenhum.
        const rows = name === 'shopping_lists' ? [{ id: 'l3', name: 'Feira', kind: 'mercado', created_at: '2026-10-20T12:00:00Z' }] : [];
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return builder;
  };
  const rpc = (fn: string, args: Record<string, unknown>) => ({
    single: async () => {
      if (fn === 'open_market_list') return { data: { id: 'l1', name: 'Mercado' }, error: null };
      if (fn === 'add_to_list') {
        return { data: { list_id: args.p_list_id, list_name: 'Feira', item_id: 'srv-item', added: !mockDb.alreadyListed }, error: null };
      }
      if (fn === 'add_to_pharmacy_list') {
        return { data: { list_id: 'f1', list_name: 'Farmácia', item_id: 'srv-remedio', added: !mockDb.alreadyListed }, error: null };
      }
      throw new Error(`rpc inesperada: ${fn}`);
    },
  });
  return {
    supabase: { from: (name: string) => table(name), rpc },
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
const hooks: {
  market?: ReturnType<typeof useAddToMarketList>;
  many?: ReturnType<typeof useAddItemsToList>;
  pantry?: ReturnType<typeof useAddToPantryList>;
  pharmacy?: ReturnType<typeof useAddToPharmacyList>;
} = {};

function Probe() {
  const market = useAddToMarketList();
  const many = useAddItemsToList();
  const pantry = useAddToPantryList();
  const pharmacy = useAddToPharmacyList();
  useEffect(() => {
    Object.assign(hooks, { market, many, pantry, pharmacy });
  });
  return null;
}

beforeEach(async () => {
  mockDb.inserts = [];
  mockDb.failInsert = false;
  mockDb.alreadyListed = false;
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

  it('guardado antes do envio: a resposta que se perde (o item pode ter entrado) não deixa o selo no próprio item', async () => {
    mockDb.failInsert = true;
    await act(async () => {
      await expect(hooks.market!.mutateAsync(leite)).rejects.toBeTruthy();
      await expect(hooks.many!.mutateAsync({ listId: 'l2', newListName: 'Mercado', items: [leite] })).rejects.toBeTruthy();
    });
    expect(recorded.map((entry) => entry.listId)).toEqual(['l1', 'l2']);
    expect(recorded.every((entry) => entry.ids.length === 1)).toBe(true);
  });

  it('o "Acabou" da despensa e o "Pôr na lista" do produto: o id que add_to_list devolve', async () => {
    await act(async () => {
      await hooks.pantry!.mutateAsync(leite);
    });
    expect(recorded).toEqual([{ listId: 'l3', ids: ['srv-item'] }]);
  });

  it('o remédio na lista da farmácia: o id que add_to_pharmacy_list devolve', async () => {
    await act(async () => {
      await hooks.pharmacy!.mutateAsync({ ...leite, name: 'Dipirona', category: 'medicamentos' });
    });
    expect(recorded).toEqual([{ listId: 'f1', ids: ['srv-remedio'] }]);
  });

  it('o item que já estava pendente (nada posto agora) não fica como deste aparelho', async () => {
    mockDb.alreadyListed = true;
    await act(async () => {
      await hooks.pantry!.mutateAsync(leite);
      await hooks.pharmacy!.mutateAsync({ ...leite, name: 'Dipirona', category: 'medicamentos' });
    });
    expect(recorded).toEqual([]);
  });
});
