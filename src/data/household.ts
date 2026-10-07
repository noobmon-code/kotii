// As casas da pessoa: trocar a casa aberta neste aparelho, criar ou entrar
// em outra e sair de uma. Sair: a função leave-household decide no servidor
// (quem vira dono, se a casa é apagada) e cuida das fotos; aqui fica o que é
// deste aparelho.

import { onlineManager, type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';

import { functionErrorMessage } from '@/data/images';
import { photoQueueBusy } from '@/data/listPhotos';
import { listQueueBusy } from '@/data/market';
import { clearConversation, conversationOwner } from '@/features/nuke/conversation';
import { setActiveHousehold } from '@/lib/activeHousehold';
import type { HouseholdState } from '@/lib/auth';
import { saveNow } from '@/lib/queryClient';
import { disableHouseholdReminders } from '@/lib/reminders';
import { errorMessage, supabase } from '@/lib/supabase';
import type { Household } from '@/lib/types';

/** A pessoa ficou sozinha na casa desde a confirmação: sair agora apaga a casa. */
export class LastMemberError extends Error {
  constructor() {
    super('Você é a última pessoa da casa: sair apaga a casa.');
  }
}

async function errorCode(error: unknown): Promise<string | null> {
  if (!(error instanceof FunctionsHttpError)) return null;
  try {
    const body = await error.context.clone().json();
    return typeof body?.code === 'string' ? body.code : null;
  } catch {
    return null;
  }
}

/** Mensagem para os erros de criar ou entrar numa casa. */
export const INVITE_NOT_FOUND = 'Código não encontrado. Confira com quem te convidou.';

export function householdErrorMessage(error: unknown): string {
  const message = errorMessage(error);
  if (/invalid invite code/i.test(message)) return INVITE_NOT_FOUND;
  if (/too many invite attempts/i.test(message)) return 'Muitas tentativas com código errado. Espere uma hora e tente de novo.';
  if (/already a member/i.test(message)) return 'Você já está nessa casa.';
  if (/household limit/i.test(message)) return 'Uma conta pode estar em até 5 casas. Saia de uma para criar ou entrar em outra.';
  return message;
}

/**
 * Trocar de casa busca tudo de novo, da outra casa: precisa de internet, e
 * as marcações da lista que esperam internet (feitas nesta casa) precisam
 * subir antes, senão iriam para a outra.
 */
function assertCanSwitch(queryClient: QueryClient) {
  if (!onlineManager.isOnline()) throw new Error('Sem internet agora. Troque de casa quando a conexão voltar.');
  if (listQueueBusy(queryClient) || photoQueueBusy(queryClient)) {
    throw new Error('Ainda há marcações ou fotos da lista esperando internet nesta casa. Troque quando elas subirem.');
  }
}

/**
 * Abre outra casa neste aparelho. O que estava na tela era da casa anterior:
 * sai já e é buscado de novo. A casa em si fica até a nova chegar (sem ela,
 * o app voltaria para a tela de abertura no meio da troca).
 */
export async function openHousehold(queryClient: QueryClient, userId: string, householdId: string) {
  await queryClient.cancelQueries();
  await setActiveHousehold(userId, householdId);
  queryClient.resetQueries({ predicate: (query) => query.queryKey[0] !== 'household' }).catch(() => undefined);
  await queryClient.invalidateQueries({ queryKey: ['household'] });
}

export function useSwitchHousehold(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (householdId: string) => {
      if (!userId) throw new Error('Entre na conta de novo.');
      assertCanSwitch(queryClient);
      // A mais recente: um aparelho novo abre nela.
      const { error } = await supabase.rpc('select_household', { p_household_id: householdId });
      if (error) throw error;
      await openHousehold(queryClient, userId, householdId);
    },
  });
}

export type AddHousehold =
  | { mode: 'criar'; name: string; displayName: string }
  | { mode: 'entrar'; code: string; displayName: string };

