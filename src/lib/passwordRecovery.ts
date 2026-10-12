// Recuperação de senha. "Esqueci minha senha" (tela de entrar) manda um
// e-mail com um link ou um código; o link (lib/recoveryLink) ou o código
// (verifyOtp, tipo recovery) abre uma sessão de recuperação, e a conta só vê
// a tela da senha nova (app/nova-senha) até salvar uma. A marca de qual conta
// está nisso fica no aparelho: vale depois de recarregar a página, em outra
// aba (que a recebe na hora, pelo evento "storage") e no app reaberto. Ela só
// sai quando a senha nova é salva (USER_UPDATED), quando a pessoa desiste
// ("Cancelar e sair") ou quando entra com a senha; uma saída por fora (a
// sessão que venceu) não tira a marca.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

const MARK_KEY = 'kotii:password-recovery';
// Quem pôs a marca por último. Duas abas podem pôr a marca da mesma conta (o valor fica igual e a outra
// aba nem é avisada): só a tentativa que pôs por último pode desfazer a sua.
const MARK_BY_KEY = 'kotii:password-recovery-by';

const newAttempt = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

interface RecoveryState {
  /** A conta que precisa criar a senha nova (a marca do aparelho). */
  userId: string | null;
  /** A conta cuja marca já foi lida do aparelho: antes disso, a tela espera. */
  readFor: string | null;
}

let state: RecoveryState = { userId: null, readFor: null };
/** Muda a cada marca posta ou tirada: uma leitura que começou antes vale menos. */
let version = 0;
/** A leitura mais nova: uma anterior (de outra conta, na troca de conta) que termine depois não vale. */
let lastRead = 0;
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

// Uma mudança da marca no aparelho por vez, também entre abas (como os lembretes, em lib/reminders):
// conferir de quem é a marca e desfazê-la precisam ser uma coisa só, senão a outra aba grava a dela no
// meio e a perde.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const locked = () =>
    Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.locks
      ? (navigator.locks.request('kotii-recuperacao', task) as Promise<T>)
      : task();
  const run = queue.then(locked, locked);
  queue = run.catch(() => undefined);
  return run;
}

/** A conta entrou pelo código do e-mail (pelo link é beginRecovery): fica na senha nova até salvar. */
export function startRecovery(userId: string) {
  version += 1;
  setState({ userId, readFor: userId });
  serialized(() =>
    AsyncStorage.multiSet([
      [MARK_KEY, userId],
      [MARK_BY_KEY, newAttempt()],
    ]),
  ).catch(() => undefined);
}

/**
 * O link do e-mail: a marca entra antes da sessão, e só volta daqui depois de gravada, para as outras
 * abas a acharem quando a conta chegar. Se não der para ler a que estava lá (sem ela não há como desfazer
 * direito) ou para gravar a nova, falha: sem a marca no aparelho a sessão não pode entrar (recarregada a
 * página, ou em outra aba, a conta abriria a casa sem a senha nova).
 * Devolve como desfazer, se a sessão não entrar: a memória e o aparelho voltam ao que eram (a marca
 * que já estava lá, inclusive desta conta, fica), a não ser que a marca tenha mudado de mãos nesse
 * meio (outra aba pôs ou tirou): aí vale o que veio depois.
 */
export async function beginRecovery(userId: string): Promise<() => Promise<void>> {
  let stored: string | null = null;
  let storedBy: string | null = null;
  const memory = state;
  const attempt = newAttempt();
  version += 1;
  const mine = version;
  setState({ userId, readFor: userId });
  try {
    // O que estava lá e a marca nova, numa operação só: o desfazer devolve exatamente o que esta tentativa tirou.
    await serialized(async () => {
      [[, stored], [, storedBy]] = await AsyncStorage.multiGet([MARK_KEY, MARK_BY_KEY]);
      await AsyncStorage.multiSet([
        [MARK_KEY, userId],
        [MARK_BY_KEY, attempt],
      ]);
    });
  } catch (error) {
    if (version === mine) {
      version += 1;
      setState(memory);
    }
    throw error;
  }
  return () => {
    // A memória só volta se ninguém mexeu na marca depois (aqui, ou outra aba pelo evento "storage").
    if (version === mine) {
      version += 1;
      setState(memory);
    }
    // Conferir e desfazer de uma vez só: a marca que outra aba puser entra depois, e fica.
    return serialized(async () => {
      try {
        const [[, marker], [, by]] = await AsyncStorage.multiGet([MARK_KEY, MARK_BY_KEY]);
        if (marker !== userId || by !== attempt) return;
        const back: [string, string][] = [];
        const gone: string[] = [];
        if (stored === null) gone.push(MARK_KEY);
        else back.push([MARK_KEY, stored]);
        if (storedBy === null) gone.push(MARK_BY_KEY);
        else back.push([MARK_BY_KEY, storedBy]);
        if (back.length) await AsyncStorage.multiSet(back);
        if (gone.length) await AsyncStorage.multiRemove(gone);
      } catch {
        // Sem conseguir ler ou gravar, a marca fica: pede a senha nova a mais, nunca a menos.
      }
    });
  };
}

