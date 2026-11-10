import { router } from 'expo-router';
import type { ReactElement } from 'react';

import { useToggleWorkoutLog } from '@/data/health';
import { formatShortDate } from '@/domain/dates';
import { describeVaccineStatus, describeWhen } from '@/domain/health';
import { errorMessage } from '@/lib/supabase';
import type { Appointment } from '@/lib/types';
import { notify } from '@/ui/dialogs';
import { IconArt } from '@/ui/iconArt';
import { Badge, CheckCircle, IconBadge, ListCard, ListRow, Section } from '@/ui/primitives';
import type { useHealthOverview } from './useHealthOverview';

type Overview = ReturnType<typeof useHealthOverview>;

type WorkoutToday = Overview['workoutsToday'][number];
type VaccineDue = Overview['vaccinesDue'][number];
type PlanDraft = Overview['drafts'][number];

/**
 * As linhas da saúde (telas Saúde e Hoje), cada uma um `ListRow` para entrar no cartão de linhas de qualquer tela:
 * o treino do dia (com o "feito"), a consulta, a consulta que passou ("Foi realizada?"), a vacina e o plano que a IA
 * leu, para revisar.
 */
export function useHealthRows(overview: Overview, today: string) {
  const toggle = useToggleWorkoutLog();
  const onError = (err: unknown) => notify('Erro', errorMessage(err));

  return {
    workout: ({ plan, session, done }: WorkoutToday): ReactElement => (
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
            onPress={() => toggle.mutate({ planId: plan.id, sessionName: session.name, date: today, done: !done }, { onError })}
          />
        }
      />
    ),
    appointment: (a: Appointment): ReactElement => (
      <ListRow
        key={a.id}
        left={<IconBadge icon="stethoscope" tone="info" />}
        title={a.title}
        subtitle={[describeWhen(a.starts_at, today), overview.personName(a.person_id), a.professional].filter(Boolean).join(' · ')}
        onPress={() => router.push({ pathname: '/consulta/[id]', params: { id: a.id } })}
      />
    ),
    toConfirm: (a: Appointment): ReactElement => (
      <ListRow
        key={a.id}
        left={<IconBadge icon="stethoscope" tone="warning" />}
        title={a.title}
        subtitle={[describeWhen(a.starts_at, today), overview.personName(a.person_id)].filter(Boolean).join(' · ')}
        right={<Badge label="Foi realizada?" tone="warning" />}
        onPress={() => router.push({ pathname: '/consulta/[id]', params: { id: a.id } })}
      />
    ),
    vaccine: ({ vaccine, status }: VaccineDue): ReactElement => (
      <ListRow
        key={vaccine.id}
        left={<IconArt name="seringa" />}
        title={[vaccine.name, vaccine.dose].filter(Boolean).join(' · ')}
        subtitle={[
          overview.personName(vaccine.person_id),
          describeVaccineStatus(status),
          vaccine.next_dose_on ? formatShortDate(vaccine.next_dose_on) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        // O desenho da seringa é sempre o mesmo: o atraso aparece no selo.
        right={status.kind === 'atrasada' ? <Badge label="Atrasada" tone="danger" /> : undefined}
        onPress={() => router.push({ pathname: '/vacina/[id]', params: { id: vaccine.id } })}
      />
    ),
    draft: ({ kind, plan }: PlanDraft): ReactElement => (
      <ListRow
        key={plan.id}
        left={<IconBadge icon={kind === 'workout' ? 'dumbbell' : 'food-apple-outline'} tone="info" />}
        title={plan.title}
        subtitle={[overview.personName(plan.person_id), 'Confira o que a IA leu e ative'].filter(Boolean).join(' · ')}
        right={<Badge label="Revisar" tone="info" />}
        onPress={() => router.push({ pathname: kind === 'workout' ? '/treino/[id]' : '/dieta/[id]', params: { id: plan.id } })}
      />
    ),
  };
}

/**
 * Tela Saúde: os treinos de hoje, as próximas consultas (e as que passaram sem resposta), as vacinas e os planos
 * para revisar, cada assunto na sua seção. A tela Hoje usa as mesmas linhas (useHealthRows), nos blocos dela.
 */
export function HealthTodaySections({ overview, today }: { overview: Overview; today: string }) {
  const rows = useHealthRows(overview, today);
  const upcoming = overview.upcoming.slice(0, 5);

  return (
    <>
      {overview.workoutsToday.length ? (
        <Section title="Treino de hoje">
          <ListCard>{overview.workoutsToday.map(rows.workout)}</ListCard>
        </Section>
      ) : null}

      {upcoming.length || overview.toConfirm.length ? (
        <Section title="Consultas">
          <ListCard>
            {upcoming.map(rows.appointment)}
            {overview.toConfirm.map(rows.toConfirm)}
          </ListCard>
        </Section>
      ) : null}

      {overview.vaccinesDue.length ? (
        <Section title="Vacinas">
          <ListCard>{overview.vaccinesDue.map(rows.vaccine)}</ListCard>
        </Section>
      ) : null}

      {overview.drafts.length ? (
        <Section title="Para revisar">
          <ListCard>{overview.drafts.map(rows.draft)}</ListCard>
        </Section>
      ) : null}
    </>
  );
}
