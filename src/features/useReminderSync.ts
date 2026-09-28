import { useCallback, useEffect, useMemo } from 'react';
import { AppState } from 'react-native';

import { useBills } from '@/data/finance';
import { useChores, useMedications } from '@/data/home';
import { useDocuments } from '@/data/house';
import { todayISO } from '@/domain/dates';
import { anyHouseReminderKind, syncHouseReminders, syncReminders, type HouseReminderData } from '@/lib/reminders';

/**
 * Contas, documentos e tarefas para os avisos da casa (`data`, null enquanto
 * carrega) e `refetch`, que busca os três de novo e devolve o resultado.
 */
export function useHouseReminderData() {
  const bills = useBills();
  const documents = useDocuments();
  const chores = useChores();
  // Mesmo objeto enquanto os dados não mudam: não refaz os avisos à toa.
  const data = useMemo<HouseReminderData | null>(
    () => (bills.data && documents.data && chores.data ? { bills: bills.data, documents: documents.data, chores: chores.data } : null),
    [bills.data, documents.data, chores.data],
  );
  const { refetch: refetchBills } = bills;
  const { refetch: refetchDocuments } = documents;
  const { refetch: refetchChores } = chores;
  const refetch = useCallback(async (): Promise<HouseReminderData | null> => {
    const [b, d, c] = await Promise.all([refetchBills(), refetchDocuments(), refetchChores()]);
    return b.data && d.data && c.data ? { bills: b.data, documents: d.data, chores: c.data } : null;
  }, [refetchBills, refetchDocuments, refetchChores]);
  return { data, refetch };
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
  const { refetch: refetchHouse } = house;

  useEffect(() => {
    if (data) syncReminders(data, todayISO()).catch(() => undefined);
  }, [data]);

  useEffect(() => {
    if (house.data) syncHouseReminders(house.data).catch(() => undefined);
  }, [house.data]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      refetch()
        .then((result) => (result.data ? syncReminders(result.data, todayISO()) : undefined))
        .catch(() => undefined);
      // Refaz com o resultado da busca, e não pelo efeito acima: dados iguais
      // mantêm o mesmo objeto, mas o dia pode ter mudado e a janela precisa andar.
      // Sem nenhum aviso da casa ligado, nem busca.
      anyHouseReminderKind()
        .then((on) => (on ? refetchHouse() : null))
        .then((fresh) => (fresh ? syncHouseReminders(fresh) : undefined))
        .catch(() => undefined);
    });
    return () => subscription.remove();
  }, [refetch, refetchHouse]);
}
