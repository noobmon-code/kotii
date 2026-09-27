import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { dehydrate, hydrate, MutationObserver, onlineManager, QueryClient } from '@tanstack/react-query';

import { newToggleToken, onListItemsChange, registerListMutations, TOGGLE_ITEM_KEY, type ToggleItemInput } from '../market';

const sent: { id: string; token: string; values: unknown }[] = [];

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: (values: unknown) => ({
        eq: (_idColumn: string, id: string) => ({
          eq: async (_tokenColumn: string, token: string) => {
            sent.push({ id, token, values });
            return { data: null, error: null };
          },
        }),
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
    tap(queryClient, { id: 'arroz', checked: true, userId: 'u1', at: '2026-09-27T10:00:00Z', token: 't0', nextToken: 't1' });
    tap(queryClient, { id: 'arroz', checked: false, userId: 'u1', at: '2026-09-27T10:01:00Z', token: 't1', nextToken: 't2' });
    await flush();
    expect(sent).toEqual([]);
    expect(queryClient.getMutationCache().getAll().every((m) => m.state.isPaused)).toBe(true);

    onlineManager.setOnline(true);
    await queryClient.resumePausedMutations();
    await flush();
    expect(sent).toEqual([
      { id: 'arroz', token: 't0', values: { checked_at: '2026-09-27T10:00:00Z', checked_by: 'u1', toggle_token: 't1' } },
      { id: 'arroz', token: 't1', values: { checked_at: null, checked_by: null, toggle_token: 't2' } },
    ]);
  });

  it('a fila sobrevive a fechar e abrir o app', async () => {
    onlineManager.setOnline(false);
    const before = client();
    tap(before, { id: 'leite', checked: true, userId: 'u1', at: '2026-09-27T11:00:00Z', token: 't0', nextToken: 't1' });
    await flush();
    const saved = JSON.parse(JSON.stringify(dehydrate(before)));

    const after = client();
    hydrate(after, saved);
    onlineManager.setOnline(true);
    await after.resumePausedMutations();
    await flush();
    expect(sent).toEqual([
      { id: 'leite', token: 't0', values: { checked_at: '2026-09-27T11:00:00Z', checked_by: 'u1', toggle_token: 't1' } },
    ]);
  });

  it('fila restaurada: busca a lista uma vez só, depois da última marcação', async () => {
    onlineManager.setOnline(false);
    const before = client();
    tap(before, { id: 'arroz', checked: true, userId: 'u1', at: '2026-09-27T10:00:00Z', token: 'a0', nextToken: 'a1' });
    tap(before, { id: 'feijao', checked: true, userId: 'u1', at: '2026-09-27T10:01:00Z', token: 'f0', nextToken: 'f1' });
    await flush();
    const saved = JSON.parse(JSON.stringify(dehydrate(before)));

    const after = client();
    const invalidate = jest.spyOn(after, 'invalidateQueries');
    hydrate(after, saved);
    onlineManager.setOnline(true);
    await after.resumePausedMutations();
    await flush();
    expect(sent.map((s) => s.id)).toEqual(['arroz', 'feijao']);
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([['lists'], ['listItems']]);
  });

  it('mudança em tempo real com marcação na fila espera a fila acabar', async () => {
    onlineManager.setOnline(false);
    const queryClient = client();
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    const keys = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    tap(queryClient, { id: 'arroz', checked: true, userId: 'u1', at: '2026-09-27T10:00:00Z', token: 'a0', nextToken: 'a1' });
    await flush();

    onListItemsChange(queryClient, 'mercado');
    expect(keys()).toEqual([]);

    onlineManager.setOnline(true);
    await queryClient.resumePausedMutations();
    await flush();
    expect(keys()).toEqual([['lists'], ['listItems']]);

    invalidate.mockClear();
    onListItemsChange(queryClient, 'mercado');
    expect(keys()).toEqual([['listItems', 'mercado'], ['lists']]);
  });

  it('cada marcação ganha um selo novo, no formato uuid', () => {
    const a = newToggleToken();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newToggleToken()).not.toBe(a);
  });
});
