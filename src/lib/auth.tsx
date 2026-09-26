import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { supabase, unwrap } from './supabase';
import type { Household, Member } from './types';

interface AuthState {
  session: Session | null;
  loading: boolean;
}

const AuthContext = createContext<AuthState>({ session: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true });
  const queryClient = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setState({ session: data.session, loading: false }));
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setState({ session, loading: false });
      if (event === 'SIGNED_OUT') queryClient.clear();
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

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
