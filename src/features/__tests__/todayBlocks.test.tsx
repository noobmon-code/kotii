import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { Modal, Platform, Text as RNText, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import TodayScreen from '@/app/(tabs)/index';
import { toTimestamp } from '@/domain/health';
import { FIRST_STEP_INVITE_BY_CODE, FIRST_STEP_INVITE_BY_LINK, FIRST_STEPS_TITLE } from '@/domain/firstSteps';
import { INVITE_TITLE } from '@/domain/onboarding';
import { ALL_CLEAR_TITLE, PANTRY_SHOWN, SUGGESTION_TITLES, TODAY_BLOCK_TITLES } from '@/domain/today';
import {
  longCycleDayError,
  longCycleOffNotice,
  longCycleReplacedNotice,
  type LongCycleChange,
  type LongCycleSetting,
} from '@/domain/longCycle';
import type { PurchaseRecord } from '@/domain/recentPurchases';
import { FEATURES } from '@/lib/features';
import type { Chore, Equipment, HomeDocument, Medication, PantryItem, Supply } from '@/lib/types';
import { SuggestionGroup } from '@/features/TodayBlocks';
import { ActionSheet } from '@/ui/ActionSheet';
import { notify } from '@/ui/dialogs';
import { moveFocus } from '@/ui/focus';
import { AddCircle, Badge, Button, Chip, IconButton, LinkButton, ListRow, Section } from '@/ui/primitives';

// A tela Hoje por urgência, com as linhas de verdade e as buscas trocadas por respostas prontas: "Agora" (o atrasado
// antes do que é de hoje), "Em breve" (o mais perto antes) e "Sugestões" (que não contam nem seguram o "Tudo em
// dia"); a frase do topo com a mesma conta das linhas; e os "Primeiros passos", que se marcam pelo que a casa tem,
// esperam saber todos para aparecer e somem de vez dispensados ou com todos feitos (no aparelho, por casa); o da
// despensa pode ser pulado. A chave do começo novo (lib/features) fica ligada, como o app sai; o caso de antes (o
// convite e as fichas em Configurações) a desliga.

// O relógio parado no meio do dia (só a data: os tempos de espera continuam de verdade): a dose das 8h passou, a
// das 20h não.
const NOW = new Date(2026, 10, 10, 12, 0);
const TODAY = '2026-11-10';

// "mock" no nome: o jest.mock só enxerga variáveis assim.
type StepAnswer = { data: boolean | undefined; status: 'pending' | 'error' | 'success'; fetchStatus: 'fetching' | 'paused' | 'idle' };
/** A resposta que chegou de uma busca que terminou bem. */
function answered(data: boolean): StepAnswer {
  return { data, status: 'success', fetchStatus: 'idle' };
}
const mockQuery = (data: unknown = []) => ({ data, isSuccess: true, isError: false, isPending: false, isRefetching: false, refetch: jest.fn() });
/** Uma busca que ainda não trouxe nada (a primeira, ou a que falhou sem nada guardado). */
const mockNoData = { data: undefined, isSuccess: false, isPending: true };
type LongCycleAnswer = { data: unknown; fetchStatus: 'fetching' | 'paused' | 'idle'; isError?: boolean };
const mockData = {
  medications: [] as Medication[],
  chores: [] as Chore[],
  pantry: [] as PantryItem[],
  documents: [] as HomeDocument[],
  equipment: [] as Equipment[],
  supplies: [] as Supply[],
  drafts: [] as unknown[],
  lists: [] as unknown[],
  menu: [] as unknown[],
  purchases: [] as PurchaseRecord[],
  people: [] as { id: string; name: string; kind: 'pessoa' | 'pet'; birth_date: string | null; member_user_id: string | null }[],
  members: 1,
  householdId: 'casa',
  // A casa aberta neste aparelho (lib/activeHousehold): no meio de uma troca, ainda não é a da tela.
  activeId: 'casa' as string | null,
  // As três perguntas dos primeiros passos: a resposta, e com que `enabled` e com que "já viu" a tela as fez.
  anyList: answered(false),
  anyReceipt: answered(false),
  anyPantry: answered(false),
  asked: { list: [] as boolean[], receipt: [] as boolean[], pantry: [] as boolean[] },
  seen: { list: [] as boolean[], receipt: [] as boolean[], pantry: [] as boolean[] },
  overview: {} as Record<string, unknown>,
  // Os prazos de troca (data/longCycle): os ajustes da casa (null antes da migração) e a leitura longa.
  longCycleSettings: { data: [], fetchStatus: 'idle' } as LongCycleAnswer,
  longCycleHistory: { data: [], fetchStatus: 'idle' } as LongCycleAnswer,
  // O que trocar no que as buscas respondem (uma busca sem dados, a que falhou ao buscar de novo).
  overrides: {} as Record<string, object>,
  // Os nomes postos agora há pouco (useJustListed), que a tela lê no próximo desenho.
  justListed: new Set<string>(),
};
const mockSaveSetting = jest.fn(async ({ itemKey, change }: { itemKey: string; change: LongCycleChange }): Promise<LongCycleSetting> => {
  const rows = (mockData.longCycleSettings.data as LongCycleSetting[] | null) ?? [];
  const before = rows.find((r) => r.item_key === itemKey) ?? { item_key: itemKey, every_months: null, off: false, replaced_on: null };
  const row = { ...before, ...change };
  mockData.longCycleSettings = { ...mockData.longCycleSettings, data: [...rows.filter((r) => r.item_key !== itemKey), row] };
  return row;
});
const mockFocus = { blur: [] as (() => void)[] };
const mockAddItems = jest.fn(async (_: unknown) => ({ id: 'mercado' }));
const mockOpenList = jest.fn(async () => ({ id: 'mercado', name: 'Mercado' }));

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  // A tela à vista ao montar; `mockFocus.blur` a tira de vista (o que a limpeza do efeito faz).
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(() => {
      const cleanup = effect();
      if (cleanup) mockFocus.blur.push(cleanup);
      return cleanup;
    }, [effect]);
  },
}));
jest.mock('@/data/longCycle', () => ({
  useLongCycleSettings: () => ({ ...mockData.longCycleSettings, refetch: jest.fn() }),
  useLongCycleHistory: () => ({ ...mockData.longCycleHistory, refetch: jest.fn() }),
  useSetLongCycleSetting: () => ({ mutateAsync: mockSaveSetting, isPending: false }),
}));
jest.mock('@/ui/focus', () => ({ ...jest.requireActual<typeof import('@/ui/focus')>('@/ui/focus'), moveFocus: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ supabase: {}, unwrap: (r: { data: unknown }) => r.data, errorMessage: (error: unknown) => String(error) }));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/lib/auth', () => ({
  useHousehold: () => {
    const members = Array.from({ length: mockData.members }, (_, i) => ({
      household_id: mockData.householdId,
      user_id: `u${i}`,
      display_name: i ? `Pessoa ${i}` : 'Ana',
      role: i ? 'member' : 'owner',
    }));
    return {
      data: {
        household: { id: mockData.householdId, name: 'Casa da Ana', invite_code: 'ABC123' },
        members,
        me: members[0],
        households: [{ id: mockData.householdId, name: 'Casa da Ana', role: 'owner' }],
      },
    };
  },
}));
jest.mock('@/lib/reminders', () => ({ REMINDER_PLACE: 'neste celular', remindersSupported: false, remindersUnavailableReason: () => '' }));
jest.mock('@/lib/openLink', () => ({ openExternal: jest.fn() }));
jest.mock('@/data/weather', () => ({
  useHouseholdLocation: () => ({ data: null }),
  useForecast: () => ({ data: undefined }),
  useRefreshWeather: () => () => undefined,
}));
jest.mock('@/data/home', () => ({
  ...jest.requireActual<typeof import('@/data/home')>('@/data/home'),
  useChoreRotations: () => mockQuery(undefined),
  useChores: () => ({ ...mockQuery(mockData.chores), ...mockData.overrides.chores }),
  useCompleteChore: () => ({ mutate: jest.fn(), isPending: false }),
  useDoses: () => mockQuery([]),
  useMedications: () => mockQuery(mockData.medications),
  usePantry: () => mockQuery(mockData.pantry),
  useToggleDose: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/data/family', () => ({
  useFamilyCalendar: () => ({ calendar: { events: [], days: [], people: mockData.people }, refetch: jest.fn() }),
}));
jest.mock('@/data/finance', () => ({
  useBills: () => mockQuery(),
  useBudgets: () => mockQuery(),
  useRecentBillPayments: () => mockQuery(),
  useSpending: () => mockQuery(undefined),
}));
jest.mock('@/data/health', () => ({
  usePeople: () => mockQuery(mockData.people),
  useToggleWorkoutLog: () => ({ mutate: jest.fn() }),
}));
jest.mock('@/data/house', () => ({
  useDocuments: () => mockQuery(mockData.documents),
  useEquipmentList: () => mockQuery(mockData.equipment),
}));
jest.mock('@/data/market', () => ({
  useAddItemsToList: () => ({ mutateAsync: mockAddItems, isPending: false }),
  useAddToMarketList: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useAddToPharmacyList: () => ({ mutateAsync: jest.fn() }),
  useOpenMarketList: () => ({ mutateAsync: mockOpenList }),
  usePurchaseRecords: () => ({ ...mockQuery(mockData.purchases), ...mockData.overrides.purchases }),
  useShoppingLists: () => ({ ...mockQuery(mockData.lists), ...mockData.overrides.lists }),
}));
jest.mock('@/data/firstSteps', () => ({
  useAnyList: (enabled: boolean, seen = false) => {
    mockData.asked.list.push(enabled);
    mockData.seen.list.push(seen);
    return { ...mockData.anyList, refetch: jest.fn() };
  },
  useAnyReceipt: (enabled: boolean, seen = false) => {
    mockData.asked.receipt.push(enabled);
    mockData.seen.receipt.push(seen);
    return { ...mockData.anyReceipt, refetch: jest.fn() };
  },
  useAnyPantryItem: (enabled: boolean, seen = false) => {
    mockData.asked.pantry.push(enabled);
    mockData.seen.pantry.push(seen);
    return { ...mockData.anyPantry, refetch: jest.fn() };
  },
}));
jest.mock('@/lib/activeHousehold', () => ({
  ...jest.requireActual<typeof import('@/lib/activeHousehold')>('@/lib/activeHousehold'),
  useActiveHouseholdId: () => mockData.activeId,
}));
jest.mock('@/data/marketTrips', () => ({ useRefreshMarketTrips: () => () => undefined }));
jest.mock('@/data/menu', () => ({ useMenu: () => mockQuery(mockData.menu) }));
jest.mock('@/data/pendingReceipts', () => ({ usePendingReceipts: () => ({ pending: [], storeNames: {} }) }));
jest.mock('@/data/receipts', () => ({ useDraftReceipts: () => mockQuery(mockData.drafts) }));
jest.mock('@/data/supplies', () => ({
  useSupplies: () => ({ ...mockQuery({ supplies: mockData.supplies, available: true }), ...mockData.overrides.supplies }),
  useRecordRefill: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/features/health/useHealthOverview', () => ({ useHealthOverview: () => mockData.overview }));
jest.mock('@/features/ChoresPanel', () => ({ announceCompletion: jest.fn() }));
jest.mock('@/features/finance/BillsPanel', () => ({ BillRow: () => null }));
jest.mock('@/features/finance/PayBillModal', () => ({ PayBillModal: () => null }));
jest.mock('@/features/InstallAppCard', () => ({ InstallAppCard: () => null }));
jest.mock('@/features/MarketTrip', () => ({ MarketTripBanner: () => null }));
jest.mock('@/features/RecentPurchases', () => ({
  useJustListed: () => ({
    pending: mockData.justListed,
    add: (names: string[]) => {
      mockData.justListed = new Set([...mockData.justListed, ...names.map((n) => n.toLowerCase())]);
    },
    drop: jest.fn(),
  }),
}));
jest.mock('@/features/TermsNotice', () => ({ TermsNoticeCard: () => null }));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn(), confirmAction: jest.fn() }));
jest.mock('@/ui/iconArt', () => ({ IconArt: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));

let renderer: ReactTestRenderer | undefined;
let house = 0;

const rawText = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(rawText).join(''));
const page = () => renderer!.root.findAllByType(RNText).map(rawText);
const section = (title: string) => renderer!.root.findAllByType(Section).find((s) => s.props.title === title);
const rowsOf = (title: string) => section(title)?.findAllByType(ListRow).map((row) => row.props.title as string) ?? [];

