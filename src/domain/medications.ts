import { addDays } from './dates';

export interface MedicationSchedule {
  id: string;
  personName: string;
  name: string;
  dosage: string | null;
  times: string[];
  startOn: string;
  endOn: string | null;
  active: boolean;
}

export interface DoseSlot {
  medicationId: string;
  personName: string;
  name: string;
  dosage: string | null;
  date: string;
  time: string;
}

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function doseKey(medicationId: string, date: string, time: string): string {
  return `${medicationId}|${date}|${time}`;
}

/** Doses previstas para um dia, em ordem de horário. */
export function dosesForDay(medications: MedicationSchedule[], date: string): DoseSlot[] {
  const slots: DoseSlot[] = [];
  for (const m of medications) {
    if (!m.active || date < m.startOn || (m.endOn && date > m.endOn)) continue;
    for (const time of m.times) {
      slots.push({
        medicationId: m.id,
        personName: m.personName,
        name: m.name,
        dosage: m.dosage,
        date,
        time,
      });
    }
  }
  return slots.sort((a, b) => a.time.localeCompare(b.time) || a.personName.localeCompare(b.personName));
}

/** "8:00, 20:00" -> ["08:00", "20:00"]; null se algum horário for inválido. */
export function parseTimes(input: string): string[] | null {
  const parts = input
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (/^\d:\d{2}$/.test(p) ? `0${p}` : p))
    .map((p) => (/^\d{1,2}$/.test(p) ? `${p.padStart(2, '0')}:00` : p));
  if (!parts.length || !parts.every((p) => TIME_PATTERN.test(p))) return null;
  return [...new Set(parts)].sort();
}

export function currentTimeHHMM(now: Date = new Date()): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/** Janela, em dias, em que doses perto do início ou do fim viram lembretes avulsos. */
export const REMINDER_HORIZON_DAYS = 7;

export type ReminderPlan =
  | { kind: 'none' }
  | { kind: 'daily'; times: string[] }
  | { kind: 'dates'; slots: { date: string; time: string }[] };

/**
 * Como agendar os lembretes de um remédio neste aparelho. Repetição diária
 * só quando o tratamento já começou e não termina dentro da janela; perto do
 * início ou do fim, uma notificação por dose, só dentro do tratamento. O app
 * refaz o plano ao abrir, então a janela vai andando.
 */
export function planReminders(
  medication: Pick<MedicationSchedule, 'times' | 'startOn' | 'endOn' | 'active'>,
  today: string,
  nowTime: string,
  horizon = REMINDER_HORIZON_DAYS,
): ReminderPlan {
  const { startOn, endOn } = medication;
  if (!medication.active || (endOn && endOn < today)) return { kind: 'none' };
  const times = [...medication.times].sort();
  const windowEnd = addDays(today, horizon);
  if (startOn <= today && (!endOn || endOn > windowEnd)) return { kind: 'daily', times };

  const slots: { date: string; time: string }[] = [];
  const last = endOn && endOn < windowEnd ? endOn : windowEnd;
  for (let date = startOn > today ? startOn : today; date <= last; date = addDays(date, 1)) {
    for (const time of times) {
      if (date > today || time > nowTime) slots.push({ date, time });
    }
  }
  return slots.length ? { kind: 'dates', slots } : { kind: 'none' };
}
