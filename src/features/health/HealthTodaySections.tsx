import { router } from 'expo-router';

import { useToggleWorkoutLog } from '@/data/health';
import { addDays, formatShortDate } from '@/domain/dates';
import { describeVaccineStatus, describeWhen, splitTimestamp } from '@/domain/health';
import { errorMessage } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';
import { Badge, CheckCircle, IconBadge, ListCard, ListRow, Section } from '@/ui/primitives';
import type { useHealthOverview } from './useHealthOverview';

type Overview = ReturnType<typeof useHealthOverview>;

/**
 * Treinos de hoje, consultas, vacinas e rascunhos para revisar. `compact`
 * (tela Hoje) mostra só o que é de hoje/amanhã ou está atrasado.
 */
export function HealthTodaySections({ overview, today, compact }: { overview: Overview; today: string; compact?: boolean }) {
  const toggle = useToggleWorkoutLog();
  const onError = (err: unknown) => notify('Erro', errorMessage(err));
  const tomorrow = addDays(today, 1);

  const workouts = compact ? overview.workoutsToday.filter((w) => !w.done) : overview.workoutsToday;
  const upcoming = compact
    ? overview.upcoming.filter((a) => splitTimestamp(a.starts_at).date <= tomorrow)
    : overview.upcoming.slice(0, 5);
  const vaccines = compact ? overview.vaccinesDue.filter((v) => v.status.kind === 'atrasada') : overview.vaccinesDue;

  return (
    <>
      {workouts.length ? (
        <Section title="Treino de hoje">
          <ListCard>
            {workouts.map(({ plan, session, done }) => (
              <ListRow
                key={`${plan.id}-${session.name}`}
                left={<IconBadge icon="dumbbell" tone={done ? 'primary' : 'info'} />}
                title={session.name}
                subtitle={[
                  overview.personName(plan.person_id),
                  `${session.exercises.length} ${session.exercises.length === 1 ? 'exercício' : 'exercícios'}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                dimmed={done}
                onPress={() => router.push({ pathname: '/treino/[id]', params: { id: plan.id } })}
                right={
                  <CheckCircle
                    checked={done}
                    label={`${session.name} feito hoje`}
                    onPress={() =>
                      toggle.mutate({ planId: plan.id, sessionName: session.name, date: today, done: !done }, { onError })
                    }
                  />
                }
              />
            ))}
          </ListCard>
        </Section>
      ) : null}

      {upcoming.length || overview.toConfirm.length ? (
        <Section title="Consultas">
          <ListCard>
            {upcoming.map((a) => (
              <ListRow
                key={a.id}
                left={<IconBadge icon="stethoscope" tone="info" />}
                title={a.title}
                subtitle={[describeWhen(a.starts_at, today), overview.personName(a.person_id), a.professional]
                  .filter(Boolean)
                  .join(' · ')}
                onPress={() => router.push({ pathname: '/consulta/[id]', params: { id: a.id } })}
              />
            ))}
            {overview.toConfirm.map((a) => (
              <ListRow
                key={a.id}
                left={<IconBadge icon="stethoscope" tone="warning" />}
                title={a.title}
                subtitle={[describeWhen(a.starts_at, today), overview.personName(a.person_id)].filter(Boolean).join(' · ')}
                right={<Badge label="Foi realizada?" tone="warning" />}
                onPress={() => router.push({ pathname: '/consulta/[id]', params: { id: a.id } })}
              />
            ))}
          </ListCard>
        </Section>
      ) : null}

      {vaccines.length ? (
        <Section title="Vacinas">
          <ListCard>
            {vaccines.map(({ vaccine, status }) => (
              <ListRow
                key={vaccine.id}
                left={<IconBadge icon="needle" tone={status.kind === 'atrasada' ? 'danger' : 'warning'} />}
                title={[vaccine.name, vaccine.dose].filter(Boolean).join(' · ')}
                subtitle={[
                  overview.personName(vaccine.person_id),
                  describeVaccineStatus(status),
                  vaccine.next_dose_on ? formatShortDate(vaccine.next_dose_on) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                onPress={() => router.push({ pathname: '/vacina/[id]', params: { id: vaccine.id } })}
              />
            ))}
          </ListCard>
        </Section>
      ) : null}

      {overview.drafts.length ? (
        <Section title="Para revisar">
          <ListCard>
            {overview.drafts.map(({ kind, plan }) => (
              <ListRow
                key={plan.id}
                left={<IconBadge icon={kind === 'workout' ? 'dumbbell' : 'food-apple-outline'} tone="info" />}
                title={plan.title}
                subtitle={[overview.personName(plan.person_id), 'Confira o que a IA leu e ative'].filter(Boolean).join(' · ')}
                right={<Badge label="Revisar" tone="info" />}
                onPress={() =>
                  router.push({ pathname: kind === 'workout' ? '/treino/[id]' : '/dieta/[id]', params: { id: plan.id } })
                }
              />
            ))}
          </ListCard>
        </Section>
      ) : null}
    </>
  );
}

/** Há algo de saúde para mostrar na tela Hoje? */
export function hasHealthToday(overview: Overview, today: string): boolean {
  const tomorrow = addDays(today, 1);
  return (
    overview.workoutsToday.some((w) => !w.done) ||
    overview.upcoming.some((a) => splitTimestamp(a.starts_at).date <= tomorrow) ||
    overview.toConfirm.length > 0 ||
    overview.vaccinesDue.some((v) => v.status.kind === 'atrasada') ||
    overview.drafts.length > 0
  );
}
