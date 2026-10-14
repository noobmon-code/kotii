import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { SharedPrice } from '@/domain/sharedPrices';
import { persistOptions, queryClient as appQueryClient } from '@/lib/queryClient';

import { useConfirmReceipt } from '../receipts';
import { fetchSharedPrices, isMissingFunction, useSharedPrices } from '../sharedPrices';

// "mock" no nome: o jest.mock só enxerga variáveis assim. O que o banco de mentira responde a cada função.
const mockRpc: { answer: (name: string) => { data: unknown; error: unknown }; called: string[] } = {
  answer: () => ({ data: null, error: null }),
  called: [],
};

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-network', () => ({
  addNetworkStateListener: () => ({ remove: () => undefined }),
  getNetworkStateAsync: () => Promise.resolve({ isConnected: true, isInternetReachable: true }),
}));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/lib/session', () => ({ endSessionIfGone: async () => false }));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (name: string) => {
      mockRpc.called.push(name);
      const result = mockRpc.answer(name);
      // Com .order().range() (os preços de outras casas) ou direto (confirmar a nota).
      const query = { order: () => query, range: async () => result, then: (resolve: (value: unknown) => void) => resolve(result) };
      return query;
    },
  },
  unwrap: (result: { data: unknown; error: unknown }) => {
    if (result.error) throw result.error;
    return result.data;
  },
}));

// Como o PostgREST e o Postgres respondem quando a função ainda não existe.
const notInCache = { code: 'PGRST202', message: 'Could not find the function public.shared_latest_prices without parameters in the schema cache' };
const noFunction = { code: '42883', message: 'function public.shared_latest_prices() does not exist' };
const offline = { message: 'TypeError: Network request failed' };

const price = (n: number): SharedPrice => ({
  product_id: `p${String(n).padStart(5, '0')}`,
  store_cnpj: '11222333000181',
  store_name: 'Atacadão Mooca',
  store_uf: '35',
  unit: 'un',
  unit_price: 10 + (n % 7),
  seen_on: '2026-10-10',
  mine: n % 2 === 0,
});

/** Um banco de mentira: guarda cada pedido e responde as linhas da página pedida (ou o erro combinado). */
function fakeDb(rows: unknown[], error: unknown = null) {
  const asked: { name: string; order: string[]; range: [number, number] }[] = [];
  const db = {
    rpc: (name: string) => {
      const order: string[] = [];
      const query = {
        order: (column: string) => {
          order.push(column);
          return query;
        },
        range: async (from: number, to: number) => {
          asked.push({ name, order: [...order], range: [from, to] });
          return error ? { data: null, error } : { data: rows.slice(from, to + 1), error: null };
        },
      };
      return query;
    },
  };
  return { db: db as unknown as SupabaseClient, asked };
}

afterEach(() => {
  mockRpc.answer = () => ({ data: null, error: null });
  mockRpc.called = [];
  appQueryClient.clear();
});

describe('a função que ainda não existe no banco', () => {
  it('reconhece a resposta do PostgREST e a do Postgres', () => {
    expect(isMissingFunction(notInCache, 'shared_latest_prices')).toBe(true);
    expect(isMissingFunction(noFunction, 'shared_latest_prices')).toBe(true);
    // Sem código (um intermediário trocou a resposta), pelo texto, e só o desta função.
    expect(isMissingFunction({ message: notInCache.message }, 'shared_latest_prices')).toBe(true);
    expect(isMissingFunction({ message: notInCache.message }, 'outra_funcao')).toBe(false);
  });

  it('outros erros não são "função que não existe"', () => {
    expect(isMissingFunction(offline, 'shared_latest_prices')).toBe(false);
    expect(isMissingFunction({ code: '42501', message: 'permission denied for function shared_latest_prices' }, 'shared_latest_prices')).toBe(false);
    expect(isMissingFunction({ code: 'PGRST205', message: "Could not find the table 'public.x' in the schema cache" }, 'shared_latest_prices')).toBe(false);
    expect(isMissingFunction(null, 'shared_latest_prices')).toBe(false);
    expect(isMissingFunction('erro', 'shared_latest_prices')).toBe(false);
  });
});

