import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { useBill, useBillPayments, useDeleteBill, useSaveBill, useUndoBillPayment } from '@/data/finance';
import { formatBRDate, parseBRDate, todayISO } from '@/domain/dates';
import { BILL_RECURRENCES, FINANCE_CATEGORIES, type BillRecurrence, type FinanceCategory } from '@/domain/finance';
import { formatBRL, parseDecimal } from '@/domain/money';
import { billSubtitle } from '@/features/finance/BillsPanel';
import { PayBillModal } from '@/features/finance/PayBillModal';
import { useHousehold } from '@/lib/auth';
import { errorMessage } from '@/lib/supabase';
import type { Bill } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import {
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
  TextField,
} from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

export default function BillScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'nova';
  const bill = useBill(isNew ? undefined : id);

  if (!isNew && bill.isPending) return <Loading />;
  if (!isNew && bill.isError) return <ErrorNotice error={bill.error} />;
  const data = isNew ? undefined : bill.data;
  // Pagar ou desfazer muda o vencimento: o formulário recomeça com o valor novo.
  return <BillForm key={data ? `${data.next_due_on}-${data.active}` : 'nova'} bill={data} />;
}

const capitalizeFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const formatAmount = (value: number) => value.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

function BillForm({ bill }: { bill?: Bill }) {
  const c = useColors();
  const save = useSaveBill();
  const remove = useDeleteBill();
  const [name, setName] = useState(bill?.name ?? '');
  const [category, setCategory] = useState<FinanceCategory>((bill?.category as FinanceCategory) ?? 'contas');
  const [variable, setVariable] = useState(bill ? bill.amount == null : false);
  const [amount, setAmount] = useState(bill?.amount != null ? formatAmount(bill.amount) : '');
  const [recurrence, setRecurrence] = useState<BillRecurrence>(bill?.recurrence ?? 'monthly');
  const [due, setDue] = useState(bill ? formatBRDate(bill.next_due_on) : '');
  const [autopay, setAutopay] = useState(bill?.autopay ?? false);
  const [notes, setNotes] = useState(bill?.notes ?? '');
  const [paying, setPaying] = useState(false);

  const onError = (err: unknown) => notify('Erro', errorMessage(err));
  const dueISO = parseBRDate(due);

  function submit() {
    const value = variable ? null : parseDecimal(amount);
    if (!name.trim()) return notify('Informe o nome', 'Ex.: Condomínio, Internet, Escola.');
    if (!variable && value == null) return notify('Informe o valor', 'Ou marque que o valor varia a cada mês.');
    if (!dueISO) return notify('Data inválida', 'Informe o vencimento como dd/mm/aaaa.');
    // Só grava o vencimento se mudou: se outra pessoa pagou enquanto esta tela
    // estava aberta, salvar o resto não pode voltar a conta para trás.
    const dueChanged = !bill || dueISO !== bill.next_due_on;
    save.mutate(
      {
        id: bill?.id,
        values: {
          name: name.trim(),
          category,
          amount: value,
          recurrence,
          autopay,
          notes: notes.trim() || null,
          ...(dueChanged ? { next_due_on: dueISO, due_day: Number(dueISO.slice(8, 10)) } : {}),
        },
      },
      { onSuccess: () => router.back(), onError },
    );
  }

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: bill ? 'Conta' : 'Nova conta' }} />

      {bill ? (
        <Card style={styles.status}>
          <Text variant="muted">{capitalizeFirst(billSubtitle(bill, todayISO()))}</Text>
          {bill.active ? <Button title="Registrar pagamento" icon="check" onPress={() => setPaying(true)} /> : null}
        </Card>
      ) : null}

      <TextField label="Nome" value={name} onChangeText={setName} placeholder="Ex.: Condomínio" autoFocus={!bill} />

      <View style={styles.group}>
        <Text variant="label">Categoria</Text>
        <Row style={styles.wrap}>
          {FINANCE_CATEGORIES.map((cat) => (
            <Chip key={cat.key} label={cat.label} icon={cat.icon} selected={category === cat.key} onPress={() => setCategory(cat.key)} />
          ))}
        </Row>
      </View>

      <View style={styles.group}>
        <Row>
          <View style={styles.flex}>
            <Text variant="label">Valor varia a cada mês</Text>
            <Text variant="small">Luz, água, gás: você informa o valor ao pagar.</Text>
          </View>
          <Switch value={variable} onValueChange={setVariable} trackColor={{ true: c.primary }} />
        </Row>
        {!variable ? (
          <TextField label="Valor" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0,00" />
        ) : null}
      </View>

      <View style={styles.group}>
        <Text variant="label">Repetir</Text>
        <Row style={styles.wrap}>
          {BILL_RECURRENCES.map((r) => (
            <Chip key={r.value} label={r.label} selected={recurrence === r.value} onPress={() => setRecurrence(r.value)} />
          ))}
        </Row>
      </View>

      <TextField
        label={recurrence === 'once' ? 'Vencimento' : 'Próximo vencimento'}
        value={due}
        onChangeText={setDue}
        placeholder="dd/mm/aaaa"
        keyboardType="numbers-and-punctuation"
        hint={
          recurrence === 'monthly' && dueISO && Number(dueISO.slice(8, 10)) > 28
            ? 'Nos meses mais curtos, vence no último dia.'
            : undefined
        }
      />

      <Row>
        <View style={styles.flex}>
          <Text variant="label">Débito automático</Text>
          <Text variant="small">Ainda aparece para você conferir o valor que caiu.</Text>
        </View>
        <Switch value={autopay} onValueChange={setAutopay} trackColor={{ true: c.primary }} />
      </Row>

      <TextField label="Observações" value={notes} onChangeText={setNotes} multiline placeholder="Ex.: código de barras, titular, contrato" />
      <Button title="Salvar" onPress={submit} loading={save.isPending} />

      {bill ? <PaymentHistory bill={bill} /> : null}

      {bill ? (
        <>
          {bill.active && bill.recurrence !== 'once' ? (
            <Button
              title="Encerrar conta"
              variant="secondary"
              icon="archive-outline"
              onPress={() =>
                confirmAction('Encerrar conta', `${bill.name} para de aparecer nos vencimentos. Os pagamentos continuam no resumo.`, 'Encerrar', () =>
                  save.mutate({ id: bill.id, values: { active: false } }, { onSuccess: () => router.back(), onError }),
                )
              }
            />
          ) : null}
          {!bill.active && bill.recurrence !== 'once' ? (
            <Button
              title="Reativar conta"
              variant="secondary"
              icon="restore"
              onPress={() => save.mutate({ id: bill.id, values: { active: true } }, { onError })}
            />
          ) : null}
          <Button
            title="Excluir conta"
            variant="danger"
            icon="trash-can-outline"
            onPress={() =>
              confirmAction(
                'Excluir conta',
                `Excluir ${bill.name} e todos os pagamentos? Eles saem do resumo de gastos. Para só parar de acompanhar, encerre a conta.`,
                'Excluir',
                () => remove.mutate(bill.id, { onSuccess: () => router.back(), onError }),
              )
            }
          />
        </>
      ) : null}

      {paying && bill ? <PayBillModal bill={bill} onClose={() => setPaying(false)} /> : null}
    </Screen>
  );
}

