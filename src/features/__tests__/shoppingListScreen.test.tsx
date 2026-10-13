import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import ShoppingListScreen from '@/app/lista/[id]/index';
import { toISODate } from '@/domain/dates';
import { LinkIndex } from '@/domain/listLinks';
import type { PurchaseRecord } from '@/domain/recentPurchases';
import type { ItemHint } from '@/features/ShoppingGrid';
import type { LatestPrice, PantryItem, Product, ShoppingListItem } from '@/lib/types';
import { Screen } from '@/ui/primitives';

// A tela da lista de verdade, com as buscas trocadas por respostas prontas: o que se confere aqui é o que ela
// faz com o que cada busca devolve (carregada, a caminho, falhou), que as regras de domain/ não enxergam.

interface Query {
  data: unknown;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  fetchStatus: 'idle' | 'fetching' | 'paused';
  isRefetching: boolean;
  refetch: jest.Mock;
}

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockQueries: Record<string, Query> = {};
/** O que a tela entregou à grade do que falta comprar e à faixa "Acho que acabou". */
const mockSeen: { hints?: ReadonlyMap<string, ItemHint>; restock?: { name: string }[] } = {};

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'l1' }),
}));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));
jest.mock('@/data/home', () => ({ usePantry: () => mockQueries.pantry }));
jest.mock('@/data/listPhotos', () => ({
  dropPendingPhotos: jest.fn(),
  emptyPhotoTrash: jest.fn(),
  keepPendingPhoto: jest.fn(),
  useListPhotoUrls: () => undefined,
  usePendingListPhotos: () => new Map(),
  usePendingPhotoUri: () => null,
  useSetListItemPhoto: () => ({ mutate: jest.fn() }),
}));
jest.mock('@/data/market', () => {
  const mutation = () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false });
  return {
    listQueueBusy: () => false,
    loadListLinks: jest.fn(),
    newToggleToken: () => 'selo',
    useAddListItem: mutation,
    useArchiveList: mutation,
    useClearCheckedItems: mutation,
    useDeleteListItem: mutation,
    useEditListItem: mutation,
    useRemovePendingListItem: mutation,
    useToggleListItem: mutation,
    useListQueueBusy: () => false,
    useListItems: () => mockQueries.items,
    useListLinks: () => mockQueries.links,
    useLatestPrices: () => mockQueries.prices,
    useProducts: () => mockQueries.products,
    usePurchaseRecords: () => mockQueries.purchases,
    useShoppingList: () => mockQueries.list,
    useStores: () => mockQueries.stores,
  };
});
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } } }), useHouseholdId: () => 'h1' }));
jest.mock('@/lib/supabase', () => ({ errorMessage: (error: unknown) => String(error) }));
jest.mock('@/ui/dialogs', () => ({ askYesNo: jest.fn(), confirmAction: jest.fn(), notify: jest.fn() }));
// Os desenhos animados (reanimated) e o fundo não entram no que se confere aqui.
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/ui/PickerModal', () => ({ PickerModal: () => null }));
jest.mock('@/features/CartPantryModal', () => ({ CartPantryModal: () => null }));
jest.mock('@/features/CommonItemsPicker', () => ({ CommonItemsPicker: () => null }));
jest.mock('@/features/ListItemEditor', () => ({ ListItemEditor: () => null }));
jest.mock('@/features/OfflineNotice', () => ({ OfflineNotice: () => null }));
// "Estou indo ao mercado" tem os testes dele (MarketTrip.test.tsx): aqui, só que a lista o atualiza junto.
const mockRefreshTrips = jest.fn();
jest.mock('@/data/marketTrips', () => ({ useRefreshMarketTrips: () => mockRefreshTrips }));
jest.mock('@/features/MarketTrip', () => ({ MarketTripAction: () => null, MarketTripBanner: () => null }));
jest.mock('@/features/RecentPurchases', () => ({
  ...jest.requireActual<typeof import('@/features/RecentPurchases')>('@/features/RecentPurchases'),
  RecentPurchases: () => null,
  RestockStrip: ({ items }: { items: { name: string }[] }) => {
    mockSeen.restock = items;
    return null;
  },
}));
jest.mock('@/features/ShoppingGrid', () => ({
  ShoppingGrid: ({ hints, inCart }: { hints?: ReadonlyMap<string, ItemHint>; inCart?: boolean }) => {
    if (!inCart) mockSeen.hints = hints;
    return null;
  },
}));

const loaded = (data: unknown): Query => ({ data, isPending: false, isError: false, error: null, fetchStatus: 'idle', isRefetching: false, refetch: jest.fn() });
/** Nunca carregou neste aparelho e a busca falhou. */
const failed = (): Query => ({ ...loaded(undefined), isError: true, error: new Error('sem rede') });
/** A primeira busca ainda anda. */
const onTheWay = (): Query => ({ ...loaded(undefined), isPending: true, fetchStatus: 'fetching' });
/** Sem internet e nunca visto neste aparelho: a busca nem saiu. */
const paused = (): Query => ({ ...loaded(undefined), isPending: true, fetchStatus: 'paused' });

