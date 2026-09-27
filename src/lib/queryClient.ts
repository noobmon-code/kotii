// Cache do app. As listas de compras (e a casa, para o app abrir) ficam
// guardadas no aparelho, para abrir no mercado sem internet; as marcações
// feitas offline ficam numa fila (registerListMutations) que também é
// guardada e sai quando a conexão volta.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { onlineManager, QueryClient } from '@tanstack/react-query';
import { persistQueryClientSave, type PersistQueryClientProviderProps } from '@tanstack/react-query-persist-client';
import * as Network from 'expo-network';
import { AppState, Platform } from 'react-native';

import { inListQueue, registerListMutations } from '@/data/market';

import { createCachePersister } from './cachePersister';

const WEEK = 1000 * 60 * 60 * 24 * 7;

// O que vai para o aparelho: o mínimo para usar a lista offline.
const PERSISTED = new Set(['household', 'lists', 'list', 'listItems', 'products', 'recentPurchases']);

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
    const reachable = (state: Network.NetworkState) => state.isConnected !== false && state.isInternetReachable !== false;
    let heard = false;
    const subscription = Network.addNetworkStateListener((state) => {
      heard = true;
      setNetwork(reachable(state));
    });
    // App aberto já sem rede: não haverá evento de mudança, então parte do
    // estado atual (a não ser que um evento, mais novo, tenha chegado antes).
    Network.getNetworkStateAsync()
      .then((state) => {
        if (!heard) setNetwork(reachable(state));
      })
      .catch(() => undefined);
    return () => subscription.remove();
  }
  // Na geração das páginas estáticas não há window.
  if (typeof window === 'undefined' || !window.addEventListener) return undefined;
  // App aberto já sem internet: não haverá evento de queda, então parte do
  // que o navegador diz agora (falso é confiável; verdadeiro nem sempre).
  setNetwork(navigator.onLine !== false);
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

const { persister, persistNow } = createCachePersister({ storage: AsyncStorage, key: 'nooky:query-cache', throttleMs: 1000 });

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
export function saveNow(): Promise<void> {
  return persistQueryClientSave({
    queryClient,
    persister: { ...persister, persistClient: persistNow },
    buster: persistOptions.buster,
    dehydrateOptions: persistOptions.dehydrateOptions,
  }).catch(() => undefined);
}

queryClient.getMutationCache().subscribe((event) => {
  if (event.type === 'updated' && inListQueue(event.mutation)) saveNow();
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
  // Descarta também a gravação que esperava o intervalo.
  Promise.resolve(persister.removeClient()).catch(() => undefined);
}

/**
 * De quem é o cache: a casa fica guardada com o id de quem entrou
 * (`['household', userId]`) e cada ação da fila da lista leva quem tocou. Só
 * conta a casa que tem dados: antes de a sessão chegar, a tela já cria
 * `['household', undefined]`, vazia.
 */
export function cacheOwners(): unknown[] {
  const households = queryClient
    .getQueryCache()
    .findAll({ queryKey: ['household'], predicate: (query) => query.state.data !== undefined })
    .map((query) => query.queryKey[1]);
  const queued = queryClient
    .getMutationCache()
    .findAll({ predicate: inListQueue })
    .map((mutation) => (mutation.state.variables as { userId?: string } | undefined)?.userId);
  return [...households, ...queued];
}

/** Cache restaurado e conferido (é de quem entrou): manda o que ficou na fila. */
export function resumeQueue() {
  queryClient.resumePausedMutations().catch(() => undefined);
}
