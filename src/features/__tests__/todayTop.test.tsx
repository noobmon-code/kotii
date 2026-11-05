import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Children, type ReactElement } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { router } from 'expo-router';

import TodayScreen from '@/app/(tabs)/index';
import type { HouseholdLocation } from '@/data/weather';
import { todayISO } from '@/domain/dates';
import { defaultSky } from '@/domain/sky';
import type { Forecast, WeatherHour } from '@/domain/weather';
import { SkyHeader, washStops } from '@/features/SkyHeader';
import { AngledGradient } from '@/ui/gradient';
import { Tile } from '@/ui/primitives';

// O topo da tela Hoje: sem o desenho do clima e sem o cartão do clima, o céu de agora continua no véu de cor atrás
// do texto. O véu segue a previsão do bairro da casa (o céu da hora); sem bairro ou sem previsão, o céu de sempre da
// hora. O texto do topo usa a largura toda (nada de espaço guardado para um desenho).

const PINHEIROS: HouseholdLocation = { label: 'Pinheiros, São Paulo', latitude: -23.56, longitude: -46.69, source: 'cep' };

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockWeather = {
  location: null as HouseholdLocation | null,
  forecast: undefined as Forecast | undefined,
  forecastFor: [] as (HouseholdLocation | null | undefined)[],
};
const mockQuery = (data: unknown = []) => ({ data, isRefetching: false, isSuccess: true, refetch: jest.fn() });
// As listas abertas da casa e as que este aparelho abriu (o atalho das listas abre a última).
const mockLists = { data: [] as unknown };
const mockOpened = { map: new Map<string, number>() as ReadonlyMap<string, number> | null };
jest.mock('@/lib/openedLists', () => ({ useOpenedLists: () => mockOpened.map }));
// A janela de um celular de 360 (só no teste do nome comprido); fora dele, a janela de sempre do Jest.
const mockWindow: { size: { width: number; height: number; scale: number; fontScale: number } | null } = { size: null };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => {
  const actual = jest.requireActual<{ default: () => unknown }>('react-native/Libraries/Utilities/useWindowDimensions');
  return { __esModule: true, default: () => mockWindow.size ?? actual.default() };
});
jest.mock('@/data/weather', () => ({
  useHouseholdLocation: () => ({ data: mockWeather.location }),
  useForecast: (location: HouseholdLocation | null | undefined) => {
    mockWeather.forecastFor.push(location);
    return { data: location ? mockWeather.forecast : undefined };
  },
  useRefreshWeather: () => () => undefined,
}));
jest.mock('@/data/home', () => ({
  toSchedules: () => [],
  useChoreRotations: () => mockQuery(),
  useChores: () => mockQuery(),
  useCompleteChore: () => ({ mutate: jest.fn(), isPending: false }),
  useDoses: () => mockQuery(),
  useMedications: () => mockQuery(),
  usePantry: () => mockQuery(),
  useToggleDose: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/data/family', () => ({
  useFamilyCalendar: () => ({ calendar: { events: [], days: [], people: [] }, refetch: jest.fn() }),
}));
jest.mock('@/data/finance', () => ({
  useBills: () => mockQuery(),
  useBudgets: () => mockQuery(),
  useRecentBillPayments: () => mockQuery(),
  useSpending: () => mockQuery(undefined),
}));
jest.mock('@/data/house', () => ({ useDocuments: () => mockQuery(), useEquipmentList: () => mockQuery() }));
jest.mock('@/data/market', () => ({
  useAddItemsToList: () => ({ mutateAsync: jest.fn() }),
  useProducts: () => mockQuery(),
  usePurchaseRecords: () => mockQuery(),
  useShoppingLists: () => ({ ...mockQuery(), data: mockLists.data }),
}));
jest.mock('@/data/marketTrips', () => ({ useRefreshMarketTrips: () => () => undefined }));
jest.mock('@/data/menu', () => ({ useMenu: () => mockQuery() }));
jest.mock('@/data/pendingReceipts', () => ({ usePendingReceipts: () => ({ pending: [] }) }));
jest.mock('@/data/receipts', () => ({ useDraftReceipts: () => mockQuery() }));
jest.mock('@/data/supplies', () => ({ useSupplies: () => mockQuery({ supplies: [], available: true }) }));
// As partes de baixo da tela ficam de fora: aqui só importa o topo.
jest.mock('@/features/ChoresPanel', () => ({ announceCompletion: jest.fn() }));
jest.mock('@/features/finance/BillsPanel', () => ({ BillRow: () => null }));
jest.mock('@/features/finance/PayBillModal', () => ({ PayBillModal: () => null }));
jest.mock('@/features/health/HealthTodaySections', () => ({
  hasHealthToday: () => false,
  healthTodayCount: () => 0,
  HealthTodaySections: () => null,
}));
jest.mock('@/features/health/MedicationSections', () => ({
  DoseSubtitle: () => null,
  MedicationRefills: () => null,
  useRefills: () => ({ rows: [], attention: [] }),
}));
jest.mock('@/features/health/useHealthOverview', () => ({
  useHealthOverview: () => ({ queries: [], loaded: true, people: [], upcoming: [], toConfirm: [], vaccinesDue: [], workoutsToday: [], drafts: [] }),
}));
jest.mock('@/features/InstallAppCard', () => ({ InstallAppCard: () => null }));
jest.mock('@/features/MarketTrip', () => ({ MarketTripBanner: () => null }));
jest.mock('@/features/PantryMenu', () => ({ usePantryMenu: () => ({ open: jest.fn(), element: null }) }));
jest.mock('@/features/PendingReceiptCard', () => ({ PendingReceiptRow: () => null }));
jest.mock('@/features/RecentPurchases', () => ({
  useJustListed: () => ({ pending: new Set<string>(), add: jest.fn(), drop: jest.fn() }),
}));
jest.mock('@/features/SuppliesSection', () => ({ SuppliesTodaySection: () => null }));
jest.mock('@/features/TermsNotice', () => ({ TermsNoticeCard: () => null }));
jest.mock('@/lib/auth', () => {
  const me = { household_id: 'h1', user_id: 'ana', display_name: 'Ana', role: 'owner' };
  return {
    useHousehold: () => ({
      data: { household: { id: 'h1', name: 'Casa da Ana' }, members: [me], me, households: [{ id: 'h1', name: 'Casa da Ana', role: 'owner' }] },
    }),
  };
});
jest.mock('@/lib/supabase', () => ({ errorMessage: (error: unknown) => String(error) }));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn() }));
jest.mock('@/ui/iconArt', () => ({ IconArt: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

let renderer: ReactTestRenderer | undefined;

const rawText = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(rawText).join(''));

const rain = (time: string): WeatherHour => ({ time, temp: 20, humidity: 90, rainChance: 90, rain: 1, gusts: 10, uv: 1, code: 61 });

/** Chuva na hora da casa de agora e na seguinte (sem fuso na previsão, a hora é a do aparelho). */
function rainNow(): Forecast {
  const now = new Date();
  const later = new Date(now.getTime() + 60 * 60 * 1000);
  const stamp = (d: Date) => `${todayISO(d)}T${String(d.getHours()).padStart(2, '0')}:00`;
  return { hours: [rain(stamp(now)), rain(stamp(later))], days: [], utcOffsetSeconds: null };
}

async function mount() {
  await act(async () => {
    renderer = create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
        <TodayScreen />
      </SafeAreaProvider>,
    );
  });
}

beforeEach(() => {
  mockWindow.size = null;
  mockLists.data = [];
  mockOpened.map = new Map();
  jest.mocked(router.push).mockClear();
  mockWeather.location = null;
  mockWeather.forecast = undefined;
  mockWeather.forecastFor = [];
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('o topo da tela Hoje', () => {
  it('o véu segue o céu da hora pela previsão do bairro da casa', async () => {
    mockWeather.location = PINHEIROS;
    mockWeather.forecast = rainNow();
    await mount();
    expect(mockWeather.forecastFor).toContain(PINHEIROS);
    const header = renderer!.root.findByType(SkyHeader);
    expect(header.props.sky).toBe('chuva');
    // A primeira camada do véu é a do céu (as outras só esmaecem as bordas numa janela larga).
    expect(header.findAllByType(AngledGradient)[0].props.stops).toEqual(washStops('chuva', false));
  });

  it('sem bairro (e então sem previsão), o céu de sempre da hora', async () => {
    await mount();
    expect(renderer!.root.findByType(SkyHeader).props.sky).toBe(defaultSky(new Date()));
  });

  it('sem o desenho do clima nem o cartão do clima: o texto do topo usa a largura toda', async () => {
    mockWeather.location = PINHEIROS;
    mockWeather.forecast = rainNow();
    await mount();
    const header = renderer!.root.findByType(SkyHeader);
    // Nenhuma imagem no topo, e o que vai dentro dele não guarda espaço à direita.
    expect(header.findAll((node) => typeof node.type !== 'string' && (node.type as { name?: string }).name === 'Image')).toHaveLength(0);
    // Os blocos que a tela passa para dentro do topo (antes, um View com o paddingRight do desenho em volta da data e
    // da saudação) não guardam margem à direita. O link "Ver a agenda" tem a sua, da pílula, e não é um View.
    const blocks = (Children.toArray(header.props.children) as ReactElement<{ style?: StyleProp<ViewStyle> }>[]).filter(
      (element) => element.type === View,
    );
    expect(blocks.length).toBeGreaterThan(0);
    for (const element of blocks) expect(StyleSheet.flatten(element.props.style)?.paddingRight).toBeUndefined();
    // Nada na tela fala do clima nem leva à tela dele (o bairro se define em Configurações).
    const text = rawText(renderer!.root);
    expect(text).not.toMatch(/clima|bairro|Onde fica a casa/i);
    expect(text).not.toContain('Pinheiros');
  });
});

describe('o atalho das listas de compras', () => {
  const lists = [
    { id: 'm1', name: 'Mercado', kind: 'mercado', archived_at: null, created_at: '2026-10-01T10:00:00Z', pending: 12, total: 12, items: [] },
    { id: 'f1', name: 'Farmácia', kind: 'farmacia', archived_at: null, created_at: '2026-10-20T10:00:00Z', pending: 1, total: 3, items: [] },
  ];
  const cartTile = () => renderer!.root.findAllByType(Tile).find((tile) => tile.props.art === 'carrinho')!;
  const button = (label: string) =>
    renderer!.root.find((node) => typeof node.type !== 'string' && node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === label);

  it('sem lista aberta lembrada: a de mercado mais nova, com o nome e quanto falta comprar', async () => {
    mockLists.data = lists;
    await mount();
    const pressable = button('Abrir a lista Mercado, 12 itens a comprar');
    expect(rawText(pressable)).toContain('Mercado');
    expect(rawText(pressable)).toContain('12 a comprar');
    await act(async () => pressable.props.onPress());
    expect(router.push).toHaveBeenCalledWith({ pathname: '/lista/[id]', params: { id: 'm1' } });
  });

  it('a lista que este aparelho abriu por último ganha', async () => {
    mockLists.data = lists;
    mockOpened.map = new Map([['f1', 1]]);
    await mount();
    const tile = cartTile();
    expect(tile.props.label).toBe('Farmácia');
    expect(tile.props.caption).toBe('1 a comprar');
    await act(async () => tile.props.onPress());
    expect(router.push).toHaveBeenCalledWith({ pathname: '/lista/[id]', params: { id: 'f1' } });
  });

  it('um nome comprido de uma palavra só num celular de 360: a letra diminui, e a palavra não quebra no meio', async () => {
    mockWindow.size = { width: 360, height: 800, scale: 3, fontScale: 1 };
    mockLists.data = [{ ...lists[0], name: 'Supermercado' }];
    await mount();
    const tile = cartTile();
    expect(tile.props.label).toBe('Supermercado');
    // A largura do rótulo de cada um dos três atalhos lado a lado: (320 - 2 × 12) / 3 - 2 × (8 + 1).
    expect(tile.props.fitLabelWidth).toBeCloseTo((320 - 24) / 3 - 18, 5);
    const label = tile.findAll((node) => node.props.children === 'Supermercado' && node.props.numberOfLines)[0];
    expect(StyleSheet.flatten(label.props.style).fontSize).toBeLessThan(14);
    expect(label.props.numberOfLines).toBe(2);
    expect(button('Abrir a lista Supermercado, 12 itens a comprar')).toBeDefined();
  });

  it.each([
    ['sem lista aberta', [] as unknown, new Map<string, number>() as ReadonlyMap<string, number> | null],
    ['com as listas ainda sem chegar', undefined, new Map<string, number>()],
    ['antes de ler a memória do aparelho', lists, null],
  ])('%s: o atalho de sempre, para Casa → Compras', async (_, data, map) => {
    mockLists.data = data;
    mockOpened.map = map;
    await mount();
    const pressable = button('Listas de compras');
    expect(rawText(pressable)).toBe('Listas de compras');
    expect(cartTile().props.caption).toBeUndefined();
    await act(async () => pressable.props.onPress());
    expect(router.push).toHaveBeenCalledWith({ pathname: '/casa', params: { aba: 'compras' } });
  });
});

describe('o atalho "Ler nota"', () => {
  it('abre a câmera do QR direto, sem o menu de antes', async () => {
    await mount();
    const tiles = renderer!.root.findAllByType(Tile);
    const tile = tiles.find((t) => t.props.label === 'Ler nota');
    expect(tile).toBeDefined();
    expect(tiles.some((t) => t.props.label === 'Escanear nota')).toBe(false);
    await act(async () => tile!.props.onPress());
    expect(router.push).toHaveBeenCalledWith('/nota/qrcode');
    expect(rawText(renderer!.root)).not.toContain('Adicionar nota fiscal');
  });
});
