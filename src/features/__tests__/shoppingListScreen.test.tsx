import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ScrollView } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import ShoppingListScreen from '@/app/lista/[id]/index';
import { toISODate } from '@/domain/dates';
import { LinkIndex } from '@/domain/listLinks';
import type { PurchaseRecord } from '@/domain/recentPurchases';
import { SHARED_PRICES_NOTICE, type SharedPrice } from '@/domain/sharedPrices';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { CHOSEN_STORE_MS } from '@/domain/listEstimate';
import type { MarketTrip } from '@/domain/marketTrips';
import { CartPantryModal } from '@/features/CartPantryModal';
import { ListEstimateCard } from '@/features/ListEstimateCard';
import { forgetAddedItems, rememberAdded } from '@/lib/addedItems';
import { PasteListModal } from '@/features/PasteListModal';
import { ShoppingGrid, type ItemHint } from '@/features/ShoppingGrid';
import type { LatestPrice, PantryItem, Product, ShoppingListItem } from '@/lib/types';
import { StaleNotice } from '@/features/health/StaleNotice';
import { ActionSheet, type SheetAction } from '@/ui/ActionSheet';
import { askYesNo, notify } from '@/ui/dialogs';
import { Button, ErrorNotice, ListRow, Loading, Screen, TextField } from '@/ui/primitives';

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
const mockSeen: {
  hints?: ReadonlyMap<string, ItemHint>;
  restock?: { name: string }[];
  recent?: { name: string }[];
  addRecent?: (item: unknown) => void;
  open?: (item: ShoppingListItem) => void;
  editor?: Record<string, unknown>;
  picker?: Record<string, unknown>;
  cartPantry?: Record<string, unknown>;
} = {};

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'l1' }),
}));
// O que está guardado da lista é o que a tela recebeu por último.
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ getQueryData: (key: unknown[]) => (key[0] === 'listItems' ? mockQueries.items?.data : undefined) }),
}));
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
/** O que a tela pediu à fila da lista: itens postos e o limpar. */
const mockQueue = {
  add: jest.fn(),
  clear: jest.fn(),
  edit: jest.fn(),
  removePending: jest.fn<(input: unknown) => Promise<string>>(),
  reopen: jest.fn(),
  rename: jest.fn(),
};
/**
 * A fila do limpar: guarda as respostas até "a conexão voltar" (deliverClears), como a fila de verdade faz com o
 * limpar feito sem internet.
 */
const mockClearQueue: { onSuccess?: () => void; onError?: (error: Error) => void }[] = [];
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/data/market', () => {
  const mutation = () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false });
  return {
    loadListLinks: jest.fn(),
    newToggleToken: () => 'selo',
    removalWaitsForQueue: () => false,
    useAddListItem: () => ({ add: mockQueue.add }),
    useArchiveList: mutation,
    useReopenList: () => ({ mutate: mockQueue.reopen, isPending: false }),
    useRenameList: () => ({ mutate: mockQueue.rename, isPending: false }),
    useClearCheckedItems: () => ({
      mutate: (input: unknown, options: { onSuccess?: () => void; onError?: (error: Error) => void }) => {
        mockQueue.clear(input, options);
        mockClearQueue.push(options);
      },
    }),
    useEditListItem: () => ({ mutate: mockQueue.edit, mutateAsync: jest.fn(), isPending: false }),
    useRemoveListItem: () => ({ remove: jest.fn() }),
    useRemovePendingListItem: () => ({ mutate: jest.fn(), mutateAsync: mockQueue.removePending, isPending: false }),
    useToggleListItem: mutation,
    useListItems: () => mockQueries.items,
    useListLinks: () => mockQueries.links,
    useLatestPrices: () => mockQueries.prices,
    useProducts: () => mockQueries.products,
    usePurchaseRecords: () => mockQueries.purchases,
    useShoppingList: () => mockQueries.list,
    useStores: () => mockQueries.stores,
  };
});
// Colar o que foi copiado: a área de transferência de mentira.
const mockClipboard = { text: '' };
jest.mock('expo-clipboard', () => ({ getStringAsync: async () => mockClipboard.text, setStringAsync: async () => true }));
jest.mock('@/data/sharedPrices', () => ({ useSharedPrices: () => mockQueries.shared }));
// As abreviações aprendidas têm os testes delas (learnedAbbreviations.test): aqui, nenhuma.
jest.mock('@/data/learnedAbbreviations', () => ({
  useLearnedAbbreviations: () => jest.requireActual<typeof import('@/domain/learnedAbbreviations')>('@/domain/learnedAbbreviations').NO_LEARNED,
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } } }), useHouseholdId: () => 'h1' }));
jest.mock('@/lib/supabase', () => ({ errorMessage: (error: unknown) => String(error) }));
jest.mock('@/ui/dialogs', () => ({ askYesNo: jest.fn(), confirmAction: jest.fn(), notify: jest.fn() }));
// Os desenhos animados (reanimated) e o fundo não entram no que se confere aqui.
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
// O caminho depois de ler o código de barras tem os testes dele (productBarcodeFlow.test.tsx): aqui, só o botão e o
// que a lista faz com o produto lido. Sem dizer nada, como num banco ainda sem a tabela: sem o botão.
const mockBarcode: { available: boolean; busy: boolean; start: jest.Mock; onProduct: ((product: Product) => void) | null } = {
  available: false,
  busy: false,
  start: jest.fn(),
  onProduct: null,
};
jest.mock('@/features/ProductBarcode', () => ({
  useProductBarcode: ({ onProduct }: { onProduct: (product: Product) => void }) => {
    mockBarcode.onProduct = onProduct;
    return { available: mockBarcode.available, busy: mockBarcode.busy, start: mockBarcode.start, element: null };
  },
}));
jest.mock('@/ui/PickerModal', () => ({ PickerModal: () => null }));
jest.mock('@/features/CartPantryModal', () => ({
  CartPantryModal: (props: Record<string, unknown>) => {
    mockSeen.cartPantry = props;
    return null;
  },
}));
jest.mock('@/features/CommonItemsPicker', () => ({
  CommonItemsPicker: (props: Record<string, unknown>) => {
    mockSeen.picker = props;
    return null;
  },
}));
jest.mock('@/features/ListItemEditor', () => ({
  ListItemEditor: (props: Record<string, unknown>) => {
    mockSeen.editor = props;
    return null;
  },
}));
jest.mock('@/features/OfflineNotice', () => ({ OfflineNotice: () => null }));
// "Estou indo ao mercado" tem os testes dele (MarketTrip.test.tsx): aqui, que a lista o atualiza junto, o selo
// "Novo" e a pergunta depois de "Limpar".
const mockRefreshTrips = jest.fn();
const mockTrips: { list: MarketTrip[]; online: boolean; end: jest.Mock<(id: string) => Promise<boolean>> } = {
  list: [],
  online: true,
  end: jest.fn<(id: string) => Promise<boolean>>(),
};
jest.mock('@/data/marketTrips', () => ({
  marketTripErrorMessage: () => 'Sem internet agora. Encerre quando a conexão voltar.',
  tripsOnline: () => mockTrips.online,
  useEndMarketTrip: () => ({ mutateAsync: mockTrips.end }),
  useMarketTrips: () => ({ data: mockTrips.list }),
  useRefreshMarketTrips: () => mockRefreshTrips,
}));
jest.mock('@/features/MarketTrip', () => ({ MarketTripAction: () => null, MarketTripBanner: () => null }));
jest.mock('@/features/RecentPurchases', () => ({
  ...jest.requireActual<typeof import('@/features/RecentPurchases')>('@/features/RecentPurchases'),
  RecentPurchases: ({ items, onAdd }: { items: { name: string }[]; onAdd: (item: unknown) => void }) => {
    mockSeen.recent = items;
    mockSeen.addRecent = onAdd;
    return null;
  },
  RestockStrip: ({ items }: { items: { name: string }[] }) => {
    mockSeen.restock = items;
    return null;
  },
}));
jest.mock('@/features/ShoppingGrid', () => ({
  ShoppingGrid: ({ hints, inCart, onOpen }: { hints?: ReadonlyMap<string, ItemHint>; inCart?: boolean; onOpen: (item: ShoppingListItem) => void }) => {
    if (!inCart) {
      mockSeen.hints = hints;
      mockSeen.open = onOpen;
    }
    return null;
  },
}));

