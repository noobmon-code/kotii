import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import HealthScreen from '@/app/(tabs)/saude';
import { CarePanel } from '@/features/health/CarePanel';
import { MedicationsPanel } from '@/features/health/MedicationsPanel';
import { PlansPanel } from '@/features/health/PlansPanel';
import { ActionSheet, type SheetAction } from '@/ui/ActionSheet';
import { Button, Segmented, Tile } from '@/ui/primitives';

// A aba Saúde de verdade num roteador de verdade (o Expo Router, com as rotas montadas na memória): as partes
// Resumo, Remédios, Cuidados e Planos na URL (?aba=), o seletor de Planos (?plano=), a pessoa escolhida (?pessoa=)
// que passa de uma parte para as outras, e os endereços antigos do treino e da dieta (?aba=treino e ?aba=dieta),
// que abrem Planos com aquele plano. Os painéis ficam de fora (têm os testes deles): aqui só importa o que a aba
// entrega a cada um.

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
jest.mock('@/data/home', () => ({ useMedications: () => ({ data: [], isSuccess: true }) }));
jest.mock('@/features/health/CarePanel', () => ({ CarePanel: () => null }));
jest.mock('@/features/health/MedicationsPanel', () => ({ MedicationsPanel: () => null }));
jest.mock('@/features/health/PlansPanel', () => ({ PlansPanel: () => null }));
jest.mock('@/features/health/HealthTodaySections', () => ({ HealthTodaySections: () => null }));
jest.mock('@/features/health/MedicationSections', () => ({
  MedicationRefills: () => null,
  MedicationsToday: () => null,
  useRefills: () => ({ rows: [] }),
}));
jest.mock('@/features/health/useHealthOverview', () => ({
  useHealthOverview: () => ({ loaded: false, workoutsToday: [], upcoming: [], toConfirm: [], vaccinesDue: [], drafts: [] }),
}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

/** Uma tela de mentira: diz qual é e o id pedido. */
function Stub({ name }: { name: string }) {
  const params = useLocalSearchParams<{ id?: string; pessoa?: string }>();
  return <Text>{[name, params.id, params.pessoa].filter(Boolean).join(':')}</Text>;
}

const ROUTES = {
  _layout: () => (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  ),
  '(tabs)/_layout': () => (
    <Tabs>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="saude" />
    </Tabs>
  ),
  '(tabs)/index': () => <Stub name="hoje" />,
  '(tabs)/saude': HealthScreen,
  'remedio/[id]': () => <Stub name="remedio" />,
  'consulta/[id]': () => <Stub name="consulta" />,
  'vacina/[id]': () => <Stub name="vacina" />,
  'exame/[id]': () => <Stub name="exame" />,
};

let renderer: ReactTestRenderer | undefined;

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

const settle = async () => {
  // O efeito de foco (o endereço antigo) roda depois que a tela ganha o foco.
  for (let i = 0; i < 3; i += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
};

/** Abre o app pelo endereço, como um favorito, um atalho ou o app instalado na tela inicial. */
async function open(location: string) {
  process.env.EXPO_ROUTER_IMPORT_MODE = 'sync';
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  await act(async () => {
    renderer = create(<ExpoRoot context={inMemoryContext(ROUTES)} location={location} wrapper={wrapper} />);
  });
  await settle();
}

const where = () => ({ pathname: store.getRouteInfo().pathname as string, params: store.getRouteInfo().params as Record<string, unknown> });
/** Os seletores da tela: o das partes e, em Planos, o dos planos. */
const selectors = () => renderer!.root.findAllByType(Segmented);
const part = () => selectors()[0].props.value;
const one = <T,>(type: React.ComponentType<T>): ReactTestInstance | undefined => renderer!.root.findAllByType(type)[0];

async function choose(selector: ReactTestInstance, value: string) {
  await act(async () => selector.props.onChange(value));
  await settle();
}

describe('as partes da Saúde', () => {
  /** O "Adicionar" do Resumo e o menu dele. */
  const addButton = () => renderer!.root.findAllByType(Button).find((button) => button.props.title === 'Adicionar')!;
  const addSheet = () => renderer!.root.findAllByType(ActionSheet).find((sheet) => sheet.props.title === 'Adicionar')!;

  it('sem parte, o Resumo, com um "Adicionar" primário no alto, que pergunta o quê: o remédio primeiro', async () => {
    await open('/saude');
    expect(part()).toBe('resumo');
    expect(selectors()[0].props.options.map((o: { label: string }) => o.label)).toEqual(['Resumo', 'Remédios', 'Cuidados', 'Planos']);
    // Os azulejos ficam só na tela Hoje: a ação principal de cada parte é um botão primário no alto.
    expect(renderer!.root.findAllByType(Tile)).toHaveLength(0);
    const buttons = renderer!.root.findAllByType(Button);
    expect(buttons[0]).toBe(addButton());
    expect(addButton().props.variant ?? 'primary').toBe('primary');
    // O leitor de tela diz o que ele cria (o nome visível está no começo do que ele diz).
    expect(addButton().props.accessibilityLabel).toBe('Adicionar remédio, consulta, vacina ou exame');
    expect(addSheet().props.visible).toBe(false);
    await act(async () => addButton().props.onPress());
    expect(addSheet().props.visible).toBe(true);
    expect((addSheet().props.actions as SheetAction[]).map((action) => action.label)).toEqual(['Remédio', 'Consulta', 'Vacina', 'Exame']);
  });

  it.each([
    ['Remédio', '/remedio/novo'],
    ['Consulta', '/consulta/nova'],
    ['Vacina', '/vacina/nova'],
    ['Exame', '/exame/nova'],
  ])('"Adicionar" → "%s", no Resumo, abre %s', async (label, pathname) => {
    await open('/saude');
    await act(async () => addButton().props.onPress());
    const action = (addSheet().props.actions as SheetAction[]).find((entry) => entry.label === label)!;
    // Como o menu faz: fecha e depois roda a ação.
    await act(async () => {
      addSheet().props.onClose();
      action.onPress();
    });
    await settle();
    expect(where().pathname).toBe(pathname);
    expect(where().params).toEqual({ id: pathname.endsWith('novo') ? 'novo' : 'nova' });
  });

  it('Remédios e Cuidados recebem a pessoa da URL, e a escolhida numa parte continua escolhida na outra', async () => {
    await open('/saude?aba=remedios&pessoa=ana');
    expect(part()).toBe('remedios');
    expect(one(MedicationsPanel)?.props.personId).toBe('ana');
    expect(one(CarePanel)).toBeUndefined();
    // Escolhida "Bia" nos Remédios, os Cuidados abrem nela.
    await act(async () => one(MedicationsPanel)!.props.onPersonChange('bia'));
    await choose(selectors()[0], 'cuidados');
    expect(where()).toEqual({ pathname: '/saude', params: { aba: 'cuidados', pessoa: 'bia' } });
    expect(one(CarePanel)?.props.personId).toBe('bia');
    expect(one(MedicationsPanel)).toBeUndefined();
    // "Todos" tira a pessoa (o parâmetro vazio vale "Todos" em todas as partes).
    await act(async () => one(CarePanel)!.props.onPersonChange(null));
    await choose(selectors()[0], 'planos');
    expect(one(PlansPanel)?.props.personId).toBeNull();
  });
});

describe('Saúde → Planos: o treino e a dieta numa parte só, com um seletor', () => {
  it('sem plano, o treino; o seletor troca o plano e o guarda na URL, com a pessoa', async () => {
    await open('/saude?aba=planos&pessoa=ana');
    expect(selectors()).toHaveLength(2);
    const plans = selectors()[1];
    expect(plans.props.options.map((o: { label: string }) => o.label)).toEqual(['Treino', 'Dieta']);
    expect(plans.props.value).toBe('treino');
    expect(one(PlansPanel)?.props).toMatchObject({ kind: 'workout', personId: 'ana' });
    await choose(plans, 'dieta');
    expect(where()).toEqual({ pathname: '/saude', params: { aba: 'planos', plano: 'dieta', pessoa: 'ana' } });
    expect(selectors()[1].props.value).toBe('dieta');
    expect(one(PlansPanel)?.props).toMatchObject({ kind: 'diet', personId: 'ana' });
  });

  it('o plano escolhido volta com a parte: sair para Cuidados e voltar a Planos reabre a dieta', async () => {
    await open('/saude?aba=planos&plano=dieta');
    await choose(selectors()[0], 'cuidados');
    expect(selectors()).toHaveLength(1);
    await choose(selectors()[0], 'planos');
    expect(where().params).toMatchObject({ aba: 'planos', plano: 'dieta' });
    expect(one(PlansPanel)?.props.kind).toBe('diet');
  });

  it('o seletor é da aba, e não do painel: fica na tela também quando o painel não desenha nada (carregando, ou com erro)', async () => {
    await open('/saude?aba=planos&plano=dieta');
    // O painel de mentira não desenha nada, como o de verdade enquanto carrega (ou quando a busca falha).
    expect(one(PlansPanel)!.children).toHaveLength(0);
    expect(selectors()).toHaveLength(2);
    expect(selectors()[1].props.value).toBe('dieta');
  });
});

describe('os endereços antigos do treino e da dieta', () => {
  it.each([
    ['treino', 'workout'],
    ['dieta', 'diet'],
  ])('/saude?aba=%s abre Planos com esse plano, e o endereço vira o de agora', async (aba, kind) => {
    await open(`/saude?aba=${aba}&pessoa=ana`);
    expect(part()).toBe('planos');
    expect(selectors()[1].props.value).toBe(aba);
    expect(one(PlansPanel)?.props).toMatchObject({ kind, personId: 'ana' });
    expect(where()).toEqual({ pathname: '/saude', params: { aba: 'planos', plano: aba, pessoa: 'ana' } });
  });

  it('o plano do endereço antigo vale mais que um ?plano= que venha junto, e continua no toque em "Planos"', async () => {
    await open('/saude?aba=dieta&plano=treino');
    expect(selectors()[1].props.value).toBe('dieta');
    expect(where().params).toMatchObject({ aba: 'planos', plano: 'dieta' });
    await choose(selectors()[0], 'planos');
    expect(one(PlansPanel)?.props.kind).toBe('diet');
  });

  it('com a aba já aberta em outra parte, o endereço antigo também leva a Planos', async () => {
    await open('/saude?aba=cuidados');
    await act(async () => router.navigate({ pathname: '/saude', params: { aba: 'dieta' } }));
    await settle();
    expect(part()).toBe('planos');
    expect(selectors()[1].props.value).toBe('dieta');
    expect(where().params).toMatchObject({ aba: 'planos', plano: 'dieta' });
  });
});
