import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { openSearchPlan, type OpenGroup, type OpenSearchItem } from '@/domain/openPrices';
import { SHARING_ABOUT, SHARING_SUMMARY, SHARING_TITLE, type SharedPrice } from '@/domain/sharedPrices';
import { SharedPricesAbout } from '@/features/SharedPrices';
import { persistOptions, queryClient as appQueryClient } from '@/lib/queryClient';

import { useConfirmReceipt, useDeleteReceipt, useFillReceiptItemValue } from '../receipts';
import { MERGE_REFRESHES } from '../productMerge';
import {
  fetchSharedItemKeys,
  fetchSharedItemPrices,
  fetchSharedPrices,
  fetchSharedPricesAvailable,
  useOpenSharedPrices,
  useSharedPrices,
  useSharedPricesAvailable,
  type OpenSharedPrices,
} from '../sharedPrices';

// "mock" no nome: o jest.mock só enxerga variáveis assim. O que o banco de mentira responde a cada função.
const mockRpc: {
  answer: (name: string, args?: unknown) => { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>;
  called: string[];
  args: unknown[];
} = {
  answer: () => ({ data: null, error: null }),
  called: [],
  args: [],
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
// O cartão de Configurações → Sobre o Kotii de verdade: os desenhos animados (reanimated), o fundo e as imagens não entram aqui.
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
      rpc: (name: string, args?: unknown) => {
        mockRpc.called.push(name);
        mockRpc.args.push(args);
        const result = mockRpc.answer(name, args);
        // Com .order().range() (os preços de outras casas) ou direto (confirmar a nota).
        const query = {
          order: () => query,
          range: async () => result,
          then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => Promise.resolve(result).then(resolve, reject),
        };
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
  // A segunda-feira da semana da compra: o banco da lista aberta nunca devolve o dia.
  seen_on: '2026-10-05',
  mine: n % 2 === 0,
});

/** Como a busca devolve a linha da função de antes do tamanho da embalagem: os três campos como "não se sabe". */
const unsized = (row: SharedPrice): SharedPrice => ({ ...row, pack_unit: null, pack_amount: null, pack_of: null });

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
  mockRpc.args = [];
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

  it('o banco de antes da lista aberta ainda devolve o dia: o app fica com a segunda-feira da semana dele', async () => {
    const { db } = fakeDb([{ ...price(1), seen_on: '2026-10-10' }, { ...price(2), seen_on: '2026-10-11' }, { ...price(3), seen_on: '2026-10-12' }]);
    expect((await fetchSharedPrices(db))?.map((row) => row.seen_on)).toEqual(['2026-10-05', '2026-10-05', '2026-10-12']);
  });

  it('com a função e nada para a casa: lista vazia, que não é o mesmo que "não disponível"', async () => {
    await expect(fetchSharedPrices(fakeDb([]).db)).resolves.toEqual([]);
  });

  it('lê pela função, nunca pelas tabelas, na ordem da chave da resposta', async () => {
    const { db, asked } = fakeDb([price(1), price(2)]);
    await expect(fetchSharedPrices(db)).resolves.toEqual([unsized(price(1)), unsized(price(2))]);
    expect(asked).toEqual([{ name: 'shared_latest_prices', order: ['product_id', 'store_cnpj', 'unit'], range: [0, 999] }]);
  });

  it('o preço chega como número, mesmo que o banco mande texto', async () => {
    const rows = await fetchSharedPrices(fakeDb([{ ...price(1), unit_price: '21.9000' }]).db);
    expect(rows?.[0].unit_price).toBe(21.9);
  });

  it('o tamanho da embalagem chega como número (numeric e smallint do banco), e a função de antes dele dá "não se sabe"', async () => {
    const rows = await fetchSharedPrices(
      fakeDb([
        { ...price(1), pack_unit: 'l', pack_amount: '4.200000', pack_of: 12 },
        { ...price(2), pack_unit: 'un', pack_amount: 30, pack_of: null },
        { ...price(3), pack_unit: null, pack_amount: null, pack_of: null },
        price(4),
      ]).db,
    );
    expect(rows?.map((row) => [row.pack_unit, row.pack_amount, row.pack_of])).toEqual([
      ['l', 4.2, 12],
      ['un', 30, null],
      [null, null, null],
      [null, null, null],
    ]);
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

describe('o compartilhamento existe neste banco? (o cartão de Configurações → Sobre o Kotii)', () => {
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
      [{ data: [price(1)], error: null }, [unsized(price(1))]],
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

  it('o cartão de Configurações, sozinho na tela, só pergunta: nunca busca os preços, nem aberto', async () => {
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
    for (let turn = 0; turn < 20 && !page().includes(SHARING_SUMMARY); turn++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(page()).toContain(SHARING_SUMMARY);
    // Aberto (o texto inteiro vem ao tocar na linha), continua sem buscar os preços.
    const row = renderer!.root.findAll((node) => node.props.title === SHARING_TITLE && typeof node.props.onPress === 'function')[0];
    await act(async () => row.props.onPress());
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
    // Os apelidos novos ensinam as abreviações dos mercados da casa (data/learnedAbbreviations).
    expect(keys).toContain('productAliases');
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

describe('a base aberta (shared_item_keys e shared_item_prices)', () => {
  const STORES = [{ id: 'meu', cnpj: '11222333000181', name: 'Atacadão da esquina' }];
  const arroz: OpenSearchItem = { id: 'a', name: 'Arroz', category: 'graos', quantity: 1, unit: 'un' };
  const leite: OpenSearchItem = { id: 'l', name: 'Leite', category: 'laticinios', quantity: 1, unit: 'un' };
  /** Um banco de mentira para os dois passos: guarda o que recebeu e responde o combinado. */
  function openDb(answer: { data: unknown; error: unknown }) {
    const asked: { name: string; args: unknown }[] = [];
    const db = {
      rpc: async (name: string, args: unknown) => {
        asked.push({ name, args });
        return answer;
      },
    };
    return { db: db as unknown as SupabaseClient, asked };
  }
  const GROUP: OpenGroup = { signature: 'ARROZ CAMIL 5KG', keys: ['ARROZ CAMIL 5KG'], expected: { unit: 'kg', amount: 5, label: '5 kg' }, items: [] };

  it.each<[string, string, unknown]>([
    ['shared_item_keys', 'PostgREST, fora do cache de esquema', { code: 'PGRST202', message: 'Could not find the function public.shared_item_keys(p_items) in the schema cache' }],
    ['shared_item_keys', 'Postgres, a função não existe', { code: '42883', message: 'function public.shared_item_keys(jsonb) does not exist' }],
    ['shared_item_prices', 'PostgREST, fora do cache de esquema', { code: 'PGRST202', message: 'Could not find the function public.shared_item_prices(p_groups) in the schema cache' }],
    ['shared_item_prices', 'Postgres, a função não existe', { code: '42883', message: 'function public.shared_item_prices(jsonb) does not exist' }],
  ])('sem %s no banco (%s): null, sem erro', async (name, _case, error) => {
    const { db } = openDb({ data: null, error });
    const entries = openSearchPlan([arroz]).calls[0];
    await expect(name === 'shared_item_keys' ? fetchSharedItemKeys(entries, db) : fetchSharedItemPrices([GROUP], db)).resolves.toBeNull();
  });

  it('o que vai a cada função: as palavras de cada busca, e as chaves e o tamanho de cada grupo', async () => {
    const entries = openSearchPlan([arroz]).calls[0];
    const keys = openDb({ data: [{ k: [['ARROZ CAMIL 5KG', 'un', '2026-11-09', 2]], more: false }], error: null });
    await expect(fetchSharedItemKeys(entries, keys.db)).resolves.toEqual({
      entries: [entries[0].signature],
      keys: [[{ key: 'ARROZ CAMIL 5KG', unit: 'un', week: '2026-11-09', seen: 2 }]],
      more: [false],
    });
    expect(keys.asked).toEqual([{ name: 'shared_item_keys', args: { p_items: [{ f: ['ARROZ', 'ARROZES', 'ARROZS'], s: ['ARROZ', 'ARROZES', 'ARROZS'], x: [] }] } }]);
    const prices = openDb({ data: [[0, '11222333000181', 'ATACADAO', '35', 'un', 22.9, '2026-11-12', true]], error: null });
    await expect(fetchSharedItemPrices([GROUP], prices.db)).resolves.toEqual({
      groups: ['ARROZ CAMIL 5KG'],
      // Um banco que devolvesse o dia: a segunda-feira dele.
      rows: [expect.objectContaining({ group: 0, unit_price: 22.9, seen_on: '2026-11-09', mine: true })],
    });
    expect(prices.asked).toEqual([{ name: 'shared_item_prices', args: { p_groups: [{ k: ['ARROZ CAMIL 5KG'], p: { u: 'kg', a: 5 } }] } }]);
  });

  it('uma resposta do passo 1 com outro número de buscas é erro (a busca tenta de novo), nunca meia resposta', async () => {
    const entries = openSearchPlan([arroz, leite]).calls[0];
    await expect(fetchSharedItemKeys(entries, openDb({ data: [{ k: [], more: false }], error: null }).db)).rejects.toThrow();
    // Outro erro sobe.
    await expect(fetchSharedItemKeys(entries, openDb({ data: null, error: offline }).db)).rejects.toBe(offline);
  });

  /** O banco de mentira do app: o passo 1 dá a cada busca as chaves do item dela; o passo 2, um preço por grupo. */
  const answering = (name: string, args?: unknown) => {
    if (name === 'shared_item_keys') {
      const items = (args as { p_items: { f: string[] }[] }).p_items;
      return {
        data: items.map((entry) => ({ k: entry.f.includes('ARROZ') ? [['ARROZ CAMIL 5KG', 'un', '2026-11-09', 2]] : [['LEITE INT ITALAC 1L', 'un', '2026-11-09', 1]], more: false })),
        error: null,
      };
    }
    const groups = (args as { p_groups: unknown[] }).p_groups;
    return { data: groups.map((_, g) => [g, '11222333000181', 'ATACADAO', '35', 'un', 20 + g, '2026-11-09', true]), error: null };
  };

  /** Monta o gancho com estes itens (que mudam com `set`) e espera as buscas. */
  async function hook(queryClient: QueryClient, first: OpenSearchItem[] | null) {
    const seen: OpenSharedPrices[] = [];
    let set: (items: OpenSearchItem[] | null) => void = () => undefined;
    function Probe() {
      const [items, setItems] = useState(first);
      set = setItems;
      seen.push(useOpenSharedPrices(items, STORES));
      return null;
    }
    const renderer = await mount(Probe, queryClient, () => false);
    const change = async (items: OpenSearchItem[] | null) => {
      await act(async () => set(items));
      for (let turn = 0; turn < 20; turn++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    };
    return { seen, renderer, change };
  }
  const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

  it('uma chamada de cada passo para a lista toda; a lista que não sabe os itens (null) não pede nada', async () => {
    mockRpc.answer = answering;
    const queryClient = newClient();
    const { seen, renderer, change } = await hook(queryClient, null);
    expect(mockRpc.called).toEqual([]);
    expect(seen.at(-1)?.waiting).toBe(false);
    await change([arroz, leite]);
    expect(mockRpc.called).toEqual(['shared_item_keys', 'shared_item_prices']);
    expect([...seen.at(-1)!.quotes.keys()].sort()).toEqual(['a', 'l']);
    expect(seen.at(-1)!.quotes.get('a')?.[0]).toMatchObject({ storeId: 'meu', productId: null, open: { size: '5 kg', sizeBy: 'only' } });
    // A lista que muda sem mudar as buscas (outra ordem) não pede de novo.
    await change([leite, arroz]);
    expect(mockRpc.called).toEqual(['shared_item_keys', 'shared_item_prices']);
    await act(async () => renderer.unmount());
    queryClient.clear();
  });

  it('duas listas com o mesmo item, uma depois da outra: as duas com preço, e a segunda sem pedido nenhum', async () => {
    mockRpc.answer = answering;
    const queryClient = newClient();
    const first = await hook(queryClient, [arroz]);
    expect(first.seen.at(-1)!.quotes.get('a')).toHaveLength(1);
    await act(async () => first.renderer.unmount());
    const calls = [...mockRpc.called];
    const second = await hook(queryClient, [{ ...arroz, id: 'outro-arroz' }]);
    expect(second.seen.at(-1)!.quotes.get('outro-arroz')).toEqual([expect.objectContaining({ unitPrice: 20 })]);
    expect(mockRpc.called).toEqual(calls);
    await act(async () => second.renderer.unmount());
    queryClient.clear();
  });

  it('`waiting` só na primeira busca a caminho: um erro, sem internet ou a função que não existe não esperam', async () => {
    let release: (value: { data: unknown; error: unknown }) => void = () => undefined;
    mockRpc.answer = () => new Promise((resolve) => (release = resolve));
    const queryClient = newClient();
    const { seen, renderer } = await hook(queryClient, [arroz]);
    expect(seen.at(-1)?.waiting).toBe(true);
    await act(async () => release({ data: null, error: offline }));
    for (let turn = 0; turn < 10; turn++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(seen.at(-1)?.waiting).toBe(false);
    await act(async () => renderer.unmount());
    queryClient.clear();

    mockRpc.answer = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.shared_item_keys' } });
    const missingClient = newClient();
    const missing = await hook(missingClient, [arroz]);
    expect(missing.seen.at(-1)).toMatchObject({ waiting: false });
    expect(missing.seen.at(-1)!.quotes.size).toBe(0);
    await act(async () => missing.renderer.unmount());
    missingClient.clear();

    // Sem internet, a busca fica parada (não "a caminho").
    const offlineNow = jest.spyOn(onlineManager, 'isOnline').mockReturnValue(false);
    mockRpc.called = [];
    const pausedClient = newClient();
    const paused = await hook(pausedClient, [arroz]);
    expect(pausedClient.getQueryCache().findAll({ queryKey: ['sharedPrices', 'open'] }).map((query) => query.state.fetchStatus)).toEqual(['paused']);
    expect(paused.seen.at(-1)?.waiting).toBe(false);
    expect(mockRpc.called).toEqual([]);
    await act(async () => paused.renderer.unmount());
    pausedClient.clear();
    offlineNow.mockRestore();
  });

  it('fora do cache guardado no aparelho, e nas invalidações dos preços de outras casas (o prefixo)', async () => {
    appQueryClient.setQueryData(['sharedPrices', 'open', 'keys', ['x']], null);
    appQueryClient.setQueryData(['sharedPrices', 'open', 'prices', ['x']], null);
    for (const kind of ['keys', 'prices']) {
      const query = appQueryClient.getQueryCache().find({ queryKey: ['sharedPrices', 'open', kind, ['x']] })!;
      expect(persistOptions.dehydrateOptions.shouldDehydrateQuery(query)).toBe(false);
    }
    // Confirmar uma nota, os nomes dos mercados e juntar produtos invalidam pelo prefixo 'sharedPrices'.
    expect(MERGE_REFRESHES).toContain('sharedPrices');
    await appQueryClient.invalidateQueries({ queryKey: ['sharedPrices'] });
    expect(appQueryClient.getQueryState(['sharedPrices', 'open', 'keys', ['x']])?.isInvalidated).toBe(true);
    expect(appQueryClient.getQueryState(['sharedPrices', 'open', 'prices', ['x']])?.isInvalidated).toBe(true);
  });
});
