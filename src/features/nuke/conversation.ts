// Conversa com o Nuke: fica na memória enquanto o app está aberto (uma
// resposta que chega com a tela fechada não se perde) e no aparelho, por
// pessoa, para continuar depois.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

import type { NukeMessage } from '@/domain/nuke';

const KEEP = 40;
const storageKey = (userId: string) => `nuke:conversation:${userId}`;

/** A conversa é de uma pessoa numa casa: cada casa tem a sua. */
export const conversationOwner = (userId: string, householdId: string) => `${userId}:${householdId}`;
const EMPTY: NukeMessage[] = [];

let owner: string | null = null;
let messages: NukeMessage[] = EMPTY;
// Pergunta esperando resposta: fica aqui, e não na tela, para que fechar e
// reabrir a conversa não libere uma segunda pergunta fora de ordem.
let pending = false;
let state = { messages, pending };
// Muda a cada conversa apagada: resposta de uma pergunta feita antes não
// entra na conversa nova (nem na casa nova, depois de sair de uma).
let epoch = 0;
const listeners = new Set<() => void>();

function emit() {
  state = { messages, pending };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Carrega a conversa salva de `userId` (a tela chama pelo hook). */
export async function loadConversation(userId: string) {
  if (owner === userId) return;
  owner = userId;
  messages = EMPTY;
  pending = false;
  emit();
  const since = epoch;
  let raw = await AsyncStorage.getItem(storageKey(userId)).catch(() => null);
  // Conversa de antes das várias casas (guardada só pela pessoa): passa para
  // a primeira casa em que o Nuke é aberto.
  const legacy = userId.includes(':') ? storageKey(userId.split(':')[0]) : null;
  if (!raw && legacy) {
    raw = await AsyncStorage.getItem(legacy).catch(() => null);
    if (raw) {
      await AsyncStorage.setItem(storageKey(userId), raw).catch(() => undefined);
      await AsyncStorage.removeItem(legacy).catch(() => undefined);
    }
  }
  if (owner !== userId || since !== epoch || !raw) return;
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

/** Marca de agora; passada a updateConversation, descarta a mudança se a conversa foi apagada depois. */
export function conversationEpoch(): number {
  return epoch;
}

/**
 * Atualiza a conversa de `userId`. Ignora se outra pessoa entrou no meio ou
 * se a conversa foi apagada depois de `since`.
 */
export function updateConversation(userId: string, update: (current: NukeMessage[]) => NukeMessage[], since = epoch) {
  if (owner !== userId || since !== epoch) return;
  messages = update(messages).slice(-KEEP);
  emit();
  AsyncStorage.setItem(storageKey(userId), JSON.stringify(messages)).catch(() => undefined);
}

/** Apaga a conversa de `userId`, no aparelho também, mesmo sem ela ter sido aberta. */
export function clearConversation(userId: string) {
  epoch += 1;
  AsyncStorage.removeItem(storageKey(userId)).catch(() => undefined);
  if (owner !== userId) return;
  messages = EMPTY;
  pending = false;
  emit();
}

/** Marca que há uma pergunta de `userId` esperando resposta. */
export function setPending(userId: string, value: boolean, since = epoch) {
  if (owner !== userId || since !== epoch) return;
  pending = value;
  emit();
}

const IDLE = { messages: EMPTY, pending: false };

export function useNukeConversation(userId: string | undefined): { messages: NukeMessage[]; pending: boolean } {
  useEffect(() => {
    if (userId) loadConversation(userId);
  }, [userId]);
  const current = useSyncExternalStore(subscribe, () => state);
  return userId && owner === userId ? current : IDLE;
}

let counter = 0;
export function newMessageId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}