/** Cria outra casa, ou entra numa pelo código, e já abre nela. */
export function useAddHousehold(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddHousehold) => {
      if (!userId) throw new Error('Entre na conta de novo.');
      assertCanSwitch(queryClient);
      const { data, error } =
        input.mode === 'criar'
          ? await supabase.rpc('create_household', { p_name: input.name, p_display_name: input.displayName })
          : await supabase.rpc('join_household', { p_invite_code: input.code, p_display_name: input.displayName });
      if (error) throw new Error(householdErrorMessage(error));
      // Código errado: o banco devolve uma casa vazia (e conta a tentativa) em
      // vez de erro. O PostgREST manda o registro nulo como objeto com campos nulos.
      const house = data as Household | null;
      if (!house?.id) throw new Error(INVITE_NOT_FOUND);
      await openHousehold(queryClient, userId, house.id);
      return house;
    },
  });
}

/**
 * Tira do cache o que era da casa que a pessoa deixou. A casa em si vira
 * "sem casa" já (se ainda for a que ficou para trás): abrindo o app sem
 * internet depois, ele não volta para dentro dela. O servidor confirma depois.
 */
export function forgetLeftHousehold(queryClient: QueryClient, userId: string | undefined, householdId: string) {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'household' });
  queryClient.setQueryData<HouseholdState | null>(['household', userId], (current) =>
    current?.household.id === householdId ? null : current,
  );
}

/** `userId`: de quem é a conversa do Nuke a apagar (fala da casa antiga). */
export function useLeaveHousehold(userId: string | undefined) {
  const queryClient = useQueryClient();

  // Conversa, lembretes e cache são da casa que ficou para trás.
  async function resetAfterLeaving(householdId: string) {
    const state = queryClient.getQueryData<HouseholdState | null>(['household', userId]);
    const next = (state?.households ?? []).find((h) => h.id !== householdId);
    if (userId && next) {
      // Tem outra casa: abre nela, em vez da tela de criar ou entrar.
      await openHousehold(queryClient, userId, next.id);
    } else {
      // Primeiro o cache, gravado já: fechando o app no meio da limpeza dos
      // lembretes (que pode demorar), a casa antiga não volta.
      forgetLeftHousehold(queryClient, userId, householdId);
      await saveNow();
    }
    if (userId) clearConversation(conversationOwner(userId, householdId));
    await disableHouseholdReminders(householdId).catch(() => undefined);
    await queryClient.invalidateQueries({ queryKey: ['household'] });
  }

  return useMutation({
    /** `householdId`: a casa que a pessoa confirmou; `deleteIfLast`: confirmou apagar se for a última. */
    mutationFn: async ({ householdId, deleteIfLast }: { householdId: string; deleteIfLast: boolean }) => {
      const { data, error } = await supabase.functions.invoke<{ status: 'left' | 'deleted' }>('leave-household', {
        body: { householdId, deleteIfLast },
      });
      if (error && (await errorCode(error)) === 'last_member') throw new LastMemberError();
      if (error || !data) throw new Error(await functionErrorMessage(error, 'Não deu para sair da casa agora. Tente de novo.'));
      return data.status;
    },
    // No hook, e não na chamada: a tela some quando a casa some, e o que é
    // passado ao mutate() de uma tela desmontada não roda.
    onSuccess: (_status, { householdId }) => resetAfterLeaving(householdId),
    // Resposta perdida, tempo esgotado ou já tinha saído por outro aparelho:
    // confere se a pessoa ainda está nessa casa antes de tratar como erro.
    onError: async (err, { householdId }) => {
      if (err instanceof LastMemberError) return;
      await queryClient.refetchQueries({ queryKey: ['household', userId] });
      const current = queryClient.getQueryData<{ household: { id: string } } | null>(['household', userId]);
      if (current !== undefined && current?.household.id !== householdId) await resetAfterLeaving(householdId);
    },
  });
}
