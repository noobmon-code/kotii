import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Text as RNText } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import TodayScreen from '@/app/(tabs)/index';
import AgendaScreen from '@/app/agenda';
import { useNukeContext, type NukeContextState } from '@/data/nuke';
import { todayISO } from '@/domain/dates';
import { FEATURES } from '@/lib/features';
import { Loading } from '@/ui/primitives';

// Finanças desligada (lib/features) nas três telas que liam as contas sem ser de Finanças: a Hoje, a agenda e o
// retrato do Nuke. As buscas de Finanças são as de verdade (data/finance), em cima de um banco de mentira que anota
// cada tabela pedida: com a chave desligada, nenhum pedido a elas, e nenhuma das três fica esperando uma busca que
// nunca vem (uma busca desligada nunca fica pronta). O resto da casa vem pronto.

const FINANCE_TABLES = ['bills', 'bill_payments', 'expenses', 'budgets', 'settlements', 'split_weights'];

// "mock" no nome: o jest.mock só enxerga variáveis assim. As tabelas do banco de mentira e cada pedido feito a ele.
const mockDb = { asked: [] as string[], tables: {} as Record<string, unknown[]> };
jest.mock('@/lib/supabase', () => {
  // Qualquer encadeamento (select, eq, order…) devolve a mesma consulta, que responde com as linhas da tabela.
  const query = (table: string): unknown => {
    const result = { data: mockDb.tables[table] ?? [], error: null, count: (mockDb.tables[table] ?? []).length };
    const chain: unknown = new Proxy(
      {},
      {
        get: (_target, prop) =>
          prop === 'then'
            ? (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
            : () => chain,
      },
    );
    return chain;
  };
  return {
    supabase: {
      from: (table: string) => {
        mockDb.asked.push(table);
        return query(table);
      },
      rpc: (name: string) => {
        mockDb.asked.push(`rpc:${name}`);
        return query(name);
      },
      functions: { invoke: async () => ({ data: null, error: null }) },
    },
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
    errorMessage: (error: unknown) => String(error),
  };
});

const mockQuery = (data: unknown = []) => ({ data, isSuccess: true, isError: false, isPending: false, isRefetching: false, refetch: jest.fn() });
const mockMe = { household_id: 'h1', user_id: 'ana', display_name: 'Ana', role: 'owner' };
jest.mock('@/lib/auth', () => ({
  useHousehold: () =>
    mockQuery({ household: { id: 'h1', name: 'Casa da Ana' }, members: [mockMe], me: mockMe, households: [{ id: 'h1', name: 'Casa da Ana', role: 'owner' }] }),
}));
jest.mock('@/data/weather', () => ({
  useHouseholdLocation: () => ({ data: null }),
  useForecast: () => ({ data: undefined }),
  useRefreshWeather: () => () => undefined,
}));
jest.mock('@/data/home', () => ({
  toSchedules: () => [],
  useChoreRotations: () => mockQuery(),
  useChores: () => mockQuery(),
  useCompleteChore: () => ({ mutate: jest.fn(), isPending: false }),
  useDoses: () => mockQuery(),
  useMedications: () => mockQuery(),
  usePantry: () => mockQuery(),
  useSaveChore: () => ({ mutateAsync: jest.fn() }),
  useToggleDose: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/data/family', () => ({
  useFamilyCalendar: () => ({ calendar: { events: [], days: [], people: [] }, refetch: jest.fn() }),
}));
jest.mock('@/data/health', () => ({
  useAppointments: () => mockQuery(),
  usePeople: () => mockQuery(),
  useVaccines: () => mockQuery(),
}));
jest.mock('@/data/house', () => ({ useDocuments: () => mockQuery(), useEquipmentList: () => mockQuery() }));
jest.mock('@/data/market', () => ({
  useAddItemsToList: () => ({ mutateAsync: jest.fn() }),
  useAddToMarketList: () => ({ mutateAsync: jest.fn() }),
  useOpenMarketList: () => ({ mutateAsync: jest.fn() }),
  usePurchaseRecords: () => mockQuery(),
  useShoppingLists: () => mockQuery(),
}));
jest.mock('@/data/marketTrips', () => ({ useRefreshMarketTrips: () => () => undefined }));
jest.mock('@/data/menu', () => ({ useMenu: () => mockQuery() }));
jest.mock('@/data/pendingReceipts', () => ({ usePendingReceipts: () => ({ pending: [] }) }));
jest.mock('@/data/receipts', () => ({ useDraftReceipts: () => mockQuery() }));
jest.mock('@/data/supplies', () => ({ useSupplies: () => mockQuery({ supplies: [], available: true }) }));
jest.mock('@/data/appFeedback', () => ({ sendAppFeedback: jest.fn() }));
jest.mock('@/data/images', () => ({ functionErrorMessage: async () => 'Erro' }));
// As partes da Hoje que não têm a ver com Finanças ficam de fora. A linha de conta diz o nome, para a tela com a chave ligada.
jest.mock('@/features/ChoresPanel', () => ({ announceCompletion: jest.fn() }));
jest.mock('@/features/finance/BillsPanel', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { BillRow: ({ bill }: { bill: { name: string } }) => <Text>{bill.name}</Text> };
});
jest.mock('@/features/finance/PayBillModal', () => ({ PayBillModal: () => null }));
jest.mock('@/features/health/HealthTodaySections', () => ({
  useHealthRows: () => ({ workout: () => null, appointment: () => null, toConfirm: () => null, vaccine: () => null, draft: () => null }),
}));
jest.mock('@/features/health/MedicationSections', () => ({
  DoseSubtitle: () => null,
  useRefillRows: () => () => null,
  useRefills: () => ({ rows: [], attention: [] }),
}));
jest.mock('@/features/health/useHealthOverview', () => ({
  useHealthOverview: () => ({ queries: [], loaded: true, people: [], upcoming: [], toConfirm: [], vaccinesDue: [], workoutsToday: [], drafts: [] }),
}));
jest.mock('@/features/InstallAppCard', () => ({ InstallAppCard: () => null }));
jest.mock('@/features/MarketTrip', () => ({ MarketTripBanner: () => null }));
jest.mock('@/features/PendingReceiptCard', () => ({ pendingReceiptListRow: () => null }));
jest.mock('@/features/ReceiptScanner', () => ({ useReceiptScanner: () => ({ open: jest.fn(), busy: false, element: null }) }));
jest.mock('@/features/RecentPurchases', () => ({
  useJustListed: () => ({ pending: new Set<string>(), add: jest.fn(), drop: jest.fn() }),
}));
jest.mock('@/features/SuppliesSection', () => ({ useSupplyTodayRows: () => () => null }));
// Os primeiros passos ficam dispensados nesta casa: o cartão deles tomaria o lugar do "Tudo em dia" (todayBlocks.test).
jest.mock('@/lib/firstSteps', () => ({ useFirstStepsDismissed: () => true, dismissFirstSteps: jest.fn() }));
jest.mock('@/features/TermsNotice', () => ({ TermsNoticeCard: () => null }));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn() }));
jest.mock('@/ui/iconArt', () => ({ IconArt: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn(), back: jest.fn() } }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

let renderer: ReactTestRenderer | undefined;
let queryClient: QueryClient;

const rawText = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(rawText).join(''));
const page = () => renderer!.root.findAllByType(RNText).map(rawText);
const financeAsked = () => mockDb.asked.filter((table) => FINANCE_TABLES.includes(table));

