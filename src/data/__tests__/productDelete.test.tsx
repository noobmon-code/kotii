import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import {
  DELETE_BLOCKED,
  DELETE_CHECK_FAILED,
  DELETE_FAILED_TITLE,
  DELETE_GONE_TITLE,
  DELETE_IN_REVIEW,
  DELETE_IN_REVIEW_TITLE,
  DELETE_NO_ANSWER,
  DELETE_NO_ANSWER_TITLE,
  DELETE_PURCHASED,
  DELETE_PURCHASED_TITLE,
  DELETE_RENAMED,
  DELETE_RENAMED_TITLE,
  DELETE_UNAVAILABLE,
  DELETE_UNAVAILABLE_TITLE,
  PRODUCT_NOT_IN_HOUSE,
} from '@/domain/productDelete';
import { mergeCandidates, orderedPair, type DistinctPair } from '@/domain/productMerge';
import { BUSY_TRY_AGAIN } from '@/lib/databaseErrors';

import {
  DELETE_REFRESHES,
  deleteErrorNotice,
  fetchDeleteFacts,
  fetchDeleteProductAvailable,
  PAIRS_CARRY_MS,
  PRODUCT_DELETE_CHECK_MS,
  PRODUCT_DELETE_TIMEOUT_MS,
  useDeleteProduct,
} from '../productDelete';
import { MERGE_REFRESHES } from '../productMerge';

/** Um pedido de leitura como chegou ao servidor. */
interface Asked {
  table: string;
  columns: string;
  filters: Record<string, unknown>;
  order: string[];
  limit?: number;
  count?: string;
}

interface Line {
  receipt_id: string;
  product_id: string;
  status: 'confirmed' | 'draft';
  purchased_at: string;
  store: string | null;
}

type Reply = { data: unknown; error: object | null };

// "mock" no nome: o jest.mock só enxerga variáveis assim. O banco de mentira, como o servidor o serve.
const mockDb = {
  products: [] as { id: string; name: string }[],
  lines: [] as Line[],
  pantry: [] as { product_id: string; consumed_at: string | null }[],
  listItems: [] as { product_id: string; archived_at: string | null }[],
  barcodes: [] as { product_id: string; gtin: string }[],
  /** O erro que só as leituras de uma tabela devolvem. */
  tableErrors: {} as Record<string, object>,
  /** As leituras destas tabelas ficam sem resposta: só o corte termina a espera. */
  holdTables: [] as string[],
  asked: [] as Asked[],
  /** O sinal de corte que cada leitura recebeu. */
  readSignals: [] as AbortSignal[],
  rpcs: [] as { name: string; args: unknown }[],
  rpcReply: { data: { deleted: 'p1', pantry: 1, list: 2, barcodes: 3 }, error: null } as Reply,
  rpcReplies: [] as Reply[],
  holdRpc: false,
  upserts: [] as { table: string; rows: unknown; options: unknown }[],
  upsertReply: { data: null, error: null } as Reply,
  holdUpsert: false,
};

/** Cortado, o postgrest-js não lança: devolve este erro. */
const ABORTED = { message: 'AbortError: Aborted', details: '', hint: 'Request was aborted (timeout or manual cancellation)', code: '' };

/** Espera o corte do pedido (o sinal) e responde como o postgrest-js responde a um pedido cortado. */
const mockUntilAborted = (signal: AbortSignal | undefined): Promise<Reply> =>
  new Promise((resolve) => signal?.addEventListener('abort', () => resolve({ data: null, error: ABORTED })));

