import { useCallback, useEffect, useMemo } from 'react';
import { AppState } from 'react-native';

import { useBills } from '@/data/finance';
import { useChores, useMedications } from '@/data/home';
import { useAppointments, usePeople, useVaccines } from '@/data/health';
import { useDocuments } from '@/data/house';
import { todayISO, toISODate } from '@/domain/dates';
import { currentTimeHHMM } from '@/domain/medications';
import { anyHouseReminderKind, syncHouseReminders, syncReminders, type HouseReminderData } from '@/lib/reminders';

type Rows<T extends () => { data?: unknown }> = NonNullable<ReturnType<T>['data']>;

function toHouseReminderData(
  bills: Rows<typeof useBills>,
  documents: Rows<typeof useDocuments>,
  chores: Rows<typeof useChores>,
  appointments: Rows<typeof useAppointments>,
  vaccines: Rows<typeof useVaccines>,
  people: Rows<typeof usePeople>,
): HouseReminderData {
  const personName = (id: string) => people.find((p) => p.id === id)?.name ?? '';
  return {
    bills,
    documents,
    chores,
    // Data e hora da consulta no fuso do aparelho.
    appointments: appointments.map((a) => ({
      id: a.id,
      title: a.title,
      person: personName(a.person_id),
      date: toISODate(new Date(a.starts_at)),
      time: currentTimeHHMM(new Date(a.starts_at)),
      location: a.location,
      status: a.status,
    })),
    vaccines: vaccines.map((v) => ({
      id: v.id,
      name: v.name,
      dose: v.dose,
      person: personName(v.person_id),
      next_dose_on: v.next_dose_on,
    })),
  };
}

/**
 * Contas, documentos, tarefas, consultas e vacinas para os avisos da casa
 * (`data`, null enquanto carrega) e `refetch`, que busca tudo de novo e
 * devolve o resultado.
 */
export function useHouseReminderData() {
  const bills = useBills();
  const documents = useDocuments();
  const chores = useChores();
  const appointments = useAppointments();
  const vaccines = useVaccines();
  const people = usePeople();
  // Mesmo objeto enquanto os dados não mudam: não refaz os avisos à toa.
  const data = useMemo<HouseReminderData | null>(
    () =>
      bills.data && documents.data && chores.data && appointments.data && vaccines.data && people.data
        ? toHouseReminderData(bills.data, documents.data, chores.data, appointments.data, vaccines.data, people.data)
        : null,
    [bills.data, documents.data, chores.data, appointments.data, vaccines.data, people.data],
  );
  const { refetch: refetchBills } = bills;
  const { refetch: refetchDocuments } = documents;
  const { refetch: refetchChores } = chores;
  const { refetch: refetchAppointments } = appointments;
  const { refetch: refetchVaccines } = vaccines;
  const { refetch: refetchPeople } = people;
  const refetch = useCallback(async (): Promise<HouseReminderData | null> => {
    const [b, d, c, a, v, p] = await Promise.all([
      refetchBills(),
      refetchDocuments(),
      refetchChores(),
      refetchAppointments(),
      refetchVaccines(),
      refetchPeople(),
    ]);
    return b.data && d.data && c.data && a.data && v.data && p.data
      ? toHouseReminderData(b.data, d.data, c.data, a.data, v.data, p.data)
      : null;
  }, [refetchBills, refetchDocuments, refetchChores, refetchAppointments, refetchVaccines, refetchPeople]);
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
