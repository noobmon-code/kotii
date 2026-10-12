// Link do e-mail padrão de recuperação do Supabase (fluxo implicit): o site abre com a sessão no
// fragmento do endereço. Quem lê e limpa o endereço é lib/recoveryLinkBoot, antes de o router carregar;
// aqui ficam a leitura (pura) e os passos até a sessão: conferir de quem é o token sem tocar na sessão
// guardada, perguntar antes de trocar de conta, pôr a marca da recuperação e só então entregar os tokens
// ao cliente do app. Sem imports: o que precisa do Supabase ou da tela vem de fora (lib/auth).

/** Os tokens que o link traz. */
export interface RecoveryTokens {
  access_token: string;
  refresh_token: string;
}

/** O que o endereço trazia quando o app abriu: os tokens, ou o que dizer à pessoa. */
export interface CapturedLink {
  tokens?: RecoveryTokens;
  error?: string;
}

/** Uma conta, só com o que a pergunta de troca precisa. */
export interface LinkAccount {
  id: string;
  email?: string | null;
}

/** De quem é o token do link; recusado de vez; ou sem resposta (não prova nada). */
export type LinkOwner = LinkAccount | 'rejected' | 'offline';

// O retorno de erro do Supabase é o mesmo para todo link de e-mail (cadastro, recuperação) e não diz o tipo.
export const LINK_EXPIRED =
  'Este link venceu ou já foi usado. Se era a confirmação do cadastro, é só entrar; para trocar a senha, peça um novo e-mail em "Esqueci minha senha".';
export const LINK_REJECTED = 'Este link não pôde ser usado. Peça um novo e-mail em "Esqueci minha senha" e abra o mais recente.';
export const LINK_OFFLINE = 'Sem conexão para abrir o link. Quando a internet voltar, peça um novo e-mail em "Esqueci minha senha".';

const ERROR_PARAMS = ['error', 'error_code', 'error_description'];
// `sb` é o que sobra no fim do fragmento de erro do Supabase.
const AUTH_PARAMS = [
  'access_token', 'refresh_token', 'token_type', 'expires_in', 'expires_at',
  'type', ...ERROR_PARAMS, 'provider_token', 'provider_refresh_token', 'sb',
];

export function parseRecoveryLink(href: string): (CapturedLink & { cleanUrl: string }) | null {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.slice(1));
  // O e-mail padrão devolve os tokens no fragmento. Outros tipos de login não entram aqui.
  const recovery = hash.get('type') === 'recovery';
  // Link que falhou: no fragmento, qualquer um dos três (nem todo erro traz `error`). Na query (onde o
  // Supabase repete o erro em outro fluxo), só `error` acompanhado: um ?error= solto é de outra coisa e fica.
  const failedInQuery =
    url.searchParams.has('error') && (url.searchParams.has('error_code') || url.searchParams.has('error_description'));
  const failed = failedInQuery || ERROR_PARAMS.some((key) => hash.has(key));
  if (!recovery && !failed) return null;
  const access_token = hash.get('access_token');
  const refresh_token = hash.get('refresh_token');
  for (const key of AUTH_PARAMS) hash.delete(key);
  if (failedInQuery) for (const key of ERROR_PARAMS) url.searchParams.delete(key);
  url.hash = hash.toString();
  const cleanUrl = url.pathname + url.search + url.hash;
  if (failed) return { error: LINK_EXPIRED, cleanUrl };
  if (!access_token || !refresh_token) return { error: LINK_REJECTED, cleanUrl };
  return { tokens: { access_token, refresh_token }, cleanUrl };
}

/** Só o que o pedido usa do fetch (o do navegador serve). */
type LinkFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Pergunta ao Supabase de quem é o token do link, num pedido à parte (GET /auth/v1/user): o cliente
 * do app, que apaga a sessão guardada quando o token é de uma sessão que já não existe, fica de fora.
 */
export function linkOwnerLookup(fetchFn: LinkFetch, projectUrl: string, anonKey: string, timeoutMs = 10_000) {
  return async (accessToken: string): Promise<LinkOwner> => {
    const controller = new AbortController();
    // Pedido pendurado (portal de Wi-Fi): não deixa o app esperando para sempre.
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(`${projectUrl.replace(/\/+$/, '')}/auth/v1/user`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => null)) as { id?: unknown; email?: unknown } | null;
      if (response.ok) {
        if (typeof body?.id !== 'string') return 'offline';
        return { id: body.id, email: typeof body.email === 'string' ? body.email : null };
      }
      // Recusa de verdade: 4xx com a resposta do Supabase (JSON). 408, 429, 5xx e página de erro de um
      // proxy não provam nada sobre o link.
      const refused = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429;
      return refused && body !== null && typeof body === 'object' ? 'rejected' : 'offline';
    } catch {
      return 'offline';
    } finally {
      clearTimeout(timer);
    }
  };
}

