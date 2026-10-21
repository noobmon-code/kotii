import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import HouseScreen from '@/app/(tabs)/casa';
import { fetchProviderJobs, fetchServiceJob, fetchServiceJobs, JOBS_KEY, useProviderJobs } from '@/data/providers';
import { Button, ErrorNotice, ListRow, Screen } from '@/ui/primitives';

// A aba Casa de verdade, no segmento Aparelhos, com a lista de aparelhos e os hooks de dados de verdade; só o
// Supabase é de mentira (e as outras abas ficam de fora). O que se confere aqui: puxar para atualizar busca de novo,
// com os aparelhos, as tarefas (a próxima manutenção), os serviços (o último de cada aparelho) e os prestadores (o
// botão, que volta quando o banco ganha as tabelas).

type Row = Record<string, unknown>;
type Answer = { data: unknown; error: unknown };

const mockIdle = { data: undefined, isPending: false, isError: false, isRefetching: false, error: null, refetch: jest.fn() };
const mockFridge: Row = {
  id: 'e-1',
  name: 'Geladeira',
  category: 'eletrodomestico',
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
  created_at: '2026-01-10T12:00:00Z',
};
const mockJob: Row = {
  id: 'j-1',
  provider_id: 'p-1',
  equipment_id: 'e-1',
  done_on: '2026-10-14',
  description: 'Trocou a borracha',
  amount: 180,
  warranty_until: null,
  notes: null,
  created_at: '2026-10-14T15:00:00Z',
};
const mockFilter: Row = {
  id: 'c-1',
  title: 'Limpar o filtro',
  notes: null,
  recurrence: 'monthly',
  interval_count: 3,
  due_on: '2099-01-10',
  assigned_to: null,
  active: true,
  equipment_id: 'e-1',
  kid_id: null,
  points: 10,
};
const missing = (table: string): Answer => ({
  data: null,
  error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` },
});
const offline: Answer = { data: null, error: { message: 'TypeError: Network request failed' } };

// O servidor de mentira, por tabela; `reads`: as buscas feitas, por tabela.
const mockServer: { tables: Record<string, () => Answer>; reads: Record<string, number> } = { tables: {}, reads: {} };

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), setParams: jest.fn() },
  useLocalSearchParams: () => ({ aba: 'aparelhos' }),
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/ui/art', () => ({ SkyArt: () => null, Logo: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn(), confirmAction: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useHousehold: () => ({ data: { members: [] } }) }));
jest.mock('@/lib/session', () => ({ endSessionIfGone: async () => false }));
// As outras abas não entram nesta história.
jest.mock('@/features/ShoppingListsPanel', () => ({ ShoppingListsPanel: () => null }));
jest.mock('@/features/PantryPanel', () => ({ PantryPanel: () => null }));
jest.mock('@/features/ChoresPanel', () => ({ ChoresPanel: () => null }));
jest.mock('@/features/SuppliesSection', () => ({ SuppliesSection: () => null }));
jest.mock('@/data/market', () => ({ useShoppingLists: () => mockIdle }));
jest.mock('@/data/supplies', () => ({ useSupplies: () => mockIdle }));
jest.mock('@/lib/supabase', () => {
  // Uma consulta do supabase-js: responde quando alguém espera por ela, pela tabela.
  const query = (table: string) => {
    const answer = async (): Promise<Answer> => {
      mockServer.reads[table] = (mockServer.reads[table] ?? 0) + 1;
      return mockServer.tables[table]?.() ?? { data: [], error: null };
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

/** Abre a aba; `beside`: outra tela aberta ao mesmo tempo, com o mesmo cache. */
async function open(beside: ReactNode = null) {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <HouseScreen />
        {beside}
      </QueryClientProvider>,
    );
  });
  await settle();
  const root = renderer!.root;
  return {
    /** O que a linha da geladeira diz embaixo do nome. */
    subtitle: () => root.findAllByType(ListRow).find((row) => row.props.title === 'Geladeira')!.props.subtitle as string,
    /** O botão "Prestadores" está na tela? */
    hasProviders: () => root.findAllByType(Button).some((button) => button.props.title === 'Prestadores'),
    /** A tela de erro no lugar da lista. */
    errorCards: () => root.findAllByType(ErrorNotice).length,
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
  mockServer.reads = {};
  mockServer.tables = {
    equipment: () => ({ data: [mockFridge], error: null }),
    chores: () => ({ data: [], error: null }),
    service_jobs: () => ({ data: [], error: null }),
    service_providers: () => ({ data: [], error: null }),
  };
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  client.clear();
});

describe('Casa › Aparelhos: puxar para atualizar', () => {
  it('o conserto registrado em outro celular aparece como último serviço', async () => {
    const screen = await open();
    expect(screen.subtitle()).not.toContain('Último serviço');
    expect(mockServer.reads).toMatchObject({ equipment: 1, service_jobs: 1, service_providers: 1 });

    // Em outro celular, Ana registra a troca da borracha da geladeira.
    mockServer.tables.service_jobs = () => ({ data: [mockJob], error: null });
    await screen.refresh();
    expect(mockServer.reads).toMatchObject({ equipment: 2, service_jobs: 2, service_providers: 2 });
    expect(screen.subtitle()).toMatch(/^Último serviço: /);
  });

  it('a manutenção criada em outro celular aparece como a próxima', async () => {
    const screen = await open();
    expect(screen.subtitle()).not.toContain('Limpar o filtro');

    mockServer.tables.chores = () => ({ data: [mockFilter], error: null });
    await screen.refresh();
    expect(mockServer.reads.chores).toBe(2);
    expect(screen.subtitle()).toMatch(/^Limpar o filtro: em \d+ dias$/);
  });

  it('no dia da migração: o botão "Prestadores" volta depois de puxar, sem esperar a lista envelhecer', async () => {
    // O celular abriu a aba antes de o banco ganhar as tabelas.
    mockServer.tables.service_jobs = () => missing('service_jobs');
    mockServer.tables.service_providers = () => missing('service_providers');
    const screen = await open();
    expect(screen.hasProviders()).toBe(false);
    expect(screen.errorCards()).toBe(0);

    // A migração chegou ao banco.
    mockServer.tables.service_jobs = () => ({ data: [mockJob], error: null });
    mockServer.tables.service_providers = () => ({ data: [], error: null });
    await screen.refresh();
    expect(screen.hasProviders()).toBe(true);
    expect(screen.subtitle()).toMatch(/^Último serviço: /);
  });

  it('a busca dos serviços ou dos prestadores que falha não vira erro: a lista, o último serviço e o botão ficam', async () => {
    mockServer.tables.service_jobs = () => ({ data: [mockJob], error: null });
    const screen = await open();
    expect(screen.subtitle()).toMatch(/^Último serviço: /);
    expect(screen.hasProviders()).toBe(true);

    mockServer.tables.service_jobs = () => offline;
    mockServer.tables.service_providers = () => offline;
    await screen.refresh();
    expect(mockServer.reads).toMatchObject({ service_jobs: 2, service_providers: 2 });
    expect(screen.errorCards()).toBe(0);
    expect(screen.subtitle()).toMatch(/^Último serviço: /);
    expect(screen.hasProviders()).toBe(true);
  });

  it('dos serviços, só a lista da casa: as de um prestador, de um aparelho e de um serviço, guardadas de outras telas, não', async () => {
    // As telas do prestador, do aparelho e do serviço foram abertas antes: as listas delas ficaram guardadas.
    await client.prefetchQuery({ queryKey: [JOBS_KEY, 'provider', 'p-1'], queryFn: () => fetchProviderJobs('p-1') });
    await client.prefetchQuery({ queryKey: [JOBS_KEY, 'equipment', 'e-1'], queryFn: () => fetchServiceJobs({ equipmentId: 'e-1' }) });
    await client.prefetchQuery({ queryKey: [JOBS_KEY, 'job', 'j-1'], queryFn: () => fetchServiceJob('j-1') });
    const screen = await open();
    const before = mockServer.reads.service_jobs;
    await screen.refresh();
    expect(mockServer.reads.service_jobs - before).toBe(1);
  });

  it('nem a lista de um prestador que outra tela está mostrando agora', async () => {
    function ProviderScreen() {
      useProviderJobs('p-1');
      return null;
    }
    const screen = await open(<ProviderScreen />);
    const before = mockServer.reads.service_jobs;
    await screen.refresh();
    expect(mockServer.reads.service_jobs - before).toBe(1);
  });
});
