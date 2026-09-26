import {
  useAppointments,
  useDietPlans,
  usePeople,
  useVaccines,
  useWorkoutLogs,
  useWorkoutPlans,
} from '@/data/health';
import { addDays } from '@/domain/dates';
import {
  dueVaccines,
  isOverdueAppointment,
  sessionsForToday,
  upcomingAppointments,
  WORKOUT_HISTORY_DAYS,
} from '@/domain/health';

/** O que a saúde da casa pede hoje: consultas, vacinas, treinos e rascunhos. */
export function useHealthOverview(today: string) {
  const people = usePeople();
  const appointments = useAppointments();
  const vaccines = useVaccines();
  const plans = useWorkoutPlans();
  const logs = useWorkoutLogs(addDays(today, -WORKOUT_HISTORY_DAYS));
  const diets = useDietPlans();
  const queries = [people, appointments, vaccines, plans, logs, diets];

  const allLogs = logs.data ?? [];
  const workoutsToday = (plans.data ?? [])
    .filter((plan) => plan.status === 'active')
    .flatMap((plan) => {
      const planLogs = allLogs.filter((l) => l.plan_id === plan.id);
      return sessionsForToday(plan.sessions, planLogs, today).map((session) => ({
        plan,
        session,
        done: planLogs.some((l) => l.session_name === session.name && l.done_on === today),
      }));
    });

  return {
    queries,
    loaded: queries.every((q) => q.isSuccess),
    people: people.data ?? [],
    personName: (id: string) => people.data?.find((p) => p.id === id)?.name ?? '',
    upcoming: upcomingAppointments(appointments.data ?? [], today),
    toConfirm: (appointments.data ?? []).filter((a) => isOverdueAppointment(a, today)),
    vaccinesDue: dueVaccines(vaccines.data ?? [], today),
    workoutsToday,
    drafts: [
      ...(plans.data ?? []).filter((p) => p.status === 'draft').map((plan) => ({ kind: 'workout' as const, plan })),
      ...(diets.data ?? []).filter((p) => p.status === 'draft').map((plan) => ({ kind: 'diet' as const, plan })),
    ],
  };
}
