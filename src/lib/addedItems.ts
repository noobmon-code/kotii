// Os itens que este aparelho pôs em cada lista, e quando: na ida ao mercado, o selo "Novo" é só para o que a casa
// pôs depois do aviso (domain/marketTrips, newDuringTrip), e a pessoa que está no mercado já sabe do que ela mesma
// pôs. Fica na memória e no AsyncStorage, para valer também depois de fechar o app no meio das compras. Só
// enquanto há ida: a lista sem ida esquece tudo, e a com ida esquece o que veio bem antes dela (pruneAddedItems).
// Sem armazenamento (modo privado, cota cheia), vale enquanto o app está aberto.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

const PREFIX = 'kotii:added-items:';
const storageKey = (listId: string) => `${PREFIX}${listId}`;

/** Um item posto por este aparelho; `at` no relógio do aparelho. */
interface Added {
  id: string;
  at: number;
}

/** O relógio do aparelho pode estar atrás do servidor: o que veio até 10 min antes da ida ainda fica. */
const CLOCK_MARGIN_MS = 10 * 60 * 1000;
const EMPTY: ReadonlySet<string> = new Set();

const entries = new Map<string, Added[]>();
/** O conjunto de ids de cada lista, refeito a cada mudança (a tela compara pela referência). */
const idSets = new Map<string, ReadonlySet<string>>();
/** As listas que esta abertura do app já leu do aparelho. */
const loaded = new Set<string>();
const listeners = new Set<() => void>();
let generation = 0;
/** Uma gravação de cada vez: a ordem dos toques é a do aparelho. */
let saving: Promise<void> = Promise.resolve();

const emit = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function parse(raw: string | null): Added[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (entry): entry is Added =>
        Boolean(entry) && typeof entry.id === 'string' && typeof entry.at === 'number' && Number.isFinite(entry.at),
    );
  } catch {
    return [];
  }
}

/** Uma ida dura 2 horas: o que tem mais de um dia não serve mais (nem na lista que não foi aberta desde então). */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const fresh = (list: Added[]) => {
  const since = Date.now() - MAX_AGE_MS;
  return list.filter((entry) => entry.at > since);
};

function set(listId: string, all: Added[]) {
  const list = fresh(all);
  if (list.length) entries.set(listId, list);
  else entries.delete(listId);
  idSets.set(listId, new Set(list.map((entry) => entry.id)));
  emit();
  const key = storageKey(listId);
  const value = list.length ? JSON.stringify(list) : null;
  saving = saving.then(async () => {
    try {
      if (value) await AsyncStorage.setItem(key, value);
      else await AsyncStorage.removeItem(key);
    } catch {
      // Sem armazenamento: vale na memória.
    }
  });
}

async function load(listId: string) {
  if (loaded.has(listId)) return;
  loaded.add(listId);
  const started = generation;
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(storageKey(listId));
  } catch {
    // Sem armazenamento: só o que esta abertura do app pôs.
  }
  if (started !== generation) return;
  const parsed = parse(raw);
  const stored = fresh(parsed);
  if (!stored.length) {
    // Só havia o que já passou de um dia: sai do aparelho também.
    if (parsed.length && !entries.get(listId)?.length) set(listId, []);
    return;
  }
  // O que foi posto enquanto a leitura andava também fica.
  const now = entries.get(listId) ?? [];
  const ids = new Set(now.map((entry) => entry.id));
  set(listId, [...stored.filter((entry) => !ids.has(entry.id)), ...now]);
}

/** Guarda os ids que este aparelho acabou de pôr na lista. */
export function rememberAdded(listId: string, ids: readonly string[], now: number = Date.now()) {
  if (!ids.length) return;
  // A leitura do que estava guardado sai antes da gravação: o de antes não se perde.
  void load(listId);
  set(listId, [...(entries.get(listId) ?? []), ...ids.map((id) => ({ id, at: now }))]);
}

/** Os ids que este aparelho pôs na lista (os já lidos do aparelho). */
export function addedHere(listId: string): ReadonlySet<string> {
  return idSets.get(listId) ?? EMPTY;
}

/**
 * Sem ida (`tripStart` null), a lista esquece o que este aparelho pôs; com ida, o que veio bem antes dela (já
 * nasceu antes do aviso e não teria o selo).
 */
export function pruneAddedItems(listId: string, tripStart: string | null) {
  const list = entries.get(listId);
  if (!list?.length) return;
  const since = tripStart ? Date.parse(tripStart) - CLOCK_MARGIN_MS : Infinity;
  const kept = Number.isNaN(since) ? list : list.filter((entry) => entry.at >= since);
  if (kept.length !== list.length) set(listId, kept);
}

/** Saiu da conta: o que estava guardado de cada lista sai da memória e do aparelho. */
export function forgetAddedItems() {
  generation += 1;
  entries.clear();
  idSets.clear();
  loaded.clear();
  emit();
  saving = saving.then(async () => {
    try {
      const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(PREFIX));
      if (keys.length) await AsyncStorage.multiRemove(keys);
    } catch {
      // Sem armazenamento: não havia o que apagar.
    }
  });
}

/** Os ids que este aparelho pôs na lista, lidos do aparelho ao abrir e atualizados a cada item posto. */
export function useAddedItems(listId: string): ReadonlySet<string> {
  useEffect(() => {
    void load(listId);
  }, [listId]);
  return useSyncExternalStore(
    subscribe,
    () => addedHere(listId),
    () => EMPTY,
  );
}
