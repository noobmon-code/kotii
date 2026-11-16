import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Text, View } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import TabsLayout from '@/app/(tabs)/_layout';
import { APP_AREAS } from '@/domain/desktop';
import { NUKE_LABEL, Sidebar } from '@/features/desktop/Sidebar';
import { NukeButton } from '@/features/nuke/NukeButton';
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
