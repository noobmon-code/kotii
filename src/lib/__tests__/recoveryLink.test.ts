import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  createRecoveryLinkHandler,
  LINK_EXPIRED,
  LINK_OFFLINE,
  LINK_REJECTED,
  linkOwnerLookup,
  parseRecoveryLink,
  type CapturedLink,
  type LinkAccount,
  type LinkOwner,
  type RecoveryLinkDeps,
} from '../recoveryLink';

const href = 'https://kotii.example/entrar?keep=yes#access_token=access&refresh_token=refresh&type=recovery&expires_in=3600';

describe('link padrão de recuperação: leitura do endereço', () => {
  it('lê o fragmento e limpa os tokens sem perder o caminho ou outros parâmetros', () => {
    expect(parseRecoveryLink(href)).toEqual({
      tokens: { access_token: 'access', refresh_token: 'refresh' },
      cleanUrl: '/entrar?keep=yes',
    });
    expect(parseRecoveryLink(`${href}&token_type=bearer&foo=bar`)?.cleanUrl).toBe('/entrar?keep=yes#foo=bar');
  });

  it('não transforma links de cadastro ou links comuns em recuperação', () => {
    expect(parseRecoveryLink(href.replace('type=recovery', 'type=signup'))).toBeNull();
    expect(parseRecoveryLink('https://kotii.example/')).toBeNull();
    expect(parseRecoveryLink('https://kotii.example/#sb=')).toBeNull();
  });

  it('faltando um dos dois tokens, não há tokens: só a orientação para pedir outro e-mail', () => {
    for (const missing of ['access_token=access&', 'refresh_token=refresh&']) {
      const link = parseRecoveryLink(href.replace(missing, ''));
      expect(link?.tokens).toBeUndefined();
      expect(link?.error).toBe(LINK_REJECTED);
      expect(link?.cleanUrl).toBe('/entrar?keep=yes');
    }
  });

  it('link que falhou: o texto não diz que era recuperação (o Supabase não conta o tipo) e o `sb` sai junto', () => {
    const failed = parseRecoveryLink(
      'https://kotii.example/financas?aba=resumo#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=',
    );
    expect(failed).toEqual({ error: LINK_EXPIRED, cleanUrl: '/financas?aba=resumo' });
    expect(LINK_EXPIRED).toContain('confirmação do cadastro');
    expect(LINK_EXPIRED).toContain('Esqueci minha senha');
  });

  it('erro sem `error` (só error_code ou error_description) também é um link que falhou', () => {
    expect(parseRecoveryLink('https://kotii.example/#error_code=over_request_rate_limit&error_description=Too+many&sb=')).toEqual({
      error: LINK_EXPIRED,
      cleanUrl: '/',
    });
    expect(parseRecoveryLink('https://kotii.example/#error_description=Too+many')?.error).toBe(LINK_EXPIRED);
  });

  it('na query, só `error` acompanhado conta; um ?error= solto fica como está', () => {
    expect(parseRecoveryLink('https://kotii.example/lista?error=sem-estoque')).toBeNull();
    expect(parseRecoveryLink('https://kotii.example/lista?error_code=x')).toBeNull();
    expect(parseRecoveryLink('https://kotii.example/?error=access_denied&error_code=otp_expired&keep=1')).toEqual({
      error: LINK_EXPIRED,
      cleanUrl: '/?keep=1',
    });
    expect(parseRecoveryLink('https://kotii.example/?error=access_denied&error_description=expired#error=access_denied&sb=')?.cleanUrl).toBe('/');
    // O ?error= de outra coisa não é mexido nem quando o fragmento é do Supabase.
    expect(parseRecoveryLink('https://kotii.example/lista?error=sem-estoque#error_code=otp_expired')?.cleanUrl).toBe('/lista?error=sem-estoque');
    expect(parseRecoveryLink(href.replace('?keep=yes', '?error=sem-estoque&type=lista'))).toEqual({
      tokens: { access_token: 'access', refresh_token: 'refresh' },
      cleanUrl: '/entrar?error=sem-estoque&type=lista',
    });
  });

  it('tokens junto com um erro: vale o erro, sem tokens', () => {
    const link = parseRecoveryLink(`${href}&error=access_denied`);
    expect(link?.tokens).toBeUndefined();
    expect(link?.error).toBe(LINK_EXPIRED);
  });
});

