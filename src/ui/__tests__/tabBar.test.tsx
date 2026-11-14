import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createBottomTabNavigator } from 'expo-router/build/react-navigation/bottom-tabs';
import { NavigationContainer, PlatformPressable } from 'expo-router/react-navigation';
import { Platform, Text as RNText, StyleSheet } from 'react-native';
import { Path, Svg } from 'react-native-svg';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import {
  TAB_ACTIVE_SIZE,
  TAB_ACTIVE_TINT,
  TAB_BAR_HEIGHT,
  TAB_BAR_PADDING,
  TAB_ICONS,
  TAB_LABEL_MAX_SCALE,
  TAB_LABEL_MIN_SCALE,
  TAB_PILL_PADDING,
  TabBar,
  TabIcon,
} from '../TabBar';
import { TAB_ICON_BOX, TAB_STROKE_GRID, TAB_STROKE_ICONS, TAB_STROKE_WIDTH } from '../tabIcons';
import { PALETTES, shadows, space, withAlpha } from '../theme';

// A barra de abas de verdade, num navegador de abas de verdade (com os endereços de cada aba): o rótulo cabe no
// celular estreito, cada aba é um link na web e o clique com tecla (abrir em outra aba do navegador) fica com o
// navegador.

jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

/**
 * A largura de cada rótulo em Nunito 11 (Bold nas abas fechadas, ExtraBold na aberta), medida nos TTF de
 * @expo-google-fonts/nunito somando o avanço de cada letra (tabelas cmap e hmtx, sem kerning): Hoje 23,7 e 24,1;
 * Compras 45,8 e 46,6; Casa 24,9 e 25,2; Saúde 31,9 e 32,4; Ajustes 38,3 e 39,1. "Configurações" mede 73,3 e 74,8
 * e não cabe: na barra a aba é "Ajustes" (o título da tela continua "Configurações").
 */
const LABEL_WIDTHS: Record<string, [bold: number, heavy: number]> = {
  Hoje: [23.65, 24.1],
  Compras: [45.76, 46.56],
  Casa: [24.88, 25.19],
  Saúde: [31.89, 32.42],
  Ajustes: [38.32, 39.08],
};
const CONFIGURACOES_WIDTH = 74.8;
/** "Finanças", de quando foi uma aba (hoje é uma parte da Casa): 44,5 e 45,2. Fica como a medida de uma sexta aba. */
const FINANCAS_WIDTH = 45.23;
/** O rótulo mais largo da barra, "Compras", arredondado para cima. */
const LONGEST_LABEL = Math.ceil(Math.max(...Object.values(LABEL_WIDTHS).flat()));

// A barra do app: cinco abas, com a chave de Finanças ligada ou não (Finanças é uma parte da Casa).
const TABS = [
  { name: 'index', title: 'Hoje', path: '' },
  { name: 'compras', title: 'Compras', path: 'compras' },
  { name: 'casa', title: 'Casa', path: 'casa' },
  { name: 'saude', title: 'Saúde', path: 'saude' },
  { name: 'configuracoes', title: 'Configurações', label: 'Ajustes', path: 'configuracoes' },
];
/** O que a barra escreve em cada aba: o rótulo próprio (tabBarLabel), ou o título. */
const shownLabel = (tab: { title: string; label?: string }) => tab.label ?? tab.title;

/** A largura de cada aba numa tela de `width`: a barra tem a margem da tela, a borda e o recuo. */
const tabWidth = (width: number, tabs = TABS.length) => (width - 2 * space.lg - 2 - 2 * TAB_BAR_PADDING) / tabs;
/** O espaço do rótulo: a aba menos o recuo dele, dos dois lados. */
const labelRoom = (width: number, tabs = TABS.length) => tabWidth(width, tabs) - 2 * TAB_PILL_PADDING;

describe('o rótulo das abas', () => {
  it('todos os rótulos da barra estão medidos, e o mais largo, "Compras", cabe inteiro num celular de 360', () => {
    expect(Object.keys(LABEL_WIDTHS).sort()).toEqual(TABS.map(shownLabel).sort());
    expect(LONGEST_LABEL).toBe(47);
    expect(labelRoom(360)).toBeGreaterThanOrEqual(LONGEST_LABEL);
  });

  it('"Configurações" não caberia: por isso a barra diz "Ajustes"', () => {
    expect(CONFIGURACOES_WIDTH).toBeGreaterThan(labelRoom(360));
    expect(CONFIGURACOES_WIDTH * TAB_LABEL_MIN_SCALE).toBeGreaterThan(labelRoom(360));
    // Nem num celular de 393: o rótulo teria 66,2.
    expect(CONFIGURACOES_WIDTH).toBeGreaterThan(labelRoom(393));
  });

  it('com a fonte grande do aparelho, o rótulo encolhe até caber em vez de ser cortado', () => {
    expect(LONGEST_LABEL * TAB_LABEL_MAX_SCALE * TAB_LABEL_MIN_SCALE).toBeLessThanOrEqual(labelRoom(360));
  });

  it('com as cinco abas, todo rótulo cabe inteiro num celular de 360 e até num de 320, sem encolher (o navegador não encolhe)', () => {
    expect(TABS).toHaveLength(5);
    expect(tabWidth(360)).toBeCloseTo(63.6, 5);
    expect(labelRoom(360)).toBeCloseTo(59.6, 5);
    expect(labelRoom(320)).toBeCloseTo(51.6, 5);
    expect(LONGEST_LABEL).toBeLessThanOrEqual(labelRoom(320));
    // Dois rótulos vizinhos nunca se tocam: o recuo de cada lado é o espaço entre eles.
    expect(TAB_PILL_PADDING).toBeGreaterThanOrEqual(2);
  });

  it('uma sexta aba ainda caberia num celular de 360 (foi assim quando Finanças era uma aba)', () => {
    expect(tabWidth(360, 6)).toBe(53);
    expect(labelRoom(360, 6)).toBe(49);
    for (const width of [LONGEST_LABEL, FINANCAS_WIDTH]) expect(width).toBeLessThanOrEqual(labelRoom(360, 6));
    // Com o recuo de 6 de antes (a pílula em volta do rótulo), sobravam 41 e os dois eram cortados no navegador.
    expect(tabWidth(360, 6) - 2 * 6).toBeLessThan(FINANCAS_WIDTH);
  });

});

