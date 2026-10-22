// Cache do app. As listas de compras (e a casa, para o app abrir) ficam
// guardadas no aparelho, para abrir no mercado sem internet; as marcações
// feitas offline ficam numa fila (registerListMutations) que também é
// guardada e sai quando a conexão volta.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { focusManager, hashKey, MutationCache, onlineManager, QueryClient } from '@tanstack/react-query';
import { persistQueryClientSave, type PersistedClient, type PersistQueryClientProviderProps } from '@tanstack/react-query-persist-client';
import * as Network from 'expo-network';
import { AppState, Platform } from 'react-native';

import { forgetPendingPhotos, inPhotoQueue, registerListPhotoMutations } from '@/data/listPhotos';
import { inListQueue, registerListMutations } from '@/data/market';
import { notify } from '@/ui/dialogs';

import { isHouseholdAccessError, leftHousehold, markRemovedFromHousehold, wroteNoRows } from './accessErrors';
import { getActiveHousehold } from './activeHousehold';
import { type CacheWriteFailure, createCachePersister, createWriteFailureWarner, resumeInFlight } from './cachePersister';
import { errorMessage } from './supabase';

const WEEK = 1000 * 60 * 60 * 24 * 7;

// O que vai para o aparelho: o mínimo para usar a lista offline (a despensa,
// para o limpar do carrinho sem internet não repetir o que já está nela; os
// links das fotos dos itens, para vê-las sem internet; os últimos preços, os
// mercados e as ligações nome da lista -> produto, para a estimativa da lista
// dentro do mercado) e o clima da casa (a dica da tela Hoje e o aviso das 7h
// saem da última previsão). As reposições (gás, água, ração) vão junto com a
// despensa, que é onde aparecem: são poucas linhas, sem nada sensível, e o
// que fica guardado é sempre uma resposta inteira (ou "este banco ainda não
// tem as tabelas").
const PERSISTED = new Set([
  'household',
  'lists',
  'list',
  'listItems',
  'products',
  'purchaseRecords',
  'pantry',
  'supplies',
  'latestPrices',
  'stores',
  'listLinks',
  'listPhotos',
  // Os códigos de barras da casa: no mercado, com sinal fraco, o código lido ainda acha o produto (e os preços dele).
  'productBarcodes',
  'householdLocation',
  'weather',
]);

/** Quanto a conferência da casa pode segurar o aviso de erro. */
const HOUSEHOLD_CHECK_MS = 8000;

/**
 * Uma escrita foi barrada pela regra de acesso da casa: talvez a pessoa
 * tenha sido tirada dela com o app aberto. Busca as casas de novo (o que já
 * leva o app para outra casa, ou para a tela de abertura) e, se a casa
 * aberta não está mais entre elas, marca o erro: o aviso diz que ela não faz
 * mais parte da casa. Sem conseguir conferir, o aviso fica neutro.
 */
async function confirmHouseholdAccess(error: unknown): Promise<void> {
  // Sem internet (ou a sessão esperando renovação) a busca ficaria parada e o aviso não sairia.
  if (!onlineManager.isOnline()) return;
  const householdId = getActiveHousehold();
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    queryClient.refetchQueries({ queryKey: ['household'] }).catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, HOUSEHOLD_CHECK_MS);
    }),
  ]);
  clearTimeout(timer);
  const [fresh] = queryClient
    .getQueryCache()
    .findAll({ queryKey: ['household'], predicate: (q) => q.state.status === 'success' && q.state.dataUpdatedAt >= startedAt });
  if (!fresh) return;
  const state = fresh.state.data as Parameters<typeof leftHousehold>[1];
  if (leftHousehold(householdId, state)) markRemovedFromHousehold(error);
}

/** Intervalo mínimo entre duas buscas das casas por mudanças sem linhas (marcações em sequência). */
const HOUSEHOLD_RECHECK_MS = 5000;
/** Idade das casas a partir da qual qualquer mudança que deu certo as busca de novo. */
const HOUSEHOLD_STALE_MS = 30_000;
let lastHouseholdRecheck = 0;

/** Quando as casas foram buscadas por último (0: nunca). */
function householdFetchedAt(): number {
  return Math.max(0, ...queryClient.getQueryCache().findAll({ queryKey: ['household'] }).map((q) => q.state.dataUpdatedAt));
}

