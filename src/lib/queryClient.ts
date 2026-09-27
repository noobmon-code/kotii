// Cache do app. As listas de compras (e a casa, para o app abrir) ficam
// guardadas no aparelho, para abrir no mercado sem internet; as marcações
// feitas offline ficam numa fila (registerListMutations) que também é
// guardada e sai quando a conexão volta.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { onlineManager, QueryClient } from '@tanstack/react-query';
import type { PersistQueryClientProviderProps } from '@tanstack/react-query-persist-client';
import * as Network from 'expo-network';
import { Platform } from 'react-native';

import { registerListMutations } from '@/data/market';

const WEEK = 1000 * 60 * 60 * 24 * 7;

// O que vai para o aparelho: o mínimo para usar a lista offline.
const PERSISTED = new Set(['household', 'lists', 'list', 'listItems', 'products']);

export const queryClient = new QueryClient({
  defaultOptions: {
    // gcTime cobre o tempo guardado: consulta apagada da memória some do aparelho.
    queries: { staleTime: 30_000, retry: 1, gcTime: WEEK },
    // Fora a fila de marcações, sem internet a ação falha na hora e avisa,
    // em vez de ficar girando.
    mutations: { networkMode: 'always' },
  },
});
registerListMutations(queryClient);

// Na web o navegador avisa quando cai a conexão; no celular, o expo-network.
if (Platform.OS !== 'web') {
  onlineManager.setEventListener((setOnline) => {
    const subscription = Network.addNetworkStateListener((state) =>
      setOnline(state.isConnected !== false && state.isInternetReachable !== false),
    );
    return () => subscription.remove();
  });
}

export const persistOptions: PersistQueryClientProviderProps['persistOptions'] = {
  persister: createAsyncStoragePersister({ storage: AsyncStorage, key: 'nooky:query-cache', throttleTime: 1000 }),
  maxAge: WEEK,
  // Mudou o formato dos dados guardados? Troque para descartar o cache antigo.
  buster: '1',
  dehydrateOptions: {
    shouldDehydrateQuery: (query) => query.state.status === 'success' && PERSISTED.has(String(query.queryKey[0])),
  },
};

/** Depois de restaurar o cache, manda o que ficou na fila. */
export function resumeQueue() {
  queryClient.resumePausedMutations().catch(() => undefined);
}
