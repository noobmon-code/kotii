import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  toSchedule,
  useChores,
  useCompleteChore,
  useDoses,
  useMedications,
  usePantry,
  useToggleDose,
} from '@/data/home';
import { useShoppingLists } from '@/data/market';
import { useReceipts } from '@/data/receipts';
import { choreStatus, describeChoreStatus } from '@/domain/chores';
import { todayISO } from '@/domain/dates';
import { currentTimeHHMM, doseKey, dosesForDay } from '@/domain/medications';
import { describeExpiry, expiryStatus } from '@/domain/pantry';
import { hasHealthToday, HealthTodaySections } from '@/features/health/HealthTodaySections';
import { useHealthOverview } from '@/features/health/useHealthOverview';
import { useReceiptScanner } from '@/features/ReceiptScanner';
import { useHousehold } from '@/lib/auth';
import { errorMessage } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';
import {
  Badge,
  Button,
  Card,
  CategoryIcon,
  CheckCircle,
  EmptyState,
  IconBadge,
  ListCard,
  ListRow,
  Screen,
  Section,
  Text,
  Tile,
} from '@/ui/primitives';
import { space } from '@/ui/theme';

const capitalizeFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

export default function TodayScreen() {
  const now = new Date();
  const today = todayISO(now);
  const household = useHousehold();
  const medications = useMedications();
  const doses = useDoses(today);
  const chores = useChores();
  const pantry = usePantry();
  const lists = useShoppingLists();
  const receipts = useReceipts();
  const toggleDose = useToggleDose(today);
  const completeChore = useCompleteChore();
  const scanner = useReceiptScanner();
  const health = useHealthOverview(today);

  const queries = [medications, doses, chores, pantry, lists, receipts, ...health.queries];
  const refreshing = queries.some((q) => q.isRefetching);
  const refresh = () => queries.forEach((q) => q.refetch());

  const taken = new Set((doses.data ?? []).map((d) => doseKey(d.medication_id, d.scheduled_on, d.scheduled_time)));
  const pendingDoses = dosesForDay((medications.data ?? []).map(toSchedule), today).filter(
    (d) => !taken.has(doseKey(d.medicationId, d.date, d.time)),
  );

  const dueChores = (chores.data ?? []).filter((c) => choreStatus(c.due_on, today).kind !== 'proxima');
  const expiring = (pantry.data ?? []).filter((p) => {
    const kind = expiryStatus(p.expires_on, today).kind;
    return kind === 'vencido' || kind === 'vence_logo';
  });
  const drafts = (receipts.data ?? []).filter((r) => r.status === 'draft');
  const activeLists = (lists.data ?? []).filter((l) => l.pending > 0);
  // Só afirma "tudo em dia" depois que tudo carregou.
  const nothingPending =
    queries.every((q) => q.isSuccess) &&
    !pendingDoses.length &&
    !dueChores.length &&
    !expiring.length &&
    !drafts.length &&
    !hasHealthToday(health, today);
  const dateLabel = capitalizeFirst(now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }));
  const nowTime = currentTimeHHMM(now);
  const members = household.data?.members ?? [];

  const onError = (err: unknown) => notify('Erro', errorMessage(err));

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View>
        <Text variant="title">
          {greeting(now)}, {household.data?.me.display_name ?? ''}
        </Text>
        <Text variant="muted">{dateLabel}</Text>
      </View>

      <View style={styles.quickActions}>
        <Tile icon="camera-outline" label="Escanear nota" onPress={scanner.open} />
        <Tile
          icon="cart-outline"
          label="Listas de compras"
          onPress={() => router.push({ pathname: '/casa', params: { aba: 'compras' } })}
        />
        <Tile
          icon="broom"
          label="Nova tarefa"
          onPress={() => router.push({ pathname: '/tarefa/[id]', params: { id: 'nova' } })}
        />
      </View>

      {nothingPending ? (
        <Card>
          <EmptyState
            icon="check-circle-outline"
            title="Tudo em dia"
            message="Nenhum remédio, consulta, tarefa ou validade pedindo atenção agora."
          />
        </Card>
      ) : null}

      {pendingDoses.length ? (
        <Section title="Remédios de hoje">
          <ListCard>
            {pendingDoses.map((d) => (
              <ListRow
                key={doseKey(d.medicationId, d.date, d.time)}
                left={<IconBadge icon="pill" tone={d.time < nowTime ? 'warning' : 'info'} />}
                title={`${d.time} · ${d.name}`}
                subtitle={[d.personName, d.dosage].filter(Boolean).join(' · ')}
                right={
                  <CheckCircle
                    checked={false}
                    label={`Marcar ${d.name} das ${d.time} como tomado`}
                    onPress={() => toggleDose.mutate({ medicationId: d.medicationId, time: d.time, taken: true }, { onError })}
                  />
                }
              />
            ))}
          </ListCard>
        </Section>
      ) : null}

      <HealthTodaySections overview={health} today={today} compact />

      {dueChores.length ? (
        <Section title="Tarefas">
          <ListCard>
            {dueChores.map((chore) => {
              const status = choreStatus(chore.due_on, today);
              const assignee = members.find((m) => m.user_id === chore.assigned_to)?.display_name;
              return (
                <ListRow
                  key={chore.id}
                  left={<IconBadge icon="broom" tone={status.kind === 'atrasada' ? 'danger' : 'primary'} />}
                  title={chore.title}
                  subtitle={[describeChoreStatus(status), assignee].filter(Boolean).join(' · ')}
                  onPress={() => router.push({ pathname: '/tarefa/[id]', params: { id: chore.id } })}
                  right={
                    <CheckCircle
                      checked={false}
                      label={`Concluir ${chore.title}`}
                      onPress={() => completeChore.mutate({ id: chore.id, today }, { onError })}
                    />
                  }
                />
              );
            })}
          </ListCard>
        </Section>
      ) : null}

      {expiring.length ? (
        <Section title="Despensa">
          <ListCard>
            {expiring.slice(0, 6).map((item) => {
              const status = expiryStatus(item.expires_on, today);
              return (
                <ListRow
                  key={item.id}
                  left={<CategoryIcon category={item.category} />}
                  title={item.name}
                  right={<Badge label={describeExpiry(status)} tone={status.kind === 'vencido' ? 'danger' : 'warning'} />}
                  onPress={() => router.push({ pathname: '/despensa/[id]', params: { id: item.id } })}
                />
              );
            })}
            {expiring.length > 6 ? (
              <Button
                title={`Ver todos (${expiring.length})`}
                variant="ghost"
                onPress={() => router.push({ pathname: '/casa', params: { aba: 'despensa' } })}
              />
            ) : null}
          </ListCard>
        </Section>
      ) : null}

      {drafts.length ? (
        <Section title="Notas para revisar">
          <ListCard>
            {drafts.map((r) => (
              <ListRow
                key={r.id}
                left={<IconBadge icon="receipt-text-outline" tone="info" />}
                title={r.store?.name ?? 'Nota sem mercado'}
                subtitle="Confira os itens para entrar no comparativo"
                right={<Badge label="Revisar" tone="info" />}
                onPress={() => router.push({ pathname: '/nota/[id]', params: { id: r.id } })}
              />
            ))}
          </ListCard>
        </Section>
      ) : null}

      {activeLists.length ? (
        <Section title="Listas de compras">
          <ListCard>
            {activeLists.map((l) => (
              <ListRow
                key={l.id}
                left={<IconBadge icon={l.kind === 'farmacia' ? 'pill' : 'cart-outline'} tone="primary" />}
                title={l.name}
                subtitle={`${l.pending} ${l.pending === 1 ? 'item pendente' : 'itens pendentes'}`}
                onPress={() => router.push({ pathname: '/lista/[id]', params: { id: l.id } })}
              />
            ))}
          </ListCard>
        </Section>
      ) : null}

      {scanner.element}
    </Screen>
  );
}

const styles = StyleSheet.create({
  quickActions: { flexDirection: 'row', gap: space.md },
});