/**
 * Depois de uma mudança que deu certo, busca as casas de novo, o que leva
 * para outra casa quem foi tirada desta: a RLS não dá erro em UPDATE e
 * DELETE de linhas que ela esconde, só não muda nada (e a maioria das
 * mutações nem pede as linhas de volta). Para qualquer mudança, só com as
 * casas de mais de 30 s; `noRows` (a mudança pediu as linhas e não
 * alcançou nenhuma, ver wroteNoRows) busca mesmo com elas recentes. Sem
 * esperar e sem aviso; a busca em andamento é aproveitada.
 */
function recheckHousehold(noRows: boolean) {
  const now = Date.now();
  if (!onlineManager.isOnline() || now - lastHouseholdRecheck < HOUSEHOLD_RECHECK_MS) return;
  if (!noRows && now - Math.max(lastHouseholdRecheck, householdFetchedAt()) < HOUSEHOLD_STALE_MS) return;
  lastHouseholdRecheck = now;
  queryClient.refetchQueries({ queryKey: ['household'] }, { cancelRefetch: false }).catch(() => undefined);
}

export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    // Antes do onError da tela (o do cache vem primeiro e é esperado): o aviso já sai certo.
    onError: (error) => (isHouseholdAccessError(error) ? confirmHouseholdAccess(error) : undefined),
    // UPDATE/DELETE que a RLS barrou não dá erro, só 0 linhas (ou nada, sem `.select`).
    onSuccess: (data, _variables, _result, mutation) => {
      recheckHousehold(Boolean(mutation.meta?.expectsRows) && wroteNoRows(data));
    },
  }),
  defaultOptions: {
    // gcTime cobre o tempo guardado: consulta apagada da memória some do aparelho.
    queries: { staleTime: 30_000, retry: 1, gcTime: WEEK },
    // Fora a fila de marcações, sem internet a ação falha na hora e avisa,
    // em vez de ficar girando.
    mutations: { networkMode: 'always' },
  },
});
registerListMutations(queryClient, {
  // A fila só desiste do que não passa sozinho (a lista apagada em outro aparelho, por exemplo). O item some da
  // lista, e a pessoa fica sabendo onde estiver, também quando o pôr saiu de uma fila guardada.
  onAddDropped: (input, error) => notify('Item não foi para a lista', `"${input.name}" não entrou na lista: ${errorMessage(error)}`),
});
registerListPhotoMutations(queryClient);

/** Marcações, edições, limpar e fotos da lista: o que espera internet guardado no aparelho. */
const inSavedQueue = (mutation: Parameters<typeof inListQueue>[0]) => inListQueue(mutation) || inPhotoQueue(mutation);

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

// No celular, o TanStack Query não sabe quando o app volta para a frente (na
// web, o navegador avisa sozinho): sem isso, o que outra pessoa pôs na lista
// com o app no fundo (o tempo real não reenvia o que perdeu) só aparecia
// puxando a tela para atualizar. "inactive" (só no iPhone: a central de
// notificações, uma ligação) conta como fora de foco.
if (Platform.OS !== 'web') {
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener('change', (state) => setFocused(state === 'active'));
    return () => subscription.remove();
  });
}

/** A sessão ainda vale (false: venceu e o Supabase ainda não renovou). */
export function setSessionValid(valid: boolean) {
  sessionValid = valid;
  syncOnline();
}

// Sem espaço para o cache inteiro, fica o que a lista precisa no mercado; a
// fila (pôr, marcar, editar, tirar, limpar e as fotos) vai sempre junto.
const ESSENTIAL = new Set(['household', 'lists', 'list', 'listItems']);

function essentialOnly(client: PersistedClient): PersistedClient {
  return {
    ...client,
    clientState: {
      ...client.clientState,
      queries: client.clientState.queries.filter((query) => ESSENTIAL.has(String(query.queryKey[0]))),
    },
  };
}

