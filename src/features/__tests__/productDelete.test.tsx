import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import ProductScreen from '@/app/produto/[id]';
import {
  DELETE_BUTTON,
  DELETE_CHECK_FAILED,
  DELETE_CHECK_FAILED_TITLE,
  DELETE_CONFIRM,
  DELETE_GONE_TITLE,
  DELETE_IN_REVIEW_TITLE,
  DELETE_PURCHASED,
  DELETE_PURCHASED_TITLE,
  DELETE_RENAMED,
  DELETE_RENAMED_TITLE,
  DELETE_TITLE,
  deleteInReviewMessage,
  deleteQuestion,
  OPEN_REVIEW,
  PRODUCT_NOT_CHECKED,
  PRODUCT_NOT_IN_HOUSE,
} from '@/domain/productDelete';
import { DISTINCT_TITLE, orderedPair, type MergeSuggestion } from '@/domain/productMerge';
import { useMergeSuggestions } from '@/features/useProductMerge';
import { FEATURES } from '@/lib/features';
import { OFFLINE_TRY_AGAIN } from '@/lib/networkErrors';
import { confirmAction, notify } from '@/ui/dialogs';
import { Loading } from '@/ui/primitives';

// A tela do produto de verdade, com as consultas de verdade e um QueryClient com os padrões do app. Só a rede é
// trocada: um "banco" em memória atrás do cliente do Supabase, que respeita os filtros que a leitura de excluir
// manda (a nota confirmada ou o rascunho pela nota embutida, a despensa aberta, a lista que não foi arquivada).

type Row = Record<string, unknown>;
type Reply = { data: unknown; error: object | null; count?: number | null };

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockDb = {
  tables: {} as Record<string, Row[]>,
  /** As leituras destas tabelas falham, como sem conexão. */
  failing: new Set<string>(),
  /** As leituras destas tabelas ficam sem resposta até `release` (ou até o corte delas). */
  hold: new Set<string>(),
  /** A busca do catálogo inteiro (fetchProducts, a que pede a contagem) fica sem resposta; a de um produto só, não. */
  holdCatalog: false,
  release: [] as (() => void)[],
  asked: [] as string[],
  rpcs: [] as { name: string; args: unknown }[],
  available: { data: true, error: null } as Reply,
  /** A resposta de delete_product; sem ela, o banco exclui de verdade. */
  deleteAnswer: null as null | (() => Promise<Reply>),
};
const mockParams = { id: 'biscoito' };
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn(), confirmAction: jest.fn() }));
jest.mock('@/ui/PickerModal', () => ({ PickerModal: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
// Os preços de outras casas não entram no que se confere aqui.
jest.mock('@/features/SharedPrices', () => ({ SharedPricesSection: () => null }));
jest.mock('@/lib/supabase', () => {
  const { isNetworkFailure, OFFLINE_TRY_AGAIN: offline } = jest.requireActual<typeof import('@/lib/networkErrors')>('@/lib/networkErrors');
  const field = (row: Row, column: string): unknown =>
    column.split('.').reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Row)[key] : undefined), row);
  const untilAborted = (signal: AbortSignal | undefined) =>
    new Promise<Reply>((resolve) => {
      mockDb.release.push(() => resolve({ data: [], error: null, count: 0 }));
      signal?.addEventListener('abort', () => resolve({ data: null, error: { message: 'AbortError: Aborted', code: '' }, count: null }));
    });
  const read = (name: string, rowsOf: () => Row[]) => {
    const filters: ((row: Row) => boolean)[] = [];
    let count: string | undefined;
    let limit: number | undefined;
    let range: [number, number] | undefined;
    let signal: AbortSignal | undefined;
    const query = {
      select: (_columns?: string, options?: { count?: string }) => {
        count = options?.count;
        return query;
      },
      eq: (column: string, value: unknown) => (filters.push((row) => field(row, column) === value), query),
      is: (column: string, value: unknown) => (filters.push((row) => (field(row, column) ?? null) === value), query),
      in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(field(row, column))), query),
      gt: (column: string, value: unknown) => (filters.push((row) => String(field(row, column)) > String(value)), query),
      order: () => query,
      limit: (rows: number) => ((limit = rows), query),
      range: (from: number, to: number) => ((range = [from, to]), query),
      abortSignal: (given: AbortSignal) => ((signal = given), query),
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve()
          .then((): Reply | Promise<Reply> => {
            mockDb.asked.push(name);
            if (mockDb.hold.has(name) || (mockDb.holdCatalog && name === 'products' && count === 'exact')) return untilAborted(signal);
            if (mockDb.failing.has(name)) return { data: null, count: null, error: { message: 'TypeError: Network request failed' } };
            let rows = rowsOf().filter((row) => filters.every((keep) => keep(row)));
            const total = rows.length;
            if (range) rows = rows.slice(range[0], range[1] + 1);
            if (limit != null) rows = rows.slice(0, limit);
            return { data: rows.map((row) => ({ ...row })), count: count === 'exact' ? total : null, error: null };
          })
          .then(resolve, reject),
    };
    return query;
  };
  const rpc = (name: string, args: unknown) => {
    mockDb.rpcs.push({ name, args });
    let signal: AbortSignal | undefined;
    const answer = (): Promise<Reply> => {
      if (name === 'delete_product_available') return Promise.resolve(mockDb.available);
      if (name !== 'delete_product') return Promise.resolve({ data: [], error: null });
      if (mockDb.deleteAnswer) return mockDb.deleteAnswer();
      const { p_id } = args as { p_id: string };
      mockDb.tables.products = (mockDb.tables.products ?? []).filter((product) => product.id !== p_id);
      return Promise.resolve({ data: { deleted: p_id, pantry: 0, list: 0, barcodes: 0 }, error: null });
    };
    const request = {
      abortSignal: (given: AbortSignal) => ((signal = given), request),
      order: () => request,
      range: () => request,
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        Promise.race([answer(), new Promise<Reply>((done) => signal?.addEventListener('abort', () => done({ data: null, error: { message: 'AbortError: Aborted', code: '' } })))]).then(
          resolve,
          reject,
        ),
    };
    return request;
  };
  return {
    errorMessage: (error: { message?: string }) => (isNetworkFailure(error) ? offline : (error?.message ?? 'Algo deu errado. Tente novamente.')),
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
    supabase: {
      from: (name: string) => ({
        ...read(name, () => mockDb.tables[name] ?? []),
        upsert: () => ({ abortSignal: () => Promise.resolve({ data: null, error: null }) }),
        delete: () => read(name, () => []),
      }),
      rpc,
    },
  };
});

