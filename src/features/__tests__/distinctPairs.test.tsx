import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RefObject } from 'react';
import { AccessibilityInfo, Platform, type View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import {
  DISTINCT_TITLE,
  DISTINCT_UNDO_GONE,
  DISTINCT_UNDO_GONE_TITLE,
  DISTINCT_UNDONE,
  distinctIntro,
  UNDO_DISTINCT,
  UNDO_DISTINCT_FAILED_TITLE,
  undoDistinctLabel,
} from '@/domain/productMerge';
import type { ProductName } from '@/domain/similarNames';
import { DistinctPairsSection } from '@/features/DistinctPairsSection';
import { MergeSuggestionsCard } from '@/features/MergeSuggestionsCard';
import { notify } from '@/ui/dialogs';
import { moveFocus } from '@/ui/focus';

// "Marcados como diferentes" de verdade, com as consultas e o desfazer de verdade (data/productMerge) e um banco
// em memória atrás do cliente do Supabase. Junto, o cartão "Parecem o mesmo produto" com o mesmo QueryClient: é
// ele que mostra a sugestão que volta.

type Row = Record<string, unknown>;
type Reply = { data: unknown; error: object | null; count?: number | null };

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockDb = {
  products: [] as ProductName[],
  pairs: [] as { product_a: string; product_b: string }[],
  /** A leitura dos pares: falha com este erro. */
  pairsError: null as object | null,
  /** A leitura dos pares fica sem resposta. */
  holdPairs: false,
  /** O que o delete responde: apaga de verdade, apaga nada (alguém já desfez), falha, ou fica sem resposta até `release`. */
  deleteMode: 'delete' as 'delete' | 'none' | 'fail' | 'hold',
  release: null as null | (() => void),
  deletes: [] as Row[],
};

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn(), confirmAction: jest.fn() }));
jest.mock('@/ui/focus', () => ({ moveFocus: jest.fn() }));
jest.mock('@/lib/supabase', () => {
  const read = (name: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let range: [number, number] | undefined;
    let count: string | undefined;
    const rows = (): Row[] =>
      name === 'products' ? (mockDb.products as unknown as Row[]) : name === 'product_distinct_pairs' ? mockDb.pairs : [];
    const query = {
      select: (_columns?: string, options?: { count?: string }) => {
        count = options?.count;
        return query;
      },
      eq: () => query,
      in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), query),
      gt: (column: string, value: unknown) => (filters.push((row) => String(row[column]) > String(value)), query),
      order: () => query,
      limit: () => query,
      range: (from: number, to: number) => ((range = [from, to]), query),
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve()
          .then((): Reply | Promise<Reply> => {
            if (name === 'product_distinct_pairs') {
              if (mockDb.holdPairs) return new Promise<Reply>(() => undefined);
              if (mockDb.pairsError) return { data: null, error: mockDb.pairsError };
            }
            let found = rows().filter((row) => filters.every((keep) => keep(row)));
            const total = found.length;
            if (range) found = found.slice(range[0], range[1] + 1);
            return { data: found.map((row) => ({ ...row })), error: null, count: count === 'exact' ? total : null };
          })
          .then(resolve, reject),
    };
    return query;
  };
  const remove = () => {
    const filters: Record<string, unknown> = {};
    const query = {
      eq: (column: string, value: unknown) => ((filters[column] = value), query),
      select: (): Promise<Reply> => {
        mockDb.deletes.push({ ...filters });
        const hit = (pair: Row) => pair.product_a === filters.product_a && pair.product_b === filters.product_b;
        const done = (): Reply => {
          if (mockDb.deleteMode === 'fail') return { data: null, error: { message: 'deu ruim no banco' } };
          if (mockDb.deleteMode === 'none') return { data: [], error: null };
          const gone = mockDb.pairs.filter(hit);
          mockDb.pairs = mockDb.pairs.filter((pair) => !hit(pair));
          return { data: gone, error: null };
        };
        if (mockDb.deleteMode === 'hold') {
          return new Promise<Reply>((resolve) => {
            mockDb.release = () => {
              mockDb.deleteMode = 'delete';
              resolve(done());
            };
          });
        }
        return Promise.resolve(done());
      },
    };
    return query;
  };
  return {
    errorMessage: (error: { message?: string }) => error?.message ?? 'Algo deu errado. Tente novamente.',
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
    supabase: { from: (name: string) => ({ ...read(name), delete: remove }) },
  };
});

const named = (id: string, name: string, category = 'hortifruti'): ProductName => ({ id, name, category });

let client: QueryClient;
let renderer: ReactTestRenderer | undefined;
/** O "Juntar com outro produto" da tela: para onde o foco vai quando não sobra linha. */
let afterLast: RefObject<View | null>;

