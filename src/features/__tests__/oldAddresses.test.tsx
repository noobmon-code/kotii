import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import HouseScreen from '@/app/(tabs)/casa';
import FinanceScreen from '@/app/(tabs)/financas';
import FamilyRedirect from '@/app/familia';
import { FEATURES } from '@/lib/features';
import { Segmented } from '@/ui/primitives';

// Os endereços antigos num roteador de verdade (o Expo Router, com as rotas montadas na memória): /familia vira a
// aba Configurações, /configuracoes abre a aba (não mais uma tela por cima), e /casa?aba=compras e
// /casa?aba=despensa vão para Compras, trocando o endereço; com a chave de Finanças ligada, /financas?aba=notas vai
// para Compras → Notas. A Casa, Finanças e o redirecionamento da Família são os de verdade; as outras abas só dizem
// onde estão. O que mais importa: depois de mandar para Compras, a Casa não fica
// com o ?aba= antigo guardado (a barra de abas navega com os parâmetros guardados, e a Casa nunca mais abriria).

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
// As partes da Casa e as buscas delas não entram nesta história.
const mockIdle = { data: [], isPending: false, isError: false, isRefetching: false, error: null, refetch: jest.fn() };
jest.mock('@/data/home', () => ({ useChores: () => mockIdle }));
jest.mock('@/data/house', () => ({ useEquipmentList: () => mockIdle }));
jest.mock('@/data/providers', () => ({ JOBS_KEY: 'serviceJobs', PROVIDERS_KEY: 'serviceProviders' }));
jest.mock('@/features/ChoresPanel', () => ({ ChoresPanel: () => null }));
jest.mock('@/features/EquipmentPanel', () => ({ EquipmentPanel: () => null }));
jest.mock('@/features/DocumentsSection', () => ({ DocumentsSection: () => null }));
jest.mock('@/features/AgendaPanel', () => ({ AgendaPanel: () => null, agendaQueryKeys: () => [] }));
// As partes de Finanças também não.
jest.mock('@/data/financeBeta', () => ({ useBeta: () => ({ data: false }) }));
jest.mock('@/features/finance/BillsPanel', () => ({ BillsPanel: () => null }));
jest.mock('@/features/finance/ConsultorCard', () => ({ ConsultorCard: () => null }));
jest.mock('@/features/finance/FinanceSummaryPanel', () => {
  const { Text: MockText } = jest.requireActual<typeof import('react-native')>('react-native');
  return { FinanceSummaryPanel: () => <MockText>resumo de finanças</MockText> };
});
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

/** Uma aba de mentira: diz qual é e a parte pedida. */
function Stub({ name }: { name: string }) {
  const { aba } = useLocalSearchParams<{ aba?: string }>();
  return <Text>{aba ? `${name}:${aba}` : name}</Text>;
}

const ROUTES = {
  _layout: () => (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="familia" options={{ headerShown: false }} />
    </Stack>
  ),
  '(tabs)/_layout': () => (
    <Tabs>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="compras" />
      <Tabs.Screen name="casa" />
      {/* Como no layout de verdade: Finanças só existe com a chave ligada. */}
      <Tabs.Protected guard={FEATURES.finance}>
        <Tabs.Screen name="financas" />
      </Tabs.Protected>
      <Tabs.Screen name="configuracoes" />
    </Tabs>
  ),
  '(tabs)/index': () => <Stub name="hoje" />,
  '(tabs)/compras': () => <Stub name="compras" />,
  '(tabs)/casa': HouseScreen,
  '(tabs)/financas': FinanceScreen,
  '(tabs)/configuracoes': () => <Stub name="configuracoes" />,
  familia: FamilyRedirect,
};

let renderer: ReactTestRenderer | undefined;

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  // A chave de Finanças volta a ser a de verdade (desligada).
  jest.restoreAllMocks();
});

