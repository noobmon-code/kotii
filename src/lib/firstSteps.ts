// A dispensa dos "Primeiros passos" da tela Hoje, por casa, guardada neste aparelho (no navegador, o AsyncStorage
// usa o localStorage): pelo "Dispensar", ou com os quatro passos feitos (o cartão não volta para uma casa que já
// andou). Não vai para o banco: é só um cartão de orientação, e cada aparelho dispensa o seu. Sem armazenamento
// (modo privado, cota cheia), a dispensa dura enquanto o app está aberto.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

const PREFIX = 'kotii:first-steps-dismissed:';
const storageKey = (householdId: string) => `${PREFIX}${householdId}`;

/** O que esta abertura do app já sabe de cada casa (lido do aparelho, ou dispensado agora). */
const known = new Map<string, boolean>();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function load(householdId: string) {
  if (known.has(householdId)) return;
  let dismissed = false;
  try {
    dismissed = (await AsyncStorage.getItem(storageKey(householdId))) === '1';
  } catch {
    // Sem armazenamento: como se nunca tivesse sido dispensado.
  }
  // Dispensado enquanto a leitura andava: vale o toque.
  if (known.has(householdId)) return;
  known.set(householdId, dismissed);
  emit();
}

/** Dispensa os primeiros passos da casa (o toque, ou os quatro feitos): some já, e fica guardado no aparelho. */
export function dismissFirstSteps(householdId: string) {
  known.set(householdId, true);
  emit();
  AsyncStorage.setItem(storageKey(householdId), '1').catch(() => undefined);
}

/** Se a casa dispensou os primeiros passos neste aparelho; undefined enquanto lê (e sem casa). */
export function useFirstStepsDismissed(householdId: string | undefined): boolean | undefined {
  useEffect(() => {
    if (householdId) void load(householdId);
  }, [householdId]);
  return useSyncExternalStore(
    subscribe,
    () => (householdId ? known.get(householdId) : undefined),
    () => undefined,
  );
}