async function mount() {
  await act(async () => {
    renderer = create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
        <TodayScreen />
      </SafeAreaProvider>,
    );
  });
  // A dispensa dos primeiros passos é lida do aparelho.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

const rerender = () =>
  act(async () =>
    renderer!.update(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
        <TodayScreen />
      </SafeAreaProvider>,
    ),
  );

const overview = (patch: Record<string, unknown> = {}) => ({
  queries: [],
  loaded: true,
  people: [],
  personName: () => 'Bia',
  upcoming: [],
  toConfirm: [],
  vaccinesDue: [],
  workoutsToday: [],
  drafts: [],
  ...patch,
});

const medication = (name: string, times: string[]): Medication => ({
  id: name,
  person_id: null,
  person_name: 'Ana',
  name,
  dosage: null,
  times,
  start_on: '2026-01-01',
  end_on: null,
  notes: null,
  active: true,
  frequency: 'daily',
  weekdays: null,
  interval_days: null,
  total_doses: null,
  taken_count: 0,
  stock_count: null,
  stock_counted_on: null,
  dose_units: 1,
  stock_warn_days: 7,
  prescription_until: null,
});
const chore = (title: string, due_on: string): Chore => ({
  id: title,
  title,
  notes: null,
  recurrence: 'weekly',
  interval_count: 1,
  due_on,
  assigned_to: null,
  active: true,
  equipment_id: null,
  kid_id: null,
  points: 0,
});
const pantry = (name: string, expires_on: string | null): PantryItem => ({
  id: name,
  product_id: null,
  name,
  category: 'laticinios',
  quantity: 1,
  unit: 'un',
  purchased_on: '2026-11-01',
  expires_on,
  expiry_source: 'manual',
  consumed_at: null,
});
const document = (title: string, expires_on: string): HomeDocument => ({
  id: title,
  person_id: null,
  kind: 'cnh',
  title,
  number: null,
  issued_on: null,
  expires_on,
  remind_days: 30,
  notes: null,
  file_paths: [],
  created_at: '2020-01-01',
});
const appliance = (name: string, warranty_until: string): Equipment => ({
  id: name,
  name,
  category: 'eletrodomestico',
  brand: null,
  model: null,
  serial_number: null,
  location: null,
  purchased_on: null,
  price: null,
  store: null,
  warranty_until,
  notes: null,
  file_paths: [],
  created_at: '2025-01-01',
});
const list = (id: string, pending = 0) => ({ id, name: id, kind: 'mercado', archived_at: null, created_at: '2026-11-01T10:00:00Z', pending, total: pending, items: [] });

beforeEach(async () => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask'],
  });
  await AsyncStorage.clear();
  jest.replaceProperty(FEATURES, 'onboarding', true);
  // Cada teste numa casa nova: a dispensa fica na memória do módulo, por casa.
  house += 1;
  Object.assign(mockData, {
    medications: [],
    chores: [],
    pantry: [],
    documents: [],
    equipment: [],
    supplies: [],
    drafts: [],
    lists: [],
    menu: [],
    purchases: [],
    people: [],
    members: 1,
    householdId: `casa-${house}`,
    activeId: `casa-${house}`,
    anyList: answered(false),
    anyReceipt: answered(false),
    anyPantry: answered(false),
    asked: { list: [], receipt: [], pantry: [] },
    seen: { list: [], receipt: [], pantry: [] },
    overview: overview(),
    longCycleSettings: { data: [], fetchStatus: 'idle' },
    longCycleHistory: { data: [], fetchStatus: 'idle' },
    overrides: {},
    justListed: new Set<string>(),
  });
  mockSaveSetting.mockClear();
  jest.mocked(moveFocus).mockClear();
  jest.mocked(notify).mockClear();
  mockFocus.blur = [];
  jest.mocked(router.push).mockClear();
  mockOpenList.mockClear();
  mockAddItems.mockClear();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  jest.useRealTimers();
});

