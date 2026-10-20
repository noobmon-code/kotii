import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type ScrollView } from 'react-native';

import { useMarketData } from '@/data/marketSpend';
import { getCategory } from '@/domain/categories';
import { todayISO } from '@/domain/dates';
import { monthLabel, shiftMonth } from '@/domain/finance';
import type { MarketChange } from '@/domain/marketChange';
import {
  MARKET_ITEM_ORDERS,
  MARKET_VIEWS,
  marketMonth,
  marketStoreMonth,
  marketTrend,
  marketVsSummary,
  monthFromParam,
  noCategoryItems,
  openLabel,
  orderMarketItems,
  QUANTITY_ORDER_NOTE,
  viewFromParam,
  type MarketItem,
  type MarketItemOrder,
  type MarketMonth,
  type MarketOpen,
  type MarketReceiptRef,
  type MarketStoreMonth,
  type MarketTrend,
  type MarketTrendBar,
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
/** A ida (ou a linha para conferir) abre o que é: a nota, o gasto avulso ou a conta. */
function open(target: MarketOpen) {
  if (target.kind === 'nota') openReceipt(target.id);
  else if (target.kind === 'gasto') router.push({ pathname: '/gasto/[id]', params: { id: target.id } });
  else router.push({ pathname: '/conta/[id]', params: { id: target.id } });
}
/** A nota tem o ícone de nota; o gasto sem nota, o de dinheiro. */
const openIcon = (target: MarketOpen) => (target.kind === 'nota' ? 'receipt-text-outline' : 'cash');
const openProduct = (id: string) => router.push({ pathname: '/produto/[id]', params: { id } });

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
  const market = useMarketData(month);
  const scanner = useReceiptScanner();
  const [category, setCategory] = useState<string | null>(null);
  // O mercado tocado na lista de mercados: '' é o das notas sem mercado, null é nenhum.
  const [store, setStore] = useState<string | null>(null);
  // A ordem dos itens continua a mesma ao trocar de mês.
  const [order, setOrder] = useState<MarketItemOrder>('valor');
  const [showAll, setShowAll] = useState(false);
  const [showAllChanges, setShowAllChanges] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const scroll = useRef<ScrollView>(null);
  /** A altura em que a chave das partes está na tela rolável. */
  const switchY = useRef(0);
  /** A altura em que o card "O que mudou" está, no mesmo espaço da chave. */
  const changesY = useRef(0);
  const summary = useMemo(
    () => (market.data ? marketMonth(market.data.receipts, month, today, market.data.spends) : null),
    [market.data, month, today],
  );
  const trend = useMemo(
    () => (market.data ? marketTrend(market.data.receipts, month, today, null, market.data.spends) : null),
    [market.data, month, today],
  );
  const chosenStore = store === null ? undefined : summary?.stores.find((s) => s.key === store);
  // O mercado escolhido: as idas e os itens dele no mês. Só a parte dos mercados o mostra, e só aí a conta é feita.
  const storeMonth = useMemo(
    () =>
      market.data && chosenStore && view === 'mercados'
        ? marketStoreMonth(market.data.receipts, month, today, chosenStore, market.data.spends)
        : null,
    [market.data, month, today, chosenStore, view],
  );
  // A categoria escolhida, nos mesmos meses: como ela andou. Só os itens mostram o cartão, e só aí a conta é feita.
  // Também no mês sem nada dela: o selo, o cartão e a frase "Nenhum item de…" dizem isso, e o cartão leva a outro mês.
  const categoryTrend = useMemo(
    () => (market.data && category && view === 'itens' ? marketTrend(market.data.receipts, month, today, category, market.data.spends) : null),
    [market.data, month, today, category, view],
  );

  /**
   * Troca de mês. Pelo cartão da categoria, a categoria continua escolhida (`keepCategory`), mesmo que o mês não
   * tenha nada dela; num mês sem ida nenhuma, ela sai (a tela só diz que o mês não tem nota).
   */
  function goTo(target: string, keepCategory = false) {
    if (target > current) return;
    if (!keepCategory) setCategory(null);
    setStore(null);
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

  /** Tocar num mercado mostra as idas e os itens dele, logo abaixo da chave; tirar a escolha volta à lista. */
  function chooseStore(key: string | null) {
    setStore(key);
    if (key !== null) scroll.current?.scrollTo({ y: Math.max(0, switchY.current - space.sm), animated: false });
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
    <Screen edges={[]} scrollRef={scroll} refreshing={market.isRefetching} onRefresh={() => market.refetch()}>
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

      {market.isPending ? (
        market.fetchStatus === 'paused' ? (
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
        <ErrorNotice error={market.error} onRetry={() => market.refetch()} />
      ) : (
        <MonthBody
          summary={summary}
          // A nova busca falhou e os números de antes continuam na tela.
          stale={market.isError}
          onRetry={() => market.refetch()}
          view={view}
          onView={(value) => router.setParams({ aba: value })}
          trend={trend}
          categoryTrend={categoryTrend}
          onMonth={goTo}
          vsSummary={marketVsSummary(month, today, 'mes')}
          category={category}
          onCategory={chooseCategory}
          storeMonth={storeMonth}
          onStore={chooseStore}
          order={order}
          onOrder={setOrder}
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
  onMonth,
  vsSummary,
  stale,
  onRetry,
  view,
  onView,
  category,
  onCategory,
  storeMonth,
  onStore,
  order,
  onOrder,
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
  /** Abre outro mês; `keepCategory` mantém a categoria escolhida. */
  onMonth: (month: string, keepCategory?: boolean) => void;
  /** Por que este total não é a barra "Mercado" do Resumo. */
  vsSummary: string;
  stale: boolean;
  onRetry: () => void;
  view: MarketView;
  onView: (view: MarketView) => void;
  category: string | null;
  onCategory: (category: string | null) => void;
  storeMonth: MarketStoreMonth | null;
  onStore: (store: string | null) => void;
  order: MarketItemOrder;
  onOrder: (order: MarketItemOrder) => void;
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
            message="As compras aparecem aqui quando uma nota fiscal é confirmada ou um gasto é lançado como Mercado em Finanças. Fotografe o cupom ou leia o QR code da nota."
            action={<Button title="Adicionar nota" icon="camera-outline" onPress={onAddReceipt} loading={adding} />}
          />
          {/* Sem total na tela não há o que abrir e fechar: o que espera a revisão e o que ficou de fora já vêm à vista. */}
          {summary.closing ? (
            <Card style={styles.details}>
              <Details summary={summary} />
            </Card>
          ) : null}
          {/* Mês sem ida, mas com idas (nota ou gasto de mercado) nos meses antes dele: a tendência continua dizendo como o mercado andou. */}
          {trend?.hasAny ? <MarketTrendChart trend={trend} onSelect={(bar) => onMonth(bar.month)} /> : null}
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

          {trend ? <MarketTrendChart trend={trend} onSelect={(bar) => onMonth(bar.month)} /> : null}

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
            <Items
              summary={summary}
              category={category}
              trend={categoryTrend}
              // A categoria fica no mês que teve ida com nota; sem ida nenhuma, a tela só diz que o mês não tem nota, e
              // só com gastos sem nota, que eles não têm itens.
              onMonth={(bar) => onMonth(bar.month, bar.hasTrips && !bar.noItems)}
              onCategory={onCategory}
              order={order}
              onOrder={onOrder}
              showAll={showAll}
              onShowAll={onShowAll}
            />
          ) : view === 'categorias' ? (
            <Categories summary={summary} onCategory={onCategory} />
          ) : view === 'idas' ? (
            <ListCard>
              {summary.trips.map((trip) => (
                <ListRow
                  key={trip.key}
                  left={<IconBadge icon={openIcon(trip.opens)} />}
                  title={trip.storeName}
                  subtitle={trip.detail}
                  right={<Text variant="label">{trip.amount}</Text>}
                  accessibilityLabel={`${trip.accessibilityLabel}. ${openLabel(trip.opens)}`}
                  onPress={() => open(trip.opens)}
                />
              ))}
            </ListCard>
          ) : storeMonth ? (
            <StoreDetail store={storeMonth} onStore={onStore} />
          ) : (
            <View style={styles.gapMd}>
              <Text variant="small">Toque num mercado para ver as idas e os itens dele.</Text>
              <ListCard>
                {summary.stores.map((store) => (
                  <ListRow
                    key={store.key}
                    left={<IconBadge icon={store.noReceipt ? 'cash' : 'store-outline'} />}
                    title={store.name}
                    subtitle={store.detail}
                    right={<Text variant="label">{store.amount}</Text>}
                    accessibilityLabel={`${store.accessibilityLabel}. Ver as idas e os itens`}
                    onPress={() => onStore(store.key)}
                  />
                ))}
              </ListCard>
            </View>
          )}
        </>
      )}

      {/* No pé da tela, também no mês sem ida: por que este total não é a barra do Resumo. */}
      <Text variant="small">{vsSummary}</Text>
    </>
  );
}

