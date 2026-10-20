// O pedido que não chegou ao servidor (sem internet, ou sinal fraco com o
// aparelho ainda dizendo que há internet). Puro, num lugar só: o aviso comum
// (errorMessage), o das idas ao mercado e o de entrar na conta usam a mesma
// detecção.

/** A frase para o pedido que não chegou, quando a tela não tem uma própria. */
export const OFFLINE_TRY_AGAIN = 'Sem internet agora. Tente de novo quando a conexão voltar.';

// O texto do fetch que falhou em cada lugar: "Network request failed" (ou
// "Network request timed out", quando o sinal some no meio) no celular,
// "Failed to fetch" no Chrome, "Load failed" no Safari e "NetworkError when
// attempting to fetch resource." no Firefox. Não basta ser um TypeError: o
// erro de programa ("Cannot read properties...") também é.
const NETWORK_FAILURE = /failed to fetch|network request (?:failed|timed out)|load failed|networkerror/i;

/** O texto é o de um fetch que não chegou ao servidor. */
export function isNetworkFailureText(message: string): boolean {
  return NETWORK_FAILURE.test(message);
}

/**
 * O erro é de um pedido que não chegou ao servidor. O postgrest-js devolve o
 * erro do fetch sem código, com o nome e o texto dele na mensagem
 * ("TypeError: Network request failed"); um erro com código veio do servidor,
 * mesmo falando em fetch.
 */
export function isNetworkFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code === 'string' && code) return false;
  return typeof message === 'string' && isNetworkFailureText(message);
}