const texts = (node: ReturnType<ReactTestRenderer['toJSON']> | string): string[] =>
  node == null ? [] : typeof node === 'string' ? [node] : Array.isArray(node) ? node.flatMap(texts) : (node.children ?? []).flatMap(texts);
const page = () => texts(renderer!.toJSON());
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
async function open(product: ProductName, { withCard = false } = {}) {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        {withCard ? <MergeSuggestionsCard productId={product.id} onMerged={() => undefined} /> : null}
        <DistinctPairsSection product={product} afterLast={afterLast} />
      </QueryClientProvider>,
    );
  });
  for (let round = 0; round < 3; round++) await settle();
}
const undoButtons = () => renderer!.root.findAll((node) => node.props.title === UNDO_DISTINCT && typeof node.props.onPress === 'function');
const undoButton = (label: string) => undoButtons().find((node) => node.props.accessibilityLabel === label)!;
const undo = async (label: string) => {
  await act(async () => {
    undoButton(label).props.onPress();
  });
  await settle();
};
const moveFocusMock = moveFocus as jest.MockedFunction<typeof moveFocus>;
/** O botão para onde o último moveFocus levou o foco (a View do botão, com os props dele). */
const focusedLabel = () => (moveFocusMock.mock.calls.at(-1)![0].current as unknown as { props: { accessibilityLabel?: string } } | null)?.props.accessibilityLabel;
const notifyMock = notify as jest.MockedFunction<typeof notify>;

const LIMAO = named('a', 'Limão');

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  afterLast = { current: { props: { accessibilityLabel: 'Juntar com outro produto' } } as unknown as View };
  mockDb.products = [LIMAO, named('b', 'Limões'), named('c', 'Laranja'), named('x', 'Arroz', 'mercearia')];
  mockDb.pairs = [
    { product_a: 'a', product_b: 'b' },
    { product_a: 'a', product_b: 'c' },
    { product_a: 'b', product_b: 'x' },
  ];
  mockDb.pairsError = null;
  mockDb.holdPairs = false;
  mockDb.deleteMode = 'delete';
  mockDb.release = null;
  mockDb.deletes = [];
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  jest.clearAllMocks();
  jest.restoreAllMocks();
  client.clear();
});

describe('"Marcados como diferentes": quando aparece', () => {
  it('lista os produtos dos dois lados do par, por nome, com a explicação e um "Desfazer" que diz de quê', async () => {
    await open(LIMAO);
    const text = page();
    expect(text).toContain(DISTINCT_TITLE);
    expect(text).toContain(distinctIntro('Limão'));
    expect(text.filter((t) => t === 'Laranja' || t === 'Limões')).toEqual(['Laranja', 'Limões']);
    expect(undoButtons().map((button) => button.props.accessibilityLabel)).toEqual([
      undoDistinctLabel('Limão', 'Laranja'),
      undoDistinctLabel('Limão', 'Limões'),
    ]);
    // Do outro lado do par: o "Limões" vê o "Limão" (e o "Arroz", do par em que ele é o primeiro).
    await act(async () => renderer?.unmount());
    await open(named('b', 'Limões'));
    expect(undoButtons().map((button) => button.props.accessibilityLabel)).toEqual([
      undoDistinctLabel('Limões', 'Arroz'),
      undoDistinctLabel('Limões', 'Limão'),
    ]);
  });

  it('não aparece sem a tabela, sem par, com o outro produto fora do catálogo, enquanto carrega ou depois de falhar', async () => {
    const cases: (() => void)[] = [
      () => (mockDb.pairsError = { code: 'PGRST205', message: "Could not find the table 'public.product_distinct_pairs' in the schema cache" }),
      () => (mockDb.pairs = []),
      () => (mockDb.pairs = [{ product_a: 'a', product_b: 'zz-gone' }]),
      () => (mockDb.holdPairs = true),
      () => (mockDb.pairsError = { message: 'TypeError: Network request failed' }),
    ];
    for (const setUp of cases) {
      setUp();
      await open(LIMAO);
      expect(page()).not.toContain(DISTINCT_TITLE);
      expect(undoButtons()).toHaveLength(0);
      await act(async () => renderer?.unmount());
      client.clear();
      mockDb.pairs = [{ product_a: 'a', product_b: 'b' }];
      mockDb.pairsError = null;
      mockDb.holdPairs = false;
    }
  });
});

