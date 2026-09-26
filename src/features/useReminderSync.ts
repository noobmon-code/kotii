import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useMedications } from '@/data/home';
import { todayISO } from '@/domain/dates';
import { syncReminders } from '@/lib/reminders';

/**
 * Refaz os lembretes de remédio deste aparelho ao abrir o app e ao voltar
 * para ele: a janela de doses avulsas anda e tratamentos encerrados saem.
 * Ao voltar, busca os remédios de novo (podem ter mudado em outro celular).
 */
export function useReminderSync() {
  const { data, refetch } = useMedications();

  useEffect(() => {
    if (data) syncReminders(data, todayISO()).catch(() => undefined);
  }, [data]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      refetch()
        .then((result) => (result.data ? syncReminders(result.data, todayISO()) : undefined))
        .catch(() => undefined);
    });
    return () => subscription.remove();
  }, [refetch]);
}
