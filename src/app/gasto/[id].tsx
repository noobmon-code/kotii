import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useDeleteExpense, useExpense, useSaveExpense } from '@/data/finance';
import { formatBRDate, parseBRDate, todayISO } from '@/domain/dates';
import { FINANCE_CATEGORIES, type FinanceCategory } from '@/domain/finance';
import { parseDecimal } from '@/domain/money';
import { errorMessage } from '@/lib/supabase';
import type { Expense } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import { Button, Chip, DateField, ErrorNotice, Loading, Row, Screen, Text, TextField } from '@/ui/primitives';
import { space } from '@/ui/theme';

export default function ExpenseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'novo';
  const expense = useExpense(isNew ? undefined : id);

  if (!isNew && expense.isPending) return <Loading />;
  if (!isNew && expense.isError) return <ErrorNotice error={expense.error} />;
  return <ExpenseForm expense={isNew ? undefined : expense.data} />;
}

function ExpenseForm({ expense }: { expense?: Expense }) {
  const save = useSaveExpense();
  const remove = useDeleteExpense();
  const [description, setDescription] = useState(expense?.description ?? '');
  const [amount, setAmount] = useState(
    expense ? expense.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '',
  );
  const [date, setDate] = useState(formatBRDate(expense?.spent_on ?? todayISO()));
  const [category, setCategory] = useState<FinanceCategory>((expense?.category as FinanceCategory) ?? 'outros');
  const [notes, setNotes] = useState(expense?.notes ?? '');

  const onError = (err: unknown) => notify('Erro', errorMessage(err));

  function submit() {
    const value = parseDecimal(amount);
    const spentOn = parseBRDate(date);
    if (!description.trim()) return notify('Descreva o gasto', 'Ex.: Feira, Farmácia, Conserto da máquina.');
    if (value == null || value <= 0) return notify('Informe o valor', 'Use um valor como 86,50.');
    if (!spentOn) return notify('Data inválida', 'Use dd/mm/aaaa.');
    save.mutate(
      {
        id: expense?.id,
        values: { description: description.trim(), amount: value, spent_on: spentOn, category, notes: notes.trim() || null },
      },
      { onSuccess: () => router.back(), onError },
    );
  }

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: expense ? 'Gasto' : 'Novo gasto' }} />
      <Text variant="muted">Para o que não tem nota fiscal: feira, farmácia, conserto, presente…</Text>
      <TextField label="Descrição" value={description} onChangeText={setDescription} placeholder="Ex.: Feira" autoFocus={!expense} />
      <Row style={styles.top}>
        <View style={styles.flex}>
          <TextField label="Valor" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0,00" />
        </View>
        <View style={styles.flex}>
          <DateField label="Data" value={date} onChangeText={setDate} />
        </View>
      </Row>
      <View style={styles.group}>
        <Text variant="label">Categoria</Text>
        <Row style={styles.wrap}>
          {FINANCE_CATEGORIES.map((cat) => (
            <Chip key={cat.key} label={cat.label} icon={cat.icon} selected={category === cat.key} onPress={() => setCategory(cat.key)} />
          ))}
        </Row>
      </View>
      <TextField label="Observações" value={notes} onChangeText={setNotes} multiline />
      <Button title="Salvar" onPress={submit} loading={save.isPending} />
      {expense ? (
        <Button
          title="Excluir gasto"
          variant="danger"
          icon="trash-can-outline"
          onPress={() =>
            confirmAction('Excluir gasto', `Excluir "${expense.description}"?`, 'Excluir', () =>
              remove.mutate(expense.id, { onSuccess: () => router.back(), onError }),
            )
          }
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { alignItems: 'flex-start' },
  group: { gap: space.sm },
  wrap: { flexWrap: 'wrap' },
});