export interface RecoveryLinkDeps {
  /** De quem é o token, sem tocar na sessão guardada (linkOwnerLookup). */
  identify: (accessToken: string) => Promise<LinkOwner>;
  /** A conta aberta neste aparelho, se houver. */
  currentAccount: () => Promise<LinkAccount | null>;
  /** Pergunta sim/não. */
  ask: (title: string, message: string) => Promise<boolean>;
  /** A saída do app (lib/session), com a limpeza de sempre. */
  signOut: () => Promise<void>;
  /** Põe a marca da recuperação e devolve como desfazer (lib/passwordRecovery). */
  beginRecovery: (userId: string) => Promise<() => Promise<void>>;
  /** Garante que a marca do aparelho é a da conta cuja sessão entrou; falha se não der para gravar. */
  ensureRecovery: (userId: string) => Promise<void>;
  /** Entrega os tokens ao cliente do app. */
  setSession: (tokens: RecoveryTokens) => Promise<{
    data: { session: { user: { id: string } } | null };
    error: unknown;
  }>;
  /** O erro do setSession foi de conexão (vale tentar de novo). */
  isConnectionError: (error: unknown) => boolean;
  wait: (ms: number) => Promise<void>;
  /** O que dizer à pessoa quando o link não deu certo (uma vez). */
  notice: (message: string) => void;
}

/** Tentativas enquanto a resposta for "sem conexão", com uma espera curta entre elas. */
const ATTEMPTS = 3;
const RETRY_MS = 1000;

function switchQuestion(link: LinkAccount, current: LinkAccount): string {
  if (!link.email || !current.email) {
    return 'Este link é de outra conta, não da que está aberta neste aparelho. Sair da conta aberta e criar a senha nova da outra?';
  }
  return `Este link é da conta ${link.email}. Neste aparelho está aberta a conta ${current.email}. Sair de ${current.email} e criar a senha nova de ${link.email}?`;
}

/**
 * Uma única tentativa por abertura, inclusive se o React montar o provider duas vezes. Enquanto
 * `pending`, lib/auth não libera sessão nenhuma para o router: a conta do link só aparece depois da marca.
 */
export function createRecoveryLinkHandler(link: CapturedLink | null, deps: RecoveryLinkDeps) {
  const linkError = link?.error ?? null;
  let tokens = link?.tokens;
  let pending = Boolean(tokens);
  let result: Promise<void> | undefined;

  // Os tokens ficam na memória até uma resposta definitiva: falha de conexão não gasta o link.
  async function retrying<T>(attempt: () => Promise<T>, offline: (value: T) => boolean): Promise<T> {
    for (let n = 1; ; n += 1) {
      const value = await attempt();
      if (n === ATTEMPTS || !offline(value)) return value;
      await deps.wait(RETRY_MS * n);
    }
  }

  /** Devolve o que dizer à pessoa, ou null (deu certo, ou ela desistiu de trocar de conta). */
  async function open(payload: RecoveryTokens): Promise<string | null> {
    // A identidade vem do servidor, nunca de decodificar o endereço; e antes de qualquer coisa mudar aqui.
    const owner = await retrying(() => deps.identify(payload.access_token), (value) => value === 'offline');
    if (owner === 'offline') return LINK_OFFLINE;
    if (owner === 'rejected') return LINK_REJECTED;
    const current = await deps.currentAccount();
    if (current && current.id !== owner.id) {
      // Outra conta aberta neste aparelho: não troca calado. Sem o sim, o link é descartado e nada muda.
      if (!(await deps.ask('Trocar de conta?', switchQuestion(owner, current)))) return null;
      await deps.signOut();
    }
    // A marca vem antes da sessão: as outras abas já a encontram quando o SIGNED_IN chega.
    const undo = await deps.beginRecovery(owner.id);
    let signedIn = false;
    try {
      const { data, error } = await retrying(
        () => deps.setSession(payload),
        (value) => Boolean(value.error) && deps.isConnectionError(value.error),
      );
      if (error || !data.session) return deps.isConnectionError(error) ? LINK_OFFLINE : LINK_REJECTED;
      // A sessão só fica com a marca dela no aparelho. Quem diz de quem é a sessão é o servidor (pode não
      // ser a conta conferida), e outra aba pode ter trocado a marca enquanto a sessão entrava. Sem
      // conseguir conferir ou gravar, a sessão sai: abriria a casa sem a senha nova.
      try {
        await deps.ensureRecovery(data.session.user.id);
      } catch {
        await deps.signOut().catch(() => undefined);
        return LINK_REJECTED;
      }
      signedIn = true;
      return null;
    } finally {
      // Não entrou: a marca volta a ser a que estava no aparelho.
      if (!signedIn) await undo().catch(() => undefined);
    }
  }

  return {
    get pending() { return pending; },
    run(): Promise<void> {
      if (result) return result;
      result = (async () => {
        let message = linkError;
        try {
          if (!message && tokens) message = await open(tokens);
        } catch {
          message = LINK_REJECTED;
        } finally {
          tokens = undefined;
          pending = false;
        }
        if (message) deps.notice(message);
      })();
      return result;
    },
  };
}