async function mount(element: ReactElement) {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
          {element}
        </SafeAreaProvider>
      </QueryClientProvider>,
    );
  });
  // As buscas de verdade (as de Finanças, quando ligada) respondem.
  for (let turn = 0; turn < 6; turn++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

// Vence hoje: está sempre no mês que a agenda abre (amanhã pode já ser do mês seguinte, fora da grade).
const luz = () => ({
  id: 'b1',
  name: 'Luz',
  category: 'contas',
  amount: 230,
  recurrence: 'monthly',
  due_day: 5,
  next_due_on: todayISO(),
  autopay: false,
  notes: null,
  active: true,
  boleto: null,
  deductible: false,
  provider_name: null,
  provider_doc: null,
});

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  mockDb.asked = [];
  // Uma conta que vence hoje: com Finanças ligada, a Hoje a mostraria.
  mockDb.tables = { bills: [luz()], budgets: [], bill_payments: [], expenses: [] };
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  queryClient.clear();
  jest.restoreAllMocks();
});

describe('Hoje', () => {
  it('desligada: nenhum pedido a Finanças, nenhuma conta, e o "Tudo em dia" chega, sem citar conta', async () => {
    await mount(<TodayScreen />);
    expect(financeAsked()).toEqual([]);
    const texts = page();
    expect(texts).not.toContain('Agora');
    expect(texts).not.toContain('Luz');
    expect(texts).toContain('Tudo em dia');
    expect(texts).toContain('Tudo em dia por aqui.');
    expect(texts).toContain('Nenhum remédio, consulta, tarefa, validade ou documento pedindo atenção agora.');
  });

  it('desligada: puxar para atualizar também não pede nada a Finanças', async () => {
    await mount(<TodayScreen />);
    const screen = renderer!.root.findAll((node) => typeof node.props.onRefresh === 'function')[0];
    await act(async () => screen.props.onRefresh());
    expect(financeAsked()).toEqual([]);
  });

  it('ligada: as contas são buscadas e a que vence hoje aparece em "Agora"', async () => {
    jest.replaceProperty(FEATURES, 'finance', true);
    await mount(<TodayScreen />);
    expect(financeAsked()).toEqual(expect.arrayContaining(['bills', 'budgets', 'bill_payments']));
    const texts = page();
    expect(texts).toContain('Agora');
    expect(texts).toContain('Luz');
    expect(texts).toContain('1 coisa pede sua atenção.');
    expect(texts).not.toContain('Tudo em dia');
  });

  it('ligada e sem conta: o "Tudo em dia" diz que nenhuma conta pede atenção', async () => {
    jest.replaceProperty(FEATURES, 'finance', true);
    mockDb.tables.bills = [];
    await mount(<TodayScreen />);
    expect(page()).toContain('Nenhum remédio, consulta, tarefa, conta, validade ou documento pedindo atenção agora.');
  });
});

