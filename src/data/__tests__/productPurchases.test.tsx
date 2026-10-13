import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { storeKey, type Purchase } from '@/domain/priceHistory';

import { fetchProductPurchases, PURCHASE_MAX_LINES, useProductPurchases } from '../market';

interface ItemRow {
  id: string;
  receipt_id: string;
  product_id: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total_price: number;
  /** A nota da linha, como está no banco. */
  receipt: { status: 'draft' | 'confirmed'; purchased_at: string; store_id: string | null; store: { name: string } | null };
}

interface Asked {
  table: string;
  columns: string;
  count: string | undefined;
  filters: [string, string, unknown][];
  order: string[];
  limit: number | null;
}

// "mock" no nome: o jest.mock só enxerga variáveis assim. A tabela de mentira, como o servidor a serve.
const mockTable = {
  rows: [] as ItemRow[],
  /** O teto de linhas por pedido (max_rows do Supabase). */
  cap: 1000,
  /** O servidor manda a contagem (Content-Range)? */
  counts: true,
  /** O pedido (a contar do zero) que falha. */
  failAt: undefined as number | undefined,
  /** O pedido (a contar do zero) que volta vazio, com a contagem em zero: o que o servidor responde a quem ficou sem sessão. */
  emptyAt: undefined as number | undefined,
  /** O que acontece no banco logo antes de um pedido ser respondido (recebe o número dele, a contar do zero). */
  before: undefined as ((request: number) => void) | undefined,
  asked: [] as Asked[],
  /** As linhas já por id: milhares delas não se ordenam de novo a cada página. */
  sorted: undefined as { rows: ItemRow[]; result: ItemRow[] } | undefined,
};

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string, options?: { count?: string }) => {
        const asked: Asked = { table, columns, count: options?.count, filters: [], order: [], limit: null };
        const answer = () => {
          const request = mockTable.asked.length;
          mockTable.asked.push(asked);
          mockTable.before?.(request);
          if (request === mockTable.failAt) return { data: null, count: null, error: new Error('sem permissão') };
          if (request === mockTable.emptyAt) return { data: [], count: options?.count === 'exact' ? 0 : null, error: null };
          if (mockTable.sorted?.rows !== mockTable.rows) {
            mockTable.sorted = { rows: mockTable.rows, result: [...mockTable.rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) };
          }
          // Sem a ordem por id, o banco não promete a mesma sequência a cada pedido: aqui vem ao contrário nos ímpares.
          const ordered = asked.order.includes('id') || request % 2 === 0 ? mockTable.sorted.result : [...mockTable.sorted.result].reverse();
          // Como no PostgREST: o filtro numa coluna da nota só tira a linha com !inner; sem ele, a linha vem com a nota vazia.
          const inner = /receipt:receipts!inner\(/.test(columns);
          const found = ordered
            .filter((row) =>
              asked.filters.every(([op, column, value]) => {
                if (column.startsWith('receipt.')) return !inner || row.receipt[column.slice(8) as 'status'] === value;
                const cell = row[column as keyof ItemRow] as string;
                return op === 'gt' ? cell > (value as string) : cell === value;
              }),
            )
            .map(({ product_id: _product, receipt: { status, ...receipt }, ...row }) => ({
              ...row,
              receipt: asked.filters.every(([, column, value]) => !column.startsWith('receipt.') || status === value) ? receipt : null,
            }));
          return {
            data: found.slice(0, Math.min(asked.limit ?? Infinity, mockTable.cap)),
            count: mockTable.counts && options?.count === 'exact' ? found.length : null,
            error: null,
          };
        };
        const query = {
          eq: (column: string, value: unknown) => {
            asked.filters.push(['eq', column, value]);
            return query;
          },
          gt: (column: string, value: unknown) => {
            asked.filters.push(['gt', column, value]);
            return query;
          },
          order: (column: string) => {
            asked.order.push(column);
            return query;
          },
          limit: (count: number) => {
            asked.limit = count;
            return query;
          },
          then: (resolve: (result: unknown) => void, reject: (error: unknown) => void) => Promise.resolve().then(answer).then(resolve, reject),
        };
        return query;
      },
    }),
  },
  unwrap: (result: { data: unknown; error: unknown }) => {
    if (result.error) throw result.error;
    return result.data;
  },
}));

const assai = { store_id: 'assai', store: { name: 'Assaí' } };

