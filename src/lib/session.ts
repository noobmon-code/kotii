// Sair da conta, sempre só neste aparelho, e o fim da sessão que o app
// descobre sozinho. O padrão do Supabase (scope "global") encerra a conta em
// todos os aparelhos: o outro navegador seguia com o token por até 1 h e as
// funções respondiam 401 (session_not_found). Com "local", a sessão daqui sai
// do servidor e do aparelho (o mesmo SIGNED_OUT de antes: cache, lembretes e
// a chave da sessão cifrada trocada) e as outras ficam.

import { isAuthApiError, isAuthSessionMissingError } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { createSessionGuard, type SessionCheck } from './accessErrors';
import { disableAllReminders } from './reminders';
import { sessionStorage } from './sessionStorage';
import { SESSION_STORAGE_KEY, supabase } from './supabase';

// A tela de entrar avisa que a sessão terminou quando a saída não veio do
// botão "Sair" (a sessão acabou no servidor, ou o 401 de uma função).
let ended = false;
const listeners = new Set<() => void>();

function setEnded(value: boolean) {
  if (ended === value) return;
  ended = value;
  for (const listener of listeners) listener();
}

/** Saídas pedidas por este aparelho em andamento: o SIGNED_OUT delas não é "sessão terminou". */
let signingOut = 0;

// No navegador, o Supabase repassa o SIGNED_OUT às outras abas, onde
// `signingOut` é zero. A hora do toque em "Sair" fica no localStorage (o
// mesmo de todas as abas): um SIGNED_OUT logo depois dela também foi pedido.
// Nome sem a marca: o app vai trocar de nome, e a chave dura só 15 s.
const SIGN_OUT_INTENT_KEY = 'app:signout-intent';
const SIGN_OUT_INTENT_MS = 15_000;

function sharedStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    return Platform.OS === 'web' ? (window.localStorage ?? null) : null;
  } catch {
    return null;
  }
}

function markSignOutIntent() {
  try {
    sharedStorage()?.setItem(SIGN_OUT_INTENT_KEY, String(Date.now()));
  } catch {
    // Sem armazenamento: as outras abas só avisam a mais.
  }
}

function clearSignOutIntent() {
  try {
    sharedStorage()?.removeItem(SIGN_OUT_INTENT_KEY);
  } catch {
    // Idem.
  }
}

/** Alguma aba deste navegador tocou em "Sair" há pouco. */
function signOutRequestedRecently(): boolean {
  try {
    const at = Number(sharedStorage()?.getItem(SIGN_OUT_INTENT_KEY));
    const age = Date.now() - at;
    return at > 0 && age >= 0 && age < SIGN_OUT_INTENT_MS;
  } catch {
    return false;
  }
}

/** `beforeSignOut`: o que ainda precisa do token, logo antes de ele sair do aparelho. */
async function signOutHere(sessionEnded: boolean, beforeSignOut?: () => Promise<void>): Promise<void> {
  setEnded(sessionEnded);
  // Pelo botão, as outras abas também não dizem que a sessão terminou; no
  // 401 (sessionEnded) dizem, e com razão.
  if (!sessionEnded) markSignOutIntent();
  // Antes, os lembretes daqui saem (no navegador, também a inscrição dos
  // avisos), para não tocar o remédio de quem saiu.
  await disableAllReminders().catch(() => undefined);
  await beforeSignOut?.().catch(() => undefined);
  signingOut += 1;
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    // Sem internet e com o token vencido, o Supabase tenta renovar antes de
    // sair, não consegue e devolve o erro com a sessão ainda guardada (sem
    // SIGNED_OUT): o app seguiria na conta, sem os lembretes. Apagada a sessão
    // guardada, o signOut não precisa de rede e avisa o SIGNED_OUT (a limpeza
    // de sempre). A sessão no servidor fica sem ninguém que a use.
    if (error && (await sessionStorage.getItem(SESSION_STORAGE_KEY).catch(() => null))) {
      await sessionStorage.removeItem(SESSION_STORAGE_KEY);
      await supabase.auth.signOut({ scope: 'local' });
    }
  } finally {
    signingOut -= 1;
  }
}

/** Sai da conta neste aparelho (o botão "Sair"); os outros aparelhos continuam. */
export function signOut(): Promise<void> {
  return signOutHere(false);
}

/** Chamado no SIGNED_OUT: sem pedido daqui (nem de outra aba), a sessão terminou por fora. */
export function noteSignedOut() {
  if (!signingOut && !signOutRequestedRecently()) setEnded(true);
}

/** Entrou de novo: o aviso some. */
export function noteSignedIn() {
  clearSignOutIntent();
  setEnded(false);
}

/** A sessão terminou sem a pessoa pedir (a última saída não veio do botão). */
export function isSessionEnded(): boolean {
  return ended;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Para a tela de entrar dizer que a sessão terminou. */
export function useSessionEnded(): boolean {
  return useSyncExternalStore(subscribe, isSessionEnded, isSessionEnded);
}

/**
 * Recusas da renovação que provam que a sessão acabou no servidor. O resto
 * (429, página de erro de um proxy ou de um portal de Wi-Fi, falha de rede,
 * 5xx, outra aba que renovou junto) não prova nada: o próprio Supabase
 * mantém a sessão enquanto o token vale, e o app também.
 */
const SESSION_GONE_CODES = new Set([
  'refresh_token_not_found',
  'refresh_token_already_used',
  'session_not_found',
  'session_expired',
  'user_not_found',
  'user_banned',
]);

export function refreshProvesSessionGone(error: unknown): boolean {
  // Sem sessão guardada (o Supabase já a apagou) ou session_not_found no servidor.
  if (isAuthSessionMissingError(error)) return true;
  if (!isAuthApiError(error)) return false;
  if (error.code) return SESSION_GONE_CODES.has(error.code);
  // Resposta sem código (servidor antigo): "Invalid Refresh Token: ..." também é recusa definitiva.
  return error.status === 400 && /invalid refresh token/i.test(error.message);
}

/** Renova a sessão para saber se ela ainda existe no servidor. */
export async function checkSession(): Promise<SessionCheck> {
  const { data, error } = await supabase.auth.refreshSession();
  if (data.session && !error) return 'valid';
  return error && refreshProvesSessionGone(error) ? 'ended' : 'unknown';
}

/**
 * Uma função respondeu 401: confere a sessão e, se acabou, sai neste
 * aparelho (a tela de entrar aparece). `beforeEnd` roda antes de sair, com
 * o token ainda valendo (apagar o que a chamada enviou). Devolve true quando saiu.
 */
export const endSessionIfGone = createSessionGuard({
  check: checkSession,
  end: (beforeSignOut) => signOutHere(true, beforeSignOut),
});