/** Uma casa que já deu os primeiros passos todos: o cartão deles não aparece. */
function settledHouse() {
  mockData.members = 2;
  mockData.lists = [list('Mercado')];
  mockData.anyReceipt = answered(true);
  mockData.anyPantry = answered(true);
  mockData.people = [{ id: 'p1', name: 'Rex', kind: 'pet', birth_date: null, member_user_id: null }];
}

describe('os blocos por urgência', () => {
  it('"Agora" tem o atrasado e depois o de hoje; "Em breve", o mais perto antes; a frase do topo conta as linhas', async () => {
    settledHouse();
    mockData.medications = [medication('Losartana', ['08:00', '20:00'])];
    mockData.chores = [chore('Lavar o banheiro', '2026-11-08'), chore('Tirar o lixo', TODAY), chore('Limpar as janelas', '2026-11-11')];
    mockData.pantry = [pantry('Iogurte', '2026-11-09'), pantry('Leite', '2026-11-11'), pantry('Arroz', '2027-03-01')];
    mockData.documents = [document('CNH', '2026-11-22'), document('RG', '2030-01-01')];
    mockData.equipment = [appliance('Geladeira', '2026-11-30')];
    // Trocado há 40 dias, dura uns 30: já era para ter acabado.
    mockData.supplies = [{ id: 'gas', name: 'Gás', kind: 'gas', typical_days: 30, notes: null, created_at: '2026-01-01', refills: [{ id: 'r', refilled_on: '2026-10-01' }] }];
    mockData.drafts = [{ id: 'n1', store: { id: 's1', name: 'Mercado Bom' } }];
    // Aniversários: o de hoje e o de amanhã (compromissos não são pendência: não contam).
    mockData.people = [
      ...mockData.people,
      { id: 'bia', name: 'Bia', kind: 'pessoa', birth_date: '2018-11-10', member_user_id: null },
      { id: 'leo', name: 'Leo', kind: 'pessoa', birth_date: '2020-11-11', member_user_id: null },
    ];
    mockData.overview = overview({
      upcoming: [{ id: 'c1', title: 'Pediatra', starts_at: toTimestamp(TODAY, '15:00'), status: 'agendada', person_id: 'bia', professional: null }],
      vaccinesDue: [{ vaccine: { id: 'v1', name: 'Febre amarela', dose: null, person_id: 'bia', next_dose_on: '2026-10-01' }, status: { kind: 'atrasada', days: 40 } }],
    });
    await mount();

    expect(rowsOf(TODAY_BLOCK_TITLES.agora)).toEqual([
      // Atrasado: o remédio e a saúde antes, depois a tarefa, a despensa e o gás.
      '08:00 · Losartana',
      'Febre amarela',
      'Lavar o banheiro',
      'Iogurte',
      'Gás',
      // De hoje.
      '20:00 · Losartana',
      'Pediatra',
      'Aniversário de Bia',
      'Tirar o lixo',
    ]);
    // Em breve: amanhã antes; a garantia do fim do mês depois do documento; a nota, sem data, por último.
    expect(rowsOf(TODAY_BLOCK_TITLES.emBreve)).toEqual(['Aniversário de Leo', 'Leite', 'CNH', 'Geladeira', 'Mercado Bom']);
    // 14 linhas, menos os dois aniversários.
    expect(page()).toContain('12 coisas pedem sua atenção.');
    expect(page()).not.toContain(ALL_CLEAR_TITLE);
    // A tarefa de amanhã, o arroz, o RG: fora.
    expect(page()).not.toContain('Limpar as janelas');
    expect(page()).not.toContain('Arroz');
    expect(page()).not.toContain('RG');
  });

  it('as linhas fazem o de sempre: a dose atrasada diz "atrasada", a tarefa abre, a garantia diz o que fazer', async () => {
    settledHouse();
    mockData.medications = [medication('Losartana', ['08:00'])];
    mockData.chores = [chore('Tirar o lixo', TODAY)];
    mockData.equipment = [appliance('Geladeira', '2026-11-30')];
    await mount();
    expect(page()).toContain('atrasada');
    expect(page()).toContain('Garantia acaba em 20 dias · teste tudo e acione a assistência se precisar');
    const lixo = section(TODAY_BLOCK_TITLES.agora)!.findAllByType(ListRow).find((row) => row.props.title === 'Tirar o lixo')!;
    await act(async () => lixo.props.onPress());
    expect(router.push).toHaveBeenCalledWith({ pathname: '/tarefa/[id]', params: { id: 'Tirar o lixo' } });
  });

  it('a validade estimada da despensa é neutra, com "~"; a certa, vermelha ou laranja; o congelador e o descongelado dizem onde estão, e a conta é a mesma', async () => {
    settledHouse();
    mockData.pantry = [
      { ...pantry('Iogurte', '2026-11-11'), expiry_source: 'categoria' },
      pantry('Leite', '2026-11-11'),
      { ...pantry('Queijo', '2026-11-09'), expiry_source: 'produto' },
      { ...pantry('Pão', '2026-11-09'), expiry_source: null },
      { ...pantry('Frango', '2026-11-12'), expiry_source: 'congelado', frozen_on: '2026-08-14', thawed_on: null, freeze_kind: 'frango' },
      { ...pantry('Peixe', '2026-11-08'), expiry_source: 'descongelado', frozen_on: '2026-10-01', thawed_on: '2026-11-07', freeze_kind: 'peixe' },
    ];
    await mount();
    const row = (title: string) => renderer!.root.findAllByType(ListRow).find((entry) => entry.props.title === title)!;
    const badge = (title: string) => row(title).findByType(Badge).props;
    expect(badge('Iogurte')).toEqual({ label: '~ vence amanhã', tone: 'neutral' });
    expect(row('Iogurte').props.accessibilityLabel).toBe('Iogurte, Validade estimada: vence amanhã');
    expect(badge('Leite')).toEqual({ label: 'Vence amanhã', tone: 'warning' });
    expect(row('Leite').props.accessibilityLabel).toBe('Leite, Validade: vence amanhã');
    expect(badge('Queijo')).toEqual({ label: 'Venceu há 1 dia', tone: 'danger' });
    expect(badge('Pão')).toEqual({ label: 'Venceu há 1 dia', tone: 'danger' });
    expect(badge('Frango')).toEqual({ label: '~ vence em 2 dias', tone: 'neutral' });
    expect(row('Frango').props.subtitle).toBe('No congelador');
    expect(row('Frango').props.accessibilityLabel).toBe('Frango, No congelador, Validade estimada: vence em 2 dias');
    expect(row('Peixe').props.subtitle).toBe('Descongelado em 7 nov');
    expect(badge('Peixe')).toEqual({ label: '~ venceu há 2 dias', tone: 'neutral' });
    // O lugar e a conta não mudam: a estimada e a do congelador pedem atenção como antes.
    expect(page()).toContain('6 coisas pedem sua atenção.');
  });

  it('a despensa mostra até seis nos dois blocos juntos, e o "Ver todos" leva a Compras → Despensa', async () => {
    settledHouse();
    mockData.pantry = Array.from({ length: PANTRY_SHOWN + 2 }, (_, i) => pantry(`Vencido ${i + 1}`, '2026-11-05'));
    await mount();
    expect(rowsOf(TODAY_BLOCK_TITLES.agora)).toHaveLength(PANTRY_SHOWN);
    const seeAll = section(TODAY_BLOCK_TITLES.agora)!.findAllByType(Button).find((b) => b.props.title === `Ver todos da despensa (${PANTRY_SHOWN + 2})`)!;
    await act(async () => seeAll.props.onPress());
    expect(router.push).toHaveBeenCalledWith({ pathname: '/compras', params: { aba: 'despensa' } });
    // O que ficou no "Ver todos" também conta.
    expect(page()).toContain(`${PANTRY_SHOWN + 2} coisas pedem sua atenção.`);
  });

  it('vencidos e perto de vencer dividem as seis, "Agora" primeiro; o "Ver todos" conta todos e fica no bloco da última linha', async () => {
    settledHouse();
    mockData.pantry = [
      pantry('Iogurte', '2026-11-08'),
      pantry('Queijo', '2026-11-09'),
      ...Array.from({ length: 5 }, (_, i) => pantry(`Leite ${i + 1}`, '2026-11-12')),
    ];
    await mount();
    expect(rowsOf(TODAY_BLOCK_TITLES.agora)).toEqual(['Iogurte', 'Queijo']);
    expect(rowsOf(TODAY_BLOCK_TITLES.emBreve)).toEqual(['Leite 1', 'Leite 2', 'Leite 3', 'Leite 4']);
    const seeAllIn = (title: string) => section(title)!.findAllByType(Button).map((b) => b.props.title as string);
    expect(seeAllIn(TODAY_BLOCK_TITLES.agora)).toEqual([]);
    expect(seeAllIn(TODAY_BLOCK_TITLES.emBreve)).toEqual(['Ver todos da despensa (7)']);
    expect(page()).toContain('7 coisas pedem sua atenção.');
  });

  it('só compromissos: aparecem em "Agora", mas a casa está em dia', async () => {
    settledHouse();
    mockData.people = [...mockData.people, { id: 'bia', name: 'Bia', kind: 'pessoa', birth_date: '2018-11-10', member_user_id: null }];
    await mount();
    expect(rowsOf(TODAY_BLOCK_TITLES.agora)).toEqual(['Aniversário de Bia']);
    expect(page()).toContain('Tudo em dia por aqui.');
    expect(page()).toContain(ALL_CLEAR_TITLE);
  });

  it('"Sugestões" (cardápio, listas abertas) não conta nem segura o "Tudo em dia"', async () => {
    settledHouse();
    mockData.lists = [list('Mercado', 3), list('Vazia', 0)];
    mockData.menu = [{ id: 'm1', day: TODAY, meal: 'almoco', dish: 'Feijoada' }];
    await mount();
    expect(page()).toContain('Tudo em dia por aqui.');
    expect(page()).toContain(ALL_CLEAR_TITLE);
    const suggestions = section(TODAY_BLOCK_TITLES.sugestoes)!;
    expect(suggestions.findAllByType(ListRow).map((row) => row.props.title)).toEqual(['Feijoada', 'Mercado']);
    expect(rawText(suggestions)).toContain('Cardápio de hoje');
    expect(rawText(suggestions)).toContain('Listas abertas');
    expect(rawText(suggestions)).toContain('3 itens pendentes');
    expect(section(TODAY_BLOCK_TITLES.agora)).toBeUndefined();
    expect(section(TODAY_BLOCK_TITLES.emBreve)).toBeUndefined();
  });

  it('"Acho que acabou" fica nas sugestões, não segura o "Tudo em dia" e põe na lista de mercado pelo servidor', async () => {
    settledHouse();
    // Café de dez em dez dias, o último há doze: acabou. O arroz, comprado uma vez só, não diz nada.
    const bought = (name: string, at: string, category = 'cafe_cha'): PurchaseRecord => ({
      name,
      category,
      productId: null,
      quantity: 1,
      unit: 'un',
      at: `${at}T10:00:00.000Z`,
      source: 'receipt',
    });
    mockData.purchases = [
      bought('Café', '2026-10-09'),
      bought('Café', '2026-10-19'),
      bought('Café', '2026-10-29'),
      bought('Arroz', '2026-10-29', 'graos'),
    ];
    await mount();
    // Não é pendência: a casa continua em dia, com o cartão e a frase do topo.
    expect(page()).toContain('Tudo em dia por aqui.');
    expect(page()).toContain(ALL_CLEAR_TITLE);
    const suggestions = section(TODAY_BLOCK_TITLES.sugestoes)!;
    expect(rawText(suggestions)).toContain('Acho que acabou');
    const cafe = suggestions.findAllByType(ListRow).find((row) => row.props.title === 'Café')!;
    expect(cafe.props.subtitle).toBe('Costuma comprar a cada 10 dias · última há 12 dias');
    expect(suggestions.findAllByType(ListRow).map((row) => row.props.title)).toEqual(['Café']);

    // Um item: vai para a lista de mercado aberta mais recente (ou uma nova), e a tela fica.
    await act(async () => cafe.props.onPress());
    expect(mockAddItems).toHaveBeenCalledTimes(1);
    expect(mockAddItems).toHaveBeenLastCalledWith({
      newListName: 'Mercado',
      reuseMarketList: true,
      items: [{ name: 'Café', category: 'cafe_cha', productId: null, quantity: 1, unit: 'un' }],
    });
    expect(router.push).not.toHaveBeenCalled();

    // "Pôr tudo na lista": o mesmo pedido, e abre a lista.
    const all = suggestions.findAllByType(LinkButton).find((b) => b.props.title === 'Pôr tudo na lista')!;
    await act(async () => all.props.onPress());
    expect(mockAddItems).toHaveBeenCalledTimes(2);
    expect(mockAddItems.mock.calls[1][0]).toMatchObject({ newListName: 'Mercado', reuseMarketList: true });
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/lista/[id]', params: { id: 'mercado' } });
  });

  it('antes de tudo carregar, nada de "Tudo em dia"', async () => {
    settledHouse();
    mockData.overview = overview({ queries: [{ ...mockQuery(), isSuccess: false, isPending: true }] });
    await mount();
    expect(page()).not.toContain(ALL_CLEAR_TITLE);
    expect(page()).toContain('Veja o que tem para hoje.');
  });
});

