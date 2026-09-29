import { useMemo } from 'react';

import { useChores } from '@/data/home';
import { usePeople } from '@/data/health';
import { useEquipmentList } from '@/data/house';
import { useForecast, useHouseholdLocation } from '@/data/weather';
import { weatherContext, weatherTips } from '@/domain/weather';

/**
 * O clima da casa: onde ela fica, a previsão e as dicas de um dia. Enquanto
 * fichas, tarefas e aparelhos carregam, as dicas saem sem eles (sem pets,
 * rega ou carro).
 */
export function useHouseWeather(today: string) {
  const location = useHouseholdLocation();
  const forecast = useForecast(location.data);
  const people = usePeople();
  const chores = useChores();
  const equipment = useEquipmentList();
  const context = useMemo(
    () => weatherContext(people.data ?? [], chores.data ?? [], equipment.data ?? [], today),
    [people.data, chores.data, equipment.data, today],
  );
  const tipsFor = (day: { date: string; fromHour: number; dayWord: string }) =>
    forecast.data ? weatherTips(forecast.data, { ...day, context }) : [];
  return { location, forecast, tipsFor };
}
