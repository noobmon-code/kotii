// Cardápio da semana: semanas de segunda a domingo, almoço e jantar. O Nuke
// sugere a semana; a casa ajusta prato a prato.

import { addDays, formatShortDate } from './dates';

export type Meal = 'almoco' | 'jantar';

export const MEALS: { key: Meal; label: string }[] = [
  { key: 'almoco', label: 'Almoço' },
  { key: 'jantar', label: 'Jantar' },
];

export interface MenuItem {
  id: string;
  day: string;
  meal: Meal;
  dish: string;
}

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

/** Segunda-feira da semana do dia (domingo fecha a semana). */
export function weekStartOf(iso: string): string {
  const weekday = weekdayOf(iso);
  return addDays(iso, weekday === 0 ? -6 : 1 - weekday);
}

/** Semana para planejar: a de hoje; no domingo, a que começa amanhã. */
export function planningWeek(today: string): string {
  return weekdayOf(today) === 0 ? addDays(today, 1) : weekStartOf(today);
}

export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** "Segunda, 28/9" */
export function dayTitle(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${WEEKDAYS[weekdayOf(iso)]}, ${d}/${m}`;
}

/** "28 set – 4 out" */
export function weekLabel(start: string, referenceYear?: number): string {
  return `${formatShortDate(start, referenceYear)} – ${formatShortDate(addDays(start, 6), referenceYear)}`;
}

/** O que já está no cardápio, em linhas curtas para o Nuke ("Segunda, 28/9: almoço Lasanha; jantar Sopa"). */
export function menuLines(items: MenuItem[]): string[] {
  const byDay = new Map<string, MenuItem[]>();
  for (const item of items) byDay.set(item.day, [...(byDay.get(item.day) ?? []), item]);
  return [...byDay.keys()].sort().map((day) => {
    const meals = MEALS.flatMap(({ key, label }) => {
      const item = byDay.get(day)!.find((i) => i.meal === key);
      return item ? [`${label.toLowerCase()} ${item.dish}`] : [];
    });
    return `${dayTitle(day)}: ${meals.join('; ')}`;
  });
}

export interface MenuSuggestionDay {
  date: string;
  lunch: string | null;
  dinner: string | null;
}

/** Sugestão do Nuke → pratos a gravar: só os preenchidos, de hoje em diante. */
export function suggestionToItems(days: MenuSuggestionDay[], today: string): { day: string; meal: Meal; dish: string }[] {
  return days.filter((d) => d.date >= today).flatMap((d) => [
    ...(d.lunch?.trim() ? [{ day: d.date, meal: 'almoco' as const, dish: d.lunch.trim() }] : []),
    ...(d.dinner?.trim() ? [{ day: d.date, meal: 'jantar' as const, dish: d.dinner.trim() }] : []),
  ]);
}
