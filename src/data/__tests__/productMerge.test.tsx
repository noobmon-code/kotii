import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import {
  MERGE_BLOCKED,
  MERGE_NO_ANSWER,
  MERGE_NO_ANSWER_TITLE,
  MERGE_PRODUCT_GONE,
  MERGE_UNAVAILABLE,
  MERGE_UNAVAILABLE_TITLE,
  type DistinctPair,
} from '@/domain/productMerge';

import { useRenameProduct } from '../market';
import {
  fetchDistinctPairs,
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

// "mock" no nome: o jest.mock só enxerga variáveis assim. O banco de mentira, como o servidor o serve.
const mockDb = {
  pairs: [] as DistinctPair[],
  lines: [] as Line[],
  /** O teto de linhas por pedido (max_rows do Supabase). */
  cap: 1000,
  /** O erro que a próxima leitura ou gravação devolve. */
  error: null as object | null,
  asked: [] as { table: string; columns: string; filters: Record<string, unknown>; order: string[]; range: [number, number] }[],
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
      select: (columns: string) => {
        const filters: Record<string, unknown> = {};
        const order: string[] = [];
        const query = {
          eq: (column: string, value: unknown) => {
            filters[`eq ${column}`] = value;
            return query;
          },
          in: (column: string, values: unknown[]) => {
            filters[`in ${column}`] = values;
            return query;
          },
          order: (column: string) => {
            order.push(column);
            return query;
          },
          range: async (from: number, to: number) => {
            mockDb.asked.push({ table, columns, filters: { ...filters }, order: [...order], range: [from, to] });
            if (mockDb.error) return { data: null, error: mockDb.error };
            const wanted = (filters['in product_id'] as string[] | undefined) ?? [];
            const rows: object[] =
              table === 'product_distinct_pairs'
                ? mockDb.pairs
                : mockDb.lines
                    .filter((line) => line.status === filters['eq receipt.status'] && wanted.includes(line.product_id))
                    .sort((a, b) => (a.id < b.id ? -1 : 1))
                    .map((line) => ({ product_id: line.product_id, receipt: { status: line.status } }));
            return { data: rows.slice(from, Math.min(to + 1, from + mockDb.cap)), error: null };
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
    cap: 1000,
    error: null,
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

describe('juntar', () => {
  it('chama merge_products e devolve o que passou para o produto que ficou', async () => {
    mockDb.rpcReply = { data: { kept: 'keep', purchases: 12, pantry: 1, list: 2, receipt_items: 13, aliases: 2 }, error: null };
    const hook = await withHook(() => useMergeProducts());
    let moved: unknown;
    await act(async () => {
      moved = await hook.value().mutateAsync({ keepId: 'keep', mergeId: 'gone' });
    });
    expect(mockDb.rpcs).toEqual([{ name: 'merge_products', args: { p_keep: 'keep', p_merge: 'gone' } }]);
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
    expect(rename.invalidated).toEqual(['products']);

    mockDb.rpcReply = { data: { purchases: 0, pantry: 0, list: 0 }, error: null };
    const merge = await withHook(() => useMergeProducts());
    await act(async () => {
      await merge.value().mutateAsync({ keepId: 'keep', mergeId: 'gone' });
    });
    expect([...merge.invalidated].sort()).toEqual([...new Set([...confirm.invalidated, ...rename.invalidated, 'productDistinctPairs'])].sort());
    expect([...MERGE_REFRESHES].sort()).toEqual([...merge.invalidated].sort());
  });

  it('banco ainda sem a função: "Ainda não está disponível", e nada é buscado de novo', async () => {
    mockDb.rpcReply = { data: null, error: noFunction };
    const hook = await withHook(() => useMergeProducts());
    await act(async () => {
      await expect(hook.value().mutateAsync({ keepId: 'keep', mergeId: 'gone' })).rejects.toEqual(noFunction);
    });
    expect(hook.invalidated).toEqual([]);
    expect(mergeErrorNotice(noFunction)).toEqual({ title: MERGE_UNAVAILABLE_TITLE, message: MERGE_UNAVAILABLE });
    expect(MERGE_UNAVAILABLE_TITLE).toBe('Ainda não está disponível');
  });

  it('produto que outra pessoa já juntou ou apagou: avisa e busca tudo de novo', async () => {
    mockDb.rpcReply = { data: null, error: gone };
    const hook = await withHook(() => useMergeProducts());
    await act(async () => {
      await expect(hook.value().mutateAsync({ keepId: 'keep', mergeId: 'gone' })).rejects.toEqual(gone);
    });
    expect([...hook.invalidated].sort()).toEqual([...MERGE_REFRESHES].sort());
    expect(mergeErrorNotice(gone)).toEqual({ title: 'Erro', message: MERGE_PRODUCT_GONE });
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
        moved = await hook.value().mutateAsync({ keepId: 'keep', mergeId: 'gone' });
      });
      expect(moved).toEqual({ purchases: 3, pantry: 0, list: 1 });
      expect(mockDb.rpcs).toEqual([
        { name: 'merge_products', args: { p_keep: 'keep', p_merge: 'gone' } },
        { name: 'merge_products', args: { p_keep: 'keep', p_merge: 'gone' } },
      ]);
      expect([...hook.invalidated].sort()).toEqual([...MERGE_REFRESHES].sort());
    });

    it('de novo desfeito: para na segunda e o erro sobe, para o aviso pedir para tentar de novo', async () => {
      mockDb.rpcReply = { data: null, error: deadlock };
      const hook = await withHook(() => useMergeProducts());
      await act(async () => {
        await expect(hook.value().mutateAsync({ keepId: 'keep', mergeId: 'gone' })).rejects.toEqual(deadlock);
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
        await expect(hook.value().mutateAsync({ keepId: 'keep', mergeId: 'gone' })).rejects.toEqual(gone);
      });
      expect(mockDb.rpcs).toHaveLength(2);
    });

    it('os outros erros não se repetem', async () => {
      for (const error of [gone, noFunction, { message: 'TypeError: Network request failed' }, { code: '55000', message: 'rows still point to the merged product' }]) {
        mockDb.rpcs = [];
        mockDb.rpcReply = { data: null, error };
        const hook = await withHook(() => useMergeProducts());
        await act(async () => {
          await expect(hook.value().mutateAsync({ keepId: 'keep', mergeId: 'gone' })).rejects.toEqual(error);
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
          .mutateAsync({ keepId: 'keep', mergeId: 'gone' })
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
          .mutateAsync({ keepId: 'keep', mergeId: 'gone' })
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
          .mutateAsync({ keepId: 'keep', mergeId: 'gone' })
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
