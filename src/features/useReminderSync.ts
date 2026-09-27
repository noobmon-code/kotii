import { useEffect, useMemo } from 'react';
import { AppState } from 'react-native';

import { useBills } from '@/data/finance';
import { useChores, useMedications } from '@/data/home';
import { useDocuments } from '@/data/house';
import { todayISO } from '@/domain/dates';
import { syncHouseReminders, syncReminders, type HouseReminderData } from '@/lib/reminders';

/** Contas, documentos e tarefas para os avisos da casa; null enquanto carrega. */
export function useHouseReminderData(): HouseReminderData | null {
  const { data: bills } = useBills();
  const { data: documents } = useDocuments();
  const { data: chores } = useChores();
  // Mesmo objeto enquanto os dados não mudam: não refaz os avisos à toa.
  return useMemo(
    () => (bills && documents && chores ? { bills, documents, chores } : null),
    [bills, documents, chores],
  );
}

/**
 * Refaz os lembretes deste aparelho ao abrir o app e ao voltar para ele: a
 * janela de doses avulsas anda, tratamentos encerrados saem, contas pagas e
 * tarefas feitas mudam de data. Ao voltar, busca tudo de novo (pode ter
 * mudado em outro celular).
 */
export function useReminderSync() {
  const { data, refetch } = useMedications();
  const house = useHouseReminderData();
  const { refetch: refetchBills } = useBills();
  const { refetch: refetchDocuments } = useDocuments();
  const { refetch: refetchChores } = useChores();

  useEffect(() => {
    if (data) syncReminders(data, todayISO()).catch(() => undefined);
  }, [data]);

  useEffect(() => {
    if (house) syncHouseReminders(house).catch(() => undefined);
  }, [house]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      refetch()
        .then((result) => (result.data ? syncReminders(result.data, todayISO()) : undefined))
        .catch(() => undefined);
      // Os avisos da casa se refazem pelo efeito acima quando os dados chegam.
      refetchBills().catch(() => undefined);
      refetchDocuments().catch(() => undefined);
      refetchChores().catch(() => undefined);
    });
    return () => subscription.remove();
  }, [refetch, refetchBills, refetchDocuments, refetchChores]);
}
