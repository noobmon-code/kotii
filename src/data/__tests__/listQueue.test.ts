import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { dehydrate, hydrate, MutationObserver, onlineManager, QueryClient, QueryObserver } from '@tanstack/react-query';

import {
  CLEAR_CHECKED_KEY,
  type ClearCheckedInput,
  ForeignToggleError,
  newToggleToken,
  onListItemsChange,
  registerListMutations,
  SessionPendingError,
  TOGGLE_ITEM_KEY,
  type ToggleItemInput,
  unlessListQueueBusy,
} from '../market';

const sent: { id: string; token: string; values: unknown }[] = [];
const auth = { signedIn: true };
/** Segura o envio das marcações até `release` (para ver o que acontece no meio). */
const hold: { gate?: Promise<void>; release?: () => void } = {};

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: auth.signedIn ? { user: { id: 'u1' } } : null }, error: null }) },
    from: () => ({
      delete: () => ({
        in: (_idColumn: string, ids: string[]) => ({
          in: async (_tokenColumn: string, tokens: string[]) => {
            sent.push({ id: `limpar:${ids.join(',')}`, token: tokens.join(','), values: null });
            await hold.gate;
            return { data: null, error: null };
          },
        }),
      }),
      update: (values: unknown) => ({
        eq: (_idColumn: string, id: string) => ({
          eq: async (_tokenColumn: string, token: string) => {
            sent.push({ id, token, values });
            await hold.gate;
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
  // Como no app (lib/queryClient): fora da fila, as ações não esperam a conexão.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0, networkMode: 'always' } },
  });
  registerListMutations(queryClient);
  clients.push(queryClient);
  return queryClient;
}

function tap(queryClient: QueryClient, input: ToggleItemInput) {
  const observer = new MutationObserver<unknown, Error, ToggleItemInput>(queryClient, { mutationKey: TOGGLE_ITEM_KEY });
  observer.mutate(input).catch(() => undefined);
}

/** Toque em "Limpar" com o carrinho que a tela mostrava (itens e selos). */
function clear(queryClient: QueryClient, items: { id: string; token: string }[], userId = 'u1') {
  const observer = new MutationObserver<unknown, Error, ClearCheckedInput>(queryClient, { mutationKey: CLEAR_CHECKED_KEY });
  observer.mutate({ listId: 'mercado', userId, items }).catch(() => undefined);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  hold.release?.();
  hold.gate = undefined;
  jest.useRealTimers();
  sent.length = 0;
  auth.signedIn = true;
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

  it('sem sessão válida (token vencido), não envia e tenta de novo depois', async () => {
    jest.useFakeTimers();
    auth.signedIn = false;
    const queryClient = client();
    tap(queryClient, { id: 'arroz', checked: true, userId: 'u1', at: '2026-09-27T10:00:00Z', token: 'a0', nextToken: 'a1' });
    await jest.advanceTimersByTimeAsync(60_000);
    expect(sent).toEqual([]);
    const [mutation] = queryClient.getMutationCache().getAll();
    expect(mutation.state.status).toBe('pending');
    expect(mutation.state.failureReason).toBeInstanceOf(SessionPendingError);

    auth.signedIn = true;
    await jest.advanceTimersByTimeAsync(15_000);
    expect(sent.map((s) => s.id)).toEqual(['arroz']);
  });

  it('marcação de outra conta não sai com a sessão de quem entrou', async () => {
    const queryClient = client();
    tap(queryClient, { id: 'arroz', checked: true, userId: 'outra-conta', at: '2026-09-27T10:00:00Z', token: 'a0', nextToken: 'a1' });
    await flush();
    expect(sent).toEqual([]);
    const [mutation] = queryClient.getMutationCache().getAll();
    expect(mutation.state.status).toBe('error');
    expect(mutation.state.failureCount).toBe(1);
    expect(mutation.state.error).toBeInstanceOf(ForeignToggleError);
  });

  it('com marcação na fila, buscar a lista devolve o cache; a busca de verdade vem no fim', async () => {
    hold.gate = new Promise((resolve) => (hold.release = resolve));
    const queryClient = client();
    const cached = [{ id: 'arroz', checked_at: '2026-09-27T10:00:00Z' }];
    queryClient.setQueryData(['listItems', 'mercado'], cached);
    const queuedWhenFetched: number[] = [];
    const fetchFromServer = jest.fn(async () => {
      queuedWhenFetched.push(queryClient.isMutating({ mutationKey: TOGGLE_ITEM_KEY }));
      return [{ id: 'arroz', checked_at: '2026-09-27T10:00:00Z' }];
    });
    const observer = new QueryObserver(queryClient, {
      queryKey: ['listItems', 'mercado'],
      queryFn: unlessListQueueBusy(fetchFromServer),
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    tap(queryClient, { id: 'arroz', checked: true, userId: 'u1', at: '2026-09-27T10:00:00Z', token: 'a0', nextToken: 'a1' });
    await flush();

    // Puxar para atualizar com a marcação ainda indo: nada vem do servidor.
    expect(sent.map((s) => s.id)).toEqual(['arroz']);
    expect(await observer.refetch().then((r) => r.data)).toBe(cached);
    expect(fetchFromServer).not.toHaveBeenCalled();

    hold.release?.();
    await flush();
    await flush();
    // A fila acabou: uma busca de verdade, já sem marcação pendente.
    expect(queuedWhenFetched).toEqual([0]);
    unsubscribe();
  });

  it('sem nada no cache, busca do servidor mesmo com a fila', async () => {
    onlineManager.setOnline(false);
    const queryClient = client();
    tap(queryClient, { id: 'arroz', checked: true, userId: 'u1', at: '2026-09-27T10:00:00Z', token: 'a0', nextToken: 'a1' });
    await flush();
    const fetchFromServer = jest.fn(async () => ['do servidor']);
    const data = await unlessListQueueBusy(fetchFromServer)({ client: queryClient, queryKey: ['lists'] } as never);
    expect(data).toEqual(['do servidor']);
  });

  it('limpar o carrinho espera as marcações que vieram antes, mesmo depois de reabrir o app', async () => {
    onlineManager.setOnline(false);
    const before = client();
    tap(before, { id: 'arroz', checked: true, userId: 'u1', at: '2026-09-27T10:00:00Z', token: 'a0', nextToken: 'a1' });
    // O carrinho na tela já mostra o arroz, com o selo novo da marcação.
    clear(before, [{ id: 'arroz', token: 'a1' }]);
    await flush();
    expect(sent).toEqual([]);
    const saved = JSON.parse(JSON.stringify(dehydrate(before)));

    const after = client();
    hydrate(after, saved);
    onlineManager.setOnline(true);
    await after.resumePausedMutations();
    await flush();
    expect(sent.map((s) => s.id)).toEqual(['arroz', 'limpar:arroz']);
    expect(sent[1].token).toBe('a1');
  });

  it('limpar sem internet espera a conexão, mesmo sem marcações antes', async () => {
    onlineManager.setOnline(false);
    const queryClient = client();
    clear(queryClient, [{ id: 'arroz', token: 'a1' }]);
    await flush();
    expect(sent).toEqual([]);
    const [mutation] = queryClient.getMutationCache().getAll();
    expect(mutation.state.isPaused).toBe(true);
    expect(dehydrate(queryClient).mutations).toHaveLength(1);

    onlineManager.setOnline(true);
    await queryClient.resumePausedMutations();
    await flush();
    expect(sent.map((s) => s.id)).toEqual(['limpar:arroz']);
  });

  it('limpar sem sessão válida não sai com a chave pública', async () => {
    jest.useFakeTimers();
    auth.signedIn = false;
    const queryClient = client();
    clear(queryClient, [{ id: 'arroz', token: 'a1' }]);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(sent).toEqual([]);
    auth.signedIn = true;
    await jest.advanceTimersByTimeAsync(15_000);
    expect(sent.map((s) => s.id)).toEqual(['limpar:arroz']);
  });

  it('limpar leva só o que estava no carrinho no toque, com os selos', async () => {
    const queryClient = client();
    clear(queryClient, [
      { id: 'arroz', token: 'a1' },
      { id: 'leite', token: 'l3' },
    ]);
    await flush();
    expect(sent).toEqual([{ id: 'limpar:arroz,leite', token: 'a1,l3', values: null }]);
  });

  it('limpar de outra conta não sai com a sessão de quem entrou', async () => {
    const queryClient = client();
    clear(queryClient, [{ id: 'arroz', token: 'a1' }], 'outra-conta');
    await flush();
    expect(sent).toEqual([]);
    const [mutation] = queryClient.getMutationCache().getAll();
    expect(mutation.state.error).toBeInstanceOf(ForeignToggleError);
    expect(mutation.state.failureCount).toBe(1);
  });

  it('marcação tocada com o limpar andando espera ele terminar', async () => {
    hold.gate = new Promise((resolve) => (hold.release = resolve));
    const queryClient = client();
    clear(queryClient, [{ id: 'arroz', token: 'a1' }]);
    await flush();
    tap(queryClient, { id: 'feijao', checked: true, userId: 'u1', at: '2026-09-27T10:02:00Z', token: 'f0', nextToken: 'f1' });
    await flush();
    expect(sent.map((s) => s.id)).toEqual(['limpar:arroz']);
    hold.release?.();
    await flush();
    await flush();
    expect(sent.map((s) => s.id)).toEqual(['limpar:arroz', 'feijao']);
  });

  it('cada marcação ganha um selo novo, no formato uuid', () => {
    const a = newToggleToken();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newToggleToken()).not.toBe(a);
  });
});
