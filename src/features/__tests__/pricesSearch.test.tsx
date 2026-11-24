import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import PricesScreen from '@/app/precos';
import { NO_PRICE_YET } from '@/domain/prices';
import type { LatestPrice, Product, Store } from '@/lib/types';

// Preços de verdade, com as buscas trocadas por respostas prontas: buscando, os produtos que ainda não têm preço
// de nota aparecem depois dos que têm, e abrem a tela do produto (onde dá para juntar, desfazer um "São
// diferentes" ou excluir). Sem a busca, a tela é a dos preços, como sempre.

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockQueries: Record<'products' | 'stores' | 'prices', unknown> = {} as never;
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
  },
}));
jest.mock('@/data/market', () => ({
  useLatestPrices: () => mockQueries.prices,
  useProducts: () => mockQueries.products,
  useStores: () => mockQueries.stores,
}));
jest.mock('@/data/sharedPrices', () => ({ useSharedPrices: () => ({ data: [], isSuccess: true, isFetching: false }) }));
jest.mock('@/features/MergeSuggestionsCard', () => ({ MergeSuggestionsCard: () => null }));
jest.mock('@/features/ProductBarcode', () => ({ useProductBarcode: () => ({ available: false, start: () => undefined, element: null }) }));
jest.mock('@/lib/supabase', () => ({ errorMessage: (error: { message?: string }) => error?.message ?? String(error) }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

const loaded = (data: unknown) => ({
  data,
  isPending: false,
  isSuccess: true,
  isFetching: false,
  isError: false,
  error: null,
  isRefetching: false,
  fetchStatus: 'idle',
  refetch: jest.fn(),
});

const product = (id: string, name: string, category = 'mercearia'): Product => ({ id, name, category, shelf_life_days: null });
// O catálogo vem por nome (fetchProducts).
const PRODUCTS = [
  product('bisc-errado', 'Biscoito errado'),
  product('bisc-maizena', 'Biscoito maizena'),
  product('bisc-recheado', 'Biscoito recheado'),
  product('leite', 'Leite', 'laticinios'),
];
const STORES: Store[] = [{ id: 'assai', name: 'Assaí', cnpj: null, address: null }];
const price = (product_id: string, unit_price: number): LatestPrice => ({
  product_id,
  store_id: 'assai',
  unit: 'un',
  unit_price,
  purchased_at: '2026-11-10T12:00:00-03:00',
});

let renderer: ReactTestRenderer | undefined;

const rawText = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(rawText).join(''));
/** O que a tela escreve, sem os ícones (que são letras de uma fonte de desenhos). */
const textOf = (node: ReactTestInstance | string) => rawText(node).replace(/[-]|[\u{F0000}-\u{10FFFF}]/gu, '');
const page = () => textOf(renderer!.root);
/** As linhas da lista, na ordem: o nome e o que vem embaixo dele. */
const rows = () =>
  renderer!.root
    .findAll((node) => typeof node.props.title === 'string' && 'subtitle' in node.props && typeof node.props.onPress === 'function')
    .filter((node, index, all) => all.findIndex((other) => other.props.title === node.props.title) === index)
    .map((node) => node.props.title as string);

async function mount() {
  await act(async () => {
    renderer = create(<PricesScreen />);
  });
}
async function search(text: string) {
  const [field] = renderer!.root.findAll((node) => typeof node.props.onChangeText === 'function' && node.props.placeholder === 'Buscar produto');
  await act(async () => {
    field.props.onChangeText(text);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockQueries, {
    products: loaded(PRODUCTS),
    stores: loaded(STORES),
    prices: loaded([price('bisc-recheado', 4.99), price('leite', 5.49)]),
  });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('Preços: buscando, também os produtos sem preço de nota', () => {
  it('sem busca, só os que têm preço', async () => {
    await mount();
    expect(rows()).toEqual(['Biscoito recheado', 'Leite']);
    expect(page()).not.toContain(NO_PRICE_YET);
  });

  it('buscando, os com preço primeiro e depois os sem preço, na ordem do catálogo, cada um com a linha de sem preço', async () => {
    await mount();
    await search('biscoito');
    expect(rows()).toEqual(['Biscoito recheado', 'Biscoito errado', 'Biscoito maizena']);
    expect(page()).toContain(`Biscoito errado${NO_PRICE_YET}`);
    expect(page()).toContain(`Biscoito maizena${NO_PRICE_YET}`);
    // O que tem preço continua com o preço, e o sem preço não tem valor nenhum à direita.
    expect(page()).toContain('Biscoito recheadoSó em AssaíR$ 4,99');
    expect(page()).not.toContain(`${NO_PRICE_YET}R$`);
  });

  it('o produto sem preço abre a tela dele', async () => {
    await mount();
    await search('errado');
    expect(rows()).toEqual(['Biscoito errado']);
    const [row] = renderer!.root.findAll((node) => node.props.title === 'Biscoito errado' && typeof node.props.onPress === 'function');
    await act(async () => row.props.onPress());
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/produto/[id]', params: { id: 'bisc-errado' } });
  });

  it('"Nenhum produto com esse nome" só quando nenhum produto tem o nome', async () => {
    await mount();
    await search('maizena');
    expect(page()).not.toContain('Nenhum produto com esse nome');
    await search('xyz');
    expect(page()).toContain('Nenhum produto com esse nome');
  });

  it('a casa sem preço nenhum: sem busca, "Sem preços ainda"; buscando, acha o produto', async () => {
    mockQueries.prices = loaded([]);
    await mount();
    expect(page()).toContain('Sem preços ainda');
    await search('leite');
    expect(rows()).toEqual(['Leite']);
    expect(page()).toContain(`Leite${NO_PRICE_YET}`);
  });
});
