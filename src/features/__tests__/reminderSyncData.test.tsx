import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { planHouseReminders } from '@/domain/houseReminders';
import { syncOtherHouses, useHouseReminderData } from '@/features/useReminderSync';
import type { HouseReminderData } from '@/lib/reminders';
import type { Medication, MedicationDose } from '@/lib/types';

// Os dados que os avisos da casa recebem, com as buscas trocadas por respostas prontas: o que se confere aqui é
// que as doses de hoje já marcadas vão com os remédios, para o aviso sair da mesma conta das telas Hoje e Saúde.

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockState = {
  today: '2026-10-12',
  medications: undefined as Medication[] | undefined,
  /** As doses marcadas de cada dia (o que a busca desse dia devolve). */
  doses: {} as Record<string, MedicationDose[] | undefined>,
  dosesFail: false,
  synced: [] as { data: HouseReminderData; householdId: string }[],
};

const mockQuery = <T,>(data: T) => ({ data, refetch: async () => ({ data }) });

jest.mock('@/domain/dates', () => ({
  ...jest.requireActual<typeof import('@/domain/dates')>('@/domain/dates'),
  todayISO: () => mockState.today,
}));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));
jest.mock('@/lib/supabase', () => ({ supabase: {}, unwrap: (r: { data: unknown }) => r.data, householdClient: (id: string) => ({ house: id }) }));
jest.mock('@/lib/auth', () => ({ useHousehold: () => ({ data: undefined }) }));
jest.mock('@/lib/reminders', () => ({
  anyHouseReminderKind: async () => true,
  householdsWithMedicationReminders: async () => new Set<string>(),
  pruneHouseholdReminders: async () => undefined,
  reconcileReminders: async () => undefined,
  syncReminders: async () => undefined,
  syncHouseReminders: async (data: HouseReminderData, target: { householdId: string }) => {
    mockState.synced.push({ data, householdId: target.householdId });
  },
}));
jest.mock('@/data/finance', () => ({ useBills: () => mockQuery([]), fetchBills: async () => [] }));
jest.mock('@/data/house', () => ({
  useDocuments: () => mockQuery([]),
  useEquipmentList: () => mockQuery([]),
  fetchDocuments: async () => [],
  fetchEquipmentList: async () => [],
}));
jest.mock('@/data/health', () => ({
  useAppointments: () => mockQuery([]),
  useVaccines: () => mockQuery([]),
  usePeople: () => mockQuery([]),
  fetchAppointments: async () => [],
  fetchVaccines: async () => [],
  fetchPeople: async () => [],
}));
jest.mock('@/data/family', () => ({
  useFamilyEvents: () => mockQuery([]),
  useFamilyEventDays: () => mockQuery([]),
  fetchFamilyEvents: async () => [],
  fetchFamilyEventDays: async () => [],
}));
jest.mock('@/data/weather', () => ({
  useHouseholdLocation: () => mockQuery(null),
  useForecast: () => mockQuery(undefined),
  fetchHouseholdLocation: async () => null,
  forecastQuery: () => ({}),
}));
jest.mock('@/data/home', () => ({
  ...jest.requireActual<typeof import('@/data/home')>('@/data/home'),
  useChores: () => mockQuery([]),
  useMedications: () => mockQuery(mockState.medications),
  useDoses: (date: string) => mockQuery(mockState.doses[date]),
  fetchChores: async () => [],
  fetchMedications: async () => mockState.medications ?? [],
  fetchDoses: async (date: string) => {
    if (mockState.dosesFail) throw new Error('sem rede');
    return mockState.doses[date] ?? [];
  },
}));

/**
 * Amoxicilina, 20 doses desde 09/10: em 12/10, com 9 marcadas, passou de três para duas por dia, com 10
 * comprimidos contados nesse dia. Sobram 9 doses depois das duas de 12/10: dá para o tratamento todo.
 */
const course = (taken: number): Medication => ({
  id: 'm1',
  person_id: null,
  person_name: 'Ana',
  name: 'Amoxicilina',
  dosage: null,
  times: ['08:00', '20:00'],
  start_on: '2026-10-09',
  end_on: null,
  notes: null,
  active: true,
  frequency: 'daily',
  weekdays: null,
  interval_days: null,
  total_doses: 20,
  taken_count: taken,
  stock_count: 10,
  stock_counted_on: '2026-10-12',
  dose_units: 1,
  stock_warn_days: 7,
  prescription_until: null,
});
const tick = (date: string, time: string): MedicationDose => ({ id: `${date} ${time}`, medication_id: 'm1', scheduled_on: date, scheduled_time: time, taken_at: `${date}T12:00:00Z` });