const at = (day: string) => new Date(`${day}T15:00:00`).toISOString();
const product = (id: string, name: string, category = 'mercearia'): Row => ({ id, name, category, shelf_life_days: null });
const line = (id: string, productId: string, status: 'confirmed' | 'draft', store: string | null = 'Assaí', day = '2026-11-12'): Row => ({
  id,
  receipt_id: `r-${id}`,
  product_id: productId,
  raw_description: 'ARROZ 5KG',
  quantity: 1,
  unit: 'un',
  unit_price: 25.9,
  total_price: 25.9,
  receipt: { status, purchased_at: at(day), store_id: 'assai', store: store ? { name: store } : null },
});

let client: QueryClient;
let renderer: ReactTestRenderer | undefined;
/** Tudo o que a tela já desenhou, depois de cada passo: a tela que sai nunca pode dizer que o produto não existe. */
let seen: string[] = [];

const texts = (node: ReturnType<ReactTestRenderer['toJSON']> | string): string[] =>
  node == null ? [] : typeof node === 'string' ? [node] : Array.isArray(node) ? node.flatMap(texts) : (node.children ?? []).flatMap(texts);
const page = () => (renderer ? texts(renderer.toJSON()) : []);
const record = () => {
  seen.push(...page());
};
const settle = async (ms = 30) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
  record();
};
/** Abre a tela do produto; `beside` fica montado junto, como a tela de baixo na pilha (Preços). */
async function open(beside?: ReactNode) {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        {beside}
        <ProductScreen />
      </QueryClientProvider>,
    );
  });
  record();
  // As buscas da tela saem umas depois das outras (o catálogo, as compras, os pares): umas voltas até todas chegarem.
  for (let round = 0; round < 3; round++) await settle();
}
const deleteButton = () => renderer!.root.findAll((node) => node.props.title === DELETE_BUTTON && typeof node.props.onPress === 'function');
const tap = async () => {
  await act(async () => {
    deleteButton()[0].props.onPress();
  });
  await settle();
};
const asked = (name: string) => mockDb.asked.filter((table) => table === name).length;
const confirmMock = confirmAction as jest.MockedFunction<typeof confirmAction>;
const notifyMock = notify as jest.MockedFunction<typeof notify>;
/** Confirma a última pergunta (como o "Excluir" do Alert, ou o OK do confirm do navegador). */
const confirmLast = async () => {
  const onConfirm = confirmMock.mock.calls.at(-1)![3];
  await act(async () => {
    onConfirm();
  });
  await settle();
};
const rpcCalls = (name: string) => mockDb.rpcs.filter((call) => call.name === name);

