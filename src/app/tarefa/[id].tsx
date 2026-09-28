import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useChore, useDeleteChore, useSaveChore } from '@/data/home';
import { usePeople } from '@/data/health';
import { useEquipment } from '@/data/house';
import { RECURRENCE_OPTIONS, type Recurrence } from '@/domain/chores';
import { formatBRDate, parseBRDate, todayISO } from '@/domain/dates';
import { kidsOf } from '@/domain/points';
import { useHousehold } from '@/lib/auth';
import { errorMessage } from '@/lib/supabase';
import type { Chore } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import { Button, Chip, DateField, ErrorNotice, Icon, Loading, Row, Screen, Text, TextField } from '@/ui/primitives';
import { space } from '@/ui/theme';

const INTERVAL_UNIT: Record<Exclude<Recurrence, 'none'>, string> = {
  daily: 'dias',
  weekly: 'semanas',
  monthly: 'meses',
};

export default function ChoreScreen() {
  // `aparelho`: tarefa nova de manutenção, já ligada ao aparelho.
  const { id, aparelho } = useLocalSearchParams<{ id: string; aparelho?: string }>();
  const isNew = id === 'nova';
  const chore = useChore(isNew ? undefined : id);

  if (!isNew && chore.isPending) return <Loading />;
  if (!isNew && chore.isError) return <ErrorNotice error={chore.error} />;
  return <ChoreForm chore={isNew ? undefined : chore.data} equipmentId={(isNew ? aparelho : chore.data?.equipment_id) || null} />;
}

function ChoreForm({ chore, equipmentId }: { chore?: Chore; equipmentId: string | null }) {
  const equipment = useEquipment(equipmentId ?? undefined);
  const members = useHousehold().data?.members ?? [];
  const save = useSaveChore();
  const remove = useDeleteChore();
  const [title, setTitle] = useState(chore?.title ?? '');
  const [notes, setNotes] = useState(chore?.notes ?? '');
  const [recurrence, setRecurrence] = useState<Recurrence>(chore?.recurrence ?? (equipmentId ? 'monthly' : 'weekly'));
  const [interval, setIntervalCount] = useState(String(chore?.interval_count ?? 1));
  const [due, setDue] = useState(formatBRDate(chore?.due_on ?? todayISO()));
  const [assignedTo, setAssignedTo] = useState<string | null>(chore?.assigned_to ?? null);
  const [kidId, setKidId] = useState<string | null>(chore?.kid_id ?? null);
  // Tarefa nova de criança começa valendo 10; a que já é de criança mantém o que tinha, mesmo 0.
  const [points, setPoints] = useState(String(chore?.kid_id ? chore.points : 10));
  const kids = kidsOf(usePeople().data ?? []);

  const onError = (err: unknown) => notify('Erro', errorMessage(err));

  function submit() {
    const dueISO = parseBRDate(due);
    const count = Number.parseInt(interval, 10);
    if (!title.trim() || !dueISO || !(count >= 1 && count <= 365)) {
      notify('Confira os dados', 'Título, data (dd/mm/aaaa) e intervalo entre 1 e 365 são obrigatórios.');
      return;
    }
    const pointsValue = kidId ? Number.parseInt(points, 10) : 0;
    if (kidId && !(pointsValue >= 0 && pointsValue <= 1000)) {
      notify('Pontos inválidos', 'Use um número de 0 a 1000.');
      return;
    }
    save.mutate(
      {
        id: chore?.id,
        values: {
          title: title.trim(),
          notes: notes.trim() || null,
          recurrence,
          interval_count: recurrence === 'none' ? 1 : count,
          due_on: dueISO,
          assigned_to: kidId ? null : assignedTo,
          kid_id: kidId,
          points: pointsValue,
          ...(chore ? {} : { equipment_id: equipmentId }),
        },
      },
      { onSuccess: () => router.back(), onError },
    );
  }

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: chore ? 'Editar tarefa' : equipmentId ? 'Nova manutenção' : 'Nova tarefa' }} />
      {equipment.data ? (
        <Row>
          <Icon name="tools" color="textMuted" />
          <Text variant="muted">Manutenção de {equipment.data.name}</Text>
        </Row>
      ) : null}
      <TextField label="Tarefa" value={title} onChangeText={setTitle} placeholder="Ex.: Limpar filtro do ar-condicionado" autoFocus={!chore} />

      <View style={styles.group}>
        <Text variant="label">Repetir</Text>
        <Row style={styles.wrap}>
          {RECURRENCE_OPTIONS.map((o) => (
            <Chip key={o.value} label={o.label} selected={recurrence === o.value} onPress={() => setRecurrence(o.value)} />
          ))}
        </Row>
        {recurrence !== 'none' ? (
          <Row>
            <Text variant="body">A cada</Text>
            <View style={styles.interval}>
              <TextField value={interval} onChangeText={setIntervalCount} keyboardType="number-pad" accessibilityLabel="Intervalo" />
            </View>
            <Text variant="body">{INTERVAL_UNIT[recurrence]}</Text>
          </Row>
        ) : null}
      </View>

      <DateField
        label={chore ? 'Próxima data' : 'Primeira data'}
        value={due}
        onChangeText={setDue}
        hint="Ao concluir, a próxima é agendada a partir do dia em que foi feita."
      />

      <View style={styles.group}>
        <Text variant="label">Responsável</Text>
        <Row style={styles.wrap}>
          <Chip
            label="Qualquer um"
            selected={assignedTo === null && kidId === null}
            onPress={() => {
              setAssignedTo(null);
              setKidId(null);
            }}
          />
          {members.map((m) => (
            <Chip
              key={m.user_id}
              label={m.display_name}
              icon="account-outline"
              selected={!kidId && assignedTo === m.user_id}
              onPress={() => {
                setAssignedTo(m.user_id);
                setKidId(null);
              }}
            />
          ))}
          {kids.map((k) => (
            <Chip
              key={k.id}
              label={k.name}
              icon="human-child"
              selected={kidId === k.id}
              onPress={() => {
                setKidId(k.id);
                setAssignedTo(null);
              }}
            />
          ))}
        </Row>
        {kidId ? (
          <Row>
            <Text variant="body">Vale</Text>
            <View style={styles.interval}>
              <TextField value={points} onChangeText={setPoints} keyboardType="number-pad" accessibilityLabel="Pontos" />
            </View>
            <Text variant="body" style={styles.flex}>
              pontos para {kids.find((k) => k.id === kidId)?.name} quando ficar pronta
            </Text>
          </Row>
        ) : null}
      </View>

      <TextField label="Observações" value={notes} onChangeText={setNotes} multiline />
      <Button title="Salvar" onPress={submit} loading={save.isPending} />
      {chore ? (
        <Button
          title="Excluir tarefa"
          variant="danger"
          icon="trash-can-outline"
          onPress={() =>
            confirmAction('Excluir tarefa', `Excluir "${chore.title}" e seu histórico?`, 'Excluir', () =>
              remove.mutate(chore.id, { onSuccess: () => router.back(), onError }),
            )
          }
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: { gap: space.sm },
  wrap: { flexWrap: 'wrap' },
  interval: { width: 72 },
});
