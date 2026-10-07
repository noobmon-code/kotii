import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import {
  useAddFinItem,
  useBeta,
  useFinanceData,
  useRemoveFinConnection,
  useSyncFinance,
  type FinanceData,
} from '@/data/financeBeta';
import { connectionWarnings, type ConnectionWarning } from '@/domain/bankHealth';
import {
  matchBankToNooky,
  reconciliationInRange,
  reconciliationTotals,
  type NookyRecord,
  type Reconciliation,
} from '@/domain/bankMatch';
import {
  accountLabels,
  cardBills,
  currentAccounts,
  futureInstallments,
  groupPurchases,
  monthSummary,
  type BankMonthSummary,
  type BankPurchase,
  type CardBill,
  type InstallmentMonth,
} from '@/domain/bankMonth';
import { budgetProgress, describeBudget, type BudgetLine } from '@/domain/budget';
import { formatShortDate, todayISO, toISODate } from '@/domain/dates';
import { getFinanceCategory, monthLabel, monthRange, shiftMonth, type FinanceCategory } from '@/domain/finance';
import { formatBRL } from '@/domain/money';
import { errorMessage } from '@/lib/supabase';
import type { FinAccount, FinConnection } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import { NukeAvatar } from '@/ui/NukeArt';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Icon,
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
  TextField,
} from '@/ui/primitives';
import { radius, space, useColors, type Colors } from '@/ui/theme';

/** Meses que dá para olhar: o atual e os dois anteriores (a janela buscada). */
const MONTHS_BACK = 2;
/** Linhas da conferência antes do "Ver todas". */
const ROWS_SHOWN = 12;
/** Mesmo formato que a função `finance` aceita. */
const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABEL_MAX = 40;

const RECORD_KIND: Record<NookyRecord['kind'], string> = { nota: 'Nota', conta: 'Conta', gasto: 'Gasto' };
const STATUS_COLOR: Record<BudgetLine['status'], keyof Colors> = { ok: 'primary', perto: 'warning', estourou: 'danger' };

const capitalizeFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** "7 out" no fuso do aparelho de um instante gravado em UTC (22h30 do dia 7 não vira dia 8). */
const localShortDate = (timestamp: string) => formatShortDate(toISODate(new Date(timestamp)));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Consultor financeiro (beta): os bancos do MeuPluggy, só para quem tem a liberação nesta casa. */
export default function ConsultorScreen() {
  const beta = useBeta('finance');
  // Já liberado, uma nova consulta que falha (rede voltando) não derruba a tela nem o que foi digitado.
  if (beta.data === true) return <Consultor />;
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

function Consultor() {
  const today = todayISO();
  const current = today.slice(0, 7);
  const [month, setMonth] = useState(current);
  const finance = useFinanceData(today);
  const sync = useSyncFinance();
  const { mutate: runSync } = sync;
  const [pulling, setPulling] = useState(false);

  // Ao abrir, uma vez: o servidor só busca de novo o banco parado há mais de 6 h.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    runSync({ force: false });
  }, [runSync]);

  const refresh = (pull: boolean) => {
    if (sync.isPending) return;
    if (pull) setPulling(true);
    runSync({ force: true }, { onSettled: () => setPulling(false) });
  };

  const data = finance.status === 'ready' ? finance.data : null;
  const view = useMemo(() => (data ? buildView(data, month, today) : null), [data, month, today]);
  // O servidor pula banco atualizado há menos de 2 min: sem aviso, o toque pareceria não ter feito nada.
  const recentlySynced =
    !sync.isPending && sync.variables?.force === true && sync.data && sync.data.synced === 0 && sync.data.skipped > 0;

  return (
    <Screen edges={[]} refreshing={pulling} onRefresh={() => refresh(true)}>
      <SyncBar
        connections={data?.connections}
        failed={finance.status === 'error'}
        syncing={sync.isPending}
        onRefresh={() => refresh(false)}
      />
      {recentlySynced ? (
        <Text variant="small">Os bancos foram atualizados há pouco. Tente de novo em 2 minutos.</Text>
      ) : null}

      {sync.isError ? (
        <ErrorNotice error={sync.error} onRetry={() => refresh(false)} />
      ) : sync.data?.errors.length ? (
        <Notice tone="danger" icon="alert-circle-outline" lines={sync.data.errors.map((e) => `${e.label}: ${e.message}`)} />
      ) : null}

      {finance.status === 'error' ? <ErrorNotice error={finance.error} onRetry={finance.retry} /> : null}
      {finance.status === 'loading' ? <Loading label="Carregando seus bancos…" /> : null}

      {view && data ? (
        <>
          {view.warnings.length ? (
            <Notice tone="warning" icon="bank-off-outline" lines={view.warnings.map((w) => w.message)} />
          ) : null}

          <NukeCard />

          {data.connections.length ? (
            <>
              <MonthSection
                month={month}
                current={current}
                summary={view.summary}
                onMonth={setMonth}
              />
              <CategorySection lines={view.categories} />
              <CardsSection bills={view.bills} installments={view.installments} />
              <BalancesSection accounts={view.balances} labels={view.labels} />
              <ReconciliationSection reconciliation={view.reconciliation} labels={view.labels} />
            </>
          ) : (
            <EmptyState
              icon="bank-plus"
              tint="green"
              title="Conecte seus bancos"
              message="O consultor lê os extratos pelo MeuPluggy, só para leitura. Só você vê estes dados: o resto da casa, não."
            />
          )}

          <ConnectionsSection connections={data.connections} warnings={view.warnings} />
          <Text variant="small" style={styles.center}>
            Beta: os números saem do banco pela data da compra e não entram nas finanças da casa. Só um orçamento que você
            aceitar do Nuke muda, e ele vale para a casa toda.
          </Text>
        </>
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// O que a tela mostra, calculado uma vez por mês escolhido

interface CategoryRow {
  category: FinanceCategory;
  amount: number;
  budget: BudgetLine | null;
}

function buildView(data: FinanceData, month: string, today: string) {
  const current = today.slice(0, 7);
  const purchases = groupPurchases(data.transactions, data.accounts);
  const labels = accountLabels(data.accounts, data.connections);
  // Saldos e cartões só das contas que a Pluggy ainda devolve (cartão trocado sai).
  const accounts = currentAccounts(data.accounts, data.connections);
  const summary = monthSummary(purchases, month);
  const budgets = budgetProgress(data.budgets, summary.byCategory);
  const budgeted = new Set(budgets.map((b) => b.category));
  return {
    labels,
    summary,
    // Com orçamento primeiro (do mais apertado), depois o resto pelo valor.
    categories: [
      ...budgets.map((b): CategoryRow => ({ category: b.category, amount: b.spent, budget: b })),
      ...summary.byCategory
        .filter((c) => !budgeted.has(c.category))
        .map((c): CategoryRow => ({ category: c.category, amount: c.amount, budget: null })),
    ],
    bills: cardBills(accounts, labels, today),
    installments: futureInstallments(purchases, shiftMonth(current, 1), 6).filter((m) => m.amount > 0),
    balances: accounts.filter((a) => a.type === 'BANK'),
    // Mesma conta do retrato do Nuke: casada na janela inteira, mostrada só no mês escolhido.
    reconciliation: reconciliationInRange(matchBankToNooky(purchases, data.nookyRecords), monthRange(month)),
    warnings: connectionWarnings(data.connections, new Date()),
  };
}

// ---------------------------------------------------------------------------
// Partes da tela

function syncedLabel(connections: FinConnection[] | undefined, failed: boolean): string {
  if (!connections) return failed ? 'Não deu para ler os bancos agora' : 'Carregando…';
  const last = connections
    .map((c) => c.last_synced_at)
    .filter((at): at is string => Boolean(at))
    .sort()
    .at(-1);
  if (!last) return connections.length ? 'Ainda não atualizado' : 'Nenhum banco conectado';
  const at = new Date(last);
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const day = toISODate(at);
  return day === todayISO() ? `Atualizado hoje às ${time}` : `Atualizado em ${formatShortDate(day)} às ${time}`;
}

function SyncBar({
  connections,
  failed,
  syncing,
  onRefresh,
}: {
  /** undefined enquanto os bancos carregam (ou falharam): não é "nenhum banco". */
  connections: FinConnection[] | undefined;
  failed: boolean;
  syncing: boolean;
  onRefresh: () => void;
}) {
  const c = useColors();
  return (
    <Row style={styles.syncBar}>
      {syncing ? <ActivityIndicator color={c.primary} /> : <Icon name="bank-outline" size={20} color="textMuted" />}
      <Text variant="muted" style={styles.flex}>
        {syncing ? 'Atualizando os bancos…' : syncedLabel(connections, failed)}
      </Text>
      <Button title="Atualizar" icon="refresh" variant="secondary" compact disabled={syncing} onPress={onRefresh} />
    </Row>
  );
}

function Notice({ tone, icon, lines }: { tone: 'danger' | 'warning'; icon: 'alert-circle-outline' | 'bank-off-outline'; lines: string[] }) {
  const c = useColors();
  return (
    <Card style={[styles.notice, { backgroundColor: tone === 'danger' ? c.dangerSoft : c.warningSoft }]}>
      {lines.map((line, index) => (
        <Row key={index} style={styles.noticeRow}>
          <Icon name={icon} size={20} color={tone} />
          <Text variant="body" style={styles.flex}>
            {line}
          </Text>
        </Row>
      ))}
    </Card>
  );
}

function NukeCard() {
  return (
    <Card style={styles.nukeCard}>
      <Row style={styles.nukeRow}>
        <NukeAvatar size={56} mood="idle" />
        <View style={styles.flex}>
          <Text variant="label">Pergunte ao Nuke</Text>
          <Text variant="muted">Ele lê os números daqui e ajuda com orçamento, faturas e parcelas.</Text>
        </View>
      </Row>
      <Button title="Conversar com o Nuke" icon="chat-outline" onPress={() => router.push('/consultor/conversa')} />
    </Card>
  );
}

function MonthSection({
  month,
  current,
  summary,
  onMonth,
}: {
  month: string;
  current: string;
  summary: BankMonthSummary;
  onMonth: (month: string) => void;
}) {
  const first = shiftMonth(current, -MONTHS_BACK);
  const name = monthLabel(month).split(' ')[0];
  return (
    <Section
      title={month === current ? 'Este mês no banco' : `${capitalizeFirst(name)} no banco`}
      action={
        <Row gap={0}>
          {month > first ? (
            <IconButton icon="chevron-left" label="Mês anterior" onPress={() => onMonth(shiftMonth(month, -1))} />
          ) : null}
          {month < current ? (
            <IconButton icon="chevron-right" label="Próximo mês" onPress={() => onMonth(shiftMonth(month, 1))} />
          ) : null}
        </Row>
      }>
      <Card style={styles.gap}>
        <Row style={styles.statsWrap}>
          <Stat label="Saídas" value={formatBRL(summary.spending)} />
          <Stat label="Entradas" value={formatBRL(summary.income)} />
          <Stat label="Previsto" value={formatBRL(summary.pending)} color="warning" />
        </Row>
        <Text variant="small">
          {plural(summary.count, 'compra', 'compras')} pela data da compra; parcelada conta inteira no dia.
          {summary.refunds > 0 ? ` Estornos de ${formatBRL(summary.refunds)} já descontados.` : ''} Previsto é o que
          ainda está pendente no banco.
        </Text>
      </Card>
    </Section>
  );
}

// Sem adjustsFontSizeToFit (o navegador não tem): em tela estreita os números descem de linha.
function Stat({ label, value, color }: { label: string; value: string; color?: keyof Colors }) {
  return (
    <View style={styles.stat}>
      <Text variant="small">{label}</Text>
      <Text variant="label" color={color}>
        {value}
      </Text>
    </View>
  );
}

function CategorySection({ lines }: { lines: CategoryRow[] }) {
  const c = useColors();
  return (
    <Section
      title="Por categoria"
      action={<Button title="Orçamento" variant="ghost" compact onPress={() => router.push('/orcamento')} />}>
      {lines.length ? (
        <Card style={styles.categories}>
          {lines.map(({ category, amount, budget }) => {
            const info = getFinanceCategory(category);
            return (
              <View key={category} style={styles.categoryLine}>
                <Row>
                  <Icon name={info.icon} size={18} color="textMuted" />
                  <Text variant="label" style={styles.flex}>
                    {info.label}
                  </Text>
                  <Text variant="label">{formatBRL(amount)}</Text>
                </Row>
                {budget ? (
                  <>
                    <View style={[styles.track, { backgroundColor: c.surfaceAlt }]}>
                      <View
                        style={[
                          styles.fill,
                          { width: `${Math.min(100, budget.ratio * 100)}%`, backgroundColor: c[STATUS_COLOR[budget.status]] },
                        ]}
                      />
                    </View>
                    <Text variant="small" color={budget.status === 'ok' ? undefined : STATUS_COLOR[budget.status]}>
                      {describeBudget(budget)}
                    </Text>
                  </>
                ) : (
                  <Text variant="small">Sem orçamento</Text>
                )}
              </View>
            );
          })}
        </Card>
      ) : (
        <Text variant="muted">Nenhuma saída neste mês.</Text>
      )}
    </Section>
  );
}

function billDetails(bill: CardBill): string {
  return [
    // O saldo do cartão é o limite usado: fatura aberta mais as parcelas a vencer.
    'Limite usado',
    bill.dueDate ? `vence ${formatShortDate(bill.dueDate)}` : null,
    bill.closeDate ? `fecha ${formatShortDate(bill.closeDate)}` : null,
    bill.minimumPayment != null ? `mínimo ${formatBRL(bill.minimumPayment)}` : null,
    bill.availableCredit != null ? `limite livre ${formatBRL(bill.availableCredit)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function CardsSection({ bills, installments }: { bills: CardBill[]; installments: InstallmentMonth[] }) {
  if (!bills.length && !installments.length) return null;
  return (
    <Section title="Cartões e parcelas">
      {bills.length ? (
        <ListCard>
          {bills.map((bill) => (
            <ListRow
              key={bill.accountId}
              left={<IconBadge icon="credit-card-outline" tone="info" />}
              title={bill.label}
              subtitle={billDetails(bill)}
              right={<Text variant="label">{bill.amount != null ? formatBRL(bill.amount) : '—'}</Text>}
            />
          ))}
        </ListCard>
      ) : null}
      {installments.length ? (
        <>
          <Text variant="label">Parcelas já comprometidas</Text>
          <ListCard>
            {installments.map((m) => (
              <ListRow
                key={m.month}
                left={<IconBadge icon="calendar-month-outline" tone="warning" />}
                title={capitalizeFirst(monthLabel(m.month))}
                subtitle={plural(m.parcels.length, 'parcela', 'parcelas')}
                right={<Text variant="label">{formatBRL(m.amount)}</Text>}
              />
            ))}
          </ListCard>
        </>
      ) : null}
    </Section>
  );
}

function BalancesSection({ accounts, labels }: { accounts: FinAccount[]; labels: Map<string, string> }) {
  if (!accounts.length) return null;
  return (
    <Section title="Saldos">
      <ListCard>
        {accounts.map((account) => (
          <ListRow
            key={account.id}
            left={<IconBadge icon="wallet-outline" tone="primary" />}
            title={labels.get(account.id) ?? 'Conta'}
            subtitle={account.updated_at ? `Atualizado em ${localShortDate(account.updated_at)}` : undefined}
            right={
              <Text variant="label" color={account.balance != null && account.balance < 0 ? 'danger' : undefined}>
                {account.balance != null ? formatBRL(account.balance) : '—'}
              </Text>
            }
          />
        ))}
      </ListCard>
    </Section>
  );
}

function purchaseTitle(p: BankPurchase): string {
  return p.merchantName ?? p.description;
}

function purchaseDetails(p: BankPurchase, labels: Map<string, string>): string {
  return [
    formatShortDate(p.date),
    labels.get(p.accountId),
    p.installments ? `${p.installments.total}x de ${formatBRL(p.installments.parcel)}` : null,
    p.pending ? 'previsto' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

const recordText = (r: NookyRecord) => `${RECORD_KIND[r.kind]} ${r.label} · ${formatShortDate(r.date)} · ${formatBRL(r.amount)}`;

type ReconciliationTab = 'banco' | 'nooky';

function ReconciliationSection({ reconciliation, labels }: { reconciliation: Reconciliation; labels: Map<string, string> }) {
  const [tab, setTab] = useState<ReconciliationTab>('banco');
  const [showAll, setShowAll] = useState(false);
  const totals = reconciliationTotals(reconciliation);
  const nookyOnly = reconciliation.nookyOnly.length;
  const rows = tab === 'banco' ? reconciliation.bankOnly.length : reconciliation.matched.length;
  const limit = showAll ? rows : ROWS_SHOWN;

  if (!totals.inNookyCount && !totals.bankOnlyCount) return null;

  return (
    <Section title="Conferência com o Nooky">
      <Text variant="muted">
        Compras do banco comparadas com as notas, contas pagas e gastos da casa. Só para conferir: nada é alterado.
      </Text>
      <Row style={styles.stats}>
        <Card style={styles.totalCard}>
          <Text variant="small">Já no Nooky</Text>
          <Text variant="label">{formatBRL(totals.inNooky)}</Text>
          <Text variant="small">{plural(totals.inNookyCount, 'compra', 'compras')}</Text>
        </Card>
        <Card style={styles.totalCard}>
          <Text variant="small">Só no banco</Text>
          <Text variant="label">{formatBRL(totals.bankOnly)}</Text>
          <Text variant="small">{plural(totals.bankOnlyCount, 'compra', 'compras')}</Text>
        </Card>
      </Row>
      <Segmented
        value={tab}
        onChange={(value) => {
          setTab(value);
          setShowAll(false);
        }}
        options={[
          { value: 'banco', label: `Só no banco (${totals.bankOnlyCount})` },
          { value: 'nooky', label: `Já no Nooky (${totals.inNookyCount})` },
        ]}
      />
      {rows ? (
        <ListCard>
          {tab === 'banco'
            ? reconciliation.bankOnly.slice(0, limit).map(({ purchase, suggestions }) => (
                <ListRow
                  key={purchase.key}
                  title={purchaseTitle(purchase)}
                  subtitle={
                    <View>
                      <Text variant="muted">{purchaseDetails(purchase, labels)}</Text>
                      {suggestions.map((s) => (
                        <Text key={`${s.kind}-${s.id}`} variant="small" color="info">
                          Pode ser: {recordText(s)}
                        </Text>
                      ))}
                    </View>
                  }
                  right={<Text variant="label">{formatBRL(purchase.amount)}</Text>}
                />
              ))
            : reconciliation.matched.slice(0, limit).map(({ purchase, record, confidence, reason }) => (
                <ListRow
                  key={purchase.key}
                  title={purchaseTitle(purchase)}
                  subtitle={
                    <View style={styles.matchInfo}>
                      <Text variant="muted">{purchaseDetails(purchase, labels)}</Text>
                      <Text variant="small">No Nooky: {recordText(record)}</Text>
                      <Row>
                        <Badge label={confidence === 'alta' ? 'Bate' : 'Provável'} tone={confidence === 'alta' ? 'primary' : 'warning'} />
                        <Text variant="small" style={styles.flex}>
                          {reason}
                        </Text>
                      </Row>
                    </View>
                  }
                  right={<Text variant="label">{formatBRL(purchase.amount)}</Text>}
                />
              ))}
        </ListCard>
      ) : (
        <Text variant="muted">{tab === 'banco' ? 'Tudo do banco já está no Nooky.' : 'Nenhuma compra do banco achada no Nooky.'}</Text>
      )}
      {rows > ROWS_SHOWN ? (
        <Button
          title={showAll ? 'Mostrar menos' : `Ver todas (${rows})`}
          variant="ghost"
          compact
          onPress={() => setShowAll((value) => !value)}
        />
      ) : null}
      {nookyOnly ? (
        <Text variant="small">
          {plural(nookyOnly, 'registro do Nooky', 'registros do Nooky')} deste mês sem par no banco (dinheiro, outra pessoa ou
          banco não conectado).
        </Text>
      ) : null}
    </Section>
  );
}

function ConnectionsSection({ connections, warnings }: { connections: FinConnection[]; warnings: ConnectionWarning[] }) {
  const remove = useRemoveFinConnection();
  const [adding, setAdding] = useState(false);
  const showForm = adding || !connections.length;

  function confirmRemove(connection: FinConnection) {
    confirmAction(
      'Desconectar banco',
      `Tirar ${connection.label} do consultor? Os lançamentos dele saem do Nooky. No MeuPluggy, a conexão continua.`,
      'Desconectar',
      () => remove.mutate(connection.id, { onError: (err) => notify('Não deu para desconectar', errorMessage(err)) }),
    );
  }

  return (
    <Section
      title="Bancos conectados"
      action={
        connections.length && !adding ? (
          <Button title="Adicionar" icon="plus" variant="ghost" compact onPress={() => setAdding(true)} />
        ) : null
      }>
      {connections.length ? (
        <ListCard>
          {connections.map((connection) => {
            const warning = warnings.find((w) => w.connectionId === connection.id);
            return (
              <ListRow
                key={connection.id}
                left={<IconBadge icon="bank-outline" tone={warning ? 'warning' : 'primary'} />}
                title={connection.label}
                subtitle={
                  warning ? (
                    <Text variant="small" color="warning">
                      {warning.message}
                    </Text>
                  ) : connection.item_updated_at ? (
                    `Banco atualizado em ${localShortDate(connection.item_updated_at)}`
                  ) : (
                    'Conectado'
                  )
                }
                right={
                  <IconButton
                    icon="link-variant-off"
                    label={`Desconectar ${connection.label}`}
                    color="danger"
                    onPress={() => confirmRemove(connection)}
                  />
                }
              />
            );
          })}
        </ListCard>
      ) : null}
      {showForm ? <AddBankForm onClose={connections.length ? () => setAdding(false) : undefined} /> : null}
    </Section>
  );
}

function AddBankForm({ onClose }: { onClose?: () => void }) {
  const add = useAddFinItem();
  const [label, setLabel] = useState('');
  const [itemId, setItemId] = useState('');

  function submit() {
    // Enter de novo (ou Enter e o botão) enquanto conecta não manda outro pedido.
    if (add.isPending) return;
    const name = label.trim().replace(/\s+/g, ' ');
    const id = itemId.trim();
    if (!name) {
      notify('Falta o nome', 'Dê um nome curto para o banco, como Nubank.');
      return;
    }
    if (!ITEM_ID.test(id)) {
      notify('Item ID inválido', 'Cole o Item ID copiado no Dashboard da Pluggy: um código como 1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d.');
      return;
    }
    add.mutate(
      { itemId: id, label: name },
      {
        onSuccess: ({ sync }) => {
          setLabel('');
          setItemId('');
          onClose?.();
          if (sync.errors.length) {
            notify('Banco conectado', `A primeira atualização não deu certo: ${sync.errors.map((e) => e.message).join(' ')}`);
          } else {
            notify('Banco conectado', `${name} já aparece no consultor.`);
          }
        },
        onError: (err) => notify('Não deu para conectar', errorMessage(err)),
      },
    );
  }

  return (
    <Card style={styles.gap}>
      <Text variant="label">Conectar um banco</Text>
      <Text variant="muted">
        No Dashboard da Pluggy, abra a sua aplicação, vá em &quot;Ir para Demo&quot; e conecte o banco pelo MeuPluggy. Depois, em
        Items, toque no ⋮ do banco e em &quot;Copiar Item ID&quot;. Cole aqui com um nome curto. É só leitura: o Nooky não mexe no
        seu dinheiro.
      </Text>
      <TextField
        label="Nome"
        value={label}
        onChangeText={setLabel}
        placeholder="Ex.: Nubank"
        maxLength={LABEL_MAX}
        autoCapitalize="words"
        editable={!add.isPending}
      />
      <TextField
        label="Item ID"
        value={itemId}
        onChangeText={setItemId}
        placeholder="1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        maxLength={60}
        editable={!add.isPending}
        onSubmitEditing={submit}
      />
      <Button title="Conectar banco" icon="bank-plus" onPress={submit} loading={add.isPending} />
      {onClose ? <Button title="Cancelar" variant="ghost" compact onPress={onClose} disabled={add.isPending} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  gap: { gap: space.md },
  syncBar: { gap: space.sm },
  notice: { gap: space.sm },
  noticeRow: { gap: space.sm, alignItems: 'flex-start' },
  nukeCard: { gap: space.md },
  nukeRow: { gap: space.md },
  stats: { gap: space.md, alignItems: 'stretch' },
  // 3 lado a lado quando cabem; em celular estreito, 2 + 1 (sem cortar o valor).
  statsWrap: { gap: space.md, alignItems: 'flex-start', flexWrap: 'wrap' },
  stat: { flexGrow: 1, flexBasis: 110, gap: 2 },
  totalCard: { flex: 1, gap: 2, padding: space.lg },
  categories: { gap: space.lg },
  categoryLine: { gap: 6 },
  track: { height: 10, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 10, borderRadius: radius.pill },
  matchInfo: { gap: 2 },
});
