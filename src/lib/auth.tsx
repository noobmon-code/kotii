import AsyncStorage from '@react-native-async-storage/async-storage';
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { useIsRestoring, useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { forgetActiveHousehold, getActiveHousehold, loadActiveHousehold, setActiveHousehold } from './activeHousehold';
import { cacheHousehold, cacheOwners, forgetCache, queryClient, resumeQueue, setSessionValid } from './queryClient';
import { disableAllReminders, pruneHouseholdReminders } from './reminders';
import { supabase, unwrap } from './supabase';
import type { Household, Member } from './types';

/**
 * Sai da conta neste aparelho. Antes, os lembretes daqui saem (no navegador,
 * também a inscrição dos avisos), para não tocar o remédio de quem saiu.
 */
export async function signOut(): Promise<void> {
  await disableAllReminders().catch(() => undefined);
  await supabase.auth.signOut();
}

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
    last.then(async (session) => {
      if (!confirmed && session?.expires_at && session.expires_at * 1000 < Date.now()) {
        // Sem internet para o cache antes de mostrar a conta: as consultas que
        // ela libera já nascem esperando a sessão ser renovada.
        setSessionValid(false);
        // A casa aberta neste aparelho antes de qualquer consulta da conta.
        await loadActiveHousehold(session.user.id);
        if (!confirmed) setState({ session, loading: false, valid: false });
      }
    });
    supabase.auth.getSession().then(async ({ data, error }) => {
      confirmed = true;
      if (data.session) {
        await loadActiveHousehold(data.session.user.id);
        setState({ session: data.session, loading: false, valid: true });
        saveLastSession(data.session);
      } else if (error && isAuthRetryableFetchError(error)) {
        // Não renovou por falta de conexão: a conta continua; segue com a última
        // (e o cache, como sem internet, antes de ela aparecer).
        setSessionValid(false);
        const session = await last;
        if (session) await loadActiveHousehold(session.user.id);
        setState({ session, loading: false, valid: false });
      } else {
        setState({ session: null, loading: false });
        forgetLastSession();
        // A sessão acabou (sem ser por falta de internet): os lembretes de quem estava aqui saem.
        disableAllReminders().catch(() => undefined);
      }
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // A sessão inicial vem do getSession acima, que diz se faltou internet.
      if (event === 'INITIAL_SESSION') return;
      setState({ session, loading: false, valid: Boolean(session) });
      if (session) saveLastSession(session);
      if (event === 'SIGNED_OUT') {
        forgetLastSession();
        forgetActiveHousehold();
        forgetCache();
        // Qualquer saída (o botão, a sessão revogada): os lembretes deste aparelho
        // saem. No navegador, sem a sessão, o servidor não apaga a agenda, mas o
        // navegador desfaz a inscrição e o servidor deixa de mandar (410).
        disableAllReminders().catch(() => undefined);
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
    // Cache de outra casa (a troca não chegou a ser gravada): também não serve.
    const cached = cacheHousehold();
    const active = getActiveHousehold();
    if (cacheOwners().some((owner) => owner !== userId) || (cached && active && cached !== active)) forgetCache();
    else {
      // Cache de antes das várias casas: era da única casa, que fica aberta.
      if (cached && !active) setActiveHousehold(userId, cached);
      resumeQueue();
    }
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

/** Uma das casas da pessoa. */
export interface HouseholdSummary {
  id: string;
  name: string;
  role: Member['role'];
}

export interface HouseholdState {
  household: Household;
  members: Member[];
  me: Member;
  /** Todas as casas da pessoa, da aberta mais recentemente para a menos. */
  households: HouseholdSummary[];
}

/** Guardada no aparelho antes das várias casas, a casa vem sem a lista: era a única. */
function withHouseholds(state: HouseholdState | null): HouseholdState | null {
  if (!state || state.households) return state;
  return { ...state, households: [{ id: state.household.id, name: state.household.name, role: state.me.role }] };
}

/**
 * A casa aberta neste aparelho (e as outras da pessoa); null enquanto ela não
 * criou nem entrou em nenhuma. Se o aparelho estava numa casa de que a
 * pessoa saiu (por outro aparelho) ou nunca abriu uma, abre a mais recente.
 */
export function useHousehold() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['household', userId],
    enabled: Boolean(userId),
    select: withHouseholds,
    queryFn: async (): Promise<HouseholdState | null> => {
      await loadActiveHousehold(userId!);
      const houses = (unwrap(await supabase.rpc('my_households')) ?? []) as HouseholdSummary[];
      // Casa de que a pessoa saiu por outro aparelho, ou de que foi tirada:
      // os lembretes dela saem deste aparelho. Sem casa nenhuma, saem todos,
      // inclusive os de antes das várias casas (sem casa marcada).
      (houses.length ? pruneHouseholdReminders(houses.map((h) => h.id)) : disableAllReminders()).catch(() => undefined);
      const current = getActiveHousehold();
      const pick = houses.find((h) => h.id === current) ?? houses[0];
      if (pick?.id !== current) {
        await setActiveHousehold(userId!, pick?.id ?? null);
        // O que foi buscado até aqui era de outra casa (ou de nenhuma).
        queryClient.resetQueries({ predicate: (query) => query.queryKey[0] !== 'household' }).catch(() => undefined);
      }
      if (!pick) return null;
      // A casa aberta também fica registrada para esta sessão: a lista ao vivo
      // (tempo real) não leva o cabeçalho da casa. Falhar aqui não impede abrir.
      supabase.rpc('select_household', { p_household_id: pick.id }).then(
        () => undefined,
        () => undefined,
      );
      const households = unwrap(await supabase.from('households').select('id, name, invite_code, created_by'));
      const household = (households as Household[]).find((h) => h.id === pick.id);
      // Saiu da casa entre as duas buscas: a próxima tentativa abre outra.
      if (!household) throw new Error('Não foi possível abrir a casa. Tente de novo.');
      const members = unwrap(
        await supabase
          .from('household_members')
          .select('household_id, user_id, display_name, role')
          .order('joined_at'),
      ) as Member[];
      const me = members.find((m) => m.user_id === userId)!;
      return { household, members, me, households: houses };
    },
  });
}

/** Atalho para telas que só existem dentro de uma família. */
export function useHouseholdId(): string | undefined {
  return useHousehold().data?.household.id;
}
