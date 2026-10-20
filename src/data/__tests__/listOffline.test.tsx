import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { dehydrate, hydrate, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { resumeInFlight } from '@/lib/cachePersister';
import type { ShoppingListItem } from '@/lib/types';

import {
  loadListLinks,
  queuedAddSettled,
  registerListMutations,
  TOGGLE_ITEM_KEY,
  useAddListItem,
  useClearCheckedItems,
  useEditListItem,
  useRemoveListItem,
  useShoppingList,
  useShoppingLists,
  useToggleListItem,
} from '../market';

// No mercado sem sinal: pôr, marcar, editar e tirar itens e limpar o carrinho entram na fila guardada, aparecem
// (ou somem) na tela na hora e vão ao servidor na ordem quando a conexão volta. Os hooks de verdade, num
// QueryClient de verdade; só o banco é de mentira.

interface Sent {
  op: string;
  table: string;
  values?: Record<string, unknown>;
  filters: [string, string, unknown][];
}

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockDb = {
  sent: [] as Sent[],
  /** Respostas por operação, na ordem; sem resposta, dá certo. */
  replies: [] as { op: string; reply: { data: unknown; error: unknown } }[],
  /** As listas abertas, com os itens, como o servidor devolve o resumo. */
  lists: [] as Record<string, unknown>[],
  gate: undefined as Promise<void> | undefined,
  /** O que o portão segura (a marcação, sem dizer outra coisa). */
  gateOps: ['update'],
};

jest.mock('@/lib/supabase', () => {
  const request = (table: string) => {
    const sent: Sent = { op: 'select', table, filters: [] };
    let recorded = false;
    const record = () => {
      if (!recorded && sent.op !== 'select') mockDb.sent.push(sent);
      recorded = true;
    };
    const answer = () => {
      record();
      const at = mockDb.replies.findIndex((r) => r.op === sent.op);
      if (at >= 0) return mockDb.replies.splice(at, 1)[0].reply;
      if (sent.op === 'select' && table === 'shopping_lists') return { data: mockDb.lists, error: null };
      if (sent.op === 'select') return { data: [], error: null };
      const id = sent.filters.find(([, column]) => column === 'id')?.[2];
      return { data: sent.op === 'insert' ? null : [{ id }], error: null };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: (values: Record<string, unknown>) => {
        Object.assign(sent, { op: 'insert', values });
        return builder;
      },
      update: (values: Record<string, unknown>) => {
        Object.assign(sent, { op: 'update', values });
        return builder;
      },
      delete: () => {
        sent.op = 'delete';
        return builder;
      },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
        // Uma marcação segura pelo portão: a fila fica andando (no meio do envio) até ele abrir.
        const held = mockDb.gateOps.includes(sent.op) && mockDb.gate ? (record(), mockDb.gate) : Promise.resolve();
        return held.then(answer).then(resolve, reject);
      },
    };
    for (const filter of ['eq', 'is', 'in', 'order', 'limit']) {
      builder[filter] = (column: string, value: unknown) => {
        sent.filters.push([filter, column, value]);
        return builder;
      };
    }
    return builder;
  };
  return {
    supabase: {
      from: request,
      rpc: async (name: string, args: Record<string, unknown>) => {
        mockDb.sent.push({ op: `rpc ${name}`, table: '', values: args, filters: [] });
        return { data: (args.p_ids as string[]).length, error: null };
      },
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } }, error: null }) },
    },
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
  };
});

const item = (id: string, name: string, extra: Partial<ShoppingListItem> = {}): ShoppingListItem => ({
  id,
  list_id: 'l1',
  product_id: null,
  name,
  category: 'mercearia',
  quantity: 1,
  unit: 'un',
  notes: null,
  priority: 'normal',
  photo_path: null,
  checked_at: null,
  checked_by: null,
  toggle_token: `${id}-0`,
  created_at: '2026-10-20T09:00:00Z',
  ...extra,
});

const clients: QueryClient[] = [];
let renderers: ReactTestRenderer[] = [];

function newClient() {
  // Como no app (lib/queryClient): fora da fila, as ações não esperam a conexão; o que está guardado não some.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity }, mutations: { networkMode: 'always', gcTime: 0 } },
  });
  registerListMutations(client);
  clients.push(client);
  return client;
}

