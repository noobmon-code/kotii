import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { Text as RNText } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import TodayScreen from '@/app/(tabs)/index';
import { toTimestamp } from '@/domain/health';
import { FIRST_STEPS_TITLE } from '@/domain/firstSteps';
import { ALL_CLEAR_TITLE, PANTRY_SHOWN, TODAY_BLOCK_TITLES } from '@/domain/today';
import type { Chore, Equipment, HomeDocument, Medication, PantryItem, Supply } from '@/lib/types';
import { Button, LinkButton, ListRow, Section } from '@/ui/primitives';

// A tela Hoje por urgência, com as linhas de verdade e as buscas trocadas por respostas prontas: "Agora" (o atrasado
// antes do que é de hoje), "Em breve" (o mais perto antes) e "Sugestões" (que não contam nem seguram o "Tudo em
// dia"); a frase do topo com a mesma conta das linhas; e os "Primeiros passos", que se marcam pelo que a casa tem,
// esperam saber os quatro para aparecer e somem dispensados (no aparelho, por casa) ou com os quatro feitos.

// O relógio parado no meio do dia (só a data: os tempos de espera continuam de verdade): a dose das 8h passou, a
// das 20h não.
const NOW = new Date(2026, 10, 10, 12, 0);
const TODAY = '2026-11-10';

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockQuery = (data: unknown = []) => ({ data, isSuccess: true, isError: false, isPending: false, isRefetching: false, refetch: jest.fn() });
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
  people: [] as { id: string; name: string; kind: 'pessoa' | 'pet'; birth_date: string | null; member_user_id: string | null }[],
  members: 1,
  householdId: 'casa',
  // As duas perguntas dos primeiros passos: a resposta e com que `enabled` a tela as fez.
  anyList: { data: false as boolean | undefined, fetchStatus: 'idle' },
  anyReceipt: { data: false as boolean | undefined, fetchStatus: 'idle' },
  asked: { list: [] as boolean[], receipt: [] as boolean[] },
  overview: {} as Record<string, unknown>,
};
const mockScanner = { open: jest.fn() };
const mockOpenList = jest.fn(async () => ({ id: 'mercado', name: 'Mercado' }));

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
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
  useChores: () => mockQuery(mockData.chores),
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
  useAddItemsToList: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useAddToMarketList: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useAddToPharmacyList: () => ({ mutateAsync: jest.fn() }),
  useOpenMarketList: () => ({ mutateAsync: mockOpenList }),
  usePurchaseRecords: () => mockQuery(),
  useShoppingLists: () => mockQuery(mockData.lists),
}));
jest.mock('@/data/firstSteps', () => ({
  useAnyList: (enabled: boolean) => {
    mockData.asked.list.push(enabled);
    return { ...mockData.anyList, refetch: jest.fn() };
  },
  useAnyReceipt: (enabled: boolean) => {
    mockData.asked.receipt.push(enabled);
    return { ...mockData.anyReceipt, refetch: jest.fn() };
  },
}));
jest.mock('@/data/marketTrips', () => ({ useRefreshMarketTrips: () => () => undefined }));
jest.mock('@/data/menu', () => ({ useMenu: () => mockQuery(mockData.menu) }));
jest.mock('@/data/pendingReceipts', () => ({ usePendingReceipts: () => ({ pending: [], storeNames: {} }) }));
jest.mock('@/data/receipts', () => ({ useDraftReceipts: () => mockQuery(mockData.drafts) }));
jest.mock('@/data/supplies', () => ({
  useSupplies: () => mockQuery({ supplies: mockData.supplies, available: true }),
  useRecordRefill: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/features/health/useHealthOverview', () => ({ useHealthOverview: () => mockData.overview }));
jest.mock('@/features/ChoresPanel', () => ({ announceCompletion: jest.fn() }));
jest.mock('@/features/finance/BillsPanel', () => ({ BillRow: () => null }));
jest.mock('@/features/finance/PayBillModal', () => ({ PayBillModal: () => null }));
jest.mock('@/features/InstallAppCard', () => ({ InstallAppCard: () => null }));
jest.mock('@/features/MarketTrip', () => ({ MarketTripBanner: () => null }));
jest.mock('@/features/ReceiptScanner', () => ({ useReceiptScanner: () => ({ open: mockScanner.open, busy: false, element: null }) }));
jest.mock('@/features/RecentPurchases', () => ({
  useJustListed: () => ({ pending: new Set<string>(), add: jest.fn(), drop: jest.fn() }),
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
    people: [],
    members: 1,
    householdId: `casa-${house}`,
    anyList: { data: false, fetchStatus: 'idle' },
    anyReceipt: { data: false, fetchStatus: 'idle' },
    asked: { list: [], receipt: [] },
    overview: overview(),
  });
  jest.mocked(router.push).mockClear();
  mockScanner.open.mockClear();
  mockOpenList.mockClear();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  jest.useRealTimers();
});

/** Uma casa que já deu os quatro passos: o cartão deles não aparece. */
function settledHouse() {
  mockData.members = 2;
  mockData.lists = [list('Mercado')];
  mockData.anyReceipt = { data: true, fetchStatus: 'idle' };
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

  it('a despensa mostra até seis por bloco, e o "Ver todos" leva a Compras → Despensa', async () => {
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

  it('antes de tudo carregar, nada de "Tudo em dia"', async () => {
    settledHouse();
    mockData.overview = overview({ queries: [{ ...mockQuery(), isSuccess: false, isPending: true }] });
    await mount();
    expect(page()).not.toContain(ALL_CLEAR_TITLE);
    expect(page()).toContain('Veja o que tem para hoje.');
  });
});

describe('os primeiros passos', () => {
  it('casa nova: o cartão com os quatro passos, no lugar do "Tudo em dia" (o topo continua dizendo)', async () => {
    await mount();
    const card = section(FIRST_STEPS_TITLE)!;
    expect(card.findAllByType(ListRow).map((row) => row.props.title)).toEqual([
      'Convidar alguém da casa',
      'Criar a primeira lista',
      'Escanear a primeira nota',
      'Cadastrar pessoas e pets',
    ]);
    expect(rawText(card)).toContain('0 de 4 feitos');
    expect(page()).toContain('Tudo em dia por aqui.');
    expect(page()).not.toContain(ALL_CLEAR_TITLE);
  });

  it('cada passo se marca pelo que a casa já tem, e com os quatro feitos o cartão some', async () => {
    mockData.members = 2;
    mockData.anyList = { data: true, fetchStatus: 'idle' };
    await mount();
    const steps = () => section(FIRST_STEPS_TITLE)!.findAllByType(ListRow).map((row) => [row.props.title, row.props.subtitle]);
    expect(steps()).toEqual([
      ['Convidar alguém da casa', 'Feito'],
      // Uma lista arquivada também conta.
      ['Criar a primeira lista', 'Feito'],
      ['Escanear a primeira nota', 'O QR code da nota fiscal guarda os preços'],
      ['Cadastrar pessoas e pets', 'Crianças, idosos e pets que não usam o app'],
    ]);
    mockData.anyReceipt = { data: true, fetchStatus: 'idle' };
    // Uma ficha de quem usa o app não conta; a de um pet sim.
    mockData.people = [{ id: 'p0', name: 'Ana', kind: 'pessoa', birth_date: null, member_user_id: 'u0' }];
    await rerender();
    expect(section(FIRST_STEPS_TITLE)).toBeDefined();
    mockData.people = [...mockData.people, { id: 'p1', name: 'Rex', kind: 'pet', birth_date: null, member_user_id: null }];
    await rerender();
    expect(section(FIRST_STEPS_TITLE)).toBeUndefined();
    expect(page()).toContain(ALL_CLEAR_TITLE);
  });

  it('só pergunta ao banco o que a tela não sabe: com uma lista aberta e um rascunho, nada', async () => {
    mockData.lists = [list('Mercado')];
    mockData.drafts = [{ id: 'n1', store: null }];
    await mount();
    expect(mockData.asked.list.every((enabled) => !enabled)).toBe(true);
    expect(mockData.asked.receipt.every((enabled) => !enabled)).toBe(true);
    const steps = section(FIRST_STEPS_TITLE)!.findAllByType(ListRow).map((row) => row.props.subtitle);
    expect(steps.slice(1, 3)).toEqual(['Feito', 'Feito']);
  });

  it('sem nenhuma lista aberta nem rascunho, pergunta; enquanto a resposta vem, nem o cartão nem o "Tudo em dia" (sem piscar)', async () => {
    mockData.anyList = { data: undefined, fetchStatus: 'fetching' };
    await mount();
    expect(mockData.asked.list).toContain(true);
    expect(mockData.asked.receipt).toContain(true);
    expect(section(FIRST_STEPS_TITLE)).toBeUndefined();
    expect(page()).not.toContain(ALL_CLEAR_TITLE);
    mockData.anyList = { data: false, fetchStatus: 'idle' };
    await rerender();
    expect(section(FIRST_STEPS_TITLE)).toBeDefined();
  });

  it('sem internet (a pergunta parada) ou com ela falhando, o cartão não aparece, e o "Tudo em dia" sim', async () => {
    mockData.anyReceipt = { data: undefined, fetchStatus: 'paused' };
    await mount();
    expect(section(FIRST_STEPS_TITLE)).toBeUndefined();
    expect(page()).toContain(ALL_CLEAR_TITLE);
  });

  it('cada passo leva aonde ele se faz', async () => {
    await mount();
    const step = (title: string) => section(FIRST_STEPS_TITLE)!.findAllByType(ListRow).find((row) => row.props.title === title)!;
    await act(async () => step('Convidar alguém da casa').props.onPress());
    expect(router.push).toHaveBeenLastCalledWith('/configuracoes');
    await act(async () => step('Cadastrar pessoas e pets').props.onPress());
    expect(router.push).toHaveBeenLastCalledWith('/configuracoes');
    await act(async () => step('Escanear a primeira nota').props.onPress());
    expect(mockScanner.open).toHaveBeenCalledTimes(1);
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
    mockData.asked = { list: [], receipt: [] };
    await rerender();
    expect(mockData.asked.list.every((enabled) => !enabled)).toBe(true);
    // Outra casa, no mesmo aparelho, ainda vê os passos dela.
    mockData.householdId = `${mockData.householdId}-outra`;
    await rerender();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(section(FIRST_STEPS_TITLE)).toBeDefined();
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
