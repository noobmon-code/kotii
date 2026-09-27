// Sair da casa: a função leave-household decide no servidor (quem vira
// dono, se a casa é apagada) e cuida das fotos; aqui fica o que é deste
// aparelho.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';

import { functionErrorMessage } from '@/data/images';
import { clearConversation } from '@/features/nuke/conversation';
import { disableAllReminders } from '@/lib/reminders';
import { supabase } from '@/lib/supabase';

/** A pessoa ficou sozinha na casa desde a confirmação: sair agora apaga a casa. */
export class LastMemberError extends Error {
  constructor() {
    super('Você é a última pessoa da casa: sair apaga a casa.');
  }
}

async function isLastMember(error: unknown): Promise<boolean> {
  if (!(error instanceof FunctionsHttpError)) return false;
  try {
    const body = await error.context.clone().json();
    return body?.code === 'last_member';
  } catch {
    return false;
  }
}

/** `userId`: de quem é a conversa do Nuke a apagar (fala da casa antiga). */
export function useLeaveHousehold(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    /** `deleteIfLast`: a pessoa confirmou apagar a casa se for a última. */
    mutationFn: async ({ deleteIfLast }: { deleteIfLast: boolean }) => {
      const { data, error } = await supabase.functions.invoke<{ status: 'left' | 'deleted' }>('leave-household', {
        body: { deleteIfLast },
      });
      if (error && (await isLastMember(error))) throw new LastMemberError();
      if (error || !data) throw new Error(await functionErrorMessage(error, 'Não deu para sair da casa agora. Tente de novo.'));
      return data.status;
    },
    // No hook, e não na chamada: a tela some quando a casa some, e o que é
    // passado ao mutate() de uma tela desmontada não roda.
    onSuccess: async () => {
      // Conversa, lembretes e cache são da casa que ficou para trás.
      if (userId) clearConversation(userId);
      await disableAllReminders().catch(() => undefined);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'household' });
      await queryClient.invalidateQueries({ queryKey: ['household'] });
    },
  });
}
