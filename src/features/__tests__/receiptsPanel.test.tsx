import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { fetchReceiptHistoryPage } from '@/data/receipts';
import { ReceiptsPanel } from '@/features/finance/ReceiptsPanel';
import { Button, ListRow } from '@/ui/primitives';

// Finanças > Notas de verdade, com as buscas de verdade de src/data/receipts.ts e um "servidor" que filtra,
// ordena, conta e corta como o PostgREST (teto de linhas por resposta). O que se confere: casa com mais de 200
// notas (a lista antiga parava nas 200 mais recentes, calada) e rascunho antigo, que não pode sumir de "Para
// revisar".

type Row = Record<string, unknown>;
interface Asked {
  filters: [string, string, unknown][];
  or: string | null;
  order: [string, boolean][];
  limit: number | null;
}

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockServer = {
  receipts: [] as Row[],
  /** O teto de linhas por resposta (max_rows do PostgREST). */
  maxRows: 1000,
  asked: [] as Asked[],
  /** Os pedidos (a contar do zero) que falham. */
  failing: new Set<number>(),
};
const mockRouter = { push: jest.fn() };

jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockRouter.push(...args) } }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/lib/session', () => ({ endSessionIfGone: async () => false }));
jest.mock('@/features/ReceiptScanner', () => ({ useReceiptScanner: () => ({ open: jest.fn(), busy: false, element: null }) }));
// As notas pendentes do aparelho têm o teste delas (pendingReceiptFlow): aqui, nenhuma.
jest.mock('@/data/pendingReceipts', () => ({ usePendingReceipts: () => ({ pending: [], storeNames: {} }) }));
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('@/lib/supabase', () => {
  /** O cursor do histórico, como o app o escreve: purchased_at.lt."T",and(purchased_at.eq."T",id.lt.ID). */
  const CURSOR = /^purchased_at\.lt\."([^"]+)",and\(purchased_at\.eq\."([^"]+)",id\.lt\.([^)]+)\)$/;
  const compare = (column: string, a: unknown, b: unknown) =>
    column === 'purchased_at' ? Date.parse(String(a)) - Date.parse(String(b)) : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  return {
    supabase: {
      from: () => {
        const asked: Asked = { filters: [], or: null, order: [], limit: null };
        let counted = false;
        const query = {
          select: (_columns: string, options?: { count?: string }) => {
            counted = options?.count === 'exact';
            return query;
          },
          eq: (column: string, value: unknown) => (asked.filters.push(['eq', column, value]), query),
          gt: (column: string, value: unknown) => (asked.filters.push(['gt', column, value]), query),
          or: (filter: string) => ((asked.or = filter), query),
          order: (column: string, options?: { ascending?: boolean }) => (asked.order.push([column, options?.ascending !== false]), query),
          limit: (rows: number) => ((asked.limit = rows), query),
          then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve()
              .then(() => {
                const request = mockServer.asked.length;
                mockServer.asked.push(asked);
                if (mockServer.failing.has(request)) return { data: null, count: null, error: { message: 'Sem conexão com a internet.' } };
                let rows = mockServer.receipts.filter((row) =>
                  asked.filters.every(([op, column, value]) => (op === 'eq' ? row[column] === value : compare(column, row[column], value) > 0)),
                );
                if (asked.or) {
                  const [, before, same, id] = CURSOR.exec(asked.or) ?? [];
                  if (!before || before !== same) throw new Error(`filtro inesperado: ${asked.or}`);
                  rows = rows.filter((row) => compare('purchased_at', row.purchased_at, before) < 0 || (row.purchased_at === before && String(row.id) < id));
                }
                rows = [...rows].sort((a, b) => {
                  for (const [column, ascending] of asked.order) {
                    const diff = compare(column, a[column], b[column]);
                    if (diff) return ascending ? diff : -diff;
                  }
                  return 0;
                });
                const page = rows.slice(0, Math.min(asked.limit ?? Infinity, mockServer.maxRows)).map((row) => ({ ...row }));
                return { data: page, count: counted ? rows.length : null, error: null };
              })
              .then(resolve, reject),
        };
        return query;
      },
    },
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
    errorMessage: (error: { message?: string }) => error?.message ?? 'Algo deu errado. Tente novamente.',
  };
});