jest.mock('@/lib/session', () => ({ endSessionIfGone: async () => false }));
jest.mock('@/lib/supabase', () => {
  const { BUSY_TRY_AGAIN: busy } = jest.requireActual<typeof import('@/lib/databaseErrors')>('@/lib/databaseErrors');
  return {
    supabase: {
      from: (table: string) => ({
        select: (columns: string, options?: { count?: string }) => {
          const filters: Record<string, unknown> = {};
          const order: string[] = [];
          let limit: number | undefined;
          let signal: AbortSignal | undefined;
          // As linhas que o banco tem para este pedido, com os filtros que ele trouxe (só eles).
          const found = (): object[] => {
            const product = filters['eq product_id'];
            switch (table) {
              case 'products':
                return mockDb.products.filter((p) => p.id === filters['eq id']);
              case 'receipt_items':
                return mockDb.lines
                  .filter((line) => line.product_id === product && line.status === filters['eq receipt.status'])
                  .map((line) => ({
                    id: `${line.receipt_id}-line`,
                    receipt_id: line.receipt_id,
                    receipt: { status: line.status, purchased_at: line.purchased_at, store: line.store ? { name: line.store } : null },
                  }));
              case 'pantry_items':
                return mockDb.pantry
                  .filter((item) => item.product_id === product && (!('is consumed_at' in filters) || item.consumed_at === null))
                  .map((item) => ({ product_id: item.product_id }));
              case 'shopping_list_items':
                return mockDb.listItems
                  .filter((item) => item.product_id === product && (!('is list.archived_at' in filters) || item.archived_at === null))
                  .map((item) => ({ product_id: item.product_id, list: { id: 'l1' } }));
              case 'product_barcodes':
                return mockDb.barcodes
                  .filter((code) => code.product_id === product)
                  .sort((a, b) => (a.gtin < b.gtin ? -1 : 1))
                  .map((code) => ({ gtin: code.gtin }));
              default:
                return [];
            }
          };
          const reply = (): Reply & { count: number | null } => {
            const failure = mockDb.tableErrors[table];
            if (failure) return { data: null, error: failure, count: null };
            const rows = found();
            return { data: rows.slice(0, limit ?? Infinity), error: null, count: options?.count === 'exact' ? rows.length : null };
          };
          const query = {
            eq: (column: string, value: unknown) => {
              filters[`eq ${column}`] = value;
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
            abortSignal: (given: AbortSignal) => {
              signal = given;
              mockDb.readSignals.push(given);
              return query;
            },
            then: (resolve: (answer: unknown) => unknown, reject: (error: unknown) => unknown) => {
              mockDb.asked.push({ table, columns, filters: { ...filters }, order: [...order], limit, count: options?.count });
              const answer = mockDb.holdTables.includes(table) ? mockUntilAborted(signal) : Promise.resolve(reply());
              return answer.then(resolve, reject);
            },
          };
          return query;
        },
        upsert: (rows: unknown, options: unknown) => {
          mockDb.upserts.push({ table, rows, options });
          let signal: AbortSignal | undefined;
          const request = {
            abortSignal: (given: AbortSignal) => {
              signal = given;
              return request;
            },
            then: (resolve: (reply: unknown) => unknown, reject: (error: unknown) => unknown) =>
              (mockDb.holdUpsert ? mockUntilAborted(signal) : Promise.resolve(mockDb.upsertReply)).then(resolve, reject),
          };
          return request;
        },
      }),
      rpc: (name: string, args: unknown) => {
        mockDb.rpcs.push({ name, args });
        let signal: AbortSignal | undefined;
        const request = {
          abortSignal: (given: AbortSignal) => {
            signal = given;
            return request;
          },
          then: (resolve: (reply: unknown) => unknown, reject: (error: unknown) => unknown) =>
            (mockDb.holdRpc ? mockUntilAborted(signal) : Promise.resolve(mockDb.rpcReplies.shift() ?? mockDb.rpcReply)).then(resolve, reject),
        };
        return request;
      },
    },
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
    errorMessage: (error: { code?: string; message?: string }) =>
      error?.code === '40P01' ? busy : (error?.message ?? 'Algo deu errado. Tente novamente.'),
  };
});

let renderer: ReactTestRenderer | undefined;

/** Roda um hook de verdade dentro de um QueryClient; devolve o que ele deu por último e as chaves invalidadas. */
async function withHook<T>(useIt: () => T) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: 0 } } });
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
    products: [],
    lines: [],
    pantry: [],
    listItems: [],
    barcodes: [],
    tableErrors: {},
    holdTables: [],
    asked: [],
    readSignals: [],
    rpcs: [],
    rpcReply: { data: { deleted: 'p1', pantry: 1, list: 2, barcodes: 3 }, error: null },
    rpcReplies: [],
    holdRpc: false,
    upserts: [],
    upsertReply: { data: null, error: null },
    holdUpsert: false,
  });
});