describe('os primeiros passos', () => {
  it('casa nova: o cartão com os cinco passos, no lugar do "Tudo em dia" (o topo continua dizendo)', async () => {
    await mount();
    const card = section(FIRST_STEPS_TITLE)!;
    expect(card.findAllByType(ListRow).map((row) => row.props.title)).toEqual([
      'Convidar alguém da casa',
      'Criar a primeira lista',
      'Escanear a primeira nota',
      'Guardar o que já tem em casa',
      'Cadastrar pessoas e pets',
    ]);
    expect(rawText(card)).toContain('0 de 5 feitos');
    expect(page()).toContain('Tudo em dia por aqui.');
    expect(page()).not.toContain(ALL_CLEAR_TITLE);
  });

  it('cada passo se marca pelo que a casa já tem, e com todos feitos o cartão some', async () => {
    mockData.members = 2;
    mockData.anyList = answered(true);
    await mount();
    const steps = () => section(FIRST_STEPS_TITLE)!.findAllByType(ListRow).map((row) => [row.props.title, row.props.subtitle]);
    expect(steps()).toEqual([
      ['Convidar alguém da casa', 'Feito'],
      // Uma lista arquivada também conta.
      ['Criar a primeira lista', 'Feito'],
      ['Escanear a primeira nota', 'O QR code da nota fiscal guarda os preços'],
      ['Guardar o que já tem em casa', 'Pela câmera: o código de barras ou uma foto da prateleira'],
      ['Cadastrar pessoas e pets', 'Crianças, idosos e pets que não usam o app'],
    ]);
    mockData.anyReceipt = answered(true);
    // O que já entrou na despensa conta, também o que acabou.
    mockData.anyPantry = answered(true);
    // Uma ficha de quem usa o app não conta; a de um pet sim.
    mockData.people = [{ id: 'p0', name: 'Ana', kind: 'pessoa', birth_date: null, member_user_id: 'u0' }];
    await rerender();
    expect(section(FIRST_STEPS_TITLE)).toBeDefined();
    mockData.people = [...mockData.people, { id: 'p1', name: 'Rex', kind: 'pet', birth_date: null, member_user_id: null }];
    await rerender();
    expect(section(FIRST_STEPS_TITLE)).toBeUndefined();
    expect(page()).toContain(ALL_CLEAR_TITLE);
    // Todos feitos fecham o cartão de vez neste aparelho: se a outra pessoa sai da casa e a ficha do pet é
    // apagada, ele não volta.
    expect(await AsyncStorage.getItem(`kotii:first-steps-dismissed:${mockData.householdId}`)).toBe('1');
    mockData.members = 1;
    mockData.people = [];
    await rerender();
    expect(section(FIRST_STEPS_TITLE)).toBeUndefined();
    expect(page()).toContain(ALL_CLEAR_TITLE);
  });

  it('no meio de uma troca de casa (a aberta ainda não é a da tela), os passos feitos não fecham o cartão', async () => {
    settledHouse();
    mockData.activeId = 'casa-seguinte';
    await mount();
    expect(section(FIRST_STEPS_TITLE)).toBeUndefined();
    expect(await AsyncStorage.getItem(`kotii:first-steps-dismissed:${mockData.householdId}`)).toBeNull();
    // A casa nova chegou e é a aberta: agora sim.
    mockData.activeId = mockData.householdId;
    await rerender();
    expect(await AsyncStorage.getItem(`kotii:first-steps-dismissed:${mockData.householdId}`)).toBe('1');
  });

  it('só pergunta ao banco o que a tela não sabe: com uma lista aberta, um rascunho e algo na despensa, nada', async () => {
    mockData.lists = [list('Mercado')];
    mockData.drafts = [{ id: 'n1', store: null }];
    mockData.pantry = [pantry('Arroz', '2027-03-01')];
    await mount();
    expect(mockData.asked.list.every((enabled) => !enabled)).toBe(true);
    expect(mockData.asked.receipt.every((enabled) => !enabled)).toBe(true);
    expect(mockData.asked.pantry.every((enabled) => !enabled)).toBe(true);
    const steps = section(FIRST_STEPS_TITLE)!.findAllByType(ListRow).map((row) => row.props.subtitle);
    expect(steps.slice(1, 4)).toEqual(['Feito', 'Feito', 'Feito']);
  });

  it('sem nenhuma lista aberta nem rascunho, pergunta; enquanto a resposta vem, nem o cartão nem o "Tudo em dia" (sem piscar)', async () => {
    mockData.anyList = { data: undefined, status: 'pending', fetchStatus: 'fetching' };
    await mount();
    expect(mockData.asked.list).toContain(true);
    expect(mockData.asked.receipt).toContain(true);
    expect(mockData.asked.pantry).toContain(true);
    expect(section(FIRST_STEPS_TITLE)).toBeUndefined();
    expect(page()).not.toContain(ALL_CLEAR_TITLE);
    mockData.anyList = answered(false);
    await rerender();
    expect(section(FIRST_STEPS_TITLE)).toBeDefined();
  });

  it('sem internet (a pergunta parada) ou com ela falhando, o cartão não aparece, e o "Tudo em dia" sim', async () => {
    mockData.anyReceipt = { data: undefined, status: 'pending', fetchStatus: 'paused' };
    await mount();
    expect(section(FIRST_STEPS_TITLE)).toBeUndefined();
    expect(page()).toContain(ALL_CLEAR_TITLE);
  });

  it('um "não" guardado não marca o passo por fazer enquanto é buscado de novo, nem depois de a busca falhar', async () => {
    mockData.members = 2;
    mockData.anyList = answered(true);
    mockData.people = [{ id: 'p1', name: 'Rex', kind: 'pet', birth_date: null, member_user_id: null }];
    // O rascunho foi confirmado em outro celular: a pergunta volta, com o "não" de antes guardado, e busca de novo.
    mockData.anyReceipt = { data: false, status: 'success', fetchStatus: 'fetching' };
    await mount();
    expect(mockData.asked.receipt).toContain(true);
    expect(section(FIRST_STEPS_TITLE)).toBeUndefined();
    // A resposta está a caminho: o "Tudo em dia" espera, sem piscar.
    expect(page()).not.toContain(ALL_CLEAR_TITLE);
    // A busca falhou (sinal ruim): o "não" velho continua sem valer, e a tela segue sem o cartão.
    mockData.anyReceipt = { data: false, status: 'error', fetchStatus: 'idle' };
    await rerender();
    expect(section(FIRST_STEPS_TITLE)).toBeUndefined();
    expect(page()).toContain(ALL_CLEAR_TITLE);
    // Sem internet, com o "não" guardado (a busca parada): o mesmo.
    mockData.anyReceipt = { data: false, status: 'success', fetchStatus: 'paused' };
    await rerender();
    expect(section(FIRST_STEPS_TITLE)).toBeUndefined();
    // Um "sim" guardado vale enquanto busca: o passo está feito.
    mockData.anyReceipt = { data: true, status: 'success', fetchStatus: 'fetching' };
    mockData.people = [];
    await rerender();
    const steps = section(FIRST_STEPS_TITLE)!.findAllByType(ListRow).map((row) => [row.props.title, row.props.subtitle]);
    expect(steps[2]).toEqual(['Escanear a primeira nota', 'Feito']);
  });

  it('o que a tela vê (uma lista aberta, um rascunho) fica como "sim" na resposta guardada', async () => {
    mockData.lists = [list('Mercado')];
    await mount();
    const last = (calls: boolean[]) => calls[calls.length - 1];
    expect(last(mockData.seen.list)).toBe(true);
    expect(last(mockData.seen.receipt)).toBe(false);
    mockData.drafts = [{ id: 'n1', store: null }];
    await rerender();
    expect(last(mockData.seen.receipt)).toBe(true);
    expect(last(mockData.seen.pantry)).toBe(false);
    mockData.pantry = [pantry('Arroz', '2027-03-01')];
    await rerender();
    expect(last(mockData.seen.pantry)).toBe(true);
  });

  const step = (title: string) => section(FIRST_STEPS_TITLE)!.findAllByType(ListRow).find((row) => row.props.title === title)!;
  /** O convite (features/onboarding/InviteSheet), que a Hoje monta fechado. */
  const inviteSheet = () => renderer!.root.findAll((node) => node.props.title === INVITE_TITLE && typeof node.props.onClose === 'function')[0];

  it('com o começo novo (como o app sai), "Convidar" abre o convite ali mesmo e "Pessoas e pets" abre o cadastro', async () => {
    await mount();
    // No aparelho, a mensagem do convite leva só o código: a dica não fala de link.
    expect(step('Convidar alguém da casa').props.subtitle).toBe(FIRST_STEP_INVITE_BY_CODE);
    expect(inviteSheet().props.visible).toBe(false);
    await act(async () => step('Convidar alguém da casa').props.onPress());
    expect(inviteSheet().props.visible).toBe(true);
    expect(rawText(renderer!.root)).toContain('ABC123');
    expect(router.push).not.toHaveBeenCalled();
    await act(async () => inviteSheet().props.onClose());
    expect(inviteSheet().props.visible).toBe(false);
    await act(async () => step('Cadastrar pessoas e pets').props.onPress());
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/pessoa/[id]', params: { id: 'nova', kind: 'pessoa' } });
    // Os outros passos levam aonde sempre levaram.
    await act(async () => step('Escanear a primeira nota').props.onPress());
    expect(router.push).toHaveBeenLastCalledWith('/escanear');
    await act(async () => step('Guardar o que já tem em casa').props.onPress());
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/escanear', params: { para: 'despensa' } });
    await act(async () => step('Criar a primeira lista').props.onPress());
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/lista/[id]', params: { id: 'mercado' } });
  });

  it('no navegador, a dica de convidar fala do link, que vai na mensagem do convite', async () => {
    const web = jest.replaceProperty(Platform, 'OS', 'web');
    const hadLocation = Object.getOwnPropertyDescriptor(window, 'location');
    Object.defineProperty(window, 'location', { value: { origin: 'https://kotii.app' }, configurable: true });
    try {
      await mount();
      expect(step('Convidar alguém da casa').props.subtitle).toBe(FIRST_STEP_INVITE_BY_LINK);
    } finally {
      if (hadLocation) Object.defineProperty(window, 'location', hadLocation);
      else delete (window as { location?: unknown }).location;
      web.restore();
    }
  });

  it('cada passo leva aonde ele se faz (o de antes, com a chave do começo desligada: o convite e as fichas em Configurações)', async () => {
    jest.replaceProperty(FEATURES, 'onboarding', false);
    await mount();
    expect(step('Convidar alguém da casa').props.subtitle).toBe('Em Configurações, com o código de convite');
    await act(async () => step('Convidar alguém da casa').props.onPress());
    expect(router.push).toHaveBeenLastCalledWith('/configuracoes');
    await act(async () => step('Cadastrar pessoas e pets').props.onPress());
    expect(router.push).toHaveBeenLastCalledWith('/configuracoes');
    // A nota e o que já tem em casa abrem a mesma câmera, o "Escanear"; a da despensa, só nos produtos.
    await act(async () => step('Escanear a primeira nota').props.onPress());
    expect(router.push).toHaveBeenLastCalledWith('/escanear');
    await act(async () => step('Guardar o que já tem em casa').props.onPress());
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/escanear', params: { para: 'despensa' } });
    // A primeira lista é a de mercado, aberta (ou criada) pelo servidor, como no atalho.
    await act(async () => step('Criar a primeira lista').props.onPress());
    expect(mockOpenList).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/lista/[id]', params: { id: 'mercado' } });
  });

  it('o passo feito fica marcado e não leva a lugar nenhum', async () => {
    mockData.members = 3;
    await mount();
    const invite = section(FIRST_STEPS_TITLE)!.findAllByType(ListRow).find((row) => row.props.title === 'Convidar alguém da casa')!;
    expect(invite.props.onPress).toBeUndefined();
    expect(invite.props.dimmed).toBe(true);
  });

  it('dispensar tira o cartão na hora, põe o "Tudo em dia" de volta e fica guardado no aparelho, só para esta casa', async () => {
    await mount();
    const dismiss = section(FIRST_STEPS_TITLE)!.findAllByType(LinkButton).find((b) => b.props.title === 'Dispensar')!;
    await act(async () => dismiss.props.onPress());
    expect(section(FIRST_STEPS_TITLE)).toBeUndefined();
    expect(page()).toContain(ALL_CLEAR_TITLE);
    expect(await AsyncStorage.getItem(`kotii:first-steps-dismissed:${mockData.householdId}`)).toBe('1');
    // Dispensado, nada mais é perguntado ao banco.
    mockData.asked = { list: [], receipt: [], pantry: [] };
    await rerender();
    expect(mockData.asked.list.every((enabled) => !enabled)).toBe(true);
    // Outra casa, no mesmo aparelho, ainda vê os passos dela.
    mockData.householdId = `${mockData.householdId}-outra`;
    await rerender();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(section(FIRST_STEPS_TITLE)).toBeDefined();
  });

  it('o passo da despensa dá para pular: sai do cartão na hora e fica guardado no aparelho, só para esta casa', async () => {
    await mount();
    const rows = () => section(FIRST_STEPS_TITLE)!.findAllByType(ListRow).map((row) => row.props.title);
    const skips = section(FIRST_STEPS_TITLE)!.findAllByType(LinkButton).filter((b) => b.props.title === 'Pular');
    // Só ele tem o "Pular", e o leitor de tela ouve de qual passo é.
    expect(skips).toHaveLength(1);
    expect(skips[0].props.accessibilityLabel).toBe('Pular: Guardar o que já tem em casa');
    await act(async () => skips[0].props.onPress());
    expect(rows()).toEqual(['Convidar alguém da casa', 'Criar a primeira lista', 'Escanear a primeira nota', 'Cadastrar pessoas e pets']);
    expect(rawText(section(FIRST_STEPS_TITLE)!)).toContain('0 de 4 feitos');
    expect(await AsyncStorage.getItem(`kotii:first-steps-skipped:${mockData.householdId}`)).toBe('["despensa"]');
    // Pulado, a despensa não é mais perguntada ao banco.
    mockData.asked = { list: [], receipt: [], pantry: [] };
    await rerender();
    expect(mockData.asked.pantry.every((enabled) => !enabled)).toBe(true);
    // Com os outros quatro feitos, o cartão fecha de vez: o pulado não segura.
    settledHouse();
    mockData.anyPantry = answered(false);
    await rerender();
    expect(section(FIRST_STEPS_TITLE)).toBeUndefined();
    expect(await AsyncStorage.getItem(`kotii:first-steps-dismissed:${mockData.householdId}`)).toBe('1');
    // Outra casa, no mesmo aparelho, ainda tem o passo dela.
    mockData.householdId = `${mockData.householdId}-outra`;
    mockData.activeId = mockData.householdId;
    mockData.members = 1;
    mockData.lists = [];
    mockData.anyReceipt = answered(false);
    mockData.people = [];
    await rerender();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(rows()).toContain('Guardar o que já tem em casa');
  });

  it('com coisas para fazer, os primeiros passos vêm depois de "Agora" e "Em breve", e antes das sugestões', async () => {
    mockData.chores = [chore('Tirar o lixo', TODAY)];
    mockData.pantry = [pantry('Leite', '2026-11-11')];
    mockData.lists = [list('Mercado', 2)];
    await mount();
    const titles = renderer!.root.findAllByType(Section).map((s) => s.props.title);
    expect(titles).toEqual([TODAY_BLOCK_TITLES.agora, TODAY_BLOCK_TITLES.emBreve, FIRST_STEPS_TITLE, TODAY_BLOCK_TITLES.sugestoes]);
  });
});

