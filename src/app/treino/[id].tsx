import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  useDeleteWorkoutPlan,
  usePeople,
  useToggleWorkoutLog,
  useUpdateWorkoutPlan,
  useWorkoutLogs,
  useWorkoutPlan,
} from '@/data/health';
import { addDays, formatBRDate, formatShortDate, parseBRDate, todayISO } from '@/domain/dates';
import {
  describeExercise,
  describeWeekdays,
  emptyExercise,
  nextSessionName,
  sessionsForToday,
  WEEKDAYS_SHORT,
  workoutProblem,
  type Exercise,
  type WorkoutSession,
} from '@/domain/health';
import { FieldsModal, orNull } from '@/features/health/FieldsModal';
import { PhotoStrip } from '@/features/health/PhotoStrip';
import { useHousehold } from '@/lib/auth';
import { errorMessage } from '@/lib/supabase';
import type { WorkoutPlan } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import {
  Badge,
  Button,
  Card,
  Chip,
  ErrorNotice,
  IconButton,
  ListCard,
  ListRow,
  Loading,
  Row,
  Screen,
  Section,
  Text,
} from '@/ui/primitives';
import { space } from '@/ui/theme';

type Editing =
  | { kind: 'info' }
  | { kind: 'session'; index: number | null; weekdays: number[] }
  | { kind: 'exercise'; session: number; index: number | null };

export default function WorkoutPlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const plan = useWorkoutPlan(id);
  if (plan.isPending) return <Loading />;
  if (plan.isError) return <ErrorNotice error={plan.error} onRetry={() => plan.refetch()} />;
  return <WorkoutPlanView plan={plan.data} />;
}

