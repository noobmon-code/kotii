import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import HouseScreen from '@/app/(tabs)/casa';
import { ListRow, Screen } from '@/ui/primitives';

// A aba Casa de verdade, no segmento Tarefas, com a lista de tarefas e os hooks de dados de verdade; só o Supabase é
// de mentira (e as outras abas ficam de fora). O que se confere aqui: puxar para atualizar busca de novo, com as
// tarefas, as ordens do rodízio e as fichas, e a lista não fica dizendo quem vem depois num rodízio que já acabou.

type Row = Record<string, unknown>;

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockMembers = [
  { household_id: 'h', user_id: 'u-beto', display_name: 'Beto', role: 'owner' },
  { household_id: 'h', user_id: 'u-carla', display_name: 'Carla', role: 'member' },
];
const mockPeople: Row[] = [
  { id: 'p-beto', name: 'Beto', kind: 'pessoa', member_user_id: 'u-beto' },
  { id: 'p-carla', name: 'Carla', kind: 'pessoa', member_user_id: 'u-carla' },
  { id: 'p-lia', name: 'Lia', kind: 'pessoa', member_user_id: null },
];
const mockIdle = { data: undefined, isPending: false, isError: false, isRefetching: false, error: null, refetch: jest.fn() };
// O servidor de mentira: a louça é um rodízio de Beto, Carla e Lia, na vez de Carla. `reads`: as buscas, por tabela.
const mockServer: { order: string[]; reads: Record<string, number> } = { order: [], reads: {} };

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), setParams: jest.fn() },
  useLocalSearchParams: () => ({ aba: 'tarefas' }),
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null, SkyArt: () => null, Logo: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn(), confirmAction: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useHousehold: () => ({ data: { members: mockMembers } }) }));
jest.mock('@/lib/session', () => ({ endSessionIfGone: async () => false }));
// As outras abas não entram nesta história.
jest.mock('@/features/ShoppingListsPanel', () => ({ ShoppingListsPanel: () => null }));
jest.mock('@/features/PantryPanel', () => ({ PantryPanel: () => null }));
jest.mock('@/features/EquipmentPanel', () => ({ EquipmentPanel: () => null }));
jest.mock('@/features/SuppliesSection', () => ({ SuppliesSection: () => null }));
jest.mock('@/data/market', () => ({ useShoppingLists: () => mockIdle }));
jest.mock('@/data/supplies', () => ({ useSupplies: () => mockIdle }));
jest.mock('@/lib/supabase', () => {
  // Uma consulta do supabase-js: responde quando alguém espera por ela, pela tabela.
  const query = (table: string) => {
    const answer = async (): Promise<{ data: unknown; error: unknown }> => {
      mockServer.reads[table] = (mockServer.reads[table] ?? 0) + 1;
      if (table === 'people') return { data: mockPeople, error: null };
      if (table === 'chores') {
        const dishes = {
          id: 'c-1',
          title: 'Lavar a louça',
          notes: null,
          recurrence: 'daily',
          interval_count: 1,
          due_on: '2026-10-12',
          assigned_to: 'u-carla',
          active: true,
          equipment_id: null,
          kid_id: null,
          points: 10,
        };
        return { data: [dishes], error: null };
      }
      if (table === 'chore_rotation') {
        return { data: mockServer.order.map((person_id, i) => ({ chore_id: 'c-1', person_id, position: i + 1 })), error: null };
      }
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
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
    errorMessage: (error: { message?: string }) => error?.message ?? String(error),
  };
});

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

async function open() {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <HouseScreen />
      </QueryClientProvider>,
    );
  });
  await settle();
  const root = renderer!.root;
  return {
    /** O que a linha da louça diz embaixo do título. */
    subtitle: () => root.findAllByType(ListRow).find((row) => row.props.title === 'Lavar a louça')!.props.subtitle as string,
    /** Puxar para atualizar. */
    refresh: async () => {
      await act(async () => root.findByType(Screen).props.onRefresh());
      await settle();
    },
  };
}

beforeEach(() => {
  // Como no app, menos a segunda tentativa e o prazo do cache (sem relógio pendurado).
  client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false, gcTime: Infinity } } });
  Object.assign(mockServer, { order: ['p-beto', 'p-carla', 'p-lia'], reads: {} });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  client.clear();
});

describe('Casa › Tarefas: puxar para atualizar', () => {
  it('busca também as ordens e as fichas: o rodízio encerrado em outro celular deixa de dizer quem vem depois', async () => {
    const screen = await open();
    expect(screen.subtitle()).toMatch(/· Todo dia · Vez de Carla · depois Lia$/);
    expect(mockServer.reads).toMatchObject({ chores: 1, chore_rotation: 1, people: 1 });

    // Em outro celular decidem que Carla faz sempre: o rodízio acaba, e a tarefa fica com ela.
    mockServer.order = [];
    await screen.refresh();
    expect(mockServer.reads).toMatchObject({ chores: 2, chore_rotation: 2, people: 2 });
    expect(screen.subtitle()).toMatch(/· Todo dia · Carla$/);
    expect(screen.subtitle()).not.toContain('depois');
  });

  it('a ordem mudada em outro celular também: o "depois" passa a ser o de agora', async () => {
    const screen = await open();
    mockServer.order = ['p-carla', 'p-beto'];
    await screen.refresh();
    expect(screen.subtitle()).toMatch(/· Todo dia · Vez de Carla · depois Beto$/);
  });
});
