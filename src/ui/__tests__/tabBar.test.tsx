import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createBottomTabNavigator } from 'expo-router/build/react-navigation/bottom-tabs';
import { NavigationContainer, PlatformPressable } from 'expo-router/react-navigation';
import { Platform, Text as RNText } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { TAB_BAR_PADDING, TAB_LABEL_MAX_SCALE, TAB_LABEL_MIN_SCALE, TAB_PILL_PADDING, TabBar } from '../TabBar';
import { space } from '../theme';

// A barra de abas de verdade, num navegador de abas de verdade (com os endereços de cada aba): o rótulo cabe no
// celular estreito, cada aba é um link na web e o clique com tecla (abrir em outra aba do navegador) fica com o
// navegador.

jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

/** O rótulo mais largo, "Finanças" em Nunito 11: 44,5 em Bold e 45,2 em ExtraBold (medidos na revisão). */
const LONGEST_LABEL = 46;

/** O espaço do rótulo numa tela de `width`: a barra tem a margem da tela, a borda e o recuo; a pílula, o recuo dela. */
const labelRoom = (width: number) => (width - 2 * space.lg - 2 - 2 * TAB_BAR_PADDING) / 5 - 2 * TAB_PILL_PADDING;

describe('o rótulo das abas', () => {
  it('"Finanças" cabe inteiro num celular de 360', () => {
    expect(labelRoom(360)).toBeGreaterThanOrEqual(LONGEST_LABEL);
  });

  it('com a fonte grande do aparelho, o rótulo encolhe até caber em vez de ser cortado', () => {
    expect(LONGEST_LABEL * TAB_LABEL_MAX_SCALE * TAB_LABEL_MIN_SCALE).toBeLessThanOrEqual(labelRoom(360));
  });
});

const TABS = [
  { name: 'index', title: 'Hoje', path: '' },
  { name: 'casa', title: 'Casa', path: 'casa' },
  { name: 'financas', title: 'Finanças', path: 'financas' },
  { name: 'saude', title: 'Saúde', path: 'saude' },
  { name: 'familia', title: 'Família', path: 'familia' },
];

const Tabs = createBottomTabNavigator();
const Blank = () => null;
let renderer: ReactTestRenderer | undefined;
const tabPresses: string[] = [];

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  tabPresses.length = 0;
  jest.restoreAllMocks();
});

async function renderTabs({ blockTabPress = false } = {}) {
  await act(async () => {
    renderer = create(
      <NavigationContainer
        linking={{
          prefixes: [],
          config: { screens: Object.fromEntries(TABS.map((tab) => [tab.name, tab.path])) },
          getInitialURL: () => null,
          subscribe: () => () => {},
        }}>
        <Tabs.Navigator
          screenOptions={{ headerShown: false }}
          screenListeners={({ route }) => ({
            tabPress: (event) => {
              tabPresses.push(route.name);
              if (blockTabPress) event.preventDefault();
            },
          })}
          tabBar={(props) => <TabBar {...props} />}>
          {TABS.map((tab) => (
            <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.title }} component={Blank} />
          ))}
        </Tabs.Navigator>
      </NavigationContainer>,
    );
  });
  return renderer!;
}

/** Cada aba: o elemento que vira o link na web. */
const tabs = (root: ReactTestInstance) => root.findAllByType(PlatformPressable);
/** O que a tela de verdade recebe: o papel no elemento nativo (ou no link da web). */
const hostRole = (tab: ReactTestInstance) => tab.findAll((node) => typeof node.type === 'string')[0].props.role;
/** O toque como chega do aparelho ou do navegador, antes do PlatformPressable decidir o que fazer com ele. */
const press = (tab: ReactTestInstance, event: unknown) =>
  tab.findAll((node) => node !== tab && typeof node.props.onPress === 'function')[0].props.onPress(event);
const selected = (root: ReactTestInstance) => tabs(root).findIndex((tab) => tab.props.accessibilityState?.selected);

/** Um clique de mouse na web, com ou sem tecla. */
const click = (patch: Record<string, unknown> = {}) => ({
  button: 0,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  currentTarget: {},
  preventDefault: jest.fn(),
  ...patch,
});

describe('a barra de abas', () => {
  it('cada aba leva o endereço da tela, como a barra padrão', async () => {
    const { root } = await renderTabs();
    expect(tabs(root).map((tab) => tab.props.href)).toEqual(['/', '/casa', '/financas', '/saude', '/familia']);
    expect(tabs(root).map(hostRole)).toEqual(Array(5).fill('tab'));
  });

  it('o rótulo encolhe com a fonte grande em vez de cortar', async () => {
    const { root } = await renderTabs();
    const label = root.findAll((node) => node.type === RNText && node.props.children === 'Finanças')[0];
    expect(label.props).toMatchObject({
      numberOfLines: 1,
      adjustsFontSizeToFit: true,
      minimumFontScale: TAB_LABEL_MIN_SCALE,
      maxFontSizeMultiplier: TAB_LABEL_MAX_SCALE,
    });
  });

  it('no iPhone, o leitor de tela diz a posição da aba', async () => {
    const { root } = await renderTabs();
    expect(Platform.OS).toBe('ios');
    expect(tabs(root).map((tab) => tab.props.accessibilityLabel)).toEqual([
      'Hoje, aba, 1 de 5',
      'Casa, aba, 2 de 5',
      'Finanças, aba, 3 de 5',
      'Saúde, aba, 4 de 5',
      'Família, aba, 5 de 5',
    ]);
    expect(tabs(root).map((tab) => tab.props.accessibilityState)).toEqual([
      { selected: true },
      { selected: false },
      { selected: false },
      { selected: false },
      { selected: false },
    ]);
    // Na web é o aria-selected que diz ao leitor de tela qual aba está aberta.
    expect(tabs(root).map((tab) => tab.props['aria-selected'])).toEqual([true, false, false, false, false]);
  });

  it('no navegador, o clique com tecla fica com o navegador e o clique simples troca a aba', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const { root } = await renderTabs();
    expect(tabs(root).map((tab) => tab.props.accessibilityLabel)).toEqual(TABS.map((tab) => tab.title));
    // Link na web, mas ainda uma aba para o leitor de tela.
    expect(tabs(root).map(hostRole)).toEqual(Array(5).fill('tab'));

    for (const key of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
      const event = click({ [key]: true });
      await act(async () => press(tabs(root)[2], event));
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    // O botão do meio também abre em outra aba.
    const middle = click({ button: 1 });
    await act(async () => press(tabs(root)[2], middle));
    expect(middle.preventDefault).not.toHaveBeenCalled();
    expect(tabPresses).toEqual([]);
    expect(selected(root)).toBe(0);

    const plain = click();
    await act(async () => press(tabs(root)[2], plain));
    expect(plain.preventDefault).toHaveBeenCalled();
    expect(tabPresses).toEqual(['financas']);
    expect(selected(root)).toBe(2);
  });

  it('quem ouve o toque na aba pode impedir a troca', async () => {
    const { root } = await renderTabs({ blockTabPress: true });
    await act(async () => press(tabs(root)[1], click()));
    expect(tabPresses).toEqual(['casa']);
    expect(selected(root)).toBe(0);
  });
});
