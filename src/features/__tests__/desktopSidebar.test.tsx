import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useState } from 'react';
import { Dimensions, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import TabsLayout from '@/app/(tabs)/_layout';
import { APP_AREAS, DESKTOP_WINDOW_WIDTH, SIDEBAR_SPACE, windowHeight } from '@/domain/desktop';
import { routeWindowLayout, WINDOW_CLOSE_LABEL, windowOptions } from '@/features/desktop/RouteWindow';
import { liveOpener, OTHER_WINDOW, rememberOpener, restoreFocus, trapWindowFocus } from '@/features/desktop/windowFocus';
import { NUKE_LABEL, Sidebar } from '@/features/desktop/Sidebar';
import { NukeButton } from '@/features/nuke/NukeButton';
import { closeWindow } from '@/lib/navigation';
import { SidebarContext, useDesktop } from '@/ui/desktop';
import { handMenuOpener } from '@/ui/focus';
import { space } from '@/ui/theme';
import { TabBar } from '@/ui/TabBar';

// A barra lateral do computador num roteador de verdade (o Expo Router, com as rotas montadas na memória), ao lado
// do Stack, como no layout da raiz: acende a área da tela aberta (também a de uma tela por cima das abas), troca
// de aba, volta para a aba como ela estava (a parte aberta dentro dela), fecha as telas de cima até as abas sem
// empilhar outras, e abre o Nuke uma vez só.

/* eslint-disable @typescript-eslint/no-require-imports */
const { ExpoRoot } = require('expo-router/build/ExpoRoot');
const { inMemoryContext } = require('expo-router/build/testing-library/context-stubs');
const { store } = require('expo-router/build/global-state/router-store');
/* eslint-enable @typescript-eslint/no-require-imports */

jest.mock('expo-linking', () => ({
  ...jest.requireActual<object>('expo-linking'),
  createURL: (path: string) => `kotii://${path}`,
  resolveScheme: () => 'kotii',
  addEventListener: () => ({ remove() {} }),
}));
// A barra lateral e as telas em janela só existem no navegador: o Stack desenha as telas como no navegador (todas as da
// pilha, a de baixo de uma `transparentModal` à vista), e não como no celular (react-native-screens).
jest.mock('expo-router/build/react-navigation/native-stack/views/NativeStackView', () =>
  jest.requireActual('expo-router/build/react-navigation/native-stack/views/NativeStackView.js'),
);
jest.mock('@/ui/NukeLive', () => ({ NukeLive: () => null }));
// O layout das abas de verdade: os avisos não entram nesta história.
jest.mock('@/features/useReminderSync', () => ({ useReminderSync: () => undefined }));
// O teclado das telas em janela (o Esc, o foco dentro da caixa, o foco de volta ao fechar): as regras têm os testes
// delas (windowFocus.test); aqui se confere que a caixa as liga, só no computador, e com o fechar dela.
const mockUntrap = jest.fn();
jest.mock('@/features/desktop/windowFocus', () => {
  const actual = jest.requireActual<typeof import('@/features/desktop/windowFocus')>('@/features/desktop/windowFocus');
  return {
    ...actual,
    trapWindowFocus: jest.fn(() => mockUntrap),
    restoreFocus: jest.fn(),
    // O de verdade (o registro que liveOpener lê), contado.
    rememberOpener: jest.fn(actual.rememberOpener),
  };
});
// A janela é de computador (ui/desktop), ou não.
let mockDesktop = false;
jest.mock('@/ui/desktop', () => ({ ...jest.requireActual<object>('@/ui/desktop'), useDesktop: () => mockDesktop }));

let mockHouses = [{ id: 'h1', name: 'Casa da Ana', role: 'owner' }];
jest.mock('@/lib/auth', () => ({
  useHousehold: () => ({ data: { household: { id: 'h1', name: 'Casa da Ana' }, households: mockHouses } }),
}));

/** Uma tela de mentira: diz qual é e a parte pedida. */
function Stub({ name }: { name: string }) {
  const { aba } = useLocalSearchParams<{ aba?: string }>();
  return <Text>{aba ? `${name}:${aba}` : name}</Text>;
}

const ROUTES = {
  // Como no layout de verdade: a barra ao lado do Stack, por fora dele.
  _layout: () => (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <Sidebar />
      <View style={{ flex: 1 }}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="precos" />
          <Stack.Screen name="lista/[id]/index" />
          <Stack.Screen name="tarefa/[id]" />
          <Stack.Screen name="casas" />
          <Stack.Screen name="nuke" />
        </Stack>
      </View>
    </View>
  ),
  '(tabs)/_layout': () => (
    <Tabs tabBar={() => null}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="compras" />
      <Tabs.Screen name="casa" />
      <Tabs.Screen name="saude" />
      <Tabs.Screen name="configuracoes" />
    </Tabs>
  ),
  '(tabs)/index': () => <Stub name="hoje" />,
  '(tabs)/compras': () => <Stub name="compras" />,
  '(tabs)/casa': () => <Stub name="casa" />,
  '(tabs)/saude': () => <Stub name="saude" />,
  '(tabs)/configuracoes': () => <Stub name="configuracoes" />,
  precos: () => <Stub name="precos" />,
  'lista/[id]/index': () => <Stub name="lista" />,
  'tarefa/[id]': () => <Stub name="tarefa" />,
  casas: () => <Stub name="casas" />,
  nuke: () => <Stub name="nuke" />,
};

let renderer: ReactTestRenderer | undefined;

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  mockHouses = [{ id: 'h1', name: 'Casa da Ana', role: 'owner' }];
  mockDesktop = false;
});

