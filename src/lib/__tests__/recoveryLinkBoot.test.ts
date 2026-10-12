import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { LINK_EXPIRED, LINK_REJECTED } from '../recoveryLink';
import { captureRecoveryLink, takeRecoveryLink, watchRecoveryLink } from '../recoveryLinkBoot';

const href = 'https://kotii.example/entrar?keep=yes#access_token=access&refresh_token=refresh&type=recovery&expires_in=3600';

function fakeWindow(address: string | undefined, replaceState?: (state: unknown, unused: string, url: string) => void) {
  const replace = jest.fn(replaceState ?? (() => undefined));
  return { win: { location: { href: address }, history: { state: { id: 'entrada' }, replaceState: replace } }, replace };
}

describe('link de recuperação lido antes do router', () => {
  it('guarda os tokens e limpa o endereço, mantendo o estado do histórico', () => {
    const { win, replace } = fakeWindow(href);
    expect(captureRecoveryLink(win)).toEqual({ tokens: { access_token: 'access', refresh_token: 'refresh' } });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith({ id: 'entrada' }, '', '/entrar?keep=yes');
  });

  it('link que falhou: limpa o endereço e guarda só o que dizer', () => {
    const { win, replace } = fakeWindow('https://kotii.example/#error=access_denied&error_code=otp_expired&sb=');
    expect(captureRecoveryLink(win)).toEqual({ error: LINK_EXPIRED });
    expect(replace).toHaveBeenCalledWith({ id: 'entrada' }, '', '/');
  });

  it('endereço comum: não mexe em nada', () => {
    const { win, replace } = fakeWindow('https://kotii.example/lista/1?error=sem-estoque');
    expect(captureRecoveryLink(win)).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('sem endereço ou sem histórico (celular): não faz nada', () => {
    expect(captureRecoveryLink(undefined)).toBeNull();
    expect(captureRecoveryLink({})).toBeNull();
    expect(captureRecoveryLink({ location: { href } })).toBeNull();
    expect(captureRecoveryLink({ location: { href }, history: { state: null } })).toBeNull();
    const { win, replace } = fakeWindow(undefined);
    expect(captureRecoveryLink(win)).toBeNull();
    expect(replace).not.toHaveBeenCalled();
    expect(captureRecoveryLink(fakeWindow('não é um endereço').win)).toBeNull();
  });

  it('não conseguiu limpar o endereço: os tokens não ficam guardados (nenhuma sessão sai do link)', () => {
    const { win } = fakeWindow(href, () => { throw new Error('history unavailable'); });
    expect(captureRecoveryLink(win)).toEqual({ error: LINK_REJECTED });
  });
});

describe('link colado numa aba em que o app já está aberto', () => {
  function openTab(address: string) {
    const listeners: (() => void)[] = [];
    const location = { href: address, reload: jest.fn() };
    const win = { location, addEventListener: jest.fn((_type: 'hashchange', listener: () => void) => void listeners.push(listener)) };
    return { win, location, fire: () => listeners.forEach((listener) => listener()) };
  }

  it('só o fragmento mudou e trouxe o link: recarrega, para o link passar pelo caminho de sempre', () => {
    const { win, location, fire } = openTab('https://kotii.example/entrar');
    watchRecoveryLink(win);
    expect(win.addEventListener).toHaveBeenCalledWith('hashchange', expect.any(Function));
    location.href = href;
    fire();
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it('link que falhou também recarrega; fragmento comum, não', () => {
    const { win, location, fire } = openTab('https://kotii.example/lista/1');
    watchRecoveryLink(win);
    location.href = 'https://kotii.example/lista/1#secao';
    fire();
    expect(location.reload).not.toHaveBeenCalled();
    location.href = 'https://kotii.example/lista/1#error=access_denied&error_code=otp_expired';
    fire();
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it('sem como ouvir ou recarregar (celular): não faz nada', () => {
    expect(() => watchRecoveryLink(undefined)).not.toThrow();
    expect(() => watchRecoveryLink({ location: { href } })).not.toThrow();
    const addEventListener = jest.fn();
    watchRecoveryLink({ location: { href }, addEventListener });
    expect(addEventListener).not.toHaveBeenCalled();
  });

  it('endereço que não dá para ler não derruba a página', () => {
    const { win, location, fire } = openTab('https://kotii.example/');
    watchRecoveryLink(win);
    location.href = 'não é um endereço';
    expect(fire).not.toThrow();
    expect(location.reload).not.toHaveBeenCalled();
  });
});

describe('ao carregar o módulo', () => {
  const page = globalThis as { location?: unknown; history?: unknown };

  afterEach(() => {
    delete page.location;
    delete page.history;
  });

  it('no celular (sem endereço) não há link', () => {
    expect(takeRecoveryLink()).toBeNull();
  });

  it('no navegador, lê o endereço na hora e entrega o link uma vez só', () => {
    const replace = jest.fn();
    page.location = { href };
    page.history = { state: null, replaceState: replace };
    let boot: typeof import('../recoveryLinkBoot') | undefined;
    jest.isolateModules(() => {
      boot = jest.requireActual<typeof import('../recoveryLinkBoot')>('../recoveryLinkBoot');
    });
    expect(replace).toHaveBeenCalledWith(null, '', '/entrar?keep=yes');
    expect(boot?.takeRecoveryLink()).toEqual({ tokens: { access_token: 'access', refresh_token: 'refresh' } });
    expect(boot?.takeRecoveryLink()).toBeNull();
  });
});
