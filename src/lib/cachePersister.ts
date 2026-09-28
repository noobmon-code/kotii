// Onde o cache do app fica guardado no aparelho. Um gravador só, em fila:
// gravar (com intervalo ou na hora) e apagar nunca se cruzam, e apagar
// descarta o que estava esperando para ser gravado. Com dois gravadores, uma
// gravação atrasada podia devolver ao aparelho o cache recém-apagado.

import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';

export interface KeyValueStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

export function createCachePersister({ storage, key, throttleMs }: { storage: KeyValueStorage; key: string; throttleMs: number }) {
  let queue: Promise<void> = Promise.resolve();
  let waiting: PersistedClient | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const enqueue = (task: () => Promise<void>) => {
    queue = queue.then(task).catch(() => undefined);
    return queue;
  };

  const dropWaiting = () => {
    waiting = null;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const writeWaiting = () => {
    const client = waiting;
    dropWaiting();
    return client ? enqueue(() => storage.setItem(key, JSON.stringify(client))) : queue;
  };

  const persister: Persister = {
    // Várias mudanças seguidas viram uma gravação só, com o estado mais novo.
    persistClient: (client) => {
      waiting = client;
      timer ??= setTimeout(writeWaiting, throttleMs);
    },
    restoreClient: async () => {
      const raw = await storage.getItem(key);
      return raw ? (JSON.parse(raw) as PersistedClient) : undefined;
    },
    removeClient: () => {
      dropWaiting();
      return enqueue(() => storage.removeItem(key));
    },
  };

  /** Grava já, sem esperar o intervalo. */
  const persistNow = (client: PersistedClient) => {
    waiting = client;
    return writeWaiting();
  };

  return { persister, persistNow };
}
