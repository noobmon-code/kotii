import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { priceAlerts } from '@/domain/priceAlert';
import { summarizePrices } from '@/domain/prices';
import type { PriceObservation } from '@/lib/types';

import { usePriceHistory, usePriceObservations } from '../market';

// O item que ficou sem valor numa nota confirmada é uma linha de preço R$ 0,00
// na view (ela não filtra o preço). Um zero não é preço: as duas leituras do
// histórico pedem só o que é maior que zero, e a compra de verdade anterior do
// mesmo mercado toma o lugar dele sozinha.

type Filter = { op: 'eq' | 'in' | 'gte' | 'lte' | 'gt'; column: string; value: unknown };
// "mock" no nome: o jest.mock só enxerga variáveis assim. A view de mentira, que atende aos filtros como o servidor.
const mockView = {
  rows: [] as PriceObservation[],
  asked: [] as { table: string; filters: Filter[]; limit: number | null }[],
};

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const filters: Filter[] = [];
      let limit: number | null = null;
      let newestFirst = false;
      const keeps = (row: PriceObservation) =>
        filters.every(({ op, column, value }) => {
          const cell = row[column as keyof PriceObservation];
          if (op === 'eq') return cell === value;
          if (op === 'in') return (value as unknown[]).includes(cell);
          if (op === 'gte') return cell >= (value as string | number);
          if (op === 'lte') return cell <= (value as string | number);
          return cell > (value as string | number);
        });
      const filter = (op: Filter['op']) => (column: string, value: unknown) => {
        filters.push({ op, column, value });
        return query;
      };
      const query = {
        select: () => query,
        eq: filter('eq'),
        in: filter('in'),
        gte: filter('gte'),
        lte: filter('lte'),
        gt: filter('gt'),
        order: (_column: string, options?: { ascending?: boolean }) => {
          newestFirst = options?.ascending === false;
          return query;
        },
        limit: (count: number) => {
          limit = count;
          return query;
        },
        then: (resolve: (result: unknown) => void) => {
          mockView.asked.push({ table, filters: [...filters], limit });
          const rows = mockView.rows.filter(keeps).sort((a, b) => (a.purchased_at < b.purchased_at ? -1 : 1) * (newestFirst ? -1 : 1));
          resolve({ data: rows.slice(0, limit ?? undefined), error: null });
        },
      };
      return query;
    },
  },
  unwrap: (result: { data: unknown; error: unknown }) => {
    if (result.error) throw result.error;
    return result.data;
  },
}));

const point = (store_id: string, unit_price: number, day: string, patch: Partial<PriceObservation> = {}): PriceObservation => ({
  product_id: 'p-queijo',
  store_id,
  unit: 'kg',
  unit_price,
  purchased_at: `${day}T15:00:00.000Z`,
  receipt_id: `r-${store_id}-${day}`,
  ...patch,
});

let queryClient: QueryClient | undefined;
let renderer: ReactTestRenderer | undefined;

/** O que a tela recebe de uma dessas leituras, depois de a busca terminar. */
async function read(useRows: () => { data: PriceObservation[] | undefined }): Promise<PriceObservation[]> {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const seen: (PriceObservation[] | undefined)[] = [];
  function Probe() {
    seen.push(useRows().data);
    return null;
  }
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={queryClient!}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  for (let turn = 0; turn < 20 && seen.at(-1) === undefined; turn++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  return seen.at(-1) ?? [];
}

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  queryClient?.clear();
  mockView.rows = [];
  mockView.asked = [];
});

// O Assaí vendeu o queijo a 37,90 em agosto; em setembro, a leitura da nota de lá não pegou o valor.
const ASSAI_REAL = point('s-assai', 37.9, '2026-08-20');
const ASSAI_ZERO = point('s-assai', 0, '2026-09-10');
const DIA_REAL = point('s-dia', 41.5, '2026-09-01');

