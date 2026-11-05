import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import HealthScreen from '@/app/(tabs)/saude';
import { openNewMedication } from '@/features/health/MedicationSections';
import { Tile } from '@/ui/primitives';

// Os atalhos do Resumo da Saúde: Remédio primeiro (antes, só um link pequeno no fundo de Cuidados), depois Consulta,
// Vacina e Exame. O remédio novo abre pela mesma entrada do "+ Remédio" de Cuidados, sem pessoa (o Resumo é de todos).

const mockQuery = () => ({ data: [], isRefetching: false, isSuccess: true, refetch: jest.fn() });
// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockParams: { aba?: string; pessoa?: string } = {};
jest.mock('@/data/home', () => ({ useMedications: () => mockQuery() }));
jest.mock('@/features/health/CarePanel', () => ({ CarePanel: () => null }));
jest.mock('@/features/health/HealthTodaySections', () => ({ HealthTodaySections: () => null }));
jest.mock('@/features/health/MedicationSections', () => ({
  MedicationRefills: () => null,
  MedicationsToday: () => null,
  openNewMedication: jest.fn(),
  useRefills: () => ({ rows: [] }),
}));
jest.mock('@/features/health/PlansPanel', () => ({ PlansPanel: () => null }));
jest.mock('@/features/health/useHealthOverview', () => ({
  useHealthOverview: () => ({ loaded: false, workoutsToday: [], upcoming: [], toConfirm: [], vaccinesDue: [], drafts: [] }),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), setParams: jest.fn() }, useLocalSearchParams: () => mockParams }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));

let renderer: ReactTestRenderer | undefined;

async function mount() {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={new QueryClient()}>
        <HealthScreen />
      </QueryClientProvider>,
    );
  });
}

const tile = (label: string) => renderer!.root.findAllByType(Tile).find((t) => t.props.label === label)!;

beforeEach(() => {
  mockParams.aba = undefined;
  mockParams.pessoa = undefined;
  jest.mocked(router.push).mockClear();
  jest.mocked(openNewMedication).mockClear();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('os atalhos do Resumo da Saúde', () => {
  it('Remédio, Consulta, Vacina e Exame, nesta ordem, como botões com o rótulo', async () => {
    await mount();
    expect(renderer!.root.findAllByType(Tile).map((t) => t.props.label)).toEqual(['Remédio', 'Consulta', 'Vacina', 'Exame']);
    const buttons = renderer!.root.findAll((node) => typeof node.type === 'string' && node.props.accessibilityRole === 'button');
    const labels = buttons.map((node) => node.props.accessibilityLabel);
    expect(labels.filter((label) => ['Remédio', 'Consulta', 'Vacina', 'Exame'].includes(label))).toEqual(['Remédio', 'Consulta', 'Vacina', 'Exame']);
  });

  it('Remédio abre o remédio novo pela mesma entrada de Cuidados, sem pessoa', async () => {
    await mount();
    await act(async () => tile('Remédio').props.onPress());
    expect(openNewMedication).toHaveBeenCalledTimes(1);
    expect(jest.mocked(openNewMedication).mock.calls[0]).toEqual([]);
  });

  it('mesmo com uma pessoa na URL (deixada pelos chips de Cuidados), o Resumo é de todos', async () => {
    mockParams.pessoa = 'p1';
    await mount();
    await act(async () => tile('Remédio').props.onPress());
    expect(jest.mocked(openNewMedication).mock.calls[0]).toEqual([]);
  });

  it.each([
    ['Consulta', '/consulta/[id]'],
    ['Vacina', '/vacina/[id]'],
    ['Exame', '/exame/[id]'],
  ])('%s abre o novo de sempre', async (label, pathname) => {
    await mount();
    await act(async () => tile(label).props.onPress());
    expect(router.push).toHaveBeenCalledWith({ pathname, params: { id: 'nova' } });
  });
});
