// "Onde estou": o mercado em que a pessoa disse estar, por lista, e quando disse (vale 6 horas,
// currentStoreChoice). Fica neste aparelho (não é um dado da casa: cada um está num lugar), na memória e no
// AsyncStorage, para não sumir ao fechar a lista ou o app no meio das compras. A lista e "Onde comprar" ("Vou
// neste") escolhem por aqui. Sem armazenamento (modo privado, cota cheia), a escolha dura enquanto o app está aberto.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

import { parseStoreChoice, type StoreChoice } from '@/domain/listEstimate';

const PREFIX = 'kotii:store-choice:';
const storageKey = (listId: string) => `${PREFIX}${listId}`;

/** A escolha de cada lista que esta abertura do app já conhece (lida do aparelho ou feita agora); null: nenhuma. */
const known = new Map<string, StoreChoice | null>();
const listeners = new Set<() => void>();
/** Sobe a cada saída da conta: uma leitura que começou antes não traz de volta a escolha de quem saiu. */
let generation = 0;

const emit = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Lê do aparelho a escolha da lista, se esta abertura do app ainda não a conhece. */
async function load(listId: string) {
  if (known.has(listId)) return;
  const started = generation;
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(storageKey(listId));
  } catch {
    // Sem armazenamento: como se não houvesse escolha.
  }
  // A pessoa escolheu enquanto a leitura andava, ou saiu da conta: vale o de agora.
  if (known.has(listId) || started !== generation) return;
  known.set(listId, parseStoreChoice(raw));
  emit();
}

/** Escolhe o mercado da lista (null tira a escolha), na memória já e no aparelho. */
export function chooseStore(listId: string, storeId: string | null, now: number = Date.now()) {
  const choice = storeId ? { storeId, at: now } : null;
  known.set(listId, choice);
  emit();
  const key = storageKey(listId);
  (choice ? AsyncStorage.setItem(key, JSON.stringify(choice)) : AsyncStorage.removeItem(key)).catch(() => undefined);
}

/**
 * Saiu da conta: as escolhas de todas as listas saem da memória e do aparelho (as listas eram da casa de quem
 * estava aqui).
 */
export function forgetStoreChoices() {
  generation += 1;
  known.clear();
  emit();
  void (async () => {
    try {
      const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(PREFIX));
      if (keys.length) await AsyncStorage.multiRemove(keys);
    } catch {
      // Sem armazenamento: não havia o que apagar.
    }
  })();
}

/** A escolha guardada da lista (ainda sem passar pelas 6 horas: quem usa chama currentStoreChoice). */
export function useStoreChoice(listId: string): StoreChoice | null {
  useEffect(() => {
    void load(listId);
  }, [listId]);
  return useSyncExternalStore(
    subscribe,
    () => known.get(listId) ?? null,
    () => null,
  );
}
