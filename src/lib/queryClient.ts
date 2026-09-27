// Cache do app. As listas de compras (e a casa, para o app abrir) ficam
// guardadas no aparelho, para abrir no mercado sem internet; as marcações
// feitas offline ficam numa fila (registerListMutations) que também é
// guardada e sai quando a conexão volta.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { onlineManager, QueryClient } from '@tanstack/react-query';
import { persistQueryClientSave, type PersistQueryClientProviderProps } from '@tanstack/react-query-persist-client';
import * as Network from 'expo-network';
import { AppState, Platform } from 'react-native';

import { registerListMutations, TOGGLE_ITEM_KEY } from '@/data/market';

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

// Online, para o cache, é rede no ar e sessão válida. Com o token vencido à
// espera de renovação, o Supabase manda os pedidos com a chave pública: a
// lista voltaria vazia (e seria guardada assim) e a marcação da fila não
// gravaria nada. Até a sessão ser renovada, o app segue como sem internet.
let networkUp = true;
let sessionValid = true;
let pushOnline: ((online: boolean) => void) | undefined;
const syncOnline = () => pushOnline?.(networkUp && sessionValid);

// Na web o navegador avisa quando cai a conexão; no celular, o expo-network.
onlineManager.setEventListener((setOnline) => {
  pushOnline = setOnline;
  const setNetwork = (up: boolean) => {
    networkUp = up;
    syncOnline();
  };
  if (Platform.OS !== 'web') {
    const subscription = Network.addNetworkStateListener((state) =>
      setNetwork(state.isConnected !== false && state.isInternetReachable !== false),
    );
    return () => subscription.remove();
  }
  // Na geração das páginas estáticas não há window.
  if (typeof window === 'undefined' || !window.addEventListener) return undefined;
  const online = () => setNetwork(true);
  const offline = () => setNetwork(false);
  window.addEventListener('online', online);
  window.addEventListener('offline', offline);
  return () => {
    window.removeEventListener('online', online);
    window.removeEventListener('offline', offline);
  };
});

/** A sessão ainda vale (false: venceu e o Supabase ainda não renovou). */
export function setSessionValid(valid: boolean) {
  sessionValid = valid;
  syncOnline();
}

const STORAGE_KEY = 'nooky:query-cache';
const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: STORAGE_KEY, throttleTime: 1000 });
// Mesmo lugar, sem o intervalo: para gravar a fila de marcações na hora.
const immediatePersister = createAsyncStoragePersister({ storage: AsyncStorage, key: STORAGE_KEY, throttleTime: 0 });

export const persistOptions = {
  persister,
  maxAge: WEEK,
  // Mudou o formato dos dados guardados? Troque para descartar o cache antigo.
  buster: '1',
  dehydrateOptions: {
    shouldDehydrateQuery: (query) => query.state.status === 'success' && PERSISTED.has(String(query.queryKey[0])),
  },
} satisfies PersistQueryClientProviderProps['persistOptions'];

/**
 * Grava o cache já, sem o intervalo do persister: uma marcação feita sem
 * internet não pode se perder se o app for fechado logo depois do toque.
 */
export function saveNow() {
  persistQueryClientSave({
    queryClient,
    persister: immediatePersister,
    buster: persistOptions.buster,
    dehydrateOptions: persistOptions.dehydrateOptions,
  }).catch(() => undefined);
}

queryClient.getMutationCache().subscribe((event) => {
  if (event.type === 'updated' && event.mutation.options.mutationKey?.[0] === TOGGLE_ITEM_KEY[0]) saveNow();
});
// Indo para o fundo (ou fechando), grava o que estiver pendente.
AppState.addEventListener('change', (state) => {
  if (state !== 'active') saveNow();
});

/**
 * Saiu da conta (ou o cache é de outra conta): apaga da memória e do
 * aparelho na hora, sem esperar o intervalo do persister. Senão o app
 * fechado logo depois abriria para a próxima conta com as listas da casa
 * anterior.
 */
export function forgetCache() {
  queryClient.clear();
  Promise.resolve(immediatePersister.removeClient()).catch(() => undefined);
}

/**
 * De quem é o cache: a casa fica guardada com o id de quem entrou
 * (`['household', userId]`). Só conta a que tem dados: antes de a sessão
 * chegar, a tela já cria `['household', undefined]`, vazia.
 */
export function cacheOwners(): unknown[] {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: ['household'], predicate: (query) => query.state.data !== undefined })
    .map((query) => query.queryKey[1]);
}

/** Depois de restaurar o cache, manda o que ficou na fila. */
export function resumeQueue() {
  queryClient.resumePausedMutations().catch(() => undefined);
}