describe('a leitura antes da pergunta', () => {
  it('cada pedido é só deste produto, com os filtros certos, e nenhuma lista inteira da casa é lida', async () => {
    mockDb.products = [{ id: 'p1', name: 'Biscoito errado' }];
    await fetchDeleteFacts('p1');
    const byTable = (table: string) => mockDb.asked.filter((asked) => asked.table === table);
    expect(byTable('products')).toEqual([{ table: 'products', columns: 'id, name', filters: { 'eq id': 'p1' }, order: [], limit: undefined, count: undefined }]);
    expect(byTable('receipt_items')).toEqual([
      {
        table: 'receipt_items',
        columns: 'id, receipt:receipts!inner(status)',
        filters: { 'eq product_id': 'p1', 'eq receipt.status': 'confirmed' },
        order: [],
        limit: 1,
        count: undefined,
      },
      {
        table: 'receipt_items',
        columns: 'receipt_id, receipt:receipts!inner(status, purchased_at, store:stores(name))',
        filters: { 'eq product_id': 'p1', 'eq receipt.status': 'draft' },
        order: [],
        limit: 1,
        count: undefined,
      },
    ]);
    expect(byTable('pantry_items')).toEqual([
      { table: 'pantry_items', columns: 'product_id', filters: { 'eq product_id': 'p1', 'is consumed_at': null }, order: [], limit: 1, count: undefined },
    ]);
    expect(byTable('shopping_list_items')).toEqual([
      {
        table: 'shopping_list_items',
        columns: 'product_id, list:shopping_lists!inner(id)',
        filters: { 'eq product_id': 'p1', 'is list.archived_at': null },
        order: [],
        limit: 1,
        count: undefined,
      },
    ]);
    expect(byTable('product_barcodes')).toEqual([
      { table: 'product_barcodes', columns: 'gtin', filters: { 'eq product_id': 'p1' }, order: ['gtin'], limit: 1, count: 'exact' },
    ]);
    expect(mockDb.asked).toHaveLength(6);
    // Todos com o mesmo sinal de corte.
    expect(new Set(mockDb.readSignals).size).toBe(1);
    expect(mockDb.readSignals).toHaveLength(6);
  });

  it('traz o que a pergunta precisa: compra, um rascunho (com o mercado e o dia), despensa aberta, lista aberta e os códigos', async () => {
    mockDb.products = [{ id: 'p1', name: 'Biscoito errado' }];
    mockDb.lines = [{ receipt_id: 'r9', product_id: 'p1', status: 'draft', purchased_at: '2026-11-12T13:00:00Z', store: 'Assaí' }];
    mockDb.pantry = [{ product_id: 'p1', consumed_at: null }];
    mockDb.listItems = [{ product_id: 'p1', archived_at: null }];
    mockDb.barcodes = [
      { product_id: 'p1', gtin: '07891000100103' },
      { product_id: 'p1', gtin: '00000096385074' },
    ];
    expect(await fetchDeleteFacts('p1')).toEqual({
      product: { id: 'p1', name: 'Biscoito errado' },
      purchased: false,
      review: { receiptId: 'r9', store: 'Assaí', day: '2026-11-12' },
      inPantry: true,
      onList: true,
      barcodes: { count: 2, first: '00000096385074' },
    });
  });

  it('o rascunho sem mercado; a compra confirmada; o consumido e o da lista arquivada não contam', async () => {
    mockDb.products = [{ id: 'p1', name: 'Café' }];
    mockDb.lines = [
      { receipt_id: 'r1', product_id: 'p1', status: 'confirmed', purchased_at: '2026-11-01T13:00:00Z', store: 'Assaí' },
      { receipt_id: 'r2', product_id: 'p1', status: 'draft', purchased_at: '2026-11-02T13:00:00Z', store: null },
    ];
    mockDb.pantry = [{ product_id: 'p1', consumed_at: '2026-11-01T10:00:00Z' }];
    mockDb.listItems = [{ product_id: 'p1', archived_at: '2026-11-01T10:00:00Z' }];
    expect(await fetchDeleteFacts('p1')).toMatchObject({
      purchased: true,
      review: { receiptId: 'r2', store: null, day: '2026-11-02' },
      inPantry: false,
      onList: false,
      barcodes: { count: 0, first: null },
    });
  });

  it('produto que não veio: null; banco sem a tabela dos códigos: zero códigos', async () => {
    mockDb.tableErrors = { product_barcodes: { code: 'PGRST205', message: "Could not find the table 'public.product_barcodes' in the schema cache" } };
    expect(await fetchDeleteFacts('p1')).toMatchObject({ product: null, barcodes: { count: 0, first: null } });
  });

  it('uma parte que falha derruba a leitura inteira: a pergunta nunca sai de um pedaço', async () => {
    for (const table of ['products', 'receipt_items', 'pantry_items', 'shopping_list_items', 'product_barcodes']) {
      mockDb.products = [{ id: 'p1', name: 'Sal' }];
      mockDb.tableErrors = { [table]: { message: 'TypeError: Network request failed' } };
      await expect(fetchDeleteFacts('p1')).rejects.toEqual({ message: 'TypeError: Network request failed' });
    }
  });

  it('uma parte pendurada: tudo é cortado no prazo, e a leitura diz que não deu para conferir', async () => {
    jest.useFakeTimers();
    mockDb.products = [{ id: 'p1', name: 'Sal' }];
    mockDb.holdTables = ['pantry_items'];
    const read = fetchDeleteFacts('p1');
    const failed = expect(read).rejects.toThrow(DELETE_CHECK_FAILED);
    await jest.advanceTimersByTimeAsync(PRODUCT_DELETE_CHECK_MS - 1);
    expect(mockDb.readSignals.some((signal) => signal.aborted)).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await failed;
    expect(mockDb.readSignals.every((signal) => signal.aborted)).toBe(true);
  });
});

