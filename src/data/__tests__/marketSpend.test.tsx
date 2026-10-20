import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { summarize, type Entry } from '@/domain/finance';
import { marketMonth, marketTotal, type MarketReceipt, type MarketTotalReceipt } from '@/domain/marketSpend';

import { useSpending, useSpendingReceipts } from '../finance';
import { useRenameProduct } from '../market';
import { fetchMarketReceipts, useMarketReceipts } from '../marketSpend';

type Row = Record<string, unknown>;
type Filter = { op: 'gte' | 'lt' | 'in' | 'gt' | 'eq'; column: string; value: unknown };
type Asked = { table: string; columns: string; count: string | undefined; filters: Filter[]; order: string[]; limit: number | null };

// "mock" no nome: o jest.mock só enxerga variáveis assim. O banco de mentira, como o servidor o serve.
const mockDb = {
  tables: { receipts: [] as Row[], receipt_items: [] as Row[], bill_payments: [] as Row[], expenses: [] as Row[] } as Record<string, Row[]>,
  /** O teto de linhas por pedido (max_rows do Supabase). */
  cap: 1000,
  /** O pedido (a contar do zero) que falha. */
  failAt: undefined as number | undefined,
  /** O servidor diz que há mais linhas do que manda. */
  overcount: 0,
  /** O que muda no banco logo antes de um pedido (a contar do zero): outra pessoa da casa mexendo numa nota entre duas páginas. */
  before: new Map<number, () => void>(),
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
        // A ordem de um valor no banco de mentira: a mesma para ordenar e para o "maior que" do cursor.
        const rank = (value: unknown) => String(value).padStart(12, '0');
        const answer = (limit: number | null) => {
          const request = mockDb.asked.length;
          mockDb.asked.push({ table, columns, count: options?.count, filters: [...filters], order: [...order], limit });
          mockDb.before.get(request)?.();
          if (request === mockDb.failAt) return { data: null, error: new Error('sem permissão'), count: null };
          const cacheKey = `${table} ${order.join()}`;
          let sorted = mockDb.sorted.get(cacheKey);
          if (sorted?.rows !== mockDb.tables[table]) {
            const keyed = mockDb.tables[table].map((row) => ({ row, key: order.map((column) => rank(row[column])).join(' ') }));
            keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
            sorted = { rows: mockDb.tables[table], result: keyed.map(({ row }) => row) };
            mockDb.sorted.set(cacheKey, sorted);
          }
          const tests = filters.map(({ op, column, value }) => {
            if (op === 'in') {
              const wanted = new Set(value as unknown[]);
              return (row: Row) => wanted.has(row[column]);
            }
            if (op === 'eq') return (row: Row) => row[column] === value;
            if (op === 'gt') return (row: Row) => rank(row[column]) > rank(value);
            const edge = Date.parse(String(value));
            return (row: Row) => (op === 'gte' ? Date.parse(String(row[column])) >= edge : Date.parse(String(row[column])) < edge);
          });
          const matching = sorted.result.filter((row) => tests.every((test) => test(row)));
          // Sem uma ordem que diga qual linha vem antes (até o id), o banco não promete a mesma sequência a
          // cada pedido: aqui ela vem ao contrário nos pedidos ímpares.
          const rows = order.includes('id') || request % 2 === 0 ? matching : [...matching].reverse();
          return {
            data: rows.slice(0, Math.min(limit ?? Infinity, mockDb.cap)),
            error: null,
            // A contagem é a do que o pedido filtra: com o cursor, só o que vem depois dele.
            count: options?.count === 'exact' ? matching.length + mockDb.overcount : null,
          };
        };
        const query = {
          gte: (column: string, value: unknown) => (filters.push({ op: 'gte', column, value }), query),
          lt: (column: string, value: unknown) => (filters.push({ op: 'lt', column, value }), query),
          in: (column: string, value: unknown) => (filters.push({ op: 'in', column, value }), query),
          gt: (column: string, value: unknown) => (filters.push({ op: 'gt', column, value }), query),
          eq: (column: string, value: unknown) => (filters.push({ op: 'eq', column, value }), query),
          order: (column: string) => (order.push(column), query),
          limit: async (count: number) => answer(count),
          // Pedido sem .limit(): o servidor corta no teto, calado.
          then: (resolve: (result: unknown) => void) => resolve(answer(null)),
        };
        return query;
      },
      update: (values: Row) => ({
        // A gravação do produto pede a linha de volta (o produto existe).
        eq: (_column: string, id: string) => ({
          select: async () => {
            mockDb.updates.push({ table, values });
            return { data: [{ id }], error: null };
          },
        }),
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

/** Depois de qual id cada pedido continuou: null no primeiro de cada leitura. */
const cursors = (table: string) => requests(table).map((request) => request.filters.find((filter) => filter.op === 'gt')?.value ?? null);

afterEach(() => {
  mockDb.tables = { receipts: [], receipt_items: [], bill_payments: [], expenses: [] };
  mockDb.cap = 1000;
  mockDb.failAt = undefined;
  mockDb.overcount = 0;
  mockDb.before.clear();
  mockDb.asked = [];
  mockDb.updates = [];
  mockDb.sorted.clear();
});

describe('notas do mercado do mês', () => {
  it('pede as notas dos dois meses pela data da compra no fuso do aparelho, com mercado, e os itens das confirmadas', async () => {
    mockDb.tables.receipts = [
      // O endereço e o CNPJ do mercado vêm junto: separam dois mercados de mesmo nome.
      receiptRow('set', at(2026, 9, 1, 0, 0, 0), { total: '30.50', store: { name: 'Assaí', address: 'Av. Brasil, 100', cnpj: '12345678000190' } }),
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
      storeAddress: 'Av. Brasil, 100',
      storeCnpj: '12345678000190',
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
    expect(receipts[2]).toMatchObject({ storeId: null, storeName: null, storeAddress: null, storeCnpj: null, total: null });
    // Os itens de cada nota na ordem da nota.
    expect(receipts[2].lines.map((l) => l.rawDescription)).toEqual(['PAO', 'SACOLA']);

    expect(requests('receipts')).toEqual([
      {
        table: 'receipts',
        columns: 'id, purchased_at, total, status, store_id, store:stores(name, address, cnpj)',
        count: 'exact',
        filters: [
          { op: 'gte', column: 'purchased_at', value: at(2026, 9, 1, 0, 0, 0) },
          { op: 'lt', column: 'purchased_at', value: at(2026, 11, 1, 0, 0, 0) },
        ],
        // As páginas vão pelo id, que não muda de lugar; quem ordena por data é o app, depois de ler tudo.
        order: ['id'],
        limit: 1000,
      },
    ]);
    expect(requests('receipt_items')).toEqual([
      {
        table: 'receipt_items',
        columns:
          'id, receipt_id, position, raw_description, suggested_name, suggested_category, product_id, quantity, unit, total_price, product:products(name, category)',
        count: 'exact',
        filters: [{ op: 'in', column: 'receipt_id', value: ['set', 'out'] }],
        order: ['id'],
        limit: 1000,
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
    // Cada página continua depois do último id da anterior.
    expect(cursors('receipt_items')).toEqual([null, 'a-00999', 'b-00499']);
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
    expect(cursors('receipts')).toEqual([null, 'r0299', 'r0599']);
    // Os itens vão por grupos de 100 notas.
    expect(requests('receipt_items')).toHaveLength(7);
    expect(requests('receipt_items').every((r) => (r.filters[0].value as string[]).length === 100)).toBe(true);
  });

  it('um item apagado antes do ponto em que a leitura está e outro incluído depois dele, entre duas páginas: nada pulado, nada repetido', async () => {
    mockDb.tables.receipts = [receiptRow('a', at(2026, 10, 3)), receiptRow('b', at(2026, 10, 4))];
    mockDb.tables.receipt_items = [...linesOf('a', 600), ...linesOf('b', 900)];
    // Pedidos: 0, as notas; 1, a primeira página de itens (até b-00399); 2, a segunda.
    mockDb.before.set(2, () => {
      mockDb.tables.receipt_items = [...mockDb.tables.receipt_items.filter((row) => row.id !== 'a-00010'), lineRow('b', 950)];
    });
    const receipts = await fetchMarketReceipts('2026-09', '2026-10');
    expect(cursors('receipt_items')).toEqual([null, 'b-00399']);
    const names = (id: string) => receipts.find((r) => r.id === id)!.lines.map((l) => l.rawDescription);
    // O que já tinha sido lido fica como foi lido; daí em diante, tudo o que existe, uma vez só.
    expect(names('a')).toEqual(Array.from({ length: 600 }, (_, n) => `ITEM ${n}`));
    expect(names('b')).toEqual([...Array.from({ length: 900 }, (_, n) => `ITEM ${n}`), 'ITEM 950']);
  });

  it('um item apagado entre duas páginas, sem nenhum novo: o resto vem inteiro', async () => {
    mockDb.tables.receipts = [receiptRow('a', at(2026, 10, 3))];
    mockDb.tables.receipt_items = linesOf('a', 1500);
    mockDb.before.set(2, () => {
      mockDb.tables.receipt_items = mockDb.tables.receipt_items.filter((row) => row.id !== 'a-00000' && row.id !== 'a-01499');
    });
    const [receipt] = await fetchMarketReceipts('2026-09', '2026-10');
    // O último item sumiu antes de ser lido; o primeiro, depois: 1.499 itens, sem pular nenhum dos que ficaram.
    expect(receipt.lines).toHaveLength(1499);
    expect(receipt.lines.at(-1)?.rawDescription).toBe('ITEM 1498');
    expect(new Set(receipt.lines.map((l) => l.rawDescription)).size).toBe(1499);
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
    await expect(fetchMarketReceipts('2026-09', '2026-10')).rejects.toThrow('As notas destes meses não chegaram inteiras. Tente de novo.');
  });

  it('itens demais para ler: falha com aviso claro em vez de cortar', async () => {
    const tooMany = 'Não foi possível carregar todas as notas destes meses: são mais do que o app consegue ler de uma vez.';
    // 150 notas (dois pedidos de itens): o teto é da leitura inteira, não de cada pedido.
    mockDb.tables.receipts = Array.from({ length: 150 }, (_, n) => receiptRow(`r${String(n).padStart(4, '0')}`, at(2026, 10, 1 + (n % 28), n % 24)));
    const ids = mockDb.tables.receipts.map((r) => String(r.id)).sort();
    mockDb.tables.receipt_items = [...linesOf(ids[0], 59_000), ...linesOf(ids[120], 1001)];
    await expect(fetchMarketReceipts('2026-09', '2026-10')).rejects.toThrow(tooMany);
    // Exatamente no teto, ainda carrega tudo.
    mockDb.asked = [];
    mockDb.tables.receipt_items = [...linesOf(ids[0], 59_000), ...linesOf(ids[120], 1000)];
    const receipts = await fetchMarketReceipts('2026-09', '2026-10');
    expect(receipts.reduce((sum, r) => sum + r.lines.length, 0)).toBe(60_000);
  });

  it('notas demais para ler: falha logo no primeiro pedido', async () => {
    mockDb.tables.receipts = Array.from({ length: 6001 }, (_, n) => receiptRow(`r${String(n).padStart(4, '0')}`, at(2026, 10, 1 + (n % 28), n % 24)));
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

  it('a tela recebe o mês e os cinco antes dele (o anterior e os da tendência), numa chave que começa com "spending"', async () => {
    mockDb.tables.receipts = [
      receiptRow('set', at(2026, 9, 10)),
      receiptRow('out', at(2026, 10, 10)),
      receiptRow('mai', at(2026, 5, 1, 0)),
      // Antes do primeiro mês da tendência e depois do mês da tela: ficam de fora.
      receiptRow('abr', at(2026, 4, 30, 23)),
      receiptRow('nov', at(2026, 11, 1, 0)),
    ];
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const seen: (MarketReceipt[] | undefined)[] = [];
    function Probe() {
      seen.push(useMarketReceipts('2026-10').data);
      return null;
    }
    const renderer = await mount(queryClient, Probe, () => seen.at(-1) !== undefined);
    expect(seen.at(-1)?.map((r) => r.id)).toEqual(['mai', 'set', 'out']);
    // Quem invalida 'spending' (confirmar, mudar ou excluir uma nota) recarrega esta consulta também.
    expect(queryClient.getQueryCache().findAll({ queryKey: ['spending'] }).map((q) => q.queryKey)).toEqual([['spending', 'market', '2026-10']]);
    await act(async () => renderer.unmount());
    queryClient.clear();
  });

  it('a entrada no resumo não custa outra leitura: o total sai das notas que o resumo já leu, e é o mesmo da tela', async () => {
    mockDb.tables.receipts = [
      receiptRow('set', at(2026, 9, 10)),
      receiptRow('mista', at(2026, 10, 3), { total: 172 }),
      receiptRow('perdida', at(2026, 10, 5), { total: 29 }),
      receiptRow('farmacia', at(2026, 10, 6), { total: 20 }),
      receiptRow('rascunho', at(2026, 10, 7), { status: 'draft', total: 50 }),
    ];
    mockDb.tables.receipt_items = [
      lineRow('set', 0, { total_price: 30 }),
      lineRow('mista', 0, { product_id: 'p1', product: { name: 'Shampoo', category: 'higiene' }, total_price: 12 }),
      lineRow('mista', 1, { suggested_category: 'medicamentos', total_price: 200 }),
      lineRow('perdida', 0, { total_price: 9 }),
      lineRow('farmacia', 0, { suggested_category: 'suplementos', total_price: 25 }),
      lineRow('rascunho', 0, { total_price: 50 }),
    ];
    // O resumo pede os itens embutidos em cada nota: o servidor de mentira os entrega assim.
    for (const row of mockDb.tables.receipts) row.receipt_items = mockDb.tables.receipt_items.filter((item) => item.receipt_id === row.id);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const seen: { entries?: Entry[]; receipts?: MarketTotalReceipt[] } = {};
    function Probe() {
      seen.entries = useSpending('2026-09', '2026-10').data;
      seen.receipts = useSpendingReceipts('2026-09', '2026-10').data;
      return null;
    }
    const renderer = await mount(queryClient, Probe, () => seen.receipts !== undefined);
    // Uma busca só para os dois: notas, contas pagas e gastos avulsos, uma vez cada, e nenhum pedido de itens à parte.
    expect(mockDb.asked.map((request) => request.table)).toEqual(['receipts', 'bill_payments', 'expenses']);
    expect(queryClient.getQueryCache().findAll({ queryKey: ['spending'] }).map((q) => q.queryKey)).toEqual([['spending', '2026-09', '2026-10']]);
    // O resumo continua recebendo os lançamentos, com os mesmos números: 172 + 29 + 20.
    expect(Array.isArray(seen.entries)).toBe(true);
    expect(summarize(seen.entries!, { start: '2026-10-01', end: '2026-11-01' }).total).toBe(221);
    // E o total da entrada é o que a tela mostra com a leitura dela: 9,74 do shampoo (com a parte dele no desconto) e 29.
    const row = marketTotal(seen.receipts!, '2026-10');
    expect(row.headline).toBe('R$ 38,74 em 2 idas');
    const screen = marketMonth(await fetchMarketReceipts('2026-09', '2026-10'), '2026-10', '2026-10-13');
    expect(screen.headline).toBe(row.headline);
    expect(screen.totalCents).toBe(row.totalCents);
    expect(marketTotal(seen.receipts!, '2026-09').headline).toBe('R$ 30,00 em 1 ida');
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