/** Abre o app pelo endereço, como um favorito ou o app instalado na tela inicial. */
async function open(location: string) {
  process.env.EXPO_ROUTER_IMPORT_MODE = 'sync';
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  await act(async () => {
    renderer = create(<ExpoRoot context={inMemoryContext(ROUTES)} location={location} wrapper={wrapper} />);
  });
  // O redirecionamento roda depois que a tela ganha o foco.
  for (let i = 0; i < 3; i += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

const where = () => ({ pathname: store.getRouteInfo().pathname as string, params: store.getRouteInfo().params as Record<string, unknown> });
const shown = () => {
  const texts = renderer!.root.findAll((node) => node.type === Text).map((node) => String(node.props.children));
  return texts;
};
interface RouteState {
  name: string;
  params?: Record<string, unknown>;
  state?: { routes: RouteState[] };
}

/** A rota com esse nome, em qualquer navegador do app. */
function findRoute(name: string, routes: RouteState[] = store.state.routes): RouteState | undefined {
  for (const route of routes) {
    if (route.name === name) return route;
    const inside = route.state ? findRoute(name, route.state.routes) : undefined;
    if (inside) return inside;
  }
  return undefined;
}

/** Os parâmetros guardados de uma aba (o que a barra de abas usa ao navegar até ela). */
function storedParams(tab: string): Record<string, unknown> {
  const route = findRoute(tab);
  if (!route) throw new Error(`a aba ${tab} não está no navegador`);
  return route.params ?? {};
}

/** As telas da pilha de cima (a das abas e as que abrem por cima delas). */
const stackRoutes = () => findRoute('__root')!.state!.routes.map((route) => route.name);

describe('os endereços antigos', () => {
  it('/familia abre a aba Configurações, trocando o endereço (voltar não cai na Família de novo)', async () => {
    await open('/familia');
    expect(where().pathname).toBe('/configuracoes');
    expect(store.getRouteInfo().segments).toEqual(['(tabs)', 'configuracoes']);
    expect(shown()).toContain('configuracoes');
    expect(stackRoutes()).toEqual(['(tabs)']);
  });

  it('/configuracoes abre a aba (antes, uma tela por cima das abas)', async () => {
    await open('/configuracoes');
    expect(where().pathname).toBe('/configuracoes');
    expect(store.getRouteInfo().segments).toEqual(['(tabs)', 'configuracoes']);
  });

  it('/casa?aba=compras vai para Compras (as listas), e a Casa não guarda o ?aba= antigo', async () => {
    await open('/casa?aba=compras');
    expect(where()).toEqual({ pathname: '/compras', params: {} });
    expect(shown()).toContain('compras');
    expect(storedParams('casa')?.aba).toBeUndefined();
    // Tocar em Casa na barra (que navega com os parâmetros guardados) abre a Casa, e não Compras de novo.
    await act(async () => router.navigate({ pathname: '/casa', params: storedParams('casa') as Record<string, string> }));
    expect(storedParams('casa')).toEqual({});
    for (let i = 0; i < 3; i += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(where().pathname).toBe('/casa');
    expect(renderer!.root.findByType(Segmented).props.value).toBe('tarefas');
  });

  it('/casa?aba=despensa vai para Compras → Despensa', async () => {
    await open('/casa?aba=despensa');
    expect(where()).toEqual({ pathname: '/compras', params: { aba: 'despensa' } });
    expect(shown()).toContain('compras:despensa');
    expect(storedParams('casa')?.aba).toBeUndefined();
  });

  it.each(['tarefas', 'agenda', 'aparelhos', 'documentos'])('/casa?aba=%s fica na Casa, nessa parte', async (aba) => {
    await open(`/casa?aba=${aba}`);
    expect(where()).toEqual({ pathname: '/casa', params: { aba } });
    expect(renderer!.root.findByType(Segmented).props.value).toBe(aba);
  });

  it('com a chave de Finanças ligada, /financas?aba=notas vai para Compras → Notas, e Finanças não guarda o ?aba= antigo', async () => {
    jest.replaceProperty(FEATURES, 'finance', true);
    await open('/financas?aba=notas');
    expect(where()).toEqual({ pathname: '/compras', params: { aba: 'notas' } });
    expect(shown()).toContain('compras:notas');
    expect(storedParams('financas')?.aba).toBeUndefined();
    // Tocar em Finanças na barra abre Finanças, e não as notas de novo.
    await act(async () => router.navigate({ pathname: '/financas', params: storedParams('financas') as Record<string, string> }));
    for (let i = 0; i < 3; i += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(where().pathname).toBe('/financas');
    expect(shown()).toContain('resumo de finanças');
  });

  it('com a chave ligada, as partes que ficaram em Finanças continuam lá', async () => {
    jest.replaceProperty(FEATURES, 'finance', true);
    await open('/financas?aba=contas');
    expect(where()).toEqual({ pathname: '/financas', params: { aba: 'contas' } });
  });
});
