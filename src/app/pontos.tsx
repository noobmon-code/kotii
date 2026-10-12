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
import { Mascot } from '@/ui/art';
import { notify } from '@/ui/dialogs';
import { Button, Card, EmptyState, ErrorNotice, ListRow, Loading, Row, Screen, Text } from '@/ui/primitives';
import { space, useTint, type Tint } from '@/ui/theme';

const TINTS: Tint[] = ['yellow', 'green', 'pink', 'blue', 'purple', 'orange'];
const plural = (n: number) => `${n} ${Math.abs(n) === 1 ? 'ponto' : 'pontos'}`;

/** Pontos das crianças: saldo, tarefas que valem pontos, prêmios trocados. */
export default function PointsScreen() {
  const people = usePeople();
  const balances = useKidPoints();
  const chores = useChores();
  // Fora da espera e do erro: sem as ordens (ou no banco ainda sem o rodízio), cada criança vê só as tarefas dela.
  const rotations = useChoreRotations().data;
  const members = useHousehold().data?.members ?? [];

  if (people.isPending || balances.isPending || chores.isPending) return <Loading />;
  const error = people.error ?? balances.error ?? chores.error;
  if (error) return <ErrorNotice error={error} onRetry={() => [people, balances, chores].forEach((q) => q.refetch())} />;

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
            chores={kidChores(kid.id, chores.data ?? [], rotations, who, today)}
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

/** chores: as tarefas da criança e as dos rodízios em que ela está, com o texto de cada uma (kidChores). */
function KidCard({ kid, tint, balance, chores }: { kid: Person; tint: Tint; balance: number; chores: { chore: Chore; subtitle: string }[] }) {
  const t = useTint(tint);
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
        <View style={[styles.avatar, { backgroundColor: t.bg }]}>
          <Mascot size={44} color={t.art} shape="bean" />
        </View>
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
      ) : (
        <Text variant="small">Nenhuma tarefa com pontos ainda: na tarefa, escolha {kid.name} como responsável.</Text>
      )}

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
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
});
