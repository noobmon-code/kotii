// A dispensa dos "Primeiros passos" da tela Hoje, por casa, guardada neste aparelho (no navegador, o AsyncStorage
// usa o localStorage): pelo "Dispensar", ou com os passos todos feitos (o cartão não volta para uma casa que já
// andou). E o passo pulado (o da despensa), guardado do mesmo jeito. Não vai para o banco: é só um cartão de orientação, e cada aparelho dispensa o seu. Sem armazenamento
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

// ---------------------------------------------------------------------------
// O passo pulado ("Pular" no passo da despensa): sai do cartão desta casa, neste aparelho, como a dispensa.

const SKIPPED_PREFIX = 'kotii:first-steps-skipped:';
const skippedKey = (householdId: string) => `${SKIPPED_PREFIX}${householdId}`;
const NONE: ReadonlySet<string> = new Set();

/** Os passos pulados de cada casa, como esta abertura do app já sabe (um conjunto novo a cada mudança). */
const skippedKnown = new Map<string, ReadonlySet<string>>();

async function loadSkipped(householdId: string) {
  if (skippedKnown.has(householdId)) return;
  let stored: ReadonlySet<string> = NONE;
  try {
    const raw = await AsyncStorage.getItem(skippedKey(householdId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) stored = new Set(parsed.filter((key): key is string => typeof key === 'string'));
  } catch {
    // Sem armazenamento, ou guardado estragado: como se nada tivesse sido pulado.
  }
  // Pulado enquanto a leitura andava: vale o toque (com o que estava guardado).
  const tapped = skippedKnown.get(householdId);
  skippedKnown.set(householdId, tapped ? new Set([...stored, ...tapped]) : stored);
  emit();
}

/** Pula um passo desta casa: sai do cartão já, e fica guardado no aparelho. */
export function skipFirstStep(householdId: string, step: string) {
  const next = new Set([...(skippedKnown.get(householdId) ?? NONE), step]);
  skippedKnown.set(householdId, next);
  emit();
  AsyncStorage.setItem(skippedKey(householdId), JSON.stringify([...next])).catch(() => undefined);
}

/** Os passos que a casa pulou neste aparelho; undefined enquanto lê (e sem casa). */
export function useFirstStepsSkipped(householdId: string | undefined): ReadonlySet<string> | undefined {
  useEffect(() => {
    if (householdId) void loadSkipped(householdId);
  }, [householdId]);
  return useSyncExternalStore(
    subscribe,
    () => (householdId ? skippedKnown.get(householdId) : undefined),
    () => undefined,
  );
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
