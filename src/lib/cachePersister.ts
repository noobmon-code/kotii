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

/**
 * Gravar falhou (armazenamento cheio: no navegador, o localStorage tem poucos
 * MB). `essential`: só o essencial ficou guardado; `lost`: nem isso, e o que
 * estava guardado antes foi apagado (o cache velho, com uma fila velha, não
 * volta numa próxima abertura).
 */
export type CacheWriteFailure = 'essential' | 'lost';

export function createCachePersister({
  storage,
  key,
  throttleMs,
  essential,
  onWriteFailed,
}: {
  storage: KeyValueStorage;
  key: string;
  throttleMs: number;
  /** O mínimo para guardar quando o cache inteiro não cabe (a fila de quem ficou sem internet, as listas). */
  essential?: (client: PersistedClient) => PersistedClient;
  onWriteFailed?: (failure: CacheWriteFailure) => void;
}) {
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

  /** Grava; sem espaço, tenta só o essencial e, sem espaço nem para ele, tira o cache velho. */
  const write = async (client: PersistedClient) => {
    try {
      await storage.setItem(key, JSON.stringify(client));
      return;
    } catch {
      // Segue para o essencial.
    }
    if (essential) {
      try {
        await storage.setItem(key, JSON.stringify(essential(client)));
        onWriteFailed?.('essential');
        return;
      } catch {
        // Nem o essencial coube.
      }
    }
    await storage.removeItem(key).catch(() => undefined);
    onWriteFailed?.('lost');
  };

  const writeWaiting = () => {
    const client = waiting;
    dropWaiting();
    return client ? enqueue(() => write(client)) : queue;
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
