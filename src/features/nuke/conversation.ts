// Conversa com o Nuke: fica na memória enquanto o app está aberto (uma
// resposta que chega com a tela fechada não se perde) e no aparelho, por
// pessoa, para continuar depois.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

import type { NukeMessage } from '@/domain/nuke';

const KEEP = 40;
const storageKey = (userId: string) => `nuke:conversation:${userId}`;
const EMPTY: NukeMessage[] = [];

let owner: string | null = null;
let messages: NukeMessage[] = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function load(userId: string) {
  if (owner === userId) return;
  owner = userId;
  messages = EMPTY;
  emit();
  const raw = await AsyncStorage.getItem(storageKey(userId)).catch(() => null);
  if (owner !== userId || !raw) return;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      messages = parsed as NukeMessage[];
      emit();
    }
  } catch {
    // conversa salva corrompida: começa de novo
  }
}

/** Atualiza a conversa de `userId` (ignora se outra pessoa entrou no meio). */
export function updateConversation(userId: string, update: (current: NukeMessage[]) => NukeMessage[]) {
  if (owner !== userId) return;
  messages = update(messages).slice(-KEEP);
  emit();
  AsyncStorage.setItem(storageKey(userId), JSON.stringify(messages)).catch(() => undefined);
}

export function clearConversation(userId: string) {
  updateConversation(userId, () => EMPTY);
}

export function useNukeConversation(userId: string | undefined): NukeMessage[] {
  useEffect(() => {
    if (userId) load(userId);
  }, [userId]);
  const current = useSyncExternalStore(subscribe, () => messages);
  return userId && owner === userId ? current : EMPTY;
}

let counter = 0;
export function newMessageId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}
