import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { SHARING_ABOUT, type SharedPrice } from '@/domain/sharedPrices';
import { SharedPricesAbout } from '@/features/SharedPrices';
import { persistOptions, queryClient as appQueryClient } from '@/lib/queryClient';

import { useConfirmReceipt, useDeleteReceipt, useFillReceiptItemValue } from '../receipts';
import { fetchSharedPrices, fetchSharedPricesAvailable, useSharedPrices, useSharedPricesAvailable } from '../sharedPrices';

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
// O cartão da aba Família de verdade: os desenhos animados (reanimated), o fundo e as imagens não entram aqui.
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/lib/supabase', () => {
  // Apagar a nota e dar valor ao item: uma consulta encadeada que, esperada, responde que gravou uma linha.
  const write = (): unknown =>
    new Proxy(
      {},
      {
        get: (_target, method: string) =>
          method === 'then' ? (resolve: (value: unknown) => void) => resolve({ data: [{ id: 'i1' }], error: null }) : () => write(),
      },
    );
  return {
    supabase: {
      from: (table: string) => {
        mockRpc.called.push(`from ${table}`);
        return write();
      },
      storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) },
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
  };
});

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

describe('preços de outras casas', () => {
  /** As respostas de "a função ainda não existe no banco". */
  const MISSING: [string, unknown][] = [
    ['PostgREST, fora do cache de esquema', notInCache],
    ['Postgres, a função não existe', noFunction],
    // Um intermediário trocou a resposta: vale o texto, e só o desta função.
    ['sem código, com o texto desta função', { message: notInCache.message }],
  ];
  /** Os outros erros, que sobem. */
  const OTHER: [string, unknown][] = [
    ['sem rede', offline],
    ['sem permissão', { code: '42501', message: 'permission denied for function shared_latest_prices' }],
    ['tabela que não existe', { code: 'PGRST205', message: "Could not find the table 'public.x' in the schema cache" }],
    // A função existe e falhou por dentro, ao chamar outra que não existe: é erro, não "não disponível".
    ['42883 de outra função, saído de dentro desta', { code: '42883', message: 'function public.normalize(text, unknown) does not exist' }],
    ['sem código, com o texto de outra função', { message: 'Could not find the function public.outra_funcao without parameters in the schema cache' }],
  ];

  it.each(MISSING)('sem a função no banco (%s): "não disponível" (null), sem erro', async (_case, error) => {
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

  it('mais de mil: depois da primeira página cheia, as seguintes de três em três, juntas até a primeira incompleta', async () => {
    const { db, asked } = fakeDb(Array.from({ length: 2300 }, (_, n) => price(n)));
    const rows = await fetchSharedPrices(db);
    expect(rows).toHaveLength(2300);
    expect(rows?.map((row) => row.product_id)).toEqual(Array.from({ length: 2300 }, (_, n) => price(n).product_id));
    expect(asked.map((request) => request.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [3000, 3999],
    ]);
  });

  it('com a primeira página incompleta, um pedido só', async () => {
    const { db, asked } = fakeDb(Array.from({ length: 999 }, (_, n) => price(n)));
    await expect(fetchSharedPrices(db)).resolves.toHaveLength(999);
    expect(asked).toHaveLength(1);
  });

  it('para em dez páginas: são dicas, o que veio já basta', async () => {
    const { db, asked } = fakeDb(Array.from({ length: 12_000 }, (_, n) => price(n)));
    await expect(fetchSharedPrices(db)).resolves.toHaveLength(10_000);
    expect(asked).toHaveLength(10);
  });

  it.each(OTHER)('outro erro sobe (%s): a tela só deixa de mostrar a seção', async (_case, error) => {
    await expect(fetchSharedPrices(fakeDb([], error).db)).rejects.toBe(error);
  });
});

describe('o compartilhamento existe neste banco? (o cartão da aba Família)', () => {
  /** Um banco de mentira que só responde a pergunta e guarda o nome de cada função chamada. */
  function askingDb(answer: { data: unknown; error: unknown }) {
    const asked: string[] = [];
    const db = {
      rpc: async (name: string) => {
        asked.push(name);
        return answer;
      },
    };
    return { db: db as unknown as SupabaseClient, asked };
  }
  const probeNotInCache = { code: 'PGRST202', message: 'Could not find the function public.shared_prices_available without parameters in the schema cache' };
  const probeNoFunction = { code: '42883', message: 'function public.shared_prices_available() does not exist' };

  it.each<[string, unknown]>([
    ['PostgREST, fora do cache de esquema', probeNotInCache],
    ['Postgres, a função não existe', probeNoFunction],
  ])('sem a função no banco (%s): não (false), sem erro', async (_case, error) => {
    const { db, asked } = askingDb({ data: null, error });
    await expect(fetchSharedPricesAvailable(db)).resolves.toBe(false);
    expect(asked).toEqual(['shared_prices_available']);
  });

  it('com a função: sim, perguntando só a ela, nunca à função dos preços', async () => {
    const { db, asked } = askingDb({ data: true, error: null });
    await expect(fetchSharedPricesAvailable(db)).resolves.toBe(true);
    expect(asked).toEqual(['shared_prices_available']);
  });

  it.each<[string, unknown]>([
    ['sem rede', offline],
    ['42883 de outra função, saído de dentro desta', { code: '42883', message: 'function public.normalize(text, unknown) does not exist' }],
  ])('outro erro sobe (%s): o cartão só deixa de aparecer', async (_case, error) => {
    await expect(fetchSharedPricesAvailable(askingDb({ data: null, error }).db)).rejects.toBe(error);
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
    appQueryClient.setQueryData(['sharedPricesAvailable'], true);
    appQueryClient.setQueryData(['latestPrices'], []);
    const stored = (key: string) => persistOptions.dehydrateOptions.shouldDehydrateQuery(appQueryClient.getQueryCache().find({ queryKey: [key] })!);
    expect(stored('latestPrices')).toBe(true);
    expect(stored('sharedPrices')).toBe(false);
    // A pergunta do cartão também não: aberto de novo, o app pergunta outra vez.
    expect(stored('sharedPricesAvailable')).toBe(false);
  });

  it('a pergunta do cartão fica na chave sharedPricesAvailable; sem a função, não', async () => {
    for (const [answer, expected] of [
      [{ data: true, error: null }, true],
      [{ data: null, error: notInCache }, false],
    ] as const) {
      mockRpc.answer = () => answer;
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
      const seen: unknown[] = [];
      const renderer = await mount(
        function Probe() {
          seen.push(useSharedPricesAvailable().data);
          return null;
        },
        queryClient,
        () => seen.at(-1) !== undefined,
      );
      expect(seen.at(-1)).toBe(expected);
      expect(queryClient.getQueryData(['sharedPricesAvailable'])).toBe(expected);
      await act(async () => renderer.unmount());
      queryClient.clear();
    }
    expect(mockRpc.called).toEqual(['shared_prices_available', 'shared_prices_available']);
  });

  it('o cartão da aba Família, sozinho na tela, só pergunta: nunca busca os preços', async () => {
    mockRpc.answer = (name) => (name === 'shared_prices_available' ? { data: true, error: null } : { data: [price(1)], error: null });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <SharedPricesAbout />
        </QueryClientProvider>,
      );
    });
    const page = () => JSON.stringify(renderer!.toJSON());
    for (let turn = 0; turn < 20 && !page().includes(SHARING_ABOUT); turn++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(page()).toContain(SHARING_ABOUT);
    expect(mockRpc.called).toEqual(['shared_prices_available']);
    expect(queryClient.getQueryCache().find({ queryKey: ['sharedPrices'] })).toBeUndefined();
    await act(async () => renderer!.unmount());
    queryClient.clear();
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

  it('apagar uma nota confirmada e dar valor ao item dela também buscam de novo os preços de outras casas', async () => {
    // A compra da casa esconde a linha de fora daquele mercado (e a casa sem nota confirmada não vê nenhuma):
    // tirar a nota pode trazer uma linha de volta, e dar valor ao item pode esconder uma.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
    const invalidated = jest.spyOn(queryClient, 'invalidateQueries');
    let remove: ReturnType<typeof useDeleteReceipt> | undefined;
    let fill: ReturnType<typeof useFillReceiptItemValue> | undefined;
    const renderer = await mount(
      function Probe() {
        remove = useDeleteReceipt('r1');
        fill = useFillReceiptItemValue('r1');
        return null;
      },
      queryClient,
      () => remove !== undefined && fill !== undefined,
    );
    const keys = () => invalidated.mock.calls.map(([filters]) => (filters as { queryKey: string[] }).queryKey[0]);

    await act(async () => {
      await remove!.mutateAsync([]);
    });
    expect(keys()).toContain('sharedPrices');

    invalidated.mockClear();
    await act(async () => {
      await fill!.mutateAsync({ id: 'i1', values: { unit_price: 5, total_price: 5 } });
    });
    expect(keys()).toContain('sharedPrices');
    expect(mockRpc.called).toEqual(['from receipts', 'from receipt_items']);
    await act(async () => renderer.unmount());
    queryClient.clear();
  });
});
