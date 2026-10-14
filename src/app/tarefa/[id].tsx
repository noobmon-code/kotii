import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { fetchChoreRotations, useChore, useChoreRotations, useDeleteChore, useSaveChore, useSkipChoreTurn } from '@/data/home';
import { usePeople } from '@/data/health';
import { useEquipment } from '@/data/house';
import {
  currentTurn,
  hasUnknownPerson,
  isRotationChangedElsewhere,
  nextTurn,
  numberedOrder,
  openedWithoutRotation,
  orderHasKid,
  planRotationSave,
  plannedTurn,
  ROTATION_CHANGED_ELSEWHERE,
  ROTATION_CHECK_FAILED,
  ROTATION_PERSON_UNKNOWN,
  ROTATION_UNAVAILABLE,
  rotationAppearedElsewhere,
  rotationErrorMessage,
  rotationLabel,
  rotationOf,
  rotationPeople,
  rotationPointsLabel,
  rotationProblem,
  skipTurnQuestion,
  toggleInOrder,
  turnOf,
  type ChoreTurn,
} from '@/domain/choreRotation';
import { CHORE_GONE, isChoreGone, isChoreGoneOnSave, RECURRENCE_OPTIONS, type Recurrence } from '@/domain/chores';
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
  // A tarefa, a ordem do rodízio e as fichas entram no estado inicial do
  // formulário, e salvar grava por cima do que está no servidor. Por isso a
  // tarefa que já existe e as ordens são buscadas de novo ao abrir (`fresh`),
  // e o formulário espera por elas: aberto com o cache de antes, desfaria um
  // rodízio criado em outro celular sem nunca tê-lo mostrado.
  const chore = useChore(isNew ? undefined : id, { fresh: true });
  const rotations = useChoreRotations({ fresh: !isNew });
  const people = usePeople();
  // A espera vale só até o formulário aparecer: depois, uma busca de fundo
  // (a de "Pular a vez", por exemplo) não o tira da tela com o que foi digitado.
  const [opened, setOpened] = useState(false);

  if (!isNew) {
    const queries = [chore, rotations, people];
    // Erro só sem nada para mostrar: a busca de fundo que falha não troca o
    // formulário aberto pelo aviso. A tarefa apagada em outro aparelho é a
    // exceção: não há mais o que editar.
    // Apagada em outro aparelho: tentar de novo não a traz de volta.
    if (chore.isError && isChoreGone(chore.error)) return <ErrorNotice error={new Error(CHORE_GONE)} />;
    const failed = queries.find((q) => q.isError && q.data === undefined);
    if (failed) return <ErrorNotice error={failed.error} onRetry={() => queries.forEach((q) => q.refetch())} />;
    if (queries.some((q) => q.isPending)) return <Loading />;
    if (!opened) {
      // Sem internet a busca fica parada (não está "buscando") e a tela abre com o cache.
      if (queries.some((q) => q.isFetching && !q.isFetchedAfterMount)) return <Loading />;
      setOpened(true);
    }
  }
  return (
    <ChoreForm
      chore={isNew ? undefined : chore.data}
      equipmentId={(isNew ? aparelho : chore.data?.equipment_id) || null}
      savedOrder={isNew ? [] : rotationOf(rotations.data, id)}
    />
  );
}

