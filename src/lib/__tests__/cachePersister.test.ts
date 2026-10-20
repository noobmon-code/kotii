import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { PersistedClient } from '@tanstack/react-query-persist-client';

import { createCachePersister, createWriteFailureWarner } from '../cachePersister';

const snapshot = (name: string): PersistedClient => ({ buster: '1', timestamp: 0, clientState: { queries: [], mutations: [], name } as never });

/** Armazenamento em memória; `slow` segura as gravações até `release`. */
function memoryStorage() {
  const data = new Map<string, string>();
  const held: (() => void)[] = [];
  let slow = false;
  return {
    data,
    set slow(value: boolean) {
      slow = value;
    },
    release: () => held.splice(0).forEach((done) => done()),
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) =>
      new Promise<void>((resolve) => {
        const write = () => {
          data.set(key, value);
          resolve();
        };
        if (slow) held.push(write);
        else write();
      }),
    removeItem: async (key: string) => {
      data.delete(key);
    },
  };
}

const saved = (storage: ReturnType<typeof memoryStorage>) => {
  const raw = storage.data.get('cache');
  return raw ? (JSON.parse(raw) as { clientState: { name: string } }).clientState.name : null;
};

afterEach(() => {
  jest.useRealTimers();
});

describe('gravador do cache', () => {
  it('várias mudanças no intervalo viram uma gravação, com o estado mais novo', async () => {
    jest.useFakeTimers();
    const storage = memoryStorage();
    const { persister } = createCachePersister({ storage, key: 'cache', throttleMs: 1000 });
    persister.persistClient(snapshot('a'));
    persister.persistClient(snapshot('b'));
    await jest.advanceTimersByTimeAsync(999);
    expect(saved(storage)).toBeNull();
    await jest.advanceTimersByTimeAsync(1);
    expect(saved(storage)).toBe('b');
  });

  it('apagar descarta a gravação que esperava o intervalo', async () => {
    jest.useFakeTimers();
    const storage = memoryStorage();
    const { persister, persistNow } = createCachePersister({ storage, key: 'cache', throttleMs: 1000 });
    await persistNow(snapshot('casa antiga'));
    persister.persistClient(snapshot('casa antiga, mais nova'));
    await persister.removeClient();
    await jest.advanceTimersByTimeAsync(5000);
    expect(saved(storage)).toBeNull();
  });

  it('apagar espera a gravação em andamento, e não o contrário', async () => {
    const storage = memoryStorage();
    const { persister, persistNow } = createCachePersister({ storage, key: 'cache', throttleMs: 1000 });
    storage.slow = true;
    const writing = persistNow(snapshot('casa antiga'));
    const removing = persister.removeClient();
    // A gravação começa no próximo passo da fila e fica presa até liberar.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saved(storage)).toBeNull();
    storage.release();
    await Promise.all([writing, removing]);
    expect(saved(storage)).toBeNull();
  });

  it('gravar na hora leva junto o que esperava e cancela o intervalo', async () => {
    jest.useFakeTimers();
    const storage = memoryStorage();
    const { persister, persistNow } = createCachePersister({ storage, key: 'cache', throttleMs: 1000 });
    persister.persistClient(snapshot('a'));
    await persistNow(snapshot('b'));
    expect(saved(storage)).toBe('b');
    await jest.advanceTimersByTimeAsync(5000);
    expect(saved(storage)).toBe('b');
  });

  it('restaura o que foi gravado', async () => {
    const storage = memoryStorage();
    const { persister, persistNow } = createCachePersister({ storage, key: 'cache', throttleMs: 1000 });
    expect(await persister.restoreClient()).toBeUndefined();
    await persistNow(snapshot('a'));
    expect(await persister.restoreClient()).toEqual(snapshot('a'));
  });
});

