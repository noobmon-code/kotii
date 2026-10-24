// Recados para quem faz o Kotii (domain/appFeedback): o envio, que a pessoa faz pelo Nuke com um toque em
// "Enviar" (send_app_feedback, com o aparelho e a versão do app), e a caixa de entrada de quem mantém o app, na aba
// Recados do Painel do app (app_feedback_list e set_app_feedback, recusadas no servidor com 42501 para quem não
// está em app_admins, como o painel). Migração: 20261024150000_app_feedback.sql.
//
// Fica só na memória: nenhuma chave daqui entra em PERSISTED (lib/queryClient), e nada daqui vai para o resumo do
// Nuke ou para o consultor (__tests__/appDashboardIsolation confere). O app pode chegar antes da migração: sem as
// funções, o envio diz que ainda não dá e a caixa de entrada diz que falta a migração, nunca um erro cru.

import type { SupabaseClient } from '@supabase/supabase-js';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import {
  applyFeedbackUpdate,
  cleanFeedbackText,
  FEEDBACK_GONE,
  FEEDBACK_INBOX_NOT_READY,
  FEEDBACK_LIMIT,
  FEEDBACK_LIST_LIMIT,
  FEEDBACK_NOT_READY,
  feedbackPlatform,
  parseFeedbackItem,
  parseFeedbackList,
  type FeedbackItem,
  type FeedbackKind,
  type FeedbackList,
  type FeedbackStatus,
} from '@/domain/appFeedback';
import { useAuth } from '@/lib/auth';
import { errorMessage, supabase } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';

import { AppDashboardForbidden } from './appDashboard';
import { isMissingFunction } from './missingSchema';

function codeOf(error: unknown): unknown {
  return error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
}

/**
 * Manda o recado que a pessoa confirmou no cartão do Nuke e devolve o id dele. O mesmo texto mandado de novo em
 * 10 minutos (a resposta que se perdeu) devolve o mesmo id, sem recado repetido. Sem a função no banco,
 * `FEEDBACK_NOT_READY`; passado o limite de 24 horas (NK015), `FEEDBACK_LIMIT`; outro erro sobe como veio.
 */
export async function sendAppFeedback(
  { kind, message }: { kind: FeedbackKind; message: string },
  db: SupabaseClient = supabase,
): Promise<string> {
  const { data, error } = await db.rpc('send_app_feedback', {
    p_kind: kind,
    p_message: cleanFeedbackText(message),
    p_platform: feedbackPlatform(Platform.OS),
    p_app_version: Constants.expoConfig?.version ?? null,
  });
  if (error && isMissingFunction(error, 'send_app_feedback')) throw new Error(FEEDBACK_NOT_READY);
  if (error && codeOf(error) === 'NK015') throw new Error(FEEDBACK_LIMIT);
  if (error) throw error;
  return String(data);
}

/** A chave de uma lista da caixa de entrada: a pessoa (outra conta no aparelho pergunta de novo) e o filtro. */
export const appFeedbackQueryKey = (userId: string | undefined, status: FeedbackStatus | null) =>
  ['appFeedback', userId, status ?? 'todos'] as const;

/**
 * Os recados de uma situação (null: todos), os mais novos primeiro e no máximo `FEEDBACK_LIST_LIMIT`, com as
 * contagens de todas as situações, conferidos (parseFeedbackList: um formato que esta versão não lê lança
 * FEEDBACK_INVALID). null quando a função ainda não existe no banco; a recusa do servidor (42501) vira
 * `AppDashboardForbidden`, a mesma do painel; outro erro sobe como veio.
 */
export async function fetchAppFeedback(status: FeedbackStatus | null, db: SupabaseClient = supabase): Promise<FeedbackList | null> {
  const { data, error } = await db.rpc('app_feedback_list', { p_status: status, p_limit: FEEDBACK_LIST_LIMIT });
  if (error && isMissingFunction(error, 'app_feedback_list')) return null;
  if (error && codeOf(error) === '42501') throw new AppDashboardForbidden();
  if (error) throw error;
  return parseFeedbackList(data);
}