beforeEach(() => {
  jest.replaceProperty(FEATURES, 'finance', false);
  client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false, gcTime: Infinity }, mutations: { networkMode: 'always', gcTime: Infinity } } });
  mockDb.tables = {
    products: [product('biscoito', 'Biscoito errado'), product('arroz', 'Arroz 5kg'), product('recheado', 'Biscoito recheado')],
    stores: [{ id: 'assai', name: 'Assaí', cnpj: null, address: null }],
    latest_prices: [],
    receipt_items: [line('l1', 'arroz', 'confirmed')],
    pantry_items: [],
    shopping_list_items: [],
    product_barcodes: [],
    product_distinct_pairs: [],
  };
  mockDb.failing = new Set();
  mockDb.hold = new Set();
  mockDb.holdCatalog = false;
  mockDb.release = [];
  mockDb.asked = [];
  mockDb.rpcs = [];
  mockDb.available = { data: true, error: null };
  mockDb.deleteAnswer = null;
  mockParams.id = 'biscoito';
  mockRouter.canGoBack.mockReturnValue(true);
  seen = [];
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  onlineManager.setOnline(true);
  jest.useRealTimers();
  jest.clearAllMocks();
  client.clear();
});

describe('"Excluir produto" na tela do produto', () => {
  it('vem no fim: "Juntar com outro produto", depois "Marcados como diferentes", depois "Excluir produto"', async () => {
    mockDb.tables.product_distinct_pairs = [{ product_a: 'biscoito', product_b: 'recheado' }];
    await open();
    const text = page();
    const join = text.indexOf('Juntar com outro produto');
    expect(join).toBeGreaterThan(-1);
    expect(text.indexOf(DISTINCT_TITLE)).toBeGreaterThan(join);
    expect(text.indexOf(DELETE_BUTTON)).toBeGreaterThan(text.indexOf(DISTINCT_TITLE));
  });

  it('só para o produto sem compra, com as compras respondidas', async () => {
    await open();
    expect(deleteButton()).toHaveLength(1);
    await act(async () => renderer?.unmount());

    mockParams.id = 'arroz';
    await open();
    expect(page()).toContain('Juntar com outro produto');
    expect(deleteButton()).toHaveLength(0);
  });

  it('enquanto as compras carregam, depois de a busca delas falhar, e parada sem internet sem nada guardado: sem o botão', async () => {
    mockDb.hold.add('receipt_items');
    await open();
    expect(page()).toContain('Juntar com outro produto');
    expect(deleteButton()).toHaveLength(0);
    await act(async () => renderer?.unmount());
    mockDb.release.forEach((release) => release());
    client.clear();

    mockDb.hold.clear();
    mockDb.failing.add('receipt_items');
    await open();
    expect(page()).toContain('Juntar com outro produto');
    expect(deleteButton()).toHaveLength(0);
    await act(async () => renderer?.unmount());
    client.clear();

    mockDb.failing.clear();
    client.setQueryData(['products'], mockDb.tables.products);
    client.setQueryData(['stores'], mockDb.tables.stores);
    onlineManager.setOnline(false);
    await open();
    expect(page()).toContain('Juntar com outro produto');
    expect(deleteButton()).toHaveLength(0);
  });

  it('o banco ainda não sabe excluir (sem a pergunta, ou ela responde que não): sem o botão', async () => {
    mockDb.available = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.delete_product_available without parameters in the schema cache' } };
    await open();
    expect(page()).toContain('Juntar com outro produto');
    expect(deleteButton()).toHaveLength(0);
  });

  it('durante uma busca nova das compras, com elas na tela, o botão fica (não pisca)', async () => {
    await open();
    const before = deleteButton()[0];
    mockDb.hold.add('receipt_items');
    await act(async () => {
      void client.invalidateQueries({ queryKey: ['priceHistory'] });
    });
    await settle();
    expect(deleteButton()).toHaveLength(1);
    expect(deleteButton()[0]).toBe(before);
    mockDb.release.forEach((release) => release());
  });
});

