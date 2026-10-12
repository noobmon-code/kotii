import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useChore, useChoreRotations, useDeleteChore, useSaveChore, useSkipChoreTurn } from '@/data/home';
import { usePeople } from '@/data/health';
import { useEquipment } from '@/data/house';
import {
  currentTurn,
  nextTurn,
  numberedOrder,
  orderHasKid,
  planRotationSave,
  plannedTurn,
  rotationErrorMessage,
  rotationLabel,
  rotationOf,
  rotationPeople,
  rotationProblem,
  skipTurnQuestion,
  toggleInOrder,
  turnOf,
  type ChoreTurn,
} from '@/domain/choreRotation';
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
  // A ordem do rodízio (e as fichas dela) entram no estado inicial do
  // formulário: a tarefa que já existe espera por elas. Sem elas, salvar
  // desfaria um rodízio que a tela nem mostrou.
  const rotations = useChoreRotations();
  const people = usePeople();

  if (!isNew) {
    const queries = [chore, rotations, people];
    const failed = queries.find((q) => q.isError);
    if (failed) return <ErrorNotice error={failed.error} onRetry={() => queries.forEach((q) => q.refetch())} />;
    if (queries.some((q) => q.isPending)) return <Loading />;
  }
  return (
    <ChoreForm
      chore={isNew ? undefined : chore.data}
      equipmentId={(isNew ? aparelho : chore.data?.equipment_id) || null}
      savedOrder={isNew ? [] : rotationOf(rotations.data, id)}
    />
  );
}

