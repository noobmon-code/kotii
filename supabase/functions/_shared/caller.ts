// Quem chamou a função: o token (para o banco aplicar as regras de acesso da
// pessoa) e a casa aberta no aparelho (x-household-id, ver a migração
// multiple_households). Sem o cabeçalho, o banco usa a primeira casa dela.

export const HOUSEHOLD_HEADER = 'x-household-id';

/** Cabeçalhos que o navegador pode mandar às funções (CORS). */
export const ALLOWED_HEADERS = `authorization, x-client-info, apikey, content-type, ${HOUSEHOLD_HEADER}`;

/** Cabeçalhos para o cliente do Supabase agir como quem chamou, na casa dela. */
export function callerHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = { Authorization: req.headers.get('Authorization') ?? '' };
  const household = req.headers.get(HOUSEHOLD_HEADER);
  if (household) headers[HOUSEHOLD_HEADER] = household;
  return headers;
}