describe('armazenamento cheio', () => {
  /** Um armazenamento que só aceita textos até `limit` caracteres no total (como o localStorage, de poucos MB). */
  function smallStorage(limit: number) {
    const data = new Map<string, string>();
    const used = () => [...data.values()].reduce((sum, value) => sum + value.length, 0);
    return {
      data,
      getItem: async (key: string) => data.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        if (used() - (data.get(key)?.length ?? 0) + value.length > limit) throw new Error('QuotaExceededError');
        data.set(key, value);
      },
      removeItem: async (key: string) => {
        data.delete(key);
      },
    };
  }
  /** O cache com a fila (mutations) e consultas grandes (os preços) e pequenas (as listas). */
  const big = (name: string): PersistedClient => ({
    buster: '1',
    timestamp: 0,
    clientState: {
      mutations: [{ mutationKey: ['toggleListItem'], state: { variables: { id: 'arroz' } } }],
      queries: [
        { queryKey: ['lists'], state: { data: name } },
        { queryKey: ['latestPrices'], state: { data: 'x'.repeat(5000) } },
      ],
    } as never,
  });
  const essential = (client: PersistedClient): PersistedClient => ({
    ...client,
    clientState: { ...client.clientState, queries: client.clientState.queries.filter((q) => q.queryKey[0] === 'lists') },
  });
  const stored = (storage: { data: Map<string, string> }) => {
    const raw = storage.data.get('cache');
    return raw ? (JSON.parse(raw) as { clientState: { mutations: unknown[]; queries: { queryKey: string[] }[] } }).clientState : null;
  };

  it('sem espaço para tudo, guarda a fila e as listas, e avisa', async () => {
    const storage = smallStorage(2000);
    const failures: string[] = [];
    const { persistNow } = createCachePersister({ storage, key: 'cache', throttleMs: 1000, essential, onWriteFailed: (f) => failures.push(f) });
    await persistNow(big('compras'));
    expect(stored(storage)?.mutations).toHaveLength(1);
    expect(stored(storage)?.queries.map((q) => q.queryKey[0])).toEqual(['lists']);
    expect(failures).toEqual(['essential']);
  });

  it('nem o essencial cabe: o cache velho sai (a fila velha não volta numa próxima abertura) e o aviso diz que se perdeu', async () => {
    const storage = smallStorage(50);
    storage.data.set('cache', 'velho');
    const failures: string[] = [];
    const { persistNow } = createCachePersister({ storage, key: 'cache', throttleMs: 1000, essential, onWriteFailed: (f) => failures.push(f) });
    await persistNow(big('compras'));
    expect(storage.data.has('cache')).toBe(false);
    expect(failures).toEqual(['lost']);
  });

  it('a falha não trava a fila do gravador: a gravação seguinte, com espaço, sai inteira e sem aviso', async () => {
    const storage = smallStorage(2000);
    const failures: string[] = [];
    const { persistNow } = createCachePersister({ storage, key: 'cache', throttleMs: 1000, essential, onWriteFailed: (f) => failures.push(f) });
    await persistNow(big('compras'));
    await persistNow(snapshot('pequeno'));
    expect(saved(storage as never)).toBe('pequeno');
    expect(failures).toEqual(['essential']);
  });
});

describe('o aviso de falha ao gravar', () => {
  const DAY = 24 * 60 * 60 * 1000;
  function setup({ waiting = false, failingStorage = false } = {}) {
    const data = new Map<string, string>();
    const storage = {
      data,
      getItem: async (key: string) => {
        if (failingStorage) throw new Error('QuotaExceededError');
        return data.get(key) ?? null;
      },
      setItem: async (key: string, value: string) => {
        if (failingStorage) throw new Error('QuotaExceededError');
        data.set(key, value);
      },
      removeItem: async (key: string) => {
        data.delete(key);
      },
    };
    const clock = { now: 1_000_000 };
    const queue = { waiting };
    const warned: string[] = [];
    /** Uma abertura do app: um avisador novo, com o mesmo aparelho. */
    const open = () =>
      createWriteFailureWarner({
        storage,
        markerKey: 'avisado',
        remindAfterMs: 30 * DAY,
        queueWaiting: () => queue.waiting,
        warn: (failure) => warned.push(failure),
        now: () => clock.now,
      });
    return { storage, clock, queue, warned, open };
  }

  it('só o essencial coube: avisa uma vez, e não a cada abertura do app (numa casa grande a falha volta sempre)', async () => {
    const { clock, warned, open } = setup();
    const first = open();
    await first('essential');
    await first('essential');
    expect(warned).toEqual(['essential']);
    // Outro dia, o app aberto de novo: o cache inteiro continua sem caber, e o aviso não volta.
    clock.now += 2 * DAY;
    await open()('essential');
    expect(warned).toEqual(['essential']);
    // Um mês depois, se ainda falta espaço, lembra.
    clock.now += 30 * DAY;
    await open()('essential');
    expect(warned).toEqual(['essential', 'essential']);
  });

  it('sem conseguir guardar nem a hora do aviso, avisa mesmo assim (uma vez por abertura)', async () => {
    const { warned, open } = setup({ failingStorage: true });
    const app = open();
    await app('essential');
    await app('essential');
    expect(warned).toEqual(['essential']);
  });

  it('nada guardado: só avisa quando há algo da fila esperando a conexão (é o que se perderia)', async () => {
    const { queue, warned, open } = setup();
    const app = open();
    await app('lost');
    expect(warned).toEqual([]);
    queue.waiting = true;
    await app('lost');
    await app('lost');
    expect(warned).toEqual(['lost']);
  });
});