describe('o toque lê o produto de novo e pergunta', () => {
  it('a pergunta diz o que acontece, com o nome lido; cancelar não manda nada', async () => {
    mockDb.tables.pantry_items = [{ product_id: 'biscoito', consumed_at: null }];
    mockDb.tables.shopping_list_items = [{ product_id: 'biscoito', list: { id: 'l1', archived_at: null } }];
    mockDb.tables.product_barcodes = [{ product_id: 'biscoito', gtin: '07891000100103' }];
    await open();
    await tap();
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(confirmMock.mock.calls[0].slice(0, 3)).toEqual([
      DELETE_TITLE,
      deleteQuestion('Biscoito errado', { inPantry: true, onList: true, barcodes: { count: 1, first: '07891000100103' } }),
      DELETE_CONFIRM,
    ]);
    // A pergunta destrutiva (o "Excluir" em vermelho no iOS).
    expect(confirmMock.mock.calls[0][4]).toBeUndefined();
    expect(rpcCalls('delete_product')).toEqual([]);
  });

  it('confirmar manda o nome lido agora, mesmo que o guardado seja outro, e a tela busca os produtos de novo', async () => {
    await open();
    mockDb.tables.products = mockDb.tables.products.map((p) => (p.id === 'biscoito' ? { ...p, name: 'Biscoito errado 2' } : p));
    const productsBefore = asked('products');
    await tap();
    expect(confirmMock.mock.calls[0][1]).toContain('"Biscoito errado 2" sai dos produtos da casa.');
    // A leitura da pergunta e a busca nova dos produtos.
    expect(asked('products')).toBeGreaterThanOrEqual(productsBefore + 2);
    await confirmLast();
    expect(rpcCalls('delete_product')).toEqual([{ name: 'delete_product', args: { p_id: 'biscoito', p_name: 'Biscoito errado 2' } }]);
  });

  it('dois toques rápidos: uma leitura e uma pergunta; duas confirmações: um pedido', async () => {
    await open();
    const pantryBefore = asked('pantry_items');
    await act(async () => {
      const [button] = deleteButton();
      button.props.onPress();
      button.props.onPress();
    });
    await settle();
    expect(asked('pantry_items')).toBe(pantryBefore + 1);
    expect(confirmMock).toHaveBeenCalledTimes(1);
    const onConfirm = confirmMock.mock.calls[0][3];
    mockDb.deleteAnswer = () => new Promise<Reply>((resolve) => setTimeout(() => resolve({ data: { deleted: 'biscoito' }, error: null }), 20));
    await act(async () => {
      onConfirm();
      onConfirm();
    });
    await settle(60);
    expect(rpcCalls('delete_product')).toHaveLength(1);
  });

  it('excluiu: a tela volta, mostra o carregando no lugar, e nunca diz que o produto não existe', async () => {
    await open();
    await tap();
    await confirmLast();
    await settle();
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(renderer!.root.findAllByType(Loading).length).toBeGreaterThan(0);
    expect(seen).not.toContain(PRODUCT_NOT_IN_HOUSE);
    expect(seen).not.toContain(PRODUCT_NOT_CHECKED);
  });

  it('sem para onde voltar (a página recarregada): vai para Preços', async () => {
    mockRouter.canGoBack.mockReturnValue(false);
    await open();
    await tap();
    await confirmLast();
    expect(mockRouter.replace).toHaveBeenCalledWith('/precos');
    expect(seen).not.toContain(PRODUCT_NOT_IN_HOUSE);
  });
});

