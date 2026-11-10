import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { StyleSheet } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { todayItems, type TodayInput } from '@/domain/today';
import { HealthTodaySections, useHealthRows } from '@/features/health/HealthTodaySections';
import { DoseSubtitle } from '@/features/health/MedicationSections';
import { Badge, ListRow } from '@/ui/primitives';
import { PALETTES } from '@/ui/theme';

// O que está atrasado aparece em cor: a vacina atrasada ganha o selo "Atrasada" (telas Saúde e Hoje, onde só ela
// entra) e a dose atrasada, o "atrasada" na cor de aviso. O que não está atrasado fica sem nada disso.

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/data/health', () => ({ useToggleWorkoutLog: () => ({ mutate: jest.fn() }) }));
jest.mock('@/data/home', () => ({}));
jest.mock('@/data/market', () => ({}));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ errorMessage: (error: unknown) => String(error) }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

type Overview = Parameters<typeof HealthTodaySections>[0]['overview'];

const vaccine = (id: string, name: string, status: Overview['vaccinesDue'][number]['status']) => ({
  vaccine: { id, name, dose: null, person_id: 'p1', next_dose_on: '2026-10-01' },
  status,
});

const overview = {
  personName: () => 'Lia',
  upcoming: [],
  toConfirm: [],
  workoutsToday: [],
  drafts: [],
  vaccinesDue: [vaccine('v1', 'Febre amarela', { kind: 'atrasada', days: 20 }), vaccine('v2', 'Gripe', { kind: 'em_breve', days: 5 })],
} as unknown as Overview;

let renderer: ReactTestRenderer | undefined;

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

const rowOf = (title: string) => renderer!.root.findAllByType(ListRow).find((row) => row.props.title === title)!;
const badges = (node: ReactTestInstance) => node.findAllByType(Badge).map((badge) => [badge.props.label, badge.props.tone]);

/** As vacinas como a tela Hoje as põe nos blocos (domain/today), com as linhas da saúde. */
function TodayVaccines({ today }: { today: string }) {
  const rows = useHealthRows(overview, today);
  const empty: Omit<TodayInput, 'today' | 'nowTime' | 'vaccines'> = {
    doses: [],
    refills: [],
    appointments: [],
    overdueAppointments: [],
    workouts: [],
    planDrafts: [],
    events: [],
    chores: [],
    bills: [],
    budgets: [],
    pantry: [],
    supplies: [],
    documents: [],
    equipment: [],
    pendingReceipts: [],
    drafts: [],
  };
  const items = todayItems({ ...empty, today, nowTime: '12:00', vaccines: overview.vaccinesDue });
  return <>{items.flatMap((item) => (item.kind === 'vaccine' ? [rows.vaccine(item.data)] : []))}</>;
}

describe('a vacina atrasada', () => {
  it('ganha o selo "Atrasada", e só ela (Saúde)', async () => {
    await act(async () => {
      renderer = create(<HealthTodaySections overview={overview} today="2026-10-21" />);
    });
    expect(badges(rowOf('Febre amarela'))).toEqual([['Atrasada', 'danger']]);
    expect(badges(rowOf('Gripe'))).toEqual([]);
  });

  it('na tela Hoje, só ela entra, com o selo', async () => {
    await act(async () => {
      renderer = create(<TodayVaccines today="2026-10-21" />);
    });
    expect(renderer!.root.findAllByType(ListRow).map((row) => row.props.title)).toEqual(['Febre amarela']);
    expect(badges(rowOf('Febre amarela'))).toEqual([['Atrasada', 'danger']]);
  });
});

describe('a dose atrasada', () => {
  /** Os pedaços de texto e a cor de cada um. */
  const pieces = (root: ReactTestInstance) =>
    root
      .findAll((node) => (node.type as unknown) === 'Text')
      .flatMap((node) =>
        (Array.isArray(node.props.children) ? node.props.children : [node.props.children])
          .filter((child: unknown) => typeof child === 'string' && child)
          .map((child: string) => [child, StyleSheet.flatten(node.props.style).color]),
      );

  it('diz "atrasada" na cor de aviso', async () => {
    await act(async () => {
      renderer = create(<DoseSubtitle parts={['Lia', '1 comprimido']} late />);
    });
    const { textMuted, warning } = PALETTES.light;
    expect(pieces(renderer!.root)).toEqual([
      ['Lia · 1 comprimido', textMuted],
      [' · ', textMuted],
      ['atrasada', warning],
    ]);
  });

  it('sem atraso, nada de aviso', async () => {
    await act(async () => {
      renderer = create(<DoseSubtitle parts={['Lia', null]} late={false} />);
    });
    expect(pieces(renderer!.root)).toEqual([['Lia', PALETTES.light.textMuted]]);
  });

  it('só o atraso, sem quem toma nem a dose', async () => {
    await act(async () => {
      renderer = create(<DoseSubtitle parts={[null, null]} late />);
    });
    expect(pieces(renderer!.root)).toEqual([['atrasada', PALETTES.light.warning]]);
  });

  it('com a caixa acabando, o selo do remédio continua embaixo', async () => {
    await act(async () => {
      renderer = create(<DoseSubtitle parts={['Lia']} late badge={{ about: 'stock', label: 'Acaba em 3 dias', tone: 'warning', days: 3 }} />);
    });
    expect(badges(renderer!.root)).toEqual([['Acaba em 3 dias', 'warning']]);
    expect(pieces(renderer!.root).map(([text]) => text)).toEqual(['Lia', ' · ', 'atrasada', 'Acaba em 3 dias']);
  });
});
