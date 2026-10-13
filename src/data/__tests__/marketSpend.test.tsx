import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { marketMonth, type MarketReceipt } from '@/domain/marketSpend';

import { useRenameProduct } from '../market';
import { fetchMarketReceipts, useMarketReceipts } from '../marketSpend';

type Row = Record<string, unknown>;
type Filter = { op: 'gte' | 'lt' | 'in'; column: string; value: unknown };
type Asked = { table: string; columns: string; count: string | undefined; filters: Filter[]; order: string[]; range: [number, number] | null };

// "mock" no nome: o jest.mock só enxerga variáveis assim. O banco de mentira, como o servidor o serve.
const mockDb = {
  tables: { receipts: [] as Row[], receipt_items: [] as Row[] } as Record<string, Row[]>,
  /** O teto de linhas por pedido (max_rows do Supabase). */
  cap: 1000,
  /** O pedido (a contar do zero) que falha. */
  failAt: undefined as number | undefined,
  /** O servidor diz que há mais linhas do que manda. */
  overcount: 0,
  asked: [] as Asked[],
  updates: [] as { table: string; values: Row }[],
  /** As linhas já na ordem pedida: 20 mil linhas não se ordenam de novo a cada página. */
  sorted: new Map<string, { rows: Row[]; result: Row[] }>(),
};

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string, options?: { count?: string }) => {
        const filters: Filter[] = [];
        const order: string[] = [];
        const answer = (range: [number, number] | null) => {
          const request = mockDb.asked.length;
          mockDb.asked.push({ table, columns, count: options?.count, filters: [...filters], order: [...order], range });
          if (request === mockDb.failAt) return { data: null, error: new Error('sem permissão'), count: null };
          const cacheKey = `${table} ${order.join()}`;
          let sorted = mockDb.sorted.get(cacheKey);
          if (sorted?.rows !== mockDb.tables[table]) {
            const keyed = mockDb.tables[table].map((row) => ({ row, key: order.map((column) => String(row[column]).padStart(12, '0')).join(' ') }));
            keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
            sorted = { rows: mockDb.tables[table], result: keyed.map(({ row }) => row) };
            mockDb.sorted.set(cacheKey, sorted);
          }
          const tests = filters.map(({ op, column, value }) => {
            if (op === 'in') {
              const wanted = new Set(value as unknown[]);
              return (row: Row) => wanted.has(row[column]);
            }
            const limit = Date.parse(String(value));
            return (row: Row) => (op === 'gte' ? Date.parse(String(row[column])) >= limit : Date.parse(String(row[column])) < limit);
          });
          const matching = sorted.result.filter((row) => tests.every((test) => test(row)));
          // Sem uma ordem que diga qual linha vem antes (até o id), o banco não promete a mesma sequência a
          // cada pedido: aqui ela vem ao contrário nos pedidos ímpares.
          const rows = order.includes('id') || request % 2 === 0 ? matching : [...matching].reverse();
          const [from, to] = range ?? [0, Infinity];
          return {
            data: rows.slice(from, Math.min(to + 1, from + mockDb.cap)),
            error: null,
            count: options?.count === 'exact' ? matching.length + mockDb.overcount : null,
          };
        };
        const query = {
          gte: (column: string, value: unknown) => (filters.push({ op: 'gte', column, value }), query),
          lt: (column: string, value: unknown) => (filters.push({ op: 'lt', column, value }), query),
          in: (column: string, value: unknown) => (filters.push({ op: 'in', column, value }), query),
          order: (column: string) => (order.push(column), query),
          range: async (from: number, to: number) => answer([from, to]),
          // Pedido sem .range(): o servidor corta no teto, calado.
          then: (resolve: (result: unknown) => void) => resolve(answer(null)),
        };
        return query;
      },
      update: (values: Row) => ({
        eq: async () => {
          mockDb.updates.push({ table, values });
          return { data: null, error: null };
        },
      }),
    }),
  },
  unwrap: (result: { data: unknown; error: unknown }) => {
    if (result.error) throw result.error;
    return result.data;
  },
}));

