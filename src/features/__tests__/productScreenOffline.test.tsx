import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import ProductScreen from '@/app/produto/[id]';
import { PRODUCT_CATEGORY_NOTE } from '@/domain/productCategory';
import { NO_SAVED_PRICES_OFFLINE, SAVED_PRICES_ERROR, SAVED_PRICES_OFFLINE } from '@/domain/storePrices';
import { PriceHistorySection } from '@/features/market/PriceHistorySection';
import { Loading } from '@/ui/primitives';

// A tela do produto de verdade, com as consultas de verdade de src/data/market.ts e um QueryClient com os
// padrões do app. Só a rede é trocada: um "banco" em memória atrás do cliente do Supabase. O que se confere
// aqui é a tela sem internet: as compras do produto não ficam guardadas no aparelho (a busca fica parada), mas o
// produto, os mercados e os últimos preços ficam, e a tela abre com eles.

type Row = Record<string, unknown>;
// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockDb: { tables: Record<string, Row[]>; asked: string[]; failing: Set<string> } = { tables: {}, asked: [], failing: new Set() };

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'arroz' }),
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn() }));
// O seletor de categoria não abre aqui: só se guarda o que a tela manda para ele.
const mockPicker: { props: Record<string, unknown> | null } = { props: null };
jest.mock('@/ui/PickerModal', () => ({
  PickerModal: (props: Record<string, unknown>) => {
    mockPicker.props = props;
    return null;
  },
}));
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
      range: () => query,
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
            if (mockDb.failing.has(name)) return { data: null, count: null, error: { message: 'sem conexão com o banco' } };
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
const stores = (): Row[] => [
  { id: 'assai', name: 'Assaí', cnpj: null, address: null },
  { id: 'atacadao', name: 'Atacadão', cnpj: null, address: null },
];
const at = (day: string) => new Date(`${day}T15:00:00`).toISOString();
/** Os últimos preços da casa (a view latest_prices), como ficam guardados: um por produto, mercado e unidade. */
const latest = (): Row[] => [
  { product_id: 'arroz', store_id: 'assai', unit: 'un', unit_price: 25.9, purchased_at: at('2026-10-10') },
  { product_id: 'arroz', store_id: 'atacadao', unit: 'un', unit_price: 24.5, purchased_at: at('2026-09-02') },
  { product_id: 'leite', store_id: 'assai', unit: 'un', unit_price: 3.99, purchased_at: at('2026-10-10') },
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
/** Os mercados de "Último preço por mercado", na ordem da tela (o histórico, logo abaixo, também tem nomes de mercado). */
const storesListed = () => {
  const text = page();
  const section = text.slice(text.indexOf('Último preço por mercado'), text.indexOf('Histórico de preço'));
  return section.filter((t) => t === 'Assaí' || t === 'Atacadão');
};
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
  mockDb.tables = { products: products(), stores: stores(), latest_prices: [], receipt_items: lines() };
  mockDb.asked = [];
  mockDb.failing = new Set();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  onlineManager.setOnline(true);
  client.clear();
});

describe('tela do produto sem internet', () => {
  /** O que a lista guarda no aparelho (lib/queryClient, PERSISTED): o produto, os mercados e os últimos preços da casa. */
  function savedOnDevice(prices: Row[] = latest()) {
    client.setQueryData(['products'], products());
    client.setQueryData(['stores'], stores());
    client.setQueryData(['latestPrices'], prices);
  }

  it('aberta pela lista, com o que ficou guardado: o produto e o último preço de cada mercado, com o aviso de que são os guardados', async () => {
    savedOnDevice();
    onlineManager.setOnline(false);
    open();
    await settle();
    const text = page();
    expect(text).not.toContain(OFFLINE_SCREEN);
    expect(loading()).toBe(false);
    expect(text).toEqual(expect.arrayContaining(['Último preço por mercado', SAVED_PRICES_OFFLINE, 'Assaí', 'Atacadão', 'Mais barato', 'Histórico de preço', OFFLINE_SECTION]));
    // Do mais barato ao mais caro, cada um com a última compra de lá; o preço de outro produto não entra.
    expect(storesListed()).toEqual(['Atacadão', 'Assaí']);
    expect(text.join('')).toContain('R$ 24,50/un');
    expect(text.join('')).toContain('R$ 25,90/un');
    expect(text.join('')).not.toContain('R$ 3,99');
    // Nada foi pedido, e a tela não diz o que não sabe.
    expect(mockDb.asked).toEqual([]);
    expect(text).not.toContain('Nenhuma nota confirmada com este produto ainda.');

    await backOnline();
    expect(page()).not.toContain(OFFLINE_SCREEN);
    expect(page()).not.toContain(SAVED_PRICES_OFFLINE);
    expect(page()).not.toContain(OFFLINE_SECTION);
    // Com a conexão de volta, a lista sai do histórico: no banco, só o Assaí.
    expect(storesListed()).toEqual(['Assaí']);
    expect(page()).toEqual(expect.arrayContaining(['Último preço por mercado', 'Histórico de preço', 'R$ 25,90/un · Assaí · 10 out', '2 compras em 6 meses']));
  });

  it('o seletor de categoria diz que a categoria vale também para as compras dos meses passados', async () => {
    savedOnDevice();
    onlineManager.setOnline(false);
    open();
    await settle();
    expect(mockPicker.props).toMatchObject({ title: 'Categoria', message: PRODUCT_CATEGORY_NOTE });
  });

  it('sem preço deste produto guardado: diz isso, sem dizer que não há nota', async () => {
    savedOnDevice(latest().filter((row) => row.product_id !== 'arroz'));
    onlineManager.setOnline(false);
    open();
    await settle();
    expect(page()).toContain(NO_SAVED_PRICES_OFFLINE);
    expect(page()).not.toContain('Nenhum preço por mercado ainda.');
    expect(page()).not.toContain(SAVED_PRICES_OFFLINE);
    expect(page()).toContain('Nome do produto');
    expect(loading()).toBe(false);
    expect(mockDb.asked).toEqual([]);
  });

  it('sem nada no aparelho: o aviso de tela inteira', async () => {
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
    await settle();
    await settle();
    expect(loading()).toBe(false);
    expect(page()).toEqual(expect.arrayContaining(['Histórico de preço', '2 compras em 6 meses']));
    expect(page()).not.toContain(OFFLINE_SCREEN);
    expect(page()).not.toContain(SAVED_PRICES_OFFLINE);
  });

  it('com internet e a busca das compras falhando: os últimos preços guardados, com o aviso de que não deu para atualizar', async () => {
    savedOnDevice();
    mockDb.failing.add('receipt_items');
    open();
    await settle();
    await settle();
    expect(page()).toEqual(expect.arrayContaining(['Último preço por mercado', SAVED_PRICES_ERROR, 'Assaí', 'Atacadão']));
    expect(page()).not.toContain(SAVED_PRICES_OFFLINE);
  });
});