const loaded = (data: unknown): Query => ({ data, isPending: false, isError: false, error: null, fetchStatus: 'idle', isRefetching: false, refetch: jest.fn() });
/** Nunca carregou neste aparelho e a busca falhou. */
const failed = (): Query => ({ ...loaded(undefined), isError: true, error: new Error('sem rede') });
/** A busca nova falhou e ficou o que já estava carregado (ou guardado no aparelho). */
const failedKeeping = (data: unknown, error: unknown = new Error('sem rede')): Query => ({ ...loaded(data), isError: true, error });
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

/** Digita a quantidade no cartão de pôr item. */
const typeQuantity = (text: string) => act(() => renderer!.root.findAllByType(TextField)[1].props.onChangeText(text));
/** A pergunta do item repetido ("Já está na lista"). */
const repeatSheet = () => renderer!.root.findAllByType(ActionSheet).find((sheet) => sheet.props.title === 'Já está na lista')!;
const repeatChoices = () => (repeatSheet().props.actions as SheetAction[]).map((action) => action.label);
/** Toca numa escolha do menu como ele faz: fecha e depois roda a ação. */
function choose(label: string) {
  const sheet = repeatSheet();
  const action = (sheet.props.actions as SheetAction[]).find((a) => a.label === label)!;
  act(() => {
    sheet.props.onClose();
    action.onPress();
  });
}

