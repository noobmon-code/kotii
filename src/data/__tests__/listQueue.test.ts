import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { dehydrate, hydrate, MutationObserver, onlineManager, QueryClient } from '@tanstack/react-query';

import { registerListMutations, TOGGLE_ITEM_KEY, type ToggleItemInput } from '../market';

const sent: { id: string; values: unknown }[] = [];

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: (values: unknown) => ({
        eq: async (_column: string, id: string) => {
          sent.push({ id, values });
          return { data: null, error: null };
        },
      }),
    }),
  },
  unwrap: (result: { data: unknown }) => result.data,
}));

const clients: QueryClient[] = [];

function client() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  registerListMutations(queryClient);
  clients.push(queryClient);
  return queryClient;
}

function tap(queryClient: QueryClient, input: ToggleItemInput) {
  const observer = new MutationObserver<unknown, Error, ToggleItemInput>(queryClient, { mutationKey: TOGGLE_ITEM_KEY });
  observer.mutate(input).catch(() => undefined);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  sent.length = 0;
  onlineManager.setOnline(true);
  // Sem isso, os timers de limpeza do cache seguram o Jest aberto.
  for (const queryClient of clients.splice(0)) queryClient.clear();
});

describe('fila de marcações da lista', () => {
  it('sem internet, guarda as marcações e envia na ordem quando volta', async () => {
    onlineManager.setOnline(false);
    const queryClient = client();
    tap(queryClient, { id: 'arroz', checked: true, userId: 'u1', at: '2026-09-27T10:00:00Z' });
    tap(queryClient, { id: 'arroz', checked: false, userId: 'u1', at: '2026-09-27T10:01:00Z' });
    await flush();
    expect(sent).toEqual([]);
    expect(queryClient.getMutationCache().getAll().every((m) => m.state.isPaused)).toBe(true);

    onlineManager.setOnline(true);
    await queryClient.resumePausedMutations();
    await flush();
    expect(sent).toEqual([
      { id: 'arroz', values: { checked_at: '2026-09-27T10:00:00Z', checked_by: 'u1', toggled_at: '2026-09-27T10:00:00Z' } },
      { id: 'arroz', values: { checked_at: null, checked_by: null, toggled_at: '2026-09-27T10:01:00Z' } },
    ]);
  });

  it('a fila sobrevive a fechar e abrir o app', async () => {
    onlineManager.setOnline(false);
    const before = client();
    tap(before, { id: 'leite', checked: true, userId: 'u1', at: '2026-09-27T11:00:00Z' });
    await flush();
    const saved = JSON.parse(JSON.stringify(dehydrate(before)));

    const after = client();
    hydrate(after, saved);
    onlineManager.setOnline(true);
    await after.resumePausedMutations();
    await flush();
    expect(sent).toEqual([
      { id: 'leite', values: { checked_at: '2026-09-27T11:00:00Z', checked_by: 'u1', toggled_at: '2026-09-27T11:00:00Z' } },
    ]);
  });
});
