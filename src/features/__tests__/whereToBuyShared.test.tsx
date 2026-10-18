import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import WhereToBuyScreen from '@/app/lista/[id]/onde-comprar';
import { formatShortDate, toISODate } from '@/domain/dates';
import { LinkIndex } from '@/domain/listLinks';
import { SHARED_PRICES_NOTICE, type SharedPrice } from '@/domain/sharedPrices';
import type { LatestPrice, Product, ShoppingListItem, Store } from '@/lib/types';

// "Onde comprar" de verdade, com as buscas trocadas por respostas prontas: o que se confere aqui é o que a tela
// faz com os preços de outras casas (onde a casa não tem preço num mercado dela, e os mercados de fora à parte), e
// que nada muda quando o banco ainda não tem a função ou a busca falha.

interface Query {
  data: unknown;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  fetchStatus: 'idle' | 'fetching' | 'paused';
  refetch: jest.Mock;
}

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockQueries: Record<string, Query> = {};

jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: 'l1' }) }));
jest.mock('@/data/market', () => ({
  useLatestPrices: () => mockQueries.prices,
  useListItems: () => mockQueries.items,
  useListLinks: () => mockQueries.links,
  useProducts: () => mockQueries.products,
  useStores: () => mockQueries.stores,
}));
jest.mock('@/data/sharedPrices', () => ({ useSharedPrices: () => mockQueries.shared }));
// Os desenhos animados (reanimated) e o fundo não entram no que se confere aqui.
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

const loaded = (data: unknown): Query => ({ data, isPending: false, isError: false, error: null, fetchStatus: 'idle', refetch: jest.fn() });
const failed = (): Query => ({ ...loaded(undefined), isError: true, error: new Error('sem rede') });
const onTheWay = (): Query => ({ ...loaded(undefined), isPending: true, fetchStatus: 'fetching' });

/** O dia de `ago` dias atrás: a tela diz "visto em" com a data de hoje como referência do ano. */
const day = (ago: number) => {
  const date = new Date();
  date.setDate(date.getDate() - ago);
  return toISODate(date);
};

const ASSAI = '11222333000181';
const DIA = '22333444000172';
const FORA = '99888777000166';

const STORES: Store[] = [
  { id: 'assai', name: 'Assaí', cnpj: ASSAI, address: null },
  { id: 'dia', name: 'Dia', cnpj: DIA, address: null },
];
const PRODUCTS = [
  { id: 'arroz', name: 'Arroz', category: 'graos', shelf_life_days: null },
  { id: 'feijao', name: 'Feijão', category: 'graos', shelf_life_days: null },
] as Product[];

const listItem = (id: string, name: string, product_id: string): ShoppingListItem => ({
  id,
  list_id: 'l1',
  product_id,
  name,
  category: 'graos',
  quantity: 1,
  unit: 'un',
  notes: null,
  priority: 'normal',
  photo_path: null,
  checked_at: null,
  checked_by: null,
  toggle_token: 'selo',
  created_at: '2026-10-01T12:00:00Z',
});
const own = (product_id: string, store_id: string, unit_price: number): LatestPrice => ({
  product_id,
  store_id,
  unit: 'un',
  unit_price,
  purchased_at: `${day(10)}T12:00:00-03:00`,
});
const seen = (product_id: string, store_cnpj: string, unit_price: number, ago: number, partial: Partial<SharedPrice> = {}): SharedPrice => ({
  product_id,
  store_cnpj,
  store_name: 'ATACADAO S.A.',
  store_uf: '35',
  unit: 'un',
  unit_price,
  seen_on: day(ago),
  mine: false,
  ...partial,
});

let renderer: ReactTestRenderer | undefined;
type Rendered = ReturnType<ReactTestRenderer['toJSON']> | string;
const texts = (node: Rendered): string[] =>
  node == null ? [] : typeof node === 'string' ? [node] : Array.isArray(node) ? node.flatMap(texts) : (node.children ?? []).flatMap(texts);

async function mount() {
  await act(async () => {
    renderer = create(<WhereToBuyScreen />);
  });
  return texts(renderer!.toJSON()).join('\n');
}

