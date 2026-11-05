import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import FamilyScreen from '@/app/(tabs)/familia';
import { scrollTargetY } from '@/domain/scrollTarget';
import { SPOTLIGHT_TICK_MS } from '@/features/useReminderSpotlight';
import { PALETTES, withAlpha } from '@/ui/theme';

// A aba Família de verdade aberta com `?aviso=supplies` (o "Abrir os avisos" das reposições): ela lê o parâmetro,
// tira o parâmetro da rota, passa a rolagem ao Screen e o destaque à seção dos avisos. O que o hook faz com isso está
// em reminderSpotlight.test; aqui, só que a aba liga as peças (sem isso, a pessoa cai no alto da aba de novo).

type Box = { top: number; height: number } | null;
// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockMeasure: { area: { viewport: number; content: number } | null; nodes: Record<string, Box> } = { area: null, nodes: {} };
const mockParams: { aviso?: string } = {};
const mockNavigation = { setParams: jest.fn() };

jest.mock('@/ui/scrollMeasure', () => ({
  measureScrollArea: async () => mockMeasure.area,
  measureInScroll: async (_scroll: unknown, node: { props?: { testID?: string } } | null) => {
    const id = node?.props?.testID;
    return id ? (mockMeasure.nodes[id] ?? null) : null;
  },
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => mockParams,
  useNavigation: () => mockNavigation,
}));
jest.mock('@/lib/reminders', () => ({
  remindersSupported: true,
  marketTripPushSupported: false,
  REMINDER_PLACE: 'neste celular',
  PERMISSION_HINT: 'Permita as notificações do Kotii nas configurações do celular.',
  remindersUnavailableReason: () => 'Este aparelho não recebe notificações.',
  getHouseReminderKinds: async () => ({ bills: false, documents: false, chores: false, appointments: false, vaccines: false, weather: false, supplies: false }),
  setHouseReminderKind: async () => true,
  syncHouseReminders: async () => undefined,
  getMarketTripPush: async () => null,
  setMarketTripPush: async () => true,
}));
jest.mock('@/features/useReminderSync', () => ({
  syncOtherHouses: async () => undefined,
  useHouseReminderData: () => ({ data: null }),
  useHouseReminderTarget: () => null,
}));
jest.mock('@/data/supplies', () => ({ useSupplies: () => ({ data: { available: true } }) }));
jest.mock('@/data/health', () => ({ usePeople: () => ({ data: [] }) }));
jest.mock('@/data/home', () => ({ useKidPoints: () => ({ data: {} }) }));
jest.mock('@/data/household', () => {
  const mutation = () => ({ mutate: jest.fn(), isPending: false });
  return {
    LastMemberError: class extends Error {},
    useLeaveHousehold: mutation,
    useRegenerateInviteCode: mutation,
    useRemoveMember: mutation,
  };
});
jest.mock('@/lib/auth', () => {
  const me = { household_id: 'h1', user_id: 'u1', display_name: 'Ana', role: 'owner' };
  const household = { id: 'h1', name: 'Casa da Ana', invite_code: 'ABC234', created_by: 'u1' };
  return {
    useAuth: () => ({ session: { user: { id: 'u1', email: 'ana@exemplo.com' } } }),
    useHousehold: () => ({ data: { household, members: [me], me, households: [household] }, refetch: jest.fn() }),
  };
});
jest.mock('@/lib/supabase', () => ({
  supabase: {},
  unwrap: (result: { data: unknown }) => result.data,
  errorMessage: (error: unknown) => String(error),
}));
jest.mock('@/ui/dialogs', () => ({ confirmAction: jest.fn(), notify: jest.fn() }));
jest.mock('@/features/AiUsageSection', () => ({ AiUsageSection: () => null }));
jest.mock('@/features/DocumentsSection', () => ({ DocumentsSection: () => null }));
jest.mock('@/features/SharedPrices', () => ({ SharedPricesAbout: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

const SECTION = { top: 1200, height: 700 };
const ROW = { top: 1300, height: 90 };
const AREA = { viewport: 700, content: 3000 };
const HIGHLIGHT = withAlpha(PALETTES.light.primary, 0.12);

let renderer: ReactTestRenderer | undefined;
let client: QueryClient;

async function mount() {
  await act(async () => {
    renderer = create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
        <QueryClientProvider client={client}>
          <FamilyScreen />
        </QueryClientProvider>
      </SafeAreaProvider>,
      { createNodeMock: () => ({}) },
    );
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(SPOTLIGHT_TICK_MS);
  });
}

const scrollView = () => renderer!.root.findByType(ScrollView);
const tinted = () =>
  renderer!.root
    .findAll((node: ReactTestInstance) => typeof node.type === 'string' && String(node.props.testID ?? '').startsWith('aviso-'))
    .filter((node) => StyleSheet.flatten(node.props.style).backgroundColor === HIGHLIGHT)
    .map((node) => node.props.testID as string);

beforeEach(() => {
  jest.useFakeTimers();
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  mockMeasure.area = AREA;
  mockMeasure.nodes = { 'avisos-da-casa': SECTION, 'aviso-supplies': ROW, 'aviso-weather': { top: 1500, height: 90 } };
  delete mockParams.aviso;
  jest.clearAllMocks();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  client.clear();
  jest.useRealTimers();
});

describe('aba Família aberta por "Abrir os avisos"', () => {
  it('tira o parâmetro, rola até o interruptor do tipo e o destaca', async () => {
    mockParams.aviso = 'supplies';
    await mount();
    expect(mockNavigation.setParams).toHaveBeenCalledWith({ aviso: undefined });
    const scrollTo = (scrollView().instance as { scrollTo: jest.Mock }).scrollTo;
    expect(scrollTo).toHaveBeenCalledWith({
      y: scrollTargetY({ sectionTop: SECTION.top, row: ROW, viewport: AREA.viewport, content: AREA.content }),
      animated: false,
    });
    expect(tinted()).toEqual(['aviso-supplies']);
    // A tela manda a posição da rolagem enquanto o pedido dura (no navegador, é como se sabe que a pessoa rolou).
    expect(scrollView().props.onScroll).toEqual(expect.any(Function));
    expect(scrollView().props.onScrollBeginDrag).toEqual(expect.any(Function));
  });

  it('a visita de sempre (sem parâmetro): nada sai da rota, nada rola, nada se destaca', async () => {
    await mount();
    expect(mockNavigation.setParams).not.toHaveBeenCalled();
    expect((scrollView().instance as { scrollTo: jest.Mock }).scrollTo).not.toHaveBeenCalled();
    expect(tinted()).toEqual([]);
    expect(scrollView().props.onScroll).toBeUndefined();
  });
});
