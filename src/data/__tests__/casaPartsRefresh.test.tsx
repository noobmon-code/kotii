import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import HouseScreen from '@/app/(tabs)/casa';
import { AgendaPanel, agendaQueryKeys } from '@/features/AgendaPanel';
import { financeQueryKeys } from '@/features/finance/FinancePanel';
import { FEATURES } from '@/lib/features';
import { Screen } from '@/ui/primitives';

// A aba Casa de verdade, na Agenda (do Dia a dia), em Finanças e nos Documentos, com os painéis e os hooks de dados
// de verdade; só o Supabase é de mentira (e as Tarefas e os Aparelhos ficam de fora: têm os testes deles,
// choresRefresh e equipmentRefresh). O que se confere aqui: puxar para atualizar busca de novo tudo o que a parte
// aberta mostra, e só isso; com a chave de Finanças desligada (lib/features), nem a agenda nem o puxar pedem as
// contas, e a parte Finanças não existe; e a lista do puxar da Agenda (agendaQueryKeys) é a das buscas que o painel faz.

type Answer = { data: unknown; error: unknown };

// O servidor de mentira: toda tabela responde vazia; `reads`, as buscas feitas, por tabela.
const mockServer: { reads: Record<string, number> } = { reads: {} };
// A parte aberta (?aba=) e o que está aberto dentro dela (?dia=, ?financas=).
const mockParams: { aba?: string; dia?: string; financas?: string } = {};

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), setParams: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
  useFocusEffect: () => undefined,
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/ui/art', () => ({ Logo: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn(), confirmAction: jest.fn() }));
// Sem sessão, a liberação do consultor (beta) nem é perguntada.
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ session: null }),
  useHousehold: () => ({ data: { household: { id: 'casa-1' }, members: [] } }),
}));
jest.mock('@/lib/session', () => ({ endSessionIfGone: async () => false }));
// As outras partes da aba não entram nesta história. Das Tarefas, só o que o puxar precisa casar com elas: as ordens do
// rodízio que o painel lê (a lista das tarefas é lida pela própria aba).
jest.mock('@/features/ChoresPanel', () => ({
  ChoresPanel: function ChoresPanel() {
    jest.requireActual<typeof import('@/data/home')>('@/data/home').useChoreRotations();
    return null;
  },
}));
// A janela é de computador (ui/desktop), ou não: no computador, o Dia a dia e Finanças mostram as duas metades lado a lado.
let mockDesktop = false;
jest.mock('@/ui/desktop', () => ({ ...jest.requireActual<object>('@/ui/desktop'), useDesktop: () => mockDesktop }));
jest.mock('@/features/EquipmentPanel', () => ({ EquipmentPanel: () => null }));
jest.mock('@/lib/supabase', () => {
  // Uma consulta do supabase-js: responde quando alguém espera por ela, pela tabela.
  const query = (table: string) => {
    const answer = async (): Promise<Answer> => {
      mockServer.reads[table] = (mockServer.reads[table] ?? 0) + 1;
      return { data: [], error: null };
    };
    const builder: unknown = new Proxy(
      {},
      {
        get: (_target, method: string) =>
          method === 'then'
            ? (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => answer().then(resolve, reject)
            : () => builder,
      },
    );
    return builder;
  };
  return {
    supabase: { from: (table: string) => query(table) },
    unwrap: (result: Answer) => {
      if (result.error) throw result.error;
      return result.data;
    },
    errorMessage: (error: { message?: string }) => error?.message ?? String(error),
  };
});

/** As tabelas de tudo o que a agenda junta, sem as contas. */
const AGENDA_TABLES = ['appointments', 'chores', 'documents', 'equipment', 'family_event_days', 'family_events', 'people', 'vaccines'];

let client: QueryClient;
let renderer: ReactTestRenderer | undefined;

/** Espera as buscas em andamento terminarem e a tela acompanhar. */
async function settle() {
  await act(async () => {
    do await new Promise((resolve) => setTimeout(resolve, 5));
    while (client.isFetching());
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

async function open(element: ReactElement) {
  await act(async () => {
    renderer = create(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  });
  await settle();
}

/** Puxar para atualizar; devolve as tabelas pedidas de novo, em ordem alfabética. */
async function refresh(): Promise<string[]> {
  mockServer.reads = {};
  await act(async () => renderer!.root.findByType(Screen).props.onRefresh());
  await settle();
  return Object.keys(mockServer.reads).sort();
}

/** As buscas ligadas que a tela tem montadas, pelo primeiro pedaço da chave. */
const mountedKeys = () =>
  [
    ...new Set(
      client
        .getQueryCache()
        .getAll()
        .filter((query) => query.getObserversCount() > 0 && !query.isDisabled())
        .map((query) => String(query.queryKey[0])),
    ),
  ].sort();

beforeEach(() => {
  // Os testes partem da chave de Finanças desligada; os que a querem ligada ligam no próprio teste.
  jest.replaceProperty(FEATURES, 'finance', false);
  mockDesktop = false;
  mockServer.reads = {};
  delete mockParams.aba;
  delete mockParams.dia;
  delete mockParams.financas;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  client.clear();
  // A chave de Finanças volta a ser a de verdade.
  jest.restoreAllMocks();
});

describe('Casa → Dia a dia → Agenda: puxar para atualizar', () => {
  it('busca de novo tudo o que a agenda junta; com Finanças desligada, as contas nunca são pedidas', async () => {
    mockParams.aba = 'dia';
    mockParams.dia = 'agenda';
    await open(<HouseScreen />);
    expect(mockServer.reads.bills).toBeUndefined();
    expect(await refresh()).toEqual(AGENDA_TABLES);
  });

  it('com a chave de Finanças ligada, as contas entram na agenda e no puxar', async () => {
    jest.replaceProperty(FEATURES, 'finance', true);
    mockParams.aba = 'dia';
    mockParams.dia = 'agenda';
    await open(<HouseScreen />);
    expect(mockServer.reads.bills).toBe(1);
    expect(await refresh()).toEqual([...AGENDA_TABLES, 'bills'].sort());
  });

  it('o endereço de antes (/casa?aba=agenda) abre a mesma agenda, e o puxar é o dela', async () => {
    mockParams.aba = 'agenda';
    await open(<HouseScreen />);
    expect(await refresh()).toEqual(AGENDA_TABLES);
  });
});

describe('Casa → Finanças: puxar para atualizar', () => {
  it('no Resumo, busca de novo os gastos do mês e as contas, e nada das outras partes', async () => {
    jest.replaceProperty(FEATURES, 'finance', true);
    mockParams.aba = 'financas';
    await open(<HouseScreen />);
    const again = await refresh();
    expect(again).toContain('bills');
    expect(again).toContain('expenses');
    for (const table of ['chores', 'documents', 'equipment', 'appointments', 'vaccines', 'family_events']) expect(again).not.toContain(table);
  });

  it('nas Contas, as contas e os pagamentos recentes (o selo "Acima do normal"), sem os gastos do mês', async () => {
    jest.replaceProperty(FEATURES, 'finance', true);
    mockParams.aba = 'financas';
    mockParams.financas = 'contas';
    await open(<HouseScreen />);
    expect(await refresh()).toEqual(['bill_payments', 'bills']);
  });

  it('com a chave desligada a parte não existe: ?aba=financas abre o Dia a dia, e nenhuma tabela de Finanças é pedida', async () => {
    mockParams.aba = 'financas';
    await open(<HouseScreen />);
    await refresh();
    for (const table of ['bills', 'bill_payments', 'expenses', 'budgets']) expect(mockServer.reads[table]).toBeUndefined();
  });
});

describe('agendaQueryKeys: a lista do puxar é a das buscas do painel', () => {
  it.each([
    ['desligada', false],
    ['ligada', true],
  ])('com a chave de Finanças %s', async (_name, finance) => {
    jest.replaceProperty(FEATURES, 'finance', finance);
    await open(<AgendaPanel />);
    expect(mountedKeys()).toEqual([...agendaQueryKeys(finance)].sort());
    expect(agendaQueryKeys(finance).includes('bills')).toBe(finance);
  });
});

describe('Casa → Documentos: puxar para atualizar', () => {
  it('busca de novo os documentos e as fichas (os donos), e só eles', async () => {
    mockParams.aba = 'documentos';
    await open(<HouseScreen />);
    expect(await refresh()).toEqual(['documents', 'people']);
  });
});

describe('no computador: o "Atualizar" busca de novo as duas metades que estão lado a lado', () => {
  /** Quantas vezes as buscas com esse começo de chave trouxeram dados (a de agora conta quando chega). */
  const updates = (prefix: unknown[]) =>
    client
      .getQueryCache()
      .findAll({ queryKey: prefix })
      .reduce((sum, query) => sum + query.state.dataUpdateCount, 0);

  it.each([
    ['o Dia a dia, que abre (nenhum ?dia=)', {}],
    ['com ?dia=agenda (e o endereço de antes, /casa?aba=agenda)', { aba: 'dia', dia: 'agenda' }],
    ['com ?dia=tarefas', { aba: 'dia', dia: 'tarefas' }],
  ])('%s: as tarefas, as ordens do rodízio e as fichas, e tudo o que a agenda junta; o girando, até tudo voltar', async (_name, params) => {
    mockDesktop = true;
    Object.assign(mockParams, params);
    await open(<HouseScreen />);
    mockServer.reads = {};
    act(() => renderer!.root.findByType(Screen).props.onRefresh());
    // A leva inteira: o girando não para quando só as tarefas voltam.
    expect(renderer!.root.findByType(Screen).props.refreshing).toBe(true);
    await settle();
    expect(renderer!.root.findByType(Screen).props.refreshing).toBe(false);
    // As ordens do rodízio (chore_rotation) vêm com as tarefas: sem elas, a lista diria a vez nova com a ordem de antes.
    expect(Object.keys(mockServer.reads).sort()).toEqual([...AGENDA_TABLES, 'chore_rotation'].sort());
  });

  it('o endereço de antes (/casa?aba=agenda) também', async () => {
    mockDesktop = true;
    mockParams.aba = 'agenda';
    await open(<HouseScreen />);
    expect(await refresh()).toEqual([...AGENDA_TABLES, 'chore_rotation'].sort());
  });

  it.each(['resumo', 'contas'])('Finanças (?financas=%s): o Resumo e, ao lado, as Contas com os pagamentos recentes (o selo "Acima do normal")', async (part) => {
    jest.replaceProperty(FEATURES, 'finance', true);
    mockDesktop = true;
    mockParams.aba = 'financas';
    mockParams.financas = part;
    await open(<HouseScreen />);
    const recent = updates(['billPayments', 'recent']);
    // As Contas estão na tela, ao lado do Resumo, também com ?financas=resumo.
    expect(recent).toBeGreaterThan(0);
    const again = await refresh();
    expect(again).toEqual(expect.arrayContaining(['bills', 'bill_payments', 'expenses']));
    expect(updates(['billPayments', 'recent'])).toBe(recent + 1);
    for (const table of ['chores', 'documents', 'equipment', 'appointments', 'vaccines', 'family_events']) expect(again).not.toContain(table);
  });

  it('financeQueryKeys: no celular, a parte aberta; no computador, as duas', () => {
    expect(financeQueryKeys('resumo')).toEqual(['spending', 'bills']);
    expect(financeQueryKeys('contas')).toEqual(['bills', 'billPayments']);
    expect(financeQueryKeys('resumo', true)).toEqual(['spending', 'bills', 'billPayments']);
    expect(financeQueryKeys('contas', true)).toEqual(['spending', 'bills', 'billPayments']);
  });

  it('no celular, nas Tarefas, como sempre: as tarefas e as ordens (as fichas, quando o painel as lê), e nada da agenda', async () => {
    mockParams.aba = 'dia';
    mockParams.dia = 'tarefas';
    await open(<HouseScreen />);
    // O painel de mentira não lê as fichas: só as buscas montadas ('active') são refeitas.
    expect(await refresh()).toEqual(['chore_rotation', 'chores']);
  });
});
