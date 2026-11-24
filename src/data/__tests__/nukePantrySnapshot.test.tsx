import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useNukeContext, type NukeContextState } from '@/data/nuke';
import { addDays, formatBRDate, todayISO } from '@/domain/dates';
import { FEATURES } from '@/lib/features';
import type { PantryItem } from '@/lib/types';

// O retrato da casa para o Nuke, com a despensa de um frango fresco e um congelado do mesmo produto: duas linhas, a
// do congelador com "(no congelador)", e a validade estimada (pela categoria, pelo congelador) com "por volta de".
// O resto da casa vem vazio; "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockPantry: { rows: PantryItem[] } = { rows: [] };
const mockQuery = (data: unknown = []) => ({ data, isSuccess: true, isError: false, isPending: false, isRefetching: false, refetch: jest.fn() });

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/supabase', () => {
  // A lista pendente (a única busca do próprio retrato): vazia.
  const query = () => {
    const chain = {
      select: () => chain,
      is: () => chain,
      order: () => chain,
      limit: () => chain,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return chain;
  };
  return {
    supabase: { from: query, rpc: query, functions: { invoke: async () => ({ data: null, error: null }) } },
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
    errorMessage: (error: unknown) => String(error),
  };
});
const mockMe = { household_id: 'h1', user_id: 'ana', display_name: 'Ana', role: 'owner' };
jest.mock('@/lib/auth', () => ({
  useHousehold: () => mockQuery({ household: { id: 'h1', name: 'Casa da Ana' }, members: [mockMe], me: mockMe }),
}));
jest.mock('@/data/home', () => ({
  toSchedules: () => [],
  useChoreRotations: () => mockQuery(),
  useChores: () => mockQuery(),
  useDoses: () => mockQuery(),
  useMedications: () => mockQuery(),
  usePantry: () => mockQuery(mockPantry.rows),
  useSaveChore: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock('@/data/family', () => ({ useFamilyCalendar: () => ({ calendar: { events: [], days: [], people: [] }, refetch: jest.fn() }) }));
jest.mock('@/data/health', () => ({ useAppointments: () => mockQuery(), usePeople: () => mockQuery() }));
jest.mock('@/data/house', () => ({ useDocuments: () => mockQuery(), useEquipmentList: () => mockQuery() }));
jest.mock('@/data/market', () => ({ useAddToMarketList: () => ({ mutateAsync: jest.fn() }) }));
jest.mock('@/data/menu', () => ({ useMenu: () => mockQuery() }));
jest.mock('@/data/supplies', () => ({ useSupplies: () => mockQuery({ supplies: [], available: true }) }));
jest.mock('@/data/appFeedback', () => ({ sendAppFeedback: jest.fn() }));
jest.mock('@/data/images', () => ({ functionErrorMessage: async () => 'Erro' }));

const today = todayISO();
const day = (offset: number) => addDays(today, offset);
const dm = (offset: number) => formatBRDate(day(offset)).slice(0, 5);

const lot = (id: string, patch: Partial<PantryItem>): PantryItem => ({
  id,
  product_id: 'p-frango',
  name: 'Frango',
  category: 'carnes',
  quantity: 1,
  unit: 'kg',
  purchased_on: day(-1),
  expires_on: day(2),
  expiry_source: 'categoria',
  consumed_at: null,
  frozen_on: null,
  thawed_on: null,
  freeze_kind: null,
  fresh_expires_on: null,
  fresh_expiry_source: null,
  ...patch,
});

let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  jest.replaceProperty(FEATURES, 'finance', false);
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('a despensa no retrato do Nuke', () => {
  let state: NukeContextState | undefined;
  function Probe() {
    state = useNukeContext(today);
    return null;
  }

  it('o congelado é outra linha; a validade estimada é "por volta de" e a certa, a data', async () => {
    mockPantry.rows = [
      lot('fresco', {}),
      lot('cong', { purchased_on: day(-90), frozen_on: day(-88), freeze_kind: 'frango', expires_on: day(2), expiry_source: 'congelado', fresh_expires_on: day(-85), fresh_expiry_source: 'categoria' }),
      lot('leite', { product_id: 'p-leite', name: 'Leite', category: 'laticinios', expires_on: day(1), expiry_source: 'manual' }),
    ];
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    expect(state?.status).toBe('ready');
    const context = state?.status === 'ready' ? state.context : '';
    expect(context).toContain(
      `Despensa vencendo: Leite (vence ${dm(1)}); Frango (vence por volta de ${dm(2)}); Frango, no congelador (vence por volta de ${dm(2)}).`,
    );
    expect(context).toContain('Despensa (tem em casa): Leite; Frango; Frango (no congelador).');
  });
});
