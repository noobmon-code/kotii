import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { LatestPrice } from '@/lib/types';

import { fetchLatestPrices, useLatestPrices } from '../market';

// "mock" no nome: o jest.mock só enxerga variáveis assim. A view de mentira, como o servidor a serve.
const mockView = {
  rows: [] as LatestPrice[],
  /** O teto de linhas por pedido (max_rows do Supabase). */
  cap: 1000,
  /** O pedido (a contar do zero) que falha. */
  failAt: undefined as number | undefined,
  asked: [] as { table: string; columns: string; order: string[]; range: [number, number] | null }[],
  /** As linhas já na ordem pedida: 20 mil linhas não se ordenam de novo a cada página. */
  sorted: undefined as { rows: LatestPrice[]; order: string; result: LatestPrice[] } | undefined,
};

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => {
        const order: string[] = [];
        const answer = (range: [number, number] | null) => {
          const request = mockView.asked.length;
          mockView.asked.push({ table, columns, order: [...order], range });
          if (request === mockView.failAt) return { data: null, error: new Error('sem permissão') };
          if (mockView.sorted?.rows !== mockView.rows || mockView.sorted.order !== order.join()) {
            const keyed = mockView.rows.map((row) => ({ row, key: order.map((column) => String(row[column as keyof LatestPrice])).join(' ') }));
            keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
            mockView.sorted = { rows: mockView.rows, order: order.join(), result: keyed.map(({ row }) => row) };
          }
          // Sem uma ordem que diga qual linha vem antes (a chave da view inteira), o banco não promete a mesma
          // sequência a cada pedido: aqui ela vem ao contrário nos pedidos ímpares.
          const total = ['product_id', 'store_id', 'unit'].every((column) => order.includes(column));
          const rows = total || request % 2 === 0 ? mockView.sorted.result : [...mockView.sorted.result].reverse();
          const [from, to] = range ?? [0, Infinity];
          return { data: rows.slice(from, Math.min(to + 1, from + mockView.cap)), error: null };
        };
        const query = {
          order: (column: string) => {
            order.push(column);
            return query;
          },
          range: async (from: number, to: number) => answer([from, to]),
          // Pedido sem .range(): o servidor corta no teto, calado.
          then: (resolve: (result: unknown) => void) => resolve(answer(null)),
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

/** `count` preços, um por produto, guardados fora de ordem. */
function prices(count: number): LatestPrice[] {
  const rows = Array.from({ length: count }, (_, n): LatestPrice => ({
    product_id: `p${String(n).padStart(6, '0')}`,
    store_id: n % 3 ? 'assai' : 'dia',
    unit: 'un',
    unit_price: 1 + (n % 50) / 10,
    purchased_at: '2026-10-01T12:00:00Z',
  }));
  return rows.map((_, n) => rows[(n * 7919) % count]);
}

const ranges = () => mockView.asked.map((request) => request.range);

afterEach(() => {
  mockView.rows = [];
  mockView.failAt = undefined;
  mockView.asked = [];
});

describe('últimos preços da casa', () => {
  it('lê todos, página por página, na ordem da chave da view: nenhum preço de fora nem repetido', async () => {
    mockView.rows = prices(2300);
    const rows = await fetchLatestPrices();
    expect(rows).toHaveLength(2300);
    expect(new Set(rows.map((row) => `${row.product_id} ${row.store_id} ${row.unit}`)).size).toBe(2300);
    expect(ranges()).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    for (const request of mockView.asked) {
      expect(request).toMatchObject({
        table: 'latest_prices',
        columns: 'product_id, store_id, unit, unit_price, purchased_at',
        order: ['product_id', 'store_id', 'unit'],
      });
    }
    // As linhas chegam como a view as dá: o que está guardado no aparelho continua servindo.
    expect(rows[0]).toEqual({ product_id: 'p000000', store_id: 'dia', unit: 'un', unit_price: 1, purchased_at: '2026-10-01T12:00:00Z' });
  });

  it('casa com poucos preços: um pedido só', async () => {
    mockView.rows = prices(12);
    expect(await fetchLatestPrices()).toHaveLength(12);
    expect(ranges()).toEqual([[0, 999]]);
  });

  it('página exata pede mais uma, que volta vazia', async () => {
    mockView.rows = prices(2000);
    expect(await fetchLatestPrices()).toHaveLength(2000);
    expect(ranges()).toHaveLength(3);
  });

  it('erro numa página do meio sobe: nunca uma lista pela metade', async () => {
    mockView.rows = prices(2300);
    mockView.failAt = 1;
    await expect(fetchLatestPrices()).rejects.toThrow('sem permissão');
  });

  it('preços demais para ler: falha com aviso claro em vez de devolver a lista cortada', async () => {
    mockView.rows = prices(20_001);
    await expect(fetchLatestPrices()).rejects.toThrow(
      'Não foi possível carregar todos os preços da casa: são mais do que o app consegue ler de uma vez.',
    );
    expect(ranges()).toHaveLength(20);
    // Logo abaixo do teto, ainda carrega tudo.
    mockView.asked = [];
    mockView.rows = prices(19_999);
    expect(await fetchLatestPrices()).toHaveLength(19_999);
  });

  it('a tela recebe a lista inteira, na mesma chave do cache', async () => {
    mockView.rows = prices(1500);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const seen: (number | undefined)[] = [];
    function Probe() {
      seen.push(useLatestPrices().data?.length);
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
    // A busca (duas páginas) termina e a tela recebe o resultado.
    for (let turn = 0; turn < 20 && seen.at(-1) === undefined; turn++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(seen.at(-1)).toBe(1500);
    expect(queryClient.getQueryData<LatestPrice[]>(['latestPrices'])).toHaveLength(1500);
    await act(async () => renderer?.unmount());
    queryClient.clear();
  });
});
