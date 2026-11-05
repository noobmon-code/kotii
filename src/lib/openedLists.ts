// A lista aberta que este aparelho abriu por último, para o atalho da tela Hoje (domain/listShortcut): cada lista
// aberta aqui e quando (as 20 mais novas). Fica neste aparelho (cada um usa a sua lista), na memória e no
// AsyncStorage, para valer também com o app reaberto. Sem armazenamento (modo privado, cota cheia), vale enquanto o
// app está aberto. A saída da conta apaga (forgetCache).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

import { parseOpenedLists, serializeOpenedLists, withOpenedList } from '@/domain/listShortcut';

const KEY = 'kotii:opened-lists';

/** O que esta abertura do app sabe; null: ainda não leu do aparelho. */
let opened: ReadonlyMap<string, number> | null = null;
/** Listas abertas antes de a leitura terminar: entram por cima do que estava guardado, sem apagar nada. */
let early = new Map<string, number>();
let reading: Promise<void> | null = null;
/** Sobe a cada saída da conta: uma leitura que começou antes não traz de volta as listas de quem saiu. */
let generation = 0;
/** Uma gravação de cada vez, na ordem dos toques. */
let saving: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function save(write: () => Promise<void>) {
  saving = saving.then(async () => {
    try {
      await write();
    } catch {
      // Sem armazenamento: vale na memória enquanto o app está aberto.
    }
  });
}

function load(): Promise<void> {
  if (opened || reading) return reading ?? Promise.resolve();
  const started = generation;
  reading = (async () => {
    let raw: string | null = null;
    try {
      raw = await AsyncStorage.getItem(KEY);
    } catch {
      // Sem armazenamento: como se não houvesse nada guardado.
    }
    if (started !== generation) return;
    let map = parseOpenedLists(raw);
    const pending = [...early.entries()].sort(([, a], [, b]) => a - b);
    for (const [listId, at] of pending) map = withOpenedList(map, listId, at);
    opened = map;
    early = new Map();
    reading = null;
    emit();
    if (pending.length) save(() => AsyncStorage.setItem(KEY, serializeOpenedLists(map)));
  })();
  return reading;
}

/** A lista foi aberta (e não está arquivada): passa a ser a mais nova deste aparelho. */
export function rememberOpenedList(listId: string, now: number = Date.now()) {
  if (!opened) {
    // Nada é gravado antes de ler o que estava no aparelho: senão a gravação apagaria as outras listas.
    early.set(listId, now);
    void load();
    return;
  }
  const next = withOpenedList(opened, listId, now);
  if (next === opened) return;
  opened = next;
  emit();
  save(() => AsyncStorage.setItem(KEY, serializeOpenedLists(next)));
}

/** Saiu da conta: as listas abertas aqui eram da casa de quem estava, e a próxima conta começa sem nenhuma. */
export function forgetOpenedLists() {
  generation += 1;
  early = new Map();
  opened = new Map();
  reading = null;
  emit();
  save(() => AsyncStorage.removeItem(KEY));
}

/** As listas abertas neste aparelho e quando; null enquanto a leitura do aparelho não terminou. */
export function useOpenedLists(): ReadonlyMap<string, number> | null {
  useEffect(() => {
    void load();
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => opened,
    () => null,
  );
}
