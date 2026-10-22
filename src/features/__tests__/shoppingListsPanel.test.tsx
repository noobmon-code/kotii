import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { StaleNotice } from '@/features/health/StaleNotice';
import { ShoppingListsPanel } from '@/features/ShoppingListsPanel';
import { ErrorNotice } from '@/ui/primitives';

// O painel das listas (aba Casa), com a busca das listas trocada por respostas prontas: com as listas guardadas,
// a busca que falha (voltar ao app com sinal fraco) não as tira da tela.

interface Query {
  data: unknown;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: jest.Mock;
}

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockLists: { current?: Query } = {};

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/data/market', () => ({
  useCreateList: () => ({ mutate: jest.fn(), isPending: false }),
  useShoppingLists: () => mockLists.current,
}));
jest.mock('@/lib/supabase', () => ({ errorMessage: (error: unknown) => String(error) }));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn() }));

const FEIRA = { id: 'l1', name: 'Feira', kind: 'mercado', archived_at: null, created_at: '2026-10-19T12:00:00Z', pending: 2, total: 3, items: [] };
const offline = { code: '', message: 'TypeError: Network request failed', details: '', hint: '' };

let renderer: ReactTestRenderer | undefined;

type Rendered = ReturnType<ReactTestRenderer['toJSON']> | string;
const texts = (node: Rendered): string[] =>
  node == null ? [] : typeof node === 'string' ? [node] : Array.isArray(node) ? node.flatMap(texts) : (node.children ?? []).flatMap(texts);

async function mount(query: Query) {
  mockLists.current = query;
  await act(async () => {
    renderer = create(<ShoppingListsPanel />);
  });
  return texts(renderer!.toJSON()).join('\n');
}

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('o painel das listas quando a busca falha', () => {
  it('com as listas guardadas: elas ficam, com o aviso em cima', async () => {
    const refetch = jest.fn();
    const page = await mount({ data: [FEIRA], isPending: false, isError: true, error: offline, refetch });
    expect(renderer!.root.findAllByType(ErrorNotice)).toHaveLength(0);
    expect(page).toContain('Feira');
    expect(page).toContain('2 de 3 itens pendentes');
    expect(page).toContain('Sem internet agora. Mostrando as listas como estavam da última vez.');
    act(() => renderer!.root.findByType(StaleNotice).props.onRetry());
    expect(refetch).toHaveBeenCalled();
  });

  it('sem nenhuma lista guardada: a tela de erro', async () => {
    await mount({ data: undefined, isPending: false, isError: true, error: offline, refetch: jest.fn() });
    expect(renderer!.root.findAllByType(ErrorNotice)).toHaveLength(1);
  });

  it('com a busca dando certo, nenhum aviso', async () => {
    await mount({ data: [FEIRA], isPending: false, isError: false, error: null, refetch: jest.fn() });
    expect(renderer!.root.findAllByType(StaleNotice)).toHaveLength(0);
  });
});
