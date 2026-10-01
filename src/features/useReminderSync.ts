import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { AppState } from 'react-native';

import { fetchBills, useBills } from '@/data/finance';
import { fetchChores, fetchMedications, useChores, useMedications } from '@/data/home';
import { fetchAppointments, fetchPeople, fetchVaccines, useAppointments, usePeople, useVaccines } from '@/data/health';
import { fetchDocuments, fetchEquipmentList, useDocuments, useEquipmentList } from '@/data/house';
import { fetchHouseholdLocation, forecastQuery, useForecast, useHouseholdLocation, type HouseholdLocation } from '@/data/weather';
import { todayISO, toISODate } from '@/domain/dates';
import { pendingNextDoses } from '@/domain/health';
import { HOUSE_REMINDER_LIMIT } from '@/domain/houseReminders';
import { currentTimeHHMM } from '@/domain/medications';
import { weatherContext, weatherMornings, type Forecast } from '@/domain/weather';
import { type HouseholdSummary, useHousehold } from '@/lib/auth';
import {
  anyHouseReminderKind,
  householdsWithMedicationReminders,
  pruneHouseholdReminders,
  reconcileReminders,
  syncHouseReminders,
  syncReminders,
  type HouseReminderData,
  type HouseReminderTarget,
} from '@/lib/reminders';
import { householdClient } from '@/lib/supabase';

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
          ? // Às 7h da casa (pelo fuso dela), a partir de hoje lá.
            weatherMornings(forecast, weatherContext(people, chores, equipment, today))
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

/** Com várias casas, o teto de avisos da casa é dividido entre elas (e sobra vaga para os remédios). */
export const houseReminderLimit = (houses: number) => Math.max(8, Math.floor(HOUSE_REMINDER_LIMIT / Math.max(1, houses)));

/** Para onde vão os avisos da casa aberta: ela, o nome dela (com mais de uma) e o teto. */
export function useHouseReminderTarget(): HouseReminderTarget | null {
  const state = useHousehold().data;
  const id = state?.household.id;
  const name = state?.household.name;
  const count = state?.households.length ?? 1;
  return useMemo(
    () => (id ? { householdId: id, label: count > 1 ? name : undefined, adoptLegacy: true, limit: houseReminderLimit(count) } : null),
    [id, name, count],
  );
}

/**
 * Os lembretes das outras casas (a aberta segue pelos dados da tela): busca,
 * em segundo plano, só o que tem lembrete ligado neste aparelho. Sem
 * internet, o que já está agendado fica.
 */
export async function syncOtherHouses(queryClient: QueryClient, households: Pick<HouseholdSummary, 'id' | 'name'>[], activeId: string) {
  // Casas de que a pessoa saiu por outro aparelho: os lembretes delas saem.
  await pruneHouseholdReminders(households.map((h) => h.id));
  const others = households.filter((h) => h.id !== activeId);
  if (!others.length) return;
  const today = todayISO();
  const withMedications = await householdsWithMedicationReminders();
  const houseKinds = await anyHouseReminderKind();
  for (const house of others) {
    const db = householdClient(house.id);
    try {
      if (withMedications.has(house.id)) {
        await syncReminders(await fetchMedications(db), today, { householdId: house.id, label: house.name });
      }
      if (!houseKinds) continue;
      const optional = <T,>(promise: Promise<T>) => promise.catch(() => undefined);
      const [bills, documents, chores, appointments, vaccines, people, location, equipment] = await Promise.all([
        fetchBills(db),
        fetchDocuments(db),
        fetchChores(db),
        optional(fetchAppointments(db)),
        optional(fetchVaccines(db)),
        optional(fetchPeople(db)),
        optional(fetchHouseholdLocation(db)),
        optional(fetchEquipmentList(db)),
      ]);
      const forecast = location ? await queryClient.fetchQuery(forecastQuery(location)).catch(() => undefined) : undefined;
      await syncHouseReminders(
        toHouseReminderData(bills, documents, chores, appointments, vaccines, people, { location, forecast, equipment }),
        { householdId: house.id, label: house.name, limit: houseReminderLimit(households.length) },
      );
    } catch {
      // Sem internet (ou a casa sumiu no meio): tenta de novo na próxima vez.
    }
  }
}

/**
 * Refaz os lembretes deste aparelho ao abrir o app e ao voltar para ele: a
 * janela de doses avulsas anda, tratamentos encerrados saem, contas pagas e
 * tarefas feitas mudam de data. Ao voltar, busca tudo de novo (pode ter
 * mudado em outro celular). Vale para todas as casas da pessoa: a aberta pelos
 * dados da tela, as outras em segundo plano.
 */
export function useReminderSync() {
  const { data, refetch } = useMedications();
  const house = useHouseReminderData();
  const { refetch: refetchHouse } = house;
  const target = useHouseReminderTarget();
  const households = useHousehold().data?.households;
  const queryClient = useQueryClient();
  // Mesma lista enquanto as casas não mudam.
  const housesKey = JSON.stringify(households?.map((h) => [h.id, h.name]) ?? []);

  // No navegador: a agenda do servidor fica só com o que este navegador conhece.
  useEffect(() => {
    reconcileReminders().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (data && target) syncReminders(data, todayISO(), target).catch(() => undefined);
  }, [data, target]);

  useEffect(() => {
    if (house.data && target) syncHouseReminders(house.data, target).catch(() => undefined);
  }, [house.data, target]);

  useEffect(() => {
    const houses = JSON.parse(housesKey) as [string, string][];
    const activeId = target?.householdId;
    if (!activeId || !houses.length) return;
    const list = houses.map(([id, name]) => ({ id, name }));
    const run = () => syncOtherHouses(queryClient, list, activeId).catch(() => undefined);
    run();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => subscription.remove();
  }, [housesKey, target?.householdId, queryClient]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !target) return;
      refetch()
        .then((result) => (result.data ? syncReminders(result.data, todayISO(), target) : undefined))
        .catch(() => undefined);
      // Refaz com o resultado da busca, e não pelo efeito acima: dados iguais
      // mantêm o mesmo objeto, mas o dia pode ter mudado e a janela precisa andar.
      // Sem nenhum aviso da casa ligado, nem busca.
      anyHouseReminderKind()
        .then((on) => (on ? refetchHouse() : null))
        .then((fresh) => (fresh ? syncHouseReminders(fresh, target) : undefined))
        .catch(() => undefined);
    });
    return () => subscription.remove();
  }, [refetch, refetchHouse, target]);
}