beforeEach(() => {
  mockTrips.list = [];
  mockTrips.online = true;
  mockTrips.end.mockReset();
  forgetAddedItems();
  mockClearQueue.length = 0;
  mockSeen.cartPantry = undefined;
  mockBarcode.available = false;
  mockBarcode.busy = false;
  mockBarcode.onProduct = null;
  mockSeen.hints = undefined;
  mockSeen.restock = undefined;
  mockSeen.recent = undefined;
  mockSeen.editor = undefined;
  Object.assign(mockQueries, {
    list: loaded({ id: 'l1', name: 'Mercado', kind: 'mercado', archived_at: null, created_at: '2026-10-01T12:00:00Z' }),
    items: loaded([]),
    products: loaded([]),
    purchases: loaded([]),
    pantry: loaded([]),
    links: loaded(new LinkIndex([])),
    prices: loaded([]),
    stores: loaded([{ id: 's1', name: 'Assaí', cnpj: null, address: null }]),
    // Banco sem a função dos preços de outras casas: a lista é a de sempre.
    shared: loaded(null),
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

describe('o queijo em "un" com preço por kg, sem o histórico de compras', () => {
  /** Os detalhes do primeiro item da lista, como a tela os monta (a prioridade normal). */
  const detailFacts = async (): Promise<string[]> => {
    await act(async () => mockSeen.open!((mockQueries.items.data as ShoppingListItem[])[0]));
    return (mockSeen.editor!.facts as (priority: string) => string[])('normal');
  };

  beforeEach(() => {
    mockQueries.items = loaded([listItem('q', 'Queijo', 'queijo', 'laticinios')]);
    mockQueries.products = loaded([product('queijo', 'Queijo')]);
    mockQueries.prices = loaded([{ ...latest('queijo', 72.9), unit: 'kg' }]);
  });

  it.each([
    ['a busca do histórico falhou', failed],
    ['sem internet e nunca visto', paused],
  ])('%s: a conta é de 1 kg e o detalhe diz que o histórico não carregou', async (_why, state) => {
    mockQueries.purchases = state();
    await mount();
    expect(mockSeen.hints?.get('q')).toEqual({ cost: '~R$ 72,90', inPantry: false });
    expect(await detailFacts()).toContain('O preço é por kg: a conta da lista usa 1 kg (o histórico de compras não carregou).');
  });

  it('a primeira busca do histórico ainda anda: a lista não espera, e ainda não diz nada disso', async () => {
    mockQueries.purchases = onTheWay();
    expect(await mount()).not.toContain('histórico de compras não carregou');
    expect(mockSeen.hints?.get('q')).toEqual({ cost: '~R$ 72,90', inPantry: false });
    expect((await detailFacts()).join('\n')).not.toContain('histórico de compras não carregou');
  });

  it('histórico carregado sem nenhuma compra do queijo a peso: o 1 kg de sempre, sem o aviso', async () => {
    mockQueries.purchases = loaded([]);
    await mount();
    expect(mockSeen.hints?.get('q')).toEqual({ cost: '~R$ 72,90', inPantry: false });
    expect(await detailFacts()).toContain('O preço é por kg: a conta da lista usa 1 kg.');
  });
});

describe('o queijo em "un" com preço por kg, com o histórico de compras', () => {
  beforeEach(() => {
    mockQueries.items = loaded([listItem('q', 'Queijo', 'queijo', 'laticinios')]);
    mockQueries.products = loaded([product('queijo', 'Queijo')]);
    mockQueries.prices = loaded([{ ...latest('queijo', 72.9), unit: 'kg' }]);
    // Uma nota de 0,2 kg: a casa leva uns 200 g do queijo por vez.
    mockQueries.purchases = loaded([
      { name: 'Queijo', category: 'laticinios', productId: 'queijo', quantity: 0.2, unit: 'kg', at: `${day(10)}T12:00:00Z`, source: 'receipt' },
    ]);
  });

  it('a conta é o que a casa costuma levar (200 g), na lista e nos detalhes do item, e não 1 kg', async () => {
    const page = await mount();
    expect(page).toContain('~R$ 14,58');
    expect(mockSeen.hints?.get('q')).toEqual({ cost: '~R$ 14,58', inPantry: false });
    await act(async () => mockSeen.open!((mockQueries.items.data as ShoppingListItem[])[0]));
    expect((mockSeen.editor!.facts as (priority: string) => string[])('normal')).toContain(
      'O preço é por kg: a conta da lista usa 200 g, o que a casa costuma levar de uma vez.',
    );
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
    for (const key of ['items', 'prices', 'pantry', 'links', 'products', 'stores', 'purchases', 'shared']) {
      expect(mockQueries[key].refetch).toHaveBeenCalledTimes(1);
    }
  });
});

describe('preços de outras casas na conta da lista', () => {
  const CNPJ = '11222333000181';
  const notice = SHARED_PRICES_NOTICE;
  /** Visto em outra casa, no Assaí da casa (pelo CNPJ) ou num mercado de fora. */
  const seen = (product_id: string, unit_price: number, ago: number, partial: Partial<SharedPrice> = {}): SharedPrice => ({
    product_id,
    store_cnpj: CNPJ,
    store_name: 'ASSAI ATACADISTA',
    store_uf: '35',
    unit: 'un',
    unit_price,
    seen_on: day(ago),
    mine: true,
    ...partial,
  });

  beforeEach(() => {
    mockQueries.stores = loaded([{ id: 's1', name: 'Assaí', cnpj: CNPJ, address: null }]);
    // O arroz tem preço da casa; o feijão não (a nota dele foi excluída), só o visto em outra casa.
    mockQueries.items = loaded([listItem('a', 'Arroz', 'arroz'), listItem('f', 'Feijão', 'feijao')]);
    mockQueries.products = loaded([product('arroz', 'Arroz'), product('feijao', 'Feijão')]);
    mockQueries.prices = loaded([latest('arroz', 25)]);
  });

  it('o item sem preço da casa usa o de outras casas, marcado, e o total diz quanto veio de lá', async () => {
    mockQueries.shared = loaded([seen('feijao', 8.5, 2), seen('arroz', 19.9, 1)]);
    const page = await mount();
    expect(page).toContain('~R$ 33,50');
    expect(page).toContain('todos os itens têm preço; R$ 8,50 do total é de 1 item com preço de outras casas');
    expect(page).toContain(notice);
    // O preço da casa vence o de outras casas, mesmo mais novo.
    expect(mockSeen.hints?.get('a')).toEqual({ cost: 'R$ 25,00', inPantry: false });
    expect(mockSeen.hints?.get('f')).toEqual({ cost: '~R$ 8,50', inPantry: false });
  });

  it.each([
    ['o banco ainda não tem a função', () => loaded(null)],
    ['a busca falhou', failed],
    ['a primeira busca ainda anda', onTheWay],
  ])('%s: a conta é só com os preços da casa, sem aviso', async (_why, state) => {
    mockQueries.shared = state();
    const page = await mount();
    expect(page).toContain('1 de 2 itens tem preço');
    expect(page).not.toContain(notice);
    expect(mockSeen.hints?.has('f')).toBe(false);
  });

  it('sem os preços da casa carregados, nada de outras casas: eles ocupariam o lugar dos dela', async () => {
    mockQueries.shared = loaded([seen('feijao', 8.5, 2), seen('arroz', 19.9, 1)]);
    mockQueries.prices = failed();
    expect(await mount()).not.toContain(notice);
    expect(mockSeen.hints?.has('a')).toBe(false);
    expect(mockSeen.hints?.has('f')).toBe(false);
  });

  it('sem os mercados da casa carregados, nada de outras casas: não dá para saber quais são dela', async () => {
    mockQueries.shared = loaded([seen('feijao', 8.5, 2)]);
    mockQueries.stores = failed();
    expect(await mount()).not.toContain(notice);
    expect(mockSeen.hints?.has('f')).toBe(false);
  });
});

describe('sem internet', () => {
  it('a lista que nunca foi aberta neste aparelho diz isso, em vez de girar sem fim', async () => {
    // A lista veio do resumo guardado; os itens nunca foram buscados aqui, e a busca está parada.
    mockQueries.items = paused();
    const page = await mount();
    expect(page).toContain('Sem internet');
    expect(page).toContain('Esta lista ainda não foi aberta neste aparelho. Ela aparece aqui quando a conexão voltar.');
    expect(renderer!.root.findAllByType(Loading)).toHaveLength(0);
  });

  it('nem a lista no resumo guardado: a mesma frase', async () => {
    mockQueries.list = paused();
    mockQueries.items = paused();
    expect(await mount()).toContain('Esta lista ainda não foi aberta neste aparelho.');
  });

  it('a primeira busca andando (com internet) continua com o carregando', async () => {
    mockQueries.items = onTheWay();
    const page = await mount();
    expect(page).not.toContain('Sem internet');
    expect(renderer!.root.findAllByType(Loading)).toHaveLength(1);
  });

  it('pôr item vai pela fila e o campo fica livre na hora, sem esperar o servidor', async () => {
    await mount();
    mockQueue.add.mockClear();
    const [field] = renderer!.root.findAllByType(TextField);
    act(() => field.props.onChangeText('Café'));
    const button = renderer!.root.findAll((node) => node.type === Button && node.props.title === 'Adicionar "Café"')[0];
    act(() => button.props.onPress());
    // Sem aviso próprio: se a fila desistir, o aviso sai dela (lib/queryClient), também com a tela fechada.
    expect(mockQueue.add).toHaveBeenCalledWith({ name: 'Café', category: expect.any(String), productId: null, quantity: 1, unit: 'un' }, 'u1');
    expect(renderer!.root.findAllByType(TextField)[0].props.value).toBe('');
  });

  it('"Limpar" vale com a fila andando e leva junto o que vai para o histórico', async () => {
    const leite = { ...listItem('l', 'Leite', null, 'laticinios'), checked_at: '2026-10-20T10:00:00Z', toggle_token: 'l1' };
    mockQueries.items = loaded([listItem('a', 'Arroz', null), leite]);
    await mount();
    mockQueue.clear.mockClear();
    const limpar = renderer!.root.findAll((node) => node.type === Button && node.props.title === 'Limpar')[0];
    expect(limpar.props.disabled).toBeFalsy();
    await act(async () => limpar.props.onPress());
    await act(async () => renderer!.root.findByType(CartPantryModal).props.onConfirm([]));
    expect(mockQueue.clear).toHaveBeenCalledWith(
      {
        listId: 'l1',
        userId: 'u1',
        items: [{ id: 'l', token: 'l1' }],
        pantry: [],
        bought: [{ name: 'Leite', category: 'laticinios', productId: null, quantity: 1, unit: 'un', at: '2026-10-20T10:00:00Z', source: 'list' }],
      },
      expect.anything(),
    );
  });
});

describe('a busca que falha com a lista já na tela (voltar ao app com sinal fraco)', () => {
  const arroz = listItem('a', 'Arroz', null);
  const offline = { code: '', message: 'TypeError: Network request failed', details: '', hint: '' };

  it('a lista continua na tela, com o aviso de que é a guardada, em vez da tela de erro', async () => {
    mockQueries.list = failedKeeping(mockQueries.list.data, offline);
    mockQueries.items = failedKeeping([arroz], offline);
    const page = await mount();
    expect(renderer!.root.findAllByType(ErrorNotice)).toHaveLength(0);
    expect(page).toContain('Para comprar (1)');
    expect(page).toContain('Sem internet agora. Mostrando a lista como estava da última vez.');
    // "Tentar de novo" busca a lista e os itens.
    act(() => renderer!.root.findByType(StaleNotice).props.onRetry());
    expect(mockQueries.list.refetch).toHaveBeenCalled();
    expect(mockQueries.items.refetch).toHaveBeenCalled();
  });

  it('outro erro, com os itens já carregados: o aviso de sempre, e a lista fica', async () => {
    mockQueries.items = failedKeeping([arroz]);
    const page = await mount();
    expect(renderer!.root.findAllByType(ErrorNotice)).toHaveLength(0);
    expect(page).toContain('Não foi possível atualizar. Mostrando o que já estava carregado.');
    expect(page).toContain('Para comprar (1)');
  });

  it('sem nada carregado, a tela de erro continua', async () => {
    mockQueries.items = failed();
    await mount();
    expect(renderer!.root.findAllByType(ErrorNotice)).toHaveLength(1);
    expect(renderer!.root.findAllByType(StaleNotice)).toHaveLength(0);
  });

  it('com a busca dando certo, nenhum aviso', async () => {
    mockQueries.items = loaded([arroz]);
    await mount();
    expect(renderer!.root.findAllByType(StaleNotice)).toHaveLength(0);
  });
});

describe('a lista sem marca', () => {
  const MILK = { ...product('il', 'Leite IL Desnatado'), category: 'laticinios' } as Product;
  const ITALAC = { ...product('italac', 'Leite Italac Desnatado 1L'), category: 'laticinios' } as Product;
  const bought = (name: string, productId: string, category: string, ago: number): PurchaseRecord => ({
    name,
    category,
    productId,
    quantity: 1,
    unit: 'un',
    at: `${day(ago)}T12:00:00`,
    source: 'receipt',
  });

  beforeEach(() => {
    mockQueue.add.mockClear();
    jest.mocked(notify).mockClear();
    jest.mocked(askYesNo).mockReset();
  });

  /** Digita no campo de pôr item. */
  const type = (text: string) => act(() => renderer!.root.findAllByType(TextField)[0].props.onChangeText(text));

  it('a busca mostra o produto sem a marca, uma vez por item, e põe o nome sem a marca com o produto como dica', async () => {
    mockQueries.products = loaded([MILK, ITALAC]);
    await mount();
    type('leite');
    const rows = renderer!.root.findAllByType(ListRow).filter((row) => row.props.subtitle === 'Produto com histórico de preço');
    expect(rows.map((row) => row.props.title)).toEqual(['Leite desnatado']);
    act(() => rows[0].props.onPress());
    expect(mockQueue.add).toHaveBeenCalledWith({ name: 'Leite desnatado', category: 'laticinios', productId: 'il', quantity: 1, unit: 'un' }, 'u1');
  });

  it('"Comprados recentemente" e "Acho que acabou" sugerem o item sem a marca', async () => {
    mockQueries.purchases = loaded([
      bought('Leite IL Desnatado', 'il', 'laticinios', 3),
      ...[34, 24, 14].map((ago) => bought('Ovo Doninho Caipira', 'ovo', 'ovos', ago)),
    ]);
    await mount();
    expect(mockSeen.restock?.map((i) => i.name)).toEqual(['Ovo caipira']);
    expect(mockSeen.recent?.map((i) => i.name)).toEqual(['Leite desnatado']);
    act(() => mockSeen.addRecent!(mockSeen.recent![0]));
    expect(mockQueue.add).toHaveBeenCalledWith(
      { name: 'Leite desnatado', category: 'laticinios', productId: 'il', quantity: 1, unit: 'un' },
      'u1',
      expect.anything(),
    );
  });

  it('com o item já na lista, com a marca ou sem ela, as faixas não o sugerem de novo', async () => {
    mockQueries.items = loaded([listItem('a', 'Leite desnatado', null, 'laticinios'), listItem('b', 'Ovo Doninho Caipira', null, 'ovos')]);
    mockQueries.purchases = loaded([
      bought('Leite IL Desnatado', 'il', 'laticinios', 3),
      ...[34, 24, 14].map((ago) => bought('Ovos Rancho Caipira', 'rancho', 'ovos', ago)),
    ]);
    await mount();
    expect(mockSeen.restock ?? []).toEqual([]);
    expect(mockSeen.recent ?? []).toEqual([]);
  });

  /** Toca em "Adicionar" com o texto digitado. */
  const addTyped = (text: string) =>
    act(async () => {
      await renderer!.root.findAll((node) => node.type === Button && node.props.title === `Adicionar "${text}"`)[0].props.onPress();
    });
  const fieldValue = () => renderer!.root.findAllByType(TextField)[0].props.value;

  it('o mesmo item já para comprar, pela busca ou com o mesmo nome: não põe de novo, pergunta e soma pela fila de edições', async () => {
    mockQueries.items = loaded([listItem('a', 'Leite IL Desnatado', 'il', 'laticinios'), listItem('b', 'Café', null, 'cafe_cha')]);
    mockQueries.products = loaded([MILK]);
    await mount();
    mockQueue.edit.mockClear();
    type('leite');
    const row = renderer!.root.findAllByType(ListRow).find((r) => r.props.subtitle === 'Produto com histórico de preço')!;
    act(() => row.props.onPress());
    expect(mockQueue.add).not.toHaveBeenCalled();
    expect(repeatSheet().props.visible).toBe(true);
    expect(repeatSheet().props.message).toBe('Leite IL Desnatado já está na lista (1 un). Somar mais 1 un?');
    expect(repeatChoices()).toEqual(['Somar: fica 2 un']);
    expect(repeatSheet().props.cancelLabel).toBe('Deixar como está');
    // Deixar como está: nada muda, e o campo fica livre, como antes.
    act(() => repeatSheet().props.onClose());
    expect(repeatSheet().props.visible).toBe(false);
    expect(mockQueue.edit).not.toHaveBeenCalled();
    expect(fieldValue()).toBe('');
    // Com a quantidade digitada, somar grava a soma pela fila (vale sem internet) e libera o campo.
    type('café');
    typeQuantity('3');
    await addTyped('café');
    expect(repeatSheet().props.message).toBe('Café já está na lista (1 un). Somar mais 3 un?');
    choose('Somar: fica 4 un');
    expect(mockQueue.edit).toHaveBeenCalledWith({ id: 'b', listId: 'l1', userId: 'u1', values: { quantity: 4 } }, expect.anything());
    expect(mockQueue.add).not.toHaveBeenCalled();
    expect(fieldValue()).toBe('');
    expect(renderer!.root.findAllByType(TextField)[1].props.value).toBe('1');
    expect(notify).not.toHaveBeenCalled();
    expect(askYesNo).not.toHaveBeenCalled();
    // Outro tipo do mesmo item entra sem perguntar.
    type('Leite integral');
    await addTyped('Leite integral');
    expect(mockQueue.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'Leite integral' }), 'u1');
  });

  it('em outra unidade não soma: a pessoa põe como outro item ou deixa como está', async () => {
    mockQueries.items = loaded([{ ...listItem('a', 'Arroz', null, 'graos'), quantity: 2 }]);
    await mount();
    mockQueue.edit.mockClear();
    const pickUnit = (u: string) =>
      act(() => renderer!.root.findAll((node) => node.props.label === u && typeof node.props.onPress === 'function')[0].props.onPress());
    type('Arroz');
    typeQuantity('5');
    pickUnit('kg');
    await addTyped('Arroz');
    expect(repeatSheet().props.message).toBe('Arroz já está na lista com 2 un, e 5 kg é outra unidade. Pôr como outro item ou deixar como está?');
    expect(repeatChoices()).toEqual(['Pôr 5 kg como outro item']);
    act(() => repeatSheet().props.onClose());
    expect(mockQueue.add).not.toHaveBeenCalled();
    expect(mockQueue.edit).not.toHaveBeenCalled();
    type('Arroz');
    typeQuantity('5');
    pickUnit('kg');
    await addTyped('Arroz');
    choose('Pôr 5 kg como outro item');
    expect(mockQueue.add).toHaveBeenCalledWith({ name: 'Arroz', category: 'graos', productId: null, quantity: 5, unit: 'kg' }, 'u1');
    expect(mockQueue.edit).not.toHaveBeenCalled();
    expect(fieldValue()).toBe('');
  });

  it('digitado com outro nome do item pendente: somar, pôr também ou deixar, e deixando o texto não some', async () => {
    mockQueries.items = loaded([listItem('a', 'Leite IL Desnatado', 'il', 'laticinios')]);
    await mount();
    type('Leite desnatado');
    await addTyped('Leite desnatado');
    expect(repeatSheet().props.message).toBe('Leite IL Desnatado já está na lista (1 un). Somar mais 1 un?');
    expect(repeatChoices()).toEqual(['Somar: fica 2 un', 'Pôr "Leite desnatado" como outro item']);
    act(() => repeatSheet().props.onClose());
    expect(mockQueue.add).not.toHaveBeenCalled();
    expect(fieldValue()).toBe('Leite desnatado');
    await addTyped('Leite desnatado');
    choose('Pôr "Leite desnatado" como outro item');
    expect(mockQueue.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'Leite desnatado' }), 'u1');
    expect(fieldValue()).toBe('');
  });

  it('somar parte do item como está no toque: outra pessoa mudou a quantidade, ou ele foi para o carrinho ou saiu', async () => {
    const coffee = listItem('b', 'Café', null, 'cafe_cha');
    mockQueries.items = loaded([coffee]);
    await mount();
    mockQueue.edit.mockClear();
    const rerender = (items: ShoppingListItem[]) => {
      mockQueries.items = loaded(items);
      act(() => renderer!.update(<ShoppingListScreen />));
    };
    type('café');
    typeQuantity('3');
    await addTyped('café');
    expect(repeatChoices()).toEqual(['Somar: fica 4 un']);
    // Com a pergunta aberta, outra pessoa pôs 2: a pergunta e a soma acompanham.
    rerender([{ ...coffee, quantity: 2 }]);
    expect(repeatSheet().props.message).toBe('Café já está na lista (2 un). Somar mais 3 un?');
    choose('Somar: fica 5 un');
    expect(mockQueue.edit).toHaveBeenCalledWith({ id: 'b', listId: 'l1', userId: 'u1', values: { quantity: 5 } }, expect.anything());
    expect(mockQueue.add).not.toHaveBeenCalled();

    // Foi para o carrinho entre a pergunta e o toque: a quantidade entra como item novo, e o do carrinho fica como está.
    rerender([coffee]);
    type('café');
    typeQuantity('3');
    await addTyped('café');
    const sum = (repeatSheet().props.actions as SheetAction[])[0];
    rerender([{ ...coffee, checked_at: '2026-10-23T10:00:00Z' }]);
    act(() => sum.onPress());
    expect(mockQueue.edit).toHaveBeenCalledTimes(1);
    expect(mockQueue.add).toHaveBeenCalledWith({ name: 'café', category: 'cafe_cha', productId: null, quantity: 3, unit: 'un' }, 'u1');

    // Saiu da lista: também entra como item novo.
    mockQueue.add.mockClear();
    act(() => repeatSheet().props.onClose());
    rerender([coffee]);
    type('café');
    typeQuantity('3');
    await addTyped('café');
    const again = (repeatSheet().props.actions as SheetAction[])[0];
    rerender([]);
    act(() => again.onPress());
    expect(mockQueue.edit).toHaveBeenCalledTimes(1);
    expect(mockQueue.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'café', quantity: 3 }), 'u1');
  });

  it('com a quantidade apagada, o item já na lista em outra unidade só ganha o aviso, como antes', async () => {
    mockQueries.items = loaded([{ ...listItem('a', 'Leite', null, 'laticinios'), quantity: 2, unit: 'l' }]);
    await mount();
    type('Leite');
    typeQuantity('');
    await addTyped('Leite');
    expect(notify).toHaveBeenCalledWith('Já estava na lista', 'Leite já está na lista para comprar.');
    expect(repeatSheet().props.visible).toBe(false);
    expect(mockQueue.add).not.toHaveBeenCalled();
    expect(fieldValue()).toBe('');
    // Com a quantidade dita, a outra unidade é um pedido: a pergunta volta.
    jest.mocked(notify).mockClear();
    type('Leite');
    typeQuantity('1');
    await addTyped('Leite');
    expect(notify).not.toHaveBeenCalled();
    expect(repeatChoices()).toEqual(['Pôr 1 un como outro item']);
  });

  it('uma pergunta nova com a anterior ainda aberta (um menu que não apareceu) monta um menu novo, com o item novo', async () => {
    mockQueries.items = loaded([listItem('a', 'Arroz', null, 'graos'), listItem('b', 'Café', null, 'cafe_cha')]);
    await mount();
    type('Arroz');
    await addTyped('Arroz');
    const before = repeatSheet();
    type('Café');
    await addTyped('Café');
    expect(repeatSheet()).not.toBe(before);
    expect(repeatSheet().props).toMatchObject({ visible: true, message: 'Café já está na lista (1 un). Somar mais 1 un?' });
  });

  it('duas marcas digitadas de propósito entram as duas, sem perguntar', async () => {
    mockQueries.items = loaded([listItem('a', 'Biscoito Oreo', null, 'doces'), listItem('b', 'Shampoo Seda', null, 'higiene')]);
    await mount();
    type('Biscoito Passatempo');
    await addTyped('Biscoito Passatempo');
    type('Shampoo Clear Men');
    await addTyped('Shampoo Clear Men');
    expect(askYesNo).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(mockQueue.add.mock.calls.map(([item]) => (item as { name: string }).name)).toEqual(['Biscoito Passatempo', 'Shampoo Clear Men']);
  });

  it('a busca põe, de cada item, o produto que a casa comprou por último', async () => {
    const melitta = { ...product('a-melitta', 'Café Melitta 500g'), category: 'cafe_cha' } as Product;
    const pilao = { ...product('b-pilao', 'Café Pilão 500g'), category: 'cafe_cha' } as Product;
    mockQueries.products = loaded([melitta, pilao]);
    mockQueries.purchases = loaded([bought('Café Melitta 500g', 'a-melitta', 'cafe_cha', 80), bought('Café Pilão 500g', 'b-pilao', 'cafe_cha', 6)]);
    await mount();
    type('café');
    const rows = renderer!.root.findAllByType(ListRow).filter((r) => r.props.subtitle === 'Produto com histórico de preço');
    expect(rows.map((r) => r.props.title)).toEqual(['Café']);
    await act(async () => {
      await rows[0].props.onPress();
    });
    expect(mockQueue.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'Café', productId: 'b-pilao' }), 'u1');
  });

  describe('o catálogo de itens comuns', () => {
    const toggle = (name: string, category: string, add: boolean) =>
      act(async () => {
        await (mockSeen.picker!.onToggle as (item: unknown, add: boolean) => Promise<boolean>)({ name, category, unit: 'un' }, add);
      });

    beforeEach(() => {
      mockQueue.removePending.mockReset();
      mockQueue.removePending.mockResolvedValue('removed');
    });

    it('tirar o item do catálogo pergunta e diz o que sai quando são marcas ou outro nome', async () => {
      mockQueries.items = loaded([listItem('a', 'Cerveja Heineken', null, 'alcoolicas'), listItem('b', 'Cerveja Brahma', null, 'alcoolicas')]);
      await mount();
      expect((mockSeen.picker!.inList as Set<string>).has('cerveja')).toBe(true);
      jest.mocked(askYesNo).mockResolvedValueOnce(false);
      await toggle('Cerveja', 'alcoolicas', false);
      expect(askYesNo).toHaveBeenCalledWith('Tirar da lista?', 'Cerveja Heineken e Cerveja Brahma saem da lista. Tirar mesmo assim?', 'Tirar', 'Manter');
      expect(mockQueue.removePending).not.toHaveBeenCalled();
      jest.mocked(askYesNo).mockResolvedValueOnce(true);
      await toggle('Cerveja', 'alcoolicas', false);
      expect(mockQueue.removePending.mock.calls.map(([input]) => (input as { id: string }).id)).toEqual(['a', 'b']);
    });

    it('com "Marca preferida" ligada também pergunta; o próprio item do catálogo sai sem perguntar', async () => {
      mockQueries.items = loaded([
        { ...listItem('a', 'Leite IL Desnatado', 'il', 'laticinios'), brand_preferred: true },
        listItem('b', 'Arroz', null, 'graos'),
      ]);
      await mount();
      jest.mocked(askYesNo).mockResolvedValueOnce(false);
      await toggle('Leite desnatado', 'laticinios', false);
      expect(askYesNo).toHaveBeenCalledWith('Tirar da lista?', 'Leite IL Desnatado sai da lista. Tirar mesmo assim?', 'Tirar', 'Manter');
      expect(mockQueue.removePending).not.toHaveBeenCalled();
      jest.mocked(askYesNo).mockClear();
      await toggle('Arroz', 'graos', false);
      expect(askYesNo).not.toHaveBeenCalled();
      expect(mockQueue.removePending).toHaveBeenCalledWith({ id: 'b', plainOnly: true });
    });
  });

  it('os detalhes do item oferecem "Marca preferida" quando o produto dele tem marca', async () => {
    const generic = listItem('a', 'Leite desnatado', 'il', 'laticinios');
    mockQueries.items = loaded([generic]);
    mockQueries.products = loaded([MILK]);
    await mount();
    act(() => mockSeen.open!(generic));
    expect(mockSeen.editor?.brand).toEqual({ brandName: 'Leite IL Desnatado', genericName: 'Leite desnatado' });
  });

  it('salvar os detalhes grava a "Marca preferida" só quando a pessoa a mudou', async () => {
    const details = { quantity: 1, unit: 'un', notes: null, priority: 'normal' };
    const save = async (item: ShoppingListItem, changes: Record<string, unknown>) => {
      act(() => mockSeen.open!(item));
      expect((mockSeen.editor?.item as ShoppingListItem).id).toBe(item.id);
      await act(async () => {
        await (mockSeen.editor!.onSave as (d: unknown, p: unknown) => Promise<void>)({ ...details, category: item.category, ...changes }, { kind: 'keep' });
      });
    };
    const generic = { ...listItem('a', 'Leite desnatado', 'il', 'laticinios'), brand_preferred: false };
    const legacy = { ...listItem('b', 'Leite IL Desnatado', 'il', 'laticinios'), brand_preferred: false };
    mockQueries.items = loaded([generic, legacy]);
    mockQueries.products = loaded([MILK]);
    await mount();
    mockQueue.edit.mockClear();
    await save(generic, { name: 'Leite IL Desnatado', brandPreferred: true });
    expect(mockQueue.edit).toHaveBeenCalledWith(
      { id: 'a', listId: 'l1', userId: 'u1', values: { name: 'Leite IL Desnatado', brand_preferred: true }, expectedPhotoPath: undefined },
      expect.anything(),
    );
    // O item de antes com o nome do produto, salvo sem mexer na escolha: nada muda (continua com qualquer marca).
    mockQueue.edit.mockClear();
    await save(legacy, { name: 'Leite IL Desnatado', brandPreferred: false });
    expect(mockQueue.edit).not.toHaveBeenCalled();
    // Desligar a escolha que estava ligada.
    await save({ ...legacy, brand_preferred: true }, { name: 'Leite desnatado', brandPreferred: false });
    expect(mockQueue.edit).toHaveBeenCalledWith(
      expect.objectContaining({ values: { name: 'Leite desnatado', brand_preferred: false } }),
      expect.anything(),
    );
  });
});

