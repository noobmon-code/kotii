import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type ScrollView } from 'react-native';

import { useMarketReceipts } from '@/data/marketSpend';
import { getCategory } from '@/domain/categories';
import { todayISO } from '@/domain/dates';
import { monthLabel, shiftMonth } from '@/domain/finance';
import type { MarketChange } from '@/domain/marketChange';
import {
  MARKET_VIEWS,
  marketMonth,
  marketTrend,
  monthFromParam,
  viewFromParam,
  type MarketMonth,
  type MarketReceiptRef,
  type MarketTrend,
  type MarketView,
} from '@/domain/marketSpend';
import { BarRow } from '@/features/finance/BarRow';
import { MarketTrendChart } from '@/features/market/MarketTrendChart';
import { useReceiptScanner } from '@/features/ReceiptScanner';
import {
  Button,
  Card,
  CategoryIcon,
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
  Screen,
  Segmented,
  Text,
} from '@/ui/primitives';
import { space } from '@/ui/theme';

const capitalizeFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const openReceipt = (id: string) => router.push({ pathname: '/nota/[id]', params: { id } });

/** Mercado do mês: para onde foi o dinheiro do mercado. As contas e os textos vêm de domain/marketSpend. */
export default function MarketMonthScreen() {
  const { mes, aba } = useLocalSearchParams<{ mes?: string; aba?: string }>();
  const today = todayISO();
  const current = today.slice(0, 7);
  // O mês vive na URL: o resumo de gastos abre a tela no mês que estava mostrando.
  const month = monthFromParam(mes, current);
  // A parte da tela (itens, categorias, idas ou mercados) também: um link abre direto nela, e recarregar a
  // página não a perde. Trocar de parte não empilha telas (setParams não cria entrada no histórico): o
  // voltar sai da tela, como nas abas de Finanças.
  const view = viewFromParam(aba);
  const receipts = useMarketReceipts(month);
  const scanner = useReceiptScanner();
  const [category, setCategory] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showAllChanges, setShowAllChanges] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const scroll = useRef<ScrollView>(null);
  /** A altura em que a chave das partes está na tela rolável. */
  const switchY = useRef(0);
  /** A altura em que o card "O que mudou" está, no mesmo espaço da chave. */
  const changesY = useRef(0);
  const summary = useMemo(() => (receipts.data ? marketMonth(receipts.data, month, today) : null), [receipts.data, month, today]);
  const trend = useMemo(() => (receipts.data ? marketTrend(receipts.data, month, today) : null), [receipts.data, month, today]);
  const chosen = summary?.categories.some((c) => c.key === category) ? category : null;
  // A categoria escolhida, nos mesmos meses: como ela andou. Só os itens mostram o cartão, e só aí a conta é feita.
  const categoryTrend = useMemo(
    () => (receipts.data && chosen && view === 'itens' ? marketTrend(receipts.data, month, today, chosen) : null),
    [receipts.data, month, today, chosen, view],
  );

  function goTo(target: string) {
    if (target > current) return;
    setCategory(null);
    setShowAll(false);
    setShowAllChanges(false);
    setDetailsOpen(false);
    router.setParams({ mes: target });
  }

  /** Escolher uma categoria leva aos itens dela; tirar a escolha deixa a pessoa onde está. */
  function chooseCategory(key: string | null) {
    setCategory(key);
    if (!key) return;
    router.setParams({ aba: 'itens' });
    // A categoria tocada pode estar lá embaixo na lista: a tela volta para a chave, com os itens logo abaixo.
    scroll.current?.scrollTo({ y: Math.max(0, switchY.current - space.sm), animated: false });
  }

  /**
   * Fechar a lista longa de mudanças tira de cima as linhas por onde a pessoa rolou: sem voltar, a tela ficaria
   * no meio do ranking. A tela não acompanha a rolagem, então volta sempre para o card.
   */
  function openChanges(all: boolean) {
    setShowAllChanges(all);
    if (!all) scroll.current?.scrollTo({ y: Math.max(0, changesY.current - space.sm), animated: false });
  }

  return (
    <Screen edges={[]} scrollRef={scroll} refreshing={receipts.isRefetching} onRefresh={() => receipts.refetch()}>
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

      {receipts.isPending ? (
        receipts.fetchStatus === 'paused' ? (
          // Sem internet e sem este mês na memória, a busca fica parada (não vira erro) e volta sozinha com a
          // conexão: um aviso, em vez de girar sem fim. Sem botão: tentar de novo não a faz andar.
          <Card style={styles.notice}>
            <Icon name="wifi-off" color="warning" />
            <Text variant="muted" style={styles.flex}>
              Sem internet. Os números aparecem quando a conexão voltar.
            </Text>
          </Card>
        ) : (
          <Loading />
        )
      ) : !summary ? (
        // Sem as notas não há o que mostrar: o erro, nunca um mês "sem gasto".
        <ErrorNotice error={receipts.error} onRetry={() => receipts.refetch()} />
      ) : (
        <MonthBody
          summary={summary}
          // A nova busca falhou e os números de antes continuam na tela.
          stale={receipts.isError}
          onRetry={() => receipts.refetch()}
          view={view}
          onView={(value) => router.setParams({ aba: value })}
          trend={trend}
          categoryTrend={categoryTrend}
          category={chosen}
          onCategory={chooseCategory}
          showAll={showAll}
          onShowAll={setShowAll}
          showAllChanges={showAllChanges}
          onShowAllChanges={openChanges}
          detailsOpen={detailsOpen}
          onDetailsOpen={setDetailsOpen}
          onSwitchLayout={(y) => {
            switchY.current = y;
          }}
          onChangesLayout={(y) => {
            changesY.current = y;
          }}
          onAddReceipt={scanner.open}
          adding={scanner.busy}
        />
      )}

      {scanner.element}
    </Screen>
  );
}

