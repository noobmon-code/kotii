// Pontos das crianças: tarefas feitas (com os pontos combinados) menos o que
// foi trocado por prêmios. As crianças são as fichas sem conta no app.

import { addDays, toISODate } from './dates';

export interface PointsEvent {
  id: string;
  title: string;
  /** Positivo quando ganhou (tarefa), negativo quando trocou por prêmio. */
  points: number;
  at: string;
}

/** Quem pode ganhar pontos: pessoas da casa sem conta no app (não os pets). */
export function kidsOf<T extends { kind: string; member_user_id: string | null }>(people: T[]): T[] {
  return people.filter((p) => p.kind === 'pessoa' && !p.member_user_id);
}

export function pointsHistory(
  completions: { id: string; points: number; completed_at: string; title: string }[],
  redemptions: { id: string; points: number; created_at: string; title: string }[],
): PointsEvent[] {
  return [
    ...completions.filter((c) => c.points > 0).map((c) => ({ id: c.id, title: c.title, points: c.points, at: c.completed_at })),
    ...redemptions.map((r) => ({ id: r.id, title: r.title, points: -r.points, at: r.created_at })),
  ].sort((a, b) => b.at.localeCompare(a.at));
}

/** Pontos ganhos nos últimos 7 dias (hoje incluído). */
export function earnedThisWeek(events: PointsEvent[], today: string): number {
  const since = addDays(today, -6);
  return events.filter((e) => e.points > 0 && toISODate(new Date(e.at)) >= since).reduce((sum, e) => sum + e.points, 0);
}