describe('o cartão "Parecem o mesmo produto" de Preços, montado embaixo da tela', () => {
  /** O que o cartão mostrou, render a render: cada sugestão como os dois nomes. */
  let shown: string[][] = [];
  const pairLabel = ({ keep, other }: MergeSuggestion) => [keep.name, other.name].sort().join(' / ');
  function PricesCard() {
    shown.push(useMergeSuggestions().suggestions.map(pairLabel));
    return null;
  }
  const refused = ['Limao', 'Limão siciliano'].sort().join(' / ');

  beforeEach(() => {
    shown = [];
    mockParams.id = 'limao';
    mockDb.tables.products = [
      product('siciliano', 'Limão siciliano', 'hortifruti'),
      product('limao', 'Limao', 'hortifruti'),
      product('arroz', 'Arroz 5kg'),
      product('tiojoao', 'Arroz Tio João 5 kg'),
    ];
    // A casa disse que "Limao" e "Limão siciliano" são diferentes.
    mockDb.tables.product_distinct_pairs = [{ ...orderedPair('limao', 'siciliano') }];
    // Excluir, no banco: o produto sai, e os pares dele com ele (cascade).
    mockDb.deleteAnswer = async () => {
      mockDb.tables.products = mockDb.tables.products.filter((row) => row.id !== 'limao');
      mockDb.tables.product_distinct_pairs = [];
      return { data: { deleted: 'limao', pantry: 0, list: 0, barcodes: 0 }, error: null };
    };
  });

  it('excluiu: o par recusado não volta como sugestão enquanto a busca nova dos produtos não chega', async () => {
    await open(<PricesCard />);
    expect(shown.at(-1)).toEqual(['Arroz 5kg / Arroz Tio João 5 kg']);
    // A busca nova do catálogo fica sem resposta (sinal fraco; um catálogo de várias páginas); os pares, buscados
    // de novo na hora, e as compras chegam antes dela.
    mockDb.holdCatalog = true;
    await tap();
    const from = shown.length;
    await confirmLast();
    for (let round = 0; round < 4; round++) await settle();
    expect(rpcCalls('delete_product')).toHaveLength(1);
    expect(client.getQueryState(['products'])?.fetchStatus).toBe('fetching');
    expect(client.getQueryData(['productDistinctPairs'])).toEqual([]);
    expect(shown.slice(from).flat()).not.toContain(refused);
    expect(shown.at(-1)).toEqual(['Arroz 5kg / Arroz Tio João 5 kg']);
  });

  it('já tinha sido excluído em outro aparelho: o par recusado também não volta', async () => {
    await open(<PricesCard />);
    // Outro aparelho excluiu (o produto e os pares dele saíram do banco); este ainda tem os dois na memória.
    mockDb.tables.products = mockDb.tables.products.filter((row) => row.id !== 'limao');
    mockDb.tables.product_distinct_pairs = [];
    const from = shown.length;
    // A leitura do toque pergunta só por este produto e acha nada; a busca nova do catálogo, depois, fica sem resposta.
    mockDb.holdCatalog = true;
    await tap();
    for (let round = 0; round < 4; round++) await settle();
    expect(notifyMock).toHaveBeenCalledWith(DELETE_GONE_TITLE, PRODUCT_NOT_IN_HOUSE);
    expect(client.getQueryState(['products'])?.fetchStatus).toBe('fetching');
    expect(shown.slice(from).flat()).not.toContain(refused);
  });
});