beforeEach(() => {
  Object.assign(mockQueries, {
    items: loaded([listItem('a', 'Arroz', 'arroz'), listItem('f', 'Feijão', 'feijao')]),
    // O Dia não tem o feijão nas notas da casa.
    prices: loaded([own('arroz', 'assai', 25), own('arroz', 'dia', 24), own('feijao', 'assai', 8)]),
    stores: loaded(STORES),
    links: loaded(new LinkIndex([])),
    products: loaded(PRODUCTS),
    shared: loaded(null),
  });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('"Onde comprar" com os preços de outras casas', () => {
  it('sem a função no banco: a conta de sempre, estimada onde a casa não tem preço, sem aviso', async () => {
    const page = await mount();
    expect(page).toContain('Estimado pelo nível de preço do mercado');
    expect(page).not.toContain('outras casas');
    expect(page).not.toContain(SHARED_PRICES_NOTICE);
  });

  it('num mercado da casa, o preço visto em outra casa cobre o que ela não tem lá, marcado e com o dia', async () => {
    mockQueries.shared = loaded([seen('feijao', DIA, 7.5, 3, { mine: true, store_name: 'DIA BRASIL' })]);
    const page = await mount();
    // Dia: arroz 24 (da casa) + feijão 7,50 (de outras casas) = 31,50, contra 33,00 no Assaí.
    expect(page).toContain('R$ 31,50');
    expect(page).toContain('1 preços reais');
    expect(page).toContain('1 de outras casas');
    expect(page).toContain(`Preço de outras casas, visto em ${formatShortDate(day(3))}`);
    expect(page).toContain('~R$ 7,50');
    expect(page).toContain('1% abaixo da média · 1 com preço real · 1 de outras casas');
    expect(page).toContain(SHARED_PRICES_NOTICE);
    // O nome é o que a casa conhece, e nunca quem viu nem quantas casas.
    expect(page).not.toContain('DIA BRASIL');
    expect(page).not.toMatch(/\d+ casas/);
  });

  it('o preço da casa sempre vence: o de outra casa, mesmo mais barato e mais novo, não entra', async () => {
    mockQueries.shared = loaded([seen('arroz', ASSAI, 10, 1, { mine: true })]);
    const page = await mount();
    expect(page).not.toContain('Preço de outras casas');
    // O arroz no Assaí: 25 da casa (o total de lá, 33, é com ele), não os 10 vistos em outra casa.
    expect(page).toContain('1% acima da média · 2 com preço real\nR$ 33,00');
  });

  it('os mercados de fora ficam à parte, com o estado, o que cada item custa lá e a comparação com o plano', async () => {
    mockQueries.shared = loaded([seen('arroz', FORA, 21, 2), seen('feijao', FORA, 7, 4)]);
    const page = await mount();
    expect(page).toContain('Em outros mercados');
    expect(page).toContain('ATACADAO S.A. (SP)');
    expect(page).toContain('2 itens da lista por ~R$ 28,00; no plano acima, R$ 31,95');
    expect(page).toContain(`Preço de outras casas, visto em ${formatShortDate(day(4))}`);
    expect(page).toContain(SHARED_PRICES_NOTICE);
    // O plano continua só com os mercados da casa.
    expect(page).toContain('Melhor opção\nDia');
    expect(page).not.toMatch(/\d+ casas/);
  });

  it('o item que a casa nunca comprou, só com preço de outras casas: à parte, com o preço da lista, e não "sem preço"', async () => {
    mockQueries.items = loaded([listItem('a', 'Arroz', 'arroz'), listItem('f', 'Feijão', 'feijao'), listItem('l', 'Leite', 'leite')]);
    mockQueries.shared = loaded([seen('leite', DIA, 4.9, 2, { mine: true })]);
    const page = await mount();
    expect(page).toContain('Só com preço de outras casas');
    expect(page).toContain(`Leite\nSó há preço de outras casas: Dia, visto em ${formatShortDate(day(2))}\n~R$ 4,90`);
    expect(page).not.toContain('Sem preço registrado');
    expect(page).not.toContain('Ainda não aparece em nenhuma nota');
    // Os planos seguem só com os itens que a casa tem preço: nada de "sem preço" no resumo.
    expect(page).not.toMatch(/\d+ sem preço/);
    expect(page).toContain(SHARED_PRICES_NOTICE);
  });

  it.each([
    ['a busca falhou', failed],
    ['a busca não saiu (sem internet)', () => ({ ...onTheWay(), fetchStatus: 'paused' as const })],
  ])('%s: a tela segue só com os preços da casa, sem erro', async (_why, state) => {
    mockQueries.shared = state();
    const page = await mount();
    expect(page).toContain('Melhor opção');
    expect(page).not.toContain(SHARED_PRICES_NOTICE);
  });

  it('a primeira busca ainda anda: espera, para o total não mudar logo depois', async () => {
    mockQueries.shared = onTheWay();
    expect(await mount()).toContain('Comparando preços…');
  });
});
