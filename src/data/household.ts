// Sair da casa: a regra (quem vira dono, quando a casa é apagada) fica na
// função leave_household do banco; aqui ficam as fotos e o cache do app.

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { disableAllReminders } from '@/lib/reminders';
import { supabase } from '@/lib/supabase';

const BUCKETS = ['receipts', 'health', 'documents'] as const;

/** Apaga as fotos da casa (<bucket>/<casa>/<arquivo>) antes de a casa sumir. */
async function removeHouseholdFiles(householdId: string) {
  for (const bucket of BUCKETS) {
    for (;;) {
      const { data, error } = await supabase.storage.from(bucket).list(householdId, { limit: 100 });
      if (error) throw error;
      const paths = (data ?? []).filter((file) => file.id).map((file) => `${householdId}/${file.name}`);
      if (!paths.length) break;
      const removed = await supabase.storage.from(bucket).remove(paths);
      if (removed.error) throw removed.error;
      // Nada apagado (sem permissão): não fica em laço.
      if (!removed.data?.length) break;
    }
  }
}

export function useLeaveHousehold() {
  const queryClient = useQueryClient();
  return useMutation({
    /** `last`: a pessoa é a última da casa, que será apagada com tudo. */
    mutationFn: async ({ householdId, last }: { householdId: string; last: boolean }) => {
      if (last) await removeHouseholdFiles(householdId);
      const { data, error } = await supabase.rpc('leave_household');
      if (error) throw error;
      return data as 'left' | 'deleted';
    },
    onSuccess: async () => {
      // Os lembretes e os dados em cache são da casa que ficou para trás.
      await disableAllReminders().catch(() => undefined);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'household' });
      await queryClient.invalidateQueries({ queryKey: ['household'] });
    },
  });
}
