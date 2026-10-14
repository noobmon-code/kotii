import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import EquipmentScreen from '@/app/aparelho/[id]';
import type { Chore } from '@/lib/types';
import { CheckCircle } from '@/ui/primitives';

// A tela do aparelho de verdade, com os hooks de dados e o cache (QueryClient) de verdade; só o Supabase é de
// mentira, e de cada tarefa ele devolve só as colunas que a consulta pediu, como o banco. O que se confere aqui:
// a manutenção em rodízio concluída daqui avisa como a lista de tarefas, porque a linha traz a vez inteira
// (sem kid_id, toda conclusão na vez de uma criança dizia "A vez já tinha passado para …").

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
  { id: 'p-nina', name: 'Nina', kind: 'pessoa', member_user_id: null },
];
const mockEquipment: Row = {
  id: 'e-1',
  name: 'Ar do quarto',
  category: 'climatizacao',
  brand: null,
  model: null,
  serial_number: null,
  location: null,
  purchased_on: null,
  price: null,
  store: null,
  warranty_until: null,
  notes: null,
  file_paths: [],
  created_at: '2026-10-01T12:00:00Z',
};
// A ordem do rodízio da manutenção: Beto, Lia, Nina.
const mockOrder = ['p-beto', 'p-lia', 'p-nina'];
// O servidor de mentira: a manutenção como está no banco.
const mockServer: { chore: Row } = { chore: {} };
const mockNotify = jest.fn();

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'e-1' }),
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null, SkyArt: () => null, Logo: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/ui/dialogs', () => ({
  notify: (title: string, message?: string) => mockNotify(title, message),
  confirmAction: jest.fn(),
}));
// As fotos do aparelho não entram nesta história.
jest.mock('@/features/PhotoStrip', () => ({ PhotoStrip: () => null }));
jest.mock('@/features/useDraftPhotos', () => ({
  useDraftPhotos: () => ({ paths: [], uploading: false, add: jest.fn(), remove: jest.fn(), commit: jest.fn(), pending: () => [] }),
}));
jest.mock('@/features/usePhotoSheet', () => ({ usePhotoSheet: () => ({ element: null, open: jest.fn() }) }));
jest.mock('@/lib/auth', () => ({ useHousehold: () => ({ data: { members: mockMembers } }) }));
jest.mock('@/lib/session', () => ({ endSessionIfGone: async () => false }));
jest.mock('@/lib/supabase', () => {
  // Uma consulta do supabase-js: guarda o que foi encadeado e responde quando alguém espera por ela.
  const query = (table: string) => {
    const calls: Record<string, unknown[]> = {};
    const answer = async (): Promise<{ data: unknown; error: unknown }> => {
      if (table === 'equipment') return { data: mockEquipment, error: null };
      if (table === 'people') return { data: mockPeople, error: null };
      if (table === 'chores') {
        // Só as colunas pedidas: a que a consulta esquece não chega à tela.
        const columns = String(calls.select[0]).split(',').map((column) => column.trim());
        return { data: [Object.fromEntries(columns.map((column) => [column, mockServer.chore[column]]))], error: null };
      }
      return { data: [], error: null };
    };
    const builder: unknown = new Proxy(
      {},
      {
        get: (_target, method: string) =>
          method === 'then'
            ? (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => answer().then(resolve, reject)
            : (...args: unknown[]) => {
                calls[method] = args;
                return builder;
              },
      },
    );
    return builder;
  };
  return {
    supabase: {
      from: (table: string) => query(table),
      // Como complete_chore num rodízio: os pontos são de quem estava na vez, só se não tem o app, e a vez passa
      // para o seguinte da ordem (depois do último, o primeiro).
      rpc: async () => {
        const kid = mockServer.chore.kid_id as string | null;
        const turn = kid ?? mockPeople.find((p) => p.member_user_id === mockServer.chore.assigned_to)?.id;
        const next = mockPeople.find((p) => p.id === mockOrder[(mockOrder.indexOf(String(turn)) + 1) % mockOrder.length])!;
        const result = { completed: true, points: kid ? mockServer.chore.points : 0, person_id: kid, due_on: '2026-11-12', active: true, next_person_id: next.id };
        mockServer.chore = {
          ...mockServer.chore,
          due_on: result.due_on,
          assigned_to: next.member_user_id,
          kid_id: next.member_user_id ? null : next.id,
        };
        return { data: result, error: null };
      },
    },
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
    errorMessage: (error: { message?: string }) => error?.message ?? String(error),
  };
});

// A manutenção como a tela precisa dela: a tarefa inteira (o tipo Chore), com a vez de Lia e os pontos.
const MAINTENANCE: Chore = {
  id: 'c-1',
  title: 'Limpar o filtro',
  notes: null,
  recurrence: 'monthly',
  interval_count: 1,
  due_on: '2026-10-12',
  assigned_to: null,
  active: true,
  equipment_id: 'e-1',
  kid_id: 'p-lia',
  points: 10,
};
const BALANCE = 'O saldo fica em Casa → Tarefas → Pontos das crianças.';

let client: QueryClient;
let renderer: ReactTestRenderer | undefined;

/**
 * Espera as buscas e gravações terminarem e a tela acompanhar. Em rodadas: o que chega só aparece quando o
 * `act` termina, e o que aparece busca mais (o aparelho, depois as manutenções dele, depois o histórico delas).
 */
async function settle() {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      do await new Promise((resolve) => setTimeout(resolve, 5));
      while (client.isFetching() || client.isMutating());
    });
  }
}