describe('Agenda', () => {
  it('desligada: não busca as contas e abre (não fica carregando), sem citar contas', async () => {
    await mount(<AgendaScreen />);
    expect(financeAsked()).toEqual([]);
    expect(renderer!.root.findAllByType(Loading)).toHaveLength(0);
    expect(page()).toContain('Tarefas que se repetem aparecem apagadas nas próximas datas: é a previsão.');
    // A conta de hoje não vira um ponto no calendário: o tipo "Conta" some.
    expect(renderer!.root.findAll((node) => typeof node.props.accessibilityLabel === 'string' && /tipo/.test(node.props.accessibilityLabel))).toHaveLength(0);
  });

  it('ligada: busca as contas, e a de hoje marca o dia', async () => {
    jest.replaceProperty(FEATURES, 'finance', true);
    await mount(<AgendaScreen />);
    expect(financeAsked()).toEqual(['bills']);
    expect(page()).toContain('Contas e tarefas que se repetem aparecem apagadas nas próximas datas: é a previsão.');
    expect(renderer!.root.findAll((node) => node.props.accessibilityLabel?.endsWith?.('1 tipo de compromisso')).length).toBeGreaterThan(0);
  });
});

describe('o retrato da casa para o Nuke', () => {
  let state: NukeContextState | undefined;
  function Probe() {
    state = useNukeContext(todayISO());
    return null;
  }

  it('desligada: fica pronto sem pedir nada a Finanças, e não leva contas nem gastos', async () => {
    await mount(<Probe />);
    expect(financeAsked()).toEqual([]);
    expect(state?.status).toBe('ready');
    const context = state?.status === 'ready' ? state.context : '';
    expect(context).not.toMatch(/Contas|Gastos|Orçamento|Luz/);
    expect(context).toContain('Listas de compras: nada pendente.');
  });

  it('ligada: busca contas, pagamentos, gastos e orçamento, e a conta vai no retrato', async () => {
    jest.replaceProperty(FEATURES, 'finance', true);
    await mount(<Probe />);
    expect(new Set(financeAsked())).toEqual(new Set(['bills', 'bill_payments', 'expenses', 'budgets']));
    expect(state?.status).toBe('ready');
    expect(state?.status === 'ready' && state.context).toContain('Contas (atrasadas e próximos 30 dias): Luz R$ 230,00');
  });
});
