// Painel do app: os números de uso que só quem mantém o Kotii vê. Duas rpc:
// is_app_admin (a pessoa está em app_admins? decide se a linha aparece em
// Configurações) e app_dashboard (os totais, recusados no servidor com 42501
// para quem não está lá). A resposta é só de totais: nenhuma pessoa ou casa.
//
// Fica só na memória: nenhuma chave daqui entra em PERSISTED (lib/queryClient),
// e nada daqui vai para o resumo do Nuke ou para o consultor
// (__tests__/appDashboardIsolation confere os três). O app pode chegar antes da
// migração: sem as funções, a linha não aparece e o painel diz que ainda não
// está disponível, nunca um erro.

import type { SupabaseClient } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';

import { APP_DASHBOARD_FORBIDDEN, parseAppDashboard, type AppDashboard } from '@/domain/appDashboard';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

import { isMissingFunction } from './missingSchema';

/** A recusa do servidor (42501): a pessoa não está em app_admins. A tela mostra o cadeado, não um erro. */
export class AppDashboardForbidden extends Error {
  constructor() {
    super(APP_DASHBOARD_FORBIDDEN);
  }
}

function codeOf(error: unknown): unknown {
  return error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
}

/** A pessoa mantém o app? false também quando a função ainda não existe no banco; outro erro sobe. */
export async function fetchIsAppAdmin(db: SupabaseClient = supabase): Promise<boolean> {
  const { data, error } = await db.rpc('is_app_admin');
  if (error && isMissingFunction(error, 'is_app_admin')) return false;
  if (error) throw error;
  return data === true;
}

/**
 * A linha "Painel do app" em Configurações. A chave leva a pessoa: outra conta no mesmo aparelho pergunta de
 * novo. Muda só com um insert à mão no banco, então cinco minutos sem perguntar não fazem falta.
 */
export function useIsAppAdmin() {
  const userId = useAuth().session?.user.id;
  return useQuery({
    queryKey: ['appAdmin', userId],
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    queryFn: () => fetchIsAppAdmin(),
  });
}

/**
 * Os números do painel, conferidos (parseAppDashboard: um formato que esta versão não lê lança
 * APP_DASHBOARD_INVALID). null quando a função ainda não existe no banco; a recusa do servidor (42501) vira
 * `AppDashboardForbidden`; outro erro sobe como veio.
 */
export async function fetchAppDashboard(db: SupabaseClient = supabase): Promise<AppDashboard | null> {
  const { data, error } = await db.rpc('app_dashboard');
  if (error && isMissingFunction(error, 'app_dashboard')) return null;
  if (error && codeOf(error) === '42501') throw new AppDashboardForbidden();
  if (error) throw error;
  return parseAppDashboard(data);
}

/**
 * O painel; `data` null: o banco ainda não tem a migração. Um minuto sem perguntar de novo (puxar a tela para
 * baixo busca na hora). A recusa não é tentada de novo: a resposta seria a mesma.
 */
export function useAppDashboard() {
  const userId = useAuth().session?.user.id;
  return useQuery({
    queryKey: ['appDashboard', userId],
    enabled: Boolean(userId),
    staleTime: 60_000,
    retry: (failures, error) => !(error instanceof AppDashboardForbidden) && failures < 1,
    queryFn: () => fetchAppDashboard(),
  });
}