describe('preços de outras casas', () => {
  it.each([notInCache, noFunction])('sem a função no banco: "não disponível" (null), sem erro', async (error) => {
    const { db, asked } = fakeDb([], error);
    await expect(fetchSharedPrices(db)).resolves.toBeNull();
    expect(asked).toHaveLength(1);
  });

  it('com a função e nada para a casa: lista vazia, que não é o mesmo que "não disponível"', async () => {
    await expect(fetchSharedPrices(fakeDb([]).db)).resolves.toEqual([]);
  });

  it('lê pela função, nunca pelas tabelas, na ordem da chave da resposta', async () => {
    const { db, asked } = fakeDb([price(1), price(2)]);
    await expect(fetchSharedPrices(db)).resolves.toEqual([price(1), price(2)]);
    expect(asked).toEqual([{ name: 'shared_latest_prices', order: ['product_id', 'store_cnpj', 'unit'], range: [0, 999] }]);
  });

  it('o preço chega como número, mesmo que o banco mande texto', async () => {
    const rows = await fetchSharedPrices(fakeDb([{ ...price(1), unit_price: '21.9000' }]).db);
    expect(rows?.[0].unit_price).toBe(21.9);
  });

  it('"é mercado da casa" só com um sim do banco, e o estado que não veio é "não se sabe"', async () => {
    const { mine: _mine, store_uf: _state, ...bare } = price(2);
    const rows = await fetchSharedPrices(fakeDb([price(2), price(1), bare, { ...bare, mine: 'true', store_uf: undefined }]).db);
    expect(rows?.map((row) => [row.mine, row.store_uf])).toEqual([
      [true, '35'],
      [false, '35'],
      [false, null],
      [false, null],
    ]);
  });

  it('mais de mil: página por página, até vir uma incompleta', async () => {
    const { db, asked } = fakeDb(Array.from({ length: 2300 }, (_, n) => price(n)));
    const rows = await fetchSharedPrices(db);
    expect(rows).toHaveLength(2300);
    expect(new Set(rows?.map((row) => row.product_id)).size).toBe(2300);
    expect(asked.map((request) => request.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('para em dez páginas: são dicas, o que veio já basta', async () => {
    const { db, asked } = fakeDb(Array.from({ length: 12_000 }, (_, n) => price(n)));
    await expect(fetchSharedPrices(db)).resolves.toHaveLength(10_000);
    expect(asked).toHaveLength(10);
  });

  it('outro erro sobe (a tela só deixa de mostrar a seção)', async () => {
    await expect(fetchSharedPrices(fakeDb([], offline).db)).rejects.toBe(offline);
  });
});

/** Monta `Probe` com um cache novo e espera `done` (as buscas terminam fora do render). */
async function mount(Probe: () => null, queryClient: QueryClient, done: () => boolean) {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  for (let turn = 0; turn < 20 && !done(); turn++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  return renderer!;
}

describe('no cache do app', () => {
  it('a tela recebe os preços na chave sharedPrices; sem a função, null', async () => {
    for (const [answer, expected] of [
      [{ data: [price(1)], error: null }, [price(1)]],
      [{ data: null, error: notInCache }, null],
    ] as const) {
      mockRpc.answer = () => answer;
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
      const seen: unknown[] = [];
      const renderer = await mount(
        function Probe() {
          seen.push(useSharedPrices().data);
          return null;
        },
        queryClient,
        () => seen.at(-1) !== undefined,
      );
      expect(seen.at(-1)).toEqual(expected);
      expect(queryClient.getQueryData(['sharedPrices'])).toEqual(expected);
      await act(async () => renderer.unmount());
      queryClient.clear();
    }
    expect(mockRpc.called).toEqual(['shared_latest_prices', 'shared_latest_prices']);
  });

  it('não fica guardado no aparelho (os preços da própria casa ficam)', () => {
    appQueryClient.setQueryData(['sharedPrices'], [price(1)]);
    appQueryClient.setQueryData(['latestPrices'], []);
    const stored = (key: string) => persistOptions.dehydrateOptions.shouldDehydrateQuery(appQueryClient.getQueryCache().find({ queryKey: [key] })!);
    expect(stored('latestPrices')).toBe(true);
    expect(stored('sharedPrices')).toBe(false);
  });

  it('confirmar uma nota busca de novo os preços de outras casas', async () => {
    // gcTime sem fim: a mutação não deixa um relógio de 5 minutos segurando o Jest depois do teste.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
    const invalidated = jest.spyOn(queryClient, 'invalidateQueries');
    let confirm: ReturnType<typeof useConfirmReceipt> | undefined;
    const renderer = await mount(
      function Probe() {
        confirm = useConfirmReceipt('r1');
        return null;
      },
      queryClient,
      () => confirm !== undefined,
    );
    await act(async () => {
      await confirm!.mutateAsync([]);
    });
    expect(mockRpc.called).toEqual(['confirm_receipt']);
    const keys = invalidated.mock.calls.map(([filters]) => (filters as { queryKey: string[] }).queryKey[0]);
    expect(keys).toContain('sharedPrices');
    // A nota do QR code pode ter criado um mercado: é pelo nome dele que a casa reconhece "os seus mercados".
    expect(keys).toContain('stores');
    // E tudo o que já buscava de novo continua lá.
    expect(keys).toEqual(expect.arrayContaining(['receipts', 'receipt', 'products', 'latestPrices', 'priceHistory', 'pantry', 'spending', 'purchaseRecords', 'lists', 'listItems', 'listLinks']));
    await act(async () => renderer.unmount());
    queryClient.clear();
  });
});
