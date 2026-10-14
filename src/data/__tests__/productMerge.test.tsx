import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import {
  MERGE_BLOCKED,
  MERGE_NO_ANSWER,
  MERGE_NO_ANSWER_TITLE,
  MERGE_PRODUCT_GONE,
  MERGE_RENAMED,
  MERGE_RENAMED_TITLE,
  MERGE_UNAVAILABLE,
  MERGE_UNAVAILABLE_TITLE,
  type DistinctPair,
} from '@/domain/productMerge';

import { useRenameProduct } from '../market';
import {
  fetchDistinctPairs,
  fetchMergeFacts,
  fetchPurchaseCounts,
  MERGE_REFRESHES,
  MERGE_TIMEOUT_MS,
  mergeErrorNotice,
  useMarkDistinct,
  useMergeProducts,
  usePurchaseCounts,
} from '../productMerge';
import { useConfirmReceipt } from '../receipts';

interface Line {
  id: string;
  product_id: string;
  status: 'confirmed' | 'draft';
}

/** Um pedido de leitura como chegou ao servidor: com `range` (uma página) ou inteiro, até o `limit`. */
interface Asked {
  table: string;
  columns: string;
  filters: Record<string, unknown>;
  order: string[];
  range?: [number, number];
  limit?: number;
  count?: string;
}

// "mock" no nome: o jest.mock só enxerga variáveis assim. O banco de mentira, como o servidor o serve.
const mockDb = {
  pairs: [] as DistinctPair[],
  lines: [] as Line[],
  products: [] as { id: string; name: string; category: string; shelf_life_days: number | null }[],
  /** A view dos últimos preços: uma linha por produto, mercado e unidade. */
  prices: [] as { product_id: string; store_id: string; unit: string; unit_price: number; purchased_at: string }[],
  stores: [] as { id: string; name: string }[],
  pantry: [] as { product_id: string; consumed_at: string | null }[],
  /** Itens de lista, com a data em que a lista deles foi arquivada. */
  listItems: [] as { product_id: string; archived_at: string | null }[],
  /** O teto de linhas por pedido (max_rows do Supabase). */
  cap: 1000,
  /** O erro que a próxima leitura ou gravação devolve. */
  error: null as object | null,
  /** O erro que só as leituras de uma tabela devolvem. */
  tableErrors: {} as Record<string, object>,
  /** O servidor responde sem a contagem, mesmo pedida. */
  noCount: false,
  asked: [] as Asked[],
  inserted: [] as { table: string; row: unknown }[],
  rpcs: [] as { name: string; args: unknown }[],
  rpcReply: { data: null as unknown, error: null as object | null },
  /** As respostas dos próximos pedidos, na ordem; acabando, vale `rpcReply`. */
  rpcReplies: [] as { data: unknown; error: object | null }[],
  /** O pedido fica sem resposta: só o corte dele (o sinal) termina a espera. */
  hold: false,
  /** O sinal de corte que cada pedido recebeu. */
  signals: [] as AbortSignal[],
};

jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/lib/session', () => ({ endSessionIfGone: async () => false }));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string, options?: { count?: string }) => {
        const filters: Record<string, unknown> = {};
        const order: string[] = [];
        let limit: number | undefined;
        const among = (filter: string) => (filters[filter] as string[] | undefined) ?? [];
        // As linhas que o banco tem para este pedido, com os filtros que ele trouxe (só eles).
        const found = (): object[] => {
          switch (table) {
            case 'product_distinct_pairs':
              return mockDb.pairs;
            case 'products':
              return mockDb.products.filter((product) => among('in id').includes(product.id));
            case 'latest_prices':
              return mockDb.prices.filter((price) => among('in product_id').includes(price.product_id));
            case 'stores':
              return mockDb.stores.filter((store) => among('in id').includes(store.id));
            case 'pantry_items':
              return mockDb.pantry
                .filter((item) => item.product_id === filters['eq product_id'] && (!('is consumed_at' in filters) || item.consumed_at === null))
                .map((item) => ({ product_id: item.product_id }));
            case 'shopping_list_items':
              return mockDb.listItems
                .filter((item) => item.product_id === filters['eq product_id'] && (!('is list.archived_at' in filters) || item.archived_at === null))
                .map((item) => ({ product_id: item.product_id, list: { id: 'l1' } }));
            default:
              return mockDb.lines
                .filter((line) => line.status === filters['eq receipt.status'] && among('in product_id').includes(line.product_id))
                .sort((a, b) => (a.id < b.id ? -1 : 1))
                .map((line) => ({ product_id: line.product_id, receipt: { status: line.status } }));
          }
        };
        const reply = (from: number, to: number) => {
          const failure = mockDb.error ?? mockDb.tableErrors[table];
          if (failure) return { data: null, error: failure, count: null };
          const rows = found();
          return {
            data: rows.slice(from, Math.min(to + 1, from + mockDb.cap)),
            error: null,
            count: options?.count === 'exact' && !mockDb.noCount ? rows.length : null,
          };
        };
        const query = {
          eq: (column: string, value: unknown) => {
            filters[`eq ${column}`] = value;
            return query;
          },
          in: (column: string, values: unknown[]) => {
            filters[`in ${column}`] = values;
            return query;
          },
          is: (column: string, value: unknown) => {
            filters[`is ${column}`] = value;
            return query;
          },
          order: (column: string) => {
            order.push(column);
            return query;
          },
          limit: (rows: number) => {
            limit = rows;
            return query;
          },
          range: async (from: number, to: number) => {
            mockDb.asked.push({ table, columns, filters: { ...filters }, order: [...order], range: [from, to] });
            return reply(from, to);
          },
          // Sem `range`: o pedido inteiro, até o `limit` dele ou o teto do servidor.
          then: (resolve: (answer: unknown) => unknown, reject: (error: unknown) => unknown) => {
            mockDb.asked.push({ table, columns, filters: { ...filters }, order: [...order], limit, count: options?.count });
            return Promise.resolve(reply(0, (limit ?? Infinity) - 1)).then(resolve, reject);
          },
        };
        return query;
      },
      insert: async (row: unknown) => {
        mockDb.inserted.push({ table, row });
        return { data: null, error: mockDb.error };
      },
      // A gravação pede a linha de volta (o produto existe).
      update: () => ({ eq: () => ({ select: async () => ({ data: [{ id: 'p1' }], error: null }) }) }),
    }),
    rpc: (name: string, args: unknown) => {
      mockDb.rpcs.push({ name, args });
      let signal: AbortSignal | undefined;
      const answer = () =>
        mockDb.hold
          ? // Cortado, o postgrest-js não lança: devolve este erro.
            new Promise((resolve) =>
              signal?.addEventListener('abort', () =>
                resolve({
                  data: null,
                  error: { message: 'AbortError: Aborted', details: '', hint: 'Request was aborted (timeout or manual cancellation)', code: '' },
                }),
              ),
            )
          : Promise.resolve(mockDb.rpcReplies.shift() ?? mockDb.rpcReply);
      const request = {
        abortSignal: (given: AbortSignal) => {
          signal = given;
          mockDb.signals.push(given);
          return request;
        },
        then: (resolve: (reply: unknown) => unknown, reject: (error: unknown) => unknown) => answer().then(resolve, reject),
      };
      return request;
    },
  },
  unwrap: (result: { data: unknown; error: unknown }) => {
    if (result.error) throw result.error;
    return result.data;
  },
  errorMessage: (error: { message?: string }) => error?.message ?? 'Algo deu errado. Tente novamente.',
}));

const notInCache = { code: 'PGRST205', message: "Could not find the table 'public.product_distinct_pairs' in the schema cache" };
const noFunction = { code: 'PGRST202', message: 'Could not find the function public.merge_products(p_keep, p_merge) in the schema cache' };
const gone = { code: 'P0002', message: 'product not found' };
const renamed = { code: 'NK008', message: 'product renamed' };
/** O que a confirmação manda: os dois produtos e os nomes que a pessoa leu. */
const PAIR = { keepId: 'keep', mergeId: 'gone', keepName: 'Arroz Tio João 5 kg', mergeName: 'Arroz 5kg' };
const SENT = { p_keep: 'keep', p_merge: 'gone', p_keep_name: 'Arroz Tio João 5 kg', p_merge_name: 'Arroz 5kg' };

let renderer: ReactTestRenderer | undefined;

/** Roda um hook de verdade dentro de um QueryClient; devolve o que ele deu por último e as chaves invalidadas. */
async function withHook<T>(useIt: () => T) {
  // Sem temporizador de limpeza do cache: o Jest não fica esperando por ele no fim.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: 0 } } });
  const invalidated: unknown[] = [];
  const invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = ((filters?: { queryKey?: readonly unknown[] }) => {
    invalidated.push(filters?.queryKey?.[0]);
    return invalidate(filters);
  }) as typeof client.invalidateQueries;
  const seen: { current: T | undefined } = { current: undefined };
  function Probe() {
    seen.current = useIt();
    return null;
  }
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  return { client, invalidated, value: () => seen.current as T };
}

const flush = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  jest.useRealTimers();
  Object.assign(mockDb, {
    pairs: [],
    lines: [],
    products: [],
    prices: [],
    stores: [],
    pantry: [],
    listItems: [],
    cap: 1000,
    error: null,
    tableErrors: {},
    noCount: false,
    asked: [],
    inserted: [],
    rpcs: [],
    rpcReply: { data: null, error: null },
    rpcReplies: [],
    hold: false,
    signals: [],
  });
});