describe('ler o código de barras no cartão de pôr item', () => {
  const MILK = { ...product('il', 'Leite IL Desnatado'), category: 'laticinios' } as Product;
  const scanButton = () => renderer!.root.findAll((node) => node.type === Button && node.props.title === 'Ler código de barras')[0];

  beforeEach(() => {
    mockQueue.add.mockClear();
    mockBarcode.start.mockClear();
    jest.mocked(notify).mockClear();
    mockQueries.products = loaded([MILK]);
  });

  it('o botão abre a câmera, e o produto lido entra como a sugestão da busca: sem a marca, com o produto como dica', async () => {
    mockBarcode.available = true;
    await mount();
    act(() => scanButton().props.onPress());
    expect(mockBarcode.start).toHaveBeenCalledTimes(1);
    await act(async () => mockBarcode.onProduct!(MILK));
    expect(mockQueue.add).toHaveBeenCalledWith({ name: 'Leite desnatado', category: 'laticinios', productId: 'il', quantity: 1, unit: 'un' }, 'u1');
  });

  it('o mesmo item já para comprar: não põe de novo e pergunta se soma, como a sugestão', async () => {
    mockBarcode.available = true;
    mockQueries.items = loaded([listItem('a', 'Leite desnatado', null, 'laticinios')]);
    await mount();
    await act(async () => mockBarcode.onProduct!(MILK));
    expect(mockQueue.add).not.toHaveBeenCalled();
    expect(repeatSheet().props.message).toBe('Leite desnatado já está na lista (1 un). Somar mais 1 un?');
  });

  it('enquanto o código anterior ainda está sendo visto, o botão fica carregando', async () => {
    mockBarcode.available = true;
    await mount();
    expect(scanButton().props.loading).toBe(false);
    mockBarcode.busy = true;
    await act(async () => renderer!.update(<ShoppingListScreen />));
    expect(scanButton().props.loading).toBe(true);
  });

  it('sem a tabela no banco: sem o botão, e a lista abre', async () => {
    expect(await mount()).toContain('Lista vazia');
    expect(scanButton()).toBeUndefined();
  });
});

