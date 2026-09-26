import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useChores, useCompleteChore } from '@/data/home';
import { choreStatus, describeChoreStatus, describeRecurrence, type ChoreStatus } from '@/domain/chores';
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
                  const assignee = members.find((m) => m.user_id === chore.assigned_to)?.display_name;
                  return (
                    <ListRow
                      key={chore.id}
                      left={<IconBadge icon="broom" tone={group.tone} />}
                      title={chore.title}
                      subtitle={[describeChoreStatus(status), describeRecurrence(chore.recurrence, chore.interval_count), assignee]
                        .filter(Boolean)
                        .join(' · ')}
                      onPress={() => router.push({ pathname: '/tarefa/[id]', params: { id: chore.id } })}
                      right={
                        <CheckCircle
                          checked={false}
                          label={`Concluir ${chore.title}`}
                          onPress={() =>
                            complete.mutate(
                              { id: chore.id, today },
                              { onError: (err) => notify('Erro', errorMessage(err)) },
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
