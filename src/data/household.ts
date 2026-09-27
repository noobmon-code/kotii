// Sair da casa: a função leave-household decide no servidor (quem vira
// dono, se a casa é apagada) e cuida das fotos; aqui fica o que é deste
// aparelho.

import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';

import { functionErrorMessage } from '@/data/images';
import { clearConversation } from '@/features/nuke/conversation';
import type { HouseholdState } from '@/lib/auth';
import { saveNow } from '@/lib/queryClient';
import { disableAllReminders } from '@/lib/reminders';
import { supabase } from '@/lib/supabase';

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
    if (userId) clearConversation(userId);
    await disableAllReminders().catch(() => undefined);
    forgetLeftHousehold(queryClient, userId, householdId);
    // Grava já: fechando o app logo depois, a casa antiga não volta.
    saveNow();
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
