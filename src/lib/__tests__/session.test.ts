import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  AuthApiError,
  AuthRefreshDiscardedError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
} from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { checkSession, endSessionIfGone, isSessionEnded, noteSignedIn, noteSignedOut, signOut } from '../session';

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockCalls: string[] = [];
type Refresh = { data: { session: object | null }; error: Error | null };
const mockAuth: {
  refresh: Refresh;
  onSignedOut?: () => void;
  /** O que cada signOut devolve, na ordem; sem nada, sai e avisa o SIGNED_OUT. */
  signOutResults: { error: Error | null; signedOut: boolean }[];
} = { refresh: { data: { session: {} }, error: null }, signOutResults: [] };
/** A sessão guardada no aparelho (o storage do Supabase). */
const mockStored = new Map<string, string>();

/** O que acontece enquanto os lembretes saem (outro 401 que chega no meio da saída). */
const mockHooks: { onReminders?: () => void } = {};

jest.mock('../reminders', () => ({
  disableAllReminders: async () => {
    mockCalls.push('lembretes');
    mockHooks.onReminders?.();
  },
}));

jest.mock('../sessionStorage', () => ({
  sessionStorage: {
    getItem: async (key: string) => mockStored.get(key) ?? null,
    removeItem: async (key: string) => {
      mockCalls.push('apaga sessão');
      mockStored.delete(key);
    },
  },
}));

jest.mock('../supabase', () => ({
  SESSION_STORAGE_KEY: 'sb-teste-auth-token',
  supabase: {
    auth: {
      // Como o Supabase: o SIGNED_OUT (o AuthProvider chama noteSignedOut) vem antes de a saída terminar.
      signOut: async (options?: { scope?: string }) => {
        mockCalls.push(`signOut ${options?.scope ?? 'global'}`);
        const result = mockAuth.signOutResults.shift() ?? { error: null, signedOut: true };
        if (result.signedOut) {
          mockStored.delete('sb-teste-auth-token');
          mockAuth.onSignedOut?.();
        }
        return { error: result.error };
      },
      refreshSession: async () => {
        mockCalls.push('refresh');
        return mockAuth.refresh;
      },
    },
  },
}));

beforeEach(() => {
  mockCalls.length = 0;
  mockAuth.refresh = { data: { session: {} }, error: null };
  mockAuth.signOutResults = [];
  mockAuth.onSignedOut = noteSignedOut;
  mockStored.clear();
  mockStored.set('sb-teste-auth-token', 'sessão');
  mockHooks.onReminders = undefined;
  noteSignedIn();
});

describe('sair da conta', () => {
  it('sai só deste aparelho, depois de desligar os lembretes daqui', async () => {
    await signOut();
    expect(mockCalls).toEqual(['lembretes', 'signOut local']);
  });

  it('pelo botão, a tela de entrar não diz que a sessão terminou', async () => {
    await signOut();
    expect(isSessionEnded()).toBe(false);
  });

  it('o Supabase saiu sozinho (sessão encerrada no servidor): a tela de entrar avisa', () => {
    noteSignedOut();
    expect(isSessionEnded()).toBe(true);
    noteSignedIn();
    expect(isSessionEnded()).toBe(false);
  });

  it('sair pelo botão apaga o aviso de uma sessão que terminou antes', async () => {
    noteSignedOut();
    await signOut();
    expect(isSessionEnded()).toBe(false);
  });

  it('sem internet e com o token vencido, sai do mesmo jeito: apaga a sessão guardada e o Supabase avisa', async () => {
    // O Supabase tenta renovar antes de sair, não consegue e deixa a sessão guardada, sem SIGNED_OUT.
    mockAuth.signOutResults = [{ error: new AuthRetryableFetchError('Failed to fetch', 0), signedOut: false }];
    const signedOut = jest.fn(noteSignedOut);
    mockAuth.onSignedOut = signedOut;
    await signOut();
    expect(mockCalls).toEqual(['lembretes', 'signOut local', 'apaga sessão', 'signOut local']);
    expect(mockStored.size).toBe(0);
    expect(signedOut).toHaveBeenCalledTimes(1);
    expect(isSessionEnded()).toBe(false);
  });

  it('erro depois de o Supabase já ter apagado a sessão: não sai duas vezes', async () => {
    mockAuth.signOutResults = [{ error: new AuthRetryableFetchError('Failed to fetch', 0), signedOut: true }];
    await signOut();
    expect(mockCalls).toEqual(['lembretes', 'signOut local']);
  });
});

describe('no navegador, com outras abas', () => {
  const tabs = new Map<string, string>();
  const g = globalThis as { localStorage?: unknown };

  beforeEach(() => {
    tabs.clear();
    jest.replaceProperty(Platform, 'OS', 'web');
    // O localStorage é um só para todas as abas.
    Object.defineProperty(g, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => tabs.get(key) ?? null,
        setItem: (key: string, value: string) => void tabs.set(key, value),
        removeItem: (key: string) => void tabs.delete(key),
      },
    });
  });

  afterEach(() => {
    delete g.localStorage;
    jest.restoreAllMocks();
  });

  it('"Sair" numa aba: o SIGNED_OUT que chega na outra não diz que a sessão terminou', async () => {
    // A outra aba não tem saída em andamento: só o SIGNED_OUT repassado.
    mockAuth.onSignedOut = undefined;
    await signOut();
    noteSignedOut();
    expect(isSessionEnded()).toBe(false);
  });

  it('passado um tempo do toque, um SIGNED_OUT de fora volta a avisar', async () => {
    mockAuth.onSignedOut = undefined;
    await signOut();
    const later = Date.now() + 60_000;
    jest.spyOn(Date, 'now').mockReturnValue(later);
    noteSignedOut();
    expect(isSessionEnded()).toBe(true);
  });

  it('sem toque em "Sair" (a sessão acabou no servidor), a outra aba avisa', async () => {
    mockAuth.refresh = { data: { session: null }, error: new AuthApiError('Session not found', 403, 'session_not_found') };
    await endSessionIfGone();
    expect(tabs.size).toBe(0);
    noteSignedIn();
    noteSignedOut();
    expect(isSessionEnded()).toBe(true);
  });

  it('entrar de novo esquece o toque', async () => {
    await signOut();
    noteSignedIn();
    expect(tabs.size).toBe(0);
  });
});

