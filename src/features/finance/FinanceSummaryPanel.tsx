import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useBills, useSpending } from '@/data/finance';
import { formatShortDate, todayISO } from '@/domain/dates';
import {
  describeMonthDelta,
  getFinanceCategory,
  monthLabel,
  monthlyTotals,
  monthRange,
  monthShortLabel,
  previousMonth,
  shiftMonth,
  stillToPay,
  summarize,
  type Entry,
  type FinanceCategory,
} from '@/domain/finance';
import { formatBRL } from '@/domain/money';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorNotice,
  Icon,
  IconBadge,
  IconButton,
  ListCard,
  ListRow,
  Loading,
  Row,
  Section,
  Text,
} from '@/ui/primitives';
import { fonts, space, useColors } from '@/ui/theme';

const MONTHS_SHOWN = 6;
const COLUMN_HEIGHT = 72;
const ENTRIES_SHOWN = 30;

const SOURCE_LABEL: Record<Entry['source'], string> = {
  nota: 'Nota fiscal',
  conta: 'Conta paga',
  gasto: 'Gasto avulso',
};

const capitalizeFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function openEntry(entry: Entry) {
  if (entry.source === 'nota') router.push({ pathname: '/nota/[id]', params: { id: entry.refId } });
  else if (entry.source === 'conta') router.push({ pathname: '/conta/[id]', params: { id: entry.refId } });
  else router.push({ pathname: '/gasto/[id]', params: { id: entry.refId } });
}

export function FinanceSummaryPanel() {
  const today = todayISO();
  const current = today.slice(0, 7);
  // As colunas mostram os 6 meses até `windowEnd`; o mês escolhido fica dentro delas.
  const [month, setMonth] = useState(current);
  const [windowEnd, setWindowEnd] = useState(current);
  const [category, setCategory] = useState<FinanceCategory | null>(null);
  // Um mês a mais que as colunas, para comparar o primeiro com o anterior.
  const spending = useSpending(shiftMonth(windowEnd, -MONTHS_SHOWN), windowEnd);
  const bills = useBills();

  function goTo(target: string) {
    if (target > current) return;
    setMonth(target);
    setCategory(null);
    if (target > windowEnd) setWindowEnd(target);
    else if (target <= shiftMonth(windowEnd, -MONTHS_SHOWN)) setWindowEnd(shiftMonth(target, MONTHS_SHOWN - 1));
  }

  const newExpense = (
    <Button
      title="Registrar gasto"
      icon="plus"
      variant="secondary"
      onPress={() => router.push({ pathname: '/gasto/[id]', params: { id: 'novo' } })}
    />
  );

  if (spending.isPending) return <Loading />;
  if (spending.isError) return <ErrorNotice error={spending.error} onRetry={() => spending.refetch()} />;

  const entries = spending.data;
  const range = monthRange(month);
  const summary = summarize(entries, range);
  const months = Array.from({ length: MONTHS_SHOWN }, (_, i) => shiftMonth(windowEnd, i - MONTHS_SHOWN + 1));
  const totals = monthlyTotals(entries, months);
  const delta = describeMonthDelta(summary.total, previousMonth(entries, month, today));
  const monthEntries = entries.filter((e) => e.date >= range.start && e.date < range.end);
  const visible = category ? monthEntries.filter((e) => e.category === category) : monthEntries;
  const places = summarize(visible, range).byPlace.slice(0, 5);
  const due = month === current && bills.data ? stillToPay(bills.data, today) : null;
  const monthName = monthLabel(month).split(' ')[0];

  return (
    <View style={styles.gap}>
      {newExpense}

      <Row style={styles.monthNav}>
        <IconButton icon="chevron-left" label="Mês anterior" onPress={() => goTo(shiftMonth(month, -1))} />
        <Text variant="label" style={styles.monthTitle}>
          {capitalizeFirst(monthLabel(month))}
        </Text>
        {month < current ? (
          <IconButton icon="chevron-right" label="Próximo mês" onPress={() => goTo(shiftMonth(month, 1))} />
        ) : (
          <View style={styles.navPlaceholder} />
        )}
      </Row>

      <Card style={styles.hero}>
        <Text variant="muted">{month === current ? `Gastos de ${monthName} até hoje` : `Gastos de ${monthName}`}</Text>
        <Text variant="title">{formatBRL(summary.total)}</Text>
        {delta ? <Text variant="small">{delta}</Text> : null}
        <MonthColumns totals={totals} selected={month} onSelect={goTo} />
      </Card>

      {due && (due.amount > 0 || due.variable > 0) ? (
        <Card style={styles.dueCard}>
          <View style={styles.flex}>
            <Text variant="muted">Ainda vence este mês</Text>
            <Text variant="heading">{formatBRL(due.amount)}</Text>
            {due.variable ? (
              <Text variant="small">
                + {due.variable} {due.variable === 1 ? 'conta de valor variável' : 'contas de valor variável'}
              </Text>
            ) : null}
          </View>
          <Button title="Ver contas" variant="ghost" compact onPress={() => router.setParams({ aba: 'contas' })} />
        </Card>
      ) : null}

      {monthEntries.length === 0 ? (
        <EmptyState
          icon="wallet-outline"
          title={`Nada lançado em ${monthName}`}
          message="Os gastos aparecem aqui quando você confirma uma nota fiscal, marca uma conta como paga ou registra um gasto avulso."
        />
      ) : (
        <>
          <Section title="Por categoria">
            <Card style={styles.bars}>
              <CategoryBars items={summary.byCategory} total={summary.total} selected={category} onSelect={setCategory} />
            </Card>
          </Section>

          {places.length > 1 ? (
            <Section title="Onde mais gastou">
              <ListCard>
                {places.map((p) => (
                  <ListRow key={p.name} title={p.name} right={<Text variant="label">{formatBRL(p.amount)}</Text>} />
                ))}
              </ListCard>
            </Section>
          ) : null}

          <Section
            title="Lançamentos"
            action={
              category ? (
                <Chip label={getFinanceCategory(category).label} icon="close" selected onPress={() => setCategory(null)} />
              ) : null
            }>
            <ListCard>
              {visible.slice(0, ENTRIES_SHOWN).map((entry) => (
                <ListRow
                  key={entry.id}
                  left={<IconBadge icon={getFinanceCategory(entry.category).icon} />}
                  title={entry.description}
                  subtitle={`${formatShortDate(entry.date)} · ${SOURCE_LABEL[entry.source]}${category ? '' : ` · ${getFinanceCategory(entry.category).label}`}`}
                  right={<Text variant="label">{formatBRL(entry.amount)}</Text>}
                  onPress={() => openEntry(entry)}
                />
              ))}
            </ListCard>
            {visible.length > ENTRIES_SHOWN ? (
              <Text variant="small">
                Mostrando os {ENTRIES_SHOWN} mais recentes de {visible.length}.
              </Text>
            ) : null}
          </Section>
        </>
      )}
    </View>
  );
}

