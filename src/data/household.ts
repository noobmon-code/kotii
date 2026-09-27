// Sair da casa: a função leave-household decide no servidor (quem vira
// dono, se a casa é apagada) e só então apaga as fotos; aqui fica o que é
// deste aparelho.

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { functionErrorMessage } from '@/data/images';
import { disableAllReminders } from '@/lib/reminders';
import { supabase } from '@/lib/supabase';

export function useLeaveHousehold() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<{ status: 'left' | 'deleted' }>('leave-household', { body: {} });
      if (error || !data) throw new Error(await functionErrorMessage(error, 'Não deu para sair da casa agora. Tente de novo.'));
      return data.status;
    },
    onSuccess: async () => {
      // Os lembretes e os dados em cache são da casa que ficou para trás.
      await disableAllReminders().catch(() => undefined);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'household' });
      await queryClient.invalidateQueries({ queryKey: ['household'] });
    },
  });
}
