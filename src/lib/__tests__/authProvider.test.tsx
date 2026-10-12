import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Session } from '@supabase/supabase-js';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { forgetActiveHousehold } from '../activeHousehold';
import { AuthProvider, useAuth } from '../auth';
import { finishRecovery, forgetRecoveryInMemory, startRecovery } from '../passwordRecovery';
import { forgetCache } from '../queryClient';
import { disableAllReminders } from '../reminders';
import { noteSignedIn, noteSignedOut } from '../session';
import { supabase } from '../supabase';

// O provider de verdade, com o que ele chama trocado por espiões: o que se confere aqui é a ordem em
// que a sessão chega ao app quando ele abre pelo link do e-mail de recuperação (lib/recoveryLink).

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/ui/dialogs', () => ({ askYesNo: jest.fn() }));
jest.mock('../activeHousehold', () => ({
  forgetActiveHousehold: jest.fn(),
  getActiveHousehold: jest.fn(),
  loadActiveHousehold: jest.fn(async () => undefined),
  setActiveHousehold: jest.fn(),
}));
jest.mock('../passwordRecovery', () => ({
  beginRecovery: jest.fn(),
  finishRecovery: jest.fn(async () => undefined),
  forgetRecoveryInMemory: jest.fn(),
  readRecovery: jest.fn(async () => undefined),
  startRecovery: jest.fn(),
}));
jest.mock('../queryClient', () => ({
  cacheHousehold: jest.fn(),
  cacheOwners: jest.fn(() => []),
  forgetCache: jest.fn(),
  queryClient: {},
  resumeQueue: jest.fn(),
  setSessionValid: jest.fn(),
}));
// O link fica nas mãos do teste: `pending` e quando `run` termina.
jest.mock('../recoveryLink', () => {
  const link = { pending: false, run: jest.fn(async () => undefined) };
  return {
    mockLink: link,
    linkOwnerLookup: jest.fn(),
    createRecoveryLinkHandler: () => ({
      get pending() {
        return link.pending;
      },
      run: () => link.run(),
    }),
  };
});
jest.mock('../recoveryLinkBoot', () => ({ takeRecoveryLink: () => null }));
jest.mock('../reminders', () => ({
  disableAllReminders: jest.fn(async () => undefined),
  pruneHouseholdReminders: jest.fn(async () => undefined),
}));
jest.mock('../session', () => ({ noteSignedIn: jest.fn(), noteSignedOut: jest.fn(), signOut: jest.fn() }));
jest.mock('../supabase', () => ({
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_ANON_KEY: 'anon',
  unwrap: jest.fn(),
  supabase: { auth: { getSession: jest.fn(), onAuthStateChange: jest.fn() } },
}));

const link = jest.requireMock<{ mockLink: { pending: boolean; run: jest.Mock<() => Promise<void>> } }>('../recoveryLink').mockLink;
const auth = jest.mocked(supabase.auth);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const sessionOf = (id: string) => ({ user: { id }, expires_at: Math.floor(Date.now() / 1000) + 3600 }) as unknown as Session;
const stored = (session: Session | null) => ({ data: { session }, error: null }) as never;

/** O que o router enxerga. */
function Probe() {
  const { session, loading, valid } = useAuth();
  return JSON.stringify({ loading, user: session?.user.id ?? null, valid: valid ?? null });
}

let emit: (event: string, session: Session | null) => void;
let renderer: ReactTestRenderer | undefined;