describe('excluir', () => {
  /** O que delete_product muda, tabela por tabela, e as chaves do app que leem cada uma. */
  const TABLE_KEYS: Record<string, string[]> = {
    products: ['products', 'priceHistory'],
    pantry_items: ['pantry'],
    shopping_list_items: ['lists', 'listItems'],
    purchase_history: ['purchaseRecords'],
    product_aliases: ['productAliases', 'sharedPrices'],
    list_item_links: ['listLinks'],
    product_barcodes: ['productBarcodes'],
    product_distinct_pairs: ['productDistinctPairs'],
    product_store_codes: [],
  };

  it('o que é buscado de novo é o que lê as tabelas que a função muda, e cabe no que juntar busca', () => {
    expect([...DELETE_REFRESHES].sort()).toEqual(Object.values(TABLE_KEYS).flat().sort());
    for (const key of DELETE_REFRESHES) expect(MERGE_REFRESHES).toContain(key);
  });

  it('chama delete_product com o nome lido, devolve o que perdeu a ligação e busca de novo DELETE_REFRESHES', async () => {
    const hook = await withHook(() => useDeleteProduct());
    let result: unknown;
    await act(async () => {
      result = await hook.value().mutateAsync({ id: 'p1', name: 'Biscoito errado' });
    });
    expect(mockDb.rpcs).toEqual([{ name: 'delete_product', args: { p_id: 'p1', p_name: 'Biscoito errado' } }]);
    expect(result).toEqual({ pantry: 1, list: 2, barcodes: 3, carry: [] });
    expect([...hook.invalidated].sort()).toEqual([...DELETE_REFRESHES].sort());
    expect(mockDb.upserts).toEqual([]);
  });

  it('tira da lista guardada os pares do excluído e põe os que passam para o gêmeo de nome, depois os grava e só então busca os pares', async () => {
    const products = [
      { id: 'p00', name: 'Limão siciliano', category: 'hortifruti' },
      { id: 'p01', name: 'Limao', category: 'hortifruti' },
      { id: 'p02', name: 'Limão', category: 'hortifruti' },
      { id: 'p03', name: 'Feijão', category: 'mercearia' },
      { id: 'p04', name: 'Arroz', category: 'mercearia' },
    ];
    const hook = await withHook(() => useDeleteProduct());
    hook.client.setQueryData(['products'], products);
    hook.client.setQueryData<DistinctPair[]>(['productDistinctPairs'], [orderedPair('p00', 'p01'), orderedPair('p03', 'p04')]);
    mockDb.holdUpsert = true;
    jest.useFakeTimers();
    let result: { carry: DistinctPair[] } | undefined;
    await act(async () => {
      result = await hook.value().mutateAsync({ id: 'p01', name: 'Limao' });
    });
    expect(result?.carry).toEqual([orderedPair('p00', 'p02')]);
    expect(hook.client.getQueryData(['productDistinctPairs'])).toEqual([orderedPair('p03', 'p04'), orderedPair('p00', 'p02')]);
    // O excluído sai do catálogo guardado no mesmo passo: com ele ainda lá e o par dele já fora, o par recusado
    // (Limão siciliano / Limao) voltaria como sugestão até a busca nova dos produtos chegar.
    expect(hook.client.getQueryData(['products'])).toEqual(products.filter((product) => product.id !== 'p01'));
    expect(mergeCandidates(hook.client.getQueryData(['products'])!, hook.client.getQueryData(['productDistinctPairs'])!)).toEqual([]);
    expect(mockDb.upserts).toEqual([{ table: 'product_distinct_pairs', rows: [orderedPair('p00', 'p02')], options: { ignoreDuplicates: true } }]);
    // Enquanto a gravação não volta, os pares ainda não foram buscados de novo.
    expect(hook.invalidated).not.toContain('productDistinctPairs');
    // Pendurada, a gravação é cortada no prazo; o excluir já tinha dado certo.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(PAIRS_CARRY_MS);
    });
    expect(hook.invalidated).toContain('productDistinctPairs');
    expect([...hook.invalidated].sort()).toEqual([...DELETE_REFRESHES].sort());
  });

  it('a gravação dos pares que falha não vira erro do excluir', async () => {
    const hook = await withHook(() => useDeleteProduct());
    hook.client.setQueryData(['products'], [
      { id: 'p00', name: 'Limão siciliano', category: 'hortifruti' },
      { id: 'p01', name: 'Limao', category: 'hortifruti' },
      { id: 'p02', name: 'Limão', category: 'hortifruti' },
    ]);
    hook.client.setQueryData<DistinctPair[]>(['productDistinctPairs'], [orderedPair('p00', 'p01')]);
    mockDb.upsertReply = { data: null, error: { code: '23503', message: 'insert or update on table "product_distinct_pairs" violates foreign key constraint' } };
    await act(async () => {
      await expect(hook.value().mutateAsync({ id: 'p01', name: 'Limao' })).resolves.toMatchObject({ carry: [orderedPair('p00', 'p02')] });
    });
    await flush();
    expect(mockDb.upserts).toHaveLength(1);
    expect(hook.invalidated).toContain('productDistinctPairs');
  });

  it('banco ainda sem a função (PGRST202, ou 42883 com o nome dela): "Ainda não está disponível", e nada é buscado nem gravado', async () => {
    for (const error of [
      { code: 'PGRST202', message: 'Could not find the function public.delete_product(p_id, p_name) in the schema cache' },
      { code: '42883', message: 'function public.delete_product(uuid, text) does not exist' },
    ]) {
      mockDb.rpcReply = { data: null, error };
      const hook = await withHook(() => useDeleteProduct());
      hook.client.setQueryData(['products'], [
        { id: 'p00', name: 'Limão siciliano', category: 'x' },
        { id: 'p01', name: 'Limao', category: 'x' },
        { id: 'p02', name: 'Limão', category: 'x' },
      ]);
      hook.client.setQueryData<DistinctPair[]>(['productDistinctPairs'], [orderedPair('p00', 'p01')]);
      await act(async () => {
        await expect(hook.value().mutateAsync({ id: 'p01', name: 'Limao' })).rejects.toEqual(error);
      });
      expect(deleteErrorNotice(error)).toEqual({ title: DELETE_UNAVAILABLE_TITLE, message: DELETE_UNAVAILABLE });
      expect(hook.invalidated).toEqual([]);
      expect(mockDb.upserts).toEqual([]);
      await act(async () => renderer?.unmount());
    }
  });

  it('o produto que sumiu, o nome que mudou, a compra que apareceu e o rascunho: cada um com o seu aviso, e tudo buscado de novo', async () => {
    const cases: { error: object; notice: { title: string; message: string }; receipts?: boolean }[] = [
      { error: { code: 'P0002', message: 'product not found' }, notice: { title: DELETE_GONE_TITLE, message: PRODUCT_NOT_IN_HOUSE } },
      { error: { code: 'NK008', message: 'product renamed' }, notice: { title: DELETE_RENAMED_TITLE, message: DELETE_RENAMED } },
      { error: { code: 'NK016', message: 'product has purchases' }, notice: { title: DELETE_PURCHASED_TITLE, message: DELETE_PURCHASED } },
      {
        error: { code: 'NK017', message: 'product is on a receipt under review' },
        notice: { title: DELETE_IN_REVIEW_TITLE, message: DELETE_IN_REVIEW },
        receipts: true,
      },
    ];
    for (const { error, notice, receipts } of cases) {
      mockDb.rpcReply = { data: null, error };
      const hook = await withHook(() => useDeleteProduct());
      const catalog = [
        { id: 'p0', name: 'Sal grosso', category: 'mercearia' },
        { id: 'p1', name: 'Sal', category: 'mercearia' },
      ];
      hook.client.setQueryData(['products'], catalog);
      hook.client.setQueryData<DistinctPair[]>(['productDistinctPairs'], [orderedPair('p0', 'p1')]);
      await act(async () => {
        await expect(hook.value().mutateAsync({ id: 'p1', name: 'Sal' })).rejects.toEqual(error);
      });
      expect(deleteErrorNotice(error)).toEqual(notice);
      expect([...hook.invalidated].sort()).toEqual([...DELETE_REFRESHES, ...(receipts ? ['receipts'] : [])].sort());
      // Só o que já não existe sai da memória na hora (com os pares dele); nos outros, o produto continua lá.
      const gone = (error as { code: string }).code === 'P0002';
      expect(hook.client.getQueryData(['products'])).toEqual(gone ? [catalog[0]] : catalog);
      expect(hook.client.getQueryData(['productDistinctPairs'])).toEqual(gone ? [] : [orderedPair('p0', 'p1')]);
      await act(async () => renderer?.unmount());
    }
  });

  it('o banco desfez o pedido (40P01): tenta mais uma vez; de novo, avisa que outra pessoa mexeu', async () => {
    const busy = { code: '40P01', message: 'deadlock detected' };
    mockDb.rpcReplies = [{ data: null, error: busy }];
    let hook = await withHook(() => useDeleteProduct());
    await act(async () => {
      await expect(hook.value().mutateAsync({ id: 'p1', name: 'Sal' })).resolves.toMatchObject({ pantry: 1 });
    });
    expect(mockDb.rpcs).toHaveLength(2);
    await act(async () => renderer?.unmount());

    mockDb.rpcs = [];
    mockDb.rpcReplies = [
      { data: null, error: busy },
      { data: null, error: busy },
    ];
    hook = await withHook(() => useDeleteProduct());
    await act(async () => {
      await expect(hook.value().mutateAsync({ id: 'p1', name: 'Sal' })).rejects.toEqual(busy);
    });
    expect(mockDb.rpcs).toHaveLength(2);
    expect(deleteErrorNotice(busy)).toEqual({ title: DELETE_FAILED_TITLE, message: BUSY_TRY_AGAIN });
  });

  it('sem resposta em 25 s: o pedido é cortado, sem nova tentativa, o aviso diz que pode ter excluído, e tudo é buscado de novo', async () => {
    jest.useFakeTimers();
    mockDb.holdRpc = true;
    const hook = await withHook(() => useDeleteProduct());
    let failed: Promise<void> | undefined;
    await act(async () => {
      failed = expect(hook.value().mutateAsync({ id: 'p1', name: 'Sal' })).rejects.toThrow(DELETE_NO_ANSWER);
      await jest.advanceTimersByTimeAsync(PRODUCT_DELETE_TIMEOUT_MS);
      await failed;
    });
    expect(mockDb.rpcs).toHaveLength(1);
    expect(deleteErrorNotice(new Error(DELETE_NO_ANSWER))).toEqual({ title: DELETE_NO_ANSWER_TITLE, message: DELETE_NO_ANSWER });
    expect([...hook.invalidated].sort()).toEqual([...DELETE_REFRESHES].sort());
  });

  it('a trava do banco (55000) diz que nada mudou; outro erro sai com a mensagem dele', () => {
    expect(deleteErrorNotice({ code: '55000', message: 'product was not deleted' })).toEqual({ title: DELETE_FAILED_TITLE, message: DELETE_BLOCKED });
    expect(deleteErrorNotice({ message: 'outra coisa' })).toEqual({ title: DELETE_FAILED_TITLE, message: 'outra coisa' });
  });
});

describe('a pergunta de que o banco sabe excluir', () => {
  it('true com a função; false sem ela; outro erro sobe', async () => {
    mockDb.rpcReply = { data: true, error: null };
    expect(await fetchDeleteProductAvailable()).toBe(true);
    expect(mockDb.rpcs).toEqual([{ name: 'delete_product_available', args: undefined }]);
    mockDb.rpcReply = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.delete_product_available without parameters in the schema cache' } };
    expect(await fetchDeleteProductAvailable()).toBe(false);
    mockDb.rpcReply = { data: null, error: { message: 'TypeError: Network request failed' } };
    await expect(fetchDeleteProductAvailable()).rejects.toEqual({ message: 'TypeError: Network request failed' });
  });
});