const kinds = { bills: false, documents: false, chores: false, appointments: false, events: false, vaccines: false, refills: true, weather: false, eve: false };
/** Os avisos de caixa acabando que sairiam desses dados. */
const notices = (data: HouseReminderData | null | undefined) =>
  data ? planHouseReminders({ ...data, kinds, today: mockState.today, nowTime: '07:00' }).map((r) => r.key) : null;
const takenToday = (data: HouseReminderData | null | undefined) => data?.medications?.map((m) => m.takenToday);

let renderer: ReactTestRenderer | undefined;
let seen: ReturnType<typeof useHouseReminderData> | undefined;
/** Entrega o que o hook devolve a cada desenho. */
function Probe({ onData }: { onData: (data: ReturnType<typeof useHouseReminderData>) => void }) {
  const data = useHouseReminderData();
  useEffect(() => onData(data));
  return null;
}
const probe = () => (
  <Probe
    onData={(data) => {
      seen = data;
    }}
  />
);
async function mount() {
  await act(async () => {
    renderer = create(probe());
  });
  return seen?.data;
}

beforeEach(() => {
  Object.assign(mockState, { today: '2026-10-12', medications: undefined, doses: {}, dosesFail: false, synced: [] });
  seen = undefined;
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('a casa aberta (useHouseReminderData)', () => {
  it('as doses de hoje já marcadas vão com os remédios: o plano é o mesmo com nenhuma, uma ou as duas marcadas', async () => {
    const steps = [[], [tick('2026-10-12', '08:00')], [tick('2026-10-12', '08:00'), tick('2026-10-12', '20:00')]];
    for (const doses of steps) {
      mockState.medications = [course(9 + doses.length)];
      mockState.doses = { '2026-10-12': doses };
      const data = await mount();
      expect(takenToday(data)).toEqual([doses.length]);
      expect(notices(data)).toEqual([]);
      await act(async () => renderer?.unmount());
    }
  });

  it('marcações de hoje que não carregaram: os remédios entram assim mesmo, com a conta de antes', async () => {
    mockState.medications = [course(9)];
    const data = await mount();
    expect(takenToday(data)).toEqual([undefined]);
    expect(notices(data)).toEqual(['refills:m1:2026-10-16', 'refills:m1:2026-10-17']);
  });

  it('sem os remédios, nada muda: o tipo fica como desconhecido (undefined)', async () => {
    mockState.doses = { '2026-10-12': [] };
    expect((await mount())?.medications).toBeUndefined();
  });

  it('buscar de novo traz as marcações de agora', async () => {
    mockState.medications = [course(9)];
    mockState.doses = { '2026-10-12': [] };
    await mount();
    mockState.medications = [course(10)];
    mockState.doses = { '2026-10-12': [tick('2026-10-12', '08:00')] };
    await act(async () => renderer?.update(probe()));
    const fresh = await seen?.refetch();
    expect(takenToday(fresh)).toEqual([1]);
    expect(notices(fresh)).toEqual([]);
  });

  it('app aberto de um dia para o outro: as marcações de ontem não valem como as de hoje', async () => {
    mockState.medications = [course(11)];
    mockState.doses = { '2026-10-12': [tick('2026-10-12', '08:00'), tick('2026-10-12', '20:00')] };
    await mount();
    // Virou o dia e a tela ainda não foi desenhada de novo: a busca que ela tem é a de ontem.
    mockState.today = '2026-10-13';
    const stale = await seen?.refetch();
    expect(takenToday(stale)).toEqual([undefined]);
    // Desenhada de novo, pede as de hoje.
    mockState.doses['2026-10-13'] = [];
    await act(async () => renderer?.update(probe()));
    expect(takenToday(seen?.data)).toEqual([0]);
  });
});

describe('as outras casas (syncOtherHouses)', () => {
  const houses = [
    { id: 'aberta', name: 'Casa' },
    { id: 'praia', name: 'Praia' },
  ];
  const queryClient = { fetchQuery: async () => undefined } as unknown as QueryClient;

  it('busca as doses marcadas de hoje junto com os remédios', async () => {
    mockState.medications = [course(10)];
    mockState.doses = { '2026-10-12': [tick('2026-10-12', '20:00')] };
    await syncOtherHouses(queryClient, houses, 'aberta');
    expect(mockState.synced.map((s) => s.householdId)).toEqual(['praia']);
    expect(takenToday(mockState.synced[0].data)).toEqual([1]);
    expect(notices(mockState.synced[0].data)).toEqual([]);
  });

  it('a busca das doses falhou: os avisos da casa são refeitos assim mesmo, sem elas', async () => {
    mockState.medications = [course(9)];
    mockState.dosesFail = true;
    await syncOtherHouses(queryClient, houses, 'aberta');
    expect(mockState.synced).toHaveLength(1);
    expect(takenToday(mockState.synced[0].data)).toEqual([undefined]);
  });
});