async function mount() {
  await act(async () => {
    renderer = create(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await flush();
  });
  return () => JSON.parse(renderer!.toJSON() as unknown as string) as { loading: boolean; user: string | null; valid: boolean | null };
}

const send = (event: string, session: Session | null) =>
  act(async () => {
    emit(event, session);
    await flush();
  });

beforeEach(() => {
  jest.clearAllMocks();
  auth.onAuthStateChange.mockImplementation(((listener: typeof emit) => {
    emit = listener;
    return { data: { subscription: { unsubscribe: jest.fn() } } };
  }) as never);
  auth.getSession.mockResolvedValue(stored(null));
  link.pending = false;
  link.run.mockImplementation(async () => undefined);
});

afterEach(async () => {
  // Desmonta: o relógio do vencimento da sessão não fica para trás.
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('AuthProvider com o link de recuperação em andamento', () => {
  it('nenhuma sessão chega ao router antes de o link terminar, e o Supabase só é consultado depois', async () => {
    link.pending = true;
    let settle = () => undefined as void;
    link.run.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          settle = () => {
            link.pending = false;
            resolve();
          };
        }),
    );
    auth.getSession.mockResolvedValue(stored(sessionOf('ana')));
    const state = await mount();
    expect(state()).toEqual({ loading: true, user: null, valid: null });
    expect(auth.getSession).not.toHaveBeenCalled();

    // A sessão do link (ou a que já estava no aparelho) avisa antes da hora: fica esperando.
    await send('SIGNED_IN', sessionOf('ana'));
    await send('TOKEN_REFRESHED', sessionOf('ana'));
    expect(state()).toEqual({ loading: true, user: null, valid: null });
    expect(noteSignedIn).not.toHaveBeenCalled();
    expect(auth.getSession).not.toHaveBeenCalled();

    await act(async () => {
      settle();
      await flush();
    });
    expect(auth.getSession).toHaveBeenCalledTimes(1);
    expect(state()).toEqual({ loading: false, user: 'ana', valid: true });
  });

  it('uma saída nesse meio faz a limpeza de sempre, sem liberar a tela', async () => {
    link.pending = true;
    link.run.mockImplementation(() => new Promise<void>(() => undefined));
    const state = await mount();

    await send('SIGNED_OUT', null);
    expect(forgetRecoveryInMemory).toHaveBeenCalledTimes(1);
    expect(noteSignedOut).toHaveBeenCalledTimes(1);
    expect(forgetActiveHousehold).toHaveBeenCalledTimes(1);
    expect(forgetCache).toHaveBeenCalledTimes(1);
    expect(disableAllReminders).toHaveBeenCalledTimes(1);
    expect(state()).toEqual({ loading: true, user: null, valid: null });
  });
});

describe('AuthProvider sem link', () => {
  it('a sessão inicial vem do getSession e os eventos seguintes atualizam a tela', async () => {
    auth.getSession.mockResolvedValue(stored(sessionOf('ana')));
    const state = await mount();
    expect(link.run).toHaveBeenCalledTimes(1);
    expect(state()).toEqual({ loading: false, user: 'ana', valid: true });

    // Quem diz a sessão inicial é o getSession (ele sabe se faltou internet).
    await send('INITIAL_SESSION', null);
    expect(state()).toEqual({ loading: false, user: 'ana', valid: true });

    await send('SIGNED_OUT', null);
    expect(state()).toEqual({ loading: false, user: null, valid: false });
    expect(forgetCache).toHaveBeenCalledTimes(1);
    expect(noteSignedOut).toHaveBeenCalledTimes(1);

    // Entrou pelo código do e-mail: a marca da senha nova e, salva a senha, o fim dela.
    await send('PASSWORD_RECOVERY', sessionOf('bia'));
    expect(startRecovery).toHaveBeenCalledWith('bia');
    expect(noteSignedIn).toHaveBeenCalledTimes(1);
    expect(state()).toEqual({ loading: false, user: 'bia', valid: true });
    await send('USER_UPDATED', sessionOf('bia'));
    expect(finishRecovery).toHaveBeenCalledTimes(1);
  });

  it('sem sessão guardada, abre na tela de entrar', async () => {
    const state = await mount();
    expect(state()).toEqual({ loading: false, user: null, valid: null });
    expect(disableAllReminders).toHaveBeenCalledTimes(1);
  });
});
