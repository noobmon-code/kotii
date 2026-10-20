import { afterEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { dehydrate, hydrate, MutationObserver, onlineManager, QueryClient } from '@tanstack/react-query';

import { keepPendingPhoto, LIST_PHOTO_KEY, type ListPhotoInput, pendingPhotoUri, registerListPhotoMutations } from '../listPhotos';
import { ADD_ITEM_KEY, REMOVE_ITEM_KEY } from '../market';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../images', () => ({ prepareImage: async () => 'QUJD' }));

const calls: string[] = [];
const server: { uploadStatus?: number; updated: number; signedIn: boolean } = { updated: 1, signedIn: true };

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: server.signedIn ? { user: { id: 'u1' } } : null }, error: null }),
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          calls.push(`upload ${bucket}/${path}`);
          return server.uploadStatus
            ? { data: null, error: { statusCode: String(server.uploadStatus), message: 'falhou' } }
            : { data: { path }, error: null };
        },
        remove: async (paths: string[]) => {
          calls.push(`remove ${bucket}/${paths.join(',')}`);
          return { data: [], error: null };
        },
      }),
    },
    from: (table: string) => ({
      update: (values: { photo_path: string }) => ({
        eq: (_column: string, id: string) => ({
          select: async () => {
            calls.push(`update ${table} ${id} ${values.photo_path}`);
            return { data: Array.from({ length: server.updated }, () => ({ id })), error: null };
          },
        }),
      }),
      select: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
    }),
  },
  unwrap: (result: { data: unknown; error: unknown }) => {
    if (result.error) throw result.error;
    return result.data;
  },
}));

const clients: QueryClient[] = [];

function client() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0, networkMode: 'always' } },
  });
  registerListPhotoMutations(queryClient);
  clients.push(queryClient);
  return queryClient;
}