async function open() {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <EquipmentScreen />
      </QueryClientProvider>,
    );
  });
  await settle();
  const root = renderer!.root;
  return {
    /** As manutenções que a tela buscou. */
    rows: () => client.getQueryData(['chores', 'equipment', 'e-1']),
    /** Toca no círculo de "feita hoje" da manutenção. */
    complete: async () => {
      const circle = root.findAllByType(CheckCircle).find((c) => c.props.label === 'Registrar Limpar o filtro feita hoje')!;
      await act(async () => circle.props.onPress());
      await settle();
    },
  };
}

beforeEach(() => {
  // Como no app, menos a segunda tentativa e o prazo do cache (sem relógio pendurado).
  client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: false, gcTime: Infinity },
      mutations: { networkMode: 'always', gcTime: Infinity },
    },
  });
  // No banco a linha tem mais colunas do que a tela usa.
  mockServer.chore = { ...MAINTENANCE, household_id: 'h', created_by: 'u-beto', created_at: '2026-10-01T12:00:00Z' };
  jest.clearAllMocks();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  client.clear();
});

describe('manutenções do aparelho: a linha traz a vez inteira', () => {
  it('cada manutenção vem com a tarefa inteira, como na lista de tarefas: também a criança da vez e os pontos', async () => {
    const screen = await open();
    expect(screen.rows()).toEqual([MAINTENANCE]);
  });

  it('concluída na vez de uma criança: comemora os pontos dela e diz a próxima vez, sem dizer que a vez tinha passado', async () => {
    const screen = await open();
    await screen.complete();
    expect(mockNotify.mock.calls).toEqual([['+10 pontos para Lia!', `Próxima vez: Nina. ${BALANCE}`]]);
    expect(JSON.stringify(mockNotify.mock.calls)).not.toContain('já tinha passado');
  });

  it('concluída na vez de um morador: só a próxima vez', async () => {
    mockServer.chore = { ...mockServer.chore, assigned_to: 'u-beto', kid_id: null };
    const screen = await open();
    await screen.complete();
    expect(mockNotify.mock.calls).toEqual([['Próxima vez: Lia.', undefined]]);
  });

  it('a vez que passou mesmo em outro celular continua sendo avisada: a linha mostrava Lia e os pontos foram para Nina', async () => {
    const screen = await open();
    // Em outro celular alguém pulou a vez de Lia; esta tela ainda não buscou de novo.
    mockServer.chore = { ...mockServer.chore, kid_id: 'p-nina' };
    await screen.complete();
    expect(mockNotify.mock.calls).toEqual([['+10 pontos para Nina!', `A vez já tinha passado para Nina. Próxima vez: Beto. ${BALANCE}`]]);
  });
});
