import { router, Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useChoreRotations, useChores, useKidHistory, useKidPoints, useRedeemPoints } from '@/data/home';
import { usePeople } from '@/data/health';
import { kidChores, rotationPeople } from '@/domain/choreRotation';
import { addDays, formatShortDate, todayISO, toISODate } from '@/domain/dates';
import { kidsOf, pointsHistory } from '@/domain/points';
import { FieldsModal } from '@/features/health/FieldsModal';
import { useHousehold } from '@/lib/auth';
import { errorMessage } from '@/lib/supabase';
import type { Chore, Person } from '@/lib/types';
import { notify } from '@/ui/dialogs';
import { Orb } from '@/ui/Orb';
import { Button, Card, EmptyState, ErrorNotice, ListRow, Loading, Row, Screen, Text } from '@/ui/primitives';
import { fonts, space, useGlow, type Tint } from '@/ui/theme';

const TINTS: Tint[] = ['yellow', 'green', 'pink', 'blue', 'purple', 'orange'];
const plural = (n: number) => `${n} ${Math.abs(n) === 1 ? 'ponto' : 'pontos'}`;

/** Pontos das crianças: saldo, tarefas que valem pontos, prêmios trocados. */
export default function PointsScreen() {
  const people = usePeople();
  const balances = useKidPoints();
  const chores = useChores();
  // Fora da espera: com as ordens guardadas (ou no banco ainda sem o rodízio, que responde "nenhuma"), a tela não
  // espera a busca delas. Enquanto não chegam, cada criança vê só as tarefas dela.
  const rotations = useChoreRotations();
  const members = useHousehold().data?.members ?? [];

  if (people.isPending || balances.isPending || chores.isPending) return <Loading />;
  // As ordens que falharam sem nada guardado entram no erro: sem elas, o cartão da criança que só reveza diria que
  // ela não tem tarefa.
  const ordersFailed = rotations.isError && rotations.data === undefined;
  const error = people.error ?? balances.error ?? chores.error ?? (ordersFailed ? rotations.error : null);
  if (error) return <ErrorNotice error={error} onRetry={() => [people, balances, chores, rotations].forEach((q) => q.refetch())} />;

  const kids = kidsOf(people.data ?? []);
  const who = rotationPeople(members, people.data ?? []);
  const today = todayISO();
  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: 'Pontos das crianças' }} />
      <Text variant="muted">
        Tarefa de criança vale pontos: quem marcar como feita credita a criança. Os pontos viram prêmios combinados em casa.
      </Text>
      {kids.length === 0 ? (
        <EmptyState
          icon="human-child"
          tint="yellow"
          title="Nenhuma criança cadastrada"
          message="Na aba Família, em “Sem celular”, adicione as crianças da casa. Depois, dê a elas tarefas que valem pontos."
        />
      ) : (
        kids.map((kid, index) => (
          <KidCard
            key={kid.id}
            kid={kid}
            tint={TINTS[index % TINTS.length]}
            balance={balances.data?.[kid.id] ?? 0}
            chores={kidChores(kid.id, chores.data ?? [], rotations.data, who, today)}
            ordersKnown={rotations.data !== undefined}
          />
        ))
      )}
      <Button
        title="Nova tarefa com pontos"
        icon="plus"
        variant="secondary"
        onPress={() => router.push({ pathname: '/tarefa/[id]', params: { id: 'nova' } })}
      />
    </Screen>
  );
}

/**
 * chores: as tarefas da criança e as dos rodízios em que ela está, com o texto de cada uma (kidChores).
 * ordersKnown: as ordens dos rodízios chegaram; sem elas, a lista pode estar sem as tarefas em que a criança reveza.
 */
function KidCard({
  kid,
  tint,
  balance,
  chores,
  ordersKnown,
}: {
  kid: Person;
  tint: Tint;
  balance: number;
  chores: { chore: Chore; subtitle: string }[];
  ordersKnown: boolean;
}) {
  const glow = useGlow(tint);
  const today = todayISO();
  const history = useKidHistory(kid.id, addDays(today, -6));
  const redeem = useRedeemPoints();
  const [redeeming, setRedeeming] = useState(false);
  const submitting = useRef(false);
  const events = history.data ? pointsHistory(history.data.completions, history.data.redemptions) : [];
  const week = history.data?.weekPoints ?? 0;

  return (
    <Card style={styles.gap}>
      <Row>
        <Orb size={64} glow={glow}>
          {/* A letra na cor do texto: no tom da criança, sobre o brilho do mesmo tom, ela some. */}
          <Text style={styles.initial}>{kid.name.trim().charAt(0).toUpperCase()}</Text>
        </Orb>
        <View style={styles.flex}>
          <Text variant="heading">{kid.name}</Text>
          <Text variant="title">{plural(balance)}</Text>
          {week > 0 ? <Text variant="small">+{plural(week)} nos últimos 7 dias</Text> : null}
        </View>
      </Row>

      {chores.length ? (
        <View>
          {chores.map(({ chore, subtitle }) => (
            <ListRow
              key={chore.id}
              title={chore.title}
              subtitle={subtitle}
              onPress={() => router.push({ pathname: '/tarefa/[id]', params: { id: chore.id } })}
            />
          ))}
        </View>
      ) : ordersKnown ? (
        <Text variant="small">Nenhuma tarefa com pontos ainda: na tarefa, escolha {kid.name} como responsável.</Text>
      ) : null}

      <Button
        title="Trocar pontos por prêmio"
        icon="gift-outline"
        variant="secondary"
        disabled={balance <= 0}
        onPress={() => setRedeeming(true)}
      />

      {events.slice(0, 6).map((e) => (
        <Row key={e.id}>
          <Text variant="small" style={styles.flex}>
            {formatShortDate(toISODate(new Date(e.at)))} · {e.title}
          </Text>
          <Text variant="label" color={e.points > 0 ? 'primary' : 'warning'}>
            {e.points > 0 ? `+${e.points}` : e.points}
          </Text>
        </Row>
      ))}

      {redeeming ? (
        <FieldsModal
          title={`Prêmio para ${kid.name}`}
          fields={[
            { key: 'title', label: 'Prêmio', placeholder: 'Ex.: Sorvete, passeio no parque', required: true },
            { key: 'points', label: `Pontos (tem ${plural(balance)})`, keyboardType: 'number-pad', required: true },
          ]}
          initial={{}}
          saving={redeem.isPending}
          onClose={() => setRedeeming(false)}
          onSave={async ({ title, points }) => {
            // Segundo toque com o primeiro ainda gravando: o mesmo prêmio sairia duas vezes.
            if (submitting.current) return;
            const cost = Number.parseInt(points, 10);
            if (!(cost > 0)) return notify('Pontos inválidos', 'Use um número maior que zero.');
            if (cost > balance) return notify('Pontos insuficientes', `${kid.name} tem ${plural(balance)}.`);
            submitting.current = true;
            try {
              await redeem.mutateAsync({ person_id: kid.id, title: title.trim(), points: cost });
              setRedeeming(false);
              notify('Prêmio registrado', `${kid.name} trocou ${plural(cost)} por ${title.trim()}.`);
            } catch (err) {
              notify('Erro', errorMessage(err));
            } finally {
              submitting.current = false;
            }
          }}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space.md },
  initial: { fontFamily: fonts.heavy, fontSize: 28, lineHeight: 34 },
});