describe('ajustes da lista: corredores, categoria e colar', () => {
  /** 10 itens de várias seções, com um urgente: a lista ganha os títulos dos corredores. */
  const longList = () => [
    listItem('d', 'Detergente', null, 'limpeza'),
    listItem('a', 'Arroz', null, 'graos'),
    listItem('t', 'Tomate', null, 'hortifruti'),
    { ...listItem('l', 'Leite', null, 'laticinios'), priority: 'urgente' as const },
    listItem('b', 'Banana', null, 'hortifruti'),
    listItem('f', 'Feijão', null, 'graos'),
    listItem('s', 'Suco', null, 'bebidas'),
    listItem('p', 'Papel higiênico', null, 'papel'),
    listItem('r', 'Rúcula', null, 'outros'),
    listItem('q', 'Queijo', null, 'laticinios'),
  ];
  /** O que cada grade de "Para comprar" mostra, na ordem. */
  const grids = () =>
    renderer!.root
      .findAllByType(ShoppingGrid)
      .filter((grid) => !grid.props.inCart)
      .map((grid) => (grid.props.items as ShoppingListItem[]).map((i) => i.name));

  beforeEach(() => {
    mockQueue.add.mockClear();
    mockQueue.edit.mockClear();
    mockClipboard.text = '';
    jest.mocked(notify).mockClear();
  });

  it('com muitos itens, a grade sai em seções com título, na ordem dos corredores do texto do WhatsApp', async () => {
    mockQueries.items = loaded(longList());
    const page = await mount();
    expect(grids()).toEqual([['Leite'], ['Banana', 'Tomate'], ['Queijo'], ['Arroz', 'Feijão'], ['Suco'], ['Detergente'], ['Papel higiênico'], ['Rúcula']]);
    const titles = ['Urgente', 'Frutas e verduras', 'Laticínios', 'Grãos, massas e cereais', 'Bebidas', 'Limpeza', 'Papel e descartáveis', 'Outros'];
    // Os títulos estão na tela, nesta ordem.
    const at = titles.map((title) => page.split('\n').indexOf(title));
    expect(at.every((line) => line >= 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
  });

  it('com poucos itens fica como antes: uma grade só, sem títulos', async () => {
    mockQueries.items = loaded(longList().slice(0, 8));
    const page = await mount();
    expect(grids()).toHaveLength(1);
    expect(grids()[0]).toHaveLength(8);
    expect(page.split('\n')).not.toContain('Frutas e verduras');
  });

  it('trocar a categoria nos detalhes grava pela fila de edições, e o item muda de seção na tela e no texto', async () => {
    const items = longList();
    mockQueries.items = loaded(items);
    await mount();
    const rucula = items.find((i) => i.id === 'r')!;
    act(() => mockSeen.open!(rucula));
    expect((mockSeen.editor?.item as ShoppingListItem).id).toBe('r');
    const details = { name: 'Rúcula', quantity: 1, unit: 'un', notes: null, priority: 'normal', category: 'hortifruti' };
    await act(async () => {
      await (mockSeen.editor!.onSave as (d: unknown, p: unknown) => Promise<void>)(details, { kind: 'keep' });
    });
    expect(mockQueue.edit).toHaveBeenCalledWith(
      { id: 'r', listId: 'l1', userId: 'u1', values: { category: 'hortifruti' }, expectedPhotoPath: undefined },
      expect.anything(),
    );
    // A fila muda o item na hora (data/market, useEditListItem): a tela redesenha com ele na seção nova.
    mockQueries.items = loaded(items.map((i) => (i.id === 'r' ? { ...i, category: 'hortifruti' } : i)));
    await act(async () => renderer!.update(<ShoppingListScreen />));
    expect(grids()[1]).toEqual(['Banana', 'Rúcula', 'Tomate']);
    expect(grids().flat().filter((name) => name === 'Rúcula')).toHaveLength(1);
    act(() => renderer!.root.findAll((node) => node.type === Button && node.props.title === 'Mandar a lista')[0].props.onPress());
    expect(texts(renderer!.toJSON()).join('\n')).toContain('*Frutas e verduras*\n- Banana\n- Rúcula\n- Tomate');
  });

  it('a categoria escolhida vale mais que o chute pelo nome novo', async () => {
    const item = listItem('x', 'Coisa', null, 'outros');
    mockQueries.items = loaded([item]);
    await mount();
    act(() => mockSeen.open!(item));
    await act(async () => {
      await (mockSeen.editor!.onSave as (d: unknown, p: unknown) => Promise<void>)(
        { name: 'Banana prata', quantity: 1, unit: 'un', notes: null, priority: 'normal', category: 'doces' },
        { kind: 'keep' },
      );
    });
    expect(mockQueue.edit).toHaveBeenCalledWith(expect.objectContaining({ values: { name: 'Banana prata', category: 'doces' } }), expect.anything());
  });

  describe('colar lista', () => {
    const open = () => act(() => renderer!.root.findAll((node) => node.type === Button && node.props.title === 'Colar lista')[0].props.onPress());
    const modal = () => renderer!.root.findAllByType(PasteListModal)[0];
    const pasteField = () => modal().findAll((node) => node.type === TextField && node.props.accessibilityLabel === 'Texto da lista')[0];
    const modalButton = (title: RegExp) => modal().findAll((node) => node.type === Button && title.test(node.props.title))[0];

    it('mostra a prévia, diz o que já está na lista e põe só o resto, pela fila', async () => {
      mockQueries.items = loaded([listItem('c', 'Café', null, 'cafe_cha'), listItem('i', 'Leite IL Desnatado', 'il', 'laticinios')]);
      mockQueries.products = loaded([{ ...product('arroz-tio', 'Arroz'), category: 'graos' } as Product]);
      await mount();
      expect(modal()).toBeUndefined();
      // O leitor de tela diz o que está escrito no botão.
      const pasteButton = renderer!.root.findAll((node) => node.type === Button && node.props.title === 'Colar lista')[0];
      expect(pasteButton.props.accessibilityLabel).toBeUndefined();
      open();
      expect(modalButton(/^Adicionar/).props.disabled).toBe(true);
      // O teclado não cobre o botão de pôr: a rolagem ganha o espaço dele, e arrastar o fecha.
      expect(modal().findByType(ScrollView).props).toMatchObject({ automaticallyAdjustKeyboardInsets: true, keyboardDismissMode: 'on-drag' });
      // O próprio texto que o app manda, com um item que já está na lista com a marca.
      act(() => pasteField().props.onChangeText('*Mercado* · 4 itens\n- 2 kg arroz\n- Café\n- leite desnatado (2)\n✅ banana'));
      const page = texts(renderer!.toJSON()).join('\n');
      expect(page).toContain('Prévia');
      expect(page).toContain('2 kg · Grãos, massas e cereais');
      expect(page).toContain('Já está na lista: não entra de novo');
      expect(page).toContain('Já está na lista como Leite IL Desnatado: não entra de novo');
      expect(page).toContain('1 un · Frutas e verduras');
      expect(page).not.toContain('Mercado · 4');
      const add = modalButton(/^Adicionar/);
      expect(add.props.title).toBe('Adicionar 2 itens');
      act(() => add.props.onPress());
      // Cada item pela fila, como pôr um item (vale sem internet); o arroz vai com o produto da casa como dica de preço.
      expect(mockQueue.add.mock.calls).toEqual([
        [{ name: 'Arroz', category: 'graos', productId: 'arroz-tio', quantity: 2, unit: 'kg' }, 'u1'],
        [{ name: 'Banana', category: 'hortifruti', productId: null, quantity: 1, unit: 'un' }, 'u1'],
      ]);
      expect(modal()).toBeUndefined();
    });

    it('"Colar o que copiei" traz o texto da área de transferência; sem nada copiado, avisa', async () => {
      await mount();
      open();
      await act(async () => modalButton(/^Colar o que copiei$/).props.onPress());
      // Nada copiado ou a licença negada dão a mesma resposta vazia: o aviso serve para os dois, no celular e no computador.
      expect(notify).toHaveBeenCalledWith('Não deu para colar', 'Não deu para pegar o que foi copiado. Cole direto no campo.');
      mockClipboard.text = 'arroz, feijão';
      await act(async () => modalButton(/^Colar o que copiei$/).props.onPress());
      expect(pasteField().props.value).toBe('arroz, feijão');
      expect(modalButton(/^Adicionar/).props.title).toBe('Adicionar 2 itens');
    });

    it('texto enorme: diz que só os primeiros entram, e "mais de" quando a conta parou', async () => {
      await mount();
      open();
      act(() => pasteField().props.onChangeText(Array.from({ length: 150 }, (_, i) => `item ${i + 1}`).join('\n')));
      expect(texts(renderer!.toJSON()).join('')).toContain('Só os primeiros 100 itens entram de uma vez: 50 itens ficaram de fora.');
      act(() => pasteField().props.onChangeText(Array.from({ length: 1500 }, (_, i) => `item ${i + 1}`).join('\n')));
      expect(texts(renderer!.toJSON()).join('')).toContain('Só os primeiros 100 itens entram de uma vez: mais de 1000 itens ficaram de fora.');
      expect(modalButton(/^Adicionar/).props.title).toBe('Adicionar 100 itens');
    });

    it('texto sem item nenhum: diz isso, e não há o que adicionar', async () => {
      await mount();
      open();
      act(() => pasteField().props.onChangeText('Lista:\n\n---'));
      expect(texts(renderer!.toJSON()).join('\n')).toContain('Nenhum item nesse texto. Ponha um item por linha.');
      expect(modalButton(/^Adicionar/).props.disabled).toBe(true);
      act(() => modal().props.onClose());
      expect(modal()).toBeUndefined();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });
});

/** Uma ida que vale agora (começou há 30 min). */
const liveTrip = (patch: Partial<MarketTrip> = {}): MarketTrip => ({
  id: 't1',
  list_id: 'l1',
  user_id: 'u1',
  display_name: 'Ana',
  created_at: new Date(Date.now() - 30 * 60_000).toISOString(),
  ends_at: new Date(Date.now() + 90 * 60_000).toISOString(),
  ended_at: null,
  list: { name: 'Mercado', kind: 'mercado', archived_at: null },
  ...patch,
});
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const button = (title: string) => renderer!.root.findAllByType(Button).find((entry) => entry.props.title === title);

describe('renomear e reabrir a lista', () => {
  it('"Renomear lista" abre o modal com o nome de agora e grava o nome novo', async () => {
    await mount();
    await act(async () => button('Renomear lista')!.props.onPress());
    const field = renderer!.root.findAllByType(TextField).find((entry) => entry.props.label === 'Nome da lista')!;
    expect(field.props.value).toBe('Mercado');
    await act(async () => field.props.onChangeText(' Feira  do sábado'));
    await act(async () => button('Salvar')!.props.onPress());
    expect(mockQueue.rename).toHaveBeenCalledWith('Feira do sábado', expect.anything());
  });

  it('a lista arquivada é só para ver: sem pôr item, sem limpar, sem marcar nem editar, com o aviso', async () => {
    mockQueries.list = loaded({ id: 'l1', name: 'Churrasco', kind: 'mercado', archived_at: '2026-10-20T12:00:00Z', created_at: '2026-10-01T12:00:00Z' });
    mockQueries.items = loaded([listItem('a', 'Arroz', null), { ...listItem('b', 'Carvão', null), checked_at: minutesAgo(60) }]);
    const page = await mount();
    expect(page).toContain('Esta lista está arquivada. Reabra para mexer nela.');
    expect(renderer!.root.findAllByType(TextField).filter((field) => field.props.placeholder === 'Adicionar item')).toHaveLength(0);
    expect(button('Colar lista')).toBeUndefined();
    expect(button('Limpar')).toBeUndefined();
    const grids = renderer!.root.findAllByType(ShoppingGrid);
    expect(grids.length).toBe(2);
    expect(grids.every((grid) => grid.props.readOnly === true)).toBe(true);
    expect(grids.find((grid) => grid.props.inCart)!.props.onStore).toBeUndefined();
    // Segurar o item abre os detalhes só para ver.
    await act(async () => mockSeen.open!((mockQueries.items.data as ShoppingListItem[])[0]));
    expect(mockSeen.editor?.item).toMatchObject({ id: 'a' });
    expect(mockSeen.editor?.onSave).toBeUndefined();
    expect(mockSeen.editor?.onRemove).toBeUndefined();
    expect(page).not.toContain('Toque num item para pôr no carrinho');
    // Ver ainda dá: os itens, mandar a lista, renomear e reabrir.
    expect(button('Mandar a lista')).toBeDefined();
    expect(button('Renomear lista')).toBeDefined();
    expect(button('Reabrir lista')).toBeDefined();
  });

  it('a lista aberta continua com tudo', async () => {
    mockQueries.items = loaded([listItem('a', 'Arroz', null), { ...listItem('b', 'Carvão', null), checked_at: minutesAgo(60) }]);
    const page = await mount();
    expect(page).not.toContain('Esta lista está arquivada');
    expect(button('Limpar')).toBeDefined();
    expect(renderer!.root.findAllByType(ShoppingGrid).every((grid) => !grid.props.readOnly)).toBe(true);
    await act(async () => mockSeen.open!((mockQueries.items.data as ShoppingListItem[])[0]));
    expect(typeof mockSeen.editor?.onSave).toBe('function');
  });

  it('a lista arquivada mostra "Reabrir lista" no lugar de "Arquivar lista"', async () => {
    mockQueries.list = loaded({ id: 'l1', name: 'Churrasco', kind: 'mercado', archived_at: '2026-10-20T12:00:00Z', created_at: '2026-10-01T12:00:00Z' });
    await mount();
    expect(button('Arquivar lista')).toBeUndefined();
    await act(async () => button('Reabrir lista')!.props.onPress());
    expect(mockQueue.reopen).toHaveBeenCalledWith('l1', expect.anything());
  });
});

describe('limpar o carrinho com uma ida ao mercado aberta', () => {
  beforeEach(() => {
    mockQueries.items = loaded([{ ...listItem('a', 'Arroz', null), checked_at: minutesAgo(5) }]);
    jest.mocked(askYesNo).mockReset();
  });

  /** "Limpar", a confirmação do que vai para a despensa e a resposta do servidor. */
  async function clearCart() {
    await tapClear();
    await deliverClears();
  }
  /** O toque em "Limpar" e a confirmação do que vai para a despensa. */
  async function tapClear() {
    await act(async () => button('Limpar')!.props.onPress());
    await act(async () => (mockSeen.cartPantry!.onConfirm as (rows: unknown[]) => void)([]));
  }
  /** A fila manda o que esperava e o servidor responde que deu certo. */
  async function deliverClears() {
    for (const options of mockClearQueue.splice(0)) await act(async () => options.onSuccess?.());
  }

  it('com a própria ida nesta lista, pergunta e encerra', async () => {
    mockTrips.list = [liveTrip()];
    jest.mocked(askYesNo).mockResolvedValue(true);
    mockTrips.end.mockResolvedValue(true);
    await mount();
    await clearCart();
    expect(askYesNo).toHaveBeenCalledWith('Encerrar a ida ao mercado?', expect.any(String), 'Encerrar', 'Agora não');
    expect(mockTrips.end).toHaveBeenCalledWith('t1');
  });

  it('"Agora não" deixa a ida aberta', async () => {
    mockTrips.list = [liveTrip()];
    jest.mocked(askYesNo).mockResolvedValue(false);
    await mount();
    await clearCart();
    expect(askYesNo).toHaveBeenCalled();
    expect(mockTrips.end).not.toHaveBeenCalled();
  });

  it('se encerrar der errado, o aviso de sempre', async () => {
    mockTrips.list = [liveTrip()];
    jest.mocked(askYesNo).mockResolvedValue(true);
    mockTrips.end.mockRejectedValue(new Error('sem rede'));
    jest.mocked(notify).mockClear();
    await mount();
    await clearCart();
    expect(notify).toHaveBeenCalledWith('Não deu para encerrar', 'Sem internet agora. Encerre quando a conexão voltar.');
  });

  it.each([
    ['sem ida', () => []],
    ['com a ida de outra pessoa', () => [liveTrip({ user_id: 'outra' })]],
    ['com a ida de outra lista', () => [liveTrip({ list_id: 'l2' })]],
  ])('%s, não pergunta', async (_why, trips) => {
    mockTrips.list = trips();
    await mount();
    await clearCart();
    expect(askYesNo).not.toHaveBeenCalled();
  });

  it('limpar sem internet: o limpar espera na fila e, quando a conexão volta e ele sai, não pergunta do nada', async () => {
    mockTrips.list = [liveTrip()];
    mockTrips.online = false;
    await mount();
    await tapClear();
    // Ainda na fila: nada respondeu.
    expect(mockClearQueue).toHaveLength(1);
    mockTrips.online = true;
    await deliverClears();
    expect(askYesNo).not.toHaveBeenCalled();
  });

  it('a resposta que demora mais de 30 s (a fila andando devagar) também não pergunta', async () => {
    mockTrips.list = [liveTrip()];
    await mount();
    await tapClear();
    const later = Date.now() + 31_000;
    const spy = jest.spyOn(Date, 'now').mockReturnValue(later);
    await deliverClears();
    spy.mockRestore();
    expect(askYesNo).not.toHaveBeenCalled();
  });

  it('guardar um item só pela geladeira não pergunta', async () => {
    mockTrips.list = [liveTrip()];
    await mount();
    const cart = renderer!.root.findAllByType(ShoppingGrid).find((grid) => grid.props.inCart)!;
    await act(async () => cart.props.onStore(mockQueries.items.data && (mockQueries.items.data as ShoppingListItem[])[0]));
    await act(async () => (mockSeen.cartPantry!.onConfirm as (rows: unknown[]) => void)([]));
    await deliverClears();
    expect(askYesNo).not.toHaveBeenCalled();
  });
});

describe('o selo "Novo" durante a ida ao mercado', () => {
  beforeEach(() => {
    mockQueries.items = loaded([
      { ...listItem('antes', 'Arroz', null), created_at: minutesAgo(45) },
      { ...listItem('depois', 'Feijão', null), created_at: minutesAgo(10) },
      { ...listItem('daqui', 'Café', null), created_at: minutesAgo(5) },
    ]);
    rememberAdded('l1', ['daqui']);
  });

  it('para quem avisou, só o que a casa pôs depois do aviso', async () => {
    mockTrips.list = [liveTrip()];
    await mount();
    const isNew = ['antes', 'depois', 'daqui'].filter((id) => mockSeen.hints?.get(id)?.isNew);
    expect(isNew).toEqual(['depois']);
  });

  it('na ida de outra pessoa, nenhum selo', async () => {
    mockTrips.list = [liveTrip({ user_id: 'outra' })];
    await mount();
    expect(['antes', 'depois', 'daqui'].filter((id) => mockSeen.hints?.get(id)?.isNew)).toEqual([]);
  });
});

describe('"Onde estou" guardado no aparelho', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockQueries.items = loaded([listItem('a', 'Arroz', null), { ...listItem('b', 'Feijão', null), checked_at: minutesAgo(5) }]);
  });
  const estimateCard = () => renderer!.root.findByType(ListEstimateCard);

  it('o mercado escolhido volta depois de fechar e abrir a lista', async () => {
    await mount();
    await act(async () => estimateCard().props.onChangeStore('s1'));
    expect(estimateCard().props.storeId).toBe('s1');
    expect(JSON.parse((await AsyncStorage.getItem('kotii:store-choice:l1'))!).storeId).toBe('s1');
    await act(async () => renderer!.unmount());
    await mount();
    expect(estimateCard().props.storeId).toBe('s1');
  });

  it('tirar o mercado e limpar o carrinho apagam a escolha', async () => {
    await mount();
    await act(async () => estimateCard().props.onChangeStore('s1'));
    await act(async () => estimateCard().props.onChangeStore(null));
    expect(estimateCard().props.storeId).toBeNull();
    expect(await AsyncStorage.getItem('kotii:store-choice:l1')).toBeNull();
    await act(async () => estimateCard().props.onChangeStore('s1'));
    await act(async () => button('Limpar')!.props.onPress());
    await act(async () => (mockSeen.cartPantry!.onConfirm as (rows: unknown[]) => void)([]));
    expect(estimateCard().props.storeId).toBeNull();
    expect(await AsyncStorage.getItem('kotii:store-choice:l1')).toBeNull();
  });

  it('o limpar que falha devolve o mercado escolhido', async () => {
    await mount();
    await act(async () => estimateCard().props.onChangeStore('s1'));
    await act(async () => button('Limpar')!.props.onPress());
    await act(async () => (mockSeen.cartPantry!.onConfirm as (rows: unknown[]) => void)([]));
    expect(estimateCard().props.storeId).toBeNull();
    const [options] = mockClearQueue.splice(0);
    await act(async () => options.onError?.(new Error('A lista não existe mais.')));
    expect(estimateCard().props.storeId).toBe('s1');
  });

  it('a escolha de mais de 6 horas atrás já não vale', async () => {
    await mount();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() - CHOSEN_STORE_MS - 1000);
    await act(async () => estimateCard().props.onChangeStore('s1'));
    spy.mockRestore();
    await act(async () => renderer!.unmount());
    await mount();
    expect(estimateCard().props.storeId).toBeNull();
  });
});
