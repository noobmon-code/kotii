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

/**
 * A busca da tarefa não achou a linha (PGRST116, a resposta da API ao
 * `.single()` sem linhas): ela foi apagada em outro aparelho. Diferente da
 * busca que só falhou (sem internet), aqui não há mais o que mostrar.
 */
export const CHORE_GONE = 'Esta tarefa foi apagada em outro aparelho.';

export function isChoreGone(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return 'code' in error && error.code === 'PGRST116';
}

/**
 * O salvar respondeu que a tarefa não existe mais nesta casa (save_chore:
 * P0002, "chore not found")? Foi apagada em outro aparelho, ou a pessoa saiu
 * da casa: nada foi salvo, e o aviso é o mesmo da busca (CHORE_GONE). A
 * mensagem também conta: com o mesmo código o banco diz que alguém da ordem
 * não está mais na casa, e aí a tarefa existe.
 */
export function isChoreGoneOnSave(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return 'code' in error && error.code === 'P0002' && 'message' in error && error.message === 'chore not found';
}

/**
 * O mesmo erro, para a gravação direto na tabela (o banco que ainda não tem
 * save_chore): a que não acha a linha não é erro para a API, responde que
 * gravou em nenhuma, e o formulário fecharia como se tivesse salvado.
 */
export function choreGoneOnSave(): Error {
  return Object.assign(new Error('chore not found'), { code: 'P0002' });
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