describe('a barra do app', () => {
  // As abas que o layout declara, na ordem: o nome da rota, o título e o rótulo próprio, quando tem.
  const layout = readFileSync(join(__dirname, '..', '..', 'app', '(tabs)', '_layout.tsx'), 'utf8');
  const declared = [...layout.matchAll(/<Tabs\.Screen name="([^"]+)" options=\{\{ title: '([^']+)'(?:, tabBarLabel: '([^']+)')? \}\} \/>/g)].map(
    ([, name, title, label]) => ({ name, title, label }),
  );

  it('Hoje, Compras, Casa, Saúde e Configurações ("Ajustes" na barra): Finanças não é uma aba, é uma parte da Casa', () => {
    expect(declared).toEqual([
      { name: 'index', title: 'Hoje', label: undefined },
      { name: 'compras', title: 'Compras', label: undefined },
      { name: 'casa', title: 'Casa', label: undefined },
      { name: 'saude', title: 'Saúde', label: undefined },
      { name: 'configuracoes', title: 'Configurações', label: 'Ajustes' },
    ]);
    // A tabela do teste é a barra do app: todas as abas que o layout declara.
    expect(TABS.map(({ name, title, label }) => ({ name, title, label }))).toEqual(declared);
    // Nenhuma aba fica atrás de uma chave: a barra é a mesma com Finanças ligada ou não.
    expect(layout).not.toContain('Tabs.Protected');
    expect(layout).not.toContain('financas');
  });

  it('cada aba tem o seu ícone: o carrinho em Compras e a engrenagem em Configurações', () => {
    expect(declared.map((tab) => TAB_ICONS[tab.name])).toEqual(['sun', 'cart', 'home', 'heart', 'gear']);
    expect(Object.keys(TAB_ICONS)).toEqual(declared.map((tab) => tab.name));
  });
});