/** O dia de `ago` dias atrás: a tela usa a data de hoje. */
const day = (ago: number) => {
  const date = new Date();
  date.setDate(date.getDate() - ago);
  return toISODate(date);
};

const listItem = (id: string, name: string, product_id: string | null, category = 'mercearia'): ShoppingListItem => ({
  id,
  list_id: 'l1',
  product_id,
  name,
  category,
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
const pantryRow = (name: string, product_id: string | null, ago: number, category = 'mercearia'): PantryItem => ({
  id: `d-${name}`,
  product_id,
  name,
  category,
  quantity: 1,
  unit: 'un',
  purchased_on: day(ago),
  expires_on: null,
  expiry_source: null,
  consumed_at: null,
});
const latest = (product_id: string, unit_price: number): LatestPrice => ({ product_id, store_id: 's1', unit: 'un', unit_price, purchased_at: `${day(5)}T12:00:00` });
const product = (id: string, name: string): Product => ({ id, name, category: 'mercearia', shelf_life_days: null }) as Product;
/** Comprado de 10 em 10 dias, a última vez há 14: pelo costume, acabou. */
const ranOutHistory = (name: string, productId: string | null, category = 'mercearia'): PurchaseRecord[] =>
  [34, 24, 14].map((ago) => ({ name, category, productId, quantity: 1, unit: 'un', at: `${day(ago)}T12:00:00`, source: 'receipt' }));

let renderer: ReactTestRenderer | undefined;

type Rendered = ReturnType<ReactTestRenderer['toJSON']> | string;
const texts = (node: Rendered): string[] =>
  node == null ? [] : typeof node === 'string' ? [node] : Array.isArray(node) ? node.flatMap(texts) : (node.children ?? []).flatMap(texts);

/** Abre a tela e devolve tudo o que ela escreve, uma frase por linha. */
async function mount() {
  await act(async () => {
    renderer = create(<ShoppingListScreen />);
  });
  return texts(renderer!.toJSON()).join('\n');
}

beforeEach(() => {
  mockSeen.hints = undefined;
  mockSeen.restock = undefined;
  Object.assign(mockQueries, {
    list: loaded({ id: 'l1', name: 'Mercado', kind: 'mercado', archived_at: null, created_at: '2026-10-01T12:00:00Z' }),
    items: loaded([]),
    products: loaded([]),
    purchases: loaded([]),
    pantry: loaded([]),
    links: loaded(new LinkIndex([])),
    prices: loaded([]),
    stores: loaded([{ id: 's1', name: 'Assaí', cnpj: null, address: null }]),
  });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('"Na despensa" espera o histórico de compras', () => {
  beforeEach(() => {
    mockQueries.items = loaded([listItem('c', 'Café Pilão 500g', 'pilao'), listItem('a', 'Arroz', 'arroz')]);
    mockQueries.products = loaded([product('pilao', 'Café Pilão 500g'), product('arroz', 'Arroz')]);
    mockQueries.prices = loaded([latest('pilao', 18.9), latest('arroz', 25)]);
    mockQueries.pantry = loaded([pantryRow('Café Pilão 500g', 'pilao', 14)]);
  });

  it('com o histórico carregado, o que passou do costume não leva o selo', async () => {
    mockQueries.purchases = loaded(ranOutHistory('Café Pilão 500g', 'pilao'));
    expect(await mount()).not.toContain('Na despensa');
    expect(mockSeen.hints?.get('c')).toEqual({ cost: 'R$ 18,90', inPantry: false });
  });

  it('histórico carregado e sem nada que tenha acabado: o selo aparece', async () => {
    expect(await mount()).toContain('Na despensa: Café Pilão 500g. Se já acabou, dê baixa lá.');
    expect(mockSeen.hints?.get('c')).toEqual({ cost: 'R$ 18,90', inPantry: true });
  });

  it.each([
    ['a busca falhou', failed],
    ['a primeira busca ainda anda', onTheWay],
    ['sem internet e nunca visto', paused],
  ])('sem o histórico (%s), nenhum selo: não dá para saber o que acabou', async (_why, state) => {
    mockQueries.purchases = state();
    const page = await mount();
    expect(page).not.toContain('Na despensa');
    expect(mockSeen.hints?.get('c')).toEqual({ cost: 'R$ 18,90', inPantry: false });
    // A lista e a conta não esperam por ele.
    expect(page).toContain('A lista deve dar');
  });
});

describe('o palpite de que acabou não depende do tipo da lista', () => {
  it('vitamina na lista do mercado: passou do costume, não leva o selo; a faixa continua só com o que cabe na lista', async () => {
    mockQueries.items = loaded([listItem('v', 'Vitamina C', null, 'suplementos')]);
    mockQueries.pantry = loaded([pantryRow('Vitamina C', null, 14, 'suplementos')]);
    mockQueries.purchases = loaded([
      ...ranOutHistory('Vitamina C', null, 'suplementos'),
      ...ranOutHistory('Dipirona', null, 'medicamentos'),
      ...ranOutHistory('Café', null),
    ]);
    expect(await mount()).not.toContain('Na despensa');
    expect(mockSeen.hints?.get('v')?.inPantry ?? false).toBe(false);
    // Remédio não é sugerido na lista do mercado, e a vitamina já está nela.
    expect(mockSeen.restock?.map((i) => i.name)).toEqual(['Café']);
  });

  it('na lista da farmácia, a faixa sugere o remédio e não o café', async () => {
    mockQueries.list = loaded({ id: 'l1', name: 'Farmácia', kind: 'farmacia', archived_at: null, created_at: '2026-10-01T12:00:00Z' });
    mockQueries.items = loaded([listItem('a', 'Água mineral', null, 'bebidas')]);
    mockQueries.pantry = loaded([pantryRow('Água mineral', null, 14, 'bebidas')]);
    mockQueries.purchases = loaded([
      ...ranOutHistory('Água mineral', null, 'bebidas'),
      ...ranOutHistory('Dipirona', null, 'medicamentos'),
      ...ranOutHistory('Café', null),
    ]);
    expect(await mount()).not.toContain('Na despensa');
    expect(mockSeen.restock?.map((i) => i.name)).toEqual(['Dipirona']);
  });
});

describe('ligações ou produtos que não chegaram', () => {
  const unchecked = 'Não deu para conferir se o outro item já tem preço. Puxe a lista para baixo para tentar de novo.';

  beforeEach(() => {
    // "Café" digitado solto tem preço pela ligação com o Pilão; o arroz tem produto.
    mockQueries.items = loaded([listItem('c', 'Café', null), listItem('a', 'Arroz', 'arroz')]);
    mockQueries.products = loaded([product('pilao', 'Café Pilão 500g'), product('arroz', 'Arroz')]);
    mockQueries.prices = loaded([latest('pilao', 18.9), latest('arroz', 25)]);
    mockQueries.links = loaded(new LinkIndex([{ name_key: 'cafe', product_id: 'pilao' }]));
  });

  it('carregados: a conta é da lista toda, sem aviso', async () => {
    const page = await mount();
    expect(page).toContain('todos os itens têm preço');
    expect(page).not.toContain('Não deu para conferir');
  });

  it.each([
    ['a busca das ligações falhou', 'links', failed],
    ['sem internet e as ligações nunca vistas', 'links', paused],
  ])('%s: o cartão diz que não deu para conferir o item sem preço', async (_why, key, state) => {
    mockQueries[key] = state();
    const page = await mount();
    expect(page).toContain('1 de 2 itens tem preço. O outro fica fora da conta.');
    expect(page).toContain(unchecked);
  });

  it('a busca dos produtos falhou: o item digitado com o nome do produto fica sem preço, e o cartão avisa', async () => {
    mockQueries.items = loaded([listItem('c', 'café pilão 500g', null), listItem('a', 'Arroz', 'arroz')]);
    mockQueries.links = loaded(new LinkIndex([]));
    expect(await mount()).toContain('todos os itens têm preço');
    await act(async () => renderer?.unmount());
    mockQueries.products = failed();
    expect(await mount()).toContain(unchecked);
  });

  it('nenhum item com preço e as ligações não chegaram: o cartão aparece só para dizer isso', async () => {
    mockQueries.items = loaded([listItem('c', 'Café', null), listItem('l', 'Leite', null)]);
    mockQueries.links = failed();
    expect(await mount()).toContain('Não deu para conferir se os itens da lista já têm preço. Puxe a lista para baixo para tentar de novo.');
    await act(async () => renderer?.unmount());
    // Carregadas e sem ligação nenhuma: são só itens sem preço, e não há o que avisar.
    mockQueries.links = loaded(new LinkIndex([]));
    expect(await mount()).not.toContain('Não deu para conferir');
  });

  it('a primeira busca ainda anda: nada a avisar', async () => {
    mockQueries.links = onTheWay();
    const page = await mount();
    expect(page).toContain('1 de 2 itens tem preço');
    expect(page).not.toContain('Não deu para conferir');
  });

  it('não chegaram, mas todo item tem preço: nada a conferir', async () => {
    mockQueries.items = loaded([listItem('a', 'Arroz', 'arroz')]);
    mockQueries.links = failed();
    expect(await mount()).not.toContain('Não deu para conferir');
  });

  it('puxar para atualizar busca de novo as ligações e os produtos', async () => {
    await mount();
    mockRefreshTrips.mockClear();
    act(() => renderer!.root.findByType(Screen).props.onRefresh());
    expect(mockRefreshTrips).toHaveBeenCalledTimes(1);
    for (const key of ['items', 'prices', 'pantry', 'links', 'products', 'stores', 'purchases']) {
      expect(mockQueries[key].refetch).toHaveBeenCalledTimes(1);
    }
  });
});
