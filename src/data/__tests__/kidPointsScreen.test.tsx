import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import PointsScreen from '@/app/pontos';
import { Button, ErrorNotice, ListRow, Loading, Text } from '@/ui/primitives';

// "Pontos das crianças" de verdade, com os hooks de dados e o cache (QueryClient) de verdade; só o Supabase é de
// mentira. O que se confere aqui: a tarefa em rodízio fica no cartão de cada criança da ordem, e o cartão não diz que
// a criança não tem tarefa com pontos enquanto as ordens não chegaram (ou quando a busca delas falhou).

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
// O servidor de mentira: a louça é um rodízio de Beto e Lia, na vez de Beto, e vale 10 pontos na vez de Lia.
const mockServer: {
  order: string[];
  /** Tabelas cuja busca falha, como sem internet. */
  down: string[];
  /** O banco de antes da migração: não tem a tabela do rodízio. */
  old: boolean;
  /** A busca das ordens só responde depois disto. */
  gate: Promise<void> | null;
  /** Quantas vezes as ordens foram buscadas. */
  orderReads: number;
} = { order: [], down: [], old: false, gate: null, orderReads: 0 };

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  Stack: { Screen: () => null },
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/ui/art', () => ({ SkyArt: () => null, Logo: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn(), confirmAction: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useHousehold: () => ({ data: { members: mockMembers } }) }));
jest.mock('@/lib/session', () => ({ endSessionIfGone: async () => false }));
jest.mock('@/lib/supabase', () => {
  // Uma consulta do supabase-js: responde quando alguém espera por ela, pela tabela.
  const query = (table: string) => {
    const answer = async (): Promise<{ data: unknown; error: unknown }> => {
      if (table === 'chore_rotation') {
        mockServer.orderReads += 1;
        await mockServer.gate;
      }
      // Como o supabase-js devolve a falha de rede.
      if (mockServer.down.includes(table)) return { data: null, error: { message: 'TypeError: Network request failed', code: '' } };
      if (table === 'people') return { data: mockPeople, error: null };
      if (table === 'kid_points') return { data: [{ person_id: 'p-lia', balance: 20 }], error: null };
      if (table === 'chores') {
        const dishes = {
          id: 'c-1',
          title: 'Lavar a louça',
          notes: null,
          recurrence: 'daily',
          interval_count: 1,
          due_on: '2026-10-12',
          assigned_to: 'u-beto',
          active: true,
          equipment_id: null,
          kid_id: null,
          points: 10,
        };
        return { data: [dishes], error: null };
      }
      if (table === 'chore_rotation') {
        // Como a API responde pela tabela que o banco não tem.
        if (mockServer.old) return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.chore_rotation' in the schema cache" } };
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

const HINT = 'Nenhuma tarefa com pontos ainda: na tarefa, escolha Lia como responsável.';
const DISHES = 'Lavar a louça — 10 pontos · vez de Beto';

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

const tick = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 5)));

async function open() {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <PointsScreen />
      </QueryClientProvider>,
    );
  });
  const root = renderer!.root;
  return {
    loading: () => root.findAllByType(Loading).length > 0,
    /** Os avisos de erro na tela, pelo texto. */
    errors: () => root.findAllByType(ErrorNotice).map((notice) => (notice.props.error as Error).message),
    /** As tarefas nos cartões das crianças: "título — o que vem embaixo". */
    rows: () => root.findAllByType(ListRow).map((row) => `${row.props.title} — ${row.props.subtitle}`),
    texts: () => root.findAllByType(Text).map((text) => [text.props.children].flat().join('')),
    press: async (label: string) => {
      await act(async () => root.findAllByType(Button).find((b) => b.props.title === label)!.props.onPress());
      await settle();
    },
  };
}

/** A busca das ordens fica esperando até `release()`. */
function holdOrders() {
  let release = () => undefined as void;
  mockServer.gate = new Promise<void>((resolve) => {
    release = () => {
      mockServer.gate = null;
      resolve();
    };
  });
  return () => release();
}

beforeEach(() => {
  // Como no app, menos a segunda tentativa (aqui uma falha já é a falha) e o prazo do cache (sem relógio pendurado).
  client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false, gcTime: Infinity } } });
  Object.assign(mockServer, { order: ['p-beto', 'p-lia'], down: [], old: false, gate: null, orderReads: 0 });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  client.clear();
});

describe('Pontos das crianças: a tarefa em rodízio no cartão de cada criança da ordem', () => {
  it('com as ordens: a louça fica no cartão de Lia, na vez de Beto', async () => {
    const screen = await open();
    await settle();
    expect(screen.rows()).toEqual([DISHES]);
    expect(screen.texts()).not.toContain(HINT);
  });

  it('a busca das ordens falhou e não há nada guardado: em vez de dizer que Lia não tem tarefa, o aviso de erro, e "Tentar de novo" busca as ordens', async () => {
    mockServer.down = ['chore_rotation'];
    const screen = await open();
    await settle();
    expect(screen.texts()).not.toContain(HINT);
    expect(screen.errors()).toEqual(['TypeError: Network request failed']);
    expect(mockServer.orderReads).toBe(1);

    mockServer.down = [];
    await screen.press('Tentar de novo');
    expect(mockServer.orderReads).toBe(2);
    expect(screen.errors()).toEqual([]);
    expect(screen.rows()).toEqual([DISHES]);
  });

  it('as ordens ainda a caminho: o resto da tela já aparece, sem dizer que Lia não tem tarefa', async () => {
    const release = holdOrders();
    const screen = await open();
    await tick();
    await tick();
    expect(screen.loading()).toBe(false);
    expect(screen.texts()).toContain('Lia');
    expect(screen.rows()).toEqual([]);
    expect(screen.texts()).not.toContain(HINT);
    expect(screen.texts().filter((text) => text.startsWith('Nenhuma tarefa'))).toEqual([]);

    release();
    await settle();
    expect(screen.rows()).toEqual([DISHES]);
  });

  it('com as ordens guardadas, a tela não espera a busca nova delas, e uma busca que falha não troca a tela pelo erro', async () => {
    client.setQueryData(['choreRotations'], { 'c-1': ['p-beto', 'p-lia'] }, { updatedAt: Date.now() - 60 * 60_000 });
    mockServer.down = ['chore_rotation'];
    const screen = await open();
    await tick();
    expect(screen.loading()).toBe(false);
    await settle();
    expect(client.getQueryState(['choreRotations'])?.status).toBe('error');
    expect(screen.errors()).toEqual([]);
    expect(screen.rows()).toEqual([DISHES]);
  });

  it('banco que ainda não tem o rodízio: "nenhuma ordem" é uma resposta, e aí Lia, sem tarefa dela, ganha a sugestão de sempre', async () => {
    mockServer.old = true;
    const screen = await open();
    await settle();
    expect(screen.errors()).toEqual([]);
    expect(screen.rows()).toEqual([]);
    expect(screen.texts()).toContain(HINT);
  });
});
