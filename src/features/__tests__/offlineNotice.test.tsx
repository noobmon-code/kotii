import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { MutationObserver, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ADD_ITEM_KEY, CLEAR_CHECKED_KEY, registerListMutations, TOGGLE_ITEM_KEY } from '@/data/market';
import { OfflineNotice } from '@/features/OfflineNotice';

// O aviso da lista sem internet, com a fila de verdade: o que ele conta é o que está parado esperando a conexão.

jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } }, error: null }) } },
  unwrap: (result: { data: unknown }) => result.data,
}));
jest.mock('@/data/listPhotos', () => ({ LIST_PHOTO_KEY: ['listItemPhoto'] }));
// Os desenhos animados (reanimated) e o fundo não entram no que se confere aqui.
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));

let renderer: ReactTestRenderer | undefined;
const clients: QueryClient[] = [];

type Rendered = ReturnType<ReactTestRenderer['toJSON']> | string;
const texts = (node: Rendered): string[] =>
  node == null ? [] : typeof node === 'string' ? [node] : Array.isArray(node) ? node.flatMap(texts) : (node.children ?? []).flatMap(texts);

async function show(client: QueryClient) {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <OfflineNotice />
      </QueryClientProvider>,
    );
  });
  return texts(renderer!.toJSON()).join('');
}

function queue(client: QueryClient, mutationKey: string[], variables: unknown) {
  new MutationObserver(client, { mutationKey }).mutate(variables as never).catch(() => undefined);
}

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  // A fila parada nunca termina: sem prazo de limpeza, ela não fica reagendando a limpeza (o que seguraria o Jest).
  for (const client of clients.splice(0)) {
    client.getMutationCache().getAll().forEach((m) => m.setOptions({ ...m.options, gcTime: Infinity }));
    client.clear();
  }
  onlineManager.setOnline(true);
});

describe('aviso de sem internet na lista', () => {
  it('conta o limpar e os itens postos que esperam a conexão', async () => {
    onlineManager.setOnline(false);
    const client = new QueryClient({ defaultOptions: { mutations: { gcTime: 0 } } });
    registerListMutations(client);
    clients.push(client);
    queue(client, ADD_ITEM_KEY, { id: 'i1', listId: 'l1', userId: 'u1', token: 't', name: 'Café', category: 'mercearia', productId: null, quantity: 1, unit: 'un' });
    queue(client, TOGGLE_ITEM_KEY, { id: 'i1', checked: true, userId: 'u1', at: '', token: 't', nextToken: 't2' });
    queue(client, CLEAR_CHECKED_KEY, { listId: 'l1', userId: 'u1', items: [{ id: 'i1', token: 't2' }] });
    expect(await show(client)).toContain('Sem internet. Esperando a conexão: 1 item novo, 1 marcação e 1 limpeza do carrinho.');
  });

  it('sem nada na fila, diz o que dá para fazer sem internet', async () => {
    onlineManager.setOnline(false);
    const client = new QueryClient();
    clients.push(client);
    expect(await show(client)).toContain(
      'Sem internet. Pode pôr e tirar itens, marcar, mudar os detalhes e limpar o carrinho: vai tudo quando a conexão voltar.',
    );
  });

  it('com internet e nada na fila, não aparece', async () => {
    const client = new QueryClient();
    clients.push(client);
    expect(await show(client)).toBe('');
  });
});
