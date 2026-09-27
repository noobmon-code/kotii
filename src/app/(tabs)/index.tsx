import { router } from 'expo-router';
import { useState } from 'react';
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
import { useBills } from '@/data/finance';
import { useDocuments, useEquipmentList } from '@/data/house';
import { useShoppingLists } from '@/data/market';
import { useReceipts } from '@/data/receipts';
import { choreStatus, describeChoreStatus } from '@/domain/chores';
import { todayISO } from '@/domain/dates';
import { describeDocumentStatus, documentsNeedingAttention, getDocumentKind } from '@/domain/documents';
import { billsDueSoon } from '@/domain/finance';
import { describeWarranty, getEquipmentCategory, warrantyStatus } from '@/domain/equipment';
import { currentTimeHHMM, doseKey, dosesForDay } from '@/domain/medications';
import { describeExpiry, expiryStatus } from '@/domain/pantry';
import { BillRow } from '@/features/finance/BillsPanel';
import { PayBillModal } from '@/features/finance/PayBillModal';
import { hasHealthToday, healthTodayCount, HealthTodaySections } from '@/features/health/HealthTodaySections';
import { useHealthOverview } from '@/features/health/useHealthOverview';
import { useReceiptScanner } from '@/features/ReceiptScanner';
import { useHousehold } from '@/lib/auth';
import type { Bill } from '@/lib/types';
import { errorMessage } from '@/lib/supabase';
import { periodOf, SkyArt, type Period } from '@/ui/art';
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
import { radius, space, useTint, type Tint } from '@/ui/theme';

const capitalizeFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function greeting(now: Date): string {
  const h = now.getHours();
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

const HERO_TINT: Record<Period, Tint> = { morning: 'yellow', afternoon: 'orange', night: 'purple' };

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
  const documents = useDocuments();
  const equipment = useEquipmentList();
  const bills = useBills();
  const [paying, setPaying] = useState<Bill | null>(null);

  const queries = [medications, doses, chores, pantry, lists, receipts, documents, equipment, bills, ...health.queries];
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
  const documentsDue = documentsNeedingAttention(documents.data ?? [], today);
  const billsDue = billsDueSoon(bills.data ?? [], today);
  const warrantiesEnding = (equipment.data ?? [])
    .map((item) => ({ item, status: warrantyStatus(item.warranty_until, today) }))
    .filter(({ status }) => status.kind === 'acabando');
  const equipmentName = (id: string | null) => (id ? equipment.data?.find((e) => e.id === id)?.name : undefined);
  const activeLists = (lists.data ?? []).filter((l) => l.pending > 0);
  // Só afirma "tudo em dia" depois que tudo carregou.
  const nothingPending =
    queries.every((q) => q.isSuccess) &&
    !pendingDoses.length &&
    !dueChores.length &&
    !billsDue.length &&
    !expiring.length &&
    !drafts.length &&
    !documentsDue.length &&
    !warrantiesEnding.length &&
    !hasHealthToday(health, today);
  const dateLabel = capitalizeFirst(now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }));
  const period = periodOf(now);
  const hero = useTint(HERO_TINT[period]);
  const attention =
    pendingDoses.length +
    dueChores.length +
    billsDue.length +
    expiring.length +
    documentsDue.length +
    warrantiesEnding.length +
    drafts.length +
    healthTodayCount(health, today);
  const summary = nothingPending
    ? 'Tudo em dia por aqui.'
    : attention > 0
      ? `${attention} ${attention === 1 ? 'coisa pede' : 'coisas pedem'} sua atenção.`
      : 'Veja o que tem para hoje.';
  const nowTime = currentTimeHHMM(now);
  const members = household.data?.members ?? [];

  const onError = (err: unknown) => notify('Erro', errorMessage(err));

  return (
    <Screen fab refreshing={refreshing} onRefresh={refresh}>
      <View style={[styles.hero, { backgroundColor: hero.bg }]}>
        <View style={styles.heroText}>
          <Text variant="small">{dateLabel}</Text>
          <Text variant="display">
            {greeting(now)},{'\n'}
            {household.data?.me.display_name ?? ''}
          </Text>
          <Text variant="body">{summary}</Text>
        </View>
        <SkyArt period={period} size={104} />
      </View>

      <View style={styles.quickActions}>
        <Tile icon="camera-outline" tint="orange" label="Escanear nota" onPress={scanner.open} />
        <Tile
          icon="cart-outline"
          tint="blue"
          label="Listas de compras"
          onPress={() => router.push({ pathname: '/casa', params: { aba: 'compras' } })}
        />
        <Tile
          icon="broom"
          tint="green"
          label="Nova tarefa"
          onPress={() => router.push({ pathname: '/tarefa/[id]', params: { id: 'nova' } })}
        />
      </View>

      {nothingPending ? (
        <Card>
          <EmptyState
            icon="check-circle-outline"
            tint="green"
            mood="calm"
            title="Tudo em dia"
            message="Nenhum remédio, consulta, tarefa, conta, validade ou documento pedindo atenção agora."
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
                  subtitle={[describeChoreStatus(status), equipmentName(chore.equipment_id), assignee].filter(Boolean).join(' · ')}
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

      {billsDue.length ? (
        <Section title="Contas">
          <ListCard>
            {billsDue.map((bill) => (
              <BillRow key={bill.id} bill={bill} today={today} onPay={setPaying} />
            ))}
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

      {documentsDue.length ? (
        <Section title="Documentos">
          <ListCard>
            {documentsDue.map(({ document, status }) => (
              <ListRow
                key={document.id}
                left={<IconBadge icon={getDocumentKind(document.kind).icon} tone={status.kind === 'vencido' ? 'danger' : 'warning'} />}
                title={document.title}
                subtitle={describeDocumentStatus(status, document.expires_on)}
                right={<Badge label={status.kind === 'vencido' ? 'Vencido' : 'Renovar'} tone={status.kind === 'vencido' ? 'danger' : 'warning'} />}
                onPress={() => router.push({ pathname: '/documento/[id]', params: { id: document.id } })}
              />
            ))}
          </ListCard>
        </Section>
      ) : null}

      {warrantiesEnding.length ? (
        <Section title="Garantias acabando">
          <ListCard>
            {warrantiesEnding.map(({ item, status }) => (
              <ListRow
                key={item.id}
                left={<IconBadge icon={getEquipmentCategory(item.category).icon} tone="warning" />}
                title={item.name}
                subtitle={`${describeWarranty(status)} · teste tudo e acione a assistência se precisar`}
                onPress={() => router.push({ pathname: '/aparelho/[id]', params: { id: item.id } })}
              />
            ))}
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
      {paying ? <PayBillModal bill={paying} onClose={() => setPaying(null)} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.xl,
    padding: space.xl,
    paddingRight: space.md,
  },
  heroText: { flex: 1, gap: space.xs },
  quickActions: { flexDirection: 'row', gap: space.md },
});