/**
 * A sessão do link entrou: a marca do aparelho precisa ser a desta conta. Entre a marca posta
 * (beginRecovery) e a sessão, outra aba pode ter posto a marca de outra conta; aí esta volta a valer,
 * porque a sessão que ficou no aparelho é a desta. Se não der para conferir ou gravar, falha (e quem
 * chamou tira a sessão: sem a marca, ela abriria a casa sem a senha nova).
 */
export async function ensureRecovery(userId: string): Promise<void> {
  version += 1;
  setState({ userId, readFor: userId });
  await serialized(async () => {
    if ((await AsyncStorage.getItem(MARK_KEY)) === userId) return;
    await AsyncStorage.multiSet([
      [MARK_KEY, userId],
      [MARK_BY_KEY, newAttempt()],
    ]);
  });
}

/**
 * Salvou a senha nova, desistiu ou entrou com a senha: tira a marca. Antes
 * de entrar com a senha, espere terminar: a leitura da conta que entrar não
 * pode achar a marca velha no aparelho.
 */
export async function finishRecovery(): Promise<void> {
  version += 1;
  setState({ userId: null, readFor: state.readFor });
  await serialized(() => AsyncStorage.multiRemove([MARK_KEY, MARK_BY_KEY])).catch(() => undefined);
}

/**
 * A sessão saiu (aqui ou em outra aba): esquece a marca só na memória. O
 * aparelho continua com ela, e a próxima conta que entrar a lê de novo (a
 * entrada com a senha tira, o link ou código põe outra).
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
  lastRead += 1;
  const read = lastRead;
  let saved: string | null = null;
  try {
    saved = await AsyncStorage.getItem(MARK_KEY);
  } catch {
    saved = null;
  }
  if (read !== lastRead) return;
  // A marca foi posta ou tirada enquanto lia: vale o que acabou de acontecer. A posta aqui mesmo para
  // esta conta vale ainda que o aparelho não tenha terminado de gravar.
  const kept = state.userId === userId ? userId : saved;
  setState({ userId: version === at ? kept : state.userId, readFor: userId });
}

/**
 * A marca posta ou tirada por outra aba (evento "storage" do navegador) vale nesta também: a aba que
 * já estava na mesma conta vai para a senha nova sem recarregar, e sai dela quando a marca sai. Outra
 * chave não muda nada; `key` null é o localStorage.clear(), que leva a marca junto.
 */
export function recoveryAfterStorage(current: RecoveryState, key: string | null, newValue: string | null): RecoveryState {
  if (key !== null && key !== MARK_KEY) return current;
  return { userId: key === null ? null : newValue || null, readFor: current.readFor };
}

// No navegador o AsyncStorage é o localStorage, com a mesma chave. No celular há `window`, mas sem
// addEventListener (e sem outras abas).
if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    try {
      if (event.storageArea !== window.localStorage) return;
    } catch {
      return;
    }
    const next = recoveryAfterStorage(state, event.key, event.newValue);
    if (next === state) return;
    // Uma leitura em andamento não passa por cima do que a outra aba acabou de fazer.
    version += 1;
    setState(next);
  });
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

/** O mesmo de useRecovery, fora de um componente. */
export function recoveryGateNow(userId: string | undefined): RecoveryGate {
  return recoveryGate(state, userId);
}

/** A conta que precisa da senha nova (a tela confere antes de salvar). */
export function recoveringUserId(): string | null {
  return state.userId;
}
