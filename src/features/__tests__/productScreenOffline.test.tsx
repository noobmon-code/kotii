import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import ProductScreen from '@/app/produto/[id]';
import { PriceHistorySection } from '@/features/market/PriceHistorySection';
import { Loading } from '@/ui/primitives';

// A tela do produto de verdade, com as consultas de verdade de src/data/market.ts e um QueryClient com os
// padrões do app. Só a rede é trocada: um "banco" em memória atrás do cliente do Supabase. O que se confere
// aqui é a tela sem internet: os preços do produto não ficam guardados no aparelho, e a busca fica parada.

type Row = Record<string, unknown>;
// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockDb: { tables: Record<string, Row[]>; asked: string[] } = { tables: {}, asked: [] };

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'arroz' }),
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn() }));
jest.mock('@/ui/PickerModal', () => ({ PickerModal: () => null }));
// Os desenhos animados e o fundo não entram no que se confere aqui.
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/lib/supabase', () => {
  const table = (name: string) => {
    const filters: [string, unknown][] = [];
    const query: Record<string, unknown> = {
      select: () => query,
      order: () => query,
      limit: () => query,
      gt: () => query,
      eq: (column: string, value: unknown) => {
        // O filtro na nota (só as confirmadas) é do servidor: aqui todas as linhas já são de notas confirmadas.
        if (!column.startsWith('receipt.')) filters.push([column, value]);
        return query;
      },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve()
          .then(() => {
            mockDb.asked.push(name);
            const rows = (mockDb.tables[name] ?? []).filter((row) => filters.every(([column, value]) => row[column] === value));
            return { data: rows.map((row) => ({ ...row })), count: rows.length, error: null };
          })
          .then(resolve, reject),
    };
    return query;
  };
  return {
    errorMessage: (error: { message?: string }) => error?.message ?? 'Algo deu errado. Tente novamente.',
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
    supabase: { from: (name: string) => table(name) },
  };
});

const OFFLINE_SCREEN = 'Sem internet: os preços deste produto aparecem quando a conexão voltar.';
const OFFLINE_SECTION = 'Sem internet: o histórico de preço aparece quando a conexão voltar.';

const products = (): Row[] => [{ id: 'arroz', name: 'Arroz 5 kg', category: 'mercearia', shelf_life_days: null }];
const stores = (): Row[] => [{ id: 'assai', name: 'Assaí', cnpj: null, address: null }];
const at = (day: string) => new Date(`${day}T15:00:00`).toISOString();
const observations = (): Row[] => [
  { product_id: 'arroz', store_id: 'assai', unit: 'un', unit_price: 25.9, purchased_at: at('2026-10-10'), receipt_id: 'r2' },
  { product_id: 'arroz', store_id: 'assai', unit: 'un', unit_price: 22.9, purchased_at: at('2026-07-12'), receipt_id: 'r1' },
];
const lines = (): Row[] => [
  { id: 'i1', receipt_id: 'r1', product_id: 'arroz', quantity: 1, unit: 'un', unit_price: 22.9, total_price: 22.9, receipt: { purchased_at: at('2026-07-12'), store_id: 'assai', store: { name: 'Assaí' } } },
  { id: 'i2', receipt_id: 'r2', product_id: 'arroz', quantity: 2, unit: 'un', unit_price: 25.9, total_price: 51.8, receipt: { purchased_at: at('2026-10-10'), store_id: 'assai', store: { name: 'Assaí' } } },
];

let client: QueryClient;
let renderer: ReactTestRenderer | undefined;

const settle = (ms = 30) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
function open(element: ReactElement = <ProductScreen />) {
  act(() => {
    renderer = create(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  });
}
const texts = (node: ReturnType<ReactTestRenderer['toJSON']> | string): string[] =>
  node == null ? [] : typeof node === 'string' ? [node] : Array.isArray(node) ? node.flatMap(texts) : (node.children ?? []).flatMap(texts);
const page = () => texts(renderer!.toJSON());
const loading = () => renderer!.root.findAllByType(Loading).length > 0;
/** A conexão volta: quem retoma as buscas paradas é o React Query, sem ninguém tocar em nada. */
const backOnline = async () => {
  await act(async () => {
    onlineManager.setOnline(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await settle();
};

beforeEach(() => {
  // Como no app (lib/queryClient), sem a segunda tentativa, que só faria o teste esperar.
  client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false, gcTime: Infinity }, mutations: { networkMode: 'always', gcTime: Infinity } } });
  mockDb.tables = { products: products(), stores: stores(), price_observations: observations(), receipt_items: lines() };
  mockDb.asked = [];
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  onlineManager.setOnline(true);
  client.clear();
});

