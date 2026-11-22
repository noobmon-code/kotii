import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { useEffect, type ReactElement, type ReactNode } from 'react';
import { AccessibilityInfo, Dimensions, Platform, ScrollView, StyleSheet } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import ShoppingListScreen from '@/app/lista/[id]/index';
import { toISODate } from '@/domain/dates';
import { REFRESH_LABEL } from '@/domain/desktop';
import { LinkIndex } from '@/domain/listLinks';
import { FIRST_LIST_SKIP, FIRST_LIST_TEXT } from '@/domain/onboarding';
import type { PurchaseRecord } from '@/domain/recentPurchases';
import { PRICE_CALCULATOR_LABEL, WAITING_SENTENCE as WAITING_TEXT } from '@/domain/priceCalculator';
import { listShareText } from '@/domain/listShare';
import { SHARED_PRICES_NOTICE, type SharedPrice } from '@/domain/sharedPrices';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ALL_IN_CART_MESSAGE, FINISH_OFFLINE_NOTICE } from '@/domain/finishPurchase';
import { CHOSEN_STORE_MS, ESTIMATE_MORE_LABEL } from '@/domain/listEstimate';
import { ADD_FIELD_PLACEHOLDER, BARCODE_BUTTON, LIST_MENU_LABEL } from '@/domain/listMode';
import type { MarketTrip } from '@/domain/marketTrips';
import { CartPantryModal } from '@/features/CartPantryModal';
import { ListEstimateCard, StorePicker } from '@/features/ListEstimateCard';
import { MarketTripAction, MarketTripConfirm } from '@/features/MarketTrip';
import { forgetAddedItems, rememberAdded } from '@/lib/addedItems';
import { handConfirmedReceipt, stopWaitingForReceipt } from '@/lib/finishPurchase';
import { router } from 'expo-router';
import { PasteListModal } from '@/features/PasteListModal';
import { ANNOUNCE_DELAY_MS, PriceCalculator } from '@/features/PriceCalculator';
import { ListMenu } from '@/features/ListMenu';
import { RecentPurchases, RestockStrip } from '@/features/RecentPurchases';
import { ShoppingGrid, type ItemHint } from '@/features/ShoppingGrid';
import type { LatestPrice, PantryItem, Product, ShoppingListItem } from '@/lib/types';
import { StaleNotice } from '@/features/health/StaleNotice';
import { ActionSheet, type SheetAction } from '@/ui/ActionSheet';
import { Actions, Columns } from '@/ui/desktop';
import { askYesNo, confirmAction, notify } from '@/ui/dialogs';
import { Badge, Button, Card, Chip, EmptyState, ErrorNotice, IconButton, ListRow, Loading, Row, Screen, Section, Text, TextField } from '@/ui/primitives';

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
  /** As opções que a tela deu ao cabeçalho (Stack.Screen): o título e o ícone da calculadora. */
  options?: Record<string, unknown>;
} = {};

/** A volta da lista ao foco (de outra tela por cima dela, como a revisão da nota): o teste chama quando quer. */
const mockFocus: { effect: (() => void) | null } = { effect: null };
/** O endereço da lista: `primeira=1` é a lista logo depois de criar a casa no começo (FirstListFlow). */
const mockRouteParams: Record<string, string | undefined> = { id: 'l1' };
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), setParams: jest.fn() },
  Stack: {
    Screen: ({ options }: { options?: Record<string, unknown> }) => {
      mockSeen.options = options;
      return null;
    },
  },
  useLocalSearchParams: () => mockRouteParams,
  useFocusEffect: (effect: () => void) => {
    mockFocus.effect = effect;
  },
}));
// O que está guardado da lista é o que a tela recebeu por último. A conexão é a mesma das idas ao mercado.
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ getQueryData: (key: unknown[]) => (key[0] === 'listItems' ? mockQueries.items?.data : undefined) }),
  onlineManager: { isOnline: () => mockTrips.online },
}));
jest.mock('@/ui/NukeLive', () => ({ NukeLive: () => null }));
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
  archive: jest.fn(),
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
    useArchiveList: () => ({ mutate: mockQueue.archive, isPending: false }),
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
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } } }),
  useHouseholdId: () => 'h1',
  useHousehold: () => ({ data: { household: { id: 'h1', name: 'Casa da Ana', invite_code: 'KM2P9Q', created_by: 'u1' } } }),
}));
jest.mock('@/lib/supabase', () => ({ errorMessage: (error: unknown) => String(error) }));
jest.mock('@/ui/dialogs', () => ({ afterPaint: (run: () => void) => run(), askYesNo: jest.fn(), confirmAction: jest.fn(), notify: jest.fn() }));
// Os desenhos animados (reanimated) e o fundo não entram no que se confere aqui.
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
// O caminho depois de ler o código de barras tem os testes dele (productBarcodeFlow.test.tsx): aqui, só o botão e o
// que a lista faz com o produto lido. Sem dizer nada, como num banco ainda sem a tabela: sem o botão.
const mockBarcode: {
  available: boolean;
  busy: boolean;
  start: jest.Mock;
  onProduct: ((product: Product) => void) | null;
  /** As janelas do caminho do código (o leitor, "Qual produto é este?"), que a tela desenha onde quiser. */
  element: ReactNode;
} = {
  available: false,
  busy: false,
  start: jest.fn(),
  onProduct: null,
  element: null,
};
jest.mock('@/features/ProductBarcode', () => ({
  // O produto lido vai para o onProduct do desenho mais recente, como no hook de verdade (que o guarda numa ref:
  // productBarcodeFlow.test.tsx, o código que responde depois de a tela mudar).
  useProductBarcode: ({ onProduct }: { onProduct: (product: Product) => void }) => {
    mockBarcode.onProduct = onProduct;
    return { available: mockBarcode.available, busy: mockBarcode.busy, start: mockBarcode.start, element: mockBarcode.element };
  },
}));
/** Quantas vezes cada janela foi montada: a que remonta perde o que estava digitado nela. */
const mockMounts = { barcode: 0, picker: 0, trip: 0 };
/** No lugar das janelas do código de barras: só conta quando monta. */
function BarcodeSteps() {
  useEffect(() => {
    mockMounts.barcode += 1;
  }, []);
  return null;
}
jest.mock('@/ui/PickerModal', () => {
  const { useEffect: onMount } = jest.requireActual<typeof import('react')>('react');
  return {
    PickerModal: () => {
      onMount(() => {
        mockMounts.picker += 1;
      }, []);
      return null;
    },
  };
});
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
jest.mock('@/features/MarketTrip', () => {
  const { useEffect: onMount } = jest.requireActual<typeof import('react')>('react');
  return {
    MarketTripAction: () => null,
    MarketTripBanner: () => null,
    // A pergunta de avisar a casa: só conta quando monta.
    MarketTripConfirm: () => {
      onMount(() => {
        mockMounts.trip += 1;
      }, []);
      return null;
    },
  };
});
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