/** `count` linhas de notas confirmadas do arroz, uma por nota, guardadas fora de ordem. */
function riceLines(count: number): ItemRow[] {
  const rows = Array.from({ length: count }, (_, n): ItemRow => ({
    id: `i${String(n).padStart(6, '0')}`,
    receipt_id: `r${n}`,
    product_id: 'arroz',
    quantity: 1,
    unit: 'un',
    unit_price: 20 + (n % 50) / 10,
    total_price: 20 + (n % 50) / 10,
    receipt: { status: 'confirmed', purchased_at: '2026-10-01T15:00:00+00:00', ...assai },
  }));
  return rows.map((_, n) => rows[(n * 7919) % count]);
}

const draft = (id: string): ItemRow => ({ ...riceLines(1)[0], id, receipt_id: 'r-rascunho', receipt: { status: 'draft', purchased_at: '2026-10-05T15:00:00+00:00', ...assai } });
const otherProduct = (id: string): ItemRow => ({ ...riceLines(1)[0], id, product_id: 'feijao', receipt_id: 'r-feijao' });

afterEach(() => {
  mockTable.rows = [];
  mockTable.cap = 1000;
  mockTable.counts = true;
  mockTable.failAt = undefined;
  mockTable.emptyAt = undefined;
  mockTable.before = undefined;
  mockTable.asked = [];
});

