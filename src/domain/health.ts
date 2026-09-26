// Regras de saúde: idade, vacinas, consultas, treinos e dietas. Os planos de
// treino e dieta vêm de profissionais de fora e ficam como JSON no banco.

import { addDays, diffDays, formatShortDate, toISODate } from './dates';
import { normalizeSearch } from './search';

export interface Exercise {
  name: string;
  sets: string | null;
  reps: string | null;
  load: string | null;
  rest: string | null;
  notes: string | null;
}

export interface WorkoutSession {
  name: string;
  /** 0 = domingo ... 6 = sábado; vazio = sem dia fixo (segue a sequência). */
  weekdays: number[];
  exercises: Exercise[];
}

export interface DietItem {
  food: string;
  quantity: string | null;
  notes: string | null;
}

export interface DietOption {
  label: string | null;
  items: DietItem[];
}

export interface DietMeal {
  name: string;
  time: string | null;
  options: DietOption[];
}

export interface DietShoppingItem {
  name: string;
  category: string;
}

export type ResultFlag = 'alto' | 'baixo' | 'alterado';

export interface ExamResult {
  name: string;
  value: string;
  unit: string | null;
  reference: string | null;
  flag: ResultFlag | null;
}

/** O que a leitura com IA devolve de um pedido ou laudo de exame. */
export interface ExamReading {
  kind: 'pedido' | 'resultado';
  title: string | null;
  exam_date: string | null;
  lab: string | null;
  requested_by: string | null;
  requested_exams: string[];
  results: ExamResult[];
}

export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

/** Máximo de fotos por leitura (páginas de uma ficha, dieta ou laudo). */
export const MAX_HEALTH_PHOTOS = 6;

// ---------------------------------------------------------------------------
// Pessoas

/** "8 anos", "1 ano", "5 meses", "recém-nascido". */
export function ageLabel(birthDate: string, today: string): string | null {
  if (birthDate > today) return null;
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  let months = (ty - by) * 12 + (tm - bm);
  if (td < bd) months -= 1;
  if (months < 1) return 'recém-nascido';
  if (months < 12) return months === 1 ? '1 mês' : `${months} meses`;
  const years = Math.floor(months / 12);
  return years === 1 ? '1 ano' : `${years} anos`;
}

// ---------------------------------------------------------------------------
// Vacinas

export type VaccineStatus =
  | { kind: 'atrasada'; days: number }
  | { kind: 'em_breve'; days: number }
  | { kind: 'agendada'; days: number }
  | { kind: 'sem_proxima' };

/** "Em breve" = próxima dose nos próximos 30 dias. */
export function vaccineStatus(nextDoseOn: string | null, today: string): VaccineStatus {
  if (!nextDoseOn) return { kind: 'sem_proxima' };
  const days = diffDays(today, nextDoseOn);
  if (days < 0) return { kind: 'atrasada', days: -days };
  if (days <= 30) return { kind: 'em_breve', days };
  return { kind: 'agendada', days };
}

export function describeVaccineStatus(status: VaccineStatus): string {
  switch (status.kind) {
    case 'atrasada':
      return status.days === 1 ? 'Dose atrasada 1 dia' : `Dose atrasada ${status.days} dias`;
    case 'em_breve':
      return status.days === 0 ? 'Próxima dose hoje' : status.days === 1 ? 'Próxima dose amanhã' : `Próxima dose em ${status.days} dias`;
    case 'agendada':
      return 'Próxima dose agendada';
    case 'sem_proxima':
      return 'Aplicada';
  }
}

export interface VaccineLike {
  person_id: string;
  name: string;
  applied_on: string | null;
  next_dose_on: string | null;
}

/**
 * Próximas doses que pedem atenção (atrasadas ou nos próximos 30 dias), da
 * mais urgente para a menos. Ignora a próxima dose de um registro quando uma
 * aplicação posterior da mesma vacina, para a mesma pessoa, já foi registrada.
 */
export function dueVaccines<T extends VaccineLike>(vaccines: T[], today: string): { vaccine: T; status: VaccineStatus }[] {
  const key = (v: VaccineLike) => `${v.person_id}|${normalizeSearch(v.name)}`;
  const lastApplied = new Map<string, string>();
  for (const v of vaccines) {
    if (!v.applied_on) continue;
    const current = lastApplied.get(key(v));
    if (!current || v.applied_on > current) lastApplied.set(key(v), v.applied_on);
  }
  return vaccines
    .filter((v) => {
      if (!v.next_dose_on) return false;
      const last = lastApplied.get(key(v));
      if (!last) return true;
      return v.applied_on ? last <= v.applied_on : last < addDays(v.next_dose_on, -30);
    })
    .map((vaccine) => ({ vaccine, status: vaccineStatus(vaccine.next_dose_on, today) }))
    .filter(({ status }) => status.kind === 'atrasada' || status.kind === 'em_breve')
    .sort((a, b) => a.vaccine.next_dose_on!.localeCompare(b.vaccine.next_dose_on!));
}

// ---------------------------------------------------------------------------
// Consultas (data e hora locais do aparelho)

