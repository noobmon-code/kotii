import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import HouseScreen from '@/app/(tabs)/casa';
import { AgendaPanel, agendaQueryKeys } from '@/features/AgendaPanel';
import { FEATURES } from '@/lib/features';
import { Screen } from '@/ui/primitives';

// A aba Casa de verdade, nas partes Agenda e Documentos, com os painéis e os hooks de dados de verdade; só o
// Supabase é de mentira (e as Tarefas e os Aparelhos ficam de fora: têm os testes deles, choresRefresh e
// equipmentRefresh). O que se confere aqui: puxar para atualizar busca de novo tudo o que a parte aberta mostra, e
// só isso; com a chave de Finanças desligada (lib/features), nem a agenda nem o puxar pedem as contas; e a lista
// do puxar da Agenda (agendaQueryKeys) é a das buscas que o painel faz.

type Answer = { data: unknown; error: unknown };

// O servidor de mentira: toda tabela responde vazia; `reads`, as buscas feitas, por tabela.
const mockServer: { reads: Record<string, number> } = { reads: {} };
// A parte aberta (?aba=).
const mockParams: { aba?: string } = {};

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
jest.mock('@/lib/auth', () => ({ useHousehold: () => ({ data: { members: [] } }) }));
jest.mock('@/lib/session', () => ({ endSessionIfGone: async () => false }));
// As outras partes da aba não entram nesta história.
jest.mock('@/features/ChoresPanel', () => ({ ChoresPanel: () => null }));
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
  mockServer.reads = {};
  delete mockParams.aba;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  client.clear();
  // A chave de Finanças volta a ser a de verdade (desligada).
  jest.restoreAllMocks();
});

describe('Casa → Agenda: puxar para atualizar', () => {
  it('busca de novo tudo o que a agenda junta; com Finanças desligada, as contas nunca são pedidas', async () => {
    mockParams.aba = 'agenda';
    await open(<HouseScreen />);
    expect(mockServer.reads.bills).toBeUndefined();
    expect(await refresh()).toEqual(AGENDA_TABLES);
  });

  it('com a chave de Finanças ligada, as contas entram na agenda e no puxar', async () => {
    jest.replaceProperty(FEATURES, 'finance', true);
    mockParams.aba = 'agenda';
    await open(<HouseScreen />);
    expect(mockServer.reads.bills).toBe(1);
    expect(await refresh()).toEqual([...AGENDA_TABLES, 'bills'].sort());
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
