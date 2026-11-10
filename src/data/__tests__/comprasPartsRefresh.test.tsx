import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import ShoppingScreen from '@/app/(tabs)/compras';
import { Screen } from '@/ui/primitives';

// A aba Compras de verdade, com os painéis e os hooks de dados de verdade em cada parte (Listas, Notas e Despensa);
// só o Supabase é de mentira, e o leitor de notas e as notas pendentes do aparelho ficam de fora (têm os testes
// deles). O que se confere aqui: puxar para atualizar busca de novo o que a parte aberta mostra, e só isso: nas
// Listas, as listas e as arquivadas; nas Notas, tudo debaixo de 'receipts'; na Despensa, a despensa e o gás, a água
// e a ração.

type Answer = { data: unknown; error: unknown; count?: number };

// A parte aberta (?aba=).
const mockParams: { aba?: string } = {};

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
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
jest.mock('@/lib/auth', () => ({ useHousehold: () => ({ data: { members: [] } }), useAuth: () => ({ session: null }) }));
jest.mock('@/lib/session', () => ({ endSessionIfGone: async () => false }));
jest.mock('@/lib/reminders', () => ({ REMINDER_PLACE: 'neste celular', remindersSupported: false, remindersUnavailableReason: () => null }));
jest.mock('@/features/ReceiptScanner', () => ({ useReceiptScanner: () => ({ open: jest.fn(), busy: false, element: null }) }));
jest.mock('@/data/pendingReceipts', () => ({ usePendingReceipts: () => ({ pending: [], storeNames: {} }) }));
jest.mock('@/lib/supabase', () => {
  // Uma consulta do supabase-js: responde quando alguém espera por ela.
  const query = () => {
    // Toda tabela responde vazia (e conta zero, para as leituras em páginas).
    const answer = async (): Promise<Answer> => ({ data: [], error: null, count: 0 });
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
    supabase: { from: () => query(), rpc: () => query() },
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

/** Quantas respostas (boas ou com erro) cada busca do cache já teve, pela chave. */
const answers = () =>
  new Map(client.getQueryCache().getAll().map((query) => [query.queryHash, query.state.dataUpdateCount + query.state.errorUpdateCount]));

/** Abre a aba na parte pedida e puxa para atualizar; devolve as chaves das buscas que responderam de novo. */
async function refreshOn(aba: string): Promise<string[]> {
  mockParams.aba = aba;
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <ShoppingScreen />
      </QueryClientProvider>,
    );
  });
  await settle();
  const before = answers();
  // A parte abriu de verdade: buscou o que mostra.
  expect(before.size).toBeGreaterThan(0);
  await act(async () => renderer!.root.findByType(Screen).props.onRefresh());
  await settle();
  return client
    .getQueryCache()
    .getAll()
    .filter((query) => query.state.dataUpdateCount + query.state.errorUpdateCount > (before.get(query.queryHash) ?? 0))
    .map((query) => query.queryHash)
    .sort();
}

beforeEach(() => {
  delete mockParams.aba;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  client.clear();
});

describe('Compras: puxar para atualizar, por parte', () => {
  it('Listas: as listas abertas e as arquivadas, e só elas', async () => {
    expect(await refreshOn('listas')).toEqual(['["archivedLists"]', '["lists"]']);
  });

  it('Notas: tudo debaixo de "receipts" (os rascunhos e o histórico), e só isso', async () => {
    const refetched = await refreshOn('notas');
    expect(refetched).toEqual(expect.arrayContaining(['["receipts","drafts"]', '["receipts","history"]']));
    expect(refetched.every((hash) => hash.startsWith('["receipts"'))).toBe(true);
  });

  it('Despensa: a despensa e o gás, a água e a ração, e só eles', async () => {
    expect(await refreshOn('despensa')).toEqual(['["pantry"]', '["supplies"]']);
  });
});