/** "2026-10-05" + "14:30" (hora local) -> timestamp ISO. */
export function toTimestamp(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

/** Timestamp -> data e hora locais. */
export function splitTimestamp(timestamp: string): { date: string; time: string } {
  const at = new Date(timestamp);
  return {
    date: toISODate(at),
    time: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`,
  };
}

/** "Hoje · 14:30", "Amanhã · 09:00", "Seg, 5 out · 14:30". */
export function describeWhen(timestamp: string, today: string): string {
  const { date, time } = splitTimestamp(timestamp);
  const days = diffDays(today, date);
  const day =
    days === 0
      ? 'Hoje'
      : days === 1
        ? 'Amanhã'
        : days === -1
          ? 'Ontem'
          : `${WEEKDAYS_SHORT[weekdayOf(date)]}, ${formatShortDate(date, Number(today.slice(0, 4)))}`;
  return `${day} · ${time}`;
}

export interface AppointmentLike {
  starts_at: string;
  status: 'agendada' | 'realizada' | 'cancelada';
}

/** Agendadas de hoje em diante, da mais próxima para a mais distante. */
export function upcomingAppointments<T extends AppointmentLike>(appointments: T[], today: string): T[] {
  return appointments
    .filter((a) => a.status === 'agendada' && splitTimestamp(a.starts_at).date >= today)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

/** Consulta agendada cuja data já passou: perguntar se foi realizada. */
export function isOverdueAppointment(appointment: AppointmentLike, today: string): boolean {
  return appointment.status === 'agendada' && splitTimestamp(appointment.starts_at).date < today;
}

// ---------------------------------------------------------------------------
// Treino

export const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function describeWeekdays(weekdays: number[]): string {
  if (weekdays.length === 7) return 'Todo dia';
  return [...weekdays].sort((a, b) => a - b).map((d) => WEEKDAYS_SHORT[d]).join(', ');
}

/** "4 × 10-12 · 20 kg · desc. 60s" */
export function describeExercise(exercise: Exercise): string {
  const volume =
    exercise.sets && exercise.reps
      ? `${exercise.sets} × ${exercise.reps}`
      : exercise.sets
        ? `${exercise.sets} séries`
        : exercise.reps ?? null;
  return [volume, exercise.load, exercise.rest ? `desc. ${exercise.rest}` : null].filter(Boolean).join(' · ');
}

export interface WorkoutLogLike {
  session_name: string;
  done_on: string;
  created_at: string;
}

/** Dias de histórico de treino que o app carrega (Hoje e ficha usam o mesmo). */
export const WORKOUT_HISTORY_DAYS = 90;

/**
 * Sessões de hoje. Com dias da semana na ficha, as do dia (nenhuma = descanso);
 * sem dias, a sequência A, B, C...: a que vem depois da última feita (ou a
 * feita hoje, para continuar aparecendo como concluída). Depois de uma pausa
 * maior que WORKOUT_HISTORY_DAYS, a sequência recomeça do primeiro treino.
 */
export function sessionsForToday(sessions: WorkoutSession[], logs: WorkoutLogLike[], today: string): WorkoutSession[] {
  if (!sessions.length) return [];
  if (sessions.some((s) => s.weekdays.length)) {
    const weekday = weekdayOf(today);
    return sessions.filter((s) => s.weekdays.includes(weekday));
  }
  const since = addDays(today, -WORKOUT_HISTORY_DAYS);
  const known = logs
    .filter((l) => l.done_on >= since && sessions.some((s) => s.name === l.session_name))
    .sort((a, b) => b.done_on.localeCompare(a.done_on) || b.created_at.localeCompare(a.created_at));
  const doneToday = known.filter((l) => l.done_on === today);
  if (doneToday.length) return sessions.filter((s) => doneToday.some((l) => l.session_name === s.name));
  const last = known[0];
  if (!last) return [sessions[0]];
  const index = sessions.findIndex((s) => s.name === last.session_name);
  return [sessions[(index + 1) % sessions.length]];
}

export function emptyExercise(): Exercise {
  return { name: '', sets: null, reps: null, load: null, rest: null, notes: null };
}

/** Próximo nome livre na sequência "Treino A", "Treino B"... */
export function nextSessionName(sessions: WorkoutSession[]): string {
  for (let i = 0; i < 26; i++) {
    const name = `Treino ${String.fromCharCode(65 + i)}`;
    if (!sessions.some((s) => normalizeSearch(s.name) === normalizeSearch(name))) return name;
  }
  return `Treino ${sessions.length + 1}`;
}

/** O que impede ativar o plano, ou null. */
export function workoutProblem(sessions: WorkoutSession[]): string | null {
  if (!sessions.some((s) => s.exercises.length)) return 'Adicione pelo menos um exercício.';
  const names = sessions.map((s) => normalizeSearch(s.name));
  if (names.some((n) => !n)) return 'Dê um nome a cada treino.';
  if (new Set(names).size !== names.length) return 'Cada treino precisa de um nome diferente.';
  return null;
}

// ---------------------------------------------------------------------------
// Dieta

export function dietProblem(meals: DietMeal[]): string | null {
  if (!meals.some((m) => m.options.some((o) => o.items.length))) return 'Adicione pelo menos um alimento.';
  if (meals.some((m) => !m.name.trim())) return 'Dê um nome a cada refeição.';
  return null;
}

/** Compras da dieta marcando o que já está pendente na lista escolhida. */
export function dietShoppingSelection(
  items: DietShoppingItem[],
  pendingNames: string[],
): (DietShoppingItem & { inList: boolean })[] {
  const pending = new Set(pendingNames.map(normalizeSearch));
  return items.map((item) => ({ ...item, inList: pending.has(normalizeSearch(item.name)) }));
}

// ---------------------------------------------------------------------------
// Exames

export const RESULT_FLAGS: { value: ResultFlag; label: string }[] = [
  { value: 'alto', label: 'Acima' },
  { value: 'baixo', label: 'Abaixo' },
  { value: 'alterado', label: 'Alterado' },
];

export function flagLabel(flag: ResultFlag | null): string | null {
  return RESULT_FLAGS.find((f) => f.value === flag)?.label ?? null;
}

export const EXAM_STATUS: { value: 'pedido' | 'agendado' | 'realizado'; label: string }[] = [
  { value: 'pedido', label: 'Pedido' },
  { value: 'agendado', label: 'Agendado' },
  { value: 'realizado', label: 'Realizado' },
];