function MonthBody({
  summary,
  trend,
  categoryTrend,
  stale,
  onRetry,
  view,
  onView,
  category,
  onCategory,
  showAll,
  onShowAll,
  showAllChanges,
  onShowAllChanges,
  detailsOpen,
  onDetailsOpen,
  onSwitchLayout,
  onChangesLayout,
  onAddReceipt,
  adding,
}: {
  summary: MarketMonth;
  trend: MarketTrend | null;
  categoryTrend: MarketTrend | null;
  stale: boolean;
  onRetry: () => void;
  view: MarketView;
  onView: (view: MarketView) => void;
  category: string | null;
  onCategory: (category: string | null) => void;
  showAll: boolean;
  onShowAll: (all: boolean) => void;
  showAllChanges: boolean;
  onShowAllChanges: (all: boolean) => void;
  detailsOpen: boolean;
  onDetailsOpen: (open: boolean) => void;
  onSwitchLayout: (y: number) => void;
  onChangesLayout: (y: number) => void;
  onAddReceipt: () => void;
  adding: boolean;
}) {
  return (
    <>
      {stale ? (
        <Card style={styles.gapSm}>
          <Row>
            <Icon name="alert-circle-outline" color="warning" />
            <Text variant="muted" style={styles.flex}>
              Não deu para atualizar agora. Estes números são da última vez que a tela carregou.
            </Text>
          </Row>
          <Button title="Tentar de novo" variant="secondary" compact onPress={onRetry} />
        </Card>
      ) : null}

      {summary.trips.length === 0 ? (
        <>
          <EmptyState
            icon="receipt-text-outline"
            title={summary.emptyTitle}
            message="As compras aparecem aqui quando uma nota fiscal é confirmada. Fotografe o cupom ou leia o QR code da nota."
            action={<Button title="Adicionar nota" icon="camera-outline" onPress={onAddReceipt} loading={adding} />}
          />
          {/* Sem total na tela não há o que abrir e fechar: o que espera a revisão e o que ficou de fora já vêm à vista. */}
          {summary.closing ? (
            <Card style={styles.details}>
              <Details summary={summary} />
            </Card>
          ) : null}
          {/* Mês sem nota, mas com notas nos meses antes dele: a tendência continua dizendo como o mercado andou. */}
          {trend?.hasAny ? <MarketTrendChart trend={trend} /> : null}
        </>
      ) : (
        <>
          <Card style={styles.hero}>
            <Text variant="muted">{summary.title}</Text>
            <Text variant="title">{summary.headline}</Text>
            {summary.comparison ? <Text variant="small">{summary.comparison}</Text> : null}
          </Card>

          {summary.closing ? (
            <Card style={styles.details}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: detailsOpen }}
                accessibilityLabel={`Como este total fecha. ${summary.closing}`}
                onPress={() => onDetailsOpen(!detailsOpen)}
                style={({ pressed }) => [styles.detailsHeader, pressed && styles.pressed]}>
                <View style={styles.flex}>
                  <Text variant="label">Como este total fecha</Text>
                  {/* Duas linhas no máximo: aberto, tudo o que a frase diz aparece em linhas próprias. */}
                  {detailsOpen ? null : (
                    <Text variant="small" numberOfLines={2}>
                      {summary.closing}
                    </Text>
                  )}
                </View>
                <Icon name={detailsOpen ? 'chevron-up' : 'chevron-down'} color="textMuted" />
              </Pressable>
              {detailsOpen ? <Details summary={summary} /> : null}
            </Card>
          ) : null}

          {trend ? <MarketTrendChart trend={trend} /> : null}

          {/* Sem nota de mercado na janela do mês anterior não há com o que comparar: o cabeçalho já diz. */}
          {summary.change ? (
            <View onLayout={(event) => onChangesLayout(event.nativeEvent.layout.y)}>
              <Changes change={summary.change} showAll={showAllChanges} onShowAll={onShowAllChanges} />
            </View>
          ) : null}

          <View onLayout={(event) => onSwitchLayout(event.nativeEvent.layout.y)}>
            <Segmented value={view} onChange={onView} options={MARKET_VIEWS} />
          </View>

          {view === 'itens' ? (
            <Items summary={summary} category={category} trend={categoryTrend} onCategory={onCategory} showAll={showAll} onShowAll={onShowAll} />
          ) : view === 'categorias' ? (
            <Categories summary={summary} onCategory={onCategory} />
          ) : view === 'idas' ? (
            <ListCard>
              {summary.trips.map((trip) => (
                <ListRow
                  key={trip.receiptId}
                  left={<IconBadge icon="receipt-text-outline" />}
                  title={trip.storeName}
                  subtitle={trip.detail}
                  right={<Text variant="label">{trip.amount}</Text>}
                  accessibilityLabel={`${trip.accessibilityLabel}. Abrir a nota`}
                  onPress={() => openReceipt(trip.receiptId)}
                />
              ))}
            </ListCard>
          ) : (
            <ListCard>
              {summary.stores.map((store) => (
                <ListRow
                  key={store.key}
                  left={<IconBadge icon="store-outline" />}
                  title={store.name}
                  subtitle={store.detail}
                  right={<Text variant="label">{store.amount}</Text>}
                  accessibilityLabel={store.accessibilityLabel}
                />
              ))}
            </ListCard>
          )}

          <Text variant="small">
            Diferente da barra “Mercado” do Resumo: aqui entram limpeza, higiene e pet, e só conta o que veio de nota fiscal.
          </Text>
        </>
      )}
    </>
  );
}

