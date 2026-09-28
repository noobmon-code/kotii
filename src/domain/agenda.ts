// Agenda da casa: consultas, vacinas, contas, tarefas, manutenções,
// documentos e garantias num calendário só. Contas e tarefas que se repetem
// aparecem também nas próximas datas, como previsão: a data certa sai quando
// a conta é paga ou a tarefa é feita.

import { addDays, diffDays } from './dates';
import { pendingNextDoses, splitTimestamp, type VaccineLike } from './health';

export type AgendaKind = 'consulta' | 'vacina' | 'conta' | 'tarefa' | 'manutencao' | 'documento' | 'garantia';

export interface AgendaEvent {
  key: string;
  kind: AgendaKind;
  /** O item de origem (consulta, conta…), para abrir a tela dele. */
  id: string;
  date: string;
  /** Só consultas têm hora. */
  time: string | null;
  title: string;
  detail: string | null;
  /** Repetição prevista, e não a data já marcada. */
  planned: boolean;
}

export interface AgendaInput {
  /** Intervalo mostrado (inclusive). */
  from: string;
  to: string;
  today: string;
  appointments: { id: string; title: string; starts_at: string; status: string; person: string | null }[];
  vaccines: (VaccineLike & { id: string; dose: string | null; person: string | null })[];
  bills: {
    id: string;
    name: string;
    recurrence: 'monthly' | 'yearly' | 'once';
    due_day: number | null;
    next_due_on: string;
    active: boolean;
  }[];
  chores: {
    id: string;
    title: string;
    due_on: string;
    recurrence: 'none' | 'daily' | 'weekly' | 'monthly';
    interval_count: number;
    active: boolean;
    equipment_id: string | null;
  }[];
  documents: { id: string; title: string; expires_on: string | null }[];
  equipment: { id: string; name: string; warranty_until: string | null }[];
}

/** Soma meses mantendo o dia (31 vira o último dia nos meses curtos), como o banco faz com as contas. */
export function addMonthsClamped(date: string, months: number, day = Number(date.slice(8, 10))): string {
  const [y, m] = date.split('-').map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));

/**
 * Repetições de `base` (a 1ª é base + 1 passo) que caem até `to`, a partir
 * das que chegam perto de `from`: um mês distante não depende de contar
 * todas as anteriores.
 */
function repeats(base: string, from: string, to: string, step: { days: number } | { months: number; day?: number }): string[] {
  const at = (i: number) => ('days' in step ? addDays(base, step.days * i) : addMonthsClamped(base, step.months * i, step.day));
  const behind = 'days' in step ? diffDays(base, from) / step.days : (monthIndex(from) - monthIndex(base)) / step.months;
  const dates: string[] = [];
  for (let i = Math.max(1, Math.floor(behind)); dates.length < 62; i++) {
    const date = at(i);
    if (date > to) break;
    if (date >= from) dates.push(date);
  }
  return dates;
}

export function buildAgenda(input: AgendaInput): AgendaEvent[] {
  const { from, to, today } = input;
  const events: AgendaEvent[] = [];
  const inRange = (date: string) => date >= from && date <= to;
  const push = (event: Omit<AgendaEvent, 'key'>) => {
    if (inRange(event.date)) events.push({ ...event, key: `${event.kind}:${event.id}:${event.date}` });
  };

  for (const a of input.appointments) {
    if (a.status === 'cancelada') continue;
    const { date, time } = splitTimestamp(a.starts_at);
    push({ kind: 'consulta', id: a.id, date, time, title: a.title, detail: a.person, planned: false });
  }

  // Dose já tomada (há uma aplicação depois) sai da agenda.
  for (const v of pendingNextDoses(input.vaccines)) {
    if (!v.next_dose_on) continue;
    const detail = [v.person, v.dose].filter(Boolean).join(' · ') || null;
    push({ kind: 'vacina', id: v.id, date: v.next_dose_on, time: null, title: `Vacina: ${v.name}`, detail, planned: false });
  }

  for (const b of input.bills) {
    if (!b.active) continue;
    push({ kind: 'conta', id: b.id, date: b.next_due_on, time: null, title: b.name, detail: 'Vence', planned: false });
    if (b.recurrence === 'once') continue;
    // Pagar passa para o próximo vencimento: as seguintes seguem a atual, mesmo atrasada.
    const step = { months: b.recurrence === 'yearly' ? 12 : 1, day: b.due_day ?? Number(b.next_due_on.slice(8, 10)) };
    for (const date of repeats(b.next_due_on, from, to, step)) {
      push({ kind: 'conta', id: b.id, date, time: null, title: b.name, detail: 'Vence (previsão)', planned: true });
    }
  }

  for (const c of input.chores) {
    if (!c.active) continue;
    const kind = c.equipment_id ? 'manutencao' : 'tarefa';
    push({ kind, id: c.id, date: c.due_on, time: null, title: c.title, detail: null, planned: false });
    // Diárias encheriam todos os dias: só a próxima aparece.
    if (c.recurrence === 'none' || c.recurrence === 'daily') continue;
    // A próxima data conta de quando a tarefa é feita: atrasada, no mínimo hoje.
    const base = c.due_on < today ? today : c.due_on;
    const step = c.recurrence === 'weekly' ? { days: 7 * c.interval_count } : { months: c.interval_count };
    for (const date of repeats(base, from, to, step)) {
      push({ kind, id: c.id, date, time: null, title: c.title, detail: 'Previsão', planned: true });
    }
  }

  for (const d of input.documents) {
    if (d.expires_on) {
      push({ kind: 'documento', id: d.id, date: d.expires_on, time: null, title: d.title, detail: 'Vence', planned: false });
    }
  }

  for (const e of input.equipment) {
    if (e.warranty_until) {
      push({ kind: 'garantia', id: e.id, date: e.warranty_until, time: null, title: e.name, detail: 'Fim da garantia', planned: false });
    }
  }

  // Dia inteiro antes das horas marcadas; dentro disso, pelo título.
  return events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.time ?? '').localeCompare(b.time ?? '') ||
      a.title.localeCompare(b.title, 'pt-BR'),
  );
}

/**
 * Semanas do mês (domingo a sábado), com os dias dos meses vizinhos para
 * completar a primeira e a última semana. `month`: "AAAA-MM".
 */
export function monthGrid(month: string): { date: string; inMonth: boolean }[][] {
  const first = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const startWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const start = addDays(first, -startWeekday);
  const weeks = Math.ceil((startWeekday + daysInMonth) / 7);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = addDays(start, w * 7 + d);
      return { date, inMonth: date.slice(0, 7) === month };
    }),
  );
}
