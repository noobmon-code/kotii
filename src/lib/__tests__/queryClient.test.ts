import { afterAll, afterEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onlineManager } from '@tanstack/react-query';

import { cacheOwners, forgetCache, queryClient, saveNow, setSessionValid } from '../queryClient';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const network: { listener?: (state: { isConnected: boolean; isInternetReachable: boolean }) => void } = {};
jest.mock('expo-network', () => ({
  addNetworkStateListener: (listener: typeof network.listener) => {
    network.listener = listener;
    return { remove: () => undefined };
  },
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