/** A lista aberta no aparelho: o resumo e os itens já guardados. */
function openList(client: QueryClient, items: ShoppingListItem[]) {
  client.setQueryData(['listItems', 'l1'], items);
  client.setQueryData(['lists'], [
    {
      id: 'l1',
      name: 'Mercado',
      kind: 'mercado',
      archived_at: null,
      created_at: '2026-10-19T12:00:00Z',
      pending: items.filter((i) => !i.checked_at).length,
      total: items.length,
      items: items.map(({ name, product_id, checked_at }) => ({ name, product_id, checked_at })),
    },
  ]);
}

/** Os hooks da tela da lista, montados como na tela. */
async function listHooks(client: QueryClient) {
  const seen: { current?: ReturnType<typeof useHooks> } = {};
  function useHooks() {
    return {
      add: useAddListItem('l1'),
      toggle: useToggleListItem('l1'),
      edit: useEditListItem('l1'),
      remove: useRemoveListItem('l1'),
      clear: useClearCheckedItems('l1'),
    };
  }
  function Probe() {
    seen.current = useHooks();
    return null;
  }
  await act(async () => {
    renderers.push(create(<QueryClientProvider client={client}><Probe /></QueryClientProvider>));
  });
  return () => seen.current!;
}

const flush = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const names = (client: QueryClient) => (client.getQueryData<ShoppingListItem[]>(['listItems', 'l1']) ?? []).map((i) => i.name);
const summary = (client: QueryClient) => client.getQueryData<{ pending: number; total: number; items: { name: string }[] }[]>(['lists'])?.[0];
const ARROZ = item('arroz', 'Arroz');

beforeEach(() => {
  onlineManager.setOnline(false);
});

afterEach(async () => {
  for (const renderer of renderers) await act(async () => renderer.unmount());
  renderers = [];
  onlineManager.setOnline(true);
  // O que ficou parado na fila sai agora (para o banco de mentira): uma ação parada para sempre segura o Jest.
  for (const client of clients.splice(0)) {
    await act(async () => {
      await client.resumePausedMutations();
    });
    client.clear();
  }
  await flush();
  mockDb.sent = [];
  mockDb.replies = [];
  mockDb.lists = [];
  mockDb.gate = undefined;
  mockDb.gateOps = ['update'];
});