describe('conferir a sessão', () => {
  const refreshFails = (error: Error) => {
    mockAuth.refresh = { data: { session: null }, error };
  };

  it('renovou: vale', async () => {
    await expect(checkSession()).resolves.toBe('valid');
  });

  it('o Supabase recusou a renovação de vez: acabou', async () => {
    for (const code of ['refresh_token_not_found', 'refresh_token_already_used', 'session_expired', 'user_not_found', 'user_banned']) {
      refreshFails(new AuthApiError('Invalid Refresh Token', 400, code));
      await expect(checkSession()).resolves.toBe('ended');
    }
    // session_not_found vira AuthSessionMissingError; sem sessão guardada também.
    refreshFails(new AuthSessionMissingError());
    await expect(checkSession()).resolves.toBe('ended');
    // Servidor antigo, sem código.
    refreshFails(new AuthApiError('Invalid Refresh Token: Refresh Token Not Found', 400, undefined));
    await expect(checkSession()).resolves.toBe('ended');
  });

  it('sem internet, ou outra aba renovou junto: não dá para saber', async () => {
    refreshFails(new AuthRetryableFetchError('Failed to fetch', 0));
    await expect(checkSession()).resolves.toBe('unknown');
    refreshFails(new AuthRefreshDiscardedError());
    await expect(checkSession()).resolves.toBe('unknown');
  });

  it('limite de pedidos (429) ou página de erro de um proxy: não dá para saber', async () => {
    refreshFails(new AuthApiError('Request rate limit reached', 429, 'over_request_rate_limit'));
    await expect(checkSession()).resolves.toBe('unknown');
    // Corpo que não é JSON (429/408 de uma CDN, 511 de um portal de Wi-Fi).
    refreshFails(new AuthUnknownError('Unexpected token < in JSON', new SyntaxError('<html>')));
    await expect(checkSession()).resolves.toBe('unknown');
    // Outro 4xx sem relação com a sessão.
    refreshFails(new AuthApiError('Bad request', 400, 'validation_failed'));
    await expect(checkSession()).resolves.toBe('unknown');
    refreshFails(new AuthApiError('Request Timeout', 408, undefined));
    await expect(checkSession()).resolves.toBe('unknown');
  });

  it('sem sessão nem erro na resposta: não afirma que acabou', async () => {
    mockAuth.refresh = { data: { session: null }, error: null };
    await expect(checkSession()).resolves.toBe('unknown');
  });
});

describe('401 de uma função', () => {
  it('sessão acabou: sai só deste aparelho e a tela de entrar avisa', async () => {
    mockAuth.refresh = { data: { session: null }, error: new AuthApiError('Session not found', 403, 'session_not_found') };
    await expect(endSessionIfGone()).resolves.toBe(true);
    expect(mockCalls).toEqual(['refresh', 'lembretes', 'signOut local']);
    expect(isSessionEnded()).toBe(true);
  });

  it('renovou: continua na conta', async () => {
    await expect(endSessionIfGone()).resolves.toBe(false);
    expect(mockCalls).toEqual(['refresh']);
    expect(isSessionEnded()).toBe(false);
  });

  it('Auth sobrecarregado (429): continua na conta, com cache e lembretes', async () => {
    mockAuth.refresh = { data: { session: null }, error: new AuthApiError('Request rate limit reached', 429, 'over_request_rate_limit') };
    await expect(endSessionIfGone()).resolves.toBe(false);
    expect(mockCalls).toEqual(['refresh']);
    expect(isSessionEnded()).toBe(false);
  });

  it('a limpeza de quem chamou roda antes de sair, com a sessão ainda aqui', async () => {
    mockAuth.refresh = { data: { session: null }, error: new AuthApiError('Session not found', 403, 'session_not_found') };
    await endSessionIfGone(async () => {
      mockCalls.push(`limpeza (sessão ${mockStored.size ? 'guardada' : 'apagada'})`);
    });
    expect(mockCalls).toEqual(['refresh', 'limpeza (sessão guardada)', 'lembretes', 'signOut local']);
  });

  it('outro 401 que chega enquanto os lembretes saem: a limpeza dele também roda antes de sair', async () => {
    mockAuth.refresh = { data: { session: null }, error: new AuthApiError('Session not found', 403, 'session_not_found') };
    const cleanup = (who: string) => async () => {
      mockCalls.push(`limpeza ${who} (sessão ${mockStored.size ? 'guardada' : 'apagada'})`);
    };
    let late: Promise<boolean> | undefined;
    mockHooks.onReminders = () => {
      late = endSessionIfGone(cleanup('tardia'));
    };
    await expect(endSessionIfGone(cleanup('primeira'))).resolves.toBe(true);
    await expect(late).resolves.toBe(true);
    expect(mockCalls).toEqual([
      'refresh',
      'limpeza primeira (sessão guardada)',
      'lembretes',
      'limpeza tardia (sessão guardada)',
      'signOut local',
    ]);
  });
});
