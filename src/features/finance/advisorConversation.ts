// Conversa com o Nuke consultor: só na memória, enquanto o app está aberto
// (uma resposta que chega com a tela fechada não se perde). Nada vai para o
// aparelho: fala de dinheiro e banco não fica guardada. Fechar o app, sair da
// conta ou trocar de casa apaga a conversa.

import { useEffect, useSyncExternalStore } from 'react';

import type { FinanceMessage } from '@/domain/financeAdvisor';
import { supabase } from '@/lib/supabase';

const KEEP = 40;
const EMPTY: FinanceMessage[] = [];

/** A conversa é de uma pessoa numa casa (a liberação também é). */
export const financeConversationOwner = (userId: string, householdId: string) => `${userId}:${householdId}`;

let owner: string | null = null;
let messages: FinanceMessage[] = EMPTY;
// Pergunta esperando resposta: fica aqui, e não na tela, para que fechar e
// reabrir a conversa não libere uma segunda pergunta fora de ordem.
let pending = false;
let state: { owner: string | null; messages: FinanceMessage[]; pending: boolean } = { owner, messages, pending };
// Muda a cada conversa apagada ou trocada: resposta de uma pergunta feita
// antes não entra na conversa nova.
let epoch = 0;
const listeners = new Set<() => void>();

function emit() {
  state = { owner, messages, pending };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function reset(next: string | null) {
  epoch += 1;
  owner = next;
  messages = EMPTY;
  pending = false;
  emit();
}

/** Abre a conversa de `id`; a de outra pessoa ou casa some da memória. */
export function openFinanceConversation(id: string) {
  if (owner !== id) reset(id);
}

/** Marca de agora; passada a updateFinanceConversation, descarta a mudança se a conversa mudou depois. */
export function financeConversationEpoch(): number {
  return epoch;
}

/** Atualiza a conversa de `id`. Ignora se outra conversa foi aberta ou se esta foi apagada depois de `since`. */
export function updateFinanceConversation(
  id: string,
  update: (current: FinanceMessage[]) => FinanceMessage[],
  since = epoch,
) {
  if (owner !== id || since !== epoch) return;
  messages = update(messages).slice(-KEEP);
  emit();
}

/** Marca que há uma pergunta de `id` esperando resposta. */
export function setFinancePending(id: string, value: boolean, since = epoch) {
  if (owner !== id || since !== epoch) return;
  pending = value;
  emit();
}

/** Apaga a conversa de `id`. */
export function clearFinanceConversation(id: string) {
  if (owner === id) reset(id);
}

// Saiu da conta: a conversa sai da memória na hora, sem esperar outra pessoa entrar.
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' && owner !== null) reset(null);
});

const IDLE = { messages: EMPTY, pending: false };

export function useFinanceConversation(id: string | undefined): { messages: FinanceMessage[]; pending: boolean } {
  useEffect(() => {
    if (id) openFinanceConversation(id);
  }, [id]);
  const current = useSyncExternalStore(subscribe, () => state, () => state);
  return id && current.owner === id ? current : IDLE;
}

let counter = 0;
export function newFinanceMessageId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}
