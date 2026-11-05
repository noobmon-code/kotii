import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccessibilityInfo, Platform, ScrollView, StyleSheet, Switch } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { SCROLL_TARGET_TOP, scrollTargetY } from '@/domain/scrollTarget';
import { HouseRemindersSection } from '@/features/HouseRemindersSection';
import {
  SPOTLIGHT_FOCUS_DELAY_MS,
  SPOTLIGHT_MS,
  SPOTLIGHT_SCROLL_SLOP,
  SPOTLIGHT_TICK_MS,
  SPOTLIGHT_WAIT_MS,
  useReminderSpotlight,
} from '@/features/useReminderSpotlight';
import { Screen } from '@/ui/primitives';
import { PALETTES, SCREEN_PADDING, withAlpha } from '@/ui/theme';

// "Abrir os avisos" de outra tela abre a aba Família com `?aviso=<tipo>`: a aba tira o parâmetro da rota, rola até o
// interruptor do tipo (medido na hora) e destaca a linha por um momento, acompanhando a linha enquanto o que vem
// antes carrega, até a pessoa rolar. A seção de verdade, com as medidas trocadas por respostas prontas; a navegação é
// de mentira aqui (o roteador de verdade está em reminderSpotlightRouter.test).

type Box = { top: number; height: number } | null;
// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockMeasure: { area: { viewport: number; content: number } | null; nodes: Record<string, Box> } = { area: null, nodes: {} };
const mockDevice = { reminders: true, supplies: true as boolean | undefined };

