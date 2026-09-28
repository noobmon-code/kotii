import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { budgetProgress, describeBudget, type BudgetLine } from '@/domain/budget';
import { getFinanceCategory, type Summary } from '@/domain/finance';
import type { Budget } from '@/lib/types';
import { Button, Card, Icon, Row, Section, Text } from '@/ui/primitives';
import { radius, space, useColors, type Colors } from '@/ui/theme';

const STATUS_COLOR: Record<BudgetLine['status'], keyof Colors> = { ok: 'primary', perto: 'warning', estourou: 'danger' };

/** No resumo do mês: quanto de cada limite já foi. */
export function BudgetSection({ budgets, byCategory }: { budgets: Budget[]; byCategory: Summary['byCategory'] }) {
  const c = useColors();
  const edit = () => router.push('/orcamento');

  if (!budgets.length) {
    return (
      <Card style={styles.empty}>
        <Row>
          <Icon name="target" color="primary" />
          <Text variant="body" style={styles.flex}>
            Quer um limite para o mercado, o lazer ou o delivery? Defina um orçamento por categoria.
          </Text>
        </Row>
        <Button title="Definir orçamento" variant="secondary" compact onPress={edit} />
      </Card>
    );
  }

  return (
    <Section title="Orçamento" action={<Button title="Editar" variant="ghost" compact onPress={edit} />}>
      <Card style={styles.card}>
        {budgetProgress(budgets, byCategory).map((line) => {
          const info = getFinanceCategory(line.category);
          const color = c[STATUS_COLOR[line.status]];
          return (
            <View key={line.category} style={styles.line} accessible accessibilityLabel={`${info.label}: ${describeBudget(line)}`}>
              <Row>
                <Icon name={info.icon} size={18} color="textMuted" />
                <Text variant="label" style={styles.flex}>
                  {info.label}
                </Text>
                {line.status !== 'ok' ? (
                  <Text variant="small" color={STATUS_COLOR[line.status]}>
                    {line.status === 'estourou' ? 'Passou do limite' : 'Perto do limite'}
                  </Text>
                ) : null}
              </Row>
              <View style={[styles.track, { backgroundColor: c.surfaceAlt }]}>
                <View style={[styles.fill, { width: `${Math.min(100, line.ratio * 100)}%`, backgroundColor: color }]} />
              </View>
              <Text variant="small">{describeBudget(line)}</Text>
            </View>
          );
        })}
      </Card>
    </Section>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  empty: { gap: space.md },
  card: { gap: space.lg },
  line: { gap: 6 },
  track: { height: 10, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 10, borderRadius: radius.pill },
});