/** Dia do mês, na hora local do aparelho. */
const at = (year: number, month: number, day: number, hour = 12, minute = 0, second = 0) =>
  new Date(year, month - 1, day, hour, minute, second).toISOString();

const receiptRow = (id: string, purchased_at: string, partial: Row = {}): Row => ({
  id,
  purchased_at,
  total: null,
  status: 'confirmed',
  store_id: 's1',
  store: { name: 'Assaí' },
  ...partial,
});

const lineRow = (receipt_id: string, position: number, partial: Row = {}): Row => ({
  id: `${receipt_id}-${String(position).padStart(5, '0')}`,
  receipt_id,
  position,
  raw_description: `ITEM ${position}`,
  suggested_name: null,
  suggested_category: 'graos',
  product_id: null,
  quantity: 1,
  unit: 'un',
  total_price: 1,
  product: null,
  ...partial,
});

/** `count` itens na nota, guardados fora de ordem. */
const linesOf = (receiptId: string, count: number) => {
  const rows = Array.from({ length: count }, (_, n) => lineRow(receiptId, n));
  return rows.map((_, n) => rows[(n * 7919) % count]);
};

const requests = (table: string) => mockDb.asked.filter((request) => request.table === table);

afterEach(() => {
  mockDb.tables = { receipts: [], receipt_items: [] };
  mockDb.cap = 1000;
  mockDb.failAt = undefined;
  mockDb.overcount = 0;
  mockDb.asked = [];
  mockDb.updates = [];
  mockDb.sorted.clear();
});

