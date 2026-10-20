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
// erro de programa ("Cannot read properties...") também é. "AbortError" é o
// pedido cortado pelo prazo do cliente (o `db.timeout` em lib/supabase): ficou
// sem resposta, como os outros.
const NETWORK_FAILURE = /failed to fetch|network request (?:failed|timed out)|load failed|networkerror|aborterror/i;

/** O texto é o de um fetch que não chegou ao servidor. */
export function isNetworkFailureText(message: string): boolean {
  return NETWORK_FAILURE.test(message);
}

/**
 * O erro é de um pedido que não chegou ao servidor. O postgrest-js devolve o
 * erro do fetch sem código, com o nome e o texto dele na mensagem
 * ("TypeError: Network request failed", "AbortError: Aborted"); um erro com
 * código veio do servidor, mesmo falando em fetch.
 */
export function isNetworkFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message, name } = error as { code?: unknown; message?: unknown; name?: unknown };
  if (typeof code === 'string' && code) return false;
  // O corte do prazo que chega como saiu do fetch, sem passar pelo postgrest-js.
  if (name === 'AbortError') return true;
  return typeof message === 'string' && isNetworkFailureText(message);
}

// Os códigos do Postgres (e do PostgREST) de um pedido desfeito ou recusado só
// por agora: 40P01 (impasse com o pedido de outra pessoa), 40001 (conflito de
// serialização), 55P03 (linha travada), 57014 (o prazo do comando acabou),
// 57P01 a 57P03 (o banco reiniciando), 53300 (conexões demais), 08xxx (a
// conexão com o banco caiu) e PGRST000 a PGRST003 (o PostgREST sem o banco ou
// ainda carregando o esquema).
const TRANSIENT_CODE = /^(?:40P01|40001|55P03|57014|57P0[123]|53300|08[0-9A-Z]{3}|PGRST00[0-3])$/;
// Um código do próprio Postgres (cinco letras e dígitos): o erro foi do pedido, não do caminho até o banco.
const SQLSTATE = /^[0-9A-Z]{5}$/;

/** O status HTTP que veio com o erro: o do storage-js, ou o que a fila põe no erro do PostgREST (withStatus). */
function statusOf(error: object): number | undefined {
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
  if (typeof status === 'number') return status;
  if (typeof statusCode === 'string' && /^[0-9]+$/.test(statusCode)) return Number(statusCode);
  return undefined;
}

/**
 * O servidor (ou o caminho até ele) falhou só por agora: um 5xx sem código do
 * Postgres (o 502 em HTML do gateway, o 520 da Cloudflare) ou um dos códigos
 * de pedido desfeito por agora. Repetir resolve, como na falta de resposta.
 */
export function isTransientServerError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && TRANSIENT_CODE.test(code)) return true;
  const status = statusOf(error);
  if (status === undefined || status < 500) return false;
  return !(typeof code === 'string' && SQLSTATE.test(code));
}

/** O pedido falhou por algo que passa sozinho (sem resposta, ou o servidor só agora): vale esperar e repetir. */
export function isTransientFailure(error: unknown): boolean {
  return isNetworkFailure(error) || isTransientServerError(error);
}

/**
 * O erro do PostgREST com o status HTTP da resposta, que o postgrest-js deixa
 * fora do erro: sem ele, o 502 em HTML do gateway parece um erro do pedido.
 */
export function withStatus(error: unknown, status: number | undefined): unknown {
  if (error && typeof error === 'object' && typeof status === 'number' && !('status' in error)) {
    Object.assign(error, { status });
  }
  return error;
}
