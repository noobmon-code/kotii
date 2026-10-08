// Casa aberta neste aparelho (uma conta pode ter várias). Vai em todo pedido
// ao Supabase no cabeçalho x-household-id (ver lib/supabase e a migração
// multiple_households) e fica guardada no aparelho, por conta: cada celular
// abre na casa em que estava.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

export const HOUSEHOLD_HEADER = 'x-household-id';
const STORAGE_KEY = 'kotii:active-household';

let current: string | null = null;
/** De quem é a casa carregada (a escolha é por conta). */
let loadedFor: string | null = null;
const listeners = new Set<() => void>();

async function readStored(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function emit(id: string | null) {
  if (id === current) return;
  current = id;
  for (const listener of listeners) listener();
}

/** A casa aberta agora (null: ainda nenhuma; o servidor usa a primeira da pessoa). */
export function getActiveHousehold(): string | null {
  return current;
}

/**
 * Ao entrar (ou abrir o app): volta para a casa em que este aparelho estava.
 * Uma vez por conta; antes de qualquer pedido dela.
 */
export async function loadActiveHousehold(userId: string): Promise<void> {
  if (loadedFor === userId) return;
  const stored = (await readStored())[userId] ?? null;
  if (loadedFor === userId) return;
  loadedFor = userId;
  emit(stored);
}

/** Abre outra casa neste aparelho (null: nenhuma, a pessoa saiu da última). */
let saving: Promise<void> = Promise.resolve();

export function setActiveHousehold(userId: string, householdId: string | null): Promise<void> {
  loadedFor = userId;
  emit(householdId);
  // Uma gravação por vez: duas trocas seguidas não gravam uma por cima da outra.
  saving = saving.then(async () => {
    const stored = await readStored();
    if (householdId) stored[userId] = householdId;
    else delete stored[userId];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stored)).catch(() => undefined);
  });
  return saving;
}

/** Saiu da conta: os pedidos deixam de levar a casa (a escolha fica para a volta). */
export function forgetActiveHousehold() {
  loadedFor = null;
  emit(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Avisa quando a casa aberta muda (troca de casa, saída da conta). Devolve o cancelamento. */
export function onActiveHouseholdChange(listener: () => void): () => void {
  const unsubscribe = subscribe(listener);
  return () => {
    unsubscribe();
  };
}

export function useActiveHouseholdId(): string | null {
  return useSyncExternalStore(subscribe, getActiveHousehold, getActiveHousehold);
}

/** `fetch` que acrescenta a casa aberta aos pedidos (o que já leva uma casa fica como está). */
export function fetchWithHousehold(fetchImpl: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    const id = current;
    if (!id) return fetchImpl(input, init);
    const headers = new Headers(init?.headers);
    if (!headers.has(HOUSEHOLD_HEADER)) headers.set(HOUSEHOLD_HEADER, id);
    return fetchImpl(input, { ...init, headers });
  };
}