/**
 * Os itens do mês, na ordem escolhida (por valor, quantidade ou idas); com uma categoria escolhida, todos os
 * dela (ou, no mês sem nada dela, o selo, o cartão dela e uma frase dizendo isso). Por quantidade, cada medida
 * vem num grupo, e os que não se somam ficam por último, num grupo que diz isso.
 */
function Items({
  summary,
  category,
  trend,
  onMonth,
  onCategory,
  order,
  onOrder,
  showAll,
  onShowAll,
}: {
  summary: MarketMonth;
  category: string | null;
  /** Com uma categoria escolhida: como ela andou nos últimos meses. */
  trend: MarketTrend | null;
  /** Um mês tocado no cartão da categoria. */
  onMonth: (bar: MarketTrendBar) => void;
  onCategory: (category: string | null) => void;
  order: MarketItemOrder;
  onOrder: (order: MarketItemOrder) => void;
  showAll: boolean;
  onShowAll: (all: boolean) => void;
}) {
  const items = category ? summary.items.filter((item) => item.category === category) : summary.items;
  // Nunca um corte calado: os primeiros vêm com o "Ver todos" (quantos, o corte por medida e o que os botões
  // dizem saem das regras), e a categoria escolhida vem inteira.
  const cut = category ? null : summary.itemsCut;
  const { groups, toggle } = orderMarketItems(items, order, cut, showAll);
  const label = category ? getCategory(category).label : null;
  if (items.length === 0 && !category) return <Text variant="muted">{summary.emptyItems}</Text>;
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
      {trend ? <MarketTrendChart trend={trend} onSelect={onMonth} /> : null}
      {category && items.length === 0 ? (
        // Aberto pelo cartão da categoria num mês sem nada dela: o selo fica, e a frase diz por que a lista está vazia.
        <Text variant="muted">{noCategoryItems(category, summary.month)}</Text>
      ) : (
        <>
          <Row style={styles.wrap}>
            <Text variant="muted">Ordem:</Text>
            {MARKET_ITEM_ORDERS.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                selected={order === option.value}
                accessibilityLabel={`Ordenar os itens por ${option.label.toLowerCase()}`}
                onPress={() => onOrder(option.value)}
              />
            ))}
          </Row>
          {order === 'quantidade' ? <Text variant="small">{QUANTITY_ORDER_NOTE}</Text> : null}
          {groups.map((group) => (
            <View key={group.key} style={styles.gapSm}>
              {group.title ? (
                <Text variant="label" accessibilityRole="header">
                  {group.title}
                </Text>
              ) : null}
              {group.hint ? <Text variant="small">{group.hint}</Text> : null}
              <ListCard>
                {group.items.map((item) => (
                  <ItemRow key={item.key} item={item} />
                ))}
              </ListCard>
              {group.rest ? <Text variant="small">{group.rest}</Text> : null}
            </View>
          ))}
          {toggle ? <Button title={toggle} variant="ghost" compact onPress={() => onShowAll(!showAll)} /> : null}
          {summary.shareBasis ? <Text variant="small">{summary.shareBasis}</Text> : null}
        </>
      )}
    </View>
  );
}

