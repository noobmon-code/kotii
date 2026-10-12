// O que dizer à pessoa quando o link do e-mail não deu certo (lib/recoveryLink). Fica só na memória:
// a tela de entrar mostra, com "Esqueci minha senha" já aberto; com uma conta aberta, vira um aviso
// depois que a tela aparece (app/_layout). Recarregar a página não repete: o endereço já foi limpo.

import { useSyncExternalStore } from 'react';

let notice: string | null = null;
const listeners = new Set<() => void>();

export function setLinkNotice(message: string | null) {
  if (notice === message) return;
  notice = message;
  for (const listener of listeners) listener();
}

/** O aviso foi visto (ou a pessoa seguiu adiante): some. */
export function clearLinkNotice() {
  setLinkNotice(null);
}

export function linkNotice(): string | null {
  return notice;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Para as telas mostrarem o que o link deixou para dizer. */
export function useLinkNotice(): string | null {
  return useSyncExternalStore(subscribe, linkNotice, linkNotice);
}
