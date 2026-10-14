import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer, type ReactTestRendererJSON } from 'react-test-renderer';

import SupplyScreen from '@/app/reposicao/[id]';
import { router } from 'expo-router';

import { notify } from '@/ui/dialogs';
import { Button, TextField } from '@/ui/primitives';

// A tela de uma reposição de verdade, com as buscas e gravações de verdade de src/data/supplies.ts e o
// cliente do Supabase de verdade: só a rede é trocada por um "banco" em memória. O que se confere aqui é
// salvar a edição de uma reposição que outra pessoa da casa excluiu com a tela aberta. "mock" no nome: o
// jest.mock só enxerga variáveis assim.
type Row = Record<string, unknown>;
const mockDb: { supplies: Row[]; writes: { method: string; id: string | null }[] } = { supplies: [], writes: [] };

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 's1' }),
}));
jest.mock('@/ui/dialogs', () => ({ askYesNo: jest.fn(), confirmAction: jest.fn(), notify: jest.fn() }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/lib/reminders', () => ({ REMINDER_PLACE: 'neste celular', remindersSupported: true, remindersUnavailableReason: () => null }));
jest.mock('@/data/market', () => ({ useAddToMarketList: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }) }));
jest.mock('@/lib/supabase', () => {
  const { createClient } = jest.requireActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const supabase = createClient('http://localhost:54321', 'anon', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? 'GET';
        if (url.pathname !== '/rest/v1/supplies') return json([]);
        if (method === 'GET') return json(mockDb.supplies.map((s) => ({ ...s, supply_refills: [] })));
        const id = url.searchParams.get('id')?.replace(/^eq\./, '') ?? null;
        mockDb.writes.push({ method, id });
        // A mudança devolve só as linhas que alcançou: nenhuma, se a reposição já não existe.
        const hit = mockDb.supplies.filter((s) => s.id === id);
        if (method === 'PATCH') hit.forEach((s) => Object.assign(s, JSON.parse(String(init?.body))));
        return json(hit.map((s) => ({ id: s.id })));
      },
    },
  });
  return {
    supabase,
    errorMessage: (error: { message?: string }) => error?.message ?? 'Algo deu errado. Tente novamente.',
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
  };
});

const gas = (): Row => ({ id: 's1', name: 'Gás de cozinha', kind: 'gas', typical_days: 45, notes: null, created_at: '2026-10-01T10:00:00Z' });

let renderer: ReactTestRenderer | undefined;

function texts(node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null): string[] {
  if (node == null) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(texts);
  return (node.children ?? []).flatMap(texts);
}
const page = () => texts(renderer!.toJSON());
const field = (label: string) => renderer!.root.findAllByType(TextField).find((input) => input.props.label === label)!;
const button = (title: string) => renderer!.root.findAllByType(Button).find((item) => item.props.title === title);

/** Espera em passos curtos, em vez de um tempo fixo: com a máquina ocupada, a tela pode demorar um pouco mais. */
async function until(ready: () => boolean, capMs = 3000) {
  for (let waited = 0; waited < capMs && !ready(); waited += 10) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

beforeEach(() => {
  mockDb.supplies = [gas()];
  mockDb.writes = [];
  jest.mocked(notify).mockClear();
  jest.mocked(router.back).mockClear();
  // gcTime infinito: sem ele, o cache deixa um timer de 5 minutos e o Jest não termina.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  act(() => {
    renderer = create(
      <QueryClientProvider client={client}>
        <SupplyScreen />
      </QueryClientProvider>,
    );
  });
});

afterEach(() => {
  act(() => renderer?.unmount());
});

describe('Editar reposição', () => {
  it('salvar a edição de uma reposição que outra pessoa da casa excluiu: avisa, não fecha, e a tela diz que ela não existe mais', async () => {
    await until(() => Boolean(button('Salvar')));
    act(() => field('Nome').props.onChangeText('Gás do fogão'));
    // Em outro celular, alguém da casa exclui o gás com esta tela aberta.
    mockDb.supplies = [];
    act(() => button('Salvar')!.props.onPress());
    await until(() => page().includes('Esta reposição não existe mais.'));
    expect(mockDb.writes).toEqual([{ method: 'PATCH', id: 's1' }]);
    expect(jest.mocked(notify).mock.calls).toEqual([['Erro', 'Esta reposição não existe mais.']]);
    expect(router.back).not.toHaveBeenCalled();
    // A lista buscada de novo já não a tem: no lugar do formulário, o aviso.
    expect(page()).toContain('Esta reposição não existe mais.');
    expect(button('Salvar')).toBeUndefined();
  });

  it('a edição de uma reposição que ainda existe grava e fecha a tela, sem aviso', async () => {
    await until(() => Boolean(button('Salvar')));
    act(() => field('Nome').props.onChangeText('Gás do fogão'));
    act(() => button('Salvar')!.props.onPress());
    await until(() => jest.mocked(router.back).mock.calls.length > 0);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
    expect(mockDb.supplies[0].name).toBe('Gás do fogão');
  });
});
