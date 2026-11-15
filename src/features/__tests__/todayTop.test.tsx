import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Children, type ReactElement } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import TodayScreen from '@/app/(tabs)/index';
import type { HouseholdLocation } from '@/data/weather';
import { todayISO } from '@/domain/dates';
import { defaultSky } from '@/domain/sky';
import { MARKET_LIST_OFFLINE, MARKET_LIST_SHORTCUT } from '@/domain/today';
import type { Forecast, WeatherHour } from '@/domain/weather';
import { SkyHeader, washStops } from '@/features/SkyHeader';
import { AngledGradient } from '@/ui/gradient';

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
// As listas abertas que o aparelho tem, e o pedido ao servidor do atalho "Lista de mercado".
const mockMarket = {
  lists: [] as { id: string; name: string; kind: string; archived_at: string | null; created_at: string; pending: number; items: [] }[],
  openList: jest.fn(async () => ({ id: 'mercado-do-servidor', name: 'Mercado' })),
};
jest.mock('@/data/market', () => ({
  useAddItemsToList: () => ({ mutateAsync: jest.fn() }),
  useOpenMarketList: () => ({ mutateAsync: mockMarket.openList }),
  usePurchaseRecords: () => mockQuery(),
  useShoppingLists: () => mockQuery(mockMarket.lists),
}));
jest.mock('@/data/health', () => ({ usePeople: () => mockQuery() }));
jest.mock('@/data/firstSteps', () => ({
  useAnyList: () => mockQuery(false),
  useAnyReceipt: () => mockQuery(false),
  useAnyPantryItem: () => mockQuery(false),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
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
  useHealthRows: () => ({ workout: () => null, appointment: () => null, toConfirm: () => null, vaccine: () => null, draft: () => null }),
}));
jest.mock('@/features/health/MedicationSections', () => ({
  DoseSubtitle: () => null,
  useRefillRows: () => () => null,
  useRefills: () => ({ rows: [], attention: [] }),
}));
jest.mock('@/features/health/useHealthOverview', () => ({
  useHealthOverview: () => ({ queries: [], loaded: true, people: [], upcoming: [], toConfirm: [], vaccinesDue: [], workoutsToday: [], drafts: [] }),
}));
jest.mock('@/features/InstallAppCard', () => ({ InstallAppCard: () => null }));
jest.mock('@/features/MarketTrip', () => ({ MarketTripBanner: () => null }));
jest.mock('@/features/PendingReceiptCard', () => ({ pendingReceiptListRow: () => null }));
jest.mock('@/features/RecentPurchases', () => ({
  useJustListed: () => ({ pending: new Set<string>(), add: jest.fn(), drop: jest.fn() }),
}));
jest.mock('@/features/SuppliesSection', () => ({ useSupplyTodayRows: () => () => null }));
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
const mockNotify = jest.fn();
jest.mock('@/ui/dialogs', () => ({ notify: (...args: unknown[]) => mockNotify(...args) }));
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
  mockWeather.location = null;
  mockWeather.forecast = undefined;
  mockWeather.forecastFor = [];
  mockMarket.lists = [];
  mockMarket.openList.mockClear();
  mockNotify.mockClear();
  jest.mocked(router.push).mockClear();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  onlineManager.setOnline(true);
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

describe('os atalhos da tela Hoje', () => {
  const tile = (label: string) => renderer!.root.findAll((node) => node.props.label === label && typeof node.props.onPress === 'function')[0];
  const list = (id: string, kind: string, createdAt: string, archived: string | null = null) => ({
    id,
    name: id,
    kind,
    archived_at: archived,
    created_at: createdAt,
    pending: 0,
    items: [] as [],
  });

  it('são "Escanear", "Lista de mercado" (antes "Listas de compras", que fazia o mesmo que a aba) e "Criar nova tarefa"', async () => {
    await mount();
    const labels = renderer!.root.findAll((node) => typeof node.props.wash === 'string').map((node) => node.props.label);
    expect(labels).toEqual(['Escanear', MARKET_LIST_SHORTCUT, 'Criar nova tarefa']);
    expect(rawText(renderer!.root)).not.toContain('Listas de compras');
    expect(rawText(renderer!.root)).not.toContain('Escanear nota');
  });

  it('"Escanear" abre a câmera direto, sem perguntar antes o que a pessoa vai ler', async () => {
    await mount();
    const tile = renderer!.root.findAll((node) => typeof node.props.wash === 'string' && node.props.label === 'Escanear')[0];
    await act(async () => tile.props.onPress());
    expect(router.push).toHaveBeenLastCalledWith('/escanear');
  });

  it('"Lista de mercado" pergunta ao servidor a lista de mercado aberta mais recente (ou uma nova) e abre ela', async () => {
    // A guardada aqui pode ter sido arquivada em outro aparelho: com internet, quem diz é o servidor.
    mockMarket.lists = [list('guardada', 'mercado', '2026-11-01T10:00:00Z')];
    await mount();
    await act(async () => tile(MARKET_LIST_SHORTCUT).props.onPress());
    expect(mockMarket.openList).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/lista/[id]', params: { id: 'mercado-do-servidor' } });
  });

  it('dois toques seguidos fazem um pedido só (sem lista aberta, dois criariam duas)', async () => {
    let answer: (value: { id: string; name: string }) => void = () => undefined;
    mockMarket.openList.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    await mount();
    await act(async () => {
      tile(MARKET_LIST_SHORTCUT).props.onPress();
      tile(MARKET_LIST_SHORTCUT).props.onPress();
    });
    expect(mockMarket.openList).toHaveBeenCalledTimes(1);
    await act(async () => answer({ id: 'nova', name: 'Mercado' }));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/lista/[id]', params: { id: 'nova' } });
  });

  it('sem internet, abre a lista de mercado aberta mais recente que o aparelho guardou, sem pedir nada', async () => {
    onlineManager.setOnline(false);
    mockMarket.lists = [
      list('farmacia', 'farmacia', '2026-11-09T10:00:00Z'),
      list('antiga', 'mercado', '2026-10-01T10:00:00Z'),
      list('nova', 'mercado', '2026-11-05T10:00:00Z'),
    ];
    await mount();
    await act(async () => tile(MARKET_LIST_SHORTCUT).props.onPress());
    expect(mockMarket.openList).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith({ pathname: '/lista/[id]', params: { id: 'nova' } });
  });

  it('sem internet e sem lista de mercado guardada, avisa (criar a lista precisa de internet)', async () => {
    onlineManager.setOnline(false);
    mockMarket.lists = [list('farmacia', 'farmacia', '2026-11-09T10:00:00Z')];
    await mount();
    await act(async () => tile(MARKET_LIST_SHORTCUT).props.onPress());
    expect(mockMarket.openList).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(mockNotify).toHaveBeenCalledWith(MARKET_LIST_SHORTCUT, MARKET_LIST_OFFLINE);
  });

  it('o pedido que falha avisa, e o próximo toque pergunta de novo', async () => {
    mockMarket.openList.mockImplementationOnce(async () => {
      throw new Error('falhou');
    });
    await mount();
    await act(async () => tile(MARKET_LIST_SHORTCUT).props.onPress());
    expect(mockNotify).toHaveBeenCalledWith('Erro', 'Error: falhou');
    expect(router.push).not.toHaveBeenCalled();
    await act(async () => tile(MARKET_LIST_SHORTCUT).props.onPress());
    expect(mockMarket.openList).toHaveBeenCalledTimes(2);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/lista/[id]', params: { id: 'mercado-do-servidor' } });
  });
});