// No navegador o espaço do app é fixo (o localStorage, de poucos MB): liberar espaço não adianta.
const CACHE_FAILURE_TEXT: Record<'native' | 'web', Record<CacheWriteFailure, [string, string]>> = {
  native: {
    essential: [
      'Pouco espaço no aparelho',
      'O app guardou só as listas e o que espera a conexão. Preços e produtos podem não aparecer sem internet. Libere espaço no aparelho para o app guardar tudo.',
    ],
    lost: [
      'Sem espaço no aparelho',
      'O app não conseguiu guardar o que foi feito sem internet. Deixe o app aberto até a conexão voltar, para nada se perder, e libere espaço no aparelho.',
    ],
  },
  web: {
    essential: [
      'Pouco espaço no navegador',
      'O navegador guarda pouco para o app: ficaram guardadas só as listas e o que espera a conexão. Preços e produtos podem não aparecer sem internet.',
    ],
    lost: [
      'Sem espaço no navegador',
      'O navegador não deixou o app guardar o que foi feito sem internet. Deixe esta página aberta até a conexão voltar, para nada se perder.',
    ],
  },
};

/** Há algo da fila (da lista ou das fotos) esperando para sair. */
const queueWaiting = () =>
  queryClient.getMutationCache().findAll({ predicate: (m) => inSavedQueue(m) && m.state.status === 'pending' }).length > 0;

const warnCacheFailure = createWriteFailureWarner({
  storage: AsyncStorage,
  markerKey: 'kotii:low-space-warned',
  // Uma vez por mês, se o espaço continuar faltando.
  remindAfterMs: 30 * 24 * 60 * 60 * 1000,
  queueWaiting,
  warn: (failure) => notify(...CACHE_FAILURE_TEXT[Platform.OS === 'web' ? 'web' : 'native'][failure]),
});

const { persister, persistNow } = createCachePersister({
  storage: AsyncStorage,
  key: 'kotii:query-cache',
  throttleMs: 1000,
  essential: essentialOnly,
  onWriteFailed: (failure) => void warnCacheFailure(failure),
});

// Consultas guardadas que mudaram de nome, com os mesmos dados: o cache de
// versões anteriores volta com o nome novo (sem isso, aberto sem internet,
// o app ficaria sem elas até reconectar).
const RENAMED: Record<string, string> = { recentPurchases: 'purchaseRecords' };

function renameStoredQueries(client: PersistedClient | undefined): PersistedClient | undefined {
  for (const query of client?.clientState.queries ?? []) {
    const renamed = RENAMED[String(query.queryKey[0])];
    if (!renamed) continue;
    query.queryKey = [renamed, ...query.queryKey.slice(1)];
    query.queryHash = hashKey(query.queryKey);
  }
  return client;
}

export const persistOptions = {
  persister: {
    ...persister,
    restoreClient: async () => resumeInFlight(renameStoredQueries(await persister.restoreClient())),
  },
  maxAge: WEEK,
  // Mudou o formato dos dados guardados? Troque para descartar o cache antigo.
  buster: '1',
  dehydrateOptions: {
    shouldDehydrateQuery: (query) => query.state.status === 'success' && PERSISTED.has(String(query.queryKey[0])),
    // Da fila da lista e da das fotos, guarda também o que está saindo agora: se o app for fechado no meio do
    // envio (no mercado, com sinal fraco, ele pode levar muito tempo), o item posto não se perde. Reenviar é
    // seguro (ver queuedDefaults). Fora delas, só o que está parado, como o TanStack Query faz.
    shouldDehydrateMutation: (mutation) =>
      mutation.state.isPaused || (inSavedQueue(mutation) && mutation.state.status === 'pending'),
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

// Também quando uma sai da fila sem ir ao servidor (pôr e tirar o mesmo item sem internet se cancelam).
queryClient.getMutationCache().subscribe((event) => {
  if (!event.mutation || !inSavedQueue(event.mutation)) return;
  if (event.type === 'updated' || (event.type === 'removed' && event.mutation.state.status === 'pending')) saveNow();
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
  forgetPendingPhotos().catch(() => undefined);
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
    .findAll({ predicate: inSavedQueue })
    .map((mutation) => (mutation.state.variables as { userId?: string } | undefined)?.userId);
  return [...households, ...queued];
}

/** De que casa é o cache: a da consulta da casa guardada, se houver. */
export function cacheHousehold(): string | undefined {
  const [query] = queryClient
    .getQueryCache()
    .findAll({ queryKey: ['household'], predicate: (q) => q.state.data !== undefined && q.state.data !== null });
  return (query?.state.data as { household?: { id: string } } | undefined)?.household?.id;
}

/** Cache restaurado e conferido (é de quem entrou): manda o que ficou na fila. */
export function resumeQueue() {
  queryClient.resumePausedMutations().catch(() => undefined);
}
