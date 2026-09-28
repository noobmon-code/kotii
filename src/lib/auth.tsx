import AsyncStorage from '@react-native-async-storage/async-storage';
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { useIsRestoring, useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { cacheOwners, forgetCache, resumeQueue, setSessionValid } from './queryClient';
import { supabase, unwrap } from './supabase';
import type { Household, Member } from './types';

/** O app só usa quem entrou; os tokens ficam com o Supabase. */
export type AppSession = Pick<Session, 'user' | 'expires_at'>;

interface AuthState {
  session: AppSession | null;
  loading: boolean;
  /** O Supabase confirmou a sessão e o token não venceu desde então. */
  valid?: boolean;
}

const AuthContext = createContext<AuthState>({ session: null, loading: true });

/** O maior intervalo que o setTimeout aceita. */
const MAX_TIMEOUT = 2 ** 31 - 1;

// Última conta que entrou neste aparelho. Sem internet e com o token vencido
// (mais de 1 h sem conexão, comum no mercado), o Supabase tenta renovar por
// ~30 s e responde sem sessão, embora a conta continue guardada. Com ela, o
// app abre na hora com o que está no aparelho; o Supabase confirma quando a
// conexão volta.
const LAST_SESSION_KEY = 'nooky:last-session';

async function readLastSession(): Promise<AppSession | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_SESSION_KEY);
    return raw ? (JSON.parse(raw) as AppSession) : null;
  } catch {
    return null;
  }
}

function saveLastSession({ user, expires_at }: AppSession) {
  AsyncStorage.setItem(LAST_SESSION_KEY, JSON.stringify({ user, expires_at })).catch(() => undefined);
}

function forgetLastSession() {
  AsyncStorage.removeItem(LAST_SESSION_KEY).catch(() => undefined);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true });
  const isRestoring = useIsRestoring();
  const userId = state.session?.user.id;

  useEffect(() => {
    let confirmed = false;
    const last = readLastSession();
    // Token vencido: o Supabase precisa da internet para responder. Entra já
    // com a última conta, em vez de esperar.
    last.then((session) => {
      if (!confirmed && session?.expires_at && session.expires_at * 1000 < Date.now()) {
        setState({ session, loading: false, valid: false });
      }
    });
    supabase.auth.getSession().then(async ({ data, error }) => {
      confirmed = true;
      if (data.session) {
        setState({ session: data.session, loading: false, valid: true });
        saveLastSession(data.session);
      } else if (error && isAuthRetryableFetchError(error)) {
        // Não renovou por falta de conexão: a conta continua; segue com a última.
        setState({ session: await last, loading: false, valid: false });
      } else {
        setState({ session: null, loading: false });
        forgetLastSession();
      }
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // A sessão inicial vem do getSession acima, que diz se faltou internet.
      if (event === 'INITIAL_SESSION') return;
      setState({ session, loading: false, valid: Boolean(session) });
      if (session) saveLastSession(session);
      if (event === 'SIGNED_OUT') {
        forgetLastSession();
        forgetCache();
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Cache restaurado: se é de outra conta (o app fechou antes de apagar, ou a
  // saída aconteceu antes de o cache terminar de ser lido), apaga antes de a
  // casa da conta nova carregar, com a fila junto. Se é de quem entrou, a
  // fila guardada pode sair. Vem antes do efeito da sessão válida: na mesma
  // renderização, a fila de outra conta some antes de a conexão liberar a fila.
  useEffect(() => {
    if (isRestoring || !userId) return;
    if (cacheOwners().some((owner) => owner !== userId)) forgetCache();
    else resumeQueue();
  }, [isRestoring, userId]);

  // Sessão vencida à espera de renovação: o cache fica como sem internet
  // (setSessionValid) até o Supabase renovar o token (TOKEN_REFRESHED).
  const { valid, session } = state;
  const expiresAt = session?.expires_at;
  useEffect(() => {
    setSessionValid(!session || Boolean(valid));
    if (!session || !valid || !expiresAt) return;
    const ms = expiresAt * 1000 - Date.now();
    // Relógio do aparelho adiantado: vale o que o Supabase confirmou.
    if (ms <= 0) return;
    const timer = setTimeout(() => setState((s) => ({ ...s, valid: false })), Math.min(ms, MAX_TIMEOUT));
    return () => clearTimeout(timer);
  }, [session, valid, expiresAt]);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export interface HouseholdState {
  household: Household;
  members: Member[];
  me: Member;
}

/** Família do usuário logado; null enquanto ele não criou/entrou em uma. */
export function useHousehold() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['household', userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<HouseholdState | null> => {
      const households = unwrap(await supabase.from('households').select('id, name, invite_code, created_by'));
      const household = (households as Household[])[0];
      if (!household) return null;
      const members = unwrap(
        await supabase
          .from('household_members')
          .select('household_id, user_id, display_name, role')
          .order('joined_at'),
      ) as Member[];
      const me = members.find((m) => m.user_id === userId)!;
      return { household, members, me };
    },
  });
}

/** Atalho para telas que só existem dentro de uma família. */
export function useHouseholdId(): string | undefined {
  return useHousehold().data?.household.id;
}