/** Os itens do mês, do que levou mais dinheiro para o que levou menos; com uma categoria escolhida, todos os dela. */
function Items({
  summary,
  category,
  trend,
  onCategory,
  showAll,
  onShowAll,
}: {
  summary: MarketMonth;
  category: string | null;
  /** Com uma categoria escolhida: como ela andou nos últimos meses. */
  trend: MarketTrend | null;
  onCategory: (category: string | null) => void;
  showAll: boolean;
  onShowAll: (all: boolean) => void;
}) {
  const items = category ? summary.items.filter((item) => item.category === category) : summary.items;
  // Nunca um corte calado: os primeiros vêm com o "Ver todos" (quantos e o que os botões dizem saem das
  // regras, em `itemsCut`), e a categoria escolhida vem inteira.
  const cut = category ? null : summary.itemsCut;
  const shown = cut && !showAll ? items.slice(0, cut.shown) : items;
  const label = category ? getCategory(category).label : null;
  if (items.length === 0) return <Text variant="muted">As notas deste mês vieram sem nenhum item lido.</Text>;
  return (
    <View style={styles.gapMd}>
      {label ? (
        <Row style={styles.wrap}>
          <Text variant="muted">Só os itens de</Text>
          <Chip
            label={label}
            icon="close"
            selected
            accessibilityLabel={`${label}: mostrar os itens de todas as categorias`}
            onPress={() => onCategory(null)}
          />
        </Row>
      ) : null}
      {trend ? <MarketTrendChart trend={trend} /> : null}
      <ListCard>
        {shown.map((item) => (
          <ListRow
            key={item.key}
            left={<CategoryIcon category={item.category} name={item.name} size={36} />}
            title={item.name}
            subtitle={item.detail}
            right={
              <View style={styles.amount}>
                <Text variant="label">{item.amount}</Text>
                <Text variant="small">{item.share}</Text>
              </View>
            }
            accessibilityLabel={item.accessibilityLabel}
            // Item que a casa não acompanha não tem tela de produto.
            onPress={item.productId ? () => router.push({ pathname: '/produto/[id]', params: { id: item.productId! } }) : undefined}
          />
        ))}
      </ListCard>
      {cut ? <Button title={showAll ? cut.less : cut.more} variant="ghost" compact onPress={() => onShowAll(!showAll)} /> : null}
      {summary.shareBasis ? <Text variant="small">{summary.shareBasis}</Text> : null}
    </View>
  );
}

