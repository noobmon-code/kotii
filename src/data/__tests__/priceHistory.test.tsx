import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { priceAlerts, type PricePoint } from '@/domain/priceAlert';

import { OBSERVATION_MAX_LINES, usePriceObservations } from '../market';

// Os preços dos meses antes de uma compra (alerta de preço na nota) saem das linhas das notas confirmadas, com a
// descrição (o tamanho da embalagem). O item que ficou sem valor numa nota confirmada é uma linha de preço R$ 0,00:
// um zero não é preço, e a leitura pede só o que é maior que zero (a compra de verdade anterior do mesmo mercado
// toma o lugar dele sozinha). O servidor corta cada resposta em 1000 linhas: a leitura segue página por página.
// (O "Último preço por mercado" da tela do produto sai das compras dele: domain/storePrices.)

interface ItemRow {
  id: string;
  product_id: string;
  receipt_id: string;
  raw_description: string;
  unit: string;
  unit_price: number;
  pack_count?: number | null;
  receipt: { status: 'draft' | 'confirmed'; purchased_at: string; store_id: string | null };
}

type Filter = { op: 'eq' | 'in' | 'gte' | 'lte' | 'gt'; column: string; value: unknown };

// "mock" no nome: o jest.mock só enxerga variáveis assim. A tabela de mentira, que atende aos filtros como o servidor.
const mockTable = {
  rows: [] as ItemRow[],
  /** O teto de linhas por pedido (max_rows do Supabase). */
  cap: 1000,
  /** Falso: o banco ainda não tem a coluna pack_count (recusa a leitura que a pede). */
  hasPackCount: true,
  asked: [] as { table: string; columns: string; filters: Filter[]; order: string[]; limit: number | null }[],
};

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string, options?: { count?: string }) => {
        const asked = { table, columns, filters: [] as Filter[], order: [] as string[], limit: null as number | null };
        const cell = (row: ItemRow, column: string): unknown =>
          column.startsWith('receipt.') ? row.receipt[column.slice(8) as keyof ItemRow['receipt']] : row[column as keyof ItemRow];
        const keeps = (row: ItemRow) =>
          asked.filters.every(({ op, column, value }) => {
            const found = cell(row, column) as string | number;
            if (op === 'eq') return found === value;
            if (op === 'in') return (value as unknown[]).includes(found);
            if (op === 'gte') return found >= (value as string | number);
            if (op === 'lte') return found <= (value as string | number);
            return found > (value as string | number);
          });
        const filter = (op: Filter['op']) => (column: string, value: unknown) => {
          asked.filters.push({ op, column, value });
          return query;
        };
        const query = {
          in: filter('in'),
          eq: filter('eq'),
          gte: filter('gte'),
          lte: filter('lte'),
          gt: filter('gt'),
          order: (column: string) => {
            asked.order.push(column);
            return query;
          },
          limit: (count: number) => {
            asked.limit = count;
            return query;
          },
          then: (resolve: (result: unknown) => void) => {
            mockTable.asked.push(asked);
            // O !inner: os filtros da nota tiram a linha; sem ele, a nota viria vazia.
            if (!/receipt:receipts!inner\(/.test(columns)) throw new Error('sem !inner');
            if (!mockTable.hasPackCount && /pack_count/.test(columns)) {
              resolve({ data: null, count: null, error: { code: '42703', message: 'column receipt_items.pack_count does not exist' } });
              return;
            }
            const found = mockTable.rows.filter(keeps).sort((a, b) => (a.id < b.id ? -1 : 1));
            resolve({
              // Como o servidor: a resposta traz só as colunas pedidas (pack_count só quando a consulta o pede).
              data: found.slice(0, Math.min(asked.limit ?? Infinity, mockTable.cap)).map(({ receipt: { status: _status, ...receipt }, pack_count, ...row }) => ({
                ...row,
                receipt,
                ...(/pack_count/.test(columns) ? { pack_count } : {}),
              })),
              count: options?.count === 'exact' ? found.length : null,
              error: null,
            });
          },
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

let serial = 0;
const line = (store_id: string | null, unit_price: number, day: string, patch: Partial<Omit<ItemRow, 'receipt'>> & { status?: 'draft' } = {}): ItemRow => {
  serial += 1;
  const { status, ...rest } = patch;
  return {
    id: `i${String(serial).padStart(6, '0')}`,
    product_id: 'p-queijo',
    receipt_id: `r-${store_id}-${day}-${serial}`,
    raw_description: 'QUEIJO MUSSARELA KG',
    unit: 'kg',
    unit_price,
    ...rest,
    receipt: { status: status ?? 'confirmed', purchased_at: `${day}T15:00:00.000Z`, store_id },
  };
};
/** O ponto que a leitura entrega para essa linha. */
const pointOf = (row: ItemRow): PricePoint => ({
  product_id: row.product_id,
  store_id: row.receipt.store_id!,
  unit: row.unit,
  unit_price: row.unit_price,
  purchased_at: row.receipt.purchased_at,
  receipt_id: row.receipt_id,
  description: row.raw_description,
});

let queryClient: QueryClient | undefined;
let renderer: ReactTestRenderer | undefined;

/** O que a tela recebe da leitura, depois de a busca terminar (ou falhar). */
async function read(productIds: string[], purchasedAt: string): Promise<{ data?: PricePoint[]; error?: unknown }> {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const seen: { data?: PricePoint[]; error?: unknown }[] = [];
  function Probe() {
    const query = usePriceObservations(productIds, purchasedAt);
    seen.push({ data: query.data, error: query.error ?? undefined });
    return null;
  }
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={queryClient!}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  for (let turn = 0; turn < 50 && !seen.at(-1)?.data && !seen.at(-1)?.error; turn++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  return seen.at(-1) ?? {};
}

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  queryClient?.clear();
  mockTable.rows = [];
  mockTable.asked = [];
  mockTable.cap = 1000;
  mockTable.hasPackCount = true;
});

const PURCHASED_AT = '2026-09-27T15:00:00.000Z';
const RECEIPT = { receiptId: 'r-agora', storeId: 's-dia', purchasedOn: '2026-09-27' };
/** O queijo desta nota, comprado no Dia a 39,90 o quilo. */
const cheese = { id: 'i1', productId: 'p-queijo', unit: 'kg', unitPrice: 39.9, quantity: 1 };

describe('quantos vêm na embalagem no alerta de preço (pack_count)', () => {
  it('a leitura traz quantos vêm de cada linha, para o alerta comparar cartela com cartela', async () => {
    mockTable.rows = [line('s-assai', 13.99, '2026-09-10', { product_id: 'p-ovos', raw_description: 'OVOS RANCHO CAIPIRA', unit: 'un', pack_count: 10 })];
    const { data, error } = await read(['p-ovos'], PURCHASED_AT);
    expect(error).toBeUndefined();
    expect(data).toEqual([expect.objectContaining({ store_id: 's-assai', unit: 'un', unit_price: 13.99, packCount: 10 })]);
  });

  it('banco de antes da coluna: a leitura segue sem ela, e o alerta não falha', async () => {
    mockTable.hasPackCount = false;
    mockTable.rows = [line('s-assai', 13.99, '2026-09-10', { product_id: 'p-ovos', raw_description: 'OVOS RANCHO CAIPIRA', unit: 'un', pack_count: 10 })];
    const { data, error } = await read(['p-ovos'], PURCHASED_AT);
    expect(error).toBeUndefined();
    expect(data).toHaveLength(1);
    expect(data![0]).not.toHaveProperty('packCount');
    // Primeiro com a coluna (o banco recusa), depois sem ela: a mesma leitura, sem perder nenhuma linha.
    expect(mockTable.asked.map(({ columns }) => /pack_count/.test(columns))).toEqual([true, false]);
  });
});

describe('preços dos meses antes de uma compra (alerta de preço na nota)', () => {
  it('pede às linhas das notas confirmadas só preço maior que zero, dentro da janela da compra, com a descrição', async () => {
    // O Assaí vendeu o queijo a 37,90 em agosto; em setembro, a leitura da nota de lá não pegou o valor.
    const assaiReal = line('s-assai', 37.9, '2026-08-20');
    const diaReal = line('s-dia', 41.5, '2026-09-01');
    mockTable.rows = [
      assaiReal,
      line('s-assai', 0, '2026-09-10'),
      diaReal,
      line('s-dia', 30, '2026-09-15', { status: 'draft' }),
      line('s-dia', 30, '2026-05-01'),
      line('s-dia', 30, '2026-10-15'),
      line('s-dia', 30, '2026-09-15', { product_id: 'p-leite' }),
    ];
    const { data } = await read(['p-queijo'], PURCHASED_AT);
    expect(mockTable.asked).toHaveLength(1);
    expect(mockTable.asked[0]).toMatchObject({ table: 'receipt_items', order: ['id'], limit: 1000 });
    expect(mockTable.asked[0].columns).toContain('raw_description');
    expect(mockTable.asked[0].filters.map(({ op, column }) => `${column} ${op}`)).toEqual([
      'product_id in',
      'receipt.status eq',
      'receipt.purchased_at gte',
      'receipt.purchased_at lte',
      'unit_price gt',
    ]);
    expect(mockTable.asked[0].filters.at(-1)).toEqual({ op: 'gt', column: 'unit_price', value: 0 });
    expect(data).toEqual([pointOf(assaiReal), pointOf(diaReal)]);
  });

  it('o alerta não nasce de um ponto de R$ 0,00, e o preço de verdade anterior do outro mercado continua valendo', async () => {
    const assai = line('s-assai', 33.9, '2026-08-20');
    mockTable.rows = [assai, line('s-assai', 0, '2026-09-10'), line('s-dia', 41.5, '2026-09-01')];
    const { data } = await read(['p-queijo'], PURCHASED_AT);
    expect(priceAlerts([cheese], data!, RECEIPT).get('i1')).toEqual({
      kind: 'cheaper_elsewhere',
      storeId: 's-assai',
      price: 33.9,
      unit: 'kg',
      on: '2026-08-20',
      saving: 6,
    });
  });

  it('a nota sem mercado não entra (como na view de antes)', async () => {
    mockTable.rows = [line(null, 20, '2026-09-10'), line('s-dia', 41.5, '2026-09-01')];
    const { data } = await read(['p-queijo'], PURCHASED_AT);
    expect(data!.map((point) => point.store_id)).toEqual(['s-dia']);
  });

  it('com mais de 1000 preços, lê todas as páginas: o preço mais antigo da janela entra na conta', async () => {
    // 1500 compras recentes no Dia a 39,90 e, bem no começo da janela, no Assaí a 31,90.
    const recent = Array.from({ length: 1500 }, () => line('s-dia', 39.9, '2026-09-20'));
    const oldest = line('s-assai', 31.9, '2026-07-01');
    mockTable.rows = [oldest, ...recent];
    const { data } = await read(['p-queijo'], PURCHASED_AT);
    expect(data).toHaveLength(1501);
    expect(data).toContainEqual(pointOf(oldest));
    // Duas páginas de mil, a segunda a partir do id da última lida.
    expect(mockTable.asked).toHaveLength(2);
    expect(mockTable.asked[1].filters.at(-1)).toEqual({ op: 'gt', column: 'id', value: mockTable.rows[1000].id });
  });

  it('o servidor que corta abaixo do pedido: a leitura segue até a contagem fechar', async () => {
    mockTable.cap = 400;
    mockTable.rows = Array.from({ length: 900 }, () => line('s-dia', 39.9, '2026-09-20'));
    const { data } = await read(['p-queijo'], PURCHASED_AT);
    expect(data).toHaveLength(900);
    expect(mockTable.asked).toHaveLength(3);
  });

  it('mais linhas do que o app lê de uma vez: falha (a nota fica sem avisos), em vez de comparar com uma parte', async () => {
    mockTable.rows = Array.from({ length: OBSERVATION_MAX_LINES + 1 }, () => line('s-dia', 39.9, '2026-09-20'));
    const { data, error } = await read(['p-queijo'], PURCHASED_AT);
    expect(data).toBeUndefined();
    expect((error as Error).message).toContain('mais compras do que o app consegue ler');
    expect(mockTable.asked).toHaveLength(1);
  });

  it('o pacote de 5 kg desta nota não ouve "mais barato" do preço do pacote de 1 kg', async () => {
    mockTable.rows = [
      line('s-assai', 5.49, '2026-09-20', { product_id: 'p-arroz', unit: 'un', raw_description: 'ARROZ T1 1KG' }),
      line('s-assai', 5.59, '2026-09-01', { product_id: 'p-arroz', unit: 'un', raw_description: 'ARROZ T1 1KG' }),
    ];
    const { data } = await read(['p-arroz'], PURCHASED_AT);
    const rice = { id: 'i2', productId: 'p-arroz', unit: 'un', unitPrice: 24.9, quantity: 1, description: 'ARROZ T1 5KG' };
    expect(priceAlerts([rice], data!, RECEIPT).size).toBe(0);
    // Sem a descrição (como era com a view), o aviso seria "R$ 5,49 no Assaí".
    expect(priceAlerts([{ ...rice, description: undefined }], data!.map(({ description: _d, ...point }) => point), RECEIPT).get('i2')).toMatchObject({
      kind: 'cheaper_elsewhere',
      price: 5.49,
    });
  });
});