function PaymentHistory({ bill }: { bill: Bill }) {
  const payments = useBillPayments(bill.id);
  const undo = useUndoBillPayment();
  const members = useHousehold().data?.members ?? [];

  if (payments.isPending) return <Loading />;
  if (payments.isError) return <ErrorNotice error={payments.error} onRetry={() => payments.refetch()} />;
  if (!payments.data.length) return null;

  return (
    <Section title="Pagamentos">
      <ListCard>
        {payments.data.map((p, index) => {
          const who = members.find((m) => m.user_id === p.paid_by)?.display_name;
          return (
            <ListRow
              key={p.id}
              title={`Vencimento ${formatBRDate(p.due_on)}`}
              subtitle={[`Pago em ${formatBRDate(p.paid_on)}`, who].filter(Boolean).join(' · ')}
              right={
                <Row>
                  <Text variant="label">{formatBRL(p.amount)}</Text>
                  {index === 0 ? (
                    <IconButton
                      icon="undo-variant"
                      label="Desfazer pagamento"
                      onPress={() =>
                        confirmAction(
                          'Desfazer pagamento',
                          `O vencimento volta para ${formatBRDate(p.due_on)} e o valor sai do resumo do mês.`,
                          'Desfazer',
                          () => undo.mutate(p.id, { onError: (err) => notify('Erro', errorMessage(err)) }),
                        )
                      }
                    />
                  ) : null}
                </Row>
              }
            />
          );
        })}
      </ListCard>
    </Section>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: { gap: space.sm },
  wrap: { flexWrap: 'wrap' },
  status: { gap: space.md },
});