/**
 * O que mudou em relação à janela do mês anterior: a diferença dos itens repartida em preço, quantidade, itens
 * que entraram e que saíram (as partes somam exatamente a diferença), e os itens que mais mudaram, as 3 maiores
 * com o "Ver todas". Os textos e as contas vêm de domain/marketChange.
 */
function Changes({ change, showAll, onShowAll }: { change: MarketChange; showAll: boolean; onShowAll: (all: boolean) => void }) {
  const cut = change.itemsCut;
  const shown = cut && !showAll ? change.items.slice(0, cut.shown) : change.items;
  return (
    <View style={styles.gapMd}>
      <Card style={styles.details}>
        <View style={styles.hero}>
          <Text variant="label">O que mudou</Text>
          <Text variant="body">{change.headline}</Text>
        </View>
        {change.parts.length ? (
          <View style={styles.gapMd}>
            {change.parts.map((part) => (
              <View key={part.key} accessible accessibilityLabel={part.accessibilityLabel} style={styles.amountLine}>
                <View style={styles.flex}>
                  <Text variant="body">{part.label}</Text>
                  {part.detail ? <Text variant="small">{part.detail}</Text> : null}
                </View>
                <Text variant="label">{part.amount}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {change.totalNote ? <Text variant="small">{change.totalNote}</Text> : null}
      </Card>
      {shown.length ? (
        <ListCard>
          {shown.map((item) => (
            <ListRow
              key={item.key}
              left={<CategoryIcon category={item.category} name={item.name} size={36} />}
              title={item.name}
              subtitle={item.detail}
              right={<Text variant="label">{item.amount}</Text>}
              accessibilityLabel={item.accessibilityLabel}
              // Item que a casa não acompanha não tem tela de produto.
              onPress={item.productId ? () => router.push({ pathname: '/produto/[id]', params: { id: item.productId! } }) : undefined}
            />
          ))}
        </ListCard>
      ) : null}
      {cut ? <Button title={showAll ? cut.less : cut.more} variant="ghost" compact onPress={() => onShowAll(!showAll)} /> : null}
    </View>
  );
}

/** Todas as categorias do mês, da maior para a menor. O toque leva aos itens da categoria. */
function Categories({ summary, onCategory }: { summary: MarketMonth; onCategory: (category: string) => void }) {
  if (summary.categories.length === 0) return <Text variant="muted">As notas deste mês vieram sem nenhum item lido.</Text>;
  return (
    <View style={styles.gapMd}>
      <Text variant="small">Toque numa categoria para ver os itens dela.</Text>
      <Card style={styles.bars}>
        {summary.categories.map((c) => (
          <BarRow
            key={c.key}
            left={<CategoryIcon category={c.key} size={28} />}
            label={c.label}
            // Os nomes das categorias de produto são compridos: duas linhas, em vez de "Grãos, massas e c…".
            labelLines={2}
            amount={c.amount}
            share={c.share}
            value={c.cents}
            max={summary.categories[0].cents}
            note={c.versusPrevious}
            accessibilityLabel={c.accessibilityLabel}
            onPress={() => onCategory(c.key)}
          />
        ))}
        {summary.shareBasis ? <Text variant="small">{summary.shareBasis}</Text> : null}
      </Card>
    </View>
  );
}

/**
 * Como o total fecha: as diferenças do total das notas, os itens sem valor, a farmácia (fora da conta) e as
 * notas que ainda esperam a revisão.
 */
function Details({ summary }: { summary: MarketMonth }) {
  const { discount, unread, noValue, later, pharmacy, drafts } = summary;
  return (
    <>
      {discount ? <AmountLine label={discount.label} value={discount.value} accessibilityLabel={discount.accessibilityLabel} /> : null}
      {unread ? (
        <View style={styles.gapSm}>
          <AmountLine label={unread.label} value={unread.value} accessibilityLabel={unread.accessibilityLabel} />
          {/* Diferença de poucos centavos não manda abrir nota nenhuma: a frase só aparece com nota para conferir. */}
          {unread.receipts.length > 0 ? <Text variant="small">A leitura pode ter perdido um item ou um valor. Abra a nota para conferir:</Text> : null}
          {unread.receipts.map((ref) => (
            <ReceiptLink key={ref.receiptId} receipt={ref} />
          ))}
        </View>
      ) : null}
      {noValue ? (
        <View style={styles.gapSm}>
          <Text variant="body">{noValue.label}</Text>
          <Text variant="small">{noValue.hint}</Text>
          {noValue.receipts.map((ref) => (
            <ReceiptLink key={ref.receiptId} receipt={ref} />
          ))}
        </View>
      ) : null}
      {later ? (
        <View style={styles.gapSm}>
          <Text variant="body">{later.label}</Text>
          <Text variant="small">{later.hint}</Text>
          {later.receipts.map((ref) => (
            <ReceiptLink key={ref.receiptId} receipt={ref} />
          ))}
        </View>
      ) : null}
      {pharmacy ? <Text variant="muted">{pharmacy}</Text> : null}
      {drafts ? (
        <View style={styles.gapSm}>
          <Text variant="muted">{drafts.label}</Text>
          {/* Cada rascunho abre a própria nota, onde é confirmado: nada aqui leva para as abas. */}
          {drafts.receipts.map((ref) => (
            <ReceiptLink key={ref.receiptId} receipt={ref} />
          ))}
          {drafts.more ? <Text variant="small">{drafts.more}</Text> : null}
        </View>
      ) : null}
    </>
  );
}

function AmountLine({ label, value, accessibilityLabel }: { label: string; value: string; accessibilityLabel: string }) {
  return (
    <View accessible accessibilityLabel={accessibilityLabel} style={styles.amountLine}>
      <Text variant="body" style={styles.flex}>
        {label}
      </Text>
      <Text variant="label">{value}</Text>
    </View>
  );
}

function ReceiptLink({ receipt }: { receipt: MarketReceiptRef }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={receipt.accessibilityLabel}
      onPress={() => openReceipt(receipt.receiptId)}
      style={({ pressed }) => [styles.receiptLink, pressed && styles.pressed]}>
      <Icon name="receipt-text-outline" size={18} color="textMuted" />
      {/* Em tela estreita só o nome do mercado é cortado: a data é o que separa duas notas do mesmo mercado. */}
      <View style={styles.receiptName}>
        <Text variant="muted" numberOfLines={1} style={styles.shrink}>
          {receipt.storeName}
        </Text>
        <Text variant="muted" style={styles.noShrink}>{`· ${receipt.date}`}</Text>
      </View>
      <Text variant="label">{receipt.value}</Text>
      <Icon name="chevron-right" size={18} color="textMuted" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gapSm: { gap: space.sm },
  gapMd: { gap: space.md },
  wrap: { flexWrap: 'wrap' },
  monthNav: { justifyContent: 'space-between' },
  monthTitle: { flex: 1, textAlign: 'center' },
  navPlaceholder: { width: 30 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  hero: { gap: space.xs },
  bars: { gap: space.lg },
  amount: { alignItems: 'flex-end' },
  details: { gap: space.lg },
  detailsHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  amountLine: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  receiptLink: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs },
  receiptName: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.xs },
  shrink: { flexShrink: 1 },
  noShrink: { flexShrink: 0 },
  pressed: { opacity: 0.6 },
});
