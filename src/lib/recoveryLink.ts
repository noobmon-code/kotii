/** Retorno do link padrão de recuperação do Supabase (fluxo implicit). */
interface RecoveryTokens {
  access_token: string;
  refresh_token: string;
}

const LINK_ERROR = 'Este link não pôde ser usado. Peça um novo e-mail em "Esqueci minha senha" e abra o mais recente.';
const AUTH_PARAMS = [
  'access_token', 'refresh_token', 'token_type', 'expires_in', 'expires_at',
  'type', 'error', 'error_code', 'error_description', 'provider_token', 'provider_refresh_token',
];

export function parseRecoveryLink(href: string): {
  tokens?: RecoveryTokens;
  error?: string;
  cleanUrl: string;
} | null {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.slice(1));
  // O e-mail padrão devolve os tokens no fragmento. Outros tipos de login não entram aqui.
  const recovery = hash.get('type') === 'recovery';
  const failed = hash.has('error') || url.searchParams.has('error');
  if (!recovery && !failed) return null;
  const access_token = hash.get('access_token');
  const refresh_token = hash.get('refresh_token');
  for (const key of AUTH_PARAMS) {
    hash.delete(key);
    url.searchParams.delete(key);
  }
  url.hash = hash.toString();
  const cleanUrl = url.pathname + url.search + url.hash;
  if (failed || !access_token || !refresh_token) return { error: LINK_ERROR, cleanUrl };
  return { tokens: { access_token, refresh_token }, cleanUrl };
}

/**
 * Captura e limpa o endereço antes da navegação. Uma única tentativa por abertura,
 * inclusive se o React montar o provider duas vezes; a conta só aparece depois da marca.
 */
export function createRecoveryLinkHandler(
  href: string | null,
  clearUrl: (url: string) => void,
  setSession: (tokens: RecoveryTokens) => Promise<{
    data: { session: { user: { id: string } } | null };
    error: unknown;
  }>,
  markRecovery: (userId: string) => void,
) {
  const link = href ? parseRecoveryLink(href) : null;
  let tokens = link?.tokens;
  let error = link?.error;
  let pending = Boolean(tokens);
  let result: Promise<string | null> | undefined;
  if (link) {
    try {
      clearUrl(link.cleanUrl);
    } catch {
      // Não estabelece uma sessão deixando os tokens no endereço.
      tokens = undefined;
      error = LINK_ERROR;
      pending = false;
    }
  }
  return {
    get pending() { return pending; },
    run(): Promise<string | null> {
      if (result) return result;
      result = (async () => {
        try {
          if (error) return error;
          if (!tokens) return null;
          const payload = tokens;
          tokens = undefined;
          // O Supabase valida os tokens; a identidade nunca vem de decodificar o endereço.
          const { data, error: sessionError } = await setSession(payload);
          if (sessionError || !data.session) return LINK_ERROR;
          markRecovery(data.session.user.id);
          return null;
        } catch {
          return LINK_ERROR;
        } finally {
          pending = false;
        }
      })();
      return result;
    },
  };
}
