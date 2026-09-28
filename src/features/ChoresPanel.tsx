import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useChores, useCompleteChore, type CompleteChoreResult } from '@/data/home';
import { usePeople } from '@/data/health';
import { useEquipmentList } from '@/data/house';
import { choreAssigneeLabel, choreStatus, describeChoreStatus, describeRecurrence, type ChoreStatus } from '@/domain/chores';
import { kidsOf } from '@/domain/points';
import { todayISO } from '@/domain/dates';
import { useHousehold } from '@/lib/auth';
import { errorMessage } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';
import {
  Button,
  CheckCircle,
  EmptyState,
  ErrorNotice,
  IconBadge,
  ListCard,
  ListRow,
  Loading,
  Section,
  type Tone,
} from '@/ui/primitives';
import { space } from '@/ui/theme';

/**
 * Tarefa de criança concluída: comemora os pontos que o servidor de fato
 * creditou, com o nome de quem recebeu (a tarefa pode ter mudado de criança
 * em outro celular; toque repetido não conta).
 */
export function cheerKid(result: CompleteChoreResult, people: { id: string; name: string }[]) {
  const kid = result.person_id ? people.find((p) => p.id === result.person_id)?.name : undefined;
  if (kid && result.completed && result.points > 0) {
    notify(`+${result.points} ${result.points === 1 ? 'ponto' : 'pontos'} para ${kid}!`, 'O saldo fica em Casa → Tarefas → Pontos das crianças.');
  }
}

const GROUPS: { kind: ChoreStatus['kind']; title: string; tone: Tone }[] = [
  { kind: 'atrasada', title: 'Atrasadas', tone: 'danger' },
  { kind: 'hoje', title: 'Hoje', tone: 'primary' },
  { kind: 'proxima', title: 'Próximas', tone: 'neutral' },
];

export function ChoresPanel() {
  const today = todayISO();
  const chores = useChores();
  const complete = useCompleteChore();
  const members = useHousehold().data?.members ?? [];
  const equipment = useEquipmentList();
  const people = usePeople().data ?? [];
  const kids = kidsOf(people);

  if (chores.isPending) return <Loading />;
  if (chores.isError) return <ErrorNotice error={chores.error} onRetry={() => chores.refetch()} />;

  const rows = chores.data.map((chore) => ({ chore, status: choreStatus(chore.due_on, today) }));

  return (
    <View style={styles.gap}>
      <Button
        title="Nova tarefa"
        icon="plus"
        variant="secondary"
        onPress={() => router.push({ pathname: '/tarefa/[id]', params: { id: 'nova' } })}
      />
      {kids.length ? (
        <Button title="Pontos das crianças" icon="star-circle-outline" variant="secondary" onPress={() => router.push('/pontos')} />
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          icon="broom"
          title="Nenhuma tarefa"
          message="Cadastre limpezas e manutenções recorrentes (ex.: trocar filtro do ar a cada 3 meses) e divida com a família."
        />
      ) : (
        GROUPS.map((group) => {
          const groupRows = rows.filter((r) => r.status.kind === group.kind);
          if (!groupRows.length) return null;
          return (
            <Section key={group.kind} title={group.title}>
              <ListCard>
                {groupRows.map(({ chore, status }) => {
                  const assignee = choreAssigneeLabel(chore, members, people);
                  return (
                    <ListRow
                      key={chore.id}
                      left={<IconBadge icon="broom" tone={group.tone} />}
                      title={chore.title}
                      subtitle={[
                        describeChoreStatus(status),
                        describeRecurrence(chore.recurrence, chore.interval_count),
                        equipment.data?.find((e) => e.id === chore.equipment_id)?.name,
                        assignee,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      onPress={() => router.push({ pathname: '/tarefa/[id]', params: { id: chore.id } })}
                      right={
                        <CheckCircle
                          checked={false}
                          label={`Concluir ${chore.title}`}
                          onPress={() =>
                            complete.mutate(
                              { id: chore.id, today, dueOn: chore.due_on },
                              { onSuccess: (result) => cheerKid(result, people), onError: (err) => notify('Erro', errorMessage(err)) },
                            )
                          }
                        />
                      }
                    />
                  );
                })}
              </ListCard>
            </Section>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.lg },
});