/** Na hora local do aparelho, como a nota guarda a compra. */
const at = (year: number, month: number, day: number, hour = 12) => new Date(year, month - 1, day, hour).toISOString();

const row = (id: string, purchased_at: string, partial: Row = {}): Row => ({
  id,
  purchased_at,
  status: 'confirmed',
  total: 100,
  store_id: 's1',
  store: { id: 's1', name: 'Assaí' },
  receipt_items: [{ count: 3 }],
  ...partial,
});

/**
 * Um ano e pouco de notas: 230 confirmadas, uma a cada dois dias desde 16 de outubro de 2026 para trás, com o id
 * fora da ordem da data. As notas 49, 50 e 51 foram compradas no mesmo instante: a borda da primeira página cai
 * no meio delas.
 */
const HISTORY = Array.from({ length: 230 }, (_, n) => {
  const day = new Date(2026, 9, 16 - 2 * n, 12);
  const purchasedAt = n >= 49 && n <= 51 ? new Date(2026, 9, 16 - 2 * 49, 12).toISOString() : day.toISOString();
  return row(`c${String((n * 7919) % 1000).padStart(3, '0')}-${n}`, purchasedAt);
});
const OLD_DRAFT = row('d-velho', at(2025, 6, 2), { status: 'draft', store: { id: 's2', name: 'Dia' }, total: null });
const NEW_DRAFT = row('d-novo', at(2026, 10, 15), { status: 'draft', store: null, total: null, receipt_items: [{ count: 1 }] });

let client: QueryClient;
let renderer: ReactTestRenderer | undefined;

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
const texts = (node: ReturnType<ReactTestRenderer['toJSON']> | string): string[] =>
  node == null ? [] : typeof node === 'string' ? [node] : Array.isArray(node) ? node.flatMap(texts) : (node.children ?? []).flatMap(texts);
const page = () => texts(renderer!.toJSON()).join('\n');
const button = (title: string) => renderer!.root.findAllByType(Button).find((b) => b.props.title === title);
/** As notas na tela: o id que cada linha abre, na ordem. */
const opened = () => {
  mockRouter.push.mockClear();
  for (const listRow of renderer!.root.findAllByType(ListRow)) listRow.props.onPress();
  return mockRouter.push.mock.calls.map(([target]) => (target as { params: { id: string } }).params.id);
};

async function open() {
  act(() => {
    renderer = create(
      <QueryClientProvider client={client}>
        <ReceiptsPanel />
      </QueryClientProvider>,
    );
  });
  await settle();
  await settle();
}

async function more(title: string) {
  const target = button(title);
  expect(target).toBeDefined();
  await act(async () => target!.props.onPress());
  await settle();
  await settle();
}

/** As notas confirmadas na ordem do histórico: da compra mais recente, e no empate o id maior. */
const newestFirst = (rows: Row[]) =>
  [...rows].sort((a, b) => Date.parse(String(b.purchased_at)) - Date.parse(String(a.purchased_at)) || (String(a.id) < String(b.id) ? 1 : -1)).map((r) => r.id);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  mockServer.receipts = [...HISTORY, OLD_DRAFT, NEW_DRAFT];
  mockServer.maxRows = 1000;
  mockServer.asked = [];
  mockServer.failing = new Set();
  mockRouter.push.mockClear();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  client.clear();
});