/** Total de cada mês; o escolhido em destaque, os outros em cinza. Toque escolhe o mês. */
function MonthColumns({
  totals,
  selected,
  onSelect,
}: {
  totals: { month: string; total: number }[];
  selected: string;
  onSelect: (month: string) => void;
}) {
  const c = useColors();
  const max = Math.max(0, ...totals.map((t) => t.total));
  return (
    <View style={styles.columns}>
      {totals.map((t) => {
        const isSelected = t.month === selected;
        const height = max > 0 && t.total > 0 ? Math.max(2, (t.total / max) * COLUMN_HEIGHT) : 0;
        return (
          <Pressable
            key={t.month}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={`${monthLabel(t.month)}: ${formatBRL(t.total)}`}
            onPress={() => onSelect(t.month)}
            style={styles.columnSlot}>
            <View style={[styles.columnArea, { borderBottomColor: c.border }]}>
              <View
                style={[
                  styles.column,
                  { height, backgroundColor: isSelected ? c.primary : c.textMuted, opacity: isSelected ? 1 : 0.35 },
                ]}
              />
            </View>
            <Text variant="small" color={isSelected ? 'text' : 'textMuted'} style={isSelected && styles.bold}>
              {monthShortLabel(t.month)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Barras horizontais de uma cor só; toque filtra os lançamentos pela categoria. */
function CategoryBars({
  items,
  total,
  selected,
  onSelect,
}: {
  items: { category: FinanceCategory; amount: number }[];
  total: number;
  selected: FinanceCategory | null;
  onSelect: (category: FinanceCategory | null) => void;
}) {
  const c = useColors();
  const max = items[0]?.amount ?? 0;
  return items.map(({ category, amount }) => {
    const info = getFinanceCategory(category);
    const isSelected = selected === category;
    const muted = selected !== null && !isSelected;
    const share = total > 0 ? Math.round((amount / total) * 100) : 0;
    const width = max > 0 ? Math.max(1, (amount / max) * 100) : 0;
    return (
      <Pressable
        key={category}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected }}
        accessibilityLabel={`${info.label}: ${formatBRL(amount)}, ${share}% do mês`}
        onPress={() => onSelect(isSelected ? null : category)}
        style={styles.barRow}>
        <Row>
          <Icon name={info.icon} size={18} color="textMuted" />
          <Text variant="body" style={styles.flex} numberOfLines={1}>
            {info.label}
          </Text>
          <Text variant="label">{formatBRL(amount)}</Text>
          <Text variant="small" style={styles.share}>
            {share}%
          </Text>
        </Row>
        <View
          style={[
            styles.bar,
            { width: `${width}%`, backgroundColor: muted ? c.textMuted : c.primary, opacity: muted ? 0.35 : 1 },
          ]}
        />
      </Pressable>
    );
  });
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space.lg },
  bold: { fontFamily: fonts.heavy },
  monthNav: { justifyContent: 'space-between' },
  monthTitle: { flex: 1, textAlign: 'center' },
  navPlaceholder: { width: 30 },
  hero: { gap: space.xs },
  dueCard: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  columns: { flexDirection: 'row', marginTop: space.md },
  columnSlot: { flex: 1, alignItems: 'center', gap: space.xs },
  columnArea: {
    alignSelf: 'stretch',
    height: COLUMN_HEIGHT,
    justifyContent: 'flex-end',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // Topo arredondado (ponta do dado), base reta no eixo.
  column: { width: 20, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  bars: { gap: space.md },
  barRow: { gap: 6 },
  share: { width: 36, textAlign: 'right' },
  // Começa reta no eixo, ponta arredondada.
  bar: { height: 8, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
});