describe('tela do produto sem internet', () => {
  it('aberta pela lista, com o produto e os mercados guardados no aparelho: um aviso, e não o carregando sem fim', async () => {
    // O que a lista guarda no aparelho (lib/queryClient, PERSISTED); os preços do produto, não.
    client.setQueryData(['products'], products());
    client.setQueryData(['stores'], stores());
    onlineManager.setOnline(false);
    open();
    await settle();
    expect(page()).toContain(OFFLINE_SCREEN);
    expect(loading()).toBe(false);
    // Nada foi pedido, e a tela não diz o que não sabe.
    expect(mockDb.asked).toEqual([]);
    expect(page()).not.toContain('Nenhuma nota confirmada com este produto ainda.');

    await backOnline();
    expect(page()).not.toContain(OFFLINE_SCREEN);
    expect(page()).toEqual(expect.arrayContaining(['Último preço por mercado', 'Histórico de preço', 'R$ 25,90/un · Assaí · 10 out', '2 compras em 6 meses']));
  });

  it('sem nada no aparelho: o mesmo aviso', async () => {
    onlineManager.setOnline(false);
    open();
    await settle();
    expect(page()).toContain(OFFLINE_SCREEN);
    expect(loading()).toBe(false);
    expect(mockDb.asked).toEqual([]);
  });

  it('com internet, enquanto busca, continua o carregando de sempre', async () => {
    open();
    expect(loading()).toBe(true);
    expect(page()).not.toContain(OFFLINE_SCREEN);
    // Primeiro a tela, depois a seção (que só começa a buscar quando a tela aparece).
    await settle();
    await settle();
    expect(loading()).toBe(false);
    expect(page()).toEqual(expect.arrayContaining(['Histórico de preço', '2 compras em 6 meses']));
    expect(page()).not.toContain(OFFLINE_SCREEN);
  });

  it('com os últimos preços na memória e as compras não: o resto da tela aparece, e a seção diz que espera a conexão', async () => {
    client.setQueryData(['products'], products());
    client.setQueryData(['stores'], stores());
    client.setQueryData(['priceHistory', 'arroz'], observations());
    onlineManager.setOnline(false);
    open();
    await settle();
    expect(page()).toEqual(expect.arrayContaining(['Último preço por mercado', 'R$ 25,90', 'Histórico de preço', OFFLINE_SECTION]));
    expect(page()).not.toContain(OFFLINE_SCREEN);
    expect(loading()).toBe(false);
    expect(mockDb.asked).toEqual([]);

    await backOnline();
    expect(page()).not.toContain(OFFLINE_SECTION);
    expect(page()).toEqual(expect.arrayContaining(['R$ 25,90/un · Assaí · 10 out', 'Subiu 13% desde 12 jul (era R$ 22,90)', '2 compras em 6 meses']));
    expect(mockDb.asked).toEqual(['receipt_items']);
  });
});

describe('a seção "Histórico de preço" sem internet', () => {
  it('sem as compras no aparelho: o título e o aviso, sem girar; com a conexão de volta, o histórico', async () => {
    onlineManager.setOnline(false);
    open(<PriceHistorySection productId="arroz" productName="Arroz 5 kg" />);
    await settle();
    const text = page();
    expect([text[0], text.at(-1)]).toEqual(['Histórico de preço', OFFLINE_SECTION]);
    expect(loading()).toBe(false);
    expect(page()).not.toContain('Tentar de novo');
    expect(mockDb.asked).toEqual([]);

    await backOnline();
    expect(page()).not.toContain(OFFLINE_SECTION);
    expect(page()).toContain('2 compras em 6 meses');
  });
});
