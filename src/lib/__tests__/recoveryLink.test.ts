import { describe, expect, it, jest } from '@jest/globals';

import { createRecoveryLinkHandler, parseRecoveryLink } from '../recoveryLink';

const href = 'https://kotii.example/entrar?keep=yes#access_token=access&refresh_token=refresh&type=recovery&expires_in=3600';

describe('link padrão de recuperação', () => {
  it('lê o fragmento e limpa os tokens sem perder o caminho ou outros parâmetros', () => {
    expect(parseRecoveryLink(href)).toEqual({
      tokens: { access_token: 'access', refresh_token: 'refresh' },
      cleanUrl: '/entrar?keep=yes',
    });
  });

  it('não transforma links de cadastro ou links comuns em recuperação', () => {
    expect(parseRecoveryLink(href.replace('type=recovery', 'type=signup'))).toBeNull();
    expect(parseRecoveryLink('https://kotii.example/')).toBeNull();
  });

  it('sem retorno de link (app nativo ou abertura normal) não tenta entrar nem marca recuperação', async () => {
    const setSession = jest.fn(async () => ({ data: { session: null }, error: null }));
    const mark = jest.fn<(id: string) => void>();
    const handler = createRecoveryLinkHandler(null, () => undefined, setSession, mark);
    expect(handler.pending).toBe(false);
    expect(await handler.run()).toBeNull();
    expect(setSession).not.toHaveBeenCalled();
    expect(mark).not.toHaveBeenCalled();
  });

  it('link vencido ou sem os dois tokens devolve uma orientação para pedir outro e-mail', () => {
    const failed = parseRecoveryLink('https://kotii.example/#error=access_denied&error_code=otp_expired&error_description=expired');
    expect(failed?.error).toContain('Peça um novo e-mail');
    expect(failed?.cleanUrl).toBe('/');
    expect(parseRecoveryLink(href.replace('refresh_token=refresh&', ''))?.tokens).toBeUndefined();
  });

  it('limpa o endereço antes de validar; mantém a abertura bloqueada até marcar a conta confirmada', async () => {
    let release: (value: { data: { session: { user: { id: string } } }; error: null }) => void = () => undefined;
    const clear = jest.fn<(url: string) => void>();
    const mark = jest.fn<(id: string) => void>();
    const setSession = jest.fn(() => new Promise<{ data: { session: { user: { id: string } } }; error: null }>((resolve) => { release = resolve; }));
    const handler = createRecoveryLinkHandler(href, clear, setSession, mark);
    expect(clear).toHaveBeenCalledWith('/entrar?keep=yes');
    expect(setSession).not.toHaveBeenCalled();
    expect(handler.pending).toBe(true);
    const first = handler.run();
    const second = handler.run();
    expect(first).toBe(second);
    expect(setSession).toHaveBeenCalledTimes(1);
    expect(mark).not.toHaveBeenCalled();
    expect(handler.pending).toBe(true);
    release({ data: { session: { user: { id: 'ana' } } }, error: null });
    expect(await first).toBeNull();
    expect(mark).toHaveBeenCalledWith('ana');
    expect(handler.pending).toBe(false);
  });

  it('tokens recusados pelo servidor nunca marcam uma conta e não deixam a abertura presa', async () => {
    const mark = jest.fn<(id: string) => void>();
    const handler = createRecoveryLinkHandler(href, () => undefined, async () => ({
      data: { session: null }, error: new Error('invalid token'),
    }), mark);
    expect(await handler.run()).toContain('Peça um novo e-mail');
    expect(mark).not.toHaveBeenCalled();
    expect(handler.pending).toBe(false);
  });

  it('falha de conexão ou erro ao limpar o endereço não vaza tokens no erro mostrado', async () => {
    const handler = createRecoveryLinkHandler(href, () => undefined, async () => {
      throw new Error('secret token');
    }, () => undefined);
    expect(await handler.run()).not.toContain('secret token');
    expect(handler.pending).toBe(false);
    const setSession = jest.fn(async () => ({ data: { session: null }, error: null }));
    const blocked = createRecoveryLinkHandler(href, () => { throw new Error('history unavailable'); }, setSession, () => undefined);
    expect(await blocked.run()).toContain('Peça um novo e-mail');
    expect(setSession).not.toHaveBeenCalled();
  });
});