function send(queryClient: QueryClient, input: ListPhotoInput) {
  const observer = new MutationObserver<unknown, Error, ListPhotoInput>(queryClient, { mutationKey: LIST_PHOTO_KEY });
  return observer.mutate(input).catch(() => undefined);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const input = (photoKey: string, userId = 'u1'): ListPhotoInput => ({
  itemId: 'sabao',
  listId: 'mercado',
  householdId: 'casa',
  userId,
  photoKey,
});

afterEach(async () => {
  calls.length = 0;
  server.uploadStatus = undefined;
  server.updated = 1;
  server.signedIn = true;
  onlineManager.setOnline(true);
  await AsyncStorage.clear();
  for (const queryClient of clients.splice(0)) queryClient.clear();
});

describe('fila de fotos da lista', () => {
  it('sem internet, guarda a foto no aparelho e sobe quando a conexão volta, mesmo depois de reabrir o app', async () => {
    onlineManager.setOnline(false);
    const key = await keepPendingPhoto('file://foto.jpg');
    expect(await pendingPhotoUri(key)).toBe('data:image/jpeg;base64,QUJD');

    const before = client();
    void send(before, input(key));
    await flush();
    expect(calls).toEqual([]);

    // Fecha e abre o app: a fila guardada volta e sai com a conexão.
    const after = client();
    hydrate(after, JSON.parse(JSON.stringify(dehydrate(before))));
    onlineManager.setOnline(true);
    await after.resumePausedMutations();
    await flush();

    expect(calls).toEqual([`upload documents/casa/item-${key}.jpg`, `update shopping_list_items sabao casa/item-${key}.jpg`]);
    expect(await pendingPhotoUri(key)).toBeNull();
  });

  it('a foto que subiu já aparece no item da lista guardada, antes de a lista ser buscada de novo', async () => {
    const key = await keepPendingPhoto('file://foto.jpg');
    const queryClient = client();
    // Como a lista na tela: fica no cache (o cliente de teste descarta o que ninguém observa).
    queryClient.setQueryDefaults(['listItems'], { gcTime: Infinity });
    queryClient.setQueryData(['listItems', 'mercado'], [{ id: 'sabao', photo_path: null }, { id: 'arroz', photo_path: null }]);
    await send(queryClient, input(key));
    await flush();
    expect(queryClient.getQueryData(['listItems', 'mercado'])).toEqual([
      { id: 'sabao', photo_path: `casa/item-${key}.jpg` },
      { id: 'arroz', photo_path: null },
    ]);
  });

  it('item que já saiu da lista não ganha foto na lista guardada', async () => {
    const key = await keepPendingPhoto('file://foto.jpg');
    server.updated = 0;
    const queryClient = client();
    // Como a lista na tela: fica no cache (o cliente de teste descarta o que ninguém observa).
    queryClient.setQueryDefaults(['listItems'], { gcTime: Infinity });
    queryClient.setQueryData(['listItems', 'mercado'], [{ id: 'sabao', photo_path: null }]);
    await send(queryClient, input(key));
    await flush();
    expect(queryClient.getQueryData(['listItems', 'mercado'])).toEqual([{ id: 'sabao', photo_path: null }]);
  });

  it('o envio repetido depois de a foto já ter subido só grava no item', async () => {
    const key = await keepPendingPhoto('file://foto.jpg');
    server.uploadStatus = 409;
    await send(client(), input(key));
    expect(calls).toEqual([`upload documents/casa/item-${key}.jpg`, `update shopping_list_items sabao casa/item-${key}.jpg`]);
  });

  it('item que saiu da lista enquanto a foto esperava: o arquivo enviado é apagado', async () => {
    const key = await keepPendingPhoto('file://foto.jpg');
    server.updated = 0;
    await send(client(), input(key));
    expect(calls).toEqual([
      `upload documents/casa/item-${key}.jpg`,
      `update shopping_list_items sabao casa/item-${key}.jpg`,
      `remove documents/casa/item-${key}.jpg`,
    ]);
    expect(await pendingPhotoUri(key)).toBeNull();
  });

  it('foto que já não está no aparelho não sobe nada', async () => {
    await send(client(), input('sumiu'));
    expect(calls).toEqual([]);
  });

  it('foto tirada por outra conta neste aparelho não sai com a sessão de quem entrou', async () => {
    const key = await keepPendingPhoto('file://foto.jpg');
    await send(client(), input(key, 'outra'));
    await flush();
    expect(calls).toEqual([]);
    expect(await pendingPhotoUri(key)).not.toBeNull();
  });
});

describe('a foto que espera internet de um item tirado da lista', () => {
  /** O tirar da fila da lista, com o que o servidor respondeu (as linhas apagadas). */
  function removeItem(queryClient: QueryClient, rows: { id: string }[]) {
    const observer = new MutationObserver<unknown, Error, { id: string }>(queryClient, {
      mutationKey: REMOVE_ITEM_KEY,
      networkMode: 'always',
      mutationFn: async () => rows,
    });
    return observer.mutate({ id: 'sabao' });
  }
  const waitingPhotos = (queryClient: QueryClient) => queryClient.getMutationCache().findAll({ mutationKey: LIST_PHOTO_KEY }).length;

  it('sai só quando o item sai de verdade: o tirar que não apagou nada (o item foi para o carrinho) deixa a foto', async () => {
    onlineManager.setOnline(false);
    const key = await keepPendingPhoto('file://foto.jpg');
    const queryClient = client();
    void send(queryClient, input(key));
    await flush();
    expect(waitingPhotos(queryClient)).toBe(1);

    await removeItem(queryClient, []);
    expect(waitingPhotos(queryClient)).toBe(1);
    expect(await pendingPhotoUri(key)).not.toBeNull();

    await removeItem(queryClient, [{ id: 'sabao' }]);
    await flush();
    expect(waitingPhotos(queryClient)).toBe(0);
    expect(await pendingPhotoUri(key)).toBeNull();
    expect(calls).toEqual([]);
  });

  it('item posto e tirado sem internet (os dois se cancelaram): a foto dele também sai', async () => {
    onlineManager.setOnline(false);
    const key = await keepPendingPhoto('file://foto.jpg');
    const queryClient = client();
    const add = queryClient.getMutationCache().build(queryClient, { mutationKey: ADD_ITEM_KEY, gcTime: Infinity }, {
      variables: { id: 'sabao' },
      status: 'pending',
      isPaused: true,
    } as never);
    void send(queryClient, input(key));
    await flush();
    queryClient.getMutationCache().remove(add);
    await flush();
    expect(waitingPhotos(queryClient)).toBe(0);
    expect(await pendingPhotoUri(key)).toBeNull();
  });
});