describe('os ícones da barra', () => {
  async function icon(name: Parameters<typeof TabIcon>[0]['name']) {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<TabIcon name={name} color="#123456" />);
    });
    const svg = renderer!.root.findByType(Svg).props;
    const paths = renderer!.root.findAllByType(Path).map((path) => path.props);
    await act(async () => renderer!.unmount());
    return { svg, paths };
  }

  it('os desenhados à mão são linha (sem preenchimento), da cor da aba, de 2 no quadro de 24 reduzido aos 22 da barra', async () => {
    for (const name of ['cart', 'gear'] as const) {
      const { svg, paths } = await icon(name);
      expect(svg).toMatchObject({ width: TAB_ICON_BOX, height: TAB_ICON_BOX, viewBox: `0 0 ${TAB_STROKE_GRID} ${TAB_STROKE_GRID}` });
      expect(paths.map((path) => path.d)).toEqual(TAB_STROKE_ICONS[name]);
      for (const path of paths) {
        expect(path).toMatchObject({ fill: 'none', stroke: '#123456', strokeWidth: TAB_STROKE_WIDTH, strokeLinecap: 'round', strokeLinejoin: 'round' });
      }
    }
    expect(TAB_STROKE_WIDTH).toBe(2);
  });

  it('os do Figma continuam área preenchida com a cor da aba, no quadro de 22', async () => {
    const { svg, paths } = await icon('sun');
    expect(svg).toMatchObject({ width: TAB_ICON_BOX, height: TAB_ICON_BOX, viewBox: `0 0 ${TAB_ICON_BOX} ${TAB_ICON_BOX}` });
    expect(paths).toHaveLength(1);
    expect(paths[0].fill).toBe('#123456');
  });
});

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
            <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.title, tabBarLabel: tab.label }} component={Blank} />
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
    expect(tabs(root).map((tab) => tab.props.href)).toEqual(['/', '/compras', '/casa', '/saude', '/configuracoes']);
    expect(tabs(root).map(hostRole)).toEqual(Array(TABS.length).fill('tab'));
  });

  it('a aba aberta fica num círculo de vidro de 55, como no kit, e só ela', async () => {
    const { root } = await renderTabs();
    const marks = tabs(root).map((tab) => tab.findAll((node) => typeof node.type === 'string' && node.props.testID === 'tab-active'));
    expect(marks.map((found) => found.length)).toEqual([1, 0, 0, 0, 0]);
    const style = StyleSheet.flatten(marks[0][0].props.style);
    // Redondo sempre (não estica com o rótulo), no meio da aba e fora da conta do espaço do ícone e do rótulo.
    expect(style).toMatchObject({
      position: 'absolute',
      width: TAB_ACTIVE_SIZE,
      height: TAB_ACTIVE_SIZE,
      borderRadius: TAB_ACTIVE_SIZE / 2,
      left: '50%',
      top: '50%',
      marginLeft: -TAB_ACTIVE_SIZE / 2,
      marginTop: -TAB_ACTIVE_SIZE / 2,
      backgroundColor: withAlpha(PALETTES.light.primary, TAB_ACTIVE_TINT),
    });
    expect(style.overflow).toBeUndefined();
    // O vidro: a sombra por dentro do kit (1, 1, desfoque 3, preto a 10%) e um fio de luz do outro lado.
    expect(shadows.inset).toBe('inset 1px 1px 3px rgba(0, 0, 0, 0.1)');
    expect(style.boxShadow).toBe(`${shadows.inset}, inset -1px -1px 1px ${PALETTES.light.glassEdge}`);
    expect(TAB_ACTIVE_SIZE).toBe(55);
    expect(TAB_ACTIVE_TINT).toBe(0.12);
    // Cabe na altura da barra. O rótulo mais largo cabe na largura do círculo, mas passa da curva dele embaixo, como
    // no kit (no pé do rótulo o círculo já tem só 39 de largura), sem sair da aba (63,6 num 360).
    expect(TAB_ACTIVE_SIZE).toBeLessThan(TAB_BAR_HEIGHT - 2);
    const radius = TAB_ACTIVE_SIZE / 2;
    // A aba, de cima para baixo: 8 de recuo, o ícone, 2 de espaço e a linha de 15 do rótulo.
    const labelFoot = 8 + TAB_ICON_BOX + 2 + 15 - radius;
    const widthAtLabelFoot = 2 * Math.sqrt(radius ** 2 - labelFoot ** 2);
    expect(Math.round(widthAtLabelFoot)).toBe(39);
    expect(LONGEST_LABEL).toBeLessThan(TAB_ACTIVE_SIZE);
    expect(LONGEST_LABEL).toBeGreaterThan(widthAtLabelFoot);
    expect(LONGEST_LABEL).toBeLessThanOrEqual(labelRoom(360));
    // O círculo cabe dentro da aba num celular de 360; num de 320 (55,6 por aba) ainda cabe, por um triz. Com uma
    // sexta aba passaria 1 de cada lado, por trás das vizinhas (nada o corta: não há overflow).
    expect(TAB_ACTIVE_SIZE).toBeLessThan(tabWidth(360));
    expect(TAB_ACTIVE_SIZE).toBeLessThan(tabWidth(320));
    expect(TAB_ACTIVE_SIZE - tabWidth(360, 6)).toBe(2);

    // Trocar de aba leva o círculo junto.
    await act(async () => press(tabs(root)[2], click()));
    expect(tabs(root).map((tab) => tab.findAll((node) => typeof node.type === 'string' && node.props.testID === 'tab-active').length)).toEqual([
      0, 0, 1, 0, 0,
    ]);
  });

  it('o rótulo encolhe com a fonte grande em vez de cortar', async () => {
    const { root } = await renderTabs();
    const label = root.findAll((node) => node.type === RNText && node.props.children === 'Compras')[0];
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
    // A última aba é lida como aparece na barra ("Ajustes"): quem fala o que vê acha o botão pelo nome.
    expect(tabs(root).map((tab) => tab.props.accessibilityLabel)).toEqual([
      'Hoje, aba, 1 de 5',
      'Compras, aba, 2 de 5',
      'Casa, aba, 3 de 5',
      'Saúde, aba, 4 de 5',
      'Ajustes, aba, 5 de 5',
    ]);
    expect(root.findAll((node) => node.type === RNText).map((node) => node.props.children)).toEqual(TABS.map(shownLabel));
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
    expect(tabs(root).map((tab) => tab.props.accessibilityLabel)).toEqual(TABS.map(shownLabel));
    // Link na web, mas ainda uma aba para o leitor de tela.
    expect(tabs(root).map(hostRole)).toEqual(Array(TABS.length).fill('tab'));

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
    expect(tabPresses).toEqual(['casa']);
    expect(selected(root)).toBe(2);
  });

  it('quem ouve o toque na aba pode impedir a troca', async () => {
    const { root } = await renderTabs({ blockTabPress: true });
    await act(async () => press(tabs(root)[1], click()));
    expect(tabPresses).toEqual(['compras']);
    expect(selected(root)).toBe(0);
  });
});