function WorkoutPlanView({ plan }: { plan: WorkoutPlan }) {
  const today = todayISO();
  const people = usePeople();
  const members = useHousehold().data?.members ?? [];
  const logs = useWorkoutLogs(addDays(today, -90));
  const update = useUpdateWorkoutPlan(plan.id);
  const remove = useDeleteWorkoutPlan();
  const toggle = useToggleWorkoutLog();
  const [editing, setEditing] = useState<Editing | null>(null);
  const onError = (err: unknown) => notify('Erro', errorMessage(err));

  const sessions = plan.sessions;
  const planLogs = (logs.data ?? []).filter((l) => l.plan_id === plan.id);
  const todays = plan.status === 'active' ? sessionsForToday(sessions, planLogs, today).map((s) => s.name) : [];
  const doneToday = new Set(planLogs.filter((l) => l.done_on === today).map((l) => l.session_name));
  const personName = people.data?.find((p) => p.id === plan.person_id)?.name;
  const isDraft = plan.status === 'draft';

  const saveSessions = (next: WorkoutSession[], after?: () => void) =>
    update.mutate({ sessions: next }, { onSuccess: after, onError });

  function activate() {
    const problem = workoutProblem(sessions);
    if (problem) {
      notify('Falta pouco', problem);
      return;
    }
    update.mutate({ status: 'active' }, { onError });
  }

  const editingSession = editing?.kind === 'session' && editing.index != null ? sessions[editing.index] : null;
  const editingExercise =
    editing?.kind === 'exercise' && editing.index != null ? sessions[editing.session].exercises[editing.index] : null;

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: 'Ficha de treino' }} />

      <Card style={styles.gapSm}>
        <Row>
          <View style={styles.flex}>
            <Text variant="heading">{plan.title}</Text>
            <Text variant="muted">
              {[
                personName,
                plan.professional,
                plan.valid_until ? `até ${formatShortDate(plan.valid_until)}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          <IconButton icon="pencil-outline" label="Editar dados da ficha" onPress={() => setEditing({ kind: 'info' })} />
        </Row>
        {plan.notes ? <Text variant="body">{plan.notes}</Text> : null}
        {isDraft ? (
          <>
            <Badge label="Rascunho" tone="info" />
            <Text variant="muted">
              Confira o que foi lido: toque em um exercício para corrigir. Depois de ativar, o treino do dia aparece na tela Hoje.
            </Text>
            <Button title="Ativar ficha" icon="check" onPress={activate} loading={update.isPending} />
          </>
        ) : null}
      </Card>

      {plan.file_paths.length ? <PhotoStrip paths={plan.file_paths} /> : null}

      {sessions.map((session, sessionIndex) => {
        const done = doneToday.has(session.name);
        return (
          <Section
            key={`${sessionIndex}-${session.name}`}
            title={session.name}
            action={
              <IconButton
                icon="pencil-outline"
                label={`Editar ${session.name}`}
                onPress={() => setEditing({ kind: 'session', index: sessionIndex, weekdays: session.weekdays })}
              />
            }>
            <Row style={styles.wrap}>
              {session.weekdays.length ? <Badge label={describeWeekdays(session.weekdays)} /> : null}
              {todays.includes(session.name) ? <Badge label="Hoje" tone="primary" /> : null}
            </Row>
            {session.exercises.length ? (
              <ListCard>
                {session.exercises.map((exercise, index) => (
                  <ListRow
                    key={`${index}-${exercise.name}`}
                    title={exercise.name}
                    subtitle={[describeExercise(exercise), exercise.notes].filter(Boolean).join('\n') || undefined}
                    onPress={() => setEditing({ kind: 'exercise', session: sessionIndex, index })}
                  />
                ))}
              </ListCard>
            ) : null}
            <Row>
              <Button
                title="Exercício"
                icon="plus"
                variant="ghost"
                compact
                onPress={() => setEditing({ kind: 'exercise', session: sessionIndex, index: null })}
              />
              <View style={styles.flex} />
              {plan.status === 'active' ? (
                <Button
                  title={done ? 'Feito hoje' : 'Marcar feito hoje'}
                  icon={done ? 'check-circle' : 'check'}
                  variant={done ? 'secondary' : 'primary'}
                  compact
                  onPress={() =>
                    toggle.mutate({ planId: plan.id, sessionName: session.name, date: today, done: !done }, { onError })
                  }
                />
              ) : null}
            </Row>
          </Section>
        );
      })}

      <Button
        title="Adicionar treino"
        icon="plus"
        variant="secondary"
        onPress={() => setEditing({ kind: 'session', index: null, weekdays: [] })}
      />

      {planLogs.length ? (
        <Section title="Histórico">
          <ListCard>
            {planLogs.slice(0, 15).map((log) => (
              <ListRow
                key={log.id}
                left={<Badge label={formatShortDate(log.done_on)} />}
                title={log.session_name}
                subtitle={members.find((m) => m.user_id === log.done_by)?.display_name}
              />
            ))}
          </ListCard>
        </Section>
      ) : null}

      <Row>
        {plan.status === 'active' ? (
          <Button
            title="Arquivar"
            variant="secondary"
            icon="archive-outline"
            style={styles.flex}
            onPress={() =>
              confirmAction('Arquivar ficha', 'A ficha sai da lista e do treino do dia.', 'Arquivar', () =>
                update.mutate({ status: 'archived' }, { onSuccess: () => router.back(), onError }),
              false)
            }
          />
        ) : null}
        <Button
          title="Apagar"
          variant="danger"
          icon="trash-can-outline"
          style={styles.flex}
          onPress={() =>
            confirmAction('Apagar ficha', `Apagar ${plan.title}, as fotos e o histórico de treinos?`, 'Apagar', () =>
              remove.mutate(plan, { onSuccess: () => router.back(), onError }),
            )
          }
        />
      </Row>

      {editing?.kind === 'info' ? (
        <FieldsModal<'title' | 'professional' | 'valid_until' | 'notes'>
          title="Dados da ficha"
          initial={{
            title: plan.title,
            professional: plan.professional,
            valid_until: plan.valid_until ? formatBRDate(plan.valid_until) : '',
            notes: plan.notes,
          }}
          fields={[
            { key: 'title', label: 'Nome', required: true },
            { key: 'professional', label: 'Profissional', placeholder: 'Nome e CREF' },
            { key: 'valid_until', label: 'Trocar a ficha em', placeholder: 'dd/mm/aaaa', keyboardType: 'numbers-and-punctuation' },
            { key: 'notes', label: 'Orientações gerais', multiline: true },
          ]}
          onClose={() => setEditing(null)}
          onSave={(values) => {
            const validUntil = values.valid_until.trim() ? parseBRDate(values.valid_until) : null;
            if (values.valid_until.trim() && !validUntil) {
              notify('Data inválida', 'Use dd/mm/aaaa.');
              return;
            }
            update.mutate(
              {
                title: values.title.trim(),
                professional: orNull(values.professional),
                valid_until: validUntil,
                notes: orNull(values.notes),
              },
              { onSuccess: () => setEditing(null), onError },
            );
          }}
        />
      ) : null}

      {editing?.kind === 'session' ? (
        <FieldsModal<'name'>
          title={editingSession ? 'Editar treino' : 'Novo treino'}
          initial={{ name: editingSession?.name ?? nextSessionName(sessions) }}
          fields={[{ key: 'name', label: 'Nome', placeholder: 'Ex.: Treino A, Superiores', required: true }]}
          onClose={() => setEditing(null)}
          onSave={({ name }) => {
            const session: WorkoutSession = {
              name: name.trim(),
              weekdays: [...editing.weekdays].sort((a, b) => a - b),
              exercises: editingSession?.exercises ?? [],
            };
            const next =
              editing.index == null ? [...sessions, session] : sessions.map((s, i) => (i === editing.index ? session : s));
            const problem = new Set(next.map((s) => s.name.toLowerCase())).size !== next.length;
            if (problem) {
              notify('Nome repetido', 'Cada treino precisa de um nome diferente.');
              return;
            }
            saveSessions(next, () => setEditing(null));
          }}
          onDelete={
            editing.index != null
              ? () =>
                  confirmAction('Remover treino', `Remover ${editingSession?.name} e seus exercícios?`, 'Remover', () =>
                    saveSessions(
                      sessions.filter((_, i) => i !== editing.index),
                      () => setEditing(null),
                    ),
                  )
              : undefined
          }>
          <View style={styles.gapSm}>
            <Text variant="label">Dias da semana</Text>
            <Row style={styles.wrap}>
              {WEEKDAYS_SHORT.map((label, day) => {
                const selected = editing.weekdays.includes(day);
                return (
                  <Chip
                    key={label}
                    label={label}
                    selected={selected}
                    onPress={() =>
                      setEditing({
                        ...editing,
                        weekdays: selected ? editing.weekdays.filter((d) => d !== day) : [...editing.weekdays, day],
                      })
                    }
                  />
                );
              })}
            </Row>
            <Text variant="small">Sem dias marcados, os treinos seguem em sequência (A, B, C…).</Text>
          </View>
        </FieldsModal>
      ) : null}

      {editing?.kind === 'exercise' ? (
        <FieldsModal<keyof Exercise>
          title={editingExercise ? 'Editar exercício' : 'Novo exercício'}
          initial={editingExercise ?? emptyExercise()}
          fields={[
            { key: 'name', label: 'Exercício', placeholder: 'Ex.: Supino reto com halteres', required: true },
            { key: 'sets', label: 'Séries', placeholder: 'Ex.: 4' },
            { key: 'reps', label: 'Repetições', placeholder: 'Ex.: 10-12' },
            { key: 'load', label: 'Carga', placeholder: 'Ex.: 20 kg' },
            { key: 'rest', label: 'Descanso', placeholder: 'Ex.: 60s' },
            { key: 'notes', label: 'Observações', placeholder: 'Técnica, cadência, bi-set…', multiline: true },
          ]}
          onClose={() => setEditing(null)}
          onSave={(values) => {
            const exercise: Exercise = {
              name: values.name.trim(),
              sets: orNull(values.sets),
              reps: orNull(values.reps),
              load: orNull(values.load),
              rest: orNull(values.rest),
              notes: orNull(values.notes),
            };
            const next = sessions.map((s, i) =>
              i !== editing.session
                ? s
                : {
                    ...s,
                    exercises:
                      editing.index == null
                        ? [...s.exercises, exercise]
                        : s.exercises.map((e, j) => (j === editing.index ? exercise : e)),
                  },
            );
            saveSessions(next, () => setEditing(null));
          }}
          onDelete={
            editing.index != null
              ? () =>
                  saveSessions(
                    sessions.map((s, i) =>
                      i !== editing.session ? s : { ...s, exercises: s.exercises.filter((_, j) => j !== editing.index) },
                    ),
                    () => setEditing(null),
                  )
              : undefined
          }
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gapSm: { gap: space.sm },
  wrap: { flexWrap: 'wrap' },
});