describe('"Último preço por mercado" com muitas compras', () => {
  it('o mercado da última compra antiga continua na lista, mesmo atrás de mais de 100 compras mais novas de outro', async () => {
    const recent = Array.from({ length: 150 }, (_, index): Row => ({
      id: `n${String(index).padStart(3, '0')}`,
      receipt_id: `rn${index}`,
      product_id: 'arroz',
      quantity: 1,
      unit: 'un',
      unit_price: 25.9,
      total_price: 25.9,
      receipt: { purchased_at: new Date(Date.parse(at('2026-10-10')) - index * 3_600_000).toISOString(), store_id: 'assai', store: { name: 'Assaí' } },
    }));
    const old: Row = {
      id: 'a000',
      receipt_id: 'ra',
      product_id: 'arroz',
      quantity: 1,
      unit: 'un',
      unit_price: 21.9,
      total_price: 21.9,
      receipt: { purchased_at: at('2025-01-15'), store_id: 'atacadao', store: { name: 'Atacadão' } },
    };
    mockDb.tables.receipt_items = [...recent, old];
    open();
    await settle();
    await settle();
    const text = page();
    expect(storesListed()).toEqual(['Atacadão', 'Assaí']);
    expect(text.join('')).toContain('R$ 21,90/un');
    // Só uma busca das compras, para a lista e para o histórico; a view com o corte não é mais lida.
    expect(mockDb.asked.filter((name) => name === 'receipt_items')).toHaveLength(1);
    expect(mockDb.asked).not.toContain('price_observations');
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

describe('produto comprado só em notas sem mercado', () => {
  it('"Último preço por mercado" não diz que não há nota: as compras estão no histórico logo abaixo', async () => {
    // A nota sem mercado não entra nos preços por mercado, mas é compra.
    mockDb.tables.receipt_items = lines().map((line) => ({ ...line, receipt: { ...(line.receipt as Row), store_id: null, store: null } }));
    open();
    await settle();
    await settle();
    const text = page();
    expect(text).toContain('As compras deste produto estão em notas sem mercado informado: veja o histórico abaixo.');
    expect(text).not.toContain('Nenhuma nota confirmada com este produto ainda.');
    expect(text).toEqual(expect.arrayContaining(['Histórico de preço', 'R$ 25,90/un · Mercado não informado · 10 out']));
  });

  it('compra com mercado e sem valor: fica fora dos preços por mercado, e a frase diz que está sem valor', async () => {
    // Zero não é preço: a leitura dos preços por mercado deixa a linha de fora.
    mockDb.tables.receipt_items = [{ ...lines()[1], unit_price: 0, total_price: 0 }];
    open();
    await settle();
    await settle();
    expect(page()).toContain('A compra deste produto está sem valor: veja o histórico abaixo.');
    expect(page()).not.toContain('sem mercado informado');
    expect(page()).toContain('Histórico de preço');
  });

  it('sem compra nenhuma, a frase de sempre', async () => {
    mockDb.tables.receipt_items = [];
    open();
    await settle();
    await settle();
    expect(page()).toContain('Nenhuma nota confirmada com este produto ainda.');
    expect(page()).not.toContain('Histórico de preço');
  });
});