describe('histórico de preço de um produto (tela do produto)', () => {
  it('pede só preço maior que zero, e o preço de verdade anterior do mercado fica no lugar do zero', async () => {
    mockView.rows = [ASSAI_REAL, ASSAI_ZERO, DIA_REAL, point('s-assai', 0, '2026-09-12', { product_id: 'p-outro' })];
    const rows = await read(() => usePriceHistory('p-queijo'));
    expect(mockView.asked).toEqual([
      {
        table: 'price_observations',
        filters: [
          { op: 'eq', column: 'product_id', value: 'p-queijo' },
          { op: 'gt', column: 'unit_price', value: 0 },
        ],
        limit: 100,
      },
    ]);
    // Do mais novo para o mais antigo, sem a linha zerada.
    expect(rows).toEqual([DIA_REAL, ASSAI_REAL]);
    // A tela do produto resume o que recebe: o mais barato é o preço de verdade do Assaí, e não R$ 0,00.
    expect(summarizePrices(rows)?.cheapest).toEqual(ASSAI_REAL);
    expect(summarizePrices([ASSAI_REAL, ASSAI_ZERO, DIA_REAL])?.cheapest).toEqual(ASSAI_ZERO);
  });

  it('produto que só tem a linha zerada fica sem histórico', async () => {
    mockView.rows = [ASSAI_ZERO];
    expect(await read(() => usePriceHistory('p-queijo'))).toEqual([]);
  });
});

describe('preços dos meses antes de uma compra (alerta de preço na nota)', () => {
  const PURCHASED_AT = '2026-09-27T15:00:00.000Z';
  const RECEIPT = { receiptId: 'r-agora', storeId: 's-dia', purchasedOn: '2026-09-27' };
  /** O queijo desta nota, comprado no Dia a 39,90 o quilo. */
  const cheese = { id: 'i1', productId: 'p-queijo', unit: 'kg', unitPrice: 39.9, quantity: 1 };

  it('pede só preço maior que zero, dentro da janela da compra', async () => {
    mockView.rows = [ASSAI_REAL, ASSAI_ZERO, DIA_REAL];
    const rows = await read(() => usePriceObservations(['p-queijo'], PURCHASED_AT));
    expect(mockView.asked).toHaveLength(1);
    expect(mockView.asked[0]).toMatchObject({ table: 'price_observations', limit: 1000 });
    expect(mockView.asked[0].filters.map(({ op, column }) => `${column} ${op}`)).toEqual(['product_id in', 'purchased_at gte', 'purchased_at lte', 'unit_price gt']);
    expect(mockView.asked[0].filters.at(-1)).toEqual({ op: 'gt', column: 'unit_price', value: 0 });
    expect(rows).toEqual([DIA_REAL, ASSAI_REAL]);
  });

  it('o alerta não nasce de um ponto de R$ 0,00 do histórico', async () => {
    mockView.rows = [ASSAI_ZERO, DIA_REAL];
    // Com a linha zerada no histórico, o aviso seria "R$ 0,00 no Assaí", com o preço inteiro como economia.
    expect(priceAlerts([cheese], mockView.rows, RECEIPT).get('i1')).toEqual({ kind: 'cheaper_elsewhere', storeId: 's-assai', price: 0, on: '2026-09-10', saving: 39.9 });
    // Com o que a leitura entrega, não há aviso: 39,90 no Dia, que antes vendia a 41,50.
    const rows = await read(() => usePriceObservations(['p-queijo'], PURCHASED_AT));
    expect(rows).toEqual([DIA_REAL]);
    expect(priceAlerts([cheese], rows, RECEIPT).size).toBe(0);
  });

  it('e o preço de verdade anterior do outro mercado continua valendo para o alerta', async () => {
    mockView.rows = [point('s-assai', 33.9, '2026-08-20'), ASSAI_ZERO, DIA_REAL];
    const rows = await read(() => usePriceObservations(['p-queijo'], PURCHASED_AT));
    expect(priceAlerts([cheese], rows, RECEIPT).get('i1')).toEqual({ kind: 'cheaper_elsewhere', storeId: 's-assai', price: 33.9, on: '2026-08-20', saving: 6 });
  });

  it('o item que está ele mesmo sem valor já não gerava alerta', async () => {
    mockView.rows = [ASSAI_REAL, DIA_REAL];
    const rows = await read(() => usePriceObservations(['p-queijo'], PURCHASED_AT));
    expect(priceAlerts([{ ...cheese, unitPrice: 0 }], rows, RECEIPT).size).toBe(0);
  });
});