describe('desfazer', () => {
  it('a linha sai na hora, e a sugestão de juntar volta no cartão de cima', async () => {
    await open(LIMAO, { withCard: true });
    expect(page()).not.toContain('Parecem o mesmo produto');
    await undo(undoDistinctLabel('Limão', 'Limões'));
    expect(mockDb.deletes).toEqual([{ product_a: 'a', product_b: 'b' }]);
    expect(undoButtons().map((button) => button.props.accessibilityLabel)).toEqual([undoDistinctLabel('Limão', 'Laranja')]);
    await settle();
    expect(page()).toContain('Parecem o mesmo produto');
  });

  it('com outro par guardado de mesmo nome, a regra do nome continua escondendo a sugestão', async () => {
    const siciliano = named('s', 'Limão siciliano');
    mockDb.products = [siciliano, named('b', 'Limao'), named('d', 'Limão')];
    mockDb.pairs = [
      { product_a: 'b', product_b: 's' },
      { product_a: 'd', product_b: 's' },
    ];
    await open(siciliano, { withCard: true });
    await undo(undoDistinctLabel('Limão siciliano', 'Limao'));
    await settle();
    expect(page()).not.toContain('Parecem o mesmo produto');
    expect(undoButtons().map((button) => button.props.accessibilityLabel)).toEqual([undoDistinctLabel('Limão siciliano', 'Limão')]);
  });

  it('o foco vai para o próximo "Desfazer"; da última linha, para o de antes; sem linha nenhuma, para "Juntar com outro produto"', async () => {
    mockDb.products = [LIMAO, named('b', 'Limões'), named('c', 'Laranja'), named('d', 'Lima')];
    mockDb.pairs = [
      { product_a: 'a', product_b: 'b' },
      { product_a: 'a', product_b: 'c' },
      { product_a: 'a', product_b: 'd' },
    ];
    await open(LIMAO);
    // Na ordem da tela: Laranja, Lima, Limões.
    await undo(undoDistinctLabel('Limão', 'Lima'));
    expect(focusedLabel()).toBe(undoDistinctLabel('Limão', 'Limões'));
    await undo(undoDistinctLabel('Limão', 'Limões'));
    expect(focusedLabel()).toBe(undoDistinctLabel('Limão', 'Laranja'));
    await undo(undoDistinctLabel('Limão', 'Laranja'));
    expect(moveFocusMock.mock.calls.at(-1)![0]).toBe(afterLast);
    expect(page()).not.toContain(DISTINCT_TITLE);
    expect(moveFocusMock).toHaveBeenCalledTimes(3);
  });

  it('no celular, o leitor de tela ouve que foi desfeito', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    await open(LIMAO);
    await undo(undoDistinctLabel('Limão', 'Limões'));
    expect(announce).toHaveBeenCalledWith(DISTINCT_UNDONE);
    expect(renderer!.root.findAll((node) => node.props.testID === 'distinct-undone-region')).toHaveLength(0);
  });

  it('no navegador, a região viva diz que foi desfeito, e fica na página quando a seção some', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    mockDb.pairs = [{ product_a: 'a', product_b: 'b' }];
    await open(LIMAO);
    const region = () => renderer!.root.find((node) => node.props.testID === 'distinct-undone-region' && typeof node.type === 'string');
    expect(region().props['aria-live']).toBe('polite');
    expect(texts(region() as unknown as ReturnType<ReactTestRenderer['toJSON']>)).toEqual([]);
    await undo(undoDistinctLabel('Limão', 'Limões'));
    expect(page()).not.toContain(DISTINCT_TITLE);
    expect(page()).toContain(DISTINCT_UNDONE);
    expect(region().props['aria-live']).toBe('polite');
    expect(announce).not.toHaveBeenCalled();
  });

  it('nada guardado (alguém já desfez): avisa que já tinha saído', async () => {
    mockDb.deleteMode = 'none';
    await open(LIMAO);
    await undo(undoDistinctLabel('Limão', 'Limões'));
    expect(notifyMock).toHaveBeenCalledWith(DISTINCT_UNDO_GONE_TITLE, DISTINCT_UNDO_GONE);
    expect(moveFocusMock).not.toHaveBeenCalled();
  });

  it('o erro vira aviso', async () => {
    mockDb.deleteMode = 'fail';
    await open(LIMAO);
    await undo(undoDistinctLabel('Limão', 'Limões'));
    expect(notifyMock).toHaveBeenCalledWith(UNDO_DISTINCT_FAILED_TITLE, 'deu ruim no banco');
  });

  it('enquanto desfaz, todos os "Desfazer" ficam parados, e o tocado gira', async () => {
    mockDb.deleteMode = 'hold';
    await open(LIMAO);
    await undo(undoDistinctLabel('Limão', 'Limões'));
    expect(undoButtons().every((button) => button.props.disabled === true)).toBe(true);
    expect(undoButton(undoDistinctLabel('Limão', 'Limões')).props.loading).toBe(true);
    expect(undoButton(undoDistinctLabel('Limão', 'Laranja')).props.loading).toBe(false);
    await act(async () => mockDb.release?.());
    await settle();
    expect(undoButtons().map((button) => button.props.accessibilityLabel)).toEqual([undoDistinctLabel('Limão', 'Laranja')]);
  });
});