describe('link padrão de recuperação: de quem é o token', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  const response = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new Error('not json');
      return body;
    },
  });
  type Fetch = Parameters<typeof linkOwnerLookup>[0];

  it('pergunta ao Supabase num pedido à parte, com a chave pública e o token do link', async () => {
    const fetchFn = jest.fn<Fetch>(async () => response(200, { id: 'ana', email: 'ana@x', aud: 'authenticated' }));
    const lookup = linkOwnerLookup(fetchFn, 'https://projeto.supabase.co/', 'anon');
    expect(await lookup('access')).toEqual({ id: 'ana', email: 'ana@x' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://projeto.supabase.co/auth/v1/user');
    expect(init.headers).toEqual({ apikey: 'anon', Authorization: 'Bearer access' });
  });

  it('recusa do Supabase é definitiva; o resto é falta de resposta', async () => {
    const answer = (status: number, body?: unknown) => linkOwnerLookup(async () => response(status, body), 'https://p', 'anon')('access');
    expect(await answer(403, { code: 403, error_code: 'bad_jwt' })).toBe('rejected');
    expect(await answer(403, { code: 403, error_code: 'session_not_found' })).toBe('rejected');
    expect(await answer(401, { message: 'No API key found' })).toBe('rejected');
    expect(await answer(503, { code: 503 })).toBe('offline');
    expect(await answer(429, { code: 429 })).toBe('offline');
    expect(await answer(408, { code: 408 })).toBe('offline');
    // Página de erro de um proxy ou de um portal de Wi-Fi: não é a resposta do Supabase.
    expect(await answer(403)).toBe('offline');
    expect(await answer(200)).toBe('offline');
    expect(await answer(200, { aud: 'authenticated' })).toBe('offline');
    const failing = linkOwnerLookup(async () => { throw new TypeError('Failed to fetch'); }, 'https://p', 'anon');
    expect(await failing('access')).toBe('offline');
  });

  it('pedido pendurado é abandonado depois do tempo limite', async () => {
    jest.useFakeTimers();
    const hung: Fetch = (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
    const answer = linkOwnerLookup(hung, 'https://p', 'anon', 10_000)('access');
    jest.advanceTimersByTime(10_000);
    expect(await answer).toBe('offline');
  });
});

const tokens = { access_token: 'access-secret', refresh_token: 'refresh-secret' };
const ana: LinkAccount = { id: 'ana', email: 'ana@x' };
const beto: LinkAccount = { id: 'beto', email: 'beto@y' };
const OFFLINE = new Error('Failed to fetch');
type SetSessionResult = Awaited<ReturnType<RecoveryLinkDeps['setSession']>>;
const signedInAs = (id: string): SetSessionResult => ({ data: { session: { user: { id } } }, error: null });
const refused = (error: unknown): SetSessionResult => ({ data: { session: null }, error });

/** Um handler com tudo de fora simulado; `calls` guarda a ordem do que mexe na sessão ou na marca. */
function setup(over: Partial<RecoveryLinkDeps> = {}, link: CapturedLink | null = { tokens }) {
  const calls: string[] = [];
  const undo = jest.fn(async () => { calls.push('undo'); });
  const deps = {
    identify: jest.fn<RecoveryLinkDeps['identify']>(async () => { calls.push('identify'); return ana; }),
    currentAccount: jest.fn<RecoveryLinkDeps['currentAccount']>(async () => null),
    ask: jest.fn<RecoveryLinkDeps['ask']>(async () => true),
    signOut: jest.fn<RecoveryLinkDeps['signOut']>(async () => { calls.push('signOut'); }),
    beginRecovery: jest.fn<RecoveryLinkDeps['beginRecovery']>(async (id) => { calls.push(`mark:${id}`); return undo; }),
    setSession: jest.fn<RecoveryLinkDeps['setSession']>(async () => { calls.push('setSession'); return signedInAs('ana'); }),
    isConnectionError: (error: unknown) => error === OFFLINE,
    wait: jest.fn<RecoveryLinkDeps['wait']>(async () => undefined),
    notice: jest.fn<RecoveryLinkDeps['notice']>(),
    ...over,
  };
  return { handler: createRecoveryLinkHandler(link, deps), deps, calls, undo };
}

describe('link padrão de recuperação: até a sessão', () => {
  it('sem link (app nativo ou abertura normal) não espera nem faz nada', async () => {
    const { handler, deps, calls } = setup({}, null);
    expect(handler.pending).toBe(false);
    await handler.run();
    expect(calls).toEqual([]);
    expect(deps.currentAccount).not.toHaveBeenCalled();
    expect(deps.notice).not.toHaveBeenCalled();
  });

  it('link que já chegou com erro: avisa uma vez só e não confere nada', async () => {
    const { handler, deps, calls } = setup({}, { error: LINK_EXPIRED });
    expect(handler.pending).toBe(false);
    expect(handler.run()).toBe(handler.run());
    await handler.run();
    expect(deps.notice).toHaveBeenCalledTimes(1);
    expect(deps.notice).toHaveBeenCalledWith(LINK_EXPIRED);
    expect(calls).toEqual([]);
  });

  it('confere de quem é o token, põe a marca e só então entrega os tokens ao cliente do app', async () => {
    const { handler, deps, calls, undo } = setup();
    expect(handler.pending).toBe(true);
    await handler.run();
    expect(calls).toEqual(['identify', 'mark:ana', 'setSession']);
    expect(deps.identify).toHaveBeenCalledWith('access-secret');
    expect(deps.setSession).toHaveBeenCalledWith(tokens);
    expect(deps.ask).not.toHaveBeenCalled();
    expect(deps.signOut).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
    expect(deps.notice).not.toHaveBeenCalled();
    expect(handler.pending).toBe(false);
  });

  it('a abertura fica bloqueada até o setSession terminar; uma tentativa só, mesmo com o provider montado duas vezes', async () => {
    let release: (value: SetSessionResult) => void = () => undefined;
    const setSession = jest.fn<RecoveryLinkDeps['setSession']>(() => new Promise((resolve) => { release = resolve; }));
    const { handler, deps } = setup({ setSession });
    const first = handler.run();
    expect(handler.run()).toBe(first);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(deps.beginRecovery).toHaveBeenCalledWith('ana');
    expect(setSession).toHaveBeenCalledTimes(1);
    expect(handler.pending).toBe(true);
    release(signedInAs('ana'));
    await first;
    expect(handler.pending).toBe(false);
    await handler.run();
    expect(deps.identify).toHaveBeenCalledTimes(1);
    expect(setSession).toHaveBeenCalledTimes(1);
  });

  it('token recusado: nunca chega ao cliente do app, ninguém sai e nenhuma marca é posta', async () => {
    const { handler, deps, calls } = setup({ identify: async () => 'rejected', currentAccount: async () => beto });
    await handler.run();
    expect(calls).toEqual([]);
    expect(deps.setSession).not.toHaveBeenCalled();
    expect(deps.signOut).not.toHaveBeenCalled();
    expect(deps.beginRecovery).not.toHaveBeenCalled();
    expect(deps.ask).not.toHaveBeenCalled();
    expect(deps.notice).toHaveBeenCalledWith(LINK_REJECTED);
    expect(handler.pending).toBe(false);
  });

  it('falha de conexão: tenta de novo com os mesmos tokens e segue quando a resposta vem', async () => {
    const answers: LinkOwner[] = ['offline', 'offline', ana];
    const identify = jest.fn<RecoveryLinkDeps['identify']>(async () => answers.shift()!);
    const { handler, deps, calls } = setup({ identify });
    await handler.run();
    expect(identify).toHaveBeenCalledTimes(3);
    expect(identify.mock.calls.every(([token]) => token === 'access-secret')).toBe(true);
    expect((deps.wait as jest.Mock).mock.calls).toEqual([[1000], [2000]]);
    expect(calls).toEqual(['mark:ana', 'setSession']);
    expect(deps.notice).not.toHaveBeenCalled();
  });

  it('sem conexão até o fim: a mensagem fala da conexão, não do link, e nada muda', async () => {
    const identify = jest.fn<RecoveryLinkDeps['identify']>(async () => 'offline');
    const { handler, deps, calls } = setup({ identify });
    await handler.run();
    expect(identify).toHaveBeenCalledTimes(3);
    expect(deps.wait).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([]);
    expect(deps.notice).toHaveBeenCalledWith(LINK_OFFLINE);
    expect(LINK_OFFLINE).toContain('Sem conexão');
    expect(handler.pending).toBe(false);
  });

  it('outra conta aberta neste aparelho: pergunta com os dois e-mails; sem o sim, nada muda e nada é dito', async () => {
    const ask = jest.fn<RecoveryLinkDeps['ask']>(async () => false);
    const { handler, deps, calls } = setup({ currentAccount: async () => beto, ask });
    await handler.run();
    expect(ask).toHaveBeenCalledWith(
      'Trocar de conta?',
      'Este link é da conta ana@x. Neste aparelho está aberta a conta beto@y. Sair de beto@y e criar a senha nova de ana@x?',
    );
    expect(calls).toEqual(['identify']);
    expect(deps.signOut).not.toHaveBeenCalled();
    expect(deps.beginRecovery).not.toHaveBeenCalled();
    expect(deps.setSession).not.toHaveBeenCalled();
    expect(deps.notice).not.toHaveBeenCalled();
    expect(handler.pending).toBe(false);
  });

  it('outra conta aberta e a pessoa aceita: primeiro a saída do app, depois a marca e a sessão', async () => {
    const { handler, deps, calls } = setup({ currentAccount: async () => beto });
    await handler.run();
    expect(deps.ask).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['identify', 'signOut', 'mark:ana', 'setSession']);
    expect(deps.notice).not.toHaveBeenCalled();
  });

  it('conta sem e-mail conhecido: a pergunta ainda é feita', async () => {
    const ask = jest.fn<RecoveryLinkDeps['ask']>(async () => false);
    const { handler } = setup({ currentAccount: async () => ({ id: 'beto' }), ask });
    await handler.run();
    expect(ask.mock.calls[0][1]).toContain('outra conta');
  });

  it('a mesma conta já aberta, ou ninguém: segue sem perguntar', async () => {
    const same = setup({ currentAccount: async () => ({ id: 'ana', email: 'ana@x' }) });
    await same.handler.run();
    expect(same.deps.ask).not.toHaveBeenCalled();
    expect(same.deps.signOut).not.toHaveBeenCalled();
    expect(same.calls).toEqual(['identify', 'mark:ana', 'setSession']);
  });

  it('o setSession falha depois da marca: a marca é desfeita', async () => {
    const { handler, deps, calls, undo } = setup({
      setSession: async () => { calls.push('setSession'); return refused(new Error('invalid token')); },
    });
    await handler.run();
    expect(calls).toEqual(['identify', 'mark:ana', 'setSession', 'undo']);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(deps.notice).toHaveBeenCalledWith(LINK_REJECTED);
    expect(handler.pending).toBe(false);
  });

  it('o setSession sem conexão: tenta de novo sem soltar a abertura; se não der, desfaz a marca e fala da conexão', async () => {
    const results = [refused(OFFLINE), signedInAs('ana')];
    const again = setup({ setSession: jest.fn<RecoveryLinkDeps['setSession']>(async () => results.shift()!) });
    await again.handler.run();
    expect(again.deps.setSession).toHaveBeenCalledTimes(2);
    expect(again.undo).not.toHaveBeenCalled();
    expect(again.deps.notice).not.toHaveBeenCalled();

    const never = setup({ setSession: jest.fn<RecoveryLinkDeps['setSession']>(async () => refused(OFFLINE)) });
    await never.handler.run();
    expect(never.deps.setSession).toHaveBeenCalledTimes(3);
    expect(never.undo).toHaveBeenCalledTimes(1);
    expect(never.deps.notice).toHaveBeenCalledWith(LINK_OFFLINE);
  });

  it('a sessão que entra é de outra conta que não a conferida: a marca vai para a que entrou', async () => {
    const { handler, deps, undo } = setup({ setSession: async () => signedInAs('bia') });
    await handler.run();
    expect((deps.beginRecovery as jest.Mock).mock.calls).toEqual([['ana'], ['bia']]);
    expect(undo).not.toHaveBeenCalled();
  });

  it('nenhuma mensagem (aviso ou pergunta) leva os tokens, nem quando o erro os traz', async () => {
    const leaky = new Error(`bad ${tokens.access_token} ${tokens.refresh_token}`);
    const scenarios = [
      setup({ identify: async () => 'rejected' }),
      setup({ identify: async () => 'offline' }),
      setup({ identify: async () => { throw leaky; } }),
      setup({ setSession: async () => refused(leaky) }),
      setup({ setSession: async () => { throw leaky; } }),
      setup({ signOut: async () => { throw leaky; }, currentAccount: async () => beto }),
      setup({ beginRecovery: async () => { throw leaky; } }),
      setup({ currentAccount: async () => beto, ask: jest.fn<RecoveryLinkDeps['ask']>(async () => false) }),
    ];
    for (const { handler, deps } of scenarios) {
      await handler.run();
      const said = [...(deps.notice as jest.Mock).mock.calls, ...(deps.ask as jest.Mock).mock.calls].flat().join(' ');
      expect(said).not.toContain('secret');
      expect(handler.pending).toBe(false);
    }
    expect(scenarios[2].deps.notice).toHaveBeenCalledWith(LINK_REJECTED);
    // O que quebra depois da marca também a desfaz.
    expect(scenarios[4].deps.notice).toHaveBeenCalledWith(LINK_REJECTED);
    expect(scenarios[4].undo).toHaveBeenCalledTimes(1);
    expect(scenarios[5].deps.setSession).not.toHaveBeenCalled();
    expect(scenarios[6].deps.setSession).not.toHaveBeenCalled();
    // A marca não pôde ser gravada: nenhuma sessão sai do link, e a pessoa fica sabendo.
    expect(scenarios[6].deps.notice).toHaveBeenCalledWith(LINK_REJECTED);
  });
});
