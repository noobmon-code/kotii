// Erros do banco que a pessoa lê em palavras, no lugar do texto do Postgres, e
// que não são de acesso à casa (esses ficam em accessErrors). Puro.

/** O que a pessoa lê quando o pedido dela foi desfeito para destravar o de outra pessoa da casa. */
export const BUSY_TRY_AGAIN = 'Outra pessoa da casa mexeu nisso agora. Tente de novo.';

/**
 * Duas pessoas da casa mexeram nas mesmas linhas no mesmo instante (uma junta
 * dois produtos enquanto a outra confirma uma nota com um deles) e o Postgres
 * desfez um dos dois pedidos para o outro andar: 40P01, "deadlock detected".
 * Nada fica pela metade; repetir resolve.
 */
export function isDeadlock(error: unknown): boolean {
  return Boolean(error) && typeof error === 'object' && (error as { code?: unknown }).code === '40P01';
}
