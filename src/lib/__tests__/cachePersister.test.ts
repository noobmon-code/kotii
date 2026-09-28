import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { PersistedClient } from '@tanstack/react-query-persist-client';

import { createCachePersister } from '../cachePersister';

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
