import { afterAll, afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { AppState } from 'react-native';

import { ADD_ITEM_KEY, CLEAR_CHECKED_KEY, EDIT_ITEM_KEY, REMOVE_ITEM_KEY, TOGGLE_ITEM_KEY } from '@/data/market';
import { MARKET_TRIP_PUSH_KEY, MARKET_TRIPS_KEY } from '@/data/marketTrips';
import { JOBS_KEY, PROVIDERS_KEY } from '@/data/providers';
import { notify } from '@/ui/dialogs';

import { accessErrorMessage, EXPECTS_ROWS_META, NO_HOUSEHOLD_ACCESS, REMOVED_FROM_HOUSEHOLD } from '../accessErrors';
import { setActiveHousehold } from '../activeHousehold';
import { addedHere, rememberAdded } from '../addedItems';
import { chooseStore } from '../storeChoice';
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

jest.mock('@/lib/supabase', () => ({
  supabase: {},
  unwrap: (result: { data: unknown }) => result.data,
  errorMessage: (error: { message: string }) => error.message,
}));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn() }));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const stored = () => AsyncStorage.getItem('kotii:query-cache');

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

  it('sair da conta apaga também o "Onde estou" e os itens que este aparelho pôs em cada lista', async () => {
    chooseStore('l1', 's1');
    rememberAdded('l1', ['i1']);
    await flush();
    expect(await AsyncStorage.getItem('kotii:store-choice:l1')).not.toBeNull();
    expect(await AsyncStorage.getItem('kotii:added-items:l1')).not.toBeNull();

    forgetCache();
    await flush();
    expect(await AsyncStorage.getItem('kotii:store-choice:l1')).toBeNull();
    expect(await AsyncStorage.getItem('kotii:added-items:l1')).toBeNull();
    expect(addedHere('l1').size).toBe(0);
  });

  it('prestadores e serviços (nomes e telefones de gente de fora da casa) não ficam guardados no aparelho', async () => {
    queryClient.setQueryData(['lists'], [{ id: 'l1', name: 'Compras da semana' }]);
    queryClient.setQueryData([PROVIDERS_KEY], { rows: [{ id: 'p1', name: 'Zé da Luz', phone: '(11) 98765-4321' }], missing: false });
    queryClient.setQueryData([JOBS_KEY], { rows: [{ id: 'j1', description: 'Trocou o disjuntor' }], missing: false });
    queryClient.setQueryData([JOBS_KEY, 'provider', 'p1'], { rows: [{ id: 'j1', description: 'Trocou o disjuntor' }], missing: false });
    await saveNow();
    const saved = (await stored()) ?? '';
    expect(saved).toContain('Compras da semana');
    expect(saved).not.toContain('Zé da Luz');
    expect(saved).not.toContain('98765');
    expect(saved).not.toContain('Trocou o disjuntor');
    await AsyncStorage.removeItem('kotii:query-cache');
  });

  it('as idas ao mercado e a opção do aviso ficam só na memória', async () => {
    queryClient.setQueryData(['lists'], [{ id: 'l1', name: 'Compras da semana' }]);
    queryClient.setQueryData([MARKET_TRIPS_KEY], [{ id: 't1', display_name: 'Ana da ida' }]);
    queryClient.setQueryData([MARKET_TRIP_PUSH_KEY], true);
    saveNow();
    await flush();
    const saved = await stored();
    expect(saved).toContain('Compras da semana');
    expect(saved).not.toContain('Ana da ida');
    expect(saved).not.toContain(MARKET_TRIP_PUSH_KEY);
    forgetCache();
    await flush();
  });

  it('os gastos e o mercado do mês não ficam guardados no aparelho; a lista de compras fica', async () => {
    queryClient.setQueryData(['spending', 'market', '2026-10'], [{ id: 'nota-do-mercado' }]);
    queryClient.setQueryData(['spending', '2026-04', '2026-10'], [{ id: 'lancamento-do-resumo' }]);
    queryClient.setQueryData(['lists'], [{ id: 'l1', name: 'Compras da semana' }]);
    saveNow();
    await flush();
    const saved = await stored();
    expect(saved).toContain('Compras da semana');
    expect(saved).not.toContain('nota-do-mercado');
    expect(saved).not.toContain('lancamento-do-resumo');
    forgetCache();
    await flush();
  });

  // Juntar não tem volta: a confirmação só mostra o que leu com ela aberta (useMergeFacts), e essa leitura não
  // pode voltar do aparelho numa abertura seguinte do app.
  it('o que a confirmação de juntar produtos leu não fica guardado no aparelho', async () => {
    queryClient.setQueryData(['mergeFacts', 'p-arroz', 'p-arroz-tj'], { products: { 'p-arroz': { id: 'p-arroz', name: 'nome-lido-na-confirmacao' } } });
    queryClient.setQueryData(['lists'], [{ id: 'l1', name: 'Compras da semana' }]);
    saveNow();
    await flush();
    const saved = await stored();
    expect(saved).toContain('Compras da semana');
    expect(saved).not.toContain('nome-lido-na-confirmacao');
    expect(saved).not.toContain('mergeFacts');
    forgetCache();
    await flush();
  });

  it('as marcações e os limpar da fila também dizem de quem é o cache', () => {
    queryClient.setQueryData(['household', 'u1'], { household: { id: 'h1' } });
    queryClient.getMutationCache().build(queryClient, { mutationKey: TOGGLE_ITEM_KEY, gcTime: 0 }, {
      variables: { id: 'i1', checked: true, userId: 'u2', at: '', token: 't0', nextToken: 't1' },
    } as never);
    queryClient.getMutationCache().build(queryClient, { mutationKey: CLEAR_CHECKED_KEY, gcTime: 0 }, {
      variables: { listId: 'l1', userId: 'u3', items: [] },
    } as never);
    expect(cacheOwners()).toEqual(['u1', 'u2', 'u3']);
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

  it('o cache de versões anteriores volta com os nomes novos das consultas', async () => {
    const query = (key: string) => ({ queryKey: [key], queryHash: `["${key}"]`, state: { data: [{ name: 'Café' }] } });
    await AsyncStorage.setItem(
      'kotii:query-cache',
      JSON.stringify({ buster: '1', timestamp: 0, clientState: { mutations: [], queries: [query('recentPurchases'), query('lists')] } }),
    );
    const restored = await persistOptions.persister.restoreClient();
    expect(restored?.clientState.queries.map((q) => [q.queryKey, q.queryHash])).toEqual([
      [['purchaseRecords'], '["purchaseRecords"]'],
      [['lists'], '["lists"]'],
    ]);
    await AsyncStorage.removeItem('kotii:query-cache');
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

describe('escrita barrada pela casa', () => {
  const rls = () => ({ code: '42501', message: 'new row violates row-level security policy for table "shopping_lists"' });
  const house = (ids: string[]) => ({ household: { id: ids[0] }, households: ids.map((id) => ({ id })) });

  /** As casas da pessoa no servidor, como a consulta da casa as busca. */
  function serverHouses(ids: string[] | null, before: string[] = ['h1']) {
    const queryFn = jest.fn(async () => (ids ? house(ids) : null));
    queryClient.setQueryDefaults(['household'], { queryFn });
    queryClient.setQueryData(['household', 'u1'], house(before));
    return queryFn;
  }

  /** Uma escrita que o banco recusa, pelo cache de mutações (como as telas fazem). */
  async function failedWrite(error: object = rls()) {
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: async () => {
        throw error;
      },
      // Sem o tempo de coleta padrão (minutos), o Jest não fica esperando.
      gcTime: 0,
    });
    return mutation.execute(undefined).catch((err: unknown) => err);
  }

  it('confere as casas antes do aviso: tirada da casa, o aviso diz isso', async () => {
    await setActiveHousehold('u1', 'h1');
    const queryFn = serverHouses(['h2']);
    const error = await failedWrite();
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(accessErrorMessage(error)).toBe(REMOVED_FROM_HOUSEHOLD);
  });

  it('sem casa nenhuma agora, também', async () => {
    await setActiveHousehold('u1', 'h1');
    serverHouses(null);
    expect(accessErrorMessage(await failedWrite())).toBe(REMOVED_FROM_HOUSEHOLD);
  });

  it('ainda na casa: não diz que saiu', async () => {
    await setActiveHousehold('u1', 'h1');
    serverHouses(['h1', 'h2']);
    expect(accessErrorMessage(await failedWrite())).toBe(NO_HOUSEHOLD_ACCESS);
  });

  it('a busca das casas falhou: aviso neutro', async () => {
    await setActiveHousehold('u1', 'h1');
    queryClient.setQueryDefaults(['household'], {
      queryFn: async () => {
        throw new Error('Failed to fetch');
      },
      retry: false,
    });
    queryClient.setQueryData(['household', 'u1'], house(['h1']));
    expect(accessErrorMessage(await failedWrite())).toBe(NO_HOUSEHOLD_ACCESS);
  });

  it('sem internet, nem tenta conferir (a busca ficaria parada)', async () => {
    await setActiveHousehold('u1', 'h1');
    const queryFn = serverHouses(['h2']);
    network.listener?.({ isConnected: false, isInternetReachable: false });
    expect(accessErrorMessage(await failedWrite())).toBe(NO_HOUSEHOLD_ACCESS);
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('outros erros não buscam as casas', async () => {
    const queryFn = serverHouses(['h2']);
    const error = await failedWrite(new Error('only the household owner can do this'));
    expect(queryFn).not.toHaveBeenCalled();
    expect(accessErrorMessage(error)).toBeNull();
  });
});

describe('mudança sem erro, talvez barrada pela casa', () => {
  // A RLS esconde as linhas da casa de quem foi tirada dela: UPDATE/DELETE dá 200 com 0 linhas, sem erro.
  let now = Date.now();

  beforeEach(() => {
    // Cada teste começa bem depois do anterior (as buscas têm intervalo mínimo).
    now += 60_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function serverHouses() {
    const queryFn = jest.fn(async () => ({ household: { id: 'h2' }, households: [{ id: 'h2' }] }));
    queryClient.setQueryDefaults(['household'], { queryFn });
    queryClient.setQueryData(['household', 'u1'], { household: { id: 'h1' }, households: [{ id: 'h1' }] });
    return queryFn;
  }

  async function write(rows: unknown, meta: Record<string, unknown> = EXPECTS_ROWS_META) {
    const mutation = queryClient.getMutationCache().build(queryClient, { mutationFn: async () => rows, meta, gcTime: 0 });
    const result = await mutation.execute(undefined);
    await flush();
    return result;
  }

  it('marcar e editar item pedem as linhas de volta', () => {
    expect(queryClient.getMutationDefaults(TOGGLE_ITEM_KEY).meta).toEqual(EXPECTS_ROWS_META);
    expect(queryClient.getMutationDefaults(EDIT_ITEM_KEY).meta).toEqual(EXPECTS_ROWS_META);
    expect(queryClient.getMutationDefaults(REMOVE_ITEM_KEY).meta).toEqual(EXPECTS_ROWS_META);
  });

  it('nenhuma linha: busca as casas de novo (o que leva a pessoa para outra casa), sem erro', async () => {
    const queryFn = serverHouses();
    await expect(write([])).resolves.toEqual([]);
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(['household', 'u1'])).toEqual({ household: { id: 'h2' }, households: [{ id: 'h2' }] });
  });

  it('alcançou a linha, ou a mutação não devolve linhas: não busca', async () => {
    const queryFn = serverHouses();
    await write([{ id: 'item' }]);
    // Mutação sem o meta: o resultado dela não diz nada sobre linhas.
    await write([], {});
    await write(null);
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('qualquer mudança que deu certo, com as casas de mais de 30 s: busca as casas de novo', async () => {
    const queryFn = serverHouses();
    now += 31_000;
    // O UPDATE/DELETE comum: sem o meta e sem as linhas de volta.
    await write(null, {});
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(['household', 'u1'])).toEqual({ household: { id: 'h2' }, households: [{ id: 'h2' }] });
    // Casas recém-buscadas: as próximas mudanças não buscam de novo.
    now += 10_000;
    await write(null, {});
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('várias marcações sem linha em sequência: uma busca só a cada poucos segundos', async () => {
    const queryFn = serverHouses();
    await write([]);
    now += 1000;
    await write([]);
    expect(queryFn).toHaveBeenCalledTimes(1);
    now += 10_000;
    await write([]);
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it('sem internet, não busca', async () => {
    const queryFn = serverHouses();
    network.listener?.({ isConnected: false, isInternetReachable: false });
    await write([]);
    expect(queryFn).not.toHaveBeenCalled();
  });
});

describe('voltar ao app no celular', () => {
  it('o app em primeiro plano conta como foco (as consultas velhas buscam de novo); no fundo, não', () => {
    const listeners = jest
      .mocked(AppState.addEventListener)
      .mock.calls.filter(([type]) => type === 'change')
      .map(([, listener]) => listener as (state: string) => void);
    expect(listeners.length).toBeGreaterThan(0);
    const tell = (state: string) => listeners.forEach((listener) => listener(state));
    tell('background');
    expect(focusManager.isFocused()).toBe(false);
    tell('active');
    expect(focusManager.isFocused()).toBe(true);
    // A central de notificações do iPhone por cima também não é o app em uso.
    tell('inactive');
    expect(focusManager.isFocused()).toBe(false);
    tell('active');
  });
});

describe('aparelho sem espaço para o cache', () => {
  // O AsyncStorage de mentira já é um jest.fn: a gravação de sempre volta no fim.
  const setItem = jest.mocked(AsyncStorage.setItem);
  const original = setItem.getMockImplementation();

  afterEach(() => {
    if (original) setItem.mockImplementation(original);
  });

  it('guarda a fila e as listas sem o resto, e avisa uma vez só', async () => {
    // Cabe só o que é pequeno, como um localStorage quase cheio.
    setItem.mockImplementation(async (key: string, value: string) => {
      if (value.length > 3000) throw new Error('QuotaExceededError');
      await AsyncStorage.multiSet([[key, value]]);
    });
    queryClient.getMutationCache().build(queryClient, { mutationKey: TOGGLE_ITEM_KEY, gcTime: Infinity }, {
      variables: { id: 'marcacao-na-fila', checked: true, userId: 'u1', at: '', token: 't0', nextToken: 't1' },
      isPaused: true,
      status: 'pending',
    } as never);
    queryClient.setQueryData(['lists'], [{ id: 'l1', name: 'Compras da semana' }]);
    queryClient.setQueryData(['latestPrices'], [{ product_id: 'p'.repeat(5000) }]);
    await saveNow();
    const saved = (await stored()) ?? '';
    expect(saved).toContain('Compras da semana');
    expect(saved).toContain('marcacao-na-fila');
    expect(saved).not.toContain('latestPrices');
    await flush();
    expect(jest.mocked(notify).mock.calls.map(([title]) => title)).toEqual(['Pouco espaço no aparelho']);
    // A hora do aviso fica guardada à parte: na próxima abertura do app ele não volta (cachePersister).
    expect(await AsyncStorage.getItem('kotii:low-space-warned')).toMatch(/^\d+$/);
    await saveNow();
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
    await AsyncStorage.removeItem('kotii:query-cache');
  });
});

describe('a fila guardada no meio do envio', () => {
  afterEach(async () => {
    await AsyncStorage.removeItem('kotii:query-cache');
  });

  it('o que está saindo agora (da fila da lista ou da das fotos) também fica guardado; fora delas, só o parado', async () => {
    const build = (mutationKey: unknown[], id: string, isPaused: boolean) =>
      queryClient.getMutationCache().build(queryClient, { mutationKey, gcTime: Infinity }, {
        variables: { id, userId: 'u1' },
        isPaused,
        status: 'pending',
        failureCount: 0,
      } as never);
    build(TOGGLE_ITEM_KEY, 'marcacao-saindo', false);
    build(EDIT_ITEM_KEY, 'edicao-esperando', true);
    // Outra ação qualquer, sem fila: não volta numa próxima abertura.
    build(['outraAcao'], 'fora-da-fila', false);
    await saveNow();
    const saved = (await stored()) ?? '';
    expect(saved).toContain('marcacao-saindo');
    expect(saved).toContain('edicao-esperando');
    expect(saved).not.toContain('fora-da-fila');

    // Reaberto, o que estava saindo volta parado (para sair com a conexão) e como já tentado.
    const restored = await persistOptions.persister.restoreClient();
    const states = Object.fromEntries(
      (restored?.clientState.mutations ?? []).map((m) => [(m.state.variables as { id: string }).id, [m.state.isPaused, m.state.failureCount]]),
    );
    expect(states).toEqual({ 'marcacao-saindo': [true, 1], 'edicao-esperando': [true, 0] });
  });
});

describe('a fila que desiste de um item posto', () => {
  it('avisa a pessoa onde ela estiver, com o nome do item (também o pôr guardado, sem a tela que o pôs)', async () => {
    jest.mocked(notify).mockClear();
    const onError = queryClient.getMutationDefaults(ADD_ITEM_KEY).onError as (error: Error, input: unknown) => Promise<void>;
    await onError(new Error('A lista não existe mais.'), { id: 'x', listId: 'l1', userId: 'u1', token: 't', name: 'Leite' });
    expect(jest.mocked(notify).mock.calls).toEqual([['Item não foi para a lista', '"Leite" não entrou na lista: A lista não existe mais.']]);
  });
});
