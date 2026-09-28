import { afterAll, afterEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onlineManager } from '@tanstack/react-query';

import { TOGGLE_ITEM_KEY } from '@/data/market';

import { cacheOwners, forgetCache, persistOptions, queryClient, saveNow, setSessionValid } from '../queryClient';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

type NetworkState = { isConnected: boolean; isInternetReachable: boolean };
const network: { listener?: (state: NetworkState) => void; current?: Promise<NetworkState> } = {};
jest.mock('expo-network', () => ({
  addNetworkStateListener: (listener: typeof network.listener) => {
    network.listener = listener;
    return { remove: () => undefined };
  },
  getNetworkStateAsync: () => network.current ?? Promise.resolve({ isConnected: true, isInternetReachable: true }),
}));

jest.mock('@/lib/supabase', () => ({ supabase: {}, unwrap: (result: { data: unknown }) => result.data }));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const stored = () => AsyncStorage.getItem('nooky:query-cache');

afterEach(() => {
  queryClient.clear();
  setSessionValid(true);
  network.listener?.({ isConnected: true, isInternetReachable: true });
});

afterAll(() => {
  queryClient.clear();
});

/** O módulo de novo, do zero, como num app que acabou de abrir. */
function openApp() {
  const main = network.listener;
  let modules!: { onlineManager: typeof onlineManager; queryClient: typeof queryClient };
  jest.isolateModules(() => {
    modules = {
      onlineManager: jest.requireActual<{ onlineManager: typeof onlineManager }>('@tanstack/react-query').onlineManager,
      queryClient: jest.requireActual<{ queryClient: typeof queryClient }>('../queryClient').queryClient,
    };
  });
  // O app novo ouve a rede por conta própria; os outros testes seguem com o do módulo principal.
  const listener = network.listener;
  network.listener = main;
  return { ...modules, listener };
}

describe('conexão ao abrir o app', () => {
  it('aberto já sem rede, começa sem internet', async () => {
    network.current = Promise.resolve({ isConnected: false, isInternetReachable: false });
    const app = openApp();
    await flush();
    expect(app.onlineManager.isOnline()).toBe(false);
    network.current = undefined;
    app.queryClient.clear();
  });

  it('um evento que chega antes do estado inicial não é desfeito por ele', async () => {
    let resolve!: (state: NetworkState) => void;
    network.current = new Promise((r) => (resolve = r));
    const app = openApp();
    app.listener?.({ isConnected: true, isInternetReachable: true });
    resolve({ isConnected: false, isInternetReachable: false });
    await flush();
    expect(app.onlineManager.isOnline()).toBe(true);
    network.current = undefined;
    app.queryClient.clear();
  });
});

describe('cache guardado no aparelho', () => {
  it('só conta como dona do cache a casa que tem dados', () => {
    // Antes de a sessão chegar, a tela já cria ['household', undefined], vazia.
    queryClient.getQueryCache().build(queryClient, { queryKey: ['household', undefined] });
    queryClient.setQueryData(['household', 'u1'], { household: { id: 'h1' } });
    expect(cacheOwners()).toEqual(['u1']);
  });

  it('sair da conta apaga o cache do aparelho na hora', async () => {
    queryClient.setQueryData(['lists'], [{ id: 'l1', name: 'Compras da semana' }]);
    saveNow();
    await flush();
    expect(await stored()).toContain('Compras da semana');

    forgetCache();
    await flush();
    expect(await stored()).toBeNull();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('as marcações da fila também dizem de quem é o cache', () => {
    queryClient.setQueryData(['household', 'u1'], { household: { id: 'h1' } });
    queryClient.getMutationCache().build(queryClient, { mutationKey: TOGGLE_ITEM_KEY, gcTime: 0 }, {
      variables: { id: 'i1', checked: true, userId: 'u2', at: '', token: 't0', nextToken: 't1' },
    } as never);
    expect(cacheOwners()).toEqual(['u1', 'u2']);
  });

  it('sair da conta descarta também a gravação que esperava o intervalo', async () => {
    jest.useFakeTimers();
    queryClient.setQueryData(['lists'], [{ id: 'l1', name: 'Compras da semana' }]);
    // O que o PersistQueryClientProvider faz a cada mudança: gravar com intervalo.
    persistOptions.persister.persistClient({ buster: '1', timestamp: Date.now(), clientState: { queries: [], mutations: [] } });
    forgetCache();
    await jest.advanceTimersByTimeAsync(5000);
    jest.useRealTimers();
    expect(await stored()).toBeNull();
  });

  it('com a sessão vencida, fica como sem internet até ela ser renovada', () => {
    expect(onlineManager.isOnline()).toBe(true);
    setSessionValid(false);
    expect(onlineManager.isOnline()).toBe(false);
    // A rede volta, mas o token ainda não foi renovado.
    network.listener?.({ isConnected: true, isInternetReachable: true });
    expect(onlineManager.isOnline()).toBe(false);
    setSessionValid(true);
    expect(onlineManager.isOnline()).toBe(true);
    network.listener?.({ isConnected: false, isInternetReachable: false });
    expect(onlineManager.isOnline()).toBe(false);
  });
});
