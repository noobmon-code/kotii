// Roda antes de o expo-router carregar (ver index.js, na raiz). O router guarda o endereço da página
// assim que o módulo dele é avaliado e, mais tarde, regrava a barra de endereço com o fragmento que
// viu: se os tokens do link de recuperação ainda estivessem lá, voltariam. Por isso o endereço é lido
// e limpo aqui, e o que foi lido fica na memória para lib/auth (nada em `window`).
// No celular não há endereço nem histórico: não faz nada.

import { LINK_REJECTED, parseRecoveryLink, type CapturedLink } from './recoveryLink';

/** Só o que este módulo usa da janela. */
interface BootWindow {
  location?: { href?: string };
  history?: { state: unknown; replaceState?: (state: unknown, unused: string, url: string) => void };
}

/** Lê o link do endereço e o limpa. Sem endereço ou histórico (celular), ou sem link, null. */
export function captureRecoveryLink(win: BootWindow | undefined): CapturedLink | null {
  try {
    const href = win?.location?.href;
    const history = win?.history;
    if (!href || typeof history?.replaceState !== 'function') return null;
    const link = parseRecoveryLink(href);
    if (!link) return null;
    try {
      history.replaceState(history.state, '', link.cleanUrl);
    } catch {
      // Não estabelece uma sessão deixando os tokens no endereço.
      return { error: LINK_REJECTED };
    }
    return link.tokens ? { tokens: link.tokens } : { error: link.error };
  } catch {
    return null;
  }
}

let captured = captureRecoveryLink(typeof window !== 'undefined' ? window : undefined);

/** O link que o endereço trazia quando o app abriu. Entrega uma vez: os tokens não ficam guardados aqui. */
export function takeRecoveryLink(): CapturedLink | null {
  const link = captured;
  captured = null;
  return link;
}