describe('Finanças > Notas com mais de 200 notas', () => {
  it('"Para revisar" traz todos os rascunhos, também o de mais de um ano; o histórico vem por mês, 50 de cada vez, contando o que falta', async () => {
    await open();
    const text = page();
    expect(text).toContain(['Para revisar', 'Mercado não informado', '15 out · 1 item', 'Revisar', 'Dia', '2 jun 2025 · 3 itens', 'Revisar'].join('\n'));
    // Separado por mês, do mais recente.
    expect(text).toContain(['Histórico', 'Outubro de 2026', 'Assaí', '16 out · 3 itens', 'R$ 100,00'].join('\n'));
    expect(text.indexOf('Outubro de 2026')).toBeLessThan(text.indexOf('Setembro de 2026'));
    expect(text).toContain('Mostrando as 50 notas mais recentes de 230.');
    expect(opened()).toEqual(['d-novo', 'd-velho', ...newestFirst(HISTORY).slice(0, 50)]);
    // Os rascunhos vêm por inteiro, pelo id; o histórico, só as confirmadas, da mais recente.
    expect(mockServer.asked.map((asked) => asked.filters)).toEqual([[['eq', 'status', 'draft']], [['eq', 'status', 'confirmed']]]);
    expect(mockServer.asked[1]).toMatchObject({ or: null, order: [['purchased_at', false], ['id', false]], limit: 50 });
  });

  it('"Ver mais" vai trazendo as mais antigas, sem pular nem repetir nenhuma (nem as compradas no mesmo instante), até a última', async () => {
    await open();
    await more('Ver mais 50 notas');
    // A segunda página começa logo depois da última nota lida, pela data e, no empate, pelo id.
    const last = HISTORY.find((r) => r.id === newestFirst(HISTORY)[49])!;
    expect(mockServer.asked[2].or).toBe(`purchased_at.lt."${last.purchased_at}",and(purchased_at.eq."${last.purchased_at}",id.lt.${last.id})`);
    expect(page()).toContain('Mostrando as 100 notas mais recentes de 230.');
    await more('Ver mais 50 notas');
    await more('Ver mais 50 notas');
    expect(page()).toContain('Mostrando as 200 notas mais recentes de 230.');
    await more('Ver as 30 notas mais antigas');
    const ids = opened().slice(2);
    expect(ids).toEqual(newestFirst(HISTORY));
    expect(new Set(ids).size).toBe(230);
    // Chegou ao fim: nem botão nem frase.
    const text = page();
    expect(text).not.toContain('Mostrando as');
    expect(renderer!.root.findAllByType(Button).map((b) => b.props.title)).toEqual(['Adicionar nota', 'Preços', 'Mercado do mês']);
    // A nota mais antiga do histórico, de quase um ano e meio antes.
    expect(text).toContain('Setembro de 2025');
  });

  it('a página seguinte que falha: as notas que vieram ficam, com o erro e o "Tentar de novo"', async () => {
    await open();
    mockServer.failing.add(2);
    await more('Ver mais 50 notas');
    expect(page()).toContain('Sem conexão com a internet.');
    expect(opened()).toHaveLength(52);
    expect(button('Ver mais 50 notas')).toBeUndefined();
    await more('Tentar de novo');
    expect(page()).not.toContain('Sem conexão com a internet.');
    expect(opened()).toHaveLength(102);
  });

  it('casa sem nota nenhuma: o convite de sempre, sem histórico', async () => {
    mockServer.receipts = [];
    await open();
    expect(page()).toContain('Nenhuma nota ainda');
    expect(page()).not.toContain('Histórico');
  });
});

describe('o histórico, página por página', () => {
  it('o servidor conta o que vem depois do cursor; sem a contagem, a página cheia diz que pode haver mais', async () => {
    const first = await fetchReceiptHistoryPage(null);
    expect([first.rows.length, first.remaining]).toEqual([50, 180]);
    const last = await fetchReceiptHistoryPage({ purchasedAt: String(HISTORY[199].purchased_at), id: String(HISTORY[199].id) });
    expect([last.rows.length, last.remaining]).toEqual([30, 0]);
  });

  it('o servidor diz que há mais e não manda nada: erro, nunca um histórico que acaba antes da hora', async () => {
    mockServer.maxRows = 0;
    await expect(fetchReceiptHistoryPage(null)).rejects.toThrow('O histórico de notas não chegou inteiro. Tente de novo.');
  });
});