/** A escolha do lugar ("Onde você está comprando?"), que o chip do cartão da conta abre: a tela a desenha. */
const storePicker = () => renderer!.root.findByType(StorePicker);
/** O "i" do cartão da conta, que abre o resto dela ali mesmo (recolhido ao abrir a lista). */
const estimateMore = () => renderer!.root.findAllByType(IconButton).find((entry) => entry.props.label === ESTIMATE_MORE_LABEL);
/** Abre o cartão da conta, quando ele está na tela, e devolve tudo o que a tela escreve. */
async function openEstimate() {
  const more = estimateMore();
  if (more && !more.props.expanded) await act(async () => more.props.onPress());
  return texts(renderer!.toJSON()).join('\n');
}
/** Abre a tela já com o cartão da conta aberto: as frases de antes de ele recolher. */
async function mountOpen() {
  await mount();
  return openEstimate();
}
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
  delete mockRouteParams.primeira;
  mockTrips.list = [];
  mockTrips.online = true;
  mockTrips.end.mockReset();
  forgetAddedItems();
  mockClearQueue.length = 0;
  mockSeen.cartPantry = undefined;
  mockBarcode.available = false;
  mockBarcode.busy = false;
  mockBarcode.element = null;
  mockBarcode.onProduct = null;
  mockSeen.hints = undefined;
  mockSeen.restock = undefined;
  mockSeen.recent = undefined;
  mockSeen.editor = undefined;
  mockSeen.options = undefined;
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
    expect(await mountOpen()).not.toContain('Na despensa');
    expect(mockSeen.hints?.get('c')).toEqual({ cost: 'R$ 18,90', inPantry: false });
  });

  it('histórico carregado e sem nada que tenha acabado: o selo aparece', async () => {
    expect(await mountOpen()).toContain('Na despensa: Café Pilão 500g. Se já acabou, dê baixa lá.');
    expect(mockSeen.hints?.get('c')).toEqual({ cost: 'R$ 18,90', inPantry: true });
  });

  it.each([
    ['a busca falhou', failed],
    ['a primeira busca ainda anda', onTheWay],
    ['sem internet e nunca visto', paused],
  ])('sem o histórico (%s), nenhum selo: não dá para saber o que acabou', async (_why, state) => {
    mockQueries.purchases = state();
    const page = await mountOpen();
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
    await mountOpen();
    expect(mockSeen.hints?.get('q')).toEqual({ cost: '~R$ 72,90', inPantry: false });
    expect(await detailFacts()).toContain('O preço é por kg: a conta da lista usa 1 kg (o histórico de compras não carregou).');
  });

  it('a primeira busca do histórico ainda anda: a lista não espera, e ainda não diz nada disso', async () => {
    mockQueries.purchases = onTheWay();
    expect(await mountOpen()).not.toContain('histórico de compras não carregou');
    expect(mockSeen.hints?.get('q')).toEqual({ cost: '~R$ 72,90', inPantry: false });
    expect((await detailFacts()).join('\n')).not.toContain('histórico de compras não carregou');
  });

  it('histórico carregado sem nenhuma compra do queijo a peso: o 1 kg de sempre, sem o aviso', async () => {
    mockQueries.purchases = loaded([]);
    await mountOpen();
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
    const page = await mountOpen();
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
    expect(await mountOpen()).not.toContain('Na despensa');
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
    expect(await mountOpen()).not.toContain('Na despensa');
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
    const page = await mountOpen();
    expect(page).toContain('todos os itens têm preço');
    expect(page).not.toContain('Não deu para conferir');
  });

  it.each([
    ['a busca das ligações falhou', 'links', failed],
    ['sem internet e as ligações nunca vistas', 'links', paused],
  ])('%s: o cartão diz que não deu para conferir o item sem preço', async (_why, key, state) => {
    mockQueries[key] = state();
    const page = await mountOpen();
    expect(page).toContain('1 de 2 itens tem preço. O outro fica fora da conta.');
    expect(page).toContain(unchecked);
  });

  it('a busca dos produtos falhou: o item digitado com o nome do produto fica sem preço, e o cartão avisa', async () => {
    mockQueries.items = loaded([listItem('c', 'café pilão 500g', null), listItem('a', 'Arroz', 'arroz')]);
    mockQueries.links = loaded(new LinkIndex([]));
    expect(await mountOpen()).toContain('todos os itens têm preço');
    await act(async () => renderer?.unmount());
    mockQueries.products = failed();
    expect(await mountOpen()).toContain(unchecked);
  });

  it('nenhum item com preço e as ligações não chegaram: o cartão aparece só para dizer isso', async () => {
    mockQueries.items = loaded([listItem('c', 'Café', null), listItem('l', 'Leite', null)]);
    mockQueries.links = failed();
    expect(await mountOpen()).toContain('Não deu para conferir se os itens da lista já têm preço. Puxe a lista para baixo para tentar de novo.');
    await act(async () => renderer?.unmount());
    // Carregadas e sem ligação nenhuma: são só itens sem preço, e não há o que avisar.
    mockQueries.links = loaded(new LinkIndex([]));
    expect(await mountOpen()).not.toContain('Não deu para conferir');
  });

  it('a primeira busca ainda anda: nada a avisar', async () => {
    mockQueries.links = onTheWay();
    const page = await mountOpen();
    expect(page).toContain('1 de 2 itens tem preço');
    expect(page).not.toContain('Não deu para conferir');
  });

  it('não chegaram, mas todo item tem preço: nada a conferir', async () => {
    mockQueries.items = loaded([listItem('a', 'Arroz', 'arroz')]);
    mockQueries.links = failed();
    expect(await mountOpen()).not.toContain('Não deu para conferir');
  });

  it('puxar para atualizar busca de novo as ligações e os produtos', async () => {
    await mountOpen();
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
    const page = await mountOpen();
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
    const page = await mountOpen();
    expect(page).toContain('1 de 2 itens tem preço');
    expect(page).not.toContain(notice);
    expect(mockSeen.hints?.has('f')).toBe(false);
  });

  it('sem os preços da casa carregados, nada de outras casas: eles ocupariam o lugar dos dela', async () => {
    mockQueries.shared = loaded([seen('feijao', 8.5, 2), seen('arroz', 19.9, 1)]);
    mockQueries.prices = failed();
    expect(await mountOpen()).not.toContain(notice);
    expect(mockSeen.hints?.has('a')).toBe(false);
    expect(mockSeen.hints?.has('f')).toBe(false);
  });

  it('sem os mercados da casa carregados, nada de outras casas: não dá para saber quais são dela', async () => {
    mockQueries.shared = loaded([seen('feijao', 8.5, 2)]);
    mockQueries.stores = failed();
    expect(await mountOpen()).not.toContain(notice);
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

  /** O botão de pôr o que foi digitado ('Adicionar "Arroz" · 2 kg'). */
  const addButton = () => renderer!.root.findAll((node) => node.type === Button && String(node.props.title).startsWith('Adicionar "'))[0];
  /** Toca em "Adicionar" com o texto digitado; `title`, o que o botão tem de dizer antes. */
  const addTyped = (title?: string) =>
    act(async () => {
      if (title !== undefined) expect(addButton().props.title).toBe(title);
      await addButton().props.onPress();
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
    // Com a quantidade digitada no texto, somar grava a soma pela fila (vale sem internet) e libera o campo.
    type('3 café');
    await addTyped('Adicionar "Café" · 3 un');
    expect(repeatSheet().props.message).toBe('Café já está na lista (1 un). Somar mais 3 un?');
    choose('Somar: fica 4 un');
    expect(mockQueue.edit).toHaveBeenCalledWith({ id: 'b', listId: 'l1', userId: 'u1', values: { quantity: 4 } }, expect.anything());
    expect(mockQueue.add).not.toHaveBeenCalled();
    expect(fieldValue()).toBe('');
    expect(notify).not.toHaveBeenCalled();
    expect(askYesNo).not.toHaveBeenCalled();
    // Outro tipo do mesmo item entra sem perguntar.
    type('Leite integral');
    await addTyped('Adicionar "Leite integral"');
    expect(mockQueue.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'Leite integral' }), 'u1');
  });

  it('em outra unidade não soma: a pessoa põe como outro item ou deixa como está', async () => {
    mockQueries.items = loaded([{ ...listItem('a', 'Arroz', null, 'graos'), quantity: 2 }]);
    await mount();
    mockQueue.edit.mockClear();
    type('5 kg arroz');
    await addTyped('Adicionar "Arroz" · 5 kg');
    expect(repeatSheet().props.message).toBe('Arroz já está na lista com 2 un, e 5 kg é outra unidade. Pôr como outro item ou deixar como está?');
    expect(repeatChoices()).toEqual(['Pôr 5 kg como outro item']);
    act(() => repeatSheet().props.onClose());
    expect(mockQueue.add).not.toHaveBeenCalled();
    expect(mockQueue.edit).not.toHaveBeenCalled();
    type('Arroz (5 kg)');
    await addTyped('Adicionar "Arroz" · 5 kg');
    choose('Pôr 5 kg como outro item');
    expect(mockQueue.add).toHaveBeenCalledWith({ name: 'Arroz', category: 'graos', productId: null, quantity: 5, unit: 'kg' }, 'u1');
    expect(mockQueue.edit).not.toHaveBeenCalled();
    expect(fieldValue()).toBe('');
  });

  it('digitado com outro nome do item pendente: somar, pôr também ou deixar, e deixando o texto não some', async () => {
    mockQueries.items = loaded([listItem('a', 'Leite IL Desnatado', 'il', 'laticinios')]);
    await mount();
    type('Leite desnatado');
    await addTyped('Adicionar "Leite desnatado"');
    expect(repeatSheet().props.message).toBe('Leite IL Desnatado já está na lista (1 un). Somar mais 1 un?');
    expect(repeatChoices()).toEqual(['Somar: fica 2 un', 'Pôr "Leite desnatado" como outro item']);
    act(() => repeatSheet().props.onClose());
    expect(mockQueue.add).not.toHaveBeenCalled();
    expect(fieldValue()).toBe('Leite desnatado');
    await addTyped('Adicionar "Leite desnatado"');
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
    type('3 café');
    await addTyped('Adicionar "Café" · 3 un');
    expect(repeatChoices()).toEqual(['Somar: fica 4 un']);
    // Com a pergunta aberta, outra pessoa pôs 2: a pergunta e a soma acompanham.
    rerender([{ ...coffee, quantity: 2 }]);
    expect(repeatSheet().props.message).toBe('Café já está na lista (2 un). Somar mais 3 un?');
    choose('Somar: fica 5 un');
    expect(mockQueue.edit).toHaveBeenCalledWith({ id: 'b', listId: 'l1', userId: 'u1', values: { quantity: 5 } }, expect.anything());
    expect(mockQueue.add).not.toHaveBeenCalled();

    // Foi para o carrinho entre a pergunta e o toque: a quantidade entra como item novo, e o do carrinho fica como está.
    rerender([coffee]);
    type('café x3');
    await addTyped('Adicionar "Café" · 3 un');
    const sum = (repeatSheet().props.actions as SheetAction[])[0];
    rerender([{ ...coffee, checked_at: '2026-10-23T10:00:00Z' }]);
    act(() => sum.onPress());
    expect(mockQueue.edit).toHaveBeenCalledTimes(1);
    // O nome lido como na colagem: a primeira letra maiúscula.
    expect(mockQueue.add).toHaveBeenCalledWith({ name: 'Café', category: 'cafe_cha', productId: null, quantity: 3, unit: 'un' }, 'u1');

    // Saiu da lista: também entra como item novo.
    mockQueue.add.mockClear();
    act(() => repeatSheet().props.onClose());
    rerender([coffee]);
    type('café (3)');
    await addTyped('Adicionar "Café" · 3 un');
    const again = (repeatSheet().props.actions as SheetAction[])[0];
    rerender([]);
    act(() => again.onPress());
    expect(mockQueue.edit).toHaveBeenCalledTimes(1);
    expect(mockQueue.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'Café', quantity: 3 }), 'u1');
  });

  it('sem quantidade na linha, o 1 un de sempre conta como pedido: o item em outra unidade pergunta, como quando o campo começava em 1', async () => {
    mockQueries.items = loaded([{ ...listItem('a', 'Leite', null, 'laticinios'), quantity: 2, unit: 'l' }]);
    await mount();
    for (const text of ['Leite', '1 leite']) {
      type(text);
      await addTyped('Adicionar "Leite"');
      expect(notify).not.toHaveBeenCalled();
      expect(repeatSheet().props.message).toBe('Leite já está na lista com 2 l, e 1 un é outra unidade. Pôr como outro item ou deixar como está?');
      expect(repeatChoices()).toEqual(['Pôr 1 un como outro item']);
      expect(mockQueue.add).not.toHaveBeenCalled();
      // Deixar como está: nada entra, e o campo fica livre, como antes.
      act(() => repeatSheet().props.onClose());
      expect(fieldValue()).toBe('');
    }
    // A caixa de 1 un entra como outro item, sem a pessoa precisar saber de digitar a quantidade.
    type('Leite');
    await addTyped('Adicionar "Leite"');
    choose('Pôr 1 un como outro item');
    expect(mockQueue.add).toHaveBeenCalledWith({ name: 'Leite', category: 'laticinios', productId: null, quantity: 1, unit: 'un' }, 'u1');
    expect(fieldValue()).toBe('');
  });

  it('a sugestão da busca e o item comum sem quantidade também perguntam, com a unidade deles, quando o item está em outra', async () => {
    mockQueries.items = loaded([
      { ...listItem('a', 'Leite IL Desnatado', 'il', 'laticinios'), quantity: 2, unit: 'l' },
      { ...listItem('b', 'Banana', null, 'hortifruti'), quantity: 3, unit: 'un' },
    ]);
    mockQueries.products = loaded([MILK]);
    await mount();
    type('leite');
    const row = renderer!.root.findAllByType(ListRow).find((r) => r.props.subtitle === 'Produto com histórico de preço')!;
    act(() => row.props.onPress());
    expect(notify).not.toHaveBeenCalled();
    expect(repeatSheet().props.message).toBe(
      'Leite IL Desnatado já está na lista com 2 l, e 1 un é outra unidade. Pôr como outro item ou deixar como está?',
    );
    expect(repeatChoices()).toEqual(['Pôr 1 un como outro item']);
    act(() => repeatSheet().props.onClose());

    // O item comum vai na unidade do catálogo (a banana, em kg), que também é um pedido.
    type('banan');
    const banana = renderer!.root.findAllByType(ListRow).find((r) => r.props.title === 'Banana')!;
    act(() => banana.props.onPress());
    expect(notify).not.toHaveBeenCalled();
    expect(repeatSheet().props.message).toBe('Banana já está na lista com 3 un, e 1 kg é outra unidade. Pôr como outro item ou deixar como está?');
    choose('Pôr 1 kg como outro item');
    expect(mockQueue.add).toHaveBeenCalledWith({ name: 'Banana', category: 'hortifruti', productId: null, quantity: 1, unit: 'kg' }, 'u1');

    // Com a quantidade digitada na unidade do pendente, soma: a unidade digitada vale também no item comum.
    mockQueue.add.mockClear();
    type('2 banan');
    act(() => renderer!.root.findAllByType(ListRow).find((r) => r.props.title === 'Banana')!.props.onPress());
    expect(repeatSheet().props.message).toBe('Banana já está na lista (3 un). Somar mais 2 un?');
    expect(repeatChoices()).toEqual(['Somar: fica 5 un']);
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('uma pergunta nova com a anterior ainda aberta (um menu que não apareceu) monta um menu novo, com o item novo', async () => {
    mockQueries.items = loaded([listItem('a', 'Arroz', null, 'graos'), listItem('b', 'Café', null, 'cafe_cha')]);
    await mount();
    type('Arroz');
    await addTyped('Adicionar "Arroz"');
    const before = repeatSheet();
    type('Café');
    await addTyped('Adicionar "Café"');
    expect(repeatSheet()).not.toBe(before);
    expect(repeatSheet().props).toMatchObject({ visible: true, message: 'Café já está na lista (1 un). Somar mais 1 un?' });
  });

  it('duas marcas digitadas de propósito entram as duas, sem perguntar', async () => {
    mockQueries.items = loaded([listItem('a', 'Biscoito Oreo', null, 'doces'), listItem('b', 'Shampoo Seda', null, 'higiene')]);
    await mount();
    type('Biscoito Passatempo');
    await addTyped('Adicionar "Biscoito Passatempo"');
    type('Shampoo Clear Men');
    await addTyped('Adicionar "Shampoo Clear Men"');
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
  const scanButton = () => renderer!.root.findAll((node) => node.type === Button && node.props.accessibilityLabel === BARCODE_BUTTON.label)[0];

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

  it('o mesmo item em outra unidade: pergunta se a embalagem lida entra como outro item, e não só avisa', async () => {
    mockBarcode.available = true;
    mockQueries.items = loaded([{ ...listItem('a', 'Leite desnatado', null, 'laticinios'), quantity: 2, unit: 'l' }]);
    await mount();
    await act(async () => mockBarcode.onProduct!(MILK));
    expect(notify).not.toHaveBeenCalled();
    expect(repeatChoices()).toEqual(['Pôr 1 un como outro item']);
    choose('Pôr 1 un como outro item');
    expect(mockQueue.add).toHaveBeenCalledWith({ name: 'Leite desnatado', category: 'laticinios', productId: 'il', quantity: 1, unit: 'un' }, 'u1');
  });

  it('o que se digita enquanto o código ainda é procurado no banco é o próximo item: não é a quantidade do lido, e fica no campo', async () => {
    const field = () => renderer!.root.findAllByType(TextField).find((entry) => entry.props.placeholder === ADD_FIELD_PLACEHOLDER)!;
    mockBarcode.available = true;
    await mount();
    act(() => scanButton().props.onPress());
    // A câmera fechou; o código ainda não voltou do banco, e a pessoa já escreve o próximo item.
    act(() => field().props.onChangeText('2 kg arroz'));
    await act(async () => mockBarcode.onProduct!(MILK));
    expect(mockQueue.add).toHaveBeenCalledTimes(1);
    expect(mockQueue.add).toHaveBeenCalledWith({ name: 'Leite desnatado', category: 'laticinios', productId: 'il', quantity: 1, unit: 'un' }, 'u1');
    expect(field().props.value).toBe('2 kg arroz');
    await act(async () => renderer!.unmount());
    // Também quando o lido já está na lista em outra unidade: "Pôr 1 un como outro item" não apaga o campo.
    mockQueue.add.mockClear();
    mockQueries.items = loaded([{ ...listItem('a', 'Leite desnatado', null, 'laticinios'), quantity: 2, unit: 'l' }]);
    await mount();
    act(() => scanButton().props.onPress());
    act(() => field().props.onChangeText('2 kg arroz'));
    await act(async () => mockBarcode.onProduct!(MILK));
    expect(repeatChoices()).toEqual(['Pôr 1 un como outro item']);
    choose('Pôr 1 un como outro item');
    expect(mockQueue.add).toHaveBeenCalledWith({ name: 'Leite desnatado', category: 'laticinios', productId: 'il', quantity: 1, unit: 'un' }, 'u1');
    expect(field().props.value).toBe('2 kg arroz');
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

    it('o texto que o app mandou desta lista, colado de volta: as descrições saem, e só o que foi acrescentado entra', async () => {
      // Mandada a quem não tem o app, que acrescenta o café e manda de volta. As descrições (também a que decide o que
      // se pode comprar, "sem lactose") vêm entre parênteses no texto, e não no nome do que está na lista.
      const listed = [
        { ...listItem('l', 'Leite', null, 'laticinios'), quantity: 2, notes: 'sem lactose' },
        { ...listItem('p', 'Pão de forma', null, 'padaria'), notes: 'o integral' },
        { ...listItem('r', 'Refrigerante', null, 'bebidas'), notes: 'zero', priority: 'urgente' as const },
      ];
      mockQueries.items = loaded(listed);
      await mount();
      open();
      const text = listShareText({ name: 'Mercado' }, listed)!;
      expect(text).toContain('- 2 un Leite (sem lactose)');
      act(() => pasteField().props.onChangeText(`${text}\n- Café`));
      expect(modalButton(/^Adicionar/).props.title).toBe('Adicionar 1 item');
      act(() => modalButton(/^Adicionar/).props.onPress());
      expect(mockQueue.add.mock.calls).toEqual([[{ name: 'Café', category: 'cafe_cha', productId: null, quantity: 1, unit: 'un' }, 'u1']]);
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

describe('a quantidade vem do que se digita, lida como no "Colar lista"', () => {
  const MILK = { ...product('il', 'Leite IL Desnatado'), category: 'laticinios' } as Product;
  const field = () => renderer!.root.findAllByType(TextField).find((entry) => entry.props.placeholder === ADD_FIELD_PLACEHOLDER)!;
  const type = (text: string) => act(() => field().props.onChangeText(text));
  const submit = () => act(() => field().props.onSubmitEditing());
  const addButtons = () => renderer!.root.findAll((node) => node.type === Button && String(node.props.title).startsWith('Adicionar "'));
  /** O cartão de pôr item: o que tem o campo. */
  const addCard = () => renderer!.root.findAllByType(Card).find((card) => card.findAllByType(TextField).length > 0)!;
  /** A linha de "Colar lista" e do código de barras. */
  const toolRow = () =>
    renderer!.root.findAllByType(Row).find((row) => row.findAllByType(Button).some((entry) => entry.props.title === 'Colar lista'));
  const suggestion = (title: string) => renderer!.root.findAllByType(ListRow).find((row) => row.props.title === title);
  const barcodeButton = () =>
    renderer!.root.findAll((node) => node.type === Button && node.props.accessibilityLabel === BARCODE_BUTTON.label)[0];

  beforeEach(() => {
    mockQueue.add.mockClear();
    jest.mocked(notify).mockClear();
  });

  it('o cartão tem um campo só, com o exemplo da quantidade: sem o campo da quantidade nem as unidades', async () => {
    await mount();
    expect(addCard().findAllByType(TextField)).toHaveLength(1);
    expect(addCard().findAllByType(Chip)).toHaveLength(0);
    expect(field().props.placeholder).toBe('Adicionar (ex.: 2 kg arroz)');
    expect(field().props.accessibilityLabel).toBeUndefined();
  });

  it('"2 kg arroz" põe 2 kg de Arroz, e o botão diz antes o que vai entrar; o Enter faz o mesmo', async () => {
    await mount();
    await type('2 kg arroz');
    const [add] = addButtons();
    expect(add.props.title).toBe('Adicionar "Arroz" · 2 kg');
    expect(add.props.accessibilityLabel).toBe('Adicionar Arroz, 2 kg');
    await act(async () => add.props.onPress());
    expect(mockQueue.add).toHaveBeenCalledWith({ name: 'Arroz', category: 'graos', productId: null, quantity: 2, unit: 'kg' }, 'u1');
    expect(field().props.value).toBe('');
    for (const [text, item] of [
      ['500 g queijo', { name: 'Queijo', quantity: 500, unit: 'g' }],
      ['1 dz ovos', { name: 'Ovos', quantity: 12, unit: 'un' }],
      ['2 pacotes de macarrão', { name: 'Macarrão', quantity: 2, unit: 'un' }],
      ['½ kg presunto', { name: 'Presunto', quantity: 0.5, unit: 'kg' }],
      ['leite x2', { name: 'Leite', quantity: 2, unit: 'un' }],
      ['detergente', { name: 'Detergente', quantity: 1, unit: 'un' }],
    ] as const) {
      await type(text);
      await submit();
      expect(mockQueue.add).toHaveBeenLastCalledWith(expect.objectContaining(item), 'u1');
    }
  });

  it('o tamanho que é parte do nome fica no nome, como na colagem', async () => {
    await mount();
    await type('Café Pilão 500g');
    expect(addButtons().map((entry) => entry.props.title)).toEqual(['Adicionar "Café Pilão 500g"']);
    await submit();
    expect(mockQueue.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'Café Pilão 500g', quantity: 1, unit: 'un' }), 'u1');
  });

  it('a linha que ainda não diz o que comprar ("2 kg") não põe nada, e o cartão não mostra as opções', async () => {
    await mount();
    await type('2 kg');
    expect(addButtons()).toHaveLength(0);
    expect(toolRow()).toBeUndefined();
    await submit();
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('as sugestões procuram o nome sem a quantidade, e a escolhida leva a quantidade digitada', async () => {
    mockQueries.products = loaded([MILK]);
    await mount();
    await type('2 leite');
    // A linha de baixo diz quanto o toque põe, como o botão de pôr.
    expect(suggestion('Leite desnatado')?.props.subtitle).toBe('Produto com histórico de preço · 2 un');
    expect(suggestion('Leite desnatado')?.props.accessibilityLabel).toBe('Leite desnatado, Produto com histórico de preço, 2 un');
    await act(async () => suggestion('Leite desnatado')!.props.onPress());
    expect(mockQueue.add).toHaveBeenLastCalledWith({ name: 'Leite desnatado', category: 'laticinios', productId: 'il', quantity: 2, unit: 'un' }, 'u1');
    // O item comum leva a quantidade inteira que foi digitada.
    await type('2 kg banan');
    expect(suggestion('Banana')?.props.subtitle).toBe('Frutas e verduras · 2 kg');
    await act(async () => suggestion('Banana')!.props.onPress());
    expect(mockQueue.add).toHaveBeenLastCalledWith({ name: 'Banana', category: 'hortifruti', productId: null, quantity: 2, unit: 'kg' }, 'u1');
    // Sem quantidade, 1 na unidade do catálogo, como antes, e a linha de sempre.
    await type('banan');
    expect(suggestion('Banana')?.props.subtitle).toBe('Frutas e verduras');
    expect(suggestion('Banana')?.props.accessibilityLabel).toBeUndefined();
    await act(async () => suggestion('Banana')!.props.onPress());
    expect(mockQueue.add).toHaveBeenLastCalledWith({ name: 'Banana', category: 'hortifruti', productId: null, quantity: 1, unit: 'kg' }, 'u1');
  });

  it('ovos digitados no item que já diz quantos vêm ("Ovos (30 un)") são cartelas, e não cartelas de cartelas; a linha diz antes', async () => {
    await mount();
    for (const [text, name, quantity] of [
      ['30 ovos', 'Ovos (30 un)', 1],
      ['1 dz ovos', 'Ovos (dúzia)', 1],
      ['2 dz ovos', 'Ovos (dúzia)', 2],
      ['60 ovos', 'Ovos (30 un)', 2],
      ['1 dz ovos', 'Ovos (30 un)', 1],
    ] as const) {
      await type(text);
      expect(suggestion(name)?.props.subtitle).toBe(`Ovos · ${quantity} un`);
      await act(async () => suggestion(name)!.props.onPress());
      expect(mockQueue.add).toHaveBeenLastCalledWith({ name, category: 'ovos', productId: null, quantity, unit: 'un' }, 'u1');
    }
    // Poucas unidades já são cartelas, como na conta da lista: "2 ovos" no "Ovos (dúzia)" são duas dúzias.
    await type('2 ovos');
    await act(async () => suggestion('Ovos (dúzia)')!.props.onPress());
    expect(mockQueue.add).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Ovos (dúzia)', quantity: 2, unit: 'un' }), 'u1');
  });

  it('o produto de ovos sem a conta no nome leva os ovos digitados; o código lido não leva o que se digitou depois', async () => {
    const EGGS = { ...product('ov', 'Ovos Brancos Mantiqueira'), category: 'ovos' } as Product;
    mockQueries.products = loaded([EGGS]);
    mockBarcode.available = true;
    await mount();
    await type('30 ovos');
    const [row] = renderer!.root.findAllByType(ListRow).filter((entry) => entry.props.subtitle === 'Produto com histórico de preço · 30 un');
    expect(row).toBeDefined();
    await act(async () => row.props.onPress());
    expect(mockQueue.add).toHaveBeenLastCalledWith(expect.objectContaining({ productId: 'ov', quantity: 30, unit: 'un' }), 'u1');
    // O código lido, na ordem em que a tela deixa: o botão só aparece com o campo vazio, a câmera fecha antes de o
    // código voltar do banco, e o que se digita nesse meio-tempo é o próximo item. A embalagem lida entra com 1 un, e
    // os ovos digitados ficam no campo, para entrar depois como eles mesmos.
    mockQueue.add.mockClear();
    mockBarcode.start.mockClear();
    expect(field().props.value).toBe('');
    act(() => barcodeButton().props.onPress());
    expect(mockBarcode.start).toHaveBeenCalledTimes(1);
    await type('30 ovos');
    expect(barcodeButton()).toBeUndefined();
    await act(async () => mockBarcode.onProduct!(EGGS));
    expect(mockQueue.add).toHaveBeenCalledTimes(1);
    expect(mockQueue.add).toHaveBeenLastCalledWith(expect.objectContaining({ productId: 'ov', quantity: 1, unit: 'un' }), 'u1');
    expect(field().props.value).toBe('30 ovos');
    await submit();
    expect(mockQueue.add).toHaveBeenLastCalledWith({ name: 'Ovos', category: 'ovos', productId: null, quantity: 30, unit: 'un' }, 'u1');
  });

  it('ovos digitados no item de ovos que já está na lista em cartelas somam cartelas, e não ovos', async () => {
    // Sem a marca, o produto é o item "Ovos": o mesmo da lista.
    const EGGS = { ...product('ov', 'Ovos Mantiqueira'), category: 'ovos' } as Product;
    mockQueries.products = loaded([EGGS]);
    const pick = async () => {
      const [row] = renderer!.root
        .findAllByType(ListRow)
        .filter((entry) => String(entry.props.subtitle).startsWith('Produto com histórico de preço · '));
      await act(async () => row.props.onPress());
    };
    for (const [listed, text, via, adds, total] of [
      ['Ovos (30 un)', '30 ovos', 'campo', '1 un', '2 un'],
      ['Ovos (30 un)', '60 ovos', 'campo', '2 un', '3 un'],
      ['Ovos (dúzia)', '1 dz ovos', 'campo', '1 un', '2 un'],
      ['Ovos (dúzia)', '30 ovos', 'campo', '3 un', '4 un'],
      ['Ovos (30 un)', '30 ovos', 'produto', '1 un', '2 un'],
      ['Ovos (30 un)', '60 ovos', 'produto', '2 un', '3 un'],
    ] as const) {
      mockQueue.add.mockClear();
      mockQueue.edit.mockClear();
      mockQueries.items = loaded([{ ...listItem('o', listed, null, 'ovos') }]);
      await mount();
      await type(text);
      if (via === 'campo') await submit();
      else await pick();
      expect(mockQueue.add).not.toHaveBeenCalled();
      expect(repeatSheet().props.message).toBe(`${listed} já está na lista (1 un). Somar mais ${adds}?`);
      expect(repeatChoices()[0]).toBe(`Somar: fica ${total}`);
      choose(`Somar: fica ${total}`);
      expect(mockQueue.edit).toHaveBeenCalledWith(expect.objectContaining({ id: 'o', values: { quantity: Number(total.split(' ')[0]) } }), expect.anything());
      await act(async () => renderer!.unmount());
    }
    // O código lido não leva a linha: com o campo vazio quando a câmera abriu, o que se digita enquanto o código ainda
    // é procurado no banco é o próximo item. A embalagem lida soma 1 un (e não as 2 cartelas de "60 ovos"), e o campo
    // fica com o que foi digitado, ao somar e ao deixar como está.
    mockBarcode.available = true;
    for (const answer of ['Somar: fica 2 un', null] as const) {
      mockQueue.add.mockClear();
      mockQueue.edit.mockClear();
      mockQueries.items = loaded([{ ...listItem('o', 'Ovos (30 un)', null, 'ovos') }]);
      await mount();
      act(() => barcodeButton().props.onPress());
      await type('60 ovos');
      await act(async () => mockBarcode.onProduct!(EGGS));
      expect(mockQueue.add).not.toHaveBeenCalled();
      expect(repeatSheet().props.message).toBe('Ovos (30 un) já está na lista (1 un). Somar mais 1 un?');
      expect(repeatChoices()).toEqual(['Somar: fica 2 un']);
      if (answer) {
        choose(answer);
        expect(mockQueue.edit).toHaveBeenCalledWith(expect.objectContaining({ id: 'o', values: { quantity: 2 } }), expect.anything());
      } else act(() => repeatSheet().props.onClose());
      expect(field().props.value).toBe('60 ovos');
      await act(async () => renderer!.unmount());
    }
    mockBarcode.available = false;
    // Pôr como outro item leva o que foi digitado: "Ovos", 30 un, trinta ovos.
    mockQueries.items = loaded([{ ...listItem('o', 'Ovos (30 un)', null, 'ovos') }]);
    await mount();
    await type('30 ovos');
    await submit();
    expect(repeatChoices()).toEqual(['Somar: fica 2 un', 'Pôr "Ovos" como outro item']);
    choose('Pôr "Ovos" como outro item');
    expect(mockQueue.add).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Ovos', quantity: 30, unit: 'un' }), 'u1');
    // Fora dos ovos, a soma é a quantidade digitada, como sempre.
    await act(async () => renderer!.unmount());
    mockQueries.items = loaded([{ ...listItem('a', 'Arroz', null, 'graos'), unit: 'kg' }]);
    await mount();
    await type('2 kg arroz');
    await submit();
    expect(repeatChoices()).toEqual(['Somar: fica 3 kg']);
  });

  it('a observação que diz o que se pode comprar fica no nome: "Leite (sem lactose)" não soma no "Leite" da lista', async () => {
    mockQueries.items = loaded([{ ...listItem('l', 'Leite', null, 'laticinios') }]);
    await mount();
    await type('Leite (sem lactose)');
    expect(addButtons().map((entry) => entry.props.title)).toEqual(['Adicionar "Leite (sem lactose)"']);
    await submit();
    expect(renderer!.root.findAllByType(ActionSheet).some((sheet) => sheet.props.title === 'Já está na lista' && sheet.props.visible)).toBe(false);
    expect(mockQueue.add).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Leite (sem lactose)', quantity: 1, unit: 'un' }), 'u1');
    // A observação que não decide nada sai, como na colagem, e o item repetido pergunta.
    mockQueue.add.mockClear();
    await type('Leite (o de caixinha)');
    expect(addButtons().map((entry) => entry.props.title)).toEqual(['Adicionar "Leite"']);
    await submit();
    expect(mockQueue.add).not.toHaveBeenCalled();
    expect(repeatSheet().props.visible).toBe(true);
  });

  it('a unidade digitada também vale: no produto (que não tem unidade) e no item comum (no lugar da do catálogo)', async () => {
    mockQueries.products = loaded([MILK]);
    await mount();
    await type('2 l leite');
    await act(async () => suggestion('Leite desnatado')!.props.onPress());
    expect(mockQueue.add).toHaveBeenLastCalledWith({ name: 'Leite desnatado', category: 'laticinios', productId: 'il', quantity: 2, unit: 'l' }, 'u1');
    // A banana do catálogo é em kg; "500 g" fica em gramas, e não vira 500 kg.
    await type('500 g banan');
    await act(async () => suggestion('Banana')!.props.onPress());
    expect(mockQueue.add).toHaveBeenLastCalledWith({ name: 'Banana', category: 'hortifruti', productId: null, quantity: 500, unit: 'g' }, 'u1');
    // E a unidade de sempre dita ("3 un") também, no lugar do kg do catálogo.
    await type('3 un banan');
    await act(async () => suggestion('Banana')!.props.onPress());
    expect(mockQueue.add).toHaveBeenLastCalledWith({ name: 'Banana', category: 'hortifruti', productId: null, quantity: 3, unit: 'un' }, 'u1');
  });

  it('"Colar lista" e o código de barras dividem uma linha, embaixo dos itens comuns; sem o código, colar sozinho', async () => {
    mockBarcode.available = true;
    await mount();
    const tools = toolRow()!.findAllByType(Button);
    expect(tools.map((entry) => [entry.props.title, entry.props.accessibilityLabel, entry.props.variant, entry.props.compact])).toEqual([
      ['Colar lista', undefined, 'ghost', true],
      ['Código de barras', 'Ler código de barras', 'ghost', true],
    ]);
    // "Escolher dos itens comuns" fica na linha dele, antes.
    const titles = addCard().findAllByType(Button).map((entry) => entry.props.title);
    expect(titles).toEqual(['Escolher dos itens comuns', 'Colar lista', 'Código de barras']);
    await act(async () => renderer!.unmount());

    mockBarcode.available = false;
    await mount();
    expect(toolRow()!.findAllByType(Button).map((entry) => entry.props.title)).toEqual(['Colar lista']);
  });
});

describe('o cartão da conta, recolhido numa linha antes da lista', () => {
  const page = () => texts(renderer!.toJSON()).join('\n');

  beforeEach(() => {
    mockQueries.items = loaded([listItem('a', 'Arroz', 'arroz'), listItem('c', 'Café', 'cafe')]);
    mockQueries.products = loaded([product('arroz', 'Arroz'), product('cafe', 'Café')]);
    mockQueries.prices = loaded([latest('arroz', 25), latest('cafe', 18.9)]);
  });

  it('recolhido ao abrir: o total e o "i"; o "i" abre ali mesmo o resto, e fecha', async () => {
    const shown = await mount();
    expect(shown).toContain('A lista deve dar');
    expect(shown).toContain('~R$ 43,90');
    expect(shown).not.toContain('Pelo último preço');
    expect(shown).not.toContain('Onde você está comprando?');
    const more = estimateMore()!;
    expect(more.props).toMatchObject({ icon: 'information-outline', label: 'Mais sobre a conta da lista', expanded: false });
    const open = await openEstimate();
    expect(estimateMore()!.props.expanded).toBe(true);
    expect(open).toContain('~R$ 43,90');
    expect(open).toContain('Pelo último preço que a casa pagou em cada item; todos os itens têm preço.');
    expect(open).toContain('Onde você está comprando?');
    await act(async () => estimateMore()!.props.onPress());
    expect(estimateMore()!.props.expanded).toBe(false);
    expect(page()).not.toContain('Pelo último preço');
  });

  it('com item no carrinho, a conta do carrinho e do que falta fica no "i", e não na linha recolhida', async () => {
    mockQueries.items = loaded([listItem('a', 'Arroz', 'arroz'), { ...listItem('c', 'Café', 'cafe'), checked_at: new Date().toISOString() }]);
    const shown = await mount();
    expect(shown).toContain('~R$ 43,90');
    expect(shown).not.toContain('No carrinho: ~');
    expect(shown).not.toContain('Falta comprar: ~');
    const open = await openEstimate();
    expect(open).toContain('No carrinho: ~R$ 18,90. Falta comprar: ~R$ 25,00.');
    await act(async () => estimateMore()!.props.onPress());
    expect(page()).not.toContain('No carrinho: ~');
  });

  it('o que está no carrinho sem preço também só aparece no "i"', async () => {
    mockQueries.items = loaded([listItem('a', 'Arroz', 'arroz'), { ...listItem('f', 'Feijão', null), checked_at: new Date().toISOString() }]);
    const shown = await mount();
    expect(shown).not.toContain('ainda não tem preço');
    expect(await openEstimate()).toContain('Falta comprar: ~R$ 25,00. O que está no carrinho ainda não tem preço.');
  });

  it('com o lugar escolhido, a linha recolhida diz qual, para o número não ser lido errado', async () => {
    await mount();
    await act(async () => storePicker().props.onChangeStore('s1'));
    expect(page()).toContain('Lugar escolhido: Assaí');
    // Aberto, a frase de baixo já diz o lugar: a linha não repete.
    const open = await openEstimate();
    expect(open).toContain('Lugar escolhido: Assaí. Todos os itens têm preço.');
    expect(open.split('Lugar escolhido').length - 1).toBe(1);
    await act(async () => storePicker().props.onChangeStore(null));
  });

  it('com preço de outras casas na conta, a linha recolhida diz que ele está lá; o aviso inteiro fica no "i"', async () => {
    const CNPJ = '11222333000181';
    mockQueries.stores = loaded([{ id: 's1', name: 'Assaí', cnpj: CNPJ, address: null }]);
    mockQueries.prices = loaded([latest('arroz', 25)]);
    mockQueries.shared = loaded([
      { product_id: 'cafe', store_cnpj: CNPJ, store_name: 'ASSAI ATACADISTA', store_uf: '35', unit: 'un', unit_price: 18.9, seen_on: day(2), mine: true },
    ] satisfies SharedPrice[]);
    const shown = await mount();
    expect(shown).toContain('~R$ 43,90');
    expect(shown).toContain('Inclui preços de outras casas');
    expect(shown).not.toContain(SHARED_PRICES_NOTICE);
    const open = await openEstimate();
    expect(open).toContain(SHARED_PRICES_NOTICE);
    expect(open).toContain('R$ 18,90 do total é de 1 item com preço de outras casas');
  });

  it('sem item com preço, uma linha curta com o mesmo "i": o que está na despensa', async () => {
    mockQueries.items = loaded([listItem('c', 'Café Pilão 500g', 'pilao')]);
    mockQueries.products = loaded([product('pilao', 'Café Pilão 500g')]);
    mockQueries.prices = loaded([]);
    mockQueries.pantry = loaded([pantryRow('Café Pilão 500g', 'pilao', 14)]);
    const shown = await mount();
    expect(shown).toContain('1 item da lista está na despensa.');
    expect(shown).not.toContain('Na despensa: Café Pilão 500g');
    expect(await openEstimate()).toContain('Na despensa: Café Pilão 500g. Se já acabou, dê baixa lá.');
  });

  it('sem item com preço, uma linha curta com o mesmo "i": os preços que não deu para conferir', async () => {
    mockQueries.items = loaded([listItem('c', 'Café', null), listItem('l', 'Leite', null)]);
    mockQueries.products = loaded([]);
    mockQueries.prices = loaded([]);
    mockQueries.links = failed();
    const shown = await mount();
    expect(shown).toContain('Não deu para conferir os preços.');
    expect(shown).not.toContain('Puxe a lista para baixo');
    expect(await openEstimate()).toContain('Não deu para conferir se os itens da lista já têm preço. Puxe a lista para baixo para tentar de novo.');
  });
});

describe('no computador: os itens numa coluna, o cartão de pôr item e a conta na outra', () => {
  const WINDOW = Dimensions.get('window');
  let web: { restore: () => void } | undefined;
  /** O navegador numa janela larga (ui/desktop). */
  async function desktop() {
    web = jest.replaceProperty(Platform, 'OS', 'web');
    await act(async () => Dimensions.set({ window: { ...WINDOW, width: 1440 } }));
  }
  /** As duas colunas na ordem em que aparecem: a do lado (primeiro no teclado e no leitor de tela) e a principal. */
  function columnParts() {
    const [row] = renderer!.root.findByType(Columns).findAll((node) => (node.type as unknown) === 'View', { deep: false });
    expect(StyleSheet.flatten(row.props.style)).toMatchObject({ flexDirection: 'row-reverse' });
    return row.children as ReactTestInstance[];
  }
  /** O que a tela desenha dentro das colunas, na ordem (no celular, solto, sem as caixas delas). */
  const parts = () => (renderer!.root.findByType(Columns).children as ReactTestInstance[]).map((child) => child.type);

  afterEach(async () => {
    web?.restore();
    web = undefined;
    await act(async () => Dimensions.set({ window: WINDOW }));
  });

  it('os itens na coluna principal; o cartão de pôr item, as faixas, a conta e a ida na do lado, que vem primeiro', async () => {
    await desktop();
    mockQueries.items = loaded([listItem('a', 'Arroz', 'arroz'), { ...listItem('b', 'Feijão', null), checked_at: minutesAgo(5) }]);
    mockQueries.products = loaded([product('arroz', 'Arroz')]);
    mockQueries.prices = loaded([latest('arroz', 25)]);
    await mount();
    expect(renderer!.root.findByType(Screen).props.wide).toBe(true);
    expect(renderer!.root.findByType(Columns).props.sideFirst).toBe(true);
    const [side, main] = columnParts();
    expect(side.findAll((node) => node.props.placeholder === ADD_FIELD_PLACEHOLDER).length).toBeGreaterThan(0);
    expect(side.findAllByType(ListEstimateCard)).toHaveLength(1);
    expect(side.findAllByType(MarketTripAction)).toHaveLength(1);
    expect(side.findAllByType(ShoppingGrid)).toHaveLength(0);
    expect(main.findAllByType(Section).map((section) => section.props.title)).toEqual(['Para comprar (1)', 'No carrinho (1)']);
    expect(main.findAllByType(ShoppingGrid)).toHaveLength(2);
    expect(main.findAllByType(ListEstimateCard)).toHaveLength(0);
  });

  it('montando, as faixas ficam com o cartão de pôr item; a lista vazia, na coluna dos itens', async () => {
    await desktop();
    await mount();
    const [side, main] = columnParts();
    expect(side.findAllByType(RestockStrip)).toHaveLength(1);
    expect(side.findAllByType(RecentPurchases)).toHaveLength(1);
    expect(main.findAllByType(EmptyState).map((entry) => entry.props.title)).toEqual(['Lista vazia']);
    expect(side.findAllByType(EmptyState)).toHaveLength(0);
  });

  it('montando com sugestões nas faixas, a lista vazia continua na coluna dos itens, e diz que elas estão ao lado', async () => {
    await desktop();
    mockQueries.purchases = loaded(ranOutHistory('Café', null));
    await mount();
    const [side, main] = columnParts();
    expect(mockSeen.restock?.map((i) => i.name)).toEqual(['Café']);
    expect(side.findAllByType(RestockStrip)).toHaveLength(1);
    expect(main.findAllByType(EmptyState).map((entry) => [entry.props.title, entry.props.message])).toEqual([
      ['Lista vazia', 'Digite um item no campo ao lado, escolha do catálogo de itens comuns ou toque numa das sugestões embaixo dele.'],
    ]);
    expect(side.findAllByType(EmptyState)).toHaveLength(0);
  });

  it('a lista vazia na própria ida fica na coluna dos itens, e diz que o campo está ao lado, e não acima', async () => {
    await desktop();
    mockTrips.list = [liveTrip()];
    await mount();
    const [side, main] = columnParts();
    expect(side.findAll((node) => node.props.placeholder === ADD_FIELD_PLACEHOLDER).length).toBeGreaterThan(0);
    expect(main.findAllByType(EmptyState).map((entry) => entry.props.message)).toEqual(['Digite no campo ao lado o que faltou.']);
  });

  it('a lista arquivada: o aviso de reabrir e a conta na do lado, os itens na principal', async () => {
    await desktop();
    mockQueries.list = loaded({ id: 'l1', name: 'Churrasco', kind: 'mercado', archived_at: '2026-10-20T12:00:00Z', created_at: '2026-10-01T12:00:00Z' });
    mockQueries.items = loaded([listItem('a', 'Arroz', 'arroz')]);
    mockQueries.prices = loaded([latest('arroz', 25)]);
    await mount();
    const [side, main] = columnParts();
    expect(side.findAllByType(Button).map((entry) => entry.props.title)).toEqual(['Reabrir lista']);
    expect(side.findAllByType(ListEstimateCard)).toHaveLength(1);
    expect(side.findAllByType(MarketTripAction)).toHaveLength(0);
    expect(main.findAllByType(ShoppingGrid).every((grid) => grid.props.readOnly)).toBe(true);
  });

  it('o botão do rodapé fica encostado à direita, embaixo da coluna do lado, como as ações da revisão da nota', async () => {
    await desktop();
    mockQueries.items = loaded([{ ...listItem('a', 'Arroz', 'arroz'), checked_at: minutesAgo(5) }]);
    await mount();
    const bar = renderer!.root.findByType(Screen).props.footer as ReactElement<{ end?: boolean; children: ReactElement<{ title: string }> }>;
    expect(bar.type).toBe(Actions);
    expect(bar.props.end).toBe(true);
    expect(bar.props.children.props.title).toBe('Finalizar compra');
  });

  it('o "Atualizar" do computador fica numa linha dele, e não por cima do cartão de pôr item da coluna do lado', async () => {
    await desktop();
    await mount();
    const button = renderer!.root.findAll((node) => node.props.accessibilityLabel === REFRESH_LABEL && typeof node.props.onPress === 'function')[0];
    expect(button).toBeDefined();
    const holders = renderer!.root
      .findAll((node) => (node.type as unknown) === 'View' && node.findAll((inner) => inner === button).length > 0)
      .map((node) => StyleSheet.flatten(node.props.style) ?? {});
    expect(holders[holders.length - 1]).toEqual({ alignSelf: 'flex-end' });
    expect(holders.some((style) => style.position === 'absolute')).toBe(false);
  });

  it('a janela do navegador que cruza a largura do computador não fecha as janelas abertas nem recolhe a conta', async () => {
    // Um iPad no Safari, de pé (820) e deitado (1180), ou a janela do computador redimensionada. As janelas ficam fora
    // das colunas, e o aberto da conta, na tela: nada disso depende das caixas das colunas (ui/desktop).
    web = jest.replaceProperty(Platform, 'OS', 'web');
    await act(async () => Dimensions.set({ window: { ...WINDOW, width: 820 } }));
    mockQueries.items = loaded([listItem('a', 'Arroz', 'arroz')]);
    mockQueries.products = loaded([product('arroz', 'Arroz')]);
    mockQueries.prices = loaded([latest('arroz', 25)]);
    mockBarcode.available = true;
    mockBarcode.element = <BarcodeSteps />;
    Object.assign(mockMounts, { barcode: 0, picker: 0, trip: 0 });
    await mount();
    await openEstimate();
    const chip = () => renderer!.root.findAllByType(Chip).find((entry) => entry.props.label === 'Onde você está comprando?')!;
    await act(async () => chip().props.onPress());
    expect(storePicker().props.visible).toBe(true);
    expect(mockMounts).toEqual({ barcode: 1, picker: 1, trip: 1 });
    for (const width of [1180, 820, 1440]) {
      await act(async () => Dimensions.set({ window: { ...WINDOW, width } }));
      expect(mockMounts).toEqual({ barcode: 1, picker: 1, trip: 1 });
      expect(storePicker().props.visible).toBe(true);
      expect(estimateMore()!.props.expanded).toBe(true);
    }
    const columns = renderer!.root.findByType(Columns);
    expect(columns.findAllByType(StorePicker)).toHaveLength(0);
    expect(columns.findAllByType(BarcodeSteps)).toHaveLength(0);
    expect(columns.findAllByType(MarketTripConfirm)).toHaveLength(0);
    await act(async () => storePicker().props.onClose());
    expect(storePicker().props.visible).toBe(false);
    // Aberta, ela sai com o cartão (a lista que ficou sem item), e não volta aberta com ele.
    await act(async () => chip().props.onPress());
    mockQueries.items = loaded([]);
    await act(async () => renderer!.update(<ShoppingListScreen />));
    expect(renderer!.root.findAllByType(StorePicker)).toHaveLength(0);
    mockQueries.items = loaded([listItem('a', 'Arroz', 'arroz')]);
    await act(async () => renderer!.update(<ShoppingListScreen />));
    expect(storePicker().props.visible).toBe(false);
  });

  it('a pergunta de "Estou indo ao mercado" também fica aberta ao cruzar a largura, e sai com a lista arquivada', async () => {
    // O botão fica na coluna do lado; a pergunta, aberta pelo botão, é da tela e fica fora das colunas.
    web = jest.replaceProperty(Platform, 'OS', 'web');
    await act(async () => Dimensions.set({ window: { ...WINDOW, width: 820 } }));
    mockQueries.items = loaded([listItem('a', 'Arroz', 'arroz')]);
    Object.assign(mockMounts, { barcode: 0, picker: 0, trip: 0 });
    await mount();
    const confirm = () => renderer!.root.findByType(MarketTripConfirm);
    expect(confirm().props.visible).toBe(false);
    await act(async () => renderer!.root.findByType(MarketTripAction).props.onPress());
    expect(confirm().props.visible).toBe(true);
    for (const width of [1180, 820, 1440]) {
      await act(async () => Dimensions.set({ window: { ...WINDOW, width } }));
      expect(confirm().props.visible).toBe(true);
      expect(mockMounts.trip).toBe(1);
    }
    expect(renderer!.root.findByType(Columns).findAllByType(MarketTripConfirm)).toHaveLength(0);
    expect(renderer!.root.findByType(Columns).findAllByType(MarketTripAction)).toHaveLength(1);
    await act(async () => confirm().props.onClose());
    expect(confirm().props.visible).toBe(false);
    // Aberta, ela sai com a lista arquivada (em outro aparelho), e não volta aberta quando a lista é reaberta.
    await act(async () => renderer!.root.findByType(MarketTripAction).props.onPress());
    const open = mockQueries.list;
    mockQueries.list = loaded({ id: 'l1', name: 'Churrasco', kind: 'mercado', archived_at: '2026-10-20T12:00:00Z', created_at: '2026-10-01T12:00:00Z' });
    await act(async () => renderer!.update(<ShoppingListScreen />));
    expect(renderer!.root.findAllByType(MarketTripConfirm)).toHaveLength(0);
    mockQueries.list = open;
    await act(async () => renderer!.update(<ShoppingListScreen />));
    expect(confirm().props.visible).toBe(false);
  });

  it('no celular nada muda: tudo em sequência, na ordem de sempre, sem as caixas das colunas', async () => {
    mockQueries.items = loaded([listItem('a', 'Arroz', 'arroz')]);
    mockQueries.prices = loaded([latest('arroz', 25)]);
    await mount();
    expect(parts()).toEqual([Card, RestockStrip, RecentPurchases, ListEstimateCard, MarketTripAction, Section, Text]);
    await act(async () => renderer!.unmount());
    // A lista vazia, onde sempre esteve: depois das faixas, antes da ida.
    mockQueries.items = loaded([]);
    await mount();
    expect(parts()).toEqual([Card, RestockStrip, RecentPurchases, EmptyState, MarketTripAction]);
    await act(async () => renderer!.unmount());
    // Com o que sugerir nas faixas, logo embaixo do cartão, a lista vazia não aparece, como sempre.
    mockQueries.purchases = loaded(ranOutHistory('Café', null));
    await mount();
    expect(mockSeen.restock?.map((i) => i.name)).toEqual(['Café']);
    expect(parts()).toEqual([Card, RestockStrip, RecentPurchases, MarketTripAction]);
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
/** O botão do rodapé da tela (Screen `footer`), ou undefined. */
const footer = () => renderer!.root.findByType(Screen).props.footer as { props: { title: string; onPress: () => void } } | undefined;
const finishSheet = () => renderer!.root.findAllByType(ActionSheet).find((sheet) => sheet.props.title === 'Finalizar compra')!;
/** Toca no "Finalizar compra" do rodapé. */
const tapFinish = () => act(async () => footer()!.props.onPress());
/** Escolhe no menu do "Finalizar compra", como ele faz: fecha e depois roda a ação. */
async function pick(label: string) {
  const sheet = finishSheet();
  const action = (sheet.props.actions as SheetAction[]).find((entry) => entry.label === label);
  expect(action).toBeDefined();
  await act(async () => {
    sheet.props.onClose();
    action!.onPress();
  });
}

describe('o menu da lista, no cabeçalho ao lado da calculadora: renomear, arquivar e reabrir', () => {
  let header: ReactTestRenderer | undefined;

  afterEach(async () => {
    await act(async () => header?.unmount());
    header = undefined;
  });

  /** Desenha o que a tela pôs à direita no cabeçalho, como o Stack faz, e devolve o botão do menu. */
  async function menuButton() {
    const headerRight = mockSeen.options?.headerRight as ((props: { tintColor?: string }) => ReactNode) | undefined;
    expect(headerRight).toBeDefined();
    await act(async () => {
      header = create(<>{headerRight!({ tintColor: '#3656F4' })}</>);
    });
    const found = header!.root.findAll((node) => node.props.accessibilityLabel === LIST_MENU_LABEL && Boolean(node.props.onPress));
    expect(found).toHaveLength(1);
    return found[0];
  }
  /** O menu que a tela desenha (o cabeçalho só tem o botão). */
  const menu = () => renderer!.root.findByType(ListMenu).findByType(ActionSheet);
  const menuChoices = () => (menu().props.actions as SheetAction[]).map((action) => action.label);
  /** Abre o menu pelo botão do cabeçalho e escolhe, como o menu faz: fecha e depois roda a ação. */
  async function fromMenu(label: string) {
    const open = await menuButton();
    await act(async () => open.props.onPress());
    expect(menu().props.visible).toBe(true);
    const action = (menu().props.actions as SheetAction[]).find((entry) => entry.label === label);
    expect(action).toBeDefined();
    await act(async () => {
      menu().props.onClose();
      action!.onPress();
    });
    expect(menu().props.visible).toBe(false);
  }

  it('o botão do menu fica ao lado da calculadora, com nome para o leitor de tela e o toque de 44', async () => {
    await mount();
    const open = await menuButton();
    expect(open.props.accessibilityRole).toBe('button');
    const style = StyleSheet.flatten(typeof open.props.style === 'function' ? open.props.style({ pressed: false }) : open.props.style);
    expect(style).toMatchObject({ minWidth: 44, minHeight: 44 });
    // A calculadora e o menu, nessa ordem, numa linha.
    const labels = header!.root
      .findAll((node) => typeof node.props.accessibilityLabel === 'string' && Boolean(node.props.onPress))
      .map((node) => node.props.accessibilityLabel);
    expect([...new Set(labels)]).toEqual([PRICE_CALCULATOR_LABEL, LIST_MENU_LABEL]);
    // Fechado até o toque; o título é o nome da lista.
    expect(menu().props.visible).toBe(false);
    expect(menu().props.title).toBe('Mercado');
    expect(menuChoices()).toEqual(['Renomear lista', 'Arquivar lista']);
  });

  it('os botões largos do fim da tela saíram: renomear e arquivar ficam só no menu', async () => {
    mockQueries.items = loaded([listItem('a', 'Arroz', null)]);
    await mount();
    expect(button('Renomear lista')).toBeUndefined();
    expect(button('Arquivar lista')).toBeUndefined();
    expect(button('Reabrir lista')).toBeUndefined();
  });

  it('"Renomear lista" abre o modal com o nome de agora e grava o nome novo', async () => {
    await mount();
    await fromMenu('Renomear lista');
    const field = renderer!.root.findAllByType(TextField).find((entry) => entry.props.label === 'Nome da lista')!;
    expect(field.props.value).toBe('Mercado');
    await act(async () => field.props.onChangeText(' Feira  do sábado'));
    await act(async () => button('Salvar')!.props.onPress());
    expect(mockQueue.rename).toHaveBeenCalledWith('Feira do sábado', expect.anything());
  });

  it('"Arquivar lista" pergunta como antes e, confirmado, arquiva e volta', async () => {
    jest.mocked(confirmAction).mockClear();
    mockQueue.archive.mockClear();
    jest.mocked(router.back).mockClear();
    await mount();
    await fromMenu('Arquivar lista');
    expect(confirmAction).toHaveBeenCalledWith(
      'Arquivar lista',
      'A lista some das telas, mas as notas e preços continuam.',
      'Arquivar',
      expect.any(Function),
    );
    expect(mockQueue.archive).not.toHaveBeenCalled();
    await act(async () => jest.mocked(confirmAction).mock.calls[0][3]());
    expect(mockQueue.archive).toHaveBeenCalledTimes(1);
    const [, options] = mockQueue.archive.mock.calls[0] as [unknown, { onSuccess: () => void }];
    await act(async () => options.onSuccess());
    expect(router.back).toHaveBeenCalled();
  });

  it('a lista arquivada é só para ver: sem pôr item, sem limpar, sem marcar nem editar, com o aviso', async () => {
    mockQueries.list = loaded({ id: 'l1', name: 'Churrasco', kind: 'mercado', archived_at: '2026-10-20T12:00:00Z', created_at: '2026-10-01T12:00:00Z' });
    mockQueries.items = loaded([listItem('a', 'Arroz', null), { ...listItem('b', 'Carvão', null), checked_at: minutesAgo(60) }]);
    const page = await mount();
    expect(page).toContain('Esta lista está arquivada. Reabra para mexer nela.');
    expect(renderer!.root.findAllByType(TextField).filter((field) => field.props.placeholder === ADD_FIELD_PLACEHOLDER)).toHaveLength(0);
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
    // Ver ainda dá: os itens, mandar a lista; o menu renomeia e reabre, e o aviso também reabre.
    expect(button('Mandar a lista')).toBeDefined();
    expect(button('Reabrir lista')).toBeDefined();
    expect(menuChoices()).toEqual(['Renomear lista', 'Reabrir lista']);
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

  it('a lista arquivada reabre pelo aviso e pelo menu, e também se renomeia', async () => {
    mockQueries.list = loaded({ id: 'l1', name: 'Churrasco', kind: 'mercado', archived_at: '2026-10-20T12:00:00Z', created_at: '2026-10-01T12:00:00Z' });
    mockQueue.reopen.mockClear();
    await mount();
    expect(button('Arquivar lista')).toBeUndefined();
    await act(async () => button('Reabrir lista')!.props.onPress());
    expect(mockQueue.reopen).toHaveBeenCalledWith('l1', expect.anything());
    await fromMenu('Reabrir lista');
    expect(mockQueue.reopen).toHaveBeenCalledTimes(2);
    await fromMenu('Renomear lista');
    expect(renderer!.root.findAllByType(TextField).find((entry) => entry.props.label === 'Nome da lista')!.props.value).toBe('Churrasco');
  });
});

describe('o modo compra: com item no carrinho ou com a própria ida, a lista sobe', () => {
  const fields = (placeholder: string) => renderer!.root.findAllByType(TextField).filter((field) => field.props.placeholder === placeholder);
  /** O campo da quantidade e as unidades saíram do cartão: a quantidade vem do texto. */
  const amountControls = () =>
    renderer!.root.findAllByType(TextField).filter((field) => field.props.accessibilityLabel === 'Quantidade').length +
    renderer!.root.findAllByType(Chip).filter((chip) => ['un', 'kg', 'g', 'l', 'ml'].includes(chip.props.label)).length;
  const moreOptions = () => renderer!.root.findAllByType(IconButton).filter((entry) => String(entry.props.label).startsWith('Mais opções'));
  const strips = () => renderer!.root.findAllByType(RestockStrip).length + renderer!.root.findAllByType(RecentPurchases).length;
  const typeName = (text: string) => act(() => fields(ADD_FIELD_PLACEHOLDER)[0].props.onChangeText(text));
  const submit = () => act(() => fields(ADD_FIELD_PLACEHOLDER)[0].props.onSubmitEditing());
  const barcodeButton = () => renderer!.root.findAllByType(Button).find((entry) => entry.props.accessibilityLabel === BARCODE_BUTTON.label);
  const pending = listItem('a', 'Arroz', null);
  const inCart = { ...listItem('b', 'Carvão', null), checked_at: minutesAgo(5) };

  beforeEach(() => {
    mockQueue.add.mockClear();
    // Algo que passou do costume: "Acho que acabou" teria o que mostrar.
    mockQueries.purchases = loaded(ranOutHistory('Café Pilão 500g', 'pilao'));
  });

  it('montando (carrinho vazio, sem ida): o cartão inteiro e as faixas, sem "Mais opções"', async () => {
    mockQueries.items = loaded([pending]);
    await mount();
    expect(fields(ADD_FIELD_PLACEHOLDER)).toHaveLength(1);
    expect(amountControls()).toBe(0);
    expect(button('Escolher dos itens comuns')).toBeDefined();
    expect(button('Colar lista')).toBeDefined();
    expect(strips()).toBe(2);
    expect(moreOptions()).toHaveLength(0);
  });

  it('com item no carrinho: o cartão recolhe ao campo, e "Acabou" e os recentes somem; o "Finalizar compra" continua', async () => {
    mockBarcode.available = true;
    mockQueries.items = loaded([pending, inCart]);
    await mount();
    expect(fields(ADD_FIELD_PLACEHOLDER)).toHaveLength(1);
    expect(amountControls()).toBe(0);
    expect(button('Escolher dos itens comuns')).toBeUndefined();
    expect(button('Colar lista')).toBeUndefined();
    expect(barcodeButton()).toBeUndefined();
    expect(strips()).toBe(0);
    expect(footer()!.props.title).toBe('Finalizar compra');
    // O resto do cartão fica a um toque, e o leitor de tela diz o que o botão abre e que está fechado.
    const [more] = moreOptions();
    expect(more.props.label).toBe('Mais opções: itens comuns, colar lista e código de barras');
    expect(more.props.expanded).toBe(false);
    // Ainda dá para pôr o que faltou: as sugestões da busca e o "Adicionar" aparecem com o texto, com a quantidade dele.
    await typeName('Leite');
    expect(button('Adicionar "Leite"')).toBeDefined();
    await submit();
    expect(mockQueue.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'Leite', quantity: 1, unit: 'un' }), 'u1');
    await typeName('2 kg feijão');
    expect(button('Adicionar "Feijão" · 2 kg')).toBeDefined();
    await submit();
    expect(mockQueue.add).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Feijão', quantity: 2, unit: 'kg' }), 'u1');
  });

  it('"Mais opções" traz os itens comuns, colar e o código de volta; abrir e recolher não mudam o que se digitou', async () => {
    mockBarcode.available = true;
    mockQueries.items = loaded([pending, inCart]);
    await mount();
    await act(async () => moreOptions()[0].props.onPress());
    expect(moreOptions()[0].props.expanded).toBe(true);
    expect(amountControls()).toBe(0);
    expect(button('Escolher dos itens comuns')).toBeDefined();
    expect(button('Colar lista')).toBeDefined();
    expect(barcodeButton()).toBeDefined();
    // As faixas são para montar a lista: continuam fora.
    expect(strips()).toBe(0);

    // Com o texto, o botão de pôr toma o lugar das opções, e "Mais opções" sai junto: aberto, não mostraria nada (o
    // leitor de tela diria "expandido" sem nada novo). O campo continua o mesmo, com o texto.
    await typeName('3 kg banana');
    expect(button('Colar lista')).toBeUndefined();
    expect(button('Adicionar "Banana" · 3 kg')).toBeDefined();
    expect(moreOptions()).toHaveLength(0);
    expect(fields(ADD_FIELD_PLACEHOLDER)[0].props.value).toBe('3 kg banana');
    // Apagado o texto, ele volta como estava, aberto, com as opções.
    await typeName('');
    expect(moreOptions()[0].props.expanded).toBe(true);
    expect(button('Colar lista')).toBeDefined();
    // Recolher não muda o que se digita depois.
    await act(async () => moreOptions()[0].props.onPress());
    expect(moreOptions()[0].props.expanded).toBe(false);
    expect(button('Colar lista')).toBeUndefined();
    await typeName('3 kg banana');
    await submit();
    expect(mockQueue.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'Banana', quantity: 3, unit: 'kg' }), 'u1');
  });

  it('"Mais opções" só aparece com o campo vazio: com qualquer texto, aberto ele não teria o que mostrar', async () => {
    mockBarcode.available = true;
    mockQueries.items = loaded([pending, inCart]);
    await mount();
    for (const text of ['leit', '2 kg', '   ']) {
      await typeName(text);
      const typing = Boolean(text.trim());
      expect(moreOptions()).toHaveLength(typing ? 0 : 1);
      // Nada do que ele abre fica na tela com o texto: só o botão de pôr (quando a linha diz o que comprar).
      expect(button('Escolher dos itens comuns')).toBeUndefined();
    }
    // O campo é sempre o primeiro filho da primeira linha, com o botão ou sem ele: o teclado e o texto ficam.
    const firstRow = () => renderer!.root.findAllByType(Card).find((card) => card.findAllByType(TextField).length > 0)!.findAllByType(Row)[0];
    await typeName('leit');
    const withText = firstRow().findAllByType(TextField)[0];
    await typeName('');
    expect(firstRow().findAllByType(TextField)[0]).toBe(withText);
  });

  it('com a própria ida nesta lista, modo compra também com o carrinho vazio; a ida de outra pessoa não muda nada', async () => {
    mockQueries.items = loaded([pending]);
    mockTrips.list = [liveTrip()];
    await mount();
    expect(button('Escolher dos itens comuns')).toBeUndefined();
    expect(strips()).toBe(0);
    expect(moreOptions()).toHaveLength(1);
    await act(async () => renderer!.unmount());

    mockTrips.list = [liveTrip({ user_id: 'u2', display_name: 'Beto' })];
    await mount();
    expect(button('Escolher dos itens comuns')).toBeDefined();
    expect(strips()).toBe(2);
    expect(moreOptions()).toHaveLength(0);
  });

  it('a lista vazia na própria ida diz para digitar o que faltou, sem as faixas', async () => {
    mockTrips.list = [liveTrip()];
    const page = await mount();
    expect(page).toContain('Lista vazia');
    expect(page).toContain('Digite no campo acima o que faltou.');
    expect(strips()).toBe(0);
  });

  it('o carrinho que começa no meio da digitação não leva o texto nem a quantidade dele, e o cartão recolhe', async () => {
    mockQueries.items = loaded([pending]);
    await mount();
    await typeName('6 pão');
    // Outra pessoa da casa pôs o primeiro item no carrinho (a lista chega em tempo real).
    mockQueries.items = loaded([pending, inCart]);
    await act(async () => renderer!.update(<ShoppingListScreen />));
    expect(fields(ADD_FIELD_PLACEHOLDER)[0].props.value).toBe('6 pão');
    // A quantidade está no texto, à vista: recolher não esconde nada que vá junto.
    expect(button('Escolher dos itens comuns')).toBeUndefined();
    expect(button('Adicionar "Pão" · 6 un')).toBeDefined();
    await submit();
    expect(mockQueue.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'Pão', quantity: 6, unit: 'un' }), 'u1');
    // Com o campo livre, "Mais opções" aparece, recolhido.
    expect(moreOptions()[0].props.expanded).toBe(false);
  });

  it('recolhe sem perder o texto; o carrinho limpo volta a montar, e a próxima compra recolhe de novo', async () => {
    mockQueries.items = loaded([pending]);
    await mount();
    await typeName('Pão');
    mockQueries.items = loaded([pending, inCart]);
    await act(async () => renderer!.update(<ShoppingListScreen />));
    expect(fields(ADD_FIELD_PLACEHOLDER)[0].props.value).toBe('Pão');
    // Com o texto, sem "Mais opções"; apagado, ele aparece recolhido.
    expect(moreOptions()).toHaveLength(0);
    await typeName('');
    expect(moreOptions()[0].props.expanded).toBe(false);
    await act(async () => moreOptions()[0].props.onPress());
    expect(moreOptions()[0].props.expanded).toBe(true);
    await typeName('Pão');

    mockQueries.items = loaded([pending]);
    await act(async () => renderer!.update(<ShoppingListScreen />));
    expect(moreOptions()).toHaveLength(0);
    expect(fields(ADD_FIELD_PLACEHOLDER)[0].props.value).toBe('Pão');
    await typeName('');
    expect(button('Escolher dos itens comuns')).toBeDefined();

    mockQueries.items = loaded([pending, inCart]);
    await act(async () => renderer!.update(<ShoppingListScreen />));
    expect(button('Escolher dos itens comuns')).toBeUndefined();
    expect(moreOptions()[0].props.expanded).toBe(false);
  });
});

describe('finalizar a compra sem a nota, com uma ida ao mercado aberta: a pergunta de encerrar vem no fim', () => {
  beforeEach(() => {
    mockQueries.items = loaded([{ ...listItem('a', 'Arroz', null), checked_at: minutesAgo(5) }]);
    jest.mocked(askYesNo).mockReset();
  });

  /** "Finalizar compra" sem a nota, a confirmação do que vai para a despensa e a resposta do servidor. */
  async function clearCart() {
    await tapClear();
    await deliverClears();
  }
  /**
   * "Finalizar compra", "Sem a nota: só limpar o carrinho" (sem internet o menu nem abre: o limpar vem direto) e a
   * confirmação do que vai para a despensa.
   */
  async function tapClear() {
    await tapFinish();
    if (finishSheet().props.visible) await pick('Sem a nota: só limpar o carrinho');
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

  it('o "Limpar" da seção "No carrinho" só esvazia: a pergunta passou para o fim do "Finalizar compra"', async () => {
    mockTrips.list = [liveTrip()];
    mockQueue.clear.mockClear();
    await mount();
    await act(async () => button('Limpar')!.props.onPress());
    expect(mockSeen.cartPantry).toMatchObject({ single: false });
    await act(async () => (mockSeen.cartPantry!.onConfirm as (rows: unknown[]) => void)([]));
    expect(mockQueue.clear).toHaveBeenCalledWith(expect.objectContaining({ items: [{ id: 'a', token: 'selo' }] }), expect.anything());
    await deliverClears();
    expect(askYesNo).not.toHaveBeenCalled();
    expect(mockTrips.end).not.toHaveBeenCalled();
  });
});

describe('"Finalizar compra": a nota antes de limpar o carrinho', () => {
  const arroz = listItem('a', 'Arroz', null);
  const leite = { ...listItem('l', 'Leite', null, 'laticinios'), checked_at: minutesAgo(5), toggle_token: 't-leite' };
  const cafe = { ...listItem('c', 'Café', null, 'cafe_cha'), checked_at: minutesAgo(3), toggle_token: 't-cafe' };

  beforeEach(() => {
    jest.mocked(askYesNo).mockReset();
    jest.mocked(notify).mockReset();
    jest.mocked(router.push).mockClear();
    mockQueue.clear.mockClear();
    mockFocus.effect = null;
    stopWaitingForReceipt('l1');
  });

  /**
   * A revisão confirmou a nota (o que nota/[id] entrega: o toque de agora, e a resposta `answerMs` depois) e voltou:
   * a lista ganha o foco de novo.
   */
  async function confirmedAndBack({
    answerMs = 1500,
    ...receipt
  }: {
    pantryCount: number;
    removedListItems: string[];
    onlineAtTap?: boolean;
    answerMs?: number;
  }) {
    const tappedAt = Date.now();
    const handed = handConfirmedReceipt({ tappedAt, onlineAtTap: true, ...receipt }, tappedAt + answerMs);
    await act(async () => mockFocus.effect?.());
    return handed;
  }

  describe('o rodapé, pelo contexto', () => {
    it('com o carrinho vazio, "Onde comprar mais barato?", como antes', async () => {
      mockQueries.items = loaded([arroz]);
      await mount();
      expect(footer()?.props.title).toBe('Onde comprar mais barato?');
      expect(button('Finalizar compra')).toBeUndefined();
    });

    it('com item no carrinho, "Finalizar compra" no lugar dele; "Limpar" continua no carrinho', async () => {
      mockQueries.items = loaded([arroz, leite]);
      await mount();
      expect(footer()?.props.title).toBe('Finalizar compra');
      expect(button('Onde comprar mais barato?')).toBeUndefined();
      expect(button('Limpar')).toBeDefined();
    });

    it('"Tudo no carrinho!": o botão no estado, além do rodapé, e o texto diz o que ele faz', async () => {
      mockQueries.items = loaded([leite, cafe]);
      const page = await mount();
      expect(page).toContain('Tudo no carrinho!');
      expect(page).toContain(ALL_IN_CART_MESSAGE);
      expect(page).not.toContain('Quando guardar as compras, limpe o carrinho.');
      expect(footer()?.props.title).toBe('Finalizar compra');
      // O do estado, secundário (o primário é o do rodapé), faz o mesmo: pergunta como finalizar.
      const state = renderer!.root.findAllByType(EmptyState).find((entry) => entry.props.title === 'Tudo no carrinho!')!;
      const inState = state.findAllByType(Button).find((entry) => entry.props.title === 'Finalizar compra')!;
      expect(inState.props.variant).toBe('secondary');
      expect(finishSheet().props.visible).toBe(false);
      await act(async () => inState.props.onPress());
      expect(finishSheet().props.visible).toBe(true);
    });

    it('com algo ainda para comprar, o "Finalizar compra" é só o do rodapé', async () => {
      mockQueries.items = loaded([arroz, leite]);
      await mount();
      expect(renderer!.root.findAllByType(Button).filter((entry) => entry.props.title === 'Finalizar compra')).toHaveLength(1);
    });

    it('a lista arquivada é só para ver: sem "Finalizar compra"', async () => {
      mockQueries.list = loaded({ id: 'l1', name: 'Churrasco', kind: 'mercado', archived_at: '2026-10-20T12:00:00Z', created_at: '2026-10-01T12:00:00Z' });
      mockQueries.items = loaded([leite]);
      await mount();
      expect(footer()).toBeUndefined();
      expect(button('Finalizar compra')).toBeUndefined();
    });

    it('na lista "outros" também (a nota de qualquer loja casa com a lista), sem o "Onde comprar"', async () => {
      mockQueries.list = loaded({ id: 'l1', name: 'Casa', kind: 'outros', archived_at: null, created_at: '2026-10-01T12:00:00Z' });
      mockQueries.items = loaded([arroz]);
      await mount();
      expect(footer()).toBeUndefined();
      await act(async () => renderer!.unmount());
      mockQueries.items = loaded([arroz, leite]);
      await mount();
      expect(footer()?.props.title).toBe('Finalizar compra');
    });
  });

  it('o toque pergunta como finalizar: ler a nota (a câmera só da nota) ou o caminho sem ela', async () => {
    mockQueries.items = loaded([arroz, leite]);
    await mount();
    expect(finishSheet().props.visible).toBe(false);
    await tapFinish();
    expect(finishSheet().props.visible).toBe(true);
    expect((finishSheet().props.actions as SheetAction[]).map((action) => action.label)).toEqual([
      'Ler a nota',
      'Sem a nota: só limpar o carrinho',
    ]);
    // A nota: a câmera do "Escanear", só da nota; nada sai do carrinho ainda.
    await pick('Ler a nota');
    expect(router.push).toHaveBeenCalledWith({ pathname: '/escanear', params: { para: 'nota' } });
    expect(mockQueue.clear).not.toHaveBeenCalled();
  });

  it('sem a nota: o "Limpar" de sempre, com o carrinho do toque e a pergunta da ida depois', async () => {
    mockTrips.list = [liveTrip()];
    jest.mocked(askYesNo).mockResolvedValue(false);
    mockQueries.items = loaded([arroz, leite]);
    await mount();
    await tapFinish();
    await pick('Sem a nota: só limpar o carrinho');
    expect(mockSeen.cartPantry).toMatchObject({ single: false, notice: undefined });
    await act(async () => (mockSeen.cartPantry!.onConfirm as (rows: unknown[]) => void)([]));
    expect(mockQueue.clear).toHaveBeenCalledWith(expect.objectContaining({ items: [{ id: 'l', token: 't-leite' }] }), expect.anything());
    for (const options of mockClearQueue.splice(0)) await act(async () => options.onSuccess?.());
    expect(askYesNo).toHaveBeenCalledTimes(1);
    expect(askYesNo).toHaveBeenCalledWith('Encerrar a ida ao mercado?', expect.stringContaining('O carrinho foi limpo.'), 'Encerrar', 'Agora não');
    // Ninguém espera nota: uma confirmada agora avisa sozinha, na revisão.
    expect(handConfirmedReceipt({ tappedAt: Date.now(), onlineAtTap: true, pantryCount: 0, removedListItems: [] })).toBe(false);
  });

  it('sem internet, pula a nota: o "Limpar" abre com o aviso de que ela pode ser lida depois em Compras → Notas', async () => {
    mockTrips.online = false;
    mockQueries.items = loaded([arroz, leite]);
    await mount();
    await tapFinish();
    expect(finishSheet().props.visible).toBe(false);
    expect(FINISH_OFFLINE_NOTICE).toContain('Compras → Notas');
    expect(mockSeen.cartPantry).toMatchObject({ single: false, notice: FINISH_OFFLINE_NOTICE });
  });

  describe('com a nota: a revisão confirma e volta para a lista', () => {
    beforeEach(() => {
      mockQueries.items = loaded([arroz, leite, cafe]);
    });

    it('a lista diz o que a nota fez e o que ficou no carrinho (a revisão não avisa), sem a ida', async () => {
      await mount();
      await tapFinish();
      await pick('Ler a nota');
      // A revisão tirou o leite da lista; o café ficou no carrinho (a nota não o tinha, ou não casou).
      expect(await confirmedAndBack({ pantryCount: 2, removedListItems: ['l'] })).toBe(true);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledWith(
        'Nota salva',
        '2 itens foram para a despensa. 1 item saiu da lista. Ficou 1 item no carrinho que a nota não tirou da lista. Se não comprou, toque nele para devolver à lista; se comprou, use "Limpar".',
      );
      expect(askYesNo).not.toHaveBeenCalled();
      // O que ficou continua no carrinho, com o "Limpar".
      expect(button('Limpar')).toBeDefined();
      expect(mockQueue.clear).not.toHaveBeenCalled();
    });

    it('a busca nova da lista já chegou sem o que a nota tirou: o mesmo carrinho que sobrou', async () => {
      await mount();
      await tapFinish();
      await pick('Ler a nota');
      mockQueries.items = loaded([arroz, cafe]);
      await act(async () => renderer!.update(<ShoppingListScreen />));
      await confirmedAndBack({ pantryCount: 1, removedListItems: ['l'] });
      expect(String(jest.mocked(notify).mock.calls[0][1])).toContain('Ficou 1 item no carrinho');
    });

    it('a nota tirou tudo do carrinho: só o que ela fez', async () => {
      await mount();
      await tapFinish();
      await pick('Ler a nota');
      await confirmedAndBack({ pantryCount: 2, removedListItems: ['l', 'c', 'outra-lista'] });
      expect(notify).toHaveBeenCalledWith('Nota salva', '2 itens foram para a despensa. 3 itens saíram da lista.');
    });

    it('com a própria ida nesta lista, a pergunta de encerrar vem no fim, uma vez, com o que a nota fez', async () => {
      mockTrips.list = [liveTrip()];
      jest.mocked(askYesNo).mockResolvedValue(true);
      mockTrips.end.mockResolvedValue(true);
      await mount();
      await tapFinish();
      await pick('Ler a nota');
      await confirmedAndBack({ pantryCount: 2, removedListItems: ['l', 'c'] });
      expect(askYesNo).toHaveBeenCalledTimes(1);
      expect(askYesNo).toHaveBeenCalledWith(
        'Encerrar a ida ao mercado?',
        'A nota foi salva. 2 itens foram para a despensa. 2 itens saíram da lista. Ao encerrar, a casa deixa de ver o aviso de que você está nas compras.',
        'Encerrar',
        'Agora não',
      );
      expect(notify).not.toHaveBeenCalled();
      expect(mockTrips.end).toHaveBeenCalledWith('t1');
      // Voltar de novo à lista (de outra tela) não pergunta outra vez.
      await act(async () => mockFocus.effect?.());
      expect(askYesNo).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['com a ida de outra pessoa', () => [liveTrip({ user_id: 'outra' })], {}],
      ['com a ida de outra lista', () => [liveTrip({ list_id: 'l2' })], {}],
      ['o toque de confirmar foi sem internet', () => [liveTrip()], { onlineAtTap: false }],
      ['a confirmação demorou mais de 30 s para responder', () => [liveTrip()], { answerMs: 31_000 }],
    ])('%s: não pergunta da ida, só o "Nota salva"', async (_why, trips, patch) => {
      mockTrips.list = trips();
      await mount();
      await tapFinish();
      await pick('Ler a nota');
      await confirmedAndBack({ pantryCount: 0, removedListItems: ['l', 'c'], ...patch });
      expect(askYesNo).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith('Nota salva', '2 itens saíram da lista.');
    });

    it('sem internet na volta: não pergunta (encerrar é um pedido ao servidor)', async () => {
      mockTrips.list = [liveTrip()];
      await mount();
      await tapFinish();
      await pick('Ler a nota');
      mockTrips.online = false;
      await confirmedAndBack({ pantryCount: 0, removedListItems: ['l', 'c'] });
      expect(askYesNo).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith('Nota salva', '2 itens saíram da lista.');
    });

    it('voltou sem confirmar (desistiu, ou a nota ficou pendente da Sefaz): nada a dizer, e a espera acaba', async () => {
      mockTrips.list = [liveTrip()];
      await mount();
      await tapFinish();
      await pick('Ler a nota');
      await act(async () => mockFocus.effect?.());
      expect(notify).not.toHaveBeenCalled();
      expect(askYesNo).not.toHaveBeenCalled();
      // Uma nota confirmada depois, por outro caminho, avisa sozinha na revisão.
      expect(handConfirmedReceipt({ tappedAt: Date.now(), onlineAtTap: true, pantryCount: 0, removedListItems: [] })).toBe(false);
    });

    describe('"Onde estou" depois da nota', () => {
      const estimateCard = () => renderer!.root.findByType(ListEstimateCard);
      /** No mercado s1 ("Onde estou"), "Finalizar compra" com a nota. */
      async function atStoreAndFinish() {
        await mount();
        await act(async () => storePicker().props.onChangeStore('s1'));
        expect(estimateCard().props.storeId).toBe('s1');
        await tapFinish();
        await pick('Ler a nota');
      }

      it('a nota que esvazia o carrinho encerra as compras, como o "Limpar": a escolha sai', async () => {
        await atStoreAndFinish();
        await confirmedAndBack({ pantryCount: 2, removedListItems: ['l', 'c'] });
        expect(estimateCard().props.storeId).toBeNull();
        expect(await AsyncStorage.getItem('kotii:store-choice:l1')).toBeNull();
      });

      it('com algo ainda no carrinho a pessoa pode estar no mercado: a escolha fica', async () => {
        await atStoreAndFinish();
        await confirmedAndBack({ pantryCount: 1, removedListItems: ['l'] });
        expect(estimateCard().props.storeId).toBe('s1');
      });

      it('com algo no carrinho, encerrar a ida no fim do fluxo tira a escolha; "Agora não" a deixa', async () => {
        mockTrips.list = [liveTrip()];
        jest.mocked(askYesNo).mockResolvedValue(false);
        await atStoreAndFinish();
        await confirmedAndBack({ pantryCount: 1, removedListItems: ['l'] });
        expect(askYesNo).toHaveBeenCalledTimes(1);
        expect(estimateCard().props.storeId).toBe('s1');
        await act(async () => renderer!.unmount());
        renderer = undefined;

        jest.mocked(askYesNo).mockResolvedValue(true);
        mockTrips.end.mockResolvedValue(true);
        await atStoreAndFinish();
        await confirmedAndBack({ pantryCount: 1, removedListItems: ['l'] });
        expect(mockTrips.end).toHaveBeenCalledWith('t1');
        expect(estimateCard().props.storeId).toBeNull();
      });

      it('se encerrar der errado, a ida continua, e a escolha também', async () => {
        mockTrips.list = [liveTrip()];
        jest.mocked(askYesNo).mockResolvedValue(true);
        mockTrips.end.mockRejectedValue(new Error('sem rede'));
        await atStoreAndFinish();
        await confirmedAndBack({ pantryCount: 1, removedListItems: ['l'] });
        expect(notify).toHaveBeenCalledWith('Não deu para encerrar', expect.any(String));
        expect(estimateCard().props.storeId).toBe('s1');
      });
    });

    it('a lista que sai da tela no meio deixa de esperar a nota', async () => {
      await mount();
      await tapFinish();
      await pick('Ler a nota');
      await act(async () => renderer!.unmount());
      renderer = undefined;
      expect(handConfirmedReceipt({ tappedAt: Date.now(), onlineAtTap: true, pantryCount: 0, removedListItems: [] })).toBe(false);
    });
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
    await act(async () => storePicker().props.onChangeStore('s1'));
    expect(estimateCard().props.storeId).toBe('s1');
    expect(JSON.parse((await AsyncStorage.getItem('kotii:store-choice:l1'))!).storeId).toBe('s1');
    await act(async () => renderer!.unmount());
    await mount();
    expect(estimateCard().props.storeId).toBe('s1');
  });

  it('tirar o mercado e limpar o carrinho apagam a escolha', async () => {
    await mount();
    await act(async () => storePicker().props.onChangeStore('s1'));
    await act(async () => storePicker().props.onChangeStore(null));
    expect(estimateCard().props.storeId).toBeNull();
    expect(await AsyncStorage.getItem('kotii:store-choice:l1')).toBeNull();
    await act(async () => storePicker().props.onChangeStore('s1'));
    await act(async () => button('Limpar')!.props.onPress());
    await act(async () => (mockSeen.cartPantry!.onConfirm as (rows: unknown[]) => void)([]));
    expect(estimateCard().props.storeId).toBeNull();
    expect(await AsyncStorage.getItem('kotii:store-choice:l1')).toBeNull();
  });

  it('o limpar que falha devolve o mercado escolhido', async () => {
    await mount();
    await act(async () => storePicker().props.onChangeStore('s1'));
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
    await act(async () => storePicker().props.onChangeStore('s1'));
    spy.mockRestore();
    await act(async () => renderer!.unmount());
    await mount();
    expect(estimateCard().props.storeId).toBeNull();
  });
});

describe('a calculadora de preço, no canto de cima da lista', () => {
  let header: ReactTestRenderer | undefined;

  afterEach(async () => {
    await act(async () => header?.unmount());
    header = undefined;
  });

  /** Desenha o que a tela pôs à direita no cabeçalho, como o Stack faz, e toca no ícone. */
  async function openCalculator() {
    const headerRight = mockSeen.options?.headerRight as ((props: { tintColor?: string }) => ReactNode) | undefined;
    expect(headerRight).toBeDefined();
    await act(async () => {
      header = create(<>{headerRight!({ tintColor: '#3656F4' })}</>);
    });
    const [icon] = header!.root.findAll((node) => node.props.accessibilityLabel === PRICE_CALCULATOR_LABEL && Boolean(node.props.onPress));
    expect(icon.props.accessibilityRole).toBe('button');
    await act(async () => icon.props.onPress());
  }

  const field = (label: string) => renderer!.root.findAll((node) => node.type === TextField && node.props.accessibilityLabel === label)[0];
  /** O cartão da opção onde está o campo. */
  const cardOf = (label: string) => {
    let node = field(label).parent;
    while (node && node.type !== Card) node = node.parent;
    return node!;
  };
  const badges = (label: string) => cardOf(label).findAllByType(Badge).map((badge) => badge.props.label);
  const type = (label: string, text: string) => act(() => field(label).props.onChangeText(text));
  /** O que se toca na calculadora com aquele nome para o leitor de tela. */
  const pressable = (label: string) =>
    renderer!.root.findByType(PriceCalculator).findAll((node) => node.props.accessibilityLabel === label && Boolean(node.props.onPress))[0];

  it('o ícone abre a calculadora, ela compara 500 g com 1 kg e fecha sem guardar nada', async () => {
    await mount();
    expect(mockSeen.options?.title).toBe('Mercado');
    expect(renderer!.root.findAllByType(PriceCalculator)).toHaveLength(0);

    await openCalculator();
    expect(renderer!.root.findAllByType(PriceCalculator)).toHaveLength(1);
    await type('Preço da opção 1, em reais', '8,90');
    await type('Quantidade da opção 1', '500');
    await type('Preço da opção 2, em reais', '16,50');
    await type('Quantidade da opção 2', '1');
    // A unidade de cada opção é dela: a segunda vira kg.
    // O chip é lido pelo nome da unidade, não pela letra.
    await act(async () => pressable('quilos, opção 2').props.onPress());
    // O leitor de tela sabe qual unidade está escolhida em cada opção.
    expect(pressable('quilos, opção 2').props.accessibilityState).toEqual({ checked: true });
    expect(pressable('gramas, opção 2').props.accessibilityState).toEqual({ checked: false });
    expect(pressable('gramas, opção 1').props.accessibilityState).toEqual({ checked: true });
    expect(pressable('quilos, opção 1').props.accessibilityState).toEqual({ checked: false });
    const page = texts(renderer!.toJSON()).join('\n');
    expect(page).toContain('R$ 17,80 o kg');
    expect(page).toContain('R$ 16,50 o kg');
    expect(page).toContain('A opção 2 sai 7% mais barata que a opção 1.');
    // O destaque vai para o cartão da opção 2, e só para ele, com a frase de quanto mais barata junto do "Mais barata"
    // (o resultado, no fim, fica embaixo do teclado enquanto se digita).
    expect(badges('Preço da opção 2, em reais')).toEqual(['Mais barata']);
    expect(badges('Preço da opção 1, em reais')).toEqual([]);
    const cardTexts = (label: string) => cardOf(label).findAllByType(Text).map((node) => node.props.children);
    expect(cardTexts('Preço da opção 2, em reais')).toContain('A opção 2 sai 7% mais barata que a opção 1.');
    expect(cardTexts('Preço da opção 1, em reais')).not.toContain('A opção 2 sai 7% mais barata que a opção 1.');
    const perKg = (label: string, text: string) => cardOf(label).findAll((node) => node.type === Text && node.props.children === text)[0];
    expect(perKg('Preço da opção 2, em reais', 'R$ 16,50 o kg').props.color).toBe('primary');
    expect(perKg('Preço da opção 1, em reais', 'R$ 17,80 o kg').props.color).toBeUndefined();

    // Fechar esquece: aberta de novo, começa vazia.
    await act(async () => pressable('Fechar').props.onPress());
    expect(renderer!.root.findAllByType(PriceCalculator)).toHaveLength(0);
    await act(async () => header!.root.findAll((node) => Boolean(node.props.onPress))[0].props.onPress());
    expect(field('Preço da opção 1, em reais').props.value).toBe('');
    expect(texts(renderer!.toJSON()).join('\n')).not.toContain('7% mais barata');
  });

  it('"Adicionar opção" até 4, só da terceira em diante sai, e "Limpar" volta às duas vazias', async () => {
    await mount();
    await openCalculator();
    const add = () => renderer!.root.findByType(PriceCalculator).findAllByType(Button).find((b) => b.props.title === 'Adicionar opção');
    expect(pressable('Remover a opção 2')).toBeUndefined();
    await act(async () => add()!.props.onPress());
    await act(async () => add()!.props.onPress());
    expect(add()).toBeUndefined();
    expect(pressable('Remover a opção 4')).toBeDefined();
    await type('Preço da opção 3, em reais', '3');
    await type('Preço da opção 4, em reais', '4');
    await act(async () => pressable('Remover a opção 3').props.onPress());
    expect(field('Quantidade da opção 4')).toBeUndefined();
    // Saiu a opção 3: a 4 sobe para o lugar dela.
    expect(field('Preço da opção 3, em reais').props.value).toBe('4');
    await type('Preço da opção 1, em reais', '8,90');
    await act(async () => renderer!.root.findByType(PriceCalculator).findAllByType(Button).find((b) => b.props.title === 'Limpar')!.props.onPress());
    expect(field('Preço da opção 1, em reais').props.value).toBe('');
    expect(field('Preço da opção 3, em reais')).toBeUndefined();
  });

  it('o resultado é anunciado quando muda, depois de uma pausa na digitação (o iPhone não tem região viva)', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    await mount();
    jest.useFakeTimers();
    try {
      await openCalculator();
      // No iPhone não há região viva: quem fala é o announceForAccessibility.
      expect(renderer!.root.findByType(PriceCalculator).findAll((node) => node.props['aria-live'] !== undefined)).toHaveLength(0);
      /** Os rótulos dos elementos de leitor de tela que dizem o resultado (o cartão do resultado é um só). */
      const resultLabels = (sentence: string) =>
        renderer!.root
          .findByType(PriceCalculator)
          .findAll((node) => typeof node.type === 'string' && node.props.accessible === true && node.props.accessibilityLabel === sentence);
      expect(resultLabels(WAITING_TEXT)).toHaveLength(1);
      // Ao abrir, nada a anunciar.
      act(() => jest.advanceTimersByTime(2000));
      expect(announce).not.toHaveBeenCalled();
      await type('Preço da opção 1, em reais', '8,90');
      await type('Quantidade da opção 1', '500');
      await type('Preço da opção 2, em reais', '16,50');
      await type('Quantidade da opção 2', '1000');
      act(() => jest.advanceTimersByTime(500));
      expect(announce).not.toHaveBeenCalled();
      // Quem vai até o resultado ouve o que está na tela, já antes da pausa.
      expect(resultLabels('A opção 2 sai 7% mais barata que a opção 1.')).toHaveLength(1);
      expect(resultLabels(WAITING_TEXT)).toHaveLength(0);
      act(() => jest.advanceTimersByTime(1000));
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith('A opção 2 sai 7% mais barata que a opção 1.');
      // Voltar ao pedido de preencher ("Limpar") também é anunciado: o silêncio é só o da abertura.
      const clear = renderer!.root.findByType(PriceCalculator).findAllByType(Button).find((b) => b.props.title === 'Limpar')!;
      await act(async () => clear.props.onPress());
      expect(resultLabels(WAITING_TEXT)).toHaveLength(1);
      act(() => jest.advanceTimersByTime(ANNOUNCE_DELAY_MS));
      expect(announce).toHaveBeenCalledTimes(2);
      expect(announce).toHaveBeenLastCalledWith(WAITING_TEXT);
    } finally {
      jest.useRealTimers();
      announce.mockRestore();
    }
  });

  describe('no Android e no navegador, uma região viva fala, e não o announceForAccessibility', () => {
    let calculator: ReactTestRenderer | undefined;
    afterEach(async () => {
      await act(async () => calculator?.unmount());
      calculator = undefined;
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    /** Abre a calculadora sozinha, preenche 500 g por R$ 8,90 e 1 kg por R$ 16,50 e devolve a região viva antes e depois da pausa. */
    async function fillOn(os: 'android' | 'web') {
      jest.replaceProperty(Platform, 'OS', os);
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
      jest.useFakeTimers();
      await act(async () => {
        calculator = create(<PriceCalculator onClose={() => undefined} />);
      });
      const input = (label: string) => calculator!.root.findAll((node) => node.type === TextField && node.props.accessibilityLabel === label)[0];
      const write = (label: string, text: string) => act(() => input(label).props.onChangeText(text));
      await write('Preço da opção 1, em reais', '8,90');
      await write('Quantidade da opção 1', '500');
      await write('Preço da opção 2, em reais', '16,50');
      await write('Quantidade da opção 2', '1000');
      // O que a região viva diz: o rótulo (Android) ou o texto (navegador), lido na hora.
      const live = () =>
        calculator!.root
          .findAll((node) => node.props['aria-live'] === 'polite' && typeof node.type === 'string')
          .map((node) => ({
            label: node.props.accessibilityLabel,
            accessible: node.props.accessible,
            text: node.findAllByType(Text)[0]?.props.children,
            texts: node.findAllByType(Text).map((child) => child.props.children),
          }));
      const before = live();
      // Os elementos do leitor de tela fora da região viva, com o que dizem antes da pausa.
      const shown = calculator!.root
        .findAll((node) => typeof node.type === 'string' && node.props.accessible === true && node.props['aria-live'] === undefined)
        .map((node) => node.props.accessibilityLabel);
      act(() => jest.advanceTimersByTime(ANNOUNCE_DELAY_MS));
      return { announce, before, after: live(), shown };
    }

    it('Android: o próprio cartão do resultado é a região viva, um elemento só, e o rótulo dele só muda depois da pausa', async () => {
      const { announce, before, after, shown } = await fillOn('android');
      expect(before).toHaveLength(1);
      expect(before[0].label).toBe(WAITING_TEXT);
      expect(before[0].accessible).toBe(true);
      // É o cartão visível (o texto dele já mudou), não um elemento escondido: o leitor não passa duas vezes pelo resultado.
      expect(before[0].texts).toContain('A opção 2 sai 7% mais barata que a opção 1.');
      expect(shown).not.toContain('A opção 2 sai 7% mais barata que a opção 1.');
      expect(shown).not.toContain(WAITING_TEXT);
      expect(after).toHaveLength(1);
      expect(after[0].label).toBe('A opção 2 sai 7% mais barata que a opção 1.');
      expect(after[0].accessible).toBe(true);
      expect(announce).not.toHaveBeenCalled();
    });

    it('navegador: um aria-live escondido fala depois da pausa; o texto visível não é região viva', async () => {
      const { announce, before, after } = await fillOn('web');
      expect(before).toHaveLength(1);
      expect(before[0].text).toBe(WAITING_TEXT);
      expect(after).toHaveLength(1);
      expect(after[0].text).toBe('A opção 2 sai 7% mais barata que a opção 1.');
      // O texto visível já mudou antes da pausa.
      expect(texts(calculator!.toJSON())).toContain('A opção 2 sai 7% mais barata que a opção 1.');
      // O resultado visível: sem rótulo, e o leitor de tela lê o texto dele.
      const visible = calculator!.root.findAll((node) => node.props.accessible === false && typeof node.type === 'string');
      expect(visible.length).toBeGreaterThan(0);
      expect(visible.every((node) => node.props.accessibilityLabel === undefined && node.props['aria-live'] === undefined)).toBe(true);
      expect(announce).not.toHaveBeenCalled();
    });
  });

  it('o voltar do Android também fecha', async () => {
    await mount();
    await openCalculator();
    const modal = renderer!.root.findByType(PriceCalculator).findByProps({ animationType: 'slide' });
    await act(async () => modal.props.onRequestClose());
    expect(renderer!.root.findAllByType(PriceCalculator)).toHaveLength(0);
  });

  it('a lista arquivada também tem a calculadora', async () => {
    mockQueries.list = loaded({ id: 'l1', name: 'Churrasco', kind: 'mercado', archived_at: '2026-10-20T12:00:00Z', created_at: '2026-10-01T12:00:00Z' });
    await mount();
    expect(mockSeen.options?.title).toBe('Churrasco');
    await openCalculator();
    expect(renderer!.root.findAllByType(PriceCalculator)).toHaveLength(1);
  });

  it('a lista ainda não aberta sem internet não mostra o ícone', async () => {
    mockQueries.list = paused();
    await mount();
    expect(mockSeen.options?.headerRight).toBeUndefined();
  });

  it('a lista que volta a carregar sem internet tira o ícone que o Stack guardou', async () => {
    await mount();
    expect(mockSeen.options?.headerRight).toBeDefined();
    mockQueries.list = paused();
    await act(async () => renderer!.update(<ShoppingListScreen />));
    expect(texts(renderer!.toJSON())).toContain('Sem internet');
    expect('headerRight' in mockSeen.options!).toBe(true);
    expect(mockSeen.options?.headerRight).toBeUndefined();
  });

  it('a lista que volta a carregar (ou falha) tira o ícone que o Stack guardou, porque ali ele não abriria nada', async () => {
    await mount();
    expect(mockSeen.options?.headerRight).toBeDefined();
    mockQueries.list = onTheWay();
    await act(async () => renderer!.update(<ShoppingListScreen />));
    expect(renderer!.root.findAllByType(Loading)).toHaveLength(1);
    expect('headerRight' in mockSeen.options!).toBe(true);
    expect(mockSeen.options?.headerRight).toBeUndefined();

    mockQueries.list = loaded({ id: 'l1', name: 'Mercado', kind: 'mercado', archived_at: null, created_at: '2026-10-01T12:00:00Z' });
    await act(async () => renderer!.update(<ShoppingListScreen />));
    expect(mockSeen.options?.headerRight).toBeDefined();
    mockQueries.list = failed();
    await act(async () => renderer!.update(<ShoppingListScreen />));
    expect(renderer!.root.findAllByType(ErrorNotice)).toHaveLength(1);
    expect('headerRight' in mockSeen.options!).toBe(true);
    expect(mockSeen.options?.headerRight).toBeUndefined();
  });

  it('o campo com algo a conferir diz isso embaixo dele, e o resultado também', async () => {
    await mount();
    await openCalculator();
    await type('Preço da opção 1, em reais', 'abc');
    await type('Quantidade da opção 1', '500');
    await type('Preço da opção 2, em reais', '16,50');
    await type('Quantidade da opção 2', '1.500');
    expect(field('Preço da opção 1, em reais').props.hint).toBe('Confira o preço.');
    expect(field('Preço da opção 1, em reais').props.hintColor).toBe('danger');
    expect(field('Quantidade da opção 1').props.hint).toBeUndefined();
    expect(field('Quantidade da opção 2').props.hint).toBe('1.500 é 1500 ou 1,5? Escreva sem ponto ou com vírgula.');
    // O leitor de tela ouve a dica no próprio campo.
    expect(field('Preço da opção 1, em reais').props.accessibilityHint).toBe('Confira o preço.');
    expect(field('Quantidade da opção 1').props.accessibilityHint).toBeUndefined();
    expect(field('Quantidade da opção 2').props.accessibilityHint).toBe(field('Quantidade da opção 2').props.hint);
    const page = texts(renderer!.toJSON()).join('\n');
    expect(page).toContain('Confira o preço da opção 1.');
    expect(page).toContain('Confira a quantidade da opção 2.');
    expect(page).not.toContain('Preencha o preço');
    // "8," a caminho de "8,90" não é erro.
    await type('Preço da opção 1, em reais', '8,');
    expect(field('Preço da opção 1, em reais').props.hint).toBeUndefined();
    expect(field('Preço da opção 1, em reais').props.accessibilityHint).toBeUndefined();
    expect(texts(renderer!.toJSON()).join('\n')).toContain('R$ 16,00 o kg');
  });

  it('o teclado não cobre o resultado: a lista sobe acima dele, e arrastar fecha o teclado', async () => {
    await mount();
    await openCalculator();
    const scroll = renderer!.root.findByType(PriceCalculator).findByType(ScrollView);
    expect(scroll.props.keyboardDismissMode).toBe('on-drag');
    expect(scroll.props.automaticallyAdjustKeyboardInsets).toBe(true);
  });

  it('"Adicionar opção" tem o toque de 44, e tirar uma opção não usa o X de fechar', async () => {
    await mount();
    await openCalculator();
    const add = renderer!.root.findByType(PriceCalculator).findAllByType(Button).find((b) => b.props.title === 'Adicionar opção')!;
    expect(add.props.style).toEqual(expect.objectContaining({ minHeight: 44 }));
    // O leitor de tela e o comando de voz usam o nome que está na tela.
    expect(add.props.accessibilityLabel).toBeUndefined();
    expect(add.props.icon).toBe('plus');
    await act(async () => add.props.onPress());
    const remove = renderer!.root.findByType(PriceCalculator).findAll((node) => node.props.label === 'Remover a opção 3' && Boolean(node.props.icon))[0];
    const close = renderer!.root.findByType(PriceCalculator).findAll((node) => node.props.label === 'Fechar' && Boolean(node.props.icon))[0];
    expect(remove.props.icon).not.toBe(close.props.icon);
  });
});

describe('a primeira lista, logo depois de criar a casa no começo', () => {
  it('abre com o catálogo de itens comuns e a faixa; "Agora não" tira a faixa e a pessoa fica na lista', async () => {
    mockRouteParams.primeira = '1';
    jest.mocked(router.back).mockClear();
    jest.mocked(router.setParams).mockClear();
    const text = await mount();
    expect(mockSeen.picker!.visible).toBe(true);
    expect(text).toContain(FIRST_LIST_TEXT);
    const skip = renderer!.root.findAll((node) => node.props.title === FIRST_LIST_SKIP && typeof node.props.onPress === 'function')[0];
    await act(async () => skip.props.onPress());
    expect(router.setParams).toHaveBeenCalledWith({ primeira: undefined });
    expect(router.back).not.toHaveBeenCalled();
  });

  it('sem `primeira`, a lista de sempre: nem faixa, nem catálogo aberto', async () => {
    const text = await mount();
    expect(mockSeen.picker!.visible).toBe(false);
    expect(text).not.toContain(FIRST_LIST_TEXT);
  });
});