/** savedOrder: a ordem do rodízio gravada agora (vazia: a tarefa não está em rodízio). */
function ChoreForm({ chore, equipmentId, savedOrder }: { chore?: Chore; equipmentId: string | null; savedOrder: string[] }) {
  const equipment = useEquipment(equipmentId ?? undefined);
  const household = useHousehold();
  const members = household.data?.members ?? [];
  const save = useSaveChore();
  const skip = useSkipChoreTurn();
  const remove = useDeleteChore();
  const peopleQuery = usePeople();
  const people = peopleQuery.data ?? [];
  const kids = kidsOf(people);
  const who = rotationPeople(members, people);
  const [title, setTitle] = useState(chore?.title ?? '');
  const [notes, setNotes] = useState(chore?.notes ?? '');
  const [recurrence, setRecurrence] = useState<Recurrence>(chore?.recurrence ?? (equipmentId ? 'monthly' : 'weekly'));
  const [interval, setIntervalCount] = useState(String(chore?.interval_count ?? 1));
  const [due, setDue] = useState(formatBRDate(chore?.due_on ?? todayISO()));
  const [assignedTo, setAssignedTo] = useState<string | null>(chore?.assigned_to ?? null);
  const [kidId, setKidId] = useState<string | null>(chore?.kid_id ?? null);
  // A ordem gravada que o formulário mostrou ao abrir. É por ela que salvar
  // decide, não pela do cache naquela hora: a busca de fundo pode trazer um
  // rodízio que esta tela nunca mostrou, e ela não pode encerrá-lo.
  const [shownOrder] = useState(savedOrder);
  // Rodízio: as fichas na ordem escolhida. De quem é a vez não fica aqui: vem da tarefa.
  const [rotating, setRotating] = useState(shownOrder.length > 0);
  const [order, setOrder] = useState(shownOrder);
  // Tarefa nova de criança começa valendo 10; a que já é de criança (ou tem criança no rodízio) mantém o que tinha, mesmo 0.
  // Com alguém na ordem que este aparelho ainda não conhece, também: pode ser uma criança, e os pontos gravados são dela.
  const [points, setPoints] = useState(
    String(chore && (chore.kid_id || orderHasKid(shownOrder, who) || hasUnknownPerson(shownOrder, who)) ? chore.points : 10),
  );
  // Conferindo a ordem no servidor antes de salvar (ver submit). A trava é já no toque: o estado só muda no próximo render.
  const [checking, setChecking] = useState(false);
  const submitting = useRef(false);
  // O salvar respondeu que a tarefa não existe mais: o aviso da tarefa apagada toma o lugar do formulário.
  const [gone, setGone] = useState(false);

  const saved = chore ? { turn: chore, order: shownOrder } : undefined;
  // "Uma vez" não tem rodízio: fica só quem está na vez.
  const inRotation = rotating && recurrence !== 'none';
  // Quem a tela mostra na vez. Se o rodízio já estava gravado, é só o que este aparelho sabe: a vez é do banco, e
  // salvar não a manda (planRotationSave).
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

  // Salvar com o formulário como ele está agora: depois da conferência no servidor (abaixo), vale o que a pessoa
  // corrigiu enquanto ela andava, conferido de novo, e não o que estava na tela na hora do toque.
  const submitLatest = useRef<() => void>(() => undefined);

  async function submit(checked = false) {
    if (submitting.current) return;
    const dueISO = parseBRDate(due);
    const count = Number.parseInt(interval, 10);
    if (!title.trim() || !dueISO || !(count >= 1 && count <= 365)) {
      notify('Confira os dados', 'Título, data (dd/mm/aaaa) e intervalo entre 1 e 365 são obrigatórios.');
      return;
    }
    // Com a ordem na tela (o rodízio, ou a tarefa em rodízio que virou "Uma vez"), o formulário tira dela, só com
    // quem este aparelho conhece, a ordem a gravar, quem ele mostra na vez e se a tarefa vale pontos. Se ela tem
    // alguém que ele ainda não carregou (ficha ou morador de há pouco, ou a busca que falhou ao abrir), salvar tiraria
    // essa pessoa do rodízio ou, sendo ela quem está na vez, decidiria os pontos por outra pessoa. Nada é gravado, e
    // as listas são buscadas de novo.
    if (rotating && hasUnknownPerson(order, who)) {
      notify('Esta tarefa mudou', ROTATION_PERSON_UNKNOWN);
      peopleQuery.refetch();
      household.refetch();
      return;
    }
    if (problem) {
      notify('Rodízio incompleto', problem);
      return;
    }
    const plan = planRotationSave({
      saved,
      recurrence,
      choice: rotating ? { mode: 'rotation', order } : { mode: 'single', ...single },
      people: who,
    });
    // O formulário abriu sem rodízio (do que o aparelho tinha guardado) e a tarefa ganhou um em outro aparelho:
    // salvar daqui trocaria a vez e os pontos por dados velhos. A ordem igual à que ele está salvando não é de outro
    // aparelho: é a dele, de um salvar que chegou ao servidor sem a resposta voltar, e salvar de novo passa.
    const expectNone = openedWithoutRotation(saved);
    if (expectNone && rotationAppearedElsewhere(savedOrder, plan.people)) {
      notify('Esta tarefa mudou', ROTATION_CHANGED_ELSEWHERE);
      return;
    }
    const pointsValue = earnsPoints ? Number.parseInt(points, 10) : 0;
    if (earnsPoints && !(pointsValue >= 0 && pointsValue <= 1000)) {
      notify('Pontos inválidos', 'Use um número de 0 a 1000.');
      return;
    }
    // O aparelho pode nem saber do rodízio novo: com o editor aberto ninguém busca de novo, e a busca ao abrir pode
    // ter falhado. Por isso, no formulário que abriu sem rodízio, a ordem é conferida agora, direto no servidor (a
    // consulta em cache, sem internet, ficaria parada esperando e o botão não faria nada). Se não deu para
    // conferir, nada é gravado. No banco que ainda não tem o rodízio a resposta é "nenhuma ordem", e a tarefa salva.
    // Esta conferência dá o aviso sem gravar nada, no caso comum; quem garante é o banco, que confere de novo, com
    // a tarefa travada, na mesma chamada que grava (saveChore), para o rodízio criado entre uma coisa e outra.
    if (!checked && chore && expectNone) {
      submitting.current = true;
      setChecking(true);
      try {
        if (rotationAppearedElsewhere(rotationOf(await fetchChoreRotations(), chore.id), plan.people)) {
          notify('Esta tarefa mudou', ROTATION_CHANGED_ELSEWHERE);
          return;
        }
      } catch {
        notify('Nada foi salvo', ROTATION_CHECK_FAILED);
        return;
      } finally {
        submitting.current = false;
        setChecking(false);
      }
      return submitLatest.current();
    }
    // A tarefa em rodízio que vira "Uma vez" fica com quem está na vez no banco. Se a tela não mostra os pontos (quem
    // este aparelho acha que está na vez tem o app), eles também ficam como estão: a vez pode ter passado para uma
    // criança em outro celular, e o 0 daqui apagaria os pontos dela.
    const turnStays = !plan.turn && plan.people?.length === 0;
    save.mutate(
      {
        id: chore?.id,
        values: {
          title: title.trim(),
          notes: notes.trim() || null,
          recurrence,
          interval_count: recurrence === 'none' ? 1 : count,
          due_on: dueISO,
          // O responsável só vai quando a pessoa o escolheu: num rodízio a vez é do banco. (No rodízio novo vai o
          // primeiro da ordem, que só o banco que ainda não tem o rodízio grava.)
          ...plan.turn,
          ...(turnStays && !earnsPoints ? {} : { points: pointsValue }),
          ...(chore ? {} : { equipment_id: equipmentId }),
        },
        rotation: plan.people,
        expectNone,
      },
      {
        // A tarefa é salva inteira, numa chamada só: ou deu certo, ou nada daquele toque ficou gravado.
        onSuccess: (result) => {
          // Banco que ainda não tem o rodízio: a tarefa ficou salva, e a ordem pedida, de fora.
          if (result.rotationUnavailable) notify('A tarefa foi salva, sem o rodízio', ROTATION_UNAVAILABLE);
          router.back();
        },
        onError: (err) => {
          // O banco recusou: a tarefa ganhou um rodízio depois da conferência acima. Nada deste formulário foi salvo,
          // ele fica aberto, e a tarefa e as ordens já estão sendo buscadas de novo (useSaveChore).
          if (isRotationChangedElsewhere(err)) return notify('Esta tarefa mudou', ROTATION_CHANGED_ELSEWHERE);
          // A tarefa foi apagada em outro aparelho (ou a pessoa saiu da casa): nada foi salvo e não há mais o que
          // editar. Em vez de um alerta com o texto do banco, o aviso que a tela já tem para isso, sem esperar a busca.
          if (isChoreGoneOnSave(err)) return setGone(true);
          // As outras recusas e a falha de rede: o formulário fica aberto, e salvar de novo é seguro (se a chamada
          // chegou ao servidor antes de a internet cair, a segunda grava a mesma coisa).
          onError(err);
        },
      },
    );
  }
  useEffect(() => {
    submitLatest.current = () => submit(true);
  });

  if (gone) return <ErrorNotice error={new Error(CHORE_GONE)} />;
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
                Ordem: {numberedOrder(order, who)}. Ao concluir a tarefa, a vez passa para a pessoa seguinte. Toque numa pessoa para pôr ou
                tirar; a ordem é a dos toques.
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
              {/* No rodízio, os pontos são de quem não tem o app, cada um na sua vez: o texto diz de quem. */}
              {inRotation
                ? rotationPointsLabel(order, who)
                : `pontos para ${kids.find((k) => k.id === single.kid_id)?.name} quando ficar pronta`}
            </Text>
          </Row>
        ) : null}
        {skipTo ? <Button title="Pular a vez" icon="skip-next" variant="secondary" onPress={askSkip} loading={skip.isPending} /> : null}
      </View>

      <TextField label="Observações" value={notes} onChangeText={setNotes} multiline />
      <Button title="Salvar" onPress={() => submit()} loading={checking || save.isPending} />
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