jest.mock('@/ui/scrollMeasure', () => ({
  measureScrollArea: async () => mockMeasure.area,
  measureInScroll: async (_scroll: unknown, node: { props?: { testID?: string } } | null) => {
    const id = node?.props?.testID;
    return id ? (mockMeasure.nodes[id] ?? null) : null;
  },
}));
const mockNavigation = { setParams: jest.fn() };
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useNavigation: () => mockNavigation }));
jest.mock('@/lib/reminders', () => ({
  get remindersSupported() {
    return mockDevice.reminders;
  },
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
jest.mock('@/lib/auth', () => ({ useHousehold: () => ({ data: undefined }) }));
jest.mock('@/data/supplies', () => ({
  useSupplies: () => ({ data: mockDevice.supplies === undefined ? undefined : { available: mockDevice.supplies } }),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: {},
  unwrap: (result: { data: unknown }) => result.data,
  errorMessage: (error: { message?: string }) => error?.message ?? 'Algo deu errado.',
}));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn() }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

const SECTION = { top: 1200, height: 700 };
const ROW = { top: 1300, height: 90 };
const AREA = { viewport: 700, content: 3000 };
const HIGHLIGHT = withAlpha(PALETTES.light.primary, 0.12);

function Harness({ param }: { param?: string }) {
  const reminders = useReminderSpotlight(param);
  return (
    <Screen scrollRef={reminders.scrollRef} onScrollBeginDrag={reminders.onScrollBeginDrag} onScroll={reminders.onScroll}>
      <HouseRemindersSection spotlight={reminders.spotlight} />
    </Screen>
  );
}

let renderer: ReactTestRenderer | undefined;
let client: QueryClient;

const tree = (param?: string) => (
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
    <QueryClientProvider client={client}>
      <Harness param={param} />
    </QueryClientProvider>
  </SafeAreaProvider>
);

async function mount(param?: string) {
  await act(async () => {
    renderer = create(tree(param), { createNodeMock: () => ({}) });
  });
  await advance(0);
}

async function rerender(param?: string) {
  await act(async () => {
    renderer!.update(tree(param));
  });
  await advance(0);
}

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

const scrollTo = () => (renderer!.root.findByType(ScrollView).instance as { scrollTo: jest.Mock }).scrollTo;
const box = (kind: string) =>
  renderer!.root.find((node: ReactTestInstance) => typeof node.type === 'string' && node.props.testID === `aviso-${kind}`);
const tinted = () =>
  renderer!.root
    .findAll((node: ReactTestInstance) => typeof node.type === 'string' && String(node.props.testID ?? '').startsWith('aviso-'))
    .filter((node) => StyleSheet.flatten(node.props.style).backgroundColor === HIGHLIGHT)
    .map((node) => node.props.testID as string);
const expectedY = (section: Box, row: Box) => scrollTargetY({ sectionTop: section!.top, row, viewport: AREA.viewport, content: AREA.content });

beforeEach(() => {
  jest.useFakeTimers();
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  mockMeasure.area = AREA;
  mockMeasure.nodes = { 'avisos-da-casa': SECTION, 'aviso-supplies': ROW, 'aviso-weather': { top: 1500, height: 90 } };
  mockDevice.reminders = true;
  mockDevice.supplies = true;
  // O scrollTo do ScrollView de teste é um só para todas as telas: as chamadas dos testes de antes saem.
  jest.clearAllMocks();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  client.clear();
  jest.useRealTimers();
});

describe('"Abrir os avisos" na aba Família', () => {
  it('a margem do alto é a das telas', () => {
    expect(SCROLL_TARGET_TOP).toBe(SCREEN_PADDING);
  });

  it('tira o parâmetro, rola sem animação até o interruptor e destaca só a linha do tipo; desenhar de novo não rola outra vez', async () => {
    await mount('supplies');
    expect(mockNavigation.setParams).toHaveBeenCalledTimes(1);
    expect(mockNavigation.setParams).toHaveBeenCalledWith({ aviso: undefined });
    expect(scrollTo()).toHaveBeenCalledTimes(1);
    expect(scrollTo()).toHaveBeenCalledWith({ y: expectedY(SECTION, ROW), animated: false });
    expect(tinted()).toEqual(['aviso-supplies']);
    expect(StyleSheet.flatten(box('weather').props.style).backgroundColor).toBeUndefined();

    // O parâmetro já saiu da rota: a tela desenha de novo sem ele, e nada acontece.
    await rerender(undefined);
    await advance(SPOTLIGHT_TICK_MS * 2);
    expect(mockNavigation.setParams).toHaveBeenCalledTimes(1);
    expect(scrollTo()).toHaveBeenCalledTimes(1);
  });

  it('o destaque dura SPOTLIGHT_MS; depois, nada mais rola a tela', async () => {
    await mount('supplies');
    await advance(SPOTLIGHT_MS - SPOTLIGHT_TICK_MS);
    expect(tinted()).toEqual(['aviso-supplies']);
    await advance(SPOTLIGHT_TICK_MS * 2);
    expect(tinted()).toEqual([]);
    mockMeasure.nodes = { ...mockMeasure.nodes, 'avisos-da-casa': { top: 1600, height: 700 }, 'aviso-supplies': { top: 1700, height: 90 } };
    await advance(SPOTLIGHT_TICK_MS * 4);
    expect(scrollTo()).toHaveBeenCalledTimes(1);
  });

  it('acompanha a linha quando o que vem antes a empurra, até a pessoa arrastar; o destaque segue até o fim', async () => {
    await mount('supplies');
    const moved = { section: { top: 1400, height: 700 }, row: { top: 1500, height: 90 } };
    mockMeasure.nodes = { ...mockMeasure.nodes, 'avisos-da-casa': moved.section, 'aviso-supplies': moved.row };
    await advance(SPOTLIGHT_TICK_MS);
    expect(scrollTo()).toHaveBeenCalledTimes(2);
    expect(scrollTo()).toHaveBeenLastCalledWith({ y: expectedY(moved.section, moved.row), animated: false });

    await act(async () => renderer!.root.findByType(ScrollView).props.onScrollBeginDrag());
    mockMeasure.nodes = { ...mockMeasure.nodes, 'avisos-da-casa': { top: 1800, height: 700 }, 'aviso-supplies': { top: 1900, height: 90 } };
    await advance(SPOTLIGHT_TICK_MS * 3);
    expect(scrollTo()).toHaveBeenCalledTimes(2);
    expect(tinted()).toEqual(['aviso-supplies']);
    await advance(SPOTLIGHT_MS);
    expect(tinted()).toEqual([]);
  });

  it('no navegador (sem o aviso do arrasto), a posição relatada pela tela diz que a pessoa rolou: para de acompanhar', async () => {
    await mount('supplies');
    const scrollView = () => renderer!.root.findByType(ScrollView);
    const first = expectedY(SECTION, ROW);
    // A posição da rolagem daqui (e um arredondamento do navegador) não para nada.
    await act(async () => scrollView().props.onScroll({ nativeEvent: { contentOffset: { x: 0, y: first } } }));
    await act(async () => scrollView().props.onScroll({ nativeEvent: { contentOffset: { x: 0, y: first + SPOTLIGHT_SCROLL_SLOP } } }));
    const moved = { section: { top: 1400, height: 700 }, row: { top: 1500, height: 90 } };
    mockMeasure.nodes = { ...mockMeasure.nodes, 'avisos-da-casa': moved.section, 'aviso-supplies': moved.row };
    await advance(SPOTLIGHT_TICK_MS);
    expect(scrollTo()).toHaveBeenCalledTimes(2);
    const second = expectedY(moved.section, moved.row);
    expect(scrollTo()).toHaveBeenLastCalledWith({ y: second, animated: false });

    // A roda do mouse, o dedo ou o teclado levaram a tela a outro ponto: o que carrega depois não a puxa de volta.
    await act(async () => scrollView().props.onScroll({ nativeEvent: { contentOffset: { x: 0, y: second + 300 } } }));
    mockMeasure.nodes = { ...mockMeasure.nodes, 'avisos-da-casa': { top: 1800, height: 700 }, 'aviso-supplies': { top: 1900, height: 90 } };
    await advance(SPOTLIGHT_TICK_MS * 3);
    expect(scrollTo()).toHaveBeenCalledTimes(2);
    expect(tinted()).toEqual(['aviso-supplies']);

    // Fora de um pedido, a tela nem manda a posição.
    await advance(SPOTLIGHT_MS);
    expect(scrollView().props.onScroll).toBeUndefined();
  });

  it('a posição relatada antes da primeira rolagem daqui não para nada', async () => {
    mockMeasure.area = null;
    await mount('supplies');
    await act(async () => renderer!.root.findByType(ScrollView).props.onScroll({ nativeEvent: { contentOffset: { x: 0, y: 500 } } }));
    mockMeasure.area = AREA;
    await advance(SPOTLIGHT_TICK_MS);
    expect(scrollTo()).toHaveBeenCalledTimes(1);
    const moved = { section: { top: 1400, height: 700 }, row: { top: 1500, height: 90 } };
    mockMeasure.nodes = { ...mockMeasure.nodes, 'avisos-da-casa': moved.section, 'aviso-supplies': moved.row };
    await advance(SPOTLIGHT_TICK_MS);
    expect(scrollTo()).toHaveBeenCalledTimes(2);
  });

  it('um valor desconhecido só sai da rota', async () => {
    await mount('foo');
    expect(mockNavigation.setParams).toHaveBeenCalledWith({ aviso: undefined });
    await advance(SPOTLIGHT_TICK_MS * 4);
    expect(scrollTo()).not.toHaveBeenCalled();
    expect(tinted()).toEqual([]);
  });

  it('sem parâmetro (a visita de sempre), nem tira nada da rota', async () => {
    await mount(undefined);
    await advance(SPOTLIGHT_TICK_MS * 4);
    expect(mockNavigation.setParams).not.toHaveBeenCalled();
    expect(scrollTo()).not.toHaveBeenCalled();
  });

  it('banco sem as reposições (sem a linha): para no título da seção, sem destaque nem foco', async () => {
    mockDevice.supplies = false;
    await mount('supplies');
    expect(scrollTo()).toHaveBeenCalledWith({ y: expectedY(SECTION, null), animated: false });
    expect(tinted()).toEqual([]);
    await advance(SPOTLIGHT_FOCUS_DELAY_MS + SPOTLIGHT_TICK_MS);
    expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
  });

  it('aparelho sem notificações (a seção só explica): para no título da seção', async () => {
    mockDevice.reminders = false;
    await mount('weather');
    expect(scrollTo()).toHaveBeenCalledWith({ y: expectedY(SECTION, null), animated: false });
    expect(tinted()).toEqual([]);
  });

  it('sem medida no começo (a casa carregando), espera; quando dá para medir, rola', async () => {
    mockMeasure.area = null;
    await mount('supplies');
    await advance(SPOTLIGHT_TICK_MS * 3);
    expect(scrollTo()).not.toHaveBeenCalled();
    mockMeasure.area = AREA;
    await advance(SPOTLIGHT_TICK_MS);
    expect(scrollTo()).toHaveBeenCalledWith({ y: expectedY(SECTION, ROW), animated: false });
    expect(tinted()).toEqual(['aviso-supplies']);
  });

  it('sem medida nenhuma, desiste depois de SPOTLIGHT_WAIT_MS e não rola mais', async () => {
    mockMeasure.area = null;
    await mount('supplies');
    await advance(SPOTLIGHT_WAIT_MS + SPOTLIGHT_TICK_MS * 2);
    expect(scrollTo()).not.toHaveBeenCalled();
    mockMeasure.area = AREA;
    await advance(SPOTLIGHT_TICK_MS * 4);
    expect(scrollTo()).not.toHaveBeenCalled();
    expect(tinted()).toEqual([]);
  });

  it('o link tocado de novo (mesmo tipo) rola e destaca de novo', async () => {
    await mount('supplies');
    await rerender(undefined);
    await advance(SPOTLIGHT_MS + SPOTLIGHT_TICK_MS);
    expect(tinted()).toEqual([]);
    await rerender('supplies');
    expect(mockNavigation.setParams).toHaveBeenCalledTimes(2);
    expect(scrollTo()).toHaveBeenCalledTimes(2);
    expect(tinted()).toEqual(['aviso-supplies']);
  });

  it('no celular, o leitor de tela vai para o interruptor depois que a tela parou', async () => {
    await mount('supplies');
    expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
    await advance(SPOTLIGHT_FOCUS_DELAY_MS);
    expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
    expect(jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls[0][1]).toBe('focus');
  });

  describe('no navegador', () => {
    const os = Platform.OS;
    beforeEach(() => {
      Platform.OS = 'web';
    });
    afterEach(() => {
      Platform.OS = os;
    });
    // O Switch do react-native-web é um <input role="switch">: o ref dele é o campo, com o foco do navegador. Aqui o
    // Switch é o de mentira do Jest (um componente): o foco vai no lugar do dele, o do interruptor do tipo.
    const focusOn = (kind: string) => {
      const focus = jest.fn();
      const [target] = box(kind)
        .findByType(Switch)
        .findAll((node: ReactTestInstance) => typeof node.type !== 'string' && node.instance != null);
      (target.instance as { focus?: unknown }).focus = focus;
      return focus;
    };

    it('o foco vai para o interruptor (sem rolar a tela) depois que a tela parou', async () => {
      await mount('supplies');
      const focus = focusOn('supplies');
      expect(focus).not.toHaveBeenCalled();
      await advance(SPOTLIGHT_FOCUS_DELAY_MS);
      expect(focus).toHaveBeenCalledTimes(1);
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
      expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
    });

    it('a tela que sai antes do foco não foca nada', async () => {
      await mount('supplies');
      const focus = focusOn('supplies');
      await act(async () => renderer!.unmount());
      renderer = undefined;
      await advance(SPOTLIGHT_FOCUS_DELAY_MS * 2);
      expect(focus).not.toHaveBeenCalled();
    });
  });

  it('a tela que sai no meio não rola nem muda mais nada', async () => {
    await mount('supplies');
    const calls = scrollTo();
    await act(async () => renderer!.unmount());
    renderer = undefined;
    mockMeasure.nodes = { ...mockMeasure.nodes, 'avisos-da-casa': { top: 1800, height: 700 } };
    await advance(SPOTLIGHT_MS);
    expect(calls).toHaveBeenCalledTimes(1);
    expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
  });
});
