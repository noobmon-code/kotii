import { addDays, diffDays, formatBRDate } from './dates';

/** Com que regularidade se toma: todo dia, em dias da semana, a cada X dias ou uma vez por mês. */
export type MedicationFrequency = 'daily' | 'weekdays' | 'interval' | 'monthly';

export const FREQUENCIES: { key: MedicationFrequency; label: string }[] = [
  { key: 'daily', label: 'Todo dia' },
  { key: 'weekdays', label: 'Dias da semana' },
  { key: 'interval', label: 'A cada X dias' },
  { key: 'monthly', label: 'Uma vez por mês' },
];

/** Dias da semana como em Date.getDay(): 0 = domingo. */
export const WEEKDAYS = [
  { day: 0, short: 'Dom', every: 'todo domingo' },
  { day: 1, short: 'Seg', every: 'toda segunda' },
  { day: 2, short: 'Ter', every: 'toda terça' },
  { day: 3, short: 'Qua', every: 'toda quarta' },
  { day: 4, short: 'Qui', every: 'toda quinta' },
  { day: 5, short: 'Sex', every: 'toda sexta' },
  { day: 6, short: 'Sáb', every: 'todo sábado' },
];

export interface MedicationSchedule {
  id: string;
  personName: string;
  name: string;
  dosage: string | null;
  times: string[];
  startOn: string;
  endOn: string | null;
  active: boolean;
  /** Padrão: todo dia. */
  frequency?: MedicationFrequency;
  /** Em 'weekdays': os dias (0 = domingo). */
  weekdays?: number[] | null;
  /** Em 'interval': a cada quantos dias, contando do início. */
  intervalDays?: number | null;
  /** Tratamento por número de doses: acaba quando todas forem tomadas. */
  totalDoses?: number | null;
  /** Doses já tomadas (só importa com totalDoses). */
  takenCount?: number;
}

type Rule = Pick<MedicationSchedule, 'startOn' | 'endOn' | 'active' | 'frequency' | 'weekdays' | 'intervalDays'>;

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

const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

