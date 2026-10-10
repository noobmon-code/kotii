// Recuperação de senha. "Esqueci minha senha" (tela de entrar) manda um
// e-mail com um código; o código (verifyOtp, tipo recovery) abre uma sessão
// de recuperação, e a conta só vê a tela da senha nova (app/nova-senha) até
// salvar uma. A marca de qual conta está nisso fica no aparelho: vale depois
// de recarregar a página, em outra aba e no app reaberto. Ela só sai quando
// a senha nova é salva (USER_UPDATED), quando a pessoa desiste ("Cancelar e
// sair") ou quando entra com a senha; uma saída por fora (a sessão que
// venceu) não tira a marca.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

const MARK_KEY = 'kotii:password-recovery';

interface RecoveryState {
  /** A conta que precisa criar a senha nova (a marca do aparelho). */
  userId: string | null;
  /** A conta cuja marca já foi lida do aparelho: antes disso, a tela espera. */
  readFor: string | null;
}

let state: RecoveryState = { userId: null, readFor: null };
/** Muda a cada marca posta ou tirada: uma leitura que começou antes vale menos. */
let version = 0;
const listeners = new Set<() => void>();

function setState(next: RecoveryState) {
  if (next.userId === state.userId && next.readFor === state.readFor) return;
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => state;

/** A conta entrou pelo código do e-mail: fica na senha nova até salvar. */
export function startRecovery(userId: string) {
  version += 1;
  setState({ userId, readFor: userId });
  AsyncStorage.setItem(MARK_KEY, userId).catch(() => undefined);
}

/** Salvou a senha nova, desistiu ou entrou com a senha: tira a marca. */
export function finishRecovery() {
  version += 1;
  setState({ userId: null, readFor: state.readFor });
  AsyncStorage.removeItem(MARK_KEY).catch(() => undefined);
}

/**
 * A sessão saiu (aqui ou em outra aba): esquece a marca só na memória. O
 * aparelho continua com ela, e a próxima conta que entrar a lê de novo (a
 * entrada com a senha tira, o código põe outra).
 */
export function forgetRecoveryInMemory() {
  version += 1;
  setState({ userId: null, readFor: null });
}

/**
 * Lê a marca do aparelho para a conta que apareceu (sessão guardada, outra
 * aba, app reaberto). Até terminar, useRecovery diz 'reading' e a tela espera.
 */
export async function readRecovery(userId: string): Promise<void> {
  const at = version;
  let saved: string | null = null;
  try {
    saved = await AsyncStorage.getItem(MARK_KEY);
  } catch {
    saved = null;
  }
  // A marca foi posta ou tirada enquanto lia: vale o que acabou de acontecer. A posta aqui mesmo para
  // esta conta vale ainda que o aparelho não tenha terminado de gravar.
  const kept = state.userId === userId ? userId : saved;
  setState({ userId: version === at ? kept : state.userId, readFor: userId });
}

export type RecoveryGate = 'reading' | 'new-password' | 'free';

/** Para a conta aberta: ainda lendo a marca, precisa da senha nova, ou segue normal. */
export function recoveryGate(current: RecoveryState, userId: string | undefined): RecoveryGate {
  if (!userId) return 'free';
  if (current.readFor !== userId) return 'reading';
  return current.userId === userId ? 'new-password' : 'free';
}

export function useRecovery(userId: string | undefined): RecoveryGate {
  return recoveryGate(useSyncExternalStore(subscribe, snapshot, snapshot), userId);
}

/** A conta que precisa da senha nova (a tela confere antes de salvar). */
export function recoveringUserId(): string | null {
  return state.userId;
}
