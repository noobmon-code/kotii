import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useBills } from '@/data/finance';
import { todayISO } from '@/domain/dates';
import { BILL_RECURRENCES, billStatus, describeBillStatus, getFinanceCategory, stillToPay } from '@/domain/finance';
import { formatBRL } from '@/domain/money';
import type { Bill } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  CheckCircle,
  EmptyState,
  ErrorNotice,
  IconBadge,
  ListCard,
  ListRow,
  Loading,
  Section,
  Text,
  type Tone,
} from '@/ui/primitives';
import { space } from '@/ui/theme';
import { PayBillModal } from './PayBillModal';

export function billSubtitle(bill: Bill, today: string): string {
  return [
    bill.amount != null ? formatBRL(bill.amount) : 'valor varia',
    bill.active ? describeBillStatus(billStatus(bill.next_due_on, today), bill.next_due_on) : 'encerrada',
    BILL_RECURRENCES.find((r) => r.value === bill.recurrence)?.label.toLowerCase(),
    bill.autopay ? 'débito automático' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Uma conta na lista, com o check de "paguei". */
export function BillRow({ bill, today, onPay }: { bill: Bill; today: string; onPay: (bill: Bill) => void }) {
  const status = billStatus(bill.next_due_on, today);
  const tone: Tone = !bill.active ? 'neutral' : status.kind === 'atrasada' ? 'danger' : status.kind === 'hoje' ? 'warning' : 'primary';
  return (
    <ListRow
      left={<IconBadge icon={getFinanceCategory(bill.category).icon} tone={tone} />}
      title={bill.name}
      subtitle={billSubtitle(bill, today)}
      dimmed={!bill.active}
      onPress={() => router.push({ pathname: '/conta/[id]', params: { id: bill.id } })}
      right={bill.active ? <CheckCircle checked={false} label={`Registrar pagamento de ${bill.name}`} onPress={() => onPay(bill)} /> : null}
    />
  );
}

const GROUPS: { title: string; test: (days: number) => boolean }[] = [
  { title: 'Atrasadas', test: (days) => days < 0 },
  { title: 'Próximos 7 dias', test: (days) => days >= 0 && days <= 7 },
  { title: 'Depois', test: (days) => days > 7 },
];

export function BillsPanel() {
  const today = todayISO();
  const bills = useBills();
  const [paying, setPaying] = useState<Bill | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  if (bills.isPending) return <Loading />;
  if (bills.isError) return <ErrorNotice error={bills.error} onRetry={() => bills.refetch()} />;

  const active = bills.data.filter((b) => b.active);
  const closed = bills.data.filter((b) => !b.active);
  const due = stillToPay(active, today);
  const daysTo = (b: Bill) => {
    const status = billStatus(b.next_due_on, today);
    return status.kind === 'atrasada' ? -status.days : status.kind === 'hoje' ? 0 : status.days;
  };

  return (
    <View style={styles.gap}>
      <Button
        title="Nova conta"
        icon="plus"
        variant="secondary"
        onPress={() => router.push({ pathname: '/conta/[id]', params: { id: 'nova' } })}
      />
      {bills.data.length === 0 ? (
        <EmptyState
          icon="calendar-clock"
          title="Nenhuma conta cadastrada"
          message="Aluguel, condomínio, luz, internet, escola, streaming… A tela Hoje mostra o que vence nos próximos dias e o resumo soma o que já foi pago."
        />
      ) : null}
      {active.length ? (
        <Card style={styles.summary}>
          <Text variant="muted">Ainda vence este mês</Text>
          <Text variant="title">{formatBRL(due.amount)}</Text>
          {due.variable ? (
            <Text variant="small">
              + {due.variable} {due.variable === 1 ? 'conta de valor variável' : 'contas de valor variável'}
            </Text>
          ) : null}
        </Card>
      ) : null}
      {GROUPS.map((group) => {
        const rows = active.filter((b) => group.test(daysTo(b)));
        if (!rows.length) return null;
        return (
          <Section key={group.title} title={group.title}>
            <ListCard>
              {rows.map((bill) => (
                <BillRow key={bill.id} bill={bill} today={today} onPay={setPaying} />
              ))}
            </ListCard>
          </Section>
        );
      })}
      {closed.length ? (
        showClosed ? (
          <Section title="Encerradas">
            <ListCard>
              {closed.map((bill) => (
                <BillRow key={bill.id} bill={bill} today={today} onPay={setPaying} />
              ))}
            </ListCard>
          </Section>
        ) : (
          <Button title={`Ver encerradas (${closed.length})`} variant="ghost" onPress={() => setShowClosed(true)} />
        )
      ) : null}
      {paying ? <PayBillModal bill={paying} onClose={() => setPaying(null)} /> : null}
      {active.some((b) => b.autopay) ? (
        <Badge label="Débito automático também precisa do check: confirme o valor quando cair." tone="info" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.lg },
  summary: { gap: space.xs },
});
