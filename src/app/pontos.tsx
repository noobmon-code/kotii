import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useChores, useKidHistory, useKidPoints, useRedeemPoints } from '@/data/home';
import { usePeople } from '@/data/health';
import { formatShortDate, todayISO, toISODate } from '@/domain/dates';
import { earnedThisWeek, kidsOf, pointsHistory } from '@/domain/points';
import { FieldsModal } from '@/features/health/FieldsModal';
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

  if (people.isPending || balances.isPending || chores.isPending) return <Loading />;
  const error = people.error ?? balances.error ?? chores.error;
  if (error) return <ErrorNotice error={error} onRetry={() => [people, balances, chores].forEach((q) => q.refetch())} />;

  const kids = kidsOf(people.data ?? []);
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
            chores={(chores.data ?? []).filter((c) => c.kid_id === kid.id)}
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

function KidCard({ kid, tint, balance, chores }: { kid: Person; tint: Tint; balance: number; chores: Chore[] }) {
  const t = useTint(tint);
  const history = useKidHistory(kid.id);
  const redeem = useRedeemPoints();
  const [redeeming, setRedeeming] = useState(false);
  const today = todayISO();
  const events = history.data ? pointsHistory(history.data.completions, history.data.redemptions) : [];
  const week = earnedThisWeek(events, today);

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
          {chores.map((c) => (
            <ListRow
              key={c.id}
              title={c.title}
              subtitle={`${plural(c.points)} · ${c.due_on <= today ? 'para hoje' : `próxima ${formatShortDate(c.due_on)}`}`}
              onPress={() => router.push({ pathname: '/tarefa/[id]', params: { id: c.id } })}
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
          onClose={() => setRedeeming(false)}
          onSave={({ title, points }) => {
            const cost = Number.parseInt(points, 10);
            if (!(cost > 0)) return notify('Pontos inválidos', 'Use um número maior que zero.');
            if (cost > balance) return notify('Pontos insuficientes', `${kid.name} tem ${plural(balance)}.`);
            redeem.mutate(
              { person_id: kid.id, title: title.trim(), points: cost },
              {
                onSuccess: () => {
                  setRedeeming(false);
                  notify('Prêmio registrado', `${kid.name} trocou ${plural(cost)} por ${title.trim()}.`);
                },
                onError: (err) => notify('Erro', errorMessage(err)),
              },
            );
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