const settle = async () => {
  for (let i = 0; i < 3; i += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
};

async function open(location: string, routes: Record<string, unknown> = ROUTES) {
  process.env.EXPO_ROUTER_IMPORT_MODE = 'sync';
  await act(async () => {
    renderer = create(<ExpoRoot context={inMemoryContext(routes)} location={location} />);
  });
  await settle();
}

const where = () => ({ pathname: store.getRouteInfo().pathname as string, params: store.getRouteInfo().params as Record<string, unknown> });

/** O link da barra com esse testID: o de fora, que tem o toque e o endereço. */
const link = (testID: string): ReactTestInstance =>
  renderer!.root.findAll((node) => node.props.testID === testID && typeof node.props.onPress === 'function' && 'href' in node.props)[0];

const press = async (testID: string) => {
  await act(async () => link(testID).props.onPress({}));
  await settle();
};

/** A área acesa: a do link que diz ser a página aberta. */
const lit = () => APP_AREAS.filter((area) => link(`sidebar-${area.key}`).props['aria-current'] === 'page').map((area) => area.key);

/** As telas empilhadas na raiz (as abas contam como uma). */
const stacked = (): string[] => {
  const root = store.navigationRef.getRootState();
  const inside = root.routes[0]?.state?.routes ?? root.routes;
  return inside.map((route: { name: string }) => route.name);
};

describe('a barra lateral do computador', () => {
  it('tem as cinco áreas, com o nome inteiro e o endereço de cada uma, e acende a da aba aberta', async () => {
    await open('/compras');
    expect(APP_AREAS.map((area) => link(`sidebar-${area.key}`).props.accessibilityLabel)).toEqual([
      'Hoje',
      'Compras',
      'Casa',
      'Saúde',
      'Configurações',
    ]);
    expect(APP_AREAS.map((area) => link(`sidebar-${area.key}`).props.href)).toEqual(['/', '/compras', '/casa', '/saude', '/configuracoes']);
    expect(lit()).toEqual(['compras']);
    // O destaque de vidro é um só.
    expect(renderer!.root.findAll((node) => node.props.testID === 'sidebar-active' && typeof node.type === 'string')).toHaveLength(1);
  });

  it('troca de aba, e o toque na aba já aberta não faz nada', async () => {
    await open('/');
    expect(lit()).toEqual(['hoje']);
    await press('sidebar-casa');
    expect(where().pathname).toBe('/casa');
    expect(lit()).toEqual(['casa']);
    await press('sidebar-casa');
    expect(where().pathname).toBe('/casa');
    expect(stacked()).toEqual(['(tabs)']);
    await press('sidebar-hoje');
    expect(where().pathname).toBe('/');
    expect(lit()).toEqual(['hoje']);
  });

  it('volta para a aba como ela estava: a parte aberta dentro dela continua aberta', async () => {
    await open('/compras');
    await act(async () => router.setParams({ aba: 'notas' }));
    await settle();
    expect(where()).toEqual({ pathname: '/compras', params: { aba: 'notas' } });
    await press('sidebar-saude');
    expect(where().pathname).toBe('/saude');
    // O link de Compras já leva a parte guardada (também para abrir em outra aba do navegador).
    expect(link('sidebar-compras').props.href).toBe('/compras?aba=notas');
    await press('sidebar-compras');
    expect(where()).toEqual({ pathname: '/compras', params: { aba: 'notas' } });
    // Uma aba que nunca teve parte aberta volta sem nenhuma.
    expect(link('sidebar-casa').props.href).toBe('/casa');
  });

  it('numa tela por cima das abas, acende a área de onde ela vem e fecha a tela ao trocar de área', async () => {
    await open('/compras');
    await act(async () => router.push('/precos'));
    await settle();
    expect(where().pathname).toBe('/precos');
    expect(stacked()).toEqual(['(tabs)', 'precos']);
    expect(lit()).toEqual(['compras']);
    await act(async () => router.push({ pathname: '/tarefa/[id]', params: { id: 'nova' } }));
    await settle();
    expect(lit()).toEqual(['casa']);
    expect(stacked()).toEqual(['(tabs)', 'precos', 'tarefa/[id]']);
    // Fecha as duas telas de cima e troca de aba, sem empilhar outras abas.
    await press('sidebar-saude');
    expect(where().pathname).toBe('/saude');
    expect(stacked()).toEqual(['(tabs)']);
    expect(lit()).toEqual(['saude']);
  });

  it('o toque na área acesa, de uma tela por cima, volta para a aba dela', async () => {
    await open('/compras');
    await act(async () => router.setParams({ aba: 'despensa' }));
    await act(async () => router.push({ pathname: '/lista/[id]', params: { id: 'abc' } }));
    await settle();
    expect(lit()).toEqual(['compras']);
    await press('sidebar-compras');
    expect(where()).toEqual({ pathname: '/compras', params: { aba: 'despensa' } });
    expect(stacked()).toEqual(['(tabs)']);
  });

  it('com a página aberta direto numa tela por cima (sem as abas embaixo), leva até a aba', async () => {
    await open('/lista/abc');
    expect(stacked()).toEqual(['lista/[id]/index']);
    expect(lit()).toEqual(['compras']);
    await press('sidebar-casa');
    expect(where().pathname).toBe('/casa');
    expect(stacked()).toEqual(['(tabs)']);
    expect(lit()).toEqual(['casa']);
  });

  it('o Nuke abre por cima, não acende nenhuma área e não abre duas vezes', async () => {
    await open('/casa');
    expect(link('sidebar-nuke').props.accessibilityLabel).toBe(NUKE_LABEL);
    await press('sidebar-nuke');
    expect(where().pathname).toBe('/nuke');
    expect(stacked()).toEqual(['(tabs)', 'nuke']);
    expect(lit()).toEqual([]);
    await press('sidebar-nuke');
    expect(stacked()).toEqual(['(tabs)', 'nuke']);
    // Da conversa, uma área fecha o Nuke e abre a aba.
    await press('sidebar-casa');
    expect(where().pathname).toBe('/casa');
    expect(stacked()).toEqual(['(tabs)']);
  });

  it('diz a casa aberta; com mais de uma, o nome leva a "Suas casas"', async () => {
    await open('/');
    const texts = () => renderer!.root.findAllByType(Text).map((node) => node.props.children);
    expect(texts()).toContain('Casa da Ana');
    expect(renderer!.root.findAll((node) => node.props.href === '/casas')).toHaveLength(0);

    await act(async () => renderer?.unmount());
    mockHouses = [
      { id: 'h1', name: 'Casa da Ana', role: 'owner' },
      { id: 'h2', name: 'Casa da praia', role: 'member' },
    ];
    await open('/');
    const house = renderer!.root.findAll((node) => node.props.href === '/casas' && typeof node.props.onPress === 'function')[0];
    expect(house.props.accessibilityLabel).toBe('Casa aberta: Casa da Ana. Trocar de casa');
    await act(async () => house.props.onPress({}));
    await settle();
    expect(where().pathname).toBe('/casas');
    expect(lit()).toEqual(['configuracoes']);
  });
});

describe('a casca do computador', () => {
  it('o layout da raiz põe a barra ao lado do Stack só no computador e dentro de uma casa', () => {
    const layout = readFileSync(join(__dirname, '..', '..', 'app', '_layout.tsx'), 'utf8');
    expect(layout).toContain('const desktop = useDesktop();');
    // Fora de uma casa (entrar, a senha nova, as boas-vindas) não há áreas para onde ir.
    expect(layout).toContain('const sidebar = desktop && inHousehold;');
    expect(layout).toContain('{sidebar ? <Sidebar /> : null}');
    // As telas ficam sabendo que a barra está ao lado (as que se arrumam pela largura descontam o lugar dela).
    expect(layout).toContain('<SidebarContext.Provider value={sidebar}>');
    // A barra entra e sai ao lado do Stack, que não muda de lugar na árvore: a tela aberta não é montada de novo
    // quando a janela cruza a largura do computador.
    expect(layout.indexOf('<Sidebar />')).toBeLessThan(layout.indexOf('<Stack\n'));
    expect(layout.match(/<Stack\n/g)).toHaveLength(1);
  });

  // As abas de verdade (o layout delas), com telas de mentira.
  const WITH_TABS = { ...ROUTES, '(tabs)/_layout': TabsLayout };

  it('no celular, as abas têm a pílula no rodapé e o botão do Nuke por cima', async () => {
    await open('/', WITH_TABS);
    expect(renderer!.root.findAllByType(TabBar)).toHaveLength(1);
    expect(renderer!.root.findAllByType(NukeButton)).toHaveLength(1);
  });

  it('no computador, nem pílula nem botão flutuante: as abas e o Nuke estão na barra lateral', async () => {
    mockDesktop = true;
    await open('/', WITH_TABS);
    expect(renderer!.root.findAllByType(TabBar)).toHaveLength(0);
    expect(renderer!.root.findAllByType(NukeButton)).toHaveLength(0);
    // E a barra lateral continua trocando de aba.
    await press('sidebar-compras');
    expect(where().pathname).toBe('/compras');
    expect(lit()).toEqual(['compras']);
  });
});

describe('as telas em janela (no celular sobem por cima das outras)', () => {
  const WINDOW = Dimensions.get('window');
  afterEach(async () => {
    await act(async () => Dimensions.set({ window: WINDOW }));
    jest.restoreAllMocks();
  });

  /** Quantas vezes a tarefa foi montada: montada de novo, ela perderia o que foi digitado. */
  let mounts = 0;
  function Task() {
    useState(() => (mounts += 1));
    return <Text>tarefa</Text>;
  }

  /** A barra lateral está na tela (o layout da raiz diz, pelo SidebarContext). */
  let sidebarShown = false;
  afterEach(() => {
    sidebarShown = false;
  });

  // Como o layout da raiz: as opções das telas em janela vêm de `windowOptions`, e a caixa, do `screenLayout`.
  const WINDOWS = {
    ...ROUTES,
    _layout: function Layout() {
      const desktop = useDesktop();
      // Redesenha quando a janela muda de tamanho (o useDesktop de verdade a acompanha).
      useWindowDimensions();
      return (
        <SidebarContext.Provider value={sidebarShown}>
          <Stack screenLayout={routeWindowLayout}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="precos" />
            <Stack.Screen name="tarefa/[id]" options={windowOptions(desktop, { title: 'Tarefa' })} />
            <Stack.Screen name="nuke" options={windowOptions(desktop, { headerShown: false }, 'Nuke')} />
          </Stack>
        </SidebarContext.Provider>
      );
    },
    'tarefa/[id]': Task,
  };

  /** A caixa (a de verdade, com a tela dentro). */
  const box = () => renderer!.root.findAll((node) => node.props.testID === 'route-window' && (node.type as unknown) === 'View')[0];
  const flat = (node: ReactTestInstance) => (StyleSheet.flatten(node.props.style) ?? {}) as Record<string, unknown>;
  const closeButton = () =>
    renderer!.root.findAll((node) => node.props.accessibilityLabel === WINDOW_CLOSE_LABEL && typeof node.props.onPress === 'function')[0];
  const titleBar = () =>
    renderer!.root.findAll(
      (node) => typeof node.type === 'string' && node.props.accessibilityRole === 'header' && node.props.children === 'Tarefa',
    );

  /** O texto de uma das telas da pilha ("hoje", "tarefa", "precos"). */
  const screenText = (label: string) =>
    renderer!.root.findAll((entry) => (entry.type as unknown) === 'Text' && entry.props.children === label)[0];
  /**
   * A tela de onde a pessoa veio (a Hoje, nas abas) está desenhada: a caixa da pilha dela não está escondida (a caixa
   * que não desenha nada, `display: contents`, em volta de cada tela no navegador, não conta).
   */
  const behindShown = () => {
    let node: ReactTestInstance | null = screenText('hoje');
    while (node && !((node.type as unknown) === 'View' && flat(node).display !== undefined && flat(node).display !== 'contents')) node = node.parent;
    return flat(node!).display !== 'none';
  };
  /** A tela com esse texto está fora do teclado e do leitor de tela (`inert`, numa das caixas em volta dela). */
  const inertAround = (label: string) => {
    for (let node: ReactTestInstance | null = screenText(label); node; node = node.parent) {
      if ((node.type as unknown) === 'View' && node.props.inert === true) return true;
    }
    return false;
  };

  async function web(desktop: boolean, width = desktop ? 1440 : 800) {
    jest.replaceProperty(Platform, 'OS', 'web');
    mockDesktop = desktop;
    await act(async () => Dimensions.set({ window: { ...WINDOW, width, height: 900 } }));
  }
  async function openTask() {
    await act(async () => router.push({ pathname: '/tarefa/[id]', params: { id: 'nova' } }));
    await settle();
  }

  it('as opções: no celular, a janela que sobe de sempre; no computador, por cima da tela de antes, sem fundo e sem o cabeçalho do Stack', () => {
    expect(windowOptions(false, { title: 'Tarefa' })).toEqual({ title: 'Tarefa', presentation: 'modal' });
    const desktop = windowOptions(true, { title: 'Tarefa' });
    expect(desktop).toMatchObject({ title: 'Tarefa', presentation: 'transparentModal', contentStyle: { backgroundColor: 'transparent' } });
    // O cabeçalho do Stack fica vazio: o título vai na barra da caixa.
    expect(desktop.header?.()).toBeNull();
    // A que desenha o próprio alto diz o nome da janela: no computador ele vira o título (o nome da caixa para o leitor
    // de tela), e no celular nada muda.
    expect(windowOptions(true, { headerShown: false }, 'Nuke')).toMatchObject({ headerShown: false, title: 'Nuke', presentation: 'transparentModal' });
    expect(windowOptions(false, { headerShown: false }, 'Nuke')).toEqual({ headerShown: false, presentation: 'modal' });
  });

  it('no celular e no tablet, nada em volta da tela', async () => {
    mockDesktop = true;
    await open('/', WINDOWS);
    await openTask();
    expect(where().pathname).toBe('/tarefa/nova');
    expect(box()).toBeUndefined();
    // Nem a caixa que tira do teclado a tela coberta (só do navegador).
    expect(renderer!.root.findAll((node) => 'inert' in node.props)).toHaveLength(0);
  });

  it('na janela estreita do navegador, a página de sempre: as caixas só ocupam a tela, sem título a mais nem "Fechar"', async () => {
    await web(false);
    await open('/', WINDOWS);
    await openTask();
    expect(flat(box())).toEqual({ flex: 1 });
    expect(flat(box().parent!.parent!)).toEqual({ flex: 1 });
    expect(box().props.role).toBeUndefined();
    // Uma página: a de antes fica escondida.
    expect(behindShown()).toBe(false);
    expect(titleBar()).toHaveLength(0);
    expect(closeButton()).toBeUndefined();
  });

  it('no computador, uma caixa no meio da janela, com o app escurecido atrás, o título e o "Fechar"', async () => {
    await web(true);
    await open('/', WINDOWS);
    await openTask();
    expect(box().props).toMatchObject({ role: 'dialog', 'aria-modal': true, 'aria-label': 'Tarefa' });
    expect(flat(box())).toMatchObject({ width: '100%', maxWidth: DESKTOP_WINDOW_WIDTH, height: windowHeight(900), overflow: 'hidden' });
    // O fundo escurecido cobre a janela inteira (a barra lateral também), por cima do cabeçalho da tela de trás.
    const dim = flat(box().parent!.parent!);
    expect(dim).toMatchObject({ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' });
    expect(dim.backgroundColor).toBe('rgba(0,0,0,0.4)');
    expect(titleBar()).toHaveLength(1);
    // A tela de onde a pessoa veio continua embaixo, na pilha, e desenhada atrás do fundo escurecido.
    expect(stacked()).toEqual(['(tabs)', 'tarefa/[id]']);
    expect(behindShown()).toBe(true);
    await act(async () => closeButton().props.onPress());
    await settle();
    expect(where().pathname).toBe('/');
    expect(stacked()).toEqual(['(tabs)']);
  });

  it('a janela que cruza a largura do computador com a tela aberta não a monta de novo', async () => {
    mounts = 0;
    await web(false);
    await open('/', WINDOWS);
    await openTask();
    expect(titleBar()).toHaveLength(0);
    await web(true);
    expect(titleBar()).toHaveLength(1);
    expect(box().props.role).toBe('dialog');
    expect(behindShown()).toBe(true);
    await web(false);
    expect(titleBar()).toHaveLength(0);
    expect(behindShown()).toBe(false);
    expect(mounts).toBe(1);
  });

  it('aberta direto pelo endereço (nada embaixo), o "Fechar" leva à parte da aba onde fica o que ela mostra', async () => {
    await web(true);
    await open('/tarefa/nova', WINDOWS);
    expect(stacked()).toEqual(['tarefa/[id]']);
    await act(async () => closeButton().props.onPress());
    await settle();
    // As tarefas, em Casa → Dia a dia, e não a primeira parte da aba que a abertura escolhesse sozinha.
    expect(where()).toEqual({ pathname: '/casa', params: { aba: 'dia', dia: 'tarefas' } });
  });

  it('uma página aberta por cima da janela: as telas de baixo, que continuam desenhadas atrás dela, saem do teclado', async () => {
    await web(true);
    await open('/', WINDOWS);
    await openTask();
    // Com a janela por cima, a tela de trás fica como está: o teclado é da caixa, que segura o foco dentro dela.
    expect(inertAround('hoje')).toBe(false);
    expect(inertAround('tarefa')).toBe(false);
    await act(async () => router.push('/precos'));
    await settle();
    expect(stacked()).toEqual(['(tabs)', 'tarefa/[id]', 'precos']);
    // O Stack do navegador ainda desenha a Hoje (a de baixo de uma `transparentModal`), escondida atrás da página: o
    // `aria-hidden` dela não a tira do Tab, o `inert` tira.
    expect(behindShown()).toBe(true);
    expect(inertAround('hoje')).toBe(true);
    expect(inertAround('tarefa')).toBe(true);
    expect(inertAround('precos')).toBe(false);
    await act(async () => router.back());
    await settle();
    expect(stacked()).toEqual(['(tabs)', 'tarefa/[id]']);
    expect(inertAround('hoje')).toBe(false);
    expect(inertAround('tarefa')).toBe(false);
    await act(async () => router.back());
    await settle();
    expect(inertAround('hoje')).toBe(false);
  });

  it('com a barra lateral na tela, a caixa fica no meio do lugar ao lado dela, sem cobri-la', async () => {
    await web(true, 1024);
    await open('/', WINDOWS);
    await openTask();
    const alone = flat(box().parent!.parent!);
    expect(alone.paddingLeft).toBeUndefined();
    await act(async () => renderer!.unmount());
    sidebarShown = true;
    await open('/', WINDOWS);
    await openTask();
    const dim = flat(box().parent!.parent!);
    // O fundo escurecido continua cobrindo a janela inteira (a barra também, escurecida), mas a margem da esquerda pula
    // a barra: a caixa de 720 começa depois dela, também na janela mais estreita do computador.
    expect(dim).toMatchObject({ position: 'fixed', left: 0, paddingLeft: SIDEBAR_SPACE + space.xl });
    const room = 1024 - (SIDEBAR_SPACE + space.xl) - space.xl;
    expect(SIDEBAR_SPACE + space.xl + (room - Math.min(DESKTOP_WINDOW_WIDTH, room)) / 2).toBeGreaterThanOrEqual(SIDEBAR_SPACE);
  });

  it('a tela que desenha o próprio alto (o Nuke) ganha a caixa, sem a barra do título, e com o nome dela', async () => {
    await web(true);
    await open('/', WINDOWS);
    await act(async () => router.push('/nuke'));
    await settle();
    expect(box().props).toMatchObject({ role: 'dialog', 'aria-modal': true, 'aria-label': 'Nuke' });
    expect(closeButton()).toBeUndefined();
  });

  describe('o "Fechar" que a própria tela desenha (o do Nuke, o único que ele tem na caixa)', () => {
    /** Como o alto do Nuke de verdade (app/nuke.tsx): o "Fechar" dele fecha pelo closeWindow. */
    const OWN_CLOSE = 'Fechar o Nuke';
    const WITH_OWN_CLOSE = {
      ...WINDOWS,
      nuke: () => (
        <Pressable accessibilityLabel={OWN_CLOSE} onPress={() => closeWindow('nuke')}>
          <Text>nuke</Text>
        </Pressable>
      ),
    };
    const ownClose = () => renderer!.root.findAll((node) => node.props.accessibilityLabel === OWN_CLOSE && typeof node.props.onPress === 'function')[0];

    it('aberto direto pelo endereço (nada embaixo, e o fundo escurecido cobrindo a barra lateral), leva à Hoje', async () => {
      await web(true);
      await open('/nuke', WITH_OWN_CLOSE);
      expect(stacked()).toEqual(['nuke']);
      expect(box().props['aria-label']).toBe('Nuke');
      await act(async () => ownClose().props.onPress());
      await settle();
      expect(where().pathname).toBe('/');
      expect(stacked()).toEqual(['(tabs)']);
    });

    it('aberto de uma aba, volta para ela', async () => {
      await web(true);
      await open('/casa', WITH_OWN_CLOSE);
      await act(async () => router.push('/nuke'));
      await settle();
      expect(stacked()).toEqual(['(tabs)', 'nuke']);
      await act(async () => ownClose().props.onPress());
      await settle();
      expect(where().pathname).toBe('/casa');
      expect(stacked()).toEqual(['(tabs)']);
    });
  });

  it('toda tela em janela fecha pelo closeWindow, nunca por um router.back() que, sem nada embaixo, não faz nada', () => {
    const layout = readFileSync(join(__dirname, '..', '..', 'app', '_layout.tsx'), 'utf8');
    const windows = [...layout.matchAll(/<Stack\.Screen name="([^"]+)" options=\{windowOptions\(desktop, (\{[^}]*\})/g)];
    expect(windows.length).toBeGreaterThan(10);
    for (const [, name, options] of windows) {
      const source = readFileSync(join(__dirname, '..', '..', 'app', `${name}.tsx`), 'utf8');
      // O serviço, depois de salvar ou excluir, vai para o prestador dele (goBackOr), que o endereço nem sempre diz.
      expect([name, /router\.back\(/.test(source)]).toEqual([name, false]);
      // As que desenham o próprio alto (sem a barra da caixa, no computador) têm só o próprio "Fechar".
      if (options.includes('headerShown: false')) expect([name, source.includes(`closeWindow('${name}')`)]).toEqual([name, true]);
    }
  });

  describe('no navegador: o Esc, o foco do teclado dentro da caixa e o foco de volta ao fechar', () => {
    /** O que tinha o foco quando a janela abriu (o botão "Nova tarefa" da tela de trás). */
    const opener = { name: 'Nova tarefa' };
    beforeEach(() => {
      (global as { document?: unknown }).document = { activeElement: opener, body: {} };
      jest.mocked(trapWindowFocus).mockClear();
      jest.mocked(restoreFocus).mockClear();
      jest.mocked(rememberOpener).mockClear();
      mockUntrap.mockClear();
    });
    afterEach(async () => {
      // A tela sai antes da página de mentira.
      await act(async () => renderer?.unmount());
      renderer = undefined;
      delete (global as { document?: unknown }).document;
    });

    /** A tela que estava por cima quando a desta caixa abriu (o que a caixa guardou com quem a abriu: rememberOpener). */
    const belowOf = (layer: unknown) => jest.mocked(rememberOpener).mock.calls.find(([which]) => which === layer)?.[2];
    /**
     * A caixa sem desenho em volta da página com esse texto (ScreenLayer), como a caixa da janela (`box`): o View dela,
     * que no navegador é o elemento da página e é o que ela guardou com quem a abriu.
     */
    const layerOf = (label: string) => {
      // O texto da tela, e não o título dela no cabeçalho do Stack (que fica fora da caixa).
      for (const text of renderer!.root.findAll((entry) => (entry.type as unknown) === 'Text' && entry.props.children === label)) {
        for (let node: ReactTestInstance | null = text; node; node = node.parent) {
          if ((node.type as unknown) === 'View' && flat(node).display === 'contents') return node.parent!.instance as unknown;
        }
      }
      return undefined;
    };
    /** O Esc na caixa de cima (o que a caixa aberta por último deu ao ligar o teclado). */
    const onEscapeOfTop = () => jest.mocked(trapWindowFocus).mock.calls.at(-1)![2]();

    it('no computador, a caixa aberta liga o teclado; o Esc fecha a janela, e o foco volta para quem a abriu', async () => {
      await web(true);
      await open('/', WINDOWS);
      expect(trapWindowFocus).not.toHaveBeenCalled();
      await openTask();
      expect(trapWindowFocus).toHaveBeenCalledTimes(1);
      const [page, node, onEscape] = jest.mocked(trapWindowFocus).mock.calls[0];
      expect(page).toBe(document);
      // A caixa de verdade (a que tem o nome e o papel de janela): o View dela, que no navegador é o elemento da página.
      expect(node).toBeTruthy();
      expect(node).toBe(box().parent!.instance);
      // A caixa guardou, com quem a abriu, a tela que estava por cima naquela hora: as abas, que continuam na página
      // (a janela abriu por cima delas, e não no lugar).
      expect(belowOf(node)).toBeTruthy();
      expect(belowOf(node)).toBe(layerOf('hoje'));
      await act(async () => onEscape());
      await settle();
      expect(where().pathname).toBe('/');
      expect(stacked()).toEqual(['(tabs)']);
      expect(mockUntrap).toHaveBeenCalledTimes(1);
      expect(restoreFocus).toHaveBeenCalledWith(document, opener, belowOf(node));
    });

    it('aberta pela opção de um menu de ações, o foco volta para quem abriu o menu, e não para a opção, que sai com ele', async () => {
      // O "Adicionar" abriu o menu; a opção "Tarefa", dentro do menu, tinha o foco quando a janela abriu.
      const adicionar = { name: 'Adicionar' };
      const option = { name: 'Tarefa' };
      // A caixa do menu na página: a opção está dentro dela, e a caixa inteira do menu (a que diz `aria-modal`) é ela.
      const menuBox = {
        name: 'menu',
        contains: (node: unknown) => node === option,
        closest: (selector: string) => (selector === OTHER_WINDOW ? menuBox : null),
      };
      const page = {
        activeElement: option as { name: string },
        body: {},
        contains: (node: unknown) => node === adicionar,
      };
      (global as { document?: unknown }).document = page;
      handMenuOpener({ menu: menuBox, opener: adicionar });
      try {
        await web(true);
        await open('/', WINDOWS);
        await openTask();
        const first = box().parent!.instance;
        await act(async () => closeButton().props.onPress());
        await settle();
        expect(restoreFocus).toHaveBeenCalledWith(page, adicionar, belowOf(first));
        // Aberta de outro jeito (o foco fora do menu de antes, que já fechou): quem tinha o foco, como sempre.
        jest.mocked(restoreFocus).mockClear();
        page.activeElement = { name: 'Nova tarefa' };
        await openTask();
        const second = box().parent!.instance;
        await act(async () => closeButton().props.onPress());
        await settle();
        expect(restoreFocus).toHaveBeenCalledWith(page, page.activeElement, belowOf(second));
      } finally {
        handMenuOpener(null);
      }
    });

    /**
     * Uma página de mentira onde só `still` continua (quem saiu com a tela trocada não está mais nela), com o corpo da
     * página de mentira do teste.
     */
    const pageWith = (still: unknown) =>
      ({ body: (document as { body: unknown }).body, contains: (node: unknown) => node === still }) as unknown as Document;

    it('a janela que toma o lugar de outra (router.replace): ao fechar, o foco volta para quem abriu a primeira', async () => {
      await web(true);
      await open('/', WINDOWS);
      await openTask();
      const firstBox = box().parent!.instance;
      // A caixa guarda quem abriu a janela e a tela que estava por cima (o registro que o foco consulta ao fechar).
      expect(rememberOpener).toHaveBeenCalledWith(firstBox, opener, layerOf('hoje'));
      // O botão de dentro da janela que tem o foco quando ela é trocada (o "Registrar próxima dose" da vacina).
      const inside = { name: 'Registrar próxima dose', parentElement: firstBox };
      (document as { activeElement: unknown }).activeElement = inside;
      await act(async () => router.replace({ pathname: '/tarefa/[id]', params: { id: 'outra' } }));
      await settle();
      expect(stacked()).toEqual(['(tabs)', 'tarefa/[id]']);
      const secondBox = box().parent!.instance;
      expect(secondBox).not.toBe(firstBox);
      // A janela nova leu a de antes como a de cima, no primeiro desenho dela (a de antes ainda estava na página).
      expect(rememberOpener).toHaveBeenCalledWith(secondBox, inside, firstBox);
      jest.mocked(restoreFocus).mockClear();
      await act(async () => closeButton().props.onPress());
      await settle();
      expect(where().pathname).toBe('/');
      expect(restoreFocus).toHaveBeenCalledWith(document, inside, firstBox);
      // O botão saiu da página com a primeira janela: o foco vai para quem abriu a primeira, que continua nela.
      expect(liveOpener(pageWith(opener), inside as unknown as Element, firstBox)).toBe(opener);
    });

    it('a janela que toma o lugar de uma página (o Escanear que abre a do QR code): o foco volta para quem abriu a página', async () => {
      await web(true);
      await open('/', WINDOWS);
      const tile = { name: 'Preços' };
      (document as { activeElement: unknown }).activeElement = tile;
      await act(async () => router.push('/precos'));
      await settle();
      // A caixa sem desenho da página guarda quem a abriu.
      const layer = jest.mocked(rememberOpener).mock.calls.find(([, who]) => who === (tile as unknown))?.[0];
      expect(layer).toBeTruthy();
      const inside = { name: 'Ler o link', parentElement: layer };
      (document as { activeElement: unknown }).activeElement = inside;
      await act(async () => router.replace({ pathname: '/tarefa/[id]', params: { id: 'nova' } }));
      await settle();
      expect(stacked()).toEqual(['(tabs)', 'tarefa/[id]']);
      jest.mocked(restoreFocus).mockClear();
      await act(async () => closeButton().props.onPress());
      await settle();
      expect(where().pathname).toBe('/');
      expect(restoreFocus).toHaveBeenCalledWith(document, inside, layer);
      expect(liveOpener(pageWith(tile), inside as unknown as Element, layer as object)).toBe(tile);
    });

    it('a câmera do Escanear lê o QR code sozinha (nada da página com o foco): a janela, e a que toma o lugar dela, devolvem o foco a quem abriu a página', async () => {
      await web(true);
      await open('/', WINDOWS);
      const tile = { name: 'Escanear' };
      (document as { activeElement: unknown }).activeElement = tile;
      await act(async () => router.push('/precos'));
      await settle();
      const layer = jest.mocked(rememberOpener).mock.calls.find(([, who]) => who === (tile as unknown))?.[0];
      expect(layer).toBeTruthy();
      expect(layer).toBe(layerOf('precos'));
      // A Hoje ficou escondida e fora do teclado (`inert`): o navegador tira o foco do "Escanear", e ele cai no corpo da
      // página. A câmera lê o QR code e troca a página pela janela sem que nada da página tenha o foco.
      const body = (document as { body: unknown }).body;
      (document as { activeElement: unknown }).activeElement = body;
      await act(async () => router.replace({ pathname: '/tarefa/[id]', params: { id: 'nova' } }));
      await settle();
      expect(stacked()).toEqual(['(tabs)', 'tarefa/[id]']);
      const qrBox = box().parent!.instance;
      // A janela lê o corpo da página como quem a abriu, e a página que ela trocou como a de cima naquela hora.
      expect(rememberOpener).toHaveBeenCalledWith(qrBox, body, layer);
      jest.mocked(restoreFocus).mockClear();
      await act(async () => onEscapeOfTop());
      await settle();
      expect(where().pathname).toBe('/');
      expect(restoreFocus).toHaveBeenCalledWith(document, body, layer);
      // O corpo da página não diz de onde a janela veio: a página que ela trocou saiu, e quem abriu a página continua.
      expect(liveOpener(pageWith(tile), body as Element, layer as object)).toBe(tile);

      // De novo, e agora a janela do QR code vira a nota pendente (o aviso "Buscando a nota na Sefaz…" com o foco).
      (document as { activeElement: unknown }).activeElement = tile;
      await act(async () => router.push('/precos'));
      await settle();
      const again = layerOf('precos');
      (document as { activeElement: unknown }).activeElement = body;
      await act(async () => router.replace({ pathname: '/tarefa/[id]', params: { id: 'nova' } }));
      await settle();
      const firstBox = box().parent!.instance;
      expect(rememberOpener).toHaveBeenCalledWith(firstBox, body, again);
      // O Modal do react-native-web toma o foco num portal no fim da página, fora da caixa da janela.
      const busy = { name: 'Buscando a nota na Sefaz…', parentElement: { name: 'portal' } };
      (document as { activeElement: unknown }).activeElement = busy;
      await act(async () => router.replace({ pathname: '/tarefa/[id]', params: { id: 'pendente' } }));
      await settle();
      expect(stacked()).toEqual(['(tabs)', 'tarefa/[id]']);
      const pendingBox = box().parent!.instance;
      expect(rememberOpener).toHaveBeenCalledWith(pendingBox, busy, firstBox);
      jest.mocked(restoreFocus).mockClear();
      await act(async () => closeButton().props.onPress());
      await settle();
      expect(where().pathname).toBe('/');
      expect(restoreFocus).toHaveBeenCalledWith(document, busy, firstBox);
      expect(liveOpener(pageWith(tile), busy as unknown as Element, firstBox as object)).toBe(tile);
    });

    it('o "Fechar" também devolve o foco a quem abriu', async () => {
      await web(true);
      await open('/', WINDOWS);
      await openTask();
      const node = box().parent!.instance;
      await act(async () => closeButton().props.onPress());
      await settle();
      expect(where().pathname).toBe('/');
      expect(restoreFocus).toHaveBeenCalledWith(document, opener, belowOf(node));
    });

    it('uma janela por cima de outra: só a de cima responde ao teclado', async () => {
      await web(true);
      await open('/', WINDOWS);
      await openTask();
      await act(async () => router.push('/nuke'));
      await settle();
      // A da tarefa desligou o teclado dela quando a do Nuke abriu por cima, e a do Nuke ligou o dela.
      expect(trapWindowFocus).toHaveBeenCalledTimes(2);
      expect(mockUntrap).toHaveBeenCalledTimes(1);
      const onEscape = jest.mocked(trapWindowFocus).mock.calls[1][2];
      await act(async () => onEscape());
      await settle();
      expect(stacked()).toEqual(['(tabs)', 'tarefa/[id]']);
      // De volta à da tarefa: o teclado é dela de novo, e o foco voltou para quem abriu o Nuke.
      expect(trapWindowFocus).toHaveBeenCalledTimes(3);
      expect(restoreFocus).toHaveBeenCalledTimes(1);
    });

    it('na janela estreita, a página de sempre: nada de teclado a mais, nem foco devolvido', async () => {
      await web(false);
      await open('/', WINDOWS);
      await openTask();
      await act(async () => router.back());
      await settle();
      expect(where().pathname).toBe('/');
      expect(trapWindowFocus).not.toHaveBeenCalled();
      expect(restoreFocus).not.toHaveBeenCalled();
    });
  });

  it('as outras telas, no computador, ficam como eram', async () => {
    await web(true);
    await open('/', WINDOWS);
    await act(async () => router.push('/precos'));
    await settle();
    expect(where().pathname).toBe('/precos');
    expect(box()).toBeUndefined();
  });

  it('no layout da raiz, toda tela que sobe como janela passa por windowOptions, e o Stack desenha a caixa', () => {
    const layout = readFileSync(join(__dirname, '..', '..', 'app', '_layout.tsx'), 'utf8');
    expect(layout).toContain('screenLayout={routeWindowLayout}');
    // Uma janela nova escrita à mão (presentation: 'modal') seria, no computador, uma página inteira.
    expect(layout).not.toMatch(/presentation:/);
    const windows = [...layout.matchAll(/<Stack\.Screen name="([^"]+)" options=\{windowOptions\(desktop, /g)].map((match) => match[1]);
    expect(windows).toEqual([
      'nota/qrcode',
      'nota/pendente',
      'despensa/[id]',
      'reposicao/[id]',
      'tarefa/[id]',
      'remedio/[id]',
      'pessoa/[id]',
      'consulta/[id]',
      'compromisso/[id]',
      'vacina/[id]',
      'servico/[id]',
      'nuke',
      'orcamento',
      'conta/[id]',
      'gasto/[id]',
      'consultor/conversa',
    ]);
    // E toda janela tem nome (o que o leitor de tela fala ao abrir a caixa): o título, ou, na que desenha o próprio
    // alto, o nome que vai como terceiro argumento.
    const calls = [...layout.matchAll(/options=\{windowOptions\(desktop, (\{[^}]*\})(, '[^']+')?\)\} \/>/g)];
    expect(calls).toHaveLength(windows.length);
    for (const [, options, name] of calls) expect(/title: '[^']+'/.test(options) || Boolean(name)).toBe(true);
  });
});
