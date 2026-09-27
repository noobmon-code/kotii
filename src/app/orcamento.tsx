import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useBudgets, useSaveBudgets, useSpending } from '@/data/finance';
import { todayISO } from '@/domain/dates';
import { FINANCE_CATEGORIES, monthRange, shiftMonth, summarize } from '@/domain/finance';
import { formatBRL, parseDecimal } from '@/domain/money';
import { errorMessage } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';
import { Button, Card, ErrorNotice, Icon, Loading, Row, Screen, Text, TextField } from '@/ui/primitives';
import { space } from '@/ui/theme';

/** Limite por categoria; o gasto do mês passado ajuda a escolher. */
export default function BudgetScreen() {
  const budgets = useBudgets();
  const lastMonth = shiftMonth(todayISO().slice(0, 7), -1);
  const spending = useSpending(lastMonth, lastMonth);
  const save = useSaveBudgets();
  // Só o que a pessoa editou; o resto mostra o valor salvo.
  const [edits, setEdits] = useState<Record<string, string>>({});

  if (budgets.isPending) return <Loading />;
  if (budgets.isError) return <ErrorNotice error={budgets.error} onRetry={() => budgets.refetch()} />;

  const saved = new Map(budgets.data.map((b) => [b.category, b.monthly_limit]));
  const previous = spending.data ? summarize(spending.data, monthRange(lastMonth)).byCategory : [];
  const valueOf = (key: string) =>
    edits[key] ?? (saved.has(key) ? String(saved.get(key)).replace('.', ',') : '');

  function submit() {
    const limits: Record<string, number | null> = {};
    for (const [key, text] of Object.entries(edits)) {
      const trimmed = text.trim();
      if (!trimmed) {
        if (saved.has(key)) limits[key] = null;
        continue;
      }
      const value = parseDecimal(trimmed);
      if (value === null || value <= 0) {
        notify('Valor inválido', `Confira o limite de ${FINANCE_CATEGORIES.find((c) => c.key === key)?.label}.`);
        return;
      }
      limits[key] = Math.round(value * 100) / 100;
    }
    if (!Object.keys(limits).length) {
      router.back();
      return;
    }
    save.mutate(limits, {
      onSuccess: () => router.back(),
      onError: (err) => notify('Não deu para salvar', errorMessage(err)),
    });
  }

  return (
    <Screen edges={[]}>
      <Text variant="muted">
        Um limite por mês para cada categoria que você quer acompanhar. Deixe em branco para não ter limite. O gasto conta notas,
        contas pagas e gastos avulsos.
      </Text>
      <Card style={styles.card}>
        {FINANCE_CATEGORIES.map((category) => {
          const last = previous.find((p) => p.category === category.key)?.amount;
          return (
            <Row key={category.key} style={styles.row}>
              <Icon name={category.icon} color="textMuted" />
              <View style={styles.flex}>
                <Text variant="label">{category.label}</Text>
                <Text variant="small">{last ? `Mês passado: ${formatBRL(last)}` : 'Sem gasto no mês passado'}</Text>
              </View>
              <View style={styles.input}>
                <TextField
                  value={valueOf(category.key)}
                  onChangeText={(text) => setEdits({ ...edits, [category.key]: text })}
                  placeholder="Sem limite"
                  keyboardType="decimal-pad"
                  accessibilityLabel={`Limite de ${category.label}`}
                />
              </View>
            </Row>
          );
        })}
      </Card>
      <Button title="Salvar" onPress={submit} loading={save.isPending} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: space.md },
  row: { gap: space.md },
  input: { width: 130 },
});
