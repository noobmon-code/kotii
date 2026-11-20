import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useState } from 'react';
import { Dimensions, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import TabsLayout from '@/app/(tabs)/_layout';
import { APP_AREAS, DESKTOP_WINDOW_WIDTH, windowHeight } from '@/domain/desktop';
import { routeWindowLayout, WINDOW_CLOSE_LABEL, windowOptions } from '@/features/desktop/RouteWindow';
import { NUKE_LABEL, Sidebar } from '@/features/desktop/Sidebar';
import { NukeButton } from '@/features/nuke/NukeButton';
import { useDesktop } from '@/ui/desktop';
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

  // Como o layout da raiz: as opções das telas em janela vêm de `windowOptions`, e a caixa, do `screenLayout`.
  const WINDOWS = {
    ...ROUTES,
    _layout: function Layout() {
      const desktop = useDesktop();
      // Redesenha quando a janela muda de tamanho (o useDesktop de verdade a acompanha).
      useWindowDimensions();
      return (
        <Stack screenLayout={routeWindowLayout}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="precos" />
          <Stack.Screen name="tarefa/[id]" options={windowOptions(desktop, { title: 'Tarefa' })} />
          <Stack.Screen name="nuke" options={windowOptions(desktop, { headerShown: false })} />
        </Stack>
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

  /** A tela de onde a pessoa veio (a Hoje, nas abas) está desenhada: a caixa da pilha dela não está escondida. */
  const behindShown = () => {
    let node: ReactTestInstance | null = renderer!.root.findAll((entry) => (entry.type as unknown) === 'Text' && entry.props.children === 'hoje')[0];
    while (node && !((node.type as unknown) === 'View' && flat(node).display !== undefined)) node = node.parent;
    return flat(node!).display !== 'none';
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
    expect('header' in desktop && desktop.header()).toBeNull();
    expect(windowOptions(true, { headerShown: false })).toMatchObject({ headerShown: false, presentation: 'transparentModal' });
  });

  it('no celular e no tablet, nada em volta da tela', async () => {
    mockDesktop = true;
    await open('/', WINDOWS);
    await openTask();
    expect(where().pathname).toBe('/tarefa/nova');
    expect(box()).toBeUndefined();
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

  it('aberta direto pelo endereço (nada embaixo), o "Fechar" leva à aba da área da tela', async () => {
    await web(true);
    await open('/tarefa/nova', WINDOWS);
    expect(stacked()).toEqual(['tarefa/[id]']);
    await act(async () => closeButton().props.onPress());
    await settle();
    expect(where().pathname).toBe('/casa');
  });

  it('a tela que desenha o próprio alto (o Nuke) ganha a caixa, sem a barra do título', async () => {
    await web(true);
    await open('/', WINDOWS);
    await act(async () => router.push('/nuke'));
    await settle();
    expect(box().props.role).toBe('dialog');
    expect(closeButton()).toBeUndefined();
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
  });
});