/**
 * Uma lista da caixa de entrada; `data` null: o banco ainda não tem a migração. Trinta segundos sem perguntar de
 * novo. Ao trocar de filtro, a lista de antes fica na tela até a nova chegar (os filtros não piscam). A recusa
 * não é tentada de novo: a resposta seria a mesma.
 */
export function useAppFeedback(status: FeedbackStatus | null) {
  const userId = useAuth().session?.user.id;
  return useQuery({
    queryKey: appFeedbackQueryKey(userId, status),
    enabled: Boolean(userId),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: (failures, error) => !(error instanceof AppDashboardForbidden) && failures < 1,
    queryFn: () => fetchAppFeedback(status),
  });
}

/** Busca de novo as listas de recados na tela (puxar a tela para baixo, o botão de atualizar). */
export function useRefetchAppFeedback() {
  const userId = useAuth().session?.user.id;
  const queryClient = useQueryClient();
  return () => queryClient.refetchQueries({ queryKey: ['appFeedback', userId], type: 'active' });
}

/** O recado não existe mais (a conta de quem mandou foi apagada). */
export class FeedbackGone extends Error {
  constructor() {
    super(FEEDBACK_GONE);
  }
}

/** Uma mudança num recado: a situação e/ou a nota (null: fica como está; a nota '' apaga). */
export interface FeedbackChange {
  id: string;
  status?: FeedbackStatus | null;
  note?: string | null;
  /** Sem aviso quando falha: a marcação de lido ao abrir (abrir de novo marca de novo). */
  quiet?: boolean;
}

/**
 * Grava a mudança e devolve o recado como ficou. O recado apagado no meio (a conta foi apagada) é
 * `FEEDBACK_GONE` (P0002); a recusa (42501), `AppDashboardForbidden`; sem a função no banco,
 * `FEEDBACK_INBOX_NOT_READY`. As recusas de valor (22023, a nota longa demais) já vêm do banco em português.
 */
export async function setAppFeedback(change: FeedbackChange, db: SupabaseClient = supabase): Promise<FeedbackItem> {
  const { data, error } = await db.rpc('set_app_feedback', {
    p_id: change.id,
    p_status: change.status ?? null,
    p_note: change.note ?? null,
  });
  if (error && isMissingFunction(error, 'set_app_feedback')) throw new Error(FEEDBACK_INBOX_NOT_READY);
  if (error && codeOf(error) === 'P0002') throw new FeedbackGone();
  if (error && codeOf(error) === '42501') throw new AppDashboardForbidden();
  if (error) throw error;
  return parseFeedbackItem(data);
}

/** A chave das mudanças em recados: os botões ficam parados enquanto alguma está no ar (useIsMutating). */
export const SET_APP_FEEDBACK_KEY = ['setAppFeedback'] as const;

/**
 * Muda a situação ou a nota de um recado. O recado que volta entra já em todas as listas guardadas (com as
 * contagens acompanhando: applyFeedbackUpdate), e só então elas são buscadas de novo, sem esperar. O aviso de
 * erro fica aqui, não na tela: ele sai mesmo se a pessoa já trocou de aba. O recado que sumiu e a recusa também
 * buscam as listas de novo: o recado sai delas (com aviso, também ao só abrir), e a recusa vira o cadeado da
 * caixa, que já diz o que houve (sem aviso).
 */
export function useSetAppFeedback() {
  const userId = useAuth().session?.user.id;
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['appFeedback', userId] });
  return useMutation({
    mutationKey: SET_APP_FEEDBACK_KEY,
    mutationFn: (change: FeedbackChange) => setAppFeedback(change),
    onSuccess: (item) => {
      queryClient.setQueriesData<FeedbackList | null>({ queryKey: ['appFeedback', userId] }, (list) =>
        list ? applyFeedbackUpdate(list, item) : list,
      );
      refresh();
    },
    onError: (err, change) => {
      if (err instanceof AppDashboardForbidden) return refresh();
      if (err instanceof FeedbackGone) refresh();
      else if (change.quiet) return;
      notify('Não deu para salvar o recado', errorMessage(err));
    },
  });
}
