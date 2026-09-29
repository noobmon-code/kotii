import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { AppState } from 'react-native';

import { useBills } from '@/data/finance';
import { useChores, useMedications } from '@/data/home';
import { useAppointments, usePeople, useVaccines } from '@/data/health';
import { useDocuments, useEquipmentList } from '@/data/house';
import { forecastQuery, useForecast, useHouseholdLocation, type HouseholdLocation } from '@/data/weather';
import { todayISO, toISODate } from '@/domain/dates';
import { pendingNextDoses } from '@/domain/health';
import { currentTimeHHMM } from '@/domain/medications';
import { houseClock, weatherContext, weatherMornings, type Forecast } from '@/domain/weather';
import { anyHouseReminderKind, syncHouseReminders, syncReminders, type HouseReminderData } from '@/lib/reminders';

type Rows<T extends () => { data?: unknown }> = NonNullable<ReturnType<T>['data']>;

/**
 * O que o clima precisa: o local da casa (null: ninguém definiu, sem dicas),
 * a previsão e o que a casa tem (pets, crianças, rega, carro).
 */
interface WeatherInput {
  location: HouseholdLocation | null | undefined;
  forecast: Forecast | undefined;
  equipment: Rows<typeof useEquipmentList> | undefined;
}

/**
 * Consultas, vacinas e o clima só entram quando eles e as fichas carregaram;
 * sem eles (undefined), contas, documentos e tarefas seguem normais e os
 * avisos de saúde e do clima já agendados ficam como estão.
 */
function toHouseReminderData(
  bills: Rows<typeof useBills>,
  documents: Rows<typeof useDocuments>,
  chores: Rows<typeof useChores>,
  appointments: Rows<typeof useAppointments> | undefined,
  vaccines: Rows<typeof useVaccines> | undefined,
  people: Rows<typeof usePeople> | undefined,
  { location, forecast, equipment }: WeatherInput,
): HouseReminderData {
  const today = todayISO();
  const personName = (id: string) => people?.find((p) => p.id === id)?.name ?? '';
  return {
    bills,
    documents,
    chores,
    // Data e hora da consulta no fuso do aparelho.
    appointments: people && appointments?.map((a) => ({
      id: a.id,
      title: a.title,
      person: personName(a.person_id),
      date: toISODate(new Date(a.starts_at)),
      time: currentTimeHHMM(new Date(a.starts_at)),
      location: a.location,
      status: a.status,
    })),
    // Só doses ainda por tomar: aplicação registrada depois encerra a próxima dose do registro anterior.
    vaccines: people && vaccines && pendingNextDoses(vaccines).map((v) => ({
      id: v.id,
      name: v.name,
      dose: v.dose,
      person: personName(v.person_id),
      next_dose_on: v.next_dose_on,
    })),
    weatherPlace: location ? `${location.latitude},${location.longitude}` : location,
    weather:
      location === null
        ? []
        : location && forecast && people && equipment
          ? // As manhãs a partir de hoje na casa (pelo fuso dela).
            weatherMornings(forecast, weatherContext(people, chores, equipment, today), houseClock(forecast).date)
          : undefined,
  };
}

/**
 * Contas, documentos, tarefas, consultas, vacinas e o clima para os avisos da
 * casa (`data`, null enquanto carrega) e `refetch`, que busca tudo de novo e
 * devolve o resultado.
 */
export function useHouseReminderData() {
  const bills = useBills();
  const documents = useDocuments();
  const chores = useChores();
  const appointments = useAppointments();
  const vaccines = useVaccines();
  const people = usePeople();
  const location = useHouseholdLocation();
  const forecast = useForecast(location.data);
  const equipment = useEquipmentList();
  // Mesmo objeto enquanto os dados não mudam: não refaz os avisos à toa.
  const data = useMemo<HouseReminderData | null>(
    () =>
      bills.data && documents.data && chores.data
        ? toHouseReminderData(bills.data, documents.data, chores.data, appointments.data, vaccines.data, people.data, {
            location: location.data,
            forecast: forecast.data,
            equipment: equipment.data,
          })
        : null,
    [bills.data, documents.data, chores.data, appointments.data, vaccines.data, people.data, location.data, forecast.data, equipment.data],
  );
  const { refetch: refetchBills } = bills;
  const { refetch: refetchDocuments } = documents;
  const { refetch: refetchChores } = chores;
  const { refetch: refetchAppointments } = appointments;
  const { refetch: refetchVaccines } = vaccines;
  const { refetch: refetchPeople } = people;
  const { refetch: refetchLocation } = location;
  const { refetch: refetchEquipment } = equipment;
  const queryClient = useQueryClient();
  const refetch = useCallback(async (): Promise<HouseReminderData | null> => {
    const [b, d, c, a, v, p, l, e] = await Promise.all([
      refetchBills(),
      refetchDocuments(),
      refetchChores(),
      refetchAppointments(),
      refetchVaccines(),
      refetchPeople(),
      refetchLocation(),
      refetchEquipment(),
    ]);
    // A previsão do local de agora; a guardada vale enquanto não passa de uma hora.
    const forecast = l.data ? await queryClient.fetchQuery(forecastQuery(l.data)).catch(() => undefined) : undefined;
    return b.data && d.data && c.data
      ? toHouseReminderData(b.data, d.data, c.data, a.data, v.data, p.data, { location: l.data, forecast, equipment: e.data })
      : null;
  }, [refetchBills, refetchDocuments, refetchChores, refetchAppointments, refetchVaccines, refetchPeople, refetchLocation, refetchEquipment, queryClient]);
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
