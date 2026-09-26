import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useMedications } from '@/data/home';
import { todayISO } from '@/domain/dates';
import { syncReminders } from '@/lib/reminders';

/**
 * Refaz os lembretes de remédio deste aparelho ao abrir o app e ao voltar
 * para ele: a janela de doses avulsas anda e tratamentos encerrados saem.
 */
export function useReminderSync() {
  const medications = useMedications();
  const data = medications.data;
  useEffect(() => {
    if (!data) return;
    const run = () => {
      syncReminders(data, todayISO()).catch(() => undefined);
    };
    run();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => subscription.remove();
  }, [data]);
}
