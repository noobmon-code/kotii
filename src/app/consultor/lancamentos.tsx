import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  useBeta,
  useFinanceData,
  useRemoveCategoryRules,
  useSetCategoryRule,
  type FinanceData,
} from '@/data/financeBeta';
import { accountLabels, groupPurchases, type BankPurchase } from '@/domain/bankMonth';
import { categoryRulesOf, purchaseRuleKey } from '@/domain/bankRules';
import { todayISO } from '@/domain/dates';
import { FINANCE_CATEGORIES, getFinanceCategory, monthLabel, shiftMonth, type FinanceCategory } from '@/domain/finance';
import { formatBRL } from '@/domain/money';
import { purchaseDetails, purchaseTitle } from '@/features/finance/bankPurchaseText';
import { errorMessage } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorNotice,
  IconBadge,
  IconButton,
  ListCard,
  ListRow,
  Loading,
  Row,
  Screen,
  Section,
  Segmented,
  Text,
} from '@/ui/primitives';
import { space } from '@/ui/theme';

/** Meses que dá para olhar: o atual e os dois anteriores (a janela buscada), como no resumo. */
const MONTHS_BACK = 2;

type Filter = FinanceCategory | 'todas';
type Scope = 'parecidas' | 'esta';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const isCategory = (value: unknown): value is FinanceCategory =>
  typeof value === 'string' && FINANCE_CATEGORIES.some((c) => c.key === value);

/** Lançamentos do banco de um mês, para ver o que é cada saída e escolher a categoria. */
export default function LancamentosScreen() {
  const beta = useBeta('finance');
  if (beta.data === true) return <Lancamentos />;
  if (beta.isError && beta.data === undefined) {
    return (
      <Screen edges={[]}>
        <ErrorNotice error={beta.error} onRetry={() => beta.refetch()} />
      </Screen>
    );
  }
  if (beta.data === undefined) {
    return (
      <Screen edges={[]}>
        <Loading />
      </Screen>
    );
  }
  return (
    <Screen edges={[]}>
      <EmptyState
        icon="lock-outline"
        tint="purple"
        mood="calm"
        title="Consultor ainda não liberado"
        message="O consultor financeiro está em teste e, por enquanto, só abre para quem foi convidado, em cada casa."
        action={<Button title="Voltar" variant="secondary" onPress={() => router.back()} />}
      />
    </Screen>
  );
}