function daysInMonth(iso: string): number {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Dia do mês em que um remédio mensal cai naquele mês: o do início, ou o último se o mês for mais curto. */
function monthlyDay(startOn: string, date: string): number {
  return Math.min(Number(startOn.slice(8, 10)), daysInMonth(date));
}

/** Se o remédio tem dose nesse dia (período do tratamento e regularidade). */
export function takesOn(m: Rule, date: string): boolean {
  if (!m.active || date < m.startOn || (m.endOn && date > m.endOn)) return false;
  switch (m.frequency ?? 'daily') {
    case 'weekdays':
      return (m.weekdays ?? []).includes(weekdayOf(date));
    case 'interval':
      return diffDays(m.startOn, date) % Math.max(1, m.intervalDays ?? 1) === 0;
    case 'monthly':
      return Number(date.slice(8, 10)) === monthlyDay(m.startOn, date);
    default:
      return true;
  }
}

/** Doses que ainda faltam num tratamento por número de doses (null: sem limite). */
export function dosesLeft(m: Pick<MedicationSchedule, 'totalDoses' | 'takenCount'>): number | null {
  return m.totalDoses ? Math.max(0, m.totalDoses - (m.takenCount ?? 0)) : null;
}

/**
 * Doses previstas para um dia, em ordem de horário. Num tratamento por número
 * de doses, `taken` (doseKey das tomadas no dia) separa o que já conta: as
 * tomadas ficam, e das outras só entram as que ainda faltam. Feito para o dia
 * de hoje (é o que a contagem de tomadas descreve).
 */
export function dosesForDay(medications: MedicationSchedule[], date: string, taken?: ReadonlySet<string>): DoseSlot[] {
  const slots: DoseSlot[] = [];
  for (const m of medications) {
    if (!takesOn(m, date)) continue;
    let left = dosesLeft(m);
    for (const time of [...m.times].sort()) {
      const isTaken = taken?.has(doseKey(m.id, date, time)) ?? false;
      if (left !== null && !isTaken) {
        if (left === 0) continue;
        left -= 1;
      }
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

/**
 * Horários para "N vezes por dia": de 24/N em 24/N horas a partir do primeiro
 * (3 vezes a partir das 08:00 -> 00:00, 08:00, 16:00).
 */
export function spacedTimes(timesPerDay: number, first = '08:00'): string[] {
  const [h, m] = first.split(':').map(Number);
  const start = h * 60 + m;
  const step = Math.round((24 * 60) / timesPerDay);
  const times = Array.from({ length: timesPerDay }, (_, i) => {
    const minutes = (start + i * step) % (24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  });
  return [...new Set(times)].sort();
}

/** Último dia de um tratamento de N dias a partir do início. */
export function endAfterDays(startOn: string, days: number): string {
  return addDays(startOn, Math.max(1, days) - 1);
}

/** "todo dia", "seg, qua e sex", "a cada 2 dias", "todo dia 5 do mês". */
export function describeFrequency(m: Pick<MedicationSchedule, 'frequency' | 'weekdays' | 'intervalDays' | 'startOn'>): string {
  switch (m.frequency ?? 'daily') {
    case 'weekdays': {
      const days = [...(m.weekdays ?? [])].sort((a, b) => a - b);
      if (days.length === 7) return 'todo dia';
      if (days.length === 1) return WEEKDAYS[days[0]].every;
      const names = days.map((d) => WEEKDAYS[d].short.toLowerCase());
      return `${names.slice(0, -1).join(', ')} e ${names.at(-1)}`;
    }
    case 'interval':
      return m.intervalDays === 2 ? 'dia sim, dia não' : `a cada ${m.intervalDays} dias`;
    case 'monthly':
      return `todo dia ${Number(m.startOn.slice(8, 10))} do mês`;
    default:
      return 'todo dia';
  }
}

/** "uso contínuo", "até 04/10/2026", "4 de 10 doses". */
export function describeCourse(m: Pick<MedicationSchedule, 'endOn' | 'totalDoses' | 'takenCount'>): string {
  if (m.totalDoses) return `${Math.min(m.takenCount ?? 0, m.totalDoses)} de ${m.totalDoses} doses`;
  return m.endOn ? `até ${formatBRDate(m.endOn)}` : 'uso contínuo';
}

export function currentTimeHHMM(now: Date = new Date()): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/** Janela, em dias, em que doses perto do início ou do fim viram lembretes avulsos. */
export const REMINDER_HORIZON_DAYS = 7;
/**
 * A cada X dias e mensal não têm repetição pronta no celular: viram lembretes
 * avulsos até este tanto de dias à frente, no máximo MAX_DATE_REMINDERS por
 * remédio (o iPhone guarda só 64 no total). O app refaz ao abrir.
 */
export const SPARSE_REMINDER_HORIZON_DAYS = 62;
export const MAX_DATE_REMINDERS = 12;

export type ReminderPlan =
  | { kind: 'none' }
  | { kind: 'daily'; times: string[] }
  | { kind: 'weekly'; weekdays: number[]; times: string[] }
  | { kind: 'dates'; slots: { date: string; time: string }[] };

type PlanInput = Pick<MedicationSchedule, 'times' | 'startOn' | 'endOn' | 'active'> &
  Pick<MedicationSchedule, 'frequency' | 'weekdays' | 'intervalDays' | 'totalDoses' | 'takenCount'>;

/**
 * Como agendar os lembretes de um remédio neste aparelho. Repetição (diária
 * ou semanal) só quando o tratamento já começou, não termina dentro da janela
 * e não é por número de doses; fora isso, uma notificação por dose, só dentro
 * do tratamento e só as doses que faltam. O app refaz o plano ao abrir, então
 * a janela vai andando.
 */
export function planReminders(medication: PlanInput, today: string, nowTime: string, horizon = REMINDER_HORIZON_DAYS): ReminderPlan {
  const { startOn, endOn } = medication;
  const left = dosesLeft(medication);
  if (!medication.active || (endOn && endOn < today) || left === 0) return { kind: 'none' };
  const times = [...medication.times].sort();
  const frequency = medication.frequency ?? 'daily';
  const weekdays = [...new Set(medication.weekdays ?? [])].sort((a, b) => a - b);
  const repeats = frequency === 'daily' || (frequency === 'weekdays' && weekdays.length === 7);
  const sparse = frequency === 'interval' || frequency === 'monthly';
  const windowEnd = addDays(today, sparse ? SPARSE_REMINDER_HORIZON_DAYS : horizon);

  if (left === null && startOn <= today && (!endOn || endOn > windowEnd)) {
    if (repeats) return { kind: 'daily', times };
    if (frequency === 'weekdays' && weekdays.length) return { kind: 'weekly', weekdays, times };
  }

  const slots: { date: string; time: string }[] = [];
  const last = endOn && endOn < windowEnd ? endOn : windowEnd;
  const max = Math.min(left ?? Infinity, sparse ? MAX_DATE_REMINDERS : Infinity);
  for (let date = startOn > today ? startOn : today; date <= last && slots.length < max; date = addDays(date, 1)) {
    if (!takesOn(medication, date)) continue;
    for (const time of times) {
      if ((date > today || time > nowTime) && slots.length < max) slots.push({ date, time });
    }
  }
  return slots.length ? { kind: 'dates', slots } : { kind: 'none' };
}