describe('as compras de um produto', () => {
  it('lê todas, página por página, cada uma depois da última linha lida', async () => {
    mockTable.rows = [...riceLines(2300), draft('i000500-rascunho'), otherProduct('i001500-feijao')];
    const lines = await fetchProductPurchases('arroz');
    expect(lines).toHaveLength(2300);
    expect(new Set(lines.map((l) => l.id)).size).toBe(2300);
    expect(mockTable.asked).toHaveLength(3);
    for (const request of mockTable.asked) {
      expect(request).toMatchObject({
        table: 'receipt_items',
        columns: 'id, receipt_id, quantity, unit, unit_price, total_price, receipt:receipts!inner(purchased_at, store_id, store:stores(name))',
        count: 'exact',
        order: ['id'],
        limit: 1000,
      });
      expect(request.filters).toEqual(expect.arrayContaining([['eq', 'product_id', 'arroz'], ['eq', 'receipt.status', 'confirmed']]));
    }
    expect(mockTable.asked.map((request) => request.filters.find(([op]) => op === 'gt')?.[2])).toEqual([undefined, 'i000999', 'i001999']);
  });

  it('a linha chega como o histórico a usa', async () => {
    mockTable.rows = [
      { id: 'i1', receipt_id: 'r1', product_id: 'arroz', quantity: 2, unit: 'un', unit_price: 25.9, total_price: 51.8, receipt: { status: 'confirmed', purchased_at: '2026-10-10T15:00:00+00:00', ...assai } },
      // Nota sem mercado conta.
      { id: 'i2', receipt_id: 'r2', product_id: 'arroz', quantity: 0.755, unit: 'kg', unit_price: 39.9, total_price: 30.12, receipt: { status: 'confirmed', purchased_at: '2026-09-03T15:00:00+00:00', store_id: null, store: null } },
    ];
    expect(await fetchProductPurchases('arroz')).toEqual([
      { id: 'i1', receiptId: 'r1', storeId: 'assai', storeName: 'Assaí', purchasedAt: '2026-10-10T15:00:00+00:00', quantity: 2, unit: 'un', unitPrice: 25.9, totalPrice: 51.8 },
      { id: 'i2', receiptId: 'r2', storeId: null, storeName: null, purchasedAt: '2026-09-03T15:00:00+00:00', quantity: 0.755, unit: 'kg', unitPrice: 39.9, totalPrice: 30.12 },
    ]);
    expect(mockTable.asked).toHaveLength(1);
  });

  it('rascunho nunca conta, nem linha de outro produto: quem tira é a consulta', async () => {
    mockTable.rows = [...riceLines(3), draft('i-rascunho'), otherProduct('i-feijao')];
    const lines = await fetchProductPurchases('arroz');
    expect(lines.map((l) => l.id).sort()).toEqual(['i000000', 'i000001', 'i000002']);
    // Só rascunhos: produto sem compra nenhuma.
    mockTable.rows = [draft('i-rascunho')];
    expect(await fetchProductPurchases('arroz')).toEqual([]);
  });

  it('página cheia que é exatamente o que há: a contagem diz que acabou, sem pedir outra', async () => {
    mockTable.rows = riceLines(1000);
    expect(await fetchProductPurchases('arroz')).toHaveLength(1000);
    expect(mockTable.asked).toHaveLength(1);
  });

  it('página curta não é o fim: o servidor que corta em menos linhas é lido até a contagem fechar', async () => {
    mockTable.rows = riceLines(2300);
    mockTable.cap = 400;
    const lines = await fetchProductPurchases('arroz');
    expect(lines).toHaveLength(2300);
    expect(new Set(lines.map((l) => l.id)).size).toBe(2300);
    expect(mockTable.asked).toHaveLength(6);
  });

  it('sem a contagem do servidor, lê até a página vir vazia', async () => {
    mockTable.rows = riceLines(900);
    mockTable.cap = 400;
    mockTable.counts = false;
    expect(await fetchProductPurchases('arroz')).toHaveLength(900);
    // 400, 400, 100 e a vazia que diz que acabou.
    expect(mockTable.asked).toHaveLength(4);
  });

  it('erro numa página do meio sobe: nunca um histórico pela metade', async () => {
    mockTable.rows = riceLines(2300);
    mockTable.failAt = 1;
    await expect(fetchProductPurchases('arroz')).rejects.toThrow('sem permissão');
  });

  it('página vazia depois de o servidor dizer que ainda havia linhas: falha, em vez de dar a parte lida como o histórico inteiro', async () => {
    // A sessão venceu entre uma página e outra: o servidor responde 200, sem linha nenhuma e com a contagem em zero.
    mockTable.rows = riceLines(1500);
    mockTable.emptyAt = 1;
    await expect(fetchProductPurchases('arroz')).rejects.toThrow('Não foi possível carregar o histórico inteiro deste produto. Tente de novo.');
    expect(mockTable.asked).toHaveLength(2);
    // Na tentativa seguinte, com tudo no lugar, vem inteiro.
    mockTable.asked = [];
    mockTable.emptyAt = undefined;
    expect(await fetchProductPurchases('arroz')).toHaveLength(1500);
    // Uma leitura que já começa vazia é só um produto sem compras.
    mockTable.asked = [];
    mockTable.emptyAt = 0;
    expect(await fetchProductPurchases('arroz')).toEqual([]);
  });

  it('linhas apagadas no meio da leitura (a página seguinte vem mais curta, não vazia) não são erro', async () => {
    mockTable.rows = riceLines(1500);
    // Entre a primeira página (que prometeu mais 500) e a segunda, alguém exclui uma nota: sobram 499.
    mockTable.before = (request) => {
      if (request === 1) mockTable.rows = mockTable.rows.filter((row) => row.id !== 'i001499');
    };
    expect(await fetchProductPurchases('arroz')).toHaveLength(1499);
    expect(mockTable.asked).toHaveLength(2);
  });

  it('compras demais para ler: falha com aviso claro, sem mostrar o histórico cortado', async () => {
    expect(PURCHASE_MAX_LINES).toBe(5000);
    mockTable.rows = riceLines(5001);
    await expect(fetchProductPurchases('arroz')).rejects.toThrow(
      'Não foi possível carregar o histórico deste produto: são mais compras do que o app consegue ler de uma vez.',
    );
    // A contagem do primeiro pedido já diz: não lê o resto.
    expect(mockTable.asked).toHaveLength(1);
    // Exatamente no teto, carrega tudo.
    mockTable.asked = [];
    mockTable.rows = riceLines(5000);
    expect(await fetchProductPurchases('arroz')).toHaveLength(5000);
    expect(mockTable.asked).toHaveLength(5);
    // Sem a contagem, o teto vale pelo que foi lido.
    mockTable.asked = [];
    mockTable.rows = riceLines(5001);
    mockTable.counts = false;
    await expect(fetchProductPurchases('arroz')).rejects.toThrow('são mais compras do que o app consegue ler de uma vez');
  });

  it('a tela recebe as compras já montadas, numa chave que começa com priceHistory (confirmar ou excluir nota recarrega)', async () => {
    mockTable.rows = riceLines(1500);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const seen: (Purchase[] | undefined)[] = [];
    function Probe() {
      seen.push(useProductPurchases('arroz').data);
      return null;
    }
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    const settle = async (done: () => boolean) => {
      for (let turn = 0; turn < 50 && !done(); turn++) {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      }
    };
    await settle(() => seen.at(-1) !== undefined);
    expect(seen.at(-1)).toHaveLength(1500);
    // Na seção, o mercado é o nome dele (domain/priceHistory, storeKey).
    expect(seen.at(-1)![0]).toMatchObject({ store: storeKey('Assaí'), storeName: 'Assaí', baseUnit: 'un', discounted: false });
    expect(queryClient.getQueryData(['priceHistory', 'purchases', 'arroz'])).toHaveLength(1500);

    // O que confirmar e excluir uma nota fazem (data/receipts): invalidar ['priceHistory'] busca as compras de novo.
    mockTable.rows = riceLines(1501);
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['priceHistory'] });
    });
    await settle(() => seen.at(-1)?.length === 1501);
    expect(seen.at(-1)).toHaveLength(1501);
    await act(async () => renderer?.unmount());
    queryClient.clear();
  });
});