describe('pôr, marcar, editar e tirar sem internet', () => {
  it('aparece na hora; na volta da conexão vai tudo na ordem, mesmo com o app fechado no meio', async () => {
    const before = newClient();
    openList(before, [ARROZ]);
    const hooks = await listHooks(before);
    await act(async () => hooks().add.add({ name: 'Café', category: 'mercearia', productId: null, quantity: 2, unit: 'un' }, 'u1'));
    await flush();
    const cafe = before.getQueryData<ShoppingListItem[]>(['listItems', 'l1'])!.find((i) => i.name === 'Café')!;
    // O item novo está na tela, para comprar, e já conta no resumo das listas.
    expect(names(before)).toEqual(['Arroz', 'Café']);
    expect(cafe).toMatchObject({ checked_at: null, quantity: 2 });
    expect(summary(before)).toMatchObject({ pending: 2, total: 2 });

    // A marcação e a edição do item novo partem do id e do selo gerados no aparelho.
    await act(async () => {
      hooks().toggle.mutate({ id: cafe.id, checked: true, userId: 'u1', at: '2026-10-20T10:00:00Z', token: cafe.toggle_token, nextToken: 'cafe-1' });
      hooks().edit.mutate({ id: cafe.id, listId: 'l1', userId: 'u1', values: { notes: 'Pilão' } });
      hooks().remove.remove({ id: 'arroz', userId: 'u1' });
    });
    await flush();
    expect(names(before)).toEqual(['Café']);
    expect(summary(before)).toMatchObject({ pending: 0, total: 1 });
    expect(mockDb.sent).toEqual([]);

    // O app fecha e abre de novo, ainda sem internet; depois a conexão volta.
    const saved = JSON.parse(JSON.stringify(dehydrate(before)));
    // A tela fecha: o app de antes não vê mais a conexão voltar.
    for (const renderer of renderers.splice(0)) await act(async () => renderer.unmount());
    const after = newClient();
    hydrate(after, saved);
    onlineManager.setOnline(true);
    await act(async () => {
      await after.resumePausedMutations();
    });
    await flush();
    expect(mockDb.sent.map((s) => s.op)).toEqual(['insert', 'update', 'update', 'delete']);
    const [insert, toggle, edit, remove] = mockDb.sent;
    expect(insert.values).toEqual({
      id: cafe.id,
      list_id: 'l1',
      name: 'Café',
      category: 'mercearia',
      product_id: null,
      quantity: 2,
      unit: 'un',
      toggle_token: cafe.toggle_token,
    });
    expect(toggle.filters).toEqual([
      ['eq', 'id', cafe.id],
      ['eq', 'toggle_token', cafe.toggle_token],
    ]);
    expect(edit).toMatchObject({ values: { notes: 'Pilão' }, filters: [['eq', 'id', cafe.id]] });
    expect(remove.filters).toEqual([['eq', 'id', 'arroz']]);
  });

  it('reenviar não duplica: o id já gravado (a resposta é que não chegou) conta como feito', async () => {
    jest.useFakeTimers();
    try {
      const client = newClient();
      openList(client, []);
      const hooks = await listHooks(client);
      onlineManager.setOnline(true);
      // A primeira tentativa chega ao banco, mas a resposta se perde; a segunda esbarra no próprio id.
      mockDb.replies.push(
        { op: 'insert', reply: { data: null, error: { code: '', message: 'TypeError: Network request failed' } } },
        { op: 'insert', reply: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "shopping_list_items_pkey"' } } },
      );
      const onError = jest.fn();
      await act(async () => hooks().add.add({ name: 'Leite', category: 'laticinios', productId: null, quantity: 1, unit: 'l' }, 'u1', { onError }));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000);
      });
      expect(mockDb.sent.map((s) => s.op)).toEqual(['insert', 'insert']);
      expect(mockDb.sent[0].values?.id).toBe(mockDb.sent[1].values?.id);
      expect(onError).not.toHaveBeenCalled();
      expect(client.getMutationCache().getAll().map((m) => m.state.status)).toEqual(['success']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('pôr e tirar o mesmo item antes de a conexão voltar cancela os dois (e o que veio entre eles)', async () => {
    const client = newClient();
    openList(client, [ARROZ]);
    const hooks = await listHooks(client);
    await act(async () => hooks().add.add({ name: 'Café', category: 'mercearia', productId: null, quantity: 1, unit: 'un' }, 'u1'));
    const cafe = client.getQueryData<ShoppingListItem[]>(['listItems', 'l1'])!.find((i) => i.name === 'Café')!;
    await act(async () => {
      hooks().toggle.mutate({ id: cafe.id, checked: true, userId: 'u1', at: '2026-10-20T10:00:00Z', token: cafe.toggle_token, nextToken: 'c1' });
      hooks().toggle.mutate({ id: 'arroz', checked: true, userId: 'u1', at: '2026-10-20T10:01:00Z', token: 'arroz-0', nextToken: 'a1' });
    });
    const removed = jest.fn();
    await act(async () => hooks().remove.remove({ id: cafe.id, userId: 'u1' }, { onSuccess: removed }));
    await flush();
    expect(removed).toHaveBeenCalled();
    expect(names(client)).toEqual(['Arroz']);
    expect(summary(client)).toMatchObject({ total: 1, items: [{ name: 'Arroz' }] });
    // Na fila, só a marcação do arroz.
    expect(client.getMutationCache().getAll().map((m) => [m.options.mutationKey, (m.state.variables as { id: string }).id])).toEqual([
      [TOGGLE_ITEM_KEY, 'arroz'],
    ]);

    onlineManager.setOnline(true);
    await act(async () => {
      await client.resumePausedMutations();
    });
    await flush();
    expect(mockDb.sent.map((s) => [s.op, s.filters[0]?.[2]])).toEqual([['update', 'arroz']]);
  });

  it('a foto de um item posto sem internet só sobe depois de o item chegar ao servidor', async () => {
    const client = newClient();
    openList(client, []);
    const hooks = await listHooks(client);
    await act(async () => hooks().add.add({ name: 'Queijo', category: 'frios', productId: null, quantity: 1, unit: 'un' }, 'u1'));
    const queijo = client.getQueryData<ShoppingListItem[]>(['listItems', 'l1'])![0];
    const order: string[] = [];
    const photo = queuedAddSettled(client, queijo.id).then(() => order.push(`foto (já enviados: ${mockDb.sent.length})`));
    await flush();
    expect(order).toEqual([]);

    onlineManager.setOnline(true);
    await act(async () => {
      await client.resumePausedMutations();
    });
    await photo;
    expect(order).toEqual(['foto (já enviados: 1)']);
    // Item que não está na fila: a foto não espera nada.
    await expect(queuedAddSettled(client, 'outro')).resolves.toBeUndefined();
  });

  it('tirar um item cujo pôr já saiu vai para a fila, depois dele', async () => {
    const client = newClient();
    openList(client, []);
    const hooks = await listHooks(client);
    onlineManager.setOnline(true);
    await act(async () => hooks().add.add({ name: 'Pão', category: 'padaria', productId: null, quantity: 1, unit: 'un' }, 'u1'));
    await flush();
    const pao = mockDb.sent[0].values!.id as string;
    await act(async () => hooks().remove.remove({ id: pao, userId: 'u1', onlyPending: true, plainOnly: true }));
    await flush();
    expect(mockDb.sent.map((s) => s.op)).toEqual(['insert', 'delete']);
    // Pelo catálogo: só apaga o que ainda está para comprar e sem detalhes.
    expect(mockDb.sent[1].filters).toEqual([
      ['eq', 'id', pao],
      ['is', 'checked_at', null],
      ['is', 'notes', null],
      ['is', 'photo_path', null],
      ['eq', 'priority', 'normal'],
    ]);
  });
});

describe('sinal fraco', () => {
  const NETWORK = (message = 'TypeError: Network request failed') => ({ op: 'insert', reply: { data: null, error: { code: '', message } } });
  const leite = { name: 'Leite', category: 'laticinios', productId: null, quantity: 1, unit: 'l' as const };

  afterEach(() => {
    jest.useRealTimers();
  });

  it('com o aparelho dizendo que há internet, o pôr que não chega ao servidor não desiste: o item fica e vai quando der', async () => {
    jest.useFakeTimers();
    const client = newClient();
    openList(client, []);
    const hooks = await listHooks(client);
    onlineManager.setOnline(true);
    mockDb.replies.push(NETWORK(), NETWORK('TypeError: Network request timed out'), NETWORK(), NETWORK(), NETWORK());
    const onError = jest.fn();
    await act(async () => hooks().add.add(leite, 'u1', { onError }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(120_000);
    });
    // Cinco pedidos sem resposta e o sexto chega: nada de aviso de erro, e o item nunca saiu da tela.
    expect(mockDb.sent.map((s) => s.op)).toEqual(['insert', 'insert', 'insert', 'insert', 'insert', 'insert']);
    expect(onError).not.toHaveBeenCalled();
    expect(names(client)).toEqual(['Leite']);
    expect(client.getMutationCache().getAll().map((m) => m.state.status)).toEqual(['success']);
  });

  it('a fila desiste (a lista foi apagada em outro aparelho): o item que apareceu no toque sai da tela e do resumo', async () => {
    jest.useFakeTimers();
    const client = newClient();
    openList(client, [ARROZ]);
    const hooks = await listHooks(client);
    onlineManager.setOnline(true);
    const gone = {
      code: '23503',
      message: 'insert or update on table "shopping_list_items" violates foreign key constraint "shopping_list_items_list_id_fkey"',
    };
    for (let i = 0; i < 4; i++) mockDb.replies.push({ op: 'insert', reply: { data: null, error: gone } });
    const onError = jest.fn();
    await act(async () => hooks().add.add(leite, 'u1', { onError }));
    expect(names(client)).toEqual(['Arroz', 'Leite']);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(mockDb.sent.map((s) => s.op)).toEqual(['insert', 'insert', 'insert', 'insert']);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(names(client)).toEqual(['Arroz']);
    expect(summary(client)).toMatchObject({ pending: 1, total: 1, items: [{ name: 'Arroz' }] });
  });

  it('a resposta do pôr se perdeu e a conexão caiu: tirar o item vai para a fila depois dele (o servidor pode ter gravado)', async () => {
    jest.useFakeTimers();
    const client = newClient();
    openList(client, []);
    const hooks = await listHooks(client);
    onlineManager.setOnline(true);
    mockDb.replies.push(NETWORK());
    await act(async () => hooks().add.add({ ...leite, name: 'Pão', category: 'padaria', unit: 'un' }, 'u1'));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockDb.sent.map((s) => s.op)).toEqual(['insert']);
    const pao = mockDb.sent[0].values!.id as string;
    // O sinal some antes da nova tentativa: o pôr fica parado, esperando a conexão.
    onlineManager.setOnline(false);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    expect(client.getMutationCache().getAll().map((m) => [m.state.isPaused, m.state.failureCount])).toEqual([[true, 1]]);

    await act(async () => hooks().remove.remove({ id: pao, userId: 'u1' }));
    expect(names(client)).toEqual([]);

    // A conexão volta: o pôr esbarra no próprio id (já estava lá) e o tirar apaga a linha.
    mockDb.replies.push({ op: 'insert', reply: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "shopping_list_items_pkey"' } } });
    onlineManager.setOnline(true);
    await act(async () => {
      await client.resumePausedMutations();
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(mockDb.sent.map((s) => s.op)).toEqual(['insert', 'insert', 'delete']);
    expect(mockDb.sent[2].filters).toEqual([['eq', 'id', pao]]);
  });

  it('o app fechado com o pôr ainda no ar: ele volta guardado e sai de novo, com a marcação depois, sem duplicar', async () => {
    onlineManager.setOnline(true);
    // O pedido do pôr fica no ar (sinal fraco) até o fim do teste.
    let release!: () => void;
    mockDb.gate = new Promise((resolve) => (release = resolve));
    mockDb.gateOps = ['insert'];
    const before = newClient();
    openList(before, []);
    const hooks = await listHooks(before);
    await act(async () => hooks().add.add({ ...leite, name: 'Ovos', category: 'mercearia', unit: 'un' }, 'u1'));
    await flush();
    const ovos = before.getQueryData<ShoppingListItem[]>(['listItems', 'l1'])![0];
    await act(async () => {
      hooks().toggle.mutate({ id: ovos.id, checked: true, userId: 'u1', at: '2026-10-20T10:00:00Z', token: ovos.toggle_token, nextToken: 'o1' });
    });
    await flush();
    expect(mockDb.sent.map((s) => s.op)).toEqual(['insert']);

    // Como lib/queryClient guarda a fila: também o que está saindo agora; e volta parado (cachePersister).
    const saved = JSON.parse(JSON.stringify(dehydrate(before, { shouldDehydrateMutation: (m) => m.state.status === 'pending' })));
    for (const renderer of renderers.splice(0)) await act(async () => renderer.unmount());
    const restored = resumeInFlight({ buster: '1', timestamp: 0, clientState: saved })!.clientState;
    mockDb.gate = undefined;
    const after = newClient();
    hydrate(after, restored);
    // O pôr que estava no ar conta como já tentado: tirar o item agora não o cancelaria.
    expect(after.getMutationCache().getAll().map((m) => [m.options.mutationKey?.[0], m.state.isPaused, m.state.failureCount])).toEqual([
      ['addListItem', true, 1],
      ['toggleListItem', true, 0],
    ]);
    mockDb.replies.push({ op: 'insert', reply: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "shopping_list_items_pkey"' } } });
    await act(async () => {
      await after.resumePausedMutations();
    });
    await flush();
    expect(mockDb.sent.map((s) => s.op)).toEqual(['insert', 'insert', 'update']);
    expect(mockDb.sent[1].values?.id).toBe(ovos.id);
    expect(mockDb.sent[2].filters).toEqual([
      ['eq', 'id', ovos.id],
      ['eq', 'toggle_token', ovos.toggle_token],
    ]);
    // O app de antes some de vez (o pedido dele, solto agora, não muda mais nada).
    before.clear();
    release();
    await flush();
  });
});

describe('ligações da lista sem internet ("Limpar" e a geladeira)', () => {
  it('sem internet, não fica esperando a busca: usa as guardadas ou segue sem elas', async () => {
    const client = newClient();
    await expect(loadListLinks(client)).resolves.toBeNull();
    client.setQueryData(['listLinks'], []);
    await expect(loadListLinks(client)).resolves.not.toBeNull();
    expect(mockDb.sent).toEqual([]);
  });
});

describe('limpar o carrinho sem internet', () => {
  it('os itens saem de "No carrinho" na hora; o limpar espera a conexão e leva o histórico junto', async () => {
    const leite = item('leite', 'Leite', { checked_at: '2026-10-20T10:00:00Z', toggle_token: 'leite-1' });
    const client = newClient();
    openList(client, [ARROZ, leite]);
    client.setQueryData(['purchaseRecords'], []);
    const hooks = await listHooks(client);
    const bought = [{ name: 'Leite', category: 'mercearia', productId: null, quantity: 1, unit: 'un' as const, at: '2026-10-20T10:00:00Z', source: 'list' as const }];
    await act(async () => hooks().clear.mutate({ listId: 'l1', userId: 'u1', items: [{ id: 'leite', token: 'leite-1' }], bought }));
    await flush();
    expect(names(client)).toEqual(['Arroz']);
    expect(summary(client)).toMatchObject({ pending: 1, total: 1 });
    expect(mockDb.sent).toEqual([]);
    expect(dehydrate(client).mutations).toHaveLength(1);

    onlineManager.setOnline(true);
    await act(async () => {
      await client.resumePausedMutations();
    });
    await flush();
    expect(mockDb.sent.map((s) => s.op)).toEqual(['rpc clear_checked_items']);
    // A lista já não tem o leite: o histórico vem do que o limpar levou.
    expect(client.getQueryData(['purchaseRecords'])).toEqual(bought);
  });
});

describe('lista que nunca foi aberta neste aparelho', () => {
  const row = (id: string, name: string, items: ShoppingListItem[]) => ({
    id,
    name,
    kind: 'mercado',
    archived_at: null,
    created_at: '2026-10-19T12:00:00Z',
    shopping_list_items: items,
  });

  it('os itens das listas abertas vêm com o resumo e ficam guardados, na ordem; o resumo guarda só o que usa', async () => {
    onlineManager.setOnline(true);
    const feira = [
      item('b', 'Banana', { list_id: 'l2', created_at: '2026-10-20T09:05:00Z' }),
      item('a', 'Alface', { list_id: 'l2', created_at: '2026-10-20T09:00:00Z' }),
    ];
    mockDb.lists = [row('l2', 'Feira', feira)];
    const client = newClient();
    function Probe() {
      useShoppingLists();
      return null;
    }
    await act(async () => {
      renderers.push(create(<QueryClientProvider client={client}><Probe /></QueryClientProvider>));
    });
    await flush();
    expect(client.getQueryData<ShoppingListItem[]>(['listItems', 'l2'])?.map((i) => i.name)).toEqual(['Alface', 'Banana']);
    expect(client.getQueryData(['lists'])).toEqual([
      {
        id: 'l2',
        name: 'Feira',
        kind: 'mercado',
        archived_at: null,
        created_at: '2026-10-19T12:00:00Z',
        pending: 2,
        total: 2,
        items: [
          { name: 'Banana', product_id: null, checked_at: null },
          { name: 'Alface', product_id: null, checked_at: null },
        ],
      },
    ]);
  });

  it('com a fila andando, os itens guardados não são trocados pelos que vieram com o resumo', async () => {
    onlineManager.setOnline(true);
    const client = newClient();
    // A alface foi para o carrinho neste aparelho, e a marcação ainda está saindo.
    client.setQueryData(['listItems', 'l2'], [item('a', 'Alface', { list_id: 'l2', checked_at: '2026-10-20T10:00:00Z' })]);
    let release!: () => void;
    mockDb.gate = new Promise((resolve) => (release = resolve));
    const hooks = await listHooks(client);
    await act(async () => {
      hooks().toggle.mutate({ id: 'a', checked: true, userId: 'u1', at: '2026-10-20T10:00:00Z', token: 'a-0', nextToken: 'a-1' });
    });
    mockDb.lists = [row('l2', 'Feira', [item('a', 'Alface', { list_id: 'l2' })])];
    function Probe() {
      useShoppingLists();
      return null;
    }
    await act(async () => {
      renderers.push(create(<QueryClientProvider client={client}><Probe /></QueryClientProvider>));
    });
    await flush();
    expect(client.getQueryData(['lists'])).toHaveLength(1);
    expect(client.getQueryData<ShoppingListItem[]>(['listItems', 'l2'])?.[0].checked_at).toBe('2026-10-20T10:00:00Z');
    mockDb.gate = undefined;
    release();
    await flush();
  });

  it('sem internet, a lista sai do resumo guardado', async () => {
    const client = newClient();
    openList(client, []);
    const seen: { list?: ReturnType<typeof useShoppingList> } = {};
    function Probe() {
      seen.list = useShoppingList('l1');
      return null;
    }
    await act(async () => {
      renderers.push(create(<QueryClientProvider client={client}><Probe /></QueryClientProvider>));
    });
    expect(seen.list?.data).toEqual({ id: 'l1', name: 'Mercado', kind: 'mercado', archived_at: null, created_at: '2026-10-19T12:00:00Z' });
    expect(seen.list?.isPending).toBe(false);
  });
});
