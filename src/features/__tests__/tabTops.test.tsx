import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import HouseScreen from '@/app/(tabs)/casa';
import FinanceScreen from '@/app/(tabs)/financas';
import HealthScreen from '@/app/(tabs)/saude';
import { StyleSheet } from 'react-native';

import { Screen, Segmented } from '@/ui/primitives';

// Casa, Saúde e Finanças não têm mais o cartão de topo (a barra de abas já diz a aba): a primeira coisa da tela é
// o seletor das partes, dentro da margem de cima do aparelho, e puxar para atualizar continua. O nome da aba fica
// só para o leitor de tela, como o título da página.

const mockQuery = () => ({ data: [], isRefetching: false, isSuccess: true, refetch: jest.fn() });
jest.mock('@/data/home', () => ({ useChores: () => mockQuery(), usePantry: () => mockQuery(), useMedications: () => mockQuery() }));
jest.mock('@/data/house', () => ({ useEquipmentList: () => mockQuery() }));
jest.mock('@/data/market', () => ({ useShoppingLists: () => mockQuery() }));
jest.mock('@/data/providers', () => ({ JOBS_KEY: 'serviceJobs', PROVIDERS_KEY: 'serviceProviders' }));
jest.mock('@/data/supplies', () => ({ useSupplies: () => mockQuery() }));
jest.mock('@/data/financeBeta', () => ({ useBeta: () => ({ data: false }) }));
// As partes de cada aba ficam de fora: aqui só importa o topo.
jest.mock('@/features/ChoresPanel', () => ({ ChoresPanel: () => null }));
jest.mock('@/features/EquipmentPanel', () => ({ EquipmentPanel: () => null }));
jest.mock('@/features/PantryPanel', () => ({ PantryPanel: () => null }));
jest.mock('@/features/ShoppingListsPanel', () => ({ ShoppingListsPanel: () => null }));
jest.mock('@/features/SuppliesSection', () => ({ SuppliesSection: () => null }));
jest.mock('@/features/finance/BillsPanel', () => ({ BillsPanel: () => null }));
jest.mock('@/features/finance/ConsultorCard', () => ({ ConsultorCard: () => null }));
jest.mock('@/features/finance/FinanceSummaryPanel', () => ({ FinanceSummaryPanel: () => null }));
jest.mock('@/features/finance/ReceiptsPanel', () => ({ ReceiptsPanel: () => null }));
jest.mock('@/features/health/CarePanel', () => ({ CarePanel: () => null }));
jest.mock('@/features/health/HealthTodaySections', () => ({ HealthTodaySections: () => null }));
jest.mock('@/features/health/MedicationSections', () => ({
  MedicationRefills: () => null,
  MedicationsToday: () => null,
  useRefills: () => ({ rows: [] }),
}));
jest.mock('@/features/health/PlansPanel', () => ({ PlansPanel: () => null }));
jest.mock('@/features/health/useHealthOverview', () => ({
  useHealthOverview: () => ({ loaded: false, workoutsToday: [], upcoming: [], toConfirm: [], vaccinesDue: [], drafts: [] }),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), setParams: jest.fn() }, useLocalSearchParams: () => ({}) }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

let renderer: ReactTestRenderer | undefined;

const rawText = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(rawText).join(''));

async function mount(screen: React.ReactElement) {
  const queryClient = new QueryClient();
  await act(async () => {
    renderer = create(<QueryClientProvider client={queryClient}>{screen}</QueryClientProvider>);
  });
}

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('o topo das abas sem o cartão de cabeçalho', () => {
  it.each([
    ['Casa', <HouseScreen key="casa" />, 'ComprasDespensaTarefasAparelhos'],
    ['Saúde', <HealthScreen key="saude" />, 'ResumoCuidadosTreinoDieta'],
    ['Finanças', <FinanceScreen key="financas" />, 'ResumoContasNotas'],
  ])('%s começa pelo seletor das partes', async (name, screen, segments) => {
    await mount(screen);
    const page = renderer!.root.findByType(Screen);
    // O primeiro filho da tela é o seletor; nada de título, sobretítulo ou frase antes dele.
    const first = ([] as React.ReactNode[]).concat(page.props.children).find(Boolean) as React.ReactElement;
    expect(first.type).toBe(Segmented);
    // O nome da aba é o título da página para o leitor de tela, e só para ele: um ponto fora da vista.
    const headers = renderer!.root.findAll((node) => typeof node.type === 'string' && node.props.accessibilityRole === 'header');
    expect(headers.map(rawText)[0]).toBe(name);
    expect(StyleSheet.flatten(headers[0].props.style)).toMatchObject({ position: 'absolute', width: 1, height: 1, overflow: 'hidden' });
    const text = rawText(renderer!.root);
    expect(text.startsWith(`${name}${segments}`)).toBe(true);
    expect(text.split(name)).toHaveLength(2);
    // A margem de cima do aparelho (o padrão do Screen) e o puxar para atualizar continuam.
    expect(page.props.edges).toBeUndefined();
    expect(typeof page.props.onRefresh).toBe('function');
  });
});
