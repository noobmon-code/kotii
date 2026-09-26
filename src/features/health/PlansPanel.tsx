import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useDietPlans, usePeople, useWorkoutPlans } from '@/data/health';
import { formatShortDate, todayISO } from '@/domain/dates';
import { describeWeekdays } from '@/domain/health';
import type { DietPlan, WorkoutPlan } from '@/lib/types';
import { Badge, Button, EmptyState, ErrorNotice, IconBadge, ListCard, ListRow, Loading, Section } from '@/ui/primitives';
import { space } from '@/ui/theme';
import { openNewPerson, PersonChips } from './PersonChips';
import { usePlanImport, type PlanKind } from './usePlanImport';

const COPY: Record<PlanKind, { add: string; icon: 'dumbbell' | 'food-apple-outline'; emptyTitle: string; emptyMessage: string }> = {
  workout: {
    add: 'Nova ficha de treino',
    icon: 'dumbbell',
    emptyTitle: 'Nenhuma ficha de treino',
    emptyMessage:
      'Fotografe a ficha que o profissional passou: a IA organiza treinos e exercícios, você revisa e marca cada treino feito.',
  },
  diet: {
    add: 'Novo plano alimentar',
    icon: 'food-apple-outline',
    emptyTitle: 'Nenhum plano alimentar',
    emptyMessage:
      'Fotografe o plano da nutricionista: a IA organiza as refeições e monta a lista de compras para o mercado.',
  },
};

function planSubtitle(kind: PlanKind, plan: WorkoutPlan | DietPlan, personName: string | null, today: string): string {
  const detail =
    kind === 'workout'
      ? (plan as WorkoutPlan).sessions
          .map((s) => (s.weekdays.length ? `${s.name} (${describeWeekdays(s.weekdays)})` : s.name))
          .join(', ')
      : `${(plan as DietPlan).meals.length} refeições`;
  const validity = plan.valid_until
    ? plan.valid_until < today
      ? `venceu ${formatShortDate(plan.valid_until)}`
      : `até ${formatShortDate(plan.valid_until)}`
    : null;
  return [personName, detail, validity].filter(Boolean).join(' · ');
}

/** Fichas de treino ou planos alimentares da casa. */
export function PlansPanel({
  kind,
  personId,
  onPersonChange,
}: {
  kind: PlanKind;
  personId: string | null;
  onPersonChange: (id: string | null) => void;
}) {
  const today = todayISO();
  const people = usePeople();
  const workouts = useWorkoutPlans();
  const diets = useDietPlans();
  const plans = kind === 'workout' ? workouts : diets;
  const importer = usePlanImport();
  const copy = COPY[kind];

  if (plans.isError) return <ErrorNotice error={plans.error} onRetry={() => plans.refetch()} />;
  if (!plans.data || !people.data) return <Loading />;

  const humans = people.data.filter((p) => p.kind === 'pessoa');
  // Pet escolhido na aba Cuidados não tem treino nem dieta: mostra todos.
  const selected = humans.some((h) => h.id === personId) ? personId : null;
  const visible = (plans.data as (WorkoutPlan | DietPlan)[]).filter((p) => !selected || p.person_id === selected);
  const active = visible.filter((p) => p.status === 'active');
  const drafts = visible.filter((p) => p.status === 'draft');
  const nameOf = (id: string) => (selected ? null : people.data.find((p) => p.id === id)?.name ?? null);
  const open = (id: string) => router.push({ pathname: kind === 'workout' ? '/treino/[id]' : '/dieta/[id]', params: { id } });

  const renderRows = (rows: (WorkoutPlan | DietPlan)[], draft: boolean) => (
    <ListCard>
      {rows.map((plan) => (
        <ListRow
          key={plan.id}
          left={<IconBadge icon={copy.icon} tone={draft ? 'info' : 'primary'} />}
          title={plan.title}
          subtitle={planSubtitle(kind, plan, nameOf(plan.person_id), today)}
          right={draft ? <Badge label="Revisar" tone="info" /> : null}
          onPress={() => open(plan.id)}
        />
      ))}
    </ListCard>
  );

  return (
    <View style={styles.gap}>
      {humans.length > 1 ? (
        <PersonChips people={humans} value={selected} onChange={onPersonChange} allLabel="Todos" />
      ) : null}
      <Button
        title={copy.add}
        icon="camera-outline"
        variant="secondary"
        onPress={() => (humans.length ? importer.start(kind, selected ?? (humans.length === 1 ? humans[0].id : null)) : openNewPerson())}
      />
      {visible.length === 0 ? <EmptyState icon={copy.icon} title={copy.emptyTitle} message={copy.emptyMessage} /> : null}
      {drafts.length ? <Section title="Para revisar">{renderRows(drafts, true)}</Section> : null}
      {active.length ? <Section title="Em uso">{renderRows(active, false)}</Section> : null}
      {importer.element}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.lg },
});