describe('o que a leitura acha antes de perguntar', () => {
  it('num rascunho: diz qual nota, oferece "Abrir a nota" (sem ser destrutivo) e não pergunta de excluir', async () => {
    await open();
    mockDb.tables.receipt_items = [...mockDb.tables.receipt_items, line('d1', 'biscoito', 'draft', 'Assaí', '2026-11-12')];
    await tap();
    expect(confirmMock).toHaveBeenCalledTimes(1);
    const [title, message, label, onConfirm, destructive] = confirmMock.mock.calls[0];
    expect([title, message, label, destructive]).toEqual([
      DELETE_IN_REVIEW_TITLE,
      deleteInReviewMessage({ receiptId: 'r-d1', store: 'Assaí', day: '2026-11-12' }),
      OPEN_REVIEW,
      false,
    ]);
    await act(async () => onConfirm());
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/nota/[id]', params: { id: 'r-d1' } });
    expect(rpcCalls('delete_product')).toEqual([]);
  });

  it('uma compra que apareceu: avisa, sem perguntar', async () => {
    await open();
    mockDb.tables.receipt_items = [...mockDb.tables.receipt_items, line('c1', 'biscoito', 'confirmed')];
    await tap();
    expect(notifyMock).toHaveBeenCalledWith(DELETE_PURCHASED_TITLE, DELETE_PURCHASED);
    expect(confirmMock).not.toHaveBeenCalled();
    // As compras buscadas de novo escondem o botão.
    await settle();
    expect(deleteButton()).toHaveLength(0);
  });

  it('o produto já não existe: avisa e a tela sai', async () => {
    await open();
    mockDb.tables.products = mockDb.tables.products.filter((p) => p.id !== 'biscoito');
    await tap();
    expect(notifyMock).toHaveBeenCalledWith(DELETE_GONE_TITLE, PRODUCT_NOT_IN_HOUSE);
    expect(confirmMock).not.toHaveBeenCalled();
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  it('sem internet: "Não deu para conferir", com a frase de sem internet, e nenhuma pergunta', async () => {
    await open();
    for (const table of ['products', 'receipt_items', 'pantry_items', 'shopping_list_items', 'product_barcodes']) mockDb.failing.add(table);
    await tap();
    expect(notifyMock).toHaveBeenCalledWith(DELETE_CHECK_FAILED_TITLE, OFFLINE_TRY_AGAIN);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('a leitura que não responde é cortada em 10 s: "Não deu para conferir"', async () => {
    await open();
    jest.useFakeTimers();
    mockDb.hold.add('pantry_items');
    await act(async () => {
      deleteButton()[0].props.onPress();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(9_999);
    });
    expect(notifyMock).not.toHaveBeenCalled();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(notifyMock).toHaveBeenCalledWith(DELETE_CHECK_FAILED_TITLE, DELETE_CHECK_FAILED);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('a tela saiu durante a leitura: nada é mostrado nem perguntado', async () => {
    await open();
    mockDb.hold.add('pantry_items');
    await act(async () => {
      deleteButton()[0].props.onPress();
    });
    await act(async () => renderer?.unmount());
    renderer = undefined;
    await act(async () => {
      mockDb.release.forEach((release) => release());
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(notifyMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
  });
});

describe('o pedido de excluir', () => {
  it('o nome mudou em outro aparelho (NK008): avisa, a tela fica, e o toque seguinte pergunta com o nome novo', async () => {
    await open();
    await tap();
    mockDb.deleteAnswer = () => Promise.resolve({ data: null, error: { code: 'NK008', message: 'product renamed' } });
    mockDb.tables.products = mockDb.tables.products.map((p) => (p.id === 'biscoito' ? { ...p, name: 'Biscoito de agora' } : p));
    await confirmLast();
    expect(notifyMock).toHaveBeenCalledWith(DELETE_RENAMED_TITLE, DELETE_RENAMED);
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(deleteButton()).toHaveLength(1);
    await tap();
    expect(confirmMock).toHaveBeenCalledTimes(2);
    expect(confirmMock.mock.calls[1][1]).toContain('"Biscoito de agora" sai dos produtos da casa.');
  });

  it('o erro que chega depois de a tela sair ainda aparece', async () => {
    await open();
    await tap();
    let answer: (reply: Reply) => void = () => undefined;
    mockDb.deleteAnswer = () => new Promise<Reply>((resolve) => (answer = resolve));
    await confirmLast();
    await act(async () => renderer?.unmount());
    renderer = undefined;
    await act(async () => {
      answer({ data: null, error: { code: 'NK016', message: 'product has purchases' } });
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(notifyMock).toHaveBeenCalledWith(DELETE_PURCHASED_TITLE, DELETE_PURCHASED);
  });
});

describe('o produto que não está no catálogo da tela', () => {
  it('com o catálogo recente sem ele: busca os produtos uma vez e só então diz que ele não está na casa', async () => {
    const cached = mockDb.tables.products.filter((p) => p.id !== 'biscoito');
    mockDb.tables.products = cached;
    client.setQueryData(['products'], cached);
    await open();
    await settle();
    expect(asked('products')).toBe(1);
    expect(page()).toContain(PRODUCT_NOT_IN_HOUSE);
    expect(seen).not.toContain(PRODUCT_NOT_CHECKED);
  });

  it('sem internet, ou com a busca falhando: não deu para conferir, com "Tentar de novo"', async () => {
    const cached = mockDb.tables.products.filter((p) => p.id !== 'biscoito');
    client.setQueryData(['products'], cached);
    client.setQueryData(['stores'], mockDb.tables.stores);
    onlineManager.setOnline(false);
    await open();
    expect(page()).toContain(PRODUCT_NOT_CHECKED);
    expect(page()).toContain('Tentar de novo');
    expect(page()).not.toContain(PRODUCT_NOT_IN_HOUSE);
    await act(async () => renderer?.unmount());
    onlineManager.setOnline(true);
    client.clear();

    client.setQueryData(['products'], cached);
    mockDb.failing.add('products');
    await open();
    await settle();
    expect(page()).toContain(PRODUCT_NOT_CHECKED);
    expect(page()).toContain('Tentar de novo');
    // A busca que volta a dar certo, sem o produto: aí ele não está na casa.
    mockDb.failing.delete('products');
    mockDb.tables.products = cached;
    await act(async () => {
      renderer!.root.findAll((node) => node.props.title === 'Tentar de novo' && typeof node.props.onPress === 'function')[0].props.onPress();
    });
    await settle();
    expect(page()).toContain(PRODUCT_NOT_IN_HOUSE);
  });
});