describe('notas do mercado do mês', () => {
  it('pede as notas dos dois meses pela data da compra no fuso do aparelho, com mercado, e os itens das confirmadas', async () => {
    mockDb.tables.receipts = [
      receiptRow('set', at(2026, 9, 1, 0, 0, 0), { total: '30.50' }),
      receiptRow('out', at(2026, 10, 31, 23, 59, 59), { store_id: null, store: null }),
      receiptRow('rascunho', at(2026, 10, 5), { status: 'draft', total: 9 }),
      // Um segundo antes e a meia-noite seguinte: fora.
      receiptRow('agosto', at(2026, 8, 31, 23, 59, 59)),
      receiptRow('novembro', at(2026, 11, 1, 0, 0, 0)),
    ];
    mockDb.tables.receipt_items = [
      lineRow('set', 0, { product_id: 'p1', product: { name: 'Arroz', category: 'graos' }, quantity: '2.000', unit: 'kg', total_price: '30.50' }),
      lineRow('out', 1, { raw_description: 'SACOLA', suggested_name: 'Sacola', suggested_category: null, total_price: 0.5 }),
      lineRow('out', 0, { raw_description: 'PAO' }),
      lineRow('rascunho', 0),
      lineRow('agosto', 0),
    ];
    const receipts = await fetchMarketReceipts('2026-09', '2026-10');

    expect(receipts.map((r) => [r.id, r.status, r.lines.length])).toEqual([
      ['set', 'confirmed', 1],
      // O rascunho vem sem itens: só é contado.
      ['rascunho', 'draft', 0],
      ['out', 'confirmed', 2],
    ]);
    expect(receipts[0]).toEqual({
      id: 'set',
      purchasedAt: at(2026, 9, 1, 0, 0, 0),
      status: 'confirmed',
      total: 30.5,
      storeId: 's1',
      storeName: 'Assaí',
      lines: [
        {
          productId: 'p1',
          productName: 'Arroz',
          productCategory: 'graos',
          rawDescription: 'ITEM 0',
          suggestedName: null,
          suggestedCategory: 'graos',
          quantity: 2,
          unit: 'kg',
          totalPrice: 30.5,
        },
      ],
    });
    expect(receipts[2]).toMatchObject({ storeId: null, storeName: null, total: null });
    // Os itens de cada nota na ordem da nota.
    expect(receipts[2].lines.map((l) => l.rawDescription)).toEqual(['PAO', 'SACOLA']);

    expect(requests('receipts')).toEqual([
      {
        table: 'receipts',
        columns: 'id, purchased_at, total, status, store_id, store:stores(name)',
        count: 'exact',
        filters: [
          { op: 'gte', column: 'purchased_at', value: at(2026, 9, 1, 0, 0, 0) },
          { op: 'lt', column: 'purchased_at', value: at(2026, 11, 1, 0, 0, 0) },
        ],
        order: ['purchased_at', 'id'],
        range: [0, 999],
      },
    ]);
    expect(requests('receipt_items')).toEqual([
      {
        table: 'receipt_items',
        columns:
          'receipt_id, raw_description, suggested_name, suggested_category, product_id, quantity, unit, total_price, product:products(name, category)',
        count: 'exact',
        filters: [{ op: 'in', column: 'receipt_id', value: ['set', 'out'] }],
        order: ['receipt_id', 'position', 'id'],
        range: [0, 999],
      },
    ]);
  });

  it('mês sem nota: um pedido só, e nenhum de itens', async () => {
    expect(await fetchMarketReceipts('2026-09', '2026-10')).toEqual([]);
    expect(mockDb.asked).toHaveLength(1);
  });

  it('nota com mais itens do que o servidor manda por pedido: lê todos, página por página, sem repetir nem pular', async () => {
    mockDb.tables.receipts = [receiptRow('a', at(2026, 10, 3)), receiptRow('b', at(2026, 10, 4))];
    mockDb.tables.receipt_items = [...linesOf('a', 1500), ...linesOf('b', 800)];
    const receipts = await fetchMarketReceipts('2026-09', '2026-10');
    expect(receipts.map((r) => r.lines.length)).toEqual([1500, 800]);
    for (const receipt of receipts) {
      expect(new Set(receipt.lines.map((l) => l.rawDescription)).size).toBe(receipt.lines.length);
      expect(receipt.lines.slice(0, 3).map((l) => l.rawDescription)).toEqual(['ITEM 0', 'ITEM 1', 'ITEM 2']);
    }
    expect(requests('receipt_items').map((r) => r.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    // A conta do mês usa todos: R$ 1,00 por item.
    expect(marketMonth(receipts, '2026-10', '2026-11-05').headline).toBe('R$ 2.300,00 em 2 idas');
  });

  it('servidor com o teto menor que a página pedida: a página curta não encerra a leitura', async () => {
    mockDb.cap = 300;
    mockDb.tables.receipts = Array.from({ length: 700 }, (_, n) => receiptRow(`r${String(n).padStart(4, '0')}`, at(2026, 10, 1 + (n % 28), n % 24)));
    mockDb.tables.receipt_items = mockDb.tables.receipts.map((r) => lineRow(String(r.id), 0));
    const receipts = await fetchMarketReceipts('2026-09', '2026-10');
    expect(receipts).toHaveLength(700);
    expect(new Set(receipts.map((r) => r.id)).size).toBe(700);
    expect(receipts.every((r) => r.lines.length === 1)).toBe(true);
    expect(requests('receipts').map((r) => r.range)).toEqual([
      [0, 999],
      [300, 1299],
      [600, 1599],
    ]);
    // Os itens vão por grupos de 100 notas.
    expect(requests('receipt_items')).toHaveLength(7);
    expect(requests('receipt_items').every((r) => (r.filters[0].value as string[]).length === 100)).toBe(true);
  });

  it('erro numa página do meio sobe: nunca um mês pela metade', async () => {
    mockDb.tables.receipts = [receiptRow('a', at(2026, 10, 3))];
    mockDb.tables.receipt_items = linesOf('a', 1500);
    mockDb.failAt = 2;
    await expect(fetchMarketReceipts('2026-09', '2026-10')).rejects.toThrow('sem permissão');
  });

  it('o servidor diz que há mais e não manda: falha, em vez de seguir com o que veio', async () => {
    mockDb.tables.receipts = [receiptRow('a', at(2026, 10, 3))];
    mockDb.tables.receipt_items = linesOf('a', 3);
    mockDb.overcount = 1;
    await expect(fetchMarketReceipts('2026-09', '2026-10')).rejects.toThrow('As notas deste mês não chegaram inteiras. Tente de novo.');
  });

  it('itens demais para ler: falha com aviso claro em vez de cortar', async () => {
    const tooMany = 'Não foi possível carregar todas as notas deste mês: são mais do que o app consegue ler de uma vez.';
    // 150 notas (dois pedidos de itens): o teto é da leitura inteira, não de cada pedido.
    mockDb.tables.receipts = Array.from({ length: 150 }, (_, n) => receiptRow(`r${String(n).padStart(4, '0')}`, at(2026, 10, 1 + (n % 28), n % 24)));
    const ids = mockDb.tables.receipts.map((r) => String(r.id)).sort();
    mockDb.tables.receipt_items = [...linesOf(ids[0], 19_000), ...linesOf(ids[120], 1001)];
    await expect(fetchMarketReceipts('2026-09', '2026-10')).rejects.toThrow(tooMany);
    // Exatamente no teto, ainda carrega tudo.
    mockDb.asked = [];
    mockDb.tables.receipt_items = [...linesOf(ids[0], 19_000), ...linesOf(ids[120], 1000)];
    const receipts = await fetchMarketReceipts('2026-09', '2026-10');
    expect(receipts.reduce((sum, r) => sum + r.lines.length, 0)).toBe(20_000);
  });

  it('notas demais para ler: falha logo no primeiro pedido', async () => {
    mockDb.tables.receipts = Array.from({ length: 2001 }, (_, n) => receiptRow(`r${String(n).padStart(4, '0')}`, at(2026, 10, 1 + (n % 28), n % 24)));
    await expect(fetchMarketReceipts('2026-09', '2026-10')).rejects.toThrow('são mais do que o app consegue ler de uma vez');
    expect(mockDb.asked).toHaveLength(1);
  });
});

describe('na tela', () => {
  /** Monta o que usa a consulta e espera a busca terminar. */
  async function mount(queryClient: QueryClient, Probe: () => null, done: () => boolean) {
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

  it('a tela recebe o mês e o anterior, numa chave que começa com "spending"', async () => {
    mockDb.tables.receipts = [receiptRow('set', at(2026, 9, 10)), receiptRow('out', at(2026, 10, 10)), receiptRow('ago', at(2026, 8, 10))];
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const seen: (MarketReceipt[] | undefined)[] = [];
    function Probe() {
      seen.push(useMarketReceipts('2026-10').data);
      return null;
    }
    const renderer = await mount(queryClient, Probe, () => seen.at(-1) !== undefined);
    expect(seen.at(-1)?.map((r) => r.id)).toEqual(['set', 'out']);
    // Quem invalida 'spending' (confirmar, mudar ou excluir uma nota) recarrega esta consulta também.
    expect(queryClient.getQueryCache().findAll({ queryKey: ['spending'] }).map((q) => q.queryKey)).toEqual([['spending', 'market', '2026-10']]);
    await act(async () => renderer.unmount());
    queryClient.clear();
  });

  it('mudar o nome ou a categoria de um produto recarrega os gastos (resumo e mercado do mês), além dos produtos', async () => {
    // gcTime: sem ele, a mutação guardada por 5 minutos segura o Jest aberto.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
    queryClient.setQueryData(['spending', 'market', '2026-10'], []);
    queryClient.setQueryData(['spending', '2026-04', '2026-10'], []);
    queryClient.setQueryData(['products'], []);
    queryClient.setQueryData(['receipts'], []);
    let rename: ReturnType<typeof useRenameProduct> | undefined;
    function Probe() {
      rename = useRenameProduct();
      return null;
    }
    const renderer = await mount(queryClient, Probe, () => true);
    await act(async () => {
      await rename!.mutateAsync({ id: 'p1', name: 'Sabão em pó', category: 'limpeza' });
    });
    expect(mockDb.updates).toEqual([{ table: 'products', values: { name: 'Sabão em pó', category: 'limpeza' } }]);
    const invalidated = (key: unknown[]) => queryClient.getQueryState(key)?.isInvalidated;
    expect(invalidated(['spending', 'market', '2026-10'])).toBe(true);
    expect(invalidated(['spending', '2026-04', '2026-10'])).toBe(true);
    expect(invalidated(['products'])).toBe(true);
    expect(invalidated(['receipts'])).toBe(false);
    await act(async () => renderer.unmount());
    queryClient.clear();
  });
});