/** Um item: o valor e a parte à direita; o toque abre o produto. */
function ItemRow({ item }: { item: MarketItem }) {
  return (
    <ListRow
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
      onPress={item.productId ? () => openProduct(item.productId!) : undefined}
    />
  );
}

/** Um mercado tocado: o total dele, as idas (cada uma abre a nota) e os itens, com o selo que volta à lista. */
function StoreDetail({ store, onStore }: { store: MarketStoreMonth; onStore: (store: string | null) => void }) {
  return (
    <View style={styles.gapMd}>
      <Row style={styles.wrap}>
        <Text variant="muted">Só o mercado</Text>
        <Chip label={store.title} icon="close" selected accessibilityLabel={`${store.title}: mostrar todos os mercados`} onPress={() => onStore(null)} />
      </Row>
      <Text variant="heading">{store.headline}</Text>
      <View style={styles.gapSm}>
        <Text variant="label" accessibilityRole="header">
          Idas
        </Text>
        <ListCard>
          {store.trips.map((trip) => (
            <ListRow
              key={trip.key}
              left={<IconBadge icon={openIcon(trip.opens)} />}
              title={trip.detail}
              right={<Text variant="label">{trip.amount}</Text>}
              accessibilityLabel={`${trip.accessibilityLabel}. ${openLabel(trip.opens)}`}
              onPress={() => open(trip.opens)}
            />
          ))}
        </ListCard>
      </View>
      <View style={styles.gapSm}>
        <Text variant="label" accessibilityRole="header">
          Itens
        </Text>
        {store.items.length ? (
          <ListCard>
            {store.items.map((item) => (
              <ItemRow key={item.key} item={item} />
            ))}
          </ListCard>
        ) : (
          <Text variant="muted">{store.emptyItems}</Text>
        )}
      </View>
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
              onPress={item.productId ? () => openProduct(item.productId!) : undefined}
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
  if (summary.categories.length === 0) return <Text variant="muted">{summary.emptyItems}</Text>;
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
 * Como o total fecha: os gastos lançados sem nota, as diferenças do total das notas, os itens sem valor, a
 * farmácia (fora da conta) e as notas que ainda esperam a revisão.
 */
function Details({ summary }: { summary: MarketMonth }) {
  const { withoutReceipt, discount, unread, noValue, later, pharmacy, drafts } = summary;
  return (
    <>
      {withoutReceipt ? (
        <AmountLine label={withoutReceipt.label} value={withoutReceipt.value} accessibilityLabel={withoutReceipt.accessibilityLabel} />
      ) : null}
      {discount ? <AmountLine label={discount.label} value={discount.value} accessibilityLabel={discount.accessibilityLabel} /> : null}
      {unread ? (
        <View style={styles.gapSm}>
          <AmountLine label={unread.label} value={unread.value} accessibilityLabel={unread.accessibilityLabel} />
          {/* Diferença de poucos centavos não manda abrir nota nenhuma: a frase só aparece com nota para conferir. */}
          {unread.receipts.length > 0 ? <Text variant="small">A leitura pode ter perdido um item ou um valor. Abra a nota para conferir:</Text> : null}
          {unread.receipts.map((ref) => (
            <ReceiptLink key={ref.key} receipt={ref} />
          ))}
        </View>
      ) : null}
      {noValue ? (
        <View style={styles.gapSm}>
          <Text variant="body">{noValue.label}</Text>
          <Text variant="small">{noValue.hint}</Text>
          {noValue.receipts.map((ref) => (
            <ReceiptLink key={ref.key} receipt={ref} />
          ))}
        </View>
      ) : null}
      {later ? (
        <View style={styles.gapSm}>
          <Text variant="body">{later.label}</Text>
          <Text variant="small">{later.hint}</Text>
          {later.receipts.map((ref) => (
            <ReceiptLink key={ref.key} receipt={ref} />
          ))}
        </View>
      ) : null}
      {pharmacy ? <Text variant="muted">{pharmacy}</Text> : null}
      {drafts ? (
        <View style={styles.gapSm}>
          <Text variant="muted">{drafts.label}</Text>
          {/* Cada rascunho abre a própria nota, onde é confirmado: nada aqui leva para as abas. */}
          {drafts.receipts.map((ref) => (
            <ReceiptLink key={ref.key} receipt={ref} />
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
      onPress={() => open(receipt.opens)}
      style={({ pressed }) => [styles.receiptLink, pressed && styles.pressed]}>
      <Icon name={openIcon(receipt.opens)} size={18} color="textMuted" />
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