describe('"Hora de trocar" (prazos de troca)', () => {
  const bought = (name: string, day: string, category: string, extra: Partial<PurchaseRecord> = {}): PurchaseRecord => ({
    name,
    category,
    productId: null,
    quantity: 1,
    unit: 'un',
    at: `${day}T10:00:00.000Z`,
    source: 'receipt',
    ...extra,
  });
  /** O travesseiro na hora desde 1/8, a vassoura desde 1/9 e a escova desde 1/10 (hoje é 10/11). */
  function dueHouse() {
    settledHouse();
    mockData.purchases = [
      bought('Escova de dente', '2026-07-01', 'higiene', { productId: 'p-escova', quantity: 2 }),
      bought('Vassoura', '2025-09-01', 'limpeza'),
      bought('Travesseiro', '2024-08-01', 'outros'),
    ];
  }
  const group = (title: string) => renderer!.root.findAllByType(SuggestionGroup).find((g) => g.props.title === title);
  const rows = () => group(SUGGESTION_TITLES.longCycle)?.findAllByType(ListRow).map((r) => r.props.title as string) ?? [];
  const row = (title: string) => group(SUGGESTION_TITLES.longCycle)!.findAllByType(ListRow).find((r) => r.props.title === title)!;
  const options = (name: string) => renderer!.root.findAllByType(IconButton).find((b) => b.props.label === `Opções de ${name}`);
  const sheet = () => renderer!.root.findAllByType(ActionSheet).find((a) => a.props.visible);
  const sheetButton = (label: string) =>
    sheet()!.findAll((n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function' && rawText(n) === label)[0];
  // No Jest o sistema é o iOS: a ação escolhida roda quando o menu acaba de descer (o onDismiss do Modal).
  async function pressSheet(label: string) {
    const menu = sheet()!;
    await act(async () => sheetButton(label).props.onPress());
    await act(async () => menu.findByType(Modal).props.onDismiss());
  }
  const viewOf = (node: ReactTestInstance) => node.findAllByType(View)[0].instance as unknown;
  const focusedLast = () => (jest.mocked(moveFocus).mock.calls.at(-1)?.[0] as { current: unknown } | undefined)?.current;
  const undoButton = () => group(SUGGESTION_TITLES.longCycle)!.findAllByType(Button).find((b) => b.props.title === 'Desfazer')!;

  it('fica nas sugestões, entre "Acho que acabou" e "Cardápio de hoje", e não segura o "Tudo em dia"', async () => {
    dueHouse();
    await mount();
    // Só o grupo dos prazos: a casa continua em dia, com o cartão.
    expect(page()).toContain('Tudo em dia por aqui.');
    expect(page()).toContain(ALL_CLEAR_TITLE);
    expect(rows()).toEqual(['Travesseiro', 'Vassoura', 'Escova de dente']);
    expect(row('Escova de dente').props.subtitle).toBe('Última compra há 4 meses · trocar a cada 3 meses');

    await act(async () => renderer!.unmount());
    mockData.purchases = [
      ...mockData.purchases,
      bought('Café', '2026-10-09', 'cafe_cha'),
      bought('Café', '2026-10-19', 'cafe_cha'),
      bought('Café', '2026-10-29', 'cafe_cha'),
    ];
    mockData.menu = [{ id: 'm1', day: TODAY, meal: 'almoco', dish: 'Feijoada' }];
    await mount();
    const titles = section(TODAY_BLOCK_TITLES.sugestoes)!.findAllByType(SuggestionGroup).map((g) => g.props.title);
    expect(titles).toEqual([SUGGESTION_TITLES.restock, SUGGESTION_TITLES.longCycle, SUGGESTION_TITLES.menu]);
  });

  it('o círculo e o toque na linha põem na lista de mercado pelo servidor, com a chave do item', async () => {
    dueHouse();
    await mount();
    const brush = row('Escova de dente');
    await act(async () => brush.findByType(AddCircle).props.onPress());
    expect(mockAddItems).toHaveBeenLastCalledWith({
      newListName: 'Mercado',
      reuseMarketList: true,
      items: [{ name: 'Escova de dente', category: 'higiene', productId: 'p-escova', quantity: 2, unit: 'un', cycleKey: 'escova_dente' }],
    });
    await act(async () => row('Vassoura').props.onPress());
    expect(mockAddItems).toHaveBeenCalledTimes(2);
    expect(mockAddItems.mock.calls[1][0]).toMatchObject({ items: [{ name: 'Vassoura', cycleKey: 'vassoura' }] });
    expect(router.push).not.toHaveBeenCalled();
  });

  it('uma inclusão por vez nos dois grupos', async () => {
    dueHouse();
    mockData.purchases = [
      ...mockData.purchases,
      bought('Café', '2026-10-09', 'cafe_cha'),
      bought('Café', '2026-10-19', 'cafe_cha'),
      bought('Café', '2026-10-29', 'cafe_cha'),
    ];
    let finish: (value: { id: string }) => void = () => undefined;
    mockAddItems.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    await mount();
    const restockRow = group(SUGGESTION_TITLES.restock)!.findAllByType(ListRow)[0];
    const brush = row('Escova de dente');
    await act(async () => {
      restockRow.props.onPress();
      brush.findByType(AddCircle).props.onPress();
    });
    expect(mockAddItems).toHaveBeenCalledTimes(1);
    await act(async () => finish({ id: 'mercado' }));
  });

  it('as opções: "Já troquei", "Mudar o prazo" e "Não sugerir mais"; antes da migração, nenhum botão de opções', async () => {
    dueHouse();
    await mount();
    await act(async () => options('Vassoura')!.props.onPress());
    expect(sheet()!.props.title).toBe('Vassoura');
    expect(sheet()!.props.message).toBe('Última compra há 1 ano e 2 meses · trocar todo ano');
    expect(sheet()!.props.actions.map((a: { label: string }) => a.label)).toEqual(['Já troquei', 'Mudar o prazo', 'Não sugerir mais']);

    await act(async () => renderer!.unmount());
    mockData.longCycleSettings = { data: null, fetchStatus: 'idle' };
    await mount();
    expect(rows()).toEqual(['Travesseiro', 'Vassoura', 'Escova de dente']);
    expect(options('Vassoura')).toBeUndefined();
    expect(renderer!.root.findAllByType(IconButton).filter((b) => String(b.props.label).startsWith('Opções'))).toHaveLength(0);
  });

  it('"Já troquei" grava hoje, o aviso fica no lugar da linha com o foco no "Desfazer", que grava o de antes', async () => {
    dueHouse();
    mockData.longCycleSettings = { data: [{ item_key: 'vassoura', every_months: null, off: false, replaced_on: '2025-01-05' }], fetchStatus: 'idle' };
    await mount();
    await act(async () => options('Vassoura')!.props.onPress());
    await pressSheet('Já troquei');
    expect(mockSaveSetting).toHaveBeenCalledWith({ itemKey: 'vassoura', change: { replaced_on: TODAY } });
    // A vassoura saiu, o aviso ficou no lugar dela (a segunda linha).
    expect(rows()).toEqual(['Travesseiro', 'Vassoura', 'Escova de dente']);
    expect(row('Vassoura').props.subtitle).toBe(longCycleReplacedNotice('Vassoura'));
    expect(undoButton().props.accessibilityLabel).toBe('Desfazer a troca de Vassoura');
    expect(focusedLast()).toBe(viewOf(undoButton()));

    await act(async () => undoButton().props.onPress());
    expect(mockSaveSetting).toHaveBeenLastCalledWith({ itemKey: 'vassoura', change: { replaced_on: '2025-01-05' } });
    // A linha volta, e o foco vai para as opções dela.
    expect(group(SUGGESTION_TITLES.longCycle)!.findAllByType(Button).find((b) => b.props.title === 'Desfazer')).toBeUndefined();
    expect(row('Vassoura').props.subtitle).toBe('Última compra há 1 ano e 2 meses · trocar todo ano');
    expect(focusedLast()).toBe(viewOf(options('Vassoura')!));
  });

  it('"Já troquei" com a data do aparelho errada avisa e não grava; dois toques gravam uma vez', async () => {
    dueHouse();
    await mount();
    await act(async () => options('Vassoura')!.props.onPress());
    jest.setSystemTime(new Date(1999, 11, 31, 12));
    await pressSheet('Já troquei');
    const clock = longCycleDayError('1999-12-31')!;
    expect(notify).toHaveBeenCalledWith(clock.title, clock.message);
    expect(mockSaveSetting).not.toHaveBeenCalled();
    jest.setSystemTime(NOW);

    let finish: () => void = () => undefined;
    mockSaveSetting.mockImplementationOnce(
      ({ itemKey, change }) =>
        new Promise((resolve) => (finish = () => resolve({ item_key: itemKey, every_months: null, off: false, replaced_on: null, ...change }))),
    );
    await act(async () => options('Vassoura')!.props.onPress());
    const action = sheet()!.props.actions.find((a: { label: string }) => a.label === 'Já troquei');
    // As duas chamadas da mesma ação, uma logo depois da outra (o segundo toque antes de a primeira gravar).
    await act(async () => {
      action.onPress();
      action.onPress();
    });
    expect(mockSaveSetting).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });

  it('"Não sugerir mais" grava, diz como voltar, e o "Desfazer" volta a sugerir', async () => {
    dueHouse();
    await mount();
    await act(async () => options('Travesseiro')!.props.onPress());
    await pressSheet('Não sugerir mais');
    expect(mockSaveSetting).toHaveBeenCalledWith({ itemKey: 'travesseiro', change: { off: true } });
    expect(row('Travesseiro').props.subtitle).toBe(longCycleOffNotice('Travesseiro'));
    expect(undoButton().props.accessibilityLabel).toBe('Voltar a sugerir Travesseiro');
    await act(async () => undoButton().props.onPress());
    expect(mockSaveSetting).toHaveBeenLastCalledWith({ itemKey: 'travesseiro', change: { off: false } });
    expect(rows()).toEqual(['Travesseiro', 'Vassoura', 'Escova de dente']);
  });

  it('"Mudar o prazo" abre a folha do prazo; no iPhone, só depois de o menu sair', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    dueHouse();
    await mount();
    const periodChips = () => renderer!.root.findAllByType(Chip).filter((c) => c.props.toggle);
    await act(async () => options('Escova de dente')!.props.onPress());
    const menu = sheet()!;
    await act(async () => sheetButton('Mudar o prazo').props.onPress());
    // O menu fechou, e a folha espera ele descer.
    expect(periodChips()).toHaveLength(0);
    await act(async () => menu.findByType(Modal).props.onDismiss());
    expect(periodChips().map((c) => c.props.label)).toEqual(['1 mês', '2 meses', '3 meses', '4 meses', '6 meses', '9 meses', '1 ano', '1 ano e meio', '2 anos']);
    expect(periodChips().find((c) => c.props.selected)!.props.label).toBe('3 meses');
    expect(periodChips().find((c) => c.props.label === '3 meses')!.props.accessibilityLabel).toBe('3 meses, o padrão do Kotii');
    // Um prazo maior: a escova sai da hora, e o aviso fica no lugar dela.
    await act(async () => periodChips().find((c) => c.props.label === '6 meses')!.props.onPress());
    await act(async () => renderer!.root.findAllByType(Button).find((b) => b.props.title === 'Salvar')!.props.onPress());
    expect(mockSaveSetting).toHaveBeenCalledWith({ itemKey: 'escova_dente', change: { every_months: 6 } });
    expect(row('Escova de dente').props.subtitle).toBe('Escova de dente: agora a cada 6 meses.');
    expect(undoButton().props.accessibilityLabel).toBe('Voltar ao prazo de antes de Escova de dente');
    await act(async () => undoButton().props.onPress());
    expect(mockSaveSetting).toHaveBeenLastCalledWith({ itemKey: 'escova_dente', change: { every_months: null } });
  });

  it('um prazo que ainda deixa na hora: a linha fica e o foco volta às opções dela', async () => {
    dueHouse();
    await mount();
    await act(async () => options('Vassoura')!.props.onPress());
    await pressSheet('Mudar o prazo');
    // 9 meses depois de 1/9/2025 ainda é a hora (até o dobro, 1/3/2027).
    const chip = renderer!.root.findAllByType(Chip).find((c) => c.props.toggle && c.props.label === '9 meses')!;
    await act(async () => chip.props.onPress());
    await act(async () => renderer!.root.findAllByType(Button).find((b) => b.props.title === 'Salvar')!.props.onPress());
    expect(mockSaveSetting).toHaveBeenCalledWith({ itemKey: 'vassoura', change: { every_months: 9 } });
    // O cache novo (no app, o setQueryData da gravação desenha de novo; aqui, a busca de mentira não avisa).
    await rerender();
    expect(row('Vassoura').props.subtitle).toBe('Última compra há 1 ano e 2 meses · trocar a cada 9 meses');
    expect(group(SUGGESTION_TITLES.longCycle)!.findAllByType(Button).find((b) => b.props.title === 'Desfazer')).toBeUndefined();
    expect(focusedLast()).toBe(viewOf(options('Vassoura')!));
  });

  it('depois de pôr na lista, o foco vai para as opções da linha que ficou no lugar', async () => {
    dueHouse();
    await mount();
    await act(async () => row('Travesseiro').findByType(AddCircle).props.onPress());
    // A lista de agora há pouco chega no desenho seguinte.
    await rerender();
    expect(rows()).toEqual(['Vassoura', 'Escova de dente']);
    expect(focusedLast()).toBe(viewOf(options('Vassoura')!));
  });

  describe('sem tudo o que pode esconder uma linha, nenhum grupo', () => {
    it.each<[string, () => void]>([
      ['os ajustes na primeira busca', () => (mockData.longCycleSettings = { data: undefined, fetchStatus: 'fetching' })],
      ['os ajustes sem internet, sem nada guardado', () => (mockData.longCycleSettings = { data: undefined, fetchStatus: 'paused' })],
      ['as listas carregando', () => (mockData.overrides.lists = mockNoData)],
      ['as listas que falharam ao buscar de novo', () => (mockData.overrides.lists = { isSuccess: false, isError: true })],
      ['as reposições carregando', () => (mockData.overrides.supplies = mockNoData)],
      ['as tarefas carregando', () => (mockData.overrides.chores = mockNoData)],
      ['o histórico dos 180 dias sem dados, mesmo com a leitura longa guardada', () => {
        mockData.longCycleHistory = { data: mockData.purchases, fetchStatus: 'idle' };
        mockData.overrides.purchases = mockNoData;
      }],
      ['a leitura longa na primeira busca', () => (mockData.longCycleHistory = { data: undefined, fetchStatus: 'fetching' })],
    ])('%s', async (_, setup) => {
      dueHouse();
      setup();
      await mount();
      expect(group(SUGGESTION_TITLES.longCycle)).toBeUndefined();
    });
  });

  it('a leitura longa que falhou: só as compras dos 180 dias', async () => {
    dueHouse();
    mockData.purchases = [bought('Escova de dente', '2026-07-01', 'higiene')];
    mockData.longCycleHistory = { data: undefined, fetchStatus: 'idle', isError: true };
    await mount();
    expect(rows()).toEqual(['Escova de dente']);
  });

  it('o que a casa já acompanha fica de fora: "Acho que acabou", "Gás, água e ração" e a tarefa que se repete', async () => {
    dueHouse();
    // Uma escova por semana: está em "Acho que acabou".
    mockData.purchases = [
      ...mockData.purchases,
      bought('Escova de dente', '2026-10-10', 'higiene'),
      bought('Escova de dente', '2026-10-17', 'higiene'),
      bought('Escova de dente', '2026-10-24', 'higiene'),
      bought('Refil filtro Europa', '2026-03-01', 'limpeza'),
      bought('Refil de mop', '2026-03-01', 'limpeza'),
    ];
    mockData.supplies = [{ id: 'f', name: 'Filtro da cozinha', kind: 'filtro', typical_days: 180, notes: null, created_at: '2026-01-01', refills: [] }];
    mockData.chores = [{ ...chore('Trocar a vassoura', '2027-01-01'), recurrence: 'monthly' }];
    await mount();
    expect(group(SUGGESTION_TITLES.restock)!.findAllByType(ListRow).map((r) => r.props.title)).toEqual(['Escova de dente']);
    expect(rows()).toEqual(['Travesseiro', 'Refil de mop']);
  });

  it('"Ver os outros" abre os prazos de troca; antes da migração, não aparece', async () => {
    dueHouse();
    mockData.purchases = [...mockData.purchases, bought('Refil de mop', '2026-03-01', 'limpeza')];
    await mount();
    expect(rows()).toHaveLength(3);
    const more = group(SUGGESTION_TITLES.longCycle)!.findByType(LinkButton);
    expect(more.props.title).toBe('Ver o outro (1)');
    expect(more.props.accessibilityLabel).toBe('Ver o outro item na hora de trocar');
    await act(async () => more.props.onPress());
    expect(router.push).toHaveBeenCalledWith('/trocas');

    await act(async () => renderer!.unmount());
    mockData.longCycleSettings = { data: null, fetchStatus: 'idle' };
    await mount();
    expect(group(SUGGESTION_TITLES.longCycle)!.findAllByType(LinkButton)).toHaveLength(0);
  });

  it('o aviso sai quando a Hoje deixa de estar à vista', async () => {
    dueHouse();
    await mount();
    await act(async () => options('Vassoura')!.props.onPress());
    await pressSheet('Não sugerir mais');
    expect(row('Vassoura').props.subtitle).toBe(longCycleOffNotice('Vassoura'));
    await act(async () => mockFocus.blur.forEach((leave) => leave()));
    expect(rows()).toEqual(['Travesseiro', 'Escova de dente']);
  });
});