/** savedOrder: a ordem do rodízio gravada (vazia: a tarefa não está em rodízio). */
function ChoreForm({ chore, equipmentId, savedOrder }: { chore?: Chore; equipmentId: string | null; savedOrder: string[] }) {
  const equipment = useEquipment(equipmentId ?? undefined);
  const members = useHousehold().data?.members ?? [];
  const save = useSaveChore();
  const skip = useSkipChoreTurn();
  const remove = useDeleteChore();
  const people = usePeople().data ?? [];
  const kids = kidsOf(people);
  const who = rotationPeople(members, people);
  const [title, setTitle] = useState(chore?.title ?? '');
  const [notes, setNotes] = useState(chore?.notes ?? '');
  const [recurrence, setRecurrence] = useState<Recurrence>(chore?.recurrence ?? (equipmentId ? 'monthly' : 'weekly'));
  const [interval, setIntervalCount] = useState(String(chore?.interval_count ?? 1));
  const [due, setDue] = useState(formatBRDate(chore?.due_on ?? todayISO()));
  const [assignedTo, setAssignedTo] = useState<string | null>(chore?.assigned_to ?? null);
  const [kidId, setKidId] = useState<string | null>(chore?.kid_id ?? null);
  // Rodízio: as fichas na ordem escolhida. De quem é a vez não fica aqui: vem da tarefa.
  const [rotating, setRotating] = useState(savedOrder.length > 0);
  const [order, setOrder] = useState(savedOrder);
  // Tarefa nova de criança começa valendo 10; a que já é de criança (ou tem criança no rodízio) mantém o que tinha, mesmo 0.
  const [points, setPoints] = useState(String(chore && (chore.kid_id || orderHasKid(savedOrder, who)) ? chore.points : 10));
  // Tarefa nova já criada, cujo rodízio não pôde ser gravado: salvar de novo atualiza essa, em vez de criar outra.
  const [createdId, setCreatedId] = useState<string>();

  const saved = chore ? { turn: chore, order: savedOrder } : undefined;
  // "Uma vez" não tem rodízio: fica só quem está na vez.
  const inRotation = rotating && recurrence !== 'none';
  const planned = plannedTurn(saved, order, who);
  const single: ChoreTurn = rotating ? turnOf(planned) : { assigned_to: kidId ? null : assignedTo, kid_id: kidId };
  const problem = inRotation ? rotationProblem(order, who) : null;
  const earnsPoints = inRotation ? orderHasKid(order, who) : Boolean(single.kid_id);
  // "Pular a vez" vale para o rodízio que está gravado, não para o que está sendo editado.
  const skipTo = chore?.active ? nextTurn(chore, savedOrder, who) : null;

  const onError = (err: unknown) => notify('Erro', errorMessage(err));

  function pickSingle(turn: ChoreTurn) {
    setRotating(false);
    setAssignedTo(turn.assigned_to);
    setKidId(turn.kid_id);
  }

  function toggleRotation() {
    // Saindo do rodízio, fica quem está na vez; entrando, quem já era o responsável é o primeiro.
    if (rotating) return pickSingle(single);
    const first = currentTurn(single, who);
    if (!order.length && first) setOrder([first.id]);
    setRotating(true);
  }

  function askSkip() {
    if (!chore || !skipTo) return;
    const from = currentTurn(chore, who);
    confirmAction(
      'Pular a vez',
      skipTurnQuestion(from?.name, skipTo.name),
      'Passar a vez',
      // Se a vez já passou em outro celular, nada muda e a tela mostra a de agora.
      () => skip.mutate({ id: chore.id, from: from?.id ?? null }, { onError: (err) => notify('Erro', rotationErrorMessage(err) ?? errorMessage(err)) }),
      false,
    );
  }

  function submit() {
    const dueISO = parseBRDate(due);
    const count = Number.parseInt(interval, 10);
    if (!title.trim() || !dueISO || !(count >= 1 && count <= 365)) {
      notify('Confira os dados', 'Título, data (dd/mm/aaaa) e intervalo entre 1 e 365 são obrigatórios.');
      return;
    }
    if (problem) {
      notify('Rodízio incompleto', problem);
      return;
    }
    const pointsValue = earnsPoints ? Number.parseInt(points, 10) : 0;
    if (earnsPoints && !(pointsValue >= 0 && pointsValue <= 1000)) {
      notify('Pontos inválidos', 'Use um número de 0 a 1000.');
      return;
    }
    const plan = planRotationSave({
      saved,
      recurrence,
      choice: rotating ? { mode: 'rotation', order } : { mode: 'single', ...single },
      people: who,
    });
    const id = chore?.id ?? createdId;
    save.mutate(
      {
        id,
        values: {
          title: title.trim(),
          notes: notes.trim() || null,
          recurrence,
          interval_count: recurrence === 'none' ? 1 : count,
          due_on: dueISO,
          // Num rodízio que já existia, o responsável nem vai: a vez fica com o banco.
          ...plan.turn,
          points: pointsValue,
          ...(id ? {} : { equipment_id: equipmentId }),
        },
        rotation: plan.people,
      },
      {
        onSuccess: (result) => {
          if (!result.rotationError) return router.back();
          // A tarefa foi salva; só o rodízio ficou de fora.
          const unavailable = rotationErrorMessage(result.rotationError);
          if (unavailable) {
            notify('A tarefa foi salva, sem o rodízio', unavailable);
            return router.back();
          }
          setCreatedId(result.id);
          notify('A tarefa foi salva, mas o rodízio não', errorMessage(result.rotationError));
        },
        onError,
      },
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
            selected={!inRotation && single.assigned_to === null && single.kid_id === null}
            onPress={() => pickSingle(turnOf(null))}
          />
          {/* Só tarefa que se repete reveza, e só com duas pessoas ou mais na casa. */}
          {recurrence !== 'none' && (rotating || who.length >= 2) ? (
            <Chip label="Rodízio" icon="autorenew" selected={inRotation} onPress={toggleRotation} />
          ) : null}
          {inRotation ? (
            // A ordem é a dos toques: o número vai no nome, e tocar de novo tira a pessoa.
            who.map((p) => {
              const position = order.indexOf(p.id) + 1;
              return (
                <Chip
                  key={p.id}
                  label={position ? `${position} ${p.name}` : p.name}
                  icon={p.userId ? 'account-outline' : 'human-child'}
                  selected={position > 0}
                  onPress={() => setOrder(toggleInOrder(order, p.id))}
                />
              );
            })
          ) : (
            <>
              {members.map((m) => (
                <Chip
                  key={m.user_id}
                  label={m.display_name}
                  icon="account-outline"
                  selected={!single.kid_id && single.assigned_to === m.user_id}
                  onPress={() => pickSingle({ assigned_to: m.user_id, kid_id: null })}
                />
              ))}
              {kids.map((k) => (
                <Chip
                  key={k.id}
                  label={k.name}
                  icon="human-child"
                  selected={single.kid_id === k.id}
                  onPress={() => pickSingle({ assigned_to: null, kid_id: k.id })}
                />
              ))}
            </>
          )}
        </Row>
        {inRotation ? (
          problem ? (
            <Text variant="muted">{problem}</Text>
          ) : (
            <>
              <Text variant="body">{rotationLabel({ ...turnOf(planned), points: 0 }, order, who)}</Text>
              <Text variant="muted">
                Ordem: {numberedOrder(order, who)}. Ao concluir a tarefa, a vez passa para a pessoa seguinte. Toque em alguém para tirar do rodízio.
              </Text>
            </>
          )
        ) : null}
        {earnsPoints ? (
          <Row>
            <Text variant="body">Vale</Text>
            <View style={styles.interval}>
              <TextField value={points} onChangeText={setPoints} keyboardType="number-pad" accessibilityLabel="Pontos" />
            </View>
            <Text variant="body" style={styles.flex}>
              {inRotation
                ? 'pontos para a criança da vez quando ficar pronta'
                : `pontos para ${kids.find((k) => k.id === single.kid_id)?.name} quando ficar pronta`}
            </Text>
          </Row>
        ) : null}
        {skipTo ? <Button title="Pular a vez" icon="skip-next" variant="secondary" onPress={askSkip} loading={skip.isPending} /> : null}
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