describe('pares "São diferentes"', () => {
  it('lê todos, página por página, numa ordem que não empata', async () => {
    mockDb.pairs = Array.from({ length: 2300 }, (_, n) => ({ product_a: `a${n}`, product_b: `b${n}` }));
    expect(await fetchDistinctPairs()).toHaveLength(2300);
    expect(mockDb.asked.map((request) => request.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(mockDb.asked[0]).toMatchObject({ table: 'product_distinct_pairs', columns: 'product_a, product_b', order: ['product_a', 'product_b'] });
  });

  it('casa sem pares: lista vazia', async () => {
    expect(await fetchDistinctPairs()).toEqual([]);
  });

  it('banco ainda sem a tabela: null, e não um erro', async () => {
    mockDb.error = notInCache;
    expect(await fetchDistinctPairs()).toBeNull();
    mockDb.error = { code: '42P01', message: 'relation "public.product_distinct_pairs" does not exist' };
    expect(await fetchDistinctPairs()).toBeNull();
  });

  it('outro erro sobe: sem internet não é "a casa não recusou nenhum par"', async () => {
    mockDb.error = { message: 'TypeError: Network request failed' };
    await expect(fetchDistinctPairs()).rejects.toEqual(mockDb.error);
  });

  it('marcar grava o par com o id menor primeiro e já o põe na lista guardada', async () => {
    const hook = await withHook(() => useMarkDistinct());
    hook.client.setQueryData(['productDistinctPairs'], [{ product_a: 'a', product_b: 'b' }]);
    await act(async () => {
      await hook.value().mutateAsync({ a: 'p9', b: 'p1' });
    });
    expect(mockDb.inserted).toEqual([{ table: 'product_distinct_pairs', row: { product_a: 'p1', product_b: 'p9' } }]);
    expect(hook.client.getQueryData(['productDistinctPairs'])).toEqual([
      { product_a: 'a', product_b: 'b' },
      { product_a: 'p1', product_b: 'p9' },
    ]);
    expect(hook.invalidated).toEqual(['productDistinctPairs']);
  });

  it('par que outra pessoa da casa já marcou (23505) não é erro', async () => {
    mockDb.error = { code: '23505', message: 'duplicate key value violates unique constraint "product_distinct_pairs_pkey"' };
    const hook = await withHook(() => useMarkDistinct());
    await act(async () => {
      await expect(hook.value().mutateAsync({ a: 'p1', b: 'p9' })).resolves.toBeUndefined();
    });
  });

  it('produto que sumiu (23503): erro, e os produtos são buscados de novo', async () => {
    mockDb.error = { code: '23503', message: 'insert or update on table "product_distinct_pairs" violates foreign key constraint' };
    const hook = await withHook(() => useMarkDistinct());
    await act(async () => {
      await expect(hook.value().mutateAsync({ a: 'p1', b: 'p9' })).rejects.toEqual(mockDb.error);
    });
    expect(hook.invalidated).toEqual(['products']);
    expect(mergeErrorNotice(mockDb.error)).toEqual({ title: 'Erro', message: MERGE_PRODUCT_GONE });
  });
});

describe('compras de cada produto', () => {
  const lines = (productId: string, count: number, status: Line['status'] = 'confirmed'): Line[] =>
    Array.from({ length: count }, (_, n) => ({ id: `${productId}-${status}-${String(n).padStart(5, '0')}`, product_id: productId, status }));

  it('conta as linhas de notas confirmadas; rascunho não conta e produto sem compra vem com zero', async () => {
    mockDb.lines = [...lines('arroz', 12), ...lines('arroz', 2, 'draft'), ...lines('feijao', 1), ...lines('outro', 5)];
    expect(await fetchPurchaseCounts(['arroz', 'feijao', 'sal'])).toEqual({ arroz: 12, feijao: 1, sal: 0 });
    expect(mockDb.asked).toEqual([
      {
        table: 'receipt_items',
        columns: 'product_id, receipt:receipts!inner(status)',
        filters: { 'eq receipt.status': 'confirmed', 'in product_id': ['arroz', 'feijao', 'sal'] },
        order: ['id'],
        range: [0, 999],
      },
    ]);
  });

  it('mais de mil linhas: página por página, sem perder nem repetir', async () => {
    mockDb.lines = [...lines('arroz', 1500), ...lines('feijao', 700)];
    expect(await fetchPurchaseCounts(['arroz', 'feijao'])).toEqual({ arroz: 1500, feijao: 700 });
    expect(mockDb.asked.map((request) => request.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('muitos produtos vão em pedidos de 100 ids', async () => {
    const ids = Array.from({ length: 230 }, (_, n) => `p${n}`);
    mockDb.lines = ids.flatMap((id) => lines(id, 1));
    const counts = await fetchPurchaseCounts(ids);
    expect(Object.values(counts).every((count) => count === 1)).toBe(true);
    expect(mockDb.asked.map((request) => (request.filters['in product_id'] as string[]).length)).toEqual([100, 100, 30]);
  });

  it('nenhum produto: nenhum pedido', async () => {
    expect(await fetchPurchaseCounts([])).toEqual({});
    const hook = await withHook(() => usePurchaseCounts([]));
    await flush();
    expect(hook.value().fetchStatus).toBe('idle');
    expect(mockDb.asked).toEqual([]);
  });

  it('a mesma lista de produtos, em qualquer ordem, é uma busca só, na chave que as notas atualizam', async () => {
    mockDb.lines = lines('arroz', 3);
    const hook = await withHook(() => [usePurchaseCounts(['feijao', 'arroz']), usePurchaseCounts(['arroz', 'feijao', 'arroz'])]);
    await flush();
    expect(hook.value().map((query) => query.data)).toEqual([
      { arroz: 3, feijao: 0 },
      { arroz: 3, feijao: 0 },
    ]);
    expect(mockDb.asked).toHaveLength(1);
    expect(hook.client.getQueryCache().getAll().map((query) => query.queryKey)).toEqual([['priceHistory', 'counts', ['arroz', 'feijao']]]);
  });

  it('erro numa página sobe: nunca uma contagem pela metade', async () => {
    mockDb.error = { message: 'sem permissão' };
    await expect(fetchPurchaseCounts(['arroz'])).rejects.toEqual(mockDb.error);
  });
});

// A confirmação de juntar não tem volta: o que ela mostra vem de uma leitura só, feita só sobre os dois
// produtos, em que nenhuma parte pode vir cortada pelo teto do servidor sem a leitura falhar.
describe('o que a confirmação de juntar lê dos dois produtos', () => {
  const ARROZ = { id: 'arroz', name: 'Arroz 5kg', category: 'mercearia', shelf_life_days: 90 };
  const ARROZ_TJ = { id: 'arroz-tj', name: 'Arroz Tio João 5 kg', category: 'graos', shelf_life_days: null };
  const FEIJAO = { id: 'feijao', name: 'Feijão carioca', category: 'graos', shelf_life_days: null };
  const price = (product_id: string, store_id: string, unit_price: number, day: string, unit = 'un') => ({
    product_id,
    store_id,
    unit,
    unit_price,
    purchased_at: `2026-${day}T12:00:00-03:00`,
  });
  const lines = (productId: string, count: number, status: Line['status'] = 'confirmed'): Line[] =>
    Array.from({ length: count }, (_, n) => ({ id: `${productId}-${status}-${n}`, product_id: productId, status }));
  const askedOf = (table: string) => mockDb.asked.filter((request) => request.table === table);
  const noFacts = { purchases: 0, lastPrice: null, inPantry: false, onList: false, units: [] };

  beforeEach(() => {
    // A casa tem mais do que os dois produtos: nada do terceiro pode entrar na leitura.
    mockDb.products = [ARROZ, ARROZ_TJ, FEIJAO];
    mockDb.lines = [...lines(ARROZ.id, 2), ...lines(ARROZ.id, 1, 'draft'), ...lines(ARROZ_TJ.id, 12), ...lines(FEIJAO.id, 3)];
    mockDb.prices = [
      price(ARROZ_TJ.id, 's-assai', 25.9, '10-10'),
      price(ARROZ_TJ.id, 's-bom', 27.5, '09-20'),
      price(ARROZ.id, 's-bom', 24.9, '10-05'),
      price(FEIJAO.id, 's-feira', 8, '10-12', 'kg'),
    ];
    mockDb.stores = [
      { id: 's-assai', name: 'Assaí' },
      { id: 's-bom', name: 'Mercado Bom' },
      { id: 's-feira', name: 'Feira' },
    ];
    mockDb.pantry = [
      { product_id: ARROZ.id, consumed_at: null },
      { product_id: FEIJAO.id, consumed_at: null },
    ];
    mockDb.listItems = [
      { product_id: ARROZ.id, archived_at: null },
      { product_id: FEIJAO.id, archived_at: null },
    ];
  });

  it('os dois produtos como estão no banco agora e o que o app sabe de cada um', async () => {
    expect(await fetchMergeFacts(ARROZ.id, ARROZ_TJ.id)).toEqual({
      products: { [ARROZ.id]: ARROZ, [ARROZ_TJ.id]: ARROZ_TJ },
      facts: {
        [ARROZ.id]: { purchases: 2, lastPrice: { unitPrice: 24.9, unit: 'un', store: 'Mercado Bom', on: '2026-10-05' }, inPantry: true, onList: true, units: ['un'] },
        [ARROZ_TJ.id]: { purchases: 12, lastPrice: { unitPrice: 25.9, unit: 'un', store: 'Assaí', on: '2026-10-10' }, inPantry: false, onList: false, units: ['un'] },
      },
    });
  });

  it('cada parte é pedida só para os dois, com os filtros das listas da casa, e nenhuma lista inteira da casa é lida', async () => {
    await fetchMergeFacts(ARROZ.id, ARROZ_TJ.id);
    const both = [ARROZ.id, ARROZ_TJ.id];
    // Os produtos: as duas linhas, com tudo o que a confirmação mostra deles.
    expect(askedOf('products')).toEqual([{ table: 'products', columns: 'id, name, category, shelf_life_days', filters: { 'in id': both }, order: [] }]);
    // As compras: a contagem de sempre (linhas de notas confirmadas), página por página.
    expect(askedOf('receipt_items')).toEqual([
      {
        table: 'receipt_items',
        columns: 'product_id, receipt:receipts!inner(status)',
        filters: { 'eq receipt.status': 'confirmed', 'in product_id': both },
        order: ['id'],
        range: [0, 999],
      },
    ]);
    // Os últimos preços, com a contagem do servidor: é ela que prova que vieram todos.
    expect(askedOf('latest_prices')).toEqual([
      { table: 'latest_prices', columns: 'product_id, store_id, unit, unit_price, purchased_at', filters: { 'in product_id': both }, order: [], count: 'exact' },
    ]);
    // Despensa: existe item aberto deste produto? O filtro é o da despensa da casa (o que não foi consumido).
    expect(askedOf('pantry_items')).toEqual(
      both.map((id) => ({ table: 'pantry_items', columns: 'product_id', filters: { 'eq product_id': id, 'is consumed_at': null }, order: [], limit: 1 })),
    );
    // Lista: existe item deste produto numa lista aberta? O filtro é o dos itens das listas abertas.
    expect(askedOf('shopping_list_items')).toEqual(
      both.map((id) => ({
        table: 'shopping_list_items',
        columns: 'product_id, list:shopping_lists!inner(id)',
        filters: { 'eq product_id': id, 'is list.archived_at': null },
        order: [],
        limit: 1,
      })),
    );
    // Os mercados: só os dos preços que vieram.
    expect(askedOf('stores')).toEqual([{ table: 'stores', columns: 'id, name', filters: { 'in id': ['s-assai', 's-bom'] }, order: [] }]);
    expect(mockDb.asked).toHaveLength(8);
  });

  it('despensa e lista são respostas de existência: o item consumido e o de lista arquivada não contam', async () => {
    mockDb.pantry = [
      { product_id: ARROZ.id, consumed_at: '2026-10-01T10:00:00Z' },
      { product_id: ARROZ_TJ.id, consumed_at: '2026-10-01T10:00:00Z' },
      { product_id: ARROZ_TJ.id, consumed_at: null },
      { product_id: ARROZ_TJ.id, consumed_at: null },
    ];
    mockDb.listItems = [
      { product_id: ARROZ.id, archived_at: '2026-10-01T10:00:00Z' },
      { product_id: ARROZ_TJ.id, archived_at: null },
    ];
    const { facts } = await fetchMergeFacts(ARROZ.id, ARROZ_TJ.id);
    expect([facts[ARROZ.id].inPantry, facts[ARROZ.id].onList]).toEqual([false, false]);
    expect([facts[ARROZ_TJ.id].inPantry, facts[ARROZ_TJ.id].onList]).toEqual([true, true]);
  });

  // A casa com mais itens na despensa (ou nas listas) do que o servidor devolve de uma vez: a pergunta é por
  // produto, então o produto que estaria fora da primeira página da lista da casa é achado do mesmo jeito.
  it('a despensa da casa maior que o teto do servidor não esconde o produto', async () => {
    mockDb.cap = 3;
    mockDb.pantry = [...Array.from({ length: 10 }, () => ({ product_id: FEIJAO.id, consumed_at: null })), { product_id: ARROZ.id, consumed_at: null }];
    mockDb.listItems = [...Array.from({ length: 10 }, () => ({ product_id: FEIJAO.id, archived_at: null })), { product_id: ARROZ.id, archived_at: null }];
    mockDb.lines = [];
    const { facts } = await fetchMergeFacts(ARROZ.id, ARROZ_TJ.id);
    expect([facts[ARROZ.id].inPantry, facts[ARROZ.id].onList]).toEqual([true, true]);
  });

  it('um produto que não veio foi juntado ou apagado em outro aparelho: fica de fora, e a leitura não falha', async () => {
    mockDb.products = [ARROZ_TJ, FEIJAO];
    const read = await fetchMergeFacts(ARROZ.id, ARROZ_TJ.id);
    expect(read.products).toEqual({ [ARROZ_TJ.id]: ARROZ_TJ });
    expect(read.products[ARROZ.id]).toBeUndefined();
    mockDb.products = [];
    expect((await fetchMergeFacts(ARROZ.id, ARROZ_TJ.id)).products).toEqual({});
  });

  it('uma parte que falha derruba a leitura inteira: nunca uma confirmação com um pedaço', async () => {
    const failure = { message: 'TypeError: Network request failed' };
    for (const table of ['products', 'receipt_items', 'latest_prices', 'pantry_items', 'shopping_list_items', 'stores']) {
      mockDb.tableErrors = { [table]: failure };
      await expect(fetchMergeFacts(ARROZ.id, ARROZ_TJ.id)).rejects.toEqual(failure);
    }
    mockDb.tableErrors = {};
    await expect(fetchMergeFacts(ARROZ.id, ARROZ_TJ.id)).resolves.toBeDefined();
  });

  it('preços além do teto do servidor: a leitura falha, em vez de mostrar uma parte', async () => {
    mockDb.cap = 3;
    mockDb.lines = [];
    // Três preços dos dois produtos: exatamente o teto, e a contagem diz que vieram todos.
    expect((await fetchMergeFacts(ARROZ.id, ARROZ_TJ.id)).facts[ARROZ.id].lastPrice?.unitPrice).toBe(24.9);
    // Um a mais: o servidor corta, calado. O preço mais novo (por peso) ficaria de fora, com o aviso de medida.
    mockDb.prices.push(price(ARROZ.id, 's-feira', 5, '10-13', 'kg'));
    await expect(fetchMergeFacts(ARROZ.id, ARROZ_TJ.id)).rejects.toThrow('Não foi possível carregar todos os preços destes produtos.');
  });

  it('sem a contagem não há como saber se os preços vieram todos: falha também', async () => {
    mockDb.noCount = true;
    await expect(fetchMergeFacts(ARROZ.id, ARROZ_TJ.id)).rejects.toThrow('Não foi possível carregar todos os preços destes produtos.');
  });

  it('zero não é preço: sai do último preço e das medidas, e o mercado dele nem é pedido', async () => {
    mockDb.prices = [price(ARROZ.id, 's-bom', 24.9, '10-05'), price(ARROZ.id, 's-feira', 0, '10-13', 'kg'), price(ARROZ_TJ.id, 's-assai', 0, '10-10')];
    const { facts } = await fetchMergeFacts(ARROZ.id, ARROZ_TJ.id);
    expect(facts[ARROZ.id]).toMatchObject({ lastPrice: { unitPrice: 24.9, unit: 'un', store: 'Mercado Bom', on: '2026-10-05' }, units: ['un'] });
    expect(facts[ARROZ_TJ.id]).toMatchObject({ lastPrice: null, units: [] });
    expect(askedOf('stores').map((request) => request.filters['in id'])).toEqual([['s-bom']]);
  });

  it('sem preço nenhum, nenhum mercado é pedido; produto que o app não conhece de lugar nenhum', async () => {
    mockDb.prices = [];
    mockDb.lines = [];
    mockDb.pantry = [];
    mockDb.listItems = [];
    expect((await fetchMergeFacts(ARROZ.id, ARROZ_TJ.id)).facts).toEqual({ [ARROZ.id]: noFacts, [ARROZ_TJ.id]: noFacts });
    expect(askedOf('stores')).toEqual([]);
  });

  it('mercados demais para um endereço só vão em pedidos de 100', async () => {
    mockDb.prices = Array.from({ length: 230 }, (_, n) => price(ARROZ.id, `s${n}`, 10 + n, '10-05', n % 2 ? 'un' : 'kg'));
    mockDb.stores = mockDb.prices.map(({ store_id }) => ({ id: store_id, name: `Mercado ${store_id}` }));
    await fetchMergeFacts(ARROZ.id, ARROZ_TJ.id);
    expect(askedOf('stores').map((request) => (request.filters['in id'] as string[]).length)).toEqual([100, 100, 30]);
  });
});

describe('juntar', () => {
  it('chama merge_products com os nomes que a pessoa leu e devolve o que passou para o produto que ficou', async () => {
    mockDb.rpcReply = { data: { kept: 'keep', purchases: 12, pantry: 1, list: 2, receipt_items: 13, aliases: 2 }, error: null };
    const hook = await withHook(() => useMergeProducts());
    let moved: unknown;
    await act(async () => {
      moved = await hook.value().mutateAsync(PAIR);
    });
    expect(mockDb.rpcs).toEqual([{ name: 'merge_products', args: SENT }]);
    expect(moved).toEqual({ purchases: 12, pantry: 1, list: 2 });
  });

  it('depois de juntar, busca de novo tudo o que confirmar uma nota e renomear um produto atualizam, e os pares', async () => {
    const confirm = await withHook(() => useConfirmReceipt('r1'));
    await act(async () => {
      await confirm.value().mutateAsync([]);
    });
    await act(async () => renderer?.unmount());
    const rename = await withHook(() => useRenameProduct());
    await act(async () => {
      await rename.value().mutateAsync({ id: 'p1', name: 'Arroz', category: 'graos' });
    });
    await act(async () => renderer?.unmount());
    expect(confirm.invalidated.length).toBeGreaterThan(5);
    // O main passou a buscar os gastos de novo ao renomear (a categoria e o nome aparecem no mercado do mês).
    expect(rename.invalidated).toEqual(['products', 'spending']);

    mockDb.rpcReply = { data: { purchases: 0, pantry: 0, list: 0 }, error: null };
    const merge = await withHook(() => useMergeProducts());
    await act(async () => {
      await merge.value().mutateAsync(PAIR);
    });
    expect([...merge.invalidated].sort()).toEqual([...new Set([...confirm.invalidated, ...rename.invalidated, 'productDistinctPairs'])].sort());
    expect([...MERGE_REFRESHES].sort()).toEqual([...merge.invalidated].sort());
  });

  it('banco ainda sem a função: "Ainda não está disponível", e nada é buscado de novo', async () => {
    mockDb.rpcReply = { data: null, error: noFunction };
    const hook = await withHook(() => useMergeProducts());
    await act(async () => {
      await expect(hook.value().mutateAsync(PAIR)).rejects.toEqual(noFunction);
    });
    expect(hook.invalidated).toEqual([]);
    expect(mergeErrorNotice(noFunction)).toEqual({ title: MERGE_UNAVAILABLE_TITLE, message: MERGE_UNAVAILABLE });
    expect(MERGE_UNAVAILABLE_TITLE).toBe('Ainda não está disponível');
  });

  it('produto que outra pessoa já juntou ou apagou: avisa e busca tudo de novo', async () => {
    mockDb.rpcReply = { data: null, error: gone };
    const hook = await withHook(() => useMergeProducts());
    await act(async () => {
      await expect(hook.value().mutateAsync(PAIR)).rejects.toEqual(gone);
    });
    expect([...hook.invalidated].sort()).toEqual([...MERGE_REFRESHES].sort());
    expect(mergeErrorNotice(gone)).toEqual({ title: 'Erro', message: MERGE_PRODUCT_GONE });
  });

  // A busca da confirmação é de alguns segundos antes do toque: o banco confere os nomes que foram junto e
  // recusa (NK008) se um deles já mudou. Nada foi juntado; o que as telas mostram ficou velho.
  it('um dos dois mudou de nome em outro aparelho: o aviso pede para conferir, e tudo é buscado de novo', async () => {
    mockDb.rpcReply = { data: null, error: renamed };
    const hook = await withHook(() => useMergeProducts());
    await act(async () => {
      await expect(hook.value().mutateAsync(PAIR)).rejects.toEqual(renamed);
    });
    expect(mockDb.rpcs).toEqual([{ name: 'merge_products', args: SENT }]);
    expect([...hook.invalidated].sort()).toEqual([...MERGE_REFRESHES].sort());
    expect(mergeErrorNotice(renamed)).toEqual({ title: MERGE_RENAMED_TITLE, message: MERGE_RENAMED });
  });

  // O banco com uma cópia mais antiga da migração tem merge_products só com os dois produtos: o PostgREST não
  // acha a função com os quatro parâmetros e responde como se ela não existisse.
  it('banco com a função de antes, sem os nomes: o mesmo "Ainda não está disponível"', async () => {
    const olderFunction = {
      code: 'PGRST202',
      message: 'Could not find the function public.merge_products(p_keep, p_keep_name, p_merge, p_merge_name) in the schema cache',
      hint: 'Perhaps you meant to call the function public.merge_products(p_keep, p_merge)',
    };
    mockDb.rpcReply = { data: null, error: olderFunction };
    const hook = await withHook(() => useMergeProducts());
    await act(async () => {
      await expect(hook.value().mutateAsync(PAIR)).rejects.toEqual(olderFunction);
    });
    expect(mockDb.rpcs).toHaveLength(1);
    expect(hook.invalidated).toEqual([]);
    expect(mergeErrorNotice(olderFunction)).toEqual({ title: MERGE_UNAVAILABLE_TITLE, message: MERGE_UNAVAILABLE });
  });

  // Duas pessoas da casa no mesmo instante (uma junta, a outra confirma uma nota ou junta outro par): o banco
  // desfaz um dos pedidos inteiro (40P01). Repetir uma vez é seguro: a função é uma transação só.
  describe('pedido desfeito pelo banco para destravar outro (40P01)', () => {
    const deadlock = { code: '40P01', message: 'deadlock detected' };

    it('tenta de novo uma vez, e a segunda resposta vale', async () => {
      mockDb.rpcReplies = [
        { data: null, error: deadlock },
        { data: { purchases: 3, pantry: 0, list: 1 }, error: null },
      ];
      const hook = await withHook(() => useMergeProducts());
      let moved: unknown;
      await act(async () => {
        moved = await hook.value().mutateAsync(PAIR);
      });
      expect(moved).toEqual({ purchases: 3, pantry: 0, list: 1 });
      expect(mockDb.rpcs).toEqual([
        { name: 'merge_products', args: SENT },
        { name: 'merge_products', args: SENT },
      ]);
      expect([...hook.invalidated].sort()).toEqual([...MERGE_REFRESHES].sort());
    });

    it('de novo desfeito: para na segunda e o erro sobe, para o aviso pedir para tentar de novo', async () => {
      mockDb.rpcReply = { data: null, error: deadlock };
      const hook = await withHook(() => useMergeProducts());
      await act(async () => {
        await expect(hook.value().mutateAsync(PAIR)).rejects.toEqual(deadlock);
      });
      expect(mockDb.rpcs).toHaveLength(2);
      // A frase é a do errorMessage do app (lib/supabase, conferida no teste dele); aqui ele é um dublê.
      expect(mergeErrorNotice(deadlock)).toEqual({ title: 'Erro', message: 'deadlock detected' });
    });

    it('a segunda tentativa acha o produto já juntado: é o aviso de produto que não existe mais', async () => {
      mockDb.rpcReplies = [
        { data: null, error: deadlock },
        { data: null, error: gone },
      ];
      const hook = await withHook(() => useMergeProducts());
      await act(async () => {
        await expect(hook.value().mutateAsync(PAIR)).rejects.toEqual(gone);
      });
      expect(mockDb.rpcs).toHaveLength(2);
    });

    it('os outros erros não se repetem', async () => {
      for (const error of [gone, renamed, noFunction, { message: 'TypeError: Network request failed' }, { code: '55000', message: 'rows still point to the merged product' }]) {
        mockDb.rpcs = [];
        mockDb.rpcReply = { data: null, error };
        const hook = await withHook(() => useMergeProducts());
        await act(async () => {
          await expect(hook.value().mutateAsync(PAIR)).rejects.toEqual(error);
        });
        expect(mockDb.rpcs).toHaveLength(1);
        await act(async () => renderer?.unmount());
      }
    });

    it('confirmar a nota nunca se repete sozinho: o segundo pedido levaria o id do produto que acabou de sumir', async () => {
      mockDb.rpcReply = { data: null, error: deadlock };
      const hook = await withHook(() => useConfirmReceipt('r1'));
      await act(async () => {
        await expect(hook.value().mutateAsync([])).rejects.toEqual(deadlock);
      });
      expect(mockDb.rpcs).toHaveLength(1);
      expect(hook.invalidated).toEqual([]);
    });
  });

  // Com sinal fraco o pedido pode ficar pendurado para sempre (no Android ele não tem prazo), e a confirmação
  // não fecha enquanto o banco junta. O pedido é cortado; como o banco pode ter juntado antes do corte, o aviso
  // manda conferir e tudo é buscado de novo.
  describe('pedido de juntar sem resposta', () => {
    it('é cortado depois do prazo: avisa que não dá para saber, não repete e busca tudo de novo', async () => {
      jest.useFakeTimers();
      mockDb.hold = true;
      const hook = await withHook(() => useMergeProducts());
      let failure: unknown;
      await act(async () => {
        hook
          .value()
          .mutateAsync(PAIR)
          .catch((error: unknown) => {
            failure = error;
          });
        await jest.advanceTimersByTimeAsync(MERGE_TIMEOUT_MS - 1);
      });
      expect(mockDb.signals).toHaveLength(1);
      expect(mockDb.signals[0].aborted).toBe(false);
      expect(failure).toBeUndefined();

      await act(async () => {
        await jest.advanceTimersByTimeAsync(1);
      });
      expect(mockDb.signals[0].aborted).toBe(true);
      expect((failure as Error).message).toBe(MERGE_NO_ANSWER);
      // A gravação terminou: a tela deixa de girar e volta a poder ser fechada. (O cache avisa a tela por
      // temporizadores, alguns passos depois do erro.)
      await act(async () => {
        for (let step = 0; step < 5; step += 1) await jest.advanceTimersByTimeAsync(1);
      });
      expect(hook.value().isPending).toBe(false);
      expect(hook.value().isError).toBe(true);
      expect(mockDb.rpcs).toHaveLength(1);
      expect([...hook.invalidated].sort()).toEqual([...MERGE_REFRESHES].sort());
      expect(mergeErrorNotice(failure)).toEqual({ title: MERGE_NO_ANSWER_TITLE, message: MERGE_NO_ANSWER });
      expect(MERGE_NO_ANSWER).toBe('A resposta não chegou, e pode ser que os produtos já tenham sido juntados. Confira os produtos antes de tentar de novo.');
      expect(MERGE_TIMEOUT_MS).toBe(25_000);
    });

    it('a resposta que chega desliga o prazo: nada é cortado depois', async () => {
      jest.useFakeTimers();
      mockDb.rpcReply = { data: { purchases: 1, pantry: 0, list: 0 }, error: null };
      const hook = await withHook(() => useMergeProducts());
      let moved: unknown;
      await act(async () => {
        hook
          .value()
          .mutateAsync(PAIR)
          .then((result) => {
            moved = result;
          });
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(moved).toEqual({ purchases: 1, pantry: 0, list: 0 });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(MERGE_TIMEOUT_MS * 2);
      });
      expect(mockDb.signals[0].aborted).toBe(false);
    });

    it('o erro que chega também desliga o prazo', async () => {
      jest.useFakeTimers();
      mockDb.rpcReply = { data: null, error: gone };
      const hook = await withHook(() => useMergeProducts());
      let failure: unknown;
      await act(async () => {
        hook
          .value()
          .mutateAsync(PAIR)
          .catch((error: unknown) => {
            failure = error;
          });
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(failure).toEqual(gone);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(MERGE_TIMEOUT_MS * 2);
      });
      expect(mockDb.signals[0].aborted).toBe(false);
    });
  });

  it('a trava do banco (55000) diz que nada mudou; os outros erros saem com a mensagem deles', () => {
    expect(mergeErrorNotice({ code: '55000', message: 'rows still point to the merged product' })).toEqual({ title: 'Erro', message: MERGE_BLOCKED });
    expect(mergeErrorNotice({ message: 'TypeError: Network request failed' })).toEqual({ title: 'Erro', message: 'TypeError: Network request failed' });
    expect(mergeErrorNotice(notInCache)).toEqual({ title: MERGE_UNAVAILABLE_TITLE, message: MERGE_UNAVAILABLE });
  });
});