function Lancamentos() {
  const params = useLocalSearchParams<{ mes?: string; categoria?: string }>();
  const today = todayISO();
  const current = today.slice(0, 7);
  const first = shiftMonth(current, -MONTHS_BACK);
  const [month, setMonth] = useState(() =>
    params.mes && /^\d{4}-\d{2}$/.test(params.mes) && params.mes >= first && params.mes <= current ? params.mes : current,
  );
  const [filter, setFilter] = useState<Filter>(() => (isCategory(params.categoria) ? params.categoria : 'todas'));
  const [open, setOpen] = useState<string | null>(null);
  const finance = useFinanceData(today);
  const data = finance.status === 'ready' ? finance.data : null;
  const view = useMemo(() => (data ? buildView(data) : null), [data]);

  const spending = useMemo(
    () => (view ? view.spending.filter((p) => p.date.slice(0, 7) === month) : []),
    [view, month],
  );
  const byCategory = useMemo(() => totalsByCategory(spending), [spending]);
  const shown = filter === 'todas' ? spending : spending.filter((p) => p.category === filter);
  const others = byCategory.find((c) => c.category === 'outros');
  const name = monthLabel(month).split(' ')[0];

  if (finance.status === 'error') {
    return (
      <Screen edges={[]}>
        <ErrorNotice error={finance.error} onRetry={finance.retry} />
      </Screen>
    );
  }
  if (!view) {
    return (
      <Screen edges={[]}>
        <Loading label="Carregando seus lançamentos…" />
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <Section
        title={`Saídas de ${name}`}
        action={
          <Row gap={0}>
            {month > first ? (
              <IconButton
                icon="chevron-left"
                label="Mês anterior"
                onPress={() => {
                  setMonth(shiftMonth(month, -1));
                  setOpen(null);
                }}
              />
            ) : null}
            {month < current ? (
              <IconButton
                icon="chevron-right"
                label="Próximo mês"
                onPress={() => {
                  setMonth(shiftMonth(month, 1));
                  setOpen(null);
                }}
              />
            ) : null}
          </Row>
        }>
        <Text variant="small">
          Toque numa saída para ver o que é e escolher a categoria. Dá para escolher só para ela ou para todas as
          parecidas (a mesma loja ou a mesma pessoa do PIX), inclusive as que ainda vão chegar. Só você vê essas
          escolhas, e o Nuke passa a usar as suas categorias.
        </Text>
        {others && filter !== 'outros' ? (
          <Card style={styles.gap}>
            <Text variant="label">
              {plural(others.count, 'saída', 'saídas')} em Outros, somando {formatBRL(others.amount)}.
            </Text>
            <Button title="Ver só Outros" variant="secondary" compact onPress={() => setFilter('outros')} />
          </Card>
        ) : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label={`Todas (${spending.length})`} selected={filter === 'todas'} onPress={() => setFilter('todas')} />
          {byCategory.map((c) => {
            const info = getFinanceCategory(c.category);
            return (
              <Chip
                key={c.category}
                label={`${info.label} (${c.count})`}
                icon={info.icon}
                selected={filter === c.category}
                onPress={() => setFilter(c.category)}
              />
            );
          })}
        </ScrollView>
      </Section>

      {shown.length ? (
        <ListCard>
          {shown.map((p) => (
            <PurchaseRow
              key={p.key}
              purchase={p}
              labels={view.labels}
              similarCount={p.similarKey ? (view.similarCounts.get(p.similarKey) ?? 1) : 0}
              open={open === p.key}
              onToggle={() => setOpen(open === p.key ? null : p.key)}
              onChosen={() => setOpen(null)}
            />
          ))}
        </ListCard>
      ) : (
        <Text variant="muted">
          {filter === 'todas'
            ? `Nenhuma saída em ${name}.`
            : `Nenhuma saída em ${getFinanceCategory(filter).label} em ${name}.`}
        </Text>
      )}
      {filter !== 'todas' ? (
        <Button title="Ver todas as saídas" variant="ghost" compact onPress={() => setFilter('todas')} />
      ) : null}
    </Screen>
  );
}

function buildView(data: FinanceData) {
  const purchases = groupPurchases(data.transactions, data.accounts, undefined, categoryRulesOf(data.categoryRules));
  const spending = purchases.filter((p) => p.kind === 'spending');
  // Quantas saídas cada regra de "parecidas" mudaria (em todos os meses buscados).
  const similarCounts = new Map<string, number>();
  for (const p of spending) if (p.similarKey) similarCounts.set(p.similarKey, (similarCounts.get(p.similarKey) ?? 0) + 1);
  return { spending, similarCounts, labels: accountLabels(data.accounts, data.connections) };
}

/** Saídas por categoria, Outros primeiro (é o que pede ajuda), depois da maior para a menor. */
function totalsByCategory(spending: BankPurchase[]) {
  const totals = new Map<FinanceCategory, { amount: number; count: number }>();
  for (const p of spending) {
    const t = totals.get(p.category) ?? { amount: 0, count: 0 };
    totals.set(p.category, { amount: t.amount + p.amount, count: t.count + 1 });
  }
  return [...totals]
    .map(([category, t]) => ({ category, ...t }))
    .sort((a, b) => Number(b.category === 'outros') - Number(a.category === 'outros') || b.amount - a.amount);
}

function sourceLabel(p: BankPurchase): string | null {
  if (p.categorySource === 'manual') return 'você escolheu para esta';
  if (p.categorySource === 'similar') return 'você escolheu para as parecidas';
  return null;
}

function PurchaseRow({
  purchase: p,
  labels,
  similarCount,
  open,
  onToggle,
  onChosen,
}: {
  purchase: BankPurchase;
  labels: Map<string, string>;
  similarCount: number;
  open: boolean;
  onToggle: () => void;
  onChosen: () => void;
}) {
  const info = getFinanceCategory(p.category);
  const source = sourceLabel(p);
  return (
    <View>
      <ListRow
        left={<IconBadge icon={info.icon} tone={p.category === 'outros' ? 'warning' : 'neutral'} size={36} />}
        title={purchaseTitle(p)}
        subtitle={
          <View>
            <Text variant="muted">{purchaseDetails(p, labels)}</Text>
            <Text variant="small">{[info.label, source].filter(Boolean).join(' · ')}</Text>
          </View>
        }
        right={<Text variant="label">{formatBRL(p.amount)}</Text>}
        onPress={onToggle}
      />
      {open ? <CategoryEditor purchase={p} similarCount={similarCount} onChosen={onChosen} /> : null}
    </View>
  );
}

function CategoryEditor({
  purchase: p,
  similarCount,
  onChosen,
}: {
  purchase: BankPurchase;
  similarCount: number;
  onChosen: () => void;
}) {
  const setRule = useSetCategoryRule();
  const removeRules = useRemoveCategoryRules();
  const [scope, setScope] = useState<Scope>(p.similarKey && p.categorySource !== 'manual' ? 'parecidas' : 'esta');
  const busy = setRule.isPending || removeRules.isPending;
  const ownKey = purchaseRuleKey(p.key);
  const similarWho = p.similarKey?.startsWith('doc:') ? 'todo PIX para esta pessoa' : 'tudo com este nome';

  async function choose(category: FinanceCategory) {
    try {
      if (scope === 'parecidas' && p.similarKey) {
        await setRule.mutateAsync({ matchKey: p.similarKey, category });
        // A escolha só para esta compra passaria na frente da das parecidas.
        if (p.categorySource === 'manual') await removeRules.mutateAsync([ownKey]);
      } else {
        await setRule.mutateAsync({ matchKey: ownKey, category });
      }
      onChosen();
    } catch (err) {
      notify('Não deu para salvar', errorMessage(err));
    }
  }

  async function undo() {
    const key = p.categorySource === 'manual' ? ownKey : p.similarKey;
    if (!key) return;
    try {
      await removeRules.mutateAsync([key]);
      onChosen();
    } catch (err) {
      notify('Não deu para desfazer', errorMessage(err));
    }
  }

  return (
    <View style={styles.editor}>
      {p.description !== purchaseTitle(p) ? <Text variant="small">No banco: {p.description}</Text> : null}
      {p.categorySource !== 'auto' && p.autoCategory !== p.category ? (
        <Text variant="small">O consultor tinha posto em {getFinanceCategory(p.autoCategory).label}.</Text>
      ) : null}
      {p.similarKey ? (
        <Segmented<Scope>
          options={[
            { value: 'parecidas', label: `Parecidas (${similarCount})` },
            { value: 'esta', label: 'Só esta' },
          ]}
          value={scope}
          onChange={setScope}
        />
      ) : null}
      <Text variant="small">
        {scope === 'parecidas' && p.similarKey
          ? `Vale para ${similarWho}, inclusive o que ainda vai chegar.`
          : 'Vale só para esta saída.'}
      </Text>
      <Row style={styles.wrap}>
        {FINANCE_CATEGORIES.map((cat) => (
          <Chip
            key={cat.key}
            label={cat.label}
            icon={cat.icon}
            selected={p.category === cat.key}
            onPress={busy ? undefined : () => choose(cat.key)}
          />
        ))}
      </Row>
      {p.categorySource !== 'auto' ? (
        <Button
          title={
            p.categorySource === 'manual' ? 'Desfazer a escolha desta saída' : 'Desfazer a escolha das parecidas'
          }
          variant="ghost"
          compact
          disabled={busy}
          onPress={undo}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.sm },
  chips: { gap: space.sm, paddingVertical: 2 },
  wrap: { flexWrap: 'wrap' },
  editor: { gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.lg },
});
