import { diffDays } from './dates';

export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';

export const RECURRENCE_OPTIONS: { value: Recurrence; label: string }[] = [
  { value: 'none', label: 'Uma vez' },
  { value: 'daily', label: 'Diária' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'monthly', label: 'Mensal' },
];

export function describeRecurrence(recurrence: Recurrence, interval: number): string {
  if (recurrence === 'none') return 'Uma vez';
  const unit = { daily: ['dia', 'dias'], weekly: ['semana', 'semanas'], monthly: ['mês', 'meses'] }[recurrence];
  return interval === 1
    ? { daily: 'Todo dia', weekly: 'Toda semana', monthly: 'Todo mês' }[recurrence]
    : `A cada ${interval} ${unit[1]}`;
}

export type ChoreStatus =
  | { kind: 'atrasada'; days: number }
  | { kind: 'hoje' }
  | { kind: 'proxima'; days: number };

export function choreStatus(dueOn: string, today: string): ChoreStatus {
  const days = diffDays(today, dueOn);
  if (days < 0) return { kind: 'atrasada', days: -days };
  if (days === 0) return { kind: 'hoje' };
  return { kind: 'proxima', days };
}

export function describeChoreStatus(status: ChoreStatus): string {
  switch (status.kind) {
    case 'atrasada':
      return status.days === 1 ? 'Atrasada 1 dia' : `Atrasada ${status.days} dias`;
    case 'hoje':
      return 'Hoje';
    case 'proxima':
      return status.days === 1 ? 'Amanhã' : `Em ${status.days} dias`;
  }
}

/** Quem faz a tarefa: o morador, ou a criança com os pontos ("Lia · 10 pontos"). */
export function choreAssigneeLabel(
  chore: { assigned_to: string | null; kid_id: string | null; points: number },
  members: { user_id: string; display_name: string }[],
  people: { id: string; name: string }[],
): string | null {
  if (chore.kid_id) {
    const kid = people.find((p) => p.id === chore.kid_id)?.name;
    if (kid) return chore.points > 0 ? `${kid} · ${chore.points} ${chore.points === 1 ? 'ponto' : 'pontos'}` : kid;
  }
  return members.find((m) => m.user_id === chore.assigned_to)?.display_name ?? null;
}
